# recon-sidebar — 对话屏侧栏化 + 新建对话（只读侦察，0809）

> 任务背景：Danny 新一轮拍板①「历史记录改成经典 Claude/Codex 式侧栏列表与整体布局」+③「补新建对话入口」。
> 本文件是「别重新侦察」级现状盘点。行号采于 main@2c95946（2026-08-09，#73-#79 五波全落之后）。
> 行号会漂：定位一律 `grep -n '<锚文本>' <file>`。前情正源：recon-room.md / recon-history.md /
> receipt-75-room-claude.md / receipt-78-threads.md / receipt-79-copy-sweep.md（同目录）。
> ⚠ recon-room/recon-history 里的行号大面积过期（#75-#79 大改过），本文件行号是重采的，以本文件为准。

---

## 0 · 半分钟地图

| 部件 | 位置 | 现状 |
|---|---|---|
| 历史入口+面板 | `src/lite2/screens/RoomScreen.tsx:493-597`（`LiteRoomHistory`） | 右上 ghost 钮「历史对话 · N 场」→ absolute 弹出面板，点一场 hydrate 整场 |
| store 线程态 | `src/lite2/store.ts:360-366`（adviseThreads）`:401-405`（threadId）`:1565-1617`（hydrateThread）`:1633-1644`（clearTurns） | #78 已全落，闸齐 |
| 唯一盯着这块的门 | `eval-harness/tools/verify-room-threads.mjs`（40 判据） | 5 条锚历史面板 DOM + 5 处 driver 点击锚，其余 35 条行为级 |
| room 布局 | `RoomScreen.tsx:802-922` + `lite2.css:8817-9140`（#75 段） | `.lite-room` 三个 absolute 子件：scroll / composer / history |
| 像素 | `visual.spec` room 4 张（无材料态）+ `visual-data.spec` room 4 张（有材料+零轮次+空历史） | 侧栏若「常显」则 room-data 4 张必漂；若「有场才显」则零像素覆盖 |
| 新建对话 | 无入口、无文案键 | `clearTurns` 语义上就是它；生成中语义要拍板 |

---

## 1 · #78 后历史面板现状（真实边界，别再用 recon-history 的行号）

### 1.1 LiteRoomHistory（RoomScreen.tsx:493-597）

- **挂载点**：`RoomScreen.tsx:893-899`，在 `contextId !== null` 那一支**里面**（#78 从 `.lite-room` 末尾挪进来的——无材料态没有 hydrate 目标树，注释 894-898 记了理由）。刻意不进 `.lite-room-board` / `.nexus-empty` 两棵门锚树（:494-495）。侧栏化沿用这一支即可，nomaterial 4 张像素与 room-nomaterial 门都碰不到。
- **渲染门槛**：`adviseThreads` 为 null（stub 通道无 `fetchAdviseThreads` / 未拉取）或空数组时整块 `return null`（:519）。**这就是为什么离线门与 room-data 像素里看不到它**。三态语义（null≠[]）在 store.ts:360-366 有碑，侧栏别把它塌掉。
- **入口钮**：`:529-539`，`.lite-btn--ghost .lite-room-history-toggle`，`aria-expanded` + `data-history-toggle`。文案 `roomHistoryTitle`「历史对话」+ `roomHistoryCount`「{n} 场」（zh.ts:1385-1386）。CSS：absolute `top: var(--lite2-clear-top,96px); right:24px; z-index:44`（lite2.css:8280-8286，z 账：空态卡 40 之下压、胶囊 45 / 顶栏 50 之上让——胶囊在 room 屏本来就不挂载，AskAveryLauncher.tsx:80）。
- **面板**：`:540-594`，`.lite-room-history-panel` absolute 右侧，`width min(420px, 100vw-48px)`、`max-height` 让位到 composer 之上（lite2.css:8288-8312；#78 人眼过修过两处：max-height 跟内容走、背景**不透明** `rgb(var(--lite2-surface-rgb))`——浮层不是玻璃，8292-8309 有碑）。内滚。
- **条目**：一行一场 = `<button .lite-room-history-head>`，`data-history-thread={key}` + `data-history-turns={n}`（:557-588）。key = `thread_id || runs[0].id`（空场归属的存量单轮，:550-553）。标题=**首问**单行 ellipsis（`.lite-room-history-q`，lite2.css:8359-8364，注释 576-577：「一场对话是从哪句话开始的」）；meta 行=轮数（`roomHistoryTurns`/`roomHistoryEmptyThread`）+ 时间戳取**最后一轮** `created_at`（:578-587，注释：列表按最近活动排，标开场时间会和排序打架）。时间戳 `toLocaleString` 月日时分（:520-526）。当前场 `li.is-current` accent 描边（:553,556；lite2.css:8354-8357）。
- **禁点**：生成中 `disabled={busy || undefined}` + title 提示 `roomHistoryBusy`（:565-566）；busy 读的是**尾轮**状态不是镜像 run（:511-516 有碑）。
- **点击**：`hydrateThread(thread)` + `setOpen(false)`（:570-573）。无删除、无改名、无分组、无搜索、无分页。

