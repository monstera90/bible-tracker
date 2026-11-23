package com.app.lifetracker
// Версия: 1.4 (23.11) — разведка не удалась (размер не получен из-за ошибки) — сразу «В N потоков»: движок при старте разведает файл заново и сам выберет способ; окно только если сервер определённо не отдаёт диапазоны или размер не сообщает. Откат: DownloadLauncher.kt 1.3.
// Версия: 1.3 (23.11) — окно «Обычное / В N потоков» показывается только если многопоточное скачивание недоступно (сервер без диапазонов, размер неизвестен, разведка не удалась); иначе сразу «В N потоков» ([DownloadLogic.canAutoMulti]). Откат: DownloadLauncher.kt 1.2.
// Версия: 1.2 (22.11) — этап 2 (Flibusta, 6.2): [startForPage] — скачивание по запросу страницы (мост `downloadStart`): разведка, то же окно «Обычное / В N потоков», задача с `handoffId`. Откат: DownloadLauncher.kt 1.1.
// Версия: 1.1 (22.11) — этап 6 (6.6): [handlePage] — `data:` и `blob:` со вкладок-сайтов и Claude сохраняет приложение ([PageDownloads]), http/https — прежний путь. Откат: DownloadLauncher.kt 1.0.
// Версия: 1.0 (21.11) — ТЗ «скачивание файлов» (TZ_downloads.md 1.1), этап 1: общий обработчик скачивания для вкладок-сайтов, вкладки Claude и главного WebView (раздел 6.1, 6.4).

import android.app.Activity
import android.app.AlertDialog
import android.webkit.CookieManager
import android.webkit.WebView
import android.widget.Toast

/**
 * Запуск скачивания из WebView. Один код на все места (UserTabs, ClaudeTab, MainActivity), чтобы не копировать его.
 * [handle] — только `http` / `https`. [handlePage] — для WebView вкладок-сайтов и Claude: `data:` и `blob:` уходят в [PageDownloads] (этап 6), остальное — в [handle].
 *
 * Порядок: заголовки (cookie, User-Agent, Referer) → разведка в фоне (имя и размер) → если сервер отдаёт файл частями, сразу
 * «В N потоков»; иначе окно «Обычное / В N потоков / Отмена» → задача в [FileDownloads] и служба.
 * Если разведка не удалась — окно показывается, а причину покажет остров.
 */
object DownloadLauncher {

    /**
     * Обработчик скачивания для WebView вкладок-сайтов и Claude: `data:` и `blob:` сохраняет приложение ([PageDownloads]), http/https — [handle].
     * @return true — адрес принят; false — другая схема (вызывающий решает сам, как и раньше).
     */
    fun handlePage(
        activity: MainActivity,
        view: WebView,
        url: String?,
        userAgent: String?,
        contentDisposition: String?,
        mimeType: String?,
        referer: String?,
        originTab: String
    ): Boolean {
        if (PageDownloads.isPageUrl(url)) {
            PageDownloads.start(activity, view, url!!, contentDisposition, mimeType)
            return true
        }
        return handle(activity, url, userAgent, contentDisposition, mimeType, referer, originTab)
    }

    /**
     * @return true — адрес принят (скачивание начнётся после выбора способа); false — адрес не http/https, обработчик ничего не сделал.
     */
    fun handle(
        activity: Activity,
        url: String?,
        userAgent: String?,
        contentDisposition: String?,
        mimeType: String?,
        referer: String?,
        originTab: String
    ): Boolean {
        val u = url?.trim() ?: return false
        if (!u.startsWith("http://", ignoreCase = true) && !u.startsWith("https://", ignoreCase = true)) return false
        val headers = LinkedHashMap<String, String>()
        try {
            val ck = CookieManager.getInstance().getCookie(u)
            if (!ck.isNullOrBlank()) headers["Cookie"] = ck
        } catch (e: Exception) {
            // без cookie: публичные файлы скачаются, закрытые — нет
        }
        if (!userAgent.isNullOrBlank()) headers["User-Agent"] = userAgent
        if (!referer.isNullOrBlank() && (referer.startsWith("http://") || referer.startsWith("https://"))) headers["Referer"] = referer
        Toast.makeText(activity, "Проверяем файл…", Toast.LENGTH_SHORT).show()
        Thread({
            val p = DownloadEngine.probe(u, headers)
            val name = DownloadLogic.pickFileName(p.contentDisposition ?: contentDisposition, u, p.mime.ifEmpty { mimeType ?: "" })
            activity.runOnUiThread {
                if (!activity.isFinishing) showChoice(activity, u, headers, name, p, originTab)
            }
        }, "dl-probe").also {
            it.isDaemon = true
            it.start()
        }
        return true
    }

