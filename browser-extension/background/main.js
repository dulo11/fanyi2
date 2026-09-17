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

  // Quetta 固定签名 CRX 的补注入器仅保留“手动修复”入口。
  // 只有 Popup 明确发送 FT_REPAIR_CURRENT_PAGE 时才执行，不影响正常 ZIP 翻译性能。
  safeImport("page-injector.js");

  safeImport("provider-pool.js");
  safeImport("glossary-runtime.js");
  safeImport("runtime-telemetry.js");
  safeImport("cache-stats.js");
  safeImport("runtime-extras.js");
})();
