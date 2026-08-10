// 设计0810 · #86 ·「清空这份档案」端到端门：传 → 问一句 → 清空 → **档案还在** → 再往里传。
//
// ## 这道门防的是什么
// Danny 0810 拍板「不要有『新建』的概念」——一个人从头到尾就一份档案，真要从头来是**清空
// 这一份**（`context_id` / `owner_token` 不变）。这句话有两半，而**只有后半会安静地烂掉**：
//
//   前半「清空了」——砍半了屏上一眼就看得出来（文件还在列着）。
//   后半「档案还在」——砍半了屏上**看不出来**：最省事的实现是前端调一下
//   `resetLiteCompanyData()` 把本地清干净（屏上确实空了！），或者干脆重走一次 `uploadFiles`
//   铸个新 context（屏上也确实空了！）。第一种：刷新一次数据全回来，等于**没清**；
//   第二种：清干净了，但**旧档案还在后端躺着、H5 链接指着它、名册上多出一份**，
//   等于本票要撤掉的那个「新建」换了个名字又回来了。
//
// 这两种砍半，离线套一条都判不出来（它们发生在接线上，不在 registry 里）。所以本门的主判据
// 全部落在**网络层与身份上**，不落在「屏上空不空」。
//
// ## 判据（每段带自证，防「判据够不着时假装通过」）
//   ⓪ 铺语料 + 问一句真 /advise（落一行历史）——自证：卡片在、清单非空、历史 ≥1。
//   ① 能力探测：这条通道有 `emptyContext`（stub/老后端上整道门无意义，那不是绿是没跑）。
//   ② 🔴 **网络层主判据**：恰好一发 `POST /team/{cid}/empty`，且带 `x-avery-token`。
//      「本地清一清假装清空」这一刀在这里断——它一发请求都不会发。
//   ③ 🔴 **身份判据**（本票的中心句）：`contextId` / `ownerToken` / localStorage 锚点
//      **逐字符不变**，名册长度不变，且清空**之后**一发 `GET /team/{cid}` 真的回 200。
//      「重走一次 uploadFiles 铸新 context」这一刀在这里断。
//   ④ 屏上真的空了（DOM 判据，不读 store）：资料库零行、团队页零人卡、今天页 0 人 0 项目。
//      防的是「后端清了、前端没重渲」。
//   ⑤ 留下的那一半：对话历史在清空**紧接着**仍在屏上（⑤a，防 resetLiteCompanyData 凑数），
//      且从后端**重新拉**一次仍在（⑤b，防后端把它一起清了）。两条断的是两件不同的事。
//   ⑥ 清空之后再往**同一份档案**里补文件：`contextId` 仍不变、清单出现那一行。
//      这就是「一个人从头到尾就一份档案」的可执行形态。
//
// ## ⚠ UI 挂点不在本门射程内
// 左栏那枚「清空这份档案」+ 硬确认（输入店名才放行）由 **#84** 建左栏之后再挂（票面明写）。
// 本门驱动的是 store 动作 `emptyArchive()`——它是那枚键按下去之后要发生的全部事情。
// 🔴 #84 落地时**必须回来补一段**：真点那枚键 + 硬确认走通（照 verify-append-story ② 那条
// 教训——第一版直接调 store，于是「按钮接错线」那条变异活了下来，因为门根本没碰过按钮）。
//
// ## 怎么跑
// 🔴 **上传型门**（真发 POST /ingest + POST /team/{id}/files 造 context，每跑一遍造 1 个），
//    **绝不能排在 C 区之后**——C 区的 bundle-privacy 会把 dist 重打成指向生产域名，
//    此后任何一发上传就是往生产库里写测试数据（2026-07-20 真发生过）。
// 🔴 改过后端必须**按端口杀掉重起 uvicorn**（不热重载，`pkill` 杀不掉且不报错）：
//    `/team/{id}/empty` 是新路由，旧进程上跑会以「② 一发请求都没有 / 回 404」的形态假红。
//   后端：AVERY_BRAIN=mock AVERY_EXTRACTOR=heuristic AVERY_EMBEDDINGS=keyword uvicorn :8137
//   前端：vite build --mode development + vite preview --host --port 5173
//   VERIFY_BASE=http://localhost:5173 node eval-harness/tools/verify-archive-empty.mjs
import { bootPage, makeRec, finish } from './lib/gate-run.mjs'

