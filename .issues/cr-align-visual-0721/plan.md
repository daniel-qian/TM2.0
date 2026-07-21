# cr-align 视觉战役 · 总计划（2026-07-21 Danny 批准）

> Danny 原话拍板：「完全按照合伙人版本的组件UIUX、layout、风格为准」+ 修 UI bug（已知两处，
> 「应该还有我没发现的」要系统扫）+ 功能逻辑保持一致 + 先调研后分棒控爆炸面。
> ⚠️ Danny 亲口点名的坑：**cr-live 根目录 index.html 是过期代码（901 行英文老原型 teamMaster），
> 对齐基准 = dev server 真实路由（`npm run dev` 端口 3100，src/app/ 八条路由含隐藏 /companyinput）**。

## 四项拍板（AskUserQuestion 四连，2026-07-21）

1. **paper 皮保留，跟结构走**——骑新结构守自己配色字体；paper 门红先行重基线。
2. **分棒推进**——棒0/1 地基+bug+扫雷 harness；棒2+ 按屏，每棒独立上线。
3. **对齐先行，5B 体检卡顺延**——体检卡前端到时直接按新风格做。
4. **缺件不补建**——搜索框/用户 chip/KPI 条/问 Nexus 悬浮球无真功能不放；我们的铃/登录/设置按她质感重塑。

## 红线（全部核实过出处）

- 「不搬代码」边界（.issues/lite-live-v02-0713/decisions.md）：禁移植源码与假数据；**搬 CSS token
  数值 + 重建交互概念明文许可**（aurora 令牌 feat-046 本就取自她库）。
- `shared/styles/00-base.css` 一行不改（story/lite/lite2 共享 chrome，assertSkinNoLeak 盯着）——
  覆盖一律 `.lite2-shell` 前缀落 `src/lite2/styles/`；aurora 专属再加 `[data-look='aurora']`。
- AA 4.5:1 硬地板：她的 #98a2b3/#667085-on-soft/gold 徽章对 都不达标——偏差台账 D1-D4 给替换值。
- 文案零改（en.ts 唯一源）；tab 主名不动；「Nexus」「现实差距」锁词；她的「问 Nexus」≠我们的「快问」。
- 她声明 Inter 但从未加载——不引入字体依赖；--shadow-lg 是 Tailwind 默认值兜底（非她定义），不抄。

## 分棒（体量 x≈一个专注 session 含电池+docs）

| 棒 | 内容 | 体量 |
|---|---|---|
| 0 | 扫雷 harness（sweep 8 类检测器+selftest 硬门+台账）+ cr spec 三件套（提取→人筛→verify-cr-alignment 分期门）+ 双栏对照板 + 自家像素基线 36 张 | 1x |
| 1 | 两个已知 bug 最小修复（notes/vision 84px；followup 按钮进枚举族）+ verify-topbar-clearance 门红先行 | 0.5x |
| 2 | 壳结构：悬浮胶囊 nav slab（fixed top14 居中 min(1480,100vw-48)）+ 让位统一 --lite2-clear-top:96px（一变量九消费者）+ aurora ::before 模糊背幕 + 门字面量同 commit 换 4 个 | 1.5x |
| 3 | token 加深：H1 26/800、eyebrow 13/750、surface .97、rule-strong #8fa1b8、tone 渐变七条、AA 调停 | 1x |
| 4 | 组件族：.lite-btn 四变体（radius 9px aurora）/.lite-badge/.lite-card + 双类迁移（旧类留 DOM 门零迁移）+ CSS 入场动效 lite2-rise（D16：不逐屏套 framer） | 2x |
| 5 | 屏组一：指挥室+待办清单 | 1.5x |
| 6 | 屏组二：团队+议事室+项目 | 1.5x |
| 7 | 屏组三：笔记+未来方向+多看一眼+操作手册+动效扫尾（playbookTag 探针最后一次重基线） | 1x |
| 8 | （可选不阻塞）lite2.css 死规则清扫 | - |

## 每棒固定环

sweep 扫雷（棒首+棒尾）→ triage → 实现 → 全电池（含 SPEC_STICK=当前棒 的 cr-alignment）→
对照板 Danny 过目 → 门字面量从 spec 誊（spec→门→码）+ 旧构建红证明 → 像素基线人审后 --update-snapshots
→ docs+push（=自动上产）。

## 偏差台账 D1-D16（详见 ADR-0027；她值与我们刻意不同处）

D1 #98a2b3 永不作文本 · D2 gray 徽章字 #5b6577 · D3 gold 徽章字 #75591f · D4 小字饱和色走 *-text ·
D5 --shadow-lg 不抄（Tailwind 默认兜底） · D6 不加 Inter · D7 守 9 tab · D8 无真功能部件不建 ·
D9 无 toast 体系不建 · D10 锁词+我方法务 footer 文案 · D11 零源码零假数据 · D12 slab 遇阻退路=navy
活动 pill · D13 --radius 守 10px · D14 人面零数字零血条（高于她 PeopleRail 设计） · D15 内容栏宽守
760-1040（她 1480 只作外夹） · D16 入场动效 CSS 化（门 defuseAnimations 只关 CSS，JS spring headless 卡 rAF）。

## 九屏对照

home↔cr `/` · team↔`/people`（38/62 spine 守我方 IA）· projects↔`/projects` · room↔无（通用语法）·
followups↔`/checklist` · notes↔无（用 checklist 历史列表语法）· closerlook↔**`/gaps` 1:1** ·
playbooks↔`/playbooks` · vision↔无（通用语法）。
