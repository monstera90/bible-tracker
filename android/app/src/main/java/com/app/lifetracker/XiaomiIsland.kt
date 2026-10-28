package com.app.lifetracker
// Версия: 7.0 (27.10) — остров записи тренировки: `workoutExtras` (метка-диод красная/жёлтая/зелёная, время и дистанция, кнопки «Пауза» и «Стоп»), `workoutDotBitmap`, `elapsedText`. Откат: XiaomiIsland.kt 6.0.
// Версия: 6.0 (25.10) — остров плеера «Музыка»: `musicExtras` (значок-нота, название трека и папка, кнопки «Назад / Пауза-Играть / Вперёд»), `musicIconBitmap`, `musicButtonBitmap`. Откат: XiaomiIsland.kt 5.2.
// Версия: 5.2 (24.10) — жёлтый этап значка убран: красный начинается за 2 минуты до конца (`RED_MS` = 120 с; `STAGE_YELLOW` и `YELLOW_MS` удалены). Откат: XiaomiIsland.kt 5.1.
// Версия: 5.1 (21.10) — `pauseBitmap(fraction, stage, paused)`: при paused вместо полосок рисуется треугольник «продолжить» (нужен плашке в приложении). Откат: XiaomiIsland.kt 5.0.
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

    /** Этапы цвета значка: до последних двух минут — фиолетовый, за 2 минуты до конца и дальше — красный (жёлтого этапа нет). */
    const val STAGE_NORMAL = 0
    const val STAGE_RED = 2
    const val RED_MS = 120_000L

    // допуск 1 с: будильник этапа может сработать на несколько мс раньше срока — цвет всё равно должен смениться
    fun stageFor(leftMs: Long): Int = when {
        leftMs <= RED_MS + 1000 -> STAGE_RED
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
        else -> 0xFF7F00FF.toInt()
    }

    /** Круглая кнопка паузы: тёмный круг, кольцо цвета этапа (доля [fraction] — сколько времени осталось, от верха по часовой), две полоски. */
    fun pauseBitmap(fraction: Float, stage: Int, paused: Boolean = false): Bitmap {
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
        if (paused) {
            c.drawPath(Path().apply { moveTo(40f, 30f); lineTo(40f, 66f); lineTo(68f, 48f); close() }, paint)
        } else {
            c.drawRoundRect(RectF(35f, 31f, 44f, 65f), 3f, 3f, paint)
            c.drawRoundRect(RectF(52f, 31f, 61f, 65f), 3f, 3f, paint)
        }
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
     * Значок таймера для острова: цветной круг и белые песочные часы.
     * Цвет по этапу: фиолетовый #7F00FF (как значок сканера), красный в последние две минуты.
     */
    fun iconBitmap(stage: Int, size: Int = 96): Bitmap {
        val bg = when (stage) {
            STAGE_RED -> 0xFFE53935.toInt()
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

    // ---------- остров плеера «Музыка» ----------

    private const val PIC_MUSIC_KEY = "miui.focus.pic_music"
    private const val PIC_MUSIC_BIG_KEY = "miui.focus.pic_music_big"
    private const val ACTION_MUSIC_PREV = "miui.focus.action_music_prev"
    private const val ACTION_MUSIC_TOGGLE = "miui.focus.action_music_toggle"
    private const val ACTION_MUSIC_NEXT = "miui.focus.action_music_next"

    /**
     * Extras острова для уведомления плеера или null, если остров не поддерживается. Свёрнутый остров — значок-нота,
     * раскрытый — название трека, папка и три круглые кнопки: назад, пауза/играть, вперёд. [float] — раскрыть остров при
     * появлении (начало воспроизведения), false — тихое обновление (смена трека, пауза).
     */
    fun musicExtras(
        ctx: Context, title: String, sub: String, playing: Boolean, float: Boolean,
        prev: android.app.PendingIntent, toggle: android.app.PendingIntent, next: android.app.PendingIntent
    ): Bundle? {
        if (!available(ctx)) return null
        return try {
            val pic = JSONObject().put("type", 1).put("pic", PIC_MUSIC_KEY)
            val left = JSONObject().put("type", 1).put("picInfo", pic)
                .put("textInfo", JSONObject().put("title", title).put("content", sub))
            val big = JSONObject().put("imageTextInfoLeft", left).put("picInfo", pic)
            val island = JSONObject()
                .put("islandProperty", 1)
                .put("islandOrder", true)
                .put("dismissIsland", false)
                .put("bigIslandArea", big)
                .put("smallIslandArea", JSONObject().put("picInfo", pic))
            val anim = JSONObject().put("type", 0).put("src", PIC_MUSIC_BIG_KEY)
            val base = JSONObject().put("type", 1).put("title", title).put("content", sub).put("animIconInfo", anim)
            val list = org.json.JSONArray()
                .put(JSONObject().put("action", ACTION_MUSIC_PREV))
                .put(JSONObject().put("action", ACTION_MUSIC_TOGGLE))
                .put(JSONObject().put("action", ACTION_MUSIC_NEXT))
            val v2 = JSONObject()
                .put("protocol", 1)
                .put("business", "music_player")
                .put("islandFirstFloat", float)
                .put("enableFloat", false)
                .put("updatable", true)
                .put("ticker", title)
                .put("tickerPic", PIC_MUSIC_KEY)
                .put("aodTitle", title)
                .put("param_island", island)
                .put("iconTextInfo", base)
                .put("actions", list)
            val pics = Bundle().apply {
                putParcelable(PIC_MUSIC_KEY, Icon.createWithBitmap(musicIconBitmap(96)))
                putParcelable(PIC_MUSIC_BIG_KEY, Icon.createWithBitmap(musicIconBitmap(192)))
            }
            val acts = Bundle().apply {
                putParcelable(ACTION_MUSIC_PREV, Notification.Action.Builder(Icon.createWithBitmap(musicButtonBitmap(0)), "Назад", prev).build())
                putParcelable(
                    ACTION_MUSIC_TOGGLE,
                    Notification.Action.Builder(Icon.createWithBitmap(musicButtonBitmap(if (playing) 2 else 1)), if (playing) "Пауза" else "Играть", toggle).build()
                )
                putParcelable(ACTION_MUSIC_NEXT, Notification.Action.Builder(Icon.createWithBitmap(musicButtonBitmap(3)), "Вперёд", next).build())
            }
            Bundle().apply {
                putBundle("miui.focus.pics", pics)
                putBundle("miui.focus.actions", acts)
                putString("miui.focus.param", JSONObject().put("param_v2", v2).toString())
            }
        } catch (e: Exception) {
            null
        }
    }

    /** Значок плеера для острова: фиолетовый круг (#7F00FF, как у сканера и таймеров) и белая нота. */
    fun musicIconBitmap(size: Int = 96): Bitmap {
        val bmp = Bitmap.createBitmap(size, size, Bitmap.Config.ARGB_8888)
        val c = Canvas(bmp)
        c.scale(size / 96f, size / 96f)
        val paint = Paint(Paint.ANTI_ALIAS_FLAG)
        paint.style = Paint.Style.FILL
        paint.color = 0xFF7F00FF.toInt()
        c.drawCircle(48f, 48f, 48f, paint)
        paint.color = Color.WHITE
        // головка ноты, штиль и флажок
        c.drawOval(RectF(28f, 56f, 48f, 71f), paint)
        c.drawRect(44f, 24f, 50f, 64f, paint)
        c.drawPath(Path().apply { moveTo(50f, 24f); lineTo(70f, 32f); lineTo(70f, 44f); lineTo(50f, 37f); close() }, paint)
        return bmp
    }

    /** Круглая кнопка острова плеера: 0 — назад, 1 — играть, 2 — пауза, 3 — вперёд (белый значок на тёмном круге). */
    fun musicButtonBitmap(kind: Int): Bitmap {
        val size = 96
        val bmp = Bitmap.createBitmap(size, size, Bitmap.Config.ARGB_8888)
        val c = Canvas(bmp)
        val paint = Paint(Paint.ANTI_ALIAS_FLAG)
        paint.style = Paint.Style.FILL
        paint.color = 0xFF2A2A2A.toInt()
        c.drawCircle(48f, 48f, 48f, paint)
        paint.color = Color.WHITE
        when (kind) {
            0 -> {
                c.drawRect(30f, 30f, 36f, 66f, paint)
                c.drawPath(Path().apply { moveTo(68f, 30f); lineTo(68f, 66f); lineTo(40f, 48f); close() }, paint)
            }
            1 -> c.drawPath(Path().apply { moveTo(38f, 28f); lineTo(38f, 68f); lineTo(70f, 48f); close() }, paint)
            2 -> {
                c.drawRoundRect(RectF(33f, 29f, 44f, 67f), 3f, 3f, paint)
                c.drawRoundRect(RectF(52f, 29f, 63f, 67f), 3f, 3f, paint)
            }
            else -> {
                c.drawRect(60f, 30f, 66f, 66f, paint)
                c.drawPath(Path().apply { moveTo(28f, 30f); lineTo(28f, 66f); lineTo(56f, 48f); close() }, paint)
            }
        }
        return bmp
    }

    // ---------- остров вкладки «Тренировки» ----------

    private const val PIC_WK_KEY = "miui.focus.pic_wk"
    private const val PIC_WK_BIG_KEY = "miui.focus.pic_wk_big"
    private const val ACTION_WK_PAUSE = "miui.focus.action_wk_pause"
    private const val ACTION_WK_STOP = "miui.focus.action_wk_stop"

    /** Время тренировки: М:СС или Ч:ММ:СС (секунды отбрасываются, а не округляются вверх, как у таймера). */
    fun elapsedText(ms: Long): String = clockText((ms / 1000) * 1000)

    /**
     * Extras острова для записи тренировки или null, если остров не поддерживается. Свёрнутый остров: метка-диод слева
     * (красная — нет связи/поиск, зелёная — связь есть, жёлтая — пауза), дистанция рядом с меткой и общее время справа.
     * Раскрытый: крупное общее время, ниже дистанция, а при потере связи — «без учёта М:СС»; кнопки «Пауза/Продолжить»
     * и «Стоп». Цвет строки «без учёта» в самом острове протокол Xiaomi не задаёт — бледно-красной она бывает в шторке.
     * [float] — раскрыть остров (старт записи, «Связь установлена», потеря связи).
     */
    fun workoutExtras(
        ctx: Context, s: WorkoutTracker.Snapshot, float: Boolean,
        pause: android.app.PendingIntent, stop: android.app.PendingIntent
    ): Bundle? {
        if (!available(ctx)) return null
        return try {
            val searching = s.status == WorkoutTracker.ST_SEARCH
            val finishing = s.status == WorkoutTracker.ST_FINISH
            val paused = s.status == WorkoutTracker.ST_PAUSE
            val dot = when {
                paused -> 1
                s.status == WorkoutTracker.ST_RUN && s.fix -> 2
                else -> 0 // 0 — красная, 1 — жёлтая, 2 — зелёная
            }
            val picKey = PIC_WK_KEY + dot
            val bigKey = PIC_WK_BIG_KEY + dot
            val km = WorkoutService.kmText(s.distM)
            val total = elapsedText(s.totalMs)
            val pic = JSONObject().put("type", 1).put("pic", picKey)
            val left = JSONObject().put("type", 1).put("picInfo", pic)
                .put("textInfo", JSONObject().put("title", if (searching) "Поиск…" else if (finishing) "Карта…" else km))
            val big = JSONObject().put("imageTextInfoLeft", left)
            if (!searching && !finishing) {
                big.put("imageTextInfoRight", JSONObject().put("type", 2).put("textInfo", JSONObject().put("title", total)))
            }
            val island = JSONObject()
                .put("islandProperty", 1)
                .put("islandOrder", true)
                .put("dismissIsland", false)
                .put("bigIslandArea", big)
                .put("smallIslandArea", JSONObject().put("picInfo", pic))
            val title: String
            val content: String
            when {
                searching -> {
                    title = "Поиск спутников"
                    content = if (s.sat >= 0) "Найдено: ${s.sat}" else "Ждём сигнал GPS"
                }
                finishing -> {
                    title = "Тренировка завершена"
                    content = "Сопоставляю маршрут с картой…"
                }
                else -> {
                    title = total
                    content = when {
                        s.status == WorkoutTracker.ST_RUN && !s.fix -> "Связи нет · $km · без учёта " + elapsedText(s.lostMs)
                        s.connectedBanner -> "Связь установлена · $km"
                        paused -> "Пауза · $km"
                        s.lostMs >= 1000 -> "$km · без учёта " + elapsedText(s.lostMs)
                        else -> km
                    }
                }
            }
            val anim = JSONObject().put("type", 0).put("src", bigKey)
            val base = JSONObject().put("type", 1).put("title", title).put("content", content).put("animIconInfo", anim)
            val v2 = JSONObject()
                .put("protocol", 1)
                .put("business", "workout_gps")
                .put("islandFirstFloat", float)
                .put("enableFloat", false)
                .put("updatable", true)
                .put("ticker", title)
                .put("tickerPic", picKey)
                .put("aodTitle", title)
                .put("param_island", island)
                .put("iconTextInfo", base)
            val pics = Bundle().apply {
                putParcelable(picKey, Icon.createWithBitmap(workoutDotBitmap(dot, 96)))
                putParcelable(bigKey, Icon.createWithBitmap(workoutDotBitmap(dot, 192)))
            }
            val out = Bundle().apply { putBundle("miui.focus.pics", pics) }
            if (s.status == WorkoutTracker.ST_RUN || s.status == WorkoutTracker.ST_PAUSE) {
                val acts = Bundle()
                val list = org.json.JSONArray()
                acts.putParcelable(
                    ACTION_WK_PAUSE,
                    Notification.Action.Builder(
                        Icon.createWithBitmap(pauseBitmap(1f, STAGE_NORMAL, paused)), if (paused) "Продолжить" else "Пауза", pause
                    ).build()
                )
                acts.putParcelable(ACTION_WK_STOP, Notification.Action.Builder(crossIcon(), "Стоп", stop).build())
                list.put(JSONObject().put("action", ACTION_WK_PAUSE))
                list.put(JSONObject().put("action", ACTION_WK_STOP))
                v2.put("actions", list)
                out.putBundle("miui.focus.actions", acts)
            }
            out.putString("miui.focus.param", JSONObject().put("param_v2", v2).toString())
            out
        } catch (e: Exception) {
            null
        }
    }

    /** Метка-диод тренировки: цветной круг (0 — красный, 1 — жёлтый, 2 — зелёный) с белым ободком. */
    fun workoutDotBitmap(kind: Int, size: Int = 96): Bitmap {
        val color = when (kind) {
            2 -> 0xFF2FA15F.toInt()
            1 -> 0xFFFFB300.toInt()
            else -> 0xFFE53935.toInt()
        }
        val bmp = Bitmap.createBitmap(size, size, Bitmap.Config.ARGB_8888)
        val c = Canvas(bmp)
        c.scale(size / 96f, size / 96f)
        val paint = Paint(Paint.ANTI_ALIAS_FLAG)
        paint.style = Paint.Style.FILL
        paint.color = color
        c.drawCircle(48f, 48f, 48f, paint)
        paint.style = Paint.Style.STROKE
        paint.strokeWidth = 6f
        paint.color = Color.WHITE
        c.drawCircle(48f, 48f, 26f, paint)
        paint.style = Paint.Style.FILL
        c.drawCircle(48f, 48f, 13f, paint)
        return bmp
    }
}
