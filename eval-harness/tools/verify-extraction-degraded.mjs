// #89 · 抽取降级横幅端到端门：后端说 degraded → 屏上必须有话，且**熬得过刷新**。
//
// ## 这道门防的是什么
// 2026-08-11 合伙人真实试用：MiniMax Token Plan 用尽，每次抽取撞 429、降级到正则兜底，
// 13 人花名册抽出 0 人 0 项目。她看到的是 200 +「已读取」+「今天没有要你定夺的事」+
// 「现在没有自相矛盾的地方」——每一句都在说一切正常，于是她的结论是「我是不是传错了」。
//
// 后端**从 feat-039 起就一直诚实地发着** `extraction_mode: "degraded"`。前端 `src/` 里那个
// 字符串出现次数：**0**。诚实的一半送到门口，另一半把它扔了。
//
// 所以本门的主判据落在「**从 HTTP 响应体里读到的那个值**能不能变成屏上的一句话」，
// 而不是「store 里那格对不对」——后者证明不了这条链的接线。
//
// ## 为什么必须靠 route 改包，而不是让后端真降级
// 门电池的后端一律 `AVERY_EXTRACTOR=heuristic`（离线三件套，缺一真烧钱）。那个配置下后端
// 发的是 `'heuristic'`，**永远不可能**发 `'degraded'`——真降级需要「配了真模型 + 模型拒绝」，
// 门里既不该有 key 也不该打真供应商。于是本门在网络层把响应体的这一个键改掉：
// 链路的其余每一段（传输层透传 → store 落地 → localStorage → 渲染）都是真的，
// 只有「后端为什么这么说」是伪造的。伪造点只有一处，且它正是本门要测的那个输入。
//
// ## 改包点在哪（#91 重设计）
// #90 把上传拆成「秒级 deposit + worker 异步读取」之后，**POST 写口不再携带 extraction_mode**
// （抽取还没跑，编一个值就是本门要杀的那种谎）——它现在活在 GET /team/{id}/files 的
// `last_job.extraction_mode` 里，由 store 的内部轮询在任务落定那一刻消费。所以本门改拦
// **GET /files** 的响应体、改 `last_job` 里的那一个键；POST 写口只观察不改（⓪′ 把「写口
// 确实不再发这个键」钉成判据——这个前提塌了，改包点就该挪回去，本门必须当场红而不是空拦）。
//
// ## 判据（每条都配对照，防空真）
//   ⓪ 自证：改包真的生效了（拦到了带 last_job 的 GET /files，且注入的值真进了响应体）。
//      少了它，②③ 全是「横幅没出现是因为请求压根没被拦到」的假红/假绿温床。
//   ⓪′ 自证（#91 新增）：POST 写口的响应体确实**不再携带** extraction_mode——本门改拦 GET
//      的全部前提。它塌了（有人把键加回 POST）本条当场红，别让改包点空拦着装绿。
//   ① 基线：**注入之前**屏上没有横幅（②的对照基准；没有它，②等于 0===0 的空真）。
//   ② degraded 从**网络层**进来 → 横幅在屏上，且三句话都在（标题/正文/重试指引）。
//   ③ 🔴 **刷新之后横幅还在**。这是本票的中心句：这个值只在任务落定那一刻被轮询消费一次，
//      `GET /team/{id}` 是读口、`GET /files` 的 last_job 也只在轮询窗口内被消费（⑥ 是它的
//      反向证明）——只活在内存里的警告会在刷新的一瞬间消失，而 0811 那位用户的真实动线
//      正是「传完 → 看了会儿 → 翻页/刷新」。
//   ④ 🔴 **'heuristic' 不许出横幅**。这条断的是「判据写成 `!== 'llm'`」那一刀——那种实现
//      在 ② 上完美通过，却会让每一台没配模型的离线部署天天喊狼来了。
//   ⑤ 'llm' 同样不出横幅（正常态的对照）。
//   ⑥ 🔴 清空档案 → 横幅必须跟着没。`emptyArchive` **不换 context_id**，所以那条
//      「换了 id 就清干净」的收口在这里根本不跑；漏了这一刀，崭新的空档案上会挂着
//      一句关于不存在之事的警告。⚠ #90 后这一条还多咬一件事：ingest_jobs 是无 FK 的审计
//      痕迹，**清空不删 job 行**——服务端的 last_job 在清空后照旧发着（本门也照旧改包着），
//      横幅仍必须消失。谁要是让 refreshFiles 直接消费 last_job，这一条当场红。
//   ⑦ 补一批**读懂了的**资料 → 横幅消失。标签是「最近一趟」的属性，不是档案的终身烙印。
//
// ## 怎么跑
// 🔴 **上传型门**（真发 POST /ingest + POST /team/{id}/files 造 context，每跑一遍造 2 个），
//    **绝不能排在 C 区之后**——C 区的 bundle-privacy 会把 dist 重打成指向生产域名，
//    此后任何一发上传就是往生产库里写测试数据（2026-07-20 真发生过）。
//   后端：AVERY_BRAIN=mock AVERY_EXTRACTOR=heuristic AVERY_EMBEDDINGS=keyword uvicorn :8137
//   前端：vite build --mode development + vite preview --host --port 5173
//   VERIFY_BASE=http://localhost:5173 node eval-harness/tools/verify-extraction-degraded.mjs
import { bootPage, makeRec, finish } from './lib/gate-run.mjs'

