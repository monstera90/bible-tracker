package com.app.lifetracker
// Версия: 1.1 (23.11) — [canAutoMulti]: можно ли качать в несколько потоков без вопроса. Откат: DownloadLogic.kt 1.0.
// Версия: 1.0 (21.11) — ТЗ «скачивание файлов» (TZ_downloads.md 1.1), этап 1.

import java.io.ByteArrayOutputStream
import java.nio.charset.Charset
import java.util.ArrayDeque

/**
 * Чистая логика скачивания, без Android: разбиение на части, имя файла, подписи для острова, служебный файл прогресса частей,
 * скорость. Всё здесь проверяется JVM-тестами (DownloadLogicTest).
 */
object DownloadLogic {

    /** Минимальный размер части многопоточного скачивания (ТЗ 5.4). */
    const val MIN_PART = 1L shl 20
    const val MAX_THREADS = 8
    const val MIN_THREADS = 2
    const val DEFAULT_THREADS = 4

    /** Можно ли сразу качать в несколько потоков без вопроса: сервер принимает диапазоны и размер известен. */
    fun canAutoMulti(total: Long, acceptRanges: Boolean): Boolean = acceptRanges && total > 0L

    /** Часть файла: байты от [start] до [end] включительно. */
    data class Range(val start: Long, val end: Long) {
        val length: Long get() = end - start + 1
    }

    /**
     * Делит файл размером [total] на равные части для [threads] потоков (2…8). Файл меньше двух минимальных частей (2 МБ) и файл
     * неизвестного размера не делятся (одна часть либо пустой список). Часть не меньше [MIN_PART]. Остаток раздаётся первым частям по байту.
     */
    fun splitRanges(total: Long, threads: Int): List<Range> {
        if (total <= 0L) return emptyList()
        val want = threads.coerceIn(1, MAX_THREADS)
        val n = if (total < 2 * MIN_PART) 1 else minOf(want.toLong(), total / MIN_PART).toInt().coerceAtLeast(1)
        val base = total / n
        val rem = total % n
        val out = ArrayList<Range>(n)
        var pos = 0L
        for (i in 0 until n) {
            val size = base + (if (i < rem) 1 else 0)
            out.add(Range(pos, pos + size - 1))
            pos += size
        }
        return out
    }

    // ---------- имя файла ----------

    /** Имя из заголовка Content-Disposition: `filename*=UTF-8''…` важнее `filename="…"`. null — имени нет. */
    fun parseContentDisposition(header: String?): String? {
        if (header.isNullOrBlank()) return null
        val star = Regex("(?i)filename\\*\\s*=\\s*([^;]+)").find(header)
        if (star != null) {
            val v = star.groupValues[1].trim().trim('"')
            val q1 = v.indexOf('\'')
            val q2 = if (q1 >= 0) v.indexOf('\'', q1 + 1) else -1
            if (q1 >= 0 && q2 > q1) {
                val cs = try { Charset.forName(v.substring(0, q1).ifBlank { "UTF-8" }) } catch (e: Exception) { Charsets.UTF_8 }
                val decoded = percentDecode(v.substring(q2 + 1), cs)
                if (decoded.isNotBlank()) return decoded
            }
        }
        val plain = Regex("(?i)(?<![*\\w])filename\\s*=\\s*(\"([^\"]*)\"|[^;]+)").find(header)
        if (plain != null) {
            val raw = (if (plain.groups[2] != null) plain.groupValues[2] else plain.groupValues[1]).trim()
            val fixed = fixMojibake(raw)
            if (fixed.isNotBlank()) return fixed
        }
        return null
    }

    /** Строка из байтов, прочитанных как ISO-8859-1, которая на деле была UTF-8 («Ð¿Ñ\u0080» → «пр»). Иначе — без изменений. */
    fun fixMojibake(s: String): String {
        if (s.all { it.code < 0x80 }) return s
        if (s.any { it.code > 0xFF }) return s
        val bytes = s.toByteArray(Charsets.ISO_8859_1)
        val back = String(bytes, Charsets.UTF_8)
        return if (back.contains('\uFFFD')) s else back
    }

    private fun percentDecode(s: String, cs: Charset): String {
        val out = ByteArrayOutputStream()
        var i = 0
        while (i < s.length) {
            val ch = s[i]
            if (ch == '%' && i + 2 < s.length) {
                val h = s.substring(i + 1, i + 3).toIntOrNull(16)
                if (h != null) {
                    out.write(h)
                    i += 3
                    continue
                }
            }
            out.write(ch.toString().toByteArray(Charsets.UTF_8))
            i++
        }
        return String(out.toByteArray(), cs)
    }