### 1.2 store 的真实边界（store.ts）

- **adviseThreads**（:360-366，初值 :657）：null=未拉/stub，[]=真空。`refreshAdviseThreads`（:1206-1218）：contextId 收口 + `stillOn` 闸 + 静默吞错（404=token 缺错，绝不读成空历史，:1206-1207 碑）。拉取时机在 RoomScreen：挂载/换公司（:780-782）+ 尾轮 complete **或 interrupted**（:787-789，interrupted 那半的理由是「manifest 已落库帧没送到」的窄窗口，:783-786）。
- **threadId**（:401-405）：屏上这一场的 id，服务端铸、SSE 回传（askLive 流回调 :1505-1512 只认尾轮、只在没值时认）。**与 turns 同生共死**：clearTurns/resetRun/换公司都清，孤儿 threadId = 「屏上空白、续问落进上一场」。
- **askLive 带场**（:1459-1461, 1482-1485）：`...(threadId ? { thread_id: threadId } : {})` 条件展开——**不是** `?? undefined`（JSON.stringify 会把 null 原样发出去，absent≠none 纪律 + 门①④判据形状，:1482-1484 碑）。busy 闸在临界区（:1441-1442，尾轮 running 静默丢弃）。
- **hydrateThread**（:1565-1617）三闸全齐：
  - 锁②busy 闸 :1571-1572（UI disabled 是锁①；两把锁配两条独立判据，:1568-1570 碑）；
  - 幂等闸 :1573-1577（`threadId === thread.thread_id && turns.length>0` 即 return——重灌会把刚问的新轮抹掉）;
  - **替换不追加** :1603-1616（政策拍板 a）；尾轮镜像同步 :1605-1607（十道门读顶层 `run.status`）；空串 thread_id 不当场 :1608-1609。
  - 回灌轮构造 :1579-1602：`hydrated: true`、refs 恒 null（结构性没落库）、status 硬编 'complete'（写门有据）、advice 走 `coerceAdvice`、followups 另调 `coerceFollowups(advice.followup_questions)`（advice 路可恢复、短答路后端没存——不对称是真实存储差异，:1594-1596 碑）。
- **clearTurns**（:1633-1644）：`_abort()` + turns/run 镜像/threadId/ask 四件全清。**无 busy 闸**（销毁类，unmount cleanup 用它：RoomScreen.tsx:666）。`resetRun`（:1619-1631）字段面等价的老 action。
- **公司域清理三抄本**（改一处必改三处）：restoreSession 404 分支 :940-944 / adoptContext :980-982 / resetLiteCompanyData :1780-1782——adviseThreads + threadId 各清一次。侧栏若新增任何公司域状态（折叠态可以只放 localStorage/组件态，不进 store 公司域）要记得这三处。

### 1.3 回灌轮渲染降级现状（LiteTurnView，RoomScreen.tsx:311-491）

`turn.hydrated === true`（:341）驱动四条降级，全部有门（room-threads ⑦ 组）：
不渲染四相面板、换一行 `.lite-room-turn-hydrated`「从历史载入」`[data-hydrated-note]`（:379-384；文案 zh `roomTurnFromHistory`）；不挂实时状态条 HUD（:389 `isLast && !hydrated`）；refs=null 自然无引用 chips 行（:362）；`data-turn-hydrated` 属性抓手（:355）。followups 只挂尾轮+complete+有回答（:345-346）——hydrate 场的尾轮 advice 路会出 chips 且可点（免费续问入口）、短答路不会。原始流对回灌轮整块不在（四相面板都没渲染，toggle 无宿主）。

