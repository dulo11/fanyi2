(() => {
  function safeImport(path, required = false) {
    try {
      importScripts(path);
      return true;
    } catch (error) {
      console.error(`[浮译 ZIP] 后台模块加载失败：${path}`, error);
      if (required) throw error;
      return false;
    }
  }

  // ZIP 版只走 manifest 原生 content_scripts，不再加载 CRX 注入/权限兼容层。
  // 先尽力清理 v1.3.11 曾经注册过的动态脚本，避免它们继续抢先运行。
  try {
    const unregister = chrome?.scripting?.unregisterContentScripts;
    if (typeof unregister === "function") {
      const result = unregister.call(chrome.scripting, {
        ids: ["ft-page-first-main-v1311", "ft-subframe-guard-v1311"]
      });
      if (result && typeof result.catch === "function") result.catch(() => {});
    }
  } catch {}

  // Android Chromium 个别实现缺少 contextMenus；菜单不是翻译核心，缺失时不阻断后台。
  try {
    if (!globalThis.chrome?.contextMenus) {
      globalThis.chrome.contextMenus = {
        removeAll(callback) { try { callback?.(); } catch {} },
        create() {},
        onClicked: { addListener() {} }
      };
    }
  } catch {}

  // 不导入 compat/browser-api.js；Quetta ZIP 使用浏览器原生 Promise API。
  safeImport("../shared/crypto-lite.js");
  safeImport("../shared/glossary-core.js");
  safeImport("service-worker.js", true);
  safeImport("provider-pool.js");
  safeImport("glossary-runtime.js");
  safeImport("runtime-telemetry.js");
  safeImport("cache-stats.js");
  safeImport("runtime-extras.js");
  safeImport("storage-rpc-server.js");
})();
