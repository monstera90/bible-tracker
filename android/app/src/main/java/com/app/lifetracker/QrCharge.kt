package com.app.lifetracker
// Версия: 1.0 (19.11)

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.Path
import android.graphics.RectF
import android.graphics.Typeface
import android.os.BatteryManager
import android.os.Build

/**
 * Карточка «Заряд телефона достиг 80 %» в стопке виджета (галочка «Показывать карточку о том, что заряд телефона достиг 80%», `Cfg.chargeDone`).
 *
 * Служебная карточка, как «Как тренировка?» ([QrRpe]) и «Как настроение?» ([QrMood]): рисуется здесь, а не страницей (процент меняется сам), нажатия на неё нет.
 * Появляется, пока телефон стоит на зарядке (от сети, USB, беспроводной, в доке) и заряд не ниже [QrPriority.CHARGE_DONE_PERCENT] (80 %): на лице написан текущий
 * процент (80, 81 … 100) и «Можно отключать от зарядки». Телефон отключили от зарядки (или заряд упал ниже порога) — карточка уходит. «На зарядке» — по признаку
 * `EXTRA_PLUGGED`, а не по статусу «заряжается»: телефон с ограничением зарядки до 80 % (защита батареи) сообщает «не заряжается», хотя питание подключено, —
 * ему карточка нужна больше всего.
 *
 * Приоритет в стопке ([QrPriority.build]): выше «Как тренировка?» и «Как настроение?», ниже карточек низкого заряда (ниже [QrPriority.BATTERY_ALERT_PERCENT] %) и идущего
 * таймера; при любом режиме, даже без «релевантности».
 *
 * Перерисовку запускает приёмник [register] (смена заряда, подключение и отключение питания → [QrWidgets.onChargeChanged]; живёт, пока жив процесс) и
 * пятиминутный будильник заряда ([QrWidgets.onBatteryTick]), если процесс успели выгрузить.
 *
 * Лицо — квадрат выбранного в форме цвета (по умолчанию зелёный) с выступом снизу на пятую часть темнее, как у остальных карточек ([QrWidgets.FACE_BODY] и др.): сверху
 * «Заряд телефона», под ним кольцо заряда с молнией и процентом внутри (кольцо на столько, на сколько заряжен телефон; на 100 % замкнуто), внизу «Можно отключать от зарядки».
 * Числа — доли ширины лица, те же, что в образце формы (`chargeFaceHtml` в widgets.js).
 */
object QrCharge {

    /** Ключ карточки в стопке (не совпадает с id настоящих карточек, [QrRpe.KEY], [QrMood.KEY] и [QrBattery.KEY]). */
    const val KEY = "__charge"

    /** Цвет лица по умолчанию: зелёный `#43a047` из палитры цвета карточек («можно отключать» — зелёный свет). */
    const val DEFAULT_COLOR = 0xFF43A047.toInt()

    private const val FACE_PX = 480

    @Volatile private var registered = false

    // ---------- чтение состояния ----------

    /** Заряд телефона, 0..100, если он сейчас подключён к питанию (сеть, USB, беспроводная зарядка, док); -1 — не на зарядке или не удалось узнать. */
    fun chargingLevel(ctx: Context): Int {
        return try {
            val i = ctx.applicationContext.registerReceiver(null, IntentFilter(Intent.ACTION_BATTERY_CHANGED)) ?: return -1
            if (i.getIntExtra(BatteryManager.EXTRA_PLUGGED, 0) == 0) return -1
            val level = i.getIntExtra(BatteryManager.EXTRA_LEVEL, -1)
            val scale = i.getIntExtra(BatteryManager.EXTRA_SCALE, 100)
            if (level < 0 || scale <= 0) -1 else (level * 100 / scale).coerceIn(0, 100)
        } catch (e: Throwable) {
            -1
        }
    }

    // ---------- приёмник событий (пока жив процесс) ----------

