const DEFAULTS = {
  enabled: true,
  autoTranslate: true,
  sourceLang: "auto",
  targetLang: "zh-CN",
  displayMode: "translated",
  siteRules: {},
  siteTranslationProfiles: {},
  skipTargetLanguage: true,
  chatMode: true,
  inputPreview: true,
  inputSourceLang: "auto",
  inputTargetLang: "en"
};

const LOCAL_DEFAULTS = {
  fallbackGoogle: true,
  releaseChannel: "stable"
};

const SITE_INPUT_KEY = "siteInputLanguagesV1";
const LANGUAGES = [
  ["auto", "自动检测"],
  ["zh-CN", "中文（简体）"], ["zh-TW", "中文（繁体）"], ["en", "英语"], ["ja", "日语"],
  ["ko", "韩语"], ["vi", "越南语"], ["th", "泰语"], ["ms", "马来语"], ["id", "印度尼西亚语"],
  ["fil", "菲律宾语"], ["fr", "法语"], ["de", "德语"], ["es", "西班牙语"], ["pt", "葡萄牙语"],
  ["ru", "俄语"], ["ar", "阿拉伯语"], ["hi", "印地语"], ["it", "意大利语"], ["tr", "土耳其语"]
];

const $ = id => document.getElementById(id);
let activeTab = null;
let currentHost = "";
let settings = { ...DEFAULTS };
let localSettings = { ...LOCAL_DEFAULTS };
let pagePaused = false;
let repairing = null;
let repairAttempted = false;
let pageError = "";
let refreshBusy = false;
let siteAccessGranted = null;
const ALL_SITES_PERMISSION = { origins: ["<all_urls>"] };

function appendLanguageOptions(select, includeAuto) {
  for (const [value, label] of LANGUAGES) {
    if (!includeAuto && value === "auto") continue;
    const option = document.createElement("option");
    option.value = value;
    option.textContent = label;
    select.appendChild(option);
  }
}

function populateLanguages() {
  appendLanguageOptions($("sourceLang"), true);
  appendLanguageOptions($("targetLang"), false);
  appendLanguageOptions($("inputSourceLang"), true);
  appendLanguageOptions($("inputTargetLang"), false);
  appendLanguageOptions($("siteProfileSource"), true);
  appendLanguageOptions($("siteProfileTarget"), false);
}

async function getActiveTab() {
  const tabs = globalThis.FTMessaging?.tabsQuery
    ? await globalThis.FTMessaging.tabsQuery({ active: true, currentWindow: true })
    : await chrome.tabs.query({ active: true, currentWindow: true });
  return tabs[0] || null;
}

function hostFromTab(tab) {
  try {
    const url = new URL(tab?.url || "");
    return ["http:", "https:"].includes(url.protocol) ? url.hostname.toLowerCase() : "";
  } catch { return ""; }
}

function currentOriginPattern() {
  try {
    const url = new URL(activeTab?.url || "");
    if (!["http:", "https:"].includes(url.protocol)) return "";
    return `${url.origin}/*`;
  } catch { return ""; }
}

function setInjectionStatus(text) {
  const el = $("injectionStatus");
  if (el) el.textContent = text;
}

async function refreshSiteAccess() {
  const status = $("siteAccessStatus");
  const grant = $("grantSiteAccess");
  if (!currentHost) {
    siteAccessGranted = false;
    if (status) status.textContent = "网站访问：当前不是普通 http/https 网页";
    if (grant) grant.disabled = true;
    return false;
  }
  if (!chrome.permissions?.contains) {
    siteAccessGranted = null;
    if (status) status.textContent = "网站访问：浏览器未提供 permissions API";
    if (grant) grant.disabled = false;
    return false;
  }
  try {
    const origin = currentOriginPattern();
    const [allSites, currentSite] = await Promise.all([
      chrome.permissions.contains(ALL_SITES_PERMISSION),
      origin ? chrome.permissions.contains({ origins: [origin] }) : Promise.resolve(false)
    ]);
    siteAccessGranted = Boolean(allSites || currentSite);
    if (status) {
      status.textContent = allSites
        ? "网站访问：已授权所有网站"
        : currentSite
          ? `网站访问：已授权当前网站（${currentHost}）`
          : `网站访问：未授权（${currentHost}）`;
    }
    if (grant) {
      grant.disabled = false;
      grant.textContent = siteAccessGranted ? "重新请求网页权限" : "授权网页翻译";
    }
    return siteAccessGranted;
  } catch (error) {
    siteAccessGranted = null;
    if (status) status.textContent = `网站访问：检测失败 · ${error?.message || error}`;
    if (grant) grant.disabled = false;
    return false;
  }
}

