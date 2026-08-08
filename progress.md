# Session Progress Log

> 📢 本文件是**当前状态快照，整体重写不追加**。历史都在 git（`git log` + 各 `.issues/*/receipt*.md`），别在这儿堆编年史。
> 启动路径见 `AGENTS.md` Startup Workflow：读本文件 + `feature_list.json`，跑 `./init.sh` 确认绿，再开工。

**Last Updated:** 2026-08-08（**#65 落 main（`3910bcb`）**，演习第 2 轮批余下 #66+#67 的
session 并行中未合——**合 main 串行，后合的在主检出复跑电池**；仍未 push、未上产）

## Current State

- **git**：`main`（`3910bcb`）= 差距战役八票 + gap2 三票 + 演习批三票（#61/#63/#64）+
  **#65**（`.issues/rehearsal-0808/receipt-65-home-gaps-default-open.md`）。
  `main...origin/main [ahead 30]`（本条 docs 提交后 31），**没有 push**（见 Blockers）。
- **#65 验证账实（worktree 树 = 合并后 main 同树实测）**：
  前端电池 **A 30/30 · B data-boundary/null-owner 绿 · C 3/3**（标准口独占跑）；
  flow-gap-phases 升 **10 判据**（新增 gapsDefaultOpen：fresh mount 零点击见对照卡 +
  aria-expanded + 摘要 chips 不并存三叉判别），主检出 main 树复测 10/10；
  变异（初值回退 collapsed）被专门判据**精确击杀**（其余 9 判据靠 `_openHomeGaps` 修复点击
  照常绿）、回滚复绿；`./init.sh` 绿。后端零 diff，离线 pytest 套沿用 #64 在同基线的 3974/0
  （#65 四个改动文件全在前端/门侧，够不着 Python 面）。
  ✅ **像素：零漂移且是结构性的**（详见回执像素账）——visual.spec 的 home 采样是**空态引导页**
  （stub 在 build+preview 是死的 → fresh context 无数据 → `gapsTotal===0` 走空态分支），
  差距块初值不参与那 36 张的渲染。主检出对旧基线 4/4 零漂移、**基线未动未重冻**；
  票面「今天页必漂」的预判不成立。人眼过走交互态直拍 `t65-shots/` 四张
  （zh/en × 桌面/375 手机），双视口折行全过（en-mobile 的 Collapse 换行是既有 header
  流式行为，非溢出）。
- **✅ 生产仍停在 08-07 白天那一版**（`main-20260807-190332` = main `99d83f7`）。
  gap2 三票 + 两轮演习批**都没有上产**——统一上产另行安排（What's Next 第 3 条）。
  迁移 0012/0013/0014 已在生产库落地。
- 🔴 **迁移账（上产时按这个来）**：
  - **T9 需要 `0015_form_submissions_auto_key.sql`**（increment-only、`_ensure_schema()` 自动重放）。
  - **T11 / T10 / #61 / #63 / #64 / #65 都不需要**（#65 纯前端一行初值 + 门）。
  - 判据一句话：**动 dataclass 里被整块 jsonb 装着的字段 → 免迁移；动表的顶层列 → 必须迁移。**
- 🔴 **合的都是本地 main，没有 push**。「落 main 即止」＝**不 push**：前端 push main 即自动
  构建上产，push + 换后端容器必须在统一上产 session 的**同一个窗口里**做。

## 本轮做完的（2026-08-08 · #65 今天页差距块默认展开）

回执：`.issues/rehearsal-0808/receipt-65-home-gaps-default-open.md`（门账/变异账/像素账/人眼过四账齐）。

- **HomeScreen `gapsOpen` 初值 `false→true` 一行**（#63 留下的组件本地态，刻意不落盘：
  切屏回来=回到展开，是拍板语义）。摘要 chips 形态保留为「收起」后形态，两套入口仍不并存；
  i18n 键零动。
