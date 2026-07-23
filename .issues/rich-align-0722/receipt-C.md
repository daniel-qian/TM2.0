# receipt · C 线（收尾链 08→09→10→11）· 2026-07-23 AFK 夜跑

> 战役 rich-align-0722 · 批次② 的 **C 线**（收尾）。在 **main** 上做（A+B 汇合已在 main/25269f9——
> 见下「汇合实况」），一片一 commit，攒 main 未推。**push=人工闸不动**（等 Danny）。
> handoff 抬头由本线收官（11）统一重写。

## 汇合实况（C0 · A+B 无回归）

kickoff 前置写「A、B 合回 campaign 分支再起 C」，但**实况：A、B 已合到 main**（`25269f9` =
`merge(A=d0ff290, B=7adf7d0)`，两者都 off campaign tip `ba24144`）。campaign 分支
`claude/layout-real-components-27b594` 停在 A+B 之前的 `ba24144`（是 main 的祖先，无独有提交）。
故 A+B 汇合＝main 本身，reconcile 已就位（`CURRENT_STICK=11`、cr-align-spec 并集含 A 的 stick 10/11、
B 无 spec 行）。C 直接在 main 上接（C 需要 07 的 SOP + 全部前序），不重做一个分叉汇合。

**C0 汇合无回归证据**：
- 后端全量离线套（四 deselect）**3415 passed / 0 failed**（= A 的 3411 + B 的 T9 之并集，additive 零回归）。
- 前端 A 区电池 `SPEC_STICK=11` **19/19 绿**（cr-align stick 11 CRUD 加钮 · onboard-gate 39/0 三亚 16 人 seed · 回归门全绿）。

## 干了哪几片

| 片 | commit | stick | 状态 |
|---|---|---|---|
| **08** · playbooks 方法库（SOP → 方法卡满态 2 列网格） | `99ace1d` | 12 | ✅ 全绿 |
| **09** · 重新开始+演示控制（齿轮第三行「重新开始」全量重开） | `<09>` | — | ✅ 全绿 |
| 10 · 登录隔离演示线 | — | — | ⏳ 进行中 |
| 11 · 收官（全电池两轮 + 验收表单 + handoff） | — | — | ⏳ |

---

## 08 · playbooks 方法库（stick 12）

**端到端真管道**：SOP 文档（`demo-seed/管理规范与升级红线.md` 的 5 个 `## 方法：` 小节）→ ingest
抽成方法卡 `{title, description, tags[]}` → payload 顶层 optional `playbooks` 键（缺席=没有 SOP，
absent≠none）→ playbooks 屏满态 2 列网格（方法卡=非交互 `<article>`，不渲染 button）；非 demo
空态维持 coming-soon 诚实标 + onboarding 勾选槽位。**方法库只读，无 CRUD。**

### 数据通道决策
选 **payload 顶层 optional `playbooks` 键**（仿 `archived_projects`/demoStatus optional 先例），
非独立端点——方法库只读、随 team payload 一次投影，三入口（/team · /ingest · /demo/claim）共用
`_team_payload` 单一装配点，加一处即三处齐。

### 后端（红先行 pytest → 实现）
- `extract.py`：`MethodCard{title,description,tags,source}` + `_playbooks_from_doc`（`## 方法：` 头
  → 适用行=description、标签行=tags 复用 `_OWNS_SPLIT_RE` 的 `、` 分隔；小节边界止于下一个 `##`，
  故 `## 说明` 免责段不成卡）；**无条件挂进 `extract()` router**（SOP 嗅探=`unknown`，走 materials 同款
  无条件路径，别被 doc_kind 分支挡掉）；`ExtractionResult.playbooks` + merge。
- `registry.py`：`playbook_cards()` + `_one_playbook_card`（absent≠none：空 description/tags 不发键）。
- `ingest_api.py::_team_payload`：加 `playbooks` 键（空即缺席，仿 archived_projects）。
- `llm_extract.py::_build`：`res.playbooks = self._chunker._playbooks_from_doc(doc).playbooks`（同
  materials 走确定性 heuristic chunker——**生产 LLM 铸母本时方法库也确定性长出**，不靠模型碰运气）。
- `pg_registry.py`：`playbook` 种类往返（put/get）——否则 pg-backed 生产 demo `get()` 丢卡。
- 红线：方法卡是 SOP 面（含「升级红线」「新人爬坡」等提员工的卡），但纯规范文本、零人身评分，
  `validate_extraction` 只扫 people+signals，method 面天然不过人闸（实证）。