const UI = process.env.VERIFY_BASE || 'http://127.0.0.1:5173'
const gateRec = makeRec()
const rec = gateRec.rec

const SEAM = '__lite2Store'
const TITLE = '别墅套餐推广'
const DOC_A = '员工花名册.md'
const DOC_B = '项目周报.md'
const DOC_C = '清空后新传的周报.md'

const ROSTER = [
  '# 别墅酒店 员工花名册', '',
  '姓名 | 人员ID | 部门 | 职位 | 司龄',
  '周雅婷 | MKT-001 | 市场推广部 | 市场专员 | 3年',
  '林小满 | FO-0422 | 前厅部 | 前厅主管 | 2年',
].join('\n')
const PROJECT = [`# ${TITLE}`, '负责人：周雅婷', '状态：进行中', '截止：2026-09-30', '进度：40%'].join('\n')
const PROJECT_AFTER = ['# 夜宵档口试营业', '负责人：林小满', '状态：进行中', '截止：2026-11-30',
  '进度：20%'].join('\n')

let browser
const boot = await bootPage({
  browser, url: `${UI}/?v=2&mode=live&look=paper&lang=zh`, trackPageErrors: true,
})
browser = boot.browser
const { context: ctx, page, pageErrors } = boot

// 网络台账。主判据读它，不读 store —— store 只能证明「前端以为自己做了」。
const calls = []
page.on('request', (r) => {
  const u = r.url()
  if (/\/team\/[^/]+\/empty$/.test(u) || /\/ingest$/.test(u) || /\/team\/[^/]+\/files$/.test(u)) {
    calls.push({ method: r.method(), url: u, token: r.headers()['x-avery-token'] || '' })
  }
})
const teamReads = []
page.on('response', (res) => {
  if (/\/team\/[^/]+(\?.*)?$/.test(res.url())) teamReads.push({ url: res.url(), status: res.status() })
})

const st = (fn) => page.evaluate(fn, SEAM)
const upload = (files, action) => page.evaluate(async ({ files, action, seam }) => {
  const enc = new TextEncoder()
  await window[seam].getState()[action](
    files.map((f) => new File([enc.encode(f.text)], f.name, { type: 'text/markdown' })))
}, { files, action, seam: SEAM })

// 🔴 等状态机落定，**超时不许抛**：接错线时那格会永远停在 'idle'，裸 waitForFunction 会等满
// 再把整道门炸掉——炸掉也算红，但读日志的人看到的是一条 playwright 堆栈，不是「接错线了」。
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

// ── ⓪ 铺语料 ────────────────────────────────────────────────────────────────────────────────
await upload([{ name: DOC_A, text: ROSTER }, { name: DOC_B, text: PROJECT }], 'uploadFiles')
await settle('ingestStatus', '⓪ 上传落定')
await page.evaluate((seam) => window[seam].getState().refreshFiles(), SEAM)
await page.waitForTimeout(400)

const seeded = await st((seam) => {
  const s = window[seam].getState()
  return {
    contextId: s.contextId, ownerToken: s.ownerToken,
    people: (s.team?.people ?? []).length, projects: (s.team?.projects ?? []).length,
    files: (s.files ?? []).length, known: (s.knownContexts ?? []).length,
    anchor: window.localStorage.getItem('lite2:contextId:v1'),
    canEmpty: !!s.transport.emptyContext,
  }
})
rec('⓪ 自证：语料真的进去了（有 contextId、有人卡、有项目卡、清单非空）',
  !!seeded.contextId && seeded.people >= 2 && seeded.projects >= 1 && seeded.files === 2,
  JSON.stringify(seeded))
rec('⓪ 自证：手上真握着 owner_token 且锚点已落地（③ 的对照基准，取不到则③恒真）',
  !!seeded.ownerToken && seeded.anchor === seeded.contextId,
  `token=${seeded.ownerToken ? 'yes' : 'MISSING'} anchor=${seeded.anchor}`)

// 🔴 ④ 的对照基准，必须**在清空之前**采一次。少了它，「清空后 `.upload-file-row` 为 0」是一条
// 现成的空真判据：导航没跳过去、选择器写错、屏整块没挂——三种情况下它都为 0 而且全绿。
await page.evaluate((seam) => window[seam].getState().goScreen('files'), SEAM)
await page.waitForTimeout(700)
const filesDomBefore = await page.evaluate(() => ({
  screen: document.querySelectorAll('.lite-files').length,
  rows: document.querySelectorAll('.lite-files .upload-file-row').length,
}))
rec('⓪ 自证：清空**之前**资料库屏上真的列着两行（④ 的对照基准）',
  filesDomBefore.screen === 1 && filesDomBefore.rows === 2, JSON.stringify(filesDomBefore))

