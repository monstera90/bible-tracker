package com.app.lifetracker
// Версия: 4.1 (14.11) — карточка «Будильники» (dyn = "alarm"): одна на все будильники пользователя, листается у краёв как события и задачи ([alarmCards], [nextAlarmKey]).
// Версия: 4.0 (14.11)

import com.app.lifetracker.QrWidgets.Card
import com.app.lifetracker.QrWidgets.Cfg
import java.util.Calendar

/**
 * Порядок карточек стопки виджета «Стопка QR-карточек» и ответ на вопрос «что сейчас должно лежать сверху» (ТЗ TZ_card_priority.md).
 *
 * Чистая функция: без Android, SharedPreferences и часов — всё нужное приходит в [Snapshot] (его собирает [QrWidgets.snapshot]).
 * Слои стопки сверху вниз: 1) служебная «Как тренировка?» ([QrRpe.KEY]); 2) основная часть — отфильтрованные карточки, при «релевантности»
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
    /** Будильник карточки сработает в ближайшие [SOON_MS] (заведённый позже — 0). */
    const val SCORE_ALARM_SOON = 800
    /** Событие календаря начнётся в ближайшие [SOON_MS]. */
    const val SCORE_EVENT_SOON = 750
    /** Задача календаря просрочена. */
    const val SCORE_TASK_OVERDUE = 650
    /** Задача календаря на сегодня (время ещё не прошло). */
    const val SCORE_TASK_TODAY = 520
    /** «Её» время суток и день недели ([scheduledNow]). */
    const val SCORE_SCHEDULED = 500
    /** Заряд телефона не выше [BATTERY_LOW_PERCENT] — только карточки заряда. */
    const val SCORE_BATTERY_LOW = 450
    const val BATTERY_LOW_PERCENT = 15
    /** Ручной приоритет «наверх»: прибавка к баллу карточки (при любых её сигналах; без сигналов балл = эта прибавка). */
    const val PRIO_TOP_BONUS = 300
    /** Ручной приоритет «вниз»: балл не выше нуля — на единицу ниже обычных карточек без сигналов, чтобы карточка действительно стояла после них. */
    const val SCORE_LOW = -1

    /** «Скоро»: за сколько до будильника или события оно поднимает карточку. */
    const val SOON_MS = 60L * 60_000L
    /** Новая верхняя карточка заменяет прежнюю, если её балл выше минимум на столько. */
    const val HYSTERESIS = 100
    /** Пока звонит будильник, порядок перепроверяется с этим шагом (смахнутое уведомление и его таймаут не присылают события). */
    private const val RINGING_POLL_MS = 60_000L

    /** Окно задач и событий: сегодня и ещё шесть дней (совпадает с FEED_DAYS в widgets.js). */
    const val DYN_DAYS = 7

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
        val lastTopKey: String = "",
        /** Какое по счёту из ближайших событий показывает карточка события (0 — первое; нажатие у края карточки листает, без зацикливания). */
        val eventIndex: Int = 0,
        /** Какая по счёту из ближайших задач показана на единственной карточке задач (0 — первая; нажатие у края листает, без зацикливания). */
        val taskIndex: Int = 0,
        /** Какой по счёту будильник показывает карточка «Будильники» (по времени суток, [alarmCards]); -1 — не листали: показан главный ([defaultAlarmIndex]: звонящий, иначе ближайший заведённый). */
        val alarmIndex: Int = -1,
        /** Звонит какой-нибудь из будильников карточки «Будильники» (карточка при этом не отдаёт верх устойчивостью, как звонящий будильник обычной карточки). */
        val alarmRowRinging: Boolean = false
    )

    class Scored(val card: Card, val score: Int, val reason: String)

    class Result(
        /** Итоговый порядок: rpe, основная часть, хвост. */
        val cards: List<Scored>,
        /** Карточка наверху по релевантности ("" — нет); у «Как тренировка?» — [QrRpe.KEY]. */
        val topKey: String,
        /** К чему возвращаться и от смены чего вставать наверх (прежние anchorKey/topAnchor). */
        val anchorKey: String,
        /**
         * Когда порядок может измениться без внешнего события (только при «релевантности»; иначе [Long.MAX_VALUE]): ближайшее из границы окон времени
         * суток, «до события 60 мин», «до будильника 60 мин», времени задачи на сегодня (станет просроченной), а пока звонит будильник — через минуту.
         */
        val nextChangeAt: Long,
        /** Верхняя карточка по релевантности без «Как тренировка?» — её оболочка запоминает как [Snapshot.lastTopKey] для следующего расчёта. */
        val mainTopKey: String = "",
        /** Название верхней карточки ([topKey]); пусто, если наверху нет выделенной карточки. */
        val topTitle: String = "",
        /** Почему она наверху («Идёт тренировка», «Будильник через 25 мин», «Сейчас её время: утро»); пусто, если [topKey] пуст. */
        val topReason: String = ""
    )

    // ---------- построение ----------

    fun build(cfg: Cfg, s: Snapshot): Result {
        val base = visible(cfg, s)
        val rowTaskAt = taskCards(cfg, s).firstOrNull()?.at ?: 0L // балл карточки задач считается по первой задаче ряда: листание не двигает карточку в стопке
        val rowAlarm = alarmRowScore(cfg, s) // то же для карточки будильников: балл по всем будильникам ряда, а не по показанному
        val main = ArrayList<Scored>()
        var top = ""
        if (!cfg.relevance || base.size < 2) {
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
                    val sc = scoreOf(c, s, rowTaskAt, rowAlarm)
                    scored.add(Scored(c, sc.first, sc.second))
                }
                lift(scored)
                // sortedWith устойчивая: при равных баллах остаётся порядок пользователя; события и заряд уточняет tidy
                val sorted = ArrayList(tidy(scored.sortedWith(compareByDescending<Scored> { it.score })))
                if (sorted.first().score > 0) top = sorted.first().card.key
                top = keepPrevTop(sorted, top, s)
                main.addAll(sorted)
                for (c in tail) main.add(Scored(c, 0, ""))
            }
        }
        val out = ArrayList<Scored>()
        if (s.rpePending) out.add(Scored(rpeCard(), 0, "Ждёт оценки тренировки"))
        out.addAll(main)
        val topKey = if (s.rpePending) QrRpe.KEY else top
        val next = if (cfg.relevance) nextChange(cfg, base, s, rowTaskAt) else Long.MAX_VALUE
        val topScored: Scored? = if (s.rpePending) out.firstOrNull() else if (top.isNotEmpty()) main.firstOrNull() else null
        return Result(out, topKey, anchorOf(cfg, s, main, top), next, top, topScored?.card?.title ?: "", topScored?.reason ?: "")
    }

    /**
     * Событие календаря важнее задач: если в стопке есть задача с баллом, событие получает балл самой «сильной» задачи плюс [HYSTERESIS] (иначе
     * удержание прежней верхней карточки оставило бы наверху задачу). Раньше событие дальше часа до начала имело балл 0 и стояло ниже любой задачи
     * на сегодня — новый виджет вставал на задаче, а не на календаре. Более высокие баллы события («скоро», приоритет «наверх») не трогаются.
     */
    private fun lift(scored: MutableList<Scored>) {
        var maxTask = 0
        for (x in scored) if (x.card.dyn == "task" && x.score > maxTask) maxTask = x.score
        if (maxTask <= 0) return
        val want = maxTask + HYSTERESIS
        for (i in scored.indices) {
            val x = scored[i]
            if (x.card.dyn == "event" && x.score < want) scored[i] = Scored(x.card, want, "Календарь выше задач")
        }
    }

    /**
     * Устойчивость: прежняя верхняя карточка ([prev]) остаётся наверху, если новая лидирует меньше чем на [HYSTERESIS] баллов; сменить её сразу могут
     * лишь окончание сигнала (у прежней балл 0), её уход из основной части или звонящий будильник. Удержанная карточка переезжает в начало [sorted],
     * остальной порядок не трогается. Возвращает ключ верхней карточки.
     */
    private fun keepPrevTop(sorted: MutableList<Scored>, top: String, s: Snapshot): String {
        val prev = s.lastTopKey
        if (top.isEmpty() || prev.isEmpty() || prev == top || prev == QrRpe.KEY) return top
        val idx = sorted.indexOfFirst { it.card.key == prev }
        if (idx <= 0) return top
        val ps = sorted[idx].score
        val first = sorted[0].score
        if (ps <= 0 || first >= ps + HYSTERESIS) return top
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
                s.alarms[c.alarmId]?.let { soon(it - SOON_MS + 1_000L) }
                if (c.alarmId in s.ringingAlarmIds) soon(s.now + RINGING_POLL_MS)
            }
        }
        for (c in alarmCards(cfg, s)) { // карточка «Будильники»: показан один будильник, а балл зависит от всех
            s.alarms[c.alarmId]?.let { soon(it - SOON_MS + 1_000L) }
            if (c.alarmId in s.ringingAlarmIds) soon(s.now + RINGING_POLL_MS)
        }
        return at
    }

    /** Сколько карточек сейчас в стопке (с «Как тренировка?»): для isAllDone и точек. */
    fun visibleCount(cfg: Cfg, s: Snapshot): Int = visible(cfg, s).size + (if (s.rpePending) 1 else 0)

    /** Карточка «Как тренировка?» — служебная, над всеми. */
    private fun rpeCard(): Card = Card(QrRpe.KEY, "", "Как тренировка?", emptyList(), emptySet(), emptySet(), "none", QrRpe.DEFAULT_COLOR)

    /**
     * Ключ карточки, на которую стопка возвращается и от смены которой встаёт наверх: «Как тренировка?» (у любого виджета с этой галочкой);
     * иначе (только «по релевантности») рекомендованная карточка, а если такой нет — верхняя карточка события или задачи календаря. Пусто — своего места нет.
     */
    private fun anchorOf(cfg: Cfg, s: Snapshot, main: List<Scored>, top: String): String {
        if (s.rpePending) return QrRpe.KEY
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
        val limit = dayStart(s.cal, s.now, DYN_DAYS)
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

    /** Номер показанного будильника в [alarmCards] (когда ряд листали — [Snapshot.alarmIndex], иначе [defaultAlarmIndex]). */
    fun alarmShownIndex(list: List<Card>, s: Snapshot): Int =
        if (list.isEmpty()) 0 else if (s.alarmIndex < 0) defaultAlarmIndex(list, s) else s.alarmIndex.coerceIn(0, list.size - 1)

    /** Ключ будильника, который сейчас показывает карточка «Будильники»; пусто — показывать нечего. */
    fun nextAlarmKey(cfg: Cfg, s: Snapshot): String {
        val list = alarmCards(cfg, s)
        if (list.isEmpty()) return ""
        return list[alarmShownIndex(list, s)].key
    }

    /**
     * Балл карточки «Будильники» (один на весь ряд, чтобы листание не двигало карточку в стопке): звонит любой — [SCORE_ALARM_RINGING], иначе какой-то
     * заведённый зазвонит в ближайшие [SOON_MS] — [SCORE_ALARM_SOON]; null — сигналов нет.
     */
    private fun alarmRowScore(cfg: Cfg, s: Snapshot): Pair<Int, String>? {
        val list = alarmCards(cfg, s)
        if (list.isEmpty()) return null
        if (list.any { it.alarmId in s.ringingAlarmIds }) return Pair(SCORE_ALARM_RINGING, "Звонит будильник")
        var soonest = Long.MAX_VALUE
        for (c in list) {
            val d = (s.alarms[c.alarmId] ?: continue) - s.now
            if (d in 0..SOON_MS && d < soonest) soonest = d
        }
        return if (soonest == Long.MAX_VALUE) null else Pair(SCORE_ALARM_SOON, "Будильник " + inMinutes(soonest))
    }

    /** Задача — только та, что выбрана [nextTaskKey] (одна карточка на все задачи); событие — только то, что выбрано [nextEventKey]; будильник — [nextAlarmKey]. */
    private fun dynShown(c: Card, nextEv: String, nextTask: String, nextAlarm: String): Boolean = when (c.dyn) {
        "task" -> c.key == nextTask
        "event" -> c.key == nextEv
        "alarm" -> c.key == nextAlarm
        else -> true
    }

    private fun isShown(c: Card, s: Snapshot, nextEv: String, nextTask: String, nextAlarm: String): Boolean =
        !((c.after == "hide" || c.habit) && c.key in s.hiddenKeys) &&
            !(c.dyn == "task" && c.tid.isNotEmpty() && c.tid in s.doneTaskIds) &&
            dynShown(c, nextEv, nextTask, nextAlarm)

    /** Карточки, которые видны в стопке: в порядке «как собрал пользователь, перенесённые в конец — после них, по времени переноса». */
    private fun visible(cfg: Cfg, s: Snapshot): List<Card> {
        val nextEv = nextEventKey(cfg, s)
        val nextTask = nextTaskKey(cfg, s)
        val nextAlarm = nextAlarmKey(cfg, s)
        val shown = cfg.cards.filter { isShown(it, s, nextEv, nextTask, nextAlarm) }
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

    /** Балл карточки и причина (для объяснения): максимум по сигналам, не сумма. */
    private fun scoreOf(c: Card, s: Snapshot, rowTaskAt: Long = 0L, rowAlarm: Pair<Int, String>? = null): Pair<Int, String> {
        var best = 0
        var why = ""
        fun cand(sc: Int, w: String) { if (sc > best) { best = sc; why = w } }
        for (l in c.live) {
            when (l.k) {
                "workout" -> if (s.workoutActive) cand(SCORE_WORKOUT, "Идёт тренировка")
                "pomodoro" -> if (s.pomodoroActive) cand(SCORE_POMODORO, "Идёт помодоро")
                "timer" -> if (l.id.isNotEmpty() && l.id in s.activeTimerIds) cand(SCORE_TIMER, "Идёт таймер")
                "stopwatch" -> if (s.stopwatchActive) cand(SCORE_STOPWATCH, "Идёт секундомер")
            }
        }
        if (c.dyn == "alarm") {
            rowAlarm?.let { cand(it.first, it.second) }
        } else if (c.alarmId.isNotEmpty()) {
            if (c.alarmId in s.ringingAlarmIds) cand(SCORE_ALARM_RINGING, "Звонит будильник")
            else s.alarms[c.alarmId]?.let { at ->
                val d = at - s.now
                if (d in 0..SOON_MS) cand(SCORE_ALARM_SOON, "Будильник " + inMinutes(d))
            }
        }
        if (c.dyn == "event") {
            val d = c.at - s.now
            if (d in 0..SOON_MS) cand(SCORE_EVENT_SOON, "Событие " + inMinutes(d))
        }
        if (c.dyn == "task") {
            val at = if (rowTaskAt > 0L) rowTaskAt else c.at // по первой (самой срочной) задаче ряда
            if (at < s.now) cand(SCORE_TASK_OVERDUE, "Задача просрочена")
            else if (at < dayStart(s.cal, s.now, 1)) cand(SCORE_TASK_TODAY, "Задача на сегодня")
        }
        if (isBattery(c.key) && s.batteryPercent in 0..BATTERY_LOW_PERCENT) cand(SCORE_BATTERY_LOW, "Заряд " + s.batteryPercent + " %")
        if (scheduledNow(c, s.cal)) cand(SCORE_SCHEDULED, "Сейчас её время" + windowName(c, s.cal))
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

        // 1. «Как тренировка?» — только если ждёт оценки, и тогда первая
        val rpeAt = keys.indexOf(QrRpe.KEY)
        if (s.rpePending) {
            if (rpeAt != 0) bad.add("1: rpePending, но «Как тренировка?» не первая")
        } else if (rpeAt >= 0) bad.add("1: «Как тренировка?» есть без rpePending")
        if (keys.count { it == QrRpe.KEY } > 1) bad.add("1: «Как тренировка?» больше одной")
        val main = if (rpeAt == 0) cards.drop(1) else cards

        // 2. и 6. Нет скрытых, выполненных и вне окна; нет дублей; ничего не потеряно
        val nextEv = nextEventKey(cfg, s)
        val nextTask = nextTaskKey(cfg, s)
        val nextAlarm = nextAlarmKey(cfg, s)
        for (c in main) if (!isShown(c, s, nextEv, nextTask, nextAlarm)) bad.add("2: лишняя карточка " + c.key)
        if (keys.toSet().size != keys.size) bad.add("6: дубли ключей")
        for (c in cfg.cards) if (isShown(c, s, nextEv, nextTask, nextAlarm) && main.none { it.key == c.key }) bad.add("6: потеряна карточка " + c.key)

        // 3. «В конец», перенесённые сегодня, — подряд в самом конце, в порядке переноса
        val movedIdx = main.indices.filter { movedToday(main[it], s) }
        if (movedIdx.isNotEmpty()) {
            if (movedIdx.first() != main.size - movedIdx.size) bad.add("3: перенесённые сегодня не в самом конце")
            for (i in 1 until movedIdx.size) {
                if ((s.movedAt[main[movedIdx[i]].key] ?: 0L) < (s.movedAt[main[movedIdx[i - 1]].key] ?: 0L)) bad.add("3: перенесённые не в порядке переноса")
            }
        }

        // 4. При равном балле событие выше задачи
        val scored = result.cards.filter { it.card.key != QrRpe.KEY }
        for (i in scored.indices) for (j in i + 1 until scored.size) {
            // исключение: удержанная устойчивостью верхняя карточка стоит первой, даже если рядом событие с тем же баллом
            val held = i == 0 && scored[0].card.key == result.mainTopKey && result.mainTopKey == s.lastTopKey
            if (!held && scored[i].score == scored[j].score && scored[i].card.dyn == "task" && scored[j].card.dyn == "event") bad.add("4: задача выше события при равном балле")
        }

        // 5. Без релевантности — порядок пользователя, topKey пуст (кроме rpe)
        if (!cfg.relevance) {
            val rest = main.filter { !(it.after == "end" && s.movedAt.containsKey(it.key)) }
            val order = cfg.cards.map { it.key }
            val pos = rest.map { order.indexOf(it.key) }
            for (i in 1 until pos.size) if (pos[i] < pos[i - 1]) bad.add("5: нарушен порядок пользователя")
            if (result.topKey.isNotEmpty() && result.topKey != QrRpe.KEY) bad.add("5: topKey не пуст без релевантности")
        }

        // 7. topKey — первая карточка основной части (или «Как тренировка?»)
        if (result.topKey.isNotEmpty() && result.topKey != QrRpe.KEY && main.firstOrNull()?.key != result.topKey) bad.add("7: topKey не первая карточка основной части")
        if (result.topKey == QrRpe.KEY && rpeAt != 0) bad.add("7: topKey — rpe, но её нет наверху")

        // 8. При «релевантности» основная часть (без перенесённых) идёт по убыванию баллов; удержанная верхняя карточка — вне счёта
        if (cfg.relevance) {
            val head = result.cards.filter { it.card.key != QrRpe.KEY && !movedToday(it.card, s) }
            val from = if (head.isNotEmpty() && head[0].card.key == result.mainTopKey && result.mainTopKey == s.lastTopKey) 1 else 0
            for (i in from + 1 until head.size) if (head[i].score > head[i - 1].score) bad.add("8: баллы не по убыванию у " + head[i].card.key)

            // 9. Гистерезис: верхняя карточка сменилась только при отрыве минимум на HYSTERESIS, падении прежней до 0 или звонящем будильнике
            val prev = result.cards.firstOrNull { it.card.key == s.lastTopKey && !movedToday(it.card, s) }
            val topS = result.cards.firstOrNull { it.card.key == result.mainTopKey && it.card.key != QrRpe.KEY }
            if (prev != null && topS != null && prev !== topS && prev.score > 0 && topS.score < prev.score + HYSTERESIS &&
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
