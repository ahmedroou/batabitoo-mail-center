'use strict';

(() => {
  const el = id => document.getElementById(id);
  const drafts = new Map();
  const savedKey = 'batabitoo_reply_before_oauth';
  let currentId = null;
  let generation = 0;
  function draft(id) {
    if (!drafts.has(id)) {
      let saved = null;
      try { saved = JSON.parse(sessionStorage.getItem(savedKey)); } catch {}
      drafts.set(id, { text: saved?.id === id ? saved.text : '', requestId: saved?.id === id ? saved.requestId : crypto.randomUUID(), busy: false, context: null, locked: false, status: '' });
      if (saved?.id === id) sessionStorage.removeItem(savedKey);
    }
    return drafts.get(id);
  }
  function render(d) {
    el('reply-text').value = d.text;
    el('reply-text').disabled = d.busy || d.locked || !d.context;
    el('reply-status').textContent = d.status;
    el('reply-envelope').textContent = d.context ? `من: ${d.context.from}\nإلى: ${d.context.to}\n${d.context.subject}` : '';
    el('reply-send').disabled = d.busy || d.locked || !d.context || !d.text.trim();
    el('reply-send').textContent = d.busy ? 'جارٍ الإرسال…' : 'إرسال الرد';
  }
  function reset() {
    ++generation;
    currentId = null;
    el('reader-reply-form').classList.add('hidden');
  }
  async function open() {
    const id = state.currentMessage?.id;
    if (!id) return;
    currentId = id;
    const gen = ++generation;
    const d = draft(id);
    el('reader-reply-form').classList.remove('hidden');
    el('reply-reconnect').classList.add('hidden');
    if (!d.context && !d.busy) {
      d.status = 'جارٍ التحقق من حساب الإرسال…';
      render(d);
      try { d.context = await api(`/api/messages/${encodeURIComponent(id)}/reply`, { timeoutMs: 45000 }); d.status = ''; }
      catch (error) {
        d.status = error.message;
        if (gen === generation) el('reply-reconnect').classList.toggle('hidden', error.code !== 'GMAIL_RECONNECT_REQUIRED');
      }
    }
    if (gen !== generation || currentId !== id) return;
    render(d);
    el('reader-reply-form').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    if (d.context && !d.locked && !d.busy) el('reply-text').focus({ preventScroll: true });
  }
  el('reader-reply-btn').addEventListener('click', open);
  el('reply-cancel').addEventListener('click', reset);
  el('reply-text').addEventListener('input', () => {
    if (!currentId) return;
    const d = draft(currentId);
    d.text = el('reply-text').value;
    render(d);
  });
  el('reply-reconnect').addEventListener('click', async () => {
    try {
      const data = await api('/api/gmail/oauth/auth-url');
      if (currentId) {
        const d = draft(currentId);
        sessionStorage.setItem(savedKey, JSON.stringify({ id: currentId, text: d.text, requestId: d.requestId }));
      }
      window.location.assign(data.authUrl);
    } catch (error) { el('reply-status').textContent = error.message; }
  });
  el('reader-reply-form').addEventListener('submit', async event => {
    event.preventDefault();
    const id = currentId;
    if (!id) return;
    const d = draft(id);
    if (d.busy || d.locked || !d.context || !d.text.trim()) return;
    d.busy = true;
    d.status = 'جارٍ إرسال الرد…';
    render(d);
    try {
      const sent = await api(`/api/messages/${encodeURIComponent(id)}/reply`, { method: 'POST', timeoutMs: 90000,
        body: JSON.stringify({ text: d.text, requestId: d.requestId, from: d.context.from, to: d.context.to }) });
      if (!sent.success) throw new Error('تعذر تأكيد الإرسال');
      d.text = '';
      d.requestId = crypto.randomUUID();
      d.status = `تم إرسال الرد من ${sent.from}`;
      toast(d.status);
    } catch (error) {
      d.status = error.message;
      // Retain draft and request ID; do not retry an uncertain send as a new reply.
      if (error.code === 'REPLY_SEND_UNCERTAIN' || !error.status) {
        d.locked = true;
        d.status = 'تعذر تأكيد نتيجة الإرسال. تحقق من «المرسلة» في Gmail قبل إرسال رد جديد.';
      }
      if (currentId === id) el('reply-reconnect').classList.toggle('hidden', error.code !== 'GMAIL_RECONNECT_REQUIRED');
    } finally {
      d.busy = false;
      if (currentId === id) render(d);
    }
  });
  window.mailReply = { reset };
})();
