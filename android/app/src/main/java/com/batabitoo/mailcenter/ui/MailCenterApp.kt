package com.batabitoo.mailcenter.ui

import kotlinx.coroutines.launch
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
import androidx.compose.foundation.layout.BoxWithConstraints
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
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.foundation.text.KeyboardOptions
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
import androidx.compose.material.icons.rounded.Key
import androidx.compose.material.icons.rounded.Lock
import androidx.compose.material.icons.rounded.LockOpen
import androidx.compose.material.icons.rounded.LocalShipping
import androidx.compose.material.icons.rounded.MailOutline
import androidx.compose.material.icons.rounded.MoreVert
import androidx.compose.material.icons.rounded.OpenInBrowser
import androidx.compose.material.icons.rounded.ReceiptLong
import androidx.compose.material.icons.rounded.Refresh
import androidx.compose.material.icons.rounded.Search
import androidx.compose.material.icons.rounded.Settings
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
import androidx.compose.material3.Surface
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
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
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.viewmodel.compose.viewModel
import com.batabitoo.mailcenter.AmazonTab
import com.batabitoo.mailcenter.AmazonDomainFilter
import com.batabitoo.mailcenter.InboxFilter
import com.batabitoo.mailcenter.OfficialSubFilter
import com.batabitoo.mailcenter.MailUiState
import com.batabitoo.mailcenter.MailViewModel
import com.batabitoo.mailcenter.MainSection
import com.batabitoo.mailcenter.LogsTab
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
import com.batabitoo.mailcenter.ui.theme.MutedLight
import com.batabitoo.mailcenter.ui.theme.NebulaBlue
import com.batabitoo.mailcenter.ui.theme.NebulaNight
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
    val widthDp = LocalConfiguration.current.screenWidthDp
    val compact = widthDp < 600
    val expandedRail = widthDp >= 1100
    val lifecycleOwner = LocalLifecycleOwner.current
    DisposableEffect(lifecycleOwner) {
        val observer = LifecycleEventObserver { _, event ->
            if (event == Lifecycle.Event.ON_RESUME) viewModel.refreshGmailAccounts(silent = true)
        }
        lifecycleOwner.lifecycle.addObserver(observer)
        onDispose { lifecycleOwner.lifecycle.removeObserver(observer) }
    }
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
        containerColor = if (state.section == MainSection.INBOXES) HomePaper else AppCanvas,
        snackbarHost = { SnackbarHost(snackbar) },
        topBar = {
            Column {
                if (state.section == MainSection.INBOXES) {
                    InboxHomeHeader(state, { viewModel.refreshAll() }, { viewModel.setSection(MainSection.SETTINGS) }, { viewModel.setUpdateDialogVisible(true) })
                } else {
                    AppHeader(state, viewModel, compact)
                }
                if (state.dataError != null) {
                    val context = LocalContext.current
                    Surface(color = Color(0xFFFFF0D6)) {
                        Column(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp)) {
                            Text(state.dataError.orEmpty(), color = Ink, style = MaterialTheme.typography.bodySmall)
                            Row {
                                TextButton(onClick = { viewModel.refreshAll() }) { Text("إعادة المحاولة") }
                                if (state.authRequired) TextButton(onClick = {
                                    context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(viewModel.connectionUrl())))
                                }) { Text("الاتصال من جلسة الويب") }
                            }
                        }
                    }
                }
            }
        },
        bottomBar = {
            if (compact) {
                if (state.section == MainSection.INBOXES) InboxHomeNavigation(viewModel::setSection)
                else BottomDock(state.section, viewModel::setSection) { viewModel.setCreateVisible(true) }
            }
        },
    ) { padding ->
        Row(Modifier.fillMaxSize().padding(padding)) {
            if (!compact) {
                if (state.section == MainSection.INBOXES) {
                    InboxHomeRail(expandedRail, viewModel::setSection) { viewModel.setCreateVisible(true) }
                } else AdaptiveNavigationRail(
                    selected = state.section,
                    expanded = expandedRail,
                    onSelect = viewModel::setSection,
                    onCreate = { viewModel.setCreateVisible(true) },
                )
            }
            BoxWithConstraints(
                modifier = Modifier.weight(1f).fillMaxHeight(),
                contentAlignment = Alignment.TopCenter,
            ) {
                val contentWidth = minOf(maxWidth, if (expandedRail) 1320.dp else 940.dp)
                Box(Modifier.width(contentWidth).fillMaxHeight()) {
                    Crossfade(targetState = state.section, animationSpec = tween(220), label = "section") { section ->
                        when (section) {
                            MainSection.INBOXES -> InboxHomeRoute(state, viewModel)
                            MainSection.AMAZON -> AmazonDashboard(state, viewModel)
                            MainSection.MESSAGES -> MessagesScreen(state, viewModel)
                            MainSection.LOGS -> LogsScreen(state, viewModel)
                            MainSection.SETTINGS -> SettingsScreen(state, viewModel)
                        }
                    }
                    if (state.loading) LoadingVeil()
                }
            }
        }
    }

    if (state.showCreate) CreateInboxSheet(state, viewModel)
    if (state.showDottedDialog) DottedGmailDialog(state, viewModel)
    state.selectedMessage?.let { selected ->
        EmailReader(
            message = selected,
            baseUrl = state.baseUrl,
            loading = state.messageLoading,
            error = state.messageError,
            onRetry = { viewModel.openMessage(selected) },
            onDismiss = viewModel::closeMessage,
            onPrevious = { viewModel.navigateMessage(-1) },
            onNext = { viewModel.navigateMessage(1) },
            onOpenAttachment = { attachment -> viewModel.openAttachment(selected, attachment) },
        )
    }
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
private fun LoginGate(
    busy: Boolean,
    error: String?,
    onLogin: (String) -> Unit,
) {
    var pin by rememberSaveable { mutableStateOf("") }
    Dialog(
        onDismissRequest = {},
        properties = DialogProperties(usePlatformDefaultWidth = false, dismissOnBackPress = false, dismissOnClickOutside = false),
    ) {
        Box(
            modifier = Modifier
                .fillMaxSize()
                .background(Brush.linearGradient(listOf(NebulaNight, NebulaBlue, Primary)))
                .imePadding()
                .padding(22.dp),
            contentAlignment = Alignment.Center,
        ) {
            Canvas(Modifier.matchParentSize()) {
                drawCircle(Cyan.copy(alpha = .12f), size.minDimension * .32f, Offset(size.width * .13f, size.height * .18f))
                drawCircle(Violet.copy(alpha = .18f), size.minDimension * .42f, Offset(size.width * .91f, size.height * .77f))
            }
            Card(
                modifier = Modifier.fillMaxWidth().widthIn(max = 430.dp),
                shape = RoundedCornerShape(30.dp),
                colors = CardDefaults.cardColors(containerColor = Color.White.copy(alpha = .98f)),
                elevation = CardDefaults.cardElevation(16.dp),
            ) {
                Column(
                    Modifier.fillMaxWidth().padding(horizontal = 24.dp, vertical = 28.dp),
                    horizontalAlignment = Alignment.CenterHorizontally,
                ) {
                    Box(
                        Modifier.size(62.dp).clip(RoundedCornerShape(21.dp))
                            .background(Brush.linearGradient(listOf(Violet, Primary, Cyan))),
                        contentAlignment = Alignment.Center,
                    ) {
                        Icon(Icons.Rounded.Lock, null, tint = Color.White, modifier = Modifier.size(29.dp))
                    }
                    Spacer(Modifier.height(18.dp))
                    Text("بوابة Mail Nebula", style = MaterialTheme.typography.headlineMedium, color = Ink)
                    Spacer(Modifier.height(6.dp))
                    Text(
                        "أدخل رمز الأمان للوصول إلى صناديق البريد والرسائل.",
                        color = Muted,
                        style = MaterialTheme.typography.bodyMedium,
                        textAlign = TextAlign.Center,
                    )
                    Spacer(Modifier.height(22.dp))
                    OutlinedTextField(
                        value = pin,
                        onValueChange = { value -> pin = value.filter(Char::isDigit).take(8) },
                        modifier = Modifier.fillMaxWidth(),
                        enabled = !busy,
                        singleLine = true,
                        label = { Text("رمز الأمان") },
                        placeholder = { Text("••••") },
                        leadingIcon = { Icon(Icons.Rounded.Key, null, tint = Primary) },
                        visualTransformation = PasswordVisualTransformation(),
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.NumberPassword),
                        isError = error != null,
                        supportingText = if (error != null) ({ Text(error, color = Danger) }) else null,
                        shape = RoundedCornerShape(17.dp),
                    )
                    Spacer(Modifier.height(14.dp))
                    Button(
                        onClick = { onLogin(pin) },
                        enabled = pin.length >= 4 && !busy,
                        modifier = Modifier.fillMaxWidth().height(54.dp),
                        shape = RoundedCornerShape(17.dp),
                    ) {
                        if (busy) {
                            CircularProgressIndicator(Modifier.size(20.dp), color = Color.White, strokeWidth = 2.dp)
                            Spacer(Modifier.width(9.dp))
                            Text("جارٍ التحقق…")
                        } else {
                            Icon(Icons.Rounded.LockOpen, null, modifier = Modifier.size(19.dp))
                            Spacer(Modifier.width(8.dp))
                            Text("فتح مركز البريد", fontWeight = FontWeight.Bold)
                        }
                    }
                    Spacer(Modifier.height(12.dp))
                    Text("اتصال آمن · لا يُحفظ الرمز كنص ظاهر", color = MutedLight, fontSize = 10.sp)
                }
            }
        }
    }
}

