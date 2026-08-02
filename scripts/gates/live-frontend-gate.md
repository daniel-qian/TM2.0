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
4. **按序跑相位**(每步返回 JSON,全部记进 evidence)。
   🔴 **判定口径一概不在本文件**——每条断言的阈值/名单/例外以
   `live-frontend-gate.snippet.js` 的函数头注释为准,这里只留**调用序 + 一句话这相位管什么**
   (够你决定"该不该跑它/它红了大概是哪块坏了",要改断言就去 snippet)。
   括号里的数字是 snippet 顶部 Usage 表的行号。

   | 序 | 调用 | 这相位管什么 | snippet |
   |---|---|---|---|
   | — | `defuseAnimations()` | headless 下 rAF 停摆,先把 transition 旁路掉 | :17 |
   | A | `scanStoryNouns()` | 上传**前**空态:story 专有名词黑名单 | :18 |
   | B | `await injectSeeds([{name,b64},…])` | 真 `<input>` 注入官方 seed → 真 POST /ingest | :19 |
   | C | `assertTeamRendered()` | 人卡渲染出来了,且卡上零血条数字(红线) | :20 |
   | D | `scanStoryNouns()` | 上传**后**再扫一次(同 A 的函数) | :21 |
   | E | `await openPersonDetail(name)` | 点人卡开详情,显 live payload 而非兜底 | :22 |
   | F1 | `composerCheck()` | composer 无 story 预填/引用(**静态**) | :23 |
   | F2 | `await composerAskLive(q)` | 真提交 → /advise SSE 到帧(**动态**,真后端 1–3 分钟)。<br>🔴 verdict 的 `composerIsLive` = F1 **且** F2,漏跑 F2 = 红 | :24-26 |
   | G | `assertTeamGrouped()` | 人栏是分组容器 + 折叠 toggle 真生效 | :27 |
   | H | `assertRoomCanvas()` | 画布已**绝迹**(0729 翻转)+ composer 留滚动区外恒可点。<br>相位名/结果键仍叫 roomCanvas,别改(verdict 聚合认它) | :28 |
   | I | `assertPlaybooksEmpty()` | Playbooks 空态形态 | :29 |
   | J | `assertVisionSurface()` | Vision 三拍叙事 + mock 必带 preview/coming 标注;示例人零数字(红线) | :30 |
   | K | `await assertNotesSurface()` | 笔记屏:常驻红线信任条 + 条目零人卡数字 + 只读。<br>**必须排在 F2 之后**(一次真 advise 才会写出笔记) | 函数头注释<br>1314-1321<br>(Usage 表漏收) | 
   | — | `verdict()` | 11 相位聚合判定 | :31 |

   🔴 **"snippet 为准"有一个例外：snippet 自己的顶部 Usage 表已经陈旧。**
   `snippet.js:31` 还写「aggregate (10 phases)」、`:71-72` 写「10-phase gate (phases A-J)」、
   `:63` 写「8 tabs」——都是 feat-033（相位 K）与 files-hub-0729（第 9 个 tab）之后没同步的旧数。
   **真相在函数体里**：`verdict()`（:1364-1383）实际聚合 **11** 个键；`assertV2Boots` 的 expected
   数组（:1395-1426）实际断 **9** 个 tab。照 Usage 表跑会得出错的相位数和错的 tab 名单。
   （同步 snippet 头注释本身是另一张票，不在本次改动范围内。）
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
   - `await __seedGate.assertV2Boots()`:见 live-frontend-gate.snippet.js 的 assertV2Boots
     (头注释 63-64,tab 顺序权威清单见函数正上方 1395-1426);snippet 为准。
   - `const before = __seedGate.readSkinSnapshot()`:见 live-frontend-gate.snippet.js 的
     readSkinSnapshot(头注释 65,实现自带注释 1496-1499);snippet 为准。
2. 导航到同 URL 但 `&look=aurora`(整页刷新,重新注入 snippet——观感只在挂载时读一次 URL,
   见 `src/lite2/look.ts`):
   - `const after = __seedGate.readSkinSnapshot()`
   - `__seedGate.assertSkinTokens(before, after)`:见 live-frontend-gate.snippet.js 的
     assertSkinTokens(头注释 68,实现自带注释 1511-1513);snippet 为准。
3. 导航到 `?v=1&mode=live&transport=stub`——**先跑一遍既有 11 相位**(相位 A-K,同一 stub
   session,seed 内容任意字节即可)拿到 `verdict()`,再:
   - `__seedGate.assertV1Untouched(verdictResult.pass)`:见 live-frontend-gate.snippet.js 的
     assertV1Untouched(头注释 73,`?v=1` 裁定出处见函数正上方 1461-1464);snippet 为准。
4. 导航到 `?mode=story`:
   - `__seedGate.assertStoryUntouched()`:见 live-frontend-gate.snippet.js 的
     assertStoryUntouched(头注释 75,实现自带注释 1476-1478);snippet 为准。
5. 仓外(不在浏览器里,snippet 管不到):对 4 个新墙方向各自实证"先红后绿"——
   `lite2→story` / `story→lite2` / `lite→lite2` / `lite2→lite`,每个方向:临时在对应文件
   追加一行违规 import → `npm run lint` 记 exit code(须为 1)→ 撤掉该行 → 复跑
   `npm run lint`(须为 0)→ `git diff --stat` 确认改动文件已归零。四个方向都验完后:
   - `__seedGate.recordWallRed({ pass: true, directions: { liteToLite2: {...}, ... } })`:
     见 live-frontend-gate.snippet.js 的 recordWallRed(头注释 78,实现自带注释 1486-1490);
     snippet 为准。
6. `__seedGate.v2Verdict()`:见 live-frontend-gate.snippet.js 的 v2Verdict(头注释 79);
   snippet 为准。

**收尾**:JSON 原样贴进 `feature_list.json` evidence / progress.md,连同第 5 步 lint 的原始
exit code 记录(红是成功,绿是收工)。
