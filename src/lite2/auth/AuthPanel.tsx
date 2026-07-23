import { useEffect, useRef, useState } from 'react'
import { useAuth } from './authStore'
import { authConfigured } from './supabaseClient'
import { useLite } from '../store'
import { forgetAllOwnerTokens } from '../transport'
import { useDict } from '../../shared/i18n/useDict'
// 🔴 换账号清场的白名单读的是**常量本身**，不是抄一份字面量 —— 理由见 KEEP_ACROSS_ACCOUNTS。
import { LOCALE_STORAGE_KEY, resolveLocale } from '../../shared/i18n'
import { LOOK_STORAGE_KEY, resolveLook } from '../look'
// rich-align-0722/09：「重新开始」把 lang/look 也回出厂——in-memory 走 setState（不落盘）。
import { useLocaleStore } from '../../shared/i18n/localeStore'
import { useLook } from '../lookStore'
// fixD/M2：换账号必须一并清掉这三个 localStorage store —— 它们装着上一家公司文档的**逐字原文**。
import { useFlow } from '../flowStore'
import { useNotify } from '../notifyStore'
import { useOnboard, DEFAULT_PLAYBOOKS } from '../onboardStore'

// feat-053 · 账号入口（顶栏，LiteBell 旁）。
//
// 🔴 本组件的第一性质：**它永远不挡路**。
// · 未配置 Supabase → 整块不渲染，应用照常当游客用。
// · 配置了但没登录 → 只是顶栏多一个「登录」按钮，七屏、上传、议事室一个都不拦。
// 没有任何一条路径会因为"没登录"而不可用——把 demo 挡在登录墙后面这条线就作废了。
//
// 文案走 src/shared/i18n（07-20 Blockers 5a 收编）。原来这里有一份就地写死的 zh/en 小字典，
// 挂载时算一次、只看 URL `?lang=` 和构建期变量——语言开关点了它不变，刷新也修不回来；而且
// 它对所有扫字典的门（中文纯度门 / aria 门）是隐形的。两个问题的同一个根：文案不在唯一源里。
// 现在 22 条键在 `en.lite2.auth*` / `zh.lite2.auth*`，`useDict()` 订阅 localeStore，跟着开关走。

type ClaimState = 'idle' | 'claiming' | 'claimed' | 'failed'