### 前端（spec→门→码）
- `transport.ts`：`LivePlaybookCard{title,description?,tags?}` + `LiveTeamPayload.playbooks?`（absent≠none）。
- `PlaybooksScreen.tsx`：满态分支读 `rawTeam?.playbooks ?? []`——有卡→2 列网格（滚动壳 + 84px 顶让位
  夹层，同 projects 屏，清浮动顶栏）；无卡→空态（coming-soon + 勾选/回落槽位 + 回看向导，**逐字节
  保留** onboarding 槽位 `data-playbook-id` + `.lite-playbooks-slot-tag` 锚点）。
- CSS：`.lite-playbooks-{scroll,library,grid,card,card-icon,card-title,card-desc,card-tags,card-tag}`
  （paper `lite2.css` + aurora `look-aurora.css`：卡上白.97 + 图标 data-tone 四色渐变 + 标签蓝软底 +
  lite2-rise 入场）。网格 `repeat(2,minmax(0,1fr))` 窄屏塌 1 列；图标 40×40 方形（aspect-ratio:1）。
- i18n：en.ts 5 新键（`playbooksLibrary{Eyebrow,Title,Sub,Aria}` + `playbooksCardTagsAria`）；
  zh.ts 5 键**手写 draft 待 Danny 审字**（头已标 rich-align/08）。

### spec / 门改动
- cr-align-spec 新增 **stick 12** 四行：`playbooks.gridPresent`(count 1) · `cardCount`(count 5) ·
  `gridDisplay`(prop grid) · `cardIconSquare`(rect width 40, 前向设计值 spec→码)。
- **stick 4 `badge.playbookTagWeight` 改选择器** slot-tag → `.lite-playbooks-card-tag`（同 commit 改行并
  注明）：cr-alignment 种子加了 SOP 文档→playbooks 屏渲染满态网格（非空态槽位），tag 量点随之移到方法卡
  标签徽章；空态 `.lite-playbooks-slot-tag` 仍保 700（AFK 只查其在场）。
- `verify-cr-alignment.mjs` 的 `SEED_DOCS` 内联一份 5 卡 SOP 文档（doc_kind 嗅探=unknown，只投
  playbooks+materials，不加人/项目，不动既有几何行——实测世界仍 2 人/1 项目）。

### 门绿证据（全离线 mock 三件套 + 三亚 seed，绝不碰 minimax）
| 门 | 结果 |
|---|---|
| 新 pytest `test_playbooks_08.py`（抽取 5 卡/标题标签逐字/`## 说明`不成卡/absent≠none/满态投影/无人评分/LLM 路径确定性投卡） | **8/8** |
| 全量离线套（四 deselect） | **3423 passed / 0 failed**（additive 零回归；同 commit 补 `test_ingest_nonblocking` 的 mock ctx 加 `playbook_cards`） |
| 新 e2e `verify-playbooks-08.mjs`（空态诚实降级 + 满态 5 卡 + 标题/标签逐字 + 2 列关系几何 + 非交互 article + 零 console error） | **13/13** |
| cr-align `SPEC_STICK=12`（stick 12 四行 + stick 4 repoint） | **55/55** |
| AFK `verify-afk-onboard-08.mjs`（assertOnboardPersist 勾选槽位持久 + assertPlaybooksEmpty 诚实空态） | **2/2** |
| A 区电池 `SPEC_STICK=12`（button-family/aria/contrast/p0/onboarding-returning/onboard-gate 回归） | **19/19** |
| 像素：desktop 2/2 全绿（playbooks-desktop 零 diff）+ mobile playbooks 零 diff | **净影响 0** |

- 像素证据（gitignored 同机有效）：`eval-harness/reports/pixel-evidence/08/`（满态网格截图 aurora/paper +
  目检结论 README：净影响 0，同 CRUD；满态网格供晨审并排她方 /playbooks）。
- 新探针 tracked：`verify-playbooks-08.mjs` · `verify-afk-onboard-08.mjs`（AFK 相位此前无独立跑器，本片补上）
  · `capture-playbooks-08.mjs`（满态取证）。均标准 e2e 独立跑，不入 run-battery roster。

**CURRENT_STICK → 12**（run-battery.mjs 已递增）。

