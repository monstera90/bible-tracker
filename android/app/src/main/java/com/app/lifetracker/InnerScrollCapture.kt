package com.app.lifetracker
// Версия: 1.0 (17.11) — длинный скриншот («Прокрутка» в системной плашке снимка экрана): главный WebView стал целью системной прокрутки снимка. Страница приложения — окно на всю высоту (position:fixed), а прокручивается внутренний блок #settingsTabContent, поэтому у самого WebView нечего прокручивать и система считала его непрокручиваемым (кнопка «Прокрутка» была неактивна). Теперь WebView сам сообщает системе область этого блока, двигает его через JS и отдаёт кадры. Android 12+ (API 31); на старых — ничего не делает. Откат: удалить файл и строку InnerScrollCapture.install в MainActivity.

import android.graphics.Rect
import android.os.Build
import android.os.CancellationSignal
import android.util.Log
import android.view.ScrollCaptureCallback
import android.view.ScrollCaptureSession
import android.view.View
import android.webkit.WebView
import androidx.annotation.RequiresApi
import java.util.function.Consumer

/**
 * Подключает к главному WebView обработчик «прокрутки снимка экрана». Прокручиваемая область — внутренний блок страницы
 * (#settingsTabContent; если он не прокручивается — сам документ), её границы и положение берутся из страницы через evaluateJavascript.
 * Страница возвращается в исходное положение, когда снимок закончен.
 */
object InnerScrollCapture {
    private const val TAG = "ScrollCapture"

    fun install(web: WebView) {
        if (Build.VERSION.SDK_INT < 31) return
        try {
            web.setScrollCaptureHint(View.SCROLL_CAPTURE_HINT_INCLUDE)
            web.setScrollCaptureCallback(Callback(web))
        } catch (e: Throwable) {
            Log.e(TAG, "install: " + e)
        }
    }

    /** Находит прокручиваемый элемент страницы: внутренний блок вкладки или документ; нет такого — пустая строка. */
    private const val FIND =
        "var e=document.getElementById('settingsTabContent');" +
        "if(!e||e.scrollHeight<=e.clientHeight+2){e=document.scrollingElement;if(e&&e.scrollHeight<=e.clientHeight+2)e=null;}" +
        "if(!e)return '';"

    @RequiresApi(31)
    private class Callback(private val web: WebView) : ScrollCaptureCallback {
        /** Область прокрутки в координатах WebView (px). */
        private var bounds = Rect()
        /** Положение прокрутки блока в начале снимка (css px): все запросы системы отсчитываются от него. */
        private var startTop = 0.0

        private fun density(): Float = web.resources.displayMetrics.density

        private fun js(code: String, done: (String) -> Unit) {
            try {
                web.evaluateJavascript("(function(){" + FIND + code + "})()") { raw ->
                    val s = if (raw == null || raw == "null") "" else raw.trim().removeSurrounding("\"")
                    done(s)
                }
            } catch (e: Throwable) {
                Log.e(TAG, "js: " + e)
                done("")
            }
        }

        override fun onScrollCaptureSearch(signal: CancellationSignal, onReady: Consumer<Rect>) {
            js(
                "var r=(e===document.scrollingElement)?{left:0,top:0,right:innerWidth,bottom:innerHeight}:e.getBoundingClientRect();" +
                    "return [r.left,r.top,r.right,r.bottom].join(',');"
            ) { s ->
                val d = density()
                val p = s.split(',').mapNotNull { it.toDoubleOrNull() }
                if (p.size != 4 || web.width <= 0 || web.height <= 0) {
                    onReady.accept(Rect()) // прокручивать нечего
                } else {
                    val r = Rect((p[0] * d).toInt(), (p[1] * d).toInt(), (p[2] * d).toInt(), (p[3] * d).toInt())
                    if (!r.intersect(0, 0, web.width, web.height) || r.width() < 8 || r.height() < 8) r.setEmpty()
                    bounds = Rect(r)
                    onReady.accept(r)
                }
            }
        }

        override fun onScrollCaptureStart(session: ScrollCaptureSession, signal: CancellationSignal, onReady: Runnable) {
            js("return String(e.scrollTop);") { s ->
                startTop = s.toDoubleOrNull() ?: 0.0
                onReady.run()
            }
        }

        override fun onScrollCaptureImageRequest(session: ScrollCaptureSession, signal: CancellationSignal, captureArea: Rect, onComplete: Consumer<Rect>) {
            val d = density()
            val want = startTop + captureArea.top / d // верх запрошенной области — к верху блока (браузер сам обрежет по краям)
            js("e.scrollTop=" + want + ";return String(e.scrollTop);") { s ->
                val actual = s.toDoubleOrNull()
                if (actual == null || signal.isCanceled) {
                    onComplete.accept(Rect())
                } else {
                    // сдвиг блока относительно начала снимка (px): в окне сейчас область [delta, delta + высота блока] в координатах запроса
                    val delta = Math.round((actual - startTop) * d).toInt()
                    val avail = Rect(captureArea)
                    if (!avail.intersect(0, delta, bounds.width(), delta + bounds.height())) {
                        onComplete.accept(Rect()) // край страницы: больше ничего нет
                    } else {
                        // даём странице дорисовать кадр после прокрутки
                        web.postDelayed({ draw(session, avail, delta, onComplete) }, 150L)
                    }
                }
            }
        }

        private fun draw(session: ScrollCaptureSession, avail: Rect, delta: Int, onComplete: Consumer<Rect>) {
            var ok = false
            try {
                val canvas = session.surface.lockHardwareCanvas()
                try {
                    canvas.clipRect(0, 0, avail.width(), avail.height())
                    // левый верхний угол буфера — левый верхний угол доступной области; в координатах WebView она лежит в (x, y)
                    canvas.translate(-(bounds.left + avail.left).toFloat(), -(bounds.top + avail.top - delta).toFloat())
                    web.draw(canvas)
                    ok = true
                } finally {
                    session.surface.unlockCanvasAndPost(canvas)
                }
            } catch (e: Throwable) {
                Log.e(TAG, "draw: " + e)
            }
            onComplete.accept(if (ok) avail else Rect())
        }

        override fun onScrollCaptureEnd(onReady: Runnable) {
            js("e.scrollTop=" + startTop + ";return '';") { onReady.run() }
        }
    }
}
