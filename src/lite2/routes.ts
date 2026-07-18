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
// `?v=2&mode=live&look=paper&lang=zh` 是所有人（含另外几条并行线与演示现场）进 v02 的入口，
// 由 shared/version.ts · shared/mode.ts · lite2/look.ts · i18n 各自读 `window.location.search`
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
  // feat-055（PRD G9）：整屏项目看板。追加在末尾——本批另一条线（feat-057）同样往这个
  // 联合类型末尾追加它的 'home'，各加各的一行就不会撞。
  | 'projects'

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
  // feat-055：项目屏。与下面的 PROJECT_PATH 同值——项目详情 `/projects/:projectId` 就是
  // 这一屏的子段（不是另一棵树）。这里写字面量而不是引 PROJECT_PATH，只因常量声明在下面；
  // 两者不许分叉，改一个必须改另一个。
  projects: '/projects',
}

// 深链：人卡挂在「你的团队」下（`/team/:personId`）；项目详情是独立顶层段
// （`/projects/:projectId`）。
// feat-055 已落地：`/projects` 本身成了整屏项目看板（见上面 SCREEN_PATH.projects），
// 详情段一个字没改——路径形状、导航入口（openDetail('project', id)）全部照旧，变的只是
// 「浮层底下垫哪一屏」：冷深链现在垫项目屏，不再垫团队屏（见 screenFromPathname）。
export const PROJECT_PATH = '/projects'

export const DEFAULT_SCREEN: LiteScreen = 'team'

const PATH_TO_SCREEN = new Map<string, LiteScreen>(
  (Object.entries(SCREEN_PATH) as [LiteScreen, string][]).map(([screen, path]) => [path, screen]),
)

// 路径 → 屏。**只在没有来源屏可用时兜底**（冷深链：别人把 URL 发给你、或在详情页刷新前
// 从没走过站内导航）——所以真正的底屏口径是下面的 `baseScreenFrom()`，别直接用这个函数。
//
// feat-055：`/projects/:projectId` 的冷深链底屏从 'team' 改成 'projects'。改造前项目屏
// 还不存在，只能垫团队屏；现在有了整屏看板，把项目详情的链接发给别人、他点「关闭」应该
// 落在项目屏而不是团队屏（PRD G9 验收原文）。从站内点开的路径不受影响——那条走 history
// state 里的来源屏，压根不进这个函数。
export function screenFromPathname(pathname: string): LiteScreen {
  const first = pathname.split('/').filter(Boolean)[0]
  if (!first) return DEFAULT_SCREEN
  const segment = `/${first}`
  if (segment === PROJECT_PATH) return 'projects'
  return PATH_TO_SCREEN.get(segment) ?? DEFAULT_SCREEN
}

// ── 详情浮层的「来源屏」 ─────────────────────────────────────────────────────
// 修复（feat-051 复核 major）：详情是**盖在当前屏上的浮层**，不是一次换屏。
// 改造前 `/projects/:projectId` 的底屏一律按路径派生成 'team'，于是从「多看一眼」点项目
// 链接会当场把底屏偷换成团队屏（顶栏高亮跟着跳），点「关闭」再把人扔在 /team——用户丢了
// 原来那一屏和它的本地状态（展开面板、已加入跟进的按钮态…）。
//
// 现在开详情时把「我是从哪一屏点开的」写进 history state。它随 history 条目走：
// 后退/前进/刷新都还在（浏览器把 state 一起持久化），只有冷深链才没有——那时才退回按路径
// 派生。所以 URL 形状一个字没变（PRD G2 的 `/projects/:projectId` 照旧可深链），
// 变的只是「底下垫哪一屏」。
export type DetailNavState = { baseScreen: LiteScreen }

function isLiteScreen(value: unknown): value is LiteScreen {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(SCREEN_PATH, value)
}

