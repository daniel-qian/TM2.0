# open loop 交接 · 2026-07-20（本棒做完的 + 留给下一棒的）

线上 main = `d6d6cd4`（已 push，Vercel 已构建上线，实测 bundle 内嵌该 SHA）。

## 本棒落地（都已上线/验证）

1. **同步 + 清理**：6 个工作树盘清，三条线并入 main（origin/main、jolly-shaw 装饰剥离、suspicious-shtern 议事室 i18n）；删 4 个 stale 工作树 + 9 个已合并本地分支 + 2 个远程旧分支；push。
2. **后端子集三条**（`6f838f3`+`a45bb4a`+`d184b6c`）→ 生产。理由用「解码器从不说我不确定」（按 §0① 更正，不用日韩名册）。决策级验证：简体/繁体中文正确高置信、日文正确解码不冒充中文、带 `decode_confidence`。无 0008，库零新写入。
3. **对抗电池逮到并修掉真实高危 bug**（本棒最高价值）：`parse.py` 四个提取器只包了库的 import、没包解析本身，坏文件（截断 PDF / 假 xlsx/docx / 坏 XML / 超 stdlib 上限的 CSV 单元格）→ HTTP 500 且拖垮同批好文件。修复 `fb81811`：库异常兜成 ParseError，CSV field 上限抬到单文件上限。对抗电池 17 过、回归 164 过。→ 已第二次上生产。
4. **语言 + 皮肤开关**（`285aa9f`）：可点、localStorage 记忆、即时生效、深链参数优先。20 项新门。
5. **AuthPanel 能力探测**（`2a8422e`）：先探 `/account/status`，非 200 不渲染登录框。反向验证重现了原 bug。
6. **判读卡中文化**（`1f518bb`）：~20 个英文结构标签 + 2 个裸枚举值走 i18n。**zh-purity 86→29**。

后端两次热替换回执 + 三级回滚指针见 [deploy-receipt-backend-0720.md](deploy-receipt-backend-0720.md)。

## 三个基线修正（kickoff 里的旧数已过时）

- **zh-purity 真值是 86（v01 30 · v02 56），不是 kickoff 说的「v02 9」**。switcher 逐字节验证过。本棒把判读卡那块修掉后降到 **29**。剩下的 29 全是 `/vision` 屏的**故意中英混排营销文案** + 后端**工具标识符**（TOOL/MANIFEST/read_case/cite 等）+ 一句 "thinking it through"。**这 29 里没有一处是判读卡标签了。** issue #19「v02-only」的前提仍然错（两张皮都有 /vision 那块）。
- **Vercel `avery-lite` 现在没配 Supabase key**（只有 API_BASE + LOCALE）。所以登录框本来就不显示。
- 生产库仍无 `account_contexts`，`/account/* → 404`。

## 账号体系：已整条打通（Danny 当面拍板后同一棒补上）

先交付了能力探测（让填 key 永久安全），随后 Danny 拍板「填了密钥吧，把 feat-053 也上了」，于是同一棒补完：

1. **feat-053 后端上线**（镜像 `zh512acct-20260720-123003`）：迁移 0008 建了 `avery.account_contexts`（只有两个不透明 id、无人员数据、红线不动），`/account/status` 公网 200，Supabase 安全告警 0 条。
2. **Vercel 填了** `VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY`（Production+Preview，用 publishable key），redeploy 后烘进 bundle。
3. **线上端到端实测**：`accountCapability: "supported"`（探测拿到 200）、`status: "guest"`、顶栏出现「登录」、点开是全中文邮箱/密码表单（零英文），并诚实写着「不登录也能用」——游客路径没被挡。

⚠️ 建表机制：0008 **不在容器启动时**执行，而在**第一次真正访问 registry** 时重放。本棒已主动用一个无害 404 读触发，别让第一个真实客户请求去承担。

## 补跑的第二轮（Danny 选了「B 组」后同一棒做完，均已上线验证）

