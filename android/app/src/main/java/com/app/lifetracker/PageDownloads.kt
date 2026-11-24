package com.app.lifetracker
// Версия: 1.1 (24.11) — `fetchBlobBytes`: тот же канал, но байты собираются в памяти (автокоммит fix.zip, AutoCommit). Откат: PageDownloads.kt 1.0.
// Версия: 1.0 (22.11) — ТЗ «скачивание файлов» (TZ_downloads.md 1.1), этап 6 (6.6): сохранение `data:` и `blob:` со вкладок-сайтов и вкладки Claude внутри приложения, без внешнего браузера.

import android.net.Uri
import android.os.Build
import android.os.Handler
import android.os.HandlerThread
import android.os.Looper
import android.os.SystemClock
import android.util.Base64
import android.webkit.WebMessage
import android.webkit.WebMessagePort
import android.webkit.WebView
import android.widget.Toast
import androidx.annotation.RequiresApi
import org.json.JSONObject
import java.security.SecureRandom

/**
 * Файлы, которые сайт отдаёт ссылкой `data:` или `blob:` ([DownloadLauncher.handlePage] вызывается из `setDownloadListener`).
 * Остров не показываем (сохранение быстрое): итог — короткое сообщение «Сохранено → <куда>» либо причина ошибки.
 * Куда класть файл, решает [FileSaver.beginSave] → [DownloadTarget.resolve] (папки по типам, раздел 13), как у файлов вкладок инструментов.
 *
 * `data:` — разбирается здесь же ([PageDownloadLogic.parseDataUrl]), страница не нужна.
 *
 * `blob:` живёт внутри страницы, поэтому файл читает сама страница. Мост приложения (`LifeTrackerNative`) сайтам не открывается и
 * постоянных объектов в чужой странице не появляется. Вместо этого на каждую загрузку — одноразовый канал:
 *  1. приложение создаёт пару портов ([WebView.createWebMessageChannel]) и случайный токен;
 *  2. в страницу выполняется скрипт [PageDownloadLogic.blobScript]: он ждёт одно сообщение с этим токеном;
 *  3. после того как скрипт установлен, приложение шлёт странице токен и второй порт (`postWebMessage`, источник — страница-владелец ссылки);
 *  4. страница читает `blob:` и отдаёт кусками по порту, приложение подтверждает каждый кусок (протокол — в [PageDownloadLogic]).
 * Сайт, подслушавший сообщение, получает лишь порт, в который можно писать только эту одну загрузку (приложение принимает данные
 * только для задачи с этим токеном и закрывает порт по окончании). Новой зависимости не нужно: это платформенный API (Android 6.0+).
 * На Android 5.x `blob:` не поддерживается — показывается сообщение.
 */
object PageDownloads {

    private const val SILENCE_MS = 25_000L

    private val main = Handler(Looper.getMainLooper())
    private val random = SecureRandom()

    /** Поток записи на диск: порты вызывают приложение отсюда, а не из главного потока. */
    private val worker: Handler by lazy {
        val t = HandlerThread("page-dl")
        t.start()
        Handler(t.looper)
    }

    fun isPageUrl(url: String?): Boolean {
        val u = url?.trim() ?: return false
        return u.startsWith("data:", ignoreCase = true) || u.startsWith("blob:", ignoreCase = true)
    }

