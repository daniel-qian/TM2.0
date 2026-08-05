# Session Progress Log

> 📢 本文件是**当前状态快照，整体重写不追加**。历史都在 git（`git log` + 各 `.issues/*/receipt*.md`），别在这儿堆编年史。
> 启动路径见 `AGENTS.md` Startup Workflow：读本文件 + `feature_list.json`，跑 `./init.sh` 确认绿，再开工。

**Last Updated:** 2026-08-05（两线合账：快问死域 P0 已上产 + 成本闸核查修闸——/advise 才是闸外通道）

## Current State

- **git**：`main` 已合入 spend-gate 修闸（worktree 分支 `claude/focused-panini-43ed82`，
  合并了 P0 那条线的 `4bc6085`），与 `origin/main` 推平。
- **验证账实**：后端 pytest **3538 passed / 74 deselected / 4 xfailed**（两线合并后重跑：
  +10 `test_spend_gate_coverage.py`（mock 层调用计数钉接线，born-red 反证 6 红）+1 快问默认域
  回归锁）。全电池 **31/31**（P0 线跑的，spend-gate 线纯后端不碰门）。像素基线 40 张未动。
- **🔥 0805 生产 P0 已修**（[回执](.issues/quickask-publicbase-0805/deploy-receipt.md)）：快问员工链接
  曾拼在 DNS 从不解析的 `avery.ima-read.com`（生产 env 缺 `AVERY_PUBLIC_BASE` × 代码死默认值）。
  代码默认值改真域 + env 补上 + 换容器 `avery-agent:main-20260805-134620`（从 main `4bc6085` 构建），
  容器内 `public_base()` 实测 = `https://avery.dannyqian.com`，走查真 token `/r/…` 200。
  回滚梯 `avery-prev-20260805-134620` 在位。**⚠ 顺手坐实：`~/avery.env` 曾比在跑容器少 5 个变量
  （demo seed/限流、SUPABASE 两条）——已补齐，但换容器 env 快照永远以在跑容器提取为准。**
- **⚠ spend-gate 修闸还没上生产**：在跑镜像 `main-20260805-134620` 基于 `4bc6085`，**不含**本轮
  /advise+embeddings 入闸——生产的 /advise 目前仍在预算闸外。下次 swap 从 main 重建即带上。
- **#38 已完成并 closes**，**契约切换的两半已同批上生产**（[部署回执](.issues/locale-contract-0803/receipt-deploy-0804.md)）：
  前端 Vercel 构建 `89b36e4`（线上 bundle 的 commit 戳与本地 HEAD 逐字相等，
  8 条判读文案逐条核到线上产物）；后端在 `avery-agent:main-20260804-153841` 验过
  （从 main 构建，容器内纯 Python 断言核到 `grade_label` 已消失、命中带 `params`、
  `locale` 在契约上），现被 0805 镜像逐级覆盖。

## 本轮做完的（0805 走查 P2 成本闸票 · [回执](.issues/spend-gate-0805/receipt.md)）

一句话：**走查的疑点属实但方向全反——extractor 从 feat-039 起就在预算闸内，真正裸奔的是
/advise（每轮最多 12 次模型调用、限流默认关）和全部 DashScope embeddings；两者已入闸。**

1. **账目对齐**：2000→1996 扣的 4 格是 4 次抽取调用（3 酒店文档 + 1 乱码 txt 各 1 窗），
   与 4 次 /advise 同数纯属巧合；走查只有首尾两笔 /health 读数，「advise 实扣 4」是错误归因，
   原报告已落对账附注。
2. **/advise 入闸**（`app.py`）：非 mock brain 包 `BudgetedBrain`；预算已尽先短路成干净
   error 事件；循环中途耗尽由 engine 兜底转 error。mock 免计费，离线套零影响。
3. **embeddings 独立预算**（`AVERY_EMBED_CALL_BUDGET`，`/health` 新增
   `embed_calls_remaining`）：闸挂在 `DashScopeEmbedder._embed_batch`（core 定缝、
   service 装闸），连 `active_registry()` 自建的 embedder 也罩住。不并入 llm_calls——
   嵌入便宜两个数量级，混计会搞脏 Danny 在看的那个数。
