package com.app.lifetracker
// Версия: 4.1 (14.11) — служебная карточка «Как настроение?» (mood_*): над календарём, под «Как тренировка?».
// Версия: 4.0 (14.11) — будильник «скоро» за 30 минут, а не за час; будильник «скоро» перебивает событие (alarmSoon_beatsEventSoon_*, alarmRow_soonBeatsEvent_*).
// Версия: 3.5 (14.11) — карточка «Будильники» (alarmRow_*).
// Версия: 3.4 (14.11)

import com.app.lifetracker.QrWidgets.Card
import com.app.lifetracker.QrWidgets.Cfg
import com.app.lifetracker.QrWidgets.Live
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.Calendar

/** Сценарии из ТЗ TZ_card_priority.md, п. 7 (этапы 1–3). Каждый сценарий дополнительно проходит [QrPriority.check]. */
class QrPriorityTest {

    /** Понедельник, 16.11.2026, [h]:[mi]. */
    private fun cal(h: Int, mi: Int = 0, day: Int = 16): Calendar {
        val c = Calendar.getInstance()
        c.clear()
        c.set(2026, Calendar.NOVEMBER, day, h, mi, 0)
        return c
    }

    private fun card(
        key: String, after: String = "none", live: List<Live> = emptyList(), times: Set<String> = emptySet(),
        days: Set<Int> = emptySet(), dyn: String = "", at: Long = 0L, habit: Boolean = false, tid: String = "", alarmId: String = "", prio: String = "normal"
    ) = Card(key = key, code = "", title = key, live = live, times = times, days = days, after = after, dyn = dyn, at = at, habit = habit, tid = tid, alarmId = alarmId, prio = prio)

    private fun cfg(cards: List<Card>, relevance: Boolean = false, rpeAsk: Boolean = false, moodAsk: Boolean = false) =
        Cfg(id = "w", name = "w", rotate = false, rotateMin = 5, relevance = relevance, cards = cards, rpeAsk = rpeAsk, moodAsk = moodAsk)

    private fun snap(c: Calendar, workout: Boolean = false, pomodoro: Boolean = false, stopwatch: Boolean = false,
                     timers: Set<String> = emptySet(), hidden: Set<String> = emptySet(), moved: Map<String, Long> = emptyMap(),
                     done: Set<String> = emptySet(), rpe: Boolean = false, alarms: Map<String, Long> = emptyMap(),
                     ringing: Set<String> = emptySet(), battery: Int = -1, lastTop: String = "", mood: Boolean = false) =
        QrPriority.Snapshot(now = c.timeInMillis, cal = c, workoutActive = workout, pomodoroActive = pomodoro, stopwatchActive = stopwatch,
            activeTimerIds = timers, alarms = alarms, ringingAlarmIds = ringing, batteryPercent = battery, hiddenKeys = hidden, movedAt = moved,
            doneTaskIds = done, rpePending = rpe, moodPending = mood, lastTopKey = lastTop)

    /** Строит порядок и проверяет инварианты. */
    private fun run(cfg: Cfg, s: QrPriority.Snapshot): QrPriority.Result {
        val r = QrPriority.build(cfg, s)
        assertEquals(emptyList<String>(), QrPriority.check(r, cfg, s))
        return r
    }

    private fun keys(r: QrPriority.Result) = r.cards.map { it.card.key }

    @Test fun noSignals_userOrder() {
        val cards = listOf(card("a"), card("b"), card("c"))
        for (rel in listOf(false, true)) {
            val r = run(cfg(cards, rel), snap(cal(12)))
            assertEquals(listOf("a", "b", "c"), keys(r))
            assertEquals("", r.topKey)
            assertEquals("", r.anchorKey)
        }
    }

    @Test fun rpe_aboveAll_evenWithoutRelevance() {
        val cards = listOf(card("a"), card("b"))
        val r = run(cfg(cards, relevance = false, rpeAsk = true), snap(cal(12), rpe = true))
        assertEquals(listOf(QrRpe.KEY, "a", "b"), keys(r))
        assertEquals(QrRpe.KEY, r.topKey)
        assertEquals(QrRpe.KEY, r.anchorKey)
        assertEquals(3, QrPriority.visibleCount(cfg(cards, false, true), snap(cal(12), rpe = true)))
    }

    @Test fun rpe_aboveRunningTimer_otherOrderUnchanged() {
        val cards = listOf(card("a"), card("t", live = listOf(Live("timer", "x"))))
        val r = run(cfg(cards, relevance = true, rpeAsk = true), snap(cal(12), timers = setOf("x"), rpe = true))
        assertEquals(listOf(QrRpe.KEY, "t", "a"), keys(r))
        assertEquals(QrRpe.KEY, r.topKey)
    }

    @Test fun hiddenDoneAndOutOfWindow_absent() {
        val c = cal(12)
        val now = c.timeInMillis
        val h = 3_600_000L
        val cards = listOf(
            card("hid", after = "hide"), card("hab", habit = true), card("ok"),
            card("e1", dyn = "event", at = now + 2 * h), card("e2", dyn = "event", at = now + 5 * h), // второе событие не «ближайшее»
            card("t1", dyn = "task", at = now + h, tid = "T1"), card("t2", dyn = "task", at = now + h, tid = "T2"),
            card("far", dyn = "task", at = now + 8 * 24 * h, tid = "T3") // вне окна DYN_DAYS
        )
        val r = run(cfg(cards), snap(c, hidden = setOf("hid", "hab"), done = setOf("T1")))
        assertEquals(listOf("ok", "e1", "t2"), keys(r))
    }

    @Test fun severalEnd_inMoveOrder_evenIfRunning() {
        val live = listOf(Live("timer", "x"))
        val cards = listOf(card("a", after = "end", live = live), card("b", after = "end"), card("c"), card("d", after = "end"))
        val c = cal(12)
        val t0 = c.timeInMillis
        val moved = mapOf("d" to t0 - 3000, "a" to t0 - 2000, "b" to t0 - 1000)
        for (rel in listOf(false, true)) {
            val r = run(cfg(cards, rel), snap(c, timers = setOf("x"), moved = moved))
            assertEquals(listOf("c", "d", "a", "b"), keys(r))
        }
    }

