#!/usr/bin/env node
// fixB · UploadPanel 的**浏览器**行为验证（M4 文件状态可见 / M3 accept 列表 / B1 全链路）
//
// 为什么必须真跑浏览器：M4 的整条 finding 就是「界面和读全了的文件长得一模一样」。
// typecheck/build/lint 三道门对"用户看不看得见"这件事一个字都说不出来。这里真起后端、真起
// 前端、真传一份 GB18030 花名册 + 一份读不出来的文件，然后看**屏幕上**有没有那句话。
//
// 跑法（端口刻意避开集成方在用的 5173/8137）：
//   1) cd eval-harness && AVERY_BRAIN=stub AVERY_CORS_ORIGINS=http://127.0.0.1:5302 \
//        python -m uvicorn service.app:app --port 8302
//   2) VITE_AVERY_API_BASE=http://127.0.0.1:8302 npx vite --port 5302 --strictPort
//   3) node .issues/v02-partner-align-0718/verify-fixB-upload-ui.mjs
//
// 退出码 0 = 全过；非 0 = 有 FAIL。

import { chromium } from 'playwright'

const BASE = process.env.VERIFY_BASE || 'http://127.0.0.1:5302'
const results = []

function check(name, pass, detail) {
  results.push({ name, pass })
  console.log(`  [${pass ? 'PASS' : 'FAIL'}] ${name}${detail ? ' — ' + detail : ''}`)
}

// 🔴 缺元素时返回 null 而不是抛：一条 check 失败不该让后面所有 check 都跑不成。
// 在旧代码上跑红时这尤其重要 —— 那正是元素成批缺席的场景，而我们要看的恰恰是"缺了哪些"。
async function textOf(page, selector) {
  const el = page.locator(selector).first()
  return (await el.count()) === 0 ? null : await el.textContent()
}

// 「姓名,职位,团队 / 张伟,产品经理,产品组 / 李娜,… / 王芳,…」以 **GB18030** 编码后的字节。
// 🔴 写成字节数组而不是字符串：Node 只能产 UTF-8，而这条 test 的全部意义就在于这些字节
// **不是** UTF-8 —— 中文 Windows 上 Excel 存 CSV、记事本存「ANSI」出来的就是这些字节，
// 也就是三家客户里两家最可能的上传方式。
const GBK_ROSTER = Uint8Array.from([
  208, 213, 195, 251, 44, 214, 176, 206, 187, 44, 205, 197, 182, 211, 10, 213, 197, 206, 176, 44,
  178, 250, 198, 183, 190, 173, 192, 237, 44, 178, 250, 198, 183, 215, 233, 10, 192, 238, 196, 200,
  44, 186, 243, 182, 203, 185, 164, 179, 204, 202, 166, 44, 198, 189, 204, 168, 215, 233, 10, 205,
  245, 183, 188, 44, 201, 232, 188, 198, 202, 166, 44, 178, 250, 198, 183, 215, 233, 10,
])

// 任何候选编码都解不出来的字节（cp1252 未定义的那几个 + 孤立的 GB18030 首字节）。
const UNDECODABLE = Uint8Array.from(
  Array.from({ length: 4 }, () => [0x80, 0x81, 0x8d, 0x90, 0x9d, 0xff, 0xfe, 0x81]).flat(),
)

