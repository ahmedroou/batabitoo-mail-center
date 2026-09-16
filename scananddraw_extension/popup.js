document.addEventListener('DOMContentLoaded', async () => {
  const modeTemp = document.getElementById('modeTemp');
  const modeOfficial = document.getElementById('modeOfficial');
  const totalRegsInput = document.getElementById('totalRegs');
  const currentIndexInput = document.getElementById('currentIndex');
  const saveBtn = document.getElementById('saveBtn');
  const statusMsg = document.getElementById('status-msg');
  const liveRegsCount = document.getElementById('live-regs-count');
  const badgeStatus = document.getElementById('badge-status');
  const btnOpenInbox = document.getElementById('btn-open-inbox');
  const incognitoWarning = document.getElementById('incognito-warning');

  // Check Incognito access
  if (chrome.extension && chrome.extension.isAllowedIncognitoAccess) {
    chrome.extension.isAllowedIncognitoAccess((isAllowed) => {
      if (!isAllowed && incognitoWarning) incognitoWarning.style.display = 'block';
    });
  }

  // Load existing settings (Default: 'temp' as requested)
  chrome.storage.local.get(['emailMode', 'totalRegs', 'currentIndex'], (data) => {
    const mode = data.emailMode || 'temp';
    if (mode === 'official') {
      modeOfficial.checked = true;
    } else {
      modeTemp.checked = true;
    }

    totalRegsInput.value = data.totalRegs !== undefined ? data.totalRegs : 200;
    currentIndexInput.value = data.currentIndex !== undefined ? data.currentIndex : 0;
  });

  // Check Live Server & Fetch Live Stats (Dual: Cloud & Local)
  async function checkServer() {
    const endpoints = [
      { api: 'http://localhost:3030', web: 'http://localhost:3030', label: '🟢 متصل محلياً' },
      { api: 'https://inbox-api.batabitoo.com', web: 'https://batabitoo-mail-2026.web.app', label: '☁️ متصل سحابياً' }
    ];
    let connected = false;

    for (const ep of endpoints) {
      try {
        const res = await fetch(`${ep.api}/api/nivea/logs`);
        if (res.ok) {
          const data = await res.json();
          if (data && data.totalRegistrations !== undefined) {
            liveRegsCount.innerText = `${data.totalRegistrations} مسجل مؤكد`;
          }
          badgeStatus.innerText = ep.label;
          badgeStatus.style.color = '#34D399';
          badgeStatus.style.background = 'rgba(16, 185, 129, 0.15)';
          if (btnOpenInbox) {
            btnOpenInbox.href = ep.web;
          }
          connected = true;
          break;
        }
      } catch (e) {}
    }

    if (!connected) {
      badgeStatus.innerText = '⚠️ في انتظار الاتصال';
      badgeStatus.style.color = '#F59E0B';
      badgeStatus.style.background = 'rgba(245, 158, 11, 0.15)';
      if (btnOpenInbox) {
        btnOpenInbox.href = 'https://batabitoo-mail-2026.web.app';
      }
    }
  }

  checkServer();

  // Save Settings
  saveBtn.addEventListener('click', () => {
    const emailMode = modeOfficial.checked ? 'official' : 'temp';
    const totalRegs = parseInt(totalRegsInput.value, 10);
    const currentIndex = parseInt(currentIndexInput.value, 10);

    if (isNaN(totalRegs) || isNaN(currentIndex)) {
      alert('الرجاء التأكد من صحة الأرقام المدخلة.');
      return;
    }

    chrome.storage.local.set({
      emailMode: emailMode,
      totalRegs: totalRegs,
      currentIndex: currentIndex,
      isRunning: false
    }, () => {
      statusMsg.style.display = 'block';
      setTimeout(() => { statusMsg.style.display = 'none'; }, 2500);
    });
  });
});
