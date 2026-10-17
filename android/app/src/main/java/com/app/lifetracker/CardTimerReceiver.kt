package com.app.lifetracker
// Версия: 1.0 (17.10)

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/**
 * Получатель событий таймеров карточек (CardTimers), работает без запущенного приложения:
 * будильник окончания (ACTION_FIRE) и кнопки уведомления «Пауза» / «Продолжить» / «✕ Отмена».
 * Перезагрузку и смену времени обрабатывает NotifyReceiver (зовёт CardTimers.restore).
 */
class CardTimerReceiver : BroadcastReceiver() {

    companion object {
        const val ACTION_FIRE = "com.app.lifetracker.CARD_TIMER_FIRE"
        const val ACTION_PAUSE = "com.app.lifetracker.CARD_TIMER_PAUSE"
        const val ACTION_RESUME = "com.app.lifetracker.CARD_TIMER_RESUME"
        const val ACTION_CANCEL = "com.app.lifetracker.CARD_TIMER_CANCEL"
        const val EXTRA_ID = "cardId"
    }

    override fun onReceive(context: Context, intent: Intent) {
        val ctx = context.applicationContext
        val id = intent.getStringExtra(EXTRA_ID) ?: return
        when (intent.action) {
            ACTION_FIRE -> CardTimers.fire(ctx, id)
            ACTION_PAUSE -> CardTimers.pause(ctx, id)
            ACTION_RESUME -> CardTimers.resume(ctx, id)
            ACTION_CANCEL -> CardTimers.cancel(ctx, id)
        }
    }
}
