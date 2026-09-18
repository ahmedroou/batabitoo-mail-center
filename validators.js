// Centralized Schema Validators for Batabitoo Mail Center
// Strict validation rejecting missing, malformed, or hostile inputs

function isNonEmptyString(val, maxLength = 1000) {
  return typeof val === 'string' && val.trim().length > 0 && val.length <= maxLength;
}

function isValidEmail(email) {
  if (!isNonEmptyString(email, 255)) return false;
  return /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(email.trim());
}

function isValidHttpsUrl(urlStr) {
  if (!isNonEmptyString(urlStr, 2048)) return false;
  try {
    const parsed = new URL(urlStr);
    return parsed.protocol === 'https:';
  } catch (_) {
    return false;
  }
}

function isValidSha256(hashStr) {
  if (!hashStr) return true; // Optional field
  return /^[a-fA-F0-9]{64}$/.test(String(hashStr).trim());
}

function validateLoginPayload(body) {
  if (!body || typeof body !== 'object') {
    return { valid: false, error: 'بيانات الطلب غير صالحة (JSON مطلوب).' };
  }
  const pin = body.pin || body.password;
  if (!isNonEmptyString(pin, 128)) {
    return { valid: false, error: 'رمز الأمان مطلوب ويجب أن يكون نصاً صالحاً.' };
  }
  return { valid: true, data: { pin: pin.trim() } };
}

function validateAppVersionPayload(body) {
  if (!body || typeof body !== 'object') {
    return { valid: false, error: 'بيانات التحديث غير صالحة.' };
  }

  const code = Number(body.latestVersionCode);
  if (!Number.isInteger(code) || code < 1) {
    return { valid: false, error: 'رقم الإصدار (latestVersionCode) يجب أن يكون رقماً صحيحاً موجباً.' };
  }

  if (!isNonEmptyString(body.latestVersionName, 32)) {
    return { valid: false, error: 'اسم الإصدار (latestVersionName) مطلوب ويجب ألا يتجاوز 32 حرفاً.' };
  }

  if (!isValidHttpsUrl(body.downloadUrl)) {
    return { valid: false, error: 'رابط التحميل (downloadUrl) يجب أن يكون رابط HTTPS صالحاً.' };
  }

  if (body.sha256 && !isValidSha256(body.sha256)) {
    return { valid: false, error: 'قيمة sha256 غير صالحة (يجب أن تكون 64 خانة Hexadecimal).' };
  }

  return {
    valid: true,
    data: {
      latestVersionCode: code,
      latestVersionName: String(body.latestVersionName).trim(),
      downloadUrl: String(body.downloadUrl).trim(),
      sha256: body.sha256 ? String(body.sha256).trim().toLowerCase() : '',
      releaseNotes: String(body.releaseNotes || '').slice(0, 1000),
      mandatory: Boolean(body.mandatory)
    }
  };
}

function validateOfficialCreatePayload(body) {
  if (!body || typeof body !== 'object') {
    return { valid: false, error: 'بيانات الحساب غير صالحة.' };
  }

  const email = String(body.email || '').trim().toLowerCase();
  if (!isValidEmail(email)) {
    return { valid: false, error: 'البريد الإلكتروني غير صالح.' };
  }

  if (!email.endsWith('@batabitoo.com') && !email.endsWith('@gmail.com')) {
    return { valid: false, error: 'الحساب الرسمي يجب أن ينتهي بنطاق @batabitoo.com أو @gmail.com.' };
  }

  return {
    valid: true,
    data: {
      email,
      password: body.password ? String(body.password).slice(0, 256) : null,
      label: body.label ? String(body.label).slice(0, 100) : email.split('@')[0],
      personName: body.personName ? String(body.personName).slice(0, 100) : email.split('@')[0]
    }
  };
}

function validateBanStatusPayload(body) {
  if (!body || typeof body !== 'object') {
    return { valid: false, error: 'بيانات الحظر غير صالحة.' };
  }

  const target = body.inboxId || body.id || body.email;
  if (!isNonEmptyString(target, 255)) {
    return { valid: false, error: 'معرف الصندوق أو البريد مطلوب.' };
  }

  const validStatuses = ['confirmed', 'suspected', 'safe', 'none'];
  const status = String(body.banStatus || body.status || '').trim().toLowerCase();
  if (!validStatuses.includes(status)) {
    return { valid: false, error: `حالة الحظر غير صالحة. القيم المقبولة: ${validStatuses.join(', ')}` };
  }

  return {
    valid: true,
    data: {
      inboxId: String(body.inboxId).trim(),
      status,
      reason: String(body.reason || body.banReason || '').slice(0, 500)
    }
  };
}

function validateNiveaLogPayload(body) {
  if (!body || typeof body !== 'object') {
    return { valid: false, error: 'بيانات التسجيل غير صالحة.' };
  }

  if (!isNonEmptyString(body.personName, 100)) {
    return { valid: false, error: 'اسم المشارك مطلوب.' };
  }

  if (!isNonEmptyString(body.mobile, 20)) {
    return { valid: false, error: 'رقم الجوال مطلوب.' };
  }

  return {
    valid: true,
    data: {
      personName: String(body.personName).trim(),
      mobile: String(body.mobile).trim(),
      realEmail: String(body.realEmail || '').trim().slice(0, 255),
      city: String(body.city || '').trim().slice(0, 100),
      receiptNumber: String(body.receiptNumber || '').trim().slice(0, 100),
      index: body.index ? Number(body.index) : null
    }
  };
}

module.exports = {
  isNonEmptyString,
  isValidEmail,
  isValidHttpsUrl,
  isValidSha256,
  validateLoginPayload,
  validateAppVersionPayload,
  validateOfficialCreatePayload,
  validateBanStatusPayload,
  validateNiveaLogPayload
};
