package com.batabitoo.mailcenter.data

import android.content.Context
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder

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
        val fromServer = runCatching {
            MailJson.inboxes(fetchCached("inboxes", "/api/inboxes"))
        }.getOrNull()

        val fromFirestore = runCatching {
            val raw = directGet(FIRESTORE_INBOXES_URL)
            preferences.edit().putString("cache_inboxes_firestore_raw", raw).apply()
            MailJson.firestoreInboxes(raw)
        }.getOrNull()

        if (fromServer != null && (fromServer.official.isNotEmpty() || fromServer.temp.isNotEmpty())) {
            // The edge inbox service can be behind on ban fields. Merge only account
            // classification metadata from Firestore while keeping its complete list.
            val cloudById = fromFirestore?.official.orEmpty().associateBy { it.id }
            val cloudByEmail = fromFirestore?.official.orEmpty().associateBy { it.email.lowercase() }
            val official = fromServer.official.map { inbox ->
                val cloud = cloudById[inbox.id] ?: cloudByEmail[inbox.email.lowercase()]
                if (cloud == null) inbox else inbox.copy(
                    isAmazon = cloud.isAmazon,
                    isBanned = cloud.isBanned,
                    banStatus = cloud.banStatus,
                    banReason = cloud.banReason.ifBlank { inbox.banReason },
                )
            }
            return@withContext InboxesPayload(
                activeId = fromServer.activeId,
                official = official,
                temp = fromServer.temp,
                amazon = official.filter { it.isAmazon },
                banned = official.filter { it.isConfirmedBanned },
                suspected = official.filter { it.isSuspected },
            )
        }

        if (fromFirestore != null && (fromFirestore.official.isNotEmpty() || fromFirestore.temp.isNotEmpty())) {
            return@withContext fromFirestore
        }

        val cachedRaw = preferences.getString("cache_inboxes_firestore_raw", null)
        if (!cachedRaw.isNullOrBlank()) {
            runCatching { MailJson.firestoreInboxes(cachedRaw) }.getOrNull() ?: InboxesPayload()
        } else {
            InboxesPayload()
        }
    }

    suspend fun current(): CurrentPayload = withContext(Dispatchers.IO) {
        val fromServer = runCatching {
            MailJson.current(fetchCached("current", "/api/inbox/current"))
        }.getOrNull()

        if (fromServer != null && fromServer.inbox != null) {
            return@withContext fromServer
        }

        val inboxesPayload = inboxes()
        val messagesPayload = messages()
        CurrentPayload(
            inbox = inboxesPayload.official.firstOrNull() ?: inboxesPayload.temp.firstOrNull(),
            messages = messagesPayload.messages,
        )
    }

    suspend fun messages(type: String? = null): MessagesPayload = withContext(Dispatchers.IO) {
        val suffix = type?.let { "?type=$it" }.orEmpty()
        val fromServer = runCatching {
            MailJson.messages(fetchCached("messages_${type ?: "all"}", "/api/all-messages$suffix"))
        }.getOrNull()

        if (fromServer != null && fromServer.messages.isNotEmpty()) {
            return@withContext fromServer
        }

        val fromFirestore = runCatching {
            val raw = directGet(FIRESTORE_MESSAGES_URL)
            preferences.edit().putString("cache_messages_firestore_raw", raw).apply()
            MailJson.firestoreMessages(raw)
        }.getOrNull()

        if (fromFirestore != null && fromFirestore.messages.isNotEmpty()) {
            return@withContext fromFirestore
        }

        val cachedRaw = preferences.getString("cache_messages_firestore_raw", null)
        if (!cachedRaw.isNullOrBlank()) {
            runCatching { MailJson.firestoreMessages(cachedRaw) }.getOrNull() ?: MessagesPayload()
        } else {
            MessagesPayload()
        }
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

    suspend fun setBanStatus(id: String, status: String, reason: String = ""): String = withContext(Dispatchers.IO) {
        val serverResult = runCatching {
            val body = JSONObject().apply {
                put("id", id)
                put("banStatus", status)
                if (reason.isNotBlank()) put("reason", reason)
            }
            request("/api/inbox/ban-status", "POST", body.toString())
        }.getOrNull()

        if (!serverResult.isNullOrBlank() && !serverResult.contains("Not found", ignoreCase = true) && !serverResult.contains("error", ignoreCase = true)) {
            return@withContext serverResult
        }

        // Direct 24/7 Firestore REST API fallback
        val firestoreResult = runCatching {
            val docId = if (id.contains("@")) "inbox_${id.lowercase().replace(Regex("[^a-z0-9]"), "_")}" else id
            val updateUrl = "https://firestore.googleapis.com/v1/projects/batabitoo-mail-2026/databases/(default)/documents/inboxes/${URLEncoder.encode(docId, "UTF-8")}?updateMask.fieldPaths=banStatus&updateMask.fieldPaths=isBanned"
            val fieldsObj = JSONObject().apply {
                put("banStatus", JSONObject().put("stringValue", status))
                put("isBanned", JSONObject().put("booleanValue", status == "confirmed"))
                if (reason.isNotBlank()) {
                    put("banReason", JSONObject().put("stringValue", reason))
                }
            }
            val payload = JSONObject().put("fields", fieldsObj)
            val conn = (URL(updateUrl).openConnection() as HttpURLConnection).apply {
                requestMethod = "PATCH"
                doOutput = true
                connectTimeout = 8000
                readTimeout = 8000
                setRequestProperty("Content-Type", "application/json")
                outputStream.write(payload.toString().toByteArray(Charsets.UTF_8))
            }
            if (conn.responseCode in 200..299) {
                "{\"success\":true,\"firestore\":true}"
            } else null
        }.getOrNull()

        firestoreResult ?: throw IOException("تعذر حفظ حالة الحساب في الخدمة العامة والتخزين السحابي")
    }

    suspend fun triggerAiVerify(id: String): String = withContext(Dispatchers.IO) {
        val body = JSONObject().apply { put("id", id) }
        request("/api/inbox/ai-verify", "POST", body.toString())
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
        val url = URL("$baseUrl$path")
        val connection = (url.openConnection() as HttpURLConnection).apply {
            requestMethod = method
            connectTimeout = 8000
            readTimeout = 8000
            setRequestProperty("Accept", "application/json")
            if (body != null) {
                doOutput = true
                setRequestProperty("Content-Type", "application/json; charset=UTF-8")
                outputStream.use { it.write(body.toByteArray(Charsets.UTF_8)) }
            }
        }

        val code = connection.responseCode
        val stream = if (code in 200..299) connection.inputStream else connection.errorStream ?: connection.inputStream
        val raw = stream.bufferedReader().use { it.readText() }

        if (code !in 200..299) {
            val errorMessage = runCatching { JSONObject(raw).optString("error") }.getOrNull()
            throw IOException(errorMessage?.ifBlank { null } ?: "HTTP $code")
        }

        return raw
    }

    private fun directGet(urlStr: String): String {
        val url = URL(urlStr)
        val connection = (url.openConnection() as HttpURLConnection).apply {
            requestMethod = "GET"
            connectTimeout = 8000
            readTimeout = 8000
            setRequestProperty("Accept", "application/json")
        }
        val code = connection.responseCode
        val stream = if (code in 200..299) connection.inputStream else connection.errorStream ?: connection.inputStream
        val raw = stream.bufferedReader().use { it.readText() }
        if (code !in 200..299) {
            throw IOException("Firestore HTTP $code")
        }
        return raw
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
        const val FIRESTORE_INBOXES_URL = "https://firestore.googleapis.com/v1/projects/batabitoo-mail-2026/databases/(default)/documents/inboxes?pageSize=300"
        const val FIRESTORE_MESSAGES_URL = "https://firestore.googleapis.com/v1/projects/batabitoo-mail-2026/databases/(default)/documents/messages?pageSize=300"
        private const val KEY_BASE_URL = "base_url"
    }
}