// ── 换人即清场（feat-053 复核 finding 1）────────────────────────────────────────────────
// 🔴 这是验收里那条「换账号后旧数据不串」的**前端一半**。服务端那一半（authorize_context
// 按账号/owner_token 判定，不认就 404）一直是对的，但少了这一半，它在浏览器上是空转的：
//
//   经理 A 登录 → 上传公司 A（contextId / ownerToken / team / rawTeam / notes / files 全落进
//   useLite，owner_token 还落进 localStorage）→ 点退出登录 → 经理 B 在同一个标签页登录。
//   此前 signOut 只把 status 改成 'guest'，useLite 一个字段都没清，于是：
//     · 恢复副作用拉到了 B 的 context_ids，却因为"手上已有 contextId"直接放弃接管
//       → B 面前是 A 的人和项目；
//     · localStorage 里 A 的 owner_token 还在，B 一刷新/一提问，服务端凭那枚 token
//       正大光明放行 200 —— 这不是陈旧渲染，是活的读权限。
//   三家外部公司在同一台机器上轮流演示（或 Danny 一台机器切两家看），当场串数据。
//
// 放在组件文件的模块层而不是 authStore：authStore 若 import useLite 就成环
//（authStore → store → transport → authStore，transport 要拿 currentAccessToken）。
// AuthPanel 本来就是连接这两边的那一层，是唯一不成环的落点。
// ── fixD/M2 · `lite2:` 命名空间整段清扫 ───────────────────────────────────────────────────
//
// 原来这里只清 useLite + owner_token，于是 **flowStore / onboardStore / notifyStore 三个
// localStorage store 原封不动地跨账号存活**。它们不是"偏好设置"，装的是上一家公司文档的
// **逐字原文**：
//   · `lite2:flow:v1`    —— 跟进队列条目（title/note 直接来自分诊卡与议事室，是文档原句）
//   · `lite2:onboard:v1` —— 向导里填的公司名 / 部门 / 称呼
//   · `lite2:notify:v1`  —— 通知条目与已见过的矛盾卡 id
// 换账号后 B 公司的经理能在跟进队列里读到 A 公司文档的原文 —— 租户隔离的实质破口，
// 而且是三家外部公司轮流在同一台机器上试用时**必然**踩到的那条路。
//
// 🔴 为什么按前缀扫而不是列三个 key：列举会漂。那三个 key 的常量私有在各自文件里（本线的
// 文件边界也动不了它们），在这儿抄一份字面量，等谁把 `:v1` 升成 `:v2`，清扫就**静默失效**
// ——而失效的表现正是"看得见别人公司的原文"，没有任何报错。按前缀扫则把不变式写死成
// "`lite2:` 底下不许有任何东西活过一次换账号"，将来新增的 lite2 store 自动被覆盖。
//
// 留 supabase-js 自己的会话 key（不是 `lite2:` 前缀）—— 那是**新**账号的登录态，清了就等于
// 刚登录就被登出。
//
// ── 07-20 Blockers 5b · 一个**极窄**的白名单 ────────────────────────────────────────────
// 「`lite2:` 底下不许有任何东西活过一次换账号」这条不变式没有变，默认仍然是**全清**。
// 但 07-20 新加的两个键落进了同一个命名空间，而它们不是公司数据、是**用户偏好**：
//   · `lite2:lang:v1` —— 界面语言（这个键甚至不是 v02 专属，v01 也读它，挂 lite2 前缀属误置）
//   · `lite2:look:v1` —— 皮肤
// 于是「退出登录」会顺手把人的皮肤和语言偏好一起抹掉。语言有构建期兜底所以看不太出来，
// 皮肤是当场弹回 paper。
//
// 🔴 两条纪律，改这里的人必须一起守住：
// ① **import 常量，绝不抄字面量**。抄一份 'lite2:look:v1' 进来，等谁把 `:v1` 升成 `:v2`，
//    白名单就静默失效——而失效的表现只是"偏好又被清了"，没有任何报错。这正是下面那段注释
//    当初拒绝列举 key 的同一个理由，白名单同样适用。
// ② **进这个集合的门槛是「不含任何公司数据」**。装了文档原文 / context id / 凭据的，
//    一个都不许进——放进来一个，就等于把公司数据放行过了一次换账号。
const KEEP_ACROSS_ACCOUNTS: ReadonlySet<string> = new Set([LOCALE_STORAGE_KEY, LOOK_STORAGE_KEY])

function wipeLite2LocalStorage(): void {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return
    const doomed: string[] = []
    for (let i = 0; i < window.localStorage.length; i++) {
      const key = window.localStorage.key(i)
      if (key && key.startsWith('lite2:') && !KEEP_ACROSS_ACCOUNTS.has(key)) doomed.push(key)
    }
    // 先收集再删：removeItem 会让 length/索引在遍历途中塌陷，边遍历边删必漏。
    for (const key of doomed) window.localStorage.removeItem(key)
  } catch {
    /* 无痕/被拒 —— 下面的内存态复位仍然生效，本会话不会串台 */
  }
}

// localStorage 抹了还不够：那三个 store 的**内存态**是 store 创建时一次性读进来的，
// 之后再也不读 localStorage。不复位的话，B 的经理这一整个标签页里照样看得见 A 的条目
// （要等他手动刷新才消失，而演示时没人会刷新）。
//
// 用裸 setState 而不是给各 store 加 reset()：那三个文件不在本线的边界内。形状取自各自的
// EMPTY_PERSISTED，`persist()` 不会被裸 setState 触发，所以不会把空态又写回去（写回去也无妨，
// 上面已经删干净了）。
function resetLite2MemoryStores(): void {
  useFlow.setState({ triageMarks: {}, followups: [], gapMarks: {}, composerDraft: null })
  useNotify.setState({ items: [], seenGapIds: [], seenAskIds: [], open: false })
  useOnboard.setState({
    status: 'unseen',
    step: 'doors', // input-side-0721：闸门页第 0 步（三扇门）
    company: '',
    dept: '',
    yourName: '',
    // input-side-0721 · 8A：新增采集字段同属公司数据，换账号必须一并复位（companyNote 是
    // 上一家公司的现状口述，串给下一个账号看正是这个函数存在的理由）。
    teamCount: '',
    yourRole: '',
    companyNote: '',
    companyNoteSentTo: [],
    playbooks: [...DEFAULT_PLAYBOOKS],
    pausedThisSession: false,
  })
}

