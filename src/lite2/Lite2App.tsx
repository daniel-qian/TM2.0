import { useEffect, useRef, type ComponentType } from 'react'
import {
  BrowserRouter,
  Navigate,
  Route,
  Routes,
  useLocation,
  useNavigate,
} from 'react-router-dom'
import { useFlow } from './flowStore'
import { useLite } from './store'
import { LiteTopbar } from './LiteTopbar'
import { TeamScreen } from './screens/TeamScreen'
import { RoomScreen } from './screens/RoomScreen'
import { FollowupsScreen } from './screens/FollowupsScreen'
import { NotesScreen } from './screens/NotesScreen'
import { CloserLookScreen } from './screens/CloserLookScreen'
import { PlaybooksScreen } from './screens/PlaybooksScreen'
import { VisionScreen } from './screens/VisionScreen'
import { ProjectsScreen } from './screens/ProjectsScreen'
import { HomeScreen } from './screens/HomeScreen'
import { FilesScreen } from './screens/FilesScreen'
import { PaperworkScreen } from './paperwork/PaperworkScreen'
import { DetailOverlay } from './DetailOverlay'
import { DraftComposer } from './DraftComposer'
import { AskAveryLauncher } from './AskAveryLauncher'
import { Lite2Footer } from './Lite2Footer'
import { OnboardGate } from './OnboardGate'
import { initNotifications } from './notifyStore'
import { useLook } from './lookStore'
import {
  bindNavigator,
  publishBaseScreen,
  DEFAULT_SCREEN,
  PAPERWORK_PATH,
  PROJECT_PATH,
  SCREEN_PATH,
  useCurrentScreen,
  type LiteScreen,
} from './routes'

// feat-035（lite-live-v02 kickoff §架构拍板 1）· lite2 壳 = v02 并排产品本体。
// copy-then-wall：整树从 src/lite/** 复制而来（引擎含在内），lite ↔ lite2 零交叉 import——
// 边界由 ESLint no-restricted-imports 机器闸看住（这个壳也从不 import src/story/**）。
// v1 冻结：src/lite/** 一行不改；这里独立生长六屏骨架 + 观感（Look）令牌层 + 合规页脚。
//
// 6-tab 骨架（PRD 顺序）：Your team · The room · Follow-ups · A closer look · Playbooks ·
// Where this goes。Follow-ups / A closer look 本波先空态占位（feat-036/037 真派生）。
// feat-047：第 7 tab「Avery's notes」移植自 src/lite，插在 Follow-ups 之后（tab 顺序为本棒
// 默认决定，理由见 progress.md）。
//
// feat-051（PRD G2）：屏的切换从 Zustand 的 `screen` 变量换成真路由（react-router）。
// Router 只包住 lite2 这一棵树——v01（src/lite）与 story 壳一个字节不动，`?v=`/`?mode=`
// 挑壳的合成根（src/App.tsx）也不动。路由表与粘性 query 的口径见 routes.ts。
export function Lite2App() {
  return (
    <BrowserRouter>
      <Lite2Shell />
    </BrowserRouter>
  )
}