---

## 2 · verify-room-threads 40 判据逐条分类 + 门际互动

### 2.1 逐条分类（rec 调用序；行号见 verify-room-threads.mjs）

**A · 锚在历史面板 DOM 上（5 条）——侧栏化必须保 data-* 属性或同拍改判**：

| # | 判据 | 锚 | 行 |
|---|---|---|---|
| 18 | ⑥ 面板列出两场（不是三条） | `[data-history-thread]` 行数 | :194-196 |
| 19 | ⑥ 场按最近活动新→旧 | 行的 data-history-thread 序 | :195-198 |
| 20 | ⑥ 自证：找得到旧那场的行 | `[data-history-thread="tid"]` count | :201-203 |
| 21 | ⑥ 自证：旧场行标两轮 | `data-history-turns` 属性 | :204-205 |
| 38 | ⑨a 生成中条目**属性上** disabled | 行 button 的 disabled | :288-293 |

**B · driver 级点击锚（不是判据但缺了整门 crash 不红——#75「会崩不会红」家族）**：
`[data-history-toggle]` 被点 3 次（:192, :261, :286）、`[data-history-thread="…"]` 被点 2 次（:215, :263）。
🔴 **侧栏常显=没有 toggle 可点** → :192 的 click 超时抛错、⑥-⑩ 整段崩（门里 :199-213 专门为「行不在」写了防崩，但 toggle 不在没有防）。侧栏化要么留一枚挂着 `data-history-toggle` 的钮（折叠钮/手机抽屉开关都行——但语义变了：点了之后 `[data-history-thread]` 行必须可见可点），要么同拍改 driver（把三处 toggle 点击改成「若 toggle 不在则跳过」或直接删）。

**C · 行为级（35 条）——网络体/store 值/board 内 DOM，侧栏化原样保留**：
⓪×2（语料自证/threadId null）· ①×3（POST 发出/无 thread_id 键/终局）· ②×1（回传落 store 槽位值）· ③×4（续问带同 id/带 history/终局/id 不抖）· ④×1（adviseThreads 分组一场两轮）· ⑤×3（turns 清/threadId 清/`data-room-turns="0"`）· ⑥ 前段×3（新场不带 id/终局/另一个 id）+ hydrate 后段×6（整场按序回屏/全 hydrated=替换/board innerText 含两问原文/回灌带回答/threadId 切/尾轮镜像 complete）· ⑦×5（板内 `[data-turn-hydrated]` 族：×2 挂标/无四相/无 HUD/有 note/无 ref chips）· ⑧×4（续问带旧场 id/history≥2/终局/落库两场三轮）· ⑩×1（幂等：刚问那轮仍是活轮 hydrated===false）· ⑨b×1（绕 UI 直调 store 闸，拿**另一场**试）· ⑪×1（零 pageerror）。
⑦ 组锚在 board 树内的回灌轮 DOM，与面板长在哪无关；⑩⑨ 的 driver 仍要点到行（见 B）。

### 2.2 verify-room-conversation ⑥ ×「侧栏常显」

⑥ 的判据（verify-room-conversation.mjs:340-368）：离开再回来 turns===0、domTurns===0、emptyBoard===1、composer===1、ask 清、**localStorage 里搜不到任何一问的正文**。
- **侧栏常显本身与 ⑥ 零冲突**：判据全落在 turns/board/ask/storage 上，屏边挂一列历史条目一条都不碰。room-threads ⑤ 也同理（它自己就断言「进屋不自动恢复」）。
- **会红的只有两种实现**：进屋自动 hydrate 上一场（⑤⑥ 双红——#71 拍板未翻案前别做）；把对话正文持久化进 localStorage（⑥ 第三条精确红）。侧栏折叠态若想记住，存的是布尔不含问题正文，不触这条判据——但按 session-state 纪律先想清楚要不要存。

### 2.3 其他门有没有摸到