export function clearCompanyScope(): void {
  // 先掐凭据，再清屏上的数据：顺序反过来的话，中间那一拍已在飞的请求仍带着旧 token。
  forgetAllOwnerTokens()
  useLite.getState().resetRun() // abort 在飞的 /advise 流 + 清掉 ask 草稿
  // fixD/M3+m4：走 adoptContext 而不是裸 setState —— 它是 feat-050 留的收口，一次调用同时
  // 落 state 和**抹掉 localStorage 锚点 `lite2:contextId:v1`**。原来这里漏了后者，于是登出后
  // 锚点还指着上一个账号的公司：下一个人打开就被 restoreSession 拿去请求（token 已清 → 404 →
  // 才回上传态），中间那一拍屏幕上挂的是别人公司的 id。
  useLite.getState().adoptContext(null)
  useLite.setState({
    // adoptContext 只在 contextId **确实变了**时才清派生数据；登出时它多半确实变了，但
    // "contextId 本来就是 null、team 却还挂着"这种中间态不该赌 —— 显式再清一遍，
    // 租户隔离这种地方不留"多半"。
    team: null,
    rawTeam: null,
    files: [],
    notes: [],
    noteJustAdded: false,
    ingestStatus: 'idle',
    ingestError: null,
    // fixD/B1：名册也是公司数据（谁传过哪些文件），跟着走。
    knownContexts: [],
    switchError: null,
    // 换人时可能正有一次切换在飞。它自己会被 stillOn/switchSeq 判为过期而不写任何数据，
    // 但屏上那个 pending 态得由这里收掉，否则名册按钮永远灰着。
    switchPending: null,
  })
  // fixD/M2：三个漏网 store —— 内存态先复位，再把 `lite2:` 底下整段抹掉。
  resetLite2MemoryStores()
  wipeLite2LocalStorage()
  // 🔴 集成期修正（feat-051 路由化落地后）：原来这里是 `setState({ detail: null, screen: 'team' })`。
  // 051 之后这两个都不再是 store 状态——当前屏与当前详情由 URL 派生，写进 state 是静默空转：
  // 换账号后 URL 还停在 `/team/<上一家公司的人 id>`，浮层照旧挂着，正是本函数要杀的那个 bug。
  // goScreen 的签名 051 没动，内部改成推路由，一次调用同时收掉「关浮层」和「回团队屏」。
  useLite.getState().goScreen('team')
}

// ── rich-align-0722/09 · 「重新开始」全量重开（演示 10 秒复位下一场）────────────────────────
// 🔴 无白名单的全量 lite2:* 清扫（含 lang/look）。与 wipeLite2LocalStorage **分开一条路径**：
// 换账号（clearCompanyScope）保留偏好，重新开始回出厂全清——故 verify-auth-form ⑨（换账号保留
// lang/look）不受本函数影响。别把这个白名单去掉到 wipeLite2LocalStorage 上，那会打穿 ⑨。
function wipeAllLite2LocalStorage(): void {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return
    const doomed: string[] = []
    for (let i = 0; i < window.localStorage.length; i++) {
      const key = window.localStorage.key(i)
      if (key && key.startsWith('lite2:')) doomed.push(key) // 🔴 无白名单：偏好一并清
    }
    for (const key of doomed) window.localStorage.removeItem(key)
  } catch {
    /* 无痕/被拒 —— 内存态复位仍生效 */
  }
}

