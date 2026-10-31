package com.app.lifetracker
// Версия: 3.0 (31.10)

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import kotlin.math.asin
import kotlin.math.cos
import kotlin.math.pow
import kotlin.math.sin
import kotlin.math.sqrt

/**
 * Вкладка «Тренировки»: состояние одной записи тренировки (бег) по GPS. Данные приходят от [WorkoutService]
 * (LocationListener и GnssStatus), состояние читает мост ([NativeBridge.workoutState]) и уведомление службы.
 *
 * Как считается:
 *  • «Поиск спутников» (SEARCH) — время тренировки НЕ идёт. Первая точка с точностью не хуже [ACC_MAX] — «Связь установлена»,
 *    с этого момента идёт время.
 *  • RUN: время делится на okMs (километраж учитывается) и lostMs (связи нет — километраж не учитывается). Связь считается
 *    потерянной, если годной точки нет дольше [LOSS_MS]; разрыв начинается с последней годной точки и заканчивается,
 *    когда годная точка появилась снова. Участок маршрута между потерей и возвратом в километраж не входит (после
 *    возврата начинается новый сегмент, расстояние от старой точки до новой не добавляется — ничего не выдумываем).
 *  • Выбросы GPS. Точка, до которой от последней принятой нужно было бы бежать быстрее [MAX_SPEED], в маршрут не попадает,
 *    сколько бы времени ни прошло: она становится «кандидатом». Если следующие точки возвращаются на маршрут — кандидат был
 *    выбросом и просто выброшен. Если же [JUMP_CONFIRM] точек подряд согласованы между собой, а на маршрут не стыкуются
 *    (GPS «уехал» в сторону и держится там), начинается новый сегмент: расстояние от старой точки до новой не добавляется,
 *    а путь внутри сдвинутого участка считается как обычно. Число таких случаев — `jumps` в записи.
 *  • PAUSE — время и километраж стоят; GPS продолжает работать, чтобы связь не терялась на паузе.
 *  • Общее время = okMs + lostMs.
 *  • При остановке (FINISH) маршрут по сегментам сопоставляется с картой OpenStreetMap (map matching, публичный сервер
 *    Valhalla, пешеходный профиль); если сервис недоступен или результат неправдоподобен — остаётся расстояние по GPS.
 *    Готовая запись кладётся в SharedPreferences `workouts_native` (ключ `finished`), страница забирает её
 *    (`takeFinishedJson` / `ackFinished`) — даже если приложение было закрыто, когда тренировка закончилась.
 */
object WorkoutTracker {

    const val ST_IDLE = 0
    const val ST_SEARCH = 1
    const val ST_RUN = 2
    const val ST_PAUSE = 3
    const val ST_FINISH = 4

    /** Точка годна, если её точность не хуже этого значения (метры). */
    private const val ACC_MAX = 20f

    /** Нет годной точки дольше этого времени — связь потеряна (мс). */
    private const val LOSS_MS = 10_000L

    /** Шаг короче этого значения не считается (дрожание GPS на месте), метры. */
    private const val MIN_STEP_M = 3.0

    /** Скорость выше этого значения — не бег, а ошибка GPS: точка в маршрут не попадает (м/с, 9 м/с = 32 км/ч). */
    private const val MAX_SPEED = 9.0

    /** Сколько подряд согласованных между собой точек, не стыкующихся с маршрутом, считать устойчивым сдвигом: новый сегмент. */
    private const val JUMP_CONFIRM = 5

    /** При проверке скорости время между точками берётся не меньше DT_MIN (дрожание при частых точках), секунды. */
    private const val DT_MIN = 1.5

    /** Для точек-кандидатов время между ними ограничено этим значением (с), чтобы «подождать — и пройдёт» не работало. */
    private const val DT_CAND = 10.0

    /** После паузы связь считается сохранённой, если годная точка была не раньше этого времени назад (мс). */
    private const val FRESH_MS = 5_000L

    /** Сколько после «Связь установлена» держать надпись на острове (мс). */
    const val CONNECTED_BANNER_MS = 6_000L

    private const val PREFS = "workouts_native"
    private const val KEY_FINISHED = "finished"

