# feat-034 Ask 卡 · 开发 kickoff（2026-07-13）

> 依据：PRD.md（Q1-Q13 全拍板）+ ADR-0023 + 持久化线 07-13 广播（avery-lite-v1-persistence-7943bf）。
> 编排形态：main 只编排 → 每阶段 AFK 实现子代理（gate-first）→ 独立对抗验证 → clean 才推进。

## 分阶段（按依赖与避让）

| 阶段 | 内容 | 分支 | 依赖/避让 | 状态 |
|---|---|---|---|---|
| A. story scripted beat | 在最贴切的既有 case 加一个 Ask beat（新 ThreadStepKind `quick-ask`）：agent 提议快问 → Ask 卡（1~2 题，问事不问人）→ 回执归来 beat（原话+“本人自述”）。加性：既有 beats/rail 零改。 | `feat/034-story-ask` | 无（持久化线不碰 src/**） | 施工中 |
| B. lite Ask 卡（stub 驱动） | Ask = lite 第二种 artifact 卡：AskDraft 数据形状 + AskCard 组件（Room 内出生：编辑题目→确认→逐人链接→回收状态 chip→回执呈现）。走 LiveTransport stub（ADR-0020 seam），后端契约按下方提案对齐。 | `feat/034-lite-ask` | 无；**不碰 eval-harness/** | 施工中 |
| C. 后端（数据模型+端点+员工 H5+红线门） | PRD "Implementation Direction" 全量：ask/ask_recipient 落 avery schema、`/r/{token}` 服务端渲染、问句红线门、回执闭环。 | 待定 | **deferred**：等持久化链合 main；届时对齐 feat/030 的 registry/DB 接缝 + Supabase avery schema | 未开 |
| D. 部署（子域+哨兵） | `avery.ima-read.com` A 记录→宝塔 vhost/证书→容器（内存帽）→nginx 反代→**内存哨兵**（Q12） | — | 随 lite-v1 部署波 | 未开 |

## 后端契约提案（给持久化线/未来阶段 C 的对齐稿，additive-only）

- SSE：`manifest` 事件 payload 加可选判别字段 `kind: "advice" | "ask-draft"`（缺省=advice，现有消费者零破坏）；`ask-draft` 携带 AskDraft 形状。
- 新端点（全部新增，不动现有四端点）：`POST /ask`（创建/保存，服务端 redline.validate）· `POST /ask/{id}/share`（生成一人一链）· `GET /ask/{id}`（状态/回执，manager 侧，校验 company token）· `POST /ask/{id}/revoke` · `GET /r/{token}`（员工 H5，服务端渲染+OG）· `POST /r/{token}/answer`（单次锁定）。
- 未知/过期 token 一律大声 404（与 feat-028 行为一致）；前端已按 404 优雅处理设计。

## 纪律（两个实现子代理的硬约束）

- 🔴 红线 ADR-0023：问事不问人；回执永不进人卡/PersonEntity（类型层无处可挂）；无跨人分数表（DOM 断言）；scripted mock 人同样适用。
- 墙：lite 不 import story；共用走 shared。story 侧**加性**：既有 beats/rail/资产 byte 级不动，story 回归绿。
- gate-first：断言先行必红再修绿。lite 侧进 live-frontend-gate snippet 新相位（askCard）；story 侧证据=init.sh 绿 + 真浏览器驱动 rail 截图。
- 不碰：`eval-harness/**`、冻结集（redline/loop/engine/tools/PersonEntity/FROZEN.lock.json/memory.py）、`feat/030+` 分支链。
- i18n：EN act-first 定稿；ZH 新 key 定向走 M3（scripts/i18n-zh.mjs，避全量超 token 坑）；M3 key 缺失则 EN 定稿 + handoff 记 ZH pending。
- done = 集成层证据（ADR-0022），不 merge 不 push（合流由本线编排者做，push 留 Danny）。

## 与持久化线的协调（07-13 广播回执）

- 本线不动 eval-harness/**；阶段 C 等其链合 main。
- feat/031 对抗验证未判 clean——本线不以真 RAG 为依赖（Ask 不需要）。
- 若本线触碰"Avery 的笔记"UI——不会（不在 scope），其 UX 稿归属持久化线 feat-033。
