package com.app.lifetracker
// Версия: 4.1 (27.10) — `setPhoneVolume`: `FLAG_SHOW_UI` (панель громкости системы синхронизируется — кнопки громкости больше не «скачут» от прежнего положения) и проверка значения через 0,4 с с одним повтором.
// Версия: 4.0 (26.10) — структурная правка: учёт времени воспроизведения для «Трекера экранов» (`playing` копит отрезки в `ScreenTimeStats.MUSIC`, `livePlayingMs`).
// Версия: 3.0 (26.10) — структурная правка: `playSingle`/`playFolder` ставят громкость самого телефона (`setPhoneVolume`: поток STREAM_MUSIC, процент от максимума), громкость плеера остаётся 1.0; `headphonesConnected` — подключены ли наушники (проводные, USB, Bluetooth, слуховой аппарат).
// Версия: 2.0 (26.10) — структурная правка (QR «Комбинированный»): `playSingle` (один трек по id, без очереди папки) и `playFolder` (все треки папки по id), оба с зацикливанием (`loopTrack`/`loopQueue`) и начальной громкостью (`baseVolume`); `trackEnded` повторяет трек или очередь, если включено; «следующий» на последнем треке зацикленной папки идёт в начало; громкость после ослабления при звонке/навигаторе возвращается к `baseVolume`, а не к 1. Обычный `play` (вкладка «Музыка») сбрасывает зацикливание и громкость. Откат: MusicPlayer.kt 1.1.
// Версия: 1.1 (25.10) — остров не появлялся, если трек запущен из самого приложения (система прячет остров, пока приложение на экране, а перепоста при сворачивании не было): `onAppBackground` (зовёт MainActivity.onPause) перепоставляет уведомление и раскрывает остров, если раскрытие пришлось на время, когда приложение было на экране (`floatDeferred`). Откат: MusicPlayer.kt 1.0.
// Версия: 1.0 (25.10)

import android.content.Context
import android.media.AudioAttributes
import android.media.AudioFocusRequest
import android.media.AudioManager
import android.media.MediaPlayer
import android.net.Uri
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.PowerManager
import android.os.SystemClock
import org.json.JSONObject

/**
 * Плеер вкладки «Музыка»: очередь = звуковые файлы одной папки, по порядку списка. mp3/flac и прочее, что умеет система,
 * играет MediaPlayer; ALAC в .m4a/.alac — [AlacEngine]. Все изменения состояния идут в главном потоке; страница читает
 * [stateJson] раз в полсекунды, уведомление и остров обновляет [MusicService].
 */
object MusicPlayer {

    class Track(val id: String, val name: String, val uri: Uri)

    private val main = Handler(Looper.getMainLooper())
    private var app: Context? = null

    @Volatile
    var active = false
        private set

    // «Трекер экранов»: каждый отрезок, пока playing == true, копится в ScreenTimeStats.MUSIC (меняется только в главном потоке)
    private var playSince = 0L

    @Volatile
    var playing = false
        private set(value) {
            if (field != value) {
                val now = SystemClock.elapsedRealtime()
                if (value) {
                    playSince = now
                } else {
                    val ctx = app
                    if (ctx != null) ScreenTimeStats.add(ctx, ScreenTimeStats.MUSIC, now - playSince)
                }
            }
            field = value
        }

    /** Сколько длится идущий сейчас отрезок воспроизведения (для итога трекера), мс; 0, если не играет. */
    fun livePlayingMs(): Long = if (playing) (SystemClock.elapsedRealtime() - playSince).coerceAtLeast(0L) else 0L

    @Volatile
    var title = ""
        private set

    @Volatile
    var folderTitle = ""
        private set

    @Volatile
    private var index = 0

    @Volatile
    private var count = 0

    @Volatile
    private var trackId = ""

    @Volatile
    private var error = ""

    @Volatile
    private var floatPending = false

    @Volatile
    private var floatDeferred = false

    private var queue: List<Track> = emptyList()

    // зацикливание и начальная громкость от QR «Комбинированный»; обычный play() со вкладки «Музыка» их сбрасывает
    @Volatile
    private var loopTrack = false

    @Volatile
    private var loopQueue = false

    @Volatile
    private var baseVolume = 1f
    private var mp: MediaPlayer? = null
    private var mpPrepared = false
    private var alac: AlacEngine? = null
    private var gen = 0
    private var failStreak = 0
    private var resumeAfterFocus = false
    private var focusRequest: Any? = null

    /** Нужно ли раскрыть остров при ближайшем обновлении уведомления (один раз в начале воспроизведения). */
    fun consumeFloat(): Boolean {
        val f = floatPending
        floatPending = false
        // приложение на экране: система остров не показывает, раскрытие пропало впустую — повторим при сворачивании
        if (f && NotifyStore.appForeground) floatDeferred = true
        return f
    }

