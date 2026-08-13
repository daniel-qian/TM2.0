# 回执 · #96 OpenAI provider 转正（欧盟/海外部署路径）

- 票：[#96](https://github.com/daniel-qian/avery/issues/96) · 分支 `claude/dazzling-noether-c151cb`（worktree `D:\avery-wt-dazzling-noether-c151cb`）
- 日期：2026-08-13 ~ 08-14
- 本轮范围：**离线能做的全做完，停在真 key 冒烟之前**（真 key 属凭据墙，等合伙人开 OpenAI project）

---

## 0. 一句话

三个用户内容出境点（MiniMax 对话+抽取、DeepSeek 热备、DashScope embedding）现在各有一个
OpenAI 对家，一组 env 一起换；**schema / 迁移零改动**（`text-embedding-3-small` 传
`dimensions=1024`，正好落在既有的 `avery.materials.embedding vector(1024)` 列上）。

⚠ **验的是「我们发出去的形状」，不是「OpenAI 收下了」**——全部离线替身。见 §4。

---

## 1. 改了什么

| # | 文件 | 改动 |
|---|---|---|
| 1 | `eval-harness/avery/brain.py` | `OpenAICompatBrain` 的**请求形状可配**：`token_param` / `temperature` / `reasoning_effort`；空 `tools` 整个不发；输出预算耗尽（`finish_reason=length` 且无正文）抛错而不是回空答复。新常量 `OPENAI_BASE_URL` / `OPENAI_MODEL` / `OPENAI_EXTRACT_MODEL`。境内两家的默认值一个字节没动。 |
| 2 | `eval-harness/service/brain_factory.py` | `openai` 那条路显式传 base_url/model（**堵住静默落回 MiniMax**）；`canonical_kind()` 把 `openai-compat`/`compat`/`openai` 归一；`PROVIDER_REGION` 地区家族表；`openai_key_env()` / `openai_base_url()` / `openai_request_shape()` 三个 env 解析器（抽取位复用）。 |
| 3 | `eval-harness/service/extractor_factory.py` | `_EXTRACTION_BRAINS` 加 `openai`（排最后，境内箱子加把 OpenAI key 不掉换主脑）；key 变量名改走函数（`AVERY_OPENAI_KEY_ENV` 可改名）；**热备只在同 region 内发生**；`_make_extraction_brain` 的 `else:<deepseek>` 兜底改成显式分支 + 未知种类报错。 |
| 4 | `eval-harness/avery/embeddings.py` | 抽出 `_OpenAICompatEmbedder` 共用体（DashScope 与 OpenAI 都是 OpenAI 形状的 `POST /embeddings`），新增 `OpenAIEmbedder` + `make_openai_embedder` + `_OPENAI_KINDS` 路由。**花钱闸只有一个落点**（共用体的 `_embed_batch`），第二家不可能漏配。 |
| 5 | `eval-harness/avery/ingest/pg_registry.py` | 注释：1024 这个数现在是两家共同落点；同维 ≠ 同向量空间。 |
| 6 | `eval-harness/requirements*.txt` | `openai>=1.40` → `>=1.40,<3`（票面避坑项：v3 换了默认 HTTP 客户端；第一次接真 key 时不想同时验两件事）。 |
| 7 | 测试白名单 | `test_provider_failover_89.py` 的 `_pin_env` 扩到 OpenAI 两个变量 + 补一条 permutation；`test_service_smoke.py` 的 `_key_for`/`_live_kind` 加 openai；`test_llm_extract.py` 的 keyless 用例补 delenv（不补的话那条从此假绿）。 |
| 8 | 配置文档 | `eval-harness/service/.env.example`（§1 OpenAI 块 / §1b 抽取 / §2 embedding / **新 §6b 欧盟隔离纪律**）、根 `.env.example`（EU 目标预设 + 「别往这儿放 key」）、`docs/deploy/dual-deploy-runbook.md`（部署矩阵**加一列 🇪🇺 EU**、新 §1.1 隔离纪律 + `/health` 自查表、§2 预检加一行 + 「离线验到哪儿为止」的碑）、`scripts/deploy/dual-smoke.sh` 用法行。 |
| 9 | 新测试 | `eval-harness/tests/test_openai_provider_96.py`（40 条） |

### 顺手修掉的三个真坑（都不是本票要求的，但都在这条路上）

1. **静默落回 MiniMax**：`OpenAICompatBrain` 的构造默认值全是 MiniMax 的。旧的 openai 分支把
   `AVERY_OPENAI_BASE_URL`/`MODEL` 原样（可能是 `None`）传进去——**只配了 `OPENAI_API_KEY` 的欧盟
   箱子，实际会拿 OpenAI 的 key 去连 MiniMax 的端点**。对欧盟实例这不是配置错误，是出境。
2. **空 `tools` 数组**：抽取走的就是 `tools=[]`（`llm_extract._call_once`）。境内两家收下不吭声，
   OpenAI 官方拿它当 400（`Invalid 'tools': empty array`）。现在空列表整个不发（语义等价，三家都对）。
3. **输出预算被推理吃光 = 空答复**：MiniMax 的 `<think>` 占 `max_tokens` 那个老坑，在 OpenAI 上
   以不可见的 reasoning tokens 重演。旧代码此时返回 `text=""`——`/advise` 会把空串当最终答案发出去，
   抽取会当成「这份文档没有实体」。两者都无声。现在抛错，交给既有降级路径 + `/health` 遥测。

### 🔴 合规反向闸（第二把锁）

欧盟实例的一线纪律是「env 里根本没有中国 provider 的 key」+ `AVERY_BRAIN_FAILOVER=off`——那是
第一把锁，靠人执行。代码里加了第二把：`PROVIDER_REGION`（`minimax`/`deepseek`=cn，
`claude`/`openai`=intl），**热备只在同 region 内发生**。万一哪天有人把一把 `MINIMAX_API_KEY` 落在
欧盟箱子上又忘了关 failover，抽取也不会把欧盟客户的花名册送去境内供应商。反方向同样挡住。

`/advise` 那半边的对应性质钉在数据上：`_PAIR` 里不许出现跨 region 的一对（一条测试扫它）。
两条路各一把锁、各一道门——没有 belt-and-braces 式的互相免疫。

---

## 2. 模型与 env（票面选型表落地）

| 角色 | env | 默认值 | 备注 |
|---|---|---|---|
| advisor | `AVERY_BRAIN=openai` + `AVERY_OPENAI_MODEL` | `gpt-5.6-terra` | 难案子可升 `gpt-5.6-sol` |
| 抽取 | `AVERY_EXTRACTOR_BRAIN=openai` + `AVERY_OPENAI_EXTRACT_MODEL` | `gpt-5.6-luna` | 与 advisor **分开配**（境内两家是共用一个 `*_MODEL` 的，OpenAI 这边票面要两个不同模型） |
| embedding | `AVERY_EMBEDDINGS=openai` | `text-embedding-3-small` @ `dimensions=1024` | 与 DashScope 共用 `AVERY_EMBED_MODEL`/`AVERY_EMBED_DIM`——**换家时把上一家的模型名留在那儿 = 每批 404 + 静默落 keyword**，模板里立了碑 |
| 输出上限 | （无 env，常量 32768） | 32768 | 要压 reasoning 成本拧 `AVERY_OPENAI_REASONING_EFFORT`，别砍这个数 |
| 兼容端点逃生口 | `AVERY_OPENAI_TOKEN_PARAM` / `AVERY_OPENAI_TEMPERATURE` | 新参数名 / 不发 | 只认老名字的第三方兼容端点用；连 OpenAI 官方时别动 |

---

## 3. 验收

| 门 | 结果 |
|---|---|
| 离线全套 `python -m pytest -m "not smoke and not seedgate and not needs_keys and not needs_db"`（cwd=`eval-harness`） | **4257 passed · 151 deselected · 4 xfailed**（基线 4217 + 本票 40，零回归） |
| 新增 `tests/test_openai_provider_96.py` | **40 passed** |
| `-m needs_db` 全仓（throwaway 库 `avery_96_test`，docker `teammaster-postgres-1` / pgvector pg17） | 见 §3.1 |
| mock / heuristic / keyword 三条离线默认路径 | 不受影响（它们与 provider 种类无关；4257 那一跑就是它们） |

结尾是 `deselected` 而不是 `skipped` = `eval-harness/pytest.ini` 的离线 addopts 生效了（cwd 对）。

### 3.1 真库

（见下方"needs_db"小节，跑完填。）

### 3.2 born-red / 变异自检

（见下方，跑完填。）

---

## 4. ⚠ 哪些验过了、哪些还没被真调用碰过

**离线替身验过的**（本地假 HTTP 服务器 / 假 `urlopen`，零真网络零真钱）：

- 我们**发出去的请求形状**：参数名（`max_completion_tokens` 而非 `max_tokens`）、不发 `temperature`、
  空 `tools` 不发、`reasoning_effort` 只在配置时发、抽取位用抽取模型 + 大输出预算。
- 我们**对回应的处理**：429 → `extraction_mode=degraded` + `/health` 上 `providers.openai.ok=false`；
  截断且无正文 → 抛错并记为供应商失败；截断但**有**正文 → 正常返回（对照组，防尺子太宽）。
- **链的组装规则**：openai 单家成链、跨 region 永不 failover（且同一份 env 下境内两家的 failover
  **确实是开着的**——不然那条判据就是空真）、三个别名归一、auto-pick 顺序、强制 heuristic 优先。
- **embedding**：请求 `dimensions=1024`（期望值取自迁移 DDL 本身，不是代码常量）、L2 归一化、
  按 `.index` 排序、64 条一批、每批走花钱闸、闸满时**在可计费请求之前**拒绝。
- **端到端 `/ingest`**：上传 → 走 OpenAI 那条链 → 人卡落地 → `/health` 四个字段自洽。
- **配置文档同步**：代码里读的每个 `AVERY_OPENAI_*` 都必须出现在 `service/.env.example`（自扫描，
  以后加新旋钮它会自己跟上）；runbook 必须带欧盟三条纪律的字面值。

**还没被真调用碰过的**（等合伙人开 OpenAI project → 真 key）：

1. `gpt-5.6-terra` / `gpt-5.6-luna` / `text-embedding-3-small` **这三个模型名真的存在且可用**。
   假服务器对任何 `model` 字段都点头。
2. **OpenAI 真的接受我们这个请求形状**——`max_completion_tokens` 是不是对的参数名、省略
   `temperature` 是不是必要、`reasoning_effort` 的合法取值、省略 `tools` 会不会有别的要求。
   这些是按公开文档 + 票面调研写的，**没有一次真握手证过**。
3. **工具调用往返**（`/advise` 的 agentic loop）在真 OpenAI 上的行为：`tool_calls` 的形状、
   `strip_reasoning` 对它的输出是否多余、多轮 `tool_result` 消息是否被接受。
4. **抽取的 JSON 输出质量**：全仓靠 prompt + 后置解析（无 `response_format`）。M3 上调过的那套
   prompt 在 gpt-5.6-luna 上能不能稳定吐出合法 JSON，只有真跑知道。
5. **`dimensions=1024` 真的被受理**，以及召回质量（1024 维截断版 vs DashScope v4）在中文语料上如何。
6. **429 / 配额 / spend hard limit 的真实形状**——假服务器回的是我们自己造的 429 体。
7. openai SDK 与 EU residency 端点（`AVERY_OPENAI_BASE_URL` 换掉那一步）的组合。

第一次真 key 到位时按 runbook §2 跑：`AVERY_BRAIN=openai scripts/deploy/dual-smoke.sh`，
外加 `/advise`、`/ingest`、embedding 各一发，看 `/health` 的四个字段（表在 runbook §1.1）。

---

## 5. 没做 / 留给别人的

- **真 key 冒烟**：凭据墙（合伙人开 project → spend hard limit → 自签 DPA → EU residency 申请）。
- **已有 context 的重嵌入**：换 embedder 后旧向量作废（向量空间不兼容）。本轮没写迁移脚本——
  欧盟实例按新库/新 context 起才是干净路径，runbook §1.1 写了这一条。真要给存量库补，那是另一票。
- **`openai<3` 的上界**：真 key 冒烟过之后单独提一票升 v3（HTTPX2）。
- **根 `.env.example` 的「OpenAI 列」**：那个文件是**前端**构建期模板（`VITE_*`，全部会被打进公开
  bundle），放任何 provider key 都是错的。按票面意图落成了「🇪🇺 EU 目标预设 + 指向后端模板的指针
  + 别放 key 的红字」。后端那张矩阵在 `service/.env.example` 和 runbook 里。
