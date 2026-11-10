package com.app.lifetracker
// Версия: 2.0 (10.11)

import android.content.Context

/**
 * Настройка «Использовать системный плавающий остров» (вкладка «Система», мост ≥27: `islandGet` / `islandSetSystem`).
 * Включена по умолчанию: острова таймера карточки, помодоро, секундомера, музыки, видео сайтов и тренировки отдаются системе
 * (остров Xiaomi / «живое обновление» Android 16 — [XiaomiIsland.available]). Выключена: уведомления остаются обычными, а
 * таймеры карточек, помодоро, секундомер, музыку и видео сайтов показывает плашка [InAppIsland] (до трёх занятий сразу), которая в этом режиме висит и при свёрнутом
 * приложении (окно поверх других приложений). Хранится на устройстве, в облако и экспорт не входит.
 *
 * Режим видео сайтов (`floatVideo`): false — воспроизведение в фоне (остров/уведомление), true — в фоне с плавающим окном
 * ([FloatingVideo]). Переключается кнопкой на раскрытой карточке видео в [InAppIsland]; одно значение на приложение, для всех видео.
 */
object IslandSettings {

    private const val PREFS = "island"
    private const val KEY_SYSTEM = "systemIsland"
    private const val KEY_FLOAT_VIDEO = "videoFloat"

    @Volatile
    private var cached: Boolean? = null

    @Volatile
    private var cachedFloat: Boolean? = null

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

    /** Видео сайтов уходит в плавающее окно (true) или играет только в фоне (false, по умолчанию). */
    fun floatVideo(ctx: Context): Boolean {
        cachedFloat?.let { return it }
        val v = ctx.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getBoolean(KEY_FLOAT_VIDEO, false)
        cachedFloat = v
        return v
    }

    fun setFloatVideo(ctx: Context, on: Boolean) {
        cachedFloat = on
        ctx.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putBoolean(KEY_FLOAT_VIDEO, on).apply()
    }
}
