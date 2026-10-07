package com.app.lifetracker

import android.os.SystemClock
import android.util.Log
import org.json.JSONArray
import org.json.JSONObject
import java.io.BufferedInputStream
import java.io.File
import java.io.FileInputStream
import java.io.FileOutputStream
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest
import java.util.concurrent.atomic.AtomicBoolean
import java.util.zip.ZipEntry
import java.util.zip.ZipInputStream
import java.util.zip.ZipOutputStream

/**
 * Live-update веб-части (ПЕРЕЕЗД_В_APK.md, 6.5). Своя реализация, без сторонних плагинов.
 *
 * Как это работает:
 *  1. Проверка: скачивается version.json из последнего GitHub Release ({version, url, sha256}).
 *  2. Если версия новее известных (встроенной, активной, ожидающей), zip скачивается в фоне, проверяется sha256,
 *     распаковывается в files/web/<версия>.tmp (с защитой от zip-slip), проверяется и атомарно переименовывается
 *     в files/web/<версия>. Версия записывается как «ожидающая» (pending). Работающая страница не меняется.
 *  3. При СЛЕДУЮЩЕМ запуске (startLaunch) ожидающая версия становится активной и идёт «пробным» запуском (trial).
 *     Страница после старта вызывает LifeTrackerNative.appReady(версия), и пробный запуск подтверждается.
 *  4. Если подтверждения нет (следующий запуск застаёт неподтверждённую пробную версию, либо сработал сторож в
 *     MainActivity), версия помечается неудачной (bad), указатель откатывается на последнюю рабочую (lastGood),
 *     а при её отсутствии на встроенный бандл из assets/www/.
 *  5. Хранятся только активная, последняя рабочая и ожидающая версии, остальные папки удаляются.
 *
 * Состояние: files/web/state.json (запись атомарная). Данные приложения (localStorage, IndexedDB, OPFS) не
 * затрагиваются: адрес https://localhost не меняется (см. WebAssetServer.HOST).
 */
