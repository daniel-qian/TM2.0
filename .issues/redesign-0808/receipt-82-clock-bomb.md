# receipt-82 · form-tests-clock-bomb —— 表单测试语料拆墙钟炸弹

**票**：gh issue #82 · **日期**：2026-08-10（周一，UTC 已进 2026-W33）
**结论**：三条红全部结清，**产品零改动**（`git diff --name-only` 里非 `eval-harness/tests/` 的文件数 = **0**）。
离线全套 `TZ=UTC` **4049 passed · 0 failed**（票面基线 4045 中 3 红 → 3 红修好 + 4 条新判据）。

> 一句话：**产品没病，是判据在赌墙上时钟**。T9 读时自动铸链在 W32→W33 翻周那一刻正确开火，
> 照着上期名单铸出本期空行；三条测试用 `submissions[0]` 裸取「刚提交那份」、用 `all(auto is False)`
> 数「所有行」，于是把产品干对的活读成了自己的红。

---

## 0. 产品零回归怎么证的

不是"我没打算改"，是**机器证的**：

```
git diff --name-only | grep -v '^eval-harness/tests/' | wc -l   →  0
```

中途为了跑变异确实动过 `avery/ingest/form.py` 与 `form_autofill.py`，收尾从备份**逐字节还原**
（`identical bytes: True`）。⚠ 变异脚本第一版的 `finally` 还原的是「LF 归一化后的副本」而不是原始字节，
四个文件的 CRLF 被整片压成 LF —— 内容一字未改、`git status` 却全脏。已按仓里 CRLF 纪律复原并自查
`bare_lf == 0`。**这条坑值得记：还原路径必须还原原始 bytes，不是你中途拿来做匹配的那份归一化字符串。**

---

## 1. 三条红：病根与改法（逐条）

三条的病根是**同一个**：`GET /team/{ctx}/forms/submissions` 是一支**读时会写**的端点
（T9 `ensure_current_period_links`，`form_api.py:306-348`），而 `registry.list_form_submissions`
是 **newest-first**（`registry.py:1058`）。翻周之后，自动铸出的本期空行 `created_at` 最新 → 排在 `[0]`。

| # | 用例 | 原判据 | 现判据 |
|---|---|---|---|
| ① | `test_form_append.py::test_submitting_the_form_files_it_into_the_company_records` | `submissions[0]["id"]` → 拿到 W33 自动空行，补灌端点诚实 409 | id 从**铸链回帧**拿（`_one_link` 多带一个 `sid`），再用 `_submission_row()` 按 id 选行 + 断言 `status == "submitted"` |
| ② | `test_form_append.py::test_a_failed_filing_degrades_honestly_…` | 同上 | 同上（顺带把「答案照样锁住」这条语义显式钉出来了） |
| ③ | `test_form_autofill_t9.py::test_manual_mint_stays_non_idempotent` | `all(row["auto"] is False for row in …)` —— 把自动铸的行也算进来了 | 子集判据：只看**手动铸的那两行**（`a["id"]` / `b["id"]`），且**先钉这两行确实在名单里**再看 `auto` |

**钉子语义没被动**：③ 验的仍然是「第二次铸链建出了新的一行、新 token、老链接照常有效」——
`a["id"] != b["id"]`、`a["token"] != b["token"]`、`GET /f/{a.token} == 200` 三条一字未改。
改的只有最后那条「这些行是不是手动的」的**取样范围**。

### 顺手结清的一处假绿

`test_form_append.py::test_refile_endpoint_is_gated_and_honest` 也是裸取 `[0]`，但它**没红**——
因为它要的就是 409，而自动空行同样未提交、同样 409。**判据全绿、量的却是另一行。**
（`verifiers-that-lie` 又添一形态：*错误的取样在结果恰好相同时是完全隐形的*。）
现改为按 id 选行 + `auto is False`，这条从此有牙（见变异 M3）。

### 同族拆弹（同一 bug class，尚未咬人）

`test_form_autofill_t9.py` 另有两处 `_submissions(...)[0]`，至今没红是**布景的巧合**：它们铸的链接
正好落在本期（于是没有"上一期"可照抄、自动路径不开火）。已一并改为按 `link["id"]` 选行：

- `test_voiding_a_submitted_link_is_refused`
- `test_void_is_tenant_scoped_and_has_no_enumeration_oracle`

新增共用助手 `_submission_row()`（两个文件各一份，都带「找不到就当场红」）——**过滤式判据最常见的
死法是过滤出空集然后恒真**，这条门口先堵上。

---

## 2. 全量扫 `2026-W32`：24 处逐条分类

