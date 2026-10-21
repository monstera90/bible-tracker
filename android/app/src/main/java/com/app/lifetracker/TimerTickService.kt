package com.app.lifetracker
// Версия: 1.0 (21.10) — служба переднего плана «тик» острова: пока идёт хотя бы один таймер карточки на Xiaomi, раз в секунду перепоставляет его уведомление со свежим временем (система сама не тикает отсчёт в свёрнутом острове). Останавливается сама, когда идущих таймеров нет. Откат: удалить файл, запись <service> в манифесте и вызовы CardTimers.startTicker.

import android.app.NotificationChannel
import android.app.NotificationManager
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

class TimerTickService : Service() {

    companion object {
        private const val CHANNEL = "card_timer_tick"
        private const val FG_ID = 3

        /** Запустить (или не мешать уже запущенной) службе тика. Любая ошибка не мешает таймеру. */
        fun ensure(ctx: Context) {
            try {
                val i = Intent(ctx, TimerTickService::class.java)
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) ctx.startForegroundService(i) else ctx.startService(i)
            } catch (e: Exception) {
                // запуск из фона не разрешён: отсчёт в шторке идёт, остров покажет время при следующем обновлении
            }
        }
    }

    private val handler = Handler(Looper.getMainLooper())

    private val tick = object : Runnable {
        override fun run() {
            val next = try {
                CardTimers.tickIsland(applicationContext)
            } catch (e: Exception) {
                -1L
            }
            if (next >= 0) handler.postDelayed(this, next.coerceIn(30L, 1100L)) else stopSelf()
        }
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (!enterForeground()) {
            stopSelf()
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

    private fun enterForeground(): Boolean = try {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            if (nm.getNotificationChannel(CHANNEL) == null) {
                val ch = NotificationChannel(CHANNEL, "Обновление острова таймера", NotificationManager.IMPORTANCE_MIN)
                ch.setShowBadge(false)
                nm.createNotificationChannel(ch)
            }
        }
        val n = NotificationCompat.Builder(this, CHANNEL)
            .setSmallIcon(R.drawable.ic_stat_notify)
            .setContentTitle("Таймер идёт")
            .setPriority(NotificationCompat.PRIORITY_MIN)
            .setCategory(NotificationCompat.CATEGORY_SERVICE)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setShowWhen(false)
            .build()
        if (Build.VERSION.SDK_INT >= 34) {
            ServiceCompat.startForeground(this, FG_ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE)
        } else {
            startForeground(FG_ID, n)
        }
        true
    } catch (e: Exception) {
        false
    }
}
