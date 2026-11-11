package com.app.lifetracker
// Версия: 1.0 (11.11)

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.graphics.Canvas
import android.graphics.Matrix
import android.graphics.Paint
import android.graphics.Path
import android.graphics.Rect
import android.graphics.RectF
import android.graphics.drawable.GradientDrawable
import android.os.Handler
import android.os.Looper
import android.text.TextUtils
import android.view.Gravity
import android.view.MotionEvent
import android.view.View
import android.view.ViewGroup
import android.webkit.WebView
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import androidx.core.graphics.ColorUtils
import androidx.core.graphics.PathParser
import org.json.JSONArray
import org.json.JSONObject
import org.json.JSONTokener
import kotlin.math.atan2
import kotlin.math.hypot
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt

// номера частей круга: 0..4 — сектора по часовой стрелке от верхнего, 5 — ластик в центре
private const val ACT_COPY = 0
private const val ACT_PASTE = 1
private const val ACT_CUT = 2
private const val ACT_FWD = 3
private const val ACT_HIST = 4
private const val ACT_ERASE = 5

/**
 * Круговое меню выделения текста на страницах вкладок-сайтов и вкладки «Claude» — то же, что `ctxmenu.js` в странице
 * приложения (сайты лежат отдельными WebView поверх неё, DOM страницы приложения над ними рисовать не может).
 * Пять секторов (копировать, вставить, вырезать, переслать в задачи, последние 10 скопированных) и ластик в центре:
 * ластик удаляет выделенный текст, если его можно менять (поле ввода, contenteditable); у обычного текста страницы
 * неактивен — как остальные недоступные кнопки.
 *
 * Выделение приходит от [SelectionMenuWebView] ([SelectionMenuWebView.SelectionListener]): круг показывается, когда
 * выделение 380 мс не менялось. Что выделено и можно ли это менять, спрашивается у страницы скриптом [SEL_JS]; действия
 * над страницей — скриптами ([DEL_JS], [PASTE_JS]). Моста LifeTrackerNative в чужих страницах по-прежнему нет: буфер
 * обмена и история — на стороне приложения. История — `window.LTClip` главной страницы (её же пополняет «Копировать»
 * круга). «Переслать» кладёт текст в черновик окна быстрой задачи ([QuickTaskActivity]) и открывает его: задача уйдёт в Inbox.
 * Цвета — из палитры темы, которую страница присылает для окна быстрой задачи ([QuickTaskStore.palette]).
 */