    // Сопоставление с картой: публичный сервер Valhalla (данные OpenStreetMap), пешеходный профиль.
    private const val MATCH_URL = "https://valhalla1.openstreetmap.de/trace_route"
    private const val MATCH_CHUNK = 400          // точек в одном запросе
    private const val MATCH_MIN_STEP_M = 8.0     // точки гуще этого шага перед отправкой прореживаются
    private const val MATCH_MIN_SEG_M = 40.0     // короче — сегмент не сопоставляется
    private const val MATCH_RATIO_LO = 0.85      // результат принимается, если лежит в этих пределах от расстояния по GPS
    private const val MATCH_RATIO_HI = 1.20

    /** Снимок состояния для моста и уведомления. */
    class Snapshot(
        val status: Int,
        val fix: Boolean,
        val sat: Int,
        val satTotal: Int,
        val totalMs: Long,
        val lostMs: Long,
        val distM: Double,
        val startedAt: Long,
        val gaps: List<LongArray>,
        val connectedBanner: Boolean
    )

    private val lock = Any()

    @Volatile
    var status = ST_IDLE
        private set

    private var sat = -1
    private var satTotal = -1
    private var beganAt = 0L
    private var startedAt = 0L
    private var okMs = 0L
    private var lostMs = 0L
    private var fix = false
    private var lastGoodAt = 0L
    private var gapStart = 0L
    private var lastTickAt = 0L
    private var distM = 0.0
    private val gaps = ArrayList<LongArray>()
    private val segments = ArrayList<ArrayList<DoubleArray>>()
    private var curSeg: ArrayList<DoubleArray>? = null
    private var lastPt: DoubleArray? = null
    private var lastPtT = 0L                        // время последней точки, стыкующейся с маршрутом (в том числе не прибавившей метры)
    private val cand = ArrayList<DoubleArray>()      // точки, не стыкующиеся с маршрутом (возможный выброс или сдвиг)
    private var jumps = 0                            // сколько раз GPS «уезжал» (выброс или сдвиг), за тренировку

    // раскрыть остров при ближайшем обновлении уведомления (старт и «Связь установлена»)
    private var floatPending = false
    private var floatDeferred = false

    /** Нужно ли раскрыть остров при ближайшем обновлении уведомления (читается один раз на событие). */
    fun consumeFloat(): Boolean {
        synchronized(lock) {
            val f = floatPending
            floatPending = false
            // приложение на экране: система остров не показывает, раскрытие пропало впустую — повторим при сворачивании
            if (f && NotifyStore.appForeground) floatDeferred = true
            return f
        }
    }

    /** Приложение ушло с экрана: перепоставить уведомление, раскрыв остров, если раскрытие пришлось на время «на экране». */
    fun onAppBackground(ctx: Context) {
        val live = synchronized(lock) {
            if (status == ST_IDLE) false else {
                if (floatDeferred) {
                    floatDeferred = false
                    floatPending = true
                }
                true
            }
        }
        if (live) WorkoutService.refresh(ctx.applicationContext)
    }

    // ---------- управление ----------

    /** Начать запись: «Поиск спутников». false — уже идёт. */
    fun begin(): Boolean {
        synchronized(lock) {
            if (status != ST_IDLE) return false
            val now = System.currentTimeMillis()
            status = ST_SEARCH
            sat = -1
            satTotal = -1
            beganAt = now
            startedAt = 0L
            okMs = 0L
            lostMs = 0L
            fix = false
            lastGoodAt = 0L
            gapStart = 0L
            lastTickAt = now
            distM = 0.0
            gaps.clear()
            segments.clear()
            curSeg = null
            lastPt = null
            lastPtT = 0L
            cand.clear()
            jumps = 0
            floatPending = true
            floatDeferred = false
            ComboGroup.onWorkoutBegin() // старт внутри окна сбора комбо (или ожидаемый им) — участник группы
            return true
        }
    }

