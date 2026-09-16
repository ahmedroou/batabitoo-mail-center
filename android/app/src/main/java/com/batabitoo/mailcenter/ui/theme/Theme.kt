package com.batabitoo.mailcenter.ui.theme

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Typography
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.sp

val Ink = Color(0xFF151929)
val Canvas = Color(0xFFF4F6FB)
val Surface = Color(0xFFFFFFFF)
val SurfaceSoft = Color(0xFFF0F2F8)
val Primary = Color(0xFF6558F5)
val PrimaryLight = Color(0xFFEEF2FF)
val Violet = Color(0xFF8A5CFF)
val Cyan = Color(0xFF36C9DB)
val TempLight = Color(0xFFECFEFF)
val Gold = Color(0xFFF2B84B)
val OfficialGold = Color(0xFFD97706)
val OfficialLight = Color(0xFFFEFCE8)
val AmazonOrange = Color(0xFFFF9900)
val AmazonWarm = Color(0xFFFFF7ED)
val BannedRed = Color(0xFFDC2626)
val BannedLight = Color(0xFFFEE2E2)
val Green = Color(0xFF10B981)
val GreenLight = Color(0xFFECFDF5)
val Muted = Color(0xFF6B7280)
val MutedLight = Color(0xFF9CA3AF)
val CardBorder = Color(0xFFE5E7EB)
val CardBorderSubtle = Color(0xFFF3F4F6)
val Danger = Color(0xFFEF4444)

private val MailColors = lightColorScheme(
    primary = Primary,
    onPrimary = Color.White,
    secondary = Cyan,
    tertiary = Green,
    background = Canvas,
    onBackground = Ink,
    surface = Surface,
    onSurface = Ink,
    surfaceVariant = SurfaceSoft,
    onSurfaceVariant = Muted,
    error = Danger,
)

private val MailTypography = Typography(
    headlineLarge = TextStyle(fontSize = 29.sp, lineHeight = 36.sp, fontWeight = FontWeight.Black),
    headlineMedium = TextStyle(fontSize = 23.sp, lineHeight = 30.sp, fontWeight = FontWeight.Black),
    titleLarge = TextStyle(fontSize = 20.sp, lineHeight = 27.sp, fontWeight = FontWeight.ExtraBold),
    titleMedium = TextStyle(fontSize = 16.sp, lineHeight = 23.sp, fontWeight = FontWeight.Bold),
    bodyLarge = TextStyle(fontSize = 15.sp, lineHeight = 23.sp, fontWeight = FontWeight.Medium),
    bodyMedium = TextStyle(fontSize = 13.sp, lineHeight = 20.sp, fontWeight = FontWeight.Normal),
    labelLarge = TextStyle(fontSize = 13.sp, lineHeight = 18.sp, fontWeight = FontWeight.Bold),
    labelMedium = TextStyle(fontSize = 12.sp, lineHeight = 17.sp, fontWeight = FontWeight.Bold),
    labelSmall = TextStyle(fontSize = 11.sp, lineHeight = 15.sp, fontWeight = FontWeight.Medium),
)

@Composable
fun BatabitooTheme(content: @Composable () -> Unit) {
    MaterialTheme(colorScheme = MailColors, typography = MailTypography, content = content)
}
