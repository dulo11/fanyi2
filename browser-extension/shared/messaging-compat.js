(() => {
  if (globalThis.FTMessaging) return;

  function lastErrorMessage() {
    try { return chrome?.runtime?.lastError?.message || ""; }
    catch { return ""; }
  }

  function call(owner, name, args = [], timeoutMs = 15000, label = name) {
    return new Promise((resolve, reject) => {
      const fn = owner?.[name];
      if (typeof fn !== "function") return reject(new Error(`${label}不可用`));
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        reject(new Error(`${label}超时`));
      }, Math.max(1000, timeoutMs));

      const ok = value => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(value);
      };
      const fail = error => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(error instanceof Error ? error : new Error(String(error || `${label}失败`)));
      };

      const callback = value => {
        const message = lastErrorMessage();
        if (message) fail(new Error(message));
        else ok(value);
      };

      try {
        const result = fn.call(owner, ...args, callback);
        if (result && typeof result.then === "function") result.then(ok, fail);
      } catch (error) {
        fail(error);
      }
    });
  }

  globalThis.FTMessaging = Object.freeze({
    runtimeSend(message, timeoutMs = 60000) {
      return call(chrome?.runtime, "sendMessage", [message], timeoutMs, "扩展消息");
    },
    tabsSend(tabId, message, options, timeoutMs = 10000) {
      const args = options ? [tabId, message, options] : [tabId, message];
      return call(chrome?.tabs, "sendMessage", args, timeoutMs, "网页消息");
    },
    tabsQuery(queryInfo, timeoutMs = 5000) {
      return call(chrome?.tabs, "query", [queryInfo], timeoutMs, "读取标签页");
    }
  });
})();
