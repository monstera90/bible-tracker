package com.app.lifetracker
// Версия: 4.0 (03.11)

import android.annotation.SuppressLint
import android.content.Context
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Path
import android.graphics.RectF
import android.os.Build
import android.view.MotionEvent
import android.net.Uri
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.Parcel
import android.util.Base64
import android.graphics.Outline
import android.view.View
import android.view.ViewGroup
import android.view.ViewOutlineProvider
import android.webkit.CookieManager
import android.webkit.RenderProcessGoneDetail
import android.webkit.WebResourceError
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout
import androidx.webkit.WebSettingsCompat
import androidx.webkit.WebViewFeature
import org.json.JSONArray
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.io.File
import java.util.concurrent.ConcurrentHashMap
import kotlin.math.roundToInt

/**
 * WebView вкладки-сайта с «окнами»: прямоугольники (координаты родителя, px), где сайт не рисуется и не принимает нажатия —
 * сквозь них видна страница приложения с её кнопками (полный экран, «домик»). Сайт при этом растянут на всю область и заходит
 * под кнопки, как содержимое остальных вкладок. Вырез по контуру кнопки — `clipOutPath` (WebView честно учитывает такой
 * сложный вырез только с Android 10, поэтому окна включаются с API 29); нажатие, начатое в окне, отдаётся нижнему (главному) WebView.
 */
private class SiteWebView(context: Context) : WebView(context) {
    private var holes: List<RectF> = emptyList()
    private var radius = 0f
    private var passThrough = false
    private val shadow = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = Color.BLACK }

    fun setHoles(list: List<RectF>, r: Float) {
        holes = list
        radius = r
        invalidate()
    }

    override fun onDraw(canvas: Canvas) {
        val hs = holes
        if (hs.isEmpty() || Build.VERSION.SDK_INT < 29) {
            super.onDraw(canvas)
            return
        }
        val saved = canvas.save()
        val path = Path()
        val d = resources.displayMetrics.density
        // канва WebView смещена на его прокрутку (scrollX/scrollY) — окна должны стоять на месте кнопок, а не ехать вместе с содержимым сайта
        val ox = left - scrollX
        val oy = top - scrollY
        val local = ArrayList<RectF>(hs.size)
        for (h in hs) {
            val rc = RectF(h.left - ox, h.top - oy, h.right - ox, h.bottom - oy)
            local.add(rc)
            path.addRoundRect(rc, radius, radius, Path.Direction.CW)
        }
        canvas.clipOutPath(path)
        super.onDraw(canvas)
        // тень кнопки (как box-shadow у .mdeditor-fab-btn: 0 2px 6px rgba(0,0,0,.28)) — рисуется вокруг выреза; сама заливка вырезом отсечена
        shadow.setShadowLayer(4.3f * d, 0f, 2f * d, 0x47000000)
        for (rc in local) canvas.drawRoundRect(rc, radius, radius, shadow)
        canvas.restoreToCount(saved)
    }

    private fun inHole(x: Float, y: Float): Boolean {
        for (h in holes) if (h.contains(x + left, y + top)) return true
        return false
    }

    override fun dispatchTouchEvent(ev: MotionEvent): Boolean {
        if (ev.actionMasked == MotionEvent.ACTION_DOWN) passThrough = holes.isNotEmpty() && inHole(ev.x, ev.y)
        if (passThrough) {
            if (ev.actionMasked == MotionEvent.ACTION_UP || ev.actionMasked == MotionEvent.ACTION_CANCEL) passThrough = false
            return false
        }
        return super.dispatchTouchEvent(ev)
    }
}

/**
 * Вкладки-сайты бокового ряда «Интернет» (кнопка «+», usertabs.js): у каждой вкладки свой WebView с нужным адресом, который лежит поверх
 * области содержимого главного WebView (страница присылает прямоугольник через мост: utabShow). Моста LifeTrackerNative в этих
 * WebView НЕТ — чужой сайт не получает доступа к приложению.
 *
 * Место на странице:
 *  - пока процесс жив, WebView вкладки не уничтожается, а уезжает за край (translationX): возврат на вкладку мгновенный, без
 *    перезагрузки, с той же прокруткой (в том числе внутренних прокручиваемых областей сайта);
 *  - после закрытия приложения WebView.saveState (история переходов и прокрутка) пишется в файл `user_tabs/<id>.state`, адрес и
 *    прокрутка — в SharedPreferences `user_tabs`; при следующем заходе состояние восстанавливается (restoreState), а если не вышло —
 *    грузится последний адрес и прокрутка доводится скриптом;
 *  - чтобы не было мерцания, свежесозданный WebView остаётся за краем, пока страница не загрузилась и прокрутка не встала на место.
 * Вход в аккаунты: cookie общие на всё приложение и сохраняются на диск (CookieManager.flush); user-agent без метки WebView.
 *
 * Плавающее видео (FloatingVideo): если на вкладке играет видео, а человек ушёл с вкладки (`hideTab`) или свернул приложение
 * (`onAppHidden`), WebView вкладки НЕ ставится на паузу, а переезжает в плавающее окно: страница скриптом PIN_JS оставляет на экране
 * только видео. Вернулся на вкладку (`show`) или в приложение (`onAppVisible`, если вкладка была открыта) — WebView встаёт на место,
 * скрипт снимается. Плавающее окно одно: новое видео закрывает прежнее (оно ставится на паузу).
 */
