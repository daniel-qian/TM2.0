// 把 A 区三道最相关的门的**判据**逐字搬过来，对着一份**真能渲染出常驻表单段**的语料重跑。
//
// 为什么要有这个文件：A 区 25/25 全绿，但 probe-gate-coverage.mjs 实测
// verify-button-family 的种子语料抽出 0 个人 → 本段按否决④ 整段不渲染 → 那道绿对本票的
// 新按钮**一个字节都没说**（memory「门全绿≠真部件被验到」的第一种假绿：门看的那一屏，
// 恰好是新部件不在的那一屏）。
// 判据全部逐字取自：
//   verify-button-family.mjs  的 WHITELIST + AUDIT_FN
//   verify-zh-purity.mjs      的 ALLOW + latinHits
//   verify-contrast-smalltext.mjs 的 AUDIT_FN
import { chromium } from 'playwright'

const UI = process.env.VERIFY_BASE || 'http://127.0.0.1:5199'

const ROSTER = [
  '# 望江酒店 · 员工花名册', '',
  '姓名 | 职位 | 部门 | 司龄 | 负责',
  '周雅 | 传菜领班 | 前厅部 | 3 年 | 宴会厅传菜动线与现场服务',
  '陈明远 | 中餐厨师长 | 厨房 | 7 年 | 各菜系出品与宴会菜单研发',
  '林小满 | 前厅部经理 | 前厅部 | 5 年 | 前台礼宾总机与行政楼层统筹', '',
  '## 项目：宴会厅翻台提速', '负责人：周雅', '状态：正常', '',
].join('\n')

const WHITELIST = [
  '.scene-tab', '.lite-settings-toggle', '.lang-switch-btn', '.look-switch-btn', '.mode-switch-btn',
  '.lite-bell-toggle', '.lite-auth-toggle', '.lite-notif-item',
  '.lite-modal-backdrop', '.lite-gate-door', '.lite-onboard-playbook',
  '.ask-recipient-chip', '.icon-button', '.composer-add-button',
  '.lite-composer-filter', '.lite-composer-option', '.lite-composer-remove',
  '.lite-search-option',
  '.lite-home-block-link', '.lite-home-todo-check', '.lite-home-gap-title',
  '.lite-home-count-cell', '.lite-home-attention-name', '.lite-home-gap-chip',
  '.lite-team-filter-chip',
  '.home-person-card', '.home-people-group-head', '.home-check', '.home-map-card-link',
  '.home-drawer-toggle', '.home-project-card',
  '.lite-project-card', '.lite-followup-check', '.lite-followups-subtab',
  '.lite-card-open',
  '.lite-flow-toggle', '.lite-flow-cites-toggle', '.lite-room-chip',
  '.lite-gap-project-link', '.lite-gap-history-toggle',
  '.lite-notes-entry-source', '.lite-notes-group-head',
]

const BUTTON_AUDIT = `((whitelist) => {
  const out = { total: 0, family: 0, whitelisted: 0, naked: [] }
  const sel = whitelist.join(', ')
  for (const b of document.querySelectorAll('.lite2-shell button')) {
    const r = b.getBoundingClientRect()
    const cs = getComputedStyle(b)
    if (r.width === 0 || r.height === 0 || cs.visibility === 'hidden' || cs.display === 'none') continue
    out.total++
    if (b.classList.contains('lite-btn')) { out.family++; continue }
    if (b.matches(sel)) { out.whitelisted++; continue }
    out.naked.push({ cls: String(b.className).slice(0, 60) || '(无类名)', text: (b.innerText || '').trim().slice(0, 12) })
  }
  return out
})`

const CONTRAST_AUDIT = `(() => {
  function parseColor(c) { const m = c.match(/rgba?\\(([\\d.]+), ?([\\d.]+), ?([\\d.]+)(?:, ?([\\d.]+))?\\)/); return m ? [+m[1],+m[2],+m[3], m[4]===undefined?1:+m[4]] : null }
  function lum(rgb) { const f = v => { v/=255; return v<=0.03928? v/12.92 : Math.pow((v+0.055)/1.055,2.4) }; return 0.2126*f(rgb[0])+0.7152*f(rgb[1])+0.0722*f(rgb[2]) }
  function ratio(a,b){ const l1=lum(a), l2=lum(b); return (Math.max(l1,l2)+0.05)/(Math.min(l1,l2)+0.05) }
  function bgOf(el){ let cur = el; while(cur && cur !== document.documentElement){ const c = parseColor(getComputedStyle(cur).backgroundColor); if (c && c[3] > 0.5) return c; cur = cur.parentElement }
    const shell = document.querySelector('.lite2-shell, .lite-shell')
    const base = shell ? parseColor(getComputedStyle(shell).getPropertyValue('background-color')) : null
    return base && base[3] > 0.5 ? base : [247,244,238,1] }
  const seen = new Set(); const bad = []
  document.querySelectorAll('main *').forEach(el => {
    if (!el.innerText || el.children.length > 0) return
    const txt = el.innerText.trim(); if (!txt || txt.length < 2) return
    const cs = getComputedStyle(el)
    if (cs.visibility === 'hidden' || cs.display === 'none' || +cs.opacity === 0) return
    const fg = parseColor(cs.color); if (!fg) return
    const r = ratio(fg, bgOf(el))
    const size = parseFloat(cs.fontSize); const bold = parseInt(cs.fontWeight) >= 700
    const threshold = (size >= 18.66 || (size >= 14 && bold)) ? 3 : 4.5
    if (r < threshold - 0.03) {
      const key = String(el.className).slice(0,40) + '|' + cs.color
      if (!seen.has(key)) { seen.add(key); bad.push(String(el.className).slice(0,40) + ' ' + Math.round(r*100)/100 + '/' + threshold + ' (' + txt.slice(0,14) + ')') }
    }
  })
  return bad
})()`

