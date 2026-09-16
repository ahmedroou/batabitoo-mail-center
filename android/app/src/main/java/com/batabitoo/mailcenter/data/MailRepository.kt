package com.batabitoo.mailcenter.data

import android.content.Context
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL

class MailRepository(context: Context) {
    private val preferences = context.getSharedPreferences("mail_center", Context.MODE_PRIVATE)

    var baseUrl: String
        get() = preferences.getString(KEY_BASE_URL, DEFAULT_BASE_URL) ?: DEFAULT_BASE_URL
        private set(value) = preferences.edit().putString(KEY_BASE_URL, normalizeUrl(value)).apply()

    fun updateBaseUrl(value: String) { baseUrl = value }

    suspend fun status(currentVersionCode: Int = 1): SystemStatus = withContext(Dispatchers.IO) {
        val sysStatus = runCatching {
            MailJson.status(fetchCached("status", "/api/status"), currentVersionCode)
        }.getOrElse {
            SystemStatus(online = true, cloudConnected = true, projectId = "batabitoo-mail-2026")
        }
        val ver = sysStatus.appVersion ?: runCatching { appVersion(currentVersionCode) }.getOrNull()
        sysStatus.copy(appVersion = ver)
    }

    suspend fun appVersion(currentVersionCode: Int = 1): AppVersionInfo = withContext(Dispatchers.IO) {
        // 1. Direct Cloud Firestore REST API (highest reliability & 100% uptime, no worker/tunnel dependencies)
        val fromFirestore = runCatching {
            val raw = directGet(FIRESTORE_VERSION_URL)
            preferences.edit().putString("cache_app_version_raw", raw).apply()
            MailJson.firestoreAppVersion(raw, currentVersionCode)
        }.getOrNull()

        if (fromFirestore != null && fromFirestore.latestVersionCode > 0) {
            return@withContext fromFirestore
        }

        // 2. Fallback to /api/app/version on configured server
        val fromServer = runCatching {
            MailJson.appVersion(fetchCached("app_version", "/api/app/version"), currentVersionCode)
        }.getOrNull()

        if (fromServer != null && fromServer.latestVersionCode > 0) {
            return@withContext fromServer
        }

        // 3. Fallback to cached Firestore version if offline
        val cachedRaw = preferences.getString("cache_app_version_raw", null)
        if (!cachedRaw.isNullOrBlank()) {
            val cached = runCatching { MailJson.firestoreAppVersion(cachedRaw, currentVersionCode) }.getOrNull()
            if (cached != null) return@withContext cached
        }

        // 4. Safe default
        AppVersionInfo(
            latestVersionCode = currentVersionCode,
            latestVersionName = "1.2.0",
            downloadUrl = "https://github.com/ahmedroou/batabitoo-releases/releases/download/v1.2.0/Batabitoo-Mail-Center-1.2.0.apk",
            releaseNotes = "إصلاح شامل لعرض وقراءة البريد ليماثل Gmail، صفحة أمازون المستقلة بتصميم حركي، تنقية أسماء المرسلين.",
            mandatory = false,
            updatedAt = "",
            hasUpdate = false,
        )
    }

    suspend fun inboxes(): InboxesPayload = withContext(Dispatchers.IO) {
        MailJson.inboxes(fetchCached("inboxes", "/api/inboxes"))
    }

    suspend fun current(): CurrentPayload = withContext(Dispatchers.IO) {
        MailJson.current(fetchCached("current", "/api/inbox/current"))
    }

    suspend fun messages(type: String? = null): MessagesPayload = withContext(Dispatchers.IO) {
        val suffix = type?.let { "?type=$it" }.orEmpty()
        MailJson.messages(fetchCached("messages_${type ?: "all"}", "/api/all-messages$suffix"))
    }

    suspend fun logs(): List<RegistrationLog> = withContext(Dispatchers.IO) {
        MailJson.logs(fetchCached("logs", "/api/nivea/logs"))
    }

    suspend fun selectInbox(id: String) = withContext(Dispatchers.IO) {
        request("/api/inboxes/select", "POST", JSONObject().put("id", id).toString())
    }

