# cr-align 视觉战役 棒4 收据 · 2026-07-21

**一句话**：共享组件族落地——.lite-btn 四变体（69 处双类迁移）+ .lite-badge 度量归一（9 处）+
.lite-card（决策卡上族）+ lite2-rise CSS 入场动效 + 统一焦点环/热区垫底；
**规格表全量 22/22 绿（战役对齐指标收满）**；**sweep 44 件 open 台账一棒清零**（0 件/0 指纹）。

## 改动面

| 处 | 内容 |
|---|---|
| lite2.css 棒4 段 | .lite-btn 基类（inline-flex/min-height 26/pill 999px/13px/600 + :disabled + :focus-visible sky 环）+ 四变体（primary=ink 实底 hover ink-hover / ghost=白底 rule 描边 / soft=violet .12 底+violet-deep 字 / danger=danger .12 底+danger-deep 字——全部只吃两皮都声明的 RGB 三元组）+ .lite-badge 基度量（11.5px/700/2px 10px pill，零色，PAPER_BASELINE 色探针不染）+ .lite-card base/hover（surface/rule/radius/shadow-soft 全 token）+ 小热区治理（block-link/cites-toggle/entry-source/reopen-onboarding min-height 24 + 文本类 input min-height 26）+ 白名单族焦点环（project-card 的 outline:none 后写反杀/subtab/group-head/input）+ @keyframes lite2-rise + **独立** reduced-motion 块（新家族全停 + 补 project-card/gate-door 存量上浮卡的 transform 漏兜——作战地图 4C） |
| look-aurora ⑮⑯ | .lite-btn r9px（她的 rounded-[9px]；paper 守 pill）；决策卡/待办行 lite2-rise 0.35s 阶梯入场（stagger .06s 封顶第 8 个，她的 framer 签名的 CSS 翻译，D16） |
| TSX 双类迁移（17 文件 69 处，只加类名） | 45 个普通按钮挂变体（primary×15/ghost×24/soft×5/danger×1 量级）；7 族徽章 span 挂 .lite-badge（handoff-tone/gap-pane-label/gap-history-badge/playbooks-slot-tag/vision-tag/ask-status-chip/followup-source）；决策卡 li 挂 .lite-card；4 处无类名按钮补齐（Team restore×2/Room composer 提交/Projects restore）；LiteComposer 三个匿名按钮补白名单类（lite-composer-remove/-filter/-option） |
| verify-button-family.mjs（新门，进电池） | 结构不变量：.lite2-shell 下每个可见 button 挂 .lite-btn 或命中显式白名单（38 项，作战地图逐个定性）；闸门页+九屏+铃/设置弹层全审；防作弊断言族挂载 ≥15 |
| verify-topbar-clearance.mjs | Bug B 微断言字面量同 commit 从 999px 止血形毕业成族形（family+r9px+13px，誊自 spec stick-4） |

## 红→绿全记录

- **旧构建红证明**（棒3 构建，改码前实拍）：button-family **11 FAIL**（族挂载 0，逐屏裸按钮
  清单与作战地图完全吻合）；SPEC_STICK=4 三行红（followupRadius 999px/followupFont 11.5px/
  decisionBg 0.55）；clearance 新微断言红（family=false radius=999px fontSize=11.5px）。
- 棒4 构建后：button-family **12/12 绿**；**规格全量 22/22 绿·未来行 0 红**（战役进度表
  8/22→15/22→19/22→**22/22** 收满）；clearance 22/22（微断言 family=true r9px 13px）；
  skin-phases 16/16（paper 逐字节零动——按钮变体全走 token，两皮各吃各的值）；contrast 绿
  （四变体字色实算 5.5-15:1）。
- **战斗插曲（新知识，已进坑档）**：首次构建后 .lite-btn 基规则「明明在产物里却不生效」——
  棒4 banner 注释里写了「tone-*/surface-soft」，`*/` 字面**提前终结注释**，残尾垃圾 token
  让浏览器错误恢复吞掉紧随其后的整条基规则（字号断言莫名不中，背景/圆角却都中——因为变体和
  aurora 分支规则完好）。CSS 注释里永远别写「星号斜杠」字面。用 CSSOM 探针
  （styleSheets 遍历 vs 文本 fetch 对照）钉死根因。

## 扫雷（44 件台账清零）

全矩阵（2 皮×4 世界态×9 屏）：**0 件 / 0 指纹 · NEW 0 · KNOWN-OPEN 0 · REGRESSION 0**。
44 件 open（small-target×28 + focus-missing×16）全部不再复现——台账批量 open→fixed 记档
（feat-086），复燃将自动标 REGRESSION。治法映射：按钮族 focus-missing→.lite-btn 统一焦点环；
白名单族（project-card/subtab/group-head）→专项 :focus-visible（project-card 的 outline:none
被后写反杀）；小热区 4 族→min-height 24 垫底；team/room 原生 input→min-height 26 + 焦点环。

## 对抗审查（四视角工作流）——本棒最大的收获

初版 diff 过四个独立怀疑者，逮出 **3 blocker + 6 should-fix 级**，全部即棒修复：

