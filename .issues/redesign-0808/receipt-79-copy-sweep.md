# 回执 · #79 copy-sweep 文案全量批改 + 像素全量重冻（0808 UIUX 重构战役 · wave 3 / S4 收尾）

> 日期 2026-08-09 · 分支 `claude/nostalgic-faraday-5bb216` → 已 fast-forward 合入**本地** main（`38fac66`）。
> **未 push、未上产。**
> 正源：`recon-copy.md`（§5 照抄表 / §6.1 不许动 / §6.3 连组件改 / §6.4 检查单）·
> 拍板：`tickets.md` 末尾「见仁见智 8 条」（Danny 2026-08-09 逐条勾选，改 6 留 2）·
> 前情：`receipt-75-room-claude.md` · `receipt-76-77-74-files.md` · `receipt-78-threads.md`。

## 一句话

zh.ts **137 个键改值 + 2 个新键**、en.ts **28 改 + 2 新**，`lite.*`（v01 冻结壳）一个字节没动；
**6 组门连改**逐条独立变异实证还有牙；像素在主检出做了**真比对 → 全量重冻 → 逐张人眼过**，
并给两份回执点名的「议事室数据态零像素覆盖」补上了 4 张基线（born-red 按视口逐个验过）。

## 目录

1. 改了什么（含与票面口径不同的 4 处判断）
2. 4 个真 bug（票面 3 个 + 本票新查出 1 个）
3. 门连改与变异台账（含一条**变异设计错误**的复盘）
4. 像素：真比对 / 全量漂移清单 / 重冻 / 新增覆盖
5. 人眼过
6. §6.4 十一项检查单逐项交代
7. 验证账
8. 刻意留下的账 / 顺手发现没顺手修

---

## 1. 改了什么

| 批 | 数量 | 来源 |
|---|---|---|
| A 级「必改」 | 34 键 | recon-copy §5.1 照抄表 |
| B 级「建议改」 | 84 键 | recon-copy §5.2 照抄表 |
| 见仁见智（Danny 勾了的 6 条） | tabRoom + 皮肤名 ×2 + 笔记标题(+eyebrow) + 速读版 + 「长出来」族 6 处 + 骨架屏 5 条 | tickets.md |
| 词族顺手统一 | roomEmptyBody 等零星几处「材料/文件」→「资料」 | 同屏一致性 |
| **合计 zh** | **137 改值 + 2 新键** | |
| en.ts 同病 | 28 改值 + 2 新键 | recon-copy §6.2 + 票面「en.ts 对应同病顺手改」 |

**`lite.*` 段（zh.ts:340-520）与 `decisionRules` 块一个字节未动**；§6.1「不许动」清单逐条核过（见 §6 表）。

### 与票面口径不同的 4 处判断（都记在这儿，供 Danny 抽查）

**(a) `nexus.liveThinking` 没照 §5 表改成「正在分析」，改成了「实时进度」。**
§5 表是在 #75 之前写的。#75 之后 v02 的眉标**只在 `running` 时渲染**（`RoomScreen.tsx:399-401`），
照表改会让眉标「正在分析」与紧挨着的状态行「正在分析…」**逐字撞车、上下堆着说同一句话**——
那正是 #79 要消灭的自嗨。改成**给这条状态条命名**（它是什么）而不是复述它的状态（它在干嘛）：
`.nexus-brief-bar` 的 `aria-label` 也用这个键，四态（running/ready/interrupted/error）下都不撒谎。
⚠ 这三条是**共享段**，v01 冻结壳的 RoomScreen 也读——但两壳此前就是同一句、改完仍是同一句，
**不制造两壳分叉**（与 §0「改 lite 段只会制造两壳不一致」那条纪律不冲突）。

**(b) tabRoom 改名的「连带 8 处」按一条规则落地，不是 8 处全改。**
立的碑：**名字引用跟着改，动词短语不改**。
- 改（它们在**叫这个屏的名字**）：`followupsSourceRoom`「来自对话」· `followupsEmptyActive` ·
  `homeTodayEmpty` · `roomBoardAria`「对话 —— 回答区」· `formsBuilderGoesToLibrary`「在对话里引得到」。