- **登录路径测试**（`9e893a1`）：`verify-auth-form.mjs` 39 PASS。全程 `page.route` 拦截 Supabase，**不注册真账号、零真实认证流量**。覆盖表单渲染(零英文)/登录成功→`X-Avery-Account` 头/失败→中文人话错误/注册待验证不假装已登录/游客路径仍活/换身份清公司域，以及红线不变量：access_token 绝不进 URL、绝不进我们自己的 `lite2:*` localStorage。反向验证 37·2。
- **aria-label 中文化**（`d32c42d`）：33 个键，两张皮全覆盖。新增 `verify-aria-zh.mjs` **扫属性而不是 innerText**，堵住纯度门的结构性盲区（23 → 0）。线上实测 14 个 aria-label 零英文。
- **公开 bundle 泄露修复**（`6c5f009`）：线上曾有 19 个 `VITE_VERCEL_*`，含**提交正文原样**（客户 devtools 可读我们内部对「产品哪里在撒谎」的讨论）。根因是 Vite 默认内联所有 `VITE_` 前缀变量 + Vercel 自动暴露系统变量。全仓实际只读 5 个变量，无一处读 `VITE_VERCEL_*`，所以把 `envPrefix` 收窄到 `['VITE_AVERY_','VITE_SUPABASE_']`。**线上复验：19 → 0**。
  commit SHA 改从 Vercel 的**非 `VITE_`** 系统变量读、显式戳进 `__AVERY_BUILD__.commit` —— 验证「线上跑的是哪一版」从碰巧泄露的副产品变成正式契约。新门 `verify-bundle-privacy.mjs` 自己造出 Vercel 注入环境再构建（这个条件只在构建机上存在、本地看不出来），反向验证放宽 envPrefix → 3 条精准变红。

## 留给下一棒的对抗盲区（本棒没跑昂贵的前端发现 campaign，如实列）

后端服务端强制（上限/超量/空文件/越权/坏文件）已被对抗电池覆盖——那是真正的执行点，前端**没有客户端校验**。前端剩余次要盲区（scout 确认，多数已被 store 的 switchSeq/abort 守着，非高危）：
- ~~真实 Supabase 登录表单路径零覆盖~~ → **已补**（`verify-auth-form.mjs`，见上）。仍未覆盖：登出流程、guest→authed→guest→authed 的清场分支。
- ~~aria-label 全英文~~ → **已修 + 已加属性扫描门**（见上）。
- **并发多标签 / 多 context** 真实竞争没测（现有门都是单 page 内 setTimeout 模拟）。
- **`verify-p0.mjs` 的 tab 点击循环封顶 5 个**（现在 9 个 tab），`notes/closer-look/playbooks/vision` 拿不到「参数跨导航存活」断言。
- **后端还有 26 个提交没部署**，最大的是**决策定级**（608 行）—— 首屏「今天要决策的」现在算不出定级。要不要上是范围决定，等 Danny。
- **v01 的 `status ?? 'on-track'`**（`src/lite/teamData.ts:179`）：文档没说状态时直接断言「正常推进」。改它会连带动状态点颜色/描边/分组，且 v01 是逃生门 —— 等 Danny 拍。
- **`/vision` 屏 29 处中英混排**（issue #19）归品牌口径，等 Danny。

## 环境坑（仍然成立）
- 共享 `node_modules` 缺 `@babel`：`vite dev` serve 模式起不来，门要用 `vite build --mode dev` + `vite preview` 或临时 esbuild-JSX vite config。端口 5173/8137 常被并发 session 占，门用隔离端口 + 配 `AVERY_CORS_ORIGINS`。
- `afk-kickoff-completion-b6cab1` 工作树是孤儿（分支已删）但被一个**活跃 session** 的 shell 占着，删不掉，留待其退出后清。

## 中文文案状态
开关 + 判读卡的中文都是 **M3 草稿**（zh.ts 头部有 provenance NOTE）。按惯例直接上线不等审字，但 Danny 可回头调词。
