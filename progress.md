# Session Progress Log

> 📢 本文件是**当前状态快照，整体重写不追加**。历史都在 git（`git log` + 各 `.issues/*/receipt*.md`），别在这儿堆编年史。
> 启动路径见 `AGENTS.md` Startup Workflow：读本文件 + `feature_list.json`，跑 `./init.sh` 确认绿，再开工。

**Last Updated:** 2026-08-08（**演习第 3 轮 wave 2（#72）落 main 并关票**：建议追问 chips +
快问触发收敛 + 撤卡重裁；wave 1（#70、#69+#71）此前已落。仍未 push、未上产）

## Current State

- **git**：`main`（`0fb483b` + 随后的记账 docs commit）= 差距战役八票 + gap2 三票 + 三轮演习批
  + #68 + #70 + #69+#71 + **#72**（`.issues/rehearsal-0808/receipt-72-followup-suggestions.md`）。
  `main...origin/main` **ahead 50+**（以 `git status -sb` 为准），**没有 push**（见 Blockers）。
  本 wave 无并行线，worktree 分支 ff 直进 main。
- **像素基线现状**：两套共 52 张（36 张空态 visual.spec + 16 张数据态 visual-data.spec，
  数据态钉死 setFixedTime）。全部主检出冻、gitignore 单机产物。
  **#72 合流后在主检出对着真基线复跑：8/8 全绿、52 张 mtime 哈希前后逐字节一致**
  （真比对零漂移——chips 是运行态部件，静息态零漂移预判成立）。
- **✅ 生产仍停在 08-07 白天那一版**（`main-20260807-190332` = main `99d83f7`）。
  gap2 三票 + 三轮演习批 + #68 + #70 + #69/#71 + #72 **都没有上产**——统一上产另行安排
  （What's Next 第 1 条）。迁移 0012/0013/0014 已在生产库落地。
- 🔴 **迁移账（上产时按这个来）**：
  - **T9 需要 `0015_form_submissions_auto_key.sql`**（increment-only、`_ensure_schema()` 自动重放）。
  - **其余各票（含 #72）都不需要**——followup_questions 是 manifest/契约投影可选键，落库走
    整块 advice jsonb（读侧 coerce 自然丢弃未知键）。
  - 判据一句话：**动 dataclass 里被整块 jsonb 装着的字段 → 免迁移；动表的顶层列 → 必须迁移。**
- 🔴 **合的都是本地 main，没有 push**。「落 main 即止」＝**不 push**：前端 push main 即自动
  构建上产，push + 换后端容器必须在统一上产 session 的**同一个窗口里**做。

## 本轮做完的（2026-08-08 · #72 建议追问 chips + 快问触发收敛）

回执：`.issues/rehearsal-0808/receipt-72-followup-suggestions.md`（含 7 条变异台账、
主检出像素真比对账、刻意没做的边界）。

- **建议追问**：`draft_advice`/`answer_direct` 出口加可选 `followup_questions`（≤3）；
  contract 投影**逐条**过问题门后透传（违规丢弃不整答失败——「少一个 chip」永远不该升级成
  「整张判读卡不发」）；mock 罐头固定 2 条（双语、自报 mock 身份、逐条过红线）。前端
  `LiveRunState.followups` → 回答卡下 `.lite-room-followups` chips（**只挂尾轮** + 只在
  complete + 必须有回答卡在场），**点击即发**（situation=chip 原文，history 由 store 组装
  ——#71 的一处补全纪律，chips 是第三个入口零新代码）。
- **快问收敛，两半**：①触发判据裸子串 → **文种感知词边界**（拉丁邻接阻断、CJK 邻接不阻断
  ——裸 `\b` 会把中文触发整个杀死）；②**answer_kind 语义闸**：短答终局不弹卡（侦察发现
  短答 manifest 的 kind 也是 None，此前**短答后照样弹卡**——「一直弹」的另一半病根）。
- **撤卡重裁（Notes 那条，已裁定落地）**：没动过的 draft 照撤（过期提案不粘屏）；manager
  **动过**的草稿（新 `askDirty`）与**已发出**的卡（shared/collecting/closed）不撤也不被新
  帧顶掉。连带闭洞：`clearTurns` 清 ask 四件（卡随对话散场）+ `adoptContext`/
  `resetLiteCompanyData` 公司域清单补 ask 四件（注释一直点名 ask、实际一直漏）。
- **askLive 加 store 级 busy 闸**：同一拍双击（chips/发送键）只开一轮（createFormLinks 同款
  ——UI disabled 挡不住同一拍的第二下）。
- **门**：`verify-room-conversation` **21 → 42 判据**全绿；pytest **4010/0**（+14 严丝合缝）；
  A 31/31、B data-boundary + null-owner 绿、C 3/3。**本 wave 无并行线，全电池在标准端口
  5173/8137 跑——null-owner 这次真跑了**（wave1 它因写死 5173 记「没跑」）。

## 上几轮做完的（详情全在各自回执，这里只留会影响下一个人的）