    /**
     * Скачивание по запросу страницы (Flibusta, ТЗ 6.2): те же разведка и окно выбора способа, но результат не «Загрузки», а страница
     * ([PageHandoff]). [name] — имя, которое выбрала страница (название книги + расширение); пусто — имя даст сервер.
     * Закрыли окно или нажали «Отмена» — запрос получает состояние «отменено».
     */
    fun startForPage(activity: MainActivity, url: String, name: String, referer: String?, req: PageHandoff.Req) {
        val headers = LinkedHashMap<String, String>()
        if (!referer.isNullOrBlank() && (referer.startsWith("http://") || referer.startsWith("https://"))) headers["Referer"] = referer
        Toast.makeText(activity, "Проверяем файл…", Toast.LENGTH_SHORT).show()
        Thread({
            val p = DownloadEngine.probe(url, headers)
            val shown = name.ifEmpty { DownloadLogic.pickFileName(p.contentDisposition, url, p.mime) }
            activity.runOnUiThread {
                if (activity.isFinishing) {
                    req.state = HandoffLogic.CANCELED
                } else {
                    showChoice(activity, url, headers, shown, p, "", req)
                }
            }
        }, "dl-probe-page").also {
            it.isDaemon = true
            it.start()
        }
    }

    private fun showChoice(activity: Activity, url: String, headers: Map<String, String>, name: String, p: ProbeResult, originTab: String, req: PageHandoff.Req? = null) {
        val app = activity.applicationContext
        val threads = FileDownloads.threads(app)
        if (DownloadLogic.canAutoMulti(p.total, p.acceptRanges, p.error.isNotEmpty())) {
            // потоки доступны (или разведка не удалась — движок разведает заново) — выбирать нечего; маленький файл движок скачает одним куском
            start(app, url, headers, name, DlMode.MULTI, threads, originTab, p, req)
            return
        }
        val size = if (p.total >= 0) DownloadLogic.formatSize(p.total) else "размер неизвестен"
        val msg = StringBuilder(name).append('\n').append(size)
        if (p.total >= 0 && !p.acceptRanges) msg.append("\nСервер не поддерживает потоки: файл скачается обычным способом")
        if (p.error.isNotEmpty() && p.total < 0) msg.append('\n').append(p.error)
        try {
            AlertDialog.Builder(activity)
                .setTitle("Скачать файл")
                .setMessage(msg.toString())
                .setPositiveButton("Обычное") { _, _ -> start(app, url, headers, name, DlMode.SINGLE, threads, originTab, p, req) }
                .setNeutralButton("В " + DownloadLogic.threadsText(threads)) { _, _ -> start(app, url, headers, name, DlMode.MULTI, threads, originTab, p, req) }
                .setNegativeButton("Отмена") { _, _ -> req?.state = HandoffLogic.CANCELED }
                .setOnCancelListener { if (req != null && req.taskId == 0L) req.state = HandoffLogic.CANCELED }
                .show()
        } catch (e: Exception) {
            // окно показать не удалось (активность закрылась) — скачивание не начинаем
            req?.state = HandoffLogic.CANCELED
        }
    }

    /** Создаёт задачу; для запроса страницы запоминает её номер и помечает задачу `handoffId`. */
    private fun start(app: android.content.Context, url: String, headers: Map<String, String>, name: String, mode: DlMode, threads: Int, originTab: String, p: ProbeResult, req: PageHandoff.Req?) {
        if (req != null && req.state == HandoffLogic.CANCELED) return
        val t = FileDownloads.enqueue(app, url, headers, name, mode, threads, originTab, p, handoffId = req?.id ?: "")
        if (req != null) req.taskId = t.id // состояние «идёт» страница получает из [HandoffLogic.state]: служба могла успеть закончить раньше этой строки
    }
}
