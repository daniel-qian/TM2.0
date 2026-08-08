# recon-copy · 全局中文文案审计（0808 重构侦察）

> 只读侦察产物。**本次侦察没有改动任何文件。**
> 目标读者：后续开发 session。写成「别重新侦察」密度——每条都带 `file:line`，改法给到可直接粘贴的成品文案。
>
> 触发原话（Danny，0808 复盘）：清理「之前问过的」这类不通顺的奇怪文案，换成 SaaS 大白话（如「历史」「对话列表」）；整体感觉「设计自嗨」「缺乏反馈假想」。参照 Notion / 飞书 / Claude 中文界面的语感。

---

## 0. 范围与方法

- 唯一文案源：`src/shared/i18n/zh.ts`（1334 行，987 个字符串叶子 + `decisionRules` 嵌套块）。英文源 `src/shared/i18n/en.ts`（1864 行）。
- 三个大段：`lite`（zh.ts:306-486，**v01 冻结壳**，`?v=1` 才可达）／`lite2`（zh.ts:487-1288，**生产默认壳**，本轮主战场）／`ask`（zh.ts:1289-1333，快问）＋ `mode/upload/paperwork/team/nexus/transport` 六个共享小段（zh.ts:199-305）。
- **`lite` 段（306-486）本轮原则上不动**：它是冻结壳，词族刻意与 lite2 分叉（「议事室／多看一眼」vs「问 Avery／值得注意」），改它只会制造两壳不一致。下文除非点名，所有行号都指 lite2 或共享段。
- 渲染点用 `[.\['"]<key>\b` 反查 `src/**/*.tsx|ts`（排除 i18n 自身）逐键定位。
- 门钉用 zh 值全文串匹配 `eval-harness/tools/verify-*.mjs`、`scripts/gates/live-frontend-gate.snippet.js`、`.issues/**/verify-*.mjs`、`eval-harness/visual/*.mjs`、`eval-harness/tests/**/*.py`，再逐条人工判断「是判据还是 `rec()` 的描述性标签」——**绝大多数中文命中是描述性标签，不是判据**，下面第 1 节只列真判据。

---

## 1. 全局约束：动文案之前必读

### 1.1 硬门钉（改文案 = 必须同一个 commit 改门）

| # | 门文件:行 | 钉住的 zh 值 | 对应键 |
|---|---|---|---|
| G1 | `eval-harness/tools/verify-locale-parity.mjs:57-64` `EXPECT.zh` | `高风险` `需确认` `可推进` | zh.ts:1169-1171 `lite2.decisionGrades.*` |
| G1 | 同上 | `按规则判为`（前缀 `startsWith`） | zh.ts:1173 `homeDecisionReasonByRule` |
| G1 | 同上 | `文档未提及` | zh.ts:1212 `homeDecisionUnknownLabel`（同值 zh.ts:928 `projectsUnknownValue`） |
| G1 | 同上 | `看的字段`（`startsWith`） | zh.ts:1210 `homeDecisionRuleBasis` |
| G1 | 同上 | `文件原文`（`startsWith`） | zh.ts:1211 `homeDecisionEvidenceLabel` |
| G1 | 同上 | `负责人`（用于剥前缀比对） | zh.ts:1155 `homeDecisionOwner` |
| G1b | `verify-locale-parity.mjs:215-216` 反向白名单 | 上述 zh 词一个都不许出现在 en 壳里（反之亦然） | — |
| G2 | `eval-harness/tools/verify-status-truth.mjs:190,209,220,256,295` | `按计划推进`（必须出现在真 on-track 卡、**不许**出现在缺状态卡） | zh.ts:920 / 426 `projectsStatusOnTrack` |
| G2 | 同上 `:193,220,256` | `状态未提及`（必须出现） | zh.ts:922 / 428 `projectsStatusUnknown` |
| G2 | 同上 `:273-274` | `文档未提及`（必须出现） | zh.ts:928 `projectsUnknownValue` |
| G3 | `eval-harness/tools/verify-file-manifest-truth.mjs:164` **全等** `statusText === '已读取'` | `已读取` | zh.ts:225 `upload.fileStatusIngested` |
| G3 | 同上 `:165-166` **全等** `=== '没能读取'` | `没能读取` | zh.ts:227 `upload.fileStatusFailed` |
| G4 | `eval-harness/tools/verify-handoffs-empty-honesty.mjs:99` | 世界 A（有信号）空态**不许**含 `平稳` | zh.ts:820 `handoffsEmpty` 只能出现在世界 B |
| G4 | 同上 `:105-107` | v02 空态**必须**含 `值得注意`（v01 必须含 `多看一眼`） | zh.ts:821 `handoffsEmptyButLook` + zh.ts:823 `handoffToneLabel` |
| G4 | 同上 `:131` | 世界 B 空态**必须**仍含 `平稳` | zh.ts:820 `handoffsEmpty` |
| G5 | `eval-harness/tools/verify-home-skeleton.mjs:116` `title.startsWith('决策：')` | `决策：` 前缀 | zh.ts:1147 `homeDecisionFollowupTitle` |
| G6 | `scripts/gates/live-frontend-gate.snippet.js:2032-2037` `BANNED_TERMS` | `.lite-home-gaps` 整块 innerText **不许**出现 `差距` / `现实差距` / `gap` / `Nexus` | 约束 zh.ts:1222-1229 + 727-743 整个差距词族的任何重写 |
| G7 | `scripts/gates/live-frontend-gate.snippet.js:473` `MOOD_VOCAB_RE` | `如常\|偏紧\|吃紧` 是**红线负向扫描词表** | zh.ts:977-979 `selfReportMood{Steady,Stretched,Strained}` —— 改词＝这道扫描静默失效（变异存活型门洞），改必须两处同改 |
| G8 | `scripts/gates/live-frontend-gate.snippet.js:1277` `receiptLeak` | `本人自述` | zh.ts:1316 `ask.selfReported`（同词族 zh.ts:987 `directoryMoodFilterCaption` 由 `.issues/rich-align-0722/verify-team-directory-04.mjs:184` 单独钉住） |
| G9 | `eval-harness/tools/verify-form-builder.mjs:100` `.includes('建一张表')` + `:110` `hasText:'建一张表'` | `建一张表` | zh.ts:571 `formsBuilderNew` |
| G9 | 同上 `:101` | `照「周报」改一张`（模板实例） | zh.ts:572 `formsBuilderCopy` |
| G9 | 同上 `:116` | `是或否` | zh.ts:589 `formsBuilderKindYesno` |
| G9 | 同上 `:122` | `只进资料库` **且** `不上任何卡` 两个片段 | zh.ts:602 `formsBuilderGoesToLibrary` |
| G9 | 同上 `:125,176` `hasText:'哪儿卡住了'` | `哪儿卡住了` | zh.ts:598 `formsBuilderSwitchSituational` |
| G9 | 同上 `:132` `hasText:'有多忙'` | `有多忙` | zh.ts:599 `formsBuilderSwitchLoad` |
| G9 | 同上 `:252` `hasText:'以后不问这一题了'` | 整句 | zh.ts:603 `formsBuilderRetire` |
| G9 | 同上 `:276` `hasText:'旧表格'` | `旧表格` | zh.ts:576 `formsBuilderDraft` |
| G10 | `eval-harness/tools/verify-forms-proactive.mjs:133` `.includes('常驻表单')` | `常驻表单` | zh.ts:525 `formsTitle` |
| G10 | 同上 `:178` `!/值得注意/` | 表单通知**不许**含 `值得注意` | zh.ts:1101 `notifForm` |
| G10 | 同上 `:247` `/过期/` | 必须含 `过期` | zh.ts:548 `formsStatusExpired` |

### 1.2 语言纯度门（约束「能不能塞英文词」）

- **`eval-harness/tools/verify-aria-zh.mjs:60` `ALLOW = /^(Avery|demo)$/` —— 硬门。** 判据：任意 `aria-label` / `title` / `alt` 里，出现 2 个及以上连续拉丁词、或单个长度 ≥4 的拉丁词，且不全在白名单内 → 红（`verify-aria-zh.mjs:104-112 suspiciousLatin`）。采样面：v02 九屏 + 详情浮层 + 真跑一次问答后的议事室 + 展开原始流（`:182-232`）。
  ⇒ **所有 aria 改写必须是纯中文（`Avery` 可以）。** `HR`（2 字母单词）、`1:1`（无字母）在这把尺子下不报，但见 §3 的产品口径。
