package com.app.lifetracker
// Версия: 1.0 (21.11) — ТЗ «скачивание файлов» (TZ_downloads.md 1.1), этап 1: место сохранения всегда «Загрузки»; сортировка по папкам (раздел 13) добавится на этапе 4 без переделки движка.

import android.content.ContentValues
import android.content.Context
import android.media.MediaScannerConnection
import android.os.Build
import android.os.Environment
import android.provider.MediaStore
import androidx.core.content.ContextCompat
import java.io.File
import java.io.IOException

/**
 * Единственная точка выбора места записи (ТЗ 5.5): [resolve] решает, куда положить готовый файл, [newWorkFile] — где его качать,
 * [commit] — переносит готовый файл на место. Этап 1: всегда «Загрузки». Этап 4 добавит папки пользователя (раздел 13.3) внутри [resolve] и [commit].
 *
 * Как пишем в «Загрузки»:
 *  - есть «Доступ ко всем файлам» (или Android до 10 с разрешением на запись) — прямо в папку «Загрузки» во временный `<имя>.part`,
 *    по завершении переименовываем (быстро, без второй копии);
 *  - иначе — во временный файл в каталоге приложения, по завершении копируем в «Загрузки» через MediaStore (Android 10+).
 *    Выбор сделан осознанно: перематываемый дескриптор MediaStore («rw») для многопоточной записи не проверен на телефоне заказчика.
 */
object DownloadTarget {

    const val LABEL_DOWNLOADS = "Загрузки"

    /** Куда положить файл: [label] — подпись для «Готово» («Загрузки» или название папки). */
    class Target(val label: String)

    /** Единая функция выбора (этап 1 — всегда «Загрузки»). [source] нужен этапу 4–5: обновление приложения живёт по своим правилам. */
    @Suppress("UNUSED_PARAMETER")
    fun resolve(fileName: String, source: DlSource): Target = Target(LABEL_DOWNLOADS)

    /** Ключ категории по имени файла (раздел 13.2). Этап 1 — одна общая. */
    @Suppress("UNUSED_PARAMETER")
    fun categoryOf(fileName: String): String = "other"

    @Suppress("DEPRECATION")
    private fun downloadsDir(): File = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS)

    /** Можно ли писать прямо в «Загрузки» как в обычную папку. */
    private fun canWriteDirect(ctx: Context): Boolean {
        if (!AllFilesAccess.granted(ctx)) return false
        val dir = downloadsDir()
        return (dir.isDirectory || dir.mkdirs()) && dir.canWrite()
    }

    /** Временный файл, куда движок пишет закачку. Имя — свободное в «Загрузках» (прямой режим) либо в каталоге приложения. */
    fun newWorkFile(ctx: Context, taskId: Long, fileName: String): File {
        val name = DownloadLogic.safeName(fileName)
        if (canWriteDirect(ctx)) {
            val dir = downloadsDir()
            val part = DownloadLogic.uniqueName("$name.part") { File(dir, it).exists() || File(dir, it + ".json").exists() }
            return File(dir, part)
        }
        val base = ctx.getExternalFilesDir("downloads") ?: File(ctx.filesDir, "downloads")
        if (!base.isDirectory) base.mkdirs()
        return File(base, taskId.toString() + "_" + name + ".part")
    }

    /**
     * Готовый файл — на место. Возвращает подпись для «Готово». Бросает [IOException] с понятным текстом, если не вышло.
     * Временный файл после переноса удаляет сам (при переименовании он уже перемещён).
     */
    fun commit(ctx: Context, task: DownloadTask, work: File): String {
        val target = resolve(task.fileName, task.source)
        val name = DownloadLogic.safeName(task.fileName)
        val dir = downloadsDir()
        if (work.parentFile?.absolutePath == dir.absolutePath) {
            val finalName = DownloadLogic.uniqueName(name) { File(dir, it).exists() }
            val dest = File(dir, finalName)
            if (!work.renameTo(dest)) throw IOException("Не удалось сохранить файл в «Загрузки»")
            scan(ctx, dest, name)
            return target.label
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) copyToMediaStore(ctx, work, name) else copyLegacy(ctx, work, name)
        try { work.delete() } catch (e: Exception) { }
        return target.label
    }

    private fun copyToMediaStore(ctx: Context, work: File, name: String) {
        val resolver = ctx.contentResolver
        val values = ContentValues().apply {
            put(MediaStore.Downloads.DISPLAY_NAME, name)
            put(MediaStore.Downloads.MIME_TYPE, FileSaver.mimeForName(name))
            put(MediaStore.Downloads.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS)
            put(MediaStore.Downloads.IS_PENDING, 1)
        }
        val uri = resolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values) ?: throw IOException("Не удалось создать файл в «Загрузки»")
        try {
            val out = resolver.openOutputStream(uri) ?: throw IOException("Не удалось открыть файл в «Загрузки»")
            out.use { o -> work.inputStream().use { it.copyTo(o, 1 shl 16) } }
            val done = ContentValues().apply { put(MediaStore.Downloads.IS_PENDING, 0) }
            resolver.update(uri, done, null, null)
        } catch (e: Exception) {
            try { resolver.delete(uri, null, null) } catch (e2: Exception) { }
            throw if (e is IOException) e else IOException(e.message ?: "Не удалось сохранить файл")
        }
    }

    /** Android 5–9 без «Доступа ко всем файлам»: запись в «Загрузки» напрямую с обычным разрешением (как у [FileSaver]). */
    private fun copyLegacy(ctx: Context, work: File, name: String) {
        val granted = ContextCompat.checkSelfPermission(ctx, android.Manifest.permission.WRITE_EXTERNAL_STORAGE) == android.content.pm.PackageManager.PERMISSION_GRANTED
        if (!granted && MainActivity.instance?.requestStoragePermissionBlocking() != true) throw IOException("Нет разрешения на запись в «Загрузки»")
        val dir = downloadsDir()
        if (!dir.isDirectory && !dir.mkdirs()) throw IOException("Нет папки «Загрузки»")
        val dest = File(dir, DownloadLogic.uniqueName(name) { File(dir, it).exists() })
        work.inputStream().use { i -> dest.outputStream().use { o -> i.copyTo(o, 1 shl 16) } }
        scan(ctx, dest, name)
    }

    private fun scan(ctx: Context, f: File, name: String) {
        try {
            MediaScannerConnection.scanFile(ctx, arrayOf(f.absolutePath), arrayOf(FileSaver.mimeForName(name)), null)
        } catch (e: Exception) {
            // файл уже на месте; в галерее появится позже
        }
    }
}