    @Test fun movedYesterday_rejoinsMainPart() {
        val cards = listOf(card("a", after = "end", times = setOf("d")), card("b"))
        val c = cal(12) // 11–15: «её» время карточки a
        val yesterday = cal(12, day = 15).timeInMillis
        val r = run(cfg(cards, true), snap(c, moved = mapOf("a" to yesterday)))
        assertEquals(listOf("a", "b"), keys(r))
        assertEquals("a", r.topKey)
    }

    @Test fun runningTimer_aboveScheduled() {
        val cards = listOf(card("s", times = setOf("d")), card("t", live = listOf(Live("timer", "x"))), card("z"))
        val r = run(cfg(cards, true), snap(cal(12), timers = setOf("x")))
        assertEquals(listOf("t", "s", "z"), keys(r))
        assertEquals("t", r.topKey)
        assertEquals(QrPriority.SCORE_TIMER, r.cards[0].score)
        assertEquals(QrPriority.SCORE_SCHEDULED, r.cards[1].score)
    }

    @Test fun severalLive_byRank() {
        val cards = listOf(
            card("sw", live = listOf(Live("stopwatch", ""))), card("tm", live = listOf(Live("timer", "x"))),
            card("po", live = listOf(Live("pomodoro", ""))), card("wo", live = listOf(Live("workout", "")))
        )
        val r = run(cfg(cards, true), snap(cal(12), workout = true, pomodoro = true, stopwatch = true, timers = setOf("x")))
        assertEquals(listOf("wo", "po", "tm", "sw"), keys(r))
        assertEquals("wo", r.topKey)
    }

    @Test fun endAlwaysLast() {
        val cards = listOf(card("a", after = "end", live = listOf(Live("workout", ""))), card("b"), card("c", times = setOf("d")))
        val c = cal(12)
        val r = run(cfg(cards, true), snap(c, workout = true, moved = mapOf("a" to c.timeInMillis)))
        assertEquals(listOf("c", "b", "a"), keys(r))
        assertEquals("c", r.topKey)
    }

    @Test fun eventBeforeTask_equalScore() {
        val c = cal(12)
        val now = c.timeInMillis
        val h = 3_600_000L
        val cards = listOf(card("q"), card("e", dyn = "event", at = now + h), card("t", dyn = "task", at = now + 2 * h, tid = "T"))
        val r = run(cfg(cards, true), snap(c))
        assertEquals(listOf("e", "t", "q"), keys(r)) // событие поднято над задачей на сегодня (календарь важнее задач)
        assertEquals("e", r.topKey)
        assertEquals("e", r.anchorKey)
    }

    @Test fun calendarAboveTasks_evenIfEventFar_andPrevTopWasTask() {
        val c = cal(12)
        val now = c.timeInMillis
        val cards = listOf(
            card("t1", dyn = "task", at = now - hour, tid = "A"), card("t2", dyn = "task", at = now + 2 * hour, tid = "B"),
            card("e", dyn = "event", at = now + 30 * hour), card("q")
        )
        // прежней верхней была просроченная задача (650): гистерезис не должен оставлять её наверху
        val r = run(cfg(cards, true), snap(c, lastTop = "t1"))
        assertEquals(listOf("e", "t1", "q"), keys(r)) // задачи — одна карточка (первая по времени)
        assertEquals("e", r.anchorKey)
        assertEquals(QrPriority.SCORE_TASK_OVERDUE + QrPriority.HYSTERESIS, scoreOf(r, "e"))
    }

    @Test fun anchor_isFirstDyn_whenNoRecommended() {
        val c = cal(12)
        val now = c.timeInMillis
        val cards = listOf(card("e", dyn = "event", at = now + 3_600_000L), card("q"))
        val r = run(cfg(cards, true), snap(c))
        assertEquals("e", r.anchorKey)
        assertEquals("", r.topKey)
        assertEquals("", run(cfg(cards, false), snap(c)).anchorKey) // без «релевантности» якоря нет
    }

    @Test fun windowBoundaries() {
        val m = card("m", times = setOf("m"))
        val d = card("d", times = setOf("d"))
        val e = card("e", times = setOf("e"))
        val cards = listOf(card("z"), m, d, e)
        fun topAt(h: Int, mi: Int) = run(cfg(cards, true), snap(cal(h, mi))).topKey
        assertEquals("", topAt(4, 59))
        assertEquals("m", topAt(5, 0))
        assertEquals("m", topAt(10, 59))
        assertEquals("d", topAt(11, 0))
        assertEquals("d", topAt(14, 59))
        assertEquals("", topAt(15, 0))
        assertEquals("", topAt(16, 59))
        assertEquals("e", topAt(17, 0))
        assertEquals("e", topAt(22, 59))
        assertEquals("", topAt(23, 0))
    }

    @Test fun days_ofWeek() {
        val cards = listOf(card("z"), card("mon", days = setOf(1)), card("sat", days = setOf(6)))
        assertEquals("mon", run(cfg(cards, true), snap(cal(12))).topKey) // 16.11.2026 — понедельник
        assertEquals("sat", run(cfg(cards, true), snap(cal(12, day = 14))).topKey) // 14.11.2026 — суббота
    }

    @Test fun nextChange_isNextWindowBoundary() {
        val c = cal(12)
        val r = run(cfg(listOf(card("a"), card("b")), true), snap(c))
        val exp = cal(15, 0)
        exp.set(Calendar.SECOND, 5)
        assertEquals(exp.timeInMillis, r.nextChangeAt)
        assertEquals(Long.MAX_VALUE, run(cfg(listOf(card("a"), card("b")), false), snap(c)).nextChangeAt)
    }