    /** Вызывается из главного потока (слушатель скачивания). Возвращает сразу: работа идёт в фоне. */
    fun start(activity: MainActivity, view: WebView, url: String, contentDisposition: String?, mimeType: String?) {
        val u = url.trim()
        if (u.startsWith("data:", ignoreCase = true)) {
            startData(activity, u, contentDisposition, mimeType)
        } else if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            startBlob(activity, view, u, contentDisposition, mimeType)
        } else {
            toast(activity, "Не удалось сохранить файл: на этой версии Android нельзя забрать файл со страницы (blob:)")
        }
    }

    // ---------- data: ----------

    private fun startData(activity: MainActivity, url: String, contentDisposition: String?, mimeType: String?) {
        val saver = activity.fileSaver
        worker.post {
            val d = try { PageDownloadLogic.parseDataUrl(url) } catch (e: Exception) { null }
            if (d == null) {
                toast(activity, "Не удалось сохранить файл: ссылка data: повреждена")
            } else {
                val name = PageDownloadLogic.pageFileName(contentDisposition, d.mime.ifEmpty { mimeType ?: "" })
                val id = saver.beginSave(name)
                if (id.isEmpty()) {
                    toast(activity, "Не удалось сохранить файл: запись не началась")
                } else {
                    var ok = true
                    var off = 0
                    while (ok && off < d.bytes.size) {
                        val end = minOf(off + PageDownloadLogic.CHUNK_BYTES, d.bytes.size)
                        ok = saver.append(id, Base64.encodeToString(d.bytes, off, end - off, Base64.NO_WRAP))
                        off = end
                    }
                    if (ok) reportFinished(activity, saver.finish(id)) else toast(activity, "Не удалось сохранить файл: запись сорвалась")
                }
            }
        }
    }

    // ---------- blob: ----------

    @RequiresApi(Build.VERSION_CODES.M)
    private fun startBlob(activity: MainActivity, view: WebView, blobUrl: String, contentDisposition: String?, mimeType: String?) {
        try {
            val ports = view.createWebMessageChannel()
            val token = newToken()
            val job = BlobJob(activity, ports[0], contentDisposition, mimeType)
            ports[0].setWebMessageCallback(object : WebMessagePort.WebMessageCallback() {
                override fun onMessage(port: WebMessagePort, message: WebMessage) {
                    job.onMessage(message.data)
                }
            }, worker)
            job.arm()
            // Сообщение с портом шлём только после того, как скрипт страницы установил слушателя: порядок evaluateJavascript и postWebMessage сам не гарантирован.
            view.evaluateJavascript(PageDownloadLogic.blobScript(token, blobUrl)) {
                try {
                    val origin = PageDownloadLogic.blobOrigin(blobUrl)
                    view.postWebMessage(WebMessage(token, arrayOf(ports[1])), Uri.parse(origin ?: "*"))
                } catch (e: Exception) {
                    job.fail("не удалось связаться со страницей")
                }
            }
        } catch (e: Exception) {
            toast(activity, "Не удалось сохранить файл: не удалось связаться со страницей")
        }
    }

    /**
     * Тот же канал, что и для сохранения файла, но байты собираются в памяти (автокоммит fix.zip, [AutoCommit]).
     * [onDone] вызывается один раз: (байты, null) или (null, причина). Android 6.0+.
     */
    @RequiresApi(Build.VERSION_CODES.M)
    fun fetchBlobBytes(activity: MainActivity, view: WebView, blobUrl: String, limit: Long, onDone: (ByteArray?, String?) -> Unit) {
        try {
            val ports = view.createWebMessageChannel()
            val token = newToken()
            val job = MemJob(ports[0], limit, onDone)
            ports[0].setWebMessageCallback(object : WebMessagePort.WebMessageCallback() {
                override fun onMessage(port: WebMessagePort, message: WebMessage) {
                    job.onMessage(message.data)
                }
            }, worker)
            job.arm()
            view.evaluateJavascript(PageDownloadLogic.blobScript(token, blobUrl)) {
                try {
                    val origin = PageDownloadLogic.blobOrigin(blobUrl)
                    view.postWebMessage(WebMessage(token, arrayOf(ports[1])), Uri.parse(origin ?: "*"))
                } catch (e: Exception) {
                    job.fail("не удалось связаться со страницей")
                }
            }
        } catch (e: Exception) {
            onDone(null, "не удалось связаться со страницей")
        }
    }

    /** Одна загрузка `blob:` в память: протокол тот же, что у [BlobJob]. */
    @RequiresApi(Build.VERSION_CODES.M)
    private class MemJob(
        private val port: WebMessagePort,
        private val limit: Long,
        private val onDone: (ByteArray?, String?) -> Unit
    ) {
        private val buf = java.io.ByteArrayOutputStream()
        @Volatile private var closed = false
        @Volatile private var last = SystemClock.uptimeMillis()

        private val watchdog = Runnable {
            worker.post { if (SystemClock.uptimeMillis() - last >= SILENCE_MS) failNow("страница не отвечает") }
        }

        fun arm() {
            last = SystemClock.uptimeMillis()
            main.removeCallbacks(watchdog)
            main.postDelayed(watchdog, SILENCE_MS)
        }

        fun onMessage(raw: String?) {
            if (closed) return
            arm()
            when (val m = PageDownloadLogic.parseMessage(raw)) {
                is PageDownloadLogic.Msg.Header -> {
                    if (m.size > limit) failNow("файл слишком большой") else reply("a")
                }
                is PageDownloadLogic.Msg.Data -> {
                    try {
                        val part = Base64.decode(m.base64, Base64.DEFAULT)
                        buf.write(part, 0, part.size)
                        if (buf.size() > limit) failNow("файл слишком большой") else reply("a")
                    } catch (e: Exception) {
                        failNow("кусок файла повреждён")
                    }
                }
                is PageDownloadLogic.Msg.End -> {
                    close(false)
                    onDone(buf.toByteArray(), null)
                }
                is PageDownloadLogic.Msg.Error -> failNow(PageDownloadLogic.errorText(m.reason))
                is PageDownloadLogic.Msg.Unknown -> { }
            }
        }

        fun fail(reason: String) {
            worker.post { failNow(reason) }
        }

        private fun failNow(reason: String) {
            if (closed) return
            close(true)
            onDone(null, reason)
        }

        private fun reply(text: String) {
            main.post {
                try { port.postMessage(WebMessage(text)) } catch (e: Exception) { }
            }
        }

        private fun close(tellPage: Boolean) {
            closed = true
            main.removeCallbacks(watchdog)
            main.post {
                try {
                    if (tellPage) port.postMessage(WebMessage("c"))
                    port.close()
                } catch (e: Exception) { }
            }
        }
    }

    private fun newToken(): String {
        val b = ByteArray(16)
        random.nextBytes(b)
        return b.joinToString("") { "%02x".format(it) }
    }

    /** Одна загрузка `blob:`: принимает сообщения страницы (поток [worker]), пишет в [FileSaver], подтверждает куски. */
    @RequiresApi(Build.VERSION_CODES.M)
    private class BlobJob(
        private val activity: MainActivity,
        private val port: WebMessagePort,
        private val contentDisposition: String?,
        private val mimeType: String?
    ) {
        private val saver = activity.fileSaver
        private var id = ""

        @Volatile private var closed = false
        @Volatile private var last = SystemClock.uptimeMillis()

        // Срабатывает в главном потоке, но решение принимается в потоке записи — там же, где идут сообщения страницы (состояние не делится между потоками).
        private val watchdog = Runnable {
            worker.post { if (SystemClock.uptimeMillis() - last >= SILENCE_MS) failNow("страница не отвечает") }
        }

        /** Страница (или приложение) подало признак жизни: сторожевой таймер отсчитывает молчание заново. */
        fun arm() {
            last = SystemClock.uptimeMillis()
            main.removeCallbacks(watchdog)
            main.postDelayed(watchdog, SILENCE_MS)
        }

        fun onMessage(raw: String?) {
            if (closed) return
            arm()
            when (val m = PageDownloadLogic.parseMessage(raw)) {
                is PageDownloadLogic.Msg.Header -> {
                    val name = PageDownloadLogic.pageFileName(contentDisposition, m.mime.ifEmpty { mimeType ?: "" })
                    // beginSave на Android 6-9 может ждать ответа пользователя на запрос разрешения — мы в потоке записи, главный не блокируется
                    id = saver.beginSave(name)
                    arm()
                    if (id.isEmpty()) failNow("запись не началась") else reply("a")
                }
                is PageDownloadLogic.Msg.Data -> {
                    if (id.isEmpty()) failNow("нарушен порядок сообщений")
                    else if (!saver.append(id, m.base64)) {
                        id = ""
                        failNow("запись сорвалась")
                    } else reply("a")
                }
                is PageDownloadLogic.Msg.End -> {
                    val result = if (id.isEmpty()) "" else saver.finish(id)
                    id = ""
                    close(false)
                    if (result.isEmpty()) toast(activity, "Не удалось сохранить файл: нарушен порядок сообщений") else reportFinished(activity, result)
                }
                is PageDownloadLogic.Msg.Error -> failNow(PageDownloadLogic.errorText(m.reason))
                is PageDownloadLogic.Msg.Unknown -> { }
            }
        }

        /** Из любого потока: сама работа идёт в потоке записи. */
        fun fail(reason: String) {
            worker.post { failNow(reason) }
        }

        private fun failNow(reason: String) {
            if (closed) return
            if (id.isNotEmpty()) saver.cancel(id)
            id = ""
            close(true)
            toast(activity, "Не удалось сохранить файл: $reason")
        }

        private fun reply(text: String) {
            main.post {
                try { port.postMessage(WebMessage(text)) } catch (e: Exception) { }
            }
        }

        private fun close(tellPage: Boolean) {
            closed = true
            main.removeCallbacks(watchdog)
            main.post {
                try {
                    if (tellPage) port.postMessage(WebMessage("c"))
                    port.close()
                } catch (e: Exception) { }
            }
        }
    }

    // ---------- итог ----------

    /** Итог [FileSaver.finish] (JSON `{"ok":…,"name":…,"where":…,"note":…}`) — коротким сообщением. */
    private fun reportFinished(activity: MainActivity, json: String) {
        try {
            val o = JSONObject(json)
            if (!o.optBoolean("ok", false)) {
                toast(activity, "Не удалось сохранить файл: " + o.optString("error", "ошибка записи"))
                return
            }
            val where = o.optString("where", DownloadTarget.LABEL_DOWNLOADS)
            val note = o.optString("note", "")
            toast(activity, "Сохранено: " + o.optString("name", "файл") + " → " + where + (if (note.isNotEmpty()) "\n$note" else ""))
        } catch (e: Exception) {
            toast(activity, "Файл сохранён")
        }
    }

    private fun toast(activity: MainActivity, text: String) {
        activity.runOnUiThread {
            try { Toast.makeText(activity, text, Toast.LENGTH_LONG).show() } catch (e: Exception) { }
        }
    }
}
