package com.app.lifetracker
// Версия: 1.0 (14.11)

import com.app.lifetracker.QrWidgets.Card
import com.app.lifetracker.QrWidgets.Cfg
import java.util.Calendar

/**
 * Порядок карточек стопки виджета «Стопка QR-карточек» и ответ на вопрос «что сейчас должно лежать сверху» (ТЗ TZ_card_priority.md).
 *
 * Чистая функция: без Android, SharedPreferences и часов — всё нужное приходит в [Snapshot] (его собирает [QrWidgets.snapshot]).
 * Слои стопки сверху вниз: 1) служебная «Как тренировка?» ([QrRpe.KEY]); 2) основная часть — отфильтрованные карточки, при «релевантности»
 * по баллам, иначе в порядке пользователя; 3) хвост — карточки «после срабатывания: в конец», перенесённые сегодня, в порядке переноса.
 * Фильтр (карточки нет в стопке вообще): скрытые сегодня, выполненные задачи, события и задачи вне окна [DYN_DAYS].
 * [check] проверяет инварианты результата; значения баллов — в таблице констант ниже.
 *
 * Этап 1 (вынос): баллы только прежние — идёт занятие (1000 + ранг), «её» время (500), остальное 0. Остальные поля [Snapshot]
 * (будильники, заряд, [Snapshot.lastTopKey]) пока не читаются.
 */
object QrPriority {

    // ---------- таблица баллов ----------
    /** Идёт тренировка / помодоро / таймер / секундомер (1000 + прежний ранг). */
    const val SCORE_WORKOUT = 1040
    const val SCORE_POMODORO = 1030
    const val SCORE_TIMER = 1020
    const val SCORE_STOPWATCH = 1010
    /** «Её» время суток и день недели ([scheduledNow]). */
    const val SCORE_SCHEDULED = 500

    /** Окно задач и событий: сегодня и ещё шесть дней (совпадает с FEED_DAYS в widgets.js). */
    const val DYN_DAYS = 7

    /** Интервалы времени суток (минуты от полуночи, [начало; конец)). Те же значения показывает страница (widgets.js, WINDOWS). */
    val WINDOWS: Map<String, Pair<Int, Int>> = mapOf("m" to (5 * 60 to 11 * 60), "d" to (11 * 60 to 15 * 60), "e" to (17 * 60 to 23 * 60))
    private val BOUNDARIES = intArrayOf(0, 5 * 60, 11 * 60, 15 * 60, 17 * 60, 23 * 60)

    /** Всё, что нужно для расчёта. Поля, которые этап 1 не читает, имеют значения по умолчанию. */
    data class Snapshot(
        val now: Long,
        val cal: Calendar,
        val workoutActive: Boolean = false,
        val pomodoroActive: Boolean = false,
        val stopwatchActive: Boolean = false,
        val activeTimerIds: Set<String> = emptySet(),
        val alarms: Map<String, Long> = emptyMap(),
        val ringingAlarmIds: Set<String> = emptySet(),
        val batteryPercent: Int = -1,
        val hiddenKeys: Set<String> = emptySet(),
        val movedAt: Map<String, Long> = emptyMap(),
        val doneTaskIds: Set<String> = emptySet(),
        val rpePending: Boolean = false,
        val lastTopKey: String = ""
    )

    class Scored(val card: Card, val score: Int, val reason: String)

    class Result(
        /** Итоговый порядок: rpe, основная часть, хвост. */
        val cards: List<Scored>,
        /** Карточка наверху по релевантности ("" — нет); у «Как тренировка?» — [QrRpe.KEY]. */
        val topKey: String,
        /** К чему возвращаться и от смены чего вставать наверх (прежние anchorKey/topAnchor). */
        val anchorKey: String,
        /** Когда порядок может измениться без внешнего события (ближайшая граница окон времени суток, только при «релевантности»); иначе [Long.MAX_VALUE]. */
        val nextChangeAt: Long
    )

    // ---------- построение ----------

    fun build(cfg: Cfg, s: Snapshot): Result {
        val base = visible(cfg, s)
        val main = ArrayList<Scored>()
        var top = ""
        if (!cfg.relevance || base.size < 2) {
            for (c in base) main.add(Scored(c, 0, ""))
        } else {
            val head = ArrayList<Card>()
            val tail = ArrayList<Card>() // уже стоят в порядке переноса
            for (c in base) if (movedToday(c, s)) tail.add(c) else head.add(c)
            if (head.isEmpty()) {
                for (c in tail) main.add(Scored(c, 0, ""))
            } else {
                val scored = ArrayList<Scored>()
                for (c in head) {
                    val sc = scoreOf(c, s)
                    scored.add(Scored(c, sc.first, sc.second))
                }
                // sortedWith устойчивая: при равных баллах остаётся порядок пользователя (события в cfg стоят раньше задач)
                val sorted = scored.sortedWith(compareByDescending<Scored> { it.score })
                main.addAll(sorted)
                for (c in tail) main.add(Scored(c, 0, ""))
                if (sorted.first().score > 0) top = sorted.first().card.key
            }
        }
        val out = ArrayList<Scored>()
        if (s.rpePending) out.add(Scored(rpeCard(), 0, "Ждёт оценки тренировки"))
        out.addAll(main)
        val topKey = if (s.rpePending) QrRpe.KEY else top
        return Result(out, topKey, anchorOf(cfg, s, main, top), if (cfg.relevance) nextBoundary(s.now, s.cal) else Long.MAX_VALUE)
    }

