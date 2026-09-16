/**
 * Gemini AI Engine & Models Hub — Batabitoo Mail Center
 * 
 * Prioritizes fastest models with the most generous free tiers:
 * 1. gemini-flash-lite-latest (Ultra-fast ~650ms, highest free tier limits)
 * 2. gemini-2.5-flash-lite (Stable low-latency flash-lite)
 * 3. gemini-3.5-flash-lite (Next-gen lightweight)
 * 4. gemini-3.6-flash (Powerful multimodal flash)
 * 5. gemini-3.7-flash (Advanced reasoning fallback)
 */

const GEMINI_MODELS = [
  "gemini-flash-lite-latest",
  "gemini-2.5-flash-lite",
  "gemini-3.5-flash-lite",
  "gemini-3.6-flash",
  "gemini-3.7-flash"
];

const DEFAULT_ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models";

class GeminiAI {
  constructor(apiKey = "") {
    this.apiKey = apiKey || (typeof process !== "undefined" && process.env?.GEMINI_API_KEY) || "";
    this.models = GEMINI_MODELS;
  }

  setApiKey(key) {
    this.apiKey = String(key || "").trim();
  }

  async generateContent(prompt, options = {}) {
    if (!this.apiKey) {
      throw new Error("GEMINI_API_KEY is not configured");
    }

    const temperature = options.temperature ?? 0.1;
    const responseMimeType = options.jsonMode ? "application/json" : "text/plain";
    const modelsToTry = options.model ? [options.model, ...this.models.filter(m => m !== options.model)] : this.models;

    let lastError = null;
    for (const modelName of modelsToTry) {
      const url = `${DEFAULT_ENDPOINT}/${modelName}:generateContent?key=${this.apiKey}`;
      const payload = {
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature, responseMimeType }
      };

      try {
        const response = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload)
        });
        if (!response.ok) {
          const errData = await response.json().catch(() => ({}));
          throw new Error(errData?.error?.message || `HTTP ${response.status}`);
        }
        const data = await response.json();
        const rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text || "";
        return {
          model: modelName,
          text: rawText,
          parsed: options.jsonMode ? this._safeParseJson(rawText) : null
        };
      } catch (err) {
        lastError = err;
        continue;
      }
    }
    throw new Error(`Gemini API request failed across all models: ${lastError?.message || "Unknown error"}`);
  }

  /**
   * Classify whether an Amazon email represents an actual account ban/restriction or a safe/routine notification.
   * @param {Object} emailData - { subject, text, intro, from }
   * @returns {Promise<{ isBanned: boolean, confidence: string, reason: string, classification: string, model: string, latencyMs: number }>}
   */
  async classifyAmazonEmail(emailData = {}) {
    const t0 = Date.now();
    const { subject = "", text = "", intro = "", from = "" } = emailData;

    const systemInstruction = `أنت خبير أمني متخصص في تحليل رسائل البريد الإلكتروني الواردة من أمازون (Amazon) لتحديد ما إذا كان حساب العميل قد تم حظره أو تقييده فعلياً، أم أن الرسالة مجرد إشعار روتيني أو رمز تحقق.

المهمة:
حلل عنوان ومرسل ومحتوى البريد التالي، وأجب حصرياً بصيغة JSON التالية بدقة:
{
  "isBanned": true | false,
  "confidence": "high" | "medium" | "low",
  "reason": "سبب موجز باللغة العربية (مثلاً: إغلاق الحساب نهائياً، تقييد مشتريات رقمية فقط، رمز تحقق طبيعي، شحنة عادية)",
  "classification": "banned" | "safe" | "uncertain"
}

القواعد الصارمة:
1. رموز التحقق لمرة واحدة (OTP) وتسجيل الدخول وتحديث كلمات المرور ليست حظراً على الإطلاق وتصنف كـ "safe".
2. إشعارات تأكيد الطلبات، الشحن، التوصيل، استرداد الأموال، وملاحظات التوصيل العادية ليست حظراً وتصنف كـ "safe".
3. رسائل تقييد المشتريات الرقمية فقط (digital purchases only) أو إغلاق الحساب (account closed/suspended/terminated) أو رفض تقديم الخدمة تعتبر حظراً حقيقياً وتصنف كـ "banned".
4. إذا لم تكن واثقاً بدرجة كافية أو كان المحتوى مبهماً، ضع classification: "uncertain" و confidence: "low".`;

    const userMessage = `مرسل الرسالة: ${from}\nموضوع الرسالة: ${subject}\nمحتوى الرسالة: ${text || intro}`;
    const fullPrompt = `${systemInstruction}\n\n---\nالرسالة المراد فحصها:\n${userMessage}`;

    const result = await this.generateContent(fullPrompt, {
      temperature: 0.1,
      jsonMode: true,
      model: "gemini-flash-lite-latest"
    });

    const parsed = result.parsed || {};
    const classification = parsed.classification || (parsed.isBanned ? "banned" : "safe");
    const isBanned = classification === "banned";
    const reason = parsed.reason || (isBanned ? "تقييد أو إغلاق الحساب" : "حساب سليم");
    const confidence = parsed.confidence || "high";

    return {
      isBanned,
      confidence,
      reason,
      classification,
      model: result.model,
      latencyMs: Date.now() - t0
    };
  }

  _safeParseJson(text) {
    if (!text || typeof text !== "string") return null;
    let clean = text.trim();
    if (clean.startsWith("```json")) {
      clean = clean.replace(/^```json\s*/i, "").replace(/\s*```$/, "");
    } else if (clean.startsWith("```")) {
      clean = clean.replace(/^```\s*/i, "").replace(/\s*```$/, "");
    }
    try { return JSON.parse(clean.trim()); } catch { return null; }
  }
}

const defaultGemini = new GeminiAI();

if (typeof module !== "undefined" && module.exports) {
  module.exports = { GeminiAI, defaultGemini, GEMINI_MODELS };
}
