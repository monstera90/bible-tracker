package com.app.lifetracker
// Версия: 1.0 (25.10)

import android.content.Context
import android.media.AudioAttributes
import android.media.AudioFormat
import android.media.AudioManager
import android.media.AudioTrack
import android.net.Uri
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.ParcelFileDescriptor
import android.os.PowerManager
import java.io.FileInputStream
import java.nio.ByteBuffer

/**
 * Проигрывание ALAC (.m4a/.alac): система Android этот кодек не декодирует, поэтому файл разбирает [AlacMp4], пакеты
 * декодирует [AlacDecoder], а звук идёт в [AudioTrack] из отдельного потока. Если в .m4a окажется не ALAC (например AAC),
 * вызывается [Callback.onNotAlac] и вызывающий код отдаёт файл системному MediaPlayer. Все колбэки приходят в главном потоке.
 * Перемотки нет (пока не нужна): играет по порядку, пауза/продолжение/остановка.
 */
class AlacEngine(private val ctx: Context, private val uri: Uri, private val cb: Callback) {

    interface Callback {
        fun onNotAlac()
        fun onCompleted()
        fun onError(msg: String)
    }

    private val main = Handler(Looper.getMainLooper())

    @Volatile
    private var stopped = false

    @Volatile
    private var paused = false

    @Volatile
    private var volume = 1f

    @Volatile
    private var track: AudioTrack? = null

    private var thread: Thread? = null

    /** Запуск; [startPaused] — открыть файл, но звук не включать до [resume]. */
    fun start(startPaused: Boolean) {
        paused = startPaused
        val t = Thread({ run() }, "alac-engine")
        thread = t
        t.start()
    }

    fun pause() {
        paused = true
        try {
            track?.pause()
        } catch (e: Exception) {
            // трек уже освобождён
        }
    }

    fun resume() {
        paused = false
        try {
            track?.play()
        } catch (e: Exception) {
            // трек уже освобождён
        }
    }

    fun setVolume(v: Float) {
        volume = v
        try {
            track?.setVolume(v)
        } catch (e: Exception) {
            // трек уже освобождён
        }
    }

    /** Остановка: поток сам освободит трек и файл. flush будит запись, если она ждёт места в буфере. */
    fun stop() {
        stopped = true
        paused = false
        try {
            val t = track
            if (t != null) {
                t.pause()
                t.flush()
            }
        } catch (e: Exception) {
            // трек уже освобождён
        }
    }

    private fun post(block: () -> Unit) {
        main.post { block() }
    }