class UserTabs(private val activity: MainActivity, private val host: FrameLayout) {

    companion object {
        private const val PREFS = "user_tabs"
        private const val KEY_LAST = "last"
        private const val KEY_RECT = "rect"
        private const val DIR = "user_tabs"
        private const val OFFSCREEN_X = 20000f
        private const val SAVE_EVERY_MS = 4000L
        private const val SAVE_DEBOUNCE_MS = 1500L
        private const val REVEAL_TIMEOUT_MS = 8000L
        private const val PRELOAD_DELAY_MS = 2500L
        private const val MAX_LIVE = 4
        private const val RECOVER_MIN_GAP_MS = 60000L
        private const val ICON_PX = 64
        private const val KIND_LEFT = 1   // плавающее: ушли с вкладки
        private const val KIND_MIN = 2    // плавающее: свернули приложение, пока вкладка была открыта
        private const val FLOAT_POLL_MS = 1000L

        /**
         * Находит играющее видео и оставляет на странице только его: всё остальное скрыто (visibility), у предков видео снимаются
         * transform/filter/contain (иначе position:fixed считалось бы от них), видео — fixed в левом верхнем углу, размером с само видео
         * (в пределах окна). Ответ: [1, innerWidth, innerHeight, ширина видео, высота видео] (CSS-пиксели) или [0], если подходящего видео нет.
         * Подходит: играет, есть кадр, не зациклено (фоновые ролики сайтов), шире 160 px, со звуком или длиннее минуты/прямой эфир.
         */
        private const val PIN_JS = """(function(){try{var D=document,W=window;
if(W.__ltUnpin){try{W.__ltUnpin();}catch(e){}}
var vs=D.getElementsByTagName('video'),best=null,ba=-1,i;
for(i=0;i<vs.length;i++){var v=vs[i];
if(v.paused||v.ended||v.readyState<2||!v.videoWidth||!v.videoHeight||v.loop)continue;
if(v.muted&&!(v.duration>60||!isFinite(v.duration)))continue;
var r=v.getBoundingClientRect();if(r.width<160)continue;
var a=r.width*r.height;if(a>ba){ba=a;best=v;}}
if(!best)return [0];
var sy=W.pageYOffset||D.documentElement.scrollTop||0;
var iw=W.innerWidth,ih=W.innerHeight;
var asp=best.videoHeight/best.videoWidth;
var bw=iw,bh=iw*asp;if(bh>ih){bh=ih;bw=ih/asp;}
bw=Math.round(bw);bh=Math.round(bh);
var anc=[],n=best.parentNode;
while(n&&n!==D&&n.nodeType===1){anc.push(n);n=n.parentNode;}
for(i=0;i<anc.length;i++)anc[i].setAttribute('data-ltpin-a','1');
best.setAttribute('data-ltpin-v','1');
var st=D.createElement('style');st.id='__ltpin';
st.textContent='html,body{background:#000!important;}'
+'html[data-ltpin-a],body[data-ltpin-a]{overflow:hidden!important;}'
+'body *{visibility:hidden!important;}'
+'[data-ltpin-a]{transform:none!important;filter:none!important;perspective:none!important;contain:none!important;will-change:auto!important;clip-path:none!important;}'
+'[data-ltpin-v]{visibility:visible!important;display:block!important;position:fixed!important;left:0!important;top:0!important;right:auto!important;bottom:auto!important;'
+'width:'+bw+'px!important;height:'+bh+'px!important;max-width:none!important;max-height:none!important;min-width:0!important;min-height:0!important;'
+'margin:0!important;padding:0!important;border:0!important;transform:none!important;object-fit:contain!important;background:#000!important;opacity:1!important;z-index:2147483647!important;}';
(D.head||D.documentElement).appendChild(st);
W.__ltUnpin=function(){try{for(var k=0;k<anc.length;k++)anc[k].removeAttribute('data-ltpin-a');
best.removeAttribute('data-ltpin-v');}catch(e){}
try{if(st.parentNode)st.parentNode.removeChild(st);}catch(e){}
try{W.scrollTo(0,sy);}catch(e){}W.__ltUnpin=null;};
return [1,iw,ih,bw,bh];}catch(e){return [0];}})()"""

        /** Снимает PIN_JS (видео продолжает играть). */
        private const val UNPIN_JS = "(function(){if(window.__ltUnpin){window.__ltUnpin();}return 1;})()"

        /** Ставит видео на паузу и снимает PIN_JS. */
        private const val PAUSE_JS = "(function(){var v=document.querySelector('[data-ltpin-v]');if(v){try{v.pause();}catch(e){}}if(window.__ltUnpin){window.__ltUnpin();}return 1;})()"

        /** Состояние закреплённого видео: [1, на паузе (0/1), закончилось (0/1)] или [0], если видео пропало. */
        private const val STATE_JS = "(function(){var v=document.querySelector('[data-ltpin-v]');if(!v)return [0];return [1,v.paused?1:0,v.ended?1:0];})()"

        /** Пауза/воспроизведение закреплённого видео: [1, на паузе (0/1)] или [0]. */
        private const val TOGGLE_JS = "(function(){var v=document.querySelector('[data-ltpin-v]');if(!v)return [0];if(v.paused){v.play();}else{v.pause();}return [1,v.paused?1:0];})()"
        private val ID_RE = Regex("[A-Za-z0-9_]{1,40}")
        // Адреса, на которые сайт возвращает человека после входа/выхода (signin-oidc, signin-google, signout-callback-oidc, /oauth/callback…):
        // сами по себе страницей не являются, повторно открытые отвечают ошибкой — «местом на сайте» не запоминаются.
        private val CALLBACK_RE = Regex("(?i)/(signin|signout|signout-callback)-[a-z0-9]+(/|$)|/(oauth2?|auth|openid|oidc)/callback(/|$)")
    }

