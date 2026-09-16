package com.batabitoo.mailcenter

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.batabitoo.mailcenter.data.AmazonBannedDetector
import com.batabitoo.mailcenter.data.AmazonDetector
import com.batabitoo.mailcenter.data.AppVersionInfo
import com.batabitoo.mailcenter.data.Counts
import com.batabitoo.mailcenter.data.Inbox
import com.batabitoo.mailcenter.data.MailMessage
import com.batabitoo.mailcenter.data.MailRepository
import com.batabitoo.mailcenter.data.RegistrationLog
import com.batabitoo.mailcenter.data.StorageStats
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

enum class MainSection { INBOXES, AMAZON, MESSAGES, LOGS, SETTINGS }
enum class InboxFilter { OFFICIAL, TEMP }
enum class AmazonTab { ALL, BANNED, HEALTHY, MESSAGES }
enum class MessageFilter { CURRENT, OFFICIAL, TEMP }

data class MailUiState(
    val section: MainSection = MainSection.INBOXES,
    val inboxFilter: InboxFilter = InboxFilter.OFFICIAL,
    val amazonTab: AmazonTab = AmazonTab.ALL,
    val messageFilter: MessageFilter = MessageFilter.CURRENT,
    val counts: Counts = Counts(),
    val officialInboxes: List<Inbox> = emptyList(),
    val tempInboxes: List<Inbox> = emptyList(),
    val amazonInboxes: List<Inbox> = emptyList(),
    val bannedInboxes: List<Inbox> = emptyList(),
    val activeInbox: Inbox? = null,
    val currentMessages: List<MailMessage> = emptyList(),
    val officialMessages: List<MailMessage> = emptyList(),
    val tempMessages: List<MailMessage> = emptyList(),
    val amazonMessages: List<MailMessage> = emptyList(),
    val bannedMessages: List<MailMessage> = emptyList(),
    val logs: List<RegistrationLog> = emptyList(),
    val selectedMessage: MailMessage? = null,
    val messageLoading: Boolean = false,
    val messageError: String? = null,
    val search: String = "",
    val online: Boolean = false,
    val cloudConnected: Boolean = false,
    val projectId: String = "",
    val loading: Boolean = true,
    val refreshing: Boolean = false,
    val showCreate: Boolean = false,
    val createOfficial: Boolean = true,
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
)

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
            while (true) {
                delay(8_000)
                if (_uiState.value.autoRefresh && !_uiState.value.refreshing) refreshCurrent(silent = true)
            }
        }
    }

    fun refreshAll(initial: Boolean = false) {
        viewModelScope.launch {
            _uiState.update { it.copy(loading = initial, refreshing = !initial, error = null) }
            runCatching {
                val status = repository.status(currentVersionCode)
                val appVersion = status.appVersion ?: runCatching { repository.appVersion(currentVersionCode) }.getOrNull()
                val inboxes = repository.inboxes()
                val current = repository.current()
                val allMessages = repository.messages()
                val officialMessages = repository.messages("official").messages
                val tempMessages = repository.messages("temp").messages
                val logs = repository.logs()

                val allMsgsList = allMessages.messages.map { msg ->
                    val isBanned = AmazonBannedDetector.isBannedMessage(msg)
                    val isAmazon = isBanned || AmazonDetector.isAmazonMessage(msg)
                    val reason = if (isBanned) AmazonBannedDetector.getBanReason(msg) else ""
                    msg.copy(isAmazon = isAmazon, isBanned = isBanned, banReason = reason)
                }
                val amazonMsgs = allMsgsList.filter { it.isAmazon }
                val bannedMsgs = allMsgsList.filter { it.isBanned }

                val officialList = inboxes.official.map { inbox ->
                    val isBanned = AmazonBannedDetector.isBannedInbox(inbox, allMsgsList)
                    val isAmazon = isBanned || AmazonDetector.isAmazonInbox(inbox, allMsgsList)
                    val matchingMsg = allMsgsList.find { m ->
                        val inboxEmail = inbox.email.lowercase().trim()
                        (m.inboxEmail.lowercase().trim() == inboxEmail || m.to.lowercase().contains(inboxEmail)) && m.isBanned
                    }
                    val reason = if (isBanned) matchingMsg?.banReason?.ifBlank { "حساب مقيد / محظور" } ?: "حساب مقيد / محظور" else ""
                    inbox.copy(isAmazon = isAmazon, isBanned = isBanned, banReason = reason)
                }
                val tempList = inboxes.temp.map { inbox ->
                    inbox.copy(isAmazon = false, isBanned = false)
                }
                val amazonInboxList = officialList.filter { it.isAmazon }
                val bannedInboxList = officialList.filter { it.isBanned }

                _uiState.update {
                    it.copy(
                        counts = status.counts.copy(
                            messages = allMsgsList.size,
                            amazon = amazonInboxList.size,
                            banned = bannedInboxList.size,
                        ),
                        officialInboxes = officialList,
                        tempInboxes = tempList,
                        amazonInboxes = amazonInboxList,
                        bannedInboxes = bannedInboxList,
                        appUpdate = appVersion,
                        activeInbox = current.inbox?.let { active ->
                            val isBanned = AmazonBannedDetector.isBannedInbox(active, allMsgsList)
                            val isAmazon = isBanned || AmazonDetector.isAmazonInbox(active, allMsgsList)
                            val reason = if (isBanned) "حساب مقيد / محظور" else ""
                            active.copy(isAmazon = isAmazon, isBanned = isBanned, banReason = reason)
                        },
                        currentMessages = current.messages.map { msg ->
                            val isBanned = AmazonBannedDetector.isBannedMessage(msg)
                            val isAmazon = isBanned || AmazonDetector.isAmazonMessage(msg)
                            val reason = if (isBanned) AmazonBannedDetector.getBanReason(msg) else ""
                            msg.copy(isAmazon = isAmazon, isBanned = isBanned, banReason = reason)
                        },
                        officialMessages = officialMessages.map { msg ->
                            val isBanned = AmazonBannedDetector.isBannedMessage(msg)
                            val isAmazon = isBanned || AmazonDetector.isAmazonMessage(msg)
                            val reason = if (isBanned) AmazonBannedDetector.getBanReason(msg) else ""
                            msg.copy(isAmazon = isAmazon, isBanned = isBanned, banReason = reason)
                        },
                        tempMessages = tempMessages.map { msg -> msg.copy(isAmazon = false, isBanned = false) },
                        amazonMessages = amazonMsgs,
                        bannedMessages = bannedMsgs,
                        logs = logs,
                        online = status.online,
                        cloudConnected = status.cloudConnected,
                        projectId = status.projectId,
                        loading = false,
                        refreshing = false,
                        notice = if (initial) null else "تم تحديث جميع البيانات",
                    )
                }
            }.onFailure { showError(it, initial) }
        }
    }

    fun setUpdateDialogVisible(visible: Boolean) {
        _uiState.update { it.copy(showUpdateDialog = visible) }
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
            runCatching { repository.current() }
                .onSuccess { payload ->
                    _uiState.update {
                        it.copy(
                            activeInbox = payload.inbox,
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
            _uiState.update { it.copy(refreshing = true, error = null) }
            runCatching {
                repository.selectInbox(inbox.id)
                repository.current()
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
        val allEmails = (_uiState.value.officialInboxes + _uiState.value.tempInboxes).map { it.email.lowercase().trim() }
        val baseEmail = "$cleanBase@batabitoo.com".lowercase()
        if (!allEmails.contains(baseEmail)) {
            return cleanBase
        }
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
        setCreateType(true)
        createInbox(name = nextPrefix, prefix = nextPrefix)
    }

    fun createInbox(name: String, prefix: String) {
        viewModelScope.launch {
            val official = _uiState.value.createOfficial
            _uiState.update { it.copy(refreshing = true, error = null) }
            runCatching {
                val created = repository.createInbox(official, name, prefix)
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

    fun openMessage(message: MailMessage) {
        val request = ++messageRequest
        _uiState.update { it.copy(selectedMessage = message, messageLoading = true, messageError = null) }
        viewModelScope.launch {
            runCatching { repository.message(message.id) }
                .onSuccess { full -> if (request == messageRequest) _uiState.update { it.copy(selectedMessage = full, messageLoading = false) } }
                .onFailure { error -> if (request == messageRequest) _uiState.update { it.copy(messageLoading = false, messageError = error.message ?: "تعذر تحميل الرسالة") } }
        }
    }

    fun saveBaseUrl(value: String) {
        repository.updateBaseUrl(value)
        _uiState.update { it.copy(baseUrl = repository.baseUrl, notice = "تم حفظ عنوان الخادم") }
        refreshAll()
    }

    fun setSection(value: MainSection) {
        _uiState.update { it.copy(section = value, search = "") }
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

    fun setInboxFilter(value: InboxFilter) = _uiState.update { it.copy(inboxFilter = value, search = "") }
    fun setAmazonTab(value: AmazonTab) = _uiState.update { it.copy(amazonTab = value, search = "") }
    fun setMessageFilter(value: MessageFilter) = _uiState.update { it.copy(messageFilter = value, search = "") }
    fun setSearch(value: String) = _uiState.update { it.copy(search = value) }
    fun setCreateVisible(value: Boolean) = _uiState.update { it.copy(showCreate = value) }
    fun setCreateType(official: Boolean) = _uiState.update { it.copy(createOfficial = official) }
    fun setAutoRefresh(value: Boolean) = _uiState.update { it.copy(autoRefresh = value) }
    fun closeMessage() { ++messageRequest; _uiState.update { it.copy(selectedMessage = null, messageLoading = false, messageError = null) } }
    fun consumeNotice() = _uiState.update { it.copy(notice = null, error = null) }

    private fun showError(error: Throwable, initial: Boolean = false) {
        _uiState.update {
            it.copy(
                loading = false,
                refreshing = false,
                online = false,
                error = error.message ?: "تعذر الاتصال بالخادم",
                notice = null,
            )
        }
    }
}
