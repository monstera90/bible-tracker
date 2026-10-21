package com.app.lifetracker
// Версия: 1.3 (21.10) — сверка со скриншотом острова: время 13sp жирное (высота цифр 32 px вместо 37), название обычным начертанием (вес 400), правая часть по размеру времени, название получает всё остальное место и не обрезается; плашка выше на 3 px, шире на 2 px. Откат: InAppIsland.kt 1.2.
// Версия: 1.2 (21.10) — подгонка по скриншотам настоящего острова и плашки: ширина 0.41, отступ сверху 0.007, боковые поля 0.024, значок 0.58 высоты, зазор до названия 0.0104 ширины экрана, время — обычное начертание (у острова не жирное). Откат: InAppIsland.kt 1.1.
// Версия: 1.1 (21.10) — размеры плашки считаются от ширины экрана (по замеру настоящего острова Poco X6 Pro: ширина 0.43, высота 0.086, отступ сверху 0.011 ширины экрана), а не от рамки выреза: система отдаёт рамку размером со всю строку состояния, плашка выходила огромной. Откат: InAppIsland.kt 1.0.
// Версия: 1.0 (21.10) — плашка таймера внутри приложения, пока оно на экране: чёрная «таблетка» вокруг выреза камеры (как свёрнутый остров Xiaomi) со значком, названием слева и временем справа; нажатие раскрывает карточку с большим значком, временем и кнопкой «Стоп». Без выреза сверху (поворот, телефон без выреза) плашки нет.

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
    private val pillTime = TextView(activity)
    private val card = LinearLayout(activity)
    private val cardIcon = ImageView(activity)
    private val cardTime = TextView(activity)
    private val cardName = TextView(activity)
    private val stopBtn = ImageView(activity)

    private var cutout: Rect? = null
    private var attached = false
    private var started = false
    private var expanded = false
    private var expandedAt = 0L
    private var currentId: String? = null
    private var shownStage = -1
    private var builtFor: Rect? = null

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
            typeface = weighted(400)
            maxLines = 1
            ellipsize = TextUtils.TruncateAt.END
        }
        pillTime.apply {
            setTextColor(Color.WHITE)
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 13f)
            typeface = weighted(700)
            maxLines = 1
        }

        card.orientation = LinearLayout.HORIZONTAL
        card.gravity = Gravity.CENTER_VERTICAL
        card.visibility = View.GONE
        card.isClickable = true // не пропускает нажатия на страницу под карточкой
        card.background = GradientDrawable().apply { setColor(Color.BLACK); cornerRadius = dp(34f).toFloat() }
        card.setPadding(dp(18f), dp(16f), dp(14f), dp(16f))
        cardTime.apply {
            setTextColor(Color.WHITE)
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 30f)
            maxLines = 1
        }
        cardName.apply {
            setTextColor(0xFF8A8A8A.toInt())
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 14f)
            maxLines = 1
            ellipsize = TextUtils.TruncateAt.END
        }
        val texts = LinearLayout(activity).apply {
            orientation = LinearLayout.VERTICAL
            addView(cardTime)
            addView(cardName)
        }
        stopBtn.apply {
            setImageBitmap(XiaomiIsland.crossBitmap())
            background = GradientDrawable().apply { shape = GradientDrawable.OVAL; setColor(0xFF2A2A2A.toInt()) }
            setPadding(dp(8f), dp(8f), dp(8f), dp(8f))
            setOnClickListener {
                val id = currentId
                if (id != null) CardTimers.cancel(activity.applicationContext, id)
                collapse()
                refresh()
            }
        }
        card.addView(cardIcon, LinearLayout.LayoutParams(dp(56f), dp(56f)))
        card.addView(texts, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f).apply { marginStart = dp(14f) })
        card.addView(stopBtn, LinearLayout.LayoutParams(dp(52f), dp(52f)))
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
        layer.visibility = View.GONE
        expanded = false
        card.visibility = View.GONE
    }

    private fun toggle() {
        expanded = !expanded
        expandedAt = System.currentTimeMillis()
        card.visibility = if (expanded) View.VISIBLE else View.GONE
        refresh()
    }

    private fun collapse() {
        expanded = false
        card.visibility = View.GONE
    }

    private fun refresh() {
        val r = cutout
        val info = CardTimers.primaryInfo(activity.applicationContext)
        if (r == null || info == null || !attached) {
            hide()
            return
        }
        currentId = info.id
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
        layer.visibility = View.VISIBLE
    }

    /** Размеры и места плашки и карточки считаются от выреза; пересчёт — только когда вырез поменялся. */
    private fun layoutFor(r: Rect) {
        if (builtFor == r) return
        builtFor = Rect(r)
        val screenW = activity.resources.displayMetrics.widthPixels
        // Рамка выреза у Xiaomi — размером со всю строку состояния, по ней плашка выходит огромной. Размеры берём
        // от ширины экрана, как у настоящего острова (замер на Poco X6 Pro: 500 × 105 px при ширине 1220, отступ сверху 13 px).
        val h = (screenW * 0.0886f).roundToInt()
        val w = (screenW * 0.4117f).roundToInt()
                val top = max(dp(2f), (screenW * 0.0061f).roundToInt())
        val left = r.centerX() - w / 2

        // дети переезжают в новые контейнеры: сначала отцепляем от старых (иначе addView бросает исключение)
        for (v in listOf<View>(pillIcon, pillName, pillTime)) (v.parent as? ViewGroup)?.removeView(v)
        pill.removeAllViews()
        pill.background = GradientDrawable().apply { setColor(Color.BLACK); cornerRadius = h / 2f }
        val side = (screenW * 0.024f).roundToInt()
        pill.setPadding(side, 0, side, 0)
        val iconSize = (h * 0.58f).roundToInt()
        val leftBox = LinearLayout(activity).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.START or Gravity.CENTER_VERTICAL
            addView(pillIcon, LinearLayout.LayoutParams(iconSize, iconSize))
            addView(pillName, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f).apply { marginStart = (screenW * 0.0104f).roundToInt() })
        }
        pillTime.setPadding((screenW * 0.02f).roundToInt(), 0, 0, 0)
        val rightBox = LinearLayout(activity).apply {
            gravity = Gravity.END or Gravity.CENTER_VERTICAL
            addView(pillTime)
        }
        pill.addView(leftBox, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.MATCH_PARENT, 1f))
        pill.addView(rightBox, LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.MATCH_PARENT))
        pill.layoutParams = FrameLayout.LayoutParams(w, h).apply { gravity = Gravity.TOP or Gravity.START; leftMargin = left; topMargin = top }

        card.layoutParams = FrameLayout.LayoutParams(screenW - 2 * dp(12f), ViewGroup.LayoutParams.WRAP_CONTENT).apply {
            gravity = Gravity.TOP or Gravity.START
            leftMargin = dp(12f)
            topMargin = top + h + dp(8f)
        }
    }
}
