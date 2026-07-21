> 侦察原件 · 视角 `gates` · 2026-07-22 自动生成，未经人工编辑。

Reconnaissance complete.

# 门 / 电池 / 规格链工具链侦察（只读，零改动）

## 0. 前提纠正（影响所有后续命令）

- **实施仓库 `D:/avery` 当前不在 main**：`git -C D:/avery branch --show-current` → `claude/layout-real-components-27b594`（HEAD `634693e`）。session-handoff 说"实施在 D:/avery 主检出"，但检出现在挂着战役分支。
- **`vite dev` 在本仓起不来**（共享 node_modules junction 缺 `@babel/*`）→ 所有门吃的是 **`vite build --mode development` + `vite preview`**，不是 dev server。唯一例外 `verify-data-boundary.mjs`（自带 `createServer()` + `configFile:false` 绕开 babel）。见 `eval-harness/tools/verify-onboarding-returning.mjs:45-47`。
- 本仓 npm scripts 走不通（`npm run build` = `tsc -b && vite build`，但禁 `npm install`）→ 一律用 `node node_modules/vite/bin/vite.js …` 直调。

---

## 1. `D:/avery/eval-harness/tools/extract-cr-spec.mjs`（100 行）

**读她方 dev server，不读源码**。命令行零参数，全靠环境变量。

```bash
cd /d/cr-live && npm run dev &          # :3100
cd /d/avery && CR_BASE=http://localhost:3100 node eval-harness/tools/extract-cr-spec.mjs
```

- `extract-cr-spec.mjs:17` — `const CR = process.env.CR_BASE || 'http://localhost:3100'`（唯一入参）
- `extract-cr-spec.mjs:19` — 输出 **`eval-harness/reports/cr-spec-draft.json`**（gitignored 草案，非 tracked spec）
- `extract-cr-spec.mjs:21` — 路由表硬编码 7 条：`['/', '/projects', '/people', '/gaps', '/nexus', '/checklist', '/playbooks']`。⚠️ **`/companyinput`（隐藏第八条，plan.md:6 点名）不在表里**；本战役若要提 onboarding/闸门页规格必须先加。
- **红线守卫**（`:5` 注释 + `:86-91`）：每条路由先断言 `resp.status() === 200`，再 `waitForSelector('header a')` 证 React 已挂载 — 专防误读根 `index.html`（901 行过期英文原型）。
- 采什么（`:23-78` 的 `PROBE` 字符串，在页内 evaluate）：
  - `out.vars` — 递归走 `document.styleSheets` 规则树抓 `:root/:host/^html` 上的 `--*`（`:27-40`；Tailwind v4 `@theme` 裹在 `@layer theme`，`getComputedStyle` 不枚举自定义属性，必须走规则树）
  - `out.probes.*` — `topbar`(header) / `main` / `bodyBg` / `h1` / `h1sub` / `sectionLabel`(.section-label) / `cardBase`(.card-base) / `glass`(.glass) / `navActive`+`navInactive`（按 `href===location.pathname` 判活动）/ `buttons`（前 24 个可见 button，文字截 12 字 + 6 个计算值）/ `badges`（`borderRadius>=999` 且文本 <8 字，前 12 个）
- 视口固定 `1440×900`（`:81`），`waitUntil:'networkidle'`，超时 60s。
- **只取 CSS 计算值**，零源码零数据搬运（`:6` 明文）。
- 草案 → **人工筛选** → 誊进 tracked `specs/cr-align-spec.json`。paper 皮永不入 spec。

**布局战役的直接缺口**：现有 PROBE 一个几何量都没采（没有 `getBoundingClientRect`、没有 grid/flex 属性、没有列宽/gap/栏数）。要做"布局对齐"必须扩 PROBE —— 现有 22 行 spec 里也没有任何一行是布局行（见 §2）。

---

## 2. `D:/avery/eval-harness/specs/cr-align-spec.json`（30 行文件 / **22 条 rows**）

结构：`{ "_readme": …, "rows": [ … ] }`。**当前最后一个 stick 号 = 4**（`cr-align-spec.json:25-28`）。

每行字段（全部实际出现的键）：

