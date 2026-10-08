package com.app.lifetracker

import android.annotation.SuppressLint
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.net.Uri
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import java.text.SimpleDateFormat
import java.util.Calendar
import java.util.Date
import java.util.Locale

/**
 * Показ системных уведомлений (шаг 5): напоминания о задачах и «новая общая задача».
 * Внешний вид повторяет прежние уведомления PWA: заголовок «Напоминание», две кнопки «✓ Готово» и «Завтра»,
 * вибрация, уведомление остаётся, пока по нему не нажали. Клик по уведомлению открывает приложение
 * и передаёт странице id задачи (MainActivity.handleNotifyIntent).
 */
object NotifyHelper {

    const val CHANNEL_REMINDERS = "reminders"
    const val CHANNEL_GROUP = "group_tasks"

    const val TAG_REMINDER_PREFIX = "task-reminder-"
    const val TAG_GROUP_PREFIX = "group-task-"
    private const val NOTIFICATION_ID = 1

    private const val ACCENT = 0xFF8F7FB8.toInt()
    private val VIBRATE_REMINDER = longArrayOf(0, 250, 120, 250, 120, 500)
    private val VIBRATE_GROUP = longArrayOf(0, 200, 100, 200)

    /** «Просрочено» — к тексту дописывается исходное время (как LATE_MS в notifications.js). */
    private const val LATE_MS = 2L * 60 * 1000

    fun enabled(ctx: Context): Boolean = NotificationManagerCompat.from(ctx).areNotificationsEnabled()

    private fun ensureChannels(ctx: Context) {
        val nm = ctx.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        if (nm.getNotificationChannel(CHANNEL_REMINDERS) == null) {
            val ch = NotificationChannel(CHANNEL_REMINDERS, "Напоминания о задачах", NotificationManager.IMPORTANCE_HIGH)
            ch.description = "Напоминания на выбранные дату и время"
            ch.enableVibration(true)
            ch.vibrationPattern = VIBRATE_REMINDER
            nm.createNotificationChannel(ch)
        }
        if (nm.getNotificationChannel(CHANNEL_GROUP) == null) {
            val ch = NotificationChannel(CHANNEL_GROUP, "Новые общие задачи", NotificationManager.IMPORTANCE_HIGH)
            ch.description = "Когда другой участник группы добавляет общую задачу"
            ch.enableVibration(true)
            ch.vibrationPattern = VIBRATE_GROUP
            nm.createNotificationChannel(ch)
        }
    }

    /** «19 сентября, 15:30» (год дописывается, только если он не текущий) — как formatReminder в notifications.js. */
    fun formatWhen(at: Long): String {
        val locale = Locale("ru")
        val sameYear = Calendar.getInstance().get(Calendar.YEAR) ==
            Calendar.getInstance().apply { timeInMillis = at }.get(Calendar.YEAR)
        val pattern = if (sameYear) "d MMMM, HH:mm" else "d MMMM yyyy, HH:mm"
        return SimpleDateFormat(pattern, locale).format(Date(at))
    }

    private fun openIntent(ctx: Context, taskId: String, kind: String): PendingIntent {
        val intent = Intent(ctx, MainActivity::class.java).apply {
            action = MainActivity.ACTION_OPEN_TASK
            data = Uri.parse("ltnotify://open/$kind/${Uri.encode(taskId)}")
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP
            putExtra(MainActivity.EXTRA_TASK_ID, taskId)
            putExtra(MainActivity.EXTRA_KIND, kind)
        }
        return PendingIntent.getActivity(
            ctx, ("open$kind$taskId").hashCode(), intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
    }

    private fun actionIntent(ctx: Context, action: String, taskId: String, at: Long): PendingIntent {
        val intent = Intent(ctx, NotifyReceiver::class.java).apply {
            this.action = action
            data = Uri.parse("ltnotify://action/${Uri.encode(action)}/${Uri.encode(taskId)}")
            putExtra(NotifyReceiver.EXTRA_TASK_ID, taskId)
            putExtra(NotifyReceiver.EXTRA_AT, at)
        }
        return PendingIntent.getBroadcast(
            ctx, (action + taskId).hashCode(), intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
    }

    /** Напоминание о задаче: заголовок «Напоминание», кнопки «✓ Готово» и «Завтра». */
    @SuppressLint("MissingPermission")
    fun postReminder(ctx: Context, r: NotifyStore.Reminder, now: Long): Boolean {
        return try {
            ensureChannels(ctx)
            val text = if (r.text.isBlank()) "Задача без названия" else r.text
            val body = if (now - r.at > LATE_MS) text + "\n(" + formatWhen(r.at) + ")" else text
            val n = NotificationCompat.Builder(ctx, CHANNEL_REMINDERS)
                .setSmallIcon(R.drawable.ic_stat_notify)
                .setColor(ACCENT)
                .setContentTitle("Напоминание")
                .setContentText(text)
                .setStyle(NotificationCompat.BigTextStyle().bigText(body))
                .setCategory(NotificationCompat.CATEGORY_REMINDER)
                .setPriority(NotificationCompat.PRIORITY_HIGH)
                .setVibrate(VIBRATE_REMINDER)
                .setDefaults(NotificationCompat.DEFAULT_SOUND)
                .setAutoCancel(true)
                .setContentIntent(openIntent(ctx, r.id, ""))
                .addAction(0, "✓ Готово", actionIntent(ctx, NotifyReceiver.ACTION_DONE, r.id, r.at))
                .addAction(0, "Завтра", actionIntent(ctx, NotifyReceiver.ACTION_TOMORROW, r.id, r.at))
                .build()
            NotificationManagerCompat.from(ctx).notify(TAG_REMINDER_PREFIX + r.id, NOTIFICATION_ID, n)
            true
        } catch (e: Exception) {
            false
        }
    }

    /** Уведомление о новой общей задаче (одна — по её id, несколько — общее). Клик открывает первую из них. */
    @SuppressLint("MissingPermission")
    fun postGroupTask(ctx: Context, title: String, body: String, taskId: String, many: Boolean): Boolean {
        return try {
            ensureChannels(ctx)
            val n = NotificationCompat.Builder(ctx, CHANNEL_GROUP)
                .setSmallIcon(R.drawable.ic_stat_notify)
                .setColor(ACCENT)
                .setContentTitle(title)
                .setContentText(body.lineSequence().firstOrNull() ?: body)
                .setStyle(NotificationCompat.BigTextStyle().bigText(body))
                .setCategory(NotificationCompat.CATEGORY_MESSAGE)
                .setPriority(NotificationCompat.PRIORITY_HIGH)
                .setVibrate(VIBRATE_GROUP)
                .setDefaults(NotificationCompat.DEFAULT_SOUND)
                .setAutoCancel(true)
                .setContentIntent(openIntent(ctx, taskId, "group-task-new"))
                .build()
            val tag = if (many) TAG_GROUP_PREFIX + "many" else TAG_GROUP_PREFIX + taskId
            NotificationManagerCompat.from(ctx).notify(tag, NOTIFICATION_ID, n)
            true
        } catch (e: Exception) {
            false
        }
    }

    fun cancelReminder(ctx: Context, taskId: String) {
        try {
            NotificationManagerCompat.from(ctx).cancel(TAG_REMINDER_PREFIX + taskId, NOTIFICATION_ID)
        } catch (e: Exception) {
            // уведомления уже нет
        }
    }
}
