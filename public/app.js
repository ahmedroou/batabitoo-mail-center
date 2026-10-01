'use strict';

const API_BASE = '';
let readerRequest = 0;
let stopReaderResize = () => {};
let readerReturnScroll = 0;
let readerReturnFocus;
let readerReturnContext = null;

const SEEN_KEY = 'batabitoo_seen_inbox_counts';
let seenCounts = {};
let manualBanDecisions = {};
try {
  seenCounts = JSON.parse(localStorage.getItem(SEEN_KEY) || '{}');
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
  const all = [...state.official, ...state.amazon, ...state.banned];
  const inbox = all.find(i => i.id === id);
  const count = currentCount !== undefined ? currentCount : (inbox ? Number(inbox.messageCount || 0) : 0);
  seenCounts[id] = count;
  saveSeenCounts();
}

function updateFilterUnreadDots() {
  const checkList = (arr) => (arr || []).some(isInboxUnread);
  const officialUnread = checkList(state.official);
  const amazonUnread = checkList(state.amazon);
  const bannedUnread = checkList(state.banned);
  const anyUnread = officialUnread || amazonUnread || bannedUnread;

  document.querySelector('[data-inbox-type="official"] b')?.classList.toggle('has-unread', officialUnread);
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
  officialDomainFilter: 'all',
  amazonView: 'accounts',
  amazonAccountFilter: 'all',
  amazonDomainFilter: 'all',
  amazonSubFilter: 'all',
  logsFilter: 'campaigns',
  amazonSelectedInbox: null,
  activeMessageList: [],
  currentMessageIndex: -1,
  official: [],
  temp: [],
  amazon: [],
  banned: [],
  suspected: [],
  messages: [],
  officialMessages: [],
  tempMessages: [],
  amazonMessages: [],
  bannedMessages: [],
  logs: [],
  currentMessage: null,
  pendingDeleteId: null,
  pendingDeleteAmazon: null,
  deletedAmazonAccounts: new Set(),
  loading: false
};
let inboxLimit = 40;
let amazonAccountLimit = 60;
let amazonMessageLimit = 20;
let bulkMode = false;
const bulkSelectedIds = new Set();
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

const SESSION_TOKEN_KEY = 'batabitoo_session_token';
let enteredPin = '';
let appStarted = false;
let sseConnected = false;
let sseSource = null;

function initEventSource() {
  if (typeof EventSource === 'undefined') return;
  if (sseSource) {
    try { sseSource.close(); } catch (_) {}
  }
  const token = localStorage.getItem(SESSION_TOKEN_KEY) || sessionStorage.getItem(SESSION_TOKEN_KEY);
  const sseUrl = `${API_BASE}/api/events${token ? `?token=${encodeURIComponent(token)}` : ''}`;

  try {
    sseSource = new EventSource(sseUrl, { withCredentials: true });

    sseSource.onopen = () => {
      sseConnected = true;
      console.log('⚡ [SSE] Connected to real-time events stream');
    };

    sseSource.addEventListener('message:new', (e) => {
      try {
        const data = JSON.parse(e.data);
        console.log('📩 [SSE] New message received:', data);
        toast(`📩 رسالة جديدة: ${data.message?.subject || data.inboxEmail || ''}`, 'info');
        if (state.view === 'current') loadCurrent(true);
        else if (state.view === 'messages') loadAllMessages(true);
        loadInboxes();
      } catch (_) {}
    });

    sseSource.addEventListener('inbox:new', () => {
      loadInboxes();
    });

    sseSource.addEventListener('inbox:updated', () => {
      loadInboxes();
    });

    sseSource.addEventListener('inbox:deleted', () => {
      loadInboxes();
    });

    sseSource.addEventListener('status:counts', (e) => {
      try {
        const counts = JSON.parse(e.data);
        updateCounts(counts);
      } catch (_) {}
    });

    sseSource.onerror = () => {
      sseConnected = false;
    };
  } catch (err) {
    sseConnected = false;
  }
}

async function startMainApp() {
  if (appStarted) return;
  appStarted = true;
  await refreshEverything();
  initEventSource();
  setInterval(() => {
    // Only poll as fallback if SSE is disconnected
    if (!sseConnected && !document.hidden && state.view === 'current' && !state.currentMessage) {
      loadCurrent(true);
    }
  }, 15000);
}