`grep -rn "2026-W32" eval-harness/tests/` 命中 **24** 处（与票面一致）。分类尺：
**这个字面量有没有跟「真钟算出来的那一期」发生比较**。没有比较 = 它只是一个惰性标签，安全。

| 文件 | 行 | 形态 | 判 |
|---|---|---|---|
| `test_form_append.py` | 81 | `_submitted()` 默认参数，直接构造 `FormSubmission` | 🟢 安全 |
| `test_form_append.py` | 119 | `assert "述职周期：2026-W32" in md`，渲染契约 | 🟢 安全（由 seed 期推出，不问钟） |
| `test_form_append.py` | 148 | `ParsedDoc(name=…)` fixture 文件名 | 🟢 安全 |
| `test_form_append.py` | 183 | `sd_a.filename == …`，source_key 唯一性 | 🟢 安全 |
| `test_form_append.py` | 213 | `row["filename"] == …`，内存 registry 面 | 🟢 安全 |
| `test_form_append.py` | **309** | `_one_link` 走 **HTTP** 铸 W32 链接 | 🔴 **引信**——它让 W32 成为"上一期"，每次读都触发自动铸链 |
| `test_form_append.py` | 334 | `row["filename"]`，判在 **files** 上 | 🟢 安全（自动行不产文件） |
| `test_form_append.py` | 369 | `[f["filename"] for f in files] == [...]` | 🟢 安全（同上） |
| `test_form_autofill_t9.py` | 45 | `TODAY = date(2026,8,7)`，注入式 | 🟢 安全（直调用例一律显式传 `today=`） |
| `test_form_builder_t11.py` | 614 | 直接构造 + `render_submission_markdown` | 🟢 安全（该用例不走 HTTP） |
| `test_form_reflow_a2.py` | 112 / 236 / 322 / 468 / 491 / 608 / 749 | 全部直接构造/内存 registry | 🟢 安全 ×7（**全文件零 HTTP**） |
| `test_form_store_contract.py` | 124 / 290 / 451 / 466 / 525 / 531 | registry 契约层，period 是显式入参 | 🟢 安全 ×6（**全文件零 HTTP**） |
| `test_decision_i18n_contract.py` | 193 | 直接构造 `FormPeriodStatus` | 🟢 安全 |

**结果：23 处安全留、1 处是引信（:309）。**

🔴 **值得记的一点**：真正炸的那三行**一个 `W32` 字面量都不含**。病不在字面量，在**选行方式**
（`[0]` / `all(...)`）。「扫字面量」这把尺**扫不到病灶**——它只能扫到引信。所以本票同时按
**bug class**（HTTP 列表裸取下标）扫了一遍，那一遍才捞出上面那三处同族。

### 顺手查的其它「按真钟算周期/日期」的消费面

- `current_period()` 的产品消费面共两处：`form_autofill.ensure_current_period_links` /
  `form_period_status`，以及 `form_api.mint_links` 的默认周期（`form_api.py:229`）。
  测试面全部走 `current_period()` 或注入 `today=`，**无第二个硬编码周期字面量**。
- `test_form_h5.py:145` 的 `r.json()["period"] == current_period()` 是自指但无字面量，安全。
- `test_form_autofill_t9.py` 里的 `2026-W01` / `2026-W20` / `2026-W31` 是**铁定早于本期**的
  seed 值，永久成立，安全。
- 🟠 **另一族墙钟赌注（本票未修，见 §6）**：`test_decision_grading.py:1050`
  `_uploaded_day(...) == date.today()` —— 这是**午夜翻转 + 本地时区**那一族，不是 ISO 周族。

---

## 3. 新长的正面判据：翻周开火不再是惊喜

票面 §1 要求「自动铸链在周翻转开火本身要长出一条正面判据」。**翻周这条路今天是第一次被观察到，
而且是从三条红里反推出来的**——原来的覆盖是：直调用例全部注入 `today=TODAY`（周期是死的，
永远翻不了周），HTTP 用例照抄的是 `2026-W01` 这种远古周期（形状对，但不是**翻周**）。

新增 **4 条**（`test_form_autofill_t9.py`）：

**① `test_a_new_iso_week_auto_fills_from_last_weeks_roster_over_http`（parametrize ×3，钟可控）**

用 `_pin_autofill_clock()` 把自动补铸那一路的"今天"钉在指定日期——**只钉喂进去的日期，
不替换 ISO 周算法本身**（lambda 里调的还是产品那支真 `current_period`）。三个布景：

