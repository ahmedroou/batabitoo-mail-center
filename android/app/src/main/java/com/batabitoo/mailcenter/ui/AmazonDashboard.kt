package com.batabitoo.mailcenter.ui

import androidx.compose.animation.animateColorAsState
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextDirection
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.batabitoo.mailcenter.*
import com.batabitoo.mailcenter.data.Inbox
import com.batabitoo.mailcenter.data.MailMessage

private val AmazonGraphite = Color(0xFF18212D)
private val AmazonAmber = Color(0xFFFFC267)
private val AmazonQuiet = Color(0xFF647184)
private val AmazonLine = Color(0xFFE5E9EF)
private val AmazonPaper = Color(0xFFF5F7FA)
private val AmazonGood = Color(0xFF14785B)
private val AmazonAlert = Color(0xFF9A5800)
private val AmazonDanger = Color(0xFFB83449)

@Composable
internal fun AmazonDashboard(state: MailUiState, viewModel: MailViewModel) {
    val clipboard = LocalClipboardManager.current
    val context = LocalContext.current
    val accounts = state.amazonInboxes
    val suspected = accounts.filter { it.isSuspected }
    val banned = accounts.filter { it.isConfirmedBanned }
    val healthy = accounts.filter { !it.isSuspected && !it.isConfirmedBanned }
    val messages = state.amazonMessages
    val known = state.dataLoaded && state.dataError == null
    val query = state.search.trim()
    val messageTab = state.amazonTab in listOf(AmazonTab.MESSAGES, AmazonTab.OTP, AmazonTab.ORDERS)
    fun copy(value: String) {
        clipboard.setText(AnnotatedString(value))
        android.widget.Toast.makeText(context, "تم النسخ", android.widget.Toast.LENGTH_SHORT).show()
    }
    Box(Modifier.fillMaxSize().background(AmazonPaper), contentAlignment = Alignment.TopCenter) {
        LazyColumn(
            Modifier.widthIn(max = 1040.dp).fillMaxSize(),
            contentPadding = PaddingValues(start = 16.dp, end = 16.dp, top = 10.dp, bottom = 110.dp),
            verticalArrangement = Arrangement.spacedBy(14.dp),
        ) {
            item {
                AmazonDashboardHeader(
                    busy = state.refreshing || state.loading,
                    onRefresh = { viewModel.refreshAll() },
                    onCreate = viewModel::createSequentialInbox,
                    onDotted = { viewModel.setShowDottedDialog(true) },
                )
            }
            item {
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    AmazonMetric("الحسابات", if (known) accounts.size.toString() else "—", AmazonGraphite, Modifier.weight(1f))
                    AmazonMetric("قيد المراجعة", if (known) suspected.size.toString() else "—", AmazonAlert, Modifier.weight(1f))
                    AmazonMetric("الرسائل", if (known) messages.size.toString() else "—", AmazonGood, Modifier.weight(1f))
                }
            }
            if (state.loading || state.dataError != null || state.refreshing) {
                item {
                    Surface(color = Color.White, shape = RoundedCornerShape(18.dp), border = BorderStroke(1.dp, AmazonLine)) {
                        Row(Modifier.fillMaxWidth().padding(14.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                            if (state.loading || state.refreshing) CircularProgressIndicator(Modifier.size(22.dp), color = AmazonAlert, strokeWidth = 2.dp)
                            else Icon(Icons.Rounded.CloudOff, null, tint = AmazonDanger)
                            Column(Modifier.weight(1f)) {
                                Text(if (state.loading || state.refreshing) "جارٍ مزامنة مركز أمازون" else "تعذر تحديث البيانات", color = AmazonGraphite, fontWeight = FontWeight.Bold)
                                Text(if (state.loading || state.refreshing) "ستظهر الأعداد بعد وصول البيانات من السحابة" else "${state.dataError}\nالبيانات المعروضة قد تكون غير محدثة.", style = MaterialTheme.typography.bodySmall, color = AmazonQuiet)
                            }
                            if (!state.loading && !state.refreshing) IconButton(onClick = { viewModel.refreshAll() }, modifier = Modifier.size(48.dp)) { Icon(Icons.Rounded.Refresh, "إعادة المحاولة", tint = AmazonGraphite) }
                        }
                    }
                }
            }
            item {
                Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    Text("مساحة الحسابات", color = AmazonGraphite, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.ExtraBold)
                    Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        listOf(Triple(AmazonTab.ALL, "الكل", accounts.size), Triple(AmazonTab.SUSPECTED, "المراجعة", suspected.size), Triple(AmazonTab.HEALTHY, "السليمة", healthy.size), Triple(AmazonTab.BANNED, "المحظورة", banned.size), Triple(AmazonTab.DELETED, "المستبعدة", state.deletedAmazonAccounts.size)).forEach { (tab, label, count) ->
                            AmazonSelector(label, if (known) count.toString() else "—", state.amazonTab == tab) { viewModel.setAmazonTab(tab) }
                        }
                    }
                    Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        listOf(Triple(AmazonTab.MESSAGES, "كل الرسائل", messages.size), Triple(AmazonTab.OTP, "رموز التحقق", messages.count { it.otp.isNotBlank() }), Triple(AmazonTab.ORDERS, "الطلبات والشحن", messages.count(::isAmazonOrderMessage))).forEach { (tab, label, count) ->
                            AmazonSelector(label, if (known) count.toString() else "—", state.amazonTab == tab) { viewModel.setAmazonTab(tab) }
                        }
                    }
                    OutlinedTextField(
                        value = state.search, onValueChange = viewModel::setSearch,
                        modifier = Modifier.fillMaxWidth(), singleLine = true,
                        placeholder = { Text(if (messageTab) "ابحث في الرسائل أو رموز التحقق" else "ابحث بالاسم أو البريد") },
                        leadingIcon = { Icon(Icons.Rounded.Search, null) },
                        shape = RoundedCornerShape(18.dp),
                        colors = OutlinedTextFieldDefaults.colors(unfocusedContainerColor = Color.White, focusedContainerColor = Color.White, unfocusedBorderColor = AmazonLine, focusedBorderColor = AmazonAlert),
                    )
                    if (!messageTab && state.amazonTab != AmazonTab.DELETED) {
                        Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                            listOf(AmazonDomainFilter.ALL to "كل النطاقات", AmazonDomainFilter.BATABITOO to "batabitoo.com", AmazonDomainFilter.GMAIL to "Gmail والنقاط").forEach { (filter, title) ->
                                FilterChip(selected = state.amazonDomainFilter == filter, onClick = { viewModel.setAmazonDomainFilter(filter) }, label = { Text(title) }, modifier = Modifier.heightIn(min = 48.dp), colors = FilterChipDefaults.filterChipColors(selectedContainerColor = Color(0xFFFFE8C4), selectedLabelColor = AmazonGraphite))
                            }
                        }
                    }
                }
            }
            if (messageTab) {
                val visible = messages.filter { message ->
                    (state.amazonTab != AmazonTab.OTP || message.otp.isNotBlank()) &&
                        (state.amazonTab != AmazonTab.ORDERS || isAmazonOrderMessage(message)) &&
                        (query.isBlank() || listOf(message.subject, message.from, message.to, message.text, message.intro, message.otp, message.inboxEmail).any { it.contains(query, true) })
                }
                if (visible.isEmpty() && known) item { AmazonEmptyState("لا توجد رسائل مطابقة", "رسائل أمازون ورموز التحقق والطلبات تظهر هنا عند وصولها.") }
                items(visible, key = { it.id }) { message -> AmazonMailCard(message, { viewModel.openMessage(message) }, { copy(message.otp) }) }
            } else if (state.amazonTab == AmazonTab.DELETED) {
                val visible = state.deletedAmazonAccounts.filter { query.isBlank() || it.email.contains(query, true) }
                if (visible.isEmpty() && known) item { AmazonEmptyState("المستبعدة فارغة", "يمكنك استعادة الحسابات التي استبعدتها من هذه المساحة.") }
                items(visible, key = { it.email }) { account ->
                    Surface(shape = RoundedCornerShape(22.dp), color = Color.White, border = BorderStroke(1.dp, AmazonLine)) {
                        Column(Modifier.fillMaxWidth().padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                            Text(account.email, style = MaterialTheme.typography.bodyMedium.copy(textDirection = TextDirection.Ltr), color = AmazonGraphite, fontWeight = FontWeight.Bold)
                            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                                Text("مستبعد من أمازون", Modifier.weight(1f), color = AmazonQuiet)
                                OutlinedButton(onClick = { viewModel.restoreAmazonAccount(account) }, enabled = !state.refreshing, modifier = Modifier.heightIn(min = 48.dp), shape = RoundedCornerShape(14.dp)) { Icon(Icons.Rounded.Refresh, null, Modifier.size(18.dp)); Spacer(Modifier.width(6.dp)); Text("استعادة") }
                            }
                        }
                    }
                }
            } else {
                val visible = when (state.amazonTab) { AmazonTab.SUSPECTED -> suspected; AmazonTab.BANNED -> banned; AmazonTab.HEALTHY -> healthy; else -> accounts }.filter { inbox ->
                    (when (state.amazonDomainFilter) { AmazonDomainFilter.ALL -> true; AmazonDomainFilter.BATABITOO -> inbox.isBatabitooDomain; AmazonDomainFilter.GMAIL -> inbox.isGmailDomain }) &&
                        (query.isBlank() || listOf(inbox.email, inbox.personName, inbox.label, inbox.banReason).any { it.contains(query, true) })
                }
                if (visible.isEmpty() && known) item { AmazonEmptyState("لا توجد حسابات مطابقة", "اختر تصنيفًا آخر أو جرّب البحث باسم الحساب أو بريده.") }
                items(visible, key = { it.id }) { inbox ->
                    AmazonIdentityCard(inbox, !state.refreshing, { copy(inbox.email) }, { viewModel.selectInbox(inbox); viewModel.setSection(MainSection.MESSAGES) }, { viewModel.updateBanStatus(inbox, "confirmed") }, { viewModel.updateBanStatus(inbox, "safe") }, { viewModel.triggerAiVerify(inbox) }, { viewModel.deleteAmazonAccount(inbox) })
                }
            }
        }
    }
}

