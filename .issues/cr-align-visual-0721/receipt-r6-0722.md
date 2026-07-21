# cr-align 视觉战役 棒6 收据 · 2026-07-22

**一句话**：屏组二（项目+团队）——项目卡她的 **6px 顶部渐变条**（--lite2-grad-* 七条渐变的
第一个消费面，四态四色含 unknown=灰）+ 首字母头像升她的**浓渐变方块白字**。
零 TSX、全 aurora 作用域。

## 改动面（look-aurora ⑳㉑，纯 CSS append）

| 处 | 内容 |
|---|---|
| ⑳ 项目卡 | 左缘染色语法在 aurora 退役（border-left 收回 1px 均匀框），换她的 ::before 6px 顶部渐变条；四态判别子全部既有零 TSX：默认(on-track/done)=grad-blue、edge-at-risk=grad-orange、edge-blocked=grad-red、is-status-unknown=**grad-gray** |
| ㉑ 首字母头像 | .initial-avatar 淡渐变+墨字 → 浓渐变方块（r10 走既有 --radius）+白字 800；语气联动走人卡既有 home-tone-* 族（默认 blue/honey→orange/terracotta→red/unknown→gray）；initials 是 aria-hidden 装饰件（人名在旁），不吃 AA 文本地板（与她同口径） |

## 红线调停（本棒最重要的一笔）

lite2.css l.4594 的在位红线「on-track/unknown 一律不染色——避免『文档没写』读成『一切正常』」
与她的全卡染色语法相撞。裁决：**四色显式区分是同一本意的更强实现**——今天 normal 与
unknown 都不染色反而形近（恰是该红线要防的混淆）；蓝(正常)≠灰(未知) 的显式对立让
「文档没写」永远读不成「一切正常」。战役计划屏表（Danny 批案）「tone-unknown 灰必须活」
即此口径；**status-truth 门（27 判据仲裁者）绿灯放行**；原注释就地补记新口径，paper 继续
走旧左缘语法。人面红线不受染：渐变头像=身份色语气非计量，人卡仍零数字零血条。

## 验证

- 重面七门：status-truth / home-skeleton / room-usability / room-nomaterial / aria-zh /
  skin-phases / button-family 全绿（paper 逐字节零动穿越）。
- 满世界目检（eval-harness/reports/r6-shots/）：四项目四状态种子（正常/有风险/受阻/缺状态）
  一次验四色条——橙/红/蓝/灰全中，诚实分组（需要你出手/在推进/文件里没写状态）与
  「文件里没写的部分」头卡原样；**demo 示例团队真人卡**：林/郑两枚浓蓝渐变方块白字
  （真中文首字——07-15 全 ASCII 盲点修复的红利实拍）。
- **电池 23/23 全绿零红（连续第三轮）**；终局重建后净室扫雷 **0 件/0 指纹**；像素基线 36 张原样绿（基线世界=空态/stub，渐变条/头像是满世界形态）；对照板重拍。

## 刻意不做 / 留后

- 团队屏的 .home-project-card 地图小卡守左缘语法（尺度小、6px 条会挤；她的渐变条语法
  只上主项目屏）。
- Room 议事室玻璃已有基础（branch ① composer/chip 玻璃），本棒零动。
- 头像语气渐变的「人脸红色」争议（terracotta 人=红渐变头像）按计划口径执行；若 Danny
  验收时觉得刺眼，退法=头像一律默认 blue（删 ㉑ 三行变体即可，一处改）。

## 验收方式（本棒不推不部署）

同前：本地 commit，dev server 验收 http://localhost:5173/?lang=zh。
