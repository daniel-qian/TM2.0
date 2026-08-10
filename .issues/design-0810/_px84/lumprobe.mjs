import { chromium } from 'playwright'
const UI = process.env.VERIFY_BASE || 'http://127.0.0.1:5284'
const b = await chromium.launch()
const c = await b.newContext({ viewport: { width: 1440, height: 900 } })
const p = await c.newPage()
await p.goto(`${UI}/?v=2&mode=live&look=paper&lang=zh`, { waitUntil: 'domcontentloaded' })
await p.waitForTimeout(900); await p.keyboard.press('Escape').catch(()=>{})
await p.evaluate(() => window.__lite2Store.getState().goScreen('files'))
await p.waitForTimeout(400)
console.log(JSON.stringify(await p.evaluate(() => {
  const chain = (el) => { const out=[]; let n=el; while(n && n!==document.documentElement){ out.push(`${n.tagName}.${(n.className||'').toString().split(' ')[0]}=${getComputedStyle(n).backgroundColor}`); n=n.parentElement } return out }
  return { rail: chain(document.querySelector('.lite-files-rail')), pane: chain(document.querySelector('.lite-files-pane')) }
}), null, 1))
await b.close()
