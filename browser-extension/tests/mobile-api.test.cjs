const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const code = fs.readFileSync(path.join(__dirname, '../compat/browser-api.js'), 'utf8');
(async () => {
  let data = { targetLang: 'ja' };
  let inserts = 0;
  const area = {
    get(defaults, cb) { queueMicrotask(() => cb({ ...defaults, ...data })); },
    set(patch, cb) { queueMicrotask(() => { Object.assign(data, patch); cb(); }); },
    remove(key, cb) { delete data[key]; cb(); },
    clear(cb) { data = {}; cb(); }
  };
  const scriptingExecute = opts => { inserts++; return Promise.resolve([{ result: true, opts }]); };
  const scriptingInsertCss = opts => Promise.resolve([{ ok: true, opts }]);
  const chrome = {
    runtime: { sendMessage(msg, cb) { queueMicrotask(() => cb({ ok: true, value: msg.type })); } },
    storage: { sync: area, local: { ...area } },
    tabs: { create(opts, cb) { cb({ id: 7, ...opts }); } },
    scripting: { executeScript: scriptingExecute, insertCSS: scriptingInsertCss }
  };
  const sandbox = { chrome, setTimeout, clearTimeout, console };
  vm.runInNewContext(code, sandbox);
  assert.equal((await chrome.storage.sync.get({ targetLang: 'en' })).targetLang, 'ja');
  await chrome.storage.sync.set({ targetLang: 'zh-CN' });
  assert.equal((await chrome.storage.sync.get({})).targetLang, 'zh-CN');
  assert.equal((await chrome.runtime.sendMessage({ type: 'FT_TRANSLATE' })).ok, true);
  assert.equal(chrome.scripting.executeScript, scriptingExecute);
  assert.equal(chrome.scripting.insertCSS, scriptingInsertCss);
  await chrome.scripting.executeScript({ target: { tabId: 7 } });
  assert.equal(inserts, 1);
  assert.equal((await chrome.tabs.create({ url: 'options' })).id, 7);
  chrome.runtime.lastError = { message: 'Access denied' };
  await assert.rejects(chrome.storage.sync.get({}), /Access denied/);
  console.log('callback mobile APIs + native scripting tests passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
