package com.app.lifetracker

import android.app.AlarmManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build

/**
 * Будильник напоминаний (шаг 5): ОДИН точный будильник на ближайшее ещё не сработавшее напоминание.
 * Сработав, NotifyReceiver показывает все наступившие напоминания и ставит будильник на следующее.
 * Работает при закрытом приложении; после перезагрузки телефона, смены времени и обновления приложения
 * будильник ставится заново (NotifyReceiver). Список напоминаний лежит в NotifyStore (его присылает страница).
 */
object ReminderScheduler {

    private const val REQUEST_ALARM = 5001

    private fun alarmIntent(ctx: Context): PendingIntent {
        val intent = Intent(ctx, NotifyReceiver::class.java).setAction(NotifyReceiver.ACTION_ALARM)
        return PendingIntent.getBroadcast(
            ctx, REQUEST_ALARM, intent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
    }

    fun canScheduleExact(ctx: Context): Boolean {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) return true
        val am = ctx.getSystemService(Context.ALARM_SERVICE) as AlarmManager
        return am.canScheduleExactAlarms()
    }

    /** Ставит будильник на момент at (точный, если разрешено; иначе неточный, но тоже в режиме Doze). */
    fun setAlarm(ctx: Context, pending: PendingIntent, at: Long) {
        val am = ctx.getSystemService(Context.ALARM_SERVICE) as AlarmManager
        try {
            if (canScheduleExact(ctx)) {
                am.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pending)
                return
            }
        } catch (e: SecurityException) {
            // разрешение на точные будильники отозвано: падаем на неточный
        }
        am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pending)
    }

    /** Пересчитывает будильник по текущему списку напоминаний (вызывать после любого изменения списка). */
    fun scheduleNext(ctx: Context) {
        val pending = alarmIntent(ctx)
        val now = System.currentTimeMillis()
        var next = Long.MAX_VALUE
        for (r in NotifyStore.getReminders(ctx)) {
            if (NotifyStore.firedAt(ctx, r.id) == r.at) continue
            if (r.at < next) next = r.at
        }
        if (next == Long.MAX_VALUE) {
            val am = ctx.getSystemService(Context.ALARM_SERVICE) as AlarmManager
            am.cancel(pending)
            return
        }
        // Уже просроченное (телефон был выключен) срабатывает сразу, через секунду.
        setAlarm(ctx, pending, if (next <= now) now + 1000 else next)
    }

    /**
     * Показывает все наступившие напоминания. Приложение на экране или уведомления выключены — показ остаётся
     * странице (карточка внутри приложения), оболочка только запоминает, что сработала.
     */
    fun fireDue(ctx: Context) {
        val now = System.currentTimeMillis()
        val due = NotifyStore.getReminders(ctx)
            .filter { it.at <= now && NotifyStore.firedAt(ctx, it.id) != it.at }
            .sortedBy { it.at }
        if (due.isEmpty()) return
        val canShow = !NotifyStore.appForeground && NotifyHelper.enabled(ctx)
        for (r in due) {
            val shown = canShow && NotifyHelper.postReminder(ctx, r, now)
            NotifyStore.markFired(ctx, r.id, r.at, shown)
        }
    }
}
