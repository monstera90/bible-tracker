package com.app.lifetracker

import android.Manifest
import android.annotation.SuppressLint
import android.content.ActivityNotFoundException
import android.content.Intent
import android.content.pm.ApplicationInfo
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.net.Uri
import android.os.Bundle
import android.view.View
import android.view.ViewGroup
import android.webkit.PermissionRequest
import android.webkit.RenderProcessGoneDetail
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.LinearLayout
import androidx.activity.ComponentActivity
import androidx.activity.OnBackPressedCallback
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.content.ContextCompat
import androidx.core.graphics.ColorUtils
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import kotlin.math.max

/**
 * Единственный экран: WebView с веб-частью приложения (https://localhost).
 * Разметка: [полоса статус-бара] / [WebView] / [полоса под системной навигацией и клавиатурой].
 * Полосы нужны потому, что на Android 15+ edge-to-edge принудительный: окно рисуется под системными панелями,
 * а цвет статус-бара задаём сами (ставит страница через LifeTrackerNative.setStatusBarColor).
 */
class MainActivity : ComponentActivity() {

    companion object {
        const val ACTION_DIAG = "com.app.lifetracker.DIAG"

        // До первого сообщения от страницы: theme_color и background_color из manifest.json.
        private const val DEFAULT_STATUS_COLOR = 0xFF8F7FB8.toInt()
        private const val PAGE_BG_COLOR = 0xFFF4F0F8.toInt()

        // Временное решение до шага 4: следим за <meta name="theme-color"> (его обновляет syncThemeColorMeta()
        // в my.js) и передаём цвет в мост. На шаге 4 заменяется прямым вызовом из my.js.
        private const val THEME_HOOK_JS = """
            (function(){
              if (window.__ltThemeHook) return;
              window.__ltThemeHook = true;
              function push(){
                var m = document.querySelector('meta[name="theme-color"]');
                if (m && m.content && window.LifeTrackerNative) { LifeTrackerNative.setStatusBarColor(m.content); }
              }
              push();
              new MutationObserver(push).observe(document.head, {childList:true, subtree:true, attributes:true, attributeFilter:['content']});
            })();
        """
    }

    private lateinit var server: WebAssetServer
    private lateinit var root: LinearLayout
    private lateinit var statusStrip: View
    private lateinit var navStrip: View
    private lateinit var webView: WebView

    /** true, пока загружена страница приложения (https://localhost); мост отвечает только в этом случае. */
    @Volatile
    var pageTrusted: Boolean = false
        private set

    private var fileCallback: ValueCallback<Array<Uri>>? = null
    private var pendingPermission: PermissionRequest? = null

