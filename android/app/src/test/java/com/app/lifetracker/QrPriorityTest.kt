package com.app.lifetracker
// Версия: 1.0 (14.11)

import com.app.lifetracker.QrWidgets.Card
import com.app.lifetracker.QrWidgets.Cfg
import com.app.lifetracker.QrWidgets.Live
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.Calendar

/** Сценарии из ТЗ TZ_card_priority.md, п. 7 (этап 1). Каждый сценарий дополнительно проходит [QrPriority.check]. */
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
        days: Set<Int> = emptySet(), dyn: String = "", at: Long = 0L, habit: Boolean = false, tid: String = ""
    ) = Card(key = key, code = "", title = key, live = live, times = times, days = days, after = after, dyn = dyn, at = at, habit = habit, tid = tid)

    private fun cfg(cards: List<Card>, relevance: Boolean = false, rpeAsk: Boolean = false) =
        Cfg(id = "w", name = "w", rotate = false, rotateMin = 5, relevance = relevance, cards = cards, rpeAsk = rpeAsk)

    private fun snap(c: Calendar, workout: Boolean = false, pomodoro: Boolean = false, stopwatch: Boolean = false,
                     timers: Set<String> = emptySet(), hidden: Set<String> = emptySet(), moved: Map<String, Long> = emptyMap(),
                     done: Set<String> = emptySet(), rpe: Boolean = false) =
        QrPriority.Snapshot(now = c.timeInMillis, cal = c, workoutActive = workout, pomodoroActive = pomodoro, stopwatchActive = stopwatch,
            activeTimerIds = timers, hiddenKeys = hidden, movedAt = moved, doneTaskIds = done, rpePending = rpe)

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
        assertEquals(listOf("q", "e", "t"), keys(r))
        assertEquals("", r.topKey)
        assertEquals("", r.anchorKey) // первая карточка — не событие: «своего места» нет
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
}
