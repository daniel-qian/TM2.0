// 判读链路双语对等门（票 #38 · ADR-0033）。
//
// ## 这道门防的是什么
// 语言在这个产品里有**四个互相独立的面**，2026-08-03 之前它们可以各说各话：
//   ① 界面壳文案（前端 i18n，已双语）
//   ② 后端派生文案（`decision_*.py` 里写死的中文——英文用户看到中英夹杂的核心判读面板）
//   ③ LLM 判读正文（**完全不受控**：prompt 里一句语言指令都没有，语言是涌现的）
//   ④ 引文 evidence（客户文档原文，**永远是原文语言**，翻译＝编）
// ADR-0033 把 ②③ 收进 locale 请求字段。这道门是那条链**唯一的端到端见证**：
// 同一份中文语料，跑 `?lang=zh` 与 `?lang=en` 两遍，四条判据分别盯住四个面。
//
// ## 为什么四条判据缺一不可
// ①② 只验界面和派生文案 → prompt 里那句语言指令可以整段消失而没有任何东西变红（③ 是它的护栏）。
// ③ 单独存在 → 有人"顺手把引文也翻了"就没人拦（④ 是它的护栏，也是 ADR-0018 可溯源红线的护栏）。
// 反过来 ④ 如果写成"英文界面下不许有中文"，它会把**正确行为**判成红——引文本来就该是中文。
// 所以判据必须分区：**壳**里不许有异语，**引文**里不许被翻译。分不清这两者的门，
// 要么假红（把中文引文判成缺陷）要么假绿（把中文壳文案放过去）。
//
// ## 判据形态（本仓反复栽过的坑，照做）
// · **白名单**："这个词必须是这三个之一"，不是"这个词不许是那几个"。黑名单换个说法就绕过去了。
// · **自证判据防空跑**：每条主判据前面先断言"这一屏真的渲染出了判读卡 / 规则行 / 引文 / 正文"。
//   采不到样的判据是恒绿的，那种绿最骗人（记忆 verifiers-that-lie）。
// · **语料必须含真中文字节**：直接用 `tests/fixtures/demo-seed/` 那 9 份真周报/简历。
//   语料全 ASCII 的话，"是不是中文"这类判据恒假/恒真，等于没验
//   （记忆 gate-corpus-all-ascii-blindspot）。
// · **两遍问同一个中文问题**：EN 那遍的输入是中文的，正文却必须是英文——这才是
//   「界面语言 ≠ 文档语言」真正要证的事。两遍各问各的语言就把这一条绕过去了。
//
// ## 怎么跑
// 🔴 上传型门（真发 POST /ingest 造 context，两个 locale ＝ 每跑一遍造 2 个 context），
//    **绝不能排在 C 区之后**——C 区跑完 dist 指向生产域名，那之后跑它就是往生产库写数据。
//   后端：AVERY_BRAIN=mock AVERY_EXTRACTOR=heuristic AVERY_EMBEDDINGS=keyword
//         AVERY_DEMO_SEED_DIR="D:/avery/eval-harness/tests/fixtures/demo-seed" uvicorn :8137
//   前端：vite build --mode development + vite preview --host 127.0.0.1 --port 5173
//   VERIFY_BASE=http://localhost:5173 node eval-harness/tools/verify-locale-parity.mjs
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { bootPage, makeRec, finish } from './lib/gate-run.mjs'

const UI = process.env.VERIFY_BASE || 'http://127.0.0.1:5173'
const SEED_DIR = process.env.AVERY_DEMO_SEED_DIR || 'eval-harness/tests/fixtures/demo-seed'
const gateRec = makeRec()
const rec = gateRec.rec

// 真语料：demo seed 那批中文 md（周报 / 简历 / 公司资料）。
const SEEDS = readdirSync(SEED_DIR)
  .filter((n) => n.endsWith('.md'))
  .map((n) => ({ name: n, text: readFileSync(join(SEED_DIR, n), 'utf8') }))

// 两遍问**同一个中文问题**。刻意选判断类问法：`service/live_input.py::_FACTUAL_RE` 命中的
// 查数/查时间问法会走短答出口（一句话），正文太短不好验语言。这句里没有那些词。
const QUESTION = '交付节奏最近有点跟不上，我该怎么跟负责人谈这件事？'

