package com.app.lifetracker
// Версия: 13.5 (14.11)

import android.app.AlarmManager
import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.pm.ApplicationInfo
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
import android.util.Log
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
 * Карточка-привычка (`habit` у карточки): одно нажатие открывает в приложении карту дней, двойное — отмечает сегодня и убирает карточку из стопки до
 * конца дня при любом «после срабатывания» ([hideHabitToday]); различает их окно [ScanActivity] (ждёт второго нажатия, [ScanActivity.HABIT_DOUBLE_MS]).
 *
 * Галочка «Отображать заряд аккумулятора» (`battery` у виджета): в конец стопки добавляется служебная карточка [QrBattery.KEY] — её лицо рисует
 * [QrBattery.render] (заряд телефона и Bluetooth-наушников), нажатие на неё ничего не делает. Галочка «…(несколько устройств)» (`batteryMulti`) добавляет
 * после неё ещё одну служебную карточку [QrBattery.KEY2] ([QrBattery.renderMulti]): только кольца и значки телефона и до трёх подключённых Bluetooth-устройств. Картинка перерисовывается по будильнику
 * `ACTION_BATTERY` (раз в 5 минут, если заряд изменился), при подключении Bluetooth-устройства (серия проверок через 6, 15, 30, 60 и 120 с, пока заряд не станет известен), при отключении и при вещании о заряде устройств.
 *
 * Галочки «Показывать задачи» (`tasks`) и «Показывать события календаря» (`events`): страница присылает в `dyn` кандидатов — задачи (`k`="task", `at` — время
 * задачи, мс) и ближайшие события (`k`="event") — и до четырёх картинок на каждого: `<ключ>.png` («Сегодня»), `<ключ>_t.png` («Завтра»), `<ключ>_w.png` (день недели — до даты два дня
 * и больше) и у задачи `<ключ>_s.png` («Просрочено, сегодня»), `<ключ>_y.png` («Просрочено, вчера»), `<ключ>_o.png` («Просрочено, 1 января»). Что показать, решает оболочка по часам ([QrPriority.build], [dynBitmap]), поэтому надпись и состав меняются без приложения:
 * задача видна, пока её время в пределах [QrPriority.DYN_DAYS] суток (время прошло — «Просрочено, сегодня» / «вчера» / дата); событие — одно, ближайшее из ещё не начавшихся в этих пределах ([QrPriority.nextEventKey]); нет такого —
 * карточки нет. Будильник `ACTION_TICK` ставится на полночь и на начало ближайшего события ([nextDynChange]). Карточки стоят после QR-карточек и перед карточками заряда;
 * нажатие на карточку события ничего не делает, двойное нажатие на карточку задачи отмечает её выполненной ([completeTask], ждёт [ScanActivity.HABIT_DOUBLE_MS]).
 * Среди этих карточек события всегда стоят перед задачами (событие важнее).
 *
 * Порядок карточек (фильтр, «Как тренировка?», «в конец», баллы релевантности, «к чему возвращаться») считает [QrPriority] — чистая функция от
 * [QrPriority.Snapshot]; здесь [snapshot] собирает его из источников ([WorkoutTracker], [PomodoroTimer], [StopwatchTimer], [CardTimers], [firedOf], [doneTaskIds], [QrRpe]),
 * а [order] / [plan] / [visibleCount] / [isAllDone] — тонкие обёртки. В отладочной сборке [plan] проверяет результат ([QrPriority.check]) и пишет нарушения в лог.
 * Для баллов «по релевантности» в [snapshot] читаются ещё будильники карточек ([CardAlarms.nextTimes], [CardAlarms.ringingIds]), заряд телефона ([QrBattery.phoneLevel])
 * и верхняя карточка прошлого расчёта (`lasttop` по id виджета, пишет [plan]): новая верхняя карточка не вытесняет прежнюю без отрыва в [QrPriority.HYSTERESIS] баллов.
 * Ручной приоритет карточки ([Card.prio], поле `prio` у карточки в настройках: «top» / «normal» / «low») учитывает [QrPriority]; почему сверху именно эта карточка, [plan] запоминает
 * (`why` по id виджета) и отдаёт странице [whyJson] (мост `widgetWhy`, версия 36).
 * Перерисовку без внешнего события ставит [nextDynChange] (минимум из своего значения и [QrPriority.Result.nextChangeAt]); смена заряда через порог 15 %
 * ([onBatteryChanged]) и будильники ([onAlarmsChanged], в том числе повторный звонок и смахивание) пересчитывают порядок.
 *
 * Галочка «Спрашивать о тренировке» (`rpeAsk` у виджета): пока есть тренировка без оценки нагрузки ([QrRpe.pendingId]), над ВСЕМИ карточками стоит служебная
 * карточка [QrRpe.KEY] «Как тренировка?» с кнопками 1…10 ([QrPriority.build], [order]); ответ ложится в очередь [QrRpe.answer], карточка исчезает. Наверх она возвращается
 * по тому же правилу, что и рекомендованная ([QrPriority.Result.anchorKey]), даже без «релевантности»; порядок остальных карточек от неё не зависит; слайд-шоу на это время стоит ([rotate]).
 *
 * Возврат наверх («по релевантности», [armReturn]/[fireReturn]): если пользователь смахнул стопку, а наверху лежит рекомендованная
 * карточка (идёт занятие или сейчас «её» время суток — [Ordered.topKey]) либо карточка события/задачи календаря ([QrPriority.Result.anchorKey]), то через минуту
 * после последнего смахивания стопка снова показывает верхнюю карточку порядка [order]. Данные от страницы (`sync`), не менявшие настройки
 * виджета (только состав задач и событий), положение стопки не трогают ([structSig]). Смахивание система оболочке не сообщает, его видно только по запросу фабрики
 * ([QrWidgetService]: счётчик в `VIRT` раз больше числа карточек), см. [onPossibleSwipe].
 */
