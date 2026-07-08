# feat-022 · live frontend gate — 浏览器自驱协议(agent 当第一个用户)

> 后端双层门在 `eval-harness/tests/test_seed_gate.py`(pytest)。本文件是**前端集成层**:
> 真浏览器、真上传、真 DOM 断言。断言脚本(tracked、单一事实源):
> [`live-frontend-gate.snippet.js`](live-frontend-gate.snippet.js)。
> **2026-07-07 立门即红**——live 渗漏 story(空态左脊柱 / composer / 详情页),feat-024 修绿。
> 红是成功;不得改弱断言迁就现状。

## 跑法(每次 lite 前端 feature 标 done 前必走)

1. **起后端**(live 形态):
   `AVERY_BRAIN=minimax python -m uvicorn service.app:app --host 127.0.0.1 --port 8137 --app-dir eval-harness`
   健康检查 `GET :8137/health` → `brain:minimax`。跑前清残留 uvicorn(07-05 坑)。
2. **起前端**:`npm run dev`(preview_start `dev`)→ 打开 `http://localhost:5173/?mode=live`。
3. **注入断言包**:把 `live-frontend-gate.snippet.js` 全文 eval 进页面(preview_eval)。
4. **按序跑相位**(每步返回 JSON,全部记进 evidence):
   - `__seedGate.defuseAnimations()` — transition:none 旁路(headless rAF 停摆坑,feat-014)。
   - `__seedGate.scanStoryNouns()` — **相位 A**:上传前空态,story 专有名词黑名单 = 0。
   - `await __seedGate.injectSeeds([{name, b64}, …])` — **相位 B**:两个官方 seed
     (`eval-harness/tests/fixtures/seed/`)base64 注入真 `<input>` → 真 POST /ingest。
   - `__seedGate.assertTeamRendered()` — **相位 C**:人卡 ≥15、含 Lin Qing/Chen Mingyuan、
     卡上零血条数字。
   - `__seedGate.scanStoryNouns()` — **相位 D**:上传后再扫,黑名单 = 0。
   - `await __seedGate.openPersonDetail('Lin Qing')` — **相位 E**:点人卡开详情,
     无 "Unknown teammate"、显 live payload。
   - `__seedGate.composerCheck()` — **相位 F1**:composer 无 story 预填/引用(静态)。
   - `await __seedGate.composerAskLive('Who leads design, and what do they own?')` —
     **相位 F2**(S2/feat-024 补齐):真提交 composer → askLive → /advise SSE 事件到帧
     (终端行渲染 → manifest → 8 字段卡),真后端实跑 ~1–3 分钟。verdict 的
     `composerIsLive` = F1 静态 **且** F2 动态,漏跑 F2 = 红。
   - `__seedGate.assertTeamGrouped()` — **相位 G**(feat-025 Q2):Your team 人栏 = 分组
     容器(分组块 `.home-people-group` + 分组标题 + 折叠 toggle),人卡仍在 DOM/可点;
     断折叠真生效(折叠后卡数减、复展后复原)。
   - `__seedGate.assertRoomCanvas()` — **相位 H**(feat-025 Q3):The room 有薄 pan/zoom
     画布 `.lite-room-canvas`(含 board + react-zoom-pan-pinch wrapper + 复位控件),
     composer 留画布外(恒可点)。
   - `__seedGate.assertPlaybooksEmpty()` — **相位 I**(feat-025 Q1):Playbooks 屏空态
     (引导标题 + coming-soon 标 + 未来数据槽),该屏 story 名词黑名单 = 0。
   - `__seedGate.assertVisionSurface()` — **相位 J**(feat-026):Vision 定位叙事页
     (三拍叙事 `.lite-vision-beat` ≥3 + 能力边界 mock `.lite-vision-mock` ≥3,**每张 mock
     必带 `.lite-vision-tag` preview/coming 标注**——零未标注 mock);若 mock 含示例人
     (`.lite-vision-person`)则**零数字**(红线);该屏 story 名词黑名单 = 0。
   - `__seedGate.verdict()` — 聚合判定(10 相位:原 6 + teamGrouped/roomCanvas/playbooksEmpty
     + visionSurface)。
5. **收尾**:停 dev server、杀 8137 uvicorn。verdict JSON 原样贴进
   `feature_list.json` evidence / progress.md。

## 黑名单口径(与 snippet 内 STORY_NOUNS 同步,snippet 为准)

story 独占:Venus · Smart Shopping Guide · Kate/Jason/Cecily/Kenan/Nasim/Aidy/
Fred/Wang · Venus Pitch · Prototype 2.0 · Client Onboarding Kit · Store Dashboard polish ·
Writing the playbooks · Core shopping-guide flow · Lin Qing story 卡文案句式。
**注意 1**:Lin Qing / Chen Mingyuan / Sun Xiaomei / Zheng Zixuan 四个名字 story 与真 seed 复用,
不得按名字入黑名单——只黑他们的 story 文案句式。
**注意 2**:"New Retail" 不入黑名单——真 seed xlsx 含合法项目
"New Retail Smart Shopper Mini Program"(story 独占标识用 "Smart Shopping Guide" 已够)。
**注意 3**:裸 "Wang" 不入黑名单——真 seed roster 有 "Wang Yuxuan"(第 15 行);
story 的 Wang 用其文案签名 "Wang has it steady" 代替(实跑抓到过此假阳性)。

## 已知坑

- headless rAF 停摆:一切等待走 DOM 轮询(snippet 内 setTimeout),不依赖动画帧;截图只作参考。
- **隐藏 tab 定时器节流**(S2 实测):preview tab `document.hidden=true` 时 Chrome 把链式
  setTimeout 节流到 ~1 次/分钟——snippet 内部轮询每 tick 间隔可达 60s。等待预算按
  "后端真实包络 + 60s tick 粒度"配(ingest settle 已放 360s);断言条件先于超时判定,
  条件已真时晚到的 tick 仍会 resolve。外部驱动侧用 uvicorn 日志 watcher 判进度,别干等页面。
- `.prototype-topbar` pointer-events:none:模式切换点不动时检查子元素 pointer-events(4e90966)。
- composer 提交进 story 剧本机(TeamComposer.tsx:115 恒走 askQuestion)是当年的确诊渗漏——
  相位 F1 断静态(预填/引用),相位 F2(S2/feat-024 已补)断动态:真提交走 askLive →
  SSE 事件到帧。F2 需要真后端带 key 在跑;provider 偶发抽风时可单独重跑
  `__seedGate.composerAskLive(...)` 再取 verdict,但不得跳过。
