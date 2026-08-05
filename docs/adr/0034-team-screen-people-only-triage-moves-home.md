# Team 屏回归纯人员目录：分诊迁入今日主页，项目卡带退役

> Supersedes [ADR-0017](0017-card-home-demotes-team-map.md) 的决策 2/3（「Your team」= 人与项目双轨卡片 + Handoff checklist 三合一）。不动 0017 的决策 1/5（语言过 ADR-0015 滤网、三动作安静完成感——两者随分诊区整体迁移，约束原样有效）。
> **状态：** Accepted（Danny 拍板 2026-08-05，issue #46）

## 背景

ADR-0017（2026-07-03）拍板时，「Your team」是产品**唯一**的进门主页，所以人卡、项目卡、今日 Handoff checklist 三样都装在它身上。此后两件事改变了前提：

- **feat-057（2026-07-18）新建了聚合首屏「今天」**——进门第一眼的职责整体移交，团队页降为顶栏九分区之一的深入面。首屏已有「今天要决策的」（后端定级引擎）承担 checklist 心流入口。
- **feat-055 新建了独立项目屏**——比团队页底部的轻量项目卡带信息更全（分组、覆盖率、手编角标），且两处是完全独立的两份实现（statusTone 等 helper 各一份），同一事实两处渲染。

Danny 2026-08-05 截图走查点名：团队页应该只包含人员；今日提醒应与「今天要决策的」放在一起。

## 决策

1. **团队页 = 纯人员目录**：briefing 头 + 筛选目录（部门/情绪 chip）+ 添加成员 + 停用抽屉。布局从 38/62 双列改单列（`.home-frame--people`，锁 `.lite2-shell`——v01/story 冻结面一像素不动）。
2. **晨间分诊整块迁入今日主页**，紧邻「今天要决策的」。**两套数据源不合并列表**：决策卡是后端定级引擎产出（feat-056），分诊条目是前端从项目 blockers 的真派生（liveHandoffs，零捏造）——删掉任何一边都会丢一个信息面。三动作真接线（done/搁置/去问 Avery/加到待办/起草消息）与 flowStore triageMarks（localStorage）原封迁移，只换消费屏。
3. **团队页项目卡带删除**：与项目屏纯重复，入口走顶栏项目 tab。人员详情浮层内的项目引用不动。

## 取舍

- **放弃**：团队页的「一屏总览」——看人的同时瞥一眼项目状态。换得：每屏一个职责，项目的唯一事实源归项目屏（消灭双实现漂移），团队页目录网格吃满宽。
- 分诊迁走后团队页左脊柱只剩 briefing 头，信息密度变薄——这是有意的：它现在回答「我的人都是谁、谁自述吃紧」，不再兼任晨间 checklist。

## 后果

- `TeamScreen.tsx`：分诊 JSX/flowStore 接线/项目卡带全部移除；`HomeScreen.tsx` 新增 ①¼ 今日提醒区块（`lite-home-handoffs`）。i18n 键全部沿用（`handoffsTitle`/`triage*`），无孤儿键。
- 门影响：AFK skin probe 轮询的 `.home-lane-people` 保留在团队页；`.home-handoff-list` 等分诊锚点移动到 `/home`——扫这些锚点的门要跟着换屏（跑电池验证）。
- `CONTEXT.md` 的 Dashboard/Handoff 归属描述需随本 ADR 更新。
