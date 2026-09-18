/**
 * 浮译 Google Web Cloudflare Worker 中转
 * - 只代理固定的 Google Translate Web 接口，不是通用开放代理
 * - 最多 40 段 / 20,000 字符 / 每段最多 3,400 字符
 * - 建议设置 Secret: FT_PROXY_TOKEN
 */

const MAX_ITEMS = 40;
const MAX_TOTAL_CHARS = 20000;
const MAX_ITEM_CHARS = 3400;
const GOOGLE_ENDPOINTS = [
  "https://translate.google.com/translate_a/single",
  "https://translate.googleapis.com/translate_a/single"
];

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "access-control-allow-origin": "*",
      "access-control-allow-headers": "content-type, x-ft-token",
      "access-control-allow-methods": "GET, POST, OPTIONS"
    }
  });
}

function normalizeLang(value, fallback = "auto") {
  const lang = String(value || fallback).trim();
  if (!lang) return fallback;
  const lower = lang.toLowerCase();
  if (lower === "zh-hans" || lower === "zh-cn") return "zh-CN";
  if (lower === "zh-hant" || lower === "zh-tw") return "zh-TW";
  return lang;
}

async function translateOne(text, sourceLang, targetLang) {
  const params = new URLSearchParams({
    client: "gtx",
    sl: normalizeLang(sourceLang, "auto"),
    tl: normalizeLang(targetLang, "zh-CN"),
    dt: "t",
    q: text
  });

  let lastError = null;
  for (const endpoint of GOOGLE_ENDPOINTS) {
    let response;
    try {
      response = await fetch(`${endpoint}?${params.toString()}`, {
        headers: {
          "accept": "application/json,text/plain,*/*",
          "accept-language": "en-US,en;q=0.9",
          "referer": "https://translate.google.com/",
          "user-agent": "Mozilla/5.0 (Linux; Android 16) AppleWebKit/537.36 Chrome/140.0 Mobile Safari/537.36"
        },
        cf: { cacheTtl: 0, cacheEverything: false }
      });
    } catch (error) {
      lastError = error;
      continue;
    }

    if (!response.ok) {
      const retryAfter = response.headers.get("retry-after") || "";
      const body = await response.text().catch(() => "");
      const error = new Error(
        response.status === 429
          ? "Google 对当前 Cloudflare 出口限流（HTTP 429）"
          : `Google Web HTTP ${response.status}${body ? ` · ${body.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").slice(0, 120)}` : ""}`
      );
      error.status = response.status;
      error.retryAfter = retryAfter;
      error.endpoint = endpoint;
      lastError = error;
      if ([403, 429, 500, 502, 503, 504].includes(response.status)) continue;
      throw error;
    }

    try {
      const data = await response.json();
      const translated = Array.isArray(data?.[0])
        ? data[0].map(segment => segment?.[0] || "").join("")
        : "";
      if (translated) return translated;
    } catch (error) {
      lastError = error;
      continue;
    }
  }

  throw lastError || new Error("Google Web 所有上游端点均不可用");
}

async function mapLimit(items, limit, mapper) {
  const results = new Array(items.length);
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await mapper(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length || 1) }, worker));
  return results;
}

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") return json({ ok: true });
    const url = new URL(request.url);

    if (request.method === "GET" && url.pathname === "/health") {
      return json({ ok: true, service: "floating-translator-google-web-proxy", version: 1 });
    }

    if (request.method !== "POST" || url.pathname !== "/translate") {
      return json({ ok: false, error: "Not Found" }, 404);
    }

    const expected = String(env.FT_PROXY_TOKEN || "");
    if (expected) {
      const supplied = String(request.headers.get("x-ft-token") || "");
      if (!supplied || supplied !== expected) return json({ ok: false, error: "Unauthorized" }, 401);
    }

    let payload;
    try { payload = await request.json(); }
    catch { return json({ ok: false, error: "Invalid JSON" }, 400); }

    const texts = Array.isArray(payload?.texts) ? payload.texts.map(value => String(value ?? "")) : [];
    const sourceLang = normalizeLang(payload?.sourceLang || "auto", "auto");
    const targetLang = normalizeLang(payload?.targetLang || "zh-CN", "zh-CN");

    if (!texts.length || texts.length > MAX_ITEMS) {
      return json({ ok: false, error: `texts must contain 1-${MAX_ITEMS} items` }, 400);
    }
    if (texts.some(text => text.length > MAX_ITEM_CHARS)) {
      return json({ ok: false, error: `each item must be <= ${MAX_ITEM_CHARS} characters` }, 413);
    }
    const totalChars = texts.reduce((sum, text) => sum + text.length, 0);
    if (totalChars > MAX_TOTAL_CHARS) {
      return json({ ok: false, error: `total characters must be <= ${MAX_TOTAL_CHARS}` }, 413);
    }

    const startedAt = Date.now();
    try {
      const translations = await mapLimit(texts, 2, text =>
        text.trim() ? translateOne(text, sourceLang, targetLang) : Promise.resolve(text)
      );
      return json({
        ok: true,
        translations,
        sourceLang,
        targetLang,
        itemCount: texts.length,
        chars: totalChars,
        durationMs: Date.now() - startedAt
      });
    } catch (error) {
      const status = Number(error?.status || 0);
      const http = status === 429 ? 429 : (status >= 400 && status < 500 ? 502 : 503);
      return json({
        ok: false,
        error: String(error?.message || error || "Google Web proxy failed"),
        upstreamStatus: status || null,
        retryAfter: error?.retryAfter || ""
      }, http);
    }
  }
};
