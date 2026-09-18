(() => {
  function safeImport(path, required = false) {
    try {
      importScripts(path);
      return true;
    } catch (error) {
      console.error(`[浮译] 后台模块加载失败：${path}`, error);
      if (required) throw error;
      return false;
    }
  }

  // 部分 Android Chromium 对 contextMenus 实现不完整。
  // 它不是翻译核心能力，缺失时用空实现，避免后台 Service Worker 因此整体启动失败。
  try {
    if (!globalThis.chrome?.contextMenus) {
      globalThis.chrome.contextMenus = {
        removeAll(callback) { try { callback?.(); } catch {} },
        create() {},
        onClicked: { addListener() {} }
      };
    } else {
      chrome.contextMenus.removeAll ||= callback => { try { callback?.(); } catch {} };
      chrome.contextMenus.create ||= () => {};
      chrome.contextMenus.onClicked ||= { addListener() {} };
      chrome.contextMenus.onClicked.addListener ||= () => {};
    }
  } catch (error) {
    console.warn("[浮译] contextMenus 兼容层未能安装", error);
  }

  // 正常 ZIP / 标准 Chromium 始终优先走 manifest 原生 content_scripts，
  // 不在后台全局改写 scripting API，也不做页面加载/切换时的自动探测。
  safeImport("../compat/browser-api.js", true);
  safeImport("../shared/crypto-lite.js");
  safeImport("../shared/glossary-core.js");
  safeImport("service-worker.js", true);

  const PAGE_FIRST_SCRIPT_IDS = ["ft-page-first-main-v1311", "ft-subframe-guard-v1311"];

  function lastErrorMessage() {
    try { return chrome?.runtime?.lastError?.message || ""; }
    catch { return ""; }
  }

  function scriptingCall(name, details) {
    const api = chrome?.scripting?.[name];
    if (typeof api !== "function") return Promise.reject(new Error(`scripting.${name} 不可用`));
    return new Promise((resolve, reject) => {
      let settled = false;
      const ok = value => {
        if (settled) return;
        settled = true;
        resolve(value);
      };
      const fail = error => {
        if (settled) return;
        settled = true;
        reject(error instanceof Error ? error : new Error(String(error || `${name} 失败`)));
      };
      try {
        const result = api.call(chrome.scripting, details, value => {
          const message = lastErrorMessage();
          if (message) fail(new Error(message)); else ok(value);
        });
        if (result && typeof result.then === "function") result.then(ok, fail);
      } catch (error) {
        fail(error);
      }
    });
  }

  async function installPageFirstContentScripts() {
    if (!chrome?.scripting?.registerContentScripts) return;

    // 每次扩展后台启动时刷新这两条动态规则，保证更新后的 ZIP 立即使用最新轻量核心。
    try {
      if (chrome.scripting.unregisterContentScripts) {
        await scriptingCall("unregisterContentScripts", { ids: PAGE_FIRST_SCRIPT_IDS }).catch(() => {});
      }

      await scriptingCall("registerContentScripts", [
        {
          id: PAGE_FIRST_SCRIPT_IDS[0],
          matches: ["<all_urls>"],
          js: ["content/content-fast.js", "content/attribute-translator-lite.js"],
          runAt: "document_start",
          allFrames: false,
          persistAcrossSessions: true
        },
        {
          id: PAGE_FIRST_SCRIPT_IDS[1],
          matches: ["<all_urls>"],
          js: ["content/frame-performance-guard.js"],
          runAt: "document_start",
          allFrames: true,
          persistAcrossSessions: true
        }
      ]);
    } catch (error) {
      // 老 Chromium / 个别 Android 浏览器不支持动态注册时，仍回退到 manifest 静态脚本，不影响基本翻译。
      console.warn("[浮译] 页面优先动态脚本注册失败，继续使用静态兼容路径", error);
    }
  }

  void installPageFirstContentScripts();
  try { chrome.runtime?.onStartup?.addListener(() => { void installPageFirstContentScripts(); }); } catch {}

  // Quetta 固定签名 CRX 的补注入器仅保留“手动修复”入口。
  // 只有 Popup 明确发送 FT_REPAIR_CURRENT_PAGE 时才执行，不影响正常 ZIP 翻译性能。
  safeImport("page-injector.js");

  safeImport("provider-pool.js");
  safeImport("glossary-runtime.js");
  safeImport("runtime-telemetry.js");
  safeImport("cache-stats.js");
  safeImport("runtime-extras.js");
  safeImport("storage-rpc-server.js");
})();
