> 侦察原件 · 视角 `copy` · 2026-07-22 自动生成，未经人工编辑。

## 1 · `D:/avery/src/shared/i18n/` 形状

**5 个文件，无子目录**

| 文件 | 行数 | 角色 |
|---|---|---|
| `D:/avery/src/shared/i18n/en.ts` | 1400 | 唯一文案源。`export const en = {…}` 起 `en.ts:12`，`export type Dict = typeof en` 收在 `en.ts:1400` |
| `D:/avery/src/shared/i18n/zh.ts` | 958 | **全量**（不是 delta）。`export const zh: Dict = {…}` 在 `zh.ts:161`；1–160 行是 `import type { Dict } from "./index"` + 约 150 行来源注释块（哪些键手写、哪些 ✅M3-PASSED、哪些待审字），**只存在于这里**的事实 |
| `D:/avery/src/shared/i18n/index.ts` | 96 | resolver。`DICTS: Record<Locale, Dict>` @`:26`，`resolveLocale()` @`:74`，`getDict()` @`:93`，`LOCALE_STORAGE_KEY = 'lite2:lang:v1'` @`:47` |
| `D:/avery/src/shared/i18n/localeStore.ts` | 35 | zustand store，`initialLocale()` @`:20` |
| `D:/avery/src/shared/i18n/useDict.ts` | 14 | `useDict(): { t: Dict; locale: Locale }` @`:10` —— 返回**整本字典**，没有 `t('a.b.c')` 函数式 API |

**顶层 section（en/zh 键序完全一致）**：`mode`(en:14) `upload`(29) `team`(110) `nexus`(120) `transport`(136) `lite`(162) `lite2`(498) `ask`(1328)。结构只有**两层**（section → 扁平叶子键），无三层嵌套。

**回退规则：没有运行时缺键回退。** `getDict(locale)` 直接返回整本字典；`t.lite2.foo` 若 zh 缺键就是 `undefined` 渲染成空白。防线全在编译期。

**类型约束（强）——实测确认**，用 `D:/avery/node_modules/typescript/bin/tsc --noEmit --strict` 跑最小复现：
- zh 漏键 → `error TS2741: Property 'y' is missing in type … but required in type …`
- zh 多键 → `error TS2353: Object literal may only specify known properties`（`zh: Dict` 是带注解的对象字面量，excess property check 生效，**嵌套层同样生效**）

⇒ `npm run typecheck`（`tsc -b`）就是漏键/孤儿键的编译期门。**但**：`Dict = typeof en` 把 value 类型宽化成 `string`（不是 literal），所以 **zh 里塞英文原文照样编译通过**。当前全库 zh===en 的键只有 2 条，都合法：`upload.acceptedExts`（`.pdf · .docx · …`，en.ts:61）和 `ask.kindScale`（`1–5`，en.ts:1353）。

**总键数：en 772 / zh 772，missing 0 / extra 0**（我用 scratchpad 脚本 flatten 后逐条比对）。

---

## 2 · 加一条新文案的完整步骤

**canonical 工具是 `D:/avery/scripts/i18n-zh-delta.mjs`（feat-069 的通用增量器），不是那两个老脚本。**

| 脚本 | 状态 |
|---|---|
| `scripts/i18n-zh.mjs`(134行) | 全量/定向重译。⚠ `out` 模板只写 3 行头 → **会把 zh.ts 那 150 行来源注释块整个冲掉，且不报错**（该脚本自己的 header 没提这事，delta 脚本头部 ③ 记了） |
| `scripts/i18n-zh-lite2-delta.mjs`(133行) | 只认 `lite2` 一个 section，硬编码。同样冲注释头 |
| **`scripts/i18n-zh-delta.mjs`(217行)** | **用这个**。逐字保留原注释头（`:196` `preservedHeader`），末尾追加本次运行记录 |

**顺序（en.ts 与 zh.ts 必须同 commit）：**