- 全仓 grep `lite-room-history|data-history|adviseThreads|hydrateThread`：**只有 verify-room-threads.mjs 命中**（run-battery.mjs:144 是入册行）。receipt-78 §8 的「43+ 道门零命中」仍然成立——既有门改判面=零，新判据要自己长。
- 但 room 布局门会被**布局**（不是面板）牵动，见 §3.3。
- `scripts/gates/live-frontend-gate.snippet.js`（glob 暗区）：无历史锚；锚的是 `.lite-room .nexus-followup-composer`（:654,691-692）与相位 H 的 `composerInScroll/composerOutside`（:910-911，composer 必须**不在** `.lite-room-scroll` 里且在 `.lite-room` 里）——侧栏动布局时这两条与 §3.3 同族。

---

## 3 · 布局约束

### 3.1 `.lite-room` 现在长什么样（#75 后）

`<section class="scene scene-nexus is-active lite-room">`（RoomScreen.tsx:803），contextId 非空时三个功能子件**全是 absolute 兄弟**：
1. `.lite-room-scroll`：absolute inset:0、overflow-y:auto（lite2.css:791-796）；bottom 被 `max(band120, footer+76)` 抬起（:8183-8185）；底部 44px mask 渐隐（:8193-8201）；scroll-padding-top 120（:6076-6083）。内含 `.lite-room-board`（max-width 900、padding-top `--lite2-clear-top`、padding-bottom `--lite2-room-dock-clear` 168px，:798-808, 6053-6061, 8854-8857）；board 内是 turns 或 `.lite-room-welcome` 开场块（RoomScreen.tsx:828-872）。
2. `.nexus-followup-composer`：absolute，`left:50%; translateX(-50%); bottom: calc(footer-h + 12px); width: min(828px, 100vw-48px)`（:8228-8233），#75 段再补 `width: var(--lite2-room-col)` + flex-wrap（:8842-8852）。**语义 token**：`--lite2-room-col` / `--lite2-room-composer-gap` / `--lite2-room-dock-clear` 定义在 `.lite2-shell .lite-room` 上（:8830-8840）。
3. `LiteRoomHistory` toggle+panel：absolute 右上（§1.1）。

### 3.2 侧栏挂哪一层——三个候选的事实

- **`.lite-room` 内（屏级）**：唯一不撞 #66 的便宜落法。`.scene` 是 absolute inset:0 + overflow:hidden，`.scene.is-active` 带 `transform: translateY(0) scale(1)`（00-base.css:152-172）——**计算值非 none，fixed 后代的包含块被劫持**（AskAveryLauncher.tsx:17-21 头注碑）。所以屏内侧栏必须 absolute（第四个兄弟：`left:0; top:var(--lite2-clear-top); bottom:<让位>; width:<新 token>`），然后 `.lite-room-scroll` 加 `left:<侧栏宽>`、composer 改 `left: calc(50% + 侧栏宽/2)` 或把 `--lite2-room-col` 的 100vw 换算扣掉侧栏——全部可在 lite2.css 尾段 APPEND 完成，**门锚三纪律一条不破**（见 3.3）。
- **`.scene` 之外 / 壳级**（对齐 Claude.ai 全局侧栏）：要动 `.scene-stage` 的布局语法（00-base.css:152-156 absolute inset:0 是 story 冻结基座，只能 `.lite2-shell` 作用域覆盖）、九个屏的滚动口/让位账全体重算（verify-topbar-clearance / bottom-furniture-clearance 全家重跑）、且侧栏只对 room 有意义（其他 8 屏没有「场」概念）——0808 拍板本来就没选壳级。事实记录：壳级弹层的现成挂法是 Lite2App.tsx:184-201 那一族（.lite2-shell 直接子元素 + position:fixed）。
- **塞进 `.lite-room-scroll`/board**：违反门锚（3.3），别想。

### 3.3 门锚三纪律（RoomScreen.tsx:810-818 注释 + verify-room-claude-rework ①）

