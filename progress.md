# Session Progress Log

> 📢 本文件是**当前状态快照，整体重写不追加**。历史都在 git（`git log` + 各 `.issues/*/receipt*.md`），别在这儿堆编年史。
> 启动路径见 `AGENTS.md` Startup Workflow：读本文件 + `feature_list.json`，跑 `./init.sh` 确认绿，再开工。

**Last Updated:** 2026-08-08（演习批第二票 **#63 落 main**：「值得注意」并进「今天」、退 tab 9→8，
像素基线已在主检出重冻成 36 张并人眼过；#64 仍在自己的 AFK session 里，三票齐后复演；
仍未 push、未上产）

## Current State

- **git**：`main` = 差距战役 #50–#57 八票 + gap2 三票（T11 #60 / T9 #58 / T10 #59）+
  演习批 **#61**（回执 `.issues/rehearsal-0808/receipt-61-md-table-frame.md`）+
  **#63**（回执 `.issues/rehearsal-0808/receipt-63-merge-closerlook.md`）。
  `main...origin/main [ahead 21]`，**没有 push**（见 Blockers）。
- **#63 验证账实（合 main 前在其 worktree 实测；#63 零后端/零持久层改动，后端套不触发）**：
  `./init.sh` 绿；i18n **974** 叶子键 / 孤儿 0（976 −5 退休 +3 新增）；
  前端电池 **A 29/29**（29 = 原 28 + 新门 **verify-v2boots**）· **B** data-boundary 37/37 +
  null-owner 15/15 · **C 3/3**；变异 **4/4 killed**（tab/门不同步 · 通知指错屏 · 通知接线失灵 ·
  展开按钮接空——判据全部落真部件）。
  ✅ **像素基线已在主检出重冻并人眼过**：#63 起 closerlook 出列，**40 张 → 36 张**
  （9 屏×2 皮×2 视口）。裸跑漂移定性：红像素**恰好只在顶栏 tab 区**（「值得注意」消失、
  后两 tab 左移；mobile 上部分屏因 tab 溢出滚动不漂）——与票面唯一应有漂移一致后才重冻，
  重冻后复跑零红。数据态另拍三视角（`.issues/rehearsal-0808/t63-shots/`：desktop 双皮 +
  mobile，摘要态/展开态/历史折叠都过了眼，无裁切无重叠）。
- **✅ 生产仍停在 08-07 白天那一版**（`main-20260807-190332` = main `99d83f7`）。
  演习批与 gap2 三票**都没有上产**——统一上产由主 session 另行安排（What's Next 第 3 条）。
  上产/HITL 回执仍是 `.issues/gap-design-0805/receipt-deploy-0807.md` 与 `receipt-hitl-0807.md`；
  迁移 0012/0013/0014 已在生产库落地。
- 🔴 **迁移账（上产时按这个来）**：
  - **T9 需要 `0015_form_submissions_auto_key.sql`**——加一列 `auto_key` + 部分唯一索引
    `(context_id, auto_key) WHERE auto_key IS NOT NULL`。increment-only、可重放，
    `_ensure_schema()` 每次 bootstrap 自动重放，换容器即生效。
  - **T11 / T10 / #61 / #63 都不需要**：#63 纯前端+门，零后端字节。
  - 判据一句话：**动 dataclass 里被整块 jsonb 装着的字段 → 免迁移；动表的顶层列 → 必须迁移。**
- 🔴 **合的都是本地 main，没有 push**。「落 main 即止」在这个仓库里必须理解成**不 push**：
  前端 push main 即自动构建上产，推一下就等于把前端单独上了产、而后端容器还停在旧镜像。
  push + 换后端容器必须在统一上产那个 session 的**同一个窗口里**做（What's Next 第 3 条）。

## 本轮做完的（2026-08-08 · #63 「值得注意」并进「今天」，浅合）

回执：`.issues/rehearsal-0808/receipt-63-merge-closerlook.md`（交付面逐条 + 门改判表 + 变异账 + 拍板取舍 + 已知边界）。

**演习里连经理都分不清的两个「对不上」界面，现在只剩一个了。** `CloserLookScreen` 删除，
对照卡整套（双栏对照/四动作/实时预告/历史折叠）并进「今天」差距摘要块的**展开态**——
默认摘要零漂移，点「全部展开」原地换完整卡。`.lite-gap-*` 类名逐字保留（门选择器合同）。
浅合：gapDerive 推导与「今天要决策的」一字未动；本票推翻 feat-057 之 closerlook 一屏，
**其余六屏保护原样有效**（LiteTopbar/snippet 碑文都改述过了）。

