# 回执 · 合并 feat-105 进 main（issue #103）

- 票：[#103](https://github.com/daniel-qian/avery/issues/103) · feat-105
- 合并提交：`032c7e8`（`claude/stale-date-boundary` @ `4971f85`，1 个提交，`--no-ff`）
- 日期：2026-08-14 · 本轮性质：**合并 + 复验，零新开发**
- 上游证据：本目录 `session-handoff.md`（原线自己的回执）

---

## 0. 一句话

原线的结论**全部复现**，包括它自己标注为「依赖日期」的那条。这条已可关票。

---

## 1. 审核：我自己验的，不是照抄

### 1.1 判据的构造经得起看

| 看点 | 实况 |
|---|---|
| 尺子有没有长在被量的东西上 | `_pin_clock` 钉的是 `_utc_now`，**不是** `today_utc`——钉后者等于把被测的那层归一逻辑一起换掉 |
| 结构闸的期望值 | **手写**成 `["_utc_now() -> datetime.now()"]`，不从扫描结果回填。回填过的门在被测物缩水时会跟着缩水、永远绿（本仓踩过） |
| 结构闸走 AST 还是扫字符串 | 走 `ast.walk` 找 `Call` 节点。本模块 docstring 里 `date.today()` 字样出现多次（讲的正是这段历史），扫字符串会把注释当病灶 |
| 变异是否 faithful | `_host_local_today(offset)` 把**钉住的那个瞬间**换算到宿主时区再取 `.date()`——正是 `date.today()` 当时干的事，不是随手造一个错值 |
| 判据落点 | 落在 `STALE_EVIDENCE_DAYS=45` 的**阈值边界**（44 不命中 / 45 命中）。差一天的 `as_of` 正好把这两个答案对调；离阈值远的用例两种实现都绿、证不出东西 |
| 两个方向都钉了吗 | 钉了。`ahead-of-utc`（假红，吵）与 `behind-utc`（漏报，静默）各一条 |

### 1.2 严重度：原线说「生产没中」，我独立查了，成立

- `eval-harness/Dockerfile` 是唯一的 Dockerfile，`FROM python:3.11-slim`，**不设 `TZ`、不装 tzdata**。
- `scripts/` `docs/deploy/` 下**没有任何一处**给生产容器设 `TZ`（全仓 grep）。

→ 容器跑 UTC，本地日 == UTC 日，两边碰巧一致。这条一直是**潜伏**的，不是正在伤客户。
离上线只差一个 `TZ=Asia/Shanghai`（境内部署最顺手的那个动作）。

### 1.3 🔴 #103 票面有两处要更正（留在这儿，免得后人照票读）

1. **§3 说「生产在法兰克福 = UTC+1/+2，暴露窗口比本机小但不是零」** —— 讲的是**宿主机**，不是容器。
   容器不继承宿主时区（见 1.2），实际窗口是**零**。

2. **§3 说「`R-STALE-EVIDENCE` 的阈值远大于 1 天，所以今天不会当场把新资料判成陈旧」——理由是错的。**
   差一天不需要「够到 45 天」，它只需要把某个主体**挪过**阈值：
   - 44 天的资料被算成 45 → 假红「你手上最新的资料也 45 天没更新了」；
   - 45 天的资料被算成 44 → **静默漏报**（这头更贵）。

   原线的两条判据钉的正好就是这两格。凡 `A − B > 阈值` 型判据，一天的错位在**边界**上永远是致命的。

---

## 2. born-red：我自己撞的

把 `today_utc()` 的实现换回 `return date.today()`（手工 Edit，不用 stash——stash 是仓库全局的），
跑 `tests/test_decision_grading.py`：

```
FAILED test_staleness_is_decided_in_one_timezone[UTC+8 · 差一天没到线]
FAILED test_the_old_local_clock_really_flipped_these[ahead-of-utc]
FAILED test_the_module_reads_the_wall_clock_in_exactly_one_place
3 failed, 120 passed
```

与原线记的**逐条一致**（含「4 个参数只红 1 个」那条自陈——`date.today()` 会绕开钉住的钟去读真今天）。
还原后 123 passed，工作树 `git diff HEAD` 为空。

🔴 **这次复现的关键在于跑的时刻：本地 11:09**，即在「本地日 == UTC 日」的那十六小时里。
**旧 bug 在这个时段本身是隐形的**——原线正是在 09:39 看着同一条既有测试自己从红变绿、代码一个字没改。
所以上面这 3 条红，牙全部来自**进程内钉钟**，与墙上时钟无关。这就是「哪天跑都算数」那句话的证据，
读代码证不出来。

---

## 3. 合并树整批复验

| 门 | 合并前 main（`1c12e3d`） | 合并后（`3b643dc`，含 #96） |
|---|---|---|
| 离线全仓 `-m "not smoke and not seedgate and not needs_keys and not needs_db"`（cwd=`eval-harness`） | 4218 passed · 155 deselected · 4 xfailed / 111.6s | **4265 passed · 0 failed · 155 deselected · 4 xfailed** / 138.1s |
| `-m needs_db` 全仓（一次性库 `avery_merge_0814`，`TZ=UTC`） | — | **146 passed · 0 failed · 4278 deselected** / 13m46s |
| `./init.sh`（lint + typecheck + build） | — | **exit 0**，built in 23.72s |

- 4265 = 4218 + **7**（feat-105）+ 40（#96），完全加法、零回归。`deselected` 全程稳定 155。
- 签名两条都对：结尾是 `deselected` 不是 `skipped`；墙上时钟 ~138 秒（离线正确姿势的量级）。

---

## 4. 状态

**#103 可关。** 修 + 判据 + 文档齐，born-red 独立复现，合并树三门全绿。

（同一个 bug 被两个 session 各自逮到：#103 是 #101 收尾电池里掉出来的报告票，feat-105 是 #97
会话里当场逮到当场修的。#103 后开，修在 feat-105 那条线上。）
