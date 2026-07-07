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
   - `__seedGate.composerCheck()` — **相位 F**:composer 无 story 预填/引用。
   - `__seedGate.verdict()` — 聚合判定。
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
- `.prototype-topbar` pointer-events:none:模式切换点不动时检查子元素 pointer-events(4e90966)。
- composer 提交进 story 剧本机(TeamComposer.tsx:115 恒走 askQuestion)是确诊渗漏——
  相位 F 只断言静态渗漏(预填/引用);askLive SSE 到帧的动态断言等 feat-024 The room 落地后
  补进 snippet(S2)。
