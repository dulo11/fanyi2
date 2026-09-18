const SYNC_DEFAULTS = { enabled: true, autoTranslate: true };
const LOCAL_DEFAULTS = {
  translationProvider: "azure",
  fallbackGoogle: true,
  googleWebMode: "direct",
  googleWebProxyUrl: "",
  googleWebProxyToken: "",
  azureEndpoint: "https://api.cognitive.microsofttranslator.com",
  azureRegion: "",
  azureKey: "",
  requestTimeoutMs: 15000,
  maxRetries: 3,
  cacheMaxEntries: 10000,
  cacheMaxBytes: 52428800,
  cacheTtlDays: 30,
  glossaryEnabled: true,
  glossaryCaseSensitive: false,
  glossaryEntries: []
};

const SYNC_BACKUP_KEYS = [
  "enabled", "autoTranslate", "sourceLang", "targetLang", "displayMode", "siteRules", "pageRules", "urlPatternRules", "siteTranslationProfiles",
  "skipTargetLanguage", "chatMode", "inputPreview", "inputSourceLang", "inputTargetLang", "inputPreviewDelay"
];
const LOCAL_BACKUP_KEYS = [
  "translationProvider", "fallbackGoogle", "googleWebMode", "googleWebProxyUrl", "azureEndpoint", "azureRegion", "requestTimeoutMs", "maxRetries",
  "cacheMaxEntries", "cacheMaxBytes", "cacheTtlDays", "releaseChannel", "glossaryEnabled", "glossaryCaseSensitive", "glossaryEntries",
  "siteExclusionsV1", "siteInputLanguagesV1"
];
const BACKUP_SCHEMA = "floating-translator-settings";
const BACKUP_VERSION = 1;
const $ = id => document.getElementById(id);
let ruleRowsCache = [];

function pick(source, keys) {
  const out = {};
  for (const key of keys) if (source?.[key] !== undefined) out[key] = source[key];
  return out;
}

