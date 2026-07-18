# feat-051 · 路由化（react-router + 深链）

分支 `feat/051-router` · 工作树 `D:\avery-wt\051` · 前端 · 地基条（055/057 依赖）

---

## 做了什么

把 lite2 壳的「当前是哪一屏」从 Zustand 的 `screen` 变量换成 **react-router 真路由**。
URL 现在是导航的唯一真相源：能发链接、后退键正常、刷新回到原处。

### 1. 新增 `src/lite2/routes.ts`（导航唯一真相源）

- `LiteScreen` / `LiteDetail` 类型（从 store.ts 挪过来，store.ts 原样再导出 → 既有 import 点零改动）
- `SCREEN_PATH`：7 屏 ↔ 路径映射。
  注意 `closerlook`（scene id / `data-scene` 值）与 `/closer-look`（URL 形状）**不同名**，别当同一个字符串用。
- `screenFromPathname()`：路径 → 屏。深链归到底屏（`/team/:personId`、`/projects/:projectId` 都算「你的团队」）。
- `carrySearch()`：🔴 **粘性 query 搬运**（见下）。
- `bindNavigator()` / `navigateToScreen()` / `navigateToDetail()` / `navigateCloseDetail()`：store→router 导航桥。
- `useCurrentScreen()` / `useRouteDetail()`：组件侧读路由。

### 2. 路由表（`Lite2App.tsx`）

| 路径 | 渲染 |
|---|---|
| `/` | → `/team`（**replace**，原样转发 search + hash） |
| `/team` | TeamScreen |
| `/team/:personId` | TeamScreen + 人卡浮层（路由派生） |
| `/room` | RoomScreen（含 `?q=` 接力搬运） |
| `/followups` `/notes` `/closer-look` `/playbooks` `/vision` | 对应屏 |
| `/projects/:projectId` | TeamScreen + 项目详情浮层（见下「偏离说明」） |
| `*` | → `/team`（replace，保 query） |

`BrowserRouter` **只包住 lite2 这一棵树**（不在 main.tsx / App.tsx）——v01（`src/lite/**`）与 story 壳一个字节不动，`?v=`/`?mode=` 挑壳的合成根不动。实测 `/?mode=live`（无 `v=2`）仍渲染 `.lite-shell` 且 URL 不被重定向。

### 3. 🔴 粘性 query（本条最容易炸的地方）

`?v=2&mode=live&skin=paper&lang=zh` 由 `shared/version.ts` · `shared/mode.ts` · `lite2/skin.ts` · i18n 各自读 `window.location.search` 解析——与路径无关，但 **react-router 的 `navigate('/team')` 默认不带 search，丢一次 `v=2` 整个壳就掉回 v01**。

口径 = **默认全带走 + 极小黑名单**，不是白名单：

- 黑名单只有 `q`（一次性接力棒，见下）。
- 其余一律跟着走：`v` / `mode` / `skin` / `lang` / `showInactive`（feat-061）/ `transport=stub`（AFK 门注入口）/ 以及**别的线以后新加的任何参数**。
- 白名单会把别的线新加的参数悄悄吃掉——这是特意不用白名单的原因。

### 4. 接力参数 `/room?q=<问题>`

搬进 feat-036 **已有的**预填通道（`flowStore.composerDraft`，RoomScreen 早就把它当 composer 的 `initialValue` 消费）。只搬运，**不自动发问、不伪造回答**。

在 render 期搬而不是 `useEffect`：RoomScreen 是子组件，`initialValue` 在首次 render 就要读到值，父组件的 effect 比子组件的 render 晚整整一拍。`useRef` 闸保证一次挂载只搬一次。

`q` 不从 URL 里摘掉——保留 = 复制链接仍带着问题（深链语义），且 dev 的 StrictMode 重挂载与 prod 行为一致；离开该屏时由 `carrySearch` 丢弃，不会诈尸重放。

### 5. store 改动（`store.ts`）

- 删掉 `screen` / `detail` **状态字段**（留着就是第二份真相，和后退键/刷新/深链三样各自打架）。
- `goScreen` / `openDetail` / `closeDetail` **动作名与调用签名不变**，内部改成推路由。
  → **7 个调用点（LiteBell / LiteComposer / LiteTopbar / TeamScreen / RoomScreen / NotesScreen / CloserLookScreen）一行没改**，特意为了压低与另外几条并行线的合并冲突面。
