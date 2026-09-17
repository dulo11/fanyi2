# 浮译 浏览器版

这是浮译浏览器扩展的独立仓库。

当前源码目录：`browser-extension/`

当前迁移版本：v1.3.5。

旧仓库 `dulo11/fanyireal-time` 仅保留作历史备份；后续浏览器版开发、ZIP 构建、Release 与自动更新通道均以 `dulo11/fanyi2` 为主。

本仓库现已公开（Public）。Chromium 固定扩展 ID 保持不变：`hlfnagdelcpfdbpdeackdjelemaaoban`。

自动更新清单：`extension-update-channel` 分支根目录的 `updates.xml`。

> 私钥不得提交到仓库。固定签名私钥只应保存为 GitHub Actions Secret：`FT_CRX_PRIVATE_KEY_B64`。
