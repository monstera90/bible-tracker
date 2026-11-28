package com.app.lifetracker
// Версия: 1.3 (28.11) — тесты истории агентов: фразы для журнала событий (закончил, кончились токены, продолжил, ошибка) и вызов onMark. Откат: AgentRunsTest.kt 1.2.
// Версия: 1.2 (28.11) — тесты «Обычной задачи»: один шаг «Claude думает», галочка после конца ответа, fix.zip её не трогает. Откат: AgentRunsTest.kt 1.1.
// Версия: 1.1 (28.11)
// Версия: 1.0 (25.11) — проверка шагов плашки агента Claude в острове (AgentRuns): порядок шагов, доли, итоги, исчезновение.

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

class AgentRunsTest {

    @Before fun reset() {
        AgentRuns.clear()
        AgentRuns.onMark = null
    }

    @Test fun fullChain() {
        val r = AgentRuns.start("main", "req1", 0L)
        assertEquals(AgentRuns.STEP_REPO, r.step)
        AgentRuns.taskResult("req1", true, "", 10L)
        assertEquals(AgentRuns.STEP_THINK, r.step)
        assertEquals(-1f, r.frac, 0f)
        val same = AgentRuns.beginFix("main", 20L)
        assertTrue(same === r)
        assertEquals(AgentRuns.STEP_DOWNLOAD, r.step)
        AgentRuns.progress(r, 0.5f, 30L)
        assertEquals(50, AgentRuns.percent(r))
        AgentRuns.setStep(r, AgentRuns.STEP_COMMIT, 0f, 40L)
        AgentRuns.progress(r, 0.8f, 50L)
        AgentRuns.done(r, "3 файлов, abcdef0", 60L)
        assertEquals(AgentRuns.ST_DONE, r.state)
        assertEquals(AgentRuns.STEP_COMMIT, r.step)
        assertEquals("Закоммичено", AgentRuns.title(r))
    }

    @Test fun progressNeverGoesBack() {
        val r = AgentRuns.start("main", "req2", 0L)
        AgentRuns.setStep(r, AgentRuns.STEP_DOWNLOAD, 0f, 1L)
        AgentRuns.progress(r, 0.6f, 2L)
        AgentRuns.progress(r, 0.3f, 3L)
        assertEquals(60, AgentRuns.percent(r))
        AgentRuns.progress(r, 7f, 4L)
        assertEquals(100, AgentRuns.percent(r))
    }

    @Test fun fixWithoutTaskCreatesRun() {
        val r = AgentRuns.beginFix("abc", 5L)
        assertEquals("abc", r.tabId)
        assertEquals("", r.reqId)
        assertEquals(AgentRuns.STEP_DOWNLOAD, r.step)
    }

    @Test fun fixGoesToOldestWaitingRunOfSameTab() {
        val a = AgentRuns.start("main", "a", 0L)
        val b = AgentRuns.start("main", "b", 1L)
        val other = AgentRuns.start("x1", "c", 2L)
        AgentRuns.taskResult("a", true, "", 3L)
        AgentRuns.taskResult("b", true, "", 4L)
        AgentRuns.taskResult("c", true, "", 5L)
        assertTrue(AgentRuns.beginFix("main", 6L) === a)
        assertTrue(AgentRuns.beginFix("main", 7L) === b)
        assertTrue(AgentRuns.beginFix("x1", 8L) === other)
    }

    @Test fun sendFailureIsError() {
        val r = AgentRuns.start("main", "req3", 0L)
        AgentRuns.taskResult("req3", false, "нет входа", 5L)
        assertEquals(AgentRuns.ST_ERROR, r.state)
        assertEquals(AgentRuns.STEP_REPO, r.step)
        assertEquals("Ошибка · Репозиторий", AgentRuns.title(r))
        assertEquals("Агент 2 · нет входа", AgentRuns.detail(r, 2))
    }

    @Test fun finishedRunsDisappear() {
        val ok = AgentRuns.start("main", "ok", 0L)
        AgentRuns.done(ok, "1 файлов, abc", 100L)
        val bad = AgentRuns.start("main", "bad", 0L)
        AgentRuns.fail(bad, "нет сети", 100L)
        assertEquals(2, AgentRuns.visible(100L + AgentRuns.DONE_HOLD_MS - 1).size)
        val later = AgentRuns.visible(100L + AgentRuns.DONE_HOLD_MS + 1)
        assertEquals(1, later.size)
        assertEquals(AgentRuns.ST_ERROR, later[0].state)
        AgentRuns.dismiss(bad.id)
        assertTrue(AgentRuns.visible(100L + AgentRuns.DONE_HOLD_MS + 2).isEmpty())
    }

    @Test fun staleRunBecomesError() {
        val r = AgentRuns.start("main", "slow", 0L)
        AgentRuns.taskResult("slow", true, "", 1L)
        val list = AgentRuns.visible(AgentRuns.STALE_MS + 10L)
        assertEquals(1, list.size)
        assertEquals(AgentRuns.ST_ERROR, r.state)
        assertFalse(AgentRuns.visible(AgentRuns.STALE_MS + 10L).isEmpty())
    }

