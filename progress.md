# Session Progress Log

> 📢 本文件是**当前状态快照，整体重写不追加**。历史都在 git（`git log` + 各 `.issues/*/receipt*.md`），别在这儿堆编年史。
> 启动路径见 `AGENTS.md` Startup Workflow：读本文件 + `feature_list.json`，跑 `./init.sh` 确认绿，再开工。

**Last Updated:** 2026-08-08（演习批第一票 **#61 落 main**：GFM 外框竖线不再静默吞表；
#64/#63 仍在各自 AFK session 里，三票齐后复演；仍未 push、未上产）

## Current State

- **git**：`main` = 差距战役 #50–#57 八票 + gap2 三票（T11 #60 / T9 #58 / T10 #59）+
  演习批 **#61**（回执 `.issues/rehearsal-0808/receipt-61-md-table-frame.md`；gap2 回执在
  `.issues/gap2-0807/`）。`main...origin/main [ahead 19]`，**没有 push**（见 Blockers）。
- **验证账实（#61 合 main 时在其 worktree 实测）**：
  后端离线全套 **3956 passed / 115 deselected / 4 xfailed / 0 failed**
  （= gap2 基线 3927 + #61 新门 29，零既有测试移动）；
  `./init.sh` typecheck 0 errors + build ✓。#61 零前端改动，前端电池/像素基线**没有动**，
  上一次全量实测仍是 gap2 三票合完那轮（A 28/28 · B 37/37 · C 3/3 · 像素 40 张零红、
  i18n 976 叶子键孤儿 0）——**#63/#64 合 main 时要按它们自己的票面重跑前端侧**。
  `@needs_db` 上一次全量 106 passed（gap2 轮，#61 零持久层改动不触发）。
- **✅ 生产仍停在 08-07 白天那一版**（`main-20260807-190332` = main `99d83f7`）。
  演习批与 gap2 三票**都没有上产**——统一上产由主 session 另行安排（What's Next 第 3 条）。
  上产/HITL 回执仍是 `.issues/gap-design-0805/receipt-deploy-0807.md` 与 `receipt-hitl-0807.md`；
  迁移 0012/0013/0014 已在生产库落地。
- 🔴 **迁移账（上产时按这个来）**：
  - **T9 需要 `0015_form_submissions_auto_key.sql`**——加一列 `auto_key` + 部分唯一索引
    `(context_id, auto_key) WHERE auto_key IS NOT NULL`。increment-only、可重放，
    `_ensure_schema()` 每次 bootstrap 自动重放，换容器即生效。
  - **T11 / T10 / #61 都不需要**：T11 的新属性在 `FormField`（整块 jsonb）；T10 动的是
    dataclass 字段 + 一个读方法；#61 纯解析逻辑零持久层。
  - 判据一句话：**动 dataclass 里被整块 jsonb 装着的字段 → 免迁移；动表的顶层列 → 必须迁移。**
- 🔴 **合的都是本地 main，没有 push**。「落 main 即止」在这个仓库里必须理解成**不 push**：
  前端 push main 即自动构建上产，推一下就等于把前端单独上了产、而后端容器还停在旧镜像。
  push + 换后端容器必须在统一上产那个 session 的**同一个窗口里**做（What's Next 第 3 条）。

## 本轮做完的（2026-08-08 · #61 花名册吃下标准 markdown 表格）

回执：`.issues/rehearsal-0808/receipt-61-md-table-frame.md`（修法取舍 + 门清单 + 变异账 + 已知边界）。

**`| 姓名 | 部门 |`（首尾带边框竖线的 GFM 标准表格）从「0 人零报错」修到与内侧竖线同等命中。**
新帮手 `_strip_table_frame`：**行首第 0 列就是竖线**才算边框，首尾各剥一根；表头/数据行/自述
三处同一把尺。判据落在第 0 列而不是 lstrip 后，是因为 docx/xlsx/csv 三个生产者的
`" | ".join` 在**首格为空**时会产出 ` | 客房部经理 | …`（空格开头）——这种行必须继续被丢弃，
否则名字形状的岗位值顶进 cells[0] 就是 feat-039「No.」那类幽灵人卡。剥框对三个生产者
构造上是 no-op，`join` 那一侧零改动。门是**双向**的：正向五变体逐字段全等 + 反向
「生产者永不顶格发竖线、空首格行不长幽灵」不变量；四条变异（拆帮手/只修数据行/只修表头/
不修自述腿）分别 17/4/5/4 红后还原。已知边界：缩进的 GFM 表格照旧不认（与 join 产物
字节不可区分，宁可漏）。顺带修了 `form_append.py:54` 引用不存在函数名的注释。

