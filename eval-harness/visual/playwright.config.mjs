// 自家像素基线 runner 配置（cr-align 视觉战役棒0 · 2026-07-21）。
//
// 对我们自己（不 diff 合伙人 app）：多棒换肤期间，计算值门只盯点名探针，
// 截图盯其余一切——防「改 A 屏震了 B 屏」的无声漂移。
//
//   node node_modules/playwright/cli.js test -c eval-harness/visual
//
// ## 确定性靠什么（这一段**不是断言，是索引**）
// 这份注释以前写着一句现在时的话——「确定性三板斧：stub 数据 + reducedMotion +
// deviceScaleFactor 1」。其中 reducedMotion 那一项**从落地那天起就没生效**（根因见下），
// 而注释本身既不会红也不会有人复核，于是它烂在这儿两个月，还被后面的票当依据引用。
// 所以现在的写法是：**每一项都由一条跑得起来的判据看着，这里只写它住在哪**。
//
//   · 浏览器侧四项（reducedMotion / deviceScaleFactor / locale / timezoneId 真落到了页面上）
//     + 「没有别的 spec 自己 newContext 绕开这份配置」
//     → `visual-determinism.spec.mjs`，跟基线同一条命令里跑，改坏必红。
//   · 「stub 数据」那一项**是假的，已删**：`?transport=stub` 在 build+preview 产物上是死的
//     （store.ts 的 `import.meta.env.DEV` 被 vite build 静态求值成 false，#68 实测）。
//     空态基线靠的是 fresh context = team===null，数据态靠 visual-data/visual-map 真上传种子。
//   · 基线 PNG **不提交**：`.gitignore` 第 34 行忽略整个 `__snapshots__/`，它是单机产物、
//     每个 worktree 一份。自查：`git check-ignore -v eval-harness/visual/__snapshots__`。
//     重冻只在人审对照板通过后跑 `--update-snapshots`，冻在**主检出**（worktree 里冻＝白冻）。
//
// ## 🔴 reducedMotion 为什么必须写在 contextOptions 里
// playwright 1.61.1 的 `use` 顶层**没有** `reducedMotion` 这个键。runner 建 context 的
// `_combinedContextOptions` fixture（`node_modules/playwright/lib/index.js`）是一张**写死的
// 白名单**——acceptDownloads / colorScheme / deviceScaleFactor / locale / timezoneId /
// viewport / userAgent … 逐个 if 拷过去；`reducedMotion` 不在其中，全库 grep 零命中：
//
//   grep -rc reducedMotion node_modules/playwright/lib/    # → 0
//
// 顶层写它不会报错、不会 warning，`testInfo.project.use.reducedMotion` 甚至照样读得出
// 'reduce'（配置对象是原样留着的），只是**永远不会到浏览器**。这就是它能烂两个月的原因：
// 长得跟生效一模一样。playwright 自己的类型文档里，`contextOptions` 那条的示例用的**正是**
// `contextOptions: { reducedMotion: 'reduce' }`（types/test.d.ts）——这条路是官方出口。
// 优先级实测过：白名单里的显式键压 contextOptions（同时写 locale 时 zh-CN 赢），
// 所以塞在这里不会动到下面四项。
import { defineConfig } from 'playwright/test'

export default defineConfig({
  testDir: '.',
  timeout: 120000,
  // 平台后缀去掉：基线本来就是单机产物，名字要稳定可读
  snapshotPathTemplate: '{testDir}/__snapshots__/{arg}{ext}',
  use: {
    deviceScaleFactor: 1,
    // 🔴 不要挪回顶层 `reducedMotion: 'reduce'`——那样写等于关掉它（理由见文件头）。
    contextOptions: { reducedMotion: 'reduce' },
    locale: 'zh-CN',
    timezoneId: 'Asia/Shanghai',
  },
  projects: [
    { name: 'desktop', use: { viewport: { width: 1440, height: 900 } } },
    { name: 'mobile', use: { viewport: { width: 375, height: 812 } } },
  ],
  reporter: [['list']],
})
