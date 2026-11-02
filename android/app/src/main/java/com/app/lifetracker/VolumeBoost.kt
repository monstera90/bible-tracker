package com.app.lifetracker
// Версия: 2.0 (02.11)

import android.content.Context
import android.media.AudioDeviceCallback
import android.media.AudioDeviceInfo
import android.media.AudioManager
import android.media.AudioPlaybackConfiguration
import android.media.audiofx.LoudnessEnhancer
import android.os.Build
import android.os.Handler
import android.os.Looper
import org.json.JSONObject
import kotlin.math.log10
import kotlin.math.roundToInt

/**
 * «Усиление громкости в системе» (вкладка «Система», мост версии 20).
 *
 * Как у приложений-усилителей: один [LoudnessEnhancer] на аудиосессии 0 — это общий микс всего звука телефона, поэтому
 * усиливается звук любых приложений, а не только этого. Коэффициент 125/150/200 % — по амплитуде: усиление в милли-
 * децибелах = 2000·log10(pct/100) (125 % → 194 мБ, 150 % → 352 мБ, 200 % → 602 мБ). 100 % — эффекта нет совсем.
 *
 * ⚠️ Эффекты на сессии 0 с Android 9–10 помечены устаревшими: на части прошивок система их не применяет или не отдаёт
 * управление. Тогда [lastError] не пустой, а `works` в [stateJson] — false; страница показывает причину.
 * Эффект на сессии 0 цепляется к тому аудиовыходу, который играл в момент создания, поэтому его пересоздаём при смене
 * выхода (наушники, Bluetooth, экран) и когда начинает играть новый плеер (`startWatch`: AudioPlaybackCallback,
 * AudioDeviceCallback, Android 8+). Без этого «включено», а звук не меняется.
 * Эффект живёт, пока жив процесс, поэтому при усилении > 100 % работает служба переднего плана [VolumeBoostService]
 * (она же раз в 15 с проверяет, что эффект не сброшен системой, и поднимает его заново). Выбранный процент хранится в
 * SharedPreferences `volume_boost` и поднимается после перезагрузки (`NotifyReceiver`) и при входе в приложение.
 */
object VolumeBoost {
    private const val PREFS = "volume_boost"
    private const val KEY_PCT = "pct"
    val ALLOWED = intArrayOf(100, 125, 150, 200)

    @Volatile private var enhancer: LoudnessEnhancer? = null
    private var appCtx: Context? = null
    private var playbackCb: AudioManager.AudioPlaybackCallback? = null
    private var deviceCb: AudioDeviceCallback? = null
    private var lastPlayers = 0
    private val handler = Handler(Looper.getMainLooper())
    private val rebuildRun = Runnable { rebuild() }
    @Volatile var lastError: String = ""
        private set

    fun saved(ctx: Context): Int {
        val p = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getInt(KEY_PCT, 100)
        return if (ALLOWED.contains(p)) p else 100
    }

    private fun gainMb(pct: Int): Int = (2000.0 * log10(pct / 100.0)).roundToInt()

    /** Применить процент: сохранить, поднять/снять эффект и службу. Возвращает состояние (как [stateJson]). */
    @Synchronized
    fun set(ctx: Context, pct: Int): String {
        val app = ctx.applicationContext
        val want = if (ALLOWED.contains(pct)) pct else 100
        app.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putInt(KEY_PCT, want).apply()
        if (want == 100) {
            stopWatch(app)
            release()
            lastError = ""
            VolumeBoostService.stop(app)
        } else {
            ensure(app)
            VolumeBoostService.start(app)
        }
        return stateJson(app)
    }

    /** Из сохранённого значения: при загрузке телефона и входе в приложение. */
    fun restore(ctx: Context) {
        val app = ctx.applicationContext
        if (saved(app) > 100) {
            ensure(app)
            VolumeBoostService.start(app)
        }
    }

    /** Эффект должен быть включён на сохранённый процент; если он потерян или сброшен системой — создаём заново. */
    @Synchronized
    fun ensure(ctx: Context): Boolean {
        val pct = saved(ctx)
        if (pct <= 100) {
            stopWatch(ctx.applicationContext)
            release()
            return true
        }
        startWatch(ctx.applicationContext)
        try {
            var e = enhancer
            if (e != null) {
                val alive = try { e.enabled && e.hasControl() } catch (t: Throwable) { false }
                if (!alive) {
                    release()
                    e = null
                }
            }
            if (e == null) {
                e = LoudnessEnhancer(0)
                enhancer = e
            }
            e.setTargetGain(gainMb(pct))
            e.enabled = true
            e.setTargetGain(gainMb(pct))
            if (!e.hasControl()) {
                lastError = "система не отдала управление общим звуком"
                return false
            }
            lastError = ""
            return true
        } catch (t: Throwable) {
            release()
            lastError = (t.message ?: t.javaClass.simpleName)
            return false
        }
    }

    private fun scheduleRebuild() {
        handler.removeCallbacks(rebuildRun)
        handler.postDelayed(rebuildRun, 400)
    }

    /** Эффект создаётся заново: он привязан к выходу, игравшему при создании. */
    @Synchronized
    private fun rebuild() {
        val c = appCtx ?: return
        if (saved(c) <= 100) return
        release()
        ensure(c)
    }

    @Synchronized
    private fun startWatch(ctx: Context) {
        appCtx = ctx
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        try {
            val am = ctx.getSystemService(Context.AUDIO_SERVICE) as AudioManager
            if (playbackCb == null) {
                val cb = object : AudioManager.AudioPlaybackCallback() {
                    override fun onPlaybackConfigChanged(configs: MutableList<AudioPlaybackConfiguration>) {
                        val n = configs.size
                        val more = n > lastPlayers
                        lastPlayers = n
                        if (more) scheduleRebuild()
                    }
                }
                am.registerAudioPlaybackCallback(cb, handler)
                playbackCb = cb
            }
            if (deviceCb == null) {
                val dc = object : AudioDeviceCallback() {
                    override fun onAudioDevicesAdded(added: Array<out AudioDeviceInfo>?) = scheduleRebuild()
                    override fun onAudioDevicesRemoved(removed: Array<out AudioDeviceInfo>?) = scheduleRebuild()
                }
                am.registerAudioDeviceCallback(dc, handler)
                deviceCb = dc
            }
        } catch (t: Throwable) {
            // без наблюдателей остаётся проверка раз в 15 с
        }
    }

    @Synchronized
    private fun stopWatch(ctx: Context) {
        handler.removeCallbacks(rebuildRun)
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        try {
            val am = ctx.getSystemService(Context.AUDIO_SERVICE) as AudioManager
            playbackCb?.let { am.unregisterAudioPlaybackCallback(it) }
            deviceCb?.let { am.unregisterAudioDeviceCallback(it) }
        } catch (t: Throwable) {
            // уже снято
        }
        playbackCb = null
        deviceCb = null
        lastPlayers = 0
    }

    @Synchronized
    fun release() {
        try {
            enhancer?.enabled = false
        } catch (t: Throwable) {
            // уже снят
        }
        try {
            enhancer?.release()
        } catch (t: Throwable) {
            // уже снят
        }
        enhancer = null
    }

    /** {"pct":150,"works":true,"error":""} — works: эффект сейчас реально включён и управляется. */
    fun stateJson(ctx: Context): String {
        val pct = saved(ctx)
        val works = pct <= 100 || (try { enhancer?.let { it.enabled && it.hasControl() } ?: false } catch (t: Throwable) { false })
        return JSONObject().put("pct", pct).put("works", works).put("error", lastError).toString()
    }
}