function setupPinLock() {
  const overlay = $('pin-lock-overlay');
  const card = $('pin-lock-card');
  const dots = document.querySelectorAll('#pin-dots .pin-dot');
  const hiddenInput = $('pin-input');
  const errorMsg = $('pin-error-msg');
  const lockBtn = $('lock-app-btn');

  if (!overlay) return;

  function updateDots() {
    dots.forEach((dot, idx) => {
      dot.classList.toggle('filled', idx < enteredPin.length);
    });
  }

  function showError(msg = '⚠️ رمز الأمان غير صحيح! حاول مرة أخرى') {
    if (errorMsg) {
      errorMsg.textContent = msg;
      errorMsg.classList.remove('hidden');
    }
    if (card) {
      card.classList.add('shake');
      setTimeout(() => card.classList.remove('shake'), 400);
    }
    enteredPin = '';
    if (hiddenInput) hiddenInput.value = '';
    updateDots();
  }

  function unlock() {
    document.documentElement.classList.add('pin-pre-unlocked');
    overlay.classList.add('unlocked');
    if (errorMsg) errorMsg.classList.add('hidden');
    toast('مرحباً بك! تم إلغاء القفل بنجاح 🔓');
    startMainApp();
  }

  async function checkPin() {
    const pinToCheck = enteredPin;
    enteredPin = '';
    updateDots();

    try {
      const res = await fetch(`${API_BASE}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        ...(API_BASE ? {} : { credentials: 'include' }),
        body: JSON.stringify({ pin: pinToCheck })
      });
      if (res.ok) {
        const data = await res.json().catch(() => ({}));
        if (data.success) {
          if (data.token) {
            sessionStorage.setItem(SESSION_TOKEN_KEY, data.token);
            localStorage.setItem(SESSION_TOKEN_KEY, data.token);
          }
          unlock();
          return;
        }
        showError(data.error || '⚠️ تعذر تسجيل الدخول');
        return;
      } else if (res.status === 401) {
        showError('⚠️ رمز الأمان غير صحيح! حاول مرة أخرى');
        return;
      } else {
        const data = await res.json().catch(() => ({}));
        showError(data.error || `⚠️ تعذر تسجيل الدخول (رمز ${res.status})`);
        return;
      }
    } catch (err) {
      console.warn('Server login endpoint unreachable:', err);
      showError('تعذر الاتصال بخدمة تسجيل الدخول السحابية. حاول مرة أخرى.');
    }
  }

  function addDigit(digit) {
    if (enteredPin.length < 4) {
      enteredPin += digit;
      updateDots();
      if (enteredPin.length === 4) {
        setTimeout(checkPin, 80);
      }
    }
  }

  function deleteDigit() {
    if (enteredPin.length > 0) {
      enteredPin = enteredPin.slice(0, -1);
      updateDots();
      if (errorMsg) errorMsg.classList.add('hidden');
    }
  }

  function clearDigits() {
    enteredPin = '';
    updateDots();
    if (errorMsg) errorMsg.classList.add('hidden');
  }

  // Keypad clicks
  document.querySelectorAll('#pin-keypad .pin-key[data-digit]').forEach(btn => {
    btn.addEventListener('click', () => {
      addDigit(btn.getAttribute('data-digit'));
    });
  });

  $('pin-key-del')?.addEventListener('click', deleteDigit);
  $('pin-key-clear')?.addEventListener('click', clearDigits);

  // Keyboard input
  document.addEventListener('keydown', (e) => {
    if (overlay.classList.contains('unlocked')) return;
    if (e.key >= '0' && e.key <= '9') {
      addDigit(e.key);
    } else if (e.key === 'Backspace') {
      deleteDigit();
    } else if (e.key === 'Escape') {
      clearDigits();
    }
  });

  // Tap dots or card to focus hidden input
  $('pin-dots')?.addEventListener('click', () => {
    hiddenInput?.focus();
  });
  hiddenInput?.addEventListener('input', () => {
    const val = hiddenInput.value.replace(/\D/g, '').slice(0, 4);
    enteredPin = val;
    updateDots();
    if (enteredPin.length === 4) {
      setTimeout(checkPin, 80);
    }
  });

  // Lock button in topbar
  lockBtn?.addEventListener('click', async () => {
    try {
      const token = localStorage.getItem(SESSION_TOKEN_KEY) || sessionStorage.getItem(SESSION_TOKEN_KEY);
      if (token) {
        await fetch(`${API_BASE}/api/auth/logout`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
          },
          ...(API_BASE ? {} : { credentials: 'include' })
        });
      }
    } catch (_) {}
    sessionStorage.removeItem(SESSION_TOKEN_KEY);
    localStorage.removeItem(SESSION_TOKEN_KEY);
    document.cookie = "batabitoo_session=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT; SameSite=Lax";
    document.cookie = "batabitoo_pin=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT; SameSite=Lax";
    document.documentElement.classList.remove('pin-pre-unlocked');
    enteredPin = '';
    updateDots();
    overlay.classList.remove('unlocked');
    toast('تم قفل الموقع برمز الأمان 🔒');
  });

  // Verify existing session with server on startup
  async function checkExistingSession() {
    const token = localStorage.getItem(SESSION_TOKEN_KEY) || sessionStorage.getItem(SESSION_TOKEN_KEY);
    if (token) {
      try {
        const res = await fetch(`${API_BASE}/api/auth/check`, {
          headers: { 'Authorization': `Bearer ${token}` },
          ...(API_BASE ? {} : { credentials: 'include' })
        });
        if (res.ok) {
          document.documentElement.classList.add('pin-pre-unlocked');
          overlay.classList.add('unlocked');
          startMainApp();
          return;
        }
      } catch (_) {}
    }

    document.documentElement.classList.remove('pin-pre-unlocked');
    overlay.classList.remove('unlocked');
    setTimeout(() => hiddenInput?.focus(), 300);
  }

  checkExistingSession();
}

const GMAIL_SYNC_INTERVAL_MS = 30000; // 30 seconds to prevent Google API userRateLimitExceeded (HTTP 403)
const gmailSyncRuns = new Map();

const gmailSyncLastAt = new Map();
const gmailAuthWarnings = new Set();
let currentLoadRequest = 0;

function decodeBase64Url(str) {
  if (!str) return '';
  let base64 = str.replace(/-/g, '+').replace(/_/g, '/');
  while (base64.length % 4) base64 += '=';
  try {
    return decodeURIComponent(escape(atob(base64)));
  } catch (e) {
    try {
      return atob(base64);
    } catch (e2) {
      return str;
    }
  }
}

function extractOtpFromText(text, subject) {
  const input = `${subject || ''}\n${text || ''}`;
  const match = input.match(/(?:رمز\s*(?:التحقق|التأكيد|التفعيل|الدخول|الأمان|المرور)|كود\s*(?:التحقق|التأكيد|التفعيل|الدخول)|verification\s*code|security\s*code|one-time\s*(?:password|code)|\botp\b|your\s*code|access\s*code|password\s*reset\s*code)[^\d\n]{0,60}[\s:=-]*([0-9]{4,8})\b/i);
  if (match) return match[1];
  const lines = input.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (/^[0-9]{4,8}$/.test(trimmed)) return trimmed;
  }
  const hyphenated = input.match(/(?:code|otp|رمز|كود)[^\d\n]{0,30}([0-9]{3}[\s-][0-9]{3})/i);
  if (hyphenated) return hyphenated[1].replace(/[\s-]/g, '');
  return null;
}

function extractCleanEmail(str) {
  if (!str) return '';
  const matchAngle = String(str).match(/<([^>]+)>/);
  if (matchAngle) return matchAngle[1].trim().toLowerCase();
  const matchPlain = String(str).match(/[a-zA-Z0-9_\.\+\-]+@[a-zA-Z0-9_\.\-]+\.[a-zA-Z]{2,}/);
  if (matchPlain) return matchPlain[0].trim().toLowerCase();
  return String(str).trim().toLowerCase();
}

function generateDottedVariants(email, max = 12) {
  if (!email || !email.includes('@')) return [];
  const [user, domain] = email.split('@');
  const base = user.replace(/\./g, '');
  if (base.length < 2) return [];
  const variants = [];
  for (let i = 1; i < base.length && variants.length < max; i++) {
    const variant = base.slice(0, i) + '.' + base.slice(i) + '@' + domain;
    if (variant.toLowerCase() !== email.toLowerCase()) {
      variants.push(variant.toLowerCase());
    }
  }
  return variants;
}

// ============================================================
// 🤖 AUTO-DISCOVERY ENGINE FOR DOTTED GMAIL AMAZON ACCOUNTS
// Detects when an Amazon account was created with a dotted variant
// of ANY connected Gmail account and registers it automatically!
// ============================================================
const notifiedDottedAccounts = new Set();

function getStoredDottedInboxes() {
  return [];
}

function saveStoredDottedInboxes() {}

function getConnectedGmailHosts() {
  const list = state.official || [];
  return list.filter(i => {
    const email = String(i.email || '').toLowerCase().trim();
    return email.endsWith('@gmail.com') && !i.isDottedGmailAlias;
  });
}

function detectDottedAliasForHost(targetEmail, hosts = null) {
  if (!targetEmail) return null;
  const clean = extractCleanEmail(targetEmail).toLowerCase().trim();
  if (!clean.endsWith('@gmail.com')) return null;
  const [userPart] = clean.split('@');
  const baseUser = userPart.replace(/\./g, '');
  if (!baseUser) return null;

  const candidateHosts = hosts || getConnectedGmailHosts();
  for (const host of candidateHosts) {
    const hostEmail = String(host.email || '').toLowerCase().trim();
    const [hostUser] = hostEmail.split('@');
    const hostBase = hostUser.replace(/\./g, '');
    if (hostBase === baseUser) {
      const isDotted = clean !== hostEmail;
      return {
        host,
        dottedEmail: clean,
        baseUser,
        isDotted
      };
    }
  }
  return null;
}

function isDottedGmailAccount(inbox) {
  if (!inbox || !inbox.email) return false;
  // Explicit dotted alias flag
  if (inbox.isDottedGmailAlias === true) return true;
  // Host accounts connected via OAuth are NEVER dotted
  if (inbox.isRealGmail || inbox.gmailAuthType === 'oauth2') return false;
  // If type is explicitly 'official' with no parentEmail, it's a host account
  if (inbox.type === 'official' && !inbox.parentEmail) return false;
  const email = String(inbox.email).toLowerCase().trim();
  const parent = String(inbox.parentEmail || '').toLowerCase().trim();
  if (parent && parent !== email) return true;
  if (!email.endsWith('@gmail.com')) return false;
  const [userPart] = email.split('@');
  if (!userPart.includes('.')) return false;
  const hosts = getConnectedGmailHosts();
  const detected = detectDottedAliasForHost(email, hosts);
  return Boolean(detected && detected.isDotted);
}

const dottedInboxPersistedOrPending = new Set();
function registerAutoDiscoveredDottedInbox(dottedEmail, hostInbox, originMessage = null) {
  if (!dottedEmail || !hostInbox) return null;
  const cleanEmail = dottedEmail.toLowerCase().trim();
  const parentEmail = String(hostInbox.email || '').toLowerCase().trim();
  const docId = `gmail_amz_${cleanEmail.replace(/[^a-z0-9]/g, '_')}`;

  const displayName = `أمازون (${cleanEmail.split('@')[0]})`;
  const newRecord = {
    id: docId,
    email: cleanEmail,
    domain: 'gmail.com',
    host: 'Gmail (Amazon Dotted Auto-Discovered)',
    isOfficial: false,
    isAmazon: true,
    isDottedGmailAlias: true,
    parentEmail: parentEmail,
    banStatus: 'none',
    isBanned: false,
    type: 'amazon',
    label: displayName,
    personName: displayName,
    createdAt: originMessage?.createdAt || new Date().toISOString(),
    messageCount: originMessage ? 1 : 0,
    autoDiscovered: true
  };

  // 1. Update persistent localStorage cache
  const stored = getStoredDottedInboxes();
  const existingStoredIdx = stored.findIndex(s => s.email === cleanEmail);
  if (existingStoredIdx >= 0) {
    stored[existingStoredIdx] = { ...stored[existingStoredIdx], ...newRecord };
  } else {
    stored.push(newRecord);
  }
  saveStoredDottedInboxes(stored);

  // 2. Remove from state.official if it was there (Official must be the primary host account only)
  if (state.official) {
    state.official = state.official.filter(i => (i.email || '').toLowerCase() !== cleanEmail);
  }

  // 3. Add exclusively to state.amazon
  let isNew = false;
  if (!state.amazon) state.amazon = [];
  const amzIdx = state.amazon.findIndex(i => (i.email || '').toLowerCase() === cleanEmail);
  if (amzIdx >= 0) {
    state.amazon[amzIdx] = { ...state.amazon[amzIdx], ...newRecord };
  } else {
    state.amazon.unshift(newRecord);
    isNew = true;
  }

  // 4. At most one registration per discovered alias/session; failed requests
  // remain retryable. This is transient request deduplication, not a database.
  if (!dottedInboxPersistedOrPending.has(cleanEmail)) {
    dottedInboxPersistedOrPending.add(cleanEmail);
    api('/api/official/create', {
    method: 'POST',
    body: JSON.stringify({
      email: cleanEmail,
      label: displayName,
      personName: displayName,
      domain: 'gmail.com',
      isOfficial: false,
      isAmazon: true,
      isDottedGmailAlias: true,
      parentEmail: parentEmail
    })
    }).catch(() => { dottedInboxPersistedOrPending.delete(cleanEmail); });
  }

  if (isNew && !notifiedDottedAccounts.has(cleanEmail)) {
    notifiedDottedAccounts.add(cleanEmail);
    toast(`🎯 تم تلقائياً اكتشاف وتفعيل حساب أمازون نقطي جديد: ${cleanEmail}`);
    renderInboxes();
    renderAmazonHub();
    if ($('amazon-count')) $('amazon-count').textContent = formatNumber(state.amazon.length);
    if ($('official-count')) $('official-count').textContent = formatNumber(state.official.length);
    if ($('amazon-stat-inboxes')) $('amazon-stat-inboxes').textContent = formatNumber(state.amazon.length);
  }

  return newRecord;
}

function scanAndAutoDiscoverDottedAccounts(messagesList = null) {
  const hosts = getConnectedGmailHosts();
  if (!hosts.length) return;

  const msgs = messagesList || [
    ...(state.messages || []),
    ...(state.officialMessages || []),
    ...(state.amazonMessages || [])
  ];

  for (const m of msgs) {
    const candidates = new Set();
    if (m.exactRecipient) candidates.add(m.exactRecipient);
    if (m.inboxEmail) candidates.add(m.inboxEmail);
    if (m.to) {
      const c = extractCleanEmail(m.to);
      if (c) candidates.add(c);
    }
    if (m.deliveredTo) {
      const c = extractCleanEmail(m.deliveredTo);
      if (c) candidates.add(c);
    }

    const textSnippet = `${m.subject || ''} ${m.intro || ''} ${m.text || ''}`.slice(0, 1500);
    const textMatches = textSnippet.match(/[a-zA-Z0-9\.]+@gmail\.com/gi) || [];
    textMatches.forEach(em => candidates.add(em.toLowerCase().trim()));

    for (const cand of candidates) {
      const cleanCand = cand.toLowerCase().trim();
      if (state.deletedAmazonAccounts && state.deletedAmazonAccounts.has(cleanCand)) {
        continue;
      }
      const detected = detectDottedAliasForHost(cand, hosts);
      if (detected && detected.isDotted) {
        const cleanDotted = (detected.dottedEmail || '').toLowerCase().trim();
        if (state.deletedAmazonAccounts && state.deletedAmazonAccounts.has(cleanDotted)) {
          continue;
        }
        registerAutoDiscoveredDottedInbox(detected.dottedEmail, detected.host, m);
      }
    }
  }
}


async function syncGmailMessagesDirect(userEmail) {
  if (!userEmail) return 0;
  const cleanEmail = String(userEmail).toLowerCase().trim();

  // The server owns OAuth credentials and Gmail reads. The browser never
  // stores an access/refresh token or sends one back to the API.
  try {
    const res = await api('/api/gmail/sync', {
      method: 'POST',
      body: JSON.stringify({ email: cleanEmail })
    });
    return res.newCount || res.count || 0;
  } catch (e) {
    const msg = String(e.message || '');
    if (msg.includes('غير مسجل') || msg.includes('غير متصل') || msg.includes('not found') || msg.includes('404') || msg.includes('صلاحية')) {
      const err = new Error(`حساب Gmail (${cleanEmail}) يحتاج إعادة ربط. اضغط [+ صندوق جديد → Gmail] لربط الحساب.`);
      err.code = 'GMAIL_AUTH_EXPIRED';
      throw err;
    }
    throw e;
  }
}

function gmailParentEmail(inbox) {
  if (inbox?.parentEmail) return String(inbox.parentEmail).trim().toLowerCase();
  const rawEmail = String(inbox?.email || '').trim().toLowerCase();
  if (rawEmail.endsWith('@gmail.com')) {
    const [user] = rawEmail.split('@');
    return user.replace(/\./g, '') + '@gmail.com';
  }
  return rawEmail;
}

function messageBelongsToInbox(message, inbox) {
  if (!message || !inbox?.email) return false;
  const email = String(inbox.email).trim().toLowerCase();
  const exactRecipient = String(message.exactRecipient || message.inboxEmail || '').trim().toLowerCase();
  const to = String(message.to || '').toLowerCase();
  const parent = String(message.parentEmail || '').trim().toLowerCase();
  if (inbox.isDottedGmailAlias) return exactRecipient === email || to.includes(email);
  return exactRecipient === email || to.includes(email) || parent === email;
}

async function syncGmailInbox(inbox, { force = false, notify = false } = {}) {
  const parentEmail = gmailParentEmail(inbox);
  if (!parentEmail.endsWith('@gmail.com')) return { status: 'not-gmail', newCount: 0 };

  const running = gmailSyncRuns.get(parentEmail);
  if (running) return running;
  const lastAt = gmailSyncLastAt.get(parentEmail) || 0;
  if (!force && Date.now() - lastAt < GMAIL_SYNC_INTERVAL_MS) return { status: 'throttled', newCount: 0 };

  const run = syncGmailMessagesDirect(parentEmail)
    .then(newCount => {
      gmailSyncLastAt.set(parentEmail, Date.now());
      gmailAuthWarnings.delete(parentEmail);
      return { status: 'synced', newCount };
    })
    .catch(error => {
      const isAuthIssue = error?.code === 'GMAIL_AUTH_EXPIRED' || (error.message && (error.message.includes('غير متصل') || error.message.includes('إعادة ربط') || error.message.includes('تسجيل الدخول')));
      if (notify && !isAuthIssue && !gmailAuthWarnings.has(parentEmail) && !document.hidden) {
        gmailAuthWarnings.add(parentEmail);
        toast(error.message, 'info');
      }
      return { status: 'not-connected', newCount: 0, error: error.message };
    })
    .finally(() => gmailSyncRuns.delete(parentEmail));

  gmailSyncRuns.set(parentEmail, run);
  return run;
}

document.addEventListener('DOMContentLoaded', init);

async function init() {
  bindEvents();
  setupPinLock();
  placeHero();
  mobileLayout.addEventListener('change', placeHero);
  const desktopLayout = matchMedia('(min-width: 1024px)');
  const handleDesktopLayout = () => {
    if (state.currentMessage) {
      if (desktopLayout.matches) {
        document.body.classList.add('layout-3panel', 'is-reading');
        $('feed-shell')?.classList.remove('hidden');
      } else {
        document.body.classList.remove('layout-3panel');
        $('feed-shell')?.classList.add('hidden');
      }
    }
  };
  desktopLayout.addEventListener('change', handleDesktopLayout);
  window.addEventListener('resize', handleDesktopLayout);
  const hour = new Date().getHours();
  document.querySelector('.brand-copy > span').textContent = hour < 12 ? 'صباح الخير 👋' : 'مساء الخير 👋';
  updateActiveInbox();
  if ('caches' in window) {
    caches.keys().then(names => {
      names.forEach(n => { if (n !== 'batabitoo-mail-v31-nocache') caches.delete(n); });
    }).catch(() => {});
  }
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').then(reg => reg.update()).catch(() => {});
  }

  // Check Google OAuth URL parameters
  const urlParams = new URLSearchParams(window.location.search);
  if (urlParams.get('gmail_connected')) {
    const linkedEmail = urlParams.get('email') || 'Gmail';
    const newCount = Number(urlParams.get('new_count') || 0);
    toast(`تم ربط حساب Google (${linkedEmail}) بنجاح${newCount ? ` وسُحبت ${newCount} رسالة` : ''}. 🟢`);
    if (urlParams.get('gmail_warning')) {
      toast(`تم حفظ الربط، لكن المزامنة الأولى لم تكتمل: ${urlParams.get('gmail_warning')}`, 'info');
    }
    window.history.replaceState({}, document.title, '/');
  } else if (urlParams.get('gmail_error') || urlParams.get('error')) {
    const errText = urlParams.get('gmail_error') || urlParams.get('error');
    toast(`تعذر ربط حساب Google: ${errText}`, 'error');
    window.history.replaceState({}, document.title, '/');
  } else if (urlParams.get('code')) {
    // Authorization codes must be exchanged on a trusted backend, never with a
    // client secret embedded in the browser bundle.
    toast('تعذر إكمال الربط القديم بأمان. استخدم زر تسجيل الدخول إلى Google مرة أخرى.', 'error');
    window.history.replaceState({}, document.title, '/');
  }
}

function bindEvents() {
  $('refresh-all').addEventListener('click', refreshEverything);
  $('refresh-current').addEventListener('click', () => loadCurrent(false));
  $('sync-remote-btn')?.addEventListener('click', syncActiveRemoteInbox);
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
    if (bulkMode) exitBulkMode();
    else renderInboxes();
  });

  // Official sub-domain tabs (All vs Batabitoo vs Gmail)
  $('official-sub-selector')?.addEventListener('click', event => {
    const btn = event.target.closest('[data-official-filter]');
    if (!btn) return;
    state.officialDomainFilter = btn.dataset.officialFilter || 'all';
    document.querySelectorAll('#official-sub-selector .sub-tab-pill').forEach(b => b.classList.toggle('active', b === btn));
    renderInboxes();
  });

  // Amazon sub-domain tabs (All vs Batabitoo vs Gmail & Dotted)
  $('amazon-domain-selector')?.addEventListener('click', event => {
    const btn = event.target.closest('[data-amazon-domain]');
    if (!btn) return;
    state.amazonDomainFilter = btn.dataset.amazonDomain || 'all';
    document.querySelectorAll('#amazon-domain-selector .sub-tab-pill').forEach(b => b.classList.toggle('active', b === btn));
    amazonAccountLimit = 60;
    renderAmazonInboxesReel();
  });

  // Logs sub-tabs (Campaigns vs Winning)
  $('logs-sub-selector')?.addEventListener('click', event => {
    const btn = event.target.closest('[data-logs-filter]');
    if (!btn) return;
    state.logsFilter = btn.dataset.logsFilter || 'campaigns';
    document.querySelectorAll('#logs-sub-selector .sub-tab-pill').forEach(b => b.classList.toggle('active', b === btn));
    const isWinning = state.logsFilter === 'winning';
    $('view-kicker').textContent = 'السجل';
    $('view-title').textContent = isWinning ? 'المسابقات والرسائل الفائزة' : 'تسجيلات نيفيا والحملات';
    $('content-search').placeholder = isWinning ? 'بحث في رسائل المسابقات والفوز' : 'بحث بالاسم أو الجوال';
    renderContent();
  });
  $('content-tabs').addEventListener('click', event => {
    const button = event.target.closest('[data-view]');
    if (!button) return;
    switchContentView(button.dataset.view);
  });
  $('inbox-list').addEventListener('click', event => {
    // ── Bulk mode: clicking card or checkbox toggles selection ──
    if (bulkMode) {
      const checkEl = event.target.closest('[data-bulk-check]');
      const articleEl = event.target.closest('[data-inbox-id]');
      const targetEl = checkEl || articleEl;
      if (targetEl) {
        event.stopPropagation();
        const rawId = checkEl ? checkEl.dataset.bulkCheck : articleEl.dataset.inboxId;
        if (rawId) toggleBulkSelect(decodeURIComponent(rawId));
      }
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
    const recoverBtn = event.target.closest('[data-mark-recovered]');
    if (recoverBtn) {
      event.stopPropagation();
      submitAiFeedback(recoverBtn.dataset.markRecovered, recoverBtn.dataset.msgId, 'recovered', recoverBtn.dataset.msgSubject, true);
      return;
    }
    const safeBtn = event.target.closest('[data-mark-safe]');
    if (safeBtn) {
      event.stopPropagation();
      submitAiFeedback(safeBtn.dataset.markSafe, safeBtn.dataset.msgId, 'reject', safeBtn.dataset.msgSubject, false);
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
    const recoverBtn = event.target.closest('[data-mark-recovered]');
    if (recoverBtn) {
      event.stopPropagation();
      submitAiFeedback(recoverBtn.dataset.markRecovered, recoverBtn.dataset.msgId, 'recovered', recoverBtn.dataset.msgSubject, true);
      return;
    }
    const safeBtn = event.target.closest('[data-mark-safe]');
    if (safeBtn) {
      event.stopPropagation();
      submitAiFeedback(safeBtn.dataset.markSafe, safeBtn.dataset.msgId, 'reject', safeBtn.dataset.msgSubject, false);
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
  $('stat-banned-card')?.addEventListener('click', () => {
    switchContentView('amazon');
    setAmazonView('accounts', 'banned');
  });
  $('stat-amazon-card')?.addEventListener('click', () => {
    if (state.view === 'amazon') returnToMainInbox();
    else switchContentView('amazon');
  });
  $('amazon-quick-create-btn')?.addEventListener('click', createQuickAmazonInbox);
  $('amazon-add-dotted-btn')?.addEventListener('click', openAmazonDottedModal);
  $('amazon-copy-active-btn')?.addEventListener('click', () => copyText(state.activeInbox?.email, 'تم نسخ عنوان البريد النشط'));
  $('amazon-refresh-btn')?.addEventListener('click', refreshAmazonHub);
  $('amazon-search')?.addEventListener('input', () => {
    amazonAccountLimit = 60;
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
    if (event.target.closest('#amz-clear-inbox-filter-btn')) {
      state.amazonSelectedInbox = null;
      renderAmazonHub();
      return;
    }
    if (event.target.closest('#amz-return-to-accounts-btn')) {
      setAmazonView('accounts', 'all');
      return;
    }
  });
  $('amazon-inboxes-reel')?.addEventListener('click', async event => {
    if (event.target.closest('#reel-quick-add')) {
      createQuickAmazonInbox();
      return;
    }
    if (event.target.closest('[data-amazon-load-more]')) {
      amazonAccountLimit += 60;
      renderAmazonInboxesReel();
      return;
    }
    const copy = event.target.closest('[data-amazon-copy]');
    if (copy) { copyText(decodeURIComponent(copy.dataset.amazonCopy), 'تم نسخ عنوان البريد'); return; }
    const confirm = event.target.closest('[data-confirm-ban]');
    if (confirm) { updateBanStatus(confirm.dataset.confirmBan, 'confirmed', confirm.dataset.reason || ''); return; }
    const recover = event.target.closest('[data-mark-recovered]');
    if (recover) { updateBanStatus(recover.dataset.markRecovered, 'safe', recover.dataset.reason || 'تم استعادة الحساب (النمط نشط)'); return; }
    const safe = event.target.closest('[data-mark-safe]');
    if (safe) { updateBanStatus(safe.dataset.markSafe, 'safe'); return; }
    const ai = event.target.closest('[data-ai-verify]');
    if (ai) { triggerAiVerify(ai); return; }

    const delBtn = event.target.closest('[data-delete-amazon]');
    if (delBtn) {
      event.stopPropagation();
      const email = decodeURIComponent(delBtn.dataset.deleteAmazon || '');
      const id = delBtn.dataset.accountId || '';
      askDeleteAmazonAccount(email, id);
      return;
    }

    const restoreBtn = event.target.closest('[data-restore-amazon]');
    if (restoreBtn) {
      event.stopPropagation();
      const email = decodeURIComponent(restoreBtn.dataset.restoreAmazon || '');
      executeRestoreAmazonAccount(email);
      return;
    }

    const messages = event.target.closest('[data-amazon-messages]');
    const account = event.target.closest('.amazon-account-card[data-account-id]');
    if (messages || account) {
      const email = messages
        ? decodeURIComponent(messages.dataset.amazonMessages)
        : (account.querySelector('.amazon-account-email span')?.textContent?.trim() || '');
      const inbox = findInboxByEmail(email) || (account ? findInboxById(account.dataset.accountId) : null);
      const targetEmail = inbox?.email || email;
      if (targetEmail) {
        state.amazonSelectedInbox = targetEmail;
        if (inbox) {
          state.activeId = inbox.id;
          state.activeInbox = inbox;
          updateActiveInbox();
        }
        setAmazonView('messages', 'all');
        $('amazon-message-list')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      } else {
        toast('تعذر العثور على الحساب المحدد', 'error');
      }
      return;
    }
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
    const recoverBtn = event.target.closest('[data-mark-recovered]');
    if (recoverBtn) {
      event.stopPropagation();
      submitAiFeedback(recoverBtn.dataset.markRecovered, recoverBtn.dataset.msgId, 'recovered', recoverBtn.dataset.msgSubject, true);
      return;
    }
    const safeBtn = event.target.closest('[data-mark-safe]');
    if (safeBtn) {
      event.stopPropagation();
      submitAiFeedback(safeBtn.dataset.markSafe, safeBtn.dataset.msgId, 'reject', safeBtn.dataset.msgSubject, false);
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
  $('reader-attachments')?.addEventListener('click', event => {
    const viewBtn = event.target.closest('[data-view-pdf]');
    if (viewBtn) {
      event.preventDefault();
      handleViewPdf(viewBtn);
      return;
    }
    const button = event.target.closest('[data-reader-attachment]');
    if (button) downloadReaderAttachment(button);
  });

  // In-Browser PDF Viewer Toolbar Actions
  $('close-pdf-viewer')?.addEventListener('click', closePdfViewer);
  $('pdf-viewer-backdrop')?.addEventListener('click', event => {
    if (event.target === $('pdf-viewer-backdrop')) closePdfViewer();
  });
  $('pdf-download-action-btn')?.addEventListener('click', () => {
    if (currentPdfBlob) {
      const objectUrl = URL.createObjectURL(new Blob([currentPdfBlob], { type: 'application/pdf' }));
      const link = document.createElement('a');
      link.href = objectUrl;
      link.download = currentPdfFilename || 'ticket.pdf';
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(objectUrl), 60000);
      toast('تم تنزيل ملف التذكرة بنجاح 🎟️');
    } else if (currentPdfAttachmentId && currentPdfMessageId) {
      downloadReaderAttachment({ dataset: { readerAttachment: currentPdfAttachmentId }, disabled: false, setAttribute: () => {}, removeAttribute: () => {} });
    }
  });
  $('pdf-fallback-download-btn')?.addEventListener('click', () => {
    if (currentPdfAttachmentId && currentPdfMessageId) {
      downloadReaderAttachment({ dataset: { readerAttachment: currentPdfAttachmentId }, disabled: false, setAttribute: () => {}, removeAttribute: () => {} });
    }
  });
  $('pdf-retry-btn')?.addEventListener('click', () => {
    if (currentPdfAttachmentId && currentPdfMessageId) {
      openPdfViewer({ id: currentPdfAttachmentId, filename: currentPdfFilename }, currentPdfMessageId);
    }
  });
  $('pdf-zoom-in')?.addEventListener('click', async () => {
    if (currentPdfScale < 2.5) {
      currentPdfScale += 0.25;
      if ($('pdf-zoom-level')) $('pdf-zoom-level').textContent = Math.round(currentPdfScale * 100) + '%';
      await renderAllPdfPages();
    }
  });
  $('pdf-zoom-out')?.addEventListener('click', async () => {
    if (currentPdfScale > 0.5) {
      currentPdfScale -= 0.25;
      if ($('pdf-zoom-level')) $('pdf-zoom-level').textContent = Math.round(currentPdfScale * 100) + '%';
      await renderAllPdfPages();
    }
  });
  $('pdf-fit-width')?.addEventListener('click', async () => {
    currentPdfScale = 1.0;
    if ($('pdf-zoom-level')) $('pdf-zoom-level').textContent = '100%';
    await renderAllPdfPages();
  });
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
    if (inboxId) submitAiFeedback(inboxId, msgId, 'confirm', subject, true);
  });
  $('reader-recover-btn')?.addEventListener('click', () => {
    const banner = $('reader-learning-banner');
    const inboxId = banner?.getAttribute('data-inbox-id');
    const msgId = banner?.getAttribute('data-msg-id');
    const subject = banner?.getAttribute('data-msg-subject');
    if (inboxId) submitAiFeedback(inboxId, msgId, 'recovered', subject, true);
  });
  $('reader-reject-rule-btn')?.addEventListener('click', () => {
    const banner = $('reader-learning-banner');
    const inboxId = banner?.getAttribute('data-inbox-id');
    const msgId = banner?.getAttribute('data-msg-id');
    const subject = banner?.getAttribute('data-msg-subject');
    if (inboxId) submitAiFeedback(inboxId, msgId, 'reject', subject, false);
  });

  window.addEventListener('popstate', event => {
    if (event.state?.screen === 'reader') {
      openMessage(event.state.messageId, false);
    } else if (state.currentMessage) {
      closeReader(false);
    } else if (event.state?.readerReturnContext && state.view === event.state.readerReturnContext.view) {
      // The Back button has already restored this list and its search.
      return;
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

  // Amazon Dotted Modal Events
  $('close-amazon-dotted-modal')?.addEventListener('click', () => {
    $('amazon-dotted-backdrop')?.classList.add('hidden');
  });

  $('dotted-suggestions-grid')?.addEventListener('click', (e) => {
    const chip = e.target.closest('.dotted-chip');
    if (!chip) return;
    const variant = chip.dataset.variant;
    if (!variant) return;
    document.querySelectorAll('.dotted-chip').forEach(c => c.classList.toggle('active', c === chip));
    const emailInput = $('dotted-email-input');
    const labelInput = $('dotted-label-input');
    if (emailInput) emailInput.value = variant;
    if (labelInput) labelInput.value = `حساب أمازون (${variant.split('@')[0]})`;
  });

  $('amazon-dotted-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const parentEmail = $('dotted-parent-select')?.value.trim().toLowerCase();
    const dottedEmail = $('dotted-email-input')?.value.trim().toLowerCase();
    const label = $('dotted-label-input')?.value.trim() || `حساب أمازون (${dottedEmail.split('@')[0]})`;

    if (!dottedEmail || !dottedEmail.endsWith('@gmail.com')) {
      toast('يرجى إدخال عنوان Gmail صالح (@gmail.com)', 'error');
      return;
    }

    const baseParent = parentEmail.split('@')[0].replace(/\./g, '');
    const baseDotted = dottedEmail.split('@')[0].replace(/\./g, '');
    if (baseParent !== baseDotted) {
      toast(`البريد النقطي يجب أن يتبع نفس أحرف الحساب المضيف (${baseParent}) لتصلك الرسائل عليه!`, 'error');
      return;
    }

    const submitBtn = $('submit-amazon-dotted-btn');
    setBusy(submitBtn, true, 'جاري اعتماد الحساب في أمازون...');

    try {
      const docId = `gmail_amz_${dottedEmail.replace(/[^a-z0-9]/g, '_')}`;
      // Register in backend API
      await api('/api/official/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: dottedEmail,
          label: label,
          isOfficial: true,
          isAmazon: true,
          isDottedGmailAlias: true,
          parentEmail: parentEmail
        })
      });

      $('amazon-dotted-backdrop')?.classList.add('hidden');
      toast(`✅ تم تفعيل حساب أمازون النقطي المستقل: ${dottedEmail}`);
      await loadInboxes();
      await loadCounts();
      renderAmazonHub();
    } catch (err) {
      toast(`تعذر حفظ الحساب: ${err.message}`, 'error');
    } finally {
      setBusy(submitBtn, false, 'اعتماد الحساب في مركز أمازون');
    }
  });

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


  // OAuth uses the backend authorization-code flow so Firebase keeps the
  // renewable credential; no Gmail token is retained in this browser.
  $('gmail-app-form')?.classList.add('hidden');
  $('gmail-oauth-panel')?.classList.remove('hidden');
  $('gmail-method-tabs')?.classList.add('hidden');

  $('start-google-oauth-btn')?.addEventListener('click', async () => {
    const oauthBtn = $('start-google-oauth-btn');
    setBusy(oauthBtn, true, 'جاري الاتصال بـ Google...');
    try {
      const returnTo = window.location.origin;
      const result = await api(`/api/gmail/oauth/auth-url?return_to=${encodeURIComponent(returnTo)}`);
      if (!result.authUrl) throw new Error('لم ينشئ الخادم رابط المصادقة من Google.');
      window.location.assign(result.authUrl);
    } catch (e) {
      setBusy(oauthBtn, false, 'تسجيل الدخول وربط حساب Google');
      if (String(e.message || '').includes('Client Secret') || String(e.message || '').includes('رمز التجديد')) {
        $('oauth-custom-settings')?.classList.remove('hidden');
      }
      toast('تعذر فتح تسجيل الدخول: ' + e.message, 'error');
    }
  });

  $('toggle-oauth-settings-btn')?.addEventListener('click', async () => {
    const panel = $('oauth-custom-settings');
    panel?.classList.toggle('hidden');
    if (panel?.classList.contains('hidden')) return;
    try {
      const config = await api('/api/gmail/oauth/config');
      if ($('oauth-client-id-input') && !$('oauth-client-id-input').value) {
        $('oauth-client-id-input').value = config.clientId || '';
      }
      if ($('oauth-redirect-uri-input') && !$('oauth-redirect-uri-input').value) {
        $('oauth-redirect-uri-input').value = config.redirectUri || '';
      }
    } catch (_) {}
  });

  $('save-oauth-settings-btn')?.addEventListener('click', async () => {
    const clientId = $('oauth-client-id-input')?.value.trim();
    const clientSecret = $('oauth-client-secret-input')?.value.trim();
    const redirectUri = $('oauth-redirect-uri-input')?.value.trim();
    if (!clientId) {
      toast('يرجى إدخال Client ID', 'error');
      return;
    }
    try {
      await api('/api/gmail/oauth/config', {
        method: 'POST',
        body: JSON.stringify({ clientId, clientSecret, redirectUri })
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

  // Amazon delete confirmation modal wiring
  $('cancel-amazon-delete-btn')?.addEventListener('click', () => {
    $('confirm-amazon-delete-backdrop')?.classList.add('hidden');
    state.pendingDeleteAmazon = null;
  });
  $('accept-amazon-delete-btn')?.addEventListener('click', executeDeleteAmazonAccount);
  $('confirm-amazon-delete-backdrop')?.addEventListener('click', event => {
    if (event.target === $('confirm-amazon-delete-backdrop')) {
      $('confirm-amazon-delete-backdrop').classList.add('hidden');
      state.pendingDeleteAmazon = null;
    }
  });

  // ── Bulk select / delete wiring ──
  $('bulk-mode-toggle-btn')?.addEventListener('click', toggleBulkMode);
  $('bulk-cancel-btn')?.addEventListener('click', exitBulkMode);
  $('bulk-select-all-btn')?.addEventListener('click', selectAllVisibleInboxes);
  $('bulk-delete-btn')?.addEventListener('click', showBulkDeleteConfirm);
  $('bulk-confirm-cancel')?.addEventListener('click', () => $('bulk-confirm-modal')?.classList.add('hidden'));
  $('bulk-confirm-ok')?.addEventListener('click', deleteSelectedInboxes);
  // Close bulk confirm modal on backdrop click
  $('bulk-confirm-modal')?.addEventListener('click', event => {
    if (event.target === $('bulk-confirm-modal')) $('bulk-confirm-modal').classList.add('hidden');
  });
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
    const row = event.target.closest('article[data-inbox-id], article[data-message-id], article[data-account-id]');
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

function mergeMessages(...lists) {
  const merged = new Map();
  lists.flat().filter(Boolean).forEach(message => {
    const key = message.id || `${message.inboxEmail || message.to}|${message.subject}|${message.createdAt}`;
    const previous = merged.get(key) || {};
    merged.set(key, { ...previous, ...message });
  });
  return [...merged.values()].sort((a, b) => {
    const aTime = Date.parse(a.createdAt || a.date || 0) || 0;
    const bTime = Date.parse(b.createdAt || b.date || 0) || 0;
    return bTime - aTime;
  });
}

function isOfficialMessage(message) {
  const recipient = String(message.inboxEmail || message.to || '').toLowerCase();
  return Boolean(message.isOfficialDomain || message.isOfficial || recipient.includes('@gmail.com') || recipient.includes('@batabitoo.com'));
}

async function api(path, options = {}) {
  const { responseType, timeoutMs = 25000, ...fetchOptions } = options;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const token = localStorage.getItem(SESSION_TOKEN_KEY) || sessionStorage.getItem(SESSION_TOKEN_KEY);
  const headers = {
    'Content-Type': 'application/json',
    ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
    ...(options.headers || {})
  };
  try {
    const response = await fetch(API_BASE + path, {
      ...fetchOptions,
      headers,
      ...(API_BASE ? {} : { credentials: 'include' }),
      signal: controller.signal
    });
    if (response.status === 401) {
      console.warn('🔒 [API 401] Session required or expired');
      sessionStorage.removeItem(SESSION_TOKEN_KEY);
      localStorage.removeItem(SESSION_TOKEN_KEY);
      document.cookie = "batabitoo_session=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT; SameSite=Lax";
      document.cookie = "batabitoo_pin=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT; SameSite=Lax";
      document.documentElement.classList.remove('pin-pre-unlocked');
      const overlay = $('pin-lock-overlay');
      if (overlay) overlay.classList.remove('unlocked');
      toast('🔒 انتهت الجلسة، يرجى إدخال رمز الأمان', 'error');
      throw new Error('Unauthorized: Session required');
    }
    if (response.ok && responseType === 'blob') return await response.blob();
    const data = await response.json().catch(() => ({}));
    if (response.ok) return data;
    throw Object.assign(new Error(data.error || `HTTP ${response.status}`), { code: data.code, status: response.status });
  } finally {
    clearTimeout(timeout);
  }
}

// Firestore is the single source of truth; the browser keeps only session/UI state.
// ───────────────────────────────────────────────────────────────────────────

async function refreshEverything() {

  if (state.loading) return;
  state.loading = true;
  $('refresh-all').classList.add('spin');
  try {
    await Promise.all([loadStatus(), loadInboxes(), loadCounts(), loadLogs(false).catch(() => [])]);
    if (state.view === 'current') await loadCurrent(true);
    else if (state.view === 'official' || state.view === 'amazon' || state.view === 'banned') await loadSeparated(state.view);
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
  const data = await api('/api/status').catch(() => ({}));
  const total = Math.max(Number(data.counts?.totalInboxes || 0), state.official?.length || 0);
  const officialCount = Math.max(Number(data.counts?.official || 0), state.official?.length || 0);
  if (total > 0 && $('stat-total')) $('stat-total').textContent = formatNumber(total);
  if (officialCount > 0 && $('stat-official')) $('stat-official').textContent = formatNumber(officialCount);
  if ($('stat-amazon')) $('stat-amazon').textContent = formatNumber(Math.max(Number(data.counts?.amazon || 0), state.amazon?.length || 0));
  if ($('stat-banned')) $('stat-banned').textContent = formatNumber(Math.max(Number(data.counts?.banned || 0), state.banned?.length || 0));
  if (data.counts?.messages !== undefined && $('stat-messages')) $('stat-messages').textContent = formatNumber(data.counts?.messages);
  if ($('stat-sync')) $('stat-sync').textContent = data.cloudConnected ? 'متصل بسحابة Firebase' : 'يعمل من التخزين المحلي';
  setConnection(true, Boolean(data.cloudConnected));
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
    console.error('Ban status persistence error:', err);
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

async function submitAiFeedback(inboxId, messageId, verdict, subject = '', keepPattern = false) {
  const isConfirm = verdict === 'confirm' || verdict === 'banned';
  const isRecovered = verdict === 'recovered' || verdict === 'safe' || Boolean(keepPattern);
  const banStatus = isConfirm ? 'confirmed' : 'safe';
  const inbox = findInboxById(inboxId);
  const reason = isConfirm
    ? 'إغلاق وتأكيد الحظر'
    : isRecovered
      ? 'تم استعادة الحساب (النمط نشط)'
      : 'استبعاد النمط وتدريب الكود (إنذار خاطئ)';

  const persisted = await updateBanStatus(inboxId, banStatus, reason);
  if (!persisted) return;

  if (state.currentMessage) closeReader(false);

  try {
    await api('/api/ai/feedback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        inboxId,
        messageId,
        verdict: isConfirm ? 'confirm' : isRecovered ? 'recovered' : 'reject',
        subject,
        keepPattern: isConfirm || isRecovered
      })
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
  return state.official.find(i => (i.email || '').toLowerCase() === clean) ||
         (state.amazon || []).find(i => (i.email || '').toLowerCase() === clean) ||
         state.temp.find(i => (i.email || '').toLowerCase() === clean);
}

async function loadInboxes() {
  // Load through the Firebase-backed API.
  let data = await api('/api/inboxes').catch(() => null) || {};

  if (data?.deletedAmazon && Array.isArray(data.deletedAmazon)) {
    state.deletedAmazonAccounts = new Set(data.deletedAmazon.map(e => String(e).toLowerCase().trim()).filter(Boolean));
  }

  const mergeStatus = inbox => {
    const manual = getManualBanDecision(inbox);
    if (!manual) return inbox;
    return {
      ...inbox,
      banStatus: manual.status,
      isBanned: manual.status === 'confirmed',
      isAmazon: true,
      banReason: manual.reason || inbox.banReason
    };
  };

  // Merge official inboxes from backend & state (STRICTLY PRIMARY / BASE HOST ACCOUNTS ONLY)
  const officialMap = new Map();
  // 1. Start with current state (excluding any dotted accounts)
  for (const item of (state.official || [])) {
    if (item.email && !isDottedGmailAccount(item)) {
      officialMap.set(item.email.toLowerCase().trim(), item);
    }
  }
  // 2. API official inboxes (authoritative, excluding dotted accounts)
  for (const item of (data?.official || [])) {
    if (item.email && !isDottedGmailAccount(item)) {
      const k = item.email.toLowerCase().trim();
      officialMap.set(k, { ...(officialMap.get(k) || {}), ...item });
    }
  }

  // Assign state.official strictly with PRIMARY / BASE official accounts only
  state.official = Array.from(officialMap.values())
    .filter(i => !isDottedGmailAccount(i))
    .map(mergeStatus).map(i => ({
      ...i,
      isBanned: isConfirmedBanned(i),
      isSuspected: isSuspectedInbox(i),
      isAmazon: isAmazonInbox(i)
    }));

  state.temp = [];

  // Auto-discover dotted Gmail accounts from known messages
  scanAndAutoDiscoverDottedAccounts();

  // Assemble state.amazon: includes official Amazon accounts PLUS all dotted Amazon accounts (exclusively in Amazon page)
  const amazonMap = new Map();
  // 1. Stored dotted inboxes from persistent cache
  for (const item of getStoredDottedInboxes()) {
    if (item.email) {
      amazonMap.set(item.email.toLowerCase().trim(), { ...item, isAmazon: true, isDottedGmailAlias: true });
    }
  }
  // 2. Any official accounts that are Amazon accounts (e.g. batabitoo amazon accounts)
  for (const item of state.official.filter(i => i.isAmazon)) {
    if (item.email) amazonMap.set(item.email.toLowerCase().trim(), item);
  }
  // 3. Any API official items that were dotted or amazon
  for (const item of (data?.official || [])) {
    if (item.email && (isDottedGmailAccount(item) || item.isAmazon)) {
      const k = item.email.toLowerCase().trim();
      amazonMap.set(k, { ...(amazonMap.get(k) || {}), ...item, isAmazon: true });
    }
  }
  // 4. Any items already in state.amazon
  for (const item of (state.amazon || [])) {
    if (item.email) {
      const k = item.email.toLowerCase().trim();
      amazonMap.set(k, { ...(amazonMap.get(k) || {}), ...item, isAmazon: true });
    }
  }

  state.amazon = Array.from(amazonMap.values())
    .filter(i => !state.deletedAmazonAccounts.has((i.email || '').toLowerCase().trim()))
    .map(mergeStatus).map(i => ({
      ...i,
      isAmazon: true,
      isBanned: isConfirmedBanned(i),
      isSuspected: isSuspectedInbox(i)
    }));

  state.banned = [...state.official, ...state.amazon].filter(i => isConfirmedBanned(i)).map(i => ({ ...i, isBanned: true, isAmazon: true }));
  state.suspected = [...state.official, ...state.amazon].filter(i => isSuspectedInbox(i)).map(i => ({ ...i, isAmazon: true, isSuspected: true }));
  state.activeId = data?.activeId || state.activeId || state.official[0]?.id || null;
  if (state.activeId) {
    markInboxAsRead(state.activeId);
  }
  if ($('official-count')) $('official-count').textContent = formatNumber(state.official.length);
  if ($('temp-count')) $('temp-count').textContent = '0';
  if ($('amazon-count')) $('amazon-count').textContent = formatNumber(state.amazon.length);
  if ($('banned-count')) $('banned-count').textContent = formatNumber(state.banned.length);
  if ($('amz-tab-deleted-count')) $('amz-tab-deleted-count').textContent = formatNumber(state.deletedAmazonAccounts.size);

  // Sync top stats strip directly
  if ($('stat-total')) $('stat-total').textContent = formatNumber(state.official.length);
  if ($('stat-official')) $('stat-official').textContent = formatNumber(state.official.length);
  if ($('stat-temp')) $('stat-temp').textContent = '0';
  if ($('stat-amazon')) $('stat-amazon').textContent = formatNumber(state.amazon.length);
  if ($('stat-banned')) $('stat-banned').textContent = formatNumber(state.banned.length);

  renderInboxes();
}

async function loadCounts() {
  const serverData = await api('/api/all-messages').catch(() => null) || {};
  const allMessages = mergeMessages(
    serverData.messages || [],
    serverData.official || []
  );

  const official = allMessages.filter(isOfficialMessage);

  state.officialMessages = official.map(m => ({
    ...m,
    isBanned: isBannedMessage(m),
    isAmazon: isAmazonMessage(m)
  }));
  state.tempMessages = [];
  state.amazonMessages = state.officialMessages.filter(m => m.isAmazon).map(m => ({ ...m, isAmazon: true }));
  state.bannedMessages = state.officialMessages.filter(m => m.isBanned).map(m => ({ ...m, isBanned: true, isAmazon: true }));

  // 🤖 Dynamic Auto-discovery across ALL messages in the database
  scanAndAutoDiscoverDottedAccounts(allMessages);

  if ($('official-message-count')) $('official-message-count').textContent = formatNumber(state.officialMessages.length);
  if ($('temp-message-count')) $('temp-message-count').textContent = '0';
  if ($('amazon-message-count')) $('amazon-message-count').textContent = formatNumber(state.amazonMessages.length);
  if ($('banned-message-count')) $('banned-message-count').textContent = formatNumber(state.bannedMessages.length);
  if ($('winning-message-count')) $('winning-message-count').textContent = formatNumber(getWinningMessages().length);
  updateLogsSubCounts();
  if ($('stat-messages')) $('stat-messages').textContent = formatNumber(allMessages.length);
  updateFilterUnreadDots();
}

async function loadCurrent(silent = false) {
  const requestId = ++currentLoadRequest;
  if (!silent) setBusy($('refresh-current'), true);
  try {
    const prevIds = new Set((state.messages || []).map(m => m.id));
    const hadPrevious = (state.messages || []).length > 0;

    let inbox = state.activeInbox || findInboxById(state.activeId);
    let messages = [];
    let gmailSyncStatus = null;

    const isGmail = inbox && (inbox.isRealGmail || (inbox.email && inbox.email.endsWith('@gmail.com')));

    if (isGmail) {
      const syncResult = await syncGmailInbox(inbox, { force: !silent, notify: !silent }).catch(err => ({ status: err?.code === 'GMAIL_AUTH_EXPIRED' ? 'auth-expired' : 'failed', newCount: 0, error: err?.message }));
      gmailSyncStatus = syncResult.status;
      const allRes = await api('/api/all-messages').catch(() => ({ messages: [] }));
      const allList = allRes.messages || [];
      messages = allList.filter(m => messageBelongsToInbox(m, inbox));

      if (syncResult.newCount > 0) await loadCounts().catch(() => {});
    } else {
      try {
        if (state.activeId && (!inbox || inbox.id !== state.activeId)) {
          await api('/api/inboxes/select', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: state.activeId })
          }).catch(() => {});
        }
        let currentUrl = '/api/inbox/current';
        if (inbox?.email && inbox?.id) {
          currentUrl = `/api/inbox/current?email=${encodeURIComponent(inbox.email)}&id=${encodeURIComponent(inbox.id)}`;
        } else if (inbox?.email) {
          currentUrl = `/api/inbox/current?email=${encodeURIComponent(inbox.email)}`;
        } else if (inbox?.id) {
          currentUrl = `/api/inbox/current?id=${encodeURIComponent(inbox.id)}`;
        }
        const data = await api(currentUrl);
        if (data && data.inbox) {
          inbox = data.inbox;
          messages = data.messages || [];
        }
      } catch (err) {
        if (inbox) {
          const allRes = await api('/api/all-messages').catch(() => ({ messages: [] }));
          messages = (allRes.messages || []).filter(m => messageBelongsToInbox(m, inbox));
        }
      }
    }

    // A slower refresh for the previously selected inbox must never overwrite
    // a newer click/selection.
    if (requestId !== currentLoadRequest) return;
    state.activeInbox = inbox || state.activeInbox;
    state.activeId = state.activeInbox?.id || state.activeId;
    state.messages = (messages || []).map(m => ({
      ...m,
      isBanned: isBannedMessage(m),
      isAmazon: isAmazonMessage(m)
    }));

    // 🤖 Auto-discover any dotted Amazon accounts from loaded messages
    scanAndAutoDiscoverDottedAccounts(state.messages);

    // Detect new arriving message automatically
    if (silent && hadPrevious) {
      const brandNew = state.messages.filter(m => !prevIds.has(m.id));
      if (brandNew.length > 0) {
        const top = brandNew[0];
        const badge = top.isWinning ? '🏆 إشعار فوز مسابقة!' : '📩 رسالة جديدة وصلت!';
        toast(`${badge}: "${top.subject || '(بدون عنوان)'}"`);
      }
    }

    if (state.activeId) {
      markInboxAsRead(state.activeId, state.messages.length);
    }
    $('current-message-count').textContent = formatNumber(state.messages.length);
    updateActiveInbox();
    renderInboxes();
    if (state.view === 'current') renderContent();
    setConnection(true);
    if (!silent) {
      const parentEmail = inbox ? gmailParentEmail(inbox) : '';
      if (gmailSyncStatus === 'auth-expired') {
        if (!gmailAuthWarnings.has(parentEmail)) {
          gmailAuthWarnings.add(parentEmail);
          toast('⚠️ انتهت صلاحية جلسة Google. اضغط [+ صندوق جديد → Gmail] لتجديد الاتصال.', 'error');
        }
      } else if (gmailSyncStatus === 'not-connected') {
        if (!gmailAuthWarnings.has(parentEmail)) {
          gmailAuthWarnings.add(parentEmail);
          toast('⚠️ حساب Gmail يحتاج إعادة ربط. اضغط [+ صندوق جديد → Gmail] لربطه.', 'info');
        }
      } else if (gmailSyncStatus !== 'failed') {
        toast('تم تحديث صندوق البريد');
      }
    }
  } catch (error) {
    if (requestId !== currentLoadRequest) return;
    setConnection(false);
    if (!silent) toast(friendlyError(error), true);
  } finally {
    if (!silent && requestId === currentLoadRequest) setBusy($('refresh-current'), false);
  }
}

async function syncActiveRemoteInbox() {
  const btn = $('sync-remote-btn');
  const inbox = state.activeInbox || findInboxById(state.activeId);
  const email = inbox?.email;
  if (!email) {
    toast('يرجى اختيار صندوق بريد أولاً', 'info');
    return;
  }

  // Handle Real Gmail Inboxes
  if (inbox?.isRealGmail || email.endsWith('@gmail.com')) {
    setBusy(btn, true, 'جاري مزامنة Gmail... ⚡');
    try {
      const directResult = await syncGmailInbox(inbox, { force: true, notify: true });
      let newCount = directResult.newCount || 0;
      if (directResult.status === 'not-connected' || directResult.error?.includes?.('صلاحية') || directResult.error?.includes?.('إعادة ربط')) {
        toast(`⚠️ حساب Gmail (${gmailParentEmail(inbox)}) يحتاج إعادة ربط. اضغط [+ صندوق جديد → Gmail] لربطه.`, 'info');
      } else if (newCount > 0) {
        toast(`🎉 تم سحب ${newCount} رسالة جديدة من Gmail بنجاح!`);
      } else {
        toast('صندوق Gmail محدث، لا توجد رسائل جديدة');
      }
      await loadCurrent(true);
      await loadCounts();
    } catch (err) {
      if (err?.code === 'GMAIL_AUTH_EXPIRED') {
        toast('⚠️ انتهت صلاحية جلسة Google. اضغط [+ صندوق جديد → Gmail] لتجديد الاتصال.', 'error');
      } else if (err?.code === 'GMAIL_PERMISSION_DENIED' || (err.message && err.message.includes('403'))) {
        toast('⚠️ صلاحية قراءة الرسائل غير ممنوحة! اضغط [صندوق جديد +] ثم اربط Google مع تحديد علامة (✓).', 'error');
      } else {
        toast('تعذر مزامنة Gmail: ' + err.message, 'error');
      }
    } finally {
      setBusy(btn, false, 'مزامنة سريعة ⚡');
    }
    return;
  }


  setBusy(btn, true, 'جاري السحب... ⚡');
  try {
    const res = await api('/api/inbox/sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: inbox.id, email })
    });

    if (res.sync?.newCount > 0) {
      toast(`🎉 تم سحب ${res.sync.newCount} رسالة جديدة بنجاح!`);
      if (res.sync.hasWinning) {
        toast('🏆 تم اكتشاف رسالة مسابقة وفوز جديدة!', 'success');
      }
    } else if (res.sync?.rateLimited) {
      toast('⏳ خادم البريد الخارجي في فترة تبريد مؤقتة، جاري عرض الرسائل المحفوظة', 'info');
    } else {
      toast('الصندوق محدث، لا توجد رسائل جديدة في الخادم الخارجي');
    }

    await loadCurrent(true);
    await loadCounts();
  } catch (e) {
    toast('تعذر إتمام المزامنة: ' + friendlyError(e), true);
  } finally {
    setBusy(btn, false, 'مزامنة سريعة ⚡');
  }
}

async function loadSeparated(type) {
  showContentSkeleton();
  try {
    await loadCounts();
    if (type === 'winning') state.winningMessages = getWinningMessages();
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
  const isOfficialView = state.inboxType === 'official';
  const subBar = $('official-sub-selector');
  if (subBar) {
    subBar.classList.toggle('hidden', !isOfficialView);
    if (isOfficialView) {
      const allCount = state.official.length;
      const batabitooCount = state.official.filter(i => (i.email || '').toLowerCase().endsWith('@batabitoo.com')).length;
      const gmailCount = state.official.filter(i => i.isRealGmail || (i.email || '').toLowerCase().endsWith('@gmail.com')).length;
      if ($('sub-count-off-all')) $('sub-count-off-all').textContent = formatNumber(allCount);
      if ($('sub-count-off-batabitoo')) $('sub-count-off-batabitoo').textContent = formatNumber(batabitooCount);
      if ($('sub-count-off-gmail')) $('sub-count-off-gmail').textContent = formatNumber(gmailCount);
    }
  }

  let source = state.inboxType === 'official' ? state.official : state.inboxType === 'amazon' ? state.amazon : state.inboxType === 'banned' ? state.banned : state.official;
  if (isOfficialView) {
    if (state.officialDomainFilter === 'batabitoo') {
      source = source.filter(i => (i.email || '').toLowerCase().endsWith('@batabitoo.com'));
    } else if (state.officialDomainFilter === 'gmail') {
      source = source.filter(i => i.isRealGmail || (i.email || '').toLowerCase().endsWith('@gmail.com'));
    }
  }

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
    const isBulkSelected = bulkSelectedIds.has(inbox.id);
    return `<article tabindex="0" role="button" class="inbox-item ${official ? 'official' : ''} ${inbox.id === state.activeId ? 'active' : ''} ${unread ? 'has-unread' : ''} ${suspected ? 'is-suspected' : ''} ${isBulkSelected ? 'bulk-selected' : ''}" data-inbox-id="${attr(id)}">
      <div class="inbox-item-check" data-bulk-check="${attr(id)}"><svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="#ffffff" stroke-width="3"><path d="M5 12l5 5L19 7"/></svg></div>
      <div class="inbox-item-avatar">
        ${banned ? '⛔' : suspected ? '⚠️' : amazon ? 'a' : official ? '♛' : initials(label)}
        ${unread ? '<span class="unread-dot" title="رسائل جديدة غير مقروءة"></span>' : ''}
      </div>
      <div class="inbox-item-copy">
        <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;">
          <strong>${html(label)}</strong>
          ${unread ? '<span class="unread-pill" title="رسائل جديدة غير مقروءة">جديد</span>' : ''}
          ${inbox.isDottedGmailAlias ? '<span class="real-gmail-badge" style="background:rgba(234,88,12,0.15);color:#ea580c;border-color:rgba(234,88,12,0.3);" title="حساب أمازون نقطي مستكشف تلقائياً">نقطي أمازون</span>' : (inbox.isRealGmail || inbox.domain === 'gmail.com') ? '<span class="real-gmail-badge" title="حساب Gmail حقيقي بمزامنة حية 24/7">📧 Gmail</span>' : ''}
          ${banned ? `<span class="banned-badge" title="${attr(reason)}">⛔ ${html(reason)}</span>` : suspected ? `<span class="suspected-badge" title="${attr(reason)}">⚠️ اشتباه حظر</span>` : ''}
        </div>
        <span>${html(inbox.email || '')}</span>
        ${suspected ? `
        <div class="ban-confirm-inline">
          <span class="ban-confirm-q">اشتباه حظر بانتظار قرارك:</span>
          <div class="ban-confirm-btns">
            ${suspectMsg ? `<button class="btn-view-suspect" type="button" data-open-message="${attr(encodeURIComponent(suspectMsg.id))}" title="معاينة الرسالة التي تسببت في الاشتباه">🔍 معاينة</button>` : ''}
            <button class="btn-confirm-ban" type="button" data-confirm-ban="${attr(inbox.id)}" data-msg-id="${attr(suspectMsg?.id || '')}" data-msg-subject="${attr(suspectMsg?.subject || '')}" title="تأكيد الحظر">تأكيد الحظر ⛔</button>
            <button class="btn-mark-recovered" type="button" data-mark-recovered="${attr(inbox.id)}" data-msg-id="${attr(suspectMsg?.id || '')}" data-msg-subject="${attr(suspectMsg?.subject || '')}" title="الحساب سليم أو تمت استعادته مع الإبقاء على كشف النمط مستقبلاً">الحساب سليم (تمت استعادته) ✅</button>
            <button class="btn-mark-safe" type="button" data-mark-safe="${attr(inbox.id)}" data-msg-id="${attr(suspectMsg?.id || '')}" data-msg-subject="${attr(suspectMsg?.subject || '')}" title="استبعاد هذا النمط وتدريب الكود">استبعاد النمط ❌</button>
          </div>
        </div>` : ''}
      </div>
      <span class="inbox-count ${unread ? 'unread' : ''}">${formatNumber(inbox.messageCount || 0)}</span>
      <button class="inbox-more" data-delete-id="${attr(id)}" title="حذف الصندوق" aria-label="حذف الصندوق"><svg viewBox="0 0 24 24"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v5M14 11v5"/></svg></button>
    </article>`;
  }).join('') + (list.length > inboxLimit ? `<button class="load-more" data-load-more>عرض المزيد · ${formatNumber(list.length - inboxLimit)} صندوق متبقٍ</button>` : '');
  if ($('inbox-list').innerHTML !== markup) $('inbox-list').innerHTML = markup;
  $('inbox-list').classList.toggle('bulk-mode', bulkMode);
  updateBulkActionBar();
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
  $('active-badge').textContent = banned ? `⛔ محظور (${inbox.banReason || 'مقيد'})` : suspected ? '⚠️ اشتباه حظر' : amazon ? 'حساب أمازون' : official ? '♛ بريد رسمي' : 'ϟ بريد سريع';
  $('active-badge').style.color = banned ? '#dc2626' : suspected ? '#d97706' : amazon ? '#ea580c' : official ? 'var(--gold)' : 'var(--green)';
  $('active-avatar').textContent = banned ? '⛔' : suspected ? '⚠️' : amazon ? 'a' : official ? '♛' : initials(inbox.personName || inbox.label || inbox.email);
  $('active-avatar').classList.toggle('official', official);
  $('copy-email').disabled = !inbox.email;
}

async function selectInbox(id) {
  const picked = findInboxById(id);
  if (!picked) {
    toast('تعذر العثور على صندوق البريد المحدد. حدّث القائمة وأعد المحاولة.', 'error');
    return false;
  }
  // Invalidate any in-flight refresh before applying the new selection.
  currentLoadRequest++;
  state.activeId = picked.id;
  state.activeInbox = picked;

  // Immediately render cached messages for this inbox upon selection
  const cachedMessages = (state.officialMessages || [])
    .concat(state.tempMessages || [])
    .concat(state.amazonMessages || [])
    .concat(state.messages || [])
    .filter(m => messageBelongsToInbox(m, picked));

  const uniqueCached = [];
  const seenIds = new Set();
  for (const m of cachedMessages) {
    if (m && m.id && !seenIds.has(m.id)) {
      seenIds.add(m.id);
      uniqueCached.push(m);
    }
  }

  if (uniqueCached.length > 0) {
    state.messages = uniqueCached.map(m => ({
      ...m,
      isBanned: isBannedMessage(m),
      isAmazon: isAmazonMessage(m)
    }));
  } else {
    state.messages = [];
  }

  markInboxAsRead(id);
  renderInboxes();
  updateActiveInbox();
  // Optimistic: show content view immediately
  switchContentView('current');
  if (innerWidth <= 720) {
    document.querySelector('.workspace').classList.add('show-content');
    document.querySelectorAll('[data-mobile-view]').forEach(item => item.classList.toggle('active', item.dataset.mobileView === 'messages'));
  }
  if (state.messages.length > 0) {
    renderContent();
  } else {
    showContentSkeleton();
  }
  placeHero();
  try {
    // Persisting the global server selection is best-effort; Gmail navigation
    // is local-first and must keep working when the edge endpoint is absent.
    api('/api/inboxes/select', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: picked.id })
    }).catch(() => {});
    await loadCurrent(true);
    markInboxAsRead(picked.id, state.messages.length);
    renderInboxes();
    return true;
  } catch (error) {
    console.warn('Select inbox notice:', error);
    showEmpty('تعذر فتح الصندوق', friendlyError(error));
    toast(`تعذر فتح الصندوق: ${friendlyError(error)}`, 'error');
    return false;
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
    document.querySelector('.workspace')?.classList.add('show-content');
    renderAmazonHub();
    loadSeparated('amazon').then(() => renderAmazonHub());
    return;
  }

  $('amazon-hub-shell')?.classList.add('hidden');
  $('feed-shell')?.classList.remove('hidden');
  const isLogs = view === 'logs';
  $('logs-sub-selector')?.classList.toggle('hidden', !isLogs);

  const map = {
    current: ['البريد الوارد', 'أحدث الرسائل', 'بحث في الرسائل'],
    official: ['البريد الرسمي', 'رسائل النطاق الرسمي', 'بحث في الرسائل الرسمية'],
    logs: state.logsFilter === 'winning'
      ? ['السجل', 'المسابقات والرسائل الفائزة', 'بحث في رسائل المسابقات والفوز']
      : ['السجل', 'تسجيلات نيفيا والحملات', 'بحث بالاسم أو الجوال']
  };
  [$('view-kicker').textContent, $('view-title').textContent, $('content-search').placeholder] = map[view] || map.current;
  if (view === 'official') loadSeparated(view);
  else if (view === 'logs') {
    updateLogsSubCounts();
    if (state.logsFilter === 'winning') {
      renderContent();
    } else {
      loadLogs(true).catch(error => showEmpty('تعذر تحميل السجل', friendlyError(error)));
    }
  }
  else renderContent();
}

function updateLogsSubCounts() {
  const campaignsCount = (state.logs || []).length;
  const winningCount = getWinningMessages().length;
  if ($('sub-count-logs-campaigns')) $('sub-count-logs-campaigns').textContent = formatNumber(campaignsCount);
  if ($('sub-count-logs-winning')) $('sub-count-logs-winning').textContent = formatNumber(winningCount);
  if ($('logs-count')) $('logs-count').textContent = formatNumber(campaignsCount + winningCount);
}

function isWinningMessage(msg) {
  if (!msg) return false;
  if (msg.isWinning) return true;
  const combined = `${msg.subject || ''} ${msg.intro || ''} ${msg.text || ''} ${formatAddress(msg.from) || ''}`.toLowerCase();
  const kw = ['مبروك', 'تهانينا', 'فائز', 'فزت', 'ربحت', 'جائزة', 'مسابقة', 'سحب', 'هدية', 'winner', 'won', 'congratulations', 'congrats', 'prize', 'nivea'];
  return kw.some(k => combined.includes(k));
}

function getWinningMessages() {
  const all = [...(state.messages || []), ...(state.tempMessages || []), ...(state.officialMessages || [])];
  const map = new Map();
  for (const m of all) {
    if (m && m.id && !map.has(m.id)) {
      if (isWinningMessage(m)) map.set(m.id, m);
    }
  }
  return Array.from(map.values()).sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
}

function renderContent() {
  if (state.view === 'amazon') {
    renderAmazonHub();
    return;
  }
  const query = normalize($('content-search').value);
  if (state.view === 'logs') {
    updateLogsSubCounts();
    if (state.logsFilter === 'winning') {
      const winningMsgs = getWinningMessages();
      const list = query ? winningMsgs.filter(message => normalize([formatAddress(message.from), formatAddress(message.to), message.subject, message.text, message.intro, message.otp, message.inboxEmail].join(' ')).includes(query)) : winningMsgs;
      renderMessages(list);
      return;
    }
    const logs = query ? state.logs.filter(item => normalize([item.personName, item.realEmail, item.mobile, item.receiptNumber, item.city].join(' ')).includes(query)) : state.logs;
    renderLogs(logs);
    return;
  }
  const source = state.view === 'current' ? state.messages 
               : state.officialMessages;
  const list = query ? source.filter(message => normalize([formatAddress(message.from), formatAddress(message.to), message.subject, message.text, message.intro, message.otp, message.inboxEmail].join(' ')).includes(query)) : source;
  renderMessages(list);
}

function renderMessages(messages) {
  if (!messages.length) return showEmpty('لا توجد رسائل بعد', 'ستظهر الرسائل الجديدة تلقائيًا عند وصولها.');
  hideEmpty();
  $('message-list').innerHTML = messages.map(message => {
    const sender = cleanSenderName(message.from, message.subject);
    const otp = message.otp ? String(message.otp) : '';
    const winning = isWinningMessage(message);
    const banned = isBannedMessage(message);
    const amazon = !banned && isAmazonMessage(message);
    const reason = getBanReason(message);
    return `<article class="message-card" data-message-id="${attr(encodeURIComponent(message.id || ''))}">
      <div class="sender-avatar">${winning ? '🏆' : banned ? '⛔' : amazon ? 'a' : initials(sender)}</div>
      <div class="message-main">
        <div class="message-top">
          <strong style="display:inline-flex;align-items:center;gap:6px;flex-wrap:wrap;">
            ${html(sender)}
            ${winning ? '<span class="win-badge">🏆 فوز ومسابقة</span>' : ''}
            ${banned ? `<span class="banned-badge">⛔ ${html(reason)}</span>` : amazon ? '<span class="amazon-badge">أمازون</span>' : ''}
          </strong>
          <time>${html(formatDate(message.createdAt))}</time>
        </div>
        <div class="message-subject">${html(message.subject || '(بدون عنوان)')}</div>
        <div class="message-preview">${html(cleanPreviewText(message.intro || message.text || formatAddress(message.to) || ''))}</div>
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
    amazonAccountLimit = 60;
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
  if (state.amazonAccountFilter === 'deleted') {
    let list = Array.from(state.deletedAmazonAccounts || []).map(email => {
      const isDotted = email.endsWith('@gmail.com') && email.split('@')[0].includes('.');
      const label = email.split('@')[0];
      return {
        id: `del_${email.replace(/[^a-z0-9]/g, '_')}`,
        email: email,
        isDeleted: true,
        label: label,
        personName: label,
        isDottedGmailAlias: isDotted,
        createdAt: null,
        messageCount: 0
      };
    });
    const query = normalize($('amazon-search')?.value);
    if (query) list = list.filter(inbox => normalize([inbox.email, inbox.label].join(' ')).includes(query));
    return list;
  }

  let list = (state.amazon || []).filter(inbox => !state.deletedAmazonAccounts?.has((inbox.email || '').toLowerCase().trim()));
  if (state.amazonAccountFilter === 'healthy') list = list.filter(inbox => !isConfirmedBanned(inbox) && !isSuspectedInbox(inbox));
  else if (state.amazonAccountFilter === 'suspected') list = list.filter(inbox => !isConfirmedBanned(inbox) && isSuspectedInbox(inbox));
  else if (state.amazonAccountFilter === 'banned') list = list.filter(isConfirmedBanned);

  // Apply domain filter (all / batabitoo / gmail)
  if (state.amazonDomainFilter === 'batabitoo') {
    list = list.filter(inbox => (inbox.email || '').toLowerCase().endsWith('@batabitoo.com'));
  } else if (state.amazonDomainFilter === 'gmail') {
    list = list.filter(inbox => inbox.isRealGmail || inbox.isDottedGmailAlias || (inbox.email || '').toLowerCase().endsWith('@gmail.com'));
  }

  const query = normalize($('amazon-search')?.value);
  if (query) list = list.filter(inbox => normalize([inbox.email, inbox.personName, inbox.label, inbox.banReason].join(' ')).includes(query));
  return list;
}

function getFilteredAmazonMessages() {
  let list;
  if (state.amazonSelectedInbox) {
    const sel = state.amazonSelectedInbox.toLowerCase().trim();
    const inbox = findInboxByEmail(sel) || (state.amazon || []).find(i => (i.email || '').toLowerCase().trim() === sel);
    const pool = (state.amazonMessages || [])
      .concat(state.officialMessages || [])
      .concat(state.tempMessages || [])
      .concat(state.messages || []);
    const seen = new Set();
    list = [];
    for (const m of pool) {
      if (m && m.id && !seen.has(m.id)) {
        seen.add(m.id);
        if (messageBelongsToInbox(m, inbox || { email: sel })) {
          list.push(m);
        }
      }
    }
  } else {
    list = state.amazonMessages || [];
  }
  if (state.amazonSubFilter === 'otp') {
    list = list.filter(m => Boolean(m.otp));
  } else if (state.amazonSubFilter === 'suspected') {
    list = list.filter(m => {
      const recipient = (m.exactRecipient || m.inboxEmail || extractCleanEmail(m.to) || '').toLowerCase().trim();
      const inbox = findInboxByEmail(recipient);
      if (inbox && isConfirmedBanned(inbox)) return false;
      return isBannedMessage(m) || isSuspectedInbox(inbox);
    });
  } else if (state.amazonSubFilter === 'banned') {
    list = list.filter(m => {
      const recipient = (m.exactRecipient || m.inboxEmail || extractCleanEmail(m.to) || '').toLowerCase().trim();
      const inbox = findInboxByEmail(recipient);
      return isConfirmedBanned(inbox);
    });
  } else if (state.amazonSubFilter === 'orders') {
    list = list.filter(m => isAmazonOrderMessage(m));
  }
  const query = normalize($('amazon-search')?.value);
  if (query) {
    list = list.filter(m => normalize([formatAddress(m.from), formatAddress(m.to), m.subject, m.text, m.intro, m.otp, m.inboxEmail, m.exactRecipient].join(' ')).includes(query));
  }
  return list;
}

function renderAmazonInboxesReel() {
  const reel = $('amazon-inboxes-reel');
  if (!reel) return;

  const domainSelector = $('amazon-domain-selector');
  if (domainSelector) {
    const isAccountsView = state.amazonView === 'accounts' && state.amazonAccountFilter !== 'deleted';
    domainSelector.classList.toggle('hidden', !isAccountsView);
    if (isAccountsView) {
      const allCount = (state.amazon || []).length;
      const batabitooCount = (state.amazon || []).filter(i => (i.email || '').toLowerCase().endsWith('@batabitoo.com')).length;
      const gmailCount = (state.amazon || []).filter(i => i.isRealGmail || i.isDottedGmailAlias || (i.email || '').toLowerCase().endsWith('@gmail.com')).length;
      if ($('sub-count-amz-all')) $('sub-count-amz-all').textContent = formatNumber(allCount);
      if ($('sub-count-amz-batabitoo')) $('sub-count-amz-batabitoo').textContent = formatNumber(batabitooCount);
      if ($('sub-count-amz-gmail')) $('sub-count-amz-gmail').textContent = formatNumber(gmailCount);
    }
  }

  if (state.amazonView !== 'accounts') { reel.classList.add('hidden'); return; }
  reel.classList.remove('hidden');
  const inboxes = getFilteredAmazonAccounts();
  const visible = inboxes.slice(0, amazonAccountLimit);
  const statusTitle = {
    all: 'كل حسابات أمازون',
    healthy: 'الحسابات السليمة',
    suspected: 'حسابات تحتاج مراجعة',
    banned: 'الحسابات المحظورة والمقيدة',
    deleted: 'الحسابات المستبعدة والمحذوفة'
  }[state.amazonAccountFilter] || 'حسابات أمازون';

  if ($('amazon-results-kicker')) $('amazon-results-kicker').textContent = state.amazonAccountFilter === 'deleted' ? 'الحسابات المستبعدة' : 'إدارة الحسابات';
  if ($('amazon-results-title')) $('amazon-results-title').textContent = statusTitle;
  if ($('amazon-results-count')) $('amazon-results-count').textContent = `${formatNumber(inboxes.length)} حساب`;
  if (!inboxes.length) {
    if (state.amazonAccountFilter === 'deleted') {
      reel.innerHTML = `<div class="amazon-empty"><span>✓</span><h3>لا توجد حسابات مستبعدة</h3><p>جميع حسابات أمازون نشطة وتعمل بشكل طبيعي.</p></div>`;
    } else {
      reel.innerHTML = `<div class="amazon-empty"><span>✓</span><h3>لا توجد حسابات مطابقة</h3><p>غيّر التصنيف أو عبارة البحث لعرض نتائج أخرى.</p><button id="reel-quick-add" type="button">إنشاء حساب أمازون</button></div>`;
    }
    return;
  }
  reel.innerHTML = visible.map(inbox => {
    const email = inbox.email || '';
    const isDotted = Boolean(inbox.isDottedGmailAlias || (inbox.parentEmail && inbox.parentEmail.toLowerCase() !== email.toLowerCase()));
    const parentEmail = inbox.parentEmail || '';
    const label = inbox.personName || inbox.label || email.split('@')[0] || 'حساب أمازون';

    if (inbox.isDeleted) {
      return `<article class="amazon-account-card is-deleted-variant" data-account-email="${attr(email)}" tabindex="0" role="article" aria-label="حساب أمازون مستبعد ${attr(email)}">
        <header>
          <div class="amazon-account-avatar" style="background:#f1f5f9;color:#64748b;">🗑️</div>
          <div>
            <h4>${html(label)}</h4>
            <span class="amazon-account-status" style="color:#64748b;">مستبعد من الاستكشاف التلقائي</span>
            ${isDotted ? `<span class="amz-dotted-tag">🔵 فرع نقطي</span>` : ''}
          </div>
        </header>
        <button class="amazon-account-email" type="button" data-amazon-copy="${attr(encodeURIComponent(email))}" title="نسخ البريد"><span dir="ltr">${html(email)}</span><svg viewBox="0 0 24 24"><rect x="8" y="8" width="11" height="11" rx="2"/><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3"/></svg></button>
        <footer>
          <button type="button" class="btn-restore-amazon" data-restore-amazon="${attr(encodeURIComponent(email))}">↺ استعادة الحساب</button>
          <time style="color:#94a3b8;font-size:10px;">حساب مستبعد</time>
        </footer>
      </article>`;
    }

    const count = Math.max(Number(inbox.messageCount || 0), (state.amazonMessages || []).filter(m => (m.exactRecipient || m.inboxEmail || extractCleanEmail(m.to) || '').toLowerCase() === email.toLowerCase()).length);
    const banned = isConfirmedBanned(inbox);
    const suspected = !banned && isSuspectedInbox(inbox);
    const status = banned ? 'محظور' : suspected ? 'يحتاج مراجعة' : 'سليم';
    const statusClass = banned ? 'banned' : suspected ? 'suspected' : 'healthy';
    return `<article class="amazon-account-card ${statusClass} ${isDotted ? 'is-dotted-variant' : ''}" data-account-id="${attr(inbox.id || '')}" tabindex="0" role="button" aria-label="فتح صندوق ${attr(email)}">
      <header>
        <div class="amazon-account-avatar">${banned ? '!' : suspected ? '?' : isDotted ? '🔵' : 'a'}</div>
        <div>
          <h4>${html(label)}</h4>
          <span class="amazon-account-status">${html(status)}</span>
          ${isDotted ? `<span class="amz-dotted-tag">🔵 فرع نقطي</span>` : ''}
        </div>
        <b class="amazon-account-count">${formatNumber(count)} رسالة</b>
      </header>
      <button class="amazon-account-email" type="button" data-amazon-copy="${attr(encodeURIComponent(email))}" title="نسخ البريد"><span dir="ltr">${html(email)}</span><svg viewBox="0 0 24 24"><rect x="8" y="8" width="11" height="11" rx="2"/><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3"/></svg></button>
      ${isDotted && parentEmail ? `<div class="amz-parent-tag">مرتبط بالحساب المضيف: <span dir="ltr">${html(parentEmail)}</span></div>` : ''}
      ${banned && inbox.banReason ? `<p class="amazon-account-reason">${html(inbox.banReason)}</p>` : ''}
      ${banned ? `<div class="amazon-review-actions amazon-banned-actions"><button type="button" class="btn-mark-recovered" data-mark-recovered="${attr(inbox.id || email)}" data-reason="تم استعادة الحساب">إعادة كحساب سليم (تمت استعادته) ✅</button></div>` : ''}
      ${suspected ? `<div class="amazon-review-actions"><span>هل الحساب محظور فعلًا؟</span><button type="button" data-confirm-ban="${attr(inbox.id || email)}" data-reason="${attr(inbox.banReason || '')}">تأكيد الحظر ⛔</button><button type="button" class="btn-mark-recovered" data-mark-recovered="${attr(inbox.id || email)}" data-reason="تم استعادة الحساب">سليم (مستعاد) ✅</button><button type="button" data-mark-safe="${attr(inbox.id || email)}">استبعاد النمط ❌</button><button type="button" data-ai-verify="${attr(inbox.id || email)}">فحص AI</button></div>` : ''}
      <footer>
        <button type="button" data-amazon-messages="${attr(encodeURIComponent(email))}">عرض رسائل الحساب <span>←</span></button>
        <div style="display:flex;align-items:center;gap:6px;">
          <time>${html(inbox.createdAt ? formatDate(inbox.createdAt) : '')}</time>
          <button type="button" class="amazon-card-del-btn" data-delete-amazon="${attr(encodeURIComponent(email))}" data-account-id="${attr(inbox.id || '')}" title="حذف الحساب واستبعاده من الاستكشاف التلقائي" aria-label="حذف الحساب">
            <svg viewBox="0 0 24 24"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v5M14 11v5"/></svg>
          </button>
        </div>
      </footer>
    </article>`;
  }).join('') + (visible.length < inboxes.length ? `<button class="amazon-load-more" type="button" data-amazon-load-more>عرض ${formatNumber(Math.min(60, inboxes.length - visible.length))} حساب آخر</button>` : '');
}

function renderAmazonMessages() {
  const container = $('amazon-message-list');
  if (!container) return;
  if (state.amazonView !== 'messages') { container.classList.add('hidden'); return; }
  container.classList.remove('hidden');
  const list = getFilteredAmazonMessages();
  const visible = list.slice(0, amazonMessageLimit);
  const title = state.amazonSelectedInbox ? `رسائل ${state.amazonSelectedInbox}` : state.amazonSubFilter === 'otp' ? 'رموز التحقق OTP' : state.amazonSubFilter === 'orders' ? 'الطلبات والشحنات' : 'كل رسائل أمازون';
  if ($('amazon-results-kicker')) $('amazon-results-kicker').textContent = state.amazonSelectedInbox ? 'حساب محدد' : 'صندوق أمازون';
  if ($('amazon-results-title')) {
    if (state.amazonSelectedInbox) {
      $('amazon-results-title').innerHTML = `<span style="display:inline-flex;align-items:center;gap:8px;flex-wrap:wrap;"><span>${html(title)}</span><button type="button" id="amz-clear-inbox-filter-btn" style="font-size:11px;padding:3px 10px;border-radius:999px;background:#f1f5f9;border:1px solid #cbd5e1;cursor:pointer;color:#475569;font-weight:700;">عرض كل الرسائل ✕</button><button type="button" id="amz-return-to-accounts-btn" style="font-size:11px;padding:3px 10px;border-radius:999px;background:#fff7ed;border:1px solid #fdba74;cursor:pointer;color:#c2410c;font-weight:700;">← قائمة الحسابات</button></span>`;
    } else {
      $('amazon-results-title').textContent = title;
    }
  }
  if ($('amazon-results-count')) $('amazon-results-count').textContent = `${formatNumber(list.length)} رسالة`;

  if (!list.length) {
    const isFiltered = Boolean(state.amazonSelectedInbox);
    container.innerHTML = `<div class="empty-state" style="padding: 36px 16px;">
      <div class="empty-icon"><svg viewBox="0 0 24 24" width="36" height="36" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 6h16v12H4zM4 8l8 6 8-6"/></svg></div>
      <h3>${isFiltered ? 'لا توجد رسائل لهذا الحساب حتى الآن' : 'لا توجد رسائل مطابقة'}</h3>
      <p>${isFiltered ? 'لم تصل أي رسائل مسجلة لهذا الحساب بعد.' : 'لم يتم العثور على رسائل تحت هذا التصنيف في أمازون.'}</p>
      ${isFiltered ? `<div style="display:flex;gap:8px;justify-content:center;margin-top:14px;"><button type="button" id="amz-return-to-accounts-btn" style="padding:6px 14px;border-radius:10px;background:#f1f5f9;border:1px solid #cbd5e1;cursor:pointer;font-weight:700;">← الرجوع للحسابات</button><button type="button" id="amz-clear-inbox-filter-btn" style="padding:6px 14px;border-radius:10px;background:#fff7ed;border:1px solid #fdba74;cursor:pointer;color:#c2410c;font-weight:700;">عرض كل رسائل أمازون</button></div>` : ''}
    </div>`;
    return;
  }

  container.innerHTML = visible.map(message => {
    const sender = cleanSenderName(message.from, message.subject);
    const otp = message.otp ? String(message.otp) : '';
    const hasBanContent = isBannedMessage(message);
    const recipient = (message.exactRecipient || message.inboxEmail || extractCleanEmail(message.to) || '').toLowerCase().trim();
    const inbox = findInboxByEmail(recipient);
    const isBanned = isConfirmedBanned(inbox);
    const isInboxSafe = Boolean(inbox && inbox.banStatus === 'safe');
    const isSuspected = !isBanned && !isInboxSafe && (hasBanContent || isSuspectedInbox(inbox));
    const reason = getBanReason(message);
    const isOrder = isAmazonOrderMessage(message);

    return `<article class="message-card ${isBanned ? 'is-banned-card' : isSuspected ? 'is-suspected-card' : ''}" data-message-id="${attr(encodeURIComponent(message.id || ''))}">
      <div class="sender-avatar">${isBanned ? '⛔' : isSuspected ? '⚠️' : isOrder ? '📦' : 'a'}</div>
      <div class="message-main">
        <div class="message-top">
          <strong style="display:inline-flex;align-items:center;gap:6px;flex-wrap:wrap;">
            ${html(sender)}
            ${isBanned ? `<span class="banned-badge">⛔ ${html(reason)}</span>` : isSuspected ? `<span class="suspected-badge">⚠️ اشتباه حظر</span>` : isOrder ? '<span class="order-badge">📦 طلب/شحنة</span>' : '<span class="amazon-badge">أمازون</span>'}
            ${recipient ? `<span class="amz-msg-recipient" dir="ltr" title="المستلم الفعلي للرسالة">🎯 ${html(recipient)}</span>` : ''}
          </strong>
          <time>${html(formatDate(message.createdAt))}</time>
        </div>
        <div class="message-subject">${html(message.subject || '(بدون عنوان)')}</div>
        <div class="message-preview">${html(cleanPreviewText(message.intro || message.text || formatAddress(message.to) || ''))}</div>
        ${isSuspected ? `
        <div class="ban-confirm-inline">
          <span class="ban-confirm-q">اشتباه حظر بانتظار قرارك لتحديد القاعدة:</span>
          <div class="ban-confirm-btns">
            <button class="btn-view-suspect" type="button" data-open-message="${attr(encodeURIComponent(message.id))}" title="معاينة الرسالة التي تسببت في الاشتباه">🔍 معاينة الرسالة</button>
            <button class="btn-confirm-ban" type="button" data-confirm-ban="${attr(inbox?.id || recipient)}" data-msg-id="${attr(message.id)}" data-msg-subject="${attr(message.subject || '')}" title="تأكيد الحظر">تأكيد الحظر ⛔</button>
            <button class="btn-mark-recovered" type="button" data-mark-recovered="${attr(inbox?.id || recipient)}" data-msg-id="${attr(message.id)}" data-msg-subject="${attr(message.subject || '')}" title="الحساب سليم أو تمت استعادته مع الإبقاء على كشف النمط مستقبلاً">الحساب سليم (تمت استعادته) ✅</button>
            <button class="btn-mark-safe" type="button" data-mark-safe="${attr(inbox?.id || recipient)}" data-msg-id="${attr(message.id)}" data-msg-subject="${attr(message.subject || '')}" title="استبعاد هذا النمط وتدريب الكود">استبعاد النمط ❌</button>
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
    const recipient = (m.exactRecipient || m.inboxEmail || extractCleanEmail(m.to) || '').toLowerCase().trim();
    const inbox = findInboxByEmail(recipient);
    if (inbox && (isConfirmedBanned(inbox) || inbox.banStatus === 'safe')) return false;
    return isBannedMessage(m) || isSuspectedInbox(inbox);
  });
  const bannedMsgs = amzMsgs.filter(m => {
    const recipient = (m.exactRecipient || m.inboxEmail || extractCleanEmail(m.to) || '').toLowerCase().trim();
    const inbox = findInboxByEmail(recipient);
    return isConfirmedBanned(inbox);
  });
  const orders = amzMsgs.filter(m => isAmazonOrderMessage(m));
  const healthy = (state.amazon || []).filter(inbox => !isConfirmedBanned(inbox) && !isSuspectedInbox(inbox));

  if ($('amazon-stat-inboxes')) $('amazon-stat-inboxes').textContent = formatNumber((state.amazon || []).length);
  if ($('amazon-stat-messages')) $('amazon-stat-messages').textContent = formatNumber(amzMsgs.length);
  if ($('amazon-stat-healthy')) $('amazon-stat-healthy').textContent = formatNumber(healthy.length);
  if ($('amazon-stat-otps')) $('amazon-stat-otps').textContent = formatNumber(otps.length);
  if ($('amazon-stat-suspected')) $('amazon-stat-suspected').textContent = formatNumber((state.suspected || []).length);
  if ($('amazon-stat-banned')) $('amazon-stat-banned').textContent = formatNumber((state.banned || []).length || bannedMsgs.length);

  if ($('amazon-nav-count')) $('amazon-nav-count').textContent = formatNumber(amzMsgs.length);
  if ($('amazon-seq-name')) $('amazon-seq-name').textContent = getNextSequentialPrefix('ahmedroou');

  if ($('amz-tab-all-count')) $('amz-tab-all-count').textContent = formatNumber(amzMsgs.length);
  if ($('amz-tab-otp-count')) $('amz-tab-otp-count').textContent = formatNumber(otps.length);
  if ($('amz-tab-suspected-count')) $('amz-tab-suspected-count').textContent = formatNumber(suspectedMsgs.length);
  if ($('amz-tab-banned-count')) $('amz-tab-banned-count').textContent = formatNumber(bannedMsgs.length);
  if ($('amz-tab-deleted-count')) $('amz-tab-deleted-count').textContent = formatNumber(state.deletedAmazonAccounts?.size || 0);
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
  const source = state.view === 'logs' && state.logsFilter === 'winning' ? getWinningMessages() : state.view === 'current' ? state.messages : state.view === 'banned' ? state.bannedMessages : state.officialMessages;
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
  const alreadyReading = Boolean(state.currentMessage);
  if (!alreadyReading) {
    readerReturnScroll = window.scrollY;
    readerReturnFocus = document.activeElement;
    readerReturnContext = (!pushHistory && history.state?.readerReturnContext) || {
      view: state.view, logsFilter: state.logsFilter,
      query: $('content-search')?.value || '',
      scroll: readerReturnScroll,
      feedScroll: $('feed-shell')?.scrollTop || 0,
    };
    if (pushHistory) {
      // Record the actual list, not a stale Amazon entry left in history.
      history.replaceState({ screen: state.view === 'amazon' ? 'amazon' : 'list', readerReturnContext }, '');
    }
  }
  if (pushHistory) {
    const entry = { screen: 'reader', messageId: id, readerReturnContext };
    if (alreadyReading) history.replaceState(entry, '');
    else history.pushState(entry, '');
  }
  stopReaderResize();
  state.currentMessage = { id };
  const isDesktop = window.innerWidth >= 1024;
  document.body.classList.add('is-reading');
  if (isDesktop) {
    document.body.classList.add('layout-3panel');
    $('feed-shell')?.classList.remove('hidden');
    $('amazon-hub-shell')?.classList.add('hidden');
  } else {
    document.body.classList.remove('layout-3panel');
    $('feed-shell')?.classList.add('hidden');
    $('amazon-hub-shell')?.classList.add('hidden');
  }
  $('reader-shell')?.classList.remove('hidden');
  document.body.dataset.screen = 'reader';

  // Collapse detailed metadata by default for compact mobile & desktop view
  const envelope = $('reader-envelope-details') || document.querySelector('.reader-envelope');
  if (envelope) envelope.open = false;

  updateReaderNavigation(id);

  // In desktop 3-panel mode, populate middle panel with current active message list
  if (isDesktop && state.activeMessageList && state.activeMessageList.length) {
    if (state.view === 'amazon') {
      if ($('view-kicker')) $('view-kicker').textContent = 'مركز أمازون';
      if ($('view-title')) $('view-title').textContent = 'رسائل أمازون';
    }
    renderMessages(state.activeMessageList);
  }

  // Highlight active message card in middle panel
  document.querySelectorAll('.message-card').forEach(card => {
    const cardId = decodeURIComponent(card.dataset.messageId || '');
    card.classList.toggle('is-selected', cardId === id);
  });

  $('reader-subject').textContent = 'جاري تحميل الرسالة…';
  $('reader-from').textContent = '—';
  $('reader-to').textContent = '—';
  $('reader-date').textContent = '—';
  if ($('reader-compact-from')) $('reader-compact-from').textContent = '—';
  if ($('reader-compact-date')) $('reader-compact-date').textContent = '—';
  $('reader-avatar').textContent = '@';
  $('reader-otp-banner')?.classList.add('hidden');
  $('reader-image-privacy-bar')?.classList.add('hidden');
  $('reader-notice').classList.add('hidden');
  $('reader-attachments').classList.add('hidden');
  $('reader-attachments').replaceChildren();
  $('reader-copy-all-btn').disabled = true;
  window.mailReply?.reset();
  if ($('reader-reply-btn')) $('reader-reply-btn').disabled = true;
  $('reader-retry-btn').disabled = true;
  document.querySelector('.reader-content-card')?.setAttribute('aria-busy', 'true');
  $('reader-content-status').textContent = 'جاري التحميل…';

  const frame = $('reader-frame');
  if (frame) {
    frame.onload = null;
    frame.style.height = '340px';
    frame.srcdoc = loadingDocument();
  }

  if (!isDesktop) {
    $('reader-shell')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  } else if ($('reader-shell')) {
    $('reader-shell').scrollTop = 0;
  }

  try {
    let message = null;
    try {
      message = await api(`/api/messages/${encodeURIComponent(id)}`);
    } catch (fetchErr) {
      // Fallback: use the message already loaded in client state
      const cached = [
        ...(state.messages || []),
        ...(state.officialMessages || []),
        ...(state.tempMessages || []),
        ...(state.amazonMessages || [])
      ].find(m => m.id === id);
      if (cached) {
        message = cached;
      } else {
        throw fetchErr;
      }
    }
    if (request !== readerRequest || state.currentMessage?.id !== id) return;
    state.currentMessage = message;
    if ($('reader-reply-btn')) $('reader-reply-btn').disabled = false;

    const sender = cleanSenderName(message.from, message.subject);
    const recipient = formatAddress(message.to) || message.inboxEmail || state.activeInbox?.email || '—';
    const isBanned = isBannedMessage(message);
    const isAmz = isAmazonMessage(message);
    const isOff = isOfficial(state.activeInbox) || (message.inboxEmail && (message.inboxEmail.endsWith('@batabitoo.com') || message.inboxEmail.endsWith('@gmail.com')));

    $('reader-subject').textContent = message.subject || '(بدون عنوان)';
    $('reader-from').textContent = sender;
    $('reader-to').textContent = recipient;
    const formattedDate = formatDate(message.createdAt, true);
    $('reader-date').textContent = formattedDate;
    if ($('reader-compact-from')) $('reader-compact-from').textContent = sender;
    if ($('reader-compact-date')) $('reader-compact-date').textContent = formattedDate;
    $('reader-avatar').textContent = isBanned ? '⛔' : isAmz ? 'a' : initials(sender);
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
        brandPill.textContent = 'أمازون (Amazon)';
        brandPill.classList.add('brand-amazon');
        brandPill.classList.remove('hidden');
      } else if (isOff) {
        brandPill.textContent = '♛ بريد رسمي';
        brandPill.classList.add('brand-official');
        brandPill.classList.remove('hidden');
      } else {
        brandPill.classList.add('hidden');
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
      const isInboxSafe = Boolean(parentInbox && parentInbox.banStatus === 'safe');
      const isSuspected = !isInboxSafe && (isBanned || isSuspectedInbox(parentInbox) || isBannedMessage(message));
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
    const isTicketEmail = Boolean(
      message.isWinning ||
      (message.from && String(message.from).includes('scananddraw')) ||
      (message.subject && (message.subject.includes('أكوارابيا') || message.subject.includes('Aquarabia') || message.subject.includes('تذكرتك')))
    );

    let attachmentsHtml = '';
    const ticketAttachment = isTicketEmail ? (
      attachments.find(a => (a.contentType === 'application/pdf') || (a.filename && a.filename.toLowerCase().endsWith('.pdf'))) ||
      attachments[0] ||
      { id: 'ATTACH000001', filename: 'Aquarabia_Ticket.pdf', size: 265000, contentType: 'application/pdf' }
    ) : null;

    if (ticketAttachment) {
      const ticketSizeKb = Math.max(1, Math.ceil((ticketAttachment.size || 265000) / 1024));
      const ticketFilename = ticketAttachment.filename || 'Aquarabia_Ticket.pdf';
      const token = localStorage.getItem(SESSION_TOKEN_KEY) || sessionStorage.getItem(SESSION_TOKEN_KEY);
      const tokenParam = token ? `?token=${encodeURIComponent(token)}` : '';
      const ticketUrl = `${API_BASE}/api/messages/${encodeURIComponent(id)}/attachments/${encodeURIComponent(ticketAttachment.id)}${tokenParam}`;
      attachmentsHtml += `
        <div class="reader-ticket-card">
          <div class="reader-ticket-info">
            <span class="reader-ticket-icon">🎟️</span>
            <div>
              <div class="reader-ticket-title">تذكرة دخول أكوارابيا القدية (PDF)</div>
              <div class="reader-ticket-meta">${html(ticketFilename)} · ${ticketSizeKb} KB</div>
            </div>
          </div>
          <div class="reader-ticket-actions">
            <button type="button" class="reader-ticket-btn reader-ticket-download-btn" data-reader-attachment="${attr(ticketAttachment.id)}" title="تحميل ملف التذكرة">
              <svg viewBox="0 0 24 24"><path d="M12 3v12m-5-5 5 5 5-5M5 16v5h14v-5"/></svg>
              <span>تحميل</span>
            </button>
            <button type="button" class="reader-ticket-btn reader-ticket-view-btn" data-view-pdf="${attr(ticketAttachment.id)}" title="عرض التذكرة مباشرة في المتصفح">
              <svg viewBox="0 0 24 24"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
              <span>عرض التذكرة</span>
            </button>
          </div>
        </div>
      `;
    }

    const otherAttachments = ticketAttachment
      ? attachments.filter(a => a.id !== ticketAttachment.id)
      : attachments;

    if (otherAttachments.length > 0) {
      attachmentsHtml += otherAttachments.map(item => {
        const isPdf = (item.contentType === 'application/pdf') || (item.filename && item.filename.toLowerCase().endsWith('.pdf'));
        const sizeStr = `${Math.max(1, Math.ceil((item.size || 0) / 1024))} KB`;
        if (isPdf) {
          return `<button type="button" class="reader-attachment" data-view-pdf="${attr(item.id)}" title="عرض في المتصفح"><svg viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg><span><strong>${html(item.filename || 'ملف PDF')}</strong><small>${sizeStr} · عرض مباشر</small></span></button>`;
        }
        return `<button type="button" class="reader-attachment" data-reader-attachment="${attr(item.id)}"><svg viewBox="0 0 24 24"><path d="M12 3v12m-5-5 5 5 5-5M5 16v5h14v-5"/></svg><span><strong>${html(item.filename || 'مرفق')}</strong><small>${sizeStr} · تنزيل</small></span></button>`;
      }).join('');
    }

    $('reader-attachments').innerHTML = attachmentsHtml;
    $('reader-attachments').classList.toggle('hidden', !attachmentsHtml.trim());

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

    // Direct external images rendering for full fidelity and complete email display
    $('reader-image-privacy-bar')?.classList.add('hidden');

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
                const bodyH = doc.body ? Math.ceil(doc.body.getBoundingClientRect().height) : 0;
                const docH = doc.documentElement ? Math.ceil(doc.documentElement.scrollHeight) : 0;
                const maxH = Math.max(bodyH, docH);
                const target = Math.min(30000, Math.max(340, maxH + 12));
                if (Math.abs(parseInt(frame.style.height, 10) - target) > 2) {
                  frame.style.height = `${target}px`;
                }
              });
            };

            // Recalculate whenever inline/external images load
            doc.querySelectorAll('img').forEach(img => {
              if (!img.complete) {
                img.addEventListener('load', adjust, { once: true });
                img.addEventListener('error', adjust, { once: true });
              }
            });

            const observer = new ResizeObserver(adjust);
            if (doc.body) observer.observe(doc.body);
            if (doc.documentElement) observer.observe(doc.documentElement);
            stopReaderResize = () => {
              observer.disconnect();
              cancelAnimationFrame(animationFrame);
              frame.onload = null;
            };
            adjust();
          }
        } catch (e) {
          frame.style.height = '80vh';
        }
        document.querySelector('.reader-content-card')?.setAttribute('aria-busy', 'false');
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

