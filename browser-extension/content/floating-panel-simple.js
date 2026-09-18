(() => {
  if (window.top !== window || window.__FT_SIMPLE_FLOATING_PANEL__) return;
  window.__FT_SIMPLE_FLOATING_PANEL__ = true;

  const PREFIX = "ftv12";
  const settingsDefaults = {
    enabled: true,
    autoTranslate: true,
    sourceLang: "auto",
    targetLang: "zh-CN"
  };
  let settings = { ...settingsDefaults };
  let state = { active: false, paused: false, queued: 0, processed: 0, failed: 0, lastError: "" };
  let opened = false;
  let requestId = 0;
  const POSITION_KEY = "floatingPanelPositionV1";
  const DRAG_THRESHOLD = 9;
  let drag = null;
  let suppressClick = false;

  const style = document.createElement("style");
  style.dataset.ftOwned = "1";
  style.textContent = `
    #${PREFIX}-fab {
      position: fixed !important; right: 18px !important; bottom: 92px !important;
      width: 54px !important; height: 54px !important; z-index: 2147483647 !important;
      border: 0 !important; border-radius: 18px !important; margin: 0 !important;
      padding: 0 !important; background: #6750e8 !important; color: #fff !important;
      font: 800 22px/54px system-ui,-apple-system,"Noto Sans SC",sans-serif !important;
      text-align: center !important; box-shadow: 0 8px 24px rgba(0,0,0,.28) !important;
      appearance: none !important; -webkit-appearance: none !important;
      touch-action: none !important; user-select: none !important; -webkit-user-select: none !important;
    }
    #${PREFIX}-panel {
      position: fixed !important; right: 12px !important; bottom: 156px !important;
      width: min(320px, calc(100vw - 24px)) !important; max-height: min(520px, calc(100vh - 190px)) !important;
      overflow: auto !important; z-index: 2147483647 !important; display: none !important;
      box-sizing: border-box !important; padding: 14px !important; border-radius: 18px !important;
      border: 1px solid rgba(80,80,100,.2) !important; background: rgba(252,252,255,.985) !important;
      color: #202124 !important; box-shadow: 0 14px 42px rgba(0,0,0,.30) !important;
      font: 14px/1.45 system-ui,-apple-system,"Noto Sans SC",sans-serif !important;
    }
    #${PREFIX}-panel[data-open="1"] { display: block !important; }
    #${PREFIX}-panel * { box-sizing: border-box !important; font-family: inherit !important; }
    #${PREFIX}-head { display:flex !important; align-items:center !important; gap:8px !important; margin-bottom:10px !important; }
    #${PREFIX}-title { font-weight:800 !important; font-size:17px !important; flex:1 !important; }
    #${PREFIX}-close { width:34px !important; height:34px !important; border:0 !important; border-radius:10px !important; background:#ececf2 !important; font-size:20px !important; }
    #${PREFIX}-status { background:#f2f2f7 !important; border-radius:11px !important; padding:9px 10px !important; margin-bottom:10px !important; color:#555 !important; font-size:12px !important; word-break:break-word !important; }
    #${PREFIX}-panel label { display:flex !important; align-items:center !important; gap:9px !important; margin:9px 1px !important; }
    #${PREFIX}-panel input[type="checkbox"] { width:19px !important; height:19px !important; }
    #${PREFIX}-grid { display:grid !important; grid-template-columns:1fr 1fr !important; gap:8px !important; margin-top:10px !important; }
    #${PREFIX}-grid button, #${PREFIX}-full {
      min-height:42px !important; border:1px solid #d8d6e4 !important; border-radius:12px !important;
      background:#fff !important; color:#27262d !important; font-weight:700 !important; font-size:13px !important;
      padding:7px !important; touch-action:manipulation !important;
    }
    #${PREFIX}-pause { background:#6750e8 !important; color:#fff !important; border-color:#6750e8 !important; }
    #${PREFIX}-full { width:100% !important; margin-top:9px !important; background:#f0edff !important; color:#4d37c8 !important; }
  `;

  const fab = document.createElement("button");
  fab.id = `${PREFIX}-fab`;
  fab.type = "button";
  fab.dataset.ftOwned = "1";
  fab.textContent = "译";
  fab.setAttribute("aria-label", "打开浮译");

  const panel = document.createElement("div");
  panel.id = `${PREFIX}-panel`;
  panel.dataset.ftOwned = "1";
  panel.innerHTML = `
    <div id="${PREFIX}-head">
      <strong id="${PREFIX}-title">浮译</strong>
      <button id="${PREFIX}-close" type="button">×</button>
    </div>
    <div id="${PREFIX}-status">正在读取页面状态…</div>
    <label><input id="${PREFIX}-enabled" type="checkbox">启用翻译</label>
    <label><input id="${PREFIX}-auto" type="checkbox">自动持续翻译网页</label>
    <div id="${PREFIX}-grid">
      <button id="${PREFIX}-pause" type="button">暂停</button>
      <button id="${PREFIX}-translate" type="button">翻译整页</button>
      <button id="${PREFIX}-rescan" type="button">补扫遗漏</button>
      <button id="${PREFIX}-restore" type="button">恢复原文</button>
    </div>
    <button id="${PREFIX}-full" type="button">打开完整设置</button>
  `;

  const $ = suffix => panel.querySelector(`#${PREFIX}-${suffix}`);

  function snapshotText() {
    const parts = [state.paused ? "已暂停" : (state.active ? "持续翻译中" : "未运行")];
    if (state.processing) parts.push("处理中");
    if (state.queued) parts.push(`待翻 ${state.queued}`);
    if (state.processed) parts.push(`已翻 ${state.processed}`);
    if (state.failed) parts.push(`失败 ${state.failed}`);
    if (state.lastError) parts.push(`错误：${state.lastError}`);
    return parts.join(" · ");
  }

  function render() {
    $("enabled").checked = settings.enabled !== false;
    $("auto").checked = settings.autoTranslate !== false;
    $("pause").textContent = state.paused ? "继续" : "暂停";
    $("status").textContent = snapshotText();
  }

  function requestState() {
    requestId++;
    window.dispatchEvent(new CustomEvent("ft-floating-command", {
      detail: { action: "get-state", requestId }
    }));
  }

  function command(action) {
    requestId++;
    window.dispatchEvent(new CustomEvent("ft-floating-command", {
      detail: { action, requestId }
    }));
    setTimeout(requestState, 120);
  }

  function clampFabPosition(left, top) {
    const width = fab.offsetWidth || 54;
    const height = fab.offsetHeight || 54;
    const margin = 6;
    return {
      left: Math.max(margin, Math.min(window.innerWidth - width - margin, Math.round(left))),
      top: Math.max(margin, Math.min(window.innerHeight - height - margin, Math.round(top)))
    };
  }

  function applyFabPosition(left, top) {
    const pos = clampFabPosition(left, top);
    fab.style.setProperty("left", `${pos.left}px`, "important");
    fab.style.setProperty("top", `${pos.top}px`, "important");
    fab.style.setProperty("right", "auto", "important");
    fab.style.setProperty("bottom", "auto", "important");
    if (opened) positionPanel();
    return pos;
  }

  function positionPanel() {
    const rect = fab.getBoundingClientRect();
    const panelWidth = Math.min(320, Math.max(220, window.innerWidth - 24));
    const gap = 10;
    let left = rect.right - panelWidth;
    left = Math.max(12, Math.min(window.innerWidth - panelWidth - 12, left));

    panel.style.setProperty("width", `${panelWidth}px`, "important");
    panel.style.setProperty("right", "auto", "important");
    panel.style.setProperty("bottom", "auto", "important");

    const measuredHeight = Math.min(panel.scrollHeight || 320, Math.max(180, window.innerHeight - 24));
    let top = rect.top - measuredHeight - gap;
    if (top < 12) top = rect.bottom + gap;
    top = Math.max(12, Math.min(window.innerHeight - measuredHeight - 12, top));
    panel.style.setProperty("left", `${Math.round(left)}px`, "important");
    panel.style.setProperty("top", `${Math.round(top)}px`, "important");
    panel.style.setProperty("max-height", `${Math.max(160, window.innerHeight - top - 12)}px`, "important");
  }

  async function saveFabPosition(pos) {
    try {
      await chrome.storage.local.set({
        [POSITION_KEY]: {
          left: Math.round(pos.left),
          top: Math.round(pos.top)
        }
      });
    } catch {}
  }

  async function restoreFabPosition() {
    try {
      const stored = await chrome.storage.local.get({ [POSITION_KEY]: null });
      const pos = stored[POSITION_KEY];
      if (pos && Number.isFinite(Number(pos.left)) && Number.isFinite(Number(pos.top))) {
        applyFabPosition(Number(pos.left), Number(pos.top));
      }
    } catch {}
  }

  function endDrag(pointerId) {
    if (!drag || (pointerId != null && drag.pointerId !== pointerId)) return;
    const wasDragging = drag.moved;
    if (wasDragging) {
      const rect = fab.getBoundingClientRect();
      const pos = clampFabPosition(rect.left, rect.top);
      applyFabPosition(pos.left, pos.top);
      void saveFabPosition(pos);
      suppressClick = true;
      setTimeout(() => { suppressClick = false; }, 180);
    }
    try { fab.releasePointerCapture?.(drag.pointerId); } catch {}
    drag = null;
  }

  fab.addEventListener("pointerdown", event => {
    if (event.button != null && event.button !== 0) return;
    const rect = fab.getBoundingClientRect();
    drag = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      startLeft: rect.left,
      startTop: rect.top,
      moved: false
    };
    try { fab.setPointerCapture?.(event.pointerId); } catch {}
  }, true);

  fab.addEventListener("pointermove", event => {
    if (!drag || drag.pointerId !== event.pointerId) return;
    const dx = event.clientX - drag.startX;
    const dy = event.clientY - drag.startY;
    if (!drag.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
    drag.moved = true;
    event.preventDefault();
    event.stopPropagation();
    applyFabPosition(drag.startLeft + dx, drag.startTop + dy);
  }, true);

  fab.addEventListener("pointerup", event => endDrag(event.pointerId), true);
  fab.addEventListener("pointercancel", event => endDrag(event.pointerId), true);

  function setOpen(value) {
    opened = Boolean(value);
    panel.dataset.open = opened ? "1" : "0";
    fab.setAttribute("aria-expanded", opened ? "true" : "false");
    if (opened) { positionPanel(); requestState(); }
  }

  async function saveSetting(patch) {
    settings = { ...settings, ...patch };
    render();
    try { await chrome.storage.sync.set(patch); } catch {}
  }

  fab.addEventListener("click", event => {
    event.preventDefault();
    event.stopPropagation();
    if (suppressClick) return;
    setOpen(!opened);
  }, true);

  $("close").addEventListener("click", event => {
    event.preventDefault();
    event.stopPropagation();
    setOpen(false);
  }, true);

  $("enabled").addEventListener("change", event => saveSetting({ enabled: event.target.checked }));
  $("auto").addEventListener("change", event => saveSetting({ autoTranslate: event.target.checked }));
  $("pause").addEventListener("click", () => command("pause-toggle"));
  $("translate").addEventListener("click", () => command("translate-now"));
  $("rescan").addEventListener("click", () => command("rescan"));
  $("restore").addEventListener("click", () => command("restore"));
  $("full").addEventListener("click", async () => {
    try {
      const result = chrome.runtime.openOptionsPage?.();
      if (result && typeof result.then === "function") await result;
      setOpen(false);
    } catch (error) {
      state.lastError = String(error?.message || error);
      render();
    }
  });

  window.addEventListener("ft-floating-state", event => {
    if (!event.detail) return;
    state = { ...state, ...event.detail };
    render();
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "sync") return;
    for (const key of Object.keys(settingsDefaults)) {
      if (changes[key]) settings[key] = changes[key].newValue;
    }
    render();
  });

  async function init() {
    try { settings = { ...settingsDefaults, ...(await chrome.storage.sync.get(settingsDefaults)) }; }
    catch {}
    document.documentElement.appendChild(style);
    document.documentElement.appendChild(fab);
    document.documentElement.appendChild(panel);
    await restoreFabPosition();
    render();
    requestState();
    setInterval(() => { if (opened) requestState(); }, 1200);
    window.addEventListener("resize", () => {
      const rect = fab.getBoundingClientRect();
      const pos = clampFabPosition(rect.left, rect.top);
      applyFabPosition(pos.left, pos.top);
      if (opened) positionPanel();
    }, { passive: true });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init, { once: true });
  else init();
})();
