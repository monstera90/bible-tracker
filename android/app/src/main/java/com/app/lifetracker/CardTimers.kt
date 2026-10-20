package com.app.lifetracker
// Версия: 1.1 (20.10) — остров Xiaomi (XiaomiIsland): extras `miui.focus.param` в уведомлении таймера.
// Версия: 1.0 (17.10)

import android.annotation.SuppressLint
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.VibrationEffect
import android.os.Vibrator
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import org.json.JSONArray
import org.json.JSONObject
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/**
 * Таймеры карточек вкладки 9 (ТЗ TASK_ITEM_CARDS_QR.md, шаг 5а). Работают без открытого приложения и без запущенной
 * WebView: состояние лежит в SharedPreferences, окончание — точный будильник (ReminderScheduler.setAlarm, тот же приём,
 * что у напоминаний), отсчёт в шторке рисует сама система (уведомление с обратным хронометром, секундных обновлений
 * не нужно). Foreground-служба не нужна: уведомление «идёт» обычное, постоянное (ongoing).
 *
 * Запуск: страница (мост LifeTrackerNative.startCardTimer) или окно ScanActivity по скану карточки-таймера.
 * Повторный запуск того же id запускает отсчёт заново. Пауза, продолжить и отмена — кнопки уведомления
 * (CardTimerReceiver). В конце — вибрация и уведомление «Таймер закончился» (звук — позже, по ТЗ).
 *
 * Живое уведомление Android 16 («live updates», у Xiaomi HyperOS 3 — динамический остров): уведомление помечено
 * как «продвигаемое постоянное» (extras android.requestPromotedOngoing) и имеет хронометр. Поддержку конкретным
 * телефоном проверяет заказчик; на остальных телефонах это обычное уведомление с отсчётом.
 */
object CardTimers {

    const val CHANNEL_RUN = "card_timer_run"
    const val CHANNEL_DONE = "card_timer_done"
    private const val TAG_RUN = "card-timer-"
    private const val TAG_DONE = "card-timer-done-"
    private const val NOTIFICATION_ID = 2
    private const val PREFS = "card_timers"
    private const val KEY = "timers"
    private const val ACCENT = 0xFF8F7FB8.toInt()
    private const val MAX_SECONDS = 359_999L // 99:59:59
    private val ID_RE = Regex("^[A-Za-z0-9]{4,32}$")
    private val VIBRATE_DONE = longArrayOf(0, 400, 200, 400, 200, 800)

    private val LOCK = Any()

    class Timer(
        val id: String,
        val title: String,
        val durationMs: Long,
        val running: Boolean,
        val endAt: Long,        // для идущего: момент окончания (мс, часы устройства)
        val remainingMs: Long   // для приостановленного: сколько осталось
    )

    // ---------- хранилище ----------
    private fun prefs(ctx: Context) = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    private fun load(ctx: Context): MutableMap<String, Timer> {
        val out = LinkedHashMap<String, Timer>()
        try {
            val o = JSONObject(prefs(ctx).getString(KEY, "{}") ?: "{}")
            val it = o.keys()
            while (it.hasNext()) {
                val id = it.next()
                val t = o.optJSONObject(id) ?: continue
                out[id] = Timer(
                    id, t.optString("title", ""), t.optLong("durationMs", 0L), t.optBoolean("running", false),
                    t.optLong("endAt", 0L), t.optLong("remainingMs", 0L)
                )
            }
        } catch (e: Exception) {
            // повреждённая запись — начинаем с пустого списка
        }
        return out
    }

    private fun save(ctx: Context, map: Map<String, Timer>) {
        val o = JSONObject()
        for ((id, t) in map) {
            o.put(
                id,
                JSONObject().put("title", t.title).put("durationMs", t.durationMs).put("running", t.running)
                    .put("endAt", t.endAt).put("remainingMs", t.remainingMs)
            )
        }
        prefs(ctx).edit().putString(KEY, o.toString()).apply()
    }

