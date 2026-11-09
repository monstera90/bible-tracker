package com.app.lifetracker
// Версия: 1.2 (08.11)

import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.graphics.Color
import android.media.AudioAttributes
import android.os.Build
import android.os.VibrationEffect
import android.os.Vibrator
import org.json.JSONArray
import org.json.JSONObject
import kotlin.math.PI
import kotlin.math.sin

/**
 * Помодоро-таймер (вкладка «Помодоро», `pomodoro.js`). Состояние лежит в SharedPreferences `pomodoro`, конец фазы — точный
 * будильник ([ReminderScheduler.setAlarm] → [PomodoroReceiver]), поэтому всё работает без открытого приложения.
 *
 * Фазы: работа → короткий перерыв (или длинный после каждого `cycles`-го цикла) → ожидание ([PH_WAIT]: перерыв кончился,
 * человек не вернулся, идёт счёт «сколько уже пауза»). Конец работы переводит в перерыв сам (с «Готово» на 3 с), конец
 * перерыва — в ожидание: работа начинается только по нажатию («Начать работу» / `skip`).
 * «+5 минут» продлевает текущую фазу; в первую минуту перерыва (`UNDO_MS`) возвращает к работе ещё на 5 минут — «в потоке».
 *
 * Показ: вкладка (мост `pomodoro*`), плашка внутри приложения ([InAppIsland], только цвет фазы и время), остров Xiaomi и
 * уведомление ([PomodoroService], [XiaomiIsland.pomodoroExtras]).
 */
object PomodoroTimer {

    const val PH_WORK = 0
    const val PH_SHORT = 1
    const val PH_LONG = 2
    const val PH_WAIT = 3

    const val FLASH_MS = 3000L
    const val UNDO_MS = 60_000L
    const val PLUS_MS = 5L * 60_000L
    const val PULSE_LEFT_MS = 60_000L

    private const val PREFS = "pomodoro"
    private const val KEY = "state"
    private const val ALARM_CODE = 8801

    /** Очередь законченных рабочих отрезков для страницы (календарь и «История»): SharedPreferences `pomodoro` → `done`. */
    private const val DONE_KEY = "done"
    private const val MIN_RECORD_MS = 60_000L // отрезок короче минуты (случайный запуск) не записывается
    private const val MAX_DONE = 200

    class Snapshot(
        val phase: Int,
        val running: Boolean,
        val leftMs: Long,
        val totalMs: Long,
        val overMs: Long,
        val cycle: Int,
        val cycles: Int,
        val task: String,
        val flash: Boolean,
        val undo: Boolean,
        val endAt: Long
    )

    private var loaded = false
    private var active = false
    private var phase = PH_WORK
    private var running = false
    private var endAt = 0L
    private var leftMs = 0L
    private var totalMs = 0L
    private var cycle = 1
    private var cycles = 4
    private var task = ""
    private var workMin = 25
    private var shortMin = 5
    private var longMin = 15
    private var waitSince = 0L
    private var phaseStart = 0L
    private var flashUntil = 0L

    /** Вкладка «Помодоро» сейчас на экране (страница сообщает раз в секунду): плашка в приложении тогда не нужна. */
    @Volatile
    var uiOpen = false

    @Volatile
    private var floatPending = false

    @Volatile
    private var floatDeferred = false

    // ---------- хранение ----------

    private fun load(ctx: Context) {
        if (loaded) return
        loaded = true
        try {
            val s = ctx.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(KEY, null) ?: return
            val o = JSONObject(s)
            active = o.optBoolean("active", false)
            phase = o.optInt("phase", PH_WORK)
            running = o.optBoolean("running", false)
            endAt = o.optLong("endAt", 0L)
            leftMs = o.optLong("leftMs", 0L)
            totalMs = o.optLong("totalMs", 0L)
            cycle = o.optInt("cycle", 1).coerceAtLeast(1)
            cycles = o.optInt("cycles", 4).coerceIn(1, 12)
            task = o.optString("task", "")
            workMin = o.optInt("workMin", 25)
            shortMin = o.optInt("shortMin", 5)
            longMin = o.optInt("longMin", 15)
            waitSince = o.optLong("waitSince", 0L)
            phaseStart = o.optLong("phaseStart", 0L)
            flashUntil = o.optLong("flashUntil", 0L)
        } catch (e: Exception) {
            active = false
        }
    }

