package com.app.lifetracker
// Версия: 1.0 (21.10) — вкладка Claude: второй WebView с claude.ai поверх области содержимого + автоотправка «Дальше».

import android.annotation.SuppressLint
import android.content.Context
import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.view.ViewGroup
import android.webkit.CookieManager
import android.webkit.RenderProcessGoneDetail
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout
import org.json.JSONObject
import kotlin.math.roundToInt

/**
 * Вкладка «Claude» (set2s_10): отдельный WebView с https://claude.ai, который лежит поверх области содержимого
 * главного WebView (страница приложения присылает его прямоугольник через мост: claudeShow). В этот WebView мост
 * LifeTrackerNative НЕ добавляется — чужой сайт не получает доступа к приложению.
 * Автоотправка: после загрузки страницы вставляется assets/claude/auto_next.js; настройки лежат в SharedPreferences,
 * статус раз в несколько секунд читается из страницы и отдаётся вкладке (claudeState).
 * Скрытие — сдвиг за край (а не INVISIBLE): скрытый WebView Chromium считает невидимым и душит таймеры страницы.
 */
class ClaudeTab(private val activity: MainActivity, private val host: FrameLayout) {

    companion object {
        const val HOME_URL = "https://claude.ai/"
        const val DEFAULT_TEXT = "Дальше"
        private const val PREFS = "claude_tab"
        private const val KEY_ENABLED = "auto_enabled"
        private const val KEY_TEXT = "auto_text"
        private const val OFFSCREEN_X = 20000f
        private const val STATUS_POLL_MS = 4000L
        private val ALLOWED_HOSTS = listOf("claude.ai", "anthropic.com", "claude.com")
    }

    private val handler = Handler(Looper.getMainLooper())
    private val prefs = activity.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    private var view: WebView? = null
    private var shown = false
    private var lastStatus = "{}"

    val isVisible: Boolean get() = shown && view != null

    fun autoEnabled(): Boolean = prefs.getBoolean(KEY_ENABLED, false)
    fun autoText(): String = prefs.getString(KEY_TEXT, DEFAULT_TEXT)?.ifBlank { DEFAULT_TEXT } ?: DEFAULT_TEXT

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
        val lp = FrameLayout.LayoutParams(wPx, hPx)
        lp.leftMargin = (x * d).roundToInt()
        lp.topMargin = (y * d).roundToInt()
        v.layoutParams = lp
        v.translationX = 0f
        shown = true
    }

    fun hide() {
        shown = false
        val v = view ?: return
        v.clearFocus()
        v.translationX = OFFSCREEN_X
    }

    fun reload() { view?.reload() }

    fun setAuto(enabled: Boolean, text: String?) {
        val clean = (text ?: "").replace(Regex("\\s+"), " ").trim().take(200).ifEmpty { DEFAULT_TEXT }
        prefs.edit().putBoolean(KEY_ENABLED, enabled).putString(KEY_TEXT, clean).apply()
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

    fun pause() { CookieManager.getInstance().flush() }

    fun destroy() {
        handler.removeCallbacksAndMessages(null)
        val v = view ?: return
        view = null
        (v.parent as? ViewGroup)?.removeView(v)
        v.destroy()
    }

    private fun cfgJson(): String = JSONObject().put("enabled", autoEnabled()).put("text", autoText()).toString()

    @SuppressLint("SetJavaScriptEnabled")
    private fun ensureView(): WebView {
        view?.let { return it }
        val v = WebView(activity)
        v.setBackgroundColor(0xFFFFFFFF.toInt())
        val s = v.settings
        s.javaScriptEnabled = true
        s.domStorageEnabled = true
        s.allowFileAccess = false
        s.allowContentAccess = false
        s.setSupportMultipleWindows(false)
        s.javaScriptCanOpenWindowsAutomatically = false
        // Метка «; wv» в user-agent заставляет часть сайтов показывать упрощённую страницу или отказывать во входе.
        s.userAgentString = s.userAgentString.replace("; wv", "")
        val cookies = CookieManager.getInstance()
        cookies.setAcceptCookie(true)
        cookies.setAcceptThirdPartyCookies(v, true)

        v.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView?, request: WebResourceRequest?): Boolean =
                handleUrl(request?.url)

            @Suppress("OVERRIDE_DEPRECATION", "DEPRECATION")
            override fun shouldOverrideUrlLoading(view: WebView?, url: String?): Boolean =
                handleUrl(if (url == null) null else Uri.parse(url))

            override fun onPageFinished(view: WebView?, url: String?) {
                injectAuto(view)
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
        v.loadUrl(HOME_URL)
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