class WebUpdater(
    private val webRoot: File,
    private val builtinVersionProvider: () -> String?,
    private val guardBusy: Boolean = true
) {

    class State(
        var active: String? = null,
        var lastGood: String? = null,
        var pending: String? = null,
        var trial: String? = null,
        val bad: MutableList<String> = mutableListOf()
    )

    companion object {
        private const val TAG = "WebUpdater"

        // Репозиторий зашит намеренно: адрес архива из version.json принимается только отсюда.
        const val REPO = "monstera90/bible-tracker"
        const val VERSION_URL = "https://github.com/$REPO/releases/latest/download/version.json"
        const val ZIP_URL_PREFIX = "https://github.com/$REPO/releases/download/"

        const val MIN_CHECK_GAP_MS = 15L * 60L * 1000L
        const val MAX_ZIP_BYTES = 40L * 1024L * 1024L
        const val MAX_UNPACKED_BYTES = 120L * 1024L * 1024L
        const val MAX_ENTRIES = 1000
        const val MAX_BAD = 20
        private const val CONNECT_TIMEOUT_MS = 15_000
        private const val READ_TIMEOUT_MS = 30_000

        private val VERSION_RE = Regex("^v[0-9]+(\\.[0-9]+){1,3}$")
        private val SHA_RE = Regex("^[0-9a-f]{64}$")

        private val LOCK = Any()
        private val busy = AtomicBoolean(false)

        @Volatile
        private var lastCheckAt = 0L

        @Volatile
        var lastResult: String = "проверок ещё не было"
            private set

        /** "0.38.41" и "V0.38.41" приводятся к "v0.38.41"; всё, что не похоже на версию, даёт null. */
        fun normalizeVersion(raw: String?): String? {
            val t = raw?.trim()?.lowercase() ?: return null
            if (t.isEmpty()) return null
            val v = if (t.startsWith("v")) t else "v$t"
            return if (VERSION_RE.matches(v)) v else null
        }

        /** Сравнение по числам: v0.38.9 < v0.38.10. */
        fun compareVersions(a: String, b: String): Int {
            val pa = a.removePrefix("v").split('.').map { it.toIntOrNull() ?: 0 }
            val pb = b.removePrefix("v").split('.').map { it.toIntOrNull() ?: 0 }
            val n = maxOf(pa.size, pb.size)
            for (i in 0 until n) {
                val x = if (i < pa.size) pa[i] else 0
                val y = if (i < pb.size) pb[i] else 0
                if (x != y) return x.compareTo(y)
            }
            return 0
        }

        private fun sha256Hex(bytes: ByteArray): String =
            MessageDigest.getInstance("SHA-256").digest(bytes).joinToString("") { "%02x".format(it) }
    }

    /** Версия бандла, который отдаёт WebAssetServer в этом запуске (null = встроенный). */
    @Volatile
    private var served: String? = null

    // ---------------------------------------------------------------- состояние

    private fun dir(name: String): File = File(webRoot, name)

    private fun load(): State {
        val s = State()
        try {
            val f = File(webRoot, "state.json")
            if (f.isFile) {
                val o = JSONObject(f.readText(Charsets.UTF_8))
                s.active = normalizeVersion(o.optString("active", ""))
                s.lastGood = normalizeVersion(o.optString("lastGood", ""))
                s.pending = normalizeVersion(o.optString("pending", ""))
                s.trial = normalizeVersion(o.optString("trial", ""))
                val arr = o.optJSONArray("bad")
                if (arr != null) {
                    for (i in 0 until arr.length()) {
                        val v = normalizeVersion(arr.optString(i))
                        if (v != null && !s.bad.contains(v)) s.bad.add(v)
                    }
                }
            }
        } catch (e: Exception) {
            // Битый файл состояния: считаем, что скачанных бандлов нет (работает встроенный).
        }
        return s
    }

    private fun save(s: State) {
        webRoot.mkdirs()
        while (s.bad.size > MAX_BAD) s.bad.removeAt(0)
        val o = JSONObject()
            .put("active", s.active ?: "")
            .put("lastGood", s.lastGood ?: "")
            .put("pending", s.pending ?: "")
            .put("trial", s.trial ?: "")
            .put("bad", JSONArray(s.bad))
        val tmp = File(webRoot, "state.json.tmp")
        val dst = File(webRoot, "state.json")
        tmp.writeText(o.toString(), Charsets.UTF_8)
        if (!tmp.renameTo(dst)) {
            dst.delete()
            if (!tmp.renameTo(dst)) throw IOException("не удалось записать state.json")
        }
    }

    private fun addBad(s: State, version: String) {
        if (!s.bad.contains(version)) s.bad.add(version)
    }

    private fun isValidBundle(d: File): Boolean =
        d.isDirectory && File(d, "index.html").isFile && File(d, "my.js").isFile && File(d, "version.json").isFile

    private fun readVersionFile(f: File): String? = try {
        normalizeVersion(JSONObject(f.readText(Charsets.UTF_8)).optString("version", ""))
    } catch (e: Exception) {
        null
    }

    // ---------------------------------------------------------------- запуск приложения

    /**
     * Вызывается один раз при создании Activity, ДО загрузки страницы. Применяет ожидающую версию, откатывает
     * неподтверждённую пробную и возвращает папку бандла, который надо раздавать (null = встроенный из assets).
     */
    fun startLaunch(): File? = synchronized(LOCK) {
        val s = load()
        val builtin = builtinVersionProvider()

        // Встроенный бандл не старше скачанных: после установки нового APK скачанное не должно откатывать веб.
        fun obsolete(v: String?): Boolean = v != null && builtin != null && compareVersions(v, builtin) <= 0
        if (obsolete(s.active)) s.active = null
        if (obsolete(s.lastGood)) s.lastGood = null
        if (obsolete(s.pending)) s.pending = null
        if (s.trial != null && s.trial != s.active) s.trial = null

        // Неподтверждённая пробная версия с прошлого запуска: откат.
        val failed = s.trial
        if (failed != null) {
            addBad(s, failed)
            if (s.active == failed) s.active = s.lastGood
            s.trial = null
        }

        val activeNow = s.active
        if (activeNow != null && !isValidBundle(dir(activeNow))) s.active = null
        val goodNow = s.lastGood
        if (goodNow != null && !isValidBundle(dir(goodNow))) s.lastGood = null

        // Ожидающая версия становится активной и идёт пробным запуском.
        val p = s.pending
        if (p != null) {
            s.pending = null
            val cur = s.active
            val newer = cur == null || compareVersions(p, cur) > 0
            if (!s.bad.contains(p) && newer && isValidBundle(dir(p))) {
                s.lastGood = s.active
                s.active = p
                s.trial = p
            }
        }

        cleanup(s)
        try {
            save(s)
        } catch (e: Exception) {
            Log.w(TAG, "не удалось записать состояние: ${e.message}")
        }
        served = s.active
        s.active?.let { dir(it) }
    }

    /** Страница сообщает, что запустилась. Подтверждает пробный запуск, если версия совпадает с раздаваемой. */
    fun confirm(version: String?): Boolean = synchronized(LOCK) {
        val v = normalizeVersion(version) ?: return false
        val s = load()
        if (s.trial == null || s.trial != v || served != v) return false
        s.trial = null
        try {
            save(s)
        } catch (e: Exception) {
            return false
        }
        true
    }

    /** true, если в этом запуске идёт пробный запуск скачанной версии (ждём appReady). */
    fun hasTrial(): Boolean = synchronized(LOCK) {
        val s = load()
        s.trial != null && s.trial == served
    }

    /** Сторож: подтверждения нет слишком долго. Версия помечается неудачной, указатель откатывается. */
    fun failTrial(): Boolean = synchronized(LOCK) {
        val s = load()
        val t = s.trial ?: return false
        if (served != t) return false
        addBad(s, t)
        if (s.active == t) s.active = s.lastGood
        s.trial = null
        try {
            save(s)
        } catch (e: Exception) {
            return false
        }
        true
    }

    /** Оставляет только активную, последнюю рабочую и ожидающую версии; остальное (в т.ч. хвосты загрузок) удаляет. */
    private fun cleanup(s: State) {
        if (guardBusy && busy.get()) return
        val keep = setOfNotNull(s.active, s.lastGood, s.pending)
        val children = webRoot.listFiles() ?: return
        for (f in children) {
            val n = f.name
            if (n == "state.json") continue
            if (f.isDirectory && keep.contains(n)) continue
            f.deleteRecursively()
        }
    }

    // ---------------------------------------------------------------- проверка и загрузка

    /** Запускает проверку в отдельном потоке (не чаще раза в MIN_CHECK_GAP_MS, если не force). */
    fun checkInBackground(force: Boolean = false) {
        if (busy.get()) return
        if (!force && lastCheckAt != 0L && SystemClock.elapsedRealtime() - lastCheckAt < MIN_CHECK_GAP_MS) return
        val t = Thread({
            Thread.currentThread().priority = Thread.MIN_PRIORITY
            checkAndDownload(force)
        }, "web-updater")
        t.isDaemon = true
        t.start()
    }

    /** Синхронная проверка и загрузка (вызывать не из главного потока). Возвращает текст результата. */
    fun checkAndDownload(force: Boolean): String {
        if (!busy.compareAndSet(false, true)) return "проверка уже идёт"
        try {
            val now = SystemClock.elapsedRealtime()
            if (!force && lastCheckAt != 0L && now - lastCheckAt < MIN_CHECK_GAP_MS) {
                return "пропущено: проверяли недавно"
            }
            lastCheckAt = now
            val result = try {
                doCheck()
            } catch (e: Exception) {
                "ошибка: ${e.message ?: e.javaClass.simpleName}"
            }
            lastResult = result
            Log.i(TAG, result)
            return result
        } finally {
            busy.set(false)
        }
    }

    private fun doCheck(): String {
        webRoot.mkdirs()
        val info = JSONObject(fetchText(VERSION_URL, 64 * 1024))
        val ver = normalizeVersion(info.optString("version", ""))
            ?: throw IOException("в version.json нет корректной версии")
        val url = info.optString("url", "")
        if (!url.startsWith(ZIP_URL_PREFIX) || !url.endsWith(".zip") || url.any { it.isWhitespace() }) {
            throw IOException("адрес архива не из $ZIP_URL_PREFIX")
        }
        val sha = info.optString("sha256", "").trim().lowercase()
        if (!SHA_RE.matches(sha)) throw IOException("в version.json нет корректного sha256")

        val s = synchronized(LOCK) { load() }
        var known: String? = null
        for (v in listOfNotNull(builtinVersionProvider(), s.active, s.pending)) {
            val k = known
            if (k == null || compareVersions(v, k) > 0) known = v
        }
        val knownNow = known
        if (knownNow != null && compareVersions(ver, knownNow) <= 0) {
            return "актуально: у приложения $knownNow, на GitHub $ver"
        }
        if (s.bad.contains(ver)) return "версия $ver уже не запустилась на этом телефоне, пропускаем"

        val part = File(webRoot, "$ver.zip.part")
        try {
            val actual = download(url, part)
            if (actual != sha) throw IOException("sha256 не совпал (скачано $actual, ожидалось $sha)")
            installFromZip(part, ver)
        } finally {
            part.delete()
        }
        synchronized(LOCK) {
            val st = load()
            st.pending = ver
            save(st)
        }
        return "скачано $ver, применится при следующем запуске"
    }

    private fun open(url: String): HttpURLConnection {
        val c = URL(url).openConnection() as HttpURLConnection
        c.connectTimeout = CONNECT_TIMEOUT_MS
        c.readTimeout = READ_TIMEOUT_MS
        c.instanceFollowRedirects = true
        c.useCaches = false
        c.setRequestProperty("User-Agent", "LifeTracker-WebUpdater")
        c.setRequestProperty("Accept", "*/*")
        return c
    }

    private fun fetchText(url: String, limit: Int): String {
        val c = open(url)
        try {
            val code = c.responseCode
            if (code != 200) throw IOException("HTTP $code при запросе version.json")
            val out = java.io.ByteArrayOutputStream()
            c.inputStream.use { input ->
                val buf = ByteArray(8 * 1024)
                while (true) {
                    val n = input.read(buf)
                    if (n < 0) break
                    out.write(buf, 0, n)
                    if (out.size() > limit) throw IOException("version.json слишком большой")
                }
            }
            return out.toString("UTF-8")
        } finally {
            c.disconnect()
        }
    }

    /** Скачивает файл, считая SHA-256 на лету. Возвращает хэш (hex, нижний регистр). */
    private fun download(url: String, target: File): String {
        val c = open(url)
        try {
            val code = c.responseCode
            if (code != 200) throw IOException("HTTP $code при скачивании архива")
            val len = c.contentLengthLong
            if (len > MAX_ZIP_BYTES) throw IOException("архив слишком большой ($len байт)")
            val md = MessageDigest.getInstance("SHA-256")
            var total = 0L
            c.inputStream.use { input ->
                FileOutputStream(target).use { out ->
                    val buf = ByteArray(64 * 1024)
                    while (true) {
                        val n = input.read(buf)
                        if (n < 0) break
                        total += n
                        if (total > MAX_ZIP_BYTES) throw IOException("архив больше ${MAX_ZIP_BYTES / 1048576} МБ")
                        md.update(buf, 0, n)
                        out.write(buf, 0, n)
                    }
                }
            }
            return md.digest().joinToString("") { "%02x".format(it) }
        } finally {
            c.disconnect()
        }
    }

    // ---------------------------------------------------------------- распаковка

    /**
     * Распаковывает zip в files/web/<версия>.tmp, проверяет содержимое и атомарно переименовывает в files/web/<версия>.
     * При любой ошибке временная папка удаляется, а исключение пробрасывается: ничего не меняется.
     */
    private fun installFromZip(zip: File, version: String) {
        val tmp = File(webRoot, "$version.tmp")
        val fin = File(webRoot, version)
        tmp.deleteRecursively()
        try {
            extractZip(zip, tmp)
            if (!isValidBundle(tmp)) throw IOException("в архиве нет index.html, my.js или version.json в корне")
            val inside = readVersionFile(File(tmp, "version.json"))
            if (inside != version) throw IOException("версия внутри архива ($inside) не совпадает с заявленной ($version)")
            fin.deleteRecursively()
            if (!tmp.renameTo(fin)) throw IOException("не удалось переименовать папку бандла")
        } catch (e: Exception) {
            tmp.deleteRecursively()
            throw e
        }
    }

    private fun extractZip(zip: File, dest: File) {
        dest.deleteRecursively()
        if (!dest.mkdirs()) throw IOException("не удалось создать папку ${dest.name}")
        val destCanon = dest.canonicalPath
        var total = 0L
        var count = 0
        ZipInputStream(BufferedInputStream(FileInputStream(zip))).use { zin ->
            while (true) {
                val e: ZipEntry = zin.nextEntry ?: break
                count++
                if (count > MAX_ENTRIES) throw IOException("в архиве слишком много файлов")
                val name = e.name
                if (name.isEmpty() || name.startsWith("/") || name.contains('\\') || name.contains('\u0000') ||
                    name.split('/').any { it == ".." }
                ) {
                    throw IOException("недопустимый путь в архиве: $name")
                }
                val out = File(dest, name)
                val canon = out.canonicalPath
                if (canon != destCanon && !canon.startsWith(destCanon + File.separator)) {
                    throw IOException("путь выходит за пределы папки (zip-slip): $name")
                }
                if (e.isDirectory) {
                    out.mkdirs()
                    continue
                }
                out.parentFile?.mkdirs()
                FileOutputStream(out).use { fo ->
                    val buf = ByteArray(64 * 1024)
                    while (true) {
                        val n = zin.read(buf)
                        if (n < 0) break
                        total += n
                        if (total > MAX_UNPACKED_BYTES) throw IOException("распакованный бандл слишком большой")
                        fo.write(buf, 0, n)
                    }
                }
            }
        }
        if (count == 0) throw IOException("пустой архив")
    }

    // ---------------------------------------------------------------- диагностика

    /** JSON для страницы диагностики. */
    fun describe(): String {
        val s = synchronized(LOCK) { load() }
        return JSONObject()
            .put("builtin", builtinVersionProvider() ?: "")
            .put("served", served ?: "встроенный")
            .put("active", s.active ?: "")
            .put("lastGood", s.lastGood ?: "")
            .put("pending", s.pending ?: "")
            .put("trial", s.trial ?: "")
            .put("bad", JSONArray(s.bad))
            .put("busy", busy.get())
            .put("lastResult", lastResult)
            .toString()
    }

    private fun writeZip(target: File, entries: List<Pair<String, String>>) {
        ZipOutputStream(FileOutputStream(target)).use { zout ->
            for ((name, text) in entries) {
                zout.putNextEntry(ZipEntry(name))
                zout.write(text.toByteArray(Charsets.UTF_8))
                zout.closeEntry()
            }
        }
    }

    private fun writeTestBundle(d: File, version: String) {
        d.mkdirs()
        File(d, "index.html").writeText("<html></html>")
        File(d, "my.js").writeText("// test")
        File(d, "version.json").writeText("{\"version\":\"$version\"}")
    }

    /**
     * Самотест на устройстве, без сети и без влияния на настоящее состояние (работает в files/web-selftest):
     * цикл обновления, откат без подтверждения (на предыдущую версию и на встроенную), сторож, устаревшие скачанные
     * бандлы, битый и вредный zip, сравнение версий и SHA-256. Возвращает текст с ✅/❌ по строкам.
     */
    fun selfTest(): String {
        val log = StringBuilder()
        var failed = 0
        fun ck(ok: Boolean, name: String, detail: String = "") {
            if (!ok) failed++
            log.append(if (ok) "✅ " else "❌ ").append(name)
            if (detail.isNotEmpty()) log.append(" — ").append(detail)
            log.append('\n')
        }

        val root = File(webRoot.parentFile ?: webRoot, "web-selftest")
        root.deleteRecursively()
        root.mkdirs()
        var n = 0
        fun fresh(builtin: String): WebUpdater {
            n++
            val w = File(root, "w$n")
            w.mkdirs()
            return WebUpdater(w, { builtin }, false)
        }

        try {
            // Версии и хэш.
            ck(compareVersions("v0.38.9", "v0.38.10") < 0 && compareVersions("v0.39.0", "v0.38.99") > 0 &&
                compareVersions("v0.38.40", "v0.38.40") == 0, "сравнение версий по числам")
            ck(normalizeVersion("0.38.41") == "v0.38.41" && normalizeVersion("v0.38.41") == "v0.38.41" &&
                normalizeVersion("../x") == null && normalizeVersion("v1") == null, "разбор номера версии")
            ck(sha256Hex("abc".toByteArray()) == "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
                "SHA-256")

            // 1. Без скачанных бандлов работает встроенный.
            val t1 = fresh("v0.38.40")
            ck(t1.startLaunch() == null, "без скачанных версий раздаётся встроенный бандл")

            // 2. Нормальный цикл: ожидающая версия включается пробно и подтверждается.
            t1.writeTestBundle(File(t1.webRoot, "v0.38.41"), "v0.38.41")
            var s = t1.load()
            s.pending = "v0.38.41"
            t1.save(s)
            var d = t1.startLaunch()
            s = t1.load()
            ck(d?.name == "v0.38.41" && s.active == "v0.38.41" && s.trial == "v0.38.41" && s.pending == null,
                "ожидающая версия включается при следующем запуске (пробный запуск)")
            ck(!t1.confirm("v0.38.42"), "appReady с чужой версией игнорируется")
            ck(t1.confirm("v0.38.41"), "appReady подтверждает пробный запуск")
            d = t1.startLaunch()
            s = t1.load()
            ck(d?.name == "v0.38.41" && s.trial == null && s.bad.isEmpty(), "подтверждённая версия остаётся активной")

            // 3. Откат без подтверждения: на предыдущую рабочую версию.
            t1.writeTestBundle(File(t1.webRoot, "v0.38.42"), "v0.38.42")
            s = t1.load()
            s.pending = "v0.38.42"
            t1.save(s)
            d = t1.startLaunch()
            ck(d?.name == "v0.38.42", "новая версия 0.38.42 включена пробно")
            d = t1.startLaunch() // следующий запуск, appReady не было
            s = t1.load()
            ck(d?.name == "v0.38.41" && s.active == "v0.38.41" && s.bad.contains("v0.38.42") &&
                !File(t1.webRoot, "v0.38.42").exists(), "без подтверждения откат на предыдущую версию, неудачная помечена и удалена")

            // 4. Откат на встроенный бандл, если предыдущей скачанной нет.
            val t2 = fresh("v0.38.40")
            t2.writeTestBundle(File(t2.webRoot, "v0.38.41"), "v0.38.41")
            s = t2.load()
            s.pending = "v0.38.41"
            t2.save(s)
            t2.startLaunch()
            d = t2.startLaunch()
            s = t2.load()
            ck(d == null && s.active == null && s.bad.contains("v0.38.41"), "без предыдущей версии откат на встроенный бандл")

            // 5. Сторож (долгое отсутствие appReady).
            val t3 = fresh("v0.38.40")
            t3.writeTestBundle(File(t3.webRoot, "v0.38.41"), "v0.38.41")
            s = t3.load()
            s.pending = "v0.38.41"
            t3.save(s)
            t3.startLaunch()
            ck(t3.hasTrial(), "пробный запуск виден сторожу")
            ck(t3.failTrial(), "сторож откатывает версию")
            d = t3.startLaunch()
            ck(d == null && t3.load().bad.contains("v0.38.41"), "после сторожа раздаётся встроенный бандл")

            // 6. Скачанная версия не новее встроенной (после установки нового APK) отбрасывается.
            val t4 = fresh("v0.38.45")
            t4.writeTestBundle(File(t4.webRoot, "v0.38.41"), "v0.38.41")
            s = t4.load()
            s.active = "v0.38.41"
            t4.save(s)
            d = t4.startLaunch()
            ck(d == null && t4.load().active == null && !File(t4.webRoot, "v0.38.41").exists(),
                "новый APK со встроенной 0.38.45 не откатывается на скачанную 0.38.41")

            // 7. Битый, обрезанный и вредный zip.
            val zips = File(root, "zips")
            zips.mkdirs()
            // Случайные буквы почти не сжимаются, поэтому обрезка архива пополам попадает внутрь данных.
            val rnd = java.util.Random(42)
            val noise = StringBuilder()
            for (i in 0 until 30000) noise.append('a' + rnd.nextInt(26))
            val good = File(zips, "good.zip")
            writeZip(good, listOf(
                "index.html" to "<html></html>",
                "my.js" to noise.toString(),
                "version.json" to "{\"version\":\"v0.38.50\"}"
            ))
            val t5 = fresh("v0.38.40")
            try {
                t5.installFromZip(good, "v0.38.50")
                ck(t5.isValidBundle(File(t5.webRoot, "v0.38.50")) && !File(t5.webRoot, "v0.38.50.tmp").exists(),
                    "корректный zip распаковывается и переименовывается")
            } catch (e: Exception) {
                ck(false, "корректный zip распаковывается", e.message ?: "")
            }

            val bytes = good.readBytes()
            val cut = File(zips, "cut.zip")
            cut.writeBytes(bytes.copyOf(bytes.size / 2))
            val t6 = fresh("v0.38.40")
            var threw = false
            try {
                t6.installFromZip(cut, "v0.38.50")
            } catch (e: Exception) {
                threw = true
            }
            ck(threw && !File(t6.webRoot, "v0.38.50").exists() && !File(t6.webRoot, "v0.38.50.tmp").exists(),
                "обрезанный zip отклоняется, следов не остаётся")

            val garbage = File(zips, "garbage.zip")
            garbage.writeText("это вообще не zip")
            threw = false
            try {
                t6.installFromZip(garbage, "v0.38.50")
            } catch (e: Exception) {
                threw = true
            }
            ck(threw && !File(t6.webRoot, "v0.38.50").exists(), "не-zip отклоняется")

            val evil = File(zips, "evil.zip")
            writeZip(evil, listOf(
                "index.html" to "x", "my.js" to "x", "version.json" to "{\"version\":\"v0.38.50\"}",
                "../evil.txt" to "zip-slip"
            ))
            threw = false
            try {
                t6.installFromZip(evil, "v0.38.50")
            } catch (e: Exception) {
                threw = true
            }
            ck(threw && !File(t6.webRoot, "evil.txt").exists() && !File(t6.webRoot, "v0.38.50").exists(),
                "zip с путём «..» (zip-slip) отклоняется")

            val wrong = File(zips, "wrongversion.zip")
            writeZip(wrong, listOf("index.html" to "x", "my.js" to "x", "version.json" to "{\"version\":\"v0.38.51\"}"))
            threw = false
            try {
                t6.installFromZip(wrong, "v0.38.50")
            } catch (e: Exception) {
                threw = true
            }
            ck(threw && !File(t6.webRoot, "v0.38.50").exists(), "версия внутри архива не совпала с заявленной: отклонён")

            val noIndex = File(zips, "noindex.zip")
            writeZip(noIndex, listOf("www/index.html" to "x", "my.js" to "x", "version.json" to "{\"version\":\"v0.38.50\"}"))
            threw = false
            try {
                t6.installFromZip(noIndex, "v0.38.50")
            } catch (e: Exception) {
                threw = true
            }
            ck(threw, "zip без index.html в корне отклонён")

            // Файл состояния не повреждён откатами.
            ck(t6.load().pending == null && t6.load().active == null, "после отказов состояние не изменилось")
        } catch (e: Throwable) {
            ck(false, "самотест упал с исключением", e.toString())
        } finally {
            root.deleteRecursively()
        }
        log.append(if (failed == 0) "ИТОГ: всё в порядке\n" else "ИТОГ: ошибок $failed\n")
        return log.toString()
    }
}
