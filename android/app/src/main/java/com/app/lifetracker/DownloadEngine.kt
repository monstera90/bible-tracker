package com.app.lifetracker
// Версия: 1.1 (22.11) — этап 5: предел размера `task.maxBytes` (обновления: по заявленному размеру и по ходу чтения). Откат: DownloadEngine.kt 1.0.
// Версия: 1.0 (21.11) — ТЗ «скачивание файлов» (TZ_downloads.md 1.1), этап 1.

import java.io.File
import java.io.IOException
import java.io.RandomAccessFile
import java.net.HttpURLConnection
import java.net.SocketTimeoutException
import java.net.URL
import java.net.UnknownHostException
import java.util.Collections
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.ConcurrentLinkedQueue
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicLongArray
import javax.net.ssl.SSLException

/** Сервер ответил кодом ошибки. */
class HttpStatusException(val code: Int) : IOException("HTTP $code")

/** Файл больше предела [DownloadTask.maxBytes]. */
class TooBigException : IOException("Файл слишком большой")

/** Чем кончилась работа движка над задачей. */
enum class DlOutcome { DONE, PAUSED, CANCELED, NET_LOST, FAILED }

/** Результат разведки (ТЗ 5.2). [error] не пусто — разведка не удалась (качать всё равно можно попробовать обычным способом). */
class ProbeResult(
    val total: Long,
    val acceptRanges: Boolean,
    val etag: String,
    val contentDisposition: String?,
    val mime: String,
    val error: String
)

/** Работа с сетью: `HttpURLConnection` (OkHttp в проекте нет, новых зависимостей не добавляем), редиректы разбираются вручную. */
internal object Http {
    private const val CONNECT_MS = 15_000
    private const val READ_MS = 15_000
    private const val MAX_REDIRECTS = 8

    /**
     * Открывает соединение и читает код ответа; перенаправления (301/302/303/307/308, в том числе http→https) проходит сам.
     * Cookie и Authorization при переходе на другой сайт не передаются. [reg] — набор открытых соединений: движок рвёт их при паузе и отмене.
     * Адрес `http://` при запрете открытого трафика (манифест) пробуется один раз как `https://`.
     */
    fun open(
        method: String,
        url0: String,
        headers: Map<String, String>,
        range: String?,
        reg: MutableSet<HttpURLConnection>?,
        ifRange: String? = null
    ): HttpURLConnection {
        var url = url0
        var hdrs = headers
        var hops = 0
        var upgraded = false
        while (true) {
            val u = URL(url)
            if (u.protocol != "http" && u.protocol != "https") throw IOException("Адрес не http/https")
            val c = u.openConnection() as HttpURLConnection
            c.instanceFollowRedirects = false
            c.connectTimeout = CONNECT_MS
            c.readTimeout = READ_MS
            c.requestMethod = method
            c.setRequestProperty("Accept-Encoding", "identity") // без сжатия: иначе длина ответа не совпадает с длиной файла
            for ((k, v) in hdrs) if (v.isNotEmpty()) c.setRequestProperty(k, v)
            if (range != null) {
                c.setRequestProperty("Range", range)
                if (!ifRange.isNullOrEmpty()) c.setRequestProperty("If-Range", ifRange)
            }
            reg?.add(c)
            val code = try {
                c.responseCode
            } catch (e: IOException) {
                reg?.remove(c)
                c.disconnect()
                if (u.protocol == "http" && !upgraded && (e.message ?: "").contains("leartext", ignoreCase = true)) {
                    upgraded = true
                    url = "https://" + url.substring("http://".length)
                    continue
                }
                throw e
            }
            if (code == 301 || code == 302 || code == 303 || code == 307 || code == 308) {
                val loc = c.getHeaderField("Location")
                reg?.remove(c)
                c.disconnect()
                if (loc.isNullOrBlank()) throw HttpStatusException(code)
                if (++hops > MAX_REDIRECTS) throw IOException("Слишком много перенаправлений")
                val next = URL(u, loc)
                if (!next.host.equals(u.host, ignoreCase = true)) {
                    hdrs = hdrs.filterKeys { !it.equals("Cookie", ignoreCase = true) && !it.equals("Authorization", ignoreCase = true) }
                }
                url = next.toString()
                continue
            }
            return c
        }
    }

    fun header(c: HttpURLConnection, name: String): String = c.getHeaderField(name)?.trim() ?: ""

