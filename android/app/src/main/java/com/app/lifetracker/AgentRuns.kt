package com.app.lifetracker
// Версия: 1.0 (25.11) — ТЗ «прогресс агента в плавающем острове» (TASK_AGENT_ISLAND.md): состояние запусков агента Claude по четырём шагам (репозиторий → Claude думает → fix.zip → коммит) для плашки InAppIsland.

import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.atomic.AtomicLong
import kotlin.math.roundToInt

/**
 * Запуски агента Claude, которые показывает плавающий остров ([InAppIsland]). Без Android, чтобы логика проверялась JVM-тестами.
 *
 * Шаги: 1 — скачивание репозитория и передача его в чат; 2 — Claude думает; 3 — скачивание `fix.zip`; 4 — коммит архива.
 * Запуск рождается в [start] (сундучок у задачи), а если `fix.zip` пришёл сам (задачу отправляли руками во вкладке Claude) —
 * в [beginFix] сразу с шага 3. «Номер агента» — номер вкладки Claude в её ряду (считает [ClaudeTabs.numberOf]).
 * Состояния пишут разные потоки, остров читает раз в 0,5 с, поэтому изменяемые поля `@Volatile`.
 */
object AgentRuns {
    const val STEP_REPO = 1
    const val STEP_THINK = 2
    const val STEP_DOWNLOAD = 3
    const val STEP_COMMIT = 4

    const val ST_RUN = 0
    const val ST_DONE = 1
    const val ST_NOTHING = 2 // коммитить было нечего
    const val ST_ERROR = 3

    const val DONE_HOLD_MS = 8_000L // «готово» висит в острове столько, потом исчезает
    const val ERROR_HOLD_MS = 10L * 60_000L // ошибка висит, пока её не закроют, но не дольше
    const val STALE_MS = 45L * 60_000L // идёт без движения дольше — считаем, что ответа не будет
    private const val MAX_KEPT = 20

    class Run(val id: Long, val tabId: String, val reqId: String, val startedAt: Long) {
        @Volatile var step = STEP_REPO
        @Volatile var frac = -1f // доля шага 0..1; -1 — неизвестна (кольцо-загрузка)
        @Volatile var state = ST_RUN
        @Volatile var text = "" // итог: «5 файлов, a1b2c3d» или причина ошибки
        @Volatile var changedAt = startedAt
        @Volatile var finishedAt = 0L
        @Volatile var hidden = false
    }

    private val list = CopyOnWriteArrayList<Run>()
    private val seq = AtomicLong(0L)

    /** Задача ушла в работу: шаг 1. */
    fun start(tabId: String, reqId: String, now: Long = System.currentTimeMillis()): Run {
        val r = Run(seq.incrementAndGet(), tabId, reqId, now)
        list.add(r)
        while (list.size > MAX_KEPT) list.removeAt(0)
        return r
    }

    private fun byReq(reqId: String): Run? =
        if (reqId.isEmpty()) null else list.lastOrNull { it.reqId == reqId && it.state == ST_RUN }

    /** Итог отправки задачи в чат ([ClaudeTaskResults.add]): успех — Claude думает (шаг 2), сбой — ошибка на текущем шаге. */
    fun taskResult(reqId: String, ok: Boolean, msg: String, now: Long = System.currentTimeMillis()) {
        val r = byReq(reqId) ?: return
        if (ok) setStep(r, STEP_THINK, -1f, now) else fail(r, msg.ifEmpty { "не удалось отправить задачу" }, now)
    }

    /**
     * Пришёл `fix.zip` из вкладки [tabId]: берём самый давний запуск этой вкладки, который ждёт ответа (шаг 2); нет такого
     * (например, задачу отправили руками) — заводим запуск без задачи. Дальше он на шаге 3.
     */
    fun beginFix(tabId: String, now: Long = System.currentTimeMillis()): Run {
        val r = list.firstOrNull { it.tabId == tabId && it.state == ST_RUN && it.step == STEP_THINK }
            ?: start(tabId, "", now)
        setStep(r, STEP_DOWNLOAD, -1f, now)
        return r
    }