// ── 白名单：每个 locale 的壳文案「必须是这一种」──────────────────────────────────────
// 🔴 这里刻意只钉**锚点**（三个档位词 + 几个固定标签 + 那句话的开头），不抄整张规则表：
// 18 条规则的全量 zh/en 文案由 `tests/test_decision_i18n_contract.py` 逐条对账（含占位符与红线），
// 门再抄一份只会变成第三个会漂的副本。门管"这一屏说的是不是这门语言"，那边管"文案齐不齐"。
const EXPECT = {
  zh: {
    grades: ['高风险', '需确认', '可推进'],
    reasonPrefix: '按规则判为',
    unknownLabel: '文档未提及',
    basisLabel: '看的字段',
    evidenceLabel: '文件原文',
    ownerLabel: '负责人',
  },
  en: {
    grades: ['High risk', 'Needs confirming', 'Clear to proceed'],
    reasonPrefix: 'By the rules this is',
    unknownLabel: 'Not mentioned in the files',
    basisLabel: 'Read from',
    evidenceLabel: 'Straight from your files',
    ownerLabel: 'Owned by',
  },
}

// 两把不同的尺子，别混用（第一版混用了，born-red 3 当场逮到）：
//   CJK —— 宽口径，含全角标点（`：` U+FF1A、`「」`）。判**壳里的异语残留**：
//          英文界面里出现一个全角冒号也是缺陷，所以这把尺子必须宽。
//   HAN —— 只认汉字。判**引文里还有没有真中文**。
// 🔴 用 CJK 去判"引文是不是还是中文"会漏：把 `外部婚庆的进场时点…` 里的汉字全翻掉、
// 只剩一个全角标点，宽尺子照样说"含中文"。born-red 3 的第一版就是这样对着**被翻译过的
// 引文**全绿的——判据太松比没有判据更坏，因为它看起来像验过了。
const CJK = /[\u4e00-\u9fff\u3000-\u303f\uff00-\uffef]/
const HAN = /[一-鿿]/
// 中文壳里的英文残留：连续 3 个以上拉丁字母。规则号（`R-OVERDUE`）住在 .lite-home-rule-id，
// 采样时单独剔除——它是给经理引用的编号，不是文案。
const LATIN_RUN = /[A-Za-z]{3,}/
// 引文里合法的**非原文**行：字段读数（`status="blocked"` / `dueDate="…" / progress=48%`）。
// 机器键 + 文档原文值，语言中立，不拿去和语料比对。
const FIELD_READOUT = /^[a-zA-Z]+=/
// 语料全文 —— 判据 ④ 的比对基准：引文必须**逐字**出自这里。
const CORPUS = SEEDS.map((s) => s.text).join(String.fromCharCode(10))

let browser
const collected = {}   // { zh: {...}, en: {...} } —— 跨 locale 的对照留到最后一起断言