| 字段 | 含义 | 取值实例 |
|---|---|---|
| `key` | 稳定行 id，`域.名` | `topbar.glassBlur`、`btn.followupRadius` |
| `stick` | 交付棒分期（0/2/3/4）——门按 `SPEC_STICK` 判硬/软 | `0`=现状护栏 `2`=壳结构 `3`=token 加深 `4`=组件族 |
| `screen` | 九屏 id，门用 `goScreen(screen)` 切屏后测 | `home`(15条) / `notes`(3) / `playbooks`(1) |
| `selector` | `document.querySelector` 单选择器，一律 `.lite2-shell` 前缀 | `.lite2-shell .prototype-topbar` |
| `prop` | 取 `getComputedStyle(el)[prop]` | `paddingTop` / `backgroundColor` |
| `var` | 取 `cs.getPropertyValue(var).trim()`（与 `prop` 二选一） | `--paper` / `--lite2-surface` |
| `expected` | 期望串 | `"96px"` / `"rgba(255, 255, 255, 0.82)"` |
| `tolerance` | `exact`(11条) / `contains`(2) / `px1`(8) / `px2`(1) | 见 §3 判据 |
| `note` | 誊抄依据 + 偏差记档（她的值 vs 我方补偿值） | `"她 main pt-24=96px"` |

分布：stick0 **5 行**（`cr-align-spec.json:4-8`：3 个 token + shell fontSize 15px + aurora 渐变第一停靠点 `168, 139, 255`）· stick2 **8 行**（`:10-17`：topbar fixed/top14/r16/w1392/glassBg/glassBlur + `clear.home`/`clear.notes` 96px）· stick3 **5 行**（`:19-23`：h1 26px/800、eyebrow 13px/750、`--lite2-surface` `.97`）· stick4 **4 行**（`:25-28`：btn r9px/13px、badge 700、决策卡 `rgba(255,255,255,0.97)`）。

**必须知道的两条纪律**（都写在表里）：
- `_readme`（`:2`）："**门字面量（assertAuroraApplied）今后从本表誊出（spec→门→码）**" + "**AA 偏差已按台账 D1-D4 内化：本表凡小字色一律取我方 *-text 补偿值，不取她的原始灰**"。
- `:23` 的坑档：`--lite2-surface` 期望串写 `.97` 而不是 `0.97` —— **构建压缩会去掉自定义属性的前导 0**（棒3 实测）。

**布局战役接口**：新增行直接追加 `"stick": 5,6,7…` 段即可，门无需改代码（`SPEC_STICK=5` 自动把 ≤5 转硬断言、>5 标 `[FUTURE]`）。当前 22 行**全绿**（r7 收据 `receipt-r7-0722.md:22`）。

---

## 3. `D:/avery/eval-harness/tools/verify-cr-alignment.mjs`（112 行）

```bash
VERIFY_BASE=http://localhost:5173 SPEC_STICK=4 node eval-harness/tools/verify-cr-alignment.mjs
```

- `verify-cr-alignment.mjs:24-25` — `VERIFY_BASE`（默认 `http://localhost:5173`）；`SPEC_STICK` 不设 = `Infinity` = **全量硬断言**。
- **`SPEC_STICK=N` 语义**（`:99`）：`future = row.stick > STICK`。`future` 行照跑照打印但**不计红**（`:107-108` 只对 `!future` 的行算 `hardFail`）。exit code = `hardFail ? 1 : 0`。
- 世界搭建（跑之前门自己做的，抄来给新门用）：
  - `:43` 进 `${UI}/?v=2&mode=live&look=aurora&lang=zh` — **锁死 aurora**，paper 永不被本门测
  - `:44-47` 若 `.lite-onboard` 在场 → `Escape` + 600ms
  - `:48-56` 通过 `window.__lite2Store.getState().uploadFiles([File])` 灌一份中文周报 `SEED_DOC`（`:36-39`：望江咨询 W33 / 客户门户改版 / 陈静 / 状态正常），再 `waitForFunction` 等 `ingestStatus ∈ {ready,error}`（30s）→ **要真后端（mock 8137）**
  - `:59-71` 直接 `setState` 塞一条 `decisions[]` 决策对象（`grade:'high_risk'`、`owner_name:'陈静'`）造出决策世界 —— 注释指明配方源自 `verify-home-skeleton`
  - `:80-82` 按 `screen` 分组、`goScreen(s)` + 400ms 后逐行测
