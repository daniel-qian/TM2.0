// #106 B3 · 团队地图 `/map` 的像素基线 —— 3 态 × 2 皮 × 2 视口 = 12 张。
//
// ## 为什么另起一个文件而不是并进那两份
// ① **它不在 `goScreen()` 的射程里**。`/map` 照 `PAPERWORK_PATH` 先例是独立 path 常量、
//    刻意没进 `LiteScreen` 联合类型（顶栏 9 tab 已在窄屏溢出）。那两份 spec 的采样循环全是
//    `goScreen(sc)`，地图根本进不去——硬塞进 SCREENS 数组的下场是 `goScreen('map')` 兜底回
//    home，把 home 又拍一遍还叫错名字（#63 的 closerlook 就是这么白拍了两票）。
// ② **一个 test 串多次 `toHaveScreenshot`，首处不匹配即中止**（那两份文件头都记着这条）。
//    分文件 = 地图漂了不殃及九屏的漂移清单，反之亦然。
//
// ## 三态各自守什么
// · `empty`  —— 没有花名册时**不渲染空板**（PRD §3.6）：一块画着网格却没有节点的板看着像坏了。
//               这一张钉的就是「该出现的是团队页那套引导语，不是一块空板」。
// · `calm`   —— 骨架：人按部门站好 + 项目条 + HUD-lite。B1/B2/B3 三棒的静态面全在这一张里。
// · `focus`  —— 票面写死的那条具名剧本：**点小徐 → 草坪婚宴旺季档亮起来**。连线、mini 卡、
//               被压暗的其余部分、HUD 上「回到全景」的出现——这一整面只在 focus 态存在，
//               calm 那张一个像素都盖不到它。
//
// ## 自证判据（不落假基线）
// 每张拍之前都先 `waitFor` / `expect` 一个「这一态**成立**」的证据：
// 空态要有引导卡且板上零节点；数据态要有节点**且有 HUD**（漏了 HUD 会拍出一张看着正常、
// 其实整条 B3 都不在画面里的基线）；focus 态要有连线（focus 没生效时那张跟 calm 一模一样，
// 冻进去等于凭空多了一张永远不会红的基线）。
//
// ## 时钟
// `setFixedTime` 从**第一天**就钉上。地图自己的文案不读墙上时钟（到期日是文档原文），
// 但整块壳（顶栏/铃铛/页脚）会，而基线拍的是整个视口。新 spec 没有旧基线要作废，
// 所以钉钟的成本是零、不钉的成本是「哪天无声腐烂」——旧那 36 张当初不钉是因为重冻要钱。
//
// ⚠ 基线 PNG 是 gitignore 的**单机产物**，且**每个 worktree 一份**：在 worktree 里冻＝白冻。
//   真基线在主检出、spec 先合进本地 main、人眼过对照板之后再冻（PRD §7）。
//
// ## 跑法（🔴 四件套，不是三件套）
//   cd eval-harness && AVERY_BRAIN=mock AVERY_EXTRACTOR=heuristic AVERY_EMBEDDINGS=keyword \
//     AVERY_DEMO_SEED_DIR=tests/fixtures/demo-seed AVERY_ALLOW_PERSON_SCORING=1 \
//     python -m uvicorn service.app:app --port 8137
// 第四件 `AVERY_ALLOW_PERSON_SCORING=1` 以前没写在任何地方，只活在冻基线那次的 shell 里：
// 关着它时后端不把 self_report 投影到人卡上，组级读数（「有人自述吃紧」）整行消失，
// 而当时**没有任何一条判据够得着**——0818 差点把少一行字的那版当成 reducedMotion 的功劳
// 整批冻进去。现在 calm 那一段有一条 `.lite-map-zone-read` 自证盯着它。
// ⚠ 依赖后端在场（mock 三件套）：上传落不了地时 `.upload-ready` 超时红——红形态是
//   「上传等不到」，不是假绿。
import { test, expect } from 'playwright/test'
import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const UI = process.env.VERIFY_BASE || 'http://localhost:5173'
const HERE = dirname(fileURLToPath(import.meta.url))
const SEED_DIR = join(HERE, '..', 'tests', 'fixtures', 'demo-seed')
const LOOKS = ['aurora', 'paper']

// 🔴 票面 B2 的验收原话：「点小徐亮草坪婚宴旺季档」。id 是后端 `_link_owners` 从
// 《项目总览.md》的「负责人：小徐」那一行解出来的，写死在这儿是**故意**的——
// 语料换了、抽取变了，这张基线会以「没有连线」的形态当场红，而不是悄悄拍一张别的东西。
const FOCUS_TOKEN = 'person:u_小徐'

