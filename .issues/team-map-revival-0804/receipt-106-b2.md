# 回执 · #106 B2 focus 机器（team map 复活）—— 2026-08-17

分支 `claude/team-map-b1-skeleton-de3253`（接着 B1 的 `a365275` 往下做）。
**只做 B2**：B3 的 HUD-lite / `verify-team-map.mjs` 进 ROSTER / `assertRoomCanvas` 改判 /
像素基线，还有 B4 收拢态，一律没动。

## 交付了什么

| 票面 B2 条目 | 落点 |
|---|---|
| 点人→亮「他+他 owned 的项目」；点项目→亮「它+owner」；点空白回 calm | `src/lite2/map/mapFocus.ts`（纯派生）· `MapScreen.tsx`（接线）· `MapPanZoom.tsx`（点空白/拖动判定） |
| SvgEdge 连线只在 focus 出现 | `src/lite2/map/MapEdges.tsx`（world 层 z-index 2，B1 就是给它留的） |
| 被点节点原位长大成 mini 卡（人：名字/职位/定性自述读；项目：摘要/截止/阻碍数） | `src/lite2/map/MapNodes.tsx` |
| 「打开档案」→ `/team/:personId` 浮层、「看项目」→ `/projects/:projectId` | `routes.ts` 的 `personDetailHref` / `projectDetailHref` + `detailReturnState()` |
| 组级读数：部门标签下定性短语，从 selfReport 真派生；组内无自述→不显示 | `src/lite2/map/zoneRead.ts` + `MapNodes.MapZoneCard` |
| `?focus=person:<id>\|project:<id>` 深链（路径作用域，不进 EPHEMERAL_PARAMS） | `routes.ts` 的 `MAP_FOCUS_PARAM` / `PATH_SCOPED_PARAMS` / `mapHref(token)` |

顺带守「单一尺子」提上来的两样（判断逻辑一字未改，同 B1 提 `projectStatusTone` 的动作）：

- `moodWordOf` —— 情绪归一键→字典词。原来是 `TeamScreen` 里两个私有函数（人卡一个、筛选
  chip 一个），地图的组级读数是第三个消费方；再抄一份就是同一个归一词在三块屏上叫三个名字。
  提进新文件 `src/lite2/selfReportView.ts`。
- `blockersOf` —— 「文档列出来的卡点是哪几条」（trim + 去空行）。原来内联在
  `buildProjectViews` 里；地图 mini 卡手上是 `LiteProject.blockers`（原始数组），不提上来就得
  再写一遍。提进 `projectView.ts` 并导出。

## 三条设计口径（都写在代码注释里，这里只记结论）

1. **focus 的唯一真相源是 URL，不是 useState。** 票面要它可分享；同一件事两个真相源必漂
   （feat-051 把「当前是哪一屏」从 Zustand 换成真路由是同一条道理）。切 focus 用
   `navigate(..., {replace:true})` 而不是 push——push 的话「点空白回 calm」之后按后退键会把
   刚关掉的高亮翻出来，正是 `navigateCloseDetail` 当年用 replace 修掉的那条坏体验。
   代价写明：后退键从地图直接离开本页，不逐层退出 focus。
2. **组级读数是转述，不是判断。** 句子是「有人自述：吃紧」——零计数（跨人计数在本仓读作
   分数并列，ADR-0023 明禁）、不点人数、恒挂 `data-metric-source` 出处锚点。挑哪一条的顺序是
   `strained > stretched > other > steady`：一句话只能说一件事，先说要你留意的（同项目屏
   `GROUP_ORDER` 把「需要你出手」排最前）。`other` 排在 `steady` 前，是因为我们没能把那个词
   归一，就没资格断定它是好消息。
3. **地图永不显示自述负载那个百分数。** 它是全仓唯一被特许的人身数字，特许的前提是它待在
   人卡的出处锚点里；搬上图就等于给每个人挂了一根血条（story 那版 `.hud-meter` 整族被拒之
   门外的同一个理由）。判据专门扫它：demo-seed 16 人**全部**报了负载，地图上一处都没有。

## 验收

### ① demo-seed 具名剧本（票面写死的那条）

`check-demo-script-b2.mjs` —— **真后端 + 真语料**，28 条全绿。为什么必须跑真后端：剧本里
`u_小徐` 这个 id 是后端 `_link_owners` 从《项目总览.md》的「负责人：小徐」那行解出来的，
手捏 payload 等于把整条链路最容易断的一环换成我自己写的正确答案，而连线正架在那一环上。

