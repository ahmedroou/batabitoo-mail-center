const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const sanitizeHtml = require('sanitize-html');
const { getStorage } = require('firebase-admin/storage');
const parser = require('./EmailParser');

const VERSION = 4;
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const storagePrefix = id => `mail-content/${hash(String(id))}`;
const scalar = value => typeof value === 'string' ? value : Array.isArray(value) ? value.filter(v => typeof v === 'string').join('\n') : '';
const missingText = 'محتوى هذه الرسالة غير متوفر في النسخة المستلمة. لم نحصل على النص أو الصور الأصلية من المصدر.';

function isPdfTruncated(buf) {
  if (!buf || buf.length < 100) return false;
  if (buf.slice(0, 4).toString() !== '%PDF') return false;
  const tail = buf.slice(-1024).toString('latin1');
  const m = tail.match(/startxref\s+(\d+)\s+%%EOF/);
  if (!m) return true;
  const xrefOffset = parseInt(m[1], 10);
  if (xrefOffset >= buf.length) return true;
  return false;
}

async function archive(id, payload) {
  try {
    const bucket = getStorage().bucket();
    const raw = payload.rawBase64 ? Buffer.from(payload.rawBase64, 'base64') : payload.raw ? Buffer.from(payload.raw) : null;
    const source = Buffer.from(JSON.stringify(payload));
    bucket.file(`${storagePrefix(id)}/source-${hash(source)}.json`).save(source, {
      resumable: false,
      metadata: { contentType: 'application/json' }
    }).catch(e => console.error('Archive source error:', e.message));
    if (raw) {
      bucket.file(`${storagePrefix(id)}/original-${hash(raw)}.eml`).save(raw, {
        resumable: false,
        metadata: { contentType: 'message/rfc822' }
      }).catch(e => console.error('Archive raw error:', e.message));
    }
  } catch (e) {
    console.error('Archive error:', e.message);
  }
}

