// #83 手拍取证：对话页侧栏「有场」态 —— 桌面 1440×900 + 手机 390×844，两皮各一轮。
//
// 为什么要自己造历史而不是真问 9 遍：侧栏要的是**列表形态**（12 场 / 三个日期组 / 长短标题
// 混排），跟 LLM 到底答了什么无关。真跑 9 发 /advise 既慢又把墙上时钟带进画面（分组是拿
// `new Date()` 和 created_at 算的）。所以：clock 钉死 + route 拦 `GET /advise-threads`
// 直接吐一份手写的 12 场载荷 —— 拍的仍是**真组件、真 CSS、真 React 树**，被替换的只有网络那一层。
//
// ⚠ 上传那一步是真的（要一个真 contextId，侧栏挂在 `contextId !== null` 那一支里）。
//
// 用法: VERIFY_BASE=http://127.0.0.1:5283 node .issues/design-0810/_px83/shot.mjs <outDir>
import { chromium } from 'playwright'
import fs from 'node:fs'

const UI = process.env.VERIFY_BASE || 'http://127.0.0.1:5283'
const OUT = process.argv[2]
if (!OUT) { console.error('用法: node shot.mjs <outDir>'); process.exit(2) }
fs.mkdirSync(OUT, { recursive: true })

const ROSTER = [
  '# 别墅酒店 员工花名册', '',
  '姓名 | 人员ID | 部门 | 职位 | 司龄',
  '周雅婷 | MKT-001 | 市场推广部 | 市场专员 | 3年',
  '林小满 | FO-0422 | 前厅部 | 前厅主管 | 2年',
].join('\n')
const PROJECT = ['# 别墅套餐推广', '负责人：周雅婷', '状态：受阻', '截止：2026-10-15',
  '进度：55%', '阻塞：雨季无备选场地'].join('\n')

// 钉死的“此刻”。分组（今天/昨天/更早）与行上的时刻都是拿它算的——不钉就是一张会腐烂的图。
const NOW = '2026-08-10T14:20:00+08:00'

// 12 场：3 今天 / 2 昨天 / 7 更早，长短标题混排，两场多轮（轮数只在 >1 时才该占墨）。
const THREAD_SPEC = [
  { q: '本周前厅部的排班有没有明显缺口？', at: '2026-08-10T11:40:00+08:00', n: 2 },
  { q: '婚宴那单的对接人现在是谁？', at: '2026-08-10T09:08:00+08:00', n: 1 },
  { q: '帮我看看这周有哪几个项目可能会延期', at: '2026-08-10T08:02:00+08:00', n: 1 },
  { q: '小马最近的工作量是不是有点高了', at: '2026-08-09T19:31:00+08:00', n: 1 },
  { q: '客房部谁还没交这周的周报？', at: '2026-08-09T10:12:00+08:00', n: 1 },
  { q: '旺季排班协调会上定了哪几件事', at: '2026-08-07T16:44:00+08:00', n: 1 },
  { q: '新来的前台需要多久能独立顶班', at: '2026-08-04T15:03:00+08:00', n: 1 },
  { q: '管理规范里关于客诉升级的红线是怎么写的？', at: '2026-08-01T11:26:00+08:00', n: 1 },
  { q: '中秋前后的房态预测能不能拉一份', at: '2026-07-29T14:09:00+08:00', n: 1 },
  { q: '小徐转正的材料齐了吗', at: '2026-07-25T09:47:00+08:00', n: 3 },
  { q: '上个月客诉最集中的是哪个环节', at: '2026-07-22T17:15:00+08:00', n: 1 },
  { q: '宴会部和前厅的交接卡在哪一步', at: '2026-07-20T10:58:00+08:00', n: 1 },
]

