package com.batabitoo.mailcenter

import android.app.Application
import android.content.Intent
import android.net.Uri
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.batabitoo.mailcenter.data.AmazonBannedDetector
import com.batabitoo.mailcenter.data.AmazonDetector
import com.batabitoo.mailcenter.data.AppVersionInfo
import com.batabitoo.mailcenter.data.ApiException
import com.batabitoo.mailcenter.data.Counts
import com.batabitoo.mailcenter.data.DeletedAmazonAccount
import com.batabitoo.mailcenter.data.GmailAccount
import com.batabitoo.mailcenter.data.Inbox
import com.batabitoo.mailcenter.data.MailMessage
import com.batabitoo.mailcenter.data.MailAttachment
import com.batabitoo.mailcenter.data.MailRepository
import com.batabitoo.mailcenter.data.ReplyDraft
import com.batabitoo.mailcenter.data.RegistrationLog
import com.batabitoo.mailcenter.data.StorageStats
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.debounce
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.flow.collect
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.launch

enum class MainSection { INBOXES, AMAZON, MESSAGES, LOGS, SETTINGS }
enum class InboxFilter { OFFICIAL, TEMP }
enum class OfficialSubFilter { ALL, BATABITOO, GMAIL }
enum class AmazonTab { ALL, SUSPECTED, BANNED, HEALTHY, DELETED, MESSAGES, OTP, ORDERS }
enum class AmazonDomainFilter { ALL, BATABITOO, GMAIL }
enum class MessageFilter { CURRENT, OFFICIAL, TEMP }
enum class LogsTab { CAMPAIGNS, WINNING }

data class MailUiState(
    val section: MainSection = MainSection.INBOXES,
    val inboxFilter: InboxFilter = InboxFilter.OFFICIAL,
    val officialSubFilter: OfficialSubFilter = OfficialSubFilter.ALL,
    val amazonTab: AmazonTab = AmazonTab.ALL,
    val logsTab: LogsTab = LogsTab.CAMPAIGNS,
    val amazonDomainFilter: AmazonDomainFilter = AmazonDomainFilter.ALL,
    val messageFilter: MessageFilter = MessageFilter.CURRENT,
    val counts: Counts = Counts(),
    val dataLoaded: Boolean = false,
    val dataError: String? = null,
    val officialInboxes: List<Inbox> = emptyList(),
    val tempInboxes: List<Inbox> = emptyList(),
    val amazonInboxes: List<Inbox> = emptyList(),
    val bannedInboxes: List<Inbox> = emptyList(),
    val suspectedInboxes: List<Inbox> = emptyList(),
    val deletedAmazonAccounts: List<DeletedAmazonAccount> = emptyList(),
    val gmailAccounts: List<GmailAccount> = emptyList(),
    val activeInbox: Inbox? = null,
    val currentMessages: List<MailMessage> = emptyList(),
    val officialMessages: List<MailMessage> = emptyList(),
    val tempMessages: List<MailMessage> = emptyList(),
    val amazonMessages: List<MailMessage> = emptyList(),
    val bannedMessages: List<MailMessage> = emptyList(),
    val logs: List<RegistrationLog> = emptyList(),
    val winningMessages: List<MailMessage> = emptyList(),
    val selectedMessage: MailMessage? = null,
    val messageLoading: Boolean = false,
    val messageError: String? = null,
    val replyDraft: ReplyDraft? = null,
    val search: String = "",
    val online: Boolean = false,
    val cloudConnected: Boolean = false,
    val projectId: String = "",
    val loading: Boolean = true,
    val refreshing: Boolean = false,
    val showCreate: Boolean = false,
    val showDottedDialog: Boolean = false,
    val createOfficial: Boolean = true,
    val createDomain: String = "batabitoo.com",
    val autoRefresh: Boolean = true,
    val baseUrl: String = MailRepository.DEFAULT_BASE_URL,
    val notice: String? = null,
    val error: String? = null,
    val appUpdate: AppVersionInfo? = null,
    val showUpdateDialog: Boolean = false,
    val currentVersionName: String = "1.0.0",
    val currentVersionCode: Int = 1,
    val storageStats: StorageStats? = null,
    val storageCleaning: Boolean = false,
    val authRequired: Boolean = false,
    val authBusy: Boolean = false,
    val gmailConnecting: Boolean = false,
    val gmailBusyEmail: String? = null,
    val selectedInboxIds: Set<String> = emptySet(),
    val deletingInboxes: Boolean = false,
)

private data class CloudSnapshot(
    val status: com.batabitoo.mailcenter.data.SystemStatus,
    val inboxes: com.batabitoo.mailcenter.data.InboxesPayload,
    val messages: com.batabitoo.mailcenter.data.MessagesPayload,
    val logs: List<RegistrationLog>,
    val gmailAccounts: List<GmailAccount>,
    val deletedAmazon: List<DeletedAmazonAccount>,
    val winningMessages: List<MailMessage>,
)

