package com.app.lifetracker
// Версия: 3.1 (28.11) — «Далее» нажимается само: после каждого опроса состояния чата спрашиваем AgentRuns.autoNextDue и, если пора (инструменты кончились, fix.zip ещё не пришёл), зовём continueTask(quiet = true) — без сообщения об ошибке на каждую попытку. Откат: ClaudeTab.kt 3.0.
// Версия: 3.0 (28.11)
// Версия: 2.7 (28.11) — «Обычная задача»: задача уходит без архива репозитория (TaskJob.zip может быть null, TaskJob.plain), а чат, созданный такой отправкой, запоминается ([markPlainChat], SharedPreferences): fix.zip в нём не скачивается автоматически (auto_fix.js выключается для адреса чата) и автокоммитом не забирается (скачивание идёт как у любого файла). Откат: ClaudeTab.kt 2.6.
// Версия: 2.6 (27.11) — отправка задачи не дублируется: (а) у попытки свой номер (TaskJob.attempt) — скрипт отправки по нему не даёт отправить одно и то же дважды, даже после перезагрузки страницы; (б) если страница ушла в чат (/chat/…) или скрипт дошёл до «Отправить» (sentSeen), страницу заново не грузим — раньше при потере состояния скрипта через 40 с срабатывал restartJob и задача уходила в новый чат ещё раз (до трёх раз); (в) уход в чат считается успешной отправкой. Откат: ClaudeTab.kt 2.5.
// Версия: 2.5 (25.11) — к задаче из сундучка можно приложить картинки: они уходят в чат вместе с архивом (TaskJob.images, startUpload передаёт каждый файл кусками; предупреждение скрипта при успехе доходит до страницы). Откат: ClaudeTab.kt 2.4.
// Версия: 2.4 (25.11) — перехват fix.zip знает вкладку (tabId): по ней плашка агента в острове находит свой запуск. Откат: ClaudeTab.kt 2.3.
// Версия: 2.3 (24.11) — перехват fix.zip учитывает метку автоскачивания (__ltFixExpect). Откат: ClaudeTab.kt 2.2.
// Версия: 2.2 (24.11) — автоскачивание fix.zip: injectAutoFix (assets/claude/auto_fix.js), настройка и ошибки скрипта через statusPoll. Откат: ClaudeTab.kt 2.1.
// Версия: 2.1 (24.11) — скачивание fix.zip перехватывает AutoCommit (автокоммит в GitHub). Откат: ClaudeTab.kt 2.0.

import android.annotation.SuppressLint
import android.content.Context
import android.graphics.RectF
import android.os.Build
import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.util.Base64
import android.view.ViewGroup
import android.webkit.CookieManager
import android.webkit.RenderProcessGoneDetail
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.webkit.ProfileStore
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import android.widget.FrameLayout
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.io.IOException
import java.io.InputStream
import java.util.ArrayDeque
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import kotlin.math.roundToInt

/**
 * Вкладка «Claude» (set2s_10): отдельный WebView с https://claude.ai, который лежит поверх области содержимого
 * главного WebView (страница приложения присылает его прямоугольник через мост: claudeShow). В этот WebView мост
 * LifeTrackerNative НЕ добавляется — чужой сайт не получает доступа к приложению.
 * Автоотправка: после загрузки страницы вставляется assets/claude/auto_next.js; настройки лежат в SharedPreferences,
 * статус раз в несколько секунд читается из страницы и отдаётся вкладке (claudeState).
 * Скрытие — сдвиг за край (а не INVISIBLE): скрытый WebView Chromium считает невидимым и душит таймеры страницы.
 */
class ClaudeTab(private val activity: MainActivity, private val host: FrameLayout, val tabId: String = MAIN_ID) {

    companion object {
        const val HOME_URL = "https://claude.ai/"
        /** Новый чат: загрузка этого адреса всегда открывает пустой диалог. */
        const val NEW_URL = "https://claude.ai/new"
        private const val TASK_TIMEOUT_MS = 240_000L
        private const val TASK_POLL_MS = 1500L
        private const val TASK_STALL_MS = 40_000L // скрипт отправки не стартовал за это время — страницу грузим заново
        private const val TASK_KICK_MS = 10_000L // то же при заходе на вкладку
        private const val TASK_MAX_RESTARTS = 3
        /** Этап, который скрипт отправки (send_task.js) ставит сразу после нажатия «Отправить»; с него страницу заново не грузим. */
        private const val STAGE_SENT = "Отправлено, жду подтверждения"
        private const val TASK_CHUNK = 393216 // кратно 3: куски base64 декодируются по отдельности
        const val MAIN_ID = "main"
        /** Умеет ли установленный Android System WebView отдельные профили (отдельный вход на вкладку). */
        fun profilesSupported(): Boolean = try {
            WebViewFeature.isFeatureSupported(WebViewFeature.MULTI_PROFILE)
        } catch (e: Throwable) { false }
        const val DEFAULT_TEXT = "Дальше"
        private const val PREFS = "claude_tab"
        private const val KEY_ENABLED = "auto_enabled"
        private const val KEY_TEXT = "auto_text"
        private const val KEY_PLAIN_CHATS = "plain_chats"
        private const val MAX_PLAIN_CHATS = 60
        private const val OFFSCREEN_X = 20000f
        private const val STATUS_POLL_MS = 4000L
        private val ALLOWED_HOSTS = listOf("claude.ai", "anthropic.com", "claude.com")
    }

