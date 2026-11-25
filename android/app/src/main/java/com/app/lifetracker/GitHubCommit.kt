package com.app.lifetracker
// Версия: 1.1 (25.11) — `commit(..., onProgress)`: ход коммита (запросов сделано / всего) для кольца шага 4 в острове. Откат: GitHubCommit.kt 1.0.
// Версия: 1.0 (24.11) — ТЗ «автокоммит fix.zip» (TASK_AUTO_COMMIT.md): разбор и проверка архива, коммит в ветку через Git Data API GitHub.

import android.util.Base64
import org.json.JSONArray
import org.json.JSONObject
import java.io.BufferedInputStream
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.io.IOException
import java.io.InputStream
import java.net.InetSocketAddress
import java.net.Socket
import java.net.SocketTimeoutException
import java.net.UnknownHostException
import java.util.zip.ZipInputStream
import javax.net.ssl.HttpsURLConnection
import javax.net.ssl.SSLSocket
import javax.net.ssl.SSLSocketFactory

/**
 * Без внешних библиотек. Android-часть здесь одна: [Base64] и org.json (оба есть с API 8 / 1).
 *
 * Запросы идут по собственному минимальному HTTP/1.1 поверх [SSLSocket], а не через HttpURLConnection:
 * на Android HttpURLConnection не умеет метод PATCH (бросает ProtocolException), а он нужен для обновления ветки
 * (`PATCH /git/refs/heads/{branch}`). Один путь для GET/POST/PATCH проще, чем два. Токен нигде не логируется.
 *
 * Порядок (раздел 2 ТЗ): ref → commit → blobs → tree → «нечего коммитить?» → commit → PATCH ref (без force);
 * при 422 (ветка сдвинулась) шаги повторяются с новым SHA, до [MAX_ATTEMPTS] раз. Уже созданные blob'ы повторно не создаются.
 */
object GitHubCommit {

    const val MAX_ATTEMPTS = 3
    private const val HOST = "api.github.com"
    private const val MAX_FILE_BYTES = 40L * 1024 * 1024
    private const val MAX_TOTAL_BYTES = 120L * 1024 * 1024

    class Config(val token: String, val owner: String, val repo: String, val branch: String)
    class Entry(val path: String, val bytes: ByteArray)
    class ZipContent(val entries: List<Entry>, val skipped: List<String>)

    sealed class Result {
        class Committed(val files: Int, val sha: String) : Result()
        object NothingToCommit : Result()
        class Failed(val reason: String) : Result()
    }

    /** Ошибка с понятным текстом для тоста. */
    private class GhError(message: String) : Exception(message)

    // ---------- архив ----------

    /**
     * Путь из архива → безопасный путь от корня репозитория или null (путь отбрасывается).
     * Отбрасываются: пустые, абсолютные, с «..», с диском «C:», с пустыми сегментами («a//b»), с сегментом `.git`.
     */
    fun sanitizePath(raw: String?): String? {
        var p = (raw ?: return null).replace('\\', '/')
        while (p.startsWith("./")) p = p.substring(2)
        if (p.isEmpty() || p.startsWith("/")) return null
        if (p.length >= 2 && p[1] == ':') return null
        if (p.indexOf('\u0000') >= 0) return null
        for (seg in p.split('/')) {
            if (seg.isEmpty() || seg == "." || seg == "..") return null
            if (seg.equals(".git", ignoreCase = true)) return null
        }
        return p
    }

    /** Мусор, который кладут архиваторы (macOS): молча пропускается, в «небезопасные» не считается. */
    private fun isJunk(path: String): Boolean {
        val p = path.replace('\\', '/')
        return p.startsWith("__MACOSX/") || p == ".DS_Store" || p.endsWith("/.DS_Store")
    }

    /**
     * Распаковка в памяти. Каталоги пропускаются; небезопасные пути отбрасываются (остальное остаётся), их список — в [ZipContent.skipped].
     * Повторный путь в архиве: побеждает последний. Бросает [IOException] при повреждённом архиве или слишком большом содержимом.
     */
    fun readZip(bytes: ByteArray): ZipContent {
        val out = LinkedHashMap<String, ByteArray>()
        val skipped = ArrayList<String>()
        var total = 0L
        val zin = ZipInputStream(ByteArrayInputStream(bytes))
        try {
            while (true) {
                val e = zin.nextEntry ?: break
                if (e.isDirectory) continue
                val name = e.name
                if (isJunk(name)) continue
                val path = sanitizePath(name)
                // Содержимое всё равно дочитывается до конца записи: ZipInputStream сам перейдёт к следующей.
                if (path == null) { skipped.add(name); continue }
                val buf = ByteArrayOutputStream()
                val tmp = ByteArray(16384)
                while (true) {
                    val n = zin.read(tmp)
                    if (n < 0) break
                    buf.write(tmp, 0, n)
                    if (buf.size() > MAX_FILE_BYTES) throw IOException("файл $path слишком большой")
                }
                total += buf.size()
                if (total > MAX_TOTAL_BYTES) throw IOException("архив слишком большой")
                out[path] = buf.toByteArray()
            }
        } finally {
            try { zin.close() } catch (x: Exception) { }
        }
        return ZipContent(out.map { Entry(it.key, it.value) }, skipped)
    }

