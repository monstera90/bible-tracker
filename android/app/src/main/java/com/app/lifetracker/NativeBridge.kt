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