@Composable
private fun AmazonDashboardHeader(busy: Boolean, onRefresh: () -> Unit, onCreate: () -> Unit, onDotted: () -> Unit) {
    Surface(shape = RoundedCornerShape(28.dp), color = AmazonGraphite) {
        Column(Modifier.fillMaxWidth().background(Brush.linearGradient(listOf(AmazonGraphite, Color(0xFF2A3949)))).padding(20.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(5.dp)) {
                    Text("AMAZON / SPACE", color = AmazonAmber, style = MaterialTheme.typography.labelMedium, letterSpacing = 2.sp)
                    Text("كل حساب. في مكانه.", color = Color.White, style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.ExtraBold)
                    Text("حساباتك، رسائلك، والخطوة التالية", color = Color(0xFFC4CDD8), style = MaterialTheme.typography.bodySmall)
                }
                AmazonParcelArtwork(Modifier.size(78.dp))
            }
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                Button(onClick = onCreate, enabled = !busy, modifier = Modifier.weight(1f).heightIn(min = 48.dp), shape = RoundedCornerShape(15.dp), contentPadding = PaddingValues(horizontal = 10.dp), colors = ButtonDefaults.buttonColors(containerColor = AmazonAmber, contentColor = AmazonGraphite)) { Icon(Icons.Rounded.Add, null, Modifier.size(19.dp)); Spacer(Modifier.width(4.dp)); Text("حساب جديد", fontWeight = FontWeight.Bold) }
                OutlinedButton(onClick = onDotted, enabled = !busy, modifier = Modifier.weight(1f).heightIn(min = 48.dp), shape = RoundedCornerShape(15.dp), contentPadding = PaddingValues(horizontal = 8.dp), border = BorderStroke(1.dp, Color(0xFF657181)), colors = ButtonDefaults.outlinedButtonColors(contentColor = Color.White)) { Text("نقاط Gmail") }
                IconButton(onClick = onRefresh, enabled = !busy, modifier = Modifier.size(48.dp).clip(RoundedCornerShape(15.dp)).background(Color.White.copy(alpha = .08f))) { Icon(Icons.Rounded.Refresh, "تحديث أمازون", tint = AmazonAmber) }
            }
        }
    }
}

