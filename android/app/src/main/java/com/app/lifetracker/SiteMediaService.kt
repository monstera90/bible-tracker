package com.app.lifetracker
// Версия: 1.2 (03.11)

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import android.os.PowerManager
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat

/**
 * Состояние «видео/звук сайта играет в фоне» (одна вкладка). Хозяин состояния — `UserTabs`: он находит играющий ролик, опрашивает
 * его и передаёт сюда название и «играет/пауза»; кнопки уведомления и острова возвращаются к нему через [Listener].
 */
object SiteMedia {

    interface Listener {
        /** Кнопка «Пауза/Играть» в уведомлении или на острове. */
        fun onToggle()

        /** Кнопка «Закрыть»: видео на паузу, уведомление убрать. */
        fun onClose()
    }

    @Volatile var active = false
    @Volatile var title = ""
    @Volatile var sub = ""
    @Volatile var playing = true
    @Volatile var listener: Listener? = null
    @Volatile var logger: ((String) -> Unit)? = null

    fun log(text: String) {
        try {
            logger?.invoke(text)
        } catch (e: Exception) {
            // журнал не обязателен
        }
    }
    private var floatPending = false
    private var floatDeferred = false

    /** Начало фонового воспроизведения: уведомление появляется, остров раскрывается один раз. */
    fun begin(ctx: Context, title: String, sub: String, l: Listener) {
        this.title = title
        this.sub = sub
        playing = true
        listener = l
        active = true
        floatPending = true
        SiteMediaService.refresh(ctx.applicationContext)
    }

    /** Название или состояние изменились — уведомление перестраивается (тихо, без раскрытия острова). */
    fun update(ctx: Context, title: String, sub: String, playing: Boolean) {
        if (!active) return
        if (this.title == title && this.sub == sub && this.playing == playing) return
        this.title = title
        this.sub = sub
        this.playing = playing
        SiteMediaService.refresh(ctx.applicationContext)
    }

    fun end(ctx: Context) {
        val was = active
        active = false
        listener = null
        floatPending = false
        floatDeferred = false
        if (was) SiteMediaService.stop(ctx.applicationContext)
    }

    /** Раскрыть остров при появлении; пока приложение на экране, система остров прячет — тогда раскрытие откладывается. */
    fun consumeFloat(): Boolean {
        val f = floatPending
        floatPending = false
        if (f && NotifyStore.appForeground) floatDeferred = true
        return f
    }

    /** Приложение ушло с экрана: уведомление перепоставляется, чтобы остров появился (и раскрылся, если раньше не вышло). */
    fun onAppBackground(ctx: Context) {
        if (!active) return
        if (floatDeferred) {
            floatDeferred = false
            floatPending = true
        }
        SiteMediaService.refresh(ctx.applicationContext)
    }
}

/**
 * Служба переднего плана для видео и звука вкладки-сайта: держит процесс (и WebView со страницей) живым при свёрнутом приложении
 * и погашенном экране, показывает уведомление «Пауза/Играть» + «Закрыть» и остров Xiaomi (`XiaomiIsland.videoExtras`).
 * Само видео играет в WebView вкладки; служба только удерживает процесс, процессор и показывает кнопки.
 */
class SiteMediaService : Service() {

    companion object {
        const val CHANNEL = "site_media"
        const val NOTIFICATION_ID = 7

        private const val ACTION_REFRESH = "com.app.lifetracker.sitemedia.REFRESH"
        private const val ACTION_STOP = "com.app.lifetracker.sitemedia.STOP"
        private const val ACTION_TOGGLE = "com.app.lifetracker.sitemedia.TOGGLE"
        private const val ACTION_CLOSE = "com.app.lifetracker.sitemedia.CLOSE"

        private const val ACCENT = 0xFF8F7FB8.toInt()
        private const val WAKE_MAX_MS = 6L * 60L * 60L * 1000L

        fun refresh(ctx: Context) = send(ctx, ACTION_REFRESH)

        fun stop(ctx: Context) = send(ctx, ACTION_STOP)

        private fun send(ctx: Context, action: String) {
            try {
                val i = Intent(ctx, SiteMediaService::class.java).setAction(action)
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) ctx.startForegroundService(i) else ctx.startService(i)
            } catch (e: Exception) {
                // запуск из фона не разрешён: видео играет, уведомление обновится при следующем изменении
                SiteMedia.log("служба не запущена (" + action.substringAfterLast('.') + "): " + e.javaClass.simpleName)
                try {
                    android.widget.Toast.makeText(ctx, "Остров видео не запущен: " + e.javaClass.simpleName, android.widget.Toast.LENGTH_LONG).show()
                } catch (e2: Exception) {
                    // подсказка не показалась
                }
            }
        }

        private fun ensureChannel(ctx: Context) {
            if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
            val nm = ctx.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            if (nm.getNotificationChannel(CHANNEL) == null) {
                val ch = NotificationChannel(CHANNEL, "Видео сайтов", NotificationManager.IMPORTANCE_LOW)
                ch.description = "Видео и звук вкладок-сайтов в фоне"
                ch.setShowBadge(false)
                nm.createNotificationChannel(ch)
            }
        }

