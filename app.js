'use strict';

const API_BASE = /(?:web\.app|firebaseapp\.com)$/.test(location.hostname) ? 'https://inbox-api.batabitoo.com' : '';
let readerRequest = 0;
let stopReaderResize = () => {};
let readerReturnScroll = 0;
let readerReturnFocus;

const SEEN_KEY = 'batabitoo_seen_inbox_counts';
const BAN_DECISIONS_KEY = 'batabitoo_manual_ban_decisions_v1';
let seenCounts = {};
let manualBanDecisions = {};
try {
  seenCounts = JSON.parse(localStorage.getItem(SEEN_KEY) || '{}');
  manualBanDecisions = JSON.parse(localStorage.getItem(BAN_DECISIONS_KEY) || '{}');
} catch (e) {
  seenCounts = {};
  manualBanDecisions = {};
}

function saveSeenCounts() {
  try {
    localStorage.setItem(SEEN_KEY, JSON.stringify(seenCounts));
  } catch (e) {}
}

function saveManualBanDecision(id, email, status, reason) {
  const decision = { status, reason: reason || '', updatedAt: new Date().toISOString() };
  if (id) manualBanDecisions[`id:${id}`] = decision;
  if (email) manualBanDecisions[`email:${email.toLowerCase()}`] = decision;
  try { localStorage.setItem(BAN_DECISIONS_KEY, JSON.stringify(manualBanDecisions)); } catch (e) {}
}

function getManualBanDecision(inbox) {
  return manualBanDecisions[`id:${inbox?.id}`] || manualBanDecisions[`email:${String(inbox?.email || '').toLowerCase()}`] || null;
}

function isInboxUnread(inbox) {
  if (!inbox || !inbox.id) return false;
  const count = Number(inbox.messageCount || 0);
  if (count <= 0) return false;
  if (inbox.id === state.activeId) return false;
  const seen = seenCounts[inbox.id];
  if (seen === undefined) {
    return count > 0;
  }
  return count > Number(seen);
}

function markInboxAsRead(id, currentCount) {
  if (!id) return;
  const all = [...state.official, ...state.temp, ...state.amazon, ...state.banned];
  const inbox = all.find(i => i.id === id);
  const count = currentCount !== undefined ? currentCount : (inbox ? Number(inbox.messageCount || 0) : 0);
  seenCounts[id] = count;
  saveSeenCounts();
}

function updateFilterUnreadDots() {
  const checkList = (arr) => (arr || []).some(isInboxUnread);
  const officialUnread = checkList(state.official);
  const tempUnread = checkList(state.temp);
  const amazonUnread = checkList(state.amazon);
  const bannedUnread = checkList(state.banned);
  const anyUnread = officialUnread || tempUnread || amazonUnread || bannedUnread;

  document.querySelector('[data-inbox-type="official"] b')?.classList.toggle('has-unread', officialUnread);
  document.querySelector('[data-inbox-type="temp"] b')?.classList.toggle('has-unread', tempUnread);
  document.querySelector('[data-inbox-type="amazon"] b')?.classList.toggle('has-unread', amazonUnread);
  document.querySelector('[data-inbox-type="banned"] b')?.classList.toggle('has-unread', bannedUnread);

  document.querySelector('[data-mobile-view="inboxes"]')?.classList.toggle('has-unread', anyUnread);
}

const state = {
  activeId: null,
  activeInbox: null,
  inboxType: 'official',
  view: 'current',
  createType: 'official',
  amazonView: 'accounts',
  amazonAccountFilter: 'all',
  amazonSubFilter: 'all',
  amazonSelectedInbox: null,
  activeMessageList: [],
  currentMessageIndex: -1,
  official: [],
  temp: [],
  amazon: [],
  banned: [],
  messages: [],
  officialMessages: [],
  tempMessages: [],
  amazonMessages: [],
  bannedMessages: [],
  logs: [],
  currentMessage: null,
  pendingDeleteId: null,
  loading: false
};
let inboxLimit = 40;
let amazonAccountLimit = 24;
let amazonMessageLimit = 20;
const mobileLayout = matchMedia('(max-width: 720px)');
function placeHero() {
  const hero = document.querySelector('.active-inbox-bar');
  const workspace = document.querySelector('.workspace');
  const inAccounts = mobileLayout.matches && !workspace.classList.contains('show-content');
  if (hero) {
    (inAccounts ? $('sidebar') : $('content-panel')).prepend(hero);
  }
  if (state.currentMessage) {
    document.body.dataset.screen = 'reader';
  } else {
    document.body.dataset.screen = inAccounts ? 'inboxes' : state.view === 'logs' ? 'logs' : state.view === 'amazon' ? 'amazon' : 'messages';
  }
  document.dispatchEvent(new Event('mail-layout-change'));
}

function returnToMainInbox() {
  if (state.currentMessage) closeReader(false);
  if (history.state?.screen === 'amazon') {
    history.back();
  } else {
    switchContentView('current');
  }
  if (mobileLayout.matches) {
    if (!state.activeId) {
      document.querySelector('.workspace')?.classList.remove('show-content');
      document.querySelectorAll('[data-mobile-view]').forEach(item => item.classList.toggle('active', item.dataset.mobileView === 'inboxes'));
    } else {
      document.querySelector('.workspace')?.classList.add('show-content');
      document.querySelectorAll('[data-mobile-view]').forEach(item => item.classList.toggle('active', item.dataset.mobileView === 'messages'));
    }
  }
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

const $ = id => document.getElementById(id);

document.addEventListener('DOMContentLoaded', init);

async function init() {
  bindEvents();
  placeHero();
  mobileLayout.addEventListener('change', placeHero);
  const hour = new Date().getHours();
  document.querySelector('.brand-copy > span').textContent = hour < 12 ? 'صباح الخير 👋' : 'مساء الخير 👋';
  updateActiveInbox();
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});

  // Check Google OAuth URL parameters
  const urlParams = new URLSearchParams(window.location.search);
  if (urlParams.get('gmail_connected')) {
    const linkedEmail = urlParams.get('email') || 'Gmail';
    toast(`تم ربط حساب Google (${linkedEmail}) بنجاح ومزامنة الرسائل جارية! 🟢`);
    window.history.replaceState({}, document.title, window.location.pathname);
  } else if (urlParams.get('gmail_error')) {
    toast(`تعذر ربط حساب Google: ${urlParams.get('gmail_error')}`, 'error');
    window.history.replaceState({}, document.title, window.location.pathname);
  }

  await refreshEverything();
  setInterval(() => {
    if (!document.hidden && state.view === 'current' && !state.currentMessage) loadCurrent(true);
  }, 8000);
}

