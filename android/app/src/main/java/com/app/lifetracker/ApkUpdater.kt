package com.app.lifetracker
// Версия: 1.0 (15.11) — обновление самого APK из GitHub Releases: проверка, скачивание, запуск системного установщика (ТЗ TASK_APK_SELF_UPDATE.md).

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.Settings
import android.util.Log
import androidx.core.content.FileProvider
import androidx.core.content.pm.PackageInfoCompat
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.io.FileOutputStream
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.atomic.AtomicBoolean

/**
 * Обновление самого приложения (не веб-части: её обновляет [WebUpdater]).
 *
 * Как это работает:
 *  1. Проверка: список релизов `https://api.github.com/repos/<REPO>/releases` (не `/latest`: «последним» там остаётся релиз веб-части). Берётся самая
 *     свежая сборка среди релизов с тегом `apk-v*` (не draft, не prerelease): номер сборки — из тега `…-b<номер>` (иначе из «versionCode N» в описании),
 *     файл — первый `.apk` из assets с адресом `https://github.com/<REPO>/releases/download/…`. Номер сравнивается с установленным `versionCode`
 *     (его в workflow задаёт номер запуска: -PversionCode=${{ github.run_number }}).
 *  2. Автопроверка при запуске и возврате в приложение — не чаще раза в [MIN_GAP_MS]; кнопка «Проверка обновлений» проверяет принудительно.
 *     Если сборка новее и о ней ещё не отказывались, MainActivity показывает диалог «Скачать / Позже»; отказ запоминается до выхода следующей сборки.
 *  3. Скачивание в files/apkupdate/ (без DownloadManager: прогресс виден странице), проверка размера и [verify] (тот же пакет, нужный versionCode).
 *  4. Установка: интент ACTION_VIEW через FileProvider. На Android 8+ сначала нужно разрешение «Установка неизвестных приложений»: если его нет,
 *     открываются настройки, пользователь включает и нажимает «Установить» ещё раз. Тихой установки нет: системное подтверждение обязательно.
 * Обновление встанет поверх установленного только при той же подписи (ключ в секретах workflow менять нельзя).
 */
object ApkUpdater {
    private const val TAG = "ApkUpdater"

    private const val API_URL = "https://api.github.com/repos/${WebUpdater.REPO}/releases?per_page=30"
    private const val DOWNLOAD_PREFIX = "https://github.com/${WebUpdater.REPO}/releases/download/"

    const val MIN_GAP_MS = 3L * 60L * 60L * 1000L
    private const val MAX_APK_BYTES = 300L * 1024L * 1024L
    private const val CONNECT_TIMEOUT_MS = 15_000
    private const val READ_TIMEOUT_MS = 30_000
    private const val PREFS = "apk_updater"

    private val BUILD_RE = Regex("-b([0-9]+)$")
    private val CODE_RE = Regex("versionCode\\s+([0-9]+)")
    private val NAME_RE = Regex("^apk-v(.+?)(?:-b[0-9]+)?$")

    /** Найденная в релизах сборка: [build] — её versionCode, [name] — versionName, [size] — байт (0 — неизвестно). */
    class Info(val tag: String, val build: Long, val name: String, val url: String, val size: Long)

    @Volatile
    var latest: Info? = null
        private set

    @Volatile
    var lastResult: String = "проверок ещё не было"
        private set

    /** Сколько проверок завершилось с запуска приложения: страница по нему узнаёт, что проверка кончилась. */
    @Volatile
    var checkSeq: Int = 0
        private set

    @Volatile
    var lastCheckWall: Long = 0L
        private set

    @Volatile
    var downloading: Boolean = false
        private set

    @Volatile
    var downloadedBytes: Long = 0L
        private set

    /** Итог последней попытки установки для страницы: «» (ещё не пробовали), «установщик открыт» или «ошибка: …». */
    @Volatile
    var installNote: String = ""
        private set

    @Volatile
    private var installedCode: Long = 0L

    @Volatile
    private var installedName: String = ""

    private val checking = AtomicBoolean(false)
    private val dlBusy = AtomicBoolean(false)

    private fun prefs(ctx: Context) = ctx.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    private fun loadInstalled(ctx: Context) {
        try {
            val info = ctx.packageManager.getPackageInfo(ctx.packageName, 0)
            installedCode = PackageInfoCompat.getLongVersionCode(info)
            installedName = info.versionName ?: ""
        } catch (e: Exception) {
            // версия установленной сборки неизвестна: любая найденная считается новее
        }
    }

    /** versionCode установленной сборки (0 — не удалось прочитать). */
    fun installedCode(ctx: Context): Long {
        loadInstalled(ctx)
        return installedCode
    }

    // ---------------------------------------------------------------- проверка