    private fun save(ctx: Context) {
        try {
            val o = JSONObject()
                .put("active", active).put("phase", phase).put("running", running)
                .put("endAt", endAt).put("leftMs", leftMs).put("totalMs", totalMs)
                .put("cycle", cycle).put("cycles", cycles).put("task", task)
                .put("workMin", workMin).put("shortMin", shortMin).put("longMin", longMin)
                .put("waitSince", waitSince).put("phaseStart", phaseStart).put("flashUntil", flashUntil)
            ctx.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putString(KEY, o.toString()).apply()
        } catch (e: Exception) {
            // не записалось: сессия живёт в памяти до закрытия процесса
        }
    }

    // ---------- законченные рабочие отрезки ----------

    /**
     * Рабочая фаза закончилась (сама — по сроку, или человек нажал «Завершить» / начал сессию заново): отрезок [phaseStart; [at]]
     * кладётся в очередь. Страница забирает его [takeFinishedJson], пишет в календарь («Трекеры занятий») и в «Историю» и
     * подтверждает [ackFinished]. Вызывать, пока фаза ещё рабочая (до [beginBreakInternal] и до сброса [active]).
     */
    private fun recordWork(ctx: Context, at: Long) {
        if (!active || phase != PH_WORK || phaseStart <= 0L || at - phaseStart < MIN_RECORD_MS) return
        try {
            val prefs = ctx.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            val arr = JSONArray(prefs.getString(DONE_KEY, "[]") ?: "[]")
            val id = "po$phaseStart"
            for (i in 0 until arr.length()) if (arr.optJSONObject(i)?.optString("id") == id) return
            arr.put(JSONObject().put("id", id).put("task", task).put("start", phaseStart).put("end", at))
            val keep = JSONArray()
            for (i in maxOf(0, arr.length() - MAX_DONE) until arr.length()) keep.put(arr.get(i))
            prefs.edit().putString(DONE_KEY, keep.toString()).apply()
        } catch (e: Exception) {
            // отрезок не записался: в календаре и «Истории» его не будет, на сам таймер это не влияет
        }
    }

    /** JSON-массив законченных рабочих отрезков, которые страница ещё не сохранила: [{"id","task","start","end"}] (мс). */
    @Synchronized
    fun takeFinishedJson(ctx: Context): String =
        ctx.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(DONE_KEY, "[]") ?: "[]"

    /** Страница сохранила отрезки с этими id (JSON-массив строк) — убрать их из очереди. */
    @Synchronized
    fun ackFinished(ctx: Context, idsJson: String?) {
        if (idsJson == null) return
        try {
            val ids = HashSet<String>()
            val got = JSONArray(idsJson)
            for (i in 0 until got.length()) ids.add(got.optString(i))
            val prefs = ctx.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            val arr = JSONArray(prefs.getString(DONE_KEY, "[]") ?: "[]")
            val keep = JSONArray()
            for (i in 0 until arr.length()) {
                val o = arr.optJSONObject(i) ?: continue
                if (!ids.contains(o.optString("id"))) keep.put(o)
            }
            prefs.edit().putString(DONE_KEY, keep.toString()).apply()
        } catch (e: Exception) {
            // очередь останется как есть: страница заберёт отрезки при следующем обращении (повторы она отсеивает по id)
        }
    }

    // ---------- будильник конца фазы ----------

    private fun alarmIntent(ctx: Context): PendingIntent {
        val i = Intent(ctx, PomodoroReceiver::class.java).setAction(PomodoroReceiver.ACTION_FIRE)
        return PendingIntent.getBroadcast(ctx, ALARM_CODE, i, Compat.pendingFlags())
    }

    private fun cancelAlarm(ctx: Context) {
        try {
            (ctx.getSystemService(Context.ALARM_SERVICE) as android.app.AlarmManager).cancel(alarmIntent(ctx))
        } catch (e: Exception) {
            // нечего снимать
        }
    }

    private fun schedule(ctx: Context) {
        cancelAlarm(ctx)
        if (!active || !running || phase == PH_WAIT) return
        try {
            ReminderScheduler.setAlarm(ctx, alarmIntent(ctx), endAt)
        } catch (e: Exception) {
            // будильник не поставился: фазу переключит тик службы или открытие приложения
        }
    }

    // ---------- переходы ----------

