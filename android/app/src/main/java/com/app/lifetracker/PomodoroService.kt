package com.app.lifetracker
// Версия: 1.2 (09.11)

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
 * Служба переднего плана помодоро: раз в секунду перепоставляет уведомление (на Xiaomi с HyperOS — остров,
 * [XiaomiIsland.pomodoroExtras]), потому что свёрнутый остров сам не тикает, и ловит конец фазы, если будильник опоздал.
 * Пока приложение на экране, уведомление не перепоставляется (остров под плашкой [InAppIsland] мигал бы).
 * На Xiaomi остров один на помодоро и таймеры карточек: если идущий таймер закончится раньше фазы, уведомление не перепоставляется
 * (иначе два уведомления по очереди выходили бы на главное место и остров дёргался), см. [PomodoroTimer.islandRank].
 * Кнопки уведомления/острова — «Пауза/Продолжить», «+5 минут», «Пропустить перерыв»/«Начать работу», «Стоп».
 * Останавливается сама, когда сессия закончилась.
 */
class PomodoroService : Service() {

    companion object {
        const val CHANNEL = "pomodoro"
        const val NOTIFICATION_ID = 8

        private const val ACTION_REFRESH = "com.app.lifetracker.pomodoro.REFRESH"
        private const val ACTION_PAUSE = "com.app.lifetracker.pomodoro.PAUSE"
        private const val ACTION_PLUS = "com.app.lifetracker.pomodoro.PLUS"
        private const val ACTION_SKIP = "com.app.lifetracker.pomodoro.SKIP"
        private const val ACTION_STOP = "com.app.lifetracker.pomodoro.STOP"

        /** Запустить службу (после [PomodoroTimer.start]) или перестроить её уведомление. */
        fun refresh(ctx: Context) {
            if (!PomodoroTimer.isActive(ctx)) return
            send(ctx, ACTION_REFRESH)
        }

        fun stop(ctx: Context) {
            try {
                ctx.stopService(Intent(ctx, PomodoroService::class.java))
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
                val i = Intent(ctx, PomodoroService::class.java).setAction(action)
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) ctx.startForegroundService(i) else ctx.startService(i)
            } catch (e: Exception) {
                // запуск из фона не разрешён: сессия идёт, уведомление обновится при следующем тике
            }
        }

        private fun ensureChannel(ctx: Context) {
            if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
            val nm = ctx.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            if (nm.getNotificationChannel(CHANNEL) == null) {
                val ch = NotificationChannel(CHANNEL, "Помодоро", NotificationManager.IMPORTANCE_LOW)
                ch.description = "Помодоро-таймер: фаза, остаток времени и кнопки"
                ch.setShowBadge(false)
                nm.createNotificationChannel(ch)
            }
        }

        private fun actionIntent(ctx: Context, action: String): PendingIntent {
            val i = Intent(ctx, PomodoroService::class.java).setAction(action)
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
            return PendingIntent.getActivity(ctx, 6008, i, Compat.pendingFlags())
        }

        private fun build(ctx: Context): Notification {
            ensureChannel(ctx)
            val s = PomodoroTimer.snapshot(ctx)
            val b = NotificationCompat.Builder(ctx, CHANNEL)
                .setSmallIcon(R.drawable.ic_stat_notify)
                .setCategory(NotificationCompat.CATEGORY_STATUS)
                .setPriority(NotificationCompat.PRIORITY_LOW)
                .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
                .setOngoing(true)
                .setOnlyAlertOnce(true)
                .setContentIntent(openApp(ctx))
            if (s == null) {
                return b.setContentTitle("Помодоро").setShowWhen(false).build()
            }
            val pause = actionIntent(ctx, ACTION_PAUSE)
            val plus = actionIntent(ctx, ACTION_PLUS)
            val skip = actionIntent(ctx, ACTION_SKIP)
            val stop = actionIntent(ctx, ACTION_STOP)
            val wait = s.phase == PomodoroTimer.PH_WAIT
            val paused = !s.running && !wait
            val counting = s.running && !wait && !s.flash
            b.setColor(PomodoroTimer.baseColor(s.phase))
            if (counting) {
                // время в шторке рисует система сама (не отстаёт при погашенном экране)
                b.setContentTitle(PomodoroTimer.label(s))
                    .setUsesChronometer(true).setChronometerCountDown(true).setWhen(s.endAt).setShowWhen(true)
            } else {
                val t = when {
                    s.flash -> "Готово"
                    wait -> "Перерыв закончился · +" + XiaomiIsland.elapsedText(s.overMs)
                    else -> "Пауза · " + XiaomiIsland.clockText(s.leftMs)
                }
                b.setContentTitle(t).setShowWhen(false)
            }
            b.setContentText(PomodoroTimer.detail(s))
            when {
                wait -> {
                    b.addAction(android.R.drawable.ic_media_play, "Начать работу", skip)
                    b.addAction(android.R.drawable.ic_menu_close_clear_cancel, "Стоп", stop)
                }
                else -> {
                    b.addAction(if (paused) android.R.drawable.ic_media_play else android.R.drawable.ic_media_pause, if (paused) "Продолжить" else "Пауза", pause)
                    b.addAction(android.R.drawable.ic_input_add, if (s.undo) "Ещё 5 мин работы" else "+5 минут", plus)
                    if (s.phase == PomodoroTimer.PH_WORK) {
                        b.addAction(android.R.drawable.ic_menu_close_clear_cancel, "Стоп", stop)
                    } else {
                        b.addAction(android.R.drawable.ic_media_next, "Пропустить перерыв", skip)
                    }
                }
            }
            val island = XiaomiIsland.pomodoroExtras(ctx, s, PomodoroTimer.consumeFloat(), pause, plus, skip, stop)
            if (island != null) b.addExtras(island)
            return b.build()
        }
    }

    private val handler = Handler(Looper.getMainLooper())

    /** Остров Xiaomi держит таймер карточки: он закончится раньше (или помодоро сейчас не тикает) — своё уведомление не трогаем. */
    private fun timerLeadsIsland(ctx: Context): Boolean {
        if (!XiaomiIsland.available(ctx)) return false
        val t = CardTimers.islandRank(ctx)
        return t != Long.MAX_VALUE && t <= PomodoroTimer.islandRank(ctx)
    }

    private val tick = object : Runnable {
        override fun run() {
            val ctx = applicationContext
            try {
                PomodoroTimer.checkDue(ctx)
            } catch (e: Exception) {
                // следующим тиком
            }
            if (!PomodoroTimer.isActive(ctx)) {
                shutdown()
                return
            }
            InAppIsland.ensureBackground(ctx) // системный остров выключен: плашка помодоро висит поверх других приложений
            if (!NotifyStore.appForeground && !timerLeadsIsland(ctx)) {
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
            // уведомления запрещены или запуск не разрешён: ниже служба остановится, если сессии нет
        }
        when (intent?.action) {
            ACTION_PAUSE -> PomodoroTimer.togglePause(ctx)
            ACTION_PLUS -> PomodoroTimer.plus5(ctx)
            ACTION_SKIP -> PomodoroTimer.skip(ctx)
            ACTION_STOP -> PomodoroTimer.stop(ctx)
        }
        if (!PomodoroTimer.isActive(ctx)) {
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
