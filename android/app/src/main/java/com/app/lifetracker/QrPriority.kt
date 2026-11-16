package com.app.lifetracker
// Версия: 5.0 (15.11) — карточка «Таймеры» (`Cfg.timers`, `Cfg.timerCards`): третья карточка-группа «tmr_0» ([TIMER_SLOT_KEY]), элемент — один таймер из карточек QR-кодов. Идущий таймер — [SCORE_TIMER_ACTIVE] (1200): карточка встаёт наверх стопки выше всего, в том числе выше «Как тренировка?» и «Как настроение?», и при любом режиме (даже без «релевантности»); несколько идущих сменяют друг друга на ней раз в минуту ([CYCLE_MS]). Таймер «в своё время суток» ([habitDue]-правило, `Card.times`) — [SCORE_TIMER_DUE] (950): выше календаря, привычек и будильника «скоро». Раз в минуту, пока идёт таймер, виджет перерисовывается ([Result.minuteAt]) — перерисовывается кольцо.
// Версия: 4.9 (15.11) — единая модель круга равных и карточек-групп: в круг входит любая карточка верхнего яруса (не только привычки и события); карточка-группа (привычки «hab_0», будильники «alm_0» — [groups]) всегда одна в стопке, у каждого её элемента свой балл, балл карточки — балл лучшего элемента, очередей у неё столько, сколько элементов с верхним баллом ([Card.cycleN]); какой элемент показать, отдаёт [Result.faces] (вместо одиночного habitIdx). Будильники больше не отдельные карточки: [alarmCards] — элементы группы [ALARM_SLOT_KEY], снимок без alarmIndex, [alarmRowScore] заменён баллами элементов.
// Версия: 4.8 (15.11) — карточка «Привычки» в стопке всегда одна ([habitSlots], ключ [HABIT_SLOT_KEY]): свайп листает группы, привычки листаются только нажатием у края. Привычки «в своё время» по-прежнему сменяют друг друга и календарь раз в минуту, но очередь каждой — очередь на одной карточке ([Card.cycleN], [Result.habitIdx]), а не отдельная карточка стопки.
// Версия: 4.7 (15.11) — задачи ниже календаря и привычек: [SCORE_TASK_OVERDUE] = 480, [SCORE_TASK_TODAY] = 470 (< [SCORE_CYCLE]), в круг равных входят только слоты привычек и событие.
// Версия: 4.6 (15.11) — круг равных: привычки, у которых сейчас «их» время, и карточки календаря (событие) имеют один балл [SCORE_CYCLE] и по очереди встают наверх, каждая на [CYCLE_MS] (60 с) — [cycleOrder]; привычка не в своё время в круг не входит. Календарь больше не «выше» привычки (раньше событие поднималось над задачей на сегодня, а та стояла выше привычки — привычка не показывалась).
// Версия: 4.5 (14.11) — карточка «Привычки» (`Cfg.habits`, `Cfg.habitCards`): привычки, у которых сейчас «их» время, встают в стопку каждая своей карточкой-слотом («hab_0», «hab_1» …) и участвуют в круге наравне с календарём; нет таких — один слот, который листают у краёв; все отмечены — карточек нет ([habitList], [habitSlots]).
// Версия: 4.4 (14.11) — служебные карточки «Как тренировка?» / «Как настроение?» берут цвет из [Cfg] (`rpeColor`, `moodColor`).
// Версия: 4.3 (14.11) — вторая служебная карточка «Как настроение?» ([QrMood.KEY], [Snapshot.moodPending]): стоит над всеми обычными карточками, под «Как тренировка?»; [check] знает обе.
// Версия: 4.2 (14.11) — будильник «скоро» поднимает карточку за 30 минут, а не за час ([ALARM_SOON_MS]); балл [SCORE_ALARM_SOON] выше события «скоро» на гистерезис, чтобы будильник перебивал календарь.
// Версия: 4.1 (14.11) — карточка «Будильники» (dyn = "alarm"): одна на все будильники пользователя, листается у краёв как события и задачи ([alarmCards], [nextAlarmKey]).
// Версия: 4.0 (14.11)

import com.app.lifetracker.QrWidgets.Card
import com.app.lifetracker.QrWidgets.Cfg
import java.util.Calendar

/**
 * Порядок карточек стопки виджета «Стопка QR-карточек» и ответ на вопрос «что сейчас должно лежать сверху» (ТЗ TZ_card_priority.md).
 *
 * Чистая функция: без Android, SharedPreferences и часов — всё нужное приходит в [Snapshot] (его собирает [QrWidgets.snapshot]).
 * Слои стопки сверху вниз: 1) служебные «Как тренировка?» ([QrRpe.KEY]) и под ней «Как настроение?» ([QrMood.KEY]) — каждая, пока ждёт ответа; 2) основная часть — отфильтрованные карточки, при «релевантности»
 * по баллам, иначе в порядке пользователя; 3) хвост — карточки «после срабатывания: в конец», перенесённые сегодня, в порядке переноса.
 * Фильтр (карточки нет в стопке вообще): скрытые сегодня, выполненные задачи, события и задачи вне окна [DYN_DAYS].
 * [check] проверяет инварианты результата; значения баллов — в таблице констант ниже.
 *
 * Этап 2: новые сигналы (звонит / скоро сработает будильник карточки, событие и задача календаря, низкий заряд) и устойчивость: новая верхняя
 * карточка заменяет прежнюю ([Snapshot.lastTopKey]) только если её балл выше минимум на [HYSTERESIS] или у прежней балл упал до 0; звонящий
 * будильник гистерезис обходит. Балл карточки — максимум по её сигналам, не сумма.
 *
 * Этап 3: ручной приоритет карточки [Card.prio] (только при «релевантности»): «top» прибавляет [PRIO_TOP_BONUS] к баллу, «low» ставит [SCORE_LOW]
 * (карточка не поднимается ни по какому сигналу и стоит ниже обычных); «в конец» и скрытие сильнее приоритета. Объяснение: [Scored.reason] у каждой
 * оценённой карточки, [Result.topTitle] / [Result.topReason] — у верхней (оболочка отдаёт их странице мостом `widgetWhy`).
 */
object QrPriority {

