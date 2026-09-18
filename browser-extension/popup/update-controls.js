(() => {
  const $ = id => document.getElementById(id);
  const versionNode = $("extensionVersion");
  const statusNode = $("updateStatus");
  const checkButton = $("checkExtensionUpdate");
  const applyButton = $("applyExtensionUpdate");
  const openReleaseButton = $("openReleasePage");
  const channelSelect = $("releaseChannel");
  const card = $("updateCard");
  if (!versionNode || !statusNode || !checkButton || !applyButton || !openReleaseButton || !channelSelect || !card) return;

  const manifest = chrome.runtime.getManifest();
  versionNode.textContent = `当前版本：v${manifest.version}`;

  const family = globalThis.__FT_BROWSER_FAMILY__ || "chromium";
  let latestReleaseUrl = "";

  function setStatus(text) {
    statusNode.textContent = text;
  }

  function parseVersion(value) {
    const match = String(value || "").match(/(\d+)\.(\d+)\.(\d+)(?:[-.]?(?:beta|b|rc)[.-]?(\d+)?)?/i);
    if (!match) return null;
    return {
      major: Number(match[1]),
      minor: Number(match[2]),
      patch: Number(match[3]),
      pre: /beta|rc/i.test(match[0]) ? Number(match[4] || 1) : 0
    };
  }

  function compareVersions(a, b) {
    for (const key of ["major", "minor", "patch"]) {
      if (a[key] !== b[key]) return a[key] - b[key];
    }
    if (a.pre === b.pre) return 0;
    if (!a.pre) return 1;
    if (!b.pre) return -1;
    return a.pre - b.pre;
  }

  async function loadChannel() {
    try {
      const local = await chrome.storage.local.get({ releaseChannel: "stable" });
      channelSelect.value = local.releaseChannel === "beta" ? "beta" : "stable";
    } catch {
      channelSelect.value = "stable";
    }
  }

  async function githubReleaseCheck() {
    const channel = channelSelect.value === "beta" ? "beta" : "stable";
    const response = await fetch("https://api.github.com/repos/dulo11/fanyi2/releases?per_page=30", {
      cache: "no-store",
      headers: { "Accept": "application/vnd.github+json" }
    });
    if (!response.ok) throw new Error(`GitHub Release 检查失败：HTTP ${response.status}`);
    const releases = await response.json();
    const candidates = (Array.isArray(releases) ? releases : []).filter(item => {
      if (item?.draft) return false;
      const tag = String(item?.tag_name || "");
      if (channel === "stable") return item.prerelease !== true && /^browser-v\d+\.\d+\.\d+$/i.test(tag);
      return /^browser-(?:beta-)?v/i.test(tag);
    });
    if (!candidates.length) return null;
    candidates.sort((a, b) => {
      const va = parseVersion(a.tag_name);
      const vb = parseVersion(b.tag_name);
      if (va && vb) {
        const cmp = compareVersions(vb, va);
        if (cmp) return cmp;
      }
      return Date.parse(b.published_at || b.created_at || 0) - Date.parse(a.published_at || a.created_at || 0);
    });
    return candidates[0];
  }

  async function requestStandardUpdate() {
    if (family === "firefox" || !manifest.update_url || typeof chrome.runtime.requestUpdateCheck !== "function") return null;
    try {
      return await chrome.runtime.requestUpdateCheck();
    } catch {
      return null;
    }
  }

  async function requestUpdate() {
    checkButton.disabled = true;
    openReleaseButton.hidden = true;
    applyButton.hidden = true;
    latestReleaseUrl = "";
    const channel = channelSelect.value === "beta" ? "Beta" : "Stable";
    setStatus(`正在检查 ${channel} 通道…`);

    try {
      const release = await githubReleaseCheck();
      const current = parseVersion(manifest.version);
      const remote = parseVersion(release?.tag_name || "");
      if (release && remote && current && compareVersions(remote, current) > 0) {
        latestReleaseUrl = String(release.html_url || "");
        const label = release.prerelease ? "Beta" : "稳定版";
        setStatus(`发现${label}更新：${release.tag_name}`);
        openReleaseButton.hidden = !latestReleaseUrl;
        return;
      }

      const standard = await requestStandardUpdate();
      if (standard?.status === "update_available") {
        setStatus(`浏览器已发现更新${standard.version ? ` v${standard.version}` : ""}，正在准备。`);
        applyButton.hidden = false;
      } else if (standard?.status === "throttled") {
        setStatus(`${channel}：GitHub 未发现更高版本；浏览器标准检查暂时限流。`);
      } else {
        setStatus(`${channel}：当前已是最新可用版本 v${manifest.version}`);
      }
    } catch (error) {
      const standard = await requestStandardUpdate();
      if (standard?.status === "update_available") {
        setStatus(`GitHub 检查失败，但浏览器发现更新${standard.version ? ` v${standard.version}` : ""}。`);
        applyButton.hidden = false;
      } else {
        setStatus(`更新检查失败：${error?.message || error}`);
      }
    } finally {
      checkButton.disabled = false;
    }
  }

  channelSelect.addEventListener("change", async () => {
    const value = channelSelect.value === "beta" ? "beta" : "stable";
    try { await chrome.storage.local.set({ releaseChannel: value }); } catch {}
    setStatus(value === "beta" ? "已切换 Beta：会提示预发布版。" : "已切换 Stable：只提示正式版。");
  });

  checkButton.addEventListener("click", requestUpdate);
  openReleaseButton.addEventListener("click", async () => {
    if (!latestReleaseUrl) return;
    try {
      if (chrome.tabs?.create) await chrome.tabs.create({ url: latestReleaseUrl });
      else window.open(latestReleaseUrl, "_blank", "noopener");
    } catch (error) {
      setStatus(`无法打开下载页：${error?.message || error}`);
    }
  });

  applyButton.addEventListener("click", () => {
    setStatus("正在重新加载扩展以应用浏览器已准备好的更新…");
    setTimeout(() => chrome.runtime.reload(), 120);
  });

  if (family === "firefox") {
    applyButton.hidden = true;
  }

  // Quetta 等 Android Chromium 对 runtime.openOptionsPage() 可能无响应。
  // 捕获阶段直接使用 tabs.create 打开扩展内部 options 页面；失败再走后台/标准 API。
  const openOptions = $("openOptions");
  if (openOptions) {
    openOptions.addEventListener("click", async event => {
      event.preventDefault();
      event.stopImmediatePropagation();
      const url = chrome.runtime.getURL("options/options.html");

      try {
        if (chrome.tabs?.create) {
          const created = chrome.tabs.create({ url });
          if (created && typeof created.then === "function") await created;
          window.close?.();
          return;
        }
      } catch {}

      try {
        const response = await chrome.runtime.sendMessage({ type: "FT_OPEN_OPTIONS" });
        if (response?.ok) {
          window.close?.();
          return;
        }
      } catch {}

      try {
        if (typeof chrome.runtime.openOptionsPage === "function") {
          const opened = chrome.runtime.openOptionsPage();
          if (opened && typeof opened.then === "function") await opened;
          window.close?.();
          return;
        }
      } catch {}

      setStatus("当前浏览器无法直接打开高级设置，请到扩展详情页进入选项。");
    }, true);
  }

  loadChannel();
})();
