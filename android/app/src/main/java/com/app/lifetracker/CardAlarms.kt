package com.app.lifetracker
// Версия: 1.0 (24.10)

import android.annotation.SuppressLint
import android.app.AlarmManager
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.media.AudioAttributes
import android.media.AudioManager
import android.media.RingtoneManager
import android.net.Uri
import android.os.Build
import android.os.PowerManager
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import org.json.JSONArray
import org.json.JSONObject
import java.util.Calendar
import java.util.Locale

/**
 * Будильники карточек вкладки 9 (карточка «Будильник», QR `lt://v1/alarm/<ЧЧММ>[,<минут>,<раз>][/<название>]`).
 *
 * Скан кода (страница: мост setCardAlarm, окно ярлыка: ScanBridge.setAlarm) заводит будильник на ближайшее время ЧЧ:ММ —
 * сегодня, если оно ещё не прошло, иначе завтра. Звонит без открытого приложения: точный будильник системы
 * (`setAlarmClock` — не откладывается режимом Doze, значок будильника в строке состояния), в момент срабатывания — уведомление-карточка:
 * категория «будильник», максимальная важность, видно на заблокированном экране, звук будильника и вибрация повторяются, пока карточку
 * не смахнут (FLAG_INSISTENT; самой не тронутой карточке — не дольше NOTIFY_TIMEOUT_MS). Смахивание гасит звонок.
 *
 * Повторы: если заданы (каждые 5/15/30 минут, 1–4 раза), будильник звонит ещё столько же раз через равные промежутки —
 * независимо от того, смахнули ли предыдущую карточку (звонков всего 1 + повторов; новый звонок заменяет прежнюю карточку).
 * Состояние — SharedPreferences `card_alarms`; после перезагрузки, смены времени и обновления приложения будильники ставятся заново
 * (NotifyReceiver → restore): звонок, опоздавший больше чем на LATE_GRACE_MS, пропускается.
 */
object CardAlarms {

    const val CHANNEL = "card_alarm"
    private const val TAG = "card-alarm-"
    private const val NOTIFICATION_ID = 4
    private const val PREFS = "card_alarms"
    private const val KEY = "alarms"
    private const val ACCENT = 0xFF8F7FB8.toInt()
    private val ID_RE = Regex("^[A-Za-z0-9]{4,32}$")
    private val EVERY_OK = setOf(0, 5, 15, 30)
    private const val TIMES_MAX = 4
    private const val LATE_GRACE_MS = 5L * 60 * 1000       // звонок, опоздавший больше чем на 5 минут (телефон был выключен), пропускается
    private const val NOTIFY_TIMEOUT_MS = 10L * 60 * 1000  // не смахнутая карточка убирается сама через 10 минут
    private val VIBRATE = longArrayOf(0, 500, 300, 500, 300, 900)
    private val LOCK = Any()

    class Alarm(
        val id: String,
        val title: String,
        val hour: Int,
        val minute: Int,
        val everyMin: Int,   // 0 — без повторов
        val times: Int,      // повторов после первого звонка (0..4)
        val firstAt: Long,   // момент первого звонка (мс)
        val k: Int           // номер ближайшего звонка: 0 — первый, 1..times — повторы
    ) {
        fun ringAt(n: Int): Long = firstAt + n.toLong() * everyMin * 60_000L
        fun nextAt(): Long = ringAt(k)
    }

    // ---------- хранилище ----------
    private fun prefs(ctx: Context) = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    private fun load(ctx: Context): MutableMap<String, Alarm> {
        val out = LinkedHashMap<String, Alarm>()
        try {
            val o = JSONObject(prefs(ctx).getString(KEY, "{}") ?: "{}")
            val it = o.keys()
            while (it.hasNext()) {
                val id = it.next()
                val a = o.optJSONObject(id) ?: continue
                out[id] = Alarm(
                    id, a.optString("title", ""), a.optInt("hour"), a.optInt("minute"), a.optInt("every"),
                    a.optInt("times"), a.optLong("firstAt"), a.optInt("k")
                )
            }
        } catch (e: Exception) {
            // повреждённая запись — начинаем с пустого списка
        }
        return out
    }

    private fun save(ctx: Context, map: Map<String, Alarm>) {
        val o = JSONObject()
        for ((id, a) in map) {
            o.put(
                id,
                JSONObject().put("title", a.title).put("hour", a.hour).put("minute", a.minute).put("every", a.everyMin)
                    .put("times", a.times).put("firstAt", a.firstAt).put("k", a.k)
            )
        }
        prefs(ctx).edit().putString(KEY, o.toString()).apply()
    }

