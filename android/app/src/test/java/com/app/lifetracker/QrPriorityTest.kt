package com.app.lifetracker
// Версия: 5.1 (19.11) — карточка «Заряд телефона достиг 80 %» (charge_*): под идущим таймером и низким зарядом, над «Как тренировка?» и «Как настроение?»; при любом режиме; пока телефон на зарядке и заряд 80…100 %.
// Версия: 5.0 (19.11)
// Версия: 4.7 (18.11) — карточка «Заметки» (notes_*): отдельная группа «nt_0»; заметка «в своё время» (утро/обед/вечер/все время) — в круге равных, без времени суток — нет.
// Версия: 4.6 (17.11) — класс QrMotionTest: единый диспетчер движения стопки (QrPriority.Motion), ТЗ TZ_motion_dispatcher.md, п. 7.
// Версия: 4.5 (16.11) — время суток «Целый день» (`a`): привычка и карточка «Сегодня» «в своё время» в любой час суток, только в выбранные дни недели, пока не отмечены (habits_allDay_*, allDay_*).
// Версия: 4.4 (15.11) — карточка «Таймеры» (timers_*): идущий таймер выше всего, в том числе выше «Как тренировка?» и без «релевантности»; два идущих сменяют друг друга по минутам; таймер «в своё время суток» выше календаря и привычек; минутная перерисовка только пока идёт таймер.
// Версия: 4.3 (15.11) — единая модель круга равных и карточек-групп: будильники — группа «alm_0» (элементы со своими баллами, alarmRow_*, alarmGroup_*), лицо группы в Result.faces вместо habitIdx; в круг входит любая карточка верхнего яруса (cycle_ordinaryCards_*), равные баллы гистерезис не держит (cycle_equalScoreNotHeld_*).
// Версия: 4.2 (14.11) — карточка «Привычки» (habits_*): привычки «в своё время» встают в круг каждая своей карточкой, остальные — нет; отмеченные исчезают по одной, все отмечены — карточки нет.
// Версия: 4.1 (14.11) — служебная карточка «Как настроение?» (mood_*): над календарём, под «Как тренировка?».
// Версия: 4.0 (14.11) — будильник «скоро» за 30 минут, а не за час; будильник «скоро» перебивает событие (alarmSoon_beatsEventSoon_*, alarmRow_soonBeatsEvent_*).
// Версия: 3.5 (14.11) — карточка «Будильники» (alarmRow_*).
// Версия: 3.4 (14.11)

