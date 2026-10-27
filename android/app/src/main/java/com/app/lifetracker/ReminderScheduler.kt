package com.app.lifetracker
// Версия: 1.2 (27.10) — повторы «день»/«неделя» и repeatDays считаются по календарным суткам (`daysAdd`, `kindAdd`): после перевода часов срок не сдвигается на час, как и в itemcards.js 30.1.
// Версия: 1.1 (24.10) — повтор по видам (repeatKind: hour/8h/day/week/month/year), `kindAdd`/`kindLast`.
// Версия: 1.0 (17.10) — fireDue: повторяющиеся напоминания (repeatDays) сдвигают срок на период, а не выбывают.

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
            ctx, REQUEST_ALARM, intent, Compat.pendingFlags()
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
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) {
            // Android 5.x: режима Doze и методов *AllowWhileIdle ещё нет; set() с API 19 неточный, поэтому setExact().
            am.setExact(AlarmManager.RTC_WAKEUP, at, pending)
            return
        }
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
    /** Грубый шаг вида повтора (мс) для оценки номера срока; null — вид неизвестен. Совпадает с itemcards.js (REPEAT_KINDS). */
    private fun kindStep(kind: String): Long? = when (kind) {
        "hour" -> 3_600_000L
        "8h" -> 28_800_000L
        "day" -> 86_400_000L
        "week" -> 604_800_000L
        "month" -> 28 * 86_400_000L
        "year" -> 365 * 86_400_000L
        else -> null
    }

    /** Срок номер k от базы base. Месяц/год — по календарю: 31 января + 1 месяц = конец февраля (как в itemcards.js addMonthsTs). */
    private fun kindAdd(base: Long, kind: String, k: Long): Long = when (kind) {
        "day", "week" -> daysAdd(base, if (kind == "week") 7 * k else k)
        "month", "year" -> {
            val cal = java.util.Calendar.getInstance()
            cal.timeInMillis = base
            cal.add(java.util.Calendar.MONTH, (if (kind == "year") 12 * k else k).toInt())
            cal.timeInMillis
        }
        else -> base + k * (kindStep(kind) ?: 0L)
    }

    /** base + n календарных суток: время суток сохраняется при переводе часов (24 ч × n его сдвинули бы на час). */
    private fun daysAdd(base: Long, n: Long): Long {
        val cal = java.util.Calendar.getInstance()
        cal.timeInMillis = base
        cal.add(java.util.Calendar.DAY_OF_YEAR, n.toInt())
        return cal.timeInMillis
    }

    /** Наибольший k ≥ 0, при котором срок не позже t (base ≤ t); иначе 0. */
    private fun kindLastIndex(base: Long, kind: String, t: Long): Long {
        val step = kindStep(kind) ?: return 0L
        var k = maxOf(0L, (t - base) / step)
        while (kindAdd(base, kind, k + 1) <= t) k++
        while (k > 0 && kindAdd(base, kind, k) > t) k--
        return k
    }

    fun fireDue(ctx: Context) {
        val now = System.currentTimeMillis()
        val due = NotifyStore.getReminders(ctx)
            .filter { it.at <= now && NotifyStore.firedAt(ctx, it.id) != it.at }
            .sortedBy { it.at }
        if (due.isEmpty()) return
        val canShow = !NotifyStore.appForeground && NotifyHelper.enabled(ctx)
        for (r in due) {
            val shown = canShow && NotifyHelper.postReminder(ctx, r, now)
            if (r.repeatKind.isNotEmpty() && kindStep(r.repeatKind) != null) {
                // «Напоминание»: последний наступивший срок = база + k периодов (месяц/год — по календарю), следующий — за ним
                val k = kindLastIndex(r.at, r.repeatKind, now)
                NotifyStore.markFired(ctx, r.id, kindAdd(r.at, r.repeatKind, k), shown)
                NotifyStore.updateReminderAt(ctx, r.id, kindAdd(r.at, r.repeatKind, k + 1))
            } else if (r.repeatDays > 0) {
                // Повторяющееся (карточка): одно уведомление за все пропущенные сроки. «Отработанным» считаем последний
                // наступивший срок (база + k периодов), следующий — через период; страница считает так же (itemcards.js).
                val days = r.repeatDays.toLong()
                var k = maxOf(0L, (now - r.at) / (days * 86_400_000L))
                while (daysAdd(r.at, (k + 1) * days) <= now) k++
                while (k > 0 && daysAdd(r.at, k * days) > now) k--
                NotifyStore.markFired(ctx, r.id, daysAdd(r.at, k * days), shown)
                NotifyStore.updateReminderAt(ctx, r.id, daysAdd(r.at, (k + 1) * days))
            } else {
                NotifyStore.markFired(ctx, r.id, r.at, shown)
            }
        }
    }
}