const ALLOW = /^(Avery|Esc|W\d+|\d+%|v\d+|MB|KB|PDF|CSV|XLSX|DOCX|TSV|TXT|MD|OK|Word|Excel|Markdown|DPA|NDA|TLS)$/i
function latinHits(txt) {
  const out = []
  for (const line of txt.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) continue
    for (const frag of trimmed.match(/[A-Za-z][A-Za-z'()\-]*(?:\s+[A-Za-z][A-Za-z'()\-]*)*/g) || []) {
      const words = frag.trim().split(/\s+/)
      if (words.length >= 2 || (words[0] && words[0].length >= 4)) out.push({ line: trimmed, frag: frag.trim() })
    }
  }
  return out.filter((h) => !h.frag.split(/\s+/).every((w) => ALLOW.test(w)))
}

const fails = []
const check = (label, ok, detail = '') => {
  console.log(`  ${ok ? '✓' : '✗'} ${label}${detail ? ` — ${detail}` : ''}`)
  if (!ok) fails.push(label)
}

const browser = await chromium.launch()
for (const look of ['paper', 'aurora']) {
  console.log(`\n═══ ${look} · 资料库屏（常驻表单段真在场）═══`)
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: 'zh-CN' })
  const page = await ctx.newPage()
  await page.goto(`${UI}/?v=2&mode=live&lang=zh&look=${look}`, { waitUntil: 'networkidle' })
  if (await page.locator('.lite-onboard, .lite-gate-layer').count()) {
    await page.keyboard.press('Escape'); await page.waitForTimeout(600)
  }
  await page.evaluate(async (d) => {
    const f = new File([new TextEncoder().encode(d)], '花名册.md', { type: 'text/markdown' })
    await window.__lite2Store.getState().uploadFiles([f])
  }, ROSTER)
  await page.waitForTimeout(2500)
  await page.evaluate(() => window.__lite2Store.getState().goScreen('files'))
  await page.waitForTimeout(2500)
  // 撑到最长态：选人 + 铸链 —— chip/生成/复制/状态徽章全部在场才算真审过。
  await page.locator('.lite-files-forms-chip').nth(0).click()
  await page.locator('.lite-files-forms-chip').nth(1).click()
  await page.locator('.lite-files-forms-mint').click()
  await page.waitForTimeout(2500)

  const sect = await page.locator('.lite-files-forms').count()
  const inSection = await page.locator('.lite-files-forms button').count()
  check('自证：常驻表单段真在场（否则下面全是空断言）', sect === 1 && inSection >= 6, `段=${sect} 段内按钮=${inSection}`)

  const btn = await page.evaluate(`(${BUTTON_AUDIT})(${JSON.stringify(WHITELIST)})`)
  check(`按钮族零裸按钮（${btn.total} 可见：族 ${btn.family} + 白名单 ${btn.whitelisted}）`,
    btn.naked.length === 0, btn.naked.map((n) => `${n.cls}"${n.text}"`).join(' | '))

  const bad = await page.evaluate(CONTRAST_AUDIT)
  check('全部文本 ≥ AA（小字 4.5 / 大字 3.0）', bad.length === 0, bad.join(' | '))

  const hits = latinHits(await page.evaluate(() => document.body.innerText))
  const uniq = [...new Map(hits.map((h) => [h.frag, h])).values()]
  check('中文纯度：无英文残留', uniq.length === 0,
    uniq.map((h) => `"${h.frag}"`).join(' | '))

  await ctx.close()
}
await browser.close()
console.log('')
console.log(fails.length === 0 ? '三道门判据 · 全部通过' : `未过 ${fails.length} 条`)
process.exit(fails.length === 0 ? 0 : 1)
