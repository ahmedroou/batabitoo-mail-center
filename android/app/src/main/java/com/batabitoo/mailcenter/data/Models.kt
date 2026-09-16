package com.batabitoo.mailcenter.data

import org.json.JSONArray
import org.json.JSONObject

data class Counts(
    val totalInboxes: Int = 0,
    val official: Int = 0,
    val temp: Int = 0,
    val amazon: Int = 0,
    val banned: Int = 0,
    val messages: Int = 0,
)

data class AppVersionInfo(
    val latestVersionCode: Int = 1,
    val latestVersionName: String = "1.0.0",
    val downloadUrl: String = "",
    val releaseNotes: String = "",
    val mandatory: Boolean = false,
    val updatedAt: String = "",
    val hasUpdate: Boolean = false,
)

data class SystemStatus(
    val online: Boolean = false,
    val cloudConnected: Boolean = false,
    val projectId: String = "",
    val counts: Counts = Counts(),
    val appVersion: AppVersionInfo? = null,
)

data class StorageStats(
    val diskUsageBytes: Long = 0,
    val diskUsageFormatted: String = "0 MB",
    val messageDirsCount: Int = 0,
    val totalInboxes: Int = 0,
    val totalMessages: Int = 0,
    val officialInboxes: Int = 0,
    val tempInboxes: Int = 0,
    val isCloudConnected: Boolean = false,
)

data class Inbox(
    val id: String,
    val email: String,
    val domain: String = "",
    val host: String = "",
    val label: String = "",
    val personName: String = "",
    val isOfficial: Boolean = false,
    val isAmazon: Boolean = false,
    val isBanned: Boolean = false,
    val banReason: String = "",
    val type: String = "temp",
    val messageCount: Int = 0,
    val createdAt: String = "",
)

data class MailMessage(
    val id: String,
    val from: String = "",
    val to: String = "",
    val inboxEmail: String = "",
    val subject: String = "",
    val intro: String = "",
    val text: String = "",
    val html: String = "",
    val otp: String = "",
    val createdAt: String = "",
    val isOfficial: Boolean = false,
    val isAmazon: Boolean = false,
    val isBanned: Boolean = false,
    val banReason: String = "",
    val bodyStatus: String = "",
    val attachments: List<MailAttachment> = emptyList(),
)

data class MailAttachment(val id: String, val filename: String, val size: Long = 0, val inline: Boolean = false)

data class RegistrationLog(
    val index: Int,
    val personName: String = "",
    val mobile: String = "",
    val realEmail: String = "",
    val city: String = "",
    val receiptNumber: String = "",
    val registeredAt: String = "",
)

data class InboxesPayload(
    val activeId: String?,
    val official: List<Inbox>,
    val temp: List<Inbox>,
    val amazon: List<Inbox> = emptyList(),
    val banned: List<Inbox> = emptyList(),
)

data class CurrentPayload(val inbox: Inbox?, val messages: List<MailMessage>)
data class MessagesPayload(
    val messages: List<MailMessage>,
    val officialCount: Int,
    val tempCount: Int,
    val amazonCount: Int = 0,
    val bannedCount: Int = 0,
)

object AmazonDetector {
    private val KEYWORDS = listOf(
        "amazon", "أمازون", "امازون", "إمازون",
        "amazon.sa", "amazon.com", "amazon.ae", "amazon.co.uk", "amazon.de",
        "ofm@", "cis@"
    )

    fun isOfficialInbox(inbox: Inbox): Boolean {
        return inbox.isOfficial || inbox.type == "official" || inbox.email.lowercase().endsWith("@batabitoo.com")
    }

    fun isAmazonMessage(message: MailMessage): Boolean {
        if (message.isAmazon || message.isBanned) return true
        val text = "${message.from} ${message.to} ${message.subject} ${message.intro} ${message.text} ${message.inboxEmail}".lowercase()
        return KEYWORDS.any { text.contains(it) }
    }

