package com.app.lifetracker
// Версия: 1.1 (14.10) — `iconScale`: множитель размера значков задачи из ключа iconScale присланного страницей JSON.

import android.content.Context
import android.graphics.Color
import org.json.JSONArray
import org.json.JSONObject

/**
 * Очередь задач, созданных окном «Создать новую задачу» (QuickTaskActivity), пока основное приложение не открыто.
 * Живёт в SharedPreferences "lt_quicktasks". Страница забирает очередь при запуске и при возврате в приложение:
 *   1. LifeTrackerNative.takeQuickTasks() отдаёт JSON-массив БЕЗ удаления;
 *   2. страница создаёт задачи в Inbox (повторно одну и ту же задачу по id не создаёт);
 *   3. LifeTrackerNative.ackQuickTasks(ids) удаляет из очереди только те, что реально сохранены.
 * Так при сбое страницы между шагами 1 и 3 задача не теряется.
 * Здесь же — цвета темы оформления (их присылает страница, чтобы окно выглядело как задача в приложении)
 * и черновик окна (если окно закрылось само, например из-за входящего звонка).
 */
object QuickTaskStore {

    private const val PREFS = "lt_quicktasks"
    private const val K_PENDING = "pending"
    private const val K_THEME = "theme"
    private const val K_DRAFT = "draft"
    private const val DRAFT_KEEP_MS = 30L * 60 * 1000

    private val lock = Any()

    private fun prefs(ctx: Context) = ctx.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    private fun readArray(ctx: Context, key: String): JSONArray = try {
        JSONArray(prefs(ctx).getString(key, "[]") ?: "[]")
    } catch (e: Exception) {
        JSONArray()
    }

    /** Новый идентификатор задачи в том же виде, что genTaskId() в my.js ("tk" + время + 5 символов). */
    fun newTaskId(): String {
        val alphabet = "0123456789abcdefghijklmnopqrstuvwxyz"
        val sb = StringBuilder("tk").append(System.currentTimeMillis())
        repeat(5) { sb.append(alphabet[(Math.random() * alphabet.length).toInt().coerceIn(0, alphabet.length - 1)]) }
        return sb.toString()
    }

    /** flag: null | "red" | "yellow"; work: null | "work" | "check"; remindAt: мс или 0 (без напоминания). */
    fun add(ctx: Context, id: String, text: String, flag: String?, work: String?, remindAt: Long) = synchronized(lock) {
        val arr = readArray(ctx, K_PENDING)
        val o = JSONObject().put("id", id).put("text", text).put("createdAt", System.currentTimeMillis())
        if (flag != null) o.put("flag", flag)
        if (work != null) o.put("work", work)
        if (remindAt > 0L) o.put("remindAt", remindAt)
        arr.put(o)
        prefs(ctx).edit().putString(K_PENDING, arr.toString()).commit()
    }

    fun peekJson(ctx: Context): String = synchronized(lock) { readArray(ctx, K_PENDING).toString() }

    /** Удаляет из очереди задачи с перечисленными id (JSON-массив строк). */
    fun ack(ctx: Context, idsJson: String?) = synchronized(lock) {
        val ids = HashSet<String>()
        try {
            val a = JSONArray(idsJson ?: "[]")
            for (i in 0 until a.length()) ids.add(a.optString(i))
        } catch (e: Exception) {
            return@synchronized
        }
        if (ids.isEmpty()) return@synchronized
        val arr = readArray(ctx, K_PENDING)
        val next = JSONArray()
        for (i in 0 until arr.length()) {
            val o = arr.optJSONObject(i) ?: continue
            if (!ids.contains(o.optString("id"))) next.put(o)
        }
        prefs(ctx).edit().putString(K_PENDING, next.toString()).apply()
    }

    // ---------------------------------------------------------------- цвета темы

    class Palette(
        val card: Int, val ink: Int, val inkSoft: Int, val accent: Int, val groove: Int, val yellow: Int
    )

