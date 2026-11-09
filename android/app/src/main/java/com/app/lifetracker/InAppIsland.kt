package com.app.lifetracker
// Версия: 17.2 (09.11)

import android.app.Activity
import android.app.AlertDialog
import android.content.Context
import android.content.Intent
import android.view.Surface
import android.graphics.PixelFormat
import android.net.Uri
import android.os.Build
import android.provider.Settings
import android.view.WindowManager
import android.graphics.Color
import android.graphics.Rect
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.os.Handler
import android.os.Looper
import android.text.TextUtils
import android.util.TypedValue
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.view.MotionEvent
import android.view.ViewConfiguration
import android.view.Choreographer
import android.os.SystemClock
import android.view.animation.AccelerateDecelerateInterpolator
import android.view.animation.OvershootInterpolator
import android.widget.FrameLayout
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.TextView
import kotlin.math.abs
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Paint

// Виды занятий на плашке; порядок — приоритет (первое — в капсуле, остальные — кружками справа от неё).
private const val K_POMO = 0
private const val K_TIMER = 1
private const val K_SW = 2
private const val K_MUSIC = 3
private const val K_VIDEO = 4
private const val K_WORKOUT = 5

/** Одно занятие на плашке: всё, что нужно нарисовать свёрнутую капсулу, кружок и раскрытую карточку. */
private class Item(val key: String, val kind: Int) {
    var iconKey = "" // меняется, когда значок надо перерисовать
    var iconFn: (Int) -> Bitmap = { XiaomiIsland.iconBitmap(0, it) }
    var time = "" // справа на плашке (пусто — только значок)
    var samples: List<String> = emptyList() // образцы ширины времени (цифры — «8»)
    var name = "" // название слева на плашке одного занятия (пусто — без названия)
    var big = "" // главная строка раскрытой карточки
    var sub = "" // вторая строка
    var btnKey = ""
    var btnFn: (() -> Bitmap)? = null
    var onToggle: (() -> Unit)? = null
    var onStop: (() -> Unit)? = null

    /** Есть карточка, которая листается смахиванием: у всех занятий. Нажатием на капсулу раскрываются не все: помодоро открывает вкладку, секундомер ставится на паузу ([activate]). */
    val expandable: Boolean get() = true

    /** Карточка с крупными цифрами (таймер, помодоро, секундомер, тренировка); у музыки и видео — название одной строкой. */
    val digitCard: Boolean get() = kind != K_MUSIC && kind != K_VIDEO
}

class InAppIsland private constructor(private val appCtx: Context) {

    companion object {
        private const val ASK_EVERY_MS = 12L * 60L * 60L * 1000L // как часто повторно просить разрешение «Поверх других приложений»
        private const val IDLE_STOP_TICKS = 20 // в фоне: столько тиков (по 0,5 с) без плашки — и цикл останавливается до следующего вызова службы

        @Volatile
        private var instance: InAppIsland? = null

        /** Единственная плашка процесса. Зовётся только из главного потока (создаёт View). */
        fun get(ctx: Context): InAppIsland {
            instance?.let { return it }
            val i = InAppIsland(ctx.applicationContext)
            instance = i
            return i
        }

        /** Экран разрешения «Поверх других приложений» (запасной — сведения о приложении). */
        fun openOverlaySettings(ctx: Context) {
            try {
                ctx.startActivity(
                    Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION, Uri.parse("package:" + ctx.packageName)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                )
            } catch (e: Exception) {
                try {
                    ctx.startActivity(
                        Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:" + ctx.packageName)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                    )
                } catch (e2: Exception) {
                }
            }
        }

        /**
         * Из служб таймера, помодоро и секундомера (любой поток): системный остров выключен — запускает цикл плашки, даже если
         * приложение не открыто (ярлык «Секундомер», службы переднего плана держат процесс). Включён — ничего не делает.
         */
        fun ensureBackground(ctx: Context) {
            val app = ctx.applicationContext
            if (IslandSettings.systemEnabled(app)) return
            Handler(Looper.getMainLooper()).post {
                try {
                    get(app).startBackground()
                } catch (e: Exception) {
                    // плашка — украшение
                }
            }
        }
    }

    /** Приложение на экране (между onResume и onPause MainActivity) — тогда есть Activity; в фоне и без приложения — null. */
    private var activity: Activity? = null

    private val handler = Handler(Looper.getMainLooper())
    private val density = appCtx.resources.displayMetrics.density

    // Корень окна: тап распознаётся здесь (trackTap), а не только кликом дочерней плашки — так нажатие не зависит от того,
    // дошло ли оно до вложенного View, и «залипшая» анимация/состояние раскрытия не глушат плашку.
    private val layer = object : FrameLayout(appCtx) {
        override fun dispatchTouchEvent(ev: MotionEvent): Boolean {
            try {
                trackTap(ev)
            } catch (e: Exception) {
                // распознавание тапа — украшение: ошибка не должна ломать касания
            }
            return super.dispatchTouchEvent(ev)
        }
    }
    private val pill = LinearLayout(appCtx)
    private val pillIcon = ImageView(appCtx)
    private val pillName = TextView(appCtx)
    private val pillTime = StrokeText(appCtx) // время первого занятия (справа от камеры)
    private val dots = Array(1) { ImageView(appCtx) } // кружок следующего занятия справа от капсулы (один); с разрешением «Поверх других приложений» — в своём окне
    private val dotLps = arrayOfNulls<WindowManager.LayoutParams>(1)
    private val dotMode = IntArray(1) // 0 — не показан, 1 — ребёнок layer (запасной режим), 2 — своё окно
    private val dotShown = arrayOfNulls<String>(1) // что нарисовано в кружке — перерисовка только при изменении
    private val dotKeys = arrayOfNulls<String>(1) // чьё занятие в кружке
    private var frontKey: String? = null // занятие, выбранное нажатием на кружок для капсулы; null — по приоритету
    private val card = FrameLayout(appCtx)
    private val cardContent = FrameLayout(appCtx)
    private val cardIcon = ImageView(appCtx)
    private val cardTime = StrokeText(appCtx)
    private val cardName = TextView(appCtx)
    private val pauseBtn = ImageView(appCtx)
    private val stopBtn = ImageView(appCtx)
    private val strip = LinearLayout(appCtx) // карточка с двумя и больше занятиями: ряд значков для переключения
    private val cardBar = View(appCtx) // полоска внизу карточки (при одном занятии с карточкой)
    private val cardBg = GradientDrawable().apply { setColor(Color.BLACK) }

    // геометрия плашки и карточки (px), считается в layoutFor
    private var pillLeft = 0
    private var pillShift = 0 // на сколько середина капсулы смещена вправо от камеры (px): левая половина уже правой, когда слева только значок
    private var pillLeftW = 0 // ширина левой половины капсулы (значок и название слева от камеры)
    private var pillRightW = 0 // ширина правой половины (время справа от камеры)
    private var pillTop = 0
    private var pillW = 0
    private var pillH = 0
    private var pillMaxW = 0 // самая широкая плашка (прежний размер); по содержимому ширина подгоняется вниз — fitPill/setPillWidth
    private var camGap = 0 // чёрная середина капсулы под камеру: слева от неё значок и название, справа время
    private var cardTop = 0
    private var cardW = 0
    private var cardH = 0
    private var cardR = 0f
    private var centerX = 0
    private var progress = 0f
    private var animating = false
    private var animStart = 0L
    private var animFrom = 0f
    private var animTo = 0f
    private var animDur = 1L
    private var animInterp: android.view.animation.Interpolator = AccelerateDecelerateInterpolator()
    private var winY = 0

    private var cutout: Rect? = null
    private var attached = false
    private var mode = 0 // 0 — нигде, 1 — в decorView (не нажимается), 2 — своё окно поверх всех
    private var winLp: WindowManager.LayoutParams? = null
    private var winW = 0
    private var winH = 0
    private var started = false
    private var expanded = false
    private var expandedAt = 0L
    private var builtFor: Rect? = null
    private var scrW = 0
    private var textMaxW = 0 // предельная ширина текста раскрытой карточки музыки/видео (левее кнопок)
    private var pillCapW = 0 // предельная ширина капсулы (= pillMaxW)
    private var gapPx = 0 // зазор между значком и временем/названием

    private var curItems: List<Item> = emptyList() // занятия последнего обновления, по приоритету
    private var selKey: String? = null // чьё занятие показано в раскрытой карточке
    private val shownIc = arrayOfNulls<String>(1) // что сейчас нарисовано в значке капсулы — перерисовка только при изменении
    private val shownTxt = arrayOfNulls<String>(2) // тексты капсулы (название/время)
    private var shownCardIcon: String? = null
    private var shownCardBig: String? = null
    private var shownCardSub: String? = null
    private var shownCardBtn: String? = null
    private var shownStrip: String? = null
    private var cardMusicStyle: Boolean? = null
    private var tapItem: Item? = null // чьё занятие нажато (капсула — первое)
    private var swipeX = 0f
    private var swipeY = 0f
    private val swStopTask = Runnable {
        if (tapArmed && tapItem?.kind == K_SW) {
            tapArmed = false
            val ctx = appCtx
            StopwatchTimer.stop(ctx)
            StopwatchService.stop(ctx)
            try { pill.performHapticFeedback(android.view.HapticFeedbackConstants.LONG_PRESS) } catch (e: Exception) { }
            refresh()
        }
    }

    private fun dp(v: Float) = (v * density).roundToInt()

    /** Начертание нужного веса (как у системного острова: название 400, время 700); на старых Android — обычное/жирное. */
    private fun weighted(weight: Int): Typeface =
        if (android.os.Build.VERSION.SDK_INT >= 28) Typeface.create(Typeface.DEFAULT, weight, false)
        else Typeface.create(Typeface.DEFAULT, if (weight >= 600) Typeface.BOLD else Typeface.NORMAL)

    init {
        layer.visibility = View.GONE
        pill.orientation = LinearLayout.HORIZONTAL
        pill.gravity = Gravity.CENTER_VERTICAL
        pill.isClickable = true // принимает касание (ACTION_UP дойдёт до окна); само раскрытие — trackTap
        layer.setOnTouchListener { _, e -> onLayerTouch(e) }
        pillName.apply {
            setTextColor(Color.WHITE)
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 13f)
            typeface = Typeface.create("sans-serif-medium", Typeface.NORMAL)
            maxLines = 1
            ellipsize = TextUtils.TruncateAt.END
        }
        for (t in listOf(pillTime)) {
            t.setTextColor(Color.WHITE)
            t.setTextSize(TypedValue.COMPLEX_UNIT_SP, 12f)
            t.typeface = Typeface.DEFAULT
            t.letterSpacing = 0.08f
            t.maxLines = 1
        }
        for (i in dots.indices) {
            val d = dots[i]
            d.background = GradientDrawable().apply { shape = GradientDrawable.OVAL; setColor(Color.BLACK) }
            d.scaleType = ImageView.ScaleType.FIT_CENTER
            d.setOnClickListener {
                val k = dotKeys[i]
                curItems.firstOrNull { m -> m.key == k }?.let { m -> onCircleTap(m) }
            }
        }

        card.visibility = View.GONE
        card.background = cardBg
        card.isClickable = true // не пропускает нажатия на страницу под карточкой; нажатие мимо кнопок сворачивает
        card.setOnClickListener { } // касание карточки (мимо кнопок) ничего не делает; сворачивает нажатие мимо неё
        // Смахивание по карточке влево/вправо — переключение между занятиями (кнопки и значки внизу получают нажатия сами).
        card.setOnTouchListener { _, e ->
            when (e.actionMasked) {
                MotionEvent.ACTION_DOWN -> {
                    swipeX = e.x
                    swipeY = e.y
                }
                MotionEvent.ACTION_UP -> {
                    val dx = e.x - swipeX
                    val dy = e.y - swipeY
                    if (expanded && !animating && abs(dx) > scrW * 0.1f && abs(dx) > abs(dy) * 1.5f) stepCard(if (dx < 0) 1 else -1)
                }
            }
            false
        }
        cardTime.apply {
            setTextColor(Color.WHITE)
            maxLines = 1
        }
        cardName.apply {
            setTextColor(0xFF8A8A8A.toInt())
            maxLines = 1
            ellipsize = TextUtils.TruncateAt.END
        }
        pauseBtn.setOnClickListener { onPauseClick() }
        stopBtn.apply {
            setImageBitmap(XiaomiIsland.crossBitmap())
            setOnClickListener { onStopClick() }
        }
        strip.orientation = LinearLayout.HORIZONTAL
        strip.gravity = Gravity.CENTER
        strip.visibility = View.GONE
        cardBar.background = GradientDrawable().apply { setColor(0xFF3A3A3A.toInt()) }
        card.addView(cardContent)
        layer.addView(card)
        layer.addView(pill) // плашка выше карточки: её значок и текст проявляются/гаснут поверх, а не появляются рывком
    }