    /**
     * Пауза / продолжить. Тренировка из группы комбо ставит на паузу (продолжает) всю группу;
     * [propagate] = false — когда это делает сама группа.
     */
    fun togglePause(propagate: Boolean = true) {
        var paused: Boolean? = null
        synchronized(lock) {
            val now = System.currentTimeMillis()
            if (status == ST_RUN) {
                accountTo(now)
                if (!fix) gaps.add(longArrayOf(gapStart, now)) // разрыв закрывается на паузе
                status = ST_PAUSE
                curSeg = null
                lastPt = null
                cand.clear()
                paused = true
            } else if (status == ST_PAUSE) {
                status = ST_RUN
                lastTickAt = now
                fix = lastGoodAt > 0 && now - lastGoodAt <= FRESH_MS
                if (!fix) gapStart = now
                curSeg = null
                lastPt = null
                cand.clear()
                paused = false
            }
        }
        if (propagate) {
            val p = paused
            if (p == true) ComboGroup.onWorkoutPaused() else if (p == false) ComboGroup.onWorkoutResumed()
        }
    }

    /** Команды группы комбо (ComboGroup): без обратной рассылки. */
    fun groupPause(ctx: Context) {
        if (status != ST_RUN) return
        togglePause(false)
        WorkoutService.refresh(ctx.applicationContext)
    }

    fun groupResume(ctx: Context) {
        if (status != ST_PAUSE) return
        togglePause(false)
        WorkoutService.refresh(ctx.applicationContext)
    }

    fun groupStop(ctx: Context) {
        stop(ctx, false)
        WorkoutService.refresh(ctx.applicationContext)
    }

    /**
     * Остановить запись. Если связи не было ни разу (SEARCH) — записи нет, возвращает false. Иначе запускает фоновое
     * сопоставление с картой; по готовности запись попадает в `finished`, статус возвращается в IDLE.
     */
    fun stop(ctx: Context, propagate: Boolean = true): Boolean {
        val app = ctx.applicationContext
        if (propagate) ComboGroup.onWorkoutStopped() // тренировка из группы комбо останавливает всю группу
        ComboGroup.leaveWorkout()
        val rec: Rec? = synchronized(lock) {
            val now = System.currentTimeMillis()
            if (status == ST_SEARCH) {
                status = ST_IDLE
                null
            } else if (status != ST_RUN && status != ST_PAUSE) {
                null
            } else {
                if (status == ST_RUN) {
                    accountTo(now)
                    if (!fix) gaps.add(longArrayOf(gapStart, now))
                }
                status = ST_FINISH
                val copy = ArrayList<List<DoubleArray>>()
                segments.forEach { copy.add(ArrayList(it)) }
                Rec(startedAt, now, okMs + lostMs, lostMs, ArrayList(gaps), distM, copy, jumps)
            }
        }
        if (rec == null) return false
        Thread {
            val done = try {
                finish(app, rec)
            } catch (e: Exception) {
                rec.toJson(rec.rawM, "raw")
            }
            try {
                appendFinished(app, done)
            } catch (e: Exception) {
                // запись не сохранилась: хуже всего, но служба всё равно должна остановиться
            }
            synchronized(lock) { status = ST_IDLE }
            WorkoutService.refresh(app)
        }.start()
        return true
    }

    // ---------- данные от службы ----------

    fun setSats(used: Int, total: Int) {
        synchronized(lock) {
            sat = used
            satTotal = total
        }
    }

    /** Новая точка GPS. */
    fun onLocation(lat: Double, lon: Double, acc: Float, hasAcc: Boolean) {
        synchronized(lock) {
            val now = System.currentTimeMillis()
            val good = hasAcc && acc <= ACC_MAX
            when (status) {
                ST_SEARCH -> {
                    if (!good) return
                    status = ST_RUN
                    startedAt = now
                    lastTickAt = now
                    fix = true
                    lastGoodAt = now
                    floatPending = true // «Связь установлена» — раскрыть остров
                    startSegment(lat, lon, now)
                }
                ST_PAUSE -> {
                    if (good) lastGoodAt = now
                }
                ST_RUN -> {
                    if (!good) return
                    accountTo(now) // время до этого момента относится к прежнему состоянию (связь была/не было)
                    lastGoodAt = now
                    if (!fix) {
                        gaps.add(longArrayOf(gapStart, now))
                        fix = true
                        floatPending = true
                        startSegment(lat, lon, now)
                    } else {
                        addPoint(lat, lon, now)
                    }
                }
                else -> {}
            }
        }
    }

