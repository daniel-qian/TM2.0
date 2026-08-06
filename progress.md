# Session Progress Log

> 📢 本文件是**当前状态快照，整体重写不追加**。历史都在 git（`git log` + 各 `.issues/*/receipt*.md`），别在这儿堆编年史。
> 启动路径见 `AGENTS.md` Startup Workflow：读本文件 + `feature_list.json`，跑 `./init.sh` 确认绿，再开工。

**Last Updated:** 2026-08-06（差距战役 T1 常驻表单后端落地合 main）

## Current State

- **git**：`main` 带上了 T1（常驻表单后端）。0805 的五票 #45–#49 早已推平 origin。
- **验证账实**：后端离线套 **3609 passed / 99 deselected / 4 xfailed**（T1 新增 65 条）；
  needs_db 层 T1 新增 **18 条全过**（本地 throwaway 库 `avery_t1form_test`，已 drop）；
  前端全电池上一轮 **A 25/25 · B 3/3 · C 3/3 全绿**（T1 无前端面，未重跑）；像素基线未动。
- **⚠ 生产仍未部署**：后端容器仍是 `main-20260805-160609`，前端 Vercel 仍是 `89b36e4` 构建。
  待上线的两批：#45–#49（0805，含迁移 0012）+ T1（含迁移 **0013**）。两个迁移都由
  `_ensure_schema` 幂等重放，Supabase 首次 boot 自动建表，**不需要人工执行 SQL**。
  前端只需为 #45–#48 重建 Vercel；T1 没有前端面。
- ⚠ **既有的一条真库红，不是新引入的**：`test_registry_contract.py::
  test_sweep_respects_the_batch_limit[postgres]` 在整轮 `-m needs_db` 里红。已用 `git archive HEAD`
  干净副本同条件复现做过归属判定（详见 `.issues/gap-design-0805/session-handoff-T1.md`）。
  根因：`sweep_ephemeral` 子查询的 `LIMIT` 没有 `ORDER BY`（`pg_registry.py:576-584`）。

## 本轮做完的（2026-08-06 · 差距战役 T1 · 常驻表单后端，feat-097）

一句话：**「内置常驻表单收集信息」这句对客承诺，后端半程从话术变成真部件——经理建模板、
给某一个人铸一条 `/f/<token>` 链接、员工手机免登录填完提交、库里有。**

- 迁移 **0013**：`avery.form_templates` + `avery.form_submissions`。**不复用 `avery.asks`**
  （它的 status 六词 CHECK / 题型只有 scale|yesno / MAX_QUESTIONS=3 / 一次性 draft→shared
  状态机，四处都被红线门钉死；迁移目录 increment-only，改它等于重写快问的门）。
- 渲染改成**字段描述驱动**（`kind → 渲染函数`表：text/choice/number），这是后续 A2/A3 不重写
  渲染层的前提。题型与渲染函数对不上则服务端**起不来**——宁可起不来，不许页面静默少一格。
- 内置「周报」六格：前四格 label 与 `scripts/make-intake-xlsx.py` 的 06 表表头**逐字一致**
  （客户手里已经有那张 xlsx），必填记号跟着表头的 `*` 走；后两格负载/情绪自述按 T5 要的形状
  备好（三个情绪选项正是解析层词表三个桶的头一个词，1:1 映射）。两侧任一漂移由
  `test_form_intake_06_contract.py` 逐字对峙，**那道门做过变异测试、三处变异各自打红在正确的断言上**。
- 员工侧复用快问那张 H5 壳（提取成 `service/h5.py` 共用，ask 侧渲染字节不变）：免登录、
  单人单链、7 天过期、透明三件套在 DOM、零外部资源、答一次锁。
- 🔴 **头号纪律自证**：表单只是与上传文件平权的又一路数据源。本票只做到提交落库，**没有**碰
  `source_documents`/`materials`/`extraction` 任何一层——curl 回执第 7 步直接查库：走完全链后
  `source_documents` 仍是 1 行。「提交进资料」是 **T2** 的活。
- 证据：`.issues/gap-design-0805/`（`session-handoff-T1.md` 交接与已知局限 ·
  `curl-chain-T1.sh` 可复跑 · `curl-transcript-T1.txt` 逐字回执）。

上一轮（0805 晚 · Danny 截图走查五票 #45–#49：屏底家具 `6e95b84` · 团队页重构 `c727e97`+ADR-0034 ·
LiteComposer 退役 `7b03982` · 卡面快问 `a69a405` · 问答持久化 `9990dda`）细节见 git log 与
`feature_archive.json`，此处不再复述。