- `.issues/feat-068-frontend-deploy/verify-zh-purity.mjs:52` `ALLOW = /^(Avery|Esc|W\d+|\d+%|v\d+|MB|KB|PDF|CSV|XLSX|DOCX|TSV|TXT|MD|OK|Word|Excel|Markdown|DPA|NDA|TLS)$/i` —— **软门**（只捞可疑串给人判；硬失败只有 `pageerror` 非空、和议事室对话流采样为空两条）。但它的收尾注释里有一条明确纪律（`verify-zh-purity.mjs:44-46`）：
  > 「只加真的没有中文写法的专名。同一批里 `App`→「产品」、`HR`→「人事」是**改文案**解决的，没有塞进这张表——放宽纯度门去迁就一句能改好的中文，是把门本身花掉。」
  ⇒ **不要往中文文案里引入 `SaaS` / `AI` / `Agent` / `Prompt` 这类词**（现存的 `demo` / `agent` / `prompt` / `SOP` 全在 vision/playbooks 段，是 Danny 07-20 拍过板的「行业黑话留着更自然」例外，别顺手翻掉、也别扩散到别处）。

### 1.3 像素基线（改中文文案必漂）

- 基线在 `eval-harness/visual/__snapshots__/`，**50 张**，`.gitignore:34` 忽略（单机产物、`git ls-files` 为 0）。
- **两个 spec 都用 `lang=zh` 采样**：`eval-harness/visual/visual.spec.mjs:29`（空态 36 张，带死掉的 `?transport=stub`）、`eval-harness/visual/visual-data.spec.mjs:72`（数据态 14 张，真上传 demo-seed）。
- 覆盖屏 × 皮 × 视口：`{paper,aurora}` × `{home, home-data, home-gaps-data-mobile, team, team-data, projects, projects-data, room, notes, followups, playbooks, files, vision}` × `{desktop, mobile}`。
  ⇒ **本审计里任何一条落在这 13 个面上的中文改动都会让对应基线红。** 纪律照旧：worktree 里重冻＝白冻，真基线只在主检出、人审后冻（`visual-data.spec.mjs:24`）。

### 1.4 宽度 / 截断（碑：显示宽度，不按 `.length`）

- 唯一在代码里真按宽度裁的地方：`src/lite2/flowStore.ts:93` `HINT_MAX_WIDTH = 72`（半角单位，CJK/全角记 2 → **36 个汉字**），裁法 `flowStore.ts:98-107`，落点 `flowStore.ts:241 composerHint`。
  - 喂给它的字符串是**数据拼装**，不是字典整句：`HomeScreen.tsx:224` `` `${handoff.action} — ${handoff.evidence}` ``、`HomeScreen.tsx:246-249` `` `${gap.projectTitle} — ${gapClaimText(...)} — ${gap.evidence}` ``。字典侧的贡献只有 `handoffAction`（zh.ts:824「{project}：今天先过一下」）与 `gapClaimText` 回落用的 `projectsStatus*`（`src/lite2/gapDerive.ts:77-79`）。
  - ⚠ 反向闸：`eval-harness/tools/verify-at-references.mjs:570-576 recNoHintInBody` 取灰提示**尾段 12 字**做判据、要求 `tail.length >= 8`。把这几条模板改到「尾段不足 8 字」会让这 7 条断言自我失效（`:627,638,659,677,693,723,745`）。
- **tab 名不许变长**：`src/lite2/LiteTopbar.tsx:121-149` 是 8 个 tab 的固定横排；`eval-harness/tools/verify-topbar-clearance.mjs` phase C（≤860px 窄屏，必须 headed 跑，见其文件头 ④）断言「顶栏单行不摞墙 + 无横向溢出 + 首内容在首屏」。「完整版预告」当初就是因为这条压力才从 tab 降进设置菜单（`LiteTopbar.tsx:143-149`）。⇒ 现有 tab 名（今天/团队/项目/问 Avery/待办清单+跟进/Avery 的笔记/操作手册/资料库）**只能等长或变短**。
- 空态卡是垂直居中的（`shared/40-nexus-empty.css:3`），让位余量是**视口高度**的函数（`verify-topbar-clearance.mjs` 文件头 ①）。⇒ **给空态 body 加行会在 1366×768 上把眉题顶进顶栏。** 本报告里所有空态改法都是等长或变短。

### 1.5 EN 侧的门（顺手记）

- `scripts/gates/live-frontend-gate.snippet.js:1553-1554` 钉的是 **EN** tab 数组 `['Today','Team','Projects','Ask Avery','To-do list',"Avery's notes",'Playbooks','Files']` + `expectedSubs`（门默认 locale = EN，`resolveLocale()` 无 `?lang=` 时取 EN）。
  ⇒ **改 zh tab 名不碰这道门；改 en tab 名必须同 commit 改这两行**（`LiteTopbar.tsx:128-130` 的红字注释说的就是它）。

---

## 2. 【必改】不通顺 / 看不懂 / 指错名字

> 判据：中文母语者第一眼读不出这是什么，或者说的名字在界面上根本不存在。

### 2.1 「之前问过的」全族（Danny 点名）

| 项 | 位置 | 现值 | 问题 | 改法 |
|---|---|---|---|---|
| 键 | zh.ts:1247 `lite2.roomHistoryTitle` | `之前问过的` | 「的」字结尾的残句，不是名词。Claude 中文用「历史记录」，飞书用「历史会话」，Notion 用「历史」。 | **`历史对话`** |
| 按钮 | `src/lite2/screens/RoomScreen.tsx:430` | 渲染成 `之前问过的 · 3` | 改后读作 `历史对话 · 3`，是标准 SaaS 计数入口 | 无需改组件 |
| 面板 aria | `src/lite2/screens/RoomScreen.tsx:433` | 同一个键 | 屏幕阅读器念「之前问过的」是半句话 | 同键，自动跟着改 |
| 注释 | `src/lite2/screens/RoomScreen.tsx:404` | 注释里写着「右上一枚「之前问过的 · N」入口」 | 改完 grep 不到，注释成假线索 | 一并改注释 |
| en | `en.ts:1737` | `Asked before` | 同病（英文也是残句） | **`History`** |

风险：**纯文案**。零门钉（room 系门全部锚在 `.lite-room-history-*` 类名与 `data-*` 上：`verify-room-conversation.mjs`、`verify-room-usability.mjs` 通篇不含这几个字）。触 `paper/aurora-room-{desktop,mobile}` 4 张基线（历史入口只在 `adviseRuns` 非空时渲染 —— 空态 spec 采不到，实际大概率零漂移，但按「必漂预判会反着骗」的碑，跑完看真值）。

### 2.2 v01 词漏进 v02（指错名字＝bug，不是措辞偏好）

| 键 | 位置 | 现值 | 问题 | 改法 |
|---|---|---|---|---|
| `lite2.formsBuilderGoesToLibrary` | zh.ts:602，渲染 `src/lite2/screens/FilesScreen.tsx`（`.lite-files-forms-builder-field .lite-files-forms-note`，见 `verify-form-builder.mjs:120`） | `这一格的答案只进资料库——搜得到、议事室引得到，但不上任何卡。` | **`议事室` 是 v01 冻结壳的 tab 名**，v02 里这个屏叫「问 Avery」（zh.ts:489）。经理在 v02 找不到任何叫「议事室」的地方。全 lite2 段仅此一处泄漏（其余 `议事室` 全在 zh.ts:306-486 的 v01 段，合法）。 | **`这一格的答案只进资料库——搜得到、问 Avery 时引得到，但不上任何卡。`** |
| `lite2.gapFollowupTitle` | zh.ts:735，渲染 `src/lite2/screens/HomeScreen.tsx:255` | `多看一眼{title}` | **`多看一眼` 是 v01 的词**；v02 全站统一为「值得注意」（ADR-0031，zh.ts:823 `handoffToneLabel`、zh.ts:891 `detailBlockers` 都是「值得注意」）。这条铸出来的待办标题会永久落进 localStorage。 | **`确认一下{title}`**（比「值得注意{title}」更像待办动作；若要严格贴词族则用 `{title}：值得注意`） |

⚠ G9 钉的是 `只进资料库` 与 `不上任何卡` 两个片段（`verify-form-builder.mjs:122`），**不含「议事室」** → 上面这条改法门不红。
⚠ G4 钉的 `多看一眼` 只作用于 `.lite-handoffs-empty` 的文本，与 `gapFollowupTitle` 无关 → 门不红。

### 2.3 内部黑话直接印在界面上

