package com.app.lifetracker
// Версия: 2.0 (21.10) — своего уведомления у службы больше нет: переднего плана она держится на уведомлении главного таймера (`CardTimers.foregroundNotification`), поэтому в шторке одно уведомление со значком приложения. Флаг `active`. Откат: TimerTickService.kt 1.0.
// Версия: 1.0 (21.10) — служба переднего плана «тик» острова: пока идёт хотя бы один таймер карточки на Xiaomi, раз в секунду перепоставляет его уведомление со свежим временем (система сама не тикает отсчёт в свёрнутом острове). Останавливается сама, когда идущих таймеров нет.

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
        private const val FG_ID = CardTimers.FG_NOTIFICATION_ID

        /** Служба уже держит уведомление главного таймера (CardTimers пишет его в FG_NOTIFICATION_ID). */
        @Volatile
        var active = false

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
        val hasTimer = enterForeground()
        if (!hasTimer) {
            stopSelf()
            return START_NOT_STICKY
        }
        handler.removeCallbacks(tick)
        handler.post(tick)
        return START_NOT_STICKY
    }

    override fun onDestroy() {
        active = false
        handler.removeCallbacks(tick)
        super.onDestroy()
    }

    /** true — служба встала на уведомление идущего таймера; false — таймеров нет (служба тут же остановится). */
    private fun enterForeground(): Boolean {
        return try {
            val real = CardTimers.foregroundNotification(applicationContext)
            val has = real != null
            val n = real ?: run {
                // startForeground обязателен после startForegroundService, даже если таймер уже закончился
                CardTimers.ensureChannels(applicationContext)
                NotificationCompat.Builder(this, CardTimers.CHANNEL_RUN)
                    .setSmallIcon(R.drawable.ic_stat_notify)
                    .setContentTitle("Таймер")
                    .setPriority(NotificationCompat.PRIORITY_MIN)
                    .build()
            }
            if (Build.VERSION.SDK_INT >= 34) {
                ServiceCompat.startForeground(this, FG_ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE)
            } else {
                startForeground(FG_ID, n)
            }
            active = has
            has
        } catch (e: Exception) {
            false
        }
    }
}