    fun closeQuietly(c: HttpURLConnection, reg: MutableSet<HttpURLConnection>?) {
        reg?.remove(c)
        try { c.disconnect() } catch (e: Exception) { }
    }

    /** Метка версии файла: сильный ETag, иначе Last-Modified (слабый ETag в If-Range не годится). */
    fun validator(c: HttpURLConnection): String {
        val et = header(c, "ETag")
        if (et.isNotEmpty() && !et.startsWith("W/")) return et
        return header(c, "Last-Modified")
    }
}

/**
 * Сетевая часть скачивания одного файла (ТЗ 5.2–5.4). Без Android: пишет в обычный [File] [work] (`.part`) и состояние задачи [task];
 * куда и как файл попадёт после — решает служба. [run] блокирует поток до конца работы и возвращает [DlOutcome]; паузу и отмену
 * даёт `task.control` + [stop] (рвёт открытые соединения, чтобы чтение не висело).
 *
 * SINGLE — один поток, докачка через `Range: bytes=<сколько уже>-`. MULTI — файл режется на части ([DownloadLogic.splitRanges]), части
 * качаются параллельно в один файл по смещениям, прогресс частей лежит в `<имя>.part.json`. Сервер не отдаёт диапазоны — возврат к SINGLE
 * с пояснением; части получают 403/429 — потоков вдвое меньше, потом один.
 */
