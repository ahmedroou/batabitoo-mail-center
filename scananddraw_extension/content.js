// ScanAndDraw Pro Automation Bot (Tripartite Random Arabic Names & Dual-Engine Mail System)
// Default Mode: Temporary/Disposable Real Inboxes (+20 Diverse Domains)
// Optional Mode: Official Trusted Inboxes (@batabitoo.com)

const FIRST_NAMES = [
  // Male Names
  "محمد", "أحمد", "عبدالله", "فيصل", "سعود", "فهد", "خالد", "عمر", "علي", "سلمان",
  "عبدالعزيز", "تركي", "بندر", "مشاري", "نايف", "بدر", "نواف", "زياد", "فارس", "حمزة",
  "بلال", "أنس", "معاذ", "عمار", "لؤي", "مازن", "ريان", "مهند", "هاني", "حاتم",
  "سلطان", "راكان", "طلال", "سيف", "عبدالرحمن", "إبراهيم", "مصطفى", "طارق", "ياسر", "وليد",
  // Female Names
  "سارة", "نورة", "فاطمة", "مريم", "ريم", "هند", "منى", "شهد", "أروى", "دانة",
  "رهف", "خلود", "عائشة", "جود", "لمى", "رغد", "غيداء", "بدور", "لولوه", "بيان",
  "أمل", "إيمان", "حنان", "دعاء", "سمر", "دينا", "رشا", "شروق", "بسمة", "نهى",
  "هبة", "عبير", "إسراء", "وفاء", "غادة", "سحر", "نجلاء", "مي", "مها", "رزان"
];

const MIDDLE_NAMES = [
  "محمد", "أحمد", "عبدالله", "علي", "إبراهيم", "خالد", "صالح", "سعد", "سعيد", "عمر",
  "حسن", "حسين", "منصور", "سلطان", "فهد", "عبدالرحمن", "ناصر", "عثمان", "سليمان", "ماجد",
  "تركي", "عبدالعزيز", "فيصل", "محمود", "حمد", "سالم", "يوسف", "طارق", "فواز", "مبارك"
];

const FAMILY_NAMES = [
  "الشمري", "القحطاني", "العتيبي", "الحربي", "المطيري", "الدوسري", "الغامدي", "الزهراني",
  "الشهري", "العنزي", "السبيعي", "البقمي", "المالكي", "الرشيدي", "الخالدي", "الشهراني",
  "العسيري", "السهلي", "اليامي", "البلوي", "الشراري", "العجمي", "الحارثي", "التميمي",
  "الظفيري", "الرويلي", "القرني", "الهذلي", "الزبيدي", "المصري", "شلبي", "النجار",
  "الخطيب", "السيد", "رمضان", "توفيق", "عثمان", "جاد", "علام", "بدوي", "يونس", "غانم"
];

const CITIES = ["الرياض", "جدة", "الدمام", "مكة المكرمة", "المدينة المنورة", "الخبر", "القصيم", "حائل", "تبوك", "بريدة", "الطائف", "أبها", "خميس مشيط"];

const ARABIC_TO_LATIN = {
  "محمد": "mohamed", "أحمد": "ahmed", "عبدالله": "abdullah", "فيصل": "faisal", "سعود": "saud",
  "فهد": "fahad", "خالد": "khaled", "عمر": "omar", "علي": "ali", "سلمان": "salman",
  "عبدالعزيز": "abdulaziz", "تركي": "turki", "بندر": "bandar", "مشاري": "mishari", "نايف": "nayef",
  "بدر": "bader", "نواف": "nawaf", "زياد": "ziad", "فارس": "fares", "حمزة": "hamza",
  "بلال": "belal", "أنس": "anas", "معاذ": "moath", "عمار": "ammar", "سلطان": "sultan",
  "سارة": "sara", "نورة": "noura", "فاطمة": "fatima", "مريم": "maryam", "ريم": "reem",
  "هند": "hend", "منى": "mona", "شهد": "shahad", "أروى": "arwa", "دانة": "dana",
  "الشمري": "shammari", "القحطاني": "qahtani", "العتيبي": "otaibi", "الحربي": "harbi",
  "المطيري": "mutairi", "الدوسري": "dossari", "الغامدي": "ghamdi", "الزهراني": "zahrani",
  "الشهري": "shehri", "العنزي": "anzi", "السبيعي": "subaie", "البقمي": "buqami",
  "المالكي": "malki", "الرشيدي": "rashidi", "الخالدي": "khaldi", "الشهراني": "shahrani",
  "العسيري": "asiri", "السهلي": "sehli", "اليامي": "yami", "البلوي": "balawi",
  "الشراري": "sharari", "العجمي": "ajmi", "الحارثي": "harthi", "التميمي": "tamimi",
  "الظفيري": "dhafiri", "الرويلي": "ruwaili", "القرني": "qarni", "شلبي": "shalabi",
  "المصري": "almasri", "النجار": "najjar", "الخطيب": "khatib", "صالح": "saleh", "سعيد": "saeed",
  "مروان": "marwan", "زعير": "zaeer"
};