    /** Рамка выреза камеры (координаты окна) из WindowInsets; null — выреза сверху нет. */
    fun setCutout(rect: Rect?) {
        if (rect != null) {
            handler.removeCallbacks(hideAfterCutoutLoss)
            cutout = rect
            saveCutout(rect)
            return
        }
        // При открытии приложения и смене режима панелей WindowInsets приходят заново и вырез на миг может пропасть:
        // убирать окно сразу нельзя — плашка мигает. Реально пропавший вырез (поворот) убираем через паузу.
        if (cutout != null) {
            handler.removeCallbacks(hideAfterCutoutLoss)
            handler.postDelayed(hideAfterCutoutLoss, 400L)
        }
    }

    private val hideAfterCutoutLoss = Runnable {
        cutout = null
        hide()
    }

    fun start() {
        if (started) return
        started = true
        idleTicks = 0
        handler.post(tick)
    }

    fun stop() {
        started = false
        handler.removeCallbacks(tick)
        handler.removeCallbacks(hideAfterCutoutLoss)
        hide()
    }

    /** MainActivity.onResume: приложение на экране — плашка работает как всегда (и привязана к его окну в запасном режиме). */
    fun setActivity(a: Activity?) {
        if (activity === a) return
        if (attached && mode == 1) detach() // запасное место — decorView прежней Activity
        activity = a
    }

    /** MainActivity.onPause: системный остров включён — плашка уходит вместе с приложением; выключен — остаётся поверх других приложений. */
    fun onActivityPaused(a: Activity) {
        if (activity !== a) return
        setActivity(null)
        if (!backgroundWanted()) stop()
    }

    /** Из служб ([ensureBackground]): приложение не на экране, системный остров выключен — крутим цикл плашки сами. */
    private fun startBackground() {
        if (activity == null && backgroundWanted()) start()
    }

    /** Свёрнутое приложение показывает плашку, только если системный остров выключен и выдано «Поверх других приложений». */
    private fun backgroundWanted(): Boolean = !IslandSettings.systemEnabled(appCtx) && canOverlay()

    /** Вне приложения плашка рисуется только при обычном портретном положении экрана (вырез сохранён из портрета). */
    @Suppress("DEPRECATION")
    private fun isUpright(): Boolean = try {
        wm().defaultDisplay.rotation == Surface.ROTATION_0
    } catch (e: Exception) {
        false
    }

    private fun prefs() = appCtx.getSharedPreferences("island", Context.MODE_PRIVATE)

    /** Вырез, виденный приложением в портрете, запоминается: без приложения (служба, ярлык) WindowInsets взять неоткуда. */
    private fun saveCutout(r: Rect) {
        if (!isUpright()) return
        val key = "" + r.left + "," + r.top + "," + r.right + "," + r.bottom + "," + appCtx.resources.displayMetrics.widthPixels
        val sp = prefs()
        if (sp.getString("cut", "") == key) return
        sp.edit().putString("cut", key).apply()
    }

