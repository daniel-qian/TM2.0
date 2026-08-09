# Session Progress Log

> 📢 本文件是**当前状态快照，整体重写不追加**。历史都在 git（`git log` + 各 `.issues/*/receipt*.md`），别在这儿堆编年史。
> 启动路径见 `AGENTS.md` Startup Workflow：读本文件 + `feature_list.json`，跑 `./init.sh` 确认绿，再开工。

**Last Updated:** 2026-08-09（**0808 重构战役 wave 1 的 S2 落 main**：#74 + #77 + #76
三票；wave 1 的 S1（#75 议事室 + #73 附件）是并行线，状态见它自己的交接。仍未 push、未上产）

## Current State

- **git**：`main` = `021bc58`（S2 四个 commit：`702287a` #74 → `b3b56ce` #77+#76 →
  `3aa77e5` upload_guard 改判 → `021bc58` #76 导航样式）。回执
  `.issues/redesign-0808/receipt-76-77-74-files.md`。**没有 push**（见 Blockers）。
- **像素基线现状**：两套共 52 张。#76 改了资料库屏 → **主检出对真基线比对，恰好
  aurora/paper × desktop/mobile 四张 files 空态漂移，其余 46 张逐字节未变**（比对前后
  md5 全表对过＝真比对不是首写）；**这 4 张已在主检出重冻**，复跑 8/8 绿且零改写。
  16 张数据态全程未动（那套 spec 只采 home/team/projects）。
- **✅ 生产仍停在 08-07 白天那一版**（`main-20260807-190332` = main `99d83f7`）。
  gap2 三票 + 三轮演习批 + #68 + #70 + #69/#71 + #72 + **本批三票**都没有上产。
- 🔴 **迁移账（上产时按这个来）**：
  - **T9 需要 `0015_form_submissions_auto_key.sql`**（increment-only、`_ensure_schema()` 自动重放）。
  - **#77 不需要迁移**：删除只动既有表的行，没动任何顶层列（判据一句话：动 dataclass 里被
    整块 jsonb 装着的字段 → 免迁移；动表的顶层列 → 必须迁移）。
  - #78 落地后加 **0016**。
- 🔴 **合的都是本地 main，没有 push**。前端 push main 即自动构建上产，push + 换后端容器
  必须在统一上产 session 的**同一个窗口**里做。

## 本轮做完的（2026-08-09 · S2 = #74 + #77 + #76）

回执有全部细节（含 6 条变异台账、像素真比对账、刻意没做的边界）。这里只留会影响下一个人的：

- **#74**：`file_cards()` 补发 `source_key`（值取**已解析**的 `sd.source_key or sd.filename`
  ——与 n_chunks join、与 `_file_entry` 匹配同一把尺）→ `LiveFileEntry` additive 字段 →
  `askRefs` 文件候选 `id` 改用它、label 仍 filename、重名消歧**复用 person 的 dupeTeam 槽位**
  （AskRefComposer 一行没动＝与 S1 冲突面为零）。补传重名不再静默引到另一份文档。
- **#77**：删除走**独立模块** `avery/ingest/file_delete.py`，不进 mixin、不进 Protocol
  （`test_registry_protocol` 零变动——它有一条 `assert "delete" not in protocol_members()`）。
  端点 `DELETE /team/{id}/files/{key:path}`，**按 source_key 寻址不按 idx**。
  删材料面/信号/裁决/相关冲突 + 重物化 facts.md + store 重铸；**不删人卡/项目卡**（血缘不够
  ——实体只有单值 source 且 keep-first、provenance 对只 ingest 过一次的公司整个是空 dict）。
  顺带补上 `upload_guard` 的缺口：DELETE 此前在 ASGI 边缘零限流。
- **#76**：段落按频率重排（①资料 → ④表单 → ②a补 → ②b新公司 → ③切换）+ 锚点导航；
  ②b 语义错位靠**新增 `newCompanyStatus`** 修（`ingestStatus` 五个写点一行不动——它是约二十
  道门的等待锚）；文件表补上传时间列 + 排序；谁交了提位 + 手动刷新钮；链接一键全复制；
  静默蒸发四形态给可见降级；删除键 + **二段确认**。
- **门**：新门 `verify-files-ia.mjs`（17 判据）进 ROSTER A 区，补的是「lite2 清单零自动覆盖」
  这块真空白；`verify-at-references` 63 → 70；pytest **4028**（+18）；needs_db 全量 **109**；
  A 区 **32/32**、C 区 **3/3**。

## 上几轮做完的（详情全在各自回执，这里只留会影响下一个人的）

- **#72 建议追问 chips + 快问收敛**——`receipt-72-followup-suggestions.md`。
- **#69+#71 会话流+灰提示**——`turns: LiveTurn[]`；离开议事室/刷新=对话结束（刻意不持久化）；
  文案长度闸开显示宽度不开字符数（碑）。
