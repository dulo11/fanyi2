(() => {
  if (globalThis.__FT_STORAGE_RPC_SERVER__) return;
  globalThis.__FT_STORAGE_RPC_SERVER__ = true;

  const REQUEST_PREFIX = "__ft_rpc_request_v1__:";
  const RESPONSE_PREFIX = "__ft_rpc_response_v1__:";
  const inflight = new Set();

  function safeRemove(key) {
    try {
      const result = chrome.storage.local.remove(key);
      result?.catch?.(() => {});
    } catch {}
  }

  async function handleMessage(message) {
    const type = String(message?.type || "");
    if (type === "FT_TRANSLATE" || type === "FT_TRANSLATE_DETAILED") {
      const texts = Array.isArray(message.texts) ? message.texts : [];
      const translations = await globalThis.translateBatch(texts, message.options || {});
      if (type === "FT_TRANSLATE_DETAILED") {
        return { ok: true, translations, errors: new Array(texts.length).fill(null) };
      }
      return { ok: true, translations };
    }
    if (type === "FT_DIAGNOSTICS") {
      const stored = await chrome.storage.local.get({
        translationProvider: "azure",
        fallbackGoogle: true,
        providerPoolLastRouteV1: null,
        translationRuntimeStateV1: null
      });
      return {
        ok: true,
        diagnostics: {
          provider: stored.translationProvider || "azure",
          fallbackGoogle: stored.fallbackGoogle !== false,
          providerPoolLastRoute: stored.providerPoolLastRouteV1 || null,
          lastRuntime: stored.translationRuntimeStateV1 || null
        }
      };
    }
    throw new Error(`存储通信不支持消息：${type || "unknown"}`);
  }

  async function processRequest(key, request) {
    if (!request || inflight.has(key)) return;
    inflight.add(key);
    const id = request.id || key.slice(REQUEST_PREFIX.length);
    const responseKey = RESPONSE_PREFIX + id;
    try {
      const response = await handleMessage(request.message || {});
      await chrome.storage.local.set({ [responseKey]: { ok: true, response, at: Date.now() } });
    } catch (error) {
      try {
        await chrome.storage.local.set({
          [responseKey]: { ok: false, error: String(error?.message || error || "后台处理失败"), at: Date.now() }
        });
      } catch {}
    } finally {
      inflight.delete(key);
      safeRemove(key);
    }
  }

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    for (const [key, change] of Object.entries(changes)) {
      if (!key.startsWith(REQUEST_PREFIX) || !change?.newValue) continue;
      void processRequest(key, change.newValue);
    }
  });

  // Service Worker 被请求唤醒后，如果请求先于监听器加载，也补扫一次。
  Promise.resolve()
    .then(() => chrome.storage.local.get(null))
    .then(all => {
      for (const [key, value] of Object.entries(all || {})) {
        if (key.startsWith(REQUEST_PREFIX) && value) void processRequest(key, value);
      }
    })
    .catch(() => {});
})();
