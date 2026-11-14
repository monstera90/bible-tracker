package com.app.lifetracker
// Версия: 1.1 (14.11) — «Сегодня, <день>» и «Как настроение?» того же размера, что на карточке события календаря (0,1 и 0,108 ширины); надписи переставлены между значком и кнопками

import android.content.Context
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.Path
import android.graphics.Rect
import android.graphics.RectF
import android.graphics.Typeface
import org.json.JSONArray
import org.json.JSONObject
import java.text.SimpleDateFormat
import java.util.Calendar
import java.util.Date
import java.util.Locale

/**
 * Карточка «Как настроение?» в стопке виджета (галочка «Спрашивать о настроении», `Cfg.moodAsk`): восемь эмодзи-кнопок — те же чувства, что в сетке отметок
 * вкладки настроения (`CHECKIN_ORDER` в mood.js).
 *
 * Карточка служебная, как «Как тренировка?» ([QrRpe]): стоит над всеми обычными карточками (выше календаря, помодоро, событий) и исчезает, как только настроение
 * отмечено. Появляется вечером в [ASK_MINUTE] (20:30), если за сегодня отметок настроения не было ни в приложении, ни в виджете ([pending]); в полночь уходит,
 * следующим вечером появится снова. Если обе служебные карточки ждут ответа, «Как тренировка?» выше, «Как настроение?» под ней.
 *
 * Нажатие на эмодзи (нажатие → [ScanActivity] без окна → [answer]) кладёт ответ в очередь [takeAnswers]: страница при возврате в приложение вносит его в
 * журнал настроения (`moodlog:`) временем нажатия и подтверждает ([ackAnswers]). Что настроение отмечено в самом приложении (в том числе на другом устройстве
 * и пришло из облака), оболочке сообщает страница ([setFromPage]: время последней отметки; мост ≥37).
 *
 * Лицо рисуется здесь ([render]); кнопки — прозрачные зоны поверх картинки (`layout/qr_widget_item.xml`, `mood_b1…mood_b8`), их геометрия — доли ширины лица, те же числа,
 * что в [render] и в `moodFaceHtml` (widgets.js). Надписи и значок сдвинуты к кнопкам на [SHIFT_DOWN] относительно первого макета.
 */
object QrMood {

    /** Ключ карточки в стопке (не совпадает с id настоящих карточек и с [QrRpe.KEY]). */
    const val KEY = "__mood"

    /** Цвет лица: тот же фиолетовый, что у «Как тренировка?». */
    const val DEFAULT_COLOR = 0xFF8000FF.toInt()

    /** С какого времени суток (минуты от полуночи) карточка появляется: 20:30. */
    const val ASK_MINUTE = 20 * 60 + 30

    /** Ключи чувств слева направо, сверху вниз — как кнопки на карточке и `CHECKIN_ORDER` в mood.js. */
    val KEYS: List<String> = listOf("down", "joy", "calm", "sad", "anxiety", "anger", "sleepy", "dejected")
    private val EMOJI: List<String> = listOf("\uD83D\uDE0C", "\uD83D\uDE0A", "\uD83D\uDE44", "\uD83D\uDE15", "\uD83D\uDE30", "\uD83D\uDE21", "\uD83E\uDD71", "\uD83D\uDE14")

    private const val PREFS = "qr_widgets"
    private const val K_AT = "moodAt"        // время последней отметки, о которой сообщила страница (мс)
    private const val K_LASTANS = "moodLastAns" // время последнего ответа с карточки в виджете (мс): не стирается подтверждением страницы
    private const val K_ANS = "moodAns"      // очередь ответов, ещё не внесённых страницей: [{k, at}]
    private const val ANS_TTL_MS = 3 * 24 * 3_600_000L
    private const val FACE_PX = 480
    private val LOCK = Any()

    private fun prefs(ctx: Context) = ctx.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    private fun dayKeyOf(ms: Long): Int {
        val c = Calendar.getInstance()
        c.timeInMillis = ms
        return c.get(Calendar.YEAR) * 10000 + (c.get(Calendar.MONTH) + 1) * 100 + c.get(Calendar.DAY_OF_MONTH)
    }

    private fun minuteOfDay(ms: Long): Int {
        val c = Calendar.getInstance()
        c.timeInMillis = ms
        return c.get(Calendar.HOUR_OF_DAY) * 60 + c.get(Calendar.MINUTE)
    }

