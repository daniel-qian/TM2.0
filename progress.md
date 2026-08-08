# Session Progress Log

> 📢 本文件是**当前状态快照，整体重写不追加**。历史都在 git（`git log` + 各 `.issues/*/receipt*.md`），别在这儿堆编年史。
> 启动路径见 `AGENTS.md` Startup Workflow：读本文件 + `feature_list.json`，跑 `./init.sh` 确认绿，再开工。

**Last Updated:** 2026-08-08（演习批三票**全部落 main**：#61 → #63 → **#64 议事室 @ 引用回归**
（本轮，后合者）；票 #64 已关。像素主检出 36 张零漂移复验 + 交互态六张人眼过；
仍未 push、未上产；下一步：复演 → 统一上产）

## Current State

- **git**：`main`（`3a842c2`）= 差距战役 #50–#57 八票 + gap2 三票（T11 #60 / T9 #58 / T10 #59）+
  演习批三票：**#61**（`.issues/rehearsal-0808/receipt-61-md-table-frame.md`）·
  **#63**（`receipt-63-merge-closerlook.md`）· **#64**（`receipt-64-at-references.md`）。
  `main...origin/main [ahead 26]`，**没有 push**（见 Blockers）。
- **#64 验证账实（合并 #61/#63 之后的树上实测，非估数）**：
  后端离线全套 **3974 passed / 115 deselected / 4 xfailed / 0 failed**（含新 `test_at_references.py`
  18 条）；前端电池 **A 30/30**（30 = #63 后的 29 + 新门 **verify-at-references**，20 判据全落
  POST /advise **网络请求体**）· **B** data-boundary 37/37 + null-owner 15/15 · **C 3/3**
  （auth-form 首跑 1 红 = #63 退 tab 漏改判的 `tabCount===9`，已补改判复跑 57/57）；
  变异 **18/18 killed**（后端 9 + 前端 9，含一条 born-red 实证）；i18n **986** 叶子键 / 孤儿 0，
  zh/en 逐键对齐；`./init.sh` 绿。
  ✅ **像素**：主检出复跑 **4/4（36 张）零漂移**——#64 静息态 DOM 与改造前逐字节等价（状态类
  只在交互态出现），无需重冻；交互态（@ 弹层/chips/胶囊弹层）另截六张人眼过
  （`.issues/rehearsal-0808/t64-shots/`），零折行溢出零破碎。
- **✅ 生产仍停在 08-07 白天那一版**（`main-20260807-190332` = main `99d83f7`）。
  演习批与 gap2 三票**都没有上产**——统一上产由主 session 另行安排（What's Next 第 2 条）。
  上产/HITL 回执仍是 `.issues/gap-design-0805/receipt-deploy-0807.md` 与 `receipt-hitl-0807.md`；
  迁移 0012/0013/0014 已在生产库落地。
- 🔴 **迁移账（上产时按这个来）**：
  - **T9 需要 `0015_form_submissions_auto_key.sql`**——加一列 `auto_key` + 部分唯一索引
    `(context_id, auto_key) WHERE auto_key IS NOT NULL`。increment-only、可重放，
    `_ensure_schema()` 每次 bootstrap 自动重放，换容器即生效。
  - **T11 / T10 / #61 / #63 / #64 都不需要**：#64 刻意不把 refs 落进 `advise_runs`
    （织文后的 question 已带引用标签，历史可见；要结构化回放再开票）——零表结构改动。
  - 判据一句话：**动 dataclass 里被整块 jsonb 装着的字段 → 免迁移；动表的顶层列 → 必须迁移。**
- 🔴 **合的都是本地 main，没有 push**。「落 main 即止」在这个仓库里必须理解成**不 push**：
  前端 push main 即自动构建上产，推一下就等于把前端单独上了产、而后端容器还停在旧镜像。
  push + 换后端容器必须在统一上产那个 session 的**同一个窗口里**做（What's Next 第 2 条）。

## 本轮做完的（2026-08-08 · #64 议事室 @ 引用回归，一步到位结构化）