    private val profileName: String? = if (tabId == MAIN_ID) null else "claude_$tabId"
    private fun k(base: String): String = if (tabId == MAIN_ID) base else base + "_" + tabId
    private val handler = Handler(Looper.getMainLooper())
    private val prefs = activity.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    private var view: WebView? = null
    private var shown = false
    private var lastStatus = "{}"
    private var rL = 0
    private var rT = 0
    private var rW = 1
    private var rH = 1
    private var kb = 0
    private var holes: List<RectF> = emptyList() // окна под кнопки страницы, px родителя

    val isVisible: Boolean get() = shown && view != null

    fun autoEnabled(): Boolean = prefs.getBoolean(k(KEY_ENABLED), false)
    fun autoText(): String = prefs.getString(k(KEY_TEXT), DEFAULT_TEXT)?.ifBlank { DEFAULT_TEXT } ?: DEFAULT_TEXT

    /** CookieManager профиля этой вкладки (у «main» — общий, как раньше). */
    private fun cookieMgr(): CookieManager {
        val pn = profileName ?: return CookieManager.getInstance()
        return try {
            if (profilesSupported()) ProfileStore.getInstance().getOrCreateProfile(pn).cookieManager else CookieManager.getInstance()
        } catch (e: Throwable) { CookieManager.getInstance() }
    }

    /** Вызывается при запуске приложения: если автоотправка включена, страница живёт в фоне и без захода на вкладку. */
    fun startIfEnabled() {
        if (autoEnabled()) ensureView()
    }

    fun canGoBack(): Boolean = view?.canGoBack() == true
    fun goBack() { view?.goBack() }

    /** Прямоугольник области в CSS-пикселях страницы приложения (координаты внутри главного WebView). */
    fun show(x: Double, y: Double, w: Double, h: Double) {
        val v = ensureView()
        val d = activity.resources.displayMetrics.density
        val wPx = (w * d).roundToInt().coerceAtLeast(1)
        val hPx = (h * d).roundToInt().coerceAtLeast(1)
        rL = (x * d).roundToInt()
        rT = (y * d).roundToInt()
        rW = wPx
        rH = hPx
        layoutShown(v)
        v.translationZ = 0f
        v.translationX = 0f
        shown = true
        activity.setSiteKeyboardOverlay(true)
        // Зашли на вкладку, а отправка стоит без движения (скрипт не запустился) — подталкиваем: страница грузится заново.
        job?.let { if (!it.done && (it.lastSig.isEmpty() || it.lastSig.startsWith("idle")) && System.currentTimeMillis() - it.lastChangeAt > TASK_KICK_MS) restartJob(it, v) }
    }

    /** Экранная клавиатура окно не сжимает (вкладки на местах): WebView укорачивается до её верха. */
    private fun layoutShown(v: WebView) {
        val h = if (kb > 0) minOf(rH, maxOf(1, host.height - kb - rT)) else rH
        val cur = v.layoutParams as? FrameLayout.LayoutParams
        if (cur != null && cur.width == rW && cur.height == h && cur.leftMargin == rL && cur.topMargin == rT) return
        val lp = FrameLayout.LayoutParams(rW, h)
        lp.leftMargin = rL
        lp.topMargin = rT
        v.layoutParams = lp
    }

    fun setKeyboardInset(px: Int) {
        if (kb == px) return
        kb = px
        val v = view ?: return
        if (shown) layoutShown(v)
    }