import com.app.lifetracker.QrPriority.Motion
import com.app.lifetracker.QrWidgets.Card
import com.app.lifetracker.QrWidgets.Cfg
import com.app.lifetracker.QrWidgets.Live
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
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

    private fun cfg(cards: List<Card>, relevance: Boolean = false, rpeAsk: Boolean = false, moodAsk: Boolean = false, chargeDone: Boolean = false) =
        Cfg(id = "w", name = "w", rotate = false, rotateMin = 5, relevance = relevance, cards = cards, rpeAsk = rpeAsk, moodAsk = moodAsk, chargeDone = chargeDone)

    private fun snap(c: Calendar, workout: Boolean = false, pomodoro: Boolean = false, stopwatch: Boolean = false,
                     timers: Set<String> = emptySet(), hidden: Set<String> = emptySet(), moved: Map<String, Long> = emptyMap(),
                     done: Set<String> = emptySet(), rpe: Boolean = false, alarms: Map<String, Long> = emptyMap(),
                     ringing: Set<String> = emptySet(), battery: Int = -1, lastTop: String = "", mood: Boolean = false, charge: Int = -1) =
        QrPriority.Snapshot(now = c.timeInMillis, cal = c, workoutActive = workout, pomodoroActive = pomodoro, stopwatchActive = stopwatch,
            activeTimerIds = timers, alarms = alarms, ringingAlarmIds = ringing, batteryLowest = battery, hiddenKeys = hidden, movedAt = moved,
            doneTaskIds = done, rpePending = rpe, moodPending = mood, lastTopKey = lastTop, chargeLevel = charge)

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
        // прежней верхней была просроченная задача: календарь выше задач, гистерезис не должен оставлять её наверху
        val r = run(cfg(cards, true), snap(c, lastTop = "t1"))
        assertEquals(listOf("e", "t1", "q"), keys(r)) // задачи — одна карточка (первая по времени)
        assertEquals("e", r.anchorKey)
        assertEquals(QrPriority.SCORE_CYCLE, scoreOf(r, "e")) // событие вне часа — в круге равных, выше любой задачи
    }

    @Test fun anchor_isFirstDyn_whenNoRecommended() {
        val c = cal(12)
        val now = c.timeInMillis
        val cards = listOf(card("e", dyn = "event", at = now + 3_600_000L), card("q"))
        val r = run(cfg(cards, true), snap(c))
        assertEquals("e", r.anchorKey)
        assertEquals("e", r.topKey) // событие в окне — в круге равных (балл SCORE_CYCLE), выше карточки без сигналов
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

    @Test fun eventSoon_within12h_only() {
        val c = cal(12)
        val now = c.timeInMillis
        val cards = listOf(card("s", times = setOf("d")), card("e", dyn = "event", at = now + 30 * min))
        val soon = run(cfg(cards, true), snap(c))
        assertEquals(listOf("e", "s"), keys(soon))
        assertEquals(QrPriority.SCORE_EVENT_SOON, scoreOf(soon, "e"))
        // 11 ч 59 мин — ещё «скоро» (чуть ниже заведённого будильника), 12 ч 01 мин — уже круг равных
        val near = run(cfg(listOf(card("s", times = setOf("d")), card("e", dyn = "event", at = now + 719 * min)), true), snap(c))
        assertEquals(QrPriority.SCORE_EVENT_SOON, scoreOf(near, "e"))
        assertEquals(true, QrPriority.SCORE_EVENT_SOON < QrPriority.SCORE_ALARM_SOON)
        val later = run(cfg(listOf(card("s", times = setOf("d")), card("e", dyn = "event", at = now + 721 * min)), true), snap(c))
        assertEquals(QrPriority.SCORE_CYCLE, scoreOf(later, "e"))
    }

    @Test fun eventSoon_respectsDaysWindow_andNoEventsNoCard() {
        val c = cal(20) // 16.11, 20:00
        val now = c.timeInMillis
        val today = card("today", dyn = "event", at = now + 1 * hour)   // 21:00 сегодня
        val tomorrow = card("tmr", dyn = "event", at = now + 5 * hour)  // 01:00 завтра: до него меньше 12 часов, но это уже завтра
        fun cfgDays(days: Int, cards: List<Card>) = Cfg(id = "w", name = "w", rotate = false, rotateMin = 5, relevance = true, cards = cards, events = true, eventsSoon = true, eventsDays = days)
        // «на 1 день»: только сегодня — завтрашнее событие карточкой не показывается и балл «скоро» не получает
        val one = run(cfgDays(1, listOf(card("q"), tomorrow)), snap(c))
        assertEquals(listOf("q"), keys(one))
        // «на 2 дня»: завтрашнее событие в окне и до него меньше 12 часов — «скоро»
        val two = run(cfgDays(2, listOf(card("q"), tomorrow)), snap(c))
        assertEquals(QrPriority.SCORE_EVENT_SOON, scoreOf(two, "tmr"))
        // сегодняшнее при «на 1 день» — показывается как «скоро»
        val oneToday = run(cfgDays(1, listOf(card("q"), today, tomorrow)), snap(c))
        assertEquals(listOf("today", "q"), keys(oneToday))
        assertEquals(QrPriority.SCORE_EVENT_SOON, scoreOf(oneToday, "today"))
        // событий в окне нет — карточки календаря в стопке нет совсем
        val none = run(cfgDays(1, listOf(card("q"))), snap(c))
        assertEquals(listOf("q"), keys(none))
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
        assertEquals(listOf("al", "ev", "sch", "over", "bat"), keys(r)) // задачи — одна карточка: показана «over» (первая по времени)
    }

    @Test fun battery_low_raisesOnlyBatteryCards() {
        val cards = listOf(card("a"), card("b"), card(QrBattery.KEY))
        for (rel in listOf(false, true)) { // низкий заряд поднимает карточку при любом режиме
            val low = run(cfg(cards, rel), snap(cal(12), battery = 29))
            assertEquals(listOf(QrBattery.KEY, "a", "b"), keys(low))
            assertEquals("Заряд 29 %", low.cards[0].reason)
            assertEquals(QrBattery.KEY, low.topKey)
            assertEquals(QrBattery.KEY, low.anchorKey)
            for (p in listOf(30, 80, -1)) assertEquals(listOf("a", "b", QrBattery.KEY), keys(run(cfg(cards, rel), snap(cal(12), battery = p))))
        }
        // заряд второго вида («несколько устройств») — так же
        val multi = run(cfg(listOf(card("a"), card(QrBattery.KEY2)), true), snap(cal(12), battery = 5))
        assertEquals(listOf(QrBattery.KEY2, "a"), keys(multi))
        // обе карточки заряда — подряд наверху, в порядке пользователя
        val both = run(cfg(listOf(card("a"), card(QrBattery.KEY), card("b"), card(QrBattery.KEY2)), true), snap(cal(12), battery = 10))
        assertEquals(listOf(QrBattery.KEY, QrBattery.KEY2, "a", "b"), keys(both))
    }

    @Test fun battery_low_aboveRpeAndMood() {
        val cards = listOf(card("a"), card(QrBattery.KEY))
        val r = run(cfg(cards, false, rpeAsk = true, moodAsk = true), snap(cal(12), rpe = true, mood = true, battery = 25))
        assertEquals(listOf(QrBattery.KEY, QrRpe.KEY, QrMood.KEY, "a"), keys(r))
        assertEquals(QrBattery.KEY, r.topKey)
        assertEquals(QrBattery.KEY, r.anchorKey)
        // заряд не низкий — «Как тренировка?» наверху, как прежде
        val calm = run(cfg(cards, false, rpeAsk = true, moodAsk = true), snap(cal(12), rpe = true, mood = true, battery = 30))
        assertEquals(listOf(QrRpe.KEY, QrMood.KEY, "a", QrBattery.KEY), keys(calm))
        assertEquals(QrRpe.KEY, calm.topKey)
    }

    @Test fun batteryAlertKind_orangeBelow30_redAtOrBelow20() {
        assertEquals(0, QrPriority.batteryAlertKind(-1))
        assertEquals(0, QrPriority.batteryAlertKind(30))
        assertEquals(1, QrPriority.batteryAlertKind(29))
        assertEquals(1, QrPriority.batteryAlertKind(21))
        assertEquals(2, QrPriority.batteryAlertKind(20))
        assertEquals(2, QrPriority.batteryAlertKind(0))
    }

    @Test fun battery_withoutReason_staysLast_evenIfListedFirst() {
        val cards = listOf(card(QrBattery.KEY), card("a"), card("b"))
        assertEquals(listOf("a", "b", QrBattery.KEY), keys(run(cfg(cards, true), snap(cal(12), battery = 80))))
    }

    // ---------- карточка «Заряд телефона достиг 80 %» ----------

    @Test fun charge_shownFrom80To100_atAnyMode_withoutRelevanceToo() {
        val cards = listOf(card("a"), card("b"))
        for (rel in listOf(false, true)) {
            for (p in listOf(80, 81, 85, 99, 100)) {
                val r = run(cfg(cards, rel, chargeDone = true), snap(cal(12), charge = p))
                assertEquals(listOf(QrCharge.KEY, "a", "b"), keys(r))
                assertEquals(QrCharge.KEY, r.topKey)
                assertEquals(QrCharge.KEY, r.anchorKey)
                assertEquals("Заряд телефона $p %, можно отключать от зарядки", r.cards[0].reason)
            }
        }
    }

    @Test fun charge_hidden_belowThreshold_unplugged_orWithoutCheckbox() {
        val cards = listOf(card("a"), card("b"))
        for (p in listOf(79, 50, 0, -1)) { // -1 — телефон не на зарядке (или заряд неизвестен)
            val r = run(cfg(cards, false, chargeDone = true), snap(cal(12), charge = p))
            assertEquals(listOf("a", "b"), keys(r))
            assertEquals("", r.topKey)
            assertEquals("", r.anchorKey)
        }
        // галочки нет — карточки нет, даже если телефон заряжен
        assertEquals(listOf("a", "b"), keys(run(cfg(cards, false, chargeDone = false), snap(cal(12), charge = 90))))
    }

    @Test fun charge_aboveRpeAndMood() {
        val cards = listOf(card("a"))
        val r = run(cfg(cards, false, rpeAsk = true, moodAsk = true, chargeDone = true), snap(cal(12), rpe = true, mood = true, charge = 85))
        assertEquals(listOf(QrCharge.KEY, QrRpe.KEY, QrMood.KEY, "a"), keys(r))
        assertEquals(QrCharge.KEY, r.topKey)
        assertEquals(QrCharge.KEY, r.anchorKey)
        // телефон отключили от зарядки — «Как тренировка?» наверху, как прежде
        val off = run(cfg(cards, false, rpeAsk = true, moodAsk = true, chargeDone = true), snap(cal(12), rpe = true, mood = true, charge = -1))
        assertEquals(listOf(QrRpe.KEY, QrMood.KEY, "a"), keys(off))
        assertEquals(QrRpe.KEY, off.topKey)
    }

    @Test fun charge_belowLowBatteryCards() {
        // телефон на зарядке (85 %), а наушники сели (15 %): низкий заряд выше, «Заряд телефона достиг 80 %» сразу под ним, затем «Как тренировка?»
        val cards = listOf(card("a"), card(QrBattery.KEY))
        val r = run(cfg(cards, false, rpeAsk = true, chargeDone = true), snap(cal(12), rpe = true, battery = 15, charge = 85))
        assertEquals(listOf(QrBattery.KEY, QrCharge.KEY, QrRpe.KEY, "a"), keys(r))
        assertEquals(QrBattery.KEY, r.topKey)
        assertEquals(QrBattery.KEY, r.anchorKey)
        // обычный (не низкий) заряд: карточка заряда остаётся в основной части, наверху «Заряд телефона достиг 80 %»
        val calm = run(cfg(cards, false, rpeAsk = true, chargeDone = true), snap(cal(12), rpe = true, battery = 60, charge = 85))
        assertEquals(listOf(QrCharge.KEY, QrRpe.KEY, "a", QrBattery.KEY), keys(calm))
        assertEquals(QrCharge.KEY, calm.topKey)
    }

    @Test fun charge_belowRunningTimer() {
        val c = cal(12, 0)
        val cf = Cfg(id = "w", name = "w", rotate = false, rotateMin = 5, relevance = true, cards = emptyList(), rpeAsk = true, timers = true, timerCards = listOf(tmr("t1")), chargeDone = true)
        val r = run(cf, snap(c, rpe = true, timers = setOf("id_t1"), charge = 90))
        assertEquals(listOf("tmr_0", QrCharge.KEY, QrRpe.KEY), keys(r)) // идущий таймер выше всего, затем заряд, затем «Как тренировка?»
        assertEquals("tmr_0", r.topKey)
        assertEquals("tmr_0", r.anchorKey)
    }

    @Test fun charge_doesNotChangeOrderOfOrdinaryCards() {
        val cards = listOf(card("a"), card("s", times = setOf("m", "d", "e", "a")), card("b"))
        val plain = run(cfg(cards, true), snap(cal(12)))
        val withCharge = run(cfg(cards, true, chargeDone = true), snap(cal(12), charge = 95))
        assertEquals(listOf(QrCharge.KEY) + keys(plain), keys(withCharge)) // обычные карточки стоят так же, карточка заряда просто добавлена наверх
    }

    @Test fun charge_countsInVisibleCount() {
        val cf = cfg(emptyList(), false, chargeDone = true)
        assertEquals(0, QrPriority.visibleCount(cf, snap(cal(12), charge = 79)))
        assertEquals(1, QrPriority.visibleCount(cf, snap(cal(12), charge = 80)))
        assertEquals(1, QrPriority.visibleCount(cf, snap(cal(12), charge = 100)))
        assertEquals(0, QrPriority.visibleCount(cfg(emptyList(), false, chargeDone = false), snap(cal(12), charge = 100)))
    }

    @Test fun eventBeforeTask_equalScore_evenIfTaskListedFirst() {
        val now = cal(12).timeInMillis
        val cards = listOf(card("t", dyn = "task", at = now + 24 * hour, tid = "T"), card("q"), card("e", dyn = "event", at = now + 2 * hour))
        val r = run(cfg(cards, true), snap(cal(12)))
        assertEquals(listOf("e", "t", "q"), keys(r)) // событие в окне стоит в круге равных (выше «q» без сигналов); задача на завтра — без сигнала, как «q»
    }

    @Test fun reasons_scheduledWindow() {
        val r = run(cfg(listOf(card("z"), card("s", times = setOf("d"))), true), snap(cal(12)))
        assertEquals("Сейчас её время: обед", r.cards[0].reason)
        assertEquals("Задача просрочена", run(cfg(listOf(card("o", dyn = "task", at = cal(12).timeInMillis - hour, tid = "B"), card("z")), true), snap(cal(12))).cards[0].reason)
    }

    // ---------- этап 2: устойчивость ----------

    @Test fun hysteresis_diff30_keepsPrev() {
        val cards = listOf(card("sch", times = setOf("d")), card("td", dyn = "task", at = cal(12).timeInMillis + hour, tid = "T"))
        // прежняя верхняя — задача на сегодня (470), претендент — «её» время (500): отрыв 30
        val r = run(cfg(cards, true), snap(cal(12), lastTop = "td"))
        assertEquals("td", r.topKey)
        assertEquals(listOf("td", "sch"), keys(r)) // удержанная — первая, остальной порядок как обычно
        assertEquals("td", r.anchorKey)
        assertEquals("td", r.mainTopKey)
        // без прежней верхней порядок обычный
        assertEquals("sch", run(cfg(cards, true), snap(cal(12))).topKey)
    }

    @Test fun hysteresis_diff150_changes() {
        val now = cal(12).timeInMillis
        val cards = listOf(card("sch", times = setOf("d")), card("ev", dyn = "event", at = now + 10 * min))
        val r = run(cfg(cards, true), snap(cal(12), lastTop = "sch")) // 500 → 750
        assertEquals("ev", r.topKey)
        assertEquals(listOf("ev", "sch"), keys(r))
    }

    @Test fun hysteresis_diffExactly100_changes() {
        val now = cal(12).timeInMillis
        val cards = listOf(card("ev", dyn = "event", at = now + 10 * min), card("al", alarmId = "AL1"))
        val r = run(cfg(cards, true), snap(cal(12), lastTop = "ev", alarms = mapOf("AL1" to now + 10 * min))) // 750 → 850: «минимум на 100»
        assertEquals("al", r.topKey)
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
        val cards = listOf(card("sch", times = setOf("d")), card("td", dyn = "task", at = cal(12).timeInMillis + hour, tid = "T"))
        val s1 = snap(cal(12), lastTop = "td")
        val r1 = run(cfg(cards, true), s1)
        val r2 = run(cfg(cards, true), snap(cal(12), lastTop = r1.mainTopKey))
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
        val cards = listOf(card("sch", times = setOf("d")), card("td", dyn = "task", at = cal(12).timeInMillis + hour, tid = "T"))
        val cf = cfg(cards, true)
        val noPrev = QrPriority.build(cf, snap(cal(12))) // верх — «sch», как без запомненной карточки
        val s = snap(cal(12), lastTop = "td") // а прежняя верхняя — задача на сегодня, отрыв всего 30
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

    private fun alarmGroupOf(cf: Cfg, s: QrPriority.Snapshot) = QrPriority.groups(cf, s).first { it.key == QrPriority.ALARM_SLOT_KEY }

    @Test fun alarmRow_oneCardByClock_defaultRingingThenNearestArmed() {
        val c = cal(12)
        val now = c.timeInMillis
        val cf = cfg(listOf(alarmCard("a9", 21, 0), alarmCard("a7", 7, 0), alarmCard("a8", 8, 30)))
        val s = snap(c)
        assertEquals(listOf("a7", "a8", "a9"), QrPriority.alarmCards(cf, s).map { it.key }) // по времени суток, не по порядку присылки
        assertEquals(0, alarmGroupOf(cf, s).defaultIdx) // ничего не заведено — первый по времени
        val armed = snap(c, alarms = mapOf("id_a8" to now + 20 * hour, "id_a9" to now + 9 * hour))
        assertEquals(2, alarmGroupOf(cf, armed).defaultIdx) // заведённый с ближайшим звонком (a9)
        assertEquals(1, alarmGroupOf(cf, snap(c, alarms = armed.alarms, ringing = setOf("id_a8"))).defaultIdx) // звонящий важнее (a8)
        assertEquals(listOf(QrPriority.ALARM_SLOT_KEY), keys(run(cf, s))) // в стопке одна карточка на все будильники
        assertEquals(emptyList<QrPriority.Group>(), QrPriority.groups(cfg(emptyList()), s)) // будильников нет — карточки нет
        assertEquals(emptyList<String>(), keys(run(cfg(emptyList()), s)))
    }

    @Test fun alarmRow_scoreFromAllAlarms_notFromShownOne() {
        val c = cal(12)
        val now = c.timeInMillis
        val cf = cfg(listOf(card("a"), alarmCard("a7", 7, 0), alarmCard("a9", 21, 0)), relevance = true)
        // зазвонит a9 через 30 минут: карточка «Будильники» поднимается и показывает именно его
        val s = snap(c, alarms = mapOf("id_a9" to now + 30 * 60_000L))
        val r = run(cf, s)
        assertEquals(listOf("alm_0", "a"), keys(r))
        assertEquals("alm_0", r.topKey)
        assertEquals("Будильник через 30 мин", r.topReason)
        assertEquals("a9", r.topTitle) // объяснение называет показанный будильник, а не заголовок карточки
        assertEquals(1, r.faces["alm_0"])
        // до звонка дальше 30 минут — карточка не выделена, на ней будильник по умолчанию (ближайший заведённый)
        val mid = run(cf, snap(c, alarms = mapOf("id_a9" to now + 45 * 60_000L)))
        assertEquals(listOf("a", "alm_0"), keys(mid)) // 45 минут: раньше (за час) уже поднималась
        assertEquals("", mid.topKey)
        val far = run(cf, snap(c, alarms = mapOf("id_a9" to now + 3 * hour)))
        assertEquals(listOf("a", "alm_0"), keys(far))
        assertEquals("", far.topKey)
        // нет релевантности — порядок пользователя (карточка будильников на месте первого будильника), баллов нет
        assertEquals(listOf("a", "alm_0"), keys(run(cfg(cf.cards, false), s)))
    }

    @Test fun alarmRow_ringingBeatsHysteresis_andNextChange() {
        val c = cal(12)
        val now = c.timeInMillis
        val cf = cfg(listOf(card("b", times = setOf("d")), alarmCard("a7", 7, 0), alarmCard("a9", 21, 0)), relevance = true)
        // прежде наверху была «b» (её время суток), зазвонил a9 — звонящий забирает верх сразу
        val ring = snap(c, alarms = mapOf("id_a9" to now - 1000L), ringing = setOf("id_a9"), lastTop = "b").copy(alarmRowRinging = true)
        val r = run(cf, ring)
        assertEquals("alm_0", r.topKey)
        assertEquals("Звонит будильник", r.topReason)
        assertEquals("a9", r.topTitle)
        assertEquals(now + 60_000L, r.nextChangeAt) // пока звонит — перепроверка через минуту
        // заведённый на 15:00 а9 зазвонит позже: «скоро» наступит в 14:30:01 (раньше границы окон 15:00:05)
        val soon = run(cf, snap(c, alarms = mapOf("id_a9" to now + 3 * hour)))
        assertEquals(now + 2 * hour + 30 * min + 1_000L, soon.nextChangeAt)
    }

    @Test fun alarmRow_soonBeatsEvent_evenWhenShownAnotherAlarm() {
        val c = cal(12)
        val now = c.timeInMillis
        val cf = cfg(listOf(card("ev", dyn = "event", at = now + 20 * min), alarmCard("a7", 7, 0), alarmCard("a9", 21, 0)), relevance = true)
        // событие наверху, а зазвонит a9 через 20 минут: карточка будильников забирает верх у календаря
        val s = snap(c, alarms = mapOf("id_a9" to now + 20 * min), lastTop = "ev")
        val r = run(cf, s)
        assertEquals(listOf("alm_0", "ev"), keys(r))
        assertEquals("alm_0", r.topKey)
        assertEquals("Будильник через 20 мин", r.topReason)
        // будильник дальше 30 минут — календарь остаётся наверху
        val later = run(cf, snap(c, alarms = mapOf("id_a9" to now + 40 * min), lastTop = "ev"))
        assertEquals("ev", later.topKey)
    }

    @Test fun alarmGroup_twoSoonTakeTurns_outOfWindowNever() {
        val cf = cfg(listOf(alarmCard("a7", 7, 0), alarmCard("a8", 8, 30), alarmCard("a9", 21, 0)), relevance = true)
        // a8 и a9 зазвонят в ближайшие полчаса, a7 заведён на завтра: на единственной карточке по очереди a8 и a9, a7 — никогда
        val rs = (0..5).map { m ->
            val c = cal(12, m)
            run(cf, snap(c, alarms = mapOf("id_a7" to c.timeInMillis + 18 * hour, "id_a8" to c.timeInMillis + 10 * min, "id_a9" to c.timeInMillis + 20 * min)))
        }
        for (r in rs) assertEquals("alm_0", r.topKey) // карточка одна и стоит на месте
        assertEquals(setOf(1, 2), rs.map { it.faces["alm_0"] }.toSet())
        assertTrue(rs[0].faces["alm_0"] != rs[1].faces["alm_0"]) // меняется каждую минуту
        assertEquals(rs[0].faces["alm_0"], rs[2].faces["alm_0"])
        for (m in rs.indices) assertEquals(QrPriority.nextCycleAt(cal(12, m).timeInMillis), rs[m].cycleAt) // круг идёт: перерисовка на ближайшей минуте
    }

    @Test fun alarmGroup_ringingStaysVisible_untilSwitchedOff() {
        val cf = cfg(listOf(card("q"), alarmCard("a7", 7, 0), alarmCard("a8", 8, 30), alarmCard("a9", 21, 0)), relevance = true)
        for (m in 0..4) {
            val c = cal(12, m)
            // a9 звонит, a8 «скоро»: в круг входит только верхний ярус — звонящий; «скоро» ему не мешает
            val r = run(cf, snap(c, alarms = mapOf("id_a9" to c.timeInMillis - 1000L, "id_a8" to c.timeInMillis + 10 * min), ringing = setOf("id_a9")).copy(alarmRowRinging = true))
            assertEquals(2, r.faces["alm_0"])
            assertEquals(Long.MAX_VALUE, r.cycleAt) // одна очередь — круга нет
        }
        // звонят два: сменяют друг друга
        val two = (0..3).map { m ->
            val c = cal(12, m)
            run(cf, snap(c, ringing = setOf("id_a7", "id_a9"), alarms = mapOf("id_a7" to c.timeInMillis - 1000L, "id_a9" to c.timeInMillis - 1000L)).copy(alarmRowRinging = true)).faces["alm_0"]
        }
        assertEquals(setOf(0, 2), two.toSet())
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

    // ---------- карточка «Привычки» ----------

    private fun hab(key: String, times: Set<String> = emptySet(), days: Set<Int> = emptySet(), done: Int = 0) =
        Card(key = key, code = "", title = key, live = emptyList(), times = times, days = days, dyn = "habit", habit = true, doneDay = done)

    private fun cfgH(habits: List<Card>, cards: List<Card> = emptyList()) =
        Cfg(id = "w", name = "w", rotate = true, rotateMin = 1, relevance = false, cards = cards, habits = true, habitCards = habits)

    @Test fun habits_dueEnterTheCircle_othersDoNot() {
        val hs = listOf(hab("water", setOf("e")), hab("run", setOf("m")), hab("read", setOf("m")))
        val cf = cfgH(hs, listOf(card("cal")))
        val s = snap(cal(8))
        // утро: календарь и ОДНА карточка привычек (бег и чтение сменяют друг друга на ней); «вода» — вечерняя, в круг не попадает, но стоит в ряду последней
        assertEquals(listOf("cal", "hab_0"), keys(run(cf, s)))
        assertEquals(listOf("run", "read", "water"), QrPriority.habitList(cf, s).map { it.key })
        assertEquals(2, QrPriority.groups(cf, s)[0].turns) // очередей в круге — по числу привычек «в своё время»
    }

    // ---------- карточка «Заметки» (отдельно от «Книг»; время суток заметки выбирается на экране «Заметки-карточки») ----------

    private fun note(key: String, times: Set<String> = emptySet()) = card(key, times = times, dyn = "note")

    private fun cfgNotes(notes: List<Card>, cards: List<Card> = emptyList(), books: List<Card> = emptyList()) =
        Cfg(id = "w", name = "w", rotate = false, rotateMin = 5, relevance = true, cards = cards, books = books.isNotEmpty(), bookCards = books, notes = true, noteCards = notes)

    @Test fun notes_dueNoteEntersTheCircle_othersDoNot() {
        val ns = listOf(note("bk_nt_eve", setOf("e")), note("bk_nt_morn", setOf("m")), note("bk_nt_none"))
        val cf = cfgNotes(ns, listOf(card("cal")))
        val s = snap(cal(8))
        assertEquals(listOf("cal", "nt_0"), keys(run(cf, s))) // ОДНА карточка «Заметки»
        val g = QrPriority.groups(cf, s).first { it.key == QrPriority.NOTE_SLOT_KEY }
        assertEquals(listOf(0, QrPriority.SCORE_CYCLE, 0), g.scores) // утро: в круг входит только утренняя заметка
        assertEquals(1, g.defaultIdx) // показана заметка «в своё время»
        assertEquals(1, g.turns)
    }

    @Test fun notes_allDay_alwaysDue_noTime_neverDue() {
        val cf = cfgNotes(listOf(note("bk_nt_all", setOf("a")), note("bk_nt_none")))
        for (h in listOf(3, 8, 13, 16, 20)) {
            val g = QrPriority.groups(cf, snap(cal(h))).first { it.key == QrPriority.NOTE_SLOT_KEY }
            assertEquals(listOf(QrPriority.SCORE_CYCLE, 0), g.scores)
        }
    }

    @Test fun notes_areSeparateCardFromBooks() {
        val cf = cfgNotes(listOf(note("bk_nt_x")), books = listOf(card("bk_book1", dyn = "book")))
        assertEquals(listOf("bk_0", "nt_0"), keys(run(cf, snap(cal(8)))))
    }

    @Test fun habits_manyDue_stillExactlyOneCard() {
        val hs = listOf(hab("a", setOf("m")), hab("b", setOf("m")), hab("c", setOf("m")), hab("d", setOf("m")))
        val cf = cfgH(hs, listOf(card("cal"), card("x")))
        val s = snap(cal(8))
        assertEquals(listOf("cal", "x", "hab_0"), keys(run(cf, s))) // свайп по стопке — только по группам, привычки не размножают карточки
        assertEquals(4, QrPriority.groups(cf, s)[0].turns)
    }

    @Test fun habits_noneDue_oneSlotShowsFirstInUserOrder() {
        val hs = listOf(hab("water", setOf("e")), hab("run", setOf("m")))
        val cf = cfgH(hs)
        val s = snap(cal(13)) // обед: ни у одной привычки сейчас её времени нет
        assertEquals(listOf("hab_0"), keys(run(cf, s)))
        assertEquals(listOf("water", "run"), QrPriority.habitList(cf, s).map { it.key })
    }

    @Test fun habits_allDay_dueAtAnyHour_untilDone() {
        val hs = listOf(hab("water", setOf("a")), hab("run", setOf("m")))
        val cf = cfgH(hs)
        for (h in listOf(0, 3, 13, 16, 23)) assertTrue("час $h", QrPriority.habitDue(hs[0], snap(cal(h))))
        assertFalse(QrPriority.habitDue(hs[1], snap(cal(13)))) // обычное время суток по-прежнему только в своё окно
        assertEquals(listOf("water", "run"), QrPriority.habitList(cf, snap(cal(3))).map { it.key })
        val done = listOf(hab("water", setOf("a"), done = 20261116), hs[1])
        assertEquals(listOf("run"), QrPriority.habitList(cfgH(done), snap(cal(3))).map { it.key }) // отмеченная сегодня уходит
        assertEquals(listOf("water", "run"), QrPriority.habitList(cfgH(done), snap(cal(3, day = 17))).map { it.key }) // на следующий день снова весь день
    }

    @Test fun habits_allDay_respectsDays() {
        val h = hab("water", setOf("a"), days = setOf(2)) // только вторник; 16 ноября 2026 — понедельник
        assertFalse(QrPriority.habitDue(h, snap(cal(12))))
        assertTrue(QrPriority.habitDue(h, snap(cal(12, day = 17))))
    }

    @Test fun allDay_todayCard_risesAllDay_hiddenAfterFired() {
        val cf = cfg(listOf(card("x"), card("today", times = setOf("a"), after = "hide")), relevance = true)
        assertEquals("today", keys(run(cf, snap(cal(3)))).first())
        assertEquals("today", keys(run(cf, snap(cal(14, 30)))).first())
        assertEquals(listOf("x"), keys(run(cf, snap(cal(14, 30), hidden = setOf("today"))))) // сработала — скрыта до полуночи
    }

    @Test fun habits_doneDisappearOneByOne_allDoneNoCard() {
        val hs = listOf(hab("run", setOf("m")), hab("read", setOf("m"), done = 20261116))
        val cf = cfgH(hs)
        // «чтение» отмечено в приложении сегодня (doneDay), «бег» осталось: один слот
        assertEquals(listOf("hab_0"), keys(run(cf, snap(cal(8)))))
        assertEquals(listOf("run"), QrPriority.habitList(cf, snap(cal(8))).map { it.key })
        // «бег» отмечено двойным нажатием в виджете (ключ в hiddenKeys): привычек не осталось — карточки нет
        val all = snap(cal(8), hidden = setOf("run"))
        assertEquals(emptyList<String>(), keys(run(cf, all)))
        assertEquals(0, QrPriority.visibleCount(cf, all))
        // отметка вчерашним днём сегодня ничего не скрывает: обе привычки на одной карточке
        assertEquals(listOf("hab_0"), keys(run(cfgH(listOf(hab("run", setOf("m"), done = 20261115), hab("read", setOf("m")))), snap(cal(8)))))
    }

    // ---------- круг равных: привычки «в своё время» и календарь ----------

    private fun cfgCycle(habits: List<Card>, cards: List<Card>) =
        Cfg(id = "w", name = "w", rotate = false, rotateMin = 1, relevance = true, cards = cards, habits = true, habitCards = habits)

    @Test fun cycle_twoDueHabitsAndCalendar_eachOnTopForAMinute_thirdHabitNever() {
        val ev = card("e", dyn = "event", at = cal(18).timeInMillis + 5 * hour)
        val hs = listOf(hab("run", setOf("e")), hab("read", setOf("e")), hab("morning", setOf("m")))
        val cf = cfgCycle(hs, listOf(card("q"), ev))
        val rs = (0..5).map { run(cf, snap(cal(18, it))) }
        assertEquals(setOf("e", "hab_0"), rs.map { it.topKey }.toSet()) // карточек две: календарь и «Привычки»; «утренняя» привычка в круг не входит
        // круг из трёх очередей (календарь, бег, чтение): за три минуты календарь наверху один раз, карточка «Привычки» — два, и на ней разные привычки
        val three = rs.take(3)
        assertEquals(1, three.count { it.topKey == "e" })
        assertEquals(setOf(0, 1), three.filter { it.topKey == "hab_0" }.map { it.faces["hab_0"] }.toSet())
        assertEquals(rs[0].topKey, rs[3].topKey) // через три минуты — снова то же
        assertEquals(rs[0].faces["hab_0"], rs[3].faces["hab_0"])
        for (m in 0..2) assertEquals(SCORE, rs[m].cards[0].score)
    }

    @Test fun cycle_noCalendar_habitsTakeTurns_cardStaysHabitChanges() {
        val two = cfgCycle(listOf(hab("run", setOf("e")), hab("read", setOf("e"))), listOf(card("q")))
        val rs = (0..3).map { run(two, snap(cal(18, it))) }
        for (r in rs) assertEquals("hab_0", r.topKey) // карточка одна и стоит на месте
        assertEquals(setOf(0, 1), rs.map { it.faces["hab_0"] }.toSet())
        assertTrue(rs[0].faces["hab_0"] != rs[1].faces["hab_0"]) // а привычка на ней меняется каждую минуту
        assertEquals(rs[0].faces["hab_0"], rs[2].faces["hab_0"])
        val one = cfgCycle(listOf(hab("run", setOf("e")), hab("read", setOf("m"))), listOf(card("q")))
        for (m in 0..3) {
            val r = run(one, snap(cal(18, m)))
            assertEquals("hab_0", r.topKey) // привычка «в своё время» одна — наверху всегда она
            assertEquals(0, r.faces["hab_0"])
        }
    }

    @Test fun cycle_onlyHabitCardInStack_stillTakesTurns() {
        val cf = cfgCycle(listOf(hab("run", setOf("e")), hab("read", setOf("e"))), emptyList()) // в стопке всего одна карточка
        val rs = (0..3).map { run(cf, snap(cal(18, it))) }
        assertEquals(listOf("hab_0"), keys(rs[0]))
        for (r in rs) assertEquals("hab_0", r.topKey)
        assertEquals(setOf(0, 1), rs.map { it.faces["hab_0"] }.toSet())
        assertEquals(rs[0].cycleAt, cal(18, 0).timeInMillis + 60_000L + 1_000L) // круг идёт: виджет перерисуется на следующей минуте
    }

    @Test fun cycle_previousTopDoesNotHoldHysteresis() {
        val ev = card("e", dyn = "event", at = cal(18).timeInMillis + 5 * hour)
        val cf = cfgCycle(listOf(hab("run", setOf("e")), hab("read", setOf("e"))), listOf(card("q"), ev))
        for (m in 0..5) {
            val free = run(cf, snap(cal(18, m)))
            val prev = run(cf, snap(cal(18, m - 1))).topKey
            val held = run(cf, snap(cal(18, m), lastTop = prev))
            assertEquals(free.topKey, held.topKey) // прежняя верхняя карточка круг не удерживает
            assertEquals(free.faces["hab_0"], held.faces["hab_0"])
            assertEquals(held.topKey, held.mainTopKey)
        }
    }

    @Test fun cycle_urgentBeatsCircle_andCycleAtIsNextMinute() {
        val c = cal(18, 0)
        val now = c.timeInMillis
        val cf = cfgCycle(listOf(hab("run", setOf("e")), hab("read", setOf("e"))), listOf(card("q"), card("e", dyn = "event", at = now + 20 * min)))
        val r = run(cf, snap(c))
        assertEquals("e", r.topKey) // событие через 20 минут (750) выше круга равных (500): круга нет
        assertEquals(Long.MAX_VALUE, r.cycleAt)
        val calm = cfgCycle(listOf(hab("run", setOf("e")), hab("read", setOf("e"))), listOf(card("q")))
        val r2 = run(calm, snap(c))
        assertEquals(now + 60_000L + 1_000L, r2.cycleAt)
        assertEquals(cal(23, 0).timeInMillis + 5_000L, r2.nextChangeAt) // будильник ради круга не ставится: ближайшее — граница окон времени суток
    }

    @Test fun cycle_tasksAreBelowCalendarAndHabits_andOutsideTheCircle() {
        val c = cal(18, 0)
        val now = c.timeInMillis
        val cf = cfgCycle(listOf(hab("run", setOf("e")), hab("read", setOf("e"))), listOf(card("q"), card("e", dyn = "event", at = now + 5 * hour),
            card("t", dyn = "task", at = now - hour, tid = "T")))
        val tops = (0..5).map { run(cf, snap(cal(18, it))).topKey }
        assertEquals(setOf("e", "hab_0"), tops.toSet()) // задача (даже просроченная) наверх в круге не встаёт
        val last = run(cf, snap(c)).cards.map { it.card.key }
        assertEquals("t", last[2]) // после двух участников круга: календаря и карточки «Привычки»
        assertTrue(QrPriority.SCORE_TASK_OVERDUE < QrPriority.SCORE_CYCLE && QrPriority.SCORE_TASK_TODAY < QrPriority.SCORE_CYCLE)
    }

    @Test fun cycle_scheduledHabitNotDue_isLowerThanCircle() {
        val cf = cfgCycle(listOf(hab("run", setOf("m")), hab("read", setOf("m"))), listOf(card("q"), card("e", dyn = "event", at = cal(18).timeInMillis + 5 * hour)))
        val r = run(cf, snap(cal(18, 0))) // вечер, обе привычки утренние: слот один, балла нет; наверху календарь
        assertEquals("e", r.topKey)
        assertEquals(0, scoreOf(r, "hab_0"))
    }

    // ---------- единая модель круга: обычные карточки, несколько групп, равные баллы ----------

    @Test fun cycle_ordinaryCards_equalScoreTakeTurnsEveryMinute() {
        val names = listOf("q1", "q2", "q3")
        val cf = cfg(names.map { card(it, times = setOf("d")) }, relevance = true) // в 12:00 у всех троих «их» время: балл одинаковый
        for (m in 0..6) {
            val c = cal(12, m)
            val r = run(cf, snap(c))
            val turn = Math.floorMod(c.timeInMillis / QrPriority.CYCLE_MS, 3L).toInt() // номер очереди = минута по модулю числа очередей
            assertEquals(names[turn], r.topKey)
            assertEquals(names[turn], keys(r)[0])
            assertEquals(QrPriority.nextCycleAt(c.timeInMillis), r.cycleAt)
        }
    }

    @Test fun cycle_equalScoreNotHeld() { // а отрыв меньше HYSTERESIS по-прежнему удерживает прежнюю верхнюю — см. hysteresis_diff50_keepsPrev и hysteresis_diffExactly100_changes
        val cf = cfg(listOf(card("q1", times = setOf("d")), card("q2", times = setOf("d"))), relevance = true)
        for (m in 0..3) {
            val c = cal(12, m)
            val free = run(cf, snap(c))
            val other = if (free.topKey == "q1") "q2" else "q1"
            val held = run(cf, snap(c, lastTop = other))
            assertEquals(free.topKey, held.topKey) // равные баллы прежнюю верхнюю не удерживают
        }
    }

    @Test fun cycle_groupEventAndOrdinaryCard_turnsAreSummed_oneCardPerGroup() {
        val ev = card("e", dyn = "event", at = cal(18).timeInMillis + 5 * hour)
        val hs = listOf(hab("run", setOf("e")), hab("read", setOf("e")), hab("swim", setOf("e")))
        val cf = cfgCycle(hs, listOf(card("q", times = setOf("e")), ev)) // обычная карточка с её временем (1) + календарь (1) + «Привычки» (3 привычки)
        val rs = (0..9).map { run(cf, snap(cal(18, it))) }
        for (r in rs) assertEquals(1, keys(r).count { it == "hab_0" }) // группа — одна карточка, сколько бы элементов ни было
        val period = rs.take(5)
        assertEquals(1, period.count { it.topKey == "q" })
        assertEquals(1, period.count { it.topKey == "e" })
        assertEquals(setOf(0, 1, 2), period.filter { it.topKey == "hab_0" }.map { it.faces["hab_0"] }.toSet()) // пять очередей: 1 + 1 + 3
        assertEquals(rs[0].topKey, rs[5].topKey) // через пять минут — снова то же
    }

    @Test fun cycle_ringingAlarmGroup_interruptsHabitCircle() {
        val c = cal(18, 0)
        val alm = alarmCard("a9", 21, 0)
        val cf = Cfg(id = "w", name = "w", rotate = false, rotateMin = 1, relevance = true, cards = listOf(alm), habits = true,
            habitCards = listOf(hab("run", setOf("e")), hab("read", setOf("e"))))
        val r = run(cf, snap(c, alarms = mapOf("id_a9" to c.timeInMillis - 1000L), ringing = setOf("id_a9")).copy(alarmRowRinging = true))
        assertEquals("alm_0", r.topKey) // звонящий (1100) выше круга привычек (500): круг прерван
        assertEquals(Long.MAX_VALUE, r.cycleAt)
        assertEquals(listOf("alm_0", "hab_0"), keys(r))
        val calm = run(cf, snap(c)) // будильник далеко: наверху «Привычки» и круг идёт
        assertEquals("hab_0", calm.topKey)
        assertEquals(c.timeInMillis + 60_000L + 1_000L, calm.cycleAt)
    }

    @Test fun cycle_groupNotInTopTier_showsDefaultItem() {
        val c = cal(18, 0)
        val cf = cfgCycle(listOf(hab("run", setOf("m")), hab("read", setOf("m"))), listOf(card("e", dyn = "event", at = c.timeInMillis + 5 * hour)))
        for (m in 0..3) {
            val r = run(cf, snap(cal(18, m)))
            assertEquals(0, r.faces["hab_0"]) // обе привычки утренние: группа не в ярусе, показана первая
        }
    }


    // ---------- карточка «Таймеры» ----------

    private fun tmr(key: String, sec: Int = 600, times: Set<String> = emptySet()) =
        Card(key = key, code = "", title = key, live = listOf(Live("timer", "id_" + key)), times = times, days = emptySet(), dyn = "timer", sec = sec)

    private fun cfgTimers(timers: List<Card>, cards: List<Card> = emptyList(), relevance: Boolean = true, rpeAsk: Boolean = false) =
        Cfg(id = "w", name = "w", rotate = false, rotateMin = 5, relevance = relevance, cards = cards, rpeAsk = rpeAsk, timers = true, timerCards = timers)

    @Test fun timers_active_isFirst_aboveRpeAndCalendar() {
        val c = cal(12, 0)
        val ev = card("e", dyn = "event", at = c.timeInMillis + hour / 2) // событие скоро (750)
        val cf = cfgTimers(listOf(tmr("t1"), tmr("t2")), listOf(ev), relevance = true, rpeAsk = true)
        val r = run(cf, snap(c, rpe = true, timers = setOf("id_t2")))
        assertEquals(listOf("tmr_0", QrRpe.KEY, "e"), keys(r)) // таймер выше «Как тренировка?» и календаря
        assertEquals("tmr_0", r.topKey)
        assertEquals("tmr_0", r.anchorKey)
        assertEquals(1, r.faces["tmr_0"]) // показан тот таймер, что идёт
        assertEquals(QrPriority.nextCycleAt(c.timeInMillis), r.minuteAt) // кольцо перерисовывается раз в минуту
    }

    @Test fun timers_active_isFirst_evenWithoutRelevance() {
        val c = cal(12, 0)
        val cf = cfgTimers(listOf(tmr("t1")), listOf(card("a"), card("b")), relevance = false)
        val r = run(cf, snap(c, timers = setOf("id_t1")))
        assertEquals(listOf("tmr_0", "a", "b"), keys(r))
        assertEquals("tmr_0", r.topKey)
        val idle = run(cf, snap(c)) // не идёт: порядок пользователя, карточка таймеров в конце, наверх не поднимается
        assertEquals(listOf("a", "b", "tmr_0"), keys(idle))
        assertEquals("", idle.topKey)
        assertEquals(Long.MAX_VALUE, idle.minuteAt)
    }

    @Test fun timers_twoActive_alternateEveryMinute() {
        val cf = cfgTimers(listOf(tmr("t1"), tmr("t2"), tmr("t3")))
        val seen = ArrayList<Int>()
        for (m in 0..5) {
            val c = cal(12, m)
            val r = run(cf, snap(c, timers = setOf("id_t1", "id_t3")))
            assertEquals("tmr_0", r.topKey)
            val i = r.faces["tmr_0"]!!
            assertTrue(i == 0 || i == 2) // только идущие: t1 и t3
            seen.add(i)
        }
        for (k in 1 until seen.size) assertTrue(seen[k] != seen[k - 1]) // каждую минуту — другой
    }

    @Test fun timers_dueInOwnTime_beatsCalendarAndHabits() {
        val c = cal(12, 0)
        val ev = card("e", dyn = "event", at = c.timeInMillis + 5 * hour)
        val cf = cfgTimers(listOf(tmr("t1", times = setOf("d")), tmr("t2")), listOf(ev))
        val r = run(cf, snap(c))
        assertEquals("tmr_0", r.topKey) // «дневной» таймер в 12:00 выше календаря
        assertEquals(0, r.faces["tmr_0"])
        assertEquals(Long.MAX_VALUE, r.minuteAt) // не запущен — перерисовывать раз в минуту нечего
        val held = run(cf, snap(c, lastTop = "e")) // и гистерезис прежний календарь не держит (950 ≥ 500 + 100)
        assertEquals("tmr_0", held.topKey)
        val night = run(cf, snap(cal(2, 0))) // ночью «его» времени нет
        assertTrue(night.topKey != "tmr_0")
    }

    @Test fun timers_noTimesNotRunning_doesNotRise() {
        val c = cal(12, 0)
        val ev = card("e", dyn = "event", at = c.timeInMillis + 5 * hour)
        val r = run(cfgTimers(listOf(tmr("t1"), tmr("t2")), listOf(ev)), snap(c))
        assertEquals("e", r.topKey) // у таймера без времени суток балла нет: наверху календарь
        assertEquals(1, keys(r).count { it == "tmr_0" }) // но карточка «Таймеры» в стопке есть
    }

    @Test fun timers_activeBeatsRingingAlarm() {
        val c = cal(12, 0)
        val cf = cfgTimers(listOf(tmr("t1")), listOf(card("al", alarmId = "id_al")))
        val r = run(cf, snap(c, timers = setOf("id_t1"), alarms = mapOf("id_al" to c.timeInMillis - 1000L), ringing = setOf("id_al")))
        assertEquals("tmr_0", r.topKey) // идущий таймер выше звонящего будильника
        assertEquals(listOf("tmr_0", "al"), keys(r))
    }

    @Test fun timers_scoresInResult() {
        val c = cal(12, 0)
        val cf = cfgTimers(listOf(tmr("t1", times = setOf("d")), tmr("t2")))
        assertEquals(QrPriority.SCORE_TIMER_DUE, run(cf, snap(c)).cards.first { it.card.key == "tmr_0" }.score)
        assertEquals(QrPriority.SCORE_TIMER_ACTIVE, run(cf, snap(c, timers = setOf("id_t2"))).cards.first { it.card.key == "tmr_0" }.score)
    }

    private val SCORE = QrPriority.SCORE_CYCLE
}

/** Сценарии диспетчера движения стопки (TZ_motion_dispatcher.md, п. 7). */
class QrMotionTest {
    private val NOW = 1_000_000_000L

    private fun inp(
        kind: QrPriority.Motion.Kind, last: Long = 0L, swipe: Boolean = false, screen: Boolean = true,
        onTarget: Boolean = false, exists: Boolean = true, now: Long = NOW
    ) = Motion.Input(kind, now, last, swipe, screen, onTarget, exists)

    /** 1. Касание 10 с назад + новая верхняя карточка → отложить до конца паузы. */
    @Test fun touch10sAgo_newTop_deferred() {
        val d = Motion.decide(inp(Motion.Kind.NEW_TOP, last = NOW - 10_000L))
        assertEquals(Motion.Action.DEFER, d.action)
        assertEquals(NOW - 10_000L + Motion.INTERACTION_PAUSE_MS + Motion.MARGIN_MS, d.at)
    }

    /** 2. Новое касание до срока сдвигает срок. */
    @Test fun newTouch_movesDeadline() {
        val a = Motion.decide(inp(Motion.Kind.NEW_TOP, last = NOW - 50_000L)).at
        val b = Motion.decide(inp(Motion.Kind.NEW_TOP, last = NOW - 5_000L)).at
        assertTrue(b > a)
    }

    /** 3. Несколько намерений в паузу дают одно и то же решение «ждать до одного срока» (свёртка: срок один, а не по числу намерений). */
    @Test fun manyIntents_oneDeadline() {
        val last = NOW - 20_000L
        val ats = listOf(Motion.Kind.NEW_TOP, Motion.Kind.RETURN_TOP, Motion.Kind.ROTATE).map { Motion.decide(inp(it, last = last)) }
        assertTrue(ats.all { it.action == Motion.Action.DEFER })
        assertEquals(1, ats.map { it.at }.toSet().size)
        // после конца паузы — движение
        assertEquals(Motion.Action.MOVE_NOW, Motion.decide(inp(Motion.Kind.NEW_TOP, last = last, now = ats[0].at)).action)
    }

    /** 4. Действия пользователя и постановка виджета паузу обходят. */
    @Test fun userActionsBypassPause() {
        val last = NOW - 1_000L
        assertEquals(Motion.Action.MOVE_NOW, Motion.decide(inp(Motion.Kind.STAY_ON_SLOT, last = last)).action)
        assertEquals(Motion.Action.MOVE_NOW, Motion.decide(inp(Motion.Kind.PLACED, last = last)).action)
        assertEquals(Motion.Action.MOVE_NOW, Motion.decide(inp(Motion.Kind.STAY_ON_SLOT, last = last, screen = false)).action)
    }

    /** 5. Закрепление: решает цель, а не диспетчер; STAY_ON_SLOT всегда исполняется — цель берёт оболочка из закрепления. Здесь — что слот закрепления идёт первым при заморозке. */
    @Test fun pinnedSlot_firstInFrozenOrder() {
        val out = Motion.reorderBySlots(listOf("hab_0", "cal", "alm_0"), listOf("cal", "alm_0", "hab_0"), { it })
        assertEquals(listOf("hab_0", "cal", "alm_0"), out)
    }

    /** 6. Стопка уже на целевой карточке → отбросить. */
    @Test fun alreadyOnTarget_drop() {
        assertEquals(Motion.Action.DROP, Motion.decide(inp(Motion.Kind.NEW_TOP, onTarget = true)).action)
    }

    /** 7. Цель исчезла → отбросить. */
    @Test fun targetGone_drop() {
        assertEquals(Motion.Action.DROP, Motion.decide(inp(Motion.Kind.RETURN_TOP, exists = false)).action)
        assertEquals(Motion.Action.DROP, Motion.decide(inp(Motion.Kind.NEW_TOP, exists = false)).action)
    }

    /** 8. Экран выключен → не двигать, ждать включения экрана. */
    @Test fun screenOff_deferredToScreenOn() {
        val d = Motion.decide(inp(Motion.Kind.NEW_TOP, screen = false))
        assertEquals(Motion.Action.DEFER, d.action)
        assertEquals(Motion.AT_SCREEN_ON, d.at)
        assertEquals(Motion.Action.DEFER, Motion.decide(inp(Motion.Kind.ROTATE, screen = false)).action)
    }

    /** 9. Только лицо — не движение, даже в паузу и при выключенном экране. */
    @Test fun faceOnly_neverMoves() {
        assertEquals(Motion.Action.FACE, Motion.decide(inp(Motion.Kind.FACE_ONLY, last = NOW - 1L)).action)
        assertEquals(Motion.Action.FACE, Motion.decide(inp(Motion.Kind.FACE_ONLY, screen = false)).action)
    }

    /** 10. Границы: ровно пауза назад — ещё ждать только до запаса; касание из будущего (часы назад) паузы не создаёт; после смахивания пауза длиннее. */
    @Test fun boundaries() {
        // ровно INTERACTION_PAUSE_MS назад: срок прошёл (q == now) — двигать можно
        assertEquals(Motion.Action.MOVE_NOW, Motion.decide(inp(Motion.Kind.NEW_TOP, last = NOW - Motion.INTERACTION_PAUSE_MS)).action)
        // на миллисекунду раньше — ещё ждать
        assertEquals(Motion.Action.DEFER, Motion.decide(inp(Motion.Kind.NEW_TOP, last = NOW - Motion.INTERACTION_PAUSE_MS + 1L)).action)
        // часы переведены назад: касание «из будущего» не держит стопку
        assertEquals(Motion.Action.MOVE_NOW, Motion.decide(inp(Motion.Kind.NEW_TOP, last = NOW + 3_600_000L)).action)
        // нет касаний вообще
        assertEquals(Motion.Action.MOVE_NOW, Motion.decide(inp(Motion.Kind.NEW_TOP, last = 0L)).action)
        // после смахивания покой дольше: 90 с назад после нажатия — можно, после смахивания — ещё нельзя
        assertEquals(Motion.Action.MOVE_NOW, Motion.decide(inp(Motion.Kind.NEW_TOP, last = NOW - 90_000L, swipe = false)).action)
        assertEquals(Motion.Action.DEFER, Motion.decide(inp(Motion.Kind.NEW_TOP, last = NOW - 90_000L, swipe = true)).action)
    }

    /** Заморозка порядка: исчезнувший слот пропускается, новые карточки встают в конец, слот занят один раз. */
    @Test fun reorderBySlots_removedAndNew() {
        val out = Motion.reorderBySlots(listOf("a", "gone", "b"), listOf("n1", "b", "a", "n2"), { it })
        assertEquals(listOf("a", "b", "n1", "n2"), out)
        assertEquals(listOf("x", "y"), Motion.reorderBySlots(emptyList(), listOf("x", "y"), { it }))
        assertEquals(listOf("a", "b"), Motion.reorderBySlots(listOf("a", "a", "b"), listOf("a", "b"), { it }))
    }
}
