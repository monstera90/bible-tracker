package com.app.lifetracker
// Версия: 1.0 (21.11) — ТЗ «скачивание файлов» (TZ_downloads.md 1.1), этап 1.

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.atomic.AtomicLong

/**
 * Состояние всех скачиваний процесса и команды над ними (пауза, продолжить, отмена, повтор). Движок работает в [DownloadService];
 * остров ([InAppIsland]) раз в 0,5 с читает [islandTasks]. Списка или истории скачанного нет и не будет (решение заказчика):
 * «Готово» держится несколько секунд ([DONE_HOLD_MS]) и задача исчезает.
 *
 * Настройка «потоков по умолчанию» (2–8, по умолчанию 4) хранится на устройстве (SharedPreferences «downloads»), в облако и экспорт не входит.
 */
object FileDownloads {

    const val MAX_PARALLEL = 3 // одновременно качается не больше задач (остальные — в очереди)
    const val DONE_HOLD_MS = 4000L // сколько секунд занятие «Готово» висит в острове

    private const val PREFS = "downloads"
    private const val KEY_THREADS = "threads"
    private const val KEY_TASKS = "tasks"

    private val list = CopyOnWriteArrayList<DownloadTask>()
    private val seq = AtomicLong(System.currentTimeMillis())

    @Volatile
    private var cachedThreads = 0

    private var restored = false // записанные задачи уже подняты в этом процессе

    private fun prefs(ctx: Context) = ctx.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    // ---------- настройка ----------

    fun threads(ctx: Context): Int {
        if (cachedThreads in DownloadLogic.MIN_THREADS..DownloadLogic.MAX_THREADS) return cachedThreads
        val v = prefs(ctx).getInt(KEY_THREADS, DownloadLogic.DEFAULT_THREADS).coerceIn(DownloadLogic.MIN_THREADS, DownloadLogic.MAX_THREADS)
        cachedThreads = v
        return v
    }

    fun setThreads(ctx: Context, n: Int): Int {
        val v = n.coerceIn(DownloadLogic.MIN_THREADS, DownloadLogic.MAX_THREADS)
        cachedThreads = v
        prefs(ctx).edit().putInt(KEY_THREADS, v).apply()
        return v
    }

    // ---------- список ----------

    fun all(): List<DownloadTask> = list.toList()

    fun find(id: Long): DownloadTask? = list.firstOrNull { it.id == id }

    internal fun remove(t: DownloadTask) {
        list.remove(t)
    }

    /**
     * Задачи для острова по времени старта (раньше начатая выше). Показываются те, у кого `showInIsland`: идущие, ожидающие, на паузе,
     * с ошибкой и только что завершённые (первые [DONE_HOLD_MS] мс).
     */
    fun islandTasks(now: Long = System.currentTimeMillis()): List<DownloadTask> =
        list.filter {
            it.showInIsland && when (it.state) {
                DlState.DONE -> now - it.finishedAt < DONE_HOLD_MS
                DlState.CANCELED -> false
                else -> true
            }
        }.sortedBy { it.id }

    /** Есть ли задачи, ради которых службе надо жить (идут, ждут, на паузе, «Готово» ещё висит). Ошибки службу не держат. */
    fun needsService(now: Long = System.currentTimeMillis()): Boolean =
        list.any {
            when (it.state) {
                DlState.QUEUED, DlState.RUNNING, DlState.PAUSED, DlState.WAITING_NET -> true
                DlState.DONE -> it.showInIsland && now - it.finishedAt < DONE_HOLD_MS
                else -> false
            }
        }

    // ---------- создание ----------

    /**
     * Ставит новую задачу в очередь и запускает службу. [probe] — результат разведки, если она уже была (диалог выбора способа);
     * `null` — движок разведает сам (обновления).
     */
    fun enqueue(
        ctx: Context,
        url: String,
        headers: Map<String, String>,
        fileName: String,
        mode: DlMode,
        threads: Int,
        originTab: String,
        probe: ProbeResult? = null,
        source: DlSource = DlSource.USER,
        silent: Boolean = false,
        showInIsland: Boolean = true,
        verify: ((File) -> String?)? = null
    ): DownloadTask {
        restore(ctx) // сначала поднять записанные прежним процессом задачи, иначе запись ниже их затрёт
        val t = DownloadTask(seq.incrementAndGet(), url, headers)
        t.fileName = fileName
        t.mode = mode
        t.threads = threads.coerceIn(DownloadLogic.MIN_THREADS, DownloadLogic.MAX_THREADS)
        t.originTab = originTab
        t.source = source
        t.silent = silent
        t.showInIsland = showInIsland
        t.verify = verify
        t.startedAt = System.currentTimeMillis()
        if (probe != null) {
            t.totalBytes = probe.total
            t.supportsRange = probe.acceptRanges && probe.total > 0
            t.etag = probe.etag
            t.probed = probe.error.isEmpty()
        }
        t.category = DownloadTarget.categoryOf(fileName)
        list.add(t)
        persist(ctx)
        DownloadService.ensure(ctx)
        return t
    }

    // ---------- команды ----------

    /** Пауза: только если сервер отдаёт диапазоны ([DownloadTask.canPause]). */
    fun pause(ctx: Context, id: Long) {
        val t = find(id) ?: return
        if (!t.canPause) return
        t.control = DownloadTask.CTL_PAUSE
        if (t.state == DlState.RUNNING) {
            DownloadService.engines[id]?.stop()
        } else {
            t.state = DlState.PAUSED
        }
        persist(ctx)
    }