    /**
     * Окна под кнопки страницы: [spec] — «x,y,w,h;x,y,w,h» в CSS-пикселях страницы (как прямоугольник в [show]); пусто — окон нет.
     * Сквозь окна виден главный WebView с кнопками нижнего ряда, а сам claude.ai растянут под них. Работает с Android 10 (API 29).
     */
    fun setHoles(spec: String?) {
        if (Build.VERSION.SDK_INT < 29) return
        val d = activity.resources.displayMetrics.density
        val list = ArrayList<RectF>()
        if (!spec.isNullOrEmpty() && spec.length < 400) {
            for (part in spec.split(";")) {
                val nums = part.split(",").mapNotNull { it.trim().toFloatOrNull() }
                if (nums.size != 4 || nums[2] <= 0f || nums[3] <= 0f) continue
                list.add(RectF(nums[0] * d, nums[1] * d, (nums[0] + nums[2]) * d, (nums[1] + nums[3]) * d))
                if (list.size >= 8) break
            }
        }
        holes = list
        (view as? SiteWebView)?.setHoles(list, 8f * d)
    }

    fun hide() {
        shown = false
        activity.siteSelectionMenu.hide()
        activity.setSiteKeyboardOverlay(false)
        val v = view ?: return
        v.clearFocus()
        if (taskActive()) renderBehind(v) else parkOffscreen(v)
    }

    fun reload() { view?.reload() }

    /** «Домик»: первый экран вкладки. */
    fun goHome() { if (profileName == null || profilesSupported()) view?.loadUrl(HOME_URL) }

    fun setAuto(enabled: Boolean, text: String?) {
        val clean = (text ?: "").replace(Regex("\\s+"), " ").trim().take(200).ifEmpty { DEFAULT_TEXT }
        prefs.edit().putBoolean(k(KEY_ENABLED), enabled).putString(k(KEY_TEXT), clean).apply()
        view?.evaluateJavascript("window.__ltAutoCfg=" + cfgJson(), null)
        if (enabled) ensureView()
    }

    fun armTimer(minutes: Int) {
        view?.evaluateJavascript("window.__ltAuto&&window.__ltAuto.arm(" + minutes.coerceIn(1, 360) + ")", null)
    }

    fun disarm() { view?.evaluateJavascript("window.__ltAuto&&window.__ltAuto.disarm()", null) }

    fun sendNow() { view?.evaluateJavascript("window.__ltAuto&&window.__ltAuto.sendNow()", null) }

    /**
     * «Далее» в текущий чат вкладки (круг с треугольником в острове): нажимает «Продолжить» в чате или отправляет текст автоотправки
     * ([autoText]). Удалось — плашка агента снова «идёт»; не удалось (нет страницы, в поле ввода чужой текст) — короткое сообщение.
     */
    fun continueTask(quiet: Boolean = false) {
        val v = view
        if (v == null) {
            if (!quiet) toast("Вкладка Claude не открыта")
            return
        }
        v.evaluateJavascript("window.__ltAutoCfg=" + cfgJson() + ";(window.__ltAgent?window.__ltAgent.next():false)") { raw ->
            if (raw?.trim() == "true") AgentRuns.resumeTab(tabId) else if (!quiet) toast("Не удалось нажать «Далее»: проверьте поле ввода в чате")
        }
    }

    private fun toast(msg: String) {
        try { android.widget.Toast.makeText(activity, msg, android.widget.Toast.LENGTH_SHORT).show() } catch (e: Exception) { }
    }

    /** JSON для вкладки: настройки + последний прочитанный из страницы статус. */
    fun stateJson(): String = JSONObject()
        .put("created", view != null)
        .put("auto", autoEnabled())
        .put("text", autoText())
        .put("status", try { JSONObject(lastStatus) } catch (e: Exception) { JSONObject() })
        .toString()

    fun pause() { try { cookieMgr().flush() } catch (e: Throwable) { } }

    fun destroy() {
        failAllTasks("вкладка закрыта")
        handler.removeCallbacksAndMessages(null)
        val v = view ?: return
        view = null
        (v.parent as? ViewGroup)?.removeView(v)
        v.destroy()
    }

    /** Вкладку закрыли насовсем: WebView уничтожается, настройки «Авто» и профиль со входом удаляются. У «main» не вызывается. */
    fun purge() {
        destroy()
        prefs.edit().remove(k(KEY_ENABLED)).remove(k(KEY_TEXT)).apply()
        val pn = profileName ?: return
        try { if (profilesSupported()) ProfileStore.getInstance().deleteProfile(pn) } catch (e: Throwable) { }
    }

