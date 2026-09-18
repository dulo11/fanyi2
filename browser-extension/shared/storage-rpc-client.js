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

  function lastError() {
    try { return chrome.runtime?.lastError?.message || ""; }
    catch { return ""; }
  }

  function localGet(query) {
    return new Promise((resolve, reject) => {
      let settled = false;
      const ok = value => {
        if (settled) return;
        settled = true;
        resolve(value || {});
      };
      const fail = error => {
        if (settled) return;
        settled = true;
        reject(error instanceof Error ? error : new Error(String(error || "storage.get 失败")));
      };
      const callback = value => {
        const message = lastError();
        if (message) fail(new Error(message));
        else ok(value);
      };
      try {
        const result = chrome.storage.local.get(query, callback);
        if (result && typeof result.then === "function") result.then(ok, fail);
      } catch (error) {
        fail(error);
      }
    });
  }

  function localSet(value) {
    return new Promise((resolve, reject) => {
      let settled = false;
      const ok = () => {
        if (settled) return;
        settled = true;
        resolve();
      };
      const fail = error => {
        if (settled) return;
        settled = true;
        reject(error instanceof Error ? error : new Error(String(error || "storage.set 失败")));
      };
      const callback = () => {
        const message = lastError();
        if (message) fail(new Error(message));
        else ok();
      };
      try {
        const result = chrome.storage.local.set(value, callback);
        if (result && typeof result.then === "function") result.then(ok, fail);
      } catch (error) {
        fail(error);
      }
    });
  }

  function localRemove(keys) {
    return new Promise(resolve => {
      let settled = false;
      const done = () => {
        if (settled) return;
        settled = true;
        resolve();
      };
      try {
        const result = chrome.storage.local.remove(keys, done);
        if (result && typeof result.then === "function") result.then(done, done);
      } catch {
        done();
      }
    });
  }

  function storageSend(message, timeoutMs = 15000) {
    return new Promise((resolve, reject) => {
      const id = uid("rpc");
      const requestKey = REQUEST_PREFIX + id;
      const responseKey = RESPONSE_PREFIX + id;
      const timeout = Math.max(3000, Math.min(30000, Number(timeoutMs || 15000)));
      const started = Date.now();
      let settled = false;
      let pollTimer = null;
      let listenerInstalled = false;

      const cleanup = () => {
        if (settled) return;
        settled = true;
        clearTimeout(pollTimer);
        try {
          if (listenerInstalled) chrome.storage.onChanged.removeListener(listener);
        } catch {}
        void localRemove([requestKey, responseKey]);
      };

      const finish = (ok, value) => {
        if (settled) return;
        cleanup();
        ok ? resolve(value) : reject(value instanceof Error ? value : new Error(String(value || "存储通信失败")));
      };

      const consume = payload => {
        if (!payload) return false;
        if (payload.ok === false) finish(false, new Error(payload.error || "后台翻译失败"));
        else finish(true, payload.response ?? payload);
        return true;
      };

      const listener = (changes, area) => {
        if (area !== "local") return;
        consume(changes[responseKey]?.newValue);
      };

      async function poll() {
        if (settled) return;
        if (Date.now() - started >= timeout) {
          finish(false, new Error("后台翻译响应超时"));
          return;
        }
        try {
          const stored = await localGet({ [responseKey]: null });
          if (consume(stored?.[responseKey])) return;
        } catch {}
        if (!settled) pollTimer = setTimeout(poll, 80);
      }

      try {
        chrome.storage.onChanged.addListener(listener);
        listenerInstalled = true;
      } catch {}

      localSet({
        [requestKey]: { id, message, at: Date.now() }
      }).then(() => poll()).catch(error => finish(false, error));
    });
  }

  function pageKey(prefix, host) {
    return prefix + String(host || "").trim().toLowerCase();
  }

  async function publishPageState(host, state) {
    if (!host) return;
    const key = pageKey(PAGE_STATE_PREFIX, host);
    await localSet({
      [key]: { ...(state || {}), host, at: Date.now() }
    });
  }

  async function readPageState(host, maxAgeMs = 15000) {
    if (!host) return null;
    const key = pageKey(PAGE_STATE_PREFIX, host);
    const stored = await localGet({ [key]: null });
    const value = stored?.[key] || null;
    if (!value) return null;
    if (Number(maxAgeMs) > 0 && Date.now() - Number(value.at || 0) > Number(maxAgeMs)) return null;
    return value;
  }

  async function sendPageCommand(host, action, payload = {}) {
    if (!host) throw new Error("没有当前网站");
    const id = uid("page");
    const key = pageKey(PAGE_COMMAND_PREFIX, host);
    await localSet({
      [key]: { id, action: String(action || ""), payload, at: Date.now() }
    });
    return id;
  }

  async function readPageCommand(host) {
    if (!host) return null;
    const key = pageKey(PAGE_COMMAND_PREFIX, host);
    const stored = await localGet({ [key]: null });
    return stored?.[key] || null;
  }

  function pageCommandKey(host) {
    return pageKey(PAGE_COMMAND_PREFIX, host);
  }

  globalThis.FTStorageRPC = Object.freeze({
    send: storageSend,
    localGet,
    localSet,
    localRemove,
    requestPrefix: REQUEST_PREFIX,
    responsePrefix: RESPONSE_PREFIX
  });

  globalThis.FTPageBridge = Object.freeze({
    publishPageState,
    readPageState,
    sendPageCommand,
    readPageCommand,
    pageCommandKey
  });
})();
