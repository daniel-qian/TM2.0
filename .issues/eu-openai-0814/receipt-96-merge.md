# 回执 · 合并 #96 进 main（离线半边）

- 票：[#96](https://github.com/daniel-qian/avery/issues/96)
- 合并提交：`3b643dc`（`claude/dazzling-noether-c151cb` @ `f49dbfc`，2 个提交，`--no-ff`）
- 日期：2026-08-14 · 本轮性质：**合并 + 复验，零新开发**
- 上游证据：本目录 `receipt-96.md` / `session-handoff.md`（原线自己的回执）

---

## 0. 🔴 合并 ≠ 冒烟过了

**真 key 冒烟一次都没跑过**，这次合并没有改变这件事。原线 §4 列的七项——模型名是否真的存在、
OpenAI 是否接受我们这个请求形状（`max_completion_tokens` / 省略 `temperature` / 省略 `tools`）、
工具调用往返、抽取 JSON 质量、`dimensions=1024` 是否受理、真实 429 形状、EU residency 端点——
**全部仍未被真调用碰过**。合进 main 的是「离线替身验过的那半边」。

**`#96` 不关票**，是否关取决于真 key 那一步（凭据墙，归 Danny / 合伙人）。

---

## 1. 审核：我自己验的，不是照抄

### 1.1 与 #89 `failover.py` 的交集：查实了，**没有交集**

`service/failover.py` 本票**一个字节没动**（`git diff main...分支 -- failover.py` 为空）。
它是纯遥测 + 走链模块；链的**组装**在 `brain_factory.advise_chain` / `extractor_factory.extraction_chain`，
本票动的是后者。对 #89 的门 `test_provider_failover_89.py` 的改动是**加强不是放松**：

- `_pin_env` 补上 `OPENAI_API_KEY` / `AVERY_OPENAI_KEY_ENV` 的清理。**不补的话**，本机凡是 export 过
  OpenAI key 的箱子，#89 那一整批链断言都会凭空多出第三家供应商——而且是真供应商进了一条
  自以为钉死了 env 的测试。这条本身就是修了一个既有假绿。
- 新增一条 permutation（`oa_key` 单家 → `["openai"]`），境内两家之间的既有断言一条没改。

### 1.2 与 main 上 #104 的重叠：两处改动在不同行区

两边都动了 `eval-harness/avery/ingest/pg_registry.py`，`ort` 自动合。人工判过：

| | 位置 | 内容 |
|---|---|---|
| #104（已在 main） | L147 `_ensure_schema` docstring | 0002 的 `DROP CONSTRAINT IF EXISTS` 每次开机抢 ACCESS EXCLUSIVE |
| #96（本票） | L67 `_DEFAULT_EMBED_DIM` 上方注释 | 1024 现在是 DashScope 与 OpenAI 的共同落点 |

两处都是注释、互不引用、无语义冲突。schema / 迁移 / SQL 本票一个字没动。

### 1.3 `canonical_kind(kind) or resolve_brain_kind()` 这处改写是等价的

旧写法 `(kind or resolve_brain_kind()).strip().lower()`。逐情形过了一遍：
`None` / `""` / 纯空白都落到 falsy → 走 env（`canonical_kind` 内部先 `(kind or "").strip().lower()`）；
`"  MINIMAX  "` 照旧归一到 `"minimax"`。strip/lower 语义保住了，只多了别名归一。

### 1.4 ⚠ 一处回执**分散表述**、值得单列的事实

原线 §1 表格里写「**境内两家的默认值一个字节没动**」。这句话对**构造默认值**成立
（`token_param="max_tokens"`、`temperature=0.0` 就是境内两家今天的形状）。

但 `OpenAICompatBrain.respond()` 是**境内两家共用**的方法，本票改了它，境内**运行时行为**确实变了两处：

1. **空 `tools` 不再发**。旧代码恒发 `tools=_to_openai_tools(tools)`，抽取走的就是 `tools=[]`。
   现在整个不发。语义等价，但发出去的请求体对 MiniMax/DeepSeek 也变了。
2. **输出预算耗尽从「返回空串」改成抛错**（`finish_reason=length` 且无正文无 tool_calls）。
   MiniMax 的 `<think>` 占 `max_tokens` 就是这个坑，境内也会撞。

两处都是**更正确**的改法（第 2 条修的是「`/advise` 把空串当最终答案发出去、抽取当成这份文档没有实体」
这类无声的谎），原线在「顺手修掉的三个真坑」一节里都披露了，只是没和那句「一个字节没动」放在一起。

🔴 **推论**：本票的待办冒烟不止 OpenAI 那一路。境内那条路（MiniMax）也被改了行为，
**第一次真 key 冒烟应当把 `AVERY_BRAIN=minimax` 也跑一遍**，别只跑 openai。
（离线侧这两条各有对照组判据：`domestic_providers_keep_the_old_request_shape`、
`non_empty_tools_are_still_sent`、`truncated_but_non_empty_answer_is_not_treated_as_an_error`。）

### 1.5 数字：**没复现，但增量精确复现**

原线回执写的是离线 `4257 passed · 151 deselected`、`needs_db 142 passed`。这两个数在合并树上
**一个都没复现**（实测见 §3）。但它的**增量**精确对上：本票 `+40` 条离线测试、`+0` 条 needs_db
（我直接 grep 过：`test_openai_provider_96.py` 里 `needs_db` 出现 **0** 次）。

→ 那两个数是在别的树态上量的，不影响结论。记在这儿只为一件事：**回执里的绝对数字不可转抄**，
可转抄的是增量和签名词（`deselected` / `skipped`）。

---

## 2. born-red：六个变异里我自己重撞了两个（合规风险最高的那两个）

手工 Edit 变异、跑完 `git` 验回逐字节还原（不用 stash——stash 是仓库全局的）：

| 变异 | 我实测红的判据 | 与原线记的 |
|---|---|---|
| `_make_single` 的 openai 分支退回旧写法（`base_url`/`model` 原样传 env） | `test_openai_brain_never_silently_falls_back_to_minimax`<br>`test_minimax_env_cannot_leak_into_the_openai_brain`<br>（2 failed, 38 passed） | **逐条一致** |
| `extraction_chain` 去掉 `PROVIDER_REGION[k] == PROVIDER_REGION[primary]` | `test_extraction_never_fails_over_from_openai_to_a_chinese_provider`<br>`test_the_failover_machinery_is_actually_armed_in_that_same_env`<br>`test_domestic_extraction_never_fails_over_out_to_openai_either`<br>（3 failed, 85 passed） | **逐条一致** |

挑这两个是因为它们守的是**合规**性质：第一个守「配了 OpenAI 实际把用户内容发给 MiniMax」这个
静默出境点，第二个守「欧盟客户的花名册 failover 到境内供应商」。两个都真有牙。

另外顺带确认了 `test_the_failover_machinery_is_actually_armed_in_that_same_env` 不是装饰——
去掉 region 判据它会红，说明它钉的是整条链的**确切内容**，境内热备在同一份 env 下确实是开着的
（不是空真）。

---

## 3. 合并树整批复验

| 门 | 合并前 main（`1c12e3d`） | 合并后（`3b643dc`） |
|---|---|---|
| 离线全仓 `-m "not smoke and not seedgate and not needs_keys and not needs_db"`（cwd=`eval-harness`） | 4218 passed · 155 deselected · 4 xfailed / 111.6s | **4265 passed · 0 failed · 155 deselected · 4 xfailed** / 138.1s |
| `-m needs_db` **全仓**（一次性库 `avery_merge_0814`，`TZ=UTC`，pgvector pg17） | — | **146 passed · 0 failed · 4278 deselected** / 13m46s |
| `./init.sh`（lint + typecheck + build） | — | **exit 0**，built in 23.72s |

- 4265 = 4218 + 7（feat-105）+ **40**（本票），完全加法、零回归。`deselected` 全程稳定 155。
- **needs_db 的 146 vs 你手上的基线 145，不是这两条线的账**：两条分支加的 47 条测试里
  `needs_db` 标记为 **0**；`test_steady_state_bootstrap_takes_no_entities_lock`（#104 带的）
  在 `1c12e3d` 就已在 main 里。离线跑的 `deselected` 跨合并稳定在 155 是独立佐证。
- needs_db 按纪律跑**全仓**不挑文件（#90 那次按文件挑漏掉四条红了一整票的测试）。

---

## 4. 状态与留给下一个人

- **#96 保持 OPEN。** 离线半边已进 main；真 key 冒烟未跑（凭据墙）。
- 第一次真 key 到位时按 runbook §2 跑，**并且把 `AVERY_BRAIN=minimax` 也跑一遍**（理由见 §1.4）。
- ⚠ 本轮跑过 `./init.sh`，所以 `dist/` 现在是**不带 `VITE_AVERY_API_BASE`** 的构建、指向生产域名。
  跑任何上传型门/截图之前先重打 dist 并在浏览器里验 apiBase。
- 一次性库 `avery_merge_0814` 留在本机 docker `teammaster-postgres-1` 里没删（删库属销毁闸）。
