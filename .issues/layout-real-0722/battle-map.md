> 本文件由「布局与真部件」战役 kickoff 的七路并行侦察工作流自动合成（2026-07-22，8 agents / 1.10M tokens）。
> ⚠️ 其中「右栏两面板满态语料」一节已被 `panel-firing-truth.md` 的实测修正，以后者为准。

# 作战地图 · 「布局与真部件」战役

> 来源：七路只读侦察（data / cr-screens / our-screens / gates / transport / copy / css）合成。
> ⚠️ 标记 = 未验证或需现场探测。所有 `file:line` 均为侦察时快照（D:/avery HEAD `634693e`，分支 `claude/layout-real-components-27b594`）。

---

## 1. 环境与执行

### 1.1 起环境（三件套，全部照抄）

```bash
# ① mock 后端（三个 env 缺一就真出网烧钱）
cd /d/avery/eval-harness && AVERY_BRAIN=mock AVERY_EXTRACTOR=heuristic AVERY_EMBEDDINGS=keyword \
  AVERY_DEMO_SEED_DIR=tests/fixtures/demo-seed \
  /c/Python313/python -m uvicorn service.app:app --host 127.0.0.1 --port 8137 --app-dir .

# ② 前端：本仓 vite dev 起不来（共享 node_modules junction 缺 @babel/*）→ 一律 build+preview
cd /d/avery && node node_modules/typescript/bin/tsc -b \
  && node node_modules/vite/bin/vite.js build --mode development \
  && node node_modules/vite/bin/vite.js preview --port 5173

# ③ 她方参照（只有 extract-cr-spec / capture-align-board 需要）
cd /d/cr-live && npm run dev        # :3100
```

- 验收 URL：`http://localhost:5173/?v=2&mode=live&lang=zh`（缺 `?v=2&mode=live` 会落 story 壳；`resolveMode()` 默认 story，`src/shared/mode.ts:25`；`resolveVersion()` 默认 '2'，`src/shared/version.ts:28`）。
- 🔴 CORS 精确匹配：后端 8137 只放行固定 origin 列表。**换端口必须同时给 `AVERY_CORS_ORIGINS`**，否则门表现为「页面空的/没数据」（`.issues/v02-partner-align-0718/verify-p0.mjs:11-12`）。
- 🔴 `npm run build`/`npm install` 都不要跑（禁 install；scripts 走不通）。一律 `node node_modules/<pkg>/bin/...` 直调。
- ⚠️ 当前检出**不在 main**（`claude/layout-real-components-27b594`）。收工前 `git -C D:/avery branch --show-current` + `status` 自查，别把提交落错地方。

### 1.2 电池跑法（严格三段序 + 终局重建）

**铁律**：① 电池必须**独占跑**（与 agent 工作流并发会撞 CPU 超时出假红，棒4 出过 6 条假红）；② 顺序 A→B→C，序错了中段 `visual`/`button-family` 必红（"visual 中段必红四次实证"）。

**A 区 · 吃共享 preview:5173（17 道，先跑）**

| # | 路径 | 需要后端? |
|---|---|---|
| 1 | `eval-harness/tools/verify-topbar-clearance.mjs` | 否 |
| 2 | `eval-harness/tools/verify-cr-alignment.mjs` | **是** |
| 3 | `eval-harness/tools/verify-skin-phases.mjs` | 否（走 `?transport=stub`） |
| 4 | `eval-harness/tools/verify-button-family.mjs` | 是 |
| 5 | `eval-harness/tools/verify-contrast-smalltext.mjs` | 否 |
| 6 | `eval-harness/tools/verify-home-skeleton.mjs` | 否 |
| 7 | `eval-harness/tools/verify-status-truth.mjs` | 否 |
| 8 | `eval-harness/tools/verify-room-nomaterial.mjs` | 否 |
| 9 | `eval-harness/tools/verify-room-usability.mjs` | 是 |
| 10 | `eval-harness/tools/verify-handoffs-empty-honesty.mjs` | 否 |
| 11 | `eval-harness/tools/verify-switchers.mjs` | 否 |
| 12 | `eval-harness/tools/verify-aria-zh.mjs` | 是 |
| 13 | `eval-harness/tools/verify-onboard-gate.mjs` | 是 + demo seed |
| 14 | `.issues/v02-partner-align-0718/verify-p0.mjs` | 是（必须 5173） |
| 15 | `.issues/feat-068-frontend-deploy/verify-zh-purity.mjs` | 是 |
| 16 | `.issues/feat-068-frontend-deploy/verify-bare-url-shell.mjs` | 否 |
| 17 | `.issues/feat-068-frontend-deploy/verify-404-discriminator.mjs` | 是（要真 404） |

统一跑法：`cd /d/avery && VERIFY_BASE=http://localhost:5173 node <path>`
cr-alignment 额外：`SPEC_STICK=<当前棒号>`。

**B 区 · 自带服务器（3 道，中段）**

```bash
node .issues/v02-partner-align-0718/verify-data-boundary.mjs      # 自起 dev server :5304，可选 VERIFY_OLD_STORE=<git-ref> 做 born-red
node .issues/v02-joint-0719/verify-null-owner.mjs
VERIFY_BASE=http://localhost:5173 node node_modules/playwright/cli.js test -c eval-harness/visual   # 像素基线 36 张
```

**C 区 · 🔴 dist 调包者殿后清单（3 道，独占跑，跑完 dist 已被换）**

| 路径 | 它把 dist 打成什么 |
|---|---|
| `eval-harness/tools/verify-auth-capability.mjs` | `spawn(vite build)` 带假 Supabase key + `VITE_AVERY_API_BASE=http://127.0.0.1:8281`；自起 preview 5281。**不还原 dist**（`:68-90`） |
| `eval-harness/tools/verify-auth-form.mjs` | 同款，端口 5291 / API 8291（`:38,43-44,108`） |
| `eval-harness/tools/verify-bundle-privacy.mjs` | `execFileSync(vite build)` **不带 api base** → dist 落回 `vite.config.ts` 默认 = **生产域名**（`:32-52`） |

🔴 **最毒**：`verify-bundle-privacy` 跑完后，对着 `vite preview` 跑任何会上传的门 = **往生产库写测试数据**（7/20 真发生过，三个 `员工花名册.csv` 落进生产 context）。

**准调包者**（不 spawn build，但要求你手工重打，排在 C 区附近都要小心）：
- `eval-harness/tools/verify-file-manifest-truth.mjs`：`VITE_AVERY_API_BASE=http://127.0.0.1:8307` 重打 + preview 5307 + 后端 8307 + `AVERY_CORS_ORIGINS=http://127.0.0.1:5307,http://localhost:5307`（`:40-45`）
- `eval-harness/tools/verify-onboarding-returning.mjs`：隔离后端端口 + 重打 + preview 5299（`:39-50`）。🔴 `VITE_AVERY_API_BASE` 是**构建期常量**，preview 时再设无效。

**终局**：C 区跑完必须回到 §1.1 ② 重建健康 dev dist，再跑净室扫雷 + 对照板。

**死件，不要进电池（6 个）**：`.issues/v02-partner-align-0718/` 下的 `verify-server.mjs`（无断言，是启动器）· `verify-fixA.mjs` · `verify-fixA-live.mjs` · `verify-fixB-transport.mjs`（三重过时）· `verify-fixB-upload-ui.mjs` / `verify-fixB-upload-layout.mjs` · `verify-blockers.mjs`。

⚠️ **「23 道」在任何 tracked 文件里都没有逐条名单**——它只活在各棒收据的散文里。上表 A17+B3+C3=23 是可跑的最合理集合，第 23 道无法从文档唯一确定。**本战役棒A 应顺手把它落成 tracked 清单/runner**（见 §4 棒A）。

### 1.3 规格链三件套

```bash
# ① 采她方计算值 → 草案（gitignored）
cd /d/cr-live && npm run dev &
cd /d/avery && CR_BASE=http://localhost:3100 node eval-harness/tools/extract-cr-spec.mjs
# 产物：eval-harness/reports/cr-spec-draft.json

# ② 人工筛选后誊进 tracked 规格
#    eval-harness/specs/cr-align-spec.json   （当前 22 行，最后 stick=4，全绿）

# ③ 验
cd /d/avery && VERIFY_BASE=http://localhost:5173 SPEC_STICK=5 node eval-harness/tools/verify-cr-alignment.mjs
```

**spec 行字段**：`key`(域.名) · `stick`(棒号) · `screen`(九屏 id) · `selector`(必带 `.lite2-shell` 前缀) · `prop` 或 `var`(二选一) · `expected` · `tolerance`(`exact`|`contains`|`px1`|`px2`) · `note`(誊抄依据 + 偏差记档)。

**`SPEC_STICK=N` 语义**（`verify-cr-alignment.mjs:99`）：`row.stick > N` 的行照跑照打印但**不计红**（打 `[FUTURE]`），`≤N` 转硬断言。**新增 stick=5/6/7 段门无需改一行代码**。

**两条誊抄纪律**（写在 `cr-align-spec.json:2` 与 `:23`）：
1. 门字面量今后一律从本表誊出（**spec→门→码**，不许反向）。
2. AA 偏差已内化：凡小字色一律取我方 `*-text` 补偿值，不取她的原始灰。
3. 🔴 构建压缩去掉自定义属性前导 0 → 期望串写 `.97` 不写 `0.97`。

