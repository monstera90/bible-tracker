package com.app.lifetracker
// Версия: 1.0 (22.11) — тесты проверок обновлений (хуки `verify`, адрес, размер, SHA-256, перенос на место); ТЗ TZ_downloads.md, этап 5, раздел 10. Запуск: ./gradlew testDebugUnitTest

import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import java.io.File

class UpdateChecksTest {

    private lateinit var dir: File

    @Before fun setUp() {
        dir = java.nio.file.Files.createTempDirectory("upd").toFile()
    }

    @After fun tearDown() {
        dir.deleteRecursively()
    }

    private val prefix = "https://github.com/monstera90/bible-tracker/releases/download/"

    private fun work(text: String = "hello"): File = File(dir, "a.apk.part").also { it.writeText(text) }

    @Test fun urlMustStartWithPrefix() {
        assertTrue(UpdateChecks.urlAllowed(prefix + "apk-v1-b5/app.apk", prefix))
        assertFalse(UpdateChecks.urlAllowed("https://evil.example/releases/download/app.apk", prefix))
        assertFalse(UpdateChecks.urlAllowed("http://github.com/monstera90/bible-tracker/releases/download/x", prefix))
        assertFalse(UpdateChecks.urlAllowed(prefix + "a b.apk", prefix)) // пробел
        assertTrue(UpdateChecks.urlAllowed(prefix + "v1/web.zip", prefix, ".zip"))
        assertFalse(UpdateChecks.urlAllowed(prefix + "v1/web.exe", prefix, ".zip"))
    }

    @Test fun sizeChecks() {
        assertNull(UpdateChecks.sizeError(100, 100, 1000))
        assertNull(UpdateChecks.sizeError(100, 0, 1000)) // размер в релизе неизвестен
        assertEquals("Скачано 90 байт из 100", UpdateChecks.sizeError(90, 100, 1000))
        assertEquals("Файл слишком большой", UpdateChecks.sizeError(1001, 0, 1000))
        assertNull(UpdateChecks.sizeError(5_000_000, 0, 0)) // предела нет
    }

    @Test fun sha256OfKnownText() {
        val f = File(dir, "abc.bin").also { it.writeText("abc") }
        assertEquals("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad", UpdateChecks.sha256Hex(f))
    }

    @Test fun shaVerifierAcceptsMatchAndRejectsMismatch() {
        val f = File(dir, "abc.bin").also { it.writeText("abc") }
        val good = "BA7816BF8F01CFEA414140DE5DAE2223B00361A396177A9CB410FF61F20015AD" // регистр не важен
        assertNull(UpdateChecks.shaVerifier(good, 1000)(f))
        val bad = "0".repeat(64)
        assertTrue(UpdateChecks.shaVerifier(bad, 1000)(f)!!.startsWith("sha256 не совпал"))
        assertEquals("Файл слишком большой", UpdateChecks.shaVerifier(good, 2)(f))
    }

    @Test fun apkVerifierChecksSizeThenPackage() {
        val f = File(dir, "x.apk").also { it.writeText("12345") }
        assertNull(UpdateChecks.apkVerifier(5, 100) { true }(f))
        assertEquals("Скачано 5 байт из 9", UpdateChecks.apkVerifier(9, 100) { true }(f))
        assertTrue(UpdateChecks.apkVerifier(5, 100) { false }(f)!!.contains("другой пакет"))
        assertEquals("Файл слишком большой", UpdateChecks.apkVerifier(0, 3) { true }(f))
    }

    @Test fun placeMovesWorkFileToDest() {
        val w = work()
        val d = File(dir, "apkupdate/LifeTracker-7.apk")
        assertNull(UpdateChecks.placeAndVerify(w, d) { null })
        assertTrue(d.isFile)
        assertFalse(w.exists())
        assertEquals("hello", d.readText())
    }

    @Test fun failedVerifyRemovesBothFiles() {
        val w = work()
        val d = File(dir, "LifeTracker-7.apk")
        val err = UpdateChecks.placeAndVerify(w, d) { "Скачанный файл не подходит" }
        assertEquals("Скачанный файл не подходит", err)
        assertFalse(d.exists())
        assertFalse(w.exists())
    }

    @Test fun throwingVerifyIsAnErrorAndCleans() {
        val w = work()
        val d = File(dir, "LifeTracker-7.apk")
        val err = UpdateChecks.placeAndVerify(w, d) { throw IllegalStateException("boom") }
        assertNotNull(err)
        assertFalse(d.exists())
        assertFalse(w.exists())
    }

    @Test fun placeReplacesOldDestAndWorksWithoutVerify() {
        val d = File(dir, "web.zip").also { it.writeText("old") }
        val w = work("new")
        assertNull(UpdateChecks.placeAndVerify(w, d, null))
        assertEquals("new", d.readText())
    }

    @Test fun wrongShaOfWebBundleRemovesFile() {
        val w = work("not the bundle")
        val d = File(dir, "v1.zip")
        val err = UpdateChecks.placeAndVerify(w, d, UpdateChecks.shaVerifier("0".repeat(64), 1000))
        assertTrue(err!!.startsWith("sha256 не совпал"))
        assertFalse(d.exists())
        assertFalse(w.exists())
    }
}