const DIVERSE_DOMAINS = [
  'getairmail.com', 'getnada.com', 'inboxbear.com', 'replyloop.com',
  'robot-mail.com', 'dropjar.com', 'fivermail.com', 'getmule.com',
  'temptami.com', 'vomoto.com', 'tupmail.com', 'tafmail.com',
  'clowmail.com', 'chapsmail.com', 'blondmail.com', 'gimpmail.com',
  'givmail.com', 'guysmail.com', 'emalupe.com', 'westcast-systems.com'
];

function transliterate(name) {
  if (!name) return "user";
  const clean = name.trim();
  if (ARABIC_TO_LATIN[clean]) return ARABIC_TO_LATIN[clean];
  return clean
    .replace(/أ|إ|آ|ا/g, 'a')
    .replace(/ب/g, 'b').replace(/ت|ة/g, 't').replace(/ث/g, 'th')
    .replace(/ج/g, 'j').replace(/ح/g, 'h').replace(/خ/g, 'kh')
    .replace(/د/g, 'd').replace(/ذ/g, 'dh').replace(/ر/g, 'r')
    .replace(/ز/g, 'z').replace(/س/g, 's').replace(/ش/g, 'sh')
    .replace(/ص/g, 's').replace(/ض/g, 'd').replace(/ط/g, 't')
    .replace(/ظ/g, 'z').replace(/ع/g, 'a').replace(/غ/g, 'gh')
    .replace(/ف/g, 'f').replace(/ق/g, 'q').replace(/ك/g, 'k')
    .replace(/ل/g, 'l').replace(/م/g, 'm').replace(/ن/g, 'n')
    .replace(/ه/g, 'h').replace(/و/g, 'w').replace(/ي|ى/g, 'y')
    .replace(/ال/g, 'al')
    .replace(/[^a-zA-Z0-9]/g, '')
    .toLowerCase() || "user";
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function getRandom(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function generateSaudiPhone() {
  const prefixes = ["050", "053", "054", "055", "056", "057", "058", "059"];
  const prefix = getRandom(prefixes);
  const randomDigits = Math.floor(1000000 + Math.random() * 9000000).toString();
  return prefix + randomDigits;
}

// Generate Realistic 3-Part Name
function generateTripartitePerson() {
  const firstName = getRandom(FIRST_NAMES);
  const middleName = getRandom(MIDDLE_NAMES);
  const familyName = getRandom(FAMILY_NAMES);

  const lastName = `${middleName} ${familyName}`;
  const fullName = `${firstName} ${middleName} ${familyName}`;
  const prefix = `${transliterate(firstName)}.${transliterate(familyName)}`;

  return {
    firstName: firstName,
    lastName: lastName,
    fullName: fullName,
    mobile: generateSaudiPhone(),
    city: getRandom(CITIES),
    prefix: prefix
  };
}

// Dual-Endpoint Server Caller (Local http://localhost:3030 with Cloud Tunnel failover)
const SERVER_ENDPOINTS = [
  'http://localhost:3030',
  'https://inbox-api.batabitoo.com'
];

async function callServer(apiPath, options = {}) {
  const timeoutMs = 3500;
  for (const base of SERVER_ENDPOINTS) {
    try {
      const controller = new AbortController();
      const id = setTimeout(() => controller.abort(), timeoutMs);
      const res = await fetch(`${base}${apiPath}`, {
        ...options,
        signal: controller.signal
      });
      clearTimeout(id);
      if (res.ok) {
        return await res.json();
      }
    } catch(e) {
      // Continue to next endpoint
    }
  }
  return null;
}

// Generate Inbox according to configured mode (Default: 'temp' as requested)
async function generatePersonRealInbox(personPrefix, personLabel, emailMode = 'temp') {
  const cleanPrefix = (personPrefix || 'user').toLowerCase().replace(/[^a-z0-9.]/g, '') || 'user';

  // 1. OPTIONAL MODE: Official @batabitoo.com Inboxes
  if (emailMode === 'official') {
    try {
      const data = await callServer('/api/official/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prefix: cleanPrefix, label: personLabel, personName: personLabel })
      });
      if (data && data.inbox && data.inbox.email) {
        console.log('👑 Generated Official Inbox:', data.inbox.email);
        return data.inbox.email;
      }
    } catch(e) {}

    // Fallback official
    const randNum = Math.floor(100 + Math.random() * 900);
    return `${cleanPrefix.replace(/\./g, '')}${randNum}@batabitoo.com`;
  }

  // 2. CURRENT / DEFAULT MODE: Temporary Inboxes via Inboxes engine or +20 diverse domains
  try {
    const data = await callServer('/api/inboxes/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prefix: cleanPrefix, label: personLabel, personName: personLabel })
    });
    if (data && data.inbox && data.inbox.email) {
      console.log('⚡ Generated Temp Inbox (Server):', data.inbox.email);
      return data.inbox.email;
    }
  } catch(e) {}

  // Diverse 20+ Domain Direct Fallback
  const randomDomain = getRandom(DIVERSE_DOMAINS);
  const flatPrefix = cleanPrefix.replace(/[^a-z0-9]/g, '');
  const randNum = Math.floor(1000 + Math.random() * 9000);
  const fallbackEmail = `${flatPrefix}${randNum}@${randomDomain}`;
  console.log('⚡ Generated Temp Inbox (Fallback):', fallbackEmail);
  return fallbackEmail;
}