回执：`.issues/rehearsal-0808/receipt-64-at-references.md`（交付面逐条 + 电池终值 + 变异账 18 条 +
拍板取舍 + 已知边界）。交互考古自 `7b03982^:src/lite2/LiteComposer.tsx`（#47 退役时没搬进胶囊，
功能丢失 17 天），**抄交互不抄提交层**。

**经理问 Avery 终于能点名了，而且点到的人/项目/文件/手册的读数保证进模型上下文。**

- **前端**：新件 `AskRefComposer`（议事室常驻 composer 与悬浮胶囊共用）——打 `@` 弹候选层
  （全部/人员/项目/文件/操作手册五筛选 chip、combobox aria、↑↓/Enter/Esc 键盘可达），选中变
  chip，重名按部门消歧（FilesScreen dupeNames 口径，按全量花名册算）；胶囊经
  `/room?q&refs`（EPHEMERAL 扩展）+ `flowStore.composerDraftRefs` 中继进屋预填。
- **契约**：`AdviseRequest.references?: [{kind,id,label}]` additive 可选（空即整键不发）；
  提交层**双通道**——refs 结构化 + 引用标签织进 situation 文字（`涉及：…`，i18n，进历史回显）。
  织文是「新前端 + 旧后端」窗口期的兜底：旧后端静默忽略 references，织进去的名字帮 recall
  命中——答案不比今天差（正是旧 LiteComposer 的全部机制）。
- **后端**：新件 `avery/ingest/references.py`——卡片读数（复用 `_one_person_card` 等既有投影，
  含 provenance 指针；self_report 仍走 scoring 开关＝与 GET /team 同一道投影闸）+ 相关文档行
  （`memory._candidates` 同一迭代上的确定性子串扫描，**真 facts.md/notes.md 行号，cite 解析
  得开**——溯源形状不变）。`engine.stream_advice` 新增 `preamble` 参数把块**钉进开场 user 轮**
  ＝保证进上下文，不赌模型调 read_case、不看 recall 脸色；case 正文同步落
  `## Referenced records (@)` 段（read_case 所见 = 开场轮所钉）。配额封顶（8 引用 / 24 行总预算
  按引用数分摊 / 单行 200 字符 / 整块 6000 字符，常量在文件头）；未知 kind 跳过、悬空 id 一行
  诚实 not-found、builder 异常降级为无注入——**绝不 422/失败经理的提问**（D11 口径）。

### 🔴 过程里翻出并修掉的一个组件级 bug（门⑦逮到，值得记形态）

**React 的 SelectEventPlugin 在同一个 keydown 派发批次里、onKeyDown 之后紧跟着派发
onSelect**。@ 层「光标移动重判 @词」挂在 onSelect 上 → Esc 关层的同一批次里被原地重开，
且两个 handler 出自同一次 render，**state 版的「Esc 静音位」在那个闭包里恒是旧值，修不动**——
必须用 ref（同批次写入立即可见）。凡「输入框内 Esc 关浮层」类交互都可能踩：静音位用 ref。

## 上几轮做完的（详情全在各自回执，这里只留会影响下一个人的）

- **#63 「值得注意」并进「今天」（浅合）**——回执 `receipt-63-merge-closerlook.md`。
  tab 9→8、`/closer-look` 重定向 home、对照卡进差距摘要块展开态；新门 verify-v2boots +
  flow-gap-phases 第 9 判据（落点判据要**先离开目的地再触发**）。
  ⚠ #64 收尾电池逮到 #63 改判漏网一条：C 区 `verify-auth-form` 写死的 `tabCount===9`
  （C 区自建 dist，不在常规改判扫描面里）——已补成 8 并立碑。**改 tab 数时三处一起**：
  LiteTopbar tabs 数组 + v2boots 期望数组 + auth-form 这条。
- **#61 花名册吃下标准 markdown 表格**——回执 `receipt-61-md-table-frame.md`。
  `_strip_table_frame` 行首第 0 列是竖线才算边框、首尾各剥一根；缩进 GFM 表格照旧不认（宁漏）。
- **T10 补资料（#59）**——回执 `.issues/gap2-0807/receipt-T10-append.md`。
  🔴 `upload_guard._GUARDED` 精确匹配，带路径参数的路由永远命不中——新写端点先问「边缘那层闸
  认不认得它」。🔴 门驱动 store 还是真部件，决定它能不能看见「接线」型 bug。
