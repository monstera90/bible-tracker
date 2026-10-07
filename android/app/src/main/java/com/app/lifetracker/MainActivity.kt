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
import android.os.Handler
import android.os.Looper
import android.view.View
import android.view.ViewGroup
import android.widget.Toast
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
import androidx.core.view.WindowInsetsControllerCompat
import androidx.core.view.WindowInsetsCompat
import org.json.JSONObject
import java.io.File
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

        // Сторож live-update: если пробная версия веб-части не подтвердила запуск (appReady) за это время после
        // загрузки страницы, откатываемся сразу, а не при следующем запуске.
        private const val TRIAL_TIMEOUT_MS = 30_000L
    }

    private lateinit var server: WebAssetServer

    /** Live-update веб-части (скачивание, применение при запуске, откат). Мост обращается к нему из appReady. */
    lateinit var webUpdater: WebUpdater
        private set

    /** Сохранение файлов в «Загрузки» и подготовка файлов для «Поделиться» (шаг 4). Мост обращается к нему. */
    lateinit var fileSaver: FileSaver
        private set

    /** Полноэкранный режим включён страницей (шаг 4); восстанавливается при возврате фокуса окну. */
    @Volatile
    private var fullscreen = false

    private val handler = Handler(Looper.getMainLooper())
    private var trialWatchdogStarted = false
    private val trialWatchdog = Runnable {
        if (webUpdater.failTrial()) recreate()
    }
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

        fileSaver = FileSaver(applicationContext)
        fileSaver.cleanStale()
        SharedInbox.cleanStale(applicationContext)

        // Live-update: до загрузки страницы выбираем бандл (скачанный или встроенный) и применяем ожидающую версию.
        webUpdater = WebUpdater(File(filesDir, "web"), { readBuiltinVersion() })
        val bundle = try {
            webUpdater.startLaunch()
        } catch (e: Exception) {
            null
        }
        server = WebAssetServer(applicationContext, bundle)
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

        handleShareIntent(intent)
        webView.loadUrl(if (intent?.action == ACTION_DIAG) WebAssetServer.DIAG_URL else WebAssetServer.START_URL)
        webUpdater.checkInBackground()
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        // Шаг 4: «Поделиться» (ACTION_SEND / ACTION_SEND_MULTIPLE) при уже запущенном приложении.
        handleShareIntent(intent)
        if (intent.action == ACTION_DIAG) webView.loadUrl(WebAssetServer.DIAG_URL)
    }

    override fun onResume() {
        super.onResume()
        webView.onResume()
        // Возврат на передний план: проверка обновления веб-части (не чаще раза в 15 минут, внутри WebUpdater).
        webUpdater.checkInBackground()
    }

    override fun onPause() {
        webView.onPause()
        super.onPause()
    }

    override fun onDestroy() {
        handler.removeCallbacks(trialWatchdog)
        fileSaver.cancelAll()
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

    /**
     * Полноэкранный режим (шаг 4, замена requestFullscreen из PWA): скрыты строка состояния и системная навигация,
     * по свайпу с края панели показываются на время. Страница вызывает через LifeTrackerNative.setFullscreen.
     * Вырез экрана учтён в WindowInsets (полоса statusStrip остаётся высотой выреза и красится цветом шапки).
     */
    fun applyFullscreen(enabled: Boolean) {
        fullscreen = enabled
        val controller = WindowCompat.getInsetsController(window, root)
        if (enabled) {
            controller.systemBarsBehavior = WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
            controller.hide(WindowInsetsCompat.Type.systemBars())
        } else {
            controller.show(WindowInsetsCompat.Type.systemBars())
        }
        // Высота полосы зависит от флага fullscreen: пересчитываем сразу, не дожидаясь смены панелей.
        ViewCompat.requestApplyInsets(root)
    }

    override fun onWindowFocusChanged(hasFocus: Boolean) {
        super.onWindowFocusChanged(hasFocus)
        // После диалогов, шторки и возврата из других приложений система может вернуть панели: прячем снова.
        if (hasFocus && fullscreen) applyFullscreen(true)
    }

    /** Короткое сообщение внизу экрана (из любого потока). */
    fun toast(text: String) {
        runOnUiThread { Toast.makeText(this, text, Toast.LENGTH_LONG).show() }
    }

    /** Запуск системного меню (выбор приложения для «Поделиться») из любого потока. */
    fun startChooser(intent: Intent): Boolean {
        runOnUiThread {
            try {
                startActivity(intent)
            } catch (e: Exception) {
                toast("Не удалось открыть меню «Поделиться»")
            }
        }
        return true
    }

    /** Принимает файлы из системного «Поделиться» и сообщает странице, когда копия готова. */
    private fun handleShareIntent(source: Intent?) {
        SharedInbox.accept(
            this,
            source,
            onAdded = { notifyPageAboutShare() },
            onFailed = { toast("Не удалось принять файл") }
        )
    }

    private fun notifyPageAboutShare() {
        runOnUiThread {
            if (!isDestroyed && pageTrusted) {
                webView.evaluateJavascript("window.__ltOnNativeShare && window.__ltOnNativeShare()", null)
            }
        }
    }

    /**
     * Intent выбора файла для <input type="file">. Если accept содержит расширения (.zip, .fb2, .jwlibrary:
     * системный список типов по ним не строится) или пуст, показываем все файлы; один MIME-тип передаём как есть.
     */
    private fun buildFileChooserIntent(params: WebChromeClient.FileChooserParams): Intent {
        val tokens = params.acceptTypes.map { it.trim() }.filter { it.isNotEmpty() }
        val mimes = tokens.filter { it.contains('/') && !it.startsWith(".") }
        val intent = Intent(Intent.ACTION_GET_CONTENT).addCategory(Intent.CATEGORY_OPENABLE)
        if (tokens.isEmpty() || tokens.any { it.startsWith(".") }) {
            intent.type = "*/*"
        } else if (mimes.size == 1) {
            intent.type = mimes[0]
        } else {
            intent.type = "*/*"
            intent.putExtra(Intent.EXTRA_MIME_TYPES, mimes.toTypedArray())
        }
        if (params.mode == WebChromeClient.FileChooserParams.MODE_OPEN_MULTIPLE) {
            intent.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true)
        }
        return intent
    }

    /** Версия встроенного бандла (assets/www/version.json, его пишет tools/android_prepare.py). */
    private fun readBuiltinVersion(): String? = try {
        val text = assets.open("www/version.json").bufferedReader(Charsets.UTF_8).use { it.readText() }
        WebUpdater.normalizeVersion(JSONObject(text).optString("version", ""))
    } catch (e: Exception) {
        null
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
            // В полноэкранном режиме верхняя полоса не нужна совсем: иначе под вырезом камеры остаётся
            // цветная полоса высотой с вырез (режим выреза shortEdges позволяет странице занять и его).
            setStripHeight(statusStrip, if (fullscreen) 0 else bars.top)
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
                if (pageTrusted && !trialWatchdogStarted && url != null && url.startsWith(WebAssetServer.START_URL)) {
                    trialWatchdogStarted = true
                    if (webUpdater.hasTrial()) handler.postDelayed(trialWatchdog, TRIAL_TIMEOUT_MS)
                }
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
                    fileChooserLauncher.launch(buildFileChooserIntent(params))
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
