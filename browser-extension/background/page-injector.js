(() => {
  const state = globalThis.__FT_PAGE_INJECTOR_STATE__ ||= {
    inflight: new Map(),
    lastDiagnostic: null
  };

  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

  function isWebUrl(url) {
    return /^https?:\/\//i.test(String(url || ""));
  }

  function lastErrorMessage() {
    try { return chrome?.runtime?.lastError?.message || ""; }
    catch { return ""; }
  }

  function pingTab(tabId, timeoutMs = 1200) {
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

  async function invokeScripting(name, payload, graceMs = 450) {
    const fn = chrome.scripting?.[name];
    if (typeof fn !== "function") throw new Error(`浏览器没有 scripting.${name}`);

    let result;
    try {
      // Quetta 的固定签名 CRX 在 callback 形式下可能永不回调。
      // 手动修复时直接调用浏览器原生 API，不传 callback。
      result = fn.call(chrome.scripting, payload);
    } catch (error) {
      throw error;
    }

    if (!result || typeof result.then !== "function") {
      await sleep(100);
      return { completed: true, value: result, mode: "fire-and-forget" };
    }

    const raced = await Promise.race([
      Promise.resolve(result).then(
        value => ({ completed: true, value }),
        error => ({ completed: true, error })
      ),
      sleep(graceMs).then(() => ({ completed: false }))
    ]);

    if (raced.completed && raced.error) throw raced.error;
    return raced;
  }

  async function executeSingle(tabId, file) {
    const target = { tabId };
    if (chrome.scripting?.executeScript) {
      return invokeScripting("executeScript", { target, files: [file] }, 500);
    }

    if (chrome.tabs?.executeScript) {
      return new Promise((resolve, reject) => {
        let settled = false;
        const done = (ok, value) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          ok ? resolve(value) : reject(value);
        };
        const timer = setTimeout(() => done(true, { completed: false, mode: "legacy-timeout" }), 700);
        try {
          chrome.tabs.executeScript(tabId, { file, runAt: "document_idle" }, result => {
            const message = lastErrorMessage();
            if (message) done(false, new Error(message));
            else done(true, { completed: true, value: result, mode: "legacy-callback" });
          });
        } catch (error) {
          done(false, error);
        }
      });
    }

    throw new Error("浏览器没有可用的脚本注入 API");
  }

  async function insertSingleCss(tabId, file) {
    const target = { tabId };
    if (chrome.scripting?.insertCSS) {
      return invokeScripting("insertCSS", { target, files: [file] }, 250);
    }

    if (chrome.tabs?.insertCSS) {
      return new Promise(resolve => {
        let settled = false;
        const done = value => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          resolve(value);
        };
        const timer = setTimeout(() => done({ completed: false, mode: "legacy-timeout" }), 350);
        try {
          chrome.tabs.insertCSS(tabId, { file, runAt: "document_idle" }, () => {
            done({ completed: !lastErrorMessage(), mode: "legacy-callback" });
          });
        } catch {
          done({ completed: false, mode: "legacy-error" });
        }
      });
    }

    return { completed: false, mode: "unsupported" };
  }

  async function saveDiagnostic(payload) {
    state.lastDiagnostic = { ...payload, at: Date.now() };
    try {
      await chrome.storage.local.set({ quettaPageInjectorV1: state.lastDiagnostic });
    } catch {}
  }

  async function injectContentScripts(tabId, url, reason = "manual") {
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

      // CSS 只影响界面样式；手动修复时即使 CSS 失败也继续执行翻译 JS。
      for (const cssFile of block.css || []) {
        try {
          const cssResult = await insertSingleCss(tabId, cssFile);
          if (cssResult?.completed === false) {
            await saveDiagnostic({ ok: null, stage: "css-warning", file: cssFile, error: "CSS 注入未确认，已继续注入 JS", tabId, url, reason });
          }
        } catch (error) {
          await saveDiagnostic({ ok: null, stage: "css-warning", file: cssFile, error: String(error?.message || error), tabId, url, reason });
        }
      }

      const uncertainFiles = [];
      for (const jsFile of block.js) {
        try {
          const result = await executeSingle(tabId, jsFile);
          if (result?.completed === false) uncertainFiles.push(jsFile);
        } catch (error) {
          await saveDiagnostic({ ok: false, stage: "js", file: jsFile, error: String(error?.message || error), tabId, url, reason });
          throw new Error(`脚本 ${jsFile} 注入失败：${error?.message || error}`);
        }
      }

      await sleep(180);
      const connected = await pingTab(tabId, 2500);
      await saveDiagnostic({
        ok: connected,
        method: "manual-native-sequential",
        tabId,
        url,
        reason,
        uncertainFiles,
        error: connected ? "" : `脚本已派发但页面仍未响应${uncertainFiles.length ? `；未确认：${uncertainFiles.join(", ")}` : ""}`
      });
      if (!connected) throw new Error(state.lastDiagnostic.error);
      return true;
    })()
      .catch(error => {
        console.warn("[浮译] 手动网页脚本补注入失败", { tabId, url, reason, error: error?.message || error });
        return false;
      })
      .finally(() => state.inflight.delete(tabId));

    state.inflight.set(tabId, task);
    return task;
  }

  // 性能原则：正常 ZIP/标准 Chromium 只走 manifest.content_scripts。
  // 不再监听 tabs.onUpdated / tabs.onActivated，不在页面加载或切换标签时自动 ping/补注入。
  // 只有用户明确点击“重新注入当前网页”时，才触发下面的 CRX 兼容修复路径。
  try {
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      if (message?.type !== "FT_REPAIR_CURRENT_PAGE") return undefined;
      const tabId = Number(message.tabId ?? sender?.tab?.id);
      const url = String(message.url || sender?.tab?.url || "");
      injectContentScripts(tabId, url, "manual").then(ok => {
        sendResponse({ ok, diagnostic: state.lastDiagnostic });
      });
      return true;
    });
  } catch {}

  globalThis.FTPageInjector = Object.freeze({ injectContentScripts });
})();