    private class Tab(val id: String) {
        var view: WebView? = null
        @Volatile var shown = false
        @Volatile var ready = false
        @Volatile var curUrl = ""
        @Volatile var curTitle = ""
        @Volatile var canBack = false
        @Volatile var failed = false   // главная страница не загрузилась (страница ошибки) — место на сайте не сохраняется
        var recoverAt = 0L
        var needFix = true
        var lastUsed = 0L
        var saveTask: Runnable? = null
        var floating = false   // WebView сейчас в плавающем окне с видео (FloatingVideo), а не в host
        var floatKind = 0      // KIND_LEFT / KIND_MIN
    }

    private val handler = Handler(Looper.getMainLooper())
    private val prefs = activity.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    private val tabs = ConcurrentHashMap<String, Tab>()
    private var periodicOn = false
    private var rL = 0
    private var rT = 0
    private var rW = 1
    private var rH = 1
    private var kb = 0
    private var holes: List<RectF> = emptyList() // окна под кнопки страницы, px родителя
    private var appVisible = true                // окно приложения на экране (onStart…onStop)
    private var floatWin: FloatingVideo? = null
    private var floatTab: Tab? = null            // вкладка в плавающем окне (одна)

    private fun k(id: String, name: String) = "$id.$name"
    private fun dir(): File = File(activity.applicationContext.filesDir, DIR).apply { mkdirs() }
    private fun stateFile(id: String) = File(dir(), "$id.state")
    private fun iconFile(id: String) = File(dir(), "$id.png")

    private fun shownTab(): Tab? = tabs.values.firstOrNull { it.shown }

    val isVisible: Boolean get() = shownTab()?.view != null

    fun canGoBack(): Boolean = shownTab()?.view?.canGoBack() == true
    fun goBack() { shownTab()?.view?.goBack() }

    private fun isCallbackUrl(url: String?): Boolean {
        if (url.isNullOrEmpty()) return false
        val path = try { Uri.parse(url).path } catch (e: Exception) { null }
        if (path == null) return false
        return CALLBACK_RE.containsMatchIn(path)
    }

    /**
     * Обратный вызов входа (signin-oidc и т. п.) ответил ошибкой: вкладка один раз возвращается на домашний адрес — если вход уже
     * состоялся, сайт откроется сразу, иначе покажет форму входа. Повтор не чаще раза в минуту, чтобы не крутиться по кругу.
     */
    private fun recoverFromFailedCallback(t: Tab, v: WebView) {
        val now = System.currentTimeMillis()
        if (now - t.recoverAt < RECOVER_MIN_GAP_MS) return
        val home = prefs.getString(k(t.id, "home"), null)
        if (home.isNullOrEmpty()) return
        t.recoverAt = now
        handler.post { if (t.view === v) v.loadUrl(home) }
    }

    /** Только http(s) с хостом; http поднимается до https (открытый трафик в приложении запрещён). */
    private fun cleanUrl(raw: String?): String? {
        val s = raw?.trim() ?: return null
        if (s.isEmpty() || s.length > 2000) return null
        val u = try { Uri.parse(s) } catch (e: Exception) { return null }
        val scheme = u.scheme?.lowercase()
        if (scheme != "https" && scheme != "http") return null
        if (u.host.isNullOrEmpty()) return null
        return if (scheme == "http") "https" + s.substring(4) else s
    }

    /** Показывает WebView вкладки [id] в прямоугольнике (CSS-пиксели страницы приложения); остальные вкладки прячутся. */
    fun show(id: String, url: String, x: Double, y: Double, w: Double, h: Double) {
        if (!ID_RE.matches(id)) return
        if (prefs.getString(k(id, "home"), null).isNullOrEmpty()) {
            val clean = cleanUrl(url) ?: return
            prefs.edit().putString(k(id, "home"), clean).apply()
        }
        val t = tabs.getOrPut(id) { Tab(id) }
        if (t.floating) closeFloat(t, false) // вернулись на вкладку: видео из плавающего окна встаёт обратно в страницу и играет дальше
        for (o in tabs.values) if (o !== t && o.shown) hideTab(o)
        val v = ensureView(t)
        val d = activity.resources.displayMetrics.density
        val left = (x * d).roundToInt()
        val top = (y * d).roundToInt()
        val wPx = (w * d).roundToInt().coerceAtLeast(1)
        val hPx = (h * d).roundToInt().coerceAtLeast(1)
        rL = left
        rT = top
        rW = wPx
        rH = hPx
        layoutShown(v)
        activity.setSiteKeyboardOverlay(true)
        val wasShown = t.shown
        t.shown = true
        t.lastUsed = System.currentTimeMillis()
        if (!wasShown) {
            prefs.edit().putString(KEY_LAST, id).putString(KEY_RECT, "$left,$top,$wPx,$hPx").apply()
            v.onResume()
        }
        if (t.ready) {
            reveal(t)
        } else if (!wasShown) {
            handler.postDelayed({ if (t.shown && !t.ready) markReady(t) }, REVEAL_TIMEOUT_MS)
        }
        startPeriodicSave()
    }