    /** Сегодня (по часам [now]) уже есть отметка настроения: из приложения (сообщила страница) или из виджета. */
    fun markedToday(ctx: Context, now: Long = System.currentTimeMillis()): Boolean = synchronized(LOCK) {
        val p = prefs(ctx)
        val today = dayKeyOf(now)
        val pageAt = p.getLong(K_AT, 0L)
        val ansAt = p.getLong(K_LASTANS, 0L)
        (pageAt > 0L && dayKeyOf(pageAt) == today) || (ansAt > 0L && dayKeyOf(ansAt) == today)
    }

    /** Карточка «Как настроение?» должна стоять в стопке: время [ASK_MINUTE] наступило, а отметок за сегодня нет. */
    fun pending(ctx: Context, now: Long = System.currentTimeMillis()): Boolean =
        minuteOfDay(now) >= ASK_MINUTE && !markedToday(ctx, now)

    /**
     * Когда состояние карточки изменится само, без внешнего события: в [ASK_MINUTE] (карточка появится) или в полночь (уйдёт). Берётся момент чуть позже границы,
     * чтобы часы уже точно показывали новое время.
     */
    fun nextChangeAt(now: Long): Long {
        val c = Calendar.getInstance()
        c.timeInMillis = now
        c.set(Calendar.HOUR_OF_DAY, 0); c.set(Calendar.MINUTE, 0); c.set(Calendar.SECOND, 0); c.set(Calendar.MILLISECOND, 0)
        if (minuteOfDay(now) < ASK_MINUTE) {
            c.add(Calendar.MINUTE, ASK_MINUTE)
            c.add(Calendar.SECOND, 2)
        } else {
            c.add(Calendar.DAY_OF_YEAR, 1)
            c.add(Calendar.SECOND, 5)
        }
        return c.timeInMillis
    }

    /** Страница сообщает время последней отметки настроения (0 — отметок нет; значения из будущего больше суток отбрасываются). true — состояние изменилось. */
    fun setFromPage(ctx: Context, atText: String?): Boolean = synchronized(LOCK) {
        val v = atText?.trim()?.toLongOrNull() ?: return@synchronized false
        val at = if (v < 0L || v > System.currentTimeMillis() + 24 * 3_600_000L) 0L else v
        val p = prefs(ctx)
        if (p.getLong(K_AT, 0L) == at) return@synchronized false
        p.edit().putLong(K_AT, at).apply()
        true
    }

    /** Ответы с карточки в виджете, ещё не внесённые страницей (устаревшие — старше трёх суток — выбрасываются). */
    private fun readAns(ctx: Context): JSONArray {
        val out = JSONArray()
        try {
            val arr = JSONArray(prefs(ctx).getString(K_ANS, "[]") ?: "[]")
            val now = System.currentTimeMillis()
            for (i in 0 until arr.length()) {
                val o = arr.optJSONObject(i) ?: continue
                if (now - o.optLong("at", 0L) <= ANS_TTL_MS && o.optString("k", "") in KEYS) out.put(o)
            }
        } catch (e: Exception) {
            // повреждённая запись — начинаем с чистого списка
        }
        return out
    }

    /** Нажата кнопка [index] (0…7) на карточке в виджете: настроение запоминается до приезда страницы, карточка уходит. true — принято. */
    fun answer(ctx: Context, index: Int): Boolean {
        if (index !in KEYS.indices) return false
        val app = ctx.applicationContext
        val now = System.currentTimeMillis()
        val ok = synchronized(LOCK) {
            if (!pending(app, now)) return@synchronized false // уже отмечено (двойное нажатие, другая отметка) или время ещё не пришло
            val arr = readAns(app)
            arr.put(JSONObject().put("k", KEYS[index]).put("at", now))
            prefs(app).edit().putString(K_ANS, arr.toString()).putLong(K_LASTANS, now).apply()
            true
        }
        if (ok) QrWidgets.onMoodChanged(app)
        return ok
    }

    /** JSON-массив ответов `[{k, at}]`, которые страница ещё не внесла в журнал настроения (мост ≥37 `widgetMoodTake`). */
    fun takeAnswers(ctx: Context): String = synchronized(LOCK) { readAns(ctx).toString() }

