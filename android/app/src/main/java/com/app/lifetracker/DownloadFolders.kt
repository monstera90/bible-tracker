package com.app.lifetracker
// Версия: 1.0 (22.11) — ТЗ «скачивание файлов» (TZ_downloads.md 1.1), этап 4: настройки «Сохранение загрузок» (папки по типам файлов и «свои форматы»), права на папки, запись файла в папку.

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.provider.DocumentsContract
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.io.IOException

/**
 * Настройки «Сохранение загрузок» (ТЗ раздел 13): для каждой категории файлов и каждого «своего формата» — переключатель и папка,
 * выбранная системным окном (дерево Storage Access Framework). Хранятся на устройстве (SharedPreferences «download_folders»,
 * один JSON), в облако и экспорт не входят. Ничего не включено само: пока пользователь не выбрал папку, всё идёт в «Загрузки».
 *
 * Ключи записей для моста и страницы: `cat:<ключ категории>` и `rule:<формат>` (формат — нормализованный, см. [DownloadRules.normalizeFormat]).
 * Чистая логика выбора (какая запись подходит файлу) — в [DownloadRules]; здесь хранение, права и запись.
 */
object DownloadFolders {

    private const val PREFS = "download_folders"
    private const val KEY_DATA = "data"
    private const val EXTERNAL_STORAGE_AUTHORITY = "com.android.externalstorage.documents"

    /** Папка пользователя: адрес дерева и подпись для «Готово». */
    class Folder(val treeUri: Uri, val label: String)

    private class Entry(val key: String, var enabled: Boolean, var treeUri: String, var label: String)

    private val lock = Any()
    private var loaded = false
    private val cats = LinkedHashMap<String, Entry>()
    private val rules = LinkedHashMap<String, Entry>()

    private fun prefs(ctx: Context) = ctx.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    // ---------- хранение ----------

    /** Вызывается под [lock]. */
    private fun ensureLoaded(ctx: Context) {
        if (loaded) return
        loaded = true
        try {
            val txt = prefs(ctx).getString(KEY_DATA, null) ?: return
            val o = JSONObject(txt)
            val ca = o.optJSONArray("cats")
            if (ca != null) for (i in 0 until ca.length()) {
                val e = ca.optJSONObject(i) ?: continue
                val k = e.optString("key")
                if (DownloadRules.category(k) == null) continue
                cats[k] = Entry(k, e.optBoolean("enabled"), e.optString("treeUri"), e.optString("label"))
            }
            val ra = o.optJSONArray("rules")
            if (ra != null) for (i in 0 until ra.length()) {
                val e = ra.optJSONObject(i) ?: continue
                val ext = DownloadRules.normalizeFormat(e.optString("ext"))
                if (DownloadRules.formatError(ext) != null) continue
                rules[ext] = Entry(ext, e.optBoolean("enabled"), e.optString("treeUri"), e.optString("label"))
            }
        } catch (e: Exception) {
            // повреждённая запись — начинаем с чистых настроек (всё в «Загрузки»)
        }
    }

    /** Вызывается под [lock]. */
    private fun save(ctx: Context) {
        val ca = JSONArray()
        for (e in cats.values) ca.put(JSONObject().put("key", e.key).put("enabled", e.enabled).put("treeUri", e.treeUri).put("label", e.label))
        val ra = JSONArray()
        for (e in rules.values) ra.put(JSONObject().put("ext", e.key).put("enabled", e.enabled).put("treeUri", e.treeUri).put("label", e.label))
        val o = JSONObject().put("cats", ca).put("rules", ra)
        prefs(ctx).edit().putString(KEY_DATA, o.toString()).apply()
    }

    /** Запись по ключу моста («cat:images», «rule:zip»); null — нет такой. Вызывается под [lock]. */
    private fun entryOf(key: String): Entry? {
        val i = key.indexOf(':')
        if (i <= 0) return null
        val kind = key.substring(0, i)
        val name = key.substring(i + 1)
        return when (kind) {
            "cat" -> if (DownloadRules.category(name) == null) null else cats.getOrPut(name) { Entry(name, false, "", "") }
            "rule" -> rules[DownloadRules.normalizeFormat(name)]
            else -> null
        }
    }

    // ---------- выбор ----------