    // ---------- коммит ----------

    /** [onProgress] (сделано запросов, всего) — для кольца шага «коммит» в острове; не обязателен. */
    fun commit(cfg: Config, entries: List<Entry>, message: String, onProgress: ((Int, Int) -> Unit)? = null): Result {
        return try {
            run(cfg, entries, message, onProgress)
        } catch (e: GhError) {
            Result.Failed(e.message ?: "ошибка GitHub")
        } catch (e: UnknownHostException) {
            Result.Failed("нет сети")
        } catch (e: SocketTimeoutException) {
            Result.Failed("нет сети (таймаут)")
        } catch (e: java.net.ConnectException) {
            Result.Failed("нет сети")
        } catch (e: IOException) {
            Result.Failed("ошибка сети: " + (e.message ?: e.javaClass.simpleName))
        } catch (e: Exception) {
            Result.Failed("сбой: " + (e.message ?: e.javaClass.simpleName))
        }
    }

    private fun run(cfg: Config, entries: List<Entry>, message: String, onProgress: ((Int, Int) -> Unit)?): Result {
        val http = Http(cfg.token)
        val total = entries.size + 5 // ref, коммит, blob'ы, дерево, коммит, сдвиг ветки
        var made = 0
        val tick = { made++; onProgress?.invoke(minOf(made, total), total); Unit }
        val base = "/repos/" + segEnc(cfg.owner) + "/" + segEnc(cfg.repo)
        val refPath = "heads/" + cfg.branch.split('/').joinToString("/") { segEnc(it) }
        var blobShas: List<String>? = null

        for (attempt in 1..MAX_ATTEMPTS) {
            // 1. SHA последнего коммита ветки
            val ref = http.call("GET", "$base/git/ref/$refPath", null)
            val headSha = ref.json().getJSONObject("object").getString("sha")
            tick()
            // 2. SHA его дерева
            val head = http.call("GET", "$base/git/commits/$headSha", null)
            val baseTree = head.json().getJSONObject("tree").getString("sha")
            tick()
            // 3. blob'ы (один раз: при повторе используются те же)
            if (blobShas == null) {
                val list = ArrayList<String>(entries.size)
                for (e in entries) {
                    val body = JSONObject().put("content", Base64.encodeToString(e.bytes, Base64.NO_WRAP)).put("encoding", "base64")
                    list.add(http.call("POST", "$base/git/blobs", body.toString()).json().getString("sha"))
                    tick()
                }
                blobShas = list
            }
            // 4. новое дерево поверх базового
            val items = JSONArray()
            for (i in entries.indices) {
                items.put(JSONObject().put("path", entries[i].path).put("mode", "100644").put("type", "blob").put("sha", blobShas[i]))
            }
            val treeBody = JSONObject().put("base_tree", baseTree).put("tree", items)
            val newTree = http.call("POST", "$base/git/trees", treeBody.toString()).json().getString("sha")
            tick()
            // 5. ничего не изменилось
            if (newTree == baseTree) return Result.NothingToCommit
            // 6. коммит и сдвиг ветки без force
            val commitBody = JSONObject().put("message", message).put("tree", newTree).put("parents", JSONArray().put(headSha))
            val newCommit = http.call("POST", "$base/git/commits", commitBody.toString()).json().getString("sha")
            tick()
            val patch = http.call("PATCH", "$base/git/refs/$refPath", JSONObject().put("sha", newCommit).put("force", false).toString(), allow422 = true)
            if (patch.code in 200..299) return Result.Committed(entries.size, newCommit)
            // 7. 422: ветка успела сдвинуться — всё с начала
            if (attempt == MAX_ATTEMPTS) throw GhError("ветка ${cfg.branch} постоянно меняется, исчерпаны попытки ($MAX_ATTEMPTS)")
        }
        throw GhError("исчерпаны попытки")
    }

    private fun segEnc(s: String): String {
        val sb = StringBuilder()
        for (b in s.toByteArray(Charsets.UTF_8)) {
            val c = b.toInt() and 0xFF
            val plain = (c in 'A'.code..'Z'.code) || (c in 'a'.code..'z'.code) || (c in '0'.code..'9'.code) || c == '.'.code || c == '-'.code || c == '_'.code
            if (plain) sb.append(c.toChar()) else sb.append('%').append("%02X".format(c))
        }
        return sb.toString()
    }

    // ---------- HTTP ----------

    private class Resp(val code: Int, val body: String) {
        fun json(): JSONObject = try { JSONObject(body) } catch (e: Exception) { throw GhError("неожиданный ответ GitHub") }
    }

