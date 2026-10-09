package com.app.lifetracker

import android.content.ClipData
import android.content.ContentResolver
import android.content.ContentValues
import android.content.Context
import android.content.Intent
import android.Manifest
import android.content.pm.PackageManager
import android.media.MediaScannerConnection
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.provider.MediaStore
import android.util.Base64
import android.webkit.MimeTypeMap
import androidx.core.content.ContextCompat
import androidx.core.content.FileProvider
import org.json.JSONObject
import java.io.File
import java.io.FileOutputStream
import java.io.OutputStream
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicLong

/**
 * Приём файла от страницы по частям (base64) и два назначения:
 *  - SAVE: запись в папку «Загрузки»: через MediaStore на Android 10+ (без разрешений), напрямую в папку на Android 5-9
 *    (разрешение WRITE_EXTERNAL_STORAGE; на Android 6-9 запрашивается при первом сохранении);
 *  - STAGE: временный файл в cache/share/ для системного меню «Поделиться» (через FileProvider).
 * Страница режет Blob на куски по ~3 МБ (native-shell.js), поэтому архив любого размера не лежит в памяти целиком.
 * Все методы вызываются из потока моста WebView (не из главного), блокирующая запись допустима.
 */
class FileSaver(private val context: Context) {

    companion object {
        const val AUTHORITY = "com.app.lifetracker.fileprovider"
        private const val SHARE_DIR = "share"
        private const val STALE_MS = 24L * 60 * 60 * 1000

        /** Убирает из имени всё, что нельзя в имени файла Android, и обрезает до разумной длины. */
        fun sanitizeName(source: String?): String {
            var name = (source ?: "").replace(Regex("[\\\\/:*?\"<>|\\u0000-\\u001F]"), "_").trim().trim('.')
            if (name.isEmpty()) name = "file"
            if (name.length > 150) {
                val ext = name.substringAfterLast('.', "")
                val base = name.substringBeforeLast('.', name)
                name = if (ext.isNotEmpty() && ext.length <= 10) base.take(140 - ext.length) + "." + ext else name.take(150)
            }
            return name
        }

        /**
         * MIME по расширению имени. Намеренно не берём тип из Blob: если MIME не совпадает с расширением,
         * MediaStore дописывает своё расширение (был бы «заметка.md.txt»). Неизвестное расширение даёт octet-stream:
         * в этом случае система имя не меняет.
         */
        fun mimeForName(name: String): String {
            val ext = name.substringAfterLast('.', "").lowercase()
            if (ext.isEmpty()) return "application/octet-stream"
            return MimeTypeMap.getSingleton().getMimeTypeFromExtension(ext) ?: "application/octet-stream"
        }
    }

    private enum class Mode { SAVE, STAGE }

    private class Session(
        val mode: Mode,
        val name: String,
        val mime: String,
        val out: OutputStream,
        val uri: Uri?,
        val file: File?
    ) {
        var bytes: Long = 0
    }

    private val sessions = ConcurrentHashMap<String, Session>()
    private val counter = AtomicLong(0)
    private val staged = ArrayList<Pair<File, String>>()

    private val resolver: ContentResolver get() = context.contentResolver

