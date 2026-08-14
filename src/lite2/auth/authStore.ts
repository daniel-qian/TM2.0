// feat-053 · 账号状态（登录/登出/会话恢复）—— zustand，与 lite2 其余 store 同族。
//
// ── #101（0813）· `signUp` 已整个删除，不是「留着不调用」──────────────────────────────
// 账号改由 Danny 用 `supabase.auth.admin.createUser` 手工建（见 `scripts/ops/create-account.mjs`），
// 产品里不再有任何注册路径。删掉而不是留一条 UI 够不到的死枝，理由是本仓的老碑
// ——「死枝要在 docstring 自陈测不到」：一个没人能走到的 `signUp()` 只会让下一个人写出一条
// **永远绿的空判据**（伪造网络响应直接调它，测的是函数自己，不是产品）。跟着一起走的还有
// `pendingVerification` / `busy: 'signing-up'` 两个状态和 `authVerifyNote` 那句文案——
// #94 实测：Supabase 对已注册邮箱的 signup 回 200 + 假 user id（防枚举），于是那句
// 「注册成功。去邮箱点一下确认链接」是**只可能在说谎时才亮**的提示。
//
// 🔴 前端删干净 ≠ 注册关了。真闸只有 Supabase 后台的 `disable_signup`（anon key 就在
// 浏览器 bundle 里，谁都能直接 POST `/auth/v1/signup`）。活体判据：
// `node .issues/account-tenancy-0813/probe-signup-frozen.mjs`。
//
// 口径（PRD G1）：`Supabase user → 公司 context_id`。**owner_token 保留在下层不动**——
// 服务端按 user 查到 context 再放行读端点（authorize_context 的 account 支路），
// 前端只负责把 access_token 以 header `X-Avery-Account` 带上，绝不自己拼 token 逻辑。
//
// 🔴 三条硬性质：
// 1. **未配置 = disabled，不是 error**。没有 Supabase key 的部署照常当游客用，UI 不出登录入口。
// 2. **登录不是进入应用的前置**。status 只影响"这份数据归不归我账号"，不影响能不能打开应用、
//    能不能上传、能不能问。游客路径永远活着。
// 3. **access_token 只进 header**，绝不进 URL、绝不落我们自己的 localStorage
//    （supabase-js 自己持久化会话，我们不复制一份凭据出来）。

import { create } from 'zustand'
import type { Session } from '@supabase/supabase-js'
import { authConfigured, getSupabase } from './supabaseClient'
import { apiBase } from '../transport'

// disabled  = 这份部署没配 Supabase（游客模式，UI 不出账号入口）
// loading   = 正在恢复会话（首帧，短暂）
// guest     = 配了但没登录 —— 完全可用，只是数据还没归属到账号
// authed    = 已登录
export type AuthStatus = 'disabled' | 'loading' | 'guest' | 'authed'

// #101：`'signing-up'` 随 signUp() 一起退役 —— 没有任何代码路径再能把 busy 置成它。
export type AuthBusy = 'idle' | 'signing-in' | 'signing-out'

// ── 门缝二（07-20 kickoff）：key 配了 ≠ 后端接得住 ──────────────────────────────────────
// 07-20 生产实测：avery.dannyqian.com 的 Vercel 环境已经填了 Supabase 两个 key，但
// `GET /account/status` 是 404——这份部署跑的容器镜像还没挂 feat-053 的账号路由。
// 若登录入口只看 authConfigured()（本模块前一版的判据），客户会看到一个能点的登录框、
// 真能登进 Supabase、然后处处 403/404——比压根没有登录框更糟：没有入口时游客路径完整可用，
// 有一个接不住的入口时，"能不能用" 这件事本身被做成了一次赌博。
//
// unknown     = 还没探测完（首帧，短暂）。面板在这一态下也保持隐藏——绝不先亮出登录框、
//               等探测回来才发现接不住再收回去，那一闪就是给客户看了一次假入口。
// supported   = `/account/status` 回了 200 —— 这份后端部署确实挂了账号路由。
// unsupported = 404 / 网络错误 / 超时 / 任何非 200，一律算这一档。失败即降级，
//               绝不为了"乐观"渲染一个我们不确定后端接得住的登录框。
export type AccountCapability = 'unknown' | 'supported' | 'unsupported'

interface AuthState {
  status: AuthStatus
  email: string | null
  userId: string | null
  busy: AuthBusy
  error: string | null
  // 门缝二：后端是否真挂了账号路由（与 status 正交——status 讲的是"这个人有没有登录"，
  // 这个字段讲的是"这份部署的后端接不接得住登录"）。AuthPanel 的渲染判据两者都要看。
  accountCapability: AccountCapability

