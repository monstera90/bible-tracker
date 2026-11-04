package com.app.lifetracker
// Версия: 6.0 (04.11)

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject
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
 *  • Шум GPS (петляющие координаты). Точка, прошедшая проверку скорости, сглаживается фильтром Калмана ([smooth]: модель
 *    «положение + скорость», доверие к измерению зависит от заявленной точности точки). Километры набираются по хордам между
 *    опорными точками: шаг засчитывается, только когда сглаженная позиция ушла от опорной дальше порога
 *    max([MIN_STEP_M], [STEP_ACC_K] × точность) (не больше [STEP_MAX_M]) — дрожание в пределах погрешности расстояние не растит.
 *    Если спутниковая (доплеровская) скорость говорит «стою» (< [STILL_SPEED]), небольшие смещения тоже не считаются.
 *  • Расстояние ВСЕГДА по GPS: сверки с картами нет (на бездорожье троп в OSM нет, привязка к чужой дороге искажала километры).
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

    /** Шаг короче этого значения не считается никогда (дрожание GPS на месте), метры. */
    private const val MIN_STEP_M = 3.0

    /** Порог засчёта шага растёт с заявленной погрешностью точки: max(MIN_STEP_M, STEP_ACC_K × точность), но не больше STEP_MAX_M. */
    private const val STEP_ACC_K = 1.0
    private const val STEP_MAX_M = 15.0

    /** Доплеровская скорость ниже этого значения — человек стоит: смещение меньше max(2 × порог, 10 м) не считается (м/с). */
    private const val STILL_SPEED = 0.6f

    /** Фильтр Калмана: ожидаемое ускорение бегуна (м/с²) и минимальная точность измерения (м). */
    private const val KF_ACCEL = 1.0
    private const val KF_ACC_MIN = 4.0

    /** Дольше этого перерыва между принятыми точками (с) фильтр начинает заново с новой точки. */
    private const val KF_RESET_S = 10.0

    private const val M_PER_DEG = 111_194.93

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

    /** Набор высоты: высота GPS сглаживается (коэффициент за точку), подъём засчитывается, когда сглаженная высота ушла от последнего минимума больше чем на ALT_STEP (м). */
    private const val ALT_ALPHA = 0.15
    private const val ALT_STEP = 3.0
    private const val ALT_ACC_MAX = 15f          // точки с худшей вертикальной точностью (м) не учитываются

    private const val PREFS = "workouts_native"
    private const val KEY_FINISHED = "finished"

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
        val connectedBanner: Boolean,
        val upM: Double = 0.0
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
    private var hasRoute = false                    // есть опорная точка маршрута (после начала/разрыва/паузы её нет)
    private var lastPt: DoubleArray? = null
    private var lastPtT = 0L                        // время последней точки, стыкующейся с маршрутом (в том числе не прибавившей метры)
    private val cand = ArrayList<DoubleArray>()      // точки [lat, lon, t, acc, speed], не стыкующиеся с маршрутом (возможный выброс или сдвиг)
    private var jumps = 0                            // сколько раз GPS «уезжал» (выброс или сдвиг), за тренировку
    private var upM = 0.0                            // набрано высоты за тренировку, м
    private var altSm = Double.NaN                   // сглаженная высота (NaN — ещё не было точки после начала/разрыва)
    private var altRising = false
    private var altBase = 0.0                        // низшая сглаженная высота с последнего спуска
    private var altRef = 0.0                         // высшая сглаженная высота во время подъёма

    // фильтр Калмана (метры в плоскости с началом в kfLat0/kfLon0; по обеим осям одинаковый, поэтому ковариация общая)
    private var kfLat0 = 0.0
    private var kfLon0 = 0.0
    private var kfCos = 1.0
    private var kfX = 0.0
    private var kfY = 0.0
    private var kfVx = 0.0
    private var kfVy = 0.0
    private var kfP00 = 0.0
    private var kfP01 = 0.0
    private var kfP11 = 0.0
    private var kfT = 0L

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
            hasRoute = false
            lastPt = null
            lastPtT = 0L
            cand.clear()
            jumps = 0
            upM = 0.0
            resetAlt()
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
                hasRoute = false
                lastPt = null
                cand.clear()
                paused = true
            } else if (status == ST_PAUSE) {
                status = ST_RUN
                lastTickAt = now
                fix = lastGoodAt > 0 && now - lastGoodAt <= FRESH_MS
                if (!fix) gapStart = now
                hasRoute = false
                lastPt = null
                cand.clear()
                resetAlt()
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
     * Остановить запись. Если связи не было ни разу (SEARCH) — записи нет, возвращает false. Иначе в фоновом потоке запись
     * попадает в `finished` (расстояние по GPS), статус возвращается в IDLE.
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
                Rec(startedAt, now, okMs + lostMs, lostMs, ArrayList(gaps), distM, jumps, upM)
            }
        }
        if (rec == null) return false
        Thread {
            val done = rec.toJson(rec.rawM, "raw")
            try {
                appendFinished(app, done)
            } catch (e: Exception) {
                // запись не сохранилась: хуже всего, но служба всё равно должна остановиться
            }
            synchronized(lock) { status = ST_IDLE }
            WorkoutService.refresh(app)
            dropLegacyMatch(app)
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
    fun onLocation(lat: Double, lon: Double, acc: Float, hasAcc: Boolean, alt: Double = Double.NaN, vAcc: Float = -1f, speed: Float = -1f) {
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
                    startSegment(lat, lon, now, acc)
                    resetAlt()
                    addAlt(alt, vAcc)
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
                        startSegment(lat, lon, now, acc)
                        resetAlt()
                    } else {
                        addPoint(lat, lon, now, acc, speed)
                    }
                    addAlt(alt, vAcc)
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
                hasRoute = false
                lastPt = null
                cand.clear()
                resetAlt()
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
            return Snapshot(status, fix, sat, satTotal, ok + lost, lost, distM, startedAt, g, banner, upM)
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
            .put("upM", Math.round(s.upM))
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

    private fun resetAlt() {
        altSm = Double.NaN
        altRising = false
    }

    /** Новая высота GPS: сглаживание и подсчёт подъёма с гистерезисом (шум высоты GPS — единицы метров, его не считаем). */
    private fun addAlt(alt: Double, vAcc: Float) {
        if (alt.isNaN() || (vAcc > 0f && vAcc > ALT_ACC_MAX)) return
        if (altSm.isNaN()) {
            altSm = alt
            altBase = alt
            altRef = alt
            altRising = false
            return
        }
        altSm += ALT_ALPHA * (alt - altSm)
        val s = altSm
        if (altRising) {
            if (s >= altRef) {
                upM += s - altRef
                altRef = s
            } else if (altRef - s >= ALT_STEP) {
                altRising = false
                altBase = s
            }
        } else {
            if (s < altBase) {
                altBase = s
            } else if (s - altBase >= ALT_STEP) {
                altRising = true
                upM += s - altBase
                altRef = s
            }
        }
    }

    /** Новая опорная точка маршрута (начало, возврат связи, пауза, устойчивый сдвиг): фильтр и хорды начинаются заново. */
    private fun startSegment(lat: Double, lon: Double, t: Long, acc: Float) {
        val p = doubleArrayOf(lat, lon, t.toDouble())
        hasRoute = true
        lastPt = p
        lastPtT = t
        cand.clear()
        kfInit(lat, lon, acc, t)
    }

    /** Можно ли добраться от точки a (время at, мс) до (lat, lon, t) не быстрее [MAX_SPEED]; время между точками зажато в [DT_MIN]..maxDt. */
    private fun stepOk(a: DoubleArray, at: Long, lat: Double, lon: Double, t: Long, maxDt: Double): Boolean {
        val dt = ((t - at) / 1000.0).coerceIn(DT_MIN, maxDt)
        return haversine(a[0], a[1], lat, lon) <= MAX_SPEED * dt
    }

    private fun addPoint(lat: Double, lon: Double, t: Long, acc: Float, speed: Float) {
        val prev = lastPt
        if (!hasRoute || prev == null) {
            startSegment(lat, lon, t, acc)
            return
        }
        val p = doubleArrayOf(lat, lon, t.toDouble(), acc.toDouble(), speed.toDouble())
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
            routeStep(lat, lon, t, acc, speed)
            return
        }
        // 3) Не стыкуется ни с маршрутом, ни с кандидатом: новый кандидат (прежний был одиночным выбросом).
        if (cand.isNotEmpty()) jumps++
        cand.clear()
        cand.add(p)
    }

    /**
     * Точка стыкуется с маршрутом: сглаживаем и добавляем хорду от опорной точки, если позиция ушла дальше порога
     * (дрожание GPS и «петли» внутри погрешности расстояние не растят). Опорная точка двигается только вместе с засчитанным шагом.
     */
    private fun routeStep(lat: Double, lon: Double, t: Long, acc: Float, speed: Float) {
        val prev = lastPt ?: return
        val sm = smooth(lat, lon, acc, t)
        lastPtT = t
        val d = haversine(prev[0], prev[1], sm[0], sm[1])
        val thr = (STEP_ACC_K * acc).coerceIn(MIN_STEP_M, STEP_MAX_M)
        if (d < thr) return
        if (speed >= 0f && speed < STILL_SPEED && d < maxOf(2 * thr, 10.0)) return // датчик скорости: стоим, это дрейф
        distM += d
        lastPt = doubleArrayOf(sm[0], sm[1], t.toDouble())
    }

    /** Устойчивый сдвиг: новый участок с первой точки кандидата; путь внутри сдвинутого участка считается как обычно, переход к нему — нет. */
    private fun acceptJump() {
        jumps++
        val pts = ArrayList(cand)
        val first = pts[0]
        startSegment(first[0], first[1], first[2].toLong(), first[3].toFloat()) // очищает cand
        for (i in 1 until pts.size) {
            val q = pts[i]
            routeStep(q[0], q[1], q[2].toLong(), q[3].toFloat(), q[4].toFloat())
        }
    }

    // ---------- фильтр Калмана ----------

    private fun kfR(acc: Float): Double {
        val sd = maxOf(acc.toDouble(), KF_ACC_MIN) * 0.8
        return sd * sd
    }

    private fun kfInit(lat: Double, lon: Double, acc: Float, t: Long) {
        kfLat0 = lat
        kfLon0 = lon
        kfCos = cos(Math.toRadians(lat))
        kfX = 0.0
        kfY = 0.0
        kfVx = 0.0
        kfVy = 0.0
        kfP00 = kfR(acc)
        kfP01 = 0.0
        kfP11 = 4.0
        kfT = t
    }

    /** Сглаженная позиция [lat, lon] после очередной точки (модель «положение + скорость», общая для обеих осей). */
    private fun smooth(lat: Double, lon: Double, acc: Float, t: Long): DoubleArray {
        val rawDt = (t - kfT) / 1000.0
        if (rawDt > KF_RESET_S || rawDt < 0.0) {
            kfInit(lat, lon, acc, t)
            return doubleArrayOf(lat, lon)
        }
        val dt = rawDt.coerceIn(0.2, 5.0)
        val zx = (lon - kfLon0) * kfCos * M_PER_DEG
        val zy = (lat - kfLat0) * M_PER_DEG
        // прогноз
        val q = KF_ACCEL * KF_ACCEL
        kfX += kfVx * dt
        kfY += kfVy * dt
        val p00 = kfP00 + dt * (2 * kfP01 + dt * kfP11) + q * dt * dt * dt * dt / 4
        val p01 = kfP01 + dt * kfP11 + q * dt * dt * dt / 2
        val p11 = kfP11 + q * dt * dt
        // поправка по измерению
        val s = p00 + kfR(acc)
        val k0 = p00 / s
        val k1 = p01 / s
        val ix = zx - kfX
        val iy = zy - kfY
        kfX += k0 * ix
        kfY += k0 * iy
        kfVx += k1 * ix
        kfVy += k1 * iy
        kfP00 = (1 - k0) * p00
        kfP01 = (1 - k0) * p01
        kfP11 = p11 - k1 * p01
        kfT = t
        return doubleArrayOf(kfLat0 + kfY / M_PER_DEG, kfLon0 + kfX / (M_PER_DEG * kfCos))
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
        val jumps: Int,
        val climbM: Double
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
                .put("up", Math.round(climbM))
        }
    }

    // ---------- наследие: очередь сверки с картой ----------

    private const val KEY_LEGACY_PENDING = "pending_match"

    /** Старые версии откладывали треки для сверки с картой; сверки больше нет — очередь стирается. */
    fun dropLegacyMatch(ctx: Context) {
        try {
            val p = prefs(ctx)
            if (p.contains(KEY_LEGACY_PENDING)) p.edit().remove(KEY_LEGACY_PENDING).commit()
        } catch (e: Exception) {
            // не вышло — безвредно, повторится
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
