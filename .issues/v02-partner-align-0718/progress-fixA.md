# progress · fixA — 不许替客户说话（状态兜底 + 首屏摘要 + 分诊卡文案）

- 工作树 `D:\avery-wt\fixA` · 分支 `fix/honesty-status-briefing`
- 起点 `40ce59c`（main 刚合入「中文 briefing 本地化 + stub DEV 闸补漏」）
- 交付 commit `0e7524f`
- 状态：**B1 / B2 / M3 三条全部修完并验过**，工作区干净。

三条修的是同一件事的三个出口：**「我没读到」和「客户说没有」是两件事，永远不许混。**

---

## B1 · `teamData.ts` 的 `status: card.status ?? 'on-track'`（blocker）

### 病灶（复核确认，不是原报告的转述）

后端 `registry.py::project_cards()` 在 status 为空时**根本不发这个键**（注释原文
"left absent (R2 don't invent)"），`decision_grading` 把它记进 `unknown_fields`、理由写
「未读到：状态」。**唯独前端这一行替客户补了一句「一切正常」。**

真机实测拿到的一份 payload（本地真跑 `ingest_paths`，见下「真 payload」）：

```json
{"id": "p_佣金测算项目周报", "title": "佣金测算 项目周报", "ownerName": "李娜",
 "summary": "负责人：李娜", "blockers": ["口径没定，等财务确认"]}
```

— 没有 `status` 键。决策层对同一条判 `needs_confirmation`、`unknown_fields=[status, progress, dueDate]`。

### 改法

`LiteProject` 拆成两个字段，把「判据」和「渲染文案」分开：

| 字段 | 语义 |
| --- | --- |
| `statusRaw?: string` | 文档自述的状态原值。**缺失就是 `undefined`**，绝不兜底、绝不猜。空串也归入缺失。 |
| `status: string` | 只用来渲染。有值 → **原样透传**那个状态词；没读到 → 本地化的「未读到状态」。 |

三个刻意的取舍：

1. **已知状态原样透传，不翻译。** `TeamScreen.tsx` 的 `statusTone()` 与 `edge-${status}`
   按状态词取色（`blocked` 红点、`at-risk` 琥珀）。把 `blocked` 翻成中文会让这两处静默掉色，
   而那两个文件不在本线边界内。所以只有**缺失**这一种情况替换成中文文案；已知状态词在中文界面
   下仍是 ASCII——这条**没修完**，处理方式见文末 `needsOtherFiles`。
2. **措辞用「未读到状态」，不用「文档未提及」。** 后端在两种情况下都省略这个键：文档确实没写，
   以及抽取层读不出来（例如 `_norm_status` 对「待确认」刻意返回 `''`）。前端分不清这两者，
   因此只能说我方的事实。这与 `decision_rules.py` 里那条红线注释同口径（"说的是我没读到，
   不是文档没写"）。
3. **`gapDerive` 改读 `statusRaw`**：没自述过状态 → 不构成「自述与信号矛盾」，直接跳过。

### 交叉验证者那两处更正都落到了实处

- **A（伪造引语，summary 为空时）**：`claim` 兜底现在引的是 `statusRaw`，而这条分支只有在
  文档真写了状态时才进得来。注释里那句「兜底文本 100% 可溯源到字段本身」第一次真的成立。
- **B（更高频的那个，summary 非空时）**：真机重放——旧代码把文档首行「负责人：李娜」当成项目自述，
  摆进「文件里的说法」栏，对面是「实际信号」。修复后该项目**零对照卡**。两次浏览器输出都在下面。

---

## B2 · `registry.py::briefing()` 说「没有风险信号」而同一份 payload 有阻塞（blocker）

### 病灶

`at_risk` 只看 `p.status in ("at-risk","blocked")`，**不看 blockers、不看 signals**。于是
「自报正常却挂着阻塞」——「多看一眼」整个功能存在的前提场景，规则表里本来就有专门一条
（「自报『正常』但挂着未解阻塞」）——落进 `No risk signals surfaced from the documents.`，
而这句话**紧贴在**「Everything below is drawn from your uploads — nothing invented.」后面。

