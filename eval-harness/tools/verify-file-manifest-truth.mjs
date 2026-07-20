// 文件清单诚实性门（对抗复审 Defect A）。
//
// ## 缺陷是什么
// 后端 `/team/{id}/files` 早就按文件发 `status`：'ingested' | 'empty'（解析成功但没抽到内容，
// 典型是扫描版 PDF）| 'failed'（根本没解析成，典型是损坏/编码不对的文件）——registry.py 里的
// 三态注释写了很久。前端 `src/lite2/UploadPanel.tsx` 却压根不渲染这个字段：每一行只有
// 「文件名」+「大小 · N 处引用」，头部固定写着「团队已就绪」。客户传 3 份文件、1 份读不进去，
// 屏幕上那份坏文件和另外两份长得一模一样——项目页一片空白时，客户会理解成"团队真的没进展"，
// 而不是"那份文件根本没被读到"。
//
// 07-19 fixB（git show 6f838f3 / a45bb4a）修过一次：加了 fileStatusView() + 状态徽章 + hint
// 文案 + 把 accept 列表收窄成后端真支持的格式。07-19 深夜一次合并冲突（3106536，Merge
// 039f1f1 + 377b42f）在 src/lite2/UploadPanel.tsx 这一个文件上把 377b42f（带 fixB）那侧的
// 236 行 diff 整个丢弃、原样保留 039f1f1（不带 fixB）——`git diff 039f1f1 3106536 --
// src/lite2/UploadPanel.tsx` 是空的，`git diff 377b42f 3106536 -- 同文件` 有 236 行差异，
// 就是丢弃的铁证。同一次合并同样丢了 transport.ts 的 `LiveFileEntry.status` 字段。
// zh.ts/en.ts 里的 fileStatus* 五个 i18n 键全须无恙地留在原地（没人删字典），只是没有任何
// 组件引用它们——文案早就写好了，渲染的人不见了。
//
// 本门的第二重断言（fixA2）：同一批缺陷里，中文 Team 屏的 briefing headline 曾经**刻意**
// 不提文件数——理由写在 src/shared/briefing.ts 的旧注释里："取材自 已经把文件名列出来了，
// 比一个计数更诚实"。这个理由不成立：source_files（"取材自"的数据源）只排除 status='failed'
// 的文件，混着 status='empty' 的文件——一个字都没读到的文件，名字照样印在"取材自"下面。
// 于是文件没读全时，中文客户在 headline 和"取材自"两处都看不到任何信号；而后端 briefing.
// headline 永远是英文字面量（locale-blind），EN 客户在同一处能看到 "Ingested 2 of 3
// file(s)" 这行诚实自曝——production 是中文，等于生产上线的那张皮把这句诚实话删掉了。
//
// ## 怎么才算真的够到了缺陷
// 不直接调 fileStatusView()/localizeBriefing()——那只证明函数本身，证明不了屏幕。本门驱动
// 一次**真上传**（真 HTTP transport，真 AVERY_BRAIN=mock 后端），batch 里放两份文件：
//   · 一份读得进去的中文周报（真实内容，产出 material chunk）；
//   · 一份**结构性损坏的 PDF**——魔术字节 `%PDF-` 对得上（能过 upload_guard 的类型闸），
//     内部是垃圾字节，触发 avery.ingest.parse._parse_pdf 抛 ParseError（fb81811 已把库异常
//     兜成 ParseError，不再是裸 500）。这份字节取自
//     eval-harness/tests/test_adversarial_parse_crash_battery.py 的 TRUNCATED_PDF，同一个
//     后端行为，不是本门发明的新数据。
// 两份文件一起进同一个 /ingest 请求，走完整的 upload_guard → parse → pipeline →
// _finalize_source_documents → /team/{id}/files 链路——不注入、不改包。
//
// 怎么跑（与 verify-null-owner.mjs / verify-status-truth.mjs 同一套前置）：
//   1) cd eval-harness && AVERY_BRAIN=mock AVERY_CORS_ORIGINS=http://127.0.0.1:5307,http://localhost:5307 \
//      python -m uvicorn service.app:app --port 8307
//   2) VITE_AVERY_API_BASE=http://127.0.0.1:8307 node node_modules/vite/bin/vite.js build --mode development
//   3) node node_modules/vite/bin/vite.js preview --port 5307 --strictPort
//   4) VERIFY_BASE=http://127.0.0.1:5307 node eval-harness/tools/verify-file-manifest-truth.mjs
import { chromium } from 'playwright'

