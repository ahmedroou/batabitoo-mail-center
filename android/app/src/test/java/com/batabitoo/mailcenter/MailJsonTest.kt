package com.batabitoo.mailcenter

import com.batabitoo.mailcenter.data.AmazonDetector
import com.batabitoo.mailcenter.data.Inbox
import com.batabitoo.mailcenter.data.MailJson
import com.batabitoo.mailcenter.data.MailMessage
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class MailJsonTest {
    @Test
    fun parsesStatusAndCounts() {
        val status = MailJson.status("""{"status":"online","cloudConnected":true,"projectId":"mail","counts":{"totalInboxes":12,"official":2,"temp":10,"messages":7}}""")
        assertTrue(status.online)
        assertTrue(status.cloudConnected)
        assertEquals(12, status.counts.totalInboxes)
        assertEquals(7, status.counts.messages)
    }

    @Test
    fun parsesOfficialInboxAndStructuredAddresses() {
        val inboxes = MailJson.inboxes("""{"activeId":"official_1","official":[{"id":"official_1","email":"me@batabitoo.com","messageCount":3}],"temp":[]}""")
        assertTrue(inboxes.official.single().isOfficial)
        assertEquals("official_1", inboxes.activeId)

        val message = MailJson.message("""{"id":"m1","from":{"name":"Amazon","address":"no-reply@amazon.com"},"to":[{"address":"me@batabitoo.com"}],"subject":"Your code","otp":"123456"}""")
        assertEquals("Amazon", message.from)
        assertEquals("me@batabitoo.com", message.to)
        assertEquals("123456", message.otp)
    }

    @Test
    fun computesSequentialPrefixAccurately() {
        fun computeNext(allEmails: List<String>, base: String = "ahmedroou"): String {
            val cleanBase = base.trim().lowercase()
            val normalizedEmails = allEmails.map { it.lowercase().trim() }
            val baseEmail = "$cleanBase@batabitoo.com".lowercase()
            if (!normalizedEmails.contains(baseEmail)) {
                return cleanBase
            }
            val regex = Regex("""^${Regex.escape(cleanBase)}(\d+)@batabitoo\.com$""")
            var maxNum = 0
            for (email in normalizedEmails) {
                val match = regex.find(email)
                if (match != null) {
                    val num = match.groupValues[1].toIntOrNull() ?: 0
                    if (num > maxNum) maxNum = num
                }
            }
            return "$cleanBase${maxNum + 1}"
        }

        // 1. Initial when no ahmedroou exists
        assertEquals("ahmedroou", computeNext(emptyList()))
        assertEquals("ahmedroou", computeNext(listOf("other@batabitoo.com", "user123@getnada.com")))

        // 2. When ahmedroou@batabitoo.com exists -> ahmedroou1
        assertEquals("ahmedroou1", computeNext(listOf("ahmedroou@batabitoo.com")))
        assertEquals("ahmedroou1", computeNext(listOf("AHMEDROOU@batabitoo.com")))

        // 3. When ahmedroou and ahmedroou1 exist -> ahmedroou2
        assertEquals("ahmedroou2", computeNext(listOf("ahmedroou@batabitoo.com", "ahmedroou1@batabitoo.com")))

        // 4. When ahmedroou, ahmedroou1, ahmedroou2 exist -> ahmedroou3
        assertEquals("ahmedroou3", computeNext(listOf("ahmedroou@batabitoo.com", "ahmedroou1@batabitoo.com", "ahmedroou2@batabitoo.com")))

        // 5. When gap exists up to ahmedroou9 -> ahmedroou10
        assertEquals("ahmedroou10", computeNext(listOf("ahmedroou@batabitoo.com", "ahmedroou9@batabitoo.com")))
    }

    @Test
    fun detectsAmazonMessagesAccurately() {
        val msg1 = MailMessage(id = "m1", from = "Amazon.sa <account-update@amazon.sa>", subject = "رمز التحقق لمرة واحدة من أمازون: 489201", otp = "489201")
        val msg2 = MailMessage(id = "m2", from = "orders@amazon.com", subject = "Your Amazon.com order has shipped", text = "Thanks for shopping with Amazon")
        val msg3 = MailMessage(id = "m3", from = "service@nivea.com", subject = "شكراً لتسجيلك في مسابقة نيفيا")

        assertTrue(com.batabitoo.mailcenter.data.AmazonDetector.isAmazonMessage(msg1))
        assertTrue(com.batabitoo.mailcenter.data.AmazonDetector.isAmazonMessage(msg2))
        org.junit.Assert.assertFalse(com.batabitoo.mailcenter.data.AmazonDetector.isAmazonMessage(msg3))
    }

    @Test
    fun detectsAmazonInboxesForOfficialAccountsOnly() {
        // 1. Official inbox with Amazon in email/label -> detected
        val officialAmz = com.batabitoo.mailcenter.data.Inbox(
            id = "o1",
            email = "amazon.acc@batabitoo.com",
            label = "حساب أمازون",
            isOfficial = true,
            type = "official"
        )
        assertTrue(com.batabitoo.mailcenter.data.AmazonDetector.isAmazonInbox(officialAmz))

        // 2. Official inbox receiving Amazon message -> detected
        val officialGeneric = com.batabitoo.mailcenter.data.Inbox(
            id = "o2",
            email = "ahmedroou@batabitoo.com",
            isOfficial = true,
            type = "official"
        )
        val amzMsg = MailMessage(id = "m10", from = "Amazon <auto-confirm@amazon.sa>", inboxEmail = "ahmedroou@batabitoo.com", subject = "رمز الدخول")
        assertTrue(com.batabitoo.mailcenter.data.AmazonDetector.isAmazonInbox(officialGeneric, listOf(amzMsg)))

        // 3. Temp inbox with Amazon keyword -> EXCLUDED (official only!)
        val tempAmz = com.batabitoo.mailcenter.data.Inbox(
            id = "t1",
            email = "amazonuser@getnada.com",
            label = "حساب سريع أمازون",
            isOfficial = false,
            type = "temp"
        )
        org.junit.Assert.assertFalse(com.batabitoo.mailcenter.data.AmazonDetector.isAmazonInbox(tempAmz, listOf(amzMsg)))

        // 4. Pre-classified official inbox -> fast path true
        val preClassified = com.batabitoo.mailcenter.data.Inbox(
            id = "o3",
            email = "buyer@batabitoo.com",
            isOfficial = true,
            isAmazon = true,
            type = "official"
        )
        assertTrue(com.batabitoo.mailcenter.data.AmazonDetector.isAmazonInbox(preClassified, emptyList()))
    }

    @Test
    fun detectsBannedAndRestrictedAmazonMessages() {
        // User sample 1: Digital purchases restriction from OFM
        val sample1 = MailMessage(
            id = "ban1",
            from = "ofm@amazon.sa <ofm@amazon.sa>",
            subject = "تم إلغاء طلبك 407-7192885-7959552 على Amazon.sa",
            text = "مرحبًا، نحن نراسلك لإعلامك بأننا قد ألغينا الطلب الخاص بك لأن حسابك يقتصر على المشتريات الرقمية فقط بسبب ناجم عن انتهاكات متعددة لسياسة المرتجعات ورد الأموال المدفوعة لدينا. سنلغي كل الطلبات غير الرقمية المقدمة على Amazon.sa تلقائيًا."
        )
        assertTrue(com.batabitoo.mailcenter.data.AmazonBannedDetector.isBannedMessage(sample1))
        assertEquals("مشتريات رقمية فقط", com.batabitoo.mailcenter.data.AmazonBannedDetector.getBanReason(sample1))

        // User sample 2: Account closure notice
        val sample2 = MailMessage(
            id = "ban2",
            from = "cis@amazon.com <cis@amazon.com>",
            subject = "Your Amazon Account",
            text = "لقد أغلقنا هذا الحساب بعد مراجعة شاملة لأن نشاطه لا يتسق مع شروط الاستخدام والبيع الخاصة بنا. ونحتفظ بالحق في رفض الخدمة وإنهاء الحسابات."
        )
        assertTrue(com.batabitoo.mailcenter.data.AmazonBannedDetector.isBannedMessage(sample2))
        assertEquals("إغلاق وحظر الحساب", com.batabitoo.mailcenter.data.AmazonBannedDetector.getBanReason(sample2))

        // Regular Amazon message (not banned)
        val normalAmz = MailMessage(
            id = "norm1",
            from = "shipment-tracking@amazon.sa",
            subject = "تم شحن طلبك من Amazon.sa",
            text = "طلبك في الطريق إليك."
        )
        assertFalse(com.batabitoo.mailcenter.data.AmazonBannedDetector.isBannedMessage(normalAmz))
        assertEquals("", com.batabitoo.mailcenter.data.AmazonBannedDetector.getBanReason(normalAmz))
    }

    @Test
    fun detectsBannedInboxesForOfficialAccountsOnly() {
        val officialInbox = Inbox(
            id = "o_ban_1",
            email = "ahmedroou1122@batabitoo.com",
            isOfficial = true,
            type = "official"
        )
        val banMsg = MailMessage(
            id = "msg_ban_1",
            from = "ofm@amazon.sa",
            inboxEmail = "ahmedroou1122@batabitoo.com",
            subject = "تم إلغاء طلبك لأن حسابك يقتصر على المشتريات الرقمية فقط",
            text = "المشتريات الرقمية فقط"
        )
        assertTrue(com.batabitoo.mailcenter.data.AmazonBannedDetector.isBannedInbox(officialInbox, listOf(banMsg)))

        // Temp inboxes should NOT be classified as banned official
        val tempInbox = Inbox(
            id = "t_ban_1",
            email = "temp123@getnada.com",
            isOfficial = false,
            type = "temp"
        )
        assertFalse(com.batabitoo.mailcenter.data.AmazonBannedDetector.isBannedInbox(tempInbox, listOf(banMsg)))

        // Pre-classified banned inbox -> fast path true
        val preBanned = Inbox(
            id = "o_ban_2",
            email = "blocked@batabitoo.com",
            isOfficial = true,
            isBanned = true,
            type = "official"
        )
        assertTrue(com.batabitoo.mailcenter.data.AmazonBannedDetector.isBannedInbox(preBanned, emptyList()))
    }

    @Test
    fun parsesBannedFieldsFromApiJson() {
        val statusJson = """{"status":"online","cloudConnected":true,"projectId":"mail","counts":{"totalInboxes":10,"official":4,"temp":6,"amazon":3,"banned":2,"messages":15}}"""
        val status = MailJson.status(statusJson)
        assertEquals(2, status.counts.banned)
        assertEquals(3, status.counts.amazon)

        val inboxesJson = """{"activeId":"o1","official":[],"temp":[],"amazon":[],"banned":[{"id":"o_b1","email":"banned@batabitoo.com","isBanned":true,"banReason":"مشتريات رقمية فقط","isAmazon":true,"isOfficial":true}]}"""
        val payload = MailJson.inboxes(inboxesJson)
        assertEquals(1, payload.banned.size)
        assertTrue(payload.banned[0].isBanned)
        assertEquals("مشتريات رقمية فقط", payload.banned[0].banReason)

        val msgJson = """{"id":"mb1","from":"ofm@amazon.sa","subject":"مشتريات رقمية فقط","isBanned":true,"banReason":"مشتريات رقمية فقط","isAmazon":true}"""
        val msg = MailJson.message(msgJson)
        assertTrue(msg.isBanned)
        assertEquals("مشتريات رقمية فقط", msg.banReason)
    }

    @Test
    fun dynamicLifecycle_unregisteredBecomesAmazonThenBannedLater() {
        // Stage 1: Brand new official account without any Amazon messages or keywords
        val inbox = Inbox(
            id = "o_dynamic",
            email = "ahmedroou5@batabitoo.com",
            label = "حساب جديد",
            personName = "أحمد",
            isOfficial = true,
            isAmazon = false,
            isBanned = false,
            type = "official"
        )
        // Currently empty messages
        assertFalse(com.batabitoo.mailcenter.data.AmazonDetector.isAmazonInbox(inbox, emptyList()))
        assertFalse(com.batabitoo.mailcenter.data.AmazonBannedDetector.isBannedInbox(inbox, emptyList()))

        // Stage 2: User registers in Amazon later -> OTP message arrives
        val otpMsg = MailMessage(
            id = "msg_otp",
            from = "account-update@amazon.sa",
            inboxEmail = "ahmedroou5@batabitoo.com",
            subject = "رمز التحقق لمرة واحدة من أمازون: 772183",
            otp = "772183"
        )
        // The detector immediately recognizes it as an Amazon inbox!
        assertTrue(com.batabitoo.mailcenter.data.AmazonDetector.isAmazonInbox(inbox, listOf(otpMsg)))
        assertFalse(com.batabitoo.mailcenter.data.AmazonBannedDetector.isBannedInbox(inbox, listOf(otpMsg)))

        // Stage 3: After some time, a digital restriction notice arrives from OFM
        val banMsg = MailMessage(
            id = "msg_ban",
            from = "ofm@amazon.sa",
            inboxEmail = "ahmedroou5@batabitoo.com",
            subject = "تم إلغاء طلبك",
            text = "يقتصر على المشتريات الرقمية فقط بسبب ناجم عن انتهاكات متعددة لسياسة المرتجعات"
        )
        val allMsgs = listOf(otpMsg, banMsg)
        // The detector immediately upgrades it to Banned!
        assertTrue(com.batabitoo.mailcenter.data.AmazonDetector.isAmazonInbox(inbox, allMsgs))
        assertTrue(com.batabitoo.mailcenter.data.AmazonBannedDetector.isBannedInbox(inbox, allMsgs))
        assertEquals("مشتريات رقمية فقط", com.batabitoo.mailcenter.data.AmazonBannedDetector.getBanReason(banMsg))
    }

    @Test
    fun appVersionParsing_detectsUpdateAndMandatoryFlag() {
        val jsonNewUpdate = """
            {
                "latestVersionCode": 2,
                "latestVersionName": "1.1.0",
                "downloadUrl": "https://batabitoo-mail-2026.web.app/downloads/Batabitoo-Mail-Center.apk",
                "releaseNotes": "تحسينات للتصميم وكشف حسابات أمازون المحظورة",
                "mandatory": false,
                "updatedAt": "2026-09-16T04:00:00.000Z"
            }
        """.trimIndent()

        // 1. Current app version is 1 -> New version 2 -> hasUpdate should be true
        val info1 = MailJson.appVersion(jsonNewUpdate, currentVersionCode = 1)
        assertEquals(2, info1.latestVersionCode)
        assertEquals("1.1.0", info1.latestVersionName)
        assertEquals("https://batabitoo-mail-2026.web.app/downloads/Batabitoo-Mail-Center.apk", info1.downloadUrl)
        assertEquals("تحسينات للتصميم وكشف حسابات أمازون المحظورة", info1.releaseNotes)
        assertFalse(info1.mandatory)
        assertTrue(info1.hasUpdate)

        // 2. Current app version is already 2 -> hasUpdate should be false
        val info2 = MailJson.appVersion(jsonNewUpdate, currentVersionCode = 2)
        assertFalse(info2.hasUpdate)

        // 3. Status JSON with embedded appVersion
        val statusJson = """
            {
                "status": "online",
                "cloudConnected": true,
                "projectId": "batabitoo-mail-2026",
                "appVersion": $jsonNewUpdate,
                "counts": { "totalInboxes": 5 }
            }
        """.trimIndent()
        val status = MailJson.status(statusJson, currentVersionCode = 1)
        assertTrue(status.online)
        org.junit.Assert.assertNotNull(status.appVersion)
        assertTrue(status.appVersion!!.hasUpdate)
        assertEquals("1.1.0", status.appVersion!!.latestVersionName)
    }
}
