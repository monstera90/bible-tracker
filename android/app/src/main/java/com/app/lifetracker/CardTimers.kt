package com.app.lifetracker
// Версия: 7.0 (30.10)
// Версия: 5.7 (24.10) — скрытый таймер (`Timer.hidden`, `start(..., hidden)`): идёт и срабатывает как обычный, но без уведомления «идёт», острова, плашки в приложении, службы тика и этапов цвета; в конце — обычные вибрация и «Таймер закончился»; `listJson` отдаёт `hidden`. Откат: CardTimers.kt 5.6.
// Версия: 5.6 (24.10) — этапы цвета значка: остался один, красный за 2 минуты до конца (`scheduleStages`); жёлтый убран, но его будильник от прежней версии снимается (`LEGACY_STAGE_YELLOW`). Откат: CardTimers.kt 5.5.
// Версия: 5.5 (22.10) — эксперимент с чёрным фоном уведомления (`setColorized`) откачен: HyperOS не меняет цвет карточки. Прежнее: `tickIsland` не перепоставляет уведомления, пока приложение на экране (`NotifyStore.appForeground`): время тогда показывает плашка внутри приложения, а перепост раз в секунду заставлял настоящий остров всплывать и мигать под ней. Откат: CardTimers.kt 5.2.
// Версия: 5.2 (21.10) — `Info.totalMs` (заданное время, для кольца паузы в плашке). Откат: CardTimers.kt 5.1.
// Версия: 5.1 (21.10) — в раскрытый остров передаётся круглая кнопка паузы (`XiaomiIsland.pauseAction`). Откат: CardTimers.kt 5.0.
// Версия: 5.0 (21.10) — `primaryInfo` (данные главного таймера для плашки InAppIsland). Откат: CardTimers.kt 4.0.
// Версия: 4.0 (21.10) — одно уведомление вместо двух: при работающей службе тика уведомление главного (самого раннего) таймера и есть уведомление службы (`FG_NOTIFICATION_ID`, `primaryId`, `foregroundNotification`, `buildRunning`); в раскрытый остров передаётся кнопка «Стоп» и крупное время. Откат: CardTimers.kt 3.0.
// Версия: 3.0 (21.10) — тик острова: `tickIsland` (раз в секунду перепоставляет уведомления идущих таймеров) и `startTicker` (служба TimerTickService на Xiaomi): свёрнутый остров не тикал сам и показывал одну секунду. Откат: CardTimers.kt 2.0 (вместе с удалением TimerTickService.kt и записи <service>).
// Версия: 2.0 (21.10) — этапы цвета значка острова (жёлтый за 2 минуты, красный за минуту: `scheduleStages`/`stage`, будильники этапов перепостят уведомление); вибрация в конце — 60 секунд (`donePattern`), гасится кнопкой «Стоп» в уведомлении, смахиванием, «Стоп» на карточке и открытием приложения (`silence`/`stopVibration`); в extras острова передаётся полная длительность. Откат: CardTimers.kt 1.1.
// Версия: 1.1 (20.10) — остров Xiaomi (XiaomiIsland): extras `miui.focus.param` в уведомлении таймера.
// Версия: 1.0 (17.10)