| 键 | 位置 / 渲染点 | 现值 | 问题 | 改法 |
|---|---|---|---|---|
| `upload.againTitle` | zh.ts:234 → `FilesScreen.tsx:611` | `这个口子会另起一家公司` | **「口子」是内部口语**（开发会议里的「上传口」），界面上没有任何东西叫「口子」。 | **`从这里上传会新建一家公司`** |
| `upload.againBody` | zh.ts:235 → `FilesScreen.tsx:612` | `从这里传，Avery 会当作另一家公司从头读一遍，不并进你现在看的这一份。要给现在这家补资料，用上面那个口子。两份都留着，可以在这里来回切。` | 同上，且「上面那个口子」不指名。 | **`从这里传，Avery 会当作另一家公司从头读一遍，不会并进你现在看的这一份。要给现在这家补资料，用上面的「给这家公司补资料」。两份都留着，随时可以来回切。`** |
| `lite2.filesUploadTitle` | zh.ts:510 → `FilesScreen.tsx:608-609`（`<h3>` + `aria-label`） | `另建一份画像` | **「画像」是用户画像（user profiling）行话**，这里指的其实是「另一家公司的工作区」，与紧挨着的 `againTitle`「另起一家公司」自相矛盾（同一段落两个名字）。 | **`新建一家公司`** |
| `lite2.filesAppendDemoNote` | zh.ts:516 → `FilesScreen.tsx:58` | `…要正式用起来，在下面另建一份属于你自己公司的画像。` | 同「画像」 | **`…要正式用起来，在下面新建一家属于你自己公司的。`** |
| `lite2.adviceReadTitle` | zh.ts:1248 → `LiteAdviceCard.tsx:43,49,51`（h2 + 两处 aria + section label） | `判读` | **「判读」是气象/雷达/影像专业词**，日常中文里没人用它指「分析结论」。它还被复用进 `adviceCardAria`(1242)、`adviceSummaryAria`(1250)、`adviceConfidenceWouldChange`(1258)、`streamAdviceReady`(836)。 | **`结论`** |
| `lite2.adviceCardAria` | zh.ts:1242 → `LiteAdviceCard.tsx:39` | `Avery 的分析 —— 判读` | 同上 + 同一句里两个近义词并列 | **`Avery 的分析`** |
| `lite2.adviceSummaryAria` | zh.ts:1250 → `LiteAdviceCard.tsx:50` | `摘要 —— 判读` | 同上 | **`结论摘要`** |
| `lite2.adviceConfidenceWouldChange` | zh.ts:1258 → `LiteAdviceCard.tsx:112` | `什么会让判读改变` | 同上 | **`什么情况下结论会变`** |
| `lite2.streamAdviceReady` | zh.ts:836 → 流事件文案（`src/lite2/streamSource.ts`） | `判读好了` | 同上 | **`分析完成`** |
| `lite2.roomFlowRawTitle` | zh.ts:1072 → `RoomScreen.tsx:134` | `原始流` | **raw stream 的直译，是开发者词。** | **`原始日志`** |
| `lite2.roomFlowShowRaw` | zh.ts:1073 → `RoomScreen.tsx:143` | `展开原始流` | 同上 | **`查看原始日志`** |
| `lite2.roomFlowHideRaw` | zh.ts:1074 → `RoomScreen.tsx:143` | `回到简化视图` | 「简化视图」是设计稿术语，用户不知道另一个视图叫什么 | **`收起日志`** |
| `lite2.roomPhaseAct` | zh.ts:1080 → `RoomScreen.tsx:90,164` | `生成动作` | 「动作」＝action 直译，中文里「生成动作」像机器人学 | **`给出建议`** |
| `lite2.triageDrawerLabel` | zh.ts:846 → `HomeScreen.tsx:684` | `今天已照料` | 「照料」用于照顾病人/植物，用在待办上不通 | **`今天已处理`** |
| `lite2.gapResolveLabel` / `gapResolvedBadge` | zh.ts:730,737 → `HomeScreen.tsx:822,878,928` | `厘清` / `已厘清` | 「厘清」偏书面/台式，SaaS 按钮不用 | **`已核实`** / **`已核实`** |
| `lite2.adviceEscalationHRBP` | zh.ts:1270 → `src/shared/adviceLevels.ts:66`（escalation 徽章词表） | `人力伙伴` | HRBP 的半译，中文里不成词（注释 zh.ts:122-124 承认是为了对齐徽章长度硬裁的） | **`人事`**（与同排的「法务／薪酬／高管层」同为 2-3 字） |
| `lite2.adviceHrLabel` | zh.ts:1264 → `LiteAdviceCard.tsx` | `何时拉上 HR` | `HR` 未译，与 §1.2 记下的「`HR`→「人事」是改文案解决的」纪律相违 | **`什么时候找人事`** |
| `lite2.adviceHrAria` | zh.ts:1263 | `HR / 谁来把关` | 同上 | **`人事 / 谁来把关`** |
| `lite2.adviceScriptLabel` | zh.ts:1261 | `如果你要开 1:1` | `1:1` 是外企黑话，国内经理未必懂 | **`如果你要找他单独谈`** |

风险：全部**纯文案**。唯一需留意的是 `filesUploadTitle` 同时是 `<h3>` 和 `aria-label`（`FilesScreen.tsx:608-609`）—— 纯中文，过 §1.2 的 aria 门。触基线：`files-*`（4 张）、`room-*`（4 张）、`home-data-*`（2 张）。

### 2.4 反馈假想缺失（说了等于没说）

| 键 | 位置 / 渲染点 | 现值 | 问题 | 改法 |
|---|---|---|---|---|
| `lite2.streamAdviceDone` | zh.ts:837 | `好了` | 两个字，用户不知道什么好了。这是「advise 跑完但没出判读卡」那一路的唯一收尾提示。 | **`这一轮跑完了，没有得出结论`** |
| `lite2.notifRun` | zh.ts:1096 → `LiteBell.tsx:33` | `Avery 想完了这一轮 —— 解读好了。` | 「想完了」拟人过度且语病；「解读」与卡上「判读／分析」第三个近义词 | **`分析完成 —— 结果可以看了。`** |
| `nexus.liveThinking` | zh.ts:288 → `RoomScreen.tsx:324,325`（状态条 eyebrow + aria）**以及 `RoomScreen.tsx:643`（空态 eyebrow）** | `正在仔细梳理中 — 实时` | ①「— 实时」是设计稿标签，用户读不出意思；②「仔细」是自夸；③ **同一个键被空态复用（`:643`），而空态什么都没在跑** —— 组件层 bug，不是文案能修的。 | 文案：**`正在分析`**；组件：空态那处改用 `t.lite2.tabRoom`（RoomScreen.tsx:630 的无材料态已经这么干了，并在注释里写明了理由） |
| `nexus.liveReady` | zh.ts:290 → `RoomScreen.tsx:331` | `分析好了，可以看了` | 口语拖沓 | **`分析完成`** |
| `nexus.liveRunning` | zh.ts:289 → `RoomScreen.tsx:330` | `正在思考…` | 与 `liveThinking` 撞车（同一条状态条上一个说「梳理」一个说「思考」） | **`正在分析…`** |
| `lite2.triageAllDone` | zh.ts:849 → `HomeScreen.tsx:669` | `今早那批，都按你的安排处理完了。` | 「今早那批」指代不明（用户没见过「批」这个概念） | **`今天的提醒都处理完了。`** |
| `lite2.triageRemaining` | zh.ts:840 → `HomeScreen.tsx:583` | `{pending} / {total} 还值得看一眼` | 语序倒装，读作「3/5 还值得看一眼」不通 | **`还有 {pending}/{total} 待处理`** |
| `lite2.homeGapsCount` | zh.ts:1223 → `HomeScreen.tsx:770` | `{count} 处待看` | 「待看」不是动作 | **`{count} 处待确认`** |
| `lite2.gapEmptyTitle` | zh.ts:740 → `HomeScreen.tsx:844`（差距块空态，`gapEmptyBody` 在 :845） | `现在没什么值得注意的` | 与 `handoffToneLabel`「值得注意」撞词——用户会以为「今日提醒」也空了 | **`暂时没有对不上的地方`** |
| `lite2.restoringLabel` | zh.ts:850 → `HomeScreen.tsx:298`, `ProjectsScreen.tsx:403`, `TeamScreen.tsx:376` | `正在取回你上次的会话…` | 「会话」在这里指的是**公司数据**，不是对话；用户会以为在恢复聊天记录 | **`正在载入你上次的资料…`** |
| `lite2.restoreFailed` | zh.ts:851 | `暂时连不上服务器，没能取回上次的会话。` | 同上 | **`暂时连不上服务器，没能载入上次的资料。`** |

⚠ `gapEmptyTitle` 落在 `.lite-home-gaps` 内 → 受 **G6** 约束（不许出现「差距」）。上面改法用「对不上的地方」，与 zh.ts:1222 `homeGapsTitle` 同词，安全。