## What's Next（按优先级）

1. **差距战役接着点票**（`.issues/gap-design-0805/tickets.md`）：**T1 已合 main**，所以
   **T2（表单提交进资料，含必修的 `_material_vectors` 向量复用——不修上线即漏钱）现在可开**；
   T2 合 main 后再开 T3（资料库前端第④段）与 T5（回流人卡）。T4/T6 一直可与主线并行。
2. **#45–#49 + T1 前后端上生产**：从 main 构建新容器 swap（迁移 0012/0013 幂等自动建表；
   env 快照照旧从在跑容器提取）+ Vercel 重建（前端只为 #45–#48，T1 无前端面）。回执落 `.issues/`。
3. **r2 剩下的未开票发现**（`.issues/sweep/2026-08-02-r2.md`，按屏分好了）。
4. **gate-run 迁移继续**：`verify-aria-zh` / `verify-cr-alignment` 仍未迁（形状不兼容，要先扩
   makeRec）。已迁/未迁一律用自查命令数。
5. **files-hub 独立票 #26–#29** · 换血抢救票 #31/#32 · v01 退役成本账 #33（ready-for-human）。
6. **UI 线**：🔴 真机零覆盖（iOS Safari / 微信内置）优先级最高；断点动物园。
7. **成本票 #30** 等真实客户量；**真 brain 分流取证**仍未跑（要先给口径）。
8. backlog：全量 feat-063（多会话 tab + 对话流视图）——#49 刻意收窄，历史抽屉先用着。

## Blockers / Risks

- 无硬 blocker。
- 🔴 **stale uvicorn 会咬人**（0805 那轮 #49 端到端首跑就栽过：8137 上跑着 session 开始前的
  旧后端）。可靠杀法（比杀全体 python 精准）：`Get-NetTCPConnection -LocalPort <口> -State Listen`
  拿 OwningProcess → `Stop-Process`。**别信 `ps`，信行为。** 各 session 结束前把自己起的端口清掉。
  ⚠ 同一族陷阱：`PgRegistry._schema_ready` 是实例级缓存 —— 换了库不重启后端，迁移不会重放，
  表现是「relation does not exist」而不是任何有用的报错（T1 取证时真踩过一次）。
- 🔴 **`e535ec9` 的 commit message 是错的**（已 push；真相在 `03a9824` erratum）。要不要 rebase 归 Danny。
- 🔴 **repo 级 stash 里躺着两条别人的存货**（`stash@{0}` feat-061 briefing i18n 留档、
  `stash@{1}` 旧 worktree WIP）。处置（drop/转分支）归 Danny。
- 六个 worktree 仍挂着——删分支/worktree 属删除闸，归 Danny。
- Docker Desktop 是 needs_db 用的（本 session 又拉起过一次）；throwaway 库
  `avery_run49_test` / `avery_t1form_test` / `avery_sweep_probe` / `avery_pristine_probe` 均已
  drop，`teammaster-postgres-1` 容器留在运行态。
- ⚠ `verify-null-owner` 偶发假红条目保留观察；0805 那轮真红是采样面搬家，已修门后 15/15。
- 🔴 **`test_sweep_respects_the_batch_limit[postgres]` 在整轮 needs_db 里红，且是既有问题**
  （已用 `git archive HEAD` 干净副本同条件复现做归属判定，非 T1 引入）。根因：
  `sweep_ephemeral` 子查询 `SELECT ... LIMIT %s` 没有 `ORDER BY`（`pg_registry.py:576-584`），
  库里有多条 ephemeral 候选时删哪几条由 PG 自由决定，而该测试假定删的正是它刚造的那三个克隆。
  单跑（空库）恒绿、整轮跑就串味。修法：子查询补确定性排序，或让测试只在自己的前缀里断言。
- ⚠ **本机 curl 把 argv 里的中文按 GBK 编**（实测「如常」→ `%C8%E7%B3%A3`，UTF-8 应是
  `%E5%A6%82%E5%B8%B8`）。用 curl 打中文表单/JSON 时，中文只走 heredoc（stdin 不过代码页转换），
  预先 percent-encode 成纯 ASCII 后才允许进 argv——写法照抄
  `.issues/gap-design-0805/curl-chain-T1.sh` 的 `encode_body`。**不照做会得到一片假红。**