- **#70 @ 文件引用两修**——候选轮转发牌 + `_file_doc_lines` 注入真原文；核实中撞出 #74。
- **#68 数据态像素基线**——born-red 按视口逐个验；数据态基线必须钉页面时钟。
- **#66+#67** @ 弹层空间感知 + askRefs 唯一构造器。🔴 CSS 包含块/裁剪必须浏览器实测。
- **#65 差距块默认展开** · **#64 议事室 @ 引用回归** · **#63 并屏退 tab** · **#61 / T9–T11**。

## What's Next（按优先级）

1. **0808 UIUX 重构战役续跑**（档案 `.issues/redesign-0808/`，四路侦察正源都在，
   「别重新侦察」密度）：
   - **wave 1 剩余**：S1 = #75 议事室 Claude 化 + #73 附件上传（并行线，状态见其交接）。
   - **wave 2**：#78 真线程（**依赖 #75 落 main**；带**迁移 0016**）。
   - **wave 3**：#79 文案全量批改（**等 #75-#78 全落**，像素全量重冻只来一次）；
     见仁见智 8 条在 `tickets.md` 末尾待 Danny 勾。
     ⚠ #79 §5 表里 `upload.againBody` 那句「用**上面**那个口子」在 #76 重排之后方位词要按
     新序复核（④ 段被插到了两者之间）。
2. **复演（第 5 轮）**：战役各波落地后全内容演习；顺带补验第 4 轮遗留两点。
   兜底：当前 main 四轮演习全绿，临会随时可起演习环境应会，不带病上会。
3. **统一上产**（gap2 三票 + 三轮演习批 + #68 + 重构战役全部）。🔴 push 与换后端容器同窗口；
   **0015 + 0016（#78 落地后）必须落地**；上产后先设 `AVERY_PUBLIC_BASE` 再验表单。
4. **T8 两条记录**：① 议事室引用编号形状；② 今天页证据行机器形状（ADR-0033）。
5. **给 `/health` 加版本字段**。
6. carry-over：Claude 式会话侧栏（0808 拍板本轮不做）· 议事室流卡死无前端超时（#71 已知边界）
   · 判读卡 4 段死渲染 + 后端已发前端未消费 7 类字段 · r2 未开票发现 · gate-run 迁移 ·
   files-hub #26–#29 · 换血抢救 #31/#32 · v01 退役 #33 · **真机零覆盖（iOS/微信，最高优）**
   · 成本票 #30 · 真 brain 分流取证 · 全量 feat-063。

## Notes（顺手发现，没顺手修）

- 🔴 **`test_decision_grading.py::test_a_freshly_claimed_sample_team_is_not_told_its_material_
  is_stale` 是时区跨零点的潜伏假红**：`uploaded_at` 记 UTC 日、断言用 `date.today()` 取**本地**
  日 → UTC+8 上每天本地 **00:00–08:00 必红**（`TZ=UTC` 跑就过，两向都实测）。产品侧同源：
  那八小时里「刚传的」会被判成前一天。修法涉及 `as_of` 取 UTC 还是本地的语义取舍，另开票。
- 🔴 **`KeywordStore` 的分词器是 `[a-z0-9]+` —— 纯 ASCII，对无空格中文 `query()` 恒空**
  （`store.py:37/46`）。任何拿中文串断言「检索得到/检索不到」的判据都是**空跑**。值得单独
  扫一遍全仓还有哪些门骑在这个假设上。
- **`assertFilesSurfaceV2` 仍只有手工 console 门、无机械 runner**（改判扫描暗区）；它「只查
  行数>0 且每行合规」的假绿口已被新门 `verify-files-ia` 堵住（`.upload-files` 全局恰好一份）。
- **删除后人卡/项目卡不收缩**（#77 裁定），连带悬空：`FieldConflict.values[].doc_key`、
  `references` 找不到时静默兜底、`extraction.granularity` 在 pg 侧本就不往返。
- **逐行「复制」两级降级都失败时仍无可见反馈**（既有设计，URL 恒可见可选）；#76 只给
  「复制全部」补了失败态。
- **switchContext 换公司时 `turns`/`run` 不清**（涉及在飞流 `_abort` 归属，独立裁）。
- **中文名互为前缀仍双中**（「王力」vs「王力宏」）：词边界对 CJK 刻意不阻断，宁多勿漏。
- **真 brain 的 followup 质量离线采不到样**；**历史轮没有折叠**（出处只挂分析过程面板）。
- **决策卡 `reason` 在 mock 语料下是空的**；**`tests/test_at_references.py:90` 潜伏 typo**
  （`rep.errors` 应为 `parse_errors`）。