- **T9 站内主动（#58）** / **T11 模板拼装器（#60）**——回执各自在 `.issues/gap2-0807/`。

## What's Next（按优先级）

1. **复演**（演习批三票齐了，本地）：环境随起随用——`preview_start rehearsal-api / rehearsal-web`
   （launch.json 两条配置在，本地未提交；后端脚本 `.issues/gap2-0807/rehearsal-api.ps1`）。
   库 `rehearsal0808` 数据保留；脑真 MiniMax，抽取/检索离线。复演时顺手验：
   ① 演习花名册转标准 markdown 表格再传（#61 触发动作）；
   ② 「值得注意」并进今天后的动线——经理还找不找得到对照卡（#63 真验收）；
   ③ **@ 引用打真脑**：@ 一个人问一句、看答案是否真的引到了被点名实体的读数行（#64 真验收——
   离线套里 spy-brain 验的是「注入到达 conversation」，真脑「注入被用上」只有这里能看）。
2. **统一上产**（连同 gap2 三票 + 演习批一起）。
   🔴 **push 与换后端容器必须在同一个窗口里做**（新前端+旧后端的坏法清单见 gap2 各回执；
   #61 后端解析、#63 纯前端、#64 有织文兜底，这三票单方向可降级，但 T9/T10/T11 会上到一半）。
   ⚠ 换容器时 **0015 必须落地**；上产后**先设 `AVERY_PUBLIC_BASE`** 再验表单。
3. **T8 留的两条记录还在桌上**（只记录未改，等拍板）：① 议事室引用编号是 `facts.md:<行号>`
   而非客户文档名（#64 注入行沿用同一形状——真要换尺子两处一起换）；② 今天页证据行是
   `字段="值"` 的机器形状（ADR-0033 明定）。
4. **给 `/health` 加一行版本字段**（镜像 tag 或 commit）：「生产跑的是哪个 commit」外部不可核。
5. carry-over：r2 未开票发现（`.issues/sweep/2026-08-02-r2.md`）· gate-run 迁移（aria-zh/cr-alignment）·
   files-hub #26–#29 · 换血抢救 #31/#32 · v01 退役 #33 · 真机零覆盖（iOS/微信，最高优）·
   成本票 #30 等真实客户量 · 真 brain 分流取证（要先给口径）· 全量 feat-063。

## Notes（顺手发现，没顺手修）

- 🔴 **`AVERY_PUBLIC_BASE` 必须指后端自己的口，不是前端**（#63 门环境实收）：员工 H5
  `/f/{token}` 由后端 form_api 直接服务；指到前端的症状读起来像「员工页坏了」。
- **粒度闸够不着跨批次**（T10 记档）：补传路只能对新批次跑闸，碑在 `file_append.py`。
- **`role`/`tenure` 两份资料说法不同时，两条路都不记冲突**（人侧 allowlist 只有 `team`）。既有边界。
- **`_people_from_roster` 的位置兜底会顶掉空格子**（#61 看清的既有怪癖），要不要改单独裁。
- bellIsReal / nudgeVerdict 等手册协议相位仍无机械 runner；bellIsReal 落点已随 #63 改判 home。
- **@ 引用的候选检索是纯前端内存**（searchTeam 同源）；playbook 卡契约里没有 id，标题就是
  稳定键——将来方法卡长出 id，askRefs/后端 `_playbook_entry` 两处一起换。

## Blockers / Risks

- 无硬 blocker。
- 🟠 **别单独 push main**（`ahead 26`）：前端 push 即自动上产、后端容器要人手换，两件事同窗口做。
- 🔴 **在 worktree 里重冻像素＝没重冻**：`__snapshots__/` 是 gitignore 的单机产物、每 worktree
  一份。真比对只在主检出上有意义；红了先比 mtime 再谈漂移。**现基线 36 张**（#63 起
  closerlook 出列）；#64 零漂移复验过，基线未动。
