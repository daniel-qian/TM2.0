// #68 · 数据态像素基线 —— 3 屏 × 2 皮 × 2 视口 + 2 张手机差距块专拍 = 14 张
//（方案 B 最小版，票面拍板空间见 #68；手机专拍的由来见 home 分支里的注释——born-red 逼出来的）。
//
// 为什么存在：visual.spec.mjs 的 36 张**全是空态采样**（它带的 `?transport=stub` 在
// build+preview 产物上是死的——store.ts 的 `import.meta.env.DEV` 被 vite build 静态求值成
// false，`--mode development` 只改 MODE 字符串——于是真 transport + fresh context = team===null，
// 九屏采的全是空态引导页）。任何只在数据态渲染的部件（差距对照卡/决策卡/人卡网格/项目卡）
// 此前零像素覆盖；#65 的「今天页必漂」预判就是被这个盲区骗的。
//
// 数据从哪来（**真上传，不是 stub**）：Files 屏真 `<input class="upload-input">` 塞
// demo-seed 九份中文 md（三亚酒店 16 人语料，heuristic 抽取确定性）+ flow-gap-phases 同款
// 手写种子（pr_portal 自报 on-track 但真有卡点 → **保证 home 必出差距对照卡**，#65 之后
// 它默认展开、是今天页第一眼形态——本 spec 的核心覆盖对象）。九份 md 按文件名排序后上传，
// readdir 顺序不进画面。
//
// 自证判据（撒谎形态「判据够不着≠判据写错」的解法）：home 截图前先 waitFor `.lite-gap-card`
// ——语料矛盾没被抽出来时这里直接超时红，绝不落一张"数据态但没有对照卡"的假基线。
//
// ⚠ 一个 test 串 3 次 toHaveScreenshot，首处不匹配即中止（与 visual.spec 同款撒谎形态⑤）
// ——所以本 spec 与旧 spec 分文件、每皮一个 test：一处红最多废一皮 3 张的清单，不殃及池鱼。
// ⚠ 依赖后端在场（mock 三件套 + AVERY_DEMO_SEED_DIR=tests/fixtures/demo-seed）：
//   上传落不了地时 `.upload-ready` 超时红——红形态是「上传等不到」，不是假绿。
// 基线 PNG 是 gitignore 的单机产物：worktree 里冻＝白冻，真基线只在主检出、人审后冻。
import { test, expect } from 'playwright/test'
import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const UI = process.env.VERIFY_BASE || 'http://localhost:5173'
const HERE = dirname(fileURLToPath(import.meta.url))
const SEED_DIR = join(HERE, '..', 'tests', 'fixtures', 'demo-seed')

// 与 verify-flow-gap-phases.mjs 同一段：两个项目、一个真矛盾（pr_portal）。
const GAP_SEED = `Project: Pilot Launch - Hangzhou Store
Owner: Lin Qing
Status: at-risk
Summary: First offline pilot store; fixtures and vendor quotes are on the critical path.
- Vendor quote for store fixtures is still unsigned; blocked on vendor sign-off.

Project: Onboarding Portal Revamp
Owner: Chen Mingyuan
Status: on-track
Summary: Rebuilding the internal onboarding portal around the new checklist flow.
- The new checklist flow still needs sign-off from Ops; blocked on their review this week.
`

// 数据密度最高的三屏（票面方案 B）。
// 🔴 #79 加 'room'：#75/#78 两份回执都点名「议事室数据态零像素覆盖」——
//    visual.spec 的 room 四张拍的是 `contextId === null` 的**无材料态**（LiteRoomHistory 在
//    那里直接 return null，composer 与 board 都不在画面里），而本 spec 的 SCREENS 压根不含 room。
//    于是 #75 重写的 docked composer、开场块、建议 chips 这一整面，改成什么样都不会有一张基线红。
//    只拍【有材料 + 零轮次】那一态：它不需要真跑 /advise（无 LLM 方差），也不带历史面板
//    （adviseRuns 为空 → 面板不渲染），因此**不带墙上时钟文案**。带轮次的那一态仍不入基线：
//    历史面板会印「8月9日 19:52」这种墙钟文案，而判读卡的 confidence/escalation 四段在 mock
//    语料下根本不渲染——冻它等于把一张**残缺的卡**当成满态基线（#79 实测，见回执）。
const SCREENS = ['home', 'team', 'projects', 'room']
const LOOKS = ['aurora', 'paper']

