# feat-057 · 聚合首屏 +「今天要决策的」 — 交接

分支 `feat/057-home-aggregate` · 工作树 `D:\avery-wt\057` · PRD G4 / kickoff-dev.md §feat-057
状态：**done**（三门绿 + 真机端到端验过，证据见下）

---

## 0 · 我接手的是什么（WIP 复核结论）

上一轮 workflow 在实现阶段被杀，留下 `e6fb94f wip(057)` 一条**未经任何门验证**的提交
（7 个文件、727 行）。我逐处核实后的结论：

### 对的（保留，未改行为）
| 文件 | 判定 |
|---|---|
| `src/lite2/homeDerive.ts` | **对**。纯函数、零随机、零硬编码；`summarizeDecisions` 不重排（只按 severity 给 bucket 排序，卡片顺序照吃后端数组）；`deriveAttentionPeople` 的口径与 kickoff 一致（关联 blockers + signals 提及），且刻意不做前端去重、不把「是 owner」算成「被提到」。类型与 `transport.ts` 逐字段对得上。 |
| `src/lite2/screens/HomeScreen.tsx` 的结构与文案 | **对**。四块齐、每块一扇门、`unknown_fields` 与 `unparsed_fields` 措辞分开、`decisions===undefined` 与 `length===0` 两种空态分开、grade_label 取自 payload 不自拟、机器键只进 `data-` 属性。 |
| `routes.ts` / `Lite2App.tsx` 的追加 | **对**。`home` 追加在联合类型与 `SCREEN_PATH` 末尾，既有条目一条没动；`RedirectToDefault` 改读 `DEFAULT_SCREEN` 而不是再写死一个屏名。 |
| `zh.ts` / `en.ts` 文案 | **对**。中文直接定稿、无「待审」；无任何写死的统计句。 |

### 错的 / 缺的（我改了）
1. 🔴 **整屏没有一行 CSS**（最大问题）。WIP 写了 40 多个 `.lite-home-*` 类名，
   `src/lite2/styles/*.css` 里**一个都不存在** —— 屏幕是一堆无样式裸 DOM。
   已补 554 行（见 §2）。这一条 WIP 作者显然没在浏览器里看过。
2. 🔴 **`skin` 旧术语残留**：`Lite2App.tsx` 两处注释仍写 `?v=2&mode=live&skin=paper&lang=zh`
   （改名是在 WIP 之后落地的）。已改 `look=`。
3. **React key 会撞**：`key={subject_type_subject_id}` / `key={person.id}`。跨文档去重当前是坏的
   （后端 issue #10），同一 id 可能出现两遍 → 撞键会让 React 复用错节点（A 卡的展开态串到 B 卡）。
   已改成带下标的 key。**刻意不在前端去重**——那会把后端 bug 藏起来。
4. **`homeDecisionEvidenceLabel` 定义了没用**：规则证据直接裸列，读者分不清那几行是文档原文
   还是 Avery 的话。已在证据块上方挂上「文件原文」标签。
5. **live 门会假红**（WIP 没意识到）：改默认落点 + 加 tab 打破了 `assertV2Boots` 的 7-tab 断言，
   且 `injectSeeds` 会在新落点上永远等不到 `.upload-ready`。已修，见 §3。
6. **验收标准一条都没验过**。已全部真机验证，见 §4。

---

## 1 · 做了什么

聚合入口屏 `home` / `/home`，四块摘要、每块一扇门，**7 个分屏一个都没退休**
（decisions.md Q2「两个都极端 → 结合」）。

① **今天要决策的**（本条核心）
- 直接吃 `/team/{id}` 的 `decisions[]`，**按后端数组顺序渲染，前端零 sort**
  （排序口径属后端，前端重排会和 `decision_grading_rules.md` 对不上）。
- 分级计数条的 label 取自 payload 的 `grade_label`，前端不硬编码「高风险/需确认/可推进」。
- 「凭什么这么判」展开 → 逐条列 `rule_id` / `title` / `basis` / **原文证据**（verbatim，带「文件原文」标签）。
- `unknown_fields` → 「文档未提及：进度」；`unparsed_fields` → 「到期日写的是「月底前」，无法确定具体值。」
  🔴 两套措辞永不混用，后者把**原文摆出来**。
