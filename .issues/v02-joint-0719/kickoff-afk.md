# v02 两线合审 · AFK 续跑 kickoff（2026-07-19）

给接手的新 session。Danny 已拍板，授权范围见下。**先读完本文再动手。**

---

## 0. 你是谁、要干什么

前面有三条线各自跑完并停了：

| 线 | 干了什么 | 产物 |
|---|---|---|
| **部署线**（feat-068） | 前端首次真部署 + 中文本地化 + 收尾复审 | `.issues/feat-068-frontend-deploy/acceptance-0719.html` |
| **对齐线**（v02-partner-align） | feat-050..060 十一条 + 15 条对抗审查修复 | `.issues/v02-partner-align-0718/HANDOFF.md` |
| **差异线**（diff-audit） | v02 ↔ 合伙人版逐项差异清单 | `.issues/lite-live-v02-0713/_diff-audit/`（4 份 md） |

你的活是**把这三条线的结论合成一条路，然后按 Danny 的拍板推进到可验收**。

流程：`探索审核 → 按拍板推进 → 自循环审核 + 端到端测试 → 交 Danny 验收`。

---

## 1. Danny 已经拍了的三件事（不要再问，也不要自己改口径）

### ① 裸域名切成 v02

`https://averylite.dannyqian.com` 现在打开是**冻结的 v01**，v02 要手打 `?v=2`。
**改成默认 v02。** 理由：feat-050..060 十一条（路由 / 刷新不丢 / 跟进 / 多看一眼 / 项目看板 /
聚合首屏）全在 main 里了，客户现在一条都看不见；审计判这条是 blocker（3/3 票）。

挑壳的合成根在 `src/App.tsx`（`?v=` / `?mode=` 解析）。
🔴 **v01 不许删也不许拆** —— 保留 `?v=1` 能切回去，这是出事时唯一的逃生门。

### ② 后端只升「不碰数据库」的那个子集

线上镜像 `avery-agent:zh512`（源 `512b11d`）缺四条数据真相修复。
**只升这两条，其余不动：**

```bash
git checkout -b backend-subset 512b11d
git diff 6f838f3^ 6f838f3 -- eval-harness/ | git apply   # GB18030 静默销毁 + 413 人话上限
git diff d184b6c^ d184b6c -- eval-harness/ | git apply   # /advise 错误路径自己崩（NameError）
```

🔴 **升级前必须自查：`ls eval-harness/db/migrations/` 里不许出现 `0008_account_contexts.sql`。**
机制：`pg_registry.py:123` 的 `_ensure_schema()` 对 `db/migrations/*.sql` 全量执行，
`Dockerfile` 又 `COPY db/` —— **任何 tree 里带着 0008 的镜像，都会在第一个请求时无条件把它
推进生产库**，不可逆。`512b11d` 不带 0008，所以生产库至今没见过它，别让它见到。

已实跑验证（无 LLM 开销）：
```bash
cd eval-harness && AVERY_BRAIN=stub python -m pytest \
  tests/test_file_truth_encoding.py tests/test_advise_brain_config_error.py -q
# → 30 passed in 2.47s
```

fixA / fixC / fixD 的 diff 依赖中间提交，单独 apply 会 skip。**想补要再挑一轮，并且每挑一条
都要重新自查 0008。** 挑不干净就别挑，留给下一轮。

### ③ 授权范围

| 动作 | 授权 |
|---|---|
| `git push` 到 `main`（= Vercel 自动构建并上生产） | ✅ **已授权** |
| 重建后端镜像 + 换容器（**严格按 ② 的范围**） | ✅ **已授权** |
| 往 Vercel 填 Supabase 密钥 | ❌ **不要做** —— 见下 |

> #### ❌ 为什么 Supabase 密钥这条被单独拿掉
>
> Danny 一开始勾了这条，我退回来了，他知情。原因是它**和 ② 直接冲突**：
>
> `src/lite2/auth/AuthPanel.tsx:334` 的渲染条件是
> `if (status === 'disabled' || !authConfigured()) return null` ——
> **唯一判据是那两个环境变量在不在，完全不探测后端能力。**
>
> 而 ② 选的子集刻意不含 `21f5aad`（feat-053），所以 `/account/status`、`/account/contexts`、
> `/account/claim` 线上仍然 404。连起来就是：填了密钥 → 登录框出现 → 客户真的登进去了 →
> 前端调 `/account/claim` → 404 → 弹「这台浏览器的访问凭据没了」。
> **一个能登进去、然后告诉你没权限的登录框，比没有登录框更糟。**
>
> 想解锁它，得先满足**其一**：
> (a) 后端追平到含 feat-053 且迁移 0008 已应用（那就不再是 ② 的范围，要 Danny 重新拍）；
> (b) 前端加一道后端能力探测，`/account/status` 不通就不渲染登录入口（是笔真活，但做完
>     这条闸就能永久解除）。
> **两条都没做到之前，不要填。**