1. 在 `en.ts` 对应 section 里加键。位置＝section 内自选，**但 zh.ts 会按 `Object.keys(en[section])` 重排**（`i18n-zh-delta.mjs:184-193`），所以 en 的键序就是 zh 的键序。
2. 若 `lite` 和 `lite2` 都要（v01/v02 双壳惯例，见 `en.ts:1305-1308` 注释）：两边**键名+英文值逐字相同**，这样 mirror 能免费复用。
3. 跑 dry-run 看 delta：`node scripts/i18n-zh-delta.mjs --dry-run lite2`
4. 真跑，**必须分两趟**（`i18n-zh-delta.mjs:8` 的警告）：
   ```
   node scripts/i18n-zh-delta.mjs lite
   node scripts/i18n-zh-delta.mjs lite2 --mirror=lite
   ```
   只加 lite2 就单跑 `node scripts/i18n-zh-delta.mjs lite2`。
5. `npm run typecheck` —— 漏键在这里红。
6. `npm run lint`（只有 story/lite/lite2/shared 四道 import 墙，`D:/avery/eslint.config.js`；**没有任何硬编码字符串 lint 规则**）。

**脚本自带的三道内建闸（都在调 M3 之前）：**
- `i18n-zh-delta.mjs:96-108` —— zh.ts 对象体里若有 `//` 手写注释就**拒绝写入**（JSON.stringify 会静默抹掉）。当前对象体 0 行注释，所以不会拦。
- `i18n-zh-delta.mjs:69` —— 已存在的 zh 键**一律不动**（定稿保护）。要强制重译必须先手删 zh.ts 里那行。
- `i18n-zh-delta.mjs:147-149` —— M3 漏键就抛错；`:171-177` 三次失败**整段不写**，绝不拿英文冒充译文。

**前置条件**：`eval-harness/.env` 里的 `MINIMAX_API_KEY`（untracked，本机有）。

**有没有门会查孤儿键/漏键？**
- 漏键：有，`tsc -b`（TS2741）。
- 多键：有，`tsc -b`（TS2353）。
- **孤儿键（有键无组件引用）：没有任何脚本**。`git ls-files "*verify-*.mjs"` 出来的 20+ 道门里零覆盖，`package.json` scripts 只有 dev/build/preview/typecheck/lint。`AGENTS.md:57` 把孤儿键列为红旗，但没给工具。

---

## 3 · 锁词清单

**权威三处**：`D:/avery/CONTEXT.md`（术语表）· `D:/avery/docs/adr/0025-command-room-alignment-naming-unlock-aurora-default.md`（0721 部分解锁）· `D:/avery/.issues/v02-partner-align-0718/decisions.md §六`（0718 原锁定词表）

### 「Nexus」—— 维持锁定，不上屏
- `CONTEXT.md:29-32`：Nexus = 内部领域概念名（行动面/多 agent 编排）。_Surface label_：user-facing 不出现 "Nexus"/"orchestration"；动作语境用 **"Working it through"**，名词指代用 **"the room"**。
- **en.ts 里 `Nexus` 一个 value 都没有**——只有 3 处：`en.ts:119` 注释、`en.ts:508` 注释、`en.ts:1172` 注释。`nexus:` 是 section **命名空间名**（`en.ts:120`），值是 `liveThinking: 'Working it through — live'` / `liveReady: 'The read is ready'` / `askPlaceholder: 'Ask about your team…'`。
- CSS class 名大量保留 `.nexus-*`（`src/story/styles/10-dashboard-nexus.css`、`src/lite2/screens/RoomScreen.tsx:241` `.nexus-followup-composer`）——**class 名不算上屏，无需改**。
- **机器闸**：`.issues/v02-partner-align-0718/verify-p0.mjs:265`
  ```js
  const bad = ['Nexus', 'nexus', '现实差距'].filter((w) => visibleText.includes(w))
  ```
  `:266` 断言 `bad.length === 0`。注意它扫 `visibleText`（innerText），**扫不到 aria-label/title/alt**。

### 「现实差距」/ Reality gap —— 维持锁定
- `CONTEXT.md:62-66`：Reality gap = "被相信的状态 vs 实时信号"的矛盾；_Surface label_ 改 **"Worth a closer look"**，底层概念名不变；子类叫 report mismatch。
- 我方码里 surface：`lite2.tabCloserLook: 'A closer look'`(en.ts:512)、`gapPageEyebrow/Title/Body`(619-621)、`homeGapsTitle: 'Where the files disagree with themselves'`(1243)、`handoffToneLabel: 'Worth a closer look'`(815)。中文侧 `zh.ts:422 "tabCloserLook": "多看一眼"`。
- **变量/文件名仍用 gap**（`src/lite2/gapDerive.ts`、键前缀 `gap*`）—— 这是刻意的内部名，不违规。
- 她方对照（`D:/cr-live`）：`src/app/gaps/page.tsx:41` `现实差距`、`src/app/page.tsx:16` `4 处现实差距`、`src/components/shell/topbar.tsx:44` 搜索索引项 `现实差距`、`src/lib/data.ts:621` `sourceLabel: "来自现实差距"`、`src/app/checklist/page.tsx:107`。**她的这几处一个字都不能搬。**

