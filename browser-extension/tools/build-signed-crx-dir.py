#!/usr/bin/env python3
import json
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
REPO = ROOT.parent
VERSION = (ROOT / "ZIP_VERSION").read_text(encoding="utf-8").strip()
UPDATE_URL = "https://raw.githubusercontent.com/dulo11/fanyi2/extension-update-channel/updates.xml"

out = Path(sys.argv[1]) if len(sys.argv) > 1 else REPO / "build" / "chromium-signed"
out = out.resolve()

# CRX 直接复用已经在 Quetta 验证通过的 ZIP/v1.2 核心打包结构，
# 只把固定签名自动更新所需的 update_url 加回来。
subprocess.run(
    [sys.executable, str(ROOT / "tools" / "build-pure-zip.py"), str(out)],
    check=True,
)

manifest_path = out / "manifest.json"
manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
manifest["version"] = VERSION
manifest["update_url"] = UPDATE_URL
manifest["description"] = "浮译浏览器版：Quetta 固定签名 CRX 自动更新版，保留 v1.2 稳定翻译主链。"

if not manifest.get("key"):
    raise SystemExit("signed CRX manifest is missing fixed public key")
if manifest.get("background", {}).get("service_worker") != "background/main-zip.js":
    raise SystemExit("signed CRX must use the verified main-zip.js runtime")

manifest_path.write_text(
    json.dumps(manifest, ensure_ascii=False, indent=2) + "\n",
    encoding="utf-8",
)

popup_path = out / "popup" / "popup.html"
popup = popup_path.read_text(encoding="utf-8")
popup = popup.replace("ZIP 版继续保护已经翻好的文字；", "CRX 自动更新版继续保护已经翻好的文字；")
popup_path.write_text(popup, encoding="utf-8")

# 运行时不需要构建脚本本身。
if (out / "tools").exists():
    shutil.rmtree(out / "tools")
if (out / "ZIP_VERSION").exists():
    (out / "ZIP_VERSION").unlink()

assert manifest["version"] == VERSION
assert manifest["update_url"] == UPDATE_URL
assert manifest["background"]["service_worker"] == "background/main-zip.js"
assert "content/content.js" in manifest["content_scripts"][0]["js"]
assert "content/floating-panel-simple.js" in manifest["content_scripts"][0]["js"]
assert "content/content-fast.js" not in manifest["content_scripts"][0]["js"]
assert "shared/storage-rpc-client.js" not in manifest["content_scripts"][0]["js"]

print(VERSION)