    /** Заведённые будильники для страницы: [{id, title, hour, minute, every, times, k, firstAt, nextAt, now}]. */
    fun listJson(ctx: Context): String = synchronized(LOCK) {
        val now = System.currentTimeMillis()
        val arr = JSONArray()
        for (a in load(ctx).values) {
            arr.put(
                JSONObject().put("id", a.id).put("title", a.title).put("hour", a.hour).put("minute", a.minute)
                    .put("every", a.everyMin).put("times", a.times).put("k", a.k).put("firstAt", a.firstAt)
                    .put("nextAt", a.nextAt()).put("now", now)
            )
        }
        arr.toString()
    }

    // ---------- действия ----------
    /** Ближайшее ЧЧ:ММ строго после now: сегодня, если ещё не наступило, иначе завтра. */
    private fun nextOccurrence(hour: Int, minute: Int, now: Long): Long {
        val cal = Calendar.getInstance()
        cal.timeInMillis = now
        cal.set(Calendar.HOUR_OF_DAY, hour)
        cal.set(Calendar.MINUTE, minute)
        cal.set(Calendar.SECOND, 0)
        cal.set(Calendar.MILLISECOND, 0)
        if (cal.timeInMillis <= now) cal.add(Calendar.DAY_OF_YEAR, 1)
        return cal.timeInMillis
    }

    /** Заводит (или заводит заново) будильник. Возвращает момент первого звонка (мс) или 0, если параметры неверны. */
    fun set(ctx: Context, id: String, title: String, hour: Int, minute: Int, everyMin: Int, times: Int): Long = synchronized(LOCK) {
        if (!ID_RE.matches(id) || hour !in 0..23 || minute !in 0..59 || everyMin !in EVERY_OK) return 0L
        val n = if (everyMin == 0) 0 else times.coerceIn(1, TIMES_MAX)
        val firstAt = nextOccurrence(hour, minute, System.currentTimeMillis())
        val a = Alarm(id, title.take(200), hour, minute, everyMin, n, firstAt, 0)
        val map = load(ctx)
        map[id] = a // тот же id — заново
        save(ctx, map)
        cancelNotification(ctx, id) // повторный скан гасит звонок прежнего заведения
        schedule(ctx, a)
        firstAt
    }

    /** «Выкл.» на карточке и удаление карточки: будильник снимается вместе с повторами, звонящая карточка убирается. */
    fun cancel(ctx: Context, id: String) = synchronized(LOCK) {
        val map = load(ctx)
        map.remove(id)
        save(ctx, map)
        try {
            (ctx.getSystemService(Context.ALARM_SERVICE) as AlarmManager).cancel(fireIntent(ctx, id))
        } catch (e: Exception) {
            // будильника уже нет
        }
        cancelNotification(ctx, id)
    }

    /** Сработал системный будильник: звонок (если не опоздал) и постановка следующего повтора. */
    fun fire(ctx: Context, id: String) = synchronized(LOCK) {
        val map = load(ctx)
        val a = map[id] ?: return@synchronized
        val now = System.currentTimeMillis()
        if (a.nextAt() > now + 2000) { // сработал раньше срока (сдвиг часов): ставим заново
            schedule(ctx, a)
            return@synchronized
        }
        if (now - a.nextAt() <= LATE_GRACE_MS) ring(ctx, a)
        var n = a.k + 1
        while (n <= a.times && a.ringAt(n) + LATE_GRACE_MS < now) n++ // пропущенные повторы не звонят
        if (n > a.times) {
            map.remove(id) // звонки закончились
            save(ctx, map)
        } else {
            val next = Alarm(a.id, a.title, a.hour, a.minute, a.everyMin, a.times, a.firstAt, n)
            map[id] = next
            save(ctx, map)
            schedule(ctx, next)
        }
    }

    /** После перезагрузки, смены времени и обновления приложения: будильники — заново, опоздавшие звонки пропускаются. */
    fun restore(ctx: Context) {
        val now = System.currentTimeMillis()
        val items = synchronized(LOCK) { load(ctx).values.toList() }
        for (a in items) {
            if (a.nextAt() <= now) fire(ctx, a.id) else synchronized(LOCK) { schedule(ctx, a) }
        }
    }

    // ---------- системный будильник ----------
    private fun fireIntent(ctx: Context, id: String): PendingIntent {
        val intent = Intent(ctx, CardAlarmReceiver::class.java).apply {
            action = CardAlarmReceiver.ACTION_FIRE
            data = Uri.parse("ltcardalarm://fire/$id")
            putExtra(CardAlarmReceiver.EXTRA_ID, id)
        }
        return PendingIntent.getBroadcast(ctx, ("alarmfire$id").hashCode(), intent, Compat.pendingFlags())
    }

