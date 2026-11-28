package com.app.lifetracker
// Версия: 2.2 (28.11) — история агентов: у запуска список отметок (начал, токены/инструменты кончились, продолжил, закончил, ошибка), по каждой зовётся onMark, а historyText собирает фразу для журнала событий («Агент 2 начал работать над задачей в 09:24 и закончил в 09:30»). Откат: AgentRuns.kt 2.1.
// Версия: 2.1 (28.11) — «Обычная задача» (plain): плашка с одним шагом «Claude думает» и галочкой, когда Claude закончил ответ (без шагов репозитория, fix.zip и коммита). Откат: AgentRuns.kt 2.0.
// Версия: 2.0 (28.11)
// Версия: 1.0 (25.11) — ТЗ «прогресс агента в плавающем острове» (TASK_AGENT_ISLAND.md): состояние запусков агента Claude по четырём шагам (репозиторий → Claude думает → fix.zip → коммит) для плашки InAppIsland.

import java.text.SimpleDateFormat
import java.util.Locale
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
    const val ST_NO_TOKENS = 4 // у Claude кончились токены: задача не выполнена (крестик)
    const val ST_NEXT = 5 // у Claude кончились инструменты, нужно нажать «Далее» (треугольник в круге)

    const val DONE_HOLD_MS = 8_000L // «готово» висит в острове столько, потом исчезает
    const val ERROR_HOLD_MS = 10L * 60_000L // ошибка висит, пока её не закроют, но не дольше
    const val STALE_MS = 45L * 60_000L // идёт без движения дольше — считаем, что ответа не будет
    const val STOP_HOLD_MS = 6L * 3_600_000L // плашка, которая ждёт человека (токены / «Далее»), висит, пока её не закроют, но не дольше
    const val RESUME_GRACE_MS = 12_000L // после «Далее» страница ещё несколько секунд показывает прежнее состояние — ему не верим
    const val PLAIN_IDLE_MS = 8_000L // обычная задача: ответ не идёт столько подряд — Claude закончил, плашка получает галочку
    private const val MAX_KEPT = 20

    // отметки в жизни запуска — из них собирается запись в журнале событий приложения
    const val M_START = 0 // начал работать
    const val M_TOKENS = 1 // кончились токены
    const val M_NEXT = 2 // кончились инструменты, нужно «Далее»
    const val M_RESUME = 3 // после остановки продолжил работу
    const val M_DONE = 4 // закончил
    const val M_NOTHING = 5 // закончил, коммитить было нечего
    const val M_ERROR = 6 // ошибка

    class Mark(val kind: Int, val at: Long)

    /** Зовётся при каждой новой отметке запуска (из любого потока); ставит [AgentHistory]. */
    @Volatile var onMark: ((Run) -> Unit)? = null

    class Run(val id: Long, val tabId: String, val reqId: String, val startedAt: Long, val plain: Boolean = false) {
        @Volatile var step = STEP_REPO
        @Volatile var frac = -1f // доля шага 0..1; -1 — неизвестна (кольцо-загрузка)
        @Volatile var state = ST_RUN
        @Volatile var text = "" // итог: «5 файлов, a1b2c3d» или причина ошибки
        @Volatile var changedAt = startedAt
        @Volatile var finishedAt = 0L
        @Volatile var hidden = false
        @Volatile var resumedAt = 0L // когда после остановки работа пошла дальше
        @Volatile var sent = false // обычная задача: сообщение ушло в чат (итог отправки пришёл)
        @Volatile var sawGen = false // обычная задача: после отправки видели, как Claude пишет ответ
        @Volatile var idleSince = 0L // обычная задача: с какого момента ответ не идёт (0 — идёт или не начинался)
        val marks = CopyOnWriteArrayList<Mark>() // отметки для истории
    }

    private val list = CopyOnWriteArrayList<Run>()
    private val seq = AtomicLong(0L)

    /** Задача ушла в работу: шаг 1. */
    fun start(tabId: String, reqId: String, now: Long = System.currentTimeMillis(), plain: Boolean = false): Run {
        val r = Run(seq.incrementAndGet(), tabId, reqId, now, plain)
        if (plain) r.step = STEP_THINK // у обычной задачи один шаг — «Claude думает»
        list.add(r)
        while (list.size > MAX_KEPT) list.removeAt(0)
        mark(r, M_START, now)
        return r
    }

    private fun mark(r: Run, kind: Int, now: Long) {
        r.marks.add(Mark(kind, now))
        try { onMark?.invoke(r) } catch (e: Exception) { }
    }

    private fun byReq(reqId: String): Run? =
        if (reqId.isEmpty()) null else list.lastOrNull { it.reqId == reqId && it.state == ST_RUN }

    /** Итог отправки задачи в чат ([ClaudeTaskResults.add]): успех — Claude думает (шаг 2), сбой — ошибка на текущем шаге. */
    fun taskResult(reqId: String, ok: Boolean, msg: String, now: Long = System.currentTimeMillis()) {
        val r = byReq(reqId) ?: return
        if (ok) {
            r.sent = true
            r.sawGen = false
            r.idleSince = 0L
            setStep(r, STEP_THINK, -1f, now)
        } else fail(r, msg.ifEmpty { "не удалось отправить задачу" }, now)
    }

    /**
     * Пришёл `fix.zip` из вкладки [tabId]: берём самый давний запуск этой вкладки, который ждёт ответа (шаг 2); нет такого
     * (например, задачу отправили руками) — заводим запуск без задачи. Дальше он на шаге 3.
     */
    fun beginFix(tabId: String, now: Long = System.currentTimeMillis()): Run {
        val r = list.firstOrNull {
            !it.plain && it.tabId == tabId && ((it.state == ST_RUN && it.step == STEP_THINK) || it.state == ST_NO_TOKENS || it.state == ST_NEXT)
        } ?: start(tabId, "", now)
        if (r.state != ST_RUN) { // остановленный запуск довели руками или он доработал сам — снова идёт
            r.state = ST_RUN
            r.finishedAt = 0L
            mark(r, M_RESUME, now)
        }
        setStep(r, STEP_DOWNLOAD, -1f, now)
        return r
    }

    /**
     * Состояние чата вкладки [tabId] (assets/claude/agent_state.js): [kind] — "tokens" (токены кончились), "tools" (инструменты кончились,
     * ждёт «Далее») или "" (ничего); [gen] — Claude пишет ответ. Запуск, который ждал ответа (шаг 2), встаёт на «не выполнена» / «Далее»;
     * остановленный запуск, у которого ответ снова пошёл (человек нажал сам или сработала автоотправка), опять «идёт».
     */
    fun pageState(tabId: String, kind: String, gen: Boolean, now: Long = System.currentTimeMillis()) {
        if (gen) {
            list.firstOrNull { it.tabId == tabId && (it.state == ST_NO_TOKENS || it.state == ST_NEXT) }?.let { resume(it, now) }
            // обычная задача: Claude пишет ответ — запоминаем это, «простой» сбрасывается
            for (r in list) if (r.plain && r.tabId == tabId && r.state == ST_RUN && r.sent) {
                r.sawGen = true
                r.idleSince = 0L
            }
            return
        }
        if (kind != "tokens" && kind != "tools") {
            // обычная задача: ответ шёл и не идёт уже давно — задача сделана (галочка)
            for (r in list) if (r.plain && r.tabId == tabId && r.state == ST_RUN && r.sent && r.sawGen) {
                if (r.idleSince == 0L) r.idleSince = now
                else if (now - r.idleSince >= PLAIN_IDLE_MS) finish(r, ST_DONE, "", now)
            }
            return
        }
        val r = list.firstOrNull { it.tabId == tabId && it.state == ST_RUN && it.step == STEP_THINK } ?: return
        if (r.resumedAt != 0L && now - r.resumedAt < RESUME_GRACE_MS) return
        r.state = if (kind == "tokens") ST_NO_TOKENS else ST_NEXT
        r.text = ""
        r.finishedAt = now
        r.changedAt = now
        mark(r, if (kind == "tokens") M_TOKENS else M_NEXT, now)
    }

    /** Нажали «Далее» (круг с треугольником): самый давний запуск вкладки, ждущий «Далее», снова идёт. */
    fun resumeTab(tabId: String, now: Long = System.currentTimeMillis()) {
        list.firstOrNull { it.tabId == tabId && it.state == ST_NEXT }?.let { resume(it, now) }
    }

    private fun resume(r: Run, now: Long) {
        if (r.state != ST_NO_TOKENS && r.state != ST_NEXT) return
        r.state = ST_RUN
        r.step = STEP_THINK
        r.frac = -1f
        r.finishedAt = 0L
        r.resumedAt = now
        r.changedAt = now
        mark(r, M_RESUME, now)
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
        mark(r, when (state) { ST_ERROR -> M_ERROR; ST_NOTHING -> M_NOTHING; else -> M_DONE }, now)
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
                ST_NO_TOKENS, ST_NEXT -> now - it.finishedAt < STOP_HOLD_MS
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
        ST_DONE -> if (r.plain) "Готово" else "Закоммичено"
        ST_NOTHING -> "Нечего коммитить"
        ST_ERROR -> if (r.plain) "Ошибка" else "Ошибка · " + stepName(r.step)
        ST_NO_TOKENS -> "Задача не выполнена"
        ST_NEXT -> "Нужно нажать «Далее»"
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
            ST_RUN -> if (r.plain) head + " · обычная задача" else {
                val p = percent(r)
                head + " · шаг " + r.step + " из 4" + (if (p >= 0) " · $p %" else "")
            }
            ST_ERROR -> head + " · " + r.text.ifEmpty { "сбой" }
            ST_NOTHING -> head + " · файлы не изменились"
            ST_NO_TOKENS -> head + " · токены закончились"
            ST_NEXT -> head + " · инструменты закончились, нажмите на круг"
            else -> if (r.plain) head + " · задача выполнена" else head + (if (r.text.isNotEmpty()) " · " + r.text else "")
        }
    }

    // ---------- история агентов (журнал событий) ----------

    /** Время для журнала: «09:24» (по часовому поясу телефона). */
    fun clockOf(ms: Long): String = SimpleDateFormat("HH:mm", Locale.US).format(java.util.Date(ms))

    /**
     * Одна запись журнала на запуск, меняется по ходу дела: «Агент 2 начал работать над задачей в 09:24 и закончил в 09:30»,
     * «Агент 3 начал работать над задачей в 10:23 и в 10:30 у него закончились токены». Время обёрнуто в ⟦…⟧ — страница показывает его жирным.
     */
    fun historyText(r: Run, agentNumber: Int, clock: (Long) -> String = ::clockOf): String {
        val parts = ArrayList<String>()
        for (m in r.marks) {
            val t = "⟦" + clock(m.at) + "⟧"
            parts.add(when (m.kind) {
                M_START -> "начал работать над задачей в $t"
                M_TOKENS -> "в $t у него закончились токены"
                M_NEXT -> "в $t у него закончились инструменты, нужно было нажать «Далее»"
                M_RESUME -> "в $t продолжил работу"
                M_DONE -> "закончил в $t"
                M_NOTHING -> "закончил в $t (коммитить было нечего)"
                else -> "в $t произошла ошибка" + (if (r.text.isNotEmpty()) ": " + r.text else "")
            })
        }
        if (parts.isEmpty()) return ""
        val sb = StringBuilder("Агент ").append(agentNumber).append(' ').append(parts[0])
        for (i in 1 until parts.size) sb.append(if (i == parts.size - 1) " и " else ", ").append(parts[i])
        return sb.toString()
    }
}