    /** Страница внесла ответы с этими временами `at` (JSON-массив чисел) — убрать их из очереди (мост ≥37 `widgetMoodAck`). */
    fun ackAnswers(ctx: Context, atsJson: String?) {
        try {
            val ats = JSONArray(atsJson ?: "[]")
            val drop = HashSet<Long>()
            for (i in 0 until ats.length()) drop.add(ats.optLong(i))
            synchronized(LOCK) {
                val arr = readAns(ctx)
                val keep = JSONArray()
                for (i in 0 until arr.length()) {
                    val o = arr.optJSONObject(i) ?: continue
                    if (!drop.contains(o.optLong("at", 0L))) keep.put(o)
                }
                prefs(ctx).edit().putString(K_ANS, keep.toString()).apply()
            }
        } catch (e: Exception) {
            // нечего убирать
        }
    }

    // ---------- лицо карточки ----------

    private fun shadeOf(face: Int): Int {
        val r = Math.round(((face shr 16) and 255) * 0.8f)
        val g = Math.round(((face shr 8) and 255) * 0.8f)
        val b = Math.round((face and 255) * 0.8f)
        return (0xFF shl 24) or (r shl 16) or (g shl 8) or b
    }

    // Геометрия (доли ширины лица; сняты с макета): значок — круг со смайликом (Tabler mood-smile, клетка U), две строки заголовка, сетка кнопок 2×4.
    /** Насколько значок и обе надписи сдвинуты вниз, к кнопкам, относительно первого макета (доли ширины). */
    internal const val SHIFT_DOWN = 0.04f
    private const val ICON_CY = 0.138f      // центр значка в макете (до сдвига)
    private const val ICON_U = 0.00756f     // клетка значка (сетка 24): радиус круга 9 клеток
    private const val ICON_STROKE = 0.0073f
    // Размер надписей — как на карточке события календаря (widgets.js `DYN`: labelFsMax / labelFs / titleFs, fitTitle, maxW), чтобы обе карточки читались одинаково.
    private const val SUB_FS = 0.1f         // «Сегодня, суббота»: до этого размера, длинная строка ужимается (не меньше SUB_FS_MIN)
    private const val SUB_FS_MIN = 0.076f
    private const val SUB_Y = 0.332f        // базовая линия «Сегодня, суббота» (до сдвига)
    private const val TITLE_FS = 0.108f     // «Как настроение?»: до этого размера, ужимается до TITLE_FS_MIN
    private const val TITLE_FS_MIN = 0.088f
    private const val TITLE_Y = 0.442f      // базовая линия «Как настроение?» (до сдвига)
    private const val TEXT_MAXW = 0.86f     // предельная ширина надписи (как maxW у карточки календаря)
    private const val BTN_CX0 = 0.1535f
    private const val BTN_STEP = 0.2309f
    private const val BTN_CY1 = 0.638f
    private const val BTN_CY2 = 0.8693f
    private const val BTN_R = 0.1048f       // внешний радиус кольца
    private const val BTN_STROKE = 0.0082f
    private const val EMOJI_W = 0.118f      // ширина рамки эмодзи (видимое лицо — около 0,11)

