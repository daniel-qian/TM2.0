# feat-059 · 议事室简化输出 —— 收工记录

分支 `feat/059-room-simplified` · 工作树 `D:\avery-wt\059` · 2026-07-18

对应 PRD **G7**（P0，Danny 点名）/ kickoff-dev.md「feat-059」。
⚠️ 净新增：核实过合伙人版**全库无折叠控件**，她的推理链永远全展开。这不是照抄，是把
她那 4 步手写轨迹的**形状**，套在我们真事件流的**实质**上。

## 做了什么

`LiteTerminal` 原来把每条流事件逐行原样打（`read_case` / `recall query=…` / 整份
`facts.md` 转储 / `cite` / `draft_advice`，英文脚手架 + 中文事实混排）。现在：

1. **默认简化视图**：四相叙事（读取事实 / 交叉验证 / 匹配方法 / 生成动作），
   推进**完全由真 SSE 事件驱动**。
2. **「展开原始流」开关**：展开后原始终端一行不少、一字不改（同一份 DOM 渲染逻辑）。
3. **真引用以人话保留**：交叉验证相位挂「依据 N 条原文」，点开是真 `facts.md:NNN`
   + 模型自己写的 claim + 后端 `resolve_ref` 取回的原文行。

### 四相怎么由真事件驱动的（映射表）

事件全集核实自 `src/lite2/transport.ts::LiveAgentEventType` 与
`eval-harness/avery/tools.py::TOOL_SCHEMAS`（后端就 4 个工具），不是照我自己猜的。

| 真事件 | 归相 |
|---|---|
| `tool read_case` + 其 `observe` | 读取事实 |
| `tool recall` / `tool cite` + 各自 `observe` | 交叉验证 |
| `think`（**证据已开始收之后**）、`nudge` | 匹配方法 |
| `tool draft_advice` + `observe`、`manifest` | 生成动作 |
| `think`（证据还没开始收） | 读取事实（就是在读题） |
| `started` | **不点亮任何相位**（"开始了"≠"读过了"） |

**诚实性设计（对应"绝不造节奏"那条红线）**：

- 相位状态**纯由 steps 派生**，代码里没有任何计时器 / 进度变量可调：
  `steps===0 → pending`（诚实灰着「还没走到这一步」）；不是最靠后的有事件相位 → `done`；
  最靠后的 → **只有 run 真 `complete` 才 done**，否则 `active`（error 时也保持 active，
  它确实没跑完，不谎称跑完）。
- 副文案只报**真计数**：读了 N 份原始材料（`read_case` 的 observe）、翻出 N 条记录
  （`recall` 观察串里符合 `memory.py::Hit.as_line` 形状的行）、走了 N 步。
- **匹配方法没有专属工具**（后端今天没有 playbook 匹配工具），所以它只由
  think-after-evidence + `nudge` 驱动；两者都没有就**停在 pending**。这是刻意的，
  不是漏做——见下面「遗留 / 判断留痕」。
- 引用取不回原文就 `snippet=null` 不显；`⚠ …does not resolve…` 的引用显式标
  「没对上真实的原文行」，不装作有依据。

### 改了哪些文件

- `src/lite2/streamSource.ts` —— 新增 `LitePhaseId/LitePhase/LiteCitation` 类型、
  `LiveRunState` 增 `phases/citations/sourcesRead/recallHits/pendingTool`，
  `applyEvent` 里加派生（**原有 push 行为一字未改**，所以原始流天然一行不少）。
- `src/lite2/screens/RoomScreen.tsx` —— `LiteTerminal` 拆成 `RawStreamLog`（原样）
  + `LiteThinkingFlow`（简化视图 + 开关）。
- `src/lite2/styles/lite2.css` —— 新样式全 scope 在 `.lite2-shell`；
  简化态换成产品浅色面（`.nexus-terminal` 那块深色「机房」正是要收起来的开发视角），
  展开原始流时深色终端原样回来。**v01 与 story 的终端一像素未动**。
- `src/shared/i18n/en.ts` / `zh.ts` —— 17 个新键（EN 是锁定默认，ZH 走 `?lang=zh`/构建期
  env，所以文案必须两边都给，不能硬编码中文）。

## 验收怎么过的

### 硬门

