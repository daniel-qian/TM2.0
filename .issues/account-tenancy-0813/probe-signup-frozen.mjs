#!/usr/bin/env node
// #101 · 「注册真的关了吗」的**活体**探针 —— 打真 Supabase，不进任何电池。
//
// ## 为什么单独一支，而不是塞进 verify-auth-form
// `verify-auth-form.mjs` 整条 Supabase 链路是 `page.route` 伪造的。在那里断言「直连 signup
// 拿到的是真错误」，等于让被测对象自己写答案（碑：**判据的期望值不许由被测函数算出来**、
// **尺子长在被量的东西上**）。前端撤入口是第二层，**唯一的真闸是 Supabase 后台的
// `disable_signup`**——它只能被真网络问出来，而且只有 Danny 能点。
//
// ## 三条判据
//   ① `GET /auth/v1/settings` 的 `disable_signup === true`  —— 真闸的直接读数
//   ② 真实 `POST /auth/v1/signup` 拿到 **4xx**              —— 真错误
//   ③ 那个响应体里**没有** user id / access_token          —— 不是 #94 那份「200 + 假成功」
//
// ## 🔴 为什么它不可能建出账号来
// ②③ **只在 ① 为真时才跑**。①为假（signup 还开着）时脚本直接判红收工——那正是「一次真实
// signup 会真的建出一个用户」的世界，一个请求都不发。判据的安全性由判据本身守着，不靠人记得。
//
// ## 跑法
//   node .issues/account-tenancy-0813/probe-signup-frozen.mjs
// anon（publishable）key 默认从**线上 bundle 自己抠**——它本来就发给每一个浏览器，不是凭据；
// 抠它而不是让人手贴，是为了「探针问的就是客户浏览器手里那把钥匙」。
// 覆盖用环境变量：SUPABASE_URL / SUPABASE_ANON_KEY / APP_BASE。
//
// ⚠ 需要公网。**不进 `./init.sh`、不进离线电池、不进 run-battery** —— 断网时它只会假红。

const APP_BASE = process.env.APP_BASE || 'https://averylite.dannyqian.com'
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://zlxpldzapyoacmgvlqpn.supabase.co'

const R = []
const rec = (n, ok, d) => {
  R.push({ n, ok })
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${n}${d ? ' — ' + d : ''}`)
}

// 从生产 index bundle 抠出 publishable key（`sb_publishable_*`，07-20 起用的那种）。
// 抠不到就红：那本身是个该知道的事实（key 没进构建 / bundle 换形状了）。
async function anonKeyFromBundle() {
  const idx = await fetch(`${APP_BASE}/`).then((r) => r.text())
  const asset = idx.match(/src="([^"]+\.js)"/)?.[1]
  if (!asset) throw new Error(`index 里找不到 js 入口：${APP_BASE}`)
  const js = await fetch(new URL(asset, APP_BASE)).then((r) => r.text())
  const key = js.match(/sb_publishable_[A-Za-z0-9_-]+/)?.[0]
  if (!key) throw new Error(`bundle ${asset} 里找不到 sb_publishable_* key`)
  return key
}

const anonKey = process.env.SUPABASE_ANON_KEY || (await anonKeyFromBundle())

console.log(`═══ #101 注册门活体探针 · ${SUPABASE_URL} ═══`)

// ── ① 真闸读数 ────────────────────────────────────────────────────────────────────────
const settingsRes = await fetch(`${SUPABASE_URL}/auth/v1/settings`, { headers: { apikey: anonKey } })
const settings = await settingsRes.json().catch(() => ({}))
const frozen = settings.disable_signup === true
rec(
  '🔴 ① Supabase 后台 disable_signup === true（唯一的真闸，只有 Danny 能点）',
  frozen,
  `HTTP ${settingsRes.status} · disable_signup=${JSON.stringify(settings.disable_signup)}`,
)

// ── ②③ 只在真闸已关时才发这一枪 ────────────────────────────────────────────────────────
if (!frozen) {
  console.log(
    '\n  ⏭ ②③ 跳过：真闸还开着 —— 这时一次真实 signup 会**真的建出一个用户**。\n' +
      '     前端已撤入口（verify-auth-form ④ 段守着），但那只是化妆；请 Danny 去\n' +
      '     Supabase Dashboard → Authentication → Sign In / Providers → 关掉 "Allow new users to sign up"。',
  )
} else {
  // 真闸已关 → 这一枪不可能建出账号，可以放心打真的。
  const probeEmail = `avery-e2e+signup-frozen-probe@dannyqian.com`
  const res = await fetch(`${SUPABASE_URL}/auth/v1/signup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: anonKey },
    body: JSON.stringify({ email: probeEmail, password: 'probe-only-never-created-000' }),
  })
  const body = await res.json().catch(() => ({}))
  rec('🔴 ② 直连 /auth/v1/signup 拿到真错误（4xx），不是 200', res.status >= 400 && res.status < 500, `HTTP ${res.status}`)
  // #94 那份假成功长这样：200 + 顶层 `id`（假 user id）+ `confirmation_sent_at`。
  // 判它没有 id / access_token，就是判「这不是那份假成功」。
  const looksLikeFakeSuccess = Boolean(body?.id || body?.user?.id || body?.access_token)
  rec(
    '🔴 ③ 响应体里没有 user id / access_token（不是 #94 那份「200 + 假成功」）',
    !looksLikeFakeSuccess,
    JSON.stringify(body).slice(0, 200),
  )
}

const pass = R.filter((r) => r.ok).length
const fail = R.length - pass
console.log(`\n═══ probe-signup-frozen：${pass} PASS · ${fail} FAIL ═══`)
if (fail) for (const r of R.filter((x) => !x.ok)) console.log(`  ✗ ${r.n}`)
process.exit(fail ? 1 : 0)
