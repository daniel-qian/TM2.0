# Session Progress Log

> 📢 本文件是**当前状态快照，整体重写不追加**。历史都在 git（`git log` + 各 `.issues/*/receipt*.md`），别在这儿堆编年史。
> 启动路径见 `AGENTS.md` Startup Workflow：读本文件 + `feature_list.json`，跑 `./init.sh` 确认绿，再开工。

**Last Updated:** 2026-08-07 深夜（gap2 战役 **T10（#59）补资料合 main**；T11/#60 已在 main，T9/#58 仍在自己的 worktree 上）

## Current State

- **git**：`main` = 差距战役 #50–#57 八票 + **gap2 T11（#60）** + **gap2 T10（#59）**。
  T10 是三个 commit（产品代码 + 撤下一个误提交的一次性文件 + 合 main 的 merge commit）。
- **gap2 三票进度**：T11、T10 **已合 main**；T9（#58 站内主动）还没回来。
  三票互相独立，但都动 FilesScreen——**合 main 串行，每合一张在主检出跑一次像素门**。
- **验证账实（T10 合完这一刻的实测，非估数）**：
  后端离线全套 **3893 passed / 111 deselected / 4 xfailed / 0 failed**（T11 那刻 3848 + T10 的 45 条）；
  `@needs_db` 全套 **102 passed**（真 PG，7m13s；基线 98 + T10 的 4 条）；
  前端电池 **A 27/27 · B（data-boundary）37/37 · C 3/3**（A 区多的那一道是 T10 新加的 append-story）；
  i18n **971** 叶子键 / 孤儿 0（T11 那刻 962 + T10 的 9 条），zh/en 键集逐键对齐；
  变异测试 T10 后端 18/18 + 前端 3/3 全部 killed。
  **像素基线：本轮改了界面，40 张要在主检出重冻并人眼过 —— 见 What's Next 第 1 条，这是本轮唯一没做完的动作。**
- **✅ 生产仍停在 08-07 白天那一版**（`main-20260807-190332` = main `99d83f7`）。
  T10/T11 **都没有上产**——票面写明「落 main 即止，统一上产由主 session 另行安排」。
  上产与 HITL 复验的两份回执仍是 `.issues/gap-design-0805/receipt-deploy-0807.md` 与
  `receipt-hitl-0807.md`；迁移 0012/0013/0014 已在生产库落地。
  ⚠ **T10 也不需要新迁移**：实体（人/项目/冲突）在 pg 侧是整块 jsonb，按 dataclass 字段名过滤
  写入与回读，`provenance`/`archived` 本来就在往返里。新加的只有 registry 上的一个**读**方法
  （`is_ephemeral()`，读的是 `avery.contexts.ephemeral` 这个既有列）。
- 🔴 **T10/T11 合的都是本地 main，没有 push**（`main...origin/main [ahead 6]`）。票面写的
  「落 main 即止」在这个仓库里必须理解成**不 push**：前端没有人工上产步骤，**push main 即自动
  构建上产**，推一下就等于把前端单独上了产、而后端容器还停在旧镜像。所以这一步留给统一上产
  那个 session：它要在**同一个窗口里** push + 换后端容器（见 What's Next 第 3 条）。

## 本轮做完的（2026-08-07 深夜 · T10 补资料，issue #59）

回执：`.issues/gap2-0807/receipt-T10-append.md`（逐条判据 + 变异账 + 拍板取舍 + 已知边界）。

**拆掉了「每次上传 = 新开一家公司」那堵墙。** 经理现在能给**当前这家公司**补资料：新文件并进来，
卡片安静更新到新读数、逐字段出处指向新资料，只有新旧对不上才走今天页那条双栏通道。
**没有砍半**——资料库、实体归并、卡片、出处、今天页五处一起接通（只进资料库不动卡片，
会让「证据过期了」那条提醒自己闭嘴，而卡片还挂着上个月的读数）。

