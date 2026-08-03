# ⟳ 2026-08-02 · sweep-promote-0802 菜单收官 + 下一棒 AFK 可跑性分档（★最新，从这里接）

> 接续只靠本文件 + `progress.md` + `feature_list.json` + git，不回放聊天。
> 更早的逐棒 handoff 已从本文件清出（2026-08-01 换血）——考古用 `git log --follow session-handoff.md`。

**一句话**：`claude/codebase-architecture-improve-20b9eb` 12 提交已快进合 main 并全量上生产；
文档保洁 19 条全部落地；第二轮 UI 扫拿到 20 条发现（REGRESSED 0）。`12282e8 → 70f72d9` 共 21 提交，
`main` 与 `origin/main` 推平、工作树干净、无攒着的东西。**下一棒不需要先做整理，可以直接开工。**

## 现在线上是什么

- **前端** averylite.dannyqian.com = `origin/main`（Vercel 自动部署；**已核到产物层**，不是只看 200）。
- **后端** avery.dannyqian.com = `avery-agent:main-20260802-113944`（回滚梯 `avery-prev-20260802-113944`）。
- **生产库**：97 context / 224 doc，**原件缺失 0 条、向量缺失 0 条**。上线时那 9 条命中是 07-30
  born-red 演示牺牲掉的 demo 克隆残骸，已被应用自带 GC 扫掉。回执 `.issues/sweep-promote-0802/receipt-deploy-0802.md`。
- **账实**：电池 **28/28**（A22/B3/C3）· 裸 `pytest` **3473** · `needs_db` **65** · 像素基线 40 张本轮重冻过。

---

# 🔴 下一棒能不能 AFK 一口气跑完 progress.md 那 9 条？—— 不能，分三档

这一节是本文件的正题。**不要把 9 条整包丢进一个 AFK 循环**——其中有真花钱的、有只能人做的、
有已经拍板不做的。分档如下。

## A 档 · 可以 AFK 自跑自验自修（建议按这个顺序）

| # | 条目 | 为什么适合 AFK | 🔴 必须带的护栏 |
|---|---|---|---|
| 5 | **gate-run 迁移续做** | 验收是机械的：迁前迁后各跑一次、判据逐条 diff | 每 session 只迁几道；**不碰 C 区三道**（会换掉共享 dist）；`aria-zh`/`cr-alignment` 要先扩 makeRec 形状才能迁 |
| 4 | **刷掉 snippet/gate.md 的「零后端/离线 stub」假前提** | 纯文档，零行为风险 | 顺带把 snippet 顶部 Usage 表的「10 相位/8 tabs」改成真值（11/9） |
| 7 | **i18n 剩 10 个孤儿键** | 有扫描器了（`node scripts/i18n-orphans.mjs`） | **别直接删**：每个先做 git 考古，分清「退役文案」与「被合并吃掉的功能」。删错=把一个真 bug 藏起来 |
| 1 | **#34 / #36 / #37 三条 hard-contract** | 复现路径、证据、根因都写在票里了 | 见下方「改这三条的专属陷阱」 |
| 2 | **17 条未开票发现里的布局/文案类** | 同上 | EN locale 那条**不在此列**，见 B 档 |
| 6 | 欠账里的 **#27**（上传实现合一）、**#31**（05b 重传合并） | 范围清楚、有既有门兜 | #28 前置是「给 SourceDocument 稳定 id」——那是 schema 决定，别顺手做 |

### 改 #34 / #36 / #37 的专属陷阱（不写下来一定会踩）

1. **这三条都改布局 → 像素基线会再漂一次。** 本轮实测：一个 `<html lang>` 的改动漂了 **26/40** 张。
   而像素门**首处不匹配即中止**，一次红跑给的清单是不完整的——要拿全量得「`--update-snapshots`
   重冻 + 前后 md5 对比」。重冻前必须真的把变了的图打开看一遍。
2. **#34/#36 修完必须补一道门，否则必然回归。** 判据不能只算几何重叠，要用
   `document.elementFromPoint(按钮中心)` **或真 `page.mouse.click()`** ——本轮就是靠真点击才
   把「视觉遮挡」升级成「控件被劫持」。没有这道门，下次谁调一下 `bottom` 就又坏了。
3. **#37 要先定语义再动手**：手打卡应该**不显示**「出处」这一节，还是显示「此卡无文档出处」？
   后者更贴红线（不建假按钮 / 不替客户断言）。copy 归 agent 定稿（AGENTS.md act-first），
   但中文走 M3。

## B 档 · 可以做，但**先 grill 出口径再开工**（别让 AFK 循环顺手改了）

- **2 里的 `home/en-locale-decision-grade-labels-stay-chinese`**：EN 用户拿到中英夹杂的核心决策面板。
  根因在后端 `decision_grading.py` 三处硬编码 `LABEL_ZH`，函数签名不吃 locale。
  修它要么给 `to_dict()` 加 locale 参数，要么**往 `/advise` 契约里加 locale 字段**——后者是跨前后端的
  契约变更，且和下面那条同源。按 [[feedback-0729-three-verdicts]]：大战役先 grill 出 PRD 再换 session 开发。