async function driveLocale(locale) {
  console.log(`\n═══ lang=${locale} ═══`)
  const boot = await bootPage({
    browser,
    url: `${UI}/?v=2&mode=live&look=paper&lang=${locale}`,
    trackPageErrors: true,
  })
  browser = boot.browser
  const { context: ctx, page, pageErrors } = boot
  const tag = (n) => `[${locale}] ${n}`
  const want = EXPECT[locale]
  const other = EXPECT[locale === 'zh' ? 'en' : 'zh']

  // ── 真上传（`?transport=stub` 在 build+preview 产物里是死开关，必须走真 mock 后端）──
  await page.evaluate(async (seeds) => {
    const enc = new TextEncoder()
    const files = seeds.map((s) => new File([enc.encode(s.text)], s.name, { type: 'text/markdown' }))
    await window.__lite2Store.getState().uploadFiles(files)
  }, SEEDS)
  await page.waitForFunction(
    () => ['ready', 'error'].includes(window.__lite2Store.getState().ingestStatus),
    undefined, { timeout: 90000 },
  )

  // ── 自证 0：语料真的带中文字节 ─────────────────────────────────────────────────────
  // 语料全 ASCII 的话，下面每一条"是不是中文"的判据都失去意义（恒假或恒真）。
  const corpusCjk = SEEDS.filter((s) => CJK.test(s.text)).length
  rec(tag('自证：上传语料含真中文字节'), corpusCjk === SEEDS.length && SEEDS.length >= 3,
    `${corpusCjk}/${SEEDS.length} 份带 CJK`)

  await page.evaluate(() => window.__lite2Store.getState().goScreen('home'))
  await page.waitForTimeout(700)

  // ── 自证 1：后端真的回了决策卡，且屏幕上真的渲染出来了 ─────────────────────────────
  const decisions = await page.evaluate(
    () => window.__lite2Store.getState().rawTeam?.decisions ?? [])
  rec(tag('自证：后端回了决策定级（decisions 非空）'), decisions.length > 0, `${decisions.length} 条`)

  const cardCount = await page.evaluate(() => document.querySelectorAll('.lite-home-decision').length)
  rec(tag('自证：判读卡真的渲染在屏幕上'), cardCount > 0, `${cardCount} 张`)

  // 展开**每一张**卡的规则区（引文和规则文案只有展开才在 DOM 里——不展开就采不到样）。
  // 只展第一张会把采样面从 19 行砍到 4 行，判据的覆盖面随之缩水而不会有任何提示。
  const expanded = await page.evaluate(() => {
    const btns = [...document.querySelectorAll('.lite-home-decision-toggle')]
    btns.forEach((b) => b.click())
    return btns.length
  })
  await page.waitForTimeout(500)
  rec(tag('自证：每张判读卡的规则区都展开了'), expanded === cardCount && expanded > 0,
    `展开 ${expanded} / 共 ${cardCount} 张`)

  const shot = await page.evaluate(() => {
    const text = (el) => (el ? (el.innerText || '').trim() : '')
    const all = (sel) => [...document.querySelectorAll(sel)].map((e) => (e.innerText || '').trim())
    const card = document.querySelector('.lite-home-decision')
    return {
      // 壳：这些元素里**一个字**都不是文档内容，全是我们自己的文案
      gradeChips: all('.lite-home-grade-chip'),
      cardGrade: text(card?.querySelector('.lite-home-decision-grade')),
      reason: text(card?.querySelector('.lite-home-decision-reason')),
      unknown: text(card?.querySelector('.lite-home-decision-unknown')),
      owner: text(card?.querySelector('.lite-home-decision-owner')),
      ruleTitles: all('.lite-home-rule-title'),
      ruleGrades: all('.lite-home-rule-grade'),
      ruleBasis: all('.lite-home-rule-basis'),
      ruleIds: all('.lite-home-rule-id'),
      evidenceLabel: text(document.querySelector('.lite-home-evidence-label')),
      // 引文：文档原文，与界面语言无关（判据 ④ 的采样面）
      evidence: all('.lite-home-rule-evidence li'),
    }
  })

  rec(tag('自证：展开区真的渲染出规则行'), shot.ruleTitles.length > 0,
    `${shot.ruleTitles.length} 行 · ids=${shot.ruleIds.slice(0, 3).join(',')}`)
  rec(tag('自证：展开区真的渲染出引文行'), shot.evidence.length > 0,
    `${shot.evidence.length} 行`)

  // ── 判据 ①：界面壳无异语残留 ───────────────────────────────────────────────────────
  // 🔴 采样面刻意**排掉**四样文档内容：卡标题（项目名）、负责人名、引文、读不准字段的原文。
  // 它们是客户自己的字，中文文档在英文界面下仍然是中文——把它们算进来就是把正确行为判成红，
  // 而假红门的下场是被人关掉。
  const shellParts = [
    ...shot.gradeChips, shot.cardGrade, shot.reason, shot.unknown,
    ...shot.ruleTitles, ...shot.ruleGrades, ...shot.ruleBasis, shot.evidenceLabel,
  ].filter(Boolean)
  const shell = shellParts.join('\n')
  rec(tag('自证：壳文案采样面非空（否则 ① 是空断言）'), shellParts.length >= 5,
    `${shellParts.length} 段 / ${shell.length} 字`)

  if (locale === 'en') {
    const offenders = shellParts.filter((s) => CJK.test(s))
    rec(tag('① 英文壳里没有中文残留'), offenders.length === 0,
      offenders.length ? `残留 ${offenders.length} 段：${offenders.slice(0, 3).join(' | ')}` : '0 段')
  } else {
    const offenders = shellParts.filter((s) => LATIN_RUN.test(s))
    rec(tag('① 中文壳里没有英文残留'), offenders.length === 0,
      offenders.length ? `残留 ${offenders.length} 段：${offenders.slice(0, 3).join(' | ')}` : '0 段')
  }

  // ── 判据 ②：后端派生文案渲染成了对应语言（白名单：必须是这一种）────────────────────
  rec(tag('② 卡上的档位词属于本语言的三个词'), want.grades.includes(shot.cardGrade),
    `${JSON.stringify(shot.cardGrade)} ∈ ${JSON.stringify(want.grades)}`)
  const chipsOk = shot.gradeChips.length > 0 &&
    shot.gradeChips.every((c) => want.grades.some((g) => c.endsWith(g)))
  rec(tag('② 分级计数条上的档位词也属于本语言'), chipsOk, JSON.stringify(shot.gradeChips))
  rec(tag('② 规则句用的是本语言的模板'), shot.reason.startsWith(want.reasonPrefix),
    JSON.stringify(shot.reason.slice(0, 60)))
  rec(tag('② 展开区的档位词属于本语言的三个词'),
    shot.ruleGrades.length > 0 && shot.ruleGrades.every((g) => want.grades.includes(g)),
    JSON.stringify(shot.ruleGrades))
  rec(tag('② 「看的字段」标签是本语言的'),
    shot.ruleBasis.length > 0 && shot.ruleBasis.every((b) => b.startsWith(want.basisLabel)),
    JSON.stringify(shot.ruleBasis.slice(0, 2)))
  rec(tag('② 引文小标题是本语言的'), shot.evidenceLabel.startsWith(want.evidenceLabel),
    JSON.stringify(shot.evidenceLabel))
  // 反向白名单：另一种语言的锚点词一个都不许出现在壳里。
  const crossWords = [...other.grades, other.reasonPrefix, other.unknownLabel,
    other.basisLabel, other.evidenceLabel].filter((w) => shell.includes(w))
  rec(tag('② 壳里不含另一种语言的锚点词'), crossWords.length === 0,
    crossWords.length ? `串了：${crossWords.join(' / ')}` : '0 个')

  // ── 判据 ③：LLM 正文语言 == 请求 locale ────────────────────────────────────────────
  // 🔴 先进议事室再问：判读卡（LiteAdviceCard）只在 room 屏渲染。留在 home 屏上问，
  // `run.advice` 照样会有值，但 `.report-section-label` 一个都采不到——于是 ③b 那条判据
  // 对着**空数组**跑，`[].every(...)` 恒真，永远绿。第一版就是这样，自证判据把它逮住了。
  await page.evaluate(() => window.__lite2Store.getState().goScreen('room'))
  await page.waitForTimeout(400)
  await page.evaluate((q) => window.__lite2Store.getState().askLive({ situation: q }), QUESTION)
  await page.waitForFunction(
    () => ['complete', 'error'].includes(window.__lite2Store.getState().run?.status),
    undefined, { timeout: 120000 },
  )
  const run = await page.evaluate(() => {
    const st = window.__lite2Store.getState().run
    return { status: st?.status, advice: st?.advice ?? null, answer: st?.answer ?? '' }
  })
  rec(tag('自证：一次真 advise 跑完并出了判读卡'), run.status === 'complete' && !!run.advice,
    `status=${run.status} advice=${run.advice ? 'yes' : 'no'}`)

  // 只取**给经理读的句子**：read（summary）+ move（actions）。
  // 🔴 刻意不取 evidence / cites —— 那是文档原文，中文语料在英文界面下仍然是中文，
  // 算进"正文语言"就是判据太宽的假红。
  const prose = [run.advice?.summary || '', ...(run.advice?.recommended_actions || [])]
    .filter(Boolean).join('\n')
  rec(tag('自证：判读正文采到样（长度足够下判断）'), prose.length > 60, `${prose.length} 字`)

  if (locale === 'en') {
    rec(tag('③ 中文提问 + 英文界面 → 正文是英文'), prose.length > 60 && !CJK.test(prose),
      CJK.test(prose) ? `正文里有汉字：${prose.slice(0, 80)}` : `${prose.length} 字，零汉字`)
  } else {
    rec(tag('③ 中文提问 + 中文界面 → 正文是中文'), prose.length > 60 && CJK.test(prose),
      CJK.test(prose) ? `${prose.length} 字，含汉字` : `正文里没有汉字：${prose.slice(0, 80)}`)
  }
  // 正文旁边那一圈标签仍是壳，必须跟着 locale 走（正文对了、标签串了也算没做到对等）。
  await page.waitForTimeout(500)
  const adviceShell = await page.evaluate(() =>
    [...document.querySelectorAll('.report-section-label, .report-zone-label')]
      .map((e) => (e.innerText || '').trim()).filter(Boolean))
  rec(tag('自证：判读卡的分节标签采到样'), adviceShell.length >= 2,
    `${adviceShell.length} 个：${adviceShell.slice(0, 3).join(' / ')}`)
  if (locale === 'en') {
    const bad = adviceShell.filter((s) => CJK.test(s))
    rec(tag('③b 英文判读卡的分节标签无中文'), bad.length === 0, bad.join(' | ') || '0 个')
  } else {
    const bad = adviceShell.filter((s) => LATIN_RUN.test(s))
    rec(tag('③b 中文判读卡的分节标签无英文'), bad.length === 0, bad.join(' | ') || '0 个')
  }

  // ── 判据 ④ 的采样（跨 locale 对照留到最后）─────────────────────────────────────────
  collected[locale] = { evidence: shot.evidence, owner: shot.owner, ruleIds: shot.ruleIds }

  rec(tag('无 pageerror'), pageErrors.length === 0, pageErrors.slice(0, 2).join(' | ') || '0 条')
  await ctx.close()
}

