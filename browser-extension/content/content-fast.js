(() => {
  if (window.__FLOATING_TRANSLATOR_LOADED__) return;
  window.__FLOATING_TRANSLATOR_LOADED__ = true;

  const DEFAULTS = {
    enabled: true,
    autoTranslate: true,
    sourceLang: "auto",
    targetLang: "zh-CN",
    displayMode: "translated",
    siteRules: {},
    skipTargetLanguage: true,
    chatMode: true,
    inputPreview: true,
    inputSourceLang: "auto",
    inputTargetLang: "en",
    inputPreviewDelay: 550
  };

  const BLOCK_TAGS = new Set([
    "P", "DIV", "LI", "ARTICLE", "SECTION", "HEADER", "FOOTER", "MAIN", "ASIDE",
    "TD", "TH", "H1", "H2", "H3", "H4", "H5", "H6", "BLOCKQUOTE"
  ]);

  const SKIP_SELECTOR = [
    "script", "style", "noscript", "code", "pre", "textarea", "input", "select", "option",
    "svg", "canvas", "math", "[contenteditable='true']", "[contenteditable='']",
    ".ft-translation-inline", ".ft-selection-bubble", ".ft-input-preview", "[data-ft-owned='1']"
  ].join(",");

  const state = {
    settings: { ...DEFAULTS },
    active: false,
    paused: false,
    queue: new Set(),
    urgentQueue: new Set(),
    processing: false,
    flushTimer: null,
    retryTimer: null,
    rootFlushTimer: null,
    pendingRoots: new Set(),
    nodeState: new WeakMap(),
    nodeRetries: new WeakMap(),
    trackedNodes: new Set(),
    generation: 0,
    observer: null,
    started: false,
    processed: 0,
    failed: 0,
    retried: 0,
    protectedRestores: 0,
    lastError: "",
    lastCommandId: "",
    pageBridgeTimer: null,
    pageHeartbeatTimer: null,
    scanTokens: new Set()
  };

  const lang = () => globalThis.FTLanguage;
  const exclusions = () => globalThis.FTSiteExclusions;

  function sendRuntime(message, timeoutMs = 15000) {
    if (/^FT_TRANSLATE/.test(String(message?.type || "")) && globalThis.FTStorageRPC?.send) {
      return globalThis.FTStorageRPC.send(message, Math.min(15000, Number(timeoutMs || 15000)));
    }
    if (globalThis.FTMessaging?.runtimeSend) return globalThis.FTMessaging.runtimeSend(message, timeoutMs);
    return chrome.runtime.sendMessage(message);
  }

  function isExcludedElement(element) {
    try { return Boolean(exclusions()?.isExcluded?.(element)); }
    catch { return false; }
  }

  function pageLanguage() {
    return lang()?.normalizeLang(document.documentElement?.lang || document.body?.getAttribute("lang") || "") || "";
  }

  function siteRule() {
    try { return state.settings.siteRules?.[location.hostname] || "default"; }
    catch { return "default"; }
  }

  function shouldTranslatePage() {
    if (!state.settings.enabled) return false;
    const rule = siteRule();
    if (rule === "never") return false;
    if (rule === "always") return true;
    if (!state.settings.autoTranslate) return false;
    if (state.settings.sourceLang !== "auto") return true;
    const page = pageLanguage();
    const target = lang()?.normalizeLang(state.settings.targetLang) || "";
    return !(page && target && page === target);
  }

  function splitWhitespace(value) {
    const match = String(value ?? "").match(/^(\s*)([\s\S]*?)(\s*)$/);
    return { prefix: match?.[1] || "", core: match?.[2] || "", suffix: match?.[3] || "" };
  }

  function hasLetters(text) {
    if (!text || text.trim().length < 2) return false;
    if (/^(https?:\/\/|www\.)\S+$/i.test(text.trim())) return false;
    if (/^[\d\s\p{P}\p{S}_]+$/u.test(text)) return false;
    return /[\p{L}\p{M}]/u.test(text);
  }

  function shouldSkipTarget(text) {
    if (!state.settings.skipTargetLanguage || state.settings.sourceLang !== "auto") return false;
    const helper = lang();
    if (!helper) return false;
    return !helper.shouldTranslateText(text, {
      sourceLang: "auto",
      targetLang: state.settings.targetLang,
      pageLang: pageLanguage()
    });
  }

  function isEligibleTextNode(node) {
    if (!node || node.nodeType !== Node.TEXT_NODE || !node.isConnected) return false;
    const parent = node.parentElement;
    if (!parent || parent.closest(SKIP_SELECTOR) || isExcludedElement(parent)) return false;
    const { core } = splitWhitespace(node.nodeValue);
    return hasLetters(core) && !shouldSkipTarget(core);
  }

  function isUrgentNode(node) {
    if (!state.settings.chatMode) return false;
    try { return Boolean(node.parentElement?.closest("[data-ft-chat-feed='1']")); }
    catch { return false; }
  }

  function createTranslationSpan(node, translatedCore) {
    const span = document.createElement("span");
    span.className = "ft-translation-inline";
    span.dataset.ftOwned = "1";
    span.translate = false;
    span.textContent = translatedCore;
    if (BLOCK_TAGS.has(node.parentElement?.tagName)) span.dataset.ftBlock = "1";
    return span;
  }

  function restoreProtectedNode(node, record) {
    if (!record || !node?.isConnected || !state.active || state.paused || isExcludedElement(node.parentElement)) return false;
    if (node.nodeValue !== record.originalFull) return false;

    if (state.settings.displayMode === "bilingual") {
      if (!record.translationEl?.isConnected) {
        const span = record.translationEl || createTranslationSpan(node, record.translatedCore);
        record.translationEl = span;
        node.parentNode?.insertBefore(span, node.nextSibling);
        state.protectedRestores++;
        return true;
      }
      return false;
    }

    node.nodeValue = record.renderedFull;
    state.protectedRestores++;
    return true;
  }

  function scheduleFlush(delay = 80) {
    if (state.paused || state.processing || state.flushTimer) return;
    state.flushTimer = setTimeout(() => {
      state.flushTimer = null;
      void processQueue();
    }, delay);
  }

  function enqueueNode(node) {
    if (!state.active || state.paused || !isEligibleTextNode(node)) return;
    const previous = state.nodeState.get(node);
    if (previous) {
      const current = node.nodeValue;
      if (current === previous.renderedFull) return;
      if (current === previous.originalFull) {
        restoreProtectedNode(node, previous);
        return;
      }
      previous.translationEl?.remove();
      state.nodeState.delete(node);
      state.trackedNodes.delete(node);
    }

    const target = isUrgentNode(node) ? state.urgentQueue : state.queue;
    target.add(node);
    scheduleFlush();
  }

  function idleCall(callback, timeout = 900) {
    if (typeof requestIdleCallback === "function") {
      requestIdleCallback(callback, { timeout });
    } else {
      setTimeout(() => callback(null), 24);
    }
  }

  function scheduleTreeScan(root = document.body) {
    if (!state.active || state.paused || !root) return;
    if (root.nodeType === Node.TEXT_NODE) {
      enqueueNode(root);
      return;
    }
    if (![Node.ELEMENT_NODE, Node.DOCUMENT_NODE, Node.DOCUMENT_FRAGMENT_NODE].includes(root.nodeType)) return;
    if (root.nodeType === Node.ELEMENT_NODE && (root.matches?.(SKIP_SELECTOR) || isExcludedElement(root))) return;

    const token = { cancelled: false };
    state.scanTokens.add(token);
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);

    const step = deadline => {
      if (token.cancelled || !state.active || state.paused) {
        state.scanTokens.delete(token);
        return;
      }

      const timedOut = Boolean(deadline?.didTimeout);
      const maxNodes = timedOut ? 36 : (deadline ? 120 : 80);
      let count = 0;
      while (count < maxNodes) {
        if (deadline && !timedOut && deadline.timeRemaining() <= 1.5) break;
        const node = walker.nextNode();
        if (!node) {
          state.scanTokens.delete(token);
          return;
        }
        if (isEligibleTextNode(node)) enqueueNode(node);
        count++;
      }

      idleCall(step, 900);
    };

    idleCall(step, 900);
  }

  function cancelScans() {
    for (const token of state.scanTokens) token.cancelled = true;
    state.scanTokens.clear();
    clearTimeout(state.rootFlushTimer);
    state.rootFlushTimer = null;
    state.pendingRoots.clear();
  }

  function queueScanRoot(root) {
    if (!state.active || state.paused || !root) return;
    if (root.nodeType === Node.TEXT_NODE) {
      enqueueNode(root);
      return;
    }
    if (root.nodeType !== Node.ELEMENT_NODE && root.nodeType !== Node.DOCUMENT_FRAGMENT_NODE) return;
    if (root.nodeType === Node.ELEMENT_NODE && root.dataset?.ftOwned === "1") return;

    for (const existing of [...state.pendingRoots]) {
      try {
        if (existing === root || existing.contains?.(root)) return;
        if (root.contains?.(existing)) state.pendingRoots.delete(existing);
      } catch {}
    }
    state.pendingRoots.add(root);

    if (state.rootFlushTimer) return;
    state.rootFlushTimer = setTimeout(() => {
      state.rootFlushTimer = null;
      idleCall(() => {
        const roots = [...state.pendingRoots];
        state.pendingRoots.clear();
        for (const item of roots) scheduleTreeScan(item);
      }, 700);
    }, 55);
  }

  function drainSet(set, batch, budget) {
    for (const node of set) {
      if (batch.length >= 40 || budget.chars >= 16000) break;
      if (!isEligibleTextNode(node)) {
        set.delete(node);
        continue;
      }
      const core = splitWhitespace(node.nodeValue).core;
      if (batch.length && budget.chars + core.length > 16000) break;
      set.delete(node);
      batch.push(node);
      budget.chars += core.length;
    }
  }

  function takeBatch() {
    const batch = [];
    const budget = { chars: 0 };
    drainSet(state.urgentQueue, batch, budget);
    if (batch.length < 40 && budget.chars < 16000) drainSet(state.queue, batch, budget);
    return batch;
  }

  function retryFailedEntries(entries) {
    let maxRetry = 0;
    for (const entry of entries) {
      if (!entry.node?.isConnected || !isEligibleTextNode(entry.node)) continue;
      const retries = (state.nodeRetries.get(entry.node) || 0) + 1;
      state.nodeRetries.set(entry.node, retries);
      if (retries <= 4) {
        (isUrgentNode(entry.node) ? state.urgentQueue : state.queue).add(entry.node);
        state.retried++;
        maxRetry = Math.max(maxRetry, retries);
      }
    }
    if ((!state.queue.size && !state.urgentQueue.size) || state.paused) return;
    clearTimeout(state.retryTimer);
    state.retryTimer = setTimeout(() => {
      state.retryTimer = null;
      scheduleFlush(0);
    }, Math.min(8000, 650 * (2 ** Math.max(0, maxRetry - 1))));
  }

  async function processQueue() {
    if (state.processing || !state.active || state.paused || (!state.queue.size && !state.urgentQueue.size)) return;
    state.processing = true;
    const generation = state.generation;
    let entries = [];

    try {
      const candidates = takeBatch();
      if (!candidates.length) return;
      entries = candidates.map(node => {
        const parts = splitWhitespace(node.nodeValue);
        return { node, parts, originalFull: node.nodeValue };
      }).filter(entry => hasLetters(entry.parts.core));
      if (!entries.length) return;

      const response = await sendRuntime({
        type: "FT_TRANSLATE_DETAILED",
        texts: entries.map(entry => entry.parts.core),
        options: { sourceLang: state.settings.sourceLang, targetLang: state.settings.targetLang }
      });

      if (generation !== state.generation || !state.active) return;
      if (state.paused) {
        for (const entry of entries) if (entry.node?.isConnected) (isUrgentNode(entry.node) ? state.urgentQueue : state.queue).add(entry.node);
        return;
      }
      if (!response?.ok) throw new Error(response?.error || "翻译失败");

      const failedEntries = [];
      let firstError = "";
      entries.forEach((entry, index) => {
        const translated = response.translations?.[index];
        const itemError = response.errors?.[index];
        if (typeof translated === "string" && entry.node.isConnected && !isExcludedElement(entry.node.parentElement)) {
          applyTranslation(entry.node, entry.parts, entry.originalFull, translated);
          state.nodeRetries.delete(entry.node);
          state.processed++;
          return;
        }
        if (isExcludedElement(entry.node?.parentElement)) return;
        failedEntries.push(entry);
        firstError ||= String(itemError || "该文本翻译失败");
      });

      if (failedEntries.length) {
        state.failed += failedEntries.length;
        state.lastError = firstError;
        retryFailedEntries(failedEntries);
      } else {
        state.lastError = "";
      }
    } catch (error) {
      state.failed += Math.max(1, entries.length);
      state.lastError = String(error?.message || error);
      retryFailedEntries(entries);
      console.warn("[FloatingTranslator]", error);
    } finally {
      state.processing = false;
      publishPageStateSoon(20);
      if (state.active && !state.paused && (state.queue.size || state.urgentQueue.size) && !state.retryTimer) scheduleFlush(35);
    }
  }

  function applyTranslation(node, parts, originalFull, translatedCore) {
    const renderedFull = `${parts.prefix}${translatedCore}${parts.suffix}`;
    const record = { originalFull, translatedCore, renderedFull, translationEl: null };
    if (state.settings.displayMode === "bilingual") {
      const span = createTranslationSpan(node, translatedCore);
      node.parentNode?.insertBefore(span, node.nextSibling);
      record.translationEl = span;
    } else {
      node.nodeValue = renderedFull;
    }
    state.nodeState.set(node, record);
    state.trackedNodes.add(node);
  }

  function restorePage() {
    state.generation++;
    cancelScans();
    clearTimeout(state.flushTimer);
    clearTimeout(state.retryTimer);
    state.flushTimer = null;
    state.retryTimer = null;
    state.queue.clear();
    state.urgentQueue.clear();
    for (const node of [...state.trackedNodes]) {
      const record = state.nodeState.get(node);
      if (!record) continue;
      record.translationEl?.remove();
      if (node.isConnected && node.nodeValue === record.renderedFull) node.nodeValue = record.originalFull;
      state.nodeState.delete(node);
    }
    state.trackedNodes.clear();
    state.processed = 0;
    state.failed = 0;
    state.retried = 0;
    state.protectedRestores = 0;
    state.lastError = "";
  }

  async function loadSettings({ rescan = true } = {}) {
    const next = { ...DEFAULTS, ...(await chrome.storage.sync.get(DEFAULTS)) };
    const materiallyChanged = [
      "sourceLang", "targetLang", "displayMode", "enabled", "autoTranslate", "skipTargetLanguage"
    ].some(key => state.settings[key] !== next[key]) || JSON.stringify(state.settings.siteRules) !== JSON.stringify(next.siteRules);

    if (materiallyChanged) restorePage();
    state.settings = next;
    state.active = shouldTranslatePage();
    if (rescan && state.active && !state.paused) queueScanRoot(document.body);
  }

  function handleMutations(mutations) {
    if (!state.active || state.paused) return;
    for (const mutation of mutations) {
      if (mutation.type === "characterData") {
        const node = mutation.target;
        const record = state.nodeState.get(node);
        if (record) {
          if (node.nodeValue === record.renderedFull) continue;
          if (node.nodeValue === record.originalFull) {
            restoreProtectedNode(node, record);
            continue;
          }
        }
        enqueueNode(node);
        continue;
      }

      for (const added of mutation.addedNodes) {
        if (added.nodeType === Node.ELEMENT_NODE && added.dataset?.ftOwned === "1") continue;
        queueScanRoot(added);
      }
    }
  }

  function startObserver() {
    if (state.observer || !document.documentElement) return;
    state.observer = new MutationObserver(handleMutations);
    state.observer.observe(document.documentElement, { subtree: true, childList: true, characterData: true });
  }

  function showSelectionBubble(original, translated, isError = false) {
    document.querySelectorAll(".ft-selection-bubble").forEach(el => el.remove());
    const bubble = document.createElement("div");
    bubble.className = `ft-selection-bubble${isError ? " ft-error" : ""}`;
    bubble.dataset.ftOwned = "1";
    const translatedEl = document.createElement("div");
    translatedEl.className = "ft-selection-result";
    translatedEl.textContent = translated;
    const originalEl = document.createElement("div");
    originalEl.className = "ft-selection-original";
    originalEl.textContent = original;
    bubble.append(translatedEl, originalEl);
    document.documentElement.appendChild(bubble);

    let rect = null;
    try {
      const selection = window.getSelection();
      if (selection?.rangeCount) rect = selection.getRangeAt(0).getBoundingClientRect();
    } catch {}
    bubble.style.top = `${rect ? Math.min(innerHeight - 120, Math.max(10, rect.bottom + 8)) : 20}px`;
    bubble.style.left = `${rect ? Math.min(innerWidth - 320, Math.max(10, rect.left)) : 20}px`;
    setTimeout(() => bubble.classList.add("ft-visible"), 0);
    setTimeout(() => bubble.remove(), 9000);
  }

  async function translateFocusedInput(event) {
    if (!(event.altKey && event.key === "Enter")) return;
    const el = event.target;
    const isTextInput = el instanceof HTMLTextAreaElement || (el instanceof HTMLInputElement && ["text", "search", "email", "url", "tel"].includes(el.type));
    const simpleEditable = el?.isContentEditable && el.children.length === 0;
    if (!isTextInput && !simpleEditable) return;
    const text = isTextInput ? el.value : el.textContent;
    if (!text?.trim()) return;
    event.preventDefault();
    event.stopPropagation();

    try {
      const response = await sendRuntime({
        type: "FT_TRANSLATE",
        texts: [text],
        options: {
          sourceLang: state.settings.chatMode ? state.settings.inputSourceLang : state.settings.sourceLang,
          targetLang: state.settings.chatMode ? state.settings.inputTargetLang : state.settings.targetLang
        }
      });
      if (!response?.ok) throw new Error(response?.error || "翻译失败");
      const translated = response.translations?.[0] || text;
      if (isTextInput) {
        const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
        const descriptor = Object.getOwnPropertyDescriptor(proto, "value");
        if (descriptor?.set) descriptor.set.call(el, translated); else el.value = translated;
        el.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: translated }));
        el.dispatchEvent(new Event("change", { bubbles: true }));
      } else {
        el.textContent = translated;
        el.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: translated }));
      }
    } catch (error) {
      showSelectionBubble(text, `输入框翻译失败：${error?.message || error}`, true);
    }
  }

  function handleRouteRescan() {
    if (!state.active || state.paused) return;
    state.generation++;
    cancelScans();
    state.queue.clear();
    state.urgentQueue.clear();
    setTimeout(() => queueScanRoot(document.body), 320);
  }

  function setPaused(paused) {
    state.paused = Boolean(paused);
    if (state.paused) {
      cancelScans();
      clearTimeout(state.flushTimer);
      clearTimeout(state.retryTimer);
      state.flushTimer = null;
      state.retryTimer = null;
      return;
    }
    if (state.active) {
      queueScanRoot(document.body);
      if (state.queue.size || state.urgentQueue.size) scheduleFlush(0);
    }
  }

  function handleExclusionsChanged() {
    const wasPaused = state.paused;
    restorePage();
    state.paused = wasPaused;
    state.active = shouldTranslatePage();
    if (state.active && !state.paused) queueScanRoot(document.body);
  }

  function pageStateSnapshot() {
    return {
      ok: true,
      active: state.active,
      paused: state.paused,
      host: location.hostname,
      pageLang: pageLanguage(),
      queued: state.queue.size + state.urgentQueue.size,
      processing: state.processing,
      processed: state.processed,
      failed: state.failed,
      retried: state.retried,
      protectedRestores: state.protectedRestores,
      lastError: state.lastError,
      lastCommandId: state.lastCommandId,
      performanceMode: "page-first"
    };
  }

  let pageStatePublishTimer = null;
  function publishPageStateSoon(delay = 0) {
    if (!globalThis.FTPageBridge?.publishPageState || !location.hostname) return;
    clearTimeout(pageStatePublishTimer);
    pageStatePublishTimer = setTimeout(() => {
      pageStatePublishTimer = null;
      globalThis.FTPageBridge.publishPageState(location.hostname, {
        ...pageStateSnapshot(),
        href: location.href
      }).catch(() => {});
    }, Math.max(0, delay));
  }

  function performPageAction(action, payload = {}) {
    if (action === "pause-toggle") setPaused(!state.paused);
    else if (action === "set-paused") setPaused(Boolean(payload.paused));
    else if (action === "translate-now") {
      restorePage();
      state.paused = false;
      state.active = true;
      queueScanRoot(document.body);
    } else if (action === "rescan") {
      handleRouteRescan();
    } else if (action === "restore") {
      state.active = false;
      state.paused = false;
      restorePage();
    } else if (action !== "get-state") {
      throw new Error(`未知快捷操作：${action}`);
    }
  }

  // ZIP 快捷窗直接控制当前页面，不再经后台转发回同一标签页。
  // 这避免 Quetta 对 tabs.sendMessage/runtime.sendMessage 返回形式不同导致快捷窗“看得到但点不动”。
  window.__FT_FAST_DIRECT_FLOATING__ = true;
  window.addEventListener("ft-floating-command", event => {
    const detail = event.detail || {};
    const action = String(detail.action || "get-state");
    try {
      performPageAction(action, detail.payload || {});
      publishPageStateSoon(0);

      window.dispatchEvent(new CustomEvent("ft-floating-state", {
        detail: { ...pageStateSnapshot(), requestId: detail.requestId, bridgeOk: true }
      }));
    } catch (error) {
      window.dispatchEvent(new CustomEvent("ft-floating-state", {
        detail: {
          ...pageStateSnapshot(),
          requestId: detail.requestId,
          bridgeOk: false,
          lastError: String(error?.message || error)
        }
      }));
    }
  });

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === "FT_REFRESH_SETTINGS") {
      loadSettings().then(() => sendResponse({ ok: true, active: state.active, paused: state.paused }));
      return true;
    }
    if (message?.type === "FT_TRANSLATE_NOW") {
      restorePage();
      state.paused = false;
      state.active = true;
      queueScanRoot(document.body);
      sendResponse({ ok: true });
      return false;
    }
    if (message?.type === "FT_RESCAN_PAGE") {
      handleRouteRescan();
      sendResponse({ ok: true, paused: state.paused });
      return false;
    }
    if (message?.type === "FT_SET_PAUSED") {
      setPaused(Boolean(message.paused));
      sendResponse({ ok: true, paused: state.paused, queued: state.queue.size + state.urgentQueue.size });
      return false;
    }
    if (message?.type === "FT_RESTORE_PAGE") {
      state.active = false;
      state.paused = false;
      restorePage();
      sendResponse({ ok: true });
      return false;
    }
    if (message?.type === "FT_SHOW_SELECTION_TRANSLATION") {
      showSelectionBubble(message.original || "", message.translated || "", Boolean(message.error));
      return false;
    }
    if (message?.type === "FT_GET_PAGE_STATE") {
      sendResponse(pageStateSnapshot());
      return false;
    }
    return false;
  });

  function consumePageCommand(command) {
    if (!command?.id || String(command.id) === state.lastCommandId) return false;
    try {
      performPageAction(String(command.action || "get-state"), command.payload || {});
      state.lastError = "";
    } catch (error) {
      state.lastError = String(error?.message || error);
    }
    state.lastCommandId = String(command.id);
    publishPageStateSoon(0);
    return true;
  }

  async function pollPageBridge() {
    clearTimeout(state.pageBridgeTimer);
    if (!globalThis.FTPageBridge?.readPageCommand || !location.hostname) return;
    try {
      const command = await globalThis.FTPageBridge.readPageCommand(location.hostname);
      consumePageCommand(command);
    } catch {}
    state.pageBridgeTimer = setTimeout(pollPageBridge, 180);
  }

  function startPageHeartbeat() {
    clearInterval(state.pageHeartbeatTimer);
    publishPageStateSoon(0);
    state.pageHeartbeatTimer = setInterval(() => publishPageStateSoon(0), 900);
  }

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "sync" && Object.keys(changes).some(key => key in DEFAULTS)) {
      loadSettings().then(() => publishPageStateSoon(0)).catch(() => {});
      return;
    }
    if (area !== "local" || !globalThis.FTPageBridge?.pageCommandKey) return;
    const commandKey = globalThis.FTPageBridge.pageCommandKey(location.hostname);
    consumePageCommand(changes[commandKey]?.newValue);
  });
  document.addEventListener("keydown", translateFocusedInput, true);
  window.addEventListener("ft-route-change", handleRouteRescan, true);
  window.addEventListener("ft-exclusions-changed", handleExclusionsChanged, true);

  function waitForPageLoadBudget() {
    if (document.readyState === "complete") return Promise.resolve();
    return new Promise(resolve => {
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        window.removeEventListener("load", finish, true);
        resolve();
      };
      window.addEventListener("load", finish, { once: true, capture: true });
      setTimeout(finish, 850);
    });
  }

  async function init() {
    if (state.started) return;
    state.started = true;
    try { await exclusions()?.ready; } catch {}
    await loadSettings({ rescan: false });
    await waitForPageLoadBudget();
    startObserver();
    if (state.active && !state.paused) queueScanRoot(document.body);
    startPageHeartbeat();
    void pollPageBridge();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init, { once: true });
  else void init();
})();