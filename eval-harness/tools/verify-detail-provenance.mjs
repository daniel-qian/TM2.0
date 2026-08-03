// 详情浮层溯源诚实性门（票 #37）。
//
// ## 这道门防的是什么
// DetailOverlay 曾经在卡片详情底部渲染一节「出处：你上传的文件」，喂给它的是
// `team.sourceFiles`——一个**工作区级**的全量文件名清单，与被打开的那张卡毫无关系。
// 后果：16 个人的详情逐字打印同一份 9 文件清单（人力经理的「出处」里列着另外两个人的
// 简历）；纯手打、六个字段全挂「手动编辑」角标的项目，详情里照样列出全部 9 份文档。
// 产品的核心主张是「没有一处是编的」、可溯源到具体文件——拿工作区级清单冒充卡片级溯源，
// 直接削弱的就是这条主张。
//
// ## 判据为什么这么写（而不是「断言 .lite-detail-source 不存在」）
// 那样写是**黑名单**：换个 class 名、换个组件重新实现同一个谎，门照样绿。
// 这里改成对**事实**下断言：把这次真上传的文件名当作已知集合，断言详情卡的可见文本里
// **一个都不出现**。任何形式的"把工作区文件清单塞进卡片详情"都会被它逮到，
// 与用什么 class/组件无关。
// 🔴 两条自证判据防空跑（判据够不着的时候会假装通过——这是本仓反复栽的坑）：
//   ① 工作区文件名集合必须非空，否则"一个都不出现"是废话；
//   ② 详情卡必须真的开着且渲染出了这张卡自己的内容（名字在场），否则关着的浮层永远绿。
//
// ## 怎么跑
// 🔴 上传型门（真发 POST /ingest 造 context），**绝不能排在 C 区之后**。
//   后端：AVERY_BRAIN=mock AVERY_EXTRACTOR=heuristic AVERY_EMBEDDINGS=keyword uvicorn :8137
//   前端：vite build --mode development + vite preview --host 127.0.0.1 --port 5173
//   VERIFY_BASE=http://localhost:5173 node eval-harness/tools/verify-detail-provenance.mjs
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { bootPage, makeRec, finish } from './lib/gate-run.mjs'

const UI = process.env.VERIFY_BASE || 'http://127.0.0.1:5173'
const SEED_DIR = process.env.AVERY_DEMO_SEED_DIR || 'eval-harness/tests/fixtures/demo-seed'
const gateRec = makeRec()
const rec = gateRec.rec

// 真语料：用 demo seed 那批 md（多份、文件名互不相同——正是"别人的简历出现在我的出处里"
// 这个症状需要的形状）。
const SEEDS = readdirSync(SEED_DIR)
  .filter((n) => n.endsWith('.md'))
  .map((n) => ({ name: n, text: readFileSync(join(SEED_DIR, n), 'utf8') }))

let browser

async function driveShell({ label, url, storeSeam }) {
  console.log(`\n═══ ${label} ═══`)
  const boot = await bootPage({ browser, url, trackPageErrors: true })
  browser = boot.browser
  const { context: ctx, page, pageErrors } = boot
  const tag = (n) => `[${label}] ${n}`

  await page.evaluate(
    async ({ seeds, seam }) => {
      const enc = new TextEncoder()
      const files = seeds.map((s) => new File([enc.encode(s.text)], s.name, { type: 'text/markdown' }))
      await window[seam].getState().uploadFiles(files)
    },
    { seeds: SEEDS, seam: storeSeam },
  )
  await page.waitForFunction(
    (seam) => ['ready', 'error'].includes(window[seam].getState().ingestStatus),
    storeSeam, { timeout: 60000 },
  )

  // ① 自证：工作区级文件名集合必须非空，否则下面"一个都不出现"是空断言。
  const workspaceFiles = await page.evaluate(
    (seam) => window[seam].getState().team?.sourceFiles ?? [],
    storeSeam,
  )
  rec(tag('自证：工作区级文件清单非空（否则下面的判据是废话）'),
    workspaceFiles.length > 0, `${workspaceFiles.length} 份: ${workspaceFiles.slice(0, 3).join(' / ')}…`)

  const targets = await page.evaluate((seam) => {
    const st = window[seam].getState()
    const people = (st.team?.people ?? []).slice(0, 3).map((p) => ({ kind: 'person', id: p.id, name: p.name }))
    const projects = (st.team?.projects ?? []).slice(0, 1).map((p) => ({ kind: 'project', id: p.id, name: p.title }))
    return [...people, ...projects]
  }, storeSeam)
  rec(tag('自证：至少采到 2 张卡可供打开（人卡 + 项目卡）'), targets.length >= 2,
    targets.map((t) => `${t.kind}:${t.name}`).join(' · ') || '(空)')

  for (const target of targets) {
    await page.evaluate(({ seam, t }) => window[seam].getState().openDetail(t.kind, t.id), { seam: storeSeam, t: target })
    await page.waitForTimeout(400)

    const probe = await page.evaluate(({ files, name }) => {
      const card = document.querySelector('.lite-detail-card')
      if (!card) return { open: false }
      const text = card.innerText || ''
      return {
        open: true,
        showsOwnName: text.includes(name),
        leaked: files.filter((f) => text.includes(f)),
        chips: card.querySelectorAll('.upload-source-chip').length,
      }
    }, { files: workspaceFiles, name: target.name })

    // ② 自证：浮层真开着、且渲染出了这张卡自己的内容——关着的浮层不该算通过。
    rec(tag(`${target.kind}「${target.name}」详情真的开着且渲染了本卡内容`),
      probe.open === true && probe.showsOwnName === true, JSON.stringify(probe))
    // 主判据：工作区级文件名一个都不许出现在这张卡的详情里。
    rec(tag(`${target.kind}「${target.name}」详情不含任何工作区级文件名（#37 溯源诚实）`),
      probe.open === true && probe.leaked.length === 0,
      probe.leaked && probe.leaked.length ? `泄漏 ${probe.leaked.length} 个: ${probe.leaked.slice(0, 4).join(' / ')}` : '0 个')

    await page.evaluate((seam) => window[seam].getState().closeDetail(), storeSeam)
    await page.waitForTimeout(250)
  }

  rec(tag('无 pageerror'), pageErrors.length === 0, pageErrors.slice(0, 2).join(' | ') || '0 条')
  await ctx.close()
}

await driveShell({ label: 'v02', url: `${UI}/?v=2&mode=live&look=paper&lang=zh`, storeSeam: '__lite2Store' })
await driveShell({ label: 'v01', url: `${UI}/?v=1&mode=live&lang=zh`, storeSeam: '__liteStore' })

await finish(gateRec, { browser, label: '详情浮层溯源诚实' })
