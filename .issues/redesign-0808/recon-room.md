# recon-room · 议事室（问 Avery）+ @ 引用弹层 + 悬浮胶囊 全量 UX 审计（0808 重构前侦察）

> 只读侦察产物，供重构 session 直接开工——**别重新侦察**。所有行号采于 main@a49d4e7（2026-08-08）。
> 行号会漂：定位一律 `grep -n '<锚文本>' <file>`，函数名/类名稳定、行号不稳定。

## 0 · 部件与文件地图（先背下来）

| 部件 | 文件 | 规模 | 职责 |
|---|---|---|---|
| 议事室屏 | `src/lite2/screens/RoomScreen.tsx` | 681 行 | 三态渲染 + 会话流 + 分析面板 + 历史抽屉 |
| @ 引用 composer | `src/lite2/AskRefComposer.tsx` | 429 行 | 议事室常驻 composer 与悬浮胶囊**共用**的输入部件（@ 弹层/chips/键盘/busy） |
| 悬浮胶囊 | `src/lite2/AskAveryLauncher.tsx` | 115 行 | 全局 fixed「问 Avery」入口，提交=中继不发问 |
| 快问卡 | `src/lite2/AskCard.tsx` | 320 行 | Quick ask 草稿→分享→回执卡（feat-034/ADR-0023） |
| @ 候选纯函数层 | `src/lite2/askRefs.ts` | 226 行 | 检索/轮转发牌/织文/URL 编解码/refOf* 构造器 |
| history 压缩 | `src/lite2/askHistory.ts` | 61 行 | 前端镜像配额（权威在后端 `eval-harness/service/history.py`） |
| store 会话流 | `src/lite2/store.ts` | 1552 行 | `LiveTurn`/`turns`/`askLive`/`clearTurns`（:276-296, :354-366, :1275-1393） |
| 预填通道 | `src/lite2/flowStore.ts` | 310 行 | composerDraft/composerHint/composerDraftRefs（:136-150, :226-246） |
| 壳与中继 | `src/lite2/Lite2App.tsx` | 269 行 | useRoomQueryRelay（:251-269）+ 胶囊挂载位（:196-199） |
| 路由 | `src/lite2/routes.ts` | 293 行 | EPHEMERAL_PARAMS `['q','qh','refs']`（:164） |
| 流状态 | `src/lite2/streamSource.ts` | 610 行 | `LiveRunState`（:88-127）：advice/answer/followups/askDraft/phases/citations |
| 样式主体 | `src/lite2/styles/lite2.css` | **8759 行** | APPEND-ONLY 层积岩，room 相关散在 ≥10 段（见 §5） |
| 两皮令牌 | `styles/look-paper.css` / `look-aurora.css` | 73 / 670 行 | `--lite2-*` 令牌族，`data-look` 切换 |
| 冻结基座 | `src/shared/styles/00-base.css`(1257行) `40-nexus-empty.css` `55-ask-composer.css` `60-terminal.css` | — | story 时代 absolute 布局，lite2 只能「解除式覆盖」不能改 |
| 后端 | `eval-harness/service/app.py`(/advise :412) `contract.py` `history.py` | — | references（app.py:128-166）/ history（app.py:167-171）/ followups 投影（contract.py:91-231） |

---

## 1 · 信息架构与交互全量清单

### 1.1 入口盘点（10 路，两条预填通道）

**通道语义（#69 拍板）**：`q`=正文（manager 原话，落输入框正文）；`qh`=灰提示（模板产文，落 placeholder，发送不带、一打字即消失）。中继链：`goScreen('room',{q|qh,refs})` → URL query → `Lite2App.tsx:251-269 useRoomQueryRelay`（render 期搬运，location.key 认领）→ `flowStore.setComposerDraft/setComposerHint`（flowStore.ts:232-243）→ `RoomScreen.tsx:492-539 claimComposerEntry`（StrictMode 双挂安全）。`routes.ts:164` 把 `q/qh/refs` 列为一次性参数（导航即删）。

