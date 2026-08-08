# 回执 · #72 建议追问 chips + 快问触发收敛（wave 2，2026-08-08）

正源：`gh issue view 72`（0808 演习第 3 轮 Danny 拍板：①brain 输出加「建议追问」槽、回答下方
可点 chips、点击=同场追问；②快问触发收敛）。依赖 #71（会话流）已落 main——chips 点击的
「同场追问」走 #71 的 history 机制。本 wave 只有这一张票，无并行线。

---

## 一句话

回答卡（判读卡与短答两路）下方长出 ≤3 条可点的「接着可以问」chips——点击即以完整问题发出
同场追问（自动带前几轮 history）；快问卡不再「提到人名就弹」：触发判据升级为**文种感知的
词边界匹配**，并叠一道语义闸——**短答终局（事实已直接读出）不弹卡**。

---

## 做了什么

### 后端 · followup_questions 槽（additive optional，零迁移）

- **`avery/tools.py`**：`draft_advice` / `answer_direct` 两个终局出口的 input_schema 各加可选
  `followup_questions`（array of string，maxItems 3）；`ToolContext.followup_questions` 一个家
  （answer 出口没有 dataclass 可挂，两条路共用 ctx）。工具层只做形状归一
  （`_coerce_followups`：字符串、去空白、封顶 3），红线过滤刻意不在这层。
- **`service/engine.py`**：transcript 顶层加 `followup_questions` 键（沿 `answer` 键先例——
  run_loop 不产出此键，parity 测试只比共有键）；红线 nudge 打回时随 advice/answer 一并清掉
  （被打回那版建议附带的追问不该幸存）。
- **`service/contract.py`**：`OPTIONAL_FIELDS` 登记 `followup_questions`；投影层
  `_project_followups` **逐条**过问题门（`_followup_passes_gate`——ask_api
  `generate_questions` 同款两级纪律：问"事"恒过、人评分只在 ADR-0030 公司开关开着时放行），
  违规**丢弃**、干净的留下。`project_advice` 与 `enforce_answer` 两条路都透传（advice 与短答
  都要有 chips）。**刻意不并进 `_redline_text` 的整块复验**：并进去的话，一条违规追问的失败
  模式就从「少一个 chip」升级成「整张判读卡不发」——建议追问永远不该弄失败一次已经成功的
  建议（与 ask 帧同一条纪律）。
- **`service/live_input.py`**：mock 罐头固定 2 条（`_MOCK_FOLLOWUPS_ADVICE` /
  `_MOCK_FOLLOWUPS_ANSWER`，advice/短答各一对）。三条既有纪律照抄：按 locale 取（zh 判据
  必须采得到样）、文案自报 mock 身份（「（mock 示例追问）」后缀）、罐头逐条过红线
  （test_locale_contract 扩了判据）。`avery/brain.py::make_mock_brain` 把 MOCK 块里的
  followups 带进工具入参；没带时计划逐字节不变（既有 case fixture 零扰动）。

### 后端 · 快问触发收敛（ask_api.py）

- **词边界（`_name_mentioned`，文种感知）**：病根是裸子串（`p.name.lower() in hay`，两字符
  起步）——"Li" 命中 "the list"、"Marcus Reid" 命中 "Marcus Reidenbach"，16 人花名册下几乎
  问啥都中。规则：匹配段的**拉丁字母边**不许紧贴另一个拉丁字母/数字；**CJK 邻接不阻断**
  ——裸抄英文 `\b` 的话 Python 把汉字也算 word char，「小王」在「问一下小王这周的排班」里
  就匹配不上，词边界升级会反手把中文触发整个杀死（票面预警的正是这个）。
- **语义闸（answer_kind）**：`_with_ask_frame` 把整个终局 manifest 交给
  `maybe_ask_draft_frame`（此前只是一位"看见过 manifest"的布尔）；**短答终局
  （`answer_kind=='answer'`）不弹卡**——事实已经从记录里直接读出来，没有什么需要向谁发
  问卷核实的。侦察发现短答 manifest 的 `kind` 也是 None，所以此前**短答后照样弹卡**——
  这是「一直弹」的另一半病根，本票顺手闭合。
- 已知边界（记录不修）：两个中文名互为前缀（「王力」vs「王力宏」）仍会双中——中文无词界，
  不做分词猜测，宁多勿漏。

### 前端 · 追问 chips（lite2）

- `streamSource.ts`：`LiveRunState.followups`（manifest 两路各自消化，`coerceFollowups`
  防御归一）；`RoomScreen.tsx::LiteTurnView` 在回答卡下渲染 `.lite-room-followups`
  （chip 本体复用 `.lite-room-chip` pill 语法——按钮族门白名单条目一并覆盖；容器左对齐，
  是回答卡的下摆不是空态引导）。**只挂尾轮 + 只在 `complete` + 必须有回答卡在场**
  （与实时状态条/快问卡同族——历史轮上的「接着可以问」是假的此刻）。