    /** Экранная клавиатура окно не сжимает (вкладки на местах): WebView укорачивается до её верха. */
    private fun layoutShown(v: WebView) {
        val h = if (kb > 0) minOf(rH, maxOf(1, host.height - kb - rT)) else rH
        applyRect(v, rL, rT, rW, h)
    }

    fun setKeyboardInset(px: Int) {
        if (kb == px) return
        kb = px
        val v = shownTab()?.view ?: return
        layoutShown(v)
    }

    /**
     * Окна под кнопки страницы: [spec] — «x,y,w,h;x,y,w,h» в CSS-пикселях страницы (как прямоугольник в [show]); пусто — окон нет.
     * Работает с Android 10 (API 29); раньше страница сама укорачивает сайт над рядом кнопок.
     */
    fun setHoles(spec: String?) {
        if (Build.VERSION.SDK_INT < 29) return
        val d = activity.resources.displayMetrics.density
        val list = ArrayList<RectF>()
        if (!spec.isNullOrEmpty() && spec.length < 400) {
            for (part in spec.split(";")) {
                val nums = part.split(",").mapNotNull { it.trim().toFloatOrNull() }
                if (nums.size != 4 || nums[2] <= 0f || nums[3] <= 0f) continue
                list.add(RectF(nums[0] * d, nums[1] * d, (nums[0] + nums[2]) * d, (nums[1] + nums[3]) * d))
                if (list.size >= 8) break
            }
        }
        holes = list
        val r = 8f * d
        for (t in tabs.values) if (!t.floating) (t.view as? SiteWebView)?.setHoles(list, r)
    }

    private fun applyRect(v: WebView, left: Int, top: Int, wPx: Int, hPx: Int) {
        val cur = v.layoutParams as? FrameLayout.LayoutParams
        if (cur != null && cur.width == wPx && cur.height == hPx && cur.leftMargin == left && cur.topMargin == top) return
        val lp = FrameLayout.LayoutParams(wPx, hPx)
        lp.leftMargin = left
        lp.topMargin = top
        v.layoutParams = lp
    }

    private fun reveal(t: Tab) {
        val v = t.view ?: return
        if (v.translationX != 0f) v.translationX = 0f
    }

    private fun hideTab(t: Tab) {
        if (!t.shown) return
        t.shown = false
        val v = t.view ?: return
        saveTab(t)
        v.clearFocus()
        v.translationX = OFFSCREEN_X
        // играет видео — оно уходит в плавающее окно, иначе вкладка ставится на паузу
        if (t.ready) tryFloat(t, v, KIND_LEFT) { if (!t.shown && !t.floating && t.view === v) v.onPause() }
    }

    /** Прячет показанную вкладку (страница живёт за краем, позиция сохраняется). */
    fun hide() {
        for (t in tabs.values) hideTab(t)
        activity.setSiteKeyboardOverlay(false)
    }

    fun reload(id: String) {
        if (!ID_RE.matches(id)) return
        tabs[id]?.view?.reload()
    }

    /** Новый адрес вкладки: сохранённое место сбрасывается, грузится новая страница. */
    fun go(id: String, url: String) {
        if (!ID_RE.matches(id)) return
        val clean = cleanUrl(url) ?: return
        prefs.edit()
            .putString(k(id, "home"), clean)
            .putString(k(id, "url"), clean)
            .putInt(k(id, "sy"), 0)
            .remove(k(id, "title"))
            .remove(k(id, "rev"))
            .apply()
        stateFile(id).delete()
        iconFile(id).delete()
        val t = tabs[id] ?: return
        if (t.floating) closeFloat(t, true)
        t.curUrl = clean
        t.curTitle = ""
        val v = t.view ?: return
        t.ready = false
        t.needFix = false
        v.loadUrl(clean)
        if (t.shown) handler.postDelayed({ if (t.shown && !t.ready) markReady(t) }, REVEAL_TIMEOUT_MS)
    }

    /** Вкладку удалили: WebView, сохранённое состояние, значок и записи пропадают. */
    fun remove(id: String) {
        if (!ID_RE.matches(id)) return
        val t = tabs.remove(id)
        if (t != null) {
            if (t.floating) closeFloat(t, true)
            if (t.shown) activity.setSiteKeyboardOverlay(false)
            val task = t.saveTask
            if (task != null) handler.removeCallbacks(task)
            t.shown = false
            val v = t.view
            t.view = null
            if (v != null) {
                (v.parent as? ViewGroup)?.removeView(v)
                v.destroy()
            }
        }
        stateFile(id).delete()
        iconFile(id).delete()
        val e = prefs.edit()
        for (name in listOf("home", "url", "sy", "title", "rev")) e.remove(k(id, name))
        if (prefs.getString(KEY_LAST, null) == id) e.remove(KEY_LAST)
        e.apply()
    }

    /** JSON для вкладки: только кэшированные поля (вызывается из потока моста, к WebView не обращается). */
    fun stateJson(id: String): String {
        if (!ID_RE.matches(id)) return "{}"
        val t = tabs[id]
        return JSONObject()
            .put("created", t?.view != null)
            .put("ready", t?.ready == true)
            .put("shown", t?.shown == true)
            .put("url", (t?.curUrl?.ifEmpty { null }) ?: prefs.getString(k(id, "url"), "") ?: "")
            .put("title", (t?.curTitle?.ifEmpty { null }) ?: prefs.getString(k(id, "title"), "") ?: "")
            .put("canGoBack", t?.canBack == true)
            .put("rev", prefs.getInt(k(id, "rev"), 0))
            .toString()
    }

