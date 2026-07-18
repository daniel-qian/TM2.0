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

---

# 追记 · 同一夜的后半程（AFK，2026-07-18 深夜 → 07-19 凌晨）

Danny 睡前批「一路跑到底、循环自审自批、早上给验收 artifact」。以下是那之后发生的。

## 🚨 最重的一件：线上后端跑的是「中文修复之前」的镜像

当第一个用户跑真上传时抓到的。线上 `/team/{id}` 的原始 payload：

```
所有 person id : ['u_x'] × 10      unique = 1 / 10   ← 点谁都开同一个人
所有 project id: ['p_x'] × 3
部门(team)     : Eng, Design, Eng, Ops, GTM, Founders, Founders, Eng, GTM, Founders
```

CSV 里写的是 `工程部/设计部/运营部/市场部`。三亚酒店的员工被标成 "Founders"。而且所有人共享一个 id ⇒ **feat-051 的人卡深链在生产上是坏的**（转发出去的链接全指向同一个人）。

**根因不是代码，是部署缺口：**

```
feat-048 中文数据端到端修复  0b6f5c2   2026-07-18 11:31
线上后端镜像构建                        2026-07-17 22:03   ← 早 13.5 小时
```

`0b6f5c2` 自己的注释逐字写着生产上看到的现象：`'陈思雨' '李明轩' … ALL became 'u_x'. 39 people, 1 id`。issue #10 已改判并标 `ready-for-human`。

### 处置

从 **`512b11d`** 构建新镜像。**选这个点是刻意的**：含中文修复链（feat-042..049），**不含** feat-053 账号体系与迁移 `0008`（那条迁移没往任何库 apply 过）。

先在 `127.0.0.1:8138` 起侧容器做同机 A/B，线上 8137 全程不动；验过才切。切后公网复验（`ctx_02d618d3176a`）：5 人、unique id 5/5、`u_沈亦舟` 形态、部门中文、`p_客房系统改造`、`extraction_mode=llm`。

**线上现在跑 `avery-agent:zh512`。它比 main 落后**：无 `/auth/*`；`/team/{id}` 不返回 feat-056 的 `decisions[]`（前端已按 optional 处理，不炸）。**要不要追平 main 是 Danny 的决策项**，因为要连迁移 `0008` 一起。

### 回滚

```
sudo docker rm -f avery && sudo docker rename avery-prev-20260718-233256 avery && sudo docker start avery
```
旧镜像另有标签 `avery-agent:rollback-20260718`；`avery-prev-20260718-233256` 容器保留未删。

## ❌ 我造成的一次停机（约 1–2 分钟）

换镜像第一次尝试写成 `set -e` 直线脚本：`docker stop avery` 成功，`docker rename avery avery-prev` 撞上**另一个 session 15:46 留下的同名 exited 容器**，脚本当场中止 —— 容器停着没人起回来。发现后立即 `docker start avery` 恢复，改成「任何一步失败自动回滚」的写法重做成功。

URL 尚未交付任何人，无用户影响。**教训：在有别的 session 在动的共享机器上，任何脚本都不能假设名字没被占用；且 `set -e` 的直线脚本会把服务丢在停机态——回滚必须写在脚本里，不能靠人补救。**

## 其余落地

| 事 | 状态 |
|---|---|
| 中文站 briefing 顶栏是英文（后端 locale-blind，`registry.py:204-226`）| 前端 `src/shared/briefing.ts::localizeBriefing()` 本地化绕过，**已上线**；后端正解另开 #18 |
| `isStubTransportSelected()` 漏出 DEV 闸（生产带 `?transport=stub` 会拿真数据但不持久化会话）| 已修，生产包实测 0 命中 |
| `?skin=` 静默回落（拿旧链接验极光皮会得到假「通过」）| 加 console 警告指明 `?look=`；不加兼容别名 |
| 广播回执 | `.issues/v02-partner-align-0718/receipt-frontend-deploy-line-0718.md` |
| 对抗审计 | 4 路并行审 + 每条 3 视角 refuter，17 条确认 / 5 条驳回。**红线复核通过**（八条新线里无人身分数） |
| 验收 artifact | 已发布，按「Danny 早上要做什么」排序 |

## 🚦 留给 Danny 的三个决策（artifact 里有完整版）

1. **裸域名是 v01 还是 v02**（审计判 blocker，3/3 票）—— feat-050..060 全部合进来了，但客户拿裸链接看到的是冻结的 v01。当初否掉 v02 默认的理由是「feat-051 一周内要改路由、现在做白做」，**feat-051 已落地，那个理由没了**。
2. **后端要不要追平 main**（连带迁移 `0008`）。
3. **别把 Supabase 两个 key 贴进 Vercel** —— 会长出一个点了就 404 的登录框。顺序必须是：后端追平 + apply 迁移 → 才配 env。

## 端口约定（与对齐波那条线协商后）

对方用 5050–5058 / 5151 / 5199 / 5252 / 5300 / 8300；**本线固定用 5390–5399**。

## 上半程「自评薄弱点」的更正

后半程把其中三条做掉了，原文留着不改（保留当时的判断），在这里更正：

- **第 4 条已不成立** —— 上传 UI 已在**生产 URL 上用真文件走通**：构造 `DataTransfer` 塞进真 `input.upload-input` 再派发 `change`，和用户点「选择文件」是同一条代码路径。观察到等待态文案 + 秒计时在跑，落 `团队已就绪`，`lite2:contextId:v1` 写入 localStorage，整页刷新后团队回来了。
- **第 5 条已不成立** —— `?v=2` 已在生产 URL 打开：`data-look="paper"`、7 个中文页签、`/` → `/team`；`?v=2&look=aurora` 令牌正确（`--ink #10223d` / `--honey #d88a2d`）；点页签跳 `/room` 且粘性 query 完整保留。
- **第 2 条仍然成立** —— 真 seed 文件（`LogiPulse-Roadmap.pdf` + `PrismDesign_TeamProfile_EN.xlsx`）**至今没在线上跑过**。今晚所有耗时数字（25s / 35s / 95s）用的都是我现编的小语料，**不能用来反驳广播里 100–120 秒的说法**。下一个 session 应当拿真种子跑一次，那才是演示当天的真实体感。
- 第 3 条（测试语料的手滑 `黄海generic` 和几个测试 context 留在生产库里）仍然成立，且今晚又多了几个：`ctx_ebfe6c895d1b`、`ctx_02d618d3176a`，以及审计 agent 建的若干个。无害但是生产数据。
