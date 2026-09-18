const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = rel => fs.readFileSync(path.join(root, rel), 'utf8');

const contentJs = read('content/content.js');
assert.match(contentJs, /siteTranslationProfiles/);
assert.match(contentJs, /pageRules/);
assert.match(contentJs, /function normalizedPageKey/);
assert.match(contentJs, /function pageRule/);
assert.match(contentJs, /if \(currentPageRule === "never"\) return false/);
assert.match(contentJs, /if \(currentPageRule === "always"\) return true/);
assert.match(contentJs, /failedNodes:\s*new Set\(\)/);
assert.match(contentJs, /FT_RETRY_FAILED/);
assert.match(contentJs, /failedQueued/);
assert.match(contentJs, /function nodePriority/);
assert.match(contentJs, /rect\.bottom >= -400/);
assert.match(contentJs, /state\.settings\.provider/);

const service = read('background/service-worker.js');
assert.match(service, /cacheMaxBytes:\s*52428800/);
assert.match(service, /lastAccess/);
assert.match(service, /cacheApproxBytes/);
assert.match(service, /shouldCacheTranslation/);
assert.match(service, /remainingBytes <= maxBytes/);

const cacheStats = read('background/cache-stats.js');
assert.match(cacheStats, /bytes/);
assert.match(cacheStats, /oldestAccess/);
assert.match(cacheStats, /newestAccess/);

const pool = read('background/provider-pool.js');
assert.match(pool, /providerRouteLogV1/);
assert.match(pool, /ROUTE_LOG_KEY/);

const telemetry = read('background/runtime-telemetry.js');
assert.match(telemetry, /providerRouteLogV1/);
assert.match(telemetry, /appendRouteLog/);

const popupHtml = read('popup/popup.html');
for (const id of [
  'runSelfCheck', 'selfCheckStatus', 'siteProfileEnabled', 'siteProfileProvider',
  'saveSiteProfile', 'clearSiteProfile', 'retryFailed', 'routeHistory',
  'releaseChannel', 'openReleasePage', 'pageRule', 'pageRuleHint'
]) assert.match(popupHtml, new RegExp(`id=["']${id}["']`));

const popup = read('popup/popup.js');
assert.match(popup, /runSelfCheckAndRepair/);
assert.match(popup, /saveCurrentSiteProfile/);
assert.match(popup, /FT_RETRY_FAILED/);
assert.match(popup, /providerRouteLogV1/);
assert.match(popup, /pageRuleKeyFromTab/);
assert.match(popup, /pageRules/);

const update = read('popup/update-controls.js');
assert.match(update, /releaseChannel/);
assert.match(update, /api\.github\.com\/repos\/dulo11\/fanyi2\/releases/);
assert.match(update, /Stable/);
assert.match(update, /Beta/);

const builder = read('tools/build-pure-zip.py');
assert.match(builder, /update-controls\.js" in popup_html/);
assert.match(builder, /"updateCard" in popup_html/);
assert.match(builder, /"content\/content\.js"/);
assert.doesNotMatch(builder, /item = "content\/content-fast\.js"/);

const panel = read('content/floating-panel-simple.js');
assert.doesNotMatch(panel, /dblclick|double|longpress|long-press/i);

console.log('v1.3.19 stability feature contract passed');