| pinned | 本期 | 上期 | 钉的是什么 |
|---|---|---|---|
| 2026-08-10 | 2026-W33 | 2026-W32 | #82 那一幕的原样复现：周一早上翻进新的一周 |
| 2026-08-16 | 2026-W33 | 2026-W32 | 同周周日——「本期」在一周之内不许漂 |
| 2027-01-04 | 2027-W01 | 2026-W53 | 跨年翻周（2026 是 53 周年）——`latest_form_period_before` 全靠 `YYYY-Www` 字典序，这是它唯一会崩的形状 |

判据：`auto_filled` 帧逐字段相等、新行 `auto is True` + `status open` + **无 answers 键**、
token 与上期**不重合**（抄 token 会让上周填过的人以为自己还没填）、上期两行原样还在、第二次读不再铸。
用例开头**先验尺子再量东西**（`assert current_period(day) == this_week`）——ISO 周算错了，
下面每条断言都会以"看着对"的样子测错东西。

**② `test_the_real_wall_clock_copies_last_iso_week_into_this_one`（真钟，零字面量）**

不打任何补丁跑真钟，一个周期字面量都不含。两条缺一不可：只有钉钟那条，
`current_period` 被改成返回常量也照样全绿（判据自己喂自己）；只有真钟这条，就永远测不到跨年和周一那一下。

⚠ 这一条**自己也踩过一次同族的坑**（时间旅行台架当场逮到，见 §4）：第一版拿
`datetime.now()` 自己算了一遍"本期"，又让产品算了一遍——两次读钟之间隔着一整个 HTTP 请求，
**跨周那一瞬间两个答案会不一样**。引信从"一周"缩到"一毫秒"，但仍是同一颗炸弹。
现在「本期」只问产品要一次，**上期**独立用真钟减 7 天算出来（否则整条判据退化成产品自己跟自己对答案）。

---

## 4. 门：不是"读代码觉得没事"，是把钟真拨过去跑

票面门写着「**本周内（W33）任何一天跑都绿、下周一（W34）也绿**」。这句话**读代码是证不出来的**
（仓里这条教训已经很贵了）。所以造了一台一次性时间旅行台架
（`scratchpad/clockshift.py`，pytest 插件，**未入库**）：

- 只移 `avery.ingest.form.current_period` 的**默认**日期，显式 `today=` 一律不动（测试是故意注入的）。
- **刻意不移 `now_iso`/到期时刻**：移了"现在"却不移库里存的过期戳，会凭空造出一堆过期链接的假红，
  淹掉我们真正要问的那个问题（"ISO 周前进时会不会坏"）。
- `from .form import current_period` 是**按值绑定**，patch 定义模块没用——插件扫 `sys.modules`
  把所有仍指向原函数的模块级名字重绑，并在 collection 之后**再扫一遍**（测试模块 import 得晚）。

七个表单相关文件（202 条）逐个偏移跑：

| 偏移 | 产品认的本期 | 结果 |
|---|---|---|
| +0d（今天，周一） | 2026-W33 | 202 passed |
| +1 / +2 / +3 / +4 / +5 / +6d | 2026-W33 | 202 passed ×6（**W33 整周逐天**） |
| **+7d（下周一）** | **2026-W34** | **202 passed** |
| +8d / +14d / +21d | W34 / W35 / W36 | 202 passed ×3 |
| +147d（跨年） | 2027-W01 | 202 passed |
| +365d | 2027-W32 | 202 passed |

**台架有牙的证据**：+7d 那一跑**第一次是红的**——逮到的正是 §3② 里我自己新写的那条两次读钟。
（`verifiers-that-lie` 的反例：这次的红不是"如预期"，是台架真发现了东西。）

**负向偏移（-3/-6/-10/-100d）会红 1 条，那是台架的自身局限，不是炸弹**：插件只移产品的钟、
不移测试模块自己的 `datetime.now()`，倒着走时两者失同步，`last_week` 会撞上产品认的本期。
真实的倒流两者一起动。这条已用**纯逻辑扫**独立证死：

```
current_period(t-7d) < current_period(t)   →  2024-01-01 ~ 2032-01-01 共 2922 天，违例 0
（含 2026-W53→2027-W01、2028-W52→2029-W01、2030-W52→2031-W01 等全部跨年点）
```

这条不等式正是 `latest_form_period_before` 的全部依据，也正是 §3② 的前提——**它在真实时间线上
永远不会破**。

### 门账

| 门 | 结果 |
|---|---|
| `TZ=UTC` 离线全套 | **4049 passed · 0 failed · 124 deselected · 4 xfailed**（122s） |
| 判据含真钟周期字面量 | **0**（唯一保留的 W32 全是 seed / 渲染契约，见 §2 全表） |
| 非 `tests/` 文件改动 | **0** |
| 行尾 / 编码自查 | 两个测试文件 `crlf=528 / 741`，`bare_lf = 0`，UTF-8 无 BOM |

