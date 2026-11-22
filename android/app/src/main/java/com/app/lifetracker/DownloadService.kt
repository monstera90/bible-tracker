package com.app.lifetracker
// Версия: 1.1 (22.11) — этап 4: место записи выбирает `DownloadTarget.newWorkFile(app, t)`; итог переноса ([DownloadTarget.Saved]) — в `targetLabel`/`targetNote`. Откат: DownloadService.kt 1.0.
// Версия: 1.0 (21.11) — ТЗ «скачивание файлов» (TZ_downloads.md 1.1), этап 1.

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkRequest
import android.net.NetworkCapabilities
import android.os.Build
import android.os.IBinder
import android.os.PowerManager
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat
import java.util.concurrent.ConcurrentHashMap

/**
 * Служба переднего плана скачивания (ТЗ 5.6). Планировщик раз в 0,5 с: запускает задачи из очереди (не больше
 * [FileDownloads.MAX_PARALLEL] сразу; обновления приложения — вне очереди, первыми), считает скорость, убирает «Готово» через
 * несколько секунд, будит плашку острова в фоне ([InAppIsland.ensureBackground]) и останавливает службу, когда делать нечего.
 *
 * Уведомление у службы минимальное (обязательное для службы переднего плана): без звука и кнопок, один текст «Скачивание файлов».
 * Вся видимая информация — в плавающем острове. Тип службы — specialUse (не dataSync: на Android 15+ он ограничен ~6 часами в сутки).
 * Потеря сети — `WAITING_NET`, продолжение само при возвращении сети. Убийство процесса — `START_STICKY`, [FileDownloads.restore].
 */
class DownloadService : Service() {

    companion object {
        private const val CHANNEL = "downloads"
        private const val NOTIFICATION_ID = 11
        private const val TICK_MS = 500L
        private const val WAKE_MS = 15L * 60L * 1000L

        /** Движки идущих задач: через них пауза и отмена рвут открытые соединения. */
        val engines = ConcurrentHashMap<Long, DownloadEngine>()

        @Volatile
        var active = false

        /** Запустить (или не мешать уже запущенной) службе. Любая ошибка не мешает остальному приложению. */
        fun ensure(ctx: Context) {
            try {
                val i = Intent(ctx.applicationContext, DownloadService::class.java)
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) ctx.applicationContext.startForegroundService(i) else ctx.applicationContext.startService(i)
            } catch (e: Exception) {
                // запуск из фона не разрешён: задачи подхватятся при следующем запуске службы
            }
        }