| 命令 | 结果 |
|---|---|
| `npm run typecheck` | 通过，零错（首轮报 5 处 `LiteRunState` 笔误，已修后复跑干净） |
| `npm run build` | 通过，`✓ built in 2.69s`（>500kB chunk 警告是既有的，非本次引入） |
| `npm run lint` | **0 errors**，5 warnings 全部既有（`noInlineConfig` 提示，含 story/OnboardWizard） |

后端未改（只动 `src/lite2/**` + `src/shared/i18n/**`），故未跑 pytest。

### 派生逻辑：33 条断言全过

`applyEvent` 是纯函数，用 esbuild 转出后在 node 里灌真事件序列跑断言
（脚本在 scratchpad，非仓库文件）。事件形状取自 `brain.py` 的 plan 与
`tools.py`/`memory.py` 的真观察串格式，**不是我编的形状**：

- A 真后端序列（read_case→recall→cite×2→draft_advice）：四相全亮；`sourcesRead=1`；
  `recallHits=3`；引用 2 条，其一 resolved 带回原文、其二诚实标未对上；
  原始流 14 行 = 15 事件 − 1（`started` 不产行）；
  **简化视图字段里 `read_case`/`recall query=`/`draft_advice`/`case_id=`/`source_ref=`
  与 facts.md 转储全部为 0 命中，同时 `facts.md:15` 仍在**（证据没丢）。
- B stub 序列（无 cite/read_case）：`sourcesRead=0`、`recallHits=0`、`citations=[]`——
  没有就是没有，不编。
- C 缺事件：crosscheck/method 停 `pending` 且 `steps=0`，不补成 done。
- D 只有 `started`：四相全 pending、零终端行（不抢跑）。
- E 迟到事件：不把叙事拉回第一相；没发生的仍 pending；未 complete 的末相保持 `active`。

### 真浏览器跑通（dev server :5059，用完已停，端口已确认释放）

`?v=2&mode=live&transport=stub&lang=zh` → 议事室 → 点建议问题 chip：

- 运行中截到的中间态：`读取事实 走了1步 / 交叉验证 走了2步 / 匹配方法▌走了1步 /
  生成动作 **还没走到这一步**` —— 第四相诚实没亮，光标在真正在跑的那一相。
- 跑完：四相 `data-phase-status` 全 `done`，末相文案「结论已经出来了」。
- **简化态 DOM 里根本没有原始流节点**（`hasRawLog:false`）——脚手架不是被 CSS 藏了，
  是压根没渲染。扫 `read_case|recall query=|cite |draft_advice|case_id=|source_ref=|facts.md`
  → 0 命中。
- 点「展开原始流」→ 6 条终端行全在（stub 7 事件 − `started`），
  `AVERY recall query=pilot launch date fixtures vendor` 等脚手架原样可见 → 一行不少。
- 计算样式核对对比度：面 `rgb(255,253,248)` / 正文 `rgb(29,27,23)`，浅色覆盖生效，
  没有出现深底深字看不见的情况。
- 锁定词表核对：导航为 `你的团队 / 议事室 / 跟进 / Avery 的笔记 / 多看一眼 / 操作手册 /
  未来方向` —— 无 Nexus / 现实差距 / 指挥室。

### 中途真抓到一个 bug（已修，留痕）

浏览器里跑出来的第一版：`交叉验证 走了2步 / 匹配方法 走了3步` —— 不对。
原因：早期实现按「当前游标」记步，而真实序列是 recall → **think** → cite，
那条 think 先把游标推到 method，随后的 `cite`（明明是交叉验证）就被记进了匹配方法。
**修法**：计步改为永远记在**事件自己那一相**上，相位状态另由 steps 单调派生
（`countStep` / `refreshPhases`）。修完浏览器复验：`交叉验证 走了4步 / 匹配方法 走了1步`，
并补了两条断言（`crosscheck.steps===6` / `method.steps===2`）锁住这个回归。

> 这个 bug 只有真的把 UI 跑起来才看得见——typecheck 和 build 都是绿的。

引用展开面也是真浏览器验的（临时给 stub 加了一对 cite 事件验完 UI，
**已逐字还原**，`git diff --exit-code src/lite2/stubTransport.ts` 确认与 HEAD 一致）：
展开后显示 `facts.md:15 / claim / 原文行`。