    /** Раз в секунду: досчитать время и заметить потерю связи. */
    fun tick() {
        synchronized(lock) {
            if (status != ST_RUN) return
            val now = System.currentTimeMillis()
            accountTo(now)
            if (fix && now - lastGoodAt > LOSS_MS) {
                // связь потеряна: разрыв начался с последней годной точки, время с неё переносится в «не учитывалось»
                val back = (now - lastGoodAt).coerceAtMost(okMs)
                okMs -= back
                lostMs += back
                fix = false
                gapStart = lastGoodAt
                curSeg = null
                lastPt = null
                cand.clear()
                floatPending = true
            }
        }
    }

    fun snapshot(): Snapshot {
        synchronized(lock) {
            val now = System.currentTimeMillis()
            var ok = okMs
            var lost = lostMs
            if (status == ST_RUN) {
                val d = (now - lastTickAt).coerceAtLeast(0L)
                if (fix) ok += d else lost += d
            }
            val g = ArrayList<LongArray>(gaps)
            if (status == ST_RUN && !fix) g.add(longArrayOf(gapStart, now))
            val banner = status == ST_RUN && fix && startedAt > 0 && now - startedAt < CONNECTED_BANNER_MS
            return Snapshot(status, fix, sat, satTotal, ok + lost, lost, distM, startedAt, g, banner)
        }
    }

    /** JSON для страницы: состояние записи. */
    fun stateJson(ctx: Context): String {
        val s = snapshot()
        val name = when (s.status) {
            ST_SEARCH -> "searching"
            ST_RUN -> "running"
            ST_PAUSE -> "paused"
            ST_FINISH -> "finishing"
            else -> "idle"
        }
        val gaps = JSONArray()
        s.gaps.forEach { gaps.put(JSONArray().put(it[0]).put(it[1])) }
        return JSONObject()
            .put("status", name)
            .put("fix", s.fix)
            .put("sat", s.sat)
            .put("satTotal", s.satTotal)
            .put("totalMs", s.totalMs)
            .put("lostMs", s.lostMs)
            .put("distM", s.distM)
            .put("startedAt", s.startedAt)
            .put("gaps", gaps)
            .put("pending", pendingCount(ctx))
            .toString()
    }

    // ---------- внутреннее ----------

    private fun accountTo(now: Long) {
        if (status != ST_RUN) return
        val d = now - lastTickAt
        if (d > 0) {
            if (fix) okMs += d else lostMs += d
        }
        lastTickAt = now
    }

    private fun startSegment(lat: Double, lon: Double, t: Long) {
        val seg = ArrayList<DoubleArray>()
        val p = doubleArrayOf(lat, lon, t.toDouble())
        seg.add(p)
        segments.add(seg)
        curSeg = seg
        lastPt = p
        lastPtT = t
        cand.clear()
    }

    /** Можно ли добраться от точки a (время at, мс) до (lat, lon, t) не быстрее [MAX_SPEED]; время между точками зажато в [DT_MIN]..maxDt. */
    private fun stepOk(a: DoubleArray, at: Long, lat: Double, lon: Double, t: Long, maxDt: Double): Boolean {
        val dt = ((t - at) / 1000.0).coerceIn(DT_MIN, maxDt)
        return haversine(a[0], a[1], lat, lon) <= MAX_SPEED * dt
    }

    private fun addPoint(lat: Double, lon: Double, t: Long) {
        val seg = curSeg
        val prev = lastPt
        if (seg == null || prev == null) {
            startSegment(lat, lon, t)
            return
        }
        val p = doubleArrayOf(lat, lon, t.toDouble())
        // 1) Уже есть кандидат (точка, не стыковавшаяся с маршрутом). Если новая точка согласована с ним, она принадлежит
        //    тому же «уехавшему» участку и к маршруту присоединиться не может — сколько бы времени ни прошло.
        if (cand.isNotEmpty()) {
            val c = cand[cand.size - 1]
            if (stepOk(c, c[2].toLong(), lat, lon, t, DT_CAND)) {
                cand.add(p)
                if (cand.size >= JUMP_CONFIRM) acceptJump()
                return
            }
        }
        // 2) Стыкуется с маршрутом: бег от последней точки маршрута возможен. Кандидат (если был) оказался выбросом.
        if (stepOk(prev, lastPtT, lat, lon, t, 3600.0)) {
            if (cand.isNotEmpty()) {
                jumps++
                cand.clear()
            }
            lastPtT = t
            val d = haversine(prev[0], prev[1], lat, lon)
            if (d < MIN_STEP_M) return
            distM += d
            seg.add(p)
            lastPt = p
            return
        }
        // 3) Не стыкуется ни с маршрутом, ни с кандидатом: новый кандидат (прежний был одиночным выбросом).
        if (cand.isNotEmpty()) jumps++
        cand.clear()
        cand.add(p)
    }

