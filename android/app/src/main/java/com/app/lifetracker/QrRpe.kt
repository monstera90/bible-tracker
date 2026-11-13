package com.app.lifetracker
// Версия: 1.0 (13.11)

import android.content.Context
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.Path
import android.graphics.RectF
import android.graphics.Typeface
import org.json.JSONArray
import org.json.JSONObject

/**
 * Карточка «Как тренировка?» в стопке виджета (галочка «Спрашивать о тренировке», `Cfg.rpeAsk`): оценка нагрузки тренировки (sRPE, 1…10).
 *
 * Карточка служебная: стоит НАД всеми остальными (выше тренировки, помодоро, событий), пока есть запись без оценки, и исчезает, как только оценка
 * поставлена — кнопками 1…10 прямо на карточке (нажатие → [ScanActivity] без окна → [answer]) или в приложении. Лицо рисуется здесь
 * ([render]); кнопки — прозрачные зоны поверх картинки (`layout/qr_widget_item.xml`, `rpe_b1…rpe_b10`), их геометрия — доли ширины лица,
 * те же числа, что в [render] и в `rpeFaceHtml` (widgets.js).
 *
 * Что считается «ждёт оценки» ([pendingId]): запись в очереди оболочки `workouts_native/finished`, которую страница ещё не забрала (тренировка
 * только что закончилась, приложение не открывали), либо запись, о которой страница сообщила (`widgetRpeSet`, мост ≥33; в том числе
 * пришедшая из облака с другого устройства). Ответ из виджета лежит в `rpeAns`, пока страница не применит его к записи (`widgetRpeTake` →
 * `widgetRpeAck`), и до этого запись уже не считается ждущей.
 */
object QrRpe {

    /** Ключ карточки в стопке (не совпадает с id настоящих карточек). */
    const val KEY = "__rpe"

    /** Цвет лица: фиолетовый макета. */
    const val DEFAULT_COLOR = 0xFF8000FF.toInt()

    private const val PREFS = "qr_widgets"
    private const val K_ID = "rpeId"
    private const val K_ANS = "rpeAns"
    private const val ANS_TTL_MS = 3 * 24 * 3_600_000L
    private const val FACE_PX = 480
    private val ID_RE = Regex("^[A-Za-z0-9_-]{1,64}$")
    private val LOCK = Any()

    private fun prefs(ctx: Context) = ctx.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    /** Ответы из виджета, ещё не применённые страницей (устаревшие — старше трёх суток — выбрасываются). */
    private fun readAns(ctx: Context): JSONArray {
        val out = JSONArray()
        try {
            val arr = JSONArray(prefs(ctx).getString(K_ANS, "[]") ?: "[]")
            val now = System.currentTimeMillis()
            for (i in 0 until arr.length()) {
                val o = arr.optJSONObject(i) ?: continue
                if (now - o.optLong("at", 0L) <= ANS_TTL_MS) out.put(o)
            }
        } catch (e: Exception) {
            // повреждённая запись — начинаем с чистого списка
        }
        return out
    }

    private fun answeredIds(arr: JSONArray): Set<String> {
        val s = HashSet<String>()
        for (i in 0 until arr.length()) arr.optJSONObject(i)?.optString("id", "")?.let { if (it.isNotEmpty()) s.add(it) }
        return s
    }

    /** id самой старой записи, которая ждёт оценки; пусто — ждать нечего. */
    fun pendingId(ctx: Context): String = synchronized(LOCK) {
        val answered = answeredIds(readAns(ctx))
        try {
            val q = JSONArray(WorkoutTracker.takeFinishedJson(ctx))
            for (i in 0 until q.length()) {
                val o = q.optJSONObject(i) ?: continue
                if (o.optInt("upd", 0) == 1) continue
                val id = o.optString("id", "")
                if (id.isNotEmpty() && id !in answered) return@synchronized id
            }
        } catch (e: Exception) {
            // очередь не читается — смотрим только то, что сообщила страница
        }
        val pid = prefs(ctx).getString(K_ID, "") ?: ""
        if (pid.isNotEmpty() && pid !in answered) pid else ""
    }

    /** Страница сообщает, какая запись ждёт оценки ("" — никакая). true — состояние изменилось. */
    fun setFromPage(ctx: Context, id: String?): Boolean = synchronized(LOCK) {
        val clean = if (id != null && ID_RE.matches(id)) id else ""
        val old = prefs(ctx).getString(K_ID, "") ?: ""
        if (old == clean) return@synchronized false
        prefs(ctx).edit().putString(K_ID, clean).apply()
        true
    }

    /** Нажата кнопка [n] (1…10) на карточке в виджете: оценка ждущей записи сохраняется до приезда страницы. true — принято. */
    fun answer(ctx: Context, n: Int): Boolean {
        if (n !in 1..10) return false
        val app = ctx.applicationContext
        val ok = synchronized(LOCK) {
            val id = pendingId(app)
            if (id.isEmpty()) return@synchronized false // уже отвечено (двойное нажатие) или ждать нечего
            val arr = readAns(app)
            arr.put(JSONObject().put("id", id).put("rpe", n).put("at", System.currentTimeMillis()))
            val e = prefs(app).edit().putString(K_ANS, arr.toString())
            if ((prefs(app).getString(K_ID, "") ?: "") == id) e.putString(K_ID, "")
            e.apply()
            true
        }
        if (ok) QrWidgets.onRpeChanged(app)
        return ok
    }

    /** JSON-массив ответов `[{id, rpe, at}]`, которые страница ещё не применила (мост ≥33 `widgetRpeTake`). */
    fun takeAnswers(ctx: Context): String = synchronized(LOCK) { readAns(ctx).toString() }

