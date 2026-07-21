# ADR-0027 · cr 视觉对齐战役：规格驱动 + 缺陷类扫雷 + 偏差台账

- 日期：2026-07-21
- 状态：已采纳（Danny 批准战役计划 + 四项拍板）
- 上游：ADR-0025（命名解锁/aurora 默认）、.issues/lite-live-v02-0713/decisions.md（不搬代码红线）、
  .issues/cr-align-visual-0721/plan.md（分棒全文）

## 背景

Danny 拍板 lite2 的 UIUX/layout/风格**完全对准**合伙人 cr-live 版本（Next.js 15 + Tailwind v4，
dev server :3100 为准——根 index.html 是过期英文原型，Danny 亲口点名的坑）。同时生产上肉眼可见
UI bug 两处（顶栏压标题、裸默认按钮），且「应该还有没发现的」。异栈（我们 Vite+纯 CSS）决定了
「搬代码」物理不成立，07-14 红线（搬 token 数值+重建交互概念=许可）与「完全对准」天然兼容。

## 决策

### 1. 对齐 = 规格驱动，不是像素克隆

- `extract-cr-spec.mjs` 对 cr-live dev server **真路由**逐屏取计算值 → 草案（gitignored）。
- 人工筛选进 tracked 的 **`eval-harness/specs/cr-align-spec.json`**：对齐只被选中的行约束；
  paper 皮永不入表；AA 偏差直接内化进表值。
- `verify-cr-alignment.mjs` 逐行断言我方 aurora。**规格是终态、战役分棒交付**：行带 `stick`
  字段（0 现状护栏/2 壳/3 token/4 组件族），电池带 `SPEC_STICK=当前棒` 只硬断已交付面，
  未来行照报不计红（战役进度表）；收官=全表全绿。
- 门字面量方向固定：**spec → 门 → 码**。assertAuroraApplied 的字面量今后从本表誊出，
  不从构建反抄（反抄=门给实现盖章，两世界失效）。

### 2. UI 缺陷按「类」扫，不按「个」修

- `sweep-ui-defects.mjs` + `lib/ui-detectors.mjs`：8 类检测器（fixed 遮压/默认控件/横向溢出/
  AA 对比度/隐形截字压埋/热区<24/focus 无反馈/坏图），矩阵 9 屏×2 皮×(空 1440+满 1440/872/375)。
  872 贴 860 断点上沿=fixed 胶囊最挤世界。
- **selftest 是硬门**：对每类注入已知故障，任何检测器哑火即 exit 1——发现工具自己的两世界纪律。
  正式扫雷只发现不拦截（exit 0），发现件进 tracked 台账 `ui-sweep-triage.json`
  （open/fixed/wontfix/false-positive，fixed 复燃=REGRESSION 大声报）。
- 毕业机制：某类连续多轮全矩阵零 open → `SWEEP_GATE_CLASSES=` 点名转硬门进电池。
- 首轮实证（2026-07-21）：140 件/78 指纹。两处已知 bug 全被机械逮住（fixed-overlap×16 +
  default-control×6，与人眼报告交叉验证）；另扫出真缺陷 small-target×28 + focus-missing×16
  （恰=棒4 组件族领地）；检测器自身误报 12 件（option 恒 0 尺寸/滚动可达误判截断）当轮修正出清。

### 3. 让位不变量入门，病根修法分两拍

Bug A 根因是**模式缺陷**：顶栏 fixed 悬浮无全局让位，九屏各自留 84px，notes/vision 是漏网的
28px 老模式。棒1 最小修（对齐 84px 惯例，append-only）；棒2 统一成 `--lite2-clear-top:96px`
一变量九消费者。`verify-topbar-clearance.mjs`（九屏首标题 ≥ 顶栏带底+8px，两皮）永久看守
「新屏忘让位」世界——门管类，修复管例。

### 4. 偏差台账 D1-D16：与她刻意不同处全部记名

AA 实测（WCAG relative luminance）：她 #98a2b3 白底 2.58:1、gold 徽章对 4.28:1、gray 徽章对
4.46:1、裸 tone 色小字 2.77-4.49:1——**全不达标**。D1-D4：小字色一律走我方 `*-text` 补偿
token/加深值（gray→#5b6577、gold→#75591f）。其余：D5 --shadow-lg 不抄（提取实证它是 Tailwind
默认主题兜底值，非她定义）；D6 不加 Inter（她声明未加载）；D7 九 tab；D8 无真功能部件不建；
D9 无 toast；D10 锁词+我方法务文案；D11 零源码零假数据；D12 slab 退路；D13 --radius 守 10px；
D14 人面零数字零血条（我方红线高于她 PeopleRail 设计）；D15 内容栏宽守 760-1040；
D16 入场动效 CSS 化（门 defuseAnimations 只关 CSS 过渡，JS spring 在 headless 卡 rAF）。

### 5. 像素基线：对自己、单机、不入库

`eval-harness/visual/`（playwright 自带 runner 零新依赖）：9 屏×2 皮×2 视口=36 张，stub 数据+
reducedMotion+deviceScaleFactor 1，生成即复验绿。基线是单机字体渲染产物（11MB+），按
review-shots 先例 **gitignored 本地留存**，换机 `--update-snapshots` 重采；更新只在人审对照板
通过后同 commit。它防的是多棒换肤期间「改 A 屏震 B 屏」的无声漂移——计算值门只盯点名探针，
截图盯其余一切。

## 后果

- lite2.css 继续 append-only 增长（棒1 +43 行），棒8 可选清扫；每棒 banner 注释。
- cr-live dev server 成为提取/对照板的运行依赖（仅本机工具链，产品零依赖）。
- 台账里 44 件 open（small-target 28 + focus-missing 16）显式排到棒4 组件族，不散修。
- `assertAuroraApplied`/`PAPER_BASELINE` 的重基线集中在棒3/棒7 红先行；`assertSkinNoLeak`
  一字不动（=00-base 未动的持续证明）。