async function requestSiteAccess() {
  const status = $("siteAccessStatus");
  if (!currentHost) throw new Error("请先打开普通 http/https 网页");
  if (!chrome.permissions?.request) throw new Error("当前浏览器没有提供网页权限请求接口");
  if (status) status.textContent = "网站访问：正在请求浏览器授权…";

  let granted = false;
  let allError = null;
  try {
    granted = Boolean(await chrome.permissions.request(ALL_SITES_PERMISSION));
  } catch (error) {
    allError = error;
  }

  if (!granted) {
    const origin = currentOriginPattern();
    if (origin) {
      try { granted = Boolean(await chrome.permissions.request({ origins: [origin] })); }
      catch (error) { if (!allError) allError = error; }
    }
  }

  await refreshSiteAccess();
  if (!granted && siteAccessGranted !== true) {
    throw new Error(allError?.message || "浏览器没有授予网页访问权限");
  }
  return true;
}

async function repairPage() {
  if (repairing) return repairing;
  if (repairAttempted) throw new Error(pageError || "网页脚本恢复失败，请刷新网页后重试");
  repairAttempted = true;
  repairing = (async () => {
    if (!currentHost) throw new Error("浏览器内部页不允许注入，请打开普通网页");
    if (!activeTab?.id) throw new Error("无法读取当前标签页");

    setInjectionStatus("页面脚本：正在通过后台补注入…");
    const response = await chrome.runtime.sendMessage({
      type: "FT_REPAIR_CURRENT_PAGE",
      tabId: activeTab.id,
      url: activeTab.url || ""
    });

    if (!response?.ok) {
      const diagnostic = response?.diagnostic || {};
      const detail = diagnostic.file
        ? `${diagnostic.stage || "注入"} · ${diagnostic.file} · ${diagnostic.error || "失败"}`
        : diagnostic.error || "后台补注入失败";
      throw new Error(detail);
    }
    setInjectionStatus("页面脚本：后台补注入完成，正在连接…");
  })();
  try {
    await repairing;
  } catch (error) {
    pageError = String(error?.message || error);
    throw error;
  } finally {
    repairing = null;
  }
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function sendPageBridgeMessage(message) {
  if (!currentHost || !globalThis.FTPageBridge) return null;
  const type = String(message?.type || "");
  if (type === "FT_GET_PAGE_STATE") {
    for (let i = 0; i < 12; i++) {
      const state = await globalThis.FTPageBridge.readPageState(currentHost, 12000);
      if (state) return state;
      await delay(80);
    }
    return null;
  }
  if (type === "FT_REFRESH_SETTINGS") return { ok: true };

  const actionMap = {
    FT_SET_PAUSED: "set-paused",
    FT_TRANSLATE_NOW: "translate-now",
    FT_RESCAN_PAGE: "rescan",
    FT_RESTORE_PAGE: "restore"
  };
  const action = actionMap[type];
  if (!action) return null;

  const id = await globalThis.FTPageBridge.sendPageCommand(currentHost, action, {
    paused: Boolean(message?.paused)
  });
  for (let i = 0; i < 18; i++) {
    await delay(70);
    const state = await globalThis.FTPageBridge.readPageState(currentHost, 12000);
    if (state?.lastCommandId === id) return state;
  }
  return await globalThis.FTPageBridge.readPageState(currentHost, 12000);
}

async function tabsMessageWithTimeout(message, timeoutMs = 1500) {
  if (!activeTab?.id) return null;
  let task;
  try {
    task = chrome.tabs.sendMessage(activeTab.id, message, { frameId: 0 });
  } catch (error) {
    throw error;
  }
  if (!task || typeof task.then !== "function") return task || null;
  return await Promise.race([
    task,
    delay(timeoutMs).then(() => { throw new Error("网页消息响应超时"); })
  ]);
}

async function sendToPage(message) {
  if (!activeTab?.id) return null;

  try {
    const bridged = await sendPageBridgeMessage(message);
    if (bridged) {
      pageError = "";
      setInjectionStatus("页面脚本：已连接");
      return bridged;
    }
  } catch (error) {
    pageError = String(error?.message || error);
  }

  try {
    const response = await tabsMessageWithTimeout(message, 1500);
    if (!response) throw new Error("网页脚本没有响应");
    pageError = "";
    setInjectionStatus("页面脚本：已连接");
    return response;
  } catch (error) {
    const serviceWorker = chrome.runtime.getManifest?.()?.background?.service_worker || "";
    const canRepairPage = serviceWorker === "background/main.js" || serviceWorker === "background/main-zip.js";
    if (!canRepairPage) {
      const type = String(message?.type || "");
      if (type === "FT_GET_PAGE_STATE") {
        pageError = "等待网页脚本状态，请刷新当前网页一次";
        setInjectionStatus(`页面脚本：${pageError}`);
      } else if (/EXCLUSION/.test(type)) {
        setInjectionStatus("页面脚本：排除区域读取暂不可用");
      } else {
        pageError = String(error?.message || error || "网页脚本未连接");
        setInjectionStatus(`页面脚本：未连接 · ${pageError}`);
      }
      return null;
    }
    try {
      await repairPage();
      const response = await tabsMessageWithTimeout(message, 1800);
      if (!response) throw new Error("网页脚本没有响应，请刷新网页");
      pageError = "";
      setInjectionStatus("页面脚本：已连接（自动修复成功）");
      return response;
    } catch (repairError) {
      pageError = String(repairError?.message || error?.message || error);
      setInjectionStatus(`页面脚本：未连接 · ${pageError}`);
      return null;
    }
  }
}

async function loadSiteInputProfile() {
  if (!currentHost) return null;
  const local = await chrome.storage.local.get({ [SITE_INPUT_KEY]: {} });
  const profile = local[SITE_INPUT_KEY]?.[currentHost];
  if (!profile || typeof profile !== "object") return null;
  return {
    sourceLang: String(profile.sourceLang || "auto"),
    targetLang: String(profile.targetLang || "en")
  };
}

async function saveSiteInputProfile(sourceLang, targetLang) {
  if (!currentHost) return;
  const local = await chrome.storage.local.get({ [SITE_INPUT_KEY]: {} });
  const map = local[SITE_INPUT_KEY] && typeof local[SITE_INPUT_KEY] === "object" ? local[SITE_INPUT_KEY] : {};
  map[currentHost] = { sourceLang, targetLang, updatedAt: Date.now() };
  await chrome.storage.local.set({ [SITE_INPUT_KEY]: map });
}

function routeLabel(route) {
  if (route === "azure") return "Azure";
  if (route === "baidu") return "百度";
  if (route === "aliyun") return "阿里云";
  if (route === "google-web") return "Google Web";
  if (route === "google-fallback") return "Google 回退";
  if (route === "cache") return "缓存";
  return route || "暂无";
}

function currentSiteProfile() {
  if (!currentHost) return null;
  const profile = settings.siteTranslationProfiles?.[currentHost];
  return profile && profile.enabled !== false ? profile : null;
}

async function refreshRuntimeRoute() {
  try {
    const local = await chrome.storage.local.get({
      translationRuntimeStateV1: null,
      providerPoolLastRouteV1: null,
      providerRouteLogV1: []
    });
    const runtime = local.translationRuntimeStateV1;
    const pool = local.providerPoolLastRouteV1;
    const route = pool?.provider || runtime?.actualRoute || "";
    const at = Number(pool?.at || runtime?.at || 0);
    if (!runtime && !pool) {
      $("runtimeRoute").textContent = "最近翻译路径：暂无记录";
    } else {
      const when = at ? new Date(at).toLocaleTimeString() : "-";
      const failed = pool?.ok === false || runtime?.ok === false;
      const error = pool?.error || runtime?.error || "";
      const suffix = failed ? ` · 失败：${error || "未知错误"}` : (runtime ? ` · ${runtime.durationMs || 0}ms` : "");
      $("runtimeRoute").textContent = `最近翻译路径：${routeLabel(route)} · ${when}${suffix}`;
    }

    const history = Array.isArray(local.providerRouteLogV1) ? local.providerRouteLogV1.slice(-4).reverse() : [];
    $("routeHistory").textContent = history.length
      ? "引擎切换：" + history.map(item => {
          const name = routeLabel(item.provider);
          const state = item.ok === false ? "失败" : "成功";
          const credential = item.credentialLabel ? `/${item.credentialLabel}` : "";
          return `${name}${credential} ${state}`;
        }).join(" → ")
      : "引擎切换：暂无记录";
  } catch {
    $("runtimeRoute").textContent = "最近翻译路径：读取失败";
    $("routeHistory").textContent = "引擎切换：读取失败";
  }
}

function render() {
  $("enabled").checked = Boolean(settings.enabled);
  $("autoTranslate").checked = Boolean(settings.autoTranslate);
  $("fallbackGoogleQuick").checked = localSettings.fallbackGoogle !== false;
  $("skipTargetLanguage").checked = settings.skipTargetLanguage !== false;
  $("sourceLang").value = settings.sourceLang || "auto";
  $("targetLang").value = settings.targetLang || "zh-CN";
  $("displayMode").value = settings.displayMode || "translated";
  $("chatMode").checked = Boolean(settings.chatMode);
  $("inputPreview").checked = Boolean(settings.inputPreview);
  $("inputSourceLang").value = settings.inputSourceLang || "auto";
  $("inputTargetLang").value = settings.inputTargetLang || "en";
  $("siteRule").value = currentHost ? (settings.siteRules?.[currentHost] || "default") : "default";
  $("siteRule").disabled = !currentHost;
  $("host").textContent = currentHost || "此页面不支持扩展脚本";
  $("pauseResume").textContent = pagePaused ? "继续翻译" : "暂停翻译";
  $("swapInputLang").disabled = (settings.inputSourceLang || "auto") === "auto";
  $("swapInputLang").title = $("swapInputLang").disabled ? "先把输入语言改成具体语言后才能交换" : "交换输入与发送语言";
  $("pickExclusion").disabled = !currentHost;
  $("clearExclusions").disabled = !currentHost;
  if ($("grantSiteAccess")) $("grantSiteAccess").disabled = !currentHost;
  if ($("retryInjection")) $("retryInjection").disabled = !currentHost;

  const profile = currentSiteProfile();
  if ($("siteProfileEnabled")) $("siteProfileEnabled").checked = Boolean(profile);
  if ($("siteProfileSource")) $("siteProfileSource").value = profile?.sourceLang || settings.sourceLang || "auto";
  if ($("siteProfileTarget")) $("siteProfileTarget").value = profile?.targetLang || settings.targetLang || "zh-CN";
  if ($("siteProfileProvider")) $("siteProfileProvider").value = profile?.provider || "";
  if ($("siteProfileDisplay")) $("siteProfileDisplay").value = profile?.displayMode || settings.displayMode || "translated";
  if ($("siteProfileAuto")) $("siteProfileAuto").checked = profile?.autoTranslate === undefined ? settings.autoTranslate !== false : Boolean(profile.autoTranslate);
  for (const id of ["siteProfileEnabled","siteProfileSource","siteProfileTarget","siteProfileProvider","siteProfileDisplay","siteProfileAuto","saveSiteProfile","clearSiteProfile"]) {
    if ($(id)) $(id).disabled = !currentHost;
  }
}

async function saveSync(patch) {
  settings = { ...settings, ...patch };
  await chrome.storage.sync.set(patch);
  render();
  await sendToPage({ type: "FT_REFRESH_SETTINGS" });
  await refreshPageState();
}

async function saveLocal(patch) {
  localSettings = { ...localSettings, ...patch };
  await chrome.storage.local.set(patch);
  render();
}

async function saveInputLanguages(patch) {
  await saveSync(patch);
  await saveSiteInputProfile(settings.inputSourceLang || "auto", settings.inputTargetLang || "en");
}

async function refreshPageState() {
  const response = await sendToPage({ type: "FT_GET_PAGE_STATE" });
  if (!response?.ok) {
    $("pageState").textContent = `网页连接失败：${pageError || "请刷新网页，并允许扩展访问此网站"}`;
    return;
  }
  pagePaused = Boolean(response.paused);
  const pieces = [pagePaused ? "已暂停" : (response.active ? "持续翻译中" : "未翻译")];
  if (response.pageLang) pieces.push(response.pageLang);
  if (response.processing) pieces.push("处理中");
  if (response.queued) pieces.push(`待翻译 ${response.queued}`);
  if (response.processed) pieces.push(`已翻译 ${response.processed}`);
  if (response.retried) pieces.push(`精确重试 ${response.retried}`);
  if (response.protectedRestores) pieces.push(`防覆盖恢复 ${response.protectedRestores}`);
  if (response.failed) pieces.push(`失败累计 ${response.failed}`);
  if (response.failedQueued) pieces.push(`待手动重试 ${response.failedQueued}`);
  if (response.siteProfile) pieces.push("网站独立配置");
  if (settings.chatMode && settings.inputPreview) pieces.push("聊天输入预览开");
  if ($("retryFailed")) $("retryFailed").disabled = !Number(response.failedQueued || 0);
  $("pageState").textContent = pieces.join(" · ");
  $("pageState").title = response.lastError || "";
  render();
}

async function refreshExclusions() {
  if (!currentHost) {
    $("exclusionCount").textContent = "排除区域：此页面不支持";
    return;
  }
  const response = await sendToPage({ type: "FT_GET_EXCLUSIONS" });
  if (!response?.ok) {
    $("exclusionCount").textContent = "排除区域：读取失败";
    return;
  }
  const count = Array.isArray(response.selectors) ? response.selectors.length : 0;
  $("exclusionCount").textContent = `排除区域：${count} 条规则`;
  $("clearExclusions").disabled = count === 0;
}

async function saveCurrentSiteProfile() {
  if (!currentHost) throw new Error("当前不是普通网页");
  const profiles = { ...(settings.siteTranslationProfiles || {}) };
  if (!$("siteProfileEnabled").checked) {
    delete profiles[currentHost];
  } else {
    profiles[currentHost] = {
      enabled: true,
      sourceLang: $("siteProfileSource").value || "auto",
      targetLang: $("siteProfileTarget").value || "zh-CN",
      provider: $("siteProfileProvider").value || "",
      displayMode: $("siteProfileDisplay").value || "translated",
      autoTranslate: $("siteProfileAuto").checked,
      skipTargetLanguage: settings.skipTargetLanguage !== false,
      updatedAt: Date.now()
    };
  }
  await saveSync({ siteTranslationProfiles: profiles });
  $("selfCheckStatus").textContent = profiles[currentHost] ? `网站配置：已保存 ${currentHost}` : "网站配置：已恢复跟随全局";
}

async function clearCurrentSiteProfile() {
  if (!currentHost) return;
  const profiles = { ...(settings.siteTranslationProfiles || {}) };
  delete profiles[currentHost];
  await saveSync({ siteTranslationProfiles: profiles });
  render();
  $("selfCheckStatus").textContent = "网站配置：已清除独立配置";
}

async function runSelfCheckAndRepair() {
  const out = $("selfCheckStatus");
  const steps = [];
  const say = text => { if (out) out.textContent = `自检：${text}`; };
  say("正在检查后台…");

  const ping = await chrome.runtime.sendMessage({ type: "FT_BACKGROUND_PING" }).catch(error => ({ ok: false, error: String(error?.message || error) }));
  if (!ping?.ok) throw new Error(`后台未响应：${ping?.error || "unknown"}`);
  steps.push("后台✓");

  say("正在检查网页权限…");
  const access = await refreshSiteAccess();
  if (access === false && chrome.permissions?.request) {
    await requestSiteAccess();
    steps.push("权限已修复✓");
  } else {
    steps.push(access === false ? "权限未知" : "权限✓");
  }

  say("正在检查页面脚本…");
  let page = await sendToPage({ type: "FT_GET_PAGE_STATE" });
  if (!page?.ok) {
    repairAttempted = false;
    pageError = "";
    await repairPage();
    page = await sendToPage({ type: "FT_GET_PAGE_STATE" });
  }
  if (!page?.ok) throw new Error(pageError || "页面脚本仍未连接");
  steps.push("页面脚本✓");

  say("正在测试翻译引擎…");
  const test = await chrome.runtime.sendMessage({
    type: "FT_TRANSLATE",
    texts: ["Hello"],
    options: { sourceLang: "en", targetLang: "zh-CN", ...(page.provider ? { provider: page.provider } : {}) }
  }).catch(error => ({ ok: false, error: String(error?.message || error) }));
  if (!test?.ok || !test.translations?.[0]) throw new Error(`翻译引擎失败：${test?.error || "没有返回译文"}`);
  steps.push("引擎✓");

  say("正在确认译文链路…");
  await sendToPage({ type: "FT_RESCAN_PAGE" });
  steps.push("写回链路✓");
  await Promise.allSettled([refreshPageState(), refreshRuntimeRoute(), refreshExclusions()]);
  say(steps.join(" · "));
}

function bindControls() {
  $("grantSiteAccess")?.addEventListener("click", async () => {
    try {
      await requestSiteAccess();
      repairAttempted = false;
      await repairPage();
      await Promise.allSettled([refreshPageState(), refreshExclusions()]);
    } catch (error) {
      const message = String(error?.message || error);
      $("siteAccessStatus").textContent = `网站访问：授权失败 · ${message}`;
      setInjectionStatus(`页面脚本：未连接 · ${message}`);
    }
  });

  $("retryInjection")?.addEventListener("click", async () => {
    repairAttempted = false;
    pageError = "";
    try {
      await repairPage();
      await Promise.allSettled([refreshPageState(), refreshExclusions(), refreshSiteAccess()]);
    } catch (error) {
      pageError = String(error?.message || error);
      setInjectionStatus(`页面脚本：重新注入失败 · ${pageError}`);
      $("pageState").textContent = `网页连接失败：${pageError}`;
    }
  });

  $("runSelfCheck")?.addEventListener("click", () => {
    $("runSelfCheck").disabled = true;
    runSelfCheckAndRepair()
      .catch(error => { $("selfCheckStatus").textContent = `自检失败：${error?.message || error}`; })
      .finally(() => { $("runSelfCheck").disabled = false; });
  });

  $("saveSiteProfile")?.addEventListener("click", () => saveCurrentSiteProfile().catch(error => {
    $("selfCheckStatus").textContent = `网站配置保存失败：${error?.message || error}`;
  }));
  $("clearSiteProfile")?.addEventListener("click", () => clearCurrentSiteProfile().catch(error => {
    $("selfCheckStatus").textContent = `网站配置清除失败：${error?.message || error}`;
  }));

  $("enabled").addEventListener("change", event => saveSync({ enabled: event.target.checked }));
  $("autoTranslate").addEventListener("change", event => saveSync({ autoTranslate: event.target.checked }));
  $("fallbackGoogleQuick").addEventListener("change", event => saveLocal({ fallbackGoogle: event.target.checked }));
  $("skipTargetLanguage").addEventListener("change", event => saveSync({ skipTargetLanguage: event.target.checked }));
  $("sourceLang").addEventListener("change", event => saveSync({ sourceLang: event.target.value }));
  $("targetLang").addEventListener("change", event => saveSync({ targetLang: event.target.value }));
  $("displayMode").addEventListener("change", event => saveSync({ displayMode: event.target.value }));
  $("chatMode").addEventListener("change", event => saveSync({ chatMode: event.target.checked }));
  $("inputPreview").addEventListener("change", event => saveSync({ inputPreview: event.target.checked }));
  $("inputSourceLang").addEventListener("change", event => saveInputLanguages({ inputSourceLang: event.target.value }));
  $("inputTargetLang").addEventListener("change", event => saveInputLanguages({ inputTargetLang: event.target.value }));

  $("swapInputLang").addEventListener("click", async () => {
    const source = settings.inputSourceLang || "auto";
    const target = settings.inputTargetLang || "en";
    if (source === "auto") return;
    await saveInputLanguages({ inputSourceLang: target, inputTargetLang: source });
  });

  $("siteRule").addEventListener("change", async event => {
    if (!currentHost) return;
    const siteRules = { ...(settings.siteRules || {}) };
    if (event.target.value === "default") delete siteRules[currentHost];
    else siteRules[currentHost] = event.target.value;
    await saveSync({ siteRules });
  });

  $("pickExclusion").addEventListener("click", async () => {
    const response = await sendToPage({ type: "FT_PICK_EXCLUSION" });
    $("exclusionCount").textContent = response?.ok ? "排除区域：已进入网页选择模式" : "排除区域：无法启动选择模式";
  });

  $("clearExclusions").addEventListener("click", async () => {
    const response = await sendToPage({ type: "FT_CLEAR_SITE_EXCLUSIONS" });
    if (response?.ok) await refreshExclusions();
  });

  $("pauseResume").addEventListener("click", async () => {
    const response = await sendToPage({ type: "FT_SET_PAUSED", paused: !pagePaused });
    if (response?.ok) pagePaused = Boolean(response.paused);
    render();
    setTimeout(refreshPageState, 120);
  });

  $("translateNow").addEventListener("click", async () => {
    $("pageState").textContent = "正在恢复并重新翻译整页…";
    await sendToPage({ type: "FT_TRANSLATE_NOW" });
    pagePaused = false;
    setTimeout(refreshPageState, 300);
  });

  $("rescanPage").addEventListener("click", async () => {
    $("pageState").textContent = pagePaused ? "当前已暂停，继续后再补扫" : "正在补扫遗漏内容…";
    if (!pagePaused) await sendToPage({ type: "FT_RESCAN_PAGE" });
    setTimeout(refreshPageState, 250);
  });

  $("retryFailed")?.addEventListener("click", async () => {
    $("pageState").textContent = "正在仅重试失败内容…";
    const response = await sendToPage({ type: "FT_RETRY_FAILED" });
    if (!response?.ok) $("pageState").textContent = "失败队列重试未启动";
    setTimeout(refreshPageState, 220);
  });

  $("restorePage").addEventListener("click", async () => {
    await sendToPage({ type: "FT_RESTORE_PAGE" });
    pagePaused = false;
    setTimeout(refreshPageState, 150);
  });

  $("openOptions").addEventListener("click", () => {
    chrome.runtime.openOptionsPage().catch(error => {
      $("pageState").textContent = `打开设置失败：${error.message}`;
    });
  });
}

async function init() {
  bindControls();
  populateLanguages();
  const manifest = chrome.runtime.getManifest?.();
  if ($("popupVersion")) $("popupVersion").textContent = `v${manifest?.version || "?"} · v1.2核心`;
  [settings, localSettings, activeTab] = await Promise.all([
    chrome.storage.sync.get(DEFAULTS),
    chrome.storage.local.get(LOCAL_DEFAULTS),
    getActiveTab()
  ]);
  settings = { ...DEFAULTS, ...settings };
  localSettings = { ...LOCAL_DEFAULTS, ...localSettings };
  currentHost = hostFromTab(activeTab);
  if ($("releaseChannel")) $("releaseChannel").value = localSettings.releaseChannel || "stable";

  const profile = await loadSiteInputProfile();
  if (profile) {
    settings.inputSourceLang = profile.sourceLang;
    settings.inputTargetLang = profile.targetLang;
    await chrome.storage.sync.set({ inputSourceLang: profile.sourceLang, inputTargetLang: profile.targetLang });
  }

  render();
  void Promise.allSettled([refreshSiteAccess(), refreshPageState(), refreshExclusions(), refreshRuntimeRoute()]);

  setInterval(async () => {
    if (refreshBusy) return;
    refreshBusy = true;
    try { await Promise.allSettled([refreshPageState(), refreshRuntimeRoute()]); }
    finally { refreshBusy = false; }
  }, 1400);
}

init().catch(error => {
  $("pageState").textContent = `加载失败：${error?.message || error}`;
});