function normalizeUrlPatternInput(value) {
  return String(value || "")
    .trim()
    .replace(/^https?:\/\//i, "")
    .replace(/[?#].*$/, "")
    .replace(/^\/+/, "");
}

function managedRuleLabel(kind) {
  if (kind === "siteRules") return "网站规则";
  if (kind === "pageRules") return "网页规则";
  if (kind === "urlPatternRules") return "通配规则";
  if (kind === "siteTranslationProfiles") return "网站独立配置";
  if (kind === "siteExclusionsV1") return "网站排除区域";
  return kind;
}

function actionLabel(value) {
  if (value === "always") return "始终翻译";
  if (value === "never") return "不翻译";
  return String(value || "");
}

function renderRuleManager() {
  const list = $("ruleManagerList");
  const summary = $("ruleManagerSummary");
  if (!list || !summary) return;

  const query = String($("ruleSearch")?.value || "").trim().toLowerCase();
  const rows = ruleRowsCache.filter(row => {
    if (!query) return true;
    return [row.kind, row.key, row.detail, managedRuleLabel(row.kind), actionLabel(row.action)]
      .join(" ").toLowerCase().includes(query);
  });

  list.replaceChildren();
  summary.textContent = `规则：共 ${ruleRowsCache.length} 条${query ? ` · 当前显示 ${rows.length} 条` : ""}`;

  if (!rows.length) {
    const empty = document.createElement("div");
    empty.className = "rule-empty";
    empty.textContent = query ? "没有匹配的规则" : "还没有保存任何翻译规则";
    list.appendChild(empty);
    return;
  }

  for (const row of rows) {
    const card = document.createElement("div");
    card.className = "rule-row";

    const main = document.createElement("div");
    main.className = "rule-main";
    const type = document.createElement("div");
    type.className = "rule-type";
    type.textContent = managedRuleLabel(row.kind);
    const key = document.createElement("div");
    key.className = "rule-key";
    key.textContent = row.detail ? `${row.key} · ${row.detail}` : row.key;
    main.append(type, key);

    let control;
    if (["siteRules", "pageRules", "urlPatternRules"].includes(row.kind)) {
      control = document.createElement("select");
      for (const [value, label] of [["never", "不翻译"], ["always", "始终翻译"]]) {
        const option = document.createElement("option");
        option.value = value;
        option.textContent = label;
        control.appendChild(option);
      }
      control.value = row.action;
      control.addEventListener("change", () => updateManagedRule(row, control.value)
        .catch(error => setStatus(`规则修改失败：${error?.message || error}`)));
    } else {
      control = document.createElement("div");
      control.className = "note";
      control.textContent = row.action || row.detail || "已保存";
    }

    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "rule-delete";
    remove.textContent = "删除";
    remove.addEventListener("click", () => deleteManagedRule(row)
      .catch(error => setStatus(`规则删除失败：${error?.message || error}`)));

    card.append(main, control, remove);
    list.appendChild(card);
  }
}

async function refreshRuleManager() {
  const [sync, local] = await Promise.all([
    chrome.storage.sync.get({
      siteRules: {},
      pageRules: {},
      urlPatternRules: {},
      siteTranslationProfiles: {}
    }),
    chrome.storage.local.get({ siteExclusionsV1: {} })
  ]);

  const rows = [];
  for (const [key, action] of Object.entries(sync.siteRules || {})) {
    if (["always", "never"].includes(action)) rows.push({ kind: "siteRules", key, action });
  }
  for (const [key, action] of Object.entries(sync.pageRules || {})) {
    if (["always", "never"].includes(action)) rows.push({ kind: "pageRules", key, action });
  }
  for (const [key, action] of Object.entries(sync.urlPatternRules || {})) {
    if (["always", "never"].includes(action)) rows.push({ kind: "urlPatternRules", key, action });
  }
  for (const [key, profile] of Object.entries(sync.siteTranslationProfiles || {})) {
    if (!profile || profile.enabled === false) continue;
    rows.push({
      kind: "siteTranslationProfiles",
      key,
      action: "独立配置",
      detail: `${profile.sourceLang || "auto"} → ${profile.targetLang || "zh-CN"}`
    });
  }
  for (const [key, selectors] of Object.entries(local.siteExclusionsV1 || {})) {
    const count = Array.isArray(selectors) ? selectors.length : 0;
    if (count) rows.push({ kind: "siteExclusionsV1", key, action: `${count} 个排除区域`, detail: `${count} 条` });
  }

  ruleRowsCache = rows.sort((a, b) => {
    const typeCompare = managedRuleLabel(a.kind).localeCompare(managedRuleLabel(b.kind), "zh-CN");
    return typeCompare || a.key.localeCompare(b.key);
  });
  renderRuleManager();
}

async function updateManagedRule(row, action) {
  if (!["siteRules", "pageRules", "urlPatternRules"].includes(row.kind)) return;
  const stored = await chrome.storage.sync.get({ [row.kind]: {} });
  const map = stored[row.kind] && typeof stored[row.kind] === "object" ? { ...stored[row.kind] } : {};
  map[row.key] = action;
  await chrome.storage.sync.set({ [row.kind]: map });
  setStatus("规则已更新");
  await refreshRuleManager();
}

async function deleteManagedRule(row) {
  if (row.kind === "siteExclusionsV1") {
    const stored = await chrome.storage.local.get({ siteExclusionsV1: {} });
    const map = stored.siteExclusionsV1 && typeof stored.siteExclusionsV1 === "object" ? { ...stored.siteExclusionsV1 } : {};
    delete map[row.key];
    await chrome.storage.local.set({ siteExclusionsV1: map });
  } else {
    const stored = await chrome.storage.sync.get({ [row.kind]: {} });
    const map = stored[row.kind] && typeof stored[row.kind] === "object" ? { ...stored[row.kind] } : {};
    delete map[row.key];
    await chrome.storage.sync.set({ [row.kind]: map });
  }
  setStatus("规则已删除");
  await refreshRuleManager();
}

async function addUrlPatternRule() {
  const pattern = normalizeUrlPatternInput($("urlPatternInput").value);
  if (!pattern || /\s/.test(pattern) || pattern.length > 240) {
    throw new Error("请输入有效网址模式，例如 github.com/*/issues/*");
  }
  const action = $("urlPatternAction").value === "always" ? "always" : "never";
  const stored = await chrome.storage.sync.get({ urlPatternRules: {} });
  const map = stored.urlPatternRules && typeof stored.urlPatternRules === "object" ? { ...stored.urlPatternRules } : {};
  if (!Object.prototype.hasOwnProperty.call(map, pattern) && Object.keys(map).length >= 200) {
    throw new Error("通配规则最多 200 条");
  }
  map[pattern] = action;
  await chrome.storage.sync.set({ urlPatternRules: map });
  $("urlPatternInput").value = "";
  setStatus(`已添加通配规则：${pattern}`);
  await refreshRuleManager();
}

function parseGlossaryText(value) {
  const entries = [];
  const invalid = [];
  const seen = new Set();
  String(value || "").split(/\r?\n/).forEach((raw, index) => {
    const line = raw.trim();
    if (!line || line.startsWith("#")) return;
    const match = line.match(/^(.*?)\s*(?:=>|→|->)\s*(.+)$/);
    if (!match) return invalid.push(index + 1);
    const source = match[1].trim();
    const target = match[2].trim();
    if (!source || !target) return invalid.push(index + 1);
    if (seen.has(source)) return;
    seen.add(source);
    entries.push({ source, target });
  });
  return { entries: entries.slice(0, 300), invalid, truncated: entries.length > 300 };
}

function serializeGlossary(entries) {
  return (Array.isArray(entries) ? entries : []).map(item => {
    const source = String(item?.source ?? item?.from ?? "").trim();
    const target = String(item?.target ?? item?.to ?? "").trim();
    return source && target ? `${source} => ${target}` : "";
  }).filter(Boolean).join("\n");
}

function refreshGlossaryStatus() {
  const parsed = parseGlossaryText($("glossaryText").value);
  const notes = [`有效规则 ${parsed.entries.length} 条`];
  if (parsed.invalid.length) notes.push(`格式错误行：${parsed.invalid.slice(0, 8).join("、")}${parsed.invalid.length > 8 ? "…" : ""}`);
  if (parsed.truncated) notes.push("超过 300 条，只保存前 300 条");
  $("glossaryStatus").textContent = `术语表：${notes.join(" · ")}`;
  return parsed;
}

function setStatus(message) {
  $("status").textContent = message;
  clearTimeout(setStatus.timer);
  setStatus.timer = setTimeout(() => $("status").textContent = "", 4600);
}

function toggleProviderSections() {
  $("azureSection").hidden = $("provider").value !== "azure";
}

function routeLabel(route) {
  if (route === "azure") return "Azure";
  if (route === "google-web") return "Google Web";
  if (route === "google-fallback") return "Google 回退";
  if (route === "cache") return "缓存";
  return route || "暂无记录";
}

async function load() {
  const [sync, localRaw] = await Promise.all([
    chrome.storage.sync.get(SYNC_DEFAULTS),
    chrome.storage.local.get(null)
  ]);
  const local = { ...LOCAL_DEFAULTS, ...localRaw };
  if (local.translationProvider === "oci-proxy") local.translationProvider = "azure";

  $("provider").value = local.translationProvider || "azure";
  $("fallbackGoogle").checked = local.fallbackGoogle !== false;
  $("googleWebMode").value = ["direct", "proxy", "auto"].includes(local.googleWebMode) ? local.googleWebMode : "direct";
  $("googleWebProxyUrl").value = local.googleWebProxyUrl || "";
  $("googleWebProxyToken").placeholder = local.googleWebProxyToken ? "已保存（留空表示不修改）" : "请输入 FT_PROXY_TOKEN";
  $("clearGoogleWebProxyToken").checked = false;
  $("azureEndpoint").value = local.azureEndpoint || LOCAL_DEFAULTS.azureEndpoint;
  $("azureRegion").value = local.azureRegion || "";
  $("azureKey").placeholder = local.azureKey ? "已保存（留空表示不修改）" : "请输入 Azure Translator Key";
  $("requestTimeoutMs").value = String(local.requestTimeoutMs || 15000);
  $("maxRetries").value = String(local.maxRetries ?? 3);
  $("cacheMaxEntries").value = String(local.cacheMaxEntries || 10000);
  $("cacheMaxMb").value = String(Math.max(5, Math.round(Number(local.cacheMaxBytes || 52428800) / 1048576)));
  $("cacheTtlDays").value = String(local.cacheTtlDays ?? 30);
  $("glossaryEnabled").checked = local.glossaryEnabled !== false;
  $("glossaryCaseSensitive").checked = Boolean(local.glossaryCaseSensitive);
  $("glossaryText").value = serializeGlossary(local.glossaryEntries);
  $("enabled").checked = Boolean(sync.enabled);
  $("autoTranslate").checked = Boolean(sync.autoTranslate);
  $("includeAzureKey").checked = false;
  toggleProviderSections();
  refreshGlossaryStatus();
  await Promise.all([refreshCacheStats(), refreshDiagnostics(), refreshUsage(), refreshRuleManager()]);
}

async function save({ showStatus = true, reload = true } = {}) {
  const parsedGlossary = refreshGlossaryStatus();
  const sync = { enabled: $("enabled").checked, autoTranslate: $("autoTranslate").checked };
  const local = {
    translationProvider: $("provider").value,
    fallbackGoogle: $("fallbackGoogle").checked,
    googleWebMode: $("googleWebMode").value,
    googleWebProxyUrl: $("googleWebProxyUrl").value.trim().replace(/\/+$/, ""),
    azureEndpoint: $("azureEndpoint").value.trim() || LOCAL_DEFAULTS.azureEndpoint,
    azureRegion: $("azureRegion").value.trim(),
    requestTimeoutMs: Math.max(3000, Math.min(45000, Number($("requestTimeoutMs").value) || 15000)),
    maxRetries: Math.max(0, Math.min(5, Number($("maxRetries").value) || 0)),
    cacheMaxEntries: Math.max(1000, Math.min(200000, Number($("cacheMaxEntries").value) || 10000)),
    cacheMaxBytes: Math.max(5, Math.min(500, Number($("cacheMaxMb").value) || 50)) * 1048576,
    cacheTtlDays: Math.max(0, Math.min(3650, Number($("cacheTtlDays").value) || 0)),
    glossaryEnabled: $("glossaryEnabled").checked,
    glossaryCaseSensitive: $("glossaryCaseSensitive").checked,
    glossaryEntries: parsedGlossary.entries
  };
  if ($("clearAzureKey").checked) local.azureKey = "";
  else if ($("azureKey").value.trim()) local.azureKey = $("azureKey").value.trim();
  if ($("clearGoogleWebProxyToken").checked) local.googleWebProxyToken = "";
  else if ($("googleWebProxyToken").value.trim()) local.googleWebProxyToken = $("googleWebProxyToken").value.trim();

  await Promise.all([
    chrome.storage.sync.set(sync), chrome.storage.local.set(local), chrome.storage.local.remove(["ociProxyEndpoint", "ociProxyToken"])
  ]);
  $("azureKey").value = "";
  $("clearAzureKey").checked = false;
  $("googleWebProxyToken").value = "";
  $("clearGoogleWebProxyToken").checked = false;
  if (showStatus) setStatus(`已保存${parsedGlossary.invalid.length ? `；${parsedGlossary.invalid.length} 行格式错误未保存` : ""}`);
  if (reload) await load();
}

async function testGoogleWebProxy() {
  const status = $("googleWebProxyStatus");
  status.textContent = "中转状态：正在保存并测试…";
  await save({ showStatus: false, reload: false });
  const local = await chrome.storage.local.get({
    googleWebProxyUrl: "",
    googleWebProxyToken: ""
  });
  const base = String(local.googleWebProxyUrl || "").trim().replace(/\/+$/, "");
  if (!base) throw new Error("请先填写 CF Worker 地址");
  const endpoint = base.endsWith("/translate") ? base : `${base}/translate`;
  const headers = { "Content-Type": "application/json" };
  if (local.googleWebProxyToken) headers["X-FT-Token"] = local.googleWebProxyToken;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12000);
  let response;
  try {
    response = await fetch(endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify({
        texts: ["Hello, this is a proxy test."],
        sourceLang: "en",
        targetLang: "zh-CN"
      }),
      signal: controller.signal
    });
  } finally {
    clearTimeout(timer);
  }
  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload?.ok) {
    throw new Error(payload?.error || `HTTP ${response.status}`);
  }
  const result = payload.translations?.[0] || "";
  status.textContent = `中转状态：成功 · ${payload.durationMs || 0}ms · ${result}`;
}