    /** Значок сайта как data:image/png;base64 (пусто, пока сайт его не отдал). */
    fun iconDataUrl(id: String): String {
        if (!ID_RE.matches(id)) return ""
        val f = iconFile(id)
        if (!f.exists()) return ""
        return try {
            "data:image/png;base64," + Base64.encodeToString(f.readBytes(), Base64.NO_WRAP)
        } catch (e: Exception) {
            ""
        }
    }

    /** Приложение уходит с экрана: место на странице всех открытых вкладок сохраняется, cookie сбрасываются на диск. */
    fun pause() {
        for (t in tabs.values) saveTab(t)
        try { CookieManager.getInstance().flush() } catch (e: Exception) { }
    }

    fun destroy() {
        handler.removeCallbacksAndMessages(null)
        periodicOn = false
        floatTab?.floating = false
        floatTab = null
        floatWin?.detach()
        floatWin = null
        for (t in tabs.values) {
            val v = t.view ?: continue
            t.view = null
            (v.parent as? ViewGroup)?.removeView(v)
            v.destroy()
        }
        tabs.clear()
    }

    /** При запуске приложения последняя открытая вкладка догружается за краем — к заходу на неё страница уже на месте. */
    fun preloadLast() {
        handler.postDelayed({ doPreload() }, PRELOAD_DELAY_MS)
    }

    private fun doPreload() {
        val id = prefs.getString(KEY_LAST, null) ?: return
        if (!ID_RE.matches(id)) return
        if (prefs.getString(k(id, "home"), null).isNullOrEmpty()) return
        val t = tabs.getOrPut(id) { Tab(id) }
        if (t.view != null) return
        ensureView(t)
    }

    // ---------- плавающее видео ----------

    private val floatCallback = object : FloatingVideo.Callback {
        override fun onExpand() {
            val t = floatTab ?: return
            activity.openUserTabFromIsland(t.id)
        }

        override fun onClose() {
            val t = floatTab ?: return
            closeFloat(t, true)
        }

        override fun onTogglePlay() {
            val v = floatTab?.view ?: return
            v.evaluateJavascript(TOGGLE_JS) { raw ->
                val a = parseNums(raw)
                if (a != null && a.size > 1 && a[0] == 1.0) floatWin?.setPaused(a[1] == 1.0)
            }
        }
    }

    private fun win(): FloatingVideo = floatWin ?: FloatingVideo(activity, floatCallback).also { floatWin = it }

    private fun parseNums(raw: String?): DoubleArray? {
        if (raw.isNullOrEmpty() || raw == "null") return null
        return try {
            val a = JSONArray(raw)
            DoubleArray(a.length()) { a.optDouble(it, 0.0) }
        } catch (e: Exception) {
            null
        }
    }

    /** Приложение свернули (onStop): играющее видео открытой вкладки уходит в плавающее окно поверх других приложений. */
    fun onAppHidden() {
        appVisible = false
        val t = shownTab() ?: return
        val v = t.view ?: return
        if (!t.ready || t.floating) return
        if (!win().canOverlay()) return // без разрешения «Поверх других приложений» окна вне приложения не будет
        tryFloat(t, v, KIND_MIN) { }
    }

    /** Приложение вернулось на экран (onStart): видео, ушедшее в окно при сворачивании, встаёт обратно на свою вкладку. */
    fun onAppVisible() {
        appVisible = true
        val t = floatTab ?: return
        if (!t.floating || t.floatKind != KIND_MIN) return
        closeFloat(t, false)
        val v = t.view ?: return
        t.shown = true
        t.lastUsed = System.currentTimeMillis()
        layoutShown(v)
        activity.setSiteKeyboardOverlay(true)
        if (t.ready) reveal(t)
        startPeriodicSave()
    }

    /**
     * Ищет на странице играющее видео и закрепляет его (PIN_JS). Нашлось и ничего не изменилось за время ответа страницы — вкладка
     * уходит в плавающее окно; иначе вызывается [onNone] (при уходе с вкладки — пауза WebView, как раньше).
     */
    private fun tryFloat(t: Tab, v: WebView, kind: Int, onNone: () -> Unit) {
        if (t.floating) return
        v.evaluateJavascript(PIN_JS) { raw ->
            val a = parseNums(raw)
            if (a == null || a.isEmpty() || a[0] != 1.0) {
                onNone()
            } else {
                val stale = t.view !== v || t.floating ||
                    (kind == KIND_LEFT && t.shown) ||
                    (kind == KIND_MIN && (appVisible || !t.shown))
                if (stale) {
                    if (t.view === v && !t.floating) v.evaluateJavascript(UNPIN_JS, null)
                } else {
                    startFloating(t, v, kind, a, onNone)
                }
            }
        }
    }

