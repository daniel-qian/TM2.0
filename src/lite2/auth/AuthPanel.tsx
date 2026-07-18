import { useEffect, useMemo, useRef, useState } from 'react'
import { useAuth } from './authStore'
import { authConfigured } from './supabaseClient'
import { useLite } from '../store'

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
  const transport = useLite((s) => s.transport)

  const [open, setOpen] = useState(false)
  const [mode, setMode] = useState<'signin' | 'signup'>('signin')
  const [emailInput, setEmailInput] = useState('')
  const [password, setPassword] = useState('')
  const [claim, setClaim] = useState<ClaimState>('idle')
  const [restoreError, setRestoreError] = useState(false)
  const restoredFor = useRef<string | null>(null)

  // 会话恢复：挂载即跑（store 内模块级 guard 幂等）。
  useEffect(() => {
    init()
  }, [init])

  // 登录后恢复本账号的公司数据 —— 只在"当前没有 context"时才接管，绝不覆盖用户
  // 手上正在看的那份（游客期刚传的东西不能被登录动作吞掉）。
  // 刻意用 useLite.setState 而不是给 store 加 action：contextId 那块 feat-050 正在改，
  // 这里少碰一行就少一处合并冲突。
  useEffect(() => {
    if (status !== 'authed' || !userId) return
    if (restoredFor.current === userId) return
    restoredFor.current = userId
    const fetchContexts = transport.fetchAccountContexts
    if (!fetchContexts) return // stub transport 没有账号能力 —— 静默跳过
    void fetchContexts()
      .then(({ context_ids }) => {
        const first = context_ids[0]
        if (!first) return
        if (useLite.getState().contextId) return // 手上已有数据，不接管
        useLite.setState({ contextId: first })
        void useLite.getState().refreshTeam()
        void useLite.getState().refreshNotes()
      })
      .catch(() => setRestoreError(true))
  }, [status, userId, transport])

  // 登出后允许下次登录重新恢复。
  useEffect(() => {
    if (status === 'guest') {
      restoredFor.current = null
      setClaim('idle')
      setRestoreError(false)
    }
  }, [status])

  // 未配置这份部署就没有账号能力 —— 不出假入口（点了必然失败的按钮比没有按钮更糟）。
  if (status === 'disabled' || !authConfigured()) return null
  if (status === 'loading') return null

  const authed = status === 'authed'
  const working = busy !== 'idle'

  // 认领入口只在"手上这份数据确实还没归属"时出现：已登录 + 有 context + 有 owner_token。
  // （owner_token 是证明所有权的凭据，没有它就无从认领。）
  const canClaim = authed && Boolean(contextId) && Boolean(ownerToken) && claim !== 'claimed'

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

              {claim === 'claimed' ? <p className="lite-auth-note">{c.claimed}</p> : null}
              {restoreError ? <p className="lite-auth-error">{c.restoreFailed}</p> : null}

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