| # | 入口 | 文件:行 | 通道 |
|---|---|---|---|
| 1 | 顶栏 tab「问 Avery」（zh.ts:489 `tabRoom`；8-tab 序注释 LiteTopbar.tsx:109-119） | `LiteTopbar.tsx` | 纯切屏 |
| 2 | 悬浮胶囊（除 room 外全屏、contextId 非空） | `AskAveryLauncher.tsx:77,82` | **唯一的 q 正文通道** + refs |
| 3 | 团队屏人卡「去问 Avery ↗」 | `TeamScreen.tsx:147,312` | qh + person ref |
| 4 | 项目屏卡面「去问 Avery ↗」 | `ProjectsScreen.tsx:252,390-391` | qh + project ref |
| 5 | 项目详情浮层 | `DetailOverlay.tsx:219-227` | qh + project ref |
| 6 | 人员详情浮层 | `DetailOverlay.tsx:604-612` | qh + person ref |
| 7 | home 晨间分诊卡「带进议事室」 | `HomeScreen.tsx:213-224 handleTakeToRoom` | qh + **多引用**（项目+人员） |
| 8 | home 差距卡「直接问本人」（zh.ts:732 `gapAskLabel`） | `HomeScreen.tsx:237-249 handleGapAsk` | qh + project ref |
| 9 | home 决策卡「带进议事室」（唯一走 URL 中继的卡入口） | `HomeScreen.tsx:534-547` | URL `qh`+`refs`（q:null 显式删正文键） |
| 10 | home 决策块「问 Avery →」链 / NotesScreen 空态 CTA | `HomeScreen.tsx:487` `NotesScreen.tsx:84,182` | 纯切屏 |

ref 构造统一走 `askRefs.ts:52-80 refOfPerson/refOfProject/refOfSubject`（#67「一把尺」纪律：查不到 id 返回 null → 入口退纯文字，绝不硬造 chip）。

### 1.2 议事室三态（RoomScreen.tsx:586-675）

- **态 A · 无材料**（`contextId===null`，:622-640）：`.nexus-empty.lite-room-nomaterial[data-room-nomaterial]`，无 composer 无 chips，只有引导 + 「去添加材料」CTA（goScreen('home')）。eyebrow 刻意用 tab 名不用 liveThinking（:628-630 注释）。
- **态 B · 空态**（contextId 有、turns 空，:642-674）：`.nexus-empty` 居中卡（**story 冻结样式**：`40-nexus-empty.css:3-17` `absolute; top:42%; translate(-50%,-50%); width:min(560px,…)`）。卡内顺序：eyebrow（🔴 用的是 `t.nexus.liveThinking`=「正在仔细梳理中 — 实时」，zh.ts:288——此刻并没有东西在被梳理，nomaterial 态修过这句、空态没修）→ h2 roomEmptyTitle（zh.ts:859「把眼前的事拿来问 Avery」）→ body → **composer**（`.nexus-empty-composer-wrap`，:646-656，placeholder=`entry.hint ?? t.nexus.askPlaceholder`）→ **建议问题 chips 在 composer 下方**（:658-673，`ROOM_CHIPS` 4 个 :480-485，`data-chip-id` 稳定；**点击即发**，直接 `askLive`，不经 composer）。
- **态 C · 会话流**（turns>0，:588-621）：`.lite-room-scroll`（滚动区）> `.lite-room-board[data-room-turns=N]` > N× `LiteTurnView`；composer 在**滚动区外**恒可点（:613-620，busy={running}）。

**composer 为什么悬在屏幕中央**：空态复用了 story 的 `.nexus-empty` 卡（absolute 居中 42%），composer 被 `.nexus-empty-composer-wrap`（lite2.css:478-492）static 化塞进卡内自然流——不是有人设计了「居中 composer」，是 story 空态卡的历史形状 + 「composer 不盖文案」的补丁（lite2.css:472-477 注释）层层叠出来的。第一问发出后切到态 C，composer 瞬移到屏底（见 §4 反人类 #1）。

### 1.3 会话流的一轮（LiteTurnView，RoomScreen.tsx:267-401）

DOM 序（一轮 `<article class="lite-room-turn" data-room-turn=id>`）：
1. **问题行** `.lite-room-turn-question`（:298-317）：eyebrow「你问的」+ 原话回显（织文前的，:300-302 注释）+ refs 回显 `.lite-room-turn-ref`——🔴 **类名刻意不同于** `.lite-ref-chip`（:264-266：多道门按 `.lite-room .lite-ref-chip` 数量断言，历史轮长同类名节点=判据整批毒化）。
2. **分析过程面板** `LiteThinkingFlow`（:115-218）：默认四相简化视图（read/crosscheck/method/act，`streamSource.ts:104` 恒 4 条恒序；副文案只由真计数派生 :93-110，没亮的相位诚实「待命」）；`.lite-flow-toggle[data-flow-toggle]`「展开原始流」切回深色终端（`RawStreamLog` :50-84，story 60-terminal.css 同款 chrome）；crosscheck 相带「依据 N 条原文」toggle → 引用列表（:173-213）；SSE 断流出 `.lite-flow-failed[data-flow-failed]`（:192-196）。
3. **实时状态条** `.nexus-brief-hud`（:322-335）只挂尾轮：eyebrow=liveThinking + running/ready/error 三词。
4. **回答**二选一：短答气泡 `.lite-room-answer-card`（:339-352，0729/03 分流：事实问直答，与判读卡互斥）或判读卡 `LiteAdviceCard`（:354-366，8 字段）。两者下都可能带「Avery 记了一条笔记 →」nudge（:346-350/:360-364，notesNudge zh.ts:373；仅尾轮+后端确认落库，点击 goScreen('notes')）。
5. **建议追问 chips** `.lite-room-followups[data-followup-chips]`（:372-389）：仅尾轮+complete+有回答（:293-294 推导）；chip 文字=完整问题，**点击即发**（:382 onAskFollowup→askWithRefs(q,[])）。
6. **快问卡** `AskCard`（:394-398）：恒挂尾轮；#72 撤卡重裁——没动过的草稿随新一轮退场，动过的/已发出的受保护（store.ts:1288-1294）。

