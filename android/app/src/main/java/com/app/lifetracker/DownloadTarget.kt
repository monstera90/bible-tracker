package com.app.lifetracker
// Версия: 2.2 (22.11) — этап 2 (Flibusta, 6.2): задача страницы (`handoffId`) качается в `files/dlhandoff`; [copyBook] — копия книги в папку категории «Книги», если пользователь её включил. Откат: DownloadTarget.kt 2.1.
// Версия: 2.1 (22.11) — этап 5: обновления (`task.dest`) качаются рядом с итоговым файлом в каталоге приложения; [copyUpdate] — необязательная копия APK в папку «Обновление приложения». Откат: DownloadTarget.kt 2.0.
// Версия: 2.0 (22.11) — ТЗ «скачивание файлов» (TZ_downloads.md 1.1), этап 4: выбор папки по правилам раздела 13.3 ([DownloadRules]), запись в папку пользователя (по пути или через SAF), запасной вариант «Загрузки» с пометкой. Откат: DownloadTarget.kt 1.0.
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
 * [commit] — переносит готовый файл на место. Правила выбора папки — [DownloadRules.choose] (раздел 13.3), настройки — [DownloadFolders].
 *
 * Как пишем в «Загрузки»:
 *  - есть «Доступ ко всем файлам» (или Android до 10 с разрешением на запись) — прямо в папку «Загрузки» во временный `<имя>.part`,
 *    по завершении переименовываем (быстро, без второй копии);
 *  - иначе — во временный файл в каталоге приложения, по завершении копируем в «Загрузки» через MediaStore (Android 10+).
 *    Выбор сделан осознанно: перематываемый дескриптор MediaStore («rw») для многопоточной записи не проверен на телефоне заказчика.
 *
 * Как пишем в папку пользователя (этап 4):
 *  - есть «Доступ ко всем файлам» и дерево удаётся превратить в обычный путь ([DownloadFolders.directDir]) — как в «Загрузки»:
 *    `<имя>.part` прямо в папке, по завершении переименование;
 *  - иначе — временный файл в каталоге приложения, по завершении копирование в папку через SAF ([DownloadFolders.copyInto]; в карточке
 *    «копирование…»). Перематываемый дескриптор SAF для многопоточной записи не используем: провайдеры по-разному обращаются с `.part`
 *    (дописывают своё расширение), а копия после завершения работает у всех;
 *  - перед записью папка проверяется ([DownloadFolders.isWritable]); недоступна или запись сорвалась — файл идёт в «Загрузки»,
 *    а в карточке «Готово» остаётся пометка «Папка недоступна — сохранено в «Загрузки»».
 */
object DownloadTarget {

    const val LABEL_DOWNLOADS = "Загрузки"
    const val NOTE_FOLDER_LOST = "Папка недоступна — сохранено в «Загрузки»"
    const val NOTE_UPDATE_COPY_LOST = "Копию в папку сохранить не удалось"

    /** Куда положить файл: [label] — подпись для «Готово» («Загрузки» или название папки); [folder] — папка пользователя или null («Загрузки»); [note] — пометка, если пришлось взять запасное место. */
    class Target(val label: String, val folder: DownloadFolders.Folder? = null, val note: String = "")

    /** Итог переноса: [label] — куда сохранено, [note] — пометка («Папка недоступна…») или пусто. */
    class Saved(val label: String, val note: String)

    /** Единая функция выбора места: правила 13.3, затем проверка, что выбранная папка доступна. */
    fun resolve(ctx: Context, fileName: String, source: DlSource): Target {
        val choice = DownloadRules.choose(fileName, source, DownloadFolders.config(ctx))
        val folder = DownloadFolders.folderFor(ctx, choice) ?: return Target(LABEL_DOWNLOADS)
        if (!DownloadFolders.isWritable(ctx, folder.treeUri)) return Target(LABEL_DOWNLOADS, null, NOTE_FOLDER_LOST)
        return Target(folder.label, folder)
    }

    /** Ключ категории по имени файла (раздел 13.2), без учёта настроек. */
    fun categoryOf(fileName: String): String = DownloadRules.categoryOfName(fileName)

