package com.batabitoo.mailcenter.data

import android.content.Context
import android.net.Uri
import android.webkit.MimeTypeMap
import androidx.core.content.FileProvider
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.flow.flowOn
import kotlinx.coroutines.isActive
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.io.File
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder
import java.security.MessageDigest
import java.security.SecureRandom
import android.util.Base64

class ApiException(
    val statusCode: Int,
    val apiCode: String? = null,
    val responseBody: String = "",
    message: String = "HTTP $statusCode",
) : IOException(message) {
    val code: String? get() = apiCode
}

data class DownloadedAttachment(
    val uri: Uri,
    val file: File,
    val filename: String,
    val contentType: String,
)

class MailRepository(context: Context) {
    private val appContext = context.applicationContext
    private val preferences = appContext.getSharedPreferences("mail_center", Context.MODE_PRIVATE)

    var baseUrl: String
        get() {
            val stored = preferences.getString(KEY_BASE_URL, null) ?: return DEFAULT_BASE_URL
            val normalized = normalizeUrl(stored)
            if (normalized in LEGACY_BASE_URLS) {
                preferences.edit().putString(KEY_BASE_URL, DEFAULT_BASE_URL).apply()
                return DEFAULT_BASE_URL
            }
            return normalized
        }
        private set(value) = preferences.edit().putString(KEY_BASE_URL, normalizeUrl(value)).apply()

    var sessionToken: String?
        get() = preferences.getString(KEY_SESSION_TOKEN, null)
        private set(value) = preferences.edit().putString(KEY_SESSION_TOKEN, value).apply()

    // Recover the credential saved by previous personal releases so upgrading
    // does not discard authorization and turn a populated mailbox into zeros.
    private var masterPin: String = preferences.getString("master_pin", "").orEmpty()

    fun updateBaseUrl(value: String) { baseUrl = value }

    fun updateMasterPin(pin: String) { masterPin = pin }

    fun authorizationHeaders(): Map<String, String> = sessionToken
        ?.takeIf { it.isNotBlank() }
        ?.let { mapOf("Authorization" to "Bearer $it") }
        ?: if (masterPin.isNotBlank()) mapOf("X-Master-PIN" to masterPin) else emptyMap()

    fun connectionUrl(): String {
        val verifier = Base64.encodeToString(ByteArray(32).also { SecureRandom().nextBytes(it) }, Base64.URL_SAFE or Base64.NO_WRAP or Base64.NO_PADDING)
        preferences.edit().putString("connection_verifier", verifier).apply()
        val challenge = Base64.encodeToString(MessageDigest.getInstance("SHA-256").digest(verifier.toByteArray()), Base64.URL_SAFE or Base64.NO_WRAP or Base64.NO_PADDING)
        return "$baseUrl/mobile-connect.html#challenge=$challenge"
    }

    suspend fun finishConnection(code: String) = withContext(Dispatchers.IO) {
        val verifier = preferences.getString("connection_verifier", null) ?: throw IOException("ابدأ الاتصال من هذا الجوال أولًا")
        val result = JSONObject(request("/api/mobile/exchange", "POST", JSONObject().put("code", code).put("verifier", verifier).toString(), skipAuth = true))
        sessionToken = result.getString("token")
        preferences.edit().putString("device_credential", result.getString("credential")).remove("connection_verifier").remove("master_pin").apply()
        masterPin = ""
    }