    fun isAmazonInbox(inbox: Inbox, messages: List<MailMessage> = emptyList()): Boolean {
        // Strictly Official inboxes only!
        if (!isOfficialInbox(inbox)) return false

        // Fast path: if already classified as Amazon or Banned, return true immediately (O(1), no re-reviewing)
        if (inbox.isAmazon || inbox.isBanned) return true

        // Check metadata
        val meta = "${inbox.email} ${inbox.label} ${inbox.personName}".lowercase()
        if (KEYWORDS.any { meta.contains(it) }) return true

        // Check messages
        val inboxEmail = inbox.email.lowercase().trim()
        return messages.any { m ->
            (m.inboxEmail.lowercase().trim() == inboxEmail || m.to.lowercase().contains(inboxEmail)) && isAmazonMessage(m)
        }
    }
}

object AmazonBannedDetector {
    private val SENDER_KEYWORDS = listOf(
        "ofm@amazon", "cis@amazon", "buyer-returns@amazon",
        "account-alert@amazon", "buyer-investigations@amazon",
        "الموظف المختص بالأمور المتعلقة بالحساب", "account specialist"
    )
    private val DIGITAL_RESTRICTIONS = listOf(
        "المشتريات الرقمية", "مشتريات رقمية", "digital purchases only",
        "digital orders only", "غير الرقمية", "سياسة المرتجعات ورد الأموال",
        "انتهاكات متعددة لسياسة المرتجعات"
    )
    private val ACCOUNT_CLOSURE = listOf(
        "أغلقنا هذا الحساب", "اغلقنا هذا الحساب", "تم إغلاق حسابك",
        "تم اغلاق حسابك", "تم حظر حسابك", "تم تعليق حسابك",
        "إنهاء الحسابات", "انهاء الحسابات", "رفض الخدمة",
        "إنهاء استخدام خدمات أمازون", "انهاء استخدام خدمات امازون",
        "closed this account", "account has been closed", "account closure",
        "terminate your account", "terminated your account",
        "refuse service, terminate accounts", "account on hold",
        "account suspended", "account locked"
    )

    fun isBannedMessage(message: MailMessage): Boolean {
        if (message.isBanned) return true
        val text = "${message.from} ${message.to} ${message.subject} ${message.intro} ${message.text} ${message.inboxEmail}".lowercase()
        return SENDER_KEYWORDS.any { text.contains(it) } ||
               DIGITAL_RESTRICTIONS.any { text.contains(it) } ||
               ACCOUNT_CLOSURE.any { text.contains(it) }
    }

    fun getBanReason(message: MailMessage): String {
        if (message.banReason.isNotBlank()) return message.banReason
        if (!isBannedMessage(message)) return ""
        val text = "${message.from} ${message.subject} ${message.intro} ${message.text}".lowercase()
        return when {
            DIGITAL_RESTRICTIONS.any { text.contains(it) } -> "مشتريات رقمية فقط"
            ACCOUNT_CLOSURE.any { text.contains(it) } -> "إغلاق وحظر الحساب"
            SENDER_KEYWORDS.any { text.contains(it) } -> "مراجعة أمنية / OFM"
            else -> "حساب مقيد / محظور"
        }
    }

    fun isBannedInbox(inbox: Inbox, messages: List<MailMessage> = emptyList()): Boolean {
        if (!AmazonDetector.isOfficialInbox(inbox)) return false
        if (inbox.isBanned) return true
        val meta = "${inbox.email} ${inbox.label} ${inbox.personName}".lowercase()
        if (listOf("محظور", "مقيد", "banned", "restricted", "suspended").any { meta.contains(it) }) return true
        val inboxEmail = inbox.email.lowercase().trim()
        return messages.any { m ->
            (m.inboxEmail.lowercase().trim() == inboxEmail || m.to.lowercase().contains(inboxEmail)) && isBannedMessage(m)
        }
    }
}