    @Test fun detailLine() {
        val r = AgentRuns.start("main", "d", 0L)
        AgentRuns.setStep(r, AgentRuns.STEP_DOWNLOAD, 0.62f, 1L)
        assertEquals("Агент 3 · шаг 3 из 4 · 62 %", AgentRuns.detail(r, 3))
        AgentRuns.setStep(r, AgentRuns.STEP_THINK, -1f, 2L)
        assertEquals("Агент 3 · шаг 2 из 4", AgentRuns.detail(r, 3))
    }

    private fun thinking(tab: String, req: String): AgentRuns.Run {
        val r = AgentRuns.start(tab, req, 0L)
        AgentRuns.taskResult(req, true, "", 1L)
        return r
    }

    @Test fun tokensRanOutIsCross() {
        val r = thinking("main", "t1")
        AgentRuns.pageState("main", "tokens", false, 100L)
        assertEquals(AgentRuns.ST_NO_TOKENS, r.state)
        assertEquals("Задача не выполнена", AgentRuns.title(r))
        assertEquals("Агент 1 · токены закончились", AgentRuns.detail(r, 1))
    }

    @Test fun toolsRanOutWaitsForNext() {
        val r = thinking("main", "t2")
        AgentRuns.pageState("main", "tools", false, 100L)
        assertEquals(AgentRuns.ST_NEXT, r.state)
        assertEquals("Нужно нажать «Далее»", AgentRuns.title(r))
    }

    @Test fun otherTabAndOtherStepAreIgnored() {
        val r = thinking("main", "t3")
        AgentRuns.pageState("x1", "tokens", false, 100L)
        assertEquals(AgentRuns.ST_RUN, r.state)
        AgentRuns.setStep(r, AgentRuns.STEP_DOWNLOAD, 0.2f, 101L)
        AgentRuns.pageState("main", "tools", false, 102L)
        assertEquals(AgentRuns.ST_RUN, r.state)
        AgentRuns.pageState("main", "", false, 103L)
        assertEquals(AgentRuns.ST_RUN, r.state)
    }

    @Test fun nextButtonResumesAndGraceIgnoresStalePage() {
        val r = thinking("main", "t4")
        AgentRuns.pageState("main", "tools", false, 100L)
        AgentRuns.resumeTab("main", 200L)
        assertEquals(AgentRuns.ST_RUN, r.state)
        assertEquals(AgentRuns.STEP_THINK, r.step)
        AgentRuns.pageState("main", "tools", false, 200L + AgentRuns.RESUME_GRACE_MS - 1) // страница ещё показывает прежнее
        assertEquals(AgentRuns.ST_RUN, r.state)
        AgentRuns.pageState("main", "tools", false, 200L + AgentRuns.RESUME_GRACE_MS + 1) // действительно не пошло
        assertEquals(AgentRuns.ST_NEXT, r.state)
    }

    @Test fun resumeTabDoesNotTouchNoTokens() {
        val r = thinking("main", "t5")
        AgentRuns.pageState("main", "tokens", false, 100L)
        AgentRuns.resumeTab("main", 200L)
        assertEquals(AgentRuns.ST_NO_TOKENS, r.state)
    }

    @Test fun generationStartedByHandResumesStoppedRun() {
        val a = thinking("main", "t6")
        AgentRuns.pageState("main", "tokens", false, 100L)
        AgentRuns.pageState("main", "", true, 200L)
        assertEquals(AgentRuns.ST_RUN, a.state)
        val b = thinking("x1", "t7")
        AgentRuns.pageState("x1", "tools", false, 100L)
        AgentRuns.pageState("x1", "", true, 200L)
        assertEquals(AgentRuns.ST_RUN, b.state)
    }

    @Test fun fixAfterStopRevivesSameRun() {
        val r = thinking("main", "t8")
        AgentRuns.pageState("main", "tools", false, 100L)
        val same = AgentRuns.beginFix("main", 300L)
        assertTrue(same === r)
        assertEquals(AgentRuns.ST_RUN, r.state)
        assertEquals(AgentRuns.STEP_DOWNLOAD, r.step)
        assertEquals(1, AgentRuns.visible(301L).size)
    }

    @Test fun stoppedRunsWaitLongAndCanBeDismissed() {
        val a = thinking("main", "t9")
        val b = thinking("x1", "t10")
        AgentRuns.pageState("main", "tokens", false, 1000L)
        AgentRuns.pageState("x1", "tools", false, 1000L)
        assertEquals(2, AgentRuns.visible(1000L + AgentRuns.ERROR_HOLD_MS + 5L).size)
        assertTrue(AgentRuns.visible(1000L + AgentRuns.STOP_HOLD_MS + 1L).isEmpty())
        AgentRuns.dismiss(a.id)
        assertEquals(1, AgentRuns.visible(2000L).size)
        assertEquals(AgentRuns.ST_NEXT, b.state)
    }

