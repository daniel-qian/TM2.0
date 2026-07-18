# feat-068 · 前端首次真部署 — session handoff（2026-07-18）

## 状态

- 分支 `feat/068-frontend-deploy`（worktree `D:/avery-wt/068`），base `890ac64`，已并入 `main` 并 **push 到 origin**。
- **`origin/main` 从 7-08 的 `9dbccf5` 一跃到 `1526e78`** —— 10 天、121 个 commit 第一次上 GitHub。此前 GitHub 上没有持久化、Ask、租户隔离、lite2 任何一行。
- **线上：<https://averylite.dannyqian.com>** · Vercel 项目 `avery-lite` · 已连 `daniel-qian/avery` · **push 到 main 即自动构建并上生产**（构建 18s）。
- feature_list：`feat-068` = `done`。
- GitHub issues #10–#15（本波唯一一次用真 issue，非本地 `.issues/`，按 Danny 07-18 拍板）。

## 交付

| 文件 | 改了什么 |
|---|---|
| `vercel.json` | 去掉三处 `//` 注释键（新 schema 拒收，建项目时直接报错）；`VITE_AVERY_API_BASE` / `VITE_AVERY_LOCALE=zh` / `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD` 进 `build.env` |
| `docs/deploy/vercel-config-notes.md` | 新增 —— `vercel.json` 再也不能写注释，注释归这里；含三个 Vercel 项目的区分表和 CORS 跨线依赖 |
| `.npmrc` | 新增 —— 跳过 playwright 浏览器下载 |
| `vite.config.ts` | 构建闸：`MODE=live` 且 API base 缺失/localhost → 构建期抛错 |
| `src/lite{,2}/transport.ts` | `httpErrorMessage()` 429/413/415/422/404/5xx 人话；`apiBase()` 误配时 `console.error` + 文案改口为「构建配错」而非「服务器故障」 |
| `src/lite{,2}/store.ts` | `?transport=stub` 收进 `import.meta.env.DEV` |
| `src/lite{,2}/UploadPanel.tsx` | 等待预期文案 + 实时秒计时 + 动效；键盘路径的重复提交同样堵上 |
| `src/lite2/OnboardWizard.tsx` | 选文件按钮 `disabled={busy}` + `aria-busy` |
| `src/lite{,2}/styles/*.css` | append-only，keyframes 各自命名空间前缀（lite2.css 后加载，不加前缀会撞名） |
| `src/shared/i18n/{en,zh}.ts` | 4 个新 key；中文经 MiniMax 过一轮后由我定稿 |

**仓库外的改动（不在 git 里，重要）**

1. **法兰克福后端** `admin@8.211.28.11`：`~/avery.env` 加 `AVERY_CORS_ORIGINS`，容器重建。
   - 值：`https://averylite.dannyqian.com,https://avery-lite.vercel.app,http://localhost:5173,http://127.0.0.1:5173`
   - **必须带上那两个 localhost** —— 那是服务端的默认值，一旦设置就被完全替换，漏了就掐断全部 8 条并行线的本地开发。
   - 备份 `~/avery.env.bak-20260718-205914`。回滚容器 `avery-old` 已删（验证通过后）。
   - 容器实际叫 **`avery`**，不是广播里写的 `avery-agent`（那是 image 名）。
   - 合伙人的 `ims-webapp:5108` 全程未碰，收工时复验 200。
2. **Vercel `tm2` 项目的 git 连接已切断。** 它 Root Directory 也是仓库根，`push origin main` 会重建它并冲掉它那个"停在 `tm2-osj7dqiwv` 等审字"的 hold。`vercel git connect` 可随时恢复。
3. **阿里云 DNS**：`averylite` CNAME → `cname.vercel-dns-0.com`（Danny 手加）。注意是 **`-0`**，老文档里的 `cname.vercel-dns.com` 已过时。

## 真机验收（当第一个用户，非自评）

```
averylite.dannyqian.com   → 200，无 SSO 墙，中文默认渲染
/team/anything            → 200（SPA rewrite；feat-051 上真路由不会断）
window.__AVERY_BUILD__    → {mode:"live", locale:"zh", apiBase:"https://avery.dannyqian.com"}
生产包内 transport=stub    → 0 命中
构建闸                     → 漏配 API base 时构建 fail；配对时 pass（两路都验）
浏览器 origin → /health   → 200，degraded:false，llm_calls_remaining 2000
浏览器 origin → /ingest   → 200，35s，extraction_mode:"llm"（未降级）
带 token 读 /team         → 200
不带 token 读 /team       → 404（租户隔离，不泄露存在性）
向导按钮激活 10 次         → 只发出 1 个 POST /ingest（改前会是 11 个 token 全丢 + 429）
```

