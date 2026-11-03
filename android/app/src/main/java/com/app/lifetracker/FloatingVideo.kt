package com.app.lifetracker
// Версия: 1.0 (03.11)

import android.app.AlertDialog
import android.content.Context
import android.content.Intent
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Outline
import android.graphics.Paint
import android.graphics.Path
import android.graphics.PixelFormat
import android.net.Uri
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import android.view.Gravity
import android.view.MotionEvent
import android.view.View
import android.view.ViewGroup
import android.view.ViewOutlineProvider
import android.view.WindowManager
import android.webkit.WebView
import android.widget.FrameLayout
import kotlin.math.hypot
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt

/**
 * Плавающее окно («остров») с видео вкладки-сайта. Само видео не копируется: в окно переезжает ВЕСЬ WebView вкладки (так звук, кадры
 * и состояние страницы остаются те же), а страница скриптом (UserTabs.PIN_JS) оставляет на экране только видео в левом верхнем углу.
 * WebView сохраняет свой прежний размер (страница не перестраивается), а окно показывает его уменьшенную копию — масштаб `scaleX/scaleY`
 * от угла (0, 0), обрезанную по размеру видео.
 *
 * Окно — отдельное, поверх всех приложений (TYPE_APPLICATION_OVERLAY, разрешение «Поверх других приложений»); без разрешения —
 * запасной вариант в decorView (видно только пока приложение на экране). Тап — показать кнопки (пауза, «развернуть» во вкладку,
 * закрыть), перетаскивание — двигать, уголок справа внизу — менять размер. Положение и ширина запоминаются.
 */
class FloatingVideo(private val activity: MainActivity, private val callback: Callback) {

    interface Callback {
        /** «Развернуть»: вернуться во вкладку-сайт. */
        fun onExpand()

        /** «Закрыть»: поставить видео на паузу и убрать окно. */
        fun onClose()

        /** Пауза/воспроизведение. */
        fun onTogglePlay()
    }

    companion object {
        private const val PREFS = "video_island"
        private const val KEY_X = "x"
        private const val KEY_Y = "y"
        private const val KEY_W = "w"          // ширина окна — доля короткой стороны экрана
        private const val KEY_ASKED = "asked"
        private const val CONTROLS_MS = 3000L
        private const val MIN_W_DP = 120f
        private const val K_PLAY = 0
        private const val K_CLOSE = 1
        private const val K_EXPAND = 2
        private const val K_HANDLE = 3
    }

    private val dm get() = activity.resources.displayMetrics
    private val d: Float get() = dm.density
    private val prefs = activity.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    private val handler = Handler(Looper.getMainLooper())

    private val box = FrameLayout(activity)
    private val touchLayer = View(activity)
    private val controls = FrameLayout(activity)
    private val playBtn = Glyph(K_PLAY)
    private val closeBtn = Glyph(K_CLOSE)
    private val expandBtn = Glyph(K_EXPAND)
    private val handle = Glyph(K_HANDLE)
    private val hideControlsTask = Runnable { controls.visibility = View.GONE }

    private var mode = 0 // 0 — окна нет, 1 — своё окно поверх всех, 2 — в decorView приложения
    private var lp: WindowManager.LayoutParams? = null
    private var web: WebView? = null
    private var fullW = 1 // видимая область в полном размере (px WebView): видео
    private var fullH = 1
    private var curW = 1  // размер окна сейчас
    private var curH = 1
    private var posX = 0
    private var posY = 0

    private var downRawX = 0f
    private var downRawY = 0f
    private var startX = 0
    private var startY = 0
    private var moved = false
    private var rzDownX = 0f
    private var rzW0 = 0

    val isShown: Boolean get() = mode != 0

