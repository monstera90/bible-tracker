package com.app.lifetracker
// Версия: 2.1 (12.11)

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
 * Внешний вид: квадрат цвета, выбранного в форме виджета (палитра та же, что у карточек QR-кодов), с выступом снизу на пятую часть темнее
 * (пропорции как у остальных лиц, `QrWidgets.FACE_*`), в нём один или два столбца: кольцо со значком, «Заряд», «Телефон»/«Наушники»,
 * крупные проценты. Кольца у обоих столбцов одного размера. Наушники подключены — два столбца (телефон слева, наушники справа; заряд
 * неизвестен — «--%»); нет — только телефон, и его столбец стоит по центру с теми же размерами и шрифтами.
 *
 * Заряд телефона — липкий `ACTION_BATTERY_CHANGED`. Заряд наушников — Bluetooth: подключённое аудиоустройство из сопряжённых, уровень
 * `BluetoothDevice.getBatteryLevel()` (скрытый метод, через рефлексию; на новых Android может быть закрыт) или последнее значение из
 * широкого вещания `BATTERY_LEVEL_CHANGED` — это то же число, что показывают настройки системы, но приходит оно только при подключении
 * и смене заряда, поэтому приёмник нужно поднять до подключения (`register` зовётся и из `QrWidgets.onBluetoothChanged`). Нужны
 * `BLUETOOTH` (до Android 11) / `BLUETOOTH_CONNECT` (12+, запрашивает `MainActivity.requestBluetoothForWidget`). Причину, по которой
 * заряд наушников неизвестен, отдаёт [status] (страница показывает её в форме виджета).
 */
object QrBattery {

    /** Во сколько раз значки телефона и наушников больше исходных (кольцо не меняется). */
    private const val ICON_SCALE = 1.5f

    /** Ключ карточки в стопке (не совпадает с id настоящих карточек). */
    const val KEY = "__battery"

    private const val PREFS = "qr_widgets"
    private const val K_LEVELS = "btlevels"
    private const val LEVEL_TTL_MS = 12 * 3_600_000L

    private const val ACTION_LEVEL = "android.bluetooth.device.action.BATTERY_LEVEL_CHANGED"
    private const val EXTRA_LEVEL = "android.bluetooth.device.extra.BATTERY_LEVEL"

    private const val FACE_PX = 480

    /** Цвет лица, если страница его не прислала: сиреневый, как у карточек без цвета (`DEFAULT_CARD_COLOR` в itemcards.js). */
    const val DEFAULT_FACE = 0xFFB9A1FF.toInt()

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

    /** Нужно ли ещё разрешение «Устройства поблизости» (Android 12+) для чтения заряда наушников. */
    fun permissionMissing(ctx: Context): Boolean = !btPermitted(ctx.applicationContext)

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

    /** Итог поиска наушников: [reason] — ok (заряд известен) / nolevel (подключены, заряд не отдаются) / perm / off / nobt / none. */
    private class Probe(val reason: String, val name: String = "", val level: Int = -1)

    @SuppressLint("MissingPermission")
    private fun probe(ctx: Context): Probe {
        return try {
            val app = ctx.applicationContext
            if (!btPermitted(app)) return Probe("perm")
            val adapter = adapterOf(app) ?: return Probe("nobt")
            if (!adapter.isEnabled) return Probe("off")
            val bonded = adapter.bondedDevices ?: return Probe("none")
            val (addrs, names) = activeOutputs(app)
            var known: Probe? = null // подключённое устройство с известным зарядом, но не активный аудиовыход
            var unknown: Probe? = null // подключённое устройство без заряда
            for (d in bonded) {
                val active = addrs.contains(d.address.uppercase()) || (d.name != null && names.contains(d.name))
                val audio = d.bluetoothClass?.majorDeviceClass == BluetoothClass.Device.Major.AUDIO_VIDEO
                if (!active && !(audio && isConnected(d))) continue
                val lv = levelOf(app, d)
                val nm = d.name ?: ""
                if (lv >= 0) {
                    if (active) return Probe("ok", nm, lv)
                    if (known == null) known = Probe("ok", nm, lv)
                } else if (unknown == null) {
                    unknown = Probe("nolevel", nm)
                }
            }
            known ?: unknown ?: Probe("none")
        } catch (e: SecurityException) {
            Probe("perm")
        } catch (e: Throwable) {
            Probe("none")
        }
    }

    /** Заряд подключённых Bluetooth-наушников, 0..100; -2 — подключены, но заряд не известен («--%»); -1 — наушников нет (виджет показывает только телефон). */
    fun headphonesLevel(ctx: Context): Int {
        val p = probe(ctx)
        return when (p.reason) {
            "ok" -> p.level
            "nolevel" -> -2
            else -> -1
        }
    }

