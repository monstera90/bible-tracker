package com.app.lifetracker
// Версия: 1.0 (24.11) — ТЗ «автокоммит fix.zip» (TASK_AUTO_COMMIT.md): перехват скачивания fix.zip во вкладке Claude, настройки и токен, итог тостом.

import android.content.Context
import android.content.SharedPreferences
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.util.Base64
import android.util.Log
import android.webkit.CookieManager
import android.webkit.JavascriptInterface
import android.webkit.WebView
import android.widget.Toast
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.net.HttpURLConnection
import java.net.URL
import java.security.SecureRandom
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.concurrent.Executors

/**
 * Цепочка: вкладка Claude скачивает `fix.zip` → [intercept] забирает байты (blob: / https: / data:) → [GitHubCommit] коммитит в ветку.
 * Всё сразу в ветку, без подтверждений (ТЗ). Итог — тост и строка «Последний результат» в настройках.
 *
 * Токен: API 23+ — EncryptedSharedPreferences (Keystore); API 21–22 — приватные SharedPreferences (androidx.security там недоступна).
 * Токен не уходит в страницу (в веб-часть приходит только флаг «задан»), не пишется в лог, бэкап приложения выключен (allowBackup=false).
 */
object AutoCommit {

    private const val TAG = "AutoCommit"
    private const val PREFS = "autocommit"
    private const val SECURE_PREFS = "autocommit_secure"
    private const val K_ENABLED = "enabled"
    private const val K_OWNER = "owner"
    private const val K_REPO = "repo"
    private const val K_BRANCH = "branch"
    private const val K_TOKEN = "token"
    private const val K_LAST_TIME = "last_time"
    private const val K_LAST_STATUS = "last_status"
    private const val K_LAST_TEXT = "last_text"
    private const val MAX_DOWNLOAD_BYTES = 150L * 1024 * 1024

    private val main = Handler(Looper.getMainLooper())
    private val worker = Executors.newSingleThreadExecutor()

    /** `fix.zip`, а также `fix (1).zip` и `fix-1.zip` (браузер и DownloadManager добавляют номер). */
    private val FIX_NAME = Regex("^fix(?:\\s*\\(\\d+\\)|-\\d+)?\\.zip$", RegexOption.IGNORE_CASE)

    fun isFixZipName(name: String?): Boolean = name != null && FIX_NAME.matches(name.trim())

    // ---------- настройки ----------

    private fun plain(ctx: Context): SharedPreferences = ctx.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    @Volatile private var secureCache: SharedPreferences? = null

    /** null — хранилище токена открыть не удалось (на API 23+ бывают сбои Keystore). В обычные настройки токен тогда не пишем. */
    private fun secure(ctx: Context): SharedPreferences? {
        secureCache?.let { return it }
        synchronized(this) {
            secureCache?.let { return it }
            val app = ctx.applicationContext
            val p: SharedPreferences? = if (Build.VERSION.SDK_INT >= 23) {
                try {
                    val key = androidx.security.crypto.MasterKey.Builder(app)
                        .setKeyScheme(androidx.security.crypto.MasterKey.KeyScheme.AES256_GCM)
                        .build()
                    androidx.security.crypto.EncryptedSharedPreferences.create(
                        app, SECURE_PREFS, key,
                        androidx.security.crypto.EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
                        androidx.security.crypto.EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM
                    )
                } catch (e: Throwable) {
                    Log.w(TAG, "secure prefs unavailable: " + e.javaClass.simpleName)
                    null
                }
            } else {
                app.getSharedPreferences(SECURE_PREFS, Context.MODE_PRIVATE)
            }
            secureCache = p
            return p
        }
    }

    private fun token(ctx: Context): String = try { secure(ctx)?.getString(K_TOKEN, "") ?: "" } catch (e: Throwable) { "" }

    fun enabled(ctx: Context): Boolean = plain(ctx).getBoolean(K_ENABLED, true)