@Composable
private fun AmazonParcelArtwork(modifier: Modifier) {
    Canvas(modifier) {
        val w = size.width
        val h = size.height
        drawCircle(AmazonAmber.copy(alpha = .06f), w * .48f)
        drawOval(Color.Black.copy(alpha = .16f), Offset(w * .15f, h * .80f), Size(w * .70f, h * .12f))
        fun face(color: Color, vararg points: Pair<Float, Float>) {
            drawPath(Path().apply { moveTo(points[0].first * w, points[0].second * h); points.drop(1).forEach { lineTo(it.first * w, it.second * h) }; close() }, color)
        }
        face(Color(0xFFFFD79B), .17f to .33f, .50f to .15f, .84f to .33f, .50f to .52f)
        face(Color(0xFFEAA145), .17f to .33f, .50f to .52f, .50f to .86f, .17f to .66f)
        face(Color(0xFFFFBE66), .50f to .52f, .84f to .33f, .84f to .66f, .50f to .86f)
        drawLine(Color(0xFFFFE9C9), Offset(w * .34f, h * .24f), Offset(w * .68f, h * .42f), w * .08f)
        drawArc(AmazonGraphite, 20f, 120f, false, Offset(w * .55f, h * .47f), Size(w * .24f, h * .22f), style = Stroke(w * .025f))
        drawCircle(AmazonAmber, w * .035f, Offset(w * .90f, h * .17f))
        drawCircle(Color.White.copy(alpha = .6f), w * .02f, Offset(w * .13f, h * .15f))
    }
}