- `goScreen` 新增**可选**第二参数：`goScreen('room', { q: '<问题>' })` —— feat-057 决策卡带问题进议事室的接口。省略即只切屏。
- 关详情用 `replace`：否则历史留下 `[.., /team/:id, /team]`，点了「关闭」再按后退又把浮层翻出来。

---

## 改了哪些文件

- `src/lite2/routes.ts`（**新增**）
- `src/lite2/Lite2App.tsx`（BrowserRouter + 路由表；`data-scene` 改为路由派生）
- `src/lite2/store.ts`（删 `screen`/`detail` 状态；三个动作改推路由；类型再导出）
- `src/lite2/LiteTopbar.tsx`（高亮 tab 改为 `useCurrentScreen()`，1 行）
- `src/lite2/DetailOverlay.tsx`（`detail` 改为 `useRouteDetail()`，1 行；props 签名不变）

---

## 验收怎么过的

### 硬门

```
npm run typecheck   → tsc -b，零输出零错
npm run build       → ✓ built in 2.88s
                      （chunk >500kB 警告是既有的，不是 error）
npm run lint        → 0 errors, 5 warnings（5 条全是既有的 noInlineConfig 提示，
                      OnboardWizard/RoomScreen/useRailCamera，非本条引入）
```

### 真机目测（dev server 端口 5051，跑完已停，端口已确认释放）

浏览器 pane 的 screenshot/a11y 树在本机不响应（viewport 0x0 / 30s 超时），**改用在页面里执行 JS 驱动真实 DOM 的 `.click()` 并读 `location` 与 DOM 断言**。React 的合成事件走事件委托，程序化 `.click()` 会真实触发 onClick → 路由，所以处理器与路由链路是真验的；**未验的是像素级命中测试（CSS `pointer-events`）**——但顶栏 DOM 与 CSS 本条一个字没动，无回归面。

1. **红线 URL 照旧**：`/?v=2&mode=live&skin=paper&lang=zh`
   → `/team?v=2&mode=live&skin=paper&lang=zh`，`.lite2-shell` 在，`data-scene=team`，`data-skin=paper`，7 个中文 tab 齐。
2. **切屏不丢参数**：议事室 → 多看一眼 → 操作手册，每一跳 4 个参数原样在，
   `data-scene` 依次 `room` / `closerlook` / `playbooks`（`/closer-look` 路径 → `closerlook` scene，门口径没变）。
3. **后退键**：从 `/playbooks` 连按 3 次 → `/closer-look` → `/room` → `/team`，
   `.lite2-shell` 全程在（**没掉出应用**），参数全程在。
   第 3 次落到 `/team` 而**不是** `/` —— 证明入口重定向用的是 `replace`，没有后退乒乓陷阱。
4. **深链 + 浮层**（stub 语料 16 人 2 项目）：
   - `openDetail('person','p_linqing')` → `/team/p_linqing`，浮层开，标题 `Lin Qing`
   - 后退 → 回 `/team`，浮层关
   - `openDetail('project','pr_pilot')` → `/projects/pr_pilot`，浮层开，标题 `Pilot Launch — Hangzhou Store`
   - 点关闭 → 回 `/team`；**再后退不重新打开**（replace 生效）
   - 全程 `team.people` 恒为 16 —— 没有整页重载
5. **`?q=` 接力**：`/room?...&showInactive=1&q=三亚项目谁在卡着？`（URL 编码的中文）
   → composer 预填 `三亚项目谁在卡着？`；切到「跟进」再回「议事室」→ `q` 已丢、预填为空、
   `showInactive=1` 与 4 个入口参数全程健在。
6. **未知路径**：`/no-such-screen/deep?v=2&...` → `/team?v=2&...`（参数保住）。
7. **v01 / story 零回归**：`/?mode=live&lang=zh` → `.lite-shell`（v01），URL 不被重定向；
   `/?mode=story` → story 壳，两者都无 `.lite2-shell`。
8. **控制台**：lite2 路由页面 0 条 error。

### 目测中抓到并修掉的一个真 bug