    private class Http(private val token: String) {

        /** Ошибочные коды превращаются в [GhError] с причиной; [allow422] возвращает 422 как есть (для повтора при сдвиге ветки). */
        fun call(method: String, path: String, body: String?, allow422: Boolean = false): Resp {
            val r = request(method, path, body)
            if (r.code in 200..299) return r
            if (r.code == 422 && allow422) return r
            val msg = try { JSONObject(r.body).optString("message", "") } catch (e: Exception) { "" }
            val reason = when (r.code) {
                401 -> "токен GitHub отклонён (401)"
                403 -> "доступ запрещён (403)" + (if (msg.isNotEmpty()) ": $msg" else "")
                404 -> "репозиторий или ветка не найдены (404): проверьте owner/repo/branch и права токена"
                else -> "GitHub ${r.code}" + (if (msg.isNotEmpty()) ": $msg" else "")
            }
            throw GhError(reason)
        }

        private fun request(method: String, path: String, body: String?): Resp {
            val payload = body?.toByteArray(Charsets.UTF_8)
            val raw = Socket()
            raw.connect(InetSocketAddress(HOST, 443), 20_000)
            val sock = (SSLSocketFactory.getDefault() as SSLSocketFactory).createSocket(raw, HOST, 443, true) as SSLSocket
            try {
                sock.soTimeout = 90_000
                sock.startHandshake()
                if (!HttpsURLConnection.getDefaultHostnameVerifier().verify(HOST, sock.session)) throw IOException("сертификат не подошёл")
                val head = StringBuilder()
                head.append(method).append(' ').append(path).append(" HTTP/1.1\r\n")
                head.append("Host: ").append(HOST).append("\r\n")
                head.append("User-Agent: LifeTracker-AutoCommit\r\n")
                head.append("Authorization: Bearer ").append(token).append("\r\n")
                head.append("Accept: application/vnd.github+json\r\n")
                head.append("X-GitHub-Api-Version: 2022-11-28\r\n")
                head.append("Accept-Encoding: identity\r\n")
                head.append("Connection: close\r\n")
                if (payload != null) {
                    head.append("Content-Type: application/json\r\n")
                    head.append("Content-Length: ").append(payload.size).append("\r\n")
                }
                head.append("\r\n")
                val os = sock.outputStream
                os.write(head.toString().toByteArray(Charsets.ISO_8859_1))
                if (payload != null) os.write(payload)
                os.flush()
                return readResponse(BufferedInputStream(sock.inputStream, 16384))
            } finally {
                try { sock.close() } catch (e: Exception) { }
            }
        }

        private fun readLine(ins: InputStream): String? {
            val sb = StringBuilder()
            while (true) {
                val c = ins.read()
                if (c < 0) return if (sb.isEmpty()) null else sb.toString()
                if (c == '\n'.code) break
                if (c != '\r'.code) sb.append(c.toChar())
            }
            return sb.toString()
        }

        private fun readResponse(ins: InputStream): Resp {
            val status = readLine(ins) ?: throw IOException("пустой ответ")
            val parts = status.split(' ', limit = 3)
            val code = parts.getOrNull(1)?.toIntOrNull() ?: throw IOException("непонятный ответ сервера")
            var chunked = false
            var length = -1L
            while (true) {
                val line = readLine(ins) ?: break
                if (line.isEmpty()) break
                val i = line.indexOf(':')
                if (i <= 0) continue
                val k = line.substring(0, i).trim().lowercase()
                val v = line.substring(i + 1).trim()
                if (k == "transfer-encoding" && v.lowercase().contains("chunked")) chunked = true
                if (k == "content-length") length = v.toLongOrNull() ?: -1L
            }
            val out = ByteArrayOutputStream()
            if (chunked) {
                while (true) {
                    val szLine = readLine(ins) ?: break
                    val sz = szLine.substringBefore(';').trim().toLongOrNull(16) ?: throw IOException("сломан chunked")
                    if (sz == 0L) break
                    copy(ins, out, sz)
                    readLine(ins) // CRLF после куска
                }
            } else if (length >= 0) {
                copy(ins, out, length)
            } else {
                val tmp = ByteArray(8192)
                while (true) {
                    val n = ins.read(tmp)
                    if (n < 0) break
                    out.write(tmp, 0, n)
                }
            }
            return Resp(code, String(out.toByteArray(), Charsets.UTF_8))
        }

        private fun copy(ins: InputStream, out: ByteArrayOutputStream, count: Long) {
            var left = count
            val tmp = ByteArray(8192)
            while (left > 0) {
                val n = ins.read(tmp, 0, minOf(tmp.size.toLong(), left).toInt())
                if (n < 0) throw IOException("ответ оборван")
                out.write(tmp, 0, n)
                left -= n
            }
        }
    }
}
