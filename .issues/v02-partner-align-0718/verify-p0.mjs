#!/usr/bin/env node
// P0 集成验证 · v02 对齐波（feat-050..060 + 055/057/058）
//
// 为什么存在：四道机器门（typecheck / build / lint / pytest）证明不了本波的验收标准。
// 「刷新还在」「后退不掉出应用」「缺失字段显示未知而不是 0%」「两张皮都正常」这些都是**行为**，
// 只能真跑浏览器。集成期已经吃过一次亏：一处 CSS 括号漏闭合让整块账号样式失效，四道门全绿。
//
// 怎么跑：
//   1) 起后端： cd eval-harness && AVERY_BRAIN=stub python -m uvicorn service.app:app --port 8137
//   2) 起前端： npx vite --port 5173 --strictPort
//      🔴 端口必须是 5173 —— 后端 CORS 是精确匹配列表，换端口会被浏览器静默拦掉，
//         症状是「团队/笔记/文件全空」，和「没数据」长得一模一样，极易误判。
//   3) node .issues/v02-partner-align-0718/verify-p0.mjs
//
// 退出码 0 = 全过；非 0 = 有 FAIL。

import { chromium } from 'playwright'

const BASE = process.env.VERIFY_BASE || 'http://127.0.0.1:5173'
const LOOKS = ['paper', 'aurora']
const results = []
const tokenSnapshots = {}

function record(name, pass, detail) {
  results.push({ name, pass, detail })
  const tag = pass === true ? 'PASS' : pass === false ? 'FAIL' : 'SKIP'
  console.log(`  [${tag}] ${name}${detail ? ' — ' + detail : ''}`)
}

const entryUrl = (look) => `${BASE}/?v=2&mode=live&look=${look}&lang=zh`