// Log registration with dual-endpoint support (Syncs locally + Firebase Firestore)
async function logRegistrationToServer(entry) {
  try {
    const res = await callServer('/api/nivea/log-registration', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(entry)
    });
    if (res && res.success) {
      console.log(`✅ Logged registration for ${entry.personName} | Total now: ${res.total}`);
      return res;
    }
  } catch(e) {
    console.error('Failed to log registration to server:', e);
  }
  return null;
}

let statusElement;
let modeBadgeElement;
let isAutomationRunning = false;

// ============================================================
// 1. CONGRATULATIONS PAGE HANDLER (Seamless return loop)
// ============================================================
async function handleCongratulationsPage() {
  const currentUrl = window.location.href;
  const isCongrats = currentUrl.includes('/congratulations/') || document.body.innerText.includes('تهانينا') || document.body.innerText.includes('Congratulations');

  if (isCongrats) {
    console.log('🎉 On Congratulations page! Logging and returning to form...');

    const lastReg = JSON.parse(sessionStorage.getItem('cmp_pending_reg') || '{}');
    if (lastReg.personName && lastReg.realEmail) {
      await logRegistrationToServer(lastReg);
      sessionStorage.removeItem('cmp_pending_reg');
    }

    chrome.runtime.sendMessage({ action: "SUCCESS_NEXT" });

    const notice = document.createElement('div');
    notice.style.position = 'fixed';
    notice.style.top = '20px';
    notice.style.left = '50%';
    notice.style.transform = 'translateX(-50%)';
    notice.style.backgroundColor = '#10B981';
    notice.style.color = '#FFFFFF';
    notice.style.padding = '10px 20px';
    notice.style.borderRadius = '30px';
    notice.style.fontSize = '13px';
    notice.style.fontWeight = 'bold';
    notice.style.boxShadow = '0 10px 30px rgba(0,0,0,0.5)';
    notice.style.zIndex = '2147483647';
    notice.style.direction = 'rtl';
    notice.style.fontFamily = 'Cairo, Arial, sans-serif';
    notice.innerText = `🎉 تم توثيق (${lastReg.personName || 'المشارك'}) بنجاح! جاري العودة للنموذج...`;
    document.body.appendChild(notice);

    await delay(1400);
    window.location.href = "https://scananddraw.com/ar/form/";
    return true;
  }
  return false;
}