    /** Настройки для чистой функции выбора [DownloadRules.choose]. */
    fun config(ctx: Context): DownloadRules.Config = synchronized(lock) {
        ensureLoaded(ctx)
        DownloadRules.Config(
            cats.mapValues { DownloadRules.Slot(it.value.enabled, it.value.treeUri.isNotEmpty()) },
            rules.mapValues { DownloadRules.Slot(it.value.enabled, it.value.treeUri.isNotEmpty()) }
        )
    }

    /** Папка для результата [DownloadRules.choose]; null — «Загрузки». */
    fun folderFor(ctx: Context, choice: DownloadRules.Choice): Folder? = synchronized(lock) {
        ensureLoaded(ctx)
        val e: Entry? = when (choice) {
            is DownloadRules.Choice.Cat -> cats[choice.key]
            is DownloadRules.Choice.Custom -> rules[choice.ext]
            else -> null
        }
        if (e == null || e.treeUri.isEmpty()) null else Folder(Uri.parse(e.treeUri), e.label.ifEmpty { "Папка" })
    }

    // ---------- права на папки ----------

    private fun hasWrite(ctx: Context, uri: Uri): Boolean = try {
        ctx.contentResolver.persistedUriPermissions.any { it.uri == uri && it.isWritePermission }
    } catch (e: Exception) {
        false
    }

    private fun rootName(ctx: Context, tree: Uri): String? = try {
        val doc = DocumentsContract.buildDocumentUriUsingTree(tree, DocumentsContract.getTreeDocumentId(tree))
        ctx.contentResolver.query(doc, arrayOf(DocumentsContract.Document.COLUMN_DISPLAY_NAME), null, null, null)?.use { c ->
            if (c.moveToFirst()) c.getString(0) else null
        }
    } catch (e: Exception) {
        null
    }

    /** Берёт постоянное право на чтение и запись; null — система не дала запись (папка для сохранения бесполезна). Иначе — название папки. */
    private fun grantAndName(ctx: Context, uri: Uri): String? {
        try {
            ctx.contentResolver.takePersistableUriPermission(uri, Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION)
        } catch (e: Exception) {
            return null
        }
        if (!hasWrite(ctx, uri)) return null
        return rootName(ctx, uri)?.takeIf { it.isNotBlank() } ?: "Папка"
    }

    /** Отпускает право на дерево, если его больше не использует ни одна запись и ни «Музыка», ни «PDF». Вызывается под [lock]. */
    private fun releaseIfUnused(ctx: Context, uriStr: String) {
        if (uriStr.isEmpty()) return
        if (cats.values.any { it.treeUri == uriStr } || rules.values.any { it.treeUri == uriStr }) return
        val uri = Uri.parse(uriStr)
        val music = try { MusicLibrary.treeUri(ctx) } catch (e: Exception) { null }
        val pdf = try { PdfLibrary.treeUri(ctx) } catch (e: Exception) { null }
        if (uri == music || uri == pdf) return
        try {
            ctx.contentResolver.releasePersistableUriPermission(uri, Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION)
        } catch (e: Exception) {
            // права уже нет
        }
    }

    /** Можно ли сейчас писать в дерево: право на запись на месте, папка существует и в ней можно создавать файлы (карта на месте, папку не удалили). */
    fun isWritable(ctx: Context, tree: Uri): Boolean {
        if (!hasWrite(ctx, tree)) return false
        return try {
            val doc = DocumentsContract.buildDocumentUriUsingTree(tree, DocumentsContract.getTreeDocumentId(tree))
            val cols = arrayOf(DocumentsContract.Document.COLUMN_MIME_TYPE, DocumentsContract.Document.COLUMN_FLAGS)
            ctx.contentResolver.query(doc, cols, null, null, null)?.use { c ->
                if (!c.moveToFirst()) false
                else c.getString(0) == DocumentsContract.Document.MIME_TYPE_DIR &&
                    (c.getInt(1) and DocumentsContract.Document.FLAG_DIR_SUPPORTS_CREATE) != 0
            } ?: false
        } catch (e: Exception) {
            false
        }
    }

    // ---------- команды (мост) ----------

    /** Папка выбрана системным окном: берём право, запоминаем и включаем (пользователь сам выбрал её для этого типа). false — запись не дали. */
    fun setFolder(ctx: Context, key: String, uri: Uri): Boolean {
        val label = grantAndName(ctx, uri) ?: return false
        synchronized(lock) {
            ensureLoaded(ctx)
            val e = entryOf(key) ?: return false
            val old = e.treeUri
            e.treeUri = uri.toString()
            e.label = label
            e.enabled = true
            if (old != e.treeUri) releaseIfUnused(ctx, old)
            save(ctx)
        }
        return true
    }

