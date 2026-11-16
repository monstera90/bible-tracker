package com.app.lifetracker
// Версия: 2.1 (16.11) — hotkeyForwarder: Ctrl+стрелки / Ctrl+1…9 / Ctrl+F с физической клавиатуры из WebView сайта уходят странице приложения. Откат: SelectionMenuWebView.kt 2.0.

import android.content.Context
import android.graphics.Rect
import android.os.Build
import android.view.ActionMode
import android.view.Menu
import android.view.MenuInflater
import android.view.KeyEvent
import android.view.MotionEvent
import android.view.View
import android.widget.PopupMenu
import android.webkit.WebView

/**
 * WebView без системного меню выделения текста («Копировать / Поделиться / Выбрать все / Веб-поиск»).
 * Ручки выделения и подсветка остаются; копирование делает своя кнопка в нижнем ряду страницы.
 *
 * Android 6+ (плавающая панель): настоящий ActionMode запускается, но его меню всегда очищается — панель не
 * рисуется. «Копировать / Вставить / Вырезать / Переслать» и история фрагментов — своё круговое меню страницы
 * (ctxmenu.js); «Вставить» читает буфер через мост (`pasteText`).
 * Android 5 (панель сверху вместо плавающей): возвращаем «пустой» ActionMode без интерфейса. Возвращать null
 * нельзя — Chromium в этом случае сразу снимает выделение.
 *
 * У WebView чужих страниц (вкладки-сайты, «Claude») меню рисует не страница, а [SiteSelectionMenu]: он подписывается через
 * [selectionListener] и получает прямоугольник выделения (`onGetContentRect`; на Android 5 — окрестность последнего касания),
 * касания и прокрутку. У главного WebView слушателя нет.
 */
open class SelectionMenuWebView(context: Context) : WebView(context) {

    interface SelectionListener {
        /** Выделение появилось или сдвинулось; [rect] — в координатах этого вида (px). */
        fun onSelectionRect(view: WebView, rect: Rect)

        /** Выделение снято (режим действий закрыт). */
        fun onSelectionEnd(view: WebView)

        /** Новое касание вида. */
        fun onTouchDown(view: WebView)

        /** Палец поднят (или касание отменено). */
        fun onTouchUp(view: WebView)

        /** Страница прокручена. */
        fun onScroll(view: WebView)
    }

    var selectionListener: SelectionListener? = null

    /**
     * Горячие клавиши приложения (Ctrl+стрелки, Ctrl+1…9, Ctrl+F) с физической клавиатуры. Пока фокус в WebView сайта, страница приложения этих нажатий не получает —
     * без этого язычки нижнего ряда на вкладках-сайтах клавишами не переключались. Сайт нажатие получает как раньше; комбинация уходит приложению, только если
     * на сайте курсор не в поле ввода (там Ctrl+стрелки — переход по словам). У главного WebView слушателя нет — у него страница видит клавиши сама.
     */
    var hotkeyForwarder: ((String) -> Unit)? = null

    private fun hotkeyComboOf(ev: KeyEvent): String? {
        if (!ev.isCtrlPressed || ev.isAltPressed || ev.isMetaPressed) return null
        val key = when (ev.keyCode) {
            KeyEvent.KEYCODE_DPAD_LEFT -> "arrowleft"
            KeyEvent.KEYCODE_DPAD_RIGHT -> "arrowright"
            KeyEvent.KEYCODE_DPAD_UP -> "arrowup"
            KeyEvent.KEYCODE_DPAD_DOWN -> "arrowdown"
            KeyEvent.KEYCODE_F -> "f"
            in KeyEvent.KEYCODE_1..KeyEvent.KEYCODE_9 -> (ev.keyCode - KeyEvent.KEYCODE_0).toString()
            else -> return null
        }
        return (if (ev.isShiftPressed) "ctrl+shift+" else "ctrl+") + key
    }

    override fun dispatchKeyEvent(event: KeyEvent): Boolean {
        val fwd = hotkeyForwarder
        if (fwd != null && event.action == KeyEvent.ACTION_DOWN && event.repeatCount == 0) {
            val combo = hotkeyComboOf(event)
            if (combo != null) {
                // сначала смотрим, не в поле ли ввода курсор на сайте; ответ приходит позже, сайт при этом нажатие уже получил
                evaluateJavascript(
                    "(function(){var e=document.activeElement;return !!(e&&(e.isContentEditable||/^(INPUT|TEXTAREA|SELECT)\$/.test(e.tagName)));})()"
                ) { raw -> if (raw != "true") fwd(combo) }
            }
        }
        return super.dispatchKeyEvent(event)
    }
    private var lastX = 0
    private var lastY = 0

