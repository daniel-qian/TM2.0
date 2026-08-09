# Session Progress Log

> 📢 本文件是**当前状态快照，整体重写不追加**。历史都在 git（`git log` + 各 `.issues/*/receipt*.md`），别在这儿堆编年史。
> 启动路径见 `AGENTS.md` Startup Workflow：读本文件 + `feature_list.json`，跑 `./init.sh` 确认绿，再开工。

**Last Updated:** 2026-08-09（**0808 UIUX 重构战役 wave 2 落地**：#78 真线程 —— 带**迁移 0016**。
仍未 push、未上产）

## Current State

- **git**：`main` = 差距战役八票 + gap2 三票 + 三轮演习批 + #68 + #70 + #69+#71 + #72 + **wave 1 整波**
  （S2 `702287a`/`b3b56ce`/`3aa77e5`/`021bc58`，S1 `fdfb98e`）。
  **wave 2 = #78（`2cfe44c`）已 fast-forward 合入 main**（本波单线，无合流冲突）。
  回执三份：`.issues/redesign-0808/receipt-76-77-74-files.md`（S2）·
  `receipt-75-room-claude.md`（S1）· **`receipt-78-threads.md`（S3）**；
  开工裁定 `design-78-threads.md`。
  `main...origin/main` **ahead 60+**，**没有 push**（见 Blockers）。
  ⚠ 别在这儿写死数字——它每提交一次就自己作废。要数就跑：`git rev-list --count origin/main..HEAD`。
- **像素基线现状**：两套共 52 张（room 4 + files 4 + 其余）。**#78 对着主检出真基线比对：8/8 绿、
  50 张 md5 逐字节一致**（比对前后各存一次全表 md5 做 diff ＝ 真比对不是首写）。
  🔴 **但那个「零漂移」是判据够不着**：`visual.spec.mjs` 的 room 四张采的是 `contextId===null`
  的无材料态（历史面板在那里直接 `return null`），`visual-data.spec.mjs` 的 `SCREENS` 压根不含
  room。**议事室历史面在像素里零覆盖**——#79 全量重冻时值得补一张数据态 room 基线。
- **✅ 生产仍停在 08-07 白天那一版**（`main-20260807-190332` = main `99d83f7`）。
  gap2 三票 + 三轮演习批 + #68 + #70 + #69/#71 + #72 + wave 1 + **wave 2** 都没有上产。
