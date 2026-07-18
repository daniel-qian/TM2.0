import { useLocation, useMatch } from 'react-router-dom'

// feat-051（PRD G2 路由化）· lite2 壳的路由表 + 「粘性 query」搬运 + store→router 导航桥。
//
// 本文件是 lite2 导航的唯一真相源：屏 ↔ 路径的映射、深链形状、以及哪些 query 参数跨导航
// 必须活下来。改导航行为只改这里，别在组件里手搓路径字符串。
//
// ## 为什么 store 里不再有 `screen`
// v02 之前「当前是哪一屏」是 Zustand 的一个变量，URL 里看不见 —— 发不了链接、后退键直接
// 掉出应用、刷新回到第一屏。feat-051 把它换成真路由：`useLocation()` 是唯一真相，
// store 只保留 `goScreen()` 这个动作名（签名不变，7 个调用点一行没改）委托给下面的导航桥。
//
// ## 🔴 粘性 query：进 v02 的入口不许被吃掉
// `?v=2&mode=live&skin=paper&lang=zh` 是所有人（含另外几条并行线与演示现场）进 v02 的入口，
// 由 shared/version.ts · shared/mode.ts · lite2/skin.ts · i18n 各自读 `window.location.search`
// 解析 —— 它们与路径无关，但**只要有一次导航把 search 丢了，整个壳就掉回 v01**。
// react-router 的 navigate('/team') 默认不带 search，所以每次导航都必须过 carrySearch()。
//
// 口径是「默认全带走 + 极小 EPHEMERAL 黑名单」，不是白名单：白名单会把别的线新加的参数
// 悄悄吃掉（feat-061 的 `?showInactive=1`、AFK 门的 `?transport=stub` 都不在本条范围内，
// 但都必须原样活着）。新参数默认继承，是这条设计的目的。
export type LiteScreen =
  | 'team'
  | 'room'
  | 'followups'
  | 'notes'
  | 'closerlook'
  | 'playbooks'
  | 'vision'

export type LiteDetail = { kind: 'person' | 'project'; id: string } | null

// 7 屏路径。注意 `closerlook`（store/门用的 scene id，data-scene 属性值）与 `/closer-look`
// （URL 形状，PRD G2 原文）不同名 —— 别把两者当同一个字符串用。
export const SCREEN_PATH: Record<LiteScreen, string> = {
  team: '/team',
  room: '/room',
  followups: '/followups',
  notes: '/notes',
  closerlook: '/closer-look',
  playbooks: '/playbooks',
  vision: '/vision',
}

// 深链：人卡挂在「你的团队」下（`/team/:personId`）；项目详情是独立顶层段
// （`/projects/:projectId`）—— feat-055 建整屏项目看板时直接换掉这条路由的 element，
// 路径形状与这里的导航入口都不用动。
export const PROJECT_PATH = '/projects'

export const DEFAULT_SCREEN: LiteScreen = 'team'

const PATH_TO_SCREEN = new Map<string, LiteScreen>(
  (Object.entries(SCREEN_PATH) as [LiteScreen, string][]).map(([screen, path]) => [path, screen]),
)

// 路径 → 屏。深链也要归到它的底屏：`/team/:personId` 和 `/projects/:projectId` 都算
// 「你的团队」——详情是浮层，底下那一屏还在（顶栏高亮与 data-scene 都按底屏算）。
export function screenFromPathname(pathname: string): LiteScreen {
  const first = pathname.split('/').filter(Boolean)[0]
  if (!first) return DEFAULT_SCREEN
  const segment = `/${first}`
  if (segment === PROJECT_PATH) return 'team'
  return PATH_TO_SCREEN.get(segment) ?? DEFAULT_SCREEN
}

// 一次性「接力棒」参数：导航离开时丢掉，不跟着人跑遍全屏。
// `q` = `/room?q=<问题>`（从决策卡带着问题进议事室，feat-057 的上游接口）——它描述的是
// 「这次进屋要问什么」，不是会话状态，带到 /notes 再带回来会诈尸重放。
// 其余一切参数（v/mode/skin/lang/showInactive/transport/未来新增的）一律跟着走。
const EPHEMERAL_PARAMS = ['q'] as const