    // ---------- отправка задачи в новый диалог ----------
    private class TaskJob(val reqId: String, val text: String, val zip: File?, val images: List<ClaudeTaskImage> = emptyList(), val plain: Boolean = false) {
        /** Адрес чата (/chat/…), который страница назвала после отправки (нужен у обычной задачи). */
        @Volatile var chatPath = ""
        @Volatile var gen = 0
        @Volatile var done = false
        /** Когда в последний раз что-то двигалось: загрузка страницы, кусок архива, смена этапа в скрипте. */
        @Volatile var lastChangeAt = System.currentTimeMillis()
        @Volatile var lastSig = ""
        @Volatile var stage = ""
        @Volatile var restarts = 0
        /** Номер попытки: скрипт отправки помечает его в localStorage claude.ai после нажатия «Отправить» и не отправляет повторно. */
        val attempt: String = java.util.UUID.randomUUID().toString().replace("-", "").take(16)
        /** Сообщение уже могло уйти (скрипт дошёл до «Отправить» или страница в чате): страницу заново не грузим. */
        @Volatile var sentSeen = false
        fun deleteFiles() {
            try { zip?.delete() } catch (e: Exception) { }
            images.forEach { try { it.file.delete() } catch (e: Exception) { } }
        }
    }
    private val taskQueue = ArrayDeque<TaskJob>()
    private var job: TaskJob? = null

    /** Поток интерфейса. Задачи одной вкладки идут по очереди: каждая — в свой новый чат. */
    fun enqueueTask(reqId: String, text: String, zip: File?, images: List<ClaudeTaskImage> = emptyList(), plain: Boolean = false) {
        taskQueue.addLast(TaskJob(reqId, text, zip, images, plain))
        if (job == null) nextTask()
    }

    private fun nextTask() {
        val j = taskQueue.pollFirst() ?: return
        job = j
        val v = ensureView()
        j.lastChangeAt = System.currentTimeMillis()
        renderBehind(v)
        v.loadUrl(NEW_URL)
        handler.postDelayed(jobTimeout, TASK_TIMEOUT_MS)
        handler.postDelayed(taskPoll, TASK_POLL_MS)
    }

    private val jobTimeout = Runnable { job?.let { finishJob(it, false, "время ожидания вышло" + stageNote(it)) } }

    private fun stageNote(j: TaskJob): String =
        if (j.stage.isNotEmpty()) " (этап: ${j.stage})" else " (страница не запустила отправку)"

    /**
     * Пока идёт отправка, а вкладка не на экране: WebView стоит на месте, но ПОД главным (отрицательная глубина), а не за краем экрана.
     * Закрытый, но нарисованный WebView Chromium не усыпляет; вне экрана страницу могут не рисовать, и claude.ai не успевает собрать поле ввода.
     */
    private fun renderBehind(v: WebView) {
        if (shown) return
        try { v.onResume(); v.resumeTimers() } catch (e: Throwable) { }
        val cur = v.layoutParams as? FrameLayout.LayoutParams
        if (cur == null || cur.width != ViewGroup.LayoutParams.MATCH_PARENT || cur.height != ViewGroup.LayoutParams.MATCH_PARENT || cur.leftMargin != 0 || cur.topMargin != 0) {
            v.layoutParams = FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
        }
        v.translationZ = -1f
        v.translationX = 0f
    }

    private fun parkOffscreen(v: WebView) {
        v.translationZ = 0f
        v.translationX = OFFSCREEN_X
    }

    private fun taskActive(): Boolean = job?.let { !it.done } == true

    // ---------- чаты «обычной задачи» ----------
    // В таких чатах fix.zip не качается автоматически и не коммитится: адреса (/chat/<id>) помнит вкладка (SharedPreferences, не больше MAX_PLAIN_CHATS).
    private fun plainChatList(): MutableList<String> =
        (prefs.getString(k(KEY_PLAIN_CHATS), "") ?: "").split("\n").filter { it.startsWith("/chat/") }.toMutableList()

    /** Путь /chat/<id> из адреса claude.ai; null — страница не в чате. */
    private fun chatPathOf(url: String?): String? {
        if (url.isNullOrBlank()) return null
        return try {
            val u = Uri.parse(url)
            if (u.host?.lowercase() != "claude.ai") null else u.path?.takeIf { it.startsWith("/chat/") && it.length > 6 }?.trimEnd('/')
        } catch (e: Exception) { null }
    }

    private fun markPlainChat(path: String) {
        val l = plainChatList()
        if (path in l) return
        l.add(path)
        while (l.size > MAX_PLAIN_CHATS) l.removeAt(0)
        prefs.edit().putString(k(KEY_PLAIN_CHATS), l.joinToString("\n")).apply()
    }

    /** Открыт ли сейчас чат, созданный обычной задачей. */
    private fun inPlainChat(v: WebView?): Boolean {
        val p = chatPathOf(try { v?.url } catch (e: Exception) { null }) ?: return false
        return p in plainChatList()
    }