逐条：**点小徐 → 草坪婚宴旺季档跟着亮、1 条连线、URL 写上 `?focus=person:u_小徐`** ·
mini 卡上是他文档里的职位（宴会销售经理）+ 定性自述读 + 「打开档案」·
反向点草坪婚宴旺季档 → 小徐亮 · **点小马 → 2 条线**（亲子暑期产品线 + 微信商城改版；
语料里真有人背着不止一件事，「每人恒 1 条边」的错实现会被这条逮住）·
中文语料上的组级读数（「有人自述：如常/偏紧/吃紧」）· 打开档案再关掉 → 回到地图、小徐还亮着。

截图 `shots/`：`b2-demo-xu.png` · `b2-demo-multi.png` · `b2-demo-zone-reads.png`（人眼过）。

### ② 80 人合成租户 + 双世界

- `check-focus-b2.mjs`（纯函数，无浏览器）**46 条全绿**：token 往返与 9 种坏形状 ·
  点人/点项目/查无此人 · **三种 owner 缺法零边**（全无 / 只有名字没 id / id 指向查无此人）·
  边的锚点必须就是节点自己的坐标 · 逐人点一遍的边总数 = 解得开 owner 的项目数（全局对账，
  期望值从 payload 独立算）· 组级读数五条分支 + 开关关世界。
- `check-render-b2.mjs`（浏览器）**64 条全绿**：calm 零连线 · 点选三态 · mini 卡内容 ·
  **拖动 ≠ 点空白** · 点空白/Esc 回 calm · 深链（正常 / 坏 token / 查无此人）·
  **离开 /map 时 focus 脱落（`<Link>` 与顶栏 tab 两条通道各验一次，且粘性 query 不许被误伤）** ·
  打开档案再关掉回到地图 · 人节点零百分数零血条 · 组级读数开关两世界。
- fixture 补了 B2 的哨兵（`fixtures/make-team-80.mjs`，确定性无随机）：7 条自述覆盖
  「并存取 strained」「只有 steady」「词表外原词」「**有情绪没出处 → 整条丢掉**」「整组没人报」；
  u_0 带 `load: 91%`（专供「不许上图」那条判据）；`p_8` 改挂 u_0 让他背两件事。

### ③ born-red（每条主判据配专属变异，手工 Edit 后即刻还原）

| 变异 | 红的是哪几条 |
|---|---|
| M1 拿掉「拖动之后那一下 click 掐掉」 | 只红「从人身上起手拖板 focus 没被抢走」 |
| M2 拿掉 `navigateCloseDetail` 的 returnTo 分支 | 只红「关掉档案回的是地图」+「回来时小徐还亮着」 |
| M3 owner 缺失时猜第一个人连上去 | 红三种 owner 缺法的 6 条 |
| M4 拿掉 zoneRead 的「必须有出处」 | 红「有情绪没出处→丢掉」+「恰好 4 个」+「每条都带得出出处」 |
| M5 点人只亮第一件 | 红「亮的项目=全部」+「边数=owned 数」 |

跑完 `grep -rn "BORN-RED" src/` 确认零残留。

### ④ 既有门与电池

- `./init.sh` **exit=0**；lint `6 problems (0 errors, 6 warnings)` = 存量基线，**零新增**；
  `tsc -b` 干净。
- `node scripts/i18n-orphans.mjs`：1100 个叶子键、**孤儿 0**（新增 6 个键全部有引用）。
- B1 的两个 check 回归重跑：`check-layout-80.mjs` 25/25、`check-render-b1.mjs` OK。
- TeamScreen 回归探针（`moodWordOf` 提上去之后）：16 张人卡 · 筛选 chip 仍是
  「全部/如常/偏紧/吃紧」· 自述行仍逐个挂着出处锚点 · `data-scoring-enabled=on`。
- 既有门电池 / 像素基线 / `assertRoomCanvas`：**一个字没动**（票面明写属 B3）。

⚠ 三个 `check-*.mjs` 都**故意不叫 `verify-*`**：`git ls-files "*verify-*.mjs"` 是本仓判定
「有哪些门」的自查命令，往那个 glob 里塞不在 ROSTER 的文件＝再造孤儿门。进 ROSTER 的
`verify-team-map.mjs` 是 B3 的活，这些判据届时并进去。

