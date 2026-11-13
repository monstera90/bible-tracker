package com.app.lifetracker
// Версия: 2.3 (13.11)

import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.Context
import android.content.Intent
import android.os.Bundle

/** Виджет «Стопка QR-карточек» 2×2. Всё содержимое и логика — в [QrWidgets]. */
class QrWidgetProvider : AppWidgetProvider() {

    override fun onUpdate(context: Context, appWidgetManager: AppWidgetManager, appWidgetIds: IntArray) {
        for (id in appWidgetIds) {
            try {
                QrWidgets.update(context, appWidgetManager, id)
            } catch (e: Exception) {
                // не получилось собрать один виджет — остальные обновятся
            }
        }
        QrWidgets.refreshAll(context)
    }

    override fun onAppWidgetOptionsChanged(context: Context, appWidgetManager: AppWidgetManager, appWidgetId: Int, newOptions: Bundle) {
        try {
            QrWidgets.updateHostLayout(context, appWidgetManager, appWidgetId)
        } catch (e: Exception) {
            // виджет удалили или лаунчер не принял обновление
        }
        super.onAppWidgetOptionsChanged(context, appWidgetManager, appWidgetId, newOptions)
    }

    override fun onDeleted(context: Context, appWidgetIds: IntArray) {
        QrWidgets.forget(context, appWidgetIds)
    }

    override fun onReceive(context: Context, intent: Intent) {
        when (intent.action) {
            QrWidgets.ACTION_ROTATE -> {
                val id = intent.getIntExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, AppWidgetManager.INVALID_APPWIDGET_ID)
                if (id != AppWidgetManager.INVALID_APPWIDGET_ID) QrWidgets.rotate(context, id)
            }
            QrWidgets.ACTION_RETURN -> {
                val id = intent.getIntExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, AppWidgetManager.INVALID_APPWIDGET_ID)
                if (id != AppWidgetManager.INVALID_APPWIDGET_ID) QrWidgets.fireReturn(context, id)
            }
            QrWidgets.ACTION_TICK -> QrWidgets.refreshAll(context)
            QrWidgets.ACTION_BATTERY -> QrWidgets.onBatteryTick(context)
            QrWidgets.ACTION_BT_BURST -> QrWidgets.onBtBurst(
                context,
                intent.getIntExtra(QrWidgets.EXTRA_STEP, 0),
                intent.getLongExtra(QrWidgets.EXTRA_SINCE, 0L),
                intent.getBooleanExtra(QrWidgets.EXTRA_CONNECTED, true)
            )
            "android.bluetooth.device.action.ACL_CONNECTED" -> QrWidgets.onBluetoothChanged(context, true)
            "android.bluetooth.device.action.ACL_DISCONNECTED" -> QrWidgets.onBluetoothChanged(context, false)
            else -> super.onReceive(context, intent)
        }
    }
}
