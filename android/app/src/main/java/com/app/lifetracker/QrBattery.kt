package com.app.lifetracker
// Версия: 1.0 (12.11)

import android.Manifest
import android.annotation.SuppressLint
import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothClass
import android.bluetooth.BluetoothDevice
import android.bluetooth.BluetoothManager
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.Path
import android.graphics.RectF
import android.graphics.Typeface
import android.media.AudioManager
import android.os.BatteryManager
import android.os.Build
import org.json.JSONObject

/**
 * Карточка «Заряд» в стопке виджета (галочка «Отображать заряд аккумулятора» в форме виджета, `Cfg.battery`).
 * Рисуется здесь же, а не страницей: заряд меняется сам, картинку страница заранее не пришлёт.
 *
 * Внешний вид: синий квадрат с цветным выступом снизу (пропорции как у остальных лиц, `QrWidgets.FACE_*`), в нём один или два столбца:
 * кольцо с значком, «Заряд», «Телефон»/«Наушники», крупные проценты. Наушники подключены (известен заряд) — два столбца (телефон слева,
 * наушники справа); нет — только телефон, и его столбец стоит по центру с теми же размерами и шрифтами.
 *
 * Заряд телефона — липкий `ACTION_BATTERY_CHANGED`. Заряд наушников — Bluetooth: подключённое аудиоустройство из сопряжённых, уровень
 * `BluetoothDevice.getBatteryLevel()` (скрытый метод, через рефлексию) или последнее значение из широкого вещания
 * `BATTERY_LEVEL_CHANGED` (его ловит приёмник, пока жив процесс). Нужны `BLUETOOTH` (до Android 11) / `BLUETOOTH_CONNECT` (12+, запрашивает
 * `MainActivity.requestBluetoothForWidget`); нет разрешения, Bluetooth выключен или заряд не отдаётся — наушников «нет».
 */
object QrBattery {

    /** Ключ карточки в стопке (не совпадает с id настоящих карточек). */
    const val KEY = "__battery"

    private const val PREFS = "qr_widgets"
    private const val K_LEVELS = "btlevels"
    private const val LEVEL_TTL_MS = 12 * 3_600_000L

    private const val ACTION_LEVEL = "android.bluetooth.device.action.BATTERY_LEVEL_CHANGED"
    private const val EXTRA_LEVEL = "android.bluetooth.device.extra.BATTERY_LEVEL"

    private const val FACE_PX = 480
    private const val COLOR_FACE = 0xFF2175D9.toInt()
    private const val COLOR_SHADE = 0xFF1357A5.toInt()

    @Volatile private var registered = false

    // ---------- чтение заряда ----------

    /** Заряд телефона, 0..100; -1 — не удалось узнать. */
    fun phoneLevel(ctx: Context): Int {
        return try {
            val i = ctx.applicationContext.registerReceiver(null, IntentFilter(Intent.ACTION_BATTERY_CHANGED)) ?: return -1
            val level = i.getIntExtra(BatteryManager.EXTRA_LEVEL, -1)
            val scale = i.getIntExtra(BatteryManager.EXTRA_SCALE, 100)
            if (level < 0 || scale <= 0) -1 else (level * 100 / scale).coerceIn(0, 100)
        } catch (e: Throwable) {
            -1
        }
    }

    private fun btPermitted(ctx: Context): Boolean =
        Build.VERSION.SDK_INT < Build.VERSION_CODES.S ||
            androidx.core.content.ContextCompat.checkSelfPermission(ctx, Manifest.permission.BLUETOOTH_CONNECT) == PackageManager.PERMISSION_GRANTED

    private fun adapterOf(ctx: Context): BluetoothAdapter? = try {
        if (Build.VERSION.SDK_INT >= 18) (ctx.getSystemService(Context.BLUETOOTH_SERVICE) as? BluetoothManager)?.adapter
        else @Suppress("DEPRECATION") BluetoothAdapter.getDefaultAdapter()
    } catch (e: Throwable) {
        null
    }

