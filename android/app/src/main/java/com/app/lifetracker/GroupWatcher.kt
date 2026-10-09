package com.app.lifetracker

import android.app.AlarmManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.net.Uri
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest
import javax.crypto.Cipher
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.SecretKeySpec

/**
 * Уведомление «новая общая задача от другого участника» при ЗАКРЫТОМ приложении (шаг 5).
 * Раз в ~10 минут (будильник, переживает закрытие приложения и перезагрузку) оболочка без страницы:
 *  1. спрашивает у базы только список id общих задач группы (?shallow=true — несколько байт);
 *  2. для id, которых нет среди уже увиденных, скачивает запись и расшифровывает её (ключ AES-256-GCM = SHA-256(groupId),
 *     формат: base64(IV 12 байт + шифротекст + тег) — тот же, что у syncengine_groupcrypto.js);
 *  3. «новая» = те же правила, что у notifyAboutNewGroupTasks в my.js: создана не этим устройством, не выполнена,
 *     текст не пустой (пустая запись — ждём текста, не помечаем увиденной).
 * Кто следим и что уже видели, присылает страница (NativeBridge.setGroupWatch). Пока приложение открыто, опрос пропускается:
 * там работает обычная синхронизация страницы. Состояние данных оболочка не меняет, только показывает уведомление.
 * Предел: это опрос, а не push — уведомление приходит с задержкой до ~10 минут (и дольше, если система задерживает
 * фоновую работу приложения: режим Doze, ограничения батареи производителя).
 */
object GroupWatcher {

    private const val REQUEST_POLL = 5002
    const val POLL_INTERVAL_MS = 10L * 60 * 1000
    private const val MAX_FETCH_PER_POLL = 30
    private const val TIMEOUT_MS = 7000

    private fun pollIntent(ctx: Context): PendingIntent {
        val intent = Intent(ctx, NotifyReceiver::class.java).setAction(NotifyReceiver.ACTION_POLL)
        return PendingIntent.getBroadcast(
            ctx, REQUEST_POLL, intent, Compat.pendingFlags()
        )
    }

    /** Ставит следующий опрос, если страница прислала настройки слежения; иначе отменяет. */
    fun scheduleNextPoll(ctx: Context) {
        val pending = pollIntent(ctx)
        val watch = NotifyStore.getWatch(ctx)
        if (watch == null || watch.optString("groupId").isEmpty()) {
            val am = ctx.getSystemService(Context.ALARM_SERVICE) as AlarmManager
            am.cancel(pending)
            return
        }
        ReminderScheduler.setAlarm(ctx, pending, System.currentTimeMillis() + POLL_INTERVAL_MS)
    }

    private fun httpGet(url: String): String {
        val conn = URL(url).openConnection() as HttpURLConnection
        try {
            conn.connectTimeout = TIMEOUT_MS
            conn.readTimeout = TIMEOUT_MS
            conn.requestMethod = "GET"
            val code = conn.responseCode
            if (code != 200) throw RuntimeException("HTTP $code")
            return conn.inputStream.bufferedReader(Charsets.UTF_8).use { it.readText() }
        } finally {
            conn.disconnect()
        }
    }