    /** Состояние для страницы: токен не отдаётся, только `tokenSet`. */
    fun stateJson(ctx: Context): String {
        val p = plain(ctx)
        return JSONObject()
            .put("enabled", enabled(ctx))
            .put("owner", p.getString(K_OWNER, "") ?: "")
            .put("repo", p.getString(K_REPO, "") ?: "")
            .put("branch", p.getString(K_BRANCH, "main") ?: "main")
            .put("tokenSet", token(ctx).isNotEmpty())
            .put("secureOk", secure(ctx) != null)
            .put("last", JSONObject()
                .put("time", p.getLong(K_LAST_TIME, 0L))
                .put("status", p.getString(K_LAST_STATUS, "") ?: "")
                .put("text", p.getString(K_LAST_TEXT, "") ?: ""))
            .toString()
    }

    fun save(ctx: Context, owner: String?, repo: String?, branch: String?, enabled: Boolean) {
        val b = branch?.trim().orEmpty().ifEmpty { "main" }
        plain(ctx).edit()
            .putString(K_OWNER, owner?.trim().orEmpty())
            .putString(K_REPO, repo?.trim().orEmpty())
            .putString(K_BRANCH, b)
            .putBoolean(K_ENABLED, enabled)
            .apply()
    }

    fun setToken(ctx: Context, value: String?): Boolean {
        val s = secure(ctx) ?: return false
        return try {
            s.edit().putString(K_TOKEN, value?.trim().orEmpty()).commit()
        } catch (e: Throwable) { false }
    }

    private fun record(ctx: Context, status: String, text: String) {
        plain(ctx).edit().putLong(K_LAST_TIME, System.currentTimeMillis()).putString(K_LAST_STATUS, status).putString(K_LAST_TEXT, text).apply()
    }

    private fun toast(activity: MainActivity, text: String) {
        activity.runOnUiThread {
            try { Toast.makeText(activity, text, Toast.LENGTH_LONG).show() } catch (e: Exception) { }
        }
    }

    private fun fail(activity: MainActivity, reason: String) {
        record(activity, "error", reason)
        toast(activity, "Ошибка: $reason")
    }

    // ---------- перехват скачивания ----------