    // ---------- таблица баллов ----------
    /** Идёт тренировка / помодоро / таймер / секундомер (1000 + прежний ранг). */
    const val SCORE_WORKOUT = 1040
    const val SCORE_POMODORO = 1030
    const val SCORE_TIMER = 1020
    const val SCORE_STOPWATCH = 1010
    /** Звонит будильник карточки: выше любых занятий; гистерезис не держит прежнюю верхнюю карточку. */
    const val SCORE_ALARM_RINGING = 1100
    /**
     * Идёт (или на паузе) таймер карточки «Таймеры»: самый высокий приоритет из всех — выше звонящего будильника, занятий и служебных «Как тренировка?» / «Как настроение?».
     * Карточка с таким баллом всегда стоит самой первой, даже без «релевантности» ([build]). Несколько идущих таймеров — один и тот же балл, на карточке они сменяют друг друга по минутам.
     */
    const val SCORE_TIMER_ACTIVE = 1200
    /**
     * Не запущенный таймер, у которого сейчас «его» время суток (`Card.times`, настройка таймера в форме виджета): выше календаря, привычек «в своё время» и будильника «скоро»
     * (950 ≥ 850 + [HYSTERESIS], иначе прежняя верхняя карточка удерживалась бы гистерезисом) и ниже занятий и звонящего будильника. Таймер без времени суток этого балла не получает.
     */
    const val SCORE_TIMER_DUE = 950
    /**
     * Будильник карточки сработает в ближайшие [ALARM_SOON_MS] (заведённый позже — 0). Выше [SCORE_EVENT_SOON] ровно на [HYSTERESIS] (750 + 100):
     * иначе событие, уже стоящее наверху, удерживалось бы гистерезисом и будильник не мог его заменить.
     */
    const val SCORE_ALARM_SOON = 850
    /** Событие календаря начнётся в ближайшие [SOON_MS]. */
    const val SCORE_EVENT_SOON = 750
    /** Задача календаря просрочена. */
    const val SCORE_TASK_OVERDUE = 480
    /** Задача календаря на сегодня (время ещё не прошло). */
    const val SCORE_TASK_TODAY = 470
    /** «Её» время суток и день недели ([scheduledNow]). */
    const val SCORE_SCHEDULED = 500
    /**
     * Круг равных: привычка, у которой сейчас её время, и карточки календаря (событие, задача на сегодня) имеют один и тот же балл и по очереди встают наверх
     * ([cycleOrder]). Выше него — только срочное (идёт занятие, звонит или скоро зазвонит будильник, событие скоро, просроченная задача).
     */
    const val SCORE_CYCLE = SCORE_SCHEDULED
    /** Сколько каждая карточка круга равных остаётся наверху. */
    const val CYCLE_MS = 60_000L
    /** Заряд телефона не выше [BATTERY_LOW_PERCENT] — только карточки заряда. */
    const val SCORE_BATTERY_LOW = 450
    const val BATTERY_LOW_PERCENT = 15
    /** Ручной приоритет «наверх»: прибавка к баллу карточки (при любых её сигналах; без сигналов балл = эта прибавка). */
    const val PRIO_TOP_BONUS = 300
    /** Ручной приоритет «вниз»: балл не выше нуля — на единицу ниже обычных карточек без сигналов, чтобы карточка действительно стояла после них. */
    const val SCORE_LOW = -1

    /** «Скоро» для события календаря: за сколько до начала оно поднимает карточку. */
    const val SOON_MS = 60L * 60_000L
    /** «Скоро» для будильника: за сколько до звонка он поднимает карточку (любой из будильников ряда, что бы ни было показано). */
    const val ALARM_SOON_MS = 30L * 60_000L
    /** Новая верхняя карточка заменяет прежнюю, если её балл выше минимум на столько. */
    const val HYSTERESIS = 100
    /** Пока звонит будильник, порядок перепроверяется с этим шагом (смахнутое уведомление и его таймаут не присылают события). */
    private const val RINGING_POLL_MS = 60_000L

    /** Окно задач и событий: сегодня и ещё шесть дней (совпадает с FEED_DAYS в widgets.js). */
    const val DYN_DAYS = 7

    /** Окно карточки события при галочке «Показывать только мероприятия на сегодня и на завтра» (`Cfg.eventsSoon`): сегодня и завтра. */
    const val EVENTS_SOON_DAYS = 2

    /** Интервалы времени суток (минуты от полуночи, [начало; конец)). Те же значения показывает страница (widgets.js, WINDOWS). */
    val WINDOWS: Map<String, Pair<Int, Int>> = mapOf("m" to (5 * 60 to 11 * 60), "d" to (11 * 60 to 15 * 60), "e" to (17 * 60 to 23 * 60))
    private val BOUNDARIES = intArrayOf(0, 5 * 60, 11 * 60, 15 * 60, 17 * 60, 23 * 60)

    /** Всё, что нужно для расчёта (оболочка собирает его в [QrWidgets.snapshot]); у необязательных полей значения по умолчанию. */
    data class Snapshot(
        val now: Long,
        val cal: Calendar,
        val workoutActive: Boolean = false,
        val pomodoroActive: Boolean = false,
        val stopwatchActive: Boolean = false,
        val activeTimerIds: Set<String> = emptySet(),
        val alarms: Map<String, Long> = emptyMap(),
        val ringingAlarmIds: Set<String> = emptySet(),
        val batteryPercent: Int = -1,
        val hiddenKeys: Set<String> = emptySet(),
        val movedAt: Map<String, Long> = emptyMap(),
        val doneTaskIds: Set<String> = emptySet(),
        val rpePending: Boolean = false,
        /** «Как настроение?» ждёт отметки: у виджета включено «Спрашивать о настроении», время [QrMood.ASK_MINUTE] наступило, а отметок за сегодня нет (считает [QrMood.pending]). */
        val moodPending: Boolean = false,
        val lastTopKey: String = "",
        /** Какое по счёту из ближайших событий показывает карточка события (0 — первое; нажатие у края карточки листает, без зацикливания). */
        val eventIndex: Int = 0,
        /** Какая по счёту из ближайших задач показана на единственной карточке задач (0 — первая; нажатие у края листает, без зацикливания). */
        val taskIndex: Int = 0,
        /** Звонит какой-нибудь из будильников карточки «Будильники» (карточка при этом не отдаёт верх устойчивостью, как звонящий будильник обычной карточки). */
        val alarmRowRinging: Boolean = false
    )

    class Scored(val card: Card, val score: Int, val reason: String)

    class Result(
        /** Итоговый порядок: rpe, настроение, основная часть, хвост. */
        val cards: List<Scored>,
        /** Карточка наверху по релевантности ("" — нет); у служебных — [QrRpe.KEY] («Как тренировка?») или [QrMood.KEY] («Как настроение?»). */
        val topKey: String,
        /** К чему возвращаться и от смены чего вставать наверх (прежние anchorKey/topAnchor). */
        val anchorKey: String,
        /**
         * Когда порядок может измениться без внешнего события (только при «релевантности»; иначе [Long.MAX_VALUE]): ближайшее из границы окон времени
         * суток, «до события 60 мин», «до будильника 30 мин», времени задачи на сегодня (станет просроченной), а пока звонит будильник — через минуту.
         */
        val nextChangeAt: Long,
        /** Верхняя карточка по релевантности без «Как тренировка?» — её оболочка запоминает как [Snapshot.lastTopKey] для следующего расчёта. */
        val mainTopKey: String = "",
        /** Название верхней карточки ([topKey]); пусто, если наверху нет выделенной карточки. */
        val topTitle: String = "",
        /** Почему она наверху («Идёт тренировка», «Будильник через 25 мин», «Сейчас её время: утро»); пусто, если [topKey] пуст. */
        val topReason: String = "",
        /** Когда круг равных ([cycleOrder]) выставит наверх следующую карточку; [Long.MAX_VALUE] — круга нет (равных меньше двух). В [nextChangeAt] не входит (будильник каждую минуту при погашенном экране не нужен): оболочка ставит для него обработчик на время, пока экран включён ([QrWidgets]). */
        val cycleAt: Long = Long.MAX_VALUE,
        /**
         * Карточка-группа ([groups]: «Привычки», «Будильники») → номер её элемента ([Group.items], с нуля), который показывает расчёт: элемент по очереди круга, если карточка в верхнем ярусе,
         * иначе элемент по умолчанию ([Group.defaultIdx]). Выбор нажатием у края и его срок (60 с) накладывает оболочка ([QrWidgets.groupViews]).
         */
        val faces: Map<String, Int> = emptyMap(),
        /** Когда нужно перерисовать виджет ради кольца таймера: начало следующей минуты, пока идёт хоть один таймер карточки «Таймеры»; иначе [Long.MAX_VALUE]. Не зависит от «релевантности». */
        val minuteAt: Long = Long.MAX_VALUE
    )

    // ---------- построение ----------