- **`>` 开头的材料块结构性不可引用**；**facts.md 指针不是单射**。
- **数据态像素只覆盖 home/team/projects**；**议事室两套基线都只有空态**。
- **弹层 `--lite2-surface` 背景带透明度**；**空态弹层高度受 `.nexus-empty` 钳制**。
- 🔴 **`AVERY_PUBLIC_BASE` 必须指后端自己的口**；**粒度闸够不着跨批次**；
  **`_people_from_roster` 位置兜底会顶掉空格子**。
- bellIsReal / nudgeVerdict 等手册协议相位仍无机械 runner。
- **@ 引用候选检索纯前端内存**；playbook 卡无 id、标题即稳定键。

## Blockers / Risks

- 无硬 blocker。
- 🟠 **别单独 push main**：前端 push 即自动上产、后端容器要人手换，同窗口做。
- 🔴 **worktree 里跑 visual＝首写基线不是比对**（本轮又实证：50 张 mtime 全是当次，复跑对着
  自己刚写的基线全绿）。真比对只能在**主检出**做，且**比对前后 md5 全表对一遍**才算数。
- 🔴 **像素门不密闭：后端够不着 → `home` 先红**（本轮实证：主检出 CORS 写成 5383 而 preview
  在 5384，第一轮 diff 指向 home-mobile；改对就恰好是那 4 张 files）。三件套照旧。
- 🔴 **门全绿 ≠ 真部件被验到**（本轮实收：导航条三条 DOM 判据全绿，而屏幕上是一串裸的蓝色
  下划线链接、还掉出了内容列——**截图双视口人眼过**才逮到）。改完布局必截图。
- 🔴 **`.lite-files-scroll` 的居中是一组逐个子元素点名的选择器**，往滚动壳加新直接子元素
  必须同时加进那份名单（已在 CSS 里钉了注释）。
- 🔴 **uvicorn 不热重载**：改了后端却跑到旧行为，本轮踩了两次（#74 的 source_key、#77 的
  删除端点，都以「改了没反应」的形态假红）。动后端必按端口杀了重起。
- 🔴 **`display:none` 折叠会让一道门出现四种并存结局**（hasText 命中→click 超时崩 /
  innerText 空串假红 / count 免疫假绿 / 段级 screenshot 抛错）。#76 因此不做折叠。
- 🔴 **变异必须产出干净的红，不能崩**：本轮 M76-A 第一次跑把门崩成 TimeoutError，已把交互
  步全部改成 count 判空 + `click({timeout})` try/catch。
- 🔴 **同一条判据要配同一个变异**；**belt-and-braces 让内层规则免疫变异**；
  **自证前提不能当判据**（本轮实收：「候选有两条」在病根代码上是绿的——候选列表根本不去重）。
- ⚠ **B 区 `verify-null-owner` 把 5173 写死在 `:28`（不吃 VERIFY_BASE）**：有并行线时在隔离
  端口上只能记「没跑」。本轮即如此。
- 🔴 **`./init.sh` 和 run-battery 的收尾重建都 `vite build` 不带 api base** → dist 落回生产
  域名。跑任何上传型门/截图之前先重打带 `VITE_AVERY_API_BASE` 的 dist。
- 🔴 **杀 npx 包装进程杀不死 vite 子进程**；stale 进程按端口杀。
- 🔴 **cwd 残留会把改动打到别的树**（本轮实收：一次 CSS 编辑用相对路径落到了主检出而不是
  worktree）。worktree 会话里路径一律显式。
- 🟠 **门的环境缺一样就假红**。最小清单：`AVERY_BRAIN=mock` + `AVERY_EXTRACTOR=heuristic` +
  `AVERY_EMBEDDINGS=keyword` + `AVERY_DEMO_SEED_DIR=tests/fixtures/demo-seed` +
  `AVERY_PUBLIC_BASE=<后端口>` + `AVERY_CORS_ORIGINS=<preview 的口>`；跑门给 `VERIFY_BASE`
  **和** `VERIFY_API`；preview 要 `--host`。
- 🔴 **本机 Docker PG 容器时钟来回跳 ~115s**；**needs_db 真库套**：
  `AVERY_DB_URL="postgresql://postgres:dev@127.0.0.1:5432/redesign0808"`（本轮新建的
  throwaway 库，109 条约 9 分钟）。**绝不对生产预检容器跑删除类测试。**
- 🔴 **本机 curl / argv / stdout 都按 GBK 啃中文**：中文只走文件（`git commit -F` / `gh api --input`）。
- 🔴 `e535ec9` commit message 是错的（真相在 `03a9824` erratum）；repo 级 stash 两条别人的
  存货；多个战役 worktree 仍挂着——三条都属删除/改历史闸，归 Danny。
- ⚠ **各票收尾必须重写本文件**（AGENTS.md DoD）。