    private fun loadCutout(): Rect? {
        val parts = (prefs().getString("cut", null) ?: return null).split(",")
        if (parts.size != 5) return null
        val v = IntArray(5)
        for (i in 0 until 5) v[i] = parts[i].toIntOrNull() ?: return null
        if (v[4] != appCtx.resources.displayMetrics.widthPixels) return null // ширина другая (другой масштаб экрана) — вырез не тот
        return Rect(v[0], v[1], v[2], v[3])
    }

    private var idleTicks = 0

    private val tick = object : Runnable {
        override fun run() {
            if (!started) return
            val inBackground = activity == null
            if (inBackground && !backgroundWanted()) { // настройку включили обратно или разрешение отозвали
                stop()
                return
            }
            try {
                refresh()
            } catch (e: Exception) {
                hide() // плашка — украшение: любая ошибка не должна мешать приложению
            }
            if (inBackground) {
                // нечего показывать (таймер кончился, ландшафт): цикл не крутим вхолостую — службы запустят его снова
                if (layer.visibility == View.VISIBLE) idleTicks = 0 else if (++idleTicks > IDLE_STOP_TICKS) {
                    stop()
                    return
                }
            }
            handler.postDelayed(this, 500L)
        }
    }

    private fun wm() = appCtx.getSystemService(Context.WINDOW_SERVICE) as WindowManager

    private fun canOverlay(): Boolean = try {
        Build.VERSION.SDK_INT < 23 || Settings.canDrawOverlays(appCtx)
    } catch (e: Exception) {
        false
    }

    /** Ставит слой в нужное место: своё окно поверх всех (нажимается) или, без разрешения, decorView. */
    private fun attach() {
        val want = if (canOverlay()) 2 else 1
        if (want == 1 && activity == null) return // без разрешения и без приложения на экране плашке негде жить
        if (attached && mode == want) return
        detach()
        mode = want // сначала режим: от него зависят отступы и размер окна
        fixPillMargin()
        applyProgress(progress)
        try {
            if (want == 2) {
                // Окно НЕ должно быть FLAG_NOT_TOUCHABLE: с Android 12 такое окно поверх всех система принудительно делает
                // не более 80 % непрозрачным (полупрозрачная плашка). Поэтому оно принимает нажатия, а размер подгоняется под
                // плашку/карточку (см. setWindowBig), чтобы не перекрывать строку состояния и страницу вокруг.
                val flags = WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL or
                    WindowManager.LayoutParams.FLAG_WATCH_OUTSIDE_TOUCH or
                    WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN or WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS
                val big = expanded || animating
                val wl = WindowManager.LayoutParams(max(if (big) winW else pillW, 1), max(if (big) winH else pillH, 1), windowType(), flags, PixelFormat.TRANSLUCENT)
                wl.gravity = Gravity.TOP or Gravity.CENTER_HORIZONTAL
                wl.x = if (big) 0 else pillShift
                wl.y = winY
                if (Build.VERSION.SDK_INT >= 28) wl.layoutInDisplayCutoutMode = WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES
                winLp = wl
                wm().addView(layer, wl)
            } else {
                val host = activity?.window?.decorView as? ViewGroup ?: return
                host.addView(
                    layer, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
                )
            }
            attached = true
        } catch (e: Exception) {
            mode = 0 // окно не готово или разрешение отозвано: попробуем при следующем обновлении
        }
    }

    private fun detach() {
        detachDots()
        if (!attached) return
        try {
            if (mode == 2) wm().removeViewImmediate(layer) else (layer.parent as? ViewGroup)?.removeView(layer)
        } catch (e: Exception) {
        }
        attached = false
        mode = 0
    }

    private fun detachDots() {
        for (i in dots.indices) detachDot(i)
    }

    private fun detachDot(i: Int) {
        val m = dotMode[i]
        if (m == 0) return
        try {
            if (m == 2) wm().removeViewImmediate(dots[i]) else (dots[i].parent as? ViewGroup)?.removeView(dots[i])
        } catch (e: Exception) {
        }
        dotMode[i] = 0
        dotLps[i] = null
        dotShown[i] = null
    }

    /**
     * Занятия-кружки: только при свёрнутой капсуле — все, кроме первого (оно в капсуле). Пока карточка раскрыта (и во время её
     * движения) кружка нет.
     */
    private fun circleItems(items: List<Item>): List<Item> {
        if (expanded || animating) return emptyList() // пока карточка раскрыта (и движется), кружка нет: он только у свёрнутой капсулы
        return items.drop(1)
    }

    /**
     * Нажатие на кружок: при раскрытой карточке — переключает её на это занятие; при свёрнутой капсуле — занятие из кружка
     * становится капсулой, а занятия идут по кругу (последнее — в кружок): [orderItems].
     */
    private fun onCircleTap(m: Item) {
        if (expanded && !animating && m.expandable) {
            selectCard(m.key)
            return
        }
        frontKey = m.key
        refresh()
    }

    /** Занятия по приоритету, прокрученные так, чтобы выбранное нажатием на кружок ([frontKey]) было первым (в капсуле). */
    private fun orderItems(raw: List<Item>): List<Item> {
        val k = frontKey ?: return raw
        val i = raw.indexOfFirst { it.key == k }
        if (i < 0) {
            frontKey = null // выбранное занятие кончилось — снова по приоритету
            return raw
        }
        if (i == 0) return raw
        return raw.subList(i, raw.size) + raw.subList(0, i)
    }

    /** Нажатие снаружи окна, попавшее в кружок: это нажатие на кружок, а не «мимо карточки». */
    private fun hitsDot(rx: Float, ry: Float): Boolean {
        val loc = IntArray(2)
        val pad = dp(4f)
        for (i in dots.indices) {
            if (dotMode[i] != 2) continue
            dots[i].getLocationOnScreen(loc)
            if (rx >= loc[0] - pad && rx <= loc[0] + dots[i].width + pad && ry >= loc[1] - pad && ry <= loc[1] + dots[i].height + pad) return true
        }
        return false
    }

    /**
     * Кружок справа от капсулы — следующее занятие ([circleItems]); остальные не видны, на кружке «+N» (сколько их ещё;
     * нажатие по кружку меняет занятия местами, см. [onCircleTap]). Рисуются в своих маленьких окнах (одно окно с капсулой пришлось бы
     * делать симметричным, и оно закрывало бы строку состояния слева); без разрешения «Поверх других приложений» — внутри layer.
     */
    private fun updateDots(items: List<Item>) {
        val circles = if (attached && pillH > 0) circleItems(items) else emptyList()
        val shown = circles.take(dots.size)
        for (i in dots.indices) {
            if (i >= shown.size) {
                detachDot(i)
                continue
            }
            val m = shown[i]
            val extra = if (i == shown.size - 1) circles.size - shown.size else 0
            val key = m.key + "|" + m.iconKey + "|" + extra
            if (key != dotShown[i]) {
                dotShown[i] = key
                var bmp = m.iconFn(96)
                if (extra > 0) bmp = withBadge(bmp, extra)
                dots[i].setImageBitmap(bmp)
            }
            dotKeys[i] = m.key
            placeDot(i, pillShift + pillW / 2 + dp(6f) + pillH / 2 + i * (pillH + dp(6f)))
        }
    }

