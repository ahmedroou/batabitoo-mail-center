const challenge = new URLSearchParams(location.hash.slice(1)).get('challenge');
const status = document.querySelector('#status');
const button = document.querySelector('#approve');
if (!/^[A-Za-z0-9_-]{43}$/.test(challenge || '')) { button.hidden = true; status.textContent = 'ابدأ الاتصال من تطبيق الجوال.'; }
button.onclick = async () => {
  button.disabled = true;
  try {
    const token = localStorage.getItem('batabitoo_session_token');
    const response = await fetch('/api/mobile/approve', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify({ challenge }) });
    if (response.status === 401) {
      status.textContent = 'جلسة الويب غير مفتوحة. افتحها أولًا ثم عد لهذه الصفحة لاعتماد الجوال.';
      document.querySelector('#login').hidden = false;
      return;
    }
    if (!response.ok) throw new Error();
    const result = await response.json();
    location.href = `batabitoomail://connect?code=${encodeURIComponent(result.code)}`;
    status.textContent = 'تم الاعتماد. يمكنك العودة للتطبيق.';
  } catch { status.textContent = 'تعذر الاتصال. حاول مجددًا.'; }
  finally { button.disabled = false; }
};