    /** Переключатель «Включено»; включить можно, только когда папка выбрана. Возвращает новое состояние. */
    fun setEnabled(ctx: Context, key: String, on: Boolean): Boolean = synchronized(lock) {
        ensureLoaded(ctx)
        val e = entryOf(key)
        if (e == null) false
        else {
            e.enabled = on && e.treeUri.isNotEmpty()
            save(ctx)
            e.enabled
        }
    }

    /** «Сбросить»: папка забыта, тип выключен (файлы снова идут в «Загрузки»). Правило «своего формата» остаётся в списке без папки. */
    fun reset(ctx: Context, key: String): Boolean = synchronized(lock) {
        ensureLoaded(ctx)
        val e = entryOf(key)
        if (e == null) false
        else {
            val old = e.treeUri
            e.treeUri = ""
            e.label = ""
            e.enabled = false
            releaseIfUnused(ctx, old)
            save(ctx)
            true
        }
    }

    /** «Взять папку из вкладки «Музыка» / «PDF»»: та же папка, если на неё есть право на запись; false — права записи нет (выбрать папку заново). */
    fun useLibrary(ctx: Context, key: String, which: String): Boolean {
        val tree: Uri = when (which) {
            "music" -> try { MusicLibrary.treeUri(ctx) } catch (e: Exception) { null }
            "pdf" -> try { PdfLibrary.treeUri(ctx) } catch (e: Exception) { null }
            else -> null
        } ?: return false
        return setFolder(ctx, key, tree)
    }

    /**
     * Новое правило «своего формата» (без папки, выключено; папку страница просит следом через выбор папки). JSON:
     * {"ok":true,"ext":"zip","overrides":"Архивы"?} или {"ok":false,"error":"...","exists":true?}. Дубль формата заменяется только при [replace].
     */
    fun addRule(ctx: Context, raw: String?, replace: Boolean): String {
        val ext = DownloadRules.normalizeFormat(raw)
        val res = JSONObject().put("ext", ext)
        val err = DownloadRules.formatError(ext)
        if (err != null) return res.put("ok", false).put("error", err).toString()
        synchronized(lock) {
            ensureLoaded(ctx)
            val old = rules[ext]
            if (old != null && !replace) return res.put("ok", false).put("exists", true).put("error", "Такой формат уже есть").toString()
            if (old == null && rules.size >= DownloadRules.MAX_RULES) return res.put("ok", false).put("error", "Не больше " + DownloadRules.MAX_RULES + " правил").toString()
            val oldTree = old?.treeUri ?: ""
            rules[ext] = Entry(ext, false, "", "")
            releaseIfUnused(ctx, oldTree)
            save(ctx)
        }
        res.put("ok", true)
        val over = DownloadRules.overriddenCategoryTitle(ext)
        if (over != null) res.put("overrides", over)
        return res.toString()
    }

    fun removeRule(ctx: Context, raw: String?): Boolean = synchronized(lock) {
        ensureLoaded(ctx)
        val ext = DownloadRules.normalizeFormat(raw)
        val e = rules.remove(ext)
        if (e == null) false
        else {
            releaseIfUnused(ctx, e.treeUri)
            save(ctx)
            true
        }
    }

    /** Всё состояние для вкладки «Сохранение загрузок» (мост `downloadFoldersGet`). */
    fun stateJson(ctx: Context): String {
        val o = JSONObject()
        synchronized(lock) {
            ensureLoaded(ctx)
            val ca = JSONArray()
            for (c in DownloadRules.CATEGORIES) {
                val e = cats[c.key]
                val set = e != null && e.treeUri.isNotEmpty()
                val j = JSONObject().put("key", c.key).put("title", c.title).put("formats", JSONArray(c.formats))
                j.put("set", set)
                j.put("enabled", set && e != null && e.enabled)
                j.put("label", if (set && e != null) e.label else "")
                j.put("ok", if (set && e != null) isWritable(ctx, Uri.parse(e.treeUri)) else true)
                ca.put(j)
            }
            val ra = JSONArray()
            for (e in rules.values) {
                val set = e.treeUri.isNotEmpty()
                val j = JSONObject().put("ext", e.key)
                j.put("set", set)
                j.put("enabled", set && e.enabled)
                j.put("label", if (set) e.label else "")
                j.put("ok", if (set) isWritable(ctx, Uri.parse(e.treeUri)) else true)
                val over = DownloadRules.overriddenCategoryTitle(e.key)
                if (over != null) j.put("overrides", over)
                ra.put(j)
            }
            o.put("categories", ca).put("rules", ra)
        }
        o.put("maxRules", DownloadRules.MAX_RULES).put("maxFormatLen", DownloadRules.MAX_FORMAT_LEN)
        o.put("sdk", Build.VERSION.SDK_INT)
        o.put("music", try { JSONObject(MusicLibrary.folderJson(ctx)) } catch (e: Exception) { JSONObject().put("set", false) })
        o.put("pdf", try { JSONObject(PdfLibrary.folderJson(ctx)) } catch (e: Exception) { JSONObject().put("set", false) })
        return o.toString()
    }