    private val fileChooserLauncher =
        registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
            val callback = fileCallback
            fileCallback = null
            callback?.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(result.resultCode, result.data))
        }

    private val cameraPermissionLauncher =
        registerForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
            val request = pendingPermission
            pendingPermission = null
            if (request != null) {
                if (granted) request.grant(arrayOf(PermissionRequest.RESOURCE_VIDEO_CAPTURE)) else request.deny()
            }
        }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        WindowCompat.setDecorFitsSystemWindows(window, false)

        server = WebAssetServer(applicationContext)
        buildLayout()
        setContentView(root)
        setupWebView()

        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                if (webView.canGoBack()) {
                    webView.goBack()
                } else {
                    moveTaskToBack(true)
                }
            }
        })

        webView.loadUrl(if (intent?.action == ACTION_DIAG) WebAssetServer.DIAG_URL else WebAssetServer.START_URL)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        // Шаг 4: здесь же будет приём share target (ACTION_SEND / ACTION_SEND_MULTIPLE).
        if (intent.action == ACTION_DIAG) webView.loadUrl(WebAssetServer.DIAG_URL)
    }

    override fun onResume() {
        super.onResume()
        webView.onResume()
    }

    override fun onPause() {
        webView.onPause()
        super.onPause()
    }

    override fun onDestroy() {
        (webView.parent as? ViewGroup)?.removeView(webView)
        webView.destroy()
        super.onDestroy()
    }

    /** Вызывается мостом (в главном потоке): цвет полосы статус-бара и светлые/тёмные значки по яркости цвета. */
    fun applyStatusBarColor(color: Int) {
        statusStrip.setBackgroundColor(color)
        WindowCompat.getInsetsController(window, root).isAppearanceLightStatusBars =
            ColorUtils.calculateLuminance(color) > 0.5
    }

    private fun buildLayout() {
        statusStrip = View(this).apply { setBackgroundColor(DEFAULT_STATUS_COLOR) }
        navStrip = View(this).apply { setBackgroundColor(PAGE_BG_COLOR) }
        webView = WebView(this)

        root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(PAGE_BG_COLOR)
            addView(statusStrip, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0))
            addView(webView, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f))
            addView(navStrip, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0))
        }

        ViewCompat.setOnApplyWindowInsetsListener(root) { _, insets ->
            val bars = insets.getInsets(WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout())
            val ime = insets.getInsets(WindowInsetsCompat.Type.ime())
            root.setPadding(bars.left, 0, bars.right, 0)
            setStripHeight(statusStrip, bars.top)
            setStripHeight(navStrip, max(bars.bottom, ime.bottom))
            WindowInsetsCompat.CONSUMED
        }

        applyStatusBarColor(DEFAULT_STATUS_COLOR)
        WindowCompat.getInsetsController(window, root).isAppearanceLightNavigationBars = true
        ViewCompat.requestApplyInsets(root)
    }

    private fun setStripHeight(strip: View, height: Int) {
        val params = strip.layoutParams
        if (params.height != height) {
            params.height = height
            strip.layoutParams = params
        }
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun setupWebView() {
        if ((applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE) != 0) {
            WebView.setWebContentsDebuggingEnabled(true)
        }
        webView.setBackgroundColor(PAGE_BG_COLOR)

        val settings = webView.settings
        settings.javaScriptEnabled = true
        settings.domStorageEnabled = true
        settings.allowFileAccess = false
        settings.setSupportMultipleWindows(false)
        settings.javaScriptCanOpenWindowsAutomatically = true

        webView.addJavascriptInterface(NativeBridge(this), "LifeTrackerNative")

        webView.webViewClient = object : WebViewClient() {
            override fun shouldInterceptRequest(view: WebView?, request: WebResourceRequest?): WebResourceResponse? {
                return if (request == null) null else server.intercept(request.url)
            }

            override fun shouldOverrideUrlLoading(view: WebView?, request: WebResourceRequest?): Boolean {
                val uri = request?.url ?: return true
                if (server.isAppUrl(uri)) return false
                openExternal(uri)
                return true
            }

            override fun onPageStarted(view: WebView?, url: String?, favicon: Bitmap?) {
                pageTrusted = url != null && server.isAppUrl(Uri.parse(url))
            }

            override fun onPageFinished(view: WebView?, url: String?) {
                if (pageTrusted) view?.evaluateJavascript(THEME_HOOK_JS, null)
            }

            override fun onRenderProcessGone(view: WebView?, detail: RenderProcessGoneDetail?): Boolean {
                // Процесс рендера WebView упал или убит системой: пересоздаём Activity вместо вылета приложения.
                runOnUiThread { recreate() }
                return true
            }
        }

        webView.webChromeClient = object : WebChromeClient() {
            override fun onShowFileChooser(
                view: WebView?,
                callback: ValueCallback<Array<Uri>>?,
                params: FileChooserParams?
            ): Boolean {
                if (callback == null || params == null) return false
                fileCallback?.onReceiveValue(null)
                fileCallback = callback
                return try {
                    fileChooserLauncher.launch(params.createIntent())
                    true
                } catch (e: ActivityNotFoundException) {
                    fileCallback = null
                    callback.onReceiveValue(null)
                    false
                }
            }

            override fun onPermissionRequest(request: PermissionRequest?) {
                if (request == null) return
                val wantsCamera = request.resources.contains(PermissionRequest.RESOURCE_VIDEO_CAPTURE)
                if (!server.isAppUrl(request.origin) || !wantsCamera) {
                    request.deny()
                    return
                }
                val granted = ContextCompat.checkSelfPermission(
                    this@MainActivity, Manifest.permission.CAMERA
                ) == PackageManager.PERMISSION_GRANTED
                if (granted) {
                    request.grant(arrayOf(PermissionRequest.RESOURCE_VIDEO_CAPTURE))
                } else {
                    pendingPermission?.deny()
                    pendingPermission = request
                    cameraPermissionLauncher.launch(Manifest.permission.CAMERA)
                }
            }

            override fun onPermissionRequestCanceled(request: PermissionRequest?) {
                if (request != null && request == pendingPermission) pendingPermission = null
            }
        }
    }

    /** Внешние ссылки и диплинки (JW Library, YouTube, почта и т.п.) открываются во внешнем приложении. */
    private fun openExternal(uri: Uri) {
        val scheme = uri.scheme?.lowercase() ?: return
        try {
            val intent = if (scheme == "intent") {
                Intent.parseUri(uri.toString(), Intent.URI_INTENT_SCHEME).apply {
                    addCategory(Intent.CATEGORY_BROWSABLE)
                    component = null
                    selector = null
                }
            } else if (scheme in setOf("http", "https", "jwlibrary", "mailto", "tel", "market", "geo")) {
                Intent(Intent.ACTION_VIEW, uri)
            } else {
                return
            }
            startActivity(intent)
        } catch (e: Exception) {
            // Нет приложения для ссылки или ссылка некорректна: ничего не делаем.
        }
    }
}
