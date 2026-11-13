package com.app.lifetracker
// Версия: 7.0 (13.11)

import android.app.AlarmManager
import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.res.Configuration
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.RectF
import android.net.Uri
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.PowerManager
import android.os.SystemClock
import android.util.Base64
import android.widget.RemoteViews
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.util.Calendar
import java.util.Collections
import java.util.UUID

/**
 * Виджеты рабочего стола «Стопка QR-карточек» 2×2 (вкладка «Конструктор виджетов»).
 *
 * Страница (widgets.js, мост ≥31 `widgetsSync`) присылает JSON: виджеты, их карточки (код QR, название, признаки «идёт ли сейчас»,
 * время суток и дни недели) и готовые картинки лиц карточек (PNG, один на карточку, `images`). Картинки лежат в `files/qrwidgets/<id>.png`,
 * настройки — SharedPreferences `qr_widgets`. Привязка «виджет на рабочем столе → виджет конструктора» — там же (`bind`).
 *
 * Сам виджет — StackView (смахивание вверх/вниз по кругу), см. [QrWidgetService]. Обновления идут вручную: при изменении данных
 * (`sync`), при старте/остановке таймера, помодоро, секундомера и тренировки (`onActivityChanged`), по будильнику смены интервала
 * времени суток (`ACTION_TICK`) и по будильнику «слайд-шоу» (`ACTION_ROTATE`).
 *
 * Нажатие на карточку открывает ScanActivity с кодом настоящей карточки (`lt://v1/card/<id>`) — ровно то, что произошло бы при её сканировании.
 * «После срабатывания» (`after` у карточки): "hide" — карточка скрыта в стопке до конца дня, "end" — уходит в конец стопки; если скрыты все карточки,
 * виджет показывает «На сегодня больше ничего». Срабатывание — нажатие в виджете ([onCardFired] из ScanActivity) или нажатие/скан карточки
 * в приложении (мост ≥32 `widgetCardFired`).
 *
 * Галочка «Отображать заряд аккумулятора» (`battery` у виджета): в конец стопки добавляется служебная карточка [QrBattery.KEY] — её лицо рисует
 * [QrBattery.render] (заряд телефона и Bluetooth-наушников), нажатие на неё ничего не делает. Галочка «…(несколько устройств)» (`batteryMulti`) добавляет
 * после неё ещё одну служебную карточку [QrBattery.KEY2] ([QrBattery.renderMulti]): только кольца и значки телефона и до трёх подключённых Bluetooth-устройств. Картинка перерисовывается по будильнику
 * `ACTION_BATTERY` (раз в 5 минут, если заряд изменился), при подключении/отключении Bluetooth-устройства и при вещании о заряде наушников.
 *
 * Галочки «Показывать задачи» (`tasks`) и «Показывать события календаря» (`events`): страница присылает в `dyn` кандидатов — задачи (`k`="task", `at` — время
 * задачи, мс) и ближайшие события (`k`="event") — и по две картинки на каждого: `<ключ>.png` («Сегодня») и `<ключ>_b.png` («Просрочено» у задачи, «Завтра»
 * у события). Что показать, решает оболочка по часам ([dynShown], [dynBitmap]), поэтому надпись и состав меняются без приложения: задача видна, пока её время
 * сегодня или раньше (раньше начала суток — «Просрочено»); событие — одно, ближайшее из ещё не начавшихся на сегодня или завтра ([nextEventKey]); нет такого —
 * карточки нет. Будильник `ACTION_TICK` ставится на полночь и на начало ближайшего события ([nextDynChange]). Карточки стоят после QR-карточек и перед карточками заряда;
 * нажатие на них ничего не делает. Среди этих карточек события всегда стоят перед задачами (событие важнее).
 *
 * Возврат наверх («по релевантности», [armReturn]/[fireReturn]): если пользователь смахнул стопку, а наверху лежит рекомендованная
 * карточка (идёт занятие или сейчас «её» время суток — [Ordered.topKey]) либо карточка события/задачи календаря ([anchorKey]), то через минуту
 * после последнего смахивания стопка снова показывает верхнюю карточку порядка [order]. Данные от страницы (`sync`), не менявшие настройки
 * виджета (только состав задач и событий), положение стопки не трогают ([structSig]). Смахивание система оболочке не сообщает, его видно только по запросу фабрики
 * ([QrWidgetService]: счётчик в `VIRT` раз больше числа карточек), см. [onPossibleSwipe].
 */
object QrWidgets {

    private const val PREFS = "qr_widgets"
    private const val K_CFG = "cfg"
    private const val K_BIND = "bind"
    private const val K_TOP = "top"
    private const val K_PEND = "pend"
    private const val K_TOKEN = "token"
    private const val K_FIRED = "fired"
    private const val K_BTWANT = "btwant"
    private const val K_BTASK = "btask"
    private const val K_BTASKAT = "btaskat"
    private const val K_RETURN = "ret"

    const val ACTION_ROTATE = "com.app.lifetracker.QRW_ROTATE"
    const val ACTION_TICK = "com.app.lifetracker.QRW_TICK"
    const val ACTION_BATTERY = "com.app.lifetracker.QRW_BATTERY"
    const val ACTION_RETURN = "com.app.lifetracker.QRW_RETURN"

    private const val PEND_TTL_MS = 3 * 60_000L
    private const val DOTS_SHOW_MS = 1400L
    private const val RETURN_AFTER_MS = 60_000L
    private const val SWIPE_QUIET_MS = 4_000L
    private const val BATTERY_EVERY_MS = 5 * 60_000L
    private const val BATTERY_AFTER_BT_MS = 6_000L
    private const val BT_ASK_EVERY_MS = 24 * 3_600_000L
    private const val MAX_CARDS = 10
    private const val MAX_DYN = 24
    private val KEY_RE = Regex("^[A-Za-z0-9_-]{1,40}$")

    // Интервалы времени суток (минуты от полуночи, [начало; конец)). Те же значения показывает страница (widgets.js, WINDOWS).
    private val WINDOWS = mapOf("m" to (5 * 60 to 11 * 60), "d" to (11 * 60 to 15 * 60), "e" to (17 * 60 to 23 * 60))
    private val BOUNDARIES = intArrayOf(0, 5 * 60, 11 * 60, 15 * 60, 17 * 60, 23 * 60)

    // Важность занятий, если виджет включён «по релевантности»: тренировка > помодоро > таймер/секундомер.
    private const val RANK_WORKOUT = 40
    private const val RANK_POMODORO = 30
    private const val RANK_TIMER = 20
    private const val RANK_STOPWATCH = 10

    private val LOCK = Any()
    private val main = Handler(Looper.getMainLooper())
    private val refreshToken = Any()
    private val hideTokens = HashMap<Int, Any>()
    private val returnTokens = HashMap<Int, Any>()

    /** Виджеты, у которых сейчас показаны точки справа (чтобы при серии смахиваний не слать лишних обновлений). */
    private val dotsOn: MutableSet<Int> = Collections.synchronizedSet(HashSet<Int>())

    /** До какого момента (uptime) запросы фабрики не считаются смахиванием: стопку только что переставили мы сами. */
    private val swipeQuiet = HashMap<Int, Long>()

