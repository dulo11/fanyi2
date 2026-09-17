const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = rel => fs.readFileSync(path.join(root, rel), 'utf8');

const main = read('background/main.js');
const injector = read('background/page-injector.js');

assert.match(main, /page-injector\.js/);
assert.doesNotMatch(main, /quetta-css-shim\.js/);
assert.match(injector, /FT_GET_PAGE_STATE/);
assert.match(injector, /chrome\.scripting\?\.executeScript/);
assert.match(injector, /files:\s*\[file\]/);
assert.match(injector, /chrome\.tabs\?\.executeScript/);
assert.match(injector, /const target = \{ tabId \}/);
assert.match(injector, /quettaPageInjectorV1/);
assert.match(injector, /FT_REPAIR_CURRENT_PAGE/);
assert.doesNotMatch(injector, /frameIds:\s*\[0\]/);
assert.doesNotMatch(injector, /tabs\?\.onUpdated/);
assert.doesNotMatch(injector, /tabs\?\.onActivated/);
assert.match(injector, /正常 ZIP\/标准 Chromium 只走 manifest\.content_scripts/);

console.log('Quetta manual-only page injector tests passed');