    fun build(cfg: Cfg, s: Snapshot): Result {
        val gs = groups(cfg, s)
        val base = visible(cfg, s, gs)
        val rowTaskAt = taskCards(cfg, s).firstOrNull()?.at ?: 0L // балл карточки задач считается по первой задаче ряда: листание не двигает карточку в стопке
        val main = ArrayList<Scored>()
        var top = ""
        var cyc = false
        var turn = 0
        var start: Map<String, Int> = emptyMap()
        // единственная карточка-группа с двумя и больше элементами верхнего яруса — тоже круг (меняется её лицо), поэтому считается и при одной карточке в стопке
        if (!cfg.relevance || (base.size < 2 && base.sumOf { turnsOf(it) } < 2)) {
            for (c in base) main.add(Scored(c, 0, ""))
        } else {
            val head = ArrayList<Card>()
            val tail = ArrayList<Card>() // уже стоят в порядке переноса
            for (c in base) if (movedToday(c, s)) tail.add(c) else head.add(c)
            if (head.isEmpty()) {
                for (c in tail) main.add(Scored(c, 0, ""))
            } else {
                val scored = ArrayList<Scored>()
                for (c in head) {
                    val sc = scoreOf(c, s, rowTaskAt)
                    scored.add(Scored(c, sc.first, sc.second))
                }
                lift(scored)
                // sortedWith устойчивая: при равных баллах остаётся порядок пользователя; события и заряд уточняет tidy
                val cycled = cycleOrder(tidy(scored.sortedWith(compareByDescending<Scored> { it.score })), s.now)
                val sorted = ArrayList(cycled.order)
                turn = cycled.turn
                start = cycled.start
                cyc = cycled.circle
                if (sorted.first().score > 0) top = sorted.first().card.key
                top = keepPrevTop(sorted, top, s)
                main.addAll(sorted)
                for (c in tail) main.add(Scored(c, 0, ""))
            }
        }
        val faces = HashMap<String, Int>()
        for (g in gs) if (main.any { it.card.key == g.key }) faces[g.key] = faceOf(g, start[g.key], turn)
        // Идущий таймер: карточка «Таймеры» всегда первая (над служебными тоже), при любом режиме; между идущими таймерами лицо меняется раз в минуту
        val tg = gs.firstOrNull { it.dyn == "timer" }
        var lead: Scored? = null
        if (tg != null && tg.best >= SCORE_TIMER_ACTIVE) {
            val at = main.indexOfFirst { it.card.key == TIMER_SLOT_KEY }
            if (at >= 0) {
                val m = main.removeAt(at)
                var hi = tg.best
                for (x in main) if (x.score > hi) hi = x.score
                lead = Scored(m.card, hi, tg.reasons[tg.topIdx[0]])
                top = TIMER_SLOT_KEY
                val tops = tg.topIdx
                faces[TIMER_SLOT_KEY] = tops[Math.floorMod(s.now / CYCLE_MS, tops.size.toLong()).toInt()]
            }
        }
        val out = ArrayList<Scored>()
        if (lead != null) out.add(lead)
        if (s.rpePending) out.add(Scored(rpeCard(cfg), 0, "Ждёт оценки тренировки"))
        if (s.moodPending) out.add(Scored(moodCard(cfg), 0, "Сегодня настроение ещё не отмечено"))
        out.addAll(main)
        val serviceKey = serviceKeyOf(s)
        val topKey = if (lead != null) TIMER_SLOT_KEY else if (serviceKey.isNotEmpty()) serviceKey else top
        val next = if (cfg.relevance) nextChange(cfg, base, s, rowTaskAt) else Long.MAX_VALUE
        val topScored: Scored? = if (lead != null || serviceKey.isNotEmpty()) out.firstOrNull() else if (top.isNotEmpty()) main.firstOrNull() else null
        val cycleAt = if (cfg.relevance && cyc) nextCycleAt(s.now) else Long.MAX_VALUE
        // у группы наверху называем тот элемент, который она на самом деле показывает (а не заголовок слота)
        var topTitle = topScored?.card?.title ?: ""
        var topReason = topScored?.reason ?: ""
        val topGroup = if (topScored != null) gs.firstOrNull { it.key == topScored.card.key } else null
        if (topGroup != null && top.isNotEmpty() && (serviceKey.isEmpty() || lead != null)) {
            val i = (faces[topGroup.key] ?: topGroup.defaultIdx).coerceIn(0, topGroup.items.size - 1)
            topTitle = topGroup.items[i].title
            if (topGroup.reasons[i].isNotEmpty()) topReason = topGroup.reasons[i]
        }
        val minuteAt = if (lead != null) nextCycleAt(s.now) else Long.MAX_VALUE
        return Result(out, topKey, anchorOf(cfg, s, main, top, lead != null), next, top, topTitle, topReason, cycleAt, faces, minuteAt)
    }

    /**
     * Элемент группы [g], который показывает расчёт. Карточка в верхнем ярусе (её очереди начинаются с [from]): элемент с верхним баллом по очереди круга —
     * `clamp(turn - from, 0, число очередей - 1)`-й из них, а вне своей очереди (до неё и после) — ближайший крайний. Карточка вне яруса: элемент по умолчанию.
     */
    private fun faceOf(g: Group, from: Int?, turn: Int): Int {
        val tops = g.topIdx
        if (from == null || tops.isEmpty()) return g.defaultIdx.coerceIn(0, g.items.size - 1)
        return tops[(turn - from).coerceIn(0, tops.size - 1)]
    }

    /**
     * Событие календаря важнее задач: если в стопке есть задача с баллом, событие получает балл самой «сильной» задачи плюс [HYSTERESIS] (иначе
     * удержание прежней верхней карточки оставило бы наверху задачу). Раньше событие дальше часа до начала имело балл 0 и стояло ниже любой задачи
     * на сегодня — новый виджет вставал на задаче, а не на календаре. Более высокие баллы события («скоро», приоритет «наверх») не трогаются.
     */
    private fun lift(scored: MutableList<Scored>) {
        // Задачи ниже события и привычки «в своё время» по приоритету ([SCORE_TASK_OVERDUE], [SCORE_TASK_TODAY] < [SCORE_CYCLE]): поднимать событие над ними не нужно.
    }

    /**
     * Устойчивость: прежняя верхняя карточка ([prev]) остаётся наверху, если новая лидирует меньше чем на [HYSTERESIS] баллов; сменить её сразу могут
     * лишь окончание сигнала (у прежней балл 0), её уход из основной части или звонящий будильник. Удержанная карточка переезжает в начало [sorted],
     * остальной порядок не трогается. Возвращает ключ верхней карточки.
     */
    private fun keepPrevTop(sorted: MutableList<Scored>, top: String, s: Snapshot): String {
        val prev = s.lastTopKey
        if (top.isEmpty() || prev.isEmpty() || prev == top || isService(prev)) return top
        val idx = sorted.indexOfFirst { it.card.key == prev }
        if (idx <= 0) return top
        val ps = sorted[idx].score
        val first = sorted[0].score
        if (ps <= 0 || first >= ps + HYSTERESIS) return top
        if (ps == first) return top // круг равных: смена верха по очереди, гистерезис её не держит
        if (sorted[idx].card.dyn == "task" && (sorted[0].card.dyn == "event" || isGroup(sorted[0].card))) return top // календарь и группы выше задач: прежняя верхняя задача их не удерживает
        if (isRinging(sorted[0].card, s) && !isRinging(sorted[idx].card, s)) return top
        sorted.add(0, sorted.removeAt(idx))
        return prev
    }