    @Test fun check_catchesViolations() {
        val cards = listOf(card("a"), card("b"))
        val cf = cfg(cards, false)
        val s = snap(cal(12))
        val good = QrPriority.build(cf, s)
        // потеряна карточка
        val lost = QrPriority.Result(good.cards.take(1), "", "", Long.MAX_VALUE)
        assertTrue(QrPriority.check(lost, cf, s).isNotEmpty())
        // нарушен порядок пользователя
        val swapped = QrPriority.Result(good.cards.reversed(), "", "", Long.MAX_VALUE)
        assertTrue(QrPriority.check(swapped, cf, s).isNotEmpty())
        // rpe без rpePending
        val withRpe = QrPriority.Result(good.cards + QrPriority.build(cfg(cards, false, true), snap(cal(12), rpe = true)).cards.take(1), "", "", Long.MAX_VALUE)
        assertTrue(QrPriority.check(withRpe, cf, s).isNotEmpty())
    }

    // ---------- этап 2: новые сигналы ----------

    private val min = 60_000L
    private val hour = 3_600_000L

    private fun scoreOf(r: QrPriority.Result, key: String) = r.cards.first { it.card.key == key }.score

    @Test fun alarmRinging_topOfAll_aboveWorkout() {
        val live = listOf(Live("workout", ""))
        val cards = listOf(card("a", alarmId = "AL1"), card("w", live = live), card("s", times = setOf("d")))
        val c = cal(12)
        val r = run(cfg(cards, true), snap(c, workout = true, ringing = setOf("AL1"), alarms = mapOf("AL1" to c.timeInMillis + 5 * min)))
        assertEquals(listOf("a", "w", "s"), keys(r))
        assertEquals("a", r.topKey)
        assertEquals(QrPriority.SCORE_ALARM_RINGING, scoreOf(r, "a"))
        assertEquals("Звонит будильник", r.cards[0].reason)
        // прежняя верхняя карточка (занятие) звонящий будильник не удерживает: отрыв всего 60, но гистерезис он обходит
        val held = run(cfg(cards, true), snap(c, workout = true, ringing = setOf("AL1"), lastTop = "w"))
        assertEquals("a", held.topKey)
    }

    @Test fun alarmSoon_within30min_only() {
        val c = cal(12)
        val cards = listOf(card("s", times = setOf("d")), card("a", alarmId = "AL1"))
        val soon = run(cfg(cards, true), snap(c, alarms = mapOf("AL1" to c.timeInMillis + 30 * min)))
        assertEquals(listOf("a", "s"), keys(soon))
        assertEquals(QrPriority.SCORE_ALARM_SOON, scoreOf(soon, "a"))
        assertEquals("Будильник через 30 мин", soon.cards[0].reason)
        val edge = run(cfg(cards, true), snap(c, alarms = mapOf("AL1" to c.timeInMillis + 31 * min))) // раньше «скоро» наступало за час — теперь за 30 минут
        assertEquals(listOf("s", "a"), keys(edge))
        assertEquals(0, scoreOf(edge, "a"))
        val inHour = run(cfg(cards, true), snap(c, alarms = mapOf("AL1" to c.timeInMillis + 60 * min)))
        assertEquals(listOf("s", "a"), keys(inHour))
        val late = run(cfg(cards, true), snap(c, alarms = mapOf("AL1" to c.timeInMillis + 90 * min)))
        assertEquals(listOf("s", "a"), keys(late)) // «заведённый позже» — 0
        assertEquals(0, scoreOf(late, "a"))
        val none = run(cfg(cards, true), snap(c)) // не заведён
        assertEquals(0, scoreOf(none, "a"))
    }

    @Test fun eventSoon_within60min_only() {
        val c = cal(12)
        val now = c.timeInMillis
        val cards = listOf(card("s", times = setOf("d")), card("e", dyn = "event", at = now + 30 * min))
        val soon = run(cfg(cards, true), snap(c))
        assertEquals(listOf("e", "s"), keys(soon))
        assertEquals(QrPriority.SCORE_EVENT_SOON, scoreOf(soon, "e"))
        val later = run(cfg(listOf(card("s", times = setOf("d")), card("e", dyn = "event", at = now + 61 * min)), true), snap(c))
        assertEquals(listOf("s", "e"), keys(later))
    }

    @Test fun tasks_overdue_today_tomorrow() {
        val c = cal(12)
        val now = c.timeInMillis
        val cards = listOf(
            card("z"), card("today", dyn = "task", at = now + 2 * hour, tid = "A"),
            card("over", dyn = "task", at = now - hour, tid = "B"), card("tom", dyn = "task", at = now + 24 * hour, tid = "C")
        )
        val r = run(cfg(cards, true), snap(c))
        assertEquals(listOf("over", "z"), keys(r)) // одна карточка задач: первая по времени, просроченные первыми
        assertEquals(QrPriority.SCORE_TASK_OVERDUE, scoreOf(r, "over"))
        assertEquals("over", r.topKey)
        // листание: показана другая задача, а балл карточки — по первой (самой срочной), поэтому в стопке она не прыгает
        val second = run(cfg(cards, true), snap(c).copy(taskIndex = 1))
        assertEquals(listOf("today", "z"), keys(second))
        assertEquals(QrPriority.SCORE_TASK_OVERDUE, scoreOf(second, "today"))
        assertEquals("today", second.topKey)
        assertEquals(listOf("tom", "z"), keys(run(cfg(cards, true), snap(c).copy(taskIndex = 2))))
    }

    @Test fun signalsOrder_byTable() {
        val c = cal(12)
        val now = c.timeInMillis
        val cards = listOf(
            card("bat", alarmId = ""), card("sch", times = setOf("d")), card("today", dyn = "task", at = now + hour, tid = "A"),
            card("over", dyn = "task", at = now - hour, tid = "B"), card("ev", dyn = "event", at = now + 20 * min), card("al", alarmId = "AL1")
        )
        val r = run(cfg(cards, true), snap(c, alarms = mapOf("AL1" to now + 10 * min)))
        assertEquals(listOf("al", "ev", "over", "sch", "bat"), keys(r)) // задачи — одна карточка: показана «over» (первая по времени)
    }

