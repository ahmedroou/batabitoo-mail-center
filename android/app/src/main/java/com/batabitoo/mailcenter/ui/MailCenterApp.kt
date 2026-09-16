package com.batabitoo.mailcenter.ui

import android.content.Intent
import android.net.Uri
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.activity.compose.BackHandler
import androidx.compose.animation.Crossfade
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.Add
import androidx.compose.material.icons.rounded.AlternateEmail
import androidx.compose.material.icons.rounded.Block
import androidx.compose.material.icons.rounded.Bolt
import androidx.compose.material.icons.rounded.CheckCircle
import androidx.compose.material.icons.rounded.CloudDone
import androidx.compose.material.icons.rounded.CloudOff
import androidx.compose.material.icons.rounded.ContentCopy
import androidx.compose.material.icons.rounded.DeleteOutline
import androidx.compose.material.icons.rounded.Download
import androidx.compose.material.icons.rounded.Inbox
import androidx.compose.material.icons.rounded.Language
import androidx.compose.material.icons.rounded.MailOutline
import androidx.compose.material.icons.rounded.MoreVert
import androidx.compose.material.icons.rounded.OpenInBrowser
import androidx.compose.material.icons.rounded.ReceiptLong
import androidx.compose.material.icons.rounded.Refresh
import androidx.compose.material.icons.rounded.Search
import androidx.compose.material.icons.rounded.Settings
import androidx.compose.material.icons.rounded.ShoppingCart
import androidx.compose.material.icons.rounded.Storage
import androidx.compose.material.icons.rounded.SystemUpdate
import androidx.compose.material.icons.rounded.Warning
import androidx.compose.material.icons.rounded.WorkspacePremium
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.material3.FilledIconButton
import androidx.compose.material3.FloatingActionButton
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import com.batabitoo.mailcenter.AmazonTab
import com.batabitoo.mailcenter.InboxFilter
import com.batabitoo.mailcenter.MailUiState
import com.batabitoo.mailcenter.MailViewModel
import com.batabitoo.mailcenter.MainSection
import com.batabitoo.mailcenter.MessageFilter
import com.batabitoo.mailcenter.data.AppVersionInfo
import com.batabitoo.mailcenter.data.Inbox
import com.batabitoo.mailcenter.data.MailMessage
import com.batabitoo.mailcenter.data.SenderFormatter
import com.batabitoo.mailcenter.data.RegistrationLog
import com.batabitoo.mailcenter.ui.theme.AmazonOrange
import com.batabitoo.mailcenter.ui.theme.AmazonWarm
import com.batabitoo.mailcenter.ui.theme.BannedLight
import com.batabitoo.mailcenter.ui.theme.BannedRed
import com.batabitoo.mailcenter.ui.theme.Canvas as AppCanvas
import com.batabitoo.mailcenter.ui.theme.CardBorder
import com.batabitoo.mailcenter.ui.theme.CardBorderSubtle
import com.batabitoo.mailcenter.ui.theme.Cyan
import com.batabitoo.mailcenter.ui.theme.Danger
import com.batabitoo.mailcenter.ui.theme.Gold
import com.batabitoo.mailcenter.ui.theme.Green
import com.batabitoo.mailcenter.ui.theme.GreenLight
import com.batabitoo.mailcenter.ui.theme.Ink
import com.batabitoo.mailcenter.ui.theme.Muted
import com.batabitoo.mailcenter.ui.theme.OfficialGold
import com.batabitoo.mailcenter.ui.theme.OfficialLight
import com.batabitoo.mailcenter.ui.theme.Primary
import com.batabitoo.mailcenter.ui.theme.PrimaryLight
import com.batabitoo.mailcenter.ui.theme.Surface
import com.batabitoo.mailcenter.ui.theme.SurfaceSoft
import com.batabitoo.mailcenter.ui.theme.TempLight
import com.batabitoo.mailcenter.ui.theme.Violet
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Locale
import kotlin.math.cos
import kotlin.math.sin

@Composable
fun MailCenterApp(viewModel: MailViewModel = viewModel()) {
    val state by viewModel.uiState.collectAsStateWithLifecycle()
    val snackbar = remember { SnackbarHostState() }
    BackHandler(enabled = state.section != MainSection.INBOXES && !state.showCreate && state.selectedMessage == null) {
        viewModel.setSection(MainSection.INBOXES)
    }

    LaunchedEffect(state.notice, state.error) {
        (state.error ?: state.notice)?.let {
            snackbar.showSnackbar(it)
            viewModel.consumeNotice()
        }
    }

    Scaffold(
        containerColor = AppCanvas,
        snackbarHost = { SnackbarHost(snackbar) },
        topBar = { AppHeader(state, viewModel) },
        bottomBar = { BottomDock(state.section, viewModel::setSection) { viewModel.setCreateVisible(true) } },
    ) { padding ->
        Box(Modifier.fillMaxSize().padding(padding)) {
            Crossfade(targetState = state.section, animationSpec = tween(220), label = "section") { section ->
            when (section) {
                MainSection.INBOXES -> InboxesScreen(state, viewModel)
                MainSection.AMAZON -> AmazonScreen(state, viewModel)
                MainSection.MESSAGES -> MessagesScreen(state, viewModel)
                MainSection.LOGS -> LogsScreen(state, viewModel::setSearch)
                MainSection.SETTINGS -> SettingsScreen(state, viewModel)
            }
            }
            if (state.loading) LoadingVeil()
        }
    }

    if (state.showCreate) CreateInboxSheet(state, viewModel)
    state.selectedMessage?.let { EmailReader(it, state.baseUrl, state.messageLoading, state.messageError, { viewModel.openMessage(it) }, viewModel::closeMessage) }
    val appUpdate = state.appUpdate
    if (state.showUpdateDialog && appUpdate != null) {
        InAppUpdateDialog(
            update = appUpdate,
            currentVersionName = state.currentVersionName,
            onDismiss = { viewModel.setUpdateDialogVisible(false) },
        )
    }
}

