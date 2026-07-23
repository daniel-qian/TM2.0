// rich-align-0722 · issue 03 · e2e 探针 —— 人员自述负载/情绪·开关口径·两世界执法。
//
// F19：本战役新探针一律落 .issues/rich-align-0722/verify-*.mjs（tracked，不入 run-battery roster）。
//
// 证的是「文档→抽取→payload→（开关）投影→（开关）运行时剥离→渲染」整条链，两世界=两次后端重启：
//   关世界（后端**不设** AVERY_ALLOW_PERSON_SCORING）：
//     · payload 无 scoring_enabled；人卡 payload 无 self_report 键
//     · 壳 data-scoring-enabled='off'；DOM 零 [data-metric-source] 锚；人卡零数字/零情绪词
//   开世界（后端 AVERY_ALLOW_PERSON_SCORING=1）：
//     · payload scoring_enabled===true；小王 self_report={load:85, mood:strained}
//     · 壳 data-scoring-enabled='on'；每张自述徽章带非空 data-metric-source 出处锚
//     · 血条/情绪词只在锚内出现——锚**外**的人卡文本零数字零情绪词（红线不松）
//   两世界都：小赵「负载：95%」无「自述」后缀 → 根本不抽成人（散落人身数字永不入）。
//
// 🔴 跑法（runbook §1b，绝不碰 minimax）：先按世界重启 mock 后端，再跑本探针（它读当前世界自证）：
//   关：AVERY_BRAIN=mock AVERY_EXTRACTOR=heuristic AVERY_EMBEDDINGS=keyword uvicorn …  （不设开关）
//   开：… 同上再加 AVERY_ALLOW_PERSON_SCORING=1
//   VERIFY_BASE=http://localhost:5173 node .issues/rich-align-0722/verify-selfreport-switch-03.mjs
import { chromium } from 'playwright'

