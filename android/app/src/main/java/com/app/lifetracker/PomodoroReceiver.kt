package com.app.lifetracker
// Версия: 1.0 (04.11)

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/** Будильник конца фазы помодоро ([PomodoroTimer.fire]); работает без запущенного приложения. */
class PomodoroReceiver : BroadcastReceiver() {

    companion object {
        const val ACTION_FIRE = "com.app.lifetracker.POMODORO_FIRE"
    }

    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action == ACTION_FIRE) PomodoroTimer.fire(context.applicationContext)
    }
}