⚠️ main 刚合入的中文本地化没有动这段结构：`shared/briefing.ts` 的中文分支是**按后端
metrics 里有没有 `need a look` 这一格**切 calm/risk 的。所以后端判据一改，中文屏自动跟上——
这也是本次刻意把 metric 标签 `'need a look'` 逐字保留的原因。

### 改法

判据换成 `avery.decision_grading` 那张规则表（**不另造一套**）：

```
decisions   = grade_projects(project_cards(), signal_cards(), as_of=as_of)
flagged     = [d for d in decisions if d.grade != CAN_PROCEED]
loose       = 没被任何 flagged 项目的规则证据逐字引用过的 signal
n_look      = len(flagged) + len(loose)
tone/metric/subhead 三者全部由 n_look 派生
```

两个细节：

- **signals 另算，且不重复计数。** 抽取层的 signal 按构造就是风险读数（unresolved /
  no sign-off / rework / interrupt 四族），所以「signals 非空」与「没有风险信号」不可能同时为真。
  但 `_match_signals` 有已知盲区（既没指名、正文也没提项目标题的信号挂不到任何项目上），那些
  signal 到不了任何一张决策卡——**正因如此简报更不能把它们吞掉**。判「已被算过」的方式是看它的
  原文有没有出现在某条 flagged 决策的规则证据里，只读公开输出，不会和 matcher 漂移。
- **计数里混进 signal 时，英文 subhead 改说 `item(s)` 而不是 `project(s)`**——那一条没指向任何
  项目，管它叫「项目」就是一次小小的编造，而这个方法存在的意义正是拦这个。全是项目时措辞逐字不变。
- 新增可选参数 `as_of`（与 `decision_cards()` 同约定），传了就能逐字节复现同一份简报。

---

## M3 · 晨间分诊卡写死英文（major）

`liveHandoffs()` 里四处英文字面量（`toneLabel` / `action` / `evidence` 兜底 / `evidenceTag`）
全部走 i18n。**英文文案与原字面量逐字节相同**，EN 壳视觉零变化。

顺带把 evidence 兜底里的 `pr.status ?? 'worth a look'` 改成 `?? ''`：真没有状态的时候宁可少一个词，
也不替文档补一个（该分支实际不可达，但那个默认值本身就是本次要根除的写法）。

---

## 回归测试：先证明它能抓到原 bug，再证明修完变绿

### ① 后端 · `eval-harness/tests/test_briefing_risk_honesty.py`（6 条）

**旧代码（未改 registry.py 时跑）：**

```
FAILED test_briefing_risk_honesty.py::test_on_track_project_with_a_blocker_is_not_reported_as_calm
FAILED test_briefing_risk_honesty.py::test_project_with_no_stated_status_but_a_blocker_is_not_reported_as_calm
FAILED test_briefing_risk_honesty.py::test_a_risk_signal_is_never_denied_even_when_no_project_is_flagged
FAILED test_briefing_risk_honesty.py::test_briefing_and_decision_cards_never_contradict_each_other
4 failed, 2 passed in 0.86s
```

其中一条的实际断言输出（同一份 payload 自相矛盾的现场）：

```
E  AssertionError: [{'label': 'people', 'value': '0'}, {'label': 'active projects', 'value': '3'},
                    {'label': 'need a look', 'value': '1'}]
E  assert 1 >= 2      # 决策层判了 2 条要看，简报只承认 1 条
```

**修复后：** `6 passed in 0.60s`

### ② 前端纯函数 · `.issues/v02-partner-align-0718/verify-fixA.mjs`（22 条断言）

本仓没有前端单测 runner 且禁止 `npm install`，所以沿用既有做法（`scripts/gates/engine-par-check.mjs`）：
用已装好的 esbuild 把**真源码**整棵打进内存再 import 跑真函数——不是 mock，不是复制一份逻辑自考自答。

**旧代码：** `RED — 11 ok, 11 failed`，其中：

```
FAIL status 不是编出来的 on-track — "on-track"
FAIL status 是中文的「未读到」文案 — "on-track"
FAIL statusRaw 同值
FAIL 零对照卡（没自述过状态 = 不构成自述与信号矛盾） — ["负责人：李娜"]
FAIL 不会把文档首行当成「文件里的说法」 — ["负责人：李娜"]
FAIL tone 标签是中文 — "Worth a closer look"
FAIL 标题是中文 — "Take a look at 佣金测算"
FAIL 出处标签是中文 — "From your uploads"
```