    /** Ставит кружок i так, чтобы его центр был на x от середины капсулы. */
    private fun placeDot(i: Int, x: Int) {
        val d = dots[i]
        if (mode == 2) {
            if (dotMode[i] == 1) detachDot(i)
            val lp = dotLps[i]
            if (dotMode[i] != 2 || lp == null) {
                val flags = WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL or
                    WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN or WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS
                val wl = WindowManager.LayoutParams(pillH, pillH, windowType(), flags, PixelFormat.TRANSLUCENT)
                wl.gravity = Gravity.TOP or Gravity.CENTER_HORIZONTAL
                wl.x = x
                wl.y = winY
                if (Build.VERSION.SDK_INT >= 28) wl.layoutInDisplayCutoutMode = WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES
                try {
                    wm().addView(d, wl)
                    dotLps[i] = wl
                    dotMode[i] = 2
                } catch (e: Exception) {
                    dotMode[i] = 0
                }
            } else if (lp.x != x || lp.width != pillH || lp.y != winY) {
                lp.x = x
                lp.width = pillH
                lp.height = pillH
                lp.y = winY
                try {
                    wm().updateViewLayout(d, lp)
                } catch (e: Exception) {
                }
            }
        } else {
            if (dotMode[i] == 2) detachDot(i)
            val lp = d.layoutParams as? FrameLayout.LayoutParams
            if (dotMode[i] != 1 || lp == null) {
                val nl = FrameLayout.LayoutParams(pillH, pillH).apply {
                    gravity = Gravity.TOP or Gravity.CENTER_HORIZONTAL
                    topMargin = pillTop
                    leftMargin = x
                }
                try {
                    layer.addView(d, nl)
                    dotMode[i] = 1
                } catch (e: Exception) {
                    dotMode[i] = 0
                }
            } else if (lp.leftMargin != x || lp.width != pillH || lp.topMargin != pillTop) {
                lp.width = pillH
                lp.height = pillH
                lp.topMargin = pillTop
                lp.leftMargin = x
                d.layoutParams = lp
            }
        }
    }

    /** Значок с белым кружком «+N» в углу: кружков больше, чем помещается справа; скрытые видны в раскрытой карточке. */
    private fun withBadge(src: Bitmap, extra: Int): Bitmap {
        val out = src.copy(Bitmap.Config.ARGB_8888, true)
        val c = Canvas(out)
        val s = out.width.toFloat()
        val p = Paint(Paint.ANTI_ALIAS_FLAG)
        p.color = Color.WHITE
        c.drawCircle(s * 0.78f, s * 0.78f, s * 0.26f, p)
        p.color = Color.BLACK
        p.typeface = Typeface.DEFAULT_BOLD
        p.textSize = s * 0.3f
        p.textAlign = Paint.Align.CENTER
        c.drawText((if (extra > 9) "9+" else "+" + extra), s * 0.78f, s * 0.78f + s * 0.1f, p)
        return out
    }

    private fun windowType(): Int =
        if (Build.VERSION.SDK_INT >= 26) WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY else WindowManager.LayoutParams.TYPE_PHONE

    /**
     * Размер окна с картинкой: большое (рамка всего движения) — во время анимации и пока карточка раскрыта; маленькое —
     * ровно по свёрнутой плашке. Меняется только там, где раскладка внутри окна не меняется (при p=0 карточка и плашка
     * лежат в левом верхнем углу окна, по центру экрана), поэтому прыжков нет.
     */
    private fun setWindowBig(big: Boolean) {
        if (mode != 2 || !attached) return
        val lp = winLp ?: return
        val w = max(if (big) winW else pillW, 1)
        val h = max(if (big) winH else pillH, 1)
        val x = if (big) 0 else pillShift // свёрнутое окно сдвинуто вместе с капсулой, большое — по центру экрана (карточка по центру)
        fixPillMargin(big)
        if (lp.width == w && lp.height == h && lp.x == x) return
        lp.width = w
        lp.height = h
        lp.x = x
        try {
            wm().updateViewLayout(layer, lp)
        } catch (e: Exception) {
        }
    }

    /** Нажатия, до которых не дошли плашка и карточка: мимо раскрытой карточки (в запасе окна или снаружи) — сворачивает. */
    private fun onLayerTouch(e: MotionEvent): Boolean {
        if (mode != 2) return false
        when (e.actionMasked) {
            MotionEvent.ACTION_OUTSIDE -> if (expanded && !animating && !hitsDot(e.rawX, e.rawY)) collapse()
            MotionEvent.ACTION_DOWN -> if (expanded && !animating) collapse()
        }
        return true
    }

    private fun selItem(): Item? = curItems.firstOrNull { it.key == selKey }

    private fun onPauseClick() {
        val m = selItem() ?: return
        m.onToggle?.invoke()
        expandedAt = System.currentTimeMillis()
        if (m.kind != K_TIMER) handler.postDelayed({ refresh() }, 150L) // музыка и видео выполняют команду в другом потоке — обновляем чуть позже
        refresh()
    }

    private fun onStopClick() {
        val m = selItem() ?: return
        m.onStop?.invoke()
        expandedAt = System.currentTimeMillis()
        // последнее занятие с карточкой — сворачиваем сразу; иначе карточка перейдёт на соседнее при обновлении
        if (curItems.count { it.expandable } <= 1) collapse()
        handler.postDelayed({ refresh() }, 150L)
        refresh()
    }

    /** Выбрать, чьё занятие показано в раскрытой карточке (значок в ряду внизу, смахивание). */
    private fun selectCard(key: String) {
        if (key == selKey) return
        selKey = key
        expandedAt = System.currentTimeMillis()
        resetCardCache()
        refresh()
    }

    private fun stepCard(dir: Int) {
        val ex = curItems.filter { it.expandable }
        if (ex.size < 2) return
        val i = ex.indexOfFirst { it.key == selKey }.coerceAtLeast(0)
        selectCard(ex[(i + dir + ex.size) % ex.size].key)
    }

    private fun resetCardCache() {
        shownCardIcon = null
        shownCardBig = null
        shownCardSub = null
        shownCardBtn = null
        shownStrip = null
        cardMusicStyle = null
    }

    private var askDialog: AlertDialog? = null

    /**
     * Предлагает выдать разрешение «Поверх других приложений» (на HyperOS/MIUI — «Отображение всплывающих окон»), пока его нет:
     * система время от времени его сбрасывает, а без него плашку нельзя нажать. Повторно — не чаще раза в `ASK_EVERY_MS`.
     */
    private fun askOverlayOnce() {
        val act = activity ?: return // вопрос показывается только в открытом приложении
        if (Build.VERSION.SDK_INT < 23 || canOverlay() || act.isFinishing) return
        if (askDialog?.isShowing == true) return
        val prefs = prefs()
        val now = System.currentTimeMillis()
        val last = prefs.getLong("askedAt", 0L)
        if (last in 1..now && now - last < ASK_EVERY_MS) return
        prefs.edit().putLong("askedAt", now).apply()
        try {
            askDialog = AlertDialog.Builder(act)
                .setTitle("Плашка таймера")
                .setMessage("Разрешение «Поверх других приложений» (в настройках Xiaomi — «Отображение всплывающих окон») выключено: система его время от времени сбрасывает. Без него плашку сверху нельзя нажать и раскрыть. Включить?")
                .setPositiveButton("Открыть настройки") { _, _ -> openOverlaySettings(appCtx) }
                .setNegativeButton("Позже", null)
                .show()
        } catch (e: Exception) {
        }
    }


    private fun hide() {
        stopAnim()
        layer.visibility = View.GONE
        expanded = false
        progress = 0f
        card.visibility = View.GONE
        pill.alpha = 1f
        pill.visibility = View.VISIBLE
        selKey = null
        curItems = emptyList()
        detachDots()
        if (mode == 2) detach() // окно поверх всех не должно оставаться и перехватывать касания
    }

    /**
     * Нажатие на капсулу (или кружок). Таймер, музыка, видео — раскрываются в карточку именно этого занятия; помодоро —
     * вкладка «Помодоро» (на плашке не раскрывается); секундомер — пауза/продолжить (долгое нажатие — сброс, см. [swStopTask]).
     */
    private fun activate(m: Item) {
        when (m.kind) {
            K_SW -> {
                val ctx = appCtx
                StopwatchTimer.togglePause(ctx)
                StopwatchService.refresh(ctx)
                refresh()
            }
            K_POMO -> {
                val a = activity
                if (a is MainActivity) a.openPomodoroTab() else openAppOnPomodoro()
            }
            else -> {
                // состояние «раскрыта», хотя карточка давно свёрнута (прервалась анимация/пересборка окна) — считаем свёрнутой
                if (expanded && !animating && progress <= 0.001f) expanded = false
                if (expanded) collapse() else expand(m.key)
            }
        }
    }

