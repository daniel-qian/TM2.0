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

## Ask 卡相位(feat-034 阶段 B,独立聚合 `askVerdict()`)

后端 ask 端点(阶段 C)未落地前,本组相位跑在**确定性 stub transport**下:
`http://localhost:5175/?mode=live&transport=stub`(不占 5173/8137;stub 全程离线,
`src/lite/stubTransport.ts`,同一 LiveTransport seam,零真 LLM/零网络)。阶段 C 接线后
换真后端重跑同一组断言。stub 模式下上面 10 个既有相位同样可跑(seed 内容任意字节即可,
stub ingest 确定性返回 16 人 2 项目、含 Lin Qing / Chen Mingyuan)。

在 `composerAskLive(...)`(stub 流会多带一帧 `manifest{kind:'ask-draft'}`)之后按序:

- `await __seedGate.assertAskDraft()` — **相位 K1**:AskCard 以 draft 态挂载
  (`.lite-ask-card[data-ask-status]`);题数 1~3;具名受访者 chips(aria-pressed);
  **逐字编辑真生效**(native setter 注入后 value 回读);**1~3 内增删真生效**;
  诚实红线提示 `.ask-redline-note` 在 DOM(保存时才过服务端红线门,预览未跑,不假装已校验)。
- `await __seedGate.assertAskShare()` — **相位 K2**:确认 → shared;链接数 = 选中受访者数;
  每条 `https://avery.ima-read.com/r/{token}`(host/协议/路径逐条校验);每链接一个复制按钮,
  点击不崩(clipboard 被拒也不崩)。
- `await __seedGate.assertAskCollect(2)` — **相位 K3**:拉取式刷新推进
  shared → collecting(回收 chip "1/2 replied")→ closed。
- `__seedGate.assertAskReceipts('multi')` — **相位 K4** 🔴:多人同题回执 = **一段定性汇总**
  (`.ask-receipt-summary`);零 `.ask-receipt-single`;卡内零 table/score/rank 结构;
  **任一受访者名与数字/yes/no 在 60 字符内零共现**(ADR-0023 边界 3 的机器化)。
- (重跑 `composerAskLive(...)` 得到新草稿)
- `await __seedGate.assertAskSingleFlow()` — **相位 K5**:受访者点选到 1 人 → 1 链 →
  回收 → 单人回执:数值/是否 + **"本人自述"标注**(`.ask-self-label`)+ 原话短评
  (`.ask-receipt-comment`)。
- `await __seedGate.assertAskRedline()` — **相位 K6** 🔴(全 DOM 结构闸):人卡零数字
  (连裸数字都不许,回执值/标注不得漏上人卡)、全文档零分数表结构、story 名词黑名单 = 0。
- `__seedGate.askVerdict()` — 6 相位独立聚合(不并进 `verdict()`:真后端跑既有 10 相位时
  ask 相位可能尚未接线,两本账各自诚实)。

### Ask 相位已知坑

- **隐藏 pane 计时器深度节流**:Browser pane 隐藏超 ~5 分钟后 Chrome 把链式 setTimeout
  钳到 ~1 次/分——不止慢,**会把 4s/10s 级 poll 预算直接打超时(假红)**。驱动侧先装
  MessageChannel setTimeout shim(消息不被节流;只影响驱动环境,断言零改动)或保持 pane 可见。
- tab 切换后组件下一 tick 才挂载:重跑 `composerAskLive` 前先 poll `.composer-card` 出现
  (K1/K5 内部已自带挂载 poll)。

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