**🔴 门的唯一必要改造**：`verify-cr-alignment.mjs:85` 只做 `document.querySelector` 单元素单属性。布局断言需要「栏宽比 / 网格列数 / 子元素计数 / rect 几何」→ 必须给门加一种新 row 类型（建议 `probe:'rect'` / `probe:'count'`），**棒A 一次做完并同 commit 誊 spec**。
同理 `extract-cr-spec.mjs:23-78` 的 PROBE **一个几何量都没采**（全是色/字/圆角/阴影），要提布局规格必须先扩 PROBE 采 `gridTemplateColumns` / `gap` / `width` / `getBoundingClientRect`。⚠️ `/companyinput` 不在 `extract-cr-spec.mjs:21` 的 ROUTES 里。

### 1.4 对照板 / 基线 / 扫雷

```bash
# 对照板（人眼审，刻意不做像素 diff）
cd /d/avery && VERIFY_BASE=http://localhost:5173 CR_BASE=http://localhost:3100 \
  node eval-harness/tools/capture-align-board.mjs
# 产物 eval-harness/reports/align-board/<YYYY-MM-DD>/index.html —— 同日重跑会覆盖

# 像素基线（9屏×2皮×2视口=36）
VERIFY_BASE=http://localhost:5173 node node_modules/playwright/cli.js test -c eval-harness/visual
# 重冻（🔴 只在人审对照板通过后，同 commit 提交）
VERIFY_BASE=http://localhost:5173 node node_modules/playwright/cli.js test -c eval-harness/visual --update-snapshots
# 只重冻一皮一视口
node node_modules/playwright/cli.js test -c eval-harness/visual --project=desktop -g "aurora 九屏基线" --update-snapshots

# 扫雷（正式，永远 exit 0）
VERIFY_BASE=http://localhost:5173 node eval-harness/tools/sweep-ui-defects.mjs
# 自检硬门（每类检测器注入已知故障，哑火即 exit 1）
VERIFY_BASE=http://localhost:5173 node eval-harness/tools/sweep-ui-defects.mjs --selftest
# 毕业成硬门
SWEEP_GATE_CLASSES=fixed-overlap,default-control VERIFY_BASE=http://localhost:5173 \
  node eval-harness/tools/sweep-ui-defects.mjs
```

- 扫雷矩阵：9 屏 × 2 皮 × (空世界 1440 + 满世界 1440/**872**/375)（`sweep-ui-defects.mjs:42-50`）。872 = 贴 860 断点上沿，胶囊顶栏下横向最挤。当前基线 **0 件 / 0 指纹**（连续三轮）。
- 台账 `eval-harness/tools/ui-sweep-triage.json`（tracked，扁平 `{fingerprint: record}`）；指纹 = `sha1(cls|screen|look|vp桶|归一化selector)` 前 16 位，selector 已去 nth → 数据变化不换指纹；`fixed` 复燃打 `REGRESSION`。
- 🔴 **基线世界 = 空态/stub**（`?transport=stub`，固定 16 人团队）。棒5/6 改满世界时"36 张原样绿"是构造性的。**本战役改的是空态骨架/栏宽/网格 → 基线会真动，不会白绿。**
- 🔴 对照板配对表 `capture-align-board.mjs:27-36` 把 **room↔/nexus** 配上了（任务书说 room 无参照）。`/nexus` 真实存在且在 `extract-cr-spec.mjs:21` 的 ROUTES 里。**口径取 plan：room 只借通用语法，不誊她的 /nexus 具体值**；但对照板会出这一对，别当 bug。
- 固定环（`plan.md:41-43`）：sweep（棒首+棒尾）→ triage → 实现 → 全电池（含 `SPEC_STICK=当前棒`）→ 对照板 Danny 过目 → 门字面量从 spec 誊 + 旧构建红证明 → 像素基线人审后 `--update-snapshots` → docs+push。
- ⚠️ 上一战役 handoff 已修正：**验收不默认上产**。push=自动部署（`averylite.dannyqian.com`），所以 push 是对外动作，需人工闸。

---

## 2. 真部件裁决表

> 任务书说「首批四件」但列了五件，本表按**五件**裁决。全部结论：**零 transport 改动**。

### 2.1 主页右栏 · 真差距面板

| 项 | 结论 |
|---|---|
| 数据基础 | **充分** |
| 取数路径 | `selectGapsActive/Resolved/Dismissed(useLite.team, useFlow.gapMarks)`（`flowStore.ts:226-236`）→ 底层纯函数 `deriveGaps(team)`（`gapDerive.ts:43-73`），零网络零 LLM 零随机 |
| 判据 | 「自述稳(`statusRaw ∈ {'on-track','steady'}`) ∧ blockers.length≥1」= 矛盾（`gapDerive.ts:48-51`）。**`statusRaw===undefined` 跳过**——`gapDerive.ts:22-30` 记着历史 bug：读 `project.status`（被兜底成 on-track）曾让约 1/4 真项目被造出客户没说过的自述 |
| 可用维度（穷举） | ① `projectTitle/projectId` 折叠（一项目 N 条 blocker → N 张卡，`gapDerive.ts:57`）② `ownerName` 分组（**只作标签，零数字**）③ claim vs evidence 双栏（`CloserLookScreen.tsx:83-92` 已用）④ `gapMarks` 三态筛选 chip + 计数 ⑤ **严重度唯一诚实来源** = join `rawTeam.decisions` on `subject_id === gap.projectId` 取后端 `severity`/`grade_label`（`transport.ts:157`） |
| transport | **不动** |
| 🔴 不做 | 前端自行判级（`transport.ts:130` 明禁）· 优先级 · 时间/趋势 · 责任人负载 · 置信度。排序若要做，诚实排法只有两种：同项目条数、项目标题字典序。`decisions` 是 optional，join 不上必须退回「无严重度」而非默认一档 |
| ⚠️ 已知债 | `evidenceTag` 恒为硬编码英文字面量 `'From your uploads'`（`gapDerive.ts:68`），**从未进 i18n**。本战役若把它上屏到主页，会被 `verify-zh-purity` 捞出来 → 顺手补进 en.ts/zh.ts |

### 2.2 主页右栏 · 真关注成员面板

| 项 | 结论 |
|---|---|
| 数据基础 | **勉强 —— 合法性有两个刚性前置** |
| 取数路径 | `deriveAttentionPeople(team, rawTeam)`（`homeDerive.ts:84-152`）→ `AttentionPerson{id,name,role,signalCount,blockerCount,projectCount,projectTitles,evidence[≤2 verbatim]}` |
| 认领口径 | 优先 `rawTeam.projects[].ownerId === person.id`，否则 `pr.ownerNameRaw === person.name`（`:97-104`，**绝不用 `ownerName`**）。信号命中只认 `subjectType==='person' && subjectId===id`，或 `summary.includes(name) && name.length>=2`（单字名一律不认，宁漏不错）。🔴 **刻意不把「她是 owner」算作提到她**（`:116-118`）。排序 = `signalCount+blockerCount` 降序，同数按名字（`:147-151`，可复现）。`signalCount+blockerCount===0` 直接跳过（`:129`） |
| transport | **不动** |
| 🔴 两个前置（缺一即触红线，`homeDerive.ts:60-63`） | ① 界面**必须写出口径**「因为出现在 N 条信号里」；② **必须同屏摆 verbatim 原文**。现有文案键已在：`homeAttentionCaption`(`en.ts:1251`)="Counted from what your documents say — not a rating of anyone." |
| 🔴 不做 | 她方 `/` 的 PeopleRail 口径 `load>=90 \|\| sentiment==='strained'`（`cr-live/src/components/command/people-rail.tsx:10-14`）——**这两个字段我们一个都没有**（`homeDerive.ts:56-58` 明文记录）。她那块的 `w-[74px]` 固定块 = `{load}%` + `h-1.5` 负载血条（`:39-46`）**一个像素都不搬** |
| 结构护栏（已在） | `stripPersonNumbers`（`teamData.ts:138-146`）黑名单 `{moodPct,capacityPct,mood,capacity,score,rank,rating,tier,percentile}` **并且丢弃任何 `typeof v==='number'` 的键**（`:142`，防新血条字段偷渡）；`LivePersonCard`（`transport.ts:104-114`）类型层无任何数字槽位 |

### 2.3 快问悬浮入口

