# Session Progress Log

> 📢 本文件是**当前状态快照，整体重写不追加**。历史都在 git（`git log` + 各 `.issues/*/receipt*.md`），别在这儿堆编年史。
> 启动路径见 `AGENTS.md` Startup Workflow：读本文件 + `feature_list.json`，跑 `./init.sh` 确认绿，再开工。

**Last Updated:** 2026-07-30（files-hub-0729 部署回执落库；本文件 2026-08-01 换血为快照体）

## Current State

- **git**：`main` = `origin/main` = `8769f6b`（工作树干净，无未推提交）。生产 = main：前端 Vercel 自动部署（averylite.dannyqian.com）；后端容器 `avery-agent:main-20260730-125353`，回滚梯 `avery-prev-20260730-125353` 保留。
- **07-28 → 07-30 三波已全部上线**：partner-docs（/paperwork 页 + 7 张 intake 表 + 红线 KPI-001 误报修，ADR-0030）、naming-0729（大白话命名 pass，5 tab 主名 + 词族，ADR-0031）、output-form-0729（议事室画板退役 / 砍契约样板 REQUIRED 9→3 / 分流短答 answer_direct）、files-hub-0729（feat-093：/files 资料库第 10 屏 + 逐份下载 + 多库切换 + 团队屏零文件元素，vision 降设置菜单，ADR-0032）。
- **pg_registry 数据丢失 bug 已修并在真库实证**：`get→改→put` 会把上传原件 bytea 写 NULL（下载 404 + 原件永久销毁，改造前就在生产成立）。三跑取证：旧镜像 born-red 404 → 新镜像 200 字节相同 → swap 后生产复验 200。见 `.issues/files-hub-0729/receipt-deploy-0730.md`。
- **验证账实（部署时点）**：全电池 27/27（A21/B3/C3，runner=`eval-harness/tools/run-battery.mjs`）；离线 pytest 四 deselect 3469 passed / 0 failed / 4 xfailed；像素基线 40 张（单机产物，gitignored）。

## Active Feature

无 active 编码线。feat-093 done。feat-019（酒店 vertical pack）名义 `in_progress` 但实为外置研究线（产出在 `D:\Boyle\research\sanya-lushan-yiju-hotel\`，repo 未碰），长期挂账。feat-002/003/013 为 6 月旧票 not-started。

## What's Next（按优先级）

1. **真 brain 分流判据从未真跑**：生产后端进程 `llm_calls_remaining` 恒 2000 = 零次 LLM 调用；分流（answer_direct/CHAIN_HINT）只有 mock 层被门钉死。上产后手动走一次真 brain 提问取证。
2. **files-hub 独立票 #26–#29（一张没开工）**：#26 笔记升级真记忆（`append_note` 现状只写不回流，「越合作越厚」文案在替不存在的能力背书）· #27 两套上传实现合一 · #28 后端文件写端点（⚠ 先给 `SourceDocument` 稳定 id，现按数组下标寻址）· #29 tab 合并观察票（needs-triage，动前须 ADR 推翻 feat-057）。
3. **换血抢救票（2026-08-01 归档旧战报时开出）**：#31 补做 05b 重传合并（rich-align 唯一未交付片）· #32 lite/lite2 引擎收敛回一份（copy-then-wall 债，#27 只覆盖上传一角）。
4. **UI 线开放项**（详见根 session-handoff 07-28 段）：🔴 真机零覆盖（iOS Safari / 微信内置）优先级最高；满态布局生产零覆盖；en 退化边界贴脸（1280×720 en 空态卡 margin 0）；断点动物园（lite2.css 八断点）；像素基线 tracked 与否未拍板。
5. **agent/抽取线开放项**：「暂停」词表修复的生产收益未端到端量过（生产走 llm 抽取，词表只是兜底，旧数据不回填）；02 表下拉「未开始」→ 卡显「状态未提及」自坑（最易被合伙人报 bug）；`/health` 无 version/commit 字段。
6. **新量到的成本票（值得单开）**：手编 CRUD 一次写入 40–45s——`put()` 每次重嵌整个语料并烧 DashScope；重嵌应只在语料真变时发生。

## Blockers / Risks

- 无硬 blocker。合伙人端到端试用反馈仍是最高优先中断源——一到就放下一切先处理。
- 账目债：`feature_list.json` 缺 `naming-0729` / `output-form-0729` 两战役行（4 个代码 commit 零 feature 行，替别人编 evidence 不做）。
- 六个 worktree 仍挂着（`git worktree list`），分支停在更早 commit——删分支/worktree 属删除闸，归 Danny。

## 站着别动的事（Danny 人工闸，agent 别代决）

- 凭据轮换（07-20 生产 env 曾在会话明文出现一次）；裸「风险：」词表加宽；`origin/p5-04-nexus-safe-zone` 废弃分支处置。
- 法律件三份对外风险（DPA 带谈判底牌 / 隐私件称境内而后端在法兰克福）——Danny 已定归合伙人，工程线不捡。
- 合伙人对外仍讲「不打分不排名」旧口径——Danny 亲自同步（ADR-0025 后果节）。
- demo 克隆副本在生产库累积——过期清扫=删除类动作，先问。

## Key Decisions（现行有效，全录 docs/adr/）

- ADR-0018 产品真理=管理决策层；ADR-0025/0031 命名口径；ADR-0027 cr-align 规格驱动；ADR-0030 paperwork=样本非签署面；ADR-0032 files hub。
- 部署纪律：**生产镜像一律从 main 构建**（AGENTS.md Deploy 段）；前后端有联动改动必须同上+swap 容器。
- 门纪律：上传型门绝不排 C 区（bundle-privacy）之后；碰上传路径前先验 `window.__AVERY_BUILD__.apiBase`；电池独占跑。

## 指针

- 最近三份回执：`.issues/files-hub-0729/receipt-deploy-0730.md` · `.issues/partner-docs-0728/receipt-deploy-0728.md` · `.issues/output-form-0729/receipt.md`。
- 交接细节与两线开放项全文：根 `session-handoff.md`。环境/陷阱：AGENTS.md「易复发陷阱」段。
