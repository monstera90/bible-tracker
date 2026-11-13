package com.app.lifetracker
// Версия: 11.0 (13.11)
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
import android.os.Handler
import android.os.Looper
import android.view.MotionEvent
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
        /** Нажатие на карточку виджета «Стопка QR-карточек»: extra `code` — текст QR, `tok` — ключ установки (QrWidgets.token). */
        const val ACTION_SCAN_CODE = "com.app.lifetracker.SCAN_CODE"

        /**
         * Карточка-привычка в виджете (extra `habit`): окно без страницы ждёт второго нажатия столько мс. Не пришло — одно нажатие
         * (открывается карта дней в приложении), пришло — двойное (отметка на сегодня, карточка уходит из виджета до полуночи).
         */
        const val HABIT_DOUBLE_MS = 400L
    }

    private lateinit var server: WebAssetServer
    private lateinit var root: FrameLayout
    private lateinit var webView: WebView

    private var pendingPermission: PermissionRequest? = null

    /** Код из виджета: страница забирает его один раз (`takeInitialCode`) и ведёт себя, как после сканирования этого QR. */
    private var initialCode: String = ""

    /**
     * Нажатие на кнопку 1…10 карточки «Как тренировка?» в виджете (extra `rpe`, ключ `tok` тот же): оценка уходит в [QrRpe.answer], окно не нужно.
     * true — это был такой запрос (ответ принят или нет — окно сканера открывать не надо).
     */
    private fun handleRpe(i: Intent?): Boolean {
        if (i == null || i.action != ACTION_SCAN_CODE || !i.hasExtra("rpe")) return false
        if (QrWidgets.tokenOk(this, i.getStringExtra("tok"))) {
            try {
                QrRpe.answer(applicationContext, i.getIntExtra("rpe", 0))
            } catch (e: Exception) {
                // оценка не сохранилась — карточка останется, можно нажать ещё раз
            }
        }
        return true
    }

    /** Ключ карточки-привычки, если это нажатие на неё в виджете (extra `habit`, тот же `tok`); иначе null. */
    private fun habitKeyOf(i: Intent?): String? {
        if (i == null || i.action != ACTION_SCAN_CODE || !i.getBooleanExtra("habit", false)) return null
        if (!QrWidgets.tokenOk(this, i.getStringExtra("tok"))) return null
        val key = i.getStringExtra("key") ?: return null
        return if (CARD_ID_RE.matches(key)) key else null
    }

    /** Id задачи, если это нажатие на карточку задачи в виджете (extra `task`, тот же `tok`); иначе null. */
    private fun taskIdOf(i: Intent?): String? {
        if (i == null || i.action != ACTION_SCAN_CODE || !i.hasExtra("task")) return null
        if (!QrWidgets.tokenOk(this, i.getStringExtra("tok"))) return null
        val id = i.getStringExtra("task") ?: return null
        return if (id.isNotEmpty() && id.length <= 80) id else null
    }

    private var taskWaiting = false
    private var taskId = ""
    private val taskSingleRun = Runnable { taskSingle() }

    /** Первое нажатие на карточку задачи: окно прозрачное, ждём второго (как у привычки). */
    private fun beginTaskWait(id: String) {
        if (taskWaiting && taskId == id) {
            taskDouble()
            return
        }
        taskId = id
        taskWaiting = true
        habitHandler.removeCallbacks(taskSingleRun)
        habitHandler.postDelayed(taskSingleRun, HABIT_DOUBLE_MS)
    }

    /** Второго нажатия не было: одно нажатие на задачу ничего не делает — окно закрывается. */
    private fun taskSingle() {
        if (!taskWaiting) return
        taskWaiting = false
        finishAndRemoveTask()
        overridePendingTransition(0, 0)
    }

    /** Двойное нажатие: задача отмечается выполненной (очередь оболочки → страница), карточка уходит из стопки. */
    private fun taskDouble() {
        if (!taskWaiting) return
        taskWaiting = false
        habitHandler.removeCallbacks(taskSingleRun)
        try {
            QrWidgets.completeTask(applicationContext, taskId)
        } catch (e: Exception) {
            // виджет не должен ронять окно
        }
        finishAndRemoveTask()
        overridePendingTransition(0, 0)
    }

    private val habitHandler = Handler(Looper.getMainLooper())
    private val habitSingleRun = Runnable { habitSingle() }
    private var habitWaiting = false
    private var habitKey = ""

    /** Первое нажатие на привычку: окно прозрачное, страницы нет — ждём второго нажатия (его принимает [dispatchTouchEvent] или новый intent виджета). */
    private fun beginHabitWait(key: String) {
        if (habitWaiting && habitKey == key) {
            habitDouble()
            return
        }
        habitKey = key
        habitWaiting = true
        habitHandler.removeCallbacks(habitSingleRun)
        habitHandler.postDelayed(habitSingleRun, HABIT_DOUBLE_MS)
    }

    /** Второго нажатия не было: приложение открывается на карте дней привычки (окно запущено нами, фоновых запретов нет). */
    private fun habitSingle() {
        if (!habitWaiting) return
        habitWaiting = false
        val intent = Intent(this, MainActivity::class.java).apply {
            action = MainActivity.ACTION_OPEN_CARD
            putExtra(MainActivity.EXTRA_CARD_ID, habitKey)
            putExtra(MainActivity.EXTRA_CARD_MODE, "habitmap")
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        }
        try {
            startActivity(intent)
        } catch (e: Exception) {
            // приложение не запустилось — просто закрываем окно
        }
        finishAndRemoveTask()
    }

    /** Двойное нажатие: карточка уходит из стопки до полуночи, страница молча отмечает сегодня (`habitmark:<id>`) и закрывает окно. */
    private fun habitDouble() {
        if (!habitWaiting) return
        habitWaiting = false
        habitHandler.removeCallbacks(habitSingleRun)
        QrWidgets.hideHabitToday(applicationContext, habitKey)
        initWeb()
        initialCode = "habitmark:" + habitKey
        webView.loadUrl(SCAN_URL)
        habitHandler.postDelayed({ finishAndRemoveTask() }, 5000L) // страница закрывает окно сама; это запас на случай сбоя
    }

    override fun dispatchTouchEvent(ev: MotionEvent): Boolean {
        if (taskWaiting) {
            if (ev.actionMasked == MotionEvent.ACTION_DOWN) taskDouble()
            return true
        }
        if (habitWaiting) {
            if (ev.actionMasked == MotionEvent.ACTION_DOWN) habitDouble()
            return true
        }
        return super.dispatchTouchEvent(ev)
    }

    private fun readCode(i: Intent?) {
        initialCode = ""
        if (i != null && i.action == ACTION_SCAN_CODE && QrWidgets.tokenOk(this, i.getStringExtra("tok"))) {
            initialCode = (i.getStringExtra("code") ?: "").take(2000)
            // нажатие на карточку в виджете = её действие сработало: «после срабатывания» (скрыть / в конец) применяет QrWidgets
            val key = i.getStringExtra("key") ?: ""
            if (key.isNotEmpty()) QrWidgets.onCardFired(applicationContext, key)
        }
    }

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

        // Кнопка оценки с карточки «Как тренировка?»: без окна — сохранили и сразу закрылись (webView и сервер не создаются)
        if (handleRpe(intent)) {
            finishAndRemoveTask()
            overridePendingTransition(0, 0)
            return
        }

        // Окно рисуется под системными панелями (сканер на весь экран); отступы передаём странице.
        WindowCompat.setDecorFitsSystemWindows(window, false)
        window.statusBarColor = Color.TRANSPARENT
        window.navigationBarColor = Color.TRANSPARENT

        root = FrameLayout(this)
        root.setBackgroundColor(Color.TRANSPARENT)
        setContentView(root)

        ViewCompat.setOnApplyWindowInsetsListener(root) { _, insets ->
            val bars = insets.getInsets(WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout())
            val d = resources.displayMetrics.density
            insetTopCss = Math.round(bars.top / d)
            insetBottomCss = Math.round(bars.bottom / d)
            pushInsets()
            WindowInsetsCompat.CONSUMED
        }

        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                finishAndRemoveTask()
            }
        })

        // Нажатие на карточку задачи в виджете: страницу не строим, ждём второго нажатия
        val task = taskIdOf(intent)
        if (task != null) {
            beginTaskWait(task)
            return
        }

        // Нажатие на карточку-привычку в виджете: страницу не строим (WebView задержал бы окно), сначала ждём второго нажатия
        val habit = habitKeyOf(intent)
        if (habit != null) {
            beginHabitWait(habit)
            return
        }

        initWeb()
        readCode(intent)
        webView.loadUrl(SCAN_URL)
    }

    /** Страница со сканером (один раз): сервер ресурсов, WebView, мост. */
    @SuppressLint("SetJavaScriptEnabled")
    private fun initWeb() {
        if (::webView.isInitialized) return
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
        root.addView(webView, FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT))
        pushInsets()

        setupWebView()
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        if (handleRpe(intent)) return // окно сканера уже открыто и остаётся как было
        val task = taskIdOf(intent)
        if (task != null) {
            beginTaskWait(task)
            return
        }
        // Привычка в виджете: второе нажатие, пока окно ждёт, — двойное; иначе новое ожидание
        val habit = habitKeyOf(intent)
        if (habit != null) {
            beginHabitWait(habit)
            return
        }
        // Ярлык нажат повторно, пока окно открыто: перезапускаем сканер (или показываем код карточки из виджета).
        habitWaiting = false
        taskWaiting = false
        habitHandler.removeCallbacks(habitSingleRun)
        initWeb()
        readCode(intent)
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
        habitHandler.removeCallbacksAndMessages(null)
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

        /** Код QR, с которым окно открыто из виджета (один раз; пусто — обычный сканер). */
        @JavascriptInterface
        fun takeInitialCode(): String {
            val c = initialCode
            initialCode = ""
            return c
        }

        @JavascriptInterface
        fun close() {
            runOnUiThread { finishAndRemoveTask() }
        }
    }
}
