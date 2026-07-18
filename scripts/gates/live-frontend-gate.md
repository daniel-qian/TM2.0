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
   - `await __seedGate.assertNotesSurface()` — **相位 K**(feat-033):Avery's notes 写侧笔记屏。
     **在 composerAskLive 之后跑**——一次真 advise 现在会写一条真笔记,故此时应已 POPULATED。
     断言:屏挂载 + **常驻红线信任条 `.lite-notes-redline-note`** + 观察条目(`.lite-notes-entry-text`)
     **零人卡数字**(红线,写侧后端门已拦,此处在渲染面复核)+ 条目**只读**(观察正文非 button)
     + 该屏 story 名词黑名单 = 0。空态(没跑 advise)也容忍(空态卡 + 信任条)。
   - `__seedGate.verdict()` — 聚合判定(11 相位:原 6 + teamGrouped/roomCanvas/playbooksEmpty
     + visionSurface + notesSurface)。
5. **收尾**:停 dev server、杀 8137 uvicorn。verdict JSON 原样贴进
   `feature_list.json` evidence / progress.md。

## Ask 卡相位(feat-034 阶段 B,独立聚合 `askVerdict()`)

本组相位默认跑在**确定性 stub transport**下(离线回归/演示通道):
`http://localhost:5175/?mode=live&transport=stub`(不占 5173/8137;stub 全程离线,
`src/lite/stubTransport.ts`,同一 LiveTransport seam,零真 LLM/零网络)。**阶段 C 后端已落地**
(2026-07-14:POST /ask·/ask/{id}·share·GET·revoke + 员工 H5 /r/{token},见
`.issues/ask-card-0713/stage-c-handoff.md`)——部署波拉真 8137 后去掉 `?transport=stub`
重跑同一组断言(届时 F2 相位要求离线标注**不在**)。stub 模式下上面 11 个既有相位同样可跑
(seed 内容任意字节即可,stub ingest 确定性返回 16 人 2 项目、含 Lin Qing / Chen Mingyuan)。

在 `composerAskLive(...)`(stub 流会多带一帧 `manifest{kind:'ask-draft'}`)之后按序:

- `await __seedGate.assertAskDraft()` — **相位 K1**:AskCard 以 draft 态挂载
  (`.lite-ask-card[data-ask-status]`);题数 1~3;具名受访者 chips(aria-pressed);
  **逐字编辑真生效**(native setter 注入后 value 回读);**1~3 内增删真生效**;
  诚实红线提示 `.ask-redline-note` 在 DOM(保存时才过服务端红线门,预览未跑,不假装已校验)。
- `await __seedGate.assertAskShare()` — **相位 K2**:确认 → shared;链接数 = 选中受访者数;
  每条 `https://avery.ima-read.com/r/{token}`(host/协议/路径逐条校验);每链接一个复制按钮,
  点击不崩(clipboard 被拒也不崩)。
- `__seedGate.assertAskOfflineNote()` — **相位 F2(阶段 C,demo 诚实性)**:在 shared/collecting
  态运行(K2 之后、K3 之前)。stub 通道(`?transport=stub`)下 `.ask-offline-note`
  ("离线预览——链接不可用")**必须在**;真后端下**必须不在**(链接是真的)——同一断言两向诚实。
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
- `await __seedGate.assertAskStatusGuards()` — **相位 F1(阶段 C,status 词表)**:经
  `window.__liteAsk.coerceAskDraft` 断言未知 status **折 closed 绝不折 draft**(已发出/已撤回的
  ask 不得以可编辑草稿复活);`revoked`/`expired` 原样保留;再驱动 `window.__liteStore` 渲染
  两终态,断言 `.ask-revoked-note` / `.ask-expired-note` 在 DOM 且链接区已撤(跑完恢复原 ask)。
- `__seedGate.assertAskCoerceStrict()` — **相位 F3(阶段 C,坏形状宁可不出卡)**:
  \>3 题 / 未知题型(matrix)/ 回执值域外(scale 收到 99、yesno 收到数字)→ coerce 一律
  返回 null(不再截断、不再折 scale、不渲染 "99 out of 5");合法形状照常出卡。
- `__seedGate.askVerdict()` — **9 相位**独立聚合(K1–K6 + 阶段 C 的 F1/F2/F3;不并进
  `verdict()`:两本账各自诚实)。

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

## v2 相位(feat-035,独立聚合 `v2Verdict()`,相位组 A)