function Lite2Shell() {
  const navigate = useNavigate()
  const screen = useCurrentScreen()
  // partner-docs-0728 · 文档页不是应用面——见下方弹层家族那段注释。
  const isPaperwork = useLocation().pathname === PAPERWORK_PATH
  // feat-068：观感（Look，原 skin——`Skin` 现专指 ADR-0021 的行业视觉主题，见 CONTEXT.md）。
  // open-loop-0720：issue #16 提到的「运行时热切换」在本棒落地——从 lookStore 订阅而不是
  // useMemo 挂载时算一次，LiteTopbar 的开关点下去后这里跟着重渲染，不必整页刷新。
  const look = useLook((s) => s.look)
  // rich-align-0722/03 · 人身自述投影开关的壳内镜像 → data-scoring-enabled 标记。AFK 门「读壳上
  // 开关标记」据此在两世界跑不同断言（关=人卡零数字；开=数字只许在 data-metric-source 锚内）。
  const scoringEnabled = useLite((s) => s.team?.scoringEnabled ?? false)

  // store 的 goScreen/openDetail/closeDetail 经这个桥推路由（Zustand action 里没有 hook）。
  // 两处都绑，缺一不可：
  //  ① 渲染期绑——子组件的 mount effect 比父组件的先跑，只放 effect 会留一个「已渲染但导航
  //     还没接上」的空窗。
  //  ② effect 里再绑一次——StrictMode（dev）会「装载→卸载→重装载」，重装载只重跑 effect、
  //     不重跑 render。只在渲染期绑的话，模拟卸载的 cleanup 把桥置空后就再也没人接回来，
  //     导航于是掉进 window.location.assign 兜底 = 整页重载、内存里的团队数据全丢。
  //     （这条是真机跑出来的：dev 下点人卡整页刷新、store 归零。）
  //  ③ 同一个口子还要把「当前底屏」发布给 store 侧：openDetail 要知道浮层盖在哪一屏上，
  //     closeDetail 要知道关掉之后把人送回哪一屏（详见 routes.ts 的来源屏一节）。
  bindNavigator(navigate)
  publishBaseScreen(screen)
  useEffect(() => {
    bindNavigator(navigate)
    publishBaseScreen(screen)
    return () => {
      bindNavigator(null)
      publishBaseScreen(null)
    }
  }, [navigate, screen])

  // feat-045：通知事件接线（真事件订阅，模块级 guard 幂等）。首访 onboarding 向导的开合
  // 判定（unseen/in-progress 且本会话未 ×）feat-052 起收在 OnboardWizard 自己手里——
  // 它现在常驻挂载（见下方 render），父层不再做条件挂载，否则出场动画没机会跑。
  useEffect(() => {
    initNotifications()
    // feat-050 · 会话不丢：刷新/关掉浏览器重开后，按 localStorage 里存的 contextId 把上次
    // 的团队/文件/笔记取回来。走 getState() 而不是订阅——这是一次性的挂载副作用，
    // 不该让整个壳跟着 restoring 重渲。幂等由 store 内的模块级闸看住（StrictMode 双跑安全）。
    void useLite.getState().restoreSession()
  }, [])

  return (
    <div
      className="app-shell lite2-shell"
      data-scene={screen}
      data-mode="live"
      data-look={look}
      data-scoring-enabled={scoringEnabled ? 'on' : 'off'}
    >
      <LiteTopbar />
      <main className="scene-stage">
        {/* 🔴 每条屏路由的 element 都是同一个 <ScreenView />，这不是偷懒——是修复的关键。
            react-router 不给 RenderedRoute 挂 key，所以「同一位置 + 同一组件类型」在路由
            切换时会被 React 复用；由 ScreenView 内部按当前屏挑真正的屏组件。于是：
              · 换屏（/room → /notes）→ 屏组件类型变了 → 照常卸载重挂，行为不变；
              · 开详情（/closer-look → /projects/:id）→ 底屏仍是「多看一眼」→ 组件类型没变
                → 原地保住，展开面板 / 已加入跟进的按钮态这些本地状态不再被冲掉。
            如果每条路由各写各的 element，进详情就等于换了棵树 —— 底屏被偷换、本地状态清零，
            正是复核逮到的那条 major。 */}
        <Routes>
          {/* 入口：`/?v=2&mode=live&look=paper&lang=zh` 落到 DEFAULT_SCREEN（feat-057 起
              是聚合入口 /home），query 原样带过去。replace —— 否则后退键在 `/` 与落点之间
              反复横跳（重定向再把人推回来）。 */}
          <Route path="/" element={<RedirectToDefault />} />

          <Route path={SCREEN_PATH.team} element={<ScreenView />} />
          {/* 深链：人卡。底屏照常渲染，浮层由路由派生（见下方 DetailOverlay）。 */}
          <Route path={`${SCREEN_PATH.team}/:personId`} element={<ScreenView />} />

          <Route path={SCREEN_PATH.room} element={<ScreenView />} />
          <Route path={SCREEN_PATH.followups} element={<ScreenView />} />
          <Route path={SCREEN_PATH.notes} element={<ScreenView />} />
          <Route path={SCREEN_PATH.closerlook} element={<ScreenView />} />
          <Route path={SCREEN_PATH.playbooks} element={<ScreenView />} />
          <Route path={SCREEN_PATH.vision} element={<ScreenView />} />
          {/* feat-055（PRD G9）：整屏项目看板。追加在既有屏路由末尾——本批 feat-057 的
              `/home` 同样追加在这之后，各加各的一行。 */}
          <Route path={SCREEN_PATH.projects} element={<ScreenView />} />
          {/* feat-057 · 聚合入口屏（追加在既有屏路由末尾，上面一条都没动）。 */}
          <Route path={SCREEN_PATH.home} element={<ScreenView />} />
          {/* files-hub-0729/01 · 资料库屏（追加，上面一条都没动）。
              ⚠ 它是**真屏**（进 LiteScreen / 有 tab / 参与 data-scene），所以 element 照
              规矩是 <ScreenView />，不像 /paperwork 那条独立页。 */}
          <Route path={SCREEN_PATH.files} element={<ScreenView />} />

          {/* 深链：项目详情。底下垫的是**来源屏**（routes.ts 的 baseScreenFrom）。
              feat-055 落地后这里**依然**是 <ScreenView />，而不是换成 ProjectsScreen：
              051 留的那句「换成自己的 element」在整屏看板长出来之后反而是个陷阱——各写各的
              element 会让「进详情 = 换了棵树」，底屏被偷换、本地状态清零（正是 051 复核逮到
              的那条 major）。真正要改的是**底屏口径**：screenFromPathname 现在把
              `/projects/*` 派生成 'projects'，于是冷深链的浮层垫的就是项目屏，站内点开的
              仍垫用户原来那一屏。路径形状与导航入口（openDetail('project', id)）一个字没动。 */}
          <Route path={`${PROJECT_PATH}/:projectId`} element={<ScreenView />} />

          {/* partner-docs-0728 ·「文件与表单」。唯一一条 element **不是** <ScreenView /> 的
              路由，因为它压根不是屏：不在 LiteScreen 里、没有 tab、不参与详情浮层的底屏
              语义（见 routes.ts 的 PAPERWORK_PATH）。上面那段「共用同一个 element」的纪律
              说的是屏与屏之间的复用，跟这条独立页无关——它没有"底下垫哪一屏"这回事。 */}
          <Route path={PAPERWORK_PATH} element={<PaperworkScreen />} />

          {/* 兜底：未知路径回默认屏，同样保住 query。 */}
          <Route path="*" element={<RedirectToDefault />} />
        </Routes>
      </main>
      {/* partner-docs-0728 · `/paperwork` 上整个弹层家族**不挂载**。
          这不是洁癖，是真机上逮到的 bug：闸门对「没有 contextId 的访客」一律弹出，而
          `/paperwork` 恰恰是新访客最可能第一次到达的地方——onboarding 上传步里那条
          「不知道该发什么？」是 target="_blank"，新标签页是全新会话、没有 contextId，
          于是闸门在新标签里又盖了一次：用户点了链接，看到的还是闸门。
          文档页不是应用面，这里既没有可开的详情、也没有可写的草稿、更不该有悬浮提问入口。
          条件挂载在这里是对的（feat-052 那条「弹层一律常驻挂载」说的是同一棵应用树内部的
          出场动画，跨路由整体缺席不在它的射程里）。 */}
      {isPaperwork ? null : (
        <>
          {/* feat-052：弹层一律常驻挂载，开关在各自组件里（LiteModal 的 open）——父层条件挂载
              会把组件直接摘掉，出场动画没机会跑。 */}
          <DetailOverlay />
          {/* input-side-0721：onboarding 从浮层向导改为全屏闸门页（OnboardGate，原 OnboardWizard）。
              挂载位不变——它仍是常驻弹层家族的一员（出场动画 + Escape/焦点圈由 LiteModal 底座管），
              "整页"是 layerClassName 的 CSS 观感，不是路由（深链/门脚本的 URL 语义零变化）。 */}
          <OnboardGate />
          {/* feat-058 · 应用内草稿框。挂在壳层而不是各屏内部：开框的入口在「你的团队」的分诊卡
              和「跟进」的队列条目上，跨两棵子树；且弹层必须盖在整壳之上（同 DetailOverlay）。 */}
          <DraftComposer />
          {/* 棒F · 悬浮「问 Avery」入口。挂在 .scene-stage 的兄弟层（.lite2-shell 直接子元素），
              绝不进屏组件内部：.scene.is-active 的 transform 会给 fixed 后代建包含块、.scene
              overflow:hidden 会裁掉它。position:fixed + z45（见组件头与 lite2.css 棒F 段）。 */}
          <AskAveryLauncher />
        </>
      )}
      <Lite2Footer />
    </div>
  )
}

