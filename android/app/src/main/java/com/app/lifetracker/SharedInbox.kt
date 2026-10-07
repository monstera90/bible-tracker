package com.app.lifetracker

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.provider.OpenableColumns
import android.webkit.MimeTypeMap
import androidx.core.content.IntentCompat
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.util.concurrent.Executors

/**
 * Входящие файлы от системного «Поделиться» (замена Web Share Target из PWA).
 * Intent приходит в MainActivity (onCreate / onNewIntent). Файл копируется из content:// во временную папку
 * cache/incoming/<id>/<имя> в фоновом потоке (видео бывает большим), затем страница забирает его:
 *   1. LifeTrackerNative.takeSharedFiles() даёт список {id, name, type, size};
 *   2. fetch("./__shared/<id>") отдаёт содержимое (WebAssetServer);
 *   3. LifeTrackerNative.releaseSharedFile(id) удаляет временную копию.
 * Объект живёт в процессе, поэтому пересоздание Activity (recreate) принятые файлы не теряет.
 */
object SharedInbox {

    private const val EXTRA_HANDLED = "com.app.lifetracker.SHARE_HANDLED"
    private const val STALE_MS = 24L * 60 * 60 * 1000

    class Item(val id: String, val name: String, val type: String, val size: Long, val file: File)

    private val executor = Executors.newSingleThreadExecutor()
    private val lock = Any()
    private val ready = LinkedHashMap<String, Item>()
    private val known = HashMap<String, Item>()
    private var counter = 0L

    /** Удаляет временные копии прошлых запусков (страница их уже не заберёт). Вызывается один раз при старте процесса. */
    fun cleanStale(context: Context) {
        try {
            File(context.cacheDir, "incoming").listFiles()?.forEach { dir ->
                if (System.currentTimeMillis() - dir.lastModified() > STALE_MS) dir.deleteRecursively()
            }
        } catch (e: Exception) {
            // не критично
        }
    }

    /**
     * Разбирает intent. true, если это «Поделиться» с файлами и копирование запущено; onAdded вызывается из фонового
     * потока после каждого скопированного файла (оболочка сообщает странице), onFailed: не удалось принять файл.
     * Один и тот же intent обрабатывается один раз (пометка в extras переживает recreate Activity).
     */
    fun accept(context: Context, intent: Intent?, onAdded: () -> Unit, onFailed: () -> Unit): Boolean {
        if (intent == null) return false
        val action = intent.action
        if (action != Intent.ACTION_SEND && action != Intent.ACTION_SEND_MULTIPLE) return false
        if (intent.getBooleanExtra(EXTRA_HANDLED, false)) return false
        intent.putExtra(EXTRA_HANDLED, true)

        val uris = ArrayList<Uri>()
        if (action == Intent.ACTION_SEND) {
            IntentCompat.getParcelableExtra(intent, Intent.EXTRA_STREAM, Uri::class.java)?.let { uris.add(it) }
        } else {
            IntentCompat.getParcelableArrayListExtra(intent, Intent.EXTRA_STREAM, Uri::class.java)?.let { uris.addAll(it) }
        }
        if (uris.isEmpty()) {
            val clip = intent.clipData
            if (clip != null) {
                for (i in 0 until clip.itemCount) clip.getItemAt(i).uri?.let { uris.add(it) }
            }
        }
        if (uris.isEmpty()) return false

        val appContext = context.applicationContext
        val fallbackType = intent.type
        for (uri in uris) {
            executor.execute {
                val item = try {
                    copyToInbox(appContext, uri, fallbackType)
                } catch (e: Exception) {
                    null
                }
                if (item == null) {
                    onFailed()
                } else {
                    synchronized(lock) {
                        ready[item.id] = item
                        known[item.id] = item
                    }
                    onAdded()
                }
            }
        }
        return true
    }

    /** Список принятых и ещё не выданных странице файлов (JSON-массив). Повторный вызов их не вернёт. */
    fun takeJson(): String {
        val array = JSONArray()
        synchronized(lock) {
            for (item in ready.values) {
                array.put(
                    JSONObject().put("id", item.id).put("name", item.name).put("type", item.type).put("size", item.size)
                )
            }
            ready.clear()
        }
        return array.toString()
    }

    /** Файл для раздачи по адресу ./__shared/<id>; null, если такого нет. */
    fun find(id: String): Item? = synchronized(lock) { known[id] }

    /** Удаляет временную копию после того, как страница её забрала. */
    fun release(id: String) {
        val item = synchronized(lock) {
            ready.remove(id)
            known.remove(id)
        } ?: return
        try {
            item.file.delete()
            item.file.parentFile?.delete()
        } catch (e: Exception) {
            // не критично
        }
    }

    private fun copyToInbox(context: Context, uri: Uri, fallbackType: String?): Item? {
        val resolver = context.contentResolver
        var name: String? = null
        var declaredSize = -1L
        try {
            resolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE), null, null, null)?.use { c ->
                if (c.moveToFirst()) {
                    val n = c.getColumnIndex(OpenableColumns.DISPLAY_NAME)
                    val s = c.getColumnIndex(OpenableColumns.SIZE)
                    if (n >= 0 && !c.isNull(n)) name = c.getString(n)
                    if (s >= 0 && !c.isNull(s)) declaredSize = c.getLong(s)
                }
            }
        } catch (e: Exception) {
            // имя возьмём из адреса
        }
        val type = (resolver.getType(uri) ?: fallbackType ?: "application/octet-stream").lowercase()
        var safeName = FileSaver.sanitizeName(name ?: uri.lastPathSegment)
        if (!safeName.contains('.')) {
            val ext = MimeTypeMap.getSingleton().getExtensionFromMimeType(type)
            if (ext != null) safeName = "$safeName.$ext"
        }

        val id: String
        synchronized(lock) {
            counter++
            id = "${System.currentTimeMillis()}_$counter"
        }
        val dir = File(context.cacheDir, "incoming/$id")
        if (!dir.mkdirs()) return null
        val file = File(dir, safeName)
        var total = 0L
        try {
            resolver.openInputStream(uri)?.use { input ->
                file.outputStream().use { output ->
                    val buffer = ByteArray(1 shl 16)
                    while (true) {
                        val read = input.read(buffer)
                        if (read < 0) break
                        output.write(buffer, 0, read)
                        total += read
                    }
                }
            } ?: run {
                dir.deleteRecursively()
                return null
            }
        } catch (e: Exception) {
            dir.deleteRecursively()
            return null
        }
        if (declaredSize > 0 && total < declaredSize) {
            // Источник отдал меньше заявленного (оборвалось чтение): неполный файл странице не отдаём.
            dir.deleteRecursively()
            return null
        }
        return Item(id, safeName, type, total, file)
    }
}