// ============================================================
// In-Browser Mobile-First PDF Viewer System (PDF.js Canvas)
// ============================================================
let currentPdfDoc = null;
let currentPdfBlob = null;
let currentPdfScale = 1.0;
let currentPdfFilename = 'ticket.pdf';
let currentPdfMessageId = null;
let currentPdfAttachmentId = null;

async function handleViewPdf(button) {
  const message = state.currentMessage;
  if (!message?.id) return;
  const targetId = button.dataset.viewPdf;
  const attachment = message?.attachments?.find(item => String(item.id) === targetId || item.filename === targetId) || {
    id: targetId || 'ATTACH000001',
    filename: 'Aquarabia_Qiddiya_Ticket.pdf',
    contentType: 'application/pdf'
  };
  openPdfViewer(attachment, message.id);
}

async function openPdfViewer(attachment, messageId) {
  const backdrop = $('pdf-viewer-backdrop');
  if (!backdrop) return;
  
  currentPdfFilename = (attachment.filename || 'Aquarabia_Ticket.pdf').replace(/[\\/\u0000-\u001f]/g, '_');
  currentPdfMessageId = messageId;
  currentPdfAttachmentId = attachment.id;
  currentPdfScale = 1.0;
  
  backdrop.classList.remove('hidden');
  document.body.style.overflow = 'hidden';
  
  if ($('pdf-viewer-title')) $('pdf-viewer-title').textContent = attachment.filename || 'عرض التذكرة (PDF)';
  if ($('pdf-viewer-meta')) $('pdf-viewer-meta').textContent = `${Math.max(1, Math.ceil((attachment.size || 0) / 1024))} KB · معاينة مباشرة`;
  if ($('pdf-zoom-level')) $('pdf-zoom-level').textContent = '100%';
  
  const loading = $('pdf-loading-state');
  const errorState = $('pdf-error-state');
  const container = $('pdf-canvas-container');
  
  loading?.classList.remove('hidden');
  errorState?.classList.add('hidden');
  if (container) container.innerHTML = '';
  
  try {
    if (window.pdfjsLib) {
      pdfjsLib.GlobalWorkerOptions.workerSrc = '/vendor/pdf.worker.min.js';
    } else {
      throw new Error('مشغل الـ PDF غير محمل في المتصفح');
    }
    
    // Fetch binary PDF blob using authenticated app API
    const blob = await api(`/api/messages/${encodeURIComponent(messageId)}/attachments/${encodeURIComponent(attachment.id)}`, { responseType: 'blob' });
    currentPdfBlob = blob;
    
    const arrayBuffer = await blob.arrayBuffer();
    currentPdfDoc = await pdfjsLib.getDocument({ data: new Uint8Array(arrayBuffer) }).promise;
    
    if ($('pdf-page-indicator')) $('pdf-page-indicator').textContent = `1 / ${currentPdfDoc.numPages}`;
    
    await renderAllPdfPages();
    loading?.classList.add('hidden');
  } catch (err) {
    console.error('PDF view error:', err);
    loading?.classList.add('hidden');
    errorState?.classList.remove('hidden');
    if ($('pdf-error-text')) $('pdf-error-text').textContent = 'تعذر عرض التذكرة داخل المتصفح: ' + (err.message || 'الملف غير متوفر');
  }
}

