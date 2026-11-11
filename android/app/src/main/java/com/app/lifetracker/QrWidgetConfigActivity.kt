package com.app.lifetracker
// Версия: 1.0 (11.11)

import android.app.Activity
import android.app.AlertDialog
import android.appwidget.AppWidgetManager
import android.content.Intent
import android.os.Bundle

/**
 * Окно выбора, какой виджет конструктора показывать в только что добавленном виджете рабочего стола. Если виджет поставили кнопкой
 * «Добавить на рабочий стол» в конструкторе, выбор уже известен — окно закрывается сразу.
 */
class QrWidgetConfigActivity : Activity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setResult(RESULT_CANCELED)
        val id = intent?.getIntExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, AppWidgetManager.INVALID_APPWIDGET_ID)
            ?: AppWidgetManager.INVALID_APPWIDGET_ID
        if (id == AppWidgetManager.INVALID_APPWIDGET_ID) {
            finish()
            return
        }
        if (QrWidgets.isBound(this, id) || QrWidgets.claimPending(this, id)) {
            done(id)
            return
        }
        val list = QrWidgets.configs(this)
        if (list.isEmpty()) {
            AlertDialog.Builder(this)
                .setTitle("Нет виджетов")
                .setMessage("Сначала создайте виджет в приложении: вкладка «Конструктор виджетов».")
                .setPositiveButton("Понятно", null)
                .setOnDismissListener { finish() }
                .show()
            return
        }
        val names = Array(list.size) { i -> list[i].name + " · " + list[i].cards.size }
        AlertDialog.Builder(this)
            .setTitle("Какой виджет показать?")
            .setItems(names) { _, i ->
                QrWidgets.bind(this, id, list[i].id)
                done(id)
            }
            .setOnCancelListener { finish() }
            .show()
    }

    private fun done(id: Int) {
        try {
            QrWidgets.update(this, AppWidgetManager.getInstance(this), id, true)
        } catch (e: Exception) {
            // первое обновление придёт само при следующей синхронизации
        }
        setResult(RESULT_OK, Intent().putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, id))
        QrWidgets.refreshAll(this)
        finish()
    }
}
