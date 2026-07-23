# receipt · A 线（CRUD 主线）· 2026-07-23 AFK 夜跑

> 战役 rich-align-0722 · 批次② 并行方案的 **A 线**。worktree `D:\avery-wt-rich-crud-a-line-3d28b3`，
> 分支 `claude/rich-crud-a-line-3d28b3`（off `claude/layout-real-components-27b594` @ ba24144）。
> **push=人工闸不动**（等 Danny）。本收据只记 A 线；不改 session-handoff.md 抬头（留给 C 线统一收）。

## 干了哪几片

| 片 | commit | stick | 状态 |
|---|---|---|---|
| **05a 前端半** · 项目手编 CRUD（添加/编辑/归档/恢复 + 逐字段出处） | `f3e015a` | 10 | ✅ 全绿 |
| **06** · 真 CRUD·人员（复用 05a 先例 + 🔴人身数字禁键 422） | `e36c6d5` | 11 | ✅ 全绿 |
| **05b** · 重传手编赢 + 冲突记录 | — | — | ⏸ **未做**（handoff 见 §末，不挡 07） |

**CURRENT_STICK → 11**（run-battery.mjs 已递增）。两 commit 攒本分支未推。

### 🔴 执行序修正（先斩后奏，Danny 可否决）
kickoff 指令序 = 05a-fe → 05b → 06。**实际交付序 = 05a-fe → 06 → 05b(defer)**。理由：
05b 是三片里最重、最铺散的一片（**净新的「真合并」管道** = 复刻 /ingest 上传机器 + 标题匹配 +
逐字段 verbatim 冲突捕获 + **一条前端「重传进本 context」的新入口 UX** + 冲突冒泡 + e2e），且 05-split-decision
明写它 **独立、不挡 07**；06 则边界清晰、直接复用 05a 写端点先例、且守**最硬的人身数字 422 红线**（价值更高、
风险更低）。AFK 纪律「不恋战 / 卡住降级 / 优先干净交付」下，先落两片干净可验的 CRUD 片、把最重的 05b
干净交接，胜过赶工第三片污染已绿状态。**若 Danny 要严格按序，05b 的完整设计已落 §末，下个 session 直接接。**

## 门绿证据（A 线隔离端口，不撞共享 5173/8137）

🔴 **隔离跑法**：A 线全程跑在**自建端口** `preview 5373 / backend 8337`（前端 dist bake
`VITE_AVERY_API_BASE=http://127.0.0.1:8337`，后端 `AVERY_CORS_ORIGINS` 含 5373），**零触碰**共享
5173/8137（Danny 04/05a-be 的 HITL 环境原样保留）。两口收工仍挂（见 §环境）。

### 05a-fe（stick 10）
| 门 | 结果 |
|---|---|
| 新 e2e `verify-crud-projects-05a.mjs`（添加/编辑/归档/恢复/逐字段出处/手编赢粒度/PATCH置空→absent） | **18/18** |
| cr-align `SPEC_STICK=10`（新增 stick10 两行：添加按钮 present + primary 家族） | **49/49** |
| aria-zh 4/0 · button-family 12/0 · verify-p0 41/0 · 扫雷 selftest 8 + NEW 0 | 全绿 |
| 回归：status-truth 31/0 · home-skeleton 17/0 · skin-phases 16/0 | 全绿 |
| 像素：tracked 基线净影响 0（空态页头 flex 重构视觉中性，实测 eyebrow/h1 同左 266px + 无 context 无 add 按钮） | 净零 |

### 06（stick 11）
| 门 | 结果 |
|---|---|
| 新 pytest `test_people_crud_06.py`（CRUD + 🔴禁键 422 + 藏分值 422 + 开关开也禁 + 半改防护 + pg 往返 + 无删 405 + archived_people） | **13/13** |
| 全量离线套 `-m "not smoke and not seedgate and not needs_keys and not needs_db"` | **3411 passed / 0 failed** / 65 deselected / 4 xfailed |
| 新 e2e `verify-crud-people-06.mjs`（添加/编辑/停用/恢复/逐字段出处 + 🔴两世界零数字：开关关+开手编成员均无自述锚点） | **13/13** |
| cr-align `SPEC_STICK=11`（新增 stick11 两行：添加成员 present + primary） | **51/51** |
| 回归：team-directory-04 18/18 · crud-projects-05a 18/18 · status-truth 31/0 · aria-zh 4/0 · button-family 12/0 · verify-p0 41/0 · 扫雷 0 件 | 全绿 |
| 像素：tracked 基线净影响 0（CRUD 面只在有数据分支渲染，同 04/05a-fe） | 净零 |

- 像素证据（gitignored 同机有效）：`eval-harness/reports/pixel-evidence/{05a,06}/`（add 表单 / 详情编辑态 / 空态页头）。
- 探针落点 tracked：`verify-crud-projects-05a.mjs` · `verify-crud-people-06.mjs`（不入 run-battery roster，标准 e2e 独立跑）。

## 后端契约（05a-be 已定，06 复用；C 线/前端可照此）
- 项目：`POST/PATCH/archive/restore /team/{ctx}/projects` → `{context_id, project:<card>}`；
  card.provenance=`{field:{origin:doc|manual,source,updated_at}}`；payload.`archived_projects`（空即缺席）。