async function renderAllPdfPages() {
  if (!currentPdfDoc) return;
  const container = $('pdf-canvas-container');
  if (!container) return;
  container.innerHTML = '';
  
  const containerWidth = container.clientWidth || (window.innerWidth <= 640 ? window.innerWidth - 16 : 800);
  const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
  
  for (let pageNum = 1; pageNum <= currentPdfDoc.numPages; pageNum++) {
    const page = await currentPdfDoc.getPage(pageNum);
    const unscaledViewport = page.getViewport({ scale: 1.0 });
    
    let scale = currentPdfScale;
    if (scale === 1.0 && unscaledViewport.width > containerWidth) {
      scale = (containerWidth - 20) / unscaledViewport.width;
      scale = Math.max(0.4, Math.min(scale, 1.5));
    }
    
    const viewport = page.getViewport({ scale });
    
    const canvas = document.createElement('canvas');
    canvas.className = 'pdf-page-canvas';
    canvas.width = Math.floor(viewport.width * dpr);
    canvas.height = Math.floor(viewport.height * dpr);
    canvas.style.width = Math.floor(viewport.width) + 'px';
    canvas.style.height = Math.floor(viewport.height) + 'px';
    
    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);
    
    container.appendChild(canvas);
    
    await page.render({
      canvasContext: ctx,
      viewport: viewport
    }).promise;
  }
}