    /**
     * При равных баллах (после устойчивой сортировки — в порядке пользователя): места, занятые событиями и задачами календаря, переписываются
     * «сначала события, потом задачи», карточки заряда — после остальных. Остальные карточки с равным баллом остаются где стояли.
     */
    private fun tidy(sorted: List<Scored>): List<Scored> {
        val out = ArrayList<Scored>(sorted.size)
        var i = 0
        while (i < sorted.size) {
            var j = i
            while (j < sorted.size && sorted[j].score == sorted[i].score) j++
            val run = sorted.subList(i, j)
            val dynSlots = run.indices.filter { isCal(run[it].card) }
            val ordered = ArrayList(run)
            if (dynSlots.size > 1) {
                val dyn = dynSlots.map { run[it] }
                val re = dyn.filter { it.card.dyn == "event" } + dyn.filter { it.card.dyn != "event" }
                for (k in dynSlots.indices) ordered[dynSlots[k]] = re[k]
            }
            out.addAll(ordered.filter { !isBattery(it.card.key) })
            out.addAll(ordered.filter { isBattery(it.card.key) })
            i = j
        }
        return out
    }

    /** Сколько очередей круга занимает карточка: у карточки-группы — число её элементов с верхним баллом ([Card.cycleN]), у любой другой (обычная, календарь, задачи, заряд) — одна. */
    private fun turnsOf(c: Card): Int = Math.max(1, c.cycleN)

    /** Сколько карточек верхнего яруса в [sorted] (карточки с баллом, как у первой; балл должен быть больше нуля); 0 — яруса нет. */
    private fun tierEnd(sorted: List<Scored>): Int {
        if (sorted.isEmpty() || sorted[0].score <= 0) return 0
        var n = 0
        while (n < sorted.size && sorted[n].score == sorted[0].score) n++
        return n
    }

    /** Сколько очередей круга равных во всём верхнем ярусе [sorted]: сумма очередей его карточек. Меньше двух — круга нет. */
    private fun cycleSize(sorted: List<Scored>): Int {
        val end = tierEnd(sorted)
        var n = 0
        for (i in 0 until end) n += turnsOf(sorted[i].card)
        return n
    }

    /** Итог [cycleOrder]: порядок карточек, номер очереди [turn], с какой очереди начинается каждая карточка яруса ([start]) и идёт ли круг ([circle]: очередей две и больше). */
    private class Cycled(val order: List<Scored>, val turn: Int, val start: Map<String, Int>, val circle: Boolean)

    /**
     * Круг равных. Все карточки верхнего яруса (с баллом, как у первой; балл больше нуля) встают наверх по очереди, каждая на [CYCLE_MS] (60 с). Очередей у карточки столько,
     * сколько у неё элементов с верхним баллом ([turnsOf]): у обычной карточки, календаря и задач — одна, у карточки-группы ([groups]) — несколько подряд, и тогда меняется не карточка,
     * а её элемент ([faceOf]). Очередей всего [cycleSize]; номер очереди — `floorMod(now / CYCLE_MS, всего)`; карточка, в чей диапазон он попал, идёт наверх, остальные яруса
     * сдвигаются циклически за ней; всё ниже яруса по баллу не трогается. Очередей меньше двух — порядок прежний.
     */
    private fun cycleOrder(sorted: List<Scored>, now: Long): Cycled {
        val end = tierEnd(sorted)
        if (end == 0) return Cycled(sorted, 0, emptyMap(), false)
        val tier = sorted.subList(0, end)
        val start = HashMap<String, Int>()
        var total = 0
        for (m in tier) { start[m.card.key] = total; total += turnsOf(m.card) }
        if (total < 2) return Cycled(sorted, 0, start, false)
        val turn = Math.floorMod(now / CYCLE_MS, total.toLong()).toInt()
        var shift = 0
        for (i in tier.indices) {
            val from = start[tier[i].card.key] ?: 0
            if (turn >= from && turn < from + turnsOf(tier[i].card)) shift = i
        }
        val out = ArrayList<Scored>(sorted.size)
        out.addAll(tier.drop(shift))
        out.addAll(tier.take(shift))
        out.addAll(sorted.subList(end, sorted.size))
        return Cycled(out, turn, start, true)
    }

    /** Когда начнётся следующая очередь круга равных (граница минуты плюс секунда). */
    fun nextCycleAt(now: Long): Long = (now / CYCLE_MS + 1) * CYCLE_MS + 1_000L

    /** Карточка события или задачи календаря (карточка «Будильники» тоже динамическая, но к календарю не относится). */
    private fun isCal(c: Card): Boolean = c.dyn == "event" || c.dyn == "task"

    /** Будильник карточки звонит сейчас (по баллу не определить: «наверх» поднимает и обычные карточки выше [SCORE_ALARM_RINGING]); у карточки «Будильники» — любой из её будильников. */
    private fun isRinging(c: Card, s: Snapshot): Boolean =
        if (c.dyn == "alarm") s.alarmRowRinging else c.alarmId.isNotEmpty() && c.alarmId in s.ringingAlarmIds

    /** Ручной приоритет из настроек: только «top» или «low», всё остальное — «normal». */
    fun normPrio(v: String?): String = if (v == "top" || v == "low") v else "normal"

    /** Карточка заряда (константы ключей подставляются при сборке — класс QrBattery в JVM-тестах не загружается). */
    private fun isBattery(key: String): Boolean = key == QrBattery.KEY || key == QrBattery.KEY2

    /** Ближайший момент, когда порядок меняется сам (без события извне); см. [Result.nextChangeAt]. */
    private fun nextChange(cfg: Cfg, shown: List<Card>, s: Snapshot, rowTaskAt: Long): Long {
        var at = nextBoundary(s.now, s.cal)
        val tomorrow = dayStart(s.cal, s.now, 1)
        fun soon(t: Long) { if (t > s.now && t < at) at = t }
        for (c in shown) {
            if (c.dyn == "event") soon(c.at - SOON_MS + 1_000L)
            if (c.dyn == "task") {
                val at0 = if (rowTaskAt > 0L) rowTaskAt else c.at
                if (at0 >= s.now && at0 < tomorrow) soon(at0 + 1_000L) // станет просроченной
            }
            if (c.alarmId.isNotEmpty() && c.dyn != "alarm") {
                s.alarms[c.alarmId]?.let { soon(it - ALARM_SOON_MS + 1_000L) }
                if (c.alarmId in s.ringingAlarmIds) soon(s.now + RINGING_POLL_MS)
            }
        }
        for (c in alarmCards(cfg, s)) { // карточка «Будильники»: показан один будильник, а балл зависит от всех
            s.alarms[c.alarmId]?.let { soon(it - ALARM_SOON_MS + 1_000L) }
            if (c.alarmId in s.ringingAlarmIds) soon(s.now + RINGING_POLL_MS)
        }
        return at
    }

    /** Сколько карточек сейчас в стопке (со служебными «Как тренировка?» и «Как настроение?»): для isAllDone и точек. */
    fun visibleCount(cfg: Cfg, s: Snapshot): Int = visible(cfg, s).size + (if (s.rpePending) 1 else 0) + (if (s.moodPending) 1 else 0)

    /** Карточка «Как тренировка?» — служебная, над всеми. */
    private fun rpeCard(cfg: Cfg): Card = Card(QrRpe.KEY, "", "Как тренировка?", emptyList(), emptySet(), emptySet(), "none", cfg.rpeColor)

    /** Карточка «Как настроение?» — служебная, над всеми обычными, под «Как тренировка?». */
    private fun moodCard(cfg: Cfg): Card = Card(QrMood.KEY, "", "Как настроение?", emptyList(), emptySet(), emptySet(), "none", cfg.moodColor)