- 不改（「去问 Avery」是**动作**不是屏名，且悬浮胶囊 `askAveryLabel` 仍叫「问 Avery」）：
  `triageTakeToRoomLabel` / `notesEmptyCta` / `homeDecisionAskRoom` / `notesEmptyBody` / `notesLede`。
  同 Claude 的分工：产品叫 Claude，导航项叫 Chats，按钮照样写 "Ask Claude"。
- ⚠ 名单里的 `gapAskLabel` **改了**，但理由不是改名连带——它是一个真 bug，见 §2④。

**(c) `notesEyebrow` 一并从「观察记录」改成「笔记」**（Danny 只勾了标题）。
`NotesScreen.tsx:153-154` 把 eyebrow 与 h2 上下贴着渲染，新标题「Avery 关于你公司的观察记录」
以「观察记录」结尾——不动 eyebrow 就是 §3.3 刚给 Files 治过的同一种「同一屏连着说两遍」。

**(d) 「长出来」隐喻族多修了一处、也把 `teamEmptyBody` 的红线半句逐字保住。**
见 §2 与 §8。

---

## 2. 真 bug

| # | 键 / 位置 | 病 | 处置 |
|---|---|---|---|
| ① | `lite2.formsBuilderGoesToLibrary` | 泄漏 **v01 冻结壳的 tab 名「议事室」**，v02 里根本没有这个地方（全 lite2 段仅此一处） | 改成 v02 的屏名。⚠ G9 钉的「只进资料库」「不上任何卡」两个片段**逐字保留**，M7 变异实证仍咬得住 |
| ② | `lite2.gapFollowupTitle` | 「多看一眼」是 v01 词族（v02 是「值得注意」，ADR-0031）。这条铸出来的待办标题会**永久落进 localStorage** | →「确认一下{title}」（待办要能读成一件事，比「值得注意{title}」更像动作） |
| ③ | `RoomScreen` 空态 eyebrow 复用 `nexus.liveThinking` | 票面说「要改组件」 | 🔴 **已被 #75 消灭**：`RoomScreen.tsx:845` 那颗 eyebrow 是**删掉的、不是改字的**（注释在案）。本票核实后**没有重复施工**，只把同族漏网的 aria 那半补上：`roomEmptyAria`「还在梳理中 —— 向你的团队提问」→「向 Avery 提问」 |
| ④ | `lite2.gapAskLabel`「直接问本人」 | 🔴 **本票新查出来的**：`handleGapAsk`（`HomeScreen.tsx:236-249`）走的是 `setComposerHint` + `goScreen('room')`——它把你带去问 **Avery**，一个字都不会发给那个人。界面在撒谎 | →「去问 Avery」。recon 只把它列进「tab 改名连带 8 处」，没说破它是个谎 |

### 组件层（§6.3 五条逐条核对现状）

| §6.3 | 现状 | 处置 |
|---|---|---|
| 1 · `RoomScreen:643` 空态 eyebrow | **已被 #75 消灭**（删元素） | 不重复施工，改 aria 那半 |
| 2 · `nexus.askPlaceholder` 是共享键 | 仍是共享键 | **新建 `lite2.roomAskPlaceholder`**「向 Avery 提问…」，`RoomScreen.tsx:877` 改读它；共享键留给 v01 一个字节不动。先例：`teamEmptyLead ← team.emptyBody`（zh.ts:703-704 有原注释） |
| 3 · `FilesScreen` eyebrow 与 h2 同词 | 仍同词 | 采 §3.3 的 `filesHeading` 改法 → 组件不用动 |
| 4 · 两条陈旧注释 | 仍陈旧，且**不止两条** | 六处一起修：`RoomScreen:494/786`（「之前问过的」）· `FilesScreen` ×4 + `KnownContextList` + `lite2.css` + `store.ts` + `UploadPanel` + `file_append.py` + 两道门的 rec 标签（「你上传过的几批」「另建一份画像」） |
| 5 · 别跑生成器 | — | **全程手工 Edit，一个 `scripts/i18n-zh*.mjs` 都没跑**；只读的 `i18n-orphans.mjs` 跑了：**孤儿 0 个** |

### 🔴 另一处 recon 归类错误（本票实收）