    /** Сколько карточек сейчас в стопке (с «Как тренировка?»): для isAllDone и точек. */
    fun visibleCount(cfg: Cfg, s: Snapshot): Int = visible(cfg, s).size + (if (s.rpePending) 1 else 0)

    /** Карточка «Как тренировка?» — служебная, над всеми. */
    private fun rpeCard(): Card = Card(QrRpe.KEY, "", "Как тренировка?", emptyList(), emptySet(), emptySet(), "none", QrRpe.DEFAULT_COLOR)

    /**
     * Ключ карточки, на которую стопка возвращается и от смены которой встаёт наверх: «Как тренировка?» (у любого виджета с этой галочкой);
     * иначе (только «по релевантности») рекомендованная карточка, а если такой нет — верхняя карточка события или задачи календаря. Пусто — своего места нет.
     */
    private fun anchorOf(cfg: Cfg, s: Snapshot, main: List<Scored>, top: String): String {
        if (s.rpePending) return QrRpe.KEY
        if (!cfg.relevance) return ""
        if (top.isNotEmpty()) return top
        val first = main.firstOrNull()?.card ?: return ""
        return if (first.dyn.isNotEmpty()) first.key else ""
    }

    // ---------- фильтр и перенос в конец ----------

    /** Ключ события, которое сейчас показывает карточка «события календаря»: ближайшее из ещё не начавшихся в пределах [DYN_DAYS] суток; пусто — показывать нечего. */
    fun nextEventKey(cfg: Cfg, s: Snapshot): String {
        val limit = dayStart(s.cal, s.now, DYN_DAYS)
        var best: Card? = null
        for (c in cfg.cards) {
            if (c.dyn != "event" || c.at <= s.now || c.at >= limit) continue
            if (best == null || c.at < best.at) best = c
        }
        return best?.key ?: ""
    }

    /** Карточка задачи видна, пока её время раньше конца окна [DYN_DAYS] суток (просроченная — до отметки); событие — только то, что выбрано [nextEventKey]. */
    private fun dynShown(c: Card, s: Snapshot, nextEv: String): Boolean = when (c.dyn) {
        "task" -> c.at < dayStart(s.cal, s.now, DYN_DAYS)
        "event" -> c.key == nextEv
        else -> true
    }

    private fun isShown(c: Card, s: Snapshot, nextEv: String): Boolean =
        !((c.after == "hide" || c.habit) && c.key in s.hiddenKeys) &&
            !(c.dyn == "task" && c.tid.isNotEmpty() && c.tid in s.doneTaskIds) &&
            dynShown(c, s, nextEv)

    /** Карточки, которые видны в стопке: в порядке «как собрал пользователь, перенесённые в конец — после них, по времени переноса». */
    private fun visible(cfg: Cfg, s: Snapshot): List<Card> {
        val nextEv = nextEventKey(cfg, s)
        val shown = cfg.cards.filter { isShown(it, s, nextEv) }
        if (shown.none { it.after == "end" && s.movedAt.containsKey(it.key) }) return shown
        return shown.withIndex().sortedWith(
            compareBy<IndexedValue<Card>> { if (it.value.after == "end") (s.movedAt[it.value.key] ?: 0L) else 0L }.thenBy { it.index }
        ).map { it.value }
    }

    /** Карточка «в конец» перенесена сегодня (со следующих суток снова участвует в основной части). */
    private fun movedToday(c: Card, s: Snapshot): Boolean {
        if (c.after != "end") return false
        return (s.movedAt[c.key] ?: 0L) >= dayStart(s.cal, s.now, 0)
    }

    // ---------- баллы ----------

