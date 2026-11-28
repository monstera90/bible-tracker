package com.app.lifetracker
// Версия: 1.0 (28.11) — история агентов Claude для журнала событий приложения: по отметкам AgentRuns собирается фраза («Агент 2 начал работать над задачей в 09:24 и закончил в 09:30») и кладётся в очередь; страница (eventlog.js) забирает её через мост (agentHistoryTake / agentHistoryAck, мост ≥ 45).

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject

/**
 * Очередь записей об агентах для «Центра событий». Одна запись на запуск: пока запуск жив, её текст меняется, и свежий текст
 * заменяет ещё не забранный старый (у страницы запись ищется по ключу `key`). Очередь лежит в SharedPreferences,
 * поэтому записи не теряются, если страница в этот момент закрыта.
 */
object AgentHistory {
    private const val PREFS = "lt_agent_history"
    private const val K_Q = "q"
    private const val K_SEQ = "seq"
    private const val MAX_QUEUE = 60
    private val LOCK = Any()

    /** Подписывает очередь на отметки [AgentRuns]; звать один раз при старте приложения. */
    fun install(ctx: Context) {
        val app = ctx.applicationContext
        AgentRuns.onMark = { r -> queue(app, r) }
    }

    private fun queue(app: Context, r: AgentRuns.Run) {
        val num = try { ClaudeTabs.numberOf(app, r.tabId) } catch (e: Exception) { 1 }
        val text = AgentRuns.historyText(r, num)
        if (text.isEmpty()) return
        val key = "agent:" + r.startedAt + ":" + r.id
        synchronized(LOCK) {
            val p = app.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            val seq = p.getLong(K_SEQ, 0L) + 1L
            val old = try { JSONArray(p.getString(K_Q, "[]")) } catch (e: Exception) { JSONArray() }
            val out = ArrayList<JSONObject>()
            for (i in 0 until old.length()) {
                val o = old.optJSONObject(i) ?: continue
                if (o.optString("key") != key) out.add(o)
            }
            out.add(JSONObject().put("n", seq).put("key", key).put("text", text).put("at", r.startedAt))
            val arr = JSONArray()
            for (o in out.takeLast(MAX_QUEUE)) arr.put(o)
            p.edit().putString(K_Q, arr.toString()).putLong(K_SEQ, seq).apply()
        }
    }

    /** JSON-массив {n,key,text,at}, ещё не внесённых страницей в журнал событий. */
    fun take(ctx: Context): String = synchronized(LOCK) {
        ctx.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(K_Q, "[]") ?: "[]"
    }

    /** Страница внесла записи с номерами `n` (JSON-массив) — убираем их из очереди; те, что успели обновиться (новый `n`), остаются. */
    fun ack(ctx: Context, nsJson: String?) {
        val ns = HashSet<Long>()
        try {
            val a = JSONArray(nsJson ?: "[]")
            for (i in 0 until a.length()) ns.add(a.optLong(i))
        } catch (e: Exception) {
            return
        }
        if (ns.isEmpty()) return
        synchronized(LOCK) {
            val p = ctx.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            val arr = try { JSONArray(p.getString(K_Q, "[]")) } catch (e: Exception) { JSONArray() }
            val out = JSONArray()
            for (i in 0 until arr.length()) {
                val o = arr.optJSONObject(i) ?: continue
                if (o.optLong("n") !in ns) out.put(o)
            }
            p.edit().putString(K_Q, out.toString()).apply()
        }
    }
}
