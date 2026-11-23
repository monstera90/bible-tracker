package com.app.lifetracker
// Версия: 1.0 (21.11) — тесты чистой логики скачивания (ТЗ TZ_downloads.md, этап 1). Запуск: ./gradlew testDebugUnitTest

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class DownloadLogicTest {

    private val mb = 1L shl 20

    @Test fun smallFileIsOnePart() {
        val r = DownloadLogic.splitRanges(mb + 5, 8)
        assertEquals(1, r.size)
        assertEquals(0L, r[0].start); assertEquals(mb + 4, r[0].end)
    }

    @Test fun partsCoverFileWithoutGaps() {
        for (total in listOf(2 * mb, 7 * mb + 3, 100 * mb + 1)) for (th in 2..8) {
            val r = DownloadLogic.splitRanges(total, th)
            assertEquals(0L, r.first().start)
            assertEquals(total - 1, r.last().end)
            for (i in 1 until r.size) assertEquals(r[i - 1].end + 1, r[i].start)
            assertEquals(total, r.sumOf { it.length })
            assertTrue(r.all { it.length >= mb })
            assertTrue(r.size <= th)
        }
    }

    @Test fun partCountLimitedByMinPart() {
        assertEquals(3, DownloadLogic.splitRanges(3 * mb + 10, 8).size)
        assertTrue(DownloadLogic.splitRanges(0, 4).isEmpty())
        assertTrue(DownloadLogic.splitRanges(-1, 4).isEmpty())
    }

    @Test fun autoMultiOnlyWhenRangesAndSizeKnown() {
        assertTrue(DownloadLogic.canAutoMulti(10 * mb, true))
        assertFalse(DownloadLogic.canAutoMulti(10 * mb, false))
        assertFalse(DownloadLogic.canAutoMulti(-1, true))
        assertFalse(DownloadLogic.canAutoMulti(0, true))
        assertTrue(DownloadLogic.canAutoMulti(-1, false, true)) // разведка не удалась: решит движок
        assertFalse(DownloadLogic.canAutoMulti(-1, false, false))
    }

    @Test fun contentDispositionNames() {
        assertEquals("a b.txt", DownloadLogic.parseContentDisposition("attachment; filename=\"a b.txt\""))
        assertEquals("a.txt", DownloadLogic.parseContentDisposition("attachment; filename=a.txt"))
        assertEquals("книга.pdf", DownloadLogic.parseContentDisposition("attachment; filename*=UTF-8''%D0%BA%D0%BD%D0%B8%D0%B3%D0%B0.pdf"))
        assertEquals("книга.pdf", DownloadLogic.parseContentDisposition("attachment; filename=\"x.pdf\"; filename*=UTF-8''%D0%BA%D0%BD%D0%B8%D0%B3%D0%B0.pdf"))
        assertNull(DownloadLogic.parseContentDisposition("inline"))
        assertNull(DownloadLogic.parseContentDisposition(null))
    }

    @Test fun mojibakeIsRepaired() {
        val raw = String("книга.pdf".toByteArray(Charsets.UTF_8), Charsets.ISO_8859_1)
        assertEquals("книга.pdf", DownloadLogic.fixMojibake(raw))
        assertEquals("plain.txt", DownloadLogic.fixMojibake("plain.txt"))
    }

    @Test fun nameFromUrl() {
        assertEquals("file.zip", DownloadLogic.nameFromUrl("https://x.org/a/file.zip?x=1#h"))
        assertEquals("мой файл.pdf", DownloadLogic.nameFromUrl("https://x.org/%D0%BC%D0%BE%D0%B9%20%D1%84%D0%B0%D0%B9%D0%BB.pdf"))
        assertNull(DownloadLogic.nameFromUrl("https://x.org/"))
        assertNull(DownloadLogic.nameFromUrl("https://x.org"))
    }

    @Test fun pickFileNameFallbacks() {
        assertEquals("a.zip", DownloadLogic.pickFileName("attachment; filename=a.zip", "https://x/y", null))
        assertEquals("y.pdf", DownloadLogic.pickFileName(null, "https://x/y", "application/pdf"))
        assertEquals("file", DownloadLogic.pickFileName(null, "https://x/", "application/octet-stream"))
        assertEquals("a_b.txt", DownloadLogic.pickFileName("attachment; filename=\"a/b.txt\"", "https://x/", null))
    }

    @Test fun uniqueNames() {
        val taken = setOf("a.txt", "a (1).txt", "b")
        assertEquals("a (2).txt", DownloadLogic.uniqueName("a.txt") { it in taken })
        assertEquals("b (1)", DownloadLogic.uniqueName("b") { it in taken })
        assertEquals("c.txt", DownloadLogic.uniqueName("c.txt") { it in taken })
    }

    @Test fun formatting() {
        assertEquals("512 Б", DownloadLogic.formatSize(512))
        assertEquals("12,4 МБ", DownloadLogic.formatSize((12.4 * 1024 * 1024).toLong()))
        assertEquals("80 МБ", DownloadLogic.formatSize(80L * 1024 * 1024))
        assertEquals("1,2 ГБ", DownloadLogic.formatSize((1.2 * 1024 * 1024 * 1024).toLong()))
        assertEquals("12,4 из 80 МБ", DownloadLogic.formatProgress((12.4 * 1024 * 1024).toLong(), 80L * 1024 * 1024))
        assertEquals("3,2 МБ/с", DownloadLogic.formatSpeed((3.2 * 1024 * 1024).toLong()))
        assertEquals(45, DownloadLogic.percent(45, 100))
        assertEquals(-1, DownloadLogic.percent(5, -1))
        assertEquals("1 поток", DownloadLogic.threadsText(1))
        assertEquals("4 потока", DownloadLogic.threadsText(4))
        assertEquals("5 потоков", DownloadLogic.threadsText(5))
        assertEquals("11 потоков", DownloadLogic.threadsText(11))
    }

    @Test fun speedMeterAveragesWindow() {
        val m = DownloadLogic.SpeedMeter(3000)
        assertEquals(0L, m.perSec())
        m.add(0, 0); m.add(1000, 1000); m.add(2000, 2000)
        assertEquals(1000L, m.perSec())
        m.add(10_000, 12_000); m.add(11_000, 14_000)
        assertEquals(2000L, m.perSec())
    }

    @Test fun partMetaRoundTrip() {
        val parts = DownloadLogic.splitRanges(10 * mb, 4)
        val m = PartMeta(10 * mb, "\"abc\"", parts, longArrayOf(5, 0, 7, parts[3].length))
        val p = PartMeta.parse(m.serialize())
        assertNotNull(p)
        assertEquals(10 * mb, p!!.total); assertEquals("\"abc\"", p.etag)
        assertEquals(parts, p.parts)
        assertEquals(listOf(5L, 0L, 7L, parts[3].length), p.done.toList())
        assertNull(PartMeta.parse("garbage"))
        assertNull(PartMeta.parse(m.serialize().replace("p1=", "px=")))
    }

    @Test fun islandOrder() {
        val kinds = listOf(
            IslandOrder.KIND_WORKOUT to false, IslandOrder.KIND_SW to false, IslandOrder.KIND_TIMER to false,
            IslandOrder.KIND_DOWNLOAD to false, IslandOrder.KIND_VIDEO to false, IslandOrder.KIND_MUSIC to false,
            IslandOrder.KIND_POMO to false, IslandOrder.KIND_TIMER to true
        )
        val sorted = IslandOrder.sort(kinds) { IslandOrder.rank(it.first, it.second) }
        assertEquals(
            listOf(
                IslandOrder.KIND_TIMER to true, IslandOrder.KIND_POMO to false, IslandOrder.KIND_MUSIC to false, IslandOrder.KIND_VIDEO to false,
                IslandOrder.KIND_DOWNLOAD to false, IslandOrder.KIND_TIMER to false, IslandOrder.KIND_SW to false, IslandOrder.KIND_WORKOUT to false
            ), sorted
        )
    }

    @Test fun islandOrderIsStableWithinKind() {
        val items = listOf("t1" to IslandOrder.KIND_TIMER, "d2" to IslandOrder.KIND_DOWNLOAD, "t0" to IslandOrder.KIND_TIMER, "d1" to IslandOrder.KIND_DOWNLOAD)
        assertEquals(listOf("d2", "d1", "t1", "t0"), IslandOrder.sort(items) { IslandOrder.rank(it.second) }.map { it.first })
    }
}
