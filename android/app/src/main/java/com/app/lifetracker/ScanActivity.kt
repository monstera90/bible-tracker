package com.app.lifetracker
// Версия: 7.0 (31.10)
// Версия: 6.0 (26.10) — мост ScanBridge: musicHeadphones (подключены ли наушники; комбо с галочкой «Наушники обязательны»).
// Версия: 5.0 (26.10) — мост ScanBridge: musicPlayTrack / musicPlayFolder (QR «Комбинированный» из окна ярлыка включает трек или папку через MusicPlayer; приложение не открывается).
// Версия: 4.0 (24.10) — мост ScanBridge: setAlarm / cancelAlarm / getAlarms (скан кода будильника в окне ярлыка заводит будильник CardAlarms).
// Версия: 3.0 (24.10) — мост ScanBridge: startHiddenTimer (скан кода скрытого таймера из окна ярлыка: без острова и уведомления «идёт»).
// Версия: 2.0 (21.10) — мост ScanBridge: cancelTimer («Стоп» на карточке в окне ярлыка).
// Версия: 1.1 (17.10) — мост ScanBridge: startTimer / getTimers (скан карточки-таймера запускает таймер CardTimers без открытия приложения).
// Версия: 1.0 (16.10)

import android.Manifest
import android.annotation.SuppressLint
import android.content.Intent
import android.content.pm.ApplicationInfo
import android.content.pm.PackageManager
import android.content.res.Configuration
import android.graphics.Bitmap
import android.graphics.Color
import android.net.Uri
import android.os.Bundle
import android.webkit.JavascriptInterface
import android.webkit.PermissionRequest
import android.webkit.RenderProcessGoneDetail
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout
import androidx.activity.ComponentActivity
import androidx.activity.OnBackPressedCallback
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.content.ContextCompat
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import org.json.JSONObject
import java.io.File

/**
 * Ярлык «Сканировать QR-код» (долгое нажатие на иконку приложения, res/xml/shortcuts.xml): отдельное окно БЕЗ запуска
 * основного приложения (свой task, прозрачная тема ScanTheme — как у QuickTaskActivity). Внутри — своя WebView с
 * страницей scan.html: сначала сканер на весь экран, затем карточка на прозрачном фоне поверх рабочего стола.
 * Страница того же origin (https://localhost), поэтому читает те же карточки из localStorage (itemCards_v1).
 *
 * Закрытие карточки, тап мимо неё и «Назад» возвращают на рабочий стол. Карточка-заметка (и «Создать карточку с этим
 * кодом») открывают основное приложение: MainActivity с ACTION_OPEN_CARD. Мост страницы — ScanBridge
 * (window.LifeTrackerScan): openInApp, openUrl, close.
 */
class ScanActivity : ComponentActivity() {

    companion object {
        private val CARD_ID_RE = Regex("^[A-Za-z0-9]{4,32}$")
        const val SCAN_URL = WebAssetServer.ORIGIN + "/scan.html"
    }

    private lateinit var server: WebAssetServer
    private lateinit var root: FrameLayout
    private lateinit var webView: WebView

    private var pendingPermission: PermissionRequest? = null

    /** true, пока висит системный запрос разрешения камеры: окно не закрываем при уходе на передний план диалога. */
    private var permissionDialogOpen = false

    /** Последние отступы системных панелей (CSS px): страница отодвигает кнопки от жестовой панели. */
    private var insetTopCss = 0
    private var insetBottomCss = 0