## 没做什么（守边界）

- **没碰最终建议卡（`LiteAdviceCard`）和「Avery 的笔记」** —— 按 kickoff 明示，
  那两处已是干净中文，脏的只有实时思考流。
- 没碰 `src/lite/**`（v01）、`src/story/**`、`eval-harness/**`。
- 没碰 `package.json` / `feature_list.json` / 根 `progress.md` / 根 `session-handoff.md`。
- 没装任何包（本条不需要新依赖）。
- 没做 feat-063 的对话视图（那是 P1 另一条线，虽然它"依赖 059 较好"——
  `LiteThinkingFlow` 已经是自洽组件，063 可直接复用，见下）。

## 给集成方 / 下游的话

- **对 063 的复用面**：`LiteThinkingFlow({ run, running })` 只吃 `LiveRunState`，
  与画布无耦合，对话视图可直接挂同一个组件。四相派生全在 `streamSource.ts`，
  不在组件里。
- **合并冲突面**：`src/shared/i18n/en.ts` 与 `zh.ts` 是多线共改文件（我在 lite2 段
  `roomChipPlanning` 之后追加了一块），大概率要手工并。`zh.ts` 头部注明是
  `scripts/i18n-zh-lite2-delta.mjs` 生成物——我这 17 个键是**手写定稿**追加的，
  如果之后重跑生成器，需要把这块并回生成器的 sharedKeys，否则会被冲掉。
- `LiveRunState` 加了 5 个字段。lite2 侧消费者只有 `store.ts` 和 `RoomScreen.tsx`
  （已核实），均为增量安全；但**若有门/测试对 `emptyRunState()` 做全等断言，会需要更新**。
- 新增的稳定 DOM 钩子供门用：`[data-flow-toggle]`、`[data-cites-toggle]`、
  `[data-raw-stream]`、`.lite-flow-phase[data-phase-id][data-phase-status]`。

## 遗留 / 判断留痕（请复核者看一眼）

1. **「匹配方法」是四相里唯一没有专属真事件源的相位**。后端今天只有 4 个工具，
   没有"匹配 playbook"这一步（那是 feat-064 的事）。我把它接在
   think-after-evidence + `nudge` 上，并让它在无事件时停 pending。
   这是我在"保住 Danny 拍板的四相形状"和"绝不造假事件"之间做的取舍——
   **如果复核者认为这仍属过度解释，正确的收敛是把该相位改成永远由 064 的真工具驱动**，
   在此之前它多数时候会亮（think 事件几乎必有）。请示下。
2. `recallHits` 靠正则认 `memory.py::Hit.as_line` 的 `<file>:<line>␠␠<text>` 形状；
   后端若改这个格式，计数会静默变 0（不会显错数，只会少报）。已在代码注释里标明依赖。
3. 引用原文 snippet 从 `✓ cited: «…» ⟵ ref  (原文)` 里按最后一对括号取；
   原文本身含括号时可能截偏一点。取不到就 null 不显，不会显错的原文。
4. 简化视图**不显示 `think` 的原文**（模型自己的散文）。理由：EN 默认构建下模型可能
   吐中文、ZH 下可能吐英文，放进简化视图就等于把"英文脚手架"换个形式放回来。
   模型原话完整保留在原始流里。

### Notes（顺手看到、**没有修**，避免合并冲突）

- `src/lite2/screens/RoomScreen.tsx` 的空态 `aria-label="Working it through — ask your team"`
  与 `LiteAskComposer` 的 `aria-label="Ask your team"` / `"Live question"` 是**硬编码英文**，
  ZH 构建下读屏仍读英文。同类问题在 v01 也有。属 a11y/i18n 清扫，不在 059 范围。
- `.nexus-terminal` 系列样式在 `src/shared/styles/60-terminal.css`，被 story 与 lite/lite2
  三方共用；我用 `.lite2-shell` 覆盖而非改它，正是因为动它会波及 v01 与 story。
  若日后要统一，需单开一条线。

---

# 复核打回后的修复轮（2026-07-18，同分支追加）

复核判定 `needs-fix`：1 条 major + 3 条 minor。逐条处理如下。

## 修了（3 条）

### 1. major · `streamSource.ts::extractCiteSnippet` 把原文截断了

