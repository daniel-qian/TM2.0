# session-handoff · feat-048 停用词表统一（r2 的遗留跟进，**不是 round 4**）

> 写于 2026-07-15 22:50。**未提交、未合并** —— 这是 Danny 拍板的（见下 §为什么没提交）。
> 本文件是**本线专属**交接。没碰 `.issues/lite-live-v02-0713/session-handoff.md`（那是 feat-047
> 集成者的叙事），也没碰 `progress.md` / 根 `session-handoff.md`（AGENTS.md：跨线综合归主检出集成者）。
> 文件名带 `-stoplist-unification` 后缀是**故意的**：feat-048 底下同时有 ≥4 条线在飞
> （team-axis r4 / 049 HOLE1-2 / b1 coinage / b3 villa-negation），叫 `session-handoff.md` 必撞。

## 干了什么

让 **LLM 抽取路复用唯一一份停用词表**，而不是继续养第二份手抄的。

- `llm_extract._NOT_A_PERSON`（正则，纯英文）→ 删除，换成 `llm_extract._not_a_person()`。
- 它现在读 `extract._NOT_NAME` **＋ `extract._INDEX_TOKEN_RE`**。
- 只留三个真·正则形状的模式在本地：`case-id.*` / `sheet.*` / `\d+`（没有字面词可列）。

改动文件：`eval-harness/avery/ingest/llm_extract.py`（实现）、`eval-harness/tests/test_llm_extract.py`
（+16 条门）、`extract.py` 与 `test_cjk_identity.py`（**仅注释**，见下 §注释和代码分了家）。

## 为什么要做（守的是哪种失败）

表头「姓名」「职位」「部门」不是人。不拦，团队页就会长出一个叫"姓名"的同事 —— 就是 feat-039 那个
"No." bug 的中文版。

关键点，别想岔：`_SYSTEM` 提示词（llm_extract.py:76-77）**已经**告诉模型这些不是人。那还要停用词表干嘛？
**因为这张表存在的唯一意义就是模型不听话时兜底** —— 它守的就是"模型犯浑"这一种情况，所以它不能
反过来假设模型听话。而它当时是纯英文的。

## 证据

**门先行，亲眼看红。** 4 条中文表头门 + 1 条规则级门 **出生即红**，然后才动实现。11 条 born-green
安全催（`case-id.*`/`sheet.*`/`\d+` 不许被换掉）从头到尾绿。没有为了让门过而放水任何断言。

**漏洞比任务描述的大。** 门写成**规则**（拿 `_NOT_NAME` 里**每一个词**去过 LLM 路）而不是举 4 个例子，
炸出了任务没提到的事：不只中文缺，**英文也漏了 18 个** —— `date` `dept` `dept.` `designation`
`directory` `id` `index` `manager` `notes` `person` `phone` `project` `roster` `s.no` `sl` `sn`
`sr` `seq` `#`。两份表是**中英文双向**都走散了。举例子式的门，粘 4 个中文词就能过，这 18 个会原样留着。

**「序号」的坑（差点漏掉你点名要拦的词）。** 「序号」**不在** `_NOT_NAME` 里 —— 它单独待在
`_INDEX_TOKEN_RE`。启发式路本来就是**两个一起查**（`_looks_like_name` → `_han_name_ok`）。所以只按
字面"复用 `_NOT_NAME`"，「序号」照样漏，而它正是任务点名的四个词之一。最终实现两个一起读。

**测试**（`cd D:/avery/eval-harness && python -m pytest -q -m "not needs_db and not needs_keys and not seedgate"`）：

| 时点 | 结果 |
|---|---|
| 任务给的基线 | 622 passed（**过时**，早于工作区里未提交的 r2/r3） |
| 我动手前实测 | 700 passed |
| 我收工时 | 716 passed / 0 failed（+16 = 我的） |
| 22:47 复跑（其他线又加了 191 条） | **907 passed / 0 failed / 8 xfailed** |

907 那次是在 team-axis r4 改完 `_INSTRUCTIONS` 之后跑的 —— **我的改动和他们的不打架**（不同关注点、
不同区域：我动 `_not_a_person`，他们动提示词的 team 规则）。

## 门在哪、为什么这么写

`tests/test_llm_extract.py` §(d2)：

- `test_chinese_header_cells_refused_even_from_the_model[姓名/职位/部门/序号]` —— **正反两半写在同一条
  断言里是故意的**：`assert {p.name for p in res.people} == {"陈思雨", "孙浩"}`。想用"把所有汉字都拒了"
  来糊弄，这条直接红。