@Composable
private fun AppHeader(state: MailUiState, viewModel: MailViewModel, compact: Boolean) {
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
                if (java.time.LocalTime.now().hour < 12) "صباح الخير" else "مساء الخير",
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
                    "تحديث جديد",
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
        if (compact) {
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
                nextAccount = viewModel.getNextSequentialPrefix(),
                refreshing = state.refreshing,
                onCreate = { viewModel.createSequentialInbox() },
                onAddDotted = { viewModel.setShowDottedDialog(true) },
                onRefresh = { viewModel.refreshAll() },
                onBack = { viewModel.setSection(MainSection.INBOXES) },
            )
        }

        item {
            AmazonKpiSection(
                total = allAmazonInboxes.size,
                suspected = suspectedAmazonInboxes.size,
                banned = bannedAmazonInboxes.size,
                healthy = healthyAmazonInboxes.size,
                messages = amazonMessages.size,
                deleted = state.deletedAmazonAccounts.size,
                otp = amazonMessages.count { it.otp.isNotBlank() },
                orders = amazonMessages.count(::isAmazonOrderMessage),
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
                            AmazonTab.DELETED -> "الحسابات المستبعدة القابلة للاستعادة"
                            AmazonTab.MESSAGES -> "رسائل وأكواد أمازون (OTP) 🔑"
                            AmazonTab.OTP -> "رموز التحقق من أمازون"
                            AmazonTab.ORDERS -> "الطلبات والشحن من أمازون"
                        },
                        style = MaterialTheme.typography.titleMedium,
                        fontWeight = FontWeight.Bold,
                    )
                }
            }

            SearchField(
                state.search,
                if (state.amazonTab in setOf(AmazonTab.MESSAGES, AmazonTab.OTP, AmazonTab.ORDERS)) "ابحث في رسائل أمازون..." else "ابحث في حسابات أمازون...",
                viewModel::setSearch,
            )

            if (state.amazonTab !in setOf(AmazonTab.MESSAGES, AmazonTab.OTP, AmazonTab.ORDERS, AmazonTab.DELETED)) {
                val amzAll = allAmazonInboxes.size
                val amzBatabitoo = allAmazonInboxes.count { it.isBatabitooDomain }
                val amzGmail = allAmazonInboxes.count { it.isGmailDomain }
                Spacer(Modifier.height(6.dp))
                Row(
                    modifier = Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()),
                    horizontalArrangement = Arrangement.spacedBy(6.dp),
                ) {
                    CompactSubChip(
                        label = "كل النطاقات",
                        count = amzAll,
                        selected = state.amazonDomainFilter == AmazonDomainFilter.ALL,
                        onClick = { viewModel.setAmazonDomainFilter(AmazonDomainFilter.ALL) }
                    )
                    CompactSubChip(
                        label = "🏢 أمازون بطابيطو",
                        count = amzBatabitoo,
                        selected = state.amazonDomainFilter == AmazonDomainFilter.BATABITOO,
                        onClick = { viewModel.setAmazonDomainFilter(AmazonDomainFilter.BATABITOO) }
                    )
                    CompactSubChip(
                        label = "🔵 أمازون Gmail والنقاط",
                        count = amzGmail,
                        selected = state.amazonDomainFilter == AmazonDomainFilter.GMAIL,
                        onClick = { viewModel.setAmazonDomainFilter(AmazonDomainFilter.GMAIL) }
                    )
                }
            }
            Spacer(Modifier.height(2.dp))
        }

        if (state.amazonTab in setOf(AmazonTab.MESSAGES, AmazonTab.OTP, AmazonTab.ORDERS)) {
            val tabMessages = when (state.amazonTab) {
                AmazonTab.OTP -> amazonMessages.filter { it.otp.isNotBlank() }
                AmazonTab.ORDERS -> amazonMessages.filter(::isAmazonOrderMessage)
                else -> amazonMessages
            }
            val filteredMessages = tabMessages.filter {
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
        } else if (state.amazonTab == AmazonTab.DELETED) {
            val deleted = state.deletedAmazonAccounts.filter { query.isBlank() || it.email.contains(query, ignoreCase = true) }
            if (deleted.isEmpty()) {
                item { EmptyList("لا توجد حسابات مستبعدة", "الحسابات التي تستبعدها ستبقى هنا حتى تختار استعادتها.") }
            } else {
                items(deleted, key = { it.email }) { account ->
                    Card(
                        modifier = Modifier.fillMaxWidth(),
                        shape = RoundedCornerShape(18.dp),
                        colors = CardDefaults.cardColors(containerColor = Surface),
                        border = BorderStroke(1.dp, CardBorderSubtle),
                    ) {
                        Row(
                            Modifier.fillMaxWidth().padding(horizontal = 15.dp, vertical = 13.dp),
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(12.dp),
                        ) {
                            Box(Modifier.size(40.dp).clip(RoundedCornerShape(13.dp)).background(BannedLight), contentAlignment = Alignment.Center) {
                                Icon(Icons.Rounded.DeleteOutline, null, tint = BannedRed)
                            }
                            Column(Modifier.weight(1f)) {
                                Text(account.email, fontWeight = FontWeight.Bold, maxLines = 1, overflow = TextOverflow.Ellipsis)
                                Text("مستبعد من مركز أمازون", color = Muted, style = MaterialTheme.typography.labelSmall)
                            }
                            OutlinedButton(
                                onClick = { viewModel.restoreAmazonAccount(account) },
                                enabled = !state.refreshing,
                                shape = RoundedCornerShape(13.dp),
                            ) { Icon(Icons.Rounded.Refresh, null, modifier = Modifier.size(17.dp)); Spacer(Modifier.width(5.dp)); Text("استعادة") }
                        }
                    }
                }
            }
        } else {
            val baseList = when (state.amazonTab) {
                AmazonTab.ALL -> allAmazonInboxes
                AmazonTab.SUSPECTED -> suspectedAmazonInboxes
                AmazonTab.BANNED -> bannedAmazonInboxes
                AmazonTab.HEALTHY -> healthyAmazonInboxes
                AmazonTab.DELETED, AmazonTab.MESSAGES, AmazonTab.OTP, AmazonTab.ORDERS -> emptyList()
            }
            val domainFilteredList = when (state.amazonDomainFilter) {
                AmazonDomainFilter.ALL -> baseList
                AmazonDomainFilter.BATABITOO -> baseList.filter { it.isBatabitooDomain }
                AmazonDomainFilter.GMAIL -> baseList.filter { it.isGmailDomain }
            }
            val filteredInboxes = domainFilteredList.filter {
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
                        onDelete = { viewModel.deleteAmazonAccount(inbox) },
                    )
                }
            }
        }
    }
}

