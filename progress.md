# Session Progress Log

> 📢 本文件是**当前状态快照，整体重写不追加**。历史都在 git（`git log` + 各 `.issues/*/receipt*.md`），别在这儿堆编年史。
> 启动路径见 `AGENTS.md` Startup Workflow：读本文件 + `feature_list.json`，跑 `./init.sh` 确认绿，再开工。

**Last Updated:** 2026-08-02（sweep-promote-0802 全菜单收工：合并上线 + 文档保洁 19 条 + 第二轮 UI 扫）

## Current State

- **git**：`main` 与 `origin/main` 推平、工作树干净。本轮从 `12282e8` 推到 `c255b87`，其中
  `0884d49` 是 `claude/codebase-architecture-improve-20b9eb` 的 12 提交快进合入点。
- **生产 = main**：前端 Vercel 自动部署（averylite.dannyqian.com，**已核到产物层**，不是只看 200）；
  后端容器 **`avery-agent:main-20260802-113944`**（构建自 `origin/main` @ `0884d49`），
  回滚梯 `avery-prev-20260802-113944` 保留。回执：`.issues/sweep-promote-0802/receipt-deploy-0802.md`。
- **验证账实**：全电池 **28/28**（A22/B3/C3，本轮 +1 道 flow-gap-phases）；
  裸 `pytest` **3473 passed**（pytest.ini 已把四 marker 反选做成默认，不再靠人记咒语）；
  `-m needs_db` 对本地 avery-pg **65 passed**；像素基线 40 张（单机产物，gitignored，本轮重冻过）。
- **生产库原件盘点：0 条**。上线时 9 条命中全部落在同一个 `ephemeral=true` 的 demo 克隆
  （07-30 born-red 演示的被试残骸，三条独立证据），**不是客户数据**；未擅自补救，收尾复查时
  已被应用自带的克隆 GC 扫掉，库从 108 context/269 doc 降到 97/224，查询归零。
  `materials.embedding` 零 NULL——arch-4 顺手治的向量抹除同源病在生产上从未发作。
- **feature_list.json 已瘦身**：77 条 done 的**完整记录**（description/dependencies/date/evidence）
  整条搬进 `feature_archive.json`，原文件只留四字段指针。零丢失是拿旧本逐字段比对证出来的。
  🔴 从此任何"扫全仓修引用/行号/链接"的保洁**必须把 feature_archive.json 纳进扫描范围**。

## Active Feature

无 active 编码线。feat-019（酒店 vertical pack）名义 `in-progress` 但实为外置研究线，长期挂账。
feat-002/003/013 为 6 月旧票 not-started。本轮补了 feat-094（naming-0729）/ feat-095（output-form-0729）
两条缺账行，账目债已清。

## 本轮做完的三件（sweep-promote-0802 菜单）

1. **合并上线 + 生产盘点** —— 见上 Current State。
2. **文档保洁 19 条全部落地**（架构报告未核验附录）。19 条经复核后 0 弃票，分三波、每票一提交。
   两轮 opus 复核共开 11 条 fix-needed，**全部是真缺陷、全部已修**。副产物是三份新索引：
   `.issues/README.md`（44 目录逐行 + do-not-archive/do-not-move 标注）、`docs/adr/README.md`
   （33 篇 + 被取代图 + 0023 撞号消歧）、`eval-harness/db/migrations/README.md`（五条迁移纪律）。
3. **第二轮 UI 扫**（`.issues/sweep/2026-08-02-r2.md`）—— **20 条，REGRESSED 0**。
   上一轮 46 条里 12 条 hard-contract 被证明是同一个 harness 破口造成的假象，不是产品缺陷。

## What's Next（按优先级）

