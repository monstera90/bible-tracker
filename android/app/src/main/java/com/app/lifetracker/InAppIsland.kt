package com.app.lifetracker
// Версия: 8.6 (22.10) — свёрнутая плашка возвращена к виду 8.0–8.2 (13sp название, 12sp время, letterSpacing 0.08, отступы 0.0087/0.0272): она точно совпадала с настоящим островом, правки 8.3 и 8.5 её испортили. Раскрытая карточка (8.3–8.5) не тронута. Откат: InAppIsland.kt 8.5.
// Версия: 8.5 (22.10) — по замеру четырёх скриншотов (ширина 1159): название на плашке было мельче настоящего на ~14 % → 0.0350 × ширина экрана; время на плашке ниже на ~10 % и уже на ~19 % → 13.2sp, letterSpacing 0.13, tnum; время в карточке было выше на 7 % и уже на 12 % (вытянутые цифры) → размер 0.0450, letterSpacing 0.06, tnum. Откат: InAppIsland.kt 8.4.
// Версия: 8.4 (22.10) — время в раскрытой карточке: по скриншотам оно вышло жирнее и крупнее настоящего — обводка 0.0026 → 0.0012 × ширина экрана, размер 0.0508 → 0.0483. Откат: InAppIsland.kt 8.3.
// Версия: 8.3 (22.10) — название таймера как у настоящего острова (по записи экрана): на плашке крупнее на ~5 % (0.0307 × ширина экрана вместо 13sp), на 2,5 px правее и на ~3 px выше, время на ~6 px левее; в карточке название крупнее на ~8 % и выше на ~4 px, время выше на ~2 px. Откат: InAppIsland.kt 8.2.
// Версия: 8.2 (22.10) — время в раскрытой карточке жирнее, как у настоящего острова Xiaomi: `cardTime` — `StrokeText` (обводка `strokePx = screenW × 0.0026`); размер прежний 0.0508 × ширина экрана (шрифт настоящего острова задаёт система, увеличить его из приложения нельзя). Откат: InAppIsland.kt 8.0.
// Версия: 8.0 (22.10) — карточка и плашка больше не полупрозрачные. Причина: с Android 12 окно поверх всех (TYPE_APPLICATION_OVERLAY) с FLAG_NOT_TOUCHABLE система само принудительно делает непрозрачным не больше чем на 80 % (alpha ≤ 0.8). Теперь окно с картинкой ПРИНИМАЕТ нажатия (без FLAG_NOT_TOUCHABLE, alpha 1): в покое свёрнутой плашки оно ровно по плашке, на время анимации и пока карточка раскрыта — рамка всего движения (меняет размер только когда раскладка внутри неё не меняется: p=0 ↔ плашка в углу окна). Отдельные окна нажатий (touchView) убраны, кнопки «пауза»/«стоп» — обычные View-клики, нажатие мимо карточки внутри окна и ACTION_OUTSIDE сворачивают. Откат: InAppIsland.kt 7.1.
// Версия: 7.1 (22.10) — (1) убрано проявление окна (alpha 0→1 за 140 мс): карточка на раскрытии выглядела полупрозрачной; (2) плашка больше не раскрывается сама при запуске таймера — остаётся свёрнутой, раскрывается только нажатием. Откат: InAppIsland.kt 7.0.
// Версия: 7.0 (22.10) — дрожание на смене размера: по записи экрана на последнем кадре сворачивания плашка на один кадр прыгала к левому краю (размер/положение окна и раскладка внутри него применялись не одновременно). Теперь окно с картинкой (`layer`) одно большое и НИКОГДА не меняет размер и положение, а нажатия принимают отдельные прозрачные окна (`touchView`: под плашкой — тап раскрывает; под карточкой — кнопки «пауза»/«стоп» по координатам `pauseRect`/`stopRect`, нажатие мимо сворачивает); окно с картинкой — FLAG_NOT_TOUCHABLE. Плашка рисуется поверх карточки, поэтому её значок и текст плавно проявляются при сворачивании, а не появляются рывком. Откат: InAppIsland.kt 6.0.
// Версия: 6.0 (22.10) — против мерцания копии острова: (1) вырез на миг пропадает при пересчёте WindowInsets (открытие приложения, прятание панелей) — раньше это сразу убирало окно и плашка пропадала и появлялась заново, теперь `setCutout(null)` ждёт 400 мс (`hideAfterCutoutLoss`); (2) тексты и кольцо паузы перерисовываются только когда изменились (раньше каждые 500 мс — лишние раскладки окна); (3) первое появление окна — короткое проявление 140 мс, а не резкое «вспыхивание». Откат: InAppIsland.kt 5.0.
// Версия: 5.0 (21.10) — как у оригинала: (1) анимация раскрытия/сворачивания идёт по кадрам Choreographer (не зависит от выключенных анимаций системы), а окно на время анимации равно рамке всего движения — раньше оно ресайзилось покадрово с задержкой, карточка обрезалась и «прыгала»; (2) карточка не гаснет по таймеру, а сворачивается нажатием в любое место мимо неё (FLAG_WATCH_OUTSIDE_TOUCH → ACTION_OUTSIDE; касание при этом работает как обычно); таймер 6 с остался только в запасном режиме без разрешения; (3) окно раскрытой карточки начинается с её верха, а не с верха экрана — строка состояния по бокам и над карточкой снова тянет шторку. Откат: InAppIsland.kt 4.1.
// Версия: 4.1 (21.10) — раскрытая карточка стоит ниже, как у настоящего острова под строкой состояния: отступ сверху 0.108 ширины экрана (было 0.0148), высота 0.2147, ширина 0.9286 (замер по скриншоту: верх 126, высота 247, ширина 1074 при ширине 1159). Откат: InAppIsland.kt 4.0.
// Версия: 4.0 (21.10) — плашка живёт в собственном окне поверх всех (TYPE_APPLICATION_OVERLAY, разрешение «Поверх других приложений»), размером ровно с плашку/карточку, поэтому нажатие по ней доходит (окно строки состояния перехватывало касания к окну приложения). Без разрешения — запасной вариант в decorView (виден, но не нажимается; автораскрытие при запуске таймера остаётся); при первом показе один раз предлагается выдать разрешение. Окно убирается в onPause. Откат: InAppIsland.kt 3.1.
// Версия: 3.1 (21.10) — плашка раскрывается сама, когда таймер только что запущен (первые 3 с), как «всплытие» настоящего острова: нажатие на саму плашку до приложения не доходит, пока видна системная строка состояния (окно SystemUI сверху перехватывает касания). Раскрытая карточка ниже строки состояния — кнопки нажимаются. Откат: InAppIsland.kt 3.0.
// Версия: 3.0 (21.10) — раскрытие как у острова Xiaomi (по записи экрана): плашка плавно растёт в широкую карточку на месте (ширина 0.926 экрана, высота 0.213, радиус 0.082, отскок на раскрытии), содержимое проявляется после 30% пути, плашка гаснет; внутри значок, время, название, круглая кнопка паузы/«продолжить» с кольцом остатка, «Стоп», полоска внизу; нажатие мимо кнопок или 6 с — сворачивание обратно в плашку. Откат: InAppIsland.kt 2.0.
// Версия: 2.0 (21.10) — жирное время рисуется обводкой (`StrokeText`): HyperOS игнорирует жирное начертание у системного шрифта, цифры выходили тонкими. Время 12sp + обводка 0.0021 ширины экрана + разрядка 0.08 (шире, как у острова), правое поле 0.0272, текст на ~1,5 px выше (плашка 0.0077 сверху, высота 0.0878, без верхнего отступа). Откат: InAppIsland.kt 1.4.
// Версия: 1.4 (21.10) — вторая сверка со скриншотом: время сдвинуто влево на 11 px (правое поле 0.0335 ширины), начертание не через вес (HyperOS его игнорировал): время — sans-serif BOLD, название — sans-serif-medium; значок 0.57 высоты и на пиксель ниже, плашка на пиксель ниже. Откат: InAppIsland.kt 1.3.
// Версия: 1.3 (21.10) — сверка со скриншотом острова: время 13sp жирное (высота цифр 32 px вместо 37), название обычным начертанием (вес 400), правая часть по размеру времени, название получает всё остальное место и не обрезается; плашка выше на 3 px, шире на 2 px. Откат: InAppIsland.kt 1.2.
// Версия: 1.2 (21.10) — подгонка по скриншотам настоящего острова и плашки: ширина 0.41, отступ сверху 0.007, боковые поля 0.024, значок 0.58 высоты, зазор до названия 0.0104 ширины экрана, время — обычное начертание (у острова не жирное). Откат: InAppIsland.kt 1.1.
// Версия: 1.1 (21.10) — размеры плашки считаются от ширины экрана (по замеру настоящего острова Poco X6 Pro: ширина 0.43, высота 0.086, отступ сверху 0.011 ширины экрана), а не от рамки выреза: система отдаёт рамку размером со всю строку состояния, плашка выходила огромной. Откат: InAppIsland.kt 1.0.
// Версия: 1.0 (21.10) — плашка таймера внутри приложения, пока оно на экране: чёрная «таблетка» вокруг выреза камеры (как свёрнутый остров Xiaomi) со значком, названием слева и временем справа; нажатие раскрывает карточку с большим значком, временем и кнопкой «Стоп». Без выреза сверху (поворот, телефон без выреза) плашки нет.