    /** Нажатие на плашку помодоро, когда приложение не на экране: выносим его вперёд сразу на вкладку «Помодоро». */
    private fun openAppOnPomodoro() {
        try {
            val i = Intent(appCtx, MainActivity::class.java)
            i.action = MainActivity.ACTION_OPEN_POMODORO
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_REORDER_TO_FRONT or Intent.FLAG_ACTIVITY_SINGLE_TOP)
            appCtx.startActivity(i)
        } catch (e: Exception) {
            // запуск из фона не разрешён: приложение откроется нажатием на уведомление
        }
    }

    private var tapArmed = false
    private var tapX = 0f
    private var tapY = 0f
    private val tapSlop = ViewConfiguration.get(appCtx).scaledTouchSlop

    private fun inPill(x: Float, y: Float): Boolean {
        if (pill.width <= 0 || pill.height <= 0) return true // раскладка ещё не прошла: всё окно — плашка
        val pad = dp(6f)
        return x >= pill.left - pad && x <= pill.right + pad && y >= pill.top - pad && y <= pill.bottom + pad
    }

    /** Анимация не дошла до конца (кадры не пришли): доводим до конечной точки, чтобы плашка снова нажималась. */
    private fun finishStuckAnim() {
        stopAnim()
        applyProgress(animTo)
        if (animTo == 0f) {
            card.visibility = View.GONE
            setWindowBig(false)
        }
    }

    /** Нажатие на свёрнутую плашку = тап (ACTION_DOWN и ACTION_UP на плашке, палец не уехал дальше порога прокрутки). */
    private fun trackTap(ev: MotionEvent) {
        when (ev.actionMasked) {
            MotionEvent.ACTION_DOWN -> {
                if (animating && SystemClock.uptimeMillis() - animStart > animDur + 500L) finishStuckAnim()
                tapArmed = !expanded && !animating && pill.visibility == View.VISIBLE && inPill(ev.x, ev.y)
                tapItem = if (tapArmed) curItems.firstOrNull() else null
                if (tapItem == null) tapArmed = false
                tapX = ev.x
                tapY = ev.y
                handler.removeCallbacks(swStopTask)
                if (tapArmed && tapItem?.kind == K_SW) handler.postDelayed(swStopTask, 700L)
            }
            MotionEvent.ACTION_MOVE -> if (tapArmed && (abs(ev.x - tapX) > tapSlop || abs(ev.y - tapY) > tapSlop)) {
                tapArmed = false
                handler.removeCallbacks(swStopTask)
            }
            MotionEvent.ACTION_UP -> {
                handler.removeCallbacks(swStopTask)
                val m = tapItem
                val fire = tapArmed && !expanded && !animating && inPill(ev.x, ev.y)
                tapArmed = false
                if (fire && m != null) activate(m)
            }
            MotionEvent.ACTION_CANCEL -> {
                handler.removeCallbacks(swStopTask)
                tapArmed = false
            }
        }
    }

    private fun expand(key: String) {
        if (expanded) return
        expanded = true
        selKey = key
        resetCardCache()
        expandedAt = System.currentTimeMillis()
        card.visibility = View.VISIBLE
        refresh()
        animateTo(1f, 420L, OvershootInterpolator(1.1f))
    }

    private fun collapse() {
        if (!expanded) return
        expanded = false
        animateTo(0f, 280L, AccelerateDecelerateInterpolator())
    }

    private val frame = object : Choreographer.FrameCallback {
        override fun doFrame(frameTimeNanos: Long) {
            if (!animating) return
            val t = ((SystemClock.uptimeMillis() - animStart) / animDur.toFloat()).coerceIn(0f, 1f)
            applyProgress(animFrom + (animTo - animFrom) * animInterp.getInterpolation(t))
            if (t < 1f) {
                Choreographer.getInstance().postFrameCallback(this)
            } else {
                animating = false
                applyProgress(animTo)
                if (animTo == 0f) card.visibility = View.GONE
                if (animTo == 0f) setWindowBig(false) // свёрнуто: окно ровно по плашке
            }
        }
    }

    private fun stopAnim() {
        animating = false
        Choreographer.getInstance().removeFrameCallback(frame)
    }

    /** Анимация по кадрам экрана: не зависит от настройки «Убрать анимацию» в системе. */
    private fun animateTo(target: Float, duration: Long, interpolator: android.view.animation.Interpolator) {
        stopAnim()
        animFrom = progress
        animTo = target
        animDur = duration
        animInterp = interpolator
        animStart = SystemClock.uptimeMillis()
        animating = true
        setWindowBig(true) // на время движения окно — рамка всего движения
        Choreographer.getInstance().postFrameCallback(frame)
    }

    private fun fixPillMargin(big: Boolean = expanded || animating) {
        val lp = pill.layoutParams as? FrameLayout.LayoutParams ?: return
        lp.topMargin = if (mode == 2) 0 else pillTop // в своём окне плашка стоит у верха окна
        lp.leftMargin = if (mode == 2 && !big) 0 else pillShift // в маленьком окне сдвинуто само окно
        pill.layoutParams = lp
    }

    private fun lerp(a: Float, b: Float, p: Float) = a + (b - a) * p

    /** p = 0 — карточка точно по плашке, p = 1 — раскрыта (на отскоке p чуть больше 1). Окно не трогаем — двигаются только View внутри него. */
    private fun applyProgress(p: Float) {
        progress = p
        if (cardW == 0) return
        val w = lerp(pillW.toFloat(), cardW.toFloat(), p).roundToInt().coerceAtLeast(pillW)
        val h = lerp(pillH.toFloat(), cardH.toFloat(), p).roundToInt().coerceAtLeast(pillH)
        val top = lerp(pillTop.toFloat(), cardTop.toFloat(), p).roundToInt()
        val lp = card.layoutParams as FrameLayout.LayoutParams
        lp.width = w
        lp.height = h
        lp.gravity = Gravity.TOP or Gravity.CENTER_HORIZONTAL
        lp.leftMargin = (pillShift * (1f - p.coerceIn(0f, 1f))).roundToInt() // при p = 0 карточка точно по смещённой капсуле
        lp.topMargin = top - (if (mode == 2) pillTop else 0) // в своём окне отсчёт от верха окна (он на уровне плашки)
        card.layoutParams = lp
        cardBg.cornerRadius = lerp(pillH / 2f, cardR, p.coerceIn(0f, 1f))
        cardContent.alpha = ((p - 0.3f) / 0.7f).coerceIn(0f, 1f)
        val pillAlpha = (1f - p / 0.25f).coerceIn(0f, 1f)
        pill.alpha = pillAlpha
        pill.visibility = if (pillAlpha <= 0f) View.INVISIBLE else View.VISIBLE
    }

    /**
     * Все занятия, которые сейчас можно показать, по приоритету: помодоро, таймеры карточек (по близости конца), секундомер,
     * музыка, видео вкладки-сайта. Первое — в капсуле, остальные — кружками справа (см. [bindCompact], [updateDots]). Музыка и видео вне приложения — только при выключенном системном острове.
     */
    private fun collectItems(): List<Item> {
        val out = ArrayList<Item>(6)
        val now = System.currentTimeMillis()
        val ctx = appCtx
        val pomo = PomodoroTimer.islandInfo(ctx)
        if (pomo != null) {
            val m = Item("pomo", K_POMO)
            val color = PomodoroTimer.colorFor(pomo, now)
            val frac = PomodoroTimer.fractionLeft(pomo)
            val glyph = if (pomo.flash) 1 else if (!pomo.running && pomo.phase != PomodoroTimer.PH_WAIT) 2 else 0
            m.iconKey = "" + color + "/" + (frac * 60f).toInt() + "/" + glyph
            m.iconFn = { s -> XiaomiIsland.pomoRingBitmap(color, frac, s, glyph) }
            m.time = PomodoroTimer.pillText(pomo)
            // образцы ширины — по длине фазы, а не «на все случаи» (запас под «+88:88» и «Готово» оставлял пустоту в середине капсулы)
            m.samples = listOf(timePattern(m.time), if (pomo.totalMs >= 3_600_000L) "8:88:88" else if (pomo.totalMs >= 600_000L) "88:88" else "8:88")
            m.big = m.time
            m.sub = (if (pomo.task.isNotEmpty()) pomo.task + " · " else "") + PomodoroTimer.label(pomo) + " · " + PomodoroTimer.cycleText(pomo)
            val pomoWait = pomo.phase == PomodoroTimer.PH_WAIT
            val pomoPaused = !pomo.running || pomoWait
            m.btnKey = "" + (frac * 200f).roundToInt() + "/" + color + "/" + pomoPaused
            m.btnFn = { XiaomiIsland.pauseBitmap(frac, 0, pomoPaused, color) }
            m.onToggle = { if (pomoWait) PomodoroTimer.skip(ctx) else PomodoroTimer.togglePause(ctx) }
            m.onStop = { PomodoroTimer.stop(ctx) }
            out.add(m)
        }
        for (inf in CardTimers.allInfos(ctx)) {
            val m = Item("t:" + inf.id, K_TIMER)
            val stage = XiaomiIsland.stageFor(inf.leftMs)
            val paused = !inf.running
            val fraction = (if (inf.totalMs > 0) inf.leftMs.toFloat() / inf.totalMs else 1f).coerceIn(0f, 1f)
            m.iconKey = "t" + stage
            m.iconFn = { s -> XiaomiIsland.iconBitmap(stage, s) }
            m.time = XiaomiIsland.clockText(inf.leftMs)
            val span = max(inf.totalMs, inf.leftMs)
            m.samples = listOf(if (span >= 3_600_000L) "8:88:88" else if (span >= 600_000L) "88:88" else "8:88")
            m.name = inf.title
            m.big = m.time
            m.sub = if (inf.running) inf.title else inf.title + " · пауза"
            m.btnKey = "" + (fraction * 200f).roundToInt() + "/" + stage + "/" + paused
            m.btnFn = { XiaomiIsland.pauseBitmap(fraction, stage, paused) }
            val id = inf.id
            m.onToggle = { if (paused) CardTimers.resume(ctx, id) else CardTimers.pause(ctx, id) }
            m.onStop = { CardTimers.cancel(ctx, id) }
            out.add(m)
        }
        val sw = StopwatchTimer.snapshot(ctx)
        if (sw != null) {
            val m = Item("sw", K_SW)
            m.iconKey = "sw" + sw.running
            m.iconFn = { s -> XiaomiIsland.stopwatchBitmap(sw.running, s) }
            m.time = XiaomiIsland.elapsedText(sw.elapsedMs)
            m.samples = listOf(timePattern(m.time))
            m.big = m.time
            m.sub = if (sw.running) "Секундомер" else "Секундомер · пауза"
            val swRun = sw.running
            m.btnKey = "sw" + swRun
            m.btnFn = { XiaomiIsland.pauseBitmap(1f, 0, !swRun, if (swRun) 0xFF1E88E5.toInt() else 0xFFFFB300.toInt()) }
            m.onToggle = {
                StopwatchTimer.togglePause(ctx)
                StopwatchService.refresh(ctx)
            }
            m.onStop = {
                StopwatchTimer.stop(ctx)
                StopwatchService.stop(ctx)
            }
            out.add(m)
        }
        val outside = activity != null || !IslandSettings.systemEnabled(ctx)
        if (MusicPlayer.active && outside) {
            val m = Item("music", K_MUSIC)
            val title = MusicPlayer.title
            val counter = MusicPlayer.counterText()
            val playing = MusicPlayer.playing
            m.iconKey = "mu" + playing
            m.iconFn = { s -> XiaomiIsland.musicIconBitmap(s, !playing) }
            m.time = counter
            m.samples = listOf(timePattern(counter))
            m.big = if (title.isBlank()) "Музыка" else title
            val parts = ArrayList<String>()
            if (MusicPlayer.folderTitle.isNotBlank()) parts.add(MusicPlayer.folderTitle)
            if (counter.isNotEmpty()) parts.add("трек " + counter.replace("/", " из "))
            parts.add(if (playing) "играет" else "пауза")
            m.sub = parts.joinToString(" · ")
            m.btnKey = "mu" + playing
            m.btnFn = { XiaomiIsland.musicButtonBitmap(if (playing) 2 else 1) }
            m.onToggle = { MusicPlayer.toggle() }
            m.onStop = { MusicPlayer.close() }
            out.add(m)
        }
        if (SiteMedia.active && outside) {
            val m = Item("video", K_VIDEO)
            val playing = SiteMedia.playing
            val title = if (SiteMedia.title.isNotEmpty()) SiteMedia.title else "Видео"
            m.iconKey = "vi"
            m.iconFn = { s -> XiaomiIsland.videoIconBitmap(s) }
            m.big = title
            val site = SiteMedia.sub
            m.sub = (if (site.isNotBlank()) site + " · " else "") + (if (playing) "играет" else "пауза")
            m.btnKey = "vi" + playing
            m.btnFn = { XiaomiIsland.musicButtonBitmap(if (playing) 2 else 1) }
            m.onToggle = { SiteMedia.listener?.onToggle() }
            m.onStop = { SiteMedia.listener?.onClose() }
            out.add(m)
        }
        if (outside) {
            val ws = WorkoutTracker.snapshot()
            val searching = ws.status == WorkoutTracker.ST_SEARCH
            val paused = ws.status == WorkoutTracker.ST_PAUSE
            if (searching || paused || ws.status == WorkoutTracker.ST_RUN) {
                val m = Item("workout", K_WORKOUT)
                val dot = if (paused) 1 else if (ws.status == WorkoutTracker.ST_RUN && ws.fix) 2 else 0 // 0 — красная, 1 — жёлтая, 2 — зелёная (как на острове)
                val km = WorkoutService.kmText(ws.distM)
                val total = XiaomiIsland.elapsedText(ws.totalMs)
                m.iconKey = "wk" + dot
                m.iconFn = { s -> XiaomiIsland.workoutDotBitmap(dot, s) }
                m.time = if (searching) "Поиск" else total
                m.samples = listOf(timePattern(m.time), if (ws.totalMs >= 3_600_000L) "8:88:88" else "88:88")
                m.big = if (searching) "Поиск…" else total
                m.sub = when {
                    searching -> if (ws.sat >= 0) "Найдено спутников: " + ws.sat else "Ждём сигнал GPS"
                    ws.status == WorkoutTracker.ST_RUN && !ws.fix -> "Связи нет · " + km
                    paused -> km + " · пауза"
                    else -> km
                }
                if (!searching) { // в поиске спутников пауза недоступна — только «Стоп»
                    val color = XiaomiIsland.workoutDotColor(dot)
                    m.btnKey = "wk" + dot + paused
                    m.btnFn = { XiaomiIsland.pauseBitmap(1f, 0, paused, color) }
                    m.onToggle = {
                        WorkoutTracker.togglePause()
                        WorkoutService.refresh(ctx)
                    }
                }
                m.onStop = {
                    WorkoutTracker.stop(ctx)
                    WorkoutService.refresh(ctx)
                }
                out.add(m)
            }
        }
        return out
    }

    private fun refresh() {
        val r = if (activity != null) cutout else if (isUpright()) loadCutout() else null
        if ((activity as? MainActivity)?.isSiteFullscreen == true) { // полноэкранное видео сайта: поверх него плашка не нужна
            hide()
            return
        }
        val items = if (r == null) emptyList() else orderItems(collectItems())
        if (r == null || items.isEmpty()) {
            hide()
            return
        }
        curItems = items
        layoutFor(r)
        fitFor(items)
        attach()
        if (!attached) {
            hide()
            return
        }
        askOverlayOnce()
        if (expanded && mode == 1 && System.currentTimeMillis() - expandedAt > 6000L) collapse() // без окна поверх всех «мимо» не поймать — по таймеру
        bindCompact(items)
        bindCard(items)
        updateDots(items)
        layer.visibility = View.VISIBLE
    }

    private fun setIcon(slot: Int, view: ImageView, m: Item) {
        val k = m.key + "|" + m.iconKey
        if (shownIc[slot] == k) return
        shownIc[slot] = k
        view.setImageBitmap(m.iconFn(96))
    }

    private fun setTxt(slot: Int, view: TextView, text: String) {
        if (shownTxt[slot] == text) return
        shownTxt[slot] = text
        view.text = text
    }

    /** Свёрнутая капсула — первое занятие: значок и название слева от камеры, время справа. Остальные занятия — кружки ([updateDots]). */
    private fun bindCompact(items: List<Item>) {
        val a = items[0]
        pillName.visibility = if (a.name.isNotEmpty()) View.VISIBLE else View.GONE
        setIcon(0, pillIcon, a)
        setTxt(0, pillName, a.name)
        setTxt(1, pillTime, a.time)
    }

    /** Раскрытая карточка выбранного занятия (с карточкой: таймеры, музыка, видео); с двумя и больше — ряд значков внизу. */
    private fun bindCard(items: List<Item>) {
        val ex = items.filter { it.expandable }
        val found = ex.firstOrNull { it.key == selKey }
        val sel: Item
        if (found != null) {
            sel = found
        } else if (expanded && ex.isNotEmpty()) { // выбранное занятие кончилось: карточка переходит на соседнее
            sel = ex[0]
            selKey = sel.key
            resetCardCache()
        } else {
            if (expanded) collapse() // карточкам показывать больше нечего
            if (!expanded) selKey = null
            return
        }
        val music = !sel.digitCard
        if (cardMusicStyle != music) {
            cardMusicStyle = music
            applyCardTextMode(music)
        }
        val ik = sel.key + "|" + sel.iconKey
        if (ik != shownCardIcon) {
            shownCardIcon = ik
            cardIcon.setImageBitmap(sel.iconFn(192))
        }
        if (sel.big != shownCardBig) {
            shownCardBig = sel.big
            cardTime.text = sel.big
        }
        if (sel.sub != shownCardSub) {
            shownCardSub = sel.sub
            cardName.text = sel.sub
        }
        pauseBtn.visibility = if (sel.onToggle != null) View.VISIBLE else View.INVISIBLE
        if (card.visibility == View.VISIBLE) {
            val bk = sel.key + "|" + sel.btnKey
            if (bk != shownCardBtn) {
                shownCardBtn = bk
                sel.btnFn?.let { pauseBtn.setImageBitmap(it()) }
            }
        }
        rebuildStrip(ex, sel.key)
    }

    private fun rebuildStrip(ex: List<Item>, current: String) {
        val sig = ex.joinToString(",") { it.key + it.iconKey } + "|" + current
        if (sig == shownStrip) return
        shownStrip = sig
        strip.removeAllViews()
        if (ex.size < 2) {
            strip.visibility = View.GONE
            cardBar.visibility = View.VISIBLE
            return
        }
        cardBar.visibility = View.GONE
        strip.visibility = View.VISIBLE
        // много занятий (например, десяток таймеров): значки уменьшаются, чтобы ряд поместился в ширину карточки
        val sd = min(scrW * 0.032f, scrW * 0.84f / (2 * ex.size - 1)).roundToInt().coerceAtLeast(1)
        for ((i, m) in ex.withIndex()) {
            val iv = ImageView(appCtx)
            iv.setImageBitmap(m.iconFn(96))
            iv.alpha = if (m.key == current) 1f else 0.4f
            val key = m.key
            iv.setOnClickListener { selectCard(key) }
            strip.addView(iv, LinearLayout.LayoutParams(sd, sd).apply { if (i > 0) marginStart = sd })
        }
    }

    /** Текст карточки: у музыки и видео — название одной строкой, обрезается многоточием левее кнопок; у таймера — крупные цифры. */
    private fun applyCardTextMode(music: Boolean) {
        cardTime.letterSpacing = if (music) 0.01f else 0.06f
        cardTime.ellipsize = if (music) TextUtils.TruncateAt.END else null
        cardTime.maxWidth = if (music && textMaxW > 0) textMaxW else Int.MAX_VALUE
        cardName.maxWidth = if (textMaxW > 0) textMaxW else Int.MAX_VALUE
    }

    /** Цифры заменяются «8» (самая широкая): ширина плашки считается по образцу и не прыгает на каждой смене цифры. */
    private fun timePattern(text: String): String = text.replace(Regex("[0-9]"), "8")

    /**
     * Подгоняет капсулу под первое занятие. Левая половина (значок и название, если есть) и правая (время) — каждая по своему
     * содержимому, середина под камеру: без названия слева остаётся только значок, и капсула уже и смещена к правой половине
     * ([pillShift]). Предел — прежняя ширина ([pillMaxW]); не влезло — название обрезается.
     */
    private fun fitFor(items: List<Item>) {
        if (pillMaxW <= 0 || scrW <= 0) return
        val iconW = pillH * 0.57f
        val extra = pillTime.strokePx + dp(2f)
        pillCapW = pillMaxW
        val a = items[0]
        var left = scrW * 0.024f + iconW + dp(2f)
        if (a.name.isNotEmpty()) left += gapPx + pillName.paint.measureText(a.name)
        var timeW = 0f
        for (t in a.samples) timeW = max(timeW, pillTime.paint.measureText(t))
        val right = timeW + extra + scrW * 0.0272f
        setPillWidth(left.roundToInt(), right.roundToInt())
    }

    /**
     * Меняет ширину свёрнутой плашки вместе с окном. Только в покое (не раскрыта и не анимируется): размер окна и раскладка
     * внутри него в это время не двигаются, иначе «дрожание»; отложенное применится при следующем обновлении.
     */
    private fun setPillWidth(wantLeft: Int, wantRight: Int) {
        if (expanded || animating) return
        val minHalf = dp(8f)
        val room = max(pillCapW, 1) - camGap
        var l = max(wantLeft, minHalf)
        var r = max(wantRight, minHalf)
        if (l + r > room) { // не влезло: уступает левая половина (название обрезается), потом правая
            l = max(room - r, minHalf)
            if (l + r > room) r = max(room - l, minHalf)
        }
        val w = camGap + l + r
        val shift = ((r - l) / 2f).roundToInt()
        if (w == pillW && shift == pillShift && l == pillLeftW && r == pillRightW) return
        pillW = w
        pillShift = shift
        pillLeftW = l
        pillRightW = r
        pillLeft = centerX + shift - w / 2
        (pill.getChildAt(0)?.layoutParams as? LinearLayout.LayoutParams)?.let {
            it.width = l
            it.weight = 0f
            pill.getChildAt(0).layoutParams = it
        }
        (pill.getChildAt(2)?.layoutParams as? LinearLayout.LayoutParams)?.let {
            it.width = r
            it.weight = 0f
            pill.getChildAt(2).layoutParams = it
        }
        (pill.layoutParams as? FrameLayout.LayoutParams)?.let {
            it.width = w
            pill.layoutParams = it
        }
        fixPillMargin()
        applyProgress(progress)
        setWindowBig(false)
    }

    /** Размеры и места плашки и карточки считаются от выреза; пересчёт — только когда вырез поменялся. */
    private fun layoutFor(r: Rect) {
        if (builtFor == r) return
        builtFor = Rect(r)
        if (attached) detach() // геометрия поменялась: окно с картинкой создаётся заново уже нужного размера
        val screenW = appCtx.resources.displayMetrics.widthPixels
        scrW = screenW
        // Рамка выреза у Xiaomi — размером со всю строку состояния, по ней плашка выходит огромной. Размеры берём
        // от ширины экрана, как у настоящего острова (замер на Poco X6 Pro: 500 × 105 px при ширине 1220, отступ сверху 13 px).
        val h = (screenW * 0.0878f).roundToInt()
        val w = (screenW * 0.4117f).roundToInt()
                val top = max(dp(2f), (screenW * 0.0077f).roundToInt())
        val left = r.centerX() - w / 2

        // дети переезжают в новые контейнеры: сначала отцепляем от старых (иначе addView бросает исключение)
        for (v in listOf<View>(pillIcon, pillName, pillTime)) (v.parent as? ViewGroup)?.removeView(v)
        pill.removeAllViews()
        pill.background = GradientDrawable().apply { setColor(Color.BLACK); cornerRadius = h / 2f }
        val side = (screenW * 0.024f).roundToInt()
        pill.setPadding(0, 0, 0, 0)
        pillTime.strokePx = screenW * 0.0021f
        gapPx = (screenW * 0.0087f).roundToInt()
        val iconSize = (h * 0.57f).roundToInt()
        camGap = (screenW * 0.075f).roundToInt()
        // Левая половина (значок, название) и правая (время) — каждая своей ширины (setPillWidth), чёрная середина — под камеру:
        // капсула сдвигается (pillShift) так, чтобы середина оставалась точно против выреза, а название не уходило под камеру.
        val leftBox = LinearLayout(appCtx).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.START or Gravity.CENTER_VERTICAL
            setPadding(side, 0, 0, 0)
            addView(pillIcon, LinearLayout.LayoutParams(iconSize, iconSize))
            addView(pillName, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f).apply { marginStart = gapPx })
        }
        pillTime.setPadding(0, 0, 0, 0)
        val rightBox = LinearLayout(appCtx).apply {
            gravity = Gravity.END or Gravity.CENTER_VERTICAL
            setPadding(0, 0, (screenW * 0.0272f).roundToInt(), 0)
            addView(pillTime)
        }
        // порядок детей важен: setPillWidth меняет ширины половин (0 — левая, 2 — правая)
        pillShift = 0
        pillLeftW = (w - camGap) / 2
        pillRightW = w - camGap - pillLeftW
        pill.addView(leftBox, LinearLayout.LayoutParams(pillLeftW, ViewGroup.LayoutParams.MATCH_PARENT))
        pill.addView(View(appCtx), LinearLayout.LayoutParams(camGap, ViewGroup.LayoutParams.MATCH_PARENT))
        pill.addView(rightBox, LinearLayout.LayoutParams(pillRightW, ViewGroup.LayoutParams.MATCH_PARENT))
        pill.layoutParams = FrameLayout.LayoutParams(w, h).apply { gravity = Gravity.TOP or Gravity.CENTER_HORIZONTAL; topMargin = top }

        pillLeft = left
        pillTop = top
        pillW = w
        pillMaxW = w
        pillCapW = w
        val dotPad = (h * 0.16f).roundToInt()
        for (d in dots) d.setPadding(dotPad, dotPad, dotPad, dotPad)
        pillH = h
        centerX = r.centerX()

        // раскрытая карточка — размеры по записи экрана острова Xiaomi (ширина экрана 1220 px: 1130 × 260, отступ сверху 18)
        cardW = (screenW * 0.9286f).roundToInt()
        cardH = (screenW * 0.2147f).roundToInt()
        cardTop = (screenW * 0.108f).roundToInt()
        cardR = screenW * 0.082f
        val btn = (screenW * 0.131f).roundToInt()
        val edge = (screenW * 0.041f).roundToInt()
        val gap = (screenW * 0.029f).roundToInt()
        val ic = (screenW * 0.123f).roundToInt()

        // большой размер окна с картинкой: рамка всего движения карточки (с запасом на отскок)
        winW = (cardW * 1.12f).roundToInt()
        winY = pillTop
        winH = (cardTop + cardH * 1.12f).roundToInt() - pillTop
        for (v in listOf<View>(cardIcon, cardTime, cardName, pauseBtn, stopBtn, cardBar, strip)) (v.parent as? ViewGroup)?.removeView(v)
        cardContent.removeAllViews()
        cardTime.setTextSize(TypedValue.COMPLEX_UNIT_PX, screenW * 0.0450f) // высота цифр как у настоящего (замер: 40 px при 1159; было 0.0483 — выше на 7 %)
        cardTime.letterSpacing = 0.06f // цифры у настоящего шире (125 px против 112 у копии)
        cardTime.fontFeatureSettings = "tnum"
        cardTime.strokePx = screenW * 0.0012f // чуть плотнее обычного, как время настоящего острова (0.0026 вышло слишком жирно)
        cardName.setTextSize(TypedValue.COMPLEX_UNIT_PX, screenW * 0.0354f) // как у настоящего острова (было 0.0328)
        cardTime.translationY = -screenW * 0.0017f
        cardName.translationY = -screenW * 0.0034f
        textMaxW = (cardW - screenW * 0.2f - (edge + 2 * btn + gap) - screenW * 0.02f).roundToInt() // текст карточки музыки не заходит под кнопки
        applyCardTextMode(cardMusicStyle == true)
        val texts = LinearLayout(appCtx).apply {
            orientation = LinearLayout.VERTICAL
            addView(cardTime)
            addView(cardName)
        }
        cardContent.addView(cardIcon, FrameLayout.LayoutParams(ic, ic).apply { gravity = Gravity.START or Gravity.CENTER_VERTICAL; marginStart = (screenW * 0.045f).roundToInt() })
        cardContent.addView(texts, FrameLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply {
            gravity = Gravity.START or Gravity.CENTER_VERTICAL
            marginStart = (screenW * 0.2f).roundToInt()
        })
        cardContent.addView(pauseBtn, FrameLayout.LayoutParams(btn, btn).apply { gravity = Gravity.END or Gravity.CENTER_VERTICAL; marginEnd = edge + btn + gap })
        cardContent.addView(stopBtn, FrameLayout.LayoutParams(btn, btn).apply { gravity = Gravity.END or Gravity.CENTER_VERTICAL; marginEnd = edge })
        (cardBar.background as? GradientDrawable)?.cornerRadius = screenW * 0.004f
        cardContent.addView(cardBar, FrameLayout.LayoutParams((screenW * 0.152f).roundToInt(), (screenW * 0.008f).roundToInt()).apply {
            gravity = Gravity.BOTTOM or Gravity.CENTER_HORIZONTAL
            bottomMargin = (screenW * 0.008f).roundToInt()
        })
        // ряд значков для переключения между занятиями (при двух и больше карточках) — вместо полоски
        cardContent.addView(strip, FrameLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, (screenW * 0.032f).roundToInt()).apply {
            gravity = Gravity.BOTTOM or Gravity.CENTER_HORIZONTAL
            bottomMargin = (screenW * 0.005f).roundToInt()
        })
        shownStrip = null
        card.removeView(cardContent)
        card.addView(cardContent, FrameLayout.LayoutParams(cardW, cardH).apply { gravity = Gravity.TOP or Gravity.CENTER_HORIZONTAL })
        card.layoutParams = FrameLayout.LayoutParams(w, h)
        fixPillMargin()
        applyProgress(progress)
    }
}

/** Текст с обводкой того же цвета: утолщает штрихи, когда системный шрифт не даёт жирного начертания. */
class StrokeText(context: android.content.Context) : TextView(context) {
    var strokePx = 0f
    override fun onDraw(canvas: android.graphics.Canvas) {
        val p = paint
        p.style = android.graphics.Paint.Style.FILL_AND_STROKE
        p.strokeWidth = strokePx
        p.strokeJoin = android.graphics.Paint.Join.ROUND
        super.onDraw(canvas)
    }
}