function bindEvents() {
  $('refresh-all').addEventListener('click', refreshEverything);
  $('refresh-current').addEventListener('click', () => loadCurrent(false));
  $('copy-email').addEventListener('click', () => copyText(state.activeInbox?.email, 'تم نسخ عنوان البريد'));
  $('new-inbox-top').addEventListener('click', openCreateModal);
  $('new-inbox-side').addEventListener('click', openCreateModal);
  $('inbox-search').addEventListener('input', () => { inboxLimit = 40; renderInboxes(); });
  $('content-search').addEventListener('input', renderContent);
  $('inbox-filter').addEventListener('click', event => {
    const button = event.target.closest('[data-inbox-type]');
    if (!button) return;
    state.inboxType = button.dataset.inboxType;
    inboxLimit = 40;
    $('inbox-search').value = '';
    document.querySelectorAll('[data-inbox-type]').forEach(item => item.classList.toggle('active', item === button));
    renderInboxes();
  });
  $('content-tabs').addEventListener('click', event => {
    const button = event.target.closest('[data-view]');
    if (!button) return;
    switchContentView(button.dataset.view);
  });
  $('inbox-list').addEventListener('click', event => {
    const openMsgBtn = event.target.closest('[data-open-message]');
    if (openMsgBtn) {
      event.stopPropagation();
      openMessage(decodeURIComponent(openMsgBtn.dataset.openMessage));
      return;
    }
    const confirmBtn = event.target.closest('[data-confirm-ban]');
    if (confirmBtn) {
      event.stopPropagation();
      submitAiFeedback(confirmBtn.dataset.confirmBan, confirmBtn.dataset.msgId, 'confirm', confirmBtn.dataset.msgSubject);
      return;
    }
    const safeBtn = event.target.closest('[data-mark-safe]');
    if (safeBtn) {
      event.stopPropagation();
      submitAiFeedback(safeBtn.dataset.markSafe, safeBtn.dataset.msgId, 'reject', safeBtn.dataset.msgSubject);
      return;
    }
    const aiBtn = event.target.closest('[data-ai-verify]');
    if (aiBtn) {
      event.stopPropagation();
      triggerAiVerify(aiBtn);
      return;
    }
    if (event.target.closest('[data-load-more]')) {
      inboxLimit += 40;
      renderInboxes();
      return;
    }
    const remove = event.target.closest('[data-delete-id]');
    if (remove) {
      event.stopPropagation();
      askDelete(decodeURIComponent(remove.dataset.deleteId));
      return;
    }
    const item = event.target.closest('[data-inbox-id]');
    if (item) selectInbox(decodeURIComponent(item.dataset.inboxId));
  });
  $('message-list').addEventListener('click', event => {
    const openMsgBtn = event.target.closest('[data-open-message]');
    if (openMsgBtn) {
      event.stopPropagation();
      openMessage(decodeURIComponent(openMsgBtn.dataset.openMessage));
      return;
    }
    const confirmBtn = event.target.closest('[data-confirm-ban]');
    if (confirmBtn) {
      event.stopPropagation();
      submitAiFeedback(confirmBtn.dataset.confirmBan, confirmBtn.dataset.msgId, 'confirm', confirmBtn.dataset.msgSubject);
      return;
    }
    const safeBtn = event.target.closest('[data-mark-safe]');
    if (safeBtn) {
      event.stopPropagation();
      submitAiFeedback(safeBtn.dataset.markSafe, safeBtn.dataset.msgId, 'reject', safeBtn.dataset.msgSubject);
      return;
    }
    const aiBtn = event.target.closest('[data-ai-verify]');
    if (aiBtn) {
      event.stopPropagation();
      triggerAiVerify(aiBtn);
      return;
    }
    const otp = event.target.closest('[data-copy-otp]');
    if (otp) {
      event.stopPropagation();
      copyText(decodeURIComponent(otp.dataset.copyOtp), 'تم نسخ رمز التحقق');
      return;
    }
    const message = event.target.closest('[data-message-id]');
    if (message) openMessage(decodeURIComponent(message.dataset.messageId));
  });

  // Brand & Return Navigation
  $('brand-home-btn')?.addEventListener('click', returnToMainInbox);
  $('amazon-back-btn')?.addEventListener('click', returnToMainInbox);
  $('amazon-crumb-home')?.addEventListener('click', returnToMainInbox);
  $('amazon-hero-back-btn')?.addEventListener('click', returnToMainInbox);

  // Dedicated Amazon Hub Event Listeners
  $('open-amazon-hub-btn')?.addEventListener('click', () => {
    if (state.view === 'amazon') returnToMainInbox();
    else switchContentView('amazon');
  });

  // Stats Strip Card Navigation
  $('stat-all-card')?.addEventListener('click', returnToMainInbox);
  $('stat-messages-card')?.addEventListener('click', () => {
    if (state.currentMessage) closeReader(false);
    switchContentView('current');
    if (mobileLayout.matches) {
      document.querySelector('.workspace')?.classList.add('show-content');
      document.querySelectorAll('[data-mobile-view]').forEach(item => item.classList.toggle('active', item.dataset.mobileView === 'messages'));
    }
  });
  $('stat-official-card')?.addEventListener('click', () => switchContentView('official'));
  $('stat-temp-card')?.addEventListener('click', () => switchContentView('temp'));
  $('stat-banned-card')?.addEventListener('click', () => switchContentView('banned'));
  $('stat-amazon-card')?.addEventListener('click', () => {
    if (state.view === 'amazon') returnToMainInbox();
    else switchContentView('amazon');
  });
  $('amazon-quick-create-btn')?.addEventListener('click', createQuickAmazonInbox);
  $('amazon-copy-active-btn')?.addEventListener('click', () => copyText(state.activeInbox?.email, 'تم نسخ عنوان البريد النشط'));
  $('amazon-refresh-btn')?.addEventListener('click', refreshAmazonHub);
  $('amazon-search')?.addEventListener('input', () => {
    amazonAccountLimit = 24;
    amazonMessageLimit = 20;
    renderAmazonHub();
  });
  $('amazon-sub-tabs')?.addEventListener('click', event => {
    const btn = event.target.closest('[data-amazon-view]');
    if (!btn) return;
    setAmazonView(btn.dataset.amazonView, btn.dataset.accountFilter || btn.dataset.amazonFilter || 'all');
  });
  $('amazon-hub-shell')?.addEventListener('click', event => {
    const stat = event.target.closest('.amazon-stat-tile[data-amazon-view]');
    if (stat) setAmazonView(stat.dataset.amazonView, stat.dataset.accountFilter || 'all');
  });
  $('amazon-inboxes-reel')?.addEventListener('click', event => {
    if (event.target.closest('#reel-quick-add')) {
      createQuickAmazonInbox();
      return;
    }
    if (event.target.closest('[data-amazon-load-more]')) {
      amazonAccountLimit += 24;
      renderAmazonInboxesReel();
      return;
    }
    const copy = event.target.closest('[data-amazon-copy]');
    if (copy) { copyText(decodeURIComponent(copy.dataset.amazonCopy), 'تم نسخ عنوان البريد'); return; }
    const messages = event.target.closest('[data-amazon-messages]');
    if (messages) {
      state.amazonSelectedInbox = decodeURIComponent(messages.dataset.amazonMessages);
      setAmazonView('messages', 'all');
      return;
    }
    const confirm = event.target.closest('[data-confirm-ban]');
    if (confirm) { updateBanStatus(confirm.dataset.confirmBan, 'confirmed', confirm.dataset.reason || ''); return; }
    const safe = event.target.closest('[data-mark-safe]');
    if (safe) { updateBanStatus(safe.dataset.markSafe, 'safe'); return; }
    const ai = event.target.closest('[data-ai-verify]');
    if (ai) triggerAiVerify(ai);
  });
  $('amazon-message-list')?.addEventListener('click', event => {
    if (event.target.closest('[data-amazon-messages-more]')) {
      amazonMessageLimit += 20;
      renderAmazonMessages();
      return;
    }
    const openMsgBtn = event.target.closest('[data-open-message]');
    if (openMsgBtn) {
      event.stopPropagation();
      openMessage(decodeURIComponent(openMsgBtn.dataset.openMessage));
      return;
    }
    const confirmBtn = event.target.closest('[data-confirm-ban]');
    if (confirmBtn) {
      event.stopPropagation();
      submitAiFeedback(confirmBtn.dataset.confirmBan, confirmBtn.dataset.msgId, 'confirm', confirmBtn.dataset.msgSubject);
      return;
    }
    const safeBtn = event.target.closest('[data-mark-safe]');
    if (safeBtn) {
      event.stopPropagation();
      submitAiFeedback(safeBtn.dataset.markSafe, safeBtn.dataset.msgId, 'reject', safeBtn.dataset.msgSubject);
      return;
    }
    const aiBtn = event.target.closest('[data-ai-verify]');
    if (aiBtn) {
      event.stopPropagation();
      triggerAiVerify(aiBtn);
      return;
    }
    const otp = event.target.closest('[data-copy-otp]');
    if (otp) {
      event.stopPropagation();
      copyText(decodeURIComponent(otp.dataset.copyOtp), 'تم نسخ رمز التحقق');
      return;
    }
    const message = event.target.closest('[data-message-id]');
    if (message) openMessage(decodeURIComponent(message.dataset.messageId));
  });

  // Dedicated Message Reader Navigation & Actions
  $('reader-back-btn')?.addEventListener('click', () => closeReader());
  $('reader-prev-btn')?.addEventListener('click', navigatePreviousMessage);
  $('reader-next-btn')?.addEventListener('click', navigateNextMessage);
  $('reader-print-btn')?.addEventListener('click', printCurrentMessage);
  $('reader-retry-btn')?.addEventListener('click', () => { if (state.currentMessage?.id) openMessage(state.currentMessage.id, false); });
  $('reader-copy-otp-btn')?.addEventListener('click', () => copyText(state.currentMessage?.otp, 'تم نسخ رمز التحقق'));
  $('reader-copy-all-btn')?.addEventListener('click', () => {
    const raw = state.currentMessage?.text || state.currentMessage?.intro || state.currentMessage?.subject || '';
    const text = decodeBase64IfNeeded(raw);
    copyText(text, 'تم نسخ نص الرسالة');
  });
  $('reader-confirm-rule-btn')?.addEventListener('click', () => {
    const banner = $('reader-learning-banner');
    const inboxId = banner?.getAttribute('data-inbox-id');
    const msgId = banner?.getAttribute('data-msg-id');
    const subject = banner?.getAttribute('data-msg-subject');
    if (inboxId) submitAiFeedback(inboxId, msgId, 'confirm', subject);
  });
  $('reader-reject-rule-btn')?.addEventListener('click', () => {
    const banner = $('reader-learning-banner');
    const inboxId = banner?.getAttribute('data-inbox-id');
    const msgId = banner?.getAttribute('data-msg-id');
    const subject = banner?.getAttribute('data-msg-subject');
    if (inboxId) submitAiFeedback(inboxId, msgId, 'reject', subject);
  });

  window.addEventListener('popstate', event => {
    if (event.state?.screen === 'reader') {
      openMessage(event.state.messageId, false);
    } else if (state.currentMessage) {
      closeReader(false);
    } else if (event.state?.screen === 'amazon') {
      switchContentView('amazon', false);
    } else if (state.view === 'amazon') {
      switchContentView('current', false);
    }
  });

  document.querySelectorAll('[data-close-modal]').forEach(button => button.addEventListener('click', () => closeModal(button.dataset.closeModal)));
  document.querySelectorAll('.modal-backdrop').forEach(backdrop => backdrop.addEventListener('click', event => {
    if (event.target === backdrop) backdrop.classList.add('hidden');
  }));

  $('create-type').addEventListener('click', event => {
    const button = event.target.closest('[data-create-type]');
    if (!button) return;
    state.createType = button.dataset.createType;
    document.querySelectorAll('[data-create-type]').forEach(item => item.classList.toggle('active', item === button));

    const standardForm = $('create-form');
    const gmailSection = $('gmail-connect-section');
    const seqBtn = $('seq-official-btn');
    const modalTitle = $('modal-title');
    const modalDesc = $('modal-desc');

    if (state.createType === 'official') {
      if (modalTitle) modalTitle.textContent = 'صندوق بريد رسمي جديد';
      if (modalDesc) modalDesc.textContent = 'أنشئ صندوقاً رسمياً على نطاق @batabitoo.com.';
      standardForm?.classList.remove('hidden');
      gmailSection?.classList.add('hidden');
      seqBtn?.classList.remove('hidden');
      $('prefix-suffix').textContent = '@batabitoo.com';
      if ($('create-prefix-help')) $('create-prefix-help').textContent = 'الأحرف الإنجليزية والأرقام والنقطة فقط.';
    } else if (state.createType === 'gmail') {
      if (modalTitle) modalTitle.textContent = 'ربط ومزامنة حساب Gmail فعلي';
      if (modalDesc) modalDesc.textContent = 'اربط حساب Google حقيقي لجلب الرسائل ورموز OTP تلقائياً.';
      standardForm?.classList.add('hidden');
      gmailSection?.classList.remove('hidden');
      seqBtn?.classList.add('hidden');
    } else {
      if (modalTitle) modalTitle.textContent = 'صندوق بريد سريع';
      if (modalDesc) modalDesc.textContent = 'صندوق مؤقت جاهز بلحظات لأغراض التسجيل المؤقت.';
      standardForm?.classList.remove('hidden');
      gmailSection?.classList.add('hidden');
      seqBtn?.classList.add('hidden');
      $('prefix-suffix').textContent = '@نطاق سريع';
      if ($('create-prefix-help')) $('create-prefix-help').textContent = 'جاهز بلحظات - سيُختار نطاق سريع تلقائيًا.';
    }
  });

  // Gmail Sub-method Tabs (App Password vs OAuth)
  $('gmail-method-tabs')?.addEventListener('click', event => {
    const tabBtn = event.target.closest('[data-gmail-method]');
    if (!tabBtn) return;
    const method = tabBtn.dataset.gmailMethod;
    document.querySelectorAll('[data-gmail-method]').forEach(b => b.classList.toggle('active', b === tabBtn));
    if (method === 'app_password') {
      $('gmail-app-form')?.classList.remove('hidden');
      $('gmail-oauth-panel')?.classList.add('hidden');
    } else {
      $('gmail-app-form')?.classList.add('hidden');
      $('gmail-oauth-panel')?.classList.remove('hidden');
    }
  });

  // Handle Real Gmail App Password Submission
  $('gmail-app-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = $('gmail-app-name')?.value.trim();
    const email = $('gmail-app-email')?.value.trim();
    const appPassword = $('gmail-app-password')?.value.trim();

    if (!email || !email.endsWith('@gmail.com')) {
      toast('يرجى كتابة عنوان بريد Gmail صالح (@gmail.com)', 'error');
      return;
    }
    if (!appPassword || appPassword.replace(/\s+/g, '').length < 16) {
      toast('كلمة مرور التطبيقات يجب أن تتكون من 16 حرفاً من Google', 'error');
      return;
    }

    const submitBtn = $('gmail-app-submit');
    setBusy(submitBtn, true, 'جاري التحقق والربط بسيرفرات Google...');
    try {
      let result = null;
      try {
        const res = await fetch('/api/gmail/connect-app-password', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, appPassword, personName: name })
        });
        result = await res.json();
      } catch (netErr) {
        try {
          const directRes = await fetch('http://localhost:3030/api/gmail/connect-app-password', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, appPassword, personName: name })
          });
          result = await directRes.json();
        } catch (e2) {
          throw new Error('تعذر الاتصال بخادم المزامنة الخلفي. يرجى التأكد من تشغيل الخادم.');
        }
      }

      if (!result || !result.success) {
        throw new Error(result?.error || 'تعذر ربط حساب Gmail. تأكد من كلمة مرور التطبيقات.');
      }

      // Sync record to Firestore
      const cleanEmail = email.toLowerCase().trim();
      const docId = `gmail_${cleanEmail.replace(/[^a-z0-9]/g, '_')}`;
      const firestoreFields = {
        id: { stringValue: docId },
        email: { stringValue: cleanEmail },
        domain: { stringValue: 'gmail.com' },
        host: { stringValue: 'Gmail (Google Official Real)' },
        isOfficial: { booleanValue: true },
        isAmazon: { booleanValue: false },
        isBanned: { booleanValue: false },
        banStatus: { stringValue: 'none' },
        banReason: { stringValue: '' },
        type: { stringValue: 'official' },
        label: { stringValue: name || cleanEmail.split('@')[0] },
        personName: { stringValue: name || cleanEmail.split('@')[0] },
        isRealGmail: { booleanValue: true },
        gmailAuthType: { stringValue: 'app_password' },
        createdAt: { stringValue: new Date().toISOString() },
        messageCount: { integerValue: "0" }
      };
      await fetch(`https://firestore.googleapis.com/v1/projects/batabitoo-mail-2026/databases/(default)/documents/inboxes?documentId=${docId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fields: firestoreFields })
      }).catch(() => {});

      closeModal('create');
      toast(`تم ربط ${cleanEmail} بنجاح ومزامنة الرسائل الواردة جارية! 🟢`);
      state.activeInbox = cleanEmail;
      await fetchInboxes();
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setBusy(submitBtn, false, 'ربط واختبار الاتصال فوراً');
    }
  });

  // Handle Google OAuth
  $('start-google-oauth-btn')?.addEventListener('click', async () => {
    try {
      const res = await fetch('/api/gmail/oauth/auth-url');
      const data = await res.json();
      if (data.success && data.authUrl) {
        window.location.href = data.authUrl;
      } else {
        toast(data.error || 'يرجى حفظ Google Client ID أولاً من الخيارات المتقدمة بالأسفل.', 'error');
        $('oauth-custom-settings')?.classList.remove('hidden');
      }
    } catch (e) {
      toast('تعذر جلب رابط مصادقة Google: ' + e.message, 'error');
    }
  });

  $('toggle-oauth-settings-btn')?.addEventListener('click', () => {
    $('oauth-custom-settings')?.classList.toggle('hidden');
  });

  $('save-oauth-settings-btn')?.addEventListener('click', async () => {
    const clientId = $('oauth-client-id-input')?.value.trim();
    const clientSecret = $('oauth-client-secret-input')?.value.trim();
    if (!clientId) {
      toast('يرجى إدخال Client ID', 'error');
      return;
    }
    try {
      await fetch('/api/gmail/oauth/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientId, clientSecret })
      });
      toast('تم حفظ إعدادات Google OAuth بنجاح!');
    } catch (e) {
      toast('تعذر حفظ الإعدادات: ' + e.message, 'error');
    }
  });

  $('seq-official-btn').addEventListener('click', () => {
    const next = getNextSequentialPrefix('ahmedroou');
    state.createType = 'official';
    document.querySelectorAll('[data-create-type]').forEach(item => item.classList.toggle('active', item.dataset.createType === 'official'));
    $('prefix-suffix').textContent = '@batabitoo.com';
    $('create-prefix').value = next;
    if (!$('create-name').value || $('create-name').value.startsWith('ahmedroou')) {
      $('create-name').value = next;
    }
    $('seq-preview').textContent = next;
    toast(`تم تجهيز البريد: ${next}@batabitoo.com`);
  });
  $('create-form').addEventListener('submit', createInbox);
  $('cancel-delete').addEventListener('click', () => $('confirm-delete').classList.add('hidden'));
  $('accept-delete').addEventListener('click', deleteInbox);
  $('mobile-nav').addEventListener('click', event => {
    const button = event.target.closest('[data-mobile-view]');
    if (!button) return;
    const target = button.dataset.mobileView;
    if (target === 'create') {
      openCreateModal();
      return;
    }
    if (state.currentMessage) closeReader(false);
    document.querySelectorAll('[data-mobile-view]').forEach(item => item.classList.toggle('active', item === button));
    if (target === 'inboxes') {
      document.querySelector('.workspace').classList.remove('show-content');
      if (state.view === 'amazon') switchContentView('current', false);
    } else if (target === 'amazon') {
      document.querySelector('.workspace').classList.add('show-content');
      switchContentView('amazon');
    } else {
      document.querySelector('.workspace').classList.add('show-content');
      if (target === 'logs') switchContentView('logs');
      else switchContentView('current');
    }
    placeHero();
  });
  document.addEventListener('keydown', event => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    const row = event.target.closest('article[data-inbox-id], article[data-message-id]');
    if (row && event.target === row) { event.preventDefault(); row.click(); }
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape') {
      if (state.currentMessage) {
        closeReader();
        return;
      }
      if (state.view === 'amazon') {
        returnToMainInbox();
        return;
      }
      document.querySelectorAll('.modal-backdrop').forEach(item => item.classList.add('hidden'));
    }
    if (event.target.tagName === 'INPUT' || event.target.tagName === 'TEXTAREA') return;
    if (state.currentMessage) {
      if (event.key === 'j' || event.key === 'ArrowDown') {
        event.preventDefault();
        navigateNextMessage();
      } else if (event.key === 'k' || event.key === 'ArrowUp') {
        event.preventDefault();
        navigatePreviousMessage();
      }
    }
  });
}

function parseFirestoreDoc(doc) {
  if (!doc || !doc.fields) return {};
  const fields = doc.fields;
  const res = {};
  for (const key of Object.keys(fields)) {
    const val = fields[key];
    if (val.stringValue !== undefined) res[key] = val.stringValue;
    else if (val.booleanValue !== undefined) res[key] = val.booleanValue;
    else if (val.integerValue !== undefined) res[key] = parseInt(val.integerValue, 10);
    else if (val.doubleValue !== undefined) res[key] = parseFloat(val.doubleValue);
    else if (val.nullValue !== undefined) res[key] = null;
    else if (val.arrayValue !== undefined) res[key] = (val.arrayValue.values || []).map(v => v.stringValue !== undefined ? v.stringValue : v.integerValue !== undefined ? parseInt(v.integerValue, 10) : v);
    else if (val.mapValue !== undefined) res[key] = val.mapValue.fields;
  }
  const name = doc.name || '';
  if (!res.id) res.id = name.split('/').pop() || '';
  return res;
}

async function fetchFirestoreInboxes() {
  const url = 'https://firestore.googleapis.com/v1/projects/batabitoo-mail-2026/databases/(default)/documents/inboxes?pageSize=300';
  const res = await fetch(url);
  const data = await res.json();
  const docs = data.documents || [];
  const allList = docs.map(parseFirestoreDoc).filter(i => i.email);
  const official = allList.filter(i => i.isOfficial || i.type === 'official' || (i.email && (i.email.endsWith('@batabitoo.com') || i.email.endsWith('@gmail.com'))));
  const temp = allList.filter(i => !official.includes(i));
  const banned = allList.filter(i => (i.banStatus === 'confirmed' || i.isBanned) && (i.isOfficial || i.type === 'official'));
  const suspected = allList.filter(i => i.banStatus === 'suspected' && (i.isOfficial || i.type === 'official'));
  const amazon = allList.filter(i => (i.isAmazon || i.banStatus === 'confirmed' || i.banStatus === 'suspected') && (i.isOfficial || i.type === 'official'));
  return {
    activeId: official[0]?.id || temp[0]?.id || null,
    official,
    temp,
    amazon,
    banned,
    suspected
  };
}

async function fetchFirestoreMessages(type = null) {
  const url = 'https://firestore.googleapis.com/v1/projects/batabitoo-mail-2026/databases/(default)/documents/messages?pageSize=300';
  const res = await fetch(url);
  const data = await res.json();
  const docs = data.documents || [];
  const msgList = docs.map(parseFirestoreDoc).filter(m => m.id);
  const official = msgList.filter(m => m.isOfficialDomain || (m.inboxEmail || m.to || '').endsWith('@batabitoo.com') || (m.inboxEmail || m.to || '').endsWith('@gmail.com'));
  const temp = msgList.filter(m => !official.includes(m));
  const banned = msgList.filter(m => m.isBanned);
  const amazon = msgList.filter(m => m.isAmazon || m.isBanned);

  let returned = msgList;
  if (type === 'official') returned = official;
  else if (type === 'temp') returned = temp;
  else if (type === 'amazon') returned = amazon;
  else if (type === 'banned') returned = banned;

  return {
    counts: {
      total: msgList.length,
      official: official.length,
      temp: temp.length,
      amazon: amazon.length,
      banned: banned.length
    },
    official,
    temp,
    amazon,
    banned,
    messages: returned
  };
}

async function api(path, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(API_BASE + path, { ...options, signal: controller.signal });
    const data = await response.json().catch(() => ({}));
    if (response.ok) return data;
    throw new Error(data.error || `HTTP ${response.status}`);
  } catch (err) {
    try {
      if (path.startsWith('/api/inboxes')) {
        return await fetchFirestoreInboxes();
      }
      if (path.startsWith('/api/all-messages')) {
        const urlParams = new URLSearchParams(path.split('?')[1] || '');
        const type = urlParams.get('type');
        return await fetchFirestoreMessages(type);
      }
      if (path.startsWith('/api/inbox/current')) {
        const [inboxes, messages] = await Promise.all([fetchFirestoreInboxes(), fetchFirestoreMessages()]);
        const activeInbox = inboxes.official[0] || inboxes.temp[0] || null;
        return { inbox: activeInbox, messages: messages.messages };
      }
      if (path.startsWith('/api/status')) {
        const [inboxes, messages] = await Promise.all([fetchFirestoreInboxes(), fetchFirestoreMessages()]);
        return {
          status: 'online',
          cloudConnected: true,
          counts: {
            totalInboxes: inboxes.official.length + inboxes.temp.length,
            official: inboxes.official.length,
            temp: inboxes.temp.length,
            amazon: inboxes.amazon.length,
            banned: inboxes.banned.length,
            messages: messages.counts.total
          }
        };
      }
      if (path.startsWith('/api/official/create') && options.body) {
        const bodyObj = JSON.parse(options.body);
        const reqDom = (bodyObj.domain || 'batabitoo.com').toLowerCase();
        const effectiveDomain = reqDom.includes('gmail') ? 'gmail.com' : 'batabitoo.com';
        const rawPrefix = (bodyObj.prefix || bodyObj.email || 'amazon.acc').toLowerCase().trim();
        let email = rawPrefix.includes('@') ? rawPrefix : `${rawPrefix.replace(/[^a-z0-9\.]/g, '') || 'amazon.acc'}@${effectiveDomain}`;
        const cleanName = bodyObj.personName || bodyObj.label || `حساب رسمي (${email.split('@')[0]})`;
        const docId = `official_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
        const record = {
          id: docId,
          email: email,
          domain: effectiveDomain,
          host: effectiveDomain === 'gmail.com' ? 'Gmail (Google Official)' : 'batabitoo.com (Official Trusted)',
          isOfficial: true,
          isAmazon: false,
          isBanned: false,
          banStatus: 'none',
          banReason: '',
          type: 'official',
          label: cleanName,
          personName: cleanName,
          createdAt: new Date().toISOString(),
          messageCount: 0
        };
        const firestoreFields = {
          id: { stringValue: docId },
          email: { stringValue: email },
          domain: { stringValue: effectiveDomain },
          host: { stringValue: record.host },
          isOfficial: { booleanValue: true },
          isAmazon: { booleanValue: false },
          isBanned: { booleanValue: false },
          banStatus: { stringValue: 'none' },
          banReason: { stringValue: '' },
          type: { stringValue: 'official' },
          label: { stringValue: cleanName },
          personName: { stringValue: cleanName },
          createdAt: { stringValue: record.createdAt },
          messageCount: { integerValue: "0" }
        };
        const fsRes = await fetch(`https://firestore.googleapis.com/v1/projects/batabitoo-mail-2026/databases/(default)/documents/inboxes?documentId=${docId}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ fields: firestoreFields })
        });
        if (fsRes.ok) return { success: true, inbox: record };
      }
      if (path.startsWith('/api/nivea/logs')) {
        return [];
      }
    } catch (fsErr) {
      console.error('Firestore API fallback error:', fsErr);
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

async function refreshEverything() {
  if (state.loading) return;
  state.loading = true;
  $('refresh-all').classList.add('spin');
  try {
    await Promise.all([loadStatus(), loadInboxes(), loadCounts(), loadLogs(false).catch(() => [])]);
    if (state.view === 'current') await loadCurrent(true);
    else if (state.view === 'official' || state.view === 'temp' || state.view === 'amazon' || state.view === 'banned') await loadSeparated(state.view);
    else renderContent();
    setConnection(true);
    toast('تم تحديث جميع البيانات');
  } catch (error) {
    setConnection(false);
    toast(friendlyError(error), true);
  } finally {
    state.loading = false;
    $('refresh-all').classList.remove('spin');
  }
}

async function loadStatus() {
  const data = await api('/api/status');
  $('stat-total').textContent = formatNumber(data.counts?.totalInboxes);
  $('stat-official').textContent = formatNumber(data.counts?.official);
  $('stat-temp').textContent = formatNumber(data.counts?.temp);
  if ($('stat-amazon')) $('stat-amazon').textContent = formatNumber(data.counts?.amazon || 0);
  if ($('stat-banned')) $('stat-banned').textContent = formatNumber(data.counts?.banned || 0);
  $('stat-messages').textContent = formatNumber(data.counts?.messages);
  $('stat-sync').textContent = data.cloudConnected ? 'متصل بسحابة Firebase' : 'يعمل من التخزين المحلي';
  setConnection(true, data.cloudConnected);
}

async function updateBanStatus(targetIdOrEmail, banStatus, reason = '') {
  const inbox = findInboxById(targetIdOrEmail);
  const targetId = inbox?.id || targetIdOrEmail;
  const email = inbox?.email || (targetIdOrEmail.includes('@') ? targetIdOrEmail : '');

  const isConfirmed = banStatus === 'confirmed';
  const effectiveReason = reason || inbox?.banReason || (isConfirmed ? 'إغلاق وتأكيد الحظر' : '');

  const updateInboxObj = (item) => {
    if ((item.id && item.id === targetId) || (item.email && item.email.toLowerCase() === email.toLowerCase())) {
      return {
        ...item,
        banStatus: banStatus,
        isBanned: isConfirmed,
        isAmazon: isConfirmed ? true : item.isAmazon,
        banReason: effectiveReason
      };
    }
    return item;
  };

  state.official = state.official.map(updateInboxObj);
  state.temp = state.temp.map(updateInboxObj);
  state.amazon = state.amazon.map(updateInboxObj);
  if (isConfirmed) {
    const updatedTarget = inbox ? updateInboxObj(inbox) : { id: targetId, email, banStatus: 'confirmed', isBanned: true, isAmazon: true, banReason: effectiveReason, isOfficial: true };
    if (!state.banned.some(i => i.id === targetId || i.email === email)) {
      state.banned.push(updatedTarget);
    } else {
      state.banned = state.banned.map(updateInboxObj);
    }
  } else {
    state.banned = state.banned.filter(i => i.id !== targetId && i.email !== email);
  }
  state.suspected = (state.suspected || []).filter(i => i.id !== targetId && i.email !== email);

  if ($('banned-count')) $('banned-count').textContent = formatNumber(state.banned.length);
  renderInboxes();
  if (state.view === 'amazon' || state.view === 'banned' || state.view === 'current') renderContent();

  let persisted = false;
  try {
    await api('/api/inbox/ban-status', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: targetId, email: email, banStatus, reason: effectiveReason })
    });
    persisted = true;
  } catch (err) {
    try {
      let docIdsToTry = [];
      if (inbox && inbox.id) docIdsToTry.push(inbox.id);
      if (targetId && !docIdsToTry.includes(targetId)) docIdsToTry.push(targetId);
      if (email) {
        docIdsToTry.push(`inbox_${email.toLowerCase().replace(/[^a-z0-9]/g, '_')}`);
      }

      for (const docId of docIdsToTry) {
        if (!docId) continue;
        const updateUrl = `https://firestore.googleapis.com/v1/projects/batabitoo-mail-2026/databases/(default)/documents/inboxes/${encodeURIComponent(docId)}?updateMask.fieldPaths=banStatus&updateMask.fieldPaths=isBanned&updateMask.fieldPaths=isAmazon&updateMask.fieldPaths=banReason&updateMask.fieldPaths=banDecisionSource&updateMask.fieldPaths=banDecisionAt`;
        const res = await fetch(updateUrl, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            fields: {
              banStatus: { stringValue: banStatus },
              isBanned: { booleanValue: isConfirmed },
              isAmazon: { booleanValue: true },
              banReason: { stringValue: effectiveReason },
              banDecisionSource: { stringValue: 'user' },
              banDecisionAt: { timestampValue: new Date().toISOString() }
            }
          })
        });
        if (res.ok) {
          persisted = true;
          break;
        }
      }
    } catch (fsErr) {
      console.error('Firestore REST fallback error:', fsErr);
    }
  }
  if (!persisted) {
    await loadInboxes().catch(() => {});
    if (state.view === 'amazon') renderAmazonHub();
    toast('تعذر تثبيت حالة الحساب؛ لم يتم اعتباره محظورًا', true);
    return false;
  }
  saveManualBanDecision(targetId, email, banStatus, effectiveReason);
  const text = isConfirmed ? 'تم نقل الحساب إلى قائمة المحظورة ⛔' : 'تم نقل الحساب إلى قائمة السليمة ✅';
  toast(text);
  return true;
}