// ============================================================
// 2. FORM AUTOMATION LOGIC & COMPACT FLOATING TOOLBAR
// ============================================================
function injectUI(emailMode = 'temp') {
  if (document.getElementById('sad-control-bar')) return;

  const container = document.createElement('div');
  container.id = 'sad-control-bar';
  container.style.position = 'fixed';
  container.style.bottom = '0';
  container.style.left = '0';
  container.style.width = '100%';
  container.style.backgroundColor = '#080C14';
  container.style.borderTop = '2px solid #0284C7';
  container.style.color = '#fff';
  container.style.padding = '8px 16px';
  container.style.zIndex = '2147483647';
  container.style.display = 'flex';
  container.style.justifyContent = 'space-between';
  container.style.alignItems = 'center';
  container.style.boxShadow = '0 -4px 20px rgba(0,0,0,0.6)';
  container.style.fontFamily = 'Cairo, Arial, sans-serif';
  container.style.direction = 'rtl';
  container.style.fontSize = '12px';

  const rightSide = document.createElement('div');
  rightSide.style.display = 'flex';
  rightSide.style.alignItems = 'center';
  rightSide.style.gap = '10px';

  const title = document.createElement('strong');
  title.innerText = '⚡ نيفيا أوتو برو';
  title.style.color = '#38BDF8';
  title.style.fontSize = '13px';

  modeBadgeElement = document.createElement('span');
  modeBadgeElement.style.fontSize = '10px';
  modeBadgeElement.style.padding = '2px 8px';
  modeBadgeElement.style.borderRadius = '6px';
  modeBadgeElement.style.fontWeight = 'bold';
  updateModeBadge(emailMode);
  
  statusElement = document.createElement('span');
  statusElement.style.fontWeight = 'bold';
  statusElement.style.fontSize = '11.5px';
  statusElement.style.color = '#94A3B8';
  statusElement.innerText = 'جاهز للبدء';
  
  rightSide.appendChild(title);
  rightSide.appendChild(modeBadgeElement);
  rightSide.appendChild(statusElement);

  const centerSide = document.createElement('div');
  centerSide.style.display = 'flex';
  centerSide.style.gap = '8px';
  centerSide.style.alignItems = 'center';

  const totalInput = document.createElement('input');
  totalInput.type = 'number';
  totalInput.placeholder = 'العدد الكلي';
  totalInput.style.padding = '3px 6px';
  totalInput.style.width = '65px';
  totalInput.style.backgroundColor = '#1E293B';
  totalInput.style.border = '1px solid #334155';
  totalInput.style.color = '#fff';
  totalInput.style.borderRadius = '6px';
  totalInput.style.fontSize = '11px';
  totalInput.style.textAlign = 'center';

  const indexInput = document.createElement('input');
  indexInput.type = 'number';
  indexInput.placeholder = 'الحالي';
  indexInput.style.padding = '3px 6px';
  indexInput.style.width = '55px';
  indexInput.style.backgroundColor = '#1E293B';
  indexInput.style.border = '1px solid #334155';
  indexInput.style.color = '#fff';
  indexInput.style.borderRadius = '6px';
  indexInput.style.fontSize = '11px';
  indexInput.style.textAlign = 'center';

  const inboxLink = document.createElement('a');
  inboxLink.href = 'http://localhost:3030';
  inboxLink.target = '_blank';
  inboxLink.innerText = '📬 مركز الرسائل';
  inboxLink.style.color = '#38BDF8';
  inboxLink.style.fontSize = '11px';
  inboxLink.style.fontWeight = 'bold';
  inboxLink.style.textDecoration = 'none';
  inboxLink.style.padding = '3px 8px';
  inboxLink.style.backgroundColor = '#1E293B';
  inboxLink.style.border = '1px solid #334155';
  inboxLink.style.borderRadius = '6px';

  chrome.storage.local.get(['totalRegs', 'currentIndex'], (data) => {
    totalInput.value = data.totalRegs || 200;
    indexInput.value = data.currentIndex || 0;
  });

  centerSide.appendChild(document.createTextNode('الحالي:'));
  centerSide.appendChild(indexInput);
  centerSide.appendChild(document.createTextNode('من:'));
  centerSide.appendChild(totalInput);
  centerSide.appendChild(inboxLink);

  const leftSide = document.createElement('div');
  leftSide.style.display = 'flex';
  leftSide.style.gap = '8px';
  
  const startBtn = document.createElement('button');
  startBtn.innerText = '▶️ تشغيل مستمر';
  startBtn.style.padding = '5px 12px';
  startBtn.style.cursor = 'pointer';
  startBtn.style.backgroundColor = '#10B981';
  startBtn.style.color = '#fff';
  startBtn.style.border = 'none';
  startBtn.style.borderRadius = '6px';
  startBtn.style.fontWeight = 'bold';
  startBtn.style.fontSize = '11px';
  
  const stopBtn = document.createElement('button');
  stopBtn.innerText = '⏹️ إيقاف';
  stopBtn.style.padding = '5px 12px';
  stopBtn.style.cursor = 'pointer';
  stopBtn.style.backgroundColor = '#EF4444';
  stopBtn.style.color = '#fff';
  stopBtn.style.border = 'none';
  stopBtn.style.borderRadius = '6px';
  stopBtn.style.fontWeight = 'bold';
  stopBtn.style.fontSize = '11px';

  leftSide.appendChild(startBtn);
  leftSide.appendChild(stopBtn);
  
  container.appendChild(rightSide);
  container.appendChild(centerSide);
  container.appendChild(leftSide);
  document.body.appendChild(container);

  startBtn.addEventListener('click', () => {
    chrome.storage.local.set({
      totalRegs: parseInt(totalInput.value) || 200,
      currentIndex: parseInt(indexInput.value) || 0
    }, () => {
      chrome.runtime.sendMessage({ action: "START" }, (res) => {
        if (res && res.success) {
          window.location.reload();
        }
      });
    });
  });

  stopBtn.addEventListener('click', () => {
    chrome.runtime.sendMessage({ action: "STOP" }, () => {
      isAutomationRunning = false;
      updateStatus('تم الإيقاف 🛑', '#EF4444');
    });
  });
}