| 项 | 结论 |
|---|---|
| 数据基础 | **充分（纯搬位，零新数据）** |
| 取数路径（推荐） | `goScreen('room', { q: text })` —— 中继链全线打通：`routes.ts:115 EPHEMERAL_PARAMS=['q']`（导航后自动清）→ `routes.ts:186 goScreen(screen, params)` → `Lite2App.tsx:204-212 useRoomQueryRelay`（render 期搬运，`location.key` 作闸）→ `flowStore.composerDraft` → `RoomScreen.tsx:341/373 initialValue`。**只预填不自动发**（`Lite2App.tsx:195` 明写"不自动发问、不伪造回答"）。她方 FAB 同构（`cr-live/src/components/shell/nexus-fab.tsx:19 router.push('/nexus?q=')`） |
| 备选（不推荐） | 直接 `askLive({situation})`（chips 的做法，`RoomScreen.tsx:386`）——但要自行 `goScreen('room')` 否则用户看不到流 |
| transport | **不动**（`store.askLive` `store.ts:694` → `agentSource.run` → `transport.streamAdvise` → `POST /advise` 全现成） |
| 🔴 必须继承的 gate | **无材料 gate**：`RoomScreen.tsx:344-362` 在 `contextId === null` 时收起 composer 和 chips（0721 事故：零数据提问要么烧默认英文 demo 语料的真 LLM、要么断流，被呈现成"系统故障"）。悬浮入口必须复用**同一判据 `contextId`**（不用 `team`——`store.ts:271-275`：contextId 在模块求值期就从 localStorage 同步恢复，回访者第一帧非空） |
| 🔴 命名冲突（真 blocker，见 §6） | 「快问」在 en/zh 里**已经是 feat-034 Ask 的名字**：`ask.eyebrow:'Quick ask'`(`en.ts:1329`) / `zh.ts:914 "快问"` / `zh.ts:472 "来自快问"` / `zh.ts:329,595 "一条快问已拟好"` / `zh.ts:780` / `zh.ts:947,950,953,956`。且这条锁在 M3 生成器的 SYS 铁律里（`scripts/i18n-zh-delta.mjs:121`）。同屏会出现两个"快问"：一个把话发给 LLM，一个把链接发给员工 |
| 正确术语映射 | 她的「问 Nexus」→ 我们的**「去议事室」**：`lite2.homeDecisionAskRoom:'Take it to the room'`(`en.ts:1238`) / `triageTakeToRoomLabel`(`:860`) / `notesEmptyCta:'Ask the room'`(`:679`)。🔴 **不映射到「快问」**。且 `Nexus` 三字**不许上屏**（`verify-p0.mjs:265` 硬闸扫 `['Nexus','nexus','现实差距']`） |
| 🔴 不做 | ask 的「撤回/编辑」：后端有 `POST /ask/{id}`(`ask_api.py:333`) 和 `/ask/{id}/revoke`(`:395`)，**transport 里没有对应方法**，`en.ts:1388 revoke` 是悬空文案键。这是既有债，本战役**不要顺手接** |

### 2.4 顶栏真搜索

| 项 | 结论 |
|---|---|
| 数据基础 | **勉强 —— 数据够，产品口径待拍板**（`.issues/lite-live-v02-0713/decisions.md:26` 把「全局搜索」列在「暂缓/不动」） |
| 裁决 | **纯客户端内存检索，零 transport 改动** |
| 依据 | ① 后端**零 search 路由**（全量路由表已穷举，无任何 search/query 端点）② 数据量 ~30 人 + 17 项目 + 8 playbook，整包已在内存（`store.team`/`store.rawTeam`），`includes()` 足够，不需索引 ③ 跨境延迟（ADR-0024 单法兰克福后端；`transport.ts:666` 记录 ingest 实测 100-120 秒）→ as-you-type 打后端不可接受 ④ `LiveTransport` 新增**必填**方法会让 `createStubTransport` 编译不过（`transport.ts:328-329`），可选方法则搜索框在 stub 下变哑巴、AFK 门覆盖不到 ⑤ ADR-0020 决策 4 禁的是 **LLM key 与 loop** 上前端，不禁前端过滤；ADR-0021 §5 的 pluggable retrieval 指**服务端 RAG**（`AVERY_EMBEDDINGS=keyword`），不能援引成"搜索必须走后端" |
| 前端先例 | `LiteComposer.tsx:44-68`（唯一现有检索）：`` `${option.label} ${option.meta}`.toLowerCase().includes(query) `` + kind 过滤 `'all'\|'person'\|'project'`（`:64`）。可直接同构扩展 |
| 可检索面（穷举） | 人 `team.people[].name/.role/.team/.tenure/.owns[]/.collaboration[]` · 项目 `team.projects[].title/.summary/.ownerName/.status/.blockers[]` · 笔记 `notes[].text/.source_excerpt` · 文件 `files[].filename/.doc_kind/.mime` · 待办 `useFlow.followups[].title/.note` · 差距卡 `deriveGaps(team)[].projectTitle/.claim/.evidence` · 决策卡 `rawTeam.decisions[].subject_title/.reason/.matched_rules[].title` · 九屏静态名表（文案走 en.ts） |
| 🔴 不做 | ① 结果行**任何数字**——她方 ``sub: `${p.status} · ${p.progress}%` ``（`cr-live/src/components/shell/topbar.tsx`）那半句必须丢掉（我方 `LiteProject` 连 progress 都没有，人卡侧更禁）② 文件**正文/chunk 内容**命中——前端只有 `n_chunks` 数量不是内容；后端 `GET /team/{id}/files/{idx}` 下原始字节，`LiveTransport` 无该方法，且字节是不可信内容（`transport.ts:247`「绝不作指令跟随」）。**别开这个口子** ③ `absent ≠ none`：ownerName/status 缺失时用 `t.lite2.projectsUnknownValue` 兜底，**绝不写"未分配"/"一切正常"**（`teamData.ts:44-64` 记录了这条在生产上翻过车） |
| 无结果态 | 诚实：不回落假数据、不建议假动作。`contextId === null` 时与 Room 同判据收起或明说「还没有材料」。⚠️ 现有 `refEmpty`(`en.ts:906`)="Upload a few files first…" 是**零数据**不是**零匹配** → 两个键都是真新增 |
| DOM 插槽 | `LiteTopbar.tsx:105`（`</nav>` 后）与 `:107`（`<LiteBell/>`）之间。🔴 **绝不能放进 `.scene-tabs` 内**——`scripts/gates/live-frontend-gate.snippet.js:1337-1341` 按 `$$('.lite2-shell .scene-tabs .scene-tab')` 数 9 个并逐字比对 label 数组，混进任何非 tab 子元素即红 |
| 布局约束 | `.prototype-topbar` 是 `pointer-events:none`（`00-base.css:65-75`），新子块必须自己 `pointer-events:auto`（先例 `.lite-bell` `lite2.css:2827`、`.lite-auth` `:4089`、`.lite-settings` `:5079`）。≥861 时 `.scene-tabs{margin-right:auto}`（`lite2.css:5446-5448`）把右簇推右 → 插在 nav 后的搜索框会贴右簇最左；要居中需在两者间再放 auto margin。`.scene-tabs` 自身 `overflow-x:auto`（`:4830-4840`），窄屏 tab 条已在滑，搜索框挤同一行会更糟 → **建议 `hidden` 在窄屏**（她方 `topbar.tsx:220` 就是 `hidden xl:block`，<1280 整块消失） |
| 🔴 门洞 | `placeholder=` **两道中文门都够不着**（`verify-zh-purity` 扫 innerText，`verify-aria-zh` 扫 aria-label/title/alt）。**新搜索框务必同时给 `aria-label`** 走 `t.*`，否则是纯裸奔 |

### 2.5 KPI 真数卡

| 项 | 结论 |
|---|---|
| 数据基础 | **充分**（已在 `HomeScreen.tsx:421-446` 有五格：人/项目/文件/笔记/未完成待办） |
| ✅ 可上卡的真数（取数式） | `team.people.length` · `team.projects.length` · `files.length` · `notes.length` · `followups.filter(f=>!f.done).length` · 今日 `.filter(!done && dueGroup==='today')` · 已完成 `.filter(f=>f.done)` · 差距三态 `selectGapsActive/Resolved/Dismissed().length` · 分诊三桶 `selectTriagePending/Handled/SetAside()` · `team.handoffs.length` · `summarizeDecisions(rawTeam.decisions).total` / `.buckets[].count`（label 取后端 `grade_label`，前端**不硬编码**「高风险/需确认/可推进」，`homeDerive.ts:21-22`；顺序归后端，前端不重排 `transport.ts:76-78`）· `card.matched_rules.length` · `projectCoverage(views)` → `{total,missingProgress,missingDueDate,missingStatus}` · `groupProjects(views)[].views.length` · `selectUnreadCount()`（`notifyStore.ts:155`，是"通知条数"不是任何人的读数）· `deriveAttentionPeople().length` · Ask 回收 `recipients.filter(r=>r.receipt).length / .length`（`AskCard.tsx:26-28`）· run 计量 `run.sourcesRead`/`recallHits`/`citations.length`（`streamSource.ts:96-100`，真事件驱动，零假延迟零假进度）· `knownContexts.length` · `useOnboard.playbooks.length` |
| 🆕 未做但充分 | **总 chunk 数** `files.reduce((n,f)=>n+f.n_chunks,0)`（单文件已显 `UploadPanel.tsx:287`）· **文件读取状态分桶** `files.filter(f=>f.status==='ingested'\|'empty'\|'failed').length`（🔴 `status` 缺席必须显「未知」，**不得默认 ingested**，`transport.ts:246-258`）· **卡点总条数** `projects.reduce((n,p)=>n+(p.blockers?.length??0),0)`（口径必须写明是"条数"不是"严重程度"） |
| ⚠️ 信号数陷阱 | `rawTeam.signals?.length` 是真数，但抽取层给每条 doc 信号写死 `subjectRef="the project"`（`extract.py::_signals_from_doc`），**谁也挂不上**。实测出现过 0 项目 + 2 信号 → 界面说「其中 2 个项目值得多看一眼」，凭空点名两个不存在的项目。后端因此发 `look_kind`（`'projects'\|'items'\|'none'`，`teamData.ts:105,272-275`），🔴 **`undefined` 必须按 `'items'` 侧兜底**。任何把信号数说成项目数的文案都是这条 bug 复发 |
| transport | **不动**（`LiveDecisionCard` 后端 feat-056 已排好序，前端不得重排） |

