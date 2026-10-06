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

    /** Страница сообщает, что успешно запустилась (на шаге 3 по этому вызову подтверждается новая версия веб-бандла). */
    @JavascriptInterface
    fun appReady(version: String?) {
        // Шаг 3 (live-update): подтверждение запуска и откат. Пока ничего не делает.
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
