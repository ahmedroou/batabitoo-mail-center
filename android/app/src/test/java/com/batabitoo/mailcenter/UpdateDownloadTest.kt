package com.batabitoo.mailcenter

import com.batabitoo.mailcenter.data.UpdateDownload
import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Test
import org.junit.Assume.assumeTrue
import java.nio.file.Files

class UpdateDownloadTest {
    @Test fun allowsPublishedReleaseAndItsRedirect() {
        listOf("github.com", "release-assets.githubusercontent.com", "objects.githubusercontent.com", "batabitoo-mail-2026.web.app", "batabitoo-mail-2026.firebaseapp.com").forEach {
            assertEquals(it, UpdateDownload.trustedUrl("https://$it/file.apk?signature=test").host)
        }
    }
    @Test fun rejectsInsecureOrUntrustedRedirects() {
        listOf("http://github.com/app.apk", "https://github.com.attacker.example/app.apk", "https://attacker.web.app/app.apk", "https://user:pass@github.com/app.apk", "https://github.com:8443/app.apk").forEach {
            assertThrows(IllegalArgumentException::class.java) { UpdateDownload.trustedUrl(it) }
        }
    }
    @Test fun livePublishedApkMatchesHash() {
        val url = System.getenv("UPDATE_SMOKE_URL")
        val hash = System.getenv("UPDATE_SMOKE_SHA256")
        assumeTrue("Opt-in live download check", url != null && hash != null)
        val file = Files.createTempFile("mail-update-check-", ".apk").toFile()
        try {
            var progress = 0f
            UpdateDownload.download(url!!, hash, file) { progress = it }
            assertEquals(1f, progress, 0f)
        } finally { file.delete() }
    }
}
