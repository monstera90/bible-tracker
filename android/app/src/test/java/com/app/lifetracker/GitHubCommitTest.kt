package com.app.lifetracker
// Версия: 1.0 (24.11) — проверка путей и распаковки архива для автокоммита fix.zip (GitHubCommit).

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.ByteArrayOutputStream
import java.util.zip.ZipEntry
import java.util.zip.ZipOutputStream

class GitHubCommitTest {

    private fun zip(vararg files: Pair<String, String>): ByteArray {
        val bos = ByteArrayOutputStream()
        ZipOutputStream(bos).use { z ->
            for ((name, text) in files) {
                z.putNextEntry(ZipEntry(name))
                z.write(text.toByteArray(Charsets.UTF_8))
                z.closeEntry()
            }
        }
        return bos.toByteArray()
    }

    @Test fun goodPaths() {
        assertEquals("a/b.txt", GitHubCommit.sanitizePath("a/b.txt"))
        assertEquals("a/b.txt", GitHubCommit.sanitizePath("./a/b.txt"))
        assertEquals("a/b.txt", GitHubCommit.sanitizePath("a\\b.txt"))
        assertEquals(".github/workflows/x.yml", GitHubCommit.sanitizePath(".github/workflows/x.yml"))
    }

    @Test fun badPaths() {
        assertNull(GitHubCommit.sanitizePath("../x"))
        assertNull(GitHubCommit.sanitizePath("a/../../x"))
        assertNull(GitHubCommit.sanitizePath("/etc/passwd"))
        assertNull(GitHubCommit.sanitizePath("C:/x"))
        assertNull(GitHubCommit.sanitizePath(".git/config"))
        assertNull(GitHubCommit.sanitizePath(".GIT/config"))
        assertNull(GitHubCommit.sanitizePath("a//b"))
        assertNull(GitHubCommit.sanitizePath(""))
    }

    @Test fun zipSkipsBadKeepsGood() {
        val c = GitHubCommit.readZip(zip("ok.txt" to "1", "../x" to "2", ".git/config" to "3", "dir/y.kt" to "4", "__MACOSX/._ok.txt" to "5"))
        assertEquals(listOf("ok.txt", "dir/y.kt"), c.entries.map { it.path })
        assertEquals(listOf("../x", ".git/config"), c.skipped)
    }

    @Test fun zipLastDuplicateWins() {
        val c = GitHubCommit.readZip(zip("a.txt" to "old", "a.txt" to "new"))
        assertEquals(1, c.entries.size)
        assertEquals("new", String(c.entries[0].bytes, Charsets.UTF_8))
    }

    @Test fun garbageIsEmptyOrError() {
        val ok = try { GitHubCommit.readZip("not a zip".toByteArray()).entries.isEmpty() } catch (e: java.io.IOException) { true }
        assertTrue(ok)
    }
}
