# feat-055 · 项目屏（整屏新建）· PRD G9

分支 `feat/055-projects-screen` · 工作树 `D:\avery-wt\055` · 2026-07-18

> 本条是**接管**：上一轮 workflow 在实现阶段被杀，留下一条未经任何门验证的
> `wip(055)` 提交（`732acc5`）。本文记录我对那份草稿的核实结论、补完内容、以及**逐条真验**的证据。

---

## 1 · 接手的 WIP：哪些对、哪些错、我改了什么

`732acc5` 的 055 相关产出：`ProjectsScreen.tsx` / `projectView.ts` / `routes.ts` /
`Lite2App.tsx` / `LiteTopbar.tsx` / `DetailOverlay.tsx` / `lite2.css` / `en.ts` / `zh.ts`。
（同提交里还混进了 `.vite-verify055/` 构建产物与 `vite.verify055.config.ts`，已由 `523f31b` 清掉。）

### 核实为**正确**、我原样保留的

| 项 | 核实方式与结论 |
|---|---|
| `projectView.ts` 读 `rawTeam` 而非 `team` | 查 `teamData.ts:169` 一带确有 `status ?? 'on-track'` / `ownerName ?? 'Unassigned'` 兜底；后端 `project_cards()` 是「缺就不发键」。**读 raw 是唯一能分辨已知/未知的地方**，判断成立。 |
| `progressOf()` 用 `typeof === 'number'` 而不是真值性 | 这是对的：`progress: 0` 是**文档真写了 0**，不能和「没写」混为一谈。已真验（见 §3 用例 `pr_c`）。 |
| 字段与真契约对得上 | 逐字段比对 `transport.ts:102 LiveProjectCard` 与 `:90 LivePersonCard`，无杜撰字段。 |
| `routes.ts` / `Lite2App.tsx` 的接法 | WIP **没有**照 051 注释把 `/projects/:projectId` 换成自己的 element，而是只改 `screenFromPathname` 的底屏口径 —— 这是对的，换 element 会让「进详情=换了棵树」，正是 051 复核逮到的那条 major。已真验冷深链与站内点开两条路径。 |
| 两处都是「末尾追加」 | `LiteScreen` 联合类型、`SCREEN_PATH`、`SCREEN_COMPONENT`、Route 列表均在既有条目后追加，未重排、未改他人条目。 |
| 零写死数据 | 屏头计数与覆盖率三个数走 `projectCoverage()` 当场算；无假日期、无 canned 文案、无假延迟。 |
| 人卡无分数 | 项目屏不碰人卡；`ProjectView` 无任何分数字段。 |

### 我**改掉/补上**的

1. **`DetailOverlay.tsx` 出场动画快照不对称（WIP 引入的真缺陷）**
   WIP 把项目详情改成吃 live `rawTeam`，但出场动画那张 `lastRef` 快照只留了 `team`。
   于是 `reset()` 把 team/rawTeam 一起清空时，**人卡还能渲染完那 300ms，项目卡却会当场翻成
   「这张卡片已不在你上传的文件里」再消失**。
   → 快照改成 `{ detail, team, raw }`，`projectViews` 吃 `heldRaw`。两者同源同寿命。

2. **中文口径不一致：项目屏说「进度」、详情浮层说「进展」**
   同一个项目的同一个字段，两处两种说法 —— 正是 `projectView.ts` 自己注释里禁止的那件事。
   → 改 `zh.ts` **lite2 块**的 `detailProgress`：`进展` → `进度`。
   🔴 v01 `lite` 块的同名键（`zh.ts:171`）**一个字没动**（冻结层）。en 两处本来就都是 `Progress`，无此问题。

3. **删掉未使用的 i18n 键** `projectsBlockersLabel`（en+zh 各一行，WIP 留下的死键）。

### 我**核实后决定不改**的

- **`scripts/gates/live-frontend-gate.snippet.js:1300` 硬编码 7 个 tab 的期望数组**，本条加第 8 个
  必然让 `assertV2Boots` 相位对不上。WIP 选择不改门、留给集成方 —— 我认同并保持：
  **feat-057 的 `home` tab 会撞同一行**，两条线各改各的必冲突。见 §5 交接项。
- tab 位置放在「你的团队」之后（而非队尾）：WIP 的理由（人/项目是同一份上传的两半）成立，保留。

