package com.app.lifetracker
// Версия: 3.0 (21.10) — раскрытие как у острова Xiaomi (по записи экрана): плашка плавно растёт в широкую карточку на месте (ширина 0.926 экрана, высота 0.213, радиус 0.082, отскок на раскрытии), содержимое проявляется после 30% пути, плашка гаснет; внутри значок, время, название, круглая кнопка паузы/«продолжить» с кольцом остатка, «Стоп», полоска внизу; нажатие мимо кнопок или 6 с — сворачивание обратно в плашку. Откат: InAppIsland.kt 2.0.
// Версия: 2.0 (21.10) — жирное время рисуется обводкой (`StrokeText`): HyperOS игнорирует жирное начертание у системного шрифта, цифры выходили тонкими. Время 12sp + обводка 0.0021 ширины экрана + разрядка 0.08 (шире, как у острова), правое поле 0.0272, текст на ~1,5 px выше (плашка 0.0077 сверху, высота 0.0878, без верхнего отступа). Откат: InAppIsland.kt 1.4.
// Версия: 1.4 (21.10) — вторая сверка со скриншотом: время сдвинуто влево на 11 px (правое поле 0.0335 ширины), начертание не через вес (HyperOS его игнорировал): время — sans-serif BOLD, название — sans-serif-medium; значок 0.57 высоты и на пиксель ниже, плашка на пиксель ниже. Откат: InAppIsland.kt 1.3.
// Версия: 1.3 (21.10) — сверка со скриншотом острова: время 13sp жирное (высота цифр 32 px вместо 37), название обычным начертанием (вес 400), правая часть по размеру времени, название получает всё остальное место и не обрезается; плашка выше на 3 px, шире на 2 px. Откат: InAppIsland.kt 1.2.
// Версия: 1.2 (21.10) — подгонка по скриншотам настоящего острова и плашки: ширина 0.41, отступ сверху 0.007, боковые поля 0.024, значок 0.58 высоты, зазор до названия 0.0104 ширины экрана, время — обычное начертание (у острова не жирное). Откат: InAppIsland.kt 1.1.
// Версия: 1.1 (21.10) — размеры плашки считаются от ширины экрана (по замеру настоящего острова Poco X6 Pro: ширина 0.43, высота 0.086, отступ сверху 0.011 ширины экрана), а не от рамки выреза: система отдаёт рамку размером со всю строку состояния, плашка выходила огромной. Откат: InAppIsland.kt 1.0.
// Версия: 1.0 (21.10) — плашка таймера внутри приложения, пока оно на экране: чёрная «таблетка» вокруг выреза камеры (как свёрнутый остров Xiaomi) со значком, названием слева и временем справа; нажатие раскрывает карточку с большим значком, временем и кнопкой «Стоп». Без выреза сверху (поворот, телефон без выреза) плашки нет.