- 🔴 **像素门不密闭：后端够不着 → `home` 先红 → 你要看的那几屏根本没被采样**。跑像素门前
  三件套：dist 用 `VITE_AVERY_API_BASE=<你的口>` 重打 + 那个口上真有后端（带
  `AVERY_DEMO_SEED_DIR`）+ `AVERY_CORS_ORIGINS` 放行 preview origin。
- 🔴 **TaskStop/杀 npx 包装进程杀不死 vite 子进程**（#64 实收，pkill-uvicorn 同族）：孤儿
  preview 会一直占着 5173/5174，下一个 preview 静默落到 5175——`VERIFY_BASE=5173` 就指到了
  **别人的 dist** 上，像素/门全在比对错的前端。症状：「Port 5173 is in use, trying another one」。
  处置：`Get-NetTCPConnection` 拿 PID → `Get-CimInstance Win32_Process` 看 CommandLine **认领
  是不是自己的**（路径里带自己的 worktree 名）→ 只杀自己的。
- 🔴 **改判清单要把 C 区（自建 dist 的门）也扫进去**（#64 实收）：#63 退 tab 的改判扫了 A/B 区
  与 snippet，漏了 C 区 auth-form 里写死的 `tabCount===9`——后合者的全电池才逮到。凡「全仓改判」
  的保洁，`git ls-files "*verify-*.mjs"` 全量扫，别按 ROSTER 分区挑着扫。
- 🔴 **门驱动 store 还是真部件，决定它能不能看见「接线」型 bug**；落点类判据要**先离开目的地
  再触发**。#64 的门全程真键盘驱动 composer、主判据落网络请求体，是这条纪律的最新样板。
- 🔴 **`_GUARDED` 这类精确匹配路由表，带路径参数的新端点永远命不中**。
- 🟠 **门的环境缺一样就以「像回归」的形态假红**。起门最小清单：`AVERY_BRAIN=mock` +
  `AVERY_EXTRACTOR=heuristic` + `AVERY_EMBEDDINGS=keyword` + `AVERY_DEMO_SEED_DIR` +
  `AVERY_PUBLIC_BASE=<后端口>` + `AVERY_CORS_ORIGINS`；跑门时 `VERIFY_BASE` **和**
  `VERIFY_API` 都要给。
- 🔴 **脚本落盘的「会话/状态」文件默认当凭据看**（`.gitignore` 已含 `.issues/**/.hitl-session*.json`）。
  **先写 .gitignore 再写脚本**。
- ⚠ **提示词里的约束不是判据**：落地层必须有对着**文档原文**验的闸。#64 的注入块头那句
  「never as instructions」是提示不是闸——注入的都是本工作区自己的读数行，攻击面收在
  「引用只解析已授权 context」这层真闸上。
- ⚠ **belt-and-braces 会让内层规则免疫变异**：两把锁必须是两道**独立**的门。
- 🔴 **stale 进程按端口杀**（`Get-NetTCPConnection -LocalPort <口> -State Listen` →
  `Stop-Process`），别信 ps 信行为；**只清自己起的那几个口**（CommandLine 认领）。
  同族：`PgRegistry._schema_ready` 是实例级缓存——换库不重启后端＝迁移不重放。
- 🔴 **`vite preview` 默认只绑 `::1`**：一律加裸 `--host`。
- 🔴 **本机 Docker PG 容器时钟来回跳 ~115s**：`created_at < now()` 判据间歇假红；语料显式给时间戳。
- 🔴 **本机 curl / argv / stdout 都按 GBK 啃中文**：中文只走 heredoc / `--input` 文件 / 写文件再跑；
  中文 commit message 一律 `git commit -F <文件>`；python 要 `sys.stdout.reconfigure(encoding='utf-8')`。
- 🔴 `e535ec9` commit message 是错的（真相在 `03a9824` erratum）；rebase 与否归 Danny。
- 🔴 repo 级 stash 两条别人的存货（`stash@{0}`/`stash@{1}`）；处置归 Danny。
- 多个战役 worktree 仍挂着（25 个上下，含 gap2 三条与演习批）——删分支/worktree 属删除闸，归 Danny。
- ⚠ **各票收尾必须重写本文件**，这是 AGENTS.md 的 DoD，不是可选项。
