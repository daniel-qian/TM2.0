# 回执 · #86 「清空这份档案」（`context_id` / `owner_token` 不变）

> 票：<https://github.com/daniel-qian/avery/issues/86>　设计正源：`design-plan.md` §5.1 + §6.2
> 日期：2026-08-10　分支：本地 `main`（**未 push**）　迁移：**不需要**（没动 schema）

## 一句话

后端两条腿的 `empty_context()` + `POST /team/{id}/empty` + transport/store 全通，
**离线 4076 passed · 0 failed**（4049 基线 + 本票 27 条）、**真库 @needs_db 全绿**、
新门 `verify-archive-empty`（zone A）**25 PASS · 0 FAIL**、**8 条变异逐条验过**。
UI 挂点按票面留给 #84 —— **但本票新造出一个「有档案、零文件」的状态，那一屏现在的空态文案是假话**，
见下面「欠账②」，那是 #84 必须一起收的。

---

## 1 · 交付清单

| 文件 | 干了什么 |
|---|---|
| `avery/ingest/registry.py` | `ContextRegistryProtocol.empty_context` + 内存腿实现 + 模块级 `_empty_extraction_in_place` |
| `avery/ingest/pg_registry.py` | pg 腿实现（**显式 DELETE**，不复用 `put()`）；顺手给 `delete()` 补了一句「别拿它当清空用」 |
| `service/ingest_api.py` | 新路由 `POST /team/{context_id}/empty`（复用 `authorize_context` / `extract_owner_token`，回 `_team_payload`） |
| `service/upload_guard.py` | `_route_for` 认得 `/team/{id}/empty` → 共用 `ingest` 表盘（边缘限流） |
| `tests/test_context_empty_t86.py` | **新** · 21 条离线 + 3 条 `@needs_db` |
| `tests/test_registry_contract.py` | +6 条走 `impl` 参数化（memory 离线 + postgres `@needs_db`）的**两腿一致性**判据 |
| `tools/verify-archive-empty.mjs` | **新门** · zone A 上传型，25 判据 |
| `tools/run-battery.mjs` | ROSTER 收编（A 区末尾，B/C 之前） |
| `src/lite2/transport.ts` | 可选方法 `emptyContext(contextId)` + live 实现 |
| `src/lite2/store.ts` | 状态 `archiveEmptying` / `archiveEmptyError`（**两抄本锁步**：`adoptContext` + `resetLiteCompanyData`）+ 动作 `emptyArchive()` |

**没动**：任何 `.tsx` / `.css` / i18n 键。→ **像素基线 54 张按构造不可能漂**（零渲染改动），
`i18n-orphans` 实跑仍 **0 孤儿**。

## 2 · 语义裁定（票面清单，落成判据）

**清掉**：`source_documents`（原件字节＋清单）· `source_files` · `materials`（含向量）·
`entities` 全五类（人/项目/信号/方法卡/冲突）· `granularity` · facts.md / notes.md 重物化成空。

**留下**：`context_id` · `owner_token` · `name` · 对话历史 `advise_runs`（含 `thread_id`）·
`company_notes` · 常驻表单模板 · **员工已交答卷 `form_submissions`**（含 share_token，外面那条 H5 链接照旧解析得回来）·
`asks` · `account_contexts` · `ephemeral` 标记。

🔴 **那颗明知的雷已钉成正面判据**（`test_refiling_a_submission_after_empty_repopulates_the_archive`）：
留着答卷 = `POST /team/{id}/forms/{sub}/ingest` 之后实体会回来，**「清空」不会自己保持为空**。
钉它有两个用处：下一个人不会把它当漏洞顺手「修」成静默丢弃员工数据；确认文案也不许说
「清空之后这份档案就永远是空的」——那是假话。

## 3 · 票面那三条「不能复用的既有件」—— 核实回执