- **同源的一条（本轮 triage 挖出来的）**：`AdviseRequest` 根本没有 locale 字段，`transport.ts` 也不带
  ——**判读正文用什么语言，现在压根不由用户控制**。这两条应该合成一票一起想。

## C 档 · AFK **做不了**，或**不该做**

| # | 条目 | 为什么 |
|---|---|---|
| 8 | **真机零覆盖（iOS Safari / 微信内置）** | 🔴 **只能 Danny 做**。本轮 375×812 是 headless Chromium 模拟，不是真机。而 #34/#36 恰恰是小屏专属问题，真机大概率更严重。在有人拿真手机打开过之前，「手机上能用」没有证据 |
| 3 | **真 brain 分流取证** | 要在生产上真调 LLM = **真花钱**（AGENTS.md 花钱闸）。若要 AFK 做，得先给个明确口径：**上限几次调用、打 demo 克隆还是真 context、超了就停**。别让循环自己决定烧多少 |
| 9 | **CRUD 50 秒（#30）** | **Danny 已拍板「先不管，等真实客户量再立」**。AFK 循环不该推翻已有拍板。留在 What's Next 只是记数（07-30 是 40–45s，本轮 50s，在变慢） |
| 6 部分 | **#29**（needs-triage，等真用户反馈）、**#33**（ready-for-human，等 Danny 三选一） | 标签本身就是「在等人」 |

## 建议的下一棒开法

一个 AFK 循环只吃 **A 档**，按表里顺序（5 → 4 → 7 → 1 → 2 → 6）。理由：前三条零/低风险且能先把
"门与文档可信"这件事垫稳，再动会改布局的 1、2。**B 档单独起一次 grilling**，C 档在报告里
向 Danny 要口径，不自己开工。

---

## 别再踩的坑（常青集在 AGENTS.md「易复发陷阱」段，这里只留本轮增量）

- 🔴 **`?transport=stub` 在 build+preview 下恒为死开关**（DEV 闸静态 false，`--mode development`
  只改 MODE 不改 DEV）。上一轮 46 条走查发现里 **12 条是这个破口造成的假象**。要数据态走
  `__lite2Store.uploadFiles()` + 真 mock 后端，现成驱动 `eval-harness/tools/sweep-r2-driver.mjs`。
- 🔴 **没有机械 runner 的判定组 = 从来没被跑过**。给 snippet 的 B/C 组补 runner 第一次跑就挖出
  `_clickTab('Follow-ups')` 自 0721 起永久失效——连带 gate.md 那套人工协议也一直是坏的。
- 🔴 **新加任何门/扫描器必须 born-red**：造真违规看它红、撤掉看它回绿，两次输出都贴进证据。
  迁移既有门时 born-red 不够，要**迁前迁后判据逐条 diff**。
- **机器门一律白名单**（`:not(允许的那一种)`），别写黑名单——本轮 eslint 墙就漏在
  `<Link to={常量}>` 上，而那恰恰是它要防的原始 bug 形状。
- **注释里的计数会烂**：写「迁移前 39 处」这种不自失效的形式，别写现在时。
  同理别在注释里写 `file:line`——本轮加两行注释就把自己写的三个行号顶漂了。
- **commit message 带反引号/`$`/`()` 一律走 `-F -` + 单引号 heredoc**，别用 `-m "..."`（会被 shell
  当命令替换吃掉）。且 `git commit --amend` 只认 HEAD，不认「我想修的那个」。
- 上传型门现在是 **4 道**（+flow-gap-phases），全部绝不排在 C 区 bundle-privacy 之后。
- `feature_list.json` 已瘦身——历史 done 的正文在 `feature_archive.json`。
  **今后任何"扫全仓修引用/行号/链接"的保洁必须把它纳进扫描范围**，否则那是块扫不到的暗区。

## 站着别动的事（Danny 闸）

- 凭据轮换 · 裸「风险：」词表 · `origin/p5-04-nexus-safe-zone` 处置 · 六个旧 worktree/分支清理（删除闸）。
- 法律件对外风险归合伙人；合伙人旧口径「不打分不排名」由 Danny 亲自同步。
- 生产库历史数据的任何修复/清理（本轮盘点只出清单，一个字节没动）。
- 🔴 **`e535ec9` 的 commit message 是错的**（装 nudge 的代码、挂 lint 的正文，我 `--amend` 打偏且已 push）。
  改写已 push 历史属人工闸，没自己动；真相记在 `03a9824` 这条 erratum commit。要不要 rebase 归 Danny。

## 环境（收尾态）

- 工作树干净，HEAD 在 `main` = `origin/main` = `70f72d9`（C 区门跑完查过没 detach）。
- **mock 后端 8137（离线三件套）与 preview 5173 仍在跑**，`dist/` 是 `vite build --mode development`
  的健康产物（apiBase 本地 8137）——下一棒可直接用，但**碰上传路径前仍要先验一次 apiBase**。
- 本地 `avery-pg`（5433）容器留跑。走查产物 `.issues/sweep/2026-08-02-r2-shots/` 220 份（已进 .gitignore）。