    /** Снимок для страницы: [{id, title, durationMs, running, endAt, remainingMs, now}]. Закончившиеся убираются. */
    fun listJson(ctx: Context): String = synchronized(LOCK) {
        val now = System.currentTimeMillis()
        val map = load(ctx)
        val arr = JSONArray()
        for (t in map.values) {
            if (t.running && t.endAt <= now) continue // дошёл до конца, но будильник ещё не сработал: страница покажет заданное время
            arr.put(
                JSONObject().put("id", t.id).put("title", t.title).put("durationMs", t.durationMs)
                    .put("running", t.running).put("endAt", t.endAt).put("remainingMs", t.remainingMs).put("now", now)
            )
        }
        arr.toString()
    }

    // ---------- действия ----------
    fun start(ctx: Context, id: String, title: String, seconds: Long): Boolean = synchronized(LOCK) {
        if (!ID_RE.matches(id) || seconds < 1) return false
        val sec = seconds.coerceAtMost(MAX_SECONDS)
        val now = System.currentTimeMillis()
        val t = Timer(id, title.take(200), sec * 1000, true, now + sec * 1000, 0L)
        val map = load(ctx)
        map[id] = t // тот же id — заново
        save(ctx, map)
        scheduleAlarm(ctx, t)
        cancelDone(ctx, id)
        postRunning(ctx, t)
        true
    }

    fun pause(ctx: Context, id: String) = synchronized(LOCK) {
        val map = load(ctx)
        val t = map[id] ?: return@synchronized
        if (!t.running) return@synchronized
        val left = (t.endAt - System.currentTimeMillis()).coerceAtLeast(1000L)
        val p = Timer(id, t.title, t.durationMs, false, 0L, left)
        map[id] = p
        save(ctx, map)
        cancelAlarm(ctx, id)
        postPaused(ctx, p)
    }

    fun resume(ctx: Context, id: String) = synchronized(LOCK) {
        val map = load(ctx)
        val t = map[id] ?: return@synchronized
        if (t.running) return@synchronized
        val r = Timer(id, t.title, t.durationMs, true, System.currentTimeMillis() + t.remainingMs, 0L)
        map[id] = r
        save(ctx, map)
        scheduleAlarm(ctx, r)
        postRunning(ctx, r)
    }

    fun cancel(ctx: Context, id: String) = synchronized(LOCK) {
        val map = load(ctx)
        map.remove(id)
        save(ctx, map)
        cancelAlarm(ctx, id)
        cancelRunning(ctx, id)
    }

    /** Сработал будильник (или телефон включили после срока): убрать «идёт», вибрация, «Таймер закончился». */
    fun fire(ctx: Context, id: String) = synchronized(LOCK) {
        val map = load(ctx)
        val t = map[id] ?: return@synchronized
        if (!t.running) return@synchronized
        val now = System.currentTimeMillis()
        if (t.endAt > now + 2000) { // будильник сработал раньше срока (сдвиг часов): ставим заново
            scheduleAlarm(ctx, t)
            return@synchronized
        }
        map.remove(id)
        save(ctx, map)
        cancelRunning(ctx, id)
        vibrate(ctx)
        postDone(ctx, t)
    }

    /** После перезагрузки, смены времени и обновления приложения: будильники и уведомления — заново. */
    fun restore(ctx: Context) {
        val now = System.currentTimeMillis()
        val items = synchronized(LOCK) { load(ctx).values.toList() }
        for (t in items) {
            if (t.running) {
                if (t.endAt <= now) fire(ctx, t.id) else synchronized(LOCK) { scheduleAlarm(ctx, t); postRunning(ctx, t, false) }
            } else {
                synchronized(LOCK) { postPaused(ctx, t) }
            }
        }
    }

    // ---------- будильник ----------
    private fun fireIntent(ctx: Context, id: String): PendingIntent {
        val intent = Intent(ctx, CardTimerReceiver::class.java).apply {
            action = CardTimerReceiver.ACTION_FIRE
            data = Uri.parse("ltcardtimer://fire/$id")
            putExtra(CardTimerReceiver.EXTRA_ID, id)
        }
        return PendingIntent.getBroadcast(ctx, ("fire$id").hashCode(), intent, Compat.pendingFlags())
    }