    fun render(ctx: Context, face: Int = DEFAULT_COLOR, now: Long = System.currentTimeMillis()): Bitmap {
        val w = FACE_PX.toFloat()
        val body = Math.round(w * QrWidgets.FACE_BODY).toFloat()
        val shift = Math.round(w * QrWidgets.FACE_SHADE).toFloat()
        val bmp = Bitmap.createBitmap(FACE_PX, (body + shift).toInt(), Bitmap.Config.ARGB_8888)
        val g = Canvas(bmp)
        val p = Paint(Paint.ANTI_ALIAS_FLAG)
        val r = w * QrWidgets.FACE_RADIUS
        p.color = shadeOf(face)
        g.drawRoundRect(RectF(0f, shift, w, shift + body), r, r, p)
        p.color = face or (0xFF shl 24)
        g.drawRoundRect(RectF(0f, 0f, w, body), r, r, p)

        drawIcon(g, w)

        val sub = Paint(Paint.ANTI_ALIAS_FLAG)
        sub.color = 0xFFFFFFFF.toInt()
        sub.textAlign = Paint.Align.CENTER
        sub.typeface = Typeface.create("sans-serif", Typeface.NORMAL)
        val subText = subtitle(now)
        sub.textSize = w * SUB_FS
        while (sub.textSize > w * SUB_FS_MIN && sub.measureText(subText) > w * TEXT_MAXW) sub.textSize = sub.textSize * 0.97f
        g.drawText(subText, w / 2f, w * (SUB_Y + SHIFT_DOWN), sub)

        val t = Paint(Paint.ANTI_ALIAS_FLAG)
        t.color = 0xFFFFFFFF.toInt()
        t.textAlign = Paint.Align.CENTER
        t.typeface = Typeface.create("serif", Typeface.BOLD)
        t.textSize = w * TITLE_FS
        t.style = Paint.Style.FILL_AND_STROKE
        t.strokeWidth = w * 0.0022f
        val title = "Как настроение?"
        while (t.textSize > w * TITLE_FS_MIN && t.measureText(title) > w * TEXT_MAXW) t.textSize = t.textSize * 0.96f
        val tw = t.measureText(title)
        if (tw > w * TEXT_MAXW) t.textSize = t.textSize * w * TEXT_MAXW / tw // шрифт устройства шире Palatino — на крайний случай
        g.drawText(title, w / 2f, w * (TITLE_Y + SHIFT_DOWN), t)

        val ring = Paint(Paint.ANTI_ALIAS_FLAG)
        ring.color = 0xFFFFFFFF.toInt()
        ring.style = Paint.Style.STROKE
        ring.strokeWidth = w * BTN_STROKE
        val ep = Paint(Paint.ANTI_ALIAS_FLAG)
        ep.textAlign = Paint.Align.LEFT
        val b = Rect()
        for (i in 0 until 8) {
            val col = i % 4
            val cx = w * (BTN_CX0 + col * BTN_STEP)
            val cy = w * (if (i < 4) BTN_CY1 else BTN_CY2)
            g.drawCircle(cx, cy, w * BTN_R - w * BTN_STROKE / 2f, ring)
            drawEmoji(g, ep, b, EMOJI[i], cx, cy, w * EMOJI_W)
        }
        return bmp
    }

    /** Эмодзи по центру кнопки: размер подбирается так, чтобы рамка глифа была шириной [target], центр — ровно в ([cx], [cy]). */
    private fun drawEmoji(g: Canvas, p: Paint, b: Rect, e: String, cx: Float, cy: Float, target: Float) {
        p.textSize = target
        p.getTextBounds(e, 0, e.length, b)
        if (b.width() > 0) {
            p.textSize = target * target / b.width()
            p.getTextBounds(e, 0, e.length, b)
        }
        g.drawText(e, cx - b.exactCenterX(), cy - b.exactCenterY(), p)
    }

    /** «Сегодня, суббота» — день недели по-русски, с маленькой буквы. */
    private fun subtitle(now: Long): String {
        val day = try {
            SimpleDateFormat("EEEE", Locale("ru")).format(Date(now)).lowercase(Locale("ru"))
        } catch (e: Exception) {
            ""
        }
        return if (day.isEmpty()) "Сегодня" else "Сегодня, $day"
    }

    /** Значок «смайлик в круге» (Tabler mood-smile): круг, два глаза-точки, улыбка. */
    private fun drawIcon(g: Canvas, w: Float) {
        val u = w * ICON_U
        val cx = w / 2f
        val cy = w * (ICON_CY + SHIFT_DOWN)
        val p = Paint(Paint.ANTI_ALIAS_FLAG)
        p.color = 0xFFFFFFFF.toInt()
        p.style = Paint.Style.STROKE
        p.strokeWidth = w * ICON_STROKE
        p.strokeCap = Paint.Cap.ROUND
        p.strokeJoin = Paint.Join.ROUND
        g.drawCircle(cx, cy, 9f * u, p)
        g.drawPoint(cx - 3f * u, cy - 2f * u, p)
        g.drawPoint(cx + 3f * u, cy - 2f * u, p)
        // улыбка: дуга радиуса 3,5 клетки между точками (±2,5; +3); центр дуги выше концов на √(3,5²−2,5²) ≈ 2,449
        val arcCy = cy + 3f * u - 2.449f * u
        val oval = RectF(cx - 3.5f * u, arcCy - 3.5f * u, cx + 3.5f * u, arcCy + 3.5f * u)
        val smile = Path()
        smile.moveTo(cx - 2.5f * u, cy + 3f * u)
        smile.arcTo(oval, 135.6f, -91.2f, false)
        g.drawPath(smile, p)
    }
}