**store 侧**（store.ts）：`turns` 唯一真相（:358），`run` 只是尾轮镜像留给十几个旧消费者（:360-363）；`askLive`（:1275-1370）：busy 闸在 store 临界区（:1281-1282，UI disabled 挡不住同拍第二击）、history 组装点收口在 store（:1298）、流回调按 turn.id 认领防串写（:1321-1329）。**离开议事室=对话销毁**：RoomScreen:543 `useEffect(() => () => clearTurns(), …)` unmount 即清；clearTurns（:1389-1393）连受保护的快问卡一起散场。刻意零持久化（askHistory.ts:9-11 禁 localStorage）。

### 1.4 历史抽屉「之前问过的」（LiteRoomHistory，RoomScreen.tsx:409-475）

- 入口：右上角 ghost 按钮「之前问过的 · N」（CSS lite2.css:8243-8249，absolute top=clear-top right:24 z44）；空态/对话态都渲染（:677-678）；`adviseRuns` 为 null 或空则整块不出（:414）。
- 面板：absolute 右侧 `min(680px,100vw-48)` 内滚（lite2.css:8251-8265），条目=问题+时间戳，展开才 `coerceAdvice` 回放判读卡/短答（:435-468）。**只读**——不能续问、不能带回 composer。
- 数据：`refreshAdviseRuns`（store.ts:1048-1057）挂载/换公司拉一次 + 每轮 complete 后再拉（RoomScreen:565-573）；后端 `advise_runs` 表（app.py:347 注释：与笔记同一 manifest 时刻落库）。

### 1.5 composer 全量交互（AskRefComposer.tsx）

- **@ 触发**：`detectToken`（:46-51）光标前最近 `@词`（@ 与光标间无空白无另一 @；**刻意不要求 @ 前有空格**——中文语境；代价：邮箱形状也弹层，:44-45）。`onChange`+`onSelect(redetect)` 双入口（:404-413），token 变更收口 `applyToken`（:212-223）。
- **Esc 静音位**：`mutedRef`（:130-137）——必须是 ref 不是 state（React 同一 keydown 批次里 onKeyDown 后紧跟 onSelect，state 版闭包恒旧值，Esc 关的层被原地重开——门⑦实测）。
- **筛选**：5 chips（全部/人员/项目/文件/方法，:53-59）在弹层**顶部占一行**；候选=`searchAskRefs`（askRefs.ts:87-131，person/project 走顶栏同源 searchTeam，file=filename includes，playbook=title+desc+tags）→ `pickRefOptions` 轮转发牌（askRefs.ts:154-174，#70：防 16 人团队把文件/方法整类挤出「全部」视图；上限 MAX_REF_OPTIONS=8）。
- **键盘**：↑/↓ 高亮、Enter 选中（层开着 Enter 归选中不归提交，:262-265）、Esc 关层→再 Esc 透传 `onEscapeClosed` 收胶囊（:266-274）。
- **选中/移除**：pick 摘 @词 长 chip（:237-247，去重）；`.lite-composer-remove` 键盘可达（:378-386）。
- **提交**：双闸——主闸 submit 键 `disabled={busy || (disableEmptySubmit && empty)}`（:423，#69/#71 判据落在这个属性上）+ handler 兜底 `if (busy || !text) return`（:277-288，Enter 隐式提交路径）。
- **busy**：#71 上一轮 running 时整个置灰（RoomScreen:619 busy={running}）；「为什么不做打断」记档在 :108-112（中止流会被收成假 complete，要诚实表达打断得新起状态与文案——**本票不做**，重构可翻案）。
- **placeholder 通道**：空态 composer `placeholder={entry.hint ?? t.nexus.askPlaceholder}`（RoomScreen:650）；hint 有 clamp（flowStore.ts:241 clampHint）。
- 🔴 **静息态 DOM 纪律**（:34-38、:291-292、:420-423）：无 chip、层没开时渲染出的 DOM 与改造前逐字节等价（状态类 has-refs/is-picking 只在交互态追加、disabled 无值时给 undefined 不给 false）——像素基线与几何门都锚在静息态上。