    /** Служебная карточка стопки («Как тренировка?» / «Как настроение?»), а не настоящая. */
    private fun isService(key: String): Boolean = key == QrRpe.KEY || key == QrMood.KEY

    /** Ключ служебной карточки, что стоит наверху (у «Как тренировка?» приоритет выше); пусто — служебных карточек нет. */
    private fun serviceKeyOf(s: Snapshot): String = if (s.rpePending) QrRpe.KEY else if (s.moodPending) QrMood.KEY else ""

    /**
     * Ключ карточки, на которую стопка возвращается и от смены которой встаёт наверх: «Как тренировка?», а если её нет — «Как настроение?» (у любого виджета с этими галочками);
     * иначе (только «по релевантности») рекомендованная карточка, а если такой нет — верхняя карточка события или задачи календаря. Пусто — своего места нет.
     */
    private fun anchorOf(cfg: Cfg, s: Snapshot, main: List<Scored>, top: String, timerLead: Boolean = false): String {
        if (timerLead) return TIMER_SLOT_KEY // идущий таймер выше всего, в том числе служебных карточек и без «релевантности»
        val service = serviceKeyOf(s)
        if (service.isNotEmpty()) return service
        if (!cfg.relevance) return ""
        if (top.isNotEmpty()) return top
        val first = main.firstOrNull()?.card ?: return ""
        return if (isCal(first)) first.key else ""
    }

    // ---------- фильтр и перенос в конец ----------

    /** Сколько ближайших событий можно пролистать на карточке события. */
    const val EVENT_NAV_MAX = 10

    /** Ближайшие ещё не начавшиеся события в пределах [DYN_DAYS] суток по возрастанию времени (при равном — как их прислала страница), не больше [EVENT_NAV_MAX]. */
    fun eventCards(cfg: Cfg, s: Snapshot): List<Card> {
        val limit = dayStart(s.cal, s.now, if (cfg.eventsSoon) EVENTS_SOON_DAYS else DYN_DAYS) // «только сегодня и завтра»: до начала послезавтрашних суток
        return cfg.cards.filter { it.dyn == "event" && it.at > s.now && it.at < limit }.sortedBy { it.at }.take(EVENT_NAV_MAX)
    }

    /** Ключ события, которое сейчас показывает карточка «события календаря»: [Snapshot.eventIndex]-е из ближайших ([eventCards]; номер за краем списка — крайнее); пусто — показывать нечего. */
    fun nextEventKey(cfg: Cfg, s: Snapshot): String {
        val list = eventCards(cfg, s)
        if (list.isEmpty()) return ""
        return list[s.eventIndex.coerceIn(0, list.size - 1)].key
    }

    /** Сколько ближайших задач можно пролистать на карточке задач. */
    const val TASK_NAV_MAX = 12

    /** Невыполненные задачи в пределах [DYN_DAYS] суток по возрастанию времени (просроченные первыми; при равном — как их прислала страница), не больше [TASK_NAV_MAX]. */
    fun taskCards(cfg: Cfg, s: Snapshot): List<Card> {
        val limit = dayStart(s.cal, s.now, DYN_DAYS)
        return cfg.cards.filter { it.dyn == "task" && it.at < limit && !(it.tid.isNotEmpty() && it.tid in s.doneTaskIds) }.sortedBy { it.at }.take(TASK_NAV_MAX)
    }

    /** Ключ задачи, которую сейчас показывает единственная карточка задач: [Snapshot.taskIndex]-я из [taskCards] (номер за краем списка — крайняя); пусто — показывать нечего. */
    fun nextTaskKey(cfg: Cfg, s: Snapshot): String {
        val list = taskCards(cfg, s)
        if (list.isEmpty()) return ""
        return list[s.taskIndex.coerceIn(0, list.size - 1)].key
    }

    /** Сколько будильников можно пролистать на карточке «Будильники» (то же число — MAX_ALARMS в widgets.js). */
    const val ALARM_NAV_MAX = 16

    /** Все будильники пользователя для карточки «Будильники»: по времени суток (затем название и ключ — порядок не зависит от того, заведён будильник), не больше [ALARM_NAV_MAX]. */
    fun alarmCards(cfg: Cfg, s: Snapshot): List<Card> =
        cfg.cards.filter { it.dyn == "alarm" && it.alarmId.isNotEmpty() }
            .sortedWith(compareBy<Card>({ it.alarmSpec?.let { sp -> sp.hour * 60 + sp.minute } ?: Int.MAX_VALUE }, { it.title }, { it.key }))
            .take(ALARM_NAV_MAX)

    /** Какой будильник показан, пока ряд не листали: звонящий, иначе заведённый с ближайшим звонком, иначе первый по времени. */
    fun defaultAlarmIndex(list: List<Card>, s: Snapshot): Int {
        val ring = list.indexOfFirst { it.alarmId in s.ringingAlarmIds }
        if (ring >= 0) return ring
        var best = -1
        var bestAt = Long.MAX_VALUE
        for (i in list.indices) {
            val at = s.alarms[list[i].alarmId] ?: continue
            if (at < bestAt) { bestAt = at; best = i }
        }
        return if (best >= 0) best else 0
    }

    // ---------- карточки-группы ----------

    /**
     * Карточка-группа: ОДНА карточка стопки ([key], «hab_0» / «alm_0»), у которой несколько элементов ([items]) и у каждого свой балл ([scores], с причиной в [reasons]).
     * Балл карточки — балл самого важного элемента ([best]); очередей в круге равных у неё столько, сколько элементов с верхним баллом ([topIdx]). Какой элемент показан,
     * решает [Result.faces] (очередь круга), а при нажатии у края — оболочка ([QrWidgets.groupViews]). Новая группа подключается тем, что сообщает эти списки в [groups].
     */
    class Group(val key: String, val dyn: String, val items: List<Card>, val scores: List<Int>, val reasons: List<String>, val defaultIdx: Int) {
        /** Балл лучшего элемента; 0 — ни один элемент не поднимает карточку. */
        val best: Int get() { var b = 0; for (x in scores) if (x > b) b = x; return b }
        /** Номера элементов с верхним баллом (в порядке ряда); пусто, если баллов нет. */
        val topIdx: List<Int> get() { val b = best; return if (b <= 0) emptyList() else scores.indices.filter { scores[it] == b } }
        /** Сколько очередей круга занимает карточка. */
        val turns: Int get() = Math.max(1, topIdx.size)
    }

    /** Ключ карточки «Привычки» в стопке; префикс проверяется при нажатии у края карточки. */
    const val HABIT_SLOT_PREFIX = "hab_"
    const val HABIT_SLOT_KEY = HABIT_SLOT_PREFIX + "0"

    /** Ключ карточки «Будильники» в стопке (одна на все будильники пользователя). */
    const val ALARM_SLOT_PREFIX = "alm_"
    const val ALARM_SLOT_KEY = ALARM_SLOT_PREFIX + "0"

    /** Ключ карточки «Таймеры» в стопке (одна на все таймеры карточек QR-кодов). */
    const val TIMER_SLOT_PREFIX = "tmr_"
    const val TIMER_SLOT_KEY = TIMER_SLOT_PREFIX + "0"

    /** Ключ карточки-группы? Один список на все виды: оболочка и [check] различают по нему слот и обычную карточку. */
    fun isGroupKey(key: String): Boolean = key == HABIT_SLOT_KEY || key == ALARM_SLOT_KEY || key == TIMER_SLOT_KEY

    private fun isGroup(c: Card): Boolean = isGroupKey(c.key)