---

## 2. 现在的事实基线（别用旧文档里的数字）

```
origin/main   039f1f1   ← 线上站点就是这一版构建的
本地 main     2c499c9   ahead 22，全部未 push、全部不在线上
线上后端      avery-agent:zh512（07-18 23:25 建，源 512b11d），容器名 avery
进机器        ssh admin@8.211.28.11，免密 sudo
```

🔴 **「在 main 里」≠「在线上」。** 三份旧文档里凡是「已上线」都只指 `039f1f1`。
`acceptance-0719.html` 顶部横幅和 `session-handoff.md` 顶部的纠偏表已经把过时结论逐条标出来了，
**以带红字「07-19 更正」的为准，不要采信被更正掉的原文。**

---

## 3. 要读的材料（按这个顺序）

1. `.issues/feat-068-frontend-deploy/acceptance-0719.html` —— **先看第「零」节**（收尾新发现）
   和第「一」节（三件拍板，现在已经拍了）。
2. `.issues/v02-partner-align-0718/receipt-deploy-line-0719-wrapup.md` —— 两条线的事实对齐，
   含几条互相纠错，**里面有一条「别照着改」的警告（见 §5）**。
3. `.issues/lite-live-v02-0713/_diff-audit/` —— 差异清单四份。
4. `.issues/v02-partner-align-0718/HANDOFF.md` —— 对齐线交接。
5. GitHub issues **#12–#20**（`gh issue list`）。#19 #20 是收尾时新开的。

---

## 4. 现成的门，每轮都要跑

```bash
# 前置：后端 stub 起在 8137，前端起在 5173
cd eval-harness && AVERY_BRAIN=stub python -m uvicorn service.app:app --port 8137
# 🔴 前端端口必须是 5173 —— 后端 CORS 是精确匹配列表，换端口会被浏览器静默拦掉，
#    症状是「团队/笔记/文件全空」，和「没数据」长得一模一样，极易误判成回归。

npm run typecheck && npm run lint && npm run build
node scripts/css-brace-check.mjs                                    # CSS 括号配平
node .issues/v02-partner-align-0718/verify-p0.mjs                   # 41 条行为断言 × 两张皮
node .issues/v02-partner-align-0718/verify-blockers.mjs             # 5 条 blocker 复验
node .issues/feat-068-frontend-deploy/verify-zh-purity.mjs          # 中文纯度（v01 两面 + v02 九屏）
node .issues/feat-068-frontend-deploy/verify-404-discriminator.mjs  # 真 404 判据
```

**当前基线：`41 PASS / 15 PASS / 4 PASS`，中文纯度 v01 0 处、v02 仅「往哪走」屏 9 处
（issue #19，刻意腔调待判）。任何一条掉下去都是你引入的回归。**

⚠️ **切成 v02 默认之后，`verify-zh-purity.mjs` 里 v01 那一段的 URL 口径要跟着改**
（它现在用「不带 `?v=2` = v01」来取 v01 面，切换后这个假设就反了）。改的时候把注释一起改，
别让下一个人以为它还在测 v01。

---

## 5. 三条会让你踩坑的已知陷阱

### ① 别按对齐线的 S9 改上传上限数字

他们判「`10 个文件 / 10MB` 两个数字都错，真值 15 个 / 8 MiB」。**那是代码默认值，不是生产真值。**
线上 env 显式覆盖了：

```
$ sudo docker exec avery env | grep AVERY_MAX
AVERY_MAX_UPLOAD_BYTES=10485760      # = 10 MiB
AVERY_MAX_FILES=10
```

env 名与 `eval-harness/avery/ingest/guards.py:41,46` 读的完全一致。
**现有中文文案是对的，照 S9 改反而会改错**（我差点就改了，去线上核 env 才拦住）。
S9 成立的那半是「前端硬编码了一份会和服务端 env 漂移的副本」——正解是转达服务端 413 body。

### ② 跑 stub 的门证明不了真后端的行为

