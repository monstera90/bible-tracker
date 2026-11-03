package com.app.lifetracker
// Версия: 7.0 (04.11)

import android.annotation.SuppressLint
import android.content.Context
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Path
import android.media.AudioManager
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
import androidx.webkit.JavaScriptReplyProxy
import androidx.webkit.WebMessageCompat
import androidx.webkit.WebSettingsCompat
import androidx.webkit.WebViewCompat
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

    /** Идёт фоновое воспроизведение: окну приложения скрыться можно, а странице об этом знать нельзя (иначе Chromium гасит ролик). */
    @Volatile var keepAwake = false

    override fun onWindowVisibilityChanged(visibility: Int) {
        super.onWindowVisibilityChanged(if (keepAwake && visibility != View.VISIBLE) View.VISIBLE else visibility)
    }

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
 * Сейчас плавающее окно ВЫКЛЮЧЕНО (`FLOAT_WINDOW = false`), вместо него — фоновое воспроизведение с островом (см. ниже).
 *
 * Фоновое воспроизведение (SiteMediaService): если на вкладке играет видео или звук, а человек ушёл с вкладки (`hideTab`), погасил
 * экран или свернул приложение (`pause`/`onAppHidden`), WebView вкладки НЕ ставится на паузу (`Tab.bg`), страница видит себя
 * «видимой» (скрипт MEDIA_JS подменяет `document.hidden` и глушит `visibilitychange`, иначе сайты вроде YouTube сами ставят паузу),
 * а служба переднего плана держит процесс и показывает уведомление с островом Xiaomi: «Пауза/Играть» и «Закрыть». Служба
 * стартует, как только ролик заиграл (`probeTask`, пока приложение видно), а не при сворачивании. Раз в секунду `bgPollTask`
 * смотрит на ролик: пауза — меняется кнопка (если страница сама поставила паузу в фоне — ролик запускается заново, `maybeResume`),
 * ролик закончился или пропал — всё снимается (WebView засыпает); вернулись на вкладку — служба остаётся, пока ролик играет.
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
        private const val FLOAT_WINDOW = false       // плавающее окно с видео (FloatingVideo) выключено: сначала остров
        private const val BG_POLL_MS = 1000L
        private const val PROBE_MS = 1000L
        private const val RESUME_AFTER_MS = 800L          // страница сама поставила ролик на паузу в фоне — через столько он запускается заново
        private const val RESUME_MAX_TRIES = 3            // попыток подряд, пока ролик не поиграл хотя бы RESUME_STABLE_MS
        private const val RESUME_STABLE_MS = 10000L
        private const val DIAG_EVERY_MS = 5000L           // снимок страницы при пробе — не чаще (при уходе с вкладки/сворачивании — всегда)
        private const val FRAME_FRESH_MS = 8000L         // «играет» из кадра верно, пока сообщение не старше
        private const val BG_PAUSED_MAX_MS = 10L * 60L * 1000L // на паузе в фоне дольше — вкладка засыпает, уведомление снимается

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

        /**
         * Находит играющий ролик (видео со звуком или длиннее минуты, либо любое аудио; зацикленные фоновые ролики сайтов не в счёт):
         * сначала в самой странице, затем — в открытых shadow-root и iframe того же происхождения. Лучший ролик запоминается в
         * `window.__ltMediaEl` (и помечается data-ltmedia), страница (и страница iframe с роликом) становится «видимой»:
         * document.hidden = false, hasFocus() = true, visibilitychange и blur окна глушатся — иначе сайты вроде YouTube сами ставят паузу
         * при сворачивании. Ответ: [1] — нашёлся, [0] — играющего ролика нет.
         */
        private const val MEDIA_JS = """(function(){try{var D=document,W=window;
function hook(w){try{var d=w.document;if(w.__ltHooked){w.__ltVis=1;return;}w.__ltHooked=1;w.__ltVis=1;
var P=w.Document&&w.Document.prototype;
function real(n){try{var g=Object.getOwnPropertyDescriptor(P,n);return g&&g.get?g.get.call(d):undefined;}catch(e){return undefined;}}
try{Object.defineProperty(d,'hidden',{configurable:true,get:function(){return w.__ltVis===1?false:real('hidden');}});}catch(e){}
try{Object.defineProperty(d,'webkitHidden',{configurable:true,get:function(){return w.__ltVis===1?false:real('webkitHidden');}});}catch(e){}
try{Object.defineProperty(d,'visibilityState',{configurable:true,get:function(){return w.__ltVis===1?'visible':real('visibilityState');}});}catch(e){}
try{Object.defineProperty(d,'webkitVisibilityState',{configurable:true,get:function(){return w.__ltVis===1?'visible':real('webkitVisibilityState');}});}catch(e){}
try{var hf=d.hasFocus;d.hasFocus=function(){return w.__ltVis===1?true:hf.call(d);};}catch(e){}
var ev=['visibilitychange','webkitvisibilitychange','blur'];
for(var i=0;i<ev.length;i++){w.addEventListener(ev[i],function(e){if(w.__ltVis!==1)return;if(e.type==='blur'&&e.target!==w&&e.target!==d)return;e.stopImmediatePropagation();},true);}
}catch(e){}}
function pick(root,out){var els=root.querySelectorAll('video,audio'),i;for(i=0;i<els.length;i++){var v=els[i];
if(v.paused||v.ended||v.readyState<2||v.loop)continue;
var long=(v.duration>60||!isFinite(v.duration));
if(v.muted&&!long)continue;
var s=(v.tagName==='VIDEO'?1000000000:0)+(long?100000000:0)+(v.videoWidth||0)*(v.videoHeight||0);
out.push([s,v]);}}
function deep(root,out,dep){if(dep>3)return;var all=root.querySelectorAll('*'),i,n=all.length>5000?5000:all.length;
for(i=0;i<n;i++){var e=all[i];
if(e.shadowRoot){pick(e.shadowRoot,out);deep(e.shadowRoot,out,dep+1);}
if(e.tagName==='IFRAME'){try{var d=e.contentDocument;if(d){pick(d,out);deep(d,out,dep+1);}}catch(x){}}}}
var c=[];pick(D,c);if(!c.length)deep(D,c,0);
if(!c.length)return [0];
var best=null,sc=-1,i;for(i=0;i<c.length;i++){if(c[i][0]>sc){sc=c[i][0];best=c[i][1];}}
try{var old=W.__ltMediaEl;if(old&&old!==best)old.removeAttribute('data-ltmedia');}catch(e){}
W.__ltMediaEl=best;best.setAttribute('data-ltmedia','1');
hook(W);
try{var ow=best.ownerDocument&&best.ownerDocument.defaultView;if(ow&&ow!==W)hook(ow);}catch(e){}
return [1];}catch(e){return [0];}})()"""

        /** Помеченный ролик (запомнен в window.__ltMediaEl; запасной путь — атрибут data-ltmedia). */
        private const val MEDIA_EL_JS = "var W=window,v=(W.__ltMediaEl&&W.__ltMediaEl.isConnected)?W.__ltMediaEl:document.querySelector('[data-ltmedia]');"

        /** Состояние помеченного ролика: [1, на паузе (0/1), закончился (0/1), название, секунда, readyState, ошибка play() или пусто] или [0], если ролик пропал. */
        private const val MEDIA_STATE_JS = "(function(){try{" + MEDIA_EL_JS + "if(!v)return [0];" +
            "var t='';try{var m=navigator.mediaSession&&navigator.mediaSession.metadata;if(m&&m.title)t=String(m.title);}catch(e){}" +
            "if(!t)t=document.title||'';var pe=W.__ltPlayErr||'';W.__ltPlayErr='';" +
            "return [1,v.paused?1:0,v.ended?1:0,t.slice(0,120),Math.round(v.currentTime||0),v.readyState|0,pe];}catch(e){return [0];}})()"

        /** Пауза/воспроизведение помеченного ролика: [1, на паузе (0/1)] или [0]. */
        private const val MEDIA_TOGGLE_JS = "(function(){" + MEDIA_EL_JS + "if(!v)return [0];if(v.paused){try{v.play();}catch(e){}}else{v.pause();}return [1,v.paused?1:0];})()"

        /** Запуск помеченного ролика (страница сама поставила его на паузу в фоне): [1] или [0]. */
        private const val MEDIA_PLAY_JS = "(function(){" + MEDIA_EL_JS + "if(!v)return [0];if(v.paused&&!v.ended){try{var p=v.play();if(p&&p.catch)p.catch(function(e){W.__ltPlayErr=(e&&e.name)||'err';});}catch(e){}}return [1];})()"

        /** Пауза помеченного ролика и возврат страницы в обычный режим видимости. */
        private const val MEDIA_PAUSE_JS = "(function(){" + MEDIA_EL_JS + "if(v){try{v.pause();}catch(e){}}" +
            "W.__ltVis=0;try{var ow=v&&v.ownerDocument&&v.ownerDocument.defaultView;if(ow)ow.__ltVis=0;}catch(e){}return 1;})()"

        /** Возврат страницы в обычный режим видимости (видео продолжает играть). */
        private const val MEDIA_RESTORE_JS = "(function(){" + MEDIA_EL_JS + "W.__ltVis=0;try{var ow=v&&v.ownerDocument&&v.ownerDocument.defaultView;if(ow)ow.__ltVis=0;}catch(e){}return 1;})()"
        /**
         * Скрипт для КАЖДОГО iframe страницы (addDocumentStartJavascript, любые происхождения; в самой странице не работает):
         * кадр всегда «видимый» (document.hidden = false, visibilitychange и blur глушатся), лучший ролик кадра сообщает состояние
         * оболочке через объект ltFrameBridge (`m|пауза|конец|секунда|readyState` или `n`, если ролика нет), а команды `play`/`pause`/`toggle`
         * от оболочки выполняет. Так видео из чужого iframe (плеер на другом домене) тоже может играть в фоне.
         */
        private const val FRAME_JS = """(function(){try{var W=window,D=document;
if(W===W.top||W.__ltFrm)return;W.__ltFrm=1;
function def(o,n,val){try{Object.defineProperty(o,n,{configurable:true,get:function(){return val;}});}catch(e){}}
def(D,'hidden',false);def(D,'webkitHidden',false);def(D,'visibilityState','visible');def(D,'webkitVisibilityState','visible');
try{D.hasFocus=function(){return true;};}catch(e){}
function stop(e){if(e.type==='blur'&&e.target!==W&&e.target!==D)return;e.stopImmediatePropagation();}
var ev=['visibilitychange','webkitvisibilitychange','blur'],i;
for(i=0;i<ev.length;i++){W.addEventListener(ev[i],stop,true);D.addEventListener(ev[i],stop,true);}
function init(){var B=W.ltFrameBridge,lt=0;
function pick(){var els=D.querySelectorAll('video,audio'),best=null,sc=-1,j;
for(j=0;j<els.length;j++){var v=els[j];if(v.loop)continue;
var lg=(v.duration>60||!isFinite(v.duration));if(v.muted&&!lg)continue;
var s=(v.paused?0:1000000000)+(v.tagName==='VIDEO'?100000000:0)+(v.videoWidth||0)*(v.videoHeight||0);
if(s>sc){sc=s;best=v;}}return best;}
function report(e){try{var now=Date.now();if(e&&e.type==='timeupdate'&&now-lt<1000)return;lt=now;var v=pick();
B.postMessage(v?('m|'+(v.paused?1:0)+'|'+(v.ended?1:0)+'|'+Math.round(v.currentTime||0)+'|'+(v.readyState|0)):'n');}catch(x){}}
var me=['play','playing','pause','ended','timeupdate','loadedmetadata','seeked','emptied'],k;
for(k=0;k<me.length;k++){D.addEventListener(me[k],report,true);}
setInterval(report,2000);
B.onmessage=function(e){try{var v=pick();if(!v)return;var c=String(e.data);
if(c==='pause'||(c==='toggle'&&!v.paused)){v.pause();}
else if(c==='play'||c==='toggle'){var p=v.play();if(p&&p.catch)p.catch(function(x){try{B.postMessage('e|'+((x&&x.name)||'err'));}catch(y){}});}
report();}catch(x){}};
report();}
if(W.ltFrameBridge){init();}else{var n=0,tm=setInterval(function(){if(W.ltFrameBridge||++n>30){clearInterval(tm);if(W.ltFrameBridge)init();}},100);}
}catch(e){}})()"""

        /**
         * Снимок страницы для журнала, когда играющий ролик не найден: адрес, все video/audio (пауза, readyState, loop, muted,
         * длина, размер кадра) в самой странице и в доступных iframe, число iframe (и скольких из них не видно — чужое
         * происхождение), число shadow-root. Ответ — одна строка.
         */
        private const val DIAG_JS = """(function(){try{var D=document,o=[],i;
function add(root,tag){var els=root.querySelectorAll('video,audio'),j;for(j=0;j<els.length&&o.length<6;j++){var v=els[j];
o.push(tag+v.tagName.charAt(0)+(v.paused?' пауза':' играет')+(v.ended?' конец':'')+' rs'+v.readyState+(v.loop?' loop':'')+(v.muted?' mute':'')+' d'+(isFinite(v.duration)?Math.round(v.duration):'inf')+' '+(v.videoWidth|0)+'x'+(v.videoHeight|0));}}
add(D,'');
var f=D.getElementsByTagName('iframe'),x=0,sh=0;
for(i=0;i<f.length;i++){try{var d=f[i].contentDocument;if(d){add(d,'if:');}else{x++;}}catch(e){x++;}}
var all=D.querySelectorAll('*'),n=Math.min(all.length,3000);for(i=0;i<n;i++){if(all[i].shadowRoot)sh++;}
return (location.host||'?')+' | медиа='+o.length+(o.length?' ['+o.join('; ')+']':'')+' | iframe='+f.length+' чужих='+x+' | shadow='+sh;
}catch(e){return 'ошибка '+e;}})()"""
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
        var bg = false         // видео/звук играет в фоне (SiteMediaService), WebView не усыпляется
        var lastDiag = ""       // последний записанный в журнал снимок страницы при «видео не найдено»
        var frameProxy: JavaScriptReplyProxy? = null // кадр (iframe) с роликом: канал команд к нему (FRAME_JS)
        var framePaused = true
        var frameEnded = false
        var frameSec = 0
        var frameSeen = 0L     // когда кадр сообщил состояние последний раз
        var diagAt = 0L        // когда он записан (пробы раз в секунду пишут не чаще раза в DIAG_EVERY_MS)
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
    private var bgTab: Tab? = null               // вкладка с фоновым видео (одна)
    private var bgPausedSince = 0L
    private var bgPausedVisible = false          // пауза началась, пока вкладка была на экране (человек поставил сам) — заново не запускается
    private var bgUserPaused = false             // пауза кнопкой уведомления/острова
    private var bgResumeTries = 0
    private var bgPlayingSince = 0L

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
        startProbe()
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
        if (!t.ready) bgLog("уход с вкладки: страница ещё не готова — фон не проверяется")
        if (!t.ready || t.bg) return
        if (FLOAT_WINDOW) {
            tryFloat(t, v, KIND_LEFT) { if (!t.shown && !t.floating && t.view === v) v.onPause() }
        } else {
            // играет видео/звук — вкладка остаётся живой в фоне (остров), иначе засыпает
            tryBackground(t, v, "уход с вкладки", true) { if (!t.shown && !t.floating && !t.bg && t.view === v) v.onPause() }
        }
    }

    /** Прячет показанную вкладку (страница живёт за краем, позиция сохраняется). */
    fun hide() {
        activity.hideSiteFullscreen()
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
        if (t.bg) endBackground(t, pause = true, sleep = false)
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
            if (t.bg) endBackground(t, pause = true, sleep = false)
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
        if (!FLOAT_WINDOW) {
            // Служба запускается здесь, пока приложение ещё на экране: из onStop система может запуск не разрешить.
            val t = shownTab()
            val v = t?.view
            if (t == null) bgLog("свёрнуто: вкладка-сайт не открыта")
            else if (v == null || !t.ready) bgLog("свёрнуто: страница вкладки не готова (ready=${t.ready})")
            else if (t.bg) bgLog("свёрнуто: фон уже идёт")
            else tryBackground(t, v, "сворачивание", true) { }
            SiteMedia.onAppBackground(activity.applicationContext)
        }
    }

    fun destroy() {
        handler.removeCallbacksAndMessages(null)
        periodicOn = false
        probeOn = false
        floatTab?.floating = false
        floatTab = null
        floatWin?.detach()
        floatWin = null
        handler.removeCallbacks(bgPollTask)
        bgTab?.bg = false
        bgTab = null
        SiteMedia.end(activity.applicationContext)
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
        if (!FLOAT_WINDOW) {
            bgLog("onStop: фон=${t.bg}")
            if (!t.bg) tryBackground(t, v, "onStop", true) { }
            return
        }
        if (!win().canOverlay()) return // без разрешения «Поверх других приложений» окна вне приложения не будет
        tryFloat(t, v, KIND_MIN) { }
    }

    /** Приложение вернулось на экран (onStart): видео, ушедшее в окно при сворачивании, встаёт обратно на свою вкладку. */
    fun onAppVisible() {
        appVisible = true
        startProbe()
        if (bgTab != null) bgLog("приложение на экране: фон идёт")
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

    // ---------- фоновое воспроизведение (остров) ----------

    private val bgListener = object : SiteMedia.Listener {
        override fun onToggle() {
            val v = bgTab?.view ?: return
            v.evaluateJavascript(MEDIA_TOGGLE_JS) { raw ->
                val a = parseNums(raw)
                val t = bgTab
                if (t != null && t.bg && a != null && a.size > 1 && a[0] == 1.0) {
                    val paused = a[1] == 1.0
                    bgPausedSince = if (paused) System.currentTimeMillis() else 0L
                    bgUserPaused = paused
                    bgPausedVisible = false
                    bgResumeTries = 0
                    bgLog(if (paused) "пауза кнопкой уведомления" else "запуск кнопкой уведомления")
                    SiteMedia.update(activity.applicationContext, SiteMedia.title, SiteMedia.sub, !paused)
                } else if (t != null && t.bg && frameHas(t)) {
                    frameSend(t, "toggle")
                    val paused = !t.framePaused
                    t.framePaused = paused
                    bgPausedSince = if (paused) System.currentTimeMillis() else 0L
                    bgUserPaused = paused
                    bgPausedVisible = false
                    bgResumeTries = 0
                    bgLog(if (paused) "пауза кнопкой уведомления (кадр)" else "запуск кнопкой уведомления (кадр)")
                    SiteMedia.update(activity.applicationContext, SiteMedia.title, SiteMedia.sub, !paused)
                }
            }
        }

        override fun onClose() {
            val t = bgTab ?: return
            endBackground(t, pause = true, sleep = true)
        }
    }

    private var probeOn = false

    /**
     * Пока вкладка на экране, раз в 2 с ищет играющий ролик: служба переднего плана должна стартовать, ПОКА приложение видно (из фона
     * система запуск запрещает), — тогда при сворачивании остаётся только перепоставить уведомление (остров).
     */
    private fun startProbe() {
        if (probeOn) return
        probeOn = true
        handler.postDelayed(probeTask, PROBE_MS)
    }

    private val probeTask = object : Runnable {
        override fun run() {
            val t = shownTab()
            if (t == null || !appVisible) {
                probeOn = false
                return
            }
            val v = t.view
            if (v != null && t.ready && !t.bg) tryBackground(t, v) { }
            handler.postDelayed(this, PROBE_MS)
        }
    }

    private fun hostOf(url: String): String = try {
        Uri.parse(url).host?.removePrefix("www.") ?: ""
    } catch (e: Exception) {
        ""
    }

    /**
     * Ищет на странице играющий ролик (MEDIA_JS). Нашёлся — вкладка остаётся живой в фоне и показывается уведомление с островом;
     * нет — вызывается [onNone] (при уходе с вкладки — пауза WebView, как раньше).
     */
    private fun tryBackground(t: Tab, v: WebView, why: String = "", always: Boolean = false, onNone: () -> Unit) {
        if (t.bg) return
        v.evaluateJavascript(MEDIA_JS) { raw ->
            val a = parseNums(raw)
            if ((a == null || a.isEmpty() || a[0] != 1.0) && t.view === v && !t.bg && frameActive(t)) {
                startBackground(t, v) // ролик в iframe: страница его не видит, о нём сообщил скрипт кадра
            } else if (a == null || a.isEmpty() || a[0] != 1.0) {
                if (t.view === v) logMiss(t, v, why, always)
                onNone()
            } else if (t.view === v && !t.bg) {
                startBackground(t, v)
            }
        }
    }

    /**
     * Играющий ролик не найден — в журнал пишется, что на странице есть (DIAG_JS). [always] — при уходе с вкладки и сворачивании
     * (нужен ответ на каждое событие); пробы раз в секунду пишут, только если снимок изменился и прошло DIAG_EVERY_MS.
     */
    private fun logMiss(t: Tab, v: WebView, why: String, always: Boolean) {
        val now = System.currentTimeMillis()
        if (!always && now - t.diagAt < DIAG_EVERY_MS) return
        t.diagAt = now
        v.evaluateJavascript(DIAG_JS) { raw ->
            val s = if (raw.isNullOrEmpty() || raw == "null") "страница не ответила" else raw.trim('"').take(400)
            if (always || s != t.lastDiag) {
                t.lastDiag = s
                bgLog("видео не найдено" + (if (why.isEmpty()) "" else " ($why)") + ": " + s)
            }
        }
    }

    private fun startBackground(t: Tab, v: WebView) {
        SiteMedia.logger = { text -> bgLog(text) }
        val prev = bgTab
        if (prev != null && prev !== t) endBackground(prev, pause = true, sleep = true) // фоновая вкладка одна: прежняя замолкает
        t.bg = true
        bgTab = t
        bgPausedSince = 0L
        bgPausedVisible = false
        bgUserPaused = false
        bgResumeTries = 0
        bgPlayingSince = System.currentTimeMillis()
        bgLog("фон начат: " + hostOf(t.curUrl) + ", экран=" + (t.shown && appVisible))
        v.onResume() // WebView вкладки не должен быть на паузе, пока играет видео
        (v as? SiteWebView)?.keepAwake = true
        try { v.settings.mediaPlaybackRequiresUserGesture = false } catch (e: Exception) { } // повторный запуск после паузы страницы — без жеста
        val title = t.curTitle.ifEmpty { prefs.getString(k(t.id, "title"), "") ?: "" }.ifEmpty { "Видео" }
        SiteMedia.begin(activity.applicationContext, title, hostOf(t.curUrl), bgListener)
        handler.removeCallbacks(bgPollTask)
        handler.postDelayed(bgPollTask, BG_POLL_MS)
    }

    /**
     * Снимает фоновый режим вкладки: уведомление и остров убираются, страница возвращается в обычный режим видимости.
     * [pause] — ролик ставится на паузу; [sleep] — WebView вкладки засыпает (если она не на экране).
     */
    private fun endBackground(t: Tab, pause: Boolean, sleep: Boolean) {
        if (!t.bg) return
        bgLog("фон снят: пауза=$pause, сон=$sleep")
        handler.removeCallbacks(bgPollTask)
        t.bg = false
        if (bgTab === t) bgTab = null
        SiteMedia.end(activity.applicationContext)
        val v = t.view ?: return
        (v as? SiteWebView)?.keepAwake = false
        try { v.settings.mediaPlaybackRequiresUserGesture = true } catch (e: Exception) { }
        if (pause && frameHas(t)) frameSend(t, "pause")
        v.evaluateJavascript(if (pause) MEDIA_PAUSE_JS else MEDIA_RESTORE_JS, null)
        if (sleep && !t.shown) {
            // даём скрипту паузы выполниться, потом усыпляем WebView
            handler.postDelayed({ if (t.view === v && !t.shown && !t.floating && !t.bg) v.onPause() }, 300L)
        }
    }

    /**
     * Страница сама поставила ролик на паузу, пока человек был не на вкладке (сайт среагировал на сворачивание, потеря фокуса и т. п.):
     * ролик запускается заново. Не трогаем: паузу поставил человек (кнопка уведомления или он сам при открытой вкладке), идёт звонок,
     * играет другое приложение/музыка (звуковой фокус потерян не по нашей вине), уже сделано RESUME_MAX_TRIES попыток подряд.
     */
    private fun maybeResume(t: Tab, v: WebView, now: Long) {
        if (bgUserPaused || bgPausedVisible) return
        if (t.shown && appVisible) return
        if (now - bgPausedSince < RESUME_AFTER_MS) return
        if (bgResumeTries >= RESUME_MAX_TRIES) return
        try {
            val am = activity.getSystemService(Context.AUDIO_SERVICE) as AudioManager
            if (am.mode != AudioManager.MODE_NORMAL || am.isMusicActive) return
        } catch (e: Exception) {
            // звуковая служба не ответила — решаем без неё
        }
        bgResumeTries++
        bgPausedSince = now // следующая попытка — не раньше чем через RESUME_AFTER_MS
        bgLog("страница поставила паузу в фоне — запускаю заново, попытка $bgResumeTries")
        v.evaluateJavascript(MEDIA_PLAY_JS, null)
        if (frameHas(t)) frameSend(t, "play")
    }

    /** Строка в панель отладки приложения (видна при галочке «Включить режим отладки»). */
    private fun bgLog(text: String) {
        activity.debugLog("bg", text)
    }

    /** Раз в секунду смотрит на ролик: пауза/«играет» и название — в уведомление; закончился или пропал — фоновый режим снимается. */
    private val bgPollTask = object : Runnable {
        override fun run() {
            val t = bgTab
            val v = t?.view
            if (t == null || v == null || !t.bg) return
            v.evaluateJavascript(MEDIA_STATE_JS) { raw ->
                if (bgTab === t && t.bg) {
                    val arr = try { if (raw.isNullOrEmpty() || raw == "null") null else JSONArray(raw) } catch (e: Exception) { null }
                    if ((arr == null || arr.optInt(0) != 1) && frameHas(t)) {
                        pollFrame(t, v, this)
                    } else if (arr == null || arr.optInt(0) != 1) {
                        // ролик пропал (сайт мог подставить следующий) — ищем играющий заново
                        v.evaluateJavascript(MEDIA_JS) { raw2 ->
                            val a = parseNums(raw2)
                            if (bgTab === t && t.bg) {
                                if (a != null && a.isNotEmpty() && a[0] == 1.0) {
                                    handler.postDelayed(this, BG_POLL_MS)
                                } else {
                                    endBackground(t, pause = false, sleep = true)
                                }
                            }
                        }
                    } else if (arr.optInt(2) == 1) {
                        endBackground(t, pause = false, sleep = true) // ролик закончился
                    } else {
                        val paused = arr.optInt(1) == 1
                        val now = System.currentTimeMillis()
                        val playErr = arr.optString(6, "")
                        if (playErr.isNotEmpty()) bgLog("play() отклонён: $playErr")
                        if (paused) {
                            if (bgPausedSince == 0L) {
                                bgPausedSince = now
                                // пауза, начатая при открытой вкладке, — дело рук человека: заново не запускается
                                bgPausedVisible = t.shown && appVisible
                                bgLog("страница на паузе, экран=$bgPausedVisible, сек=${arr.optInt(4)}, ready=${arr.optInt(5)}")
                            }
                            maybeResume(t, v, now)
                        } else {
                            if (bgPausedSince != 0L) bgPlayingSince = now
                            bgPausedSince = 0L
                            bgUserPaused = false
                            if (now - bgPlayingSince > RESUME_STABLE_MS) bgResumeTries = 0
                        }
                        if (paused && now - bgPausedSince > BG_PAUSED_MAX_MS) {
                            endBackground(t, pause = false, sleep = true) // долго на паузе в фоне — вкладка засыпает
                        } else {
                            val title = arr.optString(3, "").ifEmpty { t.curTitle }.ifEmpty { "Видео" }
                            SiteMedia.update(activity.applicationContext, title, hostOf(t.curUrl), !paused)
                            handler.postDelayed(this, BG_POLL_MS)
                        }
                    }
                }
            }
        }
    }

    // ---------- ролик в iframe (чужое происхождение): сообщения скрипта FRAME_JS ----------

    private fun installFrameHook(v: WebView, t: Tab) {
        try {
            if (!WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT) ||
                !WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)
            ) {
                bgLog("кадры: этот WebView не умеет скрипты для iframe")
                return
            }
            WebViewCompat.addWebMessageListener(v, "ltFrameBridge", setOf("*"), object : WebViewCompat.WebMessageListener {
                override fun onPostMessage(view: WebView, message: WebMessageCompat, sourceOrigin: Uri, isMainFrame: Boolean, replyProxy: JavaScriptReplyProxy) {
                    onFrameMessage(t, v, message.data, isMainFrame, replyProxy)
                }
            })
            WebViewCompat.addDocumentStartJavaScript(v, FRAME_JS, setOf("*"))
        } catch (e: Throwable) {
            bgLog("кадры: не удалось поставить скрипт (" + e.javaClass.simpleName + ")")
        }
    }

    private fun onFrameMessage(t: Tab, v: WebView, data: String?, isMainFrame: Boolean, reply: JavaScriptReplyProxy) {
        if (isMainFrame || data == null || t.view !== v) return
        val now = System.currentTimeMillis()
        if (data.startsWith("e|")) {
            bgLog("кадр: play() отклонён: " + data.substring(2).take(60))
            return
        }
        if (data == "n") {
            if (t.frameProxy === reply) t.frameProxy = null
            return
        }
        val p = data.split("|")
        if (p.size < 5 || p[0] != "m") return
        val paused = p[1] == "1"
        // молчащий кадр (реклама, второй плеер) не вытесняет играющий
        if (t.frameProxy != null && t.frameProxy !== reply && frameActive(t) && paused) return
        if (t.frameProxy !== reply) bgLog("кадр: ролик в iframe, пауза=$paused, сек=${p[3]}, ready=${p[4]}")
        t.frameProxy = reply
        t.framePaused = paused
        t.frameEnded = p[2] == "1"
        t.frameSec = p[3].toIntOrNull() ?: 0
        t.frameSeen = now
    }

    /** Кадр сообщил, что ролик играет (и сообщение свежее). */
    private fun frameActive(t: Tab): Boolean =
        t.frameProxy != null && !t.framePaused && !t.frameEnded && System.currentTimeMillis() - t.frameSeen < FRAME_FRESH_MS

    /** Кадр с роликом известен: играет (свежо) или стоит на паузе. */
    private fun frameHas(t: Tab): Boolean =
        t.frameProxy != null && (t.framePaused || t.frameEnded || System.currentTimeMillis() - t.frameSeen < FRAME_FRESH_MS)

    private fun frameSend(t: Tab, cmd: String) {
        try { t.frameProxy?.postMessage(cmd) } catch (e: Throwable) { bgLog("кадр: команда $cmd не дошла (" + e.javaClass.simpleName + ")") }
    }

    /** Опрос ролика в iframe: то же, что для ролика в самой странице (пауза, повторный запуск, закончился), состояние берётся из сообщений кадра. */
    private fun pollFrame(t: Tab, v: WebView, task: Runnable) {
        if (bgTab !== t || !t.bg) return
        if (t.frameEnded) {
            endBackground(t, pause = false, sleep = true)
            return
        }
        val now = System.currentTimeMillis()
        val paused = t.framePaused || now - t.frameSeen >= FRAME_FRESH_MS
        if (paused) {
            if (bgPausedSince == 0L) {
                bgPausedSince = now
                bgPausedVisible = t.shown && appVisible
                bgLog("кадр на паузе, экран=$bgPausedVisible, сек=${t.frameSec}")
            }
            maybeResume(t, v, now)
        } else {
            if (bgPausedSince != 0L) bgPlayingSince = now
            bgPausedSince = 0L
            bgUserPaused = false
            if (now - bgPlayingSince > RESUME_STABLE_MS) bgResumeTries = 0
        }
        if (paused && now - bgPausedSince > BG_PAUSED_MAX_MS) {
            endBackground(t, pause = false, sleep = true)
        } else {
            SiteMedia.update(activity.applicationContext, t.curTitle.ifEmpty { "Видео" }, hostOf(t.curUrl), !paused)
            handler.postDelayed(task, BG_POLL_MS)
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
            if (t === except || t.shown || t.floating || t.bg || t.view == null) continue
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

        installFrameHook(v, t)

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
                if (view != null && t.view === view) {
                    t.failed = false
                    t.frameProxy = null
                }
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
                    activity.hideSiteFullscreen()
                    if (t.bg) endBackground(t, pause = false, sleep = false)
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

            // Кнопка «во весь экран» у плеера сайта: без этих двух методов WebView её нажатие молча игнорирует.
            override fun onShowCustomView(view: View?, callback: CustomViewCallback?) {
                if (view == null) {
                    callback?.onCustomViewHidden()
                    return
                }
                if (callback == null) return
                activity.showSiteFullscreen(view, callback)
            }

            override fun onHideCustomView() {
                activity.hideSiteFullscreen()
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
        if (t.shown) reveal(t) else if (!t.bg) v.onPause()
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