---

## 3. 【建议改】自嗨但能懂

### 3.1 「事实——／推断——／建议——」三元组（判读卡最大一块自嗨）

`src/lite2/LiteAdviceCard.tsx:57,68,90,102,134` 五处 section label 全部走「认识论前缀 + 破折号 + 解释」的句式。这是设计稿的概念结构，不是用户需要读的东西——每张卡都要读五遍。

| 键 | 行 | 现值 | 改法 |
|---|---|---|---|
| `adviceSignalsLabel` | zh.ts:1251 | `事实——它捕捉到的信号` | **`读到的信号`** |
| `adviceHypothesesLabel` | zh.ts:1252 | `推断——可能在发生什么，不是定论` | **`可能的原因（推测，不是结论）`** |
| `adviceEvidenceLabel` | zh.ts:1256 | `事实——这条意见所依据的原文行` | **`依据的原文`** |
| `adviceConfidenceLabel` | zh.ts:1257 | `置信度——它有多确定` | **`可信度`** |
| `adviceActionsLabel` | zh.ts:1260 | `建议——推荐的下一步动作` | **`建议的下一步`** |
| `adviceWatchLabel` | zh.ts:1262 | `看什么来判断奏效了` | **`怎么判断有没有效果`** |
| `adviceSignOff` | zh.ts:1249 | `由你拍板` | **`最终由你决定`** |

⚠ 这七个键**每一个都同时是 `aria-label` 和可见 label**（`LiteAdviceCard.tsx:56-57`、`67-68`、`89-90`、`100-102`、`133-134`）—— 改后仍是纯中文，过 aria 门。
⚠ `lite` 段 zh.ts:444-455 有同名键的 v01 副本，**不要一起改**（冻结壳）。
⚠ en 同病：`en.ts:1744-1755` 一模一样的 `Fact — / Inference — / Suggestion —` 结构。本轮主战场是中文，但记一笔。

### 3.2 议事室推理面板（`RoomScreen.tsx:86-215`）

| 键 | 行 | 现值 | 改法 | 备注 |
|---|---|---|---|---|
| `roomFlowTitle` | zh.ts:1071 | `分析过程` | 保留 | 已经是大白话 |
| `roomPhaseRead` | zh.ts:1077 | `读取事实` | **`读取资料`** | 与 ADR-0032 的「资料」词族对齐 |
| `roomPhaseCrosscheck` | zh.ts:1078 | `交叉验证` | **`核对信息`** | 「交叉验证」是统计/ML 术语（cross-validation），此处含义不同 |
| `roomPhaseMethod` | zh.ts:1079 | `匹配方法` | **`选定处理方式`** | |
| `roomPhasePending` | zh.ts:1081 | `还没走到这一步` | **`未开始`** | 与「已完成/进行中」同族短词，且更短（帮窄屏） |
| `roomFlowSteps` | zh.ts:1082 | `走了 {count} 步` | **`{count} 步`** | |
| `roomFlowSources` | zh.ts:1083 | `读了 {count} 份原始材料` | **`读了 {count} 份资料`** | 「原始材料」是三个词族里的第四种叫法 |
| `roomFlowRecall` | zh.ts:1084 | `从你的文件里翻出 {count} 条记录` | **`从资料里找到 {count} 条相关内容`** | 「翻出」口语过头 |
| `roomFlowReady` | zh.ts:1085 | `结论已经出来了` | **`已给出结论`** | |
| `roomFlowCites` | zh.ts:1086 | `依据 {count} 条原文` | **`引用了 {count} 处原文`** | 这是个可点按钮（`RoomScreen.tsx:174-182`），动词开头更像按钮 |
| `roomFlowCitesLabel` | zh.ts:1087 | `它引用的原文` | **`引用的原文`** | 「它」在整份词典里指代不一（有时 Avery 有时这条建议） |
| `roomFlowUnresolved` | zh.ts:1088 | `没对上真实的原文行` | **`没找到对应原文`** | 「原文行」是数据模型词（line ref） |
| `roomFlowFailed` | zh.ts:1089 | `这一趟中途断了，没走完。展开原始流可以看到断在哪一步。` | **`这次分析中断了。查看原始日志可以看到停在哪一步。`** | 「这一趟」；且必须跟 §2.3 的「原始日志」同步 |
| `roomChipsLabel` | zh.ts:1066 | `几个常见的开场` | **`试试这样问`** | 「开场」是话术培训词 |
| `roomTurnQuestionLabel` | zh.ts:1245 | `你问的` | **`你的提问`** | 残句 → 名词短语 |
| `roomFollowupsLabel` | zh.ts:1246 | `接着可以问` | **`继续追问`** | |
| `roomEmptyTitle` | zh.ts:859 | `把眼前的事拿来问 Avery` | **`把眼下的问题交给 Avery`** | 「眼前的事拿来」语序别扭 |
| `roomNoMaterialTitle` | zh.ts:861 | `眼下还没有可推理的依据` | **`还没有可参考的资料`** | 「可推理的依据」是 agent 内部词 |
| `roomNoMaterialCta` | zh.ts:863 | `去添加材料` | **`去上传资料`** | 第四种叫法（材料/资料/文件/文档），统一为「资料」 |
| `roomBoardAria` | zh.ts:1277 | `问 Avery —— 输出区` | **`问 Avery —— 回答区`** | 「输出区」是开发词 |
| `roomEmptyAria` | zh.ts:1280 | `还在梳理中 —— 向你的团队提问` | **`向 Avery 提问`** | 空态并没有在梳理（同 §2.4 `liveThinking` 那条同根） |
| `roomAskAria` | zh.ts:1278 | `向你的团队提问` | **`向 Avery 提问`** | v02 的 tab 是「问 Avery」，「向你的团队提问」是 v01 遗留 |
| `nexus.askPlaceholder` | zh.ts:292 → `RoomScreen.tsx:616,650` | `向你的团队提问…` | **`向 Avery 提问…`** | 同上；⚠ 这是共享段，`lite`(v01) 也用它（`src/lite/LiteComposer.tsx:109`）—— 改动会波及冻结壳，若要严守「不动 v01」则需在 lite2 新建键（组件改动） |

### 3.3 资料库屏（`FilesScreen.tsx`）

| 键 | 行 | 现值 | 改法 | 备注 |
|---|---|---|---|---|
| `filesEyebrow` + `filesHeading` | zh.ts:504,505 | 两个都是 `资料库` | eyebrow 保留 `资料库`；**`filesHeading` → `你传给 Avery 的资料`** | `FilesScreen.tsx:564-565` 把两者上下堆叠渲染，屏幕上「资料库／资料库」连着出现两遍。其余屏的模式是「短分类 eyebrow + 一句话 h2」（`HomeScreen.tsx:405-406`、`ProjectsScreen.tsx:310`、`NotesScreen.tsx:153-154`），Files 是唯一破例的 |
| `filesSub` | zh.ts:506 | `你传给 Avery 的材料都在这里，也能看到现在读的是哪一批。文件存在服务器上，这一页是你回头看它们的地方。` | **`你传给 Avery 的资料都在这里。也能看到它现在读的是哪一批。`** | 「材料」→「资料」统一；第二句是自我说明，删掉 |
| `filesCurrentTitle` | zh.ts:507 | `当前资料` | 保留 | 已是大白话（en 侧 `en.ts:579` 是 `What Avery is reading now`，两边语义不同，记一笔） |
| `filesCurrentEmptyRead` | zh.ts:509 | `这一批里 Avery 没列出任何文件。如果刚传完，等一会儿再刷新；要是一直是空的，多半是这些文件没读出内容，重新传一次是最快的解法。` | **`Avery 没有列出这一批里的任何文件。刚传完的话稍等一下再刷新；如果一直是空的，多半是这些文件没读出内容，重新传一次最快。`** | 「解法」→口语化 |
| `upload.switchTitle` | zh.ts:242 → `KnownContextList.tsx:67` / `FilesScreen.tsx:36-37` | `这台电脑上传过的` | **`这台电脑上传过的公司`** | 残句（缺宾语）；⚠ `FilesScreen.tsx:617` 的注释写的是「你上传过的几批」，与实际文案对不上，一并修注释 |
| `upload.switchFilesLabel` | zh.ts:246 → `KnownContextList.tsx:93` | `读自` | **`来自`** | 「读自」不成词 |
| `upload.filesChunks` | zh.ts:222 → `FileManifest.tsx:164` | `处引用` | **`处可引用片段`** | 渲染成「1.2 MB · 37 处引用」，"处引用" 读不出是什么 |
| `upload.appendAddedLead` | zh.ts:240 | `这次加进来的` | **`这次新增的`** | |
| `lite2.homeFilesManageLink` | zh.ts:651 | `去资料库管理` | **`管理资料`** | 「去X管理」是动宾错位 |