    private fun isConnected(d: BluetoothDevice): Boolean = try {
        (BluetoothDevice::class.java.getMethod("isConnected").invoke(d) as? Boolean) ?: false
    } catch (e: Throwable) {
        false
    }

    private fun cachedLevel(ctx: Context, addr: String): Int {
        return try {
            val o = JSONObject(ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(K_LEVELS, "{}") ?: "{}")
            val a = o.optJSONArray(addr.uppercase()) ?: return -1
            if (System.currentTimeMillis() - a.optLong(1) > LEVEL_TTL_MS) -1 else a.optInt(0, -1)
        } catch (e: Throwable) {
            -1
        }
    }

    private fun cacheLevel(ctx: Context, addr: String, level: Int) {
        try {
            val p = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            val o = JSONObject(p.getString(K_LEVELS, "{}") ?: "{}")
            o.put(addr.uppercase(), org.json.JSONArray().put(level).put(System.currentTimeMillis()))
            p.edit().putString(K_LEVELS, o.toString()).apply()
        } catch (e: Throwable) {
            // кэш не обязателен
        }
    }

    @SuppressLint("MissingPermission")
    private fun levelOf(ctx: Context, d: BluetoothDevice): Int {
        try {
            val v = BluetoothDevice::class.java.getMethod("getBatteryLevel").invoke(d) as? Int
            if (v != null && v in 0..100) {
                cacheLevel(ctx, d.address, v)
                return v
            }
        } catch (e: Throwable) {
            // метод скрыт или недоступен — берём последнее значение из вещания
        }
        return cachedLevel(ctx, d.address)
    }

    /** Подключённые Bluetooth-аудиовыходы: адреса (Android 9+) и названия — их заряд читаем в первую очередь. */
    private fun activeOutputs(ctx: Context): Pair<Set<String>, Set<String>> {
        val addrs = HashSet<String>()
        val names = HashSet<String>()
        try {
            if (Build.VERSION.SDK_INT >= 23) {
                val am = ctx.getSystemService(Context.AUDIO_SERVICE) as AudioManager
                // 7 Bluetooth SCO, 8 Bluetooth A2DP, 23 слуховой аппарат, 26 BLE-гарнитура, 27 BLE-динамик
                val types = intArrayOf(7, 8, 23, 26, 27)
                for (d in am.getDevices(AudioManager.GET_DEVICES_OUTPUTS)) {
                    if (!types.contains(d.type)) continue
                    if (Build.VERSION.SDK_INT >= 28) d.address?.let { if (it.isNotEmpty()) addrs.add(it.uppercase()) }
                    d.productName?.toString()?.let { if (it.isNotEmpty()) names.add(it) }
                }
            }
        } catch (e: Throwable) {
            // без списка устройств остаётся проверка по классу устройства
        }
        return Pair(addrs, names)
    }

    /** Заряд подключённых Bluetooth-наушников, 0..100; -1 — наушников нет или заряд не известен (тогда виджет показывает только телефон). */
    @SuppressLint("MissingPermission")
    fun headphonesLevel(ctx: Context): Int {
        return try {
            val app = ctx.applicationContext
            if (!btPermitted(app)) return -1
            val adapter = adapterOf(app) ?: return -1
            if (!adapter.isEnabled) return -1
            val bonded = adapter.bondedDevices ?: return -1
            val (addrs, names) = activeOutputs(app)
            var fallback = -1
            for (d in bonded) {
                val active = addrs.contains(d.address.uppercase()) || (d.name != null && names.contains(d.name))
                val audio = d.bluetoothClass?.majorDeviceClass == BluetoothClass.Device.Major.AUDIO_VIDEO
                if (!active && !(audio && isConnected(d))) continue
                val lv = levelOf(app, d)
                if (lv < 0) continue
                if (active) return lv
                if (fallback < 0) fallback = lv
            }
            fallback
        } catch (e: Throwable) {
            -1
        }
    }