/** 当前该渲染哪一屏做底：优先 history state 里的来源屏，没有才按路径派生。 */
export function baseScreenFrom(pathname: string, state: unknown): LiteScreen {
  const fromState = (state as Partial<DetailNavState> | null | undefined)?.baseScreen
  if (isLiteScreen(fromState)) return fromState
  return screenFromPathname(pathname)
}

// 一次性「接力棒」参数：导航离开时丢掉，不跟着人跑遍全屏。
// `q` = `/room?q=<问题>`（从决策卡带着问题进议事室，feat-057 的上游接口）——它描述的是
// 「这次进屋要问什么」，不是会话状态，带到 /notes 再带回来会诈尸重放。
// 其余一切参数（v/mode/look/lang/showInactive/transport/未来新增的）一律跟着走。
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
type NavigateFn = (to: string, options?: { replace?: boolean; state?: unknown }) => void

let boundNavigate: NavigateFn | null = null

/** 由 Lite2App 在 Router 内注册；传 null 解绑（卸载时）。幂等，可在渲染期直接调。 */
export function bindNavigator(fn: NavigateFn | null) {
  boundNavigate = fn
}

// 壳每次渲染把「当前底屏」发布上来（和 bindNavigator 同一个口子、同一个理由：Zustand 的
// action 里没有 hook，但 openDetail/closeDetail 必须知道用户此刻站在哪一屏）。
// 发布的是 useCurrentScreen() 的结果——已经把 history state 里的来源屏算进去了。
let publishedScreen: LiteScreen | null = null

export function publishBaseScreen(screen: LiteScreen | null) {
  publishedScreen = screen
}

function currentPathname(): string {
  return typeof window !== 'undefined' && window.location ? window.location.pathname : '/'
}

/** 用户此刻实际看到的那一屏（详情浮层底下的那一层）。 */
function currentBaseScreen(): LiteScreen {
  if (publishedScreen) return publishedScreen
  return screenFromPathname(currentPathname())
}

function go(
  path: string,
  options?: { replace?: boolean; params?: Record<string, string | null>; state?: unknown },
) {
  const to = `${path}${carrySearch(options?.params)}`
  if (boundNavigate) {
    boundNavigate(to, { replace: options?.replace, state: options?.state })
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

/**
 * 开详情 = 进深链（push，所以后退键关得掉浮层）。
 * 同时把来源屏写进 history state——浮层要盖在**用户原来那一屏**上，而不是把底屏换掉。
 */
export function navigateToDetail(kind: 'person' | 'project', id: string) {
  const path =
    kind === 'person'
      ? `${SCREEN_PATH.team}/${encodeURIComponent(id)}`
      : `${PROJECT_PATH}/${encodeURIComponent(id)}`
  const state: DetailNavState = { baseScreen: currentBaseScreen() }
  go(path, { state })
}

/**
 * 关详情 = 回**来源屏**，用 replace。
 * 用 replace 而不是 push：否则历史会留下 [.., /closer-look, /projects/:id, /closer-look]，
 * 按后退键又把刚关掉的浮层翻出来（点了「关闭」再后退却重新打开，是明确的坏体验）。
 * 回的是 currentBaseScreen()（history state 里的来源屏），不是按路径派生的底屏——从
 * 「多看一眼」点开项目详情再关掉，人要留在「多看一眼」，不是被扔到 /team。
 * 冷深链（新标签页直接打开 /projects/:id，没有来源屏可查）才退回默认屏。
 */
export function navigateCloseDetail() {
  go(SCREEN_PATH[currentBaseScreen()], { replace: true })
}

// ── 组件侧读路由 ─────────────────────────────────────────────────────────────

/**
 * 当前屏（顶栏高亮 / 壳的 data-scene / 底下渲染哪一屏）。
 * 在详情深链上取 history state 里的来源屏——浮层盖在原屏上，高亮与 data-scene 都不该跳。
 */
export function useCurrentScreen(): LiteScreen {
  const { pathname, state } = useLocation()
  return baseScreenFrom(pathname, state)
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
