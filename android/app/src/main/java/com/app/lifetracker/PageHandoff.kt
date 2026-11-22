package com.app.lifetracker
// Версия: 1.0 (22.11) — ТЗ «скачивание файлов» (TZ_downloads.md 1.1), этап 2 (раздел 6.2): передача готового файла странице (Flibusta → библиотека «Книги»), вариант (а).

import android.content.Context
import org.json.JSONObject
import java.io.File
import java.security.SecureRandom
import java.util.concurrent.ConcurrentHashMap

/**
 * Чистая логика состояния запроса страницы (без Android — проверяется JVM-тестом).
 * Состояния для страницы: asking (идёт разведка / окно «Обычное / В N потоков»), running (качается, стоит в очереди, пауза, ждёт сеть),
 * done (файл готов: страница забирает его по `./__dl/<id>`), failed (ошибка — причина в карточке острова и в ответе), canceled (отмена в окне или в острове).
 */
object HandoffLogic {
    const val ASKING = "asking"
    const val RUNNING = "running"
    const val DONE = "done"
    const val FAILED = "failed"
    const val CANCELED = "canceled"

    /**
     * @param reqState состояние самого запроса (его ставят окно выбора и служба при завершении)
     * @param hasTask задача уже создана (после выбора способа)
     * @param task состояние задачи; null при `hasTask` — задачу убрали из списка (отмена в острове)
     */
    fun state(reqState: String, hasTask: Boolean, task: DlState?): String {
        if (reqState == DONE || reqState == CANCELED || reqState == FAILED) return reqState
        if (!hasTask) return ASKING
        return when (task) {
            null -> CANCELED
            DlState.CANCELED -> CANCELED
            DlState.FAILED -> FAILED
            else -> RUNNING // DONE без reqState=done — служба ещё передаёт файл
        }
    }

    /** Фаза для подписи на странице: queued / running / paused / waiting (нет сети) / copying; пусто — нет задачи. */
    fun phase(task: DlState?): String = when (task) {
        DlState.QUEUED -> "queued"
        DlState.RUNNING -> "running"
        DlState.PAUSED -> "paused"
        DlState.WAITING_NET -> "waiting"
        else -> ""
    }
}

/**
 * Запросы скачивания, которые запустила страница (мост `downloadStart`): сейчас — Flibusta. Скачивает общий движок ([FileDownloads]),
 * ход виден в острове; по завершении готовый файл лежит в `files/dlhandoff/<id>.bin`, страница забирает его по `https://localhost/__dl/<id>`
 * (WebAssetServer) и сама кладёт в библиотеку «Книги». Файл остаётся, пока страница не вызвала `downloadRelease`; забытые удаляются через сутки.
 * В «Загрузки» такой файл не попадает; копия в папку категории «Книги» (если пользователь её включил) — [DownloadTarget.copyBook].
 */
object PageHandoff {

    private const val DIR = "dlhandoff"
    private const val STALE_MS = 24L * 60L * 60L * 1000L

    class Req(val id: String) {
        @Volatile var state = HandoffLogic.ASKING
        @Volatile var taskId = 0L
        @Volatile var error = ""
        @Volatile var name = ""
        @Volatile var file: File? = null
        val created = System.currentTimeMillis()
    }

    private val reqs = ConcurrentHashMap<String, Req>()
    private val rnd = SecureRandom()

    fun dir(ctx: Context): File = File(ctx.filesDir, DIR).also { if (!it.isDirectory) it.mkdirs() }

    fun create(ctx: Context, name: String): Req {
        sweep(ctx)
        val b = ByteArray(12)
        rnd.nextBytes(b)
        val id = b.joinToString("") { "%02x".format(it) }
        val r = Req(id)
        r.name = name
        reqs[id] = r
        return r
    }

    fun get(id: String?): Req? = if (id.isNullOrEmpty()) null else reqs[id]

    /** Готовый файл для страницы или null (чужой id, не готов, уже забран). */
    fun file(id: String): File? {
        val r = reqs[id] ?: return null
        if (r.state != HandoffLogic.DONE) return null
        val f = r.file ?: return null
        return if (f.isFile) f else null
    }

    /** Ответ страницы на опрос: состояние, прогресс, причина ошибки. */
    fun statusJson(id: String?): String {
        val r = get(id) ?: return JSONObject().put("ok", false).put("error", "Запрос не найден").toString()
        val t = if (r.taskId != 0L) FileDownloads.find(r.taskId) else null
        val st = HandoffLogic.state(r.state, r.taskId != 0L, t?.state)
        val o = JSONObject().put("ok", true).put("state", st).put("name", r.name)
        if (t != null) {
            o.put("phase", HandoffLogic.phase(t.state)).put("done", t.doneBytes).put("total", t.totalBytes)
                .put("pct", DownloadLogic.percent(t.doneBytes, t.totalBytes)).put("threads", t.activeThreads)
        }
        if (st == HandoffLogic.FAILED) o.put("error", r.error.ifEmpty { t?.error ?: "" }.ifEmpty { "Ошибка скачивания" })
        return o.toString()
    }

    /** Отмена (окно выбора закрыто, пользователь передумал): задача снимается, файлы удаляются. */
    fun cancel(ctx: Context, id: String?) {
        val r = get(id) ?: return
        if (r.state == HandoffLogic.DONE) { release(ctx, id); return }
        r.state = HandoffLogic.CANCELED
        if (r.taskId != 0L) FileDownloads.cancel(ctx, r.taskId)
    }

    /** Страница закончила с запросом (забрала файл или показала ошибку): файл удаляется, карточка с ошибкой убирается из острова. */
    fun release(ctx: Context, id: String?) {
        val r = id?.let { reqs.remove(it) } ?: return
        try { r.file?.delete() } catch (e: Exception) { }
        if (r.taskId != 0L) {
            val t = FileDownloads.find(r.taskId)
            if (t != null && (t.state == DlState.FAILED || t.state == DlState.DONE)) FileDownloads.dismiss(ctx, r.taskId)
        }
    }

    /** Удаляет забытые файлы передачи старше суток (после убийства процесса запросы теряются, а файлы остаются). */
    fun sweep(ctx: Context) {
        try {
            val now = System.currentTimeMillis()
            dir(ctx).listFiles()?.forEach { f ->
                if (!f.name.endsWith(".bin")) return@forEach // .part живых задач не трогаем
                val live = reqs.values.any { it.file?.absolutePath == f.absolutePath }
                if (!live && now - f.lastModified() > STALE_MS) f.delete()
            }
            reqs.values.removeAll { now - it.created > STALE_MS }
        } catch (e: Exception) {
            // не критично
        }
    }
}
