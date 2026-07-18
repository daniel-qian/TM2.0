# feat-034 Ask 卡 · 开发 kickoff（2026-07-13）

> 依据：PRD.md（Q1-Q13 全拍板）+ ADR-0023 + 持久化线 07-13 广播（avery-lite-v1-persistence-7943bf）。
> 编排形态：main 只编排 → 每阶段 AFK 实现子代理（gate-first）→ 独立对抗验证 → clean 才推进。

## 分阶段（按依赖与避让）

| 阶段 | 内容 | 分支 | 依赖/避让 | 状态 |
|---|---|---|---|---|
| A. story scripted beat | 在最贴切的既有 case 加一个 Ask beat（新 ThreadStepKind `quick-ask`）：agent 提议快问 → Ask 卡（1~2 题，问事不问人）→ 回执归来 beat（原话+“本人自述”）。加性：既有 beats/rail 零改。 | `feat/034-story-ask` | 无（持久化线不碰 src/**） | **DONE+对抗验证 CONFIRMED_SAFE**（7b87cbd，已合 main 3e79e9e） |
| B. lite Ask 卡（stub 驱动） | Ask = lite 第二种 artifact 卡：AskDraft 数据形状 + AskCard 组件（Room 内出生：编辑题目→确认→逐人链接→回收状态 chip→回执呈现）。走 LiveTransport stub（ADR-0020 seam），后端契约按下方提案对齐。 | `feat/034-lite-ask` | 无；**不碰 eval-harness/** | **DONE+对抗验证 CONFIRMED_SAFE**（169e651，已合 main d1934bf） |
| C. 后端（数据模型+端点+员工 H5+红线门） | PRD "Implementation Direction" 全量：ask/ask_recipient 落 avery schema、`/r/{token}` 服务端渲染、问句红线门、回执闭环。 | `feat/034-stage-c` | 持久化链已并入 main（integrate cb11a2c）；骑 registry/authorize_context/scoring_policy 接缝 | **DONE+对抗验证×2 后修 2 缺陷,已合 main da94d59**（2026-07-14） |
| D. 部署（**并入 lite-v1 部署波，同容器**） | Ask 后端与持久化链同一 Python 容器。**已部署**德国法兰克福轻量机（容器 `avery-agent`，main `5d32e4f` 构建，`--memory=700m` 单 worker）+ 生产库 `avery-fra` + Cloudflare quick tunnel。0007 两表已在生产库。**Ask 特有 env 待配**（非阻塞，等固定域名）：`AVERY_PUBLIC_BASE`（/r/ 链接绝对根）+ `/ask`·`/r` 限流阈值 + 生产域名 OG 三平台 unfurl 验证。 | — | 已随 lite-v1 部署波上线 | **DONE（已部署，演示可用）**（2026-07-14） |

### 部署事实（更新 2026-07-14 持久化线更正广播 `correction-to-ask-line.md`；旧新加坡/阿里云假设作废，见 [[avery-infra-icp-ecs-in-hand]]）

- **实际部署形态**：德国法兰克福轻量服务器（容器 `avery-agent`）+ **生产库 `avery-fra`（`zlxpldzapyoacmgvlqpn`，eu-central-1，与服务器同城 RTT ~15ms）** + Cloudflare quick tunnel（真 HTTPS、不占 80/443、**URL 临时重启即变、非固定地址**）。新加坡库 `wvgmph…` 已删、阿里云第二台 ECS / `avery.ima-read.com` 子域方案此路已换。
- **`0007_ask.sql` 已在生产库自动 replay**（Dockerfile 补 `COPY db/` 后，空库 0→8 表实证含 asks/ask_recipients）。
- **连库必带**：session pooler `aws-0-eu-central-1.pooler.supabase.com:5432` + user `postgres.<ref>` + `?sslmode=require&channel_binding=disable`（缺则假报 password auth failed）+ 密码 percent-encode。后端零代码改动。
- **@needs_db PG 腿**：持久化线已替我方在真库跑通（52 passed，修了 1 条测试侧无效时间戳，产品/answer-once 锁零改动）。
- **产品判断（持久化线交我方拍）**：内存/pg 孪生在**非法** `answered_at` 上不强求一致——该值生产端服务端自盖、非法值到不了真实路径，为不可达输入加校验属镀金；**不动产品**（与持久化线判断一致）。

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

## Polish 波（2026-07-13，Danny 试玩三反馈，feat/034-polish→main 4125e7a）

- A1/A2 拍改**钉状态**语义（`pinThreadProgress` 幂等钉点位）：快按/双击/先 free-click 均不再跳过等待态或空拍；连带根修 chip 同 tick 双击连跳（阶段 A 非阻塞观察转正修复）。
- QuickAskCard 等待态加分享排（WeCom/Teams/Slack/Email chip + Copy link 真复制虚构链接 + Copied ✓）；已答态收敛一行 "Shared via one link · answered in 40s"。
- mode 开关（Story/Live）两壳默认隐藏，`?modeSwitch=1` 显示（`shared/mode.ts showModeSwitch()`）；`?mode=` URL 机器不动。事实澄清：开关是 feat-024/ADR-0020 决策 3 的设计，非分支不同步。
- 验证：maker 全套攻击断言 + 编排者合流后 5174 真机复验（28 连发攻击下 A1 仍等待态/分享排在/A2 已答/4 of 5 全页 1 处/开关默认无 param 有）。init.sh 绿。

## 阶段 C 追加清单（2026-07-13 合流收线，来自两路对抗验证的非阻塞 findings）

- **F1（接线时必先对齐，真雷）**：status 词表已锁进 PRD 数据模型行——`draft|shared|collecting|closed|revoked|expired`。现 `coerceAskDraft` 对未知状态折回 `draft`，后端若回 `revoked`/`expired`/其他词，已发出/已撤回的 ask 会以**可编辑草稿复活**。阶段 C 第一件事：coerce 改 fail-loud 或折 `closed`，并补 `revoked`/`expired` 两态 UI。
- **F2（demo 诚实性）**：stub 模式 shared 态产出真域名假链接（`avery.ima-read.com/r/tok_…`）带复制按钮、无"离线预览、链接不可用"标记——接真后端自然消失，但**在此之前若用 stub 演示必须先补该标记**。
- **F3（防御归一收紧）**：`coerceAskDraft` 现对 >3 题静默截断、未知题型折 scale、回执值无量程校验（99 会渲染 "99 out of 5"）——阶段 C 收紧为"坏形状宁可不出卡"，服务端做最终门。
- story 侧非阻塞记录：chip 快速双击连跳一拍（等价 chip+Advance，seek 可洗，main 既有无防抖模式）——如影响路演体感再修。

## 阶段 C 对接契约（钉自持久化线 2026-07-14 就绪广播，开工必读）

- **建工作区只走 `POST /ingest`**（回 `{context_id, owner_token}`），不自己 INSERT `avery.contexts`——token 铸造/红线门/记忆物化都在 ingest 路径里。DB=Supabase avery schema（迁移 0001-0006，DDL 只增不改），接缝=`avery.ingest.registry.active_registry()`，`AVERY_DB_URL` 有值走 PG、无值走内存（离线默认）。
- **两套 token 严格分离**：`owner_token`=经理凭据，只走 header（`X-Avery-Token`/Bearer），绝不进 URL；本线 `/r/{token}` share-token=员工侧一次性凭据，自管语义（v1 在 URL 是拍板设计——员工免登录的唯一路径，但 ask 的 manager 侧端点【POST /ask·share·GET /ask/{id}·revoke】全部要求 owner_token header + 404-on-mismatch（`authorize_context` 接缝直接复用，恒时比较、无枚举 oracle）。
- **人打分开关（Danny 07-13 政策转向）**：问句红线校验两档——问"事"问句恒许；涉人打分问句仅 `scoring_policy.person_scoring_allowed()`（`AVERY_ALLOW_PERSON_SCORING`）为 on 时放行，**不另起机制**。呈现层结构边界不随开关放松：回执不进人卡/无跨人分数表（ADR-0023 结构闸 + DB entities 打分键 CHECK 仍在）。
- **部署约束**：`/ask`/`/r/` 端点同受 feat-039 硬门（限流+LLM 花费闸——员工 H5 高频不许烧 M3 额度）+ 内存哨兵；CORS/TLS 沿 runbook。
- 真机证据基线（他们侧）：离线 474 passed；`@needs_db` 41 passed 含贯穿 e2e（持久化/隔离/真 RAG 隔离/笔记/开关两态）与基本压测。

## 与持久化线的协调（07-13 广播回执）

- 本线不动 eval-harness/**；阶段 C 等其链合 main。
- feat/031 对抗验证未判 clean——本线不以真 RAG 为依赖（Ask 不需要）。
- 若本线触碰"Avery 的笔记"UI——不会（不在 scope），其 UX 稿归属持久化线 feat-033。