    /** Страница сейчас в чате (/chat/…): новый диалог создан, то есть сообщение ушло. */
    private fun onChatPage(v: WebView): Boolean {
        val p = try { Uri.parse(v.url ?: "").path ?: "" } catch (e: Exception) { "" }
        return p.startsWith("/chat/")
    }

    /** Страницу грузим заново: onPageFinished снова запустит передачу архива. */
    private fun restartJob(j: TaskJob, v: WebView) {
        if (j.done || j.restarts >= TASK_MAX_RESTARTS) return
        // Сообщение могло уйти: заново страницу не грузим, иначе задача отправится ещё раз.
        if (j.sentSeen) return
        if (j.gen > 0 && onChatPage(v)) { j.sentSeen = true; finishJob(j, true, ""); return }
        j.restarts++
        j.lastChangeAt = System.currentTimeMillis()
        j.lastSig = ""
        j.stage = ""
        v.loadUrl(NEW_URL)
    }

    private val taskPoll = object : Runnable {
        override fun run() {
            val j = job ?: return
            val v = view
            if (v == null) { finishJob(j, false, "страница Claude не открыта"); return }
            v.evaluateJavascript("(window.__ltTask?window.__ltTask.status():null)") { raw ->
                if (job !== j) return@evaluateJavascript
                val now = System.currentTimeMillis()
                var o: JSONObject? = null
                if (raw != null && raw.startsWith("{")) {
                    try { o = JSONObject(raw) } catch (e: Exception) { o = null }
                }
                if (o == null || o.optString("reqId") != j.reqId) {
                    // страница ушла в чат — сообщение отправлено, скрипт остался в прежней странице; заново не отправляем
                    if (j.gen > 0 && onChatPage(v)) { j.sentSeen = true; finishJob(j, true, ""); return@evaluateJavascript }
                    // скрипт отправки ещё не стартовал (или страница потеряла его): ждём, а если долго — грузим заново
                    if (now - j.lastChangeAt > TASK_STALL_MS) restartJob(j, v)
                    return@evaluateJavascript
                }
                val sig = o.optString("state") + "|" + o.optString("msg")
                if (sig != j.lastSig) { j.lastSig = sig; j.lastChangeAt = now }
                if (o.optString("state") == "working") j.stage = o.optString("msg")
                if (o.optString("msg") == STAGE_SENT) j.sentSeen = true
                o.optString("path").let { if (it.startsWith("/chat/")) j.chatPath = it }
                when (o.optString("state")) {
                    "sent" -> finishJob(j, true, o.optString("msg")) // непустое msg — предупреждение (например, картинка не подтвердилась)
                    "error" -> finishJob(j, false, o.optString("msg").ifEmpty { "не удалось отправить" })
                }
            }
            handler.postDelayed(this, TASK_POLL_MS)
        }
    }

    private fun finishJob(j: TaskJob, ok: Boolean, msg: String) {
        if (j.done) return
        j.done = true
        handler.removeCallbacks(jobTimeout)
        handler.removeCallbacks(taskPoll)
        // обычная задача ушла: чат запоминается, чтобы fix.zip в нём не забирался автоматически (адрес берём у страницы, а если её нет — у самой вкладки)
        if (ok && j.plain) {
            val cp = if (j.chatPath.startsWith("/chat/")) j.chatPath else chatPathOf(try { view?.url } catch (e: Exception) { null })
            if (cp != null) markPlainChat(cp)
        }
        ClaudeTaskResults.add(j.reqId, ok, msg)
        j.deleteFiles()
        if (job === j) job = null
        if (taskQueue.isEmpty() && !shown) view?.let { parkOffscreen(it) }
        nextTask()
    }

    private fun failAllTasks(msg: String) {
        job?.let { finishJobNoNext(it, msg) }
        job = null
        while (true) { val q = taskQueue.pollFirst() ?: break; finishJobNoNext(q, msg) }
    }

    private fun finishJobNoNext(j: TaskJob, msg: String) {
        if (j.done) return
        j.done = true
        ClaudeTaskResults.add(j.reqId, false, msg)
        j.deleteFiles()
    }