object MailJson {
    fun status(raw: String, currentVersionCode: Int = 1): SystemStatus {
        val root = JSONObject(raw)
        val counts = root.optJSONObject("counts") ?: JSONObject()
        val versionObj = root.optJSONObject("appVersion")
        val appVersionInfo = versionObj?.let { appVersion(it.toString(), currentVersionCode) }
        return SystemStatus(
            online = root.optString("status") == "online",
            cloudConnected = root.optBoolean("cloudConnected"),
            projectId = root.optString("projectId"),
            counts = Counts(
                totalInboxes = counts.optInt("totalInboxes"),
                official = counts.optInt("official"),
                temp = counts.optInt("temp"),
                amazon = counts.optInt("amazon"),
                banned = counts.optInt("banned"),
                messages = counts.optInt("messages"),
            ),
            appVersion = appVersionInfo,
        )
    }

    fun appVersion(raw: String, currentVersionCode: Int = 1): AppVersionInfo {
        val root = JSONObject(raw)
        val latestCode = root.optInt("latestVersionCode", 1)
        val latestName = root.optString("latestVersionName", "1.0.0")
        val downloadUrl = root.optString("downloadUrl", "")
        val notes = root.optString("releaseNotes", "")
        val mandatory = root.optBoolean("mandatory", false)
        val updatedAt = root.optString("updatedAt", "")
        val hasUpdate = latestCode > currentVersionCode
        return AppVersionInfo(
            latestVersionCode = latestCode,
            latestVersionName = latestName,
            downloadUrl = downloadUrl,
            releaseNotes = notes,
            mandatory = mandatory,
            updatedAt = updatedAt,
            hasUpdate = hasUpdate,
        )
    }

    fun inboxes(raw: String): InboxesPayload {
        val root = JSONObject(raw)
        return InboxesPayload(
            activeId = root.stringOrNull("activeId"),
            official = root.optJSONArray("official").toObjects(::inbox),
            temp = root.optJSONArray("temp").toObjects(::inbox),
            amazon = root.optJSONArray("amazon").toObjects(::inbox),
            banned = root.optJSONArray("banned").toObjects(::inbox),
        )
    }

    fun current(raw: String): CurrentPayload {
        val root = JSONObject(raw)
        return CurrentPayload(
            inbox = root.optJSONObject("inbox")?.let(::inbox),
            messages = root.optJSONArray("messages").toObjects(::message),
        )
    }

    fun messages(raw: String): MessagesPayload {
        val root = JSONObject(raw)
        val counts = root.optJSONObject("counts") ?: JSONObject()
        return MessagesPayload(
            messages = root.optJSONArray("messages").toObjects(::message),
            officialCount = counts.optInt("official"),
            tempCount = counts.optInt("temp"),
            amazonCount = counts.optInt("amazon"),
            bannedCount = counts.optInt("banned"),
        )
    }

    fun logs(raw: String): List<RegistrationLog> {
        val root = JSONObject(raw)
        return root.optJSONArray("submissions").toObjects { item ->
            RegistrationLog(
                index = item.optInt("index"),
                personName = item.optString("personName"),
                mobile = item.optString("mobile"),
                realEmail = item.optString("realEmail"),
                city = item.optString("city"),
                receiptNumber = item.optString("receiptNumber"),
                registeredAt = item.optString("registeredAt"),
            )
        }
    }

    fun createdInbox(raw: String): Inbox = inbox(JSONObject(raw).getJSONObject("inbox"))
    fun message(raw: String): MailMessage = message(JSONObject(raw))
    fun storageStats(raw: String): StorageStats {
        val root = JSONObject(raw)
        return StorageStats(
            diskUsageBytes = root.optLong("diskUsageBytes"),
            diskUsageFormatted = root.optString("diskUsageFormatted", "0 MB"),
            messageDirsCount = root.optInt("messageDirsCount"),
            totalInboxes = root.optInt("totalInboxes"),
            totalMessages = root.optInt("totalMessages"),
            officialInboxes = root.optInt("officialInboxes"),
            tempInboxes = root.optInt("tempInboxes"),
            isCloudConnected = root.optBoolean("isCloudConnected"),
        )
    }

