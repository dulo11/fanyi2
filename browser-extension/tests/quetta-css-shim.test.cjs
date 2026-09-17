const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = rel => fs.readFileSync(path.join(root, rel), 'utf8');

const shim = read('compat/quetta-css-shim.js');
assert.match(shim, /insertCSS/);
assert.match(shim, /700/);
assert.match(shim, /已跳过样式继续注入脚本/);

const main = read('background/main.js');
assert.match(main, /quetta-css-shim\.js/);
assert.ok(main.indexOf('quetta-css-shim.js') < main.indexOf('page-injector.js'));

const popup = read('popup/popup.html');
assert.match(popup, /quetta-css-shim\.js/);
assert.ok(popup.indexOf('quetta-css-shim.js') < popup.indexOf('popup.js'));

console.log('Quetta CSS shim contract passed');
