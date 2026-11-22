package com.app.lifetracker
// Версия: 1.0 (22.11) — ТЗ «скачивание файлов» (TZ_downloads.md 1.1), этап 5: проверки скачанных обновлений (адрес, размер, SHA-256) и перенос готового файла на место без Android — чтобы JVM-тесты проверяли хуки `verify`.

import java.io.File
import java.io.IOException
import java.security.MessageDigest

/**
 * Проверки обновлений приложения (APK и веб-часть), вынесенные из [ApkUpdater] и [WebUpdater] (ТЗ 6.5, 10). Здесь нет Android:
 * [placeAndVerify] — та часть «завершения закачки», что работает только с файлами; её зовёт [DownloadService.finish].
 */
object UpdateChecks {

    /** Адрес разрешён: начинается с [prefix], без пробелов и (если задан) оканчивается на [suffix]. */
    fun urlAllowed(url: String, prefix: String, suffix: String = ""): Boolean =
        url.startsWith(prefix) && url.none { it.isWhitespace() } && (suffix.isEmpty() || url.endsWith(suffix))

    /** SHA-256 файла (hex, нижний регистр). */
    fun sha256Hex(f: File): String {
        val md = MessageDigest.getInstance("SHA-256")
        f.inputStream().use { input ->
            val buf = ByteArray(64 * 1024)
            while (true) {
                val n = input.read(buf)
                if (n < 0) break
                md.update(buf, 0, n)
            }
        }
        return md.digest().joinToString("") { "%02x".format(it) }
    }

    /** Размер: null — всё хорошо. [expected] ≤ 0 — размер заранее неизвестен; [max] ≤ 0 — предела нет. */
    fun sizeError(actual: Long, expected: Long, max: Long): String? = when {
        max > 0L && actual > max -> "Файл слишком большой"
        expected > 0L && actual != expected -> "Скачано $actual байт из $expected"
        else -> null
    }

    /** Проверка веб-части: размер и SHA-256 из version.json. */
    fun shaVerifier(expectedSha: String, max: Long): (File) -> String? = { f ->
        sizeError(f.length(), 0L, max) ?: run {
            val actual = sha256Hex(f)
            if (actual != expectedSha.trim().lowercase()) "sha256 не совпал (скачано $actual, ожидалось $expectedSha)" else null
        }
    }

    /** Проверка APK: размер (если известен из релиза), затем [packageOk] — тот же пакет и нужный versionCode (нужен Android, поэтому приходит снаружи). */
    fun apkVerifier(expectedSize: Long, max: Long, packageOk: (File) -> Boolean): (File) -> String? = { f ->
        sizeError(f.length(), expectedSize, max)
            ?: if (packageOk(f)) null else "Скачанный файл не подходит (другой пакет или версия)"
    }

    /**
     * Ставит готовый временный файл [work] на место [dest] и прогоняет [verify] по итоговому пути. Возвращает null, если всё хорошо,
     * иначе текст ошибки; при любой ошибке и [work], и [dest] удалены (чужой или битый файл не остаётся).
     */
    fun placeAndVerify(work: File, dest: File, verify: ((File) -> String?)?): String? {
        try {
            dest.parentFile?.mkdirs()
            if (dest.exists() && !dest.delete()) throw IOException("не удалось заменить прежний файл")
            if (!work.renameTo(dest)) throw IOException("не удалось сохранить файл")
        } catch (e: Exception) {
            try { work.delete() } catch (e2: Exception) { }
            return e.message?.takeIf { it.isNotBlank() }?.replaceFirstChar { it.uppercase() } ?: "Не удалось сохранить файл"
        }
        if (verify == null) return null
        val err = try { verify(dest) } catch (e: Exception) { "Файл не прошёл проверку" }
        if (err != null) {
            try { dest.delete() } catch (e: Exception) { }
            try { work.delete() } catch (e: Exception) { }
        }
        return err
    }
}