### 1.6 悬浮胶囊（AskAveryLauncher.tsx）

- 收起态 pill「问 Avery」（SparkIcon+label，:104-111）↔ 展开态 AskRefComposer（:89-102，420px 胶囊壳、autoFocus、submitLabel='→'）——**条件渲染硬换 DOM**，展开动画是入场 keyframe（lite2.css:6852-6868）。
- 外点收起（:62-69 mousedown 判 contains）；Esc 分层（@ 层开着只关层，关着才收胶囊）。
- 提交=**中继不发**：`goScreen('room',{q,refs})`（:79-84），refs 空整参不挂。
- 挂载纪律（:14-29 硬约束记档）：必须是 `.lite2-shell` 直接子元素（Lite2App.tsx:196-199）；`contextId===null` 整块不出（:72）；**room 屏收起**（:77）；`/paperwork` 整族不挂载（Lite2App.tsx:176-201）。

---

## 2 · 几何/布局约束——改成 Claude 式布局会撞上什么

### 2.1 五层遗留 absolute 体系（掣肘核心）

1. **`.scene` 是硬裁+包含块制造机**：`00-base.css:152-172` `.scene{position:absolute;inset:0;overflow:hidden}`，`.scene.is-active` 带 `transform:translateY(0) scale(1)`——**计算值非 none，任何 fixed 后代的包含块都被劫持**。这就是胶囊必须挂壳层（AskAveryLauncher 头注释）、@ 弹层碰撞检测必须量「视口∩overflow 祖先」（AskRefComposer:150-188，#66 病根 2）的根源。改布局想在屏组件里放 fixed 元素=复犯 #66。
2. **story 冻结基座只许覆盖不许改**：`.nexus-followup-composer` 基类是「左下角 440px 小浮标」（`55-ask-composer.css:3-17` absolute left:16 bottom:20）；`.nexus-empty` 基类是居中 42% 卡（`40-nexus-empty.css:3-17`）；`.nexus-terminal` 基类是 viewport-fixed 深色终端（`60-terminal.css:6-21`）。lite2 的 room 布局全是**解除式覆盖**：board 段 static 化终端/HUD/卡（lite2.css:821-862）、run 态 composer 归位（:8187-8202）、空态 wrap static 化（:478-492）、历史抽屉里再抄一份解除（:8321-8330）。**同一个 composer 部件现存三套几何**：空态卡内 static 100%（:487-492）/ run 态居中 `min(828px,100vw-48)` 锚 footer 之上（:8197-8202）/ 胶囊 420px pill（:6804-6815）——「改成 Claude 式统一 docked composer」第一刀就是把这三套收敛成一套，且每套都有门/基线锚着（§6）。
3. **让位带体系**：屏级滚动口下边界统一抬 `--lite2-bottom-band`(120px)（:8144-8150），room 特例 `max(band, footer+76px)`（:8156-8158）+ 底部 44px mask 渐隐（:8166-8174）；胶囊/composer 锚 `--lite2-footer-h`（Lite2Footer ResizeObserver 发布，:8176-8202）。顶部让位 `--lite2-clear-top`（96px/≤860 72px，:6048-6071），`.lite-room-board` padding-top 吃它（:6067-6070）、底 padding 150 给 composer 让位（:816-818）。**这套「家具与内容不共享像素」的账（verify-bottom-furniture-clearance 门）改版后要整体重算**。
4. **@ 弹层 240px 钳高 + 碰撞检测（#66 刚修）**：CSS 默认上弹 `bottom:calc(100%+8px)`（:8607-8621）+ `is-down` 翻转（:8626-8629）+ 列表 `max-height:240px`（:8653-8659）；JS 侧常数 `PICKER_GAP/PICKER_CHROME/LIST_MAX_HEIGHT/LIST_MIN_HEIGHT`（AskRefComposer:74-77）**与 CSS 双份同步义务**（注释明说改一处必须同步另一处）。锚点=form 上/下沿整宽，不是光标位。只在开层与 resize 时量（:156-188），依赖「锚点不在滚动区里」这个前提——**若改版把 composer 放进滚动容器，这段测量逻辑要加 scroll 监听**。
5. **≤860 手机模式整个换世界**：`00-base.css:1110-1149` body 转 overflow:auto、`.app-shell` overflow:visible、`.scene` 转 `position:relative; min-height:1500px`、顶栏转 sticky。room 的 absolute 家具（run 态 composer、历史抽屉）在手机上锚的是 1500px 高的 scene 而不是视口（读码推断，**改版必按 css-containing-block-must-probe 纪律实测**，别信这段推断）。视口高度是盲轴（memory 条目）：空态卡 top:42% 在矮视口会与胶囊/页脚挤压。

