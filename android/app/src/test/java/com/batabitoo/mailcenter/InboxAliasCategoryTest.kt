package com.batabitoo.mailcenter

import com.batabitoo.mailcenter.data.AmazonDetector
import com.batabitoo.mailcenter.data.Inbox
import org.junit.Assert.*
import org.junit.Test

class InboxAliasCategoryTest {
    @Test fun explicitAliasIsAmazonWithoutMessages() {
        val alias = Inbox("alias", "m.ail@gmail.com", isDottedGmailAlias = true)
        assertTrue(alias.isAmazonOnlyAlias)
        assertTrue(AmazonDetector.isAmazonInbox(alias))
    }
    @Test fun legacyAliasWithDifferentParentIsAmazon() {
        val alias = Inbox("alias", "ma.il@gmail.com", parentEmail = "mail@gmail.com")
        assertTrue(alias.isAmazonOnlyAlias)
        assertTrue(AmazonDetector.isAmazonInbox(alias))
    }
    @Test fun realGmailDotsDoNotMakeAnAlias() {
        val real = Inbox("real", "first.last@gmail.com", isRealGmail = true, parentEmail = " FIRST.LAST@GMAIL.COM ")
        assertFalse(real.isAmazonOnlyAlias)
        assertFalse(AmazonDetector.isAmazonInbox(real))
    }
}
