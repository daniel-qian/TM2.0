# cr-align 视觉战役 棒0+棒1 收据 · 2026-07-21

**一句话**：扫雷与验证 harness 全套落地（8 类检测器 selftest 硬门 + cr 规格分期门 + 双栏对照板 +
36 张像素基线）+ 两个生产 UI bug 修复上线（顶栏压标题 / 裸默认按钮），全部红先行。

## 棒1 · 两个 bug（红→绿全记录）

| Bug | 根因 | 修法 | 证据 |
|---|---|---|---|
| A 顶栏压标题（notes/vision） | 顶栏 fixed 无全局让位，九屏各自留 84px；两屏是 28px 老模式漏网 | append-only 对齐 84px 惯例（+窄屏 72px 镜像；棒2 归一 96px var） | 新门 verify-topbar-clearance 修前 5 红（两皮 notes/vision + elementFromPoint 实测被顶栏接住）→ 修后 22/0 |
| B 加到待办裸按钮 | 按钮基样式是枚举三选择器列表（lite2.css l.3809），followup 没进列表，只有 :disabled 命中 | append-only 补同族样式（hover/focus-visible 同步） | 门断言 radius 999px 修前红（实测 0px + ButtonFace 底）→ 修后绿；l.5060 误导注释同步纠正 |

## 棒0 · harness 四件套

1. **扫雷** `sweep-ui-defects.mjs` + `lib/ui-detectors.mjs`：9 屏×2 皮×(空 1440+满 1440/872/375)，
   8 类检测器。`--selftest` 8/8（注错全响，硬门）。**首轮 140 件/78 指纹**：已知两 bug 全被机械
   逮住（fixed-overlap×16 + default-control×6，与 Danny 肉眼报告交叉验证）；新扫出 small-target×28
   + focus-missing×16（=棒4 组件族领地，台账挂 open 不散修）；检测器自身误报 12 件当轮修正出清
   （option 恒 0 尺寸、滚动/平移可达误判截断）。台账 `ui-sweep-triage.json`（tracked）。
2. **cr 规格三件套**：`extract-cr-spec.mjs`（cr-live :3100 真路由取计算值，60 vars+按钮/徽章采样；
   绝不读过期 index.html，每路由断言 200+React 挂载）→ 人筛 22 行进 `specs/cr-align-spec.json`
   （stick 分期 0/2/3/4）→ `verify-cr-alignment.mjs`。**两世界证据**：全量对棒1 构建 8/22 红
   （14 行红=战役差距表：topbar 18≠14、无玻璃、84≠96、h1 500≠800、eyebrow 11≠13、按钮 999≠9px…）；
   电池模式 SPEC_STICK=1 → 5/5 绿。提取顺带纠偏：她的 --shadow-lg 有值（Tailwind 默认兜底），
   D5 措辞已软化。
3. **双栏对照板** `capture-align-board.mjs`：9 屏×2 视口两 app 成对 PNG + index.html
   （reports/align-board/2026-07-21/，gitignored——给 Danny 过目用，不做自动像素 diff）。
4. **像素基线** `eval-harness/visual/`（playwright 自带 runner 零新依赖）：36 张（9 屏×2 皮×2 视口），
   stub 数据+reducedMotion+dsf1，生成即复验绿。**基线单机不入库**（11.3MB，review-shots 先例；
   换机 --update-snapshots 重采）；从棒2 起护航「改 A 屏震 B 屏」漂移。

## 回归电池（21 道，pwsh 批处理）

room-nomaterial / home-skeleton / switchers / contrast-smalltext / aria-zh / room-usability /
handoffs-empty / status-truth / file-manifest / onboarding-returning / onboard-gate /
auth-capability / auth-form / **topbar-clearance(新)** / **cr-alignment SPEC_STICK=1(新)** /
**sweep-selftest(新)** / bundle-privacy / zh-purity / data-boundary / p0 → **全绿**。
visual-baseline 电池中段一次红=dist 被 auth 门中途重建的指向陷阱重演（历史坑第二次实证）——
**终局 dev 重建后复验 4/4（36 张）绿 + 让位门 22/0 绿**。纪律再确认：dist 重建门收队尾+终局重建复验。
批处理坑（已记 handoff）：`powershell`(5.1) 读 UTF-8 无 BOM .ps1 中文即 ParserError——pwsh + utf8BOM。

## 生产验证

（待填：push 后 averylite 真机）

## 记档

ADR-0027（规格驱动+缺陷类扫雷+偏差台账 D1-D16）；战役总计划 `.issues/cr-align-visual-0721/plan.md`
（Danny 四拍板：paper 跟结构走 / 分棒 / 对齐先行 5B 顺延 / 缺件不补建）。
