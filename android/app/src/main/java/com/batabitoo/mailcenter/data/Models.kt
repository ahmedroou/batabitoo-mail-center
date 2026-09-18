package com.batabitoo.mailcenter.data

import org.json.JSONArray
import org.json.JSONObject

data class Counts(
    val totalInboxes: Int = 0,
    val official: Int = 0,
    val temp: Int = 0,
    val amazon: Int = 0,
    val banned: Int = 0,
    val suspected: Int = 0,
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
    val banStatus: String = "none",
    val banReason: String = "",
    val type: String = "temp",
    val messageCount: Int = 0,
    val createdAt: String = "",
) {
    val isConfirmedBanned: Boolean get() = banStatus == "confirmed" || isBanned
    val isSuspected: Boolean get() = banStatus == "suspected"
}

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
    val activeId: String? = null,
    val official: List<Inbox> = emptyList(),
    val temp: List<Inbox> = emptyList(),
    val amazon: List<Inbox> = emptyList(),
    val banned: List<Inbox> = emptyList(),
    val suspected: List<Inbox> = emptyList(),
)

data class CurrentPayload(val inbox: Inbox? = null, val messages: List<MailMessage> = emptyList())

data class MessagesPayload(
    val messages: List<MailMessage> = emptyList(),
    val officialCount: Int = 0,
    val tempCount: Int = 0,
    val amazonCount: Int = 0,
    val bannedCount: Int = 0,
    val suspectedCount: Int = 0,
)

object AmazonDetector {
    private val KEYWORDS = listOf(
        "amazon", "أمازون", "امازون", "إمازون",
        "amazon.sa", "amazon.com", "amazon.ae", "amazon.co.uk", "amazon.de",
        "ofm@", "cis@"
    )

    fun isOfficialInbox(inbox: Inbox): Boolean {
        val em = inbox.email.lowercase()
        return inbox.isOfficial || inbox.type == "official" || em.endsWith("@batabitoo.com") || em.endsWith("@gmail.com")
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
    private val DIGITAL_RESTRICTIONS = listOf(
        "المشتريات الرقمية فقط", "يقتصر على المشتريات الرقمية", "قصرنا حسابك على المشتريات الرقمية",
        "مشتريات رقمية فقط", "digital purchases only", "digital orders only",
        "غير الرقمية", "انتهاكات متعددة لسياسة المرتجعات", "انتهاكات متكررة لشروط الاستخدام"
    )
    private val ACCOUNT_CLOSURE = listOf(
        "أغلقنا هذا الحساب", "اغلقنا هذا الحساب", "تم إغلاق حسابك",
        "تم اغلاق حسابك", "تم حظر حسابك", "تم تعليق حسابك",
        "حسابك معلق", "حسابك محظور", "حسابك مغلق",
        "إنهاء الحسابات", "انهاء الحسابات", "رفض الخدمة",
        "إنهاء استخدام خدمات أمازون", "انهاء استخدام خدمات امازون",
        "closed this account", "account has been closed", "account closure",
        "terminate your account", "terminated your account",
        "refuse service, terminate accounts"
    )

    fun isBannedMessage(message: MailMessage): Boolean {
        if (message.isBanned) return true
        val text = "${message.subject} ${message.intro} ${message.text}".lowercase()
        val hasSuspended = Regex("""account (?:is|was|has been)?\s*(?:suspended|locked|on hold|closed)""", RegexOption.IGNORE_CASE).containsMatchIn(text)
        return DIGITAL_RESTRICTIONS.any { text.contains(it) } ||
               ACCOUNT_CLOSURE.any { text.contains(it) } ||
               hasSuspended
    }

    fun getBanReason(message: MailMessage): String {
        if (message.banReason.isNotBlank()) return message.banReason
        if (!isBannedMessage(message)) return ""
        val text = "${message.subject} ${message.intro} ${message.text}".lowercase()
        return when {
            DIGITAL_RESTRICTIONS.any { text.contains(it) } -> "مشتريات رقمية فقط"
            ACCOUNT_CLOSURE.any { text.contains(it) } || text.contains("suspended") || text.contains("locked") -> "إغلاق وحظر الحساب"
            else -> "حساب مقيد / محظور"
        }
    }

    fun isConfirmedBanned(inbox: Inbox): Boolean {
        if (!AmazonDetector.isOfficialInbox(inbox)) return false
        return inbox.banStatus == "confirmed" || inbox.isBanned
    }

    fun isSuspectedInbox(inbox: Inbox, messages: List<MailMessage> = emptyList()): Boolean {
        if (!AmazonDetector.isOfficialInbox(inbox)) return false
        if (inbox.banStatus == "safe") return false
        if (inbox.banStatus == "confirmed" || inbox.isBanned) return false
        if (inbox.banStatus == "suspected") return true

        val inboxEmail = inbox.email.lowercase().trim()
        return messages.any { m ->
            (m.inboxEmail.lowercase().trim() == inboxEmail || m.to.lowercase().contains(inboxEmail)) && isBannedMessage(m)
        }
    }

    fun isBannedInbox(inbox: Inbox, messages: List<MailMessage> = emptyList()): Boolean {
        return isConfirmedBanned(inbox)
    }
}

object ContentSanitizer {
    fun decodeBase64Safe(input: String): ByteArray {
        val clean = input.replace(Regex("""\s+"""), "")
        return try {
            java.util.Base64.getDecoder().decode(clean)
        } catch (_: Throwable) {
            android.util.Base64.decode(clean, android.util.Base64.DEFAULT)
        }
    }

