const { simpleParser } = require('mailparser');
const iconv = require('iconv-lite');
const sanitizeHtml = require('sanitize-html');

const escape = value => String(value || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const normalizeArabicDigits = value => String(value || '').replace(/[٠-٩]/g, c => String('٠١٢٣٤٥٦٧٨٩'.indexOf(c)));
const decodeBuffer = (buffer, charset = 'utf-8') => iconv.decode(buffer, iconv.encodingExists(charset) ? charset : 'utf-8');

function decodeQuotedPrintable(value, charset = 'utf-8') {
  const pieces = String(value || '').replace(/=\r?\n/g, '').split(/(=[0-9a-f]{2})/gi);
  return decodeBuffer(Buffer.concat(pieces.map(p => /^=[0-9a-f]{2}$/i.test(p) ? Buffer.from([parseInt(p.slice(1), 16)]) : Buffer.from(p, 'utf8'))), charset);
}

function decodeBase64(value, charset = 'utf-8') {
  return decodeBuffer(Buffer.from(String(value || '').replace(/\s/g, ''), 'base64'), charset);
}

function decodeRfc2047(value) {
  if (!value) return '';
  if (typeof value !== 'string') return formatAddress(value);
  if (value === '[object Object]' || value === '[object object]') return '';
  return String(value)
    .replace(/(\?=)\s+(?==\?)/g, '$1')
    .replace(/=\?([^?]+)\?([BQ])\?([^?]*)\?=/gi, (_, charset, encoding, content) =>
      encoding.toUpperCase() === 'B' ? decodeBase64(content, charset) : decodeQuotedPrintable(content.replace(/_/g, ' '), charset)
    );
}

function formatAddress(val) {
  if (!val) return '';
  if (typeof val === 'string') {
    if (val === '[object Object]' || val === '[object object]') return '';
    return decodeRfc2047(val);
  }
  if (Array.isArray(val)) return val.map(formatAddress).filter(Boolean).join(', ');
  if (typeof val === 'object') {
    if (val.text && typeof val.text === 'string') return decodeRfc2047(val.text);
    const addr = val.address || val.email || '';
    const name = decodeRfc2047(val.name || '');
    if (name && addr && name !== addr) return `${name} <${addr}>`;
    return addr || name;
  }
  return String(val);
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

function stripHtmlTags(html) {
  return sanitizeHtml(String(html || '').replace(/<\/(?:p|div|tr|h[1-6])\s*>|<br\s*\/?\s*>/gi, '\n'), {
    allowedTags: [],
    allowedAttributes: {}
  })
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function looksLikeMime(value) {
  const str = String(value || '');
  return /^(?:Content-(?:Type|Transfer-Encoding|Disposition)|MIME-Version|Received|DKIM-Signature|X-AMAZON-[\w-]+|X-SES-[\w-]+|Bounces-to|Feedback-ID|Return-Path|Message-ID):/im.test(str)
    || /^\s*boundary\s*=/im.test(str)
    || /^--[a-zA-Z0-9_\-\.\=\+]+/m.test(str);
}

function isHeaderLine(line) {
  return /^(?:Feedback-ID|X-SES-[\w-]+|X-AMAZON-[\w-]+|Received|DKIM-Signature|ARC-[\w-]+|Authentication-Results|MIME-Version|Content-Type|Content-Transfer-Encoding|Content-Disposition|boundary|Return-Path|Message-ID|Delivered-To|Received-SPF):/i.test(line.trim())
    || /^\s+[^\s]+/.test(line); // Multi-line header continuation
}

function stripTransportHeaders(str) {
  if (!str || typeof str !== 'string') return '';
  let cleaned = str.replace(/\r\n/g, '\n');

  // If text starts with headers, strip the initial header block
  if (/^(?:Feedback-ID|X-SES-|X-AMAZON-|Received|DKIM-|ARC-|MIME-|Content-Type:|Message-ID:|Return-Path:|Delivered-To:)/i.test(cleaned.trimStart())) {
    const lines = cleaned.split('\n');
    let inHeader = true;
    const bodyLines = [];
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (inHeader) {
        if (line.trim() === '' || /^--[^\n]+/.test(line)) {
          inHeader = false;
        } else if (!isHeaderLine(line) && i > 0) {
          inHeader = false;
          bodyLines.push(line);
        }
      } else {
        bodyLines.push(line);
      }
    }
    cleaned = bodyLines.join('\n');
  }

  // Strip boundary markers
  cleaned = cleaned.replace(/^--[a-zA-Z0-9_\-\.\=\+]+(?:--)?\s*$/gm, '');
  // Strip inline leftover MIME headers
  cleaned = cleaned.replace(/^(?:Content-(?:Type|Transfer-Encoding|Disposition)|boundary)\s*:[^\n]*/gim, '');
  cleaned = cleaned.replace(/^charset\s*=[^\n]*/gim, '');

  return cleaned.replace(/\n{3,}/g, '\n\n').trim();
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
    const decoded = Buffer.from(bytes).toString('utf8');
    if (decoded && !decoded.includes('\uFFFD') && /[\u0600-\u06FF]/.test(decoded)) return decoded;
  } catch (_) {}
  return str;
}

function decodeBase64Text(str) {
  if (!str || typeof str !== 'string') return '';
  const trimmed = str.trim();
  if (/\b[a-zA-Z]{1,15}\s+[a-zA-Z]{1,15}\s+[a-zA-Z]{1,15}\b/.test(trimmed)) return str;
  const stripped = trimmed.replace(/\s+/g, '');
  if (stripped.length < 16 || stripped.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(stripped)) {
    return str;
  }
  try {
    const decoded = Buffer.from(stripped, 'base64').toString('utf8');
    if (decoded && !decoded.includes('\uFFFD') && !/[\x00-\x08\x0B\x0C\x0E-\x1F]/.test(decoded)) {
      if (/[\u0600-\u06FF]{2,}/.test(decoded) || (/[a-zA-Z]{3,}/.test(decoded) && /\s/.test(decoded))) {
        return decoded;
      }
    }
  } catch (e) {}
  return str;
}

function cleanPlainText(value) {
  if (!value || typeof value !== 'string') return '';
  let text = value.replace(/\r\n/g, '\n');
  text = fixMojibake(text);
  if (text.includes('=D8=') || text.includes('=D9=') || (text.includes('=\n') && text.includes('='))) {
    text = decodeQuotedPrintable(text);
  }
  text = decodeBase64Text(text);
  text = fixMojibake(text);
  text = stripTransportHeaders(text);
  return text.replace(/\n{3,}/g, '\n\n').trim();
}

function extractOtp(text, secondArg, thirdArg) {
  let subject = '';
  let html = '';
  let body = String(text || '');

  if (thirdArg !== undefined) {
    // 3 arguments provided: extractOtp(text, html, subject)
    html = secondArg || '';
    subject = thirdArg || '';
  } else if (secondArg !== undefined) {
    // 2 arguments provided: extractOtp(text, subject) or extractOtp(text, html)
    if (typeof secondArg === 'string' && (/<[a-z][\s\S]*>/i.test(secondArg) || /<!DOCTYPE|<html>|<div|<p|<span|<br/i.test(secondArg))) {
      html = secondArg;
      subject = '';
    } else {
      subject = secondArg || '';
    }
  }

  let htmlText = '';
  if (html && typeof html === 'string') {
    htmlText = stripHtmlTags(html);
  }

  const input = normalizeArabicDigits(`${subject || ''}\n${body || ''}\n${htmlText || ''}`);
  
  // 1. Specific keywords in Arabic & English
  const match = input.match(/(?:رمز\s*(?:التحقق|التأكيد|التفعيل|الدخول|الأمان|المرور)|كود\s*(?:التحقق|التأكيد|التفعيل|الدخول)|verification\s*code|security\s*code|one-time\s*(?:password|code)|\botp\b|your\s*code|access\s*code|password\s*reset\s*code|\bcode\b)[^\d\n]{0,60}[\s:=-]*([0-9]{4,8})\b/i);
  if (match) return match[1];

  // 2. Standalone digits on dedicated lines
  const lines = input.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (/^[0-9]{4,8}$/.test(trimmed)) {
      return trimmed;
    }
  }

  // 3. Formats like 123-456 or 123 456
  const hyphenated = input.match(/(?:code|otp|رمز|كود)[^\d\n]{0,30}([0-9]{3}[\s-][0-9]{3})/i);
  if (hyphenated) return hyphenated[1].replace(/[\s-]/g, '');

  return null;
}