### 「指挥室」—— 0721 已显式解锁
- `docs/adr/0025-*.md:13-15`：解锁理由「它形容的是房间不是人，不触发刺痛测试」。
- 落地：`en.ts:1173 tabHome: 'Command room'` / `:1174 tabHomeSub: 'Today'`；`zh.ts:811 "指挥室"` / `:812 "今天"`；`en.ts:1182 homeSkeletonTitle: 'This is your command room'`。
- `verify-p0.mjs:262-263` 注释明写「指挥室从锁定词表显式解锁」。

### 「快问」= Quick ask —— 术语表锁死，**且写进了 M3 的 system prompt**
- `CONTEXT.md:46-49`：_Surface label_ EN **"Quick ask"** / ZH **"快问"**。_Avoid_: survey/问卷（表单工具腔）、poll/投票（匿名聚合语义）、打分/评分（撞红线）。
- **锁在生成器里**：`scripts/i18n-zh.mjs` SYS 铁律 6 与 `scripts/i18n-zh-delta.mjs:121` 铁律 4 —— 逐字写着「"Quick ask" 的中文 surface 名固定为「快问」——不是「快速提问 / 问卷 / 调查 / 投票」；"Self-reported" 固定为「本人自述」」。⇒ **新增快问相关键会自动带上这条约束，不需要额外动作。**
- 现有出处（EN，`en.ts`）：`ask.eyebrow: 'Quick ask'`(1329)、`lite2.gapAskLabel: 'Ask them directly'`(632)、`lite2.followupsSourceAsk: 'From a quick ask'`(592)、`lite2.streamAskDrafted: 'A quick ask is drafted — yours to confirm'`(837)、`ask.draftTitle: 'Worth asking them directly'`(1330)。
- 现有出处（ZH，`zh.ts`）：`:914 "eyebrow": "快问"`、`:472 "followupsSourceAsk": "来自快问"`、`:329/:595 "streamAskDrafted": "一条快问已拟好，等你确认"`、`:780 "notifAsk"`、`:947 "errorGeneric": "连不上快问服务——再试一次。"`、`:950/:953/:956`。

### 「问 Nexus ≠ 快问」怎么在码里体现
这条差异**不是一个 if/else，而是三层结构性隔离**：
1. **她的入口是一个常驻全局 FAB**：`D:/cr-live/src/components/shell/nexus-fab.tsx:74` 按钮文案 `问 Nexus`、`:43` placeholder `向 Nexus 提问...`；`src/components/command/decision-queue.tsx:108` `深入问 Nexus`；`src/components/projects/project-detail-modal.tsx:366` `问 Nexus`；`src/app/nexus/page.tsx:79` 页面 H1 就是 `Nexus`，`:166` placeholder `向 Nexus 提问...`。她的 Nexus 是**对 AI 提问**。
2. **我们的「快问」语义完全不同**：`ask.*` 是**给真人发一条私有链接问 TA 本人**（`ask.recipientsHint: 'Named people from your roster — each gets their own private link.'` en.ts:1364；`ask.selfReported: 'Self-reported'` :1373）。对 AI 提问在我们这里叫**「议事室 / The room」**（`lite2.tabRoom: 'The room'` en.ts:500 / `zh.ts:417 "议事室"`），入口是 composer（`nexus.askPlaceholder: 'Ask about your team…'` en.ts:125）。
3. ⇒ **她的「问 Nexus」映射到我们的「去议事室」（`lite2.homeDecisionAskRoom: 'Take it to the room'` en.ts:1238 / `triageTakeToRoomLabel` :860 / `notesEmptyCta: 'Ask the room'` :679），不映射到「快问」。** 把她的 FAB 概念搬过来时若标成「快问」就是术语撞车。

---

## 4 · 中文纯度门

**路径：`D:/avery/.issues/feat-068-frontend-deploy/verify-zh-purity.mjs`（354 行）。** 不在 `scripts/`、不在 `eval-harness/tools/`（AGENTS.md:57 附近那段说门分散两处，找门用 `git ls-files "*verify-*.mjs"`）。

