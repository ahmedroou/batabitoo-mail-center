/**
 * Gemini AI Engine & Models Hub — Transferred from amazon-order-tracker
 * 
 * Supported Models:
 * - gemini-2.5-flash (Fast & powerful)
 * - gemini-1.5-flash (Production stable)
 * - gemini-2.0-flash-exp (Experimental next-gen)
 * - gemini-1.5-pro (Deep reasoning & extraction)
 * - gemini-3.5-flash
 * - gemini-3.5-flash-lite
 * - gemini-3.6-flash
 * - gemini-3.1-flash-lite
 */

const GEMINI_MODELS = [
  "gemini-2.5-flash",
  "gemini-1.5-flash",
  "gemini-2.0-flash-exp",
  "gemini-1.5-pro",
  "gemini-3.5-flash",
  "gemini-3.5-flash-lite",
  "gemini-3.6-flash",
  "gemini-3.1-flash-lite"
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

if (typeof module !== "undefined" && module.exports) {
  module.exports = { GeminiAI, GEMINI_MODELS };
}
