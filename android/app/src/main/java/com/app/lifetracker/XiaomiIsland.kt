package com.app.lifetracker
// Версия: 2.0 (21.10) — значок острова рисуется кодом: песочные часы на цветном круге, цвет по этапу (`stageFor`: фиолетовый / жёлтый за 2 минуты / красный за минуту); в `timerInfo` добавлено `timerTotal` (в примерах Xiaomi поле есть у каждого таймера; отсчёт на острове замирал после первой секунды — связь с отсутствием поля предположительная, проверяется на телефоне). Откат: XiaomiIsland.kt 1.0.
// Версия: 1.0 (20.10)

import android.content.Context
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Path
import android.graphics.RectF
import android.graphics.drawable.Icon
import android.os.Build
import android.os.Bundle
import android.provider.Settings
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

    /** Этапы цвета значка: до «жёлтого» — фиолетовый, за 2 минуты до конца — жёлтый, за минуту — красный. */
    const val STAGE_NORMAL = 0
    const val STAGE_YELLOW = 1
    const val STAGE_RED = 2
    const val YELLOW_MS = 120_000L
    const val RED_MS = 60_000L

    // допуск 1 с: будильник этапа может сработать на несколько мс раньше срока — цвет всё равно должен смениться
    fun stageFor(leftMs: Long): Int = when {
        leftMs <= RED_MS + 1000 -> STAGE_RED
        leftMs <= YELLOW_MS + 1000 -> STAGE_YELLOW
        else -> STAGE_NORMAL
    }

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
    fun runningExtras(ctx: Context, title: String, endAt: Long, totalMs: Long, float: Boolean): Bundle? {
        if (!available(ctx)) return null
        return try {
            val now = System.currentTimeMillis()
            val timer = JSONObject().put("timerType", -1).put("timerWhen", endAt)
                .put("timerTotal", totalMs.coerceAtLeast(1L)).put("timerSystemCurrent", now)
            build(ctx, title, "Таймер идёт", timer, endAt, now, float, stageFor(endAt - now))
        } catch (e: Exception) {
            null
        }
    }

    /** Extras для приостановленного таймера: остаток показывается текстом (счётчик не тикает). */
    fun pausedExtras(ctx: Context, title: String, leftText: String, leftMs: Long): Bundle? {
        if (!available(ctx)) return null
        return try {
            build(ctx, title, "Пауза · осталось $leftText", null, 0L, System.currentTimeMillis(), false, stageFor(leftMs))
        } catch (e: Exception) {
            null
        }
    }

    private fun build(ctx: Context, title: String, status: String, timer: JSONObject?, endAt: Long, now: Long, float: Boolean, stage: Int): Bundle {
        // у каждого этапа свой ключ картинки: система не подставит старую (фиолетовую) из кэша
        val picKey = PIC_KEY + stage
        val pic = JSONObject().put("type", 1).put("pic", picKey)
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
            .put("tickerPic", picKey)
            .put("aodTitle", title)
            .put("param_island", island)
            .put("baseInfo", JSONObject().put("type", 2).put("title", title).put("content", status))
        if (timer != null) {
            v2.put("hintInfo", JSONObject().put("type", 1).put("timerInfo", timer))
            val minutes = ((endAt - now) / 60000).coerceAtLeast(1) + 1
            v2.put("timeout", minutes)
        }
        val pics = Bundle().apply { putParcelable(picKey, icon(stage)) }
        return Bundle().apply {
            putString("miui.focus.param", JSONObject().put("param_v2", v2).toString())
            putBundle("miui.focus.pics", pics)
        }
    }

    /**
     * Значок таймера для острова: цветной круг и белые песочные часы (на жёлтом — тёмные, иначе не видно).
     * Цвет по этапу: фиолетовый #7F00FF (как значок сканера), жёлтый, красный.
     */
    private fun icon(stage: Int): Icon {
        val size = 96
        val bg = when (stage) {
            STAGE_RED -> 0xFFE53935.toInt()
            STAGE_YELLOW -> 0xFFFFC400.toInt()
            else -> 0xFF7F00FF.toInt()
        }
        val fg = if (stage == STAGE_YELLOW) 0xFF2B2200.toInt() else Color.WHITE
        val bmp = Bitmap.createBitmap(size, size, Bitmap.Config.ARGB_8888)
        val c = Canvas(bmp)
        val paint = Paint(Paint.ANTI_ALIAS_FLAG)
        paint.style = Paint.Style.FILL
        paint.color = bg
        c.drawCircle(size / 2f, size / 2f, size / 2f, paint)

        paint.color = fg
        // крышка и дно
        c.drawRoundRect(RectF(27f, 21f, 69f, 27f), 3f, 3f, paint)
        c.drawRoundRect(RectF(27f, 69f, 69f, 75f), 3f, 3f, paint)
        // колба: две воронки, сходящиеся к горлышку
        val glass = Path().apply {
            moveTo(33f, 27f); lineTo(63f, 27f); lineTo(50f, 48f)
            lineTo(63f, 69f); lineTo(33f, 69f); lineTo(46f, 48f); close()
        }
        paint.style = Paint.Style.STROKE
        paint.strokeWidth = 4f
        paint.strokeJoin = Paint.Join.ROUND
        c.drawPath(glass, paint)
        // песок: верхняя горка, струйка, нижняя горка
        paint.style = Paint.Style.FILL
        c.drawPath(Path().apply { moveTo(39f, 31f); lineTo(57f, 31f); lineTo(48f, 43f); close() }, paint)
        paint.strokeWidth = 2f
        paint.style = Paint.Style.STROKE
        c.drawLine(48f, 44f, 48f, 58f, paint)
        paint.style = Paint.Style.FILL
        c.drawPath(Path().apply { moveTo(38f, 66f); lineTo(58f, 66f); lineTo(48f, 55f); close() }, paint)
        return Icon.createWithBitmap(bmp)
    }
}
