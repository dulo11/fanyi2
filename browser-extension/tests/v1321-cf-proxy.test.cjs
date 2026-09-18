const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = rel => fs.readFileSync(path.join(root, rel), 'utf8');

const service = read('background/service-worker.js');
assert.match(service, /googleWebMode:\s*"direct"/);
assert.match(service, /googleWebProxyUrl/);
assert.match(service, /googleWebProxyToken/);
assert.match(service, /googleWebProxyTranslateBatch/);
assert.match(service, /makeGoogleProxyBatches/);
assert.match(service, /translateGoogleMissesViaProxy/);
assert.match(service, /mode === "direct"/);
assert.match(service, /mode !== "auto"/);
assert.match(service, /Google Web CF 中转失败，改为直连/);

const optionsHtml = read('options/options.html');
for (const id of [
  'googleWebMode', 'googleWebProxyUrl', 'googleWebProxyToken',
  'clearGoogleWebProxyToken', 'testGoogleWebProxy', 'googleWebProxyStatus'
]) assert.match(optionsHtml, new RegExp(`id=["']${id}["']`));

const optionsJs = read('options/options.js');
assert.match(optionsJs, /testGoogleWebProxy/);
assert.match(optionsJs, /googleWebProxyUrl/);
assert.match(optionsJs, /googleWebProxyToken/);
assert.match(optionsJs, /X-FT-Token/);
assert.match(optionsJs, /LOCAL_BACKUP_KEYS/);
assert.doesNotMatch(
  optionsJs.match(/const LOCAL_BACKUP_KEYS = \[[\s\S]*?\];/)?.[0] || '',
  /googleWebProxyToken/,
  'proxy token must not be exported by default'
);

const worker = fs.readFileSync(path.resolve(root, '..', 'cloudflare/google-web-proxy/worker.js'), 'utf8');
assert.match(worker, /MAX_ITEMS = 40/);
assert.match(worker, /MAX_TOTAL_CHARS = 20000/);
assert.match(worker, /MAX_ITEM_CHARS = 3400/);
assert.match(worker, /FT_PROXY_TOKEN/);
assert.match(worker, /translate\.googleapis\.com\/translate_a\/single/);
assert.match(worker, /mapLimit\(texts, 6/);
assert.doesNotMatch(worker, /fetch\(payload\?\.url|fetch\(body\?\.url/, 'worker must not be an open arbitrary URL proxy');


const panel = read('content/floating-panel-simple.js');
assert.match(panel, /POSITION_KEY = "floatingPanelPositionV1"/);
assert.match(panel, /DRAG_THRESHOLD = 9/);
assert.match(panel, /pointerdown/);
assert.match(panel, /pointermove/);
assert.match(panel, /pointerup/);
assert.match(panel, /setPointerCapture/);
assert.match(panel, /chrome\.storage\.local\.set/);
assert.match(panel, /restoreFabPosition/);
assert.match(panel, /suppressClick/);
assert.doesNotMatch(panel, /dblclick|double|longpress|long-press/i);

console.log('v1.3.21 CF Google Web proxy contract passed');