### 2.2 滚动结构

- 会话流滚动在 `.lite-room-scroll`（absolute inset:0, overflow-y:auto, :801-806）**内部**，不在 body；滚底只在 turns.length 变化时（RoomScreen:577-581，流式过程刻意不跟滚）。
- 原始流终端内滚封顶 420px（:822-832）；历史抽屉面板自己内滚（:8251-8265）；三层嵌套滚动区并存（页 scroll + 终端 + 抽屉）。
- `scroll-padding-top:120px` 补在滚动口上（:6086-6093）。

---

## 3 · 对照 Claude.ai/ChatGPT 型 AI chat 标准形态——逐项差距

| 标准形态 | 现状 | 判定 | 证据 |
|---|---|---|---|
| 底部 docked 全宽 composer（贯穿空态与对话态） | run 态有（828px 居中锚底）；**空态没有**（居中卡内） | **半个** | lite2.css:8197-8202 vs 40-nexus-empty.css:3-17 |
| 多行输入（textarea + Shift+Enter 换行 + 自动长高） | 无——`<input type="text">` 单行 | **无** | AskRefComposer.tsx:391-394 |
| composer 内附件/上传按钮 | 无（上传只在资料库屏/onboarding） | **无** | RoomScreen 无任何 upload 引用 |
| 会话列表侧栏（多会话、可续聊） | 无——只有右上只读历史抽屉；turns 刻意零持久化 | **无**（拍板级） | RoomScreen:543 clearTurns；askHistory.ts:9-11 |
| 消息左右分边/气泡视觉 | 无——问题行与回答卡都是全宽块；问题行有 accent 底色算弱区分 | **半个** | lite2.css:877-895 |
| 停止生成按钮 | 无——store 有 `_abort`（store.ts:366）但零 UI；busy 只置灰 | **无**（接线一半） | AskRefComposer:108-112 记档了不做的理由 |
| 重新生成 / 编辑重发 | 无 | **无** | — |
| 消息 hover 操作（复制/引用/反馈） | 无 | **无** | — |
| 滚动锚定 + 「回到底部」按钮 | 半个——仅换轮滚底；流式不跟滚、无按钮 | **半个** | RoomScreen:575-581 |
| 建议追问（回答下方 chips） | **有**（#72，advice/短答两路，仅尾轮） | 有 | RoomScreen:372-389 |
| 空态建议开场 | 有（4 chips），但在 composer 下方、居中卡内 | 有（位置非标准） | RoomScreen:658-673 |
| 生成中可打断/可预打字排队 | 无——整 composer 置灰 | **无** | AskRefComposer:423 |
| 回答 markdown 渲染 | 无——短答是纯文本 `<p>`；判读卡是结构化 8 字段 | **无** | RoomScreen:343 |
| thinking/分析过程呈现 | **有且强于标准形态**：四相真事件面板+真引用+原始流 | 有（资产） | RoomScreen:115-218 |
| @ 引用实体（Notion/Linear 型） | **有**（四类候选+结构化进契约） | 有（资产） | AskRefComposer + askRefs |
| 历史续聊（点历史条目继续问） | 无——历史只读回放 | **无** | RoomScreen:409-475 |
| 键盘焦点管理（进屏自动聚焦 composer） | 空态/run 态 composer **不自动聚焦**（只有胶囊展开 autoFocus） | **无** | AskRefComposer:92,190-194 |

---

## 4 · 「反人类」点指认（第一次用的经理视角）

每条标注：【纯 UI】只动 CSS/DOM；【组件逻辑】动 TSX/store；【后端】动 eval-harness；🅓=牵动既有 Danny 拍板，重构 PRD 里要显式翻案。