    private fun startFloating(t: Tab, v: WebView, kind: Int, a: DoubleArray, onFail: () -> Unit) {
        val iw = if (a.size > 1) a[1] else 0.0
        val bw = if (a.size > 3) a[3] else 0.0
        val bh = if (a.size > 4) a[4] else 0.0
        val vw = v.width
        val vh = v.height
        if (iw <= 0.0 || bw <= 0.0 || bh <= 0.0 || vw <= 0 || vh <= 0) {
            v.evaluateJavascript(UNPIN_JS, null)
            onFail()
            return
        }
        val conv = vw / iw // пикселей WebView в одном CSS-пикселе страницы
        val rw = (bw * conv).roundToInt().coerceIn(1, vw)
        val rh = (bh * conv).roundToInt().coerceIn(1, vh)
        val prev = floatTab
        if (prev != null && prev !== t) closeFloat(prev, true)
        val w = win()
        (v as? SiteWebView)?.setHoles(emptyList(), 0f)
        w.show(v, vw, vh, rw, rh)
        if (!w.isShown) {
            // окно не встало (разрешение отозвано и т. п.) — всё возвращается как было
            w.detach()
            restoreToHost(v)
            v.evaluateJavascript(UNPIN_JS, null)
            onFail()
            return
        }
        t.floating = true
        t.floatKind = kind
        t.shown = false
        floatTab = t
        v.onResume()
        w.setPaused(false)
        handler.removeCallbacks(floatPollTask)
        handler.postDelayed(floatPollTask, FLOAT_POLL_MS)
        if (kind == KIND_LEFT) w.askOverlayOnce()
    }

    /** Убирает плавающее окно: WebView возвращается в host (за край); [pause] — видео ставится на паузу, вкладка засыпает. */
    private fun closeFloat(t: Tab, pause: Boolean) {
        if (!t.floating) return
        handler.removeCallbacks(floatPollTask)
        t.floating = false
        if (floatTab === t) floatTab = null
        floatWin?.detach()
        val v = t.view ?: return
        v.evaluateJavascript(if (pause) PAUSE_JS else UNPIN_JS, null)
        restoreToHost(v)
        if (pause) {
            // даём скрипту паузы выполниться, потом усыпляем WebView
            handler.postDelayed({ if (t.view === v && !t.shown && !t.floating) v.onPause() }, 300L)
        }
    }

    private fun restoreToHost(v: WebView) {
        (v.parent as? ViewGroup)?.removeView(v)
        v.scaleX = 1f
        v.scaleY = 1f
        roundTopRight(v)
        (v as? SiteWebView)?.setHoles(holes, 8f * activity.resources.displayMetrics.density)
        v.translationX = OFFSCREEN_X
        host.addView(v, initialParams())
    }

    /** Раз в секунду смотрит на закреплённое видео: пауза — значок «играть»; видео закончилось или пропало — окно закрывается. */
    private val floatPollTask = object : Runnable {
        override fun run() {
            val t = floatTab
            val v = t?.view
            if (t == null || v == null || !t.floating) return
            v.evaluateJavascript(STATE_JS) { raw ->
                if (t.floating && floatTab === t) {
                    val a = parseNums(raw)
                    if (a == null || a.isEmpty() || a[0] != 1.0 || (a.size > 2 && a[2] == 1.0)) {
                        closeFloat(t, true)
                    } else {
                        floatWin?.setPaused(a.size > 1 && a[1] == 1.0)
                        handler.postDelayed(this, FLOAT_POLL_MS)
                    }
                }
            }
        }
    }

    // ---------- WebView ----------

    private fun initialParams(): FrameLayout.LayoutParams {
        val r = prefs.getString(KEY_RECT, null)?.split(",")?.mapNotNull { it.toIntOrNull() }
        if (r != null && r.size == 4 && r[2] > 0 && r[3] > 0) {
            val lp = FrameLayout.LayoutParams(r[2], r[3])
            lp.leftMargin = r[0]
            lp.topMargin = r[1]
            return lp
        }
        return FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
    }

