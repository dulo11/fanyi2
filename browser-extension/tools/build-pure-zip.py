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
# v1.3.11+ 的 content-fast / attribute-lite / storage RPC 在 Quetta 上出现
# “后台翻译成功但页面不落译文”和 popup 连接超时。ZIP 重新采用 v1.2 已验证的
# Chromium 运行结构：完整 content.js + 完整属性翻译 + 原生 Promise 消息。
block["js"] = [
    "compat/browser-api.js",
    "shared/language-core.js",
    "content/site-exclusions.js",
    "content/site-input-profile.js",
    "content/content.js",
    "content/v02-enhancements.js",
    "content/mixed-page-guard.js",
    "content/attribute-translator.js",
    "content/floating-panel-simple.js",
]
block["all_frames"] = True
block["match_about_blank"] = True
manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

# Chromium ZIP 使用 v1.2 的兼容层语义：在 Chromium 中不包裹原生 API。
shutil.copy2(ROOT / "compat" / "browser-api-v12.js", out / "compat" / "browser-api.js")

popup_html_path = out / "popup" / "popup.html"
popup_html = popup_html_path.read_text(encoding="utf-8")
popup_html = re.sub(r'\n\s*<section class="card" id="siteAccessCard">.*?</section>\n', "\n", popup_html, flags=re.S)
popup_html = re.sub(r'\n\s*<section class="card" id="updateCard">.*?</section>\n', "\n", popup_html, flags=re.S)
popup_html = popup_html.replace('  <script src="../shared/messaging-compat.js"></script>\n', "")
popup_html = popup_html.replace('  <script src="../shared/storage-rpc-client.js"></script>\n', "")
popup_html = popup_html.replace('  <script src="update-controls.js"></script>\n', "")
popup_html = popup_html.replace("固定签名版继续保护已经翻好的文字；", "ZIP 版继续保护已经翻好的文字；")
popup_html_path.write_text(popup_html, encoding="utf-8")

# Popup 直接恢复 v1.2 已经在 Quetta 使用过的 tabs.sendMessage/runtime.sendMessage 逻辑，
# 不再经过 storage RPC、超时桥、后台补注入。
popup_js_path = out / "popup" / "popup.js"
shutil.copy2(ROOT / "popup" / "popup-v12.js", popup_js_path)

# options 保留 v1.2 Chromium 兼容层（在 Chromium 中为原生 API，不做 callback 包装）。
options_path = out / "options" / "options.html"
options = options_path.read_text(encoding="utf-8")
options_path.write_text(options, encoding="utf-8")

for path in [
    out / "tests",
    out / "compat" / "firefox",
]:
    if path.exists():
        shutil.rmtree(path)

for path in [
    out / "background" / "page-injector.js",
    out / "background" / "main.js",
    out / "content" / "content-fast.js",
    out / "content" / "attribute-translator-lite.js",
    out / "content" / "frame-performance-guard.js",
    out / "content" / "floating-panel.js",
    out / "content" / "floating-panel-bridge.js",
    out / "shared" / "messaging-compat.js",
    out / "shared" / "storage-rpc-client.js",
]:
    if path.exists():
        path.unlink()

assert manifest["background"]["service_worker"] == "background/main-zip.js"
assert "update_url" not in manifest
assert block["js"][:8] == [
    "compat/browser-api.js",
    "shared/language-core.js",
    "content/site-exclusions.js",
    "content/site-input-profile.js",
    "content/content.js",
    "content/v02-enhancements.js",
    "content/mixed-page-guard.js",
    "content/attribute-translator.js",
]
assert "content/floating-panel-simple.js" in block["js"]
assert "content/content-fast.js" not in block["js"]
assert "content/attribute-translator-lite.js" not in block["js"]
assert "content/floating-panel-bridge.js" not in block["js"]
assert "shared/messaging-compat.js" not in block["js"]
assert "shared/storage-rpc-client.js" not in block["js"]
assert block["all_frames"] is True
assert block["match_about_blank"] is True
assert "siteAccessCard" not in popup_html
assert "messaging-compat.js" not in popup_html
assert "storage-rpc-client.js" not in popup_html
assert "update-controls.js" not in popup_html
assert "updateCard" not in popup_html
assert (out / "compat" / "browser-api.js").exists()
assert (out / "content" / "content.js").exists()
assert (out / "content" / "attribute-translator.js").exists()
assert not (out / "background" / "page-injector.js").exists()

for rel in block["js"] + block.get("css", []):
    if not (out / rel).is_file():
        raise SystemExit(f"missing packaged file: {rel}")

print(VERSION)
