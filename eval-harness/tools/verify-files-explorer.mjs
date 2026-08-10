// verify-files-explorer.mjs —— #84 资料库两栏 file explorer（design-0810 · 设计轮票 2）。
//
// ## 补的是哪两块空白
// ① **手机态在所有既有门里零覆盖**。既有门的视口一律硬钉 1280×900 或最小 900 > 860，而
//    本票最实的一条病根恰恰只在 390px 上发生：9 行文件量出 **4 种高度、3 种内部顺序**，
//    因为整行是 flex-wrap、折行位置由**文件名长度**决定
//    （证据 `.issues/design-0810/_shots-0810/files-mobile.png`）。#83 给对话侧栏补过同一
//    块账（verify-room-rail），资料库这一半到本票才结清。
// ② **桌面这一屏的视觉规格只有像素基线看着**，而 visual.spec 的 files 那 4 张拍的是
//    **空态**（`?transport=stub` 在 build 产物上是死开关 → 真 transport + fresh context）。
//    列宽、数字列对齐、行动作恒占位、上传口在不在工具条上——满数据态一张都盖不到。
//
// ## 判据设计的三条纪律（都在本仓吃过亏）
//  ⒜ **判据落在被测属性本身，不落下游后果**。「五列×两行的固定骨架」断的是**每一行的六个
//     格子的相对落位逐行相同**，不是「行看起来一样高」——后者对着「高度恰好撞上」的坏实现
//     照样全绿（#83 的 M-C 变异就是这么活下来的：两行式恰好收成 40px，正落在 [30,40] 的
//     尺子里。**尺子太宽 = 对着真违规也全绿**）。
//  ⒝ **伪元素的计算值不证明它上了屏**：`getComputedStyle(el,'::before')` 对一个根本没生成
//     的伪元素照样把规则里写的 width/background 原样吐回来（#83 的 M-F）。所以左封条那条
//     判据把 `content` 一起判死。
//  ⒞ **自证前提与判别判据分开写**。「屏上有 9 行」是前提；「9 行的落位矩阵只有一种」才是判据。
//
// 环境：build+preview（`?transport=stub` 在产物上是死开关）+ 真 mock 后端 + 显式 ?lang=zh。
//   VERIFY_BASE=http://127.0.0.1:5284 node eval-harness/tools/verify-files-explorer.mjs
import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { bootPage, dismissOnboard, makeRec, finish } from './lib/gate-run.mjs'

const UI = process.env.VERIFY_BASE || 'http://127.0.0.1:5173'
const SEAM = '__lite2Store'
const { rows: recRows, rec } = makeRec()
const HERE = dirname(fileURLToPath(import.meta.url))
const SEED_DIR = join(HERE, '..', 'tests', 'fixtures', 'demo-seed')

// 🔴 语料必须是**真的 demo-seed 九份中文文件**，不能自己编两个短名字：病根④由文件名长短
//    触发（长名折行、短名不折），喂短名 = 把病根喂没了，门变成一条恒绿的空判据。
//    本仓刚在同一处栽过一次：3 份文件时探针完全正常（列表没溢出→flex 不收缩），
//    9 份时行才被压扁——「语料喂不饱，病根根本不发生」。
const seedFiles = () =>
  readdirSync(SEED_DIR).filter((n) => n.endsWith('.md')).sort()
    .map((n) => ({ name: n, mimeType: 'text/markdown', buffer: readFileSync(join(SEED_DIR, n)) }))

// 六个格子的类名，顺序即桌面列序。
const CELLS = ['upload-file-name', 'upload-file-size', 'upload-file-chunks',
  'upload-file-time', 'upload-file-status', 'upload-file-acts']

// 一行的「落位指纹」：六个格子按 (row, col) 归一化后的相对次序。
// 用**格心的 y 带 + x 次序**而不是像素值：像素值随文件名长短天然不同（那是内容，不是结构），
// 而落位是结构。同一个骨架下，九行的指纹必须逐字相同。
const FINGERPRINT = (cells) => {
  const bands = [...new Set(cells.map((c) => Math.round(c.cy)))].sort((a, b) => a - b)
  return cells
    .map((c) => ({ cls: c.cls, band: bands.indexOf(Math.round(c.cy)), x: c.x }))
    .sort((a, b) => a.band - b.band || a.x - b.x)
    .map((c) => `${c.band}:${c.cls}`)
    .join('|')
}