    class Live(val k: String, val id: String)
    /** [dyn] — "task" / "event" у карточек задач и событий календаря ([at] — их время, мс), иначе пусто. */
    class Card(val key: String, val code: String, val title: String, val live: List<Live>, val times: Set<String>, val days: Set<Int>, val after: String = "none", val color: Int = QrBattery.DEFAULT_FACE, val dyn: String = "", val at: Long = 0L)
    class Cfg(val id: String, val name: String, val rotate: Boolean, val rotateMin: Int, val relevance: Boolean, val cards: List<Card>, val battery: Boolean = false, val batteryMulti: Boolean = false, val tasks: Boolean = false, val events: Boolean = false) {
        /** Включена ли хоть одна карточка заряда (обычная или «несколько устройств»). */
        val anyBattery: Boolean get() = battery || batteryMulti
    }
    class Ordered(val cards: List<Card>, val topKey: String)

    private fun prefs(ctx: Context) = ctx.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    private fun imgDir(ctx: Context) = File(ctx.applicationContext.filesDir, "qrwidgets")

    /** Случайный ключ установки: окно ScanActivity принимает код из виджета только вместе с ним (код из чужого приложения не выполняется). */
    fun token(ctx: Context): String = synchronized(LOCK) {
        val p = prefs(ctx)
        var t = p.getString(K_TOKEN, null)
        if (t.isNullOrEmpty()) {
            t = UUID.randomUUID().toString()
            p.edit().putString(K_TOKEN, t).apply()
        }
        t
    }

    fun tokenOk(ctx: Context, given: String?): Boolean = !given.isNullOrEmpty() && given == token(ctx)

    // ---------- настройки ----------

    /** "#rrggbb" от страницы (цвет карточки заряда, выбранный в форме виджета) → цвет; нет или неверно — сиреневый по умолчанию. */
    private fun parseColor(v: String): Int {
        if (!Regex("^#[0-9a-fA-F]{6}$").matches(v)) return QrBattery.DEFAULT_FACE
        return (0xFF shl 24) or v.substring(1).toInt(16)
    }

    private fun parse(text: String?): List<Cfg> {
        if (text.isNullOrEmpty()) return emptyList()
        return try {
            val arr = JSONObject(text).optJSONArray("widgets") ?: return emptyList()
            val out = ArrayList<Cfg>()
            for (i in 0 until arr.length()) {
                val o = arr.optJSONObject(i) ?: continue
                val id = o.optString("id", "")
                if (id.isEmpty()) continue
                val cards = ArrayList<Card>()
                val cs = o.optJSONArray("cards")
                if (cs != null) {
                    for (j in 0 until cs.length()) {
                        val c = cs.optJSONObject(j) ?: continue
                        val key = c.optString("key", "")
                        if (!KEY_RE.matches(key)) continue
                        val live = ArrayList<Live>()
                        val la = c.optJSONArray("live")
                        if (la != null) for (x in 0 until la.length()) {
                            val lo = la.optJSONObject(x) ?: continue
                            live.add(Live(lo.optString("k", ""), lo.optString("id", "")))
                        }
                        val times = HashSet<String>()
                        val ta = c.optJSONArray("times")
                        if (ta != null) for (x in 0 until ta.length()) ta.optString(x)?.let { if (WINDOWS.containsKey(it)) times.add(it) }
                        val days = HashSet<Int>()
                        val da = c.optJSONArray("days")
                        if (da != null) for (x in 0 until da.length()) da.optInt(x).let { if (it in 1..7) days.add(it) }
                        val after = c.optString("after", "none").let { if (it == "hide" || it == "end") it else "none" }
                        cards.add(Card(key, c.optString("code", ""), c.optString("title", ""), live, times, days, after))
                        if (cards.size >= MAX_CARDS) break
                    }
                }
                val tasksOn = o.optBoolean("tasks", false)
                val eventsOn = o.optBoolean("events", false)
                val ds = o.optJSONArray("dyn")
                if (ds != null && (tasksOn || eventsOn)) {
                    val evs = ArrayList<Card>()
                    val tks = ArrayList<Card>()
                    var n = 0
                    for (j in 0 until ds.length()) {
                        val d = ds.optJSONObject(j) ?: continue
                        val key = d.optString("key", "")
                        val kind = d.optString("k", "")
                        val at = d.optLong("at", 0L)
                        if (!KEY_RE.matches(key) || at <= 0L) continue
                        if (!((kind == "task" && tasksOn) || (kind == "event" && eventsOn))) continue
                        val dc = Card(key, "", d.optString("title", ""), emptyList(), emptySet(), emptySet(), "none", QrBattery.DEFAULT_FACE, kind, at)
                        if (kind == "event") evs.add(dc) else tks.add(dc)
                        if (++n >= MAX_DYN) break
                    }
                    cards.addAll(evs) // после QR-карточек, перед карточками заряда; событие важнее задачи — стоит раньше
                    cards.addAll(tks)
                }
                val battery = o.optBoolean("battery", false)
                val batColor = parseColor(o.optString("batColor", ""))
                if (battery) cards.add(Card(QrBattery.KEY, "", "Заряд", emptyList(), emptySet(), emptySet(), "none", batColor)) // карточка заряда — последняя в стопке
                val batteryMulti = o.optBoolean("batteryMulti", false)
                val bat2Color = parseColor(o.optString("bat2Color", ""))
                if (batteryMulti) cards.add(Card(QrBattery.KEY2, "", "Заряд устройств", emptyList(), emptySet(), emptySet(), "none", bat2Color)) // после карточки заряда
                out.add(
                    Cfg(
                        id, o.optString("name", "Виджет"), o.optBoolean("rotate", false),
                        o.optInt("rotateMin", 5).coerceIn(1, 720), o.optBoolean("relevance", false), cards, battery, batteryMulti, tasksOn, eventsOn
                    )
                )
            }
            out
        } catch (e: Exception) {
            emptyList()
        }
    }

    fun configs(ctx: Context): List<Cfg> = parse(prefs(ctx).getString(K_CFG, null))

    private fun jmap(ctx: Context, key: String): JSONObject = try {
        JSONObject(prefs(ctx).getString(key, "{}") ?: "{}")
    } catch (e: Exception) {
        JSONObject()
    }

    fun cfgFor(ctx: Context, appWidgetId: Int): Cfg? {
        val cfgId = jmap(ctx, K_BIND).optString(appWidgetId.toString(), "")
        if (cfgId.isEmpty()) return null
        return configs(ctx).firstOrNull { it.id == cfgId }
    }

    fun isBound(ctx: Context, appWidgetId: Int): Boolean = jmap(ctx, K_BIND).has(appWidgetId.toString())

    fun bind(ctx: Context, appWidgetId: Int, cfgId: String) {
        synchronized(LOCK) {
            val m = jmap(ctx, K_BIND)
            m.put(appWidgetId.toString(), cfgId)
            prefs(ctx).edit().putString(K_BIND, m.toString()).apply()
        }
    }

    fun forget(ctx: Context, ids: IntArray) {
        synchronized(LOCK) {
            val b = jmap(ctx, K_BIND)
            val t = jmap(ctx, K_TOP)
            for (id in ids) {
                b.remove(id.toString())
                t.remove(id.toString())
                cancelRotate(ctx, id)
                clearReturn(ctx, id)
            }
            prefs(ctx).edit().putString(K_BIND, b.toString()).putString(K_TOP, t.toString()).apply()
        }
    }

    // ---------- закрепление ----------