    /**
     * Приложение ушло с экрана (MainActivity.onPause): пока оно было на экране, остров плеера не показывался, поэтому
     * уведомление нужно перепоставить сразу — тогда остров появляется в шторке/у выреза, а если раскрытие прошло
     * впустую, он ещё и раскрывается. Без активной музыки ничего не делает.
     */
    fun onAppBackground(ctx: Context) {
        if (!active) return
        init(ctx)
        if (floatDeferred) {
            floatDeferred = false
            floatPending = true
        }
        MusicService.refresh(ctx.applicationContext)
    }

    private fun init(ctx: Context) {
        if (app == null) app = ctx.applicationContext
    }

    private fun audioAttrs(): AudioAttributes =
        AudioAttributes.Builder()
            .setUsage(AudioAttributes.USAGE_MEDIA)
            .setContentType(AudioAttributes.CONTENT_TYPE_MUSIC)
            .build()

    // ---------- команды (из моста, уведомления, острова) ----------

    /** Из потока моста: собирает очередь папки (чтение каталога) и запускает трек в главном потоке. */
    fun play(ctx: Context, folderId: String?, trackIdWanted: String, folderName: String): Boolean {
        init(ctx)
        val tree = MusicLibrary.treeUri(ctx) ?: return false
        val list = MusicLibrary.list(ctx, folderId) ?: return false
        val tracks = ArrayList<Track>()
        for (e in list) {
            if (!e.dir) tracks.add(Track(e.id, e.name, MusicLibrary.docUri(tree, e.id)))
        }
        val idx = tracks.indexOfFirst { it.id == trackIdWanted }
        if (idx < 0) return false
        main.post {
            queue = tracks
            folderTitle = folderName
            count = tracks.size
            loopTrack = false
            loopQueue = false
            baseVolume = 1f
            active = true
            failStreak = 0
            floatPending = true
            startTrack(idx)
        }
        return true
    }

    /** Громкость самого телефона (поток музыки), [pct] 0..100 от максимума; при pct > 0 не ниже первой ступени. */
    private fun setPhoneVolume(ctx: Context, pct: Int) {
        try {
            val am = ctx.getSystemService(Context.AUDIO_SERVICE) as AudioManager
            val max = am.getStreamMaxVolume(AudioManager.STREAM_MUSIC)
            val p = pct.coerceIn(0, 100)
            var idx = Math.round(max * p / 100f)
            if (p > 0 && idx < 1) idx = 1
            // FLAG_SHOW_UI: без него часть прошивок меняет сам поток, но не обновляет свою панель громкости — и первое нажатие
            // кнопок громкости отсчитывается от старого положения ползунка («было 70, поставили 50, нажали — скачет»).
            // С флагом панель коротко показывается и синхронизируется.
            am.setStreamVolume(AudioManager.STREAM_MUSIC, idx, AudioManager.FLAG_SHOW_UI)
            // система могла округлить/не принять значение (безопасная громкость, смена устройства вывода) — проверяем и повторяем один раз
            val want = idx
            main.postDelayed({
                try {
                    if (am.getStreamVolume(AudioManager.STREAM_MUSIC) != want) {
                        am.setStreamVolume(AudioManager.STREAM_MUSIC, want, AudioManager.FLAG_SHOW_UI)
                    }
                } catch (e: Exception) {
                }
            }, 400)
        } catch (e: Exception) {
        }
    }

    /** Подключены ли наушники: проводные, USB, Bluetooth (A2DP/SCO/LE), слуховой аппарат. Встроенный динамик не считается. */
    @Suppress("DEPRECATION")
    fun headphonesConnected(ctx: Context): Boolean {
        return try {
            val am = ctx.getSystemService(Context.AUDIO_SERVICE) as AudioManager
            if (Build.VERSION.SDK_INT >= 23) {
                // 3 проводная гарнитура, 4 проводные наушники, 7 Bluetooth SCO, 8 Bluetooth A2DP, 22 USB-гарнитура, 23 слуховой аппарат, 26 BLE-гарнитура, 27 BLE-динамик
                val types = intArrayOf(3, 4, 7, 8, 22, 23, 26, 27)
                am.getDevices(AudioManager.GET_DEVICES_OUTPUTS).any { d -> types.contains(d.type) }
            } else {
                am.isWiredHeadsetOn || am.isBluetoothA2dpOn
            }
        } catch (e: Exception) {
            false
        }
    }