    /** Все карточки-группы виджета с их элементами и баллами (пустые группы — нет карточки). Единственное место, где перечислены виды групп. */
    fun groups(cfg: Cfg, s: Snapshot): List<Group> = listOfNotNull(timerGroup(cfg, s), alarmGroup(cfg, s), habitGroup(cfg, s))

    /** Карточка группы в стопке: лицо элемента по умолчанию, [Card.cycleN] — очередей круга, [Card.gscore] / [Card.greason] — балл и причина. */
    private fun slotOf(g: Group): Card {
        val b = g.items[g.defaultIdx.coerceIn(0, g.items.size - 1)]
        val tops = g.topIdx
        return Card(g.key, b.code, b.title, emptyList(), emptySet(), emptySet(), "none", b.color, g.dyn, 0L, habit = g.dyn == "habit",
            cycleN = g.turns, gscore = g.best, greason = if (tops.isEmpty()) "" else g.reasons[tops[0]])
    }

    /** Будильники: элемент — один будильник (серия: первый звонок и повторы). Звонит сейчас — [SCORE_ALARM_RINGING]; ближайший звонок серии через [ALARM_SOON_MS] или раньше — [SCORE_ALARM_SOON]; иначе 0. */
    private fun alarmGroup(cfg: Cfg, s: Snapshot): Group? {
        val list = alarmCards(cfg, s)
        if (list.isEmpty()) return null
        val scores = ArrayList<Int>()
        val reasons = ArrayList<String>()
        for (c in list) {
            val d = (s.alarms[c.alarmId] ?: Long.MAX_VALUE) - s.now
            if (c.alarmId in s.ringingAlarmIds) { scores.add(SCORE_ALARM_RINGING); reasons.add("Звонит будильник") }
            else if (d in 0..ALARM_SOON_MS) { scores.add(SCORE_ALARM_SOON); reasons.add("Будильник " + inMinutes(d)) }
            else { scores.add(0); reasons.add("") }
        }
        return Group(ALARM_SLOT_KEY, "alarm", list, scores, reasons, defaultAlarmIndex(list, s))
    }

    // ---------- карточка «Таймеры» ----------

    /** Сколько таймеров принимает карточка «Таймеры» (то же число — MAX_TIMERS в widgets.js). */
    const val TIMER_NAV_MAX = 24

    /** Таймеры карточки «Таймеры»: все таймеры пользователя в порядке сетки карточек, не больше [TIMER_NAV_MAX]; нет галочки — пусто. */
    fun timerList(cfg: Cfg): List<Card> = if (!cfg.timers) emptyList() else cfg.timerCards.take(TIMER_NAV_MAX)

    /** Таймер идёт или на паузе: любой из его id ([Card.live]: запущенный кнопкой карточки и запущенный по коду) есть среди [Snapshot.activeTimerIds]. */
    fun timerActive(c: Card, s: Snapshot): Boolean = c.live.any { it.k == "timer" && it.id.isNotEmpty() && it.id in s.activeTimerIds }

    /**
     * Таймеры: элемент — один таймер. Идёт — [SCORE_TIMER_ACTIVE]; не запущен, но сейчас «его» время суток и день ([scheduledNow]) — [SCORE_TIMER_DUE]; иначе 0 (в круг не входит, доступен краем).
     * По умолчанию показан первый идущий, иначе первый «в своё время», иначе первый в ряду. Несколько идущих (или несколько «в своё время») сменяют друг друга по минутам.
     */
    private fun timerGroup(cfg: Cfg, s: Snapshot): Group? {
        val list = timerList(cfg)
        if (list.isEmpty()) return null
        val scores = ArrayList<Int>()
        val reasons = ArrayList<String>()
        for (c in list) {
            if (timerActive(c, s)) { scores.add(SCORE_TIMER_ACTIVE); reasons.add("Идёт таймер") }
            else if (scheduledNow(c, s.cal)) { scores.add(SCORE_TIMER_DUE); reasons.add("Сейчас его время" + windowName(c, s.cal)) }
            else { scores.add(0); reasons.add("") }
        }
        val def = scores.indices.firstOrNull { scores[it] == SCORE_TIMER_ACTIVE } ?: scores.indices.firstOrNull { scores[it] == SCORE_TIMER_DUE } ?: 0
        return Group(TIMER_SLOT_KEY, "timer", list, scores, reasons, def)
    }

    /** Привычки: элемент — одна не отмеченная сегодня привычка ([habitList]); «в своё время» — [SCORE_CYCLE], остальные 0 (в круг не входят, доступны краем). */
    private fun habitGroup(cfg: Cfg, s: Snapshot): Group? {
        val list = habitList(cfg, s)
        if (list.isEmpty()) return null
        val scores = list.map { if (habitDue(it, s)) SCORE_CYCLE else 0 }
        val reasons = list.map { if (habitDue(it, s)) "Сейчас её время" + windowName(it, s.cal) else "" }
        return Group(HABIT_SLOT_KEY, "habit", list, scores, reasons, 0)
    }

    // ---------- карточка «Привычки» ----------

    /** Сколько привычек (кандидатов) принимает карточка «Привычки» (то же число — MAX_HABITS в widgets.js). */
    const val HABIT_NAV_MAX = 24

    private fun dayKeyOf(cal: Calendar): Int = cal.get(Calendar.YEAR) * 10000 + (cal.get(Calendar.MONTH) + 1) * 100 + cal.get(Calendar.DAY_OF_MONTH)

    /** Привычка отмечена сегодня: двойным нажатием в виджете (её ключ в [Snapshot.hiddenKeys]) или в приложении ([Card.doneDay] — последний отмеченный день, его присылает страница). */
    fun habitDone(c: Card, s: Snapshot): Boolean = c.key in s.hiddenKeys || (c.doneDay != 0 && c.doneDay == dayKeyOf(s.cal))

    /** Привычка «в своё время»: сейчас её время суток и день недели ([scheduledNow]); у привычки без времени и дней своего времени нет. */
    fun habitDue(c: Card, s: Snapshot): Boolean = scheduledNow(c, s.cal)

    /** Не отмеченные сегодня привычки: сначала те, у которых сейчас их время, затем остальные — каждая группа в порядке пользователя. Пусто, если галочки нет или все отмечены. */
    fun habitList(cfg: Cfg, s: Snapshot): List<Card> {
        if (!cfg.habits) return emptyList()
        val open = cfg.habitCards.filter { !habitDone(it, s) }
        return open.filter { habitDue(it, s) } + open.filter { !habitDue(it, s) }
    }

    /** Карточки-группы встают после остальных карточек и перед карточками заряда; «Будильники» — на месте первого из своих будильников в порядке пользователя. */
    private fun withGroups(shown: List<Card>, gs: List<Group>, alarmAt: Int): List<Card> {
        if (gs.isEmpty()) return shown
        val out = ArrayList<Card>(shown)
        for (g in gs) {
            if (g.dyn == "alarm") { out.add(if (alarmAt in 0..out.size) alarmAt else out.size, slotOf(g)); continue }
            val at = out.indexOfFirst { isBattery(it.key) }
            out.add(if (at < 0) out.size else at, slotOf(g))
        }
        return out
    }

    /** Задача — только та, что выбрана [nextTaskKey] (одна карточка на все задачи); событие — только то, что выбрано [nextEventKey]; будильник — только слот группы ([ALARM_SLOT_KEY]), сами будильники карточками не стоят. */
    private fun dynShown(c: Card, nextEv: String, nextTask: String): Boolean = when (c.dyn) {
        "task" -> c.key == nextTask
        "event" -> c.key == nextEv
        "alarm" -> isGroup(c)
        else -> true
    }