- **点击即发**：chip 文字就是完整问题，`onAskFollowup` → `askWithRefs(q, [])` → 同一个
  `askLive`（history 由 store 组装——#71 的「一处补全」纪律，chips 作为第三个入口零新代码）。
- **`store.askLive` 加 busy 闸（store 临界区）**：上一轮 running 时静默丢弃——UI 的
  disabled 要等一次重渲染，同一拍的第二下它挡不住（createFormLinks / switchContext 同款
  教训）。这也是「chips 在上一轮未落定时的行为」的定义：结构上 running 时 chips 压根不渲染
  （尾轮没有 manifest），临界区窗口由 store 闸兜底。
- 历史面板（`LiteRoomHistory`）走 `coerceAdvice`，未知键自然丢弃——**历史里不长 chips**（对）。
- `stubTransport.ts` 罐头同步加 followups（dev 手测通道对齐；A 区门跑 build+preview，
  stub 在那里本来就是死开关）。
- 空态 4 条硬编码 chips 一字未动（票面：它们是空态引导，不是回答产物）。
- i18n 新键一枚：`roomFollowupsLabel`（「接着可以问」/ "Suggested follow-ups"）。chips 文字
  是后端产文，零新键（与票面预计一致）。

### 顺手重裁 · 「新一轮开跑即撤旧快问卡」（progress.md Notes 那条，改了、配了判据）

- **裁定**：撤卡从"无条件"改成**保护式**——①没动过的 draft 照旧撤（它是上一问的过期提案，
  粘屏就是假的"此刻"）；②manager **动过**的草稿（新 `askDirty` 标志，四个编辑 action 置位）
  与**已发出**的卡（shared/collecting：链接可能还没粘完；closed：回执还在看）不撤、也不被
  新一轮的 ask-draft 帧顶掉（顶掉和撤掉是同一种销毁；新提案静默让位，一次只有一张活体卡）。
  理由：chips 让"回答完马上追问"成为常态，每问一次杀一次 manager 手上正要发的问卷不可接受
  ——尤其 shared 卡的链接**只有这张卡一个入口**，撤了就真丢了。
- **连带补的两个洞**（保护把它们从"被撤卡行为掩着"变成"真可达"，不补就是跨公司/跨对话串数据）：
  - `clearTurns`（离开议事室）现在清 ask 四件——受保护的卡也随对话散场，不跨场复活；
  - `adoptContext` / `resetLiteCompanyData` 的公司域清单补上 ask 四件——两份清单的注释
    一直点名 ask，实际一直漏（A 公司的问卷卡挂到 B 公司头上是最硬的红线形态）。

---

## 验证账

### 后端 pytest（全程离线三件套）

| 件 | 结果 |
|---|---|
| 全量离线电池 | **4010 passed / 4 xfailed / 115 deselected**（wave1 基线 3996 + 本票新增 14 条严丝合缝：11 followup + 3 ask_frame） |
| 新增 `test_followup_suggestions.py` | 11 条：罐头两路/zh 罐头/旧契约兼容/红线逐条滤（advice+answer）/全滤光无键/封顶 3/非字符串丢/字段表登记；违规语料先自证真的过不了红线（#70 碑） |
| `test_ask_frame.py` 扩 3 条 | 收敛「不该弹」两形态（词边界 Reidenbach / 短答语义闸）+ `_name_mentioned` 中英矩阵（中文语料真进判据——全 ASCII 盲点碑的正反两面都钉了） |
| 既有测试改动 | 仅 `test_locale_contract.py` 两处：mock 块 advice 值不再全是 str（join 改成摊平），并把追问罐头并进红线/双语判据——是判据**加宽**，不是改判 |

### 前端门（A→B→C 全电池，标准端口 5173/8137——本 wave 无并行线，null-owner 这次真跑）

| 区 | 结果 |
|---|---|
| A 区（31 道，含 at-references 56 判据、room-conversation 42 判据） | **31/31 绿** |
| B · data-boundary | **绿** |
| B · null-owner | **绿**——本 wave 无并行线，直接在标准端口 5173/8137 跑全电池，把 wave1「null-owner 写死 5173 没跑」的缺口顺手补上（这次是真证据） |
| B · visual-baseline | **电池内红（exit=1）＝无基线首写**（worktree 各持一份 gitignore 基线，0 张起步；首写后单独复跑 8/8 绿只证稳定不证零漂移——照碑记「worktree 里冻＝白冻」，零漂移在合 main 后的主检出对真基线证，见下） |
| C 区（3 道） | **3/3 绿**；跑完 HEAD 仍在自己分支无 detach；runner 收尾重建的 dist 不带 api base（=生产域名），截图前已用本地 api base 重打 |
| `verify-room-conversation.mjs` | **21 → 42 判据，42/42 绿**（#72 扩：chips 在场/点击即发+history/只挂尾轮/busy 闸/短答路 chips/收敛两头/撤卡重裁两半/卡随对话散场） |

### born-red 变异台账（每条主判据配专属变异，逐个单独跑、净还原）