    private fun onTaskPageFinished(v: WebView?, url: String?) {
        val j = job ?: return
        if (v == null || j.done) return
        val u = try { Uri.parse(url) } catch (e: Exception) { return }
        if (u.host?.lowercase() != "claude.ai") return
        val path = u.path ?: "/"
        if (path.startsWith("/login") || path.startsWith("/logout")) {
            finishJob(j, false, "во вкладке нет входа в Claude — войдите и повторите")
            return
        }
        // Страница ушла в чат: сообщение отправлено (скрипт остался в прежней странице). Заново не отправляем.
        if (path.startsWith("/chat/")) {
            if (j.gen > 0) { j.sentSeen = true; finishJob(j, true, "") }
            return
        }
        if (path == "/new" || path == "/" || path.isEmpty()) startUpload(v, j)
    }

    /** Страница нового чата загружена: кладём в неё архив кусками и запускаем отправку. Новая загрузка страницы начинает заново (gen). */
    private fun startUpload(v: WebView, j: TaskJob) {
        val myGen = ++j.gen
        val script = try {
            activity.assets.open("claude/send_task.js").bufferedReader(Charsets.UTF_8).use { it.readText() }
        } catch (e: Exception) {
            finishJob(j, false, "в приложении нет скрипта отправки")
            return
        }
        // файл №0 — архив (у обычной задачи его нет), №1… — картинки задачи (send_task.js 1.2)
        val zip = j.zip
        val files = ArrayList<Pair<Int, File>>()
        if (zip != null) files.add(0 to zip)
        j.images.forEachIndexed { i, im -> files.add((i + 1) to im.file) }
        v.evaluateJavascript(script + (if (zip != null) "\nwindow.__ltTaskInit(" + zip.length() + ", 0);" else ""), null)
        Thread {
            try {
                for ((idx, f) in files) {
                    if (idx > 0) {
                        val size = f.length()
                        activity.runOnUiThread {
                            val cur = view
                            if (cur != null && !j.done && j.gen == myGen) cur.evaluateJavascript("window.__ltTaskInit(" + size + ", " + idx + ")", null)
                        }
                    }
                    f.inputStream().use { ins ->
                        val raw = ByteArray(TASK_CHUNK)
                        while (true) {
                            if (j.done || j.gen != myGen) return@Thread
                            j.lastChangeAt = System.currentTimeMillis()
                            val n = readFully(ins, raw)
                            if (n <= 0) break
                            val b64 = Base64.encodeToString(raw, 0, n, Base64.NO_WRAP)
                            val latch = CountDownLatch(1)
                            activity.runOnUiThread {
                                val cur = view
                                if (cur == null || j.done || j.gen != myGen) latch.countDown()
                                else cur.evaluateJavascript("window.__ltTaskPut&&window.__ltTaskPut('" + b64 + "', " + idx + ")") { latch.countDown() }
                            }
                            if (!latch.await(30, TimeUnit.SECONDS)) throw IOException("страница не отвечает")
                            if (n < raw.size) break
                        }
                    }
                }
                if (j.done || j.gen != myGen) return@Thread
                val imgs = JSONArray()
                j.images.forEach { imgs.put(JSONObject().put("name", it.name).put("type", it.mime)) }
                val cfg = JSONObject().put("reqId", j.reqId).put("text", j.text).put("name", if (zip != null) ClaudeTaskZip.FILE_NAME else "").put("plain", j.plain).put("images", imgs).put("attempt", j.attempt).toString()
                activity.runOnUiThread {
                    if (!j.done && j.gen == myGen) view?.evaluateJavascript("window.__ltTaskStart(" + cfg + ")", null)
                }
            } catch (e: Exception) {
                activity.runOnUiThread { if (j.gen == myGen) finishJob(j, false, "не удалось передать архив странице: " + (e.message ?: "ошибка")) }
            }
        }.start()
    }

    private fun readFully(ins: InputStream, buf: ByteArray): Int {
        var total = 0
        while (total < buf.size) {
            val n = ins.read(buf, total, buf.size - total)
            if (n < 0) break
            total += n
        }
        return total
    }

    private fun cfgJson(): String = JSONObject().put("enabled", autoEnabled()).put("text", autoText()).toString()