> **feat-068 更名**:本门驱动的 paper|aurora 开关已从旧的 skin 查询参数/DOM 属性改名为
> `?look=` / `data-look`
> (`Skin` 此后专指 ADR-0021 的行业视觉主题;Lite2 的两张审美面孔叫 `Look`)。下方 URL 与
> DOM 属性均已更新;门自身的相位名/函数名(`readSkinSnapshot` / `assertSkinTokens` /
> `skinTokens` / `skinVerdict` / `skinNoLeak`)**故意保持原名**——这些 key 被 feature_list.json
> 里已归档的 evidence 逐字引用,改名会切断可追溯性。读作 Look 相位的历史名即可。
> 旧的 skin 查询参数不再被识别(回落 paper 缺省),不留兼容别名。

**出生即红**(2026-07-14,feat-035 实现前):无 `.lite2-shell`、无 `?v=` 开关——立门先于实现。
全程 `?transport=stub`(离线确定性,不需要真后端;`src/lite2/stubTransport.ts`,同一
LiveTransport seam,与 v01 stub 独立实例)。跨 3 次页面导航 + 1 次仓外 lint,驱动器
(agent 会话)自己持有跨导航的 JSON 快照,不能全指望页内状态。

跑法:

1. 打开 `http://localhost:5173/?v=2&mode=live&transport=stub&look=paper`(或 preview_start
   起的 dev 端口),注入 snippet:
   - `__seedGate.defuseAnimations()`
   - `await __seedGate.assertV2Boots()` — **v2Boots**:`.lite2-shell` 挂载 + 8 个 tab、
     顺序精确匹配(`Your team · Projects · The room · Follow-ups · Avery's notes ·
     A closer look · Playbooks · Where this goes`)。PRD 的 6 个 + feat-047 的
     `Avery's notes` + feat-055 的 `Projects`。⚠ 增删或重排 `src/lite2/LiteTopbar.tsx`
     的 tab,必须在同一个 commit 里同步 snippet 里的 `expected` 数组,否则本相位必红。
   - `const before = __seedGate.readSkinSnapshot()` — 记下 paper 观感的 `data-look` + 关键计算值。
2. 导航到同 URL 但 `&look=aurora`(整页刷新,重新注入 snippet——观感只在挂载时读一次 URL,
   见 `src/lite2/look.ts`):
   - `const after = __seedGate.readSkinSnapshot()`
   - `__seedGate.assertSkinTokens(before, after)` — **skinTokens**:`data-look` 属性变化
     **且**至少一个关键计算值(背景图/文字色)随之变化(证明令牌层真的接进去了,不是挂了个
     没人消费的属性)。
3. 导航到默认 URL `?mode=live&transport=stub`(不带 `v=`)——**先跑一遍既有 10 相位**
   (相位 A-J,同一 stub session,seed 内容任意字节即可)拿到 `verdict()`,再:
   - `__seedGate.assertV1Untouched(verdictResult.pass)` — **v1Untouched**:当前页零
     `.lite2-shell` 节点 **且** 传入的 v01 十相位 verdict 全绿。
4. 导航到 `?mode=story`:
   - `__seedGate.assertStoryUntouched()` — **storyUntouched**:零 `.lite2-shell` 节点
     (story 壳物理够不到 lite2 的根类,同 S4/S5 的 "story 未受影响" 套路搬到 lite2 根类)。
5. 仓外(不在浏览器里):对 4 个新墙方向各自实证"先红后绿"——
   `lite2→story` / `story→lite2` / `lite→lite2` / `lite2→lite`,每个方向:临时在对应文件
   追加一行违规 import → `npm run lint` 记 exit code(须为 1)→ 撤掉该行 → 复跑
   `npm run lint`(须为 0)→ `git diff --stat` 确认改动文件已归零。四个方向都验完后:
   - `__seedGate.recordWallRed({ pass: true, directions: { liteToLite2: {...}, ... } })` —
     **wallRed**:把上面 4 组 exit code 证据塞进来(浏览器测不了 lint,这一相位是唯一一个
     纯手工记录、不靠 DOM 断言的相位)。
6. `__seedGate.v2Verdict()` — 聚合(5 相位:v2Boots / v1Untouched / storyUntouched /
   wallRed / skinTokens)。

**收尾**:JSON 原样贴进 `feature_list.json` evidence / progress.md,连同第 5 步 lint 的原始
exit code 记录(红是成功,绿是收工)。
