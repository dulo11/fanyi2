const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = rel => fs.readFileSync(path.join(root, rel), 'utf8');

const builder = read('tools/build-pure-zip.py');
assert.match(builder, /"content\/content\.js"/);
assert.match(builder, /"content\/attribute-translator\.js"/);
assert.match(builder, /"content\/floating-panel-simple\.js"/);
assert.match(builder, /block\["all_frames"\] = True/);
assert.match(builder, /block\["match_about_blank"\] = True/);
assert.doesNotMatch(builder, /item = "content\/content-fast\.js"/);
assert.doesNotMatch(builder, /item = "content\/attribute-translator-lite\.js"/);

const popup = read('popup/popup-v12.js');
assert.match(popup, /chrome\.tabs\.sendMessage/);
assert.match(popup, /chrome\.runtime\.sendMessage/);
assert.doesNotMatch(popup, /FTPageBridge|FTStorageRPC|storage-rpc/);

const compat = read('compat/browser-api-v12.js');
assert.match(compat, /__FT_BROWSER_FAMILY__/);
assert.doesNotMatch(compat, /runtimeSend|tabsSend|callbackTimeout/);

const content = read('content/content.js');
assert.match(content, /chrome\.runtime\.sendMessage\(\{\s*type:\s*"FT_TRANSLATE_DETAILED"/s);
assert.match(content, /ft-floating-command/);
assert.match(content, /performDirectPageAction/);

const panel = read('content/floating-panel-simple.js');
assert.match(panel, /document\.createElement\("button"\)/);
assert.match(panel, /document\.createElement\("div"\)/);
assert.doesNotMatch(panel, /attachShadow|shadowRoot/);
assert.doesNotMatch(panel, /position:\s*fixed[^\n]*inset:\s*0/i);

console.log('v1.2-core ZIP regression checks passed');
