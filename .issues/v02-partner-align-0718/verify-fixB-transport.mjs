#!/usr/bin/env node
// fixB · transport.ts 的行为回归（M2 上限文案 / B1 编码诊断透传 / m5 裸 fetch 收口）
//
// 为什么是这种形态：本仓没有 vitest，前端只有 typecheck/build/lint 三道门，而这三道门**证明不了
// 任何一条行为**——「413 里不再复述写死的上限」「服务端的编码诊断真的走到用户眼前」都是行为。
// 所以这里用仓里已装的 typescript 把 transport.ts 现场转成 JS，塞掉它唯一的外部依赖
//（auth/authStore，会一路拉起 supabase），然后当普通模块 import 进来真调。
//
// 🔴 不是 grep 断言：下面每一条都真的构造 Response、真的 await 那个函数、真的看返回的字符串。
//
// 跑法： node .issues/v02-partner-align-0718/verify-fixB-transport.mjs
// 退出码 0 = 全过；非 0 = 有 FAIL。

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import ts from 'typescript'

const here = path.dirname(fileURLToPath(import.meta.url))
const repo = path.resolve(here, '../..')
const src = path.join(repo, 'src/lite2/transport.ts')

// authStore 只被用来取 access_token；换成一个永远未登录的桩，其余代码路径原样。
const AUTH_STUB = 'data:text/javascript,export function currentAccessToken(){return null}'

const transpiled = ts.transpileModule(
  readFileSync(src, 'utf8').replace(/from '\.\/auth\/authStore'/, `from '${AUTH_STUB}'`),
  { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } },
).outputText

const mod = await import(
  'data:text/javascript;base64,' + Buffer.from(transpiled, 'utf8').toString('base64')
)

const results = []
function check(name, pass, detail) {
  results.push({ name, pass })
  console.log(`  [${pass ? 'PASS' : 'FAIL'}] ${name}${detail ? ' — ' + detail : ''}`)
}

// 造一个够真的 Response：httpErrorMessage 读 status / headers，withServerDetail 读 json()。
function fakeResponse(status, body, headers = {}) {
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: { get: (k) => headers[k] ?? headers[k.toLowerCase()] ?? null },
    json: async () => {
      if (body === undefined) throw new Error('no body')
      return body
    },
  }
}

// ── M2 · 413 不许再复述任何上限数字 ─────────────────────────────────────────────────────
// 旧文案：「the server caps 10 files, 10MB each」——两个数字都是错的（真值 15 个 / 8 MiB），
// 而且单文件那个比真上限还大，用户照着它压到 10MB 重试永远失败。
{
  const msg = mod.httpErrorMessage('ingest', fakeResponse(413))
  check(
    'M2 · 413 文案不再写死「10 files / 10MB」',
    !/10\s*files/i.test(msg) && !/10\s*MB/i.test(msg),
    JSON.stringify(msg),
  )
  check(
    'M2 · 413 文案不自带任何上限数字（真值只归服务端）',
    !/\d+\s*(MB|KB|GB|files)/i.test(msg),
    JSON.stringify(msg),
  )
}

// ── M2 · 服务端说的真上限要原样带到用户眼前 ─────────────────────────────────────────────
{
  const msg = await mod.withServerDetail(
    'ingest',
    fakeResponse(413, {
      detail: { error: 'file too large', detail: "'预算.xlsx' is bigger than the 8 MB per-file limit." },
    }),
  )
  check(
    'M2 · 413 转达服务端的真实上限（8 MB，来自 guards.max_file_bytes）',
    msg.includes('8 MB per-file limit'),
    JSON.stringify(msg),
  )
}
{
  // ASGI 中间件走的是平铺 {error, detail}，不是 FastAPI 的 {detail:{...}}。两种都要认。
  const msg = await mod.withServerDetail(
    'ingest',
    fakeResponse(413, { error: 'upload too large', detail: 'this upload is 45 MB — the limit is 32 MB per upload.' }),
  )
  check(
    'M2 · 中间件的平铺 body 也能读出来',
    msg.includes('the limit is 32 MB per upload'),
    JSON.stringify(msg),
  )
}

// ── B1 · 编码诊断必须走到界面上 ─────────────────────────────────────────────────────────
// 这是 GBK 花名册的用户唯一的自救线索。被压成一句笼统的「that file type isn't accepted」，
// 用户就会以为 Avery 读不懂中文。
{
  const msg = await mod.withServerDetail(
    'ingest',
    fakeResponse(422, {
      detail: {
        error: 'upload rejected',
        reason: 'no parseable content in the upload',
        parse_errors: [
          "could not read '员工花名册.csv' as text: its bytes are not valid in any encoding we try " +
            "(utf-8, gb18030, big5, cp1252). It is most likely saved in a different character " +
            "encoding — re-save it as UTF-8 (in Excel: 'CSV UTF-8') and upload it again.",
        ],
      },
    }),
  )
  check('B1 · 422 里带出服务端的编码诊断', /encoding/i.test(msg), JSON.stringify(msg).slice(0, 220))
  check('B1 · 诊断里带着可执行的自救办法（另存 UTF-8）', /UTF-8/.test(msg), '')
  check('B1 · 出问题的文件名也带出来了', msg.includes('员工花名册.csv'), '')
}

// ── 兜底纪律：读 body 失败绝不能把错误升级 ───────────────────────────────────────────────
{
  const msg = await mod.withServerDetail('ingest', fakeResponse(500, undefined))
  check(
    '兜底 · body 读不出来时安静退回基础文案',
    typeof msg === 'string' && msg.includes('500'),
    JSON.stringify(msg),
  )
}
{
  const long = 'x'.repeat(5000)
  const msg = await mod.withServerDetail('ingest', fakeResponse(422, { detail: long }))
  check('兜底 · 超长 detail 被截断（不许一屏红字）', msg.length < 600, `len=${msg.length}`)
}

// ── m5 · 账号端点不再是裸 fetch ─────────────────────────────────────────────────────────
// 行为判据：fetch 自己 reject（跨境/离线/混合内容拦截）时，裸 fetch 会把浏览器原文
// `Failed to fetch` 抛给用户；走 send() 包装后必须是我们的人话文案。
{
  const realFetch = globalThis.fetch
  globalThis.fetch = async () => {
    throw new TypeError('Failed to fetch')
  }
  const t = mod.createHttpTransport('http://127.0.0.1:9')
  let contextsErr = null
  let claimErr = null
  try {
    await t.fetchAccountContexts()
  } catch (e) {
    contextsErr = e.message
  }
  try {
    await t.claimContext('ctx_x', 'tok_y')
  } catch (e) {
    claimErr = e.message
  }
  globalThis.fetch = realFetch

  check(
    'm5 · /account/contexts 断网时给人话，不是 `Failed to fetch`',
    contextsErr !== null && !/Failed to fetch/.test(contextsErr) && /couldn't reach the server/i.test(contextsErr),
    JSON.stringify(contextsErr),
  )
  check(
    'm5 · /account/claim 断网时给人话，不是 `Failed to fetch`',
    claimErr !== null && !/Failed to fetch/.test(claimErr) && /couldn't reach the server/i.test(claimErr),
    JSON.stringify(claimErr),
  )
}

const failed = results.filter((r) => !r.pass)
console.log(`\n${results.length - failed.length}/${results.length} passed`)
process.exit(failed.length === 0 ? 0 : 1)
