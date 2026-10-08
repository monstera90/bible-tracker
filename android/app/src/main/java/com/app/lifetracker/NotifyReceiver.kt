package com.app.lifetracker

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/**
 * Единый получатель событий уведомлений (шаг 5), работает без запущенного приложения:
 *  - ACTION_ALARM: наступило напоминание — показать его и поставить будильник на следующее;
 *  - ACTION_POLL: пора проверить общие задачи группы (сеть, поэтому в фоновом потоке через goAsync);
 *  - ACTION_DONE / ACTION_TOMORROW: кнопки «✓ Готово» и «Завтра» в уведомлении — действие ставится в очередь
 *    для страницы (данные задач меняет только она), а «Завтра» сразу переносит срок и в оболочке, чтобы напоминание
 *    сработало завтра, даже если приложение так и не откроют;
 *  - перезагрузка, смена времени/пояса, обновление приложения: всё ставится заново.
 */
class NotifyReceiver : BroadcastReceiver() {

    companion object {
        const val ACTION_ALARM = "com.app.lifetracker.REMINDER_ALARM"
        const val ACTION_POLL = "com.app.lifetracker.GROUP_POLL"
        const val ACTION_DONE = "com.app.lifetracker.REMINDER_DONE"
        const val ACTION_TOMORROW = "com.app.lifetracker.REMINDER_TOMORROW"
        const val EXTRA_TASK_ID = "taskId"
        const val EXTRA_AT = "at"
    }

    override fun onReceive(context: Context, intent: Intent) {
        val ctx = context.applicationContext
        when (intent.action) {
            ACTION_ALARM -> {
                ReminderScheduler.fireDue(ctx)
                ReminderScheduler.scheduleNext(ctx)
            }
            ACTION_POLL -> {
                val pending = goAsync()
                Thread {
                    try {
                        GroupWatcher.poll(ctx)
                    } catch (e: Exception) {
                        NotifyStore.logPoll(ctx, "сбой опроса: " + (e.message ?: e.javaClass.simpleName))
                    } finally {
                        try {
                            GroupWatcher.scheduleNextPoll(ctx)
                        } finally {
                            pending.finish()
                        }
                    }
                }.start()
            }
            ACTION_DONE, ACTION_TOMORROW -> handleButton(ctx, intent)
            Intent.ACTION_BOOT_COMPLETED,
            Intent.ACTION_MY_PACKAGE_REPLACED,
            Intent.ACTION_TIME_CHANGED,
            Intent.ACTION_TIMEZONE_CHANGED -> {
                // Просроченное, пока телефон был выключен, показывается сразу (с исходным временем в тексте).
                ReminderScheduler.fireDue(ctx)
                ReminderScheduler.scheduleNext(ctx)
                GroupWatcher.scheduleNextPoll(ctx)
            }
        }
    }

    private fun handleButton(ctx: Context, intent: Intent) {
        val taskId = intent.getStringExtra(EXTRA_TASK_ID) ?: return
        val originalAt = intent.getLongExtra(EXTRA_AT, 0L)
        NotifyHelper.cancelReminder(ctx, taskId)
        if (intent.action == ACTION_DONE) {
            NotifyStore.removeReminder(ctx, taskId)
            NotifyStore.addAction(ctx, taskId, "done", "", 0L)
        } else {
            val newAt = NotifyStore.tomorrowSameTime(originalAt, System.currentTimeMillis())
            NotifyStore.updateReminderAt(ctx, taskId, newAt)
            NotifyStore.addAction(ctx, taskId, "tomorrow", "", newAt)
        }
        ReminderScheduler.scheduleNext(ctx)
        // Приложение запущено (в фоне или на экране): страница применит действие сразу.
        MainActivity.instance?.notifyPageAboutAction()
    }
}