  init: () => void
  signIn: (email: string, password: string) => Promise<void>
  signOut: () => Promise<void>
  clearError: () => void
}

let initialized = false

// 当前 access_token —— transport 打 header 时同步取用。
// 只活在内存：supabase-js 已经在管持久化，我们再存一份 = 多一个会失效、会泄漏的副本。
let accessToken: string | null = null

/** transport 用：当前登录会话的 access_token（未登录 → null）。🔴 只允许进 header。 */
export function currentAccessToken(): string | null {
  return accessToken
}

function applySession(session: Session | null): Partial<AuthState> {
  accessToken = session?.access_token ?? null
  if (!session) {
    return { status: 'guest', email: null, userId: null }
  }
  return {
    status: 'authed',
    email: session.user?.email ?? null,
    userId: session.user?.id ?? null,
  }
}

// 门缝二：探测这份部署的后端有没有挂账号路由。只在 `configured` 分支被调用一次
// （复用 `initialized` 那道模块级闸——init() 本身就只跑一次，探测跟着只发一趟）。
// 🔴 超时也算失败：探测绝不允许无限期悬着——那样 accountCapability 会卡在 'unknown'，
// 面板永远隐藏，效果等同于"探测失败"，但缺了"曾经试过"这个事实（下面 gate 脚本要断言的
// 正是这件事）。5s 足够覆盖真实网络延迟，又不会让首屏体验被一次慢请求拖住太久
// ——反正探测结果只影响"要不要出登录入口"这一件事，不挡游客路径。
const ACCOUNT_STATUS_TIMEOUT_MS = 5000

// ── 07-20 复审 Blockers 4：一次抖动 = 整场判死刑 ────────────────────────────────────────
//
// 原实现只发一次请求，超时或任意非 200 就把 accountCapability 永久钉成 'unsupported'。
// 后果不是"少个登录框"：会话恢复是**并行且成功**的——人还登着、transport 照旧带着他的
// access_token 发请求——但整块面板（含**退出登录**）不见了。演示机 / 共享机上，上一个人的
// 身份就这样留在页面里，下一个人没有任何界面手段把它退掉。
//
// 修法的分界线是本轮反复出现的同一条纪律：**「后端说没有」和「我没问到」是两件事。**
//   · 拿到了 HTTP 回执（404 / 501 / 4xx）—— 后端**回答**了："这份部署没挂账号路由"。
//     这是答案，不是抖动，立刻落定 unsupported，一次都不重试（重试只会拖慢诚实的答案）。
//   · 没拿到回执（网络错误 / 超时 / CORS / 502·503·504 这类网关代答）—— 我们**没问到**。
//     这不是"后端说没有"，重试。
//
// 退避刻意小（400ms / 1200ms）：最坏情况约 16.6s 才落定 unsupported，这期间游客侧登录入口
// 保持隐藏（与探测未回来时的行为完全一致，不会先亮再收）。代价只落在"多等一会儿才看到登录
// 按钮"，而永不落在"能不能用"上——游客路径全程不受影响。
const ACCOUNT_STATUS_RETRY_BACKOFF_MS = [400, 1200]

/** 5xx 里网关代答的那几个：请求根本没被应用处理过，与"应用回答了没有"不是一回事。 */
function isNoAnswer(status: number): boolean {
  return status === 502 || status === 503 || status === 504
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** 单发探测。'retry' = 没问到（可重试）；其余两个是**落定**的答案。 */
function probeOnce(): Promise<AccountCapability | 'retry'> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), ACCOUNT_STATUS_TIMEOUT_MS)
  return fetch(`${apiBase()}/account/status`, { signal: controller.signal })
    .then((res): AccountCapability | 'retry' => {
      if (res.ok) return 'supported'
      return isNoAnswer(res.status) ? 'retry' : 'unsupported'
    })
    .catch((): AccountCapability | 'retry' => 'retry') // 网络错误 / 超时 / CORS —— 没问到
    .finally(() => clearTimeout(timer))
}

async function probeAccountCapability(): Promise<AccountCapability> {
  for (let attempt = 0; ; attempt++) {
    const outcome = await probeOnce()
    if (outcome !== 'retry') return outcome
    const backoff = ACCOUNT_STATUS_RETRY_BACKOFF_MS[attempt]
    if (backoff === undefined) return 'unsupported' // 重试用尽 —— 仍然 fail-safe 降级
    await sleep(backoff)
  }
}

