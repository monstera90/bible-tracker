package com.app.lifetracker

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject
import java.util.Calendar

/**
 * Хранилище нативных уведомлений (шаг 5): всё, что должно пережить закрытие приложения и перезагрузку телефона.
 * Живёт в SharedPreferences "lt_notify". Страница присылает сюда снимок напоминаний и настройки слежения за общими
 * задачами (NativeBridge.setReminders / setGroupWatch); оболочка читает их без страницы: будильник и опрос работают
 * при закрытом приложении. Обратно страница забирает то, что произошло без неё: показанные напоминания,
 * нажатия кнопок «Готово»/«Завтра» и клики по уведомлениям, уже увиденные общие задачи.
 * Все методы потокобезопасны (один общий замок): вызываются из моста, получателей и фонового потока опроса.
 */
object NotifyStore {

    private const val PREFS = "lt_notify"
    private const val K_REMINDERS = "reminders"
    private const val K_FIRED = "fired"
    private const val K_FIRED_EXPORT = "firedExport"
    private const val K_ACTIONS = "actions"
    private const val K_WATCH = "groupWatch"
    private const val K_NATIVE_SEEN = "nativeSeen"
    private const val K_SEEN_EXPORT = "seenExport"
    private const val K_POLL_LOG = "pollLog"

    private const val FIRED_KEEP_MS = 60L * 24 * 60 * 60 * 1000
    private const val NATIVE_SEEN_MAX = 3000
    private const val POLL_LOG_MAX = 8

    private val lock = Any()

    /** true, пока Activity на экране (onResume..onPause): тогда напоминания и опрос оставляем странице. */
    @Volatile
    var appForeground: Boolean = false

    class Reminder(val id: String, val at: Long, val text: String)

    private fun prefs(ctx: Context) = ctx.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    private fun readObject(ctx: Context, key: String): JSONObject = try {
        JSONObject(prefs(ctx).getString(key, "{}") ?: "{}")
    } catch (e: Exception) {
        JSONObject()
    }

    private fun readArray(ctx: Context, key: String): JSONArray = try {
        JSONArray(prefs(ctx).getString(key, "[]") ?: "[]")
    } catch (e: Exception) {
        JSONArray()
    }

    // ---------------------------------------------------------------- напоминания

    fun getReminders(ctx: Context): List<Reminder> = synchronized(lock) {
        val arr = readArray(ctx, K_REMINDERS)
        val out = ArrayList<Reminder>(arr.length())
        for (i in 0 until arr.length()) {
            val o = arr.optJSONObject(i) ?: continue
            val id = o.optString("id", "")
            val at = o.optLong("at", 0L)
            if (id.isEmpty() || at <= 0L) continue
            out.add(Reminder(id, at, o.optString("text", "")))
        }
        out
    }

    /** Полная замена списка (страница присылает актуальный снимок). Некорректный JSON список не меняет. */
    fun setReminders(ctx: Context, json: String?): Boolean = synchronized(lock) {
        val arr = try {
            JSONArray(json ?: "[]")
        } catch (e: Exception) {
            return false
        }
        prefs(ctx).edit().putString(K_REMINDERS, arr.toString()).apply()
        true
    }

    fun addReminder(ctx: Context, r: Reminder) = synchronized(lock) {
        val arr = readArray(ctx, K_REMINDERS)
        val next = JSONArray()
        for (i in 0 until arr.length()) {
            val o = arr.optJSONObject(i) ?: continue
            if (o.optString("id") != r.id) next.put(o)
        }
        next.put(JSONObject().put("id", r.id).put("at", r.at).put("text", r.text))
        prefs(ctx).edit().putString(K_REMINDERS, next.toString()).apply()
    }

    fun removeReminder(ctx: Context, id: String) = synchronized(lock) {
        val arr = readArray(ctx, K_REMINDERS)
        val next = JSONArray()
        for (i in 0 until arr.length()) {
            val o = arr.optJSONObject(i) ?: continue
            if (o.optString("id") != id) next.put(o)
        }
        prefs(ctx).edit().putString(K_REMINDERS, next.toString()).apply()
    }

    /** Меняет срок напоминания (кнопка «Завтра»). false, если такого напоминания в снимке нет. */
    fun updateReminderAt(ctx: Context, id: String, at: Long): Boolean = synchronized(lock) {
        val arr = readArray(ctx, K_REMINDERS)
        var found = false
        for (i in 0 until arr.length()) {
            val o = arr.optJSONObject(i) ?: continue
            if (o.optString("id") == id) {
                o.put("at", at)
                found = true
            }
        }
        if (found) prefs(ctx).edit().putString(K_REMINDERS, arr.toString()).apply()
        found
    }

    fun reminderText(ctx: Context, id: String): String? = getReminders(ctx).firstOrNull { it.id == id }?.text

    // ---------------------------------------------------------------- «уже обработано»

    /** {id: at} — для каких сроков оболочка уже сработала (показала уведомление или оставила страницу). */
    fun firedAt(ctx: Context, id: String): Long = synchronized(lock) { readObject(ctx, K_FIRED).optLong(id, -1L) }

    /**
     * Отмечает срабатывание. export = true: уведомление реально показано, страница при следующем обращении получит
     * эту запись (takeFiredJson) и не покажет карточку второй раз. export = false: показ оставлен странице
     * (приложение открыто или уведомления выключены) — оболочка лишь не повторяет срабатывание.
     */
    fun markFired(ctx: Context, id: String, at: Long, export: Boolean) = synchronized(lock) {
        val now = System.currentTimeMillis()
        val fired = readObject(ctx, K_FIRED)
        fired.put(id, at)
        val keys = fired.keys().asSequence().toList()
        for (k in keys) if (fired.optLong(k, 0L) < now - FIRED_KEEP_MS) fired.remove(k)
        val e = prefs(ctx).edit().putString(K_FIRED, fired.toString())
        if (export) {
            val ex = readObject(ctx, K_FIRED_EXPORT)
            ex.put(id, at)
            e.putString(K_FIRED_EXPORT, ex.toString())
        }
        e.apply()
    }