const threadsPayload = (contextId) => ({
  context_id: contextId,
  threads: THREAD_SPEC.map((t, i) => ({
    thread_id: `thr_${String(i).padStart(2, '0')}abcdef`,
    runs: Array.from({ length: t.n }, (_, k) => ({
      id: `run_${i}_${k}`,
      // 场内 runs 按对话顺序；分组/时刻取**最后一轮**（lastRunOf），所以末轮落在 t.at 上。
      created_at: new Date(new Date(t.at).getTime() - (t.n - 1 - k) * 6 * 60000).toISOString(),
      question: k === 0 ? t.q : `${t.q}（追问 ${k}）`,
      title: '', locale: 'zh', advice: null, answer: '（手拍取证用，不进判据）',
      thread_id: `thr_${String(i).padStart(2, '0')}abcdef`,
    })),
  })),
})

const VIEWPORTS = [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'mobile', width: 390, height: 844 },
]
const LOOKS = ['paper', 'aurora']

const browser = await chromium.launch()
for (const look of LOOKS) {
  for (const vp of VIEWPORTS) {
    const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height } })
    const page = await ctx.newPage()
    const errs = []
    page.on('pageerror', (e) => errs.push(String(e)))
    await page.clock.setFixedTime(new Date(NOW))
    // 🔴 拦截必须在导航之前挂：contextId 一到手 store 就会拉一次历史。
    await page.route('**/advise-threads', async (route) => {
      const id = decodeURIComponent(new URL(route.request().url()).pathname.split('/').at(-2))
      await route.fulfill({
        status: 200, headers: { 'content-type': 'application/json' },
        body: JSON.stringify(threadsPayload(id)),
      })
    })
    await page.goto(`${UI}/?v=2&mode=live&look=${look}&lang=zh`, { waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(900)
    await page.keyboard.press('Escape').catch(() => {})
    await page.waitForTimeout(300)
    await page.evaluate(async ({ files }) => {
      const enc = new TextEncoder()
      await window.__lite2Store.getState().uploadFiles(
        files.map((f) => new File([enc.encode(f.text)], f.name, { type: 'text/markdown' })))
    }, { files: [{ name: '花名册.md', text: ROSTER }, { name: '项目周报.md', text: PROJECT }] })
    await page.waitForFunction(
      () => ['ready', 'error'].includes(window.__lite2Store.getState().ingestStatus),
      null, { timeout: 60000 }).catch(() => {})
    await page.evaluate(() => window.__lite2Store.getState().goScreen('room'))
    await page.waitForFunction(
      () => (window.__lite2Store.getState().adviseThreads ?? []).length >= 12,
      null, { timeout: 20000 }).catch(() => {})
    await page.waitForTimeout(700)
    const tag = `${look}-${vp.name}`

    // 自证：拍的确实是「有场」态，不是空侧栏（一张空侧栏的对照图什么都证明不了）。
    const rows = await page.locator('[data-history-thread]').count()
    await page.screenshot({ path: `${OUT}/${tag}-aside-threads.png`, fullPage: false })

    // 手机：把抽屉打开再拍一张（桌面 toggle 是 display:none，这一段自动跳过）。
    const toggle = page.locator('[data-history-toggle]')
    let drawerShot = false
    if (await toggle.isVisible()) {
      await toggle.click()
      await page.waitForTimeout(500)
      await page.screenshot({ path: `${OUT}/${tag}-drawer-open.png`, fullPage: false })
      drawerShot = true
    }

    // 打开一场 → 选中态 + 回灌的会话流（选中语法是本票规格里最容易画歪的一条）。
    const row = page.locator('[data-history-thread]').first()
    if (await row.isVisible()) { await row.click(); await page.waitForTimeout(900) }
    if (await toggle.isVisible()) { await toggle.click(); await page.waitForTimeout(500) }
    await page.screenshot({ path: `${OUT}/${tag}-aside-current.png`, fullPage: false })

    console.log(`[shot] ${tag} rows=${rows} drawer=${drawerShot} pageerrors=${errs.length} `
      + errs.slice(0, 2).join(' | '))
    await ctx.close()
  }
}
await browser.close()
console.log('[shot] done ->', OUT)