const seedFiles = () => [
  ...readdirSync(SEED_DIR)
    .filter((n) => n.endsWith('.md'))
    .sort()
    .map((n) => ({
      name: n,
      mimeType: 'text/markdown',
      buffer: readFileSync(join(SEED_DIR, n)),
    })),
  { name: 'flow-gap-seed.txt', mimeType: 'text/plain', buffer: Buffer.from(GAP_SEED, 'utf8') },
]

for (const look of LOOKS) {
  test(`${look} 数据态三屏基线`, async ({ page }, testInfo) => {
    // 🔴 时钟钉死（首冻当天人眼过 projects 屏时发现的时间炸弹）：决策定级/项目卡里
    // 「14 天内到期」这类文案是拿 **墙上时钟 vs 文档日期** 算的——语料里的到期日
    //（2026-08-15 / 2026-11-30…）一旦被真实日期追过，定级翻牌、home/projects 布局变，
    // 基线无声腐烂（Docker PG 时钟跳的同族：别赌墙上时钟）。setFixedTime 只冻 Date、
    // 计时器照跑（上传轮询/settle 不受影响）；空态 spec 不钉——那 36 张不含数据日期，
    // 钉了反而要作废重冻。
    await page.clock.setFixedTime(new Date('2026-08-08T12:00:00+08:00'))
    await page.goto(`${UI}/?v=2&mode=live&look=${look}&lang=zh`, { waitUntil: 'networkidle' })
    if (await page.locator('.lite-onboard').count()) {
      await page.keyboard.press('Escape')
      await page.waitForTimeout(600)
    }
    // 真上传（Files 屏挂着无条件的上传口；home 空态那个面板会在 ingest 成功瞬间卸载，不能用）
    await page.evaluate(() => window.__lite2Store.getState().goScreen('files'))
    await page.locator('input.upload-input').setInputFiles(seedFiles())
    await page.locator('.upload-ready, .upload-error').first().waitFor({ timeout: 60000 })
    await expect(page.locator('.upload-error'), '上传必须成功——失败时这里红，别落空基线').toHaveCount(0)

    await page.evaluate(() => document.fonts.ready)
    for (const sc of SCREENS) {
      await page.evaluate((s) => window.__lite2Store.getState().goScreen(s), sc)
      if (sc === 'room') {
        // 自证：必须是**有材料**的空会话态（开场块 + 屏底常驻 composer）。
        // 不写这两条的话，上传没生效时会把「还没有可参考的资料」那张无材料态当数据态冻进去
        // ——而那正是 visual.spec 已经有的四张，等于新基线什么都没多盖、却看着多了四张。
        await page.locator('.lite-room-welcome').first().waitFor({ timeout: 10000 })
        await expect(page.locator('.lite-room-nomaterial'), 'room 数据态不允许拍到无材料态').toHaveCount(0)
      }
      if (sc === 'home') {
        // 自证：#65 后差距对照卡默认展开，是本 spec 的核心覆盖对象——不在场就红，绝不拍假数据态。
        await page.locator('.lite-gap-card').first().waitFor({ timeout: 10000 })
      }
      await page.waitForTimeout(500)
      await expect(page).toHaveScreenshot(`${look}-${sc}-data-${testInfo.project.name}.png`, {
        animations: 'disabled',
        caret: 'hide',
        scale: 'css',
        maxDiffPixels: 50,
      })
      if (sc === 'home' && testInfo.project.name === 'mobile') {
        // 手机首屏截图拍不到差距块（视口截图 + 块在折叠线下，滚动在 .scene 内部容器）——
        // born-red 实测：对照卡变异在手机 home 上 0 红。旗舰卡不能只在桌面有像素覆盖，
        // 手机加一张滚到差距块的专拍。桌面不加：右轨首屏在画面内，变异已实证能红。
        await page.evaluate(() => document.querySelector('.lite-home-gaps').scrollIntoView({ block: 'start' }))
        await page.waitForTimeout(500)
        await expect(page).toHaveScreenshot(`${look}-home-gaps-data-mobile.png`, {
          animations: 'disabled',
          caret: 'hide',
          scale: 'css',
          maxDiffPixels: 50,
        })
        // 拍完滚回顶：别让后续屏的采样继承一个滚动过的容器状态。
        await page.evaluate(() => document.querySelector('.lite-home-gaps').closest('.scene')?.scrollTo(0, 0))
      }
    }
  })
}
