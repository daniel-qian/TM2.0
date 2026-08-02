// 第二轮 UI 走查驱动（sweep-r2, 2026-08-02）—— **数据态**捕获器。
//
// ## 为什么有这个
// 第一轮走查 46 条里 14 条是 hard-contract，其中 12 条同根因：build+preview 产物里
// `import.meta.env.DEV` 恒 false，`?transport=stub` 被整段 DCE（src/lite2/store.ts:192、:382），
// 于是"离线确定性 stub"这条前提是假的，**所有"有数据态"页面本轮全部不可达**（见
// `.issues/sweep/2026-08-02.md` 的 Not covered）。
//
// 绕法不是修 DEV 闸（那是另一张票），是走**无条件存在的验收缝** `window.__lite2Store` +
// 一个真的 mock 后端：`uploadFiles()` 真发 /ingest 打 127.0.0.1:8137（AVERY_BRAIN=mock +
// heuristic + keyword，零出网零花费秒级），数据就真长出来了。这条路子不是新发明的——
// eval-harness/tools/sweep-ui-defects.mjs 的 seed() 与 verify-status-truth.mjs 的
// uploadAndGoTeam() 已经这么干了很久，本文件只是把它抽出来给走查用。
//
// ## 前置（缺一就是假红）
//   后端：cd eval-harness && AVERY_BRAIN=mock AVERY_EXTRACTOR=heuristic AVERY_EMBEDDINGS=keyword \
//         AVERY_DEMO_SEED_DIR=tests/fixtures/demo-seed python -m uvicorn service.app:app --port 8137
//   前端：node node_modules/typescript/bin/tsc -b && node node_modules/vite/bin/vite.js build \
//         --mode development && node node_modules/vite/bin/vite.js preview --port 5173 --host
//   🔴 `--mode development` 不能省：省了 dist 的 apiBase 落回 vite.config 默认＝**生产域名**，
//      而本驱动**会真上传**——那就是往生产库写测试数据。启动时本文件会自己验一次 apiBase，
//      验不过直接退出，别把这道自检删了。
//
// ## 跑法
//   node eval-harness/tools/sweep-r2-driver.mjs --screens=home,team --look=paper --lang=zh \
//        --viewport=1440x900 --out=<绝对目录>
//   node eval-harness/tools/sweep-r2-driver.mjs --list          # 打印可选屏名
// 产物：<out>/<look>-<lang>-<vp>-<screen>.png + 同名 .json（innerText / console / 网络 /
// 几何 / store 派生态）。**空态与数据态各一份**（-empty 后缀 = 注入前），因为"这条在空态也
// 有吗"是判 finding 归属的第一个问题。
import { chromium } from 'playwright'
import { readFileSync, readdirSync, mkdirSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..', '..')
const SEED_DIR = join(ROOT, 'eval-harness', 'tests', 'fixtures', 'demo-seed')

const SCREENS = ['home', 'team', 'projects', 'room', 'followups', 'notes', 'closerlook',
                 'playbooks', 'vision', 'files', 'paperwork']

const arg = (k, d) => {
  const hit = process.argv.find((a) => a.startsWith(`--${k}=`))
  return hit ? hit.slice(k.length + 3) : d
}
if (process.argv.includes('--list')) { console.log(SCREENS.join(',')); process.exit(0) }

const UI = process.env.VERIFY_BASE || 'http://localhost:5173'
const API = process.env.VERIFY_API || 'http://127.0.0.1:8137'
const screens = arg('screens', SCREENS.join(',')).split(',').map((s) => s.trim()).filter(Boolean)
const look = arg('look', 'paper')
const lang = arg('lang', 'zh')
const [vw, vh] = arg('viewport', '1440x900').split('x').map(Number)
const OUT = arg('out', join(ROOT, '.issues', 'sweep', '2026-08-02-r2-shots'))
mkdirSync(OUT, { recursive: true })

const bad = screens.filter((s) => !SCREENS.includes(s))
if (bad.length) { console.error(`未知屏名: ${bad.join(',')} —— 可选: ${SCREENS.join(',')}`); process.exit(2) }

// ── 语料：demo 母本那 9 份中文文件（heuristic 抽取对「负责人：/状态：」这类结构化 md 够用）──
const seedFiles = readdirSync(SEED_DIR).filter((f) => f.endsWith('.md'))
  .map((f) => ({ name: f, text: readFileSync(join(SEED_DIR, f), 'utf8') }))
if (!seedFiles.length) { console.error(`语料目录空: ${SEED_DIR}`); process.exit(2) }

const health = await fetch(`${API}/health`).then((r) => r.json()).catch(() => null)
if (!health || health.status !== 'ok') { console.error(`后端 ${API} 不健康，先起 mock 后端`); process.exit(2) }
if (health.brain !== 'mock' || health.embeddings !== 'keyword' || health.extractor !== 'heuristic') {
  console.error(`🔴 后端不是全离线三件套（brain=${health.brain} embeddings=${health.embeddings} ` +
                `extractor=${health.extractor}）—— 这会真出网烧钱，拒跑`); process.exit(2)
}

const browser = await chromium.launch({ headless: true })
const ctx = await browser.newContext({ viewport: { width: vw, height: vh } })
const page = await ctx.newPage()

const consoleMsgs = []; const pageErrors = []; const failedReqs = []; const badResponses = []
page.on('console', (m) => { if (['error', 'warning'].includes(m.type())) consoleMsgs.push(`[${m.type()}] ${m.text()}`.slice(0, 300)) })
page.on('pageerror', (e) => pageErrors.push(String(e.message).slice(0, 300)))
page.on('requestfailed', (r) => failedReqs.push(`${r.method()} ${r.url()} -> ${r.failure()?.errorText}`.slice(0, 300)))
page.on('response', (r) => { if (r.status() >= 400) badResponses.push(`${r.status()} ${r.request().method()} ${r.url()}`.slice(0, 300)) })

const STICKY = `?v=2&mode=live&look=${look}&lang=${lang}`
await page.goto(`${UI}/${STICKY}`, { waitUntil: 'networkidle' })

// 🔴 dist 指向自检 —— 本驱动会真上传，指错端口就是往别人的库写数据
const build = await page.evaluate(() => window.__AVERY_BUILD__ ?? null)
if (!build || !/127\.0\.0\.1:8137|local default/.test(String(build.apiBase))) {
  console.error(`🔴 dist 的 apiBase 不是本地 8137（${JSON.stringify(build)}）—— 拒跑。` +
                `重打：vite build --mode development`)
  await browser.close(); process.exit(2)
}

async function escapeOnboard() {
  if (await page.locator('.lite-onboard').count()) { await page.keyboard.press('Escape'); await page.waitForTimeout(600) }
}

// 🔴 `paperwork` **不是 LiteScreen**（routes.ts:74-80 刻意不进联合类型：没 tab、不进 SCREEN_PATH），
// 所以 `goScreen('paperwork')` 会静默兜底成 DEFAULT_SCREEN——第一轮 r2 采样就是这么把 10 份
// paperwork 产物全采成 /home 的（url 字段 100% 是 /home?…，triage 逐份比对 110 份 json 抓出来的）。
// 它只能整页 goto。数据不会因此丢：contextId 锚在 localStorage 上（"返回访客"门就靠这条）。
const URL_ONLY_SCREENS = { paperwork: "/paperwork" }

// 一屏的机械采样：文本 / 几何 / store 派生态。判断留给读它的人，这里只如实记。
async function capture(screen, tag) {
  if (URL_ONLY_SCREENS[screen]) {
    await page.goto(`${UI}${URL_ONLY_SCREENS[screen]}${STICKY}`, { waitUntil: 'networkidle' })
    await escapeOnboard()
  } else {
    await page.evaluate((s) => window.__lite2Store.getState().goScreen(s), screen)
  }
  await page.waitForTimeout(600)
  // 采样前先自证「我真的在这一屏」——上面那个 bug 的门。整页 goto 之后还要确认数据没丢。
  const here = page.url()
  const want = URL_ONLY_SCREENS[screen]
  if (want && !here.includes(want)) {
    console.error(`🔴 ${screen}${tag}: 导航失败，url=${here} —— 采到的不是这一屏，拒绝落产物`)
    process.exitCode = 1
    return
  }
  const snap = await page.evaluate(() => {
    const st = window.__lite2Store.getState()
    const vpw = document.documentElement.clientWidth
    const box = (el) => { const r = el.getBoundingClientRect(); return { x: +r.x.toFixed(1), y: +r.y.toFixed(1), w: +r.width.toFixed(1), h: +r.height.toFixed(1) } }
    // 横向溢出：任何可见元素右边越出视口（页级横滚是它的后果）
    const overflow = [...document.querySelectorAll('body *')].filter((el) => {
      const r = el.getBoundingClientRect()
      return r.width > 0 && r.height > 0 && (r.right > vpw + 1 || r.left < -1)
    }).slice(0, 12).map((el) => ({ sel: el.tagName.toLowerCase() + (el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\s+/).slice(0, 3).join('.') : ''), ...box(el) }))
    // 截字：scrollWidth/Height 明显超过 clientWidth/Height 且 overflow 被裁掉
    const clipped = [...document.querySelectorAll('body *')].filter((el) => {
      const cs = getComputedStyle(el)
      if (!['hidden', 'clip'].includes(cs.overflow) && !['hidden', 'clip'].includes(cs.overflowY) && !['hidden', 'clip'].includes(cs.overflowX)) return false
      return el.scrollHeight > el.clientHeight + 2 || el.scrollWidth > el.clientWidth + 2
    }).slice(0, 12).map((el) => ({ sel: el.tagName.toLowerCase() + (typeof el.className === 'string' && el.className ? '.' + el.className.trim().split(/\s+/).slice(0, 3).join('.') : ''), scrollH: el.scrollHeight, clientH: el.clientHeight, scrollW: el.scrollWidth, clientW: el.clientWidth, text: (el.innerText || '').slice(0, 80) }))
    return {
      htmlLang: document.documentElement.lang,
      pageScrollsHorizontally: document.documentElement.scrollWidth > vpw + 1,
      innerText: document.body.innerText.slice(0, 12000),
      counts: {
        personCards: document.querySelectorAll('.lite-person-card, .person-card').length,
        projectCards: document.querySelectorAll('.lite-project-card, .home-project-card').length,
        gapCards: document.querySelectorAll('.lite-gap-card').length,
        followups: document.querySelectorAll('.lite-followup-row, .followup-row').length,
        notes: document.querySelectorAll('.lite-note, .notes-item').length,
        fileRows: document.querySelectorAll('.upload-file-row, .file-row').length,
        buttons: document.querySelectorAll('button').length,
        // 🔴 这里问的是「有没有可访问名」，**不是**「挂没挂 .lite-btn」。第一版按 class 白名单
        // 数，结果 paperwork 一屏报 11/15 全是误报——9 个 .scene-tab（有可见文字）+ 铃铛与齿轮
        // （各有 aria-label），只是 class 不在那条正则里。按 class 数出来的是"命名习惯"不是缺陷。
        // 按钮族纪律（新按钮必须挂 .lite-btn 或进白名单）自有 verify-button-family.mjs 管，别在这重造。
        namelessButtons: [...document.querySelectorAll('button')]
          .filter((b) => !(b.innerText || '').trim() && !b.getAttribute('aria-label') &&
                         !b.getAttribute('title') && !b.querySelector('img[alt]:not([alt=""])'))
          .map((b) => b.className || '(no class)').slice(0, 8),
      },
      ariaish: [...document.querySelectorAll('[aria-label],[title],img[alt]')].slice(0, 40)
        .map((el) => el.getAttribute('aria-label') || el.getAttribute('title') || el.getAttribute('alt')).filter(Boolean),
      store: {
        contextId: st.contextId ?? null,
        ingestStatus: st.ingestStatus ?? null,
        runStatus: st.run?.status ?? null,
        teamPeople: st.team?.people?.length ?? null,
        teamProjects: st.team?.projects?.length ?? null,
        notes: st.notes?.length ?? null,
        followups: st.followups?.length ?? null,
      },
      overflow, clipped,
    }
  })
  const base = join(OUT, `${look}-${lang}-${vw}x${vh}-${screen}${tag}`)
  await page.screenshot({ path: `${base}.png`, fullPage: false })
  writeFileSync(`${base}.json`, JSON.stringify({
    screen, look, lang, viewport: `${vw}x${vh}`, world: tag === '-empty' ? 'empty' : 'seeded',
    url: page.url(), ...snap,
    consoleMsgs: [...consoleMsgs], pageErrors: [...pageErrors],
    failedReqs: [...failedReqs], badResponses: [...badResponses],
  }, null, 1), 'utf8')
  console.log(`  ${screen}${tag}: people=${snap.store.teamPeople} projects=${snap.store.teamProjects} ` +
              `notes=${snap.store.notes} overflow=${snap.overflow.length} clipped=${snap.clipped.length} ` +
              `consoleErr=${consoleMsgs.length} pageErr=${pageErrors.length}`)
}