function closePdfViewer() {
  const backdrop = $('pdf-viewer-backdrop');
  if (backdrop) backdrop.classList.add('hidden');
  document.body.style.overflow = '';
  currentPdfDoc = null;
  const container = $('pdf-canvas-container');
  if (container) container.innerHTML = '';
}

async function downloadReaderAttachment(button) {
  if (button.disabled) return;
  const message = state.currentMessage;
  if (!message?.id) return;
  const targetId = button.dataset.readerAttachment;
  const attachment = message?.attachments?.find(item => String(item.id) === targetId || item.filename === targetId) || {
    id: targetId || 'ATTACH000001',
    filename: 'Aquarabia_Qiddiya_Ticket.pdf',
    contentType: 'application/pdf'
  };
  button.disabled = true;
  button.setAttribute('aria-busy', 'true');
  try {
    const blob = await api(`/api/messages/${encodeURIComponent(message.id)}/attachments/${encodeURIComponent(attachment.id)}`, { responseType: 'blob' });
    const isPdf = (attachment.contentType === 'application/pdf') || (attachment.filename && attachment.filename.toLowerCase().endsWith('.pdf'));
    const mimeType = isPdf ? 'application/pdf' : 'application/octet-stream';
    const objectUrl = URL.createObjectURL(new Blob([blob], { type: mimeType }));
    const link = document.createElement('a');
    link.href = objectUrl;
    link.download = (attachment.filename || 'Aquarabia_Qiddiya_Ticket.pdf').replace(/[\\/\u0000-\u001f]/g, '_');
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(objectUrl), 60000);
    toast('تم تنزيل ملف التذكرة بنجاح 🎟️');
  } catch (error) {
    toast(friendlyError(error), true);
  } finally {
    button.disabled = false;
    button.removeAttribute('aria-busy');
  }
}