import android.animation.ValueAnimator
import android.app.Activity
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
    private val cardTime = TextView(activity)
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
    private var anim: ValueAnimator? = null

    private var cutout: Rect? = null
    private var attached = false
    private var started = false
    private var expanded = false
    private var expandedAt = 0L
    private var currentId: String? = null
    private var shownStage = -1
    private var builtFor: Rect? = null
    private var paused = false

    private fun dp(v: Float) = (v * density).roundToInt()

    /** Начертание нужного веса (как у системного острова: название 400, время 700); на старых Android — обычное/жирное. */
    private fun weighted(weight: Int): Typeface =
        if (android.os.Build.VERSION.SDK_INT >= 28) Typeface.create(Typeface.DEFAULT, weight, false)
        else Typeface.create(Typeface.DEFAULT, if (weight >= 600) Typeface.BOLD else Typeface.NORMAL)

    init {
        layer.visibility = View.GONE
        pill.orientation = LinearLayout.HORIZONTAL
        pill.gravity = Gravity.CENTER_VERTICAL
        pill.setOnClickListener { toggle() }
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
        card.setOnClickListener { collapse() }
        cardTime.apply {
            setTextColor(Color.WHITE)
            maxLines = 1
        }
        cardName.apply {
            setTextColor(0xFF8A8A8A.toInt())
            maxLines = 1
            ellipsize = TextUtils.TruncateAt.END
        }
        pauseBtn.setOnClickListener {
            val id = currentId
            if (id != null) {
                val ctx = activity.applicationContext
                if (paused) CardTimers.resume(ctx, id) else CardTimers.pause(ctx, id)
            }
            expandedAt = System.currentTimeMillis()
            refresh()
        }
        stopBtn.apply {
            setImageBitmap(XiaomiIsland.crossBitmap())
            setOnClickListener {
                val id = currentId
                if (id != null) CardTimers.cancel(activity.applicationContext, id)
                collapse()
                refresh()
            }
        }
        card.addView(cardContent)
        layer.addView(pill)
        layer.addView(card)
    }

    /** Рамка выреза камеры (координаты окна) из WindowInsets; null — выреза сверху нет. */
    fun setCutout(rect: Rect?) {
        cutout = rect
        if (rect == null) hide()
    }

    fun start() {
        if (started) return
        started = true
        attach()
        handler.post(tick)
    }

    fun stop() {
        started = false
        handler.removeCallbacks(tick)
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

    private fun attach() {
        if (attached) return
        try {
            (activity.window.decorView as ViewGroup).addView(
                layer, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
            )
            attached = true
        } catch (e: Exception) {
            // окно не готово: попробуем при следующем запуске
        }
    }

    private fun hide() {
        anim?.cancel()
        anim = null
        layer.visibility = View.GONE
        expanded = false
        progress = 0f
        card.visibility = View.GONE
        pill.alpha = 1f
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

    private fun animateTo(target: Float, duration: Long, interpolator: android.view.animation.Interpolator) {
        anim?.cancel()
        val a = ValueAnimator.ofFloat(progress, target)
        a.duration = duration
        a.interpolator = interpolator
        a.addUpdateListener { applyProgress(it.animatedValue as Float) }
        a.addListener(object : android.animation.AnimatorListenerAdapter() {
            private var cancelled = false
            override fun onAnimationCancel(animation: android.animation.Animator) { cancelled = true }
            override fun onAnimationEnd(animation: android.animation.Animator) {
                if (cancelled) return
                applyProgress(target)
                if (target == 0f) card.visibility = View.GONE
            }
        })
        anim = a
        a.start()
    }

    private fun lerp(a: Float, b: Float, p: Float) = a + (b - a) * p

    /** p = 0 — карточка точно по плашке, p = 1 — раскрыта (на отскоке p чуть больше 1). */
    private fun applyProgress(p: Float) {
        progress = p
        if (cardW == 0) return
        val w = lerp(pillW.toFloat(), cardW.toFloat(), p).roundToInt().coerceAtLeast(pillW)
        val h = lerp(pillH.toFloat(), cardH.toFloat(), p).roundToInt().coerceAtLeast(pillH)
        val top = lerp(pillTop.toFloat(), cardTop.toFloat(), p).roundToInt()
        val lp = card.layoutParams as FrameLayout.LayoutParams
        lp.width = w
        lp.height = h
        lp.gravity = Gravity.TOP or Gravity.START
        lp.leftMargin = centerX - w / 2
        lp.topMargin = top
        card.layoutParams = lp
        cardBg.cornerRadius = lerp(pillH / 2f, cardR, p.coerceIn(0f, 1f))
        cardContent.alpha = ((p - 0.3f) / 0.7f).coerceIn(0f, 1f)
        pill.alpha = (1f - p / 0.25f).coerceIn(0f, 1f)
    }

    private fun refresh() {
        val r = cutout
        val info = CardTimers.primaryInfo(activity.applicationContext)
        if (r == null || info == null || !attached) {
            hide()
            return
        }
        currentId = info.id
        paused = !info.running
        if (expanded && System.currentTimeMillis() - expandedAt > 6000L) collapse()
        layoutFor(r)
        val stage = XiaomiIsland.stageFor(info.leftMs)
        if (stage != shownStage) {
            shownStage = stage
            pillIcon.setImageBitmap(XiaomiIsland.iconBitmap(stage, 96))
            cardIcon.setImageBitmap(XiaomiIsland.iconBitmap(stage, 192))
        }
        val clock = XiaomiIsland.clockText(info.leftMs)
        pillName.text = info.title
        pillTime.text = clock
        cardTime.text = clock
        cardName.text = if (info.running) info.title else info.title + " · пауза"
        if (card.visibility == View.VISIBLE) {
            val fraction = if (info.totalMs > 0) info.leftMs.toFloat() / info.totalMs else 1f
            pauseBtn.setImageBitmap(XiaomiIsland.pauseBitmap(fraction.coerceIn(0f, 1f), stage, paused))
        }
        layer.visibility = View.VISIBLE
    }

    /** Размеры и места плашки и карточки считаются от выреза; пересчёт — только когда вырез поменялся. */
    private fun layoutFor(r: Rect) {
        if (builtFor == r) return
        builtFor = Rect(r)
        val screenW = activity.resources.displayMetrics.widthPixels
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
        pill.layoutParams = FrameLayout.LayoutParams(w, h).apply { gravity = Gravity.TOP or Gravity.START; leftMargin = left; topMargin = top }

        pillLeft = left
        pillTop = top
        pillW = w
        pillH = h
        centerX = r.centerX()

        // раскрытая карточка — размеры по записи экрана острова Xiaomi (ширина экрана 1220 px: 1130 × 260, отступ сверху 18)
        cardW = (screenW * 0.926f).roundToInt()
        cardH = (screenW * 0.213f).roundToInt()
        cardTop = (screenW * 0.0148f).roundToInt()
        cardR = screenW * 0.082f
        val btn = (screenW * 0.131f).roundToInt()
        val edge = (screenW * 0.041f).roundToInt()
        val gap = (screenW * 0.029f).roundToInt()
        val ic = (screenW * 0.123f).roundToInt()

        for (v in listOf<View>(cardIcon, cardTime, cardName, pauseBtn, stopBtn)) (v.parent as? ViewGroup)?.removeView(v)
        cardContent.removeAllViews()
        cardTime.setTextSize(TypedValue.COMPLEX_UNIT_PX, screenW * 0.0508f)
        cardName.setTextSize(TypedValue.COMPLEX_UNIT_PX, screenW * 0.0328f)
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