纪律：离线三件套（`AVERY_BRAIN=mock` / `AVERY_EXTRACTOR=heuristic` / `AVERY_EMBEDDINGS=keyword`）由
两个文件各自的 fixture 压住，四个 deselect 标记一个没漏。**纯测试改动，未跑前端门电池**
（改动零溢出 `eval-harness/tests/`，票面纪律准许）。

---

## 5. 变异台账（6 条，逐条独立跑，跑完还原）

「布景真造 auto 行、别靠真钟碰运气」——M1–M4 的变异体里**内嵌了一段布景探针**，
先断言「名单里确实是 2 行、其中恰好 1 行 `auto is True` 且期号 == `current_period()`」，
**探针过了再让坏选行跑**。所以每一条红都可归因到自动行，而不是别的什么。

| # | 变异 | 目标 | 结果 |
|---|---|---|---|
| M1 | 选行退回 `submissions[0]` | `test_submitting_the_form_files_it_into_the_company_records` | 🔴 红（布景探针 ✅ 通过） |
| M2 | 同上 | `test_a_failed_filing_degrades_honestly_…` | 🔴 红（布景探针 ✅） |
| M3 | 同上 | `test_refile_endpoint_is_gated_and_honest`（原假绿那条） | 🔴 红（布景探针 ✅）——**说明补的 `auto is False` 真给它长了牙** |
| M4 | 子集判据退回 `all(auto is False)` | `test_manual_mint_stays_non_idempotent` | 🔴 红（布景探针 ✅） |
| M5 | **产品**：`ensure_current_period_links` 开头 `return []`（自动铸链彻底不开火） | T9 全文件 | 🔴 15 红——**4 条新判据全部在内** |
| M6 | **产品**：`current_period()` 恒返回 `"2026-W32"`（周期不再随周走） | T9 全文件 | 🔴 **恰好 4 红，且就是那 4 条新判据** |

🔴 **M6 是本票最有信息量的一条**：改完之前，把 `current_period` 焊死成常量，
**整个 T9 套（30 条）一条都不会红**。「周期会不会随真钟前进」这件事此前**零覆盖**——
现在由 §3 那 4 条独占地钉着。

⚠ 变异脚本自己也交了两次学费，都属 `verifiers-that-lie` 家族，记下来：
① 锚点用 `\n` 而文件是 CRLF → 前三条报 `ANCHOR NOT UNIQUE (0)`，看着像"变异没生效"，其实是没打上去；
② 布景探针的检测写成「stdout 里出现 `SCENERY NOT BUILT` 就算布景没造起来」——
**pytest 会把失败用例的源码整段回显**，于是那句字面量必然出现，探针恒报"布景坏了"。
判据必须落在 `E  AssertionError: …` 那一行上，不能落在源码回显上。

---

## 6. 顺手发现，没顺手修

- 🟠 **`test_decision_grading.py:1050` 是另一族墙钟赌注**：
  `assert _uploaded_day(twin.source_documents[0].uploaded_at) == date.today()`。
  `date.today()` 是**本地时区**，而 `clone_context` 打的是 UTC 戳——不带 `TZ=UTC` 跑
  （比如 UTC+8 的凌晨），两边会差一天，**真红**。引信是"午夜 + 时区"，不是"ISO 周"，
  所以不在本票刀口上；但它给「门命令为什么钉死 `TZ=UTC`」补了一条真实理由。
- 🟠 **`GET /team/{ctx}/forms/submissions` 是读时会写的端点，这件事在测试面没有任何一处集中说明**。
  本票在三个助手的 docstring 里各留了一份碑，但下一个写 HTTP 表单测试的人仍可能第四次踩它。
  真解法是端点侧文档或一条通用助手，属另一票。
- 🟢 `test_form_autofill_t9.py:45` 的 `# 2026-W32` 注释此前**是一句无人验证的断言**。
  现在 §3① 的 `assert current_period(day) == this_week` 是全仓第一处真的把 ISO 周算法
  钉到字面量上的判据。

---

## 7. 改了哪些文件

```
eval-harness/tests/test_form_append.py       +47 / -15 区间内
eval-harness/tests/test_form_autofill_t9.py  +136
（产品文件 0）
```

- `test_form_append.py`：`_one_link` 多带 `sid` 并立碑 · 新增 `_submission_row()` · 三处选行改判。
- `test_form_autofill_t9.py`：新增 `_submission_row()` · ③ 改子集判据 · 两处同族拆弹 ·
  新增 `_pin_autofill_clock()` + 4 条翻周正面判据。

一次性台架（**未入库**，在 scratchpad）：`clockshift.py`（时间旅行 pytest 插件）、`mutate.py`（变异跑器）。
