package com.app.lifetracker
// Версия: 1.4 (22.11) — этап 3 (системный остров Xiaomi, ТЗ 8): уведомление службы несёт extras острова ([XiaomiIsland.downloadExtras], выбор занятия — [SystemIslandLogic]); кнопки «Пауза/Продолжить/Повторить» и «Стоп» приходят в службу; нажатие на остров открывает вкладку-источник. Откат: DownloadService.kt 1.3.
// Версия: 1.3 (22.11) — этап 2 (Flibusta, 6.2): [finishHandoff] — готовую книгу отдаём странице ([PageHandoff]), в «Загрузки» не кладём; копия в папку «Книги», если включена. Откат: DownloadService.kt 1.2.
// Версия: 1.2 (22.11) — этап 5: завершение обновлений (`task.dest`): [UpdateChecks.placeAndVerify], копия APK в папку обновлений, без «Загрузок». Откат: DownloadService.kt 1.1.
// Версия: 1.1 (22.11) — этап 4: место записи выбирает `DownloadTarget.newWorkFile(app, t)`; итог переноса ([DownloadTarget.Saved]) — в `targetLabel`/`targetNote`. Откат: DownloadService.kt 1.0.
// Версия: 1.0 (21.11) — ТЗ «скачивание файлов» (TZ_downloads.md 1.1), этап 1.

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
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
 * Вся видимая информация — в плавающем острове. На Xiaomi с включённым системным островом это же уведомление несёт его extras
 * ([XiaomiIsland.downloadExtras]): одна старшая загрузка и «+N» (ТЗ 8); без острова уведомление остаётся минимальным. Тип службы — specialUse (не dataSync: на Android 15+ он ограничен ~6 часами в сутки).
 * Потеря сети — `WAITING_NET`, продолжение само при возвращении сети. Убийство процесса — `START_STICKY`, [FileDownloads.restore].
 */
class DownloadService : Service() {

    companion object {
        private const val CHANNEL = "downloads"
        private const val NOTIFICATION_ID = 11
        private const val TICK_MS = 500L
        private const val WAKE_MS = 15L * 60L * 1000L

        // кнопки системного острова (ТЗ 8): служба получает их как команды над задачей `EXTRA_ID`
        private const val ACTION_PAUSE = "com.app.lifetracker.download.PAUSE"
        private const val ACTION_RESUME = "com.app.lifetracker.download.RESUME"
        private const val ACTION_RETRY = "com.app.lifetracker.download.RETRY"
        private const val ACTION_STOP = "com.app.lifetracker.download.STOP"
        private const val EXTRA_ID = "dlId"
        private const val POST_MIN_MS = 1000L // уведомление с островом обновляем не чаще раза в секунду

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

    // что показано в системном острове сейчас (читает и пишет поток службы/планировщика; в onStartCommand — главный, но до старта планировщика)
    @Volatile private var shownSig = ""
    @Volatile private var shownId = -1L
    @Volatile private var postedAt = 0L
    private var channelReady = false

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        // кнопка острова: команда над задачей (до обновления уведомления, чтобы оно уже отразило результат)
        val id = intent?.getLongExtra(EXTRA_ID, -1L) ?: -1L
        if (id >= 0L) {
            when (intent?.action) {
                ACTION_PAUSE -> FileDownloads.pause(applicationContext, id)
                ACTION_RESUME -> FileDownloads.resume(applicationContext, id)
                ACTION_RETRY -> FileDownloads.retry(applicationContext, id)
                ACTION_STOP -> FileDownloads.cancel(applicationContext, id)
            }
        }
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
        val n = notification(true)
        if (Build.VERSION.SDK_INT >= 34) {
            ServiceCompat.startForeground(this, NOTIFICATION_ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE)
        } else {
            startForeground(NOTIFICATION_ID, n)
        }
        true
    } catch (e: Exception) {
        false
    }

    private fun ensureChannel() {
        if (channelReady || Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        val ch = NotificationChannel(CHANNEL, "Скачивание файлов", NotificationManager.IMPORTANCE_LOW)
        ch.setShowBadge(false)
        ch.enableVibration(false)
        ch.setSound(null, null)
        nm.createNotificationChannel(ch)
        channelReady = true
    }

    /**
     * Уведомление службы. [first] — служба только что перешла на передний план: подпись острова сбрасывается, он всплывает заново.
     * Без Xiaomi / при выключенном системном острове [XiaomiIsland.downloadExtras] вернёт null — уведомление минимальное.
     */
    private fun notification(first: Boolean = false): Notification {
        ensureChannel()
        val app = applicationContext
        val info = try { SystemIslandLogic.info(FileDownloads.islandTasks()) } catch (e: Exception) { null }
        val b = NotificationCompat.Builder(this, CHANNEL)
            .setSmallIcon(R.drawable.ic_stat_notify)
            .setContentTitle("Скачивание файлов")
            .setPriority(NotificationCompat.PRIORITY_MIN)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setSilent(true)
        var sig = ""
        if (info != null) {
            val float = first || info.taskId != shownId
            val toggle = when (info.toggle) {
                SystemIslandLogic.TOGGLE_PAUSE -> actionIntent(app, ACTION_PAUSE, info.taskId)
                SystemIslandLogic.TOGGLE_RESUME -> actionIntent(app, ACTION_RESUME, info.taskId)
                SystemIslandLogic.TOGGLE_RETRY -> actionIntent(app, ACTION_RETRY, info.taskId)
                else -> null
            }
            val stop = if (info.kind == SystemIslandLogic.KIND_DONE) null else actionIntent(app, ACTION_STOP, info.taskId)
            val island = XiaomiIsland.downloadExtras(app, info, float, toggle, stop)
            if (island != null) {
                b.addExtras(island)
                b.setContentTitle(info.name)
                b.setContentText(info.sub)
                b.setContentIntent(openApp(app, FileDownloads.find(info.taskId)?.originTab ?: ""))
                sig = info.signature()
                shownId = info.taskId
            }
        }
        if (sig.isEmpty()) shownId = -1L
        shownSig = sig
        postedAt = System.currentTimeMillis()
        return b.build()
    }

    /** Кнопка острова: команда службе над задачей [id] (у каждой пары «действие + задача» свой PendingIntent). */
    private fun actionIntent(ctx: Context, action: String, id: Long): PendingIntent {
        val i = Intent(ctx, DownloadService::class.java).setAction(action).putExtra(EXTRA_ID, id)
        val code = (action.hashCode() * 31 + id).toInt()
        val flags = Compat.pendingFlags()
        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            PendingIntent.getForegroundService(ctx, code, i, flags)
        } else {
            PendingIntent.getService(ctx, code, i, flags)
        }
    }

