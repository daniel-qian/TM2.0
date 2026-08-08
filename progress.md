# Session Progress Log

> 📢 本文件是**当前状态快照，整体重写不追加**。历史都在 git（`git log` + 各 `.issues/*/receipt*.md`），别在这儿堆编年史。
> 启动路径见 `AGENTS.md` Startup Workflow：读本文件 + `feature_list.json`，跑 `./init.sh` 确认绿，再开工。

**Last Updated:** 2026-08-08（**演习第 3 轮 wave 1 全部落 main**：#70 先合、**#69+#71 后合并
复跑全电池**；三票都已关。wave 2 的 **#72** 可以开了（依赖已满足）；仍未 push、未上产）

## Current State

- **git**：`main`（`8d4cbd1`）= 差距战役八票 + gap2 三票 + 演习批三票 + 演习第 2 轮批三票
  （#65/#66+#67）+ #68 + #70 + **#69+#71**
  （`.issues/rehearsal-0808/receipt-69-71-conversation-flow.md`）。
  `main...origin/main` **ahead 47**（以 `git status -sb` 为准），**没有 push**（见 Blockers）。
- **像素基线现状**：两套共 50 张（36 张空态 visual.spec + 14 张数据态 visual-data.spec，
  数据态那套钉死页面时钟 setFixedTime 2026-08-08T12:00）。全部主检出冻、gitignore 单机产物。
  **#69+#71 合流后在主检出对着真基线复跑：8/8 全绿、基线 mtime 一秒没动**（是比对不是重写）。
  会话流改的是**运行态**，空态基线零漂移的预判成立。
- **✅ 生产仍停在 08-07 白天那一版**（`main-20260807-190332` = main `99d83f7`）。
  gap2 三票 + 三轮演习批 + #68 + #70 + #69/#71 **都没有上产**——统一上产另行安排
  （What's Next 第 2 条）。迁移 0012/0013/0014 已在生产库落地。
- 🔴 **迁移账（上产时按这个来）**：
  - **T9 需要 `0015_form_submissions_auto_key.sql`**（increment-only、`_ensure_schema()` 自动重放）。
  - **其余各票（含 #68 / #70 / #69+#71）都不需要**——#71 的 `history` 不落库，`advise_runs`
    表结构与写入口径一字未动。
  - 判据一句话：**动 dataclass 里被整块 jsonb 装着的字段 → 免迁移；动表的顶层列 → 必须迁移。**
- 🔴 **合的都是本地 main，没有 push**。「落 main 即止」＝**不 push**：前端 push main 即自动
  构建上产，push + 换后端容器必须在统一上产 session 的**同一个窗口里**做。

## 本轮做完的（2026-08-08 · #69 预填退灰提示 + #71 议事室会话流）

回执：`.issues/rehearsal-0808/receipt-69-71-conversation-flow.md`（含 born-red 五条台账、
打回的那一处、刻意没做的边界）。**后合者**——先并 main（已有 #70）再复跑全电池。

- **#71 会话流**：`run` 单槽 → **`turns: LiveTurn[]`**（`{id, question, refs, run}`）。
  此前的覆盖是**结构性**的，而且提问文本前端从没存过（`LiveRunState` 无该字段、后端
  `started.prompt` 被 streamSource 显式丢弃）——「回显提问」得先有装它的地方。
  `run` 保留成**尾轮镜像**（notifyStore + 十道门读它）；流回调按 `turn.id` 认领自己那轮。
- **后端 `history` additive optional、零迁移**：新文件 `service/history.py` 是唯一配额点
  （6 轮 / 400 / 800 / 整块 3000 字），超额丢最早的、**截断有标记且标记进 prompt**。
  `engine.stream_advice` 自己调 normalize，不信调用方。**既有 pytest 全套 3996 零改动通过
  = 旧前端完全兼容那道门本身。**
- **离开议事室 / 刷新 = 这场对话结束**（拍板：刻意不持久化）。门⑥ 直接搜 localStorage
  里有没有任何一问的正文来钉这条。
