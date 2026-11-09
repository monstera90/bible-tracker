package com.app.lifetracker
// Версия: 1.0 (09.11)

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat

/**
 * Служба переднего плана секундомера ([StopwatchTimer]): раз в секунду перепоставляет уведомление (на Xiaomi с HyperOS — остров,
 * [XiaomiIsland.stopwatchExtras]), потому что свёрнутый остров сам не тикает. Пока приложение на экране, уведомление не
 * перепоставляется (его заменяет плашка [InAppIsland]). Если остров Xiaomi держит помодоро или таймер карточки, секундомер
 * его не перебивает (иначе два тикающих уведомления дёргали бы остров). Кнопки — «Пауза/Продолжить» и «Стоп». Номер уведомления — 10.
 */
class StopwatchService : Service() {

    companion object {
        const val CHANNEL = "stopwatch"
        const val NOTIFICATION_ID = 10

        private const val ACTION_REFRESH = "com.app.lifetracker.stopwatch.REFRESH"
        private const val ACTION_PAUSE = "com.app.lifetracker.stopwatch.PAUSE"
        private const val ACTION_STOP = "com.app.lifetracker.stopwatch.STOP"

        /** Запустить службу (после [StopwatchTimer.start]) или перестроить её уведомление. */
        fun refresh(ctx: Context) {
            if (!StopwatchTimer.isActive(ctx)) return
            send(ctx, ACTION_REFRESH)
        }

        fun stop(ctx: Context) {
            try {
                ctx.stopService(Intent(ctx, StopwatchService::class.java))
            } catch (e: Exception) {
                // уже остановлена
            }
            try {
                (ctx.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager).cancel(NOTIFICATION_ID)
            } catch (e: Exception) {
                // уведомления нет
            }
        }

        private fun send(ctx: Context, action: String) {
            try {
                val i = Intent(ctx, StopwatchService::class.java).setAction(action)
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) ctx.startForegroundService(i) else ctx.startService(i)
            } catch (e: Exception) {
                // запуск из фона не разрешён: секундомер идёт, уведомление обновится при следующем запуске службы
            }
        }

        private fun ensureChannel(ctx: Context) {
            if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
            val nm = ctx.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            if (nm.getNotificationChannel(CHANNEL) == null) {
                val ch = NotificationChannel(CHANNEL, "Секундомер", NotificationManager.IMPORTANCE_LOW)
                ch.description = "Секундомер: время и кнопки «Пауза» и «Стоп»"
                ch.setShowBadge(false)
                nm.createNotificationChannel(ch)
            }
        }

        private fun actionIntent(ctx: Context, action: String): PendingIntent {
            val i = Intent(ctx, StopwatchService::class.java).setAction(action)
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
            return PendingIntent.getActivity(ctx, 6010, i, Compat.pendingFlags())
        }

        private fun build(ctx: Context): Notification {
            ensureChannel(ctx)
            val s = StopwatchTimer.snapshot(ctx)
            val b = NotificationCompat.Builder(ctx, CHANNEL)
                .setSmallIcon(R.drawable.ic_stat_notify)
                .setCategory(NotificationCompat.CATEGORY_STOPWATCH)
                .setPriority(NotificationCompat.PRIORITY_LOW)
                .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
                .setOngoing(true)
                .setOnlyAlertOnce(true)
                .setColor(0xFF1E88E5.toInt())
                .setContentIntent(openApp(ctx))
            if (s == null) return b.setContentTitle("Секундомер").setShowWhen(false).build()
            val pause = actionIntent(ctx, ACTION_PAUSE)
            val stop = actionIntent(ctx, ACTION_STOP)
            if (s.running) {
                // время в шторке считает система сама (не отстаёт при погашенном экране)
                b.setContentTitle("Секундомер")
                    .setUsesChronometer(true).setWhen(System.currentTimeMillis() - s.elapsedMs).setShowWhen(true)
            } else {
                b.setContentTitle("Пауза · " + XiaomiIsland.elapsedText(s.elapsedMs)).setShowWhen(false)
            }
            b.addAction(
                if (s.running) android.R.drawable.ic_media_pause else android.R.drawable.ic_media_play,
                if (s.running) "Пауза" else "Продолжить", pause
            )
            b.addAction(android.R.drawable.ic_menu_close_clear_cancel, "Стоп", stop)
            val island = XiaomiIsland.stopwatchExtras(ctx, s, StopwatchTimer.consumeFloat(), pause, stop)
            // На Xiaomi — остров по протоколу Xiaomi; на остальных — «живое обновление» Android 16.
            if (island != null) b.addExtras(island)
            else b.addExtras(Bundle().apply { putBoolean("android.requestPromotedOngoing", true) })
            return b.build()
        }
    }

    private val handler = Handler(Looper.getMainLooper())

    /** Остров Xiaomi занят помодоро или таймером карточки — своё уведомление не перепоставляем. */
    private fun othersLeadIsland(ctx: Context): Boolean {
        if (!XiaomiIsland.available(ctx)) return false
        return PomodoroTimer.isActive(ctx) || CardTimers.islandRank(ctx) != Long.MAX_VALUE
    }

    private val tick = object : Runnable {
        override fun run() {
            val ctx = applicationContext
            if (!StopwatchTimer.isActive(ctx)) {
                shutdown()
                return
            }
            if (!NotifyStore.appForeground && !othersLeadIsland(ctx)) {
                try {
                    val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
                    nm.notify(NOTIFICATION_ID, build(ctx))
                } catch (e: Exception) {
                    // уведомление обновится следующим тиком
                }
            }
            handler.postDelayed(this, 1000L)
        }
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val ctx = applicationContext
        // после startForegroundService система требует перейти на передний план сразу
        try {
            val n = build(ctx)
            if (Build.VERSION.SDK_INT >= 34) {
                ServiceCompat.startForeground(this, NOTIFICATION_ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE)
            } else {
                startForeground(NOTIFICATION_ID, n)
            }
        } catch (e: Exception) {
            // уведомления запрещены или запуск не разрешён: ниже служба остановится, если секундомера нет
        }
        when (intent?.action) {
            ACTION_PAUSE -> StopwatchTimer.togglePause(ctx)
            ACTION_STOP -> StopwatchTimer.stop(ctx)
        }
        if (!StopwatchTimer.isActive(ctx)) {
            shutdown()
            return START_NOT_STICKY
        }
        handler.removeCallbacks(tick)
        handler.post(tick)
        return START_NOT_STICKY
    }

    override fun onDestroy() {
        handler.removeCallbacks(tick)
        super.onDestroy()
    }

    private fun shutdown() {
        handler.removeCallbacks(tick)
        try {
            ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_REMOVE)
        } catch (e: Exception) {
            // уже снято
        }
        stopSelf()
    }
}