    @Test fun battery_low_raisesOnlyBatteryCards() {
        val cards = listOf(card("a"), card("b"), card(QrBattery.KEY))
        val low = run(cfg(cards, true), snap(cal(12), battery = 15))
        assertEquals(listOf(QrBattery.KEY, "a", "b"), keys(low))
        assertEquals(QrPriority.SCORE_BATTERY_LOW, scoreOf(low, QrBattery.KEY))
        assertEquals("Заряд 15 %", low.cards[0].reason)
        for (p in listOf(16, 80, -1)) assertEquals(listOf("a", "b", QrBattery.KEY), keys(run(cfg(cards, true), snap(cal(12), battery = p))))
        // заряд второго вида («несколько устройств») — тот же балл; обычная карточка с таким баллом не получает
        val multi = run(cfg(listOf(card("a"), card(QrBattery.KEY2)), true), snap(cal(12), battery = 5))
        assertEquals(listOf(QrBattery.KEY2, "a"), keys(multi))
    }

    @Test fun battery_withoutReason_staysLast_evenIfListedFirst() {
        val cards = listOf(card(QrBattery.KEY), card("a"), card("b"))
        assertEquals(listOf("a", "b", QrBattery.KEY), keys(run(cfg(cards, true), snap(cal(12), battery = 80))))
    }

    @Test fun eventBeforeTask_equalScore_evenIfTaskListedFirst() {
        val now = cal(12).timeInMillis
        val cards = listOf(card("t", dyn = "task", at = now + 24 * hour, tid = "T"), card("q"), card("e", dyn = "event", at = now + 2 * hour))
        val r = run(cfg(cards, true), snap(cal(12)))
        assertEquals(listOf("e", "q", "t"), keys(r)) // места задач и событий переписаны: событие раньше; «q» остался на своём
    }

    @Test fun reasons_scheduledWindow() {
        val r = run(cfg(listOf(card("z"), card("s", times = setOf("d"))), true), snap(cal(12)))
        assertEquals("Сейчас её время: обед", r.cards[0].reason)
        assertEquals("Задача просрочена", run(cfg(listOf(card("o", dyn = "task", at = cal(12).timeInMillis - hour, tid = "B"), card("z")), true), snap(cal(12))).cards[0].reason)
    }

    // ---------- этап 2: устойчивость ----------

    @Test fun hysteresis_diff50_keepsPrev() {
        val cards = listOf(card("sch", times = setOf("d")), card(QrBattery.KEY))
        // прежняя верхняя — заряд (450), претендент — «её» время (500): отрыв 50
        val r = run(cfg(cards, true), snap(cal(12), battery = 10, lastTop = QrBattery.KEY))
        assertEquals(QrBattery.KEY, r.topKey)
        assertEquals(listOf(QrBattery.KEY, "sch"), keys(r)) // удержанная — первая, остальной порядок как обычно
        assertEquals(QrBattery.KEY, r.anchorKey)
        assertEquals(QrBattery.KEY, r.mainTopKey)
        // без прежней верхней порядок обычный
        assertEquals("sch", run(cfg(cards, true), snap(cal(12), battery = 10)).topKey)
    }

    @Test fun hysteresis_diff150_changes() {
        val now = cal(12).timeInMillis
        val cards = listOf(card("sch", times = setOf("d")), card("over", dyn = "task", at = now - hour, tid = "B"))
        val r = run(cfg(cards, true), snap(cal(12), lastTop = "sch")) // 500 → 650
        assertEquals("over", r.topKey)
        assertEquals(listOf("over", "sch"), keys(r))
    }

    @Test fun hysteresis_diffExactly100_changes() {
        val now = cal(12).timeInMillis
        val cards = listOf(card("over", dyn = "task", at = now - hour, tid = "B"), card("ev", dyn = "event", at = now + 10 * min))
        val r = run(cfg(cards, true), snap(cal(12), lastTop = "over")) // 650 → 750: «минимум на 100»
        assertEquals("ev", r.topKey)
        // отрыв меньше 100 удержал бы: идущая тренировка (1040) против таймера (1020) — 20
        val c2 = listOf(card("t", live = listOf(Live("timer", "x"))), card("w", live = listOf(Live("workout", ""))))
        val r2 = run(cfg(c2, true), snap(cal(12), timers = setOf("x"), workout = true, lastTop = "t"))
        assertEquals("t", r2.topKey)
        assertEquals(listOf("t", "w"), keys(r2))
    }

    @Test fun alarmSoon_beatsEventSoon_evenWhenEventOnTop() {
        val now = cal(12).timeInMillis
        val cards = listOf(card("ev", dyn = "event", at = now + 10 * min), card("al", alarmId = "AL1"))
        // событие уже наверху, но будильник через 10 минут отрывается ровно на гистерезис и забирает верх
        val r = run(cfg(cards, true), snap(cal(12), lastTop = "ev", alarms = mapOf("AL1" to now + 10 * min)))
        assertEquals("al", r.topKey)
        assertEquals(listOf("al", "ev"), keys(r))
        assertEquals(QrPriority.SCORE_EVENT_SOON + QrPriority.HYSTERESIS, QrPriority.SCORE_ALARM_SOON)
        // событие в окне часа, а будильник дальше 30 минут: наверху остаётся событие
        val far = run(cfg(cards, true), snap(cal(12), lastTop = "ev", alarms = mapOf("AL1" to now + 45 * min)))
        assertEquals("ev", far.topKey)
        assertEquals(listOf("ev", "al"), keys(far))
    }

    @Test fun hysteresis_prevSignalEnded_replaced() {
        val cards = listOf(card("s", times = setOf("d")), card("t", live = listOf(Live("timer", "x"))))
        val r = run(cfg(cards, true), snap(cal(12), lastTop = "t")) // таймер кончился: балл 0
        assertEquals("s", r.topKey)
    }

    @Test fun hysteresis_prevGone_ignored() {
        val cards = listOf(card("s", times = setOf("d")), card("b"))
        assertEquals("s", run(cfg(cards, true), snap(cal(12), lastTop = "gone")).topKey)
        assertEquals("s", run(cfg(cards, true), snap(cal(12), lastTop = QrRpe.KEY)).topKey)
        // прежняя верхняя перенесена «в конец» сегодня — не удерживается
        val c = cal(12)
        val moved = listOf(card("s", times = setOf("d")), card("m", after = "end", times = setOf("d")), card("b"))
        val r = run(cfg(moved, true), snap(c, moved = mapOf("m" to c.timeInMillis), lastTop = "m"))
        assertEquals(listOf("s", "b", "m"), keys(r))
    }

