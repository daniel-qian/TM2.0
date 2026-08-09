# Session Progress Log

> 📢 本文件是**当前状态快照，整体重写不追加**。历史都在 git（`git log` + 各 `.issues/*/receipt*.md`），别在这儿堆编年史。
> 启动路径见 `AGENTS.md` Startup Workflow：读本文件 + `feature_list.json`，跑 `./init.sh` 确认绿，再开工。

**Last Updated:** 2026-08-09（**0808 UIUX 重构战役 wave 3 落地 = 战役四波全部收口**：#79 文案全量批改
+ 像素全量重冻。仍未 push、未上产）

## Current State

- **git**：`main` = 差距战役八票 + gap2 三票 + 三轮演习批 + #68 + #70 + #69+#71 + #72 +
  **wave 1 整波**（S2 `702287a`/`b3b56ce`/`3aa77e5`/`021bc58`，S1 `fdfb98e`）+
  **wave 2 = #78（`2cfe44c`）** + **wave 3 = #79（`38fac66`，fast-forward，无合流冲突）**。
  回执四份：`receipt-75-room-claude.md`（S1）· `receipt-76-77-74-files.md`（S2）·
  `receipt-78-threads.md`（S3）· **`receipt-79-copy-sweep.md`（S4）**。
  ⚠ 别在这儿写死 ahead 数字——它每提交一次就自己作废。要数就跑：
  `git rev-list --count origin/main..HEAD`。
- **像素基线现状**：**54 张**（原 50 + #79 新增 4 张议事室数据态）。#79 做的是**真比对 → 全量重冻**：
  比对时 0 张「snapshot doesn't exist」、基线字节未被比对跑改写；重冻后复跑 **8 passed · 0 首写**。
  **50/50 全漂**（tab 主名在每一屏顶栏上），漂移清单带「同一份 main 构建连冻两次逐字节一致」的
  确定性对照，不是噪声。
  ✅ **「议事室数据态零像素覆盖」已部分解决**：`visual-data.spec` 的 `SCREENS` 加了 `'room'`，
  拍**有材料 + 零轮次**那一态（无 LLM 方差、无墙钟文案），两条自证防「把无材料态当数据态冻」，
  born-red 按视口逐个验过（改 h2 或改 chips 标题 → 恰好红这 4 张、其余 50 张一张不红）。
  🔴 **带轮次的那一态仍无覆盖**，且**刻意不补**：历史面板会印「8月9日 19:52」这种墙钟文案，
  而判读卡的 confidence/script/metrics/escalation 四段在 mock 语料下根本不渲染——冻它等于
  把一张**残缺的卡**当满态基线。要补先解决这两件事（详见 receipt-79 §4.4）。
- **✅ 生产仍停在 08-07 白天那一版**（`main-20260807-190332` = main `99d83f7`）。
  gap2 三票 + 三轮演习批 + #68 + #70 + #69/#71 + #72 + **重构战役四波全部**都没有上产。
- 🔴 **迁移账（上产时按这个来）**：
  - **T9 需要 `0015_form_submissions_auto_key.sql`**（increment-only、`_ensure_schema()` 自动重放）。
  - **#78 需要 `0016_advise_runs_thread.sql`**（`ADD COLUMN IF NOT EXISTS thread_id` +
    `(context_id, thread_id, seq)` 索引；**无回填 UPDATE**）。已在本地 throwaway 库真跑过。
  - **#79 / #77 / #76 / #74 / #75 / #73 都不需要迁移**（#79 是纯前端 + 门改动）。
  - 判据一句话：**动 dataclass 里被整块 jsonb 装着的字段 → 免迁移；动表的顶层列 → 必须迁移。**
- 🔴 **合的都是本地 main，没有 push**。前端 push main 即自动构建上产，push + 换后端容器
  必须在统一上产 session 的**同一个窗口**里做。

## 本轮做完的（2026-08-09 · wave 3 · #79 copy-sweep）

