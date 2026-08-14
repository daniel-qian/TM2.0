# session-handoff — 资料新旧判据的时区错位（UTC vs 服务端本地）

- **线**：`claude/stale-date-boundary`（基于 `main` @ aa5f46e，worktree `D:\avery-wt-suspicious-satoshi-8ac6e5`）
- **票**：无 GitHub issue（在修 #97 时顺手逮到，当场没修以免把红线补丁扩成时间归一改动）
- **feat**：feat-105
- **日期**：2026-08-14
- **状态**：done（修 + 门 + 文档齐；离线默认电池全绿）

## 一句话

`avery/decision_grading.py` 里，比较的两头来自**两个不同的钟**：`_uploaded_day` 把资料上传时刻
归一到 **UTC 日**，而 `as_of` 的默认值是 `date.today()`，即服务端**本地** naive 日。两个时区的
日期直接相减，本地日跑在 UTC 前面的那几个小时里，**所有资料凭空老一天**。

`_uploaded_day` 自己的 docstring 早就写下了这个预言——「两处各归一一次，早晚会归出两个不同的
日子」——然后没人把它关上。

## 复现（2026-08-14 00:29，UTC+8 的开发机）

```
一份「此刻」上传的资料 : 2026-08-13T16:29:40+00:00
_uploaded_day(...)     : 2026-08-13     <- UTC 日
date.today()           : 2026-08-14     <- 本地 naive 日
(as_of - day).days     : 1              <- 凭空老了一天
```

UTC+8 的机器上就是**每天 00:00–08:00，8/24，确定性发生，不是 flake**。

## ⚠ 严重度要说准：当时**没有**在打生产

`eval-harness/Dockerfile` 是 `python:3.11-slim`、**没设 `TZ`**、没装 tzdata → 容器跑在 UTC →
本地日 == UTC 日 → 两边碰巧一致。所以这条一直是**潜伏**的，不是正在伤客户。

但它离上线只有一步：任何一个 `TZ=Asia/Shanghai`（境内部署最顺手的那个动作）就让它生效。
而在开发机上它**已经**是真红的——`test_a_freshly_claimed_sample_team_is_not_told_its_material_is_stale`
每天有 8 小时红，那 8 小时里没人能拿到一次干净的验收跑。

（发现它时我对 Danny 说的是「live product bug」，那句话对生产过重了，这里更正。）

## 修法：全模块只留一个钟，钟走 UTC

| 改动 | 位置 |
|---|---|
| 新增 `_utc_now()` —— 本模块**唯一**的挂钟读数 | `decision_grading.py` |
| 新增 `today_utc()` —— 「今天」= UTC 日，与 `_uploaded_day` 同一条归一线 | 同上 |
| `grade_project` / `grade_projects` 的 `as_of` 默认值：`date.today()` → `today_utc()` | 同上 |
| `grade_form_period` 的 `datetime.now(timezone.utc)` → `_utc_now()`（让「唯一读钟处」这句话成立、也让它可钉） | 同上 |
| `decision_cards()` / `briefing()` 的 docstring：「不传则取今天」→ 说清是 **UTC** 今天及原因 | `ingest/registry.py` |

**为什么选 UTC 而不是本地**（三条，都不是审美）：

1. `_uploaded_day` 已经是 UTC；改它要动 `_uploaded_moment` 的语义，而表单回流
   （`ingest/form_reflow.py`）刻意吃它的**原始瞬间**——那是员工两次真按下提交的时刻。
   任务书也点名了别动那条路。
2. **全仓其余每一处读钟本来就是 UTC**：`ingest/ask.py`、`ingest/form.py`、`ingest/registry.py`，
   以及本文件 `grade_form_period` 自己。`date.today()` 是这里唯一的异类，不是别处的规矩。
3. 本地时间让结果**依赖服务器装在哪儿**——同一份 context 在杭州和斯德哥尔摩定出两个等级。
   那和本文件第一句「纯函数、零随机、逐字节一致」直接冲突。

**代价，明说**：到期日（`_m_overdue` / `_m_due_soon`）也跟着走 UTC。本地日跑在 UTC 前面的那几个
小时里，一件当天到期的事显示成「还剩 1 天」而不是「今天到期」，早八点后自动归位。这是**保守**
的那一边：宁可晚一点说「逾期」，也不要早一点说——后者是对着客户的文件说瞎话。

## 门：必须钉钟，不许读运行时的 `date.today()`

这个 bug 只在「本地日 != UTC 日」时发作，所以**一条 15:00 跑绿的测试对它一无所知**。本轮亲历：
发现时 00:29（红），写修复时 09:39（同一条测试自己变绿，代码一个字没改）。