        private fun actionIntent(ctx: Context, action: String): PendingIntent {
            val i = Intent(ctx, SiteMediaService::class.java).setAction(action)
            val flags = Compat.pendingFlags()
            return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                PendingIntent.getForegroundService(ctx, action.hashCode(), i, flags)
            } else {
                PendingIntent.getService(ctx, action.hashCode(), i, flags)
            }
        }

        private fun openApp(ctx: Context): PendingIntent {
            val i = Intent(ctx, MainActivity::class.java).apply {
                flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP
            }
            return PendingIntent.getActivity(ctx, 6003, i, Compat.pendingFlags())
        }

        /** Простое уведомление без острова и кнопок: запасное, если полное не собралось (без него система обрушит службу). */
        private fun buildPlain(ctx: Context): Notification {
            ensureChannel(ctx)
            return NotificationCompat.Builder(ctx, CHANNEL)
                .setSmallIcon(R.drawable.ic_stat_notify)
                .setColor(ACCENT)
                .setContentTitle(if (SiteMedia.title.isNotEmpty()) SiteMedia.title else "Видео")
                .setContentText(SiteMedia.sub)
                .setOngoing(true)
                .setOnlyAlertOnce(true)
                .setShowWhen(false)
                .setContentIntent(openApp(ctx))
                .build()
        }

        /** Уведомление по состоянию [SiteMedia]; без активного видео — минимальное (его требует система при старте службы). */
        private fun build(ctx: Context): Notification {
            ensureChannel(ctx)
            val live = SiteMedia.active
            val title = if (live && SiteMedia.title.isNotEmpty()) SiteMedia.title else "Видео"
            val sub = if (live) SiteMedia.sub else ""
            val playing = SiteMedia.playing
            val toggle = actionIntent(ctx, ACTION_TOGGLE)
            val close = actionIntent(ctx, ACTION_CLOSE)
            val b = NotificationCompat.Builder(ctx, CHANNEL)
                .setSmallIcon(R.drawable.ic_stat_notify)
                .setColor(ACCENT)
                .setContentTitle(title)
                .setContentText(sub)
                .setCategory(NotificationCompat.CATEGORY_TRANSPORT)
                .setPriority(NotificationCompat.PRIORITY_LOW)
                .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
                .setOngoing(true)
                .setOnlyAlertOnce(true)
                .setShowWhen(false)
                .setContentIntent(openApp(ctx))
            if (live) {
                // смахнуть уведомление нельзя (Android 14+ это позволяет): смахнутое возвращается на место
                b.setDeleteIntent(actionIntent(ctx, ACTION_REFRESH))
                b.addAction(
                    if (playing) android.R.drawable.ic_media_pause else android.R.drawable.ic_media_play,
                    if (playing) "Пауза" else "Играть", toggle
                )
                b.addAction(android.R.drawable.ic_menu_close_clear_cancel, "Закрыть", close)
                val island = XiaomiIsland.videoExtras(ctx, title, sub, playing, SiteMedia.consumeFloat(), toggle, close)
                if (island != null) b.addExtras(island)
            }
            return b.build()
        }
    }

    private var wake: PowerManager.WakeLock? = null

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val action = intent?.action
        // после startForegroundService система требует перейти на передний план сразу
        var foreground = false
        try {
            val n = try {
                build(applicationContext)
            } catch (e: Exception) {
                SiteMedia.log("уведомление с островом не собралось: " + e.javaClass.simpleName + " — ставлю простое")
                buildPlain(applicationContext)
            }
            ServiceCompat.startForeground(this, NOTIFICATION_ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK)
            foreground = true
        } catch (e: Exception) {
            // уведомления запрещены или запуск не разрешён: ниже служба остановится, если играть нечему
            SiteMedia.log("startForeground не удался: " + e.javaClass.simpleName + " " + (e.message ?: ""))
        }
        if (foreground && action == ACTION_REFRESH && SiteMedia.active && wake == null) SiteMedia.log("служба на переднем плане")
        val l = SiteMedia.listener
        when (action) {
            ACTION_TOGGLE -> l?.onToggle()
            ACTION_CLOSE -> l?.onClose()
        }
        if (action == ACTION_STOP || !SiteMedia.active) {
            releaseWake()
            try {
                ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_REMOVE)
            } catch (e: Exception) {
                // уже снято
            }
            stopSelf()
        } else {
            acquireWake()
        }
        return START_NOT_STICKY
    }

    /** Процессор не засыпает при погашенном экране, пока видео играет (звук WebView сам процессор не держит). */
    private fun acquireWake() {
        if (wake?.isHeld == true) return
        try {
            val pm = getSystemService(Context.POWER_SERVICE) as PowerManager
            val w = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "lifetracker:site_media")
            w.setReferenceCounted(false)
            w.acquire(WAKE_MAX_MS)
            wake = w
        } catch (e: Exception) {
            // без удержания процессора видео может прерываться при погашенном экране
        }
    }

    private fun releaseWake() {
        try {
            if (wake?.isHeld == true) wake?.release()
        } catch (e: Exception) {
            // уже отпущена
        }
        wake = null
    }

    override fun onDestroy() {
        releaseWake()
        super.onDestroy()
    }
}