    private fun beginWork(ctx: Context, at: Long) {
        phase = PH_WORK
        running = true
        totalMs = workMin * 60_000L
        leftMs = totalMs
        endAt = at + totalMs
        phaseStart = at
        waitSince = 0L
        flashUntil = 0L
        floatPending = true
        schedule(ctx)
        save(ctx)
    }

    private fun beginBreakInternal(at: Long, isLong: Boolean) {
        phase = if (isLong) PH_LONG else PH_SHORT
        running = true
        totalMs = (if (isLong) longMin else shortMin) * 60_000L
        leftMs = totalMs
        endAt = at + totalMs
        phaseStart = at
        waitSince = 0L
    }

    @Synchronized
    fun isActive(ctx: Context): Boolean {
        load(ctx)
        return active
    }

    @Synchronized
    fun start(ctx: Context, taskName: String?, work: Int, shortM: Int, longM: Int, cyc: Int) {
        load(ctx)
        recordWork(ctx, System.currentTimeMillis()) // повторный запуск посреди работы: прежний отрезок закрывается
        workMin = work.coerceIn(1, 180)
        shortMin = shortM.coerceIn(1, 60)
        longMin = longM.coerceIn(1, 120)
        cycles = cyc.coerceIn(1, 12)
        task = (taskName ?: "").trim().take(60)
        active = true
        cycle = 1
        beginWork(ctx, System.currentTimeMillis())
        PomodoroService.refresh(ctx)
    }

    /** Конец фазы (будильник или тик службы): работа → перерыв, перерыв → ожидание. Опоздавшие переходы догоняются по порядку. */
    @Synchronized
    fun fire(ctx: Context) {
        load(ctx)
        val now = System.currentTimeMillis()
        var guard = 0
        var changed = false
        while (active && running && phase != PH_WAIT && endAt <= now + 1500L && guard < 8) {
            guard++
            changed = true
            val at = endAt
            val fresh = now - at < 30_000L
            if (phase == PH_WORK) {
                recordWork(ctx, at)
                beginBreakInternal(at, cycle % cycles == 0)
                flashUntil = at + FLASH_MS
            } else {
                val wasLong = phase == PH_LONG
                cycle = if (wasLong) 1 else cycle + 1
                phase = PH_WAIT
                running = true
                totalMs = 0L
                leftMs = 0L
                endAt = 0L
                waitSince = at
                phaseStart = at
                flashUntil = 0L
            }
            if (fresh) {
                floatPending = true
                vibrateSoft(ctx)
            }
        }
        if (changed) {
            schedule(ctx)
            save(ctx)
            PomodoroService.refresh(ctx)
        } else if (active && running && phase != PH_WAIT) {
            schedule(ctx) // сработало раньше срока — ставим заново
        }
    }

    /** Страховка для тика службы: срок вышел, а будильник не пришёл. */
    @Synchronized
    fun checkDue(ctx: Context) {
        load(ctx)
        if (active && running && phase != PH_WAIT && endAt <= System.currentTimeMillis()) fire(ctx)
    }

    @Synchronized
    fun togglePause(ctx: Context) {
        load(ctx)
        if (!active || phase == PH_WAIT) return
        val now = System.currentTimeMillis()
        if (running) {
            leftMs = (endAt - now).coerceAtLeast(0L)
            running = false
            flashUntil = 0L
        } else {
            endAt = now + leftMs
            running = true
        }
        schedule(ctx)
        save(ctx)
        PomodoroService.refresh(ctx)
    }

    @Synchronized
    fun plus5(ctx: Context) {
        load(ctx)
        if (!active || phase == PH_WAIT) return
        val now = System.currentTimeMillis()
        if (phase != PH_WORK && running && now - phaseStart < UNDO_MS) {
            // перерыв только начался, а человек в потоке: возвращаемся к работе ещё на 5 минут
            phase = PH_WORK
            totalMs = PLUS_MS
            leftMs = PLUS_MS
            endAt = now + PLUS_MS
            phaseStart = now
            flashUntil = 0L
        } else if (running) {
            endAt += PLUS_MS
            totalMs += PLUS_MS
        } else {
            leftMs += PLUS_MS
            totalMs += PLUS_MS
        }
        schedule(ctx)
        save(ctx)
        PomodoroService.refresh(ctx)
    }

