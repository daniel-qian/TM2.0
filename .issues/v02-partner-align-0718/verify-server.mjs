#!/usr/bin/env node
// 验证专用 dev server —— 与 verify-p0.mjs 配套。
//
// 为什么不直接 `npx vite`：所有 feature 工作树的 node_modules 都是指向 D:/avery/node_modules
// 的 junction（省磁盘），于是 `node_modules/.vite`（依赖预构建缓存）也被所有工作树共用。
// 多个 dev server 并发时会互相把对方的缓存判为 outdated → 浏览器收到 504 Outdated Optimize Dep
// → 页面白屏。这会让验证得出「应用崩了」的假结论——集成期已经真踩过一次。
// 独立 cacheDir 就能隔离。
//
// 用法： node .issues/v02-partner-align-0718/verify-server.mjs
import { createServer } from 'vite'
const s = await createServer({
  root: 'D:/avery-wt/gate',
  cacheDir: 'D:/avery-wt/gate/.vite-gate-cache',
  server: { port: 5173, strictPort: true },
  optimizeDeps: { force: true },
})
await s.listen()
console.log('gate vite ready on 5173, isolated cacheDir')
