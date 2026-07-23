# rich-align-0722/10 · 登录隔离演示台 · 本地起法（隔离端口，不碰共享电池）

> 供 Danny HITL 人手登录演示。**隔离端口 5381 / 8381**——不触碰共享 5173/8137 电池环境，
> 也不改共享 dist（demo dist 打到 `dist-authdemo/` 单独 outDir）。🔴 真登录（输账号密码）是
> Danny 人手，agent 不代填任何凭据。

## Supabase 值（项目 avery = avery-fra `zlxpldzapyoacmgvlqpn`，Supabase MCP 取）

- `SUPABASE_URL` = `https://zlxpldzapyoacmgvlqpn.supabase.co`
- `SUPABASE_ANON_KEY` = anon（legacy JWT）——**公开客户端 key**（生产 client bundle 里本就带它，非机密；
  非 service-role/非 DSN）。当前值经 `get_publishable_keys` 取；轮换后重取即可：
  `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9…anon…`（完整值见起动命令 / MCP）。

## 起三口（隔离）

```bash
# ① 后端 8381：mock 三件套 + 三亚 seed + 真 Supabase env（configured=true）+ CORS 放行 5381
cd /d/avery/eval-harness && AVERY_BRAIN=mock AVERY_EXTRACTOR=heuristic AVERY_EMBEDDINGS=keyword \
  AVERY_DEMO_SEED_DIR=tests/fixtures/demo-seed \
  SUPABASE_URL=https://zlxpldzapyoacmgvlqpn.supabase.co \
  SUPABASE_ANON_KEY=<anon> \
  AVERY_CORS_ORIGINS=http://localhost:5381,http://127.0.0.1:5381 \
  /c/Python313/python.exe -m uvicorn service.app:app --host 127.0.0.1 --port 8381 --app-dir .

# ② demo dist（打到单独 outDir，不覆盖共享 dist）：真 VITE_SUPABASE_* + api base 指 8381
cd /d/avery && VITE_SUPABASE_URL=https://zlxpldzapyoacmgvlqpn.supabase.co \
  VITE_SUPABASE_ANON_KEY=<anon> VITE_AVERY_API_BASE=http://127.0.0.1:8381 \
  node node_modules/vite/bin/vite.js build --mode development --outDir dist-authdemo

# ③ preview 5381 挂 demo dist
cd /d/avery && node node_modules/vite/bin/vite.js preview --port 5381 --outDir dist-authdemo
```

入口（必带参）：`http://localhost:5381/?v=2&mode=live&lang=zh`。

## 口径确认（机器已验，verify-auth-demo-10.mjs 6/6）

- `curl http://127.0.0.1:8381/account/status` → `{"configured":true,"signed_in":false}`（补了 Supabase env）。
- 登录入口 `.lite-auth-toggle` **真渲染**（AuthPanel 能力探测 /account/status→supported——历史「只看自身
  env」口径已修，authStore.probeAccountCapability）；点开弹层邮箱/密码字段就绪。
- 边界：未登录 `GET /account/contexts` → 401。

## HITL 演法（Danny 人手，🔴 凭据不经 agent）

1. 开 `http://localhost:5381/?v=2&mode=live&lang=zh`，右上齿轮旁点**登录**（`.lite-auth-toggle`）。
2. 用你的 avery 账号邮箱/密码登录（Supabase GoTrue，真出网到 avery-fra）。**这一步 agent 不代填。**
3. 门厅一键**示例团队**（三亚）→ 满态 16 人/6 项目；登录态下 AuthPanel 出「把这份示例归到我账号」
   （`.lite-auth-claim` claim 钮，body 带 context_id+owner_token）→ claimed。
4. 退出登录 → 换第二个账号登录 → `/account/contexts` 只回它自己的 → 看不到前号那份三亚副本
   （前号 context 以第二账号身份动 = 同体 404，无枚举）。

## 硬切换 / 线上演法（fallback）

面板 30 分钟跑不通即固化线上演法（生产 `averylite.dannyqian.com` + 后端 `avery.dannyqian.com` 本就配了
Supabase——Vercel VITE_SUPABASE_* + 后端 SUPABASE_*）：同样 1-4 步，入口换成生产域名。push 后生产复演。
**本地演示台已跑通（verify-auth-demo-10 6/6），线上演法作为 Danny 不想在本地起三口时的备选。**

## 收工清理

demo 是 runtime，不进 git（`dist-authdemo/` + 8381/5381 进程）。演完：杀 8381/5381 进程 + `rm -rf dist-authdemo`。
机器隔离断言（不依赖本台）由 `tests/test_login_isolation_10.py`（mock resolve_account，5/5）+
`test_account_auth.py`（25 例）+ C 区 `verify-auth-capability`（口径门）常备守。