    /** Нажатие на остров/уведомление: приложение вперёд, сразу на вкладку-источник (если она известна). */
    private fun openApp(ctx: Context, tab: String): PendingIntent {
        val i = Intent(ctx, MainActivity::class.java)
        if (tab.isNotEmpty()) {
            i.action = MainActivity.ACTION_OPEN_TAB
            i.putExtra(MainActivity.EXTRA_TAB, tab)
        }
        i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_REORDER_TO_FRONT or Intent.FLAG_ACTIVITY_SINGLE_TOP)
        return PendingIntent.getActivity(ctx, 6010, i, Compat.pendingFlags())
    }

    /** Системный остров: пересобрать уведомление, если показанное изменилось (не чаще раза в секунду; смена занятия или вид — сразу). */
    private fun refreshIsland(now: Long) {
        try {
            val app = applicationContext
            val info = if (XiaomiIsland.available(app)) SystemIslandLogic.info(FileDownloads.islandTasks(now)) else null
            val want = info?.signature() ?: ""
            if (want == shownSig) return
            val sameTask = info != null && info.taskId == shownId
            if (sameTask && shownSig.isNotEmpty() && now - postedAt < POST_MIN_MS) return // тот же файл, меняется только число
            val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            nm.notify(NOTIFICATION_ID, notification())
        } catch (e: Exception) {
            // остров не должен мешать скачиванию
        }
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
                refreshIsland(now)
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
        val dest = t.dest
        if (dest != null) { // обновление приложения или веб-части: файл на место, проверка по итоговому пути, в «Загрузки» не попадает
            val err = UpdateChecks.placeAndVerify(work, dest, t.verify)
            if (err != null) {
                e.cleanup()
                t.error = err
                t.state = DlState.FAILED
                return
            }
            var saved = DownloadTarget.Saved("", "")
            if (t.source == DlSource.APP_UPDATE) {
                t.copying = true
                saved = try { DownloadTarget.copyUpdate(applicationContext, t, dest) } catch (ex: Exception) { DownloadTarget.Saved("", DownloadTarget.NOTE_UPDATE_COPY_LOST) }
                t.copying = false
            }
            t.targetLabel = saved.label
            t.targetNote = saved.note
            e.cleanup()
            t.finishedAt = System.currentTimeMillis()
            t.state = DlState.DONE
            return
        }
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
        if (t.handoffId.isNotEmpty()) {
            finishHandoff(t, e, work)
            return
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

    /**
     * Книга для страницы (Flibusta): готовый файл переименовывается в `<id запроса>.bin` и ждёт, пока страница заберёт его по `./__dl/<id>`;
     * в «Загрузки» не кладётся. Если включена папка для этого типа файлов — туда уходит копия. Занятие в острове — «Готово · → Книги».
     */
    private fun finishHandoff(t: DownloadTask, e: DownloadEngine, work: java.io.File) {
        val req = PageHandoff.get(t.handoffId)
        if (req == null || req.state == HandoffLogic.CANCELED) { // страница отказалась или процесс пересоздан: файл не нужен
            e.cleanup()
            t.state = DlState.CANCELED
            FileDownloads.remove(t)
            return
        }
        try {
            t.copying = true
            val dest = java.io.File(work.parentFile, t.handoffId + ".bin")
            try { dest.delete() } catch (ex: Exception) { }
            if (!work.renameTo(dest)) {
                work.inputStream().use { i -> dest.outputStream().use { o -> i.copyTo(o, 1 shl 16) } }
                try { work.delete() } catch (ex: Exception) { }
            }
            val saved = try { DownloadTarget.copyBook(applicationContext, t, dest) } catch (ex: Exception) { DownloadTarget.Saved("", DownloadTarget.NOTE_UPDATE_COPY_LOST) }
            t.targetLabel = if (saved.label.isNotEmpty()) "Книги и " + saved.label else "Книги"
            t.targetNote = saved.note
            e.cleanup()
            t.copying = false
            req.file = dest
            req.state = HandoffLogic.DONE // страница увидит это при следующем опросе и заберёт файл
            t.finishedAt = System.currentTimeMillis()
            t.state = DlState.DONE
        } catch (ex: Exception) {
            t.copying = false
            t.error = ex.message?.takeIf { it.isNotBlank() } ?: "Не удалось подготовить файл"
            t.state = DlState.FAILED
        }
    }
}
