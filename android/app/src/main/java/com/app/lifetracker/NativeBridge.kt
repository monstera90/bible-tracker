package com.app.lifetracker

import android.graphics.Color
import android.os.Build
import android.webkit.JavascriptInterface
import org.json.JSONObject

/**
 * Мост «веб → нативная оболочка»: в странице доступен как window.LifeTrackerNative.
 * Каждый метод помечен @JavascriptInterface и работает только пока загружена страница https://localhost.
 * Новые методы добавляются на своих шагах (скачивание, уведомления, share, полноэкранный режим и т.д.).
 */
class NativeBridge(private val activity: MainActivity) {

    companion object {
        /** 1: шаги 2-3 (статус-бар, live-update); 2: шаг 4 (сохранение, «Поделиться», полный экран, приём файлов). */
        const val BRIDGE_VERSION = 2
    }

    /** JSON: {"shell":"kotlin","versionName":"...","versionCode":N,"sdk":N}. Пустой объект, если страница не доверенная. */
    @JavascriptInterface
    fun getAppInfo(): String {
        if (!activity.pageTrusted) return "{}"
        return try {
            val info = activity.packageManager.getPackageInfo(activity.packageName, 0)
            JSONObject()
                .put("shell", "kotlin")
                .put("versionName", info.versionName ?: "")
                .put("versionCode", info.longVersionCode)
                .put("sdk", Build.VERSION.SDK_INT)
                .put("bridgeVersion", BRIDGE_VERSION)
                .toString()
        } catch (e: Exception) {
            "{}"
        }
    }

    /**
     * Страница сообщает, что успешно запустилась (my.js, после загрузки страницы и чтения version.json бандла).
     * Подтверждает пробный запуск скачанной версии веб-части (live-update, WebUpdater); иначе при следующем
     * запуске версия откатится на предыдущую рабочую.
     */
    @JavascriptInterface
    fun appReady(version: String?) {
        if (!activity.pageTrusted) return
        try {
            activity.webUpdater.confirm(version)
        } catch (e: Exception) {
            // Подтверждение не записалось: версия откатится при следующем запуске, приложение продолжает работать.
        }
    }

    /** JSON с состоянием live-update (для страницы диагностики). */
    @JavascriptInterface
    fun getWebUpdateState(): String {
        if (!activity.pageTrusted) return "{}"
        return try {
            activity.webUpdater.describe()
        } catch (e: Exception) {
            "{}"
        }
    }

    /** Запускает проверку обновления веб-части прямо сейчас (в фоне); результат виден в getWebUpdateState(). */
    @JavascriptInterface
    fun checkWebUpdateNow() {
        if (!activity.pageTrusted) return
        activity.webUpdater.checkInBackground(true)
    }

    /** Самотест live-update на устройстве (без сети, в отдельной папке): текст с ✅/❌. */
    @JavascriptInterface
    fun runWebUpdateSelfTest(): String {
        if (!activity.pageTrusted) return "страница не доверенная"
        return try {
            activity.webUpdater.selfTest()
        } catch (e: Exception) {
            "самотест не запустился: $e"
        }
    }

    // ===== Шаг 4: сохранение файлов в «Загрузки» (куски base64 от native-shell.js) =====

    /** Начало сохранения файла в «Загрузки». Идентификатор сессии или "" при ошибке (страница тогда откатывается на старый путь). */
    @JavascriptInterface
    fun beginSave(name: String?): String {
        if (!activity.pageTrusted) return ""
        return activity.fileSaver.beginSave(name)
    }

    /** Очередной кусок файла (base64 без префикса). false: запись не удалась, сессия отменена. */
    @JavascriptInterface
    fun appendSave(id: String?, base64: String?): Boolean {
        if (!activity.pageTrusted) return false
        return activity.fileSaver.append(id, base64)
    }

    /** Завершает сохранение. JSON {"ok":true,"name":"...","bytes":N} или {"ok":false,"error":"..."}; показывает уведомление «Сохранено». */
    @JavascriptInterface
    fun finishSave(id: String?): String {
        if (!activity.pageTrusted) return "{\"ok\":false,\"error\":\"страница не доверенная\"}"
        val result = activity.fileSaver.finish(id)
        try {
            val json = JSONObject(result)
            if (json.optBoolean("ok")) activity.toast("Сохранено в «Загрузки»: " + json.optString("name"))
        } catch (e: Exception) {
            // результат всё равно возвращается странице
        }
        return result
    }

    /** Отмена сохранения или подготовки файла: недописанное удаляется. */
    @JavascriptInterface
    fun cancelSave(id: String?) {
        if (!activity.pageTrusted) return
        activity.fileSaver.cancel(id)
    }

