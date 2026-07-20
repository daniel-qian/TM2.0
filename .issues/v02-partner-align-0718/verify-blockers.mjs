// 集成层复验：第二轮对抗审查那 5 条 blocker，在**合并后的树**上逐条真跑。
// 不看子线的自报，也不看复核者的结论——它们各自都只看得见自己那一支。
import { chromium } from 'playwright'
import { execSync } from 'node:child_process'
import fs from 'node:fs'

const API = 'http://127.0.0.1:8137'
const UI = 'http://127.0.0.1:5173'
const R = []
const rec = (n, ok, d) => { R.push({ n, ok, d }); console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${n}${d ? ' — ' + d : ''}`) }

// ── S3 · GBK 中文文件不许被静默销毁 ────────────────────────────────────────────
console.log('\n═══ S3 · GBK/GB18030 编码 ═══')
const rosterText = '姓名,职位,部门\n李明,项目经理,别墅销售\n王芳,渠道主管,渠道合作\n陈思雨,客服主管,客户运营\n'
fs.writeFileSync('/tmp/roster_gbk.csv', Buffer.from(rosterText, 'latin1').length ? iconvGbk(rosterText) : '')
function iconvGbk(s) {
  // Node 无内置 GBK 编码器；用 Python 转
  fs.writeFileSync('/tmp/_gbk_src.txt', s, 'utf8')
  execSync(`python -c "import io;io.open('/tmp/roster_gbk.csv','w',encoding='gb18030',newline='').write(io.open('/tmp/_gbk_src.txt',encoding='utf-8').read())"`)
  return fs.readFileSync('/tmp/roster_gbk.csv')
}
const gbkOut = execSync(`curl -s -X POST ${API}/ingest -F "files=@/tmp/roster_gbk.csv"`).toString()
let gbk
try { gbk = JSON.parse(gbkOut) } catch { gbk = null }
rec('GBK 花名册能抽出人（不再静默销毁）', !!gbk && gbk.people.length === 3,
  gbk ? `people=${gbk.people.length} names=${JSON.stringify(gbk.people.map((p) => p.name))}` : gbkOut.slice(0, 160))

// 红线：GBK 编码的评分表不许因为乱码而绕过红线
const evilText = '姓名,备注\n陈思雨,本月绩效8分排名倒数第一建议末位淘汰\n'
fs.writeFileSync('/tmp/_gbk_src.txt', evilText, 'utf8')
execSync(`python -c "import io;io.open('/tmp/evil_gbk.csv','w',encoding='gb18030',newline='').write(io.open('/tmp/_gbk_src.txt',encoding='utf-8').read())"`)
const evilOut = execSync(`curl -s -X POST ${API}/ingest -F "files=@/tmp/evil_gbk.csv"`).toString()
let evil
try { evil = JSON.parse(evilOut) } catch { evil = null }
const leaked = evil ? evil.people.filter((p) => /[0-9]分|绩效|倒数/.test(p.name || '')) : []
rec('GBK 编码不会让评分词绕过红线', leaked.length === 0,
  evil ? `people=${JSON.stringify(evil.people.map((p) => p.name))}` : '(回包非 JSON)')

// ── S4 · 「无法完成」不许读成已完成 ─────────────────────────────────────────────
console.log('\n═══ S4 · 中文否定短语 ═══')
const cases = [
  ['本月无法完成', 'done', false],
  ['未能完成', 'done', false],
  ['不能完成', 'done', false],
  ['不得不推迟', 'done', false],
  ['已完成', 'done', true],
  ['无风险', 'at-risk', false],
  ['没有受阻', 'blocked', false],
  ['受阻', 'blocked', true],
]
const py = cases.map(([t]) => t).join('|')
const statuses = execSync(
  `python -c "import sys;sys.path.insert(0,'eval-harness');from avery.ingest.extract import _norm_status;print('|'.join(_norm_status(t) for t in '''${py}'''.split('|')))"`,
).toString().trim().split('|')
cases.forEach(([text, bad, shouldBe], i) => {
  const got = statuses[i]
  const ok = shouldBe ? got === bad : got !== bad
  rec(`「${text}」${shouldBe ? '应当' : '不许'}读成 ${bad}`, ok, `实得 "${got || '(空)'}"`)
})

// ── S1 / S2 / S5 · 前端 ────────────────────────────────────────────────────────
console.log('\n═══ S1 · 状态兜底 / S2 · 首屏摘要 / S5 · 二次上传 ═══')
const b = await chromium.launch({ headless: true })
const p = await (await b.newContext({ viewport: { width: 1280, height: 900 } })).newPage()
const errs = []
p.on('pageerror', (e) => errs.push(e.message))
await p.goto(`${UI}/?v=2&mode=live&look=paper&lang=zh`, { waitUntil: 'networkidle' })
if (await p.locator('.lite-onboard').count()) { await p.keyboard.press('Escape'); await p.waitForTimeout(700) }

const doc = ['# 三亚鹿山雅居 · 周报 W29', '', '## 项目：别墅交付验收', '负责人：李明',
  '阻碍项：佣金测算卡住，等财务确认', '', '## 项目：渠道合作拓展', '负责人：王芳', ''].join('\n')
await p.evaluate(async (t) => {
  const st = window.__lite2Store
  await st.getState().uploadFiles([new File([t], 'w1.md', { type: 'text/markdown' })])
  await new Promise((r) => setTimeout(r, 1800))
}, doc)

// S1：没写状态的项目，界面不许说 on-track
await p.evaluate(() => window.__lite2Store.getState().goScreen('projects'))
await p.waitForTimeout(700)
const s1 = await p.evaluate(() => {
  const st = window.__lite2Store.getState()
  const raw = st.rawTeam?.projects ?? []
  return {
    backendSendsStatus: raw.map((x) => ('status' in x)),
    frontendStatus: (st.team?.projects ?? []).map((x) => x.status ?? '(undefined)'),
    pageHasOnTrack: /on-track/.test(document.body.innerText),
    pageHasUnread: /未读到状态|未知|文档未提及/.test(document.body.innerText),
  }
})
rec('S1 · 没写状态的项目，前端不再编成 on-track', !s1.pageHasOnTrack && s1.pageHasUnread, JSON.stringify(s1))

// S2：首屏摘要的数字不许大过项目总数，也不许在有阻塞时说没风险
await p.evaluate(() => window.__lite2Store.getState().goScreen('home'))
await p.waitForTimeout(700)
const s2 = await p.evaluate(() => {
  const st = window.__lite2Store.getState()
  const projects = st.team?.projects?.length ?? 0
  const withBlockers = (st.rawTeam?.projects ?? []).filter((x) => (x.blockers || []).length).length
  const txt = document.body.innerText
  const m = txt.match(/其中\s*(\d+)\s*[个项]/)
  return { projects, withBlockers, tone: st.team?.briefing?.tone, sub: st.team?.briefing?.subhead ?? '',
           claimedLook: m ? Number(m[1]) : null,
           saysNoRisk: /没有.*风险|没有读出风险|No risk signals/.test(txt) }
})
rec('S2 · 有阻塞时首屏不再说「没有风险信号」', !(s2.withBlockers > 0 && s2.saysNoRisk), JSON.stringify(s2))
rec('S2 · 首屏声称要看的数量 ≤ 项目总数（不许凭空多出项目）',
  s2.claimedLook === null || s2.claimedLook <= s2.projects, `声称 ${s2.claimedLook} / 实有 ${s2.projects} 个项目`)

// S5：第二次上传不许静默抹掉第一家的数据
const ctx1 = await p.evaluate(() => window.__lite2Store.getState().contextId)
await p.evaluate(() => window.__lite2Store.getState().goScreen('team'))
await p.waitForTimeout(500)
await p.evaluate(async () => {
  const st = window.__lite2Store
  await st.getState().uploadFiles([new File(['# 第二家公司\n\n## 项目：装修验收\n负责人：赵六\n'], 'w2.md', { type: 'text/markdown' })])
  await new Promise((r) => setTimeout(r, 1800))
})
const s5 = await p.evaluate((prev) => {
  const st = window.__lite2Store.getState()
  const txt = document.body.innerText
  return {
    ctxChanged: st.contextId !== prev,
    canGoBack: /切回|上一份|之前那份|其他公司|switch|另一份/.test(txt) ||
      typeof st.switchContext === 'function' || Array.isArray(st.knownContexts),
    hasSwitchApi: typeof st.switchContext === 'function',
  }
}, ctx1)
rec('S5 · 第二次上传后仍有回到上一份的路径', s5.canGoBack, JSON.stringify(s5))

rec('全程无 pageerror', errs.length === 0, errs.slice(0, 2).join(' | ') || '0 条')
await b.close()

const fail = R.filter((x) => !x.ok)
console.log(`\n═══ blocker 复验：${R.length - fail.length} PASS · ${fail.length} FAIL ═══`)
fail.forEach((f) => console.log(`  ✗ ${f.n} — ${f.d}`))
process.exit(fail.length ? 1 : 0)