第一版把导航桥只在 **render 期**绑（`bindNavigator(navigate)`），cleanup 里解绑。
dev 的 StrictMode 会「装载→卸载→重装载」，而**重装载只重跑 effect、不重跑 render** ——
模拟卸载的 cleanup 把桥置空后再没人接回来，导航于是掉进 `window.location.assign` 兜底 =
**整页重载、内存里的团队数据全丢**（真机表现：点人卡整页刷新、store 归零）。
修法：render 期绑 **+** effect 里再绑一次（cleanup 仍解绑）。两处都要，缺一不可——
render 期那次是为了填「子组件 mount effect 比父组件先跑」的空窗。
这个 bug 读代码看不出来，是起 dev server 才抓到的。

---

## 没做什么

- **没建项目屏**（feat-055 的活）。见下「偏离说明」。
- **没碰 `?highlight=id`**：合伙人版那个是死链（两个页面都不读该参数），按 kickoff 明令不抄。
- **没实现 `?showInactive=1` 的行为**（feat-061 的活）——本条只保证参数不被吃掉，已实测。
- **没动那 7 个 `goScreen`/`openDetail` 调用点**（特意的，压合并冲突面）。
- **没碰** `package.json` / `feature_list.json` / 根 `progress.md` / 根 `session-handoff.md` / `src/lite/**` / `src/story/**` / 合伙人库。没跑 `npm install`。

---

## 偏离 kickoff 的一处（请集成方过目）

kickoff 原文：`/projects/:projectId`「屏还没有，feat-055 才建，**你只需把路由位置留好，落到一个诚实的占位**」。

**实际落法：不是占位，是今天已有的真实项目详情浮层。**

理由：`openDetail('project', id)` 今天已经能开一个**真 payload** 的项目详情浮层（TeamScreen 与 CloserLookScreen 两处在用）。把它降级成「Coming」占位屏是**功能回归**——原文那句假设的是「那里今天什么都没有」，实际那里有能用的东西。

所以我按原文的**意图**（把路径位置留好、feat-055 能直接接管）落地：路径形状 `/projects/:projectId` 已占住，导航入口 `openDetail('project', id)` 已指过去。**feat-055 只需把这一行路由的 `element` 换成真项目屏**，路径与调用点都不用动。没有引入任何假数据/假占位。

---

## 遗留问题 / 给下游的提示

1. **深链在新标签页的「直达」分两层**（诚实口径）：
   - **屏级深链**（`/room` `/notes` `/closer-look` …）：完全直达，已实测。
   - **详情深链**（`/team/:personId`、`/projects/:projectId`）：**路由直达**（落对屏、tab 高亮对、参数保住、路径不被吃掉，已实测），但**浮层内容要等数据**——新标签页里 `team` 还没加载（`teamLoaded:false`），`DetailOverlay` 按既有逻辑返回 null，用户看到的是底下的团队屏。
     这是 **feat-050（contextId 恢复）** 的依赖，不是本条的 bug，也没有伪造成功态。**feat-050 落地后这条自动打通**，无需改本条代码。
   - 附带：`team` 已加载但 id 查不到时，`DetailOverlay` 走既有的 `detailGone` 平静空态（不显 "Unknown"）；`team` 为 null 时整体返回 null。要不要给后者也补一个「加载中」态，建议交 feat-052（modal 基座）统一处理，本条没动。

2. **AFK 门有一行会变成空转**（不是红，但请知悉）：
   `scripts/gates/live-frontend-gate.snippet.js:2801` 存 `store.getState().screen`、`:2848` 用
   `setState({ ..., screen: prevScreen })` 还原。`screen` 已不在 store 里 → 存到的是 `undefined`，
   还原变成往 store 塞一个没人读的 `screen: undefined` 键，**无副作用**（该相位的真实断言走 DOM 的
   `.lite-ask-card` 与 `_clickTab`，都不依赖这个字段）。
   **我没改这个文件**（共享文件、多线合并面）。要清理的话是把那两行删掉即可，建议集成方统一处理。
   `data-scene` 的两处门断言（`:1294`、`:2257` 断 `closerlook`）**照旧成立**，已实测。

