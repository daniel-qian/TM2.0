> 已结案存档（2026-07-08），当前状态以 progress.md / feature_list.json 为准，本文件不再更新。

# Session Handoff — feat-025 (S5 · lite 模块补齐) per-line

> Worktree/per-line 纪律(AGENTS.md):本文件只记 feat-025 line;根 `session-handoff.md` + `progress.md` 由 main-checkout integrator 折叠。**接续只靠本文件 + git，不回放聊天。**

## 0 · 一句话现状
feat-025 **done**。分支 `feat/025-lite-modules`(base `4f90d1c`,承接 S4)。按 Danny 拍板 Q1(a)/Q2(a)/Q3(a) 补齐 lite 三模块:Playbooks 空态屏 · team 轻量分组视图 · room 薄 pan/zoom 画布。九相位 live 前端门 `pass:true`(原 6 回归 + 新 3 全绿)、story 未受影响、init.sh 绿、离线 pytest 190 passed。收盘 commit 在本分支。

## 1 · 改动文件清单(仅路径 + 一句话)
**新增(3)**
- `src/lite/screens/PlaybooksScreen.tsx` — Playbooks 空态屏(coming-soon + 引导文案锚未来 custom-agent 能力 + 3 未来数据槽;零人卡零数字)。
- `src/lite/teamGroups.ts` — 人卡分组纯函数(person.team→项目 ownership→role→兜底桶;稳定序,兜底组沉底)。
- `src/lite/LitePanZoom.tsx` — lite 自有薄 pan/zoom wrapper(只包 react-zoom-pan-pinch npm 依赖;**不 import/不改 story PanZoomCanvas**)。

**修改(7 code + 2 gate)**
- `src/lite/store.ts` — `LiteScreen` 加 `'playbooks'`。
- `src/lite/LiteTopbar.tsx` — 加第 4 tab(Playbooks)。
- `src/lite/LiteApp.tsx` — 三屏路由(team/playbooks/room)。
- `src/lite/screens/TeamScreen.tsx` — 人栏改可折叠分组容器(抽 PersonCard/PeopleGroup 子组件;人卡本身零改)。
- `src/lite/screens/RoomScreen.tsx` — 终端+8 字段卡包进 LitePanZoom 画布;composer 留画布外。
- `src/lite/styles/lite.css` — 三模块样式(全 `.lite-shell` 作用域;取既有 token,无新色板)。
- `src/shared/i18n/en.ts` — 18 个新 lite key(EN act-first)。
- `src/shared/i18n/zh.ts` — 新 key 走 M3;story-shared 段保持前版 byte-identical(见 §4)。
- `scripts/gates/live-frontend-gate.{md,snippet.js}` — 新 3 相位(G/H/I)+ verdict 扩 9 相位 + `recordInjectFromDom` 辅助 + `_clickTab`。

## 2 · 三模块实现取法(每个 1-2 句)
- **Playbooks(Q1a)**:第 4 tab → 纯空态屏,复用 `.nexus-empty` 卡壳(放宽宽度+可滚+左对齐叙事);诚实 coming-soon 标 + 数据槽预告 feat-019 酒店包。不移植 story 的 scripted case 复盘。
- **team 分组(Q2a)**:`groupPeople()` 按 person.team(部门)优先、退项目 ownership、再退 role、兜底「Everyone else」聚类。`PeopleGroup` = 可折叠容器(标题+人数+toggle),组内仍是 `.home-lane-people` 网格 → `.home-person-card` 原样在 DOM/可点(门相位 C/E 不受影响)。Bug4 限高自滚从单栏上移到整个 `.home-people-groups` 列。真 seed 分出 5 组(Founders/Design/Product/Ops/GTM)。
- **room 画布(Q3a)**:`LitePanZoom` 薄 wrapper(41 行量级,独立成文件,参照 story 写法但零耦合);`.lite-shell .lite-room-board` 内把 story 复用的 `.nexus-terminal`/`.lite-room-card` 从 viewport-fixed absolute 覆写成 flow 布局(scope 在 lite,story 一像素不动)。composer 留画布外恒可点(门相位 F2 驱动它)。