    fun resume(ctx: Context, id: Long) {
        val t = find(id) ?: return
        if (t.state != DlState.PAUSED) return
        t.control = DownloadTask.CTL_RUN
        t.state = DlState.QUEUED
        persist(ctx)
        DownloadService.ensure(ctx)
    }

    /** Повтор после ошибки: докачка с того места, где остановились (если сервер позволяет). */
    fun retry(ctx: Context, id: Long) {
        val t = find(id) ?: return
        if (t.state != DlState.FAILED) return
        t.error = ""
        t.control = DownloadTask.CTL_RUN
        t.state = DlState.QUEUED
        persist(ctx)
        DownloadService.ensure(ctx)
    }

    /** Отмена без подтверждения: временные файлы удаляются целиком. */
    fun cancel(ctx: Context, id: Long) {
        val t = find(id) ?: return
        t.control = DownloadTask.CTL_CANCEL
        if (t.state == DlState.RUNNING) {
            DownloadService.engines[id]?.stop() // служба сама уберёт файлы и задачу, когда движок остановится
        } else {
            deleteFiles(t)
            t.state = DlState.CANCELED
            list.remove(t)
        }
        persist(ctx)
    }

    /** Убрать из острова: «Готово» или ошибку (недокачанное удаляется). */
    fun dismiss(ctx: Context, id: Long) {
        val t = find(id) ?: return
        if (t.state == DlState.FAILED) deleteFiles(t)
        if (t.state == DlState.DONE || t.state == DlState.FAILED) {
            list.remove(t)
            persist(ctx)
        }
    }

    internal fun deleteFiles(t: DownloadTask) {
        val w = t.work ?: return
        try { w.delete() } catch (e: Exception) { }
        try { File(w.path + ".json").delete() } catch (e: Exception) { }
    }

    // ---------- сохранение между запусками процесса (ТЗ 5.6) ----------

    /** Записывает незавершённые задачи: после убийства процесса служба поднимает их ([restore]). Только «живые»: идут, в очереди, на паузе, ждут сеть. */
    fun persist(ctx: Context) {
        try {
            val arr = JSONArray()
            for (t in list) {
                if (t.source != DlSource.USER || t.work == null) continue
                if (t.state != DlState.QUEUED && t.state != DlState.RUNNING && t.state != DlState.PAUSED && t.state != DlState.WAITING_NET) continue
                val h = JSONObject()
                for ((k, v) in t.headers) h.put(k, v)
                arr.put(
                    JSONObject().put("id", t.id).put("url", t.url).put("headers", h).put("name", t.fileName)
                        .put("multi", t.mode == DlMode.MULTI).put("threads", t.threads).put("total", t.totalBytes)
                        .put("range", t.supportsRange).put("etag", t.etag).put("origin", t.originTab)
                        .put("work", t.work?.path ?: "").put("paused", t.state == DlState.PAUSED).put("started", t.startedAt)
                )
            }
            prefs(ctx).edit().putString(KEY_TASKS, arr.toString()).apply()
        } catch (e: Exception) {
            // без записи задачи просто не переживут убийство процесса
        }
    }

    /**
     * Поднимает записанные задачи после перезапуска процесса: нужен ещё живой недокачанный файл. Остальное (файла нет) выбрасывается
     * вместе со служебным файлом. Вызывается один раз за жизнь процесса (службой и при создании первой задачи).
     */
    @Synchronized
    fun restore(ctx: Context) {
        if (restored) return
        restored = true
        try {
            val arr = JSONArray(prefs(ctx).getString(KEY_TASKS, "[]") ?: "[]")
            for (i in 0 until arr.length()) {
                val o = arr.getJSONObject(i)
                val work = File(o.optString("work"))
                if (!work.exists()) {
                    try { File(work.path + ".json").delete() } catch (e: Exception) { }
                    continue
                }
                val hs = LinkedHashMap<String, String>()
                val ho = o.optJSONObject("headers")
                if (ho != null) for (k in ho.keys()) hs[k] = ho.optString(k)
                if (list.any { it.id == o.getLong("id") }) continue
                val t = DownloadTask(o.getLong("id"), o.getString("url"), hs)
                t.fileName = o.optString("name", "file")
                t.mode = if (o.optBoolean("multi")) DlMode.MULTI else DlMode.SINGLE
                t.threads = o.optInt("threads", DownloadLogic.DEFAULT_THREADS)
                t.totalBytes = o.optLong("total", -1L)
                t.supportsRange = o.optBoolean("range")
                t.etag = o.optString("etag")
                t.originTab = o.optString("origin")
                t.probed = t.totalBytes >= 0
                t.work = work
                t.startedAt = o.optLong("started", System.currentTimeMillis())
                t.category = DownloadTarget.categoryOf(t.fileName)
                if (o.optBoolean("paused")) {
                    t.control = DownloadTask.CTL_PAUSE
                    t.state = DlState.PAUSED
                    t.done.set(work.length().coerceAtLeast(0L))
                }
                list.add(t)
            }
        } catch (e: Exception) {
            // повреждённая запись — начинаем с чистого списка
        }
    }
}