    override fun dispatchTouchEvent(ev: MotionEvent): Boolean {
        val a = ev.actionMasked
        if (a == MotionEvent.ACTION_DOWN || a == MotionEvent.ACTION_UP) {
            lastX = ev.x.toInt()
            lastY = ev.y.toInt()
        }
        if (a == MotionEvent.ACTION_DOWN) selectionListener?.onTouchDown(this)
        val handled = super.dispatchTouchEvent(ev)
        if (a == MotionEvent.ACTION_UP || a == MotionEvent.ACTION_CANCEL) selectionListener?.onTouchUp(this)
        return handled
    }

    override fun onScrollChanged(l: Int, t: Int, oldl: Int, oldt: Int) {
        super.onScrollChanged(l, t, oldl, oldt)
        selectionListener?.onScroll(this)
    }

    /** Android 5 не сообщает границ выделения — берём окрестность последнего касания. */
    private fun touchRect(): Rect {
        val pad = (12 * resources.displayMetrics.density).toInt()
        return Rect(lastX - pad, lastY - pad, lastX + pad, lastY + pad)
    }

    private fun noUiMode(callback: ActionMode.Callback): ActionMode {
        selectionListener?.onSelectionRect(this, touchRect())
        return NoUiActionMode(context, callback) { selectionListener?.onSelectionEnd(this) }
    }

    override fun startActionMode(callback: ActionMode.Callback?): ActionMode? {
        if (callback == null) return super.startActionMode(callback)
        return noUiMode(callback)
    }

    override fun startActionMode(callback: ActionMode.Callback?, type: Int): ActionMode? {
        if (callback == null) return super.startActionMode(callback, type)
        if (Build.VERSION.SDK_INT >= 23 && type == ActionMode.TYPE_FLOATING) {
            return super.startActionMode(HidingCallback(callback), type)
        }
        return noUiMode(callback)
    }

    private inner class HidingCallback(private val d: ActionMode.Callback) : ActionMode.Callback2() {

        override fun onCreateActionMode(mode: ActionMode, menu: Menu): Boolean {
            val r = d.onCreateActionMode(mode, menu)
            menu.clear()
            // запасное место круга, пока система не прислала границы выделения (onGetContentRect перебьёт его)
            selectionListener?.onSelectionRect(this@SelectionMenuWebView, touchRect())
            return r
        }

        override fun onPrepareActionMode(mode: ActionMode, menu: Menu): Boolean {
            val r = d.onPrepareActionMode(mode, menu)
            menu.clear()
            return r
        }

        override fun onActionItemClicked(mode: ActionMode, item: android.view.MenuItem): Boolean =
            d.onActionItemClicked(mode, item)

        override fun onDestroyActionMode(mode: ActionMode) {
            d.onDestroyActionMode(mode)
            selectionListener?.onSelectionEnd(this@SelectionMenuWebView)
        }

        override fun onGetContentRect(mode: ActionMode, view: View, outRect: Rect) {
            val cb = d
            if (cb is ActionMode.Callback2) cb.onGetContentRect(mode, view, outRect)
            else super.onGetContentRect(mode, view, outRect)
            selectionListener?.onSelectionRect(this@SelectionMenuWebView, Rect(outRect))
        }
    }

    /** ActionMode без интерфейса: Chromium считает выделение «с меню», на экране ничего не появляется. */
    private class NoUiActionMode(
        private val ctx: Context,
        private val cb: ActionMode.Callback,
        private val onFinish: () -> Unit
    ) : ActionMode() {
        private var finished = false
        private val menuObj: Menu by lazy { PopupMenu(ctx, View(ctx)).menu }

        override fun setTitle(title: CharSequence?) {}
        override fun setTitle(resId: Int) {}
        override fun setSubtitle(subtitle: CharSequence?) {}
        override fun setSubtitle(resId: Int) {}
        override fun setCustomView(view: View?) {}
        override fun invalidate() {}
        override fun finish() {
            if (finished) return
            finished = true
            cb.onDestroyActionMode(this)
            onFinish()
        }
        override fun getMenu(): Menu = menuObj
        override fun getTitle(): CharSequence? = null
        override fun getSubtitle(): CharSequence? = null
        override fun getCustomView(): View? = null
        override fun getMenuInflater(): MenuInflater = MenuInflater(ctx)
    }
}
