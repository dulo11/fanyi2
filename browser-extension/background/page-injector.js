(() => {
  const state = globalThis.__FT_PAGE_INJECTOR_STATE__ ||= {
    inflight: new Map(),
    attemptedUrl: new Map()
  };

  function isWebUrl(url) {
    return /^https?:\/\//i.test(String(url || ""));
  }

  function lastErrorMessage() {
    try { return chrome?.runtime?.lastError?.message || ""; }
    catch { return ""; }
  }

  function pingTab(tabId, timeoutMs = 1600) {
    return new Promise(resolve => {
      let settled = false;
      const finish = value => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(Boolean(value));
      };
      const timer = setTimeout(() => finish(false), timeoutMs);
      try {
        chrome.tabs.sendMessage(tabId, { type: "FT_GET_PAGE_STATE" }, { frameId: 0 }, response => {
          const error = lastErrorMessage();
          finish(!error && Boolean(response?.ok));
        });
      } catch {
        finish(false);
      }
    });
  }

  function executeSingle(tabId, file) {
    return new Promise((resolve, reject) => {
      const target = { tabId };
      const fail = error => reject(error instanceof Error ? error : new Error(String(error || "注入失败")));
      try {
        if (chrome.scripting?.executeScript) {
          chrome.scripting.executeScript({ target, files: [file] }, result => {
            const message = lastErrorMessage();
            if (message) fail(new Error(message));
            else resolve(result);
          });
          return;
        }
        if (chrome.tabs?.executeScript) {
          chrome.tabs.executeScript(tabId, { file, runAt: "document_idle" }, result => {
            const message = lastErrorMessage();
            if (message) fail(new Error(message));
            else resolve(result);
          });
          return;
        }
        fail(new Error("浏览器没有可用的脚本注入 API"));
      } catch (error) {
        fail(error);
      }
    });
  }

  function insertSingleCss(tabId, file) {
    return new Promise((resolve, reject) => {
      const target = { tabId };
      const fail = error => reject(error instanceof Error ? error : new Error(String(error || "样式注入失败")));
      try {
        if (chrome.scripting?.insertCSS) {
          chrome.scripting.insertCSS({ target, files: [file] }, () => {
            const message = lastErrorMessage();
            if (message) fail(new Error(message));
            else resolve(true);
          });
          return;
        }
        if (chrome.tabs?.insertCSS) {
          chrome.tabs.insertCSS(tabId, { file, runAt: "document_idle" }, () => {
            const message = lastErrorMessage();
            if (message) fail(new Error(message));
            else resolve(true);
          });
          return;
        }
        resolve(false);
      } catch (error) {
        fail(error);
      }
    });
  }

  async function saveDiagnostic(payload) {
    try {
      await chrome.storage.local.set({
        quettaPageInjectorV1: {
          ...payload,
          at: Date.now()
        }
      });
    } catch {}
  }

  async function injectContentScripts(tabId, url, reason = "fallback") {
    if (!Number.isInteger(tabId) || tabId < 0 || !isWebUrl(url)) return false;
    if (state.inflight.has(tabId)) return state.inflight.get(tabId);

    const task = (async () => {
      if (await pingTab(tabId)) {
        await saveDiagnostic({ ok: true, method: "already-connected", tabId, url, reason });
        return true;
      }

      const manifest = chrome.runtime.getManifest();
      const block = manifest.content_scripts?.[0];
      if (!block?.js?.length) throw new Error("manifest 中没有网页脚本列表");

      for (const cssFile of block.css || []) {
        try {
          await insertSingleCss(tabId, cssFile);
        } catch (error) {
          await saveDiagnostic({ ok: false, stage: "css", file: cssFile, error: String(error?.message || error), tabId, url, reason });
          throw new Error(`样式 ${cssFile} 注入失败：${error?.message || error}`);
        }
      }

      for (const jsFile of block.js) {
        try {
          await executeSingle(tabId, jsFile);
        } catch (error) {
          await saveDiagnostic({ ok: false, stage: "js", file: jsFile, error: String(error?.message || error), tabId, url, reason });
          throw new Error(`脚本 ${jsFile} 注入失败：${error?.message || error}`);
        }
      }

      await new Promise(resolve => setTimeout(resolve, 80));
      const connected = await pingTab(tabId, 2500);
      await saveDiagnostic({ ok: connected, method: "sequential-files", tabId, url, reason, error: connected ? "" : "全部文件注入后页面脚本仍未响应" });
      if (!connected) throw new Error("全部文件注入完成，但页面脚本仍未响应");
      return true;
    })()
      .catch(error => {
        console.warn("[浮译] CRX 网页脚本补注入失败", { tabId, url, reason, error: error?.message || error });
        return false;
      })
      .finally(() => state.inflight.delete(tabId));

    state.inflight.set(tabId, task);
    return task;
  }

  function schedule(tabId, url, reason) {
    if (!isWebUrl(url)) return;
    const key = `${tabId}:${url}`;
    if (state.attemptedUrl.get(tabId) === key && reason !== "manual") return;
    state.attemptedUrl.set(tabId, key);
    setTimeout(() => { void injectContentScripts(tabId, url, reason); }, 180);
  }

  try {
    chrome.tabs?.onUpdated?.addListener((tabId, changeInfo, tab) => {
      if (changeInfo.status === "complete") schedule(tabId, tab?.url || changeInfo.url || "", "tab-complete");
    });
  } catch (error) {
    console.warn("[浮译] 无法监听标签页加载完成", error);
  }

  try {
    chrome.tabs?.onActivated?.addListener(activeInfo => {
      chrome.tabs.get?.(activeInfo.tabId, tab => {
        if (lastErrorMessage()) return;
        schedule(activeInfo.tabId, tab?.url || "", "tab-activated");
      });
    });
  } catch {}

  try {
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      if (message?.type !== "FT_REPAIR_CURRENT_PAGE") return undefined;
      const tabId = Number(message.tabId ?? sender?.tab?.id);
      const url = String(message.url || sender?.tab?.url || "");
      injectContentScripts(tabId, url, "manual").then(ok => sendResponse({ ok }));
      return true;
    });
  } catch {}

  globalThis.FTPageInjector = Object.freeze({ injectContentScripts });
})();