### 3.4 首页 / 分诊 / 差距（`HomeScreen.tsx`）

| 键 | 行 | 现值 | 改法 | 备注 |
|---|---|---|---|---|
| `homeTitle` | zh.ts:1133 | `今天有几件事等你定` | **`今天有几件事需要你确认`** | 「等你定」偏口语 |
| `handoffsTitle` | zh.ts:819 → `HomeScreen.tsx:578,580` | `今日提醒` | 保留 | 已是标准 SaaS 词 |
| `triageDiscardLabel` | zh.ts:842 | `今天先放放` | **`今天先跳过`** | |
| `triageSetAsideLabel` | zh.ts:847 | `已搁置` | 保留 | |
| `homeDecisionsOrderNote` | zh.ts:1150 | `按定级规则排序，最要紧的在最前。` | **`按重要程度排序，最要紧的在最前。`** | 「定级」是后端词（`decision_grading.py`），界面上没有任何地方叫「定级」 |
| `homeDecisionsAbsentTitle` | zh.ts:1151 | `这份数据里没带决策定级` | **`这份资料还没有分级结果`** | 同上 |
| `homeDecisionsAbsentBody` | zh.ts:1152 | 「…定级功能上线之前…后端还没上定级这个能力…得等后端跟上。」 | **`两种可能，这份资料本身分不出是哪一种。一种是它在分级功能上线之前就读进来了，重新上传一次就会有；另一种是当前服务还不支持分级，那么重传多少次都不会有，只能等我们跟上。`** | **「后端」是开发词，直接印给了客户**（出现两次） |
| `homeDecisionReasonAvery` | zh.ts:1157 | `Avery 自己的判断` | **`Avery 的判断`** | 「自己的」多余且略带推诿 |
| `homeDecisionEscalated` | zh.ts:1202 | `Avery 把等级往上调了` | **`Avery 调高了这条的等级`** | |
| `homeConflictDismiss` | zh.ts:1206 | `可能只是叫法不同` | 保留 | 措辞红线在案（zh.ts:1203-1205），别动 |
| `homeDecisionRulesToggle` | zh.ts:1209 | `判断依据` | 保留 | |
| `homeOverviewTitle` | zh.ts:1236 | `资料概览` | 保留 | |
| `homeAttentionTitle` | zh.ts:1230 | `文件里反复提到的人` | **`资料里反复提到的人`** | 「文件/资料」词族统一（同屏 `homeOverviewTitle` 已经说「资料」） |
| `homeAttentionEmpty` | zh.ts:1234 | `现在文件没有特别指向某个人。` | **`目前资料里没有特别集中提到某个人。`** | 「文件指向某个人」拟人 |
| `homeTodayEmpty` | zh.ts:1143 | `今天还没有排队的事项。决策、问 Avery、「资料对不上的地方」冒出来的待办，都会落到这里。` | **`今天还没有待办。从决策、问 Avery、「资料对不上的地方」加进来的事都会出现在这里。`** | 「排队的事项」「冒出来」「落到」三处口语 |
| `gapCardEvidenceLabel` | zh.ts:728 | `实际信号` | **`资料里的实际情况`** | 与左栏 `gapCardClaimLabel`「文件里的说法」对仗；「信号」是内部词 |
| `gapHistoryToggleLabel` | zh.ts:736 | `已查看过` | **`已处理的`** | 抽屉里装的是「已核实/已搁置」，不是「看过的」 |
| `gapRealtimeTitle` | zh.ts:742 | `这个页面会变成什么` | **`接上你们的系统之后`** | 疑问句标题在 SaaS 里少见；`gapRealtimeBody`(743) 本来就在讲这个 |

⚠ 上面落在 `.lite-home-gaps` 内的（`gapCardEvidenceLabel` / `gapHistoryToggleLabel` / `gapRealtimeTitle` / `gapEmptyTitle`）**全部受 G6 约束**：不许出现「差距」二字。以上改法均已避开。

### 3.5 跟进 / 待办 / 通知

| 键 | 行 | 现值 | 改法 |
|---|---|---|---|
| `followupsTitle` | zh.ts:696 | `所有要跟进的事，收在一处` | **`所有要跟进的事都在这里`** |
| `followupsEmptyActive` | zh.ts:702 | `跟进列表还是空的——在下面加一条，或者把今早清单、问 Avery、快问里的事挪过来。` | **`还没有待跟进的事。可以在下面直接加一条，或者从今日提醒、问 Avery、快问里加过来。`**（「今早清单」这个名字界面上不存在——那块叫「今日提醒」zh.ts:819） |
| `followupsSourceTriage` | zh.ts:704 | `来自今早` | **`来自今日提醒`** |
| `followupsSourceCloserLook` | zh.ts:708 | `来自一处资料对不上` | **`来自「资料对不上的地方」`** |
| `followupsRestore` / `gapRestoreLabel` / `triageRestoreLabel` | zh.ts:715,739,848 | `放回来` | **`恢复`**（`projectsArchivedRestore` zh.ts:956 与 `homeConflictRestore` zh.ts:1208 已经用「恢复」了——同一动作四个键三种说法） |
| `draftDoneAdd` | zh.ts:1118 | `完成 · 加进跟进` | **`完成并加入待办`** |
| `draftDoneComplete` | zh.ts:1119 | `完成 · 这条已办` | **`完成并标记已办`** |
| `draftAddedStatus` | zh.ts:1120 | `已写进你的跟进队列。` | **`已加入待办清单。`**（「队列」是开发词；tab 名是「待办清单」zh.ts:492） |
| `draftCompletedStatus` | zh.ts:1121 | `已在跟进队列里标记为办完。` | **`已在待办清单里标记为完成。`** |
| `draftGoFollowups` | zh.ts:1122 | `去跟进队列` | **`去待办清单`** |
| `draftCopy` | zh.ts:1113 | `复制到聊天应用` | **`复制`**（按钮旁边 `draftCopiedStatus`(1115) 已经解释了去哪儿粘贴） |
| `draftEyebrow` | zh.ts:1104 | `由你来发` | 保留（红线措辞，Avery 不代发） |
| `bellEmpty` | zh.ts:1092 | `还没有。文件读完了，或 Avery 想完了一轮，都会落到这里。` | **`暂无消息。资料读完、或者 Avery 分析完一轮，都会通知你。`**（「想完了一轮」同 §2.4 `notifRun`） |
| `notifGap` | zh.ts:1098 | `文件里有一处值得注意。` | **`资料里有一处对不上。`**（现文案与「今日提醒」的「值得注意」撞词，点进去却跳到差距块） |

⚠ `notifForm`(1101) 受 **G10** 约束：不许含「值得注意」。上面只动 `notifGap`，安全。

### 3.6 上手引导（`OnboardGate.tsx`）

| 键 | 行 | 现值 | 改法 |
|---|---|---|---|
| `onboardBrowse` | zh.ts:1000 → `OnboardGate.tsx:168` | `先随便看看` | **`先自己逛逛`**（⚠ `verify-onboard-gate.mjs:83` 的描述性标签写的就是「先自己逛逛」——门读的是元素计数不是文本，但说明这曾是拟定文案，改成它反而恢复一致） |
| `onboardDoorsTitle` | zh.ts:1001 | `想从哪里开始？` | 保留 |
| `onboardDoorDemoBusy` | zh.ts:1006 | `正在为你准备示例副本…` | **`正在准备示例团队…`**（「副本」是数据库词） |
| `onboardTeamBody` | zh.ts:1022 | `这里的字段用于产品里的招呼语，仅保存在本浏览器——只有最后那一格例外：它会交给 Avery，让它的判读从你们公司的现实出发。` | **`这几项只用来在界面上称呼你，只存在这台浏览器里。只有最后一栏例外：它会交给 Avery，让分析贴着你们公司的实际情况。`**（「字段」开发词、「判读」见 §2.3、「从…现实出发」自嗨） |
| `onboardUploadIdle` | zh.ts:1018 | `还没上传文件 —— 这一步可以跳过。` | 保留 |
| `homeDemoNote` | zh.ts:1039 → `HomeScreen.tsx:360` | `真实的匿名材料，已经读过一遍——这是你自己的私有副本，点一下就有。` | **`一份已脱敏的真实资料，Avery 已经读完。点一下就能用，是你自己的一份。`** |
| `onboardDoneNoPicks` | zh.ts:1046 | `没有挑打法 —— 「操作手册」标签页保持通用预览。` | **`没有选打法——「操作手册」页会保持通用预览。`** |