1. 🔴 **第一问的「世界跳变」**：空态在屏中央小卡里打字，一按发送整屏重排——对话流从顶部长出、composer 瞬移到屏底换了宽度换了锚点。Claude 式「composer 从中央滑到底部」的连续感完全没有。【纯 UI+组件逻辑】（RoomScreen:586-675 三态硬切；两套 composer 几何 §2.1-2）
2. 🔴 **对话说没就没**：切任何 tab（包括点回答卡下自带的「Avery 记了一条笔记 →」nudge！）= unmount = `clearTurns` 对话销毁（RoomScreen:543, :346-350）。经理点 nudge 去看了笔记、回来对话没了，只剩右上角只读历史。产品自己的按钮引导用户去销毁自己的对话。【组件逻辑】🅓（#71 拍板「离开即散场」+ carry-over 显式不做）
3. 🔴 **胶囊按了「→」却没发出去**：胶囊里打完整问题按发送，落到议事室只是**预填**，得再按一次「提问」（AskAveryLauncher:79-84「只预填不自动发」）。一个问题两次发送，新手必懵。【组件逻辑】🅓（battle-map §2.3 / Lite2App:195 拍板）
4. **卡片入口「什么都没带过来」错觉**：8 路卡片入口全走灰提示通道（#69）——到议事室正文是空的、发送键是灰的，模板句只是 placeholder，一打字就没。经理感知：「我点了带着项目去问，结果还得从头打字」。chips 确实带了引用，但灰键+空正文的第一眼是「没带」。【组件逻辑】🅓（#69 拍板：提示不是替 manager 打的字）
5. **@ 弹层信息密度低**：筛选行恒占一行（PICKER_CHROME 64px 里 26px 是它，AskRefComposer:70-77）；「全部」视图 8 条封顶（MAX_REF_OPTIONS，askRefs.ts:33）+240px 钳高，一行里 label/部门/meta/类目词四个字段挤着（:352-359）；对比 Claude/Notion 的「输入即筛、无 chrome」轻弹层显得重。【纯 UI】（上限/轮转逻辑是 #70 拍板，位次别动）
6. **单行输入打多段问题**：input 单行（:391-394），分诊卡模板句「A — B — C」在输入框里挤成一行看不出分段（问题行回显才有 pre-wrap，lite2.css:892-894）；无 Shift+Enter。【组件逻辑】（换 textarea 会牵动静息态 DOM 纪律与像素基线，见 §6）
7. **生成中被锁死**：busy 置灰整个发送键、无停止按钮、无预打字排队——上一轮 1-3 分钟（live-frontend-gate.md:49 F2 实测）里经理只能干等。【组件逻辑】🅓（AskRefComposer:108-112 记档了「打断=假 complete」的诚实性顾虑，重构要连状态与文案一起做）
8. **空态 chips 点击即发、无审改机会**：卡片入口讲 authorship（预填不自动发），空态 chips 却一点就真发（RoomScreen:667 直接 askLive）——同一屏两套相反的 authorship 原则。【组件逻辑】🅓（feat-045「点击即发问」是拍板原文）
9. **历史发现性≈零**：「之前问过的 · N」是右上角 ghost 小按钮（lite2.css:8243-8249），与空态卡视觉不相连；抽屉只读不能续。经理的心智模型「聊天记录」在这个产品里叫「历史」且藏在角落。【纯 UI（入口）+组件逻辑（续聊）】
10. **空态 eyebrow 撒谎**：普通空态的 eyebrow 是「正在仔细梳理中 — 实时」（RoomScreen:643 用 t.nexus.liveThinking，zh.ts:288）——此刻什么都没在梳理。nomaterial 态修过同款问题（:628-630 注释），空态漏网。【纯 UI】（一行改字典引用）
11. **状态重复表达**：尾轮同时挂四相面板（有 running 光标）+ `.nexus-brief-hud` 状态条（:322-335）——两个部件说同一件事「正在想」。状态条是 story 遗物（「纯状态 pill，v02 无点击行为」lite2.css:844-851）。【纯 UI】
12. **短答无格式**：answer 纯文本一段（RoomScreen:343），后端若吐列表/分点全糊成一坨。【后端+纯 UI】（markdown 渲染 + 后端产出约定）
13. **快问卡身份混淆**：AskCard 出生在回答流里、与回答卡同宽同族样式（lite2.css:1566），新手分不清「这是 Avery 的回答还是要我去发问卷」。draft 态里还有输入框+按钮群（AskCard.tsx:130-224），在对话流里像个表单弹窗被平铺了。【纯 UI】
14. **深色终端「机房」残留**：展开原始流是 story 演示资产的深色终端（60-terminal.css）,与产品浅色语言断裂；但它同时是「真流不装样」的证据资产。【纯 UI】🅓（feat-059 拍板保留原始流入口）
15. **手机态存疑面**：≤860 的 absolute 家具锚点（§2.1-5）+ 空态卡 42% 垂直居中在矮视口与胶囊/页脚的挤压——born-red 按视口逐个验，别桌面绿就当手机绿（memory 条目）。【纯 UI，需实测】

---

## 5 · 样式架构现状

### 5.1 体量与分层