    /** Балл карточки и причина: максимум по сигналам, не сумма. */
    private fun scoreOf(c: Card, s: Snapshot): Pair<Int, String> {
        var best = 0
        var why = ""
        for (l in c.live) {
            var sc = 0
            var w = ""
            when (l.k) {
                "workout" -> if (s.workoutActive) { sc = SCORE_WORKOUT; w = "Идёт тренировка" }
                "pomodoro" -> if (s.pomodoroActive) { sc = SCORE_POMODORO; w = "Идёт помодоро" }
                "timer" -> if (l.id.isNotEmpty() && l.id in s.activeTimerIds) { sc = SCORE_TIMER; w = "Идёт таймер" }
                "stopwatch" -> if (s.stopwatchActive) { sc = SCORE_STOPWATCH; w = "Идёт секундомер" }
            }
            if (sc > best) { best = sc; why = w }
        }
        if (best > 0) return Pair(best, why)
        if (scheduledNow(c, s.cal)) return Pair(SCORE_SCHEDULED, "Сейчас её время")
        return Pair(0, "")
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

    // ---------- время ----------

    /** Начало суток через [days] календарных дней от [now] (0 — сегодняшняя полночь; переход на летнее время не сдвигает). */
    private fun dayStart(zone: Calendar, now: Long, days: Int): Long {
        val c = zone.clone() as Calendar
        c.timeInMillis = now
        c.set(Calendar.HOUR_OF_DAY, 0); c.set(Calendar.MINUTE, 0); c.set(Calendar.SECOND, 0); c.set(Calendar.MILLISECOND, 0)
        if (days != 0) c.add(Calendar.DAY_OF_YEAR, days)
        return c.timeInMillis
    }

    /** Ближайшая после [now] граница окон времени суток (0, 5, 11, 15, 17, 23 ч; полночь — следующие сутки) плюс 5 секунд. */
    fun nextBoundary(now: Long, zone: Calendar): Long {
        val c = zone.clone() as Calendar
        c.timeInMillis = now
        val cur = c.get(Calendar.HOUR_OF_DAY) * 60 + c.get(Calendar.MINUTE)
        val next = BOUNDARIES.firstOrNull { it > cur } ?: (24 * 60)
        c.set(Calendar.HOUR_OF_DAY, 0); c.set(Calendar.MINUTE, 0); c.set(Calendar.SECOND, 5); c.set(Calendar.MILLISECOND, 0)
        c.add(Calendar.MINUTE, next)
        return c.timeInMillis
    }

    // ---------- инварианты ----------

    /** Нарушения инвариантов результата (ТЗ, п. 3); пусто — всё хорошо. Не меняет ничего и не бросает исключений. */
    fun check(result: Result, cfg: Cfg, s: Snapshot): List<String> {
        val bad = ArrayList<String>()
        val cards = result.cards.map { it.card }
        val keys = cards.map { it.key }

        // 1. «Как тренировка?» — только если ждёт оценки, и тогда первая
        val rpeAt = keys.indexOf(QrRpe.KEY)
        if (s.rpePending) {
            if (rpeAt != 0) bad.add("1: rpePending, но «Как тренировка?» не первая")
        } else if (rpeAt >= 0) bad.add("1: «Как тренировка?» есть без rpePending")
        if (keys.count { it == QrRpe.KEY } > 1) bad.add("1: «Как тренировка?» больше одной")
        val main = if (rpeAt == 0) cards.drop(1) else cards

        // 2. и 6. Нет скрытых, выполненных и вне окна; нет дублей; ничего не потеряно
        val nextEv = nextEventKey(cfg, s)
        for (c in main) if (!isShown(c, s, nextEv)) bad.add("2: лишняя карточка " + c.key)
        if (keys.toSet().size != keys.size) bad.add("6: дубли ключей")
        for (c in cfg.cards) if (isShown(c, s, nextEv) && main.none { it.key == c.key }) bad.add("6: потеряна карточка " + c.key)

        // 3. «В конец», перенесённые сегодня, — подряд в самом конце, в порядке переноса
        val movedIdx = main.indices.filter { movedToday(main[it], s) }
        if (movedIdx.isNotEmpty()) {
            if (movedIdx.first() != main.size - movedIdx.size) bad.add("3: перенесённые сегодня не в самом конце")
            for (i in 1 until movedIdx.size) {
                if ((s.movedAt[main[movedIdx[i]].key] ?: 0L) < (s.movedAt[main[movedIdx[i - 1]].key] ?: 0L)) bad.add("3: перенесённые не в порядке переноса")
            }
        }

        // 4. При равном балле событие выше задачи
        val scored = result.cards.filter { it.card.key != QrRpe.KEY }
        for (i in scored.indices) for (j in i + 1 until scored.size) {
            if (scored[i].score == scored[j].score && scored[i].card.dyn == "task" && scored[j].card.dyn == "event") bad.add("4: задача выше события при равном балле")
        }

        // 5. Без релевантности — порядок пользователя, topKey пуст (кроме rpe)
        if (!cfg.relevance) {
            val rest = main.filter { !(it.after == "end" && s.movedAt.containsKey(it.key)) }
            val order = cfg.cards.map { it.key }
            val pos = rest.map { order.indexOf(it.key) }
            for (i in 1 until pos.size) if (pos[i] < pos[i - 1]) bad.add("5: нарушен порядок пользователя")
            if (result.topKey.isNotEmpty() && result.topKey != QrRpe.KEY) bad.add("5: topKey не пуст без релевантности")
        }

        // 7. topKey — первая карточка основной части (или «Как тренировка?»)
        if (result.topKey.isNotEmpty() && result.topKey != QrRpe.KEY && main.firstOrNull()?.key != result.topKey) bad.add("7: topKey не первая карточка основной части")
        if (result.topKey == QrRpe.KEY && rpeAt != 0) bad.add("7: topKey — rpe, но её нет наверху")
        return bad
    }
}
