package com.app.lifetracker
// Версия: 5.0 (21.10) — круглая кнопка паузы в раскрытом острове (`pauseAction`, `pauseBitmap`): кольцо оставшегося времени цвета этапа и две полоски «пауза», слева от «Стоп»; рисуется кодом, кольцо обновляется тиком раз в секунду. Откат: XiaomiIsland.kt 4.0.
// Версия: 4.0 (21.10) — `iconBitmap` и `crossBitmap` вынесены (значок и крестик нужны плашке InAppIsland); `icon`/`crossIcon` — обёртки. Откат: XiaomiIsland.kt 3.2.
// Версия: 3.2 (21.10) — эмблема раскрытого острова та же, что в свёрнутом: цветной круг (фиолетовый/жёлтый/красный) и белые песочные часы, только крупнее (`icon(stage, 192)`); отдельный рисунок `bigIcon` удалён. Откат: XiaomiIsland.kt 3.1.
// Версия: 3.1 (21.10) — раскрытый вид через `iconTextInfo` с `animIconInfo` (значок слева, `baseInfo` и корневой `picInfo` убраны: значок в них не показывался); песочные часы на жёлтом круге — белые; кнопка «Стоп» — тёмный круг с белым крестиком. Откат: XiaomiIsland.kt 3.0 (без значка, но с временем и «Стоп»).
// Версия: 3.0 (21.10) — раскрытый остров как у часов: крупное время в заголовке (`clockText`, обновляется тиком), большой значок песочных часов без круга (`bigIcon`, цвет по этапу), кнопка «Стоп» (`miui.focus.actions`); `hintInfo` убран. Откат: XiaomiIsland.kt 2.1.
// Версия: 2.1 (21.10) — в `param_island` добавлены `islandOrder=true` и `dismissIsland=false` (остров должен возвращаться, если система его убрала, пока приложение на экране; эффект проверяется на телефоне). Откат: XiaomiIsland.kt 2.0.
// Версия: 2.0 (21.10) — значок острова рисуется кодом: песочные часы на цветном круге, цвет по этапу (`stageFor`: фиолетовый / жёлтый за 2 минуты / красный за минуту); в `timerInfo` добавлено `timerTotal` (в примерах Xiaomi поле есть у каждого таймера; отсчёт на острове замирал после первой секунды — связь с отсутствием поля предположительная, проверяется на телефоне). Откат: XiaomiIsland.kt 1.0.
// Версия: 1.0 (20.10)

