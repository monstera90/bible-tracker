package com.app.lifetracker
// Версия: 1.1 (31.10)

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.ServiceInfo
import android.media.AudioManager
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat

/**
 * Служба переднего плана плеера «Музыка»: держит процесс живым, пока играет музыка (в том числе при погашенном экране),
 * показывает уведомление с кнопками «Назад / Пауза / Вперёд / Закрыть» и, на Xiaomi с HyperOS, остров. Состояние берёт у
 * [MusicPlayer]; любое его изменение вызывает [refresh], который перестраивает уведомление.
 */
class MusicService : Service() {

    companion object {
        const val CHANNEL = "music_player"
        const val NOTIFICATION_ID = 5

        private const val ACTION_REFRESH = "com.app.lifetracker.music.REFRESH"
        private const val ACTION_STOP = "com.app.lifetracker.music.STOP"
        private const val ACTION_TOGGLE = "com.app.lifetracker.music.TOGGLE"
        private const val ACTION_PREV = "com.app.lifetracker.music.PREV"
        private const val ACTION_NEXT = "com.app.lifetracker.music.NEXT"
        private const val ACTION_CLOSE = "com.app.lifetracker.music.CLOSE"

        private const val ACCENT = 0xFF8F7FB8.toInt()

        /** Перестроить уведомление под текущее состояние плеера (и запустить службу, если её нет). */
        fun refresh(ctx: Context) = send(ctx, ACTION_REFRESH)

        /** Снять уведомление и остановить службу. */
        fun stop(ctx: Context) = send(ctx, ACTION_STOP)

        private fun send(ctx: Context, action: String) {
            try {
                val i = Intent(ctx, MusicService::class.java).setAction(action)
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) ctx.startForegroundService(i) else ctx.startService(i)
            } catch (e: Exception) {
                // запуск из фона не разрешён: музыка играет, обновится при следующем изменении
            }
        }

        private fun ensureChannel(ctx: Context) {
            if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
            val nm = ctx.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            if (nm.getNotificationChannel(CHANNEL) == null) {
                val ch = NotificationChannel(CHANNEL, "Музыка", NotificationManager.IMPORTANCE_LOW)
                ch.description = "Плеер вкладки «Музыка»"
                ch.setShowBadge(false)
                nm.createNotificationChannel(ch)
            }
        }

        private fun actionIntent(ctx: Context, action: String): PendingIntent {
            val i = Intent(ctx, MusicService::class.java).setAction(action)
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
            return PendingIntent.getActivity(ctx, 6002, i, Compat.pendingFlags())
        }

        /** Уведомление по текущему состоянию плеера; без активной сессии — минимальное (его требует система при старте службы). */
        private fun build(ctx: Context): Notification {
            ensureChannel(ctx)
            val live = MusicPlayer.active
            val title = if (live && MusicPlayer.title.isNotEmpty()) MusicPlayer.title else "Музыка"
            val sub = if (live) MusicPlayer.folderTitle else ""
            val playing = MusicPlayer.playing
            val prev = actionIntent(ctx, ACTION_PREV)
            val toggle = actionIntent(ctx, ACTION_TOGGLE)
            val next = actionIntent(ctx, ACTION_NEXT)
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
            // музыка из комбо: уведомление смахнуть нельзя — смахнутое возвращается на место (REFRESH перестраивает его)
            if (live && ComboGroup.isMusicMember()) b.setDeleteIntent(actionIntent(ctx, ACTION_REFRESH))
            if (live) {
                b.addAction(android.R.drawable.ic_media_previous, "Назад", prev)
                b.addAction(
                    if (playing) android.R.drawable.ic_media_pause else android.R.drawable.ic_media_play,
                    if (playing) "Пауза" else "Играть", toggle
                )
                b.addAction(android.R.drawable.ic_media_next, "Вперёд", next)
                b.addAction(android.R.drawable.ic_menu_close_clear_cancel, "Закрыть", actionIntent(ctx, ACTION_CLOSE))
                val island = XiaomiIsland.musicExtras(ctx, title, sub, playing, MusicPlayer.consumeFloat(), prev, toggle, next)
                if (island != null) b.addExtras(island)
            }
            return b.build()
        }
    }

    private val noisy = object : BroadcastReceiver() {
        override fun onReceive(context: Context?, intent: Intent?) {
            if (intent?.action == AudioManager.ACTION_AUDIO_BECOMING_NOISY) MusicPlayer.onNoisy()
        }
    }
    private var noisyRegistered = false

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        try {
            registerReceiver(noisy, IntentFilter(AudioManager.ACTION_AUDIO_BECOMING_NOISY))
            noisyRegistered = true
        } catch (e: Exception) {
            // без отключения на «выдернули наушники» служба работает
        }
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val action = intent?.action
        // после startForegroundService система требует перейти на передний план сразу
        try {
            ServiceCompat.startForeground(this, NOTIFICATION_ID, build(applicationContext), ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK)
        } catch (e: Exception) {
            // уведомления запрещены или запуск не разрешён: ниже служба остановится, если играть нечему
        }
        when (action) {
            ACTION_TOGGLE -> MusicPlayer.toggle()
            ACTION_PREV -> MusicPlayer.prev()
            ACTION_NEXT -> MusicPlayer.next()
            ACTION_CLOSE -> MusicPlayer.close()
        }
        if (action == ACTION_STOP || !MusicPlayer.active) {
            try {
                ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_REMOVE)
            } catch (e: Exception) {
                // уже снято
            }
            stopSelf()
        }
        return START_NOT_STICKY
    }

    override fun onDestroy() {
        if (noisyRegistered) {
            try {
                unregisterReceiver(noisy)
            } catch (e: Exception) {
                // уже снят
            }
            noisyRegistered = false
        }
        super.onDestroy()
    }
}