- **门**：snippet 新增 `assertGapsDefaultOpen`（**刻意不走 `_openHomeGaps`**——那个助手发现
  收起会顺手点开，正好把变异修复掉；这是「助手好心修复掉被测行为」的活样本）；进 gapVerdict
  聚合；runner 排 C 组判据头。`_openHomeGaps` 幂等排查过：默认展开下守卫点击变 no-op，无假红。
- **⚠ 像素盲区开账（只记录未动）**：「今天页」的像素基线覆盖只有**空态**——差距块数据态/
  展开态对照卡不在 36 张射程内，对照卡视觉回归目前只有 DOM 判据 + 人眼截图兜着。
  要不要给像素门喂数据态（牵动全部基线口径），单独开票裁。

## 上几轮做完的（详情全在各自回执，这里只留会影响下一个人的）

- **#64 议事室 @ 引用回归**——回执 `receipt-64-at-references.md`。经理提问可 @ 点名，读数保证
  进模型上下文（`preamble` 钉开场轮）；React SelectEventPlugin 同批次 onKeyDown→onSelect 重开
  浮层的坑：**「输入框内 Esc 关浮层」的静音位必须用 ref**。
- **#63 「值得注意」并进「今天」（浅合）**——回执 `receipt-63-merge-closerlook.md`。
  tab 9→8、`/closer-look` 重定向 home。**改 tab 数时三处一起**：LiteTopbar tabs 数组 +
  v2boots 期望数组 + auth-form 的 `tabCount===8`。
- **#61 花名册吃标准 markdown 表格**——回执 `receipt-61-md-table-frame.md`。
- **T9 站内主动（#58）/ T10 补资料（#59）/ T11 模板拼装器（#60）**——回执在 `.issues/gap2-0807/`。
  🔴 `upload_guard._GUARDED` 精确匹配，带路径参数的路由永远命不中。

## What's Next（按优先级）

1. **#66+#67 session（并行中）收尾**：都动 AskRefComposer/议事室一带（#66 @ 弹层遮挡三病根、
   #67 预填入口全量引用化 8 入口）。⚠ 它**后合 main**：合并串行、合后在主检出**复跑全电池**
   （#65 已合入，battery 面貌 = A 30 + flow-gap-phases 10 判据）+ 自判像素漂移
   （议事室/弹层是交互态，未必进基线射程——#65 的教训：先想清楚 spec 采的是什么状态，
   「必漂」别拍脑袋）。
2. **复演（续）**（第 2 轮批全落后，本地）：`preview_start rehearsal-api / rehearsal-web`
   （launch.json 两条在，本地未提交；后端脚本 `.issues/gap2-0807/rehearsal-api.ps1`）。
   库 `rehearsal0808` 保留；脑真 MiniMax，抽取/检索离线。顺手验：
   ① markdown 表格花名册上传（#61）；② 差距对照卡动线 + **默认展开**（#63/#65 真验收——
   进今天页第一眼就该是完整对照卡）；③ @ 引用打真脑（#64）；④ 人卡/项目卡「去问 Avery」
   带 chip（#67）。
3. **统一上产**（gap2 三票 + 两轮演习批）。🔴 push 与换后端容器同窗口；0015 必须落地；
   上产后先设 `AVERY_PUBLIC_BASE` 再验表单。
4. **T8 两条记录还在桌上**：① 议事室引用编号 `facts.md:<行号>` vs 客户文档名；② 今天页证据行
   机器形状（ADR-0033）。
5. **给 `/health` 加版本字段**。
6. carry-over：r2 未开票发现 · gate-run 迁移 · files-hub #26–#29 · 换血抢救 #31/#32 ·
   v01 退役 #33 · 真机零覆盖（iOS/微信，最高优）· 成本票 #30 · 真 brain 分流取证 · 全量 feat-063。

## Notes（顺手发现，没顺手修）

- 🔴 **像素基线的 home 屏采样是空态**（#65 实收）：spec 里 `?transport=stub` 在 build+preview
  产物上是死的，fresh context 无数据——**任何只在数据态渲染的部件都不在 36 张射程内**。
  给票面写「像素必漂」之前，先想 spec 采的是什么状态。