import android.app.Notification
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
    private const val PIC_BIG_KEY = "miui.focus.pic_timer_big"
    private const val ACTION_KEY = "miui.focus.action_stop"
    private const val ACTION_PAUSE_KEY = "miui.focus.action_pause"

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
    fun runningExtras(ctx: Context, title: String, endAt: Long, totalMs: Long, float: Boolean, stopAction: Notification.Action?, pauseAction: Notification.Action? = null): Bundle? {
        if (!available(ctx)) return null
        return try {
            val now = System.currentTimeMillis()
            val timer = JSONObject().put("timerType", -1).put("timerWhen", endAt)
                .put("timerTotal", totalMs.coerceAtLeast(1L)).put("timerSystemCurrent", now)
            build(ctx, title, "Таймер идёт", timer, endAt, now, float, stageFor(endAt - now), stopAction, pauseAction)
        } catch (e: Exception) {
            null
        }
    }

    /** Время для заголовка раскрытого острова: М:СС или Ч:ММ:СС (округление вверх, как на карточке). */
    fun clockText(leftMs: Long): String {
        val s = ((leftMs + 999) / 1000).coerceAtLeast(0)
        val h = s / 3600
        val m = (s % 3600) / 60
        val sec = s % 60
        return if (h > 0) String.format(java.util.Locale.US, "%d:%02d:%02d", h, m, sec) else String.format(java.util.Locale.US, "%d:%02d", m, sec)
    }

    /** Кнопка «Стоп» для раскрытого острова: белый крестик в круге-иконке, действие — PendingIntent вызывающего. */
    fun stopAction(pending: android.app.PendingIntent): Notification.Action? = try {
        Notification.Action.Builder(crossIcon(), "Стоп", pending).build()
    } catch (e: Exception) {
        null
    }

    /** Extras для приостановленного таймера: остаток показывается текстом (счётчик не тикает). */
    fun pausedExtras(ctx: Context, title: String, leftText: String, leftMs: Long): Bundle? {
        if (!available(ctx)) return null
        return try {
            build(ctx, title, "Пауза · осталось $leftText", null, 0L, System.currentTimeMillis(), false, stageFor(leftMs), null, null)
        } catch (e: Exception) {
            null
        }
    }

    private fun build(ctx: Context, title: String, status: String, timer: JSONObject?, endAt: Long, now: Long, float: Boolean, stage: Int, stopAction: Notification.Action?, pauseAction: Notification.Action?): Bundle {
        // у каждого этапа свой ключ картинки: система не подставит старую (фиолетовую) из кэша
        val picKey = PIC_KEY + stage
        val bigKey = PIC_BIG_KEY + stage
        val pic = JSONObject().put("type", 1).put("pic", picKey)
        val left = JSONObject().put("type", 1).put("picInfo", pic)
            .put("textInfo", JSONObject().put("title", title).put("content", if (timer == null) status else ""))
        val big = JSONObject().put("imageTextInfoLeft", left)
        if (timer != null) big.put("sameWidthDigitInfo", JSONObject().put("timerInfo", timer)) else big.put("picInfo", pic)
        val island = JSONObject()
            .put("islandProperty", 1)
            .put("islandOrder", true)
            .put("dismissIsland", false)
            .put("bigIslandArea", big)
            .put("smallIslandArea", JSONObject().put("picInfo", pic))
        if (timer != null) {
            val sec = ((endAt - now) / 1000).coerceAtLeast(1) + 5
            island.put("islandTimeout", sec)
        }
        // раскрытый остров и карточка в шторке: большая эмблема слева, крупное время (бегущее — заголовок), название под ним
        val anim = JSONObject().put("type", 0).put("src", bigKey)
        val base = if (timer != null) {
            JSONObject().put("type", 1).put("title", clockText(endAt - now)).put("content", title).put("animIconInfo", anim)
        } else {
            JSONObject().put("type", 1).put("title", title).put("content", status).put("animIconInfo", anim)
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
            .put("iconTextInfo", base)
        if (timer != null) {
            val minutes = ((endAt - now) / 60000).coerceAtLeast(1) + 1
            v2.put("timeout", minutes)
        }
        val pics = Bundle().apply {
            putParcelable(picKey, icon(stage))
            putParcelable(bigKey, bigIcon(stage))
        }
        val out = Bundle().apply {
            putBundle("miui.focus.pics", pics)
        }
        if (stopAction != null) {
            // слева направо: пауза (круг с кольцом), затем «Стоп»
            val list = org.json.JSONArray()
            val acts = Bundle()
            if (pauseAction != null) {
                list.put(JSONObject().put("action", ACTION_PAUSE_KEY))
                acts.putParcelable(ACTION_PAUSE_KEY, pauseAction)
            }
            list.put(JSONObject().put("action", ACTION_KEY))
            acts.putParcelable(ACTION_KEY, stopAction)
            v2.put("actions", list)
            out.putBundle("miui.focus.actions", acts)
        }
        out.putString("miui.focus.param", JSONObject().put("param_v2", v2).toString())
        return out
    }

    /** Крупная эмблема для раскрытого острова: тот же значок, что в свёрнутом, вдвое крупнее. */
    private fun bigIcon(stage: Int): Icon = icon(stage, 192)

    /** Кнопка «Пауза» для раскрытого острова: кольцо оставшегося времени и две полоски. */
    fun pauseAction(pending: android.app.PendingIntent, leftMs: Long, totalMs: Long, stage: Int): Notification.Action? = try {
        val fraction = (leftMs.toFloat() / totalMs.coerceAtLeast(1L)).coerceIn(0f, 1f)
        Notification.Action.Builder(Icon.createWithBitmap(pauseBitmap(fraction, stage)), "Пауза", pending).build()
    } catch (e: Exception) {
        null
    }

    private fun stageColor(stage: Int): Int = when (stage) {
        STAGE_RED -> 0xFFE53935.toInt()
        STAGE_YELLOW -> 0xFFFFC400.toInt()
        else -> 0xFF7F00FF.toInt()
    }

    /** Круглая кнопка паузы: тёмный круг, кольцо цвета этапа (доля [fraction] — сколько времени осталось, от верха по часовой), две полоски. */
    fun pauseBitmap(fraction: Float, stage: Int): Bitmap {
        val size = 96
        val bmp = Bitmap.createBitmap(size, size, Bitmap.Config.ARGB_8888)
        val c = Canvas(bmp)
        val paint = Paint(Paint.ANTI_ALIAS_FLAG)
        paint.color = 0xFF2A2A2A.toInt()
        paint.style = Paint.Style.FILL
        c.drawCircle(size / 2f, size / 2f, size / 2f, paint)
        val color = stageColor(stage)
        val ring = RectF(8f, 8f, 88f, 88f)
        paint.style = Paint.Style.STROKE
        paint.strokeWidth = 6f
        paint.color = 0xFF444444.toInt()
        c.drawArc(ring, 0f, 360f, false, paint)
        paint.color = color
        paint.strokeCap = Paint.Cap.ROUND
        if (fraction >= 0.999f) c.drawArc(ring, 0f, 360f, false, paint)
        else if (fraction > 0f) c.drawArc(ring, -90f, 360f * fraction, false, paint)
        paint.style = Paint.Style.FILL
        c.drawRoundRect(RectF(35f, 31f, 44f, 65f), 3f, 3f, paint)
        c.drawRoundRect(RectF(52f, 31f, 61f, 65f), 3f, 3f, paint)
        return bmp
    }

    /** Значок кнопки «Стоп»: белый крестик. */
    private fun crossIcon(): Icon = Icon.createWithBitmap(crossBitmap())

    fun crossBitmap(): Bitmap {
        val size = 96
        val bmp = Bitmap.createBitmap(size, size, Bitmap.Config.ARGB_8888)
        val c = Canvas(bmp)
        val paint = Paint(Paint.ANTI_ALIAS_FLAG)
        paint.color = 0xFF2A2A2A.toInt()
        paint.style = Paint.Style.FILL
        c.drawCircle(size / 2f, size / 2f, size / 2f, paint)
        paint.color = Color.WHITE
        paint.style = Paint.Style.STROKE
        paint.strokeWidth = 8f
        paint.strokeCap = Paint.Cap.ROUND
        c.drawLine(32f, 32f, 64f, 64f, paint)
        c.drawLine(64f, 32f, 32f, 64f, paint)
        return bmp
    }

    /**
     * Значок таймера для острова: цветной круг и белые песочные часы (на жёлтом тоже белые).
     * Цвет по этапу: фиолетовый #7F00FF (как значок сканера), жёлтый, красный.
     */
    fun iconBitmap(stage: Int, size: Int = 96): Bitmap {
        val bg = when (stage) {
            STAGE_RED -> 0xFFE53935.toInt()
            STAGE_YELLOW -> 0xFFFFC400.toInt()
            else -> 0xFF7F00FF.toInt()
        }
        val fg = Color.WHITE
        val bmp = Bitmap.createBitmap(size, size, Bitmap.Config.ARGB_8888)
        val c = Canvas(bmp)
        c.scale(size / 96f, size / 96f) // рисунок рассчитан на 96 px, при другом размере масштабируется
        val paint = Paint(Paint.ANTI_ALIAS_FLAG)
        paint.style = Paint.Style.FILL
        paint.color = bg
        c.drawCircle(48f, 48f, 48f, paint)

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
        return bmp
    }

    private fun icon(stage: Int, size: Int = 96): Icon = Icon.createWithBitmap(iconBitmap(stage, size))
}