- **`src/lite2/styles/lite2.css` 8759 行单文件**，纪律=APPEND-ONLY + 「本块在文件尾，同权重后写者胜」（:6059-6061 明文）。历史按战役分段层积（文件头到尾按时间序），room 相关规则散在 **≥10 段**：:444-492（画板退役解除+空态 wrap）/ :794-917（board+会话流）/ :918-1143（简化四相面板）/ :1563-1631（快问卡+短答气泡）/ :2981-3033（空态 chips+追问 chips）/ :3302-3345（composer 令牌镜像）/ :6040-6116（让位统一+宽度体系）/ :6749-6868（胶囊）/ :8131-8202（让位带+run 态 composer 归位）/ :8240-8336（历史抽屉）/ :8583-8759（@ 引用段）。**改 room 布局要跨十段找规则，且晚段覆盖早段**。
- **shared/styles 冻结基座 6 份**（story 是「冻结路演资产」ADR-0022，一像素不许动）：`00-base.css`(1257) `20-report-card` `40-nexus-empty` `55-ask-composer` `60-terminal` `70-home-cards`。lite2 对它们的关系是**解除式覆盖**（§2.1-2）——这是 room 最大的一笔样式债：布局不是自有的，是「story 布局 − 一堆 undo」。

### 5.2 Design token 现状

- **有真令牌体系**：两皮各自在 `.lite2-shell[data-look=…]` 重申同一批变量（look-paper.css:9-73 / look-aurora.css:20-112）。族谱：基础 `--paper/--ink*/--rule*/--sage/--honey/--terracotta/--iris/--sky`（+小字专用 `*-text` 深调）；**`--lite2-*` 族**：surface/glass/glass-blur/bg-gradient/RGB 三元组（surface-rgb/ink-rgb/paper-rgb/accent-rgb/danger-rgb/warn-rgb/violet-rgb/sky-rgb + deep 变体）/ink-hover/heading-font/radius-lg/tone-* 徽章色表（aurora 独有）/clear-top/frame-w/bottom-band/footer-h（布局变量，lite2.css:6048-6051, 8144-8158）。密度：paper 16px / aurora 15px 显式字号 + tabular-nums。
- **切换机制**：`look.ts`（URL `?look=` > localStorage `lite2:look:v1` > 默认 aurora，:96-110）→ `lookStore` 反应式 → `Lite2App` 壳根 `data-look`（:113-115）。aurora 有少量组件级 `[data-look="aurora"]` 语法分支（look-aurora.css:114 起，逐条记档）。
- **债**：① spacing/字号/圆角大量字面量（room 布局数字 96/150/828/900/240/64/440/420 无一是变量）；② TSX/CSS 双份常数（AskRefComposer:74-77 ↔ lite2.css:8653）；③ 老代硬编码 rgba 只做了部分令牌化（feat-046 镜像层 lite2.css:3206 起）；④ 没有语义层 token（没有 --composer-height/--chat-max-width 之类），改版要么继续裸数字要么先立 token。

---

## 6 · 改版保护清单——哪些门必红、哪些判据是行为级可保留

门电池 A→B→C 共 30+ 道（`eval-harness/tools/run-battery.mjs` ROSTER :108-158；A 区上传型门绝不能排 C 区后）。与本改版直接相关：

### 6.1 行为级判据（改布局**应当保留**，是重构的安全网）

- **verify-at-references.mjs**（754 行，51 处 rec 站点、⑨ 段每入口循环实跑约 56 条）：主判据落**网络请求体**（POST /advise 的 references[]/situation 织文/absent≠[]）与**真键盘链路**（↑↓/Enter/Esc/移除键）；⑧ 弹层几何是行为级三件套（bbox 在视口内 + elementFromPoint 顶沿真画出 + 与输入框相邻，三宿主×视口矩阵含 900×340 钳制位）——只要弹层还锚着输入框就能过。⑨ 7 入口×（chip 在场+正文空+灰提示+置灰+提交不含提示文）。
- **verify-room-conversation.mjs**（369 行，42 条）：②不覆盖（DOM 序）③history 网络体 ④首问无 history 键 ⑤disabled 属性本身（belt-and-braces 教训：不能只判「点了没发」）⑥离开即散场+localStorage 零残留 ⑦-⑨ 追问 chips（在场/点击即发/只挂尾轮）⑩ store busy 闸同拍双击 ⑪⑫ 快问收敛 ⑬ 撤卡保护。
- **verify-room-usability.mjs**（18 条）：`.lite-flow-toggle` elementFromPoint 真点得到 + wheel 是滚动不是缩放 + **composer 在滚动区外**。
- **verify-room-nomaterial.mjs**（11 条）：世界 A（无 contextId：nomaterial 在/composer 不在/chips 不在/CTA 真落 home）×世界 B（有 contextId：composer 在/chips=4/nomaterial 不在）。
- **verify-answer-split-03.mjs**：事实问→气泡无卡、判断问→卡无气泡。
- **verify-bottom-furniture-clearance / verify-topbar-clearance**：hit-test 结果判据（有没有控件被家具劫持），改布局后**重跑即可**，数字带宽自己会说话。
- **verify-flow-gap-phases.mjs**（11 条）：home 侧分诊/差距卡（入口面），room 内不直接锚。