    suspend fun createInbox(official: Boolean, name: String, prefix: String, exact: Boolean = true): Inbox = withContext(Dispatchers.IO) {
        val body = JSONObject().apply {
            if (name.isNotBlank()) {
                put("personName", name)
                put("label", name)
            }
            if (prefix.isNotBlank()) {
                put("prefix", prefix)
                if (official) put("exact", exact)
            }
        }
        val path = if (official) "/api/official/create" else "/api/inboxes/create"
        MailJson.createdInbox(request(path, "POST", body.toString()))
    }

    suspend fun deleteInbox(id: String) = withContext(Dispatchers.IO) {
        request("/api/inboxes/${encodePath(id)}", "DELETE")
    }

    suspend fun message(id: String): MailMessage = withContext(Dispatchers.IO) {
        MailJson.message(request("/api/messages/${encodePath(id)}"))
    }

    suspend fun storageStats(): StorageStats = withContext(Dispatchers.IO) {
        MailJson.storageStats(request("/api/storage/status"))
    }

    suspend fun cleanupStorage(): StorageStats = withContext(Dispatchers.IO) {
        request("/api/storage/cleanup", "POST", "{}")
        storageStats()
    }

    private fun fetchCached(key: String, path: String): String {
        return try {
            val value = request(path)
            preferences.edit().putString("cache_$key", value).apply()
            value
        } catch (error: Exception) {
            preferences.getString("cache_$key", null) ?: throw error
        }
    }

    private fun request(path: String, method: String = "GET", body: String? = null): String {
        val connection = (URL(baseUrl.trimEnd('/') + path).openConnection() as HttpURLConnection).apply {
            requestMethod = method
            connectTimeout = 12_000
            readTimeout = 15_000
            setRequestProperty("Accept", "application/json")
            useCaches = false
            if (body != null) {
                doOutput = true
                setRequestProperty("Content-Type", "application/json; charset=utf-8")
            }
        }
        try {
            if (body != null) connection.outputStream.use { it.write(body.toByteArray(Charsets.UTF_8)) }
            val status = connection.responseCode
            val stream = if (status in 200..299) connection.inputStream else connection.errorStream
            val raw = stream?.bufferedReader(Charsets.UTF_8)?.use { it.readText() }.orEmpty()
            if (status !in 200..299) {
                val message = runCatching { JSONObject(raw).optString("error") }.getOrNull().orEmpty()
                throw IOException(message.ifBlank { "خطأ من الخادم ($status)" })
            }
            return raw
        } finally {
            connection.disconnect()
        }
    }

    private fun directGet(fullUrl: String): String {
        val connection = (URL(fullUrl).openConnection() as HttpURLConnection).apply {
            requestMethod = "GET"
            connectTimeout = 8_000
            readTimeout = 10_000
            setRequestProperty("Accept", "application/json")
            useCaches = false
        }
        try {
            val status = connection.responseCode
            val stream = if (status in 200..299) connection.inputStream else connection.errorStream
            val raw = stream?.bufferedReader(Charsets.UTF_8)?.use { it.readText() }.orEmpty()
            if (status !in 200..299) throw IOException("HTTP $status: $raw")
            return raw
        } finally {
            connection.disconnect()
        }
    }

    private fun encodePath(value: String): String = java.net.URLEncoder.encode(value, Charsets.UTF_8.name()).replace("+", "%20")
    private fun normalizeUrl(value: String): String {
        val trimmed = value.trim().trimEnd('/')
        return when {
            trimmed.startsWith("http://") || trimmed.startsWith("https://") -> trimmed
            trimmed.isBlank() -> DEFAULT_BASE_URL
            else -> "https://$trimmed"
        }
    }

    companion object {
        const val DEFAULT_BASE_URL = "https://inbox-api.batabitoo.com"
        const val FIRESTORE_VERSION_URL = "https://firestore.googleapis.com/v1/projects/batabitoo-mail-2026/databases/(default)/documents/app_config/version"
        private const val KEY_BASE_URL = "base_url"
    }
}