    private fun setPending(ctx: Context, cfgId: String) {
        prefs(ctx).edit().putString(K_PEND, JSONObject().put("id", cfgId).put("at", System.currentTimeMillis()).toString()).apply()
    }

    /** Виджет, который только что поставили по кнопке «Добавить на рабочий стол», сам привязывается к выбранному виджету конструктора. */
    fun claimPending(ctx: Context, appWidgetId: Int): Boolean = synchronized(LOCK) {
        val raw = prefs(ctx).getString(K_PEND, null) ?: return false
        try {
            val o = JSONObject(raw)
            prefs(ctx).edit().remove(K_PEND).apply()
            if (System.currentTimeMillis() - o.optLong("at") > PEND_TTL_MS) return false
            val id = o.optString("id", "")
            if (configs(ctx).none { it.id == id }) return false
            bind(ctx, appWidgetId, id)
            true
        } catch (e: Exception) {
            false
        }
    }

    /** "requested" | "unsupported" | "missing" | "failed". */
    fun requestPin(ctx: Context, cfgId: String): String {
        if (Build.VERSION.SDK_INT < 26) return "unsupported"
        val app = ctx.applicationContext
        val mgr = AppWidgetManager.getInstance(app)
        if (!mgr.isRequestPinAppWidgetSupported) return "unsupported"
        if (configs(app).none { it.id == cfgId }) return "missing"
        setPending(app, cfgId)
        return try {
            if (mgr.requestPinAppWidget(ComponentName(app, QrWidgetProvider::class.java), null, null)) "requested" else "failed"
        } catch (e: Exception) {
            "failed"
        }
    }

    /** {"sdk":N,"canPin":bool,"placed":{"<id виджета конструктора>":сколько их на рабочем столе}[,"bt":{"reason","name","level"}]} — `bt` только если у какого-то виджета включён заряд. */
    fun stateJson(ctx: Context): String {
        val app = ctx.applicationContext
        val mgr = AppWidgetManager.getInstance(app)
        val ids = mgr.getAppWidgetIds(ComponentName(app, QrWidgetProvider::class.java))
        val placed = JSONObject()
        for (id in ids) cfgFor(app, id)?.let { placed.put(it.id, placed.optInt(it.id, 0) + 1) }
        val canPin = Build.VERSION.SDK_INT >= 26 && try { mgr.isRequestPinAppWidgetSupported } catch (e: Exception) { false }
        val st = JSONObject().put("sdk", Build.VERSION.SDK_INT).put("canPin", canPin).put("placed", placed)
        if (configs(app).any { it.anyBattery }) st.put("bt", QrBattery.status(app)) // что с наушниками: причина, по которой их заряда нет в карточке «Заряд»
        return st.toString()
    }

    // ---------- данные от страницы ----------

    fun sync(ctx: Context, json: String?): Boolean {
        if (json.isNullOrEmpty()) return false
        val app = ctx.applicationContext
        return try {
            val root = JSONObject(json)
            val dir = imgDir(app)
            dir.mkdirs()
            val keep = HashSet<String>()
            val images = root.optJSONObject("images")
            if (images != null) {
                val it = images.keys()
                while (it.hasNext()) {
                    val key = it.next()
                    if (!KEY_RE.matches(key)) continue
                    val raw = images.optString(key, "")
                    val comma = raw.indexOf(',')
                    val bytes = Base64.decode(if (comma >= 0) raw.substring(comma + 1) else raw, Base64.DEFAULT)
                    if (bytes.isEmpty()) continue
                    val tmp = File(dir, "$key.tmp")
                    tmp.writeBytes(bytes)
                    val dst = File(dir, "$key.png")
                    if (!tmp.renameTo(dst)) { dst.delete(); tmp.renameTo(dst) }
                    keep.add("$key.png")
                }
            }
            dir.listFiles()?.forEach { f -> if (f.name !in keep) f.delete() }
            root.remove("images")
            var wantBattery = false
            root.optJSONArray("widgets")?.let { ws -> for (i in 0 until ws.length()) if (ws.optJSONObject(i)?.let { it.optBoolean("battery", false) || it.optBoolean("batteryMulti", false) } == true) wantBattery = true }
            var structChanged = true
            synchronized(LOCK) {
                structChanged = structSig(prefs(app).getString(K_CFG, null)) != structSig(root.toString())
                val e = prefs(app).edit().putString(K_CFG, root.toString())
                // галочку только что включили — страница попросит у пользователя доступ к Bluetooth (для заряда наушников);
                // не дали (или не успели) — просим снова не чаще раза в сутки, пока галочка включена
                val now = System.currentTimeMillis()
                val first = wantBattery && !prefs(app).getBoolean(K_BTWANT, false)
                val again = wantBattery && QrBattery.permissionMissing(app) && now - prefs(app).getLong(K_BTASKAT, 0L) > BT_ASK_EVERY_MS
                if (first || again) e.putBoolean(K_BTASK, true).putLong(K_BTASKAT, now)
                e.putBoolean(K_BTWANT, wantBattery).apply()
            }
            // положение стопки сбрасываем, только если поменялись настройки виджета; новые задачи/события и перерисовка лиц стопку не двигают
            refreshAll(app, structChanged, true)
            true
        } catch (e: Exception) {
            false
        }
    }

    /** Подпись настроек виджетов без списков `dyn` (состав задач и событий меняется сам и положения стопки не касается). */
    private fun structSig(text: String?): String {
        if (text.isNullOrEmpty()) return ""
        return try {
            val root = JSONObject(text)
            root.optJSONArray("widgets")?.let { ws -> for (i in 0 until ws.length()) ws.optJSONObject(i)?.remove("dyn") }
            root.toString()
        } catch (e: Exception) {
            text
        }
    }

    /** true один раз после того, как галочку «Отображать заряд аккумулятора» включили: пора запросить доступ к Bluetooth. */
    fun consumeBatteryAsk(ctx: Context): Boolean = synchronized(LOCK) {
        val p = prefs(ctx)
        val ask = p.getBoolean(K_BTASK, false)
        if (ask) p.edit().putBoolean(K_BTASK, false).apply()
        ask
    }

    fun bitmapFor(ctx: Context, c: Card): Bitmap {
        if (c.key == QrBattery.KEY) return QrBattery.render(ctx, c.color)
        if (c.key == QrBattery.KEY2) return QrBattery.renderMulti(ctx, c.color)
        if (c.dyn.isNotEmpty()) dynBitmap(ctx, c)?.let { return it }
        val f = File(imgDir(ctx), c.key + ".png")
        if (f.exists()) {
            try {
                BitmapFactory.decodeFile(f.path)?.let { return it }
            } catch (e: Throwable) {
                // не хватило памяти или файл повреждён — запасная картинка ниже
            }
        }
        return fallbackBitmap(c.title)
    }

    /** Картинка карточки задачи/события для нынешнего момента: «Просрочено» / «Завтра» — `<ключ>_b.png`, «Сегодня» — `<ключ>.png`; нет нужной — берётся вторая. */
    private fun dynBitmap(ctx: Context, c: Card): Bitmap? {
        val now = System.currentTimeMillis()
        val second = if (c.dyn == "task") c.at < dayStart(now, 0) else c.at >= dayStart(now, 1)
        val names = if (second) listOf(c.key + "_b", c.key) else listOf(c.key, c.key + "_b")
        for (name in names) {
            val f = File(imgDir(ctx), "$name.png")
            if (!f.exists()) continue
            try {
                BitmapFactory.decodeFile(f.path)?.let { return it }
            } catch (e: Throwable) {
                // не хватило памяти или файл повреждён — пробуем вторую картинку
            }
        }
        return null
    }