// 与 clearCompanyScope（换账号）三处不同（09 拍板①/E1）：
//   ① **连语言/观感一起清**（whitelist-free wipe——回出厂，不像换账号保留偏好）。
//   ② **回 onboarding 闸门**（resetLite2MemoryStores 已把 onboard 打回 status:unseen/step:doors；
//      goScreen('home') 让首页骨架落在闸门下——fresh 会话 hadContextOnLoad=false，status unseen
//      即重弹闸门，且**不设 forceOpen**以保留 Escape「先随便看看」逃生门）。
//   ③ **in-memory lang/look 回出厂**：setState 绕开 setLocale/setLook 的 persist，故上面清空的
//      lite2:lang/look 键保持空（resolveLocale/resolveLook 是纯函数无写盘副作用）。
export function restartAll(): void {
  forgetAllOwnerTokens()
  useLite.getState().resetRun()
  useLite.getState().adoptContext(null)
  useLite.setState({
    team: null,
    rawTeam: null,
    files: [],
    notes: [],
    noteJustAdded: false,
    ingestStatus: 'idle',
    ingestError: null,
    knownContexts: [],
    switchError: null,
    switchPending: null,
  })
  resetLite2MemoryStores()
  wipeAllLite2LocalStorage()
  useLocaleStore.setState({ locale: resolveLocale() })
  useLook.setState({ look: resolveLook() })
  useLite.getState().goScreen('home')
}

// 门缝（🔴 DEV-ONLY）：同 store.ts 的 `__lite2Store` / authStore.ts 的 `__lite2Auth` 先例。
// fixD 的数据边界门要断言「换账号后这三个 store 的**内存态**也复位了」——光看 localStorage
// 不够：那三个 store 只在创建时读一次盘，不复位内存的话 B 的经理在这一整个标签页里照样
// 看得见 A 的条目。它们各自的文件不在本线的边界内，而 AuthPanel 本来就是唯一同时持有这
// 三个引用的模块，是唯一不成环也不越界的落点。
//
// 🔴 与 `__lite2Store` 不同，这里加了 DEV 闸：暴露的是三个可写 store 句柄，生产环境没有任何
// 理由存在。`import.meta.env.DEV` 在生产构建里被静态求值成 false，rollup 直接 DCE 掉整块。
if (import.meta.env.DEV && typeof window !== 'undefined') {
  const w = window as unknown as Record<string, unknown>
  w.__lite2Flow = useFlow
  w.__lite2Notify = useNotify
  w.__lite2Onboard = useOnboard
}

