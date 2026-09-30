package com.batabitoo.mailcenter.ui

import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.LocalIndication
import androidx.compose.foundation.background
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.GridItemSpan
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.ArrowBack
import androidx.compose.material.icons.rounded.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalLayoutDirection
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.LayoutDirection
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.batabitoo.mailcenter.*
import com.batabitoo.mailcenter.data.Inbox
import java.text.NumberFormat
import java.util.Locale

// One restrained palette for the entire home, including its navigation chrome.
internal val HomePaper = Color(0xFFF4F3EC)
private val HomeInk = Color(0xFF183D35)
private val HomeMuted = Color(0xFF65736A)
private val HomeMint = Color(0xFFDDF0D9)
private val HomeLine = Color(0xFFE1E4DA)
private val HomeGold = Color(0xFF93763F)
private val HomeDanger = Color(0xFFAF4439)
private val HomeWhite = Color(0xFFFFFEFA)

internal data class InboxHomeActions(
    val create: () -> Unit = {},
    val search: (String) -> Unit = {},
    val filter: (InboxFilter) -> Unit = {},
    val provider: (OfficialSubFilter) -> Unit = {},
    val open: (Inbox) -> Unit = {},
    val copy: (Inbox) -> Unit = {},
    val select: (Inbox) -> Unit = {},
    val selectAll: (Set<String>) -> Unit = {},
    val delete: (Inbox) -> Unit = {},
    val clearSelection: () -> Unit = {},
    val deleteSelection: () -> Unit = {},
    val ban: (Inbox, String) -> Unit = { _, _ -> },
    val verify: (Inbox) -> Unit = {},
)

@Composable
internal fun InboxHomeRoute(state: MailUiState, viewModel: MailViewModel) {
    val clipboard = LocalClipboardManager.current
    val context = LocalContext.current
    var deleteTarget by remember { mutableStateOf<Inbox?>(null) }
    var deleteSelected by remember { mutableStateOf<Set<String>?>(null) }
    InboxHomeScreen(state, InboxHomeActions(
        create = { viewModel.setCreateVisible(true) },
        search = viewModel::setSearch,
        filter = viewModel::setInboxFilter,
        provider = viewModel::setOfficialSubFilter,
        open = viewModel::selectInbox,
        copy = {
            clipboard.setText(AnnotatedString(it.email))
            android.widget.Toast.makeText(context, "تم نسخ البريد", android.widget.Toast.LENGTH_SHORT).show()
        },
        select = { viewModel.toggleInboxSelection(it.id) },
        selectAll = viewModel::selectInboxes,
        delete = { deleteTarget = it },
        clearSelection = viewModel::clearInboxSelection,
        deleteSelection = { deleteSelected = state.selectedInboxIds.toSet() },
        ban = viewModel::updateBanStatus,
        verify = viewModel::triggerAiVerify,
    ))
    if (deleteTarget != null || !deleteSelected.isNullOrEmpty()) {
        AlertDialog(
            onDismissRequest = { deleteTarget = null; deleteSelected = null },
            containerColor = HomeWhite,
            title = { Text("حذف صندوق البريد؟", color = HomeInk) },
            text = { Text(deleteTarget?.let { "سيُحذف ${it.email} ورسائله المحفوظة." }
                ?: "سيتم حذف ${homeNumber(deleteSelected.orEmpty().size)} صندوق محدد ورسائلها.") },
            confirmButton = {
                TextButton(onClick = {
                    deleteTarget?.let(viewModel::deleteInbox) ?: viewModel.deleteSelectedInboxes(deleteSelected.orEmpty())
                    deleteTarget = null
                    deleteSelected = null
                }) { Text("حذف", color = HomeDanger) }
            },
            dismissButton = { TextButton(onClick = { deleteTarget = null; deleteSelected = null }) { Text("إلغاء", color = HomeInk) } },
        )
    }
}

