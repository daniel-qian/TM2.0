#!/usr/bin/env node
// #101 · 手工发号：`supabase.auth.admin.createUser` 一步建成**已确认**账号。
//
// ## 它替掉了什么
// #94 建号是两步：anon key 走 signup API → 再 SSH 进生产容器、拿容器的 `AVERY_DB_URL`
// 跑 `UPDATE auth.users SET email_confirmed_at=now()`。`email_confirm: true` 把这两步合成
// 一步，而且**不发确认信**（避免往 `avery.dannyqian.com` 这种没配收件的域名投递）。
// 注册门冻结（#101 ①）之后，前一条路本身也走不通了——`disable_signup` 挡的正是 signup API。
//
// ## 🔴 凭据纪律（三条，一条都不能松）
// 1. **service_role key 只从环境变量进来**，绝不做命令行参数（会进 shell history）、绝不落
//    仓库、绝不进任何 `VITE_*`。它是绕过一切 RLS **和 signup 开关**的万能钥匙——拿到它
//    的人可以给自己建号，冻结注册门对他等于没冻。
//    （前端 bundle 天然够不着：`vite.config.ts` 的 `envPrefix` 只放行我们那几个 `VITE_`
//    变量，verify-bundle-privacy.mjs 守着这条。本脚本住在 `scripts/ops/`，不在 `src/` 里。）
// 2. **密码只在创建那一刻存在一次**——Supabase 库里存的是哈希，后台读不出来。所以建完
//    立刻落 `test-accounts/<公司代号>.md`（整个目录 gitignore，见该目录 README）。
//    已存在的文件**绝不覆盖**：覆盖 = 把某家公司唯一那份密码销毁掉。
// 3. **真实公司账号的创建动作归 Danny 人手**（0805 凭据墙拍板，agent 的口子只覆盖
//    `avery-e2e+*` 测试户）。所以非自测模式会**从 stdin 要一次确认**：人在终端里把公司
//    代号敲回来才继续。非交互环境（agent 的 Bash）读到 EOF 直接中止——这是设计，不是 bug。
//
// ## 跑法
//   # 建一家公司的号（Danny 本机，交互）
//   SUPABASE_SERVICE_ROLE_KEY=<...>  node scripts/ops/create-account.mjs --company hotelA
//
//   # 自测（agent 可跑）：建一个 avery-e2e+* 户 → 真登录验一次 → 删掉，不落任何文件
//   SUPABASE_SERVICE_ROLE_KEY=<...>  node scripts/ops/create-account.mjs --self-test
//
//   # 清理（只认 avery-e2e+*，真实公司账号一律拒绝——销毁类动作留给人）
//   SUPABASE_SERVICE_ROLE_KEY=<...>  node scripts/ops/create-account.mjs --delete avery-e2e+xxx@dannyqian.com
//
// key 也可以放文件里：`SUPABASE_SERVICE_ROLE_KEY_FILE=/path/to/key.txt`（文件内容即 key）。

