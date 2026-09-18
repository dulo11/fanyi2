const FT_STATS_DB_NAME = "floating-translator-cache";
const FT_STATS_DB_VERSION = 1;
const FT_STATS_STORE = "translations";

function ftOpenStatsDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(FT_STATS_DB_NAME, FT_STATS_DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(FT_STATS_STORE)) db.createObjectStore(FT_STATS_STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function ftApproxBytes(key, value) {
  const text = typeof value === "string" ? value : String(value?.text || "");
  if (value && typeof value === "object" && Number(value.bytes) > 0) return Number(value.bytes);
  try { return new TextEncoder().encode(String(key || "") + text).byteLength + 96; }
  catch { return (String(key || "").length + text.length) * 2 + 96; }
}

async function ftCacheStats() {
  const db = await ftOpenStatsDb();
  return await new Promise((resolve, reject) => {
    const stats = { entries: 0, bytes: 0, oldestAccess: 0, newestAccess: 0 };
    const tx = db.transaction(FT_STATS_STORE, "readonly");
    const request = tx.objectStore(FT_STATS_STORE).openCursor();
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) return resolve(stats);
      const value = cursor.value;
      const at = Number(value?.lastAccess || value?.ts || 0);
      stats.entries++;
      stats.bytes += ftApproxBytes(cursor.key, value);
      if (at > 0 && (!stats.oldestAccess || at < stats.oldestAccess)) stats.oldestAccess = at;
      if (at > stats.newestAccess) stats.newestAccess = at;
      cursor.continue();
    };
    request.onerror = () => reject(request.error);
  });
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== "FT_CACHE_STATS") return false;
  ftCacheStats()
    .then(stats => sendResponse({ ok: true, ...stats }))
    .catch(error => sendResponse({ ok: false, error: String(error?.message || error) }));
  return true;
});
