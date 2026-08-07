# Session Progress Log

> 📢 本文件是**当前状态快照，整体重写不追加**。历史都在 git（`git log` + 各 `.issues/*/receipt*.md`），别在这儿堆编年史。
> 启动路径见 `AGENTS.md` Startup Workflow：读本文件 + `feature_list.json`，跑 `./init.sh` 确认绿，再开工。

**Last Updated:** 2026-08-07（T8 收官自检跑完出 go；差距战役 T1–T8 全部落地，等统一上产 + HITL）

## Current State

- **git**：`main` = 差距战役 #50–#57 八票全在。T8（#57）是自检票，除回执与语料外**改了一处产品代码**
  （`avery/memory.py` 中文分词）+ **一条新门**（`tests/test_cjk_recall.py`）。
- **验证账实（本轮实测，非估数）**：后端离线全套 **3785 passed / 107 deselected / 4 xfailed / 0 failed**；
  `@needs_db` 全套 **98/0**（真 PG，8m02s）；前端电池 **A 25/25 · B 3/3 · C 3/3**；像素 40 张全绿
  （其中 4 张 files 是本轮人审后重冻）；i18n 894 叶子键 / 孤儿 0；
  端到端 `t8-e2e.mjs` zh/en/zh **连续三轮零新发现**。
- **⚠ 生产未部署，欠账仍在**：后端容器 `main-20260805-160609`；前端 Vercel 构建
  T1 交接记 `89b36e4`、0805 晚主会话实测线上是 `fa8d085`——**上产前先核实线上真实版本**。
  待上线：#45–#49 + 差距战役 T1–T8（迁移 0012/0013 由 `_ensure_schema` 幂等重放，不需人工 SQL）。

## 本轮做完的（2026-08-07 · T8 收官自检，issue #57）

回执：`.issues/gap-design-0805/receipt-T8-e2e.md`（逐轮发现 + 门 + 变异 + go/no-go）。

- **十段剧本端到端**（`t8-e2e.mjs`，真浏览器打真本地后端 + 真 PG）：传材料 → 回拨时间 →
  今天页三规则 → 冲突关闭出口 → 建链 → 员工填（正常/模仿攻击/同名歧义/过期/重复）→
  资料同构 → 回流人卡项目卡 → 今天页复检 → 议事室引用。语料在 `t8-fixtures/`，截图在 `t8-shots/`。
- **逮到一条真产品缺陷并修掉**：关键词 recall 对**中文语料恒返回空**
  （`memory._tokens` 只认 `[a-z0-9]+`）。mock 侧落空会兜底成一条形状完美的 `facts.md:1` 引用，
  所以七票加起来没红过。生产今天走 DashScope 语义排序不受影响，但 key 缺失/轮换的**降级路径**
  对中文客户＝零证据。改法：中日韩 bigram 分词；门：`test_cjk_recall.py` 9 条。
- **另外三条都是「门自己的锅」**：两条判据选择器/签名写错、两条空判据（`grade==='clear'` 真值是
  `can_proceed`；⑥b 选择态串批导致同名提交压根不存在）。后者是**变异测试**翻出来的。
- **像素基线陈货**：`*-files-*` 4 张停在 07-29/08-02（T3 在自己 worktree 里重冻过，
  `__snapshots__/` 是 gitignore 单机产物、每 worktree 一份，主检出从没更新）。人审后重冻。

## What's Next（按优先级）

1. **统一上产**：#45–#49 + T1–T8 一把上。先核实线上前端真实版本；后端从 main 构建容器 swap3、
   env 快照从**在跑容器**提取；迁移幂等自动建表。回执落 `.issues/`。
2. **HITL 端到端轮**（Danny 在主会话）：生产上走全链 + 重截全套截图。
   T8 留了三条**只记录未改**的给这一轮拍板：
   ① 议事室引用编号是 `facts.md:<行号>`，不是客户自己的文档名（人卡/今天页那两处已是 ADR-0028 形状）；
   ② 铸链 UI 送空工号（人卡不投影 `person_id`）→ 同名两人交的周报认不出是谁、自述整条丢弃
   （文档不丢字）。宁可不上卡是对的，但经理看到的是「交了却没反应」；
   ③ 今天页证据行是 `字段="值"` 的机器形状（ADR-0033 明定），演示时建议口头带一句怎么核对。
3. **三亚 demo 脚本更新**（碰头在下周）：新能力进 demo 主线；快问改为现场新建（旧 ask 死链不自愈）。
   `t8-shots/` 那 20 张可直接用。
4. carry-over：r2 未开票发现（`.issues/sweep/2026-08-02-r2.md`）· gate-run 迁移（aria-zh/cr-alignment）·
   files-hub #26–#29 · 换血抢救 #31/#32 · v01 退役 #33 · 真机零覆盖（iOS/微信，最高优）·
   成本票 #30 等真实客户量 · 真 brain 分流取证（要先给口径）· 全量 feat-063。

## Blockers / Risks

- 无硬 blocker。
- 🔴 **stale uvicorn 按端口杀**（`Get-NetTCPConnection -LocalPort <口> -State Listen` → `Stop-Process`），
  别信 ps 信行为；各 session 结束清自己起的端口。
  同族：`PgRegistry._schema_ready` 是实例级缓存——换库不重启后端＝迁移不重放。
- 🔴 **`vite preview` 默认只绑 `::1`**：`localhost` 通、`127.0.0.1` 拒。写死 127.0.0.1 的门
  （`verify-null-owner`）会以「连接被拒」的形态假红，而吃 `VERIFY_BASE` 的 A 区门全绿——
  **A 区全绿不代表 preview 绑对了**。起 preview 一律加 `--host`。
- 🔴 **在 worktree 里重冻像素＝没重冻**：`__snapshots__/` 是 gitignore 的单机产物、每 worktree 一份。
  改了界面的票合回 main 后，必须在**主检出**再跑一次像素门；红了先查 mtime 再谈漂移。
- 🔴 **本机 Docker PG 容器时钟来回跳 ~115s**：`created_at < now()` 判据间歇假红；
  要「够旧」就显式拨时间（`now() - make_interval(days => N)`，用 pg 自己的 now()）。
- 🔴 **本机 curl 把 argv 中文按 GBK 编**：中文只走 heredoc / 预先 percent-encode / `--input` 文件。
  同源坑：`python -c "…中文…"` 也会被啃——中文脚本写成 .py 文件再跑。
- 🔴 `e535ec9` commit message 是错的（真相在 `03a9824` erratum）；rebase 与否归 Danny。
- 🔴 repo 级 stash 两条别人的存货（`stash@{0}`/`stash@{1}`）；处置归 Danny。
- 多个战役 worktree 仍挂着（T1–T7 各自的 + 更早六个）——删分支/worktree 属删除闸，归 Danny。
- ⚠ 本机残留：Docker 库 `t8e2e`（T8 自检专用，与 teammaster/生产无关，留着可复查）；
  `teammaster-postgres-1` 容器在运行态。
- ⚠ **各票收尾必须重写本文件**，这是 AGENTS.md 的 DoD，不是可选项。