- 🔴 **「后位同权重接管」前提在交互态塌了**（tsx+cascade 两视角交叉钉死）：老散规则的
  :hover/:focus-visible 挂在 (0,3,0)/(0,4,0)，各自只被变体同名属性反压，**未同名属性各胜
  出后拼成坏组合**——五处按钮 hover 成墨字压墨底（gap-resolve/gap-ask/canvas-reset/
  draft-done/followup-save ≈1.2:1 不可见）、两处焦点环被老 outline:none 灭掉（auth-submit/
  draft-copy）、两处 primary 键盘焦点变浅底洗白字（projects/room 空态 CTA）、soft 族 hover
  紫字翻墨+冒灰边、onboard 上传钮 busy:hover 墨压墨。
  **修**：「族强断言层」——.lite-btn 双写把四变体 base/hover/focus/disabled 全态**全属性**
  收权到 (0,4,0)+ 靠后写，一层胜过全部老交互规则。修后真机探针四态取证全绿
  （primary hover=墨蓝底白字 / ghost hover=白底墨字 / soft hover=紫底紫字 / focus=环在）。
- 🔴 **reduce 用户在 aurora 下动画照跑**：lite2.css 的 reduce 兜底块 (0,2,0) 压不住 ⑯ 的
  (0,3,0)+（媒体查询不加特异性），且 .lite-followup-item 根本没进兜底名单。
  **修**：⑯ 整段包进 `@media (prefers-reduced-motion: no-preference)`（媒体级隔离，
  特异性大战无从发生）+ 兜底名单补漏。
- 🔴 **「已加入待办」锁存态 disabled 叠 .55 透明度只剩 1.6-1.8:1**：四个 soft 按钮点击后
  永久 disabled 且文案（已加入 ✓）必须可读——WCAG 的 disabled 豁免不覆盖当持久状态用的
  文本；老 accent 字色规则 (0,3,0) 还在压变体字色。**修**：soft:disabled opacity 收回 1 +
  断言层收权字色（violet-deep 6.6-7.1:1），状态由文案表达。
- **paper 三个透明徽章幽灵缩进**：handoff-tone/followup-source/gap-pane-label 在 paper 无
  底色，共享 .lite-badge 的 10px padding=文字凭空右移。**修**：共享层只归一字阶
  （11.5px/700），pill 几何挪到 look-aurora ⑰（aurora 才有软底徽章语言）。
- **danger paper hover 4.35:1 破 AA**：hover 加深 .18 反把对比压穿。**修**：hover 只到 .15
  （实算 4.56）；两处 CSS 注释的对比度数字虚高同步修正（soft paper 实算 6.6、danger 4.69）。
- **ask-q-remove 内容盒压零**：26px 定宽圆钮吃基类 padding 4px 12px 后 border-box 内容 0 宽。
  **修**：圆钮 padding 归零。
- note 记档：ghost 四处 hover 底被老规则反向变色（断言层顺手统一）；paper 决策卡 bg .55→.86
  +新得软影=**拍板①「跟结构走」的有意随行**（token/色值仍零动，PAPER_BASELINE 绿）；
  同视图多 primary（CloserLook 每卡一个 resolve）归棒5-7 屏级设计；auth 的 email/password
  输入框不在热区围栏内（弹层内高度本就够，行为不一致记观察）；LiteComposer 三个白名单类
  无 CSS 背书（占位给门，故意）；var(--radius)/var(--fast) 是 :root（00-base）供给的
  paper 暗依赖（记档）。

## 回归电池（23 门，含新门 button-family + s4；电池序修正）

**电池序病根治**：auth 两门本身就是 dist 调包者却排在 12-13 位——其后所有吃 preview 的门
都在 auth 构建上跑（visual 必红的真相；button-family 的防作弊阈值也因 auth 构建连不上
mock 后端种不出满世界而红）。**auth 门移入殿后 dist-rebuilder 区**后，吃 preview 的门
全部在健康 dev dist 上跑。（第三轮电池曾与审查工作流并发撞 CPU 出 6 假红——电池必须独占跑，
记档。）

**终局电池（修复后构建，独占跑）：23/23 全绿零红**——本战役（也是本项目）第一次
visual-baseline 在电池内直接绿（序修正的即时回报：dist 调包者殿后，中段打红的老戏码
从机制上根除）。终局 dev 重建后 visual 4/4 复验绿 + **净室扫雷 0 件/0 指纹** 定档。

## 目检 + 对照板

- 目检：home（demo/选择文件转 navy primary 9px）、followups（白 pill 活动子 tab + navy
  「加到跟进」）、closerlook 空态；探针四态取证（见上）。
- 对照板重拍：eval-harness/reports/align-board/2026-07-21/index.html（棒4 终构建 vs 她方）。

## 刻意不做 / 留后

- .lite-card 本棒只上决策卡（spec 行）——其余卡族（project-card 已有自己的上浮语法）归
  棒5-7 逐屏对齐时按屏收编。
- lite2-rise 应用面本棒只铺决策卡+待办行——逐屏铺开归棒7 动效扫尾。
- 旧散按钮规则（l.3809 枚举等）被后位接管但未删——死规则清扫归可选棒8。
- 页脚/铃齿轮 glass-on-glass 老留后项原样。

## 验收方式（本棒不推不部署）

同棒3：改动停在本地 commit，dev server 验收 http://localhost:5173/?v=2&mode=live&lang=zh（收工保持运行）。
