package com.app.lifetracker
// Версия: 1.0 (26.10) — новый файл. Счётчики вкладки «Трекер экранов», которые нельзя считать в странице (она спит, когда приложение свёрнуто).

import android.content.Context
import org.json.JSONObject

/**
 * Накопительные счётчики этого устройства, миллисекунды, только растут (SharedPreferences `screen_time_stats`):
 *  - [MUSIC] — сколько [MusicPlayer] воспроизводил музыку (сумма отрезков, когда `playing == true`);
 *  - [TIMERS] — сколько насчитали таймеры карточек ([CardTimers]): сработавший — заданное время целиком,
 *    остановленный или перезапущенный — сколько успел отсчитать (время на паузе не считается).
 * Страница забирает итог мостом `getScreenTimeTotals` (мост версии 16), добавляет в свою запись устройства и синхронизирует
 * с другими устройствами (screentime.js). Чтобы добавить счётчик: константа здесь, вызов [add] из места события, поле в [totalsJson].
 */
object ScreenTimeStats {
    const val MUSIC = "music_ms"
    const val TIMERS = "timers_ms"
    private const val PREFS = "screen_time_stats"
    private val LOCK = Any()

    private fun prefs(ctx: Context) = ctx.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    fun add(ctx: Context, key: String, ms: Long) {
        if (ms <= 0L) return
        synchronized(LOCK) {
            val p = prefs(ctx)
            p.edit().putLong(key, p.getLong(key, 0L) + ms).apply()
        }
    }

    fun get(ctx: Context, key: String): Long = synchronized(LOCK) { prefs(ctx).getLong(key, 0L) }

    /** JSON {"music": мс, "timers": мс}; музыка включает идущий сейчас отрезок. */
    fun totalsJson(ctx: Context): String =
        JSONObject()
            .put("music", get(ctx, MUSIC) + MusicPlayer.livePlayingMs())
            .put("timers", get(ctx, TIMERS))
            .toString()
}