- **#69 预填退灰提示**：flowStore 分**正文/提示两条通道**，URL 中继分 **`q` / `qh`** 两个键；
  7 个卡片入口全改；**悬浮胶囊刻意留在正文通道**（那是 manager 自己刚打完的原话，退成灰
  提示等于让他再打一遍——尤其在空文本置灰之后会落进死角）。
- **顺带（#71）**：上一轮还在流时发送键也置灰（对齐 codex/claude）。不做"打断上一轮"是因为
  被中止的流会被收成 `'complete'`，在会话流里就成了一条「看着答完了其实被砍了」的假记录。
- **新碑**：**提示长度闸必须开在显示宽度上，不是字符数上**（详见 Blockers）。

## 上几轮做完的（详情全在各自回执，这里只留会影响下一个人的）

- **#70 @ 文件引用两修**——回执 `receipt-70-file-ref-quality.md`。候选轮转发牌（公平配额）
  + `_file_doc_lines` 注入真原文；两条碑：公平配额≠看得见、门语料不能复现病根＝空跑。
  核实中撞出 **#74**（补传重名文件 → `source_key` 改了但 `file_cards()` 不发它）。
- **#68 数据态像素基线**——born-red 按视口逐个验（桌面红≠手机红）；数据态基线必须钉页面时钟。
- **#66+#67（捆绑）**——@ 弹层可用空间感知 + askRefs 唯一构造器接 7 入口。
  🔴 **CSS 包含块/裁剪必须浏览器实测**。
- **#65 今天页差距块默认展开** · **#64 议事室 @ 引用回归**（`preamble` 钉开场轮）。
- **#63 并屏退 tab**——**改 tab 数三处一起**：LiteTopbar + v2boots + auth-form `tabCount===8`。
- **#61 markdown 表格花名册** / **T9 #58 / T10 #59 / T11 #60**——回执在各 wave 目录。
  🔴 `_GUARDED` 精确匹配，带路径参数的路由命不中。

## What's Next（按优先级）

1. **#72 建议追问 chips + 快问触发收敛**（wave 2，**依赖已满足**——#71 的追问机制已落 main）。
   开卡片前先读 `receipt-69-71` 的「刻意没做」一节：会话流的尾轮/历史轮渲染分工、
   `ask` 卡仍随新一轮退场这两条都会影响 #72 的落点。
2. **统一上产**（gap2 三票 + 三轮演习批 + #68 + #70 + #69/#71）。🔴 push 与换后端容器同窗口；
   **0015 必须落地**；上产后先设 `AVERY_PUBLIC_BASE` 再验表单。
3. **复演（第 4 轮）**：`preview_start rehearsal-api / rehearsal-web`；库 `rehearsal0808` 保留；
   脑真 MiniMax。验：①预填=灰色提示不占正文、空着发不出去 ②打 @ 零筛选一眼看得见文件候选，
   引一份文件问「这里面写了什么」回答引得到原话 ③**问两问不覆盖、追问接得住上一轮的指代**
   ④回答下方建议追问可点（#72 落后）。
4. **#74 file-ref-id**（#70 核实出来的真缺陷，纯前端契约票：`file_cards()` 补发 `source_key`
   → `LiteFileEntry` 加字段 → `askRefs.ts` 用它当 id、label 仍用 filename）。后端一行不用动。
5. **T8 两条记录**：① 议事室引用编号形状；② 今天页证据行机器形状（ADR-0033）。
6. **给 `/health` 加版本字段**。
7. carry-over：**持久对话线程（0808 拍板不做，#71 只做 session 内）** · **议事室流卡死时
   composer 会一直锁着（#71 的已知边界，没有前端超时）** · 判读卡 4 段死渲染 + 后端已发前端
   未消费 7 类字段 · r2 未开票发现 · gate-run 迁移 · files-hub #26–#29 · 换血抢救 #31/#32 ·
   v01 退役 #33 · 真机零覆盖（iOS/微信，最高优）· 成本票 #30 · 真 brain 分流取证 ·
   全量 feat-063 · **#73 composer 现场上传**（后排不排期）。

## Notes（顺手发现，没顺手修）

- **会话流下「新一轮开跑即撤旧快问卡」这条值得重裁**（#71 按票面"现有件语义不变"照旧了）：
  追问不该杀掉手上正要发的快问草稿。要改是 #72 那条线上的事。
