# cr-align 视觉战役 棒5 收据 · 2026-07-22

**一句话**：屏组一（指挥室+待办清单）她的屏级配方誊抄——决策卡 4px tone 左边条 +
规则清单挂载入场；待办清单整列一张卡 + divide-y 行 + hover 半染 + 20px 复选。
**零 TSX、全 aurora 作用域**（规格表在棒4 已 22/22 收满，本棒是配方层）。

## 改动面（look-aurora ⑱⑲，纯 CSS append）

| 处 | 内容 |
|---|---|
| ⑱ 决策卡 | aurora 藏 paper 的内嵌竖条（::before top/bottom 10px 悬浮条=paper 手写温度），换她的 border-left 4px tone 硬边语法（ink-faint 默认 + terracotta/honey/sage 变体）；「凭什么这么判 ▾」展开的 .lite-home-rule-list 挂载 lite2-rise .25s（包 no-preference） |
| ⑲ 待办清单 | .lite-followups-list 整列成卡（surface/rule/radius/软影 全 token）+ gap 0；行降级 divide-y（border-bottom last:none、透明底、padding 12px 2px）；hover rgba(238,243,250,.5)=她的半强度 surface-soft；复选框 22px/1.5px→20px/2px；history 列表共享类同吃 |

## 验证

- 红线门：home-skeleton / status-truth 保持绿（骨架零数字、双类保护成立）。
- 快门组：skin-phases 16/16、button-family 12/12、cr-alignment(s4) 22/22 全穿越。
- 满世界目检（eval-harness/reports/r5-shots/）：三档决策卡 4px 红/蓝边条 + 规则展开态；
  待办三行经**真实表单链路**添加（fill+submit，顺带验了加到跟进闭环），行 hover 半染实拍。
- 像素基线 0 diff（基线世界=空态/stub，棒5 改的是满世界形态——合理，36 张原样绿）。
- 电池 + 净室扫雷 + 对照板：见下。

**电池 23/23 全绿零红**（序修正后连续第二轮）；终局重建后净室扫雷 **0 件/0 指纹**（NEW 0/REGRESSION 0）；像素 36 张绿；对照板重拍 align-board/2026-07-21。

## 刻意不做 / 留后

- 真「折叠 spring」（展开收起的连续高度动画）需要条件渲染→DOM 常驻 + grid-rows 过渡的
  结构改造，超本战役「TSX 只加类名」纪律——挂载入场动画近似，归战役后单独小棒（如果 Danny
  想要）。
- 复选框守圆形（她的方角复选是另一套表单语言，圆勾是我们既有身份；尺寸/边宽已对齐）。
- paper 的待办分卡列表一字未动（拍板①口径：结构跟走=共享组件族度量，屏级配方是皮语言）。

## 验收方式（本棒不推不部署）

同棒3/棒4：本地 commit，dev server 验收 http://localhost:5173/?v=2&mode=live&lang=zh。