    private val receiver = object : BroadcastReceiver() {
        override fun onReceive(c: Context, i: Intent) {
            try {
                QrWidgets.onChargeChanged(c) // сама отсеивает повторы: ACTION_BATTERY_CHANGED приходит и при смене напряжения или температуры
            } catch (e: Throwable) {
                // виджет не должен ронять приложение
            }
        }
    }

    /** Подписка на смену заряда и подключение/отключение питания; повторный вызов ничего не делает. Липкое вещание о заряде при подписке приходит сразу — первая проверка не ждёт события. */
    @Synchronized
    fun register(ctx: Context) {
        if (registered) return
        try {
            val f = IntentFilter()
            f.addAction(Intent.ACTION_BATTERY_CHANGED)
            f.addAction(Intent.ACTION_POWER_CONNECTED)
            f.addAction(Intent.ACTION_POWER_DISCONNECTED)
            val app = ctx.applicationContext
            if (Build.VERSION.SDK_INT >= 33) app.registerReceiver(receiver, f, Context.RECEIVER_NOT_EXPORTED) else app.registerReceiver(receiver, f)
            registered = true
        } catch (e: Throwable) {
            // запрещено системой — остаётся пятиминутный будильник заряда
        }
    }

    // ---------- картинка карточки ----------

    /** Цвет выступа снизу: каждый канал на пятую часть темнее (тот же расчёт, что `cardShade` в itemcards.js). */
    private fun shadeOf(face: Int): Int {
        val r = Math.round(((face shr 16) and 255) * 0.8f)
        val g = Math.round(((face shr 8) and 255) * 0.8f)
        val b = Math.round((face and 255) * 0.8f)
        return (0xFF shl 24) or (r shl 16) or (g shl 8) or b
    }

    // Геометрия (доли ширины лица; те же числа в chargeFaceHtml, widgets.js).
    private const val TITLE_Y = 0.170f      // базовая линия «Заряд телефона»
    private const val TITLE_FS = 0.108f     // до этого размера, длинная строка ужимается (как заголовок карточки события календаря)
    private const val TITLE_FS_MIN = 0.088f
    private const val TEXT_MAXW = 0.86f     // предельная ширина надписи
    private const val RING_CX = 0.5f
    private const val RING_CY = 0.470f
    private const val RING_R = 0.210f
    private const val RING_STROKE = 0.036f
    private const val BOLT_CY = 0.400f      // центр молнии
    private const val BOLT_U = 0.0050f      // клетка молнии (сетка 24 Tabler «bolt»): высота 18 клеток ≈ 0,09 ширины
    private const val ICON_STROKE = 0.0126f // вес линии значка — как у значков карточки «Заряд»
    private const val PCT_Y = 0.580f        // базовая линия процентов
    private const val PCT_FS = 0.140f
    private const val PCT_MAXW = 0.29f      // ширина процентов внутри кольца: «100%» сжимается по ширине, высота цифр прежняя
    private const val LINE1_Y = 0.835f      // «Можно отключать»
    private const val LINE2_Y = 0.930f      // «от зарядки»
    private const val LINE_FS = 0.085f

    /** Лицо карточки: [face] — цвет, выбранный в форме виджета; процент берётся с телефона сейчас (нет данных — «--%»). */
    fun render(ctx: Context, face: Int = DEFAULT_COLOR): Bitmap {
        var pct = chargingLevel(ctx)
        if (pct < 0) pct = QrBattery.phoneLevel(ctx) // отключили между расчётом порядка и рисованием: карточку вот-вот уберут, пока пишем последний известный заряд
        return render(pct, face)
    }

