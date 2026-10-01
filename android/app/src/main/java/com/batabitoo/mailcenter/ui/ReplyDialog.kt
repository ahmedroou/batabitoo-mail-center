package com.batabitoo.mailcenter.ui

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import com.batabitoo.mailcenter.data.ReplyDraft

@Composable
fun ReplyDialog(draft: ReplyDraft, onText: (String) -> Unit, onSend: () -> Unit, onClose: () -> Unit, onReconnect: () -> Unit) {
    Dialog(onDismissRequest = onClose) {
        Surface(shape = MaterialTheme.shapes.large) {
            Column(Modifier.fillMaxWidth().imePadding().verticalScroll(rememberScrollState()).padding(20.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                Text("الرد على الرسالة", style = MaterialTheme.typography.titleLarge)
                draft.context?.let { envelope ->
                    Text("من: ${envelope.from}\nإلى: ${envelope.to}\n${envelope.subject}", style = MaterialTheme.typography.bodySmall)
                }
                if (draft.loading) LinearProgressIndicator(Modifier.fillMaxWidth())
                if (draft.status.isNotBlank()) Text(draft.status, style = MaterialTheme.typography.bodyMedium)
                OutlinedTextField(
                    value = draft.text, onValueChange = onText, label = { Text("نص الرد") },
                    enabled = draft.context != null && !draft.sending && !draft.locked,
                    minLines = 5, maxLines = 10, modifier = Modifier.fillMaxWidth(),
                )
                if (draft.reconnect) TextButton(onClick = onReconnect) { Text("ربط Google ومنح صلاحية الإرسال") }
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Button(onClick = onSend, enabled = draft.context != null && draft.text.isNotBlank() && !draft.sending && !draft.locked) {
                        Text(if (draft.sending) "جارٍ الإرسال…" else "إرسال الرد")
                    }
                    TextButton(onClick = onClose) { Text("إغلاق") }
                }
            }
        }
    }
}
