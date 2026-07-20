#!/usr/bin/env node
// 验证专用 dev server —— 与 verify-p0.mjs 配套（p0 也可以直接吃 VERIFY_BASE 打别的服务）。
//
// 为什么不直接 `npx vite`：所有 feature 工作树的 node_modules 都是指向 D:/avery/node_modules
// 的 junction（省磁盘），于是 `node_modules/.vite`（依赖预构建缓存）也被所有工作树共用。
// 多个 dev server 并发时会互相把对方的缓存判为 outdated → 浏览器收到 504 Outdated Optimize Dep
// → 页面白屏。这会让验证得出「应用崩了」的假结论——集成期已经真踩过一次。
// 独立 cacheDir 就能隔离。
//
// 门清仓 2026-07-20（progress.md Blockers 4）：此前一跑就崩的根因，都修在这一版里——
//   ① root 写死 'D:/avery-wt/gate'——那个工作树 07-20 大扫除时已拆掉，剩个空壳；改为
//      process.cwd()（从仓库根跑；别处跑就传 VERIFY_ROOT）。
//   ② createServer 默认加载 vite.config.ts → react() 要 @babel/core（本仓从没装过）→ 崩。
//      与 verify-data-boundary 同款修法：configFile:false + esbuild 原生 JSX + 手搬
//      envPrefix / __AVERY_BUILD__ define（main.tsx 无条件引用它，不 define 就白屏）。
//   ③ 端口写死 5173 会与常驻 preview 硬撞；改 VERIFY_PORT 可调，默认仍 5173（后端 CORS
//      精确匹配 5173，换端口要配 AVERY_CORS_ORIGINS，见 verify-p0 文件头）。
//
// 用法： node .issues/v02-partner-align-0718/verify-server.mjs
//        VERIFY_PORT=5305 node .issues/v02-partner-align-0718/verify-server.mjs
import { createServer } from 'vite'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const PORT = Number(process.env.VERIFY_PORT || 5173)
const ROOT = process.env.VERIFY_ROOT || process.cwd()

const s = await createServer({
  root: ROOT,
  configFile: false,
  esbuild: { jsx: 'automatic' },
  envPrefix: ['VITE_AVERY_', 'VITE_SUPABASE_'],
  define: {
    __AVERY_BUILD__: JSON.stringify({
      mode: 'story',
      locale: 'en',
      apiBase: '(local default 127.0.0.1:8137)',
      commit: '(verify-server dev)',
    }),
  },
  cacheDir: join(tmpdir(), 'avery-gate-vite-cache'),
  server: { port: PORT, strictPort: true },
  optimizeDeps: { force: true },
})
await s.listen()
console.log(`gate vite ready on ${PORT}, root=${ROOT}, isolated cacheDir`)