import { createClient } from '@supabase/supabase-js'
import { randomInt } from 'node:crypto'
import { existsSync, readFileSync, readSync, writeFileSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const OUT_DIR = path.join(ROOT, 'test-accounts')

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://zlxpldzapyoacmgvlqpn.supabase.co'
// 邮箱规范（Danny 0813 定）：`<公司代号>@avery.dannyqian.com`。**自有域名**——`avery.com`
// 是别人的真实域名，往那儿发信是发给陌生人。
const COMPANY_DOMAIN = process.env.AVERY_ACCOUNT_DOMAIN || 'avery.dannyqian.com'
// 测试户走 0805 凭据墙那条口子的**原字面量**：`avery-e2e+*`。别改宽。
const E2E_PREFIX = 'avery-e2e+'
const E2E_DOMAIN = 'dannyqian.com'

// ── 参数 ──────────────────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2)
const flag = (name) => {
  const i = argv.indexOf(name)
  return i >= 0 ? (argv[i + 1] ?? '') : null
}
const has = (name) => argv.includes(name)

const SELF_TEST = has('--self-test')
const DELETE_TARGET = flag('--delete')
const COMPANY = flag('--company')

// 🔴 全脚本**一次 `process.exit()` 都不许调**（2026-08-13 本机实测，Node v24 / Windows）：
// supabase-js 走完一轮真会话之后紧接着 `process.exit(0)`，libuv 会在拆 undici keep-alive
// 句柄的半路上炸 `Assertion failed: !(handle->flags & UV_HANDLE_CLOSING)`，进程**退 127**。
// 也就是说：全绿的自测会以「失败」的退出码收场，谁拿 `$?` 判都会判反。确定性复现，跟脚本
// 自己的逻辑无关。改法是只置 `process.exitCode`、让事件循环自然排空（实测立刻就空，不挂）。
class ExitError extends Error {
  constructor(msg) {
    super(msg)
    this.isExit = true
  }
}
function die(msg) {
  throw new ExitError(msg)
}

// ── service_role key：只从 env / env 指定的文件进来 ────────────────────────────────────
function serviceKey() {
  const file = process.env.SUPABASE_SERVICE_ROLE_KEY_FILE
  const raw = (file ? readFileSync(file, 'utf8') : process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim()
  if (!raw) {
    die(
      'SUPABASE_SERVICE_ROLE_KEY 没设。\n' +
        '  Supabase Dashboard → Project Settings → API keys → service_role（或 sb_secret_*）。\n' +
        '  🔴 只在本机的这一次 shell 里传给它，别写进任何文件（除非用 SUPABASE_SERVICE_ROLE_KEY_FILE\n' +
        '     指一个 gitignore 过的路径），更别做成命令行参数——那会进 shell history。',
    )
  }
  // 🔴 拿 anon/publishable key 来跑是最容易犯的错，而它的表现是一串看不懂的 401/403。
  // 当场判死，比让人去猜强。
  if (raw.startsWith('sb_publishable_')) die('传进来的是 publishable(anon) key，不是 service_role。它建不了号。')
  if (raw.startsWith('eyJ')) {
    try {
      const role = JSON.parse(Buffer.from(raw.split('.')[1], 'base64').toString('utf8')).role
      if (role !== 'service_role') die(`这枚 JWT 的 role 是 "${role}"，不是 service_role。它建不了号。`)
    } catch {
      /* 解不开就放过——形状判据不该比真实调用更严 */
    }
  }
  return raw
}

// 懒建：serviceKey() 会 die()，而 die() 是抛异常——在模块顶层抛出来只会印一堆栈。
// 推迟到主流程的 try 里第一次用到时再建，缺 key 的报错就能走统一的人话出口。
let _sb = null
function sb() {
  if (!_sb) _sb = createClient(SUPABASE_URL, serviceKey(), { auth: { autoRefreshToken: false, persistSession: false } })
  return _sb
}

// ── 密码：24 位强随机，剔掉肉眼易混的 0/O/1/l/I ────────────────────────────────────────
// 剔字符不是为了"更安全"（反而少了几位熵），是因为这串密码会被**人读、人抄、人念**给
// 客户——发出去一个把 l 看成 1 的密码，代价是一通电话。24 位在这个字符集下仍有 ~137 bit。
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789'
function makePassword(len = 24) {
  let out = ''
  for (let i = 0; i < len; i++) out += ALPHABET[randomInt(ALPHABET.length)]
  return out
}

async function createUser(email, password) {
  const { data, error } = await sb().auth.admin.createUser({ email, password, email_confirm: true })
  if (error) throw new Error(`createUser 失败：${error.message}`)
  return data.user
}

async function deleteUser(id) {
  const { error } = await sb().auth.admin.deleteUser(id)
  if (error) throw new Error(`deleteUser 失败：${error.message}`)
}

/** 真登录一次 —— 证明这号**当场就能用**（email_confirm 生效、密码对得上），不是只在库里有一行。 */
async function proveSignIn(email, password) {
  const anon = process.env.SUPABASE_ANON_KEY
  // 没有 anon key 就用 service_role 建一个只用来打 password grant 的客户端：GoTrue 的
  // token 端点认 apikey 头，service_role 一样过得去，验的仍是**真密码**这条。
  const client = anon ? createClient(SUPABASE_URL, anon, { auth: { persistSession: false } }) : sb()
  const { data, error } = await client.auth.signInWithPassword({ email, password })
  if (error) throw new Error(`建完却登不进去：${error.message}`)
  await client.auth.signOut().catch(() => {})
  return data.user?.id
}

// ── 落盘：一家公司一个文件，格式照 test-accounts/README.md ─────────────────────────────
function writeRecord(code, email, password, userId) {
  mkdirSync(OUT_DIR, { recursive: true })
  const out = path.join(OUT_DIR, `${code}.md`)
  // 🔴 绝不覆盖：库里读不出密码，覆盖等于把这家公司唯一那份凭据销毁掉。
  if (existsSync(out)) die(`${out} 已存在。密码在库里读不出来，覆盖它等于销毁——要重建请先人工改名归档。`)
  const today = new Date().toISOString().slice(0, 10)
  writeFileSync(
    out,
    [
      `公司：   <填：公司全名（谁引荐的）>`,
      `账号：   ${email}`,
      `密码：   ${password}`,
      `建于：   ${today}`,
      `建法：   admin.createUser（email_confirm: true，一步建成已确认，不发确认信）`,
      `user_id：${userId}`,
      `成员：   <填：谁在用这个账号>`,
      `档案：   <填：绑定的 context id，客户第一次上传后回填>`,
      `备注：   发出去时说过「直接登录，别点注册」（注册入口 #101 已撤）`,
      ``,
    ].join('\n'),
    'utf8',
  )
  return out
}

/** 逐字节同步读一行 stdin。读不到（EOF / 非 TTY / 被重定向到 null）就返回空串。 */
function readLineSync() {
  const buf = Buffer.alloc(1)
  let line = ''
  for (;;) {
    let n = 0
    try {
      n = readSync(0, buf, 0, 1, null)
    } catch {
      return line // EAGAIN/EOF —— 非交互环境走这里
    }
    if (n <= 0) return line
    const ch = buf.toString('utf8', 0, n)
    if (ch === '\n') return line
    if (ch !== '\r') line += ch
  }
}

/** 非自测模式的人工闸：把公司代号敲回来。非交互（EOF）即中止——这是设计，不是 bug。 */
function confirmByTyping(expect) {
  process.stdout.write(
    `\n🔴 这会在**生产** Supabase 上建一个真账号：${expect}@${COMPANY_DOMAIN}\n` +
      `   真实公司账号的创建动作归 Danny 人手（0805 凭据墙）。\n` +
      `   确认请把公司代号敲一遍（Ctrl-C 取消）: `,
  )
  const typed = readLineSync().trim()
  if (typed !== expect) {
    die(
      typed === ''
        ? '没读到确认（非交互环境即是如此）。agent 只能跑 --self-test；真号请 Danny 在终端里跑。'
        : `敲进来的是 "${typed}"，与 "${expect}" 不符——中止。`,
    )
  }
}

// ══ 主流程 ════════════════════════════════════════════════════════════════════════════
async function doDelete() {
  // 销毁类动作：只认测试户。真实公司账号的删除留给人在后台点——脚本不提供这条路。
  if (!DELETE_TARGET.startsWith(E2E_PREFIX) || !DELETE_TARGET.endsWith(`@${E2E_DOMAIN}`)) {
    die(`--delete 只接受 ${E2E_PREFIX}*@${E2E_DOMAIN} 的测试户。真实账号的删除请人工在 Supabase 后台做。`)
  }
  const { data, error } = await sb().auth.admin.listUsers({ perPage: 1000 })
  if (error) die(`listUsers 失败：${error.message}`)
  const hit = data.users.find((u) => u.email === DELETE_TARGET)
  if (!hit) die(`找不到 ${DELETE_TARGET}（可能已经删过了）。`)
  await deleteUser(hit.id)
  console.log(`✓ 已删除 ${DELETE_TARGET}（${hit.id}）`)
}

async function doSelfTest() {
  // 自测：建 → 真登录 → 删。全程只碰 `avery-e2e+*`，不写 test-accounts/，不留痕。
  const stamp = new Date().toISOString().replace(/[-:T.]/g, '').slice(0, 14)
  const email = `${E2E_PREFIX}mk${stamp}@${E2E_DOMAIN}`
  const password = makePassword()
  console.log(`═══ --self-test · ${email} ═══`)
  let user
  let cleanupFailed = false
  try {
    user = await createUser(email, password)
    console.log(`  [PASS] createUser 成功（id=${user.id}）`)
    console.log(
      `  [${user.email_confirmed_at ? 'PASS' : 'FAIL'}] 一步建成**已确认**（email_confirmed_at=${user.email_confirmed_at ?? 'null'}）`,
    )
    const signedInId = await proveSignIn(email, password)
    console.log(`  [${signedInId === user.id ? 'PASS' : 'FAIL'}] 建完当场就能真登录（同一个 user id）`)
    if (!user.email_confirmed_at || signedInId !== user.id) die('自测判据未全绿——见上。')
  } finally {
    // 🔴 清理放 finally：上面任何一条判据红了都还是要把这个测试户带走，不能在生产
    // auth.users 里留下一行没人认领的东西。
    if (user) {
      await deleteUser(user.id).catch((e) => {
        console.log(`  [FAIL] 删不掉（${e.message}）—— 🔴 生产里留了一行，请人工清`)
        cleanupFailed = true
      })
      // 「清理干净」不能只信 deleteUser 没报错：再问一次列表（销毁类判据要有对照）。
      const { data } = await sb().auth.admin.listUsers({ perPage: 1000 })
      const still = data?.users?.some((u) => u.id === user.id)
      console.log(`  [${still ? 'FAIL' : 'PASS'}] 清理干净（列表里已无此户）`)
      if (still) cleanupFailed = true
    }
  }
  if (cleanupFailed) die('清理未确认——见上。')
  console.log('\n═══ self-test 全绿 · auth.users 零净增 ═══')
}

async function doCreate() {
  if (!/^[a-z0-9][a-z0-9-]{1,30}$/.test(COMPANY)) {
    die(`公司代号只收小写字母/数字/连字符（2–31 位），实得 "${COMPANY}"。它会同时当邮箱前缀和文件名。`)
  }
  const email = `${COMPANY}@${COMPANY_DOMAIN}`
  // 先看文件在不在——建完号才发现文件冲突，密码就已经生出来又没地方记了。
  if (existsSync(path.join(OUT_DIR, `${COMPANY}.md`))) {
    die(`test-accounts/${COMPANY}.md 已存在（这家公司已经发过号）。先人工归档再重建。`)
  }
  confirmByTyping(COMPANY)

  const password = makePassword()
  const user = await createUser(email, password)
  if (!user.email_confirmed_at) {
    die(`建出来了但不是已确认态（email_confirm 没生效）——user id ${user.id}，请人工检查。`)
  }
  await proveSignIn(email, password)
  const out = writeRecord(COMPANY, email, password, user.id)
  console.log(`\n✓ ${email} 已建成（已确认态，真登录验过一次）`)
  console.log(`✓ 凭据已落 ${out} —— 🔴 密码只在这一刻存在过一次，别丢`)
  console.log(`\n发号话术（必带）：用这个邮箱和密码**直接登录**。（注册入口已撤，#101）`)
}

try {
  if (DELETE_TARGET) await doDelete()
  else if (SELF_TEST) await doSelfTest()
  else if (COMPANY) await doCreate()
  else die('要么 --company <公司代号>，要么 --self-test，要么 --delete <avery-e2e+*@dannyqian.com>。')
} catch (err) {
  console.error(`\n✗ ${err instanceof Error ? err.message : String(err)}\n`)
  if (!err?.isExit) console.error(err)
  // 🔴 只置 exitCode，不调 process.exit —— 理由见 ExitError 上方那段（Windows 上会退 127）。
  process.exitCode = 1
}
