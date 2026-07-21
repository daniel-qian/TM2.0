# ADR-0025 · Command Room 对齐：命名部分解锁 + aurora 转默认 + 评分承诺开关化

日期：2026-07-21 · 状态：已采纳（Danny 拍板，grill 记录见 .issues/cr-align-0721/decisions.md）
上游输入：合伙人 0721 反馈（codex 零数据实测 averylite + 「demo 是文件解析器 vs 本地
command-room 是管理指挥室」的定位诊断）。

## 决策 1 · 对 ADR-0015 决策 4 与 0718 锁定词表的**部分**推翻

ADR-0015 决策 4 立的 tab 命名 canon（产品是人不是地方、被点名者看到不刺痛）与
`.issues/v02-partner-align-0718/decisions.md` §六 的锁定词表（Nexus/现实差距/指挥室 永不上屏）
在本次做如下修订：

- **「指挥室」解锁**：home tab 主名改「指挥室 / Command room」。理由：合伙人反馈点名
  「管理产品的决策感弱」，Danny 认同首屏要以"今天要干什么/发现了什么/有什么决策"为主；
  「指挥室」一个词买到八成决策感，且它形容的是**房间**不是**人**，不触发刺痛测试。
- **`Nexus`、「现实差距」维持锁定**：前者是内部代号腔，后者对被点名的下属刺痛——
  ADR-0015 的两条理由在这两个词上仍然成立。
- **主+副小字机制**（Danny 2C）：换主名的 tab 保留原名为副小字（.scene-tab-sub，10px
  --ink-faint，aria-hidden——读屏只念主名）。改名不是抹掉旧词，是把决策感和人味叠着放。
  本次共两处：指挥室/今天、待办清单/跟进。其余 7 tab 原名原样。
- 门同步：assertV2Boots 期望数组改读 .scene-tab-main + 副名独立断言；verify-p0 锁定词表
  剔除「指挥室」；verify-switchers 全量改写。**未来改任何 tab 主名，同 commit 三处联动。**

## 决策 2 · aurora 转默认 look，切换器收进设置菜单

- `resolveLook()` 缺省 paper → **aurora**（URL > localStorage > 默认 的链条不变；显式
  `?look=paper` 的所有门与深链不受影响）。理由：command-room 样板与 aurora 同血缘
  （feat-046 已逐值对齐它的 globals.css），对齐 = aurora 做浓做默认；paper 保留可切，
  双皮资产不退役（7B：结构改动两皮共享、视觉 token 只动 aurora）。
- 语言/观感切换器从顶栏常驻收进 ⚙ 设置菜单（.lite-settings，次级弹层）——demo 试玩器
  不该在一级栏里（Danny：更符合常理 UIUX）。菜单内 .lang-switch/.look-switch 结构类名
  原样保留，门只多一步「先开齿轮」。

## 决策 3 · 评分承诺文案开关化（1A，撤销绝对承诺）

生产文案中「人永远不会被打分…任何指令都不能把这条关掉」等绝对句（≥6 处）全部改为
**开关条件表述**：评分是否允许是公司握着的系统开关（`AVERY_ALLOW_PERSON_SCORING`，
scoring_policy.py：默认关、fail-closed、prompt 碰不到）；关=入口拒收，开=带证据放行，
且任何输出都不是人事决定的唯一依据。理由：开关已存在且生产已开（feat-033 政策转向），
绝对承诺文案在撒谎——「界面替文档说话」是本仓最痛恨的缺陷类，承诺文案替产品说谎同罪。
「确定性检查」的说法**保留**——检测器与 enforcement 缝真实存在，变的只是它执行的立场。

## 后果

- 下一棒（输入侧三件套）与合伙人对外话术需与新承诺口径对齐——她此前把「不打分不排名」
  当卖点讲，Danny 需要同步她（本 ADR 不替他做这件事，只留此提醒）。
- 四层工程加固（评分开关的 UI/审计面）仍未做，是承诺口径的另一半账，未排期。
