# Session Progress Log

> 📢 本文件是**当前状态快照，整体重写不追加**。历史都在 git（`git log` + 各 `.issues/*/receipt*.md`），别在这儿堆编年史。
> 启动路径见 `AGENTS.md` Startup Workflow：读本文件 + `feature_list.json`，跑 `./init.sh` 确认绿，再开工。

**Last Updated:** 2026-08-08（**#66+#67 落 main（`1ccdf17`）——演习第 2 轮批三票（#65/#66/#67）
全部落地**；后合复验完成：主检出同树 像素 4/4 零漂移 + 全电池绿；仍未 push、未上产）

## Current State

- **git**：`main`（`1ccdf17`）= 差距战役八票 + gap2 三票 + 演习批三票（#61/#63/#64）+
  演习第 2 轮批三票：**#65**（`receipt-65-home-gaps-default-open.md`）·
  **#66+#67 捆绑批**（`.issues/rehearsal-0808/receipt-66-67-refpicker-prefill.md`，两票一份回执）。
  `main...origin/main [ahead 35]`（本条 docs 提交后 36），**没有 push**（见 Blockers）。
- **#66/#67 验证账实（后合复验：worktree 合流树与主检出 main 同树各测一遍）**：
  前端电池 **A 30/30**（at-references 升 **40 判据**：⑧ #66 弹层几何三宿主×视口矩阵
  （elementFromPoint 防 rect-不管-裁剪）+ ⑨ #67 七入口逐个真点、主判据落 POST /advise
  **网络请求体**）· **B** data-boundary 37/37 + null-owner 15/15 · **C 3/3**；
  变异 **6 杀 + 1 记档存活**（M2 拆空态 relative 单锁在 Chrome 被 `backdrop-filter` 内锁免疫
  ——belt-and-braces 活样本；双锁齐拆 M2′ 被相邻判据击杀，判据有牙）；
  后端离线全套 **3974 passed / 115 deselected / 4 xfailed / 0 failed**（本批零后端改动）；
  i18n 叶子键 984 / 孤儿 0（零新键）；`./init.sh` 绿。
  ✅ **像素：主检出对旧基线 4/4（36 张）零漂移、基线未动未重冻**——#66 静息态 DOM/CSS
  逐字节不变（wrap 的 relative 无偏移零几何变化；placement 只在层开着时产生 class/style）。
  交互态截图 8 张人眼过（`.issues/rehearsal-0808/t66-shots/`：desktop/mobile ×
  空态/运行态/胶囊弹层 6 张 + #67 预填 chip 态 2 张），零折行溢出零破碎。
- **✅ 生产仍停在 08-07 白天那一版**（`main-20260807-190332` = main `99d83f7`）。
  gap2 三票 + 两轮演习批**都没有上产**——统一上产另行安排（What's Next 第 2 条）。
  迁移 0012/0013/0014 已在生产库落地。
- 🔴 **迁移账（上产时按这个来）**：
  - **T9 需要 `0015_form_submissions_auto_key.sql`**（increment-only、`_ensure_schema()` 自动重放）。
  - **T11 / T10 / #61 / #63 / #64 / #65 / #66 / #67 都不需要**（#66/#67 纯前端 + 门，
    契约面沿用 #64 的 `references[]`，零表结构改动）。
  - 判据一句话：**动 dataclass 里被整块 jsonb 装着的字段 → 免迁移；动表的顶层列 → 必须迁移。**
- 🔴 **合的都是本地 main，没有 push**。「落 main 即止」＝**不 push**：前端 push main 即自动
  构建上产，push + 换后端容器必须在统一上产 session 的**同一个窗口里**做。

## 本轮做完的（2026-08-08 · #66 @ 弹层遮挡/错位 + #67 预填入口全量引用化，捆绑 session）

回执：`.issues/rehearsal-0808/receipt-66-67-refpicker-prefill.md`（交付面/病根修正/门账/变异账/
电池终值/人眼过/拍板取舍/已知边界，两票合一份）。

- **#66**：`.lite-ref-picker` 可用空间感知——开层瞬间量「锚点→裁剪窗口」上下余量，装不下
  翻转向下（`is-down`）、哪边都不够钳列表高度（inline max-height，地板 72px）；空态
  `.nexus-empty-composer-wrap` 补 relative 第二把锁。**票面病根修正（读码 vs 浏览器实测）**：
  ① 空态「包含块误落 `.nexus-empty`」在 Chrome 实际不发生——composer 基类的
  `backdrop-filter: blur(12px)` 本身就给 absolute 后代建包含块（static 也建）；
  ② 空态还有一层票面没写的裁剪：`.nexus-empty` 卡自身计算值 `overflow:auto`，弹层超卡顶
  不可滚——「一切 overflow 非 visible 祖先都算裁剪窗口」的写法就是为它。