async function run() {
  const browser = await chromium.launch({ headless: true })
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 1000 } })
  const page = await ctx.newPage()
  const consoleErrors = []
  page.on('console', (m) => {
    if (m.type() === 'error') consoleErrors.push(m.text())
  })
  page.on('pageerror', (e) => consoleErrors.push('pageerror: ' + e.message))

  await page.goto(`${BASE}/?v=2&mode=live&look=paper&lang=zh`, { waitUntil: 'networkidle' })

  // 首访向导的弹层会挡住上传面板的一切点击。
  if ((await page.locator('.lite-onboard').count()) > 0) {
    await page.keyboard.press('Escape')
    await page.waitForTimeout(600)
  }

  // ── M3 · accept 列表不许含后端不支持的类型 ────────────────────────────────────────────
  const accept = await page.locator('.upload-panel input[type=file]').first().getAttribute('accept')
  check(
    'M3 · accept 不再含后端不支持的 .doc/.xls',
    accept !== null && !/\.doc(,|$)/.test(accept) && !/\.xls(,|$)/.test(accept),
    `accept="${accept}"`,
  )
  const extsLine = await textOf(page, '.upload-accepted-exts')
  check(
    'M3 · 界面逐个列出真正支持的扩展名',
    !!extsLine && extsLine.includes('.docx') && extsLine.includes('.xlsx') && extsLine.includes('.csv'),
    JSON.stringify(extsLine),
  )
  const legacyLine = await textOf(page, '.upload-accepted-legacy')
  check(
    'M3 · 旧格式 .doc/.xls 怎么办有明说（不让用户猜）',
    !!legacyLine && legacyLine.includes('.doc') && legacyLine.includes('.xls'),
    JSON.stringify(legacyLine),
  )

  // ── B1 + M4 · 真传一份 GB18030 花名册 + 一份读不出来的文件 ─────────────────────────────
  // 混批是关键：整批失败会走 422 错误态，根本看不到清单。只有混批能证明"读进去的"和
  // "没读进去的"在**同一张清单上长得不一样**。
  await page.locator('.upload-panel input[type=file]').first().setInputFiles([
    { name: '员工花名册.csv', mimeType: 'text/csv', buffer: Buffer.from(GBK_ROSTER) },
    { name: '坏文件.csv', mimeType: 'text/csv', buffer: Buffer.from(UNDECODABLE) },
  ])

  try {
    await page.waitForSelector('.upload-files-list .upload-file-row', { timeout: 180000 })
  } catch {
    check('清单里出现了上传过的文件', false, '等不到 .upload-file-row —— 上传本身失败了？')
  }
  await page.waitForTimeout(1500)

  const rows = await page.locator('.upload-files-list .upload-file-row').evaluateAll((els) =>
    els.map((el) => ({
      name: el.querySelector('.upload-file-name')?.textContent ?? '',
      status: el.getAttribute('data-status'),
      statusText: el.querySelector('.upload-file-status')?.textContent ?? '',
      hint: el.querySelector('.upload-file-status-hint')?.textContent ?? '',
      tone: el.querySelector('.upload-file-status')?.getAttribute('data-tone') ?? '',
    })),
  )
  console.log('    rows: ' + JSON.stringify(rows))

  const good = rows.find((r) => r.name.includes('员工花名册'))
  const bad = rows.find((r) => r.name.includes('坏文件'))

  // B1：GB18030 花名册真的被读进去了 —— 屏幕上真的长出了那三个人。
  const bodyText = await page.locator('body').innerText()
  const namesOnScreen = ['张伟', '李娜', '王芳'].filter((n) => bodyText.includes(n))
  check(
    'B1 · GB18030 花名册在真浏览器里长出了人',
    namesOnScreen.length === 3,
    `屏幕上找到 ${JSON.stringify(namesOnScreen)}`,
  )

  check('M4 · 读进去的文件标 ingested', good?.status === 'ingested', JSON.stringify(good))
  check('M4 · 没读进去的文件标 failed', bad?.status === 'failed', JSON.stringify(bad))
  check(
    'M4 · 两者在屏幕上**看得出不同**（这才是整条 finding）',
    !!good && !!bad && good.statusText !== bad.statusText && good.statusText.length > 0,
    `ingested="${good?.statusText}" vs failed="${bad?.statusText}"`,
  )
  check(
    'M4 · 失败的那份给了可执行的解释（提到编码）',
    !!bad && bad.hint.length > 0 && bad.hint.includes('编码'),
    JSON.stringify(bad?.hint),
  )
  check(
    'M4 · 失败态与成功态色调不同',
    good?.tone === 'ok' && bad?.tone === 'bad',
    `${good?.tone} vs ${bad?.tone}`,
  )

  check('无 console 报错', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | '))

  await browser.close()
  const failed = results.filter((r) => !r.pass)
  console.log(`\n${results.length - failed.length}/${results.length} passed`)
  process.exit(failed.length === 0 ? 0 : 1)
}

run().catch((e) => {
  console.error(e)
  process.exit(1)
})