- **判据实现**（`:92-97`）：`exact` = `===`；`contains` = `String(actual).includes(expected)`；`px1`/`px2` = `Math.abs(parseFloat(actual)-parseFloat(expected)) <= 1|2`。选择器无匹配 → `actual===null` → 一律判红。
- **失败长什么样**（`:31-33`, `:100-101`, `:110`）：
  ```
  [FAIL] [stick3] type.h1 fontSize=26px — 实测 21.4px
  [FUTURE] [stick4] btn.followupRadius borderRadius=9px — 实测 999px
  [PASS] [stick2] topbar.top top=14px
  [FAIL] [stick4] card.decisionBg backgroundColor=rgba(255, 255, 255, 0.97) — 选择器无匹配 .lite2-shell .lite-home-decision

  ═══ cr 对齐规格：硬断言 19/22 绿 · 未来行剩 3 红（战役进度表）═══
  ```
  四种 tag：`PASS` / `FAIL` / `PASS·future` / `FUTURE`。实测值截断到 60 字符。

---

## 4. 23 门电池 —— 完整清单与跑法

`git ls-files "*verify-*.mjs"` = **31 个文件**，散在两处。其中 **6 个是死件/非门**（不进电池），**25 个候选**，实跑 23（下面标注）。

### 4a. 通用前置（除自起服务的门外，全部共用）

```bash
# ① mock 后端（三件套缺一就真出网烧钱 —— 见 AGENTS.md:48 + 记忆 gate-backend-offline-env）
cd /d/avery/eval-harness && AVERY_BRAIN=mock AVERY_EXTRACTOR=heuristic AVERY_EMBEDDINGS=keyword \
  AVERY_DEMO_SEED_DIR=tests/fixtures/demo-seed \
  /c/Python313/python -m uvicorn service.app:app --host 127.0.0.1 --port 8137 --app-dir .

# ② 健康 dev dist + preview（电池全程吃这一份；跑完 dist 调包者必须重来一次）
cd /d/avery && node node_modules/typescript/bin/tsc -b \
  && node node_modules/vite/bin/vite.js build --mode development \
  && node node_modules/vite/bin/vite.js preview --port 5173

# ③ 她方参照（只 extract-cr-spec / capture-align-board 需要）
cd /d/cr-live && npm run dev      # :3100
```

⚠️ **CORS 精确匹配**：后端 8137 只放行固定 origin 列表；前端换端口 → 浏览器静默拦掉 → 门表现为"页面空的/没数据"（`verify-p0.mjs:11-12`）。换端口必须同时给 `AVERY_CORS_ORIGINS`。

### 4b. A 区 · 吃共享 preview:5173 的门（**先跑，17 道**）