`team.emptyTitle`「你的团队会在这里长出来」被 recon 记成「v01/共享段 3 处，随冻结壳纪律不动」。
**那个归类是错的**：`t.team.emptyTitle` 同时渲染在 `src/lite/screens/TeamScreen.tsx:218` **和
`src/lite2/screens/TeamScreen.tsx:362`**——那句隐喻一直印在 **v02 团队空态的 h1** 上
（本票重冻的 `*-team-*` 基线里肉眼可见，正是人眼过逮到的）。
照 (2) 同一条先例分叉：**新建 `lite2.teamEmptyHeadline`「你的团队会出现在这里」**，共享键不动。
修完再冻，**恰好只有 4 张 team 基线变化**——正是这处修复的作用面。

---

## 3. 门连改与变异台账

### 3.1 死针探测（先做的，别靠转述）

写了一个「死针探测器」：把 `eval-harness/tools` `eval-harness/visual` `scripts/gates` `.issues` 下
所有 `.mjs/.js` 里的字符串/正则字面量抽出来，逐条问一句——
**「它在 HEAD 的字典值里出现过，改完之后在任何字典值里都不出现了吗？」**
是的那批，就是**从此再也判不到任何东西**的判据（正向词表版的「改了门不红、门会瞎」）。

结果：**4 根死针**，与手工分析完全吻合，且没有多出第五根。
（英文侧探测不到的一类另行手查：`_clickTab('Ask Avery')` 这种「字符串仍存在于别处、但作为 **tab 定位器**
已经死了」的形态——探测器看不见语义，只能靠人。查出 6 处 + 1 个期望数组。）

### 3.2 改判清单（全部同一个 commit）

| # | 门:行 | 改了什么 | 为什么必须改 |
|---|---|---|---|
| G-a | `verify-room-claude-rework.mjs:213` | 负向针 `'分析好了'` → `'分析完成'` | 它钉的是 `nexus.liveReady` 的**值**。不同步 = 判据变成「找一个全库已不存在的串」＝**恒真** |
| G-b | `verify-switchers.mjs:74` | `initial.lookActiveText === '极光'` → `'深色'` | 🔴 **recon §4 写的「verify-switchers 读 URL 参数不读文本 → 门不红」是错的转述**——这是一条直接比对按钮文本的**硬判据** |
| G-c | `verify-switchers.mjs:86` | `afterLook.activeText === '暖纸'` → `'浅色'` | 同上。变异里 `shellLook`/`storage` 仍是 `paper` 却照样红，正说明判据落在**标签**上 |
| G-d | `.issues/rich-align-0722/verify-restart-09.mjs:56` | `/暖纸\|Paper/` → `/浅色\|Light/` | 它拿这个正则**找按钮**；找不到时 `find` 返回 undefined、`if (paper)` 让点击整个跳过，红在下游的 `look=paper` 上——**不是崩、不是跳过，是最难诊断的那种假红** |
| G-e | `scripts/gates/live-frontend-gate.snippet.js` | `assertV2Boots` 期望数组 `'Ask Avery'` → `'Chat'`；**6 处** `_clickTab('Ask Avery')` → `_clickTab('Chat')`；两条注释 | `_clickTab` 做整颗按钮 textContent 精确比对，不改就是全体 30s 超时（崩不是红）；期望数组不改则 v2Boots 必红 |
| G-f | `verify-at-references.mjs:751` · `verify-context-switch.mjs:98` · `verify-append-story.mjs:112` | rec 标签/注释里引用的旧文案 | 描述性标签不是判据，但引着已死的文案会把下一个人带沟里 |

**零改判的门**：G1 locale-parity / G2 status-truth / G3 file-manifest-truth / G4 handoffs-empty-honesty /
G5 home-skeleton / G6 snippet BANNED_TERMS / **G7 MOOD_VOCAB_RE** / **G8 receiptLeak** / G9 form-builder /
G10 forms-proactive —— 逐条核过：**两处负向词表陷阱（`如常|偏紧|吃紧`、`本人自述`）钉的键全在 §6.1
不许动清单里，本票一个字没碰，因此不需要同步、也没有静默失效的口子。**

### 3.3 变异台账（**逐条独立跑**，每条跑完都还原 + 重打 dist）