---

## 2 · 一个跨线缺陷：`lite2.css` 少一个右花括号（不修则本条样式全废）

WIP 在 `lite2.css` 补了一个 `}`，并声称「feat-053 起的所有规则都被卷进了
`@media (prefers-reduced-motion: reduce)`」。**这条我独立复核过，属实**：

```
# 去掉注释后数花括号
BASE (8be4ab4) net brace balance = 1     ← 少一个 }
HEAD             net brace balance = 0
```

逐行追踪 base 的嵌套深度，`@media (prefers-reduced-motion: reduce)` 在第 3431 行结束了内层规则后
**深度仍是 1**，其后 feat-053 的整套 `.lite-auth*` 样式、以及追加在文件末尾的一切，
全部嵌在这条 media query 里 —— **只在用户开了「减少动效」时才生效**。
esbuild 一直报的是 warning 不是 error，所以三道硬门全绿也照样漏过去。

不补这一个字符，feat-055 的样式表在多数用户那里等于不存在。**本条属跨线修复但无法回避。**
补后已真验样式确实生效（§3 的 `framePad=84px` / `grid` / 圆角 paper 8px vs aurora 10px）。

---

## 3 · 验收：逐条真验（76/76）

**怎么验的**：起本地 dev（端口 5055，vite config 放在 scratchpad、cacheDir 也指向 scratchpad，
**不污染多线共享的 `D:\avery\node_modules\.vite`，不入库**），用 playwright 拦
`/team/{id}` 喂手工构造的 `LiveTeamPayload`，**专门造出真 payload 那种稀疏覆盖**
（progress/dueDate 各缺 4/7、无 status、词表外 status、无 owner、`progress:0`、空标题、查不到的 ownerId）。
🔴 没打生产后端。

脚本：`<scratchpad>/verify055.mjs`（项目外，不入库）。真实输出摘录：

```
PASS  pr_b 无 progress → 不画进度条  — hasBar=false
PASS  pr_b 无 progress → 显示「文档未提及」  — {"label":"进度","value":"文档未提及","unknown":true}
PASS  pr_b 无 dueDate → 显示「文档未提及」  — {"label":"到期","value":"文档未提及","unknown":true}
PASS  全屏只有真写了 0 的 pr_c 显示 0%，缺失的一个都不显示  — ["pr_c"]
PASS  pr_c progress=0 → 当已知值画条并显示 0%  — bar=true val=0%
PASS  只有 3 张卡画进度条（进度未知的 4 张一条都不画）  — ["pr_a","pr_c","pr_f"]
PASS  未知事实行数 = 4 进度 + 4 到期 + 2 负责人 = 10
PASS  pr_d 无 status → 状态显示「状态未提及」且弱化  — 状态未提及 unknown=true
PASS  pr_e 词表外 status「待启动」原样回显  — 待启动
PASS  pr_g ownerId 查不到 → 不编「未分配」  — 文档未提及
PASS  覆盖率条真算：4 个没写进度 / 4 个没写到期 / 1 个没写状态
PASS  顶栏出现第 8 个 tab「项目」  — ["你的团队","项目","议事室","跟进","Avery 的笔记","多看一眼","操作手册","未来方向"]
PASS  点 tab → /projects            PASS  切屏后入口五参数一个不丢  — ?v=2&mode=live&look=paper&lang=zh
PASS  点卡 → /projects/pr_b         PASS  浮层底下垫的是项目屏  — projects
PASS  关闭详情 → 回 /projects（不是 /team）  — /projects
PASS  冷深链底屏 = 项目屏（不是团队屏）      PASS  冷深链关闭 → 落 /projects
PASS  1 个项目：只渲染 1 张卡，不补骨架卡    PASS  1 个项目：只出 1 个分组，不留空栏
PASS  0 个项目：走诚实空态  / 不出卡片 / 不出分组栏 / 不出覆盖率条
PASS  look=paper:  项目屏 CSS 真生效  — {"framePad":"84px","grid":"grid","radius":"8px"}
PASS  look=aurora: 项目屏 CSS 真生效  — {"framePad":"84px","grid":"grid","radius":"10px"}
PASS  look=paper:  进度条填充有色  — rgba(105, 128, 109, 0.72)
PASS  look=aurora: 进度条填充有色  — rgba(73, 110, 232, 0.72)
PASS  look=<两种>: 详情「进度」这一节仍然出现，写「文档未提及」而非整节消失  — italic
PASS  en: 第 8 个 tab = Projects   PASS  en: 未知值 = "The documents did not say"
PASS  en: 项目屏壳文案零中文残留

=== 76/76 passed ===
```

