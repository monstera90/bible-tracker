package com.app.lifetracker
// Версия: 1.9 (24.11) — отправка задачи в НОВЫЙ диалог вкладки (сундучок у задачи): очередь [enqueueTask] → страница https://claude.ai/new грузится заново (так задача всегда попадает в новый чат, а не в открытый у пользователя), в неё кусками base64 кладётся архив репозитория (assets/claude/send_task.js), затем прикрепляется, вставляется текст и нажимается «Отправить»; ход проверяется опросом статуса страницы, итог — [ClaudeTaskResults]. Откат: ClaudeTab.kt 1.8.
// Версия: 1.8 (24.11) — несколько вкладок Claude: у экземпляра свой [tabId]; вкладка «main» работает как раньше (общий вход приложения), остальные — каждая в своём профиле WebView (androidx.webkit Profile `claude_<id>`: свои cookie и хранилище, вход не смешивается). Настройки «Авто» — отдельные для каждой вкладки. [purge] — удалить вкладку вместе с её входом. Откат: ClaudeTab.kt 1.7.
// Версия: 1.7 (22.11) — `setDownloadListener`: `data:` и `blob:` сохраняет приложение (DownloadLauncher.handlePage, ТЗ TZ_downloads.md, этап 6). Откат: ClaudeTab.kt 1.6.
// Версия: 1.6 (21.11) — `setDownloadListener`: файлы claude.ai скачивает приложение (DownloadLauncher, ТЗ TZ_downloads.md, этап 1). Откат: ClaudeTab.kt 1.5.
// Версия: 1.5 (20.11) — кнопки вкладки перенесены в нижний ряд страницы, а claude.ai растянут на всю область и заходит под них: WebView теперь `SiteWebView` с «окнами» ([setHoles], мост `claudeHoles`; Android 10+, как у вкладок-сайтов). Откат: ClaudeTab.kt 1.4.
// Версия: 1.4 (11.11)

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
        v.translationX = 0f
        shown = true
        activity.setSiteKeyboardOverlay(true)
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
        v.translationX = OFFSCREEN_X
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
    private class TaskJob(val reqId: String, val text: String, val zip: File) {
        @Volatile var gen = 0
        @Volatile var done = false
    }
    private val taskQueue = ArrayDeque<TaskJob>()
    private var job: TaskJob? = null

    /** Поток интерфейса. Задачи одной вкладки идут по очереди: каждая — в свой новый чат. */
    fun enqueueTask(reqId: String, text: String, zip: File) {
        taskQueue.addLast(TaskJob(reqId, text, zip))
        if (job == null) nextTask()
    }

    private fun nextTask() {
        val j = taskQueue.pollFirst() ?: return
        job = j
        val v = ensureView()
        v.loadUrl(NEW_URL)
        handler.postDelayed(jobTimeout, TASK_TIMEOUT_MS)
        handler.postDelayed(taskPoll, TASK_POLL_MS)
    }

    private val jobTimeout = Runnable { job?.let { finishJob(it, false, "время ожидания вышло") } }

    private val taskPoll = object : Runnable {
        override fun run() {
            val j = job ?: return
            val v = view
            if (v == null) { finishJob(j, false, "страница Claude не открыта"); return }
            v.evaluateJavascript("(window.__ltTask?window.__ltTask.status():null)") { raw ->
                if (job !== j || raw == null || !raw.startsWith("{")) return@evaluateJavascript
                val o = try { JSONObject(raw) } catch (e: Exception) { return@evaluateJavascript }
                if (o.optString("reqId") != j.reqId) return@evaluateJavascript
                when (o.optString("state")) {
                    "sent" -> finishJob(j, true, "")
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
        ClaudeTaskResults.add(j.reqId, ok, msg)
        try { j.zip.delete() } catch (e: Exception) { }
        if (job === j) job = null
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
        try { j.zip.delete() } catch (e: Exception) { }
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
        v.evaluateJavascript(script + "\nwindow.__ltTaskInit(" + j.zip.length() + ");", null)
        Thread {
            try {
                j.zip.inputStream().use { ins ->
                    val raw = ByteArray(TASK_CHUNK)
                    while (true) {
                        if (j.done || j.gen != myGen) return@Thread
                        val n = readFully(ins, raw)
                        if (n <= 0) break
                        val b64 = Base64.encodeToString(raw, 0, n, Base64.NO_WRAP)
                        val latch = CountDownLatch(1)
                        activity.runOnUiThread {
                            val cur = view
                            if (cur == null || j.done || j.gen != myGen) latch.countDown()
                            else cur.evaluateJavascript("window.__ltTaskPut&&window.__ltTaskPut('" + b64 + "')") { latch.countDown() }
                        }
                        if (!latch.await(30, TimeUnit.SECONDS)) throw IOException("страница не отвечает")
                        if (n < raw.size) break
                    }
                }
                if (j.done || j.gen != myGen) return@Thread
                val cfg = JSONObject().put("reqId", j.reqId).put("text", j.text).put("name", ClaudeTaskZip.FILE_NAME).toString()
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
        v.setDownloadListener { url, ua, cd, mime, _ ->
            try { DownloadLauncher.handlePage(activity, v, url, ua, cd, mime, v.url, "set2s_10", cookieMgr()) } catch (e: Exception) { }
        }

        v.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView?, request: WebResourceRequest?): Boolean =
                handleUrl(request?.url)

            @Suppress("OVERRIDE_DEPRECATION", "DEPRECATION")
            override fun shouldOverrideUrlLoading(view: WebView?, url: String?): Boolean =
                handleUrl(if (url == null) null else Uri.parse(url))

            override fun onPageFinished(view: WebView?, url: String?) {
                injectAuto(view)
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

    private val statusPoll = object : Runnable {
        override fun run() {
            val v = view
            if (v != null) {
                v.evaluateJavascript("(window.__ltAuto?window.__ltAuto.status():null)") { raw ->
                    if (raw != null && raw != "null" && raw.startsWith("{")) lastStatus = raw
                }
                handler.postDelayed(this, STATUS_POLL_MS)
            }
        }
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