| # | 路径 | 验什么 | 吃什么 | 环境变量 |
|---|---|---|---|---|
| 1 | `eval-harness/tools/verify-topbar-clearance.mjs` | 九屏首标题 ≥ 顶栏带底+8px 结构不变量（两皮）+ elementFromPoint 遮挡取证 + 按钮族微断言（r9px/13px，誊自 spec stick-4） | preview 5173 | `VERIFY_BASE` |
| 2 | `eval-harness/tools/verify-cr-alignment.mjs` | 见 §3 | preview + 后端 8137 | `VERIFY_BASE`, `SPEC_STICK` |
| 3 | `eval-harness/tools/verify-skin-phases.mjs` | E 组皮相位：aurora 12 项计算值正断言 + paper 对 `PAPER_BASELINE` **逐字节 diff** + v01/story 零外泄（=「00-base 未被动过」的持续证明）。读 `scripts/gates/live-frontend-gate.snippet.js` | preview（`?transport=stub`，**不要后端**） | `VERIFY_BASE` |
| 4 | `eval-harness/tools/verify-button-family.mjs` | `.lite2-shell` 下每个可见 button 挂 `.lite-btn` 或命中 38 项白名单；防作弊断言族挂载 ≥15 | preview + 后端（要满世界） | `VERIFY_BASE` |
| 5 | `eval-harness/tools/verify-contrast-smalltext.mjs` | 小字 AA 4.5:1 实算（sage/honey/terracotta + `--ink-faint` 当文本色的场景） | preview 5173 | `VERIFY_BASE` |
| 6 | `eval-harness/tools/verify-home-skeleton.mjs` | 无数据指挥室骨架 4 块 + 决策→待办闭环真状态（17 判据）**骨架零数字** | preview（无需后端） | `VERIFY_BASE` |
| 7 | `eval-harness/tools/verify-status-truth.mjs` | `status ?? 'on-track'` 类假结论；27 判据仲裁者（棒6 染色红线的裁判） | preview | `VERIFY_BASE` |
| 8 | `eval-harness/tools/verify-room-nomaterial.mjs` | 议事室无材料时不假装可用（composer/chips 诚实空态，11 判据，短语级匹配） | preview | `VERIFY_BASE` |
| 9 | `eval-harness/tools/verify-room-usability.mjs` | 遮挡几何 / elementFromPoint / 真实点击全链路 / 滚轮×4 / 反向护栏×2（20 判据） | preview + 后端 | `VERIFY_BASE` |
| 10 | `eval-harness/tools/verify-handoffs-empty-honesty.mjs` | Team 屏「今天值得你留意」空态诚实（store 造两个世界互为护栏，10 判据） | preview | `VERIFY_BASE` |
| 11 | `eval-harness/tools/verify-switchers.mjs` | 齿轮次级菜单里语言/观感两开关（23 判据；收起时按钮**不在 DOM**是判据不是 bug；默认观感 = aurora） | preview | `VERIFY_BASE` |
| 12 | `eval-harness/tools/verify-aria-zh.mjs` | `aria-label`/`title`/`alt` 拉丁残留（**innerText 门够不着的那一类**）；四条硬失败含「采样总数为 0 即红」「议事室对话流空即红」 | preview + 后端（要真跑一次问答） | `VERIFY_BASE` |
| 13 | `eval-harness/tools/verify-onboard-gate.mjs` | OnboardGate 全屏闸门页 39 判据五世界（A 整页形态 / B 一键真拿副本 / C Escape=pause / D 延迟送出真送达 / E 路由 404 拦截） | preview + 后端 8137 + **demo seed** | `VERIFY_BASE`, `VERIFY_API`（默认 8137）, 后端要 `AVERY_DEMO_SEED_DIR` |
| 14 | `.issues/v02-partner-align-0718/verify-p0.mjs` | v02 对齐波集成（刷新还在 / 后退不掉出 / 缺失字段显示未知 / 两皮都正常，41 判据） | preview **必须 5173** + 后端 | `VERIFY_BASE`（默认 `127.0.0.1:5173`） |
| 15 | `.issues/feat-068-frontend-deploy/verify-zh-purity.mjs` | 九屏 `innerText` 拉丁残留；硬失败：pageerror 非空 / 议事室采样时对话流为空 | preview 5173 + 后端 | `VERIFY_BASE` |
| 16 | `.issues/feat-068-frontend-deploy/verify-bare-url-shell.mjs` | 裸链开哪张壳（4 PASS：裸链 2 + `?v=1` 逃生门 2） | preview 5173 | `VERIFY_BASE` |
| 17 | `.issues/feat-068-frontend-deploy/verify-404-discriminator.mjs` | 真 404 判据暗线（**刻意走真 HTTP transport + 真后端**；跑 stub 的门全会绿而生产两条路径全错，4 PASS） | preview 5173 + **真后端 404** | `VERIFY_BASE` |

### 4c. B 区 · 自带服务器 / 自带端口的门（**中段，3 道**）