function updateModeBadge(mode) {
  if (!modeBadgeElement) return;
  if (mode === 'official') {
    modeBadgeElement.innerText = '👑 إيميلات رسمية (@batabitoo.com)';
    modeBadgeElement.style.background = 'rgba(245, 158, 11, 0.2)';
    modeBadgeElement.style.color = '#FBBF24';
    modeBadgeElement.style.border = '1px solid rgba(245, 158, 11, 0.4)';
  } else {
    modeBadgeElement.innerText = '⚡ إيميلات مؤقتة (متنوعة)';
    modeBadgeElement.style.background = 'rgba(56, 189, 248, 0.2)';
    modeBadgeElement.style.color = '#38BDF8';
    modeBadgeElement.style.border = '1px solid rgba(56, 189, 248, 0.4)';
  }
}

function updateStatus(text, color = '#F1F5F9') {
  if (statusElement) {
    statusElement.innerText = text;
    statusElement.style.color = color;
  }
}

function fillInput(name, value) {
  const input = document.querySelector(`input[name="${name}"]`);
  if (input) {
    input.focus();
    input.value = value;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    input.dispatchEvent(new Event('blur', { bubbles: true }));
  }
}

async function startAutomation() {
  chrome.runtime.sendMessage({ action: "GET_STATE" }, async (state) => {
    if (!state || !state.isRunning) {
      updateStatus('متوقف مؤقتاً. اضغط تشغيل للبدء.', '#94A3B8');
      return;
    }
    
    isAutomationRunning = true;
    const currentIndex = state.currentIndex || 0;
    const emailMode = state.emailMode || 'temp';
    updateModeBadge(emailMode);
    
    // Generate Realistic Tripartite Person
    const person = generateTripartitePerson();

    updateStatus(`[${currentIndex + 1}/${state.total}] ⏳ توليد إيميل لـ: ${person.fullName}...`, '#F59E0B');

    // Generate inbox according to mode
    const realEmail = await generatePersonRealInbox(person.prefix, person.fullName, emailMode);
    const receiptNumber = Math.floor(100000 + Math.random() * 900000).toString();

    // Cache pending registration for congratulations handler
    sessionStorage.setItem('cmp_pending_reg', JSON.stringify({
      personName: person.fullName,
      mobile: person.mobile,
      city: person.city,
      receiptNumber: receiptNumber,
      realEmail: realEmail
    }));

    updateStatus(`[${currentIndex + 1}/${state.total}] ✍️ ${person.fullName} | ${realEmail}`, '#38BDF8');

    await delay(600);
    fillInput("form_fields[firstname]", person.firstName);
    await delay(200);
    fillInput("form_fields[lastname]", person.lastName);
    await delay(200);
    fillInput("form_fields[emailaddress]", realEmail);
    await delay(200);
    fillInput("form_fields[mobilenumber]", person.mobile);
    await delay(200);
    fillInput("form_fields[city]", person.city);
    await delay(200);
    fillInput("form_fields[recieptnumber]", receiptNumber);

    await delay(400);
    const terms = document.querySelector('#form-field-termandcondition-0') || document.querySelector('input[name="form_fields[termandcondition]"]');
    if (terms && !terms.checked) {
      terms.click();
    }

    await delay(500);
    updateStatus(`🚀 إرسال مشاركة (${person.fullName})...`, '#10B981');
    const submitBtn = document.querySelector('button[type="submit"]');
    if (submitBtn) submitBtn.click();
  });
}

// Entry Point
window.addEventListener('load', async () => {
  const handled = await handleCongratulationsPage();
  if (handled) return;

  if (window.location.pathname.includes('/form')) {
    chrome.storage.local.get(['emailMode'], (data) => {
      injectUI(data.emailMode || 'temp');
      setTimeout(() => {
        startAutomation();
      }, 1500);
    });
  }
});