- **历史轮没有折叠**（票面写的是"折叠成问题行+回答卡"）：因为「依据 N 条原文」的出处只挂在
  分析过程面板上，折掉它等于把历史轮的溯源一起折掉。要真折叠得先给回答卡自己一条出处线。
- **决策卡的 `reason` 在 mock 语料下是空的**（灰提示因此只有 `别墅套餐推广 —`）——既有现象，
  不是 #69 引入的。
- **`tests/test_at_references.py:90` 潜伏 typo**：断言消息用 `rep.errors`，而 `IngestReport`
  上只有 `parse_errors`——只在断言真失败时才炸，把一次干净的红变成 AttributeError traceback。
- **`>` 开头的材料块结构性不可引用**：`_candidates` 跳过 `>` 行，这类块拿不到可 cite 指针。
- **facts.md 指针不是单射**：`materialize_memory` 按文本去重，两份文档的同一句话共用一行。
  **别拿指针反推「这行属于哪份文档」**——那样的判据会对着正确代码假红。
- **自述数字的口径**：`self_report` 开关只管**人卡投影**；原文行本来就在 facts.md 材料区。
- **数据态像素只覆盖 home/team/projects**（#68 方案 B）；升方案 A 归 Danny。
  **议事室（room）两套基线都只有空态**——会话流是运行态，靠 DOM 判据 + 交互态截图人眼过。
- **弹层 `--lite2-surface` 背景带透明度**（#66）：长文上底字微透，要改是皮肤票。
- **空态弹层可用高度受 `.nexus-empty` 卡几何钳制**：要更大弹层得 portal 出卡，单独开票裁。
- 🔴 **`AVERY_PUBLIC_BASE` 必须指后端自己的口**（#63 实收）。
- **粒度闸够不着跨批次**（T10 记档，碑在 `file_append.py`）。
- **`role`/`tenure` 两份资料说法不同时两条路都不记冲突**（既有边界）。
- **`_people_from_roster` 位置兜底会顶掉空格子**（#61 看清的既有怪癖）。
- bellIsReal / nudgeVerdict 等手册协议相位仍无机械 runner；bellIsReal 落点已随 #63 改判 home。
- **@ 引用候选检索纯前端内存**；playbook 卡无 id、标题即稳定键——长出 id 时两处一起换。
- **分诊卡 personIds 依赖后端 ownerId 链接**；对不上时退化为只带 project ref。

## Blockers / Risks

- 无硬 blocker。
- 🟠 **别单独 push main**（ahead 47）：前端 push 即自动上产、后端容器要人手换，同窗口做。
- 🔴 **文案长度闸开在字符数上 = 英文当场出血**（#69 新碑）：`length<=40` 中文全绿，一条
  **43 字符的英文标题**被拦腰截断，连主体都没露全——40 个汉字和 40 个字母在屏幕上差一倍宽。
  一律用**显示宽度**（半角单位，CJK 记 2）。逮到它的是那道跑 `?lang=en` + 英文种子的既有门
  ——**门语料的语言多样性本身就是覆盖**（`gate-corpus-all-ascii-blindspot` 的反面）。
- 🔴 **同一条判据要配同一个变异**（#71 实收）：票面预判「恢复整体覆盖 → 两条判据红」，实测
  只红掉 DOM 那条——history 是在 append **之前**从 turns 组装的，单槽变异摸不到它。
  两条判据必须各有各的变异（补跑了 M1b「请求体不带 history」才把第二条钉住），别让一条
  变异替另一条判据背书。
- 🔴 **belt-and-braces 让内层规则免疫变异**（#69 又撞一次）：submit handler 里的
  `if (!text) return` 会让「点了没发请求」这条判据在**置灰被拆掉之后照样绿**。判据必须
  直接落在被测的那个属性上（`button.disabled`），不能只看下游后果。
- 🔴 **公平配额 ≠ 看得见**（#70 碑）：弹层列表钳在 240px，一屏只有 4–5 行。判据要落在
  **不滚就看得见**上（rect 落在可视带内 + `elementFromPoint` 命中，两个都要）。