| 票面说法 | 核实结果 |
|---|---|
| `pg_registry.delete()` 是 context 级、正好是反面 | ✅ 成立。已在它 docstring 上立碑，且**永不挂 HTTP**（路由选 `POST /empty` 而非 `DELETE /team/{id}` 的理由写在路由 docstring 里） |
| `test_registry_protocol.py` 禁止内存腿长出 `delete()` | ✅ 成立。新方法叫 `empty_context`，那条 pin 原封不动仍绿 |
| `clear()` 语义是清掉**所有** context，别拿它凑数 | ✅ 成立，没碰 |
| **「不能复用 `put()`」** | ✅ **结论成立，但票面给的理由不是今天真正起作用的那一条** —— 见下 |

### 🔴 订正一条票面前提：`put()` 的字节/向量回填今天**咬不到**清空

票面（与 §6.2）写的是「`put()` 会从 `_prior_src_bytes` / `_prior_mat_vecs` 回填旧字节与旧向量」。
**M6 变异实测推翻了这个机制**：空 ctx 插 0 行，那两条 `UPDATE ... FROM` 匹配不到任何行，
`entities` / `materials` / `source_documents` 三张表**照样是空的**（M6 下这三条判据全绿）。

真正把 M6 判红的是**另一条路**，而且更隐蔽：

> `put()` 只在 facts.md **不存在**时才重物化。而复用 `put()` 的写法要先 `get()`——
> `get()` 是**比对后写盘**（DB 是正源，本地过期就刷新），于是它把库里那份**旧** facts.md
> 原样写回磁盘；`put()` 随后读到的就是这份旧文本，再原样存回 `memory_files`。
> 净效果：**行删干净了，议事室的 recall 面却还引得到已经清掉的原文。**

两条路指向同一个结论（用显式 DELETE），所以设计决定不变；但**下一个人别照票面那句去找回填**，
它不在那儿。判据落在 `test_pg_empty_survives_a_brand_new_registry_instance`。

## 4 · 变异台账（8 条，逐条独立跑、跑完还原）

| # | 变异 | 预判 | 实测 |
|---|---|---|---|
| M1 | store 的 `emptyArchive` 改成本地 `resetLiteCompanyData()` 假装清空 | 门 ②⑤a 红 | ✅ **门 9 FAIL**（②无请求 · ②无 token · ③名册 1→0 · ④三条 · ⑤a 1→0 · ⑥两条） |
| M2 | 清空成功后顺手换一个新档案身份（「清空＝另开一份」） | 门 ③ 红 | ✅ **门 10 FAIL**（③ 四条全红，含 `GET /team` 回 404） |
| M3 | 内存腿不清 `source_documents` | 门 ④⑥ + 离线套红 | ✅ **门 2 FAIL + 离线 8 FAIL** |
| M4 | 内存腿不 `materialize_memory` | 离线套红（门大概率看不见） | ✅ **离线 3 FAIL**。⚠ **门未在 M4 下跑过**——记账，不假装验过 |
| M5 | 路由投清空**前**那份 ctx 快照（不 re-`get()`） | 只有 pg 腿红 | ✅ 实测**离线 20/20 全绿、挂 DB 才红 1 条**——正是「pg 腿的洞绿着上线」的形状。**已补一条离线判据把这块暗区封上**（见下） |
| M6 | pg 腿复用 `put()` 凑数 | 票面说回填会复活字节 | ✅ **红 1 条**，但机制是 facts.md 陈旧回写，不是回填（见 §3 订正） |
| M7 | pg 腿去掉 `memory_files` 的 DELETE+INSERT | 两腿文本不一致 | ✅ **红 2 条**（T86 + contract 的 pg 参数） |
| M8 | 内存腿只清 people/projects/materials（漏四条） | 「全清」那条红 | ✅ **红 1 条**（但见下，这条差点是个门洞） |

### 写门过程中自己逮到的两个门洞（都已封）