async function testEngine() {
  setStatus("正在保存当前配置…");
  await save({ showStatus: false, reload: false });
  setStatus("正在测试…");
  const response = await chrome.runtime.sendMessage({
    type: "FT_TRANSLATE", texts: ["Hello, this is a translation test."], options: { sourceLang: "en", targetLang: "zh-CN" }
  });
  if (!response?.ok) throw new Error(response?.error || "测试失败");
  setStatus(`测试成功：${response.translations?.[0] || "已返回译文"}`);
  await Promise.all([refreshCacheStats(), refreshDiagnostics(), refreshUsage()]);
}

async function refreshDiagnostics() {
  const response = await chrome.runtime.sendMessage({ type: "FT_DIAGNOSTICS" });
  if (!response?.ok) {
    $("engineStatus").textContent = `引擎状态：读取失败${response?.error ? `（${response.error}）` : ""}`;
    $("runtimeStatus").textContent = "最近实际翻译路径：读取失败";
    return;
  }
  const d = response.diagnostics || {};
  const provider = d.provider === "google-web" ? "Google Web" : "Azure";
  const key = d.provider === "google-web" ? "无需 Key" : (d.azureKeySet ? "Key 已设置" : "Key 未设置");
  const fallback = d.fallbackGoogle ? "Google 回退开启" : "Google 回退关闭";
  $("engineStatus").textContent = `引擎状态：${provider} · ${key} · ${fallback}`;
  const r = d.lastRuntime;
  if (!r) $("runtimeStatus").textContent = "最近实际翻译路径：暂无记录";
  else {
    const at = r.at ? new Date(r.at).toLocaleString() : "-";
    $("runtimeStatus").textContent = `最近实际翻译路径：${routeLabel(r.actualRoute)} · ${r.ok === false ? "失败" : "成功"} · ${r.durationMs || 0}ms · ${at}`;
  }
}