    /** Фоновая проверка. [onNewer] вызывается (в фоновом потоке), если найдена сборка новее установленной и о ней ещё не отказывались. */
    fun checkInBackground(ctx: Context, force: Boolean, onNewer: ((Info) -> Unit)? = null) {
        val app = ctx.applicationContext
        if (checking.get()) return
        if (!force) {
            val last = prefs(app).getLong("lastAuto", 0L)
            val now = System.currentTimeMillis()
            if (last != 0L && now >= last && now - last < MIN_GAP_MS) return
        }
        val t = Thread({
            Thread.currentThread().priority = Thread.MIN_PRIORITY
            check(app)
            val l = latest
            if (onNewer != null && l != null && l.build > installedCode && prefs(app).getLong("dismissed", 0L) < l.build) onNewer(l)
        }, "apk-updater")
        t.isDaemon = true
        t.start()
    }

    /** Синхронная проверка (не из главного потока). Возвращает текст результата. */
    fun check(ctx: Context): String {
        if (!checking.compareAndSet(false, true)) return "проверка уже идёт"
        try {
            loadInstalled(ctx)
            val result = try {
                doCheck()
            } catch (e: Exception) {
                "ошибка: ${e.message ?: e.javaClass.simpleName}"
            }
            lastResult = result
            lastCheckWall = System.currentTimeMillis()
            prefs(ctx).edit().putLong("lastAuto", lastCheckWall).apply()
            checkSeq++
            Log.i(TAG, result)
            return result
        } finally {
            checking.set(false)
        }
    }

    private fun doCheck(): String {
        val arr = JSONArray(fetchText(API_URL, 2 * 1024 * 1024))
        var best: Info? = null
        for (i in 0 until arr.length()) {
            val r = arr.optJSONObject(i) ?: continue
            if (r.optBoolean("draft", false) || r.optBoolean("prerelease", false)) continue
            val tag = r.optString("tag_name", "")
            if (!tag.startsWith("apk-v")) continue
            val fromTag = BUILD_RE.find(tag)?.groupValues?.get(1)?.toLongOrNull()
            val fromBody = CODE_RE.find(r.optString("body", ""))?.groupValues?.get(1)?.toLongOrNull()
            val build = fromTag ?: fromBody ?: continue
            val assets = r.optJSONArray("assets") ?: continue
            var url = ""
            var size = 0L
            for (j in 0 until assets.length()) {
                val a = assets.optJSONObject(j) ?: continue
                val n = a.optString("name", "")
                val u = a.optString("browser_download_url", "")
                if (n.endsWith(".apk") && u.startsWith(DOWNLOAD_PREFIX) && u.none { it.isWhitespace() }) {
                    url = u
                    size = a.optLong("size", 0L)
                    break
                }
            }
            if (url.isEmpty()) continue
            val name = NAME_RE.find(tag)?.groupValues?.get(1) ?: tag
            val cur = best
            if (cur == null || build > cur.build) best = Info(tag, build, name, url, size)
        }
        val b = best
        latest = b
        if (b == null) return "в релизах нет сборок приложения (apk-v*)"
        return if (b.build > installedCode) {
            "доступна новая сборка ${b.build} (${b.name}), у вас $installedCode"
        } else {
            "актуально: у вас сборка $installedCode, на GitHub ${b.build}"
        }
    }

    private fun open(url: String): HttpURLConnection {
        val c = URL(url).openConnection() as HttpURLConnection
        c.connectTimeout = CONNECT_TIMEOUT_MS
        c.readTimeout = READ_TIMEOUT_MS
        c.instanceFollowRedirects = true
        c.useCaches = false
        c.setRequestProperty("User-Agent", "LifeTracker-ApkUpdater")
        c.setRequestProperty("Accept", "application/vnd.github+json, application/octet-stream, */*")
        return c
    }

    private fun fetchText(url: String, limit: Int): String {
        val c = open(url)
        try {
            val code = c.responseCode
            if (code != 200) throw IOException("HTTP $code при запросе списка релизов")
            val out = java.io.ByteArrayOutputStream()
            c.inputStream.use { input ->
                val buf = ByteArray(8 * 1024)
                while (true) {
                    val n = input.read(buf)
                    if (n < 0) break
                    out.write(buf, 0, n)
                    if (out.size() > limit) throw IOException("список релизов слишком большой")
                }
            }
            return out.toString("UTF-8")
        } finally {
            c.disconnect()
        }
    }

    // ---------------------------------------------------------------- скачивание и установка

    /** Запомнить отказ от сборки [build]: диалог про неё больше не показывается (кнопка в «Проверке обновлений» работает всегда). */
    fun dismiss(ctx: Context, build: Long) {
        prefs(ctx).edit().putLong("dismissed", build).apply()
    }

    /** Установка разрешена (до Android 8 разрешение глобальное, отдельного запроса нет). */
    fun canInstall(ctx: Context): Boolean =
        Build.VERSION.SDK_INT < Build.VERSION_CODES.O || ctx.packageManager.canRequestPackageInstalls()