- `test_llm_path_reuses_the_whole_heuristic_stop_list` —— **这条才是"一份表"的门**。遍历 `_NOT_NAME`
  全表打 `_build`。它**只能靠真去读那份表来满足**，粘词过不了。以后往 `_NOT_NAME` 加词，LLM 路白嫖覆盖。
  用 `_build` 而不是 `extract()` 是有讲究的：全是表头的 payload 建出空结果，`extract()` 会落回启发式，
  于是回答的是启发式自己的停用词表 —— 门就测错了路。chunk 40 是因为 `_build` 每文档限 40 人。
- 11 条 born-green：`_NOT_A_PERSON` 有三个模式在 `_NOT_NAME` 里没有字面词，重构不能拿一个洞换另一个洞。

## 顺手修的

3 处注释指向 `_NOT_A_PERSON` —— 一个已经不存在的符号。其中 `test_cjk_identity.py:45` 那处**在撒谎**，
声称两份停用词表"already enumerate header words in both languages"。**这句假话很可能就是这个洞活过
round 2 的原因之一** —— 有人读了它，信了，就不查了。现在 `_NOT_NAME` 明确标成两条路唯一真相源。

**我自己也犯了同一种错，已修**：我一开始把注释标成 "feat-048 round 4"，但 **R4 是 team-axis 那条线**
（`test_cjk_team_axis_r4.py` 开头自述 "R4 — the TEAM axis on the LLM path"）。我抢了人家的编号，等于
在共享代码里插了个假声明 —— 正是我上面骂的那种。已全部改成 "round-2 follow-up"（5 处）。
**本线不要认领任何 round 号**，r3/r4 都名花有主了。

## 为什么没提交（Danny 22:47 拍板）

**这个 session 没有东西可合。** 我的 worktree 分支 `claude/heuristic-visvesvaraya-6a1ec7` 还停在
`5d32e4f`，**一行我的活都没有** —— 任务给的是绝对路径 `D:\avery\...`，我全程在**主检出**
（`feat/047-v02-engine-sync` @ `b20ec23`）上干活，自己的 worktree 从没用过。

**我的活躺在主检出里没提交，且和别人在飞的活缠死了。** 同一个检出里 ≥5 条线的未提交改动：
feat-048 r2/r3/r4、feat-049 HOLE1/HOLE2、b1 coinage、b3 villa-negation，外加 `parse.py`
`redline.py` `package.json` `.gitignore` gates。

**别的 agent 在我改的同一个文件里活着。** `llm_extract.py` 有个 `_INSTRUCTIONS` hunk 不是我写的
（team-axis r4 的透传改写：「别墅销售组」原样带回、不许映射成英文桶）。写入时间 22:03–22:23，
我问的时候 22:47。

所以怎么切都会带走别人没收工的活：`git add -A` = 5 条线糊成一个提交（可能抓到写一半的文件）；
只提交我那两个文件也不行 —— `llm_extract.py` 里已经躺着人家的 team-axis 改写。

→ **提交/合并归主检出集成者**，等 r4/049/b1/b3 收工一起打包。我这边零破坏性动作。

## 注释和代码分了家（接手的人注意）

选了"不提交"就有这个代价，明说：

- `extract.py` 我的注释改动，和 r2/r3 那 **449 行未提交**缠在一起，摘不出来。
- `test_cjk_identity.py` 我的 2 处 docstring 改动，在一个**未跟踪的 61KB** 文件里（不是我的文件）。

这些注释描述的是**已经在工作区里生效的代码**，所以内容是准的；但谁先提交谁就会带走它们。
集成者拆包时**别把这几处注释当孤儿删了** —— 它们是 `_NOT_NAME` 成为唯一真相源这件事的说明。

## 交接给下一棒

1. **别再手抄第三份停用词表。** 往 `extract._NOT_NAME` 加词即可，两条路自动覆盖；纯正则形状的
   （前缀/纯数字）才进 `llm_extract._NOT_A_PERSON_EXTRA`。
2. **加中文表头词时想一下 `_INDEX_TOKEN_RE`** —— 序号/编号/序號/編號 在那儿，不在 `_NOT_NAME`。
3. `test_llm_path_reuses_the_whole_heuristic_stop_list` 是防漂移的门。**它红了不代表它坏了**，
   多半是有人往 `_NOT_NAME` 加了个词而 LLM 路没跟上（那正是它该红的时候）。别为了让它绿而删词。
4. 我**没跑** @seedgate / needs_keys / needs_db（要真 key/库）。本线是纯离线机器层，
   用脚本假脑子，不碰网络 —— 真模型上的抽取**质量**归 @seedgate 那层管。
