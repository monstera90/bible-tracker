package com.app.lifetracker
// Версия: 4.2 (13.11)

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
import android.graphics.Path
import org.json.JSONArray
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

    /** Во сколько раз значки телефона и наушников и кольца вокруг них больше исходных (толщина линий прежняя). */
    private const val ICON_SCALE = 1.5f

    /** Высота центров колец, доля ширины карточки: верхний ряд — прежнее место кругов карточки «Заряд» (телефон и наушники), нижний ряд карточки «несколько устройств». */
    private const val ROW_TOP = 0.310f
    private const val ROW_BOTTOM = 0.740f

    /** Ключ карточки в стопке (не совпадает с id настоящих карточек). */
    const val KEY = "__battery"

    /** Ключ карточки «несколько устройств»: только кольца и значки, без надписей. */
    const val KEY2 = "__battery2"

    fun isBatteryKey(key: String): Boolean = key == KEY || key == KEY2

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

    /** Когда уровень устройства последний раз получен (из вещания или чтением), мс; 0 — ни разу. */
    private fun cacheStamp(ctx: Context, addr: String): Long {
        return try {
            val o = JSONObject(ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(K_LEVELS, "{}") ?: "{}")
            o.optJSONArray(addr.uppercase())?.optLong(1) ?: 0L
        } catch (e: Throwable) {
            0L
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
        return JSONObject().put("reason", p.reason).put("name", p.name).put("level", p.level).put("devices", pairedDevices(ctx))
    }

    /** Парные Bluetooth-устройства: [{name, on (подключено), icon}] — форма виджета показывает их имена и значок, который достанется каждому. */
    @SuppressLint("MissingPermission")
    private fun pairedDevices(ctx: Context): JSONArray {
        val out = JSONArray()
        try {
            val app = ctx.applicationContext
            if (!btPermitted(app)) return out
            val adapter = adapterOf(app) ?: return out
            if (!adapter.isEnabled) return out
            val (addrs, names) = activeOutputs(app)
            for (d in adapter.bondedDevices ?: emptySet<BluetoothDevice>()) {
                val on = isActive(d, addrs, names) || isConnected(d)
                out.put(JSONObject().put("name", d.name ?: "").put("on", on).put("icon", iconKind(d)))
                if (out.length() >= 30) break
            }
        } catch (e: Throwable) {
            // список не обязателен
        }
        return out
    }

    private fun isActive(d: BluetoothDevice, addrs: Set<String>, names: Set<String>): Boolean =
        addrs.contains(d.address.uppercase()) || (d.name != null && names.contains(d.name))

    /** Значок устройства: сначала по названию (правила ниже), затем по классу Bluetooth-устройства; запасной — знак Bluetooth. */
    @SuppressLint("MissingPermission")
    private fun iconKind(d: BluetoothDevice): String {
        val n = (d.name ?: "").lowercase()
        if (n.isNotEmpty()) for ((part, kind) in NAME_ICONS) if (n.contains(part)) return kind
        val c = d.bluetoothClass ?: return "generic"
        return when {
            c.majorDeviceClass == BluetoothClass.Device.Major.WEARABLE -> "watch"
            c.majorDeviceClass == BluetoothClass.Device.Major.COMPUTER -> "laptop"
            c.majorDeviceClass == BluetoothClass.Device.Major.AUDIO_VIDEO -> when (c.deviceClass) {
                BluetoothClass.Device.AUDIO_VIDEO_LOUDSPEAKER, BluetoothClass.Device.AUDIO_VIDEO_PORTABLE_AUDIO,
                BluetoothClass.Device.AUDIO_VIDEO_HIFI_AUDIO, BluetoothClass.Device.AUDIO_VIDEO_CAR_AUDIO -> "speaker"
                else -> "headphones"
            }
            else -> "generic"
        }
    }

    /** Правила «часть названия → значок» (регистр не важен); проверяются по порядку, раньше класса устройства. */
    private val NAME_ICONS = listOf(
        "shutter" to "shutter", "selfie" to "shutter",
        "keyboard" to "keyboard", "клавиатур" to "keyboard",
        "desktop" to "laptop", "laptop" to "laptop", "notebook" to "laptop", "ноутбук" to "laptop",
        "xiaomi pad" to "tablet", "ipad" to "tablet", "tablet" to "tablet", "планшет" to "tablet",
        "pods" to "earbuds", "buds" to "earbuds", "earbud" to "earbuds",
        "watch" to "watch", "band" to "watch", "часы" to "watch", "браслет" to "watch",
        "speaker" to "speaker", "колонк" to "speaker", "soundbar" to "speaker", "boombox" to "speaker",
        "life q35" to "headphones", "headphone" to "headphones", "headset" to "headphones", "наушник" to "headphones"
    )

    private class Dev(val icon: String, val level: Int)

    /** Круги карточки «несколько устройств»: телефон, затем до трёх подключённых Bluetooth-устройств (сначала звуковые). Уровень -1 — заряд не известен. */
    @SuppressLint("MissingPermission")
    private fun devices(ctx: Context): List<Dev> {
        val out = ArrayList<Dev>()
        out.add(Dev("phone", phoneLevel(ctx)))
        try {
            val app = ctx.applicationContext
            if (!btPermitted(app)) return out
            val adapter = adapterOf(app) ?: return out
            if (!adapter.isEnabled) return out
            val bonded = adapter.bondedDevices ?: return out
            val (addrs, names) = activeOutputs(app)
            val live = ArrayList<Triple<Int, String, Dev>>() // (порядок, название, круг)
            for (d in bonded) {
                val active = isActive(d, addrs, names)
                if (!active && !isConnected(d)) continue
                val audio = d.bluetoothClass?.majorDeviceClass == BluetoothClass.Device.Major.AUDIO_VIDEO
                val rank = if (active) 0 else if (audio) 1 else 2
                live.add(Triple(rank, d.name ?: "", Dev(iconKind(d), levelOf(app, d))))
            }
            live.sortWith(compareBy({ it.first }, { it.second }))
            for (t in live) {
                if (out.size >= 4) break
                out.add(t.third)
            }
        } catch (e: Throwable) {
            // остаётся только телефон
        }
        return out
    }

    /**
     * Узнали ли заряд всех сейчас подключённых Bluetooth-устройств (любых, не только наушников) после времени [since]: значение должно быть
     * свежим — получено при этом подключении, а не оставшимся в кэше от прошлого. Подключённых устройств пока нет (система ещё не отметила
     * подключение) — false, проверку надо повторить. Нет разрешения, Bluetooth выключен или ошибка — true: повторять нечего.
     * Устройство, которое заряд не сообщает вовсе (клавиатура, колонка), удерживает false — серия проверок сама остановится по числу шагов.
     */
    @SuppressLint("MissingPermission")
    fun settled(ctx: Context, since: Long): Boolean {
        return try {
            val app = ctx.applicationContext
            if (!btPermitted(app)) return true
            val adapter = adapterOf(app) ?: return true
            if (!adapter.isEnabled) return true
            val (addrs, names) = activeOutputs(app)
            var any = false
            for (d in adapter.bondedDevices ?: emptySet<BluetoothDevice>()) {
                if (!isActive(d, addrs, names) && !isConnected(d)) continue
                any = true
                levelOf(app, d) // удачное чтение само обновит отметку времени в кэше
                if (cacheStamp(app, d.address) < since) return false
            }
            any
        } catch (e: Throwable) {
            true
        }
    }

    /** Строка по кругам карточки «несколько устройств» — по ней виджет понимает, что картинку пора перерисовать. */
    fun signatureMulti(ctx: Context): String = devices(ctx).joinToString("|") { it.icon + ":" + it.level }

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
                // подключение: серия проверок (заряд становится известен через секунды); отключение: одна перерисовка
                if (i.action != ACTION_LEVEL) QrWidgets.onBluetoothChanged(c, i.action == BluetoothDevice.ACTION_ACL_CONNECTED)
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

    /**
     * Лицо карточки «несколько устройств»: от одного до четырёх колец со значками, без надписей. Размеры колец и значков те же, что у карточки «Заряд».
     * Верхний ряд стоит на месте столбцов карточки «Заряд» (`ROW_TOP`, телефон слева, второе устройство справа; один круг — по центру): один-два круга — только он;
     * три — третий по центру нижнего ряда (`ROW_BOTTOM`); четыре — два в нижнем ряду под верхними.
     */
    fun renderMulti(ctx: Context, face: Int = DEFAULT_FACE): Bitmap {
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

        val list = devices(ctx)
        val left = 0.268f
        val right = 0.732f
        val rowTop = ROW_TOP
        val rowBottom = ROW_BOTTOM
        for ((i, d) in list.withIndex()) {
            val fx: Float
            val fy: Float
            when (list.size) {
                1 -> { fx = 0.5f; fy = rowTop }
                2 -> { fx = if (i == 0) left else right; fy = rowTop }
                3 -> if (i < 2) { fx = if (i == 0) left else right; fy = rowTop } else { fx = 0.5f; fy = rowBottom }
                else -> { fx = if (i % 2 == 0) left else right; fy = if (i < 2) rowTop else rowBottom }
            }
            ringIcon(g, w, w * fx, w * fy, d.level, d.icon)
        }
        return bmp
    }

    /** Кольцо заряда [pct] (меньше нуля — заряд не известен, только дорожка) с центром в (cx, cy) и значок [icon] внутри. */
    private fun ringIcon(g: Canvas, w: Float, cx: Float, cy: Float, pct: Int, icon: String) {
        val rr = w * 0.1263f * ICON_SCALE // кольцо растёт вместе со значком
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
        when (icon) {
            "headphones" -> drawHeadphones(g, w, cx, cy)
            "watch" -> drawWatch(g, w, cx, cy)
            "speaker" -> drawSpeaker(g, w, cx, cy)
            "earbuds" -> drawEarbuds(g, w, cx, cy)
            "keyboard" -> drawKeyboard(g, w, cx, cy)
            "laptop" -> drawLaptop(g, w, cx, cy)
            "tablet" -> drawTablet(g, w, cx, cy)
            "shutter" -> drawShutter(g, w, cx, cy)
            "generic" -> drawBluetooth(g, w, cx, cy)
            else -> drawPhone(g, w, cx, cy)
        }
        g.restore()
    }

    /** Значок часов: корпус и два ремешка. */
    private fun drawWatch(g: Canvas, w: Float, cx: Float, cy: Float) {
        val p = iconPaint(w)
        g.drawRoundRect(RectF(cx - w * 0.032f, cy - w * 0.034f, cx + w * 0.032f, cy + w * 0.034f), w * 0.014f, w * 0.014f, p)
        g.drawRoundRect(RectF(cx - w * 0.017f, cy - w * 0.058f, cx + w * 0.017f, cy - w * 0.034f), w * 0.008f, w * 0.008f, p)
        g.drawRoundRect(RectF(cx - w * 0.017f, cy + w * 0.034f, cx + w * 0.017f, cy + w * 0.058f), w * 0.008f, w * 0.008f, p)
    }

    /** Значок колонки: корпус, маленький динамик сверху и большой снизу. */
    private fun drawSpeaker(g: Canvas, w: Float, cx: Float, cy: Float) {
        val p = iconPaint(w)
        g.drawRoundRect(RectF(cx - w * 0.035f, cy - w * 0.055f, cx + w * 0.035f, cy + w * 0.055f), w * 0.016f, w * 0.016f, p)
        val fill = Paint(Paint.ANTI_ALIAS_FLAG)
        fill.color = 0xFFFFFFFF.toInt()
        g.drawCircle(cx, cy - w * 0.03f, w * 0.009f, fill)
        g.drawCircle(cx, cy + w * 0.018f, w * 0.022f, p)
    }

    /** Значок наушников-вкладышей: две «головки» с ножками снаружи. */
    private fun drawEarbuds(g: Canvas, w: Float, cx: Float, cy: Float) {
        val p = iconPaint(w)
        for (sgn in intArrayOf(-1, 1)) {
            g.drawCircle(cx + sgn * w * 0.028f, cy - w * 0.014f, w * 0.018f, p)
            g.drawLine(cx + sgn * w * 0.044f, cy - w * 0.014f, cx + sgn * w * 0.044f, cy + w * 0.040f, p)
        }
    }

    /** Значок клавиатуры: корпус, два ряда клавиш точками и пробел. */
    private fun drawKeyboard(g: Canvas, w: Float, cx: Float, cy: Float) {
        val p = iconPaint(w)
        g.drawRoundRect(RectF(cx - w * 0.052f, cy - w * 0.030f, cx + w * 0.052f, cy + w * 0.030f), w * 0.008f, w * 0.008f, p)
        val fill = Paint(Paint.ANTI_ALIAS_FLAG)
        fill.color = 0xFFFFFFFF.toInt()
        for (i in -2..2) {
            g.drawCircle(cx + i * w * 0.016f, cy - w * 0.015f, w * 0.0045f, fill)
            g.drawCircle(cx + i * w * 0.016f, cy - w * 0.003f, w * 0.0045f, fill)
        }
        g.drawLine(cx - w * 0.026f, cy + w * 0.015f, cx + w * 0.026f, cy + w * 0.015f, p)
    }

    /** Значок ноутбука: экран и основание. */
    private fun drawLaptop(g: Canvas, w: Float, cx: Float, cy: Float) {
        val p = iconPaint(w)
        g.drawRoundRect(RectF(cx - w * 0.036f, cy - w * 0.040f, cx + w * 0.036f, cy + w * 0.016f), w * 0.006f, w * 0.006f, p)
        g.drawLine(cx - w * 0.050f, cy + w * 0.034f, cx + w * 0.050f, cy + w * 0.034f, p)
    }

    /** Значок планшета: широкая рамка и кнопка сбоку. */
    private fun drawTablet(g: Canvas, w: Float, cx: Float, cy: Float) {
        val p = iconPaint(w)
        g.drawRoundRect(RectF(cx - w * 0.058f, cy - w * 0.042f, cx + w * 0.058f, cy + w * 0.042f), w * 0.010f, w * 0.010f, p)
        val fill = Paint(Paint.ANTI_ALIAS_FLAG)
        fill.color = 0xFFFFFFFF.toInt()
        g.drawCircle(cx + w * 0.046f, cy, w * 0.005f, fill)
    }

    /** Значок кнопки съёмки (штатив, селфи-пульт): круглая кнопка с точкой-«спуском». */
    private fun drawShutter(g: Canvas, w: Float, cx: Float, cy: Float) {
        val p = iconPaint(w)
        g.drawCircle(cx, cy, w * 0.040f, p)
        val fill = Paint(Paint.ANTI_ALIAS_FLAG)
        fill.color = 0xFFFFFFFF.toInt()
        g.drawCircle(cx, cy, w * 0.022f, fill)
    }

    /** Запасной значок — знак Bluetooth. */
    private fun drawBluetooth(g: Canvas, w: Float, cx: Float, cy: Float) {
        val p = iconPaint(w)
        val path = Path()
        path.moveTo(cx - w * 0.028f, cy - w * 0.026f)
        path.lineTo(cx + w * 0.028f, cy + w * 0.026f)
        path.lineTo(cx, cy + w * 0.054f)
        path.lineTo(cx, cy - w * 0.054f)
        path.lineTo(cx + w * 0.028f, cy - w * 0.026f)
        path.lineTo(cx - w * 0.028f, cy + w * 0.026f)
        g.drawPath(path, p)
    }

    /** Один столбец с центром на доле [fx] ширины. Размеры и шрифты не зависят от того, один столбец или два; кольца у телефона и наушников одинаковые. */
    private fun column(g: Canvas, w: Float, fx: Float, pct: Int, headphones: Boolean) {
        val cx = w * fx
        val cy = w * ROW_TOP
        ringIcon(g, w, cx, cy, pct, if (headphones) "headphones" else "phone")

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
