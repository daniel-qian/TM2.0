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

## 填 Supabase 密钥：本棒故意没填（理由）

能力探测（§0④ 的 (b)）已交付并让「填 key」这步永久安全。但现在填是**零价值惰性**：后端 404，探测会一直隐藏登录框，填了也不显示。**等 feat-053 + 迁移 0008 上线（后端真提供 /account/*）再填才有意义**——而那要碰 0008 建表地雷，不该为了填 key 去动。这正是 §0④ 自己的结论。

## 留给下一棒的对抗盲区（本棒没跑昂贵的前端发现 campaign，如实列）

后端服务端强制（上限/超量/空文件/越权/坏文件）已被对抗电池覆盖——那是真正的执行点，前端**没有客户端校验**。前端剩余次要盲区（scout 确认，多数已被 store 的 switchSeq/abort 守着，非高危）：
- **真实 Supabase 登录表单路径**（email/password 提交、注册邮箱验证分支）零 Playwright 覆盖——但 prod 没配 key 故此路径休眠。
- **并发多标签 / 多 context** 真实竞争没测（现有门都是单 page 内 setTimeout 模拟）。
- **`verify-p0.mjs` 的 tab 点击循环封顶 5 个**（现在 9 个 tab），`notes/closer-look/playbooks/vision` 拿不到「参数跨导航存活」断言。
- **判读卡渲染**已进 zh-purity 门的 ROOM_SCRIPTS，但**无障碍 aria-label 仍全英文**（门扫 innerText 结构上看不见，88 处）。

## 环境坑（仍然成立）
- 共享 `node_modules` 缺 `@babel`：`vite dev` serve 模式起不来，门要用 `vite build --mode dev` + `vite preview` 或临时 esbuild-JSX vite config。端口 5173/8137 常被并发 session 占，门用隔离端口 + 配 `AVERY_CORS_ORIGINS`。
- `afk-kickoff-completion-b6cab1` 工作树是孤儿（分支已删）但被一个**活跃 session** 的 shell 占着，删不掉，留待其退出后清。

## 中文文案状态
开关 + 判读卡的中文都是 **M3 草稿**（zh.ts 头部有 provenance NOTE）。按惯例直接上线不等审字，但 Danny 可回头调词。
