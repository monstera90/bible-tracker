package com.app.lifetracker
// Версия: 1.0 (22.11) — тесты выбора занятия для системного острова Xiaomi (ТЗ TZ_downloads.md, этап 3). Запуск: ./gradlew testDebugUnitTest

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class SystemIslandLogicTest {

    private fun task(id: Long, state: DlState, done: Long = 0L, total: Long = 100L, range: Boolean = true): DownloadTask {
        val t = DownloadTask(id, "https://example.com/f$id", emptyMap())
        t.fileName = "file$id.bin"
        t.state = state
        t.totalBytes = total
        t.done.set(done)
        t.supportsRange = range
        return t
    }

    @Test fun noTasksNoIsland() {
        assertNull(SystemIslandLogic.info(emptyList()))
        assertNull(SystemIslandLogic.info(listOf(task(1, DlState.CANCELED))))
    }

    @Test fun earliestActiveWins() {
        val a = task(5, DlState.RUNNING, 10)
        val b = task(2, DlState.QUEUED)
        val c = task(9, DlState.RUNNING, 50)
        assertEquals(2L, SystemIslandLogic.pick(listOf(a, b, c))!!.id)
    }

    @Test fun failedAndDoneDoNotHideActive() {
        val failed = task(1, DlState.FAILED)
        val done = task(2, DlState.DONE, 100)
        val run = task(3, DlState.RUNNING, 30)
        assertEquals(3L, SystemIslandLogic.pick(listOf(failed, done, run))!!.id)
        // без идущих: «Готово» выше ошибки
        assertEquals(2L, SystemIslandLogic.pick(listOf(failed, done))!!.id)
    }

    @Test fun moreCountsAllOthers() {
        val i = SystemIslandLogic.info(listOf(task(1, DlState.RUNNING, 45), task(2, DlState.QUEUED), task(3, DlState.PAUSED)))!!
        assertTrue(i.sub, i.sub.endsWith(" · +2"))
        val single = SystemIslandLogic.info(listOf(task(1, DlState.RUNNING, 45)))!!
        assertTrue(single.sub, !single.sub.contains("+"))
    }

    @Test fun canceledNotCounted() {
        val i = SystemIslandLogic.info(listOf(task(1, DlState.RUNNING, 45), task(2, DlState.CANCELED)))!!
        assertTrue(i.sub, !i.sub.contains("+"))
    }

    @Test fun percentAndFraction() {
        val i = SystemIslandLogic.info(listOf(task(1, DlState.RUNNING, 45)))!!
        assertEquals("45 %", i.time)
        assertEquals(0.45f, i.fraction, 0.001f)
        assertEquals(SystemIslandLogic.KIND_ACTIVE, i.kind)
        assertEquals("file1.bin", i.name)
    }

    @Test fun unknownSizeShowsBytesAndEmptyRing() {
        val i = SystemIslandLogic.info(listOf(task(1, DlState.RUNNING, 12L * 1024 * 1024, -1L)))!!
        assertEquals("12 МБ", i.time)
        assertEquals(0f, i.fraction, 0f)
    }

    @Test fun titleReplacesFileName() {
        val t = task(1, DlState.RUNNING, 10)
        t.title = "Обновление приложения"
        assertEquals("Обновление приложения", SystemIslandLogic.info(listOf(t))!!.name)
    }

    @Test fun toggleButtonByState() {
        assertEquals(SystemIslandLogic.TOGGLE_PAUSE, SystemIslandLogic.info(listOf(task(1, DlState.RUNNING, 5)))!!.toggle)
        assertEquals(SystemIslandLogic.TOGGLE_RESUME, SystemIslandLogic.info(listOf(task(1, DlState.PAUSED, 5)))!!.toggle)
        assertEquals(SystemIslandLogic.TOGGLE_RETRY, SystemIslandLogic.info(listOf(task(1, DlState.FAILED, 5)))!!.toggle)
        assertEquals(SystemIslandLogic.TOGGLE_NONE, SystemIslandLogic.info(listOf(task(1, DlState.DONE, 100)))!!.toggle)
    }

    @Test fun noPauseWithoutRange() {
        val i = SystemIslandLogic.info(listOf(task(1, DlState.RUNNING, 5, 100, range = false)))!!
        assertEquals(SystemIslandLogic.TOGGLE_NONE, i.toggle)
    }

    @Test fun subTextStatesMatchCard() {
        assertEquals("в очереди", SystemIslandLogic.subText(task(1, DlState.QUEUED)))
        assertEquals("Нет сети · ждём", SystemIslandLogic.subText(task(1, DlState.WAITING_NET)))
        val f = task(1, DlState.FAILED)
        assertEquals("Ошибка скачивания", SystemIslandLogic.subText(f))
        f.error = "Ошибка: HTTP 403"
        assertEquals("Ошибка: HTTP 403", SystemIslandLogic.subText(f))
        val p = task(1, DlState.PAUSED, 50)
        assertTrue(SystemIslandLogic.subText(p).endsWith("пауза"))
    }

    @Test fun runningShowsSpeedAndThreads() {
        val t = task(1, DlState.RUNNING, 12L * 1024 * 1024, 80L * 1024 * 1024)
        t.speed = 3L * 1024 * 1024
        t.mode = DlMode.MULTI
        t.activeThreads = 4
        val s = SystemIslandLogic.subText(t)
        assertTrue(s, s.startsWith("12 из 80 МБ"))
        assertTrue(s, s.contains("МБ/с"))
        assertTrue(s, s.endsWith("4 потока"))
    }

    @Test fun doneShowsDestination() {
        val t = task(1, DlState.DONE, 100)
        t.targetLabel = "Загрузки"
        val i = SystemIslandLogic.info(listOf(t))!!
        assertEquals("Готово", i.time)
        assertEquals("→ Загрузки", i.sub)
        assertEquals(1f, i.fraction, 0f)
        t.targetNote = "Папка недоступна — сохранено в «Загрузки»"
        assertEquals("Папка недоступна — сохранено в «Загрузки»", SystemIslandLogic.info(listOf(t))!!.sub)
    }

    @Test fun signatureChangesWithProgressButNotWithoutIt() {
        val t = task(1, DlState.RUNNING, 45)
        val a = SystemIslandLogic.info(listOf(t))!!.signature()
        assertEquals(a, SystemIslandLogic.info(listOf(t))!!.signature())
        t.done.set(46)
        assertNotEquals(a, SystemIslandLogic.info(listOf(t))!!.signature())
    }
}
