# cr-align 视觉战役 棒3 收据 · 2026-07-21

**一句话**：token 加深落地——字阶（h1 26px/800 拍平、eyebrow 13px/750、副题 14px）+
卡面 .97 + 强分隔线实色 + 七条语气渐变 token + AA 台账 D2/D3 调停；
**规格进度 15/22 → 19/22 绿**（SPEC_STICK=3 硬断言 18/18）；本棒零 snippet 字面量迁移。

## 改动面（纯 CSS + spec 一行，零 TSX）

| 处 | 内容 |
|---|---|
| look-aurora.css 在位改值（4 处，全在 aurora 根块内） | `--rule-strong` rgba(16,34,61,.24)→**#8fa1b8**（她的实值，非文本装饰线）；`--lite2-surface` .86→**.97**（她卡底实值）；AA D2 `--lite2-tone-gray-fg` #667085→**#5b6577**（4.46→5.3:1）；AA D3 `--lite2-tone-gold-fg` #8a6a29→**#75591f**（4.28→5.6:1）——D2/D3 两 token 仅 aurora 声明，paper 构造性零动 |
| look-aurora.css 棒3 追加段 | `--lite2-surface-soft #eef3fa`（⑫ tab hover 同步改为消费它）+ 七条 `--lite2-grad-*` 135deg 渐变（誊值 cr-live src/lib/data.ts l.11-17，消费面留棒4/6）+ 分支⑭ 字阶：`.scene-stage h1` 26px/800（撤 clamp 视口依赖；七处 h1 均页面级、无弹层 h1；与分支⑨ 700 同特异性靠后写胜出）、`.home-greeting-sub` 14px/--ink-faint、`.eyebrow` 13px/750/0.02em（🔴 前缀不可拆——00-base.css:85 与 story 共享） |
| cr-align-spec.json | token.surface 期望串 0.97→**.97**——构建压缩去前导 0（实测 rgba(255, 255, 255, .97)），contains 断言吃不上；语义不变，note 记档 |

## 红→绿全记录

- **旧构建红证明**（棒2 构建 = stick-3 的旧世界，改码前实拍）：SPEC_STICK=3 四行红——
  h1weight 实测 **500**、surface 实测 **.86**、eyebrow 实测 **11px/700**；type.h1 尺寸 27px
  靠 ±1px 容差擦边绿（clamp 在 1440 视口顶到 27），本棒仍按规格拍平 26。
- 棒3 构建后：SPEC_STICK=3 **硬断言 18/18 绿**，exit 0；全量进度 19/22
  （剩 3 行全是棒4 组件行：followup 按钮 radius/font + decisionBg .97）。
- **零门字面量迁移的设计验证**：E 组 13 项 aurora 断言无一探本棒改动值（棒前逐项核对
  snippet l.2455-2472），skin-phases 门 **16/16 绿**直接穿越——「探针全由 token 供给、
  基线变更集中管理」的架构回报。
- paper 零动双证：skin-phases 逐字节绿 + **像素基线 paper 两套（18 张）原样通过**（未重定）。
- 像素基线：aurora 两套如预期 diff（字阶/卡面有意变更）→ 目检 home desktop/mobile 实拍
  确认形状（26px/800 重标题、13px eyebrow、.97 实卡面；mobile 26px 拍平舒适）→
  `--update-snapshots` 重定 → 复验 4/4 绿。
- 断言字符串坑（新知识）：构建压缩会把 custom property 里的 `0.97` 压成 `.97`——
  spec 期望串要写压缩后的形。

## 回归电池（22 门，SPEC_STICK 升 3）

21 绿 + visual-baseline 电池中段一次红（dist 被 auth 门中途调包的既知模式，**第四次实证**，
纪律条款继续有效）——终局 dev 重建后 visual 4/4（36 张）+ clearance + cr-alignment(s3) +
skin-phases 全部复验 exit 0 = 实质 22/22。contrast-smalltext 在 D2/D3 加深后照常绿。

## 对抗审查（四视角工作流，红线/级联/AA/波及面）

初版 diff 过四个独立怀疑者，逮出 **1 blocker + 2 should-fix**，全部即棒修复：