**洞①（M5 那条）· 离线永远看不见的暗区。** 端点是 `ctx = authorize_context(...)` → 清空 → 投 payload。
内存腿的 `get()` 返回**活对象**，所以「投旧 ctx」与「重新 get 再投」结果完全一样——离线一条都不会红。
pg 腿的 `get()` 每次重建**快照**，那份 ctx 是清空**之前**的世界，回执会把刚清掉的那一屏原样发回去
（屏上就是「点了没反应」）。
**修法不是再写一条 `@needs_db`**（默认电池照样反选它），而是把 pg 的快照语义搬到离线来：
新判据 `test_empty_endpoint_reprojects_after_emptying_not_the_stale_snapshot` 用 monkeypatch 让内存腿的
`get()` 每次返回深拷贝，于是这块暗区在**离线电池里**就有牙了。

**洞②（M8 那条）· 「按字段遍历」还不够。** 判据本来只对着真语料断「七条列表全空」，
但那份语料只喂得饱 **4 条**（people 2 / projects 1 / materials 9 / granularity 1；
**signals / playbooks / conflicts 天生为空**）。于是「漏清 signals」这条变异**活得下来**。
现在测试在清空前往**每一条**列表里塞一颗哨兵对象，判据这才对七条里的每一条都有牙。
（哨兵带 `as_facts_lines()` / `.text` 鸭子面，是为了让漏清的失败形态是**判据红**而不是重物化时一声
AttributeError——崩掉也算红，但读日志的人看到的是堆栈不是结论。）

## 5 · 验证账

- **离线后端全套**：`TZ=UTC` + 三件套 + `AVERY_DEMO_SEED_DIR=tests/fixtures/demo-seed`
  → **4076 passed · 0 failed · 133 deselected · 4 xfailed**（37s）。
  基线 4049 + 本票 27（21 离线 T86 + 6 条 contract 参数化的 memory 腿）= 4076，**对得上**。
- **真库套**（throwaway `avery_t86_test`，docker `teammaster-postgres-1` / pgvector pg17）：
  `AVERY_DB_URL=... pytest tests/test_context_empty_t86.py tests/test_registry_contract.py tests/test_registry_protocol.py`
  → **125 passed · 0 failed**（含本票 3 条 T86 `@needs_db` + 6 条 contract 的 postgres 参数）。
- **新门** `verify-archive-empty`：**25 PASS · 0 FAIL**（真 `/ingest` + 真 `/advise` + 真 `/team/{id}/empty` + 真 `appendFiles`）。
- `npm run typecheck` 绿 · `vite build --mode development` 绿 · `eslint src/lite2/{store,transport}.ts` 零输出。
- `node scripts/i18n-orphans.mjs` → **0 孤儿**（基线不变；本票没加任何 i18n 键）。
- **像素**：零渲染改动（只动 `store.ts` / `transport.ts`，且新键今天无人读），54 张按构造不漂——**未跑 B 区**，理由记在这。
- 门电池 A 区整轮结果见 §7。

### 迁移账

**不需要迁移。** `empty_context` 只对既有表做 DELETE / INSERT / UPDATE，一个列都没加。
（判据照 progress.md 那句：动 dataclass 里被整块 jsonb 装着的字段 → 免迁移；动表的顶层列 → 必须迁移。这里两样都没动。）
即便如此仍跑了 `@needs_db`——**动了 pg 腿就得跑**，`test_registry_contract.py` 离线被 deselect 是仓里真出过事故的地方。

## 6 · 欠账（交给 #84 / #88）

### ① UI 挂点 —— 票面明写，等 #84 建左栏

左栏最底一条，销毁类：**静息态不用红**（常驻的红会把整根栏染成警告区），红只在 hover 出现；
点下去走硬确认（「输入店名才放行」这一档）。今天后端 + transport + store 全通，
`__lite2Store.getState().emptyArchive()` 就是那枚键按下去之后要发生的全部事情。

🔴 **#84 落地时必须回来给门补一段**：真点那枚键 + 硬确认走通。
理由是 `verify-append-story` ② 那条现成教训——第一版直接调 store，于是「按钮接错线、其实调的还是
`uploadFiles`」那条变异**活了下来**，因为门根本没碰过那个按钮。本门今天有同一个缺口，是明知的。

**确认文案（草稿，照 `empty_context` docstring 写的，#84 直接用）**