**修复后：** `ALL GREEN — 22 ok, 0 failed`

### ③ 集成层 · `.issues/v02-partner-align-0718/verify-fixA-live.mjs`（15 条，agent 当第一个用户）

真浏览器（Playwright）+ 真后端（uvicorn :8301）+ 真 ingest：上传一份没写状态、挂着阻塞的
中文周报，看四块屏。端口用 fixA 专用的 5301/8301，跑完已停、已确认释放。

**修复后（全绿）：**

```
[PASS] 真后端 ingest 成功 — {"ingest":"ready","rawStatus":null,"status":"未读到状态","statusRaw":null,
                             "metrics":[…,{"label":"need a look","value":"1"}]}
[PASS] 🔴 前提：后端这份 payload 确实没发 status 键 — rawStatus=null
[PASS] 项目卡显示「未读到状态」 — 未读到状态
[PASS] 🔴 项目卡不再显示编出来的 on-track — 未读到状态
[PASS] 🔴 简报不再否认风险信号 — 以下内容全部来自你上传的文件，没有一处是编的。其中 1 个项目值得多看一眼。
[PASS] metrics 里出现「值得多看一眼」那一格 — 0 | 位成员 | 1 | 个进行中的项目 | 1 | 个值得多看一眼
[PASS] 分诊卡 tone 标签是中文 — 值得多看一眼
[PASS] 分诊卡标题是中文 — 去看看「佣金测算 项目周报」
[PASS] 🔴 没自述过状态 → 零对照卡 — cards=0 claims=[]
[PASS] 🔴「文件里的说法」栏里没有客户没说过的话 — []
[PASS] 无 console 报错
ALL GREEN — 15 ok, 0 failed
```

**旧代码（受控实验：提交后把 teamData/gapDerive 两行改回旧写法重跑，再恢复；
`git diff` 已确认恢复后与 commit 逐字节一致）：**

```
[PASS] 真后端 ingest 成功 — {"rawStatus":null,"status":"on-track","statusRaw":null,…}
[FAIL] 项目卡显示「未读到状态」 — on-track
[FAIL] 🔴 项目卡不再显示编出来的 on-track — on-track
[FAIL] 🔴 没自述过状态 → 零对照卡 — cards=1 claims=["负责人：李娜"]
[FAIL] 🔴「文件里的说法」栏里没有客户没说过的话 — ["负责人：李娜"]
RED — 11 ok, 4 failed
```

**这就是那张卡在真浏览器里的样子**：「文件里的说法」栏写着「负责人：李娜」。

> 诚实标注：这次受控实验只回退了**前端**两行（B1），registry.py 的修复仍在，所以那一轮里
> 简报三条断言仍是 PASS。B2 的旧代码 FAIL 证据来自上面 ① 的 pytest 输出，不是这一轮。

### 真 payload（本地真跑 `ingest_paths`，不是手搓 fixture）

```json
{"projects": [{"id": "p_佣金测算项目周报", "title": "佣金测算 项目周报", "ownerName": "李娜",
               "summary": "负责人：李娜", "blockers": ["口径没定，等财务确认"]}],
 "briefing": {"tone": "alert",
              "subhead": "… nothing invented. 1 project(s) worth a closer look.",
              "metrics": [… {"label": "need a look", "value": "1"}]},
 "grades": [["佣金测算 项目周报", "needs_confirmation", ["status", "progress", "dueDate"]]]}
```

旧 `briefing()` 对这份 payload 的判据是 `status in ("at-risk","blocked")` → status 键不存在 →
`at_risk` 为空 → tone `calm` + 「No risk signals surfaced from the documents.」，而同一份里
决策层判着 `needs_confirmation`、blockers 明摆着。

---

## 门（全部真跑过）

| 门 | 结果 |
| --- | --- |
| `python -m pytest eval-harness/tests/ -q` | **2962 passed / 0 failed / 61 skipped / 4 xfailed**（基线 2956 + 本次新增 6） |
| `npm run typecheck` | 退出 0 |
| `npm run lint` | **0 error** / 5 warning（全部是既有 `noInlineConfig` 提示，与基线一致） |
| `npm run build` | 通过（`✓ built in 3.50s`） |
| `node verify-fixA.mjs` | 22 ok / 0 failed |
| `node verify-fixA-live.mjs` | 15 ok / 0 failed |