private fun isAmazonOrderMessage(message: MailMessage): Boolean {
    val text = "${message.subject} ${message.intro} ${message.text}".lowercase()
    return listOf(
        "order", "ordered", "shipment", "shipped", "delivery", "delivered", "tracking",
        "طلب", "طلبك", "شحن", "شحنتك", "التوصيل", "تم التسليم", "تتبع",
    ).any(text::contains)
}

@Composable
private fun AmazonUniverseHero(
    totalAccounts: Int,
    suspectedAccounts: Int,
    bannedAccounts: Int,
    messagesCount: Int,
    nextAccount: String,
    refreshing: Boolean,
    onCreate: () -> Unit,
    onAddDotted: () -> Unit,
    onRefresh: () -> Unit,
    onBack: () -> Unit = {},
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
                            .clickable(onClick = onBack)
                            .padding(horizontal = 10.dp, vertical = 5.dp),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(6.dp),
                    ) {
                        Icon(
                            Icons.Rounded.Inbox,
                            contentDescription = "الرجوع للرئيسية",
                            tint = Color(0xFFFF9900),
                            modifier = Modifier.size(15.dp),
                        )
                        Text(
                            text = "الرجوع للرئيسية",
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
                        AmazonMark(
                            modifier = Modifier.size(30.dp),
                            foreground = Color.White,
                            accent = Color.White,
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
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(6.dp),
                ) {
                    Button(
                        onClick = onCreate,
                        enabled = !refreshing,
                        modifier = Modifier.weight(1f).height(44.dp),
                        shape = RoundedCornerShape(14.dp),
                        colors = ButtonDefaults.buttonColors(
                            containerColor = Color(0xFFFF9900),
                            contentColor = Color(0xFF131921),
                        ),
                        contentPadding = PaddingValues(horizontal = 8.dp),
                    ) {
                        Icon(Icons.Rounded.Add, contentDescription = null, modifier = Modifier.size(16.dp))
                        Spacer(Modifier.width(4.dp))
                        Text("إنشاء $nextAccount", fontSize = 11.sp, fontWeight = FontWeight.ExtraBold, maxLines = 1)
                    }
                    Button(
                        onClick = onAddDotted,
                        enabled = !refreshing,
                        modifier = Modifier.height(44.dp),
                        shape = RoundedCornerShape(14.dp),
                        colors = ButtonDefaults.buttonColors(
                            containerColor = Color(0xFF2563EB),
                            contentColor = Color.White,
                        ),
                        contentPadding = PaddingValues(horizontal = 10.dp),
                    ) {
                        Text("+ تفريع نقطي", fontSize = 11.sp, fontWeight = FontWeight.Bold, maxLines = 1)
                    }
                    OutlinedButton(
                        onClick = onRefresh,
                        enabled = !refreshing,
                        modifier = Modifier.height(44.dp),
                        shape = RoundedCornerShape(14.dp),
                        border = BorderStroke(1.dp, Color.White.copy(alpha = 0.18f)),
                        colors = ButtonDefaults.outlinedButtonColors(contentColor = Color.White),
                        contentPadding = PaddingValues(horizontal = 10.dp),
                    ) {
                        if (refreshing) CircularProgressIndicator(Modifier.size(16.dp), strokeWidth = 2.dp, color = Color.White)
                        else Icon(Icons.Rounded.Refresh, contentDescription = "تحديث حسابات أمازون", modifier = Modifier.size(18.dp))
                    }
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
    deleted: Int,
    otp: Int,
    orders: Int,
    selectedTab: AmazonTab,
    onSelectTab: (AmazonTab) -> Unit,
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .horizontalScroll(rememberScrollState())
            .padding(vertical = 4.dp),
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        AmazonKpiCard(
            title = "الكل",
            count = arabicNumber(total),
            icon = Icons.Rounded.AlternateEmail,
            accentColor = Color(0xFFEA580C),
            selected = selectedTab == AmazonTab.ALL,
            onClick = { onSelectTab(AmazonTab.ALL) },
        )
        AmazonKpiCard(
            title = "اشتباه ⚠️",
            count = arabicNumber(suspected),
            icon = Icons.Rounded.Warning,
            accentColor = Color(0xFFD97706),
            selected = selectedTab == AmazonTab.SUSPECTED,
            onClick = { onSelectTab(AmazonTab.SUSPECTED) },
        )
        AmazonKpiCard(
            title = "المحظورة",
            count = arabicNumber(banned),
            icon = Icons.Rounded.Block,
            accentColor = BannedRed,
            selected = selectedTab == AmazonTab.BANNED,
            onClick = { onSelectTab(AmazonTab.BANNED) },
        )
        AmazonKpiCard(
            title = "السليمة",
            count = arabicNumber(healthy),
            icon = Icons.Rounded.CheckCircle,
            accentColor = Green,
            selected = selectedTab == AmazonTab.HEALTHY,
            onClick = { onSelectTab(AmazonTab.HEALTHY) },
        )
        AmazonKpiCard(
            title = "الرسائل 🔑",
            count = arabicNumber(messages),
            icon = Icons.Rounded.Bolt,
            accentColor = Color(0xFF4F46E5),
            selected = selectedTab == AmazonTab.MESSAGES,
            onClick = { onSelectTab(AmazonTab.MESSAGES) },
        )
        AmazonKpiCard(
            title = "OTP",
            count = arabicNumber(otp),
            icon = Icons.Rounded.Key,
            accentColor = Primary,
            selected = selectedTab == AmazonTab.OTP,
            onClick = { onSelectTab(AmazonTab.OTP) },
        )
        AmazonKpiCard(
            title = "الطلبات",
            count = arabicNumber(orders),
            icon = Icons.Rounded.LocalShipping,
            accentColor = Color(0xFF0F766E),
            selected = selectedTab == AmazonTab.ORDERS,
            onClick = { onSelectTab(AmazonTab.ORDERS) },
        )
        AmazonKpiCard(
            title = "المستبعدة",
            count = arabicNumber(deleted),
            icon = Icons.Rounded.DeleteOutline,
            accentColor = Muted,
            selected = selectedTab == AmazonTab.DELETED,
            onClick = { onSelectTab(AmazonTab.DELETED) },
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
    val bg = if (selected) accentColor.copy(alpha = 0.15f) else Surface
    val border = if (selected) accentColor else CardBorderSubtle
    val iconBg = if (selected) accentColor else accentColor.copy(alpha = 0.12f)
    val iconTint = if (selected) Color.White else accentColor

    Surface(
        onClick = onClick,
        modifier = modifier
            .clip(RoundedCornerShape(20.dp)),
        color = bg,
        border = BorderStroke(if (selected) 1.5.dp else 1.dp, border),
        shadowElevation = if (selected) 3.dp else 0.5.dp,
    ) {
        Row(
            modifier = Modifier
                .padding(horizontal = 12.dp, vertical = 8.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(7.dp),
        ) {
            Box(
                modifier = Modifier
                    .size(26.dp)
                    .clip(CircleShape)
                    .background(iconBg),
                contentAlignment = Alignment.Center,
            ) {
                Icon(
                    icon,
                    contentDescription = null,
                    tint = iconTint,
                    modifier = Modifier.size(14.dp),
                )
            }
            Text(
                text = title,
                style = MaterialTheme.typography.labelMedium,
                fontWeight = if (selected) FontWeight.ExtraBold else FontWeight.SemiBold,
                color = if (selected) Ink else Ink.copy(alpha = 0.8f),
                fontSize = 12.sp,
                maxLines = 1,
            )
            Surface(
                shape = RoundedCornerShape(10.dp),
                color = if (selected) accentColor else accentColor.copy(alpha = 0.12f),
            ) {
                Text(
                    text = count,
                    modifier = Modifier.padding(horizontal = 7.dp, vertical = 2.dp),
                    style = MaterialTheme.typography.labelSmall,
                    fontWeight = FontWeight.Bold,
                    color = if (selected) Color.White else accentColor,
                    fontSize = 11.sp,
                )
            }
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
    onDelete: () -> Unit,
) {
    var confirmDelete by remember { mutableStateOf(false) }
    val accent = when {
        inbox.isConfirmedBanned -> BannedRed
        inbox.isSuspected -> Color(0xFFD97706)
        else -> Color(0xFFFF9900)
    }

    Card(
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(18.dp),
        colors = CardDefaults.cardColors(containerColor = Surface),
        border = BorderStroke(
            1.dp,
            when {
                inbox.isConfirmedBanned -> BannedRed.copy(alpha = 0.35f)
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
            // 1. Header: Icon + Account Name + Status Badge + Message Count
            Row(
                modifier = Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                Box(
                    modifier = Modifier
                        .size(38.dp)
                        .clip(CircleShape)
                        .background(accent.copy(alpha = 0.12f)),
                    contentAlignment = Alignment.Center,
                ) {
                    Icon(
                        when {
                            inbox.isConfirmedBanned -> Icons.Rounded.Block
                            inbox.isSuspected -> Icons.Rounded.Warning
                            else -> Icons.Rounded.AlternateEmail
                        },
                        contentDescription = null,
                        tint = accent,
                        modifier = Modifier.size(18.dp),
                    )
                }

                Column(modifier = Modifier.weight(1f)) {
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(6.dp),
                    ) {
                        Text(
                            text = inbox.personName.ifBlank { "حساب أمازون" },
                            fontWeight = FontWeight.Bold,
                            style = MaterialTheme.typography.titleMedium,
                            color = Ink,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                        )
                        if (inbox.isConfirmedBanned) {
                            Text(
                                text = "⛔ ${inbox.banReason.ifBlank { "محظور" }}",
                                color = BannedRed,
                                fontSize = 9.sp,
                                fontWeight = FontWeight.Bold,
                                modifier = Modifier
                                    .clip(RoundedCornerShape(6.dp))
                                    .background(BannedLight)
                                    .padding(horizontal = 6.dp, vertical = 2.dp),
                            )
                        } else if (inbox.isSuspected) {
                            Text(
                                text = "⚠️ اشتباه حظر",
                                color = Color(0xFF92400E),
                                fontSize = 9.sp,
                                fontWeight = FontWeight.Bold,
                                modifier = Modifier
                                    .clip(RoundedCornerShape(6.dp))
                                    .background(Color(0xFFFEF3C7))
                                    .padding(horizontal = 6.dp, vertical = 2.dp),
                            )
                        } else {
                            Text(
                                text = "✅ سليم",
                                color = Green,
                                fontSize = 9.sp,
                                fontWeight = FontWeight.Bold,
                                modifier = Modifier
                                    .clip(RoundedCornerShape(6.dp))
                                    .background(Green.copy(alpha = 0.1f))
                                    .padding(horizontal = 6.dp, vertical = 2.dp),
                            )
                        }
                        if (inbox.isDottedGmailAlias) {
                            Text(
                                text = "🔵 فرع نقطي",
                                color = Color(0xFF1D4ED8),
                                fontSize = 9.sp,
                                fontWeight = FontWeight.Bold,
                                modifier = Modifier
                                    .clip(RoundedCornerShape(6.dp))
                                    .background(Color(0xFFDBEAFE))
                                    .padding(horizontal = 6.dp, vertical = 2.dp),
                            )
                        } else if (inbox.isRealGmail || inbox.domain == "gmail.com") {
                            Text(
                                text = "📧 Gmail",
                                color = Color(0xFFDC2626),
                                fontSize = 9.sp,
                                fontWeight = FontWeight.Bold,
                                modifier = Modifier
                                    .clip(RoundedCornerShape(6.dp))
                                    .background(Color(0xFFFEE2E2))
                                    .padding(horizontal = 6.dp, vertical = 2.dp),
                            )
                        }
                    }
                }

                Surface(
                    shape = RoundedCornerShape(10.dp),
                    color = SurfaceSoft,
                ) {
                    Text(
                        text = "${arabicNumber(inbox.messageCount)} رسائل",
                        color = Muted,
                        fontSize = 10.sp,
                        fontWeight = FontWeight.Bold,
                        modifier = Modifier.padding(horizontal = 7.dp, vertical = 3.dp),
                    )
                }
            }

            // 2. Full Width Email Banner (Fully visible without truncation!)
            SelectionContainer {
                Surface(
                    modifier = Modifier.fillMaxWidth(),
                    shape = RoundedCornerShape(10.dp),
                    color = SurfaceSoft,
                    border = BorderStroke(0.5.dp, CardBorderSubtle),
                ) {
                    Text(
                        text = inbox.email,
                        modifier = Modifier.padding(horizontal = 10.dp, vertical = 6.dp),
                        color = Ink,
                        style = MaterialTheme.typography.bodySmall,
                        fontWeight = FontWeight.SemiBold,
                        fontSize = 12.sp,
                        softWrap = true,
                    )
                }
            }

            if (inbox.isDottedGmailAlias && inbox.parentEmail.isNotBlank()) {
                Text(
                    text = "مرتبط بالحساب المضيف: ${inbox.parentEmail}",
                    color = Muted,
                    fontSize = 11.sp,
                    modifier = Modifier.padding(horizontal = 4.dp),
                )
            }

            // 3. Suspected Ban Prompt if needed
            if (inbox.isSuspected && onConfirmBan != null && onMarkSafe != null) {
                BanConfirmationBox(
                    reason = inbox.banReason,
                    onConfirmBan = onConfirmBan,
                    onMarkSafe = onMarkSafe,
                    onAiVerify = onAiVerify,
                )
            }

            // 4. Action Row at Bottom
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                OutlinedButton(
                    onClick = onCopyEmail,
                    shape = RoundedCornerShape(10.dp),
                    contentPadding = PaddingValues(horizontal = 10.dp, vertical = 2.dp),
                    modifier = Modifier.height(30.dp),
                    border = BorderStroke(1.dp, CardBorderSubtle),
                ) {
                    Icon(Icons.Rounded.ContentCopy, contentDescription = null, tint = Muted, modifier = Modifier.size(13.dp))
                    Spacer(Modifier.width(4.dp))
                    Text("نسخ البريد", fontSize = 11.sp, color = Ink)
                }

                IconButton(onClick = { confirmDelete = true }, modifier = Modifier.size(34.dp)) {
                    Icon(Icons.Rounded.DeleteOutline, contentDescription = "استبعاد الحساب", tint = BannedRed, modifier = Modifier.size(18.dp))
                }

                Button(
                    onClick = onViewMessages,
                    shape = RoundedCornerShape(10.dp),
                    contentPadding = PaddingValues(horizontal = 12.dp, vertical = 2.dp),
                    modifier = Modifier.height(30.dp),
                    colors = ButtonDefaults.buttonColors(containerColor = accent),
                ) {
                    Icon(Icons.Rounded.MailOutline, contentDescription = null, modifier = Modifier.size(13.dp))
                    Spacer(Modifier.width(4.dp))
                    Text("عرض الرسائل", fontSize = 11.sp, fontWeight = FontWeight.Bold)
                }
            }
        }
    }
    if (confirmDelete) {
        AlertDialog(
            onDismissRequest = { confirmDelete = false },
            title = { Text("استبعاد حساب أمازون؟") },
            text = { Text("سيُحذف ${inbox.email} ورسائله من العرض، وسيبقى قابلاً للاستعادة من تبويب المستبعدة.") },
            confirmButton = {
                Button(
                    onClick = { confirmDelete = false; onDelete() },
                    colors = ButtonDefaults.buttonColors(containerColor = BannedRed),
                ) { Text("استبعاد") }
            },
            dismissButton = { TextButton(onClick = { confirmDelete = false }) { Text("إلغاء") } },
        )
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
                    if (message.isBanned) Icons.Rounded.Block else Icons.Rounded.AlternateEmail,
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
                ),
                state.messageFilter.ordinal.coerceAtMost(1),
            ) {
                val filters = listOf(MessageFilter.CURRENT, MessageFilter.OFFICIAL)
                viewModel.setMessageFilter(filters[it])
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
                        AmazonMark(Modifier.size(29.dp), foreground = Color(0xFFD97706))
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
                            "أمازون",
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
private fun LogsScreen(state: MailUiState, viewModel: MailViewModel) {
    val clipboard = LocalClipboardManager.current
    val context = LocalContext.current
    val query = state.search.trim()
    val logs = state.logs.asReversed().filter { query.isBlank() || listOf(it.personName, it.mobile, it.realEmail, it.receiptNumber, it.city).any { value -> value.contains(query, true) } }
    val winning = state.winningMessages.filter { query.isBlank() || listOf(it.subject, it.from, it.to, it.intro, it.text).any { value -> value.contains(query, true) } }
    LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(start = 18.dp, end = 18.dp, top = 12.dp, bottom = 112.dp)) {
        item {
            Text("السجل الذكي", color = Primary, style = MaterialTheme.typography.labelMedium)
            Text(if (state.logsTab == LogsTab.CAMPAIGNS) "تسجيلات الحملة" else "المسابقات والفوز", style = MaterialTheme.typography.headlineLarge)
            Text(
                if (state.logsTab == LogsTab.CAMPAIGNS) "${arabicNumber(state.logs.size)} عملية مكتملة" else "${arabicNumber(state.winningMessages.size)} رسالة فوز",
                color = Muted,
                style = MaterialTheme.typography.bodyMedium,
            )
            Spacer(Modifier.height(12.dp))
            MailPills(
                labels = listOf("تسجيلات الحملة  ${arabicNumber(state.logs.size)}", "المسابقات والفوز  ${arabicNumber(state.winningMessages.size)}"),
                selected = state.logsTab.ordinal,
            ) { viewModel.setLogsTab(LogsTab.entries[it]) }
            Spacer(Modifier.height(12.dp))
            SearchField(state.search, if (state.logsTab == LogsTab.CAMPAIGNS) "ابحث بالاسم أو الجوال أو الفاتورة" else "ابحث في رسائل الفوز", viewModel::setSearch)
            Spacer(Modifier.height(10.dp))
        }
        if (state.logsTab == LogsTab.CAMPAIGNS) {
            if (logs.isEmpty()) item { EmptyList("لا توجد تسجيلات", "ستظهر العمليات المكتملة في هذا السجل.") }
            else items(logs, key = { "${it.index}_${it.registeredAt}" }) { LogRow(it) }
        } else {
            if (winning.isEmpty()) item { EmptyList("لا توجد رسائل فوز", "ستظهر رسائل المسابقات والجوائز هنا فور وصولها.") }
            else items(winning, key = { it.id }) { message ->
                MessageRow(
                    message = message,
                    onClick = { viewModel.openMessage(message) },
                    onCopyOtp = { otp ->
                        clipboard.setText(AnnotatedString(otp))
                        android.widget.Toast.makeText(context, "تم نسخ الرمز", android.widget.Toast.LENGTH_SHORT).show()
                    },
                )
            }
        }
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
    val context = LocalContext.current
    LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(18.dp, 12.dp, 18.dp, 112.dp)) {
        item {
            Text("تفضيلاتك", color = Primary, style = MaterialTheme.typography.labelMedium)
            Text("الإعدادات", style = MaterialTheme.typography.headlineLarge)
            Spacer(Modifier.height(16.dp))
            AppVersionCard(state, viewModel)
            Spacer(Modifier.height(14.dp))
            GmailAccountsCard(state, viewModel)
            Spacer(Modifier.height(14.dp))
            StorageManagementCard(state, viewModel)
            Spacer(Modifier.height(14.dp))
            SettingsCard(state, viewModel)
            Spacer(Modifier.height(20.dp))
            OutlinedButton(onClick = { context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse("https://batabitoo-mail-2026.web.app"))) }, modifier = Modifier.fillMaxWidth().height(52.dp), shape = RoundedCornerShape(17.dp)) { Icon(Icons.Rounded.OpenInBrowser, null); Spacer(Modifier.width(8.dp)); Text("فتح نسخة الويب") }
            Spacer(Modifier.height(9.dp))
            OutlinedButton(
                onClick = { viewModel.refreshAll() },
                modifier = Modifier.fillMaxWidth().height(52.dp),
                shape = RoundedCornerShape(17.dp),
                border = BorderStroke(1.dp, Danger.copy(alpha = .35f)),
                colors = ButtonDefaults.outlinedButtonColors(contentColor = Danger),
            ) {
                Icon(Icons.Rounded.Refresh, null, modifier = Modifier.size(18.dp))
                Spacer(Modifier.width(8.dp))
                Text("إعادة الاتصال بالسحابة")
            }
        }
    }
}

@Composable
private fun GmailAccountsCard(state: MailUiState, viewModel: MailViewModel) {
    Card(
        colors = CardDefaults.cardColors(containerColor = Surface),
        elevation = CardDefaults.cardElevation(2.dp),
        shape = RoundedCornerShape(22.dp),
        border = BorderStroke(1.dp, CardBorderSubtle),
    ) {
        Column(Modifier.fillMaxWidth().padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Box(Modifier.size(44.dp).clip(RoundedCornerShape(14.dp)).background(Color(0xFFFEE2E2)), contentAlignment = Alignment.Center) {
                    Icon(Icons.Rounded.MailOutline, null, tint = Color(0xFFEA4335))
                }
                Spacer(Modifier.width(12.dp))
                Column(Modifier.weight(1f)) {
                    Text("حسابات Gmail المتصلة", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
                    Text("${arabicNumber(state.gmailAccounts.size)} حساب عبر Google OAuth", color = Muted, style = MaterialTheme.typography.bodySmall)
                }
                Button(
                    onClick = viewModel::startGmailOAuth,
                    enabled = !state.gmailConnecting,
                    shape = RoundedCornerShape(13.dp),
                    contentPadding = PaddingValues(horizontal = 12.dp, vertical = 8.dp),
                ) { Text(if (state.gmailConnecting) "جارٍ الفتح…" else "ربط حساب") }
            }
            if (state.gmailAccounts.isEmpty()) {
                Text("لا يوجد حساب متصل. استخدم ربط Google لضمان وصول الرسائل والمزامنة التلقائية.", color = Muted, style = MaterialTheme.typography.bodySmall)
            } else {
                state.gmailAccounts.forEach { account ->
                    Surface(shape = RoundedCornerShape(14.dp), color = SurfaceSoft) {
                        Row(
                            Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 10.dp),
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(8.dp),
                        ) {
                            Box(Modifier.size(9.dp).clip(CircleShape).background(if (account.status.equals("error", true)) Danger else Green))
                            Column(Modifier.weight(1f)) {
                                Text(account.email, fontWeight = FontWeight.Bold, maxLines = 1, overflow = TextOverflow.Ellipsis)
                                Text(
                                    account.lastError.ifBlank { if (account.lastSyncAt.isBlank()) "متصل وجاهز للمزامنة" else "آخر مزامنة: ${formatDate(account.lastSyncAt)}" },
                                    color = if (account.lastError.isBlank()) Muted else Danger,
                                    style = MaterialTheme.typography.labelSmall,
                                    maxLines = 1,
                                    overflow = TextOverflow.Ellipsis,
                                )
                            }
                            IconButton(onClick = { viewModel.syncGmail(account.email) }, enabled = state.gmailBusyEmail != account.email) {
                                if (state.gmailBusyEmail == account.email) CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp)
                                else Icon(Icons.Rounded.Refresh, "مزامنة", tint = Primary)
                            }
                            TextButton(onClick = { viewModel.disconnectGmail(account.email) }, enabled = state.gmailBusyEmail != account.email) {
                                Text("فصل", color = Danger)
                            }
                        }
                    }
                }
            }
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
    var downloading by androidx.compose.runtime.remember { androidx.compose.runtime.mutableStateOf(false) }
    var progress by androidx.compose.runtime.remember { androidx.compose.runtime.mutableStateOf(0f) }
    val coroutineScope = androidx.compose.runtime.rememberCoroutineScope()

    AlertDialog(
        onDismissRequest = {
            if (!update.mandatory && !downloading) onDismiss()
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
                if (downloading) {
                    Text(
                        "جاري تنزيل التحديث... ${ (progress * 100).toInt() }%",
                        color = Primary,
                        fontSize = 12.sp,
                        fontWeight = FontWeight.Bold,
                        textAlign = TextAlign.Center,
                        modifier = Modifier.fillMaxWidth(),
                    )
                    Spacer(Modifier.height(8.dp))
                    androidx.compose.material3.LinearProgressIndicator(
                        progress = { progress },
                        modifier = Modifier.fillMaxWidth().height(6.dp).clip(RoundedCornerShape(3.dp)),
                        color = Primary,
                        trackColor = SurfaceSoft,
                    )
                } else {
                    Text(
                        "انقر على الزر أدناه لتنزيل التحديث وتثبيته مباشرة.",
                        color = Muted,
                        fontSize = 11.sp,
                        textAlign = TextAlign.Center,
                        modifier = Modifier.fillMaxWidth(),
                    )
                }
            }
        },
        confirmButton = {
            Button(
                onClick = {
                    if (downloading) return@Button
                    if (update.downloadUrl.isNotBlank()) {
                        downloading = true
                        progress = 0f
                        coroutineScope.launch(kotlinx.coroutines.Dispatchers.IO) {
                            try {
                                val file = java.io.File(context.externalCacheDir ?: context.cacheDir, "update_v${update.latestVersionCode}.apk")
                                com.batabitoo.mailcenter.data.UpdateDownload.download(update.downloadUrl, update.sha256, file) { progress = it }

                                val uri = androidx.core.content.FileProvider.getUriForFile(context, "${context.packageName}.fileprovider", file)
                                val intent = Intent(Intent.ACTION_VIEW).apply {
                                    setDataAndType(uri, "application/vnd.android.package-archive")
                                    flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_GRANT_READ_URI_PERMISSION
                                }
                                kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.Main) {
                                    context.startActivity(intent)
                                    downloading = false
                                    if (!update.mandatory) onDismiss()
                                }
                            } catch (e: Exception) {
                                kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.Main) {
                                    android.widget.Toast.makeText(context, "فشل التحميل: ${e.message}", android.widget.Toast.LENGTH_LONG).show()
                                    downloading = false
                                }
                            }
                        }
                    }
                },
                modifier = Modifier.fillMaxWidth(),
                shape = RoundedCornerShape(14.dp),
                colors = ButtonDefaults.buttonColors(containerColor = if (downloading) Muted else Color(0xFFEA580C)),
                enabled = !downloading
            ) {
                Icon(Icons.Rounded.Download, null, modifier = Modifier.size(18.dp))
                Spacer(Modifier.width(6.dp))
                Text(if (downloading) "جاري التحميل..." else "تنزيل وتثبيت الآن (v${update.latestVersionName})")
            }
        },
        dismissButton = if (!update.mandatory && !downloading) {
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
            SettingsRow(Icons.Rounded.Storage, "المشروع السحابي", state.projectId.ifBlank { "Firebase Cloud" }, Primary)
            HorizontalDivider(Modifier.padding(vertical = 13.dp), color = Color(0xFFE8EBF2))
            Row(verticalAlignment = Alignment.CenterVertically) {
                Icon(Icons.Rounded.Refresh, null, tint = Gold, modifier = Modifier.size(26.dp)); Spacer(Modifier.width(12.dp))
                Column(Modifier.weight(1f)) { Text("التحديث الفوري", style = MaterialTheme.typography.titleMedium); Text("وصول مباشر عبر قناة الأحداث السحابية SSE", color = Muted, style = MaterialTheme.typography.bodyMedium) }
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
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                ChoiceCard(
                    title = "بريد رسمي",
                    subtitle = "@batabitoo.com",
                    icon = Icons.Rounded.WorkspacePremium,
                    color = Gold,
                    selected = state.createOfficial && state.createDomain == "batabitoo.com",
                    modifier = Modifier.weight(1f)
                ) { viewModel.setCreateType(true, "batabitoo.com") }

                ChoiceCard(
                    title = "حساب Gmail",
                    subtitle = if (state.gmailConnecting) "جاري فتح Google…" else "ربط Google OAuth",
                    icon = Icons.Rounded.MailOutline,
                    color = Color(0xFFEA4335),
                    selected = false,
                    modifier = Modifier.weight(1f)
                ) {
                    viewModel.setCreateVisible(false)
                    viewModel.startGmailOAuth()
                }
            }
            if (state.createOfficial && state.createDomain == "batabitoo.com") {
                Spacer(Modifier.height(10.dp))
                val nextSequential = viewModel.getNextSequentialPrefix("ahmedroou")
                androidx.compose.material3.Surface(
                    modifier = Modifier
                        .fillMaxWidth()
                        .clip(RoundedCornerShape(14.dp))
                        .clickable {
                            viewModel.setCreateType(true, "batabitoo.com")
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
                                    maxLines = 1,
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
            }
            Spacer(Modifier.height(12.dp))
            OutlinedTextField(value = name, onValueChange = { name = it }, modifier = Modifier.fillMaxWidth(), label = { Text("اسم الحساب") }, placeholder = { Text("مثال: حساب أمازون") }, singleLine = true, shape = RoundedCornerShape(17.dp))
            Spacer(Modifier.height(10.dp))
            OutlinedTextField(
                value = prefix,
                onValueChange = { prefix = it.filter { char -> char.isLetterOrDigit() || char == '.' || char == '@' }.lowercase() },
                modifier = Modifier.fillMaxWidth(),
                label = { Text("عنوان البريد") },
                supportingText = {
                    Text(
                        if (state.createDomain == "gmail.com") "سيُضاف @gmail.com تلقائيًا أو أدخل البريد كاملاً"
                        else "سيُضاف @batabitoo.com تلقائيًا"
                    )
                },
                singleLine = true,
                shape = RoundedCornerShape(17.dp)
            )
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

@Composable
private fun CompactSubChip(
    label: String,
    count: Int,
    selected: Boolean,
    onClick: () -> Unit,
) {
    Surface(
        modifier = Modifier
            .clip(RoundedCornerShape(20.dp))
            .clickable(onClick = onClick),
        shape = RoundedCornerShape(20.dp),
        color = if (selected) Ink else Surface,
        border = BorderStroke(1.dp, if (selected) Ink else CardBorderSubtle),
    ) {
        Row(
            modifier = Modifier.padding(horizontal = 10.dp, vertical = 5.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(5.dp),
        ) {
            Text(
                text = label,
                fontSize = 11.sp,
                fontWeight = if (selected) FontWeight.Bold else FontWeight.Medium,
                color = if (selected) Color.White else Ink,
            )
            Surface(
                shape = CircleShape,
                color = if (selected) Color.White.copy(alpha = 0.22f) else SurfaceSoft,
            ) {
                Text(
                    text = arabicNumber(count),
                    modifier = Modifier.padding(horizontal = 6.dp, vertical = 1.dp),
                    fontSize = 10.sp,
                    fontWeight = FontWeight.Bold,
                    color = if (selected) Color.White else Muted,
                )
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun DottedGmailDialog(state: MailUiState, viewModel: MailViewModel) {
    val existingGmails = remember(state.gmailAccounts, state.officialInboxes) {
        val connected = state.gmailAccounts
            .filterNot { it.status.equals("disconnected", true) || it.status.equals("error", true) }
            .map { it.email }
        (connected + state.officialInboxes
            .filter { it.gmailAuthType.isNotBlank() && !it.isDottedGmailAlias }
            .map { it.parentEmail.ifBlank { it.email } })
            .distinct()
    }
    var parentEmail by rememberSaveable {
        mutableStateOf(existingGmails.firstOrNull().orEmpty())
    }
    var selectedVariant by rememberSaveable { mutableStateOf("") }
    var label by rememberSaveable { mutableStateOf("") }
    val variants = remember(parentEmail) {
        viewModel.generateDottedVariants(parentEmail)
    }

    LaunchedEffect(variants) {
        if (selectedVariant.isBlank() || !variants.contains(selectedVariant)) {
            selectedVariant = variants.firstOrNull().orEmpty()
        }
    }

    ModalBottomSheet(
        onDismissRequest = { viewModel.setShowDottedDialog(false) },
        sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true),
        containerColor = Surface,
        shape = RoundedCornerShape(topStart = 28.dp, topEnd = 28.dp),
    ) {
        Column(
            Modifier
                .fillMaxWidth()
                .imePadding()
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 20.dp, vertical = 8.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                Box(
                    modifier = Modifier
                        .size(36.dp)
                        .clip(CircleShape)
                        .background(Color(0xFF2563EB).copy(alpha = 0.12f)),
                    contentAlignment = Alignment.Center,
                ) {
                    Text("🔵", fontSize = 16.sp)
                }
                Column {
                    Text("تفريع نقطي لحساب أمازون على Gmail", fontWeight = FontWeight.Bold, style = MaterialTheme.typography.titleMedium)
                    Text("توليد وتخصيص حساب أمازون مستقل ببريد نقطي", color = Muted, style = MaterialTheme.typography.bodySmall)
                }
            }

            Text(
                "يتيح لك نظام Gmail استقبال كل الرسائل على نفس الحساب الأساسي مع تمييز كامل لحساب أمازون من حيث الحظر والطلبات والرموز.",
                color = Ink.copy(alpha = 0.8f),
                style = MaterialTheme.typography.bodySmall,
                lineHeight = 18.sp,
            )

            if (existingGmails.isNotEmpty()) {
                Text("اختر الحساب المضيف الأساسي:", fontWeight = FontWeight.Bold, fontSize = 12.sp)
                Row(
                    modifier = Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()),
                    horizontalArrangement = Arrangement.spacedBy(6.dp),
                ) {
                    existingGmails.forEach { gm ->
                        Surface(
                            modifier = Modifier
                                .clip(RoundedCornerShape(12.dp))
                                .clickable { parentEmail = gm },
                            shape = RoundedCornerShape(12.dp),
                            color = if (parentEmail.equals(gm, true)) Color(0xFF2563EB) else SurfaceSoft,
                        ) {
                            Text(
                                gm,
                                modifier = Modifier.padding(horizontal = 10.dp, vertical = 6.dp),
                                color = if (parentEmail.equals(gm, true)) Color.White else Ink,
                                fontSize = 11.sp,
                                fontWeight = FontWeight.SemiBold,
                            )
                        }
                    }
                }
            } else {
                Card(
                    colors = CardDefaults.cardColors(containerColor = PrimaryLight),
                    border = BorderStroke(1.dp, Primary.copy(alpha = .25f)),
                    shape = RoundedCornerShape(16.dp),
                ) {
                    Column(Modifier.fillMaxWidth().padding(14.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        Text("اربط حساب Gmail أولاً", fontWeight = FontWeight.Bold, color = Ink)
                        Text("لا يمكن إنشاء تفريع نقطي موثوق دون حساب Google متصل فعلياً.", color = Muted, style = MaterialTheme.typography.bodySmall)
                        Button(onClick = { viewModel.setShowDottedDialog(false); viewModel.startGmailOAuth() }, modifier = Modifier.fillMaxWidth(), shape = RoundedCornerShape(13.dp)) {
                            Icon(Icons.Rounded.MailOutline, null); Spacer(Modifier.width(7.dp)); Text("ربط حساب Google")
                        }
                    }
                }
            }

            OutlinedTextField(
                value = parentEmail,
                onValueChange = { parentEmail = it.trim().lowercase() },
                modifier = Modifier.fillMaxWidth(),
                label = { Text("عنوان Gmail الأصلي") },
                placeholder = { Text("example@gmail.com") },
                singleLine = true,
                enabled = existingGmails.isNotEmpty(),
                shape = RoundedCornerShape(14.dp),
            )

            if (variants.isNotEmpty()) {
                Text("التفريعات النقطية المقترحة (انقر للاختيار):", fontWeight = FontWeight.Bold, fontSize = 12.sp)
                Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    variants.take(6).forEach { variant ->
                        Surface(
                            modifier = Modifier
                                .fillMaxWidth()
                                .clip(RoundedCornerShape(12.dp))
                                .clickable { selectedVariant = variant },
                            shape = RoundedCornerShape(12.dp),
                            color = if (selectedVariant == variant) Color(0xFF2563EB).copy(alpha = 0.12f) else SurfaceSoft,
                            border = BorderStroke(1.dp, if (selectedVariant == variant) Color(0xFF2563EB) else CardBorderSubtle),
                        ) {
                            Row(
                                modifier = Modifier.padding(horizontal = 12.dp, vertical = 9.dp),
                                verticalAlignment = Alignment.CenterVertically,
                                horizontalArrangement = Arrangement.SpaceBetween,
                            ) {
                                Text(
                                    variant,
                                    color = if (selectedVariant == variant) Color(0xFF1D4ED8) else Ink,
                                    fontWeight = if (selectedVariant == variant) FontWeight.Bold else FontWeight.Medium,
                                    fontSize = 13.sp,
                                )
                                if (selectedVariant == variant) {
                                    Icon(Icons.Rounded.CheckCircle, contentDescription = null, tint = Color(0xFF2563EB), modifier = Modifier.size(18.dp))
                                }
                            }
                        }
                    }
                }
            }

            OutlinedTextField(
                value = selectedVariant,
                onValueChange = { selectedVariant = it.trim().lowercase() },
                modifier = Modifier.fillMaxWidth(),
                label = { Text("البريد النقطي المعتمد") },
                singleLine = true,
                shape = RoundedCornerShape(14.dp),
            )

            OutlinedTextField(
                value = label,
                onValueChange = { label = it },
                modifier = Modifier.fillMaxWidth(),
                label = { Text("تسمية الحساب (اختياري)") },
                placeholder = { Text("مثال: حساب أمازون رقم 2") },
                singleLine = true,
                shape = RoundedCornerShape(14.dp),
            )

            Button(
                onClick = {
                    if (selectedVariant.isNotBlank() && selectedVariant.contains("@gmail.com")) {
                        viewModel.createDottedGmail(parentEmail, selectedVariant, label)
                    }
                },
                modifier = Modifier.fillMaxWidth().height(48.dp),
                shape = RoundedCornerShape(14.dp),
                colors = ButtonDefaults.buttonColors(
                    containerColor = Color(0xFF2563EB),
                    contentColor = Color.White,
                ),
                enabled = existingGmails.isNotEmpty() && parentEmail.isNotBlank() && selectedVariant.isNotBlank() && !state.refreshing,
            ) {
                if (state.refreshing) {
                    CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp, color = Color.White)
                } else {
                    Text("اعتماد الحساب في مركز أمازون", fontWeight = FontWeight.Bold, fontSize = 13.sp)
                }
            }
            Spacer(Modifier.height(16.dp))
        }
    }
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
private fun AdaptiveNavigationRail(
    selected: MainSection,
    expanded: Boolean,
    onSelect: (MainSection) -> Unit,
    onCreate: () -> Unit,
) {
    val railWidth = if (expanded) 214.dp else 82.dp
    Surface(
        modifier = Modifier.width(railWidth).fillMaxHeight(),
        color = NebulaNight,
        shadowElevation = 8.dp,
    ) {
        Column(
            modifier = Modifier.fillMaxSize().padding(horizontal = if (expanded) 12.dp else 8.dp, vertical = 14.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Box(
                Modifier
                    .size(if (expanded) 52.dp else 46.dp)
                    .clip(RoundedCornerShape(16.dp))
                    .background(Brush.linearGradient(listOf(Violet, Primary, Cyan))),
                contentAlignment = Alignment.Center,
            ) {
                Icon(Icons.Rounded.MailOutline, null, tint = Color.White, modifier = Modifier.size(25.dp))
            }
            if (expanded) {
                Spacer(Modifier.height(9.dp))
                Text("Mail Nebula", color = Color.White, fontWeight = FontWeight.ExtraBold)
                Text("مركز بريد بطابيطو", color = Color.White.copy(alpha = .58f), fontSize = 10.sp)
            }
            Spacer(Modifier.height(22.dp))
            RailDestination(MainSection.INBOXES, "الصناديق", Icons.Rounded.Inbox, selected, expanded, onSelect)
            RailDestination(MainSection.AMAZON, "أمازون", Icons.Rounded.AlternateEmail, selected, expanded, onSelect, AmazonOrange)
            RailDestination(MainSection.MESSAGES, "الرسائل", Icons.Rounded.MailOutline, selected, expanded, onSelect)
            RailDestination(MainSection.LOGS, "السجل", Icons.Rounded.ReceiptLong, selected, expanded, onSelect)
            RailDestination(MainSection.SETTINGS, "الإعدادات", Icons.Rounded.Settings, selected, expanded, onSelect)
            Spacer(Modifier.weight(1f))
            Button(
                onClick = onCreate,
                modifier = Modifier.fillMaxWidth().height(50.dp),
                shape = RoundedCornerShape(16.dp),
                contentPadding = PaddingValues(horizontal = 10.dp),
                colors = ButtonDefaults.buttonColors(containerColor = Primary, contentColor = Color.White),
            ) {
                Icon(Icons.Rounded.Add, null, modifier = Modifier.size(21.dp))
                if (expanded) {
                    Spacer(Modifier.width(8.dp))
                    Text("صندوق جديد", fontWeight = FontWeight.Bold)
                }
            }
        }
    }
}

@Composable
private fun RailDestination(
    section: MainSection,
    label: String,
    icon: androidx.compose.ui.graphics.vector.ImageVector,
    selected: MainSection,
    expanded: Boolean,
    onSelect: (MainSection) -> Unit,
    activeColor: Color = Color(0xFFAAA5FF),
) {
    val active = section == selected
    val tint = if (active) activeColor else Color.White.copy(alpha = .62f)
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(vertical = 3.dp)
            .height(52.dp)
            .clip(RoundedCornerShape(15.dp))
            .background(if (active) tint.copy(alpha = .15f) else Color.Transparent)
            .clickable { onSelect(section) }
            .padding(horizontal = if (expanded) 14.dp else 0.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = if (expanded) Arrangement.Start else Arrangement.Center,
    ) {
        if (section == MainSection.AMAZON) {
            AmazonMark(Modifier.size(25.dp), foreground = tint, accent = activeColor)
        } else {
            Icon(icon, label, tint = tint, modifier = Modifier.size(23.dp))
        }
        if (expanded) {
            Spacer(Modifier.width(12.dp))
            Text(label, color = tint, fontWeight = if (active) FontWeight.Bold else FontWeight.Medium)
        }
    }
}

@Composable
private fun BottomDock(selected: MainSection, onSelect: (MainSection) -> Unit, onCreate: () -> Unit) {
    Box(Modifier.fillMaxWidth().navigationBarsPadding().padding(horizontal = 10.dp, vertical = 6.dp).height(74.dp)) {
        Card(
            Modifier.fillMaxWidth().height(68.dp).align(Alignment.BottomCenter),
            colors = CardDefaults.cardColors(containerColor = NebulaNight),
            elevation = CardDefaults.cardElevation(12.dp),
            shape = RoundedCornerShape(23.dp)
        ) {
            Row(Modifier.fillMaxSize().padding(horizontal = 4.dp), verticalAlignment = Alignment.CenterVertically) {
                NavItem(MainSection.INBOXES, "الرئيسية", Icons.Rounded.Inbox, selected, onSelect, Modifier.weight(1f))
                NavItem(MainSection.AMAZON, "أمازون", Icons.Rounded.AlternateEmail, selected, onSelect, Modifier.weight(1f), activeColor = Color(0xFFFF9900))
                Box(Modifier.weight(0.9f), contentAlignment = Alignment.Center) {
                    FloatingActionButton(
                        onClick = onCreate,
                        modifier = Modifier.size(48.dp),
                        containerColor = Color(0xFF75E8DC),
                        contentColor = NebulaNight,
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
    val tint = if (isSelected) (if (section == MainSection.AMAZON) activeColor else Color(0xFF75E8DC)) else Color.White.copy(alpha = .65f)
    Column(
        modifier
            .fillMaxHeight()
            .clip(RoundedCornerShape(16.dp))
            .clickable { onSelect(section) }
            .background(if (isSelected) tint.copy(alpha = .13f) else Color.Transparent),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center
    ) {
        if (section == MainSection.AMAZON) {
            AmazonMark(Modifier.size(24.dp), foreground = tint, accent = activeColor)
        } else {
            Icon(icon, label, tint = tint, modifier = Modifier.size(22.dp))
        }
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