① composer 必须是 `.lite-room` **直接子元素**（`.lite-room > .nexus-followup-composer` 是 lite2.css:8228/8843 与 room-usability 的双承重选择器；verify-room-claude-rework.mjs:129-130 判 `parentElement === room`）——**侧栏不能把 scroll+composer 包进新容器**；
② composer 在 board 之外、滚动区之外（:131-138；snippet :910-911）；
③ 全树 `.nexus-followup-composer` 恒 1 个（:127-128）。
加一条 **发问零跳变**（verify-room-claude-rework.mjs:146-156）：composer x/y/w 在第一问前后逐像素不变。采样点在「空态」与「第一问 POST 后 400ms」——**都在首场 complete 之前**，所以：
- 🔴 **侧栏若「有场才显」**：fresh context 两个采样点都没侧栏 → 门绿；但首场答完 `refreshAdviseThreads` 把侧栏带进来、composer/内容列被挤 → **对话中途布局跳变，一条门都不红**——这正是 #75 消灭的那类病根换个部件重演。
- **侧栏若「常显」（0 场也渲染）**：两个采样点几何一致 → 门绿且无跳变；代价是 room-data 4 张像素必漂（§6）+ 空侧栏要有内容（新建对话钮/空态文案）。
- 折叠/展开切换同理是一次跳变，但那是用户主动动作（Claude 也这样），与「自己长出来」不同类。
- room-usability「滚到底卡尾不被 composer 压住」（verify-room-usability.mjs:166-181）与 at-references ⑧ 弹层几何都是行为级，布局变了**重跑即可**，数字自己说话。

### 3.4 顶栏怎么共处

顶栏是**全局 fixed 胶囊**（≥861：top:14 居中、宽 `--lite2-frame-w`=min(1480,100vw-48)，lite2.css:6089-6100），tab「对话」在顶栏不在屏内（LiteTopbar.tsx:121-151，9 tab；数组一动必须同拍改 snippet `assertV2Boots` 期望数组——本票不动 tab）。屏内侧栏 top 让位 `--lite2-clear-top`（96px / ≤860 72px，:6038-6047；⚠ ≤860 覆盖写了两遍、后段 24px 架空 72px 的债 #75 记过），与顶栏零 DOM 冲突。z 账：侧栏 ≤44（沿 history 面板）、顶栏 50、modal 120、铃 90。底沿让位公式抄 history panel 的 `max(band, footer+76)`（:8296-8299）。

### 3.5 手机形态（≤860）

- **世界切换**（00-base.css:1110-1149）：body 转 overflow:auto、`.app-shell` overflow:visible、`.scene` 转 `position:relative; min-height:1500px`、非 active scene display:none、顶栏 sticky。**`.scene.is-active` 的 transform 在媒体查询里没被清**——恒等变换照样建包含块，fixed 在屏内照样被劫持（这是读码推断，**按 css-containing-block-must-probe 纪律实测再定**）。屏内 absolute 侧栏在手机上锚的是 1500px 高的 scene、跟文档流一起滚——**不适合做常显窄列**（375px 屏也没地方）。
- **断点惯例**：主战断点 860（00-base 世界切换 + room 段 lite2.css:9115-9140 + clear-top 6043）；散见 720/880/560/620。room 手机态已有先例：`--lite2-room-col: calc(100vw-32px)`、composer 两行化（textarea 占满一行、控件靠右，:9129-9139）。
- **可抄的浮层模式（近→远）**：
  1. **历史面板自己**（absolute 右侧 `min(420px,100vw-48)` 内滚、不透明、z44，:8288-8312）——手机上它已经是准全宽抽屉，最省事的手机形态就是「侧栏在 ≤860 退化回这个弹出面板 + 顶部/composer 旁一枚开关钮」；
  2. **LiteModal 基座**（lite2.css:334-367：fixed inset:0 z120 + backdrop blur + 焦点圈/Escape，挂壳级）——真「抽屉盖全屏」要这个量级，但它挂在壳层、拿不到 room 屏内状态的挂载位纪律要重想；
  3. @ 弹层（8607+ 锚定弹出）与设置菜单（LiteTopbar.tsx:211-330 下拉）更远，不适合。
- **memory 碑**：born-red 按视口逐个验；视口高度是盲轴；改完布局必截图人眼过。

---

## 4 · 新建对话的接线点

### 4.1 现有 action 够不够

**语义上 `clearTurns()` 就是「新建对话」**（store.ts:1633-1644）：abort 在飞流 + turns 清 + run 镜像归 emptyRunState（十道门语义一致）+ threadId 清（下一问 askLive 条件展开不带 `thread_id` → 服务端自铸新场，:1482-1485）+ ask 卡散场。回到 `.lite-room-welcome` 开场块 + composer 原地不动（三态统一后零跳变）。adviseThreads **不动**（正确：刚聊的那场已落库，列表里还在）。`resetRun`（:1619-1631）是字段面等价的老 action。**后端零改动。**