对照 kickoff 验收条目：

| 验收要求 | 结论 |
|---|---|
| 无 `progress` 显示「未知」而非 0% | ✅ 且**不画 0 宽的条**；`progress:0` 仍按已知值画 |
| 无 `dueDate` 同理 | ✅ |
| tab 进入 / 深链直达 | ✅ |
| `/projects/:id` 点开详情、**关闭回项目屏** | ✅ 站内点开与冷深链两条路径都验了 |
| 1 个 / 0 个项目不难看 | ✅ 非空分组 + 自适应网格；0 个走诚实空态、无骨架卡 |
| 两种 Look 都正常 | ✅ 令牌真跟随（圆角/强调色两 Look 不同值） |
| 入口直链五参数不丢 | ✅ 切屏、开详情、关详情后均在 |
| typecheck / build / lint | ✅ 见下 |

### 三道硬门（最终一次干净跑，`D:\avery-wt\055`）

```
$ npm run typecheck     → tsc -b，无输出，0 错
$ npm run build         → ✓ built in 5.03s（仅 chunk>500kB 的既有提示；
                           花括号修复后 esbuild 的 unbalanced-brace 警告已消失）
$ npm run lint          → ✖ 5 problems (0 errors, 5 warnings)
                           5 条 warning 全部是既有的（OnboardWizard / RoomScreen / useRailCamera
                           的 eslint-disable 无效提示），**本条改动零新增**
```

**后端 pytest 未跑** —— 本条零后端改动（diff 里没有 `eval-harness/**`），故不声称该门。

### 收工纪律
- dev server 用完已停，`5055 released` 已确认。
- 无构建产物入库：`git status --porcelain` 为空；`dist/` 属 `.gitignore:2`。
- 验证用的 vite config 与 playwright 脚本全在 scratchpad，**不在仓库里**。

---

## 4 · 做了什么 / 没做什么

**做**：`/projects` 整屏项目看板（第 8 tab）· 卡片含 标题/状态/负责人/到期/进度/卡点 ·
「未知」派生层 `projectView.ts`（屏与详情浮层共用一份口径）· 覆盖率实况条（真算）·
1 个/0 个的体面态 · 项目详情浮层的未知态改造。

**没做**（PRD G9 明确不做）：里程碑、成员历史时间线 —— 我们没有这两样数据。
**没抄**：她的 `?highlight=id`（死链）；5 张 KPI 指标条（有意不对齐，等 feat-066/067）。

**改动文件**（本条自己的，共 9 个）：
`src/lite2/screens/ProjectsScreen.tsx`（新）· `src/lite2/projectView.ts`（新）·
`src/lite2/routes.ts` · `src/lite2/Lite2App.tsx` · `src/lite2/LiteTopbar.tsx` ·
`src/lite2/DetailOverlay.tsx` · `src/lite2/styles/lite2.css` ·
`src/shared/i18n/en.ts` · `src/shared/i18n/zh.ts`

---

## 5 · 交接给集成方 / Notes

1. 🔴 **`scripts/gates/live-frontend-gate.snippet.js:1300` 必须更新**：`assertV2Boots` 硬编码
   7 个 tab 的标签数组与 `tabs.length === 7`，本条加了第 8 个（「项目」，位置在「你的团队」之后）。
   **feat-057 的 `home` tab 会撞同一行** —— 本条刻意不改，请集成方一次性把期望值更新成最终 tab 表。
2. 🔴 **合并冲突面**：`routes.ts`（`LiteScreen` / `SCREEN_PATH` / `screenFromPathname`）、
   `Lite2App.tsx`（`SCREEN_COMPONENT` + Route 列表）、**`LiteTopbar.tsx`（tab 数组，第三个撞点，
   kickoff 只点了前两个）**、`i18n/{en,zh}.ts`。本条全部走末尾追加，取并集即可。