1. **r2 的 3 条 hard-contract 已开票，等修**：[#34](https://github.com/daniel-qian/avery/issues/34)
   悬浮问-Avery 胶囊在短视口**劫持可见控件**（真点击验过，不是遮挡）·
   [#36](https://github.com/daniel-qian/avery/issues/36) 团队屏 composer 盖出永久死区 ·
   [#37](https://github.com/daniel-qian/avery/issues/37) 详情浮层「出处」是工作区级全量清单，
   纯手打卡也照列 9 份文档（与同面板「手动编辑」角标自相矛盾）。
2. **r2 剩下 17 条（suspected 11 / feel 5 / KNOWN）未开票**，全在报告里，按屏分好了。
   优先看 `home/en-locale-decision-grade-labels-stay-chinese`（EN 用户拿到中英夹杂的核心决策面板，
   根因 `decision_grading.py` 三处硬编码 `LABEL_ZH`）。
3. **真 brain 分流判据从未真跑**：生产 `llm_calls_remaining` 恒 2000 = 零次 LLM 调用；
   分流（answer_direct/CHAIN_HINT）只有 mock 层被门钉死。上产后手动走一次真 brain 提问取证。
4. **snippet + gate.md 的「零后端/离线 stub」整套前提是假的**（本轮实证）：
   `?transport=stub` 在 `vite build` 产物里恒为死开关，而本仓门环境一律 build+preview。
   snippet 头注释多处仍按「deterministic, offline, no real backend」描述整套人工协议。
   值得单开一票把这个认知刷进 snippet 头 + gate.md，否则下一个人还会照抄"零后端"去写门。
   同族：snippet 顶部 Usage 表的「10 phases / A-J / 8 tabs」也已陈旧（真值 11 相位 / 9 tabs），
   gate.md 已加告警指明，但 snippet 自己没改。
5. **gate-run 迁移继续**：本轮只迁 3 道。`verify-aria-zh` 与 `verify-cr-alignment` 刻意没迁
   （上报模型不兼容，理由写在 gate-run.mjs 头注释），需要先扩 makeRec 的形状。其余每 session 迁几道，
   **迁移前后各跑一次、判据逐条对照**——这是这张票唯一的验收方式。
6. **files-hub 独立票 #26–#29（一张没开工）** · **换血抢救票 #31/#32** · **v01 退役成本账 #33**（ready-for-human）。
7. **i18n 还剩 10 个孤儿键**（`node scripts/i18n-orphans.mjs` 自己跑，别抄数字）。本轮只删了证据最硬的 2 个。
8. **UI 线开放项**：🔴 真机零覆盖（iOS Safari / 微信内置）优先级最高——本轮 375x812 是 headless 模拟，
   不是真机；断点动物园（lite2.css 八断点）；像素基线 tracked 与否未拍板。
9. **成本票 [#30](https://github.com/daniel-qian/avery/issues/30)**：手编一次 CRUD 仍要 **50 秒**
   （本轮生产探针实测，07-30 是 40–45s）——`put()` 每次重嵌整个语料。Danny 已拍板「等真实客户量再立」。

## Blockers / Risks

- 无硬 blocker。合伙人端到端试用反馈仍是最高优先中断源——一到就放下一切先处理。
- 🔴 **`e535ec9` 的 commit message 是错的**（装的是 nudge 那票的代码，挂着 lint 那票的正文）——
  `--amend` 打偏了，且已 push。改写已 push 的历史属人工闸，没自己动；
  真相记在 `03a9824` 这条 erratum commit 里。要不要 rebase 修掉归 Danny。
- 六个 worktree 仍挂着（`git worktree list`），分支停在更早 commit——删分支/worktree 属删除闸，归 Danny。
- A 区上传型门现在是 **4 道**（+flow-gap-phases），每跑一次电池就在 mock 后端造 4 个 context。
  本机 mock 是内存态、进程一停就没，不累积；但真库那头的 demo 克隆 GC 口径值得复看一眼。

## 站着别动的事（Danny 人工闸，agent 别代决）

- 凭据轮换（07-20 生产 env 曾在会话明文出现一次）；裸「风险：」词表加宽；`origin/p5-04-nexus-safe-zone` 废弃分支处置。
- 法律件三份对外风险（DPA 带谈判底牌 / 隐私件称境内而后端在法兰克福）——Danny 已定归合伙人，工程线不捡。
- 合伙人对外仍讲「不打分不排名」旧口径——Danny 亲自同步（ADR-0025 后果节）。
- 生产库历史数据的任何修复/清理（本轮盘点只出清单，一个字节没动）。