const UI = process.env.VERIFY_BASE || 'http://127.0.0.1:5173'
const gateRec = makeRec()
const rec = gateRec.rec

const SEAM = '__lite2Store'
const BANNER = '.lite-files-degraded'

const ROSTER = [
  '# 别墅酒店 员工花名册', '',
  '姓名 | 人员ID | 部门 | 职位 | 司龄',
  '周雅婷 | MKT-001 | 市场推广部 | 市场专员 | 3年',
  '林小满 | FO-0422 | 前厅部 | 前厅主管 | 2年',
].join('\n')
// 🔴 每一发补传的字节必须**互不相同**（#90 实收）：内容幂等按 sha256 判重，同字节第二发
// 连队都不入（skipped_identical、无 job、extraction_mode 键缺席）——五发全用同一串 WEEKLY
// 时，②⑤⑥⑦ 的「补传」实际一个任务都没跑，标签纹丝不动、判据全在空转。这不是坑，
// 是幂等在正常工作；门语料自己长出差异来。
const weekly = (tag) =>
  ['# 别墅套餐推广', '负责人：周雅婷', '状态：进行中', '截止：2026-09-30', `备注：${tag}`].join('\n')

let browser
const boot = await bootPage({
  browser, url: `${UI}/?v=2&mode=live&look=paper&lang=zh`, trackPageErrors: true,
})
browser = boot.browser
const { page, pageErrors } = boot

// ── 网络层改包（#91 重设计：拦 GET /files 的 last_job，POST 只观察）───────────────────────
// `inject` 为 null 时原样放行（① 的基线要走真后端的真回答）。台账 `patched` 是 ⓪ 的自证，
// `postModes` 是 ⓪′ 的观察记录（POST 写口对 extraction_mode 这个键到底发没发）。
// ⚠ 同一个 URL 形状（/team/{id}/files）POST 是 deposit、GET 是轮询面——按 method 分岔。
let inject = null
const patched = []
const postModes = []
await page.route(/\/(ingest|team\/[^/]+\/files)$/, async (route) => {
  const req = route.request()
  if (req.method() === 'POST') {
    // 只观察不改：#90 契约说写口不再携带 extraction_mode，⓪′ 把这个前提钉住。
    // ⚠ route.fetch() 给的是 APIResponse，**没有 clone()**（第一版就栽在这儿：clone 抛 →
    //   catch 吞 → postModes 恒空 → ⓪′ 恒红）。读 text 自己 parse，回填用**原文**零改写。
    const res = await route.fetch()
    const raw = await res.text()
    try {
      const body = JSON.parse(raw)
      postModes.push({
        url: req.url(),
        mode: Object.hasOwn(body ?? {}, 'extraction_mode') ? body.extraction_mode : '(absent)',
      })
    } catch {
      /* 非 JSON（错误页）——无观察可记 */
    }
    return route.fulfill({ response: res, body: raw })
  }
  if (req.method() !== 'GET' || inject === null) return route.continue()
  const res = await route.fetch()
  let body
  try {
    body = await res.json()
  } catch {
    return route.fulfill({ response: res })      // 非 JSON（错误页）——不碰，让真相自己上屏
  }
  // 只有带 last_job 的清单响应才有可改的键；没有任务的档案（尚未 deposit）原样放行。
  if (body && body.last_job) {
    body.last_job.extraction_mode = inject
    patched.push({ url: req.url(), mode: inject, jobStatus: body.last_job.status })
  }
  await route.fulfill({ response: res, body: JSON.stringify(body),
    headers: { ...res.headers(), 'content-type': 'application/json' } })
})

const st = (fn) => page.evaluate(fn, SEAM)
const upload = (files, action) => page.evaluate(async ({ files, action, seam }) => {
  const enc = new TextEncoder()
  await window[seam].getState()[action](
    files.map((f) => new File([enc.encode(f.text)], f.name, { type: 'text/markdown' })))
}, { files, action, seam: SEAM })

