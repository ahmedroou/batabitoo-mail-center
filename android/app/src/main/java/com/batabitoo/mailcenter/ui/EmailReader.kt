package com.batabitoo.mailcenter.ui

import android.content.Intent
import android.net.Uri
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Toast
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.animateContentSize
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
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
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import com.batabitoo.mailcenter.data.ContentSanitizer
import com.batabitoo.mailcenter.data.MailMessage
import com.batabitoo.mailcenter.data.SenderFormatter
import com.batabitoo.mailcenter.ui.theme.*
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Locale

private val AmazonOrange = Color(0xFFFF9900)

@Composable
fun EmailReader(
    message: MailMessage,
    baseUrl: String,
    loading: Boolean,
    error: String?,
    onRetry: () -> Unit,
    onDismiss: () -> Unit,
) {
    val context = LocalContext.current
    val clipboard = LocalClipboardManager.current
    var detailsExpanded by rememberSaveable(message.id) { mutableStateOf(false) }

    fun copy(value: String, label: String = "تم النسخ") {
        clipboard.setText(AnnotatedString(value))
        Toast.makeText(context, label, Toast.LENGTH_SHORT).show()
    }

    val openLink: (String) -> Unit = { url ->
        val uri = Uri.parse(url)
        if (uri.scheme?.lowercase() in setOf("http", "https", "mailto", "tel")) {
            runCatching {
                context.startActivity(Intent(Intent.ACTION_VIEW, uri))
            }.onFailure {
                Toast.makeText(context, "لا يوجد تطبيق مناسب لفتح الرابط", Toast.LENGTH_SHORT).show()
            }
        }
    }

    Dialog(
        onDismissRequest = onDismiss,
        properties = DialogProperties(usePlatformDefaultWidth = false, decorFitsSystemWindows = false),
    ) {
        Surface(
            modifier = Modifier.fillMaxSize(),
            color = Color.White,
        ) {
            Column(
                modifier = Modifier
                    .fillMaxSize()
                    .windowInsetsPadding(WindowInsets.statusBars)
                    .windowInsetsPadding(WindowInsets.navigationBars)
            ) {
                // 1. Top App Bar (Gmail style)
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .height(56.dp)
                        .background(Color.White)
                        .padding(horizontal = 4.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    IconButton(onClick = onDismiss) {
                        Icon(
                            Icons.AutoMirrored.Rounded.ArrowBack,
                            contentDescription = "الرجوع",
                            tint = Ink,
                            modifier = Modifier.size(24.dp),
                        )
                    }
                    Text(
                        text = "البريد الوارد",
                        style = MaterialTheme.typography.titleMedium,
                        fontWeight = FontWeight.Bold,
                        color = Ink,
                        modifier = Modifier.weight(1f),
                    )
                    val cleanText = remember(message.text) { ContentSanitizer.decodeBase64Text(message.text) }
                    if (cleanText.isNotBlank()) {
                        IconButton(onClick = { copy(cleanText, "تم نسخ نص الرسالة") }) {
                            Icon(
                                Icons.Rounded.ContentCopy,
                                contentDescription = "نسخ النص",
                                tint = Muted,
                                modifier = Modifier.size(20.dp),
                            )
                        }
                    }
                    IconButton(onClick = onRetry, enabled = !loading) {
                        Icon(
                            Icons.Rounded.Refresh,
                            contentDescription = "تحديث",
                            tint = if (loading) Muted.copy(alpha = 0.4f) else Primary,
                            modifier = Modifier.size(20.dp),
                        )
                    }
                }

                HorizontalDivider(color = Color(0xFFF1F3F5), thickness = 1.dp)

                // 2. Email Header Section (Gmail Layout)
                Column(
                    modifier = Modifier
                        .fillMaxWidth()
                        .background(Color.White)
                        .animateContentSize()
                        .padding(horizontal = 16.dp, vertical = 12.dp),
                    verticalArrangement = Arrangement.spacedBy(10.dp),
                ) {
                    // Subject Line
                    SelectionContainer {
                        Text(
                            text = message.subject.ifBlank { "(بدون عنوان)" },
                            style = MaterialTheme.typography.titleMedium.copy(
                                fontSize = 18.sp,
                                fontWeight = FontWeight.Bold,
                                lineHeight = 24.sp,
                            ),
                            color = Ink,
                        )
                    }

                    // Banned / Restricted Warning
                    if (message.isBanned) {
                        Row(
                            modifier = Modifier
                                .fillMaxWidth()
                                .clip(RoundedCornerShape(10.dp))
                                .background(BannedLight)
                                .padding(horizontal = 12.dp, vertical = 8.dp),
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(8.dp),
                        ) {
                            Icon(
                                Icons.Rounded.Block,
                                contentDescription = null,
                                tint = BannedRed,
                                modifier = Modifier.size(18.dp),
                            )
                            Text(
                                text = "تنبيه الحساب: ${message.banReason.ifBlank { "مقتصر على المشتريات الرقمية فقط أو مقيد" }}",
                                color = BannedRed,
                                fontSize = 12.sp,
                                fontWeight = FontWeight.Bold,
                                lineHeight = 16.sp,
                            )
                        }
                    }

                    // Sender Info Row
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        // Sender Avatar
                        val isAmazon = message.isAmazon
                        Box(
                            modifier = Modifier
                                .size(40.dp)
                                .clip(CircleShape)
                                .background(
                                    if (isAmazon) AmazonOrange
                                    else if (message.isOfficial) Primary
                                    else Color(0xFF6366F1)
                                ),
                            contentAlignment = Alignment.Center,
                        ) {
                            if (isAmazon) {
                                Icon(
                                    Icons.Rounded.ShoppingCart,
                                    contentDescription = null,
                                    tint = Color.White,
                                    modifier = Modifier.size(20.dp),
                                )
                            } else {
                                Text(
                                    text = message.from.take(1).ifBlank { "@" }.uppercase(),
                                    color = Color.White,
                                    fontWeight = FontWeight.Bold,
                                    fontSize = 16.sp,
                                )
                            }
                        }

                        Spacer(Modifier.width(12.dp))

                        // Sender Name + Time + Recipient Pill
                        Column(modifier = Modifier.weight(1f)) {
                            Row(
                                modifier = Modifier.fillMaxWidth(),
                                horizontalArrangement = Arrangement.SpaceBetween,
                                verticalAlignment = Alignment.CenterVertically,
                            ) {
                                Text(
                                    text = message.from.ifBlank { "مرسل غير معروف" },
                                    fontWeight = FontWeight.Bold,
                                    fontSize = 14.sp,
                                    color = Ink,
                                    maxLines = 1,
                                    overflow = TextOverflow.Ellipsis,
                                    modifier = Modifier.weight(1f, fill = false),
                                )
                                Spacer(Modifier.width(8.dp))
                                Text(
                                    text = readerDateShort(message.createdAt),
                                    fontSize = 11.sp,
                                    color = Muted,
                                )
                            }

                            // "To: user ˅" Pill
                            Row(
                                modifier = Modifier
                                    .clip(RoundedCornerShape(6.dp))
                                    .clickable { detailsExpanded = !detailsExpanded }
                                    .padding(vertical = 2.dp),
                                verticalAlignment = Alignment.CenterVertically,
                                horizontalArrangement = Arrangement.spacedBy(4.dp),
                            ) {
                                Text(
                                    text = "إلى: ${message.inboxEmail.ifBlank { message.to.take(24) }}",
                                    fontSize = 11.sp,
                                    color = Muted,
                                    maxLines = 1,
                                    overflow = TextOverflow.Ellipsis,
                                )
                                Icon(
                                    imageVector = if (detailsExpanded) Icons.Rounded.ExpandLess else Icons.Rounded.ExpandMore,
                                    contentDescription = null,
                                    tint = Muted,
                                    modifier = Modifier.size(14.dp),
                                )
                            }
                        }
                    }

                    // Expanded Details Card (Gmail style)
                    AnimatedVisibility(visible = detailsExpanded) {
                        Column(
                            modifier = Modifier
                                .fillMaxWidth()
                                .clip(RoundedCornerShape(12.dp))
                                .background(Color(0xFFF8FAFC))
                                .padding(12.dp),
                            verticalArrangement = Arrangement.spacedBy(6.dp),
                        ) {
                            DetailItem("من", message.from)
                            DetailItem("إلى", message.to.ifBlank { message.inboxEmail })
                            DetailItem("التاريخ", readerDateFull(message.createdAt))
                            DetailItem("الأمان", "تشفير قياسي (TLS)")
                        }
                    }

                    // Prominent OTP Card
                    if (message.otp.isNotBlank()) {
                        Row(
                            modifier = Modifier
                                .fillMaxWidth()
                                .clip(RoundedCornerShape(12.dp))
                                .background(Brush.horizontalGradient(listOf(Color(0xFFECFDF5), Color(0xFFD1FAE5))))
                                .clickable { copy(message.otp, "تم نسخ كود التحقق: ${message.otp}") }
                                .padding(horizontal = 14.dp, vertical = 10.dp),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            Box(
                                modifier = Modifier
                                    .size(36.dp)
                                    .clip(CircleShape)
                                    .background(Green.copy(alpha = 0.2f)),
                                contentAlignment = Alignment.Center,
                            ) {
                                Icon(Icons.Rounded.VpnKey, contentDescription = null, tint = Green, modifier = Modifier.size(18.dp))
                            }
                            Spacer(Modifier.width(10.dp))
                            Column(Modifier.weight(1f)) {
                                Text("رمز التحقق (OTP)", color = Color(0xFF047857), fontSize = 11.sp, fontWeight = FontWeight.SemiBold)
                                Text(
                                    text = message.otp,
                                    color = Color(0xFF065F46),
                                    fontSize = 22.sp,
                                    fontWeight = FontWeight.ExtraBold,
                                    letterSpacing = 4.sp,
                                )
                            }
                            FilledTonalButton(
                                onClick = { copy(message.otp, "تم نسخ كود التحقق: ${message.otp}") },
                                colors = ButtonDefaults.filledTonalButtonColors(
                                    containerColor = Color.White,
                                    contentColor = Color(0xFF065F46),
                                ),
                                shape = RoundedCornerShape(8.dp),
                                contentPadding = PaddingValues(horizontal = 12.dp, vertical = 6.dp),
                            ) {
                                Icon(Icons.Rounded.ContentCopy, contentDescription = null, modifier = Modifier.size(14.dp))
                                Spacer(Modifier.width(4.dp))
                                Text("نسخ", fontSize = 12.sp, fontWeight = FontWeight.Bold)
                            }
                        }
                    }

                    // Non-inline Attachments
                    val attachments = message.attachments.filter { !it.inline }
                    if (!loading && attachments.isNotEmpty()) {
                        Row(
                            modifier = Modifier
                                .fillMaxWidth()
                                .horizontalScroll(rememberScrollState()),
                            horizontalArrangement = Arrangement.spacedBy(8.dp),
                        ) {
                            attachments.forEach { attachment ->
                                OutlinedButton(
                                    onClick = {
                                        openLink("${baseUrl.trimEnd('/')}/api/messages/${Uri.encode(message.id)}/attachments/${Uri.encode(attachment.id)}")
                                    },
                                    shape = RoundedCornerShape(10.dp),
                                    contentPadding = PaddingValues(horizontal = 10.dp, vertical = 6.dp),
                                ) {
                                    Icon(Icons.Rounded.FileDownload, null, Modifier.size(16.dp))
                                    Spacer(Modifier.width(6.dp))
                                    Text(
                                        text = attachment.filename,
                                        maxLines = 1,
                                        overflow = TextOverflow.Ellipsis,
                                        fontSize = 12.sp,
                                        modifier = Modifier.widthIn(max = 160.dp),
                                    )
                                }
                            }
                        }
                    }
                }

                HorizontalDivider(color = Color(0xFFE5E7EB), thickness = 1.dp)

                // 3. Email Body (WebView with Gmail standard styling)
                Box(
                    modifier = Modifier
                        .fillMaxWidth()
                        .weight(1f)
                        .background(Color.White),
                    contentAlignment = Alignment.Center,
                ) {
                    when {
                        loading -> {
                            Column(horizontalAlignment = Alignment.CenterHorizontally) {
                                CircularProgressIndicator(modifier = Modifier.size(32.dp), color = Primary, strokeWidth = 3.dp)
                                Spacer(Modifier.height(12.dp))
                                Text("جاري فتح محتوى الرسالة…", color = Muted, fontSize = 13.sp)
                            }
                        }
                        error != null -> {
                            Column(
                                modifier = Modifier.padding(24.dp),
                                horizontalAlignment = Alignment.CenterHorizontally,
                            ) {
                                Text(error, color = Muted, fontSize = 13.sp)
                                Spacer(Modifier.height(14.dp))
                                Button(onClick = onRetry) { Text("إعادة المحاولة") }
                            }
                        }
                        else -> {
                            MailDocument(
                                content = message.html,
                                text = message.text,
                                baseUrl = baseUrl,
                                openLink = openLink,
                            )
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun DetailItem(label: String, value: String) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        verticalAlignment = Alignment.Top,
    ) {
        Text(
            text = "$label:",
            fontSize = 11.sp,
            color = Muted,
            fontWeight = FontWeight.Medium,
            modifier = Modifier.width(44.dp),
        )
        SelectionContainer(Modifier.weight(1f)) {
            Text(
                text = value.ifBlank { "—" },
                fontSize = 12.sp,
                color = Ink,
                lineHeight = 16.sp,
            )
        }
    }
}

@Composable
private fun MailDocument(
    content: String,
    text: String,
    baseUrl: String,
    openLink: (String) -> Unit,
) {
    val preparedHtml = remember(content, text) { prepareGmailHtml(content, text) }
    val effectiveBaseUrl = remember(baseUrl) {
        if (baseUrl.isNotBlank() && baseUrl.startsWith("http", ignoreCase = true)) {
            baseUrl.trimEnd('/') + "/"
        } else {
            "https://mail.batabitoo.com/"
        }
    }

    AndroidView(
        factory = { context ->
            WebView(context).apply {
                setBackgroundColor(android.graphics.Color.WHITE)
                settings.apply {
                    javaScriptEnabled = true
                    domStorageEnabled = true
                    databaseEnabled = true
                    allowFileAccess = false
                    allowContentAccess = false
                    loadsImagesAutomatically = true
                    blockNetworkImage = false
                    blockNetworkLoads = false
                    mixedContentMode = WebSettings.MIXED_CONTENT_ALWAYS_ALLOW
                    useWideViewPort = false
                    loadWithOverviewMode = false
                    setSupportZoom(true)
                    builtInZoomControls = true
                    displayZoomControls = false
                    textZoom = 100
                }
                isVerticalScrollBarEnabled = true
                isHorizontalScrollBarEnabled = true
                scrollBarStyle = android.view.View.SCROLLBARS_INSIDE_OVERLAY
                webViewClient = object : WebViewClient() {
                    override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                        if (request.isForMainFrame) openLink(request.url.toString())
                        return true
                    }
                    @Suppress("DEPRECATION")
                    override fun shouldOverrideUrlLoading(view: WebView, url: String): Boolean {
                        openLink(url)
                        return true
                    }
                }
                setDownloadListener { url, _, _, _, _ -> openLink(url) }
            }
        },
        update = { view ->
            if (view.tag != preparedHtml) {
                view.tag = preparedHtml
                view.loadDataWithBaseURL(effectiveBaseUrl, preparedHtml, "text/html", "UTF-8", null)
            }
        },
        onRelease = { view ->
            view.stopLoading()
            view.destroy()
        },
        modifier = Modifier.fillMaxSize(),
    )
}

/**
 * Transforms incoming raw email HTML or text into a responsive, clean, Gmail-grade document.
 */
private fun prepareGmailHtml(html: String, text: String): String {
    val cleanHtml = html.trim()
    val cleanText = ContentSanitizer.decodeBase64Text(text.trim())

    val isBlankContent = !ContentSanitizer.hasVisibleContent(cleanHtml) ||
        cleanHtml.contains("لم يتوفر محتوى الرسالة من المصدر") ||
        cleanHtml == "<!doctype html><html dir=\"auto\"><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"><body style=\"margin:0;padding:20px;font:16px/1.8 sans-serif;white-space:pre-wrap;overflow-wrap:anywhere\">لم يتوفر محتوى الرسالة من المصدر.</body></html>"

    if (isBlankContent) {
        if (cleanText.isNotBlank() && !cleanText.contains("لم يتوفر محتوى الرسالة")) {
            return formatPlainTextAsHtml(cleanText)
        }
        return """
            <!doctype html>
            <html dir="auto">
            <head>
                <meta charset="utf-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <style>
                    body {
                        margin: 0;
                        padding: 40px 16px;
                        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Cairo", sans-serif;
                        color: #94a3b8;
                        text-align: center;
                        font-size: 14px;
                    }
                </style>
            </head>
            <body>لم يتوفر نص أو محتوى رسالة من المصدر</body>
            </html>
        """.trimIndent()
    }

    val mobileViewport = """<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=3.0, user-scalable=yes">"""
    val gmailResponsiveCss = """
        <style id="gmail-responsive-normalize">
            *, *::before, *::after { box-sizing: border-box; }
            html, body {
                margin: 0 !important;
                padding: 12px 14px !important;
                background-color: #ffffff !important;
                color: #202124 !important;
                font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Cairo", Helvetica, Arial, sans-serif !important;
                font-size: 15px !important;
                line-height: 1.6 !important;
                -webkit-text-size-adjust: 100% !important;
                text-size-adjust: 100% !important;
                overflow-wrap: break-word !important;
            }
            img {
                max-width: 100% !important;
                height: auto !important;
            }
            table {
                max-width: 100% !important;
            }
            a {
                color: #1a73e8 !important;
                text-decoration: underline !important;
            }
        </style>
    """.trimIndent()

    return if (cleanHtml.contains("<head>", ignoreCase = true)) {
        cleanHtml.replace(Regex("<head>", RegexOption.IGNORE_CASE), "<head>$mobileViewport$gmailResponsiveCss")
    } else if (cleanHtml.contains("<html>", ignoreCase = true)) {
        cleanHtml.replace(Regex("<html>", RegexOption.IGNORE_CASE), "<html><head>$mobileViewport$gmailResponsiveCss</head>")
    } else {
        """<!doctype html><html dir="auto"><head><meta charset="utf-8">$mobileViewport$gmailResponsiveCss</head><body>$cleanHtml</body></html>"""
    }
}

private fun formatPlainTextAsHtml(text: String): String {
    val decoded = ContentSanitizer.decodeBase64Text(text)
    var escaped = decoded
        .replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace("\"", "&quot;")

    // Action Title (https://...) buttons
    val actionRegex = Regex("""([^()\n]{2,40})\s*\((https?://[^\s)]+)\)""")
    escaped = actionRegex.replace(escaped) { matchResult ->
        val label = matchResult.groupValues[1].trim()
        val url = matchResult.groupValues[2].trim()
        val isDanger = label.contains("إلغاء") || label.contains("حظر") || label.contains("حذف") || label.contains("إغلاق") ||
                label.contains("delete", ignoreCase = true) || label.contains("cancel", ignoreCase = true) || label.contains("close", ignoreCase = true)
        val bg = if (isDanger) "#ef4444" else "#ff9900"
        val textColor = if (isDanger) "#ffffff" else "#111827"
        """<div style="margin: 14px 0;"><a href="$url" target="_blank" rel="noopener noreferrer" style="display: inline-block; padding: 12px 24px; background: $bg; color: $textColor; font-weight: bold; text-decoration: none; border-radius: 12px; font-size: 14px; box-shadow: 0 2px 6px rgba(0,0,0,0.08);">$label</a></div>"""
    }

    // Auto-link remaining bare URLs
    val linked = escaped.replace(
        Regex("""(^|[^"'])(https?://[^\s<)]+)""", RegexOption.IGNORE_CASE),
        """$1<a href="$2" target="_blank" rel="noopener noreferrer" style="color: #2563eb; text-decoration: underline; word-break: break-all;">$2</a>"""
    )

    return """
        <!doctype html>
        <html dir="auto">
        <head>
            <meta charset="utf-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=3.0, user-scalable=yes">
            <style>
                *, *::before, *::after { box-sizing: border-box; }
                body {
                    margin: 0;
                    padding: 20px 16px;
                    background-color: #ffffff;
                    color: #1f2937;
                    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Cairo", Helvetica, Arial, sans-serif;
                    font-size: 15px;
                    line-height: 1.8;
                    white-space: pre-wrap;
                    overflow-wrap: break-word;
                    word-break: normal;
                }
                a {
                    color: #2563eb;
                    text-decoration: underline;
                }
            </style>
        </head>
        <body dir="auto">$linked</body>
        </html>
    """.trimIndent()
}

private fun readerDateShort(value: String): String = runCatching {
    DateTimeFormatter.ofPattern("d MMM، h:mm a", Locale.forLanguageTag("ar-SA"))
        .format(Instant.parse(value).atZone(ZoneId.systemDefault()))
}.getOrDefault(value.ifBlank { "—" })

private fun readerDateFull(value: String): String = runCatching {
    DateTimeFormatter.ofPattern("d MMMM yyyy، h:mm a", Locale.forLanguageTag("ar-SA"))
        .format(Instant.parse(value).atZone(ZoneId.systemDefault()))
}.getOrDefault(value.ifBlank { "—" })