| 变异 | 内容 | 结果 |
|---|---|---|
| **M1** | 把 `streamSource.ts` onDone 的白名单改回黑名单（#75 的原病根） | **42 PASS · 4 FAIL**，`hud:"分析完成"`、`storeStatus:"complete"`——改判后的针**逐字扎中**，原病根复现 |
| **M2** | `lookSwitchAurora` 标签改掉 | **26 · 1**，精确红「默认态：深色是 active」 |
| **M3** | `lookSwitchPaper` 标签改掉 | **26 · 1**，精确红「点击换 class：浅色按钮变 is-active」；`shellLook/storage` 仍是 `paper` 却照样红 ＝ 判据真落在标签上 |
| **M4** | `en.tabRoom` 改成 `'Talk'` | **2 · 1**，精确红 v2Boots「tab 主名序列与期望数组逐字相等」，`actual` 打印出整串 |
| **M5** | 同 M3，但跑 `verify-restart-09` | 红在「③ restart 前：look 偏好落了 paper — **look=null**」——正是预判的「静默跳过点击 → 下游假红」形态（基线未变异时 15/15 绿） |
| **M7** | 从改写后的 `formsBuilderGoesToLibrary` 里拿掉「不上任何卡」 | **42 · 1**，精确红 G9 那条片段判据 ⇒ **重写这句之后，钉子仍咬在新串上** |
| **M8** | 往缩短后的骨架屏说明塞一个阿拉伯数字 | **16 · 1**，精确红「骨架块内零数字」⇒ 缩短后的五条仍在那把尺子底下 |
| **M9** | 把 `adviceHrAria` 改回 `'HR / 谁来把关'` | **4 · 0 活下来了** —— 见下 |
| **M9b** | 订正版：往改写过的 `roomBoardAria` 塞一个**这把尺子看得见**的拉丁串 | **3 · 1**，aria 硬门红 ⇒ 本票重写的那批 aria 值真的在采样面里 |

#### M9 活下来的复盘：**是变异设计错了，不是门有洞、更不是代码 bug**

`verify-aria-zh` 的 `suspiciousLatin` 尺子是「**≥2 个连续拉丁词，或单个长度 ≥4 的拉丁词**」。
`HR` 是 1 个 2 字母词 —— **这把尺子从来就照不到它**（recon §1.2 白纸黑字写过：
「`HR`（2 字母单词）、`1:1`（无字母）在这把尺子下不报」）。变异根本没碰到被判的性质。
换成 `roomBoardAria` 塞一个长度 ≥4 的词（M9b），门立刻红。

🔴 **顺带落一条档**：`HR` / `1:1` 这类**短拉丁黑话进 aria，全仓没有任何一道门会红**。
本票把它们改掉是执行 `verify-zh-purity` 收尾注释里那条**产品口径**纪律
（「`HR`→「人事」是**改文案**解决的，没有塞进白名单——放宽纯度门去迁就一句能改好的中文，
是把门本身花掉」），**不是**因为哪道门逼的。将来谁把它们加回来，一样一道门都不会红。

---

## 4. 像素

### 4.1 真比对（主检出的真基线 × 本 worktree 的构建）

按 #78 立的口径：**在主检出 `D:\avery` 跑 playwright（用它的真基线），`VERIFY_BASE` 指向 worktree 的
preview（5179）**——不动主检出的分支，也不动它的 dist。

- **0 张「snapshot doesn't exist」**（＝真比对，不是首写）· 8 条 spec 全红 · 基线字节未被这一跑改写。
- ⚠ spec 头注那条警告实收：`visual.spec` 一个 test 串着跑 9 次 `toHaveScreenshot`，
  **第一处不匹配就中止整条**——8 条全停在 `home`，**一次红跑给出的漂移清单是残缺的**。

### 4.2 全量漂移清单（带确定性对照）

要拿完整清单只能靠「重冻前后 md5 全表 diff」。但我第一版的 md5 表被 `sed 's|.*/||'` **把哈希一起吃掉了**
（贪婪匹配到行内最后一个 `/`），于是那次「基线未被改写」的比对是**空判**——已订正并记在这儿，
因为它正是「验证器自己撒谎」的又一种形态。