    private fun scheduleAlarm(ctx: Context, t: Timer) {
        try {
            ReminderScheduler.setAlarm(ctx, fireIntent(ctx, t.id), t.endAt)
        } catch (e: Exception) {
            // будильник не поставился: отсчёт в шторке идёт, конец увидит страница при открытии
        }
    }

    private fun cancelAlarm(ctx: Context, id: String) {
        try {
            val am = ctx.getSystemService(Context.ALARM_SERVICE) as android.app.AlarmManager
            am.cancel(fireIntent(ctx, id))
        } catch (e: Exception) {
            // будильника уже нет
        }
    }

    // ---------- уведомления ----------
    private fun ensureChannels(ctx: Context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val nm = ctx.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        if (nm.getNotificationChannel(CHANNEL_RUN) == null) {
            val ch = NotificationChannel(CHANNEL_RUN, "Идущие таймеры карточек", NotificationManager.IMPORTANCE_LOW)
            ch.description = "Отсчёт запущенных таймеров карточек"
            ch.setShowBadge(false)
            nm.createNotificationChannel(ch)
        }
        if (nm.getNotificationChannel(CHANNEL_DONE) == null) {
            val ch = NotificationChannel(CHANNEL_DONE, "Таймер карточки закончился", NotificationManager.IMPORTANCE_HIGH)
            ch.description = "Когда таймер карточки дошёл до нуля (вибрация, без звука)"
            ch.enableVibration(false) // вибрирует сам CardTimers.vibrate — даже если уведомления выключены
            ch.setSound(null, null)
            nm.createNotificationChannel(ch)
        }
    }

    private fun actionIntent(ctx: Context, action: String, id: String): PendingIntent {
        val intent = Intent(ctx, CardTimerReceiver::class.java).apply {
            this.action = action
            data = Uri.parse("ltcardtimer://action/${Uri.encode(action)}/$id")
            putExtra(CardTimerReceiver.EXTRA_ID, id)
        }
        return PendingIntent.getBroadcast(ctx, (action + id).hashCode(), intent, Compat.pendingFlags())
    }

    private fun openApp(ctx: Context): PendingIntent {
        val intent = Intent(ctx, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP
        }
        return PendingIntent.getActivity(ctx, 6001, intent, Compat.pendingFlags())
    }

    private fun titleOf(t: Timer) = if (t.title.isBlank()) "Таймер" else t.title

    @SuppressLint("MissingPermission")
    private fun postRunning(ctx: Context, t: Timer, float: Boolean = true) {
        try {
            ensureChannels(ctx)
            val b = NotificationCompat.Builder(ctx, CHANNEL_RUN)
                .setSmallIcon(R.drawable.ic_stat_notify)
                .setColor(ACCENT)
                .setContentTitle(titleOf(t))
                .setCategory(NotificationCompat.CATEGORY_PROGRESS)
                .setPriority(NotificationCompat.PRIORITY_LOW)
                .setOngoing(true)
                .setOnlyAlertOnce(true)
                .setShowWhen(true)
                .setWhen(t.endAt)
                .setUsesChronometer(true)
                .setChronometerCountDown(true)
                .setContentIntent(openApp(ctx))
                .addAction(0, "Пауза", actionIntent(ctx, CardTimerReceiver.ACTION_PAUSE, t.id))
                .addAction(0, "✕ Отмена", actionIntent(ctx, CardTimerReceiver.ACTION_CANCEL, t.id))
            if (Build.VERSION.SDK_INT < Build.VERSION_CODES.N) {
                // до Android 7 обратного хронометра нет: показываем время окончания
                b.setUsesChronometer(false).setContentText("Закончится в " + clock(t.endAt))
            }
            // «Живые обновления» Android 16 / остров HyperOS: просим показать как продвигаемое постоянное уведомление
            // На Xiaomi с HyperOS вместо этого — остров по протоколу Xiaomi (XiaomiIsland); на остальных — флаг Android 16.
            val island = XiaomiIsland.runningExtras(ctx, titleOf(t), t.endAt, float)
            if (island != null) b.addExtras(island)
            else b.addExtras(Bundle().apply { putBoolean("android.requestPromotedOngoing", true) })
            NotificationManagerCompat.from(ctx).notify(TAG_RUN + t.id, NOTIFICATION_ID, b.build())
        } catch (e: Exception) {
            // уведомления выключены: таймер всё равно идёт и завершится вибрацией
        }
    }