@Composable
internal fun InboxHomeHeader(
    state: MailUiState,
    onRefresh: () -> Unit,
    onSettings: () -> Unit,
    onUpdate: () -> Unit,
) {
    Row(
        Modifier.fillMaxWidth().background(HomePaper).statusBarsPadding()
            .padding(horizontal = 20.dp, vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(
            Modifier.size(40.dp).clip(RoundedCornerShape(topStart = 14.dp, topEnd = 14.dp, bottomStart = 14.dp, bottomEnd = 4.dp)).background(HomeInk),
            contentAlignment = Alignment.Center,
        ) { Icon(Icons.Rounded.AlternateEmail, null, tint = HomeMint, modifier = Modifier.size(23.dp)) }
        Spacer(Modifier.width(10.dp))
        Column(Modifier.weight(1f)) {
            Text("بطابيطو", color = HomeInk, fontSize = 18.sp, fontWeight = FontWeight.Black)
            Row(verticalAlignment = Alignment.CenterVertically) {
                Box(Modifier.size(5.dp).background(if (state.cloudConnected) Color(0xFF43835D) else HomeGold, CircleShape))
                Spacer(Modifier.width(5.dp))
                Text(if (state.cloudConnected) "مساحتك متصلة" else "التحقق من الاتصال", color = HomeMuted, fontSize = 10.sp)
            }
        }
        if (state.appUpdate?.hasUpdate == true) {
            IconButton(onClick = onUpdate) { Icon(Icons.Rounded.SystemUpdate, "تحديث التطبيق", tint = HomeGold) }
        }
        IconButton(onClick = onRefresh, enabled = !state.refreshing, modifier = Modifier.size(44.dp)) {
            if (state.refreshing) CircularProgressIndicator(Modifier.size(19.dp), color = HomeInk, strokeWidth = 2.dp)
            else Icon(Icons.Rounded.Refresh, "تحديث الصناديق", tint = HomeInk, modifier = Modifier.size(22.dp))
        }
        IconButton(onClick = onSettings, modifier = Modifier.size(44.dp)) {
            Icon(Icons.Rounded.Settings, "الإعدادات", tint = HomeInk, modifier = Modifier.size(21.dp))
        }
    }
}

@Composable
internal fun InboxHomeNavigation(onSelect: (MainSection) -> Unit) {
    Surface(color = HomePaper) {
        Row(
            Modifier.fillMaxWidth().navigationBarsPadding().padding(horizontal = 16.dp, vertical = 8.dp),
            horizontalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            listOf(
                Triple(MainSection.INBOXES, "الرئيسية", Icons.Rounded.Inbox),
                Triple(MainSection.AMAZON, "أمازون", Icons.Rounded.ShoppingBag),
                Triple(MainSection.MESSAGES, "الرسائل", Icons.Rounded.MailOutline),
                Triple(MainSection.LOGS, "السجل", Icons.Rounded.History),
            ).forEach { (section, title, icon) ->
                val selected = section == MainSection.INBOXES
                Surface(
                    onClick = { onSelect(section) },
                    modifier = Modifier.weight(1f).heightIn(min = 54.dp),
                    color = if (selected) HomeInk else Color.Transparent,
                    shape = RoundedCornerShape(18.dp),
                ) {
                    Column(Modifier.padding(vertical = 6.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.Center) {
                        Icon(icon, null, tint = if (selected) HomeMint else HomeMuted, modifier = Modifier.size(21.dp))
                        Text(title, color = if (selected) HomeWhite else HomeMuted, fontSize = 10.sp, fontWeight = FontWeight.Bold, maxLines = 1)
                    }
                }
            }
        }
    }
}

@Composable
internal fun InboxHomeRail(expanded: Boolean, onSelect: (MainSection) -> Unit, onCreate: () -> Unit) {
    Column(
        Modifier.width(if (expanded) 188.dp else 76.dp).fillMaxHeight().background(HomePaper).padding(horizontal = 10.dp, vertical = 16.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(9.dp),
    ) {
        listOf(
            Triple(MainSection.INBOXES, "الرئيسية", Icons.Rounded.Inbox),
            Triple(MainSection.AMAZON, "أمازون", Icons.Rounded.ShoppingBag),
            Triple(MainSection.MESSAGES, "الرسائل", Icons.Rounded.MailOutline),
            Triple(MainSection.LOGS, "السجل", Icons.Rounded.History),
            Triple(MainSection.SETTINGS, "الإعدادات", Icons.Rounded.Settings),
        ).forEach { (section, title, icon) ->
            val selected = section == MainSection.INBOXES
            Surface(onClick = { onSelect(section) }, modifier = Modifier.fillMaxWidth(), color = if (selected) HomeInk else Color.Transparent, shape = RoundedCornerShape(16.dp)) {
                Row(Modifier.heightIn(min = 50.dp).padding(horizontal = 14.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.Center) {
                    Icon(icon, title, tint = if (selected) HomeMint else HomeMuted, modifier = Modifier.size(23.dp))
                    if (expanded) {
                        Spacer(Modifier.width(10.dp))
                        Text(title, color = if (selected) HomeWhite else HomeMuted, fontSize = 13.sp, modifier = Modifier.weight(1f))
                    }
                }
            }
        }
        Spacer(Modifier.weight(1f))
        Surface(onClick = onCreate, color = HomeMint, shape = RoundedCornerShape(16.dp), modifier = Modifier.fillMaxWidth()) {
            Row(Modifier.heightIn(min = 50.dp), horizontalArrangement = Arrangement.Center, verticalAlignment = Alignment.CenterVertically) {
                Icon(Icons.Rounded.Add, "إنشاء صندوق", tint = HomeInk)
                if (expanded) { Spacer(Modifier.width(7.dp)); Text("صندوق جديد", color = HomeInk, fontSize = 12.sp, fontWeight = FontWeight.Bold) }
            }
        }
    }
}

@Composable
internal fun InboxHomeScreen(state: MailUiState, actions: InboxHomeActions = InboxHomeActions()) {
    var selectionMode by rememberSaveable(state.inboxFilter, state.officialSubFilter, state.search) { mutableStateOf(false) }
    val selecting = selectionMode || state.selectedInboxIds.isNotEmpty()
    val officialCount = remember(state.officialInboxes) { state.officialInboxes.count { !it.isAmazonOnlyAlias } }
    val batabitooCount = remember(state.officialInboxes) { state.officialInboxes.count { !it.isAmazonOnlyAlias && it.isBatabitooDomain } }
    val gmailCount = remember(state.officialInboxes) { state.officialInboxes.count { !it.isAmazonOnlyAlias && it.isGmailDomain } }
    LaunchedEffect(state.deletingInboxes) { if (state.deletingInboxes) selectionMode = false }
    val inboxes = remember(state.officialInboxes, state.officialSubFilter, state.search) {
        val source = state.officialInboxes
        val query = state.search.trim()
        source.filter { inbox ->
            val providerMatches = when (state.officialSubFilter) {
                OfficialSubFilter.ALL -> true
                OfficialSubFilter.BATABITOO -> inbox.isBatabitooDomain
                OfficialSubFilter.GMAIL -> inbox.isGmailDomain
            }
            !inbox.isAmazonOnlyAlias && providerMatches && (query.isBlank() || listOf(inbox.email, inbox.personName, inbox.label, inbox.domain).any { it.contains(query, true) })
        }
    }
    LazyVerticalGrid(
        columns = GridCells.Adaptive(310.dp),
        modifier = Modifier.fillMaxSize().background(HomePaper).testTag("home-grid"),
        contentPadding = PaddingValues(start = 20.dp, end = 20.dp, top = 10.dp, bottom = 20.dp),
        horizontalArrangement = Arrangement.spacedBy(14.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        item(span = { GridItemSpan(maxLineSpan) }) {
            Row(Modifier.fillMaxWidth().padding(bottom = 4.dp), verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f)) {
                    Text("البريد، بترتيبك.", color = HomeInk, fontSize = 27.sp, fontWeight = FontWeight.Black, lineHeight = 34.sp)
                    Text("${homeNumber(officialCount)} صندوق  /  ${homeNumber(state.counts.messages)} رسالة", color = HomeMuted, fontSize = 12.sp)
                }
                Surface(
                    onClick = actions.create,
                    modifier = Modifier.size(48.dp),
                    color = HomeMint,
                    shape = RoundedCornerShape(16.dp),
                    border = BorderStroke(1.dp, Color(0xFFC4DEC0)),
                ) { Box(contentAlignment = Alignment.Center) { Icon(Icons.Rounded.Add, "إنشاء صندوق", tint = HomeInk) } }
            }
        }
        item(span = { GridItemSpan(maxLineSpan) }) {
            OutlinedTextField(
                value = state.search,
                onValueChange = actions.search,
                modifier = Modifier.fillMaxWidth().testTag("home-search"),
                placeholder = { Text("اعثر على بريدك…", color = HomeMuted, fontSize = 13.sp) },
                leadingIcon = { Icon(Icons.Rounded.Search, null, tint = HomeMuted, modifier = Modifier.size(21.dp)) },
                trailingIcon = {
                    if (state.search.isNotEmpty()) {
                        IconButton(onClick = { actions.search("") }) { Icon(Icons.Rounded.Close, "مسح البحث", tint = HomeMuted) }
                    }
                },
                shape = RoundedCornerShape(17.dp),
                singleLine = true,
                colors = OutlinedTextFieldDefaults.colors(
                    focusedBorderColor = HomeInk, unfocusedBorderColor = HomeLine,
                    focusedContainerColor = HomeWhite, unfocusedContainerColor = HomeWhite,
                    focusedTextColor = HomeInk, unfocusedTextColor = HomeInk, cursorColor = HomeInk,
                ),
            )
        }
        item(span = { GridItemSpan(maxLineSpan) }) {
            Row(Modifier.fillMaxWidth().clip(RoundedCornerShape(16.dp)).background(Color(0xFFE8EBE2)).padding(4.dp), horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                HomeCategory("كل الرسمي", officialCount, state.officialSubFilter == OfficialSubFilter.ALL, Modifier.weight(1f)) { actions.provider(OfficialSubFilter.ALL) }
                HomeCategory("بطابيطو", batabitooCount, state.officialSubFilter == OfficialSubFilter.BATABITOO, Modifier.weight(1f)) { actions.provider(OfficialSubFilter.BATABITOO) }
                HomeCategory("Gmail", gmailCount, state.officialSubFilter == OfficialSubFilter.GMAIL, Modifier.weight(1f)) { actions.provider(OfficialSubFilter.GMAIL) }
            }
        }
        item(span = { GridItemSpan(maxLineSpan) }) {
            if (selecting) {
                Surface(color = HomeInk, shape = RoundedCornerShape(14.dp)) {
                    Column(Modifier.padding(horizontal = 12.dp, vertical = 4.dp)) {
                      Row(verticalAlignment = Alignment.CenterVertically) {
                        Text("${homeNumber(state.selectedInboxIds.size)} محدد", color = HomeWhite, fontWeight = FontWeight.Bold, modifier = Modifier.weight(1f))
                        val allSelected = inboxes.isNotEmpty() && inboxes.all { it.id in state.selectedInboxIds }
                        TextButton(onClick = { actions.selectAll(if (allSelected) emptySet() else inboxes.map { it.id }.toSet()) }, enabled = !state.deletingInboxes && inboxes.isNotEmpty()) {
                            Text(if (allSelected) "إلغاء الكل" else "تحديد الكل", color = HomeMint, fontSize = 12.sp)
                        }
                        IconButton(onClick = { selectionMode = false; actions.clearSelection() }, enabled = !state.deletingInboxes) { Icon(Icons.Rounded.Close, "إلغاء التحديد", tint = HomeWhite) }
                      }
                      Button(onClick = actions.deleteSelection, enabled = state.selectedInboxIds.isNotEmpty() && !state.deletingInboxes,
                          modifier = Modifier.fillMaxWidth().padding(bottom = 5.dp), shape = RoundedCornerShape(10.dp),
                          colors = ButtonDefaults.buttonColors(containerColor = Color(0xFFFFDED1), contentColor = HomeDanger)) {
                          Icon(Icons.Rounded.DeleteOutline, null, modifier = Modifier.size(18.dp))
                          Spacer(Modifier.width(7.dp))
                          Text(if (state.deletingInboxes) "جارٍ الحذف…" else "حذف المحدد", fontSize = 12.sp)
                      }
                    }
                }
            } else {
                Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                    Text("${homeNumber(inboxes.size)} صندوق", color = HomeMuted, fontSize = 12.sp, modifier = Modifier.weight(1f))
                    TextButton(onClick = { selectionMode = true }, enabled = inboxes.isNotEmpty()) {
                        Icon(Icons.Rounded.Checklist, null, tint = HomeInk, modifier = Modifier.size(18.dp))
                        Spacer(Modifier.width(5.dp))
                        Text("تحديد", color = HomeInk, fontWeight = FontWeight.Bold, fontSize = 12.sp)
                    }
                }
            }
        }
        if (inboxes.isEmpty()) {
            item(span = { GridItemSpan(maxLineSpan) }) {
                Column(Modifier.fillMaxWidth().padding(vertical = 34.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                    Icon(Icons.Rounded.MarkEmailRead, null, tint = HomeGold, modifier = Modifier.size(42.dp))
                    Spacer(Modifier.height(12.dp))
                    Text("مساحة لبداية جديدة", color = HomeInk, fontWeight = FontWeight.Bold, fontSize = 18.sp)
                    Text("جرّب بحثًا آخر أو أنشئ صندوق بريد.", color = HomeMuted, fontSize = 12.sp)
                    TextButton(onClick = actions.create) { Text("إنشاء صندوق", color = HomeInk) }
                }
            }
        }
        items(inboxes, key = { it.id }, contentType = { "mailbox" }) { inbox ->
            HomeMailboxCard(inbox, state.activeInbox?.id == inbox.id, inbox.id in state.selectedInboxIds, selecting, actions)
        }
    }
}

@Composable
private fun HomeCategory(label: String, count: Int, selected: Boolean, modifier: Modifier, onClick: () -> Unit) {
    val background by animateColorAsState(if (selected) HomeInk else Color.Transparent, tween(180), label = "category-color")
    Surface(onClick = onClick, modifier = modifier, color = background, shape = RoundedCornerShape(12.dp)) {
        Row(Modifier.heightIn(min = 43.dp).padding(horizontal = 10.dp, vertical = 8.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.Center) {
            Text(label, color = if (selected) HomeWhite else HomeMuted, fontSize = 12.sp, fontWeight = FontWeight.Bold, maxLines = 1)
            Spacer(Modifier.width(7.dp))
            Text(homeNumber(count), color = if (selected) HomeMint else HomeMuted, fontSize = 10.sp, fontWeight = FontWeight.Bold)
        }
    }
}

@Composable
private fun HomeProviderMenu(selected: OfficialSubFilter, onSelect: (OfficialSubFilter) -> Unit) {
    var expanded by remember { mutableStateOf(false) }
    val label = when (selected) { OfficialSubFilter.ALL -> "الكل"; OfficialSubFilter.BATABITOO -> "بطابيطو"; OfficialSubFilter.GMAIL -> "Gmail" }
    Box {
        IconButton(onClick = { expanded = true }, modifier = Modifier.padding(end = 5.dp).clip(RoundedCornerShape(12.dp)).background(if (selected == OfficialSubFilter.ALL) HomePaper else HomeMint)) {
            Icon(Icons.Rounded.Tune, "تصفية المزود: $label", tint = HomeInk, modifier = Modifier.size(20.dp))
        }
        DropdownMenu(expanded = expanded, onDismissRequest = { expanded = false }, containerColor = HomeWhite) {
            listOf(OfficialSubFilter.ALL to "كل الحسابات الرسمية", OfficialSubFilter.BATABITOO to "بطابيطو", OfficialSubFilter.GMAIL to "Gmail").forEach { (filter, title) ->
                DropdownMenuItem(text = { Text(title, color = HomeInk) },
                    trailingIcon = { if (selected == filter) Icon(Icons.Rounded.Check, null, tint = HomeInk) },
                    onClick = { expanded = false; onSelect(filter) })
            }
        }
    }
}

@OptIn(androidx.compose.foundation.ExperimentalFoundationApi::class)
@Composable
private fun HomeMailboxCard(inbox: Inbox, active: Boolean, selected: Boolean, selectionMode: Boolean, actions: InboxHomeActions) {
    val interaction = remember { MutableInteractionSource() }
    val pressed by interaction.collectIsPressedAsState()
    val scale by animateFloatAsState(if (pressed) .975f else 1f, tween(140), label = "mailbox-touch")
    val dark = active && !selected && !inbox.isSuspected && !inbox.isConfirmedBanned
    val background by animateColorAsState(if (selected) HomeMint else if (dark) HomeInk else HomeWhite, tween(180), label = "mailbox-select")
    val ink = if (dark) HomeWhite else HomeInk
    val muted = if (dark) Color(0xFFB5C9BE) else HomeMuted
    val rule = if (dark) Color.White.copy(alpha = .14f) else HomeLine
    var menuOpen by remember(inbox.id) { mutableStateOf(false) }
    val warning = inbox.isConfirmedBanned || inbox.isSuspected
    val statusColor = if (warning) HomeDanger else HomeInk
    val shape = RoundedCornerShape(topStart = 22.dp, topEnd = 22.dp, bottomStart = 22.dp, bottomEnd = 7.dp)
    Surface(
        modifier = Modifier.fillMaxWidth().testTag("mailbox-${inbox.id}")
            .semantics { this.selected = selected }
            .graphicsLayer { scaleX = scale; scaleY = scale }
            .clip(shape)
            .combinedClickable(
                interactionSource = interaction, indication = LocalIndication.current, role = if (selectionMode) Role.Checkbox else Role.Button,
                onClick = { if (selectionMode) actions.select(inbox) else actions.open(inbox) },
                onLongClickLabel = "تحديد الصندوق", onLongClick = { actions.select(inbox) },
            ),
        shape = shape,
        color = background,
        border = BorderStroke(1.dp, if (selected || active) HomeInk.copy(alpha = .5f) else HomeLine),
    ) {
        Column(Modifier.padding(horizontal = 16.dp, vertical = 11.dp)) {
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                Box(Modifier.size(24.dp).clip(CircleShape).background(if (warning) Color(0xFFFFE6DB) else HomeMint), contentAlignment = Alignment.Center) {
                    Icon(when {
                        selectionMode -> if (selected) Icons.Rounded.Check else Icons.Rounded.RadioButtonUnchecked
                        selected -> Icons.Rounded.Check
                        inbox.isConfirmedBanned -> Icons.Rounded.Block
                        inbox.isSuspected -> Icons.Rounded.PriorityHigh
                        inbox.isGmailDomain -> Icons.Rounded.MailOutline
                        else -> Icons.Rounded.AlternateEmail
                    }, null, tint = statusColor, modifier = Modifier.size(14.dp))
                }
                Spacer(Modifier.width(7.dp))
                Text(inbox.personName.ifBlank { inbox.label.ifBlank { "بريدك الرسمي" } },
                    color = muted, fontSize = 11.sp, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f))
                Text(when {
                    inbox.isConfirmedBanned -> "محظور"
                    inbox.isSuspected -> "يحتاج مراجعة"
                    inbox.isGmailDomain -> if (inbox.isDottedGmailAlias) "GMAIL ALIAS" else "GMAIL"
                    inbox.isBatabitooDomain -> "BATABITOO"
                    else -> "OFFICIAL"
                }, color = if (warning) (if (dark) Color(0xFFFFBAA1) else HomeDanger) else if (dark) Color(0xFFDECAA4) else HomeGold, fontSize = 9.sp, fontWeight = FontWeight.Bold, maxLines = 1)
                Box {
                    IconButton(onClick = { menuOpen = true }, modifier = Modifier.size(32.dp)) {
                        Icon(Icons.Rounded.MoreHoriz, "إجراءات ${inbox.email}", tint = muted, modifier = Modifier.size(21.dp))
                    }
                    DropdownMenu(expanded = menuOpen, onDismissRequest = { menuOpen = false }, containerColor = HomeWhite) {
                        DropdownMenuItem(text = { Text(if (selected) "إلغاء التحديد" else "تحديد الصندوق") },
                            leadingIcon = { Icon(Icons.Rounded.CheckCircle, null, tint = HomeInk) },
                            onClick = { menuOpen = false; actions.select(inbox) })
                        DropdownMenuItem(text = { Text("حذف الصندوق", color = HomeDanger) },
                            leadingIcon = { Icon(Icons.Rounded.DeleteOutline, null, tint = HomeDanger) },
                            onClick = { menuOpen = false; actions.delete(inbox) })
                    }
                }
            }
            CompositionLocalProvider(LocalLayoutDirection provides LayoutDirection.Ltr) {
                Row(Modifier.fillMaxWidth().padding(top = 3.dp, bottom = 10.dp), verticalAlignment = Alignment.CenterVertically) {
                    Column(Modifier.weight(1f)) {
                        Text(inbox.email.substringBefore('@'), color = ink, fontSize = 21.sp, lineHeight = 27.sp, fontWeight = FontWeight.Bold,
                            maxLines = 1, overflow = TextOverflow.Ellipsis)
                        Text("@${inbox.email.substringAfter('@', inbox.domain)}", color = muted, fontSize = 12.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    }
                    IconButton(onClick = { actions.copy(inbox) }, modifier = Modifier.size(42.dp).clip(RoundedCornerShape(13.dp)).background(if (dark) Color.White.copy(alpha = .09f) else HomePaper)) {
                        Icon(Icons.Rounded.ContentCopy, "نسخ ${inbox.email}", tint = ink, modifier = Modifier.size(18.dp))
                    }
                }
            }
            HorizontalDivider(color = rule)
            Row(Modifier.fillMaxWidth().padding(top = 9.dp), verticalAlignment = Alignment.CenterVertically) {
                Text(if (selected) "تم التحديد" else if (selectionMode) "تحديد الصندوق" else if (active) "آخر صندوق مفتوح" else "فتح الصندوق", color = ink, fontSize = 10.sp, fontWeight = FontWeight.Bold)
                Spacer(Modifier.width(5.dp))
                Icon(if (selected) Icons.Rounded.Check else Icons.AutoMirrored.Rounded.ArrowBack, null, tint = ink, modifier = Modifier.size(14.dp))
                Spacer(Modifier.weight(1f))
                Icon(Icons.Rounded.MailOutline, null, tint = muted, modifier = Modifier.size(13.dp))
                Spacer(Modifier.width(5.dp))
                Text(if (inbox.messageCount == 0) "صندوق هادئ" else "${homeNumber(inbox.messageCount)} رسالة", color = muted, fontSize = 10.sp)
            }
            if (inbox.isSuspected) {
                Column(Modifier.padding(top = 10.dp)) {
                    Text(inbox.banReason.ifBlank { "راجع حالة الحساب لتأكيد الحظر أو اعتباره سليمًا." }, color = HomeDanger, fontSize = 11.sp, maxLines = 2, overflow = TextOverflow.Ellipsis)
                    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                        TextButton(onClick = { actions.ban(inbox, "confirmed") }) { Text("تأكيد الحظر", color = HomeDanger, fontSize = 11.sp) }
                        TextButton(onClick = { actions.ban(inbox, "safe") }) { Text("الحساب سليم", color = HomeInk, fontSize = 11.sp) }
                        TextButton(onClick = { actions.verify(inbox) }) { Text("فحص", color = HomeGold, fontSize = 11.sp) }
                    }
                }
            }
        }
    }
}

private fun homeNumber(value: Int): String = NumberFormat.getIntegerInstance(Locale.forLanguageTag("ar-SA")).format(value)