### 4.2 但要不要新 action——#78 纪律对表

#78 立的「新 action 必须自带闸 + 同步 run 镜像」：clearTurns 镜像✓、**busy 闸✗**（它是销毁类，unmount cleanup 用它，本来就该无条件）。区别在于「新建对话」按钮是**用户可见入口**：
- 生成中点它 = `_abort()` 打断在飞轮 + 整场从屏上蒸发。被打断那轮**通常不落库**（无 manifest → `_post_advise_hooks` 不调，receipt-78 interrupted 语义节）→ **刚问的问题人间蒸发、历史里也找不回**。这与「停止」（stopLive :1558-1563，停但留屏上）是两种销毁力度。
- 同拍双击风险与 hydrate 不同：第二击落在 turns 已空的 store 上是无害 no-op——store 级闸不是为防双击，是为定「生成中允不允许」。

**三个政策拍板点（票内定，不定就会被实现者随手定）**：
(a) 生成中：禁点（对齐 hydrateThread 拍板 b，两把锁两条判据——UI disabled + 新 action `newConversation` 带 store 闸）vs 允许（= 隐式 stop+散场，Claude.ai 的行为，但我们的被打断轮不落库、比 Claude 丢得多）vs 先 stopLive 再点。
(b) 空态（turns===0 且 threadId null）点它：no-op——按钮藏、灰、还是留着当心理安慰。
(c) 用 clearTurns 复用还是铸新 action：复用=零 store 改动但闸的语义挂在 UI 上（单把锁）；新 action=闸进临界区 + 幂等（turns 空时 return），~15 行，符合 #78 纪律的字面。

### 4.3 UI 连带

- 新按钮必须挂 `.lite-btn` 族类或进 verify-button-family 白名单（lite2.css:8919-8921 碑；attach/stop 两枚的先例是挂 `.lite-btn .lite-btn--ghost`）。
- 文案：**无现成键**（全仓无「新建对话/New chat」，zh 只有「新建一家公司/新建一张表」）。新键进 lite2 段、手工 Edit——⚠ **绝不跑 `scripts/i18n-zh*.mjs` 生成器**（`i18n-zh-lite2-delta.mjs` 会整个重写 zh.ts，memory 碑）；跑只读的 `i18n-orphans.mjs` 验孤儿。中文 aria 别带 ≥4 字母拉丁词（verify-aria-zh 硬门）。
- 门：现有 40 判据零覆盖「新建对话」。新判据应落在：点击后 threadId===null + turns===0 + 下一问请求体无 thread_id 键（行为级三件）+ 生成中那把锁按拍板 (a) 配一或两条。room-threads ⑤ 已证「离开=清」，新按钮是同一语义的显式入口，判据别与它互抄（各测各的触发路径）。

---

## 5 · 侧栏列表的数据面

### 5.1 adviseThreads 里有什么（transport.ts:550-580）

`LiveAdviseThread = { thread_id, runs: LiveAdviseRunEntry[] }`；每 run：`id / created_at(ISO8601 UTC，服务端时钟) / question(原话 verbatim) / title(**恒空**——lite2 从不发 title，recon-history §1.4 仍成立) / locale / advice(jsonb 投影)|answer(互斥) / thread_id("" = 无场归属存量单轮)`。
- 端点 `GET /team/{id}/advise-threads`（ingest_api.py:486-510）：**上限 20 场**（数场不数行，registry.py:909-916 碑）、场按最近活动新→旧（场内**最后一轮**位置，:927-929）、场内 seq 升序；空历史 200+`[]` 绝非 404；owner_token/账号门同 notes。**limit 端点不透传**（:510 用默认 20）——侧栏要更多场就得动端点签名（additive query param，便宜但要过 test_advise_threads 契约）。

### 5.2 标题：首问截断的现状材料

现状 = `runs[0].question` 单行 ellipsis（§1.1）。Claude 式「自动摘要命名」的事实成本：无现成产名通道（manifest 不产 title；要么前端截首问——现状，要么后端在 `_persist_advise_run` 时刻拿 LLM 产一个——烧钱+新契约，要么征用 title 列见 5.4）。

### 5.3 按日期分组（今天/昨天/更早）要什么