### 2.6 🔴 明确「不做」的编造型指标清单（全战役统一）

| 指标 | 为什么不能 |
|---|---|
| 任何人身 % / 评分 / 排名 / 血条（moodPct, capacityPct, score, rank, rating, tier, percentile） | 类型层无槽位（`transport.ts:102-114`）+ 运行时双重剥离（`teamData.ts:126-146`）。**硬红线** |
| 团队健康度 / 士气 / 负荷 / 满意度 | 后端不产。她方 `load` / `sentiment` 我们一个字段都没有 |
| 项目完成率 / 平均进度 % | `progress` 只有 **6/17** 有值（`projectView.ts:10`）。聚合要么把「文档没说」当 0（谎称没进展），要么缩分母（口径不可解释） |
| 逾期数 / 距截止 N 天 / 倒计时 | `dueDate` 是自由文本 `string`，前端只 `trim()`（`projectView.ts:102`），**零日期解析**；后端解析不出的走 `unparsed_fields`（原文如「月底前」） |
| 本周新增 / 环比 / 趋势 / 折线 | **无时间序列**。payload 无历史快照；`files[].uploaded_at` 是上传时间不是业务时间；`notes[].created_at` 只覆盖 agent 自写笔记 |
| 「扫描了 N 条信号」式问候统计句 | `homeDerive.ts:10-12` 点名禁止（她方硬编码假数字） |
| 平均响应时长 / 回复率基线 / 每人一行数值 | Ask 只有 `answered_at`，样本 1-3 人；ADR-0023 禁跨人比较——`AskCard.tsx:11-15,296-304` 组件树里**不存在**「每人一行 + 数值」的路径，多人只渲染一段 `receipts_summary` |
| 在线人数 / 活跃度 / 未读消息数 | 无 presence、无消息数据 |
| 关系图 / 协作密度 / Team map | ingestion **不产关系边**（`.issues/live-polish-0709/triage-report.md:68`）；decisions.md:26 已列「暂缓/不动」 |
| 待办日历 / 按真日期分组 | `FollowupItem` 只有 `dueGroup:'today'\|'week'\|'later'` 三档，**没有真 dueDate 字段**（`flowStore.ts:36`）。要做先扩数据结构 |
| KPI 卡底进度条（她方 `kpi-strip.tsx:22-25` 的 `bar%`） | 那 5 条是硬编码指标串（`cr-live/src/lib/data.ts:638-644`）。我方无对应基数 → **只出数字不出条** |
| Playbooks 真内容 | `PLAYBOOK_CATALOG` 是 8 条静态 i18n 文案（`onboardStore.ts:38-47`），无真 pack 数据 |

---

## 3. 九屏对表

> 列：她的骨架要点 → 我方现状 → 差距 → 可做成真的候选（数据依据）。
> 她方全站唯一宽度约束 `w-[min(1480px,calc(100vw-48px))] mx-auto pt-24 pb-10`（`cr-live/src/app/layout.tsx:36`）；九屏共用一个容器，**没有任何一屏自带侧栏/二级壳**。

### 3.1 home ↔ `/` 指挥室

| | |
|---|---|
| **她的骨架** | 纵向 3 段：标题块（h1 26px extrabold + 14px `max-w-2xl` 副文案 + `mb-5`）→ **KPI 条 `grid-cols-5 gap-3.5 mb-5 max-lg:grid-cols-2`**（卡 `p-4 rounded-[12px]`，标签 11.5px uppercase / 数值 25px extrabold tabular / meta 12px / 卡底 `h-1` 进度条）→ **双栏 `grid-cols-[1.55fr_1fr] gap-4.5 items-start max-lg:grid-cols-1`**（左 60.8% DecisionQueue / 右 39.2% `flex flex-col gap-4.5` = GapRail + PeopleRail）。首屏 ≈16-17 条独立信息 |
| **我方现状** | `.lite-home-frame` **max-width 860px**（`lite2.css:3523-3524`），flex column gap 18。纵序：header → ①决策（`HomeScreen.tsx:207`）→ ①½今日待办（`:294`）→ `.lite-home-row` grid `1fr 1fr`（`:332` / CSS `:3926-3930`）内含 ②差距摘要 + ③需关注的人 → ④概览五格（`:415`，`.lite-home-counts` = `auto-fit minmax(104px,1fr)` CSS `:4018`）。空态 `.lite-home-frame-empty` 已被覆盖到 **1040px**（`:5072-5074`），`.lite-home-skeleton-row` = `1.4fr 1fr` + `@880` 单列（`:4980/4987`） |
| **差距** | ① 内容栏 860 vs 顶栏 1480 → **顶栏左右各比内容多出约 310px，不共基准线** ② 无满宽 KPI 条（五格 counts 沉在最底，不是首屏第二段）③ 双栏只覆盖 ②③ 两块，①①½④ 是全宽单块 ④ 断点 720 对 1040+ 的双栏太晚 |
| **候选真部件** | KPI 条上提到第二段（五个 `.length` 真数，§2.5）· 右栏差距面板 + 三态筛选（§2.1）· 右栏关注成员面板（§2.2）· 决策分级摘要条（`summarizeDecisions`，已在 `:210-231`） |
| **挡路的规则（穷举）** | `lite2.css:3524` `.lite-home-frame{max-width:860px}` —— **唯一一条**；`:3926-3930` `.lite-home-row{1fr 1fr}`；`:3937` `@media(max-width:720)`。空态 1040 已是先例（`:5072`），把有数据态推到 1040 与既有做法同构 |

### 3.2 team ↔ `/people` 你的团队

| | |
|---|---|
| **她的骨架** | 单栏 5 段：页头（`flex items-end justify-between gap-4 mb-5 flex-wrap`，主按钮甩右）→ 过滤条（一行 11 颗 pill，`text-[12px] px-2.5 py-1 rounded-full border`，选中 `bg-navy text-white`）→ 展开式新增表单（`grid grid-cols-4 gap-3`）→ **人员网格 `grid-cols-3 gap-4 max-lg:grid-cols-1`（无中间 2 列断点）** → 已停用区（`mt-8` + `opacity-40 grayscale`）。卡 `card-base p-4 card-hover`：Avatar 44 + 姓名 15 + `职位·组别` 12.5 + 状态 Badge；focus 文案 **`min-h-[34px]` 强制两行等高**；底部三格指标（负载 % 17px / 情绪 / 健康度 17px 现算 `Math.max(40,100-\|load-70\|)`） |
| **我方现状** | 唯一走 shared 布局的屏：`.home-frame`（`shared/styles/70-home-cards.css:13`）= `grid minmax(340px,38fr) 62fr; gap:34px; max-width:1460px; padding:84px 36px 150px`，`@1080` 单列。左 `.home-spine`（greeting + metrics chip + 分诊 `ol.home-handoff-list` + 折叠抽屉）/ 右 `.home-lanes`（UploadPanel + 人分组 `auto-fill minmax(200px,1fr)` + 项目 `auto-fill minmax(280px,1fr)`）。外挂 `<LiteComposer/>` → `.composer-layer`（`00-base.css:671-678`） |
| **差距** | ① 我方左栏是分诊脊柱（她没有对应物），右栏才是人卡——**结构不是同一件事，别硬对齐** ② 人卡密度：她 3 列固定 + 三格指标；我方 `minmax(200px,1fr)` 自适应、**结构上零数字**（`TeamScreen.tsx:70-99`，注释 `:96`）③ 缺过滤 pill 条（她 11 颗） |
| **候选真部件** | **分组折叠 + 每组计数**（`groupPeople()` `teamGroups.ts:64-94`，维度优先级 `person.team` → 拥有的首个项目标题（判据 `ownerNameRaw`）→ `person.role` → `__ungrouped__` 沉底）· **过滤 pill 条**：只能按 `person.team` / `person.role` / 项目归属三种真维度（零情绪零负载）· 分诊三桶计数（`selectTriagePending/Handled/SetAside`，已在 `:234-338`）· 人卡 focus 行 = `person.read`（语料原文）+ `ownsRead[≤2]`（`teamData.ts:17-32`） |
| 🔴 | 她的三格指标 + 现算健康度分**一格都不搬**。人卡等高可借（`min-h` 概念），但填的是 verbatim 原文不是分数 |

### 3.3 projects ↔ `/projects` 项目

