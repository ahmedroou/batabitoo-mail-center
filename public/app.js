'use strict';

const API_BASE = /(?:web\.app|firebaseapp\.com)$/.test(location.hostname) ? 'https://inbox-api.batabitoo.com' : '';
let readerRequest = 0;
let stopReaderResize = () => {};
let readerReturnScroll = 0;
let readerReturnFocus;

const SEEN_KEY = 'batabitoo_seen_inbox_counts';
let seenCounts = {};
try {
  seenCounts = JSON.parse(localStorage.getItem(SEEN_KEY) || '{}');
} catch (e) {
  seenCounts = {};
}

function saveSeenCounts() {
  try {
    localStorage.setItem(SEEN_KEY, JSON.stringify(seenCounts));
  } catch (e) {}
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
    const otp = event.target.closest('[data-copy-otp]');
    if (otp) {
      event.stopPropagation();
      copyText(decodeURIComponent(otp.dataset.copyOtp), 'تم نسخ رمز التحقق');
      return;
    }
    const message = event.target.closest('[data-message-id]');
    if (message) openMessage(decodeURIComponent(message.dataset.messageId));
  });

  // Dedicated Amazon Hub Event Listeners
  $('open-amazon-hub-btn')?.addEventListener('click', () => switchContentView('amazon'));
  $('stat-amazon-card')?.addEventListener('click', () => switchContentView('amazon'));
  $('amazon-quick-create-btn')?.addEventListener('click', createQuickAmazonInbox);
  $('amazon-copy-active-btn')?.addEventListener('click', () => copyText(state.activeInbox?.email, 'تم نسخ عنوان البريد النشط'));
  $('amazon-refresh-btn')?.addEventListener('click', refreshAmazonHub);
  $('amazon-search')?.addEventListener('input', renderAmazonMessages);
  $('amazon-sub-tabs')?.addEventListener('click', event => {
    const btn = event.target.closest('[data-amazon-filter]');
    if (!btn) return;
    state.amazonSubFilter = btn.dataset.amazonFilter;
    document.querySelectorAll('[data-amazon-filter]').forEach(b => b.classList.toggle('active', b === btn));
    renderAmazonMessages();
  });
  $('amazon-inboxes-reel')?.addEventListener('click', event => {
    const addBtn = event.target.closest('#reel-quick-add');
    if (addBtn) {
      createQuickAmazonInbox();
      return;
    }
    const item = event.target.closest('[data-reel-inbox]');
    if (!item) return;
    const target = item.dataset.reelInbox;
    state.amazonSelectedInbox = target === 'all' ? null : target;
    renderAmazonInboxesReel();
    renderAmazonMessages();
  });
  $('amazon-message-list')?.addEventListener('click', event => {
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
    if (event.state?.screen === 'reader') openMessage(event.state.messageId, false);
    else if (state.currentMessage) closeReader(false);
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
    $('prefix-suffix').textContent = state.createType === 'official' ? '@batabitoo.com' : '@نطاق سريع';
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
    } else if (target === 'amazon') {
      document.querySelector('.workspace').classList.add('show-content');
      switchContentView('amazon');
    } else {
      document.querySelector('.workspace').classList.add('show-content');
      if (target === 'logs') switchContentView('logs');
      else if (state.view === 'logs' || state.view === 'amazon') switchContentView('current');
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

async function api(path, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);
  try {
    const response = await fetch(API_BASE + path, { ...options, signal: controller.signal });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
    return data;
  } finally {
    clearTimeout(timeout);
  }
}

async function refreshEverything() {
  if (state.loading) return;
  state.loading = true;
  $('refresh-all').classList.add('spin');
  try {
    await Promise.all([loadStatus(), loadInboxes(), loadCounts(), loadLogs(false)]);
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

async function updateBanStatus(id, banStatus, reason = '') {
  try {
    await api('/api/inbox/ban-status', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, banStatus, reason })
    });
    const text = banStatus === 'confirmed' ? 'تم تأكيد حظر الحساب بنجاح ⛔' : 'تم تأكيد سلامة الحساب وإلغاء الاشتباه ✅';
    toast(text);
    await refreshEverything();
  } catch (err) {
    toast(friendlyError(err), true);
  }
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
  try {
    await api('/api/ai/feedback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ inboxId, messageId, verdict, subject })
    });
    if (verdict === 'confirm') {
      toast('تم تأكيد إغلاق الحساب وتسجيل الحالة ⛔');
    } else {
      toast('تم استبعاد هذا النمط وتحديث قواعد النظام بنجاح 🧠');
    }
    if (state.currentMessage) closeReader(false);
    await refreshEverything();
  } catch (err) {
    toast(friendlyError(err), true);
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
  const data = await api('/api/inboxes');
  state.official = (data.official || []).map(i => ({
    ...i,
    isBanned: isConfirmedBanned(i),
    isSuspected: isSuspectedInbox(i),
    isAmazon: isAmazonInbox(i)
  }));
  state.temp = data.temp || [];
  state.amazon = (data.amazon || state.official.filter(i => i.isAmazon)).map(i => ({
    ...i,
    isAmazon: true,
    isBanned: isConfirmedBanned(i),
    isSuspected: isSuspectedInbox(i)
  }));
  state.banned = (data.banned || state.official.filter(i => isConfirmedBanned(i))).map(i => ({ ...i, isBanned: true, isAmazon: true }));
  state.suspected = (data.suspected || state.official.filter(i => isSuspectedInbox(i))).map(i => ({ ...i, isAmazon: true, isSuspected: true }));
  state.activeId = data.activeId || state.activeId;
  if (state.activeId) {
    markInboxAsRead(state.activeId);
  }
  $('official-count').textContent = formatNumber(state.official.length);
  $('temp-count').textContent = formatNumber(state.temp.length);
  if ($('amazon-count')) $('amazon-count').textContent = formatNumber(state.amazon.length);
  if ($('banned-count')) $('banned-count').textContent = formatNumber(state.banned.length);
  autoVerifySuspectedInboxes();
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
          ${banned ? `<span class="banned-badge" title="${attr(reason)}">⛔ ${html(reason)}</span>` : suspected ? `<span class="suspected-badge" title="${attr(reason)}">⚠️ اشتباه حظر</span>` : ''}
        </div>
        <span>${html(inbox.email || '')}</span>
        ${suspected ? `
        <div class="ban-confirm-inline" onclick="event.stopPropagation()">
          <span class="ban-confirm-q">اشتباه حظر بانتظار تأكيدك أو استبعاد النمط:</span>
          <div class="ban-confirm-btns">
            ${suspectMsg ? `<button class="btn-view-suspect" type="button" data-open-message="${attr(encodeURIComponent(suspectMsg.id))}" title="معاينة الرسالة التي تسببت في الاشتباه">🔍 معاينة الرسالة</button>` : ''}
            <button class="btn-confirm-ban" type="button" data-confirm-ban="${attr(inbox.id)}" data-msg-id="${attr(suspectMsg?.id || '')}" data-msg-subject="${attr(suspectMsg?.subject || '')}" title="تأكيد الحظر">تأكيد الحظر ⛔</button>
            <button class="btn-mark-safe" type="button" data-mark-safe="${attr(inbox.id)}" data-msg-id="${attr(suspectMsg?.id || '')}" data-msg-subject="${attr(suspectMsg?.subject || '')}" title="استبعاد هذا النمط وتدريب الكود">استبعاد النمط ❌</button>
          </div>
        </div>` : ''}
      </div>`
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

function switchContentView(view) {
  if (state.currentMessage) closeReader(false);
  state.view = view;
  placeHero();
  $('content-search').value = '';
  document.querySelectorAll('[data-view]').forEach(button => button.classList.toggle('active', button.dataset.view === view));

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
  const inboxes = state.amazon || [];
  const selectedEmail = state.amazonSelectedInbox;

  let htmlStr = `<button class="amazon-reel-item ${!selectedEmail ? 'active' : ''}" data-reel-inbox="all">
    <span>🌐 كل حسابات أمازون</span>
    <span class="reel-count">${formatNumber(state.amazonMessages.length)}</span>
  </button>`;

  htmlStr += inboxes.map(inbox => {
    const isSelected = selectedEmail && inbox.email?.toLowerCase() === selectedEmail.toLowerCase();
    const count = (state.amazonMessages || []).filter(m => (m.inboxEmail || '').toLowerCase() === (inbox.email || '').toLowerCase()).length;
    const label = inbox.personName || inbox.label || inbox.email?.split('@')[0] || 'حساب';
    const isBanned = isConfirmedBanned(inbox);
    const isSuspected = isSuspectedInbox(inbox);
    return `<button class="amazon-reel-item ${isSelected ? 'active' : ''} ${isSuspected ? 'is-suspected' : isBanned ? 'is-banned' : ''}" data-reel-inbox="${attr(inbox.email || '')}" title="${attr(inbox.email || '')}">
      <span>${isBanned ? '⛔' : isSuspected ? '⚠️' : '🛒'} ${html(label)}</span>
      <span class="reel-count">${formatNumber(count)}</span>
    </button>`;
  }).join('');

  htmlStr += `<button class="amazon-reel-add" id="reel-quick-add" type="button" title="إنشاء حساب تتابعي فوري">
    <svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>
    <span>+ حساب جديد</span>
  </button>`;

  reel.innerHTML = htmlStr;
}

function renderAmazonMessages() {
  const container = $('amazon-message-list');
  if (!container) return;
  const list = getFilteredAmazonMessages();

  if (!list.length) {
    container.innerHTML = `<div class="empty-state" style="padding: 36px 16px;">
      <div class="empty-icon">🛒</div>
      <h3>لا توجد رسائل مطابقة</h3>
      <p>لم يتم العثور على رسائل تحت هذا التصنيف في أمازون.</p>
    </div>`;
    return;
  }

  container.innerHTML = list.map(message => {
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
        <div class="ban-confirm-inline" onclick="event.stopPropagation()">
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
  }).join('');
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

  if ($('amazon-stat-inboxes')) $('amazon-stat-inboxes').textContent = formatNumber(state.amazon.length);
  if ($('amazon-stat-messages')) $('amazon-stat-messages').textContent = formatNumber(amzMsgs.length);
  if ($('amazon-stat-otps')) $('amazon-stat-otps').textContent = formatNumber(otps.length);
  if ($('amazon-stat-suspected')) $('amazon-stat-suspected').textContent = formatNumber(state.suspected.length || suspectedMsgs.length);
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
    const isOff = isOfficial(state.activeInbox) || (message.inboxEmail && message.inboxEmail.endsWith('@batabitoo.com'));

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
  const prefix = $('create-prefix').value.trim();
  const path = state.createType === 'official' ? '/api/official/create' : '/api/inboxes/create';
  const button = $('create-submit');
  setBusy(button, true, 'جاري إنشاء الصندوق…');
  try {
    const data = await api(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ personName: name || undefined, label: name || undefined, prefix: prefix || undefined })
    });
    if (!data.inbox) throw new Error('لم يرجع الخادم صندوقًا جديدًا');
    $('create-modal').classList.add('hidden');
    $('create-form').reset();
    state.inboxType = state.createType;
    document.querySelectorAll('[data-inbox-type]').forEach(item => item.classList.toggle('active', item.dataset.inboxType === state.inboxType));
    await loadInboxes();
    await selectInbox(data.inbox.id);
    toast(`تم إنشاء ${data.inbox.email}`);
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
  return inbox?.isOfficial === true || inbox?.type === 'official' || String(inbox?.email || '').toLowerCase().endsWith('@batabitoo.com');
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