### 6.2 DOM/类名锚（改结构**必红**，重构时要么保类名要么改判据）

| 锚 | 谁在用 |
|---|---|
| `.lite-room .nexus-followup-composer input[type=text]` / `button[type=submit]` | room-conversation:85-86、at-references 多段 |
| `.lite-room > .nexus-followup-composer`（**子代选择器**） | lite2.css:8197（run 态归位）+ room-usability「滚动区外」结构判据——CSS 与门双承重 |
| `.lite-ref-chip`（数量断言） | at-references ①②③⑤c；**历史轮回显因此被迫另立 `.lite-room-turn-ref`**（RoomScreen:264-266） |
| `[data-ref-picker]` `[data-ref-chip]` `[data-chip-id]` `[data-followup-chip]` `[data-room-turn]` `[data-room-turns]` `[data-flow-toggle]` `[data-flow-failed]` `[data-phase-id/status]` `[data-room-nomaterial]` `[data-ask-refs]` | 各 room 门 + snippet 相位 H |
| `.lite-composer-filter/.lite-composer-option/.lite-composer-remove` | verify-button-family **白名单条目**（新按钮不挂 .lite-btn 又不进白名单=红） |
| `.lite-room-turn-question(-text)` `.lite-room-answer-card` `.lite-room-chip` `.lite-flow-*` | room-conversation DOM 判据族 |
| `.scene-tabs .scene-tab` 数量与序 | verify-v2boots + snippet assertV2Boots expected 数组 |
| combobox aria 四件套（role/aria-expanded/aria-controls/aria-activedescendant） | at-references ① |

### 6.3 像素基线的真实覆盖（比想象薄——改版阻力主要在行为门不在像素）

- **36 张空态**（`eval-harness/visual/visual.spec.mjs`，9 屏×2 皮×2 视口）：#68 订正——全是 **fresh context 空态**（stub 参数在 build+preview 下是死的）。所以 room 那 4 张采的是 **contextId===null 的 nomaterial 态**；胶囊也**不在任何一张里**（contextId null 时 launcher 整块不挂载，AskAveryLauncher:72）。**空态 composer+chips、会话流、@ 弹层、胶囊在 36 张里零像素覆盖**。
- **14 张数据态**（`visual-data.spec.mjs`，home/team/projects ×2 皮×2 视口 + 2 张手机差距块专拍；setFixedTime 钉死 2026-08-08）：**不含 room**；但**胶囊在这 14 张里在场**（有 contextId 的非 room 屏）——改胶囊观感这套必红。
- 基线 PNG 是 gitignore 单机产物，只在主检出人审后重冻（worktree 里重冻=白冻，memory 条目）。
- 结论：改 room 内部布局→像素层最多红 nomaterial 4 张 + 家具让位连带各屏（band 数字变了会像 T3 那样殃及全部屏级滚动口截图）；改胶囊/页脚/顶栏→14+36 大面积红，属预期漂移，走人审重冻流程。

### 6.4 电池口径备忘

- room 门全是**上传型**（真 POST /ingest 造 context），环境三件套 `AVERY_BRAIN=mock AVERY_EXTRACTOR=heuristic AVERY_EMBEDDINGS=keyword` + `vite build --mode development` + `preview --host`（缺一样=烧钱/假红，memory 条目）；显式 `?lang=zh`。
- `scripts/gates/live-frontend-gate.snippet.js`（3427 行）相位 H `assertRoomCanvas`（画布绝迹+composer 滚动区外恒可点）与 F1/F2（composer 静态/动态）也锚 room——它不在 `*verify-*.mjs` glob 里，是改判扫描暗区（memory 条目）。
- 改判纪律：每条主判据配专属变异、判据落被测属性本身（disabled 教训 room-conversation ⑤）；「恰好如预期的红」先翻日志。

## 7 · 重构第一刀建议切分（侦察员意见，仅供排票）

1. **纯 UI 快赢**（不动门锚）：空态 eyebrow 撒谎（#4-10）、状态条去重（#4-11）、历史入口显性化、@ 弹层排版密度。
2. **布局统一战役**（门要跟着改）：composer 三态合一（docked 全宽+textarea+停止按钮）——同时动 lite2.css 五层 absolute、at-references ⑧ 几何宿主、room-usability 结构判据、像素 nomaterial 4 张。
3. **拍板翻案清单**（先 grill Danny）：#71 离开即散场（对话持久化/续聊）、胶囊只预填不自动发、chips 点击即发 vs authorship、打断生成的诚实态。
4. **后端联动**：markdown 短答约定、历史续聊要 advise_runs 回放→turns 注水通道（今天不存在）、停止生成的 abort 语义（transport abort 今天被收成假 complete，AskRefComposer:108-112）。