function formatPlainTextToHtml(rawText) {
  const text = cleanPlainText(rawText);
  let safe = escape(text);

  // Convert "Action Title (https://...)" into handsome action buttons
  const actionRegex = /([^()\n]{2,40})\s*\((https?:\/\/[^\s)]+)\)/g;
  safe = safe.replace(actionRegex, (_, label, url) => {
    const isDanger = /إلغاء|حظر|حذف|إغلاق|delete|cancel|close/i.test(label);
    const bg = isDanger ? '#ef4444' : '#ff9900';
    const color = isDanger ? '#ffffff' : '#111827';
    return `<div style="margin: 12px 0;"><a href="${url}" target="_blank" rel="noopener noreferrer" style="display: inline-block; padding: 10px 20px; background: ${bg}; color: ${color}; font-weight: bold; text-decoration: none; border-radius: 10px; font-size: 14px;">${label.trim()}</a></div>`;
  });

  // Auto-link remaining bare URLs
  safe = safe.replace(/(^|[^"'])(https?:\/\/[^\s<)]+)/g, '$1<a href="$2" target="_blank" rel="noopener noreferrer" style="color: #2563eb; text-decoration: underline; word-break: break-all;">$2</a>');

  return `<div dir="auto" style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Cairo', Helvetica, Arial, sans-serif; font-size: 15px; line-height: 1.8; color: #182032; white-space: pre-wrap; overflow-wrap: anywhere; padding: 20px 16px;">${safe}</div>`;
}

async function parseRawEmail(raw) {
  if (!raw) {
    return { subject: '', from: '', to: '', text: '', html: '', messageId: '', createdAt: new Date().toISOString(), attachments: [], otp: null };
  }
  try {
    const mail = await simpleParser(raw, {
      skipHtmlToText: false,
      skipTextToHtml: true,
      keepCidLinks: true,
      maxHtmlLengthToParse: 16 * 1024 * 1024
    });

    const fromStr = formatAddress(mail.from);
    const toStr = formatAddress(mail.to);
    const subjectStr = decodeRfc2047(mail.subject || '');
    let text = cleanPlainText(mail.text || '');
    let html = typeof mail.html === 'string' ? mail.html : '';

    if (!text && html) {
      text = stripHtmlTags(html);
    }
    if (!text && !html) {
      const rawStr = typeof raw === 'string' ? raw : raw.toString('utf8');
      const bodyPart = rawStr.split(/\r?\n\r?\n/).slice(1).join('\n\n');
      if (bodyPart) {
        text = cleanPlainText(bodyPart);
      }
    }
    if (!html && text) {
      html = formatPlainTextToHtml(text);
    }

    const otp = extractOtp(text, subjectStr);

    return {
      subject: subjectStr,
      from: fromStr,
      to: toStr,
      text: text,
      html: html,
      messageId: mail.messageId || '',
      createdAt: mail.date ? mail.date.toISOString() : new Date().toISOString(),
      attachments: mail.attachments || [],
      otp: otp
    };
  } catch (err) {
    console.error('parseRawEmail error:', err.message);
    const rawStr = typeof raw === 'string' ? raw : raw.toString('utf8');
    const text = cleanPlainText(rawStr);
    const subject = decodeRfc2047(text.slice(0, 80));
    return {
      subject: subject || '(بدون عنوان)',
      from: '',
      to: '',
      text: text,
      html: formatPlainTextToHtml(text),
      messageId: '',
      createdAt: new Date().toISOString(),
      attachments: [],
      otp: extractOtp(text, subject)
    };
  }
}

module.exports = {
  parseRawEmail,
  decodeRfc2047,
  decodeQuotedPrintable,
  decodeBase64,
  normalizeArabicDigits,
  extractOtp,
  cleanPlainText,
  stripTransportHeaders,
  stripHtmlTags,
  formatPlainTextToHtml,
  decodeBase64Text,
  formatAddress,
  cleanSenderName,
  looksLikeMime,
  fixMojibake,
  escape
};

