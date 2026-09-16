const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const sanitizeHtml = require('sanitize-html');
const parser = require('./EmailParser');

const ROOT = path.resolve(process.env.MAIL_DATA_DIR || path.join(__dirname, 'private', 'mail'));
const VERSION = 4;
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const directory = id => path.join(ROOT, hash(String(id)));
const scalar = value => typeof value === 'string' ? value : Array.isArray(value) ? value.filter(v => typeof v === 'string').join('\n') : '';
const missingText = 'محتوى هذه الرسالة غير متوفر في النسخة المستلمة. لم نحصل على النص أو الصور الأصلية من المصدر.';

function archive(id, payload) {
  try {
    const dir = directory(id);
    fs.mkdirSync(dir, { recursive: true });
    const raw = payload.rawBase64 ? Buffer.from(payload.rawBase64, 'base64') : payload.raw ? Buffer.from(payload.raw) : null;
    const source = Buffer.from(JSON.stringify(payload));
    const filename = `source-${hash(source)}.json`;
    if (!fs.existsSync(path.join(dir, filename))) fs.writeFileSync(path.join(dir, filename), source);
    if (raw) {
      const rawPath = path.join(dir, `original-${hash(raw)}.eml`);
      if (!fs.existsSync(rawPath)) fs.writeFileSync(rawPath, raw);
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
  archive(id, payload);
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

  const dir = directory(id);
  const attachments = [];
  try {
    fs.mkdirSync(dir, { recursive: true });
    for (const [index, item] of (decoded.attachments || payload.attachments || []).entries()) {
      const content = Buffer.isBuffer(item.content) ? item.content : item.contentBase64 ? Buffer.from(item.contentBase64, 'base64') : null;
      if (!content) continue;
      const key = hash(content);
      fs.writeFileSync(path.join(dir, `${key}.bin`), content);
      attachments.push({
        id: key,
        filename: item.filename || `attachment-${index + 1}`,
        contentType: item.contentType || 'application/octet-stream',
        size: content.length,
        cid: (item.cid || item.contentId || '').replace(/^<|>$/g, ''),
        inline: item.related === true || item.contentDisposition === 'inline'
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

  try {
    const document = { html: originalHtml || parser.formatPlainTextToHtml(text || (attachments.length ? 'مرفقات الرسالة' : missingText)), text, attachments, originalHtml: Boolean(originalHtml) };
    fs.writeFileSync(path.join(dir, 'body.json'), JSON.stringify(document));
  } catch (e) {}

  return {
    id,
    from: from || '',
    to: to || '',
    subject,
    intro: available ? text.replace(/\s+/g, ' ').slice(0, 140) : 'محتوى الرسالة غير متوفر من المصدر',
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
  try {
    return JSON.parse(fs.readFileSync(path.join(directory(message.id), 'body.json'), 'utf8'));
  } catch {
    if (message.html) return { html: message.html, text: message.text || '', attachments: message.attachments || [] };
    if (message.text) return { html: parser.formatPlainTextToHtml(message.text), text: message.text, attachments: [] };
    return { html: parser.formatPlainTextToHtml(missingText), text: '', attachments: [] };
  }
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

  // Replace cid: images with base64 data URLs if found on disk
  for (const item of attachments) {
    if (!item.cid || !/^image\/(?:png|jpeg|jpg|gif|webp)$/i.test(item.contentType)) continue;
    try {
      const binFile = path.join(directory(message.id), `${item.id}.bin`);
      if (fs.existsSync(binFile)) {
        const content = fs.readFileSync(binFile);
        const cid = item.cid.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        html = html.replace(new RegExp(`cid:${cid}`, 'gi'), `data:${item.contentType || 'image/png'};base64,${content.toString('base64')}`);
      }
    } catch (e) {}
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

function attachment(message, id) {
  if (!/^[a-f0-9]{64}$/.test(id)) return null;
  const meta = readBody(message).attachments.find(item => item.id === id);
  if (!meta) return null;
  return { ...meta, content: fs.readFileSync(path.join(directory(message.id), `${id}.bin`)) };
}

function recoverSource(message) {
  const dir = directory(message.id);
  if (!fs.existsSync(dir)) return message;
  const originals = fs.readdirSync(dir).filter(name => /^original-[a-f0-9]+\.eml$/.test(name));
  if (originals.length) {
    originals.sort((a, b) => fs.statSync(path.join(dir, b)).size - fs.statSync(path.join(dir, a)).size);
    return { ...message, html: '', text: '', rawBase64: fs.readFileSync(path.join(dir, originals[0])).toString('base64') };
  }
  const body = readBody(message);
  return { ...message, html: body.html, text: body.text, attachments: body.attachments.map(item => ({ ...item, contentBase64: fs.existsSync(path.join(dir, `${item.id}.bin`)) ? fs.readFileSync(path.join(dir, `${item.id}.bin`)).toString('base64') : undefined })) };
}

function purge(messageId) {
  if (!messageId) return false;
  try {
    const dir = directory(messageId);
    if (fs.existsSync(dir)) {
      fs.rmSync(dir, { recursive: true, force: true });
      return true;
    }
  } catch (e) {
    console.error(`Purge error for message ${messageId}:`, e.message);
  }
  return false;
}

function getDirSize(dirPath) {
  let size = 0;
  try {
    const files = fs.readdirSync(dirPath, { withFileTypes: true });
    for (const f of files) {
      const full = path.join(dirPath, f.name);
      if (f.isDirectory()) size += getDirSize(full);
      else if (f.isFile()) size += fs.statSync(full).size;
    }
  } catch (e) {}
  return size;
}

function purgeOrphans(validMessageIds = []) {
  let cleanedCount = 0;
  let freedBytes = 0;
  try {
    if (!fs.existsSync(ROOT)) return { cleanedCount, freedBytes };
    const idList = Array.isArray(validMessageIds) ? validMessageIds : Array.from(validMessageIds || []);
    const validHashes = new Set(idList.map(id => hash(String(id))));
    const entries = fs.readdirSync(ROOT, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (entry.name === 'backups') continue;
      if (!validHashes.has(entry.name)) {
        const fullPath = path.join(ROOT, entry.name);
        try {
          const stats = getDirSize(fullPath);
          freedBytes += stats;
          fs.rmSync(fullPath, { recursive: true, force: true });
          cleanedCount++;
        } catch (err) {}
      }
    }
  } catch (e) {
    console.error('purgeOrphans error:', e.message);
  }
  return { cleanedCount, freedBytes };
}

function pruneRawFiles(maxAgeDays = 3) {
  let prunedCount = 0;
  let freedBytes = 0;
  const cutoffTime = Date.now() - (maxAgeDays * 24 * 60 * 60 * 1000);
  try {
    if (!fs.existsSync(ROOT)) return { prunedCount, freedBytes };
    const dirs = fs.readdirSync(ROOT, { withFileTypes: true }).filter(d => d.isDirectory() && d.name !== 'backups');
    for (const d of dirs) {
      const dirPath = path.join(ROOT, d.name);
      const hasBody = fs.existsSync(path.join(dirPath, 'body.json'));
      if (!hasBody) continue;
      const files = fs.readdirSync(dirPath);
      for (const file of files) {
        if (/^original-[a-f0-9]+\.eml$/.test(file) || /^source-[a-f0-9]+\.json$/.test(file)) {
          const filePath = path.join(dirPath, file);
          const stat = fs.statSync(filePath);
          if (stat.mtimeMs < cutoffTime) {
            freedBytes += stat.size;
            fs.unlinkSync(filePath);
            prunedCount++;
          }
        }
      }
    }
  } catch (e) {
    console.error('pruneRawFiles error:', e.message);
  }
  return { prunedCount, freedBytes };
}

function cleanupBackups(keepLast = 3) {
  let deletedCount = 0;
  let freedBytes = 0;
  const backupDir = path.join(ROOT, 'backups');
  try {
    if (!fs.existsSync(backupDir)) return { deletedCount, freedBytes };
    const files = fs.readdirSync(backupDir).filter(f => /^messages-\d+\.json$/.test(f));
    if (files.length > keepLast) {
      files.sort((a, b) => {
        const timeA = parseInt(a.replace('messages-', '').replace('.json', ''), 10) || 0;
        const timeB = parseInt(b.replace('messages-', '').replace('.json', ''), 10) || 0;
        return timeB - timeA;
      });
      const toDelete = files.slice(keepLast);
      for (const f of toDelete) {
        const p = path.join(backupDir, f);
        freedBytes += fs.statSync(p).size;
        fs.unlinkSync(p);
        deletedCount++;
      }
    }
  } catch (e) {
    console.error('cleanupBackups error:', e.message);
  }
  return { deletedCount, freedBytes };
}

function getStorageStats() {
  let totalBytes = 0;
  let messageDirs = 0;
  try {
    if (fs.existsSync(ROOT)) {
      const entries = fs.readdirSync(ROOT, { withFileTypes: true });
      for (const entry of entries) {
        const full = path.join(ROOT, entry.name);
        if (entry.isDirectory()) {
          if (entry.name !== 'backups') messageDirs++;
          totalBytes += getDirSize(full);
        } else if (entry.isFile()) {
          totalBytes += fs.statSync(full).size;
        }
      }
    }
  } catch (e) {}
  return {
    totalBytes,
    totalMegabytes: (totalBytes / (1024 * 1024)).toFixed(2),
    messageDirs,
    rootPath: ROOT
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
  ROOT,
  VERSION,
  sanitizeBody
};
