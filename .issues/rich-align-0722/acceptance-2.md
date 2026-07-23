# 验收手册 · 批次② · team 目录化（04）+ 项目手编 CRUD 写端点先例（05a 后端半）

> 满态对齐战役（rich-align-0722）· 2026-07-23 AFK 夜跑产出。
> **push=人工闸**：Danny 人测点头后才 `git push` 上产。本批 commit 已攒分支
> `claude/layout-real-components-27b594`（`62b1464` 04 · `f1ca46d` 05a-be），未推。

---

## 🔴 抬头必读：账实修正（本次夜跑发现，Danny HITL 可否决）

kickoff prompt 说「issue 01–04 已交付全绿并 commit，05 已拆成 05a/05b（见
issues/05-split-decision.md）」。**实况核对**：
- git 只有 01/02/03 commit（03=`a5f429e`，CURRENT_STICK=8 与之对齐）；**issue 04（team 目录化）未做**
  ——`a5f429e` 只为 issue-03 的自述开关碰过 TeamScreen，没做目录化。
- `issues/05-split-decision.md` **原本不存在**（本次已补写，内容照 prompt 的口头拆分 + 记录此账实不符）。

**06 的 Blocked-by 明列「03、04、05」**——04 是 06 的硬前置（人员 CRUD 落在目录形态里）。若跳过 04 直接做
06，06 得返工。故本次执行序 = **04 → 05a → 05b → 06 → …**，把 Danny 以为已闭的 04 先补上。
这不碰 push（人工闸）。**若 Danny 认为 04 当时是别的口径（如故意留作 upload-first），可在此否决、回退 `62b1464`。**

---

## 0. 环境（收工保持运行）

- 后端 mock：`http://127.0.0.1:8137`（brain=mock / heuristic / keyword）——**在跑**。
  🔴 **它是 05a 后端改动之前的进程**：04（前端）HITL 不受影响；若要 HITL 05a 的写端点，先按 runbook §0
  杀 8137 重起（新代码才生效）。
- 前端 preview：`http://localhost:5173`——**在跑**（挂 04 终局 dev 构建 `62b1464`）。
- 🔴 **验收入口（必带参）**：`http://localhost:5173/?v=2&mode=live&lang=zh`（aurora 皮加 `&look=aurora`）。
- 她方参照（对照板/并排）：`cd D:\cr-live && npm run dev`（:3100）。

## 1. 机器自验（本批全绿，红先行有据）

### 1a. issue 04 · team 目录化（前端，9 门相关面全绿）

| 门 | 结果 | 备注 |
|---|---|---|
| `verify-team-directory-04.mjs`（新 e2e，两形态+两世界） | **18/18** | 空态上传主位→目录形态；3 列几何=关系断言（前 3 同顶+第 4 换行，实测 tops=[620,620,620,708]）；关世界全壳情绪词零出现；开世界口径角标「按本人自述筛选」+情绪 chip 无 count+情绪词只在锚点内+点选真过滤 |
| cr-alignment `SPEC_STICK=9`（新增 stick9 四行团队结构护栏） | **47/47** | 目录 wrap/全部 chip/网格/display:grid 恒在；stick6/7 富字段行零回归 |
| verify-status-truth | 31/0 | 项目卡/状态点锚点保活（目录化不碰 projects 栏） |
| verify-button-family | 12/0 | 新 `.lite-team-filter-chip` 进筛选类目白名单（同 gap-chip） |
| verify-aria-zh | 4/0 | chip/补传入口全中文 aria，0 可疑拉丁串 |
| verify-home-skeleton | 17/0 | 不碰 home 骨架闭环 |
| verify-skin-phases | 16/0 | 上传部件 `.upload-panel` 两分支都在（skin probe 读得到） |
| selfreport-switch-03（关世界后端） | 8/0 | issue-03 人卡零数字路径未被目录化破坏 |
| 扫雷 sweep（9屏×2皮×3视口）+ `--selftest` | NEW 0 · selftest 8 PASS | D 系 chip 尺寸/焦点无新缺陷 |