### 3.7 团队 / 项目 / 笔记 / 表单

| 键 | 行 | 现值 | 改法 |
|---|---|---|---|
| `teamEmptyTitle` | zh.ts:647 | `还没有可读的材料` | **`还没有可读的资料`** |
| `teamEmptyBody` | zh.ts:648 | `…这说的是 Avery 手上有什么，不是你们公司有什么。` | 保留（absent≠none 红线，注释在案 zh.ts:642-643） |
| `projectsLede` | zh.ts:901 | `这一屏只由你上传的文件长出来。…` | **`这一页的内容全部来自你上传的资料。文档里没写的状态、日期和数字，这里会明确标成「文档未提及」——不是 0，也不是空白。`**（「这一屏…长出来」是本仓的招牌自嗨句式，全库出现 6 次） |
| `projectsCoverageNote` | zh.ts:908 | `这些地方 Avery 宁可留着「未提及」，也不替你的文件填一个 0。` | 保留（红线措辞） |
| `notesEyebrow` | zh.ts:744 | `观察记录` | 保留 |
| `notesLede` | zh.ts:746 | `…你们合作得越久，这本笔记就越厚。` | **`每次你问 Avery 一个真实的问题，它都会把观察到的记下来，供你回看。用得越久，这里的内容越多。`**（「这本笔记就越厚」是自嗨结尾） |
| `notesNudge` | zh.ts:757 | `Avery 记了一条笔记` | **`Avery 新记了一条`** |
| `formsFieldsLead` | zh.ts:530 | `问这几格：` | **`会问这几题：`**（「格」是表格实现词；同段其余文案都说「题」） |
| `formsPickLabel` | zh.ts:531 | `这次发给谁` | 保留 |
| `formsBuilderKind` | zh.ts:585 | `怎么答` | **`答题方式`** |
| `formsBuilderHelp` | zh.ts:597 | `题目下面的一行说明` | **`题目说明（可选）`** |
| `formsBuilderErrorUnavailable` | zh.ts:617 | `建表要连上你的工作区才能做。` | **`要先连上你的工作区才能建表。`** |
| `lookSwitchPaper` / `lookSwitchAurora` | zh.ts:657,658 | `暖纸` / `极光` | 见 §4（见仁见智） |

### 3.8 快问段（`ask.*`，`AskCard.tsx`）

| 键 | 行 | 现值 | 改法 |
|---|---|---|---|
| `ask.draftTitle` | zh.ts:1291 | `值得直接问问他们` | **`直接问问本人`** |
| `ask.draftLede` | zh.ts:1292 | `缺的那一块不在文件里，而在他们自己怎么看这件事。…` | **`资料里缺的那一块，在他们自己怎么看这件事。看一下这些问题，然后把各自的链接发给本人。`** |
| `ask.refresh` / `refreshing` | zh.ts:1313,1314 | `查一下新回复` / `正在查看…` | **`查看新回复`** / **`正在刷新…`** |
| `ask.receiptsTitle` | zh.ts:1315 | `他们怎么说` | **`大家的回答`** |
| `ask.summaryTitle` | zh.ts:1321 | `放在一起看` | **`汇总`** |
| `ask.sharedTitle` | zh.ts:1307 | `链接备好了——你来发` | **`链接已生成——由你转发`** |
| `ask.maxQuestionsHint` | zh.ts:1301 | `最多三道题——十秒内答完。` | 保留 |

---

## 4. 【见仁见智】

| 键 | 行 | 现值 | 讨论 |
|---|---|---|---|
| `lite2.tabRoom` | zh.ts:489 | `问 Avery` | Danny 07-29 亲自审字定的（ADR-0031）。SaaS 大白话候选是「对话」/「助手」，但品牌入口有价值。**不建议动**，动了会连带 8 处引用（`followupsSourceRoom`(705)、`triageTakeToRoomLabel`(843)、`notesEmptyCta`(756)、`homeDecisionAskRoom`(1215)、`gapAskLabel`(732)…）与 EN tab 门（G / §1.5）。 |
| `lookSwitchPaper` / `lookSwitchAurora` | zh.ts:657,658 | `暖纸` / `极光` | 皮肤名，「自嗨」但是有意的品牌语汇。Notion 会叫「浅色/深色」。若要务实：`浅色` / `深色`（两皮实际就是这个差别）。改动会波及 `verify-switchers.mjs`（读的是 `look` URL 参数与 class，不是文本 → 门不红）。 |
| `lite2.notesEyebrow` / `notesTitle` | zh.ts:744,745 | `观察记录` / `Avery 记下的、关于你公司的观察` | 标题里的顿号断句是文学腔。务实版：`Avery 关于你公司的观察记录`。低优先。 |
| `ask.eyebrow` 等「快问」词族 | zh.ts:1290 等 6 处 | `快问` | 自造名词，但短、好记、已在通知/跟进/流事件里成体系（`notifAsk`(1097)、`followupsSourceAsk`(706)、`streamAskDrafted`(835)）。改要整族改。倾向**保留**。 |
| `lite2.visionSummaryLabel` | zh.ts:788 | `速读版` | 「速读版」略文艺，Notion 会写「摘要」。低优先。 |
| `lite2.playbooksTitle` | zh.ts:759 | `操作手册从团队已有的工作方式中生长出来` | 「长出来 / 生长出来」是本仓招牌隐喻，**lite2 段 6 处**：zh.ts:508、648、759、769、779、901（另 v01/共享段 3 处：284、321、334）。整族替换成「整理出来 / 来自」会更 SaaS，但这是产品叙事的一部分，需 Danny 拍。 |
| `lite2.footerText` | zh.ts:1102 | 合规长句 | 法务性质，**不建议为语感改动**。 |
| `lite2.homeSkeleton*` | zh.ts:1135-1140 | 五条空态说明 | 写得偏长（每条 30-45 字），但都在讲「这块将来会显示什么」，删了就是白屏。⚠ 改长会顶高空态卡 → §1.4 的视口高度风险。**只建议缩不建议改结构**。 |

---

## 5. 一次性批改清单（键 → 新值）

> 直接照抄。所有值均为纯中文（`Avery` 除外），过 §1.2 的 aria 拉丁门。
> 组名前缀：`upload.` / `nexus.` / `lite2.` / `ask.`。**未列出的键一律不动**；`lite.*`（zh.ts:306-486）整段不动。

### 5.1 必改（A 级）

| 键 | 行 | 新值 |
|---|---|---|
| `lite2.roomHistoryTitle` | 1247 | `历史对话` |
| `lite2.formsBuilderGoesToLibrary` | 602 | `这一格的答案只进资料库——搜得到、问 Avery 时引得到，但不上任何卡。` |
| `lite2.gapFollowupTitle` | 735 | `确认一下{title}` |
| `upload.againTitle` | 234 | `从这里上传会新建一家公司` |
| `upload.againBody` | 235 | `从这里传，Avery 会当作另一家公司从头读一遍，不会并进你现在看的这一份。要给现在这家补资料，用上面的「给这家公司补资料」。两份都留着，随时可以来回切。` |
| `lite2.filesUploadTitle` | 510 | `新建一家公司` |
| `lite2.filesAppendDemoNote` | 516 | `示例团队是一份随时会被清理掉的副本，往里补的资料留不住。要正式用起来，在下面新建一家属于你自己公司的。` |
| `lite2.adviceReadTitle` | 1248 | `结论` |
| `lite2.adviceCardAria` | 1242 | `Avery 的分析` |
| `lite2.adviceSummaryAria` | 1250 | `结论摘要` |
| `lite2.adviceConfidenceWouldChange` | 1258 | `什么情况下结论会变` |
| `lite2.streamAdviceReady` | 836 | `分析完成` |
| `lite2.streamAdviceDone` | 837 | `这一轮跑完了，没有得出结论` |
| `lite2.roomFlowRawTitle` | 1072 | `原始日志` |
| `lite2.roomFlowShowRaw` | 1073 | `查看原始日志` |
| `lite2.roomFlowHideRaw` | 1074 | `收起日志` |
| `lite2.roomPhaseAct` | 1080 | `给出建议` |
| `lite2.triageDrawerLabel` | 846 | `今天已处理` |
| `lite2.gapResolveLabel` | 730 | `已核实` |
| `lite2.gapResolvedBadge` | 737 | `已核实` |
| `lite2.adviceEscalationHRBP` | 1270 | `人事` |
| `lite2.adviceHrLabel` | 1264 | `什么时候找人事` |
| `lite2.adviceHrAria` | 1263 | `人事 / 谁来把关` |
| `lite2.adviceScriptLabel` | 1261 | `如果你要找他单独谈` |
| `lite2.notifRun` | 1096 | `分析完成 —— 结果可以看了。` |
| `nexus.liveThinking` | 288 | `正在分析` |
| `nexus.liveRunning` | 289 | `正在分析…` |
| `nexus.liveReady` | 290 | `分析完成` |
| `lite2.triageAllDone` | 849 | `今天的提醒都处理完了。` |
| `lite2.triageRemaining` | 840 | `还有 {pending}/{total} 待处理` |
| `lite2.homeGapsCount` | 1223 | `{count} 处待确认` |
| `lite2.gapEmptyTitle` | 740 | `暂时没有对不上的地方` |
| `lite2.restoringLabel` | 850 | `正在载入你上次的资料…` |
| `lite2.restoreFailed` | 851 | `暂时连不上服务器，没能载入上次的资料。` |