- `decisions` 键缺席（pre-056 老后端）→ 「这份数据里没带决策定级」，明说是哪种空，
  **绝不说成「今天没事」**，也不造一条假决策。
- 出口：「打开项目」→ 项目详情浮层；「带进议事室」→ `/room?q=…` 预填 composer（不自动提交）。

② **差距摘要** → 多看一眼（复用 `gapDerive` 已有的 verbatim blocker 原句，只列前三条）
③ **需关注的人** → 你的团队（口径写在脸上，见 §5）
④ **Avery 手上有什么** → 五个真计数，各自点进对应屏

---

## 2 · 改了哪些文件

| 文件 | 改动 |
|---|---|
| `src/lite2/styles/lite2.css` | **+554 行**：`.lite-home-*` 全套样式（WIP 完全没写）。只消费令牌，**零 `[data-look]` 分支**，两种 Look 自动跟随。 |
| `src/lite2/screens/HomeScreen.tsx` | key 防撞（issue #10）× 2 处；证据块补「文件原文」标签。 |
| `src/lite2/Lite2App.tsx` | 两处注释 `skin=` → `look=`。 |
| `scripts/gates/live-frontend-gate.snippet.js` | `assertV2Boots` 7 tab → 8 tab；`injectSeeds` 在 v02 下先切到「你的团队」再上传（否则必假红，见 §3）。 |
| `scripts/gates/live-frontend-gate.md` | 同步 v2Boots 的 tab 契约描述。 |

WIP 已提交的 7 个文件（`homeDerive.ts` / `HomeScreen.tsx` 主体 / `routes.ts` / `LiteTopbar.tsx` /
`zh.ts` / `en.ts` / `Lite2App.tsx` 路由追加）行为保留。

### 🔴 CSS 插入位置：不是文件末尾，是 3418 行

追加到 EOF 的第一版**完全不生效**，浏览器里 `getComputedStyle` 全是默认值。
查出来的原因是一个**既有 bug**（在 main 上，不是我引入的）：

```
src/lite2/styles/lite2.css:3418(原)  @media (prefers-reduced-motion: reduce) {
    ... 两条 animation:none 规则 ...
    /* ── feat-053 账号入口 ── */      ← 少了一个 }
    .lite2-shell .lite-auth { ... }
    （一直到 EOF）
```

原文件 470 个 `{` / 469 个 `}`。这个未闭合的 media block 把**从 3418 行到文件末尾的一切**
都关进了 `prefers-reduced-motion: reduce` 里。`npm run build` 早就在 warning 里点过名
（`12975 │ @media (prefers-reduced-motion: reduce) {`），没人接。

处理：**我的块插在未闭合 media 之前（现 3418 行），不修那个花括号**。
理由——修它会让 feat-053 的账号面板样式从"只在 reduced-motion 下生效"变成"一直生效"，
那是**别人那条线的线上外观变更**，不在我这条的范围内，我也没法替它签字。
已记进 §Notes 并在 risks 里点名。

---

## 3 · live 门为什么必须改（不是我图省事）

`assertV2Boots` 硬断言**恰好 7 个 tab 且标签顺序逐字相等**。feat-057 前置了「Today」
→ 8 个。**这是契约真的变了**（Danny 拍板"聚合做入口"），不是回归：
7 个分屏一个没少、顺序一字没动，只是前面多了一扇门。注释里已写明
「若未来某条线**减少**了那 7 个中的任何一个，那是回归，不是契约更新」。

`injectSeeds` 更隐蔽：它 poll `.upload-ready`。新落点 `/home` 的**空态**确实挂着 UploadPanel，
所以上传能发出去；但 ingest 一成功 `team` 就非空，Home 切到摘要布局、**面板连同
`.upload-ready` 一起卸载** → poll 空等 360 秒假红。已改成在 v02 下先切「你的团队」
（那一屏两个分支都渲染 UploadPanel）再上传，并用 `$('.lite2-shell')` 兜住，v01 相位零影响。

---

## 4 · 验收怎么过的

### 三道硬门（`D:\avery-wt\057` 下，真实输出）

```
$ npm run typecheck
> tsc -b
（无输出 = 0 错）

$ npm run lint
✖ 5 problems (0 errors, 5 warnings)
（5 条 warning 全是既有的 eslint-disable/noInlineConfig 提示，在
 OnboardWizard/RoomScreen/story 里，与本条无关）

$ npm run build
✓ built in 4.16s
```