- tab 9→8，snippet `assertV2Boots` 期望数组同 commit 同步；`NOTIF_TARGET['gap']` → home；
  `/closer-look` 显式重定向 home（粘性 query 全保留，实测）；'closerlook' 出 LiteScreen
  联合类型（写回去=编译错误）。
- **门侧两个缺口顺手焊死**：① v2Boots 相位此前**零机械 runner**——「tab 数组与门期望不同步」
  在电池里没人会红；新门 `verify-v2boots.mjs` 入 ROSTER A 区（离线 2s）。② gap 通知落点接线
  此前无门管——flow-gap-phases 加第 9 判据 `gapNotifRoute`（snippet 侧新相位）：先离开 home、
  点铃铛里**真实的** gap 通知条目、断言落回 home 且差距块在场——「先离开再点」是为了让
  「接线整个失灵」也能红（变异 M3 实证 `dataScene:"team"` 红）。
- i18n：`tabCloserLook`/`gapPage*`/`homeGapsLink` 退休；指路文案全部改指新家
  （handoffsEmptyButLook / homeTodayEmpty / followupsSourceCloserLook / gapEmptyAria）；
  原屏 addFollowup 的英文硬模板债入字典（`gapFollowupTitle`）。

## 上几轮做完的（详情全在各自回执，这里只留会影响下一个人的）

- **#61 花名册吃下标准 markdown 表格**——回执 `.issues/rehearsal-0808/receipt-61-md-table-frame.md`。
  `_strip_table_frame`：**行首第 0 列就是竖线**才算边框、首尾各剥一根；判据落在第 0 列是因为
  三个生产者的 `join` 在首格为空时产出空格开头的行——那种行必须继续被丢弃（幽灵人卡）。
  已知边界：缩进的 GFM 表格照旧不认（宁可漏）。
- **T10 补资料（#59）**——回执 `.issues/gap2-0807/receipt-T10-append.md`。
  「每次上传=新开一家公司」的墙拆了。🔴 顺手补的洞：`upload_guard._GUARDED` 精确匹配，
  带路径参数的路由永远命不中——新写端点先问「边缘那层闸认不认得它」。🔴 门驱动 store 还是
  真部件，决定它能不能看见「接线」型 bug（#63 的 gapNotifRoute/M4 又验证了一遍）。
- **T9 站内主动（#58）**——回执 `receipt-T9-forms-proactive.md`。自动备好本期链接、铃铛 'form'
  通知、今天页「还差 N 人没交」；幂等两把独立锁；撤回=拨到期时刻不删行。
- **T11 模板拼装器（#60）**——回执 `receipt-T11-form-builder.md`。自建表三入口、`yesno`+1~5 分、
  已答字段禁改禁删双锁。

## What's Next（按优先级）

1. **演习批最后一票 #64 做完**（议事室 @ 引用回归，AFK session 进行中）。
   🔴 **#64 现在是「后合的」**：#63 已落 main 并重冻过像素（36 张），#64 动议事室/今天页一带，
   合 main 后必须在**主检出**再重冻一遍并人眼过（老规矩：裸跑先定性漂移面再 update）。
2. **复演**（三票齐后，本地）：环境随起随用——`preview_start rehearsal-api / rehearsal-web`
   （launch.json 两条配置在，本地未提交；后端脚本 `.issues/gap2-0807/rehearsal-api.ps1`）。
   库 `rehearsal0808` 数据保留；脑真 MiniMax，抽取/检索离线。复演时顺手验：
   ① 把演习花名册转成标准 markdown 表格再传一遍（#61 触发动作）；
   ② 「值得注意」并进今天后的动线——经理还找不找得到对照卡（#63 的真验收在这）。
3. **统一上产**（连同 gap2 三票 + 演习批一起）。
   🔴 **push 与换后端容器必须在同一个窗口里做**（新前端+旧后端的坏法清单见 gap2 各回执；
   #61 后端解析、#63 纯前端，这两票单方向无害，但 T9/T10/T11 会上到一半）。
   ⚠ 换容器时 **0015 必须落地**；上产后**先设 `AVERY_PUBLIC_BASE`** 再验表单。