- **#67**：askRefs 抽 `refOfPerson`/`refOfProject`/`refOfSubject` 唯一一把尺——**弹层候选
  （searchAskRefs）也改走同一构造器**，「同一份定义」是同一个函数不是口头约定（变异 M5 实证：
  改 helper 一处，弹层①与入口⑨两个消费端同死）。7 调用点全接：详情浮层×2 / 分诊卡（多引用
  projectIds+personIds）/ 差距卡 / 决策卡（goScreen `q+refs` 中继，kind 映射在 helper、调用点
  零 'project' 字面量）/ 项目卡面 / 团队人卡。查不到（归档/悬空）退纯文字预填，零硬造 chip。
- **门剧本坑（记档）**：⑨ 首跑 2 红是门自己站在 `/room` 上开详情浮层——RoomScreen 只在挂载时
  消费预填，产品里不存在这条动线；改「先回项目/团队屏再开浮层」后绿。**落点类判据要先离开
  目的地再触发**的又一实例。
- **门环境坑（记档）**：A 首跑 onboard-gate 红＝`AVERY_DEMO_SEED_DIR` 指错——demo 门要
  `tests/fixtures/demo-seed`（中文三亚 16 人），**不是** `tests/fixtures/seed`（RAG 验收那对
  英文文件）；指错的症状形态是「xlsx 文件名被兜底成 1 人 Founder 卡」。

## 上几轮做完的（详情全在各自回执，这里只留会影响下一个人的）

- **#65 今天页差距块默认展开**——回执 `receipt-65-home-gaps-default-open.md`。`gapsOpen` 初值
  一行 + gapsDefaultOpen 判据（**别让驱动助手顺手修复被测行为**）；像素盲区立碑：36 张的
  home 采样是**空态**，数据态部件不在射程内，「必漂」别拍脑袋。
- **#64 议事室 @ 引用回归**——回执 `receipt-64-at-references.md`。@ 点名读数保证进模型上下文
  （`preamble` 钉开场轮）；「输入框内 Esc 关浮层」的静音位必须用 ref（SelectEventPlugin 同批次）。
- **#63 「值得注意」并进「今天」**——回执 `receipt-63-merge-closerlook.md`。**改 tab 数三处一起**：
  LiteTopbar tabs + v2boots 期望 + auth-form `tabCount===8`。
- **#61 花名册吃标准 markdown 表格** / **T9 #58 / T10 #59 / T11 #60**——回执在
  `.issues/rehearsal-0808/`、`.issues/gap2-0807/`。🔴 `_GUARDED` 精确匹配，带路径参数的路由命不中。

## What's Next（按优先级）

1. **复演（续）**（第 2 轮批已全落，本地）：`preview_start rehearsal-api / rehearsal-web`
   （launch.json 两条在，本地未提交；后端脚本 `.issues/gap2-0807/rehearsal-api.ps1`）。
   库 `rehearsal0808` 保留；脑真 MiniMax，抽取/检索离线。顺手验：
   ① markdown 表格花名册上传（#61）；② 差距对照卡动线 + 默认展开（#63/#65）；
   ③ @ 引用打真脑（#64）；④ 人卡/项目卡/分诊卡/决策卡「去问 Avery」带 chip（#67 真验收）；
   ⑤ 悬浮胶囊/议事室空态打 `@` 弹层完整可见（#66 真验收——顺手把浏览器窗口缩小到笔记本
   高度再试一次）。
2. **统一上产**（gap2 三票 + 两轮演习批五票）。🔴 push 与换后端容器同窗口；**0015 必须落地**；
   上产后先设 `AVERY_PUBLIC_BASE` 再验表单。
3. **T8 两条记录还在桌上**：① 议事室引用编号 `facts.md:<行号>` vs 客户文档名；② 今天页证据行
   机器形状（ADR-0033）。
4. **给 `/health` 加版本字段**。
5. carry-over：r2 未开票发现 · gate-run 迁移 · files-hub #26–#29 · 换血抢救 #31/#32 ·
   v01 退役 #33 · 真机零覆盖（iOS/微信，最高优）· 成本票 #30 · 真 brain 分流取证 · 全量 feat-063。

## Notes（顺手发现，没顺手修）

- **弹层 `--lite2-surface` 背景带透明度**（#66 截图人眼过顺手发现）：运行态弹层盖在长文
  advice 卡上时底字微透。#64 落地时的既有皮肤，非本批引入；要改是皮肤票。
- **空态弹层可用高度受 `.nexus-empty` 卡几何钳制**（卡 overflow:auto）：列表可能只剩 ~2.5 行
  内滚可达；要更大弹层得 portal 出卡，单独开票裁。