function sanitizeBody(html) {
  return sanitizeHtml(html, {
    allowedTags: [
      ...sanitizeHtml.defaults.allowedTags,
      'img', 'style', 'html', 'head', 'body', 'title', 'center', 'font', 'hr', 'span', 'b', 'i', 'u', 'table', 'tbody', 'thead', 'tr', 'td', 'th'
    ],
    allowedAttributes: {
      '*': ['style', 'class', 'id', 'dir', 'lang', 'align', 'valign', 'width', 'height', 'bgcolor', 'border', 'cellpadding', 'cellspacing', 'color'],
      a: ['href', 'name', 'target', 'rel'],
      img: ['src', 'alt', 'title', 'width', 'height', 'loading'],
      table: ['width', 'height', 'cellpadding', 'cellspacing', 'border', 'align', 'style', 'class', 'bgcolor', 'role'],
      td: ['colspan', 'rowspan', 'width', 'height', 'style', 'align', 'valign', 'bgcolor', 'class'],
      th: ['colspan', 'rowspan', 'width', 'height', 'style', 'align', 'valign', 'bgcolor', 'class'],
      font: ['size', 'face', 'color']
    },
    allowedSchemes: ['https', 'http', 'mailto', 'tel'],
    allowedSchemesByTag: { img: ['https', 'http', 'data'] },
    allowProtocolRelative: true,
    allowVulnerableTags: true,
    transformTags: {
      a: (tag, attrs) => ({ tagName: tag, attribs: { ...attrs, target: '_blank', rel: 'noopener noreferrer', href: (attrs.href || '').replace(/^\/\//, 'https://') } }),
      img: (tag, attrs) => ({ tagName: tag, attribs: { ...attrs, src: (attrs.src || '').replace(/^\/\//, 'https://') } })
    },
    exclusiveFilter: frame => frame.tag === 'img' && /^data:/i.test(frame.attribs.src || '') && !/^data:image\/(?:png|jpeg|jpg|gif|webp);base64,/i.test(frame.attribs.src)
  });
}

async function normalize(payload, id, options = {}) {
  archive(id, payload).catch(e => console.error('Archive defer error:', e?.message));
  let originalHtml = scalar(payload.html || payload['body-html']);
  let text = scalar(payload.text || payload['body-plain'] || payload.body);
  if (payload.bodyStatus === 'unavailable' && !payload.raw && !payload.rawBase64) { originalHtml = ''; text = ''; }
  let decoded = {};

  const raw = payload.rawBase64 ? Buffer.from(payload.rawBase64, 'base64') : payload.raw || (parser.looksLikeMime(text) ? text : null);
  if (raw) {
    decoded = await parser.parseRawEmail(raw);
  }

  if (!originalHtml || parser.looksLikeMime(parser.stripHtmlTags(originalHtml))) {
    originalHtml = decoded.html || '';
  }
  text = decoded.text || text;
  text = parser.stripTransportHeaders(text);

  if (!text && originalHtml) {
    text = parser.stripHtmlTags(originalHtml);
  }

  const attachments = [];
  try {
    let bucket = null;
    try { bucket = getStorage().bucket(); } catch (_) {}
    for (const [index, item] of (decoded.attachments || payload.attachments || []).entries()) {
      const content = Buffer.isBuffer(item.content) ? item.content : item.contentBase64 ? Buffer.from(item.contentBase64, 'base64') : null;
      if (!content) {
        if (item.id || item.filename || item.downloadUrl) {
          attachments.push({
            id: String(item.id || `att-${index + 1}`),
            filename: item.filename || `attachment-${index + 1}`,
            contentType: item.contentType || item.type || 'application/octet-stream',
            size: item.size || 0,
            cid: (item.cid || item.contentId || '').replace(/^<|>$/g, ''),
            inline: item.related === true || item.contentDisposition === 'inline' || item.inline === true,
            downloadUrl: item.downloadUrl || null,
            storagePath: item.storagePath || null
          });
        }
        continue;
      }
      const key = hash(content);
      const storagePath = `${storagePrefix(id)}/attachments/${key}.bin`;
      if (bucket) {
        try {
          await bucket.file(storagePath).save(content, {
            resumable: false,
            metadata: { contentType: item.contentType || 'application/octet-stream' }
          });
        } catch (_) {}
      }
      attachments.push({
        id: key,
        filename: item.filename || `attachment-${index + 1}`,
        contentType: item.contentType || 'application/octet-stream',
        size: content.length,
        cid: (item.cid || item.contentId || '').replace(/^<|>$/g, ''),
        inline: item.related === true || item.contentDisposition === 'inline',
        storagePath
      });
    }
  } catch (e) {
    console.error('Attachment write error:', e.message);
  }

  const available = Boolean(text.trim() || originalHtml.trim() || attachments.length);
  const subject = parser.decodeRfc2047(payload.subject || decoded.subject || '(بدون عنوان)');
  const rawFromCandidate = (decoded.from && !/^[a-f0-9_-]{16,}@/i.test(String(decoded.from)))
    ? decoded.from
    : (payload.from || decoded.from || payload.sender || '');
  const from = parser.cleanSenderName(rawFromCandidate, subject);
  const to = parser.formatAddress(payload.to || payload.recipient || decoded.to || '');
  const otp = available ? parser.extractOtp(text, subject) : null;

  let finalRenderedHtml = '';
  if (originalHtml) {
    finalRenderedHtml = render({ id }, { html: originalHtml, text, attachments });
  } else if (text) {
    finalRenderedHtml = render({ id }, { html: parser.formatPlainTextToHtml(text), text, attachments });
  } else {
    finalRenderedHtml = render({ id }, { html: parser.formatPlainTextToHtml(attachments.length ? 'مرفقات الرسالة' : missingText), text, attachments });
  }

  const cleanIntroText = available ? parser.cleanPlainText(parser.decodeBase64Text(text)) : '';

  return {
    id,
    from: from || '',
    to: to || '',
    subject,
    intro: available ? cleanIntroText.replace(/\s+/g, ' ').slice(0, 140) : 'محتوى الرسالة غير متوفر من المصدر',
    text: text.slice(0, 32000),
    html: finalRenderedHtml,
    attachments,
    otp,
    createdAt: payload.createdAt || decoded.createdAt || new Date().toISOString(),
    originalMessageId: decoded.messageId || payload.originalMessageId || '',
    parserVersion: VERSION,
    bodyStored: true,
    bodyStatus: available ? 'available' : 'unavailable',
    contentComplete: options.complete !== false && available,
    contentKind: originalHtml ? 'html' : available ? 'text' : 'unavailable'
  };
}

function readBody(message) {
  if (message.html) return { html: message.html, text: message.text || '', attachments: message.attachments || [] };
  if (message.text) return { html: parser.formatPlainTextToHtml(message.text), text: message.text, attachments: message.attachments || [] };
  return { html: parser.formatPlainTextToHtml(missingText), text: '', attachments: message.attachments || [] };
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

function render(message, suppliedBody) {
  let html = '';
  let attachments = [];
  try {
    const body = suppliedBody || readBody(message);
    html = body.html || message.html || '';
    attachments = body.attachments || message.attachments || [];
  } catch {
    html = message.html || '';
    attachments = message.attachments || [];
  }

  let rawText = '';
  try { rawText = (suppliedBody || readBody(message)).text || message.text || ''; } catch { rawText = message.text || ''; }
  const cleanText = parser.cleanPlainText(rawText);

  // If HTML is empty OR has no visible text/elements, fallback to clean text
  if (!hasVisibleContent(html) && cleanText) {
    html = parser.formatPlainTextToHtml(cleanText);
  }
  if (!hasVisibleContent(html)) {
    html = parser.formatPlainTextToHtml(missingText);
  }

  // If already rendered into our complete document template, avoid double wrapping
  if (typeof html === 'string' && /^\s*<!doctype\s+html/i.test(html) && html.includes('id="mail-root"')) {
    for (const item of attachments) {
      if (!item.cid || !/^image\/(?:png|jpeg|jpg|gif|webp)$/i.test(item.contentType)) continue;
      const cid = item.cid.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      html = html.replace(new RegExp(`cid:${cid}`, 'gi'), `/api/messages/${encodeURIComponent(message.id)}/attachments/${item.id}`);
    }
    return html;
  }

  // Replace cid images with authenticated same-origin Firebase Storage proxies.
  for (const item of attachments) {
    if (!item.cid || !/^image\/(?:png|jpeg|jpg|gif|webp)$/i.test(item.contentType)) continue;
    const cid = item.cid.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    html = html.replace(new RegExp(`cid:${cid}`, 'gi'), `/api/messages/${encodeURIComponent(message.id)}/attachments/${item.id}`);
  }

  // Preserve the sender's body direction/styles without nesting full documents.
  const safe = sanitizeBody(html).replace(/<\/?(?:html|head)[^>]*>/gi, '').replace(/<body\b([^>]*)>/gi, '<div$1>').replace(/<\/body>/gi, '</div>');

  return `<!doctype html>
<html dir="auto">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <meta name="referrer" content="no-referrer">
  <meta http-equiv="Content-Security-Policy" content="default-src 'self' 'unsafe-inline' https: http: data: blob:; img-src * data: blob:; style-src * 'unsafe-inline'; font-src * data:;">
  <style>
    *, *::before, *::after { box-sizing: border-box; }
    html, body {
      margin: 0;
      padding: 0;
      background: #ffffff;
      color: #1a202c;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Cairo", Helvetica, Arial, sans-serif;
      font-size: 15px;
      line-height: 1.65;
      -webkit-text-size-adjust: 100%;
      text-size-adjust: 100%;
      overflow-wrap: break-word;
    }
    body {
      padding: 14px 16px;
    }
    img {
      max-width: 100% !important;
      height: auto !important;
      display: inline-block;
      vertical-align: middle;
    }
    table {
      max-width: 100% !important;
      border-collapse: collapse;
    }
    a {
      color: #2563eb;
      text-decoration: underline;
    }
    pre, code {
      white-space: pre-wrap;
      word-break: break-word;
      font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
    }
    #mail-root {
      width: 100%;
      max-width: 860px;
      margin: 0 auto;
    }
    @media (max-width: 600px) {
      body { padding: 10px 12px; font-size: 14px; }
      #mail-root { max-width: 100%; }
    }
  </style>
</head>
<body dir="auto">
  <div id="mail-root">${safe}</div>
</body>
</html>`;
}

function summary(message) {
  const { raw, rawBase64, html, text, ...rest } = message;
  return { ...rest, html: '', text: '' };
}

function detail(message) {
  const rendered = render(message);
  let rawText = '';
  try { rawText = readBody(message).text || message.text || ''; } catch { rawText = message.text || ''; }
  const cleanText = parser.cleanPlainText(rawText);
  return {
    ...summary(message),
    html: rendered,
    text: cleanText
  };
}

async function attachment(message, id) {
  if (!message) return null;
  const list = (message.attachments || readBody(message).attachments || []);
  const meta = list.find(item => String(item.id) === String(id) || item.filename === id);
  if (!meta) return null;

  // Prefer the durable cloud copy. Local ticket paths from legacy imports are
  // not available on Cloud Run and must not be treated as authoritative bytes.
  if (meta.storagePath) {
    try {
      const [content] = await getStorage().bucket().file(meta.storagePath).download();
      if (content && !isPdfTruncated(content)) {
        return { ...meta, content };
      }
    } catch (_) {}
  }

  // 1. If downloadedPdf file path is set and exists
  const legacyRoot = path.resolve(__dirname, '..', 'dazzling-oppenheimer', 'downloaded_tickets_pdf');
  const legacyFile = message.downloadedPdf && path.resolve(message.downloadedPdf);
  if (legacyFile && legacyFile.startsWith(legacyRoot + path.sep) && list.filter(item => /\.pdf$/i.test(item.filename || '')).length === 1 && /\.pdf$/i.test(meta.filename || '') && fs.existsSync(legacyFile)) {
    try {
      const content = fs.readFileSync(message.downloadedPdf);
      if (content && !isPdfTruncated(content)) {
        return {
          id: meta?.id || id,
          filename: meta?.filename || path.basename(message.downloadedPdf),
          contentType: meta?.contentType || 'application/pdf',
          size: content.length,
          inline: false,
          content
        };
      }
    } catch (_) {}
  }

  // 2. Check local downloaded tickets directory
  const localDirs = [
    path.join(__dirname, 'downloads'),
    path.join(__dirname, '..', 'dazzling-oppenheimer', 'downloaded_tickets_pdf'),
    path.join(__dirname, 'downloaded_tickets_pdf')
  ];
  for (const dir of localDirs) {
    if (!fs.existsSync(dir)) continue;
    // Check if any pdf file in directory corresponds to this message or winner
    if (meta?.filename && path.basename(meta.filename) === meta.filename && !meta.filename.includes('\\')) {
      const candidate = path.join(dir, meta.filename);
      if (fs.existsSync(candidate)) {
        try {
          const content = fs.readFileSync(candidate);
          if (content && !isPdfTruncated(content)) {
            return { ...meta, size: content.length, content };
          }
        } catch (_) {}
      }
    }
  }

  // 3. If storagePath exists in Firebase Storage
  if (meta?.storagePath) {
    try {
      const [content] = await getStorage().bucket().file(meta.storagePath).download();
      if (content && !isPdfTruncated(content)) {
        return { ...meta, content };
      }
    } catch (_) {}
  }

  return meta || null;
}

function recoverSource(message) {
  return message;
}

async function purge(messageId) {
  if (!messageId) return false;
  try {
    await getStorage().bucket().deleteFiles({ prefix: `${storagePrefix(messageId)}/` });
    return true;
  } catch (e) {
    console.error(`Purge error for message ${messageId}:`, e.message);
  }
  return false;
}

function purgeOrphans(validMessageIds = []) {
  return { cleanedCount: 0, freedBytes: 0 };
}

function pruneRawFiles(maxAgeDays = 3) {
  return { prunedCount: 0, freedBytes: 0 };
}

function cleanupBackups(keepLast = 3) {
  return { deletedCount: 0, freedBytes: 0 };
}

function getStorageStats() {
  return {
    totalBytes: 0,
    totalMegabytes: '0.00',
    messageDirs: 0,
    storage: 'firebase'
  };
}

module.exports = {
  normalize,
  archive,
  render,
  summary,
  detail,
  attachment,
  recoverSource,
  purge,
  purgeOrphans,
  pruneRawFiles,
  cleanupBackups,
  getStorageStats,
  VERSION,
  sanitizeBody
};
