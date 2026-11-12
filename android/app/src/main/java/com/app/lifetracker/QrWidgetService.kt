package com.app.lifetracker
// Версия: 1.2 (12.11)

import android.appwidget.AppWidgetManager
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.os.SystemClock
import android.widget.RemoteViews
import android.widget.RemoteViewsService

/** Поставщик карточек для StackView виджета «Стопка QR-карточек»: по одной картинке-лицу на карточку, нажатие несёт код QR и ключ (id) карточки. */
class QrWidgetService : RemoteViewsService() {

    override fun onGetViewFactory(intent: Intent): RemoteViewsFactory =
        Factory(applicationContext, intent.getIntExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, AppWidgetManager.INVALID_APPWIDGET_ID))

    private class Factory(private val ctx: Context, private val widgetId: Int) : RemoteViewsFactory {

        private var cards: List<QrWidgets.Card> = emptyList()
        private val bitmaps = HashMap<String, Bitmap>()

        // Первые обращения после загрузки данных — не смахивание: точки показываем только после этой паузы.
        @Volatile private var quietUntil = 0L

        override fun onCreate() {
            quietUntil = SystemClock.uptimeMillis() + QUIET_MS
        }

        override fun onDataSetChanged() {
            val cfg = QrWidgets.cfgFor(ctx, widgetId)
            cards = if (cfg == null) emptyList() else QrWidgets.order(ctx, cfg).cards
            bitmaps.clear()
            quietUntil = SystemClock.uptimeMillis() + QUIET_MS
        }

        override fun onDestroy() {
            bitmaps.clear()
        }

        override fun getCount(): Int = cards.size

        override fun getViewAt(position: Int): RemoteViews? {
            val c = cards.getOrNull(position) ?: return null
            val rv = RemoteViews(ctx.packageName, R.layout.qr_widget_item)
            val bmp = bitmaps.getOrPut(c.key) { QrWidgets.bitmapFor(ctx, c) }
            rv.setImageViewBitmap(R.id.qr_card_img, bmp)
            // карточка заряда — не QR-карточка: нажатие на неё ничего не делает (без fill-in intent шаблон не срабатывает)
            if (c.key != QrBattery.KEY) rv.setOnClickFillInIntent(R.id.qr_card_img, Intent().putExtra("code", c.code).putExtra("key", c.key))
            if (cards.size > 1 && SystemClock.uptimeMillis() > quietUntil) QrWidgets.onPossibleSwipe(ctx, widgetId, cards.size)
            return rv
        }

        override fun getLoadingView(): RemoteViews? = null
        override fun getViewTypeCount(): Int = 1
        override fun getItemId(position: Int): Long = (cards.getOrNull(position)?.key?.hashCode() ?: position).toLong()
        override fun hasStableIds(): Boolean = true

        companion object {
            private const val QUIET_MS = 2500L
        }
    }
}