    /** Короткое сообщение внизу экрана (ошибки сохранения и т.п.). */
    @JavascriptInterface
    fun showToast(text: String?) {
        if (!activity.pageTrusted || text.isNullOrEmpty()) return
        activity.toast(text.take(300))
    }

    // ===== Шаг 4: системное меню «Поделиться» (замена navigator.share, которого в WebView нет) =====

    /** Начало подготовки файла для «Поделиться». Дальше appendSave, затем finishStage (или cancelSave). */
    @JavascriptInterface
    fun beginStage(name: String?): String {
        if (!activity.pageTrusted) return ""
        return activity.fileSaver.beginStage(name)
    }

    /** Завершает подготовку файла для «Поделиться» (без уведомления «Сохранено»). Формат ответа как у finishSave. */
    @JavascriptInterface
    fun finishStage(id: String?): String {
        if (!activity.pageTrusted) return "{\"ok\":false,\"error\":\"страница не доверенная\"}"
        return activity.fileSaver.finish(id)
    }

    /** Открывает меню «Поделиться» для файлов, подготовленных через beginStage (title и text необязательны). */
    @JavascriptInterface
    fun shareStaged(title: String?, text: String?): Boolean {
        if (!activity.pageTrusted) return false
        val intent = activity.fileSaver.buildShareIntent(title, text) ?: return false
        return activity.startChooser(intent)
    }

    /** Меню «Поделиться» для текста или ссылки без файлов. */
    @JavascriptInterface
    fun shareText(title: String?, text: String?): Boolean {
        if (!activity.pageTrusted) return false
        if (text.isNullOrEmpty()) return false
        val send = android.content.Intent(android.content.Intent.ACTION_SEND).apply {
            type = "text/plain"
            putExtra(android.content.Intent.EXTRA_TEXT, text)
            if (!title.isNullOrEmpty()) putExtra(android.content.Intent.EXTRA_SUBJECT, title)
        }
        return activity.startChooser(android.content.Intent.createChooser(send, title ?: ""))
    }

    /** Сбрасывает подготовленные, но не отправленные файлы (например, при ошибке посреди подготовки). */
    @JavascriptInterface
    fun clearStaged() {
        if (!activity.pageTrusted) return
        activity.fileSaver.clearStaged()
    }

    // ===== Шаг 4: полноэкранный режим (замена requestFullscreen) =====

    /** Включает/выключает полноэкранный режим: скрыты строка состояния и системная навигация, показываются свайпом с края. */
    @JavascriptInterface
    fun setFullscreen(enabled: Boolean) {
        if (!activity.pageTrusted) return
        activity.runOnUiThread { activity.applyFullscreen(enabled) }
    }

    // ===== Шаг 4: приём файлов из «Поделиться» (замена Web Share Target) =====

    /** JSON-массив принятых файлов [{id, name, type, size}]. Повторный вызов тех же файлов не вернёт. */
    @JavascriptInterface
    fun takeSharedFiles(): String {
        if (!activity.pageTrusted) return "[]"
        return SharedInbox.takeJson()
    }

    /** Страница забрала файл (fetch ./__shared/<id>): временная копия удаляется. */
    @JavascriptInterface
    fun releaseSharedFile(id: String?) {
        if (!activity.pageTrusted || id == null) return
        SharedInbox.release(id)
    }

    /** Цвет статус-бара: "#rrggbb", "#rgb" или "rgb(r, g, b)". Значок светлый/тёмный выбирается по яркости цвета. */
    @JavascriptInterface
    fun setStatusBarColor(color: String?) {
        if (!activity.pageTrusted) return
        val parsed = parseCssColor(color) ?: return
        activity.runOnUiThread { activity.applyStatusBarColor(parsed) }
    }

    private fun parseCssColor(source: String?): Int? {
        val value = source?.trim() ?: return null
        if (value.isEmpty()) return null

        val rgb = Regex("""rgba?\(\s*(\d{1,3})[\s,]+(\d{1,3})[\s,]+(\d{1,3})""").find(value)
        if (rgb != null) {
            val (r, g, b) = rgb.destructured
            return Color.rgb(r.toInt().coerceIn(0, 255), g.toInt().coerceIn(0, 255), b.toInt().coerceIn(0, 255))
        }

        var hex = value
        if (Regex("^#[0-9a-fA-F]{3}$").matches(hex)) {
            hex = "#" + hex.substring(1).map { "$it$it" }.joinToString("")
        }
        return try {
            Color.parseColor(hex) or 0xFF000000.toInt()
        } catch (e: IllegalArgumentException) {
            null
        }
    }
}