    suspend fun ensurePersonalAccess() = withContext(Dispatchers.IO) {
        if (preferences.getString("device_credential", null) == null && (!sessionToken.isNullOrBlank() || masterPin.isNotBlank())) {
            val result = JSONObject(request("/api/mobile/register", "POST", "{}"))
            preferences.edit().putString("device_credential", result.getString("credential")).apply()
            // Exchange the old saved PIN for a per-device credential. Never embed
            // a shared server secret in the APK or require a PIN screen.
            if (refreshSession()) {
                masterPin = ""
                preferences.edit().remove("master_pin").apply()
            }
        }
    }

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
        val sysStatus = MailJson.status(request("/api/status"), currentVersionCode)
        val ver = sysStatus.appVersion ?: runCatching { appVersion(currentVersionCode) }.getOrNull()
        sysStatus.copy(appVersion = ver)
    }

    suspend fun appVersion(currentVersionCode: Int = 1): AppVersionInfo = withContext(Dispatchers.IO) {
        val fromServer = runCatching {
            MailJson.appVersion(request("/api/app/version"), currentVersionCode)
        }.getOrNull()

        if (fromServer != null && fromServer.latestVersionCode > 0) {
            return@withContext fromServer
        }

        AppVersionInfo(
            latestVersionCode = currentVersionCode,
            latestVersionName = "1.4.0",
            downloadUrl = "https://github.com/ahmedroou/batabitoo-mail-center/releases/download/v1.4.0/Batabitoo-Mail-Center-1.4.0.apk",
            releaseNotes = "تحديث الأمان وقاعدة بيانات Firebase السحابية وموثوقية الرسائل",
            mandatory = false,
            updatedAt = "",
            hasUpdate = false,
        )
    }

    suspend fun inboxes(): InboxesPayload = withContext(Dispatchers.IO) {
        MailJson.inboxes(request("/api/inboxes"))
    }

    suspend fun current(): CurrentPayload = withContext(Dispatchers.IO) {
        val fromServer = MailJson.current(request("/api/inbox/current"))

        if (fromServer.inbox != null) {
            val active = fromServer.inbox
            val mergedMessages = messages().messages.filter { message -> messageBelongsToInbox(message, active) }
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
        val suffix = type?.takeIf { it.isNotBlank() }?.let { "?type=${encodeQuery(it)}" }.orEmpty()
        MailJson.messages(request("/api/all-messages$suffix"))
    }

    suspend fun logs(): List<RegistrationLog> = withContext(Dispatchers.IO) {
        MailJson.logs(request("/api/nivea/logs"))
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
        val path = "/api/official/create"
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

    suspend fun gmailAccounts(): List<GmailAccount> = withContext(Dispatchers.IO) {
        MailJson.gmailAccounts(request("/api/gmail/accounts")).accounts
    }

    suspend fun getGmailAccounts(): List<GmailAccount> = gmailAccounts()

    suspend fun replyContext(id: String): ReplyContext = withContext(Dispatchers.IO) {
        val result = JSONObject(request("/api/messages/${encodePath(id)}/reply"))
        ReplyContext(result.getString("from"), result.getString("to"), result.getString("subject"))
    }

    suspend fun sendReply(draft: ReplyDraft): String = withContext(Dispatchers.IO) {
        val context = requireNotNull(draft.context)
        val body = JSONObject().put("text", draft.text).put("requestId", draft.requestId)
            .put("from", context.from).put("to", context.to).toString()
        val result = JSONObject(request("/api/messages/${encodePath(draft.messageId)}/reply", "POST", body, timeoutMs = 90000))
        if (!result.optBoolean("success")) throw IOException("تعذر تأكيد نتيجة الإرسال")
        result.getString("from")
    }

    suspend fun syncGmail(email: String): GmailActionResult = withContext(Dispatchers.IO) {
        val body = JSONObject().put("email", email.trim().lowercase()).toString()
        MailJson.gmailAction(request("/api/gmail/sync", "POST", body))
    }

    suspend fun syncGmailAccount(email: String): GmailActionResult = syncGmail(email)

    suspend fun disconnectGmail(email: String): GmailActionResult = withContext(Dispatchers.IO) {
        val body = JSONObject().put("email", email.trim().lowercase()).toString()
        MailJson.gmailAction(request("/api/gmail/disconnect", "POST", body))
    }

    suspend fun disconnectGmailAccount(email: String): GmailActionResult = disconnectGmail(email)

    suspend fun gmailOAuthAuthUrl(returnTo: String = DEFAULT_BASE_URL): OAuthAuthUrl = withContext(Dispatchers.IO) {
        val path = "/api/gmail/oauth/auth-url?return_to=${encodeQuery(returnTo)}"
        MailJson.oauthAuthUrl(request(path))
    }

    suspend fun getGmailOAuthAuthUrl(returnTo: String = DEFAULT_BASE_URL): OAuthAuthUrl = gmailOAuthAuthUrl(returnTo)

    suspend fun deletedAmazonAccounts(): List<DeletedAmazonAccount> = withContext(Dispatchers.IO) {
        MailJson.deletedAmazon(request("/api/amazon/deleted"))
    }

    suspend fun deleteAmazonAccount(email: String): AmazonAccountMutation = withContext(Dispatchers.IO) {
        val body = JSONObject().put("email", email.trim().lowercase()).toString()
        MailJson.amazonMutation(request("/api/amazon/delete", "POST", body))
    }

    suspend fun restoreAmazonAccount(email: String): AmazonAccountMutation = withContext(Dispatchers.IO) {
        val body = JSONObject().put("email", email.trim().lowercase()).toString()
        MailJson.amazonMutation(request("/api/amazon/restore", "POST", body))
    }

    suspend fun batchDeleteInboxes(ids: Collection<String>): BatchDeleteResult = withContext(Dispatchers.IO) {
        require(ids.isNotEmpty()) { "Inbox ids must not be empty" }
        val body = JSONObject().put("ids", org.json.JSONArray(ids.toList())).toString()
        MailJson.batchDelete(request("/api/inboxes/batch-delete", "POST", body))
    }

    suspend fun winningMessages(): WinningMessagesPayload = withContext(Dispatchers.IO) {
        MailJson.winningMessages(request("/api/messages/winning"))
    }

    suspend fun downloadAttachment(messageId: String, attachment: MailAttachment): DownloadedAttachment =
        downloadAttachment(messageId, attachment.id, attachment.filename, attachment.contentType)

    suspend fun downloadAttachment(
        messageId: String,
        attachmentId: String,
        filename: String = "attachment",
        contentType: String = "application/octet-stream",
    ): DownloadedAttachment = withContext(Dispatchers.IO) {
        val response = requestBytes(
            "/api/messages/${encodePath(messageId)}/attachments/${encodePath(attachmentId)}",
        )
        val safeName = safeFilename(filename)
        val attachmentDir = File(appContext.cacheDir, ATTACHMENT_CACHE_DIR).apply { mkdirs() }
        val cacheFile = File(attachmentDir, "${attachmentId.take(16)}-$safeName")
        cacheFile.outputStream().use { it.write(response.bytes) }

        val resolvedContentType = response.contentType
            .takeUnless { it.isBlank() || it == "application/octet-stream" }
            ?: contentType.takeUnless { it.isBlank() || it == "application/octet-stream" }
            ?: MimeTypeMap.getSingleton().getMimeTypeFromExtension(cacheFile.extension.lowercase())
            ?: "application/octet-stream"
        DownloadedAttachment(
            uri = FileProvider.getUriForFile(appContext, "${appContext.packageName}.fileprovider", cacheFile),
            file = cacheFile,
            filename = safeName,
            contentType = resolvedContentType,
        )
    }

    fun events(): Flow<String> = flow {
        while (currentCoroutineContext().isActive) {
            try {
                val connection = (URL("$baseUrl/api/events").openConnection() as HttpURLConnection).apply {
                    requestMethod = "GET"
                    connectTimeout = NETWORK_TIMEOUT_MS
                    readTimeout = 0
                    setRequestProperty("Accept", "text/event-stream")
                    sessionToken?.takeIf { it.isNotBlank() }?.let {
                        setRequestProperty("Authorization", "Bearer $it")
                    }
                }
                if (connection.responseCode !in 200..299) throw IOException("SSE HTTP ${connection.responseCode}")
                connection.inputStream.bufferedReader().use { reader ->
                    var eventName = "message"
                    while (currentCoroutineContext().isActive) {
                        val line = reader.readLine() ?: break
                        when {
                            line.startsWith("event:") -> eventName = line.substringAfter("event:").trim()
                            line.startsWith("data:") -> emit(eventName)
                        }
                    }
                }
                connection.disconnect()
            } catch (_: Exception) {
                delay(5_000)
            }
        }
    }.flowOn(Dispatchers.IO)

    private fun request(
        path: String,
        method: String = "GET",
        body: String? = null,
        skipAuth: Boolean = false,
        allowReauth: Boolean = true,
        timeoutMs: Int = NETWORK_TIMEOUT_MS,
    ): String {
        val url = URL("$baseUrl$path")
        val connection = (url.openConnection() as HttpURLConnection).apply {
            requestMethod = method
            connectTimeout = NETWORK_TIMEOUT_MS
            readTimeout = timeoutMs
            setRequestProperty("Accept", "application/json")
            if (!skipAuth) applyAuthentication(this)
            if (body != null) {
                doOutput = true
                setRequestProperty("Content-Type", "application/json; charset=UTF-8")
                outputStream.use { it.write(body.toByteArray(Charsets.UTF_8)) }
            }
        }

        val code = connection.responseCode
        val raw = if (code in 200..299) {
            connection.inputStream.bufferedReader().use { it.readText() }
        } else {
            connection.errorStream?.bufferedReader()?.use { it.readText() }.orEmpty()
        }
        connection.disconnect()

        if (code == HttpURLConnection.HTTP_UNAUTHORIZED && !skipAuth && allowReauth && refreshSession()) {
            return request(path, method, body, skipAuth = false, allowReauth = false, timeoutMs = timeoutMs)
        }

        if (code !in 200..299) {
            throw apiException(code, raw)
        }

        return raw
    }

    private data class BinaryResponse(val bytes: ByteArray, val contentType: String)

    private fun requestBytes(path: String, allowReauth: Boolean = true): BinaryResponse {
        val connection = (URL("$baseUrl$path").openConnection() as HttpURLConnection).apply {
            requestMethod = "GET"
            connectTimeout = NETWORK_TIMEOUT_MS
            readTimeout = NETWORK_TIMEOUT_MS
            setRequestProperty("Accept", "*/*")
            applyAuthentication(this)
        }
        val code = connection.responseCode
        val contentType = connection.contentType?.substringBefore(';')?.trim().orEmpty()
        val bytes = if (code in 200..299) {
            connection.inputStream.use { it.readBytes() }
        } else {
            connection.errorStream?.use { it.readBytes() } ?: ByteArray(0)
        }
        connection.disconnect()

        if (code == HttpURLConnection.HTTP_UNAUTHORIZED && allowReauth && refreshSession()) {
            return requestBytes(path, allowReauth = false)
        }
        if (code !in 200..299) {
            throw apiException(code, bytes.toString(Charsets.UTF_8))
        }
        return BinaryResponse(bytes, contentType)
    }

    private fun applyAuthentication(connection: HttpURLConnection) {
        val token = sessionToken
        if (!token.isNullOrBlank()) {
            connection.setRequestProperty("Authorization", "Bearer $token")
        } else if (masterPin.isNotBlank()) {
            connection.setRequestProperty("X-Master-PIN", masterPin)
        }
    }

    @Synchronized
    private fun refreshSession(): Boolean {
        val credential = preferences.getString("device_credential", null)
        if (!credential.isNullOrBlank()) {
            val renewed = runCatching {
                val result = JSONObject(request("/api/mobile/refresh", "POST", JSONObject().put("credential", credential).toString(), skipAuth = true, allowReauth = false))
                sessionToken = result.getString("token")
                true
            }.getOrDefault(false)
            if (renewed) return true
        }
        if (masterPin.isBlank()) return false
        return runCatching {
            val loginBody = JSONObject().put("pin", masterPin).toString()
            val response = request(
                "/api/auth/login",
                method = "POST",
                body = loginBody,
                skipAuth = true,
                allowReauth = false,
            )
            val newToken = JSONObject(response).optString("token")
            if (newToken.isBlank()) false else {
                sessionToken = newToken
                true
            }
        }.getOrDefault(false)
    }

    private fun apiException(statusCode: Int, raw: String): ApiException {
        val payload = runCatching { JSONObject(raw) }.getOrNull()
        val apiCode = payload?.optString("code")?.takeIf { it.isNotBlank() }
        val message = payload?.optString("error")?.takeIf { it.isNotBlank() }
            ?: payload?.optString("message")?.takeIf { it.isNotBlank() }
            ?: "HTTP $statusCode"
        return ApiException(statusCode, apiCode, raw, message)
    }

    private fun encodePath(value: String): String = URLEncoder.encode(value, Charsets.UTF_8.name()).replace("+", "%20")
    private fun encodeQuery(value: String): String = URLEncoder.encode(value, Charsets.UTF_8.name())
    private fun safeFilename(value: String): String {
        val sanitized = value.substringAfterLast('/').substringAfterLast('\\')
            .replace(Regex("""[^\p{L}\p{N}._() -]"""), "_")
            .trim()
            .take(120)
        return sanitized.takeUnless { it.isBlank() || it == "." || it == ".." } ?: "attachment"
    }

    private fun normalizeUrl(value: String): String {
        val trimmed = value.trim().trimEnd('/')
        return when {
            trimmed.startsWith("http://") || trimmed.startsWith("https://") -> trimmed
            trimmed.isBlank() -> DEFAULT_BASE_URL
            else -> "https://$trimmed"
        }
    }

    companion object {
        const val DEFAULT_BASE_URL = "https://batabitoo-mail-2026.web.app"
        const val NETWORK_TIMEOUT_MS = 25_000
        private const val ATTACHMENT_CACHE_DIR = "mail_attachments"
        private val LEGACY_BASE_URLS = setOf(
            "https://inbox-api.batabitoo.com",
            "http://inbox-api.batabitoo.com",
        )
        private const val KEY_BASE_URL = "base_url"
        private const val KEY_SESSION_TOKEN = "session_token"
    }
}