const autoCheckedInboxes = new Set();

function findInboxById(id) {
  if (!id) return null;
  return [...state.official, ...state.temp, ...state.amazon, ...state.banned, ...(state.suspected || [])].find(i => i.id === id || i.email === id);
}

function findSuspectedMessageForInbox(inbox) {
  if (!inbox) return null;
  const email = String(inbox.email || '').toLowerCase().trim();
  const allMsgs = [...state.messages, ...(state.officialMessages || []), ...(state.amazonMessages || []), ...(state.bannedMessages || [])];
  return allMsgs.find(m => (String(m.inboxEmail || '').toLowerCase().trim() === email || formatAddress(m.to).toLowerCase().includes(email)) && isBannedMessage(m));
}

async function submitAiFeedback(inboxId, messageId, verdict, subject = '') {
  const isConfirm = verdict === 'confirm' || verdict === 'banned';
  const banStatus = isConfirm ? 'confirmed' : 'safe';
  const inbox = findInboxById(inboxId);
  const reason = isConfirm ? 'إغلاق وتأكيد الحظر' : 'استبعاد النمط وتدريب الكود';

  const persisted = await updateBanStatus(inboxId, banStatus, reason);
  if (!persisted) return;

  if (state.currentMessage) closeReader(false);

  try {
    await api('/api/ai/feedback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ inboxId, messageId, verdict, subject })
    });
  } catch (err) {
    // Ignore secondary feedback log errors
  }
}

