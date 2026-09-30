package com.batabitoo.mailcenter.ui

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.batabitoo.mailcenter.ui.theme.AmazonOrange

/** A small, reusable Amazon identity that does not depend on emoji or cart glyphs. */
@Composable
internal fun AmazonMark(
    modifier: Modifier = Modifier,
    foreground: Color = Color(0xFF131921),
    accent: Color = AmazonOrange,
    container: Color = Color.Transparent,
) {
    Box(
        modifier = modifier.background(container, RoundedCornerShape(12.dp)),
        contentAlignment = Alignment.Center,
    ) {
        Text(
            text = "a",
            color = foreground,
            fontSize = 20.sp,
            lineHeight = 20.sp,
            fontWeight = FontWeight.Black,
            style = MaterialTheme.typography.titleMedium,
            modifier = Modifier.padding(bottom = 5.dp),
        )
        Canvas(Modifier.fillMaxSize()) {
            val stroke = (size.minDimension * 0.075f).coerceAtLeast(1.5.dp.toPx())
            val left = size.width * 0.25f
            val top = size.height * 0.56f
            val arcSize = Size(size.width * 0.50f, size.height * 0.27f)
            drawArc(
                color = accent,
                startAngle = 18f,
                sweepAngle = 142f,
                useCenter = false,
                topLeft = Offset(left, top),
                size = arcSize,
                style = Stroke(width = stroke, cap = StrokeCap.Round),
            )
            drawLine(
                color = accent,
                start = Offset(size.width * 0.71f, size.height * 0.75f),
                end = Offset(size.width * 0.78f, size.height * 0.68f),
                strokeWidth = stroke,
                cap = StrokeCap.Round,
            )
        }
    }
}
