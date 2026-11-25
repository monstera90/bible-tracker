package com.app.lifetracker
// Версия: 1.0 (25.11) — проверка шагов плашки агента Claude в острове (AgentRuns): порядок шагов, доли, итоги, исчезновение.

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

class AgentRunsTest {

    @Before fun reset() {
        AgentRuns.clear()
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
}
