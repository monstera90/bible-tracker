package com.app.lifetracker
// Версия: 1.0 (22.11) — тесты выбора папки по имени файла (ТЗ TZ_downloads.md, этап 4, разделы 13.2–13.4). Запуск: ./gradlew testDebugUnitTest

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class DownloadRulesTest {

    private fun on(vararg k: String) = k.associate { it to DownloadRules.Slot(true, true) }
    private fun cfg(cats: Map<String, DownloadRules.Slot> = emptyMap(), rules: Map<String, DownloadRules.Slot> = emptyMap()) =
        DownloadRules.Config(cats, rules)

    private fun name(c: DownloadRules.Choice): String = when (c) {
        is DownloadRules.Choice.Cat -> "cat:" + c.key
        is DownloadRules.Choice.Custom -> "rule:" + c.ext
        else -> "downloads"
    }

    private fun pick(file: String, c: DownloadRules.Config, src: DlSource = DlSource.USER) = name(DownloadRules.choose(file, src, c))

    @Test fun nothingEnabledGoesToDownloads() {
        for (f in listOf("a.jpg", "a.pdf", "a.zip", "a.bin", "README")) assertEquals("downloads", pick(f, DownloadRules.Config.EMPTY))
    }

    @Test fun categoryWorksOnlyWhenEnabledAndHasFolder() {
        assertEquals("cat:images", pick("Photo.JPG", cfg(on("images"))))
        assertEquals("downloads", pick("a.pdf", cfg(on("images"))))
        assertEquals("downloads", pick("a.jpg", cfg(mapOf("images" to DownloadRules.Slot(false, true)))))
        assertEquals("downloads", pick("a.jpg", cfg(mapOf("images" to DownloadRules.Slot(true, false)))))
    }

    @Test fun customFormatBeatsCategory() {
        val c = cfg(on("archives"), mapOf("zip" to DownloadRules.Slot(true, true)))
        assertEquals("rule:zip", pick("a.zip", c))
        assertEquals("cat:archives", pick("a.rar", c))
    }

    @Test fun longestEndingWins() {
        assertEquals("cat:books", pick("book.fb2.zip", cfg(on("books", "archives"))))
        assertEquals("cat:archives", pick("book.fb2.zip", cfg(on("archives"))))
        val both = cfg(rules = mapOf("zip" to DownloadRules.Slot(true, true), "fb2.zip" to DownloadRules.Slot(true, true)))
        assertEquals("rule:fb2.zip", pick("book.fb2.zip", both))
        assertEquals("rule:zip", pick("x.zip", both))
    }

    @Test fun disabledCustomRuleIsSkipped() {
        val c = cfg(on("archives"), mapOf("zip" to DownloadRules.Slot(false, true)))
        assertEquals("cat:archives", pick("a.zip", c))
    }

    @Test fun otherCatchesWhatNoActiveRuleTook() {
        val c = cfg(on("other", "images"))
        assertEquals("cat:other", pick("a.bin", c))
        assertEquals("cat:other", pick("README", c))
        assertEquals("cat:images", pick("a.png", c))
        assertEquals("cat:other", pick("a.png", cfg(on("other"))))
        assertEquals("downloads", pick("a.bin", cfg(on("images"))))
    }

    @Test fun nameWithoutBaseDoesNotMatch() {
        assertEquals("downloads", pick(".zip", cfg(on("archives"))))
        assertTrue(!DownloadRules.endsWithFormat("zip", "zip"))
        assertTrue(DownloadRules.endsWithFormat("a.zip", "zip"))
    }

    @Test fun appUpdateIgnoresApkRulesAndCategory() {
        val apk = cfg(on("apk"), mapOf("apk" to DownloadRules.Slot(true, true)))
        assertEquals("downloads", pick("LifeTracker-12.apk", apk, DlSource.APP_UPDATE))
        assertEquals("cat:update", pick("LifeTracker-12.apk", cfg(on("apk", "update")), DlSource.APP_UPDATE))
        assertEquals("cat:apk", pick("x.apk", cfg(on("apk", "update"))))
    }

    @Test fun webBundleNeverSorted() {
        assertEquals("downloads", pick("web.zip", cfg(on("archives", "other", "update"), mapOf("zip" to DownloadRules.Slot(true, true))), DlSource.WEB_BUNDLE))
    }

    @Test fun normalizeFormat() {
        assertEquals("zip", DownloadRules.normalizeFormat("zip"))
        assertEquals("zip", DownloadRules.normalizeFormat(".zip"))
        assertEquals("zip", DownloadRules.normalizeFormat("*.zip"))
        assertEquals("zip", DownloadRules.normalizeFormat("  ZIP "))
        assertEquals("fb2.zip", DownloadRules.normalizeFormat("*.Fb2.ZIP"))
        assertEquals("", DownloadRules.normalizeFormat("  "))
        assertEquals("", DownloadRules.normalizeFormat(null))
    }

    @Test fun formatErrors() {
        assertNotNull(DownloadRules.formatError(""))
        assertNotNull(DownloadRules.formatError("a/b"))
        assertNotNull(DownloadRules.formatError("a\\b"))
        assertNotNull(DownloadRules.formatError("x".repeat(17)))
        assertNull(DownloadRules.formatError("x".repeat(16)))
        assertNull(DownloadRules.formatError("fb2.zip"))
    }

    @Test fun categoryOfNameIgnoresSettings() {
        assertEquals("images", DownloadRules.categoryOfName("A.PNG"))
        assertEquals("books", DownloadRules.categoryOfName("x.fb2.zip"))
        assertEquals("archives", DownloadRules.categoryOfName("x.tar.gz"))
        assertEquals("archives", DownloadRules.categoryOfName("x.zip"))
        assertEquals("other", DownloadRules.categoryOfName("x.unknown"))
        assertEquals("other", DownloadRules.categoryOfName("noext"))
    }

    @Test fun overriddenCategory() {
        assertEquals("Архивы", DownloadRules.overriddenCategoryTitle("zip"))
        assertEquals("Электронные книги", DownloadRules.overriddenCategoryTitle("fb2.zip"))
        assertNull(DownloadRules.overriddenCategoryTitle("jwlibrary"))
    }
}