async function autoVerifySuspectedInboxes() {
  const pending = (state.suspected || []).filter(inbox => inbox && inbox.id && !autoCheckedInboxes.has(inbox.id));
  if (!pending.length) return;

  for (const inbox of pending) {
    autoCheckedInboxes.add(inbox.id);
    try {
      const res = await api('/api/inbox/ai-verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: inbox.id })
      });

      if (res && res.success && res.aiResult) {
        const verdict = res.aiResult;
        if (verdict.classification === 'banned') {
          toast(`🤖 AI تلقائي: تم تأكيد حظر الحساب ⛔ (${inbox.email || ''})`);
          await refreshEverything();
        } else if (verdict.classification === 'safe') {
          toast(`🤖 AI تلقائي: الحساب سليم ومجتاز للفحص ✅ (${inbox.email || ''})`);
          await refreshEverything();
        } else {
          // AI returned uncertain or could not determine
          toast(`⚠️ تنبيه الذكاء الاصطناعي: لم يتمكن AI من جزم حالة الحساب (${inbox.email || ''}): ${verdict.reason || 'النتيجة غير حاسمة'}`, true);
        }
      } else {
        const errReason = res?.error || res?.reason || 'لا تتوفر استجابة حاسمة من نموذج AI';
        toast(`⚠️ تنبيه الذكاء الاصطناعي: تعذر فحص الحساب (${inbox.email || ''}): ${errReason}`, true);
      }
    } catch (err) {
      toast(`⚠️ تنبيه الذكاء الاصطناعي: فشل الاتصال بنموذج AI لفحص (${inbox.email || ''}): ${friendlyError(err)}`, true);
    }
  }
}

async function triggerAiVerify(btn) {
  const inboxId = btn.dataset.aiVerify;
  const inbox = findInboxById(inboxId);
  const emailLabel = inbox?.email || '';
  setBusy(btn, true, 'جاري الفحص... 🤖');
  try {
    const res = await api('/api/inbox/ai-verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: inboxId })
    });
    if (res && res.success && res.aiResult) {
      const verdict = res.aiResult;
      if (verdict.classification === 'banned') {
        toast(`🤖 AI: تم تأكيد حظر الحساب ⛔ (${emailLabel})`);
      } else if (verdict.classification === 'safe') {
        toast(`🤖 AI: الحساب سليم ✅ (${emailLabel})`);
      } else {
        toast(`⚠️ تنبيه AI: لم يتمكن من حسم النتيجة (${emailLabel}): ${verdict.reason || 'غير متأكد'}`, true);
      }
      await refreshEverything();
    } else {
      toast(`⚠️ تنبيه AI: تعذر الفحص (${emailLabel}): ${res?.error || res?.reason || 'لا تتوفر استجابة'}`, true);
    }
  } catch (err) {
    toast(`⚠️ تنبيه AI: فشل الاتصال (${emailLabel}): ${friendlyError(err)}`, true);
  } finally {
    setBusy(btn, false, 'فحص AI 🤖');
  }
}

function findInboxByEmail(email) {
  if (!email) return null;
  const clean = String(email).trim().toLowerCase();
  return state.official.find(i => (i.email || '').toLowerCase() === clean) || state.temp.find(i => (i.email || '').toLowerCase() === clean);
}

async function loadInboxes() {
  const [data, firestore] = await Promise.all([
    api('/api/inboxes'),
    fetchFirestoreInboxes().catch(() => null)
  ]);
  const metadata = new Map();
  for (const inbox of [...(firestore?.official || []), ...(firestore?.temp || [])]) {
    if (inbox.id) metadata.set(`id:${inbox.id}`, inbox);
    if (inbox.email) metadata.set(`email:${inbox.email.toLowerCase()}`, inbox);
  }
  const mergeStatus = inbox => {
    const cloud = metadata.get(`id:${inbox.id}`) || metadata.get(`email:${String(inbox.email || '').toLowerCase()}`);
    const merged = cloud ? {
      ...inbox,
      isAmazon: cloud.isAmazon ?? inbox.isAmazon,
      isBanned: cloud.isBanned ?? inbox.isBanned,
      banStatus: cloud.banStatus || inbox.banStatus,
      banReason: cloud.banReason || inbox.banReason
    } : inbox;
    const manual = getManualBanDecision(merged);
    if (!manual) return merged;
    return {
      ...merged,
      banStatus: manual.status,
      isBanned: manual.status === 'confirmed',
      isAmazon: true,
      banReason: manual.reason || merged.banReason
    };
  };
  state.official = (data.official || firestore?.official || []).map(mergeStatus).map(i => ({
    ...i,
    isBanned: isConfirmedBanned(i),
    isSuspected: isSuspectedInbox(i),
    isAmazon: isAmazonInbox(i)
  }));
  state.temp = (data.temp || firestore?.temp || []).map(mergeStatus);
  state.amazon = state.official.filter(i => i.isAmazon).map(i => ({
    ...i,
    isAmazon: true,
    isBanned: isConfirmedBanned(i),
    isSuspected: isSuspectedInbox(i)
  }));
  state.banned = state.official.filter(i => isConfirmedBanned(i)).map(i => ({ ...i, isBanned: true, isAmazon: true }));
  state.suspected = state.official.filter(i => isSuspectedInbox(i)).map(i => ({ ...i, isAmazon: true, isSuspected: true }));
  state.activeId = data.activeId || state.activeId;
  if (state.activeId) {
    markInboxAsRead(state.activeId);
  }
  $('official-count').textContent = formatNumber(state.official.length);
  $('temp-count').textContent = formatNumber(state.temp.length);
  if ($('amazon-count')) $('amazon-count').textContent = formatNumber(state.amazon.length);
  if ($('banned-count')) $('banned-count').textContent = formatNumber(state.banned.length);
  renderInboxes();
}

async function loadCounts() {
  const data = await api('/api/all-messages');
  state.officialMessages = (data.official || []).map(m => ({
    ...m,
    isBanned: isBannedMessage(m),
    isAmazon: isAmazonMessage(m)
  }));
  state.tempMessages = data.temp || [];
  state.amazonMessages = (data.amazon || state.officialMessages.filter(m => m.isAmazon)).map(m => ({ ...m, isAmazon: true }));
  state.bannedMessages = (data.banned || state.officialMessages.filter(m => m.isBanned)).map(m => ({ ...m, isBanned: true, isAmazon: true }));
  $('official-message-count').textContent = formatNumber(data.counts?.official || 0);
  $('temp-message-count').textContent = formatNumber(data.counts?.temp || 0);
  if ($('amazon-message-count')) $('amazon-message-count').textContent = formatNumber(data.counts?.amazon || state.amazonMessages.length);
  if ($('banned-message-count')) $('banned-message-count').textContent = formatNumber(data.counts?.banned || state.bannedMessages.length);
  $('stat-messages').textContent = formatNumber(data.counts?.total || 0);
  updateFilterUnreadDots();
}

async function loadCurrent(silent = false) {
  if (!silent) setBusy($('refresh-current'), true);
  try {
    const data = await api('/api/inbox/current');
    state.activeInbox = data.inbox || null;
    state.activeId = state.activeInbox?.id || state.activeId;
    state.messages = (data.messages || []).map(m => ({
      ...m,
      isBanned: isBannedMessage(m),
      isAmazon: isAmazonMessage(m)
    }));
    if (state.activeId) {
      markInboxAsRead(state.activeId, state.messages.length);
    }
    $('current-message-count').textContent = formatNumber(state.messages.length);
    updateActiveInbox();
    renderInboxes();
    if (state.view === 'current') renderContent();
    setConnection(true);
    if (!silent) toast('تم فحص البريد الوارد');
  } catch (error) {
    setConnection(false);
    if (!silent) toast(friendlyError(error), true);
  } finally {
    if (!silent) setBusy($('refresh-current'), false);
  }
}

async function loadSeparated(type) {
  showContentSkeleton();
  try {
    const data = await api(`/api/all-messages?type=${encodeURIComponent(type)}`);
    if (type === 'official') state.officialMessages = (data.messages || []).map(m => ({ ...m, isBanned: isBannedMessage(m), isAmazon: isAmazonMessage(m) }));
    else if (type === 'amazon') state.amazonMessages = (data.messages || []).map(m => ({ ...m, isAmazon: true }));
    else if (type === 'banned') state.bannedMessages = (data.messages || []).map(m => ({ ...m, isBanned: true, isAmazon: true }));
    else state.tempMessages = data.messages || [];
    renderContent();
  } catch (error) {
    showEmpty('تعذر تحميل الرسائل', friendlyError(error));
  }
}

async function loadLogs(shouldRender = true) {
  const data = await api('/api/nivea/logs');
  state.logs = data.submissions || [];
  $('logs-count').textContent = formatNumber(state.logs.length);
  if (shouldRender && state.view === 'logs') renderContent();
}

function renderInboxes() {
  const source = state.inboxType === 'official' ? state.official : state.inboxType === 'amazon' ? state.amazon : state.inboxType === 'banned' ? state.banned : state.temp;
  const query = normalize($('inbox-search').value);
  const list = query ? source.filter(item => normalize([item.personName, item.label, item.email, item.domain, item.banReason].join(' ')).includes(query)) : source;
  updateFilterUnreadDots();
  if (!list.length) {
    $('inbox-list').innerHTML = `<div class="empty-state"><div class="empty-icon">@</div><h3>لا توجد صناديق</h3><p>${query ? 'غيّر عبارة البحث وحاول مجددًا.' : 'أنشئ صندوقًا جديدًا للبدء.'}</p></div>`;
    return;
  }
  const markup = list.slice(0, inboxLimit).map(inbox => {
    const official = isOfficial(inbox);
    const banned = isConfirmedBanned(inbox);
    const suspected = isSuspectedInbox(inbox);
    const amazon = isAmazonInbox(inbox);
    const reason = inbox.banReason || (banned ? 'محظور أو مقيد' : 'بانتظار المراجعة');
    const unread = isInboxUnread(inbox);
    const label = inbox.personName || inbox.label || inbox.email?.split('@')[0] || 'حساب';
    const id = encodeURIComponent(inbox.id || '');
    const suspectMsg = suspected ? findSuspectedMessageForInbox(inbox) : null;
    return `<article tabindex="0" role="button" class="inbox-item ${official ? 'official' : ''} ${inbox.id === state.activeId ? 'active' : ''} ${unread ? 'has-unread' : ''} ${suspected ? 'is-suspected' : ''}" data-inbox-id="${attr(id)}">
      <div class="inbox-item-avatar">
        ${banned ? '⛔' : suspected ? '⚠️' : amazon ? '🛒' : official ? '♛' : initials(label)}
        ${unread ? '<span class="unread-dot" title="رسائل جديدة غير مقروءة"></span>' : ''}
      </div>
      <div class="inbox-item-copy">
        <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;">
          <strong>${html(label)}</strong>
          ${unread ? '<span class="unread-pill" title="رسائل جديدة غير مقروءة">جديد</span>' : ''}
          ${(inbox.isRealGmail || inbox.domain === 'gmail.com') ? '<span class="real-gmail-badge" title="حساب Gmail حقيقي بمزامنة حية 24/7">📧 Gmail</span>' : ''}
          ${banned ? `<span class="banned-badge" title="${attr(reason)}">⛔ ${html(reason)}</span>` : suspected ? `<span class="suspected-badge" title="${attr(reason)}">⚠️ اشتباه حظر</span>` : ''}
        </div>
        <span>${html(inbox.email || '')}</span>
        ${suspected ? `
        <div class="ban-confirm-inline">
          <span class="ban-confirm-q">اشتباه حظر بانتظار تأكيدك أو استبعاد النمط:</span>
          <div class="ban-confirm-btns">
            ${suspectMsg ? `<button class="btn-view-suspect" type="button" data-open-message="${attr(encodeURIComponent(suspectMsg.id))}" title="معاينة الرسالة التي تسببت في الاشتباه">🔍 معاينة الرسالة</button>` : ''}
            <button class="btn-confirm-ban" type="button" data-confirm-ban="${attr(inbox.id)}" data-msg-id="${attr(suspectMsg?.id || '')}" data-msg-subject="${attr(suspectMsg?.subject || '')}" title="تأكيد الحظر">تأكيد الحظر ⛔</button>
            <button class="btn-mark-safe" type="button" data-mark-safe="${attr(inbox.id)}" data-msg-id="${attr(suspectMsg?.id || '')}" data-msg-subject="${attr(suspectMsg?.subject || '')}" title="استبعاد هذا النمط وتدريب الكود">استبعاد النمط ❌</button>
          </div>
        </div>` : ''}
      </div>
      <span class="inbox-count ${unread ? 'unread' : ''}">${formatNumber(inbox.messageCount || 0)}</span>
      <button class="inbox-more" data-delete-id="${attr(id)}" title="حذف الصندوق" aria-label="حذف الصندوق"><svg viewBox="0 0 24 24"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v5M14 11v5"/></svg></button>
    </article>`;
  }).join('') + (list.length > inboxLimit ? `<button class="load-more" data-load-more>عرض المزيد · ${formatNumber(list.length - inboxLimit)} صندوق متبقٍ</button>` : '');
  if ($('inbox-list').innerHTML !== markup) $('inbox-list').innerHTML = markup;
}