    /** Страница присылает JSON с CSS-цветами: parchment, ink, inkSoft, wood, groove, joy. */
    fun setThemeJson(ctx: Context, json: String?) {
        try {
            val o = JSONObject(json ?: return)
            prefs(ctx).edit().putString(K_THEME, o.toString()).apply()
        } catch (e: Exception) {
            // оставляем прежние цвета
        }
    }

    fun palette(ctx: Context): Palette {
        val o = try {
            JSONObject(prefs(ctx).getString(K_THEME, "{}") ?: "{}")
        } catch (e: Exception) {
            JSONObject()
        }
        fun c(key: String, def: Int): Int = parseCssColor(o.optString(key, "")) ?: def
        return Palette(
            card = c("parchment", 0xFFF4F0F8.toInt()),
            ink = c("ink", 0xFF3B3350.toInt()),
            inkSoft = c("inkSoft", 0xFF6A6080.toInt()),
            accent = c("wood", 0xFF8F7FB8.toInt()),
            groove = c("groove", 0xFFB6A8D1.toInt()),
            yellow = c("joy", 0xFFE3B341.toInt())
        )
    }

    /**
     * Множитель размера значков управления задачей (ползунок в нижнем ряду задач веб-части, 0.7..1.6; 1.0 — размеры
     * строки задачи по умолчанию: кнопка 22, пиктограмма 15, кружки 19). Страница присылает его в том же JSON, что и цвета
     * темы (ключ iconScale); пока не прислала — 1.0.
     */
    fun iconScale(ctx: Context): Float {
        val o = try {
            JSONObject(prefs(ctx).getString(K_THEME, "{}") ?: "{}")
        } catch (e: Exception) {
            JSONObject()
        }
        val v = o.optDouble("iconScale", 1.0)
        return if (v.isNaN()) 1f else v.toFloat().coerceIn(0.7f, 1.6f)
    }

    /** "#rrggbb", "#rgb" или "rgb(r, g, b)"; иначе null. */
    fun parseCssColor(source: String?): Int? {
        val value = source?.trim() ?: return null
        if (value.isEmpty()) return null
        val rgb = Regex("""rgba?\(\s*(\d{1,3})[\s,]+(\d{1,3})[\s,]+(\d{1,3})""").find(value)
        if (rgb != null) {
            val (r, g, b) = rgb.destructured
            return Color.rgb(r.toInt().coerceIn(0, 255), g.toInt().coerceIn(0, 255), b.toInt().coerceIn(0, 255))
        }
        var hex = value
        if (Regex("^#[0-9a-fA-F]{3}$").matches(hex)) {
            hex = "#" + hex.substring(1).map { "$it$it" }.joinToString("")
        }
        return try {
            Color.parseColor(hex) or 0xFF000000.toInt()
        } catch (e: IllegalArgumentException) {
            null
        }
    }

    // ---------------------------------------------------------------- черновик окна

    class Draft(val text: String, val flag: String?, val work: String?, val remindAt: Long)

    fun saveDraft(ctx: Context, text: String, flag: String?, work: String?, remindAt: Long) {
        if (text.isBlank() && flag == null && work == null && remindAt <= 0L) {
            clearDraft(ctx)
            return
        }
        val o = JSONObject().put("text", text).put("savedAt", System.currentTimeMillis()).put("remindAt", remindAt)
        if (flag != null) o.put("flag", flag)
        if (work != null) o.put("work", work)
        prefs(ctx).edit().putString(K_DRAFT, o.toString()).apply()
    }

    fun takeDraft(ctx: Context): Draft? {
        val raw = prefs(ctx).getString(K_DRAFT, null) ?: return null
        prefs(ctx).edit().remove(K_DRAFT).apply()
        return try {
            val o = JSONObject(raw)
            if (System.currentTimeMillis() - o.optLong("savedAt", 0L) > DRAFT_KEEP_MS) return null
            Draft(
                o.optString("text", ""),
                o.optString("flag", "").ifEmpty { null },
                o.optString("work", "").ifEmpty { null },
                o.optLong("remindAt", 0L)
            )
        } catch (e: Exception) {
            null
        }
    }

    fun clearDraft(ctx: Context) {
        prefs(ctx).edit().remove(K_DRAFT).apply()
    }
}
