package com.app.lifetracker
// Версия: 1.0 (22.11) — тесты состояния запроса страницы (ТЗ TZ_downloads.md, этап 2, Flibusta). Запуск: ./gradlew testDebugUnitTest

import org.junit.Assert.assertEquals
import org.junit.Test

class PageHandoffTest {

    @Test fun beforeChoiceIsAsking() {
        assertEquals(HandoffLogic.ASKING, HandoffLogic.state(HandoffLogic.ASKING, false, null))
    }

    @Test fun taskStatesMapToRunning() {
        for (st in listOf(DlState.QUEUED, DlState.RUNNING, DlState.PAUSED, DlState.WAITING_NET)) {
            assertEquals(HandoffLogic.RUNNING, HandoffLogic.state(HandoffLogic.ASKING, true, st))
        }
        // служба закончила задачу, но запрос ещё не помечен готовым — страница не должна принять это за конец
        assertEquals(HandoffLogic.RUNNING, HandoffLogic.state(HandoffLogic.ASKING, true, DlState.DONE))
    }

    @Test fun failedAndCanceledTasks() {
        assertEquals(HandoffLogic.FAILED, HandoffLogic.state(HandoffLogic.ASKING, true, DlState.FAILED))
        assertEquals(HandoffLogic.CANCELED, HandoffLogic.state(HandoffLogic.ASKING, true, DlState.CANCELED))
        // задачу убрали из списка (отмена в острове)
        assertEquals(HandoffLogic.CANCELED, HandoffLogic.state(HandoffLogic.ASKING, true, null))
    }

    @Test fun requestStateWins() {
        assertEquals(HandoffLogic.DONE, HandoffLogic.state(HandoffLogic.DONE, true, null)) // «Готово» уже исчезло из острова, файл ждёт страницу
        assertEquals(HandoffLogic.DONE, HandoffLogic.state(HandoffLogic.DONE, true, DlState.DONE))
        assertEquals(HandoffLogic.CANCELED, HandoffLogic.state(HandoffLogic.CANCELED, false, null)) // «Отмена» в окне выбора способа
        assertEquals(HandoffLogic.CANCELED, HandoffLogic.state(HandoffLogic.CANCELED, true, DlState.RUNNING))
    }

    @Test fun phases() {
        assertEquals("queued", HandoffLogic.phase(DlState.QUEUED))
        assertEquals("running", HandoffLogic.phase(DlState.RUNNING))
        assertEquals("paused", HandoffLogic.phase(DlState.PAUSED))
        assertEquals("waiting", HandoffLogic.phase(DlState.WAITING_NET))
        assertEquals("", HandoffLogic.phase(null))
        assertEquals("", HandoffLogic.phase(DlState.FAILED))
    }
}