@Composable
private fun AmazonMetric(label: String, value: String, accent: Color, modifier: Modifier) {
    Surface(modifier, shape = RoundedCornerShape(20.dp), color = Color.White, border = BorderStroke(1.dp, AmazonLine)) {
        Column(Modifier.padding(horizontal = 12.dp, vertical = 14.dp), verticalArrangement = Arrangement.spacedBy(5.dp)) {
            Box(Modifier.width(20.dp).height(3.dp).clip(RoundedCornerShape(2.dp)).background(accent))
            Text(value, color = AmazonGraphite, fontWeight = FontWeight.ExtraBold, style = MaterialTheme.typography.headlineMedium)
            Text(label, color = AmazonQuiet, style = MaterialTheme.typography.labelMedium, maxLines = 2)
        }
    }
}

@Composable
private fun AmazonSelector(label: String, count: String, selected: Boolean, onClick: () -> Unit) {
    val background by animateColorAsState(if (selected) AmazonGraphite else Color.White, label = "amazonTab")
    Surface(onClick = onClick, color = background, shape = RoundedCornerShape(14.dp), border = BorderStroke(1.dp, if (selected) AmazonGraphite else AmazonLine)) {
        Row(Modifier.heightIn(min = 48.dp).padding(horizontal = 13.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Text(label, color = if (selected) Color.White else AmazonQuiet, style = MaterialTheme.typography.labelLarge, fontWeight = FontWeight.SemiBold)
            Text(count, color = if (selected) AmazonAmber else AmazonQuiet, fontWeight = FontWeight.Bold, style = MaterialTheme.typography.labelMedium)
        }
    }
}

@Composable
private fun AmazonIdentityCard(inbox: Inbox, enabled: Boolean, onCopy: () -> Unit, onOpen: () -> Unit, onBan: () -> Unit, onSafe: () -> Unit, onVerify: () -> Unit, onDelete: () -> Unit) {
    var confirmDelete by remember(inbox.id) { mutableStateOf(false) }
    val accent = when { inbox.isConfirmedBanned -> AmazonDanger; inbox.isSuspected -> AmazonAlert; else -> AmazonGood }
    val status = when { inbox.isConfirmedBanned -> "محظور"; inbox.isSuspected -> "بحاجة للمراجعة"; else -> "سليم" }
    Surface(shape = RoundedCornerShape(24.dp), color = Color.White, border = BorderStroke(1.dp, AmazonLine)) {
        Column(Modifier.fillMaxWidth().padding(16.dp), verticalArrangement = Arrangement.spacedBy(13.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                Box(Modifier.size(48.dp).clip(RoundedCornerShape(16.dp)).background(AmazonGraphite), contentAlignment = Alignment.Center) { AmazonMark(Modifier.size(30.dp), foreground = Color.White, accent = AmazonAmber) }
                Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
                    Text(inbox.personName.ifBlank { inbox.label.ifBlank { "حساب أمازون" } }, color = AmazonGraphite, fontWeight = FontWeight.Bold, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    Text(when { inbox.isDottedGmailAlias -> "Gmail • عنوان نقطي"; inbox.isGmailDomain -> "Gmail"; else -> "batabitoo.com" }, color = AmazonQuiet, style = MaterialTheme.typography.labelSmall)
                }
                Surface(color = accent.copy(alpha = .09f), shape = RoundedCornerShape(10.dp)) { Text(status, Modifier.padding(horizontal = 9.dp, vertical = 6.dp), color = accent, style = MaterialTheme.typography.labelSmall, fontWeight = FontWeight.Bold) }
            }
            Surface(color = AmazonPaper, shape = RoundedCornerShape(14.dp)) {
                Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                    Text(inbox.email, Modifier.weight(1f).padding(start = 12.dp, top = 10.dp, bottom = 10.dp), color = AmazonGraphite, style = MaterialTheme.typography.bodyMedium.copy(textDirection = TextDirection.Ltr), softWrap = true)
                    IconButton(onClick = onCopy, modifier = Modifier.size(48.dp)) { Icon(Icons.Rounded.ContentCopy, "نسخ البريد", Modifier.size(18.dp), tint = AmazonQuiet) }
                }
            }
            if (inbox.isDottedGmailAlias && inbox.parentEmail.isNotBlank()) Text("مرتبط بـ ${inbox.parentEmail}", color = AmazonQuiet, style = MaterialTheme.typography.bodySmall)
            if (inbox.isSuspected) {
                Surface(color = Color(0xFFFFF5E7), shape = RoundedCornerShape(16.dp)) {
                    Column(Modifier.fillMaxWidth().padding(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        Text(inbox.banReason.ifBlank { "ورد إشعار يحتاج إلى مراجعتك لتحديد حالة الحساب." }, color = AmazonAlert, style = MaterialTheme.typography.bodySmall)
                        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            OutlinedButton(onClick = onSafe, enabled = enabled, modifier = Modifier.weight(1f).heightIn(min = 48.dp), contentPadding = PaddingValues(horizontal = 6.dp), shape = RoundedCornerShape(12.dp)) { Text("الحساب سليم", color = AmazonGood) }
                            OutlinedButton(onClick = onBan, enabled = enabled, modifier = Modifier.weight(1f).heightIn(min = 48.dp), contentPadding = PaddingValues(horizontal = 6.dp), shape = RoundedCornerShape(12.dp)) { Text("تأكيد الحظر", color = AmazonDanger) }
                        }
                        TextButton(onClick = onVerify, enabled = enabled, modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp)) { Icon(Icons.Rounded.Bolt, null, Modifier.size(18.dp), tint = AmazonAlert); Spacer(Modifier.width(6.dp)); Text("تحليل الإشعار بالذكاء الاصطناعي", color = AmazonAlert) }
                    }
                }
            } else if (inbox.isConfirmedBanned && inbox.banReason.isNotBlank()) Text(inbox.banReason, color = AmazonDanger, style = MaterialTheme.typography.bodySmall)
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(10.dp), verticalAlignment = Alignment.CenterVertically) {
                Button(onClick = onOpen, modifier = Modifier.weight(1f).heightIn(min = 48.dp), shape = RoundedCornerShape(14.dp), colors = ButtonDefaults.buttonColors(containerColor = AmazonGraphite)) { Icon(Icons.Rounded.MailOutline, null, Modifier.size(18.dp)); Spacer(Modifier.width(8.dp)); Text("فتح البريد · ${inbox.messageCount}", fontWeight = FontWeight.Bold) }
                IconButton(onClick = { confirmDelete = true }, enabled = enabled, modifier = Modifier.size(48.dp).clip(RoundedCornerShape(14.dp)).background(AmazonPaper)) { Icon(Icons.Rounded.DeleteOutline, "استبعاد الحساب", tint = AmazonQuiet) }
            }
        }
    }
    if (confirmDelete) AlertDialog(onDismissRequest = { confirmDelete = false }, title = { Text("استبعاد الحساب؟") }, text = { Text("سيُستبعد ${inbox.email} من مركز أمازون. يمكنك استعادته من تبويب المستبعدة.") }, confirmButton = { TextButton(onClick = { confirmDelete = false; onDelete() }) { Text("استبعاد", color = AmazonDanger) } }, dismissButton = { TextButton(onClick = { confirmDelete = false }) { Text("إلغاء") } })
}