    /** Устойчивый сдвиг: новый сегмент с первой точки кандидата; путь внутри сдвинутого участка считается как обычно, переход к нему — нет. */
    private fun acceptJump() {
        jumps++
        val pts = ArrayList(cand)
        startSegment(pts[0][0], pts[0][1], pts[0][2].toLong()) // очищает cand
        val seg = curSeg ?: return
        for (i in 1 until pts.size) {
            val q = pts[i]
            val prev = lastPt ?: return
            val d = haversine(prev[0], prev[1], q[0], q[1])
            if (d < MIN_STEP_M) continue
            distM += d
            seg.add(q)
            lastPt = q
        }
        lastPtT = pts[pts.size - 1][2].toLong()
    }

    private fun haversine(lat1: Double, lon1: Double, lat2: Double, lon2: Double): Double {
        val r = 6371000.0
        val p1 = Math.toRadians(lat1)
        val p2 = Math.toRadians(lat2)
        val dp = p2 - p1
        val dl = Math.toRadians(lon2 - lon1)
        val a = sin(dp / 2).pow(2.0) + cos(p1) * cos(p2) * sin(dl / 2).pow(2.0)
        return 2 * r * asin(sqrt(a.coerceIn(0.0, 1.0)))
    }

    /** Запись тренировки для финала и сопоставления. */
    private class Rec(
        val start: Long,
        val end: Long,
        val totalMs: Long,
        val lostMs: Long,
        val gaps: List<LongArray>,
        val rawM: Double,
        val segments: List<List<DoubleArray>>,
        val jumps: Int
    ) {
        fun toJson(distM: Double, how: String): JSONObject {
            val g = JSONArray()
            gaps.forEach { g.put(JSONArray().put(it[0]).put(it[1])) }
            return JSONObject()
                .put("id", "w" + java.lang.Long.toString(start, 36))
                .put("start", start)
                .put("end", end)
                .put("totalMs", totalMs)
                .put("lostMs", lostMs)
                .put("gaps", g)
                .put("rawM", Math.round(rawM))
                .put("m", Math.round(distM))
                .put("how", how)
                .put("jumps", jumps)
        }
    }

    // ---------- сопоставление с картой ----------

    private fun finish(ctx: Context, rec: Rec): JSONObject {
        var total = 0.0
        var matchedAny = false
        var rawAll = 0.0
        for (seg in rec.segments) {
            val raw = segmentLength(seg)
            rawAll += raw
            if (raw < MATCH_MIN_SEG_M || seg.size < 3) {
                total += raw
                continue
            }
            val m = matchSegment(seg)
            if (m != null && m >= raw * MATCH_RATIO_LO && m <= raw * MATCH_RATIO_HI) {
                total += m
                matchedAny = true
            } else {
                total += raw
            }
        }
        // если вся тренировка не нашла пары на карте — остаётся расстояние по GPS целиком
        val how = if (matchedAny) "map" else "raw"
        return rec.toJson(if (matchedAny) total else rawAll.coerceAtLeast(rec.rawM), how)
    }

    private fun segmentLength(seg: List<DoubleArray>): Double {
        var s = 0.0
        for (i in 1 until seg.size) s += haversine(seg[i - 1][0], seg[i - 1][1], seg[i][0], seg[i][1])
        return s
    }

