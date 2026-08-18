// 像素基线的**前提自查**（2026-08-18）。不采样、不比图，只回答一个问题：
// 「playwright.config.mjs 里那几个确定性开关，到底有没有落到浏览器上。」
//
// ## 为什么要有这个文件
// 那份配置的头注释以前写着「确定性三板斧：stub 数据 + reducedMotion + deviceScaleFactor 1」。
// 三项里有**两项是假话**：`?transport=stub` 在 build+preview 产物上是死的（#68 查实），
// `reducedMotion` 顶层写法在 playwright 1.61.1 里根本不会传给浏览器（本票查实）。
// 66 张基线因此一直是在**动效开着**的条件下冻的，而没有任何一条判据够得到这件事——
// 注释是现在时的断言，断言不会自己红。
//
// 所以这里把那句话改写成**判据**：跟基线同一条命令跑，前提塌了当场红。
// 本仓这类注释烂过不止一次（lite2.css 那条从未闭合的 media query 也是一样的形状：
// 「不会让 build 变红，这正是它能活下来的原因」）。
//
// ## 判据落在哪
// 🔴 期望值**手写在本文件里**，不从 config 读。尺子长在被量的东西上就没有分辨力：
// `expect(page 读到的 locale).toBe(config.use.locale)` 这种写法，在 config 被改坏时
// 两边一起变，永远绿。要改确定性开关就必须同时改这里——那正是我们想要的摩擦。
//
// ⚠ 本文件**不比像素**，所以它自己不产生基线；加进 testDir 只多两条 test、约 1 秒。
import { test, expect } from 'playwright/test'
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const HERE = dirname(fileURLToPath(import.meta.url))

/** 手写的确定性合同。改这里 = 宣布「66 张基线的前提变了」，必须同批重冻。 */
const CONTRACT = {
  reducedMotion: true,          // 动效关掉：JS 驱动的动画不在 toHaveScreenshot({animations:'disabled'}) 射程内
  devicePixelRatio: 1,          // 1x 采样：2x 会让整批基线尺寸翻倍
  language: 'zh-CN',            // 文案语言（也决定字体回退与换行）
  timeZone: 'Asia/Shanghai',    // 墙钟文案的时区
  prefersDark: false,           // colorScheme 默认 'light'——没写进 config，但基线全按它冻的
}

const VIEWPORTS = { desktop: 1440, mobile: 375 }

test('确定性开关真的落到了浏览器上', async ({ page }, testInfo) => {
  // about:blank 就够：这几项是 context 级的，跟页面内容无关，也不需要 preview 在场。
  await page.goto('about:blank')
  const actual = await page.evaluate(() => ({
    reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches,
    devicePixelRatio,
    language: navigator.language,
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    prefersDark: matchMedia('(prefers-color-scheme: dark)').matches,
    innerWidth,
  }))

  // 一次性全量比较：逐条 expect 会「首处即中止」，看不到另外三项是不是也塌了。
  expect({
    reducedMotion: actual.reducedMotion,
    devicePixelRatio: actual.devicePixelRatio,
    language: actual.language,
    timeZone: actual.timeZone,
    prefersDark: actual.prefersDark,
  }).toEqual(CONTRACT)

  // 视口是 project 级的，顺带钉住：写错了整批基线尺寸就变了。
  expect(actual.innerWidth).toBe(VIEWPORTS[testInfo.project.name])
})