    /** Строка «телефон/наушники» — по ней виджет понимает, что картинку пора перерисовать. */
    fun signature(ctx: Context): String = phoneLevel(ctx).toString() + "/" + headphonesLevel(ctx)

    // ---------- приёмник событий (пока жив процесс) ----------

    private val receiver = object : BroadcastReceiver() {
        @Suppress("DEPRECATION")
        override fun onReceive(c: Context, i: Intent) {
            try {
                if (i.action == ACTION_LEVEL) {
                    val lv = i.getIntExtra(EXTRA_LEVEL, -1)
                    val dev = i.getParcelableExtra<BluetoothDevice>(BluetoothDevice.EXTRA_DEVICE)
                    if (dev != null && lv in 0..100) cacheLevel(c, dev.address, lv)
                }
                if (i.action != ACTION_LEVEL) QrWidgets.onBluetoothChanged(c) // подключение/отключение: заряд станет известен через пару секунд
                QrWidgets.onBatteryChanged(c)
            } catch (e: Throwable) {
                // виджет не должен ронять приложение
            }
        }
    }

    /** Подписка на смену заряда наушников и на подключение/отключение Bluetooth-устройств; повторный вызов ничего не делает. */
    @Synchronized
    fun register(ctx: Context) {
        if (registered) return
        try {
            val f = IntentFilter()
            f.addAction(ACTION_LEVEL)
            f.addAction(BluetoothDevice.ACTION_ACL_CONNECTED)
            f.addAction(BluetoothDevice.ACTION_ACL_DISCONNECTED)
            val app = ctx.applicationContext
            if (Build.VERSION.SDK_INT >= 33) app.registerReceiver(receiver, f, Context.RECEIVER_EXPORTED) else app.registerReceiver(receiver, f)
            registered = true
        } catch (e: Throwable) {
            // нет разрешения или запрещено системой — остаётся опрос по таймеру
        }
    }

    // ---------- картинка карточки ----------

    /** Лицо карточки «Заряд»: та же пропорция и скругление, что у остальных лиц стопки. */
    fun render(ctx: Context): Bitmap {
        val w = FACE_PX.toFloat()
        val body = Math.round(w * QrWidgets.FACE_BODY).toFloat()
        val shift = Math.round(w * QrWidgets.FACE_SHADE).toFloat()
        val bmp = Bitmap.createBitmap(FACE_PX, (body + shift).toInt(), Bitmap.Config.ARGB_8888)
        val g = Canvas(bmp)
        val p = Paint(Paint.ANTI_ALIAS_FLAG)
        val r = w * QrWidgets.FACE_RADIUS
        p.color = COLOR_SHADE
        g.drawRoundRect(RectF(0f, shift, w, shift + body), r, r, p)
        p.color = COLOR_FACE
        g.drawRoundRect(RectF(0f, 0f, w, body), r, r, p)

        val phone = phoneLevel(ctx)
        val hp = headphonesLevel(ctx)
        if (hp >= 0) {
            column(g, w, 0.268f, phone, false)
            column(g, w, 0.732f, hp, true)
        } else {
            column(g, w, 0.5f, phone, false)
        }
        return bmp
    }

