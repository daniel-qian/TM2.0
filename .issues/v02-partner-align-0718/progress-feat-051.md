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
