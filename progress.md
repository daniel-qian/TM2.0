# Session Progress Log

> 📢 本文件是**当前状态快照，整体重写不追加**。历史都在 git（`git log` + 各 `.issues/*/receipt*.md`），别在这儿堆编年史。
> 启动路径见 `AGENTS.md` Startup Workflow：读本文件 + `feature_list.json`，跑 `./init.sh` 确认绿，再开工。

**Last Updated:** 2026-08-03（AFK 一口气吃完交接里的 A 档：门迁移 + 三票 hard-contract + i18n 清零）

## Current State

- **git**：`main` 工作树干净、与 `origin/main` 推平。本轮 `5e18e69 → e123323` 共 **9 个提交**
  （7 条代码/门/文档 + 2 条交接换血），全部落在交接 A 档的范围里。
- **验证账实**：全电池 **30/30**（**A 24** / B 3 / C 3）——本轮新增 2 道门（detail-provenance、
  bottom-furniture）。像素基线 40 张，本轮漂 4 张、已人眼复核后重冻。
- **i18n 孤儿键：0 个**（删前 12，不是票面写的 10）。
- **已 push 并上生产**：`main` = `origin/main` = `21cff90`。**#34 / #36 / #37 三张 issue 已 CLOSED**。
  前端 Vercel 已部署并**核到产物层**：线上 bundle 的 `commit` 戳与本地 HEAD 逐字相等，
  三条修复（让位带 / AA 错误态色 / 胶囊让位页脚）在线上 CSS 里逐条验到。
  **后端未重建**——本棒一行后端代码没动，生产镜像与回滚梯维持上一版。

## 本轮做完的（按交接 A 档的顺序）

### 5 · gate-run 迁移第二波（5 道）
home-skeleton / room-nomaterial / contrast-smalltext / handoffs-empty-honesty / switchers。
验收用交接指定的方式：迁前迁后各跑一次、**完整输出逐字节 diff 零差异**（93 条判据）。
另单独验了 `finish()` 的失败路径（往 switchers 插一条恒假 rec → exit 1 + "失败项"块正确打印 →
撤回）——因为 makeRec 把行对象字段从 `n` 改名成 `name`，而 listFailures 是唯一读它的地方，
全绿的门永远走不到那段。
gate-run.mjs 头注释的「迁移范围」改写成分波台账 + 自查命令，不再写"还剩几道"。

### 顺手挖出并修掉的两个真缺陷（都不在交接清单上）
1. **ROSTER 有三道门写着 `backend:false` 却真上传**（topbar-clearance / contrast-smalltext /
   handoffs-empty-honesty）——与 08-02 status-truth 完全同一个错法。三道都在 A 区、位置一直安全，
   但照那个字段以为能离线跑，或用 `--from` 拎到 C 区之后，就是往生产库写数据。
   已改 true + 挂上传型标记，并在字段文档里写死自查命令（这个字段**不参与调度**，写错了不会有
   任何东西报警——已经错过四次）。
2. **上传错误态标签破 AA**：`.upload-error-label` 用装饰色 `--terracotta` 而非 `--terracotta-text`，
   实测 paper 4.33 / aurora 3.85，两皮都低于本仓自己钉的 4.5 硬地板（v01 同病）。
   07-20 那波 AA 清扫漏了它，**不是眼花是判据够不着**——门走的是后端在场的顺路，错误态根本不渲染。
   已修 + 给 verify-contrast-smalltext 补了 `driveErrorState()` 世界（route 拦截逼出错误态），
   判据从 28 涨到 41。

### 4 · snippet / gate.md 的「零后端·离线 stub」假前提
`?transport=stub` 由 `import.meta.env.DEV` 把关，`vite build` 静态求值成 false 并把整个
stubTransport 模块 DCE 掉（`--mode development` 只保 apiBase，救不回来），而本仓门**一律
build+preview**。实证：`grep -c stubTransport dist/assets/*.js` → 每个 chunk 都是 0。
两份文件都加了集中更正段（**加更正不删参数**——参数无害，撒谎的是它周围那句"所以离线"）。
同族三条：gate.md 步骤 2 还写 `npm run dev`（本机起不来且会 200 但不 boot）；
Ask 卡那组"等阶段 C 落地再对真后端重跑"——阶段 C 07-14 就落地了，那个"届时"早到了；
Usage 表的 10 phases / 8 tabs 改真值（11 相位 A–K / 9 tabs），补回漏收的相位 K。

### 7 · i18n 孤儿键 12 → 0
按交接的护栏做了：6 族各一个子 agent 做 git 考古，凡结论"可删"的再各配一个**对抗性复核者**
尽力推翻。6 族全判"退役文案"，6 个复核者全部未能推翻。逐族结论见 `a1f2652` 提交正文。
🔴 `lite2.group*` 只删 lite2 命名空间——`lite` 下同名键是 v01 TeamScreen 还在用的活键。
顺手给 `i18n-orphans.mjs` 的「叶子键下限」守卫加了账本（每次合法删键都会让它失效一次）。