    /** Длина сегмента по карте (метры) или null, если сервис не ответил / не нашёл дорогу хотя бы для одного куска. */
    private fun matchSegment(seg: List<DoubleArray>): Double? {
        // прореживание: оставляем точки не гуще MATCH_MIN_STEP_M
        val pts = ArrayList<DoubleArray>()
        pts.add(seg[0])
        for (i in 1 until seg.size) {
            val last = pts[pts.size - 1]
            if (haversine(last[0], last[1], seg[i][0], seg[i][1]) >= MATCH_MIN_STEP_M) pts.add(seg[i])
        }
        if (pts.size < 2) return null
        var total = 0.0
        var from = 0
        while (from < pts.size - 1) {
            val to = minOf(pts.size, from + MATCH_CHUNK)
            val chunk = pts.subList(from, to)
            if (chunk.size >= 2) {
                val raw = segmentLength(chunk)
                val m = if (raw >= 15.0) matchChunk(chunk) else null
                total += if (m != null && m >= raw * MATCH_RATIO_LO && m <= raw * MATCH_RATIO_HI) m else raw
            }
            if (to >= pts.size) break
            from = to - 1 // концы кусков стыкуются в одной точке
        }
        return total
    }

    private fun matchChunk(chunk: List<DoubleArray>): Double? {
        var conn: HttpURLConnection? = null
        return try {
            val shape = JSONArray()
            for (p in chunk) shape.put(JSONObject().put("lat", p[0]).put("lon", p[1]))
            val body = JSONObject()
                .put("shape", shape)
                .put("costing", "pedestrian")
                .put("shape_match", "map_snap")
                .put("units", "kilometers")
                .put("trace_options", JSONObject().put("search_radius", 40).put("gps_accuracy", 12).put("interpolation_distance", 10))
                .toString()
            conn = URL(MATCH_URL).openConnection() as HttpURLConnection
            conn.requestMethod = "POST"
            conn.connectTimeout = 8000
            conn.readTimeout = 25000
            conn.doOutput = true
            conn.setRequestProperty("Content-Type", "application/json")
            conn.setRequestProperty("User-Agent", "LifeTracker/1.0 (workout map matching)")
            conn.outputStream.use { it.write(body.toByteArray(Charsets.UTF_8)) }
            if (conn.responseCode != 200) return null
            val text = conn.inputStream.bufferedReader(Charsets.UTF_8).use { it.readText() }
            val km = JSONObject(text).getJSONObject("trip").getJSONObject("summary").getDouble("length")
            if (km.isNaN() || km <= 0) null else km * 1000.0
        } catch (e: Exception) {
            null
        } finally {
            try {
                conn?.disconnect()
            } catch (e: Exception) {
                // уже закрыто
            }
        }
    }

    // ---------- готовые записи для страницы ----------

    private fun prefs(ctx: Context) = ctx.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    private fun readFinished(ctx: Context): JSONArray = try {
        JSONArray(prefs(ctx).getString(KEY_FINISHED, "[]") ?: "[]")
    } catch (e: Exception) {
        JSONArray()
    }

    @Synchronized
    private fun appendFinished(ctx: Context, rec: JSONObject) {
        val arr = readFinished(ctx)
        arr.put(rec)
        prefs(ctx).edit().putString(KEY_FINISHED, arr.toString()).commit()
    }

    fun pendingCount(ctx: Context): Int = readFinished(ctx).length()

    /** JSON-массив готовых записей, которые страница ещё не забрала. */
    fun takeFinishedJson(ctx: Context): String = readFinished(ctx).toString()

    /** Страница сохранила записи с этими id — убрать их из очереди. */
    @Synchronized
    fun ackFinished(ctx: Context, idsJson: String) {
        try {
            val ids = JSONArray(idsJson)
            val drop = HashSet<String>()
            for (i in 0 until ids.length()) drop.add(ids.optString(i))
            val arr = readFinished(ctx)
            val keep = JSONArray()
            for (i in 0 until arr.length()) {
                val o = arr.optJSONObject(i) ?: continue
                if (!drop.contains(o.optString("id"))) keep.put(o)
            }
            prefs(ctx).edit().putString(KEY_FINISHED, keep.toString()).commit()
        } catch (e: Exception) {
            // нечего убирать
        }
    }
}
