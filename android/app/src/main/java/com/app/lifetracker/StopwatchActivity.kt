package com.app.lifetracker
// Версия: 1.0 (09.11)

import android.app.Activity
import android.os.Bundle

/**
 * Пункт «Секундомер» меню долгого нажатия на иконку приложения (res/xml/shortcuts.xml). Окна у него нет: запускает секундомер,
 * поднимает службу с островом ([StopwatchService]) и сразу закрывается — рабочий стол остаётся на экране, основное приложение
 * не открывается. Если секундомер уже идёт, он не сбрасывается, остров просто раскрывается снова.
 */
class StopwatchActivity : Activity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        try {
            StopwatchTimer.start(applicationContext)
            StopwatchService.refresh(applicationContext)
        } catch (e: Exception) {
            // запуск службы не разрешён — секундомер всё равно идёт, плашка в приложении его покажет
        }
        finish()
        overridePendingTransition(0, 0)
    }
}