回执 `.issues/redesign-0808/receipt-79-copy-sweep.md`（含全部行号复核、变异台账、像素三段账、
人眼过证据 `_px79/`）。

- **zh.ts 137 键改值 + 2 新键**（必改 34 + 建议改 84 + 见仁见智 6 条 + 零星词族统一）；
  **en.ts 28 改 + 2 新**。`lite.*`（v01 冻结壳）与 `decisionRules` 块**一个字节没动**。
  **全程手工 Edit，一个 `scripts/i18n-zh*.mjs` 都没跑**；只读的 `i18n-orphans` 跑了：孤儿 0。
- **见仁见智 8 条照 Danny 0809 勾选施工（改 6 留 2）**：tabRoom→「对话」/EN `Chat` ·
  皮肤名→浅色/深色 · 笔记标题（连 eyebrow）· 速读版→摘要 ·「长出来」隐喻族 6 处 · 骨架屏缩短。
  「快问」词族与页脚合规长句**保留不动**。
- 🔴 **tabRoom 改名立了一条碑**：**名字引用跟着改，动词短语不改**。
  改的是「在叫这个屏的名字」的那几条（followupsSourceRoom / homeTodayEmpty /
  followupsEmptyActive / roomBoardAria / formsBuilderGoesToLibrary）；
  「去问 Avery」是**动作**不是屏名，悬浮胶囊 `askAveryLabel` 仍叫「问 Avery」——
  同 Claude 的「产品叫 Claude、导航项叫 Chats、按钮照写 Ask Claude」。
- **4 个真 bug**（票面 3 个 + 本票新查出 1 个）：
  ① `formsBuilderGoesToLibrary` 泄漏 v01 tab 名「议事室」；
  ② `gapFollowupTitle`「多看一眼」旧词族（会永久落 localStorage）；
  ③ RoomScreen 空态 eyebrow —— **已被 #75 消灭**（删元素不是改字），本票核实后没重复施工，
     只补了同族漏网的 aria 那半（`roomEmptyAria`）；
  ④ 🔴 **`gapAskLabel`「直接问本人」是句谎**：`handleGapAsk` 走 `goScreen('room')`，
     一个字都不会发给那个人。→「去问 Avery」。
- **两处 recon 归类/转述错误，本票实收并订正**：
  - `verify-switchers.mjs:74/86` **有两条硬判据直接比对皮肤按钮文本**，recon §4 写的「门不红」是错的。
  - `team.emptyTitle`「你的团队会在这里长出来」被记成「v01/共享段不动」，
    **它其实一直渲染在 v02 团队屏 h1 上**（人眼过在重冻的 team 基线里逮到）。
- **组件层三处**（都为「不动冻结壳」而分叉，先例 `teamEmptyLead ← team.emptyBody`）：
  新键 `lite2.roomAskPlaceholder` ← `nexus.askPlaceholder`；
  新键 `lite2.teamEmptyHeadline` ← `team.emptyTitle`；六处陈旧注释与文案对齐。
- **门连改 6 组，逐条独立变异**：room-claude-rework 的负向针跟着 `liveReady` 改值（M1 42/4，
  原病根逐字复现）· switchers 两条硬判据（M2/M3 各 26/1）· restart-09 的「找按钮」正则
  （M5 红在 `look=null`，正是「静默跳过点击→下游假红」那种最难诊断的形态）·
  snippet 的 v2Boots 期望数组 + 6 处 `_clickTab`（M4 2/1）。
  另跑三条「证明既有钉子在改写后的新串上仍咬得住」：M7（G9 片段）42/1 · M8（骨架屏零数字）16/1 ·
  M9b（aria 拉丁门）3/1。
- **先做了一个「死针探测器」**再动手：抽出所有门文件里的字面量，逐条问「它在 HEAD 的字典值里
  出现过、改完之后在任何字典值里都不出现了吗」——正向词表版的「改了门不红、门会瞎」。
  查出 **4 根死针**，与手工分析完全吻合、没有第五根。