    private fun run() {
        var pfd: ParcelFileDescriptor? = null
        var audio: AudioTrack? = null
        var wake: PowerManager.WakeLock? = null
        var finishedAll = false
        try {
            val pm = ctx.getSystemService(Context.POWER_SERVICE) as PowerManager
            wake = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "lifetracker:alac")
            wake.setReferenceCounted(false)

            pfd = ctx.contentResolver.openFileDescriptor(uri, "r")
            if (pfd == null) {
                post { cb.onError("Не удалось открыть файл") }
                return
            }
            val channel = FileInputStream(pfd.fileDescriptor).channel
            val source = object : AlacMp4.ByteSource {
                override fun length(): Long = channel.size()
                override fun readAt(pos: Long, dst: ByteArray, off: Int, len: Int): Int =
                    channel.read(ByteBuffer.wrap(dst, off, len), pos)
            }
            val mp4 = AlacMp4.parse(source)
            if (!mp4.alac) {
                if (!stopped) post { cb.onNotAlac() }
                return
            }
            val dec = AlacDecoder(mp4.config)

            val chCfg = if (dec.channels == 1) AudioFormat.CHANNEL_OUT_MONO else AudioFormat.CHANNEL_OUT_STEREO
            var useFloat = dec.bitDepth > 16
            audio = if (useFloat) makeTrack(dec.sampleRate, chCfg, AudioFormat.ENCODING_PCM_FLOAT, dec.channels) else null
            if (audio == null) {
                useFloat = false
                audio = makeTrack(dec.sampleRate, chCfg, AudioFormat.ENCODING_PCM_16BIT, dec.channels)
            }
            if (audio == null) {
                post { cb.onError("Не удалось открыть звуковой выход") }
                return
            }
            track = audio
            audio.setVolume(volume)

            val total = mp4.sampleOffset.size
            val packet = ByteArray(mp4.maxSampleSize)
            val samples = IntArray(dec.frameLength * dec.channels)
            val pcm16 = ShortArray(samples.size)
            val pcmF = FloatArray(samples.size)
            val depthShift = if (dec.bitDepth > 16) dec.bitDepth - 16 else 0
            val scale = 1f / (1L shl (dec.bitDepth - 1)).toFloat()

            var written = 0L
            var broken = 0
            var started = false
            var i = 0
            while (i < total && !stopped) {
                if (paused) {
                    if (wake.isHeld) wake.release()
                    while (paused && !stopped) Thread.sleep(30)
                    if (stopped) break
                }
                if (!wake.isHeld) wake.acquire()
                if (!started) {
                    audio.play()
                    started = true
                }

                val size = mp4.sampleSize[i]
                var got = 0
                while (got < size) {
                    val r = source.readAt(mp4.sampleOffset[i] + got, packet, got, size - got)
                    if (r <= 0) break
                    got += r
                }
                val frames = if (got == size) dec.decode(packet, 0, size, samples) else -1
                if (frames < 0) {
                    broken++
                    if (broken > 20) {
                        post { cb.onError("Файл повреждён") }
                        return
                    }
                    i++
                    continue
                }
                val count = frames * dec.channels
                if (useFloat) {
                    for (k in 0 until count) pcmF[k] = samples[k] * scale
                    var off = 0
                    while (off < count && !stopped) {
                        val w = audio.write(pcmF, off, count - off, AudioTrack.WRITE_BLOCKING)
                        if (w < 0) {
                            if (!stopped) post { cb.onError("Ошибка вывода звука ($w)") }
                            return
                        }
                        off += w
                    }
                } else {
                    for (k in 0 until count) pcm16[k] = (samples[k] shr depthShift).toShort()
                    var off = 0
                    while (off < count && !stopped) {
                        val w = audio.write(pcm16, off, count - off)
                        if (w < 0) {
                            if (!stopped) post { cb.onError("Ошибка вывода звука ($w)") }
                            return
                        }
                        off += w
                    }
                }
                written += frames
                i++
            }

            // дождаться, пока доиграет то, что уже в буфере
            if (!stopped) {
                var lastHead = -1L
                var lastMove = System.currentTimeMillis()
                while (!stopped) {
                    val head = audio.playbackHeadPosition.toLong() and 0xFFFFFFFFL
                    if (head >= written) break
                    val now = System.currentTimeMillis()
                    if (head != lastHead) {
                        lastHead = head
                        lastMove = now
                    } else if (!paused && now - lastMove > 3000) {
                        break
                    }
                    Thread.sleep(40)
                }
                finishedAll = !stopped
            }
        } catch (e: InterruptedException) {
            // остановка
        } catch (e: Exception) {
            if (!stopped) post { cb.onError("Ошибка: " + (e.message ?: e.javaClass.simpleName)) }
        } finally {
            track = null
            try {
                audio?.stop()
            } catch (e: Exception) {
                // не запускался
            }
            try {
                audio?.release()
            } catch (e: Exception) {
                // уже освобождён
            }
            try {
                pfd?.close()
            } catch (e: Exception) {
                // уже закрыт
            }
            try {
                if (wake != null && wake.isHeld) wake.release()
            } catch (e: Exception) {
                // уже отпущен
            }
            if (finishedAll) post { cb.onCompleted() }
        }
    }

    @Suppress("DEPRECATION")
    private fun makeTrack(rate: Int, chCfg: Int, enc: Int, channels: Int): AudioTrack? {
        return try {
            val min = AudioTrack.getMinBufferSize(rate, chCfg, enc)
            if (min <= 0) return null
            val frameBytes = channels * (if (enc == AudioFormat.ENCODING_PCM_FLOAT) 4 else 2)
            val size = maxOf(min * 2, rate / 4 * frameBytes) // не меньше ~250 мс звука
            val t = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                AudioTrack.Builder()
                    .setAudioAttributes(
                        AudioAttributes.Builder()
                            .setUsage(AudioAttributes.USAGE_MEDIA)
                            .setContentType(AudioAttributes.CONTENT_TYPE_MUSIC)
                            .build()
                    )
                    .setAudioFormat(
                        AudioFormat.Builder().setSampleRate(rate).setChannelMask(chCfg).setEncoding(enc).build()
                    )
                    .setBufferSizeInBytes(size)
                    .setTransferMode(AudioTrack.MODE_STREAM)
                    .build()
            } else {
                AudioTrack(AudioManager.STREAM_MUSIC, rate, chCfg, enc, size, AudioTrack.MODE_STREAM)
            }
            if (t.state != AudioTrack.STATE_INITIALIZED) {
                t.release()
                null
            } else {
                t
            }
        } catch (e: Exception) {
            null
        }
    }
}
