# 满态对齐战役 · runbook（环境/命令/纪律/陷阱）

> 供 AFK 夜跑 session 直接照抄。所有命令 2026-07-22 当天实跑验证过。
> 工作分支：接着 `claude/layout-real-components-27b594` 干（皮对齐三批全在上面，未推）。

## 0. 环境三口

```bash
# 后端 mock（三 env 缺一就真出网烧钱；起过就别重复起，先 curl /health 探活）
cd /d/avery/eval-harness && AVERY_BRAIN=mock AVERY_EXTRACTOR=heuristic AVERY_EMBEDDINGS=keyword \
  AVERY_DEMO_SEED_DIR=tests/fixtures/demo-seed \
  /c/Python313/python.exe -m uvicorn service.app:app --host 127.0.0.1 --port 8137 --app-dir .
# 探活：curl http://127.0.0.1:8137/health → 必须 "brain":"mock"

# 前端（本仓 vite dev 起不来：node_modules 是 junction 缺 @babel；禁 npm install/npm run build）
cd /d/avery && node node_modules/typescript/bin/tsc -b \
  && node node_modules/vite/bin/vite.js build --mode development \
  && node node_modules/vite/bin/vite.js preview --port 5173
# 端口被占说明已有 preview 挂着——vite preview 直读 dist/，重建后老 preview 自动吐新构建，不用重启

# 她方参照（对照板用）：cd /d/cr-live && npm run dev  （:3100，被占=已在跑）

# 后端 pytest（🔴 四个 deselect 必带，漏抄=真出网烧钱）
cd /d/avery/eval-harness && python -m pytest -m "not smoke and not seedgate and not needs_keys and not needs_db"
```

入口 URL **必带参**：`http://localhost:5173/?v=2&mode=live&lang=zh`（裸链落旧 story 壳）。
aurora 验证参数：`&look=aurora`。种子喂法（脚本内）：`window.__lite2Store.getState().uploadFiles(files)`
→ 等 `ingestStatus ∈ {ready,error}`（配方见 eval-harness/tools/verify-cr-alignment.mjs 头部）。

## 1. 电池纪律（🔴 一字别改）

- **电池名单唯一权威 = `eval-harness/tools/run-battery.mjs`（A 19 / B 3 / C 3 = 25 门）**；
  收官命令：`cd /d/avery && SPEC_STICK=99 node eval-harness/tools/run-battery.mjs` 连续两轮零红。
  runner 默认 SPEC_STICK=CURRENT_STICK（片内跑法），env 显式设了才覆盖；三段序/C 区后自动重建 dist 都由 runner 执行。
- **独占跑**：电池绝不与 agent/subagent 并发——并发=假红超时。
- **三段序 A→B→C**，C 区 dist 调包者**殿后**，跑完**必须重建 dev dist**再干别的。
- 统一前缀（单门手跑时）：`cd /d/avery && VERIFY_BASE=http://localhost:5173 node <gate>`。

以下手写门清单**只作速查用，以 runner 为准**（runner 的 A 区还含 `verify-file-manifest-truth` ·
`verify-onboarding-returning` 两道上传型门，速查清单未列全）：

**A 区**（吃共享 5173）：`eval-harness/tools/` 下 `verify-topbar-clearance` ·
`verify-cr-alignment`(需后端；`SPEC_STICK=N` 分期，收官跑全量) · `verify-skin-phases` ·
`verify-button-family`(需后端) · `verify-contrast-smalltext` · `verify-home-skeleton` ·
`verify-status-truth` · `verify-room-nomaterial` · `verify-room-usability`(需后端) ·
`verify-handoffs-empty-honesty` · `verify-switchers` · `verify-aria-zh`(需后端) ·
`verify-onboard-gate`(需后端+demo seed)；另 `.issues/v02-partner-align-0718/verify-p0.mjs` ·
`.issues/feat-068-frontend-deploy/verify-zh-purity.mjs` · `…/verify-bare-url-shell.mjs` ·
`…/verify-404-discriminator.mjs`。

**B 区**（自带服务器）：`.issues/v02-partner-align-0718/verify-data-boundary.mjs`(自起 5304) ·
`.issues/v02-joint-0719/verify-null-owner.mjs` · 像素
`node node_modules/playwright/cli.js test -c eval-harness/visual`。

**C 区**（🔴 dist 调包者，最后+独占）：`verify-auth-capability`(5281/8281) ·
`verify-auth-form`(5291/8291) · `verify-bundle-privacy`（**最毒**：跑完 dist 指向生产域名，
再碰任何上传路径=往生产库写数据——跑完立刻重建 dev dist）。

**扫雷**（永远 exit 0，看输出行）：`node eval-harness/tools/sweep-ui-defects.mjs`（9屏×2皮×3视口）；
`--selftest` 是硬门（8 PASS 才可信）。台账 `eval-harness/tools/ui-sweep-triage.json`。

**规格链**（spec→门→码，禁反向抄构建值）：她方计算值采集
`CR_BASE=http://localhost:3100 node eval-harness/tools/extract-cr-spec.mjs` → 草稿人筛后誊进
`eval-harness/specs/cr-align-spec.json`（行类型：prop/var/rect/count + tolerance exact/contains/px1/px2 + stick 分期）。