const UI = process.env.VERIFY_BASE || 'http://127.0.0.1:5307'
const R = []
const rec = (n, ok, d) => { R.push({ n, ok }); console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${n}${d ? ' — ' + d : ''}`) }

// 一份读得进去的中文周报——真实内容，会产出 material chunk（对照组）。
const GOOD_DOC = [
  '# 星澜置业 · 周报 W32',
  '',
  '## 项目：一期交付验收',
  '负责人：李明',
  '状态：正常',
  '进度：65%',
  '',
].join('\n')

// 结构性损坏的 PDF：魔术字节合法（`%PDF-`，过得了 upload_guard 的类型闸），内部是垃圾——
// 与 eval-harness/tests/test_adversarial_parse_crash_battery.py::TRUNCATED_PDF 同一份字节，
// 触发 pypdf 的 PdfStreamError，parse.py 把它兜成 ParseError（fb81811），manifest 标 failed。
const BAD_PDF_BYTES =
  '%PDF-1.7\n1 0 obj\n<< garbage not a real pdf object stream at all, no xref, no EOF'

const GOOD_NAME = 'w32-weekly.md'
const BAD_NAME = 'w32-scan.pdf'

const browser = await chromium.launch({ headless: true })
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } })
const page = await ctx.newPage()
const pageErrors = []
page.on('pageerror', (e) => pageErrors.push(e.message))

await page.goto(`${UI}/?v=2&mode=live&look=paper&lang=zh`, { waitUntil: 'networkidle' })
if (await page.locator('.lite-onboard').count()) {
  await page.keyboard.press('Escape')
  await page.waitForTimeout(700)
}

// 真上传：一份好文件 + 一份坏文件，同一个 /ingest 请求。
await page.evaluate(
  async ({ goodText, goodName, badBytes, badName }) => {
    const enc = new TextEncoder()
    const good = new File([enc.encode(goodText)], goodName, { type: 'text/markdown' })
    const bad = new File([enc.encode(badBytes)], badName, { type: 'application/pdf' })
    await window.__lite2Store.getState().uploadFiles([good, bad])
  },
  { goodText: GOOD_DOC, goodName: GOOD_NAME, badBytes: BAD_PDF_BYTES, badName: BAD_NAME },
)

// mock brain 走离线启发式抽取，比真 LLM 快得多，但仍要等 ingest 状态落地 + refreshFiles()
// 的异步 GET /team/{id}/files 打完（uploadFiles 里 `void get().refreshFiles()`，不等它）。
await page.waitForFunction(
  () => window.__lite2Store.getState().ingestStatus === 'ready'
     || window.__lite2Store.getState().ingestStatus === 'error',
  { timeout: 20000 },
).catch(() => {})
const ingestStatus = await page.evaluate(() => window.__lite2Store.getState().ingestStatus)
rec('上传本身成功（ingestStatus === ready，坏文件没有拖垮好文件那一半）', ingestStatus === 'ready',
  `ingestStatus=${ingestStatus}`)

await page.waitForTimeout(1500) // 给 refreshFiles() 的 GET 一点时间落地
await page.evaluate(() => window.__lite2Store.getState().goScreen('team'))
await page.waitForTimeout(600)

// ── 断言 1：manifest 里两份文件的 status 字段真的不同（派生层，证明后端确实吐了三态）──────
const manifestFiles = await page.evaluate(() =>
  (window.__lite2Store.getState().files ?? []).map((f) => ({
    filename: f.filename, status: f.status ?? '(无此字段)', n_chunks: f.n_chunks,
  })),
)
console.log('  manifest（store.files）:', JSON.stringify(manifestFiles))
const goodEntry = manifestFiles.find((f) => f.filename === GOOD_NAME)
const badEntry = manifestFiles.find((f) => f.filename === BAD_NAME)
rec('两份文件都出现在 manifest 里（坏文件没有被后端悄悄丢弃）',
  Boolean(goodEntry) && Boolean(badEntry),
  `good=${JSON.stringify(goodEntry)} bad=${JSON.stringify(badEntry)}`)
rec('好文件 status=ingested', goodEntry?.status === 'ingested', `实际 ${goodEntry?.status}`)
rec('坏文件 status=failed（不是 ingested，不是空字段冒充成功）',
  badEntry?.status === 'failed', `实际 ${badEntry?.status}`)

// ── 断言 2：屏幕上两行确实长得不一样（视觉判据，不是只查 store）──────────────────────────
const rows = await page.evaluate(() =>
  [...document.querySelectorAll('.upload-file-row')].map((el) => ({
    name: el.querySelector('.upload-file-name')?.innerText ?? '',
    statusText: el.querySelector('.upload-file-status')?.innerText ?? '(无状态文案)',
    tone: el.querySelector('.upload-file-status')?.getAttribute('data-tone') ?? '(无 tone)',
    hint: el.querySelector('.upload-file-status-hint')?.innerText ?? '',
    dataStatus: el.getAttribute('data-status') ?? '(无 data-status)',
  })),
)
console.log('  屏幕行:', JSON.stringify(rows))
const goodRow = rows.find((r) => r.name === GOOD_NAME)
const badRow = rows.find((r) => r.name === BAD_NAME)
rec('屏幕上两行都渲染出来了', Boolean(goodRow) && Boolean(badRow),
  `good=${JSON.stringify(goodRow)} bad=${JSON.stringify(badRow)}`)
rec('🔴 两行的状态文案不同（此前的缺陷：两行像素级相同，只有文件名不一样）',
  Boolean(goodRow) && Boolean(badRow) && goodRow.statusText !== badRow.statusText,
  `good="${goodRow?.statusText}" bad="${badRow?.statusText}"`)
rec('好文件那行说「已读取」', goodRow?.statusText === '已读取', `实际 "${goodRow?.statusText}"`)
rec('坏文件那行说「没能读取」（不是「已读取」，不是空白）',
  badRow?.statusText === '没能读取', `实际 "${badRow?.statusText}"`)
rec('坏文件那行的 tone 是 bad（不是默认色/ok 色）', badRow?.tone === 'bad', `实际 ${badRow?.tone}`)
rec('坏文件那行带一句"读不进去怎么回事"的说明（不是让客户自己猜）',
  Boolean(badRow?.hint) && badRow.hint.length > 0, `hint="${badRow?.hint}"`)
rec('坏文件的说明不替客户编原因——只说文件没能打开，不猜是不是客户的问题',
  badRow?.hint.includes('没能打开') || badRow?.hint.includes('编码') || false,
  `hint="${badRow?.hint}"`)

// ── 断言 3：headline 不能说「一切正常」而只字不提有文件没读进去 ─────────────────────────
const headline = await page.evaluate(() => document.querySelector('.home-greeting h1')?.innerText ?? '')
console.log('  headline:', headline)
rec('headline 提到了文件数（读取了 N/M 份），不是只说人和项目',
  /\d+\s*\/\s*\d+/.test(headline), `headline="${headline}"`)
rec('headline 里的 N/M 确实反映"没有全部读进去"（1/2，不是 2/2）',
  headline.includes('1/2'), `headline="${headline}"`)

// ── 断言 4：readyLabel（上传面板头部「团队已就绪」）本身没有撒谎——它只是一句总括，
// 真正的诚实信号在下面的逐行状态里，这里只确认它没有被误改成别的谎话。────────────────
const readyLabel = await page.evaluate(() => document.querySelector('.upload-ready-label')?.innerText ?? '')
rec('upload 面板的 readyLabel 存在（本门不是在一个空面板上断言）', readyLabel.length > 0, readyLabel)

rec('无 pageerror', pageErrors.length === 0, pageErrors.slice(0, 2).join(' | ') || '0 条')

await browser.close()

const pass = R.filter((r) => r.ok).length
const fail = R.length - pass
console.log(`\n═══ 文件清单诚实性：${pass} PASS · ${fail} FAIL ═══`)
process.exit(fail ? 1 : 0)