- **新端点** `POST /team/{context_id}/files`：同一个 `authorize_context`（同体 404 无枚举），
  字节侧四道闸与 `/ingest` 逐条同一套。回执 = 与 `/team/{id}` 同一张 payload + 一个 `appended` 块；
  **不回传 owner_token**（凭据只在创建时交出去一次）。
- **新模块** `avery/ingest/file_append.py`：照 `form_append` 的 `get → 原地 mutate → put` 范式，
  绝不新造 `CompanyContext`、绝不调 `ingest_paths`/`ingest_docs`（覆盖语义）。
  **只对新文件跑抽取**——LLM 花费与新文件成正比，不与资料总量成正比。
- **实体增量归并**（本票最重）：`merge_person_reading` docstring 里那四个坑逐条变成机制 + 判据
  （整表重写吞手编/软删/出处 · 旧冲突重复记账 · `held_src` 记错 · signals 换尺重筛）。
  人走 `PersonIndex`/`merge_person_reading` 扩展（加可选 `ledger`）；项目**新写**了增量原语，
  并把合并规则提成 `_absorb_project` 让两条路共用一份定义，顺带补了此前**根本不存在**的
  `_disambiguate_project_ids`。
- **安静更新**落成一句可执行的话：**只有确凿知道新资料更新时才让新值顶掉旧值**，拿不准一律
  keep-first（与 `clear_stale_self_report` 同一条口径，时间只走全仓唯一那个 ISO 解析器）。
  顶掉之后逐字段出处写进 `provenance` 侧车（`origin='doc'`），前端 `provenanceBadgeKind` 加第四态，
  详情浮层显示「读自〈本周周报.md〉」。
- **前端**：资料库屏第②段拆成两个动作（「给这家公司补资料」/「另建一份画像」），
  `againTitle`/`againBody` 跟着改口；`UploadPanel` 加 `mode`（不抄第二份——`ACCEPT` 那行只许有一把尺）；
  store 的 `appendFiles` 走**自己的**状态机（借 `ingestStatus` 会发一条假的「你的团队已就绪」）。
- **demo 克隆先禁入口**（票面边界）。判据是后端**每帧都发**的 `ephemeral`，不是只在领取首帧出现的
  `demo`——后者刷新一次就没了，入口会自己冒出来。为此给两个 registry 适配器 + Protocol 各加了
  `is_ephemeral()`，读的是 GC 用的同一个标记。

### 🔴 变异测试翻出来的一个门洞（不是代码 bug）

「把补资料那个口子接错线、其实调的还是 `uploadFiles`」这条前端变异**第一轮活了下来，0 红**——
因为 story 门当时**直接调 store**，根本没碰过那个按钮。本票交付的东西就是那个入口，
判据必须落在它身上。门已改成走真界面（`page.setInputFiles('.lite-files-append input.upload-input', …)`），
补杀 9 红。**教训：门驱动的是 store 还是真部件，决定了它能不能看见"接线"这一类 bug。**

顺带把门里的 `settle()` 改成超时不抛、而是记一条会说话的 FAIL：接错线时状态机永远停在 `idle`，
裸 `waitForFunction` 会等满超时把整道门炸掉——炸掉也算红，但读日志的人看到的是一条 playwright
堆栈，而不是「这个口子接错线了」。

### ⚠ 两条环境假红（隔离端口下必踩，记档给下一个人）

1. `verify-onboard-gate.mjs` 的 `API` 常量默认 `127.0.0.1:8137`，只认 `VERIFY_API` 覆盖 ——
   不设就去打**另一个 session 的后端**，两条笔记判据假红。
2. `verify-form-builder.mjs`（T11 的门）用 `phone.goto(link)` 打开**服务端拼好的**员工链接，
   而 `public_base()` 只认 `AVERY_PUBLIC_BASE`、缺省是**生产域名** —— 不设就会把浏览器导到生产站
   （只是 GET 一个不存在的 token，没写数据），页面答「链接不存在」→ 一条假红。