    /** Начало сохранения в «Загрузки». Возвращает идентификатор сессии или "" при ошибке. */
    fun beginSave(rawName: String?): String {
        return try {
            val name = sanitizeName(rawName)
            val mime = mimeForName(name)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) beginSaveMediaStore(name, mime) else beginSaveLegacy(name, mime)
        } catch (e: Exception) {
            ""
        }
    }

    /** Android 10+: запись через MediaStore, разрешений не нужно. */
    private fun beginSaveMediaStore(name: String, mime: String): String {
        val values = ContentValues().apply {
            put(MediaStore.Downloads.DISPLAY_NAME, name)
            put(MediaStore.Downloads.MIME_TYPE, mime)
            put(MediaStore.Downloads.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS)
            put(MediaStore.Downloads.IS_PENDING, 1)
        }
        val uri = resolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values) ?: return ""
        val out = resolver.openOutputStream(uri)
        if (out == null) {
            resolver.delete(uri, null, null)
            return ""
        }
        val id = "s" + counter.incrementAndGet()
        sessions[id] = Session(Mode.SAVE, name, mime, out.buffered(1 shl 16), uri, null)
        return id
    }

    /**
     * Android 5-9: файл создаётся прямо в общей папке «Загрузки». На 6-9 сначала нужно разрешение на запись
     * (на 5.x выдаётся при установке). Вызывается из потока моста: ожидание ответа пользователя блокирует только его.
     */
    private fun beginSaveLegacy(name: String, mime: String): String {
        val granted = ContextCompat.checkSelfPermission(context, Manifest.permission.WRITE_EXTERNAL_STORAGE) ==
            PackageManager.PERMISSION_GRANTED
        if (!granted && MainActivity.instance?.requestStoragePermissionBlocking() != true) return ""
        val dir = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS)
        if (!dir.isDirectory && !dir.mkdirs()) return ""
        val file = createUniqueFile(dir, name) ?: return ""
        val out = FileOutputStream(file).buffered(1 shl 16)
        val id = "s" + counter.incrementAndGet()
        sessions[id] = Session(Mode.SAVE, file.name, mime, out, null, file)
        return id
    }

    /** Свободное имя в папке: «имя.ext», затем «имя (1).ext», «имя (2).ext» (как делает MediaStore). */
    private fun createUniqueFile(dir: File, name: String): File? {
        val ext = name.substringAfterLast('.', "")
        val base = if (ext.isEmpty()) name else name.substringBeforeLast('.')
        var n = 0
        while (n < 1000) {
            val candidate = if (n == 0) name else if (ext.isEmpty()) "$base ($n)" else "$base ($n).$ext"
            val file = File(dir, candidate)
            if (file.createNewFile()) return file
            n++
        }
        return null
    }

    /** Начало подготовки файла для «Поделиться». Возвращает идентификатор сессии или "" при ошибке. */
    fun beginStage(rawName: String?): String {
        return try {
            val name = sanitizeName(rawName)
            val mime = mimeForName(name)
            val dir = File(context.cacheDir, "$SHARE_DIR/${System.currentTimeMillis()}_${counter.incrementAndGet()}")
            if (!dir.mkdirs()) return ""
            val file = File(dir, name)
            val id = "t" + counter.incrementAndGet()
            sessions[id] = Session(Mode.STAGE, name, mime, file.outputStream().buffered(1 shl 16), null, file)
            id
        } catch (e: Exception) {
            ""
        }
    }

    /** Дописывает очередной кусок (base64 без префикса data:). false: сессии нет или запись не удалась. */
    fun append(id: String?, base64: String?): Boolean {
        val session = sessions[id ?: return false] ?: return false
        return try {
            val bytes = Base64.decode(base64 ?: "", Base64.DEFAULT)
            session.out.write(bytes)
            session.bytes += bytes.size
            true
        } catch (e: Exception) {
            cancel(id)
            false
        }
    }

    /** Закрывает сессию. JSON: {"ok":true,"name":"...","bytes":N} или {"ok":false,"error":"..."}. */
    fun finish(id: String?): String {
        val session = sessions.remove(id ?: return fail("нет сессии")) ?: return fail("нет сессии")
        return try {
            session.out.flush()
            session.out.close()
            when (session.mode) {
                Mode.SAVE -> {
                    val uri = session.uri
                    if (uri != null) {
                        val done = ContentValues().apply { put(MediaStore.Downloads.IS_PENDING, 0) }
                        resolver.update(uri, done, null, null)
                        JSONObject().put("ok", true).put("name", savedName(uri) ?: session.name).put("bytes", session.bytes).toString()
                    } else {
                        // Android 5-9: файл лежит в «Загрузках»; сообщаем медиасканеру, чтобы он появился в файловых менеджерах.
                        val saved = session.file!!
                        try {
                            MediaScannerConnection.scanFile(context, arrayOf(saved.absolutePath), arrayOf(session.mime), null)
                        } catch (e: Exception) {
                            // файл уже записан; появится в списках позже
                        }
                        JSONObject().put("ok", true).put("name", saved.name).put("bytes", session.bytes).toString()
                    }
                }
                Mode.STAGE -> {
                    synchronized(staged) { staged.add(Pair(session.file!!, session.mime)) }
                    JSONObject().put("ok", true).put("name", session.name).put("bytes", session.bytes).toString()
                }
            }
        } catch (e: Exception) {
            discard(session)
            fail(e.message ?: e.toString())
        }
    }

    /** Отмена: недописанный файл удаляется, в «Загрузках» следа не остаётся. */
    fun cancel(id: String?) {
        val session = sessions.remove(id ?: return) ?: return
        try {
            session.out.close()
        } catch (e: Exception) {
            // уже закрыт
        }
        discard(session)
    }

    /** Отмена всех незавершённых сессий (закрытие экрана посреди сохранения). */
    fun cancelAll() {
        sessions.keys.toList().forEach { cancel(it) }
    }

    /** Системное меню «Поделиться» для файлов, подготовленных через beginStage. Список очищается. */
    fun buildShareIntent(title: String?, text: String?): Intent? {
        val items: List<Pair<File, String>>
        synchronized(staged) {
            items = staged.toList()
            staged.clear()
        }
        if (items.isEmpty()) return null
        val uris = ArrayList<Uri>()
        for ((file, _) in items) {
            uris.add(FileProvider.getUriForFile(context, AUTHORITY, file))
        }
        val mimes = items.map { it.second }.distinct()
        val type = if (mimes.size == 1) mimes[0] else "*/*"
        val send = if (uris.size == 1) {
            Intent(Intent.ACTION_SEND).apply { putExtra(Intent.EXTRA_STREAM, uris[0]) }
        } else {
            Intent(Intent.ACTION_SEND_MULTIPLE).apply { putParcelableArrayListExtra(Intent.EXTRA_STREAM, uris) }
        }
        send.type = type
        if (!title.isNullOrEmpty()) send.putExtra(Intent.EXTRA_SUBJECT, title)
        if (!text.isNullOrEmpty()) send.putExtra(Intent.EXTRA_TEXT, text)
        val clip = ClipData.newRawUri(title ?: "", uris[0])
        for (i in 1 until uris.size) clip.addItem(ClipData.Item(uris[i]))
        send.clipData = clip
        send.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        return Intent.createChooser(send, title ?: "").addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
    }

    /** Сбрасывает подготовленные, но не отправленные файлы. */
    fun clearStaged() {
        val items: List<Pair<File, String>>
        synchronized(staged) {
            items = staged.toList()
            staged.clear()
        }
        items.forEach { deleteQuietly(it.first) }
    }

    /** Удаляет старые временные файлы «Поделиться» (вызывается при старте). */
    fun cleanStale() {
        try {
            val root = File(context.cacheDir, SHARE_DIR)
            val now = System.currentTimeMillis()
            root.listFiles()?.forEach { dir ->
                if (now - dir.lastModified() > STALE_MS) dir.deleteRecursively()
            }
        } catch (e: Exception) {
            // не критично
        }
    }

    private fun savedName(uri: Uri): String? = try {
        resolver.query(uri, arrayOf(MediaStore.Downloads.DISPLAY_NAME), null, null, null)?.use { c ->
            if (c.moveToFirst()) c.getString(0) else null
        }
    } catch (e: Exception) {
        null
    }

    private fun discard(session: Session) {
        try {
            if (session.uri != null) resolver.delete(session.uri, null, null)
            if (session.file != null) {
                // В «Загрузках» (Android 5-9) удаляем только сам файл: папку «Загрузки» трогать нельзя.
                if (session.mode == Mode.STAGE) deleteQuietly(session.file) else session.file.delete()
            }
        } catch (e: Exception) {
            // не критично
        }
    }

    private fun deleteQuietly(file: File) {
        try {
            file.delete()
            file.parentFile?.delete()
        } catch (e: Exception) {
            // не критично
        }
    }

    private fun fail(message: String): String =
        JSONObject().put("ok", false).put("error", message).toString()
}