function updateActiveInbox() {
  const inbox = state.activeInbox;
  const live = document.querySelector('.active-live');
  live.hidden = !inbox;
  document.querySelector('.active-label').textContent = inbox ? 'الصندوق النشط' : 'مساحتك البريدية';
  if (!inbox) {
    $('active-email').textContent = 'اختر صندوق بريد';
    $('active-badge').textContent = 'كل بريدك في مكان واحد';
    $('active-host').textContent = '';
    $('active-avatar').textContent = '@';
    $('copy-email').disabled = true;
    return;
  }
  const official = isOfficial(inbox);
  const banned = isConfirmedBanned(inbox);
  const suspected = isSuspectedInbox(inbox);
  const amazon = isAmazonInbox(inbox);
  $('active-email').textContent = inbox.email || '—';
  $('active-host').textContent = inbox.host || inbox.domain || '';
  $('active-badge').textContent = banned ? `⛔ محظور (${inbox.banReason || 'مقيد'})` : suspected ? '⚠️ اشتباه حظر' : amazon ? '🛒 حساب أمازون' : official ? '♛ بريد رسمي' : 'ϟ بريد سريع';
  $('active-badge').style.color = banned ? '#dc2626' : suspected ? '#d97706' : amazon ? '#ea580c' : official ? 'var(--gold)' : 'var(--green)';
  $('active-avatar').textContent = banned ? '⛔' : suspected ? '⚠️' : amazon ? '🛒' : official ? '♛' : initials(inbox.personName || inbox.label || inbox.email);
  $('active-avatar').classList.toggle('official', official);
  $('copy-email').disabled = !inbox.email;
}

async function selectInbox(id) {
  state.activeId = id;
  markInboxAsRead(id);
  renderInboxes();
  // Optimistic: show content view immediately with loading skeleton
  switchContentView('current');
  if (innerWidth <= 720) {
    document.querySelector('.workspace').classList.add('show-content');
    document.querySelectorAll('[data-mobile-view]').forEach(item => item.classList.toggle('active', item.dataset.mobileView === 'messages'));
  }
  showContentSkeleton();
  placeHero();
  try {
    await api('/api/inboxes/select', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id })
    });
    await loadCurrent(true);
    markInboxAsRead(id, state.messages.length);
    renderInboxes();
  } catch (error) {
    toast(friendlyError(error), true);
  }
}

function switchContentView(view, pushHistory = true) {
  if (state.currentMessage) closeReader(false);
  const previousView = state.view;
  state.view = view;
  placeHero();
  $('content-search').value = '';
  document.querySelectorAll('[data-view]').forEach(button => button.classList.toggle('active', button.dataset.view === view));

  // Sync Topbar Amazon Hub Pill active state
  $('open-amazon-hub-btn')?.classList.toggle('active', view === 'amazon');

  // Sync Mobile Nav buttons
  document.querySelectorAll('[data-mobile-view]').forEach(item => {
    if (view === 'amazon') item.classList.toggle('active', item.dataset.mobileView === 'amazon');
    else if (view === 'logs') item.classList.toggle('active', item.dataset.mobileView === 'logs');
    else if (view === 'current') {
      const showContent = document.querySelector('.workspace')?.classList.contains('show-content');
      item.classList.toggle('active', showContent ? item.dataset.mobileView === 'messages' : item.dataset.mobileView === 'inboxes');
    }
  });

  // History state management
  if (pushHistory) {
    if (view === 'amazon' && previousView !== 'amazon') {
      history.pushState({ screen: 'amazon' }, '');
    }
  }

  if (view === 'amazon') {
    $('feed-shell')?.classList.add('hidden');
    $('amazon-hub-shell')?.classList.remove('hidden');
    renderAmazonHub();
    loadSeparated('amazon').then(() => renderAmazonHub());
    return;
  }

  $('amazon-hub-shell')?.classList.add('hidden');
  $('feed-shell')?.classList.remove('hidden');

  const map = {
    current: ['البريد الوارد', 'أحدث الرسائل', 'بحث في الرسائل'],
    banned: ['الحسابات المحظورة', 'رسائل الحظر والتقييد بالمشتريات الرقمية', 'بحث في رسائل الحظر والتقييد'],
    official: ['البريد الرسمي', 'رسائل النطاق الرسمي', 'بحث في الرسائل الرسمية'],
    temp: ['البريد السريع', 'رسائل النطاقات المؤقتة', 'بحث في الرسائل السريعة'],
    logs: ['سجل الحملة', 'تسجيلات نيفيا', 'بحث بالاسم أو الجوال']
  };
  [$('view-kicker').textContent, $('view-title').textContent, $('content-search').placeholder] = map[view] || map.current;
  if (view === 'official' || view === 'temp' || view === 'banned') loadSeparated(view);
  else if (view === 'logs') loadLogs(true).catch(error => showEmpty('تعذر تحميل السجل', friendlyError(error)));
  else renderContent();
}

function renderContent() {
  if (state.view === 'amazon') {
    renderAmazonHub();
    return;
  }
  const query = normalize($('content-search').value);
  if (state.view === 'logs') {
    const logs = query ? state.logs.filter(item => normalize([item.personName, item.realEmail, item.mobile, item.receiptNumber, item.city].join(' ')).includes(query)) : state.logs;
    renderLogs(logs);
    return;
  }
  const source = state.view === 'current' ? state.messages : state.view === 'banned' ? state.bannedMessages : state.view === 'official' ? state.officialMessages : state.tempMessages;
  const list = query ? source.filter(message => normalize([formatAddress(message.from), formatAddress(message.to), message.subject, message.text, message.intro, message.otp, message.inboxEmail].join(' ')).includes(query)) : source;
  renderMessages(list);
}

function renderMessages(messages) {
  if (!messages.length) return showEmpty('لا توجد رسائل بعد', 'ستظهر الرسائل الجديدة تلقائيًا عند وصولها.');
  hideEmpty();
  $('message-list').innerHTML = messages.map(message => {
    const sender = cleanSenderName(message.from, message.subject);
    const otp = message.otp ? String(message.otp) : '';
    const banned = isBannedMessage(message);
    const amazon = !banned && isAmazonMessage(message);
    const reason = getBanReason(message);
    return `<article class="message-card" data-message-id="${attr(encodeURIComponent(message.id || ''))}">
      <div class="sender-avatar">${banned ? '⛔' : amazon ? '🛒' : initials(sender)}</div>
      <div class="message-main">
        <div class="message-top">
          <strong style="display:inline-flex;align-items:center;gap:6px;">
            ${html(sender)}
            ${banned ? `<span class="banned-badge">⛔ ${html(reason)}</span>` : amazon ? '<span class="amazon-badge">أمازون</span>' : ''}
          </strong>
          <time>${html(formatDate(message.createdAt))}</time>
        </div>
        <div class="message-subject">${html(message.subject || '(بدون عنوان)')}</div>
        <div class="message-preview">${html(message.intro || message.text || formatAddress(message.to) || '')}</div>
      </div>
      ${otp ? `<button class="otp-chip" data-copy-otp="${attr(encodeURIComponent(otp))}"><span>رمز التحقق</span><strong>${html(otp)}</strong></button>` : '<span class="message-arrow">←</span>'}
    </article>`;
  }).join('');
}

function isAmazonOrderMessage(msg) {
  if (!msg) return false;
  const text = [msg.subject, msg.intro, msg.text, formatAddress(msg.from)].filter(Boolean).join(' ').toLowerCase();
  return /طلب|شحن|شحنة|توصيل|تم شحن|تأكيد الطلب|order|shipment|delivery|shipped|dispatched|package|tracking/i.test(text);
}

function setAmazonView(view, filter = 'all') {
  state.amazonView = view === 'messages' ? 'messages' : 'accounts';
  if (state.amazonView === 'accounts') {
    state.amazonAccountFilter = filter;
    state.amazonSelectedInbox = null;
    amazonAccountLimit = 24;
  } else {
    state.amazonSubFilter = filter;
    amazonMessageLimit = 20;
  }
  const search = $('amazon-search');
  if (search) search.placeholder = state.amazonView === 'accounts' ? 'ابحث باسم الحساب أو البريد…' : 'ابحث في رسائل أمازون…';
  document.querySelectorAll('#amazon-sub-tabs [data-amazon-view]').forEach(button => {
    const active = button.dataset.amazonView === state.amazonView && (state.amazonView === 'accounts' || button.dataset.amazonFilter === state.amazonSubFilter);
    button.classList.toggle('active', active);
    button.setAttribute('aria-selected', String(active));
  });
  renderAmazonHub();
}

function getFilteredAmazonAccounts() {
  let list = state.amazon || [];
  if (state.amazonAccountFilter === 'healthy') list = list.filter(inbox => !isConfirmedBanned(inbox) && !isSuspectedInbox(inbox));
  else if (state.amazonAccountFilter === 'suspected') list = list.filter(inbox => !isConfirmedBanned(inbox) && isSuspectedInbox(inbox));
  else if (state.amazonAccountFilter === 'banned') list = list.filter(isConfirmedBanned);
  const query = normalize($('amazon-search')?.value);
  if (query) list = list.filter(inbox => normalize([inbox.email, inbox.personName, inbox.label, inbox.banReason].join(' ')).includes(query));
  return list;
}

function getFilteredAmazonMessages() {
  let list = state.amazonMessages || [];
  if (state.amazonSelectedInbox) {
    const sel = state.amazonSelectedInbox.toLowerCase();
    list = list.filter(m => (m.inboxEmail || '').toLowerCase() === sel);
  }
  if (state.amazonSubFilter === 'otp') {
    list = list.filter(m => Boolean(m.otp));
  } else if (state.amazonSubFilter === 'suspected') {
    list = list.filter(m => {
      const inbox = findInboxByEmail(m.inboxEmail);
      if (inbox && isConfirmedBanned(inbox)) return false;
      return isBannedMessage(m) || isSuspectedInbox(inbox);
    });
  } else if (state.amazonSubFilter === 'banned') {
    list = list.filter(m => {
      const inbox = findInboxByEmail(m.inboxEmail);
      return isConfirmedBanned(inbox);
    });
  } else if (state.amazonSubFilter === 'orders') {
    list = list.filter(m => isAmazonOrderMessage(m));
  }
  const query = normalize($('amazon-search')?.value);
  if (query) {
    list = list.filter(m => normalize([formatAddress(m.from), formatAddress(m.to), m.subject, m.text, m.intro, m.otp, m.inboxEmail].join(' ')).includes(query));
  }
  return list;
}

function renderAmazonInboxesReel() {
  const reel = $('amazon-inboxes-reel');
  if (!reel) return;
  if (state.amazonView !== 'accounts') { reel.classList.add('hidden'); return; }
  reel.classList.remove('hidden');
  const inboxes = getFilteredAmazonAccounts();
  const visible = inboxes.slice(0, amazonAccountLimit);
  const statusTitle = { all: 'كل حسابات أمازون', healthy: 'الحسابات السليمة', suspected: 'حسابات تحتاج مراجعة', banned: 'الحسابات المحظورة والمقيدة' }[state.amazonAccountFilter] || 'حسابات أمازون';
  if ($('amazon-results-kicker')) $('amazon-results-kicker').textContent = 'إدارة الحسابات';
  if ($('amazon-results-title')) $('amazon-results-title').textContent = statusTitle;
  if ($('amazon-results-count')) $('amazon-results-count').textContent = `${formatNumber(inboxes.length)} حساب`;
  if (!inboxes.length) {
    reel.innerHTML = `<div class="amazon-empty"><span>✓</span><h3>لا توجد حسابات مطابقة</h3><p>غيّر التصنيف أو عبارة البحث لعرض نتائج أخرى.</p><button id="reel-quick-add" type="button">إنشاء حساب أمازون</button></div>`;
    return;
  }
  reel.innerHTML = visible.map(inbox => {
    const email = inbox.email || '';
    const count = Math.max(Number(inbox.messageCount || 0), (state.amazonMessages || []).filter(m => (m.inboxEmail || '').toLowerCase() === email.toLowerCase()).length);
    const label = inbox.personName || inbox.label || email.split('@')[0] || 'حساب أمازون';
    const banned = isConfirmedBanned(inbox);
    const suspected = !banned && isSuspectedInbox(inbox);
    const status = banned ? 'محظور' : suspected ? 'يحتاج مراجعة' : 'سليم';
    const statusClass = banned ? 'banned' : suspected ? 'suspected' : 'healthy';
    return `<article class="amazon-account-card ${statusClass}" data-account-id="${attr(inbox.id || '')}">
      <header><div class="amazon-account-avatar">${banned ? '!' : suspected ? '?' : 'a'}</div><div><h4>${html(label)}</h4><span class="amazon-account-status">${html(status)}</span></div><b class="amazon-account-count">${formatNumber(count)} رسالة</b></header>
      <button class="amazon-account-email" type="button" data-amazon-copy="${attr(encodeURIComponent(email))}" title="نسخ البريد"><span dir="ltr">${html(email)}</span><svg viewBox="0 0 24 24"><rect x="8" y="8" width="11" height="11" rx="2"/><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3"/></svg></button>
      ${banned && inbox.banReason ? `<p class="amazon-account-reason">${html(inbox.banReason)}</p>` : ''}
      ${suspected ? `<div class="amazon-review-actions"><span>هل الحساب محظور فعلًا؟</span><button type="button" data-confirm-ban="${attr(inbox.id)}" data-reason="${attr(inbox.banReason || '')}">تأكيد الحظر</button><button type="button" data-mark-safe="${attr(inbox.id)}">الحساب سليم</button><button type="button" data-ai-verify="${attr(inbox.id)}">فحص AI</button></div>` : ''}
      <footer><button type="button" data-amazon-messages="${attr(encodeURIComponent(email))}">عرض رسائل الحساب <span>←</span></button><time>${html(inbox.createdAt ? formatDate(inbox.createdAt) : '')}</time></footer>
    </article>`;
  }).join('') + (visible.length < inboxes.length ? `<button class="amazon-load-more" type="button" data-amazon-load-more>عرض ${formatNumber(Math.min(24, inboxes.length - visible.length))} حسابًا إضافيًا</button>` : '');
}