/**
 * 取当前 URL 的 search，去掉一次性参数，叠加 extra，返回可直接拼在路径后的 `?...`（或空串）。
 * 读 `window.location.search` 而不是 useLocation()，是为了让非组件上下文（store 的
 * goScreen / openDetail）也能用同一套口径——BrowserRouter 下两者始终同步。
 */
export function carrySearch(extra?: Record<string, string | null>): string {
  const current =
    typeof window !== 'undefined' && window.location ? window.location.search : ''
  let params: URLSearchParams
  try {
    params = new URLSearchParams(current)
  } catch {
    params = new URLSearchParams()
  }
  for (const key of EPHEMERAL_PARAMS) params.delete(key)
  for (const [key, value] of Object.entries(extra ?? {})) {
    if (value === null || value === '') params.delete(key)
    else params.set(key, value)
  }
  const serialized = params.toString()
  return serialized ? `?${serialized}` : ''
}

// ── store → router 导航桥 ────────────────────────────────────────────────────
// Zustand 的 action 里用不了 hook，但 `goScreen()` 的签名要保持稳定（7 个调用点分散在正在
// 被其他线并行编辑的屏组件里，改签名 = 制造合并冲突）。所以壳在渲染期把 react-router 的
// navigate 注册进来，store 的 action 透过它走。
type NavigateFn = (to: string, options?: { replace?: boolean }) => void

let boundNavigate: NavigateFn | null = null

/** 由 Lite2App 在 Router 内注册；传 null 解绑（卸载时）。幂等，可在渲染期直接调。 */
export function bindNavigator(fn: NavigateFn | null) {
  boundNavigate = fn
}

function go(path: string, options?: { replace?: boolean; params?: Record<string, string | null> }) {
  const to = `${path}${carrySearch(options?.params)}`
  if (boundNavigate) {
    boundNavigate(to, { replace: options?.replace })
    return
  }
  // 兜底：桥还没绑上就被调用（正常不会发生——壳在渲染期就绑好了）。整页跳转比静默失败诚实，
  // 且 URL 仍然正确（search 已经带上）。
  if (typeof window !== 'undefined' && window.location) window.location.assign(to)
}

/** 切屏。`params` 可叠加 query（feat-057：`goScreen('room', { q: '<问题>' })`）。 */
export function navigateToScreen(
  screen: LiteScreen,
  params?: Record<string, string | null>,
) {
  go(SCREEN_PATH[screen], { params })
}

/** 开详情 = 进深链（push，所以后退键关得掉浮层）。 */
export function navigateToDetail(kind: 'person' | 'project', id: string) {
  const path =
    kind === 'person'
      ? `${SCREEN_PATH.team}/${encodeURIComponent(id)}`
      : `${PROJECT_PATH}/${encodeURIComponent(id)}`
  go(path)
}

/**
 * 关详情 = 回底屏，用 replace。
 * 用 replace 而不是 push：否则历史会留下 [.., /team/:id, /team]，按后退键又把刚关掉的浮层
 * 翻出来（点了「关闭」再后退却重新打开，是明确的坏体验）。replace 之后后退键落到进详情
 * 之前的那一屏，仍在应用内。
 */
export function navigateCloseDetail() {
  const pathname =
    typeof window !== 'undefined' && window.location ? window.location.pathname : '/'
  go(SCREEN_PATH[screenFromPathname(pathname)], { replace: true })
}

// ── 组件侧读路由 ─────────────────────────────────────────────────────────────

/** 当前屏（顶栏高亮 / 壳的 data-scene）。 */
export function useCurrentScreen(): LiteScreen {
  const { pathname } = useLocation()
  return screenFromPathname(pathname)
}

/**
 * 当前详情浮层（由路由派生，不再是 store 里的一份状态）——所以人卡/项目详情天然可深链、
 * 可后退关闭、刷新还在。
 * 注：react-router 已对 path param 做过 decodeURIComponent，这里不能再解一次（含 `%` 的
 * id 会被解坏）。
 */
export function useRouteDetail(): LiteDetail {
  const personMatch = useMatch(`${SCREEN_PATH.team}/:personId`)
  const projectMatch = useMatch(`${PROJECT_PATH}/:projectId`)
  const personId = personMatch?.params.personId
  if (personId) return { kind: 'person', id: personId }
  const projectId = projectMatch?.params.projectId
  if (projectId) return { kind: 'project', id: projectId }
  return null
}