// Supabase 的报错原文是英文且偏技术（"Invalid login credentials"）。给经理看的是人话。
// 只翻译我们真的能识别的几类，其余原样透出——绝不把未知错误粉饰成"操作成功"。
function humanizeAuthError(raw: string, locale: 'en' | 'zh'): string {
  const msg = raw.trim()
  if (locale !== 'zh') return msg
  const lower = msg.toLowerCase()
  if (lower.includes('invalid login credentials')) return '邮箱或密码不对'
  if (lower.includes('email not confirmed')) return '邮箱还没验证，请先去收件箱点确认链接'
  // #101：这里原来还有两条 —— 「这个邮箱已经注册过了」与「密码太短了（至少 6 位）」。
  // 两条都只可能从 signup 回来（`signInWithPassword` 对错密码一律回 invalid_credentials，
  // 不会评论密码长度，也不会承认某个邮箱存在——那正是防枚举设计）。signUp 删掉之后它们
  // **一条也够不到**：留着就是两条谁都判不动的死枝。
  if (lower.includes('unable to validate email') || lower.includes('invalid email'))
    return '邮箱格式不对'
  if (lower.includes('rate limit') || lower.includes('too many'))
    return '试得太频繁了，等一会儿再来'
  if (lower.includes('failed to fetch') || lower.includes('network'))
    return '连不上账号服务，检查一下网络'
  return msg
}

function localeOf(): 'en' | 'zh' {
  try {
    const fromUrl = new URLSearchParams(window.location.search).get('lang')
    if (fromUrl === 'zh' || fromUrl === 'en') return fromUrl
  } catch {
    /* 畸形 search — 走 env 默认 */
  }
  const env = typeof import.meta !== 'undefined' ? import.meta.env?.VITE_AVERY_LOCALE : undefined
  return String(env ?? '').trim().toLowerCase() === 'zh' ? 'zh' : 'en'
}

export const useAuth = create<AuthState>((set) => ({
  status: authConfigured() ? 'loading' : 'disabled',
  email: null,
  userId: null,
  busy: 'idle',
  error: null,
  // 未配置 → 探测压根不必发（登录入口本来就不出）；配了 → 首帧 'unknown'，
  // 面板照 disabled 的规格隐藏，直到探测给出确切答案。
  accountCapability: 'unknown',

  // 会话恢复：挂载时跑一次（模块级 guard 幂等，同 initNotifications 的先例）。
  // supabase-js 从 localStorage 读回会话并自动续期，我们只是把结果映射进 store。
  init: () => {
    if (initialized) return
    const sb = getSupabase()
    if (!sb) {
      set({ status: 'disabled' })
      return
    }
    initialized = true
    // 门缝二：与会话恢复并行发起，互不等待——探测的是"这份后端能不能接账号"，
    // 跟"这个人有没有会话"是两件独立的事，谁先回来不影响谁。
    void probeAccountCapability().then((cap) => set({ accountCapability: cap }))
    sb.auth
      .getSession()
      .then(({ data }) => set(applySession(data.session)))
      .catch(() => set({ status: 'guest' })) // 恢复失败 = 当游客，不是当故障
    // 后续会话变化（登录/登出/token 续期）由 Supabase 推过来，token 跟着更新。
    sb.auth.onAuthStateChange((_event, session) => set(applySession(session)))
  },

  signIn: async (email, password) => {
    const sb = getSupabase()
    if (!sb) return
    set({ busy: 'signing-in', error: null })
    try {
      const { data, error } = await sb.auth.signInWithPassword({
        email: email.trim(),
        password,
      })
      if (error) throw error
      set({ ...applySession(data.session), busy: 'idle' })
    } catch (err) {
      set({
        busy: 'idle',
        error: humanizeAuthError(err instanceof Error ? err.message : String(err), localeOf()),
      })
    }
  },

  signOut: async () => {
    const sb = getSupabase()
    if (!sb) return
    set({ busy: 'signing-out', error: null })
    try {
      await sb.auth.signOut()
    } catch {
      // 登出失败也要把本地会话当掉——宁可本地看起来已登出，也不要卡在"登不出去"。
    }
    accessToken = null
    set({ status: 'guest', email: null, userId: null, busy: 'idle' })
  },

  clearError: () => set({ error: null }),
}))

// 门缝：同 __lite2Store 先例，供集成/验收脚本读账号态（产品代码不经 window 读 store）。
if (typeof window !== 'undefined') {
  ;(window as unknown as Record<string, unknown>).__lite2Auth = useAuth
}
