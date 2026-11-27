package com.app.lifetracker
// Версия: 1.3 (27.11) — [ClaudeTaskResults.begin/end]: задача, которая уже отправляется, второй раз не принимается (повторный вызов моста с тем же id не ставит вторую отправку в очередь). Откат: ClaudeTask.kt 1.2.
// Версия: 1.2 (25.11) — [ClaudeTaskImages]: картинки задачи (JSON от страницы: имя, тип, base64) складываются в кэш и уходят в чат вместе с архивом. Откат: ClaudeTask.kt 1.1.
// Версия: 1.1 (25.11) — итог отправки задачи передаётся плашке агента в острове (AgentRuns.taskResult). Откат: ClaudeTask.kt 1.0.
// Версия: 1.0 (24.11) — отправка задачи в Claude (сундучок у задачи, my.js/claudetab.js): скачивание свежего архива репозитория в фоне ([ClaudeTaskZip]) и очередь итогов для страницы ([ClaudeTaskResults]). Саму отправку в новый диалог ведёт [ClaudeTab] (assets/claude/send_task.js).

import android.util.Base64
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.io.FileOutputStream
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.ConcurrentLinkedQueue

/** Архив репозитория, который уходит в Claude вместе с текстом задачи. */
object ClaudeTaskZip {
    const val URL_MAIN = "https://github.com/monstera90/bible-tracker/archive/refs/heads/main.zip"
    /** Под этим именем архив прикрепляется в чате (так его называет и сам GitHub). */
    const val FILE_NAME = "bible-tracker-main.zip"
    private const val DIR = "claude_task"
    private const val MAX_BYTES = 120L * 1024 * 1024
    private const val KEEP_MS = 24L * 3600 * 1000

    private fun dir(cache: File): File = File(cache, DIR).also { it.mkdirs() }

    /** Скачивает архив в кэш приложения (блокирует поток — вызывать не из потока интерфейса). */
    @Throws(IOException::class)
    fun download(cache: File, reqId: String): File {
        val d = dir(cache)
        // старые недокачанные и забытые файлы — прочь
        d.listFiles()?.forEach { if (System.currentTimeMillis() - it.lastModified() > KEEP_MS) it.delete() }
        val part = File(d, "$reqId.part")
        val out = File(d, "$reqId.zip")
        var conn: HttpURLConnection? = null
        try {
            conn = (URL(URL_MAIN).openConnection() as HttpURLConnection).apply {
                connectTimeout = 15000
                readTimeout = 30000
                instanceFollowRedirects = true // github.com → codeload.github.com, оба https
                setRequestProperty("User-Agent", "LifeTracker")
                setRequestProperty("Accept", "application/zip, application/octet-stream")
            }
            val code = conn.responseCode
            if (code != 200) throw IOException("GitHub ответил $code")
            var total = 0L
            conn.inputStream.use { input ->
                FileOutputStream(part).use { fos ->
                    val bufArr = ByteArray(64 * 1024)
                    while (true) {
                        val n = input.read(bufArr)
                        if (n < 0) break
                        total += n
                        if (total > MAX_BYTES) throw IOException("архив слишком большой")
                        fos.write(bufArr, 0, n)
                    }
                }
            }
            if (total < 1000) throw IOException("архив пустой")
            part.inputStream().use { ins ->
                val sig = ByteArray(2)
                if (ins.read(sig) != 2 || sig[0] != 'P'.code.toByte() || sig[1] != 'K'.code.toByte()) throw IOException("получен не zip")
            }
            out.delete()
            if (!part.renameTo(out)) throw IOException("не удалось сохранить архив")
            return out
        } catch (e: IOException) {
            part.delete()
            throw e
        } finally {
            conn?.disconnect()
        }
    }
}

/** Картинка задачи, которая прикрепляется в чате рядом с архивом. */
class ClaudeTaskImage(val name: String, val mime: String, val file: File)

/** Картинки задачи: страница присылает JSON-массив [{name, mime, b64}], здесь они сохраняются файлами в кэше приложения. */
object ClaudeTaskImages {
    private const val MAX_COUNT = 10
    private const val MAX_ONE_BYTES = 12L * 1024 * 1024
    private const val MAX_TOTAL_BYTES = 24L * 1024 * 1024