3. `lite2.css` 的花括号修复（§2）**顺带救活了 feat-053 的整套账号入口样式** —— 那条线的人可以确认一下
   自己的样式此前从未真正生效过。
4. **本条不修、只记录**（都在 kickoff 的「别当成你的 bug」名单或本条范围外）：
   - 跨文档中文人名去重失效（issue #10）：项目屏会跟着重复的人名走，属后端问题。
   - 离线 heuristic 每篇文档只吐 1 个项目：本屏已按「1 个是常态」设计，并给出粒度说明文案。
   - `store.refreshFiles()` 对畸形 `files` payload 无防御（`files` 非数组时 `UploadPanel` 直接崩）。
     我用错误 mock 撞到过，属契约违例输入，非本条范围。
   - 后端 briefing 首屏摘要仍是英文（已单开任务）。

---

## 6 · 复核返工轮（第二次收工）

复核 verdict = `pass`，但带 1 条 major + 1 条 minor。**两条都修了，没有 skip。**

### 6.1 [major] `scripts/gates/live-frontend-gate.snippet.js:1307` —— v2Boots 相位必红

**判定**：复核者说得对，我第一轮的推迟是错的取舍。理由：`live-frontend-gate` 不在本条的
三门里，但这个仓库「合进 main = 自动上生产」，把一个**已知必红**的门留给别人，等于把风险
挪了个位置而不是消掉。跟 feat-057 的冲突是一行数组的取并集，比一个红门便宜。

**改法**：把 `expected` 更新成最终 8 项 tab 表，并把 `tabs.length === 7` 改成
`tabs.length === expected.length`（数量不再单独硬编码，只留数组一处真相）：

```js
const expected = ['Your team', 'Projects', 'The room', 'Follow-ups', "Avery's notes",
                  'A closer look', 'Playbooks', 'Where this goes'];
pass: !!shell && tabs.length === expected.length && JSON.stringify(tabs) === JSON.stringify(expected),
```

顺带修了 `scripts/gates/live-frontend-gate.md:149` 的驱动说明（原文还写着「6 个 tab」，
连 feat-047 的第 7 个都没跟上）。两处都加了醒目注释：**动 `LiteTopbar.tsx` 的 tab 必须
同一个 commit 同步这个数组**。

**真验**（起本地 dev 5055，playwright 注入真 snippet 调真相位，不是读代码推断）：

```
PASS  v2Boots phase GREEN (was the major finding)
      {"shellPresent":true,"dataScene":"team","tabCount":8,
       "tabLabels":["Your team","Projects","The room","Follow-ups","Avery's notes",
                    "A closer look","Playbooks","Where this goes"],
       "tabOrderMatches":true,"pass":true}
```

英文标签是对的：`useDict` 的 `resolveLocale()` 默认 EN，门的 URL 不带 `?lang=`。

### 6.2 [minor] 第 8 个 tab 把顶栏挤出 390px 视口

**判定**：复核者的量化我复现了，一模一样。但根因不是「项目」这个 tab —— 是 `.scene-tabs`
这一行**本身没有滚动容器**，溢出直接撑 documentElement。7 个恰好不溢出只是巧合。

**改法**（`src/lite2/styles/lite2.css` 末尾追加，只作用于 `.lite2-shell` 内）：把溢出关进
tab 条自己 —— `max-width:100% / min-width:0 / overflow-x:auto`，tab 加 `flex:0 0 auto` +
`white-space:nowrap`（宁可滑，不许把「你的团队」挤成两行），滚动条隐藏。
**没动 `src/shared/styles/00-base.css` 的 `.scene-tabs`** —— 那条同时供 v01 / story 用，
是冻结面。feat-057 再加第 9 个 tab 时这条同样兜得住，不必再改。

**真验**（同一页面，把新规则用 `!important` 中和掉复现修复前几何）：

```
lang=zh  doc h-overflow WITHOUT the fix = 9px    |  WITH the fix = 0px
lang=en  doc h-overflow WITHOUT the fix = 119px  |  WITH the fix = 0px
```

9px / 119px 与复核者实测逐字吻合。修后两种语言下 `documentElement` 与 `body` 横向溢出
均为 0，溢出改由 tab 条内部承载（`stripOverflowX:"auto"`、`stripScrolls:true`），
8 个 tab 高度全为 36px（无一个换行），滚到最右点最后一个 tab 仍可用 → 落 `/vision`。