async function refreshCacheStats() {
  const response = await chrome.runtime.sendMessage({ type: "FT_CACHE_STATS" });
  if (!response?.ok) {
    $("cacheStats").textContent = `缓存统计：读取失败${response?.error ? `（${response.error}）` : ""}`;
    return;
  }
  const mb = Number(response.bytes || 0) / 1048576;
  $("cacheStats").textContent = `缓存统计：${Number(response.entries || 0).toLocaleString()} 条 · ${mb.toFixed(1)} MB`;
}

function formatUsageBucket(bucket = {}) {
  const azure = bucket.azure || {};
  const google = bucket.googleWeb || {};
  return `Azure ${Number(azure.chars || 0).toLocaleString()} 字符 / ${Number(azure.requests || 0).toLocaleString()} 请求 · ` +
    `Google ${Number(google.chars || 0).toLocaleString()} 字符 / ${Number(google.requests || 0).toLocaleString()} 请求 · 缓存命中 ${Number(bucket.cacheHits || 0).toLocaleString()} 条`;
}

async function refreshUsage() {
  const response = await chrome.runtime.sendMessage({ type: "FT_USAGE_STATS" });
  if (!response?.ok) {
    $("usageToday").textContent = `今日用量：读取失败${response?.error ? `（${response.error}）` : ""}`;
    $("usageMonth").textContent = "本月用量：读取失败";
    return;
  }
  const usage = response.usage || {};
  $("usageToday").textContent = `今日用量（${usage.dayKey || "-"}）：${formatUsageBucket(usage.day)}`;
  $("usageMonth").textContent = `本月用量（${usage.monthKey || "-"}）：${formatUsageBucket(usage.month)}`;
}

