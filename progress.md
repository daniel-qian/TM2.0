# Session Progress Log

> 📢 本文件是**当前状态快照，整体重写不追加**。历史都在 git（`git log` + 各 `.issues/*/receipt*.md`），别在这儿堆编年史。
> 启动路径见 `AGENTS.md` Startup Workflow：读本文件 + `feature_list.json`，跑 `./init.sh` 确认绿，再开工。

**Last Updated:** 2026-08-07 深夜（gap2 战役 **三票（#58/#59/#60）全部合 main**；T10 是最后一张）

## Current State

- **git**：`main` = 差距战役 #50–#57 八票 + **gap2 三票齐**：T11（#60 模板拼装器）、
  T9（#58 站内主动）、T10（#59 补资料）。三份回执都在 `.issues/gap2-0807/`。
- **验证账实（三票齐了之后在 T10 worktree 上的实测，非估数）**：
  后端离线全套 **3927 passed / 115 deselected / 4 xfailed / 0 failed**；
  `@needs_db` 全套 **106 passed**（真 PG，7m27s；HITL 基线 98 + T9 的 4 + T10 的 4）；
  前端电池 **A 28/28 · B（data-boundary）37/37 · C 3/3**（A 区多出来的三道 = T11 form-builder、
  T9 forms-proactive、T10 append-story）；
  i18n **976** 叶子键 / 孤儿 0，zh/en 键集逐键对齐；
  变异测试三票各自跑过（T11 17 条 · T9 15 条 · T10 后端 18 + 前端 3），全部 killed。
  ✅ **像素基线已在主检出重冻并人眼过**：漂移恰好是 4 张 `*-files-*`，内容**只有 T10 改口的那三句文案**
  （小节标题「上传新一批」→「另建一份画像」+ 那条 note 的标题与正文），版式一字未动、桌面/手机
  都没有折行或裁切问题。重冻后重跑 40 张零红。补资料那一段在基线里**结构上不渲染**（stub 无
  contextId），与常驻表单区同因。
- **✅ 生产仍停在 08-07 白天那一版**（`main-20260807-190332` = main `99d83f7`）。
  三票**都没有上产**——票面写明「落 main 即止，统一上产由主 session 另行安排」。
  上产与 HITL 复验的两份回执仍是 `.issues/gap-design-0805/receipt-deploy-0807.md` 与
  `receipt-hitl-0807.md`；迁移 0012/0013/0014 已在生产库落地。
- 🔴 **迁移账（上产时按这个来）**：
  - **T9 需要 `0015_form_submissions_auto_key.sql`** —— 加一列 `auto_key` + 一条**部分**唯一索引
    `(context_id, auto_key) WHERE auto_key IS NOT NULL`。increment-only、可重放，
    `_ensure_schema()` 每次 bootstrap 自动重放，所以换容器即生效。
  - **T11 不需要**：新属性都在 `FormField` 上，而 `FormField` 是整块 jsonb 存在
    `form_templates.fields` 一列里。
  - **T10 不需要**：实体（人/项目/冲突）在 pg 侧同样是整块 jsonb，按 dataclass 字段名过滤写读，
    `provenance`/`archived` 本来就在往返里；新加的只有一个**读**方法 `is_ephemeral()`，
    读的是 `avery.contexts.ephemeral` 这个既有列。
  - 判据一句话：**动 dataclass 里被整块 jsonb 装着的字段 → 免迁移；动表的顶层列 → 必须迁移。**
- 🔴 **三票合的都是本地 main，没有 push**（`main...origin/main [ahead 14]`）。票面写的
  「落 main 即止」在这个仓库里必须理解成**不 push**：前端没有人工上产步骤，**push main 即自动
  构建上产**，推一下就等于把前端单独上了产、而后端容器还停在旧镜像。这一步留给统一上产
  那个 session：它要在**同一个窗口里** push + 换后端容器（见 What's Next 第 1 条）。

## 本轮做完的（2026-08-07 深夜 · T10 补资料，issue #59）

回执：`.issues/gap2-0807/receipt-T10-append.md`（逐条判据 + 变异账 + 拍板取舍 + 已知边界）。

**拆掉了「每次上传 = 新开一家公司」那堵墙。** 经理现在能给**当前这家公司**补资料：新文件并进来，
卡片安静更新到新读数、逐字段出处指向新资料，只有新旧对不上才走今天页那条双栏通道。
**没有砍半**——资料库、实体归并、卡片、出处、今天页五处一起接通（只进资料库不动卡片，
会让「证据过期了」那条提醒自己闭嘴，而卡片还挂着上个月的读数：那才是最难看的失败形态）。