桌面 1440 下**观感零变化**：文档不溢出、tab 条不滚动、`.scene-tabs` 的
`background rgba(255,253,248,0.78)` / `box-shadow` / `backdrop-filter blur(12px)` 原样
（`skinVerdict` 的 `readSkinProbe` 读的正是这三个值，不受影响）。

### 6.3 本轮真验清单（23/23 全过）

playwright 脚本在 scratchpad，**未入库**。除上面两条外还跑了回归：

| 断言 | 结果 |
|---|---|
| snippet 注入成功、v2Boots 无 pageerror | ✅ |
| zh 顶栏 8 个 tab、「项目」在 index 1 | ✅ `["你的团队","项目","议事室","跟进","Avery 的笔记","多看一眼","操作手册","未来方向"]` |
| 入口直链 4 个 query 参数在 `/projects` 上不丢、切屏后仍不丢 | ✅ |
| 点项目卡 → `/projects/pr_pilot`；Esc 关闭 → 回 `/projects`（不是 `/team`） | ✅ |
| 项目流程零 pageerror | ✅ |
| `look=paper` / `look=aurora` 各自 8 tab、`data-look` 正确、零横向溢出 | ✅ |
| 390px zh/en：文档零溢出、tab 条内滚、无换行、最后一个 tab 可点 | ✅ |

顺带独立复证了 0 个项目的诚实空态：无 contextId 时 `.lite-projects-empty` 出现、
`.lite-projects-group` 与 `.lite-projects-grid` 各 0 个（**无骨架卡**），文案是
「还没有项目 / 去「你的团队」上传一份项目计划、周报或进度汇总…」。

⚠️ 踩到的坑，记给后来人：`createStubTransport()` 的 `ingested` 标志活在**单次页面加载的
闭包里**，`injectSeeds` 之后再 `page.goto()` 硬刷新会把 context 丢掉（`fetchTeam` 抛 404）。
要在 stub 下测有数据的屏，必须**点 tab 走站内路由**，不能重新导航。

### 6.4 三道硬门（本轮改动后重跑）

```
$ npm run typecheck
> tsc -b
（无输出，0 错）

$ npm run build
✓ 564 modules transformed.
dist/assets/index-T8X9aADC.css   199.10 kB │ gzip:  29.97 kB
dist/assets/index-DE8LxKQ6.js    951.34 kB │ gzip: 293.43 kB
✓ built in 3.33s
（CSS 从 198.85 → 199.10 kB = 本轮那段 tab 条 CSS；仍无 unbalanced-brace 警告）

$ npm run lint
✖ 5 problems (0 errors, 5 warnings)
（同一批既有 warning：OnboardWizard.tsx:86 / RoomScreen.tsx:265 /
  useRailCamera.ts:120,133,148 —— 全在本分支未改动的文件里，本轮零新增）
```

**后端 pytest 本轮同样未跑**：本轮改动是 1 个 gate snippet + 1 个 gate 文档 + 1 段 CSS，
零后端改动。

### 6.5 本轮改动文件（4 个）

- `scripts/gates/live-frontend-gate.snippet.js` —— `assertV2Boots` 期望值 7 → 8 项
- `scripts/gates/live-frontend-gate.md` —— 驱动说明里的 tab 表同步（原来还停在 6 个）
- `src/lite2/styles/lite2.css` —— 末尾追加 lite2 内 tab 条溢出兜底
- `src/lite2/LiteTopbar.tsx` —— 只改注释：原注释写着「本条不改门」，已过时；换成「动这个数组
  必须同一 commit 同步 gate 的期望数组」的硬提醒（零代码改动）

### 6.6 给集成方（§5 第 1 条已解决，其余不变）

- ✅ §5.1 的 gate 动作**本条已经做了**，集成方不必再动 —— 但 **feat-057 加 `home` tab 时
  必须同步 `live-frontend-gate.snippet.js` 的 `expected` 数组**，否则 v2Boots 会红。
  数组现在是那个门里唯一的 tab 真相源，注释已就地写明。
- 合并冲突面新增一处：`scripts/gates/live-frontend-gate.snippet.js` 的 `expected` 行
  （和 `LiteTopbar.tsx` 的 tab 数组一一对应，取并集时两处要一起改）。