## 上几轮做完的（详情全在各自回执，这里只留会影响下一个人的）

- **T10 补资料（#59）**——回执 `.issues/gap2-0807/receipt-T10-append.md`。
  「每次上传=新开一家公司」的墙拆了：`POST /team/{context_id}/files` 增量并资料，
  实体增量归并（keep-first、确凿更新才顶掉、`provenance` 侧车 `origin='doc'` 第四态角标），
  demo 克隆按 `ephemeral`（每帧都发）禁入口。🔴 顺手补的洞：`upload_guard._GUARDED` 是
  **精确匹配**字典，带路径参数的路由永远命不中——新写端点先问「边缘那层闸认不认得它」。
  🔴 它的变异还翻出一课：**门驱动 store 还是真部件，决定它能不能看见「接线」型 bug**——
  「新加入口」的票，判据必须落在入口本身。
- **T9 站内主动（#58）**——回执 `receipt-T9-forms-proactive.md`。进新周期自动备好本期链接、
  铃铛 `'form'` 通知、今天页「还差 N 人没交」；幂等靠两把**独立**的锁（读侧判重 + pg 部分唯一
  索引）；撤回=拨到期时刻不删行。
- **T11 模板拼装器（#60）**——回执 `receipt-T11-form-builder.md`。经理自建表（从零/照抄/AI 起草）、
  `yesno` + 1~5 分、自述回流走 `FormField.self_report` 结构化标记；已答字段禁改禁删是
  前后端两道独立锁。顺带修了 `save_form` 漏传 `situational` 的静默 bug。

## What's Next（按优先级）

1. **演习批剩两票（#64/#63）做完**（每票一个 AFK session；#61 已落 main）：
   **#64** 议事室 @ 引用回归（拍板：一步到位结构化——refs 进契约、被引实体读数保证进上下文；
   考古：@ 引用是 story 壳 TeamComposer 的，lite2 替身在 #47/`7b03982` 退役时没搬，功能自
   07-22 丢失）· **#63**「值得注意」并进「今天」退 tab（浅合）。
   ⚠ 两票都动今天页/议事室一带——**合 main 串行、后合的在主检出重冻像素**（#61 没动前端，
   不占这个序）。
2. **复演**（三票齐后，本地）：环境随起随用——`preview_start rehearsal-api / rehearsal-web`
   （launch.json 两条配置在，本地未提交；后端脚本 `.issues/gap2-0807/rehearsal-api.ps1`）。
   库 `rehearsal0808`（本地 Docker PG）数据保留；**脑已切真 MiniMax**（0808 Danny 拍板），
   抽取/检索仍离线免费。第 1 轮已验：上传→表单区→铸链→员工填→快问全链本地能走。
   复演时顺手验：**把演习用的花名册转成标准 markdown 表格再传一遍**（#61 的真实触发动作）。
3. **统一上产**（连同 gap2 三票 + 演习批一起）。
   🔴 **push 与换后端容器必须在同一个窗口里做**：前端 push main 即自动构建上产。
   先 push 再慢慢换后端，中间那段线上就是「新前端 + 旧后端」：T10 补资料按钮在、端点 404；
   T11 拼装器入口在、`yesno` 被老后端 422；T9 自动补铸/撤回 404 且横幅永不出现。
   **这不是残缺功能，是上到一半的产。**（#61 是后端解析，旧前端+新后端方向无害。）
   ⚠ 换容器时 **0015 必须落地**（`_ensure_schema()` 自动重放）；上产后**先设
   `AVERY_PUBLIC_BASE`** 再验表单。
4. **T8 留的两条记录还在桌上**（只记录未改，等拍板）：① 议事室引用编号是 `facts.md:<行号>`
   而非客户文档名；② 今天页证据行是 `字段="值"` 的机器形状（ADR-0033 明定）。
5. **给 `/health` 加一行版本字段**（镜像 tag 或 commit）：「生产跑的是哪个 commit」外部不可核。
6. carry-over：r2 未开票发现（`.issues/sweep/2026-08-02-r2.md`）· gate-run 迁移（aria-zh/cr-alignment）·
   files-hub #26–#29 · 换血抢救 #31/#32 · v01 退役 #33 · 真机零覆盖（iOS/微信，最高优）·
   成本票 #30 等真实客户量 · 真 brain 分流取证（要先给口径）· 全量 feat-063。

## Notes（顺手发现，没顺手修）

- **粒度闸够不着跨批次**：`granularity.apply_gate` 会 `res.projects = keep`，所以补传路只能对
  **新批次**跑闸。代价：「新文档里的一条里程碑其实属于存量项目」挡不住。宁可漏，
  碑在 `file_append.py`。