    @Test fun hysteresis_off_withoutRelevance() {
        val cards = listOf(card("a"), card("b"))
        val r = run(cfg(cards, false), snap(cal(12), lastTop = "b"))
        assertEquals(listOf("a", "b"), keys(r))
        assertEquals("", r.topKey)
    }

    @Test fun hysteresis_stableWhenRepeated() {
        // повторный расчёт с запомненной верхней карточкой даёт тот же порядок
        val cards = listOf(card("sch", times = setOf("d")), card(QrBattery.KEY))
        val s1 = snap(cal(12), battery = 10, lastTop = QrBattery.KEY)
        val r1 = run(cfg(cards, true), s1)
        val r2 = run(cfg(cards, true), snap(cal(12), battery = 10, lastTop = r1.mainTopKey))
        assertEquals(keys(r1), keys(r2))
    }

    @Test fun rpe_keepsMainTopSeparately() {
        val cards = listOf(card("s", times = setOf("d")), card("b"))
        val r = run(cfg(cards, true, rpeAsk = true), snap(cal(12), rpe = true))
        assertEquals(QrRpe.KEY, r.topKey)
        assertEquals("s", r.mainTopKey) // по нему запоминается прежняя верхняя, пока висит «Как тренировка?»
    }

    // ---------- этап 2: когда пересчитывать ----------

    @Test fun nextChange_eventSoonAlarmSoonTaskRinging() {
        val c = cal(12)
        val now = c.timeInMillis
        val boundary = cal(15, 0).timeInMillis + 5_000L
        // событие в 14:30 → «до события 60 мин» наступит в 13:30:01
        val ev = run(cfg(listOf(card("a"), card("e", dyn = "event", at = cal(14, 30).timeInMillis)), true), snap(c))
        assertEquals(cal(13, 30).timeInMillis + 1_000L, ev.nextChangeAt)
        // будильник в 16:30 → 16:00:01 позже границы окон: остаётся граница
        val al = run(cfg(listOf(card("a"), card("b", alarmId = "AL1")), true), snap(c, alarms = mapOf("AL1" to cal(16, 30).timeInMillis)))
        assertEquals(boundary, al.nextChangeAt)
        // будильник в 14:10 → «до будильника 30 мин» наступит в 13:40:01
        val al2 = run(cfg(listOf(card("a"), card("b", alarmId = "AL1")), true), snap(c, alarms = mapOf("AL1" to cal(14, 10).timeInMillis)))
        assertEquals(cal(13, 40).timeInMillis + 1_000L, al2.nextChangeAt)
        // задача сегодня в 12:40 → станет просроченной в 12:40:01
        val tk = run(cfg(listOf(card("a"), card("t", dyn = "task", at = cal(12, 40).timeInMillis, tid = "T")), true), snap(c))
        assertEquals(cal(12, 40).timeInMillis + 1_000L, tk.nextChangeAt)
        // звонит — перепроверка через минуту
        val ring = run(cfg(listOf(card("a"), card("b", alarmId = "AL1")), true), snap(c, ringing = setOf("AL1")))
        assertEquals(now + 60_000L, ring.nextChangeAt)
        // без «релевантности» пересчёт по времени не нужен
        assertEquals(Long.MAX_VALUE, run(cfg(listOf(card("a"), card("e", dyn = "event", at = now + 2 * hour)), false), snap(c)).nextChangeAt)
    }

    @Test fun nextChange_midnightRollsTasks() {
        // 23:30: ближайшее — полночь (+5 с), задача «на завтра» станет «на сегодня»
        val c = cal(23, 30)
        val r = run(cfg(listOf(card("a"), card("t", dyn = "task", at = cal(23, 30).timeInMillis + 2 * hour, tid = "T")), true), snap(c))
        val mid = cal(0, 0, day = 17)
        mid.set(Calendar.SECOND, 5)
        assertEquals(mid.timeInMillis, r.nextChangeAt)
    }

    @Test fun check_catchesHysteresisViolation() {
        val cards = listOf(card("sch", times = setOf("d")), card(QrBattery.KEY))
        val cf = cfg(cards, true)
        val noPrev = QrPriority.build(cf, snap(cal(12), battery = 10)) // верх — «sch», как без запомненной карточки
        val s = snap(cal(12), battery = 10, lastTop = QrBattery.KEY) // а прежняя верхняя — заряд, отрыв всего 50
        assertTrue(QrPriority.check(noPrev, cf, s).any { it.startsWith("9") })
    }

    // ---------- этап 3: ручной приоритет и объяснение ----------

    @Test fun prio_top_aboveNormalWithoutSignals() {
        val cards = listOf(card("a"), card("b", prio = "top"), card("c"))
        val r = run(cfg(cards, true), snap(cal(12)))
        assertEquals(listOf("b", "a", "c"), keys(r))
        assertEquals("b", r.topKey)
        assertEquals(QrPriority.PRIO_TOP_BONUS, r.cards[0].score)
    }

    @Test fun prio_top_addsToSignal_notOverRunningTimer() {
        val c = cal(12)
        // «своё время» 500 + 300 = 800, таймер 1020 всё равно выше
        val cards = listOf(card("s", times = setOf("d"), prio = "top"), card("t", live = listOf(Live("timer", "x"))))
        val r = run(cfg(cards, true), snap(c, timers = setOf("x")))
        assertEquals(listOf("t", "s"), keys(r))
        assertEquals(QrPriority.SCORE_SCHEDULED + QrPriority.PRIO_TOP_BONUS, r.cards[1].score)
        // а выше «обычной» карточки со своим временем (500) — 300 без сигналов не хватает, 800 с сигналом хватает
        val plain = listOf(card("s", times = setOf("d")), card("n", prio = "top"))
        assertEquals(listOf("s", "n"), keys(run(cfg(plain, true), snap(c))))
        val both = listOf(card("s", times = setOf("d")), card("n", times = setOf("d"), prio = "top"))
        assertEquals(listOf("n", "s"), keys(run(cfg(both, true), snap(c))))
    }