await escapeOnboard()
console.log(`═══ 空态（注入前）· ${look}/${lang}/${vw}x${vh} ═══`)
for (const s of screens) await capture(s, '-empty')

console.log(`\n═══ 注入数据（${seedFiles.length} 份 demo 语料经 __lite2Store.uploadFiles → 真 /ingest）═══`)
consoleMsgs.length = 0; pageErrors.length = 0; failedReqs.length = 0; badResponses.length = 0
await page.evaluate(async (files) => {
  const enc = new TextEncoder()
  await window.__lite2Store.getState().uploadFiles(
    files.map((f) => new File([enc.encode(f.text)], f.name, { type: 'text/markdown' })))
}, seedFiles)
await page.waitForFunction(() => ['ready', 'error'].includes(window.__lite2Store.getState().ingestStatus),
  undefined, { timeout: 120000 })
const ingest = await page.evaluate(() => ({
  status: window.__lite2Store.getState().ingestStatus,
  err: window.__lite2Store.getState().ingestError ?? null,
  ctx: window.__lite2Store.getState().contextId ?? null,
}))
console.log(`  ingest=${ingest.status} ctx=${ingest.ctx} err=${ingest.err ?? '—'}`)
if (ingest.status !== 'ready') {
  console.error('🔴 注入失败——后面的"数据态"全是空真，拒绝继续'); await browser.close(); process.exit(1)
}

// Room 要一次真 advise 才有判读卡；notes 要 refresh 才有回流
await page.evaluate(() => {
  const st = window.__lite2Store.getState()
  st.goScreen('room')
  st.askLive?.({ situation: '这周谁的项目最需要我搭把手？' })
})
await page.waitForFunction(() => ['complete', 'error'].includes(window.__lite2Store.getState().run?.status ?? 'complete'),
  undefined, { timeout: 120000 }).catch(() => {})
await page.evaluate(() => window.__lite2Store.getState().refreshNotes?.())
await page.waitForTimeout(600)

console.log(`\n═══ 数据态 · ${look}/${lang}/${vw}x${vh} ═══`)
for (const s of screens) await capture(s, '')

await browser.close()
console.log(`\n产物落在 ${OUT}`)
