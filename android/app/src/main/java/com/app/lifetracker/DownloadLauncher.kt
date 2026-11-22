package com.app.lifetracker
// Версия: 1.0 (21.11) — ТЗ «скачивание файлов» (TZ_downloads.md 1.1), этап 1: общий обработчик скачивания для вкладок-сайтов, вкладки Claude и главного WebView (раздел 6.1, 6.4).

import android.app.Activity
import android.app.AlertDialog
import android.webkit.CookieManager
import android.widget.Toast

/**
 * Запуск скачивания из WebView. Один код на все места (UserTabs, ClaudeTab, MainActivity), чтобы не копировать его.
 * Только `http` / `https`: `blob:` и `data:` приходят на этапе 6 — до него вызывающий оставляет прежний путь.
 *
 * Порядок: заголовки (cookie, User-Agent, Referer) → разведка в фоне (имя и размер) → окно «Обычное / В N потоков / Отмена» →
 * задача в [FileDownloads] и служба. Если разведка не удалась — окно всё равно показывается, а причину покажет остров.
 */
object DownloadLauncher {

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

    private fun showChoice(activity: Activity, url: String, headers: Map<String, String>, name: String, p: ProbeResult, originTab: String) {
        val app = activity.applicationContext
        val threads = FileDownloads.threads(app)
        val size = if (p.total >= 0) DownloadLogic.formatSize(p.total) else "размер неизвестен"
        val msg = StringBuilder(name).append('\n').append(size)
        if (p.total >= 0 && !p.acceptRanges) msg.append("\nСервер не поддерживает потоки: файл скачается обычным способом")
        if (p.error.isNotEmpty() && p.total < 0) msg.append('\n').append(p.error)
        try {
            AlertDialog.Builder(activity)
                .setTitle("Скачать файл")
                .setMessage(msg.toString())
                .setPositiveButton("Обычное") { _, _ -> FileDownloads.enqueue(app, url, headers, name, DlMode.SINGLE, threads, originTab, p) }
                .setNeutralButton("В " + DownloadLogic.threadsText(threads)) { _, _ -> FileDownloads.enqueue(app, url, headers, name, DlMode.MULTI, threads, originTab, p) }
                .setNegativeButton("Отмена", null)
                .show()
        } catch (e: Exception) {
            // окно показать не удалось (активность закрылась) — скачивание не начинаем
        }
    }
}