test('配置里没有 playwright 会静默丢掉的 use 键', async () => {
  // ① 从**装着的那份 runner** 里现推白名单，而不是在这儿抄一份会过期的清单。
  //    1.61.1 的每个可转发 option 都长成同一形状：
  //      locale: [({ contextOptions }, use) => use(contextOptions.locale ?? "en-US"), ...]
  const runnerSrc = readFileSync(
    join(HERE, '..', '..', 'node_modules', 'playwright', 'lib', 'index.js'),
    'utf8',
  )
  const forwarded = new Set(
    [...runnerSrc.matchAll(/^\s{2}(\w+): \[\(\{ contextOptions \}, use\) => use\(contextOptions\./gm)]
      .map((m) => m[1]),
  )
  // 🔴 空真闸：正则一旦被 playwright 升级打散，上面会推出**空集**，而空集会让下面那条
  //    「每个键都在白名单里」变成对着任何配置都绿。宁可在这里红，也不要变成一条瞎判据。
  expect(
    forwarded.size,
    'playwright 内部形状变了，白名单推不出来——先去 lib/index.js 看 _combinedContextOptions 怎么写的',
  ).toBeGreaterThan(10)
  expect(forwarded.has('locale'), '白名单推歪了：连 locale 都没推出来').toBe(true)

  // ② runner 自己吃掉、不转发给 context 的键（它们有各自的用途，不是被丢掉）。
  const RUNNER_LEVEL = new Set([
    'contextOptions', 'baseURL', 'actionTimeout', 'navigationTimeout', 'testIdAttribute',
    'trace', 'video', 'screenshot', 'launchOptions', 'connectOptions', 'browserName',
    'headless', 'channel', 'viewport', 'serviceWorkers', 'clientCertificates',
  ])

  const config = (await import('./playwright.config.mjs')).default
  const scopes = [
    ['use', config.use ?? {}],
    ...(config.projects ?? []).map((p) => [`projects[${p.name}].use`, p.use ?? {}]),
  ]

  const dropped = []
  for (const [where, use] of scopes) {
    for (const key of Object.keys(use)) {
      if (forwarded.has(key) || RUNNER_LEVEL.has(key)) continue
      dropped.push(`${where}.${key}`)
    }
  }
  // 这一条抓的是**整类 bug**，不是 reducedMotion 一个实例：任何写在 use 顶层、
  // playwright 却不转发的键，都会以「配置写了但没生效」的形态无声活着。
  // 出口是 `contextOptions: { <键>: ... }`（playwright 自己的 types/test.d.ts 就这么示范的）。
  expect(dropped, `这些键 playwright 不会传给 browser context，写了等于没写：${dropped.join(', ')}`)
    .toEqual([])
})

test('没有别的 spec 自己建 context 绕开这份配置', async () => {
  // 上面两条保的是 `page` fixture 这条路。谁要是自己 `browser.newContext()` /
  // `chromium.launch()`，config 的 use 只会部分跟过去（实测：locale/tz 跟，reducedMotion 不跟），
  // 那张基线就脱离了本文件的射程——而且照样绿。
  const specs = readdirSync(HERE).filter((f) => f.endsWith('.spec.mjs'))
  expect(specs.length, '一个 spec 都没扫到：路径写错了，这条判据是空的').toBeGreaterThan(2)

  // 🔴 先剥掉**整行注释**再扫。规则管的是「有没有真建 context」，不是「有没有提到这个词」——
  // 首版直接扫原文，第一个逮到的是本文件自己（上面那段解释里就写着 browser.newContext()），
  // 于是只剩两条出路：给自己开个 `f !== 本文件` 的口子（让唯一有权改这条规则的文件不受规则
  // 约束），或者把尺子改准。选后者。
  //
  // ⚠ 只剥**整行**注释，不剥行尾的 `//`：`http://localhost:5173` 里那两撇会让行尾剥法从
  // 半截切掉后面所有代码，扫描器从此对那个文件下半部分全瞎——那是往假绿方向错。整行剥法
  // 最坏只会多报（行尾注释里提到 newContext ⇒ 假红），错在吵闹这一侧。
  const stripWholeLineComments = (src) =>
    src.split('\n').filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line)).join('\n')

  const NEEDLES = [/\.newContext\s*\(/, /\.launch\s*\(/, /launchPersistentContext\s*\(/]
  const offenders = []
  for (const f of specs) {
    const code = stripWholeLineComments(readFileSync(join(HERE, f), 'utf8'))
    // 剥完还得剩下真代码，否则这一轮扫的是空气（本仓所有 spec 都至少有一个 test(...)）。
    expect(code, `${f} 剥注释后连 test( 都不剩了——剥过头了，这一轮扫描是空的`).toContain('test(')
    for (const pat of NEEDLES) {
      if (pat.test(code)) offenders.push(`${f} → ${pat.source}`)
    }
  }
  expect(offenders, `这些 spec 自己造浏览器上下文，确定性开关不一定跟得过去：${offenders.join(', ')}`)
    .toEqual([])
})
