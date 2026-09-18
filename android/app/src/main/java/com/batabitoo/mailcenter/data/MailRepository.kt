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

    var sessionToken: String?
        get() = preferences.getString(KEY_SESSION_TOKEN, null)
        private set(value) = preferences.edit().putString(KEY_SESSION_TOKEN, value).apply()

    var masterPin: String
        get() = preferences.getString(KEY_MASTER_PIN, "") ?: ""
        private set(value) = preferences.edit().putString(KEY_MASTER_PIN, value).apply()

    fun updateBaseUrl(value: String) { baseUrl = value }

    fun updateMasterPin(pin: String) { masterPin = pin }

    suspend fun login(pin: String): Boolean = withContext(Dispatchers.IO) {
        masterPin = pin
        val body = JSONObject().apply { put("pin", pin) }.toString()
        val res = runCatching { request("/api/auth/login", "POST", body, skipAuth = true) }.getOrNull() ?: return@withContext false
        val token = runCatching { JSONObject(res).optString("token") }.getOrNull()
        if (!token.isNullOrBlank()) {
            sessionToken = token
            true
        } else false
    }

    suspend fun logout() = withContext(Dispatchers.IO) {
        runCatching { request("/api/auth/logout", "POST", null) }
        sessionToken = null
    }

    suspend fun status(currentVersionCode: Int = 1): SystemStatus = withContext(Dispatchers.IO) {
        val sysStatus = runCatching {
            MailJson.status(fetchCached("status", "/api/status"), currentVersionCode)
        }.getOrElse {
            SystemStatus(online = true, cloudConnected = false, projectId = "batabitoo-mail-2026")
        }
        val ver = sysStatus.appVersion ?: runCatching { appVersion(currentVersionCode) }.getOrNull()
        sysStatus.copy(appVersion = ver)
    }

    suspend fun appVersion(currentVersionCode: Int = 1): AppVersionInfo = withContext(Dispatchers.IO) {
        val fromServer = runCatching {
            MailJson.appVersion(fetchCached("app_version", "/api/app/version"), currentVersionCode)
        }.getOrNull()

        if (fromServer != null && fromServer.latestVersionCode > 0) {
            return@withContext fromServer
        }

        val cachedRaw = preferences.getString("cache_app_version", null)
        if (!cachedRaw.isNullOrBlank()) {
            val cached = runCatching { MailJson.appVersion(cachedRaw, currentVersionCode) }.getOrNull()
            if (cached != null) return@withContext cached
        }

        AppVersionInfo(
            latestVersionCode = currentVersionCode,
            latestVersionName = "1.4.0",
            downloadUrl = "https://github.com/ahmedroou/batabitoo-mail-center/releases/download/v1.4.0/Batabitoo-Mail-Center-1.4.0.apk",
            releaseNotes = "تحديث الأمان وقاعدة البيانات المحلية وموثوقية الرسائل",
            mandatory = false,
            updatedAt = "",
            hasUpdate = false,
        )
    }

    suspend fun inboxes(): InboxesPayload = withContext(Dispatchers.IO) {
        val fromServer = runCatching {
            MailJson.inboxes(fetchCached("inboxes", "/api/inboxes"))
        }.getOrNull()

        if (fromServer != null) {
            return@withContext fromServer
        }

        val cachedRaw = preferences.getString("cache_inboxes", null)
        if (!cachedRaw.isNullOrBlank()) {
            runCatching { MailJson.inboxes(cachedRaw) }.getOrNull() ?: InboxesPayload()
        } else {
            InboxesPayload()
        }
    }

    suspend fun current(): CurrentPayload = withContext(Dispatchers.IO) {
        val fromServer = runCatching {
            MailJson.current(fetchCached("current", "/api/inbox/current"))
        }.getOrNull()

        if (fromServer != null && fromServer.inbox != null) {
            val active = fromServer.inbox
            val mergedMessages = messages().messages.filter { message ->
                message.inboxEmail.equals(active.email, ignoreCase = true) ||
                    message.to.contains(active.email, ignoreCase = true)
            }
            return@withContext fromServer.copy(messages = mergedMessages.ifEmpty { fromServer.messages })
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

        if (fromServer != null) {
            return@withContext fromServer
        }

        val cachedRaw = preferences.getString("cache_messages_${type ?: "all"}", null)
        if (!cachedRaw.isNullOrBlank()) {
            runCatching { MailJson.messages(cachedRaw) }.getOrNull() ?: MessagesPayload()
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

    suspend fun createInbox(official: Boolean, name: String, prefix: String, exact: Boolean = true, domain: String = "batabitoo.com"): Inbox = withContext(Dispatchers.IO) {
        val body = JSONObject().apply {
            if (name.isNotBlank()) {
                put("personName", name)
                put("label", name)
            }
            if (prefix.isNotBlank()) {
                put("prefix", prefix)
                if (prefix.contains("@")) {
                    put("email", prefix)
                }
                if (official) {
                    put("exact", exact)
                    put("domain", domain)
                }
            }
        }
        val path = if (official) "/api/official/create" else "/api/inboxes/create"
        MailJson.createdInbox(request(path, "POST", body.toString()))
    }

    suspend fun createDottedGmailInbox(parentEmail: String, dottedEmail: String, label: String): Inbox = withContext(Dispatchers.IO) {
        val cleanParent = parentEmail.trim().lowercase()
        val cleanDotted = dottedEmail.trim().lowercase()
        val cleanLabel = label.trim().ifBlank { cleanDotted.substringBefore('@') }

        val backendBody = JSONObject().apply {
            put("personName", cleanLabel)
            put("label", cleanLabel)
            put("prefix", cleanDotted)
            put("email", cleanDotted)
            put("domain", "gmail.com")
            put("parentEmail", cleanParent)
            put("isDottedGmailAlias", true)
            put("isAmazon", true)
        }
        MailJson.createdInbox(request("/api/official/create", "POST", backendBody.toString()))
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
        val body = JSONObject().apply {
            put("id", id)
            put("banStatus", status)
            if (reason.isNotBlank()) put("reason", reason)
        }
        request("/api/inbox/ban-status", "POST", body.toString())
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

    private fun request(path: String, method: String = "GET", body: String? = null, skipAuth: Boolean = false): String {
        val url = URL("$baseUrl$path")
        val connection = (url.openConnection() as HttpURLConnection).apply {
            requestMethod = method
            connectTimeout = 8000
            readTimeout = 8000
            setRequestProperty("Accept", "application/json")
            if (!skipAuth) {
                val token = sessionToken
                if (!token.isNullOrBlank()) {
                    setRequestProperty("Authorization", "Bearer $token")
                } else if (masterPin.isNotBlank()) {
                    setRequestProperty("X-Master-PIN", masterPin)
                }
            }
            if (body != null) {
                doOutput = true
                setRequestProperty("Content-Type", "application/json; charset=UTF-8")
                outputStream.use { it.write(body.toByteArray(Charsets.UTF_8)) }
            }
        }

        val code = connection.responseCode
        if (code == 401 && !skipAuth && masterPin.isNotBlank()) {
            val loginOk = runCatching {
                val loginBody = JSONObject().apply { put("pin", masterPin) }.toString()
                val res = request("/api/auth/login", "POST", loginBody, skipAuth = true)
                val newToken = JSONObject(res).optString("token")
                if (newToken.isNotBlank()) {
                    sessionToken = newToken
                    true
                } else false
            }.getOrDefault(false)

            if (loginOk) {
                return request(path, method, body, skipAuth = false)
            }
        }

        val stream = if (code in 200..299) connection.inputStream else connection.errorStream ?: connection.inputStream
        val raw = stream.bufferedReader().use { it.readText() }

        if (code !in 200..299) {
            val errorMessage = runCatching { JSONObject(raw).optString("error") }.getOrNull()
            throw IOException(errorMessage?.ifBlank { null } ?: "HTTP $code")
        }

        return raw
    }

    private fun encodePath(value: String): String = URLEncoder.encode(value, Charsets.UTF_8.name()).replace("+", "%20")
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
        private const val KEY_BASE_URL = "base_url"
        private const val KEY_SESSION_TOKEN = "session_token"
        private const val KEY_MASTER_PIN = "master_pin"
    }
}