// ── ① 能力探测 ──────────────────────────────────────────────────────────────────────────────
rec('① 这条通道有 emptyContext（stub/老后端上整道门无意义——那不是绿，是没跑）',
  seeded.canEmpty === true, String(seeded.canEmpty))

// ── ⓪b 问一句，落一行历史（⑤ 的语料）────────────────────────────────────────────────────────
await page.evaluate((seam) => window[seam].getState().goScreen('room'), SEAM)
await page.waitForTimeout(500)
const composer = page.locator('.lite-room .nexus-followup-composer [data-composer-input]')
await composer.click()
await composer.pressSequentially('前厅这周排班怎么排？', { delay: 10 })
await composer.press('Enter')
await page.waitForFunction((seam) => {
  const turns = window[seam].getState().turns ?? []
  const last = turns[turns.length - 1]
  return !!last && ['complete', 'error', 'interrupted'].includes(last.run.status)
}, SEAM, { timeout: 60000 }).catch(() => {})
await page.evaluate((seam) => window[seam].getState().refreshAdviseRuns(), SEAM)
await page.waitForTimeout(500)
const historyBefore = await st((seam) => (window[seam].getState().adviseRuns ?? []).length)
rec('⓪b 自证：真落了一行对话历史（⑤ 的判据没有它就是空真）', historyBefore >= 1, String(historyBefore))

// ── ② 清空：网络层主判据 ────────────────────────────────────────────────────────────────────
calls.length = 0
teamReads.length = 0
const emptied = await st((seam) => window[seam].getState().emptyArchive())
await page.waitForTimeout(800)

const emptyCalls = calls.filter((c) => /\/empty$/.test(c.url))
rec('② store 的 emptyArchive() 报告成功', emptied === true, String(emptied))
rec('② 🔴 真发了 `POST /team/{cid}/empty`，恰好一发（「本地清一清假装清空」在这里断）',
  emptyCalls.length === 1 && emptyCalls[0].method === 'POST'
    && emptyCalls[0].url.endsWith(`/team/${seeded.contextId}/empty`),
  JSON.stringify(emptyCalls))
rec('② 那一发带着 owner_token（写口凭 token 才进得去，漏了服务端回 404）',
  emptyCalls.length === 1 && emptyCalls[0].token === seeded.ownerToken,
  emptyCalls[0]?.token ? 'present' : 'MISSING')
rec('② 🔴 全程**没有**重新铸档案：一发 POST /ingest 都没有',
  calls.filter((c) => /\/ingest$/.test(c.url)).length === 0,
  JSON.stringify(calls.map((c) => `${c.method} ${c.url.replace(/^https?:\/\/[^/]+/, '')}`)))

// ── ③ 身份判据（本票的中心句）──────────────────────────────────────────────────────────────
await page.evaluate((seam) => window[seam].getState().refreshTeam(), SEAM)
await page.waitForTimeout(600)
const after = await st((seam) => {
  const s = window[seam].getState()
  return {
    contextId: s.contextId, ownerToken: s.ownerToken,
    anchor: window.localStorage.getItem('lite2:contextId:v1'),
    known: (s.knownContexts ?? []).length,
    emptyError: s.archiveEmptyError, emptying: s.archiveEmptying,
  }
})
rec('③ 🔴 context_id 逐字符不变（变了就是「另开一份」——正是本票要撤掉的东西）',
  after.contextId === seeded.contextId, `${seeded.contextId} → ${after.contextId}`)
rec('③ 🔴 owner_token 逐字符不变（没了 = 用户手上那份锚点作废，档案回不去了）',
  after.ownerToken === seeded.ownerToken && !!after.ownerToken,
  after.ownerToken === seeded.ownerToken ? 'same' : 'CHANGED')
rec('③ localStorage 锚点仍指着同一份档案', after.anchor === seeded.contextId, String(after.anchor))
rec('③ 名册没多出一份（恒 1 份档案）', after.known === seeded.known,
  `${seeded.known} → ${after.known}`)
rec('③ 忙态已归位、没有错误挂着', after.emptying === false && after.emptyError === null,
  JSON.stringify({ emptying: after.emptying, err: after.emptyError }))