| # | 路径 | 说明 | 环境变量 |
|---|---|---|---|
| 18 | `.issues/v02-partner-align-0718/verify-data-boundary.mjs` | **自带 dev server**（`createServer()` + `configFile:false` 绕 babel），端口 **5304**，cacheDir 落系统 temp（避开 worktree 共享 `.vite` → 504 白屏）。不打真后端也不用 stub：真 HTTP transport 起页后 `setTransport()` 注假。37 判据 | `VERIFY_PORT`(5304), **`VERIFY_OLD_STORE=<git-ref>`= born-red 开关**（`git show <ref>:src/lite2/store.ts` 喂 vite load 钩子，不 checkout 不 stash） |
| 19 | `.issues/v02-joint-0719/verify-null-owner.mjs` | `owner: null` 分支（生产真事故：编了个名字 "Unassigned"）；用 `__liteStore` 无条件缝 | 自建 |
| 20 | `eval-harness/visual/`（**像素基线**，见 §6） | 9屏×2皮×2视口=36 张 | `VERIFY_BASE` |

### 4d. C 区 · 🔴 **dist 调包者（必须殿后 + 独占跑，3 道）**

这三道**自己 `vite build` 改 `dist/`**，跑完 `dist` 不是你原来那份。棒4 电池序病根治的全部内容就是把它们挪到队尾（`receipt-r4-0721.md:77-85`）。

| # | 路径 | 它把 dist 打成什么 | 证据 |
|---|---|---|---|
| 21 | `eval-harness/tools/verify-auth-capability.mjs` | `spawn(vite build --mode development)` 带 `VITE_SUPABASE_URL`/`VITE_SUPABASE_ANON_KEY`(假 key)/`VITE_AVERY_API_BASE=http://127.0.0.1:8281`；再自起 `vite preview --port 5281 --strictPort`。**不还原 dist** | `verify-auth-capability.mjs:68-90` |
| 22 | `eval-harness/tools/verify-auth-form.mjs` | 同款，端口 **5291 / API 8291**；全程 `page.route` 拦 `/auth/v1/token`+`/auth/v1/signup`，不碰真 Supabase | `verify-auth-form.mjs:38,43-44,108` |
| 23 | `eval-harness/tools/verify-bundle-privacy.mjs` | `execFileSync(vite build --mode development)` 带**投毒 env**（19 个 `VITE_VERCEL_*` 里挑几个 + CANARY），**且不带任何 api base** → dist 落回 `vite.config.ts` 默认值 = **生产域名**。不需要浏览器/后端 | `verify-bundle-privacy.mjs:32-52` |

🔴 **`verify-bundle-privacy` 是最毒的一个**：它跑完之后对着 `vite preview` 跑任何会上传的门 = **往生产库里写测试数据**（AGENTS.md:59 记着 7/20 真发生过，三个 `员工花名册.csv` 落进生产 context）。

**准 dist 调包者（不 spawn build，但要求你手工重打）——排在 C 区前后都要小心**：
- `eval-harness/tools/verify-file-manifest-truth.mjs`：要求 `VITE_AVERY_API_BASE=http://127.0.0.1:8307` 重打 + preview 5307 + 后端 8307（带 `AVERY_CORS_ORIGINS=http://127.0.0.1:5307,http://localhost:5307`）（`:40-45`）
- `eval-harness/tools/verify-onboarding-returning.mjs`：要求隔离后端端口 + `VITE_AVERY_API_BASE` 重打 + preview 5299（`:39-50`）。🔴 `VITE_AVERY_API_BASE` 是**构建期常量**，preview 时再设无效。

### 4e. 死件 / 非门（**6 个，不要进电池**）

| 路径 | 为什么 |
|---|---|
| `.issues/v02-partner-align-0718/verify-server.mjs` | **不是门，没有断言**——是 `verify-p0` 的配套启动器（progress.md:636） |
| `.issues/v02-partner-align-0718/verify-fixA.mjs` | 纯函数断言，main 上曾 26ok/6fail |
| `.issues/v02-partner-align-0718/verify-fixA-live.mjs` | 要 8301/5301（没起）+ 一行文案过时（"未读到状态"→"状态未提及"） |
| `.issues/v02-partner-align-0718/verify-fixB-transport.mjs` | 三重过时：`ts.transpileModule` 解析不了 `../shared/i18n`、`httpErrorMessage` 签名变了、断言的 `withServerDetail` 在 main 里已不存在 |
| `.issues/v02-partner-align-0718/verify-fixB-upload-ui.mjs` / `verify-fixB-upload-layout.mjs` | 要 8302/5302（没起） |
| `.issues/v02-partner-align-0718/verify-blockers.mjs` | 一次性集成层复验（15 PASS），走 `curl`+`python` 造 GB18030 文件；非常备 |