    /** Имя файла для чата: без путей и управляющих знаков, с расширением (по типу, если своего нет). */
    private fun cleanName(raw: String, mime: String, idx: Int): String {
        var n = raw.replace(Regex("[\\\\/:*?\"<>|\\p{Cntrl}]"), "_").trim().take(120)
        if (n.isEmpty()) n = "image" + (idx + 1)
        if (!Regex("\\.[A-Za-z0-9]{2,5}$").containsMatchIn(n)) {
            n += when (mime) {
                "image/jpeg" -> ".jpg"
                "image/webp" -> ".webp"
                "image/gif" -> ".gif"
                "image/svg+xml" -> ".svg"
                else -> ".png"
            }
        }
        return n
    }

    /** Пустой/некорректный список — пустой результат; ошибка записи или превышение размера — IOException. Блокирует поток. */
    @Throws(IOException::class)
    fun save(cache: File, reqId: String, json: String?): List<ClaudeTaskImage> {
        if (json.isNullOrBlank()) return emptyList()
        val arr = try { JSONArray(json) } catch (e: Exception) { throw IOException("список картинок повреждён") }
        val d = File(cache, "claude_task").also { it.mkdirs() }
        val out = ArrayList<ClaudeTaskImage>()
        var total = 0L
        try {
            for (i in 0 until minOf(arr.length(), MAX_COUNT)) {
                val o = arr.optJSONObject(i) ?: continue
                val b64 = o.optString("b64", "")
                if (b64.isEmpty()) continue
                val bytes = try { Base64.decode(b64, Base64.DEFAULT) } catch (e: IllegalArgumentException) { throw IOException("картинка повреждена") }
                if (bytes.isEmpty()) continue
                if (bytes.size > MAX_ONE_BYTES) throw IOException("картинка слишком большая")
                total += bytes.size
                if (total > MAX_TOTAL_BYTES) throw IOException("картинки слишком большие")
                var mime = o.optString("mime", "").lowercase()
                if (!mime.startsWith("image/")) mime = "image/png"
                val f = File(d, reqId + "_i" + i + ".bin")
                FileOutputStream(f).use { it.write(bytes) }
                out.add(ClaudeTaskImage(cleanName(o.optString("name", ""), mime, i), mime, f))
            }
        } catch (e: IOException) {
            out.forEach { it.file.delete() }
            throw e
        }
        return out
    }
}

/** Итоги отправок, которые страница забирает опросом (`claudeTaskResults`). Живут, пока жив процесс приложения. */
object ClaudeTaskResults {
    private val queue = ConcurrentLinkedQueue<JSONObject>()
    /** Задачи, принятые к отправке и ещё без итога: id → когда приняты. Запись старше [IN_FLIGHT_MAX_MS] считается забытой. */
    private val inFlight = java.util.concurrent.ConcurrentHashMap<String, Long>()
    private const val IN_FLIGHT_MAX_MS = 6L * 60 * 1000

    /** true — задача принята к отправке; false — такая отправка уже идёт (второй раз не ставим). */
    fun begin(reqId: String): Boolean {
        val now = System.currentTimeMillis()
        inFlight.entries.removeAll { now - it.value > IN_FLIGHT_MAX_MS }
        return inFlight.putIfAbsent(reqId, now) == null
    }

    /** Снять отметку «отправляется» без итога (отправка не началась). */
    fun end(reqId: String) { inFlight.remove(reqId) }

    fun add(reqId: String, ok: Boolean, msg: String) {
        inFlight.remove(reqId)
        queue.add(JSONObject().put("id", reqId).put("ok", ok).put("msg", msg))
        try { AgentRuns.taskResult(reqId, ok, msg) } catch (e: Exception) { } // плашка острова: успех — шаг 2, сбой — ошибка
        while (queue.size > 50) queue.poll()
    }

    /** Все накопленные итоги одним JSON-массивом; очередь очищается. */
    fun take(): String {
        val arr = JSONArray()
        while (true) {
            val r = queue.poll() ?: break
            arr.put(r)
        }
        return arr.toString()
    }
}