- 🔴 **门语料不能复现病根 = 整段判据空跑**（#70 碑）：加判据前先问「这份语料真的能让它红吗」，
  并把那个前提写成**自证判据**。
- 🔴 **同一份数据两处各写一把尺 = 定时炸弹**（#70 病根）：已提成 `memory.candidate_text()`。
- 🔴 **像素基线两套 50 张全是 gitignore 单机产物**：**worktree 里冻＝白冻**——首跑红是
  「无基线首写」，复跑绿只证稳定不证零漂移。零漂移只能在**主检出**对着真基线证
  （比对完查 mtime：没动才是真比对）。数据态那套依赖后端带
  `AVERY_DEMO_SEED_DIR=tests/fixtures/demo-seed`（不是 `seed`）。
- 🔴 **born-red 要按视口逐个验**（#68 实收）：桌面红≠手机红。
- 🔴 **数据态基线的时钟已钉死在 spec 里**（setFixedTime）：改语料/加数据态屏时别忘同款钉。
- 🔴 **CSS 包含块/裁剪的读码推断必须浏览器实测**（#66 实收）。
- 🔴 **像素门不密闭：后端够不着 → `home` 先红**。三件套照旧（dist 重打 + 后端带 demo seed +
  CORS 放行）。
- ⚠ **B 区 `verify-null-owner` 把 5173 写死在 `:28`（不吃 VERIFY_BASE）**：在隔离端口上跑
  全电池时它够不着自己的 dist。#69/#71 是等邻居那条线的 preview 退出后、在主检出的 5173
  上补跑的（15/15 绿）。并行线同时在跑时，这道门在隔离端口上只能记「没跑」。
- 🔴 **`./init.sh` 和 run-battery 的收尾重建都 `vite build` 不带 api base** → dist 落回
  `vite.config.ts` 默认 = **生产域名**。跑任何上传型门之前先重打一次带 `VITE_AVERY_API_BASE`
  的 dist（或验 `window.__AVERY_BUILD__.apiBase`）。
- 🔴 **杀 npx 包装进程杀不死 vite 子进程**；stale 进程按端口杀、CommandLine **认领**后只杀自己的。
- 🔴 **cwd 残留会把 git 操作打到别的树**：worktree 会话里 git 一律 `-C <树>` 显式指定。
- 🔴 **改判清单要把 C 区也扫进去**；「全仓改判」用 `git ls-files "*verify-*.mjs"` 全量扫。
  ⚠ 还有一处**不在那个 glob 里**：`scripts/gates/live-frontend-gate.snippet.js`（B/C 组的
  共享驱动 + 人工注入协议）。#69 改预填语义时它的两个相位是跟着一起改的。
- 🔴 **门驱动 store 还是真部件**决定能否看见「接线」bug；**别让驱动助手顺手修复被测行为**。
- 🟠 **门的环境缺一样就假红**。最小清单：`AVERY_BRAIN=mock` + `AVERY_EXTRACTOR=heuristic` +
  `AVERY_EMBEDDINGS=keyword` + `AVERY_DEMO_SEED_DIR` + `AVERY_PUBLIC_BASE=<后端口>` +
  `AVERY_CORS_ORIGINS`；跑门给 `VERIFY_BASE` **和** `VERIFY_API`。
- 🔴 **脚本落盘的「会话/状态」文件默认当凭据**；先写 .gitignore 再写脚本。
- ⚠ **提示词约束不是判据**。
- 🔴 **本机 Docker PG 容器时钟来回跳 ~115s**：`created_at < now()` 判据间歇假红。
- 🔴 **本机 curl / argv / stdout 都按 GBK 啃中文**：中文只走文件（`git commit -F` /
  `gh api --input`）；python 要 `sys.stdout.reconfigure(encoding='utf-8')`。
- 🔴 `e535ec9` commit message 是错的（真相在 `03a9824` erratum）；rebase 与否归 Danny。
- 🔴 repo 级 stash 两条别人的存货；处置归 Danny。
- 多个战役 worktree 仍挂着（29 个上下）——删分支/worktree 属删除闸，归 Danny。
- ⚠ **各票收尾必须重写本文件**（AGENTS.md DoD）。