function closeReader(updateHistory = true) {
  window.mailReply?.reset();
  ++readerRequest;
  stopReaderResize();
  state.currentMessage = null;
  const origin = readerReturnContext;
  if (origin) {
    state.view = origin.view;
    state.logsFilter = origin.logsFilter;
  }
  document.body.classList.remove('is-reading', 'layout-3panel');
  document.querySelectorAll('.message-card.is-selected').forEach(card => card.classList.remove('is-selected'));
  $('reader-image-privacy-bar')?.classList.add('hidden');
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
  if (origin) {
    switchContentView(origin.view, false);
    $('content-search').value = origin.query;
    document.querySelectorAll('[data-logs-filter]').forEach(button => button.classList.toggle('active', button.dataset.logsFilter === origin.logsFilter));
    renderContent();
    if ($('feed-shell')) $('feed-shell').scrollTop = origin.feedScroll;
    readerReturnScroll = origin.scroll;
  }
  placeHero();
  if (updateHistory && history.state?.screen === 'reader') {
    history.back();
  }
  readerReturnFocus?.focus?.({ preventScroll: true });
  window.scrollTo({ top: readerReturnScroll, behavior: 'instant' });
}

function getNextSequentialPrefix(base = 'ahmedroou') {
  const allEmails = state.official.map(i => (i.email || '').toLowerCase().trim());
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

function openAmazonDottedModal() {
  const select = $('dotted-parent-select');
  const grid = $('dotted-suggestions-grid');
  const emailInput = $('dotted-email-input');
  const labelInput = $('dotted-label-input');
  if (!select || !grid || !emailInput) return;

  // Collect linked / official Gmail accounts that are not already dotted aliases
  const gmailAccounts = (state.official || []).filter(i => (i.email || '').toLowerCase().endsWith('@gmail.com') && !i.isDottedGmailAlias);

  let options = Array.from(new Set(gmailAccounts.map(a => a.email.toLowerCase().trim())));
  if (!options.length) {
    options = ['ahmedroou1122@gmail.com'];
  } else if (!options.includes('ahmedroou1122@gmail.com')) {
    options.unshift('ahmedroou1122@gmail.com');
  }

  select.innerHTML = options.map(e => `<option value="${attr(e)}">${html(e)} (حساب Gmail المربوط)</option>`).join('');

  const updateSuggestions = (parentEmail) => {
    const variants = generateDottedVariants(parentEmail, 10);
    grid.innerHTML = variants.map((v, idx) => `
      <button class="dotted-chip ${idx === 0 ? 'active' : ''}" type="button" data-variant="${attr(v)}">
        <span class="chip-dot">🔵</span>
        <span class="chip-email" dir="ltr">${html(v)}</span>
      </button>
    `).join('');

    if (variants.length > 0) {
      emailInput.value = variants[0];
      if (labelInput) labelInput.value = `حساب أمازون (${variants[0].split('@')[0]})`;
    } else {
      emailInput.value = parentEmail;
    }
  };

  select.onchange = () => updateSuggestions(select.value);
  updateSuggestions(select.value);

  $('amazon-dotted-backdrop')?.classList.remove('hidden');
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
    const path = '/api/official/create';
    const cleanPrefix = rawPrefix ? (rawPrefix.includes('@') ? rawPrefix.split('@')[0] : rawPrefix.replace(/[^a-z0-9\.]/g, '')) : '';
    const email = rawPrefix.includes('@') ? rawPrefix.toLowerCase() : (isGmail && cleanPrefix ? `${cleanPrefix}@gmail.com`.toLowerCase() : undefined);
    const cleanName = name || (email ? `حساب رسمي (${email.split('@')[0]})` : undefined);

    const data = await api(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        personName: cleanName,
        label: cleanName,
        prefix: cleanPrefix || undefined,
        email: email,
        domain: domain,
        exact: true
      })
    });
    const createdInbox = data.inbox || data;

    if (!createdInbox) throw new Error('لم يرجع الخادم صندوقًا جديدًا');
    $('create-modal').classList.add('hidden');
    $('create-form').reset();
    state.inboxType = 'official';
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

