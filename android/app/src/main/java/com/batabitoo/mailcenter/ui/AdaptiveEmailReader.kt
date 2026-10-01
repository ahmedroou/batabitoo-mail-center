package com.batabitoo.mailcenter.ui

import android.content.Intent
import android.net.Uri
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Toast
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.animateContentSize
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.ArrowBack
import androidx.compose.material.icons.rounded.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
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
import androidx.lifecycle.DefaultLifecycleObserver
import androidx.lifecycle.LifecycleOwner
import androidx.lifecycle.compose.LocalLifecycleOwner
import com.batabitoo.mailcenter.data.ContentSanitizer
import com.batabitoo.mailcenter.data.MailMessage
import com.batabitoo.mailcenter.data.MailAttachment
import com.batabitoo.mailcenter.data.MailRepository
import com.batabitoo.mailcenter.ui.theme.*
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Locale
import java.net.HttpURLConnection
import java.net.URL
import java.io.ByteArrayInputStream

@Composable
fun EmailReader(
    message: MailMessage,
    baseUrl: String,
    loading: Boolean,
    error: String?,
    onRetry: () -> Unit,
    onDismiss: () -> Unit,
    onPrevious: (() -> Unit)? = null,
    onNext: (() -> Unit)? = null,
    onOpenAttachment: ((MailAttachment) -> Unit)? = null,
    onReply: (() -> Unit)? = null,
) {
    val context = LocalContext.current
    val clipboard = LocalClipboardManager.current
    val wide = LocalConfiguration.current.screenWidthDp >= 840
    var detailsExpanded by rememberSaveable(message.id) { mutableStateOf(false) }
    val decodedText = remember(message.text) { ContentSanitizer.decodeBase64Text(message.text) }

    fun copy(value: String, messageText: String) {
        clipboard.setText(AnnotatedString(value))
        Toast.makeText(context, messageText, Toast.LENGTH_SHORT).show()
    }

    val openLink: (String) -> Unit = { value ->
        val uri = Uri.parse(value)
        if (uri.scheme?.lowercase() in setOf("http", "https", "mailto", "tel")) {
            runCatching { context.startActivity(Intent(Intent.ACTION_VIEW, uri)) }
                .onFailure { Toast.makeText(context, "لا يوجد تطبيق مناسب لفتح الرابط", Toast.LENGTH_SHORT).show() }
        }
    }

    Dialog(
        onDismissRequest = onDismiss,
        properties = DialogProperties(usePlatformDefaultWidth = false, decorFitsSystemWindows = false),
    ) {
        Box(
            Modifier.fillMaxSize()
                .background(Brush.linearGradient(listOf(NebulaNight, NebulaBlue, Primary)))
                .windowInsetsPadding(WindowInsets.statusBars)
                .windowInsetsPadding(WindowInsets.navigationBars)
                .padding(if (wide) 24.dp else 0.dp),
            contentAlignment = Alignment.Center,
        ) {
            Surface(
                modifier = if (wide) Modifier.fillMaxHeight().widthIn(max = 1180.dp) else Modifier.fillMaxSize(),
                shape = if (wide) RoundedCornerShape(28.dp) else RoundedCornerShape(0.dp),
                color = Color.White,
                shadowElevation = if (wide) 18.dp else 0.dp,
            ) {
                Column(Modifier.fillMaxSize()) {
                    ReaderToolbar(
                        loading = loading,
                        canCopy = decodedText.isNotBlank(),
                        onDismiss = onDismiss,
                        onCopy = { copy(decodedText, "تم نسخ نص الرسالة") },
                        onRetry = onRetry,
                        onPrevious = onPrevious,
                        onNext = onNext,
                    )
                    HorizontalDivider(color = Color(0xFFF0F1F6))
                    if (onReply != null) {
                        TextButton(onClick = onReply, enabled = !loading, modifier = Modifier.align(Alignment.End).padding(horizontal = 12.dp)) {
                            Icon(Icons.Rounded.Reply, contentDescription = null, modifier = Modifier.size(18.dp))
                            Spacer(Modifier.width(6.dp))
                            Text("الرد من نفس حساب البريد")
                        }
                    }
                    if (wide) {
                        Row(Modifier.fillMaxSize()) {
                            ReaderOverview(
                                message, baseUrl, detailsExpanded,
                                { detailsExpanded = !detailsExpanded },
                                { copy(message.otp, "تم نسخ رمز التحقق") },
                                openLink, loading, onOpenAttachment,
                                Modifier.width(370.dp).fillMaxHeight().verticalScroll(rememberScrollState()),
                            )
                            Box(Modifier.width(1.dp).fillMaxHeight().background(Color(0xFFE8EAF2)))
                            ReaderBody(message, baseUrl, loading, error, onRetry, openLink, Modifier.weight(1f).fillMaxHeight())
                        }
                    } else {
                        Column(Modifier.fillMaxSize()) {
                            ReaderOverview(
                                message, baseUrl, detailsExpanded,
                                { detailsExpanded = !detailsExpanded },
                                { copy(message.otp, "تم نسخ رمز التحقق") },
                                openLink, loading, onOpenAttachment, Modifier.fillMaxWidth(),
                            )
                            HorizontalDivider(color = Color(0xFFE8EAF2))
                            ReaderBody(message, baseUrl, loading, error, onRetry, openLink, Modifier.weight(1f).fillMaxWidth())
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun ReaderToolbar(
    loading: Boolean,
    canCopy: Boolean,
    onDismiss: () -> Unit,
    onCopy: () -> Unit,
    onRetry: () -> Unit,
    onPrevious: (() -> Unit)?,
    onNext: (() -> Unit)?,
) {
    Row(Modifier.fillMaxWidth().height(58.dp).padding(horizontal = 5.dp), verticalAlignment = Alignment.CenterVertically) {
        IconButton(onClick = onDismiss) { Icon(Icons.AutoMirrored.Rounded.ArrowBack, "الرجوع", tint = Ink) }
        Column(Modifier.weight(1f)) {
            Text("قارئ الرسائل", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold, color = Ink)
            Text("Mail Nebula", color = Primary, fontSize = 10.sp, fontWeight = FontWeight.Bold)
        }
        if (canCopy) IconButton(onClick = onCopy) { Icon(Icons.Rounded.ContentCopy, "نسخ النص", tint = Muted, modifier = Modifier.size(20.dp)) }
        if (onPrevious != null) IconButton(onClick = onPrevious) { Icon(Icons.Rounded.KeyboardArrowUp, "الرسالة السابقة", tint = Muted) }
        if (onNext != null) IconButton(onClick = onNext) { Icon(Icons.Rounded.KeyboardArrowDown, "الرسالة التالية", tint = Muted) }
        IconButton(onClick = onRetry, enabled = !loading) {
            if (loading) CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp, color = Primary)
            else Icon(Icons.Rounded.Refresh, "تحديث", tint = Primary, modifier = Modifier.size(21.dp))
        }
    }
}

@Composable
private fun ReaderOverview(
    message: MailMessage,
    baseUrl: String,
    detailsExpanded: Boolean,
    onToggleDetails: () -> Unit,
    onCopyOtp: () -> Unit,
    openLink: (String) -> Unit,
    loading: Boolean,
    onOpenAttachment: ((MailAttachment) -> Unit)?,
    modifier: Modifier,
) {
    Column(modifier.animateContentSize().padding(horizontal = 18.dp, vertical = 16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        SelectionContainer { Text(message.subject.ifBlank { "(بدون عنوان)" }, style = MaterialTheme.typography.titleLarge, color = Ink) }
        if (message.isBanned) {
            Row(
                Modifier.fillMaxWidth().clip(RoundedCornerShape(13.dp)).background(BannedLight).padding(12.dp, 9.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                Icon(Icons.Rounded.Block, null, tint = BannedRed, modifier = Modifier.size(18.dp))
                Text("تنبيه الحساب: ${message.banReason.ifBlank { "الحساب مقيد" }}", color = BannedRed, fontSize = 12.sp, fontWeight = FontWeight.Bold)
            }
        }
        if (message.bodyStatus.equals("unavailable", ignoreCase = true)) {
            Row(
                Modifier.fillMaxWidth().clip(RoundedCornerShape(13.dp)).background(Color(0xFFFFF7ED)).padding(12.dp, 9.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                Icon(Icons.Rounded.Warning, null, tint = Color(0xFFC2410C), modifier = Modifier.size(18.dp))
                Text("المحتوى الكامل غير متاح من المصدر؛ نعرض الملخص المحفوظ فقط.", color = Color(0xFF9A3412), fontSize = 12.sp)
            }
        }
        Row(verticalAlignment = Alignment.CenterVertically) {
            Box(
                Modifier.size(44.dp).clip(RoundedCornerShape(15.dp)).background(if (message.isAmazon) AmazonWarm else PrimaryLight),
                contentAlignment = Alignment.Center,
            ) {
                if (message.isAmazon) AmazonMark(Modifier.size(31.dp))
                else Text(message.from.take(1).ifBlank { "@" }.uppercase(), color = Primary, fontWeight = FontWeight.Black)
            }
            Spacer(Modifier.width(11.dp))
            Column(Modifier.weight(1f)) {
                Text(message.from.ifBlank { "مرسل غير معروف" }, fontWeight = FontWeight.Bold, color = Ink, maxLines = 1, overflow = TextOverflow.Ellipsis)
                Text(adaptiveReaderDate(message.createdAt), fontSize = 11.sp, color = Muted)
            }
        }
        Row(
            Modifier.fillMaxWidth().clip(RoundedCornerShape(10.dp)).clickable(onClick = onToggleDetails)
                .background(SurfaceSoft).padding(horizontal = 10.dp, vertical = 7.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text("إلى: ${message.inboxEmail.ifBlank { message.to }}", color = Muted, fontSize = 11.sp, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f))
            Icon(if (detailsExpanded) Icons.Rounded.ExpandLess else Icons.Rounded.ExpandMore, null, tint = Muted, modifier = Modifier.size(16.dp))
        }
        AnimatedVisibility(detailsExpanded) {
            Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(13.dp)).background(Color(0xFFF8F9FD)).padding(12.dp), verticalArrangement = Arrangement.spacedBy(7.dp)) {
                ReaderDetail("من", message.from)
                ReaderDetail("إلى", message.to.ifBlank { message.inboxEmail })
                ReaderDetail("التاريخ", adaptiveReaderDate(message.createdAt, true))
                ReaderDetail("الأمان", "تشفير قياسي (TLS)")
            }
        }
        if (message.otp.isNotBlank()) {
            Row(
                Modifier.fillMaxWidth().clip(RoundedCornerShape(15.dp))
                    .background(Brush.horizontalGradient(listOf(Color(0xFFECFDF5), Color(0xFFD9FBEA))))
                    .clickable(onClick = onCopyOtp).padding(13.dp, 11.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Icon(Icons.Rounded.VpnKey, null, tint = Green, modifier = Modifier.size(21.dp)); Spacer(Modifier.width(10.dp))
                Column(Modifier.weight(1f)) {
                    Text("رمز التحقق", color = Color(0xFF047857), fontSize = 10.sp, fontWeight = FontWeight.Bold)
                    Text(message.otp, color = Color(0xFF065F46), fontSize = 21.sp, fontWeight = FontWeight.Black, letterSpacing = 3.sp)
                }
                Icon(Icons.Rounded.ContentCopy, "نسخ", tint = Color(0xFF047857), modifier = Modifier.size(18.dp))
            }
        }
        val attachments = message.attachments.filter { !it.inline }
        if (!loading && attachments.isNotEmpty()) {
            Text("المرفقات", color = Muted, fontSize = 11.sp, fontWeight = FontWeight.Bold)
            Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                attachments.forEach { attachment ->
                    OutlinedButton(
                        onClick = {
                            if (onOpenAttachment != null) onOpenAttachment(attachment)
                            else openLink("${baseUrl.trimEnd('/')}/api/messages/${Uri.encode(message.id)}/attachments/${Uri.encode(attachment.id)}")
                        },
                        shape = RoundedCornerShape(11.dp),
                        contentPadding = PaddingValues(horizontal = 10.dp, vertical = 6.dp),
                    ) {
                        Icon(Icons.Rounded.FileDownload, null, Modifier.size(16.dp)); Spacer(Modifier.width(6.dp))
                        Text(attachment.filename, maxLines = 1, overflow = TextOverflow.Ellipsis, fontSize = 11.sp, modifier = Modifier.widthIn(max = 170.dp))
                    }
                }
            }
        }
    }
}

@Composable
private fun ReaderDetail(label: String, value: String) {
    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.Top) {
        Text("$label:", color = Muted, fontSize = 11.sp, modifier = Modifier.width(48.dp))
        SelectionContainer(Modifier.weight(1f)) { Text(value.ifBlank { "—" }, color = Ink, fontSize = 12.sp) }
    }
}

@Composable
private fun ReaderBody(
    message: MailMessage,
    baseUrl: String,
    loading: Boolean,
    error: String?,
    onRetry: () -> Unit,
    openLink: (String) -> Unit,
    modifier: Modifier,
) {
    Box(modifier.background(Color.White), contentAlignment = Alignment.Center) {
        when {
            loading -> Column(horizontalAlignment = Alignment.CenterHorizontally) {
                CircularProgressIndicator(Modifier.size(32.dp), color = Primary, strokeWidth = 3.dp); Spacer(Modifier.height(12.dp))
                Text("جاري فتح محتوى الرسالة…", color = Muted, fontSize = 13.sp)
            }
            error != null -> Column(Modifier.padding(24.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                Icon(Icons.Rounded.CloudOff, null, tint = Muted, modifier = Modifier.size(32.dp)); Spacer(Modifier.height(9.dp))
                Text(error, color = Muted, fontSize = 13.sp); Spacer(Modifier.height(14.dp)); Button(onClick = onRetry) { Text("إعادة المحاولة") }
            }
            else -> SecureMailDocument(message.html, message.text, baseUrl, openLink)
        }
    }
}

@Composable
private fun SecureMailDocument(content: String, text: String, baseUrl: String, openLink: (String) -> Unit) {
    val context = LocalContext.current
    val repository = remember(context) { MailRepository(context.applicationContext) }
    var allowImages by rememberSaveable(content, text) { mutableStateOf(false) }
    val allowImagesState = rememberUpdatedState(allowImages)
    var webView by remember { mutableStateOf<WebView?>(null) }
    val lifecycle = LocalLifecycleOwner.current.lifecycle
    val baseHost = remember(baseUrl) { runCatching { Uri.parse(baseUrl).host }.getOrNull().orEmpty() }
    val hasExternalImages = remember(content, baseHost) {
        Regex("""https?://[^"'()\s<>]+""", RegexOption.IGNORE_CASE)
            .findAll(content)
            .mapNotNull { match -> runCatching { Uri.parse(match.value).host }.getOrNull() }
            .any { host -> !host.equals(baseHost, ignoreCase = true) }
    }
    val document = remember(content, text) { adaptiveMailHtml(content, text) }
    val effectiveBaseUrl = remember(baseUrl) { if (baseUrl.startsWith("http", true)) baseUrl.trimEnd('/') + "/" else "https://mail.batabitoo.com/" }

    DisposableEffect(lifecycle) {
        val observer = object : DefaultLifecycleObserver {
            override fun onResume(owner: LifecycleOwner) { webView?.onResume() }
            override fun onPause(owner: LifecycleOwner) { webView?.onPause() }
        }
        lifecycle.addObserver(observer)
        onDispose { lifecycle.removeObserver(observer) }
    }

    Column(Modifier.fillMaxSize()) {
        if (hasExternalImages && !allowImages) {
            Row(Modifier.fillMaxWidth().background(Color(0xFFF4F5FA)).padding(10.dp, 7.dp), verticalAlignment = Alignment.CenterVertically) {
                Icon(Icons.Rounded.Shield, null, tint = Primary, modifier = Modifier.size(17.dp)); Spacer(Modifier.width(7.dp))
                Text("حُجبت الصور الخارجية لحماية الخصوصية", color = Muted, fontSize = 11.sp, modifier = Modifier.weight(1f))
                TextButton(onClick = { allowImages = true }) { Text("عرض الصور", fontSize = 11.sp) }
            }
        }
        AndroidView(
            factory = { context ->
                WebView(context).apply {
                    webView = this
                    setBackgroundColor(android.graphics.Color.WHITE)
                    settings.apply {
                        javaScriptEnabled = false; domStorageEnabled = false; databaseEnabled = false
                        allowFileAccess = false; allowContentAccess = false
                        mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
                        setSupportZoom(true); builtInZoomControls = true; displayZoomControls = false
                        useWideViewPort = false; loadWithOverviewMode = false; textZoom = 100
                    }
                    webViewClient = object : WebViewClient() {
                        override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? {
                            val uri = request.url
                            val path = uri.path.orEmpty()
                            val internalAttachment = uri.host.equals(baseHost, ignoreCase = true) &&
                                path.startsWith("/api/messages/") && path.contains("/attachments/")
                            if (!internalAttachment) {
                                val isNetworkRequest = uri.scheme.equals("http", true) || uri.scheme.equals("https", true)
                                if (!isNetworkRequest) return super.shouldInterceptRequest(view, request)
                                val acceptsImage = request.requestHeaders["Accept"].orEmpty().contains("image", ignoreCase = true)
                                if (allowImagesState.value && acceptsImage) return super.shouldInterceptRequest(view, request)
                                return WebResourceResponse(
                                    "text/plain",
                                    "UTF-8",
                                    ByteArrayInputStream(ByteArray(0)),
                                )
                            }
                            return runCatching {
                                val connection = (URL(uri.toString()).openConnection() as HttpURLConnection).apply {
                                    requestMethod = "GET"
                                    connectTimeout = 25_000
                                    readTimeout = 25_000
                                    repository.authorizationHeaders().forEach { (key, value) -> setRequestProperty(key, value) }
                                }
                                val code = connection.responseCode
                                if (code !in 200..299) {
                                    connection.disconnect()
                                    return@runCatching null
                                }
                                val mime = connection.contentType?.substringBefore(';')?.ifBlank { "application/octet-stream" }
                                    ?: "application/octet-stream"
                                WebResourceResponse(
                                    mime,
                                    null,
                                    code,
                                    connection.responseMessage ?: "OK",
                                    connection.headerFields.filterKeys { it != null }.mapValues { it.value.joinToString(",") },
                                    connection.inputStream,
                                )
                            }.getOrNull()
                        }
                        override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean { if (request.isForMainFrame) openLink(request.url.toString()); return true }
                        @Suppress("DEPRECATION") override fun shouldOverrideUrlLoading(view: WebView, url: String): Boolean { openLink(url); return true }
                    }
                    setDownloadListener { url, _, _, _, _ -> openLink(url) }
                }
            },
            update = { view ->
                // The interceptor permits authenticated inline attachments and
                // user-approved remote images only. CSS, fonts and tracking
                // requests stay blocked even after image consent.
                view.settings.blockNetworkImage = false
                val key = "$document-$allowImages"
                if (view.tag != key) { view.tag = key; view.loadDataWithBaseURL(effectiveBaseUrl, document, "text/html", "UTF-8", null) }
            },
            onRelease = { view -> webView = null; view.stopLoading(); view.destroy() },
            modifier = Modifier.fillMaxSize().weight(1f),
        )
    }
}

private fun adaptiveMailHtml(html: String, text: String): String {
    val cleanHtml = html.trim()
    val cleanText = ContentSanitizer.decodeBase64Text(text.trim())
    val body = if (ContentSanitizer.hasVisibleContent(cleanHtml)) cleanHtml else cleanText
        .replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace("\n", "<br>")
    val css = """<style>*,*:before,*:after{box-sizing:border-box}html,body{margin:0!important;padding:16px!important;background:#fff!important;color:#202124!important;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Cairo',sans-serif!important;font-size:15px!important;line-height:1.65!important;overflow-wrap:anywhere}img{max-width:100%!important;height:auto!important}table{max-width:100%!important}a{color:#4f46e5!important}</style>"""
    return if (cleanHtml.contains("<head", true)) cleanHtml.replace(Regex("<head[^>]*>", RegexOption.IGNORE_CASE)) { it.value + "<meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">$css" }
    else "<!doctype html><html dir=\"auto\"><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">$css</head><body>$body</body></html>"
}

private fun adaptiveReaderDate(value: String, long: Boolean = false): String = runCatching {
    DateTimeFormatter.ofPattern(if (long) "d MMMM yyyy، h:mm a" else "d MMM، h:mm a", Locale.forLanguageTag("ar-SA"))
        .format(Instant.parse(value).atZone(ZoneId.systemDefault()))
}.getOrDefault(value.ifBlank { "—" })
