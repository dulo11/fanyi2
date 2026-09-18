# 浮译 Google Web CF 中转

这是给浮译浏览器扩展使用的轻量 Cloudflare Worker。它只中转固定的 Google Translate Web 接口，不提供任意 URL 代理。

## 部署

1. Cloudflare Dashboard → Workers & Pages → Create → Worker。
2. 把 `worker.js` 全部代码粘贴进去并部署；或使用 Wrangler。
3. 在 Worker → Settings → Variables and Secrets 中添加 Secret：
   - 名称：`FT_PROXY_TOKEN`
   - 值：自己生成一串较长随机字符串。
4. Worker 地址例如：
   `https://fanyi-google-web-proxy.<你的子域>.workers.dev`
5. 浮译里填：
   - 中转地址：Worker 根地址
   - Token：上面的 FT_PROXY_TOKEN
   - Google Web 模式：CF 中转优先，失败直连

## API

POST `/translate`

Headers:
- `Content-Type: application/json`
- `X-FT-Token: <FT_PROXY_TOKEN>`

Body:
```json
{
  "texts": ["Hello", "How are you?"],
  "sourceLang": "auto",
  "targetLang": "zh-CN"
}
```

限制：
- 最多 40 段
- 合计最多 20,000 字符
- 单段最多 3,400 字符
- Worker 内最多 6 路并发请求 Google

健康检查：
GET `/health`
