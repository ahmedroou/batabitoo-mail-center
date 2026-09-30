package com.batabitoo.mailcenter

import android.os.Bundle
import android.content.Intent
import androidx.lifecycle.ViewModelProvider
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.unit.LayoutDirection
import androidx.compose.ui.platform.LocalLayoutDirection
import com.batabitoo.mailcenter.ui.MailCenterApp
import com.batabitoo.mailcenter.ui.theme.BatabitooTheme

class MainActivity : ComponentActivity() {
    private val mailViewModel by lazy { ViewModelProvider(this)[MailViewModel::class.java] }
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        receiveConnection(intent)
        setContent {
            BatabitooTheme {
                CompositionLocalProvider(LocalLayoutDirection provides LayoutDirection.Rtl) {
                    MailCenterApp(mailViewModel)
                }
            }
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        receiveConnection(intent)
    }

    private fun receiveConnection(intent: Intent?) {
        val uri = intent?.data ?: return
        if (uri.scheme == "batabitoomail" && uri.host == "connect") {
            uri.getQueryParameter("code")?.let(mailViewModel::finishConnection)
            intent.data = null
        }
    }
}