⚠️ **诚实标注**：**"23"这个数字在任何 tracked 文件里都没有逐条名单**。我按 progress.md:838 的 17 道回归战列 + 战役新增 5 道（clearance/cr-alignment/visual/skin-phases/button-family）复原到 22，第 23 道无法从文档唯一确定（候选：`null-owner` / `404-discriminator` / `bare-url-shell` 三选一，三者都活着）。上表给的 23 道是可跑的最合理集合。**下一战役第一件事应该是把电池名单落成一个 tracked 的 runner 脚本或清单文件** —— 现在它只活在各棒收据的散文里，谁接手都要重新考古。

### 4f. 两条铁律（都是被咬出来的）

1. **电池必须独占跑** —— 与 agent 工作流并发会撞 CPU 超时出**假红**（棒4 第三轮出过 6 条假红，`session-handoff.md:175`）。
2. **顺序 = A 区 → B 区 → C 区（dist 调包者）→ 终局 dev 重建** —— 序错了中段的 `visual`/`button-family` 必红（"visual 中段必红四次实证"，`progress.md:876`）。

---

## 5. `receipt-r7-0722.md` 里的"电池实际跑法命令原文"

**该文件里没有任何命令行原文。** 全文 43 行，验证段（`:15-18`）只有门名 + 计数，跑法段（`:33-34`）只给验收 URL。逐字照抄：

```
## 验证

- 快门：skin-phases 16/16（playbookTag 蓝色探针原样绿=零迁移的证明）、button-family、
  clearance、cr-alignment(s4) 22/22 全穿越。
- 像素基线：animations:disabled 拍摄口径下 rise 不入镜，36 张原样绿（构造性）。
- **电池 23/23 全绿零红（连续第四轮）**；终局重建后净室扫雷 **0 件/0 指纹**；对照板重拍。
```
```
## 验收方式

dev server：http://localhost:5173/?v=2&mode=live&lang=zh（preview + mock 8137 + cr-live :3100 全在跑）；
对照板 eval-harness/reports/align-board/2026-07-21/index.html；demo 门一键进示例团队。
```

同目录其余 8 份收据（`receipt-r0r1` / `r2` / `r3` / `r4` / `r5` / `r6` / `plan.md` / `r4-recon-map.md`）经 grep 亦**无任何命令行原文**——最接近的是 `plan.md:41-43` 的固定环叙述：
```
sweep 扫雷（棒首+棒尾）→ triage → 实现 → 全电池（含 SPEC_STICK=当前棒 的 cr-alignment）→
对照板 Danny 过目 → 门字面量从 spec 誊（spec→门→码）+ 旧构建红证明 → 像素基线人审后 --update-snapshots
→ docs+push（=自动上产）
```
唯一 tracked 的环境起步命令原文在 `session-handoff.md:48-56`（见 §4a 已整合）。

---

## 6. 像素基线

- **配置**：`D:/avery/eval-harness/visual/playwright.config.mjs`（28 行）· **用例**：`visual.spec.mjs`（29 行）· **基线 PNG**：`D:/avery/eval-harness/visual/__snapshots__/` — **实测 36 个 .png**（`{look}-{screen}-{project}.png`，如 `aurora-home-desktop.png`）。
- **9 屏 × 2 皮 × 2 视口 = 36**（`visual.spec.mjs:7-8` 屏序与九屏一致；`playwright.config.mjs:23-26` desktop 1440×900 / mobile 375×812）。
- **⚠️ 基线 PNG 是 untracked**（`git ls-files` 对 `__snapshots__/` 零命中 —— 11.3MB 单机产物，走 review-shots 先例不入库）。跨机=全部重采。