- **新端点** `POST /team/{context_id}/files`：同一个 `authorize_context`（同体 404 无枚举），
  字节侧四道闸与 `/ingest` 逐条同一套。回执 = 与 `/team/{id}` 同一张 payload + 一个 `appended` 块；
  **不回传 owner_token**（凭据只在创建时交出去一次）。
  🔴 顺手补上了一个差点整个漏掉的洞：`upload_guard._GUARDED` 是**精确匹配**的字典，带路径参数的
  路由永远命不中它——不补分支的话新端点在 ASGI 边缘就是零防护（无限流、无 Content-Length 预检、
  无流式总量兜底），而处理器里的闸照旧生效，于是「看起来有闸」。
- **新模块** `avery/ingest/file_append.py`：照 `form_append` 的 `get → 原地 mutate → put` 范式，
  绝不新造 `CompanyContext`、绝不调 `ingest_paths`/`ingest_docs`（覆盖语义）。
  **只对新文件跑抽取**——LLM 花费与新文件成正比，不与资料总量成正比。
- **实体增量归并**（本票最重）：`merge_person_reading` docstring 里那四个坑逐条变成机制 + 判据
  （整表重写吞手编/软删/出处 · 旧冲突重复记账 · `held_src` 记错 · signals 换尺重筛）。
  人走 `PersonIndex`/`merge_person_reading` 扩展（加可选 `ledger`——账本在场时 `team` 成为合法载荷，
  **`PersonIndex` 规则 3.5 第一次真的够得着**）；项目**新写**了增量原语，并把合并规则提成
  `_absorb_project` 让两条路共用一份定义，顺带补了此前**根本不存在**的 `_disambiguate_project_ids`。
- **安静更新**落成一句可执行的话：**只有确凿知道新资料更新时才让新值顶掉旧值**，拿不准一律
  keep-first（与 `clear_stale_self_report` 同一条口径，时间只走全仓唯一那个 ISO 解析器）。
  顶掉之后逐字段出处写进 `provenance` 侧车（`origin='doc'`），前端 `provenanceBadgeKind` 加第四态，
  详情浮层显示「读自〈本周周报.md〉」——`'doc'` 出处只有补传改写过才存在，所以这个角标出现的地方
  **恰好就是**「这个读数被更新的资料顶掉过」。
- **前端**：资料库屏第②段拆成两个动作（「给这家公司补资料」/「另建一份画像」），
  `againTitle`/`againBody` 跟着改口（以前「合并」根本不存在，说「不会并进」是全部真相；
  现在存在了，再说同一句就是把经理往错的按钮上引）；`UploadPanel` 加 `mode` 而不抄第二份
  （`ACCEPT` 那行只许有一把尺）；store 的 `appendFiles` 走**自己的**状态机（借 `ingestStatus`
  会发一条假的「你的团队已就绪」）。
- **demo 克隆先禁入口**（票面边界）。判据是后端**每帧都发**的 `ephemeral`，不是只在领取首帧出现的
  `demo`——后者刷新一次就没了，入口会自己冒出来。为此给两个 registry 适配器 + Protocol 各加了
  `is_ephemeral()`，读的是 GC 用的同一个标记。

### 🔴 变异测试翻出来的一个门洞（不是代码 bug）

「把补资料那个口子接错线、其实调的还是 `uploadFiles`」这条前端变异**第一轮活了下来，0 红**——
因为 story 门当时**直接调 store**，根本没碰过那个按钮。本票交付的东西就是那个入口，
判据必须落在它身上。门已改成走真界面（`page.setInputFiles('.lite-files-append input.upload-input', …)`），
补杀 9 红。**教训：门驱动的是 store 还是真部件，决定了它能不能看见「接线」这一类 bug。**

顺带把门里的 `settle()` 改成超时不抛、而是记一条会说话的 FAIL：接错线时状态机永远停在 `idle`，
裸 `waitForFunction` 会等满超时把整道门炸掉——炸掉也算红，但读日志的人看到的是一条 playwright
堆栈，而不是「这个口子接错线了」。

## 上两轮做完的（同日 · 回执里有全部细节，这里只留会影响下一个人的那几句）

- **T9 站内主动（#58）** —— 回执 `.issues/gap2-0807/receipt-T9-forms-proactive.md`。
  进新周期后经理一打开表单区，本期链接已按上期名单备好；铃铛长出 `'form'` 通知；今天页长出
  「本期还差 N 人没交」（规则表里**第一条不是关于项目的规则**）。幂等靠**两把不同的锁**
  （读侧「他已经手动铸过」+ pg 部分唯一索引挡真并发）；手动铸链一个字节没动。
  「去调整」= 新端点 `POST .../forms/submissions/{id}/void`，作废是把到期时刻拨到此刻**不删行**。