### 已知留后 / 微偏差（诚实记，待 Danny）
1. **zh 5 键手写 draft 待审字**（en 唯一源；zh.ts 头已标 rich-align/08）。都短无歧义。
2. **description = 适用行**（`{title,description,tags}` 单描述串取「适用：」行；要点列表卡内不展开，
   留将来「详情展开」态——那时方法卡才升 button，button-family 白名单同 commit 补）。
3. 像素：满态网格无 tracked 基线覆盖（stub 空态盖不到，同 01/02/04/05a/06）——几何靠 stick 12 +
   verify-playbooks-08 关系断言 + 晨审并排。

---

## 09 · 重新开始+演示控制（无 stick）

齿轮设置菜单加第三行「重新开始」（两击确认防误触）：清 **lite2:* localStorage 全量（含语言/观感
偏好）** + 忘光全部 owner_token + 回 onboarding 闸门。演示 10 秒复位下一场。纯前端 + localStorage，无新后端。

### 关键设计（含 recon 逮到的两处历史坑）
- **🔴 whitelist-free 全清另起一条路径**：`wipeLite2LocalStorage`（换账号用）07-20 起有
  `KEEP_ACROSS_ACCOUNTS` 白名单**保留** lang/look（记忆条目「按前缀整段清」已过时）。重新开始要回
  出厂全清，故新写 `wipeAllLite2LocalStorage`（无白名单）**与换账号分开**——`verify-auth-form ⑨`
  （换账号保留偏好）因此零波及。
- **store 层全量重开 action `restartAll()`**（AuthPanel.tsx，复用 clearCompanyScope 的 teardown +
  resetLite2MemoryStores）：forgetAllOwnerTokens（已存，复用）→ useLite teardown → 三 store 内存态
  回出厂 → whitelist-free 全清 → in-memory lang/look 回出厂（`useLocaleStore/useLook.setState` 绕开
  persist，故清空的 lang/look 键**保持空**）→ goScreen('home')。
- **闸门重弹的 hadContextOnLoad 冻结坑**：`OnboardGate.tsx` 的 `hadContextOnLoad` 冻在开页那一刻。
  演示场景是无痕开页后才 claim，故冻在 false → 重置 onboard status:unseen 即经 selectWizardOpen 重弹，
  **不设 forceOpen**（保留 Escape「先随便看看」逃生门）。
- 菜单第三行是**单动作按钮**（`.lite-btn--danger`，非 nth 开关组）——不动 lang/look 两行顺序/嵌套
  （verify-switchers/auth-form 按 `.nth(0/1)` 索引它们）。

### 门绿证据（全离线 mock 三件套 + 三亚 seed）
| 门 | 结果 |
|---|---|
| 新 e2e 闭环 `verify-restart-09.mjs`（无痕→闸门→一键三亚 16人/6项目→切 paper→两击重新开始→lite2:* 键全空含偏好+owner 忘光+闸门重弹 doors+骨架在+零 console error） | **15/15** |
| `verify-onboard-gate.mjs` 加**世界 F**（重启出厂：闸门重弹 doors/context 锚清/onboard 键清/骨架在，与世界 C 的 pause 语义不冲突；世界 A-E 回归） | **46/0** |
| `verify-switchers.mjs` 加**重启世界⑥**（全清含语言/观感回出厂 lite2:look/lang:v1=null；④/⑤ 记忆契约不变） | **27/0** |
| verify-auth-form（C 区殿后独占+跑完重建 dist；⑧ 语言开关经齿轮 + ⑨ 换账号**保留**偏好——证明 restart 全清与换账号保留是两条路径） | **57/0** |
| A 区电池 SPEC_STICK=12（button-family 含新 `.lite-btn--danger` 重新开始钮 + aria-zh 含新 restartAria + home-skeleton + p0 回归） | **19/19** |

- 新探针 tracked：`verify-restart-09.mjs`（闭环）。verify-onboard-gate/switchers 为**扩世界**（既有门加行）。
- i18n：en.ts 3 新键（restartAction/restartConfirm/restartAria）；zh.ts 3 键手写 draft 待审字（头已标 09）。
- 拍板复核项（收官表单）：**①「重新开始」全清含语言/观感**——照共识「清 lite2:*」原文执行（whitelist-free），
  要保留偏好属改共识不属改实现。
- 像素：净影响 0（齿轮菜单第三行只在设置弹层内，stub 基线不展开设置弹层；九屏骨架未动）。
