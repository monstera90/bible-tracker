package com.app.lifetracker
// Версия: 2.4 (14.11)

import android.appwidget.AppWidgetManager
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.os.SystemClock
import android.view.View
import android.widget.RemoteViews
import android.widget.RemoteViewsService

/**
 * Поставщик карточек для StackView виджета «Стопка QR-карточек»: по одной картинке-лицу на карточку, нажатие несёт код QR и ключ (id) карточки.
 *
 * ⚠️ Смахивание стопки фабрике не видно: система кэширует загруженные карточки (лимит кэша RemoteViews ≈ 2 МБ, а лицо — ≈ 1 МБ) и
 * `getViewAt` зовёт только для новых позиций. Поэтому счётчик отдаётся в [VIRT] раз больше числа карточек (позиция % число): окно
 * кэша сдвигается, и фабрику зовут при каждом смахивании (`QrWidgets.onPossibleSwipe` — точки справа и возврат наверх).
 * Пока система подгружает карточку, стопка показывает заглушку (`getLoadingView`), а не пустое место: все картинки готовятся заранее,
 * в `onDataSetChanged`, и `getViewAt` их только отдаёт.
 */
class QrWidgetService : RemoteViewsService() {

    override fun onGetViewFactory(intent: Intent): RemoteViewsFactory =
        Factory(applicationContext, intent.getIntExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, AppWidgetManager.INVALID_APPWIDGET_ID))

    private class Factory(private val ctx: Context, private val widgetId: Int) : RemoteViewsFactory {

        private var cards: List<QrWidgets.Card> = emptyList()
        private var bitmaps: Map<String, Bitmap> = emptyMap()

        // Первые обращения после загрузки данных — не смахивание: точки показываем только после этой паузы.
        @Volatile private var quietUntil = 0L

        override fun onCreate() {
            quietUntil = SystemClock.uptimeMillis() + QUIET_MS
        }

        override fun onDataSetChanged() {
            try {
                val cfg = QrWidgets.cfgFor(ctx, widgetId)
                val list = if (cfg == null) emptyList() else QrWidgets.order(ctx, cfg).cards
                val fresh = HashMap<String, Bitmap>()
                for (c in list) fresh[c.key] = QrWidgets.bitmapFor(ctx, c)
                cards = list
                bitmaps = fresh
            } catch (e: Throwable) {
                // не хватило памяти или сбой данных — остаются прежние карточки
            }
            quietUntil = SystemClock.uptimeMillis() + QUIET_MS
        }

        override fun onDestroy() {
            bitmaps = emptyMap()
        }

        override fun getCount(): Int = if (cards.size >= 2) cards.size * VIRT else cards.size

        override fun getViewAt(position: Int): RemoteViews {
            val rv = RemoteViews(ctx.packageName, R.layout.qr_widget_item)
            val n = cards.size
            if (n == 0) {
                rv.setImageViewBitmap(R.id.qr_card_img, QrWidgets.skeletonBitmap())
                return rv
            }
            val c = cards[((position % n) + n) % n]
            val bmp = bitmaps[c.key] ?: QrWidgets.bitmapFor(ctx, c)
            rv.setImageViewBitmap(R.id.qr_card_img, bmp)
            // «Как тренировка?»: поверх картинки — десять прозрачных зон-кнопок 1…10, у каждой своё число в fill-in intent (ScanActivity ловит его без окна);
            // у остальных карточек зоны скрыты (видимость задаётся всегда: элемент списка может быть переиспользован)
            val isRpe = c.key == QrRpe.KEY
            rv.setViewVisibility(R.id.rpe_grid, if (isRpe) View.VISIBLE else View.GONE)
            if (isRpe) for (i in RPE_BUTTONS.indices) rv.setOnClickFillInIntent(RPE_BUTTONS[i], Intent().putExtra("rpe", i + 1))
            // карточки заряда и событий — не QR-карточки: нажатие на них ничего не делает; у задач — своё (ниже) (без fill-in intent шаблон не срабатывает)
            if (!isRpe && !QrBattery.isBatteryKey(c.key) && c.dyn.isEmpty()) rv.setOnClickFillInIntent(R.id.qr_card_img, Intent().putExtra("code", if (c.alarmId.isNotEmpty()) "alarmmark:" + c.key else c.code).putExtra("key", c.key).putExtra("habit", c.habit)) // будильник: страница заводит/выключает его молча (`alarmmark:<id>`), полноэкранной карточки нет
            // карточка задачи: двойное нажатие отмечает задачу выполненной (одно — ничего; ждёт окно ScanActivity)
            if (c.dyn == "task" && c.tid.isNotEmpty()) rv.setOnClickFillInIntent(R.id.qr_card_img, Intent().putExtra("task", c.tid))
            if (n > 1 && SystemClock.uptimeMillis() > quietUntil) QrWidgets.onPossibleSwipe(ctx, widgetId, n)
            return rv
        }

        override fun getLoadingView(): RemoteViews? {
            val rv = RemoteViews(ctx.packageName, R.layout.qr_widget_item)
            rv.setImageViewBitmap(R.id.qr_card_img, QrWidgets.skeletonBitmap())
            return rv
        }

        override fun getViewTypeCount(): Int = 1
        override fun getItemId(position: Int): Long = position.toLong()
        override fun hasStableIds(): Boolean = false

        companion object {
            private const val QUIET_MS = 4000L

            /** Зоны кнопок 1…10 карточки «Как тренировка?» (layout/qr_widget_item.xml). */
            private val RPE_BUTTONS = intArrayOf(
                R.id.rpe_b1, R.id.rpe_b2, R.id.rpe_b3, R.id.rpe_b4, R.id.rpe_b5,
                R.id.rpe_b6, R.id.rpe_b7, R.id.rpe_b8, R.id.rpe_b9, R.id.rpe_b10
            )

            /** Во сколько раз счётчик больше числа карточек (при двух и больше): позиции «по кругу», карточка = позиция % число. */
            private const val VIRT = 12
        }
    }
}