export function AuthPanel() {
  const { t } = useDict()
  const c = t.lite2
  const status = useAuth((s) => s.status)
  const accountCapability = useAuth((s) => s.accountCapability)
  const email = useAuth((s) => s.email)
  const userId = useAuth((s) => s.userId)
  const busy = useAuth((s) => s.busy)
  const error = useAuth((s) => s.error)
  const pendingVerification = useAuth((s) => s.pendingVerification)
  const init = useAuth((s) => s.init)
  const signIn = useAuth((s) => s.signIn)
  const signUp = useAuth((s) => s.signUp)
  const signOut = useAuth((s) => s.signOut)
  const clearError = useAuth((s) => s.clearError)

  const contextId = useLite((s) => s.contextId)
  const ownerToken = useLite((s) => s.ownerToken)
  const rawTeam = useLite((s) => s.rawTeam)
  const transport = useLite((s) => s.transport)

  const [open, setOpen] = useState(false)
  const [mode, setMode] = useState<'signin' | 'signup'>('signin')
  const [emailInput, setEmailInput] = useState('')
  const [password, setPassword] = useState('')
  const [claim, setClaim] = useState<ClaimState>('idle')
  const [restoreError, setRestoreError] = useState(false)
  // 用户点「重试」时 +1 —— 恢复副作用的 dep，是失败后唯一能让它再跑一次的东西。
  const [restoreAttempt, setRestoreAttempt] = useState(0)
  // 本账号名下已登记的 context（/account/contexts + 已登录上传的 account_linked）。
  // 用来回答"手上这份到底归没归到账号名下"。
  const [linkedIds, setLinkedIds] = useState<string[]>([])
  const restoredFor = useRef<string | null>(null)
  const restoreInFlight = useRef(false)
  // 屏上这份数据属于谁：userId（已登录）| null（游客）。用来发现"人换了"。
  const scopedTo = useRef<string | null>(null)

  // 会话恢复：挂载即跑（store 内模块级 guard 幂等）。
  useEffect(() => {
    init()
  }, [init])

  // 🔴 换人即清场。判据刻意收得很窄：**只有在"上一个身份是某个登录用户"且新身份与它不同**
  // 时才清。于是三条路径各归各位：
  //   · 首帧 loading→authed（刷新页面恢复会话）：prev 为 null → 不清，不会误伤自己的数据
  //     （feat-050 正在做会话恢复，这条守住它不被登录动作反手清掉）
  //   · 游客→登录：prev 为 null → 不清。游客期刚传的东西不能被登录动作吞掉——认领路径
  //     整个建立在"登录后手上那份还在"之上
  //   · 登录→登出、A→B 直接换会话：prev 是旧 userId 且 ≠ 新身份 → 清
  // 必须在恢复副作用之前声明：同一次 commit 里 effect 按声明顺序同步跑完，清场先落地，
  // 后面那个 fetch 的 .then 才会看到"手上没有 context"从而正常接管。
  useEffect(() => {
    if (status === 'disabled' || status === 'loading') return
    const identity = status === 'authed' ? userId : null
    if (status === 'authed' && !identity) return // 会话在但 user id 还没到 —— 等下一拍
    const prev = scopedTo.current
    if (prev === identity) return
    scopedTo.current = identity
    if (!prev) return // 第一次观测到身份，没有"上一个人"要清
    clearCompanyScope()
    restoredFor.current = null
    restoreInFlight.current = false
    setClaim('idle')
    setRestoreError(false)
    setLinkedIds([])
  }, [status, userId])

  // 登录后恢复本账号的公司数据 —— 只在"当前没有 context"时才接管，绝不覆盖用户
  // 手上正在看的那份（游客期刚传的东西不能被登录动作吞掉）。
  //
  // fixD/M3：原来这里是裸 `useLite.setState({ contextId: first })`。当时的理由是"contextId
  // 那块 feat-050 正在改，少碰一行就少一处合并冲突"——躲冲突躲掉的恰恰是 feat-050 专门为
  // 这一刻留的收口 `adoptContext()`，结果它**全仓零调用点**，成了死代码。
  //
  // 代价不是"少了个抽象"，是一个**方向反了的 bug**：adoptContext 里那句
  // `rememberContextId(contextId)` 才是把锚点落进 localStorage 的唯一动作，绕过它 →
  // **登录用户的 contextId 永远不落盘 → 登录用户刷新反而丢数据，游客却不丢**。
  // 登录本该是"更牢靠"的那条路。
  useEffect(() => {
    if (status !== 'authed' || !userId) return
    if (restoredFor.current === userId) return
    if (restoreInFlight.current) return // 同一次恢复不并发打两次
    const fetchContexts = transport.fetchAccountContexts
    if (!fetchContexts) return // stub transport 没有账号能力 —— 静默跳过
    restoreInFlight.current = true
    void fetchContexts()
      .then(({ context_ids }) => {
        // 🔴 守卫**成功才置位**（复核 finding 4）。置在 fetch 之前的话，后端恰好在重启、
        // 网抖一下，就等于这一整个会话内恢复再也不会跑（守卫已占位，deps 也不会再变），
        // 用户只能 F5。现在失败留着守卫为空，配合下面的「重试」按钮就能再来一次。
        restoredFor.current = userId
        setRestoreError(false)
        setLinkedIds(context_ids)
        const first = context_ids[0]
        if (!first) return
        if (useLite.getState().contextId) return // 手上已有数据，不接管
        // 🔴 收口口子，别再改回裸 setState：落 state **和** 落 localStorage 锚点。
        useLite.getState().adoptContext(first)
        void useLite.getState().refreshTeam()
        void useLite.getState().refreshNotes()
      })
      .catch(() => setRestoreError(true))
      .finally(() => {
        restoreInFlight.current = false
      })
  }, [status, userId, transport, restoreAttempt])

  // 已登录时上传 → /ingest 当场就把这份 context 绑到账号了，payload 回 account_linked。
  // 记下来，否则面板会对着一份**已经归属**的数据说"还没归到账号名下"（复核 finding 2）。
  // 记在组件 state 而不是每次现读 rawTeam：rawTeam 会被后续 refreshTeam 覆盖，
  // 而 /team/{id} 刷新帧不带 account_linked——只看 rawTeam 的话这个事实会凭空消失。
  useEffect(() => {
    const id = rawTeam?.context_id
    if (!id || rawTeam?.account_linked !== true) return
    setLinkedIds((prev) => (prev.includes(id) ? prev : [...prev, id]))
  }, [rawTeam])

  // 未配置这份部署就没有账号能力 —— 不出假入口（点了必然失败的按钮比没有按钮更糟）。
  if (status === 'disabled' || !authConfigured()) return null
  if (status === 'loading') return null

  const authed = status === 'authed'

  // 门缝二（07-20）：key 配了不代表这份后端部署真的挂了账号路由。生产实测过
  // avery.dannyqian.com 有 key 但 /account/status 404——只看 authConfigured() 会让客户看到一个
  // 能点、能登进 Supabase、然后处处 403/404 的登录框，比没有入口更糟。'unknown'（探测还没回来）
  // 和 'unsupported'（探测回来说没有）一样藏起来——绝不先亮出登录框再收回去。
  //
  // 🔴 但这条判据**只管游客侧**（复审 Blockers 4）。原来它盖住整个组件，于是探测抖一下、
  // 已登录的人整块面板连同**退出登录**一起消失——而会话恢复是并行且成功的：人还登着，
  // transport 照旧带着他的 access_token 发请求，界面上却再没有任何手段把这个身份退掉。
  // 演示机 / 共享机上，那就是上一个人的身份留在页面里。
  //
  // 两件事本就正交：探测回答的是"要不要**邀请**一个人去登录"（不确定就别邀请）；
  // 已经有会话时，那个人**已经在里面了**，藏起出口不会让他退回游客，只会让他退不出去。
  // 手上握着一份真会话时，登出永远可达。
  if (!authed && accountCapability !== 'supported') return null


  const working = busy !== 'idle'

  // 认领入口只在"手上这份数据确实还没归属"时出现：已登录 + 有 context + 有 owner_token
  // （owner_token 是证明所有权的凭据，没有它就无从认领）+ **确实还没绑**。
  // 最后一条是复核 finding 2：此前完全不看绑定状态，于是"已登录状态下上传"（后端 /ingest
  // 当场就绑好了）也照样弹一句"当前这份公司数据还没归到账号名下"——对着客户说的一句假话。
  // 三个判据都是真的：认领成功、/account/contexts 里有它、或上传时回了 account_linked。
  const attached =
    claim === 'claimed' || (contextId !== null && linkedIds.includes(contextId))
  const canClaim = authed && Boolean(contextId) && Boolean(ownerToken) && !attached

  const doClaim = async () => {
    const claimContext = transport.claimContext
    if (!claimContext || !contextId || !ownerToken) return
    setClaim('claiming')
    try {
      await claimContext(contextId, ownerToken)
      setClaim('claimed')
    } catch {
      setClaim('failed')
    }
  }

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    if (working) return
    if (mode === 'signup') void signUp(emailInput, password)
    else void signIn(emailInput, password)
  }

  const toggle = () => {
    setOpen((v) => !v)
    clearError()
  }

  return (
    <div className="lite-auth">
      <button
        type="button"
        className="lite-auth-toggle"
        onClick={toggle}
        aria-expanded={open}
        aria-label={c.authAccount}
        title={authed && email ? email : c.authSignIn}
      >
        {authed ? (email ? email.slice(0, 1).toUpperCase() : '·') : c.authSignIn}
      </button>

      {open ? (
        <div className="lite-auth-pop" role="dialog" aria-label={c.authTitle}>
          <div className="lite-auth-head">
            <span className="lite-auth-title">{c.authTitle}</span>
          </div>

          {authed ? (
            <div className="lite-auth-body">
              <p className="lite-auth-who">
                <span className="lite-auth-who-label">{c.authSignedInAs}</span>
                <span className="lite-auth-who-email">{email ?? ''}</span>
              </p>

              {canClaim ? (
                <div className="lite-auth-claim">
                  <p className="lite-auth-note">{c.authClaimTitle}</p>
                  <button
                    type="button"
                    className="lite-btn lite-btn--primary lite-auth-submit"
                    onClick={() => void doClaim()}
                    disabled={claim === 'claiming'}
                  >
                    {claim === 'claiming' ? c.authClaiming : c.authClaimAction}
                  </button>
                  {claim === 'failed' ? (
                    <p className="lite-auth-error">{c.authClaimFailed}</p>
                  ) : null}
                </div>
              ) : null}

              {contextId && attached ? (
                <p className="lite-auth-note">{c.authClaimed}</p>
              ) : null}

              {restoreError ? (
                <div className="lite-auth-claim">
                  <p className="lite-auth-error">{c.authRestoreFailed}</p>
                  {/* 失败必须有出路 —— 此前只剩 F5（复核 finding 4）。
                      不按 restoreInFlight 置 disabled：那是个 ref，render 里读它不会随变化
                      重渲染，只会渲染出一个可能已经过时的禁用态。并发本身在副作用里已经挡住
                      （in-flight 时直接 bail），最坏结果是用户多点一下。 */}
                  <button
                    type="button"
                    className="lite-btn lite-btn--ghost lite-auth-secondary"
                    onClick={() => setRestoreAttempt((n) => n + 1)}
                  >
                    {c.authRetry}
                  </button>
                </div>
              ) : null}

              {/* data-role 是给门用的稳定抓手：`.lite-auth-secondary` 这个类在同一个弹层里
                  还挂着「重试」按钮，按类计数分不清谁是谁；按文案定位又会被 i18n 改动绊住。 */}
              <button
                type="button"
                className="lite-btn lite-btn--ghost lite-auth-secondary"
                data-role="sign-out"
                onClick={() => void signOut()}
                disabled={working}
              >
                {busy === 'signing-out' ? c.authWorking : c.authSignOut}
              </button>
            </div>
          ) : (
            <form className="lite-auth-body" onSubmit={submit}>
              <label className="lite-auth-field">
                <span className="lite-auth-label">{c.authEmailLabel}</span>
                <input
                  type="email"
                  autoComplete="email"
                  required
                  value={emailInput}
                  onChange={(e) => setEmailInput(e.target.value)}
                />
              </label>
              <label className="lite-auth-field">
                <span className="lite-auth-label">{c.authPasswordLabel}</span>
                <input
                  type="password"
                  autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
                  required
                  minLength={6}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
                {mode === 'signup' ? (
                  <span className="lite-auth-hint">{c.authPasswordHint}</span>
                ) : null}
              </label>

              <button type="submit" className="lite-btn lite-btn--primary lite-auth-submit" disabled={working}>
                {working ? c.authWorking : mode === 'signup' ? c.authDoSignUp : c.authDoSignIn}
              </button>

              <button
                type="button"
                className="lite-btn lite-btn--ghost lite-auth-switch"
                onClick={() => {
                  setMode((m) => (m === 'signin' ? 'signup' : 'signin'))
                  clearError()
                }}
              >
                {mode === 'signin' ? c.authSwitchToSignUp : c.authSwitchToSignIn}
              </button>

              {error ? <p className="lite-auth-error">{error}</p> : null}
              {pendingVerification ? <p className="lite-auth-note">{c.authVerifyNote}</p> : null}
              <p className="lite-auth-note">{c.authGuestNote}</p>
            </form>
          )}
        </div>
      ) : null}
    </div>
  )
}
