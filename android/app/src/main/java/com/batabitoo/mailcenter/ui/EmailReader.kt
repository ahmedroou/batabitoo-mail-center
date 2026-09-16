package com.batabitoo.mailcenter.ui

import android.content.Intent
import android.content.res.Configuration
import android.net.Uri
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Toast
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.foundation.verticalScroll
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
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import com.batabitoo.mailcenter.data.MailMessage
import com.batabitoo.mailcenter.ui.theme.*
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Locale

@Composable
fun EmailReader(message: MailMessage, baseUrl: String, loading: Boolean, error: String?, onRetry: () -> Unit, onDismiss: () -> Unit) {
    val context = LocalContext.current
    val clipboard = LocalClipboardManager.current
    var expanded by rememberSaveable(message.id) { mutableStateOf(false) }
    val landscape = LocalConfiguration.current.orientation == Configuration.ORIENTATION_LANDSCAPE
    fun copy(value: String) {
        clipboard.setText(AnnotatedString(value))
        Toast.makeText(context, "تم النسخ", Toast.LENGTH_SHORT).show()
    }
    val openLink: (String) -> Unit = { url ->
        val uri = Uri.parse(url)
        if (uri.scheme?.lowercase() in setOf("http", "https", "mailto", "tel")) {
            runCatching { context.startActivity(Intent(Intent.ACTION_VIEW, uri)) }.onFailure { Toast.makeText(context, "لا يوجد تطبيق مناسب لفتح الرابط", Toast.LENGTH_SHORT).show() }
        }
    }
    Dialog(onDismissRequest = onDismiss, properties = DialogProperties(usePlatformDefaultWidth = false, decorFitsSystemWindows = false)) {
        Surface(Modifier.fillMaxSize(), color = com.batabitoo.mailcenter.ui.theme.Canvas) {
            Box(Modifier.fillMaxSize().windowInsetsPadding(WindowInsets.safeDrawing), contentAlignment = Alignment.TopCenter) {
                Column(Modifier.widthIn(max = 1080.dp).fillMaxSize()) {
                    Row(Modifier.fillMaxWidth().height(58.dp).padding(horizontal = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                        IconButton(onClick = onDismiss) { Icon(Icons.AutoMirrored.Rounded.ArrowBack, "الرجوع للرسائل", tint = Primary) }
                        Text("قراءة الرسالة", style = MaterialTheme.typography.titleMedium, modifier = Modifier.weight(1f))
                        IconButton(onClick = { copy(message.text) }, enabled = !loading && message.text.isNotBlank()) { Icon(Icons.Rounded.ContentCopy, "نسخ نص الرسالة") }
                        IconButton(onClick = onRetry, enabled = !loading) { Icon(Icons.Rounded.Refresh, "إعادة تحميل الرسالة") }
                    }
                    Column(Modifier.fillMaxWidth().heightIn(max = if (landscape) 130.dp else 300.dp).verticalScroll(rememberScrollState()).background(Color.White).padding(horizontal = 20.dp, vertical = 16.dp)) {
                        SelectionContainer { Text(message.subject.ifBlank { "بدون عنوان" }, style = MaterialTheme.typography.titleLarge, lineHeight = 29.sp) }
                        if (message.isBanned) {
                            Spacer(Modifier.height(8.dp))
                            Row(
                                Modifier.fillMaxWidth().clip(RoundedCornerShape(10.dp)).background(BannedLight).padding(horizontal = 10.dp, vertical = 6.dp),
                                verticalAlignment = Alignment.CenterVertically,
                                horizontalArrangement = Arrangement.spacedBy(6.dp),
                            ) {
                                Icon(Icons.Rounded.Block, null, tint = BannedRed, modifier = Modifier.size(16.dp))
                                Text(
                                    "حساب/رسالة محظورة: ${message.banReason.ifBlank { "مقتصر على المشتريات الرقمية أو مغلق" }}",
                                    color = BannedRed,
                                    fontSize = 12.sp,
                                    fontWeight = FontWeight.Bold,
                                )
                            }
                        }
                        Row(Modifier.fillMaxWidth().clip(RoundedCornerShape(12.dp)).clickable { expanded = !expanded }.padding(vertical = 12.dp), verticalAlignment = Alignment.CenterVertically) {
                            Box(Modifier.size(38.dp).clip(RoundedCornerShape(13.dp)).background(if (message.isBanned) BannedLight else Primary.copy(alpha = .09f)), contentAlignment = Alignment.Center) {
                                Icon(if (message.isBanned) Icons.Rounded.Block else Icons.Rounded.MailOutline, null, tint = if (message.isBanned) BannedRed else Primary, modifier = Modifier.size(20.dp))
                            }
                            Spacer(Modifier.width(10.dp))
                            Column(Modifier.weight(1f)) {
                                Text(message.from.ifBlank { "مرسل غير معروف" }, style = MaterialTheme.typography.bodyMedium, maxLines = 1, overflow = TextOverflow.Ellipsis)
                                Text(if (expanded) "إخفاء التفاصيل" else "عرض تفاصيل الرسالة", color = Muted, fontSize = 11.sp)
                            }
                            Icon(if (expanded) Icons.Rounded.ExpandLess else Icons.Rounded.ExpandMore, "تفاصيل الرسالة", tint = Muted)
                        }
                        AnimatedVisibility(expanded) {
                            Column(verticalArrangement = Arrangement.spacedBy(9.dp)) {
                                EnvelopeField("من", message.from)
                                EnvelopeField("إلى", message.to.ifBlank { message.inboxEmail })
                                EnvelopeField("التاريخ", readerDate(message.createdAt))
                            }
                        }
                        if (!loading && message.otp.isNotBlank()) {
                            Row(Modifier.fillMaxWidth().clip(RoundedCornerShape(15.dp)).background(Green.copy(alpha = .1f)).clickable { copy(message.otp) }.padding(12.dp), verticalAlignment = Alignment.CenterVertically) {
                                Column(Modifier.weight(1f)) { Text("رمز التحقق", color = Green, fontSize = 11.sp); Text(message.otp, fontSize = 25.sp, fontWeight = FontWeight.Bold, letterSpacing = 3.sp, color = Color(0xFF087855)) }
                                Icon(Icons.Rounded.ContentCopy, "نسخ الرمز", tint = Green)
                            }
                        }
                    }
                    val attachments = message.attachments.filter { !it.inline }
                    if (!loading && attachments.isNotEmpty()) {
                        Row(Modifier.fillMaxWidth().background(Color.White).horizontalScroll(rememberScrollState()).padding(horizontal = 16.dp, vertical = 8.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            attachments.forEach { attachment ->
                                OutlinedButton(onClick = { openLink("${baseUrl.trimEnd('/')}/api/messages/${Uri.encode(message.id)}/attachments/${Uri.encode(attachment.id)}") }, shape = RoundedCornerShape(14.dp)) {
                                    Icon(Icons.Rounded.FileDownload, null, Modifier.size(18.dp)); Spacer(Modifier.width(6.dp)); Text(attachment.filename, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.widthIn(max = 180.dp))
                                }
                            }
                        }
                    }
                    HorizontalDivider(color = Color(0xFFE9ECF3))
                    Box(Modifier.fillMaxWidth().weight(1f).background(Color.White), contentAlignment = Alignment.Center) {
                        when {
                            loading -> Column(horizontalAlignment = Alignment.CenterHorizontally) { CircularProgressIndicator(Modifier.size(30.dp), color = Primary); Spacer(Modifier.height(12.dp)); Text("جاري فتح الرسالة…", color = Muted) }
                            error != null -> Column(Modifier.padding(24.dp), horizontalAlignment = Alignment.CenterHorizontally) { Text(error, color = Muted); Spacer(Modifier.height(14.dp)); Button(onClick = onRetry) { Text("إعادة المحاولة") } }
                            else -> MailDocument(message.html.ifBlank { fallbackDocument(message.text) }, openLink)
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun EnvelopeField(label: String, value: String) {
    Column { Text(label, color = Muted, fontSize = 11.sp); SelectionContainer { Text(value.ifBlank { "—" }, style = MaterialTheme.typography.bodyMedium) } }
}

@Composable
private fun MailDocument(content: String, openLink: (String) -> Unit) {
    AndroidView(
        factory = { context -> WebView(context).apply {
            setBackgroundColor(android.graphics.Color.WHITE)
            settings.javaScriptEnabled = false
            settings.domStorageEnabled = false
            settings.allowFileAccess = false
            settings.allowContentAccess = false
            settings.loadsImagesAutomatically = true
            settings.useWideViewPort = true
            settings.loadWithOverviewMode = true
            settings.setSupportZoom(true)
            settings.builtInZoomControls = true
            settings.displayZoomControls = false
            webViewClient = object : WebViewClient() {
                override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean { if (request.isForMainFrame) openLink(request.url.toString()); return true }
                @Suppress("DEPRECATION")
                override fun shouldOverrideUrlLoading(view: WebView, url: String): Boolean { openLink(url); return true }
            }
            setDownloadListener { url, _, _, _, _ -> openLink(url) }
        } },
        update = { view -> if (view.tag != content) { view.tag = content; view.loadDataWithBaseURL(null, content, "text/html", "UTF-8", null) } },
        onRelease = { view -> view.stopLoading(); view.destroy() },
        modifier = Modifier.fillMaxSize(),
    )
}

private fun fallbackDocument(text: String): String {
    val safe = text.ifBlank { "لم يتوفر محتوى الرسالة من المصدر." }.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
    return "<!doctype html><html dir=\"auto\"><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"><body style=\"margin:0;padding:20px;font:16px/1.8 sans-serif;white-space:pre-wrap;overflow-wrap:anywhere\">$safe</body></html>"
}
private fun readerDate(value: String): String = runCatching { DateTimeFormatter.ofPattern("d MMM yyyy، h:mm a", Locale.forLanguageTag("ar-SA")).format(Instant.parse(value).atZone(ZoneId.systemDefault())) }.getOrDefault(value)
