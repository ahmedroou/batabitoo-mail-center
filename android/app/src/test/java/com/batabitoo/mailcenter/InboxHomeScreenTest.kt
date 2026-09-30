package com.batabitoo.mailcenter

import androidx.compose.foundation.layout.*
import androidx.compose.material3.Scaffold
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalLayoutDirection
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.unit.Density
import androidx.compose.ui.unit.LayoutDirection
import com.batabitoo.mailcenter.data.Counts
import com.batabitoo.mailcenter.data.Inbox
import com.batabitoo.mailcenter.ui.*
import com.batabitoo.mailcenter.ui.theme.BatabitooTheme
import com.github.takahirom.roborazzi.captureRoboImage
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [34], qualifiers = "ar-rSA-w360dp-h800dp-mdpi")
class InboxHomeScreenTest {
    @get:Rule val compose = createComposeRule()

    private val sample = MailUiState(
        loading = false, dataLoaded = true, cloudConnected = true, online = true,
        counts = Counts(totalInboxes = 1006, official = 17, temp = 989, messages = 27),
        officialInboxes = listOf(
            Inbox("one", "hello@batabitoo.com", personName = "البريد الشخصي", isOfficial = true, messageCount = 12),
            Inbox("two", "travel.plans@gmail.com", personName = "السفر والحجوزات", isOfficial = true, messageCount = 4),
            Inbox("three", "prize.tickets@batabitoo.com", personName = "المسابقات والجوائز", isOfficial = true, messageCount = 11),
            Inbox("four", "a.very.long.email.address@gmail.com", personName = "عنوان بريد طويل لاختبار المساحة", isOfficial = true),
        ),
        tempInboxes = listOf(Inbox("temp", "quick.mail@example.com")),
    ).let { it.copy(activeInbox = it.officialInboxes.first()) }

    private fun render(initial: MailUiState = sample, fontScale: Float = 1f, actions: InboxHomeActions = InboxHomeActions()) {
        compose.setContent {
            val density = LocalDensity.current
            val compact = LocalConfiguration.current.screenWidthDp < 600
            CompositionLocalProvider(LocalLayoutDirection provides LayoutDirection.Rtl, LocalDensity provides Density(density.density, fontScale)) {
                BatabitooTheme {
                    Scaffold(
                        containerColor = HomePaper,
                        topBar = { InboxHomeHeader(initial, {}, {}, {}) },
                        bottomBar = { if (compact) InboxHomeNavigation {} },
                    ) { padding ->
                        Row(Modifier.fillMaxSize().padding(padding)) {
                            if (!compact) InboxHomeRail(false, {}, {})
                            Box(Modifier.weight(1f)) { InboxHomeScreen(initial, actions) }
                        }
                    }
                }
            }
        }
    }

    @Test fun phoneFirstInboxIsVisibleAndCopyDoesNotNavigate() {
        var copied = ""
        var opened = ""
        render(actions = InboxHomeActions(copy = { copied = it.id }, open = { opened = it.id }))
        compose.onNodeWithTag("mailbox-one").assertIsDisplayed()
        compose.onRoot().captureRoboImage("build/outputs/home-preview/phone.png")
        compose.onNodeWithContentDescription("نسخ hello@batabitoo.com").performClick()
        assertEquals("one", copied)
        assertEquals("", opened)
        compose.onNodeWithTag("mailbox-one").performClick()
        assertEquals("one", opened)
    }

    @Test @Config(qualifiers = "ar-rSA-w320dp-h640dp-mdpi")
    fun smallPhoneLargeText() {
        render(fontScale = 1.3f)
        compose.onNodeWithTag("mailbox-one").assertIsDisplayed()
        compose.onRoot().captureRoboImage("build/outputs/home-preview/small-phone.png")
    }

    @Test @Config(qualifiers = "ar-rSA-w900dp-h900dp-mdpi")
    fun tabletUsesMultipleColumns() {
        render()
        val first = compose.onNodeWithTag("mailbox-one").fetchSemanticsNode().boundsInRoot
        val second = compose.onNodeWithTag("mailbox-two").fetchSemanticsNode().boundsInRoot
        assertEquals(first.top, second.top, 1f)
        compose.onRoot().captureRoboImage("build/outputs/home-preview/tablet.png")
    }

    @Test fun providerAndSearchFilterResults() {
        render(sample.copy(officialSubFilter = OfficialSubFilter.GMAIL, search = "travel"))
        compose.onNodeWithTag("mailbox-one").assertDoesNotExist()
        compose.onNodeWithTag("mailbox-two").assertIsDisplayed()
        compose.onNodeWithTag("mailbox-four").assertDoesNotExist()
    }

    @Test fun selectedCardsToggleSelectionInsteadOfOpening() {
        var selected = ""
        var opened = ""
        render(sample.copy(selectedInboxIds = setOf("one")), actions = InboxHomeActions(select = { selected = it.id }, open = { opened = it.id }))
        compose.onNodeWithTag("mailbox-one").performClick()
        assertEquals("one", selected)
        assertEquals("", opened)
    }

    @Test fun providerMenuAndLongPressRemainAvailable() {
        var provider = OfficialSubFilter.ALL
        var selected = ""
        render(actions = InboxHomeActions(provider = { provider = it }, select = { selected = it.id }))
        compose.onNodeWithText("Gmail").performClick()
        assertEquals(OfficialSubFilter.GMAIL, provider)
        compose.onNodeWithTag("mailbox-one").performTouchInput { longClick() }
        assertEquals("one", selected)
    }

    @Test fun amazonAliasesAreExcludedButRealDottedAddressesStay() {
        val alias = Inbox("alias", "t.ravel.plans@gmail.com", isOfficial = true, isDottedGmailAlias = true, parentEmail = "travel.plans@gmail.com")
        val legacyAlias = Inbox("legacy", "trav.el.plans@gmail.com", isOfficial = true, parentEmail = "travel.plans@gmail.com")
        render(sample.copy(officialInboxes = listOf(alias, legacyAlias, sample.officialInboxes[1]), officialSubFilter = OfficialSubFilter.GMAIL))
        compose.onNodeWithTag("mailbox-alias").assertDoesNotExist()
        compose.onNodeWithTag("mailbox-legacy").assertDoesNotExist()
        compose.onNodeWithTag("mailbox-two").assertIsDisplayed()
    }

    @Test fun visibleSelectionButtonAndSelectAllUseOnlyFilteredResults() {
        var selected = ""
        var all = emptySet<String>()
        var opened = ""
        render(sample.copy(search = "travel"), actions = InboxHomeActions(select = { selected = it.id }, selectAll = { all = it }, open = { opened = it.id }))
        compose.onNodeWithText("تحديد", substring = false).performClick()
        compose.onNodeWithText("حذف المحدد").assertIsNotEnabled()
        compose.onNodeWithTag("mailbox-two").performClick()
        assertEquals("two", selected)
        assertEquals("", opened)
        compose.onNodeWithText("تحديد الكل").performClick()
        assertEquals(setOf("two"), all)
    }

    @Test fun bulkDeleteButtonRequestsConfirmationAndCanBeCancelled() {
        var requested = false
        var cancelled = false
        render(sample.copy(selectedInboxIds = setOf("one", "two")), actions = InboxHomeActions(deleteSelection = { requested = true }, clearSelection = { cancelled = true }))
        compose.onNodeWithText("حذف المحدد").performClick()
        assertEquals(true, requested)
        compose.onNodeWithContentDescription("إلغاء التحديد").performClick()
        assertEquals(true, cancelled)
        compose.onRoot().captureRoboImage("build/outputs/home-preview/multi-selection.png")
    }
}
