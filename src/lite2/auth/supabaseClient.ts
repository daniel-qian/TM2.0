// feat-053 · Supabase 客户端（懒建、可缺席）—— 账号体系的唯一外部依赖点。
//
// 🔴 本模块最重要的性质：**没配置也必须能跑**。
// VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY 任一缺失 → getSupabase() 返回 null，
// 整个账号层进入 'disabled'，UI 不出登录入口，应用照常当游客用。
// 另外 7 条线和 Danny 都靠 `?v=2&mode=live&skin=paper&lang=zh` 这条直链进 v02 验证——
// 把 demo 挡在登录墙后面这条线就作废了，所以"缺 key 即降级"是硬要求，不是兜底。
//
// 🔴 key 绝不硬编码：只从 import.meta.env 读，值进 .env.local（gitignored）。
// anon key 按设计就是公开的（它会被打进浏览器 bundle），真正的权限边界在后端：
// owner_token（feat-038）+ avery.account_contexts 映射（feat-053 migration 0008）。
//
// 会话持久化交给 supabase-js 自己（localStorage + 自动续期），我们不自己存 token——
// 自己存 = 自己造轮子 + 自己承担续期/失效的 bug。

import { createClient, type SupabaseClient } from '@supabase/supabase-js'

function env(key: string): string | undefined {
  const raw = typeof import.meta !== 'undefined' ? import.meta.env?.[key] : undefined
  const v = raw == null ? '' : String(raw).trim()
  return v || undefined
}

export function supabaseUrl(): string | undefined {
  return env('VITE_SUPABASE_URL')
}

export function supabaseAnonKey(): string | undefined {
  return env('VITE_SUPABASE_ANON_KEY')
}

// 这份部署到底有没有账号能力。false → UI 不显示登录入口（不做"点了必然失败"的假按钮）。
export function authConfigured(): boolean {
  return Boolean(supabaseUrl() && supabaseAnonKey())
}

let client: SupabaseClient | null = null
let tried = false

// 懒建单例：未配置 → null（不抛）。createClient 本身失败（URL 畸形等）也吞成 null——
// 账号层出问题只许降级成游客，绝不许把应用打崩。
export function getSupabase(): SupabaseClient | null {
  if (tried) return client
  tried = true
  const url = supabaseUrl()
  const key = supabaseAnonKey()
  if (!url || !key) return (client = null)
  try {
    client = createClient(url, key, {
      auth: {
        persistSession: true, // 会话恢复：刷新/重开浏览器仍登录（supabase-js 自己管 localStorage）
        autoRefreshToken: true,
        detectSessionInUrl: false, // 本波只做邮箱+密码，不做 OAuth 回调 → 不需要解析 URL 片段
      },
    })
  } catch {
    client = null
  }
  return client
}

// 测试/热重载用的复位钩子（产品路径不调用）。
export function __resetSupabaseForTest(): void {
  client = null
  tried = false
}