const UI = process.env.VERIFY_BASE || 'http://localhost:5173'
const R = []
const rec = (n, ok, d) => { R.push({ n, ok }); console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${n}${d ? ' — ' + d : ''}`) }

const DOC = [
  '# 三亚湾营销部·本周周报',
  '## 项目：海棠湾婚宴中心筹备',
  '负责人：小王',
  '状态：进行中',
  '进度：58%',
  '## 人员动态',
  '- 小王｜负载自述：85%｜情绪自述：吃紧',
  '- 小张｜负载自述：40%｜情绪自述：如常',
  '- 小李｜情绪自述：还没定',
  '- 小赵｜负载：95%',
  '',
].join('\n')

async function uploadAndRead() {
  const browser = await chromium.launch({ headless: true })
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } })
  const page = await ctx.newPage()
  const errs = []
  page.on('pageerror', (e) => errs.push(e.message))
  await page.goto(`${UI}/?v=2&mode=live&look=aurora&lang=zh`, { waitUntil: 'networkidle' })
  if (await page.locator('.lite-onboard').count()) { await page.keyboard.press('Escape'); await page.waitForTimeout(600) }

  const ingestStatus = await page.evaluate(async (t) => {
    await window.__lite2Store.getState().uploadFiles([new File([t], 'zb.md', { type: 'text/markdown' })])
    return 'submitted'
  }, DOC)
  void ingestStatus
  await page.waitForFunction(
    () => ['ready', 'error'].includes(window.__lite2Store.getState().ingestStatus),
    undefined, { timeout: 30000 },
  )
  const status = await page.evaluate(() => window.__lite2Store.getState().ingestStatus)

  // payload 层（raw，未经前端剥离）：scoring_enabled + 每人 self_report。
  const payload = await page.evaluate(() => {
    const raw = window.__lite2Store.getState().rawTeam
    const byName = {}
    for (const p of (raw?.people ?? [])) byName[p.name] = p
    return {
      scoringEnabled: raw?.scoring_enabled === true,
      hasScoringKey: raw ? ('scoring_enabled' in raw) : false,
      names: Object.keys(byName),
      wang: byName['小王'] ? { hasSR: 'self_report' in byName['小王'], sr: byName['小王'].self_report || null } : null,
      li: byName['小李'] ? { hasSR: 'self_report' in byName['小李'], sr: byName['小李'].self_report || null } : null,
      hasZhao: !!byName['小赵'],
    }
  })

  await page.evaluate(() => window.__lite2Store.getState().goScreen('team'))
  await page.waitForTimeout(500)

  // DOM 层（渲染后）：壳标记 + 锚 + 锚外文本泄漏扫描。
  const dom = await page.evaluate(() => {
    const shell = document.querySelector('.lite2-shell, .app-shell')
    const marker = shell ? shell.getAttribute('data-scoring-enabled') : null
    const cards = Array.from(document.querySelectorAll('.home-person-card'))
    const anchors = []
    cards.forEach((c) => anchors.push(...Array.from(c.querySelectorAll('[data-metric-source]'))))
    const anchorsMissingSource = anchors.filter((el) => !((el.getAttribute('data-metric-source') || '').trim())).length
    // 锚外文本（剪掉 [data-metric-source] 子树），textContent 语义走 walk（离屏 innerText 会空）。
    const textOutside = (root) => {
      let out = ''
      const walk = (node) => {
        if (node.nodeType === 3) { out += node.nodeValue; return }
        if (node.nodeType !== 1) return
        if (node.hasAttribute && node.hasAttribute('data-metric-source')) return
        node.childNodes.forEach(walk)
      }
      walk(root)
      return out
    }
    const outside = cards.map(textOutside).join('\n')
    const BLOOD = /\b\d{1,3}\s*%|\b(?:mood|capacity)\s*[:%]/
    const MOOD = /如常|偏紧|吃紧|steady|stretched|strained/i
    // 小王卡内是否确有一枚含「85%」+「吃紧」的锚
    const wangCard = cards.find((c) => (c.querySelector('h3')?.textContent || '').includes('小王'))
    const wangAnchorText = wangCard
      ? Array.from(wangCard.querySelectorAll('[data-metric-source]')).map((a) => a.textContent || '').join(' | ')
      : ''
    return {
      marker,
      cards: cards.length,
      anchors: anchors.length,
      anchorsMissingSource,
      bloodOutside: BLOOD.test(outside) ? outside.match(BLOOD)[0] : null,
      moodOutside: MOOD.test(outside) ? outside.match(MOOD)[0] : null,
      wangAnchorText,
    }
  })

  await ctx.close()
  await browser.close()
  return { status, payload, dom, errs }
}

const r = await uploadAndRead()
const world = r.payload.scoringEnabled ? 'ON（开关开）' : 'OFF（开关关）'
console.log(`\n═══ 当前世界：${world} ═══`)
console.log(`         ingest=${r.status} · payload ${JSON.stringify(r.payload)}`)
console.log(`         dom ${JSON.stringify(r.dom)}`)

rec('抽取未被红线拒（ingest ready）', r.status === 'ready', r.status)
rec('散落人身数字不入：小赵（负载:95% 无「自述」）根本没被抽成人', !r.payload.hasZhao,
  r.payload.hasZhao ? '小赵被误抽' : '（无小赵）')
rec('无 pageerror', r.errs.length === 0, r.errs.slice(0, 2).join(' | ') || '0 条')

if (r.payload.scoringEnabled) {
  // ── 开世界 ──
  rec('ON · payload scoring_enabled===true', r.payload.scoringEnabled)
  rec('ON · 小王 self_report={load:85, mood:strained}',
    !!r.payload.wang && r.payload.wang.hasSR && r.payload.wang.sr
      && r.payload.wang.sr.load?.value === 85 && r.payload.wang.sr.mood?.value === 'strained'
      && !!r.payload.wang.sr.load?.source,
    JSON.stringify(r.payload.wang?.sr))
  rec('ON · 小李 只有 mood=other（valueRaw 回显「还没定」），load 缺席',
    !!r.payload.li && r.payload.li.sr && r.payload.li.sr.mood?.value === 'other'
      && r.payload.li.sr.mood?.valueRaw === '还没定' && !r.payload.li.sr.load,
    JSON.stringify(r.payload.li?.sr))
  rec('ON · 壳 data-scoring-enabled=on', r.dom.marker === 'on', String(r.dom.marker))
  rec('ON · 人卡有自述出处锚 [data-metric-source] 且**无一枚缺 source**',
    r.dom.anchors >= 2 && r.dom.anchorsMissingSource === 0,
    `anchors=${r.dom.anchors} missingSrc=${r.dom.anchorsMissingSource}`)
  rec('ON · 小王卡锚内确含「85%」与「吃紧」', /85\s*%/.test(r.dom.wangAnchorText) && /吃紧/.test(r.dom.wangAnchorText),
    r.dom.wangAnchorText)
  rec('ON · 🔴 锚**外**人卡文本零血条数字、零情绪词（红线不松）',
    r.dom.bloodOutside === null && r.dom.moodOutside === null,
    `blood=${r.dom.bloodOutside} mood=${r.dom.moodOutside}`)
} else {
  // ── 关世界 ──
  rec('OFF · payload 无 scoring_enabled 键（缺席≠false）', !r.payload.hasScoringKey)
  rec('OFF · 小王 payload 无 self_report 键（投影随开关，关=整槽不发）',
    !!r.payload.wang && !r.payload.wang.hasSR, JSON.stringify(r.payload.wang))
  rec('OFF · 壳 data-scoring-enabled=off', r.dom.marker === 'off', String(r.dom.marker))
  rec('OFF · 人卡零自述出处锚', r.dom.anchors === 0, `anchors=${r.dom.anchors}`)
  rec('OFF · 🔴 人卡零血条数字、零情绪词（现行 moat 一字不改）',
    r.dom.bloodOutside === null && r.dom.moodOutside === null,
    `blood=${r.dom.bloodOutside} mood=${r.dom.moodOutside}`)
}

const pass = R.filter((r) => r.ok).length
const fail = R.length - pass
console.log(`\n═══ 自述开关 e2e（${world}）：${pass} PASS · ${fail} FAIL ═══`)
process.exit(fail ? 1 : 0)