    /** {"reason","name","level"} — что с наушниками сейчас; для формы виджета (мост `widgetsState`, поле `bt`). */
    fun status(ctx: Context): JSONObject {
        val p = probe(ctx)
        return JSONObject().put("reason", p.reason).put("name", p.name).put("level", p.level)
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

    /** Цвет выступа снизу: каждый канал на пятую часть темнее (тот же расчёт, что `cardShade` в itemcards.js). */
    private fun shadeOf(face: Int): Int {
        val r = Math.round(((face shr 16) and 255) * 0.8f)
        val g = Math.round(((face shr 8) and 255) * 0.8f)
        val b = Math.round((face and 255) * 0.8f)
        return (0xFF shl 24) or (r shl 16) or (g shl 8) or b
    }

    /** Лицо карточки «Заряд»: та же пропорция и скругление, что у остальных лиц стопки; [face] — цвет, выбранный в форме виджета. */
    fun render(ctx: Context, face: Int = DEFAULT_FACE): Bitmap {
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

        val phone = phoneLevel(ctx)
        val hp = headphonesLevel(ctx)
        if (hp != -1) {
            column(g, w, 0.268f, phone, false)
            column(g, w, 0.732f, hp, true)
        } else {
            column(g, w, 0.5f, phone, false)
        }
        return bmp
    }

    /** Один столбец с центром на доле [fx] ширины. Размеры и шрифты не зависят от того, один столбец или два; кольца у телефона и наушников одинаковые. */
    private fun column(g: Canvas, w: Float, fx: Float, pct: Int, headphones: Boolean) {
        val cx = w * fx
        val cy = w * 0.310f
        val rr = w * 0.1263f
        val sw = w * 0.0212f

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

        // значок крупнее: масштаб от центра кольца, толщина линии остаётся прежней (iconPaint делит её на ICON_SCALE)
        g.save()
        g.scale(ICON_SCALE, ICON_SCALE, cx, cy)
        if (headphones) drawHeadphones(g, w, cx, cy) else drawPhone(g, w, cx, cy)
        g.restore()

        val t = Paint(Paint.ANTI_ALIAS_FLAG)
        t.color = 0xFFFFFFFF.toInt()
        t.textAlign = Paint.Align.CENTER

        t.typeface = Typeface.create("sans-serif", Typeface.NORMAL)
        t.textSize = w * 0.0511f
        g.drawText("Заряд", cx, w * 0.582f, t)

        // «Телефон»/«Наушники» — жирный с засечками; небольшая обводка добавляет плотности, если системный шрифт тоньше образца
        t.typeface = Typeface.create("serif", Typeface.BOLD)
        t.textSize = w * 0.065f
        t.style = Paint.Style.FILL_AND_STROKE
        t.strokeWidth = w * 0.0022f
        g.drawText(if (headphones) "Наушники" else "Телефон", cx, w * 0.667f, t)

        // проценты — самый плотный вес системного гротеска (black), с той же обводкой
        t.typeface = Typeface.create("sans-serif-black", Typeface.NORMAL)
        t.textSize = w * 0.160f
        t.strokeWidth = w * 0.0030f
        val text = if (pct < 0) "--%" else "$pct%"
        val maxW = w * 0.43f
        val tw = t.measureText(text)
        if (tw > maxW) t.textScaleX = maxW / tw // «100%» сжимается по ширине, высота цифр прежняя
        g.drawText(text, cx, w * 0.857f, t)
    }

    /** Кисть значков: толстая линия с закруглёнными концами (как в образце — вес линии значка ≈ 0,0126 ширины карточки). */
    private fun iconPaint(w: Float): Paint {
        val p = Paint(Paint.ANTI_ALIAS_FLAG)
        p.style = Paint.Style.STROKE
        p.strokeWidth = w * 0.0126f / ICON_SCALE
        p.strokeCap = Paint.Cap.ROUND
        p.strokeJoin = Paint.Join.ROUND
        p.color = 0xFFFFFFFF.toInt()
        return p
    }

    /** Значок телефона: рамка, «чёлка» сверху (выступ верхней грани вниз) и точка снизу. */
    private fun drawPhone(g: Canvas, w: Float, cx: Float, cy: Float) {
        val p = iconPaint(w)
        val mid = cy + w * 0.0057f
        val hw = w * 0.0367f
        val hh = w * 0.0547f
        val top = mid - hh
        val bottom = mid + hh
        val rad = w * 0.0127f
        g.drawRoundRect(RectF(cx - hw, top, cx + hw, bottom), rad, rad, p)
        val fill = Paint(Paint.ANTI_ALIAS_FLAG)
        fill.color = 0xFFFFFFFF.toInt()
        val nw = w * 0.012f
        val nr = w * 0.0063f
        g.drawRoundRect(RectF(cx - nw, top - w * 0.004f, cx + nw, top + w * 0.0123f), nr, nr, fill)
        g.drawCircle(cx, bottom - w * 0.0231f, w * 0.0064f, fill)
    }

    /** Значок наушников: дуга-оголовье, переходящая в стенки двух чашек. */
    private fun drawHeadphones(g: Canvas, w: Float, cx: Float, cy: Float) {
        val p = iconPaint(w)
        val rad = w * 0.0487f
        val arcCy = cy + w * 0.0063f
        g.drawArc(RectF(cx - rad, arcCy - rad, cx + rad, arcCy + rad), 180f, 180f, false, p)
        val cupTop = cy + w * 0.0131f
        val cupBottom = cy + w * 0.0548f
        val cupW = w * 0.0298f
        val cr = w * 0.0149f
        val outer = w * 0.0487f
        // левая: стенка дуги продолжается вниз до закругления чашки
        g.drawLine(cx - outer, arcCy, cx - outer, cupTop + cr, p)
        g.drawRoundRect(RectF(cx - outer, cupTop, cx - outer + cupW, cupBottom), cr, cr, p)
        // правая — зеркально
        g.drawLine(cx + outer, arcCy, cx + outer, cupTop + cr, p)
        g.drawRoundRect(RectF(cx + outer - cupW, cupTop, cx + outer, cupBottom), cr, cr, p)
    }
}