DEV 的 stub 传输仍然抛 `team HTTP 404 (stub)` 这类**开发者串**，而真 HTTP 传输经
`httpErrorMessage()` 出的是中文句子。已经因此漏过一条（`ccc470e`）。
**凡是判据涉及 HTTP 状态码的，必须用真后端验，不能只跑 stub。**

### ③ 全量 pytest 会真花钱

`service/app.py` 导入时加载 `eval-harness/.env`，里面有真的 MiniMax / DashScope key。
跑全量 pytest ≈ 11 分钟真实计费。**只跑你需要的测试文件，并且带 `AVERY_BRAIN=stub`。**

---

## 6. 环境纪律（违反会连累别的 session）

* 🔴 **绝不 `npm install`。** 所有 worktree 的 `node_modules` 是指向 `D:\avery\node_modules`
  的 junction，任何一边装都会改到别人脚下。
* 🔴 **拆 worktree 不许 `rm -rf`。** `git worktree remove` 会 deregister 成功但删目录失败；
  正确姿势是先摘 reparse point 再删：
  ```powershell
  [System.IO.Directory]::Delete("D:\avery-wt\<name>\node_modules", $false)
  Remove-Item "D:\avery-wt\<name>" -Recurse -Force
  ```
  删不掉多半是残留 vite dev server 占着句柄，`Get-CimInstance Win32_Process | ? { $_.CommandLine -like '*avery-wt*' }` 找出来 kill。
* `D:/avery-wt/gate` 和 `int` 不是 git 仓库，是残留目录，归属不明，**别动**。
  （对齐线的 `verify-server.mjs` 的 `root` 指着 `gate`，那目录已被掏空，所以它对 `/` 返 404
  ——看着像应用崩了，其实是根目录没东西。要跑自己的验证 server 就自己指 `root: 'D:/avery'`。）
* 换后端容器**必须带回滚**。上一轮出过事故：`set -e` 的直线脚本在 `docker rename` 撞到
  别人留下的同名容器时中途 abort，容器停着没起来，线上挂了 1-2 分钟。
  **用时间戳命名 + 每条失败路径都调 `rollback()`。**
  回滚命令：`sudo docker rm -f avery && sudo docker rename <上一个> avery && sudo docker start avery`。

---

## 7. 什么叫「可以交 Danny 验收了」

全部满足才算：

- [ ] 裸链默认 v02，`?v=1` 仍能切回 v01（两个都在**生产域名**上实测过，不是本地）
- [ ] 后端子集已上线，且**核对过生产库没有 `account_contexts` 表**（升级没有偷偷带上 0008）
- [ ] GB18030 那条在**生产**上验过：真造一个 GB18030 编码的中文花名册传上去，抽得出人，
      不再是「0 人 + 已读入 ✓」
- [ ] §4 全部门在合流树上通过，且**没有一条是靠 stub 蒙混过去的**
- [ ] 中文纯度门：v01 0 处、v02 除「往哪走」屏外 0 处
- [ ] 出一份验收 artifact，**按「Danny 早上要做什么」排序，不是按你做了什么排**；
      每条结论都带可复现的证据（命令 + 实际输出），不许写「应该没问题」
- [ ] 本次改动全部 push 到 `origin/main`（已授权），并写清楚线上现在是哪个 commit
- [ ] 老 artifact 里被你推翻的结论，**就地加更正、不要删原文**（保持可追溯）

---

## 8. 自循环怎么跑

每一轮：**改 → 跑 §4 全部门 → 对抗性自审（假设自己错了，去找证据推翻自己）→ 记录 → 下一轮。**

自审时优先怀疑这三类（都是这个项目真实栽过的）：

1. **产品在替客户说话** —— 文档里没写的状态被编成「一切正常」；有阻塞却说「没有风险信号」；
   文件被吃掉了还回「已读入」。
2. **门跑的是 stub，结论套到生产上** —— 见 §5②。
3. **改了文案，拆了下游** —— 有人拿 `err.message` 做正则判据。改任何用户可见字符串之前，
   先 `grep -rn "\.test(message)\|message\.includes(" src/`。

一轮下来没有新发现，再跑一轮；**连续两轮零新发现**才算收敛。

---

## 9. 新 session 开场白（复制这一句）

```
读 .issues/v02-joint-0719/kickoff-afk.md，按里面的授权范围和验收标准 AFK 跑到底。
Danny 睡了，三件拍板已在文档里，别再问；撞到文档明确标「不要做」的就停下来记录。
```