中途踩到并已解决的一处：`test_decision_grading.py::test_no_rule_text_in_any_prompt` 禁止规则编号
（`R-*`）出现在真源以外的任何文件里。我的注释和测试里原本引了两个编号，已改成引规则的中文标题。

---

## Notes（顺手发现，**没有顺手修**）

1. **`gapDerive.ts` 里还有两处英文字面量会打到中文用户面上**：`evidenceTag: 'From your uploads'`
   和 summary 为空时的 `claim` 兜底 `Reported status: "on-track"`。与 M3 是同一类问题，但 M3 的
   范围明确只写「晨间分诊卡」，故未动。要修的话是给 `deriveGaps` 加一个默认参数的 locale
   （`flowStore` / `notifyStore` 两个调用点不用改），成本约 10 行。
2. **中文界面下已知状态词仍是 ASCII**（`on-track` / `blocked`）。原因见 B1 取舍 ①：翻译会让
   `TeamScreen.tsx` 的状态点与边色静默失效。正解见 `needsOtherFiles`。
3. **`briefing()` 现在每次调用都会跑一遍 `grade_projects`**（纯 Python、无 IO，项目量级下可忽略）。
   `/ingest` 与 `/team` 的响应里 `decisions` 和 `briefing` 各算一次，同一份结果算了两遍——想省的话
   在 `ingest_api.py` 那层复用一次结果即可，不在本线边界内。
4. **`shared/briefing.ts` 顶部注释说后端 briefing 是 locale-blind——这仍然成立**，本次没有让后端
   变成 locale-aware（不在边界内，且那层前端本地化按其注释要求保留未动）。
5. **`extract.py` 的项目切分在中文周报上会把整份文档合成一个项目**（`## 项目：X` 多块没被切开，
   title 取了 H1）。这是我为构造测试文档时实测到的，不属于本次范围，但会直接影响三家公司的真文件
   观感——建议单开一条。


---

# 第二轮收口（fixA 续）· 复核判 B2 "partial"

复核的判词是准的：**原病灶治好了，但新判据把计数算错了，而错法正好落回这一轮要根治的那类话。**
真 ingest 一份 10 行英文周报 → 1 个项目、1 张决策卡，简报却说 need a look = 3；中文生产壳把这个
数字填进写死量词的一句话「其中 {N} 个项目值得多看一眼」，于是屏幕上一张项目卡、文字点名三个。

## 病灶：一个数字错了两处

**① 计数被重复计。** 第一版的去重判据是「signal 原文逐字出现在某条 flagged 决策的规则证据里」。
规则证据只装**命中关键词族**的信号，所以一条**指名道姓挂在已 flagged 项目上**、措辞却撞不上关键词
的信号，会被当成 loose 再加一次——同一个项目被数两遍。实测（`count_probe`，见下表）：

| payload | 项目数 | 旧 need a look | 新 need a look |
| --- | --- | --- | --- |
| A 信号 `subjectId=p1`，p1 已 flagged，措辞不命中关键词族 | 1 | **2** | **1** |
| B 负责人处境型信号，其项目已 flagged | 1 | **2** | **1** |
| C 同一条信号在 payload 里出现两次 | 0 | **2** | **1** |
| D 0 个项目 + 2 条挂不上的信号 | 0 | 2 | 2（数字本来就对，错的是量词） |
| E 真 ingest 那份 10 行英文周报 | 1 | 2 | 2（同上） |

**② 计数的形状没发出来。** 后端只发大小、不发「数出来的是什么」，前端只能一律叫「个项目」。

## 改法

**`registry.py::briefing()`** —— 去重改成**按信号身份**，且两条通道取并集（缺一条都会少数一类）：

- **① 已归属**：`decision_grading._match_signals`（**就是定级时跑的那个函数**，不再自己写一份）把
  这条信号挂到了某个已 flagged 的项目上 → 那件事已经在那张卡上数过一次。