| 变异 | 预期 | 实收 |
|---|---|---|
| M-A 抹 mock 罐头 followup 槽（live_input） | ⑦ chips 判据红 | **⑦ 红**（containers:0）；门在 ⑧ 无 chip 可点处中止（变异运行允许首红即停，⑦ 的红已落账） |
| M-B chip 点击改 no-op（RoomScreen） | ⑧ 网络层判据红 | **⑧ 三条全红**（situation:null / history:[] / 无新轮）+ ⑨ 连带；38/4 |
| M-C 恢复裸子串（ask_api 调用点） | 词边界用例红 | pytest `test_name_inside_longer_word_no_frame` **红**（1 failed / 6 passed——纯函数矩阵仍绿，因为变异在调用点：HTTP 层判据独立咬住） |
| M-D 拆 answer_kind 语义闸 | 「不该弹」用例红 | 门 **⑪ 红**（askCard:1，41/1 外科手术式）+ pytest `test_factual_lookup_naming_roster_person_no_frame` **红** |
| M-E 拆 askLive busy 闸 | ⑩ 红 | **⑩ 两条红**（turns +2、posts +2；40/2） |
| M-F 拆撤卡保护（无条件 ask:null） | ⑬ 保护判据红 | **⑬ 红**（askCard:0/dirty:false；41/1） |
| M-G 拆 chips 的 isLast | ⑨ 只挂尾轮红 | **⑦ 红**（containers:2——⑦/⑨ 是同一把尺子的两次采样）；门随后因 strict-mode 双匹配在 ⑧ 中止 |

### 人眼过（build+preview，桌面 1280×900 / 手机 390×844 双视口）

- `72-advice-chips-*.png`：判读态——「接着可以问」两枚 pill 挂在判读卡与快问卡之间，
  快问卡收件人预选周雅婷；手机上卡与 chips 均完整、composer 不压卡尾。
- `72-answer-chips-*.png`：短答态——回答卡下两枚 chips 左对齐、手机上换行完整；
  **屏上无快问卡**（收敛生效的人眼确认）。
- 截图是 gitignore 单机产物，路径在本 session 的 scratchpad。
- ⚠ 同 #69/#71 的口径：人眼过走 build+preview 不是 `npm run dev`（本仓门环境纪律）。

---

## 迁移账

**不需要迁移。** followup_questions 是 manifest/契约投影里的可选键；`advise_runs` 落库走的是
整块 advice jsonb（新键随块进、`coerceAdvice` 读侧自然丢弃）——动 dataclass 里被整块 jsonb
装着的字段 → 免迁移（progress.md 判据原文）。表结构与写入口径一字未动。

---

## 刻意没做 / 已知边界

- **真 brain 的追问质量**：schema 里已给槽 + description 提示，但真 brain 会不会填、填得好
  不好，离线电池采不到样（mock 罐头只证明管道通）。复演（第 4 轮，真 MiniMax）时验
  「回答下方建议追问可点」正是为这个——progress.md What's Next 第 3 条已有此项。
- **中文名互为前缀仍双中**（王力/王力宏）：中文无词界，不做分词猜测，宁多勿漏。要更准得上
  分词或花名册去重仲裁，单独开票裁。
- **「建议动作里含向该人核实」这类更深的语义判据没做**：票面写的是"再叠什么判据实现定"。
  本票落的语义闸是 answer_kind（终局形态），它对真 brain 与 mock 一致成立（判据不是文本
  正则而是运行的真实终局）。再收紧留给真跑观察后裁。
- **followups 不进 `_redline_text` 整块复验**：刻意（见上）；过滤的牙由逐条门 + pytest 钉。
- **chips 不做「填入输入框」退路**：点击即发一步到位（票面首选项）；退路条款没用上。
- **switchContext 换公司时 turns 不清**（adoptContext 不清 turns/run，resetLiteCompanyData
  清）——既有边界，#71 时代就在。ask 四件本票补了（保护把它放大成真可达），turns 那半没动
  ——要补是独立的裁定（涉及在飞流的 abort 归属），记在 progress.md Notes。

---

## 改到的文件

后端：`avery/tools.py` · `avery/brain.py` · `service/engine.py` · `service/contract.py` ·
`service/live_input.py` · `service/ask_api.py` · `service/app.py` ·
**新** `tests/test_followup_suggestions.py` · `tests/test_ask_frame.py` ·
`tests/test_locale_contract.py`

前端：`src/lite2/streamSource.ts`（followups 槽 + coerceFollowups）· `src/lite2/store.ts`
（askLive busy 闸 + 保护式撤卡 + askDirty + 公司域清单补 ask 族）·
`src/lite2/screens/RoomScreen.tsx`（chips 渲染 + onAskFollowup）· `src/lite2/stubTransport.ts` ·
`src/lite2/styles/lite2.css` · `src/shared/i18n/{en,zh}.ts`（roomFollowupsLabel）

门：`eval-harness/tools/verify-room-conversation.mjs`（21 → 42 判据）
