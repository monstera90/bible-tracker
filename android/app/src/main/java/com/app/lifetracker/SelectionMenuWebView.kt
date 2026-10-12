package com.app.lifetracker

import android.content.Context
import android.graphics.Rect
import android.os.Build
import android.view.ActionMode
import android.view.Menu
import android.view.MenuInflater
import android.view.View
import android.widget.PopupMenu
import android.webkit.WebView

/**
 * WebView без системного меню выделения текста («Копировать / Поделиться / Выбрать все / Веб-поиск»).
 * Ручки выделения и подсветка остаются; копирование делает своя кнопка в нижнем ряду страницы.
 *
 * Android 6+ (плавающая панель): настоящий ActionMode запускается, но его меню очищается, если в нём есть
 * «Копировать» — тогда панель не рисуется. Меню вставки у курсора (без «Копировать») не трогаем: «Вставить»
 * в полях ввода остаётся.
 * Android 5 (панель сверху вместо плавающей): возвращаем «пустой» ActionMode без интерфейса. Возвращать null
 * нельзя — Chromium в этом случае сразу снимает выделение.
 */
class SelectionMenuWebView(context: Context) : WebView(context) {

    override fun startActionMode(callback: ActionMode.Callback?): ActionMode? {
        if (callback == null) return super.startActionMode(callback)
        return NoUiActionMode(context, callback)
    }

    override fun startActionMode(callback: ActionMode.Callback?, type: Int): ActionMode? {
        if (callback == null) return super.startActionMode(callback, type)
        if (Build.VERSION.SDK_INT >= 23 && type == ActionMode.TYPE_FLOATING) {
            return super.startActionMode(HidingCallback(context, callback), type)
        }
        return NoUiActionMode(context, callback)
    }

    private class HidingCallback(ctx: Context, private val d: ActionMode.Callback) : ActionMode.Callback2() {
        // Chromium (WebView 2023+) добавляет пункты со СВОИМИ id, а не android.R.id.copy, поэтому «Копировать»
        // ищем и по id, и по системному названию пункта (на языке устройства), и по имени id ресурса.
        private val copyTitle: String = try { ctx.getString(android.R.string.copy) } catch (e: Exception) { "" }
        private val res = ctx.resources

        private fun isCopy(item: android.view.MenuItem): Boolean {
            if (item.itemId == android.R.id.copy) return true
            val title = item.title?.toString()?.trim().orEmpty()
            if (copyTitle.isNotEmpty() && title.equals(copyTitle, ignoreCase = true)) return true
            return try {
                res.getResourceEntryName(item.itemId).contains("copy", ignoreCase = true)
            } catch (e: Exception) {
                false
            }
        }

        private fun hasCopy(menu: Menu?): Boolean {
            if (menu == null) return false
            for (i in 0 until menu.size()) if (isCopy(menu.getItem(i))) return true
            return false
        }

        override fun onCreateActionMode(mode: ActionMode, menu: Menu): Boolean {
            val r = d.onCreateActionMode(mode, menu)
            if (hasCopy(menu)) menu.clear()
            return r
        }

        override fun onPrepareActionMode(mode: ActionMode, menu: Menu): Boolean {
            val r = d.onPrepareActionMode(mode, menu)
            if (hasCopy(menu)) menu.clear()
            return r
        }

        override fun onActionItemClicked(mode: ActionMode, item: android.view.MenuItem): Boolean =
            d.onActionItemClicked(mode, item)

        override fun onDestroyActionMode(mode: ActionMode) = d.onDestroyActionMode(mode)

        override fun onGetContentRect(mode: ActionMode, view: View, outRect: Rect) {
            val cb = d
            if (cb is ActionMode.Callback2) cb.onGetContentRect(mode, view, outRect)
            else super.onGetContentRect(mode, view, outRect)
        }
    }

    /** ActionMode без интерфейса: Chromium считает выделение «с меню», на экране ничего не появляется. */
    private class NoUiActionMode(private val ctx: Context, private val cb: ActionMode.Callback) : ActionMode() {
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
        }
        override fun getMenu(): Menu = menuObj
        override fun getTitle(): CharSequence? = null
        override fun getSubtitle(): CharSequence? = null
        override fun getCustomView(): View? = null
        override fun getMenuInflater(): MenuInflater = MenuInflater(ctx)
    }
}