**对照板**：`VERIFY_BASE=… CR_BASE=… node eval-harness/tools/capture-align-board.mjs`
→ `eval-harness/reports/align-board/<日期>/index.html`（已改真 uploadFiles 喂种子，别改回 stub）。

**像素基线**（07-22 校验裁决后的统一口径）：36 张 untracked、同机有效。流程=**片内 agent 目检
diff → diff png+目检结论存档 `eval-harness/reports/pixel-evidence/<片号>/` → 备份旧基线（同目录
`.bak/`）→ `--update-snapshots` 重冻改动屏 → 片内像素门复绿**；11 收官全量两轮零红（含像素门）；
Danny 晨审 = acceptance-1.md 附 pixel-evidence 索引签认（人工闸从「重冻前」移到「晨审签认」，
push 人工闸不动）。⚠️ home-mobile 有 07-21 冻结的先天漂移（非回归，见
`.issues/layout-real-0722/acceptance-3.md §5`）。

## 1b. AFK 门离线跑法（live-frontend-gate 相位，🔴 全离线）

- 后端 = mock 三件套（AVERY_BRAIN=mock + AVERY_EXTRACTOR=heuristic + AVERY_EMBEDDINGS=keyword，§0 命令）。
  🔴 **绝不照抄 `scripts/gates/live-frontend-gate.md` 的 `AVERY_BRAIN=minimax`——那是真烧钱**。
- 跑法 = 照 `eval-harness/tools/verify-skin-phases.mjs` 的 headless 注入模式（playwright goto →
  addScriptTag 注入 `scripts/gates/live-frontend-gate.snippet.js` → evaluate 调相位函数收 JSON）
  跑 live-frontend-gate 相位；**issue 03 交付全相位 headless runner**（不再手工三 URL 注入）。
- **两世界 = 两次后端重启**：无 `AVERY_ALLOW_PERSON_SCORING`（关世界）跑一遍 + 设
  `AVERY_ALLOW_PERSON_SCORING=1`（开世界）再跑一遍，各自全绿才算过。

## 2. 代码红线（本战役口径，含 07-22 盘问后的更新）

- `shared/styles/00-base.css` / `src/story/**` / `src/lite/**` 一行不动；覆盖一律 `.lite2-shell` 前缀。
- aurora-only 覆盖用 `.lite2-shell[data-look='aurora']` 前缀；paper 跟结构不跟色。
- **en.ts 唯一文案源**；zh 走 `node scripts/i18n-zh-delta.mjs lite` 再 `node scripts/i18n-zh-delta.mjs lite2 --mirror=lite`
  （🔴 不用 i18n-zh.mjs / i18n-zh-lite2-delta.mjs——会静默冲掉 zh.ts 注释头）。
- AA 4.5:1 地板（verify-contrast 实算）；#4d5568 是压 aurora 渐变的达标灰。
- **人面数字 = 开关口径**（07-21 解禁 + 07-22 拍板，CONTEXT.md 已改）：开关开才显示
  负载/情绪，且必须带口径与出处；开关关 = 原零数字行为。别再抄「永不打分」绝对句。
- absent≠none：null=「文档未提及」≠0/空/默认；`data-empty-kind` absent/none 措辞不混。
- **手编赢+逐字段出处**（ADR-0028）；**富字段走真管道不注入**（ADR-0029）。
- 锁词：user-facing 不出现 `Nexus`/`现实差距`（verify-p0 扫 innerText）；「快问」是 Ask 专名；
  悬浮入口叫「问 Avery」。她的**文本/源码一个字不抄**（CSS 数值/交互概念可参考）。
- 新动效必包 `@media (prefers-reduced-motion: no-preference)`（媒体级隔离不提特异性）；
  新输入框必给 aria-label；CSS 注释禁「星号紧跟斜杠」。
- 判据吃 `statusRaw`/`ownerNameRaw`，渲染才用 status/ownerName。
- push = Vercel 自动上产 = **人工闸**。整场战役 commit 攒分支，最后交验收表单等 Danny。

## 3. 已知陷阱（本 session 实撞）

- `?transport=stub` **已不灌数据**（contextId 恒 null）——别拿它造世界，用 uploadFiles 配方。
- localStorage `lite2:` 前缀存 contextId，刷新自动恢复——测「从头开始」用无痕窗/清键。
- 后端 8137 常驻不重启：改了 service/*.py 记得杀掉重起才生效（占 8137 的进程就是它）。
- 中文 .ps1 必 pwsh + UTF-8 BOM（powershell 5.1 啃坏无 BOM 文件）。
- 大文件一次性巨写会 Server error：先骨架后分段 Edit 追加。
- Browser pane 截图超时：取证走计算值或本地 Playwright 直拍（脚本放 /d/avery 下跑）。

## 4. 语料源（三亚）

- 调研综合：`D:\Boyle\research\sanya-lushan-yiju-hotel\00-findings.md`（酒店实况+组织架构通识）
- 0721 脱敏 seed：`…\0721-脱敏seed\`（工作汇报 docx + 5 份虚构匿名简历 pdf）——扩展基底
- 包草稿：`…\pack-draft\`（facts.md · playbooks-and-signals.md · cases/ · manifest.draft.json）
- 口径：**原创**（她 demo 的文本零抄袭）；人名小王/小张式代号；**成稿免审**（Danny 07-22 拍板）；
  富字段按抽取器语法写进文档（语法随 issue-01/02 定稿，写语料前先读它们的落地注释）。
