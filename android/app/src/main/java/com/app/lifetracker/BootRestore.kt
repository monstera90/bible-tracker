package com.app.lifetracker
// Версия: 1.0 (22.11)

import android.content.Context
import android.os.SystemClock

/**
 * Восстановление будильников, таймеров и прочего после перезагрузки телефона. Раньше это делал только [NotifyReceiver] по BOOT_COMPLETED,
 * а на Xiaomi/HyperOS (запрет «Автозапуска») эту рассылку приложению часто не доставляют — будильники карточек оставались несозданными,
 * пока приложение не откроют. Теперь то же самое запускается ещё и с виджета «Стопка QR-карточек» (система сама зовёт его onUpdate после
 * загрузки — запрет автозапуска на это не действует) и при входе в приложение.
 *
 * [ensure] выполняет восстановление один раз за загрузку телефона (момент загрузки запоминается), поэтому звать его можно сколько угодно.
 * [run] — безусловное восстановление (смена времени/пояса, обновление приложения, BOOT_COMPLETED).
 */
object BootRestore {
    private const val PREFS = "boot_restore"
    private const val KEY_BOOT = "bootAt"
    private const val SAME_BOOT_MS = 2 * 60 * 1000L
    private val LOCK = Any()

    /** Момент загрузки телефона (мс, по настенным часам) — одинаков в пределах одной загрузки, с запасом на подстройку часов. */
    private fun bootMoment(): Long = System.currentTimeMillis() - SystemClock.elapsedRealtime()

    private fun mark(ctx: Context) {
        ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putLong(KEY_BOOT, bootMoment()).apply()
    }

    /** Восстановление, если после этой загрузки телефона оно ещё не выполнялось. Возвращает true, если выполнило. */
    fun ensure(ctx: Context): Boolean {
        val c = ctx.applicationContext
        synchronized(LOCK) {
            val last = c.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getLong(KEY_BOOT, 0L)
            if (last != 0L && Math.abs(last - bootMoment()) < SAME_BOOT_MS) return false
            mark(c) // сначала отметка: параллельный вызов (виджет и приложение сразу после загрузки) второй раз не пойдёт
        }
        run(c)
        return true
    }

    /** Всё, что система теряет при перезагрузке: каждый шаг сам по себе — сбой одного не мешает остальным. */
    fun run(ctx: Context) {
        val c = ctx.applicationContext
        synchronized(LOCK) { mark(c) }
        step { ReminderScheduler.fireDue(c) } // просроченное, пока телефон был выключен, показывается сразу (с исходным временем в тексте)
        step { ReminderScheduler.scheduleNext(c) }
        step { GroupWatcher.scheduleNextPoll(c) }
        step { CardTimers.restore(c) }        // таймеры карточек: будильники и уведомления заново, закончившиеся — сразу
        step { CardAlarms.restore(c) }        // будильники карточек: заново, опоздавшие звонки пропускаются
        step { VolumeBoost.restore(c) }       // усиление громкости: эффект и служба заново, если было включено
        step { PomodoroTimer.restore(c) }     // помодоро: будильник фазы и служба заново, опоздавшие переходы догоняются
        step { StopwatchService.refresh(c) }  // секундомер: служба и остров заново, если он шёл (из фона на новых Android может быть запрещено)
    }

    private fun step(f: () -> Unit) {
        try { f() } catch (e: Exception) { /* этот шаг не удался — остальные выполняются */ }
    }
}