    /**
     * Вызывается из слушателя скачивания вкладки Claude ([name] — имя файла из заголовка или запомненное страницей).
     * @return true — файл забрало приложение (обычное скачивание не нужно); false — загрузка идёт как раньше.
     */
    fun intercept(
        activity: MainActivity, view: WebView, name: String?, url: String?, userAgent: String?, mime: String?, cookies: CookieManager
    ): Boolean {
        if (!isFixZipName(name)) return false
        // Временный лог (ТЗ, раздел 1): какой из способов реально приходит — только схема и хост, без пути и параметров.
        Log.d(TAG, "fix.zip: scheme=" + schemeOf(url) + " host=" + hostOf(url) + " mime=" + mime + " sdk=" + Build.VERSION.SDK_INT)
        if (!enabled(activity) || url.isNullOrBlank()) return false
        if (token(activity).isEmpty()) {
            toast(activity, "Задайте токен GitHub в настройках")
            return false
        }
        val u = url.trim()
        val got = { bytes: ByteArray?, err: String? ->
            if (bytes == null) fail(activity, err ?: "не удалось получить файл") else worker.execute { process(activity, bytes) }
        }
        when {
            u.startsWith("blob:", ignoreCase = true) -> {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) PageDownloads.fetchBlobBytes(activity, view, u, MAX_DOWNLOAD_BYTES, got)
                else LegacyBlob.fetch(view, u, MAX_DOWNLOAD_BYTES, got)
            }
            u.startsWith("data:", ignoreCase = true) -> worker.execute {
                val d = try { PageDownloadLogic.parseDataUrl(u) } catch (e: Exception) { null }
                if (d == null) got(null, "ссылка data: повреждена") else got(d.bytes, null)
            }
            u.startsWith("http://", ignoreCase = true) || u.startsWith("https://", ignoreCase = true) -> worker.execute {
                try {
                    got(downloadHttp(u, userAgent, cookies), null)
                } catch (e: java.net.UnknownHostException) {
                    got(null, "нет сети")
                } catch (e: java.net.SocketTimeoutException) {
                    got(null, "нет сети (таймаут)")
                } catch (e: Exception) {
                    got(null, "скачивание fix.zip не удалось: " + (e.message ?: e.javaClass.simpleName))
                }
            }
            else -> return false
        }
        return true
    }

    private fun schemeOf(url: String?): String = url?.substringBefore(':', "")?.lowercase() ?: ""
    private fun hostOf(url: String?): String = try { URL(url).host } catch (e: Exception) { "" }

    /** Обычная ссылка: байты напрямую, с cookie WebView и тем же user-agent (адрес закрыт входом на claude.ai). */
    private fun downloadHttp(url: String, userAgent: String?, cookies: CookieManager): ByteArray {
        val conn = URL(url).openConnection() as HttpURLConnection
        try {
            conn.connectTimeout = 20_000
            conn.readTimeout = 60_000
            conn.instanceFollowRedirects = true
            val ck = try { cookies.getCookie(url) } catch (e: Exception) { null }
            if (!ck.isNullOrBlank()) conn.setRequestProperty("Cookie", ck)
            if (!userAgent.isNullOrBlank()) conn.setRequestProperty("User-Agent", userAgent)
            val code = conn.responseCode
            if (code !in 200..299) throw java.io.IOException("HTTP $code")
            val out = ByteArrayOutputStream()
            conn.inputStream.use { ins ->
                val buf = ByteArray(16384)
                while (true) {
                    val n = ins.read(buf)
                    if (n < 0) break
                    out.write(buf, 0, n)
                    if (out.size() > MAX_DOWNLOAD_BYTES) throw java.io.IOException("файл слишком большой")
                }
            }
            return out.toByteArray()
        } finally {
            conn.disconnect()
        }
    }

    // ---------- распаковка и коммит ----------

    private fun process(activity: MainActivity, bytes: ByteArray) {
        val p = plain(activity)
        val owner = p.getString(K_OWNER, "")?.trim().orEmpty()
        val repo = p.getString(K_REPO, "")?.trim().orEmpty()
        val branch = p.getString(K_BRANCH, "main")?.trim().orEmpty().ifEmpty { "main" }
        val tk = token(activity)
        if (tk.isEmpty()) { fail(activity, "не задан токен GitHub"); return }
        if (owner.isEmpty() || repo.isEmpty()) { fail(activity, "в настройках не заданы owner и repo"); return }

        val content = try {
            GitHubCommit.readZip(bytes)
        } catch (e: java.io.IOException) {
            fail(activity, "повреждённый архив (" + (e.message ?: "ошибка чтения") + ")"); return
        } catch (e: Exception) {
            fail(activity, "повреждённый архив"); return
        }
        if (content.entries.isEmpty()) {
            fail(activity, if (content.skipped.isEmpty()) "архив пуст или повреждён" else "в архиве нет допустимых файлов (небезопасных путей: ${content.skipped.size})")
            return
        }
        val message = "fix.zip " + SimpleDateFormat("yyyy-MM-dd HH:mm", Locale.US).format(Date())
        when (val r = GitHubCommit.commit(GitHubCommit.Config(tk, owner, repo, branch), content.entries, message)) {
            is GitHubCommit.Result.Committed -> {
                val skip = if (content.skipped.isEmpty()) "" else "; пропущено небезопасных путей: ${content.skipped.size}"
                record(activity, "ok", "${r.files} файлов, ${r.sha.take(7)}$skip")
                toast(activity, "Закоммичено: ${r.files} файлов" + (if (content.skipped.isEmpty()) "" else "\nПропущено небезопасных путей: ${content.skipped.size}"))
            }
            is GitHubCommit.Result.NothingToCommit -> {
                record(activity, "nothing", "Нечего коммитить")
                toast(activity, "Нечего коммитить")
            }
            is GitHubCommit.Result.Failed -> fail(activity, r.reason)
        }
    }

    // ---------- blob: на Android 5.0–5.1 ----------

    /**
     * На API 21–22 нет `WebMessagePort`, поэтому файл `blob:` отдаётся через узкий `@JavascriptInterface` (ТЗ, раздел 1).
     * Объект ставится во WebView вкладки Claude только на этих версиях, до загрузки страницы ([install]), под случайным именем.
     * Принимает данные лишь для задачи с одноразовым токеном, который приложение вписывает в скрипт; ничего из приложения не отдаёт.
     * JS — ES5 (XMLHttpRequest с responseType = 'blob' + FileReader).
     */
    object LegacyBlob {
        private val random = SecureRandom()
        val NAME: String = "ltfix" + hex(8)

        private class Job(val limit: Long, val cb: (ByteArray?, String?) -> Unit) {
            val buf = ByteArrayOutputStream()
            @Volatile var done = false
            val watchdog = Runnable { finish(null, "страница не отвечает") }

            @Synchronized fun finish(bytes: ByteArray?, err: String?) {
                if (done) return
                done = true
                main.removeCallbacks(watchdog)
                cb(bytes, err)
            }
        }

        private val jobs = HashMap<String, Job>()

        private fun hex(n: Int): String {
            val b = ByteArray(n)
            random.nextBytes(b)
            return b.joinToString("") { "%02x".format(it) }
        }

        fun install(view: WebView) {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) return
            try { view.addJavascriptInterface(Sink(), NAME) } catch (e: Exception) { }
        }

        fun fetch(view: WebView, blobUrl: String, limit: Long, cb: (ByteArray?, String?) -> Unit) {
            val token = hex(16)
            val job = Job(limit, cb)
            synchronized(jobs) { jobs[token] = job }
            main.postDelayed(job.watchdog, 25_000L)
            val js = script(token, blobUrl)
            try {
                view.evaluateJavascript(js, null)
            } catch (e: Exception) {
                synchronized(jobs) { jobs.remove(token) }
                job.finish(null, "не удалось связаться со страницей")
            }
        }

        private fun script(token: String, blobUrl: String): String =
            "(function(){var N=" + PageDownloadLogic.jsString(NAME) + ",T=" + PageDownloadLogic.jsString(token) + ",U=" + PageDownloadLogic.jsString(blobUrl) + ",CH=786432;" +
                "function S(){return window[N];}" +
                "function fail(w){try{S().fail(T,w);}catch(x){}}" +
                "try{var x=new XMLHttpRequest();x.open(\"GET\",U,true);x.responseType=\"blob\";" +
                "x.onload=function(){var b=x.response;if(!b){fail(\"empty\");return;}" +
                "var size=b.size,off=0;try{S().begin(T,String(size));}catch(e){return;}" +
                "function next(){if(off>=size){S().end(T);return;}" +
                "var fr=new FileReader();" +
                "fr.onload=function(){var s=String(fr.result),i=s.indexOf(\",\");S().chunk(T,i>=0?s.slice(i+1):\"\");next();};" +
                "fr.onerror=function(){fail(\"read\");};" +
                "var end=Math.min(off+CH,size);var part=b.slice(off,end);off=end;fr.readAsDataURL(part);}" +
                "next();};" +
                "x.onerror=function(){fail(\"xhr\");};x.send();}catch(e){fail(\"exception\");}})();"

        /** Вызывается из потока JavaBridge. Каждая операция сверяет токен: чужие вызовы с неизвестным токеном игнорируются. */
        private class Sink {
            private fun job(t: String?): Job? = synchronized(jobs) { jobs[t ?: ""] }
            private fun drop(t: String?) { synchronized(jobs) { jobs.remove(t ?: "") } }

            @JavascriptInterface fun begin(t: String?, size: String?) {
                val j = job(t) ?: return
                val n = size?.toLongOrNull() ?: -1L
                if (n > j.limit) { drop(t); j.finish(null, "файл слишком большой") }
            }

            @JavascriptInterface fun chunk(t: String?, b64: String?) {
                val j = job(t) ?: return
                if (j.done) return
                try {
                    val part = Base64.decode(b64 ?: "", Base64.DEFAULT)
                    j.buf.write(part, 0, part.size)
                    if (j.buf.size() > j.limit) { drop(t); j.finish(null, "файл слишком большой") }
                } catch (e: Exception) {
                    drop(t); j.finish(null, "кусок файла повреждён")
                }
            }

            @JavascriptInterface fun end(t: String?) {
                val j = job(t) ?: return
                drop(t)
                j.finish(j.buf.toByteArray(), null)
            }

            @JavascriptInterface fun fail(t: String?, reason: String?) {
                val j = job(t) ?: return
                drop(t)
                j.finish(null, "страница не отдала файл (" + (reason ?: "ошибка") + ")")
            }
        }
    }
}
