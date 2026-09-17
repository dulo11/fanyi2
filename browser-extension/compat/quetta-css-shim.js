(() => {
  if (globalThis.__FT_QUETTA_CSS_SHIM_READY__) return;
  globalThis.__FT_QUETTA_CSS_SHIM_READY__ = true;

  const scripting = globalThis.chrome?.scripting;
  if (!scripting || typeof scripting.insertCSS !== "function") return;

  const baseInsertCSS = scripting.insertCSS.bind(scripting);

  function lastErrorMessage() {
    try { return chrome?.runtime?.lastError?.message || ""; }
    catch { return ""; }
  }

  function bestEffortInsertCSS(details, callback) {
    let settled = false;
    const finish = (ok, error = "") => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { callback?.({ ok, error }); } catch {}
    };

    // Quetta Android 的固定签名 CRX 上，insertCSS 有时既不返回 Promise，
    // 也不触发 callback。CSS 只影响界面样式，绝不能阻断核心 JS 注入与翻译。
    const timer = setTimeout(() => finish(false, "insertCSS 回调超时，已跳过样式继续注入脚本"), 700);

    try {
      const result = baseInsertCSS(details, () => {
        const message = lastErrorMessage();
        finish(!message, message);
      });
      if (result && typeof result.then === "function") {
        result.then(
          () => finish(true, ""),
          error => finish(false, String(error?.message || error || "insertCSS 失败"))
        );
      }
    } catch (error) {
      finish(false, String(error?.message || error || "insertCSS 失败"));
    }
  }

  const compatInsertCSS = (details, callback) => {
    if (typeof callback === "function") {
      bestEffortInsertCSS(details, () => callback());
      return;
    }
    return new Promise(resolve => {
      bestEffortInsertCSS(details, result => resolve(result));
    });
  };

  try { scripting.insertCSS = compatInsertCSS; }
  catch {
    try { Object.defineProperty(scripting, "insertCSS", { configurable: true, value: compatInsertCSS }); } catch {}
  }
})();