| | |
|---|---|
| **她的骨架** | 单栏 4 段。网格 `grid-cols-3 gap-4 max-xl:grid-cols-2 max-md:grid-cols-1`（**三段断点，比 people 完整**）。卡 = `card-base p-0 flex flex-col overflow-hidden`：**顶部 6px 渐变条** `linear-gradient(90deg,tone,tone88)` → `p-4 pb-3` 内容区 → 标题 15px + 状态 Badge → impact 12.5px `line-clamp-2 flex-1`（撑高对齐）→ 进度（标签 10px uppercase / `{progress}%` 12px / 轨道 `h-[6px] rounded-full`，填充 `width 0→progress%` `duration .8`）→ 里程碑 8px 圆点行 → 偏差告警条 → 页脚 `pt-3 border-t` Avatar22+负责人 / 日历+AvatarStack。详情 Modal 560px 带 ProgressRing size56 stroke5 |
| **我方现状** | `.lite-projects-frame` **980px**（`lite2.css:4356`）。header → `.lite-projects-coverage`（有缺口才渲染，`:223-239`）→ 单项目提示 → `section.lite-projects-group[data-project-group]` × 非空分组 → `.lite-projects-grid` = `auto-fill minmax(288px,1fr) gap12`（`:4563-4567`，注释 4561「**不设最小列数**，1 张卡就是 1 张卡」）→ `button.lite-project-card`（`border-left:3px` 状态左缘）。棒6 已加 6px 顶部渐变条 |
| **差距** | ① 栏宽 980 vs 1480 外夹 ② 她三段断点 vs 我方 auto-fill（口径不同但都合理，**auto-fill 更诚实，不必改**）③ 无里程碑行（无数据）④ 卡内 impact 无 `flex-1` 撑高等高 |
| **候选真部件** | **状态分组 + 每组计数**（`groupProjects()` `projectView.ts:155-168`，`GROUP_ORDER` = needsYou, moving, other, unknown, done，只吐非空组）· **覆盖率面板**（`projectCoverage()` `:182-189`，实测 total 17 / status 13/17 / dueDate 7/17 / progress 6/17）· **卡点计数**（`blockers.length`，13/17 项目有）· 卡内等高（纯 CSS `flex-1`） |
| 🔴 | `progress` 未知**不画 0 宽条**，只出「文档未提及」行（`ProjectsScreen.tsx:156-164` 已正确）。`null` 一律读作「文档未提及」，**绝不是 0、不是空、不是默认值**（`projectView.ts:36-38`）。她的里程碑点、`{progress}%` 汇总、AvatarStack 都无数据基础 |

### 3.4 followups ↔ `/checklist` 待办清单

| | |
|---|---|
| **她的骨架** | 单栏 5 段：页头（内联「N 项今日到期」金色强调）→ **分段开关**（`flex gap-2 mb-5 p-1 rounded-xl bg-white/70 border w-fit shadow-sm`，两个 tab `px-3.5 py-2 rounded-lg text-[13px] font-bold`，选中 `bg-white shadow-sm`，各带计数 Badge —— **九屏唯一的分段控件形态**）→ 新增表单 `grid-cols-[1fr_150px_120px_140px] gap-3 items-end` → 三组分组（每组 = **一张 `card-base divide-y divide-line` 装整组行，不是每行一卡**）→ 空态/历史。行 `flex items-start gap-3 px-4 py-3`：20px 复选框 → 标题 13.5 → 元信息 11.5px `gap-3`（来源图标+标签·负责人·到期）→ 右侧两个 28px 图标按钮 |
| **我方现状** | `.lite-followups-frame` **760px**（`lite2.css:2132`）。header → `.lite-followups-subtabs`（active/history 两个 subtab，`:219-239`）→ `form.lite-followups-add`（input+select+submit，仅 active）→ `section.lite-followups-group[data-group]` × today/week/later → `ul.lite-followups-list > li.lite-followup-item` |
| **差距** | ① **行是独立 li 不是一张卡装一组** —— 她的「列表型内容一律 `card-base divide-y`」是最强可迁移概念 ② 分段开关形态可对齐（我方 subtabs 已在，只差胶囊底托）③ 新增表单单行三列 vs 她四列定宽 ④ 栏宽 760 |
| **候选真部件** | 分组计数 Badge（`followups.filter(dueGroup===x && !done).length`，真数）· 已完成计数（`:237` 已有）· 今日到期内联强调（`HomeScreen.tsx:74` 同款口径） |
| 🔴 | **无真 dueDate**，只有三档 `dueGroup`。她的「到期」列 + 日历 + 逾期一律不做。来源标签走 `followupsSource*` 键（含 `"来自快问"` `zh.ts:472`） |

### 3.5 closerlook ↔ `/gaps` 多看一眼

