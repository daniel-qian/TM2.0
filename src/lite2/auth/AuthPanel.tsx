import { useEffect, useMemo, useRef, useState } from 'react'
import { useAuth } from './authStore'
import { authConfigured } from './supabaseClient'
import { useLite } from '../store'
import { forgetAllOwnerTokens } from '../transport'

// feat-053 · 账号入口（顶栏，LiteBell 旁）。
//
// 🔴 本组件的第一性质：**它永远不挡路**。
// · 未配置 Supabase → 整块不渲染，应用照常当游客用。
// · 配置了但没登录 → 只是顶栏多一个「登录」按钮，七屏、上传、议事室一个都不拦。
// 没有任何一条路径会因为"没登录"而不可用——把 demo 挡在登录墙后面这条线就作废了。
//
// 文案就地定稿（zh/en 两份小字典），**不进 src/shared/i18n**：那两份是脚本生成的，
// 本波 8 条线并行，往里加键几乎必然撞车。等合流后由集成方决定要不要收编。

// 值类型放宽成 string —— `as const` 会把 zh 的字面量钉成类型，en 那份就装不进去了。
type Copy = Record<keyof typeof COPY.zh, string>

const COPY = {
  zh: {
    signIn: '登录',
    account: '账号',
    title: '账号',
    emailLabel: '邮箱',
    passwordLabel: '密码',
    doSignIn: '登录',
    doSignUp: '注册',
    switchToSignUp: '还没有账号？注册',
    switchToSignIn: '已有账号？登录',
    signOut: '退出登录',
    working: '处理中…',
    // 游客态的诚实说明：不登录能干什么、登录多给什么。
    guestNote: '不登录也能用。登录只是把上传的公司数据存到你名下，换设备还能打开。',
    verifyNote: '注册成功。去邮箱点一下确认链接，然后回来登录。',
    signedInAs: '已登录',
    claimTitle: '当前这份公司数据还没归到账号名下',
    claimAction: '绑定到我的账号',
    claiming: '绑定中…',
    claimed: '已绑定到你的账号',
    claimFailed: '绑定失败，稍后再试',
    restoreFailed: '取不到你名下的公司数据',
    retry: '重试',
    passwordHint: '至少 6 位',
  },
  en: {
    signIn: 'Sign in',
    account: 'Account',
    title: 'Account',
    emailLabel: 'Email',
    passwordLabel: 'Password',
    doSignIn: 'Sign in',
    doSignUp: 'Sign up',
    switchToSignUp: "No account yet? Sign up",
    switchToSignIn: 'Already have an account? Sign in',
    signOut: 'Sign out',
    working: 'Working…',
    guestNote:
      'You can use Avery without an account. Signing in just keeps your company data under your name, so it opens on another device.',
    verifyNote: 'Account created. Click the confirmation link in your email, then sign in.',
    signedInAs: 'Signed in',
    claimTitle: 'This company data is not attached to your account yet',
    claimAction: 'Attach to my account',
    claiming: 'Attaching…',
    claimed: 'Attached to your account',
    claimFailed: 'Could not attach it — try again later',
    restoreFailed: 'Could not load the companies on your account',
    retry: 'Try again',
    passwordHint: 'At least 6 characters',
  },
} as const

function useCopy(): Copy {
  return useMemo(() => {
    let lang: string | null = null
    try {
      lang = new URLSearchParams(window.location.search).get('lang')
    } catch {
      lang = null
    }
    if (lang !== 'zh' && lang !== 'en') {
      const env =
        typeof import.meta !== 'undefined' ? import.meta.env?.VITE_AVERY_LOCALE : undefined
      lang = String(env ?? '').trim().toLowerCase() === 'zh' ? 'zh' : 'en'
    }
    return lang === 'zh' ? COPY.zh : COPY.en
  }, [])
}

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
export function clearCompanyScope(): void {
  // 先掐凭据，再清屏上的数据：顺序反过来的话，中间那一拍已在飞的请求仍带着旧 token。
  forgetAllOwnerTokens()
  useLite.getState().resetRun() // abort 在飞的 /advise 流 + 清掉 ask 草稿
  useLite.setState({
    contextId: null,
    ownerToken: null,
    team: null,
    rawTeam: null,
    files: [],
    notes: [],
    noteJustAdded: false,
    ingestStatus: 'idle',
    ingestError: null,
    // detail 必须清：它握着上一家公司的 person/project id，留着就是一张指向空气的浮层。
    detail: null,
    screen: 'team',
  })
}