    @SuppressLint("MissingPermission")
    private fun postPaused(ctx: Context, t: Timer) {
        try {
            ensureChannels(ctx)
            val b = NotificationCompat.Builder(ctx, CHANNEL_RUN)
                .setSmallIcon(R.drawable.ic_stat_notify)
                .setColor(ACCENT)
                .setContentTitle(titleOf(t))
                .setContentText("Пауза · осталось " + left(t.remainingMs))
                .setCategory(NotificationCompat.CATEGORY_PROGRESS)
                .setPriority(NotificationCompat.PRIORITY_LOW)
                .setOngoing(true)
                .setOnlyAlertOnce(true)
                .setShowWhen(false)
                .setContentIntent(openApp(ctx))
                .addAction(0, "Продолжить", actionIntent(ctx, CardTimerReceiver.ACTION_RESUME, t.id))
                .addAction(0, "✕ Отмена", actionIntent(ctx, CardTimerReceiver.ACTION_CANCEL, t.id))
            XiaomiIsland.pausedExtras(ctx, titleOf(t), left(t.remainingMs))?.let { b.addExtras(it) }
            NotificationManagerCompat.from(ctx).notify(TAG_RUN + t.id, NOTIFICATION_ID, b.build())
        } catch (e: Exception) {
            // уведомления выключены
        }
    }

    @SuppressLint("MissingPermission")
    private fun postDone(ctx: Context, t: Timer) {
        try {
            ensureChannels(ctx)
            val n = NotificationCompat.Builder(ctx, CHANNEL_DONE)
                .setSmallIcon(R.drawable.ic_stat_notify)
                .setColor(ACCENT)
                .setContentTitle("Таймер закончился")
                .setContentText(titleOf(t))
                .setCategory(NotificationCompat.CATEGORY_ALARM)
                .setPriority(NotificationCompat.PRIORITY_HIGH)
                .setAutoCancel(true)
                .setContentIntent(openApp(ctx))
                .build()
            NotificationManagerCompat.from(ctx).notify(TAG_DONE + t.id, NOTIFICATION_ID, n)
        } catch (e: Exception) {
            // уведомления выключены: вибрация уже была
        }
    }

    private fun cancelRunning(ctx: Context, id: String) {
        try {
            NotificationManagerCompat.from(ctx).cancel(TAG_RUN + id, NOTIFICATION_ID)
        } catch (e: Exception) {
            // уведомления уже нет
        }
    }

    private fun cancelDone(ctx: Context, id: String) {
        try {
            NotificationManagerCompat.from(ctx).cancel(TAG_DONE + id, NOTIFICATION_ID)
        } catch (e: Exception) {
            // уведомления уже нет
        }
    }

    @Suppress("DEPRECATION")
    private fun vibrate(ctx: Context) {
        try {
            val v = ctx.getSystemService(Context.VIBRATOR_SERVICE) as? Vibrator ?: return
            if (!v.hasVibrator()) return
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                v.vibrate(VibrationEffect.createWaveform(VIBRATE_DONE, -1))
            } else {
                v.vibrate(VIBRATE_DONE, -1)
            }
        } catch (e: Exception) {
            // вибрации нет или нет разрешения
        }
    }

    private fun clock(at: Long): String = SimpleDateFormat("HH:mm", Locale("ru")).format(Date(at))

    private fun left(ms: Long): String {
        val s = (ms / 1000).coerceAtLeast(0)
        val h = s / 3600
        val m = (s % 3600) / 60
        val sec = s % 60
        return if (h > 0) String.format(Locale.US, "%d:%02d:%02d", h, m, sec) else String.format(Locale.US, "%d:%02d", m, sec)
    }
}