    /** Один столбец с центром на доле [fx] ширины. Размеры и шрифты не зависят от того, один столбец или два. */
    private fun column(g: Canvas, w: Float, fx: Float, pct: Int, headphones: Boolean) {
        val cx = w * fx
        val cy = w * 0.310f
        val rr = w * (if (headphones) 0.1434f else 0.1283f)
        val sw = w * 0.0205f

        val ring = Paint(Paint.ANTI_ALIAS_FLAG)
        ring.style = Paint.Style.STROKE
        ring.strokeWidth = sw
        ring.strokeCap = Paint.Cap.ROUND
        ring.color = 0x59FFFFFF
        g.drawCircle(cx, cy, rr, ring)
        ring.color = 0xFFFFFFFF.toInt()
        if (pct >= 100) {
            g.drawCircle(cx, cy, rr, ring)
        } else if (pct > 0) {
            g.drawArc(RectF(cx - rr, cy - rr, cx + rr, cy + rr), -90f, 360f * pct / 100f, false, ring)
        }

        if (headphones) drawHeadphones(g, w, cx, cy) else drawPhone(g, w, cx, cy)

        val t = Paint(Paint.ANTI_ALIAS_FLAG)
        t.color = 0xFFFFFFFF.toInt()
        t.textAlign = Paint.Align.CENTER

        t.typeface = Typeface.create("sans-serif", Typeface.NORMAL)
        t.textSize = w * 0.057f
        g.drawText("Заряд", cx, w * 0.584f, t)

        t.typeface = Typeface.create("serif", Typeface.BOLD)
        t.textSize = w * 0.072f
        g.drawText(if (headphones) "Наушники" else "Телефон", cx, w * 0.667f, t)

        t.typeface = Typeface.create("sans-serif", Typeface.BOLD)
        t.textSize = w * 0.195f
        val text = if (pct < 0) "--%" else "$pct%"
        val maxW = w * 0.43f
        val tw = t.measureText(text)
        if (tw > maxW) t.textScaleX = maxW / tw // «100%» сжимается по ширине, высота цифр прежняя
        g.drawText(text, cx, w * 0.858f, t)
    }

    private fun iconPaint(w: Float): Paint {
        val p = Paint(Paint.ANTI_ALIAS_FLAG)
        p.style = Paint.Style.STROKE
        p.strokeWidth = w * 0.0100f
        p.strokeCap = Paint.Cap.ROUND
        p.strokeJoin = Paint.Join.ROUND
        p.color = 0xFFFFFFFF.toInt()
        return p
    }

    /** Значок телефона: рамка с вырезом сверху и точкой снизу. */
    private fun drawPhone(g: Canvas, w: Float, cx: Float, cy: Float) {
        val p = iconPaint(w)
        val mid = cy + w * 0.006f
        val hw = w * 0.043f
        val hh = w * 0.0605f
        val left = cx - hw
        val right = cx + hw
        val top = mid - hh
        val bottom = mid + hh
        val rad = w * 0.022f
        g.drawRoundRect(RectF(left, top, right, bottom), rad, rad, p)
        // вырез под камеру: стираем кусок верхней грани цветом лица и рисуем «ступеньку» ниже
        val nw = w * 0.019f
        val nd = w * 0.012f
        val erase = Paint(Paint.ANTI_ALIAS_FLAG)
        erase.style = Paint.Style.STROKE
        erase.strokeWidth = p.strokeWidth + 2f
        erase.color = COLOR_FACE
        g.drawLine(cx - nw, top, cx + nw, top, erase)
        val path = Path()
        path.moveTo(cx - nw, top)
        path.lineTo(cx - nw, top + nd)
        path.lineTo(cx + nw, top + nd)
        path.lineTo(cx + nw, top)
        g.drawPath(path, p)
        val dot = Paint(Paint.ANTI_ALIAS_FLAG)
        dot.color = 0xFFFFFFFF.toInt()
        g.drawCircle(cx, bottom - w * 0.031f, w * 0.0068f, dot)
    }

    /** Значок наушников: дуга-оголовье и две чашки. */
    private fun drawHeadphones(g: Canvas, w: Float, cx: Float, cy: Float) {
        val p = iconPaint(w)
        val rad = w * 0.050f
        val arcCy = cy + w * 0.0172f
        g.drawArc(RectF(cx - rad, arcCy - rad, cx + rad, arcCy + rad), 180f, 180f, false, p)
        val top = cy + w * 0.0152f
        val bottom = cy + w * 0.0626f
        val cupW = w * 0.036f
        val cr = w * 0.018f
        val l1 = cx - w * 0.049f
        g.drawRoundRect(RectF(l1, top, l1 + cupW, bottom), cr, cr, p)
        val r2 = cx + w * 0.049f
        g.drawRoundRect(RectF(r2 - cupW, top, r2, bottom), cr, cr, p)
    }
}