- **#69+#71 会话流+灰提示**——回执 `receipt-69-71-conversation-flow.md`。`turns: LiveTurn[]`
  （`run` 只是尾轮镜像）；后端 `history` additive optional、`service/history.py` 唯一配额闸；
  离开议事室/刷新=对话结束（刻意不持久化）；文案长度闸开显示宽度不开字符数（碑）。
- **#70 @ 文件引用两修**——回执 `receipt-70-file-ref-quality.md`。候选轮转发牌 +
  `_file_doc_lines` 注入真原文；核实中撞出 **#74**。
- **#68 数据态像素基线**——born-red 按视口逐个验；数据态基线必须钉页面时钟。
- **#66+#67** @ 弹层空间感知 + askRefs 唯一构造器。🔴 CSS 包含块/裁剪必须浏览器实测。
- **#65 差距块默认展开** · **#64 议事室 @ 引用回归**（`preamble` 钉开场轮）。
- **#63 并屏退 tab**——改 tab 数三处一起。 · **#61 markdown 表格花名册** / **T9–T11**。

## What's Next（按优先级）

1. **0808 UIUX 重构战役**（复演第 4 轮已收官四点全过后 Danny 发起；档案
   `.issues/redesign-0808/tickets.md`——四拍板 + 四路侦察正源 recon-{room,files,history,copy}.md
   都在，「别重新侦察」密度）：
   - **wave 1（卡片已发，两 session 并行）**：S1=#75 议事室 Claude 化+#73 附件上传；
     S2=#76 资料库 IA 重排+#77 删除文件+#74 file-ref-id。
   - **wave 2**：#78 真线程（**依赖 #75 落 main**；带**迁移 0016**——上产迁移账加这条）。
   - **wave 3**：#79 文案全量批改（**等 #75-#78 全落**，像素全量重冻只来一次）；
     见仁见智 8 条在档案末尾待 Danny 勾。
2. **复演（第 5 轮）**：战役各波落地后全内容演习；顺带补验第 4 轮遗留两点——真 brain 往
   followup_questions 里填什么（离线只证管道）、快问收敛的真实手感。兜底：当前 main
   四轮演习全绿，临会随时可起演习环境应会，不带病上会。
3. **统一上产**（gap2 三票 + 三轮演习批 + #68 + 重构战役全部）。🔴 push 与换后端容器同窗口；
   **0015 + 0016（#78 落地后）必须落地**；上产后先设 `AVERY_PUBLIC_BASE` 再验表单。
4. **T8 两条记录**：① 议事室引用编号形状；② 今天页证据行机器形状（ADR-0033）。
5. **给 `/health` 加版本字段**。
6. carry-over：**Claude 式会话侧栏（0808 拍板本轮不做，真线程落地后是自然延伸）** ·
   **议事室流卡死 composer 锁死无前端超时（#71 已知边界，#75 停止按钮落地后重估）** ·
   判读卡 4 段死渲染 + 后端已发前端未消费 7 类字段 · r2 未开票发现 · gate-run 迁移 ·
   files-hub #26–#29 · 换血抢救 #31/#32 · v01 退役 #33 · 真机零覆盖（iOS/微信，最高优）·
   成本票 #30 · 真 brain 分流取证 · 全量 feat-063。

## Notes（顺手发现，没顺手修）

- **switchContext 换公司时 `turns`/`run` 不清**（adoptContext 的清单没有它们，
  resetLiteCompanyData 有）——若能在议事室现场切公司，A 公司的问答会挂在 B 公司名下。
  #72 已把 **ask 四件**补进两份清单（保护式撤卡放大了那半风险），turns 那半没动——
  涉及在飞流 `_abort` 归属，独立裁。
- **中文名互为前缀仍双中**（「王力」vs「王力宏」）：词边界对 CJK 刻意不阻断（否则杀掉全部
  中文触发），宁多勿漏；要更准得上分词或花名册仲裁，单独开票。
- **真 brain 的 followup 质量离线采不到样**：schema 有槽 + description 提示，真 brain
  填不填/填什么要复演验（What's Next 第 2 条④）。
- **历史轮没有折叠**（#71 票面项）：出处只挂分析过程面板，折掉它=折掉溯源。
- **决策卡 `reason` 在 mock 语料下是空的**——既有现象。
- **`tests/test_at_references.py:90` 潜伏 typo**：`rep.errors` 应为 `parse_errors`，
  只在断言真失败时才炸。
- **`>` 开头的材料块结构性不可引用**；**facts.md 指针不是单射**（别拿指针反推文档归属）。
- **数据态像素只覆盖 home/team/projects**（#68 方案 B）；**议事室两套基线都只有空态**——
  会话流/chips 是运行态，靠 DOM 判据 + 交互态截图人眼过。
- **弹层 `--lite2-surface` 背景带透明度**（#66）；**空态弹层高度受 `.nexus-empty` 钳制**。
- 🔴 **`AVERY_PUBLIC_BASE` 必须指后端自己的口**（#63 实收）。
- **粒度闸够不着跨批次**（T10）；**`role`/`tenure` 冲突两条路都不记**；
  **`_people_from_roster` 位置兜底会顶掉空格子**（#61）。
