package com.app.lifetracker
// Версия: 1.1 (08.11)

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat

/**
 * Служба переднего плана «Усиление громкости»: держит процесс живым, пока включено усиление > 100 %, чтобы эффект
 * [VolumeBoost] не пропадал вместе с процессом, и раз в 15 с проверяет, что система его не сбросила. В уведомлении —
 * текущий процент и кнопка «Выключить» (возвращает 100 %). Стоп — при выборе 100 %.
 */
class VolumeBoostService : Service() {

    companion object {
        const val CHANNEL = "volume_boost"
        const val NOTIFICATION_ID = 9 // не 6: 6 у WorkoutService, и при одновременной работе уведомления подменяли бы друг друга
        private const val ACTION_OFF = "com.app.lifetracker.volumeboost.OFF"
        private const val ACTION_STOP = "com.app.lifetracker.volumeboost.STOP"
        private const val CHECK_MS = 15000L

        fun start(ctx: Context) = send(ctx, null)
        fun stop(ctx: Context) {
            // службу, которой нет, запускать ради остановки не нужно
            try {
                ctx.stopService(Intent(ctx, VolumeBoostService::class.java))
            } catch (e: Exception) {
                // не запущена
            }
        }

        private fun send(ctx: Context, action: String?) {
            try {
                val i = Intent(ctx, VolumeBoostService::class.java)
                if (action != null) i.action = action
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) ctx.startForegroundService(i) else ctx.startService(i)
            } catch (e: Exception) {
                // запуск из фона не разрешён: эффект уже включён, пока жив процесс
            }
        }

        private fun ensureChannel(ctx: Context) {
            if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
            val nm = ctx.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            if (nm.getNotificationChannel(CHANNEL) == null) {
                val ch = NotificationChannel(CHANNEL, "Усиление громкости", NotificationManager.IMPORTANCE_LOW)
                ch.description = "Работает, пока включено усиление громкости в системе"
                ch.setShowBadge(false)
                nm.createNotificationChannel(ch)
            }
        }

        private fun build(ctx: Context): Notification {
            ensureChannel(ctx)
            val pct = VolumeBoost.saved(ctx)
            val ok = VolumeBoost.stateJson(ctx).contains("\"works\":true")
            val open = PendingIntent.getActivity(
                ctx, 6003,
                Intent(ctx, MainActivity::class.java).apply { flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP },
                Compat.pendingFlags()
            )
            val offI = Intent(ctx, VolumeBoostService::class.java).setAction(ACTION_OFF)
            val off = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                PendingIntent.getForegroundService(ctx, 6004, offI, Compat.pendingFlags())
            } else {
                PendingIntent.getService(ctx, 6004, offI, Compat.pendingFlags())
            }
            return NotificationCompat.Builder(ctx, CHANNEL)
                .setSmallIcon(R.drawable.ic_stat_notify)
                .setContentTitle("Усиление громкости: $pct%")
                .setContentText(if (ok) "Звук всей системы усилен" else "Система не применила усиление")
                .setPriority(NotificationCompat.PRIORITY_LOW)
                .setOngoing(true)
                .setOnlyAlertOnce(true)
                .setShowWhen(false)
                .setContentIntent(open)
                .addAction(android.R.drawable.ic_menu_close_clear_cancel, "Выключить", off)
                .build()
        }
    }

    private val handler = Handler(Looper.getMainLooper())
    private val check = object : Runnable {
        override fun run() {
            try {
                VolumeBoost.ensure(applicationContext)
            } catch (e: Exception) {
                // следующая проверка через 15 с
            }
            handler.postDelayed(this, CHECK_MS)
        }
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        // после startForegroundService система требует перейти на передний план сразу
        try {
            val n = build(applicationContext)
            if (Build.VERSION.SDK_INT >= 34) {
                ServiceCompat.startForeground(this, NOTIFICATION_ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE)
            } else {
                startForeground(NOTIFICATION_ID, n)
            }
        } catch (e: Exception) {
            // уведомления запрещены: эффект всё равно работает, пока жив процесс
        }
        if (intent?.action == ACTION_OFF) {
            VolumeBoost.set(applicationContext, 100)
            try {
                ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_REMOVE)
            } catch (e: Exception) {
                // уже снято
            }
            stopSelf()
            return START_NOT_STICKY
        }
        if (VolumeBoost.saved(applicationContext) <= 100) {
            try {
                ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_REMOVE)
            } catch (e: Exception) {
                // уже снято
            }
            stopSelf()
            return START_NOT_STICKY
        }
        handler.removeCallbacks(check)
        handler.post(check)
        return START_NOT_STICKY
    }

    override fun onDestroy() {
        handler.removeCallbacks(check)
        super.onDestroy()
    }
}