- 🔴 **`AVERY_PUBLIC_BASE` 必须指后端自己的口**（#63 实收）。
- **粒度闸够不着跨批次**（T10 记档，碑在 `file_append.py`）。
- **`role`/`tenure` 两份资料说法不同时两条路都不记冲突**（既有边界）。
- **`_people_from_roster` 位置兜底会顶掉空格子**（#61 看清的既有怪癖），要不要改单独裁。
- bellIsReal / nudgeVerdict 等手册协议相位仍无机械 runner；bellIsReal 落点已随 #63 改判 home。
- **@ 引用候选检索纯前端内存**；playbook 卡无 id、标题即稳定键——长出 id 时 askRefs/
  `_playbook_entry` 两处一起换。

## Blockers / Risks

- 无硬 blocker。
- 🟠 **别单独 push main**（ahead 30+）：前端 push 即自动上产、后端容器要人手换，两件事同窗口做。
- 🔴 **在 worktree 里重冻像素＝没重冻**：`__snapshots__/` 是 gitignore 的单机产物。worktree 电池
  里 visual 红的默认形态是**无基线首写**（#65 又验了一次：首跑 missing→写入报败，复跑即绿，
  不作数）；主检出红了先比 mtime 再谈漂移。**现基线 36 张未动**（#64 零漂移、#65 结构性零漂移）。
- 🔴 **像素门不密闭：后端够不着 → `home` 先红**。跑前三件套：dist `VITE_AVERY_API_BASE` 重打 +
  那个口上真有后端（带 `AVERY_DEMO_SEED_DIR`）+ `AVERY_CORS_ORIGINS` 放行 preview origin。
- 🔴 **杀 npx 包装进程杀不死 vite 子进程**：孤儿 preview 占 5173 会让下一个 preview 静默落
  5175——`Get-NetTCPConnection` 拿 PID → CommandLine **认领**（路径带自己 worktree 名）→ 只杀
  自己的。#65 全程照此执行，无孤儿残留。
- 🔴 **改判清单要把 C 区（自建 dist 的门）也扫进去**；「全仓改判」用 `git ls-files "*verify-*.mjs"`
  全量扫。
- 🔴 **门驱动 store 还是真部件，决定它能不能看见「接线」型 bug**；落点/初值类判据要**先离开
  目的地再触发**（#65 的 gapsDefaultOpen 是最新样板，且多一条：**别让驱动助手顺手修复被测行为**）。
- 🟠 **门的环境缺一样就以「像回归」的形态假红**。起门最小清单：`AVERY_BRAIN=mock` +
  `AVERY_EXTRACTOR=heuristic` + `AVERY_EMBEDDINGS=keyword` + `AVERY_DEMO_SEED_DIR` +
  `AVERY_PUBLIC_BASE=<后端口>` + `AVERY_CORS_ORIGINS`；跑门时 `VERIFY_BASE` **和** `VERIFY_API` 都给。
- 🔴 **脚本落盘的「会话/状态」文件默认当凭据看**；先写 .gitignore 再写脚本。
- ⚠ **提示词里的约束不是判据**；**belt-and-braces 会让内层规则免疫变异**——两把锁必须两道独立门。
- 🔴 **本机 Docker PG 容器时钟来回跳 ~115s**：`created_at < now()` 判据间歇假红。
- 🔴 **本机 curl / argv / stdout 都按 GBK 啃中文**：中文只走文件（`git commit -F` /
  `gh --input`）；python 要 `sys.stdout.reconfigure(encoding='utf-8')`。
- 🔴 `e535ec9` commit message 是错的（真相在 `03a9824` erratum）；rebase 与否归 Danny。
- 🔴 repo 级 stash 两条别人的存货；处置归 Danny。
- 多个战役 worktree 仍挂着（25 个上下）——删分支/worktree 属删除闸，归 Danny。
- ⚠ **各票收尾必须重写本文件**（AGENTS.md DoD）。