隔离端口起后端的完整口径：
`AVERY_BRAIN=mock AVERY_EXTRACTOR=heuristic AVERY_EMBEDDINGS=keyword AVERY_DEMO_SEED_DIR=tests/fixtures/demo-seed AVERY_PUBLIC_BASE=http://127.0.0.1:<口> AVERY_CORS_ORIGINS=...`，
跑门时 `VERIFY_BASE` **和** `VERIFY_API` 都要给。

## What's Next（按优先级）

1. 🔴 **在主检出重冻像素并人眼过（T10 唯一的欠账）**。理由不是流程洁癖：`__snapshots__/` 是
   gitignore 的单机产物、**每 worktree 一份**，在 T10 的 worktree 里重冻等于没重冻。
   T10 改了资料库屏（多一段「给这家公司补资料」）与详情浮层（多一个出处角标）。
   ⚠ 像素 spec 跑在 `?transport=stub` 且从不上传 → `contextId` 恒 null → **补资料那一段整段不渲染**
   （它三条否决的第一条就是没有 contextId）。所以会动的其实是第②段那两句改口的文案，
   以及标题从「上传新一批」→「另建一份画像」。**逐张人眼过对照板，再决定重冻。**
2. **等 T9(#58) 回来合 main**（它自己的 worktree 在跑）。合的时候：
   - 也动 `FilesScreen.tsx`，串行合、合完再跑一次像素门；
   - T11 已把 `StandingFormsSection` 的四条早退砍到两条；T10 在同屏加了 `AppendSection`
     （三条否决：没 contextId / 通道没有 `appendFiles` / 这份工作区是一次性克隆）——要改那几条 guard
     先读一遍两票的注释；
   - T10 在 `LiveTeamPayload` 上加了 `ephemeral?` 与 `appended?` 两个可选键，在 store 上加了
     `appendStatus`/`appendError`/`appendReceipt` 三个状态（并进了 `adoptContext` 与
     `resetLiteCompanyData` 那两份**必须同步改**的清单）。
3. **三票齐了统一上产**（票面：落 main 即止，上产由主 session 安排）。
   🔴 **push 与换后端容器必须在同一个窗口里做**：前端 push main 即自动构建上产，
   先 push 再慢慢换后端，中间那段线上就是「新前端 + 旧后端」——T10 的「补资料」按钮会在，
   但那个端点在老后端上是 **404**，经理点了只会看到一句失败。
   ⚠ T10/T11 都不需要新迁移（理由各见 Current State）。
4. **Danny 用户视角端到端演习**（三票落地上产之后）：从零自己开一个新工作区走全程，
   记录「卡在哪、哪一步不知道该点哪」当清单，演习后再定修哪些。
5. **T8 留的两条记录还在桌上**（只记录未改，等拍板）：
   ① 议事室引用编号是 `facts.md:<行号>` 而非客户自己的文档名；
   ② 今天页证据行是 `字段="值"` 的机器形状（ADR-0033 明定）。
6. **给 `/health` 加一行版本字段**（镜像 tag 或 commit）：现在「生产跑的是哪个 commit」外部不可核。
7. carry-over：r2 未开票发现（`.issues/sweep/2026-08-02-r2.md`）· gate-run 迁移（aria-zh/cr-alignment）·
   files-hub #26–#29 · 换血抢救 #31/#32 · v01 退役 #33 · 真机零覆盖（iOS/微信，最高优）·
   成本票 #30 等真实客户量 · 真 brain 分流取证（要先给口径）· 全量 feat-063。

## Notes（本轮顺手发现，没顺手修）

- **markdown 表格外侧带竖线时 roster 解析器抽不出人**：`| 姓名 | 部门 |`（首尾都有竖线）零命中，
  `姓名 | 部门`（只有内侧竖线）正常。写 T10 语料时实测到的。客户真实路径多是 xlsx/csv，
  所以没顺手改；但「客户把表格复制成标准 markdown 再传」是个很自然的动作，值得单独一票。
- **粒度闸够不着跨批次**：`granularity.apply_gate` 会 `res.projects = keep`，所以补传路只能对
  **新批次**跑闸（把整份 extraction 连同单份新文档喂给它 = 拿一个缺了源文档的 docs 集合重判每一张
  老卡，那是整表静默删除）。代价：「新文档里的一条里程碑其实属于一个**存量**项目」这种误判挡不住。
  宁可漏，已写在 `file_append.py` 的碑上。
- **`role`/`tenure` 两份资料说法不同时，两条路今天都不记冲突**（`_CONFLICT_FIELD_ALLOWLIST` 人侧
  只有 `team`）。补传路让它们安静更新——这是拍板③要的，但「对职位说法不同」今天仍然零记录。
  既有边界，本票没扩大也没收窄。

## Blockers / Risks

- 无硬 blocker。
- 🟠 **别单独 push main**：前端 push 即自动上产，而后端容器要人手换。先 push 再换后端，
  中间线上就是「新前端 + 旧后端」——T10 的补资料入口在、端点 404；T11 的拼装器入口在、
  `yesno` 被老后端 422、`draft-from-file` 404。**这不是残缺功能，是上到一半的产。** 同窗口做。
- 🔴 **在 worktree 里重冻像素＝没重冻**：`__snapshots__/` 是 gitignore 的单机产物、每 worktree
  一份。新 worktree 第一次跑像素门是 40 张「没有基线」全写入（playwright 报 exit 1）——
  那**既不是漂移红也不是绿**。真比对只在主检出上有意义；红了先比 mtime 再谈漂移。
- 🔴 **门驱动 store 还是驱动真部件，决定它能不能看见"接线"型 bug**（T10 的变异翻出来的）。
  凡是「新加了一个入口」的票，判据必须落在那个入口本身上，不能只调它背后的 action。
- 🔴 **`_GUARDED` 这类精确匹配的路由表，带路径参数的新端点永远命不中**。新开写端点时先问一句
  「边缘那层闸认不认得它」——认不得的话，处理器里的闸照旧生效，于是「看起来有闸」，
  而限流/总量兜底整层是空的。
- 🔴 **脚本落盘的「会话/状态」文件默认当凭据看**：规则已收紧为 `.issues/**/.hitl-session*.json`。
  **先写 .gitignore 再写脚本**。
- ⚠ **提示词里的约束不是判据**：模型会不听。凡是「只有满足 X 才准输出 Y」的规矩，落地层必须有
  一道能对着**文档原文**验的闸。
- ⚠ **belt-and-braces 会让内层规则免疫变异**：两把锁必须是两道**独立**的门，否则其中一条规则
  被换掉时另一把锁会替它挡住变异，你只会看到一片绿。
- 🔴 **stale uvicorn 按端口杀**（`Get-NetTCPConnection -LocalPort <口> -State Listen` → `Stop-Process`），
  别信 ps 信行为；各 session 结束清自己起的端口。
  同族：`PgRegistry._schema_ready` 是实例级缓存——换库不重启后端＝迁移不重放。
- 🔴 **`vite preview` 默认只绑 `::1`**：起 preview 一律加 `--host`（裸 `--host`，不写 127.0.0.1）。
- 🔴 **本机 Docker PG 容器时钟来回跳 ~115s**：`created_at < now()` 判据间歇假红；
  写测试别赌墙上时钟（T10 的语料一律显式给 `uploaded_at`）。
- 🔴 **本机 curl / argv / stdout 都按 GBK 啃中文**：中文只走 heredoc / `--input` 文件 / 写进文件再跑；
  中文 commit message 一律 `git commit -F <文件>`。
- 🔴 `e535ec9` commit message 是错的（真相在 `03a9824` erratum）；rebase 与否归 Danny。
- 🔴 repo 级 stash 两条别人的存货（`stash@{0}`/`stash@{1}`）；处置归 Danny。
- 多个战役 worktree 仍挂着（22 个，含 gap2 三条）——删分支/worktree 属删除闸，归 Danny。
- ⚠ 本机残留：Docker 库 `t8e2e`（T8 自检专用）；`teammaster-postgres-1` 容器在运行态。
- ⚠ **各票收尾必须重写本文件**，这是 AGENTS.md 的 DoD，不是可选项。