    init {
        val radius = 12f * d
        box.setBackgroundColor(Color.BLACK)
        box.outlineProvider = object : ViewOutlineProvider() {
            override fun getOutline(view: View, outline: Outline) {
                outline.setRoundRect(0, 0, view.width, view.height, radius)
            }
        }
        box.clipToOutline = true

        box.addView(touchLayer, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
        controls.setBackgroundColor(0x59000000)
        box.addView(controls, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))

        val btn = (30f * d).roundToInt()
        val big = (40f * d).roundToInt()
        val grip = (34f * d).roundToInt()
        val m = (6f * d).roundToInt()
        controls.addView(closeBtn, FrameLayout.LayoutParams(btn, btn, Gravity.TOP or Gravity.START).apply { setMargins(m, m, 0, 0) })
        controls.addView(expandBtn, FrameLayout.LayoutParams(btn, btn, Gravity.TOP or Gravity.END).apply { setMargins(0, m, m, 0) })
        controls.addView(playBtn, FrameLayout.LayoutParams(big, big, Gravity.CENTER))
        controls.addView(handle, FrameLayout.LayoutParams(grip, grip, Gravity.BOTTOM or Gravity.END))

        closeBtn.setOnClickListener { callback.onClose() }
        expandBtn.setOnClickListener { callback.onExpand() }
        playBtn.setOnClickListener {
            armHide()
            callback.onTogglePlay()
        }
        touchLayer.setOnTouchListener { _, e -> onDrag(e) }
        handle.setOnTouchListener { _, e -> onResize(e) }
    }

    private fun wm() = activity.getSystemService(Context.WINDOW_SERVICE) as WindowManager

    fun canOverlay(): Boolean = try {
        Build.VERSION.SDK_INT < 23 || Settings.canDrawOverlays(activity)
    } catch (e: Exception) {
        false
    }

    private fun windowType(): Int =
        if (Build.VERSION.SDK_INT >= 26) WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY else WindowManager.LayoutParams.TYPE_PHONE

    /**
     * Ставит WebView [view] в окно. [webW]×[webH] — его размер в px (не меняется), [regionW]×[regionH] — видимая часть в левом
     * верхнем углу (само видео). Если окно уже показано, сначала убирается.
     */
    fun show(view: WebView, webW: Int, webH: Int, regionW: Int, regionH: Int) {
        detach()
        web = view
        fullW = max(1, regionW)
        fullH = max(1, regionH)
        val screenW = dm.widthPixels
        val screenH = dm.heightPixels
        val shortSide = min(screenW, screenH).toFloat()
        var w = shortSide * prefs.getFloat(KEY_W, 0.62f)
        val maxH = screenH * 0.45f
        if (fullH * (w / fullW) > maxH) w = maxH * fullW / fullH
        w = max(MIN_W_DP * d, min(w, screenW * 0.96f))

        (view.parent as? ViewGroup)?.removeView(view)
        view.pivotX = 0f
        view.pivotY = 0f
        view.translationX = 0f
        view.translationY = 0f
        view.clipToOutline = false
        box.addView(view, 0, FrameLayout.LayoutParams(webW, webH))
        applyScale(w / fullW)

        posX = prefs.getInt(KEY_X, Int.MIN_VALUE)
        posY = prefs.getInt(KEY_Y, Int.MIN_VALUE)
        if (posX == Int.MIN_VALUE || posY == Int.MIN_VALUE) {
            posX = screenW - curW - (12f * d).roundToInt()
            posY = (96f * d).roundToInt()
        }
        clampPos()
        attach()
        showControls()
    }

    /** Убирает окно и возвращает WebView (масштаб сброшен); null, если окна не было. */
    fun detach(): WebView? {
        handler.removeCallbacks(hideControlsTask)
        when (mode) {
            1 -> try {
                wm().removeViewImmediate(box)
            } catch (e: Exception) {
            }
            2 -> (box.parent as? ViewGroup)?.removeView(box)
        }
        mode = 0
        lp = null
        val w = web
        web = null
        if (w != null) {
            box.removeView(w)
            w.scaleX = 1f
            w.scaleY = 1f
        }
        return w
    }

    fun setPaused(paused: Boolean) {
        if (playBtn.showPlay == paused) return
        playBtn.showPlay = paused
        playBtn.invalidate()
    }