### 验证账

`npm run typecheck` 绿 · `i18n-orphans` 孤儿 0 · css 双检绿 · 离线 pytest **4045 passed**
（`TZ=UTC`，与 #78 基线严丝合缝，本票零后端行为改动）· A 区 **34/34**（首跑/行尾归一后/收尾后
共三次复跑都是 34/34）· B 区 data-boundary 绿 · null-owner **15/0 真跑到了** ·
C 区 **3/3**（跑完重打 dist 并在浏览器里验过 apiBase）· 不在册的 `verify-restart-09` **15/15** ·
像素 **8 passed · 0 首写 · 54 张**。

## 上几轮做完的（详情全在各自回执，这里只留会影响下一个人的）

- **wave 2 · S3 = #78 真线程**——`receipt-78-threads.md`。迁移 0016（`advise_runs.thread_id`，
  不回填）· thread_id **由服务端铸、经 SSE 两帧回传**（不是前端发 uuid：那样「老后端忽略这个键」
  没有任何信号）· 新端点 `GET /team/{id}/advise-threads`（**limit 的单位是「场」不是「行」**）·
  历史面板按场分组 + 点一场恢复整场 · 回灌轮诚实降级 · 新门 `verify-room-threads` 40 判据。
- **wave 1 · S1 = #75 议事室 Claude 化 + #73 现场附件**——`receipt-75-room-claude.md`。
  docked composer 三态统一 · 停止生成落成第五状态 `interrupted` · 多行输入 + IME 让位 ·
  markdown 自渲染最小子集 · 胶囊即发 · 附件选文件时就预检上限。
- **wave 1 · S2 = #74 + #77 + #76**——`receipt-76-77-74-files.md`。
  `file_cards()` 补发 `source_key` · 删除文件走独立模块 `file_delete.py` · 资料库按频率重排 + 锚点导航。
- **#72 建议追问 chips + 快问收敛** · **#69+#71 会话流+灰提示**（文案长度闸开显示宽度不开字符数）·
  **#70 @ 文件引用两修** · **#68 数据态像素基线** · **#66+#67** · **#65 / #64 / #63 / #61 / T9–T11**。

## What's Next（按优先级）

1. **0808 UIUX 重构战役四波全部收口**（#73/#74/#75/#76/#77/#78/#79 全落本地 main）。
   档案 `.issues/redesign-0808/`：四路侦察正源 + 两份开工裁定 + **四份回执**。
   ⚠ 给下一个人的口径：recon-copy 是好正源，但它**有两处已证的错**（见本轮「recon 归类/转述错误」）——
   任何票面/侦察里的「这道门不会红」，都要自己打开那道门读到判据为止。
2. **复演第 5 轮已收官（五块全过）**；Danny 随即发起 0809 反馈批（对话页侧栏化 + composer
   现代化 + 新建对话），grill 四拍板：**常显侧栏 / v1=列表+新对话+点击载入（改名删除后排）/
   上 @phosphor-icons/react / 图标统一只限对话页**。两路侦察落档
   （`recon-sidebar.md` / `recon-composer.md`），#80+#81 已开票、**捆一张卡片已发**。
   落地后复演第 6 轮（重点：侧栏动线 + 新输入框手感）。
3. **统一上产**（gap2 三票 + 三轮演习批 + #68 + 重构战役四波全部）。🔴 push 与换后端容器同窗口；
   **0015 + 0016 必须落地**；上产后先设 `AVERY_PUBLIC_BASE` 再验表单。
4. **T8 两条记录**：① 议事室引用编号形状；② 今天页证据行机器形状（ADR-0033）。
5. **给 `/health` 加版本字段**。
6. carry-over：**Claude 式会话侧栏（0808 拍板不做；#78 真线程落地后已是自然延伸）** ·
   判读卡 4 段死渲染 + 后端已发前端未消费 7 类字段 · r2 未开票发现 · gate-run 迁移 ·
   files-hub #26–#29 · 换血抢救 #31/#32 · v01 退役 #33 · 真机零覆盖（iOS/微信，最高优）·
   成本票 #30 · 真 brain 分流取证 · 全量 feat-063。