    private fun isShown(c: Card, s: Snapshot, nextEv: String, nextTask: String): Boolean =
        !((c.after == "hide" || c.habit) && c.key in s.hiddenKeys) &&
            !(c.dyn == "task" && c.tid.isNotEmpty() && c.tid in s.doneTaskIds) &&
            dynShown(c, nextEv, nextTask)

    /** Карточки, которые видны в стопке: в порядке «как собрал пользователь, перенесённые в конец — после них, по времени переноса». */
    private fun visible(cfg: Cfg, s: Snapshot, gs: List<Group> = groups(cfg, s)): List<Card> {
        val nextEv = nextEventKey(cfg, s)
        val nextTask = nextTaskKey(cfg, s)
        val plain = ArrayList<Card>()
        var alarmAt = -1
        for (c in cfg.cards) {
            if (c.dyn == "alarm") { if (alarmAt < 0) alarmAt = plain.size; continue } // будильники — элементы группы, место карточки — на месте первого
            if (isShown(c, s, nextEv, nextTask)) plain.add(c)
        }
        val shown = withGroups(plain, gs, alarmAt)
        if (shown.none { it.after == "end" && s.movedAt.containsKey(it.key) }) return shown
        return shown.withIndex().sortedWith(
            compareBy<IndexedValue<Card>> { if (it.value.after == "end") (s.movedAt[it.value.key] ?: 0L) else 0L }.thenBy { it.index }
        ).map { it.value }
    }

    /** Карточка «в конец» перенесена сегодня (со следующих суток снова участвует в основной части). */
    private fun movedToday(c: Card, s: Snapshot): Boolean {
        if (c.after != "end") return false
        return (s.movedAt[c.key] ?: 0L) >= dayStart(s.cal, s.now, 0)
    }

    // ---------- баллы ----------

    /** Балл карточки и причина (для объяснения): максимум по сигналам, не сумма. У карточки-группы — балл самого важного элемента ([Card.gscore]). */
    private fun scoreOf(c: Card, s: Snapshot, rowTaskAt: Long = 0L): Pair<Int, String> {
        var best = 0
        var why = ""
        fun cand(sc: Int, w: String) { if (sc > best) { best = sc; why = w } }
        if (isGroup(c)) {
            cand(c.gscore, c.greason)
        } else {
            for (l in c.live) {
                when (l.k) {
                    "workout" -> if (s.workoutActive) cand(SCORE_WORKOUT, "Идёт тренировка")
                    "pomodoro" -> if (s.pomodoroActive) cand(SCORE_POMODORO, "Идёт помодоро")
                    "timer" -> if (l.id.isNotEmpty() && l.id in s.activeTimerIds) cand(SCORE_TIMER, "Идёт таймер")
                    "stopwatch" -> if (s.stopwatchActive) cand(SCORE_STOPWATCH, "Идёт секундомер")
                }
            }
            if (c.alarmId.isNotEmpty()) {
                if (c.alarmId in s.ringingAlarmIds) cand(SCORE_ALARM_RINGING, "Звонит будильник")
                else s.alarms[c.alarmId]?.let { at ->
                    val d = at - s.now
                    if (d in 0..ALARM_SOON_MS) cand(SCORE_ALARM_SOON, "Будильник " + inMinutes(d))
                }
            }
            if (c.dyn == "event") {
                val d = c.at - s.now
                if (d in 0..SOON_MS) cand(SCORE_EVENT_SOON, "Событие " + inMinutes(d))
                cand(SCORE_CYCLE, "Календарь: по очереди с равными") // событие в окне — наравне с привычкой «в своё время» и другими карточками того же балла (круг равных)
            }
            if (c.dyn == "task") {
                val at = if (rowTaskAt > 0L) rowTaskAt else c.at // по первой (самой срочной) задаче ряда
                if (at < s.now) cand(SCORE_TASK_OVERDUE, "Задача просрочена")
                else if (at < dayStart(s.cal, s.now, 1)) cand(SCORE_TASK_TODAY, "Задача на сегодня")
            }
            if (isBattery(c.key) && s.batteryPercent in 0..BATTERY_LOW_PERCENT) cand(SCORE_BATTERY_LOW, "Заряд " + s.batteryPercent + " %")
            if (scheduledNow(c, s.cal)) cand(SCORE_SCHEDULED, "Сейчас её время" + windowName(c, s.cal))
        }
        if (c.prio == "top") {
            best += PRIO_TOP_BONUS
            why = if (why.isEmpty()) "Приоритет «наверх»" else why + " · приоритет «наверх»"
        } else if (c.prio == "low") {
            best = SCORE_LOW
            why = ""
        }
        return Pair(best, why)
    }

    /** «через N мин» (с округлением вверх; меньше минуты — «сейчас»). */
    private fun inMinutes(ms: Long): String {
        val m = (ms + 59_999L) / 60_000L
        return if (m <= 0L) "сейчас" else "через $m мин"
    }

    /** «: утро» / «: обед» / «: вечер» — окно, в которое попали сейчас; у карточки без времени суток (только дни недели) пусто. */
    private fun windowName(c: Card, cal: Calendar): String {
        val m = cal.get(Calendar.HOUR_OF_DAY) * 60 + cal.get(Calendar.MINUTE)
        for (k in listOf("m", "d", "e")) {
            val w = WINDOWS[k] ?: continue
            if (k in c.times && m >= w.first && m < w.second) return ": " + (if (k == "m") "утро" else if (k == "d") "обед" else "вечер")
        }
        return ""
    }

    private fun scheduledNow(c: Card, cal: Calendar): Boolean {
        if (c.times.isEmpty() && c.days.isEmpty()) return false
        val dow = cal.get(Calendar.DAY_OF_WEEK)
        val wd = if (dow == Calendar.SUNDAY) 7 else dow - 1
        if (c.days.isNotEmpty() && wd !in c.days) return false
        if (c.times.isNotEmpty()) {
            val m = cal.get(Calendar.HOUR_OF_DAY) * 60 + cal.get(Calendar.MINUTE)
            if (c.times.none { k -> WINDOWS[k]?.let { m >= it.first && m < it.second } == true }) return false
        }
        return true
    }

    // ---------- время ----------

    /** Начало суток через [days] календарных дней от [now] (0 — сегодняшняя полночь; переход на летнее время не сдвигает). */
    private fun dayStart(zone: Calendar, now: Long, days: Int): Long {
        val c = zone.clone() as Calendar
        c.timeInMillis = now
        c.set(Calendar.HOUR_OF_DAY, 0); c.set(Calendar.MINUTE, 0); c.set(Calendar.SECOND, 0); c.set(Calendar.MILLISECOND, 0)
        if (days != 0) c.add(Calendar.DAY_OF_YEAR, days)
        return c.timeInMillis
    }

    /** Ближайшая после [now] граница окон времени суток (0, 5, 11, 15, 17, 23 ч; полночь — следующие сутки) плюс 5 секунд. */
    fun nextBoundary(now: Long, zone: Calendar): Long {
        val c = zone.clone() as Calendar
        c.timeInMillis = now
        val cur = c.get(Calendar.HOUR_OF_DAY) * 60 + c.get(Calendar.MINUTE)
        val next = BOUNDARIES.firstOrNull { it > cur } ?: (24 * 60)
        c.set(Calendar.HOUR_OF_DAY, 0); c.set(Calendar.MINUTE, 0); c.set(Calendar.SECOND, 5); c.set(Calendar.MILLISECOND, 0)
        c.add(Calendar.MINUTE, next)
        return c.timeInMillis
    }

