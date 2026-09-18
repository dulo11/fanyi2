(() => {
  if (globalThis.FTStorageRPC && globalThis.FTPageBridge) return;

  const REQUEST_PREFIX = "__ft_rpc_request_v1__:";
  const RESPONSE_PREFIX = "__ft_rpc_response_v1__:";
  const PAGE_STATE_PREFIX = "__ft_page_state_v1__:";
  const PAGE_COMMAND_PREFIX = "__ft_page_command_v1__:";

  function uid(prefix = "req") {
    try { return `${prefix}-${crypto.randomUUID()}`; }
    catch { return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`; }
  }

  function safeRemove(keys) {
    try {
      const result = chrome.storage.local.remove(keys);
      result?.catch?.(() => {});
    } catch {}
  }

  function storageSend(message, timeoutMs = 60000) {
    return new Promise((resolve, reject) => {
      const id = uid("rpc");
      const requestKey = REQUEST_PREFIX + id;
      const responseKey = RESPONSE_PREFIX + id;
      let settled = false;

      const cleanup = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        try { chrome.storage.onChanged.removeListener(listener); } catch {}
        safeRemove([requestKey, responseKey]);
      };

      const finish = (ok, value) => {
        if (settled) return;
        cleanup();
        ok ? resolve(value) : reject(value instanceof Error ? value : new Error(String(value || "存储通信失败")));
      };

      const listener = (changes, area) => {
        if (area !== "local") return;
        const change = changes[responseKey];
        if (!change?.newValue) return;
        const payload = change.newValue;
        if (payload.ok === false) finish(false, new Error(payload.error || "后台翻译失败"));
        else finish(true, payload.response ?? payload);
      };

      const timer = setTimeout(() => finish(false, new Error("后台翻译响应超时")), Math.max(3000, Number(timeoutMs || 60000)));
      try { chrome.storage.onChanged.addListener(listener); }
      catch (error) { finish(false, error); return; }

      Promise.resolve()
        .then(() => chrome.storage.local.set({
          [requestKey]: { id, message, at: Date.now() }
        }))
        .catch(error => finish(false, error));
    });
  }

  function pageKey(prefix, host) {
    return prefix + String(host || "").trim().toLowerCase();
  }

  async function publishPageState(host, state) {
    if (!host) return;
    const key = pageKey(PAGE_STATE_PREFIX, host);
    await chrome.storage.local.set({
      [key]: { ...(state || {}), host, at: Date.now() }
    });
  }

  async function readPageState(host, maxAgeMs = 15000) {
    if (!host) return null;
    const key = pageKey(PAGE_STATE_PREFIX, host);
    const stored = await chrome.storage.local.get({ [key]: null });
    const value = stored?.[key] || null;
    if (!value) return null;
    if (Number(maxAgeMs) > 0 && Date.now() - Number(value.at || 0) > Number(maxAgeMs)) return null;
    return value;
  }

  async function sendPageCommand(host, action, payload = {}) {
    if (!host) throw new Error("没有当前网站");
    const id = uid("page");
    const key = pageKey(PAGE_COMMAND_PREFIX, host);
    await chrome.storage.local.set({
      [key]: { id, action: String(action || ""), payload, at: Date.now() }
    });
    return id;
  }

  function pageCommandKey(host) {
    return pageKey(PAGE_COMMAND_PREFIX, host);
  }

  globalThis.FTStorageRPC = Object.freeze({
    send: storageSend,
    requestPrefix: REQUEST_PREFIX,
    responsePrefix: RESPONSE_PREFIX
  });

  globalThis.FTPageBridge = Object.freeze({
    publishPageState,
    readPageState,
    sendPageCommand,
    pageCommandKey
  });
})();