@Composable
private fun AppHeader(state: MailUiState, viewModel: MailViewModel) {
    Row(
        Modifier
            .fillMaxWidth()
            .background(AppCanvas.copy(alpha = 0.98f))
            .statusBarsPadding()
            .padding(horizontal = 16.dp, vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(
            Modifier
                .size(42.dp)
                .clip(RoundedCornerShape(14.dp))
                .background(Brush.linearGradient(listOf(Violet, Primary, Cyan))),
            contentAlignment = Alignment.Center,
        ) {
            Icon(Icons.Rounded.MailOutline, contentDescription = null, tint = Color.White, modifier = Modifier.size(22.dp))
        }
        Spacer(Modifier.width(10.dp))
        Column(Modifier.weight(1f)) {
            Text(
                if (java.time.LocalTime.now().hour < 12) "صباح الخير 👋" else "مساء الخير 👋",
                color = Muted,
                style = MaterialTheme.typography.labelSmall,
                fontSize = 11.sp,
            )
            Text(
                "بريد بطابيطو",
                style = MaterialTheme.typography.titleMedium,
                fontWeight = FontWeight.ExtraBold,
                color = Ink,
            )
        }
        if (state.appUpdate?.hasUpdate == true) {
            Row(
                modifier = Modifier
                    .clip(RoundedCornerShape(10.dp))
                    .clickable { viewModel.setUpdateDialogVisible(true) }
                    .background(Brush.linearGradient(listOf(Color(0xFFEA580C), Color(0xFFEF4444))))
                    .padding(horizontal = 8.dp, vertical = 5.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(4.dp),
            ) {
                Icon(
                    Icons.Rounded.Download,
                    contentDescription = null,
                    tint = Color.White,
                    modifier = Modifier.size(13.dp),
                )
                Text(
                    "تحديث جديد 🚀",
                    color = Color.White,
                    style = MaterialTheme.typography.labelSmall,
                    fontWeight = FontWeight.Bold,
                    fontSize = 10.sp,
                )
            }
            Spacer(Modifier.width(4.dp))
        }
        Box(
            Modifier
                .size(9.dp)
                .clip(CircleShape)
                .background(if (state.online) Green else Danger),
        )
        Spacer(Modifier.width(4.dp))
        IconButton(
            onClick = { viewModel.refreshAll() },
            enabled = !state.refreshing,
            modifier = Modifier.size(42.dp),
        ) {
            if (state.refreshing) {
                CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp, color = Primary)
            } else {
                Icon(Icons.Rounded.Refresh, "تحديث", tint = Ink, modifier = Modifier.size(22.dp))
            }
        }
        IconButton(
            onClick = { viewModel.setSection(MainSection.SETTINGS) },
            modifier = Modifier.size(42.dp),
        ) {
            Icon(
                Icons.Rounded.Settings,
                "الإعدادات",
                tint = if (state.section == MainSection.SETTINGS) Primary else Ink,
                modifier = Modifier.size(22.dp),
            )
        }
    }
}

@Composable
private fun InboxesScreen(state: MailUiState, viewModel: MailViewModel) {
    val clipboard = LocalClipboardManager.current
    val context = LocalContext.current
    var deleteTarget by remember { mutableStateOf<Inbox?>(null) }
    val source = when (state.inboxFilter) {
        InboxFilter.OFFICIAL -> state.officialInboxes
        InboxFilter.TEMP -> state.tempInboxes
    }
    val query = state.search.trim()
    val list = source.filter { query.isBlank() || listOf(it.email, it.personName, it.label, it.domain).any { value -> value.contains(query, true) } }

    LazyColumn(
        Modifier.fillMaxSize(),
        contentPadding = PaddingValues(start = 14.dp, end = 14.dp, top = 4.dp, bottom = 100.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        item {
            MailUniverseHero(
                state = state,
                onSelectFilter = { viewModel.setInboxFilter(it) },
                onNavigateToAmazon = { viewModel.setSection(MainSection.AMAZON) }
            )
        }
        val update = state.appUpdate
        if (update != null && update.hasUpdate) {
            item {
                InAppUpdateBanner(
                    update = update,
                    currentVersionName = state.currentVersionName,
                    onClick = { viewModel.setUpdateDialogVisible(true) },
                )
            }
        }
        item {
            Row(
                Modifier
                    .fillMaxWidth()
                    .padding(top = 14.dp, bottom = 8.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Column(Modifier.weight(1f)) {
                    Text("حساباتك الرسمية والمؤقتة", color = Primary, style = MaterialTheme.typography.labelSmall)
                    Text("صناديق البريد", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
                }
                Text(
                    "${arabicNumber(list.size)} صندوق",
                    color = Muted,
                    style = MaterialTheme.typography.labelSmall,
                )
            }
            MailPills(
                listOf(
                    "بريد رسمي (@batabitoo.com)  ${arabicNumber(state.officialInboxes.size)}",
                    "بريد سريع (مؤقت)  ${arabicNumber(state.tempInboxes.size)}",
                ),
                state.inboxFilter.ordinal,
            ) { viewModel.setInboxFilter(InboxFilter.entries[it]) }
            Spacer(Modifier.height(8.dp))
            SearchField(state.search, "ابحث بالاسم أو البريد...", viewModel::setSearch)
            Spacer(Modifier.height(2.dp))
        }
        if (list.isEmpty()) {
            item { EmptyList("لا توجد صناديق مطابقة", "جرّب عبارة أخرى أو أنشئ صندوقًا جديدًا.") }
        } else {
            items(list, key = { it.id }) { inbox ->
                InboxRow(
                    inbox = inbox,
                    active = state.activeInbox?.id == inbox.id,
                    onClick = { viewModel.selectInbox(inbox) },
                    onCopyEmail = {
                        clipboard.setText(AnnotatedString(inbox.email))
                        android.widget.Toast.makeText(context, "تم نسخ البريد", android.widget.Toast.LENGTH_SHORT).show()
                    },
                    onDelete = { deleteTarget = inbox },
                    onConfirmBan = if (inbox.isSuspected) { { viewModel.updateBanStatus(inbox, "confirmed") } } else null,
                    onMarkSafe = if (inbox.isSuspected) { { viewModel.updateBanStatus(inbox, "safe") } } else null,
                    onAiVerify = if (inbox.isSuspected) { { viewModel.triggerAiVerify(inbox) } } else null,
                )
            }
        }
    }

    deleteTarget?.let { inbox ->
        AlertDialog(
            onDismissRequest = { deleteTarget = null },
            icon = { Icon(Icons.Rounded.DeleteOutline, null, tint = Danger) },
            title = { Text("حذف صندوق البريد؟") },
            text = { Text("سيُحذف ${inbox.email} ورسائله المحفوظة.", color = Muted) },
            confirmButton = {
                Button(
                    onClick = { viewModel.deleteInbox(inbox); deleteTarget = null },
                    colors = ButtonDefaults.buttonColors(containerColor = Danger),
                ) { Text("حذف") }
            },
            dismissButton = { TextButton(onClick = { deleteTarget = null }) { Text("إلغاء") } },
        )
    }
}

@Composable
private fun MailUniverseHero(
    state: MailUiState,
    onSelectFilter: (InboxFilter) -> Unit,
    onNavigateToAmazon: () -> Unit,
) {
    val motion = rememberInfiniteTransition(label = "mail universe")
    val tilt by motion.animateFloat(-8f, 8f, infiniteRepeatable(tween(3600), RepeatMode.Reverse), label = "tilt")
    val drift by motion.animateFloat(0f, 1f, infiniteRepeatable(tween(6000), RepeatMode.Restart), label = "drift")
    val density = LocalDensity.current.density

    Card(
        colors = CardDefaults.cardColors(containerColor = Color.Transparent),
        shape = RoundedCornerShape(22.dp),
        elevation = CardDefaults.cardElevation(defaultElevation = 6.dp),
    ) {
        Box(
            Modifier
                .fillMaxWidth()
                .heightIn(min = 138.dp)
                .background(
                    Brush.linearGradient(listOf(Color(0xFF0F172A), Color(0xFF1E1B4B), Primary))
                )
                .padding(14.dp)
        ) {
            Canvas(Modifier.matchParentSize()) {
                repeat(8) { index ->
                    val phase = drift * 6.283f + index * 1.1f
                    val x = size.width * (0.1f + (index % 4) * 0.24f) + cos(phase) * 8.dp.toPx()
                    val y = size.height * (0.2f + (index % 3) * 0.28f) + sin(phase * 0.8f) * 6.dp.toPx()
                    drawCircle(
                        Color.White.copy(alpha = 0.08f + (index % 2) * 0.04f),
                        radius = (2 + index % 2).dp.toPx(),
                        center = androidx.compose.ui.geometry.Offset(x, y),
                    )
                }
                drawCircle(
                    Cyan.copy(alpha = 0.12f),
                    radius = 70.dp.toPx(),
                    center = androidx.compose.ui.geometry.Offset(size.width * 0.16f, size.height * 0.2f),
                )
            }
            Column(Modifier.align(Alignment.CenterEnd).fillMaxWidth(0.60f)) {
                Text(
                    "مساحتك البريدية",
                    color = Color.White.copy(alpha = 0.75f),
                    style = MaterialTheme.typography.labelSmall,
                )
                Text(
                    arabicNumber(state.counts.totalInboxes),
                    color = Color.White,
                    fontSize = 30.sp,
                    fontWeight = FontWeight.Black,
                    lineHeight = 34.sp,
                )
                Text(
                    "صندوق نشط من مكان واحد",
                    color = Color.White.copy(alpha = 0.82f),
                    style = MaterialTheme.typography.bodySmall,
                    fontSize = 11.sp,
                )
                Spacer(Modifier.height(10.dp))
                Row(
                    modifier = Modifier.horizontalScroll(rememberScrollState()),
                    horizontalArrangement = Arrangement.spacedBy(6.dp),
                ) {
                    InteractiveHeroChip("رسمي", state.counts.official, Gold, state.inboxFilter == InboxFilter.OFFICIAL) {
                        onSelectFilter(InboxFilter.OFFICIAL)
                    }
                    InteractiveHeroChip("سريع", state.counts.temp, Cyan, state.inboxFilter == InboxFilter.TEMP) {
                        onSelectFilter(InboxFilter.TEMP)
                    }
                    InteractiveHeroChip("مركز أمازون 🛒", state.amazonInboxes.size, AmazonOrange, false) {
                        onNavigateToAmazon()
                    }
                }
            }
            Box(
                Modifier
                    .align(Alignment.CenterStart)
                    .size(96.dp, 76.dp)
                    .graphicsLayer {
                        rotationY = tilt
                        rotationZ = -5f + tilt * 0.06f
                        translationY = sin(drift * 6.283f) * 5 * density
                        cameraDistance = 16 * density
                        shadowElevation = 14.dp.toPx()
                        shape = RoundedCornerShape(18.dp)
                        clip = true
                    }
                    .background(Brush.linearGradient(listOf(Color(0xFFF9FCFF), Color(0xFFAED8FF)))),
            ) {
                Icon(
                    Icons.Rounded.MailOutline,
                    null,
                    tint = Primary.copy(alpha = 0.78f),
                    modifier = Modifier.size(42.dp).align(Alignment.Center),
                )
                Box(
                    Modifier
                        .align(Alignment.TopEnd)
                        .padding(7.dp)
                        .size(12.dp)
                        .clip(CircleShape)
                        .background(Cyan),
                )
            }
        }
    }
}

@Composable
private fun InteractiveHeroChip(
    label: String,
    value: Int,
    color: Color,
    selected: Boolean,
    onClick: () -> Unit,
) {
    Row(
        Modifier
            .clip(RoundedCornerShape(10.dp))
            .clickable(onClick = onClick)
            .background(if (selected) color.copy(alpha = 0.28f) else Color.White.copy(alpha = 0.12f))
            .padding(horizontal = 8.dp, vertical = 5.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(5.dp),
    ) {
        Box(Modifier.size(6.dp).clip(CircleShape).background(color))
        Text(
            "$label ${arabicNumber(value)}",
            color = Color.White,
            style = MaterialTheme.typography.labelSmall,
            fontSize = 10.sp,
            fontWeight = if (selected) FontWeight.ExtraBold else FontWeight.Medium,
        )
    }
}

@Composable
private fun BanConfirmationBox(
    reason: String,
    onConfirmBan: () -> Unit,
    onMarkSafe: () -> Unit,
    onAiVerify: (() -> Unit)? = null,
    modifier: Modifier = Modifier,
) {
    Card(
        modifier = modifier.fillMaxWidth(),
        shape = RoundedCornerShape(12.dp),
        colors = CardDefaults.cardColors(containerColor = Color(0xFFFFFBEB)),
        border = BorderStroke(1.dp, Color(0xFFFDE68A)),
        elevation = CardDefaults.cardElevation(defaultElevation = 0.dp),
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 10.dp, vertical = 8.dp),
            verticalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(6.dp),
            ) {
                Icon(
                    Icons.Rounded.Warning,
                    contentDescription = null,
                    tint = Color(0xFFD97706),
                    modifier = Modifier.size(16.dp),
                )
                Text(
                    text = "اشتباه حظر: هل تم حظر أو تقييد هذا الحساب فعلاً؟",
                    color = Color(0xFF92400E),
                    fontSize = 11.sp,
                    fontWeight = FontWeight.Bold,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
            }
            if (reason.isNotBlank()) {
                Text(
                    text = "سبب الاشتباه: $reason",
                    color = Color(0xFFB45309),
                    fontSize = 10.sp,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
            }
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                Button(
                    onClick = onConfirmBan,
                    shape = RoundedCornerShape(8.dp),
                    colors = ButtonDefaults.buttonColors(containerColor = BannedRed),
                    contentPadding = PaddingValues(horizontal = 8.dp, vertical = 2.dp),
                    modifier = Modifier.weight(1f).height(30.dp),
                ) {
                    Text(
                        "تأكيد الحظر ⛔",
                        fontSize = 10.sp,
                        fontWeight = FontWeight.Bold,
                        color = Color.White,
                    )
                }
                OutlinedButton(
                    onClick = onMarkSafe,
                    shape = RoundedCornerShape(8.dp),
                    border = BorderStroke(1.dp, Green),
                    colors = ButtonDefaults.outlinedButtonColors(contentColor = Green),
                    contentPadding = PaddingValues(horizontal = 8.dp, vertical = 2.dp),
                    modifier = Modifier.weight(1f).height(30.dp),
                ) {
                    Text(
                        "الحساب سليم ✅",
                        fontSize = 10.sp,
                        fontWeight = FontWeight.Bold,
                    )
                }
                if (onAiVerify != null) {
                    Button(
                        onClick = onAiVerify,
                        shape = RoundedCornerShape(8.dp),
                        colors = ButtonDefaults.buttonColors(containerColor = Color(0xFF7C3AED)),
                        contentPadding = PaddingValues(horizontal = 8.dp, vertical = 2.dp),
                        modifier = Modifier.weight(1f).height(30.dp),
                    ) {
                        Text(
                            "فحص AI 🤖",
                            fontSize = 10.sp,
                            fontWeight = FontWeight.Bold,
                            color = Color.White,
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun InboxRow(
    inbox: Inbox,
    active: Boolean,
    onClick: () -> Unit,
    onCopyEmail: () -> Unit,
    onDelete: () -> Unit,
    onConfirmBan: (() -> Unit)? = null,
    onMarkSafe: (() -> Unit)? = null,
    onAiVerify: (() -> Unit)? = null,
) {
    val accent = when {
        inbox.isConfirmedBanned -> BannedRed
        inbox.isSuspected -> Color(0xFFF59E0B)
        inbox.isAmazon -> AmazonOrange
        inbox.isOfficial -> OfficialGold
        else -> Cyan
    }
    var menuOpen by remember { mutableStateOf(false) }

    Card(
        modifier = Modifier
            .fillMaxWidth()
            .clickable(onClick = onClick),
        shape = RoundedCornerShape(16.dp),
        colors = CardDefaults.cardColors(
            containerColor = if (active) PrimaryLight.copy(alpha = 0.7f) else Surface,
        ),
        border = BorderStroke(
            1.dp,
            if (active) Primary.copy(alpha = 0.6f) else if (inbox.isSuspected) Color(0xFFFDE68A) else CardBorderSubtle,
        ),
        elevation = CardDefaults.cardElevation(defaultElevation = if (active) 2.dp else 0.5.dp),
    ) {
        Column(
            Modifier
                .fillMaxWidth()
                .padding(horizontal = 12.dp, vertical = 10.dp)
        ) {
            Row(
                Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                Box(
                    Modifier
                        .size(44.dp)
                        .clip(RoundedCornerShape(13.dp))
                        .background(accent.copy(alpha = 0.14f)),
                    contentAlignment = Alignment.Center,
                ) {
                    Icon(
                        when {
                            inbox.isConfirmedBanned -> Icons.Rounded.Block
                            inbox.isSuspected -> Icons.Rounded.Warning
                            inbox.isAmazon -> Icons.Rounded.ShoppingCart
                            inbox.isOfficial -> Icons.Rounded.WorkspacePremium
                            else -> Icons.Rounded.AlternateEmail
                        },
                        contentDescription = null,
                        tint = when {
                            inbox.isConfirmedBanned -> BannedRed
                            inbox.isSuspected -> Color(0xFFD97706)
                            inbox.isAmazon -> Color(0xFFD97706)
                            inbox.isOfficial -> OfficialGold
                            else -> Color(0xFF0E9AA7)
                        },
                        modifier = Modifier.size(22.dp),
                    )
                }
                Column(Modifier.weight(1f)) {
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(6.dp),
                    ) {
                        Text(
                            inbox.personName.ifBlank { inbox.label.ifBlank { "حساب بريد" } },
                            style = MaterialTheme.typography.titleMedium,
                            fontWeight = FontWeight.Bold,
                            fontSize = 14.sp,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                            modifier = Modifier.weight(1f, fill = false),
                        )
                        if (inbox.isConfirmedBanned) {
                            Text(
                                "⛔ ${inbox.banReason.ifBlank { "محظور" }}",
                                color = BannedRed,
                                fontSize = 9.sp,
                                fontWeight = FontWeight.Bold,
                                modifier = Modifier
                                    .clip(RoundedCornerShape(6.dp))
                                    .background(BannedLight)
                                    .padding(horizontal = 5.dp, vertical = 2.dp),
                            )
                        } else if (inbox.isSuspected) {
                            Text(
                                "⚠️ اشتباه حظر",
                                color = Color(0xFF92400E),
                                fontSize = 9.sp,
                                fontWeight = FontWeight.Bold,
                                modifier = Modifier
                                    .clip(RoundedCornerShape(6.dp))
                                    .background(Color(0xFFFEF3C7))
                                    .padding(horizontal = 5.dp, vertical = 2.dp),
                            )
                        } else if (inbox.isAmazon) {
                            Text(
                                "🛒 أمازون",
                                color = Color(0xFFC2410C),
                                fontSize = 9.sp,
                                fontWeight = FontWeight.Bold,
                                modifier = Modifier
                                    .clip(RoundedCornerShape(6.dp))
                                    .background(AmazonWarm)
                                    .padding(horizontal = 5.dp, vertical = 2.dp),
                            )
                        } else if (inbox.isOfficial) {
                            Text(
                                "⭐ رسمي",
                                color = Color(0xFFB45309),
                                fontSize = 9.sp,
                                fontWeight = FontWeight.Bold,
                                modifier = Modifier
                                    .clip(RoundedCornerShape(6.dp))
                                    .background(OfficialLight)
                                    .padding(horizontal = 5.dp, vertical = 2.dp),
                            )
                        }
                    }
                    Spacer(Modifier.height(2.dp))
                    Text(
                        inbox.email,
                        color = Muted,
                        style = MaterialTheme.typography.bodySmall,
                        fontSize = 12.sp,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                }
                if (inbox.messageCount > 0) {
                    Text(
                        arabicNumber(inbox.messageCount),
                        color = Primary,
                        style = MaterialTheme.typography.labelSmall,
                        fontWeight = FontWeight.Bold,
                        modifier = Modifier
                            .clip(RoundedCornerShape(8.dp))
                            .background(PrimaryLight)
                            .padding(horizontal = 7.dp, vertical = 3.dp),
                    )
                }
                IconButton(
                    onClick = onCopyEmail,
                    modifier = Modifier.size(36.dp),
                ) {
                    Icon(
                        Icons.Rounded.ContentCopy,
                        contentDescription = "نسخ البريد",
                        tint = Muted,
                        modifier = Modifier.size(18.dp),
                    )
                }
                Box {
                    IconButton(
                        onClick = { menuOpen = true },
                        modifier = Modifier.size(36.dp),
                    ) {
                        Icon(
                            Icons.Rounded.MoreVert,
                            contentDescription = "خيارات الصندوق",
                            tint = Muted,
                            modifier = Modifier.size(18.dp),
                        )
                    }
                    DropdownMenu(expanded = menuOpen, onDismissRequest = { menuOpen = false }) {
                        DropdownMenuItem(
                            text = { Text("نسخ البريد") },
                            leadingIcon = { Icon(Icons.Rounded.ContentCopy, null) },
                            onClick = { menuOpen = false; onCopyEmail() },
                        )
                        DropdownMenuItem(
                            text = { Text("حذف الصندوق", color = Danger) },
                            leadingIcon = { Icon(Icons.Rounded.DeleteOutline, null, tint = Danger) },
                            onClick = { menuOpen = false; onDelete() },
                        )
                    }
                }
            }
            if (inbox.isSuspected && onConfirmBan != null && onMarkSafe != null) {
                Spacer(Modifier.height(8.dp))
                BanConfirmationBox(
                    reason = inbox.banReason,
                    onConfirmBan = onConfirmBan,
                    onMarkSafe = onMarkSafe,
                    onAiVerify = onAiVerify,
                )
            }
        }
    }
}

@Composable
private fun AmazonScreen(state: MailUiState, viewModel: MailViewModel) {
    val clipboard = LocalClipboardManager.current
    val context = LocalContext.current

    val allAmazonInboxes = state.amazonInboxes
    val bannedAmazonInboxes = allAmazonInboxes.filter { it.isConfirmedBanned }
    val suspectedAmazonInboxes = allAmazonInboxes.filter { it.isSuspected }
    val healthyAmazonInboxes = allAmazonInboxes.filter { !it.isConfirmedBanned && !it.isSuspected }
    val amazonMessages = state.amazonMessages

    val query = state.search.trim()

    LazyColumn(
        Modifier.fillMaxSize(),
        contentPadding = PaddingValues(start = 14.dp, end = 14.dp, top = 4.dp, bottom = 100.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        item {
            AmazonUniverseHero(
                totalAccounts = allAmazonInboxes.size,
                suspectedAccounts = suspectedAmazonInboxes.size,
                bannedAccounts = bannedAmazonInboxes.size,
                messagesCount = amazonMessages.size,
            )
        }

        item {
            AmazonKpiSection(
                total = allAmazonInboxes.size,
                suspected = suspectedAmazonInboxes.size,
                banned = bannedAmazonInboxes.size,
                healthy = healthyAmazonInboxes.size,
                messages = amazonMessages.size,
                selectedTab = state.amazonTab,
                onSelectTab = { viewModel.setAmazonTab(it) },
            )
        }

        item {
            Row(
                Modifier
                    .fillMaxWidth()
                    .padding(top = 8.dp, bottom = 4.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Column(Modifier.weight(1f)) {
                    Text("مركز المراقبة الذكي", color = Color(0xFFFF9900), style = MaterialTheme.typography.labelSmall, fontWeight = FontWeight.Bold)
                    Text(
                        when (state.amazonTab) {
                            AmazonTab.ALL -> "جميع حسابات أمازون"
                            AmazonTab.SUSPECTED -> "حسابات قيد المراجعة والاشتباه ⚠️"
                            AmazonTab.BANNED -> "الحسابات المقيدة والمحظورة ⛔"
                            AmazonTab.HEALTHY -> "الحسابات النشطة السليمة ✅"
                            AmazonTab.MESSAGES -> "رسائل وأكواد أمازون (OTP) 🔑"
                        },
                        style = MaterialTheme.typography.titleMedium,
                        fontWeight = FontWeight.Bold,
                    )
                }
            }

            MailPills(
                listOf(
                    "الكل (${arabicNumber(allAmazonInboxes.size)})",
                    "اشتباه ⚠️ (${arabicNumber(suspectedAmazonInboxes.size)})",
                    "محظورة ⛔ (${arabicNumber(bannedAmazonInboxes.size)})",
                    "سليمة ✅ (${arabicNumber(healthyAmazonInboxes.size)})",
                    "رسائل 🔑 (${arabicNumber(amazonMessages.size)})",
                ),
                state.amazonTab.ordinal,
            ) { viewModel.setAmazonTab(AmazonTab.entries[it]) }

            Spacer(Modifier.height(8.dp))
            SearchField(
                state.search,
                if (state.amazonTab == AmazonTab.MESSAGES) "ابحث في رسائل وأكواد أمازون..." else "ابحث في حسابات أمازون...",
                viewModel::setSearch,
            )
            Spacer(Modifier.height(2.dp))
        }

        if (state.amazonTab == AmazonTab.MESSAGES) {
            val filteredMessages = amazonMessages.filter {
                query.isBlank() || listOf(it.subject, it.from, it.to, it.text, it.intro, it.otp, it.inboxEmail).any { value -> value.contains(query, true) }
            }
            if (filteredMessages.isEmpty()) {
                item { EmptyList("لا توجد رسائل أمازون", "ستظهر هنا إشعارات وأوامر شراء وأكواد OTP القادمة من أمازون.") }
            } else {
                items(filteredMessages, key = { it.id }) { message ->
                    AmazonMessageRow(
                        message = message,
                        onClick = { viewModel.openMessage(message) },
                        onCopyOtp = { otp ->
                            clipboard.setText(AnnotatedString(otp))
                            android.widget.Toast.makeText(context, "تم نسخ كود التحقق: $otp", android.widget.Toast.LENGTH_SHORT).show()
                        },
                    )
                }
            }
        } else {
            val baseList = when (state.amazonTab) {
                AmazonTab.ALL -> allAmazonInboxes
                AmazonTab.SUSPECTED -> suspectedAmazonInboxes
                AmazonTab.BANNED -> bannedAmazonInboxes
                AmazonTab.HEALTHY -> healthyAmazonInboxes
                AmazonTab.MESSAGES -> emptyList()
            }
            val filteredInboxes = baseList.filter {
                query.isBlank() || listOf(it.email, it.personName, it.label, it.banReason).any { value -> value.contains(query, true) }
            }
            if (filteredInboxes.isEmpty()) {
                item {
                    EmptyList(
                        when (state.amazonTab) {
                            AmazonTab.SUSPECTED -> "لا توجد حسابات قيد المراجعة"
                            AmazonTab.BANNED -> "لا توجد حسابات محظورة"
                            else -> "لا توجد حسابات مطابقة"
                        },
                        when (state.amazonTab) {
                            AmazonTab.SUSPECTED -> "رائع! لا يوجد أي حساب بانتظار التحقق من الحظر."
                            AmazonTab.BANNED -> "ممتاز! لم يتم رصد أي قيود أو حظر مؤكد على حسابات أمازون."
                            else -> "جرّب البحث بكلمات أخرى أو اختر تبويبًا مختلفًا."
                        }
                    )
                }
            } else {
                items(filteredInboxes, key = { it.id }) { inbox ->
                    AmazonAccountCard(
                        inbox = inbox,
                        onCopyEmail = {
                            clipboard.setText(AnnotatedString(inbox.email))
                            android.widget.Toast.makeText(context, "تم نسخ البريد", android.widget.Toast.LENGTH_SHORT).show()
                        },
                        onViewMessages = {
                            viewModel.selectInbox(inbox)
                            viewModel.setSection(MainSection.MESSAGES)
                        },
                        onConfirmBan = if (inbox.isSuspected) { { viewModel.updateBanStatus(inbox, "confirmed") } } else null,
                        onMarkSafe = if (inbox.isSuspected) { { viewModel.updateBanStatus(inbox, "safe") } } else null,
                        onAiVerify = if (inbox.isSuspected) { { viewModel.triggerAiVerify(inbox) } } else null,
                    )
                }
            }
        }
    }
}

@Composable
private fun AmazonUniverseHero(
    totalAccounts: Int,
    suspectedAccounts: Int,
    bannedAccounts: Int,
    messagesCount: Int,
) {
    val infiniteTransition = rememberInfiniteTransition(label = "amazonHero")
    val floatOffset by infiniteTransition.animateFloat(
        initialValue = -3f,
        targetValue = 3f,
        animationSpec = infiniteRepeatable(
            animation = tween(2200, easing = FastOutSlowInEasing),
            repeatMode = RepeatMode.Reverse,
        ),
        label = "heroFloat",
    )

    Card(
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(22.dp),
        colors = CardDefaults.cardColors(containerColor = Color.Transparent),
        elevation = CardDefaults.cardElevation(defaultElevation = 2.dp),
    ) {
        Box(
            modifier = Modifier
                .fillMaxWidth()
                .background(
                    Brush.linearGradient(
                        listOf(
                            Color(0xFF131921),
                            Color(0xFF1F2A38),
                            Color(0xFF232F3E),
                        )
                    )
                )
                .padding(18.dp)
        ) {
            Column(
                modifier = Modifier.fillMaxWidth(),
                verticalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Row(
                        modifier = Modifier
                            .clip(RoundedCornerShape(10.dp))
                            .background(Color(0xFFFF9900).copy(alpha = 0.18f))
                            .padding(horizontal = 10.dp, vertical = 5.dp),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(6.dp),
                    ) {
                        Box(
                            modifier = Modifier
                                .size(7.dp)
                                .clip(CircleShape)
                                .background(Color(0xFFFF9900))
                        )
                        Text(
                            text = "مركز أمازون الذكي",
                            color = Color(0xFFFF9900),
                            fontSize = 11.sp,
                            fontWeight = FontWeight.Bold,
                        )
                    }

                    Box(
                        modifier = Modifier
                            .size(42.dp)
                            .graphicsLayer { translationY = floatOffset }
                            .clip(RoundedCornerShape(14.dp))
                            .background(Brush.linearGradient(listOf(Color(0xFFFF9900), Color(0xFFEA580C)))),
                        contentAlignment = Alignment.Center,
                    ) {
                        Icon(
                            Icons.Rounded.ShoppingCart,
                            contentDescription = null,
                            tint = Color.White,
                            modifier = Modifier.size(24.dp),
                        )
                    }
                }

                Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    Text(
                        text = "إدارة ورصد حسابات أمازون",
                        color = Color.White,
                        style = MaterialTheme.typography.titleLarge,
                        fontWeight = FontWeight.ExtraBold,
                    )
                    Text(
                        text = "كشف فوري للحظر والتقييد بالمشتريات الرقمية، تتبع الرسائل، واستخراج رموز التحقق OTP بلمسة واحدة.",
                        color = Color(0xFF94A3B8),
                        style = MaterialTheme.typography.bodySmall,
                        lineHeight = 18.sp,
                    )
                }

                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(6.dp),
                ) {
                    AmazonHeroStatPill(
                        label = "الحسابات",
                        value = arabicNumber(totalAccounts),
                        color = Color.White,
                        modifier = Modifier.weight(1f),
                    )
                    AmazonHeroStatPill(
                        label = "اشتباه ⚠️",
                        value = arabicNumber(suspectedAccounts),
                        color = if (suspectedAccounts > 0) Color(0xFFFBBF24) else Color(0xFF94A3B8),
                        modifier = Modifier.weight(1f),
                    )
                    AmazonHeroStatPill(
                        label = "المحظورة",
                        value = arabicNumber(bannedAccounts),
                        color = if (bannedAccounts > 0) Color(0xFFF87171) else Color(0xFF34D399),
                        modifier = Modifier.weight(1f),
                    )
                    AmazonHeroStatPill(
                        label = "الرسائل",
                        value = arabicNumber(messagesCount),
                        color = Color(0xFFFFB74D),
                        modifier = Modifier.weight(1f),
                    )
                }
            }
        }
    }
}

@Composable
private fun AmazonHeroStatPill(
    label: String,
    value: String,
    color: Color,
    modifier: Modifier = Modifier,
) {
    Box(
        modifier = modifier
            .clip(RoundedCornerShape(12.dp))
            .background(Color.White.copy(alpha = 0.08f))
            .padding(horizontal = 6.dp, vertical = 7.dp),
        contentAlignment = Alignment.Center,
    ) {
        Column(horizontalAlignment = Alignment.CenterHorizontally) {
            Text(text = value, color = color, fontWeight = FontWeight.Bold, fontSize = 13.sp)
            Text(text = label, color = Color(0xFF94A3B8), fontSize = 9.sp)
        }
    }
}

@Composable
private fun AmazonKpiSection(
    total: Int,
    suspected: Int,
    banned: Int,
    healthy: Int,
    messages: Int,
    selectedTab: AmazonTab,
    onSelectTab: (AmazonTab) -> Unit,
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .horizontalScroll(rememberScrollState()),
        horizontalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        AmazonKpiCard(
            title = "الكل",
            count = arabicNumber(total),
            icon = Icons.Rounded.ShoppingCart,
            accentColor = Color(0xFFFF9900),
            selected = selectedTab == AmazonTab.ALL,
            onClick = { onSelectTab(AmazonTab.ALL) },
            modifier = Modifier.width(76.dp),
        )
        AmazonKpiCard(
            title = "اشتباه ⚠️",
            count = arabicNumber(suspected),
            icon = Icons.Rounded.Warning,
            accentColor = Color(0xFFF59E0B),
            selected = selectedTab == AmazonTab.SUSPECTED,
            onClick = { onSelectTab(AmazonTab.SUSPECTED) },
            modifier = Modifier.width(76.dp),
        )
        AmazonKpiCard(
            title = "المحظورة",
            count = arabicNumber(banned),
            icon = Icons.Rounded.Block,
            accentColor = BannedRed,
            selected = selectedTab == AmazonTab.BANNED,
            onClick = { onSelectTab(AmazonTab.BANNED) },
            modifier = Modifier.width(76.dp),
        )
        AmazonKpiCard(
            title = "السليمة",
            count = arabicNumber(healthy),
            icon = Icons.Rounded.CheckCircle,
            accentColor = Green,
            selected = selectedTab == AmazonTab.HEALTHY,
            onClick = { onSelectTab(AmazonTab.HEALTHY) },
            modifier = Modifier.width(76.dp),
        )
        AmazonKpiCard(
            title = "الرسائل",
            count = arabicNumber(messages),
            icon = Icons.Rounded.Bolt,
            accentColor = Color(0xFF6366F1),
            selected = selectedTab == AmazonTab.MESSAGES,
            onClick = { onSelectTab(AmazonTab.MESSAGES) },
            modifier = Modifier.width(76.dp),
        )
    }
}

@Composable
private fun AmazonKpiCard(
    title: String,
    count: String,
    icon: androidx.compose.ui.graphics.vector.ImageVector,
    accentColor: Color,
    selected: Boolean,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Card(
        modifier = modifier.clickable(onClick = onClick),
        shape = RoundedCornerShape(16.dp),
        colors = CardDefaults.cardColors(
            containerColor = if (selected) accentColor.copy(alpha = 0.12f) else Surface
        ),
        border = BorderStroke(
            width = if (selected) 1.5.dp else 1.dp,
            color = if (selected) accentColor else CardBorderSubtle,
        ),
        elevation = CardDefaults.cardElevation(defaultElevation = if (selected) 2.dp else 0.5.dp),
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 8.dp, vertical = 10.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(4.dp),
        ) {
            Icon(
                icon,
                contentDescription = null,
                tint = if (selected) accentColor else Muted,
                modifier = Modifier.size(20.dp),
            )
            Text(
                text = count,
                style = MaterialTheme.typography.titleMedium,
                fontWeight = FontWeight.Bold,
                color = if (selected) accentColor else Ink,
                fontSize = 16.sp,
            )
            Text(
                text = title,
                style = MaterialTheme.typography.labelSmall,
                color = if (selected) accentColor else Muted,
                fontSize = 11.sp,
                maxLines = 1,
            )
        }
    }
}

@Composable
private fun AmazonAccountCard(
    inbox: Inbox,
    onCopyEmail: () -> Unit,
    onViewMessages: () -> Unit,
    onConfirmBan: (() -> Unit)? = null,
    onMarkSafe: (() -> Unit)? = null,
    onAiVerify: (() -> Unit)? = null,
) {
    Card(
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(16.dp),
        colors = CardDefaults.cardColors(containerColor = Surface),
        border = BorderStroke(
            1.dp,
            when {
                inbox.isConfirmedBanned -> BannedRed.copy(alpha = 0.3f)
                inbox.isSuspected -> Color(0xFFFDE68A)
                else -> CardBorderSubtle
            }
        ),
        elevation = CardDefaults.cardElevation(defaultElevation = 0.5.dp),
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(12.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                Box(
                    modifier = Modifier
                        .size(44.dp)
                        .clip(RoundedCornerShape(13.dp))
                        .background(
                            when {
                                inbox.isConfirmedBanned -> BannedLight
                                inbox.isSuspected -> Color(0xFFFEF3C7)
                                else -> Color(0xFFFF9900).copy(alpha = 0.12f)
                            }
                        ),
                    contentAlignment = Alignment.Center,
                ) {
                    Icon(
                        when {
                            inbox.isConfirmedBanned -> Icons.Rounded.Block
                            inbox.isSuspected -> Icons.Rounded.Warning
                            else -> Icons.Rounded.ShoppingCart
                        },
                        contentDescription = null,
                        tint = when {
                            inbox.isConfirmedBanned -> BannedRed
                            inbox.isSuspected -> Color(0xFFD97706)
                            else -> Color(0xFFFF9900)
                        },
                        modifier = Modifier.size(22.dp),
                    )
                }

                Column(modifier = Modifier.weight(1f)) {
                    Text(
                        text = inbox.personName.ifBlank { "حساب أمازون" },
                        fontWeight = FontWeight.Bold,
                        style = MaterialTheme.typography.bodyMedium,
                        color = Ink,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                    SelectionContainer {
                        Text(
                            text = inbox.email,
                            style = MaterialTheme.typography.labelSmall,
                            color = Muted,
                            fontSize = 11.sp,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                        )
                    }
                }

                IconButton(
                    onClick = onCopyEmail,
                    modifier = Modifier.size(32.dp),
                ) {
                    Icon(
                        Icons.Rounded.ContentCopy,
                        contentDescription = "نسخ البريد",
                        tint = Muted,
                        modifier = Modifier.size(16.dp),
                    )
                }
            }

            // Badges Row
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                if (inbox.isConfirmedBanned) {
                    Row(
                        modifier = Modifier
                            .clip(RoundedCornerShape(8.dp))
                            .background(BannedLight)
                            .padding(horizontal = 8.dp, vertical = 4.dp),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(4.dp),
                    ) {
                        Icon(Icons.Rounded.Block, contentDescription = null, tint = BannedRed, modifier = Modifier.size(12.dp))
                        Text(
                            text = inbox.banReason.ifBlank { "مقتصر على المشتريات الرقمية" },
                            color = BannedRed,
                            fontSize = 11.sp,
                            fontWeight = FontWeight.Bold,
                        )
                    }
                } else if (inbox.isSuspected) {
                    Row(
                        modifier = Modifier
                            .clip(RoundedCornerShape(8.dp))
                            .background(Color(0xFFFEF3C7))
                            .padding(horizontal = 8.dp, vertical = 4.dp),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(4.dp),
                    ) {
                        Icon(Icons.Rounded.Warning, contentDescription = null, tint = Color(0xFFD97706), modifier = Modifier.size(12.dp))
                        Text(
                            text = "⚠️ اشتباه حظر",
                            color = Color(0xFF92400E),
                            fontSize = 11.sp,
                            fontWeight = FontWeight.Bold,
                        )
                    }
                } else {
                    Row(
                        modifier = Modifier
                            .clip(RoundedCornerShape(8.dp))
                            .background(Green.copy(alpha = 0.1f))
                            .padding(horizontal = 8.dp, vertical = 4.dp),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(4.dp),
                    ) {
                        Icon(Icons.Rounded.CheckCircle, contentDescription = null, tint = Green, modifier = Modifier.size(12.dp))
                        Text(
                            text = "سليم ونشط",
                            color = Green,
                            fontSize = 11.sp,
                            fontWeight = FontWeight.Bold,
                        )
                    }
                }

                Text(
                    text = "${arabicNumber(inbox.messageCount)} رسائل",
                    color = Muted,
                    fontSize = 11.sp,
                )
            }

            // Interactive confirmation prompt if suspected
            if (inbox.isSuspected && onConfirmBan != null && onMarkSafe != null) {
                BanConfirmationBox(
                    reason = inbox.banReason,
                    onConfirmBan = onConfirmBan,
                    onMarkSafe = onMarkSafe,
                    onAiVerify = onAiVerify,
                )
            }

            // Action row
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.End,
            ) {
                OutlinedButton(
                    onClick = onViewMessages,
                    shape = RoundedCornerShape(10.dp),
                    contentPadding = PaddingValues(horizontal = 12.dp, vertical = 4.dp),
                    modifier = Modifier.height(32.dp),
                ) {
                    Icon(Icons.Rounded.MailOutline, contentDescription = null, modifier = Modifier.size(14.dp))
                    Spacer(Modifier.width(4.dp))
                    Text("عرض الرسائل", fontSize = 11.sp)
                }
            }
        }
    }
}

@Composable
private fun AmazonMessageRow(
    message: MailMessage,
    onClick: () -> Unit,
    onCopyOtp: (String) -> Unit,
) {
    Card(
        modifier = Modifier
            .fillMaxWidth()
            .clickable(onClick = onClick),
        shape = RoundedCornerShape(16.dp),
        colors = CardDefaults.cardColors(containerColor = Surface),
        border = BorderStroke(1.dp, if (message.isBanned) BannedRed.copy(alpha = 0.3f) else CardBorderSubtle),
        elevation = CardDefaults.cardElevation(defaultElevation = 0.5.dp),
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 12.dp, vertical = 10.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            Box(
                modifier = Modifier
                    .size(44.dp)
                    .clip(RoundedCornerShape(13.dp))
                    .background(
                        if (message.isBanned) BannedLight
                        else Color(0xFFFF9900).copy(alpha = 0.12f)
                    ),
                contentAlignment = Alignment.Center,
            ) {
                Icon(
                    if (message.isBanned) Icons.Rounded.Block else Icons.Rounded.ShoppingCart,
                    contentDescription = null,
                    tint = if (message.isBanned) BannedRed else Color(0xFFFF9900),
                    modifier = Modifier.size(22.dp),
                )
            }

            Column(modifier = Modifier.weight(1f)) {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text(
                        text = SenderFormatter.format(message.from, message.subject),
                        style = MaterialTheme.typography.labelSmall,
                        fontWeight = FontWeight.Bold,
                        color = Ink,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                        modifier = Modifier.weight(1f, fill = false),
                    )
                    Text(
                        text = formatDate(message.createdAt),
                        style = MaterialTheme.typography.labelSmall,
                        color = Muted,
                        fontSize = 10.sp,
                    )
                }

                Text(
                    text = message.subject.ifBlank { "(بدون عنوان)" },
                    style = MaterialTheme.typography.bodySmall,
                    fontWeight = FontWeight.SemiBold,
                    color = Ink,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )

                Row(
                    modifier = Modifier.padding(top = 4.dp),
                    horizontalArrangement = Arrangement.spacedBy(6.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    if (message.isBanned) {
                        Text(
                            text = "⛔ ${message.banReason.ifBlank { "محظور" }}",
                            color = BannedRed,
                            fontSize = 9.sp,
                            fontWeight = FontWeight.Bold,
                            modifier = Modifier
                                .clip(RoundedCornerShape(6.dp))
                                .background(BannedLight)
                                .padding(horizontal = 5.dp, vertical = 2.dp),
                        )
                    }

                    if (message.otp.isNotBlank()) {
                        Row(
                            modifier = Modifier
                                .clip(RoundedCornerShape(6.dp))
                                .background(Color(0xFFD1FAE5))
                                .clickable { onCopyOtp(message.otp) }
                                .padding(horizontal = 6.dp, vertical = 2.dp),
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(4.dp),
                        ) {
                            Icon(
                                Icons.Rounded.Bolt,
                                contentDescription = null,
                                tint = Color(0xFF047857),
                                modifier = Modifier.size(12.dp),
                            )
                            Text(
                                text = "رمز: ${message.otp}",
                                color = Color(0xFF047857),
                                fontSize = 10.sp,
                                fontWeight = FontWeight.Bold,
                            )
                            Icon(
                                Icons.Rounded.ContentCopy,
                                contentDescription = null,
                                tint = Color(0xFF047857),
                                modifier = Modifier.size(10.dp),
                            )
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun MessagesScreen(state: MailUiState, viewModel: MailViewModel) {
    val clipboard = LocalClipboardManager.current
    val context = LocalContext.current
    val source = when (state.messageFilter) {
        MessageFilter.CURRENT -> state.currentMessages
        MessageFilter.OFFICIAL -> state.officialMessages
        MessageFilter.TEMP -> state.tempMessages
    }
    val query = state.search.trim()
    val list = source.filter { query.isBlank() || listOf(it.subject, it.from, it.to, it.text, it.intro, it.otp, it.inboxEmail).any { value -> value.contains(query, true) } }

    LazyColumn(
        Modifier.fillMaxSize(),
        contentPadding = PaddingValues(start = 14.dp, end = 14.dp, top = 4.dp, bottom = 100.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        item {
            state.activeInbox?.let {
                ActiveInboxCard(
                    inbox = it,
                    onCopy = {
                        clipboard.setText(AnnotatedString(it.email))
                        android.widget.Toast.makeText(context, "تم نسخ البريد", android.widget.Toast.LENGTH_SHORT).show()
                    },
                    onRefresh = viewModel::refreshCurrent,
                )
            }
            Row(
                Modifier
                    .fillMaxWidth()
                    .padding(top = 14.dp, bottom = 8.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Column(Modifier.weight(1f)) {
                    Text("الوارد", color = Primary, style = MaterialTheme.typography.labelSmall)
                    Text("أحدث الرسائل", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
                }
                Text("${arabicNumber(list.size)} رسالة", color = Muted, style = MaterialTheme.typography.labelSmall)
            }
            MailPills(
                listOf(
                    "الصندوق الحالي",
                    "البريد الرسمي",
                    "البريد السريع",
                ),
                state.messageFilter.ordinal,
            ) {
                viewModel.setMessageFilter(MessageFilter.entries[it])
            }
            Spacer(Modifier.height(8.dp))
            SearchField(state.search, "ابحث في الرسائل والرموز...", viewModel::setSearch)
            Spacer(Modifier.height(2.dp))
        }
        if (list.isEmpty()) {
            item { EmptyList("الوارد هادئ الآن", "ستظهر الرسائل الجديدة فور وصولها.") }
        } else {
            items(list, key = { it.id }) { message ->
                MessageRow(
                    message = message,
                    onClick = { viewModel.openMessage(message) },
                    onCopyOtp = { code ->
                        clipboard.setText(AnnotatedString(code))
                        android.widget.Toast.makeText(context, "تم نسخ الرمز $code", android.widget.Toast.LENGTH_SHORT).show()
                    },
                )
            }
        }
    }
}

@Composable
private fun ActiveInboxCard(inbox: Inbox, onCopy: () -> Unit, onRefresh: () -> Unit) {
    val motion = rememberInfiniteTransition(label = "active inbox")
    val glow by motion.animateFloat(0.12f, 0.28f, infiniteRepeatable(tween(1800), RepeatMode.Reverse), label = "glow")
    Box(
        Modifier
            .fillMaxWidth()
            .heightIn(min = 135.dp)
            .clip(RoundedCornerShape(22.dp))
            .background(Brush.linearGradient(listOf(Color(0xFF0F172A), Color(0xFF1E1B4B), Primary)))
            .padding(14.dp)
    ) {
        Box(Modifier.align(Alignment.TopStart).size(80.dp).clip(CircleShape).background(Cyan.copy(alpha = glow)))
        Column(Modifier.align(Alignment.CenterEnd).fillMaxWidth()) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                Box(Modifier.size(7.dp).clip(CircleShape).background(Green))
                Text(
                    "الصندوق النشط · يستقبل الآن",
                    color = Color.White.copy(alpha = 0.80f),
                    style = MaterialTheme.typography.labelSmall,
                    fontSize = 11.sp,
                )
            }
            Spacer(Modifier.height(8.dp))
            Text(
                inbox.personName.ifBlank { if (inbox.isOfficial) "بريد رسمي" else "بريد سريع" },
                color = Color.White.copy(alpha = 0.85f),
                style = MaterialTheme.typography.labelSmall,
                fontSize = 12.sp,
            )
            Text(
                inbox.email,
                color = Color.White,
                style = MaterialTheme.typography.titleMedium,
                fontWeight = FontWeight.Bold,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            Spacer(Modifier.height(10.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                HeroButton("نسخ البريد", Icons.Rounded.ContentCopy, false, onCopy)
                HeroButton("فحص الآن", Icons.Rounded.Refresh, true, onRefresh)
            }
        }
    }
}

@Composable
private fun HeroButton(label: String, icon: androidx.compose.ui.graphics.vector.ImageVector, filled: Boolean, onClick: () -> Unit) {
    Row(
        Modifier
            .clip(RoundedCornerShape(10.dp))
            .clickable(onClick = onClick)
            .background(if (filled) Color.White else Color.White.copy(alpha = 0.12f))
            .padding(horizontal = 11.dp, vertical = 7.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        Icon(icon, null, tint = if (filled) Ink else Color.White, modifier = Modifier.size(15.dp))
        Text(
            label,
            color = if (filled) Ink else Color.White,
            style = MaterialTheme.typography.labelSmall,
            fontWeight = FontWeight.Bold,
            fontSize = 11.sp,
        )
    }
}

@Composable
private fun MessageRow(message: MailMessage, onClick: () -> Unit, onCopyOtp: (String) -> Unit) {
    Card(
        modifier = Modifier
            .fillMaxWidth()
            .clickable(onClick = onClick),
        shape = RoundedCornerShape(16.dp),
        colors = CardDefaults.cardColors(containerColor = Surface),
        border = BorderStroke(1.dp, CardBorderSubtle),
        elevation = CardDefaults.cardElevation(defaultElevation = 0.5.dp),
    ) {
        Row(
            Modifier
                .fillMaxWidth()
                .padding(horizontal = 12.dp, vertical = 10.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            Box(
                Modifier
                    .size(44.dp)
                    .clip(RoundedCornerShape(13.dp))
                    .background(
                        when {
                            message.isBanned -> BannedLight
                            message.isAmazon -> AmazonWarm
                            else -> PrimaryLight
                        }
                    ),
                contentAlignment = Alignment.Center,
            ) {
                when {
                    message.isBanned -> {
                        Icon(Icons.Rounded.Block, null, tint = BannedRed, modifier = Modifier.size(22.dp))
                    }
                    message.isAmazon -> {
                        Icon(Icons.Rounded.ShoppingCart, null, tint = Color(0xFFD97706), modifier = Modifier.size(22.dp))
                    }
                    else -> {
                        Text(initials(message.from), color = Primary, style = MaterialTheme.typography.labelMedium, fontWeight = FontWeight.Bold)
                    }
                }
            }
            Column(Modifier.weight(1f)) {
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(5.dp),
                ) {
                    Text(
                        SenderFormatter.format(message.from, message.subject),
                        style = MaterialTheme.typography.labelSmall,
                        fontWeight = FontWeight.Bold,
                        color = Ink,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                        modifier = Modifier.weight(1f, fill = false),
                    )
                    if (message.isBanned) {
                        Text(
                            "⛔ ${message.banReason.ifBlank { "محظور" }}",
                            color = BannedRed,
                            fontSize = 9.sp,
                            fontWeight = FontWeight.Bold,
                            modifier = Modifier
                                .clip(RoundedCornerShape(6.dp))
                                .background(BannedLight)
                                .padding(horizontal = 5.dp, vertical = 2.dp),
                        )
                    } else if (message.isAmazon) {
                        Text(
                            "🛒 أمازون",
                            color = Color(0xFFC2410C),
                            fontSize = 9.sp,
                            fontWeight = FontWeight.Bold,
                            modifier = Modifier
                                .clip(RoundedCornerShape(6.dp))
                                .background(AmazonWarm)
                                .padding(horizontal = 5.dp, vertical = 2.dp),
                        )
                    }
                    Text(formatDate(message.createdAt), color = Muted, fontSize = 10.sp)
                }
                Spacer(Modifier.height(2.dp))
                Text(
                    message.subject.ifBlank { "(بدون عنوان)" },
                    style = MaterialTheme.typography.titleSmall,
                    fontWeight = FontWeight.Bold,
                    fontSize = 13.sp,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
                Text(
                    message.intro.ifBlank { message.text },
                    color = Muted,
                    style = MaterialTheme.typography.bodySmall,
                    fontSize = 11.sp,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
            }
            if (message.otp.isNotBlank()) {
                Column(
                    Modifier
                        .clip(RoundedCornerShape(10.dp))
                        .clickable { onCopyOtp(message.otp) }
                        .background(GreenLight)
                        .padding(horizontal = 8.dp, vertical = 5.dp),
                    horizontalAlignment = Alignment.CenterHorizontally,
                ) {
                    Text("رمز OTP", color = Green, fontSize = 9.sp, fontWeight = FontWeight.Bold)
                    Text(
                        message.otp,
                        color = Color(0xFF065F46),
                        fontSize = 14.sp,
                        fontWeight = FontWeight.Black,
                        letterSpacing = 1.sp,
                    )
                }
            }
        }
    }
}

@Composable
private fun LogsScreen(state: MailUiState, onSearch: (String) -> Unit) {
    val query = state.search.trim()
    val logs = state.logs.asReversed().filter { query.isBlank() || listOf(it.personName, it.mobile, it.realEmail, it.receiptNumber, it.city).any { value -> value.contains(query, true) } }
    LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(start = 18.dp, end = 18.dp, top = 12.dp, bottom = 112.dp)) {
        item {
            Text("سجل الحملة", color = Primary, style = MaterialTheme.typography.labelMedium)
            Text("تسجيلات نيفيا", style = MaterialTheme.typography.headlineLarge)
            Text("${arabicNumber(state.logs.size)} عملية مكتملة", color = Muted, style = MaterialTheme.typography.bodyMedium)
            Spacer(Modifier.height(18.dp)); SearchField(state.search, "ابحث بالاسم أو الجوال أو الفاتورة", onSearch); Spacer(Modifier.height(10.dp))
        }
        if (logs.isEmpty()) item { EmptyList("لا توجد تسجيلات", "ستظهر العمليات المكتملة في هذا السجل.") }
        else items(logs, key = { "${it.index}_${it.registeredAt}" }) { LogRow(it) }
    }
}

@Composable
private fun LogRow(log: RegistrationLog) {
    Column(Modifier.fillMaxWidth()) {
        Row(Modifier.fillMaxWidth().padding(vertical = 13.dp, horizontal = 7.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            Box(Modifier.size(54.dp).clip(RoundedCornerShape(18.dp)).background(Green.copy(alpha = .11f)), contentAlignment = Alignment.Center) { Text("#${arabicNumber(log.index)}", color = Green, style = MaterialTheme.typography.labelMedium) }
            Column(Modifier.weight(1f)) {
                Row(verticalAlignment = Alignment.CenterVertically) { Text(log.personName.ifBlank { "مشارك" }, style = MaterialTheme.typography.titleMedium, modifier = Modifier.weight(1f), maxLines = 1); Icon(Icons.Rounded.CheckCircle, null, tint = Green, modifier = Modifier.size(18.dp)) }
                Text(log.realEmail, color = Primary, style = MaterialTheme.typography.labelSmall, maxLines = 1, overflow = TextOverflow.Ellipsis)
                Text("${log.mobile} · ${log.city}", color = Muted, style = MaterialTheme.typography.bodyMedium)
            }
            Column(horizontalAlignment = Alignment.End) { Text("الفاتورة", color = Muted, fontSize = 11.sp); Text(log.receiptNumber.ifBlank { "—" }, style = MaterialTheme.typography.labelMedium); Text(formatDate(log.registeredAt), color = Muted, fontSize = 11.sp) }
        }
        HorizontalDivider(Modifier.padding(start = 74.dp), color = Color(0xFFE8EBF2))
    }
}

@Composable
private fun SettingsScreen(state: MailUiState, viewModel: MailViewModel) {
    var url by rememberSaveable(state.baseUrl) { mutableStateOf(state.baseUrl) }
    val context = LocalContext.current
    LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(18.dp, 12.dp, 18.dp, 112.dp)) {
        item {
            Text("تفضيلاتك", color = Primary, style = MaterialTheme.typography.labelMedium)
            Text("الإعدادات", style = MaterialTheme.typography.headlineLarge)
            Spacer(Modifier.height(16.dp))
            AppVersionCard(state, viewModel)
            Spacer(Modifier.height(14.dp))
            StorageManagementCard(state, viewModel)
            Spacer(Modifier.height(14.dp))
            SettingsCard(state, viewModel)
            Spacer(Modifier.height(20.dp))
            Text("عنوان خادم البريد", style = MaterialTheme.typography.labelLarge)
            Spacer(Modifier.height(7.dp))
            OutlinedTextField(value = url, onValueChange = { url = it }, modifier = Modifier.fillMaxWidth(), singleLine = true, leadingIcon = { Icon(Icons.Rounded.Language, null) }, placeholder = { Text("https://inbox-api.batabitoo.com") }, shape = RoundedCornerShape(17.dp))
            Spacer(Modifier.height(11.dp))
            Button(onClick = { viewModel.saveBaseUrl(url) }, modifier = Modifier.fillMaxWidth().height(54.dp), shape = RoundedCornerShape(17.dp)) { Text("حفظ واختبار الاتصال") }
            Spacer(Modifier.height(9.dp))
            OutlinedButton(onClick = { context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse("https://batabitoo-mail-2026.web.app"))) }, modifier = Modifier.fillMaxWidth().height(52.dp), shape = RoundedCornerShape(17.dp)) { Icon(Icons.Rounded.OpenInBrowser, null); Spacer(Modifier.width(8.dp)); Text("فتح نسخة الويب") }
        }
    }
}

@Composable
private fun StorageManagementCard(state: MailUiState, viewModel: MailViewModel) {
    val stats = state.storageStats
    val isCleaning = state.storageCleaning

    Card(
        colors = CardDefaults.cardColors(containerColor = Surface),
        elevation = CardDefaults.cardElevation(2.dp),
        shape = RoundedCornerShape(22.dp),
        border = BorderStroke(1.dp, CardBorderSubtle),
    ) {
        Column(Modifier.padding(16.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Box(
                    Modifier
                        .size(44.dp)
                        .clip(RoundedCornerShape(14.dp))
                        .background(PrimaryLight),
                    contentAlignment = Alignment.Center,
                ) {
                    Icon(
                        Icons.Rounded.Storage,
                        contentDescription = null,
                        tint = Primary,
                        modifier = Modifier.size(22.dp),
                    )
                }
                Spacer(Modifier.width(12.dp))
                Column(Modifier.weight(1f)) {
                    Text("إدارة التخزين والمساحة", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
                    Text(
                        "حماية الكوتة والتنظيف التلقائي",
                        color = Muted,
                        style = MaterialTheme.typography.bodySmall,
                    )
                }
            }

            Spacer(Modifier.height(12.dp))

            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .clip(RoundedCornerShape(12.dp))
                    .background(SurfaceSoft)
                    .padding(horizontal = 12.dp, vertical = 8.dp),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text("المساحة المستخدمة محلياً", color = Muted, fontSize = 12.sp)
                Text(stats?.diskUsageFormatted ?: "0.40 MB", color = Ink, fontWeight = FontWeight.Bold, fontSize = 12.sp)
            }

            Spacer(Modifier.height(6.dp))

            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .clip(RoundedCornerShape(12.dp))
                    .background(SurfaceSoft)
                    .padding(horizontal = 12.dp, vertical = 8.dp),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text("رسائل البريد المخزنة", color = Muted, fontSize = 12.sp)
                Text("${stats?.totalMessages ?: state.counts.messages} رسالة (${stats?.messageDirsCount ?: 0} مجلد)", color = Ink, fontWeight = FontWeight.Bold, fontSize = 12.sp)
            }

            Spacer(Modifier.height(12.dp))

            Button(
                onClick = { viewModel.cleanStorage() },
                modifier = Modifier.fillMaxWidth().height(46.dp),
                shape = RoundedCornerShape(14.dp),
                colors = ButtonDefaults.buttonColors(containerColor = Primary),
                enabled = !isCleaning,
            ) {
                if (isCleaning) {
                    CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp, color = Color.White)
                    Spacer(Modifier.width(8.dp))
                    Text("جارٍ فحص وتنظيف الملفات...", fontSize = 12.sp)
                } else {
                    Icon(Icons.Rounded.DeleteOutline, null, modifier = Modifier.size(18.dp))
                    Spacer(Modifier.width(6.dp))
                    Text("تنظيف الملفات المؤقتة وتفريغ المساحة", fontSize = 12.sp, fontWeight = FontWeight.Bold)
                }
            }
        }
    }
}

@Composable
private fun AppVersionCard(state: MailUiState, viewModel: MailViewModel) {
    val update = state.appUpdate
    val hasUpdate = update?.hasUpdate == true

    Card(
        colors = CardDefaults.cardColors(containerColor = Surface),
        elevation = CardDefaults.cardElevation(2.dp),
        shape = RoundedCornerShape(22.dp),
        border = BorderStroke(1.dp, if (hasUpdate) Color(0xFFFED7AA) else CardBorderSubtle),
    ) {
        Column(Modifier.padding(16.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Box(
                    Modifier
                        .size(44.dp)
                        .clip(RoundedCornerShape(14.dp))
                        .background(if (hasUpdate) Color(0xFFFFF7ED) else PrimaryLight),
                    contentAlignment = Alignment.Center,
                ) {
                    Icon(
                        if (hasUpdate) Icons.Rounded.Download else Icons.Rounded.SystemUpdate,
                        contentDescription = null,
                        tint = if (hasUpdate) Color(0xFFEA580C) else Primary,
                        modifier = Modifier.size(22.dp),
                    )
                }
                Spacer(Modifier.width(12.dp))
                Column(Modifier.weight(1f)) {
                    Text("إصدار التطبيق والتحديثات", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
                    Text(
                        if (hasUpdate) "يتوفر إصدار أحدث: v${update?.latestVersionName}" else "أحدث إصدار مثبت: v${state.currentVersionName}",
                        color = if (hasUpdate) Color(0xFFEA580C) else Green,
                        style = MaterialTheme.typography.bodySmall,
                        fontWeight = FontWeight.Medium,
                    )
                }
            }

            Spacer(Modifier.height(12.dp))

            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .clip(RoundedCornerShape(12.dp))
                    .background(SurfaceSoft)
                    .padding(horizontal = 12.dp, vertical = 8.dp),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text("الإصدار الحالي", color = Muted, fontSize = 12.sp)
                Text("v${state.currentVersionName} (Build ${state.currentVersionCode})", color = Ink, fontWeight = FontWeight.Bold, fontSize = 12.sp)
            }

            if (hasUpdate && update != null) {
                Spacer(Modifier.height(8.dp))
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .clip(RoundedCornerShape(12.dp))
                        .background(Color(0xFFFFF7ED))
                        .padding(horizontal = 12.dp, vertical = 8.dp),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text("الإصدار الجديد المتاح", color = Color(0xFFC2410C), fontSize = 12.sp, fontWeight = FontWeight.Bold)
                    Text("v${update.latestVersionName}", color = Color(0xFFEA580C), fontWeight = FontWeight.Black, fontSize = 13.sp)
                }
            }

            Spacer(Modifier.height(12.dp))

            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                OutlinedButton(
                    onClick = { viewModel.checkForUpdates() },
                    modifier = Modifier.weight(1f).height(46.dp),
                    shape = RoundedCornerShape(14.dp),
                    enabled = !state.refreshing,
                ) {
                    if (state.refreshing) {
                        CircularProgressIndicator(Modifier.size(16.dp), strokeWidth = 2.dp, color = Primary)
                    } else {
                        Icon(Icons.Rounded.Refresh, null, modifier = Modifier.size(16.dp))
                        Spacer(Modifier.width(6.dp))
                        Text("فحص التحديثات", fontSize = 12.sp)
                    }
                }

                if (hasUpdate) {
                    Button(
                        onClick = { viewModel.setUpdateDialogVisible(true) },
                        modifier = Modifier.weight(1f).height(46.dp),
                        shape = RoundedCornerShape(14.dp),
                        colors = ButtonDefaults.buttonColors(containerColor = Color(0xFFEA580C)),
                    ) {
                        Icon(Icons.Rounded.Download, null, modifier = Modifier.size(16.dp))
                        Spacer(Modifier.width(6.dp))
                        Text("تحديث الآن", fontSize = 12.sp, fontWeight = FontWeight.Bold)
                    }
                }
            }
        }
    }
}

@Composable
private fun InAppUpdateBanner(
    update: AppVersionInfo,
    currentVersionName: String,
    onClick: () -> Unit,
) {
    Card(
        modifier = Modifier
            .fillMaxWidth()
            .clickable(onClick = onClick),
        shape = RoundedCornerShape(16.dp),
        colors = CardDefaults.cardColors(
            containerColor = Color(0xFFFFF7ED),
        ),
        border = BorderStroke(1.dp, Color(0xFFFFEDD5)),
        elevation = CardDefaults.cardElevation(1.dp),
    ) {
        Row(
            Modifier
                .fillMaxWidth()
                .padding(horizontal = 12.dp, vertical = 10.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            Box(
                Modifier
                    .size(38.dp)
                    .clip(RoundedCornerShape(12.dp))
                    .background(Color(0xFFF97316)),
                contentAlignment = Alignment.Center,
            ) {
                Icon(
                    Icons.Rounded.Download,
                    contentDescription = null,
                    tint = Color.White,
                    modifier = Modifier.size(20.dp),
                )
            }
            Column(Modifier.weight(1f)) {
                Text(
                    "تحديث جديد متوفر: v${update.latestVersionName}",
                    style = MaterialTheme.typography.labelMedium,
                    fontWeight = FontWeight.Bold,
                    color = Color(0xFF9A3412),
                )
                Text(
                    update.releaseNotes.ifBlank { "اضغط لتحديث التطبيق مباشرة" },
                    color = Color(0xFFC2410C),
                    style = MaterialTheme.typography.bodySmall,
                    fontSize = 11.sp,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
            }
            Button(
                onClick = onClick,
                contentPadding = PaddingValues(horizontal = 12.dp, vertical = 6.dp),
                shape = RoundedCornerShape(10.dp),
                colors = ButtonDefaults.buttonColors(containerColor = Color(0xFFEA580C)),
                modifier = Modifier.height(34.dp),
            ) {
                Text("تحديث", fontSize = 11.sp, fontWeight = FontWeight.Bold)
            }
        }
    }
}

@Composable
private fun InAppUpdateDialog(
    update: AppVersionInfo,
    currentVersionName: String,
    onDismiss: () -> Unit,
) {
    val context = LocalContext.current
    AlertDialog(
        onDismissRequest = {
            if (!update.mandatory) onDismiss()
        },
        icon = {
            Box(
                Modifier
                    .size(54.dp)
                    .clip(CircleShape)
                    .background(Brush.linearGradient(listOf(Color(0xFFEA580C), Color(0xFFEF4444)))),
                contentAlignment = Alignment.Center,
            ) {
                Icon(
                    Icons.Rounded.Download,
                    contentDescription = null,
                    tint = Color.White,
                    modifier = Modifier.size(28.dp),
                )
            }
        },
        title = {
            Column(horizontalAlignment = Alignment.CenterHorizontally) {
                Text(
                    "تحديث جديد متوفر!",
                    style = MaterialTheme.typography.titleMedium,
                    fontWeight = FontWeight.Bold,
                    textAlign = TextAlign.Center,
                )
                Spacer(Modifier.height(4.dp))
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(6.dp),
                ) {
                    Text(
                        "الإصدار الحالي: v$currentVersionName",
                        color = Muted,
                        fontSize = 12.sp,
                    )
                    Text("➔", color = Primary, fontSize = 12.sp)
                    Text(
                        "الجديد: v${update.latestVersionName}",
                        color = Green,
                        fontSize = 12.sp,
                        fontWeight = FontWeight.Bold,
                    )
                }
            }
        },
        text = {
            Column(Modifier.fillMaxWidth()) {
                if (update.releaseNotes.isNotBlank()) {
                    Text(
                        "ما الجديد في هذا التحديث:",
                        style = MaterialTheme.typography.labelMedium,
                        fontWeight = FontWeight.Bold,
                        color = Ink,
                    )
                    Spacer(Modifier.height(6.dp))
                    Card(
                        modifier = Modifier.fillMaxWidth(),
                        shape = RoundedCornerShape(12.dp),
                        colors = CardDefaults.cardColors(containerColor = SurfaceSoft),
                        border = BorderStroke(1.dp, CardBorderSubtle),
                    ) {
                        Text(
                            update.releaseNotes,
                            modifier = Modifier.padding(12.dp),
                            style = MaterialTheme.typography.bodySmall,
                            color = Ink,
                            lineHeight = 18.sp,
                        )
                    }
                    Spacer(Modifier.height(10.dp))
                }
                Text(
                    "انقر على الزر أدناه لتنزيل التحديث وتثبيته مباشرة.",
                    color = Muted,
                    fontSize = 11.sp,
                    textAlign = TextAlign.Center,
                    modifier = Modifier.fillMaxWidth(),
                )
            }
        },
        confirmButton = {
            Button(
                onClick = {
                    if (update.downloadUrl.isNotBlank()) {
                        val uri = Uri.parse(update.downloadUrl)
                        runCatching {
                            context.startActivity(Intent(Intent.ACTION_VIEW, uri))
                        }.onFailure {
                            android.widget.Toast.makeText(context, "تعذر فتح الرابط: ${it.message}", android.widget.Toast.LENGTH_SHORT).show()
                        }
                    }
                    if (!update.mandatory) onDismiss()
                },
                modifier = Modifier.fillMaxWidth(),
                shape = RoundedCornerShape(14.dp),
                colors = ButtonDefaults.buttonColors(containerColor = Color(0xFFEA580C)),
            ) {
                Icon(Icons.Rounded.Download, null, modifier = Modifier.size(18.dp))
                Spacer(Modifier.width(6.dp))
                Text("تنزيل وتثبيت الآن (v${update.latestVersionName})")
            }
        },
        dismissButton = if (!update.mandatory) {
            {
                TextButton(
                    onClick = onDismiss,
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    Text("لاحقاً", color = Muted)
                }
            }
        } else null,
    )
}

@Composable
private fun SettingsCard(state: MailUiState, viewModel: MailViewModel) {
    Card(colors = CardDefaults.cardColors(containerColor = Surface), elevation = CardDefaults.cardElevation(4.dp), shape = RoundedCornerShape(24.dp)) {
        Column(Modifier.padding(17.dp)) {
            SettingsRow(if (state.online) Icons.Rounded.CloudDone else Icons.Rounded.CloudOff, "حالة الخادم", if (state.online) "متصل ويستقبل البيانات" else "تعذر الوصول", if (state.online) Green else Danger)
            HorizontalDivider(Modifier.padding(vertical = 13.dp), color = Color(0xFFE8EBF2))
            SettingsRow(Icons.Rounded.Storage, "المشروع السحابي", state.projectId.ifBlank { "تخزين محلي" }, Primary)
            HorizontalDivider(Modifier.padding(vertical = 13.dp), color = Color(0xFFE8EBF2))
            Row(verticalAlignment = Alignment.CenterVertically) {
                Icon(Icons.Rounded.Refresh, null, tint = Gold, modifier = Modifier.size(26.dp)); Spacer(Modifier.width(12.dp))
                Column(Modifier.weight(1f)) { Text("التحديث التلقائي", style = MaterialTheme.typography.titleMedium); Text("فحص الوارد كل 8 ثوانٍ", color = Muted, style = MaterialTheme.typography.bodyMedium) }
                Switch(checked = state.autoRefresh, onCheckedChange = viewModel::setAutoRefresh)
            }
        }
    }
}

@Composable
private fun SettingsRow(icon: androidx.compose.ui.graphics.vector.ImageVector, title: String, subtitle: String, color: Color) {
    Row(verticalAlignment = Alignment.CenterVertically) {
        Box(Modifier.size(46.dp).clip(RoundedCornerShape(15.dp)).background(color.copy(alpha = .11f)), contentAlignment = Alignment.Center) { Icon(icon, null, tint = color) }
        Spacer(Modifier.width(12.dp)); Column { Text(title, style = MaterialTheme.typography.titleMedium); Text(subtitle, color = Muted, style = MaterialTheme.typography.bodyMedium) }
    }
}

@Composable
private fun MailPills(labels: List<String>, selected: Int, onSelect: (Int) -> Unit) {
    Row(
        Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(17.dp))
            .background(SurfaceSoft)
            .horizontalScroll(rememberScrollState())
            .padding(4.dp),
        horizontalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        labels.forEachIndexed { index, label ->
            Box(
                Modifier
                    .clip(RoundedCornerShape(13.dp))
                    .clickable { onSelect(index) }
                    .background(if (selected == index) Surface else Color.Transparent)
                    .padding(horizontal = 14.dp, vertical = 9.dp),
                contentAlignment = Alignment.Center,
            ) { Text(label, color = if (selected == index) Primary else Muted, style = MaterialTheme.typography.labelMedium, maxLines = 1) }
        }
    }
}

@Composable
private fun SearchField(value: String, placeholder: String, onValueChange: (String) -> Unit) {
    OutlinedTextField(
        value = value,
        onValueChange = onValueChange,
        modifier = Modifier.fillMaxWidth(),
        singleLine = true,
        leadingIcon = { Icon(Icons.Rounded.Search, null, tint = Muted) },
        placeholder = { Text(placeholder, color = Muted) },
        shape = RoundedCornerShape(17.dp),
    )
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun CreateInboxSheet(state: MailUiState, viewModel: MailViewModel) {
    var name by rememberSaveable { mutableStateOf("") }
    var prefix by rememberSaveable { mutableStateOf("") }
    ModalBottomSheet(onDismissRequest = { viewModel.setCreateVisible(false) }, sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true), containerColor = Surface, shape = RoundedCornerShape(topStart = 30.dp, topEnd = 30.dp)) {
        Column(Modifier.fillMaxWidth().imePadding().verticalScroll(rememberScrollState()).padding(horizontal = 20.dp)) {
            Text("خطوة واحدة", color = Primary, style = MaterialTheme.typography.labelMedium)
            Text("صندوق بريد جديد", style = MaterialTheme.typography.headlineMedium)
            Text("اختر النوع وأعطه اسمًا واضحًا.", color = Muted, style = MaterialTheme.typography.bodyMedium)
            Spacer(Modifier.height(18.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                ChoiceCard("بريد رسمي", "@batabitoo.com", Icons.Rounded.WorkspacePremium, Gold, state.createOfficial, Modifier.weight(1f)) { viewModel.setCreateType(true) }
                ChoiceCard("بريد سريع", "جاهز بلحظات", Icons.Rounded.Bolt, Cyan, !state.createOfficial, Modifier.weight(1f)) { viewModel.setCreateType(false) }
            }
            Spacer(Modifier.height(10.dp))
            val nextSequential = viewModel.getNextSequentialPrefix("ahmedroou")
            androidx.compose.material3.Surface(
                modifier = Modifier
                    .fillMaxWidth()
                    .clip(RoundedCornerShape(14.dp))
                    .clickable {
                        viewModel.setCreateType(true)
                        prefix = nextSequential
                        if (name.isBlank() || name.startsWith("ahmedroou")) {
                            name = nextSequential
                        }
                    },
                color = Gold.copy(alpha = 0.12f),
                shape = RoundedCornerShape(14.dp),
                border = BorderStroke(1.dp, Gold.copy(alpha = 0.35f)),
            ) {
                Row(
                    modifier = Modifier.padding(horizontal = 14.dp, vertical = 8.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.SpaceBetween,
                ) {
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                    ) {
                        Box(
                            modifier = Modifier
                                .size(24.dp)
                                .clip(CircleShape)
                                .background(Gold.copy(alpha = 0.25f)),
                            contentAlignment = Alignment.Center,
                        ) {
                            Icon(
                                Icons.Rounded.Bolt,
                                contentDescription = null,
                                tint = Color(0xFFB67B18),
                                modifier = Modifier.size(15.dp),
                            )
                        }
                        Column {
                            Text(
                                "بريد رسمي تتابعي (ahmedroou)",
                                color = Color(0xFF8C5D0B),
                                style = MaterialTheme.typography.labelSmall,
                                fontWeight = FontWeight.Bold,
                            )
                            Text(
                                "انقر لتعبئة التالي تلقائيًا",
                                color = Muted,
                                fontSize = 10.sp,
                            )
                        }
                    }
                    Text(
                        nextSequential,
                        color = Color(0xFF8C5D0B),
                        style = MaterialTheme.typography.labelMedium,
                        fontWeight = FontWeight.Black,
                        modifier = Modifier
                            .clip(RoundedCornerShape(8.dp))
                            .background(Color.White.copy(alpha = 0.85f))
                            .padding(horizontal = 9.dp, vertical = 3.dp),
                    )
                }
            }
            Spacer(Modifier.height(12.dp))
            OutlinedTextField(value = name, onValueChange = { name = it }, modifier = Modifier.fillMaxWidth(), label = { Text("اسم الحساب") }, placeholder = { Text("مثال: حساب أمازون") }, singleLine = true, shape = RoundedCornerShape(17.dp))
            Spacer(Modifier.height(10.dp))
            OutlinedTextField(value = prefix, onValueChange = { prefix = it.filter { char -> char.isLetterOrDigit() || char == '.' }.lowercase() }, modifier = Modifier.fillMaxWidth(), label = { Text("عنوان البريد") }, supportingText = { Text(if (state.createOfficial) "سيُضاف @batabitoo.com تلقائيًا" else "سيُختار نطاق سريع تلقائيًا") }, singleLine = true, shape = RoundedCornerShape(17.dp))
            Spacer(Modifier.height(10.dp))
            Button(onClick = { viewModel.createInbox(name, prefix) }, enabled = !state.refreshing, modifier = Modifier.fillMaxWidth().height(56.dp), shape = RoundedCornerShape(18.dp)) {
                if (state.refreshing) CircularProgressIndicator(Modifier.size(19.dp), strokeWidth = 2.dp, color = Color.White) else Icon(Icons.Rounded.Add, null)
                Spacer(Modifier.width(8.dp)); Text(if (state.refreshing) "جاري الإنشاء…" else "إنشاء الصندوق")
            }
            Spacer(Modifier.height(28.dp))
        }
    }
}

@Composable
private fun ChoiceCard(title: String, subtitle: String, icon: androidx.compose.ui.graphics.vector.ImageVector, color: Color, selected: Boolean, modifier: Modifier, onClick: () -> Unit) {
    Card(modifier.clickable(onClick = onClick), colors = CardDefaults.cardColors(containerColor = if (selected) color.copy(alpha = .12f) else SurfaceSoft), border = BorderStroke(1.dp, if (selected) color.copy(alpha = .45f) else Color.Transparent), shape = RoundedCornerShape(20.dp)) {
        Column(Modifier.fillMaxWidth().padding(16.dp), horizontalAlignment = Alignment.CenterHorizontally) { Icon(icon, null, tint = color, modifier = Modifier.size(28.dp)); Spacer(Modifier.height(7.dp)); Text(title, style = MaterialTheme.typography.titleMedium); Text(subtitle, color = Muted, style = MaterialTheme.typography.labelSmall) }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun MessageSheet(message: MailMessage, onDismiss: () -> Unit) {
    val clipboard = LocalClipboardManager.current
    val contentToRender = if (message.html.isNotBlank()) {
        message.html
    } else {
        "<!doctype html><html dir=\"auto\"><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width, initial-scale=1\"><style>body{font-family:sans-serif;line-height:1.8;padding:16px;color:#182032;white-space:pre-wrap;overflow-wrap:anywhere;}</style></head><body>${message.text.ifBlank { "لا يوجد محتوى للرسالة." }}</body></html>"
    }

    ModalBottomSheet(onDismissRequest = onDismiss, containerColor = Surface, shape = RoundedCornerShape(topStart = 30.dp, topEnd = 30.dp), modifier = Modifier.fillMaxHeight(.95f)) {
        Column(Modifier.fillMaxSize().padding(horizontal = 18.dp)) {
            Text("تفاصيل الرسالة", color = Primary, style = MaterialTheme.typography.labelMedium)
            Text(message.subject.ifBlank { "(بدون عنوان)" }, style = MaterialTheme.typography.titleLarge, maxLines = 2, overflow = TextOverflow.Ellipsis)
            Spacer(Modifier.height(12.dp))
            MetaLine("من", message.from.ifBlank { "غير معروف" }); MetaLine("إلى", message.to.ifBlank { message.inboxEmail }); MetaLine("التاريخ", formatDate(message.createdAt, true))
            AnimatedVisibility(message.otp.isNotBlank()) {
                Row(Modifier.fillMaxWidth().padding(vertical = 10.dp).clip(RoundedCornerShape(19.dp)).background(Green.copy(alpha = .11f)).clickable { clipboard.setText(AnnotatedString(message.otp)) }.padding(14.dp), verticalAlignment = Alignment.CenterVertically) {
                    Column(Modifier.weight(1f)) { Text("رمز التحقق · اضغط للنسخ", color = Green, style = MaterialTheme.typography.labelSmall); Text(message.otp, color = Color(0xFF087855), fontSize = 26.sp, fontWeight = FontWeight.Black, letterSpacing = 3.sp) }
                    Icon(Icons.Rounded.ContentCopy, "نسخ", tint = Green)
                }
            }
            Spacer(Modifier.height(9.dp))
            Card(Modifier.fillMaxWidth().weight(1f), colors = CardDefaults.cardColors(containerColor = Color.White), shape = RoundedCornerShape(20.dp), border = BorderStroke(1.dp, Color(0xFFE8EBF2))) {
                HtmlMessage(contentToRender)
            }
            Spacer(Modifier.height(18.dp))
        }
    }
}

@Composable
private fun MetaLine(label: String, value: String) {
    Row(Modifier.fillMaxWidth().padding(vertical = 4.dp), verticalAlignment = Alignment.Top) { Text(label, color = Muted, style = MaterialTheme.typography.labelSmall, modifier = Modifier.width(55.dp)); SelectionContainer { Text(value.ifBlank { "—" }, color = Ink, style = MaterialTheme.typography.bodyMedium, maxLines = 2, overflow = TextOverflow.Ellipsis) } }
}

@Composable
private fun HtmlMessage(content: String) {
    AndroidView(
        factory = { context -> WebView(context).apply { settings.javaScriptEnabled = false; settings.domStorageEnabled = false; settings.allowFileAccess = false; settings.allowContentAccess = false; settings.loadWithOverviewMode = true; settings.useWideViewPort = true; webViewClient = WebViewClient() } },
        update = { webView -> if (webView.tag != content.hashCode()) { webView.tag = content.hashCode(); webView.loadDataWithBaseURL(null, content, "text/html", "UTF-8", null) } },
        modifier = Modifier.fillMaxSize(),
    )
}

@Composable
private fun EmptyList(title: String, message: String) {
    val motion = rememberInfiniteTransition(label = "empty")
    val float by motion.animateFloat(-5f, 5f, infiniteRepeatable(tween(1700), RepeatMode.Reverse), label = "float")
    Column(Modifier.fillMaxWidth().padding(vertical = 54.dp, horizontal = 24.dp), horizontalAlignment = Alignment.CenterHorizontally) {
        Box(Modifier.size(78.dp).graphicsLayer { translationY = float }.clip(RoundedCornerShape(26.dp)).background(Brush.linearGradient(listOf(Primary.copy(alpha = .13f), Cyan.copy(alpha = .15f)))), contentAlignment = Alignment.Center) { Icon(Icons.Rounded.Inbox, null, tint = Primary, modifier = Modifier.size(34.dp)) }
        Spacer(Modifier.height(16.dp)); Text(title, style = MaterialTheme.typography.titleMedium); Text(message, color = Muted, style = MaterialTheme.typography.bodyMedium, textAlign = TextAlign.Center)
    }
}

@Composable
private fun LoadingVeil() {
    Box(Modifier.fillMaxSize().background(AppCanvas.copy(alpha = .86f)), contentAlignment = Alignment.Center) {
        Column(horizontalAlignment = Alignment.CenterHorizontally) { CircularProgressIndicator(color = Primary); Spacer(Modifier.height(13.dp)); Text("نرتّب بريدك…", color = Muted, style = MaterialTheme.typography.bodyMedium) }
    }
}

@Composable
private fun BottomDock(selected: MainSection, onSelect: (MainSection) -> Unit, onCreate: () -> Unit) {
    Box(Modifier.fillMaxWidth().navigationBarsPadding().padding(horizontal = 10.dp, vertical = 6.dp).height(74.dp)) {
        Card(
            Modifier.fillMaxWidth().height(68.dp).align(Alignment.BottomCenter),
            colors = CardDefaults.cardColors(containerColor = Surface.copy(alpha = .98f)),
            elevation = CardDefaults.cardElevation(10.dp),
            shape = RoundedCornerShape(24.dp)
        ) {
            Row(Modifier.fillMaxSize().padding(horizontal = 4.dp), verticalAlignment = Alignment.CenterVertically) {
                NavItem(MainSection.INBOXES, "الصناديق", Icons.Rounded.Inbox, selected, onSelect, Modifier.weight(1f))
                NavItem(MainSection.AMAZON, "أمازون", Icons.Rounded.ShoppingCart, selected, onSelect, Modifier.weight(1f), activeColor = Color(0xFFFF9900))
                Box(Modifier.weight(0.9f), contentAlignment = Alignment.Center) {
                    FloatingActionButton(
                        onClick = onCreate,
                        modifier = Modifier.size(48.dp),
                        containerColor = Primary,
                        contentColor = Color.White,
                        shape = RoundedCornerShape(16.dp)
                    ) {
                        Icon(Icons.Rounded.Add, "صندوق جديد", modifier = Modifier.size(24.dp))
                    }
                }
                NavItem(MainSection.MESSAGES, "الرسائل", Icons.Rounded.MailOutline, selected, onSelect, Modifier.weight(1f))
                NavItem(MainSection.LOGS, "السجل", Icons.Rounded.ReceiptLong, selected, onSelect, Modifier.weight(1f))
            }
        }
    }
}

@Composable
private fun NavItem(
    section: MainSection,
    label: String,
    icon: androidx.compose.ui.graphics.vector.ImageVector,
    selected: MainSection,
    onSelect: (MainSection) -> Unit,
    modifier: Modifier,
    activeColor: Color = Primary,
) {
    val isSelected = selected == section
    val tint = if (isSelected) activeColor else Muted
    Column(
        modifier
            .fillMaxHeight()
            .clip(RoundedCornerShape(16.dp))
            .clickable { onSelect(section) }
            .background(if (isSelected) activeColor.copy(alpha = .09f) else Color.Transparent),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center
    ) {
        Icon(icon, label, tint = tint, modifier = Modifier.size(22.dp))
        Spacer(Modifier.height(2.dp))
        Text(
            label,
            color = tint,
            style = MaterialTheme.typography.labelSmall,
            fontSize = 11.sp,
            fontWeight = if (isSelected) FontWeight.Bold else FontWeight.Normal,
            maxLines = 1
        )
    }
}


private fun arabicNumber(value: Int): String = java.text.NumberFormat.getIntegerInstance(Locale("ar", "SA")).format(value)
private fun initials(value: String): String = value.replace(Regex("[<>@._-]"), " ").trim().split(Regex("\\s+")).filter { it.isNotBlank() }.take(2).joinToString("") { it.take(1) }.ifBlank { "@" }.uppercase()
private fun formatDate(value: String, long: Boolean = false): String = runCatching {
    val instant = Instant.parse(value)
    DateTimeFormatter.ofPattern(if (long) "d MMM yyyy، h:mm a" else "d MMM، h:mm a", Locale("ar", "SA")).format(instant.atZone(ZoneId.systemDefault()))
}.getOrDefault(value.ifBlank { "—" })
