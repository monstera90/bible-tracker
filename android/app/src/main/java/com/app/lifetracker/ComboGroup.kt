package com.app.lifetracker
// Версия: 1.0 (31.10)

import android.content.Context
import org.json.JSONArray

/**
 * Группа действий QR «Комбинированный»: таймеры (обычные и скрытые), музыка и запись тренировки, запущенные одним кодом,
 * работают как единое целое.
 *
 *  - Пауза любого участника (кнопка уведомления, остров, плашка в приложении, полоса плеера, вкладка «Тренировки») ставит
 *    на паузу всех; «Продолжить» любого — продолжает всех.
 *  - «Стоп» / «Отмена» / «Закрыть» любого участника останавливает всех и распускает группу.
 *  - Уведомления участников нельзя смахнуть: смахнутое возвращается на место (`CardTimers.dismissed`, `MusicService`);
 *    тренировка и так перепоставляется службой раз в секунду.
 *
 * Состав собирается так: страница зовёт `begin()`, запускает действия, затем `end()`. Всё, что за это окно стартовало
 * (`onTimerStart`, `onMusicStart`, `onWorkoutBegin`), становится участником; старт вне окна участника из группы убирает.
 * Тренировка может начаться позже окна (запрос разрешения на геолокацию, окно ярлыка передаёт запуск приложению) —
 * для этого `end("expect")` на 5 минут оставляет «ожидание тренировки».
 *
 * Паузы и остановки, которые устроила система (потеря звукового фокуса, выдернутые наушники, конец трека, срабатывание
 * таймера), группу не трогают. Таймеры хранятся в SharedPreferences (кнопки уведомления работают и в новом процессе);
 * музыка и тренировка живут только в памяти — вместе с процессом исчезают и они.
 *
 * Блокировка: свою `LOCK` держим только на изменение состава; в `CardTimers`/`MusicPlayer`/`WorkoutTracker` выходим уже
 * по снимку состава, без неё.
 */
object ComboGroup {

    private const val PREFS = "combo_group"
    private const val KEY_TIMERS = "timers"
    private const val COLLECT_MAX_MS = 10_000L          // окно сбора не живёт дольше (страница могла не дозвать end)
    private const val EXPECT_WORKOUT_MS = 5 * 60_000L   // сколько ждём старта тренировки после окна сбора

    private val LOCK = Any()
    private var app: Context? = null
    private var loaded = false
    private val timers = LinkedHashSet<String>()
    private var music = false
    private var workout = false
    private var collectingSince = 0L
    private var expectWorkoutUntil = 0L

    private enum class Src { TIMER, MUSIC, WORKOUT }

    private class Snap(val ctx: Context, val timers: List<String>, val music: Boolean, val workout: Boolean)

    // ---------- состав (только под LOCK) ----------

    private fun prefs(ctx: Context) = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    private fun load(ctx: Context) {
        if (app == null) app = ctx.applicationContext
        if (loaded) return
        loaded = true
        try {
            val a = JSONArray(prefs(ctx.applicationContext).getString(KEY_TIMERS, "[]") ?: "[]")
            for (i in 0 until a.length()) timers.add(a.getString(i))
        } catch (e: Exception) {
            // повреждённая запись — группа пустая
        }
    }

    private fun saveTimers() {
        val c = app ?: return
        try {
            prefs(c).edit().putString(KEY_TIMERS, JSONArray(timers.toList()).toString()).apply()
        } catch (e: Exception) {
            // не записалось: группа живёт в памяти до конца процесса
        }
    }

    private fun collecting(): Boolean =
        collectingSince > 0L && System.currentTimeMillis() - collectingSince < COLLECT_MAX_MS

    private fun clearLocked() {
        timers.clear()
        music = false
        workout = false
        expectWorkoutUntil = 0L
        saveTimers()
    }

    private fun snapIf(ctx: Context?, src: Src, id: String?): Snap? = synchronized(LOCK) {
        if (ctx != null) load(ctx)
        val c = app ?: return@synchronized null
        val member = when (src) {
            Src.TIMER -> id != null && timers.contains(id)
            Src.MUSIC -> music
            Src.WORKOUT -> workout
        }
        if (!member) null else Snap(c, timers.toList(), music, workout)
    }

    // ---------- сбор группы (страница) ----------

    /** Начало запуска действий кода: прежняя группа распускается (её участники продолжают идти сами по себе). */
    fun begin(ctx: Context) = synchronized(LOCK) {
        load(ctx)
        clearLocked()
        collectingSince = System.currentTimeMillis()
    }