    /** Страница применила ответы для этих id записей — убрать их (мост ≥33 `widgetRpeAck`). */
    fun ackAnswers(ctx: Context, idsJson: String?) {
        try {
            val ids = JSONArray(idsJson ?: "[]")
            val drop = HashSet<String>()
            for (i in 0 until ids.length()) drop.add(ids.optString(i))
            synchronized(LOCK) {
                val arr = readAns(ctx)
                val keep = JSONArray()
                for (i in 0 until arr.length()) {
                    val o = arr.optJSONObject(i) ?: continue
                    if (!drop.contains(o.optString("id", ""))) keep.put(o)
                }
                val e = prefs(ctx).edit().putString(K_ANS, keep.toString())
                if (drop.contains(prefs(ctx).getString(K_ID, "") ?: "")) e.putString(K_ID, "")
                e.apply()
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

    // Геометрия (доли ширины лица; сняты с макета): значок, две строки заголовка, сетка кнопок 2×5.
    private const val ICON_UNIT = 0.0096f   // клетка значка (сетка 24, линия 2)
    private const val ICON_TOP = 0.035f     // верх сетки значка
    private const val TITLE_FS = 0.130f
    private const val TITLE_Y1 = 0.413f
    private const val TITLE_Y2 = 0.542f
    private const val TITLE_MAXW = 0.84f
    private const val BTN_X0 = 0.047f
    private const val BTN_STEP = 0.1873f
    private const val BTN_W = 0.157f
    private const val BTN_Y1 = 0.6206f
    private const val BTN_Y2 = 0.8088f
    private const val BTN_H = 0.155f
    private const val BTN_R = 0.034f
    private const val BTN_STROKE = 0.0095f
    private const val NUM_FS = 0.055f

    fun render(ctx: Context, face: Int = DEFAULT_COLOR): Bitmap {
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

        val t = Paint(Paint.ANTI_ALIAS_FLAG)
        t.color = 0xFFFFFFFF.toInt()
        t.textAlign = Paint.Align.CENTER
        t.typeface = Typeface.create("serif", Typeface.BOLD)
        t.textSize = w * TITLE_FS
        t.style = Paint.Style.FILL_AND_STROKE
        t.strokeWidth = w * 0.0022f
        val second = "тренировка?"
        val tw = t.measureText(second)
        val maxW = w * TITLE_MAXW
        if (tw > maxW) t.textSize = t.textSize * maxW / tw // шрифт устройства шире образца — оба слова ужимаются вместе
        g.drawText("Как", w / 2f, w * TITLE_Y1, t)
        g.drawText(second, w / 2f, w * TITLE_Y2, t)

        val line = Paint(Paint.ANTI_ALIAS_FLAG)
        line.color = 0xFFFFFFFF.toInt()
        line.style = Paint.Style.STROKE
        line.strokeWidth = w * BTN_STROKE
        val num = Paint(Paint.ANTI_ALIAS_FLAG)
        num.color = 0xFFFFFFFF.toInt()
        num.textAlign = Paint.Align.CENTER
        num.typeface = Typeface.create("serif", Typeface.BOLD)
        num.textSize = w * NUM_FS
        num.style = Paint.Style.FILL_AND_STROKE
        num.strokeWidth = w * 0.0015f
        val half = w * BTN_STROKE / 2f
        for (i in 0 until 10) {
            val col = i % 5
            val row = i / 5
            val x = w * (BTN_X0 + col * BTN_STEP)
            val y = w * (if (row == 0) BTN_Y1 else BTN_Y2)
            val bw = w * BTN_W
            val bh = w * BTN_H
            g.drawRoundRect(RectF(x + half, y + half, x + bw - half, y + bh - half), w * BTN_R, w * BTN_R, line)
            g.drawText((i + 1).toString(), x + bw / 2f, y + bh / 2f + w * NUM_FS * 0.35f, num)
        }
        return bmp
    }

    /** Значок «календарь с галочкой» (Tabler calendar-check, сетка 24, линия 2). */
    private fun drawIcon(g: Canvas, w: Float) {
        val u = w * ICON_UNIT
        val left = (w - 24f * u) / 2f
        val top = w * ICON_TOP
        fun px(x: Float) = left + x * u
        fun py(y: Float) = top + y * u
        val p = Paint(Paint.ANTI_ALIAS_FLAG)
        p.color = 0xFFFFFFFF.toInt()
        p.style = Paint.Style.STROKE
        p.strokeWidth = 2f * u
        p.strokeCap = Paint.Cap.ROUND
        p.strokeJoin = Paint.Join.ROUND
        val body = Path()
        body.moveTo(px(11.5f), py(21f))
        body.lineTo(px(6f), py(21f))
        body.quadTo(px(4f), py(21f), px(4f), py(19f))
        body.lineTo(px(4f), py(7f))
        body.quadTo(px(4f), py(5f), px(6f), py(5f))
        body.lineTo(px(18f), py(5f))
        body.quadTo(px(20f), py(5f), px(20f), py(7f))
        body.lineTo(px(20f), py(13f))
        g.drawPath(body, p)
        g.drawLine(px(16f), py(3f), px(16f), py(7f), p)
        g.drawLine(px(8f), py(3f), px(8f), py(7f), p)
        g.drawLine(px(4f), py(11f), px(20f), py(11f), p)
        val tick = Path()
        tick.moveTo(px(15f), py(19f))
        tick.lineTo(px(17f), py(21f))
        tick.lineTo(px(21f), py(17f))
        g.drawPath(tick, p)
    }
}