    @SuppressLint("SetJavaScriptEnabled")
    private fun ensureView(): WebView {
        view?.let { return it }
        val v = SiteWebView(activity)
        // Профиль задаётся до любых других действий с WebView. Не вышло — вкладка не грузит claude.ai (общий вход подставлять нельзя).
        var profileOk = true
        if (profileName != null) {
            profileOk = try {
                if (!profilesSupported()) false else {
                    ProfileStore.getInstance().getOrCreateProfile(profileName)
                    WebViewCompat.setProfile(v, profileName)
                    true
                }
            } catch (e: Throwable) { false }
        }
        v.setHoles(holes, 8f * activity.resources.displayMetrics.density)
        v.selectionListener = activity.siteSelectionMenu
        v.hotkeyForwarder = { combo -> activity.forwardHotkey(combo) }
        v.setBackgroundColor(0xFFFFFFFF.toInt())
        v.isVerticalScrollBarEnabled = false
        v.isHorizontalScrollBarEnabled = false
        val s = v.settings
        s.javaScriptEnabled = true
        s.domStorageEnabled = true
        s.allowFileAccess = false
        s.allowContentAccess = false
        s.setSupportMultipleWindows(false)
        s.javaScriptCanOpenWindowsAutomatically = false
        // Метка «; wv» в user-agent заставляет часть сайтов показывать упрощённую страницу или отказывать во входе.
        s.userAgentString = s.userAgentString.replace("; wv", "")
        val cookies = if (profileOk) cookieMgr() else CookieManager.getInstance()
        cookies.setAcceptCookie(true)
        cookies.setAcceptThirdPartyCookies(v, true)

        // Файл с claude.ai скачивает само приложение: http/https — движок, ход виден в плавающем острове; blob: и data: — PageDownloads (этап 6).
        // Имя из атрибута `download` WebView не передаёт (приходит пусто → «download» без расширения): спрашиваем у страницы, что она запомнила ([injectDownloadHook]).
        // Android 5.0–5.1: blob: отдаётся узким мостом (на 6.0+ — одноразовым каналом PageDownloads); ставится до загрузки страницы.
        AutoCommit.LegacyBlob.install(v)
        v.setDownloadListener { url, ua, cd, mime, _ ->
            val go = { disposition: String? ->
                // fix.zip с ответом агента забирает автокоммит (AutoCommit); любой другой файл — как раньше.
                // Скрипт автоскачивания (auto_fix.js) только что нажал на карточку? Тогда zip без имени — тоже ожидаемый fix.zip.
                val decide = { expected: Boolean ->
                    // в чате «обычной задачи» fix.zip не коммитится: файл скачивается как любой другой
                    val taken = if (inPlainChat(v)) false else try {
                        AutoCommit.intercept(activity, v, PageDownloadLogic.pageFileName(disposition, mime), url, ua, mime, cookieMgr(), expected, tabId)
                    } catch (e: Exception) { false }
                    if (!taken) {
                        try { DownloadLauncher.handlePage(activity, v, url, ua, disposition, mime, v.url, "set2s_10", cookieMgr()) } catch (e: Exception) { }
                    }
                }
                try {
                    v.evaluateJavascript("(Date.now()-(window.__ltFixExpect||0)<30000)") { raw -> decide(raw?.trim() == "true") }
                } catch (e: Exception) {
                    decide(false)
                }
            }
            if (!cd.isNullOrBlank() || url.isNullOrBlank()) {
                go(cd)
            } else {
                try {
                    v.evaluateJavascript(PageDownloadLogic.nameLookupScript(url)) { raw ->
                        go(PageDownloadLogic.dispositionFor(PageDownloadLogic.nameFromJsResult(raw)) ?: cd)
                    }
                } catch (e: Exception) {
                    go(cd)
                }
            }
        }

        v.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView?, request: WebResourceRequest?): Boolean =
                handleUrl(request?.url)

            @Suppress("OVERRIDE_DEPRECATION", "DEPRECATION")
            override fun shouldOverrideUrlLoading(view: WebView?, url: String?): Boolean =
                handleUrl(if (url == null) null else Uri.parse(url))

            override fun onPageFinished(view: WebView?, url: String?) {
                injectDownloadHook(view)
                injectAuto(view)
                injectAutoFix(view)
                injectAgentState(view)
                onTaskPageFinished(view, url)
            }