@OptIn(kotlinx.coroutines.FlowPreview::class)
class MailViewModel(application: Application) : AndroidViewModel(application) {
    private var messageRequest = 0
    private val repository = MailRepository(application)
    private val currentVersionCode: Int
    private val currentVersionName: String
    private val _uiState = MutableStateFlow(MailUiState(baseUrl = repository.baseUrl))
    val uiState: StateFlow<MailUiState> = _uiState.asStateFlow()

    init {
        val (code, name) = runCatching {
            val pInfo = if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.TIRAMISU) {
                application.packageManager.getPackageInfo(application.packageName, android.content.pm.PackageManager.PackageInfoFlags.of(0))
            } else {
                @Suppress("DEPRECATION")
                application.packageManager.getPackageInfo(application.packageName, 0)
            }
            val verCode = if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.P) pInfo.longVersionCode.toInt() else @Suppress("DEPRECATION") pInfo.versionCode
            verCode to (pInfo.versionName ?: "1.0.0")
        }.getOrDefault(1 to "1.0.0")
        currentVersionCode = code
        currentVersionName = name
        _uiState.update { it.copy(currentVersionCode = code, currentVersionName = name) }

        refreshAll(initial = true)
        viewModelScope.launch {
            repository.events().debounce(650).collect { event ->
                if (!_uiState.value.autoRefresh || _uiState.value.refreshing) return@collect
                when (event) {
                    "status:counts" -> refreshStatusOnly()
                    "message:new", "inbox:new", "inbox:updated", "inbox:deleted" -> refreshCloudData()
                }
            }
        }
    }

    fun refreshAll(initial: Boolean = false, silent: Boolean = false) {
        viewModelScope.launch {
            _uiState.update { it.copy(loading = initial, refreshing = !initial, error = null) }
            runCatching {
                repository.ensurePersonalAccess()
                val snapshot = coroutineScope {
                    val statusRequest = async { repository.status(currentVersionCode) }
                    val inboxesRequest = async { repository.inboxes() }
                    val messagesRequest = async { repository.messages() }
                    val logsRequest = async { runCatching { repository.logs() }.getOrDefault(_uiState.value.logs) }
                    val gmailRequest = async { runCatching { repository.gmailAccounts() }.getOrDefault(emptyList()) }
                    val deletedAmazonRequest = async { runCatching { repository.deletedAmazonAccounts() }.getOrDefault(emptyList()) }
                    val winningRequest = async { runCatching { repository.winningMessages().messages }.getOrDefault(emptyList()) }
                    CloudSnapshot(
                        statusRequest.await(),
                        inboxesRequest.await(),
                        messagesRequest.await(),
                        logsRequest.await(),
                        gmailRequest.await(),
                        deletedAmazonRequest.await(),
                        winningRequest.await(),
                    )
                }
                val status = snapshot.status
                val inboxes = snapshot.inboxes
                val allMessages = snapshot.messages
                val logs = snapshot.logs
                val appVersion = status.appVersion ?: runCatching { repository.appVersion(currentVersionCode) }.getOrNull()

                val officialEmails = inboxes.official.map { it.email.lowercase().trim() }.toSet()

                val allMsgsList = allMessages.messages.map { msg ->
                    val isBanned = AmazonBannedDetector.isBannedMessage(msg)
                    val isAmazon = isBanned || AmazonDetector.isAmazonMessage(msg)
                    val reason = if (isBanned) AmazonBannedDetector.getBanReason(msg) else ""
                    msg.copy(isAmazon = isAmazon, isBanned = isBanned, banReason = reason)
                }
                val officialMessages = allMsgsList.filter { msg ->
                    val email = msg.inboxEmail.lowercase().trim()
                    officialEmails.contains(email) || msg.isOfficial || email.endsWith("@batabitoo.com") || email.endsWith("@gmail.com")
                }
                val tempMessages = allMsgsList.filter { !officialMessages.contains(it) }.map { it.copy(isAmazon = false, isBanned = false) }
                val amazonMsgs = allMsgsList.filter { it.isAmazon }
                val bannedMsgs = allMsgsList.filter { it.isBanned }

                val officialList = inboxes.official.map { inbox ->
                    val isConfirmedBanned = AmazonBannedDetector.isConfirmedBanned(inbox)
                    val isSuspected = AmazonBannedDetector.isSuspectedInbox(inbox, allMsgsList)
                    val isAmazon = isConfirmedBanned || isSuspected || AmazonDetector.isAmazonInbox(inbox, allMsgsList)
                    val matchingMsg = allMsgsList.find { m ->
                        val inboxEmail = inbox.email.lowercase().trim()
                        (m.inboxEmail.lowercase().trim() == inboxEmail || m.to.lowercase().contains(inboxEmail)) && m.isBanned
                    }
                    val reason = if (inbox.banReason.isNotBlank()) {
                        inbox.banReason
                    } else if (isConfirmedBanned || isSuspected) {
                        matchingMsg?.banReason?.ifBlank { "حساب مقيد / محظور" } ?: "حساب مقيد / محظور"
                    } else ""
                    val banStatus = when {
                        isConfirmedBanned -> "confirmed"
                        isSuspected -> "suspected"
                        inbox.banStatus == "safe" -> "safe"
                        else -> "none"
                    }
                    inbox.copy(
                        isAmazon = isAmazon,
                        isBanned = isConfirmedBanned,
                        banStatus = banStatus,
                        banReason = reason,
                    )
                }
                val officialByKey = officialList.associateBy(::inboxKey)
                fun authoritative(source: List<Inbox>, fallback: (Inbox) -> Boolean): List<Inbox> {
                    if (source.isEmpty()) return officialList.filter(fallback)
                    return source.map { cloud -> officialByKey[inboxKey(cloud)]?.let { mergeInbox(it, cloud) } ?: cloud }
                        .distinctBy(::inboxKey)
                }
                val excludedAmazonEmails = (inboxes.deletedAmazon + snapshot.deletedAmazon).map { it.email.trim().lowercase() }.toSet()
                val aliasInboxes = officialList.filter { it.isAmazonOnlyAlias && it.email.trim().lowercase() !in excludedAmazonEmails }
                    .map { it.copy(isAmazon = true) }
                val amazonInboxList = (authoritative(inboxes.amazon) { it.isAmazon } + aliasInboxes)
                    .distinctBy { it.email.trim().lowercase() }
                val homeOfficial = officialList.filterNot { it.isAmazonOnlyAlias }
                val bannedInboxList = authoritative(inboxes.banned) { it.isConfirmedBanned }
                    .map { it.copy(banStatus = "confirmed", isBanned = true, isAmazon = true) }
                val suspectedInboxList = authoritative(inboxes.suspected) { it.isSuspected }
                    .filterNot { candidate -> bannedInboxList.any { inboxKey(it) == inboxKey(candidate) } }
                    .map { it.copy(banStatus = "suspected", isBanned = false, isAmazon = true) }

                val active = officialList.firstOrNull { it.id == inboxes.activeId }
                    ?: _uiState.value.activeInbox?.let { previous ->
                        officialList.firstOrNull { inboxKey(it) == inboxKey(previous) }
                    }
                    ?: officialList.firstOrNull()
                val activeMessages = active?.let { inbox -> allMsgsList.filter { messageBelongsToInbox(it, inbox) } }.orEmpty()

                _uiState.update {
                    it.copy(
                        dataLoaded = true,
                        dataError = null,
                        authRequired = false,
                        counts = status.counts.copy(
                            official = homeOfficial.size,
                            temp = 0,
                            messages = allMsgsList.size,
                            amazon = amazonInboxList.size,
                            banned = bannedInboxList.size,
                            suspected = suspectedInboxList.size,
                        ),
                        officialInboxes = homeOfficial,
                        tempInboxes = emptyList(),
                        selectedInboxIds = it.selectedInboxIds.intersect(homeOfficial.map { inbox -> inbox.id }.toSet()),
                        amazonInboxes = amazonInboxList,
                        bannedInboxes = bannedInboxList,
                        suspectedInboxes = suspectedInboxList,
                        deletedAmazonAccounts = (inboxes.deletedAmazon + snapshot.deletedAmazon)
                            .distinctBy { deleted -> deleted.email.lowercase().trim() },
                        gmailAccounts = snapshot.gmailAccounts,
                        appUpdate = appVersion,
                        activeInbox = active?.let { active ->
                            val isConfirmedBanned = AmazonBannedDetector.isConfirmedBanned(active)
                            val isSuspected = AmazonBannedDetector.isSuspectedInbox(active, allMsgsList)
                            val isAmazon = isConfirmedBanned || isSuspected || AmazonDetector.isAmazonInbox(active, allMsgsList)
                            val banStatus = when {
                                isConfirmedBanned -> "confirmed"
                                isSuspected -> "suspected"
                                active.banStatus == "safe" -> "safe"
                                else -> "none"
                            }
                            val reason = if (active.banReason.isNotBlank()) active.banReason else if (isConfirmedBanned || isSuspected) "حساب مقيد / محظور" else ""
                            active.copy(isAmazon = isAmazon, isBanned = isConfirmedBanned, banStatus = banStatus, banReason = reason)
                        },
                        currentMessages = activeMessages,
                        officialMessages = officialMessages,
                        tempMessages = emptyList(),
                        amazonMessages = amazonMsgs,
                        bannedMessages = bannedMsgs,
                        logs = logs,
                        winningMessages = snapshot.winningMessages,
                        online = status.online,
                        cloudConnected = status.cloudConnected,
                        projectId = status.projectId,
                        loading = false,
                        refreshing = false,
                        notice = if (initial || silent) null else "تم تحديث جميع البيانات",
                    )
                }
            }.onFailure { showError(it, initial) }
        }
    }

    fun connectionUrl(): String = repository.connectionUrl()

    fun finishConnection(code: String) {
        viewModelScope.launch {
            runCatching { repository.finishConnection(code) }
                .onSuccess { refreshAll() }
                .onFailure { showError(it) }
        }
    }

    private fun refreshCloudData() {
        // SSE bursts are debounced above; this refresh keeps every cloud-derived
        // classification consistent without reviving the old local cache.
        refreshAll(silent = true)
    }

    private fun refreshStatusOnly() {
        viewModelScope.launch {
            runCatching { repository.status(currentVersionCode) }
                .onSuccess { status ->
                    _uiState.update {
                        it.copy(
                            counts = if (it.dataLoaded) status.counts.copy(official = it.officialInboxes.size, temp = it.tempInboxes.size) else status.counts,
                            online = status.online,
                            cloudConnected = status.cloudConnected,
                            projectId = status.projectId,
                            appUpdate = status.appVersion ?: it.appUpdate,
                        )
                    }
                }
        }
    }

    private fun inboxKey(inbox: Inbox): String = inbox.id.ifBlank { inbox.email.lowercase().trim() }

    private fun mergeInbox(local: Inbox, cloud: Inbox): Inbox = local.copy(
        id = cloud.id.ifBlank { local.id },
        email = cloud.email.ifBlank { local.email },
        label = cloud.label.ifBlank { local.label },
        personName = cloud.personName.ifBlank { local.personName },
        messageCount = maxOf(local.messageCount, cloud.messageCount),
        isAmazon = cloud.isAmazon || cloud.isBanned || cloud.banStatus == "suspected" || local.isAmazon,
        isBanned = cloud.isBanned || cloud.banStatus == "confirmed",
        banStatus = cloud.banStatus.ifBlank { local.banStatus },
        banReason = cloud.banReason.ifBlank { local.banReason },
        isDottedGmailAlias = local.isDottedGmailAlias || cloud.isDottedGmailAlias,
        parentEmail = cloud.parentEmail.ifBlank { local.parentEmail },
    )

    private fun messageBelongsToInbox(message: MailMessage, inbox: Inbox): Boolean {
        val email = inbox.email.trim().lowercase()
        if (email.isBlank()) return false
        val exactRecipient = message.exactRecipient.ifBlank { message.inboxEmail }.trim().lowercase()
        val to = message.to.lowercase()
        val parent = message.parentEmail.trim().lowercase()
        return if (inbox.isDottedGmailAlias) {
            exactRecipient == email || to.contains(email)
        } else {
            exactRecipient == email || to.contains(email) || parent == email
        }
    }

    fun setUpdateDialogVisible(visible: Boolean) {
        _uiState.update { it.copy(showUpdateDialog = visible) }
    }

    fun login(pin: String) {
        if (pin.length < 4) {
            _uiState.update { it.copy(error = "أدخل رمز الأمان المكوّن من 4 أرقام") }
            return
        }
        viewModelScope.launch {
            _uiState.update { it.copy(authBusy = true, error = null) }
            runCatching { repository.login(pin) }
                .onSuccess { accepted ->
                    if (accepted) {
                        _uiState.update { it.copy(authRequired = false, authBusy = false, notice = "تم فتح مركز البريد") }
                        refreshAll(initial = true)
                    } else {
                        _uiState.update { it.copy(authBusy = false, authRequired = true, error = "رمز الأمان غير صحيح") }
                    }
                }
                .onFailure { error ->
                    _uiState.update { it.copy(authBusy = false, authRequired = true, error = error.message ?: "تعذر تسجيل الدخول") }
                }
        }
    }

    fun logout() {
        viewModelScope.launch {
            runCatching { repository.logout() }
            _uiState.update { MailUiState(baseUrl = repository.baseUrl, authRequired = true, loading = false) }
        }
    }

    fun startGmailOAuth() {
        viewModelScope.launch {
            _uiState.update { it.copy(gmailConnecting = true, error = null) }
            runCatching { repository.gmailOAuthAuthUrl() }
                .onSuccess { result ->
                    if (result.authUrl.isBlank()) {
                        _uiState.update { it.copy(gmailConnecting = false, error = "لم يُرجع الخادم رابط ربط Google") }
                        return@onSuccess
                    }
                    val intent = Intent(Intent.ACTION_VIEW, Uri.parse(result.authUrl)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                    getApplication<Application>().startActivity(intent)
                    _uiState.update {
                        it.copy(
                            gmailConnecting = false,
                            notice = "أكمل تسجيل الدخول في Google ثم ارجع إلى التطبيق",
                        )
                    }
                }
                .onFailure { error ->
                    _uiState.update { it.copy(gmailConnecting = false, error = error.message ?: "تعذر بدء ربط Gmail") }
                }
        }
    }

    fun refreshGmailAccounts(silent: Boolean = true) {
        viewModelScope.launch {
            runCatching { repository.gmailAccounts() }
                .onSuccess { accounts ->
                    _uiState.update {
                        it.copy(
                            gmailAccounts = accounts,
                            notice = if (silent) it.notice else "تم تحديث حالة حسابات Gmail",
                        )
                    }
                }
                .onFailure { error -> if (!silent) _uiState.update { it.copy(error = error.message) } }
        }
    }

    fun syncGmail(email: String) {
        viewModelScope.launch {
            _uiState.update { it.copy(gmailBusyEmail = email, error = null) }
            runCatching { repository.syncGmail(email) }
                .onSuccess { result ->
                    _uiState.update {
                        it.copy(
                            gmailBusyEmail = null,
                            notice = if (result.newCount > 0) "وصلت ${result.newCount} رسالة جديدة من Gmail" else "Gmail متزامن ولا توجد رسائل جديدة",
                        )
                    }
                    refreshAll(silent = true)
                }
                .onFailure { error ->
                    val needsReconnect = error.message.orEmpty().contains("ربط") || error.message.orEmpty().contains("صلاحية")
                    _uiState.update {
                        it.copy(
                            gmailBusyEmail = null,
                            error = if (needsReconnect) "انتهت صلاحية Gmail؛ أعد ربط الحساب من Google" else (error.message ?: "تعذرت مزامنة Gmail"),
                        )
                    }
                }
        }
    }

    fun disconnectGmail(email: String) {
        viewModelScope.launch {
            _uiState.update { it.copy(gmailBusyEmail = email, error = null) }
            runCatching { repository.disconnectGmail(email) }
                .onSuccess {
                    _uiState.update { it.copy(gmailBusyEmail = null, notice = "تم فصل $email") }
                    refreshAll(silent = true)
                }
                .onFailure { error -> _uiState.update { it.copy(gmailBusyEmail = null, error = error.message) } }
        }
    }

    fun deleteAmazonAccount(inbox: Inbox) {
        viewModelScope.launch {
            _uiState.update { it.copy(refreshing = true, error = null) }
            runCatching { repository.deleteAmazonAccount(inbox.email) }
                .onSuccess {
                    _uiState.update { it.copy(refreshing = false, notice = "تم استبعاد ${inbox.email} ويمكن استعادته لاحقاً") }
                    refreshAll(silent = true)
                }
                .onFailure { error -> showError(error) }
        }
    }

    fun restoreAmazonAccount(account: DeletedAmazonAccount) {
        viewModelScope.launch {
            _uiState.update { it.copy(refreshing = true, error = null) }
            runCatching { repository.restoreAmazonAccount(account.email) }
                .onSuccess {
                    _uiState.update { it.copy(refreshing = false, notice = "تمت استعادة ${account.email}") }
                    refreshAll(silent = true)
                }
                .onFailure { error -> showError(error) }
        }
    }

    fun toggleInboxSelection(id: String) {
        _uiState.update { state ->
            val selected = state.selectedInboxIds.toMutableSet()
            if (!selected.add(id)) selected.remove(id)
            state.copy(selectedInboxIds = selected)
        }
    }

    fun clearInboxSelection() = _uiState.update { it.copy(selectedInboxIds = emptySet()) }

    fun selectInboxes(ids: Set<String>) = _uiState.update { state ->
        val allowed = state.officialInboxes.filterNot { it.isAmazonOnlyAlias }.map { it.id }.toSet()
        state.copy(selectedInboxIds = ids.intersect(allowed))
    }

    fun deleteSelectedInboxes(ids: Set<String> = _uiState.value.selectedInboxIds) {
        if (ids.isEmpty() || _uiState.value.deletingInboxes) return
        _uiState.update { it.copy(deletingInboxes = true) }
        viewModelScope.launch {
            _uiState.update { it.copy(refreshing = true, error = null) }
            runCatching { repository.batchDeleteInboxes(ids).also { check(it.success) { "تعذر حذف الصناديق المحددة. حاول مجددًا." } } }
                .onSuccess { result ->
                    _uiState.update { it.copy(refreshing = false, deletingInboxes = false, selectedInboxIds = it.selectedInboxIds - ids, notice = "تم حذف ${result.count} صندوق") }
                    refreshAll(silent = true)
                }
                .onFailure { error ->
                    _uiState.update { it.copy(deletingInboxes = false) }
                    showError(error)
                }
        }
    }

    fun navigateMessage(offset: Int) {
        val state = _uiState.value
        val selected = state.selectedMessage ?: return
        val source = when {
            state.section == MainSection.AMAZON -> state.amazonMessages
            state.messageFilter == MessageFilter.OFFICIAL -> state.officialMessages
            else -> state.currentMessages
        }
        if (source.isEmpty()) return
        val index = source.indexOfFirst { it.id == selected.id }
        if (index < 0) return
        val target = source.getOrNull(index + offset) ?: return
        openMessage(target)
    }

    fun openAttachment(message: MailMessage, attachment: MailAttachment) {
        viewModelScope.launch {
            _uiState.update { it.copy(messageLoading = true, messageError = null) }
            runCatching { repository.downloadAttachment(message.id, attachment) }
                .onSuccess { downloaded ->
                    val intent = Intent(Intent.ACTION_VIEW)
                        .setDataAndType(downloaded.uri, downloaded.contentType)
                        .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK)
                    runCatching { getApplication<Application>().startActivity(intent) }
                        .onFailure {
                            _uiState.update { state -> state.copy(messageError = "تم تنزيل المرفق لكن لا يوجد تطبيق مناسب لفتحه") }
                        }
                    _uiState.update { it.copy(messageLoading = false) }
                }
                .onFailure { error ->
                    _uiState.update { it.copy(messageLoading = false, messageError = error.message ?: "تعذر تنزيل المرفق") }
                }
        }
    }

    fun checkForUpdates() {
        viewModelScope.launch {
            _uiState.update { it.copy(refreshing = true, error = null) }
            runCatching {
                val versionInfo = repository.appVersion(currentVersionCode)
                _uiState.update {
                    it.copy(
                        appUpdate = versionInfo,
                        refreshing = false,
                        notice = if (versionInfo.hasUpdate) "يتوفر إصدار أحدث للتطبيق: v${versionInfo.latestVersionName}" else "أنت تستخدم أحدث إصدار من التطبيق (v$currentVersionName)",
                        showUpdateDialog = versionInfo.hasUpdate,
                    )
                }
            }.onFailure { err ->
                _uiState.update { it.copy(refreshing = false, error = "تعذر التحقق من التحديثات: ${err.message}") }
            }
        }
    }

    fun refreshCurrent(silent: Boolean = false) {
        viewModelScope.launch {
            if (!silent) _uiState.update { it.copy(refreshing = true, error = null) }
            val selectedInbox = _uiState.value.activeInbox
            runCatching {
                if (selectedInbox == null) {
                    repository.current()
                } else {
                    val messages = repository.messages().messages.filter { messageBelongsToInbox(it, selectedInbox) }
                    com.batabitoo.mailcenter.data.CurrentPayload(selectedInbox, messages)
                }
            }
                .onSuccess { payload ->
                    _uiState.update {
                        it.copy(
                            activeInbox = payload.inbox ?: selectedInbox,
                            currentMessages = payload.messages,
                            refreshing = false,
                            online = true,
                            notice = if (silent) it.notice else "تم فحص البريد الوارد",
                        )
                    }
                }
                .onFailure { if (!silent) showError(it) }
        }
    }

    fun selectInbox(inbox: Inbox) {
        viewModelScope.launch {
            _uiState.update {
                it.copy(
                    section = MainSection.MESSAGES,
                    messageFilter = MessageFilter.CURRENT,
                    activeInbox = inbox,
                    currentMessages = emptyList(),
                    search = "",
                    refreshing = true,
                    error = null,
                )
            }
            runCatching {
                // Edge selection persistence is best-effort. Navigation must
                // still work when the public Gmail endpoint is unavailable.
                runCatching { repository.selectInbox(inbox.id) }
                val messages = repository.messages().messages.filter { messageBelongsToInbox(it, inbox) }
                com.batabitoo.mailcenter.data.CurrentPayload(inbox, messages)
            }.onSuccess { payload ->
                _uiState.update {
                    it.copy(
                        section = MainSection.MESSAGES,
                        messageFilter = MessageFilter.CURRENT,
                        activeInbox = payload.inbox ?: inbox,
                        currentMessages = payload.messages,
                        search = "",
                        refreshing = false,
                    )
                }
            }.onFailure { showError(it) }
        }
    }

    fun getNextSequentialPrefix(base: String = "ahmedroou"): String {
        val cleanBase = base.trim().lowercase()
        val allEmails = _uiState.value.officialInboxes.map { it.email.lowercase().trim() }
        val regex = Regex("""^${Regex.escape(cleanBase)}(\d+)@batabitoo\.com$""")
        var maxNum = 0
        for (email in allEmails) {
            val match = regex.find(email)
            if (match != null) {
                val num = match.groupValues[1].toIntOrNull() ?: 0
                if (num > maxNum) maxNum = num
            }
        }
        return "$cleanBase${maxNum + 1}"
    }

    fun createSequentialInbox(base: String = "ahmedroou") {
        val nextPrefix = getNextSequentialPrefix(base)
        setCreateType(true, "batabitoo.com")
        createInbox(name = nextPrefix, prefix = nextPrefix)
    }

    fun createInbox(name: String, prefix: String) {
        viewModelScope.launch {
            val official = _uiState.value.createOfficial
            val domain = _uiState.value.createDomain
            _uiState.update { it.copy(refreshing = true, error = null) }
            runCatching {
                val created = repository.createInbox(official, name, prefix, domain = domain)
                repository.selectInbox(created.id)
                created
            }.onSuccess { created ->
                _uiState.update { it.copy(showCreate = false, notice = "تم إنشاء ${created.email}") }
                refreshAll()
                selectInbox(created)
            }.onFailure { showError(it) }
        }
    }

    fun deleteInbox(inbox: Inbox) {
        viewModelScope.launch {
            _uiState.update { it.copy(refreshing = true, error = null) }
            runCatching { repository.deleteInbox(inbox.id) }
                .onSuccess {
                    _uiState.update { it.copy(notice = "تم حذف الصندوق ورسائله") }
                    refreshAll()
                }
                .onFailure { showError(it) }
        }
    }

    fun updateBanStatus(inbox: Inbox, status: String) {
        viewModelScope.launch {
            _uiState.update { it.copy(refreshing = true, error = null) }
            runCatching {
                repository.setBanStatus(inbox.id, status)
            }.onSuccess {
                val actionText = if (status == "confirmed") "تم تأكيد حظر الحساب ⛔" else "تم تأكيد سلامة الحساب واستعادته ✅"
                _uiState.update {
                    it.copy(
                        refreshing = false,
                        notice = actionText,
                        officialInboxes = it.officialInboxes.map { item ->
                            if (item.id == inbox.id) item.copy(banStatus = status, isBanned = (status == "confirmed")) else item
                        },
                        amazonInboxes = it.amazonInboxes.map { item ->
                            if (item.id == inbox.id) item.copy(banStatus = status, isBanned = (status == "confirmed")) else item
                        },
                        bannedInboxes = if (status == "confirmed") {
                            (it.bannedInboxes.filter { b -> b.id != inbox.id } + inbox.copy(banStatus = "confirmed", isBanned = true))
                        } else {
                            it.bannedInboxes.filter { b -> b.id != inbox.id }
                        },
                        suspectedInboxes = it.suspectedInboxes.filter { s -> s.id != inbox.id },
                    )
                }
                refreshAll()
            }.onFailure { err ->
                _uiState.update { it.copy(refreshing = false, error = "تعذر تحديث حالة الحساب: ${err.message}") }
            }
        }
    }

    fun triggerAiVerify(inbox: Inbox) {
        viewModelScope.launch {
            _uiState.update { it.copy(refreshing = true, error = null, notice = "جاري الفحص بالذكاء الاصطناعي... 🤖") }
            runCatching {
                repository.triggerAiVerify(inbox.id)
            }.onSuccess {
                _uiState.update { it.copy(notice = "تم الفحص بالذكاء الاصطناعي 🤖") }
                refreshAll()
            }.onFailure { err ->
                _uiState.update { it.copy(refreshing = false, error = "فشل الفحص: ${err.message}") }
            }
        }
    }

    fun openMessage(message: MailMessage) {
        val request = ++messageRequest
        _uiState.update { it.copy(selectedMessage = message, messageLoading = true, messageError = null) }
        viewModelScope.launch {
            runCatching { repository.message(message.id) }
                .onSuccess { full -> if (request == messageRequest) _uiState.update { it.copy(selectedMessage = full, messageLoading = false) } }
                .onFailure { error -> if (request == messageRequest) _uiState.update { it.copy(messageLoading = false, messageError = error.message ?: "تعذر تحميل الرسالة") } }
        }
    }

    private val replyDrafts = mutableMapOf<String, ReplyDraft>()

    private fun updateReply(draft: ReplyDraft) {
        replyDrafts[draft.messageId] = draft
        _uiState.update { state -> if (state.replyDraft?.messageId == draft.messageId) state.copy(replyDraft = draft) else state }
    }

    fun openReply(message: MailMessage) {
        val draft = replyDrafts.getOrPut(message.id) { ReplyDraft(message.id) }
        _uiState.update { it.copy(replyDraft = draft) }
        if (draft.context != null || draft.loading || draft.sending) return
        updateReply(draft.copy(loading = true, status = "جارٍ التحقق من حساب الإرسال…"))
        viewModelScope.launch {
            runCatching { repository.replyContext(message.id) }
                .onSuccess { context -> updateReply(replyDrafts.getValue(message.id).copy(context = context, loading = false, reconnect = false, status = "")) }
                .onFailure { error -> updateReply(replyDrafts.getValue(message.id).copy(loading = false, status = error.message ?: "تعذر إعداد الرد", reconnect = (error as? ApiException)?.code == "GMAIL_RECONNECT_REQUIRED")) }
        }
    }

    fun closeReply() { _uiState.update { it.copy(replyDraft = null) } }

    fun editReply(text: String) {
        val draft = _uiState.value.replyDraft ?: return
        if (!draft.sending && !draft.locked) updateReply(draft.copy(text = text))
    }

    fun sendReply() {
        val draft = _uiState.value.replyDraft ?: return
        if (draft.sending || draft.locked || draft.context == null || draft.text.isBlank()) return
        updateReply(draft.copy(sending = true, status = "جارٍ إرسال الرد…"))
        viewModelScope.launch {
            runCatching { repository.sendReply(draft) }
                .onSuccess { from -> updateReply(draft.copy(sending = false, text = "", requestId = java.util.UUID.randomUUID().toString(), status = "تم إرسال الرد من $from")) }
                .onFailure { error ->
                    val api = error as? ApiException
                    val uncertain = api == null || api.code == "REPLY_SEND_UNCERTAIN"
                    updateReply(draft.copy(sending = false, locked = uncertain, reconnect = api?.code == "GMAIL_RECONNECT_REQUIRED",
                        status = if (uncertain) "تعذر تأكيد نتيجة الإرسال. تحقق من «المرسلة» في Gmail قبل إرسال رد جديد." else error.message ?: "تعذر إرسال الرد"))
                }
        }
    }

    fun saveBaseUrl(value: String) {
        repository.updateBaseUrl(value)
        _uiState.update { it.copy(baseUrl = repository.baseUrl, notice = "تم حفظ عنوان الخادم") }
        refreshAll()
    }

    fun setSection(value: MainSection) {
        _uiState.update { it.copy(section = value, search = "", selectedInboxIds = emptySet()) }
        if (value == MainSection.SETTINGS) loadStorageStats()
    }

    fun loadStorageStats() {
        viewModelScope.launch {
            runCatching { repository.storageStats() }
                .onSuccess { stats -> _uiState.update { it.copy(storageStats = stats) } }
        }
    }

    fun cleanStorage() {
        viewModelScope.launch {
            _uiState.update { it.copy(storageCleaning = true) }
            runCatching { repository.cleanupStorage() }
                .onSuccess { stats ->
                    _uiState.update {
                        it.copy(
                            storageCleaning = false,
                            storageStats = stats,
                            notice = "تم تنظيف الملفات المؤقتة وتفريغ المساحة بنجاح"
                        )
                    }
                    refreshAll()
                }
                .onFailure { error ->
                    _uiState.update {
                        it.copy(
                            storageCleaning = false,
                            error = error.message ?: "تعذر تنظيف المساحة"
                        )
                    }
                }
        }
    }

    fun setInboxFilter(value: InboxFilter) = _uiState.update { it.copy(inboxFilter = value, search = "", selectedInboxIds = emptySet()) }
    fun setOfficialSubFilter(value: OfficialSubFilter) = _uiState.update { it.copy(officialSubFilter = value, search = "", selectedInboxIds = emptySet()) }
    fun setAmazonTab(value: AmazonTab) = _uiState.update { it.copy(amazonTab = value, search = "") }
    fun setLogsTab(value: LogsTab) = _uiState.update { it.copy(logsTab = value, search = "") }
    fun setAmazonDomainFilter(value: AmazonDomainFilter) = _uiState.update { it.copy(amazonDomainFilter = value, search = "") }
    fun setMessageFilter(value: MessageFilter) = _uiState.update { it.copy(messageFilter = value, search = "") }
    fun setSearch(value: String) = _uiState.update { it.copy(search = value, selectedInboxIds = emptySet()) }
    fun setCreateVisible(value: Boolean) = _uiState.update { it.copy(showCreate = value) }
    fun setShowDottedDialog(value: Boolean) = _uiState.update { it.copy(showDottedDialog = value) }
    fun setCreateType(official: Boolean, domain: String = "batabitoo.com") = _uiState.update { it.copy(createOfficial = official, createDomain = domain) }
    fun setAutoRefresh(value: Boolean) = _uiState.update { it.copy(autoRefresh = value) }
    fun closeMessage() { ++messageRequest; _uiState.update { it.copy(selectedMessage = null, messageLoading = false, messageError = null) } }
    fun consumeNotice() = _uiState.update { it.copy(notice = null, error = null) }

    fun generateDottedVariants(email: String, max: Int = 12): List<String> {
        if (!email.contains("@")) return emptyList()
        val parts = email.split("@")
        val base = parts[0].replace(".", "")
        val domain = parts[1]
        if (base.length < 2) return emptyList()
        val list = mutableListOf<String>()
        for (i in 1 until base.length) {
            if (list.size >= max) break
            val variant = "${base.substring(0, i)}.${base.substring(i)}@$domain".lowercase()
            if (!variant.equals(email, ignoreCase = true)) {
                list.add(variant)
            }
        }
        return list
    }

    fun createDottedGmail(parentEmail: String, dottedEmail: String, label: String) {
        viewModelScope.launch {
            _uiState.update { it.copy(refreshing = true, error = null) }
            runCatching {
                repository.createDottedGmailInbox(parentEmail, dottedEmail, label)
            }.onSuccess { created ->
                _uiState.update { it.copy(showDottedDialog = false, notice = "تم اعتماد حساب أمازون النقطي: ${created.email}") }
                refreshAll()
                selectInbox(created)
            }.onFailure { showError(it) }
        }
    }

    private fun showError(error: Throwable, initial: Boolean = false) {
        val authFailure = (error as? ApiException)?.statusCode == 401 || error.message.orEmpty().let { message ->
            message.contains("401") || message.contains("Unauthorized", ignoreCase = true) || message.contains("جلسة", ignoreCase = true) || message.contains("الوصول مقفل")
        }
        _uiState.update {
            it.copy(
                loading = false,
                refreshing = false,
                online = false,
                error = error.message ?: "تعذر الاتصال بالخادم",
                dataError = if (authFailure) "تعذر تجديد الاتصال الشخصي. بياناتك محفوظة في السحابة وليست فارغة." else error.message ?: "تعذر الاتصال بالخادم",
                notice = null,
                authRequired = it.authRequired || authFailure,
            )
        }
    }
}