4. **T8 留的两条记录还在桌上**（只记录未改，等拍板）：① 议事室引用编号是 `facts.md:<行号>`
   而非客户文档名；② 今天页证据行是 `字段="值"` 的机器形状（ADR-0033 明定）。
5. **给 `/health` 加一行版本字段**（镜像 tag 或 commit）：「生产跑的是哪个 commit」外部不可核。
6. carry-over：r2 未开票发现（`.issues/sweep/2026-08-02-r2.md`）· gate-run 迁移（aria-zh/cr-alignment）·
   files-hub #26–#29 · 换血抢救 #31/#32 · v01 退役 #33 · 真机零覆盖（iOS/微信，最高优）·
   成本票 #30 等真实客户量 · 真 brain 分流取证（要先给口径）· 全量 feat-063。

## Notes（顺手发现，没顺手修）

- 🔴 **`AVERY_PUBLIC_BASE` 必须指后端自己的口，不是前端**（#63 门环境实收）：员工 H5
  `/f/{token}` 由**后端 form_api 直接服务**。指到前端 5173 的症状极具迷惑性——链接被
  preview 的 SPA fallback 接走落进 story 壳，form-builder 在 story onboarding 上等 textarea
  超时，读起来像「员工页坏了」。rehearsal-api.ps1 里的 8250 也是它自己的 API 口。
- **粒度闸够不着跨批次**（T10 记档）：补传路只能对新批次跑闸；「新文档里的里程碑属于存量项目」
  挡不住，宁可漏，碑在 `file_append.py`。
- **`role`/`tenure` 两份资料说法不同时，两条路都不记冲突**（`_CONFLICT_FIELD_ALLOWLIST` 人侧
  只有 `team`）。既有边界。
- **`_people_from_roster` 的位置兜底会顶掉空格子**（#61 看清的既有怪癖）：空串 falsy，
  位置兜底不 inert。将来要不要改成「表头说话就绝对信」单独裁。
- bellIsReal / nudgeVerdict 等手册协议相位仍无机械 runner（#63 只机械化了 v2Boots +
  gapNotifRoute 两个缺口）；bellIsReal 的落点判据已随 #63 改判 home，下次有人手跑协议别懵。

## Blockers / Risks

- 无硬 blocker。
- 🟠 **别单独 push main**（`ahead 21`）：前端 push 即自动上产、后端容器要人手换，两件事同窗口做。
- 🔴 **在 worktree 里重冻像素＝没重冻**：`__snapshots__/` 是 gitignore 的单机产物、每 worktree
  一份。真比对只在主检出上有意义；红了先比 mtime 再谈漂移。**现基线 36 张**（#63 起
  closerlook 出列），`*-closerlook-*.png` 已删。
- 🔴 **像素门不密闭：后端够不着 → `home` 先红 → 你要看的那几屏根本没被采样**。跑像素门前
  三件套：dist 用 `VITE_AVERY_API_BASE=<你的口>` 重打 + 那个口上真有后端（带
  `AVERY_DEMO_SEED_DIR`）+ `AVERY_CORS_ORIGINS` 放行 preview origin。判定法：src 回退上一票
  再跑——还红就是环境。
- 🔴 **门驱动 store 还是真部件，决定它能不能看见「接线」型 bug**。「新加入口」的票，
  判据必须落在入口本身；落点类判据要**先离开目的地再触发**，否则「接线整个失灵」会假绿
  （#63 的 gapNotifRoute 设计笔记）。
- 🔴 **`_GUARDED` 这类精确匹配路由表，带路径参数的新端点永远命不中**。
- 🟠 **门的环境缺一样就以「像回归」的形态假红**（三轮实收五条：seed 目录 / 写死 API 口 /
  缺 `AVERY_PUBLIC_BASE` / 写死 5173 / **`AVERY_PUBLIC_BASE` 指错端**——见 Notes 第一条）。
  起门最小清单：`AVERY_BRAIN=mock` + `AVERY_EXTRACTOR=heuristic` + `AVERY_EMBEDDINGS=keyword`
  + `AVERY_DEMO_SEED_DIR` + `AVERY_PUBLIC_BASE=<后端口>` + `AVERY_CORS_ORIGINS`；跑门时
  `VERIFY_BASE` **和** `VERIFY_API` 都要给。
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
- ⚠ **各票收尾必须重写本文件**，这是 AGENTS.md 的 DoD，不是可选项。