    fun decodeRfc2047(str: String): String {
        val pattern = Regex("""=\?([^?]+)\?([bBqQ])\?([^?]*)\?=""", RegexOption.IGNORE_CASE)
        return pattern.replace(str) { match ->
            val encoding = match.groupValues[2].uppercase()
            val content = match.groupValues[3]
            try {
                if (encoding == "B") {
                    val bytes = decodeBase64Safe(content)
                    String(bytes, Charsets.UTF_8)
                } else if (encoding == "Q") {
                    content.replace('_', ' ')
                } else {
                    match.value
                }
            } catch (_: Throwable) {
                match.value
            }
        }
    }

    fun decodeBase64Text(str: String): String {
        if (str.isBlank()) return ""
        val trimmed = str.trim()
        val clean = trimmed.replace(Regex("""\s+"""), "")
        if (clean.length > 20 && clean.matches(Regex("""^[A-Za-z0-9+/=]+$"""))) {
            try {
                val bytes = decodeBase64Safe(clean)
                val decoded = String(bytes, Charsets.UTF_8)
                val hasControlChars = decoded.any { it.code in 0..8 || it.code in 11..12 || it.code in 14..31 }
                val hasLettersOrArabic = decoded.any { it in '\u0600'..'\u06FF' || it.isLetterOrDigit() }
                if (!hasControlChars && hasLettersOrArabic) {
                    return decoded
                }
            } catch (_: Throwable) {}
        }
        return str
    }