    private val cameraPermissionLauncher =
        registerForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
            permissionDialogOpen = false
            val request = pendingPermission
            pendingPermission = null
            if (request != null) {
                if (granted) request.grant(arrayOf(PermissionRequest.RESOURCE_VIDEO_CAPTURE)) else request.deny()
            }
        }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        // Окно рисуется под системными панелями (сканер на весь экран); отступы передаём странице.
        WindowCompat.setDecorFitsSystemWindows(window, false)
        window.statusBarColor = Color.TRANSPARENT
        window.navigationBarColor = Color.TRANSPARENT

        // Бандл веб-части: только чтение (см. WebUpdater.activeBundleReadOnly), состояние обновлений не трогаем.
        val updater = WebUpdater(File(filesDir, "web"), { readBuiltinVersion() }, false)
        val bundle = try {
            updater.activeBundleReadOnly()
        } catch (e: Exception) {
            null
        }
        server = WebAssetServer(applicationContext, bundle)

        webView = WebView(this)
        webView.setBackgroundColor(Color.TRANSPARENT)
        root = FrameLayout(this)
        root.setBackgroundColor(Color.TRANSPARENT)
        root.addView(webView, FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT))
        setContentView(root)

        ViewCompat.setOnApplyWindowInsetsListener(root) { _, insets ->
            val bars = insets.getInsets(WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout())
            val d = resources.displayMetrics.density
            insetTopCss = Math.round(bars.top / d)
            insetBottomCss = Math.round(bars.bottom / d)
            pushInsets()
            WindowInsetsCompat.CONSUMED
        }

        setupWebView()

        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                finishAndRemoveTask()
            }
        })

        webView.loadUrl(SCAN_URL)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        // Ярлык нажат повторно, пока окно открыто: перезапускаем сканер.
        webView.loadUrl(SCAN_URL)
    }

    override fun onConfigurationChanged(newConfig: Configuration) {
        super.onConfigurationChanged(newConfig)
    }

    override fun onStop() {
        super.onStop()
        // Окно ушло с экрана (кнопка «Домой», звонок): невидимое окно в системе не оставляем.
        if (!isFinishing && !isChangingConfigurations && !permissionDialogOpen) {
            finishAndRemoveTask()
        }
    }

    override fun onDestroy() {
        try {
            webView.stopLoading()
            webView.destroy()
        } catch (e: Exception) {
            // окно закрывается
        }
        super.onDestroy()
    }

    private fun pushInsets() {
        if (!::webView.isInitialized) return
        webView.evaluateJavascript(
            "document.documentElement.style.setProperty('--safe-top','${insetTopCss}px');" +
                "document.documentElement.style.setProperty('--safe-bottom','${insetBottomCss}px');",
            null
        )
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun setupWebView() {
        if ((applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE) != 0) {
            WebView.setWebContentsDebuggingEnabled(true)
        }
        val settings = webView.settings
        settings.javaScriptEnabled = true
        settings.domStorageEnabled = true
        settings.allowFileAccess = false
        settings.setSupportMultipleWindows(false)
        settings.mediaPlaybackRequiresUserGesture = false

        webView.addJavascriptInterface(ScanBridge(), "LifeTrackerScan")

        webView.webViewClient = object : WebViewClient() {
            override fun shouldInterceptRequest(view: WebView?, request: WebResourceRequest?): WebResourceResponse? {
                return if (request == null) null else server.intercept(request.url)
            }

            // Это окно грузит только свою страницу: любые переходы наружу отбрасываем (внешние ссылки открывает мост).
            override fun shouldOverrideUrlLoading(view: WebView?, request: WebResourceRequest?): Boolean =
                !server.isAppUrl(request?.url)

            @Suppress("OVERRIDE_DEPRECATION", "DEPRECATION")
            override fun shouldOverrideUrlLoading(view: WebView?, url: String?): Boolean =
                url == null || !server.isAppUrl(Uri.parse(url))

            override fun onPageStarted(view: WebView?, url: String?, favicon: Bitmap?) {
                pushInsets()
            }

            override fun onPageFinished(view: WebView?, url: String?) {
                pushInsets()
            }

            override fun onRenderProcessGone(view: WebView?, detail: RenderProcessGoneDetail?): Boolean {
                runOnUiThread { finishAndRemoveTask() }
                return true
            }
        }

        webView.webChromeClient = object : WebChromeClient() {
            override fun onPermissionRequest(request: PermissionRequest?) {
                if (request == null) return
                val wantsCamera = request.resources.contains(PermissionRequest.RESOURCE_VIDEO_CAPTURE)
                if (!server.isAppUrl(request.origin) || !wantsCamera) {
                    request.deny()
                    return
                }
                val granted = ContextCompat.checkSelfPermission(
                    this@ScanActivity, Manifest.permission.CAMERA
                ) == PackageManager.PERMISSION_GRANTED
                if (granted) {
                    request.grant(arrayOf(PermissionRequest.RESOURCE_VIDEO_CAPTURE))
                } else {
                    pendingPermission?.deny()
                    pendingPermission = request
                    permissionDialogOpen = true
                    cameraPermissionLauncher.launch(Manifest.permission.CAMERA)
                }
            }

            override fun onPermissionRequestCanceled(request: PermissionRequest?) {
                if (request != null && request == pendingPermission) {
                    pendingPermission = null
                    permissionDialogOpen = false
                }
            }
        }
    }

    private fun readBuiltinVersion(): String? = try {
        val text = assets.open("www/version.json").bufferedReader(Charsets.UTF_8).use { it.readText() }
        WebUpdater.normalizeVersion(JSONObject(text).optString("version", ""))
    } catch (e: Exception) {
        null
    }

    /** Мост страницы scan.html (window.LifeTrackerScan). Вызывается из потока WebView — действия переносим в главный поток. */
    inner class ScanBridge {

        /** Открыть основное приложение внутри карточки: mode "note" (заметка карточки) или "create" (создать с этим id). */
        @JavascriptInterface
        fun openInApp(id: String?, mode: String?) {
            if (id == null || !CARD_ID_RE.matches(id)) return
            val m = if (mode == "create") "create" else "note"
            runOnUiThread {
                val intent = Intent(this@ScanActivity, MainActivity::class.java).apply {
                    action = MainActivity.ACTION_OPEN_CARD
                    putExtra(MainActivity.EXTRA_CARD_ID, id)
                    putExtra(MainActivity.EXTRA_CARD_MODE, m)
                    addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                }
                try {
                    startActivity(intent)
                } catch (e: Exception) {
                    // приложение не запустилось — просто закрываем окно
                }
                finishAndRemoveTask()
            }
        }

        /** Чужой QR со ссылкой: открывается во внешнем приложении (браузер по умолчанию). Только http и https. */
        @JavascriptInterface
        fun openUrl(url: String?) {
            if (url == null) return
            val uri = try {
                Uri.parse(url)
            } catch (e: Exception) {
                return
            }
            val scheme = uri.scheme?.lowercase()
            if (scheme != "http" && scheme != "https") return
            runOnUiThread {
                try {
                    startActivity(Intent(Intent.ACTION_VIEW, uri).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
                } catch (e: Exception) {
                    // нет приложения для ссылки
                }
                finishAndRemoveTask()
            }
        }

        /** Скан карточки-таймера: запуск (или перезапуск) таймера прямо отсюда, приложение не открывается. */
        @JavascriptInterface
        fun startTimer(id: String?, title: String?, seconds: Int): Boolean {
            if (id == null || !CARD_ID_RE.matches(id)) return false
            return CardTimers.start(applicationContext, id, title ?: "", seconds.toLong())
        }

        /** Скан скрытого таймера: как startTimer, но таймер не показывается в острове, плашке и шторке (только конец). */
        @JavascriptInterface
        fun startHiddenTimer(id: String?, title: String?, seconds: Int): Boolean {
            if (id == null || !CARD_ID_RE.matches(id)) return false
            return CardTimers.start(applicationContext, id, title ?: "", seconds.toLong(), true)
        }

        /** Скан кода будильника: заводит будильник на ближайшее ЧЧ:ММ (приложение не открывается). Возвращает момент первого звонка или 0. */
        @JavascriptInterface
        fun setAlarm(id: String?, title: String?, hour: Int, minute: Int, everyMin: Int, times: Int): Long {
            if (id == null || !CARD_ID_RE.matches(id)) return 0L
            return CardAlarms.set(applicationContext, id, title ?: "", hour, minute, everyMin, times)
        }

        /** «Выкл.» на карточке-будильнике. */
        @JavascriptInterface
        fun cancelAlarm(id: String?) {
            if (id == null || !CARD_ID_RE.matches(id)) return
            CardAlarms.cancel(applicationContext, id)
        }

        /** Заведённые будильники (тот же JSON, что у NativeBridge.getCardAlarms). */
        @JavascriptInterface
        fun getAlarms(): String = CardAlarms.listJson(applicationContext)

        /** «Стоп» на карточке-таймере: отмена таймера (и вибрации конца), как cancelCardTimer в основном мосте. */
        @JavascriptInterface
        fun cancelTimer(id: String?) {
            if (id == null || !CARD_ID_RE.matches(id)) return
            CardTimers.cancel(applicationContext, id)
        }

        /** QR «Комбинированный»: начало запуска действий — всё, что стартует до comboGroupEnd, становится одной группой (общие пауза и стоп). */
        @JavascriptInterface
        fun comboGroupBegin() {
            ComboGroup.begin(applicationContext)
        }

        /** Конец запуска. [workout]: "none" / "expect" (тренировку начнёт приложение) / "now". */
        @JavascriptInterface
        fun comboGroupEnd(workout: String?) {
            ComboGroup.end(applicationContext, workout)
        }

        /** QR «Комбинированный»: играть один трек по id документа (папка с музыкой должна быть выбрана в приложении). */
        @JavascriptInterface
        fun musicPlayTrack(trackId: String?, loop: Boolean, volumePct: Int): Boolean {
            if (trackId.isNullOrEmpty()) return false
            return MusicPlayer.playSingle(applicationContext, trackId, loop, volumePct)
        }

        /** Подключены ли наушники (проводные, USB, Bluetooth). */
        @JavascriptInterface
        fun musicHeadphones(): Boolean = MusicPlayer.headphonesConnected(applicationContext)

        /** QR «Комбинированный»: играть папку по id (пустой — вся выбранная папка). */
        @JavascriptInterface
        fun musicPlayFolder(folderId: String?, loop: Boolean, volumePct: Int): Boolean =
            MusicPlayer.playFolder(applicationContext, folderId, loop, volumePct)

        /** Снимок таймеров (тот же JSON, что у NativeBridge.getCardTimers) — показать оставшееся время на карточке. */
        @JavascriptInterface
        fun getTimers(): String = CardTimers.listJson(applicationContext)

        @JavascriptInterface
        fun close() {
            runOnUiThread { finishAndRemoveTask() }
        }
    }
}