- **T11 模板拼装器（#60）** —— 回执 `.issues/gap2-0807/receipt-T11-form-builder.md`。
  经理能自己建表（从零拼 / 照内置周报改 / 让 Avery 读旧表格起草）；新增 `yesno` 与「1~5 分」；
  自述回流从「认 label 文案的正则」换成 `FormField.self_report` 结构化标记；
  已被答过的 `field.id` 禁改禁删（前端上限镜像 + 服务端 `gate_used_fields` 是**两道独立的锁**）。
  顺带修掉一条从 T5 起就埋着的静默 bug：`save_form` 回建 `FormField` 时漏传 `situational`。

## What's Next（按优先级）

1. **统一上产**（票面：落 main 即止，上产由主 session 安排）。
   🔴 **push 与换后端容器必须在同一个窗口里做**：前端 push main 即自动构建上产。
   先 push 再慢慢换后端，中间那段线上就是「新前端 + 旧后端」，三票各自的坏法都不一样：
   T10 的「补资料」按钮在、端点 **404**；T11 的拼装器入口在、`yesno` 被老后端 422、
   `draft-from-file` 404；T9 的自动补铸与撤回都 404，而横幅/铃铛/今天页那条规则**永远不出现**
   （看起来像功能没做）。**这不是残缺功能，是上到一半的产。**
   ⚠ 换容器时 **0015 必须落地**（`_ensure_schema()` 自动重放）；上产后**先设 `AVERY_PUBLIC_BASE`**
   再验表单，否则铸出来的链接指向生产域名之外的默认值。
2. **Danny 用户视角端到端演习**（三票上产之后）：从零自己开一个新工作区走全程，
   记录「卡在哪、哪一步不知道该点哪」当清单，演习后再定修哪些。
3. **T8 留的两条记录还在桌上**（只记录未改，等拍板）：
   ① 议事室引用编号是 `facts.md:<行号>` 而非客户自己的文档名；
   ② 今天页证据行是 `字段="值"` 的机器形状（ADR-0033 明定）。
4. **给 `/health` 加一行版本字段**（镜像 tag 或 commit）：现在「生产跑的是哪个 commit」外部不可核。
5. carry-over：r2 未开票发现（`.issues/sweep/2026-08-02-r2.md`）· gate-run 迁移（aria-zh/cr-alignment）·
   files-hub #26–#29 · 换血抢救 #31/#32 · v01 退役 #33 · 真机零覆盖（iOS/微信，最高优）·
   成本票 #30 等真实客户量 · 真 brain 分流取证（要先给口径）· 全量 feat-063。

## Notes（本轮顺手发现，没顺手修）

- **markdown 表格外侧带竖线时 roster 解析器抽不出人**：`| 姓名 | 部门 |`（首尾都有竖线）零命中，
  `姓名 | 部门`（只有内侧竖线）正常。写 T10 语料时实测到的。客户真实路径多是 xlsx/csv 所以没顺手改，
  但「把表格复制成标准 markdown 再传」是个很自然的动作，值得单独一票。
- **粒度闸够不着跨批次**：`granularity.apply_gate` 会 `res.projects = keep`，所以补传路只能对
  **新批次**跑闸（把整份 extraction 连同单份新文档喂给它 = 拿一个缺了源文档的 docs 集合重判每一张
  老卡，那是整表静默删除）。代价：「新文档里的一条里程碑其实属于一个**存量**项目」这种误判挡不住。
  宁可漏，已写在 `file_append.py` 的碑上。
- **`role`/`tenure` 两份资料说法不同时，两条路今天都不记冲突**（`_CONFLICT_FIELD_ALLOWLIST` 人侧
  只有 `team`）。补传路让它们安静更新——拍板③要的就是这个，但「对职位说法不同」今天仍然零记录。
  既有边界，本票没扩大也没收窄。

## Blockers / Risks

- 无硬 blocker。
- 🟠 **别单独 push main**：前端 push 即自动上产、后端容器要人手换。三票各自的「上到一半」
  长什么样见 What's Next 第 1 条。两件事同窗口做。
- 🔴 **在 worktree 里重冻像素＝没重冻**：`__snapshots__/` 是 gitignore 的单机产物、每 worktree
  一份。新 worktree 第一次跑像素门是 40 张「没有基线」全写入（playwright 报 exit 1）——
  那**既不是漂移红也不是绿**。真比对只在主检出上有意义；红了先比 mtime 再谈漂移。
- 🔴 **像素门不密闭：后端够不着 → `home` 先红 → 你要看的那几屏根本没被采样**（T10 实收）。
  spec 走 `?transport=stub`，但 stub **切不掉「探测后端能力」那一路**：`/demo/status` 打不通时
  首页那张「用一份示例团队先看看」整卡消失 → `home` 就地漂移 → 一个 test 里串跑 10 屏，
  **第一处不匹配即中止**，`files` 两张压根没生成。
  症状很像「上一票把首页改坏了」，实际是环境。跑像素门前的三件套：**dist 用
  `VITE_AVERY_API_BASE=<你的口>` 重打** + 那个口上真有后端（带 `AVERY_DEMO_SEED_DIR`）+
  `AVERY_CORS_ORIGINS` 放行 preview 的 origin。判定方法：把 src 回退到上一票再跑一遍——
  还红就是环境，不是你的改动。