| | |
|---|---|
| **她的骨架** | 单栏 3 段：页头（h1 内联 `Badge tone=red dot` 显活跃数）→ `space-y-4` 卡流 → 历史折叠区。卡 `card-base p-5`，`flex gap-4 items-start`：左 40px 方图标 `rounded-[9px]` + tone 渐变 + 符号；右主体 标题 16px + 类型 Badge。**核心 = 左右对照双格 `grid grid-cols-2 gap-3 mt-3 max-md:grid-cols-1`**：左 `p-3 rounded-[10px] bg-surface-soft`，标签「自报情况」10.5px uppercase 灰，正文 13px **italic**；右 `p-3 rounded-[10px] bg-red-soft`，标签 10.5px 红(#a5322f)，正文 13px 正体。动作行 `flex gap-2 mt-4 flex-wrap` + `<div className="flex-1"/>` 把三键推右端，左端留 12px 灰 tag。九屏里**最低密度**的一屏（一屏 2-3 卡） |
| **我方现状** | `.lite-closerlook-frame` **760px**（全屏最窄，`lite2.css:1732`）。header → `ol.lite-gap-list > li.lite-gap-card` → `.lite-gap-compare` grid `1fr 1fr`（`:1775-1777`）= claim / evidence 双栏 + `.lite-gap-meta` + `.lite-gap-actions`（resolve/dismiss/ask/addfollowup）→ `aside.lite-gap-realtime-note` → `section.lite-gap-history`（折叠） |
| **差距** | 对照双格**已经同构**（这是她最强的可迁移布局概念，我方已落地）。差的是：① 左图标方块 ② 动作行 `flex-1` 推右端的排布 ③ 三态筛选 chip（我方只有 active 列表 + history 折叠）④ 按项目折叠 |
| **候选真部件** | **三态筛选 chip + 计数**（`selectGapsActive/Resolved/Dismissed`）· **按项目折叠**「项目 X · N 条」（`GapCard.projectId` 稳定，一项目多卡由 `gapDerive.ts:57` 天然产出）· **严重度着色**（join `rawTeam.decisions` on `subject_id`，join 不上退回无严重度） |
| 🔴 | 本屏结构上**不渲染任何数字**（连 progress/dueDate 都不显）。加筛选计数时，数字只能出现在 chip 上（"N 条"），不能进卡内。她的「现实差距」四字是锁定词，`verify-p0.mjs:265` 硬闸 |

### 3.6 playbooks ↔ `/playbooks` 操作手册

| | |
|---|---|
| **她的骨架** | 单栏 2 段：页头 → **`grid grid-cols-2 gap-4 max-lg:grid-cols-1`（唯一的 2 列屏）**。卡 `card-base p-5 card-hover`：头行 32px 方图标（`rounded-[9px]` + tone 渐变 + Sparkles 15px）+ 标题 16px → 副标题 12.5px `mb-3.5` → chips `flex gap-2 flex-wrap`，每颗 `text-[11.5px] font-semibold px-2.5 py-1 rounded-full bg-surface-soft border`。6 卡 × 4 chips，零交互零状态 |
| **我方现状** | **最薄的一屏**：无 scroll、无 frame、无内滚。屏根直接一张居中卡 `section.nexus-empty.lite-playbooks-empty`（`PlaybooksScreen.tsx:33`，`shared/40-nexus-empty.css:3` = `absolute; top:42%; translate(-50%,-50%); width:min(560px,100vw-56px)`）。`PLAYBOOK_CATALOG` 8 条静态 i18n；没走完向导回落 `fallbackSlots`（`:29`）。全屏诚实标 coming-soon |
| **差距** | 结构完全不同（她 6 卡网格 / 我方一张空态卡）。⚠️ **本屏是唯一不消费 `--lite2-clear-top` 的屏**（`lite2.css:5401-5407` 名单里没有它，靠 42% 居中避开顶栏）——加任何顶部对齐布局时它必须单独处理 |
| **候选真部件** | **无真数据 → 本屏不做真部件**。可做的只有：把 8 条静态 catalog 从「一张空态卡」改成「2 列卡网格 + 保留 coming-soon 标」。这是**布局改造不是真部件**，且必须保住诚实标（`verify-cr-alignment` 现有 `playbooks` 1 行 spec 在此屏） |

### 3.7 room（无参照）· notes（无参照）· vision（无参照）—— 用她的通用语法自定

> ⚠️ `capture-align-board.mjs:31` 把 room 配到 `/nexus`。口径取 plan：**只借通用语法，不誊 /nexus 具体值**。

**她的 7 条通用骨架规则（可直接抄，不涉源码）**：
1. 每屏第一段固定「26px extrabold h1（可内联 24px 图标 / 计数 Badge） + 14px `max-w-2xl` 灰副文案 + `mb-5`(20px)」；有主动作用 `flex items-end justify-between flex-wrap` 甩右。
2. 圆角只有两档：内容卡 12px（`--radius-card`）· 壳/模态/顶栏 16px。
3. 卡间距只有 14/16/18px 三档；区块间距 20/24/32px。
4. 字号阶梯：26 → 16/15.5/15 → 13.5/13 → 12.5/12 → 11.5/11/10.5/10（最小档一律 uppercase + tracking-wider 做标签）。
5. **列表型内容一律 `card-base divide-y` 或 `border-b last:border-b-0` 的行，行高 `py-3`，绝不做成一行一卡。**
6. 折叠/归档区统一：文字开关（14px 图标 + 13px semibold 灰）+ `opacity-40 grayscale` 降级卡。
7. 全站只有 3 个 fixed（顶栏背板 z40 / 顶栏 z50 / FAB z50）+ 2 个 portal（modal z100 / toast z200）；**无 sticky 侧栏、无右下角悬浮球、无二级导航**。

| 屏 | 我方现状 | 设计方案（用她的通用语法） |
|---|---|---|
| **room** | 三态、**唯一的画布屏**、无 scroll/frame。已开跑：`<LitePanZoom/>` → `.lite-room-canvas`（`lite2.css:712-721`，`inset:68px 20px 92px`，top 被 `:5413` 覆盖 96px）→ `.lite-room-board`（`:737-746` **固定 width:1180px; max-width:none**）内 `.nexus-terminal.lite-flow`(min(440px,100%)×420) + `.nexus-brief-hud`(1 1 260) + `.lite-room-card`(1 1 520, max-h560) + 可选 `.lite-room-ask`(1 1 420, max-w520)。常驻 `.nexus-followup-composer`（`55-ask-composer.css:3-17`）。空态两种：`.lite-room-nomaterial`（收 composer+chips）/ `.nexus-empty` + 4 chips | **不动画布拓扑**（panzoom 世界宽 1180 是内部坐标不是内容栏）。只做三件：① 空态两卡应用规则 1 的标题块阶梯 ② chips 行应用规则 3 的间距档 ③ `.lite-room-board` 内四块的卡圆角/内边距收进规则 2/3。**真部件候选**：run 过程计量（`sourcesRead`/`recallHits`/`citations.length`，`streamSource.ts:96-100`，真事件驱动，相位无事件即 `pending` 零假进度）· Ask 回收进度（`AskCard.tsx:26-28`，单人可显数值+「本人自述」标注，多人只显 `receipts_summary`） |
| **notes** | 「flex 居中 + 内层定宽自滚」老模式：`.lite-notes`（`lite2.css:3202` flex center）→ `.lite-notes-body`（`:3210` `min(760px,100vw-48px)`，自滚）→ head（eyebrow/h2/lede/红线说明/count）+ `.lite-notes-groups > .home-people-group.lite-notes-group`（复用团队屏折叠头）> `article.lite-notes-entry`（`.is-new` 高亮最新）。整屏只读零输入 | 应用规则 5：把 `.lite-notes-entry` 从「一条一卡」改成**一张卡内 `divide-y` 的行流**（按日期分组，每组一张卡）。规则 1 的标题块；规则 6 的折叠头（已复用 team 的）。**真部件候选**：笔记总数（`notes.length` 已在 `:152`）· 按 `created_at` 日期分组计数（真时间戳，agent 自写笔记的落库时间，口径写明「Avery 写下的时间」不是业务时间）。🔴 无其他数字 |
| **vision** | 同 notes 模式：`.lite-vision`（`:1152`）→ `.lite-vision-scroll`（`:1159` `min(860px,100vw-48px)`）→ `.lite-vision-narrative`（head + `aside.lite-vision-summary` 3 点速读 + `ol.lite-vision-beats`）+ `.lite-vision-mocks`（`.lite-vision-mock-grid` `auto-fit minmax(300px,1fr)` `:1281` > 4 张 mock，**每张必带 `.lite-badge.lite-vision-tag`**，门相位 J 断言零未标注 mock）。纯静态零 store 订阅 | 只做排版：规则 1 标题块 · 规则 3 间距档 · 规则 4 字阶 · mock 网格保持 `auto-fit minmax(300px,1fr)`（已合规则）。🔴 **零数据化**——本屏不加任何真部件，`.lite-vision-tag` 一个都不能掉（门会红）。唯一示例人 `.lite-vision-person`（`:136-139`）保持零数字 |

### 3.8 栏宽现状总表（本战役最核心的一张）

| 屏 | 选择器 | 文件:行 | 当前值 |
|---|---|---|---|
| 顶栏（外夹） | `--lite2-frame-w` → `.prototype-topbar` | `lite2.css:5388` / `:5438` | `min(1480px, 100vw-48px)` —— **唯一消费者是顶栏** |
| team | `.home-frame` | `shared/styles/70-home-cards.css:13` | 1460px + `minmax(340px,38fr) 62fr` gap34 |
| home 空态 | `.lite-home-frame-empty` | `lite2.css:3534` → **`:5072` 覆盖** | 640 → **1040px** |
| projects | `.lite-projects-frame` | `lite2.css:4356` | 980px |
| **home** | **`.lite-home-frame`** | **`lite2.css:3523-3524`** | **860px** ← 主战场 |
| vision | `.lite-vision-scroll` | `lite2.css:1159` | `min(860px, 100vw-48px)` |
| followups | `.lite-followups-frame` | `lite2.css:2132` | 760px |
| closerlook | `.lite-closerlook-frame` | `lite2.css:1732` | 760px |
| notes | `.lite-notes-body` | `lite2.css:3210` | `min(760px, 100vw-48px)` |
| room 画布 | `.lite-room-board` | `lite2.css:737-746` | `width:1180px; max-width:none`（画布内世界宽，非内容栏） |
| playbooks / room 空态 | `.nexus-empty` | `shared/styles/40-nexus-empty.css:3-9` | `min(560px, 100vw-56px)` |

**断点集**（别再发明新的）：lite2.css 只有 `620 / 720 / 860 / 880 / 1100` 五个 max-width + `861` min-width；shared home-frame 用 `1080`。**新双栏应复用 880 或 1080。**

---

## 4. 分棒建议

> ⚠️ **我没有 handoff 里「棒A-棒X」骨架的原文**（侦察情报里未包含）。下面是按 cr-align 战役的分棒惯例（一棒一个可独立验收的形态变化 + 同 commit 誊 spec）重建的建议。**实施 agent 必须先读 handoff 核对棒名棒序，冲突以 handoff 为准。**

### 棒A · 工具链先行（**不改一个像素**）

| 改哪些文件 | 内容 |
|---|---|
| `eval-harness/tools/extract-cr-spec.mjs` | 扩 PROBE（`:23-78`）：加 `gridTemplateColumns` / `gap` / `width` / `maxWidth` / `getBoundingClientRect` 采集；⚠️ 是否加 `/companyinput` 到 ROUTES（`:21`）待定 |
| `eval-harness/tools/verify-cr-alignment.mjs` | 加新 row 类型 `probe:'rect'`（取 bbox 的 width/height/left/top）与 `probe:'count'`（`querySelectorAll().length`）。判据沿用现有 `exact/contains/px1/px2` |
| `eval-harness/specs/cr-align-spec.json` | 追加 `stick:5` 段的布局行（见下） |
| 🆕 `eval-harness/tools/run-battery.mjs`（或 `.ps1`） | 把 A/B/C 三区顺序 + dist 终局重建固化成 tracked 脚本，**解决「23 道无 tracked 名单」的考古债** |

**规格行怎么补（stick=5 起，示例格式）**：
```json
{ "key":"layout.homeFrameWidth", "stick":5, "screen":"home",
  "selector":".lite2-shell .lite-home-frame", "prop":"maxWidth",
  "expected":"1040px", "tolerance":"px1",
  "note":"她 main w-[min(1480px,100vw-48px)]；我方内容栏取 1040（空态先例 lite2.css:5072）" }
{ "key":"layout.homeRowCols", "stick":5, "screen":"home",
  "selector":".lite2-shell .lite-home-row", "prop":"gridTemplateColumns",
  "expected":"fr", "tolerance":"contains", "note":"双栏，实测值随视口变 px，用 contains 兜" }
```
⚠️ `gridTemplateColumns` 的 computed value 是**解析后的 px 串**（如 `"620px 400px"`）不是 `1.55fr 1fr` —— **必须用 `probe:'rect'` 量两栏实际宽度比，或用 `tolerance:'px2'` 对具体 px**。这条要现场探测确认。

体量：中（门改造 + spec 起段 + runner 脚本）。**本棒结束跑一次全电池确认零回归。**

### 棒B · 主页栏宽 + 双栏满宽

- 改 `lite2.css` 文件尾（5715 之后）新开 `═══ 布局战役 棒B ═══` banner：覆盖 `.lite-home-frame{max-width:1040px}`（同权重后写者胜）；`.lite-home-row` 断点从 720 上移到 **880 或 1080**；双栏比例改 `1.55fr 1fr`（对齐她的 60.8/39.2）。
- 🔴 团队屏 `.home-frame` 的 1460 在 **shared 文件**里 —— 用 `.lite2-shell .home-frame{max-width:…}` 在 lite2.css 覆盖，**不动 shared**（同法已有先例：`lite2.css:5401` 覆盖它的 padding-top）。
- 门：`verify-topbar-clearance`（栏宽变了让位仍要过）· `verify-cr-alignment SPEC_STICK=5` · 像素基线**会真动**（空态骨架在双栏内）。
- 体量：小-中（CSS 为主，TSX 可能零改）。

### 棒C · 主页 KPI 条上提 + 真数卡

- 改 `src/lite2/screens/HomeScreen.tsx`：把 `.lite-home-overview`（`:415`）的五格提到 header 之后作第二段满宽 KPI 条；新增卡：总 chunk 数 / 文件读取分桶 / 卡点总条数（§2.5 🆕 三项）。
- 文案：`en.ts` lite2 段加键 + `node scripts/i18n-zh-delta.mjs lite2`（见 §5.6 流程）。
- CSS：`.lite-home-counts` 从 `auto-fit minmax(104px,1fr)` 调成 5 列 + `@lg` 2 列（对齐她的 `grid-cols-5 → max-lg:grid-cols-2`）。
- 🔴 **不加卡底进度条**（她的 `bar%` 是硬编码）。
- 门：`verify-home-skeleton`（17 判据，**骨架零数字** —— 空态不能出 KPI 数）· `verify-zh-purity` · `verify-contrast-smalltext`（11.5px uppercase 标签是 AA 高危）。

> **▶ 验收批次 ① 切点：棒A-棒C 结束**。此时主页栏宽/双栏/KPI 三件成形，对照板首次可比。全电池 + 基线重冻 + Danny 过目。

### 棒D · 主页右栏两块真部件（差距面板 + 关注成员面板）

- 改 `HomeScreen.tsx:334-414` 两块：差距块加**三态筛选 chip + 按项目折叠**；关注块加口径句 + verbatim 原文（🔴 两个前置，§2.2）。
- 数据全在（`gapDerive.ts` / `homeDerive.ts`），**零 transport**。
- 严重度着色若要做：join `rawTeam.decisions`，join 不上退回无严重度。
- 门：`verify-status-truth`（27 判据仲裁者）· `verify-cr-alignment` · 扫雷 AA。
- 体量：中（TSX 为主）。

### 棒E · 顶栏真搜索

- 改 `src/lite2/LiteTopbar.tsx`：在 `:105`（`</nav>` 后）与 `:107` 之间插 `.lite-search`；`pointer-events:auto`；`hidden` 在 ≤1100（复用既有断点）。
- 新组件走 `LiteComposer.tsx:44-68` 同构 `includes()` 过滤；结果三类 person/project/page；上限 8（借她的数值）；Enter 直跳第一条 / Esc 收起 / 外点关闭。
- 🔴 必须给 `aria-label`（placeholder 两道门都够不着）；结果行零数字；`contextId===null` 时收起或明说。
- 文案：`en.ts` 新增 `lite2.searchPlaceholder` / `searchEmpty`（零匹配，**与 `refEmpty` 零数据区分**）/ `searchAria` / 三类分组标签。
- 门：`verify-button-family`（新按钮必须挂 `.lite-btn` 或进 `verify-button-family.mjs:39-53` 的 38 项白名单，**同 commit**）· `assertV2Boots` 九 tab 逐字比对（`live-frontend-gate.snippet.js:1337-1341`，别插进 `.scene-tabs`）· `verify-aria-zh`（硬门 target 0）· `verify-switchers`（顶栏右簇布局变了要复验）。
- ⚠️ **本棒需 Danny 先拍板**（decisions.md:26 列为「暂缓」）。

### 棒F · 悬浮提问入口

- 新组件挂在 `Lite2App.tsx:148-156` 那一簇（`.scene-stage` 的**兄弟**、`.lite2-shell` 直接子元素）。
- 🔴 **绝不能挂在屏组件内部**：`.scene.is-active{transform:translateY(0) scale(1)}`（`00-base.css:167-171`）非 none 的 transform **给 `position:fixed` 后代建立包含块**，且 `.scene{overflow:hidden}`（`:159`）会裁掉它。
- z-index：建议 **45**（页脚 30 / aurora 背幕 40 之上，顶栏 50 之下）。🔴 **必须 <60**（设置弹层）、<90（铃/登录弹层）、<120（modal）。顺手把 `--lite2-z-modal` 补成真声明（`lite2.css:335` 现在只有 fallback `var(--lite2-z-modal,120)`，全仓无声明）。
- 底部让位：`.lite2-compliance-footer`（`lite2.css:2437-2450`，`absolute bottom:0 padding:7px 20px`）；room 屏画布底 92px。
- 窄屏：≤860 时 `.app-shell` 变 `min-height:100vh; height:auto; overflow:visible`（`00-base.css:1115-1119`），`absolute` 会跟文档流走到很下面 → **窄屏必须切 `position:fixed`**（此时无 transform 祖先，fixed 安全）。
- 行为：`goScreen('room', {q})` 中继；`contextId===null` 时**整块不出**（复用 Room 无材料 gate）。
- 圆钮撞 `.lite-btn` 基类 `padding:4px 12px` → 参考 `lite2.css:5713` 的 `.lite-btn.ask-q-remove{padding:0}` 先例。
- 🔴 **术语**：不叫「快问」（已被 feat-034 Ask 占用），不叫 Nexus（锁词硬闸）。用「去议事室」族（`homeDecisionAskRoom` / `notesEmptyCta`）。**待 Danny 拍板，见 §6。**
- 门：`verify-button-family` · `sweep-ui-defects` 的 D1 fixed 遮压检测器（**这是它的主场**，872×900 世界最危险）· `verify-room-usability`（遮挡几何 + elementFromPoint）。

> **▶ 验收批次 ② 切点：棒D-棒F 结束**。三件真部件成形。全电池 + 扫雷全矩阵 + 对照板 + 基线重冻。

### 棒G · 其余屏骨架收敛（team/projects/followups/closerlook/notes/vision/playbooks）

- 按 §3.7 的 7 条通用语法批量收敛：标题块阶梯 · 圆角两档 · 间距三档 · 字阶 · **列表型改 `divide-y` 行流**（followups + notes 两屏）· 折叠区统一 `opacity-40 grayscale`。
- closerlook 加三态筛选 chip + 按项目折叠（数据已在）。
- projects 加卡内 `flex-1` 等高。
- playbooks 从单张空态卡改 2 列网格（🔴 保住 coming-soon 诚实标 + ⚠️ 它是唯一不消费 `--lite2-clear-top` 的屏，改成顶部对齐布局必须同时加进 `lite2.css:5401-5409` 的选择器列表）。
- 门：`verify-topbar-clearance` 九屏×两皮（playbooks 改动的直接裁判）· 全部中文门 · 像素基线**大动**。
- 体量：大。**可拆成 棒G1（followups+notes 列表化）/ 棒G2（closerlook+projects）/ 棒G3（playbooks+vision）**。

> **▶ 验收批次 ③ 切点：棒G 结束**（若拆成 G1-G3，则 G1-G2 一批、G3 一批）。

### 棒H · 收尾

- 全电池连续两轮零红 · 净室扫雷 0 件 0 指纹 · 对照板重拍 · spec 全 stick 硬断言全绿 · 基线人审后重冻 · docs 落档。
- 🔴 push = 自动上产 → **人工闸**。

---

## 5. 风险与红线复述

| # | 坑 | 怎么防 |
|---|---|---|
| 1 | **人面数字/血条**（她方 `/` PeopleRail 和 `/people` 卡是核心信息载体，抄进来就破红线） | 类型层无槽位（`transport.ts:104-114`）+ 运行时 `stripPersonNumbers` 丢弃任何 number 键（`teamData.ts:142`）。写关注成员面板时**只用 `AttentionPerson.signalCount/blockerCount` 并同屏写口径 + 摆 verbatim 原文**（`homeDerive.ts:60-63`）。人卡（team 屏）**结构上零数字**不许开口子 |
| 2 | **假按钮 / 编造指标** | 能力必须**先探测再露面**（ADR-0026；`demoStore.ts:6-9` 的示范：`demoStatus` 缺失或失败一律 `'no'` → 那扇门一个像素都不出）。§2.6 的「不做清单」逐条对照 |
| 3 | **`absent ≠ none`** | `null`/`undefined` 一律读作「文档未提及」，绝不是 0/空/默认（`projectView.ts:36-38`）。两种「空」措辞不许混（`HomeScreen.tsx:227` `data-empty-kind="absent"` vs `:232` `"none"`）。`LiveFileEntry.status` 缺席显「未知」不默认 ingested |
| 4 | **信号数说成项目数**（真事故：0 项目 + 2 信号 → 界面点名两个不存在的项目） | 按 `look_kind` 分流；`undefined` 走 `'items'` 侧（不点名）（`teamData.ts:91-105,272-275`） |
| 5 | **`statusRaw` vs `status`**（历史 bug：读被兜底的 `status` 让 1/4 真项目被造出客户没说过的自述） | 一切判据吃 `statusRaw`/`ownerNameRaw`，渲染文案才用 `status`/`ownerName`（`gapDerive.ts:22-30`、`teamData.ts:44-64`、`TeamScreen.tsx:48-63`）。`verify-status-truth`（27 判据）是裁判 |
| 6 | **CSS 注释里的「星号斜杠」** —— 注释里写 `tone-*` 后跟 `/` 会提前终结注释，残尾垃圾 token 让浏览器**吞掉紧随其后的整条规则**（`.lite-btn` 基规则在产物里存在却不生效） | 新 banner/注释块里禁止出现 `*` 紧跟 `/`。可疑时用 CSSOM 探针（`document.styleSheets` 遍历 vs 文本 fetch 对照）钉死。坑档 `lite2.css:5456-5458` |
| 7 | **媒体查询不加特异性** —— lite2.css 的 reduce 兜底 (0,2,0) 压不住 look-aurora (0,3,0)+ | 不提特异性，走**媒体级隔离**：动效应用段整个包进 `@media (prefers-reduced-motion: no-preference)`（`look-aurora.css:411,487,603` 三处先例） |
| 8 | **reduced-motion 块未闭合** —— `lite2.css:4058` 那个老块曾闷掉往下整片样式（伤疤注释 4075-4086） | 新动效**新开独立块、自带配平、不动老块**（棒4 先例 `lite2.css:5615-5633`） |
| 9 | **双类迁移交互态塌陷** —— 只加类不删老规则，"后位同权重接管"只在静止态成立；老 `:hover`/`:focus-visible` 在 (0,3,0)/(0,4,0) 拼成坏组合（墨字压墨底 ≈1.2:1、焦点环被老 `outline:none` 灭掉） | 配**族强断言层**：双写选择器 `.lite2-shell .lite-btn.lite-btn--x` 收全态全属性（`lite2.css:5635-5715` 现成模板） |
| 10 | **paper 皮静默失效** —— aurora-only token 有 19 个（`--lite2-glass-blur`/`--lite2-surface-soft`/`--lite2-grad-*`/`--lite2-tone-*-{bg,fg}`/`--lite2-radius-lg` 等），共享基类误用会让 paper 落 initial | 共享基类只消费**两皮都声明的 22 个**；带 fallback 写法是惯例（`var(--lite2-radius-lg, 16px)` `lite2.css:5442`）。`verify-skin-phases` 的 `assertPaperUnchanged` 对 `PAPER_BASELINE` 逐字节 diff —— ⚠️ 但基线只覆盖有限探针，**新部件不在探针清单里会静默失效**，新增部件应同时进探针 |
| 11 | **`shared/styles/00-base.css` 一行不改** | 要覆盖 shared 规则一律在 `lite2.css` 用 `.lite2-shell` 前缀提特异性（先例：`:5401` 覆盖 `.home-frame` 的 padding-top）。`verify-skin-phases` 第三段 `assertSkinNoLeak` 就是这条的持续证明 |
| 12 | **悬浮球被 transform 包含块坑** | 见棒F。挂 `.lite2-shell` 直接子层；窄屏切 fixed |
| 13 | **顶栏九 tab 逐字闸** | 搜索框绝不进 `.scene-tabs`；改 tab 主名要同 commit 改 `live-frontend-gate.snippet.js:1340-1341` 的 `expected` 数组 + `verify-p0` 锁词表 + `verify-switchers`（**三处联动**，ADR-0025 决策 1） |
| 14 | **锁词** | `Nexus`/`nexus`/`现实差距` 三词 `verify-p0.mjs:265` 硬闸扫 innerText（**扫不到 aria-label/title/alt** → `verify-aria-zh` 补位）。「指挥室」已解锁（ADR-0025）。「快问」= feat-034 Ask 专名，锁在 M3 SYS 铁律里 |
| 15 | **中文纯度门的洞** | `placeholder` **两门都够不着** → 新输入框必须同时给 `aria-label`（走 `t.*`）。`verify-aria-zh` 是真硬门 target 0（白名单只有 `/^(Avery\|demo)$/`） |
| 16 | **构建压缩去 custom property 前导 0** | spec 期望串写 `.97` 不写 `0.97` |
| 17 | **浅灰小字压壳渐变裸底** | aurora 背幕 `circle at 8% -2%` 恰在左上 greeting 位，#667085 实算 3.24:1 破 AA → 小字色一律取我方 `*-text` 补偿值。`verify-contrast-smalltext` 实算 |
| 18 | **电池序 / 独占** | A→B→C(dist 调包者)→终局重建；序错中段 visual/button-family 必红；并发跑出假红（棒4 出过 6 条） |
| 19 | **`verify-bundle-privacy` 后往生产库写数据** | 它跑完 dist 指向**生产域名**。跑完必须先重建 dev dist 再碰任何上传路径。7/20 真发生过 |
| 20 | **像素基线这次会真动** | 上一战役"36 张原样绿"是构造性的（基线世界是 stub 空态）。本战役改空态骨架/栏宽/网格 → 每次基线变化**必须先目检 diff 再复验绿**，`--update-snapshots` 只在人审对照板通过后同 commit 提交（`playwright.config.mjs:7`） |
| 21 | **绝对路径绕过 worktree**（记忆坑档） | 当前在 `claude/layout-real-components-27b594`。收工前查 branch/status；合 main 在自己 worktree 里做 |
| 22 | **i18n 脚本冲掉注释头** | 用 `scripts/i18n-zh-delta.mjs`（保留 150 行来源注释头），**不要**用 `scripts/i18n-zh.mjs` 或 `i18n-zh-lite2-delta.mjs`（会静默冲掉且不报错）。lite+lite2 双壳要**分两趟**：`node scripts/i18n-zh-delta.mjs lite` 然后 `node scripts/i18n-zh-delta.mjs lite2 --mirror=lite` |
| 23 | **孤儿键无门** | `AGENTS.md:57` 列为红旗但无工具。当前基线 16 个孤儿键。⚠️ **12 个 `upload.again*/switch*` 键（`en.ts:80-106`）描述的正是「本浏览器上传过的公司列表 + 切换 + 移除」UI —— 本战役若做右栏「文件/公司来源」面板，这批键已写好，直接复用别新造** |

---

## 6. 未决问题

### 需 Danny 拍板

| # | 问题 | 背景 / 选项 |
|---|---|---|
| **P1** | **悬浮入口叫什么？** | 「快问」已被 feat-034 Ask 占用（9+ 键 + 通知 + followups 来源标签 + M3 SYS 铁律）。同屏会出现两个"快问"：一个把话发给 LLM，一个把链接发给员工。选项：(a) 悬浮入口用「问一句 / 去议事室」族（`homeDecisionAskRoom:'Take it to the room'`），成本最低；(b) 把 feat-034 Ask 改名（波及 9+ 键 + 通知 + 来源标签，成本远大于本战役）。**建议 (a)。** 🔴 无论如何不能叫 Nexus |
| **P2** | **全局搜索要不要做？** | `.issues/lite-live-v02-0713/decisions.md:26` 把「全局搜索」明确列在「暂缓/不动」。数据侧完全够（§2.4），风险不在技术在产品口径。**需重新拍板**才能开棒E |
| **P3** | **主页内容栏定 1040 还是 1480？** | 顶栏是 1480（`--lite2-frame-w`，目前唯一消费者）；内容栏最宽 team 的 1460、次 home 空态 1040。选 1040 = 与空态先例同构、与 projects(980) 落在同带；选 1480 = 与顶栏共基准线（她方就是全站一个 1480）。**影响所有后续棒的 spec 期望值，必须先定** |
| **P4** | **playbooks 屏要不要改成 2 列网格？** | 只有 8 条静态 i18n 文案，无真数据。改了是"布局对齐"，不改是"诚实空态"。且它是唯一不消费 `--lite2-clear-top` 的屏，改动成本额外 |
| **P5** | **`upload.switch*` 12 个孤儿键：复用还是删？** | 删是**删除类动作**需人工闸。若本战役要做右栏「历史工作区/文件来源」面板（数据源 `knownContexts` ≤12，`store.ts:282`），这 12 个键直接就位 |
| **P6** | **孤儿键门要不要立？** | 当前基线 16 → 门要么先记基线、要么先删 12 个（人工闸）。本战役顺手做 vs 留给下一战役 |

### 需实施时现场探测

| # | 事项 | 怎么探 |
|---|---|---|
| **E1** | `gridTemplateColumns` 的 computed value 形态 | 浏览器返回解析后 px 串（如 `"620px 400px"`）而非 `1.55fr 1fr`。**spec 行到底用 `contains:"fr"` 还是 `probe:'rect'` 量宽度比，必须在棒A 现场跑一次 `getComputedStyle` 确认** |
| **E2** | 她方 `/` 双栏在 1440 视口下的**实际像素宽** | `extract-cr-spec` 扩 PROBE 后跑一次采出来，才能定我方 spec 的期望值（1.55fr:1fr 在 1480 容器 gap18 下 ≈ 897 : 565） |
| **E3** | 电池「第 23 道」到底是哪个 | 候选：`verify-null-owner` / `verify-404-discriminator` / `verify-bare-url-shell`，三者都活着。棒A 落 runner 时按实际能跑通的集合定 |
| **E4** | 顶栏搜索框插入后右簇的实际布局 | `.scene-tabs{margin-right:auto}` + 新块的 flex 行为需实拍；≤1100 隐藏断点值要在 872 世界扫雷里验 |
| **E5** | 主页栏宽改 1040 后，`.lite-home-row` 断点取 880 还是 1080 | 880 会让 1040 容器在 880-1040 区间仍双栏（每栏 ~430px，可能太挤）；1080 会让 1040 容器**永远单列**（因为 max-width 1040 < 1080）→ ⚠️ **必须取 880 或新加一个值**，这条要实测 |
| **E6** | 悬浮球 z=45 是否与 aurora 背幕（`look-aurora.css:335` z40，100px 模糊）视觉冲突 | 背幕是 `::before` 伪元素，z40 → 球 45 在其上。需实拍确认球不被模糊边缘吃掉 |
| **E7** | 像素基线跨机问题 | 基线 PNG 是 **untracked**（11.3MB，`git ls-files __snapshots__/` 零命中）。⚠️ 换机器 = 36 张全部重采，且 `snapshotPathTemplate` 刻意去掉平台后缀 → **跨机静默错配**。实施前确认在同一台机器 |
| **E8** | `verify-cr-alignment` 灌数据配方是否覆盖新部件 | 它只灌一份中文周报 SEED_DOC + `setState` 塞一条 decision（`:48-71`）。**新增的差距面板/关注成员面板需要 blockers + signals 才有内容** → 可能要扩它的世界搭建，否则 spec 行选择器无匹配 → `actual===null` → 判红 |