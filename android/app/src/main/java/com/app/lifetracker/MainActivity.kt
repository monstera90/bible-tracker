package com.app.lifetracker

import android.Manifest
import android.annotation.SuppressLint
import android.content.ActivityNotFoundException
import android.content.ComponentName
import android.content.Intent
import android.content.pm.ApplicationInfo
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.net.Uri
import android.provider.Settings
import android.os.Build
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
import kotlin.math.roundToInt

/**
 * Единственный экран: WebView с веб-частью приложения (https://localhost).
 * Разметка: [полоса статус-бара] / [WebView] / [полоса под системной навигацией и клавиатурой].
 * Полосы нужны потому, что на Android 15+ edge-to-edge принудительный: окно рисуется под системными панелями,
 * а цвет статус-бара задаём сами (ставит страница через LifeTrackerNative.setStatusBarColor).
 */
class MainActivity : ComponentActivity() {

    companion object {
        const val ACTION_DIAG = "com.app.lifetracker.DIAG"

        // Шаг 5: клик по уведомлению (NotifyHelper.openIntent) открывает приложение с этими данными.
        const val ACTION_OPEN_TASK = "com.app.lifetracker.OPEN_TASK"
        const val EXTRA_TASK_ID = "taskId"
        const val EXTRA_KIND = "kind"

        /** Запущенная Activity (или null): получатель кнопок уведомления сообщает через неё странице о новом действии. */
        @Volatile
        var instance: MainActivity? = null

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

    /**
     * Клавиатура «поверх страницы» (аналог navigator.virtualKeyboard.overlaysContent из Chrome). Включает страница на время
     * ввода в задачу/комментарий/заметку (native-shell.js, setKeyboardOverlay): WebView при этом НЕ сжимается клавиатурой,
     * вкладки остаются на местах, а страница сама поднимает текст над клавиатурой (initTaskKeyboardLift в my.js) по высоте,
     * которую сообщает оболочка (window.__ltOnKeyboard). Выключено — как раньше: WebView сжимается до верха клавиатуры.
     */
    @Volatile
    private var keyboardOverlay = false

    /** Последняя высота клавиатуры, отправленная странице (CSS-пиксели), и отложенная отправка (склейка кадров анимации). */
    private var sentKeyboardCssPx = 0
    private var pendingKeyboardCssPx = 0
    private val keyboardPush = Runnable { pushKeyboardHeight(pendingKeyboardCssPx) }

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

    // Шаг 5: системный запрос разрешения на уведомления (Android 13+); ответ уходит странице.
    private val notifyPermissionLauncher =
        registerForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
            runOnUiThread {
                if (!isDestroyed && pageTrusted) {
                    webView.evaluateJavascript("window.__ltOnNotifyPermission && window.__ltOnNotifyPermission($granted)", null)
                }
            }
        }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        instance = this
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

