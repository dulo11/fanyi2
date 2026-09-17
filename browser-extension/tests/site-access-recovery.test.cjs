const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = rel => fs.readFileSync(path.join(root, rel), 'utf8');
const manifest = JSON.parse(read('manifest.json'));

assert.equal(manifest.manifest_version, 3);
assert.ok(manifest.permissions.includes('activeTab'));
assert.ok(manifest.permissions.includes('scripting'));
assert.ok(manifest.host_permissions.includes('<all_urls>'));
assert.ok(manifest.content_scripts?.[0]?.matches?.includes('<all_urls>'));

const popup = read('popup/popup.js');
const popupHtml = read('popup/popup.html');
const compat = read('compat/browser-api.js');

assert.match(popup, /chrome\.permissions\.contains/);
assert.match(popup, /chrome\.permissions\.request/);
assert.match(popup, /requestSiteAccess/);
assert.match(popup, /repairAttempted = false/);
assert.match(popup, /chrome\.scripting\.executeScript/);
assert.match(popupHtml, /id="siteAccessStatus"/);
assert.match(popupHtml, /id="grantSiteAccess"/);
assert.match(popupHtml, /id="retryInjection"/);
assert.match(compat, /wrapAsync\(chrome\.permissions/);

console.log('site access recovery tests passed');
