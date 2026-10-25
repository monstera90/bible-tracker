package com.app.lifetracker
// Версия: 1.0 (25.10)

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.provider.DocumentsContract
import org.json.JSONArray
import org.json.JSONObject

/**
 * Папка с музыкой (вкладка «Музыка», set2s_11): выбор папки системным окном (Storage Access Framework), запоминание права на неё
 * и список содержимого «как есть» — подпапки и звуковые файлы. Идентификаторы документов (docId) отдаются странице как есть:
 * по ним она спускается в подпапки и просит запустить трек. Работает с Android 5.0 (SAF с API 21).
 */
object MusicLibrary {

    private const val PREFS = "music_library"
    private const val KEY_TREE = "tree_uri"
    private const val KEY_NAME = "tree_name"

    /** Расширения, которые показываются в списке (mp3, flac и alac — обязательные; остальные — что умеет играть система). */
    private val AUDIO_EXT = setOf("mp3", "flac", "m4a", "alac", "aac", "ogg", "oga", "opus", "wav")

    class Entry(val id: String, val name: String, val dir: Boolean)

    fun ext(name: String): String {
        val i = name.lastIndexOf('.')
        return if (i < 0) "" else name.substring(i + 1).lowercase()
    }

    fun isAudio(name: String): Boolean = AUDIO_EXT.contains(ext(name))

    /** Выбранная папка или null, если не выбрана (или право на неё пропало — переустановка, отзыв в настройках). */
    fun treeUri(ctx: Context): Uri? {
        val s = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(KEY_TREE, null) ?: return null
        val uri = Uri.parse(s)
        val granted = try {
            ctx.contentResolver.persistedUriPermissions.any { it.uri == uri && it.isReadPermission }
        } catch (e: Exception) {
            true
        }
        return if (granted) uri else null
    }

    /** Запоминает выбранную папку (с постоянным правом на чтение). false — система не дала право. */
    fun setTree(ctx: Context, uri: Uri): Boolean {
        try {
            ctx.contentResolver.takePersistableUriPermission(uri, Intent.FLAG_GRANT_READ_URI_PERMISSION)
        } catch (e: Exception) {
            return false
        }
        val name = try {
            queryName(ctx, uri, DocumentsContract.getTreeDocumentId(uri))
        } catch (e: Exception) {
            null
        } ?: "Музыка"
        ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
            .putString(KEY_TREE, uri.toString())
            .putString(KEY_NAME, name)
            .apply()
        return true
    }

    fun docUri(tree: Uri, docId: String): Uri = DocumentsContract.buildDocumentUriUsingTree(tree, docId)

    private fun queryName(ctx: Context, tree: Uri, docId: String): String? {
        return try {
            val doc = DocumentsContract.buildDocumentUriUsingTree(tree, docId)
            ctx.contentResolver.query(doc, arrayOf(DocumentsContract.Document.COLUMN_DISPLAY_NAME), null, null, null)?.use { c ->
                if (c.moveToFirst()) c.getString(0) else null
            }
        } catch (e: Exception) {
            null
        }
    }

    /** JSON для страницы: {"set":true,"name":"Music"} или {"set":false}. */
    fun folderJson(ctx: Context): String {
        if (treeUri(ctx) == null) return JSONObject().put("set", false).toString()
        val name = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(KEY_NAME, null) ?: "Музыка"
        return JSONObject().put("set", true).put("name", name).toString()
    }

    /**
     * Содержимое папки [docId] (null или пусто — корень выбранной папки): сначала подпапки, затем звуковые файлы,
     * внутри групп — по имени с учётом чисел («2» раньше «10»). null — папка не выбрана или не читается.
     */
    fun list(ctx: Context, docId: String?): List<Entry>? {
        val tree = treeUri(ctx) ?: return null
        val parent = if (docId.isNullOrEmpty()) DocumentsContract.getTreeDocumentId(tree) else docId
        val children = DocumentsContract.buildChildDocumentsUriUsingTree(tree, parent)
        val cols = arrayOf(
            DocumentsContract.Document.COLUMN_DOCUMENT_ID,
            DocumentsContract.Document.COLUMN_DISPLAY_NAME,
            DocumentsContract.Document.COLUMN_MIME_TYPE
        )
        val res = ArrayList<Entry>()
        try {
            val cursor = ctx.contentResolver.query(children, cols, null, null, null) ?: return null
            cursor.use { c ->
                while (c.moveToNext()) {
                    val id = c.getString(0)
                    val name = c.getString(1)
                    if (id == null || name == null) continue
                    val mime = c.getString(2) ?: ""
                    val dir = mime == DocumentsContract.Document.MIME_TYPE_DIR
                    if (name.startsWith(".")) continue
                    if (dir || isAudio(name)) res.add(Entry(id, name, dir))
                }
            }
        } catch (e: Exception) {
            return null
        }
        res.sortWith(Comparator { a, b ->
            if (a.dir != b.dir) (if (a.dir) -1 else 1) else naturalCompare(a.name, b.name)
        })
        return res
    }

    fun listJson(ctx: Context, docId: String?): String {
        val items = list(ctx, docId) ?: return JSONObject().put("ok", false).toString()
        val arr = JSONArray()
        for (e in items) arr.put(JSONObject().put("id", e.id).put("name", e.name).put("dir", e.dir))
        return JSONObject().put("ok", true).put("items", arr).toString()
    }

    /** Сравнение имён без учёта регистра, числа внутри имён сравниваются как числа. */
    fun naturalCompare(a: String, b: String): Int {
        var i = 0
        var j = 0
        while (i < a.length && j < b.length) {
            val ca = a[i]
            val cb = b[j]
            if (ca.isDigit() && cb.isDigit()) {
                var ei = i
                while (ei < a.length && a[ei].isDigit()) ei++
                var ej = j
                while (ej < b.length && b[ej].isDigit()) ej++
                var si = i
                while (si < ei - 1 && a[si] == '0') si++
                var sj = j
                while (sj < ej - 1 && b[sj] == '0') sj++
                val la = ei - si
                val lb = ej - sj
                if (la != lb) return la - lb
                for (k in 0 until la) {
                    val d = a[si + k] - b[sj + k]
                    if (d != 0) return d
                }
                i = ei
                j = ej
            } else {
                val xa = ca.lowercaseChar()
                val xb = cb.lowercaseChar()
                if (xa != xb) return xa.compareTo(xb)
                i++
                j++
            }
        }
        return (a.length - i) - (b.length - j)
    }
}
