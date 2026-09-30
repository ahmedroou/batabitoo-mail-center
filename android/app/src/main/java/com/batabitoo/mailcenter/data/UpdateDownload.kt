package com.batabitoo.mailcenter.data

import java.io.File
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest

object UpdateDownload {
    private val hosts = setOf("github.com", "release-assets.githubusercontent.com", "objects.githubusercontent.com", "batabitoo-mail-2026.web.app", "batabitoo-mail-2026.firebaseapp.com", "batabitoo.com", "inbox-api.batabitoo.com")
    private const val MAX_BYTES = 100L * 1024 * 1024

    fun trustedUrl(value: String): URL {
        val url = URL(value)
        require(url.protocol == "https" && url.host.lowercase() in hosts && url.userInfo == null && url.port in listOf(-1, 443)) {
            "رابط التحديث غير موثوق أو غير مشفر. حدّث بيانات الإصدار وحاول مجددًا."
        }
        return url
    }

    fun download(source: String, expectedHash: String?, file: File, onProgress: (Float) -> Unit) {
        val expected = expectedHash?.trim().orEmpty()
        require(Regex("[a-fA-F0-9]{64}").matches(expected)) { "بصمة أمان التحديث مفقودة أو غير صالحة. أعد جلب الإصدار." }
        var url = trustedUrl(source)
        try {
            repeat(6) {
                val connection = (url.openConnection() as HttpURLConnection).apply {
                    instanceFollowRedirects = false
                    connectTimeout = 15000
                    readTimeout = 30000
                    setRequestProperty("Accept", "application/vnd.android.package-archive, application/octet-stream")
                }
                try {
                    val status = connection.responseCode
                    if (status in listOf(301, 302, 303, 307, 308)) {
                        val location = connection.getHeaderField("Location") ?: throw IOException("رابط التحويل مفقود")
                        url = trustedUrl(URL(url, location).toString())
                        return@repeat
                    }
                    if (status != 200) throw IOException("خادم التحديث أعاد HTTP $status. حاول مجددًا.")
                    if (connection.contentType.orEmpty().contains("text/html", true)) throw IOException("الرابط أعاد صفحة ويب وليس ملف تطبيق")
                    val length = connection.contentLengthLong
                    if (length > MAX_BYTES) throw IOException("حجم ملف التحديث غير متوقع")
                    val digest = MessageDigest.getInstance("SHA-256")
                    var total = 0L
                    connection.inputStream.use { input ->
                        file.outputStream().use { output ->
                            val buffer = ByteArray(16384)
                            while (true) {
                                val count = input.read(buffer)
                                if (count < 0) break
                                total += count
                                if (total > MAX_BYTES) throw IOException("حجم ملف التحديث غير متوقع")
                                output.write(buffer, 0, count)
                                digest.update(buffer, 0, count)
                                if (length > 0) onProgress((total.toFloat() / length).coerceIn(0f, 1f))
                            }
                        }
                    }
                    val actual = digest.digest().joinToString("") { "%02x".format(it) }
                    if (!actual.equals(expected, true)) throw SecurityException("ملف التحديث لا يطابق البصمة المنشورة. أعد جلب الإصدار وحاول مجددًا.")
                    onProgress(1f)
                    return
                } finally { connection.disconnect() }
            }
            throw IOException("تحويلات كثيرة في رابط التحديث")
        } catch (error: Exception) {
            file.delete()
            throw error
        }
    }
}
