#!/usr/bin/env python3
import json
import re
import shutil
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
REPO = ROOT.parent
VERSION = (ROOT / "ZIP_VERSION").read_text(encoding="utf-8").strip()
if not re.fullmatch(r"\d+\.\d+\.\d+", VERSION):
    raise SystemExit(f"invalid ZIP_VERSION: {VERSION!r}")

out = Path(sys.argv[1]) if len(sys.argv) > 1 else REPO / "build" / "chromium-pure-zip"
out = out.resolve()
if out.exists():
    shutil.rmtree(out)
shutil.copytree(ROOT, out)

manifest_path = out / "manifest.json"
manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
manifest["version"] = VERSION
manifest["description"] = "浮译浏览器版：Quetta ZIP 原生模式、页面优先性能、多引擎与持续网页翻译。"
manifest.pop("update_url", None)
manifest["background"]["service_worker"] = "background/main-zip.js"

block = manifest["content_scripts"][0]
new_js = []
for item in block["js"]:
    if item in ("compat/browser-api.js", "content/floating-panel-bridge.js", "shared/messaging-compat.js"):
        continue
    if item == "content/content.js":
        item = "content/content-fast.js"
    elif item == "content/attribute-translator.js":
        item = "content/attribute-translator-lite.js"
    new_js.append(item)
block["js"] = new_js
block["all_frames"] = False
block["match_about_blank"] = False
manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

popup_html_path = out / "popup" / "popup.html"
popup_html = popup_html_path.read_text(encoding="utf-8")
popup_html = re.sub(r'\n\s*<section class="card" id="siteAccessCard">.*?</section>\n', "\n", popup_html, flags=re.S)
popup_html = re.sub(r'\n\s*<section class="card" id="updateCard">.*?</section>\n', "\n", popup_html, flags=re.S)
popup_html = popup_html.replace('  <script src="../compat/browser-api.js"></script>\n', "")
popup_html = popup_html.replace('  <script src="../shared/messaging-compat.js"></script>\n', "")
popup_html = popup_html.replace("固定签名版继续保护已经翻好的文字；", "ZIP 版继续保护已经翻好的文字；")
popup_html_path.write_text(popup_html, encoding="utf-8")

popup_js_path = out / "popup" / "popup.js"
popup_js = popup_js_path.read_text(encoding="utf-8")
popup_js = re.sub(
    r'async function repairPage\(\) \{.*?\n\}\n\nasync function sendToPage\(message\) \{.*?\n\}\n\nasync function loadSiteInputProfile',
    '''async function repairPage() {
  throw new Error("ZIP 版不使用补注入，请刷新当前网页");
}

async function sendToPage(message) {
  if (!activeTab?.id) return null;
  try {
    const response = await chrome.tabs.sendMessage(activeTab.id, message);
    if (!response) throw new Error("网页脚本没有响应");
    pageError = "";
    return response;
  } catch (error) {
    pageError = String(error?.message || error || "网页脚本未连接");
    return null;
  }
}

async function loadSiteInputProfile''',
    popup_js,
    flags=re.S,
)
popup_js = popup_js.replace(
    "void Promise.allSettled([refreshSiteAccess(), refreshPageState(), refreshExclusions(), refreshRuntimeRoute()]);",
    "void Promise.allSettled([refreshPageState(), refreshExclusions(), refreshRuntimeRoute()]);",
)
popup_js_path.write_text(popup_js, encoding="utf-8")

options_path = out / "options" / "options.html"
options = options_path.read_text(encoding="utf-8").replace('  <script src="../compat/browser-api.js"></script>\n', "")
options_path.write_text(options, encoding="utf-8")

for path in [
    out / "tests",
    out / "compat" / "firefox",
]:
    if path.exists():
        shutil.rmtree(path)

for path in [
    out / "compat" / "browser-api.js",
    out / "background" / "page-injector.js",
    out / "background" / "main.js",
    out / "content" / "content.js",
    out / "content" / "attribute-translator.js",
    out / "content" / "frame-performance-guard.js",
]:
    if path.exists():
        path.unlink()

assert manifest["background"]["service_worker"] == "background/main-zip.js"
assert "update_url" not in manifest
assert "compat/browser-api.js" not in block["js"]
assert "content/floating-panel-bridge.js" not in block["js"]
assert "shared/messaging-compat.js" not in block["js"]
assert "content/content-fast.js" in block["js"]
assert "content/attribute-translator-lite.js" in block["js"]
assert block["all_frames"] is False
assert block["match_about_blank"] is False
assert "siteAccessCard" not in popup_html
assert "messaging-compat.js" not in popup_html
assert "updateCard" not in popup_html
assert not (out / "background" / "page-injector.js").exists()
assert not (out / "compat" / "browser-api.js").exists()

for rel in block["js"] + block.get("css", []):
    if not (out / rel).is_file():
        raise SystemExit(f"missing packaged file: {rel}")

print(VERSION)