    /** Пропустить перерыв (или начать работу, когда перерыв уже кончился). Во время работы ничего не делает. */
    @Synchronized
    fun skip(ctx: Context) {
        load(ctx)
        if (!active || phase == PH_WORK) return
        if (phase != PH_WAIT) cycle = if (phase == PH_LONG) 1 else cycle + 1
        beginWork(ctx, System.currentTimeMillis())
        PomodoroService.refresh(ctx)
    }

    @Synchronized
    fun stop(ctx: Context) {
        load(ctx)
        val now = System.currentTimeMillis()
        recordWork(ctx, if (running && endAt > 0L) minOf(now, endAt) else now) // «Завершить» посреди работы: отрезок до этого момента
        active = false
        running = false
        cancelAlarm(ctx)
        save(ctx)
        stopVibration(ctx)
        PomodoroService.stop(ctx)
    }

    /** После перезагрузки/смены времени: будильник заново, опоздавшие переходы догоняются. */
    @Synchronized
    fun restore(ctx: Context) {
        load(ctx)
        if (!active) return
        fire(ctx)
        schedule(ctx)
        PomodoroService.refresh(ctx)
    }

    // ---------- чтение состояния ----------

    @Synchronized
    fun snapshot(ctx: Context): Snapshot? {
        load(ctx)
        if (!active) return null
        val now = System.currentTimeMillis()
        val left = if (phase == PH_WAIT) 0L else if (running) (endAt - now).coerceAtLeast(0L) else leftMs
        val over = if (phase == PH_WAIT) (now - waitSince).coerceAtLeast(0L) else 0L
        val flash = now < flashUntil && phase != PH_WORK
        val undo = phase != PH_WORK && phase != PH_WAIT && running && now - phaseStart < UNDO_MS
        return Snapshot(phase, running, left, totalMs, over, cycle, cycles, task, flash, undo, endAt)
    }

    /** Данные для плашки внутри приложения; null — сессии нет или вкладка «Помодоро» на экране. */
    fun islandInfo(ctx: Context): Snapshot? = if (uiOpen) null else snapshot(ctx)

    /**
     * Очередь за остров Xiaomi: он один на помодоро и таймеры карточек, и тот, чьё уведомление перепоставили последним, выходит
     * на главное место — два тикающих по секунде уведомления дёргали остров туда-сюда. Раз в секунду перепоставляет только
     * «главный»: у кого раньше конец (меньше — главнее). 0 — идёт «Готово» (показать сразу); Long.MAX_VALUE — фаза не идёт
     * (пауза, ожидание после перерыва, сессии нет). Сравнивается с [CardTimers.islandRank].
     */
    fun islandRank(ctx: Context): Long {
        val s = snapshot(ctx) ?: return Long.MAX_VALUE
        if (s.flash) return 0L
        return if (s.running && s.phase != PH_WAIT) s.endAt else Long.MAX_VALUE
    }

    @Synchronized
    fun stateJson(ctx: Context): String {
        load(ctx)
        val o = JSONObject()
            .put("active", active)
            .put("workMin", workMin).put("shortMin", shortMin).put("longMin", longMin).put("cycles", cycles)
            .put("now", System.currentTimeMillis())
        if (active) {
            val name = when (phase) {
                PH_WORK -> "work"
                PH_SHORT -> "short"
                PH_LONG -> "long"
                else -> "wait"
            }
            o.put("phase", name)
                .put("running", running).put("endAt", endAt).put("leftMs", leftMs).put("totalMs", totalMs)
                .put("waitSince", waitSince).put("phaseStart", phaseStart).put("flashUntil", flashUntil)
                .put("cycle", cycle).put("task", task)
        }
        return o.toString()
    }

    // ---------- раскрытие острова ----------

    fun consumeFloat(): Boolean {
        val f = floatPending
        floatPending = false
        // приложение на экране: система остров не показывает, раскрытие пропало впустую — повторим при сворачивании
        if (f && NotifyStore.appForeground) floatDeferred = true
        return f
    }

    /** Приложение ушло с экрана (MainActivity.onPause): перепоставить уведомление, чтобы остров появился (и раскрылся, если надо). */
    fun onAppBackground(ctx: Context) {
        uiOpen = false
        if (!isActive(ctx)) return
        if (floatDeferred) {
            floatDeferred = false
            floatPending = true
        }
        PomodoroService.refresh(ctx.applicationContext)
    }

    // ---------- внешний вид: цвета и тексты (общие для вкладки-подсказок, плашки, острова и уведомления) ----------