新增 7 条（`tests/test_decision_grading.py`）：

1. **`test_staleness_is_decided_in_one_timezone`（4 条参数）** —— 钉住两个跨日方向相反的真瞬间：
   - `_UTC_AHEAD` = `2026-08-13T16:30Z`（UTC+8 机器上本地已 08-14）
   - `_UTC_BEHIND` = `2026-08-14T02:00Z`（UTC-5 机器上本地还是 08-13）

   判据落在**阈值那一天**（`STALE_EVIDENCE_DAYS=45`）：差一天不命中、恰好踩线命中。
   🔴 选阈值边界不是随手挑的——差一天的 `as_of` 正好把这两个答案对调，这是对时区错位**唯一有牙**
   的位置。离阈值远的用例（「刚传的资料不算旧」）两种实现都绿，证不出任何东西。
   走的是 `decision_cards()` **不传 `as_of`** 的默认路径，因为生产就走这条
   （`service/ingest_api.py:256,260` 调的是 `ctx.decision_cards(forms=forms)`）。

2. **`test_the_old_local_clock_really_flipped_these`（2 条，专属变异）** —— 把 `today_utc` 换回
   「服务端本地日」那一套（把钉住的瞬间换算到宿主时区再取 `.date()`，正是 `date.today()` 当时
   干的事），上面那两条判据必须**翻面**。翻不过去 = 我挑的 age_days 对时区错位不敏感，那条绿着
   也证不了修复。两个方向都验，因为代价不对称：**假红吵、漏报静默**，只钉一头等于默认另一头不会发生。

3. **`test_the_module_reads_the_wall_clock_in_exactly_one_place`（结构闸）** —— 按 AST 找调用节点，
   全模块只许有一处 `datetime.now()`（在 `_utc_now` 里）。
   不是洁癖：这个 bug 的成因就是**第二处**读钟悄悄和第一处分了家；能长出第三处，同一个 bug 就能
   换个规则再来一次。而且上面那些钉钟测试全都建立在「钉住 `_utc_now` 就钉住整个模块」这个前提上
   ——多一处直接读钟的，那些测试会**静默**地不再钉得住它。
   🔴 按 AST 不按文本：`date.today()` 在本模块 docstring 里被引用了好几次（讲的正是这段历史），
   扫字符串会把注释当病灶。

另外修了**既有测试自己的**那行错：
`test_a_freshly_claimed_sample_team_is_not_told_its_material_is_stale` 里
`assert _uploaded_day(...) == date.today()` —— 这行断言自己就是 UTC 比本地，那 8 小时里必红，
且红的是断言本身不是被测行为。改成 `== today_utc()`。

## 验了什么

- **born-red（代码级，跑过不是推的）**：把 `today_utc()` 改回 `return date.today()` 整跑一遍 →
  3 条红：`test_staleness_is_decided_in_one_timezone[UTC+8·差一天没到线]`（正是那个用户可见的
  假红）、`test_the_old_local_clock_really_flipped_these[ahead-of-utc]`（它的对照前提断言逮到
  「修好的实现」已经不对了）、结构闸。还原后 123 passed。
  ⚠ 只有 4 条参数里的 1 条翻红，因为 `date.today()` 会绕开钉住的钟去读**真**今天（恰好是
  08-14，与 `_UTC_BEHIND` 撞上）。这正说明代码级 born-red 本身是**依赖日期**的；**确定性**的那份
  证据是 `test_the_old_local_clock_really_flipped_these`，它全程在进程内钉钟，哪天跑都一样。
- **结构闸真有牙**：restore 那轮它红了；平时它绿着而模块 docstring 里有一堆 `date.today()` 字样
  —— 证明 AST 那条路真的没把注释当病灶。
- **离线默认电池**：`cd eval-harness && python -m pytest -m "not smoke and not seedgate and not
  needs_keys and not needs_db"` → **4225 passed / 154 deselected / 4 xfailed**，全绿。
  签名两条都对：结尾是 `deselected` 不是 `skipped`，路径是 `tests/...` 不是 `eval-harness/tests/...`。

## 留给下一个人

- **feat 号**：这里取 **feat-105**。feat-104 已被并行的 #97 线（`claude/suspicious-satoshi-8ac6e5`，
  未合）占用，虽然它在 `main` 上还空着——先避开，免得两条线合的时候撞号。
- 本线**没有**动 `progress.md` 和 `.issues/README.md`（跨线合成文件归主检出 integrator；
  README 的自查数字已被别的并行线漂到过期：写 44 目录/201 tracked，实测 54/489）。
- 没开 GitHub issue：这条是 #97 会话里当场逮到、当场修掉的，票面证据全在本文件。
  若要补票，复现和修法上面都齐了。