    private fun fallbackBitmap(title: String): Bitmap {
        val s = 360
        val body = Math.round(s * FACE_BODY).toFloat()
        val shift = Math.round(s * FACE_SHADE).toFloat()
        val bmp = Bitmap.createBitmap(s, (body + shift).toInt(), Bitmap.Config.ARGB_8888)
        val g = Canvas(bmp)
        val p = Paint(Paint.ANTI_ALIAS_FLAG)
        val r = s * FACE_RADIUS
        p.color = 0xFF8D78DF.toInt()
        g.drawRoundRect(RectF(0f, shift, s.toFloat(), shift + body), r, r, p)
        p.color = 0xFFB9A1FF.toInt()
        g.drawRoundRect(RectF(0f, 0f, s.toFloat(), body), r, r, p)
        p.color = Color.WHITE
        p.textSize = s * 0.12f
        p.textAlign = Paint.Align.CENTER
        p.isFakeBoldText = true
        g.drawText(title.take(14), s / 2f, body / 2f, p)
        return bmp
    }

    // ---------- порядок карточек ----------

    private fun liveRank(ctx: Context, c: Card): Int {
        var best = 0
        for (l in c.live) {
            val r = when (l.k) {
                "workout" -> if (WorkoutTracker.status == WorkoutTracker.ST_SEARCH || WorkoutTracker.status == WorkoutTracker.ST_RUN || WorkoutTracker.status == WorkoutTracker.ST_PAUSE) RANK_WORKOUT else 0
                "pomodoro" -> if (PomodoroTimer.isActive(ctx)) RANK_POMODORO else 0
                "timer" -> if (l.id.isNotEmpty() && CardTimers.hasId(ctx, l.id)) RANK_TIMER else 0
                "stopwatch" -> if (StopwatchTimer.isActive(ctx)) RANK_STOPWATCH else 0
                else -> 0
            }
            if (r > best) best = r
        }
        return best
    }

    private fun scheduledNow(c: Card, cal: Calendar): Boolean {
        if (c.times.isEmpty() && c.days.isEmpty()) return false
        val dow = cal.get(Calendar.DAY_OF_WEEK)
        val wd = if (dow == Calendar.SUNDAY) 7 else dow - 1
        if (c.days.isNotEmpty() && wd !in c.days) return false
        if (c.times.isNotEmpty()) {
            val m = cal.get(Calendar.HOUR_OF_DAY) * 60 + cal.get(Calendar.MINUTE)
            if (c.times.none { k -> WINDOWS[k]?.let { m >= it.first && m < it.second } == true }) return false
        }
        return true
    }

    // ---------- «после срабатывания»: скрытые и перенесённые в конец ----------

    private fun dayKey(): Int {
        val c = Calendar.getInstance()
        return c.get(Calendar.YEAR) * 10000 + (c.get(Calendar.MONTH) + 1) * 100 + c.get(Calendar.DAY_OF_MONTH)
    }

    /** Начало суток через [days] календарных дней от момента [now] (0 — сегодняшняя полночь; переход на летнее время не сдвигает). */
    private fun dayStart(now: Long, days: Int): Long {
        val c = Calendar.getInstance()
        c.timeInMillis = now
        c.set(Calendar.HOUR_OF_DAY, 0); c.set(Calendar.MINUTE, 0); c.set(Calendar.SECOND, 0); c.set(Calendar.MILLISECOND, 0)
        if (days != 0) c.add(Calendar.DAY_OF_YEAR, days)
        return c.timeInMillis
    }

    /** Ключ события, которое сейчас показывает карточка «события календаря»: ближайшее из ещё не начавшихся на сегодня или завтра; пусто — показывать нечего. */
    private fun nextEventKey(cfg: Cfg, now: Long): String {
        val limit = dayStart(now, 2)
        var best: Card? = null
        for (c in cfg.cards) {
            if (c.dyn != "event" || c.at <= now || c.at >= limit) continue
            if (best == null || c.at < best.at) best = c
        }
        return best?.key ?: ""
    }

    /** Карточка задачи видна, пока её время сегодня или раньше (просроченная — до отметки); событие — только то, что выбрал [nextEventKey]. */
    private fun dynShown(c: Card, now: Long, nextEv: String): Boolean = when (c.dyn) {
        "task" -> c.at < dayStart(now, 1)
        "event" -> c.key == nextEv
        else -> true
    }

    /** Когда пора перерисовать карточки задач и событий: полночь («Завтра» → «Сегодня», задача → «Просрочено») или начало ближайшего события. */
    private fun nextDynChange(cfg: Cfg): Long {
        val now = System.currentTimeMillis()
        var at = dayStart(now, 1) + 5_000L
        for (c in cfg.cards) if (c.dyn == "event" && c.at > now && c.at + 1_000L < at) at = c.at + 1_000L
        return at
    }

    private fun startOfToday(): Long {
        val c = Calendar.getInstance()
        c.set(Calendar.HOUR_OF_DAY, 0); c.set(Calendar.MINUTE, 0); c.set(Calendar.SECOND, 0); c.set(Calendar.MILLISECOND, 0)
        return c.timeInMillis
    }

    /** Состояние виджета конструктора: {"day":ГГГГММДД,"hidden":[ключи],"moved":{ключ:мс}}; скрытое действует только в день записи. */
    private fun firedOf(ctx: Context, cfgId: String): JSONObject {
        val st = jmap(ctx, K_FIRED).optJSONObject(cfgId) ?: return JSONObject()
        if (st.optInt("day", 0) != dayKey()) st.put("hidden", JSONArray())
        return st
    }

    private fun hiddenKeys(ctx: Context, cfg: Cfg): Set<String> {
        val arr = firedOf(ctx, cfg.id).optJSONArray("hidden") ?: return emptySet()
        val out = HashSet<String>()
        for (i in 0 until arr.length()) out.add(arr.optString(i))
        return out
    }

    /** Карточки, которые сейчас видны в стопке, в порядке «как собрал пользователь, перенесённые в конец — после них, по времени переноса». */
    private fun visibleCards(ctx: Context, cfg: Cfg): List<Card> {
        val st = firedOf(ctx, cfg.id)
        val hidden = hiddenKeys(ctx, cfg)
        val moved = st.optJSONObject("moved") ?: JSONObject()
        val now = System.currentTimeMillis()
        val nextEv = nextEventKey(cfg, now)
        val shown = cfg.cards.filter { !(it.after == "hide" && it.key in hidden) && dynShown(it, now, nextEv) }
        if (shown.none { it.after == "end" && moved.has(it.key) }) return shown
        return shown.withIndex().sortedWith(
            compareBy<IndexedValue<Card>> { if (it.value.after == "end") moved.optLong(it.value.key, 0L) else 0L }.thenBy { it.index }
        ).map { it.value }
    }

    fun visibleCount(ctx: Context, cfg: Cfg): Int = visibleCards(ctx, cfg).size

    /** Все карточки виджета скрыты («На сегодня больше ничего»). */
    fun isAllDone(ctx: Context, cfg: Cfg): Boolean = (cfg.cards.isNotEmpty() || cfg.tasks || cfg.events) && visibleCards(ctx, cfg).isEmpty()