3. **`applyModeToUrl()` 绕过 router**（既有代码，`shared/modeStore.ts`）：用 `history.replaceState`
   直接改 URL，router 的 `useLocation().search` 会短暂不同步。影响面极小——它只改 search 不改
   path，且 mode 开关默认不渲染（要 `?modeSwitch=1`），切到 story 会整个卸载 lite2 壳（router 一起走）。
   本条没动它。真要用 mode 开关做演示时留意一下。

4. **`?q=` 只在 RoomRoute「挂载时」搬一次**：已经停在 `/room` 时再把 `?q=` 塞进 URL 不会重新预填。
   feat-057 的决策卡是从别的屏跳进来（RoomRoute 会重新挂载），所以正常路径不受影响；
   若 057 需要「原地」改预填，直接调 `useFlow.getState().setComposerDraft(text)` 即可。

5. **需要的包**：无。`react-router-dom@7.18.1` 已预装，没装任何新包，没改 `package.json`。

6. **部署**：`vercel.json` 已有 SPA fallback（`/(.*)` → `/index.html`），路径路由在线上直接可用；
   `vite` 的 `base` 未设（默认 `/`，产物是绝对路径 `/assets/...`），所以 `/team/:id` 这种
   **两段深链也不会 404 掉资源**。两处都是既有配置，本条没改。

---
---

# 复核后的修复轮（第二棒）

复核判定 `needs-fix`，1 条 major + 3 条 minor。下面逐条交代改了什么、怎么验的、哪条没改及为什么。

## major（已修）：从非 team 屏开详情，底屏被偷换成团队屏

**复核描述**：停在「多看一眼」→ 点 gap 卡的项目链接 → `/projects/pr_demo` 的 element 固定是
`<TeamScreen />`，于是浮层还没看完底屏已经静默换成团队屏、顶栏高亮跳到「你的团队」；点「关闭」
被 replace 到 `/team`，「多看一眼」的展开面板 / `historyOpen` / `addedIds` 等本地状态全丢。

**复核判得对，是我漏了。** 我上一棒的 risks 只写了「不落占位、落真实浮层」的收益，没算代价：
详情是**盖在当前屏上的浮层**，不是一次换屏，而我把底屏交给了纯路径派生（`/projects/*` → `'team'`），
等于把「浮层」实现成了「换屏 + 浮层」。

### 怎么修的（两处，配套）

**① 底屏改由「来源屏」决定，不再纯按路径派生**（`src/lite2/routes.ts`）

开详情时把「我是从哪一屏点开的」写进 **history state**：

- 新增 `DetailNavState = { baseScreen: LiteScreen }`；`navigateToDetail()` push 时带上它。
- 新增 `baseScreenFrom(pathname, state)`：优先取 state 里的来源屏，取不到才退回
  `screenFromPathname()`。`useCurrentScreen()` 改走它 → `data-scene` 与顶栏高亮不再跳。
- 新增 `publishBaseScreen()`（与既有 `bindNavigator()` 同一个口子、同一个理由：Zustand action 里
  没有 hook）。壳每次渲染把当前底屏发布上来，`navigateToDetail` 用它当来源、
  `navigateCloseDetail` 用它当回程目的地。
- `navigateCloseDetail()` 从「按路径派生的底屏」改成「来源屏」，仍用 `replace`
  （「点关闭再后退又把浮层翻出来」那条坏体验依然被挡住）。