- 数据**已经够**：每 run 带 created_at，取场内最后一轮做分组键（与排序键一致，不打架）。**纯前端改动**：本地时区解析 + 与本地午夜比对 + 新 i18n 键（今天/昨天/更早，zh+en 各三）。零后端。
- ⚠ 两个钟的坑：created_at 是**服务器** UTC 时钟；分组是 浏览器 Date.now() vs created_at 的比较。像素/门里若冻浏览器钟（setFixedTime）而服务器走真钟，「今天」标签会错位——见 §6。Docker PG 时钟跳 115s 的碑同族：**别在门里赌分组标签**，判据落在「分组函数给定两个时刻的输出」这类纯函数上，或干脆只判 DOM 结构不判标签归属。

### 5.4 改名/删除的事实成本（只摆事实）

- **没有场级实体**：thread 只是 advise_runs 上的一列（0016），**无 threads 表、无场级 title 挂点**。`title text` 列在**行**上（0012；registry.py:103）且 lite2 恒空写。
- **改名三条路**：(i) 首问截断=现状，零成本；(ii) 征用**场内首轮**的 title 列：无迁移，但要 新写端点（PATCH 语义）+ registry 双腿新方法 + Protocol + `test_registry_protocol` 三方签名比对锁步（receipt-78 §5：钉子只钉 `"delete"` 一个字面名，`rename_*` 不触钉但锁步照付）+ 授权门 + 前端读侧改「title 非空则用 title」；(iii) 场级表=迁移+更大，别选。
- **删除**：v1 明确无删除（0012 拍板 + ingest_api.py:474-475 docstring「只读面（v1 无删除）」）。Protocol 钉子 `test_registry_protocol.py:89-97` 只钉字面 `"delete"`（pg-only 的 context 级 delete()），`delete_advise_thread` 这种名字**不触钉**、可正常进 Protocol。#77 file_delete 先例的形状：独立编排模块（`avery/ingest/file_delete.py`）+ `DELETE /team/{id}/files/{key:path}` 端点（ingest_api.py:924-960）+ 404 无存在性 oracle + 回执 payload + 专测。**删场比删文件干净得多**：advise_runs 无下游血缘（不孵材料/信号/冲突，只有 context CASCADE），一条 `DELETE WHERE context_id AND thread_id`（+内存腿 list 过滤）即可——但仍是「新端点 + 双 registry + Protocol/测试锁步 + 授权门 + 前端确认 UI」的全套量级，且**空串 thread_id 的存量单轮删不动**（无场键，得按 run id 删，又是一条路径）。删除属销毁类，**人工闸纪律**：UI 要二次确认。

---

## 6 · 像素射程

- **54 张现状**：50 张（#79 全量重冻，tab 改「对话」全漂过一轮）+ 4 张 room-data 新增。含对话屏的 8 张：
  - `visual.spec` room 4 张 = **contextId===null 无材料态**（composer/board/历史都不在画面）。侧栏挂 contextId!==null 支（§1.1）→ **这 4 张不漂**。
  - `visual-data.spec` room 4 张 = `{aurora,paper}-room-data-{desktop,mobile}`，**有材料+零轮次+空历史**（fresh context → adviseThreads=[] → 现历史入口不渲染；spec 自证 `.lite-room-welcome` 在场 + nomaterial 为 0，visual-data.spec.mjs:94-100）。
- **侧栏落地漂哪些**：常显侧栏（0 场也渲染）→ **room-data 4 张必漂**，属预期漂移，走主检出人审重冻（born-red 双视口各验，#79 先例）；「有场才显」→ 4 张不漂 = 侧栏**零像素覆盖**（receipt-78 §8 的「没网」状态延续）+ §3.3 的中途跳变问题。其余 46 张不含 room，不动共享家具（composer token/footer/顶栏）就不漂。
- **要不要给「侧栏带场」态补基线——#79 拒冻理由复核**：
  - #79 拒冻「带轮次态」的两条理由（receipt-79 §4.4）：历史面板墙钟时间戳 + mock 判读卡残缺。**对侧栏逐条重审**：侧栏空态（0 场）**无时间戳**——room-data 4 张（若常显）顺带盖住，免费；侧栏**有场态必带时间戳**，且 `created_at` 由**服务器** now() 铸，`page.clock.setFixedTime` 只冻浏览器 Date **钉不住它** → 时间戳文本不可冻。若做日期分组，分组标签=冻结的浏览器钟 vs 真服务器钟的比较 → **恒错位且随跑随变**——比 #79 那次更不可冻。
  - 可行选项：(i) 只靠 room-data 4 张盖空侧栏态（常显前提下自动获得）；(ii) 有场态不入像素、判据全落 room-threads 门的 DOM/store 面（现状路线，门已 40 条）；(iii) 真要冻就得给时间戳/分组做「测试时钟注入」级的呈现改造——为 4 张基线动产品代码，#79 的取舍先例是不做。