            override fun onRenderProcessGone(view: WebView?, detail: RenderProcessGoneDetail?): Boolean {
                // Процесс рендера упал: убираем WebView, при следующем заходе на вкладку он создастся заново.
                activity.runOnUiThread {
                    val old = this@ClaudeTab.view
                    this@ClaudeTab.view = null
                    if (old != null) {
                        (old.parent as? ViewGroup)?.removeView(old)
                        old.destroy()
                    }
                    lastStatus = "{}"
                    if (shown) shown = false
                    job?.let { finishJob(it, false, "страница Claude перезапустилась, повторите") }
                }
                return true
            }
        }
        v.webChromeClient = object : WebChromeClient() {
            override fun onShowFileChooser(
                view: WebView?,
                callback: ValueCallback<Array<Uri>>?,
                params: FileChooserParams?
            ): Boolean = activity.handleFileChooser(callback, params)
        }

        v.translationX = OFFSCREEN_X
        host.addView(v, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
        view = v
        if (profileOk) v.loadUrl(HOME_URL)
        else v.loadDataWithBaseURL(null,
            "<html><body style='font-family:sans-serif;padding:24px;color:#444'>Для этой вкладки нужен отдельный вход, но установленный Android System WebView не поддерживает отдельные профили. Обновите WebView в Google Play.</body></html>",
            "text/html", "utf-8", null)
        handler.postDelayed(statusPoll, STATUS_POLL_MS)
        return v
    }

    private var fixSeq = 0

    private val statusPoll = object : Runnable {
        override fun run() {
            val v = view
            if (v != null) {
                v.evaluateJavascript("(window.__ltAuto?window.__ltAuto.status():null)") { raw ->
                    if (raw != null && raw != "null" && raw.startsWith("{")) lastStatus = raw
                }
                // Состояние чата для плашки агента в острове (agent_state.js): токены кончились / инструменты кончились / идёт ответ.
                v.evaluateJavascript("(window.__ltAgent?window.__ltAgent.status():null)") { raw ->
                    try {
                        if (raw != null && raw.startsWith("{")) {
                            val o = JSONObject(raw)
                            AgentRuns.pageState(tabId, o.optString("kind", ""), o.optBoolean("gen", false))
                            // инструменты кончились, а fix.zip ещё не отдан — сами отправляем «Далее» (если fix.zip уже пришёл, запуск сюда не попадёт)
                            if (AgentRuns.autoNextDue(tabId)) continueTask(quiet = true)
                        }
                    } catch (e: Exception) { }
                }
                // Автоскачивание fix.zip (auto_fix.js): свежая настройка в страницу и ошибка скрипта — в «Последний результат».
                v.evaluateJavascript("window.__ltFixCfg={enabled:" + (AutoCommit.autoClickReady(activity) && !inPlainChat(v)) + "};(window.__ltFix?window.__ltFix.status():null)") { raw ->
                    try {
                        if (raw != null && raw.startsWith("{")) {
                            val o = JSONObject(raw)
                            val sq = o.optInt("seq", 0)
                            if (sq != fixSeq) {
                                fixSeq = sq
                                val err = o.optString("error", "")
                                if (err.isNotEmpty()) AutoCommit.recordNote(activity, err)
                            }
                        }
                    } catch (e: Exception) { }
                }
                handler.postDelayed(this, STATUS_POLL_MS)
            }
        }
    }

    /** Страница запоминает имена из `<a download>`, чтобы скачанный файл получил своё имя и расширение. */
    private fun injectDownloadHook(v: WebView?) {
        try { v?.evaluateJavascript(PageDownloadLogic.nameHookScript(), null) } catch (e: Exception) { }
    }

    /** Скрипт автоскачивания fix.zip (auto_fix.js): сам нажимает на новую карточку fix.zip после ответа агента. */
    private fun injectAutoFix(v: WebView?) {
        if (v == null) return
        val script = try {
            activity.assets.open("claude/auto_fix.js").bufferedReader(Charsets.UTF_8).use { it.readText() }
        } catch (e: Exception) {
            return
        }
        v.evaluateJavascript("window.__ltFixCfg={enabled:" + (AutoCommit.autoClickReady(activity) && !inPlainChat(v)) + "};\n" + script, null)
    }

    /** Скрипт состояния чата (agent_state.js): токены кончились / инструменты кончились — для плашки агента в острове. */
    private fun injectAgentState(v: WebView?) {
        if (v == null) return
        val script = try {
            activity.assets.open("claude/agent_state.js").bufferedReader(Charsets.UTF_8).use { it.readText() }
        } catch (e: Exception) {
            return
        }
        v.evaluateJavascript(script, null)
    }

    private fun injectAuto(v: WebView?) {
        if (v == null) return
        val script = try {
            activity.assets.open("claude/auto_next.js").bufferedReader(Charsets.UTF_8).use { it.readText() }
        } catch (e: Exception) {
            return
        }
        v.evaluateJavascript("window.__ltAutoCfg=" + cfgJson() + ";\n" + script, null)
    }

    /** true — переход перехвачен (чужой адрес уходит во внешнее приложение), false — грузит сам WebView. */
    private fun handleUrl(uri: Uri?): Boolean {
        if (uri == null) return true
        val scheme = uri.scheme?.lowercase()
        if (scheme == "about" || scheme == "blob" || scheme == "data") return false
        val h = uri.host?.lowercase() ?: return true
        if (scheme == "https" && ALLOWED_HOSTS.any { h == it || h.endsWith(".$it") }) return false
        activity.openExternalLink(uri)
        return true
    }
}
