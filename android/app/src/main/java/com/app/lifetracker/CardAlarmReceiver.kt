package com.app.lifetracker
// Версия: 1.1 (14.11)

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/**
 * Получатель будильников карточек (CardAlarms), работает без запущенного приложения: наступил звонок — показать карточку
 * и поставить следующий повтор. Перезагрузку и смену времени обрабатывает NotifyReceiver (зовёт CardAlarms.restore).
 */
class CardAlarmReceiver : BroadcastReceiver() {

    companion object {
        const val ACTION_FIRE = "com.app.lifetracker.CARD_ALARM_FIRE"
        const val ACTION_DISMISS = "com.app.lifetracker.CARD_ALARM_DISMISS"
        const val EXTRA_ID = "alarmId"
    }

    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action == ACTION_DISMISS) { // звонящую карточку смахнули — порядок карточек в виджетах пересчитать
            QrWidgets.onAlarmsChanged(context.applicationContext)
            return
        }
        if (intent.action != ACTION_FIRE) return
        val id = intent.getStringExtra(EXTRA_ID) ?: return
        CardAlarms.fire(context.applicationContext, id)
    }
}