- bellIsReal / nudgeVerdict 等手册协议相位仍无机械 runner。
- **@ 引用候选检索纯前端内存**；playbook 卡无 id、标题即稳定键。
- **分诊卡 personIds 依赖后端 ownerId 链接**；对不上时退化为只带 project ref。

## Blockers / Risks

- 无硬 blocker。
- 🟠 **别单独 push main**（ahead 50+）：前端 push 即自动上产、后端容器要人手换，同窗口做。
- 🔴 **文案长度闸开在字符数上 = 英文当场出血**（#69 碑）：一律用**显示宽度**（CJK 记 2）。
- 🔴 **同一条判据要配同一个变异**（#71 实收）+ **变异要逐个单独跑**（#72 照做：7 条变异
  7 次独立运行，M-D/M-F 外科手术式 41/1）。别让一条变异替另一条判据背书。
- 🔴 **belt-and-braces 让内层规则免疫变异**（#69 碑）：判据落在被测属性本身。
  #72 的对应形态：**busy 闸判据不落 UI disabled 而落 store 临界区**（同一拍双 askLive
  只开一轮）——真双击驱动不到临界窗口，反而是采不到样的假判据。
- 🔴 **公平配额 ≠ 看得见**（#70 碑）；🔴 **门语料不能复现病根 = 判据空跑**（#70 碑，
  #72 照做：违规 followup 语料先自证真的过不了红线）。
- 🔴 **像素基线两套 52 张全是 gitignore 单机产物**：**worktree 里冻＝白冻**（#72 又实证一轮：
  电池内红=无基线首写，首写后复跑绿只证稳定）。零漂移只能在**主检出**对着真基线证
  （比对完查 mtime：没动才是真比对）。数据态那套依赖后端带
  `AVERY_DEMO_SEED_DIR=tests/fixtures/demo-seed`（不是 `seed`）。
- 🔴 **born-red 按视口逐个验**（#68）；🔴 **数据态基线时钟已钉死 setFixedTime**。
- 🔴 **CSS 包含块/裁剪读码推断必须浏览器实测**（#66）。
- 🔴 **像素门不密闭：后端够不着 → `home` 先红**。三件套照旧。
- ⚠ **B 区 `verify-null-owner` 把 5173 写死在 `:28`（不吃 VERIFY_BASE）**：#72 这轮因无
  并行线在标准端口全电池跑过（绿），但写死的事实仍在——有并行线时它在隔离端口上仍只能记
  「没跑」。
- 🔴 **`./init.sh` 和 run-battery 的收尾重建都 `vite build` 不带 api base** → dist 落回
  生产域名。跑任何上传型门/截图之前先重打带 `VITE_AVERY_API_BASE` 的 dist
  （#72 实证：电池收尾后截图前重打了一次）。
- 🔴 **杀 npx 包装进程杀不死 vite 子进程**；stale 进程按端口杀、CommandLine 认领后只杀自己的。
- 🔴 **cwd 残留会把 git 操作打到别的树**：worktree 会话里 git 一律 `-C <树>` 显式指定。
- 🔴 **改判清单要把 C 区也扫进去**；「全仓改判」用 `git ls-files "*verify-*.mjs"` 全量扫；
  ⚠ `scripts/gates/live-frontend-gate.snippet.js` 不在那个 glob 里。
- 🔴 **门驱动 store 还是真部件**决定能否看见「接线」bug；**别让驱动助手顺手修复被测行为**。
  #72 的裁量先例：**被测属性本身就是 store 逻辑**（busy 闸/撤卡保护）时，允许驱动 store，
  但接线（chip 点击→askLive）必须另有真点击判据钉着。
- 🟠 **门的环境缺一样就假红**。最小清单：`AVERY_BRAIN=mock` + `AVERY_EXTRACTOR=heuristic` +
  `AVERY_EMBEDDINGS=keyword` + `AVERY_DEMO_SEED_DIR` + `AVERY_PUBLIC_BASE=<后端口>` +
  `AVERY_CORS_ORIGINS`；跑门给 `VERIFY_BASE` **和** `VERIFY_API`。
- 🔴 **脚本落盘的「会话/状态」文件默认当凭据**；先写 .gitignore 再写脚本。
- ⚠ **提示词约束不是判据**（#72 对应：followup 的红线不靠 schema description，
  靠投影层逐条过滤 + pytest 钉）。
- 🔴 **本机 Docker PG 容器时钟来回跳 ~115s**：`created_at < now()` 判据间歇假红。
- 🔴 **本机 curl / argv / stdout 都按 GBK 啃中文**：中文只走文件（`git commit -F` /
  `gh api --input`）。
- 🔴 `e535ec9` commit message 是错的（真相在 `03a9824` erratum）；rebase 与否归 Danny。
- 🔴 repo 级 stash 两条别人的存货；处置归 Danny。
- 多个战役 worktree 仍挂着（29 个上下）——删分支/worktree 属删除闸，归 Danny。
- ⚠ **各票收尾必须重写本文件**（AGENTS.md DoD）。
