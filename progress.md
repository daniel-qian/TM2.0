# Session Progress Log

> 📢 本文件是**当前状态快照，整体重写不追加**。历史都在 git（`git log` + 各 `.issues/*/receipt*.md`），别在这儿堆编年史。
> 启动路径见 `AGENTS.md` Startup Workflow：读本文件 + `feature_list.json`，跑 `./init.sh` 确认绿，再开工。

**Last Updated:** 2026-08-05 深夜（Danny 截图走查五票 #45–#49 全落地已推 origin）

## Current State

- **git**：`main` = `9990dda`，与 `origin/main` 推平（fa8d085 之后新增 6 个 commit，全部对应
  GitHub issue #45–#49，票已带证据关闭）。
- **验证账实**：后端离线套 **3544 passed / 77 deselected / 4 xfailed**（+15 条 #49 新测试）；
  needs_db 层 **45 passed**（本地 throwaway 库 `avery_run49_test`，含 advise_runs pg 重启存活）；
  前端全电池 **A 25/25 · B 3/3 · C 3/3 全绿**；**像素基线 4 组已重冻**（#46 布局变更后
  actual 逐张人眼过再 --update-snapshots——基线仍是单机产物）。
- **⚠ 本轮改动只在 main 代码库，生产未部署**：后端容器仍是 `main-20260805-160609`（spend-gate
  修闸那版），前端 Vercel 仍是 `89b36e4` 构建。#49 上线要素：换后端容器（新迁移 0012 由
  `_ensure_schema` 幂等重放，Supabase 首次 boot 自动建表）+ Vercel 重建前端。#45–#48 纯前端。

## 本轮做完的（2026-08-05 晚 · Danny 截图走查，grill 拍板后五票连做）

一句话：**四张截图报的问题全部落地——两处坐实 UI bug 修掉、团队页推翻 ADR-0017 回归纯人员
目录（分诊迁今天页）、LiteComposer 退役统一悬浮胶囊、四处「带上下文问 Avery」入口、
议事室问答从「F5 即彻底丢」变成后端入库+历史抽屉。**

1. **#45 屏底家具**（6e95b84）：议事室 run 态 composer 从 v01 画布时代左下小浮标归位为居中
   横条；#34 让位带补 projects/room 两个漏网滚动口；「今天页胶囊像装在白容器里」坐实为
   带上沿硬切错觉，渐隐 mask 修掉。
2. **#46 团队页重构**（c727e97 + ADR-0034）：探底反转——「提醒+项目区」不是误复用而是
   ADR-0017 正式设计；Danny 拍板推翻。分诊整块迁 HomeScreen 与「今天要决策的」相邻
   （数据/文案/localStorage 三层零动），项目卡带删除（与项目屏纯重复），团队页单列纯目录。
3. **#47 LiteComposer 退役**（7b03982）：全站提问统一悬浮胶囊；8 个孤儿 i18n 键清掉；
   顺手消灭它压页脚的 #34 半修 bug。
4. **#48 卡面快问**（a69a405）：项目卡/人员卡「整卡一按钮」改「容器+多按钮」（键盘路径
   `.lite-card-open`），卡面+两详情浮层各加「去问 Avery ↗」，预填零编造走 composerDraft
   不自动发。
5. **#49 问答持久化**（9990dda，feat-063 收窄版）：迁移 0012 `avery.advise_runs` +
   registry 双生 + `/advise` hook（只落 redline_passed）+ `GET /team/{id}/advise-runs` +
   议事室「之前问过的」抽屉。端到端 9/9：上传→提问→**F5→历史仍在→回放判读卡**。
6. **门的尺子跟部件走**（37cbcc4 及散落各 commit）：status-truth/null-owner v02 分支随卡面
   搬项目屏；flow-gap-phases 与 snippet 分诊相位 Team→Today；handoffs-empty-honesty v02→home；
   cr-align-spec homeMainBlocks 2→3；button-family 白名单 +`.lite-card-open`；auth-form 的
   部分 team fixture 揭出 `team?.handoffs.length` 可选链盲点（已修 `?.length`）。

## What's Next（按优先级）

1. **#45–#49 前后端上生产**：从 main 构建新容器 swap（迁移 0012 幂等自动建表；env 快照照旧
   从在跑容器提取）+ Vercel 重建。走查回执落 `.issues/`。
2. **r2 剩下的未开票发现**（`.issues/sweep/2026-08-02-r2.md`，按屏分好了）。
3. **gate-run 迁移继续**：`verify-aria-zh` / `verify-cr-alignment` 仍未迁（形状不兼容，要先扩
   makeRec）。已迁/未迁一律用自查命令数。
4. **files-hub 独立票 #26–#29** · 换血抢救票 #31/#32 · v01 退役成本账 #33（ready-for-human）。
5. **UI 线**：🔴 真机零覆盖（iOS Safari / 微信内置）优先级最高；断点动物园。
6. **成本票 #30** 等真实客户量；**真 brain 分流取证**仍未跑（要先给口径）。
7. backlog：全量 feat-063（多会话 tab + 对话流视图）——#49 刻意收窄，历史抽屉先用着。

## Blockers / Risks

- 无硬 blocker。
- 🔴 **8137 stale uvicorn 又咬了一次**：本轮 #49 端到端首跑历史钮不出现，就是 8137 上跑着
  session 开始前的旧后端。可靠杀法（比杀全体 python 精准）：
  `Get-NetTCPConnection -LocalPort 8137 -State Listen` 拿 OwningProcess → `Stop-Process`。
  本 session 结束时已把自己起的 8137/5173/5175 清掉。
- 🔴 **`e535ec9` 的 commit message 是错的**（已 push；真相在 `03a9824` erratum）。要不要 rebase 归 Danny。
- 🔴 **repo 级 stash 里躺着两条别人的存货**（`stash@{0}` feat-061 briefing i18n 留档、
  `stash@{1}` 旧 worktree WIP）。处置（drop/转分支）归 Danny。
- 六个 worktree 仍挂着——删分支/worktree 属删除闸，归 Danny。
- Docker Desktop 是本 session 为 needs_db 拉起来的（原本没开）；throwaway 库
  `avery_run49_test` 已 drop，`teammaster-postgres-1` 容器留在运行态。
- ⚠ `verify-null-owner` 偶发假红条目保留观察；本轮真红是采样面搬家，已修门后 15/15。