class DownloadEngine(
    private val task: DownloadTask,
    private val work: File,
    private val netUp: () -> Boolean = { true }
) {
    companion object {
        private const val BUF = 64 * 1024
        private const val ATTEMPTS = 3
        private const val META_EVERY_MS = 1000L
        const val NOTE_NO_RANGE = "Сервер не поддерживает потоки"

        /** Разведка (ТЗ 5.2): HEAD, а если не получилось или диапазоны не заявлены — GET с `Range: bytes=0-0`. */
        fun probe(url: String, headers: Map<String, String>): ProbeResult {
            var total = -1L
            var accept = false
            var etag = ""
            var cd: String? = null
            var mime = ""
            var err = ""
            var decided = false
            try {
                val c = Http.open("HEAD", url, headers, null, null)
                try {
                    val code = c.responseCode
                    if (code in 200..299) {
                        total = Http.header(c, "Content-Length").toLongOrNull() ?: -1L
                        val ar = Http.header(c, "Accept-Ranges").lowercase()
                        accept = ar.contains("bytes")
                        etag = Http.validator(c)
                        cd = c.getHeaderField("Content-Disposition")
                        mime = Http.header(c, "Content-Type").substringBefore(';').trim()
                        // размер известен и сервер прямо сказал про диапазоны («bytes» или «none») — GET не нужен
                        decided = total >= 0 && ar.isNotEmpty()
                    }
                } finally {
                    Http.closeQuietly(c, null)
                }
            } catch (e: IOException) {
                err = describe(e)
            }
            if (decided) return ProbeResult(total, accept, etag, cd, mime, "")
            try {
                val c = Http.open("GET", url, headers, "bytes=0-0", null)
                try {
                    val code = c.responseCode
                    if (code == 206) {
                        val cr = Http.header(c, "Content-Range") // bytes 0-0/12345
                        val t = cr.substringAfter('/', "").trim().toLongOrNull()
                        if (t != null) total = t
                        accept = true
                    } else if (code in 200..299) {
                        total = Http.header(c, "Content-Length").toLongOrNull() ?: total
                        accept = false // Range проигнорирован
                    } else {
                        return ProbeResult(total, false, etag, cd, mime, "Ошибка: HTTP $code")
                    }
                    if (etag.isEmpty()) etag = Http.validator(c)
                    if (cd == null) cd = c.getHeaderField("Content-Disposition")
                    if (mime.isEmpty()) mime = Http.header(c, "Content-Type").substringBefore(';').trim()
                    err = ""
                } finally {
                    Http.closeQuietly(c, null)
                }
            } catch (e: IOException) {
                return ProbeResult(total, false, etag, cd, mime, describe(e))
            }
            return ProbeResult(total, accept, etag, cd, mime, err)
        }

        /**
         * Разведка для задачи, у которой её ещё не было (обновления, повторный запуск): заполняет размер, поддержку диапазонов,
         * метку версии и имя файла. null — можно качать дальше; иначе итог, с которым работу надо закончить (сети нет).
         * Не удалась по другой причине (сервер не любит HEAD и Range) — идём обычным скачиванием: настоящая ошибка придёт оттуда.
         */
        fun prepare(task: DownloadTask, netUp: () -> Boolean = { true }): DlOutcome? {
            val p = probe(task.url, task.headers)
            if (p.error.isNotEmpty() && p.total < 0 && !netUp()) return DlOutcome.NET_LOST
            task.totalBytes = p.total
            task.supportsRange = p.acceptRanges && p.total > 0
            task.etag = p.etag
            if (task.fileName.isBlank() || task.fileName == "file") task.fileName = DownloadLogic.pickFileName(p.contentDisposition, task.url, p.mime)
            task.probed = true
            return null
        }

        /** Понятный текст ошибки для второй строки карточки острова. */
        fun describe(e: Throwable): String {
            val m = e.message ?: ""
            return when {
                e is HttpStatusException -> "Ошибка: HTTP " + e.code
                m.contains("ENOSPC") || m.contains("No space left", ignoreCase = true) -> "Диск заполнен"
                e is UnknownHostException -> "Нет связи с сервером"
                e is SocketTimeoutException -> "Сервер не отвечает"
                e is SSLException -> "Ошибка защищённого соединения"
                m.isNotBlank() -> "Ошибка: $m"
                else -> "Ошибка скачивания"
            }
        }
    }

    private val meta = File(work.path + ".json")
    private val conns: MutableSet<HttpURLConnection> = Collections.newSetFromMap(ConcurrentHashMap<HttpURLConnection, Boolean>())

    /** Рвёт открытые соединения: зовётся из службы после установки `task.control` (пауза, отмена). */
    fun stop() {
        for (c in conns.toList()) {
            try { c.disconnect() } catch (e: Exception) { }
        }
    }

    /** Удаляет недокачанный файл и служебный файл частей. */
    fun cleanup() {
        try { work.delete() } catch (e: Exception) { }
        try { meta.delete() } catch (e: Exception) { }
    }

    private fun stopped(): DlOutcome? = when (task.control) {
        DownloadTask.CTL_PAUSE -> DlOutcome.PAUSED
        DownloadTask.CTL_CANCEL -> DlOutcome.CANCELED
        else -> null
    }

    private fun fail(text: String): DlOutcome {
        task.error = text
        return DlOutcome.FAILED
    }

    /** Ждёт [ms] мс, но просыпается сразу, когда пришла пауза или отмена. */
    private fun nap(ms: Long) {
        var left = ms
        while (left > 0 && task.control == DownloadTask.CTL_RUN) {
            val s = minOf(left, 100L)
            try { Thread.sleep(s) } catch (e: InterruptedException) { return }
            left -= s
        }
    }

    fun run(): DlOutcome {
        stopped()?.let { return it }
        try {
            if (!task.probed) prepare(task, netUp)?.let { return it }
            stopped()?.let { return it }
            if (task.maxBytes > 0 && task.totalBytes > task.maxBytes) return fail(TooBigException().message ?: "Файл слишком большой")
            if (task.mode == DlMode.MULTI) {
                if (task.supportsRange && task.totalBytes > 0 && DownloadLogic.splitRanges(task.totalBytes, task.threads).size >= 2) return runMulti()
                if (task.totalBytes > 0 && !task.supportsRange) task.note = NOTE_NO_RANGE
            }
            return runSingle()
        } catch (e: Exception) {
            stopped()?.let { return it }
            if (!netUp()) return DlOutcome.NET_LOST
            return fail(describe(e))
        }
    }

    // ---------- обычное скачивание ----------

    private fun runSingle(): DlOutcome {
        task.activeThreads = 1
        var attempt = 0
        var restarted = false
        while (true) {
            stopped()?.let { return it }
            try {
                return singleOnce()
            } catch (e: TooBigException) {
                cleanup()
                return fail(e.message ?: "Файл слишком большой")
            } catch (e: HttpStatusException) {
                stopped()?.let { return it }
                if (e.code == 416 && !restarted) { // диапазон за пределами файла: качаем заново
                    restarted = true
                    cleanup()
                    task.done.set(0L)
                    continue
                }
                if (e.code >= 500 && ++attempt < ATTEMPTS) {
                    nap(1000L shl (attempt - 1))
                    continue
                }
                return fail(describe(e))
            } catch (e: IOException) {
                stopped()?.let { return it }
                if (!netUp()) return DlOutcome.NET_LOST
                if (++attempt >= ATTEMPTS) return fail(describe(e))
                nap(1000L shl (attempt - 1))
            }
        }
    }

    private fun singleOnce(): DlOutcome {
        var start = if (task.supportsRange && work.exists()) work.length() else 0L
        if (!task.supportsRange && work.exists()) work.delete()
        if (task.totalBytes >= 0 && start > task.totalBytes) start = 0L
        if (task.totalBytes > 0 && start == task.totalBytes) {
            task.done.set(start)
            return DlOutcome.DONE // докачивать нечего
        }
        val c = Http.open("GET", task.url, task.headers, if (start > 0) "bytes=$start-" else null, conns, if (start > 0) task.etag else null)
        try {
            val code = c.responseCode
            var pos = start
            if (code == 206) {
                // докачка с места остановки
            } else if (code in 200..299) {
                pos = 0L // сервер отдал файл целиком (Range не поддержан или файл изменился)
                if (task.totalBytes < 0) task.totalBytes = Http.header(c, "Content-Length").toLongOrNull() ?: -1L
            } else {
                throw HttpStatusException(code)
            }
            var lastMeta = 0L
            RandomAccessFile(work, "rw").use { raf ->
                if (pos == 0L) raf.setLength(0L)
                raf.seek(pos)
                task.done.set(pos)
                val input = c.inputStream
                val buf = ByteArray(BUF)
                while (true) {
                    val n = input.read(buf)
                    if (n < 0) break
                    raf.write(buf, 0, n)
                    pos += n
                    task.done.set(pos)
                    if (task.maxBytes > 0 && pos > task.maxBytes) throw TooBigException()
                    if (task.control != DownloadTask.CTL_RUN) break
                    val now = System.currentTimeMillis()
                    if (now - lastMeta > META_EVERY_MS) {
                        lastMeta = now
                        writeMeta(PartMeta(task.totalBytes, task.etag, emptyList(), LongArray(0)))
                    }
                }
            }
            stopped()?.let {
                writeMeta(PartMeta(task.totalBytes, task.etag, emptyList(), LongArray(0)))
                return it
            }
            if (task.totalBytes >= 0 && pos != task.totalBytes) throw IOException("Файл скачан не полностью")
            if (task.totalBytes < 0) task.totalBytes = pos
            return DlOutcome.DONE
        } finally {
            Http.closeQuietly(c, conns)
        }
    }

    // ---------- многопоточное скачивание ----------

    private enum class Kind { OK, STOPPED, THROTTLED, NO_RANGE, NET, FAILED }

    private class PartRes(val kind: Kind, val code: Int = 0, val msg: String = "")

    private fun writeMeta(m: PartMeta) {
        try { meta.writeText(m.serialize()) } catch (e: Exception) { }
    }

    private fun readMeta(): PartMeta? = try { if (meta.exists()) PartMeta.parse(meta.readText()) else null } catch (e: Exception) { null }

    private fun runMulti(): DlOutcome {
        val total = task.totalBytes
        val parts = DownloadLogic.splitRanges(total, task.threads)
        val partDone = AtomicLongArray(parts.size)
        // докачка: файл и служебный файл совпадают с тем, что собираемся качать
        val m = readMeta()
        val resumable = m != null && m.total == total && m.parts == parts && m.etag == task.etag && work.exists() && work.length() == total
        if (resumable && m != null) {
            for (i in parts.indices) partDone.set(i, m.done[i])
        } else {
            cleanup()
            RandomAccessFile(work, "rw").use { it.setLength(total) }
        }
        fun sum(): Long { var s = 0L; for (i in parts.indices) s += partDone.get(i); return s }
        fun persist() = writeMeta(PartMeta(total, task.etag, parts, LongArray(parts.size) { partDone.get(it) }))
        task.done.set(sum())
        var conc = parts.size
        var rounds = 0
        while (true) {
            val pending = parts.indices.filter { partDone.get(it) < parts[it].length }
            if (pending.isEmpty()) break
            if (++rounds > 12) return fail("Сервер не отдаёт файл частями")
            val n = minOf(conc, pending.size)
            task.activeThreads = n
            val queue = ConcurrentLinkedQueue(pending)
            val results = ConcurrentHashMap<Int, PartRes>()
            val abort = AtomicBoolean(false)
            val workers = (0 until n).map {
                Thread {
                    while (!abort.get() && task.control == DownloadTask.CTL_RUN) {
                        val i = queue.poll() ?: break
                        val r = downloadPart(parts[i], partDone, i, abort)
                        if (r.kind != Kind.OK) {
                            results[i] = r
                            if (r.kind != Kind.STOPPED) abort.set(true)
                        }
                    }
                }.also { it.isDaemon = true; it.start() }
            }
            var lastMeta = 0L
            while (workers.any { it.isAlive }) {
                try { Thread.sleep(250L) } catch (e: InterruptedException) { }
                val now = System.currentTimeMillis()
                if (now - lastMeta > META_EVERY_MS) {
                    lastMeta = now
                    persist()
                }
            }
            persist()
            stopped()?.let { return it }
            if (results.isEmpty()) continue // круг без ошибок: проверим, все ли части готовы
            val bad = results.values
            if (bad.any { it.kind == Kind.NO_RANGE }) { // сервер на деле не отдаёт диапазоны: качаем обычным способом
                task.supportsRange = false
                task.note = NOTE_NO_RANGE
                cleanup()
                task.done.set(0L)
                return runSingle()
            }
            val th = bad.firstOrNull { it.kind == Kind.THROTTLED }
            if (th != null) { // сервер не любит параллельные запросы: потоков вдвое меньше, потом один
                if (conc <= 1) return fail("Ошибка: HTTP " + th.code)
                conc = maxOf(1, conc / 2)
                continue
            }
            if (bad.any { it.kind == Kind.NET }) return if (netUp()) fail("Ошибка: обрыв соединения") else DlOutcome.NET_LOST
            val f = bad.firstOrNull { it.kind == Kind.FAILED }
            return fail(f?.msg?.ifEmpty { null } ?: "Ошибка скачивания")
        }
        if (work.length() != total) return fail("Файл скачан не полностью")
        task.done.set(total)
        return DlOutcome.DONE
    }

    /** Качает одну часть файла (до [ATTEMPTS] попыток при обрыве). 403/429 и «Range не поддержан» — сразу наверх, повторять бессмысленно. */
    private fun downloadPart(r: DownloadLogic.Range, partDone: AtomicLongArray, i: Int, abort: AtomicBoolean): PartRes {
        var attempt = 0
        while (true) {
            if (task.control != DownloadTask.CTL_RUN || abort.get()) return PartRes(Kind.STOPPED)
            val have = partDone.get(i)
            if (have >= r.length) return PartRes(Kind.OK)
            val from = r.start + have
            var c: HttpURLConnection? = null
            try {
                c = Http.open("GET", task.url, task.headers, "bytes=$from-${r.end}", conns, task.etag)
                val code = c.responseCode
                if (code == 403 || code == 429) return PartRes(Kind.THROTTLED, code)
                if (code == 200 || code == 416) return PartRes(Kind.NO_RANGE, code)
                if (code != 206) {
                    if (code >= 500 && attempt + 1 < ATTEMPTS) throw IOException("HTTP $code")
                    return PartRes(Kind.FAILED, code, "Ошибка: HTTP $code")
                }
                RandomAccessFile(work, "rw").use { raf ->
                    raf.seek(from)
                    val input = c.inputStream
                    val buf = ByteArray(BUF)
                    while (task.control == DownloadTask.CTL_RUN && !abort.get()) {
                        val left = r.length - partDone.get(i)
                        if (left <= 0L) break
                        val n = input.read(buf, 0, minOf(buf.size.toLong(), left).toInt())
                        if (n < 0) break
                        raf.write(buf, 0, n)
                        partDone.addAndGet(i, n.toLong())
                        task.done.addAndGet(n.toLong())
                    }
                }
                if (partDone.get(i) >= r.length) return PartRes(Kind.OK)
                if (task.control != DownloadTask.CTL_RUN || abort.get()) return PartRes(Kind.STOPPED)
                throw IOException("Обрыв соединения")
            } catch (e: IOException) {
                if (task.control != DownloadTask.CTL_RUN || abort.get()) return PartRes(Kind.STOPPED)
                if (!netUp()) return PartRes(Kind.NET)
                if (++attempt >= ATTEMPTS) return PartRes(Kind.FAILED, 0, describe(e))
                nap(1000L shl (attempt - 1))
            } finally {
                if (c != null) Http.closeQuietly(c, conns)
            }
        }
    }
}