- 像素：**净影响 0**——`transport=stub` 在 team 屏是空态（目录只在有数据分支，tracked 基线一像素未变）；
  仅 `home-mobile` 先天漂移 2 张（07-21 冻结非回归）。目录两世界截图存
  `eval-harness/reports/pixel-evidence/04/`（gitignored 同机有效，见 §3）。

### 1b. issue 05a · 项目手编 CRUD 写端点先例（后端半，全离线 pytest 全绿）

| 门 | 结果 | 备注 |
|---|---|---|
| `test_project_crud_05a.py`（新，8 例） | **8/8** | 内存 CRUD 合约 + pg 序列化往返（archived/provenance 存活）+ HTTP 端点（无鉴权/坏 token→同体 404、缺 title→422、PATCH 置空→absent、archive 可 restore、无 DELETE 路由→405） |
| 全量离线套 `-m "not smoke and not seedgate and not needs_keys and not needs_db"` | **3398 passed / 0 failed** / 65 deselected / 4 xfailed | additive 字段（archived/provenance）零回归；修 test_ingest_nonblocking 的 fake ctx 补 archived_project_cards 存根 |

- 电池独占跑（无并发 agent）。C 区调包者本批未触及（04 无 dist 调包；05a-be 无前端）。
- 探针落点 tracked：`.issues/rich-align-0722/verify-team-directory-04.mjs`（不入 roster）。

## 2. HITL 逐屏看点（Danny 人测路径）

**准备**：无痕窗开 `http://localhost:5173/?v=2&mode=live&lang=zh`（清 `lite2:` 键或无痕）。上传一份 16 人花名册
（纯中文名，格式 `姓名 | 职位 | 部门 | 司龄 | 负责`，3 个部门便于验分组），或走「示例团队」门。

**team 目录形态（issue 04）**
1. 进「你的团队」屏。**看点**：右栏 = 上传部件（降位不卸载）+「人员」段。人员段是**目录形态**：
   - 组别筛选 chip 行：「全部 N · 部门A n · 部门B n …」（组别 count 徽章）。选中态深底白字（对齐她方）。
   - 3 列成员卡网格（头像/姓名/职位/负责行）。点部门 chip → 网格只剩该组；点「全部」→ 复位。
2. 并排她方 `http://localhost:3100` /people 通讯录：结构（筛选 chip + 多列卡）与数值令牌应当量；**文本零抄**。
3. **开关世界**（人身数字开关，默认关）：
   - 关世界：**无情绪 chip 行**，全屏无「如常/偏紧/吃紧」。人卡零数字（现行 moat）。
   - 开世界（若在跑开关开的后端/或看截图 §3）：组别行下多「按本人自述筛选」口径角标 + 情绪 chip
     「全部·如常·偏紧·吃紧」（🔴 **无 count 徽章**）；人卡底部「自述情绪 X」在出处锚点内。

**项目手编 CRUD（issue 05a）——⚠️ 仅后端就绪，前端未落**
> 本批只交付了 05a 的**写端点**（后端）。前端的「加/改/归档/恢复」按钮与出处角标**尚未接线**，
> 界面上还看不到。写端点可用 curl 验（需先重起 8137 到新代码），但产品级 HITL 待前端半交付。

## 3. pixel-evidence 索引（Danny 晨审签认）

- `eval-harness/reports/pixel-evidence/04/`：
  - `README.md`：净零结论（04 对 tracked 基线净影响 = 0，机理同 01/02）。
  - `aurora-team-directory-offworld.png`：关世界目录（组别 chip + 3 列网格 + 上传部件，零情绪词）。
  - `aurora-team-directory-onworld.png`：开世界（口径角标 + 情绪 chip 无 count + 人卡自述情绪在锚点内）。
- 结论：**本批无改动屏需重冻**（team 的 4 张 stub 基线是空态，未变）；`home-mobile` 先天漂移处置归 Danny 晨审。

## 4. 拍板复核项①-④ 签认位

> 四项属 issue 03/06/09 的设计决策。03 已交付（自述开关口径），04/05a-be 不新增涉及项；列此为战役级台账。