**复核者是对的，而且我上一轮的风险自述把后果说轻了。** 我在遗留第 3 条里写了
「原文本身含括号时可能截偏一点」，紧接着又写「取不到就 null 不显，不会显错的原文」——
**后半句是错的**。`lastIndexOf('(')` 落到原文内部的括号上时，`slice` 出的是一段
**残句**，`resolved` 仍是 `true`，于是引用面板把残句当逐字原文显示给经理。
不是"不显"，是"显错"。这正砸在这条 feature 的差异化卖点上（合伙人版全库零引用，
我们的实质就是真原文）。

- **修法**：解析锚在后端契约的确切形状上——`» ⟵ <ref>  (` 之后，贪婪吃到结尾最后一个 `)`：
  `/»\s+⟵\s+\S+\s+\(([\s\S]*)\)\s*$/`。ref 无空格、claim 由 `«»` 定界，所以锚点唯一；
  贪婪到末尾使嵌套/多组括号原样保留。形状对不上 → `null`（宁可不显，不显残缺原文）。
- **契约核实**：`grep -rn "cited:" eval-harness/ --include=*.py` 全仓**只有一处产出方**
  （`avery/tools.py:149`）。我用 python AST 取出 `_cite` 的那条 `return` 表达式**直接求值**
  （不是照抄字面量），得到：
  `✓ cited: «Pilot slips» ⟵ facts.md:15  (Phase 1 (Sanya) launch moved to Q3)`
  ——与复核者复现用的串逐字一致，作为验证输入。

### 2. minor · 一条裸 `think` 就把「读取事实」点亮成 done

复核者是对的：`memory.py::load_facts_head` 已把 facts.md 头部预载进上下文，
模型完全可以不调 `read_case` 直接 `recall`——此时经理看到「读取事实 ✓」，
**实际一份原始材料都没读回来**。这与本 feature 自己定的"没有对应事件的相位不亮"矛盾。

- **修法**：「读取事实」**只由 `read_case` 驱动**。证据还没开始收时的 `think`
  归不到任何一相，谁也不点亮（那条 think 在原始流里一行不少）。
  证据已开始收之后的 `think` 仍归「匹配方法」（未变）。
- **映射表更正**（覆盖本文档上半部分那张表的最后两行）：

  | 真事件 | 归相 |
  |---|---|
  | `think`（证据还没开始收） | ~~读取事实~~ → **不点亮任何相位** |
  | `started` | 不点亮任何相位（未变） |

### 3. minor · SSE 中途 error 时简化视图内无失败提示

复核者是对的：改动前那条 error 行打在**常驻可见**的终端里，现在它只进 `run.lines`，
而原始流默认是收起来的——面板里只剩一个不再前进、也没有光标的相位，
看不出是失败还是卡住。

- **修法**：`run.status === 'error'` 时在流面板内出一行明确失败态
  （新增 i18n 键 `roomFlowFailed`，`[data-flow-failed]` 供门断言 + `.lite-flow-failed` 样式）。
  ZH：「这一趟中途断了，没走完。展开原始流可以看到断在哪一步。」
  指向原始流看断点，不做假的"成功"态。

## 没修（1 条，理由如下）

### minor · `cite.claim` 是模型自由散文，可能与界面语言串台

**复核者的事实描述准确，但我不认为按同一口径处理是对的，所以留着并在此留痕。**

- 我排除 `think` 原文的理由是它是**长篇工程推理噪音**（"英文脚手架换个形式放回来"）。
  `cite.claim` 不是同一类东西：它是一个短句，在**两次点击之后**，且紧挨着真 `ref` + 真原文。
- 更关键的是：**同一个面板里的 `snippet` 本来就必然是源文件的原始语言**。
  瑞典建筑公司上传英文文档，中文界面下取回的原文行**就该是英文**——那是逐字证据，
  翻译它才是造假。既然 snippet 必然可能非界面语言，单独摘掉 claim 并不能消除混排，
  只会让引用失去含义（只剩 `facts.md:15` + 一行不知为何被引的原文）。
- 真正的收敛点在后端（advise 链路给模型加语言引导，`ask_api.py` 已有先例），
  那是 `eval-harness/**`，不在本条 feature 的改动面内。
  **建议单开一条线处理，不在 059 里顺手改后端。**