    private fun movedToday(ctx: Context, cfg: Cfg, c: Card): Boolean {
        if (c.after != "end") return false
        val at = (firedOf(ctx, cfg.id).optJSONObject("moved") ?: return false).optLong(c.key, 0L)
        return at >= startOfToday()
    }

    /**
     * Действие карточки [cardKey] сработало (нажатие в виджете, в приложении или скан): у карточек с «после срабатывания» = «скрывать» она
     * убирается из стопки до конца дня, с «в конец» — уходит в конец стопки. Виджеты, где карточки нет или выбрано «ничего», не трогаются.
     */
    fun onCardFired(ctx: Context, cardKey: String) {
        if (!KEY_RE.matches(cardKey)) return
        val app = ctx.applicationContext
        val touchedCfgs = HashSet<String>()
        synchronized(LOCK) {
            val all = jmap(app, K_FIRED)
            for (cfg in configs(app)) {
                val card = cfg.cards.firstOrNull { it.key == cardKey } ?: continue
                if (card.after == "none") continue
                val st = firedOf(app, cfg.id)
                st.put("day", dayKey())
                if (card.after == "hide") {
                    val arr = st.optJSONArray("hidden") ?: JSONArray()
                    var has = false
                    for (i in 0 until arr.length()) if (arr.optString(i) == cardKey) has = true
                    if (!has) arr.put(cardKey)
                    st.put("hidden", arr)
                } else {
                    val mv = st.optJSONObject("moved") ?: JSONObject()
                    mv.put(cardKey, System.currentTimeMillis())
                    st.put("moved", mv)
                }
                all.put(cfg.id, st)
                touchedCfgs.add(cfg.id)
            }
            if (touchedCfgs.isNotEmpty()) prefs(app).edit().putString(K_FIRED, all.toString()).apply()
        }
        if (touchedCfgs.isEmpty()) return
        refreshAll(app, true)
        // стопка снова показывает первую из оставшихся карточек
        try {
            val mgr = AppWidgetManager.getInstance(app)
            for (id in mgr.getAppWidgetIds(ComponentName(app, QrWidgetProvider::class.java))) {
                val cfgId = jmap(app, K_BIND).optString(id.toString(), "")
                if (cfgId in touchedCfgs) {
                    val rv = RemoteViews(app.packageName, R.layout.qr_widget)
                    rv.setDisplayedChild(R.id.qr_stack, 0)
                    suppressSwipe(id)
                    clearReturn(app, id)
                    mgr.partiallyUpdateAppWidget(id, rv)
                }
            }
        } catch (e: Exception) {
            // виджет удалили
        }
    }

    /**
     * Порядок стопки. Без «релевантности» — как собрал пользователь (скрытые убраны, перенесённые в конец — в конце). С ней сверху то, что идёт
     * сейчас (важнее — выше: тренировка, помодоро, таймер, секундомер), затем карточки, у которых сейчас «их» время суток и день, затем
     * остальные в исходном порядке. Карточки, перенесённые «в конец» сегодня, всегда в самом конце (по времени переноса) — даже если они идут
     * сейчас или у них «их» время; со следующего дня они снова участвуют в подборе.
     * [Ordered.topKey] — ключ карточки наверху, если она поднята по релевантности (иначе пусто).
     */
    fun order(ctx: Context, cfg: Cfg): Ordered {
        val base = visibleCards(ctx, cfg)
        if (!cfg.relevance || base.size < 2) return Ordered(base, "")
        val cal = Calendar.getInstance()
        val tail = base.filter { movedToday(ctx, cfg, it) } // уже стоят в порядке переноса
        val head = base.filter { !movedToday(ctx, cfg, it) }
        if (head.isEmpty()) return Ordered(tail, "")
        val scored = head.mapIndexed { i, c ->
            val live = liveRank(ctx, c)
            val s = if (live > 0) 1000 + live else if (scheduledNow(c, cal)) 500 else 0
            Triple(c, s, i)
        }
        val sorted = scored.sortedWith(compareByDescending<Triple<Card, Int, Int>> { it.second }.thenBy { it.third })
        val top = sorted.first()
        return Ordered(sorted.map { it.first } + tail, if (top.second > 0) top.first.key else "")
    }

    /**
     * Ключ карточки, на которую стопка возвращается и от смены которой встаёт наверх: рекомендованная по релевантности ([Ordered.topKey]),
     * а если такой нет — верхняя карточка события или задачи календаря (событие всегда выше задач). Пусто — «своего места» у стопки нет.
     */
    private fun anchorKey(ord: Ordered): String {
        if (ord.topKey.isNotEmpty()) return ord.topKey
        val first = ord.cards.firstOrNull() ?: return ""
        return if (first.dyn.isNotEmpty()) first.key else ""
    }

    // ---------- обновление ----------

    fun update(ctx: Context, mgr: AppWidgetManager, id: Int, resetTop: Boolean = false) {
        val app = ctx.applicationContext
        if (!isBound(app, id)) claimPending(app, id)
        val cfg = cfgFor(app, id)
        if (cfg != null && cfg.anyBattery) QrBattery.register(app)
        val rv = RemoteViews(app.packageName, R.layout.qr_widget)
        applyHostLayout(app, rv, hostSizeDp(app, mgr, id))
        val svc = Intent(app, QrWidgetService::class.java)
        svc.putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, id)
        svc.data = Uri.parse(svc.toUri(Intent.URI_INTENT_SCHEME))
        rv.setRemoteAdapter(R.id.qr_stack, svc)
        rv.setEmptyView(R.id.qr_stack, R.id.qr_empty)
        val allDone = cfg != null && isAllDone(app, cfg)
        rv.setTextViewText(
            R.id.qr_empty,
            if (cfg == null) "Виджет не выбран.\nОткройте приложение → «Конструктор виджетов»"
            else if (allDone) "На сегодня больше ничего"
            else "В виджете нет карточек.\nДобавьте их в конструкторе"
        )
        // все карточки скрыты — полупрозрачная плашка, как папка на телефонах Xiaomi; иначе обычная сиреневая
        rv.setInt(R.id.qr_empty, "setBackgroundResource", if (allDone) R.drawable.qr_widget_done_bg else R.drawable.qr_widget_empty_bg)
        rv.setTextViewTextSize(R.id.qr_empty, android.util.TypedValue.COMPLEX_UNIT_SP, if (allDone) 14f else 12f)
        rv.setViewVisibility(R.id.qr_dots, android.view.View.GONE)
        val tpl = Intent(app, ScanActivity::class.java)
        tpl.action = ScanActivity.ACTION_SCAN_CODE
        tpl.putExtra("tok", token(app))
        tpl.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        val flags = PendingIntent.FLAG_UPDATE_CURRENT or (if (Build.VERSION.SDK_INT >= 31) PendingIntent.FLAG_MUTABLE else 0)
        rv.setPendingIntentTemplate(R.id.qr_stack, PendingIntent.getActivity(app, id, tpl, flags))