async function pruneCache() {
  await save({ showStatus: false, reload: false });
  const response = await chrome.runtime.sendMessage({ type: "FT_PRUNE_CACHE" });
  if (!response?.ok) throw new Error(response?.error || "整理失败");
  await refreshCacheStats();
  setStatus(`缓存整理完成：删除 ${response.deleted || 0} 条，剩余 ${response.remaining || 0} 条`);
}

async function clearCache() {
  const response = await chrome.runtime.sendMessage({ type: "FT_CLEAR_CACHE" });
  if (!response?.ok) throw new Error(response?.error || "清理失败");
  await refreshCacheStats();
  setStatus("翻译缓存已清空");
}

async function resetUsage() {
  const response = await chrome.runtime.sendMessage({ type: "FT_RESET_USAGE_STATS" });
  if (!response?.ok) throw new Error(response?.error || "重置失败");
  await refreshUsage();
  setStatus("本地用量统计已重置");
}

async function diagnosticObject() {
  const [diagnostics, usage, cache] = await Promise.all([
    chrome.runtime.sendMessage({ type: "FT_DIAGNOSTICS" }),
    chrome.runtime.sendMessage({ type: "FT_USAGE_STATS" }),
    chrome.runtime.sendMessage({ type: "FT_CACHE_STATS" })
  ]);
  return {
    product: "FloatingTranslator Browser",
    version: chrome.runtime.getManifest().version,
    generatedAt: new Date().toISOString(),
    userAgent: navigator.userAgent,
    diagnostics: diagnostics?.diagnostics || null,
    usage: usage?.usage || null,
    cacheEntries: cache?.entries ?? null,
    cacheBytes: cache?.bytes ?? null
  };
}