## 修复轮的验收（全部我自己跑的，输出如下）

| 命令 | 结果 |
|---|---|
| `npm run typecheck` | **零错**（`tsc -b` 无任何后续输出） |
| `npm run build` | **过**，`✓ built in 2.27s`；`index-CYy549ga.css 185.07 kB` / `index-DBu8aokD.js 680.26 kB │ gzip 219.38 kB`（>500kB 警告既有） |
| `npm run lint` | `✖ 5 problems (0 errors, 5 warnings)` —— 与复核者重跑的 5 条既有 warning 位置完全一致，本轮零新增 |
| pytest | **未跑**。本轮零后端改动（`git diff` 只有 5 个前端文件）；对后端的依赖是**只读契约核实**，已用上面的 AST 求值直接验证。 |

### 灌真事件的派生断言（node，esbuild 转出真 `applyEvent`，脚本在 scratchpad）

```
PASS  原文自身含半角括号（复核者复现的那条）
      got="Phase 1 (Sanya) launch moved to Q3"
PASS  原文以右括号结尾            got="Anna Lindqvist (PM)"
PASS  多组括号                    got="Q3 (revised) after review (2026)"
PASS  无括号的普通原文            got="Weekly sync moved to Tuesday"
PASS  中文原文含中文括号          got="一期（三亚）交付推到 Q3"
PASS  claim 自身含括号            got="launch moved to Q3"
PASS  形状对不上 → 不显（不编）   got=null
PASS  ⚠ 分支 resolved=false / snippet=null

--- 相位归属 ---
无 read_case: read:pending:0 | crosscheck:done:2 | method:done:1 | act:done:1 | sourcesRead=0 | lines=5
PASS  0 份材料时「读取事实」诚实停 pending
有 read_case: read:done:2 | crosscheck:done:2 | method:pending:0 | act:done:1 | sourcesRead=1
PASS  真读了材料时「读取事实」亮 done
中断: read:active:2 | crosscheck:pending:0 | method:pending:0 | act:pending:0 | status=error
PASS  error 落 status=error
PASS  原始流一行不少（stub 6 事件 → 5 行，started 不产行）
ALL PASS
```

### 真组件渲染断言（`renderToStaticMarkup`，真 `RoomScreen` + 真 zh 词典）

本轮**没能用真浏览器**：8 条并行线已把浏览器 tab 占满（`tabs_context` 显示
5050/5051/5052/5053/5151/5199/5252 都在别的线手里），关谁的 tab 都可能打断别人。
改用 SSR 渲染真组件替代（比读代码强，比真浏览器弱——**这一点如实说明**）：

```
PASS  error 时简化视图面板内出失败行节点（[data-flow-failed] 在 DOM 里）
PASS  error 失败行是中文人话「这一趟中途断了，没走完」（zh 词条生效）
PASS  有引用时出「依据 N 条原文」按钮
PASS  派生态里 snippet 是完整原文（括号未被截断）
PASS  非 error 时不出失败行
PASS  默认简化视图无英文脚手架 / 无 facts.md 转储（探针词表 0 命中）
ALL PASS

默认面板可见文案：
  它是怎么想明白的 / 展开原始流 / 1 读取事实 读了 1 份原始材料 /
  2 交叉验证 走了 2 步 依据 1 条原文 / 3 匹配方法 还没走到这一步 /
  4 生成动作 结论已经出来了
```

> dev server 起过一次（:5059）但因上述 tab 限制未用上，已停并确认端口释放
> （`Get-NetTCPConnection -LocalPort 5059` → 0）。

## 本轮顺手看到、**没有修**（不在 059 范围，留给集成方 / 单开线）

- 🟡 **`src/lite2/LiteAdviceCard.tsx` 的分区标题是硬编码英文**，没走 i18n：
  `What it found`（:35）、`Yours to sign off`（:38）、`The backing`（:80）、
  `How sure it is`（:93）等。SSR 渲染 `?lang=zh` 时实测这些标题**原样显示英文**，
  而同一屏的流面板已是中文。这是**最终建议卡**——三亚 / 国内融资团队 7-25 试用时
  正对着看的那张卡。属既有问题（非本 feature 引入），且 kickoff 明确写了
  「不要顺手重写 LiteAdviceCard」，故**只报不改**。建议单开一条线。
