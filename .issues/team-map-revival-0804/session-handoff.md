# session-handoff · team map 复活线（#106）

> 本文件是**这条 worktree 线**的交接（`AGENTS.md` End of Session 的 worktree 条款：
> 各线写自己的 per-line handoff，根目录的 `progress.md` / `session-handoff.md` 归主检出的
> 集成者收拢）。**没有**动根目录那两份。

**Last Updated:** 2026-08-17
**分支:** `claude/team-map-b1-skeleton-de3253`（基于本地 main `4f9a9a0`；已并入
`claude/team-map-canvas-revival-c758b4` 的三个 PRD 文档提交）

## What's Done

**#106 B1 骨架棒，全部条目做完。** 逐条账、验收数字、两条实测出来的坑：
[`receipt-106-b1.md`](receipt-106-b1.md)。

一句话：`/map` 独立页活了——真数据、按部门站好、右边一列项目条、pan/zoom + 复位、
空态复用团队页引导语、en/zh 成对。`./init.sh` exit=0，lint 零新增，i18n 孤儿 0。

## In Progress

无。B1 收口，工作区干净。

## Next steps

**换新 session 从 #106 的 B2 段开工**（票是正源，PRD `PRD.md` §3.3 是细则）。B1 已经把接口留好：

- 连线的两端锚点 = `MapPersonNode.pos` / `MapProjectNode.pos`（board px，都是圆点/条的**中心**）。
- 每条项目已经算好 `zoneIndex`（owner 所属分区序，`-1` = 无 owner ⇒ **不画边**）。
- world 分层里 z-index 2 是空着的，就是留给 SvgEdge 的（1=分区底板 / 4=节点）。
- `MapZone` 已按「可收拢」设计（key + rect + members），B4（#107）不用回头改契约。

B3 写门时**先读** `receipt-106-b1.md` 的「两条坑」那一节：镜头那条判据的期望值必须独立算，
而且 `MapPanZoom` 里那两把锁要各配一个专属变异（一条变异只能红一把锁——本票实测过）。

## Blockers

无。

## Files Modified

改（9）：`src/lite2/{routes.ts,Lite2App.tsx,teamData.ts,projectView.ts}` ·
`src/lite2/screens/{TeamScreen.tsx,ProjectsScreen.tsx}` · `src/lite2/styles/lite2.css` ·
`src/shared/i18n/{en.ts,zh.ts}`

新（`src/lite2/map/`）：`mapLayout.ts`（布局纯函数）· `MapPanZoom.tsx`（薄 rzpp wrapper）·
`MapScreen.tsx`（页面）

新（`.issues/team-map-revival-0804/`）：`receipt-106-b1.md` · 本文件 ·
`check-layout-80.mjs` · `check-render-b1.mjs` · `fixtures/{make-team-80.mjs,team-80.json}` ·
`shots/*.png`

⚠ 那两个 `check-*.mjs` **故意不叫 `verify-*`**（不进 `git ls-files "*verify-*.mjs"` 那个
自查 glob，免得造出没人裁定过的孤儿门）。它们不在任何电池里，要手跑；跑法写在各自文件头。

## Notes

- 本分支**未 push**；根 `progress.md` 未动（归集成者）。
- 既有门电池 / 像素基线 / `assertRoomCanvas` 一个字节没动——票面明写属 B3。
- 顺手发现没顺手修：全局「问 Avery」悬浮胶囊在地图上会盖住底部一排节点（别的屏上盖的是
  卡片，同一个问题，不属 B1 射程）。