// 🔴 重定向必须原样转发 search + hash：`?v=2&mode=live&look=paper&lang=zh` 是进 v02 的入口，
// 丢一个 `v=2` 整个壳就掉回 v01。
// feat-057：落点改读 routes.ts 的 DEFAULT_SCREEN（现在是聚合入口 /home），不再写死 team——
// 默认落哪一屏是导航口径，属于 routes.ts，这里只跟着走，免得两处各说一套。
function RedirectToDefault() {
  const { search, hash } = useLocation()
  return <Navigate to={{ pathname: SCREEN_PATH[DEFAULT_SCREEN], search, hash }} replace />
}

// 屏 id → 屏组件。ScreenView 按当前底屏在这里挑一个渲染。
const SCREEN_COMPONENT: Record<LiteScreen, ComponentType> = {
  team: TeamScreen,
  room: RoomScreen,
  followups: FollowupsScreen,
  notes: NotesScreen,
  closerlook: CloserLookScreen,
  playbooks: PlaybooksScreen,
  vision: VisionScreen,
  // feat-055：项目屏。追加在既有条目末尾（本批 feat-057 的 'home' 同样追加在这之后）。
  projects: ProjectsScreen,
  home: HomeScreen, // feat-057 · 聚合入口（追加，不动上面任何一条）
  files: FilesScreen, // files-hub-0729/01 · 资料库（追加，不动上面任何一条）
}