    /**
     * Конец запуска. [workout]: "none" — тренировки в коде нет или она не началась; "expect" — тренировка стартует позже
     * (запрос разрешения, запуск из окна ярлыка), её старт в ближайшие 5 минут станет участником; "now" — запись уже идёт,
     * она становится участником.
     */
    fun end(ctx: Context, workout: String?) = synchronized(LOCK) {
        load(ctx)
        collectingSince = 0L
        when (workout) {
            "expect" -> if (!this.workout) expectWorkoutUntil = System.currentTimeMillis() + EXPECT_WORKOUT_MS
            "now" -> {
                val st = WorkoutTracker.status
                if (st == WorkoutTracker.ST_SEARCH || st == WorkoutTracker.ST_RUN || st == WorkoutTracker.ST_PAUSE) this.workout = true
            }
            else -> {}
        }
    }

    // ---------- старты (из CardTimers / MusicPlayer / WorkoutTracker) ----------

    fun onTimerStart(ctx: Context, id: String) = synchronized(LOCK) {
        load(ctx)
        val changed = if (collecting()) timers.add(id) else timers.remove(id)
        if (changed) saveTimers()
    }

    fun onMusicStart() = synchronized(LOCK) {
        music = collecting()
    }

    fun onWorkoutBegin() = synchronized(LOCK) {
        if (collecting() || System.currentTimeMillis() < expectWorkoutUntil) {
            workout = true
            expectWorkoutUntil = 0L
        } else {
            workout = false
        }
    }

    // ---------- состав: вопросы и выходы ----------

    fun isTimerMember(ctx: Context, id: String): Boolean = synchronized(LOCK) {
        load(ctx)
        timers.contains(id)
    }

    fun isMusicMember(): Boolean = synchronized(LOCK) { music }

    /** Таймер ушёл сам (сработал) или остановлен без остановки группы. */
    fun timerGone(ctx: Context, id: String) = synchronized(LOCK) {
        load(ctx)
        if (timers.remove(id)) saveTimers()
    }

    fun leaveMusic() = synchronized(LOCK) { music = false }

    fun leaveWorkout() = synchronized(LOCK) { workout = false }

    // ---------- действия пользователя: пауза / продолжить / стоп ----------

    fun onTimerPaused(ctx: Context, id: String) {
        val s = snapIf(ctx, Src.TIMER, id) ?: return
        pauseOthers(s, Src.TIMER, id)
    }

    fun onTimerResumed(ctx: Context, id: String) {
        val s = snapIf(ctx, Src.TIMER, id) ?: return
        resumeOthers(s, Src.TIMER, id)
    }

    /** «Стоп»/«Отмена» таймера: останавливает всю группу и распускает её. */
    fun onTimerStopped(ctx: Context, id: String) {
        val s = snapIf(ctx, Src.TIMER, id)
        timerGone(ctx, id)
        if (s != null) stopOthers(s, Src.TIMER, id)
    }

    fun onMusicPaused() {
        val s = snapIf(null, Src.MUSIC, null) ?: return
        pauseOthers(s, Src.MUSIC, null)
    }

    fun onMusicResumed() {
        val s = snapIf(null, Src.MUSIC, null) ?: return
        resumeOthers(s, Src.MUSIC, null)
    }

    fun onMusicClosed() {
        val s = snapIf(null, Src.MUSIC, null) ?: return
        stopOthers(s, Src.MUSIC, null)
    }

    fun onWorkoutPaused() {
        val s = snapIf(null, Src.WORKOUT, null) ?: return
        pauseOthers(s, Src.WORKOUT, null)
    }

    fun onWorkoutResumed() {
        val s = snapIf(null, Src.WORKOUT, null) ?: return
        resumeOthers(s, Src.WORKOUT, null)
    }

    fun onWorkoutStopped() {
        val s = snapIf(null, Src.WORKOUT, null) ?: return
        stopOthers(s, Src.WORKOUT, null)
    }

    // ---------- рассылка остальным участникам ----------

    private fun pauseOthers(s: Snap, src: Src, id: String?) {
        if (src != Src.MUSIC && s.music) MusicPlayer.groupPause()
        if (src != Src.WORKOUT && s.workout) WorkoutTracker.groupPause(s.ctx)
        for (t in s.timers) if (!(src == Src.TIMER && t == id)) CardTimers.pause(s.ctx, t, false)
    }

    private fun resumeOthers(s: Snap, src: Src, id: String?) {
        if (src != Src.MUSIC && s.music) MusicPlayer.groupResume()
        if (src != Src.WORKOUT && s.workout) WorkoutTracker.groupResume(s.ctx)
        for (t in s.timers) if (!(src == Src.TIMER && t == id)) CardTimers.resume(s.ctx, t, false)
    }

    private fun stopOthers(s: Snap, src: Src, id: String?) {
        synchronized(LOCK) { clearLocked() } // группа распущена до остановок: их собственные вызовы её уже не трогают
        if (src != Src.MUSIC && s.music) MusicPlayer.groupClose()
        if (src != Src.WORKOUT && s.workout) WorkoutTracker.groupStop(s.ctx)
        for (t in s.timers) if (!(src == Src.TIMER && t == id)) CardTimers.cancel(s.ctx, t, false)
    }
}
