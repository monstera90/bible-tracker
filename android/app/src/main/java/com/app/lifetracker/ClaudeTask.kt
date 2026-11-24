package com.app.lifetracker
// Версия: 1.0 (24.11) — отправка задачи в Claude (сундучок у задачи, my.js/claudetab.js): скачивание свежего архива репозитория в фоне ([ClaudeTaskZip]) и очередь итогов для страницы ([ClaudeTaskResults]). Саму отправку в новый диалог ведёт [ClaudeTab] (assets/claude/send_task.js).

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

/** Итоги отправок, которые страница забирает опросом (`claudeTaskResults`). Живут, пока жив процесс приложения. */
object ClaudeTaskResults {
    private val queue = ConcurrentLinkedQueue<JSONObject>()

    fun add(reqId: String, ok: Boolean, msg: String) {
        queue.add(JSONObject().put("id", reqId).put("ok", ok).put("msg", msg))
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