4. **降级不打死上传**：pipeline / pg_registry 的嵌入失败（含闸拒付）降级 keyword/NULL 向量
   并告警——顺手修掉「DashScope 挂了会打死 put()」的存量脆弱点。
5. ⚠️ **换容器后读数口径变了**：`llm_calls_remaining` 从此会因 /advise 下降（每轮 1~12），
   别再按「只有抽取扣数」的旧直觉读。

## What's Next（按优先级）

1. **下次生产 swap 带上 spend-gate 修闸**（P0 已单独上产，别再等"同批"）；换容器时顺手补
   env：`AVERY_RATE_ADVISE_PER_MIN=30` + `AVERY_EMBED_CALL_BUDGET=2000`（都已写进 .env.example）。
2. **r2 剩下的未开票发现**（`.issues/sweep/2026-08-02-r2.md`，按屏分好了）。
3. **gate-run 迁移继续**：`verify-aria-zh` / `verify-cr-alignment` 仍未迁（形状不兼容，
   要先扩 makeRec）。**已迁/未迁一律用自查命令数，别抄数字。**
4. **files-hub 独立票 #26–#29** · 换血抢救票 #31/#32 · v01 退役成本账 #33（ready-for-human）。
5. **UI 线**：🔴 真机零覆盖（iOS Safari / 微信内置）优先级最高；断点动物园；像素基线 tracked 与否未拍板。
6. **成本票 #30**（CRUD 50 秒）：Danny 已拍板等真实客户量再立，只记数。
7. **真 brain 分流取证**：要真花钱，需要先给口径（上限几次调用/打 demo 克隆还是真 context/超了就停）。
   语言指令一段已于 2026-08-05 生产取证；分流取证本身仍未跑。

## Blockers / Risks

- 无硬 blocker。
- 🔴 **`pkill -f "uvicorn service.app"` 在本机 Git Bash 下不生效，而且不报错。**
  判断方法（比看 ps 靠谱）：发一个非法 locale，看日志里有没有 `unsupported locale` warning。
  可靠杀法：`Get-CimInstance Win32_Process -Filter "Name='python.exe'" | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }`
- 🔴 **`e535ec9` 的 commit message 是错的**（已 push；真相在 `03a9824` erratum）。要不要 rebase 归 Danny。
- 🔴 **repo 级 stash 里躺着两条别人的存货**（`stash@{0}` feat-061 briefing i18n 留档、
  `stash@{1}` 旧 worktree WIP）——stash 是仓库全局的，**任何 worktree 里裸 `git stash pop`
  都会把它们弹进自己的工作区**（本轮就误弹过一次 `stash@{0}`，已完整回滚、条目无损）。
  处置（drop/转分支）归 Danny。
- 六个 worktree 仍挂着，分支停在更早 commit——删分支/worktree 属删除闸，归 Danny。
- A 区上传型门 **9 道**；每跑一次 A 区在 mock 后端造几十个 context（内存态，进程停即清）。
- ⚠️ `verify-null-owner` 偶发假红（连跑多轮后 `/ingest` 超时）。红了先单独重跑一次再当真。
- ⚠️ **`owns` 编辑框往返有损（老账）**：拆分侧 `split(/[,，、]/)`，含逗号/顿号的条目存回被劈。
  修它要动数据形状，单开一票。

## 站着别动的事（Danny 人工闸，agent 别代决）

- 凭据轮换；裸「风险：」词表加宽；`origin/p5-04-nexus-safe-zone` 废弃分支处置。
- 法律件三份对外风险（DPA / 隐私件称境内而后端在法兰克福）——归合伙人，工程线不捡。
- 合伙人对外仍讲「不打分不排名」旧口径——Danny 亲自同步（ADR-0025 后果节）。
- 生产库历史数据的任何修复/清理。