| # | 复核项 | 归属 | 本批状态 | Danny 签认 |
|---|---|---|---|---|
| ① | 「重新开始」全清含语言/观感（清 `lite2:*`） | 09 | 未开始 | ☐ |
| ② | 人身数字「抽取恒存自述槽、投影随开关」 | 03（已交付） | 本批不涉 | ☐ |
| ③ | 人身数字开关默认态 = 关 | 03（已交付） | 本批不涉（04 关世界实证零情绪词） | ☐ |
| ④ | 不对称承认：CRUD 手填他人负载/情绪硬 422 vs 文档通道自述行作者不可验 | 06 | 05a-be 已立「项目字段全量可编辑、人身禁键 06 侧执法」的一半；06 落 person 硬 422 | ☐ |

**本批 Danny 签认**：dev server 人测 §2 team 目录两形态无误 → ☐ 通过 → （连同后续片）授权 `git push` 上产。

## 5. 🔴 本批**未做**（下个 session 从这里接，序与依赖已在 issues/README.md + 05-split-decision.md）

一句话：**04 全绿 + 05a 后端先例全绿**；05a 前端半及 05b/06–11 未动。

- **05a 前端半（紧接，最高优先）**：写端点已就绪（`f1ca46d`），前端要接：
  - `transport.ts`：+`archived_projects?`/`provenance?` 类型 + 4 个写 API（postProject/patchProject/archive/restore）。
  - store：CRUD action（写后 refetch /team 或乐观更新）。
  - `ProjectsScreen`：页头右端 primary「添加项目」按钮 → 内联表单（标题/负责人/状态/截止…）→ POST。
  - `DetailOverlay`：页脚操作区——编辑态（字段原地变输入框，保存 primary+取消 ghost，出场动画快照对编辑态单独处理）
    + 归档/恢复（软删入网格下方折叠区）；逐字段出处角标「手动编辑」（读 card.provenance[field].origin==='manual'）。
  - i18n + CSS + 新 e2e（T8 添加/编辑/归档/恢复 + 出处）+ cr-align **stick 10**（添加按钮 primary rect/prop）+
    门（aria-zh/button-family/扫雷/verify-p0）+ 像素（projects/详情浮层若入基线）。**交付后 CURRENT_STICK→10。**
  - 后端契约（已定，前端照此接）：`{context_id, project: <card>}`；card.provenance = `{field:{origin,source,updated_at}}`；
    payload.archived_projects（空即缺席）；PATCH 只发要改的键，显式 null=清空→absent。
- **05b**：重传手编赢（origin=manual 字段 ingest 不覆盖）+ 冲突记录（claim=手编值/evidence=文档原句）→
  前端复用「多看一眼」claim-vs-evidence 冒提示。造真合并管道，不挡 07。
- **06**：人员 CRUD——直接复用 05a 的 ProjectWriteMixin 模式（新增 people 端点 + PersonEntity 同款
  archived/provenance）；🔴 写侧红线：负载/情绪禁键→422（人身数字只能来自文档自述通道）；落点=04 的目录形态。
- **07** 三亚富语料 pack（16 人/6 项目/SOP，原地换 demo-seed + 同 commit 改 test_demo_claim + verify-onboard-gate 期望）·
  **08** playbooks 方法库（stick 12）· **09** 重新开始（清 lite2:*）· **10** 登录隔离（Supabase MCP 取值，C 区门殿后）·
  **11** 收官（全 25 门电池两轮 + 对照板重拍 + 像素全量 + acceptance 汇总 + handoff）。

## 6. 本批已知留后

- zh directory 11 键 + risk/milestone 旧键：手写 draft，待 Danny 审字或下次 M3 directed pass（zh.ts 头已标 /04）。
- 05a 前端未接：写端点已上线但界面无入口（见 §5）；8137 需重起到新代码才能 curl 验写端点。
- 像素：目录形态无 tracked 基线覆盖（stub 空态盖不到，同 01/02 富字段）——几何靠 e2e 关系断言 + Danny 晨审并排。