- **② 已引用**：信号原文逐字出现在某条 flagged 卡的规则证据里 → 那句话已经印在屏幕上了。
  这一条**是第一版的判据，保留**：抽取层给每条 doc 信号写死 `subjectRef="the project"`
  （`extract.py::_signals_from_doc` 里 `proj_ref` 从未被赋值），doc 信号谁也挂不上，所以只靠 ①
  会让「既是项目 blocker、又被抽成信号」的那一行被数两遍。**只换成 ① 会让 E 从 2 涨回 3。**

复用 `_match_signals` 而不是重写一份，是本条修复的要点：「简报自己造一套判据」正是 B2 的原病灶，
把同样的错误搬到去重这一步只是换了层楼。

新增三个字段（additive，老前端读不到也不会坏）：

    look_kind      'projects' | 'items' | 'none'
    look_projects  数出来的项目条数
    look_signals   挂不到任何决策卡上的信号条数

`'projects'` 的**契约**是：数出来的每一样都确实是项目，且总数**不可能超过项目总数**——只有这时
「N 个项目」才是安全的话。有一条挂不上的信号，形状就是 `'items'`。

**`teamData.ts`** —— `LiteBriefing.lookKind` 读出这个形状。老后端不发这个键 / 值认不出来 →
`undefined`，消费方兜底到**不点名**那一侧（说「N 处」永远不会比事实更肯定；说「N 个项目」会凭空
点名）。`transport.ts` 不在本线边界内，所以在 teamData 里就地窄化读一次，不去改别人的契约类型。

**`zh.ts` / `en.ts`** —— 追加 `briefingSubheadRiskItems`（**纯新增，一个既有键都没改**）：

    zh: 以下内容全部来自你上传的文件，没有一处是编的。其中 {atRisk} 处值得多看一眼。
    en: Everything below is drawn from your uploads — nothing invented. {atRisk} item(s) worth a closer look.

英文那句与 `registry.py` 的 items 分支**逐字节一致**，所以 EN 直通和 ZH 重组说的是同一句话。

## 🔴 没修完的那一半（必须由集成方接）

**中文生产壳上这条 blocker 还活着。** 消费 `lookKind` 的地方是 `src/shared/briefing.ts`，
**不在本线可改文件清单里**，所以我把管道铺到它门口就停手了。真浏览器实测（`?v=2&mode=live&look=paper&lang=zh`，
真后端 + 真 ingest 那份 10 行英文周报）：

    headline : 你的团队：0 位成员，1 个进行中的项目。
    subhead  : 以下内容全部来自你上传的文件，没有一处是编的。其中 2 个项目值得多看一眼。   ← 仍在点名 2 个项目
    屏幕上   : 1 张项目卡

接上之后同一屏会是（用已经备好的键跑出来的真串）：

    subhead  : 以下内容全部来自你上传的文件，没有一处是编的。其中 2 处值得多看一眼。

具体改法见 `needsOtherFiles` #1——三行，且键和数据都已经就位。

## 回归测试（旧代码 FAIL / 新代码 PASS，输出见下）

新增 `eval-harness/tests/test_briefing_look_count.py`（9 条）。旧代码（`git show HEAD:…registry.py`
贴回工作树跑）：**9 failed**；恢复后：**9 passed**。其中最强的一条是
`test_real_ingest_of_a_weekly_never_counts_one_project_as_three`——真 parse + 真确定性抽取，无 mock，
就是审查现场那份文档。

`verify-fixA.mjs` 补 10 条（look_kind 一路走到壳里 + 不点名的中文已备好）。把三个前端源文件退回
HEAD 再跑：**25 ok / 7 failed**；恢复后：**32 ok / 0 failed**。

## 门（第二轮）

| 门 | 结果 |
| --- | --- |
| `python -m pytest eval-harness/tests/ -q` | **2971 passed / 0 failed / 61 skipped / 4 xfailed**（上一轮 2962 + 本次 9） |
| `npm run typecheck` | 退出 0 |
| `npm run lint` | **0 error** / 5 warning（与基线一致） |
| `npm run build` | 通过（`✓ built in 2.75s`） |
| `node verify-fixA.mjs` | 32 ok / 0 failed |
| `node verify-fixA-live.mjs` | 15 ok / 0 failed（真浏览器 + 真后端，端口 5301/8301，跑完已释放） |
| 真 HTTP `POST /ingest` + `GET /team/{id}` | 两个端点都带上了 `look_kind/look_projects/look_signals`（无 response_model，dict 直通） |