        handleNotifyIntent(intent)
        handleShareIntent(intent)
        webView.loadUrl(if (intent?.action == ACTION_DIAG) WebAssetServer.DIAG_URL else WebAssetServer.START_URL)
        webUpdater.checkInBackground()
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        // Шаг 5: клик по уведомлению при уже запущенном приложении.
        handleNotifyIntent(intent)
        // Шаг 4: «Поделиться» (ACTION_SEND / ACTION_SEND_MULTIPLE) при уже запущенном приложении.
        handleShareIntent(intent)
        if (intent.action == ACTION_DIAG) webView.loadUrl(WebAssetServer.DIAG_URL)
    }

    override fun onResume() {
        super.onResume()
        webView.onResume()
        // Шаг 5: пока приложение на экране, напоминания и общие задачи показывает страница, а не оболочка.
        NotifyStore.appForeground = true
        // Подстраховка: будильники пропадают после «Остановить» в настройках, ставим заново из сохранённых данных.
        try {
            ReminderScheduler.scheduleNext(applicationContext)
            GroupWatcher.scheduleNextPoll(applicationContext)
        } catch (e: Exception) {
            // уведомления остаются на странице; приложение работает
        }
        // Возврат на передний план: проверка обновления веб-части (не чаще раза в 15 минут, внутри WebUpdater).
        webUpdater.checkInBackground()
    }

    override fun onPause() {
        NotifyStore.appForeground = false
        // Сворачивание: страница успевает сохранить автозакладку и позицию чтения, пока WebView ещё не на паузе
        // (visibilitychange в WebView в этот момент может не прийти).
        if (pageTrusted) {
            webView.evaluateJavascript("window.__ltOnAppPause && window.__ltOnAppPause()", null)
        }
        webView.onPause()
        super.onPause()
    }

    override fun onDestroy() {
        if (instance === this) instance = null
        NotifyStore.appForeground = false
        handler.removeCallbacks(trialWatchdog)
        handler.removeCallbacks(keyboardPush)
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

    /**
     * Вызывается мостом (в главном потоке): страница включает/выключает режим «клавиатура поверх страницы».
     * Нижняя полоса пересчитывается сразу: при включении она перестаёт расти вместе с клавиатурой.
     */
    fun applyKeyboardOverlay(enabled: Boolean) {
        if (keyboardOverlay == enabled) return
        keyboardOverlay = enabled
        ViewCompat.requestApplyInsets(root)
    }

    /** Отправляет странице высоту клавиатуры над нижним краем WebView (CSS-пиксели; 0 — клавиатуры нет или она сжимает WebView). */
    private fun pushKeyboardHeight(cssPx: Int) {
        if (cssPx == sentKeyboardCssPx) return
        sentKeyboardCssPx = cssPx
        if (isDestroyed || !pageTrusted) return
        webView.evaluateJavascript("window.__ltOnKeyboard && window.__ltOnKeyboard($cssPx)", null)
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

    // ===== Шаг 5: уведомления =====

    /** Системный запрос разрешения на уведомления (Android 13+); на старых версиях и при выданном разрешении отвечает сразу. */
    fun requestNotifyPermission() {
        val needed = Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
            ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
        if (needed) {
            try {
                notifyPermissionLauncher.launch(Manifest.permission.POST_NOTIFICATIONS)
                return
            } catch (e: Exception) {
                // запрос не открылся: сообщаем страницей текущее состояние ниже
            }
        }
        val granted = NotifyHelper.enabled(applicationContext)
        webView.evaluateJavascript("window.__ltOnNotifyPermission && window.__ltOnNotifyPermission($granted)", null)
    }

    /** Настройки уведомлений приложения (если разрешение выключено и системный запрос уже не показывается). */
    fun openNotifySettings() {
        try {
            startActivity(
                Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS)
                    .putExtra(Settings.EXTRA_APP_PACKAGE, packageName)
            )
        } catch (e: Exception) {
            openAppDetails()
        }
    }

    /**
     * Настройки работы в фоне. Xiaomi/HyperOS: экран «Автозапуск»; иначе список оптимизации батареи; запасной вариант —
     * сведения о приложении. Что включить, написано в странице диагностики (автозапуск, «Нет ограничений»).
     */
    fun openBackgroundSettings() {
        val candidates = ArrayList<Intent>()
        if (Build.MANUFACTURER.equals("xiaomi", true) || Build.MANUFACTURER.equals("redmi", true) ||
            Build.MANUFACTURER.equals("poco", true)
        ) {
            candidates.add(
                Intent().setComponent(
                    ComponentName("com.miui.securitycenter", "com.miui.permcenter.autostart.AutoStartManagementActivity")
                )
            )
        }
        candidates.add(Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS))
        for (candidate in candidates) {
            try {
                startActivity(candidate)
                return
            } catch (e: Exception) {
                // этого экрана на устройстве нет — пробуем следующий
            }
        }
        openAppDetails()
    }

    private fun openAppDetails() {
        try {
            startActivity(
                Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.fromParts("package", packageName, null))
            )
        } catch (e: Exception) {
            toast("Не удалось открыть настройки")
        }
    }

    /** Клик по уведомлению: id задачи ставится в очередь действий страницы (она откроет задачу и подсветит строку). */
    private fun handleNotifyIntent(source: Intent?) {
        if (source == null || source.action != ACTION_OPEN_TASK) return
        val id = source.getStringExtra(EXTRA_TASK_ID) ?: return
        val kind = source.getStringExtra(EXTRA_KIND) ?: ""
        source.action = null // повторная обработка того же Intent (пересоздание Activity) не нужна
        NotifyStore.addAction(applicationContext, id, "", kind, 0L)
        notifyPageAboutAction()
    }

    /** Сообщает странице, что в очереди появились действия из уведомлений (она заберёт их takeNotifyActions). */
    fun notifyPageAboutAction() {
        runOnUiThread {
            if (!isDestroyed && pageTrusted) {
                webView.evaluateJavascript("window.__ltOnNativeAction && window.__ltOnNativeAction()", null)
            }
        }
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
            // Обычный режим: WebView сжимается до верха клавиатуры. Режим «поверх страницы» (вводит текст задачи/заметки):
            // WebView не сжимается, клавиатура перекрывает его низ, а страница получает её высоту и поднимает текст сама.
            val overlay = keyboardOverlay
            setStripHeight(navStrip, if (overlay) bars.bottom else max(bars.bottom, ime.bottom))
            val kbPx = if (overlay) max(0, ime.bottom - bars.bottom) else 0
            val kbCss = (kbPx / resources.displayMetrics.density).roundToInt()
            if (kbCss != pendingKeyboardCssPx) {
                pendingKeyboardCssPx = kbCss
                // Анимация клавиатуры даёт значение на каждый кадр: отправляем итоговое, когда оно перестало меняться.
                handler.removeCallbacks(keyboardPush)
                handler.postDelayed(keyboardPush, if (kbCss == 0) 0L else 40L)
            }
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
                // Страница загружается заново: её состояние клавиатуры сброшено (высота 0, режим «поверх» выключен).
                handler.removeCallbacks(keyboardPush)
                pendingKeyboardCssPx = 0
                sentKeyboardCssPx = 0
                if (keyboardOverlay) {
                    keyboardOverlay = false
                    ViewCompat.requestApplyInsets(root)
                }
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