    fun baseColor(phase: Int): Int = when (phase) {
        PH_WORK -> 0xFFE24A33.toInt() // насыщенный, собранный
        PH_SHORT -> 0xFF5FBF98.toInt() // мягкий, спокойный
        PH_LONG -> 0xFF7C9FD8.toInt() // ещё спокойнее
        else -> 0xFFD6A24A.toInt() // перерыв кончился, ждём: тёплый и тихий
    }

    private fun blend(a: Int, b: Int, t: Float): Int {
        val k = t.coerceIn(0f, 1f)
        val r = (Color.red(a) + (Color.red(b) - Color.red(a)) * k).toInt()
        val g = (Color.green(a) + (Color.green(b) - Color.green(a)) * k).toInt()
        val bl = (Color.blue(a) + (Color.blue(b) - Color.blue(a)) * k).toInt()
        return Color.rgb(r, g, bl)
    }

    /** Цвет фазы: пауза — приглушённый; «Готово» и последняя минута — лёгкая пульсация (светлее на долю). */
    fun colorFor(s: Snapshot, now: Long): Int {
        val base = baseColor(s.phase)
        if (!s.running && s.phase != PH_WAIT) return blend(base, 0xFF8A8A8A.toInt(), 0.6f)
        if (s.flash) {
            val f = (0.5 + 0.5 * sin(now / 220.0 * PI)).toFloat()
            return blend(base, Color.WHITE, 0.35f * f)
        }
        if (s.phase != PH_WAIT && s.leftMs in 1L..PULSE_LEFT_MS) {
            val f = (0.5 + 0.5 * sin(now / 1000.0 * PI)).toFloat()
            return blend(base, Color.WHITE, 0.28f * f)
        }
        return base
    }

    fun fractionLeft(s: Snapshot): Float =
        if (s.phase == PH_WAIT) 1f else (s.leftMs.toFloat() / s.totalMs.coerceAtLeast(1L)).coerceIn(0f, 1f)

    /** Текст справа на плашке: остаток, «Готово» или сколько уже длится пауза после перерыва. */
    fun pillText(s: Snapshot): String = when {
        s.flash -> "Готово"
        s.phase == PH_WAIT -> "+" + XiaomiIsland.elapsedText(s.overMs)
        else -> XiaomiIsland.clockText(s.leftMs)
    }

    fun label(s: Snapshot): String = when {
        s.flash -> "Готово"
        !s.running && s.phase != PH_WAIT -> "Пауза"
        s.phase == PH_WORK -> "Работа"
        s.phase == PH_SHORT -> "Перерыв"
        s.phase == PH_LONG -> "Длинный перерыв"
        else -> "Перерыв закончился"
    }

    fun cycleText(s: Snapshot): String = "цикл " + s.cycle + " из " + s.cycles

    /** Вторая строка острова и уведомления: задача и цикл — в работе, подсказка — в перерыве. */
    fun detail(s: Snapshot): String {
        val t = if (s.task.isNotEmpty()) s.task + " · " else ""
        return when {
            s.flash -> "Хорошая работа · пора отдохнуть"
            s.phase == PH_WAIT -> "Пора возвращаться · " + cycleText(s)
            !s.running -> "Пауза · " + t + cycleText(s)
            s.phase == PH_SHORT -> "Встань, выпей воды, посмотри вдаль"
            s.phase == PH_LONG -> "Отдохни как следует · до следующего цикла"
            else -> t + cycleText(s)
        }
    }

    // ---------- вибрация конца фазы ----------

    @Suppress("DEPRECATION")
    private fun vibrateSoft(ctx: Context) {
        try {
            val v = ctx.getSystemService(Context.VIBRATOR_SERVICE) as? Vibrator ?: return
            if (!v.hasVibrator()) return
            val timings = longArrayOf(0, 70, 90, 70, 90, 140)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                val effect = if (v.hasAmplitudeControl()) {
                    VibrationEffect.createWaveform(timings, intArrayOf(0, 70, 0, 110, 0, 170), -1)
                } else {
                    VibrationEffect.createWaveform(timings, -1)
                }
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
                v.vibrate(timings, -1)
            }
        } catch (e: Exception) {
            // вибрации нет или нет разрешения
        }
    }

    private fun stopVibration(ctx: Context) {
        try {
            (ctx.getSystemService(Context.VIBRATOR_SERVICE) as? Vibrator)?.cancel()
        } catch (e: Exception) {
            // нечего останавливать
        }
    }
}
