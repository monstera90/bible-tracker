package com.app.lifetracker
// Версия: 2.4 (28.11) — автопродление: у запуска, остановленного токенами («Задача не выполнена») или инструментами («Далее»), есть флажок [Run.autoRenew] (по умолчанию включён, снимается кнопкой-петлёй на карточке острова). Для токенов запоминается время и дата, когда лимит снимется ([Run.resumeAt] = время из плашки страницы + минута, нет времени — 5 часов + минута); [autoRenewStep] в это время просит вкладку перезагрузить страницу (плашка могла остаться), а когда плашки лимита нет — отправить «Дальше». Выключенное автопродление отключает и автонажатие «Далее». Плашка «Бесплатные сообщения недоступны до …» больше не принимается за «ждёт Далее»: [pageState] переводит запуск из «Далее» в «токены», если страница показывает токены. Откат: AgentRuns.kt 2.3.
// Версия: 2.3 (28.11) — «Далее» нажимается само: если инструменты кончились, а fix.zip у запуска ещё не пришёл (запуск на шаге «Claude думает», не «Обычная задача»), [autoNextDue] через AUTO_NEXT_DELAY_MS говорит вкладке отправить «Далее». Если fix.zip уже пришёл (шаг 3–4 или закончено), а Claude всё равно просит «Далее» — не нажимается: архив получен и закоммичен, задача выполнена. Откат: AgentRuns.kt 2.2.
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
    const val AUTO_NEXT_DELAY_MS = 20_000L // «Далее» само нажимается не сразу: за это время успевает прийти fix.zip (автоскачивание → beginFix) — тогда нажимать уже не нужно
    const val AUTO_NEXT_RETRY_MS = 30_000L // не вышло нажать (например, в поле ввода чужой текст) — пробуем снова не чаще, чем раз в столько
    const val AUTO_NEXT_MAX = 20 // защита от бесконечной переписки: больше стольких автонажатий на один запуск — дальше только руками (круг в острове)
    const val RENEW_AFTER_MS = 60_000L // запас после времени, когда лимит должен сняться
    const val RENEW_FALLBACK_MS = 5L * 3_600_000L // время снятия не прочитано из страницы — ждём столько (окно лимита)
    const val RENEW_MAX_AHEAD_MS = 30L * 3_600_000L // время снятия дальше этого — считаем нераспознанным
    const val RENEW_SETTLE_MS = 20_000L // после перезагрузки страницы столько ждём, пока она покажет, снят ли лимит
    const val RENEW_RELOAD_RETRY_MS = 5L * 60_000L // лимит ещё на странице — перезагружаем не чаще, чем раз в столько
    const val RENEW_SEND_RETRY_MS = 60_000L // «Дальше» не ушло — повтор не чаще, чем раз в столько
    const val RENEW_MAX = 6 // попыток автопродления на одну остановку; потом — только руками
    const val RENEW_NONE = 0
    const val RENEW_RELOAD = 1 // перезагрузить страницу чата
    const val RENEW_SEND = 2 // отправить «Дальше»
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
        @Volatile var autoNexts = 0 // сколько раз приложение само пыталось нажать «Далее» в этом запуске
        @Volatile var autoNextAt = 0L // когда была последняя такая попытка
        @Volatile var autoRenew = true // автопродление (кнопка-петля на карточке): по умолчанию включено у любого невыполненного запуска
        @Volatile var resumeAt = 0L // токены кончились: когда можно запускать снова (мс, с датой); 0 — не ждём
        @Volatile var renewTries = 0 // попыток автопродления на текущую остановку
        @Volatile var renewAt = 0L // когда была последняя попытка
        @Volatile var renewKind = RENEW_NONE // какой была последняя попытка
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
    fun pageState(tabId: String, kind: String, gen: Boolean, now: Long = System.currentTimeMillis(), resetAt: Long = 0L) {
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
        // «токены» важнее «Далее»: запуск, который по ошибке встал на «Далее», а страница показывает лимит, переходит на «не выполнена»
        val r = list.firstOrNull { it.tabId == tabId && ((it.state == ST_RUN && it.step == STEP_THINK) || (kind == "tokens" && it.state == ST_NEXT)) } ?: return
        if (r.state == ST_RUN && r.resumedAt != 0L && now - r.resumedAt < RESUME_GRACE_MS) return
        r.state = if (kind == "tokens") ST_NO_TOKENS else ST_NEXT
        r.resumeAt = if (kind == "tokens") resumeTime(resetAt, now) else 0L
        r.renewTries = 0
        r.renewAt = 0L
        r.renewKind = RENEW_NONE
        r.text = ""
        r.finishedAt = now
        r.changedAt = now
        mark(r, if (kind == "tokens") M_TOKENS else M_NEXT, now)
    }

    /** Когда запускать после токенов: время снятия лимита со страницы + минута; не прочитано (или нелепое) — 5 часов + минута. */
    private fun resumeTime(resetAt: Long, now: Long): Long =
        if (resetAt > now && resetAt - now <= RENEW_MAX_AHEAD_MS) resetAt + RENEW_AFTER_MS else now + RENEW_FALLBACK_MS + RENEW_AFTER_MS

    /**
     * Нажали «Далее» (круг с треугольником): самый давний запуск вкладки, ждущий «Далее», снова идёт. [fromTokens] — «Дальше» ушло само
     * после снятия лимита ([autoRenewStep]): так же продолжается запуск, остановленный токенами.
     */
    fun resumeTab(tabId: String, now: Long = System.currentTimeMillis(), fromTokens: Boolean = false) {
        list.firstOrNull { it.tabId == tabId && (it.state == ST_NEXT || (fromTokens && it.state == ST_NO_TOKENS)) }?.let { resume(it, now) }
    }

    /** Кнопка-петля на карточке: включить / выключить автопродление у запуска [id]. */
    fun setAutoRenew(id: Long, on: Boolean) {
        list.firstOrNull { it.id == id }?.autoRenew = on
    }

    /**
     * Автопродление запуска, остановленного токенами: что делать вкладке [tabId] сейчас. [pageKind] / [inChat] — что видно на странице.
     * [RENEW_NONE] — ничего (автопродление выключено, время ещё не пришло, ждём страницу, попытки кончились); [RENEW_RELOAD] — лимит ещё
     * нарисован на странице (старая плашка или время ошибочное) — перезагрузить её; [RENEW_SEND] — плашки лимита нет, чат открыт — отправить «Дальше».
     * Зовётся при каждом опросе страницы; возвращает действие один раз на попытку.
     */
    fun autoRenewStep(tabId: String, pageKind: String, inChat: Boolean, now: Long = System.currentTimeMillis()): Int {
        val r = list.firstOrNull { it.tabId == tabId && it.state == ST_NO_TOKENS && it.autoRenew && it.resumeAt > 0L } ?: return RENEW_NONE
        if (now < r.resumeAt || r.renewTries >= RENEW_MAX) return RENEW_NONE
        if (r.renewAt != 0L) {
            val gap = if (r.renewKind == RENEW_SEND) RENEW_SEND_RETRY_MS else RENEW_SETTLE_MS
            if (now - r.renewAt < gap) return RENEW_NONE
        }
        if (pageKind == "tokens") {
            if (r.renewAt != 0L && now - r.renewAt < RENEW_RELOAD_RETRY_MS) return RENEW_NONE
            r.renewAt = now
            r.renewKind = RENEW_RELOAD
            r.renewTries++
            return RENEW_RELOAD
        }
        if (!inChat) return RENEW_NONE // страница не в чате — «Дальше» ушло бы в чужой (новый) диалог
        r.renewAt = now
        r.renewKind = RENEW_SEND
        r.renewTries++
        return RENEW_SEND
    }

    /**
     * Пора ли приложению самому нажать «Далее» в чате вкладки [tabId] ([ClaudeTab.continueTask]). Да — только если у запуска кончились инструменты
     * ([ST_NEXT]) и fix.zip ещё не пришёл: запуск остаётся на шаге «Claude думает», потому что пришедший fix.zip ([beginFix]) переводит его
     * на шаг 3 и [pageState] такой запуск уже не останавливает. Поэтому если fix.zip отдан, а Claude всё равно просит «Далее», сюда дело не доходит:
     * архив получен и закоммичен, задача выполнена. «Обычная задача» ([Run.plain]) без fix.zip — тоже не наш случай, её двигает человек.
     * Зовётся при каждом опросе страницы; возвращает true один раз на попытку.
     */
    fun autoNextDue(tabId: String, now: Long = System.currentTimeMillis()): Boolean {
        val r = list.firstOrNull { it.tabId == tabId && it.state == ST_NEXT && !it.plain && it.autoRenew } ?: return false
        if (now - r.finishedAt < AUTO_NEXT_DELAY_MS) return false
        if (r.autoNexts >= AUTO_NEXT_MAX) return false
        if (r.autoNextAt != 0L && now - r.autoNextAt < AUTO_NEXT_RETRY_MS) return false
        r.autoNexts++
        r.autoNextAt = now
        return true
    }

    private fun resume(r: Run, now: Long) {
        if (r.state != ST_NO_TOKENS && r.state != ST_NEXT) return
        r.state = ST_RUN
        r.step = STEP_THINK
        r.frac = -1f
        r.finishedAt = 0L
        r.resumedAt = now
        r.changedAt = now
        r.resumeAt = 0L
        r.renewTries = 0
        r.renewAt = 0L
        r.renewKind = RENEW_NONE
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
                ST_NO_TOKENS -> now - maxOf(it.finishedAt, it.resumeAt) < STOP_HOLD_MS // ждущий времени запуска висит и после него
                ST_NEXT -> now - it.finishedAt < STOP_HOLD_MS
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
    fun detail(r: Run, agentNumber: Int, now: Long = System.currentTimeMillis()): String {
        val head = "Агент $agentNumber"
        return when (r.state) {
            ST_RUN -> if (r.plain) head + " · обычная задача" else {
                val p = percent(r)
                head + " · шаг " + r.step + " из 4" + (if (p >= 0) " · $p %" else "")
            }
            ST_ERROR -> head + " · " + r.text.ifEmpty { "сбой" }
            ST_NOTHING -> head + " · файлы не изменились"
            ST_NO_TOKENS -> head + " · токены закончились" + renewTail(r, now)
            ST_NEXT -> head + (if (r.plain || !r.autoRenew) " · инструменты закончились, нажмите на круг" else " · инструменты закончились, нажму «Далее» сам")
            else -> if (r.plain) head + " · задача выполнена" else head + (if (r.text.isNotEmpty()) " · " + r.text else "")
        }
    }

    /** Хвост строки «токены закончились»: когда продолжу сам («продолжу в 22:01», «продолжу 29.11 в 03:01») или почему не продолжу. */
    private fun renewTail(r: Run, now: Long): String = when {
        !r.autoRenew -> " · автопродление выключено"
        r.renewTries >= RENEW_MAX -> " · автопродление не сработало"
        r.resumeAt > 0L -> " · продолжу " + whenText(r.resumeAt, now)
        else -> ""
    }

    /** «в 22:01» — если это сегодня, иначе «29.11 в 03:01» (по часовому поясу телефона). */
    fun whenText(at: Long, now: Long): String {
        val a = java.util.Calendar.getInstance().apply { timeInMillis = at }
        val b = java.util.Calendar.getInstance().apply { timeInMillis = now }
        val sameDay = a.get(java.util.Calendar.YEAR) == b.get(java.util.Calendar.YEAR) && a.get(java.util.Calendar.DAY_OF_YEAR) == b.get(java.util.Calendar.DAY_OF_YEAR)
        return if (sameDay) "в " + clockOf(at) else SimpleDateFormat("dd.MM", Locale.US).format(java.util.Date(at)) + " в " + clockOf(at)
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