function renderAmazonMessages() {
  const container = $('amazon-message-list');
  if (!container) return;
  if (state.amazonView !== 'messages') { container.classList.add('hidden'); return; }
  container.classList.remove('hidden');
  const list = getFilteredAmazonMessages();
  const visible = list.slice(0, amazonMessageLimit);
  const title = state.amazonSelectedInbox ? `رسائل ${state.amazonSelectedInbox}` : state.amazonSubFilter === 'otp' ? 'رموز التحقق OTP' : state.amazonSubFilter === 'orders' ? 'الطلبات والشحنات' : 'كل رسائل أمازون';
  if ($('amazon-results-kicker')) $('amazon-results-kicker').textContent = 'صندوق أمازون';
  if ($('amazon-results-title')) $('amazon-results-title').textContent = title;
  if ($('amazon-results-count')) $('amazon-results-count').textContent = `${formatNumber(list.length)} رسالة`;

  if (!list.length) {
    container.innerHTML = `<div class="empty-state" style="padding: 36px 16px;">
      <div class="empty-icon">🛒</div>
      <h3>لا توجد رسائل مطابقة</h3>
      <p>لم يتم العثور على رسائل تحت هذا التصنيف في أمازون.</p>
    </div>`;
    return;
  }

  container.innerHTML = visible.map(message => {
    const sender = cleanSenderName(message.from, message.subject);
    const otp = message.otp ? String(message.otp) : '';
    const hasBanContent = isBannedMessage(message);
    const inbox = findInboxByEmail(message.inboxEmail);
    const isBanned = isConfirmedBanned(inbox);
    const isSuspected = !isBanned && (hasBanContent || isSuspectedInbox(inbox));
    const reason = getBanReason(message);
    const isOrder = isAmazonOrderMessage(message);

    return `<article class="message-card ${isBanned ? 'is-banned-card' : isSuspected ? 'is-suspected-card' : ''}" data-message-id="${attr(encodeURIComponent(message.id || ''))}">
      <div class="sender-avatar">${isBanned ? '⛔' : isSuspected ? '⚠️' : isOrder ? '📦' : '🛒'}</div>
      <div class="message-main">
        <div class="message-top">
          <strong style="display:inline-flex;align-items:center;gap:6px;">
            ${html(sender)}
            ${isBanned ? `<span class="banned-badge">⛔ ${html(reason)}</span>` : isSuspected ? `<span class="suspected-badge">⚠️ اشتباه حظر</span>` : isOrder ? '<span class="order-badge">📦 طلب/شحنة</span>' : '<span class="amazon-badge">أمازون</span>'}
          </strong>
          <time>${html(formatDate(message.createdAt))}</time>
        </div>
        <div class="message-subject">${html(message.subject || '(بدون عنوان)')}</div>
        <div class="message-preview">${html(message.intro || message.text || formatAddress(message.to) || '')}</div>
        ${isSuspected && inbox ? `
        <div class="ban-confirm-inline">
          <span class="ban-confirm-q">اشتباه حظر بانتظار قرارك لتحديد القاعدة:</span>
          <div class="ban-confirm-btns">
            <button class="btn-view-suspect" type="button" data-open-message="${attr(encodeURIComponent(message.id))}" title="معاينة الرسالة التي تسببت في الاشتباه">🔍 معاينة الرسالة</button>
            <button class="btn-confirm-ban" type="button" data-confirm-ban="${attr(inbox.id)}" data-msg-id="${attr(message.id)}" data-msg-subject="${attr(message.subject || '')}" title="تأكيد الحظر">تأكيد الحظر ⛔</button>
            <button class="btn-mark-safe" type="button" data-mark-safe="${attr(inbox.id)}" data-msg-id="${attr(message.id)}" data-msg-subject="${attr(message.subject || '')}" title="استبعاد هذا النمط وتدريب الكود">استبعاد النمط ❌</button>
          </div>
        </div>` : ''}
      </div>
      ${otp ? `<button class="otp-chip highlight" data-copy-otp="${attr(encodeURIComponent(otp))}"><span>رمز التحقق</span><strong>${html(otp)}</strong></button>` : '<span class="message-arrow">←</span>'}
    </article>`;
  }).join('') + (visible.length < list.length ? `<button class="amazon-load-more" type="button" data-amazon-messages-more>عرض ${formatNumber(Math.min(20, list.length - visible.length))} رسالة إضافية</button>` : '');
}

function renderAmazonHub() {
  const amzMsgs = state.amazonMessages || [];
  const otps = amzMsgs.filter(m => Boolean(m.otp));
  const suspectedMsgs = amzMsgs.filter(m => {
    const inbox = findInboxByEmail(m.inboxEmail);
    if (inbox && isConfirmedBanned(inbox)) return false;
    return isBannedMessage(m) || isSuspectedInbox(inbox);
  });
  const bannedMsgs = amzMsgs.filter(m => {
    const inbox = findInboxByEmail(m.inboxEmail);
    return isConfirmedBanned(inbox);
  });
  const orders = amzMsgs.filter(m => isAmazonOrderMessage(m));
  const healthy = (state.amazon || []).filter(inbox => !isConfirmedBanned(inbox) && !isSuspectedInbox(inbox));

  if ($('amazon-stat-inboxes')) $('amazon-stat-inboxes').textContent = formatNumber(state.amazon.length);
  if ($('amazon-stat-messages')) $('amazon-stat-messages').textContent = formatNumber(amzMsgs.length);
  if ($('amazon-stat-healthy')) $('amazon-stat-healthy').textContent = formatNumber(healthy.length);
  if ($('amazon-stat-otps')) $('amazon-stat-otps').textContent = formatNumber(otps.length);
  if ($('amazon-stat-suspected')) $('amazon-stat-suspected').textContent = formatNumber(state.suspected.length);
  if ($('amazon-stat-banned')) $('amazon-stat-banned').textContent = formatNumber(state.banned.length || bannedMsgs.length);

  if ($('amazon-nav-count')) $('amazon-nav-count').textContent = formatNumber(amzMsgs.length);
  if ($('amazon-seq-name')) $('amazon-seq-name').textContent = getNextSequentialPrefix('ahmedroou');

  if ($('amz-tab-all-count')) $('amz-tab-all-count').textContent = formatNumber(amzMsgs.length);
  if ($('amz-tab-otp-count')) $('amz-tab-otp-count').textContent = formatNumber(otps.length);
  if ($('amz-tab-suspected-count')) $('amz-tab-suspected-count').textContent = formatNumber(suspectedMsgs.length);
  if ($('amz-tab-banned-count')) $('amz-tab-banned-count').textContent = formatNumber(bannedMsgs.length);
  if ($('amz-tab-orders-count')) $('amz-tab-orders-count').textContent = formatNumber(orders.length);

  renderAmazonInboxesReel();
  renderAmazonMessages();
}

async function createQuickAmazonInbox() {
  const next = getNextSequentialPrefix('ahmedroou');
  const btn = $('amazon-quick-create-btn');
  setBusy(btn, true, `جاري إنشاء ${next}…`);
  try {
    const data = await api('/api/official/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ personName: next, label: next, prefix: next })
    });
    if (!data.inbox) throw new Error('تعذر إنشاء حساب أمازون');
    toast(`تم إنشاء حساب أمازون: ${data.inbox.email}`);
    await refreshEverything();
    await selectInbox(data.inbox.id);
    switchContentView('amazon');
  } catch (err) {
    toast(friendlyError(err), true);
  } finally {
    setBusy(btn, false);
    if ($('amazon-seq-name')) $('amazon-seq-name').textContent = getNextSequentialPrefix('ahmedroou');
  }
}

async function refreshAmazonHub() {
  const btn = $('amazon-refresh-btn');
  setBusy(btn, true, 'جارٍ التحديث…');
  try {
    await Promise.all([loadInboxes(), loadSeparated('amazon'), loadStatus()]);
    renderAmazonHub();
    toast('تم تحديث مركز أمازون');
  } catch (err) {
    toast(friendlyError(err), true);
  } finally {
    setBusy(btn, false);
  }
}

function getActiveMessageList() {
  if (state.view === 'amazon') {
    return getFilteredAmazonMessages();
  }
  const query = normalize($('content-search')?.value);
  const source = state.view === 'current' ? state.messages : state.view === 'banned' ? state.bannedMessages : state.view === 'official' ? state.officialMessages : state.tempMessages;
  return query ? source.filter(message => normalize([formatAddress(message.from), formatAddress(message.to), message.subject, message.text, message.intro, message.otp, message.inboxEmail].join(' ')).includes(query)) : source;
}

function updateReaderNavigation(id) {
  state.activeMessageList = getActiveMessageList();
  const idx = state.activeMessageList.findIndex(m => String(m.id) === String(id));
  state.currentMessageIndex = idx;
  const total = state.activeMessageList.length;

  const counter = $('reader-counter');
  const prevBtn = $('reader-prev-btn');
  const nextBtn = $('reader-next-btn');

  if (idx !== -1 && total > 0) {
    if (counter) counter.textContent = `${idx + 1} / ${total}`;
    if (prevBtn) prevBtn.disabled = idx <= 0;
    if (nextBtn) nextBtn.disabled = idx >= total - 1;
  } else {
    if (counter) counter.textContent = '1 / 1';
    if (prevBtn) prevBtn.disabled = true;
    if (nextBtn) nextBtn.disabled = true;
  }
}

function navigatePreviousMessage() {
  if (!state.currentMessage || state.currentMessageIndex <= 0) return;
  const list = state.activeMessageList;
  const prev = list[state.currentMessageIndex - 1];
  if (prev && prev.id) openMessage(prev.id);
}

function navigateNextMessage() {
  if (!state.currentMessage || state.currentMessageIndex >= state.activeMessageList.length - 1) return;
  const list = state.activeMessageList;
  const next = list[state.currentMessageIndex + 1];
  if (next && next.id) openMessage(next.id);
}

function printCurrentMessage() {
  const frame = $('reader-frame');
  if (frame && frame.contentWindow) {
    try {
      frame.contentWindow.focus();
      frame.contentWindow.print();
    } catch (e) {
      window.print();
    }
  }
}

function getBanDetailText(msg) {
  const reason = getBanReason(msg);
  if (reason.includes('مشتريات رقمية')) {
    return 'أرسلت أمازون إشعارًا بأن هذا الحساب مقيد لاستخدام المشتريات الرقمية فقط وفقًا لسياسة المرتجعات.';
  }
  if (reason.includes('إغلاق')) {
    return 'أرسلت أمازون إشعارًا بإغلاق هذا الحساب وإنهاء الخدمة.';
  }
  if (reason.includes('OFM')) {
    return 'رسالة مراجعة وتدقيق أمني من فريق OFM / Account Specialist لدى أمازون.';
  }
  return 'تم تصنيف هذه الرسالة كتنبيه تقييد أو حظر من نظام أمازون.';
}

function renderLogs(logs) {
  if (!logs.length) return showEmpty('لا توجد تسجيلات', 'ستظهر عمليات التسجيل المكتملة في هذا السجل.');
  hideEmpty();
  $('message-list').innerHTML = [...logs].reverse().map(log => `<article class="message-card log-card">
    <div class="log-index">#${html(log.index)}</div>
    <div class="message-main"><div class="message-top"><strong>${html(log.personName || 'مشارك')}</strong><time>${html(formatDate(log.registeredAt))}</time></div><div class="message-subject">${html(log.realEmail || '')}</div><div class="log-details">${html(log.mobile || '')} · <b>${html(log.city || '')}</b></div></div>
    <div class="receipt"><span>رقم الفاتورة</span><strong>${html(log.receiptNumber || '—')}</strong></div>
  </article>`).join('');
}