// 所有屏路由共用的渲染位。屏组件由**底屏**决定（详情深链上 = 打开浮层时用户所在的那一屏），
// 所以浮层是盖上去的，不是换一屏。
function ScreenView() {
  const screen = useCurrentScreen()
  useRoomQueryRelay(screen)
  const Screen = SCREEN_COMPONENT[screen]
  return <Screen />
}

// 接力参数 `/room?q=<问题>`（PRD G2）——从决策卡带着问题进议事室。
// 这里只做「搬运」：把 q 灌进 feat-036 已有的预填通道（flowStore.composerDraft），
// RoomScreen 早就把它当 composer 的 initialValue 消费。不自动发问、不伪造回答。
//
// 为什么在 render 期搬而不是 useEffect：RoomScreen 由 ScreenView 在同一次 render 里渲染，
// 它的 initialValue 在**首次 render** 就要读到值；effect 比子组件的 render 晚一拍，会整整
// 错过。
//
// 闸门用 location.key（每条 history 条目一个、后退回同一条时不变）而不是「组件挂载一次」：
// ScreenView 现在跨屏常驻，用 useRef(false) 那种一次性闸会导致第二次进议事室再也不预填。
// 语义 = 「每次落到 /room 这条 history 条目预填一次」，与改造前逐次挂载的行为等价。
function useRoomQueryRelay(screen: LiteScreen) {
  const { key, search } = useLocation()
  const relayedKey = useRef<string | null>(null)
  if (screen === 'room' && relayedKey.current !== key) {
    relayedKey.current = key
    const q = new URLSearchParams(search).get('q')?.trim()
    if (q) useFlow.getState().setComposerDraft(q)
  }
}