后端一行没碰（`git status` 只有 5 个文件，全在 `src/lite2/**` 与 `scripts/gates/**`），
仍跑了一遍 `python -m pytest eval-harness/tests/ -q` 作保险，结果见本节末。

### 真机端到端（本地后端 + 本地前端，**没打生产**）

```
后端  cd eval-harness && AVERY_CORS_ORIGINS=http://127.0.0.1:5057 AVERY_BRAIN=stub \
      python -m uvicorn service.app:app --port 8057
前端  VITE_AVERY_API_BASE=http://127.0.0.1:8057 npx vite --port 5057 --host 127.0.0.1
语料  eval-harness/tests/fixtures/cjk/Sanya_Team_Roster_ZH.md（真中文花名册，7 人）
      + 一份现编的中文周报（3 个项目，含 `截止：月底前` 用来逼出 unparsed_fields）
驱动  playwright（仓里已装），58 条断言，全绿
```

收工时两个端口都已停并确认释放（`Get-NetTCPConnection -LocalPort 5057,8057` → 无结果）。

真实回包（`/team/{id}`）：`people 7 · projects 3 · decisions 3 · severities [3,3,2]`

**逐条验收：**

| 验收项 | 结果 |
|---|---|
| 每个数字都能追到真数据 | ✅ 屏上 5 个概览数与回包对账：人 7=7 / 项目 3=3 / 文件 2=真上传 2 份 / 笔记 0 / 待跟进 0；决策计数「共 3 条」=`decisions.length`；差距「1 处待看」=`selectGapsActive` 真长度；关注 3 人 = 名下真有 blocker 的 3 个 owner，一个不多一个不少 |
| 按 severity 展示、不重排 | ✅ UI severity 序列 `[3,3,2]` == API `[3,3,2]`（逐位相等） |
| 展开看到命中规则与原文证据 | ✅ `R-STATUS-BLOCKED / R-OVERDUE / R-DUE-VS-PROGRESS / R-BLOCKER-ONE / R-PROGRESS-LOW`，证据 `status="blocked"` `dueDate="2026-07-01"（已过 17 天）` `预算未批` 等原样显示；`aria-expanded` 真翻转 |
| unparsed 显示原文、不说成「文档未提及」 | ✅ 屏上「到期日写的是「月底前」，无法确定具体值。」；同一屏的「文档未提及」只挂着**进度**（那个确实没写） |
| decisions 键缺席有诚实空态 | ✅ 网络层删掉 `decisions` 键（模拟 pre-056 后端）→ 出「这份数据里没带决策定级」，其余三块照常渲染、零假卡、**不说「今天没有要你定夺的事」** |
| 四块都能点进对应分屏 | ✅ 议事室→`/room` · 多看一眼→`/closer-look` · 你的团队→`/team` · 概览格→`/team` `/notes` `/followups`；「带进议事室」真预填 composer 且不自动提交 |
| 两种 Look 都正常 | ✅ paper / aurora 各截两张（首屏 + 展开态）；aurora 下新 CSS 吃到它自己的令牌（`border-radius` 10px 而非 paper 的 8px，语气色变蓝/红系），**零 `[data-look]` 分支** |
| 入口直链五参不丢 | ✅ `?v=2&mode=live&look=paper&lang=zh` → 落 `/home`，v/mode/look/lang 逐个断言仍在；点完每一扇门后再断言一次，仍在 |
| 刷新还在（feat-050） | ✅ 整页重载 → 仍落 `/home`、3 张决策卡回来、contextId 在 localStorage |
| 8 tab、7 个分屏没退休 | ✅ `["今天","你的团队","议事室","跟进","Avery 的笔记","多看一眼","操作手册","未来方向"]` |
| 锁定词表 | ✅ 首屏全文无 `Nexus` / `现实差距` / `指挥室`；无参考库那句 `186 条` |
| 控制台 | ✅ 整轮 0 error、0 pageerror |

**「被信号提到」这条路的诚实说明**：本地离线 heuristic 抽取 `signals` 恒为 0，
这条分支在本地跑不出真数据。我用 playwright 在**网络层**往 `/team` 回包里灌了一个
真实形状的 `signals[]`（一条 `subjectType==='person'` 直接命中 + 一条正文写了名字 +
一条与谁都无关），验证：命中计为 2 条、无关那条不算在任何人头上、证据是信号原句。
🔴 这是**验证手段**，不是产品数据——`homeDerive` 仍然只从 payload 数数，仓里没有任何假 signals。