async function copyDiagnostics() {
  const data = await diagnosticObject();
  if (data.diagnostics) delete data.diagnostics.azureKey;
  await navigator.clipboard.writeText(JSON.stringify(data, null, 2));
  setStatus("诊断信息已复制，不包含 Azure Key");
}

async function exportSettings() {
  const [syncRaw, localRaw] = await Promise.all([chrome.storage.sync.get(null), chrome.storage.local.get(null)]);
  const localKeys = $("includeAzureKey").checked ? [...LOCAL_BACKUP_KEYS, "azureKey"] : LOCAL_BACKUP_KEYS;
  const payload = {
    schema: BACKUP_SCHEMA,
    schemaVersion: BACKUP_VERSION,
    extensionVersion: chrome.runtime.getManifest().version,
    exportedAt: new Date().toISOString(),
    sync: pick(syncRaw, SYNC_BACKUP_KEYS),
    local: pick(localRaw, localKeys)
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `FloatingTranslator-settings-v${chrome.runtime.getManifest().version}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  setStatus($("includeAzureKey").checked ? "设置已导出（包含 Azure Key，请妥善保管）" : "设置已导出（未包含 Azure Key）");
}

async function importSettingsFile(file) {
  const text = await file.text();
  const parsed = JSON.parse(text);
  if (parsed?.schema !== BACKUP_SCHEMA || Number(parsed?.schemaVersion) !== BACKUP_VERSION) throw new Error("不是支持的 FloatingTranslator 设置备份");
  const sync = pick(parsed.sync || {}, SYNC_BACKUP_KEYS);
  const local = pick(parsed.local || {}, [...LOCAL_BACKUP_KEYS, "azureKey"]);
  if (local.translationProvider === "oci-proxy") local.translationProvider = "azure";
  await Promise.all([chrome.storage.sync.set(sync), chrome.storage.local.set(local)]);
  setStatus(`设置恢复成功${local.azureKey !== undefined ? "（备份中包含 Key）" : "（保留当前 Key）"}`);
  await load();
}

$("ruleSearch")?.addEventListener("input", renderRuleManager);
$("refreshRuleManager")?.addEventListener("click", () => refreshRuleManager().catch(error => setStatus(`规则读取失败：${error?.message || error}`)));
$("addUrlPatternRule")?.addEventListener("click", () => addUrlPatternRule().catch(error => setStatus(`添加失败：${error?.message || error}`)));
$("urlPatternInput")?.addEventListener("keydown", event => {
  if (event.key !== "Enter") return;
  event.preventDefault();
  addUrlPatternRule().catch(error => setStatus(`添加失败：${error?.message || error}`));
});

$("provider").addEventListener("change", toggleProviderSections);
$("glossaryText").addEventListener("input", refreshGlossaryStatus);
$("save").addEventListener("click", () => save().catch(error => setStatus(`保存失败：${error?.message || error}`)));
$("testGoogleWebProxy")?.addEventListener("click", () => testGoogleWebProxy().catch(error => { $("googleWebProxyStatus").textContent = `中转状态：失败 · ${error?.message || error}`; }));
$("testEngine").addEventListener("click", () => testEngine().catch(error => setStatus(`测试失败：${error?.message || error}`)));
$("refreshUsage").addEventListener("click", () => refreshUsage().catch(error => setStatus(`用量读取失败：${error?.message || error}`)));
$("resetUsage").addEventListener("click", () => resetUsage().catch(error => setStatus(`重置失败：${error?.message || error}`)));
$("refreshCacheStats").addEventListener("click", () => refreshCacheStats().catch(error => setStatus(`统计失败：${error?.message || error}`)));
$("pruneCache").addEventListener("click", () => pruneCache().catch(error => setStatus(`整理失败：${error?.message || error}`)));
$("clearCache").addEventListener("click", () => clearCache().catch(error => setStatus(`清理失败：${error?.message || error}`)));
$("copyDiagnostics").addEventListener("click", () => copyDiagnostics().catch(error => setStatus(`复制失败：${error?.message || error}`)));
$("exportSettings").addEventListener("click", () => exportSettings().catch(error => setStatus(`导出失败：${error?.message || error}`)));
$("importSettings").addEventListener("click", () => $("importFile").click());
$("importFile").addEventListener("change", event => {
  const file = event.target.files?.[0];
  if (file) importSettingsFile(file).catch(error => setStatus(`导入失败：${error?.message || error}`));
  event.target.value = "";
});

load().catch(error => setStatus(`加载失败：${error?.message || error}`));