// 🔴 超时不许抛（同 verify-archive-empty 的碑）：接错线时状态机会永远停在 'idle'，
// 裸 waitForFunction 会把整道门炸成一条 playwright 堆栈，而不是「接错线了」。
const settle = async (key, label) => {
  try {
    await page.waitForFunction(
      (k) => ['ready', 'error'].includes(window[k.seam].getState()[k.key]),
      { seam: SEAM, key }, { timeout: 45000 })
    return true
  } catch {
    const now = await page.evaluate((k) => window[k.seam].getState()[k.key], { seam: SEAM, key })
    rec(label, false, `${key} 停在 '${now}' 没有落定——这个口子多半接到了别的 action 上`)
    return false
  }
}

const gotoFiles = async () => {
  await page.goto(`${UI}/files?v=2&mode=live&look=paper&lang=zh`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(700)
}
const bannerCount = () => page.locator(BANNER).count()

// ── ① 基线：先传一份真的（不改包），屏上不该有横幅 ────────────────────────────────────
await upload([{ name: '员工花名册.md', text: ROSTER }], 'uploadFiles')
await settle('ingestStatus', '① 首传落定')
await gotoFiles()

const base = await st((seam) => {
  const s = window[seam].getState()
  return { contextId: s.contextId, mode: s.extractionMode, files: (s.files ?? []).length }
})
rec('① 自证：语料真的进去了（有 contextId、清单非空）——否则后面每一条都在空屏上判',
  !!base.contextId && base.files >= 1, JSON.stringify(base))
rec('① 基线：真后端（heuristic）下屏上没有降级横幅（② 的对照基准）',
  (await bannerCount()) === 0, `banner=${await bannerCount()} storeMode=${base.mode}`)

// ── ④ 'heuristic' 明确注入一次：仍然不许出横幅 ──────────────────────────────────────────
// 🔴 这条与 ① 不是同一条：① 里后端发什么由它自己决定（可能压根没发这个键），
//    这里是**明确发了 'heuristic'**。判据写成 `!== 'llm'` 的实现会在这一条上红。
inject = 'heuristic'
await upload([{ name: '周报-h.md', text: weekly('h') }], 'appendFiles')
await settle('appendStatus', '④ 补传落定(heuristic)')
await gotoFiles()
const hMode = await st((seam) => window[seam].getState().extractionMode)
rec('④ 自证：这一发真的被改包成了 heuristic（否则本条是空真）',
  patched.some((p) => p.mode === 'heuristic') && hMode === 'heuristic',
  `patched=${JSON.stringify(patched)} storeMode=${hMode}`)
rec("④ 🔴 'heuristic' 不出横幅——那是「这台后端没配模型」的诚实态，不是故障",
  (await bannerCount()) === 0, `banner=${await bannerCount()}`)

// ── ⑤ 'llm'：正常态同样不出 ──────────────────────────────────────────────────────────────
inject = 'llm'
await upload([{ name: '周报-l.md', text: weekly('l') }], 'appendFiles')
await settle('appendStatus', '⑤ 补传落定(llm)')
await gotoFiles()
rec("⑤ 'llm' 不出横幅（正常态对照）", (await bannerCount()) === 0,
  `banner=${await bannerCount()}`)

// ── ② degraded：横幅必须在，且三句话都在 ────────────────────────────────────────────────
// 🔴 这一段**刻意不导航**：上一步的 gotoFiles() 已经把我们放在 /files 上，这里传完就地断言。
//    第一版每步都跟一发 gotoFiles()，于是 ② 走的其实是 localStorage 那条路（整页重载 →
//    首帧从存储取回），和 ③ 测的是同一件事——而「传完待在原地不动的人」（最常见的动线：
//    就在资料库工具条上点的上传）一条判据都没盖到。变异「首帧不从 localStorage 取回」
//    把 ② 一起打红，才暴露出这个洞。现在 ② 只吃内存态、③ 只吃持久化，两刀砍两处。
inject = 'degraded'
await upload([{ name: '周报-d.md', text: weekly('d') }], 'appendFiles')
await settle('appendStatus', '② 补传落定(degraded)')
await page.waitForTimeout(500)

const onFiles = await page.evaluate(() => window.location.pathname)
rec('② 自证：仍站在 /files 上、这一条吃的是内存态（没导航、没重载）',
  onFiles.endsWith('/files'), `path=${onFiles}`)

const dCount = await bannerCount()
rec('② 🔴 后端说 degraded → 屏上有横幅（0811 这一句整条丢失）', dCount === 1,
  `banner=${dCount}`)
const parts = dCount
  ? await page.evaluate((sel) => {
      const el = document.querySelector(sel)
      return {
        title: el.querySelector('.lite-files-degraded-title')?.textContent?.trim() || '',
        body: el.querySelector('.lite-files-degraded-body')?.textContent?.trim() || '',
        retry: el.querySelector('.lite-files-degraded-retry')?.textContent?.trim() || '',
        role: el.getAttribute('role') || '',
      }
    }, BANNER)
  : { title: '', body: '', retry: '', role: '' }
rec('② 三句话都在场（标题/正文/重试指引），且挂着 role=status 让读屏也听得见',
  !!parts.title && !!parts.body && !!parts.retry && parts.role === 'status',
  JSON.stringify(parts))
// 🔴 判据落在**语义**上而不是整句原文：文案还会改，钉死原文等于给下一次改字埋一颗假红。
// 但这两件事是本条存在的理由，改字也不许改掉：① 先摘掉用户的责任 ② 说清「先删再传」。
rec('② 正文说了「不是你的错」（0811 她的第一反应是「我是不是传错格式了」）',
  /不是你传错|不是你的问题|Nothing you did wrong/i.test(parts.body), parts.body)
rec('② 重试指引说了「先删再传」（补传同名会被改名成 (1)，直接重传是多一份不是覆盖）',
  /先把.*删掉|delete .*first/i.test(parts.retry), parts.retry)

// ── ③ 🔴 刷新之后还在（本票的中心句）────────────────────────────────────────────────────
await page.reload({ waitUntil: 'networkidle' })
await page.waitForTimeout(900)
await gotoFiles()
const afterReload = await bannerCount()
const lsRaw = await page.evaluate(() => window.localStorage.getItem('lite2:extractionMode:v1'))
rec('③ 🔴 刷新之后横幅仍在——`extraction_mode` 只有写口发，读口不发，不自己存就会在这儿消失',
  afterReload === 1, `banner=${afterReload} ls=${lsRaw}`)
rec('③ 自证：它是从 localStorage 取回的，且锚在**这份** context 上（换档案不许继承）',
  !!lsRaw && lsRaw.includes(base.contextId), `ls=${lsRaw} ctx=${base.contextId}`)

// ── ⑦ 补一批读懂了的 → 横幅消失（标签是「最近一趟」的属性）───────────────────────────
inject = 'llm'
await upload([{ name: '周报-good.md', text: weekly('good') }], 'appendFiles')
await settle('appendStatus', '⑦ 补传落定(恢复)')
await gotoFiles()
const afterGood = await bannerCount()
rec('⑦ 再补一批读懂了的资料 → 横幅消失（不是档案的终身烙印）', afterGood === 0,
  `banner=${afterGood}`)

// ── ⑥ 🔴 清空档案 → 横幅跟着没（emptyArchive 不换 context_id）──────────────────────────
inject = 'degraded'
await upload([{ name: '周报-d2.md', text: weekly('d2') }], 'appendFiles')
await settle('appendStatus', '⑥ 补传落定(再降级)')
await gotoFiles()
rec('⑥ 对照基准：清空**之前**横幅确实在（否则下一条是天生空真）',
  (await bannerCount()) === 1, `banner=${await bannerCount()}`)

const canEmpty = await st((seam) => !!window[seam].getState().transport.emptyContext)
if (!canEmpty) {
  rec('⑥ 能力探测：这条通道没有 emptyContext——本条没跑，不是绿', false, 'emptyContext 缺席')
} else {
  const ctxBefore = await st((seam) => window[seam].getState().contextId)
  await page.evaluate((seam) => window[seam].getState().emptyArchive(), SEAM)
  await page.waitForTimeout(1200)
  await gotoFiles()
  const ctxAfter = await st((seam) => window[seam].getState().contextId)
  const lsAfter = await page.evaluate(() => window.localStorage.getItem('lite2:extractionMode:v1'))
  rec('⑥ 自证：清空**没有**换 context_id（正是这条让「换 id 就清干净」那条收口够不着）',
    ctxBefore === ctxAfter && !!ctxAfter, `${ctxBefore} → ${ctxAfter}`)
  rec('⑥ 🔴 清空之后横幅没了（文件全没了，「那次抽取降级了」就没有了对象）',
    (await bannerCount()) === 0 && !lsAfter, `banner=${await bannerCount()} ls=${lsAfter}`)
}

// ── ⓪′ 🔴 写口不再携带 extraction_mode（#91 改拦 GET 的全部前提，收尾时验全程观察）──────
// 全程 1 次 /ingest + 5 次补传 = 至少 6 条观察，每一条都必须是 '(absent)'。
// 有任何一条带了值 = #90 契约被翻（有人把键加回 POST）——那时本门的改包点空拦着装绿，
// 必须当场红、把改包点挪回写口。
rec("⓪′ 🔴 POST 写口全程未携带 extraction_mode（本门改拦 GET /files·last_job 的前提）",
  postModes.length >= 6 && postModes.every((p) => p.mode === '(absent)'),
  JSON.stringify(postModes))

rec('⑧ 全程零 pageerror', pageErrors.length === 0, pageErrors.join(' | '))

await finish(gateRec, { browser, label: '#89 抽取降级横幅', listFailures: true })
