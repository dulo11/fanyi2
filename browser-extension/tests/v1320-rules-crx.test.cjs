const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const repoRoot = path.resolve(root, '..');
const read = rel => fs.readFileSync(path.join(root, rel), 'utf8');
const readRepo = rel => fs.readFileSync(path.join(repoRoot, rel), 'utf8');

const contentJs = read('content/content.js');
assert.match(contentJs, /urlPatternRules/);
assert.match(contentJs, /function patternRule\(\)/);
assert.match(contentJs, /function temporarySkipActive\(\)/);
assert.match(contentJs, /FT_SET_TEMP_PAGE_SKIP/);
assert.match(contentJs, /temporarySkipped/);

const shouldStart = contentJs.indexOf('function shouldTranslatePage()');
const shouldEnd = contentJs.indexOf('function splitWhitespace', shouldStart);
const shouldBlock = contentJs.slice(shouldStart, shouldEnd);
const tempIndex = shouldBlock.indexOf('temporarySkipActive()');
const pageIndex = shouldBlock.indexOf('pageRule()');
const wildcardIndex = shouldBlock.indexOf('patternRule()');
const siteIndex = shouldBlock.indexOf('siteRule()');
assert.ok(tempIndex >= 0 && pageIndex > tempIndex && wildcardIndex > pageIndex && siteIndex > wildcardIndex,
  'rule priority must be temporary page > exact page > wildcard > site');

const popupHtml = read('popup/popup.html');
assert.match(popupHtml, /id="tempPageSkip"/);
assert.match(popupHtml, /id="wildcardRuleStatus"/);

const popup = read('popup/popup.js');
assert.match(popup, /FT_SET_TEMP_PAGE_SKIP/);
assert.match(popup, /tempPageSkipped/);
assert.match(popup, /urlPatternRules/);

const optionsHtml = read('options/options.html');
for (const id of ['ruleManagerSection', 'ruleSearch', 'urlPatternInput', 'urlPatternAction', 'addUrlPatternRule', 'ruleManagerList']) {
  assert.match(optionsHtml, new RegExp(`id=["']${id}["']`));
}

const options = read('options/options.js');
assert.match(options, /normalizeUrlPatternInput/);
assert.match(options, /refreshRuleManager/);
assert.match(options, /updateManagedRule/);
assert.match(options, /deleteManagedRule/);
assert.match(options, /urlPatternRules/);

const signedBuilder = read('tools/build-signed-crx-dir.py');
assert.match(signedBuilder, /build-pure-zip\.py/);
assert.match(signedBuilder, /background\/main-zip\.js/);
assert.match(signedBuilder, /extension-update-channel\/updates\.xml/);
assert.match(signedBuilder, /content\/floating-panel-simple\.js/);

const signedWorkflow = readRepo('.github/workflows/publish-signed-crx.yml');
assert.match(signedWorkflow, /workflow_run:/);
assert.match(signedWorkflow, /Publish Pure Chromium ZIP/);
assert.match(signedWorkflow, /Add CRX assets without replacing ZIP/);
assert.match(signedWorkflow, /build-signed-crx-dir\.py/);
assert.doesNotMatch(signedWorkflow, /FloatingTranslator-Chromium-v\$\{VERSION\}\.zip/);

console.log('v1.3.20 rules + signed CRX contract passed');