export function AuthPanel() {
  const c = useCopy()
  const status = useAuth((s) => s.status)
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
  // 刻意用 useLite.setState 而不是给 store 加 action：contextId 那块 feat-050 正在改，
  // 这里少碰一行就少一处合并冲突。
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
        useLite.setState({ contextId: first })
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
        aria-label={c.account}
        title={authed && email ? email : c.signIn}
      >
        {authed ? (email ? email.slice(0, 1).toUpperCase() : '·') : c.signIn}
      </button>

      {open ? (
        <div className="lite-auth-pop" role="dialog" aria-label={c.title}>
          <div className="lite-auth-head">
            <span className="lite-auth-title">{c.title}</span>
          </div>

          {authed ? (
            <div className="lite-auth-body">
              <p className="lite-auth-who">
                <span className="lite-auth-who-label">{c.signedInAs}</span>
                <span className="lite-auth-who-email">{email ?? ''}</span>
              </p>

              {canClaim ? (
                <div className="lite-auth-claim">
                  <p className="lite-auth-note">{c.claimTitle}</p>
                  <button
                    type="button"
                    className="lite-auth-submit"
                    onClick={() => void doClaim()}
                    disabled={claim === 'claiming'}
                  >
                    {claim === 'claiming' ? c.claiming : c.claimAction}
                  </button>
                  {claim === 'failed' ? (
                    <p className="lite-auth-error">{c.claimFailed}</p>
                  ) : null}
                </div>
              ) : null}

              {contextId && attached ? (
                <p className="lite-auth-note">{c.claimed}</p>
              ) : null}

              {restoreError ? (
                <div className="lite-auth-claim">
                  <p className="lite-auth-error">{c.restoreFailed}</p>
                  {/* 失败必须有出路 —— 此前只剩 F5（复核 finding 4）。
                      不按 restoreInFlight 置 disabled：那是个 ref，render 里读它不会随变化
                      重渲染，只会渲染出一个可能已经过时的禁用态。并发本身在副作用里已经挡住
                      （in-flight 时直接 bail），最坏结果是用户多点一下。 */}
                  <button
                    type="button"
                    className="lite-auth-secondary"
                    onClick={() => setRestoreAttempt((n) => n + 1)}
                  >
                    {c.retry}
                  </button>
                </div>
              ) : null}

              <button
                type="button"
                className="lite-auth-secondary"
                onClick={() => void signOut()}
                disabled={working}
              >
                {busy === 'signing-out' ? c.working : c.signOut}
              </button>
            </div>
          ) : (
            <form className="lite-auth-body" onSubmit={submit}>
              <label className="lite-auth-field">
                <span className="lite-auth-label">{c.emailLabel}</span>
                <input
                  type="email"
                  autoComplete="email"
                  required
                  value={emailInput}
                  onChange={(e) => setEmailInput(e.target.value)}
                />
              </label>
              <label className="lite-auth-field">
                <span className="lite-auth-label">{c.passwordLabel}</span>
                <input
                  type="password"
                  autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
                  required
                  minLength={6}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
                {mode === 'signup' ? (
                  <span className="lite-auth-hint">{c.passwordHint}</span>
                ) : null}
              </label>

              <button type="submit" className="lite-auth-submit" disabled={working}>
                {working ? c.working : mode === 'signup' ? c.doSignUp : c.doSignIn}
              </button>

              <button
                type="button"
                className="lite-auth-switch"
                onClick={() => {
                  setMode((m) => (m === 'signin' ? 'signup' : 'signin'))
                  clearError()
                }}
              >
                {mode === 'signin' ? c.switchToSignUp : c.switchToSignIn}
              </button>

              {error ? <p className="lite-auth-error">{error}</p> : null}
              {pendingVerification ? <p className="lite-auth-note">{c.verifyNote}</p> : null}
              <p className="lite-auth-note">{c.guestNote}</p>
            </form>
          )}
        </div>
      ) : null}
    </div>
  )
}
