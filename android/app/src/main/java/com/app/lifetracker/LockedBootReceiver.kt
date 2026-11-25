package com.app.lifetracker
// Версия: 1.0 (24.11) — будильники карточек ставятся заново сразу после включения телефона, не дожидаясь первой разблокировки.

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/**
 * Приёмник LOCKED_BOOT_COMPLETED (directBootAware): приходит сразу при включении телефона, ещё до ввода PIN-кода/пароля.
 * Обычный BOOT_COMPLETED ([NotifyReceiver]) приходит только после первой разблокировки, а системные будильники при перезагрузке сбрасываются —
 * поэтому будильник, который должен был прозвонить в это время, не звонил. Здесь восстанавливаются только будильники карточек:
 * их состояние лежит в хранилище, доступном до разблокировки ([CardAlarms]); остальное (напоминания, таймеры, помодоро и т. д.)
 * по-прежнему восстанавливает [BootRestore] после разблокировки.
 */
class LockedBootReceiver : BroadcastReceiver() {

    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != Intent.ACTION_LOCKED_BOOT_COMPLETED) return
        try {
            CardAlarms.restore(context.applicationContext)
        } catch (e: Exception) {
            // после разблокировки будильники поставит BootRestore
        }
    }
}