    /** Последний сегмент пути адреса, расшифрованный; null — сегмента нет (адрес оканчивается на «/»). */
    fun nameFromUrl(url: String): String? {
        val noQuery = url.substringBefore('#').substringBefore('?')
        val afterScheme = noQuery.substringAfter("://", noQuery)
        val path = if (afterScheme.contains('/')) afterScheme.substring(afterScheme.indexOf('/')) else ""
        if (path.isEmpty() || path.endsWith("/")) return null
        val seg = path.substringAfterLast('/')
        val dec = percentDecode(seg, Charsets.UTF_8).trim()
        return dec.ifEmpty { null }
    }

    private val MIME_EXT = mapOf(
        "application/pdf" to "pdf", "image/jpeg" to "jpg", "image/png" to "png", "image/gif" to "gif", "image/webp" to "webp",
        "image/svg+xml" to "svg", "video/mp4" to "mp4", "video/webm" to "webm", "audio/mpeg" to "mp3", "audio/mp4" to "m4a",
        "audio/ogg" to "ogg", "audio/flac" to "flac", "application/zip" to "zip", "application/x-zip-compressed" to "zip",
        "application/vnd.android.package-archive" to "apk", "text/plain" to "txt", "application/epub+zip" to "epub",
        "application/x-fictionbook+xml" to "fb2", "application/json" to "json", "text/csv" to "csv", "application/x-7z-compressed" to "7z",
        "application/vnd.rar" to "rar", "application/gzip" to "gz"
    )

    /** Расширение по Content-Type; пусто — тип неизвестен или «двоичный» (octet-stream). */
    fun extForMime(mime: String?): String = MIME_EXT[(mime ?: "").substringBefore(';').trim().lowercase()] ?: ""

    /** Убирает из имени всё, что нельзя в имени файла Android; обрезает до 150 символов, сохраняя расширение. */
    fun safeName(source: String?): String {
        var name = (source ?: "").replace(Regex("[\\\\/:*?\"<>|\\u0000-\\u001F]"), "_").trim().trim('.')
        if (name.isEmpty()) name = "file"
        if (name.length > 150) {
            val ext = name.substringAfterLast('.', "")
            val base = name.substringBeforeLast('.', name)
            name = if (ext.isNotEmpty() && ext.length <= 10) base.take(140 - ext.length) + "." + ext else name.take(150)
        }
        return name
    }

    /** Имя файла: Content-Disposition → последний сегмент адреса → «file»; без расширения — достраивается по Content-Type. */
    fun pickFileName(contentDisposition: String?, url: String, mime: String?): String {
        var name = safeName(parseContentDisposition(contentDisposition) ?: nameFromUrl(url) ?: "file")
        if (!name.substringAfterLast('/').contains('.')) {
            val ext = extForMime(mime)
            if (ext.isNotEmpty()) name = "$name.$ext"
        }
        return name
    }

    /** Свободное имя: «имя.ext», затем «имя (1).ext», «имя (2).ext»… [exists] — занято ли имя в папке. */
    fun uniqueName(name: String, exists: (String) -> Boolean): String {
        if (!exists(name)) return name
        val dot = name.lastIndexOf('.')
        val hasExt = dot > 0 && dot < name.length - 1
        val base = if (hasExt) name.substring(0, dot) else name
        val ext = if (hasExt) name.substring(dot) else ""
        var n = 1
        while (n < 10_000) {
            val c = "$base ($n)$ext"
            if (!exists(c)) return c
            n++
        }
        return "$base (${System.currentTimeMillis()})$ext"
    }

    // ---------- подписи острова ----------

    private fun num(v: Double): String {
        if (v >= 100.0) return Math.round(v).toString()
        val t = Math.round(v * 10.0)
        return if (t % 10L == 0L) (t / 10L).toString() else (t / 10L).toString() + "," + (t % 10L).toString()
    }

    private const val KB = 1024.0
    private const val MB = 1024.0 * 1024.0
    private const val GB = 1024.0 * 1024.0 * 1024.0

    /** «12,4 МБ», «512 КБ», «1,2 ГБ». */
    fun formatSize(bytes: Long): String {
        val b = bytes.coerceAtLeast(0L).toDouble()
        return when {
            b >= GB -> num(b / GB) + " ГБ"
            b >= MB -> num(b / MB) + " МБ"
            b >= KB -> num(b / KB) + " КБ"
            else -> bytes.coerceAtLeast(0L).toString() + " Б"
        }
    }

    /** «12,4 из 80 МБ» (единица по общему размеру); размер неизвестен — просто «12,4 МБ». */
    fun formatProgress(done: Long, total: Long): String {
        if (total <= 0L) return formatSize(done)
        val (div, unit) = when {
            total >= GB -> GB to "ГБ"
            total >= MB -> MB to "МБ"
            total >= KB -> KB to "КБ"
            else -> 1.0 to "Б"
        }
        return num(done.coerceAtLeast(0L) / div) + " из " + num(total / div) + " " + unit
    }

