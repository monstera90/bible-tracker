package com.app.lifetracker
// Версия: 1.0 (10.11)

import android.Manifest
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.provider.Settings
import org.json.JSONObject
import java.io.File

/**
 * Доступ приложения ко всем файлам устройства (удаление треков во вкладке «Музыка», дальше — файловый менеджер).
 * Android 11+ — специальное разрешение «Доступ ко всем файлам» (MANAGE_EXTERNAL_STORAGE, выдаётся на отдельном экране настроек);
 * Android 6–10 — обычные разрешения READ/WRITE_EXTERNAL_STORAGE; Android 5 — выдаётся при установке.
 * Запрос делает [MainActivity.requestAllFilesAccess], страница узнаёт ответ через window.__ltOnAllFiles(true|false).
 */
object AllFilesAccess {

    /** Есть ли у приложения доступ ко всем файлам. */
    fun granted(ctx: Context): Boolean = when {
        Build.VERSION.SDK_INT >= Build.VERSION_CODES.R -> Environment.isExternalStorageManager()
        Build.VERSION.SDK_INT >= Build.VERSION_CODES.M ->
            ctx.checkSelfPermission(Manifest.permission.READ_EXTERNAL_STORAGE) == PackageManager.PERMISSION_GRANTED &&
                ctx.checkSelfPermission(Manifest.permission.WRITE_EXTERNAL_STORAGE) == PackageManager.PERMISSION_GRANTED
        else -> true
    }

    /** true — разрешение выдаётся на экране настроек (Android 11+), false — обычным системным запросом. */
    fun usesSettingsScreen(): Boolean = Build.VERSION.SDK_INT >= Build.VERSION_CODES.R

    /** Экран настроек «Доступ ко всем файлам» для этого приложения (только Android 11+). */
    fun settingsIntent(ctx: Context): Intent =
        Intent(Settings.ACTION_MANAGE_APP_ALL_FILES_ACCESS_PERMISSION, Uri.parse("package:" + ctx.packageName))

    /** Общий список приложений на том же экране — запасной путь, если экран конкретного приложения не открылся. */
    fun settingsListIntent(): Intent = Intent(Settings.ACTION_MANAGE_ALL_FILES_ACCESS_PERMISSION)

    /** JSON для страницы: {"granted":true|false,"sdk":34}. */
    fun stateJson(ctx: Context): String =
        JSONObject().put("granted", granted(ctx)).put("sdk", Build.VERSION.SDK_INT).toString()

    /**
     * Путь к файлу на диске по id документа системного хранилища: «primary:Music/a.mp3» → <внутренняя память>/Music/a.mp3,
     * «1A2B-3C4D:Music/a.mp3» → /storage/1A2B-3C4D/Music/a.mp3. null — id другого поставщика или с «..».
     */
    fun fileForDocId(docId: String): File? {
        val i = docId.indexOf(':')
        if (i <= 0) return null
        val volume = docId.substring(0, i)
        val rel = docId.substring(i + 1)
        if (rel.split('/').any { it == ".." }) return null
        val base = when {
            volume.equals("primary", ignoreCase = true) -> Environment.getExternalStorageDirectory()
            Regex("[A-Za-z0-9-]{1,40}").matches(volume) -> File("/storage/$volume")
            else -> return null
        }
        return if (rel.isEmpty()) base else File(base, rel)
    }
}
