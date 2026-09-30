package com.batabitoo.mailcenter.ui.theme

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Shapes
import androidx.compose.material3.Typography
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

val Ink = Color(0xFF15182B)
val Canvas = Color(0xFFF6F7FC)
val Surface = Color(0xFFFFFFFF)
val SurfaceSoft = Color(0xFFF0F2FA)
val Primary = Color(0xFF5B55E7)
val PrimaryLight = Color(0xFFEFEEFF)
val Violet = Color(0xFF8558EA)
val Cyan = Color(0xFF22B8CF)
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
val NebulaNight = Color(0xFF151630)
val NebulaBlue = Color(0xFF25235E)
val NebulaMist = Color(0xFFE8E9FF)

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
    outline = CardBorder,
    outlineVariant = CardBorderSubtle,
    surfaceContainer = SurfaceSoft,
    surfaceContainerLow = Color(0xFFFAFAFE),
    surfaceContainerHigh = Color(0xFFE9EBF5),
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

private val MailShapes = Shapes(
    extraSmall = RoundedCornerShape(8.dp),
    small = RoundedCornerShape(12.dp),
    medium = RoundedCornerShape(18.dp),
    large = RoundedCornerShape(24.dp),
    extraLarge = RoundedCornerShape(30.dp),
)

@Composable
fun BatabitooTheme(content: @Composable () -> Unit) {
    MaterialTheme(
        colorScheme = MailColors,
        typography = MailTypography,
        shapes = MailShapes,
        content = content,
    )
}