**URL 形状一个字没变** —— `/projects/:projectId` 照旧可深链（PRD G2 原文）。变的只是底下垫哪一屏。
history state 随 history 条目走：后退/前进/**刷新**都还在；冷深链（新标签页直接开）没有 state，
就退回默认屏——这是唯一诚实的兜底，实测确实退到 team。

**② 所有屏路由共用同一个 `<ScreenView />`**（`src/lite2/Lite2App.tsx`）

只改 ① 的话，底屏 id 对了，但 React 那棵树还是会被换掉（`/closer-look` 的 element 与
`/projects/:id` 的 element 是两个不同组件），本地状态照样清零。

react-router 不给 `RenderedRoute` 挂 key（核过 `react-router@7.18.1` 的 `_renderMatches`：
`React.createElement(RenderedRoute, { match, routeContext, children })`，无 key），所以
「同一位置 + 同一组件类型」在路由切换时会被 React 复用。于是把每条屏路由的 element 都写成
`<ScreenView />`，由它内部按 `useCurrentScreen()` 挑真正的屏组件：

- 换屏（`/room` → `/notes`）→ 屏组件类型变了 → 照常卸载重挂，行为不变；
- 开详情（`/closer-look` → `/projects/:id`）→ 底屏仍是 closerlook → 组件类型没变 → **原地保住**。

顺带把 `RoomRoute` 并进 `ScreenView`（`useRoomQueryRelay`）。**闸门从「组件挂载一次」换成
`location.key`** —— `ScreenView` 现在跨屏常驻，原来的 `useRef(false)` 会导致第二次进议事室
再也不预填（这是本次重构自带的坑，已经踩掉并回归验过，见下）。语义 = 「每落到 /room 这条
history 条目预填一次」，与改造前逐次挂载等价。

### 验收（真机，dev 5051，跑完已停）

驱动方式与复核一致：真实 DOM `.click()` 切 tab + `window.__lite2Store.getState()` 调 store action
（按钮走的是同一条链路）。

| 步骤 | 结果 |
|---|---|
| 入口 `/?v=2&mode=live&skin=paper&lang=zh` | → `/team`，7 个中文 tab，`data-scene=team` |
| 点「议事室」→ 点「多看一眼」 | `/room` → `/closer-look`，`scene=room`/`closerlook`，参数原样 |
| **`openDetail('project','pr_demo')`** | `p=/projects/pr_demo`、**`scene=closerlook`**、**高亮仍是「多看一眼」**、`history.state.usr={baseScreen:'closerlook'}` |
| **`closeDetail()`** | **`p=/closer-look`**、`scene=closerlook`、高亮「多看一眼」、`overlay=false` |
| 组件是否被换掉 | 开详情前后抓 `.lite-closerlook` 的 DOM 节点比 identity：`sameNodeOpen=true`、`sameNodeClose=true` —— **同一个节点对象，全程没卸载过**，本地状态不再被冲掉 |
| 关掉后连按后退 ×3 | `/closer-look` → `/room` → `/team`，全程 `.lite2-shell=true`（没掉出应用），4 个入口参数全程在，**没有把刚关掉的浮层翻出来** |
| 详情页 F5 刷新 | `p=/projects/pr_demo`、**`scene=closerlook`**、高亮「多看一眼」、`history.state.usr` 还在 —— 来源屏挺过刷新 |
| 冷深链新标签 `/projects/pr_demo?...&showInactive=1` | `scene=team`（无 state，按设计兜底）、`showInactive=1` 保住；`closeDetail()` → `/team` |
| 从 team 开人卡（回归） | `/team/p_linqing`，`scene=team`，关闭 → `/team` —— 与改造前一致，无回归 |
| 未知路径 `/no-such-screen/deep?v=2&...` | → `/team`，4 个参数全在 |
| v01 / story 零回归 | `?mode=live&lang=zh` → `.lite-shell=true`、`.lite2-shell=false`、URL 不被重定向；`?mode=story` → 两个 lite 壳都不在 |
| console | 0 error、0 React warning（含 render 期写 store 的那条 warning 也没有） |

## minor 1（已修）：AFK 门里 `screen` 还原已成空转

**复核判得对，我上一棒的理由也给错了** ——我写「该相位断言走 DOM，不依赖该字段，故无副作用」，
这是在评估**本相位**；而那行还原（`:2843-2847` 的注释写得很清楚）是为了**邻居相位**存在的。
结论侥幸没红只是因为 `assertTriageActions` 自己在 `:1431` 先 `_clickTab('Your team')` 自救了。

改法（`scripts/gates/live-frontend-gate.snippet.js`）：不是删掉，是**按路由化后的口径还原**——
存的时候从壳的 `data-scene` 读当前屏（属性值就是 `goScreen()` 吃的那套 id，不依赖 i18n 标签），
还原的时候调 `store.getState().goScreen(prevScene)` 真导航回去，而不是往 store 写一个没人读的字段。
注释里点明了「screen 现在是路由，还原 = 导航，不是写 store」，免得下一个人再被误导。

- 这是**共享文件**，改动只在这一个相位内的 2 处（4 行），合并面很小，但请集成方知悉。
- 验证：`node --check scripts/gates/live-frontend-gate.snippet.js` → 语法 OK。
  **AFK 门本身我没跑**（需要真后端 + 完整 live 语料，不在本条工作树的自跑范围）——这条按「读代码 +
  语法检查」为准，没跑过的门我不说跑过了。

## minor 2（已修，顺带）：`?q=` 后退回 `/room?q=` 会重新预填

复核只要求「措辞收紧」，但本次重构本来就要动这条闸门（`ScreenView` 跨屏常驻，旧的
`useRef(false)` 一次性闸会坏掉），所以直接换成 `location.key` 闸。

- **上一棒的措辞我在此更正**：原文「离屏时由 carrySearch 丢弃，不会诈尸重放」——
  **对 tab 切换成立，对后退键不成立**。复核实测「后退回 `/room?q=` 会重新预填草稿框」属实。
- 现在的口径（照实说）：**每落到 `/room` 这条 history 条目预填一次**。
  后退回同一条 history 条目时 `location.key` 不变，**只要中途没去过别的屏就不会重复预填**；
  但「去别屏再后退回来」仍会再预填一次（ref 只记最后一个 key）。
  这与改造前的行为**等价**，不是新回归，也不吹成已经根治。
- 实测：`goScreen('room',{q:'三亚项目谁在卡着？'})` → 输入框预填该中文；`goScreen('notes')` →
  `goScreen('room',{q:'第二个问题'})` → 输入框预填「第二个问题」（**第二次仍然生效**，重构自带的坑
  已排除）；`goScreen('room')` 无 q → 输入框为空。

## minor 3（未修，只更正说法）：详情深链在新标签页只到路由层

复核确认这是 feat-050（contextId 恢复）的下游依赖，且我没伪造加载态。本轮**没动**
`DetailOverlay.tsx:32`，理由不变：在 feat-050 落地前，给 `team === null` 补「加载中」会是**假态**
（根本没有在加载）。上面「遗留问题」第 1 条的口径继续有效。
**对外演示前请勿把详情深链当成已可用能力宣传。**

## 本轮改了哪些文件

| 文件 | 改了什么 |
|---|---|
| `src/lite2/routes.ts` | 来源屏（history state）：`DetailNavState` / `baseScreenFrom()` / `publishBaseScreen()`；`navigateToDetail` 带 state；`navigateCloseDetail` 回来源屏；`useCurrentScreen` 走 `baseScreenFrom` |
| `src/lite2/Lite2App.tsx` | 所有屏路由共用 `<ScreenView />`（保住底屏组件实例）；`SCREEN_COMPONENT` 映射；`RoomRoute` → `useRoomQueryRelay`（`location.key` 闸）；壳里补 `publishBaseScreen` |
| `scripts/gates/live-frontend-gate.snippet.js` | `askStatusCoerce` 相位的屏还原改成读 `data-scene` + `goScreen()` 真导航 |

`package.json` / `package-lock.json` / `feature_list.json` / 根 `progress.md` / 根 `session-handoff.md`
一律未动；`src/story/**`、`src/lite/**`、`.issues/lite-v1-lean-real-0713/**` 零触碰；没装任何包。

## 本轮跑过的门

```
$ npm run typecheck      # tsc -b
（零输出，exit 0）

$ npm run build
✓ built in 2.72s
dist/assets/index-kc5QQIdx.js  714.87 kB │ gzip: 231.79 kB
（唯一警告：既有的 chunk >500 kB，非 error、非本轮引入）

$ npm run lint
✖ 5 problems (0 errors, 5 warnings)
（5 条全是既有 noInlineConfig 提示：lite2/OnboardWizard.tsx:48、lite2/screens/RoomScreen.tsx:130、
 story/lib/useRailCamera.ts:120/133/148。routes.ts / Lite2App.tsx 零告警。）

$ node --check scripts/gates/live-frontend-gate.snippet.js
（零输出 = 语法 OK）
```

**没跑的**：后端 pytest（本轮零后端改动，`eval-harness/**` 未触碰）；AFK live 门整跑
（需真后端 + 完整语料，超出本工作树自跑范围，见 minor 1）；前端单测（本项目无前端单测框架）。