- 🔴 **像素基线的 home 屏采样是空态**（#65 实收）：任何只在数据态渲染的部件都不在 36 张射程内。
- 🔴 **`AVERY_PUBLIC_BASE` 必须指后端自己的口**（#63 实收）。
- **粒度闸够不着跨批次**（T10 记档，碑在 `file_append.py`）。
- **`role`/`tenure` 两份资料说法不同时两条路都不记冲突**（既有边界）。
- **`_people_from_roster` 位置兜底会顶掉空格子**（#61 看清的既有怪癖），要不要改单独裁。
- bellIsReal / nudgeVerdict 等手册协议相位仍无机械 runner；bellIsReal 落点已随 #63 改判 home。
- **@ 引用候选检索纯前端内存**；playbook 卡无 id、标题即稳定键——长出 id 时 askRefs/
  `_playbook_entry` 两处一起换。refOfSubject 的 person 分支已接但今天后端恒发 project，未被真数据走过。
- **分诊卡 personIds 依赖后端 ownerId 链接**；对不上时退化为只带 project ref——门的自证判据会先红。

## Blockers / Risks

- 无硬 blocker。
- 🟠 **别单独 push main**（ahead 35+）：前端 push 即自动上产、后端容器要人手换，两件事同窗口做。
- 🔴 **CSS 包含块/裁剪的读码推断必须浏览器实测**（#66 实收）：`filter`/`backdrop-filter` ≠ none
  就给 absolute/fixed 后代建包含块（static 也建）、`overflow` 计算值可能来自看不见的规则
  （`.nexus-empty` 的 auto）——票面按定位规则推的「包含块落谁家」，Chrome 里可以整个不成立。
- 🔴 **在 worktree 里重冻像素＝没重冻**：`__snapshots__/` 是 gitignore 的单机产物。worktree 电池
  里 visual 红的默认形态是**无基线首写**；主检出红了先比 mtime 再谈漂移。**现基线 36 张未动**
  （#64 零漂移、#65 结构性零漂移、#66/#67 后合复验零漂移）。
- 🔴 **像素门不密闭：后端够不着 → `home` 先红**。跑前三件套：dist `VITE_AVERY_API_BASE` 重打 +
  那个口上真有后端（带 `AVERY_DEMO_SEED_DIR`，**值是 `tests/fixtures/demo-seed` 不是
  `tests/fixtures/seed`**）+ `AVERY_CORS_ORIGINS` 放行 preview origin。
- 🔴 **杀 npx 包装进程杀不死 vite 子进程**：孤儿 preview 占 5173 会让下一个 preview 静默落
  5175——`Get-NetTCPConnection` 拿 PID → CommandLine **认领** → 只杀自己的。本批全程照此执行，
  收尾已清干净（8157/5173/5193 均已释放，8137 那个 uvicorn 不是本 session 的、没动）。
- 🔴 **改判清单要把 C 区也扫进去**；「全仓改判」用 `git ls-files "*verify-*.mjs"` 全量扫。
- 🔴 **门驱动 store 还是真部件，决定它能不能看见「接线」型 bug**；落点/初值类判据要**先离开
  目的地再触发**（#66/#67 的门剧本又踩了一次：站在 /room 上开浮层测预填=测不存在的动线）。
- 🟠 **门的环境缺一样就以「像回归」的形态假红**。起门最小清单：`AVERY_BRAIN=mock` +
  `AVERY_EXTRACTOR=heuristic` + `AVERY_EMBEDDINGS=keyword` + `AVERY_DEMO_SEED_DIR` +
  `AVERY_PUBLIC_BASE=<后端口>` + `AVERY_CORS_ORIGINS`；跑门时 `VERIFY_BASE` **和** `VERIFY_API` 都给。
- 🔴 **脚本落盘的「会话/状态」文件默认当凭据看**；先写 .gitignore 再写脚本。
- ⚠ **提示词里的约束不是判据**；**belt-and-braces 会让内层规则免疫变异**——两把锁必须两道独立门
  （#66 的 M2 又验了一次：wrap relative 被 backdrop-filter 内锁罩着，单锁变异在 Chrome 杀不死）。
- 🔴 **本机 Docker PG 容器时钟来回跳 ~115s**：`created_at < now()` 判据间歇假红。
- 🔴 **本机 curl / argv / stdout 都按 GBK 啃中文**：中文只走文件（`git commit -F` /
  `gh --input`）；python 要 `sys.stdout.reconfigure(encoding='utf-8')`。
- 🔴 `e535ec9` commit message 是错的（真相在 `03a9824` erratum）；rebase 与否归 Danny。
- 🔴 repo 级 stash 两条别人的存货；处置归 Danny。
- 多个战役 worktree 仍挂着（25 个上下，含本批 priceless-murdock）——删分支/worktree 属删除闸，归 Danny。
- ⚠ **各票收尾必须重写本文件**（AGENTS.md DoD）。