    fun hasVisibleContent(htmlStr: String): Boolean {
        if (htmlStr.isBlank()) return false
        val hasMedia = htmlStr.contains("<img", ignoreCase = true) ||
                htmlStr.contains("<table", ignoreCase = true) ||
                htmlStr.contains("<button", ignoreCase = true)
        if (hasMedia) return true

        val bodyMatch = Regex("""<body[^>]*>([\s\S]*?)</body>""", RegexOption.IGNORE_CASE).find(htmlStr)
        val content = bodyMatch?.groupValues?.get(1) ?: htmlStr
        val textOnly = content
            .replace(Regex("""<style[\s\S]*?</style>""", RegexOption.IGNORE_CASE), "")
            .replace(Regex("""<script[\s\S]*?</script>""", RegexOption.IGNORE_CASE), "")
            .replace(Regex("""<head[\s\S]*?</head>""", RegexOption.IGNORE_CASE), "")
            .replace(Regex("""<title[\s\S]*?</title>""", RegexOption.IGNORE_CASE), "")
            .replace(Regex("""<[^>]+>"""), "")
            .replace(Regex("""&[a-z0-9#]+;""", RegexOption.IGNORE_CASE), " ")
            .trim()

        return textOnly.length >= 10
    }
}

object SenderFormatter {
    fun format(rawFrom: String, subject: String = ""): String {
        var str = ContentSanitizer.decodeRfc2047(rawFrom.trim())
        if (str.isBlank()) return "مرسل غير معروف"

        val match = Regex("""^["']?([^"<]+?)["']?\s*<([^>]+)>""").find(str)
        if (match != null) {
            val friendly = match.groupValues[1].trim()
            val email = match.groupValues[2].trim()
            if (friendly.isNotBlank() && friendly != email && !friendly.matches(Regex("""^[a-f0-9A-F_-]{16,}$""")) && !friendly.matches(Regex("""^[0-9]+[a-z0-9-]+$""", RegexOption.IGNORE_CASE))) {
                return friendly
            }
            str = email
        }

        str = str.removePrefix("<").removeSuffix(">").trim()

        val lower = str.lowercase()
        if (lower.contains("@bounces.amazon.") || lower.contains("@amazon.") || lower.contains("amazonses.com") || lower.contains("amazon.sa") || lower.contains("amazon.ca") || lower.contains("amazon.ae")) {
            val isSa = lower.contains("amazon.sa") || subject.contains(Regex("""[\u0600-\u06FF]"""))
            val isCa = lower.contains("amazon.ca")
            val isAe = lower.contains("amazon.ae")
            val isUk = lower.contains("amazon.co.uk")
            if (lower.contains("ofm@")) return "أمازون OFM (مراجعة أمنية)"
            if (lower.contains("order-update@") || lower.contains("auto-confirm@") || lower.contains("shipment")) {
                return if (isSa) "أمازون السعودية (طلبات)" else "Amazon Orders"
            }
            return when {
                isSa -> "أمازون السعودية (Amazon.sa)"
                isCa -> "Amazon Canada (أمازون)"
                isAe -> "Amazon.ae (أمازون)"
                isUk -> "Amazon UK (أمازون)"
                else -> "أمازون (Amazon)"
            }
        }

        val bounceMatch = Regex("""^[a-f0-9A-F_-]{12,}@(?:bounces\.)?([a-zA-Z0-9.-]+\.[a-zA-Z]{2,})$""").find(str)
        if (bounceMatch != null) {
            val domain = bounceMatch.groupValues[1]
            val brand = domain.split('.').firstOrNull().orEmpty().replaceFirstChar { it.uppercase() }
            if (brand.isNotBlank()) return brand
        }

        return str
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
                suspected = counts.optInt("suspected"),
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

    fun firestoreAppVersion(raw: String, currentVersionCode: Int = 1): AppVersionInfo {
        val root = JSONObject(raw)
        val fields = root.optJSONObject("fields") ?: JSONObject()
        val codeObj = fields.optJSONObject("latestVersionCode")
        val latestCode = codeObj?.optString("integerValue")?.toIntOrNull()
            ?: codeObj?.optInt("integerValue", 1)
            ?: 1
        val latestName = fields.optJSONObject("latestVersionName")?.optString("stringValue", "1.0.0") ?: "1.0.0"
        val downloadUrl = fields.optJSONObject("downloadUrl")?.optString("stringValue", "") ?: ""
        val notes = fields.optJSONObject("releaseNotes")?.optString("stringValue", "") ?: ""
        val mandatory = fields.optJSONObject("mandatory")?.optBoolean("booleanValue", false) ?: false
        val updatedAt = fields.optJSONObject("updatedAt")?.optString("stringValue", "") ?: ""
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

    fun firestoreInbox(doc: JSONObject): Inbox {
        val fields = doc.optJSONObject("fields") ?: JSONObject()
        val email = fields.optStringValue("email")
        val label = fields.optStringValue("label")
        val personName = fields.optStringValue("personName")
        val official = fields.optBooleanValue("isOfficial") || fields.optStringValue("type") == "official" || email.endsWith("@batabitoo.com", true) || email.endsWith("@gmail.com", true)
        val banStatus = fields.optStringValue("banStatus").ifBlank { if (fields.optBooleanValue("isBanned")) "confirmed" else "none" }
        val isConfirmedBanned = official && (banStatus == "confirmed" || fields.optBooleanValue("isBanned"))
        val isSuspected = official && (banStatus == "suspected")
        val isAmazon = official && (isConfirmedBanned || isSuspected || fields.optBooleanValue("isAmazon") || listOf(email, label, personName).any {
            it.lowercase().contains("amazon") || it.contains("أمازون") || it.contains("امازون") || it.contains("إمازون")
        })
        val docName = doc.optString("name", "")
        val id = fields.optStringValue("id").ifBlank { if (docName.contains("/")) docName.split("/").last() else "" }
        return Inbox(
            id = id,
            email = email,
            domain = fields.optStringValue("domain"),
            host = fields.optStringValue("host"),
            label = label,
            personName = personName,
            isOfficial = official,
            isAmazon = isAmazon,
            isBanned = isConfirmedBanned,
            banStatus = banStatus,
            banReason = fields.optStringValue("banReason"),
            type = if (official) "official" else "temp",
            messageCount = fields.optIntValue("messageCount"),
            createdAt = fields.optStringValue("createdAt"),
        )
    }

    fun firestoreInboxes(raw: String): InboxesPayload {
        val root = JSONObject(raw)
        val docs = root.optJSONArray("documents") ?: org.json.JSONArray()
        val allList = mutableListOf<Inbox>()
        for (i in 0 until docs.length()) {
            val doc = docs.optJSONObject(i) ?: continue
            val item = firestoreInbox(doc)
            if (item.email.isNotBlank()) {
                allList.add(item)
            }
        }
        val official = allList.filter { it.isOfficial }
        val temp = allList.filter { !it.isOfficial }
        val amazon = allList.filter { it.isAmazon }
        val banned = allList.filter { it.isConfirmedBanned }
        val suspected = allList.filter { it.isSuspected }

        return InboxesPayload(
            activeId = official.firstOrNull()?.id ?: temp.firstOrNull()?.id,
            official = official,
            temp = temp,
            amazon = amazon,
            banned = banned,
            suspected = suspected,
        )
    }

    fun firestoreMessage(doc: JSONObject): MailMessage {
        val fields = doc.optJSONObject("fields") ?: JSONObject()
        val docName = doc.optString("name", "")
        val id = fields.optStringValue("id").ifBlank { if (docName.contains("/")) docName.split("/").last() else "" }
        val from = fields.optStringValue("from")
        val to = fields.optStringValue("to")
        val inboxEmail = fields.optStringValue("inboxEmail")
        val subject = fields.optStringValue("subject")
        val intro = fields.optStringValue("intro")
        val text = fields.optStringValue("text")
        val html = fields.optStringValue("html")
        val isBanned = fields.optBooleanValue("isBanned") || AmazonBannedDetector.isBannedMessage(
            MailMessage(id = id, from = from, to = to, inboxEmail = inboxEmail, subject = subject, intro = intro, text = text)
        )
        val isAmazon = isBanned || fields.optBooleanValue("isAmazon") || listOf(from, to, inboxEmail, subject, intro, text).any {
            it.lowercase().contains("amazon") || it.contains("أمازون") || it.contains("امازون") || it.contains("إمازون")
        }
        val banReason = if (isBanned) fields.optStringValue("banReason").ifBlank {
            AmazonBannedDetector.getBanReason(MailMessage(id = id, from = from, subject = subject, intro = intro, text = text))
        } else ""

        return MailMessage(
            id = id,
            from = from,
            to = to,
            inboxEmail = inboxEmail,
            subject = subject,
            intro = intro,
            text = text,
            html = html,
            otp = fields.optStringValue("otp"),
            isAmazon = isAmazon,
            isBanned = isBanned,
            banReason = banReason,
            bodyStatus = fields.optStringValue("bodyStatus"),
            attachments = emptyList(),
            createdAt = fields.optStringValue("createdAt"),
            isOfficial = fields.optBooleanValue("isOfficialDomain") || (if (inboxEmail.isNotBlank()) inboxEmail else to).endsWith("@batabitoo.com", true) || (if (inboxEmail.isNotBlank()) inboxEmail else to).endsWith("@gmail.com", true),
        )
    }

    fun firestoreMessages(raw: String): MessagesPayload {
        val root = JSONObject(raw)
        val docs = root.optJSONArray("documents") ?: org.json.JSONArray()
        val msgList = mutableListOf<MailMessage>()
        for (i in 0 until docs.length()) {
            val doc = docs.optJSONObject(i) ?: continue
            val item = firestoreMessage(doc)
            if (item.id.isNotBlank()) {
                msgList.add(item)
            }
        }
        return MessagesPayload(
            messages = msgList,
            officialCount = msgList.count { it.isOfficial },
            tempCount = msgList.count { !it.isOfficial },
            amazonCount = msgList.count { it.isAmazon },
            bannedCount = msgList.count { it.isBanned },
            suspectedCount = 0,
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
            suspected = root.optJSONArray("suspected").toObjects(::inbox),
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
            suspectedCount = counts.optInt("suspected"),
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
        val banStatus = item.optString("banStatus", if (item.optBoolean("isBanned")) "confirmed" else "none")
        val isConfirmedBanned = official && (banStatus == "confirmed" || item.optBoolean("isBanned"))
        val isSuspected = official && (banStatus == "suspected")
        val isAmazon = official && (isConfirmedBanned || isSuspected || item.optBoolean("isAmazon") || listOf(email, label, personName).any {
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
            isBanned = isConfirmedBanned,
            banStatus = banStatus,
            banReason = banReason,
            type = if (official) "official" else "temp",
            messageCount = item.optInt("messageCount"),
            createdAt = item.optString("createdAt"),
        )
    }

    private fun message(item: JSONObject): MailMessage {
        val rawFrom = address(item.opt("from"))
        val subject = ContentSanitizer.decodeRfc2047(item.optString("subject", "(بدون عنوان)"))
        val from = SenderFormatter.format(rawFrom, subject)
        val to = address(item.opt("to"))
        val inboxEmail = item.optString("inboxEmail")
        val rawIntro = item.optString("intro")
        val intro = ContentSanitizer.decodeBase64Text(rawIntro)
        val rawText = item.optString("text")
        val text = ContentSanitizer.decodeBase64Text(rawText)
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

    private fun JSONObject.optStringValue(key: String): String {
        val field = optJSONObject(key) ?: return optString(key, "")
        return field.optString("stringValue")
            .ifBlank { field.optString("integerValue") }
            .ifBlank { field.optString("referenceValue") }
    }

    private fun JSONObject.optBooleanValue(key: String): Boolean {
        val field = optJSONObject(key) ?: return optBoolean(key, false)
        return field.optBoolean("booleanValue", false)
    }

    private fun JSONObject.optIntValue(key: String): Int {
        val field = optJSONObject(key) ?: return optInt(key, 0)
        return field.optString("integerValue").toIntOrNull() ?: field.optInt("integerValue", 0)
    }
}