function askDeleteAmazonAccount(email, id) {
  state.pendingDeleteAmazon = { email, id };
  const desc = $('amazon-delete-target-desc');
  if (desc) {
    desc.textContent = `حذف الحساب (${email}) واستبعاده؟ لن تتم إعادة إضافته تلقائياً عند وصول رسائل جديدة، ويمكنك استعادته يدوياً من تبويب "المستبعدة".`;
  }
  $('confirm-amazon-delete-backdrop')?.classList.remove('hidden');
}

async function executeDeleteAmazonAccount() {
  if (!state.pendingDeleteAmazon) return;
  const target = state.pendingDeleteAmazon;
  $('confirm-amazon-delete-backdrop')?.classList.add('hidden');
  state.pendingDeleteAmazon = null;

  const email = (target.email || '').toLowerCase().trim();
  if (!email) return;

  // 1. Optimistic UI update
  state.deletedAmazonAccounts.add(email);
  state.amazon = (state.amazon || []).filter(i => (i.email || '').toLowerCase().trim() !== email);
  state.official = (state.official || []).filter(i => (i.email || '').toLowerCase().trim() !== email);
  renderAmazonHub();
  renderInboxes();

  // 2. Call backend API
  try {
    await api('/api/amazon/delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: email, id: target.id })
    });
    toast(`تم حذف حساب أمازون واستبعاده بنجاح 🗑️ (${email})`);
    await loadInboxes();
    renderAmazonHub();
  } catch (err) {
    console.error('Failed to delete amazon account:', err);
    toast(`تعذر إتمام الحذف: ${friendlyError(err)}`, true);
  }
}

