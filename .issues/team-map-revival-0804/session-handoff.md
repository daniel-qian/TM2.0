# session-handoff · team map 复活线（#106）

> 本文件是**这条 worktree 线**的交接（`AGENTS.md` End of Session 的 worktree 条款：
> 各线写自己的 per-line handoff，根目录的 `progress.md` / `session-handoff.md` 归主检出的
> 集成者收拢）。**没有**动根目录那两份。

**Last Updated:** 2026-08-17
**分支:** `claude/team-map-b1-skeleton-de3253`（基于本地 main `4f9a9a0`；已并入
`claude/team-map-canvas-revival-c758b4` 的三个 PRD 文档提交）

## What's Done

**#106 B1 骨架棒 + B2 focus 机器，两棒都做完了。**

- B1 逐条账：[`receipt-106-b1.md`](receipt-106-b1.md)（`/map` 独立页、布局纯函数、calm 渲染）
- B2 逐条账：[`receipt-106-b2.md`](receipt-106-b2.md)（点选/连线/mini 卡/组级读数/`?focus=` 深链）

一句话：地图能用了——点一个人，他背着的那几件事亮起来、连上线、原位展开一张 mini 卡，
「打开档案」进既有浮层、关掉回到地图且高亮还在；部门标签下多了一句从本人自述真派生的
定性短语。`?focus=` 可以发给别人。

电池：`./init.sh` exit=0 · lint 零新增 · i18n 孤儿 0 · 五个 check 共 **163 条判据全绿**
（B2 三个：46+64+28；B1 两个回归：25 + OK）· born-red 五个变异各红各的。

## In Progress

无。B2 收口，工作区干净。

## Next steps

**换新 session 从 #106 的 B3 段开工**（票是正源，PRD `PRD.md` §3.5/§7 是细则）。B2 留下的接口：

- 三个 `check-*.mjs` 的判据就是 `verify-team-map.mjs` 的底稿（**它们不叫 `verify-`**，
  刻意不进那个自查 glob，见各自文件头）。并进 ROSTER 时注意：镜头那条与两把锁的关系写在
  `receipt-106-b1.md`，拖动抑制那条写在 `receipt-106-b2.md`，**各配专属变异，别拿一条当两条**。
- 🔴 **B3 的头号真问题**：大板上 focus 之后被点亮的项目可能在画面外（80 人板宽 3476px，
  首帧只框得住约 2400px）。B2 刻意没做镜头跟随——「点击聚焦对应簇」这个动词第一次出现是在
  B3 的 HUD 那条，跟随的凶度/与用户 pan 的关系是那一票的设计题。理由与实测数字在
  `receipt-106-b2.md` 末节。
- HUD 触发器（搜索 / chips / 药丸）落地就是往 `mapHref(focusToken({kind,id}))` 里灌 token——
  focus 的真相源是 URL，HUD 不需要自己存状态。
- `MapZone` 契约对 B4（#107）仍然够用（key + rect + members + 可选的组级读数）。

## Blockers

无。

## Files Modified

**B2 改（8）**：`src/lite2/{routes.ts,Lite2App.tsx,projectView.ts}` ·
`src/lite2/map/{MapScreen.tsx,MapPanZoom.tsx}` · `src/lite2/screens/TeamScreen.tsx` ·
`src/lite2/styles/lite2.css` · `src/shared/i18n/{en.ts,zh.ts}`

**B2 新**：`src/lite2/selfReportView.ts` · `src/lite2/map/{mapFocus.ts,zoneRead.ts,MapEdges.tsx,MapNodes.tsx}` ·
`.issues/team-map-revival-0804/{receipt-106-b2.md,check-focus-b2.mjs,check-render-b2.mjs,check-demo-script-b2.mjs}` ·
`shots/b2-*.png`

（B1 那批见 `receipt-106-b1.md`。）

## Notes

- 本分支**未 push**；根 `progress.md` 未动（归集成者）。
- 既有门电池 / 像素基线 / `assertRoomCanvas` 一个字节没动——票面明写属 B3。
- `dist/` 收尾时重打成指向 `127.0.0.1`：`./init.sh` 跑的是裸 `npm run build`，会让 dist 落回
  **生产域名**，之后谁拿 `vite preview` 跑上传类的门就会往生产库写测试数据（AGENTS.md 点过名）。
- 顺手发现没顺手修：全局「问 Avery」悬浮胶囊盖住地图画布底部一条，**那一条里的空白点不着**
  （点下去开的是提问框）。别的屏上它盖的是卡片，同一个问题。