**验什么**
- 逐屏抓 `document.body.innerText`，`latinHits()`(`:217-229`) 捞出「≥2 个连续拉丁词，或单个长度 ≥4 的拉丁词」的可疑串。
- 覆盖屏：`:29` `V2_SCREENS = ['home','team','projects','room','followups','notes','closerlook','playbooks','vision']` —— **正好九屏**。v01 走 `?v=1`(`:275`)，v02 走 `?v=2&mode=live&look=paper&lang=zh`(`:305`)。
- 议事室额外**真跑三段脚本流**(`:79-124` `ROOM_SCRIPTS`)，覆盖 6 个 stream code；v02 还要展开 `[data-flow-toggle]` 原始流再采一次(`:184-198`)。
- 白名单 `:36`：`/^(Avery|Esc|W\d+|\d+%|v\d+|MB|PDF|CSV|XLSX|DOCX|TSV|TXT|MD|OK|Word|Excel|Markdown)$/i`

**硬失败只有两条**（`:353` `process.exit(pageErrors.length || empties.length ? 1 : 0)`）：① pageerror 非空；② 议事室采样时对话流为空。**拉丁残留数本身不构成失败**——它只打印待人工判读清单（`:16` 「本脚本只负责把可疑串捞出来给人判」）。

**已知可接受项**（`:336-347`）：文件格式专名；「往哪走」屏刻意中英混排的 `demo / agent / prompt` 三词（`Skills/tools/onboarding/review/skill` 已翻，**别再往回加**）；议事室里 `read_case / cite / case_id / source_ref` 是后端协议 token 逐字透传。

**姊妹门（属性侧，扫 innerText 够不着的）：`D:/avery/eval-harness/tools/verify-aria-zh.mjs`**。同样九屏(`:44`)，白名单只有 `/^(Avery|demo)$/`(`:57`)，**四条硬失败**：pageerror / 对话流空 / 采样元素数为 0 / 白名单外命中数 > 0 —— **这道是真硬门，target 0**。

**新文案要满足什么**
1. ZH value 必须无拉丁词（除白名单）；**新的 aria-label / title / placeholder 一律走 `t.*`，任何硬编码英文属性会被 verify-aria-zh 判死**（0720 一次审计数出 ~88 处硬编码英文 aria-label）。
2. 搜索占位符是 `placeholder=` 属性 → **不进 innerText**，只有 verify-aria-zh 扫得到？——**不，它扫的是 aria-label/title/alt**。⚠ **placeholder 目前两道门都够不着**，是个真洞。新加搜索框务必同时给 `aria-label`（受 verify-aria-zh 覆盖）。
3. 无结果态/KPI 卡标题都是 innerText → 受 verify-zh-purity 覆盖。
4. 九屏名单已含全部目标屏，无需改门；但**若新增第 10 屏，两道门的 `V2_SCREENS` 数组各改一处**。

---

## 5 · 九屏 tab 主名 + 各屏标题键名清单

**tab 渲染：`D:/avery/src/lite2/LiteTopbar.tsx:51-65`**，主名进 `.scene-tab-main`(`:95`)，副小字进 `.scene-tab-sub` + `aria-hidden="true"`(`:96`)。

**门的唯一真源：`D:/avery/scripts/gates/live-frontend-gate.snippet.js:1340-1341`**
```js
const expected = ['Command room','Your team','Projects','The room','To-do list',"Avery's notes",'A closer look','Playbooks','Where this goes'];
const expectedSubs = ['Today', null, null, null, 'Follow-ups', null, null, null, null];
```
⚠ `en.ts:509` + `snippet.js:1324-1327`：**任何一行改 tab 主名，必须同 commit 改这个数组**；ADR-0025 决策 1 末条还要求同步 `verify-p0` 锁词表 + `verify-switchers`（三处联动）。

