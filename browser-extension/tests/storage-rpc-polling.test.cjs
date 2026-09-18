const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'shared/storage-rpc-client.js'), 'utf8');
const store = new Map();

function getImpl(query, callback) {
  const out = {};
  if (query && typeof query === 'object' && !Array.isArray(query)) {
    for (const [key, fallback] of Object.entries(query)) out[key] = store.has(key) ? store.get(key) : fallback;
  } else if (typeof query === 'string') {
    if (store.has(query)) out[query] = store.get(query);
  }
  setTimeout(() => callback?.(out), 0);
  return undefined;
}

function setImpl(values, callback) {
  for (const [key, value] of Object.entries(values || {})) {
    store.set(key, value);
    if (key.startsWith('__ft_rpc_request_v1__:')) {
      const id = value.id;
      // 模拟 Quetta：后台确实写回 response，但 content-script 的 storage.onChanged 不触发。
      setTimeout(() => {
        store.set('__ft_rpc_response_v1__:' + id, {
          ok: true,
          response: { ok: true, translations: ['你好'] }
        });
      }, 25);
    }
  }
  setTimeout(() => callback?.(), 0);
  return undefined;
}

function removeImpl(keys, callback) {
  for (const key of Array.isArray(keys) ? keys : [keys]) store.delete(key);
  setTimeout(() => callback?.(), 0);
  return undefined;
}

const chrome = {
  runtime: { lastError: null },
  storage: {
    local: { get: getImpl, set: setImpl, remove: removeImpl },
    onChanged: { addListener() {}, removeListener() {} }
  }
};

const context = {
  globalThis: null,
  chrome,
  setTimeout,
  clearTimeout,
  Date,
  Math,
  Promise,
  Error,
  String,
  Number,
  Object,
  Array
};
context.globalThis = context;
vm.runInNewContext(source, context);

(async () => {
  const result = await context.FTStorageRPC.send({ type: 'FT_TRANSLATE_DETAILED', texts: ['hello'] }, 3000);
  assert.equal(result.ok, true);
  assert.equal(result.translations[0], '你好');

  await context.FTPageBridge.publishPageState('kernelsu.org', { ok: true, processed: 3 });
  const state = await context.FTPageBridge.readPageState('kernelsu.org', 15000);
  assert.equal(state.ok, true);
  assert.equal(state.processed, 3);

  console.log('storage RPC polling survives missing content storage.onChanged');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
