// 自家像素基线 runner 配置（cr-align 视觉战役棒0 · 2026-07-21）。
//
// 对我们自己（不 diff 合伙人 app）：多棒换肤期间，计算值门只盯点名探针，
// 截图盯其余一切——防「改 A 屏震了 B 屏」的无声漂移。
// 基线 PNG 提交在 __snapshots__/（单机单 OS 采集，跨机重采）。
// 确定性三板斧：stub 数据 + reducedMotion + deviceScaleFactor 1；
// 更新基线只在人审对照板通过后：--update-snapshots 同 commit 提交。
//
//   node node_modules/playwright/cli.js test -c eval-harness/visual
import { defineConfig } from 'playwright/test'

export default defineConfig({
  testDir: '.',
  timeout: 120000,
  // 平台后缀去掉：基线本来就是单机产物，名字要稳定可读
  snapshotPathTemplate: '{testDir}/__snapshots__/{arg}{ext}',
  use: {
    deviceScaleFactor: 1,
    reducedMotion: 'reduce',
    locale: 'zh-CN',
    timezoneId: 'Asia/Shanghai',
  },
  projects: [
    { name: 'desktop', use: { viewport: { width: 1440, height: 900 } } },
    { name: 'mobile', use: { viewport: { width: 375, height: 812 } } },
  ],
  reporter: [['list']],
})
