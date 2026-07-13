# feat-034 Ask 卡 · 开发 kickoff（2026-07-13）

> 依据：PRD.md（Q1-Q13 全拍板）+ ADR-0023 + 持久化线 07-13 广播（avery-lite-v1-persistence-7943bf）。
> 编排形态：main 只编排 → 每阶段 AFK 实现子代理（gate-first）→ 独立对抗验证 → clean 才推进。

## 分阶段（按依赖与避让）

| 阶段 | 内容 | 分支 | 依赖/避让 | 状态 |
|---|---|---|---|---|
| A. story scripted beat | 在最贴切的既有 case 加一个 Ask beat（新 ThreadStepKind `quick-ask`）：agent 提议快问 → Ask 卡（1~2 题，问事不问人）→ 回执归来 beat（原话+“本人自述”）。加性：既有 beats/rail 零改。 | `feat/034-story-ask` | 无（持久化线不碰 src/**） | **DONE+对抗验证 CONFIRMED_SAFE**（7b87cbd，已合 main 3e79e9e） |
| B. lite Ask 卡（stub 驱动） | Ask = lite 第二种 artifact 卡：AskDraft 数据形状 + AskCard 组件（Room 内出生：编辑题目→确认→逐人链接→回收状态 chip→回执呈现）。走 LiveTransport stub（ADR-0020 seam），后端契约按下方提案对齐。 | `feat/034-lite-ask` | 无；**不碰 eval-harness/** | **DONE+对抗验证 CONFIRMED_SAFE**（169e651，已合 main d1934bf） |
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

## 阶段 C 追加清单（2026-07-13 合流收线，来自两路对抗验证的非阻塞 findings）

- **F1（接线时必先对齐，真雷）**：status 词表已锁进 PRD 数据模型行——`draft|shared|collecting|closed|revoked|expired`。现 `coerceAskDraft` 对未知状态折回 `draft`，后端若回 `revoked`/`expired`/其他词，已发出/已撤回的 ask 会以**可编辑草稿复活**。阶段 C 第一件事：coerce 改 fail-loud 或折 `closed`，并补 `revoked`/`expired` 两态 UI。
- **F2（demo 诚实性）**：stub 模式 shared 态产出真域名假链接（`avery.ima-read.com/r/tok_…`）带复制按钮、无"离线预览、链接不可用"标记——接真后端自然消失，但**在此之前若用 stub 演示必须先补该标记**。
- **F3（防御归一收紧）**：`coerceAskDraft` 现对 >3 题静默截断、未知题型折 scale、回执值无量程校验（99 会渲染 "99 out of 5"）——阶段 C 收紧为"坏形状宁可不出卡"，服务端做最终门。
- story 侧非阻塞记录：chip 快速双击连跳一拍（等价 chip+Advance，seek 可洗，main 既有无防抖模式）——如影响路演体感再修。

## 与持久化线的协调（07-13 广播回执）

- 本线不动 eval-harness/**；阶段 C 等其链合 main。
- feat/031 对抗验证未判 clean——本线不以真 RAG 为依赖（Ask 不需要）。
- 若本线触碰"Avery 的笔记"UI——不会（不在 scope），其 UX 稿归属持久化线 feat-033。