### 5.2 建议改（B 级）

| 键 | 行 | 新值 |
|---|---|---|
| `lite2.adviceSignalsLabel` | 1251 | `读到的信号` |
| `lite2.adviceHypothesesLabel` | 1252 | `可能的原因（推测，不是结论）` |
| `lite2.adviceEvidenceLabel` | 1256 | `依据的原文` |
| `lite2.adviceConfidenceLabel` | 1257 | `可信度` |
| `lite2.adviceActionsLabel` | 1260 | `建议的下一步` |
| `lite2.adviceWatchLabel` | 1262 | `怎么判断有没有效果` |
| `lite2.adviceSignOff` | 1249 | `最终由你决定` |
| `lite2.roomPhaseRead` | 1077 | `读取资料` |
| `lite2.roomPhaseCrosscheck` | 1078 | `核对信息` |
| `lite2.roomPhaseMethod` | 1079 | `选定处理方式` |
| `lite2.roomPhasePending` | 1081 | `未开始` |
| `lite2.roomFlowSteps` | 1082 | `{count} 步` |
| `lite2.roomFlowSources` | 1083 | `读了 {count} 份资料` |
| `lite2.roomFlowRecall` | 1084 | `从资料里找到 {count} 条相关内容` |
| `lite2.roomFlowReady` | 1085 | `已给出结论` |
| `lite2.roomFlowCites` | 1086 | `引用了 {count} 处原文` |
| `lite2.roomFlowCitesLabel` | 1087 | `引用的原文` |
| `lite2.roomFlowUnresolved` | 1088 | `没找到对应原文` |
| `lite2.roomFlowFailed` | 1089 | `这次分析中断了。查看原始日志可以看到停在哪一步。` |
| `lite2.roomChipsLabel` | 1066 | `试试这样问` |
| `lite2.roomTurnQuestionLabel` | 1245 | `你的提问` |
| `lite2.roomFollowupsLabel` | 1246 | `继续追问` |
| `lite2.roomEmptyTitle` | 859 | `把眼下的问题交给 Avery` |
| `lite2.roomNoMaterialTitle` | 861 | `还没有可参考的资料` |
| `lite2.roomNoMaterialCta` | 863 | `去上传资料` |
| `lite2.roomBoardAria` | 1277 | `问 Avery —— 回答区` |
| `lite2.roomEmptyAria` | 1280 | `向 Avery 提问` |
| `lite2.roomAskAria` | 1278 | `向 Avery 提问` |
| `nexus.askPlaceholder` | 292 | `向 Avery 提问…`（⚠ 共享键，波及 v01，见 §6.3） |
| `lite2.filesHeading` | 505 | `你传给 Avery 的资料` |
| `lite2.filesSub` | 506 | `你传给 Avery 的资料都在这里。也能看到它现在读的是哪一批。` |
| `lite2.filesCurrentEmptyRead` | 509 | `Avery 没有列出这一批里的任何文件。刚传完的话稍等一下再刷新；如果一直是空的，多半是这些文件没读出内容，重新传一次最快。` |
| `upload.switchTitle` | 242 | `这台电脑上传过的公司` |
| `upload.switchFilesLabel` | 246 | `来自` |
| `upload.filesChunks` | 222 | `处可引用片段` |
| `upload.appendAddedLead` | 240 | `这次新增的` |
| `lite2.homeFilesManageLink` | 651 | `管理资料` |
| `lite2.homeTitle` | 1133 | `今天有几件事需要你确认` |
| `lite2.triageDiscardLabel` | 842 | `今天先跳过` |
| `lite2.homeDecisionsOrderNote` | 1150 | `按重要程度排序，最要紧的在最前。` |
| `lite2.homeDecisionsAbsentTitle` | 1151 | `这份资料还没有分级结果` |
| `lite2.homeDecisionsAbsentBody` | 1152 | `两种可能，这份资料本身分不出是哪一种。一种是它在分级功能上线之前就读进来了，重新上传一次就会有；另一种是当前服务还不支持分级，那么重传多少次都不会有，只能等我们跟上。` |
| `lite2.homeDecisionReasonAvery` | 1157 | `Avery 的判断` |
| `lite2.homeDecisionEscalated` | 1202 | `Avery 调高了这条的等级` |
| `lite2.homeAttentionTitle` | 1230 | `资料里反复提到的人` |
| `lite2.homeAttentionEmpty` | 1234 | `目前资料里没有特别集中提到某个人。` |
| `lite2.homeTodayEmpty` | 1143 | `今天还没有待办。从决策、问 Avery、「资料对不上的地方」加进来的事都会出现在这里。` |
| `lite2.gapCardEvidenceLabel` | 728 | `资料里的实际情况` |
| `lite2.gapHistoryToggleLabel` | 736 | `已处理的` |
| `lite2.gapRealtimeTitle` | 742 | `接上你们的系统之后` |
| `lite2.followupsTitle` | 696 | `所有要跟进的事都在这里` |
| `lite2.followupsEmptyActive` | 702 | `还没有待跟进的事。可以在下面直接加一条，或者从今日提醒、问 Avery、快问里加过来。` |
| `lite2.followupsSourceTriage` | 704 | `来自今日提醒` |
| `lite2.followupsSourceCloserLook` | 708 | `来自「资料对不上的地方」` |
| `lite2.followupsRestore` | 715 | `恢复` |
| `lite2.gapRestoreLabel` | 739 | `恢复` |
| `lite2.triageRestoreLabel` | 848 | `恢复` |
| `lite2.draftDoneAdd` | 1118 | `完成并加入待办` |
| `lite2.draftDoneComplete` | 1119 | `完成并标记已办` |
| `lite2.draftAddedStatus` | 1120 | `已加入待办清单。` |
| `lite2.draftCompletedStatus` | 1121 | `已在待办清单里标记为完成。` |
| `lite2.draftGoFollowups` | 1122 | `去待办清单` |
| `lite2.draftCopy` | 1113 | `复制` |
| `lite2.bellEmpty` | 1092 | `暂无消息。资料读完、或者 Avery 分析完一轮，都会通知你。` |
| `lite2.notifGap` | 1098 | `资料里有一处对不上。` |
| `lite2.onboardBrowse` | 1000 | `先自己逛逛` |
| `lite2.onboardDoorDemoBusy` | 1006 | `正在准备示例团队…` |
| `lite2.onboardTeamBody` | 1022 | `这几项只用来在界面上称呼你，只存在这台浏览器里。只有最后一栏例外：它会交给 Avery，让分析贴着你们公司的实际情况。` |
| `lite2.homeDemoNote` | 1039 | `一份已脱敏的真实资料，Avery 已经读完。点一下就能用，是你自己的一份。` |
| `lite2.onboardDoneNoPicks` | 1046 | `没有选打法——「操作手册」页会保持通用预览。` |
| `lite2.teamEmptyTitle` | 647 | `还没有可读的资料` |
| `lite2.projectsLede` | 901 | `这一页的内容全部来自你上传的资料。文档里没写的状态、日期和数字，这里会明确标成「文档未提及」——不是 0，也不是空白。` |
| `lite2.notesLede` | 746 | `每次你问 Avery 一个真实的问题，它都会把观察到的记下来，供你回看。用得越久，这里的内容越多。` |
| `lite2.notesNudge` | 757 | `Avery 新记了一条` |
| `lite2.formsFieldsLead` | 530 | `会问这几题：` |
| `lite2.formsBuilderKind` | 585 | `答题方式` |
| `lite2.formsBuilderHelp` | 597 | `题目说明（可选）` |
| `lite2.formsBuilderErrorUnavailable` | 617 | `要先连上你的工作区才能建表。` |
| `ask.draftTitle` | 1291 | `直接问问本人` |
| `ask.draftLede` | 1292 | `资料里缺的那一块，在他们自己怎么看这件事。看一下这些问题，然后把各自的链接发给本人。` |
| `ask.refresh` | 1313 | `查看新回复` |
| `ask.refreshing` | 1314 | `正在刷新…` |
| `ask.receiptsTitle` | 1315 | `大家的回答` |
| `ask.summaryTitle` | 1321 | `汇总` |
| `ask.sharedTitle` | 1307 | `链接已生成——由你转发` |

