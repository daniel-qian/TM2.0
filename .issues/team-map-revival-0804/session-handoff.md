# session-handoff · team map 复活线（#106）

> 本文件是**这条 worktree 线**的交接（`AGENTS.md` End of Session 的 worktree 条款：
> 各线写自己的 per-line handoff，根目录的 `progress.md` / `session-handoff.md` 归主检出的
> 集成者收拢）。**没有**动根目录那两份。

**Last Updated:** 2026-08-18
**分支:** `claude/team-map-b1-skeleton-de3253`（基于本地 main `4f9a9a0`；已并入
`claude/team-map-canvas-revival-c758b4` 的三个 PRD 文档提交）

## What's Done

**#106 三棒全做完了：B1 骨架 / B2 focus 机器 / B3 HUD-lite + 门。**

- B1 逐条账：[`receipt-106-b1.md`](receipt-106-b1.md)（`/map` 独立页、布局纯函数、calm 渲染）
- B2 逐条账：[`receipt-106-b2.md`](receipt-106-b2.md)（点选/连线/mini 卡/组级读数/`?focus=` 深链）
- B3 逐条账：[`receipt-106-b3.md`](receipt-106-b3.md)（HUD 三触发器/镜头跟随/门/改判/像素基线）

一句话：地图现在**答得了问题**——搜一个名字、点一个部门、点一下「有几件要你出手」，
板上就把对应的那一撮人和活拎出来，镜头跟过去，地址栏里那串 token 可以直接发给合伙人。

电池：判据合计 **233 条全绿**（team-map 门 62 · 改判死针 8 · B2 三个回归 46+64+28 · B1 回归 25）
· 像素基线 12 张已冻且复跑零漂移 · 变异 **21 发代码 + 4 发像素**，各红各的
（M05 如实存活并记档）· `./init.sh` exit=0 · lint 零新增 · i18n 孤儿 0。

## In Progress

无。B3 收口，工作区干净。

## Next steps

**票面三棒已全部勾完，本线的开发到此为止。**

- ✅ **已合本地 main**（`00993fd`，`--no-ff`，零冲突；main 原在 `cd6f207`）。合并是 PRD §7
  「spec 先合本地 main 再冻」要求的前置步骤——基线 PNG 是 gitignore 的单机产物、**每个
  worktree 一份**，在 worktree 里冻不算数。**未 push**。
- ✅ **12 张像素基线已冻在主检出** `D:/avery/eval-harness/visual/__snapshots__/`，复跑零漂移，
  12 张全部人眼过。（主检出的 `dist/` 也被重打成指向 127.0.0.1:8147——它是 gitignore 的产物。）
- **B4 部门收拢态**（#107，触发＝首个 40 人以上真租户）：契约没动，`MapZone` 仍够用
  （key + rect + members + 组级读数），`.lite-map-zone.is-subject` 这一态 B3 已经先造出来了。

## Blockers

无。

## 顺手发现，没顺手改

- ✅ **`reducedMotion` 那条已做完**（0818，独立一票）：根因是 playwright 1.61.1 的 `use` 顶层
  没有这个键（`_combinedContextOptions` 是写死白名单，全库 grep 零命中），出口是
  `contextOptions: { reducedMotion: 'reduce' }`。逐条账见
  [`../visual-determinism-0818/receipt-visual-determinism.md`](../visual-determinism-0818/receipt-visual-determinism.md)。
  **它反过来咬了 B3 一口**：修好开关重跑，逮到一个 B3 62 条判据全绿、人眼也过了的真 bug——
  地图 mini 卡的居中被自己的入场动画（`both` 填充 + to 帧 `transform: none`）永久抹掉，
  动效开着的世界里**偏 98px**，而歪的那一帧当时被冻进四张 focus 基线当成了正确答案。
  已修 + 补判据 D1b。另查实：`verify-team-map.mjs` 的 ⓪ 自证硬依赖
  `AVERY_ALLOW_PERSON_SCORING=1`，而这条前提 B3 一个字都没写——不带它跑这道门必红
  （`0 人报了负载`）。跑法已补进 ROSTER 与两份 spec 头注释。
- 全局「问 Avery」悬浮胶囊盖住地图画布底部一条（B2 就记过，仍在）。别的屏上它盖的是卡片，
  同一个问题。

## Files Modified

**B3 改（8）**：`src/lite2/map/{MapPanZoom.tsx,MapScreen.tsx,MapNodes.tsx,MapEdges.tsx,mapFocus.ts}` ·
`src/lite2/projectView.ts` · `src/lite2/styles/lite2.css` · `src/shared/i18n/{en.ts,zh.ts}` ·
`scripts/gates/{live-frontend-gate.snippet.js,live-frontend-gate.md}` ·
`eval-harness/tools/run-battery.mjs`（ROSTER 加一道）

**B3 新**：`src/lite2/map/MapHud.tsx` · `eval-harness/tools/verify-team-map.mjs` ·
`eval-harness/visual/visual-map.spec.mjs` ·
`.issues/team-map-revival-0804/{receipt-106-b3.md,check-roomcanvas-b3.mjs,mutants-b3.mjs,mutants-visual-b3.mjs}`

（B1/B2 那两批见各自回执。）

## Notes

- 本分支与本地 main 都**未 push**（push 是对外闸，留给 Danny）。根 `progress.md` 未动（归集成者）。
- ⚠ **订正一条从 B2 回执抄下来的话**：「`./init.sh` 会让 dist 落回生产域名」在**本仓当前状态下
  是不成立的**。实测：裸 `npm run build` 没有 `VITE_AVERY_MODE`，`vite.config.ts:21` 兜的是
  `'(local default 127.0.0.1:8137)'`，不是生产域名；`.env.local` 里也只有一个 Vercel token。
  真正的危险面是**另一件事**：init.sh 之后 dist 的 apiBase 变回 **8137**，而隔离端口跑的后端在
  8147 —— 此时跑上传类的门会以「上传等不到」的形态假红。收尾时已把 dist 重打成 8147。
  （AGENTS.md 那条警告针对的是配了 `VITE_AVERY_MODE=live` 的部署构建，与本地 init.sh 不是同一路。）
- **加 data 属性前先查重名**：B3 给连线 `<path>` 加的调试属性一度叫 `data-person-id`，
  与节点上的同名，而连线层在 DOM 里排在人员层**前面**——全仓那些
  `querySelector('[data-person-id="…"]')` 一夜之间返回的是一条线。现在叫 `data-edge-person` /
  `data-edge-project`。