    // ---------- инварианты ----------

    /** Нарушения инвариантов результата (ТЗ, п. 3); пусто — всё хорошо. Не меняет ничего и не бросает исключений. */
    fun check(result: Result, cfg: Cfg, s: Snapshot): List<String> {
        val bad = ArrayList<String>()
        val cards = result.cards.map { it.card }
        val keys = cards.map { it.key }

        // 0. Идущий таймер карточки «Таймеры» ([SCORE_TIMER_ACTIVE]) — самая первая карточка, над служебными; нет идущего — её нет наверху «по праву таймера»
        val timerLifted = groups(cfg, s).any { it.dyn == "timer" && it.best >= SCORE_TIMER_ACTIVE }
        val lead = if (timerLifted) 1 else 0
        if (timerLifted && keys.firstOrNull() != TIMER_SLOT_KEY) bad.add("0: идёт таймер, но карточка «Таймеры» не первая")

        // 1. «Как тренировка?» — только если ждёт оценки, и тогда первая (после идущего таймера); «Как настроение?» — только если ждёт отметки, и тогда сразу под ней (или первая)
        val rpeAt = keys.indexOf(QrRpe.KEY)
        if (s.rpePending) {
            if (rpeAt != lead) bad.add("1: rpePending, но «Как тренировка?» не первая")
        } else if (rpeAt >= 0) bad.add("1: «Как тренировка?» есть без rpePending")
        if (keys.count { it == QrRpe.KEY } > 1) bad.add("1: «Как тренировка?» больше одной")
        val moodAt = keys.indexOf(QrMood.KEY)
        if (s.moodPending) {
            if (moodAt != lead + (if (s.rpePending) 1 else 0)) bad.add("1: moodPending, но «Как настроение?» не на своём месте")
        } else if (moodAt >= 0) bad.add("1: «Как настроение?» есть без moodPending")
        if (keys.count { it == QrMood.KEY } > 1) bad.add("1: «Как настроение?» больше одной")
        val main = cards.filter { !isService(it.key) }

        // 2. и 6. Нет скрытых, выполненных и вне окна; нет дублей; ничего не потеряно
        val nextEv = nextEventKey(cfg, s)
        val nextTask = nextTaskKey(cfg, s)
        for (c in main) if (!isShown(c, s, nextEv, nextTask)) bad.add("2: лишняя карточка " + c.key)
        if (keys.toSet().size != keys.size) bad.add("6: дубли ключей")
        for (c in cfg.cards) if (isShown(c, s, nextEv, nextTask) && main.none { it.key == c.key }) bad.add("6: потеряна карточка " + c.key)
        for (g in groups(cfg, s)) if (main.count { it.key == g.key } != 1) bad.add("6: у группы " + g.key + " не одна карточка") // группа — всегда одна карточка, сколько бы элементов ни было

        // 3. «В конец», перенесённые сегодня, — подряд в самом конце, в порядке переноса
        val movedIdx = main.indices.filter { movedToday(main[it], s) }
        if (movedIdx.isNotEmpty()) {
            if (movedIdx.first() != main.size - movedIdx.size) bad.add("3: перенесённые сегодня не в самом конце")
            for (i in 1 until movedIdx.size) {
                if ((s.movedAt[main[movedIdx[i]].key] ?: 0L) < (s.movedAt[main[movedIdx[i - 1]].key] ?: 0L)) bad.add("3: перенесённые не в порядке переноса")
            }
        }

        // 4. При равном балле событие выше задачи
        val scored = result.cards.filter { !isService(it.card.key) }
        for (i in scored.indices) for (j in i + 1 until scored.size) {
            // исключение: удержанная устойчивостью верхняя карточка стоит первой, даже если рядом событие с тем же баллом
            val held = i == 0 && scored[0].card.key == result.mainTopKey && result.mainTopKey == s.lastTopKey
            val inCycle = cfg.relevance && cycleSize(scored) >= 2 && scored[i].score == scored[0].score && scored[j].score == scored[0].score // круг равных ставит наверх по очереди любого
            if (!held && !inCycle && scored[i].score == scored[j].score && scored[i].card.dyn == "task" && scored[j].card.dyn == "event") bad.add("4: задача выше события при равном балле")
        }

        // 5. Без релевантности — порядок пользователя, topKey пуст (кроме служебных)
        if (!cfg.relevance) {
            val order = cfg.cards.map { it.key }
            val rest = main.filter { it.key in order && !(it.after == "end" && s.movedAt.containsKey(it.key)) } // слоты привычек не из cfg.cards — их место определяет сама стопка
            val pos = rest.map { order.indexOf(it.key) }
            for (i in 1 until pos.size) if (pos[i] < pos[i - 1]) bad.add("5: нарушен порядок пользователя")
            if (result.topKey.isNotEmpty() && !isService(result.topKey) && !(timerLifted && result.topKey == TIMER_SLOT_KEY)) bad.add("5: topKey не пуст без релевантности")
        }

        // 7. topKey — первая карточка основной части (или служебная карточка наверху)
        if (result.topKey.isNotEmpty() && !isService(result.topKey) && main.firstOrNull()?.key != result.topKey) bad.add("7: topKey не первая карточка основной части")
        if (result.topKey == QrRpe.KEY && rpeAt != lead) bad.add("7: topKey — rpe, но её нет наверху")
        if (result.topKey == QrMood.KEY && moodAt != lead) bad.add("7: topKey — настроение, но его нет наверху")
        if (timerLifted && result.topKey != TIMER_SLOT_KEY) bad.add("7: идёт таймер, но topKey — не карточка «Таймеры»")

        // 8. При «релевантности» основная часть (без перенесённых) идёт по убыванию баллов; удержанная верхняя карточка — вне счёта
        if (cfg.relevance) {
            val head = result.cards.filter { !isService(it.card.key) && !movedToday(it.card, s) }
            val from = if (head.isNotEmpty() && head[0].card.key == result.mainTopKey && result.mainTopKey == s.lastTopKey) 1 else 0
            for (i in from + 1 until head.size) if (head[i].score > head[i - 1].score) bad.add("8: баллы не по убыванию у " + head[i].card.key)

            // 9. Гистерезис: верхняя карточка сменилась только при отрыве минимум на HYSTERESIS, падении прежней до 0 или звонящем будильнике
            val prev = result.cards.firstOrNull { it.card.key == s.lastTopKey && !movedToday(it.card, s) }
            val topS = result.cards.firstOrNull { it.card.key == result.mainTopKey && !isService(it.card.key) }
            if (prev != null && topS != null && prev !== topS && prev.score > 0 && topS.score < prev.score + HYSTERESIS &&
                prev.score != topS.score && // равные баллы: верх меняет круг равных, гистерезис его не держит
                !(prev.card.dyn == "task" && (topS.card.dyn == "event" || isGroup(topS.card))) &&
                !(isRinging(topS.card, s) && !isRinging(prev.card, s))) bad.add("9: верхняя карточка сменилась без достаточного отрыва")

            // 10. и 11. Ручной приоритет: «вниз» — балл не выше нуля, «наверх» — не ниже прибавки (баллы считаются, только когда в основной части две карточки и больше)
            for (x in head) {
                if (x.card.prio == "low" && x.score > 0) bad.add("10: у карточки с приоритетом «вниз» балл выше нуля: " + x.card.key)
                if (main.size >= 2 && x.card.prio == "top" && x.score < PRIO_TOP_BONUS) bad.add("11: у карточки с приоритетом «наверх» балл ниже прибавки: " + x.card.key)
            }
        }
        return bad
    }
}