- 🔴 **blocker（AA）**：副题降色 --ink-soft→--ink-faint(#667085) 的前提「垫 .97 卡面」不成立——
  greeting 直接压壳渐变裸底，紫斑区（circle at 8% -2%，恰是 greeting 所在左上角）合成底
  ≈#d6c9ff 实算 **3.24:1**，14px 正文击穿 4.5 硬地板（原值同位 >10:1）。
  **修**：副题只动字号不动色（D17）——层级退让由 26px vs 14px 承担。
- **should-fix（级联）**：`.eyebrow` 一揽子 13px/750 误伤团队屏分组小注
  `.home-people-group-caption`（lite2.css:629 刻意 11px），被抬得比头顶 14px/700 分组标题
  还重=层级反转。**修**：同特异性后写恢复原度量（11px/700/0.04em）。
- **should-fix（AA）**：eyebrow 存量色 #667085 在同一渐变裸底 3.2–4.2:1（非本棒引入，
  但本棒接管了 eyebrow 字阶，顺手修成本最低）。**修**：aurora eyebrow 色 #4d5568（D18，
  实算紫斑最差处 4.85:1 / #eee9ff 5.8:1 / 白底 7.5:1 全位达标）。
- 波及面视角判 **clean**：--rule-strong 63 个 aurora 可达消费点全是发丝线/焦点环/小点，
  零文字零深底；`color: var(--lite2-surface)`（demo 按钮白字）13→15:1 纯改善；
  gold-fg 零消费点惰性落地待棒4；surface .97 不杀任何毛玻璃场景（玻璃走独立 --lite2-glass）。
- 记档级 note：38 处 `rgba(var(--lite2-surface-rgb), X)` 字面 alpha 未随 token 走（0.55-0.96
  混合族，归棒5-7 逐屏对齐时按屏处置）；750/800 依赖可变字重、两库同样不装 Inter 实渲同落
  Segoe UI（与她的真实渲染对等，D6 口径）；`.lite-draft-field > .eyebrow`（lite2.css:4325）
  与 eyebrow 条同特异性靠后写、今天只声明 margin，将来加字型属性会静默反杀（watch）。

修复后四门复验全绿（alignment s3 / skin-phases / contrast / clearance）+ 像素基线重冻复验 4/4。

## 扫雷（棒尾全矩阵）

审查修复前后各跑一轮全矩阵（2 皮×4 世界态×9 屏）：两轮均 **NEW 0 / REGRESSION 0**，
44 件 known-open 原样归棒4（small-target×28 + focus-missing×16）。
棒首基线=棒2 尾那轮（同一构建同一台账，免重跑记档）。

## 目检 + 对照板

- 目检：home desktop（26/800 重标题、13px eyebrow、.97 实卡面）、home mobile（26px 拍平
  在 375 宽下舒适）、team desktop（紫斑区 eyebrow 深灰清晰、副题回深墨、审查修复实拍成立）。
- 对照板重拍：eval-harness/reports/align-board/2026-07-21/index.html（我方棒3 构建 vs 她方
  逐屏成对、2 视口）——Danny 回来过目用，不阻塞推进。

## 刻意不做 / 留后

- 渐变 token 本棒只立不消费（头像方块/图标 chip 归棒4/6 组件族——拍板④缺件不补建，
  等真组件长出来再吃）。
- 副题从 --ink-soft 降到 --ink-faint 是她的层级语法（页题重、副题退）；14px 处 AA 实算
  见台账（--ink-faint #667085 白底 ≈4.9:1 达标）。
- 页脚/铃齿轮 glass-on-glass 等棒2 留后项原样归棒4/7。

## 验收方式（本棒不推不部署）

**Danny 指示：AFK 期间一路干到底、先不 push/部署，回来在 dev server 上验收。**
本棒改动全部停在本地 commit；验收入口 http://localhost:5173/?v=2&mode=live&lang=zh
（vite preview 挂 dev 构建 + mock 后端 8137，收工时保持运行）。
推送=Vercel 自动上产，等 Danny 验收后一句话即可。