    @Test fun prio_low_belowNormal_evenWithSignals() {
        val c = cal(12)
        val cards = listOf(
            card("lowTimer", live = listOf(Live("timer", "x")), prio = "low"), card("lowSched", times = setOf("d"), prio = "low"),
            card("a"), card("b")
        )
        val r = run(cfg(cards, true), snap(c, timers = setOf("x")))
        assertEquals(listOf("a", "b", "lowTimer", "lowSched"), keys(r))
        assertTrue(r.cards.all { it.score <= 0 })
        assertEquals("", r.topKey)
    }

    @Test fun prio_low_ringingAlarmDoesNotRise() {
        val now = cal(12).timeInMillis
        val cards = listOf(card("al", alarmId = "AL1", prio = "low"), card("n"))
        val r = run(cfg(cards, true), snap(cal(12), ringing = setOf("AL1"), alarms = mapOf("AL1" to now)))
        assertEquals(listOf("n", "al"), keys(r))
    }

    @Test fun prio_endAndHidden_strongerThanTop() {
        val c = cal(12)
        val cards = listOf(card("e", after = "end", prio = "top"), card("h", after = "hide", prio = "top"), card("a"), card("b"))
        val r = run(cfg(cards, true), snap(c, moved = mapOf("e" to c.timeInMillis), hidden = setOf("h")))
        assertEquals(listOf("a", "b", "e"), keys(r)) // «h» скрыта, «e» — в самом конце, хотя «наверх»
        assertEquals("", r.topKey)
    }

    @Test fun prio_ignoredWithoutRelevance() {
        val cards = listOf(card("a"), card("b", prio = "top"), card("c", prio = "low"))
        val r = run(cfg(cards, false), snap(cal(12)))
        assertEquals(listOf("a", "b", "c"), keys(r))
        assertEquals("", r.topKey)
    }

    @Test fun prio_normalizes() {
        assertEquals("top", QrPriority.normPrio("top"))
        assertEquals("low", QrPriority.normPrio("low"))
        assertEquals("normal", QrPriority.normPrio("normal"))
        assertEquals("normal", QrPriority.normPrio("whatever"))
        assertEquals("normal", QrPriority.normPrio(null))
        assertEquals("normal", card("x").prio) // старые данные без поля
    }

    @Test fun prio_top_notRingingBypass() {
        // «наверх» + будильник через 30 мин = 1150, выше звонящего (1100), но это не звонок: звонящий будильник другой карточки гистерезис не теряет (отрыв 50)
        val now = cal(12).timeInMillis
        val cards = listOf(card("p", alarmId = "AL2"), card("q", alarmId = "AL1", prio = "top"))
        val r = run(cfg(cards, true), snap(cal(12), ringing = setOf("AL2"), alarms = mapOf("AL1" to now + 30 * min, "AL2" to now), lastTop = "p"))
        assertEquals("p", r.topKey)
        assertEquals(listOf("p", "q"), keys(r))
        // а звонящий будильник без «наверх» (1100) гистерезис обходит, как раньше
        val c2 = listOf(card("p", live = listOf(Live("workout", ""))), card("q", alarmId = "AL1"))
        val r2 = run(cfg(c2, true), snap(cal(12), workout = true, ringing = setOf("AL1"), alarms = mapOf("AL1" to now), lastTop = "p"))
        assertEquals("q", r2.topKey)
    }

    @Test fun why_reasonOfTopCard() {
        val now = cal(12).timeInMillis
        // занятие
        val a = run(cfg(listOf(card("n"), card("t", live = listOf(Live("timer", "x")))), true), snap(cal(12), timers = setOf("x")))
        assertEquals("t", a.topTitle)
        assertEquals("Идёт таймер", a.topReason)
        // будильник через 25 мин
        val b = run(cfg(listOf(card("n"), card("al", alarmId = "AL1")), true), snap(cal(12), alarms = mapOf("AL1" to now + 25 * min)))
        assertEquals("Будильник через 25 мин", b.topReason)
        // «её» время суток
        val c = run(cfg(listOf(card("n"), card("m", times = setOf("m"))), true), snap(cal(8)))
        assertEquals("Сейчас её время: утро", c.topReason)
        // приоритет «наверх»: без сигналов и вместе с ними
        val d = run(cfg(listOf(card("n"), card("p", prio = "top")), true), snap(cal(12)))
        assertEquals("Приоритет «наверх»", d.topReason)
        val e = run(cfg(listOf(card("n"), card("p", live = listOf(Live("timer", "x")), prio = "top")), true), snap(cal(12), timers = setOf("x")))
        assertEquals("Идёт таймер · приоритет «наверх»", e.topReason)
        // «Как тренировка?»
        val f = run(cfg(listOf(card("n"), card("m")), true, rpeAsk = true), snap(cal(12), rpe = true))
        assertEquals("Как тренировка?", f.topTitle)
        assertEquals("Ждёт оценки тренировки", f.topReason)
        // ничего не выделено
        val g = run(cfg(listOf(card("n"), card("m")), true), snap(cal(12)))
        assertEquals("", g.topKey)
        assertEquals("", g.topTitle)
        assertEquals("", g.topReason)
        // без «релевантности» верха нет
        assertEquals("", run(cfg(listOf(card("n"), card("m", prio = "top")), false), snap(cal(12))).topReason)
    }