async function executeRestoreAmazonAccount(email) {
  const clean = (email || '').toLowerCase().trim();
  if (!clean) return;

  // 1. Optimistic UI update
  state.deletedAmazonAccounts.delete(clean);
  const isDotted = isDottedGmailAccount({ email: clean });
  if (!state.amazon.some(i => (i.email || '').toLowerCase().trim() === clean)) {
    const prefix = clean.split('@')[0];
    state.amazon.unshift({
      id: `amz_${clean.replace(/[^a-z0-9]/g, '_')}`,
      email: clean,
      label: prefix,
      personName: prefix,
      isAmazon: true,
      isDottedGmailAlias: isDotted,
      createdAt: new Date().toISOString(),
      messageCount: 0
    });
  }
  renderAmazonHub();

  // 2. Call backend API
  try {
    await api('/api/amazon/restore', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: clean })
    });
    toast(`تمت استعادة حساب أمازون بنجاح ✅ (${clean})`);
    await loadInboxes();
    await loadCounts();
    renderAmazonHub();
  } catch (err) {
    console.error('Failed to restore amazon account:', err);
    toast(`تعذر استعادة الحساب: ${friendlyError(err)}`, true);
  }
}

function askDelete(id) {
  state.pendingDeleteId = id;
  $('confirm-delete').classList.remove('hidden');
}

async function deleteInbox() {
  if (!state.pendingDeleteId) return;
  const id = state.pendingDeleteId;
  const deletedInbox = findInboxById(id);
  const deletedEmail = deletedInbox?.email?.toLowerCase?.() || '';

  // 1. Immediately close modal & clear pending ID (Zero-latency UI)
  $('confirm-delete').classList.add('hidden');
  state.pendingDeleteId = null;

  if (seenCounts[id] !== undefined) {
    delete seenCounts[id];
    saveSeenCounts();
  }

  // 2. Snapshot state for rollback in case of server failure
  const backup = {
    official: [...(state.official || [])],
    temp: [...(state.temp || [])],
    amazon: [...(state.amazon || [])],
    banned: [...(state.banned || [])],
    suspected: [...(state.suspected || [])],
    activeId: state.activeId,
    activeInbox: state.activeInbox
  };

  // 3. Immediately purge from local state
  const keepFilter = i => {
    if (!i) return false;
    if (i.id === id) return false;
    if (deletedEmail && (i.email || '').toLowerCase() === deletedEmail) return false;
    return true;
  };
  state.official = (state.official || []).filter(keepFilter);
  state.temp = (state.temp || []).filter(keepFilter);
  state.amazon = (state.amazon || []).filter(keepFilter);
  state.banned = (state.banned || []).filter(keepFilter);
  state.suspected = (state.suspected || []).filter(keepFilter);

  if (state.activeId === id || state.activeInbox?.id === id) {
    const next = state.official[0] || state.amazon[0] || null;
    state.activeId = next?.id || null;
    state.activeInbox = next;
  }
  renderInboxes();

  // 4. Send delete to server in background
  try {
    await api(`/api/inboxes/${encodeURIComponent(id)}`, { method: 'DELETE' });
    toast('تم حذف الصندوق ورسائله بنجاح 🗑️');
    await loadInboxes();
    await loadCounts();
  } catch (error) {
    console.error('Delete error:', error);
    Object.assign(state, backup);
    renderInboxes();
    toast(friendlyError(error), true);
  }
}

// ═══════════════════════════════════════════════════
//  BULK SELECT / DELETE  —  Multi-account management
// ═══════════════════════════════════════════════════

function toggleBulkMode() {
  if (bulkMode) {
    exitBulkMode();
  } else {
    enterBulkMode();
  }
}

function enterBulkMode() {
  bulkMode = true;
  bulkSelectedIds.clear();
  $('bulk-mode-toggle-btn')?.classList.add('active');
  $('bulk-action-bar')?.classList.remove('hidden');
  renderInboxes();
}

function exitBulkMode() {
  bulkMode = false;
  bulkSelectedIds.clear();
  $('bulk-mode-toggle-btn')?.classList.remove('active');
  $('bulk-action-bar')?.classList.add('hidden');
  renderInboxes();
}

function updateBulkActionBar() {
  const count = bulkSelectedIds.size;
  const label = $('bulk-count-label');
  const deleteBtn = $('bulk-delete-btn');
  const selectAllBtn = $('bulk-select-all-btn');
  if (label) label.textContent = count > 0 ? `${count} محدد` : 'حدّد حسابات';
  if (deleteBtn) deleteBtn.disabled = count === 0;

  // Update "select all" label dynamically
  if (selectAllBtn) {
    const visibleItems = document.querySelectorAll('#inbox-list .inbox-item');
    const allSelected = visibleItems.length > 0 && count >= visibleItems.length;
    selectAllBtn.textContent = allSelected ? 'إلغاء الكل' : 'الكل';
  }
}

function toggleBulkSelect(inboxId) {
  if (!inboxId) return;
  if (bulkSelectedIds.has(inboxId)) {
    bulkSelectedIds.delete(inboxId);
  } else {
    bulkSelectedIds.add(inboxId);
  }
  renderInboxes();
}

function selectAllVisibleInboxes() {
  const visibleItems = document.querySelectorAll('#inbox-list .inbox-item');
  const allSelected = visibleItems.length > 0 && bulkSelectedIds.size >= visibleItems.length;
  if (allSelected) {
    // Deselect all visible
    visibleItems.forEach(el => {
      const rawId = el.dataset.inboxId;
      if (rawId) bulkSelectedIds.delete(decodeURIComponent(rawId));
    });
  } else {
    // Select all visible
    visibleItems.forEach(el => {
      const rawId = el.dataset.inboxId;
      if (rawId) bulkSelectedIds.add(decodeURIComponent(rawId));
    });
  }
  renderInboxes();
}

function showBulkDeleteConfirm() {
  if (bulkSelectedIds.size === 0) return;
  const inboxes = [...bulkSelectedIds].map(id => findInboxById(id)).filter(Boolean);
  const count = inboxes.length;
  const title = $('bulk-confirm-title');
  const desc = $('bulk-confirm-desc');
  const preview = $('bulk-names-preview');
  const okLabel = $('bulk-confirm-ok-label');
  if (title) title.textContent = `حذف ${count} ${count === 1 ? 'حساب' : 'حسابات'}؟`;
  if (desc) desc.textContent = `سيتم حذف هذه الحسابات ورسائلها المحفوظة نهائياً ولا يمكن التراجع.`;
  if (preview) {
    preview.innerHTML = inboxes
      .map(i => `<div style="border-bottom:1px solid #e2e8f0;padding:3px 0;">${html(i.email || i.id)}</div>`)
      .join('');
  }
  if (okLabel) okLabel.textContent = count === 1 ? 'حذف الحساب' : `حذف ${count} حسابات`;
  $('bulk-confirm-modal')?.classList.remove('hidden');
}

async function deleteSelectedInboxes() {
  const ids = [...bulkSelectedIds];
  if (ids.length === 0) return;

  // 1. Snapshot state for rollback
  const backup = {
    official: [...(state.official || [])],
    temp: [...(state.temp || [])],
    amazon: [...(state.amazon || [])],
    banned: [...(state.banned || [])],
    suspected: [...(state.suspected || [])],
    activeId: state.activeId,
    activeInbox: state.activeInbox
  };

  // 2. Immediately close modal and exit bulk mode (Zero-latency UI)
  $('bulk-confirm-modal')?.classList.add('hidden');
  exitBulkMode();

  // 3. Clean up seenCounts and purge from local state immediately
  ids.forEach(id => {
    if (seenCounts[id] !== undefined) delete seenCounts[id];
  });
  saveSeenCounts();

  const idSet = new Set(ids);
  const keepFilter = i => !i || !idSet.has(i.id);
  state.official = (state.official || []).filter(keepFilter);
  state.temp = (state.temp || []).filter(keepFilter);
  state.amazon = (state.amazon || []).filter(keepFilter);
  state.banned = (state.banned || []).filter(keepFilter);
  state.suspected = (state.suspected || []).filter(keepFilter);

  if (ids.includes(state.activeId)) {
    const next = state.official[0] || state.amazon[0] || null;
    state.activeId = next?.id || null;
    state.activeInbox = next;
  }
  renderInboxes();

  // 4. Send single atomic batch-delete request to server
  try {
    const res = await api('/api/inboxes/batch-delete', {
      method: 'POST',
      body: JSON.stringify({ ids })
    });
    toast(`تم حذف ${res.count || ids.length} حساب بنجاح 🗑️`);
    await loadInboxes();
    await loadCounts();
  } catch (error) {
    console.error('Batch delete error:', error);
    Object.assign(state, backup);
    renderInboxes();
    toast(friendlyError(error), true);
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
  if (inbox.isDottedGmailAlias === true) return true;
  if (!isOfficial(inbox)) return false;
  if (inbox.isAmazon === true || inbox.isBanned === true || inbox.banStatus === 'confirmed' || inbox.banStatus === 'suspected') return true;

  const meta = [inbox.email, inbox.label, inbox.personName].filter(Boolean).join(' ').toLowerCase();
  if (/amazon|أمازون|امازون|إمازون/i.test(meta)) return true;

  const allMsgs = messages || [...(state.messages || []), ...(state.officialMessages || []), ...(state.amazonMessages || []), ...(state.bannedMessages || [])];
  const inboxEmail = String(inbox.email || '').toLowerCase().trim();
  return allMsgs.some(m => {
    const msgRecipient = (m.exactRecipient || m.inboxEmail || extractCleanEmail(m.to) || '').toLowerCase().trim();
    return msgRecipient === inboxEmail && isAmazonMessage(m);
  });
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

  const allMsgs = messages || [...(state.messages || []), ...(state.officialMessages || []), ...(state.amazonMessages || []), ...(state.bannedMessages || [])];
  const inboxEmail = String(inbox.email || '').toLowerCase().trim();
  return allMsgs.some(m => {
    const msgRecipient = (m.exactRecipient || m.inboxEmail || extractCleanEmail(m.to) || '').toLowerCase().trim();
    return msgRecipient === inboxEmail && isBannedMessage(m);
  });
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
  if (trimmed.length > 20 && /^[A-Za-z0-9+/=\r\n\s]+$/.test(trimmed)) {
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

const WIN1252_MAP = {
  0x20AC:0x80, 0x201A:0x82, 0x0192:0x83, 0x201E:0x84, 0x2026:0x85, 0x2020:0x86, 0x2021:0x87,
  0x02C6:0x88, 0x2030:0x89, 0x0160:0x8A, 0x2039:0x8B, 0x0152:0x8C, 0x017D:0x8E, 0x2018:0x91,
  0x2019:0x92, 0x201C:0x93, 0x201D:0x94, 0x2022:0x95, 0x2013:0x96, 0x2014:0x97, 0x02DC:0x98,
  0x2122:0x99, 0x0161:0x9A, 0x203A:0x9B, 0x0153:0x9C, 0x017E:0x9E, 0x0178:0x9F
};

function fixMojibake(str) {
  if (!str || typeof str !== 'string') return '';
  if (!/[\u00D8\u00D9\u00C2-\u00DF]/.test(str)) return str;
  try {
    const bytes = [];
    for (let i = 0; i < str.length; i++) {
      const code = str.charCodeAt(i);
      if (code < 256) bytes.push(code);
      else if (WIN1252_MAP[code]) bytes.push(WIN1252_MAP[code]);
      else return str;
    }
    const decoded = new TextDecoder('utf-8', { fatal: false }).decode(new Uint8Array(bytes));
    if (decoded && /[\u0600-\u06FF]/.test(decoded)) return decoded;
  } catch (_) {}
  return str;
}

function cleanPreviewText(str) {
  if (!str || typeof str !== 'string') return '';
  let text = str;
  text = fixMojibake(text);
  text = decodeBase64IfNeeded(text);
  text = fixMojibake(text);
  if (text.includes('boundary=') || /^(?:X-AMAZON|Bounces-to|Content-Type|Feedback-ID):/im.test(text)) {
    text = text.replace(/boundary="[^"]+"/gi, '')
               .replace(/boundary=[^\s;]+/gi, '')
               .replace(/^(?:Feedback-ID|X-SES-[\w-]+|X-AMAZON-[\w-]+|Bounces-to|Received|DKIM-[\w-]+|MIME-Version|Content-[\w-]+):\s*[^\n]*/gim, '')
               .replace(/--[a-zA-Z0-9_\-\.\=\+]+(?:--)?/g, '');
  }
  return text.replace(/\s+/g, ' ').trim().slice(0, 140);
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
