package com.app.lifetracker
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

    @Volatile
    var playing = false
        private set

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

    private var queue: List<Track> = emptyList()
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
        return f
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
            active = true
            failStreak = 0
            floatPending = true
            startTrack(idx)
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
            if (active && index + 1 < queue.size) startTrack(index + 1)
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
        if (index + 1 < queue.size) startTrack(index + 1) else closeNow()
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
            AudioManager.AUDIOFOCUS_LOSS_TRANSIENT_CAN_DUCK -> setVolume(0.3f)
            AudioManager.AUDIOFOCUS_GAIN -> {
                setVolume(1f)
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