跑：
```bash
cd /d/avery && VERIFY_BASE=http://localhost:5173 node node_modules/playwright/cli.js test -c eval-harness/visual
```
重冻：
```bash
cd /d/avery && VERIFY_BASE=http://localhost:5173 node node_modules/playwright/cli.js test -c eval-harness/visual --update-snapshots
```
只重冻一皮/一视口：
```bash
node node_modules/playwright/cli.js test -c eval-harness/visual --project=desktop -g "aurora 九屏基线" --update-snapshots
```

**确定性配方**（改动任何一条都会全表漂）：
- 数据 `?v=2&mode=live&look=${look}&lang=zh&transport=stub` — **stub 传输**，固定 16 人团队、零后端零随机（`visual.spec.mjs:12`）
- `reducedMotion:'reduce'` + `locale:'zh-CN'` + `timezoneId:'Asia/Shanghai'` + `deviceScaleFactor:1`（config `:17-21`）
- 截图口径：`animations:'disabled'`, `caret:'hide'`, `scale:'css'`, **`maxDiffPixels:50`**（`visual.spec.mjs:22-25`）
- `snapshotPathTemplate` 刻意去掉平台后缀（config `:16`）：名字稳定可读，代价是跨机静默错配
- onboarding 一律 `Escape` + 600ms；`document.fonts.ready` 后才开拍；每屏 `goScreen` 后 500ms

🔴 **重冻纪律**（`playwright.config.mjs:7` 逐字）："更新基线只在**人审对照板通过后**：`--update-snapshots` 同 commit 提交"。战役实践：r3 重冻两次（棒3 主体一次、审查修复后一次），每次都**先目检 diff 再复验绿**；r7 计划里的"最后一次基线变更"因零迁移**按空执行收档**。

⚠️ **基线世界 = 空态/stub**：棒5/棒6 改的是满世界形态（决策卡边条、项目卡渐变条、头像），所以"36 张原样绿"是**构造性的**，不代表这些改动被覆盖（`receipt-r5-0722.md:22`、`receipt-r6-0722.md:31` 都如实标注）。**布局战役如果改的是空态骨架/栏宽/网格，基线就会真动 —— 这次不会白绿。**

---

## 7. 扫雷 `sweep-ui-defects.mjs` + `ui-sweep-triage.json`

```bash
# 正式扫雷（永远 exit 0，除非 harness 崩/自检失败/毕业类违规）
cd /d/avery && VERIFY_BASE=http://localhost:5173 node eval-harness/tools/sweep-ui-defects.mjs

# 自检硬门（对每类检测器注入已知故障，任何一类哑火即 exit 1）
cd /d/avery && VERIFY_BASE=http://localhost:5173 node eval-harness/tools/sweep-ui-defects.mjs --selftest

# 把某类毕业成硬门（该类任何非豁免发现件 → exit 1）
SWEEP_GATE_CLASSES=fixed-overlap,default-control VERIFY_BASE=http://localhost:5173 \
  node eval-harness/tools/sweep-ui-defects.mjs
```

- **矩阵**（`sweep-ui-defects.mjs:42-50`）：9 屏 × 2 皮 × (空世界 1440 + 满世界 1440/**872**/375)。872×900 = 贴 860 断点上沿，fixed 胶囊模式下横向最挤的世界。
- **8 类检测器** 在 `eval-harness/tools/lib/ui-detectors.mjs`：D1 fixed 遮压 / D2 默认控件 / D3 横向溢出 / D4 AA 对比度 / D5 隐形截字压埋 / D6 热区<24 · focus 无反馈 · 坏图。
- **定位**：发现工具不是拦截门（`:11-16`）。前置同门电池（mock 8137 + preview 5173）。
- **台账 `eval-harness/tools/ui-sweep-triage.json`（tracked）**——扁平 `{ fingerprint: record }`，实测格式：
  ```json
  "7b1302871846a88f": {
    "status": "fixed",              // open | fixed | wontfix | false-positive
    "cls": "small-target",
    "screen": "team",
    "look": "aurora",
    "viewport": "desktop",
    "selector": "input",
    "first_seen": "2026-07-21",
    "note": "feat-086 棒4 组件族治愈（.lite-btn 族/统一焦点环/热区垫底），2026-07-21 全矩阵 0 复现"
  }
  ```
  - **指纹 = `sha1(cls|screen|look|vp桶|归一化selector)` 前 16 位**；selector 已去 `nth`/动态位 → **数据变化不换指纹**。
  - NEW 自动以 `open` 记入；人工 triage 改状态；**`fixed` 复燃 → 打 `REGRESSION` 大声报**。
