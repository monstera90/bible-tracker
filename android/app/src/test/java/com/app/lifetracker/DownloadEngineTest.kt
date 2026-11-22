package com.app.lifetracker
// Версия: 1.0 (21.11) — тесты движка скачивания на локальном HTTP-сервере JDK (ТЗ TZ_downloads.md, этап 1, раздел 9.1). Запуск: ./gradlew testDebugUnitTest

import com.sun.net.httpserver.HttpExchange
import com.sun.net.httpserver.HttpServer
import org.junit.After
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import java.io.File
import java.net.InetSocketAddress
import java.util.Random
import java.util.concurrent.atomic.AtomicInteger

class DownloadEngineTest {

    private lateinit var server: HttpServer
    private lateinit var dir: File
    private val data = ByteArray(6 * 1024 * 1024 + 123).also { Random(7).nextBytes(it) }
    private var ranges = true
    private var throttleAbove = Int.MAX_VALUE // 403 при числе одновременных запросов выше
    private val inFlight = AtomicInteger(0)
    private val maxSeen = AtomicInteger(0)
    private val gets = AtomicInteger(0)

    private fun base() = "http://127.0.0.1:" + server.address.port

    @Before fun setUp() {
        dir = java.nio.file.Files.createTempDirectory("dl").toFile()
        server = HttpServer.create(InetSocketAddress("127.0.0.1", 0), 0)
        server.createContext("/f") { ex -> handle(ex) }
        server.createContext("/redir") { ex ->
            ex.responseHeaders.add("Location", "/f"); ex.sendResponseHeaders(302, -1); ex.close()
        }
        server.executor = java.util.concurrent.Executors.newFixedThreadPool(16)
        server.start()
    }

    @After fun tearDown() {
        server.stop(0)
        dir.deleteRecursively()
    }

    private fun handle(ex: HttpExchange) {
        try {
            if (ex.requestMethod == "HEAD") {
                ex.responseHeaders.add("Content-Length", data.size.toString())
                if (ranges) ex.responseHeaders.add("Accept-Ranges", "bytes")
                ex.responseHeaders.add("ETag", "\"v1\"")
                ex.sendResponseHeaders(200, -1); ex.close(); return
            }
            gets.incrementAndGet()
            val n = inFlight.incrementAndGet()
            maxSeen.updateAndGet { maxOf(it, n) }
            try {
                if (n > throttleAbove) { ex.sendResponseHeaders(403, -1); ex.close(); return }
                val rh = ex.requestHeaders.getFirst("Range")
                if (rh != null && ranges) {
                    val m = Regex("bytes=(\\d+)-(\\d*)").find(rh)!!
                    val s = m.groupValues[1].toInt()
                    val e = if (m.groupValues[2].isEmpty()) data.size - 1 else m.groupValues[2].toInt()
                    ex.responseHeaders.add("Content-Range", "bytes $s-$e/${data.size}")
                    ex.responseHeaders.add("ETag", "\"v1\"")
                    ex.sendResponseHeaders(206, (e - s + 1).toLong())
                    ex.responseBody.use { it.write(data, s, e - s + 1) }
                } else {
                    ex.responseHeaders.add("ETag", "\"v1\"")
                    ex.sendResponseHeaders(200, data.size.toLong())
                    ex.responseBody.use { it.write(data) }
                }
            } finally {
                inFlight.decrementAndGet()
            }
        } catch (e: Exception) {
            try { ex.close() } catch (e2: Exception) { }
        }
    }

    private fun task(mode: DlMode, threads: Int = 4, path: String = "/f"): DownloadTask {
        val t = DownloadTask(1, base() + path, emptyMap())
        t.mode = mode; t.threads = threads; t.fileName = "x.bin"
        return t
    }

    private fun run(t: DownloadTask, name: String = "x.bin.part"): Pair<DlOutcome, File> {
        val f = File(dir, name)
        return DownloadEngine(t, f).run() to f
    }

    @Test fun singleDownloadMatches() {
        val (o, f) = run(task(DlMode.SINGLE))
        assertEquals(DlOutcome.DONE, o)
        assertArrayEquals(data, f.readBytes())
    }

    @Test fun multiDownloadMatchesAndUsesParallelRequests() {
        val (o, f) = run(task(DlMode.MULTI, 4))
        assertEquals(DlOutcome.DONE, o)
        assertArrayEquals(data, f.readBytes())
        assertTrue(maxSeen.get() >= 2)
    }

    @Test fun redirectIsFollowed() {
        val (o, f) = run(task(DlMode.SINGLE, path = "/redir"))
        assertEquals(DlOutcome.DONE, o)
        assertArrayEquals(data, f.readBytes())
    }

    @Test fun noRangeFallsBackToSingleWithNote() {
        ranges = false
        val t = task(DlMode.MULTI, 4)
        val (o, f) = run(t)
        assertEquals(DlOutcome.DONE, o)
        assertArrayEquals(data, f.readBytes())
        assertEquals(DownloadEngine.NOTE_NO_RANGE, t.note)
        assertFalse(t.supportsRange)
    }

    @Test fun throttlingReducesThreads() {
        throttleAbove = 1 // параллельные запросы получают 403
        val t = task(DlMode.MULTI, 4)
        val (o, f) = run(t)
        assertEquals(DlOutcome.DONE, o)
        assertArrayEquals(data, f.readBytes())
    }

    @Test fun pauseThenResumeKeepsBytes() {
        val t = task(DlMode.SINGLE)
        val f = File(dir, "x.bin.part")
        val e1 = DownloadEngine(t, f)
        // останавливаем сразу после первых байт
        val th = Thread { while (t.doneBytes == 0L) Thread.sleep(1); t.control = DownloadTask.CTL_PAUSE; e1.stop() }
        th.start()
        val first = e1.run()
        th.join()
        assertTrue(first == DlOutcome.PAUSED || first == DlOutcome.DONE)
        if (first == DlOutcome.PAUSED) {
            t.control = DownloadTask.CTL_RUN
            assertEquals(DlOutcome.DONE, DownloadEngine(t, f).run())
        }
        assertArrayEquals(data, f.readBytes())
    }

    @Test fun multiResumeAfterPause() {
        val t = task(DlMode.MULTI, 3)
        val f = File(dir, "x.bin.part")
        val e1 = DownloadEngine(t, f)
        val th = Thread { while (t.doneBytes == 0L) Thread.sleep(1); t.control = DownloadTask.CTL_PAUSE; e1.stop() }
        th.start()
        val first = e1.run()
        th.join()
        if (first == DlOutcome.PAUSED) {
            t.control = DownloadTask.CTL_RUN
            assertEquals(DlOutcome.DONE, DownloadEngine(t, f).run())
        } else assertEquals(DlOutcome.DONE, first)
        assertArrayEquals(data, f.readBytes())
    }

    @Test fun probeReportsSizeAndRanges() {
        val p = DownloadEngine.probe(base() + "/f", emptyMap())
        assertEquals(data.size.toLong(), p.total)
        assertTrue(p.acceptRanges)
        assertEquals("\"v1\"", p.etag)
    }
}