    /** Из потока моста: играет ОДИН трек [trackIdWanted] (id документа), без остальных файлов папки; [loop] — повторять его, пока не закроют. [volumePct] 0..100 — громкость самого телефона (процент от максимума). */
    fun playSingle(ctx: Context, trackIdWanted: String, loop: Boolean, volumePct: Int): Boolean {
        init(ctx)
        val tree = MusicLibrary.treeUri(ctx) ?: return false
        val name = MusicLibrary.displayName(ctx, trackIdWanted) ?: return false
        if (!MusicLibrary.isAudio(name)) return false
        val one = listOf(Track(trackIdWanted, name, MusicLibrary.docUri(tree, trackIdWanted)))
        setPhoneVolume(ctx, volumePct)
        val vol = 1f
        main.post {
            queue = one
            folderTitle = ""
            count = 1
            loopTrack = loop
            loopQueue = false
            baseVolume = vol
            active = true
            failStreak = 0
            floatPending = true
            startTrack(0)
        }
        return true
    }

    /** Из потока моста: играет все звуковые файлы папки [folderId] (пустой — выбранная папка целиком) по порядку списка; [loop] — после последнего снова с первого. */
    fun playFolder(ctx: Context, folderId: String?, loop: Boolean, volumePct: Int): Boolean {
        init(ctx)
        val tree = MusicLibrary.treeUri(ctx) ?: return false
        val list = MusicLibrary.list(ctx, folderId) ?: return false
        val tracks = ArrayList<Track>()
        for (e in list) {
            if (!e.dir) tracks.add(Track(e.id, e.name, MusicLibrary.docUri(tree, e.id)))
        }
        if (tracks.isEmpty()) return false
        val folderName = MusicLibrary.displayName(ctx, folderId) ?: ""
        setPhoneVolume(ctx, volumePct)
        val vol = 1f
        main.post {
            queue = tracks
            folderTitle = folderName
            count = tracks.size
            loopTrack = false
            loopQueue = loop
            baseVolume = vol
            active = true
            failStreak = 0
            floatPending = true
            startTrack(0)
        }
        return true
    }

    fun toggle() {
        main.post {
            if (active) {
                if (playing) pauseNow() else resumeNow()
            }
        }
    }

    fun next() {
        main.post {
            if (!active) return@post
            if (index + 1 < queue.size) startTrack(index + 1)
            else if (loopQueue && queue.isNotEmpty()) startTrack(0)
        }
    }

    fun prev() {
        main.post {
            if (active) startTrack(if (index > 0) index - 1 else 0)
        }
    }

    fun close() {
        main.post { closeNow() }
    }

    /** JSON для страницы. */
    fun stateJson(): String =
        JSONObject()
            .put("active", active)
            .put("playing", playing)
            .put("title", title)
            .put("folder", folderTitle)
            .put("index", index)
            .put("count", count)
            .put("id", trackId)
            .put("error", error)
            .toString()

    // ---------- внутренняя работа (главный поток) ----------

    private fun startTrack(i: Int) {
        val ctx = app ?: return
        releaseEngine()
        if (i < 0 || i >= queue.size) {
            closeNow()
            return
        }
        index = i
        val t = queue[i]
        title = t.name.substringBeforeLast('.', t.name)
        trackId = t.id
        error = ""
        playing = true
        requestFocus(ctx)
        val myGen = ++gen
        if (isAlacCandidate(t.name)) {
            startAlac(ctx, t, myGen)
        } else {
            startPlatform(ctx, t, myGen)
        }
        MusicService.refresh(ctx)
    }

    private fun isAlacCandidate(name: String): Boolean {
        val e = MusicLibrary.ext(name)
        return e == "m4a" || e == "alac" || e == "mp4"
    }

    private fun startAlac(ctx: Context, t: Track, myGen: Int) {
        val engine = AlacEngine(ctx, t.uri, object : AlacEngine.Callback {
            override fun onNotAlac() {
                if (myGen == gen) startPlatform(ctx, t, myGen)
            }

            override fun onCompleted() {
                if (myGen == gen) trackEnded()
            }

            override fun onError(msg: String) {
                if (myGen == gen) trackFailed(msg)
            }
        })
        alac = engine
        engine.setVolume(baseVolume)
        engine.start(!playing)
    }

    private fun startPlatform(ctx: Context, t: Track, myGen: Int) {
        try {
            alac?.stop()
            alac = null
            val p = MediaPlayer()
            mp = p
            mpPrepared = false
            p.setAudioAttributes(audioAttrs())
            p.setVolume(baseVolume, baseVolume)
            p.setWakeMode(ctx, PowerManager.PARTIAL_WAKE_LOCK)
            p.setDataSource(ctx, t.uri)
            p.setOnPreparedListener { player ->
                if (myGen == gen) {
                    mpPrepared = true
                    if (playing) player.start()
                }
            }
            p.setOnCompletionListener {
                if (myGen == gen) trackEnded()
            }
            p.setOnErrorListener { _, what, extra ->
                if (myGen == gen) trackFailed("Не удалось воспроизвести (" + what + "/" + extra + ")")
                true
            }
            p.prepareAsync()
        } catch (e: Exception) {
            trackFailed("Не удалось воспроизвести: " + (e.message ?: e.javaClass.simpleName))
        }
    }