- **`role`/`tenure` 两份资料说法不同时，两条路都不记冲突**（`_CONFLICT_FIELD_ALLOWLIST` 人侧
  只有 `team`）。既有边界，T10 没扩大也没收窄。
- **`_people_from_roster` 的位置兜底会顶掉空格子**（#61 测试时看清的既有怪癖）：表头列序非默认时,
  `col.get(k) or cells[n]` 里空串是 falsy，位置兜底不 inert。framed/unframed 逐字节一致，
  与 #61 无关；将来要不要改成「表头说话就绝对信」单独裁。

## Blockers / Risks

- 无硬 blocker。
- 🟠 **别单独 push main**（`ahead 19`）：前端 push 即自动上产、后端容器要人手换，两件事同窗口做。
- 🔴 **在 worktree 里重冻像素＝没重冻**：`__snapshots__/` 是 gitignore 的单机产物、每 worktree
  一份。新 worktree 首跑是 40 张「没有基线」全写入——既不是漂移红也不是绿。真比对只在主检出上
  有意义；红了先比 mtime 再谈漂移。
- 🔴 **像素门不密闭：后端够不着 → `home` 先红 → 你要看的那几屏根本没被采样**。stub 切不掉
  「探测后端能力」那一路：`/demo/status` 打不通 → 首页示例团队整卡消失 → `home` 就地漂移 →
  串跑首处不匹配即中止。跑像素门前三件套：dist 用 `VITE_AVERY_API_BASE=<你的口>` 重打 +
  那个口上真有后端（带 `AVERY_DEMO_SEED_DIR`）+ `AVERY_CORS_ORIGINS` 放行 preview origin。
  判定法：src 回退上一票再跑——还红就是环境。
- 🔴 **门驱动 store 还是真部件，决定它能不能看见「接线」型 bug**。「新加入口」的票，
  判据必须落在入口本身。
- 🔴 **`_GUARDED` 这类精确匹配路由表，带路径参数的新端点永远命不中**——新写端点先问
  「边缘那层闸认不认得它」。
- 🟠 **门的环境缺一样就以「像回归」的形态假红**（两轮实收四条：seed 目录/写死 API 口/缺
  `AVERY_PUBLIC_BASE`/写死 5173）。起门最小清单：`AVERY_BRAIN=mock` + `AVERY_EXTRACTOR=heuristic`
  + `AVERY_EMBEDDINGS=keyword` + `AVERY_DEMO_SEED_DIR` + `AVERY_PUBLIC_BASE` + `AVERY_CORS_ORIGINS`；
  跑门时 `VERIFY_BASE` **和** `VERIFY_API` 都要给。
- 🔴 **脚本落盘的「会话/状态」文件默认当凭据看**（`.gitignore` 已含 `.issues/**/.hitl-session*.json`）。
  **先写 .gitignore 再写脚本**。
- ⚠ **提示词里的约束不是判据**：「只有满足 X 才准输出 Y」的规矩，落地层必须有对着**文档原文**
  验的闸。
- ⚠ **belt-and-braces 会让内层规则免疫变异**：两把锁必须是两道**独立**的门。
- 🔴 **stale uvicorn 按端口杀**（`Get-NetTCPConnection -LocalPort <口> -State Listen` →
  `Stop-Process`），别信 ps 信行为；**只清自己起的那几个口**。同族：`PgRegistry._schema_ready`
  是实例级缓存——换库不重启后端＝迁移不重放。
- 🔴 **`vite preview` 默认只绑 `::1`**：一律加裸 `--host`。
- 🔴 **本机 Docker PG 容器时钟来回跳 ~115s**：`created_at < now()` 判据间歇假红；语料显式给时间戳。
- 🔴 **本机 curl / argv / stdout 都按 GBK 啃中文**：中文只走 heredoc / `--input` 文件 / 写文件再跑；
  中文 commit message 一律 `git commit -F <文件>`；python 要 `sys.stdout.reconfigure(encoding='utf-8')`。
- 🔴 `e535ec9` commit message 是错的（真相在 `03a9824` erratum）；rebase 与否归 Danny。
- 🔴 repo 级 stash 两条别人的存货（`stash@{0}`/`stash@{1}`）；处置归 Danny。
- 多个战役 worktree 仍挂着（25 个上下，含 gap2 三条与演习批）——删分支/worktree 属删除闸，归 Danny。
- ⚠ 本机残留：Docker 库 `t8e2e`、`rehearsal0808`；`teammaster-postgres-1` 容器在运行态。
- ⚠ **各票收尾必须重写本文件**，这是 AGENTS.md 的 DoD，不是可选项。
