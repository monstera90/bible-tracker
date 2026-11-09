package com.app.lifetracker
// Версия: 1.0 (09.11)

import android.content.Context

/**
 * Настройка «Использовать системный плавающий остров» (вкладка «Система», мост ≥27: `islandGet` / `islandSetSystem`).
 * Включена по умолчанию: острова таймера карточки, помодоро, секундомера, музыки, видео сайтов и тренировки отдаются системе
 * (остров Xiaomi / «живое обновление» Android 16 — [XiaomiIsland.available]). Выключена: уведомления остаются обычными, а
 * таймер карточки, помодоро и секундомер показывает плашка [InAppIsland], которая в этом режиме висит и при свёрнутом
 * приложении (окно поверх других приложений). Хранится на устройстве, в облако и экспорт не входит.
 */
object IslandSettings {

    private const val PREFS = "island"
    private const val KEY_SYSTEM = "systemIsland"

    @Volatile
    private var cached: Boolean? = null

    fun systemEnabled(ctx: Context): Boolean {
        cached?.let { return it }
        val v = ctx.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getBoolean(KEY_SYSTEM, true)
        cached = v
        return v
    }

    fun setSystemEnabled(ctx: Context, on: Boolean) {
        cached = on
        ctx.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putBoolean(KEY_SYSTEM, on).apply()
    }
}