async function run() {
  const browser = await chromium.launch({ headless: true })

  for (const look of LOOKS) {
    console.log(`\n═══ Look = ${look} ═══`)
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } })
    const page = await ctx.newPage()
    const consoleErrors = []
    page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()) })
    page.on('pageerror', (e) => consoleErrors.push('pageerror: ' + e.message))

    // ── 1 · 入口直链 ────────────────────────────────────────────────────────────
    await page.goto(entryUrl(look), { waitUntil: 'networkidle' })
    const u = new URL(page.url())
    const params = Object.fromEntries(u.searchParams)
    // feat-057 起，`/` 落到聚合入口屏 `/home`（decisions.md Q2「两个都极端 → 结合」：
    // 聚合做入口，7 个分屏一个没退休）。参数保全的要求不变——那才是这条断言的实质。
    record(
      `[${look}] 入口直链 / → /home 且五参数不丢`,
      u.pathname === '/home' && params.v === '2' && params.mode === 'live' &&
        params.look === look && params.lang === 'zh',
      `path=${u.pathname} params=${JSON.stringify(params)}`,
    )

    const shell = page.locator('.lite2-shell')
    record(`[${look}] lite2 壳挂载`, (await shell.count()) === 1)
    record(
      `[${look}] data-look 属性正确`,
      (await shell.getAttribute('data-look')) === look,
      `data-look=${await shell.getAttribute('data-look')}`,
    )

    // ── 2 · Look 真的换了（令牌层生效，不只是换了个属性字符串）──────────────────
    // 不看 .lite2-shell 的 background-color —— 底色画在别的元素上，壳本身透明是正常的。
    // 真正的判据是**令牌值**：两张皮必须解析出不同的 --ink/--paper/--honey 等自定义属性，
    // 否则 ?look= 就只是个装饰性 URL 参数。跨两轮比对见循环结束后的断言。
    const tokens = await page.evaluate(() => {
      const cs = getComputedStyle(document.querySelector('.lite2-shell'))
      const names = ['--ink', '--ink-soft', '--ink-faint', '--paper', '--honey', '--sage', '--rule', '--lite2-surface']
      return Object.fromEntries(names.map((n) => [n, cs.getPropertyValue(n).trim()]))
    })
    tokenSnapshots[look] = tokens
    const resolved = Object.values(tokens).filter(Boolean).length
    record(`[${look}] Look 令牌层解析出值`, resolved >= 5, `${resolved}/8 个令牌有值`)

    // ── 2.5 · 先关首访向导（弹层基座 + 滚动锁），否则它的背景会挡住一切点击 ────────
    // 这本身也是 feat-052 的验收：Esc 能关、滚动锁能释放。
    if ((await page.locator('.lite-onboard').count()) > 0) {
      const lockedBefore = await page.evaluate(() => document.body.style.overflow)
      await page.keyboard.press('Escape')
      await page.waitForTimeout(800)
      const lockedAfter = await page.evaluate(() => document.body.style.overflow)
      record(
        `[${look}] 向导 Esc 可关且滚动锁释放（feat-052 基座）`,
        (await page.locator('.lite-onboard').count()) === 0 && lockedBefore === 'hidden' && lockedAfter === '',
        `锁 ${lockedBefore || '(空)'} → ${lockedAfter || '(空)'}`,
      )
      record(
        `[${look}] 向导关闭后背景不再拦截点击`,
        (await page.locator('.lite-modal-backdrop').count()) === 0,
      )
    } else {
      record(`[${look}] 首访向导`, null, '本次未出现（localStorage 状态），跳过')
    }

    // ── 3 · 导航 + 后退键 ───────────────────────────────────────────────────────
    const tabs = page.locator('.scene-tab')
    const tabCount = await tabs.count()
    record(`[${look}] tab 栏渲染`, tabCount >= 7, `${tabCount} 个 tab`)

    const visited = []
    for (let i = 1; i < Math.min(tabCount, 5); i++) {
      await tabs.nth(i).click()
      await page.waitForTimeout(150)
      visited.push(new URL(page.url()).pathname)
    }
    const keptParams = new URL(page.url()).searchParams
    record(
      `[${look}] 切屏后 query 参数不丢`,
      keptParams.get('v') === '2' && keptParams.get('look') === look && keptParams.get('lang') === 'zh',
      `search=${new URL(page.url()).search}`,
    )
    record(`[${look}] 切屏路径各不相同`, new Set(visited).size === visited.length, visited.join(' → '))

    const backTrail = []
    for (let i = 0; i < 3; i++) {
      await page.goBack()
      await page.waitForTimeout(200)
      backTrail.push(new URL(page.url()).pathname)
    }
    record(
      `[${look}] 后退三次逐级回退且不掉出应用`,
      (await page.locator('.lite2-shell').count()) === 1 &&
        backTrail.join(',') === visited.slice(0, -1).reverse().join(','),
      `回退轨迹 ${backTrail.join(' → ')}`,
    )

    // ── 5 · 真后端：上传 → 锚点 → 刷新恢复 ──────────────────────────────────────
    await page.goto(entryUrl(look), { waitUntil: 'networkidle' })
    await page.evaluate(() => localStorage.removeItem('lite2:contextId:v1'))
    if ((await page.locator('.lite-onboard').count()) > 0) {
      await page.keyboard.press('Escape')
      await page.waitForTimeout(700)
    }
    const doc = [
      '# 三亚鹿山雅居 · 周报 W29',
      '',
      '## 项目：别墅交付验收',
      '负责人：李明',
      '状态：受阻',
      '阻碍项：佣金测算卡住，等财务确认',
      '到期日：8月15日',
      '',
      '## 项目：渠道合作拓展',
      '负责人：王芳',
      '状态：正常',
      '进度：70%',
      '',
      '## 项目：客户投诉处理',
      '负责人：陈思雨',
      '状态：待确认',
      '截止：月底前',
      '',
    ].join('\n')

    const uploaded = await page.evaluate(async (text) => {
      const st = window.__lite2Store
      if (!st) return { err: 'store 未暴露' }
      const f = new File([text], '三亚周报W29.md', { type: 'text/markdown' })
      await st.getState().uploadFiles([f])
      await new Promise((r) => setTimeout(r, 1500))
      const s = st.getState()
      return {
        ingest: s.ingestStatus,
        err: s.ingestError,
        contextId: s.contextId,
        hasToken: !!s.ownerToken,
        projects: s.team?.projects?.length ?? 0,
        decisions: Array.isArray(s.rawTeam?.decisions) ? s.rawTeam.decisions.length : null,
        anchor: localStorage.getItem('lite2:contextId:v1'),
        tokenInUrl: s.ownerToken ? location.href.includes(s.ownerToken) : false,
      }
    }, doc)

    record(`[${look}] 真后端 ingest 成功`, uploaded.ingest === 'ready', JSON.stringify(uploaded).slice(0, 200))
    record(`[${look}] contextId 落 localStorage（feat-050 锚点）`, !!uploaded.anchor, `anchor=${uploaded.anchor}`)
    record(`[${look}] owner_token 不在 URL`, uploaded.tokenInUrl === false)
    record(
      `[${look}] feat-056 决策契约随 /team 下发`,
      typeof uploaded.decisions === 'number' && uploaded.decisions > 0,
      `decisions=${uploaded.decisions}`,
    )

    await page.reload({ waitUntil: 'networkidle' })
    await page.waitForTimeout(1800)
    if ((await page.locator('.lite-onboard').count()) > 0) {
      await page.keyboard.press('Escape')
      await page.waitForTimeout(700)
    }
    const restored = await page.evaluate(() => {
      const s = window.__lite2Store.getState()
      return {
        contextId: s.contextId,
        projects: s.team?.projects?.length ?? 0,
        files: s.files?.length ?? 0,
        restoring: s.restoring,
        restoreError: s.restoreError,
      }
    })
    record(
      `[${look}] 🔴 刷新后会话恢复（feat-050 招牌验收）`,
      restored.contextId === uploaded.contextId && restored.projects > 0 &&
        restored.restoring === false && restored.restoreError === null,
      JSON.stringify(restored),
    )

    // ── 6 · 「未知」态：缺失字段不得渲染成 0% ───────────────────────────────────
    // rich-align-0722/03 · 「0%」扫描收窄：排除 [data-metric-source] 自述锚——一个本人自述负载**恰好
    // 0%** 的人卡（开关开世界）是合法的、带出处的转述，不是「项目缺进度被编成 0%」。剪掉锚内文本后再扫，
    // 项目栅栏语义不丢，负载 0% 不再误伤（issue-01 的项目进度口径与此各管各的）。
    const unknownState = await page.evaluate(() => {
      const s = window.__lite2Store.getState()
      const projs = s.rawTeam?.projects ?? []
      const missingProgress = projs.filter((p) => typeof p.progress !== 'number')
      const textOutsideAnchors = () => {
        let out = ''
        const walk = (node) => {
          if (node.nodeType === 3) { out += node.nodeValue; return }
          if (node.nodeType !== 1) return
          if (node.hasAttribute && node.hasAttribute('data-metric-source')) return
          node.childNodes.forEach(walk)
        }
        walk(document.body)
        return out
      }
      const text = textOutsideAnchors()
      return {
        totalProjects: projs.length,
        missingProgress: missingProgress.length,
        // 缺 progress 的项目名旁边有没有出现 "0%"（自述锚内的 0% 已被排除）
        zeroPercentOnPage: /(^|[^0-9])0\s*%/.test(text),
        hasUnknownCopy: /未知|文档未提及|未读到/.test(document.body.innerText),
      }
    })
    record(
      `[${look}] 缺 progress 的项目不显示 0%`,
      !(unknownState.missingProgress > 0 && unknownState.zeroPercentOnPage),
      JSON.stringify(unknownState),
    )

    // ── 7 · 详情浮层：路由 + 底屏不被偷换 + Esc 关闭 ────────────────────────────
    // 落点已是 /home，人/项目卡在 /team 上——先切过去再找。
    await page.evaluate(() => window.__lite2Store.getState().goScreen('team'))
    await page.waitForTimeout(500)
    const card = page.locator('.home-person-card, .home-project-card').first()
    if ((await card.count()) > 0) {
      const sceneBefore = await shell.getAttribute('data-scene')
      await card.click()
      await page.waitForTimeout(400)
      const opened = {
        path: new URL(page.url()).pathname,
        scene: await shell.getAttribute('data-scene'),
        modal: (await page.locator('.lite-detail-card').count()) > 0,
        baseStillRendered: (await page.locator('.home-person-card, .home-project-card').count()) > 0,
      }
      record(
        `[${look}] 详情推路由 + 底屏不被偷换（feat-051×052 交点）`,
        opened.modal && opened.baseStillRendered && opened.scene === sceneBefore &&
          opened.path !== '/' && opened.path.split('/').length >= 3,
        JSON.stringify(opened),
      )
      await page.keyboard.press('Escape')
      await page.waitForTimeout(700)
      record(
        `[${look}] 详情 Esc 关闭并回到来源屏`,
        (await page.locator('.lite-detail-card').count()) === 0 &&
          (await page.evaluate(() => document.body.style.overflow)) === '',
        `path=${new URL(page.url()).pathname}`,
      )
    } else {
      record(`[${look}] 详情浮层`, null, '页面上没有可点的人/项目卡，跳过')
    }

    // ── 8 · 锁定词表：用户真正看得见的文字 ──────────────────────────────────────
    // 0721 对齐棒 · Danny 拍板 2C：「指挥室」从锁定词表**显式解锁**（home tab 主名即它，
    // 推翻记录见 .issues/cr-align-0721/decisions.md + ADR）。Nexus / 现实差距维持锁定。
    const visibleText = await page.evaluate(() => document.body.innerText)
    const bad = ['Nexus', 'nexus', '现实差距'].filter((w) => visibleText.includes(w))
    record(`[${look}] 锁定词不出现在可见文字里`, bad.length === 0, bad.length ? `命中 ${bad.join('/')}` : '零命中')

    // ── 9 · console ────────────────────────────────────────────────────────────
    record(`[${look}] console 无错误`, consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | ') || '0 条')

    await ctx.close()
  }

  await browser.close()

  // ── 跨 Look 比对：paper 与 aurora 必须真的不一样 ───────────────────────────────
  const [a, b] = LOOKS
  if (tokenSnapshots[a] && tokenSnapshots[b]) {
    const diff = Object.keys(tokenSnapshots[a]).filter((k) => tokenSnapshots[a][k] !== tokenSnapshots[b][k])
    console.log(`
═══ 跨 Look 比对 ═══`)
    record(
      `${a} 与 ${b} 的令牌值确实不同（?look= 不是摆设）`,
      diff.length >= 3,
      `${diff.length} 个令牌不同：${diff.slice(0, 5).join(', ')}`,
    )
  }

  const fail = results.filter((r) => r.pass === false)
  const pass = results.filter((r) => r.pass === true)
  const skip = results.filter((r) => r.pass === null)
  console.log(`\n═══ 汇总：${pass.length} PASS · ${fail.length} FAIL · ${skip.length} SKIP ═══`)
  if (fail.length) {
    console.log('\n失败项：')
    for (const f of fail) console.log(`  ✗ ${f.name} — ${f.detail}`)
  }
  process.exit(fail.length ? 1 : 0)
}

run().catch((e) => {
  console.error('验证脚本自身崩了：', e)
  process.exit(2)
})