        if (cfg != null && cfg.relevance) {
            val topNew = anchorKey(order(app, cfg))
            val topOld = jmap(app, K_TOP).optString(id.toString(), "")
            if (resetTop || topNew != topOld) {
                rv.setDisplayedChild(R.id.qr_stack, 0)
                clearReturn(app, id)
                synchronized(LOCK) {
                    val t = jmap(app, K_TOP)
                    t.put(id.toString(), topNew)
                    prefs(app).edit().putString(K_TOP, t.toString()).apply()
                }
            }
        }
        suppressSwipe(id) // перерисовка и перезагрузка карточек — не смахивание
        dotsOn.remove(id)
        mgr.updateAppWidget(id, rv)
        mgr.notifyAppWidgetViewDataChanged(id, R.id.qr_stack)
    }

    // ---------- размер области виджета ----------

    /** Сторона карточки (dp), если лаунчер не сообщил размер области. */
    private const val DEFAULT_SIDE_DP = 175f

    /** Радиус скругления лица карточки — 12 % ширины (как в widgets.js `drawFace`). */
    internal const val FACE_RADIUS = 0.12f

    /** Тело карточки и цветной выступ снизу, доли ширины — те же `FACE_BODY`/`FACE_SHADE` в widgets.js. */
    internal const val FACE_BODY = 1.02f
    internal const val FACE_SHADE = 0.04f

    /** Высота картинки карточки / её ширина (≈1,06): к этой пропорции приводится область виджета. */
    private const val FACE_ASPECT = FACE_BODY + FACE_SHADE

    /** Размер области, отданной виджету лаунчером: [ширина, высота] в dp; null — лаунчер не сообщил (тогда карточка занимает всю область). */
    private fun hostSizeDp(ctx: Context, mgr: AppWidgetManager, id: Int): FloatArray? {
        val o = try { mgr.getAppWidgetOptions(id) } catch (e: Exception) { null } ?: return null
        val land = ctx.resources.configuration.orientation == Configuration.ORIENTATION_LANDSCAPE
        val w = o.getInt(if (land) AppWidgetManager.OPTION_APPWIDGET_MAX_WIDTH else AppWidgetManager.OPTION_APPWIDGET_MIN_WIDTH, 0)
        val h = o.getInt(if (land) AppWidgetManager.OPTION_APPWIDGET_MIN_HEIGHT else AppWidgetManager.OPTION_APPWIDGET_MAX_HEIGHT, 0)
        return if (w > 0 && h > 0) floatArrayOf(w.toFloat(), h.toFloat()) else null
    }

    /**
     * Картинка карточки имеет пропорцию [FACE_ASPECT] (высота/ширина) и занимает ВСЮ область виджета (см. layout/qr_widget.xml). Область
     * у лаунчера почти такая же; если она заметно (больше 8 %) выше или шире — у `qr_root` выставляются отступы, чтобы картинка не
     * растягивалась. Радиус контура обрезки (`qr_clip`) подбирается под радиус лица карточки (12 % ширины), шаг 2 dp.
     */
    private fun applyHostLayout(ctx: Context, rv: RemoteViews, size: FloatArray?) {
        val d = ctx.resources.displayMetrics.density
        var padX = 0
        var padY = 0
        var sideDp = DEFAULT_SIDE_DP
        if (size != null) {
            val w = size[0]
            val h = size[1]
            sideDp = Math.min(w, h / FACE_ASPECT)
            val idealH = w * FACE_ASPECT
            if (h > idealH * 1.08f) {
                padY = Math.round((h - idealH) / 2f * d)
            } else if (h < idealH / 1.08f) {
                padX = Math.round((w - h / FACE_ASPECT) / 2f * d)
            }
        }
        rv.setViewPadding(R.id.qr_root, padX, padY, padX, padY)
        val r = (Math.round(sideDp * FACE_RADIUS / 2f) * 2).coerceIn(16, 26)
        val res = when (r) {
            16 -> R.drawable.qr_widget_clip_16
            18 -> R.drawable.qr_widget_clip_18
            20 -> R.drawable.qr_widget_clip_20
            22 -> R.drawable.qr_widget_clip_22
            24 -> R.drawable.qr_widget_clip_24
            else -> R.drawable.qr_widget_clip_26
        }
        rv.setInt(R.id.qr_clip, "setBackgroundResource", res)
    }

    /** Лаунчер изменил размер виджета: пересчитать отступы и контур, не трогая карточки (стопка остаётся на месте). */
    fun updateHostLayout(ctx: Context, mgr: AppWidgetManager, id: Int) {
        val app = ctx.applicationContext
        val rv = RemoteViews(app.packageName, R.layout.qr_widget)
        applyHostLayout(app, rv, hostSizeDp(app, mgr, id))
        mgr.partiallyUpdateAppWidget(id, rv)
    }

    fun refreshAll(ctx: Context, resetTop: Boolean = false, forceAlarms: Boolean = false) {
        val app = ctx.applicationContext
        val mgr = AppWidgetManager.getInstance(app)
        val ids = mgr.getAppWidgetIds(ComponentName(app, QrWidgetProvider::class.java))
        for (id in ids) {
            try {
                update(app, mgr, id, resetTop)
            } catch (e: Exception) {
                // один сбойный виджет не мешает остальным
            }
        }
        scheduleAll(app, ids, forceAlarms)
    }

    /** Вызывается при старте/остановке таймера, помодоро, секундомера и тренировки: обновляем виджеты «по релевантности» (не чаще раза в 0,4 с). */
    fun onActivityChanged(ctx: Context) {
        val app = ctx.applicationContext
        main.removeCallbacksAndMessages(refreshToken)
        main.postAtTime({
            try {
                if (configs(app).any { it.relevance }) refreshAll(app)
            } catch (e: Exception) {
                // обновление виджета не должно ронять приложение
            }
        }, refreshToken, SystemClock.uptimeMillis() + 400L)
    }

    // ---------- слайд-шоу и границы времени суток ----------

    private fun am(ctx: Context) = ctx.getSystemService(Context.ALARM_SERVICE) as AlarmManager

    private fun setAlarm(ctx: Context, at: Long, pi: PendingIntent) {
        if (Build.VERSION.SDK_INT >= 23) am(ctx).setAndAllowWhileIdle(AlarmManager.RTC, at, pi) else am(ctx).set(AlarmManager.RTC, at, pi)
    }

    private fun immutable(): Int = if (Build.VERSION.SDK_INT >= 23) PendingIntent.FLAG_IMMUTABLE else 0

    private fun rotatePi(ctx: Context, id: Int, create: Boolean): PendingIntent? {
        val i = Intent(ctx, QrWidgetProvider::class.java)
        i.action = ACTION_ROTATE
        i.putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, id)
        val f = (if (create) PendingIntent.FLAG_UPDATE_CURRENT else PendingIntent.FLAG_NO_CREATE) or immutable()
        return PendingIntent.getBroadcast(ctx, 5000 + id, i, f)
    }

    private fun tickPi(ctx: Context, create: Boolean): PendingIntent? {
        val i = Intent(ctx, QrWidgetProvider::class.java)
        i.action = ACTION_TICK
        val f = (if (create) PendingIntent.FLAG_UPDATE_CURRENT else PendingIntent.FLAG_NO_CREATE) or immutable()
        return PendingIntent.getBroadcast(ctx, 4999, i, f)
    }

    private fun batteryPi(ctx: Context, create: Boolean): PendingIntent? {
        val i = Intent(ctx, QrWidgetProvider::class.java)
        i.action = ACTION_BATTERY
        val f = (if (create) PendingIntent.FLAG_UPDATE_CURRENT else PendingIntent.FLAG_NO_CREATE) or immutable()
        return PendingIntent.getBroadcast(ctx, 4998, i, f)
    }

    private fun returnPi(ctx: Context, id: Int, create: Boolean): PendingIntent? {
        val i = Intent(ctx, QrWidgetProvider::class.java)
        i.action = ACTION_RETURN
        i.putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, id)
        val f = (if (create) PendingIntent.FLAG_UPDATE_CURRENT else PendingIntent.FLAG_NO_CREATE) or immutable()
        return PendingIntent.getBroadcast(ctx, 100_000 + id, i, f)
    }

    private fun cancelRotate(ctx: Context, id: Int) {
        rotatePi(ctx, id, false)?.let { am(ctx).cancel(it); it.cancel() }
    }

    private fun nextBoundary(): Long {
        val now = Calendar.getInstance()
        val cur = now.get(Calendar.HOUR_OF_DAY) * 60 + now.get(Calendar.MINUTE)
        val next = BOUNDARIES.firstOrNull { it > cur } ?: (24 * 60)
        val c = Calendar.getInstance()
        c.set(Calendar.HOUR_OF_DAY, 0); c.set(Calendar.MINUTE, 0); c.set(Calendar.SECOND, 5); c.set(Calendar.MILLISECOND, 0)
        c.add(Calendar.MINUTE, next)
        return c.timeInMillis
    }

    private fun scheduleAll(app: Context, ids: IntArray, force: Boolean) {
        var anyRel = false
        var anyHide = false
        var anyBattery = false
        var dynAt = Long.MAX_VALUE
        for (id in ids) {
            val cfg = cfgFor(app, id)
            if (cfg != null && cfg.anyBattery) anyBattery = true
            if (cfg != null && (cfg.tasks || cfg.events)) dynAt = Math.min(dynAt, nextDynChange(cfg))
            if (cfg != null && cfg.rotate && visibleCount(app, cfg) > 1) {
                if (force || rotatePi(app, id, false) == null) {
                    cancelRotate(app, id)
                    setAlarm(app, System.currentTimeMillis() + cfg.rotateMin * 60_000L, rotatePi(app, id, true)!!)
                }
            } else cancelRotate(app, id)
            if (cfg != null && cfg.relevance) anyRel = true
            if (cfg != null && cfg.cards.any { it.after == "hide" }) anyHide = true // скрытое возвращается в полночь
        }
        var tickAt = if (anyRel || anyHide) nextBoundary() else Long.MAX_VALUE
        tickAt = Math.min(tickAt, dynAt)
        if (tickAt != Long.MAX_VALUE) setAlarm(app, tickAt, tickPi(app, true)!!)
        else tickPi(app, false)?.let { am(app).cancel(it); it.cancel() }
        if (anyBattery) {
            QrBattery.register(app)
            if (force || batteryPi(app, false) == null) setAlarm(app, System.currentTimeMillis() + BATTERY_EVERY_MS, batteryPi(app, true)!!)
        } else batteryPi(app, false)?.let { am(app).cancel(it); it.cancel() }
    }

    // ---------- карточка заряда ----------

    @Volatile private var lastBatterySig = ""

    /** Перерисовать карточку заряда в виджетах, где она включена, но только если заряд телефона или наушников изменился (или [force]). */
    fun onBatteryChanged(ctx: Context, force: Boolean = false) {
        val app = ctx.applicationContext
        val mgr = AppWidgetManager.getInstance(app)
        val ids = mgr.getAppWidgetIds(ComponentName(app, QrWidgetProvider::class.java)).filter { cfgFor(app, it)?.anyBattery == true }
        if (ids.isEmpty()) return
        val multi = ids.any { cfgFor(app, it)?.batteryMulti == true }
        val sig = QrBattery.signature(app) + if (multi) "|" + QrBattery.signatureMulti(app) else ""
        if (!force && sig == lastBatterySig) return
        lastBatterySig = sig
        for (id in ids) {
            try {
                mgr.notifyAppWidgetViewDataChanged(id, R.id.qr_stack)
            } catch (e: Exception) {
                // виджет удалили
            }
        }
    }

    /** Будильник `ACTION_BATTERY`: обновляет карточку заряда (экран погашен — не будим) и ставит следующий через 5 минут. */
    fun onBatteryTick(ctx: Context) {
        val app = ctx.applicationContext
        val ids = AppWidgetManager.getInstance(app).getAppWidgetIds(ComponentName(app, QrWidgetProvider::class.java))
        if (ids.none { cfgFor(app, it)?.anyBattery == true }) {
            batteryPi(app, false)?.let { am(app).cancel(it); it.cancel() }
            return
        }
        QrBattery.register(app)
        val pm = app.getSystemService(Context.POWER_SERVICE) as PowerManager
        if (screenOn(pm)) onBatteryChanged(app)
        setAlarm(app, System.currentTimeMillis() + BATTERY_EVERY_MS, batteryPi(app, true)!!)
    }

    /** Bluetooth-устройство подключилось или отключилось: заряд наушников становится известен не сразу, поэтому проверяем через несколько секунд. */
    fun onBluetoothChanged(ctx: Context) {
        val app = ctx.applicationContext
        val ids = AppWidgetManager.getInstance(app).getAppWidgetIds(ComponentName(app, QrWidgetProvider::class.java))
        if (ids.none { cfgFor(app, it)?.anyBattery == true }) return
        // наушники сообщают заряд сразу после подключения (за секунды): приёмник нужно поднять сейчас, а не по будильнику, иначе значение пропустим
        QrBattery.register(app)
        setAlarm(app, System.currentTimeMillis() + BATTERY_AFTER_BT_MS, batteryPi(app, true)!!)
    }

    @Suppress("DEPRECATION")
    private fun screenOn(pm: PowerManager): Boolean = if (Build.VERSION.SDK_INT >= 20) pm.isInteractive else pm.isScreenOn

    /** Будильник слайд-шоу: листает стопку на одну карточку и ставит следующий (телефон с погашенным экраном не будим). */
    fun rotate(ctx: Context, id: Int) {
        val app = ctx.applicationContext
        val cfg = cfgFor(app, id) ?: return
        if (!cfg.rotate || visibleCount(app, cfg) < 2) return
        val pm = app.getSystemService(Context.POWER_SERVICE) as PowerManager
        if (screenOn(pm)) {
            val rv = RemoteViews(app.packageName, R.layout.qr_widget)
            rv.showNext(R.id.qr_stack)
            suppressSwipe(id)
            dotsOn.add(id)
            putDots(app, rv, visibleCount(app, cfg))
            AppWidgetManager.getInstance(app).partiallyUpdateAppWidget(id, rv)
            scheduleHide(app, id)
        }
        setAlarm(app, System.currentTimeMillis() + cfg.rotateMin * 60_000L, rotatePi(app, id, true)!!)
    }

    // ---------- точки справа ----------

    private fun putDots(app: Context, rv: RemoteViews, n: Int) {
        if (n < 2) return
        rv.setImageViewBitmap(R.id.qr_dots, dotsBitmap(app, n))
        rv.setViewVisibility(R.id.qr_dots, android.view.View.VISIBLE)
    }

    private fun scheduleHide(app: Context, id: Int) {
        val token = synchronized(hideTokens) { hideTokens.getOrPut(id) { Any() } }
        main.removeCallbacksAndMessages(token)
        main.postAtTime({
            try {
                dotsOn.remove(id)
                val rv = RemoteViews(app.packageName, R.layout.qr_widget)
                rv.setViewVisibility(R.id.qr_dots, android.view.View.GONE)
                AppWidgetManager.getInstance(app).partiallyUpdateAppWidget(id, rv)
            } catch (e: Exception) {
                // виджет удалили
            }
        }, token, SystemClock.uptimeMillis() + DOTS_SHOW_MS)
    }

    /** Стопку только что переставили мы (обновление, возврат наверх, «после срабатывания»): запросы фабрики в ближайшие секунды — не смахивание. */
    private fun suppressSwipe(id: Int) {
        synchronized(swipeQuiet) { swipeQuiet[id] = SystemClock.uptimeMillis() + SWIPE_QUIET_MS }
    }

    private fun swipeSuppressed(id: Int): Boolean = synchronized(swipeQuiet) { SystemClock.uptimeMillis() < (swipeQuiet[id] ?: 0L) }

    /**
     * Фабрика карточек просит очередную карточку уже после первой загрузки — значит, пользователь смахнул стопку: на мгновение
     * показываем справа вертикальные точки (по числу карточек), потом они пропадают; у виджета «по релевантности» взводится
     * возврат наверх через минуту ([armReturn]). Точки при серии смахиваний не обновляются заново, только продлевается показ.
     */
    fun onPossibleSwipe(ctx: Context, id: Int, n: Int) {
        if (n < 2 || swipeSuppressed(id)) return
        val app = ctx.applicationContext
        main.post {
            try {
                if (dotsOn.add(id)) {
                    val rv = RemoteViews(app.packageName, R.layout.qr_widget)
                    putDots(app, rv, n)
                    AppWidgetManager.getInstance(app).partiallyUpdateAppWidget(id, rv)
                }
                scheduleHide(app, id)
                armReturn(app, id)
            } catch (e: Exception) {
                // виджет удалили
            }
        }
    }

    // ---------- возврат наверх ----------

    /** Взводит возврат стопки наверх через [RETURN_AFTER_MS] (каждое новое смахивание отодвигает его). Только «по релевантности» и только если есть рекомендованная карточка. */
    private fun armReturn(app: Context, id: Int) {
        val cfg = cfgFor(app, id) ?: return
        if (!cfg.relevance) return
        val ord = order(app, cfg)
        if (anchorKey(ord).isEmpty() || ord.cards.size < 2) return
        val due = System.currentTimeMillis() + RETURN_AFTER_MS
        synchronized(LOCK) {
            val m = jmap(app, K_RETURN)
            m.put(id.toString(), due)
            prefs(app).edit().putString(K_RETURN, m.toString()).apply()
        }
        // точно по времени — пока жив процесс; будильник — запасной (процесс могли выгрузить)
        val token = synchronized(returnTokens) { returnTokens.getOrPut(id) { Any() } }
        main.removeCallbacksAndMessages(token)
        main.postAtTime({
            try {
                fireReturn(app, id)
            } catch (e: Exception) {
                // виджет удалили
            }
        }, token, SystemClock.uptimeMillis() + RETURN_AFTER_MS)
        returnPi(app, id, true)?.let { setAlarm(app, due + 3_000L, it) }
    }

    /** Снимает ожидающий возврат (стопка и так переставлена наверх, или виджет удалён). */
    private fun clearReturn(app: Context, id: Int) {
        synchronized(LOCK) {
            val m = jmap(app, K_RETURN)
            if (m.has(id.toString())) {
                m.remove(id.toString())
                prefs(app).edit().putString(K_RETURN, m.toString()).apply()
            }
        }
        val token = synchronized(returnTokens) { returnTokens[id] }
        if (token != null) main.removeCallbacksAndMessages(token)
        returnPi(app, id, false)?.let { am(app).cancel(it); it.cancel() }
    }

    /** Время возврата пришло (из обработчика или будильника `ACTION_RETURN`): если его не отодвинули новым смахиванием — стопка наверх. */
    fun fireReturn(ctx: Context, id: Int) {
        val app = ctx.applicationContext
        val now = System.currentTimeMillis()
        val due = synchronized(LOCK) {
            val m = jmap(app, K_RETURN)
            val d = m.optLong(id.toString(), 0L)
            if (d > 0L && now >= d - 500L) {
                m.remove(id.toString())
                prefs(app).edit().putString(K_RETURN, m.toString()).apply()
                d
            } else 0L
        }
        if (due == 0L) return
        returnToTop(app, id)
    }

    /** Показывает в стопке верхнюю карточку порядка [order] — рекомендованную или более важную, чем та, на которой остановился пользователь. */
    private fun returnToTop(app: Context, id: Int) {
        val cfg = cfgFor(app, id) ?: return
        if (!cfg.relevance) return
        val ord = order(app, cfg)
        val anchor = anchorKey(ord)
        if (anchor.isEmpty() || ord.cards.size < 2) return
        suppressSwipe(id)
        dotsOn.remove(id)
        val rv = RemoteViews(app.packageName, R.layout.qr_widget)
        rv.setDisplayedChild(R.id.qr_stack, 0)
        rv.setViewVisibility(R.id.qr_dots, android.view.View.GONE)
        AppWidgetManager.getInstance(app).partiallyUpdateAppWidget(id, rv)
        synchronized(LOCK) {
            val t = jmap(app, K_TOP)
            t.put(id.toString(), anchor)
            prefs(app).edit().putString(K_TOP, t.toString()).apply()
        }
    }

    /** Полупрозрачный «скелет» карточки — показывается вместо пустого места, пока система подгружает карточку. */
    private val skeleton: Bitmap by lazy {
        val s = 160
        val body = Math.round(s * FACE_BODY).toFloat()
        val shift = Math.round(s * FACE_SHADE).toFloat()
        val bmp = Bitmap.createBitmap(s, (body + shift).toInt(), Bitmap.Config.ARGB_8888)
        val g = Canvas(bmp)
        val p = Paint(Paint.ANTI_ALIAS_FLAG)
        val r = s * FACE_RADIUS
        p.color = 0x4D000000
        g.drawRoundRect(RectF(0f, shift, s.toFloat(), shift + body), r, r, p)
        p.color = 0x73FFFFFF
        g.drawRoundRect(RectF(0f, 0f, s.toFloat(), body), r, r, p)
        bmp
    }

    /** Картинка-заглушка для карточки, которую система ещё не загрузила (и на случай пустой стопки). */
    fun skeletonBitmap(): Bitmap = skeleton

    private fun dotsBitmap(ctx: Context, n: Int): Bitmap {
        val d = ctx.resources.displayMetrics.density
        val r = 2.6f * d
        val gap = 4.4f * d
        val pad = 2.2f * d
        val w = Math.ceil((2 * r + 2 * pad).toDouble()).toInt()
        val h = Math.ceil((n * 2 * r + (n - 1) * gap + 2 * pad).toDouble()).toInt()
        val bmp = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888)
        val g = Canvas(bmp)
        val ring = Paint(Paint.ANTI_ALIAS_FLAG)
        ring.color = 0x66000000
        val fill = Paint(Paint.ANTI_ALIAS_FLAG)
        fill.color = 0xF2FFFFFF.toInt()
        for (i in 0 until n) {
            val cy = pad + r + i * (2 * r + gap)
            g.drawCircle(w / 2f, cy, r + 1.1f * d, ring)
            g.drawCircle(w / 2f, cy, r, fill)
        }
        return bmp
    }
}