const measureRows = (page) => page.evaluate((cellClasses) => {
  const rows = [...document.querySelectorAll('.lite-files .upload-file-row')]
  return rows.map((r) => {
    const rr = r.getBoundingClientRect()
    return {
      h: Math.round(rr.height),
      name: r.querySelector('.upload-file-name-text')?.textContent ?? '',
      cells: cellClasses.map((cls) => {
        const el = r.querySelector('.' + cls)
        if (!el) return null
        const b = el.getBoundingClientRect()
        // 相对行框归一化：整行在页面上的绝对位置不是结构，格子在行内的相对位置才是。
        return {
          cls, x: Math.round(b.left - rr.left), cy: Math.round(b.top + b.height / 2 - rr.top),
          // 溢出量：格子跑出行框多少像素（正数=真跑出去了）。
          over: Math.round(Math.max(0, b.bottom - rr.bottom, rr.top - b.top)),
        }
      }).filter(Boolean),
    }
  })
}, CELLS)

let browser

// ══ A 区 · 桌面 1440×900 ══════════════════════════════════════════════════════════════
{
  const boot = await bootPage({
    browser, url: `${UI}/?v=2&mode=live&look=paper&lang=zh`,
    viewport: { width: 1440, height: 900 }, trackPageErrors: true,
  })
  browser = boot.browser
  const { context: ctx, page, pageErrors } = boot
  await dismissOnboard(page)
  await page.evaluate((seam) => window[seam].getState().goScreen('files'), SEAM)
  await page.waitForTimeout(400)

  // ── A① 上传口真的长在工具条上（Danny 原话：「上传窗口和它放在一起」）──────────────
  const bar = await page.evaluate(() => {
    const tb = document.querySelector('.lite-files-toolbar')
    const btn = tb?.querySelector('.lite-files-upload-action')
    const input = tb?.querySelector('input.upload-input')
    return {
      toolbar: !!tb, btn: !!btn, input: !!input,
      // 改造前这一屏有**两个**长得几乎一样、方向却相反的 dropzone。
      dropzones: document.querySelectorAll('.lite-files .upload-dropzone').length,
      // 排序必须是自绘控件：原生 `<select>` 是「没上皮肤」在这块屏上最刺眼的一处。
      nativeSelects: document.querySelectorAll('.lite-files .upload-files-sort-select').length,
    }
  })
  rec('A① 上传主钮与真 input 都在工具条里（不是另开一块面板）',
    bar.toolbar && bar.btn && bar.input, JSON.stringify(bar))
  rec('A① 🔴 文件工作台上只剩一个上传口：老式 dropzone 方框一个都不在',
    bar.dropzones === 0, `${bar.dropzones} 个`)
  rec('A① 排序换成了自绘控件（原生未上样式的 <select> 归零）',
    bar.nativeSelects === 0, `${bar.nativeSelects} 个原生 select`)

  // ── A② 左栏规格（与 #83 对话侧栏同一套；这里量的是资料库这一根）────────────────────
  // 🔴 「下陷」量的是**合成后亮度低于身后那张面**，不写 rgba 字面量——写死的尺子换张皮就瞎。
  const railGeom = await page.evaluate(() => {
    const rail = document.querySelector('.lite-files-rail')
    const pane = document.querySelector('.lite-files-pane')
    if (!rail || !pane) return null
    const parse = (s) => (s.match(/[\d.]+/g) ?? []).map(Number)
    // 🔴 「下陷」＝栏那一层压在**暖纸画布**上之后比画布更暗。这条判据被自己的变异逮到过
    //    **两次**，两次都是「量错了东西」，值得把过程留下来：
    //    ⓐ 第一版拿 `document.body` 当身后那张面 → body 是 `rgba(0,0,0,0)`，身后亮度恒为 0，
    //       于是对着一根**真下陷**的栏永远红（假红）。
    //    ⓑ 第二版改成「往祖先链上合成到第一张不透明的面」。**实测**（`_px84/lumprobe.mjs`）
    //       这条链从 `aside` 一路到 `BODY` **全是 `rgba(0,0,0,0)`**——暖纸不是任何一个祖先的
    //       `background-color`。于是合成兜底成纯白 255，M-A（栏翻回不透明白卡片 253）在
    //       255 面前照样"更暗"，**变异活了下来**（假绿）。
    //    所以这里不再爬祖先链：对照物直接取**画布令牌** `--lite2-paper-rgb`。它跟着皮走
    //    （不是写死的 rgba 字面量，换皮不瞎），而且它就是设计正源 §2.2 里那句「比暖纸画布
    //    更暗一档」说的那张面。
    const canvas = parse(getComputedStyle(rail).getPropertyValue('--lite2-paper-rgb'))
    const lumOver = (bgStr, base) => {
      const c = parse(bgStr)
      const a = c.length >= 4 ? c[3] : 1
      const m = [0, 1, 2].map((i) => (c[i] ?? 0) * a + base[i] * (1 - a))
      return 0.2126 * m[0] + 0.7152 * m[1] + 0.0722 * m[2]
    }
    const r = rail.getBoundingClientRect()
    const cs = getComputedStyle(rail)
    return {
      w: Math.round(r.width), top: Math.round(r.top), bottom: Math.round(r.bottom),
      vh: window.innerHeight,
      canvas,
      railLum: lumOver(cs.backgroundColor, canvas),
      pageLum: lumOver('rgba(0, 0, 0, 0)', canvas),
      paneBg: getComputedStyle(pane).backgroundColor,
      borderRight: cs.borderRightWidth,
    }
  })
  // 自证：画布令牌真的读到了三个数——读不到时 `canvas` 是空数组，上面两个亮度都会变成
  // NaN，而 `NaN < NaN` 为 false ⇒ 判据以「凸起」的形态红。那是假红，不是缺陷。
  rec('A② 自证：画布令牌 --lite2-paper-rgb 读得到（读不到则下面那条恒红，是假红不是缺陷）',
    Array.isArray(railGeom?.canvas) && railGeom.canvas.length === 3,
    JSON.stringify(railGeom?.canvas))
  rec('A② 左栏宽 208（规格 §2.2；写死的常量，不随内容自适应）',
    railGeom?.w === 208, JSON.stringify(railGeom))
  rec('A② 🔴 下陷不是凸起：栏合成后的亮度低于身后那张画布（换皮不瞎的量法）',
    !!railGeom && railGeom.railLum < railGeom.pageLum,
    `rail=${railGeom?.railLum?.toFixed(1)} page=${railGeom?.pageLum?.toFixed(1)}`)
  rec('A② 🔴 贴边通到底（top===0 且 bottom===视口底），消灭两道悬空截断边',
    railGeom?.top === 0 && railGeom?.bottom === railGeom?.vh, JSON.stringify(railGeom))
  rec('A② 右界是一根硬线，不是阴影', railGeom?.borderRight === '1px', railGeom?.borderRight)

  const railRow = await page.evaluate(() => {
    const row = document.querySelector('[data-files-zone="files"]')
    const cur = document.querySelector('[data-files-zone][data-current="1"]')
    const label = document.querySelector('.lite-files-rail-group-label')
    const rail = document.querySelector('.lite-files-rail')
    if (!row) return null
    const seal = cur ? getComputedStyle(cur, '::before') : null
    return {
      h: Math.round(row.getBoundingClientRect().height),
      pad: getComputedStyle(row).paddingLeft,
      radius: getComputedStyle(row).borderTopLeftRadius,
      curZone: cur?.getAttribute('data-files-zone') ?? null,
      curWeight: cur ? getComputedStyle(cur).fontWeight : null,
      // ⒝ content 必须一起判死：没生成的伪元素照样吐回规则里的 width/background。
      sealContent: seal?.content ?? null,
      sealWidth: seal?.width ?? null,
      sealBg: seal?.backgroundColor ?? null,
      groupLabelColor: label ? getComputedStyle(label).color : null,
      // 🔴 **归一化成同一种写法再比**。第一版拿计算值 `rgb(94, 90, 81)` 直接与令牌原文
      //    `#918b7f` 比字符串——两者永远不相等，于是这条判据恒真，M-E（组标掉回
      //    `--ink-faint`）**活了下来**。
      // ⚠ 这里刻意**不**改判成「≥ AA 4.5」：#80 的碑说的是 11px 的 faint 在 paper 上有
      //    ~4.7:1，**过得了 AA**——AA 尺子对这条变异同样没牙。要判的就是「吃的是哪个令牌」。
      inkSoft: hexToRgb(getComputedStyle(rail || document.documentElement)
        .getPropertyValue('--ink-soft').trim()),
      inkFaint: hexToRgb(getComputedStyle(rail || document.documentElement)
        .getPropertyValue('--ink-faint').trim()),
    }
    function hexToRgb(h) {
      const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(h)
      return m ? `rgb(${parseInt(m[1], 16)}, ${parseInt(m[2], 16)}, ${parseInt(m[3], 16)})` : h
    }
  })
  rec('A③ 行高 34px（与对话侧栏同一节奏）', railRow?.h === 34, `${railRow?.h}px`)
  rec('A③ 行内距 10px / 圆角 8px', railRow?.pad === '10px' && railRow?.radius === '8px',
    `${railRow?.pad} / ${railRow?.radius}`)
  rec('A③ 🔴 选中行有 2px accent 左封条，且 `content` 不是 none（伪元素的计算值不证明它上了屏）',
    railRow?.sealContent !== 'none' && railRow?.sealWidth === '2px' &&
    /rgb/.test(railRow?.sealBg ?? ''),
    `content=${railRow?.sealContent} w=${railRow?.sealWidth} bg=${railRow?.sealBg}`)
  rec('A③ 选中行 600 字重', railRow?.curWeight === '600', railRow?.curWeight)
  rec('A③ 🔴 组标吃 --ink-soft **不吃** --ink-faint（11px 的 faint 在 paper 上只有 ~4.7:1，#80 的碑）',
    !!railRow && railRow.groupLabelColor !== null &&
    railRow.groupLabelColor !== railRow.inkFaint, JSON.stringify({
      color: railRow?.groupLabelColor, faint: railRow?.inkFaint, soft: railRow?.inkSoft }))

  // ── A④ 单层标题（双标题收成一层）───────────────────────────────────────────────────
  const heads = await page.evaluate(() => ({
    h2: document.querySelectorAll('.lite-files-pane h2').length,
    eyebrow: document.querySelectorAll('.lite-files-pane .eyebrow').length,
    sub: document.querySelectorAll('.lite-files-sub').length,
    navChips: document.querySelectorAll('.lite-files-nav-link').length,
    visibleSectionTitles: [...document.querySelectorAll('.lite-files-pane .lite-files-section-title')]
      .filter((n) => getComputedStyle(n).display !== 'none').length,
  }))
  rec('A④ 🔴 工作台上只有一层标题（h2 恰好 1 + 眉标/副标/段标题/胶囊导航全部归零）',
    heads.h2 === 1 && heads.eyebrow === 0 && heads.sub === 0 &&
    heads.navChips === 0 && heads.visibleSectionTitles === 0, JSON.stringify(heads))

  // ── 真上传：下面的表格判据从这里起才有语料 ─────────────────────────────────────────
  await page.locator('input.upload-input').setInputFiles(seedFiles())
  await page.locator('.upload-ready, .upload-error').first().waitFor({ timeout: 90000 })
  const uploadFailed = await page.locator('.upload-error').count()
  rec('A⑤ 自证：走**屏上那个入口**的上传真的成功了（本票交付的就是这个口子）',
    uploadFailed === 0, `${uploadFailed} 个错误块`)
  await page.waitForTimeout(900)
  const deskRows = await measureRows(page)
  rec('A⑤ 自证：屏上真有 9 行（下面全部表格判据的前提，不成立则整段空跑）',
    deskRows.length === 9, `${deskRows.length} 行`)

  const table = await page.evaluate(() => {
    const t = document.querySelector('.upload-files--table')
    const row = document.querySelector('.upload-files--table .upload-file-row')
    const head = document.querySelector('.upload-files-colhead')
    const size = row?.querySelector('.upload-file-size')
    const chunks = row?.querySelector('.upload-file-chunks')
    const acts = row?.querySelector('.upload-file-acts')
    const cs = row ? getComputedStyle(row) : null
    return {
      cols: cs?.gridTemplateColumns ?? '',
      headCols: head ? getComputedStyle(head).gridTemplateColumns : '',
      display: cs?.display ?? '',
      numeric: size ? getComputedStyle(size).fontVariantNumeric : '',
      numericChunks: chunks ? getComputedStyle(chunks).fontVariantNumeric : '',
      alignSize: size ? getComputedStyle(size).textAlign : '',
      alignChunks: chunks ? getComputedStyle(chunks).textAlign : '',
      actsW: acts ? Math.round(acts.getBoundingClientRect().width) : 0,
      actsOpacity: acts ? getComputedStyle(acts).opacity : '',
      // ⒞ 只用 opacity 藏，绝不 pointer-events:none——后者会让 files-ia ⑤ 的三次点击
      //    **超时崩门**而不是变红。
      actsPointer: acts ? getComputedStyle(acts).pointerEvents : '',
      tableW: t ? Math.round(t.getBoundingClientRect().width) : 0,
      paneW: Math.round(document.querySelector('.lite-files-pane').getBoundingClientRect().width),
    }
  })
  const fixedCols = table.cols.split(/\s+/).filter(Boolean)
  rec('A⑥ 🔴 真列不是 flex 汤：行是 grid，且列数恰好 6（名/大小/片段/时间/状态/动作）',
    table.display === 'grid' && fixedCols.length === 6, `${table.display} · ${table.cols}`)
  rec('A⑥ 列头与数据行**同一套列宽**（对不齐的表头比没有表头更糟）',
    table.headCols === table.cols, `${table.headCols} vs ${table.cols}`)
  // 🔴 钉**具体那五个数**，不是「看起来像 px」。第一版第二个合取项写的是
  //    `new Set(...).size >= 1`——恒真，等于只查了「不是 fr」。规格 §2.4.3 说的是列宽钉死，
  //    钉死就有具体值；改列宽时这条常量跟着改一次，比留半把尺子强。
  const WANT_COLS = ['76px', '96px', '132px', '92px', '72px']
  rec('A⑥ 🔴 除文件名外的五列宽度**逐像素固定**（不随内容伸缩——名字长短不许改变结构）',
    JSON.stringify(fixedCols.slice(1)) === JSON.stringify(WANT_COLS),
    `${JSON.stringify(fixedCols.slice(1))} vs ${JSON.stringify(WANT_COLS)}`)
  rec('A⑦ 数字列 tabular-nums + 右对齐（列与列之间的数字才对得齐）',
    /tabular-nums/.test(table.numeric) && /tabular-nums/.test(table.numericChunks) &&
    table.alignSize === 'right' && table.alignChunks === 'right', JSON.stringify(table))
  rec('A⑧ 🔴 行动作**格子恒占位**（静息态 opacity 0 但宽度不为 0——现出来时不推挤别的列）',
    table.actsW > 0 && table.actsOpacity === '0', `w=${table.actsW} opacity=${table.actsOpacity}`)
  rec('A⑧ 🔴 藏法只用 opacity，没有 pointer-events:none（加了会让删除那三次点击超时**崩门**）',
    table.actsPointer !== 'none', table.actsPointer)
  rec('A⑨ 表格有阅读上限 1120（工作台自己占满；撑满 1440 会拉出近 900px 空档）',
    table.tableW <= 1120 && table.paneW > 1120, `表 ${table.tableW} / 台 ${table.paneW}`)

  // ── A⑩ 拖放接的是整块工作台，不是一个小方框 ────────────────────────────────────────
  // ⚠ dispatch 与读取必须**分两次 evaluate**：React 的 setState 是批量异步的，同一个
  //   同步块里读 className 永远读到旧值——那会是一条对着**正确实现**恒红的假红。
  await page.evaluate(() => {
    const pane = document.querySelector('.lite-files-pane')
    const dt = new DataTransfer()
    pane?.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt }))
  })
  await page.waitForTimeout(200)
  const dropWide = await page.evaluate(() =>
    document.querySelector('.lite-files-pane')?.className.includes('is-dragover') ?? null)
  rec('A⑩ 🔴 整块工作台接拖放（在工作台任意处 dragover 就进投放态）', dropWide === true,
    String(dropWide))

  rec('A 无 pageerror', pageErrors.length === 0, pageErrors.slice(0, 2).join(' | ') || '0 条')
  await ctx.close()
}