订正做法：把重冻后的 54 张存到一边 → 在主检出用它自己的 **main 构建**（另起 8171/5171）重新冻一遍
＝重建出「旧基线」→ 与新基线逐字节比。并且**为这条重建加了一道对照**：
**同一份 main 构建连冻两次，50 张逐字节一致** ⇒ 重建是确定性的，下面这份清单是真漂移不是噪声。

> **漂移 50 / 50 张（全漂）**。
> 原因干净：tab 主名在**每一屏的顶栏**上，「问 Avery」→「对话」必然让 50 张全动。
> 完整清单见下方 §4.4 附表。

### 4.3 重冻 + 稳定性

- `--update-snapshots` 重冻 → 复跑一轮**不带** update：**8 passed · 0 首写 · 基线字节未变**。
- `teamEmptyHeadline` 修复后再冻，**恰好 4 张变化**（`{aurora,paper}-team-{desktop,mobile}`）——
  正是那处修复的作用面，多一张少一张都要查。

### 4.4 新增覆盖：议事室数据态（两份回执点名的零覆盖面）

`visual-data.spec.mjs` 的 `SCREENS` 加 `'room'`，**54 张**（50 + 4）。

**为什么只拍「有材料 + 零轮次」那一态**：
- 它不需要真跑 `/advise`（无 LLM 方差），也不带历史面板（`adviseRuns` 为空 → 面板不渲染），
  因此**不带墙上时钟文案**；
- **带轮次的那一态刻意不入基线**：历史面板会印「8月9日 19:52」这种墙钟文案（时间炸弹），
  而判读卡的 confidence / script / metrics / escalation **四段在 mock 语料下根本不渲染**
  （本票实测），冻它等于把一张**残缺的卡**当满态基线冻进去。
- 自证两条防「把无材料态当数据态冻」：`.lite-room-welcome` 必须在场 + `.lite-room-nomaterial` 必须为 0
  ——不写这两条的话，上传没生效时会把 `visual.spec` 已经有的那四张无材料态**再冻一遍**，
  看着多了四张、实际什么都没多盖。

**born-red 按视口逐个验**（碑：桌面红 ≠ 手机红，折叠线下是瞎区）：

| born-red | 红的图 |
|---|---|
| BR-1 改 `roomEmptyTitle`（开场块 h2） | `{aurora,paper}-room-data-{desktop,mobile}` **4 张全红**，其余 50 张一张没红 |
| BR-2 改 `roomChipsLabel`（建议 chips 标题，怀疑手机在折叠线下） | 同样 **4 张全红** ⇒ 手机基线确实拍到了 chips 行 |

「其余 50 张一张没红」同时证了两件事：**新基线盖的是一块真空白**，而且**旧的 50 张确实够不着这一面**。

### 4.5 附：50 张漂移清单

`{aurora,paper}` × `{files, followups, home, home-data, home-gaps-data(mobile), notes, playbooks,
projects, projects-data, room, team, team-data, vision}` × `{desktop, mobile}` —— 全部 50 张。
（`home-gaps-data` 只有 mobile 一张，`*-data` 三屏各 2 张，其余每屏 2 张。）

---

## 5. 人眼过

证据落在 `.issues/redesign-0808/_px79/`（已入库）：

| 图 | 覆盖 |
|---|---|
| `sheet-{aurora,paper}-{desktop,mobile}.png` | **重冻后的 50 张基线全量**，双视口 × 双皮逐张过 |
| `eye-{aurora,paper}-{desktop,mobile}.png` | **像素零覆盖的六面**：设置菜单（皮肤名）· 议事室空态 · 议事室答完态 · 原始日志展开 · 历史对话面板 · 跟进屏 |
| `advice-full-{aurora,paper}.png` | 判读卡**全分节**（见下） |

**逮到的问题（都已修并复跑）**：
1. 🔴 `*-team-*` 四张上 h1 仍写「你的团队会在这里长出来」 → 查出 recon 的归类错误 → 分叉新键（§2）。

