const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const compat = fs.readFileSync(path.join(root, 'compat/browser-api.js'), 'utf8');
const popup = fs.readFileSync(path.join(root, 'popup/popup.js'), 'utf8');
const injector = fs.readFileSync(path.join(root, 'background/page-injector.js'), 'utf8');

test('Quetta scripting APIs are not forced through callback wrapper', () => {
  assert.doesNotMatch(compat, /wrapAsync\(chrome\.scripting/);
  assert.match(compat, /FT_REPAIR_CURRENT_PAGE/);
});

test('popup repair is delegated to background injector', () => {
  assert.match(popup, /type:\s*"FT_REPAIR_CURRENT_PAGE"/);
  assert.doesNotMatch(popup, /await chrome\.scripting\.executeScript/);
});

test('background injector uses native no-callback scripting path only on manual repair', () => {
  assert.match(injector, /fn\.call\(chrome\.scripting, payload\)/);
  assert.match(injector, /manual-native-sequential/);
  assert.match(injector, /CSS.*不.*阻断|CSS.*继续注入 JS/);
  assert.doesNotMatch(injector, /tabs\?\.onUpdated/);
  assert.doesNotMatch(injector, /tabs\?\.onActivated/);
});