async function openMessage(id, pushHistory = true) {
  const request = ++readerRequest;
  if (!state.currentMessage) {
    readerReturnScroll = window.scrollY;
    readerReturnFocus = document.activeElement;
  }
  if (pushHistory) history.pushState({ screen: 'reader', messageId: id }, '');
  stopReaderResize();
  state.currentMessage = { id };
  $('feed-shell')?.classList.add('hidden');
  $('amazon-hub-shell')?.classList.add('hidden');
  $('reader-shell')?.classList.remove('hidden');
  document.body.dataset.screen = 'reader';
  document.dispatchEvent(new Event('mail-layout-change'));
  if (mobileLayout.matches) {
    document.querySelector('.workspace')?.classList.add('show-content');
  }

  updateReaderNavigation(id);

  $('reader-subject').textContent = 'جاري تحميل الرسالة…';
  $('reader-from').textContent = '—';
  $('reader-to').textContent = '—';
  $('reader-date').textContent = '—';
  $('reader-avatar').textContent = '@';
  $('reader-otp-banner')?.classList.add('hidden');
  $('reader-notice').classList.add('hidden');
  $('reader-attachments').classList.add('hidden');
  $('reader-attachments').replaceChildren();
  $('reader-copy-all-btn').disabled = true;
  $('reader-retry-btn').disabled = true;
  document.querySelector('.reader-content-card').setAttribute('aria-busy', 'true');
  $('reader-content-status').textContent = 'جاري التحميل…';

  const frame = $('reader-frame');
  if (frame) {
    frame.onload = null;
    frame.style.height = '320px';
    frame.srcdoc = loadingDocument();
  }

  window.scrollTo({ top: 0, behavior: 'smooth' });

  try {
    const message = await api(`/api/messages/${encodeURIComponent(id)}`);
    if (request !== readerRequest || state.currentMessage?.id !== id) return;
    state.currentMessage = message;

    const sender = cleanSenderName(message.from, message.subject);
    const recipient = formatAddress(message.to) || message.inboxEmail || state.activeInbox?.email || '—';
    const isBanned = isBannedMessage(message);
    const isAmz = isAmazonMessage(message);
    const isOff = isOfficial(state.activeInbox) || (message.inboxEmail && (message.inboxEmail.endsWith('@batabitoo.com') || message.inboxEmail.endsWith('@gmail.com')));

    $('reader-subject').textContent = message.subject || '(بدون عنوان)';
    $('reader-from').textContent = sender;
    $('reader-to').textContent = recipient;
    $('reader-date').textContent = formatDate(message.createdAt, true);
    $('reader-avatar').textContent = isBanned ? '⛔' : isAmz ? '🛒' : initials(sender);
    const cleanText = decodeBase64IfNeeded(message.text || '');
    $('reader-copy-all-btn').disabled = !cleanText;
    $('reader-subject').focus({ preventScroll: true });

    // Update Brand Pill
    const brandPill = $('reader-brand-pill');
    if (brandPill) {
      brandPill.className = 'reader-brand-pill';
      if (isBanned) {
        brandPill.textContent = '⛔ مقيد / محظور';
        brandPill.classList.add('brand-banned');
        brandPill.classList.remove('hidden');
      } else if (isAmz) {
        brandPill.textContent = '🛒 أمازون (Amazon)';
        brandPill.classList.add('brand-amazon');
        brandPill.classList.remove('hidden');
      } else if (isOff) {
        brandPill.textContent = '♛ بريد رسمي';
        brandPill.classList.add('brand-official');
        brandPill.classList.remove('hidden');
      } else {
        brandPill.textContent = 'ϟ بريد سريع';
        brandPill.classList.add('brand-temp');
        brandPill.classList.remove('hidden');
      }
    }

    // Update Ban Alert Banner
    const banAlert = $('reader-ban-alert');
    if (banAlert) {
      if (isBanned) {
        banAlert.classList.remove('hidden');
        if ($('reader-ban-title')) $('reader-ban-title').textContent = `تنبيه من أمازون: ${getBanReason(message)}`;
        if ($('reader-ban-desc')) $('reader-ban-desc').textContent = getBanDetailText(message);
      } else {
        banAlert.classList.add('hidden');
      }
    }

    // Update Rule Training & Learning Banner in Reader
    const learningBanner = $('reader-learning-banner');
    if (learningBanner) {
      const parentInbox = state.activeInbox || findInboxByEmail(message.inboxEmail);
      const isSuspected = isBanned || isSuspectedInbox(parentInbox) || isBannedMessage(message);
      if (isSuspected && parentInbox) {
        learningBanner.classList.remove('hidden');
        learningBanner.setAttribute('data-inbox-id', parentInbox.id);
        learningBanner.setAttribute('data-msg-id', message.id);
        learningBanner.setAttribute('data-msg-subject', message.subject || '');
      } else {
        learningBanner.classList.add('hidden');
      }
    }

    if (message.bodyStatus === 'unavailable') {
      $('reader-notice').textContent = 'النسخة المحفوظة لهذه الرسالة ناقصة من المصدر؛ لا يتوفر محتواها الأصلي لعرضه.';
      $('reader-notice').classList.remove('hidden');
    }
    const attachments = (message.attachments || []).filter(item => !item.inline);
    $('reader-attachments').innerHTML = attachments.map(item => `<a class="reader-attachment" href="${API_BASE}/api/messages/${encodeURIComponent(id)}/attachments/${encodeURIComponent(item.id)}" target="_blank" rel="noopener noreferrer"><svg viewBox="0 0 24 24"><path d="M12 3v12m-5-5 5 5 5-5M5 16v5h14v-5"/></svg><span><strong>${html(item.filename || 'مرفق')}</strong><small>${Math.max(1, Math.ceil((item.size || 0) / 1024))} KB</small></span></a>`).join('');
    $('reader-attachments').classList.toggle('hidden', !attachments.length);

    if (message.otp) {
      $('reader-otp').textContent = message.otp;
      $('reader-otp-banner')?.classList.remove('hidden');
    } else {
      $('reader-otp-banner')?.classList.add('hidden');
    }

    let effectiveHtml = message.html;
    if (!hasVisibleContent(effectiveHtml)) {
      effectiveHtml = cleanText ? plainDocument(cleanText) : plainDocument('لا يوجد محتوى متوفر لهذه الرسالة.');
    }

    if (frame) {
      frame.onload = () => {
        if (request !== readerRequest) return;
        try {
          const doc = frame.contentDocument || frame.contentWindow.document;
          if (doc) {
            let animationFrame = 0;
            const adjust = () => {
              cancelAnimationFrame(animationFrame);
              animationFrame = requestAnimationFrame(() => {
                if (request !== readerRequest) return;
                const h = Math.ceil(doc.body.getBoundingClientRect().height);
                const target = Math.min(30000, Math.max(320, h + 4));
                if (Math.abs(parseInt(frame.style.height, 10) - target) > 2) frame.style.height = `${target}px`;
              });
            };
            const observer = new ResizeObserver(adjust);
            observer.observe(doc.body);
            stopReaderResize = () => { observer.disconnect(); cancelAnimationFrame(animationFrame); frame.onload = null; };
            adjust();
          }
        } catch (e) {
          frame.style.height = '80vh';
        }
        document.querySelector('.reader-content-card').setAttribute('aria-busy', 'false');
        $('reader-content-status').textContent = ' ';
      };
      frame.srcdoc = effectiveHtml;
    }
  } catch (error) {
    if (request !== readerRequest) return;
    $('reader-subject').textContent = 'تعذر تحميل الرسالة';
    if (frame) frame.srcdoc = plainDocument(friendlyError(error));
    $('reader-content-status').textContent = 'أعد المحاولة من زر التحديث';
    document.querySelector('.reader-content-card').setAttribute('aria-busy', 'false');
  } finally {
    if (request === readerRequest) $('reader-retry-btn').disabled = false;
  }
}

function closeReader(updateHistory = true) {
  ++readerRequest;
  stopReaderResize();
  state.currentMessage = null;
  $('reader-shell')?.classList.add('hidden');
  if (state.view === 'amazon') {
    $('amazon-hub-shell')?.classList.remove('hidden');
    $('feed-shell')?.classList.add('hidden');
  } else {
    $('feed-shell')?.classList.remove('hidden');
    $('amazon-hub-shell')?.classList.add('hidden');
  }
  const frame = $('reader-frame');
  if (frame) frame.srcdoc = '';
  placeHero();
  if (updateHistory && history.state?.screen === 'reader') {
    history.back();
  }
  readerReturnFocus?.focus?.({ preventScroll: true });
  window.scrollTo({ top: readerReturnScroll, behavior: 'instant' });
}

function getNextSequentialPrefix(base = 'ahmedroou') {
  const allEmails = [...state.official, ...state.temp].map(i => (i.email || '').toLowerCase().trim());
  const baseEmail = `${base}@batabitoo.com`.toLowerCase();
  let maxNum = 0;
  const re = new RegExp(`^${base}(\\d+)@batabitoo\\.com$`, 'i');
  for (const email of allEmails) {
    const m = email.match(re);
    if (m) {
      const num = parseInt(m[1], 10);
      if (!isNaN(num) && num > maxNum) maxNum = num;
    }
  }
  return `${base}${maxNum + 1}`;
}

function openCreateModal() {
  const next = getNextSequentialPrefix('ahmedroou');
  if ($('seq-preview')) $('seq-preview').textContent = next;
  $('create-modal').classList.remove('hidden');
  setTimeout(() => $('create-name').focus(), 80);
}

function closeModal(type) {
  if (type === 'message') {
    closeReader();
    return;
  }
  $(`${type}-modal`)?.classList.add('hidden');
}

async function createInbox(event) {
  event.preventDefault();
  const name = $('create-name').value.trim();
  const rawPrefix = $('create-prefix').value.trim();
  const isGmail = state.createType === 'gmail';
  const isOfficialType = state.createType === 'official' || isGmail;
  const domain = isGmail ? 'gmail.com' : 'batabitoo.com';

  const button = $('create-submit');
  setBusy(button, true, 'جاري إنشاء الصندوق…');
  try {
    let createdInbox = null;

    if (isGmail) {
      const cleanPrefix = rawPrefix ? (rawPrefix.includes('@') ? rawPrefix.split('@')[0] : rawPrefix.replace(/[^a-z0-9\.]/g, '')) : 'amazon.acc';
      const email = rawPrefix.includes('@') ? rawPrefix.toLowerCase() : `${cleanPrefix}@gmail.com`.toLowerCase();
      const cleanName = name || `حساب رسمي (${email.split('@')[0]})`;
      const docId = `official_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
      const record = {
        id: docId,
        email: email,
        domain: 'gmail.com',
        host: 'Gmail (Google Official)',
        isOfficial: true,
        isAmazon: false,
        isBanned: false,
        banStatus: 'none',
        banReason: '',
        type: 'official',
        label: cleanName,
        personName: cleanName,
        createdAt: new Date().toISOString(),
        messageCount: 0
      };
      const firestoreFields = {
        id: { stringValue: docId },
        email: { stringValue: email },
        domain: { stringValue: 'gmail.com' },
        host: { stringValue: 'Gmail (Google Official)' },
        isOfficial: { booleanValue: true },
        isAmazon: { booleanValue: false },
        isBanned: { booleanValue: false },
        banStatus: { stringValue: 'none' },
        banReason: { stringValue: '' },
        type: { stringValue: 'official' },
        label: { stringValue: cleanName },
        personName: { stringValue: cleanName },
        createdAt: { stringValue: record.createdAt },
        messageCount: { integerValue: "0" }
      };

      // 1. Sync to local node server if running
      fetch('http://localhost:3030/api/official/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, prefix: cleanPrefix, domain: 'gmail.com', personName: cleanName, label: cleanName })
      }).catch(() => {});

      // 2. Save directly to Firestore Cloud REST API
      const fsRes = await fetch(`https://firestore.googleapis.com/v1/projects/batabitoo-mail-2026/databases/(default)/documents/inboxes?documentId=${docId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fields: firestoreFields })
      });
      if (fsRes.ok) {
        createdInbox = record;
      }
    }

    if (!createdInbox) {
      const path = isOfficialType ? '/api/official/create' : '/api/inboxes/create';
      const data = await api(path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          personName: name || undefined,
          label: name || undefined,
          prefix: rawPrefix || undefined,
          email: rawPrefix.includes('@') ? rawPrefix : undefined,
          domain: domain
        })
      });
      createdInbox = data.inbox;
    }

    if (!createdInbox) throw new Error('لم يرجع الخادم صندوقًا جديدًا');
    $('create-modal').classList.add('hidden');
    $('create-form').reset();
    state.inboxType = isOfficialType ? 'official' : 'temp';
    document.querySelectorAll('[data-inbox-type]').forEach(item => item.classList.toggle('active', item.dataset.inboxType === state.inboxType));
    await loadInboxes();
    await selectInbox(createdInbox.id);
    toast(`تم إنشاء ${createdInbox.email}`);
  } catch (error) {
    toast(friendlyError(error), true);
  } finally {
    setBusy(button, false, 'إنشاء الصندوق');
  }
}

function askDelete(id) {
  state.pendingDeleteId = id;
  $('confirm-delete').classList.remove('hidden');
}

async function deleteInbox() {
  if (!state.pendingDeleteId) return;
  const id = state.pendingDeleteId;
  setBusy($('accept-delete'), true, 'جارٍ الحذف');
  try {
    await api(`/api/inboxes/${encodeURIComponent(id)}`, { method: 'DELETE' });
    $('confirm-delete').classList.add('hidden');
    state.pendingDeleteId = null;
    if (seenCounts[id] !== undefined) {
      delete seenCounts[id];
      saveSeenCounts();
    }
    await loadInboxes();
    await loadCurrent(true);
    await loadStatus();
    toast('تم حذف الصندوق ورسائله');
  } catch (error) {
    toast(friendlyError(error), true);
  } finally {
    setBusy($('accept-delete'), false, 'حذف');
  }
}

