// 计算值探针：本票规格的每一条都在屏上量一遍（读码推断在 CSS 上不可信，本仓已立三次碑）。
import { chromium } from 'playwright'

const UI = process.env.VERIFY_BASE || 'http://127.0.0.1:5283'
const ROSTER = ['# 别墅酒店 员工花名册', '', '姓名 | 人员ID | 部门 | 职位 | 司龄',
  '周雅婷 | MKT-001 | 市场推广部 | 市场专员 | 3年'].join('\n')
const NOW = '2026-08-10T14:20:00+08:00'
const SPEC = [
  { q: '本周前厅部的排班有没有明显缺口？', at: '2026-08-10T11:40:00+08:00', n: 2 },
  { q: '婚宴那单的对接人现在是谁？', at: '2026-08-10T09:08:00+08:00', n: 1 },
  { q: '旺季排班协调会上定了哪几件事', at: '2026-08-07T16:44:00+08:00', n: 1 },
]
const payload = (id) => ({ context_id: id, threads: SPEC.map((t, i) => ({
  thread_id: `thr_${i}0abcdef`,
  runs: Array.from({ length: t.n }, (_, k) => ({
    id: `run_${i}_${k}`,
    created_at: new Date(new Date(t.at).getTime() - (t.n - 1 - k) * 6e4).toISOString(),
    question: t.q, title: '', locale: 'zh', advice: null, answer: 'x',
    thread_id: `thr_${i}0abcdef`,
  })) })) })

const browser = await chromium.launch()
for (const look of ['paper', 'aurora']) {
  for (const vp of [{ n: 'desktop', width: 1440, height: 900 }, { n: 'mobile', width: 390, height: 844 }]) {
    const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height } })
    const page = await ctx.newPage()
    await page.clock.setFixedTime(new Date(NOW))
    await page.route('**/advise-threads', async (route) => {
      const id = decodeURIComponent(new URL(route.request().url()).pathname.split('/').at(-2))
      await route.fulfill({ status: 200, headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload(id)) })
    })
    await page.goto(`${UI}/?v=2&mode=live&look=${look}&lang=zh`, { waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(900)
    await page.keyboard.press('Escape').catch(() => {})
    await page.waitForTimeout(300)
    await page.evaluate(async (text) => {
      const enc = new TextEncoder()
      await window.__lite2Store.getState().uploadFiles([new File([enc.encode(text)], '花名册.md', { type: 'text/markdown' })])
    }, ROSTER)
    await page.waitForFunction(() => ['ready', 'error'].includes(window.__lite2Store.getState().ingestStatus), null, { timeout: 60000 }).catch(() => {})
    await page.evaluate(() => window.__lite2Store.getState().goScreen('room'))
    await page.waitForFunction(() => (window.__lite2Store.getState().adviseThreads ?? []).length >= 3, null, { timeout: 20000 }).catch(() => {})
    await page.waitForTimeout(600)
    if (vp.n === 'mobile') {
      await page.locator('[data-history-toggle]').click()
      await page.waitForTimeout(500)
    }
    const out = await page.evaluate(() => {
      const g = (el, ...props) => { if (!el) return null; const cs = getComputedStyle(el); const o = {}; for (const p of props) o[p] = cs[p]; return o }
      const rect = (el) => el ? (({ x, y, width, height }) => ({ x: Math.round(x), y: Math.round(y), w: Math.round(width), h: Math.round(height) }))(el.getBoundingClientRect()) : null
      const aside = document.querySelector('[data-room-aside]')
      const rows = [...document.querySelectorAll('.lite-room-history-head')]
      const cur = document.querySelector('li.is-current .lite-room-history-head')
      const board = document.querySelector('.lite-room-board')
      const welcome = document.querySelector('[data-room-welcome]')
      const scroll = document.querySelector('.lite-room-scroll')
      const composer = document.querySelector('.lite-room > .nexus-followup-composer')
      return {
        aside: { ...rect(aside), ...g(aside, 'backgroundColor', 'borderRightWidth', 'paddingTop', 'paddingBottom', 'zIndex', 'display') },
        newBtn: { ...rect(document.querySelector('[data-room-new]')), ...g(document.querySelector('[data-room-new]'), 'color', 'backgroundColor', 'minHeight', 'borderRadius', 'paddingLeft') },
        rowCount: rows.length,
        row0: { ...rect(rows[0]), ...g(rows[0], 'color', 'flexDirection', 'minHeight', 'borderRadius', 'paddingLeft', 'fontSize') },
        row0text: rows[0]?.innerText,
        row1text: rows[1]?.innerText,
        turns0: rect(rows[0]?.querySelector('.lite-room-history-turns')),
        date0: g(rows[0]?.querySelector('.lite-room-history-date'), 'display'),
        groupLabel: g(document.querySelector('.lite-room-aside-group-label'), 'color', 'fontSize', 'fontWeight'),
        current: cur ? { ...g(cur, 'backgroundColor', 'fontWeight'), bar: getComputedStyle(cur, '::before').backgroundColor, barW: getComputedStyle(cur, '::before').width } : null,
        scrim: (() => { const s = document.querySelector('[data-history-scrim]'); return s ? { ...rect(s), ...g(s, 'display', 'backgroundColor', 'zIndex') } : null })(),
        board: { ...rect(board), ...g(board, 'justifyContent', 'minHeight', 'paddingTop', 'paddingBottom') },
        welcome: rect(welcome), scroll: rect(scroll), composer: rect(composer),
        toggle: { ...rect(document.querySelector('[data-history-toggle]')), ...g(document.querySelector('[data-history-toggle]'), 'display', 'left', 'right', 'zIndex') },
      }
    })
    console.log(`\n═══ ${look} ${vp.n} ═══\n` + JSON.stringify(out, null, 1))
    await ctx.close()
  }
}
await browser.close()