import android.annotation.SuppressLint
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.media.AudioAttributes
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
    const val FG_NOTIFICATION_ID = 3 // уведомление главного таймера, пока работает служба тика (оно же её уведомление переднего плана)
    private const val PREFS = "card_timers"
    private const val KEY = "timers"
    private const val ACCENT = 0xFF8F7FB8.toInt()
    private const val MAX_SECONDS = 359_999L // 99:59:59
    private val ID_RE = Regex("^[A-Za-z0-9]{4,32}$")
    private const val VIBRATE_TOTAL_MS = 60_000L // вибрация после срабатывания — 60 секунд (или до «Стоп»)
    private val VIBRATE_CYCLE = longArrayOf(400, 200, 400, 200, 800, 1000) // прежний рисунок «три удара» + пауза, 3 с

    private val LOCK = Any()

    class Timer(
        val id: String,
        val title: String,
        val durationMs: Long,
        val running: Boolean,
        val endAt: Long,        // для идущего: момент окончания (мс, часы устройства)
        val remainingMs: Long,  // для приостановленного: сколько осталось
        val hidden: Boolean = false, // скрытый таймер: ни острова, ни плашки, ни уведомления «идёт» (только конец)
        val dismissed: Boolean = false // уведомление смахнули: таймер идёт, но остров, уведомление и плашка в приложении больше не показываются
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
                    t.optLong("endAt", 0L), t.optLong("remainingMs", 0L), t.optBoolean("hidden", false),
                    t.optBoolean("dismissed", false)
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
                    .put("endAt", t.endAt).put("remainingMs", t.remainingMs).put("hidden", t.hidden)
                    .put("dismissed", t.dismissed)
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
                    .put("hidden", t.hidden)
            )
        }
        arr.toString()
    }

    /** Сколько таймер уже насчитал (без времени на паузе); у дошедшего до конца — всё заданное время. */
    private fun elapsedMs(t: Timer, now: Long): Long {
        val left = if (t.running) (t.endAt - now) else t.remainingMs
        return (t.durationMs - left.coerceAtLeast(0L)).coerceIn(0L, t.durationMs)
    }

    // ---------- действия ----------
    fun start(ctx: Context, id: String, title: String, seconds: Long, hidden: Boolean = false): Boolean = synchronized(LOCK) {
        if (!ID_RE.matches(id) || seconds < 1) return false
        val sec = seconds.coerceAtMost(MAX_SECONDS)
        val now = System.currentTimeMillis()
        val t = Timer(id, title.take(200), sec * 1000, true, now + sec * 1000, 0L, hidden)
        val map = load(ctx)
        map[id]?.let { ScreenTimeStats.add(ctx, ScreenTimeStats.TIMERS, elapsedMs(it, now)) } // перезапуск: прежний отсчёт тоже считается
        map[id] = t // тот же id — заново
        save(ctx, map)
        scheduleAlarm(ctx, t)
        silence(ctx, id) // новый запуск гасит вибрацию и уведомление «Таймер закончился»
        postRunning(ctx, t)
        if (!hidden) startTicker(ctx)
        true
    }

    fun pause(ctx: Context, id: String) = synchronized(LOCK) {
        val map = load(ctx)
        val t = map[id] ?: return@synchronized
        if (!t.running) return@synchronized
        val left = (t.endAt - System.currentTimeMillis()).coerceAtLeast(1000L)
        val p = Timer(id, t.title, t.durationMs, false, 0L, left, t.hidden, t.dismissed)
        map[id] = p
        save(ctx, map)
        cancelAlarm(ctx, id)
        postPaused(ctx, p)
    }

    fun resume(ctx: Context, id: String) = synchronized(LOCK) {
        val map = load(ctx)
        val t = map[id] ?: return@synchronized
        if (t.running) return@synchronized
        val r = Timer(id, t.title, t.durationMs, true, System.currentTimeMillis() + t.remainingMs, 0L, t.hidden, false) // «Продолжить» снова показывает остров
        map[id] = r
        save(ctx, map)
        scheduleAlarm(ctx, r)
        postRunning(ctx, r)
        if (!r.hidden) startTicker(ctx)
    }

    fun cancel(ctx: Context, id: String) = synchronized(LOCK) {
        val map = load(ctx)
        map.remove(id)?.let { ScreenTimeStats.add(ctx, ScreenTimeStats.TIMERS, elapsedMs(it, System.currentTimeMillis())) }
        save(ctx, map)
        cancelAlarm(ctx, id)
        cancelRunning(ctx, id)
        silence(ctx, id) // «Стоп» гасит и вибрацию закончившегося таймера, и уведомление «Таймер закончился»
    }

    /**
     * Уведомление таймера смахнули (deleteIntent): таймер продолжает идти и сработает как обычно, но остров Xiaomi,
     * уведомление и плашка внутри приложения (`primaryInfo`) для него больше не показываются. Новый запуск и «Продолжить» возвращают их.
     */
    fun dismissed(ctx: Context, id: String) = synchronized(LOCK) {
        val map = load(ctx)
        val t = map[id] ?: return@synchronized
        if (t.dismissed) return@synchronized
        map[id] = Timer(t.id, t.title, t.durationMs, t.running, t.endAt, t.remainingMs, t.hidden, true)
        save(ctx, map)
        cancelRunning(ctx, id) // если система уже вернула уведомление на место — убрать
    }

    /** Погасить вибрацию конца и убрать уведомление «Таймер закончился» (кнопка «Стоп» в нём, смахивание, открытие приложения). */
    fun silence(ctx: Context, id: String) {
        stopVibration(ctx)
        cancelDone(ctx, id)
    }

    /** Сработал будильник этапа (за 2 минуты / за минуту до конца): уведомление перепоставляется — значок меняет цвет. */
    fun stage(ctx: Context, id: String) = synchronized(LOCK) {
        val t = load(ctx)[id] ?: return@synchronized
        if (t.hidden || t.dismissed || !t.running || t.endAt <= System.currentTimeMillis()) return@synchronized
        postRunning(ctx, t, false)
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
        ScreenTimeStats.add(ctx, ScreenTimeStats.TIMERS, t.durationMs) // сработал: насчитал всё заданное время
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
                if (t.endAt <= now) fire(ctx, t.id) else synchronized(LOCK) { scheduleAlarm(ctx, t); postRunning(ctx, t, false) }.also { if (!t.hidden) startTicker(ctx) }
            } else {
                synchronized(LOCK) { postPaused(ctx, t) }
            }
        }
    }

    /** Служба тика нужна только острову Xiaomi; на других телефонах отсчёт в шторке идёт сам. */
    private fun startTicker(ctx: Context) {
        if (XiaomiIsland.available(ctx)) TimerTickService.ensure(ctx)
    }

    /**
     * Тик из TimerTickService: перепоставляет уведомления идущих таймеров (остров получает свежее время).
     * Возвращает задержку до следующего тика в мс или -1, если идущих таймеров нет (служба остановится).
     */
    fun tickIsland(ctx: Context): Long = synchronized(LOCK) {
        val now = System.currentTimeMillis()
        var next = -1L
        for (t in load(ctx).values) {
            if (t.hidden || t.dismissed || !t.running || t.endAt <= now) continue // скрытый таймер и таймер со смахнутым уведомлением уведомления «идёт» не имеют
            if (!NotifyStore.appForeground) postRunning(ctx, t, false)
            if (next < 0) next = (t.endAt - now) % 1000L + 20L
        }
        next
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

    private fun stageIntent(ctx: Context, id: String, stage: Int): PendingIntent {
        val intent = Intent(ctx, CardTimerReceiver::class.java).apply {
            action = CardTimerReceiver.ACTION_STAGE
            data = Uri.parse("ltcardtimer://stage/$id/$stage")
            putExtra(CardTimerReceiver.EXTRA_ID, id)
        }
        return PendingIntent.getBroadcast(ctx, ("stage$stage$id").hashCode(), intent, Compat.pendingFlags())
    }

    private fun scheduleAlarm(ctx: Context, t: Timer) {
        try {
            ReminderScheduler.setAlarm(ctx, fireIntent(ctx, t.id), t.endAt)
        } catch (e: Exception) {
            // будильник не поставился: отсчёт в шторке идёт, конец увидит страница при открытии
        }
        if (!t.hidden) scheduleStages(ctx, t) // этапы нужны только значку острова, у скрытого таймера его нет
    }

    /** Будильник смены цвета значка на красный: за 2 минуты до конца (если он ещё впереди). */
    private fun scheduleStages(ctx: Context, t: Timer) {
        val now = System.currentTimeMillis()
        val stages = listOf(XiaomiIsland.STAGE_RED to XiaomiIsland.RED_MS)
        for ((stage, lead) in stages) {
            val at = t.endAt - lead
            if (at <= now + 500) continue
            try {
                ReminderScheduler.setAlarm(ctx, stageIntent(ctx, t.id, stage), at)
            } catch (e: Exception) {
                // этап не поставился: значок просто не сменит цвет, отсчёт и конец работают
            }
        }
    }

    private const val LEGACY_STAGE_YELLOW = 1

    private fun cancelAlarm(ctx: Context, id: String) {
        try {
            val am = ctx.getSystemService(Context.ALARM_SERVICE) as android.app.AlarmManager
            am.cancel(fireIntent(ctx, id))
            am.cancel(stageIntent(ctx, id, LEGACY_STAGE_YELLOW)) // жёлтого этапа больше нет; снимаем будильник, поставленный прежней версией
            am.cancel(stageIntent(ctx, id, XiaomiIsland.STAGE_RED))
        } catch (e: Exception) {
            // будильников уже нет
        }
    }

    // ---------- уведомления ----------
    fun ensureChannels(ctx: Context) {
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
            addFlags(Intent.FLAG_RECEIVER_FOREGROUND)
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

    /** Идущий таймер, чьё уведомление служит уведомлением службы тика: тот, что закончится раньше всех. */
    private fun primaryId(ctx: Context): String? = synchronized(LOCK) {
        val now = System.currentTimeMillis()
        load(ctx).values.filter { !it.hidden && !it.dismissed && it.running && it.endAt > now }.minByOrNull { it.endAt }?.id
    }

    class Info(val id: String, val title: String, val running: Boolean, val leftMs: Long, val totalMs: Long = 0L)

    /** Главный таймер для плашки в приложении: самый ранний из идущих, иначе первый приостановленный; null — таймеров нет. */
    fun primaryInfo(ctx: Context): Info? = synchronized(LOCK) {
        val now = System.currentTimeMillis()
        val all = load(ctx).values.filter { !it.hidden && !it.dismissed } // скрытые и смахнутые таймеры в плашке приложения не показываются
        val run = all.filter { it.running && it.endAt > now }.minByOrNull { it.endAt }
        if (run != null) return@synchronized Info(run.id, titleOf(run), true, run.endAt - now, run.durationMs)
        val p = all.firstOrNull { !it.running } ?: return@synchronized null
        Info(p.id, titleOf(p), false, p.remainingMs, p.durationMs)
    }

    /** Для службы тика: готовое уведомление главного таймера (или null, если идущих нет). */
    fun foregroundNotification(ctx: Context): Notification? = synchronized(LOCK) {
        val id = primaryId(ctx) ?: return@synchronized null
        val t = load(ctx)[id] ?: return@synchronized null
        buildRunning(ctx, t, false)
    }

    private fun buildRunning(ctx: Context, t: Timer, float: Boolean): Notification? {
        return try {
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
                .setDeleteIntent(actionIntent(ctx, CardTimerReceiver.ACTION_DISMISSED, t.id))
                .addAction(0, "Пауза", actionIntent(ctx, CardTimerReceiver.ACTION_PAUSE, t.id))
                .addAction(0, "✕ Отмена", actionIntent(ctx, CardTimerReceiver.ACTION_CANCEL, t.id))
            if (Build.VERSION.SDK_INT < Build.VERSION_CODES.N) {
                // до Android 7 обратного хронометра нет: показываем время окончания
                b.setUsesChronometer(false).setContentText("Закончится в " + clock(t.endAt))
            }
            // «Живые обновления» Android 16 / остров HyperOS: просим показать как продвигаемое постоянное уведомление
            // На Xiaomi с HyperOS вместо этого — остров по протоколу Xiaomi (XiaomiIsland); на остальных — флаг Android 16.
            val stop = if (XiaomiIsland.available(ctx)) XiaomiIsland.stopAction(actionIntent(ctx, CardTimerReceiver.ACTION_CANCEL, t.id)) else null
            val now = System.currentTimeMillis()
            val pause = if (stop != null) XiaomiIsland.pauseAction(
                actionIntent(ctx, CardTimerReceiver.ACTION_PAUSE, t.id), t.endAt - now, t.durationMs, XiaomiIsland.stageFor(t.endAt - now)
            ) else null
            val island = XiaomiIsland.runningExtras(ctx, titleOf(t), t.endAt, t.durationMs, float, stop, pause)
            if (island != null) b.addExtras(island)
            else b.addExtras(Bundle().apply { putBoolean("android.requestPromotedOngoing", true) })
            b.build()
        } catch (e: Exception) {
            null
        }
    }

    @SuppressLint("MissingPermission")
    private fun postRunning(ctx: Context, t: Timer, float: Boolean = true) {
        if (t.hidden || t.dismissed) return // скрытый таймер и таймер со смахнутым уведомлением: уведомления «идёт» нет
        try {
            val n = buildRunning(ctx, t, float) ?: return
            val nm = NotificationManagerCompat.from(ctx)
            if (TimerTickService.active && t.id == primaryId(ctx)) {
                // главный таймер живёт в уведомлении службы тика — второго уведомления не будет
                nm.notify(FG_NOTIFICATION_ID, n)
                nm.cancel(TAG_RUN + t.id, NOTIFICATION_ID)
            } else {
                nm.notify(TAG_RUN + t.id, NOTIFICATION_ID, n)
            }
        } catch (e: Exception) {
            // уведомления выключены: таймер всё равно идёт и завершится вибрацией
        }
    }

    @SuppressLint("MissingPermission")
    private fun postPaused(ctx: Context, t: Timer) {
        if (t.hidden || t.dismissed) return
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
                .setDeleteIntent(actionIntent(ctx, CardTimerReceiver.ACTION_DISMISSED, t.id))
                .addAction(0, "Продолжить", actionIntent(ctx, CardTimerReceiver.ACTION_RESUME, t.id))
                .addAction(0, "✕ Отмена", actionIntent(ctx, CardTimerReceiver.ACTION_CANCEL, t.id))
            XiaomiIsland.pausedExtras(ctx, titleOf(t), left(t.remainingMs), t.remainingMs)?.let { b.addExtras(it) }
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
                .setContentIntent(actionIntent(ctx, CardTimerReceiver.ACTION_STOP_VIBRATE, t.id))
                .setDeleteIntent(actionIntent(ctx, CardTimerReceiver.ACTION_STOP_VIBRATE, t.id))
                .addAction(0, "Стоп", actionIntent(ctx, CardTimerReceiver.ACTION_STOP_VIBRATE, t.id))
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

    /** Рисунок вибрации на VIBRATE_TOTAL_MS: пауза 0 и повторы VIBRATE_CYCLE, пока не наберётся 60 секунд. */
    private fun donePattern(): LongArray {
        val reps = (VIBRATE_TOTAL_MS / VIBRATE_CYCLE.sum()).toInt().coerceAtLeast(1)
        val out = LongArray(1 + VIBRATE_CYCLE.size * reps)
        for (r in 0 until reps) for (i in VIBRATE_CYCLE.indices) out[1 + r * VIBRATE_CYCLE.size + i] = VIBRATE_CYCLE[i]
        return out
    }

    @Suppress("DEPRECATION")
    private fun vibrate(ctx: Context) {
        try {
            val v = ctx.getSystemService(Context.VIBRATOR_SERVICE) as? Vibrator ?: return
            if (!v.hasVibrator()) return
            val pattern = donePattern()
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                val effect = VibrationEffect.createWaveform(pattern, -1)
                try {
                    // как у будильника: вибрирует и в беззвучном режиме
                    val attrs = AudioAttributes.Builder()
                        .setUsage(AudioAttributes.USAGE_ALARM)
                        .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                        .build()
                    v.vibrate(effect, attrs)
                } catch (e: Exception) {
                    v.vibrate(effect)
                }
            } else {
                v.vibrate(pattern, -1)
            }
        } catch (e: Exception) {
            // вибрации нет или нет разрешения
        }
    }

    /** Оборвать идущую вибрацию конца (кнопка «Стоп», смахивание уведомления, открытие приложения). */
    fun stopVibration(ctx: Context) {
        try {
            (ctx.getSystemService(Context.VIBRATOR_SERVICE) as? Vibrator)?.cancel()
        } catch (e: Exception) {
            // нечего останавливать
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