    /** Лицо карточки с заданным зарядом [pct] (меньше нуля — «--%», кольцо — только дорожка). */
    fun render(pct: Int, face: Int = DEFAULT_COLOR): Bitmap {
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

        val white = 0xFFFFFFFF.toInt()

        // заголовок — жирный с засечками, как «Телефон» на карточке «Заряд»; небольшая обводка добавляет плотности, если системный шрифт тоньше образца
        val t = Paint(Paint.ANTI_ALIAS_FLAG)
        t.color = white
        t.textAlign = Paint.Align.CENTER
        t.typeface = Typeface.create("serif", Typeface.BOLD)
        t.style = Paint.Style.FILL_AND_STROKE
        t.strokeWidth = w * 0.0022f
        t.textSize = w * TITLE_FS
        val title = "Заряд телефона"
        while (t.textSize > w * TITLE_FS_MIN && t.measureText(title) > w * TEXT_MAXW) t.textSize = t.textSize * 0.96f
        val tw = t.measureText(title)
        if (tw > w * TEXT_MAXW) t.textSize = t.textSize * w * TEXT_MAXW / tw // шрифт устройства шире Palatino — на крайний случай
        g.drawText(title, w / 2f, w * TITLE_Y, t)

        // кольцо заряда: дорожка и дуга на pct %
        val cx = w * RING_CX
        val cy = w * RING_CY
        val rr = w * RING_R
        val ring = Paint(Paint.ANTI_ALIAS_FLAG)
        ring.style = Paint.Style.STROKE
        ring.strokeWidth = w * RING_STROKE
        ring.strokeCap = Paint.Cap.ROUND
        ring.color = 0x59FFFFFF
        g.drawCircle(cx, cy, rr, ring)
        ring.color = white
        if (pct >= 100) {
            g.drawCircle(cx, cy, rr, ring)
        } else if (pct > 0) {
            g.drawArc(RectF(cx - rr, cy - rr, cx + rr, cy + rr), -90f, 360f * pct / 100f, false, ring)
        }

        drawBolt(g, w, cx, w * BOLT_CY)

        // проценты — самый плотный вес системного гротеска (black), с той же обводкой, что у карточки «Заряд»
        val n = Paint(Paint.ANTI_ALIAS_FLAG)
        n.color = white
        n.textAlign = Paint.Align.CENTER
        n.typeface = Typeface.create("sans-serif-black", Typeface.NORMAL)
        n.style = Paint.Style.FILL_AND_STROKE
        n.strokeWidth = w * 0.0030f
        n.textSize = w * PCT_FS
        val text = if (pct < 0) "--%" else "$pct%"
        val nw = n.measureText(text)
        if (nw > w * PCT_MAXW) n.textScaleX = w * PCT_MAXW / nw
        g.drawText(text, cx, w * PCT_Y, n)

        // «Можно отключать / от зарядки»
        t.textSize = w * LINE_FS
        g.drawText("Можно отключать", w / 2f, w * LINE1_Y, t)
        g.drawText("от зарядки", w / 2f, w * LINE2_Y, t)
        return bmp
    }

    /** Значок молнии (Tabler «bolt», сетка 24) с центром в ([cx], [cy]): контур с закруглёнными углами, как у значков карточки «Заряд». */
    private fun drawBolt(g: Canvas, w: Float, cx: Float, cy: Float) {
        val u = w * BOLT_U
        val p = Paint(Paint.ANTI_ALIAS_FLAG)
        p.style = Paint.Style.STROKE
        p.strokeWidth = w * ICON_STROKE
        p.strokeCap = Paint.Cap.ROUND
        p.strokeJoin = Paint.Join.ROUND
        p.color = 0xFFFFFFFF.toInt()
        val pts = floatArrayOf(13f, 3f, 13f, 10f, 19f, 10f, 11f, 21f, 11f, 14f, 5f, 14f)
        val path = Path()
        path.moveTo(cx + (pts[0] - 12f) * u, cy + (pts[1] - 12f) * u)
        var i = 2
        while (i < pts.size) {
            path.lineTo(cx + (pts[i] - 12f) * u, cy + (pts[i + 1] - 12f) * u)
            i += 2
        }
        path.close()
        g.drawPath(path, p)
    }
}