---

## 6. 附录

### 6.1 不许动（红线 / 门钉）——完整清单

| 键 | 行 | 理由 |
|---|---|---|
| `lite2.decisionGrades.{high_risk,needs_confirmation,can_proceed}` | 1169-1171 | G1 |
| `lite2.homeDecisionReasonByRule`（前缀「按规则判为」） | 1173 | G1 |
| `lite2.homeDecisionUnknownLabel` / `projectsUnknownValue` | 1212 / 928 | G1 + G2 |
| `lite2.homeDecisionRuleBasis` | 1210 | G1 |
| `lite2.homeDecisionEvidenceLabel` | 1211 | G1 |
| `lite2.homeDecisionOwner` / `projectsOwnerLabel` / `gapOwnerPrefix` / `detailOwner` | 1155 / 923 / 729 / 896 | G1（`负责人`） |
| `lite2.projectsStatusOnTrack` / `projectsStatusUnknown` | 920 / 922 | G2 |
| `upload.fileStatusIngested` / `fileStatusFailed` | 225 / 227 | G3（**全等**比对） |
| `lite2.handoffsEmpty`（必须含「平稳」） | 820 | G4 |
| `lite2.handoffsEmptyButLook` + `handoffToneLabel`（必须含「值得注意」） | 821 / 823 | G4 |
| `lite2.homeDecisionFollowupTitle`（前缀「决策：」） | 1147 | G5 |
| `lite2.selfReportMood{Steady,Stretched,Strained}` | 977-979 | G7（红线负向词表，改词＝门静默失效） |
| `ask.selfReported` / `lite2.directoryMoodFilterCaption` | 1316 / 987 | G8 |
| `lite2.formsBuilderNew` / `formsBuilderCopy` / `formsBuilderKindYesno` / `formsBuilderSwitchSituational` / `formsBuilderSwitchLoad` / `formsBuilderRetire` / `formsBuilderDraft` | 571,572,589,598,599,603,576 | G9 |
| `lite2.formsBuilderGoesToLibrary` 的「只进资料库」「不上任何卡」两片段 | 602 | G9（其余文字可改，见 §2.2） |
| `lite2.formsTitle` / `formsStatusExpired` / `notifForm`（不许含「值得注意」） | 525 / 548 / 1101 | G10 |
| `lite2.homeConflictDismiss` / `homeConflictDismissedNote` | 1206 / 1207 | ADR-0018 措辞红线（注释在案 1203-1205） |
| `lite2.footerText` | 1102 | 合规文案 |
| `lite2.visionProofRedline` / `visionMockGateBody` / `notesRedlineNote` / `emptyHintPrivacy` / `upload.privacyNote` | 787,805,747,856,219 | 打分红线叙述 |
| `lite2.projectsCoverageNote` / `teamEmptyBody` / `upload.switchErrorUnreadable` / `upload.downloadError` / `filesCurrentEmptyRead`（前半句「没有列出」的语义） | 908,648,250,261,509 | absent≠none 纪律 |
| `paperwork.langNote`（**有意的空串**） | 269 | 注释 zh.ts:264-265：中文下故意为空，别为「两边对齐」编一句 |
| 整个 `lite.*` 段 | 306-486 | v01 冻结壳 |
| 整个 `decisionRules` 块 | 1178-1201 | 与 `eval-harness/tests/test_decision_i18n_contract.py` 逐条对账 |

### 6.2 en.ts 同病（本轮不改，记账）

| zh 键 | en 行 | en 现值 | 同病点 |
|---|---|---|---|
| `roomHistoryTitle` | 1737 | `Asked before` | 同样是残句 |
| `adviceSignalsLabel` 等五条 | 1744-1755 | `Fact — signals it picked up` 等 | 同样是 Fact/Inference/Suggestion 认识论前缀 |
| `roomFlowRawTitle` / `ShowRaw` | 1479-1480 | `Raw stream` / `Show raw stream` | 同样是开发者词 |
| `adviceReadTitle` | 1738 | `The read` | 同样晦涩（「判读」就是它的直译源头） |
| `roomFlowTitle` | 1478 | `How Avery got here` | en 比 zh 好（zh 是「分析过程」，en 是完整句）——反向不一致 |
| `filesCurrentTitle` | 579 | `What Avery is reading now` | zh 是「当前资料」，两边语义不同（en 强调"正在读"，zh 强调"是哪一批"） |
| `homeGapsTitle` | 1699 | `Where the documents disagree` | 与 zh「资料对不上的地方」同义，两边都好 |
| `tabRoom` | 548 | `Ask Avery` | 与 zh 一致 ✔ |

### 6.3 组件层要一起改的（不只是换字符串）

1. **`src/lite2/screens/RoomScreen.tsx:643`** —— 空态 eyebrow 复用 `t.nexus.liveThinking`（「正在仔细梳理中 — 实时」），但此刻并没有任何东西在跑。同文件 `:628-630` 的无材料态已经承认了这个问题并改用 `t.lite2.tabRoom`。建议 `:643` 照办。**这是一处真 bug，不是措辞偏好。**
2. **`nexus.askPlaceholder`（zh.ts:292）是 v01/v02 共享键** —— `src/lite2/screens/RoomScreen.tsx:616,650` 与 `src/lite/LiteComposer.tsx:109`、`src/lite/screens/RoomScreen.tsx:179,191` 同用。若要把它从「向你的团队提问…」改成「向 Avery 提问…」而不动冻结壳，需要在 `lite2` 段新建一个键（同 `teamEmptyLead` 从 `team.emptyBody` 分叉的先例，理由写在 zh.ts:644-645）。`nexus.ask`（zh.ts:293「提问」）同理，但它足够通用可以共享。
3. **`src/lite2/screens/FilesScreen.tsx:564-565`** —— eyebrow 与 h2 渲染同一个词。若采纳 §3.3 的 `filesHeading` 改法则组件不用动；若选择删 eyebrow 则改组件。
4. **`src/lite2/screens/RoomScreen.tsx:404`** 注释里的「之前问过的 · N」、**`src/lite2/screens/FilesScreen.tsx:617`** 注释里的「你上传过的几批」—— 两条注释与实际文案已经/将要对不上，改文案时顺手修，否则下一个人 grep 不到。
5. **孤儿键排查**：唯一的只读 i18n 脚本是 `scripts/i18n-orphans.mjs`（可选跑）。⚠ **`scripts/` 下所有 `i18n-zh*.mjs` 都是写文件脚本，其中 `i18n-zh-lite2-delta.mjs` 会整个重写 `zh.ts`（会抹掉对象体里的 8 行 feat-057 红线注释与全部手写注记）且没有任何门会拦。本轮改文案一律手工 Edit，一个生成器都别跑。**（口径已于 2026-08-03 改成「中英文都由当前 session 自己写大白话」，见 zh.ts:1163-1165 注释与 AGENTS.md DoD 第 3 条。）

### 6.4 改完要跑什么

1. `node eval-harness/tools/verify-locale-parity.mjs`（G1，动了任何决策卡文案就必跑）
2. `node eval-harness/tools/verify-status-truth.mjs`（G2）
3. `node eval-harness/tools/verify-file-manifest-truth.mjs`（G3）
4. `node eval-harness/tools/verify-handoffs-empty-honesty.mjs`（G4）
5. `node eval-harness/tools/verify-home-skeleton.mjs`（G5）
6. `node eval-harness/tools/verify-form-builder.mjs` + `verify-forms-proactive.mjs`（G9/G10）
7. `node eval-harness/tools/verify-aria-zh.mjs`（**硬门**，动了任何 aria 就必跑）
8. `node .issues/feat-068-frontend-deploy/verify-zh-purity.mjs`（软门，看可疑清单）
9. `scripts/gates/live-frontend-gate.snippet.js` 的 `gapsDerive` 相位（G6 禁词）与 `v2Boots` 相位（只在动 en tab 时）
10. 像素基线：13 个面 × 2 皮 × 2 视口，**在主检出上重冻并人眼过一遍**（§1.3）
11. `node eval-harness/tools/verify-topbar-clearance.mjs`（**必须 headed**）+ `verify-bottom-furniture-clearance.mjs`（数据态门，别排在 C 区之后）—— 只在改了标题/空态长度时必要