    @Test fun check_catchesPrioViolations() {
        val cards = listOf(card("a", prio = "low"), card("b", prio = "top"), card("c"))
        val cf = cfg(cards, true)
        val s = snap(cal(12))
        val good = QrPriority.build(cf, s)
        // подмена: у «низкого» балл выше нуля, у «верхнего» — ниже прибавки
        val bad = QrPriority.Result(
            listOf(QrPriority.Scored(cards[0], 5, ""), QrPriority.Scored(cards[1], 10, ""), QrPriority.Scored(cards[2], 0, "")),
            good.topKey, good.anchorKey, good.nextChangeAt, good.mainTopKey
        )
        val v = QrPriority.check(bad, cf, s)
        assertTrue(v.any { it.startsWith("10") })
        assertTrue(v.any { it.startsWith("11") })
    }
    @Test fun eventRow_indexPicksNthUpcoming_notLooped() {
        val c = cal(12)
        val now = c.timeInMillis
        val h = 3_600_000L
        val cards = listOf(
            card("e2", dyn = "event", at = now + 3 * h), card("e0", dyn = "event", at = now + h),
            card("e1", dyn = "event", at = now + 2 * h), card("past", dyn = "event", at = now - 1000L)
        )
        val cf = cfg(cards)
        val s = snap(c)
        assertEquals(listOf("e0", "e1", "e2"), QrPriority.eventCards(cf, s).map { it.key })
        assertEquals("e0", QrPriority.nextEventKey(cf, s))
        assertEquals("e1", QrPriority.nextEventKey(cf, s.copy(eventIndex = 1)))
        assertEquals("e2", QrPriority.nextEventKey(cf, s.copy(eventIndex = 7))) // за краем ряда — крайнее, не по кругу
        assertEquals("e0", QrPriority.nextEventKey(cf, s.copy(eventIndex = -3)))
        assertEquals(listOf("e1"), keys(run(cf, s.copy(eventIndex = 1))))
    }
    @Test fun taskRow_oneCardNoWrap_doneShifts() {
        val c = cal(12)
        val now = c.timeInMillis
        val cards = listOf(
            card("t2", dyn = "task", at = now + 2 * hour, tid = "B"), card("t0", dyn = "task", at = now - hour, tid = "A"),
            card("t1", dyn = "task", at = now + hour, tid = "C"), card("far", dyn = "task", at = now + 8 * 24 * hour, tid = "D")
        )
        val cf = cfg(cards, false)
        val s = snap(c)
        assertEquals(listOf("t0", "t1", "t2"), QrPriority.taskCards(cf, s).map { it.key }) // по времени; вне окна — нет
        assertEquals("t0", QrPriority.nextTaskKey(cf, s))
        assertEquals("t1", QrPriority.nextTaskKey(cf, s.copy(taskIndex = 1)))
        assertEquals("t2", QrPriority.nextTaskKey(cf, s.copy(taskIndex = 7))) // за краем ряда — крайняя, не по кругу
        assertEquals("t0", QrPriority.nextTaskKey(cf, s.copy(taskIndex = -3)))
        assertEquals(listOf("t1"), keys(run(cf, s.copy(taskIndex = 1))))
        // выполненная задача уходит из ряда, следующая занимает её место
        val done = snap(c, done = setOf("A"))
        assertEquals(listOf("t1", "t2"), QrPriority.taskCards(cf, done).map { it.key })
        assertEquals(listOf("t1"), keys(run(cf, done)))
        // задач нет — карточки нет
        assertEquals("", QrPriority.nextTaskKey(cfg(emptyList(), false), s))
    }

    /** Будильник для карточки «Будильники»: id в оболочке — `id_<ключ>`. */
    private fun alarmCard(key: String, h: Int, m: Int) = Card(
        key = key, code = "", title = key, live = emptyList(), times = emptySet(), days = emptySet(),
        dyn = "alarm", alarmId = "id_" + key, alarmSpec = QrWidgets.AlarmSpec(h, m, 0, 0, key)
    )

    @Test fun alarmRow_oneCardByClock_defaultRingingThenNearestArmed() {
        val c = cal(12)
        val now = c.timeInMillis
        val cf = cfg(listOf(alarmCard("a9", 21, 0), alarmCard("a7", 7, 0), alarmCard("a8", 8, 30)))
        val s = snap(c)
        assertEquals(listOf("a7", "a8", "a9"), QrPriority.alarmCards(cf, s).map { it.key }) // по времени суток, не по порядку присылки
        assertEquals("a7", QrPriority.nextAlarmKey(cf, s)) // ничего не заведено — первый по времени
        val armed = snap(c, alarms = mapOf("id_a8" to now + 20 * hour, "id_a9" to now + 9 * hour))
        assertEquals("a9", QrPriority.nextAlarmKey(cf, armed)) // заведённый с ближайшим звонком
        assertEquals("a8", QrPriority.nextAlarmKey(cf, snap(c, alarms = armed.alarms, ringing = setOf("id_a8")))) // звонящий важнее
        assertEquals("a8", QrPriority.nextAlarmKey(cf, armed.copy(alarmIndex = 1))) // листали — показан выбранный
        assertEquals("a9", QrPriority.nextAlarmKey(cf, s.copy(alarmIndex = 7))) // за краем ряда — крайний, не по кругу
        assertEquals("a7", QrPriority.nextAlarmKey(cf, s.copy(alarmIndex = 0)))
        assertEquals(listOf("a8"), keys(run(cf, s.copy(alarmIndex = 1)))) // в стопке одна карточка на все будильники
        assertEquals("", QrPriority.nextAlarmKey(cfg(emptyList()), s)) // будильников нет — карточки нет
    }

    @Test fun alarmRow_scoreFromAllAlarms_notFromShownOne() {
        val c = cal(12)
        val now = c.timeInMillis
        val cf = cfg(listOf(card("a"), alarmCard("a7", 7, 0), alarmCard("a9", 21, 0)), relevance = true)
        // показан a7 (листали), а зазвонит a9 через 30 минут: карточка всё равно поднимается
        val s = snap(c, alarms = mapOf("id_a9" to now + 30 * 60_000L)).copy(alarmIndex = 0)
        val r = run(cf, s)
        assertEquals(listOf("a7", "a"), keys(r))
        assertEquals("a7", r.topKey)
        assertEquals("Будильник через 30 мин", r.topReason)
        // до звонка дальше 30 минут — карточка не выделена
        val mid = run(cf, snap(c, alarms = mapOf("id_a9" to now + 45 * 60_000L)).copy(alarmIndex = 0))
        assertEquals(listOf("a", "a7"), keys(mid)) // 45 минут: раньше (за час) уже поднималась
        assertEquals("", mid.topKey)
        val far = run(cf, snap(c, alarms = mapOf("id_a9" to now + 3 * hour)).copy(alarmIndex = 0))
        assertEquals(listOf("a", "a7"), keys(far))
        assertEquals("", far.topKey)
        // нет релевантности — порядок пользователя, баллов нет
        assertEquals(listOf("a", "a7"), keys(run(cfg(cf.cards, false), s)))
    }