await driveLocale('zh')
await driveLocale('en')

// ── 判据 ④：引文仍是中文原样（两遍逐字相同）────────────────────────────────────────
// 🔴 这条是 ADR-0033 决定 4 的护栏，而它的形态很关键：不是"英文界面下引文得是中文"
// （那样只要有人塞一句中文进去就绿），而是**同一份语料两遍跑出来的引文逐字相同**。
// 任何形式的"顺手把引文翻了"都会让两份不相等，与用什么手段翻的无关。
const zhEv = collected.zh?.evidence ?? []
const enEv = collected.en?.evidence ?? []
rec('自证：两遍都采到了引文（否则 ④ 是空断言）', zhEv.length > 0 && enEv.length > 0,
  `zh ${zhEv.length} 行 / en ${enEv.length} 行`)
// 用 HAN 不用 CJK：只剩一个全角标点不算"还是中文"（见文件头两把尺子那段）。
const zhHan = zhEv.filter((e) => HAN.test(e))
const enHan = enEv.filter((e) => HAN.test(e))
rec('④ 引文里仍有真汉字（两遍都）', zhHan.length > 0 && enHan.length > 0,
  `zh ${zhHan.length}/${zhEv.length} 行含汉字 / en ${enHan.length}/${enEv.length} 行`)