**判读卡的取证方式（值得下一个人抄）**：mock 语料只产 结论/信号/依据/下一步 四段，
本票改的 `adviceConfidenceLabel` / `adviceConfidenceWouldChange` / `adviceWatchLabel` /
`adviceScriptLabel` / `adviceHrLabel` / `adviceEscalationHRBP` 六条**在默认语料下根本不渲染**、
拿不到视觉证据。做法是往最后一轮的 `run.advice` **注一份满态**再截图（`escalation.level` 要写
`'HRBP'` 大写、且要给 `note` / `confirmWith`，否则组件在 `.length` 上抛错、卡整个消失）。
实拍确认：「可信度 中等」·「什么情况下结论会变 2」·「建议的下一步 + 加到待办」·
「如果你要找他单独谈」·「怎么判断有没有效果 2」·「什么时候找人事 〔人事〕」·「谁来把关」——
徽章「人事」比原「人力伙伴」窄，无溢出、无裁切。

---

## 6. §6.4 十一项检查单逐项交代

| # | 项 | 结果 |
|---|---|---|
| 1 | `verify-locale-parity`（G1） | **绿**（A 区内）。EXPECT.zh 六个词全在 §6.1 不许动清单里，一个没碰 |
| 2 | `verify-status-truth`（G2） | **绿**。`projectsLede` 重写时「文档未提及」逐字保留 |
| 3 | `verify-file-manifest-truth`（G3） | **绿**。`fileStatusIngested/Failed` 是**全等**比对，一个字没碰 |
| 4 | `verify-handoffs-empty-honesty`（G4） | **绿**。它按壳分词、只扫 `.lite-handoffs-empty`，与 `gapFollowupTitle` 无关 |
| 5 | `verify-home-skeleton`（G5） | **绿**，且 **M8 变异实证**缩短后的五条仍在「零数字」那把尺子下 |
| 6 | `verify-form-builder` + `verify-forms-proactive`（G9/G10） | **绿**，且 **M7 变异实证** G9 的片段判据仍咬得住改写后的新串 |
| 7 | `verify-aria-zh`（**硬门**） | **绿**，且 **M9b 变异实证**。本票所有 aria 新值纯中文，并**移走**了 `HR` / `1:1` 两处拉丁 |
| 8 | `verify-zh-purity`（软门） | **绿**（A 区内）。可疑清单无新增（改的方向是把拉丁词**拿掉**） |
| 9 | snippet 的 `gapsDerive`（G6 禁词）与 `v2Boots`（动 en tab 才跑） | 都在 A 区内**绿**；v2Boots 另有 **M4 变异**。G6 禁的「差距/gap/Nexus」新值一个没沾 |
| 10 | 像素 13 面 × 2 皮 × 2 视口，主检出重冻 + 人眼过 | **做了**，见 §4/§5（并从 50 张扩到 54 张） |
| 11 | `verify-topbar-clearance`（**headed**）+ `verify-bottom-furniture-clearance` | 都在 A 区内**绿**。宽度闸方向安全：tab「问 Avery」(8 半角宽)→「对话」(4)、EN `Ask Avery`(9)→`Chat`(4)，**只变短**；空态 body 全部等长或变短（骨架屏五条各缩 27%–49%） |

**宽度/高度闸的第三条**（`verify-at-references:597-602` 灰提示尾段 `tail.length >= 8`）：
喂给它的是**数据拼装串**（`${gap.projectTitle} — ${gapClaimText(...)} — ${gap.evidence}`），
字典侧的贡献只有 `handoffAction` 与 `projectsStatus*`——**本票这三个键一个都没碰**，判据不受影响；
at-references 71 条实跑全绿。

---

## 7. 验证账

| 电池 | 结果 |
|---|---|
| `npm run typecheck` | 绿 |
| `scripts/i18n-orphans.mjs`（只读） | **孤儿 0 个**（两个新键都真有消费者；`team.emptyTitle` 仍被 v01 消费，没变成孤儿） |
| `scripts/css-brace-check` / `css-scope-check` | 15 个 CSS 全配平 · lite2.css 全 scoped |
| 离线 pytest（四 deselect，`TZ=UTC`） | **4045 passed**（与 #78 基线严丝合缝，本票零后端行为改动） |
| 电池 A 区 | **34/34 绿**（首跑 34/34；行尾归一后复跑 34/34；全部收尾后第三次复跑仍 34/34） |
| 电池 B 区 | `data-boundary` 绿 · `null-owner` **15/0 真跑到了** · `visual` 见 §4 |
| 电池 C 区 | **3/3 绿**。跑完按纪律重打带 `VITE_AVERY_API_BASE` 的 dist，并在**浏览器里验过** `window.__AVERY_BUILD__.apiBase === http://127.0.0.1:8179` |
| 不在册的一次性门 `verify-restart-09` | **15/15 绿**（本票改了它，所以单独跑了基线 + M5 变异） |
| 像素 | 真比对 8 红 → 全量重冻 54 张 → 复跑 **8 passed · 0 首写 · 字节未变**；4 张新基线 born-red 双视口各验 |

