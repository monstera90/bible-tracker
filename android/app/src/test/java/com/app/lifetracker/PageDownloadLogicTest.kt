package com.app.lifetracker
// Версия: 1.0 (22.11) — тесты чистой логики `data:` и `blob:` (ТЗ TZ_downloads.md, этап 6). Запуск: ./gradlew testDebugUnitTest

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class PageDownloadLogicTest {

    private fun text(d: PageDownloadLogic.DataUrl?): String = String(d!!.bytes, Charsets.UTF_8)

    @Test fun dataBase64() {
        val d = PageDownloadLogic.parseDataUrl("data:text/plain;base64,SGVsbG8=")
        assertNotNull(d)
        assertEquals("text/plain", d!!.mime)
        assertEquals("Hello", text(d))
    }

    @Test fun dataBase64WithoutPaddingAndWhitespace() {
        assertEquals("Hello", text(PageDownloadLogic.parseDataUrl("data:text/plain;base64,SGVs\nbG8")))
        assertEquals("Hello", text(PageDownloadLogic.parseDataUrl("data:text/plain;charset=utf-8;base64,SGVsbG8")))
    }

    @Test fun dataBase64UrlSafeAlphabet() {
        val d = PageDownloadLogic.parseDataUrl("data:application/octet-stream;base64,-_8")
        assertArrayEquals(byteArrayOf(0xFB.toByte(), 0xFF.toByte()), d!!.bytes)
        val e = PageDownloadLogic.parseDataUrl("data:application/octet-stream;base64,%2B%2F8%3D")
        assertArrayEquals(byteArrayOf(0xFB.toByte(), 0xFF.toByte()), e!!.bytes)
    }

    @Test fun dataPercentEncodedUtf8() {
        val d = PageDownloadLogic.parseDataUrl("data:text/plain;charset=utf-8,%D0%BF%D1%80%D0%B8%D0%B2%D0%B5%D1%82 W")
        assertEquals("привет W", text(d))
    }

    @Test fun dataRawNonAsciiCharactersBecomeUtf8() {
        assertEquals("привет😀", text(PageDownloadLogic.parseDataUrl("data:,привет😀")))
    }

    @Test fun dataWithoutTypeIsPlainText() {
        val d = PageDownloadLogic.parseDataUrl("data:,Hello%20W")
        assertEquals("text/plain", d!!.mime)
        assertEquals("Hello W", text(d))
    }

    @Test fun dataIncompletePercentStaysAsIs() {
        assertEquals("100%", text(PageDownloadLogic.parseDataUrl("data:,100%")))
        assertEquals("a%zzb", text(PageDownloadLogic.parseDataUrl("data:,a%zzb")))
    }

    @Test fun dataTypeIsLowerCased() {
        assertEquals("image/png", PageDownloadLogic.parseDataUrl("data:IMAGE/PNG;base64,AA==")!!.mime)
    }

    @Test fun dataBrokenOrForeignIsRejected() {
        assertNull(PageDownloadLogic.parseDataUrl(null))
        assertNull(PageDownloadLogic.parseDataUrl("https://example.com/a.zip"))
        assertNull(PageDownloadLogic.parseDataUrl("data:text/plain;base64"))
        assertNull(PageDownloadLogic.parseDataUrl("data:text/plain;base64,@@@"))
        assertTrue(PageDownloadLogic.parseDataUrl("data:text/plain;base64,")!!.bytes.isEmpty())
    }

    @Test fun dataLargeBase64RoundTrip() {
        val src = ByteArray(300_001) { (it * 31 + 7).toByte() }
        val b64 = java.util.Base64.getEncoder().encodeToString(src)
        assertArrayEquals(src, PageDownloadLogic.parseDataUrl("data:application/octet-stream;base64,$b64")!!.bytes)
    }

    @Test fun pageFileNameFromHeaderTypeAndFallback() {
        assertEquals("report.pdf", PageDownloadLogic.pageFileName("attachment; filename=\"report.pdf\"", "application/octet-stream"))
        assertEquals("download.pdf", PageDownloadLogic.pageFileName(null, "application/pdf"))
        assertEquals("download", PageDownloadLogic.pageFileName(null, ""))
        assertEquals("download", PageDownloadLogic.pageFileName("", "application/x-unknown"))
        assertEquals("a.png", PageDownloadLogic.pageFileName("attachment; filename=a", "image/png"))
        assertEquals("x.bin", PageDownloadLogic.pageFileName("attachment; filename=x.bin", "image/png"))
    }

    @Test fun blobOriginOfNormalAndOpaqueUrls() {
        assertEquals("https://claude.ai", PageDownloadLogic.blobOrigin("blob:https://claude.ai/3f2a9c1e-0000-4000-8000-123456789abc"))
        assertEquals("http://localhost:8080", PageDownloadLogic.blobOrigin("blob:http://localhost:8080/id"))
        assertNull(PageDownloadLogic.blobOrigin("blob:null/3f2a"))
        assertNull(PageDownloadLogic.blobOrigin("https://claude.ai/x"))
        assertNull(PageDownloadLogic.blobOrigin(null))
    }

    @Test fun messagesFromPage() {
        val h = PageDownloadLogic.parseMessage("H|123|image/png") as PageDownloadLogic.Msg.Header
        assertEquals(123L, h.size); assertEquals("image/png", h.mime)
        val h2 = PageDownloadLogic.parseMessage("H|0|") as PageDownloadLogic.Msg.Header
        assertEquals(0L, h2.size); assertEquals("", h2.mime)
        assertEquals("QUJD", (PageDownloadLogic.parseMessage("D|QUJD") as PageDownloadLogic.Msg.Data).base64)
        assertEquals("fetch", (PageDownloadLogic.parseMessage("X|fetch") as PageDownloadLogic.Msg.Error).reason)
        assertTrue(PageDownloadLogic.parseMessage("E") is PageDownloadLogic.Msg.End)
        assertTrue(PageDownloadLogic.parseMessage("H|abc|x") is PageDownloadLogic.Msg.Unknown)
        assertTrue(PageDownloadLogic.parseMessage("zzz") is PageDownloadLogic.Msg.Unknown)
        assertTrue(PageDownloadLogic.parseMessage(null) is PageDownloadLogic.Msg.Unknown)
    }

    @Test fun headerTypeMayContainBar() {
        val h = PageDownloadLogic.parseMessage("H|5|text/x;a|b") as PageDownloadLogic.Msg.Header
        assertEquals("text/x;a|b", h.mime)
    }

    @Test fun errorTexts() {
        assertTrue(PageDownloadLogic.errorText("fetch").contains("blob"))
        assertTrue(PageDownloadLogic.errorText("read").isNotEmpty())
        assertEquals("что-то", PageDownloadLogic.errorText(" что-то "))
        assertTrue(PageDownloadLogic.errorText("").isNotEmpty())
    }

    @Test fun jsStringEscapes() {
        assertEquals("\"a\\\"b\\\\c\\n\\u003c/script>\"", PageDownloadLogic.jsString("a\"b\\c\n</script>"))
    }

    @Test fun chunkIsMultipleOfThree() {
        assertEquals(0, PageDownloadLogic.CHUNK_BYTES % 3)
    }

    @Test fun scriptCarriesTokenAndUrlEscaped() {
        val s = PageDownloadLogic.blobScript("tok123", "blob:https://x.y/a\"b")
        assertTrue(s.contains("var T=\"tok123\""))
        assertTrue(s.contains("U=\"blob:https://x.y/a\\\"b\""))
        assertFalse(s.contains("\n"))
    }
}
