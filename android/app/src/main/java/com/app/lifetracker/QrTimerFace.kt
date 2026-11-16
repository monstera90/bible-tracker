package com.app.lifetracker
// Версия: 1.0 (15.11) — лицо карточки-таймера в виджете «Стопка QR-карточек» (галочка «Отображать таймеры»): зелёная карточка, название сверху, кольцо с минутами внутри.

import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.Rect
import android.graphics.RectF
import android.graphics.Typeface

/**
 * Лицо карточки таймера, нарисованное оболочкой (не страницей): кольцо и число минут должны меняться раз в минуту без приложения.
 *
 * Вид — по образцу заказчика: зелёная карточка (тот же скруглённый «ящик» с выступом снизу, что у остальных лиц стопки), сверху название таймера (serif, жирное, белое),
 * по центру белое кольцо, а в нём крупное число минут (sans-serif). Таймер не запущен — кольцо целое, в нём заданное время; идёт (или на паузе) — в кольце
 * остаток: число минут, округлённое вверх, а дуга показывает долю оставшегося времени (по часовой стрелке от верха, остальное — бледный след).
 * Время короче минуты в незапущенном таймере пишется как «0:30», час и больше — «1:05».
 *
 * Геометрия (доли ширины лица) сняты с образца 792 px: центр кольца (0,50; 0,59), внешний радиус 0,2765, толщина 0,038, базовая линия названия 0,184.
 */
object QrTimerFace {

    /** Зелёный образца заказчика (#55CC0A); цвет выступа снизу — на пятую часть темнее, как у всех лиц ([shadeOf]). */
    const val COLOR = 0xFF55CC0A.toInt()

    private const val FACE_PX = 480
    private const val RING_CX = 0.5f
    private const val RING_CY = 0.59f
    private const val RING_R = 0.2765f
    private const val RING_STROKE = 0.038f
    private const val TITLE_FS = 0.108f
    private const val TITLE_FS_MIN = 0.088f
    private const val TITLE_Y = 0.184f
    private const val TEXT_MAXW = 0.86f
    private const val NUM_FS = 0.29f
    private const val NUM_MAXW = 0.37f

    private fun shadeOf(face: Int): Int {
        val r = Math.round(((face shr 16) and 255) * 0.8f)
        val g = Math.round(((face shr 8) and 255) * 0.8f)
        val b = Math.round((face and 255) * 0.8f)
        return (0xFF shl 24) or (r shl 16) or (g shl 8) or b
    }

    /**
     * Число в кольце для [seconds] секунд: от часа — «Ч:ММ» (минуты вверх), от минуты — минуты, округлённые вверх; меньше минуты — «м:сс» (только у незапущенного: у идущего
     * остаток дольше минуты не тянется, но ниже единицы не опускается — показывает «1», пока таймер не сработает).
     */
    fun numberText(seconds: Long, running: Boolean): String {
        val sec = Math.max(0L, seconds)
        if (sec >= 3600L) {
            val totalMin = (sec + 59L) / 60L
            return (totalMin / 60L).toString() + ":" + (if (totalMin % 60L < 10L) "0" else "") + (totalMin % 60L)
        }
        if (sec >= 60L || running) return Math.max(1L, (sec + 59L) / 60L).toString()
        return "0:" + (if (sec < 10L) "0" else "") + sec
    }

    /**
     * Доля кольца, которую занимает дуга: остаток / заданное время (1 — целое кольцо). Не запущенный таймер (нет [state]) — целое кольцо; нет заданного времени — тоже.
     */
    fun fraction(state: CardTimers.Face?, totalMs: Long): Float {
        if (state == null || totalMs <= 0L) return 1f
        return (state.leftMs.toFloat() / totalMs.toFloat()).coerceIn(0f, 1f)
    }

    /** Лицо карточки: [title] — название таймера (пусто — «Таймер»), [state] — идущий или приостановленный таймер (null — не запущен), [totalSec] — заданное время, с. */
    fun render(title: String, state: CardTimers.Face?, totalSec: Int, face: Int = COLOR): Bitmap {
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

        // название
        val name = if (title.isBlank()) "Таймер" else title.trim()
        val t = Paint(Paint.ANTI_ALIAS_FLAG)
        t.color = 0xFFFFFFFF.toInt()
        t.textAlign = Paint.Align.CENTER
        t.typeface = Typeface.create("serif", Typeface.BOLD)
        t.style = Paint.Style.FILL_AND_STROKE
        t.strokeWidth = w * 0.0022f
        t.textSize = w * TITLE_FS
        while (t.textSize > w * TITLE_FS_MIN && t.measureText(name) > w * TEXT_MAXW) t.textSize = t.textSize * 0.96f
        var shown = name
        if (t.measureText(shown) > w * TEXT_MAXW) { // длинное название — обрезается с многоточием
            while (shown.length > 1 && t.measureText(shown + "…") > w * TEXT_MAXW) shown = shown.dropLast(1)
            shown = shown.trimEnd() + "…"
        }
        g.drawText(shown, w / 2f, w * TITLE_Y, t)

        // кольцо: бледный след и дуга остатка
        val cx = w * RING_CX
        val cy = w * RING_CY
        val stroke = w * RING_STROKE
        val rad = w * RING_R - stroke / 2f
        val oval = RectF(cx - rad, cy - rad, cx + rad, cy + rad)
        val ring = Paint(Paint.ANTI_ALIAS_FLAG)
        ring.style = Paint.Style.STROKE
        ring.strokeWidth = stroke
        val totalMs = totalSec.toLong() * 1000L
        val frac = fraction(state, totalMs)
        if (frac >= 0.999f) {
            ring.color = 0xFFFFFFFF.toInt()
            g.drawCircle(cx, cy, rad, ring)
        } else {
            ring.color = 0x4DFFFFFF // след: уже прошедшая часть
            g.drawCircle(cx, cy, rad, ring)
            if (frac > 0f) {
                ring.color = 0xFFFFFFFF.toInt()
                g.drawArc(oval, -90f, 360f * frac, false, ring)
            }
        }

        // число в кольце
        val seconds = if (state != null) (state.leftMs + 999L) / 1000L else totalSec.toLong()
        val text = numberText(seconds, state != null && state.running)
        val n = Paint(Paint.ANTI_ALIAS_FLAG)
        n.color = 0xFFFFFFFF.toInt()
        n.textAlign = Paint.Align.CENTER
        n.typeface = Typeface.create("sans-serif", Typeface.NORMAL)
        n.textSize = w * NUM_FS
        if (n.measureText(text) > w * NUM_MAXW) n.textSize = n.textSize * w * NUM_MAXW / n.measureText(text)
        val b = Rect()
        n.getTextBounds(text, 0, text.length, b)
        g.drawText(text, cx, cy - (b.top + b.bottom) / 2f, n)
        return bmp
    }
}