    @Test fun alarmRow_ringingBeatsHysteresis_andNextChange() {
        val c = cal(12)
        val now = c.timeInMillis
        val cf = cfg(listOf(card("b", times = setOf("d")), alarmCard("a7", 7, 0), alarmCard("a9", 21, 0)), relevance = true)
        // прежде наверху была «b» (её время суток), зазвонил a9 — звонящий забирает верх сразу, хотя показан a7
        val ring = snap(c, alarms = mapOf("id_a9" to now - 1000L), ringing = setOf("id_a9"), lastTop = "b").copy(alarmIndex = 0, alarmRowRinging = true)
        val r = run(cf, ring)
        assertEquals("a7", r.topKey)
        assertEquals("Звонит будильник", r.topReason)
        assertEquals(now + 60_000L, r.nextChangeAt) // пока звонит — перепроверка через минуту
        // заведённый на 15:00 а9 зазвонит позже: «скоро» наступит в 14:30:01 (раньше границы окон 15:00:05)
        val soon = run(cf, snap(c, alarms = mapOf("id_a9" to now + 3 * hour)).copy(alarmIndex = 0))
        assertEquals(now + 2 * hour + 30 * min + 1_000L, soon.nextChangeAt)
    }

    @Test fun alarmRow_soonBeatsEvent_evenWhenShownAnotherAlarm() {
        val c = cal(12)
        val now = c.timeInMillis
        val cf = cfg(listOf(card("ev", dyn = "event", at = now + 20 * min), alarmCard("a7", 7, 0), alarmCard("a9", 21, 0)), relevance = true)
        // событие наверху, показан a7 (листали), а зазвонит a9 через 20 минут: карточка будильников забирает верх у календаря
        val s = snap(c, alarms = mapOf("id_a9" to now + 20 * min), lastTop = "ev").copy(alarmIndex = 0)
        val r = run(cf, s)
        assertEquals(listOf("a7", "ev"), keys(r))
        assertEquals("a7", r.topKey)
        assertEquals("Будильник через 20 мин", r.topReason)
        // будильник дальше 30 минут — календарь остаётся наверху
        val later = run(cf, snap(c, alarms = mapOf("id_a9" to now + 40 * min), lastTop = "ev").copy(alarmIndex = 0))
        assertEquals("ev", later.topKey)
    }

    // ---------- «Как настроение?» (служебная карточка, как «Как тренировка?») ----------

    @Test fun mood_aboveCalendarAndEverything_evenWithoutRelevance() {
        val c = cal(20, 30)
        val now = c.timeInMillis
        val cards = listOf(card("a"), card("ev", dyn = "event", at = now + 30 * 60_000L), card("tk", dyn = "task", at = now + 60_000L))
        for (rel in listOf(false, true)) {
            val r = run(cfg(cards, rel, moodAsk = true), snap(c, mood = true))
            assertEquals("__mood", keys(r).first())
            assertEquals("__mood", r.topKey)
            assertEquals("__mood", r.anchorKey)
            assertEquals("Как настроение?", r.topTitle)
            assertEquals("Сегодня настроение ещё не отмечено", r.topReason)
            assertEquals(4, QrPriority.visibleCount(cfg(cards, rel, moodAsk = true), snap(c, mood = true)))
            assertEquals(listOf("a", "ev", "tk").sorted(), keys(r).drop(1).sorted()) // остальные карточки на месте, ничего не потеряно
        }
    }

    @Test fun mood_notPending_noCard() {
        val c = cal(12)
        val cards = listOf(card("a"), card("b"))
        val r = run(cfg(cards, true, moodAsk = true), snap(c, mood = false))
        assertEquals(listOf("a", "b"), keys(r))
        assertEquals("", r.topKey)
        assertEquals("", r.anchorKey)
        assertEquals(2, QrPriority.visibleCount(cfg(cards, true, moodAsk = true), snap(c, mood = false)))
    }

    @Test fun mood_underRpe_whenBothPending() {
        val c = cal(21)
        val cards = listOf(card("a"), card("b"))
        val r = run(cfg(cards, true, rpeAsk = true, moodAsk = true), snap(c, rpe = true, mood = true))
        assertEquals(listOf("__rpe", "__mood", "a", "b"), keys(r))
        assertEquals("__rpe", r.topKey)
        assertEquals("__rpe", r.anchorKey)
        assertEquals(4, QrPriority.visibleCount(cfg(cards, true, rpeAsk = true, moodAsk = true), snap(c, rpe = true, mood = true)))
        // оценили тренировку — настроение встаёт наверх
        val r2 = run(cfg(cards, true, rpeAsk = true, moodAsk = true), snap(c, rpe = false, mood = true))
        assertEquals(listOf("__mood", "a", "b"), keys(r2))
        assertEquals("__mood", r2.topKey)
    }

    @Test fun mood_aloneInStack_isNotAllDone() {
        val c = cal(22)
        val cf = cfg(emptyList(), false, moodAsk = true)
        val r = run(cf, snap(c, mood = true))
        assertEquals(listOf("__mood"), keys(r))
        assertEquals(1, QrPriority.visibleCount(cf, snap(c, mood = true)))
        assertEquals(0, QrPriority.visibleCount(cf, snap(c, mood = false)))
    }

    @Test fun mood_doesNotBreakHysteresis_mainTopStillRemembered() {
        val c = cal(20, 40)
        val cards = listOf(card("a"), card("t", live = listOf(Live("timer", "x"))))
        val r = run(cfg(cards, true, moodAsk = true), snap(c, timers = setOf("x"), mood = true))
        assertEquals("__mood", r.topKey)
        assertEquals("t", r.mainTopKey) // оболочка запоминает как «прежнюю верхнюю» именно основную, а не служебную
    }
}
