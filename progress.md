# Session Progress Log

> 📢 本文件是**当前状态快照，整体重写不追加**。历史都在 git（`git log` + 各 `.issues/*/receipt*.md`），别在这儿堆编年史。
> 启动路径见 `AGENTS.md` Startup Workflow：读本文件 + `feature_list.json`，跑 `./init.sh` 确认绿，再开工。

**Last Updated:** 2026-08-08（**演习第 3 轮 wave 1 · #70 已落 main 并关票**；#69+#71 捆绑
线尚未动笔；核实中撞出一个真缺陷，开成 **#74**；仍未 push、未上产）

## Current State

- **git**：`main`（`c9913cf`）= 差距战役八票 + gap2 三票 + 演习批三票 + 演习第 2 轮批三票
  （#65/#66+#67）+ #68 + **#70**（`.issues/rehearsal-0808/receipt-70-file-ref-quality.md`）。
  `main...origin/main` **ahead 44**（以 `git status -sb` 为准），**没有 push**（见 Blockers）。
- **像素基线现状**：两套共 50 张（36 张空态 visual.spec + 14 张数据态 visual-data.spec，
  数据态那套钉死页面时钟 setFixedTime 2026-08-08T12:00）。全部主检出冻、gitignore 单机产物。
  **#70 合流后在主检出对着这 50 张真基线复跑过：8/8 全绿、基线 mtime 一秒没动**（是比对不是重写）。
- **✅ 生产仍停在 08-07 白天那一版**（`main-20260807-190332` = main `99d83f7`）。
  gap2 三票 + 三轮演习批 + #68 + #70 **都没有上产**——统一上产另行安排（What's Next 第 3 条）。
  迁移 0012/0013/0014 已在生产库落地。
- 🔴 **迁移账（上产时按这个来）**：
  - **T9 需要 `0015_form_submissions_auto_key.sql`**（increment-only、`_ensure_schema()` 自动重放）。
  - **其余各票（含 #68 / #70——都是门侧 + 纯逻辑）都不需要。**
  - 判据一句话：**动 dataclass 里被整块 jsonb 装着的字段 → 免迁移；动表的顶层列 → 必须迁移。**
- 🔴 **合的都是本地 main，没有 push**。「落 main 即止」＝**不 push**：前端 push main 即自动
  构建上产，push + 换后端容器必须在统一上产 session 的**同一个窗口里**做。

## 本轮做完的（2026-08-08 · #70 @ 文件引用两修）

回执：`.issues/rehearsal-0808/receipt-70-file-ref-quality.md`（病根数字/born-red 五条/
验证账/#74 的实证）。**先合者**——#69/#71 尚未动笔，零冲突。

- **可发现性**：新增 `pickRefOptions`（askRefs.ts）——候选按四类**轮转发牌**收敛到 8，
  某类发完名额回流；单类视图退化成原来的 slice，逐条行为不变。`MAX_REF_OPTIONS` 仍是 8。
  `AskRefComposer` 只动 import + 候选 memo 一行（#69/#71 保留区一行没碰）。
- **注入质量**：`_file_doc_lines` 改成「该文档自己的材料块原文优先、实体名补位垫后」，
  规范化那把尺提成 `memory.candidate_text()` 两处共用。
- **两条新碑**（细节见 Blockers）：① **公平配额不等于看得见**——列表被钳在 240px，
  一屏 4–5 行，成块吐出时文件在帘子下面；② **门语料不能复现病根 = 整段判据空跑**——
  旧的 3 人语料里「打 @ 看得见文件」在**没修的代码上也是绿的**。
- **顺带核实出真缺陷 → #74**：补传重名文件时服务端改的是 `source_key`，而 `file_cards()`
  从不发它，前端只能拿 filename 当 id → **重命名的那份文档永远引不到**，且没有 not-found
  行（卡片/指针/cite 全健康，只是每行都属于另一份文件）。按票面「扩权另裁」记档未修。

## 上几轮做完的（详情全在各自回执，这里只留会影响下一个人的）

- **#68 数据态像素基线**——回执 `receipt-68-visual-datastate.md`。born-red 按视口逐个验
  （桌面红≠手机红）；数据态基线必须钉页面时钟。
- **#66+#67（捆绑）**——回执 `receipt-66-67-refpicker-prefill.md`。@ 弹层可用空间感知
  （翻转/钳高）+ askRefs 唯一构造器接 7 入口。🔴 **CSS 包含块/裁剪必须浏览器实测**。