    private fun decrypt(groupId: String, payload: String): JSONObject {
        val key = MessageDigest.getInstance("SHA-256").digest(groupId.toByteArray(Charsets.UTF_8))
        val raw = android.util.Base64.decode(payload, android.util.Base64.DEFAULT)
        if (raw.size < 12 + 16) throw IllegalArgumentException("слишком короткая запись")
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.DECRYPT_MODE, SecretKeySpec(key, "AES"), GCMParameterSpec(128, raw.copyOfRange(0, 12)))
        val plain = cipher.doFinal(raw, 12, raw.size - 12)
        return JSONObject(String(plain, Charsets.UTF_8))
    }

    private class Fresh(val id: String, val who: String, val text: String)

    private fun snippet(text: String, max: Int): String {
        val t = text.trim().replace(Regex("\\s+"), " ")
        return if (t.length > max) t.substring(0, max) + "…" else t
    }

    /**
     * Один проход опроса. force = true (кнопка в диагностике) — не пропускать, даже если приложение открыто.
     * Все ошибки сети и разбора только пишутся в журнал: опрос повторится через интервал.
     */
    fun poll(ctx: Context, force: Boolean = false) {
        val watch = NotifyStore.getWatch(ctx)
        if (watch == null) {
            NotifyStore.logPoll(ctx, "нет настроек группы — пропуск")
            return
        }
        if (NotifyStore.appForeground && !force) {
            NotifyStore.logPoll(ctx, "приложение открыто — пропуск")
            return
        }
        if (!NotifyHelper.enabled(ctx)) {
            NotifyStore.logPoll(ctx, "уведомления выключены — пропуск")
            return
        }
        val groupId = watch.optString("groupId")
        val db = watch.optString("db").trimEnd('/')
        val me = watch.optString("deviceId")
        if (groupId.isEmpty() || db.isEmpty()) {
            NotifyStore.logPoll(ctx, "в настройках нет группы или адреса базы")
            return
        }
        try {
            val seen = HashSet<String>()
            watch.optJSONArray("seenIds")?.let { arr -> for (i in 0 until arr.length()) seen.add(arr.optString(i)) }
            seen.addAll(NotifyStore.nativeSeenIds(ctx, groupId))
            val names = watch.optJSONObject("names") ?: JSONObject()

            val base = db + "/groups/" + Uri.encode(groupId) + "/tasks"
            val shallowText = httpGet("$base.json?shallow=true").trim()
            if (shallowText.isEmpty() || shallowText == "null") {
                NotifyStore.logPoll(ctx, "задач в группе нет")
                return
            }
            val shallow = JSONObject(shallowText)
            val unseen = ArrayList<String>()
            val keys = shallow.keys()
            while (keys.hasNext()) {
                val id = keys.next()
                if (!seen.contains(id)) unseen.add(id)
            }
            if (unseen.isEmpty()) {
                NotifyStore.logPoll(ctx, "новых нет (задач в группе: ${shallow.length()})")
                return
            }

            val fresh = ArrayList<Fresh>()
            val settled = ArrayList<String>()
            var failed = 0
            for (id in unseen.take(MAX_FETCH_PER_POLL)) {
                val recText = try {
                    httpGet(base + "/" + Uri.encode(id) + ".json").trim()
                } catch (e: Exception) {
                    failed++
                    continue
                }
                val rec = if (recText.isEmpty() || recText == "null") null else JSONObject(recText)
                val payload = rec?.optString("c", "") ?: ""
                if (payload.isEmpty()) {
                    settled.add(id) // удалена (запись без содержимого)
                    continue
                }
                val data = try {
                    decrypt(groupId, payload)
                } catch (e: Exception) {
                    settled.add(id) // нечитаемая запись: страница её тоже пропускает
                    continue
                }
                val createdBy = data.optString("createdBy", "")
                if (createdBy.isEmpty() || createdBy == me || data.optBoolean("checked", false)) {
                    settled.add(id)
                    continue
                }
                val text = data.optString("text", "")
                if (text.isBlank()) continue // пустая заготовка: ждём текста, увиденной не помечаем
                fresh.add(Fresh(id, names.optString(createdBy, "").ifEmpty { "Участник" }, text))
            }

            if (settled.isNotEmpty()) NotifyStore.addNativeSeen(ctx, groupId, settled, false)

            if (fresh.isNotEmpty()) {
                val single = fresh.size == 1
                val title = if (single) "Новая общая задача" else "Новых общих задач: ${fresh.size}"
                val body = if (single) {
                    fresh[0].who + ": " + snippet(fresh[0].text, 120)
                } else {
                    fresh.take(3).joinToString("\n") { "• " + snippet(it.text, 50) } + if (fresh.size > 3) "\n…" else ""
                }
                if (NotifyHelper.postGroupTask(ctx, title, body, fresh[0].id, !single)) {
                    NotifyStore.addNativeSeen(ctx, groupId, fresh.map { it.id }, true)
                }
            }
            NotifyStore.logPoll(
                ctx,
                "новых: ${fresh.size}, учтено без уведомления: ${settled.size}" + if (failed > 0) ", не скачано: $failed" else ""
            )
        } catch (e: Exception) {
            NotifyStore.logPoll(ctx, "ошибка: " + (e.message ?: e.javaClass.simpleName))
        }
    }
}