    /** Не больше MAX_LIVE живых WebView: самая давняя скрытая вкладка выгружается (место на странице сохранено). */
    private fun evictIfNeeded(except: Tab) {
        var live = 0
        for (t in tabs.values) if (t.view != null) live++
        if (live < MAX_LIVE) return
        var victim: Tab? = null
        for (t in tabs.values) {
            if (t === except || t.shown || t.floating || t.view == null) continue
            if (victim == null || t.lastUsed < victim.lastUsed) victim = t
        }
        val vt = victim ?: return
        saveTab(vt)
        val v = vt.view
        vt.view = null
        vt.ready = false
        if (v != null) {
            (v.parent as? ViewGroup)?.removeView(v)
            v.destroy()
        }
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun ensureView(t: Tab): WebView {
        t.view?.let { return it }
        evictIfNeeded(t)
        val v = SiteWebView(activity)
        v.setHoles(holes, 8f * activity.resources.displayMetrics.density)
        v.setBackgroundColor(0xFFFFFFFF.toInt())
        v.isVerticalScrollBarEnabled = false
        v.isHorizontalScrollBarEnabled = false
        roundTopRight(v)
        configure(v, t)
        v.translationX = OFFSCREEN_X
        host.addView(v, initialParams())
        t.view = v
        t.ready = false
        t.needFix = true
        t.lastUsed = System.currentTimeMillis()
        // Место, сохранённое на обратном вызове входа (запомнено прежними версиями), сбрасывается: вкладка открывается с домашнего адреса.
        val saved = prefs.getString(k(t.id, "url"), null)
        if (isCallbackUrl(saved)) {
            stateFile(t.id).delete()
            prefs.edit().remove(k(t.id, "url")).putInt(k(t.id, "sy"), 0).apply()
        }
        if (!restoreFromDisk(t.id, v)) {
            val last = prefs.getString(k(t.id, "url"), null)
            val target = if (!last.isNullOrEmpty()) last else prefs.getString(k(t.id, "home"), "") ?: ""
            if (target.isNotEmpty()) v.loadUrl(target)
        }
        return v
    }

    /** Скругляет только правый верхний угол сайта (как у окна настроек, 14 px страницы); остальные углы выносятся за границы вида. */
    private fun roundTopRight(v: WebView) {
        val r = 14f * activity.resources.displayMetrics.density
        v.outlineProvider = object : ViewOutlineProvider() {
            override fun getOutline(view: View, outline: Outline) {
                outline.setRoundRect((-r).toInt(), 0, view.width, (view.height + r).toInt(), r)
            }
        }
        v.clipToOutline = true
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun configure(v: WebView, t: Tab) {
        val s = v.settings
        s.javaScriptEnabled = true
        s.domStorageEnabled = true
        s.allowFileAccess = false
        s.allowContentAccess = false
        s.setSupportMultipleWindows(false)
        s.javaScriptCanOpenWindowsAutomatically = true
        s.setSupportZoom(true)
        s.builtInZoomControls = true
        s.displayZoomControls = false
        s.useWideViewPort = true
        // Метки WebView («; wv», «Version/4.0») заставляют сайты показывать упрощённую страницу или отказывать во входе в аккаунт.
        s.userAgentString = s.userAgentString.replace("; wv", "").replace(Regex("Version/[0-9.]+ "), "")
        // Без заголовка X-Requested-With (в нём имя пакета приложения) сайты реже распознают встроенный браузер.
        try {
            if (WebViewFeature.isFeatureSupported(WebViewFeature.REQUESTED_WITH_HEADER_ALLOW_LIST)) {
                WebSettingsCompat.setRequestedWithHeaderOriginAllowList(s, emptySet())
            }
        } catch (e: Throwable) {
            // не поддерживается этой версией WebView — заголовок остаётся
        }
        val cookies = CookieManager.getInstance()
        cookies.setAcceptCookie(true)
        cookies.setAcceptThirdPartyCookies(v, true)

        v.setDownloadListener { url, _, _, _, _ ->
            try { activity.openExternalLink(Uri.parse(url)) } catch (e: Exception) { }
        }

        v.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView?, request: WebResourceRequest?): Boolean =
                handleUrl(request?.url)

            @Suppress("OVERRIDE_DEPRECATION", "DEPRECATION")
            override fun shouldOverrideUrlLoading(view: WebView?, url: String?): Boolean =
                handleUrl(if (url == null) null else Uri.parse(url))

            override fun onPageStarted(view: WebView?, url: String?, favicon: Bitmap?) {
                if (view != null && t.view === view) t.failed = false
            }

            override fun onPageFinished(view: WebView?, url: String?) {
                pageFinished(t, view)
            }

            override fun onReceivedError(view: WebView?, request: WebResourceRequest?, error: WebResourceError?) {
                if (request?.isForMainFrame == true) mainFrameFailed(t, view, request.url?.toString())
            }

            @Suppress("OVERRIDE_DEPRECATION", "DEPRECATION")
            override fun onReceivedError(view: WebView?, errorCode: Int, description: String?, failingUrl: String?) {
                mainFrameFailed(t, view, failingUrl)
            }

            override fun doUpdateVisitedHistory(view: WebView?, url: String?, isReload: Boolean) {
                if (view != null && t.view === view) {
                    t.canBack = view.canGoBack()
                    if (!url.isNullOrEmpty() && url != "about:blank") t.curUrl = url
                }
                scheduleSave(t)
            }

            override fun onRenderProcessGone(view: WebView?, detail: RenderProcessGoneDetail?): Boolean {
                // Процесс рендера упал: WebView убирается, при следующем показе он создастся заново и встанет на сохранённое место.
                activity.runOnUiThread {
                    if (t.floating) {
                        handler.removeCallbacks(floatPollTask)
                        floatWin?.detach()
                        if (floatTab === t) floatTab = null
                        t.floating = false
                    }
                    val old = t.view
                    t.view = null
                    t.ready = false
                    t.shown = false
                    if (old != null) {
                        (old.parent as? ViewGroup)?.removeView(old)
                        old.destroy()
                    }
                }
                return true
            }
        }
        v.webChromeClient = object : WebChromeClient() {
            override fun onShowFileChooser(
                view: WebView?,
                callback: ValueCallback<Array<Uri>>?,
                params: FileChooserParams?
            ): Boolean = activity.handleFileChooser(callback, params)

            override fun onReceivedIcon(view: WebView?, icon: Bitmap?) {
                if (icon != null) saveIcon(t, icon)
            }

            override fun onReceivedTitle(view: WebView?, title: String?) {
                if (!title.isNullOrEmpty()) {
                    t.curTitle = title.take(120)
                    prefs.edit().putString(k(t.id, "title"), t.curTitle).apply()
                }
            }
        }
    }

    private fun mainFrameFailed(t: Tab, view: WebView?, url: String?) {
        if (view == null || t.view !== view) return
        t.failed = true
        if (isCallbackUrl(url)) recoverFromFailedCallback(t, view)
    }

