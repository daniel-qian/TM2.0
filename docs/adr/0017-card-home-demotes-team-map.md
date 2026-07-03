# 「Your team」改为卡片式今日主页，空间地图降级为页内全景子视图

> 修订 [ADR-0012](0012-pannable-zoomable-canvas-rail-derived-camera.md) 的"地图 = Dashboard 主形态"前提；不动 canvas / rail-camera 交互机器本身。语言与红线仍受 [ADR-0015](0015-product-tone-human-advisor-debrand-saas-naming.md) / [ADR-0016](0016-avery-decisive-in-both-directions.md) 约束。
> **状态：** Accepted（Danny 拍板 2026-07-03）

## 背景

合伙人（真实 HR 高管，目标买家本人）看过 demo 后自己动手画了一个 HTML mock（PM dashboard 风格：项目卡 + "Today's PM focus" checklist 面板 + capacity 面板）。核心诉求：**进入主页第一眼必须有 checklist 式的东西，让他立刻知道今天该关注哪些人和项目、快速进入心流**；且不能是纯文字，要靠卡片 / 颜色 / 动画一目了然。

Danny 的判断与之一致：现有 full-bleed 地图页放进职场办公环境里、对比其他办公软件"像玩具"——它是产品设计者的审美，不是目标用户（AI HR 顾问的日常使用者）的刚需行为。主要功能应该是**快速浏览人事/项目的分析 + 具体、可视化、清晰的行动建议**。

冲突点：合伙人 mock 的 SaaS 仪表盘语言（P0 徽章、统计数字 chips、capacity 读数）正面撞 ADR-0015 红线。

## 决策（YES）

1. **吸收行为骨架，语言过 ADR-0015 滤网。** 采纳 mock 的行为：进门即见"今天该关注什么"、卡片化、颜色分层、可勾选。不采纳其语言：无 P0/优先级徽章、无统计数字 chips、无 capacity 读数；人的读数一律定性人话，项目状态可以硬一点（due / blocked / 进度）。
2. **新页吞并地图。** 卡片式今日主页成为唯一的「Your team」（领域概念 Dashboard 的新定义）；地图不再是独立 tab / 主形态，降级为页内全景子视图（新领域概念 **Team map**），经卡片上的"在全景上看"类入口进入。
3. **分区混排，概念不混。** 主页两区：分析浏览区（**人与项目双轨卡片**，点卡钻入既有详情页）+ 今日 **Handoff** checklist 区（复用既有领域概念，"Worth a closer look" 条目以醒目颜色层级混排在内）。
4. **Demo rail：新页主场，地图留一个高光拍。** B1 calm / B3 提问（composer 随迁）/ B10 briefing 刷新落在新主页；B2 改为从风险卡"在全景上看"→ 镜头推进 Team map、簇点亮 → 钻入详情。
5. **三动作全活，安静的完成感。** done → 对勾动画、卡片收进"今天已照料"堆、剩余计数安静更新；discard → 淡出；重条目一键飞进 the room。无彩带、无游戏化（呼应 [ADR-0010](0010-calm-cards-gamified-hp-mp-hud.md)）。

## 取舍

- **放弃**：地图作为进门第一眼的视觉差异化（demo 的"wow"开场）。
- **换得**：日常刚需行为的可信度——目标买家自己描述的心流入口；地图的 wow 保留为 demo 中一个有意设计的高光时刻，而非常驻背景。
- 若未来实测发现卡片主页反而平庸、地图才是记忆点，回退成本主要在 rail 脚本与 fixtures 措辞，交互机器（canvas / rail camera / focus）均未拆除。

## 后果

- `CONTEXT.md`：Dashboard 重定义；新增 Team map；Calm/Focus 归属 Team map；Handoff 补"进门第一眼主体之一"。（已随本 ADR 落地）
- Demo rail `SCRIPT`：B1 / B2 / B3 / B10 需按决策 4 改写。
- 新主页全部 user-facing 英文 copy 就地标 `⚠ 待 Danny 审字`（AGENTS.md DoD 第 3 条）。