- 基线是 gitignore 单机产物：worktree 里重冻=白冻；重冻只在主检出、人审后（memory 碑）。

---

## 7 · Claude/Codex 侧栏解剖 × 我们的对应物

| 解剖项 | 经典形态 | 我们 | 判定 · 依据 |
|---|---|---|---|
| 新对话钮置顶侧栏 | + New chat 恒在列表顶 | 无入口无文案键；`clearTurns` 语义现成（§4） | **半个** |
| 会话列表常显侧栏 | 左列 ~260-300px 常显 | 右上 toggle 弹出面板、**有场才出**（RoomScreen.tsx:519） | **半个**（数据/交互全有，形态不是） |
| 按时间分组 | Today / Yesterday / Previous | flat 列表；created_at 数据已够、纯前端可做（§5.3） | **无**（材料齐） |
| 当前会话高亮 | active 底色 | `li.is-current` accent 描边（lite2.css:8354-8357）+ aria`roomHistoryCurrent` | **有** |
| 标题=自动命名/可改名 | LLM 摘要 + rename | 首问 ellipsis；title 列存在恒空、无写端点（§5.4） | **半个** |
| 标题截断 | 单行 ellipsis | `.lite-room-history-q` nowrap ellipsis（:8359-8364） | **有** |
| 折叠钮（收成窄条/图标列） | 有 | 无——toggle 是开关**浮层**不是折叠侧栏；`data-history-toggle` 可由折叠钮继承（§2.1-B） | **无** |
| 宽度惯例 ~260-300px | 有 | 面板现 420（为读宽定的，:8300-8302 注释）；无侧栏宽 token（`--lite2-room-col` 是内容列，需新 token 进 :8830 那组） | **无** |
| 手机抽屉化 | 汉堡→全屏抽屉 | 无；最近似现成件=历史面板 absolute 浮层（≤860 已近全宽）＞LiteModal 基座（§3.5） | **无**（半个可抄件） |
| hover 删除/改名菜单 | 有 | 无（v1 无删除拍板；成本 §5.4） | **无**（拍板级） |
| 列表分页/无限滚 | 有 | 20 场硬上限、端点不透传 limit（ingest_api.py:510） | **无** |
| 搜索历史 | 部分产品有 | 无（顶栏 LiteSearch 是实体搜索不搜历史） | **无** |
| 点条目恢复整场续聊 | 有 | **有**——#78 hydrateThread 全套（替换/禁点/幂等/降级），40 判据看着 | **有**（本仓最硬的一块） |

---

## 8 · 侦察员意见（仅供排票，非拍板）

1. **最小票形**：侧栏=屏内第四个 absolute 子件（常显、含置顶「新建对话」钮 + 场列表 + 日期分组），≤860 退化为现面板式浮层 + 开关钮继承 `data-history-toggle`；`LiteRoomHistory` 重写为侧栏但保 `data-history-thread/turns/toggle` 三个属性族 → room-threads 40 条里 A 组 5 条 + driver 5 锚**零改判**可保。
2. **必须同拍的三件**：composer/scroll 让位重排（门锚三纪律内可完成，§3.2）；room-data 4 张重冻；新建对话的生成中语义拍板（§4.2 三选一）。
3. **别顺手做的**：改名/删除（各自独立票，§5.4 成本表）；进屋自动恢复上一场（⑤⑥ 双红，#71 拍板未翻案）；对话持久化进 localStorage（room-conversation ⑥ 第三条精确红）。
4. **grill Danny 的口**：侧栏常显 vs 有场才显（门与跳变的取舍在 §3.3，像素账在 §6——常显是门友好的那个）；生成中点新对话丢不丢当前轮。
