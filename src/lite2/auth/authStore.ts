// feat-053 · 账号状态（注册/登录/登出/会话恢复）—— zustand，与 lite2 其余 store 同族。
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

// disabled  = 这份部署没配 Supabase（游客模式，UI 不出账号入口）
// loading   = 正在恢复会话（首帧，短暂）
// guest     = 配了但没登录 —— 完全可用，只是数据还没归属到账号
// authed    = 已登录
export type AuthStatus = 'disabled' | 'loading' | 'guest' | 'authed'

export type AuthBusy = 'idle' | 'signing-in' | 'signing-up' | 'signing-out'

interface AuthState {
  status: AuthStatus
  email: string | null
  userId: string | null
  busy: AuthBusy
  error: string | null
  // 注册后 Supabase 若开了邮箱验证，会返回 user 但没有 session——必须诚实告诉用户去收信，
  // 绝不做假的"注册成功已登录"态。
  pendingVerification: boolean

  init: () => void
  signUp: (email: string, password: string) => Promise<void>
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

// Supabase 的报错原文是英文且偏技术（"Invalid login credentials"）。给经理看的是人话。
// 只翻译我们真的能识别的几类，其余原样透出——绝不把未知错误粉饰成"操作成功"。
function humanizeAuthError(raw: string, locale: 'en' | 'zh'): string {
  const msg = raw.trim()
  if (locale !== 'zh') return msg
  const lower = msg.toLowerCase()
  if (lower.includes('invalid login credentials')) return '邮箱或密码不对'
  if (lower.includes('email not confirmed')) return '邮箱还没验证，请先去收件箱点确认链接'
  if (lower.includes('user already registered') || lower.includes('already been registered'))
    return '这个邮箱已经注册过了，直接登录'
  if (lower.includes('password should be at least')) return '密码太短了（至少 6 位）'
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
  pendingVerification: false,

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
    sb.auth
      .getSession()
      .then(({ data }) => set(applySession(data.session)))
      .catch(() => set({ status: 'guest' })) // 恢复失败 = 当游客，不是当故障
    // 后续会话变化（登录/登出/token 续期）由 Supabase 推过来，token 跟着更新。
    sb.auth.onAuthStateChange((_event, session) => set(applySession(session)))
  },

  signUp: async (email, password) => {
    const sb = getSupabase()
    if (!sb) return
    set({ busy: 'signing-up', error: null, pendingVerification: false })
    try {
      const { data, error } = await sb.auth.signUp({ email: email.trim(), password })
      if (error) throw error
      // 开了邮箱验证时：有 user、没 session。必须如实说"去收信"，不能假装已登录。
      if (!data.session) {
        set({ busy: 'idle', pendingVerification: true })
        return
      }
      set({ ...applySession(data.session), busy: 'idle' })
    } catch (err) {
      set({
        busy: 'idle',
        error: humanizeAuthError(err instanceof Error ? err.message : String(err), localeOf()),
      })
    }
  },

  signIn: async (email, password) => {
    const sb = getSupabase()
    if (!sb) return
    set({ busy: 'signing-in', error: null, pendingVerification: false })
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
    set({ status: 'guest', email: null, userId: null, busy: 'idle', pendingVerification: false })
  },

  clearError: () => set({ error: null, pendingVerification: false }),
}))

// 门缝：同 __lite2Store 先例，供集成/验收脚本读账号态（产品代码不经 window 读 store）。
if (typeof window !== 'undefined') {
  ;(window as unknown as Record<string, unknown>).__lite2Auth = useAuth
}