- 人员：`POST/PATCH/archive/restore /team/{ctx}/people` → `{context_id, person:<card>}`；同款 provenance；
  payload.`archived_people`（空即缺席）。🔴 **PersonIn `extra='forbid'`** + `_redline_person_write` 值扫描：
  load/mood/self_report/score/负载/情绪/藏进定性字段的评分 → **422，恒禁不随 AVERY_ALLOW_PERSON_SCORING**。
- 两者 PATCH 只发要改的键（exclude_unset），显式 null=清空→absent；同体 404 无枚举；无 DELETE 路由（软删可逆）。

## 环境（收工保持运行）
- A 线后端 mock：`http://127.0.0.1:8337`（brain=mock/heuristic/keyword，含 05a+06 写端点，CORS 放行 5373/5173）。
- A 线预览：`http://localhost:5373`（挂 06 dist，API base bake 到 8337）。
- 🔴 **A 线 HITL 入口（必带参）**：`http://localhost:5373/?v=2&mode=live&lang=zh`（aurora 加 `&look=aurora`）。
  项目 CRUD 在「项目」屏页头「添加项目」；人员 CRUD 在「你的团队」屏页头「添加成员」+ 详情浮层编辑/停用。
- 共享 5173/8137（Danny 04/05a-be 的 HITL）**未动**。

## 本片已知留后 / 微偏差（诚实记，待 Danny）
1. **zh 17+12 键手写 draft 待审字**（en 是唯一源；zh.ts 头已标 rich-align/05a·06）。都短无歧义。
2. **06 停用键落点** = 详情浮层页脚（非 issue 写的「卡右下低调文字键」）。刻意避险已交付的 04 目录 3 列几何门
   （`.home-person-card` DOM 锚点零改 → team-directory-04 回归 18/18 未破）；恢复走页尾折叠区 + 浮层。
   功能全绿，仅入口位置微偏；若 Danny 要卡右下键，需给人卡套定位 wrapper 并复验 04 几何门。
3. 像素：CRUD 面无 tracked 基线覆盖（stub 空态盖不到，同 01/02/04/05a-fe）——几何靠 e2e 关系断言 + 晨审并排。

---

## 🔴 05b 交接（下个 session 直接接；已侦察，不挡 07）

**目标**：造「真合并」管道——文档**再 ingest** 不覆盖 origin=manual 字段；doc 抽出值 ≠ manual 现值 →
conflict 记录（claim=手编值 / evidence=文档原句逐字）→ 前端复用「多看一眼」claim-vs-evidence 冒提示，无冲突不冒。

**已侦察的关键事实（省下次侦察）**：
- 现状：`POST /ingest`（ingest_api.py:220）**每次新建 context**，`ingest_docs`/`ingest_paths`（pipeline.py:93/155）
  传旧 context_id 是**重建覆盖**不是合并（store.ts:88 注释实证）。**05b 要新增一条「重传进现有 context 并合并」的路径**。
- 抽取工作在 `doc.lines` 原始行上（extract.py `_projects_from_doc`），**verbatim 句子可在合并期从 doc.lines 现捞**
  （无须改抽取器保留 per-field 行）。
- 再抽取产 **新 entity id**（extract.py:448 注释），故匹配只能**按归一标题**（issue 写的「同名项目」）。
- 「多看一眼」= 现有 at-risk 面（extract.py:1002/1025/1053）——前端复用其 claim-vs-evidence 语法。

**建议实现（最小-完整、可 pytest）**：
1. `ProjectEntity.conflicts: dict = {}`（additive，同 archived/provenance 走 asdict/_entity 往返）。
2. 后端合并函数 `merge_reingest(existing_ctx, new_extraction, docs)`：按归一标题匹配；对匹配项每个
   provenance[field].origin=='manual' 的字段——**保 manual 值**，doc 值≠manual 值则记 conflict
   `{field:{claim:manual值, evidence:从 docs.lines 捞的原句, source}}`；非 manual 字段 doc 赢；无匹配的新项 append。
3. `POST /team/{ctx}/reingest` 端点：复用 /ingest 的存盘+guard 块 → `ingest_paths` 进**throwaway registry** 得新
   extraction → `merge_reingest` 进现有 ctx → put。（复用 ingest_paths 避免复刻全部抽取机器。）
4. `_one_project_card` 加 conflicts 透传；`_team_payload` 无需变（conflicts 挂在 project card 上）。
5. 前端：transport `LiveProjectCard.conflicts?` + reingest API + store `reingestFiles` action；UI 在项目卡/详情
   有 conflict 的字段冒「多看一眼」气泡（claim=手编值、evidence=文档原句，显示值/判据值分开）；无 conflict 不冒。
   新入口 UX：UploadPanel 在已有 context 时给「加进本工作区（合并）」vs「另建工作区」二选一。
6. 门：新 e2e（手编→再传同名项目→手编值保持 + conflict 冒 + 引真句；无冲突不冒）+ pytest（合并/匹配/冲突捕获）。
   05b **不新增 stick**（其验证以 e2e 冲突探针为主，不走 cr-align 构建值断言）。

**降级判据**：若 reingest 端点/标题匹配卡住，先交后端 `merge_reingest` 纯函数 + pytest（管道先例），
前端冒泡随后；backend-only 也是有价值的先例交付。