### 1 · 三张 hard-contract 全部修完并各自立门
- **#37**（详情浮层「出处」是工作区级全量清单）→ **删掉这一节**。定语义时查了契约：
  `LivePersonCard`/`LiveProjectCard` **根本没有 source 字段**，逐卡溯源在契约里不存在，
  所以"这张卡出自这些文件"对**任何**卡都说不出口，不只是手打的那些。
  只给手打卡补一句"无文档出处"反而坐实了"其余卡片列的就是它们的出处"。范围比票大一点：v01 同病，一起改。
  新门 verify-detail-provenance：born-red 14 PASS·8 FAIL（复现"三个人打印同一份 9 文件、含另外两人简历"），
  born-green 22 PASS·0 FAIL。
- **#34 / #36**（屏底家具劫持控件）→ **同一个根因**：滚动口 `inset:0` 铺到视口底边，内容从
  fixed 家具底下穿过去。修法：`.lite2-shell` 下三个滚动口下边界抬起 120px；
  胶囊 `bottom` 从写死 24px 改成 `calc(var(--lite2-footer-h) + 12px)`，变量由 Lite2Footer 用
  ResizeObserver 发布**实测**页脚高度（窄屏实测 59px——原来那个 24 隐含的"页脚薄薄一条"假设正是根因，
  再猜一个常数就是把同一个 bug 换个数字重犯）。
  新门 verify-bottom-furniture-clearance：born-red 复现两票坐标逐字对上，修后 34 PASS·0 FAIL。

## What's Next（按优先级）

1. **#38 locale 契约（判读链路双语对等）—— PRD 已 grill 完，下一棒可直接开工**。
   触发：原本不打算在境内找用户，现在要和三亚一家公司对接，中文第一次是真实客户需求。
   PRD `.issues/locale-contract-0803/prd.md`（11 条决议逐条拍板）·
   [ADR-0033](docs/adr/0033-locale-is-a-request-field-backend-stops-emitting-prose.md)
   （含**反转**「前端不硬编码档位词」那条旧决策）· CONTEXT.md 新增「Language surface」词条。
   🔴 开工前必读 PRD §0：票面说的"三处 `LABEL_ZH`"严重低估——后端 396 处中文字面量里，
   **输入侧检测词表/正则（extract/redline/granularity）一个字都不许动**，
   那是读中文文档 + 守红线的匹配模式，顺手双语化＝当场砸掉解析与红线。
2. **r2 剩下的未开票发现**（原 17 条，本轮消化掉布局/文案类里的三条 hard-contract；
   其余在 `.issues/sweep/2026-08-02-r2.md`，按屏分好了）。
3. **gate-run 迁移继续**：已迁 9 道（第一波 3 + 第二波 5 + flow-gap-phases 生来就用）。
   `verify-aria-zh` / `verify-cr-alignment` 仍未迁——形状不兼容，要先扩 makeRec
   （4 参数 future 语义 / 多累积数组模型）。**已迁/未迁一律用自查命令数，别抄数字。**
4. **files-hub 独立票 #26–#29** · 换血抢救票 #31/#32 · v01 退役成本账 #33（ready-for-human）。
5. **UI 线**：🔴 真机零覆盖（iOS Safari / 微信内置）优先级最高——本轮 375×812 仍是 headless 模拟。
   #34/#36 恰恰是小屏专属问题，真机大概率更严重；断点动物园；像素基线 tracked 与否未拍板。
6. **成本票 #30**（CRUD 50 秒）：Danny 已拍板等真实客户量再立，只记数。
7. **真 brain 分流取证**：要真花钱，需要先给口径（上限几次调用/打 demo 克隆还是真 context/超了就停）。

## Blockers / Risks

- 无硬 blocker。合伙人端到端试用反馈仍是最高优先中断源。
- 🔴 **`e535ec9` 的 commit message 是错的**（装 nudge 的代码、挂 lint 的正文，已 push）。
  改写已 push 历史属人工闸，没自己动；真相记在 `03a9824` 这条 erratum commit。要不要 rebase 归 Danny。
- 六个 worktree 仍挂着，分支停在更早 commit——删分支/worktree 属删除闸，归 Danny。
- A 区上传型门现在是 **8 道**（本轮把三道错标的认了出来，又新增两道）。每跑一次 A 区会在 mock
  后端造几十个 context；本机 mock 是内存态、进程一停就没。真库那头的 demo 克隆 GC 口径值得复看。
- ⚠️ 本轮观察到一次 **`verify-null-owner` 假红**：连跑多轮电池之后 `POST /ingest` 超时，
  单独重跑即 15 PASS·0 FAIL。判定是 mock 后端在长时间高频上传下的偶发，不是回归——
  但下次再见到它红，先单独重跑一次再当真。

## 站着别动的事（Danny 人工闸，agent 别代决）

- 凭据轮换；裸「风险：」词表加宽；`origin/p5-04-nexus-safe-zone` 废弃分支处置。
- 法律件三份对外风险（DPA / 隐私件称境内而后端在法兰克福）——归合伙人，工程线不捡。
- 合伙人对外仍讲「不打分不排名」旧口径——Danny 亲自同步（ADR-0025 后果节）。
- 生产库历史数据的任何修复/清理。
