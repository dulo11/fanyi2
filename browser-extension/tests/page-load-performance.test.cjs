const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = rel => fs.readFileSync(path.join(root, rel), 'utf8');

const fast = read('content/content-fast.js');
const storageRpc = read('shared/storage-rpc-client.js');
const attrs = read('content/attribute-translator-lite.js');
const guard = read('content/frame-performance-guard.js');
const main = read('background/main.js');

// 核心队列禁止恢复为“整队列 + getBoundingClientRect 排序”，这会在长网页上强制布局。
assert.doesNotMatch(fast, /nodePriority/);
assert.doesNotMatch(fast, /\.sort\s*\(/);
assert.match(fast, /urgentQueue/);
assert.match(fast, /maxNodes\s*=\s*timedOut\s*\?\s*36\s*:\s*\(deadline\s*\?\s*120\s*:\s*80\)/);
assert.match(fast, /if \(state\.paused \|\| state\.processing \|\| state\.flushTimer\) return/);
assert.doesNotMatch(fast, /window\.addEventListener\("focus"/);
assert.doesNotMatch(fast, /visibilitychange.*scheduleTreeScan/s);
assert.match(fast, /FTStorageRPC/);
assert.match(storageRpc, /__ft_rpc_request_v1__/);

// 属性翻译初始化只扫一次，动态 DOM 先合并根节点再扫。
assert.match(attrs, /loadSettings\(\{ scanNow: false \}\)/);
assert.match(attrs, /pendingRoots/);
assert.match(attrs, /requestIdleCallback/);
const initialScanCount = (attrs.match(/if \(enabled\(\)\) scan\(document\);/g) || []).length;
assert.equal(initialScanCount, 1);

// Chromium 先注册轻量核心；子 frame 只装守门脚本，不跑整套翻译器。
assert.match(main, /registerContentScripts/);
assert.match(main, /content\/content-fast\.js/);
assert.match(main, /content\/attribute-translator-lite\.js/);
assert.match(main, /content\/frame-performance-guard\.js/);
assert.match(main, /allFrames:\s*false/);
assert.match(main, /allFrames:\s*true/);
assert.match(guard, /window\.top === window/);
assert.match(guard, /__FLOATING_TRANSLATOR_LOADED__/);
assert.match(guard, /__FLOATING_TRANSLATOR_ATTRIBUTES__/);
assert.match(guard, /__FLOATING_TRANSLATOR_V07__/);

console.log('page-load performance safeguards passed');