## Notes（顺手发现，没顺手修）

- 🔴 **aria 硬门对短拉丁黑话是瞎的**：`verify-aria-zh` 的 `suspiciousLatin` 要求
  「≥2 个连续拉丁词 **或** 单词长度 ≥4」，`HR`（2 字母）、`1:1`（无字母）**永远不报**。
  #79 把它们从 aria 里改掉是执行 zh-purity 的产品口径，**不是门逼的**；加回来一样零门会红（M9 实证）。
- **`gapCardClaimLabel`「文件里的说法」与已改的「资料里的实际情况」在同一张差距卡上不对仗**
  （文件 vs 资料）；**`projectsTitle`「你文件里的项目」**与同屏已改的 lede 词族不齐。都是 §5 表没列的。
- **mock 语料下判读卡的信号行是英文**（`Grounded in the record: …`）——mock brain 产物不是字典漏网。
- **mock 语料不产判读卡的 confidence / script / metrics / escalation 四段**：
  要给它们取证得往 `run.advice` 注一份满态（`escalation.level` 要写 `'HRBP'` 大写，
  且必须给 `note` / `confirmWith`，否则组件在 `.length` 上抛错、整张卡消失）。
- **短答路 followups 落库仍被丢**（`app.py` 的 `_persist_advise_run` 只取 `answer.text`）。#78 票内裁不补存。
- **`fetchAdviseRuns` / `refreshAdviseRuns` 前端已无消费者**；没删（后端平铺读面仍是公开契约）。
- **`--lite2-bottom-band` 是幽灵 token**；**`--lite2-clear-top` 的 ≤860 覆盖写了两遍**，早段已被后段架空。
- **`.issues/gap-design-0805/t8-e2e.mjs:514` 是 `room.status !== 'error'` 反向判断**，
  `interrupted` 与 hydrated 轮都会被它当成通过。一次性门，未改。
- **`data-room-composer` 从未落地**（三处**注释**声称门已改判到它，DOM 上没有）。写新门别照注释抄选择器。
- **at-references ⑧ 的宿主矩阵缩水**（三态统一后空态与运行态 composer 几何一样）。
- **`nexus-brief-hud` 与四相面板仍在说同一件事**；#75 只修了眉标撒谎那半。
- **switchContext 换公司时 `turns`/`run` 不清**——只有 `resetLiteCompanyData` 清（三抄本只有第三份全）。
- **中文名互为前缀仍双中**（「王力」vs「王力宏」）：词边界对 CJK 刻意不阻断，宁多勿漏。
- **`tests/test_at_references.py:90` 潜伏 typo**（`rep.errors` 应为 `parse_errors`）。
- **`>` 开头的材料块结构性不可引用**；**facts.md 指针不是单射**。
- 🔴 **`AVERY_PUBLIC_BASE` 必须指后端自己的口**（#63 实收）。
- **粒度闸够不着跨批次**（T10）；**`_people_from_roster` 位置兜底会顶掉空格子**（#61）。
- **`KeywordStore` 分词器是 `[a-z0-9]+`（纯 ASCII），对无空格中文 `query()` 恒空**——
  任何拿中文串断言「检索得到/不到」的判据都是空跑。
- bellIsReal / nudgeVerdict 等手册协议相位仍无机械 runner。

## Blockers / Risks

- 无硬 blocker。
- 🟠 **别单独 push main**（实数跑 `git rev-list --count origin/main..HEAD`）：
  前端 push 即自动上产、后端容器要人手换，同窗口做。