- **产物（gitignored）**：`eval-harness/reports/ui-sweep/<ts>.json` + `latest.md`（人读摘要）。
- 当前态：全矩阵 **0 件 / 0 指纹**，连续三轮（44 件 open 台账棒4 一次清零）。

---

## 8. 对照板 `capture-align-board.mjs`

```bash
cd /d/avery && VERIFY_BASE=http://localhost:5173 CR_BASE=http://localhost:3100 \
  node eval-harness/tools/capture-align-board.mjs
```

- **输出目录**：`eval-harness/reports/align-board/<YYYY-MM-DD>/`（`capture-align-board.mjs:23-25`，日期自动从 `new Date()` 取 → **同日重跑会覆盖**）。产物 = 成对 PNG + `index.html` 双栏板。现存：`eval-harness/reports/align-board/2026-07-21/index.html`。
- **配对表**（`:27-36`）：`home↔/` · `team↔/people` · `projects↔/projects` · **`room↔/nexus`** · `followups↔/checklist` · `playbooks↔/playbooks` · `closerlook↔/gaps` · `notes↔null` · `vision↔null`（单栏出现）。
  ⚠️ **与任务书给的对照表有一处出入**：任务书说 room 无参照，但工具把 room 配到了她的 `/nexus`（`:31`）。plan.md:56 的口径是「room↔无（通用语法）」—— 工具比计划多配了一条。侦察结论：`/nexus` 存在且被 extract-cr-spec 列在 ROUTES 里（`extract-cr-spec.mjs:21`），所以 room 实际上**是有参照的**，只是 plan 层面判定"只借通用语法"。
- 我方口径：`?v=2&mode=live&look=aurora&lang=zh&transport=stub` + `reducedMotion:'reduce'` + onboarding Escape（`:47-51`）——**只拍 aurora，stub 数据**。她方是酒店 demo 数据。
- **刻意不做自动像素 diff**（`:5-7`）：异栈异内容，diff 是纯噪音；板子是给人眼的。这是战役收官判据的第四环（r7:24「对照板人审待 Danny」）。

---

## 9. 给「布局与真部件」战役的工具链缺口（侦察结论）

1. **extract-cr-spec 的 PROBE 采不到任何几何/布局量**（`extract-cr-spec.mjs:46-76` 全是色/字/圆角/阴影）。要提布局规格必须先扩 PROBE：栏数/`gridTemplateColumns`/`gap`/内容栏 `width`/`rect` 几何。这是棒A 的第一件事，且**它不改 spec 表结构**（`prop` 字段直接吃 `gridTemplateColumns` 这类计算值）。
2. **`/companyinput` 不在 ROUTES**（`:21`），室/笔记/未来方向三屏无参照——spec 表的 `screen` 字段只能填我方屏名，无参照屏的行只能写"我方自定不变量"，不能写"她的值"。
3. **spec 表零布局行** → 新 stick 段（5+）从零开始；`verify-cr-alignment.mjs` **无需改一行代码**即可吃新段（`SPEC_STICK` 是纯数值比较）。
4. **`querySelector` 单元素限制**（`verify-cr-alignment.mjs:85`）：布局断言常需要"第 N 个卡片""子元素数量""两栏的宽度比"——现门只取单元素单属性。要做栏比/网格断言需要给门加一种新 row 类型（如 `probe: 'rect'` 或 `count`），这是本战役对门的**唯一必要改造**，建议棒A 一次做完并同 commit 誊 spec。
5. **电池名单无 tracked 载体**（见 §4e 警告）——建议本战役顺手落 `eval-harness/tools/run-battery.*`，把 A/B/C 三区顺序 + dist 终局重建固化成脚本，否则每次接手都要从收据散文里考古。