function showContentSkeleton() {
  hideEmpty();
  $('message-list').innerHTML = '<div class="skeleton-list wide"></div>';
}

function showEmpty(title, message) {
  $('message-list').innerHTML = '';
  $('empty-state').classList.remove('hidden');
  $('empty-state').querySelector('h3').textContent = title;
  $('empty-state').querySelector('p').textContent = message;
}

function hideEmpty() { $('empty-state').classList.add('hidden'); }

function setConnection(online, cloud = true) {
  const pill = $('connection-pill');
  pill.classList.toggle('online', online);
  pill.classList.toggle('offline', !online);
  $('connection-text').textContent = online ? (cloud ? 'متصل ومزامن' : 'متصل محليًا') : 'تعذر الاتصال';
}

function setBusy(button, busy, label) {
  if (!button) return;
  button.disabled = busy;
  button.classList.toggle('spin', busy);
  const span = button.querySelector('span');
  if (span && label) span.textContent = label;
  else if (!span && label) button.textContent = label;
}

let toastTimer;
function toast(message, error = false) {
  clearTimeout(toastTimer);
  $('toast-message').textContent = message;
  $('toast-icon').textContent = error ? '!' : '✓';
  $('toast').classList.toggle('error', error);
  $('toast').classList.add('show');
  toastTimer = setTimeout(() => $('toast').classList.remove('show'), 2800);
}

async function copyText(value, message) {
  if (!value) return;
  try {
    await navigator.clipboard.writeText(String(value));
    toast(message);
  } catch {
    toast('تعذر النسخ إلى الحافظة', true);
  }
}

function isOfficial(inbox) {
  return inbox?.isOfficial === true || inbox?.type === 'official' || String(inbox?.email || '').toLowerCase().endsWith('@batabitoo.com') || String(inbox?.email || '').toLowerCase().endsWith('@gmail.com');
}

function isAmazonMessage(msg) {
  if (!msg) return false;
  if (msg.isAmazon === true || msg.isBanned === true) return true;
  const textToCheck = [
    formatAddress(msg.from),
    formatAddress(msg.to),
    msg.subject,
    msg.intro,
    msg.text,
    msg.inboxEmail
  ].filter(Boolean).join(' ').toLowerCase();
  return /amazon|أمازون|امازون|إمازون|amazon\.sa|amazon\.com|amazon\.ae|amazon\.co\.uk|amazon\.de|ofm@|cis@/i.test(textToCheck);
}

function isBannedMessage(msg) {
  if (!msg) return false;
  if (msg.isBanned === true) return true;
  const textToCheck = [
    msg.subject,
    msg.intro,
    msg.text
  ].filter(Boolean).join(' ').toLowerCase();

  const hasDigitalRestriction = /المشتريات الرقمية|مشتريات رقمية|digital purchases only|digital orders only|غير الرقمية|سياسة المرتجعات ورد الأموال|انتهاكات متعددة لسياسة المرتجعات/i.test(textToCheck);
  const hasAccountClosure = /أغلقنا هذا الحساب|اغلقنا هذا الحساب|تم إغلاق حسابك|تم اغلاق حسابك|تم حظر حسابك|تم تعليق حسابك|إنهاء الحسابات|انهاء الحسابات|رفض الخدمة|إنهاء استخدام خدمات أمازون|انهاء استخدام خدمات امازون|closed this account|account has been closed|account closure|terminate your account|terminated your account|refuse service, terminate accounts|account (?:is|was|has been)?\s*(?:suspended|locked|on hold|closed)/i.test(textToCheck);

  return hasDigitalRestriction || hasAccountClosure;
}

function getBanReason(msg) {
  if (!msg) return "حساب مقيد / محظور";
  const textToCheck = [msg.subject, msg.intro, msg.text].filter(Boolean).join(' ').toLowerCase();
  if (/المشتريات الرقمية|مشتريات رقمية|digital purchases/i.test(textToCheck)) {
    return "مشتريات رقمية فقط";
  }
  if (/أغلقنا هذا الحساب|تم إغلاق|closed this account|إنهاء الحسابات|terminate/i.test(textToCheck)) {
    return "إغلاق وحظر الحساب";
  }
  return "حساب مقيد / محظور";
}

function isAmazonInbox(inbox, messages = null) {
  if (!inbox) return false;
  if (!isOfficial(inbox)) return false;
  if (inbox.isAmazon === true || inbox.isBanned === true || inbox.banStatus === 'confirmed' || inbox.banStatus === 'suspected') return true;

  const meta = [inbox.email, inbox.label, inbox.personName].filter(Boolean).join(' ').toLowerCase();
  if (/amazon|أمازون|امازون|إمازون/i.test(meta)) return true;

  const allMsgs = messages || [...state.messages, ...state.officialMessages, ...state.amazonMessages, ...state.bannedMessages];
  const inboxEmail = String(inbox.email || '').toLowerCase().trim();
  return allMsgs.some(m => String(m.inboxEmail || '').toLowerCase().trim() === inboxEmail && isAmazonMessage(m));
}

function isConfirmedBanned(inbox) {
  if (!inbox || !isOfficial(inbox)) return false;
  return inbox.banStatus === 'confirmed' || inbox.isBanned === true;
}

function isSuspectedInbox(inbox, messages = null) {
  if (!inbox || !isOfficial(inbox)) return false;
  if (inbox.banStatus === 'safe') return false;
  if (inbox.banStatus === 'confirmed' || inbox.isBanned === true) return false;
  if (inbox.banStatus === 'suspected') return true;

  const allMsgs = messages || [...state.messages, ...state.officialMessages, ...state.amazonMessages, ...state.bannedMessages];
  const inboxEmail = String(inbox.email || '').toLowerCase().trim();
  return allMsgs.some(m => (String(m.inboxEmail || '').toLowerCase().trim() === inboxEmail || formatAddress(m.to).toLowerCase().includes(inboxEmail)) && isBannedMessage(m));
}

function isBannedInbox(inbox) {
  return isConfirmedBanned(inbox);
}

function formatAddress(value) {
  if (!value) return '';
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map(formatAddress).filter(Boolean).join(', ');
  if (typeof value === 'object') {
    const address = value.address || value.email || '';
    const name = value.name || '';
    return name && address && name !== address ? `${name} <${address}>` : address || name;
  }
  return String(value);
}

function decodeRfc2047(str) {
  if (!str || typeof str !== 'string') return '';
  return str.replace(/=\?([^?]+)\?([BQ])\?([^?]*)\?=/gi, (_, charset, encoding, content) => {
    try {
      if (encoding.toUpperCase() === 'B') {
        return decodeURIComponent(escape(atob(content)));
      }
      return content.replace(/_/g, ' ');
    } catch {
      return content;
    }
  });
}

function cleanSenderName(val, subject = '') {
  if (!val) return 'مرسل غير معروف';
  let str = typeof val === 'object' ? (val.text || val.name || val.address || '') : String(val);
  str = decodeRfc2047(str).trim();

  // If has friendly name: "Friendly Name" <email@domain.com>
  const matchName = str.match(/^["']?([^"<]+?)["']?\s*<([^>]+)>/);
  if (matchName) {
    const friendly = matchName[1].trim();
    const email = matchName[2].trim();
    if (friendly && friendly !== email && !/^[a-f0-9A-F_-]{16,}$/.test(friendly) && !/^[0-9]+[a-z0-9-]+$/i.test(friendly)) {
      return friendly;
    }
    str = email;
  }

  str = str.replace(/^<|>$/g, '').trim();

  // Amazon technical bounce / SES envelopes
  if (/@(?:bounces\.)?amazon\.(sa|com|ae|eg|ca|co\.uk|de|fr)/i.test(str)) {
    const isSa = /amazon\.sa/i.test(str) || /[\u0600-\u06FF]/.test(subject);
    const isCa = /amazon\.ca/i.test(str);
    const isAe = /amazon\.ae/i.test(str);
    const isUk = /amazon\.co\.uk/i.test(str);
    if (/ofm@/i.test(str)) return 'أمازون OFM (مراجعة أمنية)';
    if (/order-update@|auto-confirm@|shipment/i.test(str)) return isSa ? 'أمازون السعودية (طلبات)' : 'Amazon Orders';
    if (isSa) return 'أمازون السعودية (Amazon.sa)';
    if (isCa) return 'Amazon Canada (أمازون)';
    if (isAe) return 'Amazon.ae (أمازون)';
    if (isUk) return 'Amazon UK (أمازون)';
    return 'أمازون (Amazon)';
  }

  // Generic technical bounce addresses: 12345678abcdef...@bounces.domain.com
  const bounceMatch = str.match(/^[a-f0-9A-F_-]{12,}@(?:bounces\.)?([a-zA-Z0-9.-]+\.[a-zA-Z]{2,})$/);
  if (bounceMatch) {
    const domain = bounceMatch[1];
    const brand = domain.split('.')[0];
    return brand.charAt(0).toUpperCase() + brand.slice(1);
  }

  return str;
}

function initials(value) {
  const words = String(value || '@').replace(/[<>@._-]/g, ' ').trim().split(/\s+/).filter(Boolean);
  return (words.slice(0, 2).map(word => word[0]).join('') || '@').toUpperCase();
}

function normalize(value) { return String(value || '').toLowerCase().normalize('NFKD').trim(); }
function formatNumber(value) { return new Intl.NumberFormat('ar-SA', { maximumFractionDigits: 0 }).format(Number(value) || 0); }
function formatDate(value, long = false) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat('ar-SA', long
    ? { dateStyle: 'medium', timeStyle: 'short' }
    : { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(date);
}
function html(value) { return String(value ?? '').replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char]); }
function attr(value) { return html(value); }
function friendlyError(error) { return error?.name === 'AbortError' ? 'انتهت مهلة الاتصال بالخادم' : (error?.message || 'حدث خطأ غير متوقع'); }
function decodeBase64IfNeeded(str) {
  if (!str || typeof str !== 'string') return '';
  const trimmed = str.trim();
  if (trimmed.length > 20 && /^[A-Za-z0-9+/=\r\n]+$/.test(trimmed)) {
    try {
      const clean = trimmed.replace(/\s+/g, '');
      const binary = atob(clean);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      const decoded = new TextDecoder('utf-8').decode(bytes);
      if (decoded && !/[\x00-\x08\x0B\x0C\x0E-\x1F]/.test(decoded) && /[\u0600-\u06FF\w]/.test(decoded)) {
        return decoded;
      }
    } catch (e) {}
  }
  return str;
}

function hasVisibleContent(htmlStr) {
  if (!htmlStr || typeof htmlStr !== 'string') return false;
  const hasMedia = /<img\s[^>]*src=|<table|<button/i.test(htmlStr);
  const bodyMatch = htmlStr.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  const content = bodyMatch ? bodyMatch[1] : htmlStr;
  const textOnly = content.replace(/<style[\s\S]*?<\/style>/gi, '')
                          .replace(/<script[\s\S]*?<\/script>/gi, '')
                          .replace(/<head[\s\S]*?<\/head>/gi, '')
                          .replace(/<title[\s\S]*?<\/title>/gi, '')
                          .replace(/<[^>]+>/g, '')
                          .replace(/&[a-z0-9#]+;/gi, ' ')
                          .trim();
  if (hasMedia) return true;
  return textOnly.length >= 10;
}

function plainDocument(rawText) {
  const text = decodeBase64IfNeeded(rawText || '');
  let safe = html(text);

  // Convert "Action Title (https://...)" into handsome action buttons
  const actionRegex = /([^()\n]{2,40})\s*\((https?:\/\/[^\s)]+)\)/g;
  safe = safe.replace(actionRegex, (_, label, url) => {
    const isDanger = /إلغاء|حظر|حذف|إغلاق|delete|cancel|close/i.test(label);
    const bg = isDanger ? '#ef4444' : '#ff9900';
    const color = isDanger ? '#ffffff' : '#111827';
    return `<div style="margin: 14px 0;"><a href="${url}" target="_blank" rel="noopener noreferrer" style="display: inline-block; padding: 12px 24px; background: ${bg}; color: ${color}; font-weight: bold; text-decoration: none; border-radius: 12px; font-size: 14px; box-shadow: 0 2px 6px rgba(0,0,0,0.08);">${label.trim()}</a></div>`;
  });

  // Auto-link remaining bare URLs
  safe = safe.replace(/(^|[^"'])(https?:\/\/[^\s<)]+)/g, '$1<a href="$2" target="_blank" rel="noopener noreferrer" style="color: #2563eb; text-decoration: underline; word-break: break-all;">$2</a>');

  return `<!doctype html>
<html dir="auto">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
    *, *::before, *::after { box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Cairo", Helvetica, Arial, sans-serif;
      line-height: 1.8;
      padding: 24px 20px;
      color: #1e293b;
      background: #ffffff;
      margin: 0;
      white-space: pre-wrap;
      word-break: break-word;
      font-size: 15px;
    }
  </style>
</head>
<body dir="auto">${safe}</body>
</html>`;
}
function loadingDocument() { return '<!doctype html><style>body{margin:0;background:#f6f9fc}div{width:55%;height:14px;margin:50px auto;border-radius:8px;background:#dce6ef;box-shadow:0 28px #e5edf4,0 56px #e5edf4;animation:p 1s infinite alternate}@keyframes p{to{opacity:.35}}</style><div></div>'; }
