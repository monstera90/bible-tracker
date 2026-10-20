package com.app.lifetracker
// Версия: 1.0 (20.10)

import android.content.Context
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.drawable.Icon
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import androidx.core.content.ContextCompat
import org.json.JSONObject

/**
 * Динамический остров Xiaomi (HyperOS 3 «Суперостров», HyperOS 2 — «фокусные уведомления») для таймеров карточек.
 * Протокол Xiaomi: в extras обычного уведомления кладутся JSON `miui.focus.param` (раздел `param_v2`) и картинки
 * `miui.focus.pics`; на других телефонах эти extras ни на что не влияют, уведомление остаётся обычным.
 *
 * Остров показывается, только если (1) телефон Xiaomi/Redmi/POCO с HyperOS, где `notification_focus_protocol` ≥ 2, и
 * (2) у приложения включено разрешение «фокусные уведомления / остров» (настройки уведомлений приложения; Xiaomi
 * выдаёт его по своим правилам). Любая ошибка здесь не мешает таймеру: [extras] вернёт null и уведомление пойдёт обычное.
 */
object XiaomiIsland {

    private const val PIC_KEY = "miui.focus.pic_timer"

    fun isXiaomiDevice(): Boolean {
        val m = (Build.MANUFACTURER ?: "").lowercase()
        val b = (Build.BRAND ?: "").lowercase()
        return m.contains("xiaomi") || b.contains("xiaomi") || b.contains("redmi") || b.contains("poco")
    }

    /** 0 — нет фокусных уведомлений; 2 — HyperOS 2 (статус-бар); 3 — HyperOS 3 (остров). */
    fun protocolVersion(ctx: Context): Int = try {
        Settings.System.getInt(ctx.contentResolver, "notification_focus_protocol", 0)
    } catch (e: Exception) {
        0
    }

    /** Включено ли у приложения разрешение на фокусные уведомления (системный провайдер Xiaomi). */
    fun hasFocusPermission(ctx: Context): Boolean = try {
        val extras = Bundle().apply { putString("package", ctx.packageName) }
        val res = ctx.contentResolver.call(
            android.net.Uri.parse("content://miui.statusbar.notification.public"), "canShowFocus", null, extras
        )
        res?.getBoolean("canShowFocus", false) ?: false
    } catch (e: Exception) {
        false
    }

    fun available(ctx: Context): Boolean =
        Build.VERSION.SDK_INT >= Build.VERSION_CODES.M && isXiaomiDevice() && protocolVersion(ctx) >= 2

    /**
     * Extras для уведомления идущего таймера (обратный отсчёт до [endAt]) или null, если остров не поддерживается.
     * [float] — раскрыть остров при появлении (запуск/продолжение), false — тихое обновление (восстановление после перезагрузки).
     */
    fun runningExtras(ctx: Context, title: String, endAt: Long, float: Boolean): Bundle? {
        if (!available(ctx)) return null
        return try {
            val now = System.currentTimeMillis()
            val timer = JSONObject().put("timerType", -1).put("timerWhen", endAt).put("timerSystemCurrent", now)
            build(ctx, title, "Таймер идёт", timer, endAt, now, float)
        } catch (e: Exception) {
            null
        }
    }

    /** Extras для приостановленного таймера: остаток показывается текстом (счётчик не тикает). */
    fun pausedExtras(ctx: Context, title: String, leftText: String): Bundle? {
        if (!available(ctx)) return null
        return try {
            build(ctx, title, "Пауза · осталось $leftText", null, 0L, System.currentTimeMillis(), false)
        } catch (e: Exception) {
            null
        }
    }

    private fun build(ctx: Context, title: String, status: String, timer: JSONObject?, endAt: Long, now: Long, float: Boolean): Bundle {
        val pic = JSONObject().put("type", 1).put("pic", PIC_KEY)
        val left = JSONObject().put("type", 1).put("picInfo", pic)
            .put("textInfo", JSONObject().put("title", title).put("content", if (timer == null) status else ""))
        val big = JSONObject().put("imageTextInfoLeft", left)
        if (timer != null) big.put("sameWidthDigitInfo", JSONObject().put("timerInfo", timer)) else big.put("picInfo", pic)
        val island = JSONObject()
            .put("islandProperty", 1)
            .put("bigIslandArea", big)
            .put("smallIslandArea", JSONObject().put("picInfo", pic))
        if (timer != null) {
            val sec = ((endAt - now) / 1000).coerceAtLeast(1) + 5
            island.put("islandTimeout", sec)
        }
        val v2 = JSONObject()
            .put("protocol", 1)
            .put("business", "card_timer")
            .put("islandFirstFloat", float)
            .put("enableFloat", false)
            .put("updatable", true)
            .put("ticker", title)
            .put("tickerPic", PIC_KEY)
            .put("aodTitle", title)
            .put("param_island", island)
            .put("baseInfo", JSONObject().put("type", 2).put("title", title).put("content", status))
        if (timer != null) {
            v2.put("hintInfo", JSONObject().put("type", 1).put("timerInfo", timer))
            val minutes = ((endAt - now) / 60000).coerceAtLeast(1) + 1
            v2.put("timeout", minutes)
        }
        val pics = Bundle().apply { putParcelable(PIC_KEY, icon(ctx)) }
        return Bundle().apply {
            putString("miui.focus.param", JSONObject().put("param_v2", v2).toString())
            putBundle("miui.focus.pics", pics)
        }
    }

    /** Цветная иконка таймера для острова: фиолетовый круг с QR (как значок ярлыка сканера). */
    private fun icon(ctx: Context): Icon {
        val size = 96
        val bmp = Bitmap.createBitmap(size, size, Bitmap.Config.ARGB_8888)
        val d = ContextCompat.getDrawable(ctx, R.drawable.ic_shortcut_scan_qr)
        if (d != null) {
            d.setBounds(0, 0, size, size)
            d.draw(Canvas(bmp))
        }
        return Icon.createWithBitmap(bmp)
    }
}