object QrWidgets {

    private const val PREFS = "qr_widgets"
    private const val K_CFG = "cfg"
    private const val K_BIND = "bind"
    private const val K_TOP = "top"
    /** cfg.id → верхняя карточка по релевантности при прошлом расчёте ([QrPriority.Snapshot.lastTopKey], устойчивость порядка). */
    private const val K_LASTTOP = "lasttop"
    /** cfg.id → {key, title, reason} верхней карточки, как её показал последний расчёт ([QrPriority.Result.topReason]); читает мост `widgetWhy`. */
    private const val K_WHY = "why"
    private const val K_PEND = "pend"
    private const val K_TOKEN = "token"
    private const val K_FIRED = "fired"
    private const val K_TDONE = "taskDone" // очередь: id задач, отмеченных двойным нажатием в виджете, ещё не применённых страницей
    private const val K_THIDE = "taskHide"  // id уже забранных страницей задач: карточка скрыта, пока `sync` не пришлёт состав без неё
    private const val K_BTWANT = "btwant"
    private const val K_BTASK = "btask"
    private const val K_BTASKAT = "btaskat"
    private const val K_RETURN = "ret"
    private const val K_RETFIRST = "retfirst" // id виджета → время первого смахивания в текущей серии (потолок откладывания возврата)
    private const val K_AEV = "alarmEv"       // очередь: заведённые/выключенные нажатием в виджете будильники — страница запишет их в журнал событий
    private const val K_AEVSEQ = "alarmEvSeq"
    private const val AEV_MAX = 50

    const val ACTION_ROTATE = "com.app.lifetracker.QRW_ROTATE"
    const val ACTION_TICK = "com.app.lifetracker.QRW_TICK"
    const val ACTION_BATTERY = "com.app.lifetracker.QRW_BATTERY"
    const val ACTION_RETURN = "com.app.lifetracker.QRW_RETURN"
    const val ACTION_BT_BURST = "com.app.lifetracker.QRW_BT_BURST"
    const val EXTRA_STEP = "step"
    const val EXTRA_SINCE = "since"
    const val EXTRA_CONNECTED = "connected"

    private const val PEND_TTL_MS = 3 * 60_000L
    private const val DOTS_SHOW_MS = 1400L
    private const val RETURN_AFTER_MS = 60_000L
    /** Возврат наверх не откладывается дольше этого от первого смахивания серии, сколько бы раз фабрику ни дёргали. */
    private const val RETURN_MAX_DEFER_MS = 3 * 60_000L
    private const val SWIPE_QUIET_MS = 4_000L
    private const val BATTERY_EVERY_MS = 5 * 60_000L

    /** Серия проверок заряда после подключения Bluetooth-устройства: через столько мс от подключения (6, 15, 30, 60, 120 с). */
    private val BT_BURST_AT = longArrayOf(6_000L, 15_000L, 30_000L, 60_000L, 120_000L)

    /** Запас назад от момента подключения: заряд, пришедший чуть раньше, чем мы обработали подключение, считается свежим. */
    private const val BT_SINCE_SLACK_MS = 5_000L
    private const val BT_ASK_EVERY_MS = 24 * 3_600_000L
    private const val MAX_CARDS = 50
    private const val MAX_DYN = 24
    private val KEY_RE = Regex("^[A-Za-z0-9_-]{1,40}$")

    private val LOCK = Any()
    private val main = Handler(Looper.getMainLooper())
    private val refreshToken = Any()
    private val alarmToken = Any()
    private val hideTokens = HashMap<Int, Any>()
    private val returnTokens = HashMap<Int, Any>()

    /** Виджеты, у которых сейчас показаны точки справа (чтобы при серии смахиваний не слать лишних обновлений). */
    private val dotsOn: MutableSet<Int> = Collections.synchronizedSet(HashSet<Int>())

    /** До какого момента (uptime) запросы фабрики не считаются смахиванием: стопку только что переставили мы сами. */
    private val swipeQuiet = HashMap<Int, Long>()

    /** Версия адаптера стопки у виджета (extra `rev` в intent службы): смена версии заставляет систему создать адаптер заново, с пустым кэшем карточек. */
    private val adapterRev = HashMap<Int, Int>()

    class Live(val k: String, val id: String)
    /** Настройки будильника карточки (от страницы): нажатие в виджете заводит/выключает его без окна и страницы. */
    class AlarmSpec(val hour: Int, val minute: Int, val every: Int, val times: Int, val title: String)
    /** [dyn] — "task" / "event" у карточек задач и событий календаря ([at] — их время, мс), иначе пусто. */
    class Card(val key: String, val code: String, val title: String, val live: List<Live>, val times: Set<String>, val days: Set<Int>, val after: String = "none", val color: Int = QrBattery.DEFAULT_FACE, val dyn: String = "", val at: Long = 0L, val habit: Boolean = false, val tid: String = "", val alarmId: String = "", val alarmSpec: AlarmSpec? = null, val prio: String = "normal")
    class Cfg(val id: String, val name: String, val rotate: Boolean, val rotateMin: Int, val relevance: Boolean, val cards: List<Card>, val battery: Boolean = false, val batteryMulti: Boolean = false, val tasks: Boolean = false, val events: Boolean = false, val rpeAsk: Boolean = false) {
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