    /** «3,2 МБ/с». */
    fun formatSpeed(bytesPerSec: Long): String = formatSize(bytesPerSec) + "/с"

    /** Процент готовности 0…100; размер неизвестен — -1. */
    fun percent(done: Long, total: Long): Int =
        if (total <= 0L) -1 else (done.coerceAtLeast(0L) * 100L / total).toInt().coerceIn(0, 100)

    /** «1 поток», «4 потока», «5 потоков». */
    fun threadsText(n: Int): String {
        val m10 = n % 10
        val m100 = n % 100
        val w = if (m10 == 1 && m100 != 11) "поток" else if (m10 in 2..4 && m100 !in 12..14) "потока" else "потоков"
        return "$n $w"
    }

    // ---------- скорость ----------

    /** Скользящее среднее скорости за окно [windowMs] (ТЗ 7.1: ≈3 с). */
    class SpeedMeter(private val windowMs: Long = 3000L) {
        private val times = ArrayDeque<Long>()
        private val bytes = ArrayDeque<Long>()

        @Synchronized
        fun add(nowMs: Long, totalBytes: Long) {
            times.addLast(nowMs)
            bytes.addLast(totalBytes)
            while (times.size > 2 && nowMs - times.peekFirst() > windowMs) {
                times.pollFirst()
                bytes.pollFirst()
            }
        }

        /** Байт в секунду по первому и последнему замеру окна; 0 — замеров мало. */
        @Synchronized
        fun perSec(): Long {
            if (times.size < 2) return 0L
            val dt = times.peekLast() - times.peekFirst()
            val db = bytes.peekLast() - bytes.peekFirst()
            return if (dt <= 0L || db <= 0L) 0L else db * 1000L / dt
        }

        @Synchronized
        fun reset() {
            times.clear()
            bytes.clear()
        }
    }
}

/**
 * Служебный файл `<имя>.part.json` рядом с недокачанным файлом: размер, метка версии файла на сервере (ETag / Last-Modified),
 * границы частей и сколько байт каждой уже записано. Простой текстовый формат (не JSON): разбирается без Android.
 */
class PartMeta(val total: Long, val etag: String, val parts: List<DownloadLogic.Range>, val done: LongArray) {

    fun serialize(): String {
        val sb = StringBuilder()
        sb.append("v1\n")
        sb.append("total=").append(total).append('\n')
        sb.append("etag=").append(etag.replace('\n', ' ').replace('\r', ' ')).append('\n')
        sb.append("parts=").append(parts.size).append('\n')
        for ((i, r) in parts.withIndex()) sb.append('p').append(i).append('=').append(r.start).append(',').append(r.end).append(',').append(done.getOrElse(i) { 0L }).append('\n')
        return sb.toString()
    }

    companion object {
        /** null — файл пустой, чужого вида или повреждён. */
        fun parse(text: String?): PartMeta? {
            if (text.isNullOrBlank()) return null
            val lines = text.lines()
            if (lines.firstOrNull()?.trim() != "v1") return null
            var total = -1L
            var etag = ""
            var count = -1
            val ranges = HashMap<Int, DownloadLogic.Range>()
            val dn = HashMap<Int, Long>()
            for (ln in lines.drop(1)) {
                val k = ln.substringBefore('=', "")
                val v = ln.substringAfter('=', "")
                when {
                    k == "total" -> total = v.trim().toLongOrNull() ?: return null
                    k == "etag" -> etag = v
                    k == "parts" -> count = v.trim().toIntOrNull() ?: return null
                    k.length > 1 && k[0] == 'p' -> {
                        val i = k.substring(1).toIntOrNull() ?: return null
                        val f = v.split(',')
                        if (f.size != 3) return null
                        val s = f[0].trim().toLongOrNull() ?: return null
                        val e = f[1].trim().toLongOrNull() ?: return null
                        val d = f[2].trim().toLongOrNull() ?: return null
                        if (s < 0 || e < s || d < 0 || d > e - s + 1) return null
                        ranges[i] = DownloadLogic.Range(s, e)
                        dn[i] = d
                    }
                }
            }
            if (count < 0 || ranges.size != count) return null
            val parts = ArrayList<DownloadLogic.Range>(count)
            val done = LongArray(count)
            for (i in 0 until count) {
                parts.add(ranges[i] ?: return null)
                done[i] = dn[i] ?: 0L
            }
            return PartMeta(total, etag, parts, done)
        }
    }
}