    // ---------- запись в папку ----------

    /**
     * Обычный путь к папке, если в неё можно писать как в обычную (есть «Доступ ко всем файлам» и дерево — внутренняя память или карта).
     * null — только через SAF. На Android 10 без «старого режима» хранилища прямой путь не используем: запись туда не гарантирована.
     */
    fun directDir(ctx: Context, tree: Uri): File? {
        if (!AllFilesAccess.granted(ctx)) return null
        if (Build.VERSION.SDK_INT == Build.VERSION_CODES.Q && !Environment.isExternalStorageLegacy()) return null
        return try {
            if (tree.authority != EXTERNAL_STORAGE_AUTHORITY) null
            else {
                val dir = AllFilesAccess.fileForDocId(DocumentsContract.getTreeDocumentId(tree))
                if (dir != null && dir.isDirectory && dir.canWrite()) dir else null
            }
        } catch (e: Exception) {
            null
        }
    }

    private fun listNames(ctx: Context, tree: Uri): Set<String> {
        val out = HashSet<String>()
        try {
            val children = DocumentsContract.buildChildDocumentsUriUsingTree(tree, DocumentsContract.getTreeDocumentId(tree))
            ctx.contentResolver.query(children, arrayOf(DocumentsContract.Document.COLUMN_DISPLAY_NAME), null, null, null)?.use { c ->
                while (c.moveToNext()) out.add(c.getString(0) ?: "")
            }
        } catch (e: Exception) {
            // список не получен — имя возьмём как есть, провайдер сам разрулит повтор
        }
        return out
    }

    /**
     * Копирует готовый файл [work] в папку-дерево [tree] через SAF под свободным именем («имя (1).ext», если занято). Возвращает итоговое имя.
     * При сбое созданный документ удаляется, бросается [IOException]. Временный файл не трогает.
     */
    fun copyInto(ctx: Context, tree: Uri, work: File, name: String): String {
        val resolver = ctx.contentResolver
        val parent = DocumentsContract.buildDocumentUriUsingTree(tree, DocumentsContract.getTreeDocumentId(tree))
        val taken = listNames(ctx, tree)
        val finalName = DownloadLogic.uniqueName(name) { taken.contains(it) }
        val doc: Uri = try {
            DocumentsContract.createDocument(resolver, parent, FileSaver.mimeForName(finalName), finalName)
        } catch (e: Exception) {
            null
        } ?: throw IOException("Не удалось создать файл в папке")
        try {
            val out = resolver.openOutputStream(doc, "w") ?: throw IOException("Не удалось открыть файл в папке")
            out.use { o -> work.inputStream().use { it.copyTo(o, 1 shl 16) } }
        } catch (e: Exception) {
            try { DocumentsContract.deleteDocument(resolver, doc) } catch (e2: Exception) { }
            throw if (e is IOException) e else IOException(e.message ?: "Не удалось записать файл в папку")
        }
        return finalName
    }

    /** Создаёт пустой документ в дереве для потоковой записи ([FileSaver]); null — не вышло. */
    fun createDocument(ctx: Context, tree: Uri, name: String): Uri? {
        return try {
            val parent = DocumentsContract.buildDocumentUriUsingTree(tree, DocumentsContract.getTreeDocumentId(tree))
            val taken = listNames(ctx, tree)
            val finalName = DownloadLogic.uniqueName(name) { taken.contains(it) }
            DocumentsContract.createDocument(ctx.contentResolver, parent, FileSaver.mimeForName(finalName), finalName)
        } catch (e: Exception) {
            null
        }
    }
}
