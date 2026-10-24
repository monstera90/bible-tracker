package com.app.lifetracker
// Версия: 1.0 (24.10)

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
        const val EXTRA_ID = "alarmId"
    }

    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != ACTION_FIRE) return
        val id = intent.getStringExtra(EXTRA_ID) ?: return
        CardAlarms.fire(context.applicationContext, id)
    }
}
