// TEMPORARY — feat-055 集成验收专用，跑完即删（绝不提交）。
// 唯一存在的理由：node_modules 是指向 D:\avery\node_modules 的 junction，多条并行线共用，
// 连 `node_modules/.vite/deps` 这份依赖预打包缓存也共用。两台 dev server 同时 re-optimize
// 会互相踩烂对方的 deps（表现为 "Invalid hook call / mismatching versions of React"）。
// 这里只做一件事：把 cacheDir 指到本线专属目录，别的一律照抄 vite.config.ts。
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  cacheDir: 'D:/avery-wt/055/.vite-verify055',
  define: {
    __AVERY_BUILD__: JSON.stringify({ mode: 'story', locale: 'en', apiBase: '(dev)' }),
  },
})