    private fun trackEnded() {
        failStreak = 0
        when {
            loopTrack -> startTrack(index)
            index + 1 < queue.size -> startTrack(index + 1)
            loopQueue && queue.isNotEmpty() -> startTrack(0)
            else -> closeNow()
        }
    }

    /** Трек не открылся: пробуем следующий; если дальше некуда или всё подряд не играет — остаёмся на треке с текстом ошибки. */
    private fun trackFailed(msg: String) {
        failStreak++
        if (index + 1 < queue.size && failStreak <= queue.size) {
            startTrack(index + 1)
            return
        }
        releaseEngine()
        playing = false
        error = msg
        val ctx = app
        if (ctx != null) MusicService.refresh(ctx)
    }

    private fun pauseNow() {
        playing = false
        resumeAfterFocus = false
        try {
            if (mpPrepared) mp?.pause()
        } catch (e: Exception) {
            // плеер уже освобождён
        }
        alac?.pause()
        val ctx = app
        if (ctx != null) MusicService.refresh(ctx)
    }

    private fun resumeNow() {
        val ctx = app ?: return
        if (mp == null && alac == null) {
            // после ошибки движка нет — запускаем текущий трек заново
            startTrack(index)
            return
        }
        playing = true
        requestFocus(ctx)
        try {
            if (mpPrepared) mp?.start()
        } catch (e: Exception) {
            // плеер уже освобождён
        }
        alac?.resume()
        MusicService.refresh(ctx)
    }

    private fun releaseEngine() {
        gen++
        val p = mp
        if (p != null) {
            try {
                p.setOnPreparedListener(null)
                p.setOnCompletionListener(null)
                p.setOnErrorListener(null)
                p.release()
            } catch (e: Exception) {
                // уже освобождён
            }
        }
        mp = null
        mpPrepared = false
        alac?.stop()
        alac = null
    }

    private fun closeNow() {
        releaseEngine()
        abandonFocus()
        active = false
        playing = false
        title = ""
        trackId = ""
        error = ""
        queue = emptyList()
        count = 0
        index = 0
        resumeAfterFocus = false
        floatPending = false
        floatDeferred = false
        loopTrack = false
        loopQueue = false
        baseVolume = 1f
        val ctx = app
        if (ctx != null) MusicService.stop(ctx)
    }

    /** Наушники отключили: сразу пауза (вызывает MusicService). */
    fun onNoisy() {
        main.post {
            if (active && playing) pauseNow()
        }
    }

    // ---------- звуковой фокус (звонок, другой плеер) ----------

    private val focusListener = AudioManager.OnAudioFocusChangeListener { change ->
        main.post { onFocusChange(change) }
    }

    private fun onFocusChange(change: Int) {
        if (!active) return
        when (change) {
            AudioManager.AUDIOFOCUS_LOSS -> {
                resumeAfterFocus = false
                if (playing) pauseNow()
            }
            AudioManager.AUDIOFOCUS_LOSS_TRANSIENT -> {
                if (playing) {
                    pauseNow()
                    resumeAfterFocus = true
                }
            }
            AudioManager.AUDIOFOCUS_LOSS_TRANSIENT_CAN_DUCK -> setVolume(baseVolume * 0.3f)
            AudioManager.AUDIOFOCUS_GAIN -> {
                setVolume(baseVolume)
                if (resumeAfterFocus) {
                    resumeAfterFocus = false
                    resumeNow()
                }
            }
        }
    }

    private fun setVolume(v: Float) {
        try {
            mp?.setVolume(v, v)
        } catch (e: Exception) {
            // плеер уже освобождён
        }
        alac?.setVolume(v)
    }

    @Suppress("DEPRECATION")
    private fun requestFocus(ctx: Context) {
        try {
            val am = ctx.getSystemService(Context.AUDIO_SERVICE) as AudioManager
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                val req = AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN)
                    .setAudioAttributes(audioAttrs())
                    .setOnAudioFocusChangeListener(focusListener)
                    .build()
                focusRequest = req
                am.requestAudioFocus(req)
            } else {
                am.requestAudioFocus(focusListener, AudioManager.STREAM_MUSIC, AudioManager.AUDIOFOCUS_GAIN)
            }
        } catch (e: Exception) {
            // без фокуса музыка всё равно играет
        }
    }

    @Suppress("DEPRECATION")
    private fun abandonFocus() {
        val ctx = app ?: return
        try {
            val am = ctx.getSystemService(Context.AUDIO_SERVICE) as AudioManager
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                val req = focusRequest
                if (req is AudioFocusRequest) am.abandonAudioFocusRequest(req)
            } else {
                am.abandonAudioFocus(focusListener)
            }
        } catch (e: Exception) {
            // ничего
        }
        focusRequest = null
    }
}