- **#65 今天页差距块默认展开**——回执 `receipt-65-home-gaps-default-open.md`。
- **#64 议事室 @ 引用回归**——`preamble` 钉开场轮；Esc 静音位用 ref。
- **#63 并屏退 tab**——**改 tab 数三处一起**：LiteTopbar + v2boots + auth-form `tabCount===8`。
- **#61 markdown 表格花名册** / **T9 #58 / T10 #59 / T11 #60**——回执在各 wave 目录。
  🔴 `_GUARDED` 精确匹配，带路径参数的路由命不中。

## What's Next（按优先级）

1. **#69+#71 捆绑线**（wave 1 剩下的一半，尚未动笔，worktree `magical-lewin-f37bda` 停在
   `bb07222`）：①预填退灰色提示+空文本置灰（#69）②议事室会话流+带上下文追问、不持久化（#71）。
   🔴 **它们是后合者**——合前必须先并 main（已有 #70）、合流树复跑全电池。
   两票都动 `AskRefComposer` 的 props/draft/handleSubmit/input/submit 区；#70 只动了
   import 与候选 memo 一行，冲突面为零。wave 1 落 main 后补 **#72** 卡片（依赖 #71）。
2. **复演（第 4 轮）**（wave 都落后）：`preview_start rehearsal-api / rehearsal-web`；
   库 `rehearsal0808` 保留；脑真 MiniMax。验：①预填=灰色提示不占正文 ②**打 @ 什么都不筛
   一眼看得见文件候选（不是滚出来的）；引一份文件问「这里面写了什么」，回答里引得到那份
   文件的原话**（#70 的两句话）③问两问不覆盖、追问带上下文 ④回答下方建议追问可点。
3. **统一上产**（gap2 三票 + 三轮演习批 + #68 + #70）。🔴 push 与换后端容器同窗口；
   **0015 必须落地**；上产后先设 `AVERY_PUBLIC_BASE` 再验表单。
4. **#74 file-ref-id**（#70 核实出来的真缺陷，纯前端契约票：`file_cards()` 补发
   `source_key` → `LiteFileEntry` 加字段 → `askRefs.ts` 用它当 id、label 仍用 filename）。
   后端一行不用动——`_file_entry` 的 `source_key == want` 分支今天就已经对了。
5. **T8 两条记录**：① 议事室引用编号形状；② 今天页证据行机器形状（ADR-0033）。
6. **给 `/health` 加版本字段**。
7. carry-over：**持久对话线程（0808 拍板不做，#71 只做 session 内）** · **判读卡 4 段死渲染 +
   后端已发前端未消费 7 类字段** · r2 未开票发现 · gate-run 迁移 · files-hub #26–#29 ·
   换血抢救 #31/#32 · v01 退役 #33 · 真机零覆盖（iOS/微信，最高优）· 成本票 #30 ·
   真 brain 分流取证 · 全量 feat-063 · **#73 composer 现场上传**（后排不排期）。

## Notes（顺手发现，没顺手修）

- **`tests/test_at_references.py:90` 潜伏 typo**：断言消息用 `rep.errors`，而 `IngestReport`
  上只有 `parse_errors`——只在断言真失败时才炸，把一次干净的红变成 AttributeError traceback。
  #70 新加的三个 fixture 都避开了它，**没顺手改**。
- **`>` 开头的材料块结构性不可引用**：`_candidates` 跳过 `>` 行，这类块拿不到可 cite 指针。
  别写「100% 块召回」这种判据。
- **facts.md 指针不是单射**：`materialize_memory` 按文本去重，两份文档的同一句话共用一行。
  可引用性成立，但**别拿指针反推「这行属于哪份文档」**——那样的判据会对着正确代码假红。
- **自述数字的口径**：`self_report` 开关只管**人卡投影**；`- 小王｜负载自述：70%` 这类原文行
  本来就在 facts.md 材料区，recall 与既有 person 引用捞行路径今天就带得出来。#70 让 file
  引用与它们一致，**没有新增暴露类别**。要收紧是 ADR-0018 那条线的票。
- **数据态像素只覆盖 home/team/projects**（#68 方案 B）；升方案 A 归 Danny。
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
- 🟠 **别单独 push main**（ahead 44）：前端 push 即自动上产、后端容器要人手换，同窗口做。
- 🔴 **公平配额 ≠ 看得见**（#70 新碑）：弹层列表钳在 240px、矮视口地板 72px，一屏只有 4–5 行。
  「每类都分到名额」的实现可以让文件排在第九行——判据必须落在**不滚就看得见**上
  （rect 落在列表可视带内 + 中心点 `elementFromPoint` 命中，两个都要，rect 不管裁剪）。
  实证：把 `MAX_REF_OPTIONS` 调到 20，文件行 top=999 而 listBottom=799、scrollTop=0。