    @Suppress("DEPRECATION")
    private fun downloadsDir(): File = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS)

    /** Можно ли писать прямо в «Загрузки» как в обычную папку. */
    private fun canWriteDirect(ctx: Context): Boolean {
        if (!AllFilesAccess.granted(ctx)) return false
        val dir = downloadsDir()
        return (dir.isDirectory || dir.mkdirs()) && dir.canWrite()
    }

    /**
     * Временный файл, куда движок пишет закачку. Имя — свободное в папке назначения (прямой режим: «Загрузки» или папка пользователя,
     * доступная по пути) либо в каталоге приложения (тогда [commit] скопирует готовый файл).
     */
    fun newWorkFile(ctx: Context, task: DownloadTask): File {
        val fixed = task.dest // обновления: рабочая копия остаётся в каталоге приложения (проверка и установка требуют обычного файла)
        if (fixed != null) {
            fixed.parentFile?.mkdirs()
            return File(fixed.path + ".part")
        }
        val name = DownloadLogic.safeName(task.fileName)
        if (task.handoffId.isNotEmpty()) return File(PageHandoff.dir(ctx), task.id.toString() + "_" + name + ".part") // страница заберёт файл сама, «Загрузки» и папки пользователя не нужны
        val target = resolve(ctx, task.fileName, task.source)
        val userDir = target.folder?.let { DownloadFolders.directDir(ctx, it.treeUri) }
        if (userDir != null) return partIn(userDir, name)
        if (target.folder == null && canWriteDirect(ctx)) return partIn(downloadsDir(), name)
        val base = ctx.getExternalFilesDir("downloads") ?: File(ctx.filesDir, "downloads")
        if (!base.isDirectory) base.mkdirs()
        return File(base, task.id.toString() + "_" + name + ".part")
    }

    private fun partIn(dir: File, name: String): File {
        val part = DownloadLogic.uniqueName("$name.part") { File(dir, it).exists() || File(dir, it + ".json").exists() }
        return File(dir, part)
    }

    /**
     * Готовый файл — на место. Возвращает куда сохранено и пометку. Бросает [IOException] с понятным текстом, если не вышло.
     * Временный файл после переноса удаляет сам (при переименовании он уже перемещён).
     */
    fun commit(ctx: Context, task: DownloadTask, work: File): Saved {
        val target = resolve(ctx, task.fileName, task.source)
        val name = DownloadLogic.safeName(task.fileName)
        val folder = target.folder
        if (folder != null) {
            try {
                commitToFolder(ctx, folder, work, name)
                return Saved(target.label, "")
            } catch (e: Exception) {
                // папка не приняла файл (сорвалась запись, пропало право) — файл не теряем: «Загрузки» и пометка
                commitToDownloads(ctx, work, name)
                return Saved(LABEL_DOWNLOADS, NOTE_FOLDER_LOST)
            }
        }
        commitToDownloads(ctx, work, name)
        return Saved(LABEL_DOWNLOADS, target.note)
    }

    /**
     * Обновление приложения (ТЗ 6.5): рабочий файл [task].dest уже на месте и проверен. Если категория «Обновление приложения» включена
     * и выбрана — ещё и копия туда; иначе ничего не остаётся (в «Загрузки» не кладём никогда). Сорвалась копия — обновление не страдает:
     * только пометка в карточке «Готово». Возвращает [Saved] (label пусто — копии нет).
     */
    fun copyUpdate(ctx: Context, task: DownloadTask, file: File): Saved = copyToChosen(ctx, task, file, DlSource.APP_UPDATE)

    /**
     * Книга Flibusta (ТЗ 6.2): основной экземпляр кладёт в библиотеку «Книги» страница, а сюда — только необязательная копия: если по правилам 13.3
     * для этого имени файла есть включённая папка (категория «Электронные книги» или свой формат) — копия идёт в неё. Папки нет — ничего не остаётся
     * (в «Загрузки» не кладём). Возвращает [Saved] (label пусто — копии нет).
     */
    fun copyBook(ctx: Context, task: DownloadTask, file: File): Saved = copyToChosen(ctx, task, file, DlSource.USER)

    private fun copyToChosen(ctx: Context, task: DownloadTask, file: File, source: DlSource): Saved {
        val choice = DownloadRules.choose(task.fileName, source, DownloadFolders.config(ctx))
        val folder = DownloadFolders.folderFor(ctx, choice) ?: return Saved("", "")
        if (!DownloadFolders.isWritable(ctx, folder.treeUri)) return Saved("", NOTE_UPDATE_COPY_LOST)
        val name = DownloadLogic.safeName(task.fileName)
        return try {
            val dir = DownloadFolders.directDir(ctx, folder.treeUri)
            if (dir != null) {
                val dest = File(dir, DownloadLogic.uniqueName(name) { File(dir, it).exists() })
                file.inputStream().use { i -> dest.outputStream().use { o -> i.copyTo(o, 1 shl 16) } }
                scan(ctx, dest, name)
            } else {
                DownloadFolders.copyInto(ctx, folder.treeUri, file, name)
            }
            Saved(folder.label, "")
        } catch (e: Exception) {
            Saved("", NOTE_UPDATE_COPY_LOST)
        }
    }

    /** В папку пользователя: переименование, если временный файл уже лежит в ней (прямой режим), иначе копирование (путь или SAF). */
    private fun commitToFolder(ctx: Context, folder: DownloadFolders.Folder, work: File, name: String) {
        val dir = DownloadFolders.directDir(ctx, folder.treeUri)
        if (dir != null) {
            val finalName = DownloadLogic.uniqueName(name) { File(dir, it).exists() }
            val dest = File(dir, finalName)
            if (work.parentFile?.absolutePath == dir.absolutePath) {
                if (!work.renameTo(dest)) throw IOException("Не удалось сохранить файл в папку")
            } else {
                work.inputStream().use { i -> dest.outputStream().use { o -> i.copyTo(o, 1 shl 16) } }
                try { work.delete() } catch (e: Exception) { }
            }
            scan(ctx, dest, name)
            return
        }
        DownloadFolders.copyInto(ctx, folder.treeUri, work, name)
        try { work.delete() } catch (e: Exception) { }
    }

    /** В «Загрузки»: переименование, если временный файл уже в ней, иначе MediaStore / обычная запись. */
    private fun commitToDownloads(ctx: Context, work: File, name: String) {
        val dir = downloadsDir()
        if (work.parentFile?.absolutePath == dir.absolutePath) {
            val finalName = DownloadLogic.uniqueName(name) { File(dir, it).exists() }
            val dest = File(dir, finalName)
            if (!work.renameTo(dest)) throw IOException("Не удалось сохранить файл в «Загрузки»")
            scan(ctx, dest, name)
            return
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) copyToMediaStore(ctx, work, name) else copyLegacy(ctx, work, name)
        try { work.delete() } catch (e: Exception) { }
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