    /** Забирает и очищает {id: at} показанных напоминаний. */
    fun takeFiredJson(ctx: Context): String = synchronized(lock) {
        val ex = readObject(ctx, K_FIRED_EXPORT)
        if (ex.length() > 0) prefs(ctx).edit().putString(K_FIRED_EXPORT, "{}").apply()
        ex.toString()
    }

    // ---------------------------------------------------------------- действия из уведомлений

    /**
     * Очередь действий, которые страница применит к данным (оболочка данных задач не меняет):
     * action "done" / "tomorrow" (кнопки) или "" (клик по уведомлению); at — новый срок для "tomorrow".
     */
    fun addAction(ctx: Context, taskId: String, action: String, kind: String, at: Long) = synchronized(lock) {
        val arr = readArray(ctx, K_ACTIONS)
        arr.put(JSONObject().put("taskId", taskId).put("action", action).put("kind", kind).put("at", at))
        prefs(ctx).edit().putString(K_ACTIONS, arr.toString()).apply()
    }

    fun takeActionsJson(ctx: Context): String = synchronized(lock) {
        val arr = readArray(ctx, K_ACTIONS)
        if (arr.length() > 0) prefs(ctx).edit().putString(K_ACTIONS, "[]").apply()
        arr.toString()
    }

    // ---------------------------------------------------------------- слежение за общими задачами

    fun getWatch(ctx: Context): JSONObject? = synchronized(lock) {
        val raw = prefs(ctx).getString(K_WATCH, null) ?: return null
        try {
            JSONObject(raw)
        } catch (e: Exception) {
            null
        }
    }

    fun setWatch(ctx: Context, json: String?): Boolean = synchronized(lock) {
        if (json.isNullOrEmpty()) {
            prefs(ctx).edit().remove(K_WATCH).apply()
            return true
        }
        try {
            JSONObject(json)
        } catch (e: Exception) {
            return false
        }
        prefs(ctx).edit().putString(K_WATCH, json).apply()
        true
    }

    /** Id общих задач, о которых оболочка уже знает (нативный список). Привязан к группе: другая группа — другой список. */
    fun nativeSeenIds(ctx: Context, groupId: String): Set<String> = synchronized(lock) {
        val o = readObject(ctx, K_NATIVE_SEEN)
        if (o.optString("groupId") != groupId) return emptySet()
        val arr = o.optJSONArray("ids") ?: return emptySet()
        val out = LinkedHashSet<String>()
        for (i in 0 until arr.length()) out.add(arr.optString(i))
        out
    }

    /**
     * Запоминает id как увиденные. notified = true: оболочка показала уведомление про эти задачи,
     * страница при следующем обращении получит их (takeSeenExportJson) и сама не повторит уведомление.
     */
    fun addNativeSeen(ctx: Context, groupId: String, ids: Collection<String>, notified: Boolean): Unit = synchronized(lock) {
        if (ids.isEmpty()) return
        val current = LinkedHashSet(nativeSeenIds(ctx, groupId))
        current.addAll(ids)
        val list = current.toList()
        val trimmed = if (list.size > NATIVE_SEEN_MAX) list.subList(list.size - NATIVE_SEEN_MAX, list.size) else list
        val e = prefs(ctx).edit().putString(
            K_NATIVE_SEEN,
            JSONObject().put("groupId", groupId).put("ids", JSONArray(trimmed)).toString()
        )
        if (notified) {
            val ex = readArray(ctx, K_SEEN_EXPORT)
            for (id in ids) ex.put(id)
            e.putString(K_SEEN_EXPORT, ex.toString())
        }
        e.apply()
    }

    fun takeSeenExportJson(ctx: Context): String = synchronized(lock) {
        val ex = readArray(ctx, K_SEEN_EXPORT)
        if (ex.length() > 0) prefs(ctx).edit().putString(K_SEEN_EXPORT, "[]").apply()
        ex.toString()
    }

    // ---------------------------------------------------------------- журнал опроса (диагностика)

    fun logPoll(ctx: Context, text: String) = synchronized(lock) {
        val arr = readArray(ctx, K_POLL_LOG)
        val stamp = java.text.SimpleDateFormat("dd.MM HH:mm:ss", java.util.Locale.US).format(java.util.Date())
        val next = JSONArray()
        next.put("$stamp $text")
        for (i in 0 until minOf(arr.length(), POLL_LOG_MAX - 1)) next.put(arr.optString(i))
        prefs(ctx).edit().putString(K_POLL_LOG, next.toString()).apply()
    }

    fun pollLog(ctx: Context): JSONArray = synchronized(lock) { readArray(ctx, K_POLL_LOG) }

    // ---------------------------------------------------------------- время

    /** Завтра в то же время суток, что было у baseAt (как tomorrowSameTime в notifications.js). */
    fun tomorrowSameTime(baseAt: Long, now: Long): Long {
        val base = Calendar.getInstance().apply { timeInMillis = if (baseAt > 0) baseAt else now }
        val d = Calendar.getInstance().apply {
            timeInMillis = now
            add(Calendar.DAY_OF_MONTH, 1)
            set(Calendar.HOUR_OF_DAY, base.get(Calendar.HOUR_OF_DAY))
            set(Calendar.MINUTE, base.get(Calendar.MINUTE))
            set(Calendar.SECOND, 0)
            set(Calendar.MILLISECOND, 0)
        }
        return d.timeInMillis
    }
}