## 🚨 验收当场抓到的真 bug（后端，已开 #10）

同一次 `/ingest` 传"花名册 CSV + 项目周报 md"，两份都含同样 5 个中文姓名 → **`people` 长度 = 10，每人出现两次**。其中 4 个名字在两份文件里逐字节相同仍未合并。feat-048「中文数据端到端修复（含去重）」本该覆盖这条路径。

**这条路径在今天之前走不到** —— CORS 只放行 localhost，部署前端一律被浏览器拦；本地开发通常只传一份文件。**这就是"agent 当第一个用户"这道门的价值所在。**

离 `.issues/v02-partner-align-0718/decisions.md:41` 那个 **7-25 部署内测** 只剩 7 天，收件人是三亚鹿山雅居、瑞典建筑公司、国内融资团队。**这个 bug 必须在发地址之前修掉。**

## 🧑 给 Danny 的（都不阻塞，已可演示）

- 无。凭据墙这一轮全部走完了：push 已授权并完成，Vercel 走 CLI（见 memory `vercel-ops-via-cli`），SSH 公钥已在机器上。

## 🚦 未尽事项

| # | 事 | 归属 |
|---|---|---|
| #10 | 跨文档中文人名去重失效 | **后端线，7-25 前必修** |
| #12 | 后端 `detail` 体未读 + 无 ErrorBoundary + `degraded` 不可见 | 可 AFK |
| #13 | 上传前无客户端预检（10 文件 / 10MB / 类型） | 可 AFK |
| #14 | Vercel preview 部署 100% CORS 失败（精确匹配无通配） | **需后端改 + 先广播** |
| #15 | `index.html` 硬编码 `lang="en"` + title `Avery Prototype` | 可 AFK |
| — | `contextId` 不持久化（刷新丢团队） | **feat-050**，已有 worktree |
| — | `store.uploadFiles` 无 store 层防重入（本轮只堵了 UI 层） | feat-050 或 feat-062 |
| — | `src/lite{,2}/transport.ts` 是两份近乎逐字的拷贝，每个修复写两遍 | 合流线定时机；**现在提到 `shared/` 会和 8 条并行 UI 线正面冲突** |

## 自评薄弱点（对抗验证打这里）

1. **`D:/avery-wt/068/node_modules` 是指向 `D:/avery/node_modules` 的目录联接**（junction），子 agent 建的，因为这个 worktree 没有自己的 `node_modules` 而它又不能 `npm install`。typecheck/build 都只读，没往 `D:/avery` 写。**但：绝不要在 `068` 里跑 `npm install`（会改共享树），拆 worktree 用 `git worktree remove` 而不是 `rm -rf`（会顺着联接递归删）。**
2. **本轮验收用的是我现编的小语料，不是 `eval-harness/tests/fixtures/seed/` 那两个真种子文件**（`LogiPulse-Roadmap.pdf` + `PrismDesign_TeamProfile_EN.xlsx`）。所以 35s 这个耗时**不能反驳**广播里 100–120s 的说法 —— 我的文件小得多。**真种子文件的端到端还没在线上跑过。**
3. 语料里有个手滑 `黄海generic`，连同这次测试产生的 context 一起**留在了生产库里**。无害，但它是生产数据。
4. **上传 UI 本身没在生产 URL 上用真文件走过一遍** —— 我是用页面 origin 发的 `fetch`，验的是 CORS + 后端链路。UI 上传路径是子 agent 在本地 dev 驱动 DOM 验的。两段都验过，但没有一次贯穿"在线上点按钮选真文件"。
5. `?v=2`（v02 壳）**在生产 URL 上一次都没打开过**。按 07-18 拍板它只靠手打 URL 进，不是默认，但要演示它就该先自己走一遍。
6. 生产包里仍有 2 处 `127.0.0.1:8137` 字面量 —— 是 `apiBase()` 的 dev fallback 常量。env 已设，该分支取不到，但字符串在包里。
