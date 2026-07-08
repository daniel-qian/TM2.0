# Avery 从 demo-only 毕业为 live lite 产品；脚本层保留为一等 "story mode"

> 超越 [ADR-0001](0001-prototype-demo-only-engineering-docs-are-reference.md)（demo-only）——其后果段设的重启条件（"Venus 验证后才重启架构"）已由路演验证达成。
> 保留 [ADR-0002](0002-frontend-stack-vite-react-framer-motion.md)（Vite/React 栈）、[ADR-0003](0003-demo-rail-is-detachable-driver-over-free-click-core.md)/[ADR-0006](0006-rail-driver-is-stateless-replay-to-target-over-frozen-store.md)（rail 可拆卸无状态回放）、[ADR-0012](0012-pannable-zoomable-canvas-rail-derived-camera.md)（canvas/rail camera）、[ADR-0013](0013-multi-thread-nexus-case-definitions-follow-up.md)（多线 case 契约）、[ADR-0014](0014-nexus-terminal-stream-hud.md)（终端流）——**story mode 即这些机器的原样保留**。红线与语言仍受 [ADR-0015](0015-product-tone-human-advisor-debrand-saas-naming.md)/[ADR-0018](0018-renqingwei-demoted-to-redline-product-truth-decision-layer.md) 约束。
> **状态：** Accepted（Danny 拍板 2026-07-05；圆桌记录 [docs/strategy/2026-07-05-dual-line-strategy-roundtable.md](../strategy/2026-07-05-dual-line-strategy-roundtable.md)）

## 背景

几次路演 + 两家企业洽谈：听众有兴趣，但**没法直观地用、玩**。根因——现在的 demo 是 Lin Qing 故事线的**录像回放**（rail replay + 写死 `fixtures`），观众只能看，**无法把自己公司的情况打进去**。

ADR-0001 当初把 2.0 定为 demo-only，并在后果段写明"直到 Venus 验证后才重启架构 / DB / 实现规划"。**该条件现在满足**：路演即验证，且国内融资团队明确要一个"能实际部署、直接拿给各团队用"的版本。重启架构的闸门已被 ADR-0001 自己授权打开。

## 决策

1. **Graduate 现有 Vite demo → "Avery Live"。** demo 不再 demo-only，毕业成一个真·lite 产品。**ADR-0001 被本 ADR 超越。**
2. **两道数据 seam。** 给"终端 + Manifest 卡"抽 `StreamSource`、给"Your team"抽 `TeamDataSource`；各两实现——**story 源** = 脚本 `cases.ts`/`fixtures.home.ts`（原样），**live 源** = 真 agent 服务 + 真 ingestion 产出。
3. **`?mode=story|live` 开关。** story = 路演/视频剧场（保留，feat-013 仍用）；live = 可用 sampler（部署默认）。两模共用全部视觉组件，只差数据源。
4. **后端 = Python agent 服务。** `eval-harness` 加 FastAPI + SSE 当后端；SPA 通过 HTTP/SSE 调它。**LLM key 与 loop 绝不上前端**（纯客户端会泄 key）。护城河留 Python，一套脑，不重写。
5. **landing 不动**（继续当营销页）；demo(Vite) 现在是 story+live 双模的**同一 codebase**。

## 取舍 / 理由

- **为什么 graduate 而非新建 Next.js app**：复用 Nexus "Working it through" 终端可视化（皇冠宝石，本就是 `think→tool→observe` 的完美 UI）+ 8 字段 Manifest 卡（已与 `eval-harness` 输出对齐）。在 Next 重造 = 扔掉几个月设计资产、慢、绕费。
- **为什么保留 story mode**：视频（feat-013）+ 路演仍要可控脚本剧场；且"保留脚本回放"= **不动 ADR-0003/0006/0012/0013/0014 的回放机器**（standing 约束不破）。live 是**增量并行源**。
- **seam 的双重价值**：让 story/live 干净隔离（不混成一坨），且它就是 **AFK 测试的缝**——live 源打桩成确定性 → 前端 DOM 断言不碰真 LLM、绕开 headless rAF 老坑。
- **被否**：① 纯客户端直连 LLM（key 泄）；② 直接 hack demo 不加 seam（脚本层与真实层缠一起，难 AFK 测）；③ 干净新建 Next app（重造宝石，慢）。
- **回退成本**：live 源是纯增量。删掉 `LiveAgentSource`/`LiveTeamSource` 即回到今天的 story-only demo，视觉机器一行没拆。

## 后果

- 落地 `feature_list.json` **feat-015**（agent service）/ **feat-016**（ingestion）/ **feat-017**（frontend seam + live mode + i18n）/ **feat-018**（双端部署）。
- `CONTEXT.md` 新增 **Avery Live** / **Story mode** / **Live mode**（已随本 ADR 落地）。
- **ADR-0001 后果段作废**：过去"任何工程提议默认 wontfix"不再成立——backend / RAG / ingestion / agent 服务现在是明确 in-scope。
- 全部新 live-mode user-facing 英文 copy 就地标 `⚠ 待 Danny 审字`（AGENTS.md DoD 第 3 条）；中文经 M3（memory `chinese-copy-via-m3`）。
- **红线扫描扩面**：过去只扫脚本 `fixtures`，现在必须覆盖 **live 产出**（真 agent 回答 + 真解析人卡）——见 [ADR-0021](0021-two-engine-core-vertical-packs-skins-dual-deploy.md) §4。