- 🔴 **门驱动 store 还是驱动真部件，决定它能不能看见「接线」型 bug**（T10 的变异翻出来的）。
  凡是「新加了一个入口」的票，判据必须落在那个入口本身上，不能只调它背后的 action。
- 🔴 **`_GUARDED` 这类精确匹配的路由表，带路径参数的新端点永远命不中**。新开写端点时先问一句
  「边缘那层闸认不认得它」——认不得的话处理器里的闸照旧生效，于是「看起来有闸」，
  而限流/总量兜底整层是空的。
- 🟠 **门的环境缺一样就以「像回归」的形态假红**，两轮实收四条，都翻到失败断言本身才定性：
  ① `onboard-gate` 缺 `AVERY_DEMO_SEED_DIR`（要指 `tests/fixtures/demo-seed`，不是 `fixtures/seed`）
     →「示例团队门不在场」；
  ② `onboard-gate` 的 `API` 常量**写死** `127.0.0.1:8137`、只认 `VERIFY_API` 覆盖 → 隔离端口下
     它会去打**另一个 session 的后端**，红成「后端笔记本最新一条不对」；
  ③ `form-builder` 缺 `AVERY_PUBLIC_BASE` → 铸出来的链接指向**生产域名**，门跑去生产查一个不存在
     的 token，红成「链接不存在」；
  ④ `null-owner` 源码写死 `127.0.0.1:5173` 不吃 `VERIFY_BASE` → 隔离端口上恒 CONNECTION_REFUSED。
  起门环境的最小清单：`AVERY_BRAIN=mock` + `AVERY_EXTRACTOR=heuristic` + `AVERY_EMBEDDINGS=keyword`
  + `AVERY_DEMO_SEED_DIR` + `AVERY_PUBLIC_BASE` + `AVERY_CORS_ORIGINS`；跑门时 `VERIFY_BASE`
  **和** `VERIFY_API` 都要给。
- 🔴 **脚本落盘的「会话/状态」文件默认当凭据看**：规则已收紧为 `.issues/**/.hitl-session*.json`。
  **先写 .gitignore 再写脚本**。
- ⚠ **提示词里的约束不是判据**：模型会不听。凡是「只有满足 X 才准输出 Y」的规矩，落地层必须有
  一道能对着**文档原文**验的闸。
- ⚠ **belt-and-braces 会让内层规则免疫变异**：两把锁必须是两道**独立**的门，否则其中一条规则
  被换掉时另一把锁会替它挡住变异，你只会看到一片绿（T11 的 M3 就是这么活下来一半的）。
- 🔴 **stale uvicorn 按端口杀**（`Get-NetTCPConnection -LocalPort <口> -State Listen` → `Stop-Process`），
  别信 ps 信行为；各 session 结束清自己起的端口。
  ⚠ 但**只清自己起的那几个口**：T9 收尾时一个循环把 5173 上一个**不是自己起的** preview 一起杀了
  （另一个 session 的，随后 8137 也没了）。无数据损失、重启即可，但那不是该动的东西。
  同族：`PgRegistry._schema_ready` 是实例级缓存——换库不重启后端＝迁移不重放。
- 🔴 **`vite preview` 默认只绑 `::1`**：起 preview 一律加 `--host`（裸 `--host`，不写 127.0.0.1）。
- 🔴 **本机 Docker PG 容器时钟来回跳 ~115s**：`created_at < now()` 判据间歇假红；
  写测试别赌墙上时钟（T10 的语料一律显式给 `uploaded_at`）。
- 🔴 **本机 curl / argv / stdout 都按 GBK 啃中文**：中文只走 heredoc / `--input` 文件 / 写进文件再跑；
  中文 commit message 一律 `git commit -F <文件>`；带中文的 python 脚本要
  `sys.stdout.reconfigure(encoding='utf-8')`，subprocess 捕获要显式 `encoding='utf-8'`。
- 🔴 `e535ec9` commit message 是错的（真相在 `03a9824` erratum）；rebase 与否归 Danny。
- 🔴 repo 级 stash 两条别人的存货（`stash@{0}`/`stash@{1}`）；处置归 Danny。
- 多个战役 worktree 仍挂着（22 个，含 gap2 三条）——删分支/worktree 属删除闸，归 Danny。
- ⚠ 本机残留：Docker 库 `t8e2e`（T8 自检专用）；`teammaster-postgres-1` 容器在运行态。
- ⚠ **各票收尾必须重写本文件**，这是 AGENTS.md 的 DoD，不是可选项。