// ══ B 区 · 手机 390×844（既有门全部够不着的那一块）══════════════════════════════════
{
  const boot = await bootPage({
    browser, url: `${UI}/?v=2&mode=live&look=paper&lang=zh`,
    viewport: { width: 390, height: 844 }, trackPageErrors: true,
  })
  browser = boot.browser
  const { context: ctx, page, pageErrors } = boot
  await dismissOnboard(page)
  await page.evaluate((seam) => window[seam].getState().goScreen('files'), SEAM)
  await page.waitForTimeout(300)
  await page.locator('input.upload-input').setInputFiles(seedFiles())
  await page.locator('.upload-ready, .upload-error').first().waitFor({ timeout: 90000 })
  await page.waitForTimeout(900)

  const mRows = await measureRows(page)
  rec('B① 自证：390px 上真有 9 行（病根④原样复现的语料前提）', mRows.length === 9,
    `${mRows.length} 行`)
  // 🔴 本门的中心句。改造前实测：9 行 → 4 种高度、3 种内部顺序。
  const heights = [...new Set(mRows.map((r) => r.h))]
  const prints = [...new Set(mRows.map((r) => FINGERPRINT(r.cells)))]
  rec('B② 🔴 九行**恰好一种高度**（改造前 4 种；flex-wrap 的汤按文件名长短折行）',
    heights.length === 1, `${heights.length} 种: ${heights.join('/')}`)
  rec('B③ 🔴 九行**恰好一种落位指纹**（改造前 3 种内部顺序）——判据落在格子的相对落位本身，'
    + '不落"看起来一样高"（尺子太宽 = 对着真违规也全绿）',
    prints.length === 1, `${prints.length} 种\n    ${prints.join('\n    ')}`)
  // 🔴 钉**那一种指纹是哪一种**，不是「只要第一格是文件名就行」。第一版写成
  //    `(A && B) || C`，C 只查开头——`&&` 比 `||` 紧，于是整条判据退化成 C 一条，
  //    尺子宽到任何两行式都能过。规格 §2.5 写死的是这一种，就钉这一种；真要改骨架，
  //    这条常量跟着改一次，比留一把量不出东西的尺子强。
  //    （acts 自成一带是对的：它 `grid-row: 1 / 3` 跨两行，格心落在两带之间。）
  const WANT_PRINT = '0:upload-file-name|1:upload-file-acts|2:upload-file-status|'
    + '2:upload-file-size|2:upload-file-chunks|2:upload-file-time'
  rec('B④ 骨架逐格等于规格里那一种（文件名整行 / 状态·大小·片段·时间第二行 / 动作跨两行）',
    prints.length === 1 && prints[0] === WANT_PRINT, prints[0] ?? '(无)')
  // 🔴 「一种高度」还不够：`.upload-files-list` 是 flex 列，行一旦可收缩就会被**整齐地**
  //    压到 min-height——九行仍然只有一种高度、指纹也不变，而第二行的字整条压到下一行的
  //    背景上（真机拍图逮到的那个 bug 就长这样）。所以另判一条「格子没跑出行框」。
  //    这条是 M-L 变异活下来之后补的：**变异活下来八成是门洞不是代码 bug**。
  const overflow = mRows.flatMap((r) => r.cells.filter((c) => c.over > 1)
    .map((c) => `${r.name.slice(0, 8)}/${c.cls}+${c.over}px`))
  rec('B④b 🔴 每个格子都真的装在行框里（行被 flex 压扁时，九行照样"一种高度一种指纹"）',
    overflow.length === 0, overflow.length ? overflow.slice(0, 5).join(' · ') : '0 处溢出')
  const unit = await page.evaluate(() => {
    const u = document.querySelector('.upload-file-chunks-unit')
    const head = document.querySelector('.upload-files-colhead')
    return {
      unitShown: u ? getComputedStyle(u).display !== 'none' : false,
      unitText: u?.textContent ?? '',
      headShown: head ? getComputedStyle(head).display !== 'none' : false,
    }
  })
  rec('B⑤ 手机上不摆列头，所以片段数自带单位（否则 18 是个无名数）；单位来自词典不是 CSS content',
    unit.headShown === false && unit.unitShown === true && unit.unitText.length > 0,
    JSON.stringify(unit))

  // ── B⑥ 抽屉：不透明 + 真的盖在上面 ─────────────────────────────────────────────────
  const toggle = page.locator('[data-files-toggle]')
  rec('B⑥ 自证：手机上抽屉开关可见（桌面它是 display:none）', await toggle.isVisible())
  await toggle.click()
  await page.waitForTimeout(500)
  const drawer = await page.evaluate(() => {
    const rail = document.querySelector('.lite-files-rail')
    if (!rail) return null
    const cs = getComputedStyle(rail)
    const a = Number((cs.backgroundColor.match(/[\d.]+/g) ?? [0, 0, 0, 1])[3] ?? 1)
    const r = rail.getBoundingClientRect()
    // 两条缺一不可：alpha 管颜色，elementFromPoint 管「它真在上面」。
    const hit = document.elementFromPoint(Math.round(r.width / 2), Math.round(r.top + r.height / 2))
    return {
      open: cs.display !== 'none', alpha: a,
      hitInside: !!hit && rail.contains(hit),
      scrim: document.querySelectorAll('[data-files-scrim]').length,
    }
  })
  rec('B⑥ 🔴 抽屉底色**不透明**（半透明 = 正文从字缝里透出来，且让 contrast 门量出屏上不存在的比值）',
    !!drawer && drawer.open && drawer.alpha >= 0.99, JSON.stringify(drawer))
  rec('B⑥ 🔴 抽屉真的盖在正文之上（elementFromPoint 打在它身上，不是穿过去）',
    drawer?.hitInside === true, JSON.stringify(drawer))
  rec('B⑥ 有遮罩可点（没有遮罩的抽屉，用户不知道点哪儿能关）', drawer?.scrim === 1,
    String(drawer?.scrim))

  // AA：抽屉里的小字。尺子与 verify-contrast-smalltext 逐字同源（4.5 小字 / 3.0 大字）。
  const bad = await page.evaluate(() => {
    const lin = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4 }
    const L = (c) => { const [r, g, b] = c; return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b) }
    const parse = (s) => (s.match(/[\d.]+/g) ?? []).map(Number)
    const bgOf = (el) => {
      let n = el
      while (n && n !== document.documentElement) {
        const c = parse(getComputedStyle(n).backgroundColor)
        if (c.length >= 3 && (c[3] === undefined || c[3] > 0.5)) return c
        n = n.parentElement
      }
      return [255, 255, 255]
    }
    const out = []
    for (const el of document.querySelectorAll('.lite-files-rail *')) {
      const txt = (el.textContent ?? '').trim()
      if (!txt || el.children.length > 0) continue
      const cs = getComputedStyle(el)
      if (cs.display === 'none' || cs.visibility === 'hidden') continue
      const fg = parse(cs.color); const bg = bgOf(el)
      const l1 = L(fg); const l2 = L(bg)
      const ratio = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05)
      const size = parseFloat(cs.fontSize)
      const floor = size >= 18.66 || (size >= 24) || (size >= 18.66 && Number(cs.fontWeight) >= 700) ? 3 : 4.5
      if (ratio < floor) out.push(`${txt.slice(0, 10)}@${size}px=${ratio.toFixed(2)}`)
    }
    return out
  })
  rec('B⑦ 抽屉里每一处小字 ≥ AA（尺子与 contrast-smalltext 同源；那道门的视口够不着这里）',
    bad.length === 0, bad.length ? bad.slice(0, 6).join(' · ') : '0 处')

  rec('B 无 pageerror', pageErrors.length === 0, pageErrors.slice(0, 2).join(' | ') || '0 条')
  await ctx.close()
}

void recRows
await finish({ rows: recRows }, {
  browser, label: '#84 资料库两栏 file explorer', listFailures: true,
})