## 3 · 九相位 verdict JSON 原文(真后端 :8137 minimax+dashscope+llm:minimax)
```
{"emptyStateClean":true,"ingested":true,"teamRendered":true,"postUploadClean":true,"detailIsLive":true,"composerIsLive":true,"teamGrouped":true,"roomCanvas":true,"playbooksEmpty":true} :: PASS=true
```
- 真上传两 tracked seed(PrismDesign_TeamProfile_EN.xlsx + LogiPulse-Roadmap.pdf)→ 真 POST /ingest 200(~150s)→ 30 人卡;真 /advise SSE 15 帧→manifest→8 字段卡零 liveError。
- 新相位度量:G=5 分组容器/30 卡在组内/collapseWorks:true;H=canvas+board+panzoom wrapper+reset 控件在 DOM+composer 在画布外;I=screen+空态+引导标题+coming-soon+3 数据槽+story 名词黑名单 0。

## 4 · 门/回归结果一行
- **init.sh**:exit 0(墙 lint 0 errors / 3 pre-existing warnings;tsc 零错;build 462 模块)。
- **离线 pytest**:`python -m pytest eval-harness -q -m "not seedgate"` = **190 passed, 0 skipped**(6 deselected=seedgate;基线不变)。
- **story-untouched**:`?mode=story` → liteShellCount:0 / appShellClass:'app-shell' / topbar+scene+demoControls 正常 / 新 lite 类在 story=0;story 自驱 home→nexus→capabilities→onboarding 全绿 + story 8 张 scripted 卡照旧 + story mode-switch bg 仍 transparent(未触及)。story 自有 Playbooks(scene-capabilities)是**既有** Topbar.tsx:14,非本次引入。

## 5 · 偏差/风险/假设 + 留给 Danny 的抽查点
- **ZH i18n 取法(需知会)**:M3 pipeline 重译所有段;为不 churn story 中文,收盘用一次性 merge 把 story-shared 段(mode/team/nexus/upload)+ 既有 lite key **保持前版 committed 译文 byte-identical**,只吸收 18 个新 lite key 的 M3 译文。故 zh.ts diff 仅 = 新 key + 一处段序调整(值零变)。若 Danny 想让全 dict 重新过 M3,直接 `node scripts/i18n-zh.mjs` 覆盖即可(但会改 story 中文口吻)。
- **gate 门机制小增**:snippet 加了 `recordInjectFromDom(expectedCount)` —— 供「重注 snippet 后 results 清空、但 ingest 已落」的驱动 session 从 DOM 重建 phase-B 结果、免二次 ~150s 真 ingest。断言逻辑与 injectSeeds 完全一致(非放水)。新 3 相位为 async(tab click 后 poll 目标屏挂载,躲 React flush 时序坑)。
- **抽查点**:①Playbooks 空态文案口吻(EN 我定稿:标题「Playbooks grow from the way your team already works」+ coming-soon 诚实标);②分组维度(现按 team/ownership/role;若真 seed 某公司无 team 字段会退 role/兜底——已容错但视觉可再调);③room 画布交互(拖拽/缩放/复位;移动端手势未特调)。
- **交集点(与 S6 并行)**:LiteTopbar/LiteApp 是已知交集,本次改动最小(仅加一个 tab + 一个路由分支);S6 若也动这两个文件,冲突留 integrator。

## 6 · 怎么复跑本门(下个 session/抽查同款)
1. 后端:`cd eval-harness && AVERY_BRAIN=minimax /c/Python313/python -m uvicorn service.app:app --host 127.0.0.1 --port 8137 --app-dir . &`;`curl :8137/health` → brain:minimax。
2. 前端:preview_start `dev` → `:5173/?mode=live`。
3. 注入门:base64 两 seed 拼 `public/__seed_b64_tmp.json`、snippet 拷 `public/__gate_snippet_tmp.js`,页面 fetch+eval 加载 `__seedGate`,按 A→B→C→D→E→F1→F2→G→H→I→verdict 跑(gate .md 有序)。**收盘 rm 两临时 public 文件**(已 rm,未提交)。
4. 收盘:停 dev、杀 8137 uvicorn。