| # | screen id | tab 主名键 (en.ts行) | EN 值 | ZH (zh.ts行) | 副小字键 | 屏内 eyebrow / title / lede 键 (en.ts行) | 渲染文件 |
|---|---|---|---|---|---|---|---|
| 0 | `home` | `lite2.tabHome`(1173) | Command room | 指挥室(811) | `tabHomeSub`(1174)=Today→今天(812) | `homeEyebrow`(1175) `homeTitle`(1176) `homeLede`(1177) | `screens/HomeScreen.tsx:201` |
| 1 | `team` | `lite2.tabTeam`(499) | Your team | 你的团队(416) | — | **无屏标题**；用 `briefingEyebrow`(787)="From your uploads" + `metricsLabel`(788)="Team at a glance"；空态 `emptyEyebrow`(876) | `screens/TeamScreen.tsx:218,222,367` |
| 2 | `projects` | `lite2.tabProjects`(933) | Projects | 项目(646) | — | `projectsEyebrow`(934) `projectsTitle`(935)="The projects in your documents" `projectsLede`(936) | `screens/ProjectsScreen.tsx:209` |
| 3 | `room` | `lite2.tabRoom`(500) | The room | 议事室(417) | — | **无屏标题**；只有空态 `roomEmptyTitle`(887)/`roomEmptyBody`(888)、`roomNoMaterialTitle`(895)、`roomChipsLabel`(1089) | `screens/RoomScreen.tsx:353,366,378` |
| 4 | `followups` | `lite2.tabFollowups`(510) | To-do list | 待办清单(420) | `tabFollowupsSub`(511)=Follow-ups→跟进(421) | `followupsEyebrow`(581)="Follow-ups" `followupsTitle`(582) | `screens/FollowupsScreen.tsx:215` |
| 5 | `notes` | `lite2.tabNotes`(516) | Avery's notes | Avery 的笔记(423) | — | `notesEyebrow`(661)="Field notes" `notesTitle`(662) `notesLede`(663) | `screens/NotesScreen.tsx:146` |
| 6 | `closerlook` | `lite2.tabCloserLook`(512) | A closer look | 多看一眼(422) | — | `gapPageEyebrow`(619) `gapPageTitle`(620) `gapPageBody`(621) | `screens/CloserLookScreen.tsx:74` |
| 7 | `playbooks` | `lite2.tabPlaybooks`(501) | Playbooks | 操作手册(418) | — | `playbooksEyebrow`(683)="Coming soon" `playbooksTitle`(684) `playbooksBody`(685) | `screens/PlaybooksScreen.tsx:34` |
| 8 | `vision` | `lite2.tabVision`(502) | Where this goes | 未来方向(419) | — | `visionEyebrow`(703) `visionTitle`(704) `visionLede`(705)；第二段 `visionMockEyebrow`(745)/`visionMockTitle`(746)/`visionMockLede`(747) | `screens/VisionScreen.tsx:78,120` |

**home 四块面板标题（＝现有「右栏面板/KPI 卡」最近亲）**，全在 `en.ts` lite2 段：
- 块1 `homeDecisionsTitle`(1207)="To decide today" + `homeDecisionsCount`(1208)="{total} on the table" + `homeDecisionsOrderNote`(1209)
- 块2 `homeGapsTitle`(1243)="Where the files disagree with themselves" + `homeGapsCount`(1244)="{count} open" + `homeGapsLink`(1246)="A closer look"
- 块3 `homeAttentionTitle`(1250)="People the files keep bringing up" + `homeAttentionCaption`(1251)="Counted from what your documents say — not a rating of anyone." + `homeAttentionLink`(1255)
- 块4 `homeOverviewTitle`(1258)="What Avery is working from" + `homeOverviewPeople/Projects/Files/Notes/Followups`(1259-1263)
- 今日待办块 `homeTodayTitle`(1200) `homeTodayEmpty`(1201) `homeTodayMore`(1203)

**现有搜索/无结果相关键（全库只有这一组，且不是全局搜索）**：`lite2.refSearch`(905)="Reference a person or project"（composer 引用选择器 placeholder，`LiteComposer.tsx:173`）、`refAll/refPeople/refProjects`(901-903) 三个筛选 chip(`LiteComposer.tsx:38-40`)、`refAdd`(904)、`refEmpty`(906)="Upload a few files first — people and projects appear here."（**这是"零数据"，不是"零匹配"**）。
⇒ **全局搜索占位、无结果态，两个键都不存在，是真新增。** 她方对照：`D:/cr-live/src/components/shell/topbar.tsx:228` placeholder `搜索成员、项目...`、`:250` 空态 `未找到结果`（数值可参考，源码不搬）。