import android.app.Activity
import android.app.AlertDialog
import android.content.Context
import android.content.Intent
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
import android.view.Choreographer
import android.os.SystemClock
import android.view.animation.AccelerateDecelerateInterpolator
import android.view.animation.OvershootInterpolator
import android.widget.FrameLayout
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.TextView
import kotlin.math.max
import kotlin.math.roundToInt

class InAppIsland(private val activity: Activity) {

    private val handler = Handler(Looper.getMainLooper())
    private val density = activity.resources.displayMetrics.density

    private val layer = FrameLayout(activity)
    private val pill = LinearLayout(activity)
    private val pillIcon = ImageView(activity)
    private val pillName = TextView(activity)
    private val pillTime = StrokeText(activity)
    private val card = FrameLayout(activity)
    private val cardContent = FrameLayout(activity)
    private val cardIcon = ImageView(activity)
    private val cardTime = StrokeText(activity)
    private val cardName = TextView(activity)
    private val pauseBtn = ImageView(activity)
    private val stopBtn = ImageView(activity)
    private val cardBg = GradientDrawable().apply { setColor(Color.BLACK) }

    // геометрия плашки и карточки (px), считается в layoutFor
    private var pillLeft = 0
    private var pillTop = 0
    private var pillW = 0
    private var pillH = 0
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
    private var currentId: String? = null
    private var shownStage = -1
    private var builtFor: Rect? = null
    private var paused = false
    private var autoShownFor: String? = null
    private var shownClock: String? = null
    private var shownTitle: String? = null
    private var shownCardName: String? = null
    private var shownPauseKey: String? = null
    private var scrW = 0