    private fun inbox(item: JSONObject): Inbox {
        val email = item.optString("email")
        val label = item.optString("label")
        val personName = item.optString("personName")
        val official = item.optBoolean("isOfficial") || item.optString("type") == "official" || email.endsWith("@batabitoo.com", true)
        val isBanned = official && (item.optBoolean("isBanned") || listOf(email, label, personName).any {
            it.lowercase().contains("banned") || it.contains("محظور") || it.contains("مقيد")
        })
        val isAmazon = official && (isBanned || item.optBoolean("isAmazon") || listOf(email, label, personName).any {
            it.lowercase().contains("amazon") || it.contains("أمازون") || it.contains("امازون") || it.contains("إمازون")
        })
        val banReason = item.optString("banReason")
        return Inbox(
            id = item.optString("id"),
            email = email,
            domain = item.optString("domain"),
            host = item.optString("host"),
            label = label,
            personName = personName,
            isOfficial = official,
            isAmazon = isAmazon,
            isBanned = isBanned,
            banReason = banReason,
            type = if (official) "official" else "temp",
            messageCount = item.optInt("messageCount"),
            createdAt = item.optString("createdAt"),
        )
    }

    private fun message(item: JSONObject): MailMessage {
        val from = address(item.opt("from"))
        val to = address(item.opt("to"))
        val inboxEmail = item.optString("inboxEmail")
        val subject = item.optString("subject", "(بدون عنوان)")
        val intro = item.optString("intro")
        val text = item.optString("text")
        val html = item.optString("html")
        val isBanned = item.optBoolean("isBanned") || AmazonBannedDetector.isBannedMessage(
            MailMessage(id = item.optString("id"), from = from, to = to, inboxEmail = inboxEmail, subject = subject, intro = intro, text = text)
        )
        val isAmazon = isBanned || item.optBoolean("isAmazon") || listOf(from, to, inboxEmail, subject, intro, text).any {
            it.lowercase().contains("amazon") || it.contains("أمازون") || it.contains("امازون") || it.contains("إمازون")
        }
        val banReason = if (isBanned) item.optString("banReason").ifBlank {
            AmazonBannedDetector.getBanReason(MailMessage(id = item.optString("id"), from = from, subject = subject, intro = intro, text = text))
        } else ""

        return MailMessage(
            id = item.optString("id"),
            from = from,
            to = to,
            inboxEmail = inboxEmail,
            subject = subject,
            intro = intro,
            text = text,
            html = html,
            otp = item.stringOrNull("otp").orEmpty(),
            isAmazon = isAmazon,
            isBanned = isBanned,
            banReason = banReason,
            bodyStatus = item.optString("bodyStatus"),
            attachments = item.optJSONArray("attachments").toObjects { MailAttachment(it.optString("id"), it.optString("filename", "مرفق"), it.optLong("size"), it.optBoolean("inline")) },
            createdAt = item.optString("createdAt"),
            isOfficial = item.optBoolean("isOfficialDomain") || (if (inboxEmail.isNotBlank()) inboxEmail else to).endsWith("@batabitoo.com", true),
        )
    }

    private fun address(value: Any?): String = when (value) {
        null, JSONObject.NULL -> ""
        is String -> value
        is JSONArray -> (0 until value.length()).joinToString(", ") { address(value.opt(it)) }
        is JSONObject -> {
            val address = value.optString("address", value.optString("email"))
            val name = value.optString("name")
            if (name.isNotBlank() && address.isNotBlank() && name != address) "$name <$address>" else address.ifBlank { name }
        }
        else -> value.toString()
    }

    private fun JSONObject.stringOrNull(key: String): String? = if (isNull(key)) null else optString(key).takeIf { it.isNotBlank() }
    private fun <T> JSONArray?.toObjects(transform: (JSONObject) -> T): List<T> {
        if (this == null) return emptyList()
        return buildList { for (index in 0 until length()) optJSONObject(index)?.let { add(transform(it)) } }
    }
}