    /** true — переход перехвачен (не web-адрес уходит во внешнее приложение), false — грузит сам WebView. */
    private fun handleUrl(uri: Uri?): Boolean {
        if (uri == null) return true
        val scheme = uri.scheme?.lowercase() ?: return true
        if (scheme == "http" || scheme == "https" || scheme == "about" || scheme == "blob" || scheme == "data" || scheme == "javascript") return false
        activity.openExternalLink(uri)
        return true
    }

    // ---------- загрузка, место на странице ----------

    private fun pageFinished(t: Tab, v: WebView?) {
        if (v == null || t.view !== v) return
        t.canBack = v.canGoBack()
        val u = v.url
        if (!u.isNullOrEmpty() && u != "about:blank") t.curUrl = u
        if (t.needFix) {
            t.needFix = false
            val sy = prefs.getInt(k(t.id, "sy"), 0)
            val cssY = (sy / activity.resources.displayMetrics.density).roundToInt()
            if (cssY > 0) {
                v.evaluateJavascript(scrollJs(cssY)) { markReady(t) }
                return
            }
        }
        markReady(t)
        scheduleSave(t)
    }

    /** Доводит прокрутку до сохранённой (если восстановление WebView её не вернуло); останавливается, как только человек коснулся экрана. */
    private fun scrollJs(y: Int): String =
        "(function(y){try{var stop=false;" +
            "window.addEventListener('touchstart',function(){stop=true;},{passive:true,once:true});" +
            "var n=0;function cur(){return window.pageYOffset||document.documentElement.scrollTop||0;}" +
            "function step(){if(stop||n>=14)return;if(Math.abs(cur()-y)>4){window.scrollTo(0,y);}n++;setTimeout(step,150);}" +
            "step();}catch(e){}return 1;})($y)"

    /** Страница загружена и стоит на своём месте: можно показывать (до этого WebView остаётся за краем). */
    private fun markReady(t: Tab) {
        if (t.ready) return
        val v = t.view ?: return
        t.ready = true
        if (t.shown) reveal(t) else v.onPause()
        saveTab(t)
    }

    private fun scheduleSave(t: Tab) {
        val old = t.saveTask
        if (old != null) handler.removeCallbacks(old)
        val r = Runnable { saveTab(t) }
        t.saveTask = r
        handler.postDelayed(r, SAVE_DEBOUNCE_MS)
    }

    private fun startPeriodicSave() {
        if (periodicOn) return
        periodicOn = true
        handler.postDelayed(periodic, SAVE_EVERY_MS)
    }

    private val periodic = object : Runnable {
        override fun run() {
            val t = shownTab()
            if (t == null) {
                periodicOn = false
                return
            }
            saveTab(t)
            handler.postDelayed(this, SAVE_EVERY_MS)
        }
    }

    /** История переходов и прокрутка — в файл, адрес и прокрутка для запасного пути — в SharedPreferences. Недогруженную страницу не пишем. */
    private fun saveTab(t: Tab) {
        val v = t.view ?: return
        if (!t.ready || t.floating) return // в плавающем окне страница закреплена на видео: её место не запоминается
        val url = v.url
        if (url.isNullOrEmpty() || url == "about:blank") return
        if (t.failed || isCallbackUrl(url)) return // страница ошибки и обратный вызов входа не запоминаются: прежнее место на сайте остаётся
        val b = Bundle()
        val list = try { v.saveState(b) } catch (e: Exception) { null }
        if (list != null) {
            try {
                val p = Parcel.obtain()
                val bytes = try {
                    p.writeBundle(b)
                    p.marshall()
                } finally {
                    p.recycle()
                }
                writeAtomic(stateFile(t.id), bytes)
            } catch (e: Exception) {
                // состояние не записалось — останется предыдущее
            }
        }
        val e = prefs.edit()
        e.putString(k(t.id, "url"), url)
        e.putInt(k(t.id, "sy"), v.scrollY)
        val title = v.title
        if (!title.isNullOrEmpty()) e.putString(k(t.id, "title"), title.take(120))
        e.apply()
    }

    private fun restoreFromDisk(id: String, v: WebView): Boolean {
        val f = stateFile(id)
        if (!f.exists()) return false
        return try {
            val bytes = f.readBytes()
            val p = Parcel.obtain()
            try {
                p.unmarshall(bytes, 0, bytes.size)
                p.setDataPosition(0)
                val b = p.readBundle(UserTabs::class.java.classLoader)
                b != null && v.restoreState(b) != null
            } finally {
                p.recycle()
            }
        } catch (e: Exception) {
            false
        }
    }

    private fun writeAtomic(f: File, bytes: ByteArray) {
        val tmp = File(f.parentFile, f.name + ".tmp")
        tmp.writeBytes(bytes)
        if (!tmp.renameTo(f)) {
            f.delete()
            tmp.renameTo(f)
        }
    }

    private fun saveIcon(t: Tab, icon: Bitmap) {
        try {
            val bmp = Bitmap.createScaledBitmap(icon, ICON_PX, ICON_PX, true)
            val out = ByteArrayOutputStream()
            bmp.compress(Bitmap.CompressFormat.PNG, 100, out)
            val bytes = out.toByteArray()
            val f = iconFile(t.id)
            if (f.exists() && f.readBytes().contentEquals(bytes)) return
            writeAtomic(f, bytes)
            prefs.edit().putInt(k(t.id, "rev"), prefs.getInt(k(t.id, "rev"), 0) + 1).apply()
        } catch (e: Exception) {
            // значок не сохранился — вкладка покажет букву сайта
        }
    }
}