// 🔴 最硬的一条：**引文必须逐字出自上传的语料**。
// 为什么不用"两遍逐字相同"当主判据：那只逮得住"只在英文界面翻"这一种写法。
// born-red 3 实测——一个对**两种语言都生效**的翻译（`line.replace(汉字, 'delivery slipped')`）
// 会让两边仍然相等，于是那条判据全绿，而屏幕上摆着的"文档原文"已经一个字都不是原文了。
// 拿语料当基准就没有这个缝：翻了、改了、转述了，任何一种都不再是语料的子串。
// 字段读数（`status="blocked"`）不参与比对——它们是机器键，本来就不在语料里。
const quoteLines = [...zhEv, ...enEv].filter((e) => !FIELD_READOUT.test(e))
const notVerbatim = quoteLines.filter((e) => !CORPUS.includes(e))
rec('自证：引文里真的有"文档原文"型的行（否则下面是空断言）', quoteLines.length > 0,
  `${quoteLines.length} 行（另有 ${zhEv.length + enEv.length - quoteLines.length} 行是字段读数）`)
rec('④ 每一行引文都逐字出自上传的语料（没被翻译、没被转述）', notVerbatim.length === 0,
  notVerbatim.length ? `${notVerbatim.length} 行对不上语料：${JSON.stringify(notVerbatim.slice(0, 2))}`
    : `${quoteLines.length} 行全部逐字命中`)

const sameEvidence = zhEv.length === enEv.length && zhEv.every((e, i) => e === enEv[i])
rec('④ 引文两遍逐字相同（换个语言不该换一份引文）', sameEvidence,
  sameEvidence ? `${zhEv.length} 行逐字相同` :
    `zh=${JSON.stringify(zhEv.slice(0, 2))} en=${JSON.stringify(enEv.slice(0, 2))}`)
// 负责人名同理：那是文档里的名字，不是文案。
rec('④ 负责人名两遍相同（文档里的名字不翻译）',
  !!collected.zh?.owner && !!collected.en?.owner &&
  collected.zh.owner.replace(EXPECT.zh.ownerLabel, '').trim() ===
  collected.en.owner.replace(EXPECT.en.ownerLabel, '').trim(),
  `zh=${JSON.stringify(collected.zh?.owner)} en=${JSON.stringify(collected.en?.owner)}`)

await finish(gateRec, { browser, label: '判读链路双语对等', listFailures: true })
