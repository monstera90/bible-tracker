package com.app.lifetracker
// Версия: 1.0 (09.11)

import android.content.Context

/**
 * Секундомер (пункт «Секундомер» в меню долгого нажатия на иконку приложения, [StopwatchActivity]). Состояние лежит в
 * SharedPreferences `stopwatch` и считается по часам телефона: [KEY_ACC] — накопленное до последнего запуска, [KEY_RUN_START] —
 * когда начат нынешний отрезок. Показ — остров Xiaomi и уведомление ([StopwatchService], [XiaomiIsland.stopwatchExtras]) и плашка
 * внутри приложения ([InAppIsland]: нажатие — пауза/продолжить, долгое нажатие — сброс).
 */
object StopwatchTimer {

    class Snapshot(val running: Boolean, val elapsedMs: Long)

    private const val PREFS = "stopwatch"
    private const val KEY_ACTIVE = "active"
    private const val KEY_RUNNING = "running"
    private const val KEY_ACC = "acc"
    private const val KEY_RUN_START = "runStart"

    @Volatile private var floatPending = false

    private fun sp(ctx: Context) = ctx.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    @Synchronized
    fun isActive(ctx: Context): Boolean = sp(ctx).getBoolean(KEY_ACTIVE, false)

    /** Запускает секундомер с нуля; если он уже идёт — ничего не сбрасывает (остров лишь раскрывается заново). true — запущен новый. */
    @Synchronized
    fun start(ctx: Context): Boolean {
        floatPending = true
        if (sp(ctx).getBoolean(KEY_ACTIVE, false)) return false
        sp(ctx).edit()
            .putBoolean(KEY_ACTIVE, true).putBoolean(KEY_RUNNING, true)
            .putLong(KEY_ACC, 0L).putLong(KEY_RUN_START, System.currentTimeMillis())
            .apply()
        QrWidgets.onActivityChanged(ctx)
        return true
    }

    @Synchronized
    fun togglePause(ctx: Context) {
        val p = sp(ctx)
        if (!p.getBoolean(KEY_ACTIVE, false)) return
        val now = System.currentTimeMillis()
        if (p.getBoolean(KEY_RUNNING, false)) {
            val acc = p.getLong(KEY_ACC, 0L) + (now - p.getLong(KEY_RUN_START, now)).coerceAtLeast(0L)
            p.edit().putBoolean(KEY_RUNNING, false).putLong(KEY_ACC, acc).apply()
        } else {
            p.edit().putBoolean(KEY_RUNNING, true).putLong(KEY_RUN_START, now).apply()
            floatPending = true
        }
    }

    @Synchronized
    fun stop(ctx: Context) {
        sp(ctx).edit().clear().apply()
        QrWidgets.onActivityChanged(ctx)
    }

    @Synchronized
    fun snapshot(ctx: Context): Snapshot? {
        val p = sp(ctx)
        if (!p.getBoolean(KEY_ACTIVE, false)) return null
        val running = p.getBoolean(KEY_RUNNING, false)
        val now = System.currentTimeMillis()
        val ms = p.getLong(KEY_ACC, 0L) + if (running) (now - p.getLong(KEY_RUN_START, now)).coerceAtLeast(0L) else 0L
        return Snapshot(running, ms)
    }

    /** true один раз после запуска/продолжения: остров раскрывается ([XiaomiIsland.stopwatchExtras], `float`). */
    fun consumeFloat(): Boolean {
        val f = floatPending
        floatPending = false
        return f
    }
}
