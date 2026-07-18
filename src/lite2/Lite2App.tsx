import { useEffect, useMemo, useRef } from 'react'
import {
  BrowserRouter,
  Navigate,
  Route,
  Routes,
  useLocation,
  useNavigate,
  useSearchParams,
} from 'react-router-dom'
import { useFlow } from './flowStore'
import { LiteTopbar } from './LiteTopbar'
import { TeamScreen } from './screens/TeamScreen'
import { RoomScreen } from './screens/RoomScreen'
import { FollowupsScreen } from './screens/FollowupsScreen'
import { NotesScreen } from './screens/NotesScreen'
import { CloserLookScreen } from './screens/CloserLookScreen'
import { PlaybooksScreen } from './screens/PlaybooksScreen'
import { VisionScreen } from './screens/VisionScreen'
import { DetailOverlay } from './DetailOverlay'
import { Lite2Footer } from './Lite2Footer'
import { OnboardWizard } from './OnboardWizard'
import { initNotifications } from './notifyStore'
import { selectWizardOpen, useOnboard } from './onboardStore'
import { resolveSkin } from './skin'
import {
  bindNavigator,
  PROJECT_PATH,
  SCREEN_PATH,
  useCurrentScreen,
  useRouteDetail,
} from './routes'

// feat-035（lite-live-v02 kickoff §架构拍板 1）· lite2 壳 = v02 并排产品本体。
// copy-then-wall：整树从 src/lite/** 复制而来（引擎含在内），lite ↔ lite2 零交叉 import——
// 边界由 ESLint no-restricted-imports 机器闸看住（这个壳也从不 import src/story/**）。
// v1 冻结：src/lite/** 一行不改；这里独立生长六屏骨架 + 皮肤令牌层 + 合规页脚。
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
  const detail = useRouteDetail()
  // 皮肤只在挂载时读一次 URL（与 useDict 的 locale 解析同口径）——现场切皮走整页刷新
  // （试玩场景足够；运行时热切换留待需要时再做）。
  const skin = useMemo(() => resolveSkin(), [])

  // store 的 goScreen/openDetail/closeDetail 经这个桥推路由（Zustand action 里没有 hook）。
  // 两处都绑，缺一不可：
  //  ① 渲染期绑——子组件的 mount effect 比父组件的先跑，只放 effect 会留一个「已渲染但导航
  //     还没接上」的空窗。
  //  ② effect 里再绑一次——StrictMode（dev）会「装载→卸载→重装载」，重装载只重跑 effect、
  //     不重跑 render。只在渲染期绑的话，模拟卸载的 cleanup 把桥置空后就再也没人接回来，
  //     导航于是掉进 window.location.assign 兜底 = 整页重载、内存里的团队数据全丢。
  //     （这条是真机跑出来的：dev 下点人卡整页刷新、store 归零。）
  bindNavigator(navigate)
  useEffect(() => {
    bindNavigator(navigate)
    return () => bindNavigator(null)
  }, [navigate])

  // feat-045：通知事件接线（真事件订阅，模块级 guard 幂等）+ 首访 onboarding 向导
  // （覆盖层；unseen/in-progress 且本会话未 × 时挂载——localStorage 记状态与进度）。
  useEffect(() => {
    initNotifications()
  }, [])
  const wizardOpen = useOnboard(selectWizardOpen)

  return (
    <div className="app-shell lite2-shell" data-scene={screen} data-mode="live" data-skin={skin}>
      <LiteTopbar />
      <main className="scene-stage">
        <Routes>
          {/* 入口：`/?v=2&mode=live&skin=paper&lang=zh` 落到 /team，query 原样带过去。
              replace —— 否则后退键在 `/` 与 `/team` 之间反复横跳（重定向再把人推回来）。 */}
          <Route path="/" element={<RedirectToDefault />} />

          <Route path={SCREEN_PATH.team} element={<TeamScreen />} />
          {/* 深链：人卡。底屏照常渲染，浮层由路由派生（见下方 DetailOverlay）。 */}
          <Route path={`${SCREEN_PATH.team}/:personId`} element={<TeamScreen />} />

          <Route path={SCREEN_PATH.room} element={<RoomRoute />} />
          <Route path={SCREEN_PATH.followups} element={<FollowupsScreen />} />
          <Route path={SCREEN_PATH.notes} element={<NotesScreen />} />
          <Route path={SCREEN_PATH.closerlook} element={<CloserLookScreen />} />
          <Route path={SCREEN_PATH.playbooks} element={<PlaybooksScreen />} />
          <Route path={SCREEN_PATH.vision} element={<VisionScreen />} />

          {/* 深链：项目详情。整屏项目看板是 feat-055 的活——这里先把路径占住，落到今天
              已有的真实项目浮层（真 payload，不是占位假屏；把已经能用的详情降级成
              「Coming」反而是回归）。feat-055 换掉这一行的 element 即可，导航入口
              （openDetail('project', id)）与路径形状都不用动。 */}
          <Route path={`${PROJECT_PATH}/:projectId`} element={<TeamScreen />} />

          {/* 兜底：未知路径回默认屏，同样保住 query。 */}
          <Route path="*" element={<RedirectToDefault />} />
        </Routes>
      </main>
      {detail ? <DetailOverlay /> : null}
      {wizardOpen ? <OnboardWizard /> : null}
      <Lite2Footer />
    </div>
  )
}

// 🔴 重定向必须原样转发 search + hash：`?v=2&mode=live&skin=paper&lang=zh` 是进 v02 的入口，
// 丢一个 `v=2` 整个壳就掉回 v01。
function RedirectToDefault() {
  const { search, hash } = useLocation()
  return <Navigate to={{ pathname: SCREEN_PATH.team, search, hash }} replace />
}

// 接力参数 `/room?q=<问题>`（PRD G2）——从决策卡带着问题进议事室。
// 这里只做「搬运」：把 q 灌进 feat-036 已有的预填通道（flowStore.composerDraft），
// RoomScreen 早就把它当 composer 的 initialValue 消费。不自动发问、不伪造回答。
//
// 为什么在 render 期搬而不是 useEffect：RoomScreen 是子组件，它的 initialValue 在**首次
// render** 就要读到值；父组件的 effect 比子组件的 render 晚，用 effect 会整整错过一拍。
// ref 闸保证一次挂载只搬一次（同一挂载内 q 再变不重复触发，避免在别的组件渲染期改 store）。
function RoomRoute() {
  const [search] = useSearchParams()
  const relayed = useRef(false)
  if (!relayed.current) {
    relayed.current = true
    const q = search.get('q')?.trim()
    if (q) useFlow.getState().setComposerDraft(q)
  }
  return <RoomScreen />
}