> **清空这份档案？**
> 会删掉：你传过的**全部文件**（原件也删），以及 Avery 从这些文件里读出来的**人、项目、信号、矛盾**——全部。
> **会留下**：你和 Avery 的**对话记录**、Avery 自己写的**观察笔记**、**常驻表单**，以及**员工已经交上来的答卷**
> （那是他们的话，而且你发出去的填写链接还在生效）。
> 这份档案本身不会消失——链接、登录、已经发出去的表单都照旧能用，你可以立刻重新开始传。
> ⚠️ 员工的答卷留着，所以之后如果你把某份答卷重新归档，它读出来的东西会再次出现在资料库里。
> 删掉的文件**找不回来**。确认请输入店名：`____`

英文侧同义直译即可（本仓 0803 起中英都由当前 session 自己写，直接大白话，SaaS 感可接受）。

### ② 🔴 空态文案现在是假话 —— 本票新造出来的状态，#84 必须一起收

「有档案、零文件」这个状态**在本票之前不可能存在**（每份 context 都是一次 `/ingest` 生出来的，至少一个文件）。
现在它可达了，而资料库那一屏在这个状态下印的是：

> 「Avery 没有列出这一批里的任何文件。刚传完的话稍等一下再刷新；**如果一直是空的，多半是这些文件没读出内容，重新传一次最快。**」

用户刚刚**亲手清空**，屏上却在告诉他「多半是文件没读出内容」——把一次成功的销毁诊断成一次解析失败。
今天不会被看见（没有入口触发清空），所以**没在本票改**；但入口一上，它就是屏上第一句话。
需要的是一条「你清空了这份档案，随时可以重新开始传」的分支文案（zh + en 两条键）。

### ③ 与 #88 的接口

本票是 #88（撤掉「新建一家公司」）的前置，已就位：清空之后 `contextId` 不变、`knownContexts` 长度不变、
补料落回同一个 id —— 这三条都是门里的判据（③⑥）。#88 撤 `mode='new'` 时可以直接引它们当回归网。

## 7 · A 区门电池整轮 —— **35/35 绿**

`node eval-harness/tools/run-battery.mjs --only=A`（共享 preview:5173 + mock 后端:8137，
dist 由 `vite build --mode development` 打，跑前已在浏览器里验过
`__AVERY_BUILD__.apiBase == (local default 127.0.0.1:8137)`）。

```
PASS topbar-clearance 94.1s · cr-alignment 4.5s · skin-phases 4.9s · v2boots 1.8s
PASS button-family 6.2s · contrast-smalltext 17.5s · home-skeleton 3.0s · status-truth 16.0s
PASS room-nomaterial 3.1s · room-claude-rework 16.4s · room-usability 4.6s · answer-split 5.1s
PASS handoffs-empty-honesty 4.8s · switchers 9.0s · aria-zh 20.0s · onboard-gate 10.4s
PASS p0 17.7s · zh-purity 20.6s · bare-url-shell 3.2s · 404-discriminator 7.1s
PASS file-manifest-truth 7.9s · onboarding-returning 7.5s · context-switch 7.2s
PASS bottom-furniture 11.6s · detail-provenance 8.1s · flow-gap-phases 19.0s
PASS forms-proactive 4.9s · locale-parity 8.1s · append-story 5.0s · form-builder 12.2s
PASS at-references 50.7s · files-ia 3.7s · room-conversation 7.0s · room-threads 8.3s
PASS archive-empty 8.2s          ← 本票新门（25 PASS · 0 FAIL）
35/35 绿
```

值得记一笔的两条**没有**红：
- `verify-context-switch`（15 判据）与 `verify-files-ia`（17 判据）——本票往 store 加了两个键、
  往 transport 加了一个可选方法，两处都是**加法**，这两道门是它们最可能被咬到的地方。
- `verify-append-story` —— 它盯的是「补料不新建 context」，与本票 ⑥ 是同一条不变量的两个切面。

⚠ **跑完之后 dist 状态不确定**（run-battery 收尾会重打、且不带 api base → 落回生产域名）。
本票跑完已手工重打过一次带默认 8137 的 dist；下一个人跑任何上传型门之前照旧先验 `apiBase`。
