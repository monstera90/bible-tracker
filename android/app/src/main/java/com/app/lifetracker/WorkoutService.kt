package com.app.lifetracker
// Версия: 1.0 (27.10)

import android.Manifest
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.content.pm.ServiceInfo
import android.location.GnssStatus
import android.location.Location
import android.location.LocationListener
import android.location.LocationManager
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.text.SpannableString
import android.text.Spanned
import android.text.style.ForegroundColorSpan
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat
import androidx.core.content.ContextCompat
import java.util.Locale

/**
 * Служба переднего плана вкладки «Тренировки»: держит GPS (LocationManager, провайдер GPS) и процесс живым при погашенном
 * экране, раз в секунду обновляет уведомление (а на Xiaomi с HyperOS — остров: [XiaomiIsland.workoutExtras]). Всю логику
 * записи ведёт [WorkoutTracker]; службе остаётся принимать точки и кнопки «Пауза/Продолжить» и «Стоп» из уведомления/острова.
 * Останавливается сама, когда запись закончилась (статус IDLE), в том числе после сопоставления маршрута с картой.
 */
class WorkoutService : Service() {

    companion object {
        const val CHANNEL = "workout"
        const val NOTIFICATION_ID = 6

        private const val ACTION_REFRESH = "com.app.lifetracker.workout.REFRESH"
        private const val ACTION_PAUSE = "com.app.lifetracker.workout.PAUSE"
        private const val ACTION_STOP = "com.app.lifetracker.workout.STOP"

        private const val ACCENT = 0xFF8F7FB8.toInt()
        private const val PALE_RED = 0xFFE57373.toInt()

        /** Запустить службу (после [WorkoutTracker.begin]) или перестроить её уведомление. */
        fun refresh(ctx: Context) = send(ctx, ACTION_REFRESH)

        fun hasLocationPermission(ctx: Context): Boolean =
            ContextCompat.checkSelfPermission(ctx, Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED

        fun gpsEnabled(ctx: Context): Boolean = try {
            val lm = ctx.getSystemService(Context.LOCATION_SERVICE) as LocationManager
            lm.isProviderEnabled(LocationManager.GPS_PROVIDER)
        } catch (e: Exception) {
            false
        }

        private fun send(ctx: Context, action: String) {
            try {
                val i = Intent(ctx, WorkoutService::class.java).setAction(action)
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) ctx.startForegroundService(i) else ctx.startService(i)
            } catch (e: Exception) {
                // запуск из фона не разрешён: запись уже идёт, уведомление обновится при следующем тике
            }
        }

        private fun ensureChannel(ctx: Context) {
            if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
            val nm = ctx.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            if (nm.getNotificationChannel(CHANNEL) == null) {
                val ch = NotificationChannel(CHANNEL, "Тренировка", NotificationManager.IMPORTANCE_LOW)
                ch.description = "Запись тренировки по GPS (вкладка «Тренировки»)"
                ch.setShowBadge(false)
                nm.createNotificationChannel(ch)
            }
        }

        private fun actionIntent(ctx: Context, action: String): PendingIntent {
            val i = Intent(ctx, WorkoutService::class.java).setAction(action)
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

        /** «10,7 км» — до десятых (округление); точное значение остаётся в записи для сумм. */
        fun kmText(distM: Double): String = String.format(Locale("ru"), "%.1f км", distM / 1000.0)

        private fun build(ctx: Context): Notification {
            ensureChannel(ctx)
            val s = WorkoutTracker.snapshot()
            val pause = actionIntent(ctx, ACTION_PAUSE)
            val stop = actionIntent(ctx, ACTION_STOP)
            val paused = s.status == WorkoutTracker.ST_PAUSE
            val title: String
            val text: CharSequence
            when (s.status) {
                WorkoutTracker.ST_SEARCH -> {
                    title = "Поиск спутников…"
                    text = if (s.sat >= 0) "Найдено спутников: ${s.sat}" else "Ждём сигнал GPS"
                }
                WorkoutTracker.ST_FINISH -> {
                    title = "Тренировка завершена"
                    text = "Сопоставляю маршрут с картой…"
                }
                else -> {
                    title = XiaomiIsland.elapsedText(s.totalMs) + "  ·  " + kmText(s.distM) + if (paused) "  (пауза)" else ""
                    text = when {
                        s.status == WorkoutTracker.ST_RUN && !s.fix -> "Связи нет — километры не считаются" + lostSuffix(s.lostMs)
                        else -> if (s.connectedBanner) "Связь установлена" else lostOnly(s.lostMs)
                    }
                }
            }
            val b = NotificationCompat.Builder(ctx, CHANNEL)
                .setSmallIcon(R.drawable.ic_stat_notify)
                .setColor(ACCENT)
                .setContentTitle(title)
                .setContentText(text)
                .setCategory("workout")
                .setPriority(NotificationCompat.PRIORITY_LOW)
                .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
                .setOngoing(true)
                .setOnlyAlertOnce(true)
                .setShowWhen(false)
                .setContentIntent(openApp(ctx))
            if (s.status == WorkoutTracker.ST_RUN || s.status == WorkoutTracker.ST_PAUSE) {
                b.addAction(
                    if (paused) android.R.drawable.ic_media_play else android.R.drawable.ic_media_pause,
                    if (paused) "Продолжить" else "Пауза", pause
                )
                b.addAction(android.R.drawable.ic_menu_close_clear_cancel, "Стоп", stop)
            } else if (s.status == WorkoutTracker.ST_SEARCH) {
                b.addAction(android.R.drawable.ic_menu_close_clear_cancel, "Стоп", stop)
            }
            val island = XiaomiIsland.workoutExtras(ctx, s, WorkoutTracker.consumeFloat(), pause, stop)
            if (island != null) b.addExtras(island)
            return b.build()
        }

        private fun lostSuffix(lostMs: Long): String = if (lostMs >= 1000) "  ·  без учёта " + XiaomiIsland.elapsedText(lostMs) else ""

        /** Строка «без учёта 3:12» бледно-красным (только в шторке; в самом острове цвет строки протокол Xiaomi не задаёт). */
        private fun lostOnly(lostMs: Long): CharSequence {
            if (lostMs < 1000) return ""
            val t = "без учёта " + XiaomiIsland.elapsedText(lostMs)
            val sp = SpannableString(t)
            sp.setSpan(ForegroundColorSpan(PALE_RED), 0, t.length, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
            return sp
        }
    }

    private val handler = Handler(Looper.getMainLooper())
    private var lm: LocationManager? = null
    private var listening = false
    private var gnssCallback: Any? = null

    private val listener = object : LocationListener {
        override fun onLocationChanged(loc: Location) {
            WorkoutTracker.onLocation(loc.latitude, loc.longitude, loc.accuracy, loc.hasAccuracy())
        }

        @Deprecated("Deprecated in Java")
        override fun onStatusChanged(provider: String?, status: Int, extras: Bundle?) {
        }

        override fun onProviderEnabled(provider: String) {
        }

        override fun onProviderDisabled(provider: String) {
        }
    }

    private val tick = object : Runnable {
        override fun run() {
            WorkoutTracker.tick()
            val st = WorkoutTracker.status
            if (st == WorkoutTracker.ST_IDLE) {
                shutdown()
                return
            }
            try {
                val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
                nm.notify(NOTIFICATION_ID, build(applicationContext))
            } catch (e: Exception) {
                // уведомление обновится следующим тиком
            }
            handler.postDelayed(this, 1000L)
        }
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        // после startForegroundService система требует перейти на передний план сразу
        try {
            ServiceCompat.startForeground(this, NOTIFICATION_ID, build(applicationContext), ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION)
        } catch (e: Exception) {
            // уведомления запрещены или запуск не разрешён: ниже служба остановится, если записывать нечего
        }
        when (intent?.action) {
            ACTION_PAUSE -> WorkoutTracker.togglePause()
            ACTION_STOP -> WorkoutTracker.stop(applicationContext)
        }
        if (WorkoutTracker.status == WorkoutTracker.ST_IDLE) {
            shutdown()
            return START_NOT_STICKY
        }
        startListening()
        handler.removeCallbacks(tick)
        handler.post(tick)
        return START_NOT_STICKY
    }

    override fun onDestroy() {
        handler.removeCallbacks(tick)
        stopListening()
        super.onDestroy()
    }

    private fun shutdown() {
        handler.removeCallbacks(tick)
        stopListening()
        try {
            ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_REMOVE)
        } catch (e: Exception) {
            // уже снято
        }
        stopSelf()
    }

    private fun startListening() {
        if (listening) return
        if (!hasLocationPermission(this)) return
        try {
            val m = getSystemService(Context.LOCATION_SERVICE) as LocationManager
            lm = m
            m.requestLocationUpdates(LocationManager.GPS_PROVIDER, 1000L, 0f, listener, Looper.getMainLooper())
            listening = true
            registerGnss(m)
        } catch (e: SecurityException) {
            // разрешение отозвано: записи не будет, пользователь увидит «Поиск спутников» без роста
        } catch (e: Exception) {
            // нет GPS-провайдера
        }
    }

    private fun registerGnss(m: LocationManager) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.N) return // до Android 7 число спутников не показываем
        try {
            val cb = object : GnssStatus.Callback() {
                override fun onSatelliteStatusChanged(status: GnssStatus) {
                    var used = 0
                    for (i in 0 until status.satelliteCount) if (status.usedInFix(i)) used++
                    WorkoutTracker.setSats(used, status.satelliteCount)
                }
            }
            gnssCallback = cb
            @Suppress("DEPRECATION")
            m.registerGnssStatusCallback(cb, handler)
        } catch (e: SecurityException) {
            // без числа спутников запись работает
        } catch (e: Exception) {
            // без числа спутников запись работает
        }
    }

    private fun stopListening() {
        val m = lm ?: return
        try {
            m.removeUpdates(listener)
        } catch (e: Exception) {
            // уже снято
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
            val cb = gnssCallback
            if (cb is GnssStatus.Callback) {
                try {
                    m.unregisterGnssStatusCallback(cb)
                } catch (e: Exception) {
                    // уже снято
                }
            }
        }
        gnssCallback = null
        listening = false
        lm = null
    }
}
