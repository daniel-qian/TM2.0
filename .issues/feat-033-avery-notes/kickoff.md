# feat/033 — 「Avery 的笔记」:写侧、可见、跨会话累积的记忆(必过红线)(kickoff)

> 权威 spec:`.issues/lite-v1-lean-real-0713/PRD.md`(Implementation Decisions「Avery 的笔记」+ User Stories 7/8/25)· UX 设计稿 `.issues/lite-v1-lean-real-0713/avery-notes-ux-draft.md`(实现依据,已 Danny-抽查待确认,按其推荐默认做)· 方向 `session-close-and-direction.md` §3.3-④。
> 依赖:feat/030 持久化 + feat/031 RAG + feat/032 文件空间均已 clean(分支 feat/032-file-space tip)。从该 tip 开 `feat/033-avery-notes`。

## 使命

给 Avery 一个**"活的 agent"触点**:每次 advise 后,agent 把**它对这家公司的观察**追加进一份**用户看得见、跨会话累积、越用越厚**的持久笔记(区别于今天只读、从文档抽取的 `notes.md`——那是文档信号;这是 agent 自写)。这是 lead-gen 钓鱼的核心钩子(PRD Story 7/17)。

**🔴 最高红线约束(本 feature 的命门)**:agent 自写的观察**一样不许给人打分/排名/画像**。写入前**必过既有红线门 `redline.validate`(EN+ZH),违规则丢弃、绝不落库**——不新增红线机制,复用既有。agent 自写笔记绝不能成为绕过"人卡零数字"的后门。这是 feat/029 之后最吃重的红线面,收盘必经独立对抗验证(真机 crafted 输入诱导打分,别信自评)。

## 架构(动手前必读,少踩坑)

- **写笔记的钩子在服务层(`service/app.py`),不在冻结 loop**。engine/loop/tools 冻结不动。`/advise` 完成后(SSE 流结束 / stream:false 缓冲完成),app.py 做一个 **post-advise 后处理步**:取 advise 结果里已 red-line-clean 的 `read`(+ 可选 `framing`)作为"Avery 的观察",**独立再跑一次 `redline.validate`**(belt-and-suspenders:即便观察来自已过门的 advise 输出,写侧门也要自己校验,像 feat/030 存储门那样),clean 才 append 落库,违规**丢弃**(不落库、不出 nudge、不渲染占位)。
- **观察内容 = advise 的 `read` 字段**(agent 对情境/工作的观察,本就 work-focused、已过红线)。**不额外发 LLM 调用**(省花费、少一个幻觉面)。source 摘录 = 触发该轮的提问前 ~60 字符。
- **持久化骑 feat/030 层**:新表 `avery.company_notes`(context_id FK CASCADE、idx、created_at、text、source_excerpt);`PostgresContextRegistry` put/get 读写(或新增 append_note/list_notes 方法,与既有 registry 接缝一致);内存 registry 内存持有。跨会话/重启累积——重启后笔记仍在(集成层断言)。**人相关零数字禁令在 DB 层同样成立**(笔记文本过红线门后才落,但 schema 层不必加 person-CHECK——笔记是自由文本观察,红线门是内容扫描不是键扫描;确保红线门真拦下打分文本)。
- **API**:`GET /team/{id}/notes` → 只读累积笔记 `[{id, created_at, text, source_excerpt}]`(新→旧)。或按 UX 稿并入 `/team/{id}` 随 context 返回——二选一,清单独立端点更清晰。
- **前端(UX 稿 §1-6)**:lite 第 5 tab「Avery's notes」(排 The room 后),按天分组只读条目 + 常驻红线信任条 + 空态 + Room 内 advise 后 nudge chip(后端确认落库才出,丢弃则不出)。复用现有视觉族(`.scene-nexus`/`.eyebrow`/`.nexus-empty`/`PeopleGroup` 折叠/`.upload-privacy-note`/`is-new`),类名 `lite-notes-*` 前缀,墙照旧。i18n:EN 用 UX 稿 §5 的 15 个 key;**中文走 M3**(定向翻新 key,避全量超 token 坑;若 i18n-zh.mjs 无定向能力则手写并在 zh.ts 头标注 HAND-WRITTEN/NOT-YET-M3,别悄悄漂——见 feat/032 教训)。

## UX 决策点(按 UX 稿推荐默认拍板,act first,标给 Danny 抽查)

按自主纪律(内部+UX taste 不阻塞),采用设计稿推荐默认:① tab 名「Avery's notes」排 The room 后;② 来源行显示提问摘录;③ Room nudge 开;④ v1 只读、无删除端点。这些记进收盘报告供 Danny 抽查,不阻塞。

## 测试接缝(PRD Testing Decisions)

- **主 = HTTP 面**(agent 当第一个用户):多轮 `/advise` → `GET /team/{id}/notes` 笔记累积可见 → **换新 registry 实例/重连 DB(重启)** → 笔记仍在。
- **🔴 红线断言(最重)**:构造会诱使 agent 写出"给某人打分/排名/画像"的 advise 情境(EN + ZH),断言**写侧门拦下、笔记零落库、无 nudge**;笔记里永不含 moodPct/capacityPct/评分/排名文本。用 mock brain 注入越线"观察"直击写侧门(不依赖真 LLM 是否越线),**也**用真机 crafted 输入端到端(seedgate 档)。复用 `test_redline*.py` 先例(EN+ZH)。
- **下沉契约**:`test_registry_contract.py`(内存+postgres 双实现)加"笔记 append/list 一致 + 越线笔记被拒"契约;离线内存实现也过。
- **离线默认全绿零外网**(DB 惰性、keys 测试打 @needs_keys);@needs_db 走本地 Docker PG :5433。
- **前端**:notes tab DOM 断言(live 源打桩确定性)+ 红线信任条渲染 + 空态 + story-untouched。

## 纪律(standing,违者返工)

- 🔴 **不动**:redline.py / redline_extract.py / PersonEntity / FROZEN.lock.json / loop.py / engine.py / tools.py / memory.py / extractor-advisor 分离。`src/story/**` 零改。**门断言不削弱**。写侧笔记复用既有 `redline.validate`,不新增/不弱化红线机制。
- **诚实降级**:观察被红线门丢弃 → 不落库、不出 nudge、绝不渲染"它本想写什么"占位。
- gate-first 先红后绿,禁自考自答。离线套件保持全绿零外网。分支从 feat/032-file-space tip 开 `feat/033-avery-notes`,commit 常态化(红→绿),**不 push**。别动未追踪协调者文件(含本 UX 稿与 data-handling 稿)。新迁移沿用多迁移按序跑机制(0006_*),MCP apply 到 Supabase avery schema 验证(additive/avery-scoped/只增不改,读用只读 MCP)。
- 收盘:离线全绿 + @needs_db 绿(含笔记累积/重启/越线拒的契约与集成)+ ./init.sh 绿 + 前端 DOM 断言 + 集成层证据(多轮 advise→笔记累积→重启仍在 + 红线越线被拒)+ feature_list feat-033 条目 + `.issues/feat-033-avery-notes/session-handoff.md`(含 Danny 抽查点)。**收盘必经独立对抗验证(红线写侧,真机 crafted 输入)**。
