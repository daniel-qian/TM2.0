// #91 · 新 UI 态手拍（人眼过图用，非门）。跑法：
//   VERIFY_BASE=http://127.0.0.1:5291 node .issues/ingest-root-cause-0812/_mut91/shot91.mjs
// 产物落 .issues/ingest-root-cause-0812/_shots-91/。
//
// 拍的全是**真实态**（不 route 造假）：
//   1. reading-*.png     —— 9 份 seed 一次补传，轮询窗口里表格长出「正在读取…」行
//                           （窗口 1~3s，100ms 抢拍；抢不到就如实报错退出，别拿旧态凑数）。
//   2. ingesting-*.png   —— 同一窗口的上传进度块（新 ingestingHint 文案在场）。
//   3. skipped-*.png     —— 同字节再传一发 → sha256 幂等 → ready 态带「已经有了」行。
//   4. onboard-idle.png  —— 闸门①上传步的空闲态（新 onboardUploadBody 多选引导文案）。
import { chromium } from 'playwright'
import { mkdirSync, readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const UI = process.env.VERIFY_BASE || 'http://127.0.0.1:5291'
const HERE = dirname(fileURLToPath(import.meta.url))
const OUT = join(HERE, '..', '_shots-91')
const SEED_DIR = join(HERE, '..', '..', '..', 'eval-harness', 'tests', 'fixtures', 'demo-seed')
mkdirSync(OUT, { recursive: true })

const seeds = readdirSync(SEED_DIR).filter((n) => n.endsWith('.md')).sort()
  .map((n) => ({ name: n, text: readFileSync(join(SEED_DIR, n), 'utf8') }))

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })

const evalUpload = (files, action) => page.evaluate(({ files, action }) => {
  const enc = new TextEncoder()
  // 刻意不 await：要的就是进行中的窗口
  void window.__lite2Store.getState()[action](
    files.map((f) => new File([enc.encode(f.text)], f.name, { type: 'text/markdown' })))
}, { files, action })

const settle = (key) => page.waitForFunction(
  (k) => ['ready', 'error'].includes(window.__lite2Store.getState()[k]), key, { timeout: 90000 })

// ── 0 · 开档（首传一份，落 context）────────────────────────────────────────────────────
await page.goto(`${UI}/?v=2&mode=live&look=paper&lang=zh`, { waitUntil: 'networkidle' })
// 闸门①空闲态先拍（有闸门才拍得到；没有就跳过）
if (await page.locator('.lite-onboard').count()) {
  await page.screenshot({ path: join(OUT, 'onboard-idle.png') })
  await page.keyboard.press('Escape')
  await page.waitForTimeout(400)
}
await evalUpload([seeds[0]], 'uploadFiles')
await settle('ingestStatus')

// ── 1/2 · 大批补传，抢拍 reading 行 + 进度块 ───────────────────────────────────────────
await page.goto(`${UI}/files?v=2&mode=live&look=paper&lang=zh`, { waitUntil: 'networkidle' })
await evalUpload(seeds.slice(1), 'appendFiles')
let caught = false
for (let i = 0; i < 100; i += 1) {
  if (await page.locator("[data-status='reading']").count()) { caught = true; break }
  await page.waitForTimeout(100)
}
if (!caught) {
  console.error('没抢到 reading 窗口——worker 太快；换更大的语料再试，别拿旧态凑数')
  process.exit(1)
}
await page.screenshot({ path: join(OUT, 'reading-paper-desktop.png') })
await settle('appendStatus')
await page.waitForTimeout(600)
await page.screenshot({ path: join(OUT, 'ready-paper-desktop.png') })

// aurora 皮 + 手机视口的 reading 态（再补传一批不同字节）
const salted = seeds.slice(1, 6).map((s, i) => ({ name: `二批-${s.name}`, text: `${s.text}\n备注：二批${i}` }))
await page.goto(`${UI}/files?v=2&mode=live&look=aurora&lang=zh`, { waitUntil: 'networkidle' })
await evalUpload(salted, 'appendFiles')
caught = false
for (let i = 0; i < 100; i += 1) {
  if (await page.locator("[data-status='reading']").count()) { caught = true; break }
  await page.waitForTimeout(100)
}
if (caught) await page.screenshot({ path: join(OUT, 'reading-aurora-desktop.png') })
else console.error('aurora 那发没抢到 reading 窗口（非致命，paper 已有）')
await settle('appendStatus')

const mob = await browser.newPage({ viewport: { width: 390, height: 844 } })
await mob.goto(`${UI}/files?v=2&mode=live&look=paper&lang=zh`, { waitUntil: 'networkidle' })
const salted2 = seeds.slice(1, 6).map((s, i) => ({ name: `三批-${s.name}`, text: `${s.text}\n备注：三批${i}` }))
await mob.evaluate(({ files }) => {
  const enc = new TextEncoder()
  void window.__lite2Store.getState().appendFiles(
    files.map((f) => new File([enc.encode(f.text)], f.name, { type: 'text/markdown' })))
}, { files: salted2 })
caught = false
for (let i = 0; i < 100; i += 1) {
  if (await mob.locator("[data-status='reading']").count()) { caught = true; break }
  await mob.waitForTimeout(100)
}
if (caught) await mob.screenshot({ path: join(OUT, 'reading-paper-mobile.png') })
else console.error('手机那发没抢到 reading 窗口（非致命）')
await mob.waitForFunction(
  () => ['ready', 'error'].includes(window.__lite2Store.getState().appendStatus), null, { timeout: 90000 })
await mob.close()

// ── 3 · 同字节重传 → skipped_identical 行 ──────────────────────────────────────────────
await page.goto(`${UI}/files?v=2&mode=live&look=paper&lang=zh`, { waitUntil: 'networkidle' })
await evalUpload([seeds[1]], 'appendFiles')
await settle('appendStatus')
await page.waitForTimeout(600)
const skippedLine = await page.locator('.upload-skipped-identical').count()
await page.screenshot({ path: join(OUT, 'skipped-identical-paper.png') })
console.log(`skipped_identical 行在场=${skippedLine === 1}（截图无论如何都拍了，人眼对照）`)

await browser.close()
console.log(`shots → ${OUT}`)