    @Test fun plainTaskHasOneStepAndGetsCheckmark() {
        val r = AgentRuns.start("main", "p1", 0L, plain = true)
        assertEquals(AgentRuns.STEP_THINK, r.step)
        assertEquals("Claude думает", AgentRuns.title(r))
        assertEquals("Агент 1 · обычная задача", AgentRuns.detail(r, 1))
        AgentRuns.pageState("main", "", false, 100L) // ещё не отправлено — ничего не меняется
        assertEquals(AgentRuns.ST_RUN, r.state)
        AgentRuns.taskResult("p1", true, "", 200L)
        AgentRuns.pageState("main", "", false, 300L) // ответ ещё не шёл
        AgentRuns.pageState("main", "", false, 20_000L)
        assertEquals(AgentRuns.ST_RUN, r.state)
        AgentRuns.pageState("main", "", true, 21_000L) // Claude пишет
        AgentRuns.pageState("main", "", false, 22_000L)
        assertEquals(AgentRuns.ST_RUN, r.state) // пауза между вызовами инструментов ещё не конец
        AgentRuns.pageState("main", "", true, 24_000L)
        AgentRuns.pageState("main", "", false, 25_000L)
        AgentRuns.pageState("main", "", false, 25_000L + AgentRuns.PLAIN_IDLE_MS)
        assertEquals(AgentRuns.ST_DONE, r.state)
        assertEquals("Готово", AgentRuns.title(r))
    }

    @Test fun fixZipDoesNotTouchPlainRun() {
        val p = AgentRuns.start("main", "p2", 0L, plain = true)
        AgentRuns.taskResult("p2", true, "", 1L)
        val f = AgentRuns.beginFix("main", 2L)
        assertTrue(f !== p)
        assertEquals(AgentRuns.STEP_THINK, p.step)
    }

    @Test fun plainSendFailureIsError() {
        val r = AgentRuns.start("main", "p3", 0L, plain = true)
        AgentRuns.taskResult("p3", false, "нет сети", 5L)
        assertEquals(AgentRuns.ST_ERROR, r.state)
        assertEquals("Ошибка", AgentRuns.title(r))
    }

    private val clock: (Long) -> String = { "t$it" }

    @Test fun historyDone() {
        val r = AgentRuns.start("main", "h1", 1000L)
        assertEquals("Агент 2 начал работать над задачей в ⟦t1000⟧", AgentRuns.historyText(r, 2, clock))
        AgentRuns.taskResult("h1", true, "", 1500L)
        AgentRuns.beginFix("main", 2000L)
        AgentRuns.done(r, "3 файлов, abcdef0", 6000L)
        assertEquals("Агент 2 начал работать над задачей в ⟦t1000⟧ и закончил в ⟦t6000⟧", AgentRuns.historyText(r, 2, clock))
    }

    @Test fun historyNoTokens() {
        val r = AgentRuns.start("main", "h2", 1000L)
        AgentRuns.taskResult("h2", true, "", 1500L)
        AgentRuns.pageState("main", "tokens", false, 2000L)
        assertEquals(AgentRuns.ST_NO_TOKENS, r.state)
        assertEquals("Агент 3 начал работать над задачей в ⟦t1000⟧ и в ⟦t2000⟧ у него закончились токены", AgentRuns.historyText(r, 3, clock))
    }

    @Test fun historyResumeAfterStop() {
        val r = AgentRuns.start("main", "h3", 1000L)
        AgentRuns.taskResult("h3", true, "", 1500L)
        AgentRuns.pageState("main", "tokens", false, 2000L)
        AgentRuns.pageState("main", "", true, 3000L) // ответ снова пошёл
        assertEquals(AgentRuns.ST_RUN, r.state)
        AgentRuns.beginFix("main", 4000L)
        AgentRuns.done(r, "1 файлов, abcdef0", 5000L)
        assertEquals(
            "Агент 1 начал работать над задачей в ⟦t1000⟧, в ⟦t2000⟧ у него закончились токены, в ⟦t3000⟧ продолжил работу и закончил в ⟦t5000⟧",
            AgentRuns.historyText(r, 1, clock)
        )
    }

    @Test fun historyError() {
        val r = AgentRuns.start("main", "h4", 1000L)
        AgentRuns.taskResult("h4", false, "нет сети", 1005L)
        assertEquals("Агент 1 начал работать над задачей в ⟦t1000⟧ и в ⟦t1005⟧ произошла ошибка: нет сети", AgentRuns.historyText(r, 1, clock))
    }

    @Test fun onMarkIsCalledForEveryMark() {
        var calls = 0
        AgentRuns.onMark = { calls++ }
        val r = AgentRuns.start("main", "h5", 0L)
        AgentRuns.taskResult("h5", true, "", 1L)
        AgentRuns.pageState("main", "tools", false, 2L)
        assertEquals(AgentRuns.ST_NEXT, r.state)
        assertEquals(2, calls) // начал + кончились инструменты
        AgentRuns.resumeTab("main", 3L)
        assertEquals(3, calls)
    }
}