    private fun verify(ctx: Context, f: File, build: Long): Boolean {
        val pi = ctx.packageManager.getPackageArchiveInfo(f.absolutePath, 0) ?: return false
        return pi.packageName == ctx.packageName && PackageInfoCompat.getLongVersionCode(pi) == build
    }

    private fun downloadIfNeeded(ctx: Context, info: Info): File {
        val d = File(ctx.filesDir, "apkupdate")
        d.mkdirs()
        val target = File(d, "LifeTracker-${info.build}.apk")
        d.listFiles()?.forEach { if (it.name != target.name) it.delete() } // прежние сборки и недокачанное не копим
        if (target.isFile && (info.size <= 0L || target.length() == info.size) && verify(ctx, target, info.build)) {
            downloadedBytes = target.length()
            return target
        }
        target.delete()
        val part = File(d, target.name + ".part")
        val c = open(info.url)
        try {
            val code = c.responseCode
            if (code != 200) throw IOException("HTTP $code при скачивании")
            var total = 0L
            FileOutputStream(part).use { out ->
                c.inputStream.use { input ->
                    val buf = ByteArray(32 * 1024)
                    while (true) {
                        val n = input.read(buf)
                        if (n < 0) break
                        out.write(buf, 0, n)
                        total += n
                        downloadedBytes = total
                        if (total > MAX_APK_BYTES) throw IOException("файл слишком большой")
                    }
                }
            }
            if (info.size > 0L && total != info.size) throw IOException("скачано $total байт из ${info.size}")
        } catch (e: Exception) {
            part.delete()
            throw e
        } finally {
            c.disconnect()
        }
        if (!part.renameTo(target)) {
            part.delete()
            throw IOException("не удалось сохранить файл")
        }
        if (!verify(ctx, target, info.build)) {
            target.delete()
            throw IOException("скачанный файл не подходит (другой пакет или версия)")
        }
        return target
    }

    private fun launchInstall(activity: Activity, f: File) {
        val uri = FileProvider.getUriForFile(activity, FileSaver.AUTHORITY, f)
        val i = Intent(Intent.ACTION_VIEW)
            .setDataAndType(uri, "application/vnd.android.package-archive")
            .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK)
        activity.startActivity(i)
    }

    /**
     * Скачать найденную сборку и открыть установщик. Возвращает «ok» (скачивание идёт в фоне, ход — в [describe]), «permission» (открыты настройки
     * «Установка неизвестных приложений»: включить и нажать ещё раз) или текст причины отказа.
     */
    fun startInstall(activity: Activity): String {
        val info = latest ?: return "сначала проверьте обновления"
        loadInstalled(activity)
        if (info.build <= installedCode) return "уже установлена последняя сборка"
        if (!canInstall(activity)) {
            installNote = ""
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                activity.runOnUiThread {
                    try {
                        val i = Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + activity.packageName))
                        activity.startActivity(i)
                    } catch (e: Exception) {
                        // настройки не открылись: пользователь включит разрешение вручную
                    }
                }
            }
            return "permission"
        }
        if (!dlBusy.compareAndSet(false, true)) return "уже скачивается"
        downloading = true
        downloadedBytes = 0L
        installNote = ""
        val app = activity.applicationContext
        val t = Thread({
            try {
                val f = downloadIfNeeded(app, info)
                downloading = false
                if (activity.isFinishing) {
                    installNote = "ошибка: приложение закрыто до начала установки, нажмите ещё раз"
                } else {
                    activity.runOnUiThread {
                        try {
                            launchInstall(activity, f)
                            installNote = "установщик открыт"
                        } catch (e: Exception) {
                            installNote = "ошибка: ${e.message ?: e.javaClass.simpleName}"
                        }
                    }
                }
            } catch (e: Exception) {
                installNote = "ошибка: ${e.message ?: e.javaClass.simpleName}"
            } finally {
                downloading = false
                dlBusy.set(false)
            }
        }, "apk-download")
        t.isDaemon = true
        t.start()
        return "ok"
    }

    /** JSON для страницы («Проверка обновлений»). */
    fun describe(ctx: Context): String {
        loadInstalled(ctx)
        val l = latest
        return JSONObject()
            .put("installedCode", installedCode)
            .put("installedName", installedName)
            .put("latestBuild", l?.build ?: 0L)
            .put("latestName", l?.name ?: "")
            .put("latestTag", l?.tag ?: "")
            .put("size", l?.size ?: 0L)
            .put("newer", l != null && l.build > installedCode)
            .put("busy", checking.get())
            .put("downloading", downloading)
            .put("downloaded", downloadedBytes)
            .put("canInstall", canInstall(ctx))
            .put("lastResult", lastResult)
            .put("lastCheckAt", lastCheckWall)
            .put("checkSeq", checkSeq)
            .put("note", installNote)
            .toString()
    }
}
