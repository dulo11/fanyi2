const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = rel => fs.readFileSync(path.join(root, rel), 'utf8');

// 兼容 shim 仍保留在仓库，方便以后单独调试 CRX；但正常 ZIP/Popup/后台不应全局加载它。
const shim = read('compat/quetta-css-shim.js');
assert.match(shim, /insertCSS/);
assert.match(shim, /700/);
assert.match(shim, /已跳过样式继续注入脚本/);

const main = read('background/main.js');
assert.doesNotMatch(main, /quetta-css-shim\.js/);

const popup = read('popup/popup.html');
assert.doesNotMatch(popup, /quetta-css-shim\.js/);

console.log('Quetta CSS shim isolated from normal ZIP path');