@Composable
private fun AmazonMailCard(message: MailMessage, onOpen: () -> Unit, onCopy: () -> Unit) {
    Surface(onClick = onOpen, shape = RoundedCornerShape(22.dp), color = Color.White, border = BorderStroke(1.dp, AmazonLine)) {
        Column(Modifier.fillMaxWidth().padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                Icon(if (message.isBanned) Icons.Rounded.Warning else Icons.Rounded.MailOutline, null, tint = if (message.isBanned) AmazonDanger else AmazonAlert)
                Text(message.subject.ifBlank { "رسالة من أمازون" }, Modifier.weight(1f), color = AmazonGraphite, fontWeight = FontWeight.Bold, maxLines = 2, overflow = TextOverflow.Ellipsis)
            }
            Text(message.inboxEmail.ifBlank { message.to }, style = MaterialTheme.typography.bodySmall.copy(textDirection = TextDirection.Ltr), color = AmazonQuiet, maxLines = 2, overflow = TextOverflow.Ellipsis)
            if (message.intro.isNotBlank()) Text(message.intro, color = AmazonQuiet, style = MaterialTheme.typography.bodySmall, maxLines = 2, overflow = TextOverflow.Ellipsis)
            if (message.isBanned) Text(message.banReason.ifBlank { "إشعار متعلق بحالة الحساب" }, color = AmazonDanger, style = MaterialTheme.typography.labelMedium)
            if (message.otp.isNotBlank()) OutlinedButton(onClick = onCopy, modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp), shape = RoundedCornerShape(14.dp), colors = ButtonDefaults.outlinedButtonColors(containerColor = Color(0xFFFFF5E7), contentColor = AmazonGraphite), border = BorderStroke(1.dp, Color(0xFFF2D6AB))) { Icon(Icons.Rounded.Key, null, Modifier.size(18.dp)); Spacer(Modifier.width(8.dp)); Text("نسخ رمز التحقق  ${message.otp}", fontWeight = FontWeight.Bold) }
        }
    }
}

@Composable
private fun AmazonEmptyState(title: String, body: String) {
    Column(Modifier.fillMaxWidth().padding(vertical = 30.dp, horizontal = 20.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(10.dp)) {
        AmazonParcelArtwork(Modifier.size(88.dp))
        Text(title, color = AmazonGraphite, fontWeight = FontWeight.Bold)
        Text(body, color = AmazonQuiet, style = MaterialTheme.typography.bodySmall, textAlign = androidx.compose.ui.text.style.TextAlign.Center)
    }
}

private fun isAmazonOrderMessage(message: MailMessage): Boolean {
    val text = "${message.subject} ${message.intro} ${message.text}".lowercase()
    return listOf("order", "shipment", "shipped", "delivery", "delivered", "tracking", "طلب", "شحن", "التوصيل", "تم التسليم", "تتبع").any(text::contains)
}