    private fun openApp(ctx: Context): PendingIntent {
        val intent = Intent(ctx, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP
        }
        return PendingIntent.getActivity(ctx, 6002, intent, Compat.pendingFlags())
    }

    private fun schedule(ctx: Context, a: Alarm) {
        val at = a.nextAt()
        val pending = fireIntent(ctx, a.id)
        try {
            // как у будильника-часов: точный, не откладывается Doze, не требует разрешения на точные будильники
            val am = ctx.getSystemService(Context.ALARM_SERVICE) as AlarmManager
            am.setAlarmClock(AlarmManager.AlarmClockInfo(at, openApp(ctx)), pending)
        } catch (e: Exception) {
            try {
                ReminderScheduler.setAlarm(ctx, pending, at)
            } catch (e2: Exception) {
                // будильник не поставился: звонка не будет
            }
        }
    }

    // ---------- уведомление-карточка ----------
    private fun alarmSound(): Uri? =
        RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM)
            ?: RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION)

    private fun ensureChannel(ctx: Context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val nm = ctx.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        if (nm.getNotificationChannel(CHANNEL) != null) return
        val ch = NotificationChannel(CHANNEL, "Будильники карточек", NotificationManager.IMPORTANCE_HIGH)
        ch.description = "Карточка на экране (в том числе заблокированном), пока её не смахнут"
        ch.enableVibration(true)
        ch.vibrationPattern = VIBRATE
        ch.lockscreenVisibility = Notification.VISIBILITY_PUBLIC
        val attrs = AudioAttributes.Builder()
            .setUsage(AudioAttributes.USAGE_ALARM)
            .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
            .build()
        ch.setSound(alarmSound(), attrs)
        nm.createNotificationChannel(ch)
    }

    /** Подсвечивает экран на несколько секунд, чтобы карточка была видна на заблокированном телефоне. */
    @Suppress("DEPRECATION")
    @SuppressLint("WakelockTimeout")
    private fun wakeScreen(ctx: Context) {
        try {
            val pm = ctx.getSystemService(Context.POWER_SERVICE) as PowerManager
            val wl = pm.newWakeLock(
                PowerManager.SCREEN_BRIGHT_WAKE_LOCK or PowerManager.ACQUIRE_CAUSES_WAKEUP,
                "lifetracker:card_alarm"
            )
            wl.acquire(8000L)
        } catch (e: Exception) {
            // нет разрешения или режим экономии: карточка всё равно появится
        }
    }

    @SuppressLint("MissingPermission")
    private fun ring(ctx: Context, a: Alarm) {
        try {
            ensureChannel(ctx)
            wakeScreen(ctx)
            val head = if (a.title.isBlank()) "Будильник" else a.title
            val clock = String.format(Locale.US, "%02d:%02d", a.hour, a.minute)
            val text = if (a.k > 0) "Будильник $clock · повтор ${a.k} из ${a.times}" else "Будильник $clock"
            val b = NotificationCompat.Builder(ctx, CHANNEL)
                .setSmallIcon(R.drawable.ic_stat_notify)
                .setColor(ACCENT)
                .setContentTitle(head)
                .setContentText(text)
                .setCategory(NotificationCompat.CATEGORY_ALARM)
                .setPriority(NotificationCompat.PRIORITY_MAX)
                .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
                .setOngoing(false)  // смахивается в любую сторону, в том числе на заблокированном экране
                .setAutoCancel(true)
                .setWhen(a.nextAt())
                .setShowWhen(true)
                .setContentIntent(openApp(ctx))
            if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
                // каналов нет: звук и вибрацию задаёт само уведомление (канал на Android 8+ делает то же)
                b.setSound(alarmSound(), AudioManager.STREAM_ALARM)
                b.setVibrate(VIBRATE)
            } else {
                b.setTimeoutAfter(NOTIFY_TIMEOUT_MS)
            }
            val n = b.build()
            n.flags = n.flags or Notification.FLAG_INSISTENT // звук и вибрация повторяются, пока карточку не смахнут
            NotificationManagerCompat.from(ctx).notify(TAG + a.id, NOTIFICATION_ID, n)
        } catch (e: Exception) {
            // уведомления выключены: звонить нечем
        }
    }

    private fun cancelNotification(ctx: Context, id: String) {
        try {
            NotificationManagerCompat.from(ctx).cancel(TAG + id, NOTIFICATION_ID)
        } catch (e: Exception) {
            // уведомления уже нет
        }
    }
}