        /** Есть ли связь (по данным системы; при сомнении — считаем, что есть). */
        @Suppress("DEPRECATION")
        fun online(ctx: Context): Boolean = try {
            val cm = ctx.applicationContext.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
            val n = cm.activeNetworkInfo
            n == null || n.isConnected
        } catch (e: Exception) {
            true
        }
    }

    private val speeds = ConcurrentHashMap<Long, DownloadLogic.SpeedMeter>()
    private var loop: Thread? = null

    @Volatile
    private var running = false
    private var wake: PowerManager.WakeLock? = null
    private var wakeAt = 0L
    private var netCb: ConnectivityManager.NetworkCallback? = null

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (!enterForeground()) {
            stopSelf()
            return START_NOT_STICKY
        }
        active = true
        FileDownloads.restore(applicationContext) // процесс перезапущен системой: поднимаем записанные задачи (один раз за жизнь процесса)
        registerNet()
        if (!running) {
            running = true
            loop = Thread({ schedule() }, "dl-scheduler").also {
                it.isDaemon = true
                it.start()
            }
        }
        return START_STICKY
    }

    override fun onDestroy() {
        running = false
        active = false
        unregisterNet()
        setWake(false)
        super.onDestroy()
    }

    // ---------- уведомление ----------

    private fun enterForeground(): Boolean = try {
        val n = notification()
        if (Build.VERSION.SDK_INT >= 34) {
            ServiceCompat.startForeground(this, NOTIFICATION_ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE)
        } else {
            startForeground(NOTIFICATION_ID, n)
        }
        true
    } catch (e: Exception) {
        false
    }

    private fun notification(): Notification {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            val ch = NotificationChannel(CHANNEL, "Скачивание файлов", NotificationManager.IMPORTANCE_LOW)
            ch.setShowBadge(false)
            ch.enableVibration(false)
            ch.setSound(null, null)
            nm.createNotificationChannel(ch)
        }
        return NotificationCompat.Builder(this, CHANNEL)
            .setSmallIcon(R.drawable.ic_stat_notify)
            .setContentTitle("Скачивание файлов")
            .setPriority(NotificationCompat.PRIORITY_MIN)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setSilent(true)
            .build()
    }

    // ---------- связь ----------

    private fun registerNet() {
        if (netCb != null) return
        try {
            val cm = getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
            val cb = object : ConnectivityManager.NetworkCallback() {
                override fun onAvailable(network: Network) {
                    // связь вернулась: ждавшие сети задачи встают в очередь и продолжают с места остановки
                    for (t in FileDownloads.all()) if (t.state == DlState.WAITING_NET) t.state = DlState.QUEUED
                }
            }
            cm.registerNetworkCallback(NetworkRequest.Builder().addCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET).build(), cb)
            netCb = cb
        } catch (e: Exception) {
            // без колбэка задачи вернёт из ожидания планировщик (раз в несколько секунд проверяет связь)
        }
    }

    private fun unregisterNet() {
        val cb = netCb ?: return
        netCb = null
        try {
            (getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager).unregisterNetworkCallback(cb)
        } catch (e: Exception) {
        }
    }

    private fun setWake(on: Boolean) {
        try {
            if (on) {
                val now = System.currentTimeMillis()
                if (wake == null) {
                    val pm = getSystemService(Context.POWER_SERVICE) as PowerManager
                    wake = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "lifetracker:downloads").also { it.setReferenceCounted(false) }
                }
                if (now - wakeAt > WAKE_MS / 3) { // продлеваем, не накапливая
                    wake?.acquire(WAKE_MS)
                    wakeAt = now
                }
            } else if (wake?.isHeld == true) {
                wake?.release()
                wakeAt = 0L
            }
        } catch (e: Exception) {
        }
    }

    // ---------- планировщик ----------

    private fun schedule() {
        val app = applicationContext
        var idle = 0
        var netCheckAt = 0L
        while (running) {
            try {
                val now = System.currentTimeMillis()
                val all = FileDownloads.all()
                // скорость: скользящее среднее за ~3 с
                for (t in all) {
                    if (t.state == DlState.RUNNING) {
                        val m = speeds.getOrPut(t.id) { DownloadLogic.SpeedMeter() }
                        m.add(now, t.doneBytes)
                        t.speed = m.perSec()
                    } else {
                        t.speed = 0L
                    }
                }
                // «Готово» висит несколько секунд, потом задача исчезает; у скрытых из острова — сразу
                for (t in all) {
                    if (t.state == DlState.DONE && (!t.showInIsland || now - t.finishedAt >= FileDownloads.DONE_HOLD_MS)) {
                        FileDownloads.remove(t)
                        speeds.remove(t.id)
                    }
                }
                // колбэк связи мог не сработать: раз в 3 секунды проверяем сами
                if (now - netCheckAt > 3000L) {
                    netCheckAt = now
                    if (online(app)) for (t in all) if (t.state == DlState.WAITING_NET) t.state = DlState.QUEUED
                }
                // запуск из очереди: обновления приложения первыми, дальше по порядку создания
                val busy = all.count { it.state == DlState.RUNNING }
                var free = FileDownloads.MAX_PARALLEL - busy
                if (free > 0) {
                    val queued = all.filter { it.state == DlState.QUEUED && it.control == DownloadTask.CTL_RUN }
                        .sortedWith(compareBy<DownloadTask>({ if (it.source == DlSource.USER) 1 else 0 }, { it.id }))
                    for (t in queued) {
                        if (free <= 0) break
                        t.state = DlState.RUNNING
                        free--
                        Thread({ runTask(t) }, "dl-" + t.id).also {
                            it.isDaemon = true
                            it.start()
                        }
                    }
                }
                val anyRunning = all.any { it.state == DlState.RUNNING }
                setWake(anyRunning)
                if (FileDownloads.all().any { it.showInIsland }) InAppIsland.ensureBackground(app)
                if (FileDownloads.needsService(now)) idle = 0 else if (++idle > 3) {
                    running = false
                    stopSelf()
                    return
                }
            } catch (e: Exception) {
                // планировщик не должен падать из-за одной задачи
            }
            try { Thread.sleep(TICK_MS) } catch (e: InterruptedException) { return }
        }
    }

    // ---------- одна задача ----------

    private fun runTask(t: DownloadTask) {
        val app = applicationContext
        var engine: DownloadEngine? = null
        try {
            if (!t.probed) {
                val pre = DownloadEngine.prepare(t) { online(app) }
                if (pre != null) {
                    t.state = DlState.WAITING_NET
                    return
                }
            }
            var work = t.work
            if (work == null) {
                work = DownloadTarget.newWorkFile(app, t)
                t.work = work
            }
            FileDownloads.persist(app)
            val e = DownloadEngine(t, work) { online(app) }
            engine = e
            engines[t.id] = e
            when (e.run()) {
                DlOutcome.DONE -> finish(t, e, work)
                DlOutcome.PAUSED -> {
                    t.state = DlState.PAUSED
                    t.speed = 0L
                }
                DlOutcome.CANCELED -> {
                    e.cleanup()
                    t.state = DlState.CANCELED
                    FileDownloads.remove(t)
                }
                DlOutcome.NET_LOST -> t.state = if (online(app)) DlState.QUEUED else DlState.WAITING_NET
                DlOutcome.FAILED -> t.state = DlState.FAILED
            }
        } catch (ex: Exception) {
            t.error = DownloadEngine.describe(ex)
            t.state = DlState.FAILED
        } finally {
            engines.remove(t.id)
            // команда «пауза/отмена» пришла между запуском и остановкой движка
            if (t.state == DlState.RUNNING) t.state = DlState.FAILED
            FileDownloads.persist(app)
        }
    }

    /** Закачка завершена: проверка (для обновлений), перенос в «Загрузки», «Готово». */
    private fun finish(t: DownloadTask, e: DownloadEngine, work: java.io.File) {
        val verify = t.verify
        if (verify != null) {
            val err = try { verify(work) } catch (ex: Exception) { "Файл не прошёл проверку" }
            if (err != null) {
                e.cleanup()
                t.error = err
                t.state = DlState.FAILED
                return
            }
        }
        try {
            t.copying = true
            val saved = DownloadTarget.commit(applicationContext, t, work)
            t.targetLabel = saved.label
            t.targetNote = saved.note
            e.cleanup()
            t.copying = false
            t.finishedAt = System.currentTimeMillis()
            t.state = DlState.DONE
        } catch (ex: Exception) {
            t.copying = false
            t.error = ex.message?.takeIf { it.isNotBlank() } ?: "Не удалось сохранить файл"
            t.state = DlState.FAILED
        }
    }
}