    fun setStep(r: Run, step: Int, frac: Float, now: Long = System.currentTimeMillis()) {
        if (r.state != ST_RUN) return
        r.step = step.coerceIn(STEP_REPO, STEP_COMMIT)
        r.frac = normFrac(frac)
        r.changedAt = now
    }

    /** Доля текущего шага; не движется назад и не выходит за 0..1. */
    fun progress(r: Run, frac: Float, now: Long = System.currentTimeMillis()) {
        if (r.state != ST_RUN) return
        val f = normFrac(frac)
        if (f >= 0f && f < r.frac) return
        r.frac = f
        r.changedAt = now
    }

    private fun normFrac(f: Float): Float = if (f.isNaN() || f < 0f) -1f else if (f > 1f) 1f else f

    fun done(r: Run, text: String, now: Long = System.currentTimeMillis()) = finish(r, ST_DONE, text, now)

    fun nothing(r: Run, now: Long = System.currentTimeMillis()) = finish(r, ST_NOTHING, "Нечего коммитить", now)

    fun fail(r: Run, text: String, now: Long = System.currentTimeMillis()) = finish(r, ST_ERROR, text, now)

    private fun finish(r: Run, state: Int, text: String, now: Long) {
        if (r.state != ST_RUN) return
        r.state = state
        r.text = text
        r.frac = if (state == ST_ERROR) r.frac else 1f
        if (state != ST_ERROR) r.step = STEP_COMMIT
        r.finishedAt = now
        r.changedAt = now
    }

    /** Крестик на карточке / долгое нажатие на капсулу: плашка убирается, работа не прерывается. */
    fun dismiss(id: Long) {
        list.firstOrNull { it.id == id }?.hidden = true
    }

    /** Запуски для острова, самый давний первым. Заодно зависшие (ответа нет слишком долго) переводятся в ошибку. */
    fun visible(now: Long = System.currentTimeMillis()): List<Run> {
        for (r in list) if (r.state == ST_RUN && now - r.changedAt > STALE_MS) fail(r, "ответ не пришёл", now)
        return list.filter {
            !it.hidden && when (it.state) {
                ST_RUN -> true
                ST_ERROR -> now - it.finishedAt < ERROR_HOLD_MS
                else -> now - it.finishedAt < DONE_HOLD_MS
            }
        }
    }

    /** Для тестов. */
    fun clear() {
        list.clear()
    }

    // ---------- тексты плашки ----------

    fun percent(r: Run): Int = if (r.frac < 0f) -1 else (r.frac * 100f).roundToInt()

    /** Крупная строка карточки: что происходит сейчас. */
    fun title(r: Run): String = when (r.state) {
        ST_DONE -> "Закоммичено"
        ST_NOTHING -> "Нечего коммитить"
        ST_ERROR -> "Ошибка · " + stepName(r.step)
        else -> stepName(r.step)
    }

    private fun stepName(step: Int): String = when (step) {
        STEP_REPO -> "Репозиторий"
        STEP_THINK -> "Claude думает"
        STEP_DOWNLOAD -> "fix.zip"
        else -> "Коммит"
    }

    /** Вторая строка карточки: агент, шаг и подробность («Агент 2 · шаг 3 из 4 · 62 %»). */
    fun detail(r: Run, agentNumber: Int): String {
        val head = "Агент $agentNumber"
        return when (r.state) {
            ST_RUN -> {
                val p = percent(r)
                head + " · шаг " + r.step + " из 4" + (if (p >= 0) " · $p %" else "")
            }
            ST_ERROR -> head + " · " + r.text.ifEmpty { "сбой" }
            ST_NOTHING -> head + " · файлы не изменились"
            else -> head + (if (r.text.isNotEmpty()) " · " + r.text else "")
        }
    }
}