- 🔴 **迁移账（上产时按这个来）**：
  - **T9 需要 `0015_form_submissions_auto_key.sql`**（increment-only、`_ensure_schema()` 自动重放）。
  - **#78 需要 `0016_advise_runs_thread.sql`**（`ADD COLUMN IF NOT EXISTS thread_id` + `(context_id,
    thread_id, seq)` 索引；**无回填 UPDATE**）。已在本地 throwaway 库 `redesign0808` 真跑过
    needs_db 115 passed，`\d avery.advise_runs` 见到列与索引、且列**追加在末尾**。
  - **#77 / #76 / #74 / #75 / #73 都不需要迁移**。
  - 判据一句话：**动 dataclass 里被整块 jsonb 装着的字段 → 免迁移；动表的顶层列 → 必须迁移。**
    #78 就是后者的正面案例。
- 🔴 **合的都是本地 main，没有 push**。前端 push main 即自动构建上产，push + 换后端容器
  必须在统一上产 session 的**同一个窗口**里做。

## 本轮做完的（2026-08-09 · wave 2 · #78 advise-threads 真线程）

回执 `.issues/redesign-0808/receipt-78-threads.md`（含全部行号复核、变异台账、两个门洞的复盘）。

- **迁移 0016**：`advise_runs` 加 `thread_id text`（可空）+ `(context_id, thread_id, seq)` 索引。
  **不回填**——每次 bootstrap 全量重放，回填＝每次开机全表扫；且给存量行编一个场就是编事实。
  `NULL`/空串 ⟺ **无场归属**，读侧一律按「自成一场的单轮」呈现。
- **thread_id 由服务端铸、经 SSE 回传**（贴在 `started` + `manifest` 两帧，additive 顶层键）。
  **不是**前端自己发 uuid：`references` 有「织进 situation」的文字兜底，thread_id **没有**——
  老后端忽略这个键时前端会一边显示在续场、一边每问开一场新的，**没有任何信号**。
  服务端回传就是那条对账通道（没回传 → `store.threadId` 停在 null → 界面老实地每问自成一场）。
- **新端点** `GET /team/{id}/advise-threads`（平铺那条一个字节不动，它的四条契约测试留作回归网）。
  🔴 **limit 的单位是「场」不是「行」**：沿用行数上限会把最老那场腰斩成半截对话，
  而调用方分辨不出「这场只有 3 轮」和「这场有 7 轮只给了 3 轮」。
- **前端**：`LiteRoomHistory` 从「只读回看抽屉」重写成「按场列表 + 点一场打开」；
  `hydrateThread`（替换 + busy 闸 + 幂等闸 + 尾轮镜像同步）；`askLive` 条件展开带 thread_id；
  公司域清理**三抄本**各加 `adviseThreads` / `threadId`。
- **回灌轮诚实降级**：不渲染四相面板（emptyRunState 四相全 pending 会渲染成 4×「待命」，
  对一条早就答完的记录是纯假话）· 不挂实时状态条 · 无引用 chips（refs 结构性没落库）·
  一行「这轮是从历史载入的，当时的分析过程没有留存」· `data-turn-hydrated` 抓手。
- **三个政策拍板**（票内定并记档）：hydrate **替换**不追加 · 尾轮 running 时**禁点**（两把锁
  配两条判据）· 同场重复点**幂等**（防的是「把刚问的那轮抹掉」，不是防抖）。
- **短答路 followups 不补存**（票内裁）：`answer` 列是纯 text，要存就得再加一列或把它改成
  jsonb（后者打破 advice/answer 互斥这条既有契约）。缺失是可辨的，且 #78 给的正是「直接接着问」。
  **advice 路的 followups 可以恢复**（在 jsonb 里）——历史场尾轮 advice 路会出 chips、短答路不会。
- **门**：新门 `verify-room-threads` **40 判据**入册 A 区（A 区 33 → **34**）。**既有门零改判**
  （`.lite-room-history*` / `adviseRuns` 在既有门里 grep 零命中）。8 条变异逐条独立跑。
  20 张双视口双皮截图人眼过。
- **顺手修（都在本票血缘内，各配一道门）**：
  - `ContextRegistry.clear()` 自 #49 起**漏清 `_advise_runs`**（既有测试每次用新 cid 才没被咬到）。
  - `test_registry_protocol.py` 的暗区：它只比两个 adapter 互相，**够不着 Protocol 自己**——
    只改 Protocol、两 adapter 都不改，三条测试全绿。补了一条三方比对，**born-red 验过**。
  - `verify-null-owner.mjs` 的 `const UI` 写死 5173 → 改成认 `VERIFY_BASE`（缺省不变）。
    问题不是"跑不到别的端口"，而是**跑到别的树**：本轮 5173 上就是主检出 `D:\avery` 的 preview。

### 验证账

`npm run typecheck` 绿 · 离线 pytest **4045 passed**（基线 4028 + 17）· needs_db **115 passed**
（本地 throwaway `redesign0808`，**绝不碰 5432 的预检容器**）· 新门 **40/0** ·
A 区 **34/34**（改完人眼过的 CSS 后又复跑一遍，仍 34/34）· B 区 data-boundary **37/37** ·
null-owner **15/0（真跑到了）** · visual **8/8 · 50 张 md5 未变** · C 区 **3/3**。

## 上几轮做完的（详情全在各自回执，这里只留会影响下一个人的）

- **wave 1 · S1 = #75 议事室 Claude 化 + #73 现场附件**——`receipt-75-room-claude.md`。
  docked composer 三态统一（发问零跳变量 x/y/宽）· 停止生成落成第五状态 `interrupted`（不是
  旁挂布尔——那是 fail-open）· 多行输入 + IME 让位 · markdown 自渲染最小子集（零新依赖、
  零 `dangerouslySetInnerHTML`）· 胶囊即发 · 附件选文件时就预检上限。
- **wave 1 · S2 = #74 + #77 + #76**——`receipt-76-77-74-files.md`。
  `file_cards()` 补发 `source_key` → @ 引用按服务端权威名寻址 · 删除文件走**独立模块**
  `file_delete.py`（不进 mixin、不进 Protocol）· 资料库段落按频率重排 + 锚点导航。
- **#72 建议追问 chips + 快问收敛**——chips 点击即发；触发判据走文种感知词边界；`askLive` store 级 busy 闸。
- **#69+#71 会话流+灰提示**——`turns: LiveTurn[]`；离开议事室/刷新=对话结束（刻意不持久化）；
  文案长度闸开显示宽度不开字符数（碑）。
- **#70 @ 文件引用两修** · **#68 数据态像素基线** · **#66+#67** · **#65 / #64 / #63 / #61 / T9–T11**。

## What's Next（按优先级）

1. **wave 2 收口已全部完成**（#78 全绿、回执已落、已合入本地 main `2cfe44c`）。
   保留在这里是因为下一个人需要知道口径：本波单线、fast-forward、无合流冲突，
   所以没有「后合者复跑全电池」那一步——全电池是在合之前就跑完的（A 34/34 · B 3/3 · C 3/3）。
2. **0808 UIUX 重构战役续跑**（档案 `.issues/redesign-0808/`，四路侦察正源都在）：
   - **wave 3**：#79 文案全量批改（**等 #75-#78 全落** ✅ 已满足）+ 像素全量重冻（只来一次）；
     见仁见智 8 条在 `tickets.md` 末尾待 Danny 勾。
     ⚠ #79 §5 表里 `upload.againBody` 那句「用**上面**那个口子」在 #76 重排之后方位词要按新序复核。
     ⚠ #79 要改 `roomHistoryTitle`（「之前问过的」→「历史对话」）——**#78 已经把它旁边的计数
     单位从「条」改成「场」**（新键 `roomHistoryCount`），改标题时两者要读顺。
     ⚠ 重冻时考虑给议事室补一张**数据态 + 历史面板展开**的基线（现在那一面零像素覆盖）。
3. **复演（第 5 轮）**：战役各波落地后全内容演习；顺带补验第 4 轮遗留两点——真 brain 往
   followup_questions 里填什么（离线只证管道）、快问收敛的真实手感。
4. **统一上产**（gap2 三票 + 三轮演习批 + #68 + 重构战役全部）。🔴 push 与换后端容器同窗口；
   **0015 + 0016 必须落地**；上产后先设 `AVERY_PUBLIC_BASE` 再验表单。
5. **T8 两条记录**：① 议事室引用编号形状；② 今天页证据行机器形状（ADR-0033）。
6. **给 `/health` 加版本字段**。
7. carry-over：**Claude 式会话侧栏（0808 拍板不做；#78 真线程落地后它已是自然延伸——
   数据层齐了，缺的只是壳级布局）** · 判读卡 4 段死渲染 + 后端已发前端未消费 7 类字段 ·
   r2 未开票发现 · gate-run 迁移 · files-hub #26–#29 · 换血抢救 #31/#32 · v01 退役 #33 ·
   真机零覆盖（iOS/微信，最高优）· 成本票 #30 · 真 brain 分流取证 · 全量 feat-063。

## Notes（顺手发现，没顺手修）

- **短答路 followups 落库仍被丢**（`app.py` 的 `_persist_advise_run` 只取 `answer.text`）。
  #78 票内裁**不补存**（要存就得再加一列或把 answer 改成 jsonb，后者打破 advice/answer 互斥）。
  后果：hydrate 出的**短答**轮没有追问 chips，**advice** 轮有（它们在 jsonb 里）。
- **`fetchAdviseRuns` / `refreshAdviseRuns` 前端已无消费者**（界面改读分组那条）。没删——
  后端平铺读面仍是公开契约、四条测试盯着它。
- **议事室历史面在像素里零覆盖**（room 四张是无材料态、visual-data 无 room）。#79 重冻时补。
- **`--lite2-bottom-band` 是幽灵 token**（全文件无赋值行，消费全走 `var(…,120px)` 兜底
  ＝恒等于硬编码 120px）；**`--lite2-clear-top` 的 ≤860 覆盖写了两遍**，早段 72px 已被后段
  24px 静默架空。#78 的历史面板 `max-height` 沿用了这两个表达式，值不变。
- **`.issues/gap-design-0805/t8-e2e.mjs:514` 是 `room.status !== 'error'` 反向判断**，
  `interrupted` 与 #78 的 hydrated 轮都会被它当成通过。一次性门，未改。
- **`data-room-composer` 从未落地**：`lite2.css:481-482` 与 `design-75-73.md` 的注释都声称门已
  改判到它，全仓 grep 只有那三处**注释**命中，DOM 上没有这个属性。写新门别照注释抄选择器。
- **at-references ⑧ 的宿主矩阵缩水**：三态统一后空态与运行态 composer 几何一样，
  (a)/(b) 与 (e)/(f) 不再是两种几何。矩阵在视口档位与胶囊宿主上仍有价值。
- **`nexus-brief-hud` 与四相面板仍在说同一件事**（recon §4-11）；#75 只修了眉标撒谎那半。
- **switchContext 换公司时 `turns`/`run` 不清**——只有 `resetLiteCompanyData` 清。
  #78 给三抄本都补了 `threadId`/`adviseThreads`，但 `turns`/`run` 那半仍只在第三份里清。
  今天被 RoomScreen 卸载清场掩着；哪天 turns 能跨挂载存活，这个洞会立刻从潜伏变成真串数据。
- **中文名互为前缀仍双中**（「王力」vs「王力宏」）：词边界对 CJK 刻意不阻断，宁多勿漏。
- **真 brain 的 followup 质量离线采不到样**；**历史轮没有折叠**；**决策卡 `reason` 在 mock 语料下是空的**。
- **`tests/test_at_references.py:90` 潜伏 typo**：`rep.errors` 应为 `parse_errors`。
- **`>` 开头的材料块结构性不可引用**；**facts.md 指针不是单射**。
- 🔴 **`AVERY_PUBLIC_BASE` 必须指后端自己的口**（#63 实收）。
- **粒度闸够不着跨批次**（T10）；**`_people_from_roster` 位置兜底会顶掉空格子**（#61）。
- bellIsReal / nudgeVerdict 等手册协议相位仍无机械 runner。

## Blockers / Risks

- 无硬 blocker。
- 🟠 **别单独 push main**（ahead 60+，实数跑 `git rev-list --count origin/main..HEAD`）：
  前端 push 即自动上产、后端容器要人手换，同窗口做。
- 🔴 **像素基线目录是 gitignored**（`.gitignore:34`），**每棵树各一份**：worktree 里那份是空的，
  在 worktree 跑 visual = 首写，证明不了任何事。#78 的真比对做法：**在主检出 `D:\avery` 跑
  playwright（用它的真基线），用 `VERIFY_BASE` 指向 worktree 的 preview**——两份 spec 都读
  这个环境变量，不必动主检出的 dist 或分支。
  ⚠ 顺带订正一条长期记档：**`visual*.spec.mjs` 并没有写死 5173**（它们读 `VERIFY_BASE`）；
  真写死的只有 `verify-null-owner.mjs`，#78 已把它改成同一口径。
- 🔴 **5173 可能被别的树占着**（本轮就是主检出 `D:\avery` 的 preview）。照抄默认端口跑门 =
  **验的是别人的构建**。隔离端口 + `VERIFY_BASE` + `AVERY_CORS_ORIGINS` 三件套一起给。
- 🔴 **改完后端必须按端口杀掉重起 uvicorn**：它不热重载，新路由跑在旧进程上会以
  「面板空的 / 删了没反应」这种误诊断形态假红（#75/#76/#78 各栽过一次）。
- 🔴 **变异活下来 ≠ 门有洞，也 ≠ 代码有 bug —— 先看变异有没有真的碰到被判的性质**。
  #78 两条活下来的变异复盘：一条是 **belt-and-braces**（外层幂等闸让内层 busy 闸免疫变异，
  判据要拿"另一场"去试）；一条是**尺子太宽**（判「3 轮且最后一句是 Q4」分辨不出
  「没重灌」和「用刷新过的快照重灌了」，要判"刚问那轮还是不是活轮"）。
- 🔴 **门崩掉比门变红难诊断得多**：选择器命中 0 个时 `.getAttribute()`/`.click()` 会**抛错**，
  整份门 crash、连汇总行都不打印。先判 `count()` 再动它（#78 实收，M-E 第一版就是这么崩的）。
- 🔴 **门全绿 ≠ 真部件被验到**：#78 在 A 区 34/34 之后，人眼过仍逮到两处（面板是个很高的空盒子、
  半透明背景真的透字）。改完布局必须双视口 × 双皮截图人眼过。
- 🔴 **「必漂」预判会反着骗**：#78 开工前的预判是「改历史面板必漂像素基线」，实证是**零覆盖**
  （room 四张是无材料态、visual-data 无 room）。零漂移不等于没影响。
- 🔴 **PostgreSQL 的 text 不允许 NUL 字节**：拿 `E'\x00…'` 当「肯定不冲突」的哨兵是**直接报错
  不是安全**（#78 差点种下）。
- 🔴 **pg 的 SELECT 列序与元组解包裸耦合**：加列一律**追加在末尾**；插中间是 text↔text 对调，
  Postgres 与 pytest 都不会吭声。#78 已照 `_FORM_SUB_COLS` 先例把 advise 那组提成常量 + 单点解包。
- 🔴 **离线套对 pg 持久层是瞎的**：动 schema 必跑 `@needs_db`（本地 throwaway 库，
  **绝不对 5432 的预检容器跑**）。
- 🔴 **源文件是 CRLF**：任何按字符串锚点做的批量改写都要先按目标文件真实行尾归一，
  「锚点找不到」被静默当成「跑完了」会直接得出错误结论（#78 的变异跑器第一版就栽在这，
  好在它是 fail-loud 的）。
- 🔴 **本机 curl / argv / stdout 都按 GBK 啃中文**：中文只走文件（`git commit -F` / `gh api --input`）。
  ⚠ 同族：`subprocess` 不写 `encoding='utf-8'` 会在读子进程输出时 `UnicodeDecodeError`，
  **输出丢一半而命令看起来跑完了**（#78 实收，吃掉过一条变异的汇总行）。
- 🔴 **`./init.sh` 和 run-battery 的收尾重建都 `vite build` 不带 api base** → dist 落回生产域名。
  跑任何上传型门/截图之前先重打带 `VITE_AVERY_API_BASE` 的 dist**并验 apiBase**。
- 🔴 **cwd 残留会把命令打到别的树**；worktree 会话里 git 与构建命令一律显式指定路径。
- 🔴 **杀 npx 包装进程杀不死 vite 子进程**；stale 进程按端口杀、CommandLine 认领后只杀自己的。
- 🔴 **本机 Docker PG 容器时钟来回跳 ~115s**：`created_at < now()` 判据间歇假红。
  写测试别赌墙上时钟（#78 的生成窗口一律用**路由延迟**造）。
- 🔴 **选择器绑标签名会让门「崩」而不是「红」**；新部件一律挂 `data-*` 稳定钩子。
- 🔴 **改判扫描的暗区**：`scripts/gates/live-frontend-gate.snippet.js` 不在 `*verify-*.mjs` glob 里。
- 🔴 **CSS 包含块/裁剪读码推断必须浏览器实测**（#66）。
- 🔴 `e535ec9` commit message 是错的（真相在 `03a9824` erratum）；rebase 与否归 Danny。
- 🔴 repo 级 stash 两条别人的存货；处置归 Danny。
- 多个战役 worktree 仍挂着（29 个上下）——删分支/worktree 属删除闸，归 Danny。
- ⚠ **各票收尾必须重写本文件**（AGENTS.md DoD）。
