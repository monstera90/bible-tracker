package com.app.lifetracker
// Версия: 1.0 (31.10)

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.provider.DocumentsContract
import org.json.JSONArray
import org.json.JSONObject
import java.io.InputStream

/**
 * Папка с PDF (поиск по PDF во вкладке «Поиск»): выбор папки системным окном (Storage Access Framework), запоминание
 * права на неё и обход всех вложенных папок. Сами файлы читает страница через https://localhost/__pdflib/<docId>
 * (WebAssetServer → [open]); текст из них достаёт веб-часть (pdfparse.js) и хранит у себя в IndexedDB.
 * Работает с Android 5.0 (SAF с API 21).
 */
object PdfLibrary {

    private const val PREFS = "pdf_library"
    private const val KEY_TREE = "tree_uri"
    private const val KEY_NAME = "tree_name"

    /** Глубина обхода вложенных папок и предел числа файлов — чтобы обход не зациклился на странных провайдерах. */
    private const val MAX_DEPTH = 8
    private const val MAX_FILES = 5000

    fun isPdf(name: String): Boolean = name.lowercase().endsWith(".pdf")

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
        } ?: "PDF"
        ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
            .putString(KEY_TREE, uri.toString())
            .putString(KEY_NAME, name)
            .apply()
        return true
    }

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

    /** JSON для страницы: {"set":true,"name":"Книги"} или {"set":false}. */
    fun folderJson(ctx: Context): String {
        if (treeUri(ctx) == null) return JSONObject().put("set", false).toString()
        val name = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(KEY_NAME, null) ?: "PDF"
        return JSONObject().put("set", true).put("name", name).toString()
    }

    /**
     * Все PDF выбранной папки и её подпапок: {"ok":true,"items":[{"id","name","path","size","mtime"}]}.
     * path — путь внутри выбранной папки («Подпапка/файл.pdf»). {"ok":false} — папка не выбрана или не читается.
     */
    fun listAllJson(ctx: Context): String {
        val tree = treeUri(ctx) ?: return JSONObject().put("ok", false).toString()
        val arr = JSONArray()
        val count = intArrayOf(0)
        val ok = try {
            walk(ctx, tree, DocumentsContract.getTreeDocumentId(tree), "", 0, arr, count)
        } catch (e: Exception) {
            false
        }
        if (!ok && arr.length() == 0) return JSONObject().put("ok", false).toString()
        return JSONObject().put("ok", true).put("items", arr).toString()
    }

    private fun walk(ctx: Context, tree: Uri, parentId: String, prefix: String, depth: Int, out: JSONArray, count: IntArray): Boolean {
        val children = DocumentsContract.buildChildDocumentsUriUsingTree(tree, parentId)
        val cols = arrayOf(
            DocumentsContract.Document.COLUMN_DOCUMENT_ID,
            DocumentsContract.Document.COLUMN_DISPLAY_NAME,
            DocumentsContract.Document.COLUMN_MIME_TYPE,
            DocumentsContract.Document.COLUMN_SIZE,
            DocumentsContract.Document.COLUMN_LAST_MODIFIED
        )
        val dirs = ArrayList<Pair<String, String>>()
        val cursor = ctx.contentResolver.query(children, cols, null, null, null) ?: return false
        cursor.use { c ->
            while (c.moveToNext()) {
                val id = c.getString(0)
                val name = c.getString(1)
                if (id == null || name == null || name.startsWith(".")) continue
                val mime = c.getString(2) ?: ""
                if (mime == DocumentsContract.Document.MIME_TYPE_DIR) {
                    dirs.add(Pair(id, name))
                } else if (isPdf(name) && count[0] < MAX_FILES) {
                    val size = if (c.isNull(3)) 0L else c.getLong(3)
                    val mtime = if (c.isNull(4)) 0L else c.getLong(4)
                    out.put(
                        JSONObject().put("id", id).put("name", name).put("path", prefix + name)
                            .put("size", size).put("mtime", mtime)
                    )
                    count[0]++
                }
            }
        }
        if (depth < MAX_DEPTH) {
            for (d in dirs) {
                if (count[0] >= MAX_FILES) break
                try {
                    walk(ctx, tree, d.first, prefix + d.second + "/", depth + 1, out, count)
                } catch (e: Exception) {
                    // нечитаемая подпапка пропускается, остальные продолжают обходиться
                }
            }
        }
        return true
    }

    /** Поток данных файла по id документа; только внутри выбранной папки (иначе null). */
    fun open(ctx: Context, docId: String): InputStream? {
        val tree = treeUri(ctx) ?: return null
        return try {
            ctx.contentResolver.openInputStream(DocumentsContract.buildDocumentUriUsingTree(tree, docId))
        } catch (e: Exception) {
            null
        }
    }

    /** Размер файла по id документа (для Content-Length), 0 — неизвестен. */
    fun size(ctx: Context, docId: String): Long {
        val tree = treeUri(ctx) ?: return 0L
        return try {
            val doc = DocumentsContract.buildDocumentUriUsingTree(tree, docId)
            ctx.contentResolver.query(doc, arrayOf(DocumentsContract.Document.COLUMN_SIZE), null, null, null)?.use { c ->
                if (c.moveToFirst() && !c.isNull(0)) c.getLong(0) else 0L
            } ?: 0L
        } catch (e: Exception) {
            0L
        }
    }
}