    /** Один раз предлагает выдать «Поверх других приложений»: без него окно видно только внутри приложения. */
    fun askOverlayOnce() {
        if (Build.VERSION.SDK_INT < 23 || canOverlay() || activity.isFinishing) return
        if (prefs.getBoolean(KEY_ASKED, false)) return
        prefs.edit().putBoolean(KEY_ASKED, true).apply()
        try {
            AlertDialog.Builder(activity)
                .setTitle("Плавающее видео")
                .setMessage("Чтобы видео продолжало играть в маленьком окне поверх других приложений, когда вы сворачиваете приложение, разрешите приложению «Поверх других приложений».")
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

    // ---------- окно ----------

    private fun attach() {
        try {
            if (canOverlay()) {
                val flags = WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL or
                    WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN or WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS or
                    WindowManager.LayoutParams.FLAG_HARDWARE_ACCELERATED // без него WebView в окне не рисуется
                val l = WindowManager.LayoutParams(curW, curH, windowType(), flags, PixelFormat.TRANSLUCENT)
                l.gravity = Gravity.TOP or Gravity.START
                l.x = posX
                l.y = posY
                if (Build.VERSION.SDK_INT >= 28) l.layoutInDisplayCutoutMode = WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES
                lp = l
                wm().addView(box, l)
                mode = 1
            } else {
                val p = FrameLayout.LayoutParams(curW, curH)
                p.gravity = Gravity.TOP or Gravity.START
                p.leftMargin = posX
                p.topMargin = posY
                (activity.window.decorView as ViewGroup).addView(box, p)
                mode = 2
            }
        } catch (e: Exception) {
            mode = 0
            lp = null
        }
    }

    private fun applyScale(s: Float) {
        curW = max(1, (fullW * s).roundToInt())
        curH = max(1, (fullH * s).roundToInt())
        val w = web
        if (w != null) {
            w.scaleX = s
            w.scaleY = s
        }
    }

    private fun applyLayout() {
        if (mode == 1) {
            val l = lp ?: return
            l.x = posX
            l.y = posY
            l.width = curW
            l.height = curH
            try {
                wm().updateViewLayout(box, l)
            } catch (e: Exception) {
            }
        } else if (mode == 2) {
            val p = box.layoutParams as? FrameLayout.LayoutParams ?: return
            p.width = curW
            p.height = curH
            p.leftMargin = posX
            p.topMargin = posY
            box.layoutParams = p
        }
    }

    private fun clampPos() {
        posX = max(0, min(posX, dm.widthPixels - curW))
        posY = max(0, min(posY, dm.heightPixels - curH))
    }

    private fun savePos() {
        val shortSide = min(dm.widthPixels, dm.heightPixels).toFloat()
        prefs.edit().putInt(KEY_X, posX).putInt(KEY_Y, posY).putFloat(KEY_W, curW / shortSide).apply()
    }

    // ---------- кнопки и жесты ----------

    private fun showControls() {
        controls.visibility = View.VISIBLE
        armHide()
    }

    private fun armHide() {
        handler.removeCallbacks(hideControlsTask)
        handler.postDelayed(hideControlsTask, CONTROLS_MS)
    }

    private fun toggleControls() {
        if (controls.visibility == View.VISIBLE) {
            handler.removeCallbacks(hideControlsTask)
            controls.visibility = View.GONE
        } else {
            showControls()
        }
    }

    private fun onDrag(e: MotionEvent): Boolean {
        when (e.actionMasked) {
            MotionEvent.ACTION_DOWN -> {
                downRawX = e.rawX
                downRawY = e.rawY
                startX = posX
                startY = posY
                moved = false
            }
            MotionEvent.ACTION_MOVE -> {
                val dx = e.rawX - downRawX
                val dy = e.rawY - downRawY
                if (!moved && hypot(dx, dy) > 8f * d) moved = true
                if (moved) {
                    posX = startX + dx.roundToInt()
                    posY = startY + dy.roundToInt()
                    clampPos()
                    applyLayout()
                }
            }
            MotionEvent.ACTION_UP -> {
                if (moved) savePos() else toggleControls()
            }
            MotionEvent.ACTION_CANCEL -> {
                if (moved) savePos()
            }
        }
        return true
    }

    private fun onResize(e: MotionEvent): Boolean {
        when (e.actionMasked) {
            MotionEvent.ACTION_DOWN -> {
                rzDownX = e.rawX
                rzW0 = curW
                handler.removeCallbacks(hideControlsTask)
            }
            MotionEvent.ACTION_MOVE -> {
                val minW = MIN_W_DP * d
                val maxW = max(minW, min(dm.widthPixels * 0.96f, dm.heightPixels * 0.6f * fullW / fullH))
                val nw = max(minW, min(rzW0 + (e.rawX - rzDownX), maxW))
                applyScale(nw / fullW)
                clampPos()
                applyLayout()
            }
            MotionEvent.ACTION_UP, MotionEvent.ACTION_CANCEL -> {
                savePos()
                armHide()
            }
        }
        return true
    }

    /** Кнопка, нарисованная кодом (ресурсов-значков в проекте нет). */
    private inner class Glyph(private val kind: Int) : View(activity) {
        var showPlay = false // для K_PLAY: true — треугольник «играть» (видео на паузе), false — «пауза»
        private val p = Paint(Paint.ANTI_ALIAS_FLAG)
        private val path = Path()

        override fun onDraw(canvas: Canvas) {
            val w = width.toFloat()
            val h = height.toFloat()
            val cx = w / 2f
            val cy = h / 2f
            val u = min(w, h) / 10f
            if (kind != K_HANDLE) {
                p.style = Paint.Style.FILL
                p.color = 0x8C000000.toInt()
                canvas.drawCircle(cx, cy, min(w, h) / 2f, p)
            }
            p.color = Color.WHITE
            when (kind) {
                K_PLAY -> {
                    p.style = Paint.Style.FILL
                    if (showPlay) {
                        path.reset()
                        path.moveTo(cx - 1.6f * u, cy - 2.6f * u)
                        path.lineTo(cx - 1.6f * u, cy + 2.6f * u)
                        path.lineTo(cx + 2.8f * u, cy)
                        path.close()
                        canvas.drawPath(path, p)
                    } else {
                        canvas.drawRect(cx - 2.3f * u, cy - 2.6f * u, cx - 0.7f * u, cy + 2.6f * u, p)
                        canvas.drawRect(cx + 0.7f * u, cy - 2.6f * u, cx + 2.3f * u, cy + 2.6f * u, p)
                    }
                }
                K_CLOSE -> {
                    p.style = Paint.Style.STROKE
                    p.strokeWidth = 1.2f * u
                    p.strokeCap = Paint.Cap.ROUND
                    canvas.drawLine(cx - 2.2f * u, cy - 2.2f * u, cx + 2.2f * u, cy + 2.2f * u, p)
                    canvas.drawLine(cx - 2.2f * u, cy + 2.2f * u, cx + 2.2f * u, cy - 2.2f * u, p)
                }
                K_EXPAND -> {
                    p.style = Paint.Style.STROKE
                    p.strokeWidth = 1.1f * u
                    p.strokeCap = Paint.Cap.ROUND
                    canvas.drawLine(cx - 2.3f * u, cy + 2.3f * u, cx + 2.3f * u, cy - 2.3f * u, p)
                    canvas.drawLine(cx + 2.3f * u, cy - 2.3f * u, cx + 0.3f * u, cy - 2.3f * u, p)
                    canvas.drawLine(cx + 2.3f * u, cy - 2.3f * u, cx + 2.3f * u, cy - 0.3f * u, p)
                    canvas.drawLine(cx - 2.3f * u, cy + 2.3f * u, cx - 0.3f * u, cy + 2.3f * u, p)
                    canvas.drawLine(cx - 2.3f * u, cy + 2.3f * u, cx - 2.3f * u, cy + 0.3f * u, p)
                }
                else -> {
                    p.style = Paint.Style.STROKE
                    p.strokeWidth = 1.2f * u
                    p.strokeCap = Paint.Cap.ROUND
                    p.alpha = 210
                    canvas.drawLine(w - 2f * u, h - 6f * u, w - 6f * u, h - 2f * u, p)
                    canvas.drawLine(w - 2f * u, h - 9f * u, w - 9f * u, h - 2f * u, p)
                }
            }
        }
    }
}