    private fun parseAlarmSpec(o: JSONObject?): AlarmSpec? {
        if (o == null) return null
        val h = o.optInt("h", -1)
        val m = o.optInt("m", -1)
        if (h !in 0..23 || m !in 0..59) return null
        return AlarmSpec(h, m, o.optInt("every", 0), o.optInt("times", 0), o.optString("title", "").take(200))
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
                        if (ta != null) for (x in 0 until ta.length()) ta.optString(x)?.let { if (QrPriority.WINDOWS.containsKey(it)) times.add(it) }
                        val days = HashSet<Int>()
                        val da = c.optJSONArray("days")
                        if (da != null) for (x in 0 until da.length()) da.optInt(x).let { if (it in 1..7) days.add(it) }
                        val after = c.optString("after", "none").let { if (it == "hide" || it == "end") it else "none" }
                        cards.add(Card(key, c.optString("code", ""), c.optString("title", ""), live, times, days, after, habit = c.optBoolean("habit", false), alarmId = c.optString("alarm", "").take(40), alarmSpec = parseAlarmSpec(c.optJSONObject("alarmSpec")), prio = QrPriority.normPrio(c.optString("prio", "normal"))))
                        if (cards.size >= MAX_CARDS) break
                    }
                }
                val tasksOn = o.optBoolean("tasks", false)
                val eventsOn = o.optBoolean("events", false)
                val rpeAskOn = o.optBoolean("rpeAsk", false)
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
                        val dc = Card(key, "", d.optString("title", ""), emptyList(), emptySet(), emptySet(), "none", QrBattery.DEFAULT_FACE, kind, at, tid = d.optString("tid", "").take(80))
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
                        o.optInt("rotateMin", 5).coerceIn(1, 720), o.optBoolean("relevance", false), cards, battery, batteryMulti, tasksOn, eventsOn, rpeAskOn
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
            pruneHiddenTasks(app)
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
        if (c.key == QrRpe.KEY) return QrRpe.render(ctx, c.color)
        if (c.key == QrBattery.KEY) return QrBattery.render(ctx, c.color)
        if (c.key == QrBattery.KEY2) return QrBattery.renderMulti(ctx, c.color)
        if (c.dyn.isNotEmpty()) dynBitmap(ctx, c)?.let { return it }
        if (c.alarmId.isNotEmpty() && CardAlarms.isArmed(ctx, c.alarmId)) { // будильник заведён — лицо с надписью «Заведён» (`<ключ>_on.png`)
            val on = File(imgDir(ctx), c.key + "_on.png")
            if (on.exists()) {
                try {
                    BitmapFactory.decodeFile(on.path)?.let { return it }
                } catch (e: Throwable) {
                    // не хватило памяти или файл повреждён — обычное лицо ниже
                }
            }
        }
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