- 🔴 **像素基线目录是 gitignored**（`.gitignore:34`），**每棵树各一份**：worktree 里那份是空的，
  在 worktree 跑 visual = **首写**，证明不了任何事（#79 又实证一轮：50 张全是
  「snapshot doesn't exist, writing actual」）。真比对做法：**在主检出 `D:\avery` 跑 playwright
  （用它的真基线），`VERIFY_BASE` 指向 worktree 的 preview**——两份 spec 都读这个变量。
  ⚠ **但 spec 文件本身用的是主检出那一份**：改了 spec（比如给 `SCREENS` 加屏）必须先把改动合进
  本地 main，主检出才看得见（#79 实收：spec 改完直接重冻，新基线一张没生成、还 8 passed 骗了一次）。
- 🔴 **`md5sum … | sed 's|.*/||'` 是贪婪的，会把哈希一起吃掉**——于是「重冻前后 md5 全表 diff」
  变成只比文件名的**空判**（#79 实收）。任何「比对前后 md5」的做法，先看一眼表里有没有哈希。
- 🔴 **一个 test 串着跑 N 次 `toHaveScreenshot`，第一处不匹配就中止整条**——
  一次红跑给出的漂移清单是**残缺的**。要全量清单只能重冻前后比 md5，并给重建做一次
  「同一份构建连冻两次是否逐字节一致」的确定性对照，否则分不清真漂移和噪声。
- 🔴 **多行插入时忘了把新文本也转成 CRLF，会造出混行尾文件**（#79 实收 4 个门文件、13 处裸 LF）。
  `git status` 的 "LF will be replaced by CRLF" 警告是唯一信号。
- 🔴 **变异活下来 ≠ 门有洞，也 ≠ 代码有 bug —— 先看变异有没有真的碰到被判的性质**
  （#79 的 M9：拿 `HR` 去试 aria 门，而那把尺子根本照不到 2 字母词）。
- 🔴 **门崩掉比门变红难诊断得多**；**改判扫描的暗区**：`scripts/gates/live-frontend-gate.snippet.js`
  不在 `*verify-*.mjs` glob 里（#79 又在它里面改了 7 处）。
- 🔴 **门全绿 ≠ 真部件被验到**：#79 在 A 区 34/34 之后，人眼过仍逮到 v02 团队屏 h1 上一句
  「会在这里长出来」——它是**共享键**，全票的 grep 口径都按「v01 段不动」把它放过了。
- 🔴 **改完后端必须按端口杀掉重起 uvicorn**（不热重载）。
- 🔴 **`./init.sh` 和 run-battery 的收尾重建都 `vite build` 不带 api base** → dist 落回生产域名。
  跑任何上传型门/截图之前先重打带 `VITE_AVERY_API_BASE` 的 dist**并在浏览器里验 apiBase**。
- 🔴 **cwd 残留会把命令打到别的树**；worktree 会话里 git 与构建命令一律显式指定路径。
- 🔴 **杀 npx 包装进程杀不死 vite 子进程**；stale 进程按端口杀。
- 🔴 **本机 Docker PG 容器时钟来回跳 ~115s**：`created_at < now()` 判据间歇假红。
- 🔴 **本机 curl / argv / stdout 都按 GBK 啃中文**：中文只走文件（`git commit -F` / `gh api --input`）。
  ⚠ 同族：Python 脚本里 `print()` 中文会直接 `UnicodeEncodeError` 炸掉——**结果写文件、stdout 只打 ASCII**
  （#79 的变异跑器第一版就是这么炸的，而变异其实已经跑完了）。
- 🔴 **离线套对 pg 持久层是瞎的**：动 schema 必跑 `@needs_db`（本地 throwaway 库）。
- 🔴 **CSS 包含块/裁剪读码推断必须浏览器实测**（#66）。
- 🔴 `e535ec9` commit message 是错的（真相在 `03a9824` erratum）；rebase 与否归 Danny。
- 🔴 repo 级 stash 两条别人的存货；处置归 Danny。
- 多个战役 worktree 仍挂着（30 个上下）——删分支/worktree 属删除闸，归 Danny。
- ⚠ **各票收尾必须重写本文件**（AGENTS.md DoD）。
