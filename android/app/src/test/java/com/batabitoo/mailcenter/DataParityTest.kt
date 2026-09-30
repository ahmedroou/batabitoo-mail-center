package com.batabitoo.mailcenter

import com.batabitoo.mailcenter.data.Inbox
import com.batabitoo.mailcenter.data.MailJson
import com.batabitoo.mailcenter.data.MailMessage
import com.batabitoo.mailcenter.data.messageBelongsToInbox
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class DataParityTest {
    @Test
    fun messageParser_keepsRecipientAndAttachmentMetadata() {
        val message = MailJson.message(
            """{
              "id":"m-1",
              "to":[{"name":"Alias","address":"a.lias@gmail.com"}],
              "inboxEmail":"a.lias@gmail.com",
              "exactRecipient":"a.lias@gmail.com",
              "parentEmail":"alias@gmail.com",
              "isWinning":true,
              "attachments":[{
                "id":"abc123",
                "filename":"invoice.pdf",
                "size":42,
                "contentType":"application/pdf",
                "cid":"invoice",
                "inline":false
              }]
            }""".trimIndent(),
        )

        assertEquals("a.lias@gmail.com", message.exactRecipient)
        assertEquals("alias@gmail.com", message.parentEmail)
        assertTrue(message.isWinning)
        assertEquals("application/pdf", message.attachments.single().contentType)
        assertEquals("invoice", message.attachments.single().cid)
    }

    @Test
    fun messageMatcher_preservesDottedAliasIsolationAndParentRouting() {
        val message = MailMessage(
            id = "m-2",
            to = "Alias <a.lias@gmail.com>",
            inboxEmail = "a.lias@gmail.com",
            exactRecipient = "a.lias@gmail.com",
            parentEmail = "alias@gmail.com",
        )
        val dotted = Inbox(
            id = "dotted",
            email = "a.lias@gmail.com",
            isDottedGmailAlias = true,
            parentEmail = "alias@gmail.com",
        )
        val differentDotted = dotted.copy(id = "other", email = "al.ias@gmail.com")
        val parent = Inbox(id = "parent", email = "alias@gmail.com", isRealGmail = true)

        assertTrue(messageBelongsToInbox(message, dotted))
        assertFalse(messageBelongsToInbox(message, differentDotted))
        assertTrue(messageBelongsToInbox(message, parent))
    }

    @Test
    fun parsesGmailAccountAndActionPayloads() {
        val accounts = MailJson.gmailAccounts(
            """{"success":true,"accounts":[{
              "email":"Owner@Gmail.com",
              "authType":"oauth2",
              "personName":"Owner",
              "status":"connected",
              "lastSyncAt":"2026-09-22T01:02:03Z",
              "syncedCount":17
            }]}""",
        )
        assertTrue(accounts.success)
        assertEquals("owner@gmail.com", accounts.accounts.single().email)
        assertEquals("oauth2", accounts.accounts.single().authType)
        assertEquals(17, accounts.accounts.single().syncedCount)

        val action = MailJson.gmailAction(
            """{"success":true,"email":"OWNER@GMAIL.COM","newCount":4,"syncWarning":"partial"}""",
        )
        assertEquals("owner@gmail.com", action.email)
        assertEquals(4, action.newCount)
        assertEquals("partial", action.syncWarning)

        val auth = MailJson.oauthAuthUrl(
            """{"success":true,"authUrl":"https://accounts.google.com/o/oauth2/v2/auth","redirectUri":"https://example.test/callback"}""",
        )
        assertTrue(auth.success)
        assertTrue(auth.authUrl.startsWith("https://accounts.google.com/"))
    }

    @Test
    fun parsesDeletedAmazonBatchDeleteAndWinningMessages() {
        val inboxes = MailJson.inboxes(
            """{"official":[],"temp":[],"deletedAmazon":["ONE@EXAMPLE.COM",{"email":"two@example.com"}]}""",
        )
        assertEquals(listOf("one@example.com", "two@example.com"), inboxes.deletedAmazon.map { it.email })

        val deleted = MailJson.deletedAmazon(
            """{"success":true,"deleted":["ONE@EXAMPLE.COM","one@example.com"]}""",
        )
        assertEquals(listOf("one@example.com"), deleted.map { it.email })

        val batch = MailJson.batchDelete("""{"success":true,"count":3}""")
        assertTrue(batch.success)
        assertEquals(3, batch.count)

        val winning = MailJson.winningMessages(
            """{"success":true,"count":1,"messages":[{"id":"winner-1","subject":"مبروك","isWinning":true}]}""",
        )
        assertEquals(1, winning.count)
        assertTrue(winning.messages.single().isWinning)
    }
}