    /** Картинка карточки задачи/события для нынешнего момента: «Просрочено» — `<ключ>_s.png` (сегодня) / `<ключ>_y.png` (вчера) / `<ключ>_o.png` (раньше), «Сегодня» — `<ключ>.png`, «Завтра» — `<ключ>_t.png`, день недели — `<ключ>_w.png`; нет нужной — берутся соседние. */
    private fun dynBitmap(ctx: Context, c: Card): Bitmap? {
        val now = System.currentTimeMillis()
        val names = when {
            c.dyn == "task" && c.at <= now -> when {
                c.at >= dayStart(now, 0) -> listOf(c.key + "_s", c.key + "_y", c.key + "_o")
                c.at >= dayStart(now, -1) -> listOf(c.key + "_y", c.key + "_o", c.key + "_s")
                else -> listOf(c.key + "_o", c.key + "_y", c.key + "_s")
            }
            c.at < dayStart(now, 0) -> listOf(c.key + "_o", c.key)
            c.at < dayStart(now, 1) -> listOf(c.key, c.key + "_o")
            c.at < dayStart(now, 2) -> listOf(c.key + "_t", c.key + "_w", c.key)
            else -> listOf(c.key + "_w", c.key + "_t", c.key)
        }
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

    /**
     * Когда пора перерисовать виджет: у карточек задач и событий — полночь (день недели → «Завтра» → «Сегодня», задача → «Просрочено») или начало ближайшего
     * события/задачи; при «релевантности» ещё и момент, когда сам собой изменится порядок ([QrPriority.Result.nextChangeAt]). Берётся ближайшее из них.
     */
    private fun nextDynChange(ctx: Context, cfg: Cfg): Long {
        val now = System.currentTimeMillis()
        var at = Long.MAX_VALUE
        if (cfg.tasks || cfg.events) {
            at = dayStart(now, 1) + 5_000L
            for (c in cfg.cards) if ((c.dyn == "event" || c.dyn == "task") && c.at > now && c.at + 1_000L < at) at = c.at + 1_000L
        }
        if (cfg.relevance) at = Math.min(at, plan(ctx, cfg).nextChangeAt)
        return at
    }

    private fun idSet(ctx: Context, key: String): MutableSet<String> {
        val out = LinkedHashSet<String>()
        try {
            val a = JSONArray(prefs(ctx).getString(key, "[]"))
            for (i in 0 until a.length()) a.optString(i).let { if (it.isNotEmpty()) out.add(it) }
        } catch (e: Exception) {
            // повреждённая запись — считаем пустой
        }
        return out
    }

    private fun putIdSet(ctx: Context, key: String, ids: Set<String>) {
        prefs(ctx).edit().putString(key, JSONArray(ids.toList()).toString()).apply()
    }

    /** Задачи, которые считаются выполненными в виджете: ждут страницу или уже забраны ею, но состав карточек ещё старый. */
    private fun doneTaskIds(ctx: Context): Set<String> = synchronized(LOCK) { idSet(ctx, K_TDONE) + idSet(ctx, K_THIDE) }

    /**
     * Двойное нажатие на карточку задачи в виджете: id задачи встаёт в очередь (страница отметит её выполненной — `widgetTaskTake`/`widgetTaskAck`, мост ≥34),
     * карточка сразу уходит из стопки, стопка возвращается к первой карточке.
     */
    fun completeTask(ctx: Context, taskId: String) {
        if (taskId.isEmpty() || taskId.length > 80) return
        val app = ctx.applicationContext
        val cfgIds = HashSet<String>()
        synchronized(LOCK) {
            val q = idSet(app, K_TDONE)
            q.add(taskId)
            putIdSet(app, K_TDONE, q)
            for (cfg in configs(app)) if (cfg.cards.any { it.dyn == "task" && it.tid == taskId }) cfgIds.add(cfg.id)
        }
        if (cfgIds.isNotEmpty()) refreshAll(app, true, false, cfgIds)
    }

    /** JSON-массив id задач, отмеченных в виджете и ещё не применённых страницей. */
    fun takeTaskDone(ctx: Context): String = synchronized(LOCK) { JSONArray(idSet(ctx, K_TDONE).toList()).toString() }

    /** Страница отметила эти задачи: из очереди они уходят в «скрытые» (до новой отправки состава карточек). */
    fun ackTaskDone(ctx: Context, idsJson: String?) {
        val app = ctx.applicationContext
        val ids = HashSet<String>()
        try {
            val a = JSONArray(idsJson ?: "[]")
            for (i in 0 until a.length()) a.optString(i).let { if (it.isNotEmpty()) ids.add(it) }
        } catch (e: Exception) {
            return
        }
        if (ids.isEmpty()) return
        synchronized(LOCK) {
            val q = idSet(app, K_TDONE)
            val h = idSet(app, K_THIDE)
            for (id in ids) if (q.remove(id)) h.add(id)
            putIdSet(app, K_TDONE, q)
            putIdSet(app, K_THIDE, h)
        }
    }

    /** После отправки состава карточек: в «скрытых» остаются только задачи, которые в нём всё ещё есть. */
    private fun pruneHiddenTasks(app: Context) {
        synchronized(LOCK) {
            val h = idSet(app, K_THIDE)
            if (h.isEmpty()) return
            val present = HashSet<String>()
            for (cfg in configs(app)) for (c in cfg.cards) if (c.dyn == "task" && c.tid.isNotEmpty()) present.add(c.tid)
            if (h.retainAll(present)) putIdSet(app, K_THIDE, h)
        }
    }

    /**
     * Нажатие на карточку-будильник в виджете (ScanActivity, extra `alarm`): без окна и страницы заводит будильник CardAlarms или, если он заведён, выключает.
     * Лицо с надписью «Заведён» меняется само (`CardAlarms` → [onAlarmsChanged]). Запись для журнала событий встаёт в очередь (`widgetAlarmTake`/`widgetAlarmAck`, мост ≥35).
     * false — карточки нет или настроек будильника у неё нет (старая отправка от страницы): окно откроет прежний путь через страницу.
     */
    fun toggleAlarm(ctx: Context, cardKey: String): Boolean {
        if (!KEY_RE.matches(cardKey)) return false
        val app = ctx.applicationContext
        val card = configs(app).asSequence().flatMap { it.cards.asSequence() }
            .firstOrNull { it.key == cardKey && it.alarmId.isNotEmpty() && it.alarmSpec != null } ?: return false
        val spec = card.alarmSpec ?: return false
        val now = System.currentTimeMillis()
        if (CardAlarms.isArmed(app, card.alarmId)) {
            CardAlarms.cancel(app, card.alarmId)
            queueAlarmEvent(app, JSONObject().put("id", card.alarmId).put("on", false).put("title", spec.title).put("ts", now))
        } else {
            val at = CardAlarms.set(app, card.alarmId, spec.title, spec.hour, spec.minute, spec.every, spec.times)
            if (at > 0L) {
                queueAlarmEvent(
                    app,
                    JSONObject().put("id", card.alarmId).put("on", true).put("title", spec.title).put("ts", now).put("at", at)
                        .put("h", spec.hour).put("m", spec.minute).put("every", spec.every).put("times", spec.times)
                )
            }
        }
        return true
    }

    private fun queueAlarmEvent(app: Context, ev: JSONObject) {
        synchronized(LOCK) {
            val p = prefs(app)
            val seq = p.getLong(K_AEVSEQ, 0L) + 1L
            val arr = try { JSONArray(p.getString(K_AEV, "[]")) } catch (e: Exception) { JSONArray() }
            arr.put(ev.put("n", seq))
            val out = JSONArray()
            for (i in maxOf(0, arr.length() - AEV_MAX) until arr.length()) out.put(arr.get(i))
            p.edit().putString(K_AEV, out.toString()).putLong(K_AEVSEQ, seq).apply()
        }
    }

    /** JSON-массив записей о будильниках, заведённых/выключенных в виджете и ещё не внесённых страницей в журнал. */
    fun takeAlarmEvents(ctx: Context): String = synchronized(LOCK) { prefs(ctx).getString(K_AEV, "[]") ?: "[]" }

    /** Страница внесла записи с этими номерами `n` (JSON-массив) — убрать их из очереди. */
    fun ackAlarmEvents(ctx: Context, nsJson: String?) {
        val ns = HashSet<Long>()
        try {
            val a = JSONArray(nsJson ?: "[]")
            for (i in 0 until a.length()) ns.add(a.optLong(i))
        } catch (e: Exception) {
            return
        }
        if (ns.isEmpty()) return
        synchronized(LOCK) {
            val p = prefs(ctx)
            val arr = try { JSONArray(p.getString(K_AEV, "[]")) } catch (e: Exception) { JSONArray() }
            val out = JSONArray()
            for (i in 0 until arr.length()) {
                val o = arr.optJSONObject(i) ?: continue
                if (o.optLong("n") !in ns) out.put(o)
            }
            p.edit().putString(K_AEV, out.toString()).apply()
        }
    }

    /** Двойное нажатие на карточку-привычку в виджете: карточка убирается из стопки до полуночи, что бы ни стояло в «после срабатывания». */
    fun hideHabitToday(ctx: Context, cardKey: String) = onCardFired(ctx, cardKey, true)

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

    /** «Как тренировка?» ждёт оценки: у виджета включено «Спрашивать о тренировке» и есть запись без оценки. */
    private fun rpePending(ctx: Context, cfg: Cfg): Boolean = cfg.rpeAsk && QrRpe.pendingId(ctx).isNotEmpty()

    /** Собирает из источников оболочки всё, что нужно [QrPriority] для расчёта порядка виджета [cfg]. Живые занятия читаются только при «релевантности». */
    private fun snapshot(ctx: Context, cfg: Cfg): QrPriority.Snapshot {
        val now = System.currentTimeMillis()
        val cal = Calendar.getInstance()
        cal.timeInMillis = now
        val rel = cfg.relevance
        val timers = HashSet<String>()
        if (rel) for (c in cfg.cards) for (l in c.live) if (l.k == "timer" && l.id.isNotEmpty() && CardTimers.hasId(ctx, l.id)) timers.add(l.id)
        val moved = HashMap<String, Long>()
        val mv = firedOf(ctx, cfg.id).optJSONObject("moved")
        if (mv != null) {
            val ks = mv.keys()
            while (ks.hasNext()) {
                val k = ks.next()
                moved[k] = mv.optLong(k, 0L)
            }
        }
        val st = WorkoutTracker.status
        val hasAlarms = rel && cfg.cards.any { it.alarmId.isNotEmpty() }
        return QrPriority.Snapshot(
            now = now, cal = cal,
            workoutActive = rel && (st == WorkoutTracker.ST_SEARCH || st == WorkoutTracker.ST_RUN || st == WorkoutTracker.ST_PAUSE),
            pomodoroActive = rel && PomodoroTimer.isActive(ctx),
            stopwatchActive = rel && StopwatchTimer.isActive(ctx),
            activeTimerIds = timers,
            alarms = if (hasAlarms) CardAlarms.nextTimes(ctx) else emptyMap(),
            ringingAlarmIds = if (hasAlarms) CardAlarms.ringingIds(ctx) else emptySet(),
            batteryPercent = if (rel && cfg.anyBattery) QrBattery.phoneLevel(ctx) else -1,
            lastTopKey = if (rel) jmap(ctx, K_LASTTOP).optString(cfg.id, "") else "",
            hiddenKeys = hiddenKeys(ctx, cfg),
            movedAt = moved,
            doneTaskIds = doneTaskIds(ctx),
            rpePending = rpePending(ctx, cfg)
        )
    }

    /** Порядок стопки по [QrPriority]; в отладочной сборке результат ещё проверяется ([QrPriority.check]), нарушение пишется в лог и показ не ломает. */
    private fun plan(ctx: Context, cfg: Cfg): QrPriority.Result {
        val s = snapshot(ctx, cfg)
        val res = QrPriority.build(cfg, s)
        if (cfg.relevance && res.mainTopKey != s.lastTopKey) rememberTop(ctx, cfg.id, res.mainTopKey)
        rememberWhy(ctx, cfg.id, whyOf(res))
        if ((ctx.applicationContext.applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE) != 0) {
            try {
                for (v in QrPriority.check(res, cfg, s)) Log.e("QrPriority", cfg.id + ": " + v)
            } catch (e: Exception) {
                Log.e("QrPriority", "check: " + e)
            }
        }
        return res
    }

    /** Запоминает верхнюю карточку по релевантности: следующий расчёт не отдаст верх новой карточке без заметного отрыва. */
    private fun rememberTop(ctx: Context, cfgId: String, key: String) {
        synchronized(LOCK) {
            val t = jmap(ctx, K_LASTTOP)
            if (t.optString(cfgId, "") == key) return
            t.put(cfgId, key)
            prefs(ctx).edit().putString(K_LASTTOP, t.toString()).apply()
        }
    }

    private fun whyOf(res: QrPriority.Result): JSONObject =
        JSONObject().put("key", res.topKey).put("title", res.topTitle).put("reason", res.topReason)

    /** Запоминает, какая карточка сейчас наверху виджета и почему (пишет только при изменении: расчёт идёт при каждой перерисовке). */
    private fun rememberWhy(ctx: Context, cfgId: String, why: JSONObject) {
        synchronized(LOCK) {
            val t = jmap(ctx, K_WHY)
            if (t.optJSONObject(cfgId)?.toString() == why.toString()) return
            t.put(cfgId, why)
            prefs(ctx).edit().putString(K_WHY, t.toString()).apply()
        }
    }

    /**
     * `{"key","title","reason"}` — какая карточка сейчас наверху виджета конструктора [cfgId] и почему (мост `widgetWhy`, страница пишет это в форме виджета);
     * `key` пуст — ничего не выделено. Берётся то, что показал последний расчёт; если виджет ещё не считался — считается сейчас, без запоминания верхней карточки.
     * Пустая строка — такого виджета нет.
     */
    fun whyJson(ctx: Context, cfgId: String): String {
        val app = ctx.applicationContext
        val cfg = configs(app).firstOrNull { it.id == cfgId } ?: return ""
        val mgr = AppWidgetManager.getInstance(app)
        val placed = mgr.getAppWidgetIds(ComponentName(app, QrWidgetProvider::class.java)).any { cfgFor(app, it)?.id == cfgId }
        val saved = if (placed) jmap(app, K_WHY).optJSONObject(cfgId) else null // не стоящий на рабочем столе виджет мог остаться в памяти от прежнего расчёта
        if (saved != null) return saved.toString()
        return whyOf(QrPriority.build(cfg, snapshot(app, cfg))).toString()
    }

    fun visibleCount(ctx: Context, cfg: Cfg): Int = QrPriority.visibleCount(cfg, snapshot(ctx, cfg))

    /** Все карточки виджета скрыты («На сегодня больше ничего»). */
    fun isAllDone(ctx: Context, cfg: Cfg): Boolean = (cfg.cards.isNotEmpty() || cfg.tasks || cfg.events || cfg.rpeAsk) && visibleCount(ctx, cfg) == 0

    /**
     * Действие карточки [cardKey] сработало (нажатие в виджете, в приложении или скан): у карточек с «после срабатывания» = «скрывать» она
     * убирается из стопки до конца дня, с «в конец» — уходит в конец стопки. Виджеты, где карточки нет или выбрано «ничего», не трогаются.
     */
    fun onCardFired(ctx: Context, cardKey: String, forceHide: Boolean = false) {
        if (!KEY_RE.matches(cardKey)) return
        val app = ctx.applicationContext
        val touchedCfgs = HashSet<String>()
        synchronized(LOCK) {
            val all = jmap(app, K_FIRED)
            for (cfg in configs(app)) {
                val card = cfg.cards.firstOrNull { it.key == cardKey } ?: continue
                if (forceHide && !card.habit) continue
                if (card.after == "none" && !forceHide) continue
                val st = firedOf(app, cfg.id)
                st.put("day", dayKey())
                if (card.after == "hide" || forceHide) {
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
        // Стопка возвращается к первой из оставшихся карточек ОДНИМ полным обновлением (сброс — в том же RemoteViews, до перезагрузки данных,
        // адаптер создаётся заново): отдельное partiallyUpdateAppWidget(setDisplayedChild) после notifyAppWidgetViewDataChanged гонялось с
        // перезагрузкой карточек (после двойного нажатия по привычке стопка переставала листаться).
        refreshAll(app, true, false, touchedCfgs)
    }

    /**
     * Порядок стопки (считает [QrPriority.build]). Без «релевантности» — как собрал пользователь (скрытые убраны, перенесённые в конец — в конце). С ней сверху то,
     * что идёт сейчас (важнее — выше: тренировка, помодоро, таймер, секундомер), затем карточки, у которых сейчас «их» время суток и день, затем остальные в
     * исходном порядке. Карточки, перенесённые «в конец» сегодня, всегда в самом конце (по времени переноса) — даже если они идут сейчас или у них «их» время;
     * со следующего дня они снова участвуют в подборе. Над всеми — «Как тренировка?», пока она ждёт оценки.
     * [Ordered.topKey] — ключ карточки наверху, если она поднята по релевантности (иначе пусто).
     */
    fun order(ctx: Context, cfg: Cfg): Ordered {
        val res = plan(ctx, cfg)
        return Ordered(res.cards.map { it.card }, res.topKey)
    }

    // ---------- обновление ----------

    fun update(ctx: Context, mgr: AppWidgetManager, id: Int, resetTop: Boolean = false, rebuild: Boolean = false) {
        val app = ctx.applicationContext
        val wasBound = isBound(app, id)
        if (!wasBound) claimPending(app, id)
        val fresh = !wasBound && isBound(app, id) // виджет только что положили на экран: стопка обязана стоять на первой карточке порядка
        val cfg = cfgFor(app, id)
        if (cfg != null && cfg.anyBattery) QrBattery.register(app)
        val rv = RemoteViews(app.packageName, R.layout.qr_widget)
        applyHostLayout(app, rv, hostSizeDp(app, mgr, id))
        // Нужно ли поставить стопку на верхнюю карточку. Одиночный setDisplayedChild(0) у уже смахнутой стопки позицию не менял (так «возврат» молча не срабатывал),
        // поэтому любой сброс наверх — всегда полное пересоздание адаптера (то же, что в onCardFired, там это работает).
        val topNew = if (cfg != null && (cfg.relevance || cfg.rpeAsk)) plan(app, cfg).anchorKey else ""
        val topOld = jmap(app, K_TOP).optString(id.toString(), "")
        val trackTop = cfg != null && (cfg.relevance || cfg.rpeAsk)
        val moveTop = fresh || (trackTop && (resetTop || topNew != topOld))
        val doRebuild = rebuild || moveTop
        val svc = Intent(app, QrWidgetService::class.java)
        svc.putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, id)
        // rebuild: новая версия адаптера (другой intent — система создаёт RemoteViewsAdapter и фабрику заново); иначе версия прежняя и адаптер живёт
        val rev = synchronized(adapterRev) {
            if (doRebuild) adapterRev[id] = (adapterRev[id] ?: 0) + 1
            adapterRev[id] ?: 0
        }
        svc.putExtra("rev", rev)
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

        if (doRebuild) {
            rv.setDisplayedChild(R.id.qr_stack, 0) // тем же обновлением, что и данные: стопка показывает первую карточку
            clearReturn(app, id)
        }
        if (trackTop && (moveTop || topNew != topOld)) {
            synchronized(LOCK) {
                val t = jmap(app, K_TOP)
                t.put(id.toString(), topNew)
                prefs(app).edit().putString(K_TOP, t.toString()).apply()
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

    fun refreshAll(ctx: Context, resetTop: Boolean = false, forceAlarms: Boolean = false, rebuildCfgs: Set<String> = emptySet()) {
        val app = ctx.applicationContext
        val mgr = AppWidgetManager.getInstance(app)
        val ids = mgr.getAppWidgetIds(ComponentName(app, QrWidgetProvider::class.java))
        for (id in ids) {
            try {
                val rebuild = rebuildCfgs.isNotEmpty() && cfgFor(app, id)?.id in rebuildCfgs
                update(app, mgr, id, resetTop, rebuild)
            } catch (e: Exception) {
                // один сбойный виджет не мешает остальным
            }
        }
        scheduleAll(app, ids, forceAlarms)
    }

    /** Будильник карточки заведён, выключен или отзвонил: если в виджетах есть карточка-будильник, перерисовываем их (лицо «Заведён» меняется). */
    fun onAlarmsChanged(ctx: Context) {
        val app = ctx.applicationContext
        main.removeCallbacksAndMessages(alarmToken)
        main.postAtTime({
            try {
                if (configs(app).any { cfg -> cfg.cards.any { it.alarmId.isNotEmpty() } }) refreshAll(app)
            } catch (e: Exception) {
                // обновление виджета не должно ронять приложение
            }
        }, alarmToken, SystemClock.uptimeMillis() + 300L)
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

    /**
     * Появилась или пропала запись без оценки нагрузки (тренировка закончилась, оценка поставлена в виджете или в приложении): виджеты с галочкой
     * «Спрашивать о тренировке» перерисовываются — карточка «Как тренировка?» встаёт наверх или уходит; стопка при этом показывает верхнюю карточку.
     */
    fun onRpeChanged(ctx: Context) {
        val app = ctx.applicationContext
        try {
            if (configs(app).any { it.rpeAsk }) refreshAll(app)
        } catch (e: Exception) {
            // обновление виджета не должно ронять приложение
        }
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

    /** Будильник серии проверок заряда: один на все устройства, новое подключение заменяет прежнюю серию. */
    private fun btBurstPi(ctx: Context, step: Int, since: Long, connected: Boolean): PendingIntent {
        val i = Intent(ctx, QrWidgetProvider::class.java)
        i.action = ACTION_BT_BURST
        i.putExtra(EXTRA_STEP, step)
        i.putExtra(EXTRA_SINCE, since)
        i.putExtra(EXTRA_CONNECTED, connected)
        return PendingIntent.getBroadcast(ctx, 4997, i, PendingIntent.FLAG_UPDATE_CURRENT or immutable())
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

    private fun nextBoundary(): Long = QrPriority.nextBoundary(System.currentTimeMillis(), Calendar.getInstance())

    private fun scheduleAll(app: Context, ids: IntArray, force: Boolean) {
        var anyRel = false
        var anyHide = false
        var anyBattery = false
        var dynAt = Long.MAX_VALUE
        for (id in ids) {
            val cfg = cfgFor(app, id)
            if (cfg != null && cfg.anyBattery) anyBattery = true
            if (cfg != null && (cfg.tasks || cfg.events || cfg.relevance)) dynAt = Math.min(dynAt, nextDynChange(app, cfg))
            if (cfg != null && cfg.rotate && visibleCount(app, cfg) > 1) {
                if (force || rotatePi(app, id, false) == null) {
                    cancelRotate(app, id)
                    setAlarm(app, System.currentTimeMillis() + cfg.rotateMin * 60_000L, rotatePi(app, id, true)!!)
                }
            } else cancelRotate(app, id)
            if (cfg != null && cfg.relevance) anyRel = true
            if (cfg != null && cfg.cards.any { it.after == "hide" || it.habit }) anyHide = true // скрытое возвращается в полночь
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
    @Volatile private var lastBatteryLow = false

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
        // порог «низкий заряд» пересечён: при «релевантности» карточка заряда поднимается (или опускается) — пересчёт порядка и, если сменился верх, возврат стопки
        val low = QrBattery.phoneLevel(app).let { it in 0..QrPriority.BATTERY_LOW_PERCENT }
        val lowChanged = low != lastBatteryLow
        lastBatteryLow = low
        for (id in ids) {
            try {
                if (lowChanged && cfgFor(app, id)?.relevance == true) {
                    update(app, mgr, id)
                    continue
                }
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

    /**
     * Bluetooth-устройство (любое: наушники, часы, колонка…) подключилось или отключилось. Подключение: заряд устройство сообщает не сразу
     * (от нескольких секунд до полминуты), поэтому проверяем серией — через 6, 15, 30, 60 и 120 с, пока у всех подключённых устройств
     * свежий заряд не станет известен ([onBtBurst]). Отключение: одна перерисовка через 6 с, чтобы карточка убрала устройство.
     */
    fun onBluetoothChanged(ctx: Context, connected: Boolean = true) {
        val app = ctx.applicationContext
        val ids = AppWidgetManager.getInstance(app).getAppWidgetIds(ComponentName(app, QrWidgetProvider::class.java))
        if (ids.none { cfgFor(app, it)?.anyBattery == true }) return
        // наушники сообщают заряд сразу после подключения (за секунды): приёмник нужно поднять сейчас, а не по будильнику, иначе значение пропустим
        QrBattery.register(app)
        val now = System.currentTimeMillis()
        setAlarm(app, now + BT_BURST_AT[0], btBurstPi(app, 0, now - BT_SINCE_SLACK_MS, connected))
    }

    /**
     * Шаг серии проверок [step] после подключения: перерисовывает карточки заряда (если что-то изменилось — на погашенном экране тоже,
     * это дёшево) и, если заряд подключённых устройств ещё не весь известен, ставит следующий шаг. После последнего шага серия кончается;
     * дальше работают обычный будильник раз в 5 минут и вещание о смене заряда.
     */
    fun onBtBurst(ctx: Context, step: Int, since: Long, connected: Boolean) {
        val app = ctx.applicationContext
        val ids = AppWidgetManager.getInstance(app).getAppWidgetIds(ComponentName(app, QrWidgetProvider::class.java))
        if (ids.none { cfgFor(app, it)?.anyBattery == true }) return
        QrBattery.register(app)
        onBatteryChanged(app)
        if (!connected) return
        if (QrBattery.settled(app, since)) return
        val next = step + 1
        if (next >= BT_BURST_AT.size) return
        setAlarm(app, System.currentTimeMillis() + (BT_BURST_AT[next] - BT_BURST_AT[step]), btBurstPi(app, next, since, true))
    }

    @Suppress("DEPRECATION")
    private fun screenOn(pm: PowerManager): Boolean = if (Build.VERSION.SDK_INT >= 20) pm.isInteractive else pm.isScreenOn

    /** Будильник слайд-шоу: листает стопку на одну карточку и ставит следующий (телефон с погашенным экраном не будим). */
    fun rotate(ctx: Context, id: Int) {
        val app = ctx.applicationContext
        val cfg = cfgFor(app, id) ?: return
        if (!cfg.rotate || visibleCount(app, cfg) < 2) return
        val pm = app.getSystemService(Context.POWER_SERVICE) as PowerManager
        if (screenOn(pm) && !rpePending(app, cfg)) { // пока висит «Как тренировка?», слайд-шоу стопку не листает
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
            // Возврат наверх взводим ПЕРВЫМ и отдельно: сбой при рисовании точек (виджет удалили, лаунчер не принял обновление) раньше глотался общим catch
            // и до armReturn дело не доходило — стопка не возвращалась никогда.
            try {
                armReturn(app, id)
            } catch (e: Exception) {
                Log.e("QrReturn", "armReturn: " + e)
            }
            try {
                if (dotsOn.add(id)) {
                    val rv = RemoteViews(app.packageName, R.layout.qr_widget)
                    putDots(app, rv, n)
                    AppWidgetManager.getInstance(app).partiallyUpdateAppWidget(id, rv)
                }
                scheduleHide(app, id)
            } catch (e: Exception) {
                // виджет удалили
            }
        }
    }

    // ---------- возврат наверх ----------

    /** Взводит возврат стопки наверх через [RETURN_AFTER_MS] (каждое новое смахивание отодвигает его). Только «по релевантности» и только если есть рекомендованная карточка. */
    private fun armReturn(app: Context, id: Int) {
        val cfg = cfgFor(app, id) ?: return
        if (!cfg.relevance && !cfg.rpeAsk) return
        val res = plan(app, cfg)
        if (res.anchorKey.isEmpty() || res.cards.size < 2) return
        val now = System.currentTimeMillis()
        // Каждое смахивание отодвигает возврат на минуту, но не дальше RETURN_MAX_DEFER_MS от первого: если система сама дёргает фабрику
        // (перерисовка, перезагрузка карточек), «смахивания» шли бы без конца и возврат откладывался бы вечно.
        val due = synchronized(LOCK) {
            val m = jmap(app, K_RETURN)
            val f = jmap(app, K_RETFIRST)
            val first = if (m.optLong(id.toString(), 0L) > 0L && f.optLong(id.toString(), 0L) > 0L) f.optLong(id.toString(), 0L) else now
            val d = Math.max(now + 1_000L, Math.min(now + RETURN_AFTER_MS, first + RETURN_MAX_DEFER_MS))
            m.put(id.toString(), d)
            f.put(id.toString(), first)
            prefs(app).edit().putString(K_RETURN, m.toString()).putString(K_RETFIRST, f.toString()).apply()
            d
        }
        Log.d("QrReturn", "armed id=" + id + " in " + (due - now) + " ms, anchor=" + res.anchorKey)
        val delay = Math.max(1_000L, due - now)
        // точно по времени — пока жив процесс; будильник — запасной (процесс могли выгрузить)
        val token = synchronized(returnTokens) { returnTokens.getOrPut(id) { Any() } }
        main.removeCallbacksAndMessages(token)
        main.postAtTime({
            try {
                fireReturn(app, id)
            } catch (e: Exception) {
                Log.e("QrReturn", "fireReturn: " + e)
            }
        }, token, SystemClock.uptimeMillis() + delay)
        returnPi(app, id, true)?.let { setAlarm(app, due + 3_000L, it) }
    }

    /** Снимает ожидающий возврат (стопка и так переставлена наверх, или виджет удалён). */
    private fun clearReturn(app: Context, id: Int) {
        synchronized(LOCK) {
            val m = jmap(app, K_RETURN)
            val f = jmap(app, K_RETFIRST)
            if (m.has(id.toString()) || f.has(id.toString())) {
                m.remove(id.toString())
                f.remove(id.toString())
                prefs(app).edit().putString(K_RETURN, m.toString()).putString(K_RETFIRST, f.toString()).apply()
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
            val f = jmap(app, K_RETFIRST)
            val d = m.optLong(id.toString(), 0L)
            if (d > 0L && now >= d - 500L) {
                m.remove(id.toString())
                f.remove(id.toString())
                prefs(app).edit().putString(K_RETURN, m.toString()).putString(K_RETFIRST, f.toString()).apply()
                d
            } else 0L
        }
        if (due == 0L) return
        Log.d("QrReturn", "fire id=" + id)
        returnToTop(app, id)
    }

    /** Показывает в стопке верхнюю карточку порядка [order] — рекомендованную или более важную, чем та, на которой остановился пользователь. */
    private fun returnToTop(app: Context, id: Int) {
        val cfg = cfgFor(app, id) ?: return
        if (!cfg.relevance && !cfg.rpeAsk) return
        val res = plan(app, cfg)
        val anchor = res.anchorKey
        if (anchor.isEmpty() || res.cards.size < 2) return
        suppressSwipe(id)
        dotsOn.remove(id)
        synchronized(LOCK) {
            val t = jmap(app, K_TOP)
            t.put(id.toString(), anchor)
            prefs(app).edit().putString(K_TOP, t.toString()).apply()
        }
        // ОДНО полное обновление с пересозданием адаптера (как в onCardFired): сброс положения идёт в том же RemoteViews, что и данные.
        // Прежний возврат одним partiallyUpdateAppWidget(setDisplayedChild(0)) у смахнутой стопки не срабатывал — позицию StackView он не менял.
        update(app, AppWidgetManager.getInstance(app), id, true, true)
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