## 实测出来的四条坑（写下来免得 B3/B4 再踩）

### 🔴 拖一下板会把 focus 抢走（真 bug，判据先红后修）

从**一个人节点上**按下去拖板：rzpp 把 content 跟着指针一起平移，于是同一个节点一直待在
指针底下，抬手时 down/up 目标相同、浏览器照常派发一次 `click`，节点的 onClick 就把他选中了。
用户只想挪一下板看清连线，结果 focus 跳到了另一个人身上。

修法不是给每个节点各加一个「刚才是不是在拖」的判断（那是三份尺子），是在画布上加一个
**捕获期**的 click 抑制：pointerup 判定位移是否超过 6px，超过就在 `onClickCapture` 里
`stopPropagation()`——一个判据、一个地方，一次拦住节点 / HUD / 背景三种点击。

⚠ 从**空白处**起拖是个更弱的用例，压根验不到这个 bug。判据里那条
「拖动起手点确实压在一个人节点上」就是防它退化成空真的。

### 🔴 「离开 /map 自然消失」有两条出站通道，第一版只堵了一条

`?focus=` 刻意不进 `EPHEMERAL_PARAMS`（票面明写），所以没有任何全局机制会替它清理。
第一版只给地图自己的 href 助手打了补丁——**顶栏 tab 走的是 store 的 `go()`**，从地图点一下
「团队」，`?focus=` 就跟着人跑遍全站再也甩不掉。

现在两条通道共用一张 `PATH_SCOPED_PARAMS` 表（`go()` 与 `hrefFor()` 都吃它），并配了两条
判据分别走两条通道，各带一条「粘性 query 没被误伤」的对照。

### 🔴 三个 world 分层互相完全重叠，B1 时无害、B2 一开点就是硬 bug

`.lite-map-{zone,people,project}-layer` 都是 `position:absolute; inset:0` 的整块板。
项目层在 DOM 里排在人员层之后、z-index 又相同 ⇒ **它整块盖在人员层上面**，点人会被这张
透明的板吃掉（透明 ≠ 不吃指针）。B1 时节点不可点，谁盖着谁无所谓。
修法：分层一律 `pointer-events:none`，只有节点自己 `auto`。
判据用 `elementFromPoint` **实测**命中的是不是节点本身——这类归属问题读代码读不出来。

### 🔴 「点空白」的落点扫出来，别写死

第一版写死在画布底部正中，那儿坐着全局「问 Avery」悬浮胶囊（fixed 在底部居中）——
点过去开的是提问框，而当时的探针只查了「是不是地图节点」，一句「确实是空白」照样绿；
再往下那条 Esc 判据也跟着假红（提问框开着时 Esc 归弹层管，那是**对**的行为）。
现在落点是扫出来的，判据要求「命中的元素在画布里面」。

## 没做 / 留给下一棒

- **B3 头号输入**：大板上 focus 之后，被点亮的项目可能在画面外。80 人板宽 3476px，
  首帧镜头在可读地板 `MIN_FIT_SCALE=0.6` 下只框得住约 2400px——点一个人，两条线径直跑出
  右边框。demo-seed（板宽 1852，fit 出 0.731）不存在这个问题，所以它不影响本票验收。
  **刻意没在 B2 加镜头跟随**：票面 B2 四条里没有它，而「点击聚焦对应簇」这个动词第一次出现
  是在 B3 的 HUD 那条——跟随有多凶、会不会跟用户自己的 pan 打架、要不要动画，是那一票的
  设计题，在这里提前定死等于替它拍板。
- B3：搜索 / 部门 chips / 警报药丸 · `verify-team-map.mjs` 进 ROSTER（本票三个 check 的判据
  并进去）· `assertRoomCanvas` 改判 · 像素基线。
- B4（#107）：部门收拢态。`MapZone` 契约仍然够用（key + rect + members），B2 只往上加了一句
  可选的组级读数。
- 一件顺手发现、**没有顺手修**的事（B1 就记过，这次量到了它的具体代价）：全局「问 Avery」
  悬浮胶囊 fixed 在底部居中，在地图上盖住画布底部一条——那一条里的空白**点不着**
  （点下去开的是提问框）。别的屏上它盖的是卡片，同一个问题。不属 B2 射程。