const okRead = teamReads.find((r) => r.url.includes(seeded.contextId) && r.status === 200)
rec('③ 🔴 清空之后老 token 仍然打得开这份档案（GET /team/{cid} 回 200）——「档案还在」的可执行定义',
  !!okRead, JSON.stringify(teamReads.slice(-3)))

// ── ④ 屏上真的空了（DOM 判据，不读 store）──────────────────────────────────────────────────
await page.evaluate((seam) => window[seam].getState().goScreen('files'), SEAM)
await page.waitForTimeout(700)
const filesDom = await page.evaluate(() => ({
  screen: document.querySelectorAll('.lite-files').length,
  manifests: document.querySelectorAll('.lite-files .upload-files').length,
  rows: document.querySelectorAll('.lite-files .upload-file-row').length,
}))
// 自证与判据分成两条：屏挂着是前提，行数为 0 才是判据。写成一条 `rows === 0` 就是空真
// （屏没挂时它同样成立）。⓪ 那条对照基准与这一条构成 2 → 0 的真变化。
rec('④ 自证：资料库屏确实挂着（判据够不着时不许假装通过）', filesDom.screen === 1,
  JSON.stringify(filesDom))
rec('④ 资料库屏上一行文件都不剩（判据落 DOM——防「store 清了、屏没重渲」）',
  filesDomBefore.rows === 2 && filesDom.rows === 0,
  `${filesDomBefore.rows} 行 → ${filesDom.rows} 行`)

await page.evaluate((seam) => window[seam].getState().goScreen('team'), SEAM)
await page.waitForTimeout(600)
const teamDom = await st((seam) => {
  const s = window[seam].getState()
  return { people: (s.team?.people ?? []).length, projects: (s.team?.projects ?? []).length,
           headline: s.rawTeam?.briefing?.headline ?? '' }
})
rec('④ 团队面归零（人卡 0 / 项目卡 0）', teamDom.people === 0 && teamDom.projects === 0,
  JSON.stringify(teamDom))
rec('④ briefing 跟着说实话（0 人 0 项目），不是还挂着清空前的计数',
  /0 people, 0 projects/.test(teamDom.headline), teamDom.headline || '(空)')

// ── ⑤ 留下的那一半 ──────────────────────────────────────────────────────────────────────────
const historyLocal = await st((seam) => (window[seam].getState().adviseRuns ?? []).length)
rec('⑤a 清空**紧接着**对话历史仍在本地（走 resetLiteCompanyData 凑数的实现在这里断）',
  historyLocal === historyBefore && historyLocal >= 1, `${historyBefore} → ${historyLocal}`)
await page.evaluate((seam) => window[seam].getState().refreshAdviseRuns(), SEAM)
await page.waitForTimeout(600)
const historyRemote = await st((seam) => (window[seam].getState().adviseRuns ?? []).length)
rec('⑤b 从后端**重新拉**一次，历史还在（后端确实没把它一起清掉）',
  historyRemote >= 1, `${historyRemote} 行`)

// ── ⑥ 清空之后再往同一份档案里补文件 ────────────────────────────────────────────────────────
await upload([{ name: DOC_C, text: PROJECT_AFTER }], 'appendFiles')
await settle('appendStatus', '⑥ 补料落定')
await page.evaluate((seam) => window[seam].getState().refreshFiles(), SEAM)
await page.waitForTimeout(600)
const reused = await st((seam) => {
  const s = window[seam].getState()
  return { contextId: s.contextId, keys: (s.files ?? []).map((f) => f.source_key ?? f.filename),
           projects: (s.team?.projects ?? []).length, known: (s.knownContexts ?? []).length }
})
rec('⑥ 🔴 补料落回**同一个** context_id（「一个人从头到尾就一份档案」的可执行形态）',
  reused.contextId === seeded.contextId, `${seeded.contextId} → ${reused.contextId}`)
rec('⑥ 清单里恰好只有刚补的那一份（清空是真的，旧的没回来）',
  reused.keys.length === 1 && reused.keys[0] === DOC_C, JSON.stringify(reused.keys))
rec('⑥ 名册仍然只有一份档案', reused.known === seeded.known, `${seeded.known} → ${reused.known}`)

rec('无 pageerror', pageErrors.length === 0, pageErrors.slice(0, 2).join(' | ') || '0 条')
await ctx.close()

await finish(gateRec, { browser, label: '#86 清空这份档案', listFailures: true })