    private fun dp(v: Float) = (v * density).roundToInt()

    /** Начертание нужного веса (как у системного острова: название 400, время 700); на старых Android — обычное/жирное. */
    private fun weighted(weight: Int): Typeface =
        if (android.os.Build.VERSION.SDK_INT >= 28) Typeface.create(Typeface.DEFAULT, weight, false)
        else Typeface.create(Typeface.DEFAULT, if (weight >= 600) Typeface.BOLD else Typeface.NORMAL)

    init {
        layer.visibility = View.GONE
        pill.orientation = LinearLayout.HORIZONTAL
        pill.gravity = Gravity.CENTER_VERTICAL
        pill.setOnClickListener { if (!animating) toggle() }
        layer.setOnTouchListener { _, e -> onLayerTouch(e) }
        pillName.apply {
            setTextColor(Color.WHITE)
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 13f)
            typeface = Typeface.create("sans-serif-medium", Typeface.NORMAL)
            maxLines = 1
            ellipsize = TextUtils.TruncateAt.END
        }
        pillTime.apply {
            setTextColor(Color.WHITE)
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 12f)
            typeface = Typeface.DEFAULT
            letterSpacing = 0.08f
            maxLines = 1
        }

        card.visibility = View.GONE
        card.background = cardBg
        card.isClickable = true // не пропускает нажатия на страницу под карточкой; нажатие мимо кнопок сворачивает
        card.setOnClickListener { } // касание карточки (мимо кнопок) ничего не делает; сворачивает нажатие мимо неё
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
        card.addView(cardContent)
        layer.addView(card)
        layer.addView(pill) // плашка выше карточки: её значок и текст проявляются/гаснут поверх, а не появляются рывком
    }

    /** Рамка выреза камеры (координаты окна) из WindowInsets; null — выреза сверху нет. */
    fun setCutout(rect: Rect?) {
        if (rect != null) {
            handler.removeCallbacks(hideAfterCutoutLoss)
            cutout = rect
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
        handler.post(tick)
    }

    fun stop() {
        started = false
        handler.removeCallbacks(tick)
        handler.removeCallbacks(hideAfterCutoutLoss)
        hide()
    }

    private val tick = object : Runnable {
        override fun run() {
            if (!started) return
            try {
                refresh()
            } catch (e: Exception) {
                hide() // плашка — украшение: любая ошибка не должна мешать приложению
            }
            handler.postDelayed(this, 500L)
        }
    }

    private fun wm() = activity.getSystemService(Context.WINDOW_SERVICE) as WindowManager

    private fun canOverlay(): Boolean = try {
        Build.VERSION.SDK_INT < 23 || Settings.canDrawOverlays(activity)
    } catch (e: Exception) {
        false
    }

    /** Ставит слой в нужное место: своё окно поверх всех (нажимается) или, без разрешения, decorView. */
    private fun attach() {
        val want = if (canOverlay()) 2 else 1
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
                wl.y = winY
                if (Build.VERSION.SDK_INT >= 28) wl.layoutInDisplayCutoutMode = WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES
                winLp = wl
                wm().addView(layer, wl)
            } else {
                (activity.window.decorView as ViewGroup).addView(
                    layer, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
                )
            }
            attached = true
        } catch (e: Exception) {
            mode = 0 // окно не готово или разрешение отозвано: попробуем при следующем обновлении
        }
    }

    private fun detach() {
        if (!attached) return
        try {
            if (mode == 2) wm().removeViewImmediate(layer) else (layer.parent as? ViewGroup)?.removeView(layer)
        } catch (e: Exception) {
        }
        attached = false
        mode = 0
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
        if (lp.width == w && lp.height == h) return
        lp.width = w
        lp.height = h
        try {
            wm().updateViewLayout(layer, lp)
        } catch (e: Exception) {
        }
    }

    /** Нажатия, до которых не дошли плашка и карточка: мимо раскрытой карточки (в запасе окна или снаружи) — сворачивает. */
    private fun onLayerTouch(e: MotionEvent): Boolean {
        if (mode != 2) return false
        when (e.actionMasked) {
            MotionEvent.ACTION_OUTSIDE -> if (expanded && !animating) collapse()
            MotionEvent.ACTION_DOWN -> if (expanded && !animating) collapse()
        }
        return true
    }

    private fun onPauseClick() {
        val id = currentId
        if (id != null) {
            val ctx = activity.applicationContext
            if (paused) CardTimers.resume(ctx, id) else CardTimers.pause(ctx, id)
        }
        expandedAt = System.currentTimeMillis()
        refresh()
    }

    private fun onStopClick() {
        val id = currentId
        if (id != null) CardTimers.cancel(activity.applicationContext, id)
        collapse()
        refresh()
    }

    /** Один раз предлагает выдать разрешение «Поверх других приложений» — без него плашку нельзя нажать. */
    private fun askOverlayOnce() {
        if (Build.VERSION.SDK_INT < 23 || canOverlay() || activity.isFinishing) return
        val prefs = activity.getSharedPreferences("island", Context.MODE_PRIVATE)
        if (prefs.getBoolean("asked", false)) return
        prefs.edit().putBoolean("asked", true).apply()
        try {
            AlertDialog.Builder(activity)
                .setTitle("Плашка таймера")
                .setMessage("Чтобы плашку сверху можно было нажимать и раскрывать, разрешите приложению «Поверх других приложений».")
                .setPositiveButton("Открыть настройки") { _, _ ->
                    try {
                        activity.startActivity(Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION, Uri.parse("package:" + activity.packageName)))
                    } catch (e: Exception) {
                    }
                }
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
        if (mode == 2) detach() // окно поверх всех не должно оставаться и перехватывать касания
    }

    private fun toggle() {
        if (expanded) collapse() else expand()
    }

    private fun expand() {
        if (expanded) return
        expanded = true
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

    private fun fixPillMargin() {
        val lp = pill.layoutParams as? FrameLayout.LayoutParams ?: return
        lp.topMargin = if (mode == 2) 0 else pillTop // в своём окне плашка стоит у верха окна
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
        lp.leftMargin = 0
        lp.topMargin = top - (if (mode == 2) pillTop else 0) // в своём окне отсчёт от верха окна (он на уровне плашки)
        card.layoutParams = lp
        cardBg.cornerRadius = lerp(pillH / 2f, cardR, p.coerceIn(0f, 1f))
        cardContent.alpha = ((p - 0.3f) / 0.7f).coerceIn(0f, 1f)
        val pillAlpha = (1f - p / 0.25f).coerceIn(0f, 1f)
        pill.alpha = pillAlpha
        pill.visibility = if (pillAlpha <= 0f) View.INVISIBLE else View.VISIBLE
    }

    private fun refresh() {
        val r = cutout
        val info = CardTimers.primaryInfo(activity.applicationContext)
        if (info == null) autoShownFor = null
        if (r == null || info == null) {
            hide()
            return
        }
        layoutFor(r)
        attach()
        if (!attached) {
            hide()
            return
        }
        askOverlayOnce()
        currentId = info.id
        paused = !info.running
        if (expanded && mode == 1 && System.currentTimeMillis() - expandedAt > 6000L) collapse() // без окна поверх всех «мимо» не поймать — по таймеру
        val stage = XiaomiIsland.stageFor(info.leftMs)
        if (stage != shownStage) {
            shownStage = stage
            pillIcon.setImageBitmap(XiaomiIsland.iconBitmap(stage, 96))
            cardIcon.setImageBitmap(XiaomiIsland.iconBitmap(stage, 192))
        }
        // менять View только когда значение изменилось: каждый setText/setImageBitmap — лишняя раскладка и перерисовка окна
        val clock = XiaomiIsland.clockText(info.leftMs)
        if (clock != shownClock) {
            shownClock = clock
            pillTime.text = clock
            cardTime.text = clock
        }
        if (info.title != shownTitle) {
            shownTitle = info.title
            pillName.text = info.title
        }
        val cardNameText = if (info.running) info.title else info.title + " · пауза"
        if (cardNameText != shownCardName) {
            shownCardName = cardNameText
            cardName.text = cardNameText
        }
        if (card.visibility == View.VISIBLE) {
            val fraction = (if (info.totalMs > 0) info.leftMs.toFloat() / info.totalMs else 1f).coerceIn(0f, 1f)
            val pauseKey = "" + (fraction * 200f).roundToInt() + "/" + stage + "/" + paused
            if (pauseKey != shownPauseKey) {
                shownPauseKey = pauseKey
                pauseBtn.setImageBitmap(XiaomiIsland.pauseBitmap(fraction, stage, paused))
            }
        }
        layer.visibility = View.VISIBLE
    }

    /** Размеры и места плашки и карточки считаются от выреза; пересчёт — только когда вырез поменялся. */
    private fun layoutFor(r: Rect) {
        if (builtFor == r) return
        builtFor = Rect(r)
        if (attached) detach() // геометрия поменялась: окно с картинкой создаётся заново уже нужного размера
        val screenW = activity.resources.displayMetrics.widthPixels
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
        pill.setPadding(side, 0, (screenW * 0.0272f).roundToInt(), 0)
        pillTime.strokePx = screenW * 0.0021f
        val iconSize = (h * 0.57f).roundToInt()
        val leftBox = LinearLayout(activity).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.START or Gravity.CENTER_VERTICAL
            addView(pillIcon, LinearLayout.LayoutParams(iconSize, iconSize))
            addView(pillName, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f).apply { marginStart = (screenW * 0.0087f).roundToInt() })
        }
        pillTime.setPadding((screenW * 0.02f).roundToInt(), 0, 0, 0)
        val rightBox = LinearLayout(activity).apply {
            gravity = Gravity.END or Gravity.CENTER_VERTICAL
            addView(pillTime)
        }
        pill.addView(leftBox, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.MATCH_PARENT, 1f))
        pill.addView(rightBox, LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.MATCH_PARENT))
        pill.layoutParams = FrameLayout.LayoutParams(w, h).apply { gravity = Gravity.TOP or Gravity.CENTER_HORIZONTAL; topMargin = top }

        pillLeft = left
        pillTop = top
        pillW = w
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
        for (v in listOf<View>(cardIcon, cardTime, cardName, pauseBtn, stopBtn)) (v.parent as? ViewGroup)?.removeView(v)
        cardContent.removeAllViews()
        cardTime.setTextSize(TypedValue.COMPLEX_UNIT_PX, screenW * 0.0450f) // высота цифр как у настоящего (замер: 40 px при 1159; было 0.0483 — выше на 7 %)
        cardTime.letterSpacing = 0.06f // цифры у настоящего шире (125 px против 112 у копии)
        cardTime.fontFeatureSettings = "tnum"
        cardTime.strokePx = screenW * 0.0012f // чуть плотнее обычного, как время настоящего острова (0.0026 вышло слишком жирно)
        cardName.setTextSize(TypedValue.COMPLEX_UNIT_PX, screenW * 0.0354f) // как у настоящего острова (было 0.0328)
        cardTime.translationY = -screenW * 0.0017f
        cardName.translationY = -screenW * 0.0034f
        val texts = LinearLayout(activity).apply {
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
        val bar = View(activity).apply { background = GradientDrawable().apply { setColor(0xFF3A3A3A.toInt()); cornerRadius = screenW * 0.004f } }
        cardContent.addView(bar, FrameLayout.LayoutParams((screenW * 0.152f).roundToInt(), (screenW * 0.008f).roundToInt()).apply {
            gravity = Gravity.BOTTOM or Gravity.CENTER_HORIZONTAL
            bottomMargin = (screenW * 0.008f).roundToInt()
        })
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