class SiteSelectionMenu(
    private val activity: MainActivity,
    private val host: FrameLayout
) : SelectionMenuWebView.SelectionListener {

    companion object {
        private const val SHOW_DELAY_MS = 380L
        private const val UP_DELAY_MS = 250L
        private const val DISP_DP = 116f   // сторона круга, dp (как DISP в ctxmenu.js)
        private const val PAD_DP = 10f     // поле вокруг круга под тень

        /** Что выделено на странице: {t: текст, e: можно ли менять}. Пароли не отдаются. */
        private const val SEL_JS = """(function(){try{
var D=document,W=window,ae=D.activeElement;
try{while(ae&&ae.tagName==='IFRAME'&&ae.contentDocument){D=ae.contentDocument;W=ae.contentWindow;ae=D.activeElement;}}catch(e){}
var tn=ae?ae.tagName:'',ty=(ae&&ae.getAttribute)?(ae.getAttribute('type')||'text'):'';
var t='',ed=false;
ty=ty.toLowerCase();
if(tn==='INPUT'&&ty==='password'){return JSON.stringify({t:'',e:false});}
if(tn==='TEXTAREA'||(tn==='INPUT'&&['text','search','url','tel','email'].indexOf(ty)>=0)){
var a=ae.selectionStart,b=ae.selectionEnd;
if(a!=null&&b!=null){t=ae.value.substring(a,b);}
ed=!ae.readOnly&&!ae.disabled;
}else{
var s=W.getSelection();t=s?s.toString():'';
ed=!!(ae&&ae.isContentEditable);
}
return JSON.stringify({t:t,e:ed});
}catch(e){return JSON.stringify({t:'',e:false});}})()"""

        /** Удаляет выделенное в активном элементе страницы; 1 — получилось. */
        private const val DEL_JS = """(function(){try{
var D=document,ae=D.activeElement;
try{while(ae&&ae.tagName==='IFRAME'&&ae.contentDocument){D=ae.contentDocument;ae=D.activeElement;}}catch(e){}
var ok=false;
try{ok=D.execCommand('delete');}catch(e){}
if(!ok&&ae&&(ae.tagName==='TEXTAREA'||ae.tagName==='INPUT')&&ae.selectionStart!=null){
var a=ae.selectionStart,b=ae.selectionEnd;
if(b>a){ae.setRangeText('',a,b,'end');ae.dispatchEvent(new Event('input',{bubbles:true}));ok=true;}
}
return ok?1:0;
}catch(e){return 0;}})()"""

        /** Заменяет выделенное в активном элементе текстом (вместо __T__ подставляется строка JS); 1 — получилось. */
        private const val PASTE_JS = """(function(t){try{
var D=document,ae=D.activeElement;
try{while(ae&&ae.tagName==='IFRAME'&&ae.contentDocument){D=ae.contentDocument;ae=D.activeElement;}}catch(e){}
var ok=false;
try{ok=D.execCommand('insertText',false,t);}catch(e){}
if(!ok&&ae&&(ae.tagName==='TEXTAREA'||ae.tagName==='INPUT')&&ae.selectionStart!=null){
ae.setRangeText(t,ae.selectionStart,ae.selectionEnd,'end');ae.dispatchEvent(new Event('input',{bubbles:true}));ok=true;
}
return ok?1:0;
}catch(e){return 0;}})(__T__)"""

    }

    private class Sel(val text: String, val editable: Boolean) {
        val has: Boolean get() = text.isNotBlank()
        val key: String get() = text + "\u0000" + editable
    }

    private val handler = Handler(Looper.getMainLooper())
    private val d = activity.resources.displayMetrics.density
    private var target: WebView? = null
    private var anchor = Rect()
    private var sel: Sel? = null
    private var circle: CircleView? = null
    private var listBox: View? = null
    private var cx = 0f
    private var cy = 0f
    private var pending: Runnable? = null

    /** Выделение, с которым круг уже закрыли действием, снова не показывается, пока человек не тронет страницу. */
    private var dismissedKey: String? = null

    /** Круг для пустого выделения (курсор в поле: «Вставить») показывается один раз за сеанс выделения. */
    private var blankShown = false

    // ---------------------------------------------------------------- события WebView

    override fun onSelectionRect(view: WebView, rect: Rect) {
        removeViews()
        target = view
        anchor = Rect(rect)
        schedule(SHOW_DELAY_MS)
    }

    override fun onSelectionEnd(view: WebView) {
        if (view !== target) return
        blankShown = false
        hide()
    }

    override fun onTouchDown(view: WebView) {
        dismissedKey = null
        blankShown = false
        cancelPending()
        removeViews()
    }

    override fun onTouchUp(view: WebView) {
        // тап по выделенному тексту снова вызывает круг (если выделение осталось)
        if (view === target) schedule(UP_DELAY_MS)
    }

    override fun onScroll(view: WebView) {
        if (view !== target) return
        if (circle != null || listBox != null) {
            removeViews()
            schedule(SHOW_DELAY_MS)
        }
    }

    /** Убирает круг и забывает выделение (смена вкладки, закрытие вкладки). */
    fun hide() {
        cancelPending()
        removeViews()
        target = null
        sel = null
    }

    // ---------------------------------------------------------------- показ

    private fun schedule(delay: Long) {
        cancelPending()
        val r = Runnable {
            pending = null
            query()
        }
        pending = r
        handler.postDelayed(r, delay)
    }

    private fun cancelPending() {
        pending?.let { handler.removeCallbacks(it) }
        pending = null
    }

    private fun removeViews() {
        circle?.let { if (it.parent === host) host.removeView(it) }
        listBox?.let { if (it.parent === host) host.removeView(it) }
        circle = null
        listBox = null
    }

    private fun query() {
        val v = target ?: return
        if (!v.isAttachedToWindow || v.width <= 0) return
        v.evaluateJavascript(SEL_JS) { raw ->
            if (target !== v) return@evaluateJavascript
            val s = parseSel(raw) ?: return@evaluateJavascript
            if (!s.has && !s.editable) return@evaluateJavascript
            if (!s.has && blankShown) return@evaluateJavascript
            if (dismissedKey == s.key) return@evaluateJavascript
            if (!s.has) blankShown = true
            sel = s
            showCircle(v, s)
        }
    }

    private fun parseSel(raw: String?): Sel? {
        if (raw == null || raw == "null") return null
        return try {
            val str = JSONTokener(raw).nextValue() as? String ?: return null
            val o = JSONObject(str)
            Sel(o.optString("t", ""), o.optBoolean("e", false))
        } catch (e: Exception) {
            null
        }
    }

    private fun visibleBottom(): Float {
        val vis = Rect()
        val hl = IntArray(2)
        host.getWindowVisibleDisplayFrame(vis)
        host.getLocationOnScreen(hl)
        return min(host.height.toFloat(), (vis.bottom - hl[1]).toFloat()) - 6f * d
    }

    private fun showCircle(v: WebView, s: Sel) {
        removeViews()
        if (host.width <= 0 || host.height <= 0) return
        val size = (DISP_DP * d).roundToInt()
        val pad = (PAD_DP * d).roundToInt()
        // границы выделения: из координат вида в координаты host
        val vl = IntArray(2)
        val hl = IntArray(2)
        v.getLocationOnScreen(vl)
        host.getLocationOnScreen(hl)
        val ox = (vl[0] - hl[0]).toFloat()
        val oy = (vl[1] - hl[1]).toFloat()
        val a = RectF(ox + anchor.left, oy + anchor.top, ox + anchor.right, oy + anchor.bottom)
        if (a.right < 0f || a.left > host.width) return // вкладка уехала за край
        val topLimit = 6f * d
        val botLimit = visibleBottom()
        val left = ((a.left + a.right) / 2f - size / 2f).coerceIn(6f * d, max(6f * d, host.width - size - 6f * d))
        var top = Float.NaN
        // сначала над выделением, затем под ним (ниже ручек выделения)
        for (cand in floatArrayOf(a.top - size - 10f * d, a.bottom + 36f * d)) {
            if (cand >= topLimit && cand + size <= botLimit) {
                top = cand
                break
            }
        }
        if (top.isNaN()) top = max(topLimit, (botLimit - size) / 2f)

        val en = booleanArrayOf(s.has, s.editable, s.editable && s.has, s.has, s.editable, s.editable && s.has)
        val cv = CircleView(activity, size, pad, en, QuickTaskStore.palette(activity.applicationContext)) { idx -> onAct(idx) }
        val lp = FrameLayout.LayoutParams(size + 2 * pad, size + 2 * pad)
        lp.leftMargin = (left - pad).roundToInt()
        lp.topMargin = (top - pad).roundToInt()
        host.addView(cv, lp)
        circle = cv
        cx = left + size / 2f
        cy = top + size / 2f
        cv.alpha = 0f
        cv.scaleX = 0.86f
        cv.scaleY = 0.86f
        cv.animate().alpha(1f).scaleX(1f).scaleY(1f).setDuration(120L).start()
    }

    // ---------------------------------------------------------------- действия

    private fun onAct(idx: Int) {
        val v = target ?: return
        val s = sel ?: return
        if (idx == ACT_HIST) {
            openList(v)
            return
        }
        dismissedKey = s.key
        removeViews()
        when (idx) {
            ACT_COPY -> copyText(s.text)
            ACT_PASTE -> pasteInto(v, clipboardText())
            ACT_CUT -> if (copyText(s.text)) deleteSelection(v)
            ACT_FWD -> forward(s.text)
            ACT_ERASE -> deleteSelection(v)
        }
    }

    private fun copyText(text: String): Boolean {
        try {
            val cm = activity.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
            cm.setPrimaryClip(ClipData.newPlainText("text", text))
        } catch (e: Exception) {
            activity.toast("Не удалось скопировать")
            return false
        }
        // история «последние 10 скопированных» живёт в странице приложения (ctxmenu.js)
        activity.evalInPage("window.LTClip&&window.LTClip.push(" + JSONObject.quote(text) + ")", null)
        activity.toast("Скопировано")
        return true
    }

    private fun clipboardText(): String = try {
        val cm = activity.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
        val clip = cm.primaryClip
        if (clip != null && clip.itemCount > 0) clip.getItemAt(0).coerceToText(activity).toString() else ""
    } catch (e: Exception) {
        ""
    }

    private fun pasteInto(v: WebView, text: String) {
        if (text.isEmpty()) {
            activity.toast("Буфер обмена пуст")
            return
        }
        v.evaluateJavascript(PASTE_JS.replace("__T__", JSONObject.quote(text))) { raw ->
            if (raw != "1") activity.toast("Не удалось вставить")
        }
    }

    private fun deleteSelection(v: WebView) {
        v.evaluateJavascript(DEL_JS) { raw ->
            if (raw != "1") activity.toast("Не удалось удалить")
        }
    }

    private fun forward(text: String) {
        val t = text.trim()
        if (t.isEmpty()) return
        try {
            QuickTaskStore.saveDraft(activity.applicationContext, t, null, null, 0L)
            activity.startActivity(Intent(activity, QuickTaskActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        } catch (e: Exception) {
            activity.toast("Не удалось открыть окно задачи")
        }
    }

    // ---------------------------------------------------------------- список скопированных

    private fun openList(v: WebView) {
        activity.evalInPage("JSON.stringify(window.LTClip?window.LTClip.list():[])") { raw ->
            if (target !== v) return@evalInPage
            showList(v, parseList(raw))
        }
    }

    private fun parseList(raw: String?): List<String> {
        if (raw == null || raw == "null") return emptyList()
        return try {
            val str = JSONTokener(raw).nextValue() as? String ?: return emptyList()
            val arr = JSONArray(str)
            val out = ArrayList<String>()
            for (i in 0 until arr.length()) {
                val t = arr.optString(i, "")
                if (t.isNotEmpty()) out.add(t)
            }
            out
        } catch (e: Exception) {
            emptyList()
        }
    }

    /** Первые две строки фрагмента и «…», если есть что-то ещё (вставляется всегда весь фрагмент). */
    private fun preview(text: String): String {
        val lines = text.trim().split(Regex("\\s*\\n\\s*"))
        var head = lines.take(2).joinToString("\n")
        var more = lines.size > 2
        if (head.length > 140) {
            head = head.substring(0, 140)
            more = true
        }
        return head.trimEnd() + if (more) "…" else ""
    }

    private fun showList(v: WebView, items: List<String>) {
        removeViews()
        if (host.width <= 0 || host.height <= 0) return
        val pal = QuickTaskStore.palette(activity.applicationContext)
        val w = min((340f * d).roundToInt(), host.width - (16f * d).roundToInt())
        val box = LinearLayout(activity)
        box.orientation = LinearLayout.VERTICAL
        if (items.isEmpty()) {
            val tv = TextView(activity)
            tv.text = "Пока ничего не скопировано"
            tv.setTextColor(pal.inkSoft)
            tv.textSize = 15f
            tv.gravity = Gravity.CENTER
            val p = (14f * d).roundToInt()
            tv.setPadding(p, p, p, p)
            box.addView(tv, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT))
        } else {
            val line = ColorUtils.blendARGB(pal.card, pal.accent, 0.18f)
            val pressed = ColorUtils.blendARGB(pal.card, pal.accent, 0.30f)
            for ((i, full) in items.withIndex()) {
                val tv = TextView(activity)
                tv.text = preview(full)
                tv.setTextColor(pal.ink)
                tv.textSize = 15f
                tv.maxLines = 2
                tv.ellipsize = TextUtils.TruncateAt.END
                val ph = (14f * d).roundToInt()
                val pv = (10f * d).roundToInt()
                tv.setPadding(ph, pv, ph, pv)
                val st = android.graphics.drawable.StateListDrawable()
                st.addState(intArrayOf(android.R.attr.state_pressed), android.graphics.drawable.ColorDrawable(pressed))
                st.addState(intArrayOf(), android.graphics.drawable.ColorDrawable(0))
                tv.background = st
                tv.setOnClickListener {
                    dismissedKey = sel?.key
                    removeViews()
                    pasteInto(v, full)
                }
                box.addView(tv, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT))
                if (i < items.size - 1) {
                    val sep = View(activity)
                    sep.setBackgroundColor(line)
                    box.addView(sep, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, max(1, d.roundToInt())))
                }
            }
        }
        box.measure(
            View.MeasureSpec.makeMeasureSpec(w, View.MeasureSpec.EXACTLY),
            View.MeasureSpec.makeMeasureSpec(0, View.MeasureSpec.UNSPECIFIED)
        )
        val botLimit = visibleBottom()
        val maxH = max((120f * d).roundToInt(), min((host.height * 0.6f).roundToInt(), (botLimit - 8f * d).roundToInt()))
        val h = min(box.measuredHeight, maxH)
        val scroll = ScrollView(activity)
        scroll.isVerticalScrollBarEnabled = false
        scroll.addView(box, ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT))
        val wrap = FrameLayout(activity)
        val bg = GradientDrawable()
        bg.setColor(pal.card)
        bg.cornerRadius = 12f * d
        bg.setStroke(max(1, d.roundToInt()), pal.groove)
        wrap.background = bg
        wrap.clipToOutline = true
        wrap.elevation = 8f * d
        wrap.addView(scroll, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
        val lp = FrameLayout.LayoutParams(w, h)
        lp.leftMargin = (cx - w / 2f).coerceIn(8f * d, max(8f * d, host.width - w - 8f * d)).roundToInt()
        lp.topMargin = (cy - h / 2f).coerceIn(8f * d, max(8f * d, botLimit - h)).roundToInt()
        host.addView(wrap, lp)
        listBox = wrap
    }

    // ---------------------------------------------------------------- круг

    /**
     * Круг 156×156 условных единиц (как SVG в ctxmenu.js): кольцо R=74 / r=25 из пяти секторов по 72° (первый — вверху по
     * центру), в середине — кнопка-ластик радиусом 22. Рисуется в пикселях (тень — setShadowLayer, поэтому программный слой).
     * [enabled]: 0..4 — сектора, 5 — ластик; недоступные рисуются полупрозрачными и не нажимаются.
     */
    private class CircleView(
        ctx: Context,
        private val size: Int,
        private val pad: Int,
        private val enabled: BooleanArray,
        pal: QuickTaskStore.Palette,
        private val onAct: (Int) -> Unit
    ) : View(ctx) {

        private val dens = ctx.resources.displayMetrics.density
        private val k = size / 156f
        private val c = 78f
        private val outerR = 74f
        private val innerR = 25f
        private val hubR = 22f

        private val sectors = ArrayList<Path>()
        private val icons = ArrayList<Path>()
        private val eraserFill: Path
        private val eraserStroke: Path
        private val hub = RectF()

        private val iconColor = ColorUtils.blendARGB(pal.accent, 0xFF000000.toInt(), 0.25f)
        private val cardColor = pal.card
        private val pressedColor = ColorUtils.blendARGB(pal.card, pal.accent, 0.30f)
        private val hubColor = ColorUtils.blendARGB(pal.card, pal.accent, 0.12f)

        private val fill = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            style = Paint.Style.FILL
            setShadowLayer(3.5f * dens, 0f, 3f * dens, 0x61000000)
        }
        private val edge = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            style = Paint.Style.STROKE
            strokeJoin = Paint.Join.ROUND
            strokeWidth = 1.5f * k
            color = pal.accent
        }
        private val ico = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            style = Paint.Style.STROKE
            strokeCap = Paint.Cap.ROUND
            strokeJoin = Paint.Join.ROUND
            strokeWidth = 1.7f * k
            color = iconColor
        }
        private val icoEraser = Paint(ico).apply { strokeWidth = 1.5f * k }
        private val icoFill = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            style = Paint.Style.FILL
            color = iconColor
            alpha = 64
        }

        private var downIdx = -1
        private var pressed = -1

        init {
            setLayerType(LAYER_TYPE_SOFTWARE, null)
            val m = Matrix()
            m.setScale(k, k)
            m.postTranslate(pad.toFloat(), pad.toFloat())
            val outer = RectF(c - outerR, c - outerR, c + outerR, c + outerR)
            val inner = RectF(c - innerR, c - innerR, c + innerR, c + innerR)
            val step = 72f
            for (i in 0 until 5) {
                val a0 = -90f - step / 2f + step * i + 1f
                val sweep = step - 2f
                val p = Path()
                val o0 = pt(outerR, a0)
                p.moveTo(o0[0], o0[1])
                p.arcTo(outer, a0, sweep)
                val i1 = pt(innerR, a0 + sweep)
                p.lineTo(i1[0], i1[1])
                p.arcTo(inner, a0 + sweep, -sweep)
                p.close()
                p.transform(m)
                sectors.add(p)
                val mp = pt((outerR + innerR) / 2f, a0 + sweep / 2f)
                val ip = iconPath(i)
                ip.transform(iconMatrix(mp[0] - 12f, mp[1] - 12f))
                icons.add(ip)
            }
            // ластик — рисунок 24×24 из res (vector), центр круга
            val hm = iconMatrix(c - 12f, c - 12f)
            eraserFill = PathParser.createPathFromPathData("M9.132,6.404 L16.095,1.528 L21.831,9.72 L14.868,14.596 Z")
            eraserFill.transform(hm)
            eraserStroke = Path()
            eraserStroke.addPath(PathParser.createPathFromPathData("M2.169,11.28 L16.095,1.528 L21.831,9.72 L7.905,19.472 Z"))
            eraserStroke.addPath(PathParser.createPathFromPathData("M9.132,6.404 L14.868,14.596"))
            eraserStroke.addPath(PathParser.createPathFromPathData("M5,22 H19"))
            eraserStroke.transform(hm)
            hub.set(pad + (c - hubR) * k, pad + (c - hubR) * k, pad + (c + hubR) * k, pad + (c + hubR) * k)
        }

        private fun pt(r: Float, deg: Float): FloatArray {
            val a = Math.toRadians(deg.toDouble())
            return floatArrayOf((c + r * Math.cos(a)).toFloat(), (c + r * Math.sin(a)).toFloat())
        }

        /** Масштаб сетки 24×24 значка и перенос в точку (gx, gy) сетки круга (в px с полем под тень). */
        private fun iconMatrix(gx: Float, gy: Float): Matrix {
            val m = Matrix()
            m.setScale(k, k)
            m.postTranslate(pad + gx * k, pad + gy * k)
            return m
        }

        private fun parse(d: String): Path = PathParser.createPathFromPathData(d)

        private fun iconPath(act: Int): Path {
            val p = Path()
            when (act) {
                ACT_COPY -> {
                    p.addRoundRect(RectF(9f, 9f, 20f, 20f), 2f, 2f, Path.Direction.CW)
                    p.addPath(parse("M5 15V6a1 1 0 0 1 1-1h9"))
                }
                ACT_PASTE -> {
                    p.addPath(parse("M9 3h6v3H9z"))
                    p.addPath(parse("M8 5H6a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V6a1 1 0 0 0-1-1h-2"))
                }
                ACT_CUT -> {
                    p.addCircle(6f, 6f, 2.6f, Path.Direction.CW)
                    p.addCircle(6f, 18f, 2.6f, Path.Direction.CW)
                    p.addPath(parse("M8 7.8L20 18"))
                    p.addPath(parse("M8 16.2L20 6"))
                }
                ACT_FWD -> {
                    p.addPath(parse("M5 12h13"))
                    p.addPath(parse("M13 6l6 6-6 6"))
                }
                else -> {
                    p.addPath(parse("M3.5 12a8.5 8.5 0 1 0 2.6-6.1"))
                    p.addPath(parse("M3.5 4v4.5H8"))
                    p.addPath(parse("M12 7.5V12l3 2"))
                }
            }
            return p
        }

        override fun onDraw(canvas: Canvas) {
            for (i in 0 until 5) {
                val on = enabled[i]
                val save = if (on) canvas.save() else canvas.saveLayerAlpha(0f, 0f, width.toFloat(), height.toFloat(), 97)
                fill.color = if (on && pressed == i) pressedColor else cardColor
                canvas.drawPath(sectors[i], fill)
                canvas.drawPath(sectors[i], edge)
                canvas.drawPath(icons[i], ico)
                canvas.restoreToCount(save)
            }
            val onHub = enabled[ACT_ERASE]
            val save = if (onHub) canvas.save() else canvas.saveLayerAlpha(0f, 0f, width.toFloat(), height.toFloat(), 97)
            fill.color = if (onHub && pressed == ACT_ERASE) pressedColor else hubColor
            canvas.drawCircle(hub.centerX(), hub.centerY(), hub.width() / 2f, fill)
            canvas.drawCircle(hub.centerX(), hub.centerY(), hub.width() / 2f, edge)
            canvas.drawPath(eraserFill, icoFill)
            canvas.drawPath(eraserStroke, icoEraser)
            canvas.restoreToCount(save)
        }

        /** Номер нажатой части: 0..4 — сектор, 5 — ластик, -1 — мимо (нажатие уходит странице под кругом). */
        private fun hit(x: Float, y: Float): Int {
            val gx = (x - pad) / k - c
            val gy = (y - pad) / k - c
            val dist = hypot(gx, gy)
            if (dist <= hubR + 2f) return ACT_ERASE
            if (dist < innerR || dist > outerR) return -1
            var a = Math.toDegrees(atan2(gy, gx).toDouble()).toFloat()
            a = ((a + 126f) % 360f + 360f) % 360f
            return min((a / 72f).toInt(), 4)
        }

        override fun onTouchEvent(e: MotionEvent): Boolean {
            when (e.actionMasked) {
                MotionEvent.ACTION_DOWN -> {
                    val i = hit(e.x, e.y)
                    if (i < 0) return false
                    downIdx = i
                    pressed = i
                    invalidate()
                    return true
                }
                MotionEvent.ACTION_MOVE -> {
                    if (downIdx >= 0 && pressed != -1 && hit(e.x, e.y) != downIdx) {
                        pressed = -1
                        invalidate()
                    }
                    return downIdx >= 0
                }
                MotionEvent.ACTION_UP -> {
                    val was = downIdx
                    val fire = was >= 0 && hit(e.x, e.y) == was && enabled[was]
                    downIdx = -1
                    pressed = -1
                    invalidate()
                    if (fire) onAct(was)
                    return was >= 0
                }
                MotionEvent.ACTION_CANCEL -> {
                    downIdx = -1
                    pressed = -1
                    invalidate()
                    return true
                }
            }
            return false
        }
    }
}