const seedFiles = () =>
  readdirSync(SEED_DIR)
    .filter((n) => n.endsWith('.md'))
    .sort()
    .map((n) => ({ name: n, mimeType: 'text/markdown', buffer: readFileSync(join(SEED_DIR, n)) }))

for (const look of LOOKS) {
  test(`${look} 团队地图三态基线`, async ({ page }, testInfo) => {
    await page.clock.setFixedTime(new Date('2026-08-08T12:00:00+08:00'))
    const q = `v=2&mode=live&look=${look}&lang=zh`

    // ── ① 空态 ────────────────────────────────────────────────────────────
    await page.goto(`${UI}/map?${q}`, { waitUntil: 'networkidle' })
    if (await page.locator('.lite-onboard').count()) {
      await page.keyboard.press('Escape')
      await page.waitForTimeout(600)
    }
    await page.evaluate(() => document.fonts.ready)
    await page.locator('.lite-map-empty').waitFor({ timeout: 10000 })
    await expect(page.locator('.lite-map-person'), '空态不许渲染一块空板').toHaveCount(0)
    await page.waitForTimeout(400)
    await expect(page).toHaveScreenshot(`${look}-map-empty-${testInfo.project.name}.png`, {
      animations: 'disabled', caret: 'hide', scale: 'css', maxDiffPixels: 50,
    })

    // ── 真上传（Files 屏挂着无条件的上传口） ──────────────────────────────
    await page.goto(`${UI}/?${q}`, { waitUntil: 'networkidle' })
    await page.evaluate(() => window.__lite2Store.getState().goScreen('files'))
    await page.locator('input.upload-input').setInputFiles(seedFiles())
    await page.locator('.upload-ready, .upload-error').first().waitFor({ timeout: 90000 })
    await expect(page.locator('.upload-error'), '上传必须成功——失败时这里红，别落空基线').toHaveCount(0)

    // ── ② 数据态 calm ─────────────────────────────────────────────────────
    await page.goto(`${UI}/map?${q}`, { waitUntil: 'networkidle' })
    await page.locator('.lite-map-person').first().waitFor({ timeout: 20000 })
    // 🔴 HUD 必须在场。少了这一条，B3 整条（搜索/chips/药丸）可以整个消失而基线全绿——
    // 那时这张图看着仍然「像地图」，只是把新做的那一层悄悄拍没了。
    await expect(page.locator('.lite-map-chip').first(), 'HUD-lite 必须在画面里').toBeVisible()
    await expect(page.locator('.lite-map-edge'), 'calm 态不许有连线').toHaveCount(0)
    // 🔴 组级读数（「有人自述吃紧」）必须在场。它只在后端开了 AVERY_ALLOW_PERSON_SCORING
    // 时才投影得出来——那是一条**没写在任何跑法说明里**的前提，0818 实收：忘了带这个变量
    // 重跑，这四张 calm 基线整体少了一行字，而当时没有任何一条判据够得着，
    // 差点被当成「reducedMotion 改的」整批冻进去。前提缺席就在这里红，别让它悄悄改画面。
    await expect(page.locator('.lite-map-zone-read').first(),
      '组级读数不在画面里 → 后端多半没带 AVERY_ALLOW_PERSON_SCORING=1（见本文件头「跑法」）').toBeVisible()
    await page.evaluate(() => document.fonts.ready)
    await page.waitForTimeout(500)
    await expect(page).toHaveScreenshot(`${look}-map-calm-${testInfo.project.name}.png`, {
      animations: 'disabled', caret: 'hide', scale: 'css', maxDiffPixels: 50,
    })

    // ── ③ 数据态 focus（票面的具名剧本，深链进） ──────────────────────────
    await page.goto(`${UI}/map?${q}&focus=${encodeURIComponent(FOCUS_TOKEN)}`, { waitUntil: 'networkidle' })
    await page.locator('.lite-map-person').first().waitFor({ timeout: 20000 })
    // 自证：focus 真生效了。不写这一条的话，token 解不开时拍到的是一张 calm——
    // 与上一张几乎逐像素相同，从此永远不会红，也永远盖不住 focus 那一整面。
    await expect(page.locator('.lite-map-edge'), 'focus 没生效就别拍').not.toHaveCount(0)
    await expect(page.locator('.lite-map-node-card'), 'mini 卡必须长出来').toHaveCount(1)
    await page.evaluate(() => document.fonts.ready)
    await page.waitForTimeout(500)
    await expect(page).toHaveScreenshot(`${look}-map-focus-${testInfo.project.name}.png`, {
      animations: 'disabled', caret: 'hide', scale: 'css', maxDiffPixels: 50,
    })
  })
}
