# Session Progress Log

> 📢 本文件是**当前状态快照，整体重写不追加**。历史都在 git（`git log` + 各 `.issues/*/receipt*.md`），别在这儿堆编年史。
> 启动路径见 `AGENTS.md` Startup Workflow：读本文件 + `feature_list.json`，跑 `./init.sh` 确认绿，再开工。

**Last Updated:** 2026-08-06（差距战役 T1–T7 七票全收官合 main；T8 自检票已开）

## Current State

- **git**：`main` = `origin/main` = `403910a`（T3 收官合并）。差距战役 #50–#56 七票全在 main。
  ⚠ 本轮有过一次「T3 从自己 worktree 推 origin、主检出 main 落后」的分叉，已快进对齐——
  各 session 收尾时**把主检出也快进到位**，别让下一个人对着旧 main 做判断。
- **验证账实（403910a 基线，主会话 0806 实测）**：后端离线全套 **3776 passed / 107 deselected /
  4 xfailed**（74s，零红）；needs_db 全套 91/0（T1 根治时钟 flake 后）+ 各票增量全绿；
  前端电池 A 25/25 · B 3/3 · C 3/3 + 像素 40 张（T3 重冻其中 4 张 files）——
  ⚠ 但 A 区对 T3 新区**零覆盖**（T3 用 probe 实测过），资料库·常驻表单区的真门是
  `t3-story.mjs`（27 判据 × zh/en × paper/aurora 四组全绿）；i18n 892 叶子键孤儿 0。
- **⚠ 生产未部署，欠账已攒大**：后端容器仍 `main-20260805-160609`；前端 Vercel 构建
  T1 交接记录说 `89b36e4`、但 0805 晚主会话实测线上是 `fa8d085`——**上产前先核实线上真实版本**。
  待上线：#45–#49 + 差距战役 T1–T7（迁移 0012/0013 由 `_ensure_schema` 幂等重放，
  Supabase 首次 boot 自动建表，不需要人工 SQL）。**统一上产安排在 T8 绿了之后、HITL 之前。**

## 本轮做完的（2026-08-06 · 差距战役 T1–T7 全收官，feat-097~102）

两句对客承诺从话术变成真部件（PRD 与拍板：`.issues/gap-design-0805/design-options.md` + `tickets.md`）：

- **线一·常驻表单**：T1 库表+员工免登录 H5（#50）→ T2 提交进资料·统一数据契约 +
  `_material_vectors` 只嵌增量（#53）→ T3 资料库「常驻表单」区·铸链·谁交了（#54）→
  T5 回流人卡/项目卡·工号归并·模仿攻击门（#55）。
- **线二·交叉对比**：T4 时间轴 R-STALE-EVIDENCE（#51）→ T6 归并记冲突 conflicts 落库（#52）→
  T7 两条同级规则上今天页·双栏对照·「可能只是叫法不同」出口（#56，R-FRESH-CONTRADICTS-STALE
  由 #51 移交至此）。
- 各票交接/回执/截图全在 `.issues/gap-design-0805/`（session-handoff-T1~T7 等）；
  值得抄的工程动作：T6 先钉死 `_dedupe_entities` 再动、T1 变异测试门、T2 变异取证 5/5、
  T3 自建 story 门补 A 区盲区、T5 模仿攻击门。

## What's Next（按优先级）

1. **T8（#57）·AFK 全链端到端循环自检**：本地真栈把两句承诺当整体考，自跑自验自修到连续两轮
   零新发现（票面见 `tickets.md` §T8 与 issue #57）。**跑完出 go/no-go 才进下一步。**
2. **统一上产**：#45–#49 + T1–T7 一把上（先核实线上前端真实版本；后端从 main 构建容器 swap3、
   env 快照从在跑容器提取；迁移幂等自动建表）。回执落 `.issues/`。
3. **HITL 端到端轮**（Danny 回主会话）：生产上走「建模板→手机填周报→资料进库→议事室引用→
   人卡更新→今天页时间/冲突条目」全链 + 重截全套截图（团队页/今天页已改版，0805 走查截图过时）。
4. **三亚 demo 脚本更新**（碰头在下周）：新能力进 demo 主线，快问改为现场新建（旧 ask 死链不自愈）。
5. carry-over：r2 未开票发现（`.issues/sweep/2026-08-02-r2.md`）· gate-run 迁移（aria-zh/cr-alignment）·
   files-hub #26–#29 · 换血抢救 #31/#32 · v01 退役 #33 · 真机零覆盖（iOS/微信，最高优）·
   成本票 #30 等真实客户量 · 真 brain 分流取证（要先给口径）· 全量 feat-063。

## Blockers / Risks

- 无硬 blocker。
- 🔴 **stale uvicorn 会咬人**：按端口杀（`Get-NetTCPConnection -LocalPort <口> -State Listen` →
  `Stop-Process`），别信 ps 信行为；各 session 结束清自己起的端口。
  同族：`PgRegistry._schema_ready` 是实例级缓存——换库不重启后端＝迁移不重放，报「relation does not exist」。
- 🔴 **本机 Docker PG 容器时钟来回跳 ~115s**：`created_at < now()` 判据间歇假红，「单跑绿、整轮红」
  是招牌症状；写测试要「够旧」就显式拨时间，别赌墙上时钟。
- 🔴 **本机 curl 把 argv 中文按 GBK 编**：中文只走 heredoc / 预先 percent-encode
  （写法照抄 `.issues/gap-design-0805/curl-chain-T1.sh` 的 `encode_body`）。
- ⚠ **像素基线不密闭**：依赖本机后端带 demo seed（`AVERY_DEMO_SEED_DIR`）；后端没起对，
  40 张「没有基线」也会绿——先起对后端再跑 visual（T3 交接的教训 + 0806 memory）。
- 🔴 `e535ec9` commit message 是错的（真相在 `03a9824` erratum）；rebase 与否归 Danny。
- 🔴 repo 级 stash 两条别人的存货（`stash@{0}`/`stash@{1}`）；处置归 Danny。
- 多个战役 worktree 仍挂着（T1–T7 各自的 + 更早六个）——删分支/worktree 属删除闸，归 Danny。
- ⚠ `verify-null-owner` 偶发假红保留观察；`teammaster-postgres-1` 容器留在运行态。
- ⚠ 本轮 T2/T4/T5/T6/T7 五票都没刷新本文件（快照断更），已由本次重写恢复——
  **各票收尾必须重写 progress.md**，这是 AGENTS.md 的 DoD，不是可选项。