**插值机制**：无库、无 i18n runtime。`fill(template, vars)` = `template.replace(/\{(\w+)\}/g, (_,k)=>String(vars[k] ?? ''))`，**在 19 个文件里各自复制了一份**（`src/lite2/screens/HomeScreen.tsx:30`、`src/shared/briefing.ts:89`、`src/shared/handoffCopy.ts:66`、`src/lite2/AskCard.tsx:21`、`src/lite2/LiteBell.tsx:19`、`src/lite2/LiteComposer.tsx:20`、`src/lite2/OnboardGate.tsx:56`、`src/lite2/onboardNote.ts:20`、`src/lite2/screens/{ProjectsScreen:40,RoomScreen:41,TeamScreen:32}`、`src/lite2/teamData.ts:171`、`src/lite2/transport.ts:440`、`src/lite2/UploadPanel.tsx:93` + 5 处 v01 双胞胎）。**没有共享导出**——新屏若要带 `{count}` 就得再抄一份，或者第一次把它提到 `src/shared/`。未知变量静默变空串（`?? ''`）。

---

## 6 · 孤儿键：没有现成脚本；我现扫了一遍，**16 个键是孤儿**

**没有任何脚本查孤儿键。** `AGENTS.md:57` 把它列为红旗并记了案例（合并 `3106536` 整边丢弃 236 行文件状态渲染，只剩键留在原地；同一合并还吃掉 `transport.ts` 的 `withServerDetail`），但工具缺位。

我用 scratchpad 脚本（import en.ts/zh.ts，把 772 个键的叶子名对全部 `src/**/*.{ts,tsx}`（排除 `src/shared/i18n/`）做 `\b<name>\b` 匹配；**这是宽松判据——出现在注释里也算"被引用"，所以下面是孤儿的下界**），再逐条 `grep -rn` 到 `src/ scripts/ eval-harness/tools/` 复核，零命中确认：

| 孤儿键 | en.ts 行 | 值 |
|---|---|---|
| `mode.switchToLive` | 19 | 'Try it with your team' |
| `mode.switchToStory` | 20 | 'Back to the walkthrough' |
| `upload.againTitle` | 80 | 'Adding more files starts a separate company' |
| `upload.againBody` | 81 | |
| `upload.switchTitle` | 83 | 'Uploads on this browser' |
| `upload.switchAction` | 84 | 'Open this one' |
| `upload.switchOpening` | 85 | 'Opening…' |
| `upload.switchCurrent` | 86 | 'Currently open' |
| `upload.switchFilesLabel` | 87 | 'Read from' |
| `upload.switchForget` | 90 | 'Remove from this list' |
| `upload.switchForgetNote` | 91 | |
| `upload.switchErrorMissingCredential` | 96 | |
| `upload.switchErrorUnreadable` | 104 | |
| `upload.switchErrorFailed` | 106 | |
| `team.liveEyebrow` | 111 | 'From your uploads' |
| `lite.notesOpenRoom` + `lite2.notesOpenRoom` | 283 / 674 | 'Open the room →' |

**溯源**：`git log --all -S "switchFilesLabel" -- src/` 只返回一个 commit `e49cda3 fix(fixD): 数据边界 —— 二次上传回得去 + 换账号真清场`——即这 12 个 `upload.again*/switch*` 键**从来没有过渲染方**（不是被合并吃掉的，是生来就孤）。它们描述的是「本浏览器上传过的公司列表 + 切换 + 移除」这个 UI，在 v02 里完全不存在。⇒ **本战役如果要做右栏「文件/公司来源」面板，这 12 个键已经写好了，直接复用，别新造。**

`upload.fileStatus*` 那一族**不是孤儿**（`3e69d63 fix(ingest-ui): 文件清单状态渲染找回` 已修复，现在 `src/lite2/UploadPanel.tsx` 在用）——我第二版严格扫描把它们误报成孤儿，是因为粗暴的 `/*…*/` 剥离把 JSX 吃掉了半个文件（`CloserLookScreen.tsx` 8984→4523 字符），**那版结果不可用，以上表为准**。

**建议的门（本战役可顺手补）**：把上面这段逻辑固化成 `scripts/gates/verify-i18n-orphans.mjs`，判据用宽松版（注释里出现也算引用）+ 白名单，target 0。当前基线是 16，所以门要么先记基线要么先删 12 个 `upload.switch*`（那是**删除类动作**，需要人工闸）。