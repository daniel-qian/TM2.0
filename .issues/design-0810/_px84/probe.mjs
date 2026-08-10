// #84 探针：手机态文件行的**实测**几何（包含块/裁剪/落位一律实测，不读码推断）。
// 用法: VERIFY_BASE=http://127.0.0.1:5284 node .issues/design-0810/_px84/probe.mjs [width] [height]
import { chromium } from 'playwright'
import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const UI = process.env.VERIFY_BASE || 'http://127.0.0.1:5284'
const W = Number(process.argv[2] || 390)
const H = Number(process.argv[3] || 844)
const HERE = dirname(fileURLToPath(import.meta.url))
const SEED_DIR = join(HERE, '..', '..', '..', 'eval-harness', 'tests', 'fixtures', 'demo-seed')
const seedFiles = () =>
  readdirSync(SEED_DIR).filter((n) => n.endsWith('.md')).sort().slice(0, 3)
    .map((n) => ({ name: n, mimeType: 'text/markdown', buffer: readFileSync(join(SEED_DIR, n)) }))

const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: W, height: H } })
const page = await ctx.newPage()
await page.goto(`${UI}/?v=2&mode=live&look=paper&lang=zh`, { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(800)
await page.keyboard.press('Escape').catch(() => {})
await page.evaluate(() => window.__lite2Store.getState().goScreen('files'))
await page.waitForTimeout(300)
await page.locator('input.upload-input').setInputFiles(seedFiles())
await page.locator('.upload-ready, .upload-error').first().waitFor({ timeout: 90000 })
await page.waitForTimeout(600)

const out = await page.evaluate(() => {
  const pick = (el, props) => {
    const cs = getComputedStyle(el)
    const o = {}
    for (const p of props) o[p] = cs.getPropertyValue(p)
    return o
  }
  const rows = [...document.querySelectorAll('.upload-file-row')]
  const list = document.querySelector('.upload-files-list')
  return {
    list: list && {
      rect: list.getBoundingClientRect().toJSON(),
      css: pick(list, ['display', 'position', 'overflow-y', 'height', 'gap', 'flex-direction']),
    },
    rowCount: rows.length,
    rows: rows.slice(0, 4).map((r) => ({
      rect: r.getBoundingClientRect().toJSON(),
      css: pick(r, ['display', 'position', 'grid-template-columns', 'grid-template-rows',
        'min-height', 'height', 'row-gap', 'column-gap', 'padding-top', 'align-items']),
      cells: [...r.children].map((c) => ({
        cls: c.className,
        rect: c.getBoundingClientRect().toJSON(),
        col: getComputedStyle(c).gridColumnStart + '/' + getComputedStyle(c).gridColumnEnd,
        row: getComputedStyle(c).gridRowStart + '/' + getComputedStyle(c).gridRowEnd,
      })),
    })),
  }
})
console.log(JSON.stringify(out, null, 1))
await browser.close()