- 🔴 **门语料不能复现病根 = 整段判据空跑**（#70 新碑）：旧的 3 人 2 项目语料里 8 个名额
  本来就漏得出文件，「打 @ 看得见文件」**在没修的代码上也是绿的**。加判据前先问一句
  「这份语料真的能让它红吗」，并把那个前提写成**自证判据**（#70 的 ⑤b-1）。
- 🔴 **同一份数据两处各写一把尺 = 定时炸弹**（#70 病根本身）：`materialize_memory` 写
  facts.md 与 `memory._candidates` 读 facts.md 的规范化差了一个 `lstrip("- ")`，
  bullet 行整片 join 不上，四份真语料里文档正文丢了 60–100%。已提成
  `memory.candidate_text()`；这是 `doc_key_of` 那条 ONE RULER 教训的第二次复发。
- 🔴 **像素基线两套 50 张全是 gitignore 单机产物**：**worktree 里冻＝白冻**——首跑红是
  「无基线首写」，50 张 PNG 全是那一刻新建的、一张都没比对，复跑绿只证稳定不证零漂移。
  零漂移只能在**主检出**对着真基线证（#70 就是这么证的：8/8 绿 + 基线 mtime 没动）。
  数据态那套依赖后端带 `AVERY_DEMO_SEED_DIR=tests/fixtures/demo-seed`（不是 `seed`）。
- 🔴 **born-red 要按视口逐个验**（#68 实收）：桌面红≠手机红。
- 🔴 **数据态基线的时钟已钉死在 spec 里**（setFixedTime）：改语料/加数据态屏时别忘同款钉。
- 🔴 **CSS 包含块/裁剪的读码推断必须浏览器实测**（#66 实收）。
- 🔴 **像素门不密闭：后端够不着 → `home` 先红**。三件套照旧（dist 重打 + 后端带 demo seed +
  CORS 放行）。
- ⚠ **B 区 `verify-null-owner` 把 5173 写死在 `:28`（不吃 VERIFY_BASE）**：在隔离端口上跑
  全电池时，必须**另起一份 preview 占住 5173**（同一份 dist）且后端 CORS 同时放行两个 origin，
  否则它以连不上假红。#70 实跑撞到并这么绕过的。
- 🔴 **杀 npx 包装进程杀不死 vite 子进程**；stale 进程按端口杀、CommandLine **认领**后只杀自己的。
- 🔴 **cwd 残留会把 git 操作打到别的树**：worktree 会话里 git 一律 `-C <树>` 显式指定。
- 🔴 **改判清单要把 C 区也扫进去**；「全仓改判」用 `git ls-files "*verify-*.mjs"` 全量扫。
- 🔴 **门驱动 store 还是真部件**决定能否看见「接线」bug；**别让驱动助手顺手修复被测行为**。
- 🟠 **门的环境缺一样就假红**。最小清单：`AVERY_BRAIN=mock` + `AVERY_EXTRACTOR=heuristic` +
  `AVERY_EMBEDDINGS=keyword` + `AVERY_DEMO_SEED_DIR` + `AVERY_PUBLIC_BASE=<后端口>` +
  `AVERY_CORS_ORIGINS`；跑门给 `VERIFY_BASE` **和** `VERIFY_API`。
- 🔴 **脚本落盘的「会话/状态」文件默认当凭据**；先写 .gitignore 再写脚本。
- ⚠ **提示词约束不是判据**；**belt-and-braces 让内层规则免疫变异**——两把锁两道独立门。
- 🔴 **本机 Docker PG 容器时钟来回跳 ~115s**：`created_at < now()` 判据间歇假红。
- 🔴 **本机 curl / argv / stdout 都按 GBK 啃中文**：中文只走文件（`git commit -F` /
  `gh api --input`）；python 要 `sys.stdout.reconfigure(encoding='utf-8')`。
- 🔴 `e535ec9` commit message 是错的（真相在 `03a9824` erratum）；rebase 与否归 Danny。
- 🔴 repo 级 stash 两条别人的存货；处置归 Danny。
- 多个战役 worktree 仍挂着（29 个上下）——删分支/worktree 属删除闸，归 Danny。
- ⚠ **各票收尾必须重写本文件**（AGENTS.md DoD）。