### 环境与跑法（复现用）

```
后端: cd eval-harness && AVERY_BRAIN=mock AVERY_EXTRACTOR=heuristic AVERY_EMBEDDINGS=keyword \
      AVERY_DEMO_SEED_DIR=tests/fixtures/demo-seed AVERY_PUBLIC_BASE=http://127.0.0.1:8179 \
      AVERY_CORS_ORIGINS=http://localhost:5179,http://127.0.0.1:5179 \
      python -m uvicorn service.app:app --host 127.0.0.1 --port 8179 --app-dir .
前端: VITE_AVERY_API_BASE=http://127.0.0.1:8179 npx vite build --mode development
      npx vite preview --port 5179 --host
门:   VERIFY_BASE=http://127.0.0.1:5179 VERIFY_API=http://127.0.0.1:8179 \
      node eval-harness/tools/run-battery.mjs --only=A   （再 --only=B / --only=C）
像素: cd D:/avery && VERIFY_BASE=http://127.0.0.1:5179 npx playwright test -c eval-harness/visual
```
⚠ 本轮 **5173 是空的**（0808 那条遗留 preview 已按授权清掉），但仍走隔离端口 5179/8179。

---

## 8. 刻意留下的账 / 顺手发现没顺手修

- 🔴 **aria 门对短拉丁黑话是瞎的**：`HR`（2 字母）、`1:1`（无字母）过不了 `suspiciousLatin` 的尺子。
  本票把它们改掉是执行产品口径，不是门逼的；**加回来一样一道门都不会红**（M9 实证）。
- **`gapCardClaimLabel`「文件里的说法」没动**（§5 表没列），于是同一张差距卡上是
  「文件里的说法 / 资料里的实际情况」——「文件 vs 资料」在一张卡里不对仗。recon §3.4 的原意就是这样对仗的，
  照表没改；要统一得连 `gapCardClaimLabel` 一起动，归下一票。
- **`projectsTitle`「你文件里的项目」没动**（§5 表没列），与同屏已改的 lede「来自你上传的**资料**」词族不齐。
- **`onboardPlaybooksBody`「会长成什么样」没动**：「长成什么样」在中文里是正常说法，不属「生长出来」自嗨族。
- **mock 语料下判读卡的信号行是英文**（`Grounded in the record: …`）——那是 mock brain 的产物不是字典，
  真 brain 下走 locale。本票不碰，记一笔免得下一个人当成 i18n 漏网。
- **带轮次的议事室数据态仍无像素覆盖**（理由见 §4.4：墙钟文案 + mock 下判读卡残缺）。
  要补得先给历史面板的时间戳找一个可钉的呈现，或给 spec 加 `clock.setFixedTime` **且**接受
  「冻的是一张残缺卡」这件事。
- **`.issues/gap-design-0805/t8-e2e.mjs:514` 的反向判断**（`room.status !== 'error'`）仍在（#75/#78 都记过）。
- **`--lite2-bottom-band` 幽灵 token / `--lite2-clear-top` 的 ≤860 覆盖写了两遍** —— 值未动（#75/#78 记过）。
- **本票自己踩的两个坑，留给下一个人**：
  ① 多行插入时 `new` 忘了跟着转 CRLF，四个门文件变成**混行尾**（13 处裸 LF）——
     `git status` 的 "LF will be replaced by CRLF" 警告是唯一的信号，已全部归一并复跑 A 区。
  ② `md5sum … | sed 's|.*/||'` 是**贪婪**的，会把哈希一起吃掉，于是「基线未被改写」的 diff 成了空判。
     任何「比对前后 md5 全表」的做法，先看一眼表里到底有没有哈希。
- **未 push、未上产。** 前端 push main 即自动构建上产。