### 后端测试（本条未改后端任何文件，跑一遍作保险）
```
$ python -m pytest eval-harness/tests/ -q
2953 passed, 61 skipped, 4 xfailed in 26.96s
```
与基线 **2953 passed / 0 failed / 4 xfailed** 逐项相等，没跑红。

---

## 5 · 我自己定的两个产品判断

### ① `/` 的默认落点从 `/team` 改成 `/home`（改了）
Danny 拍板"聚合做**入口**"。一个只能靠手改 URL 才到得了的屏不叫入口，
排在 tab 末尾的入口也不叫入口——所以既改落点，也把「今天」放在 tab 第一位。
代价评过：
- 首访者第一眼是空摘要？→ **不会**。`team===null` 时首屏走空态分支，自带 UploadPanel +
  「花名册/周报/隐私」三条提示，和原来 `/team` 的空态是同一套骨架。
- 深链坏掉？→ **不会**。`RedirectToDefault` 原样转发 search+hash，五参数真机逐个断言过。
- `/team` 本身？→ **一个字没动**，深链、后退、粘性 query 行为全不变。
- 唯一真实代价是 live 门的两处协议，已在 §3 一并修好。

### ②「需关注的人」的口径（本波先用可得信号）
参考库用 `load>=90 / sentiment=strained`——**这两个字段我们一个都没有**，也不许凭空造。
本波只数手上真有的两件事：**被几条 signals 提到** + **名下项目挂着几条 blockers**。
界面上把口径写死在脸上（「数的是文件里提到的次数，不是对任何人的评价。」
+ 每行「出现在 N 条信号里 · 名下项目挂着 N 条卡点」+ 一句原文证据）——
名单不可解释就不敢给人看。feat-066/067 落地后换真口径。

刻意**不**把「她是这个项目的 owner」算成「信号提到她」——那是替文件说话，
会把一句关于项目的话变成一条指向人的记录。
名字命中只认 ≥2 字符的名字（单字名在中文里必然假阳性）。

---

## 6 · 没做什么

- 她的 **5 张 KPI 指标条**：kickoff 明确不做（feat-066/067），**有意不对齐**，不是遗漏。
- **人卡分数血条**：本屏结构上不渲染任何分数/百分比/排名位次。
- **前端去重**：跨文档人名重复（issue #10）**故意保留可见**，只做了 key 防撞。
- **不修** `lite2.css` 那个未闭合花括号（见 §2 理由）。
- 前端**没有单测框架**，按铁律没去装；验证靠 playwright 真机脚本（脚本在 scratchpad，未入库）。

## 7 · Notes（顺手发现，**没修**）

1. 🔴 **`src/lite2/styles/lite2.css` 花括号未闭合**（既有，来自 feat-053）：
   `@media (prefers-reduced-motion: reduce)` 缺一个 `}`，把 feat-053 的账号入口样式
   （`.lite-auth-*` 一整段）关进了 reduced-motion 里 —— **那套样式在普通用户机器上根本不生效**。
   `npm run build` 一直在 warning 里点名。**任何往 lite2.css 末尾追加 CSS 的线都会踩这个坑**
   （我踩了，浪费了一轮排查）。建议单开一条修，修的时候要顺带看一眼账号面板的真实外观。
2. 本地 `AVERY_BRAIN=stub` 下 `signals` 恒为 0、`extraction_mode` 走 heuristic 每篇文档
   只吐 1 个项目（已知，已单开任务）——我的现编周报能吐 3 个项目是因为它用了
   `项目：/负责人：/状态：/进度：/截止：/阻塞：` 的规整字段格式。
3. `AttentionRow` 的姓名+职位是两个相邻 span，`innerText` 会连成「陈思雨销售主管」；
   视觉上有 7px flex gap，截图确认正常。断言脚本里用 `startsWith` 处理。

## 8 · 遗留

- `homeAttentionWhySignals` 这条路只在拦包造形状时验过（本地抽不出 signals）。
  接真 LLM key 的环境跑一次会更硬。
- 首屏在 `max-width: 720px` 以下并排两块会折成单列（已写 media query），
  但**没在真手机上看过**——只在 1280×900 桌面视口验证。
