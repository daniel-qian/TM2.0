# 细节 / 动效清单（Danny「不能漏」 · 2026-07-22 起）

> 用途：她的版本里那些**不是布局骨架、但一眼能感到差别**的细节（动效、过渡、微交互）。
> 我们不追求一比一复刻，但**逐条记下来，做过的打勾，别漏**。归入批次③ 棒G3 的动效 pass，
> 或哪一棒顺手就哪一棒做。发现新的往这里加。

## 动效 / 过渡

- [x] **「问 Avery」悬浮入口展开动画**（Danny 07-22 亲口点名）✅ 2026-07-22 棒G3 动效头条
  现状（已修）：`.lite-ask-avery` 原先一条 `transition`/`animation` 都没有——硬切。
  她：平滑展开（胶囊 → 输入框有过渡）。
  **已落地**：① 胶囊 hover 加 `transition: background var(--fast)`（胶囊本身是 .lite-btn，
  reduce 兜底块 l.5740 已把它 transition 归零，无需再包）；② form 入场 `@keyframes
  lite-ask-avery-expand`（scale .92→1 + 淡入 + translateY，transform-origin bottom center，
  从胶囊位「长出来」），**包进 `@media (prefers-reduced-motion: no-preference)`**（form 非
  .lite-btn 不吃 5740 兜底，必须自包；媒体级隔离不提特异性——棒4 坑档）。
  留档：pill↔form 是条件渲染硬换 DOM，纯 CSS 做不了可逆 morph，故用入场动画近似她的展开；
  收起(form→pill)仍是硬回（未名点名项，且给 pill 入场动画会连首屏加载都 pop，故不做）。
  实测：keyframe 在册、form 计算 animationName=lite-ask-avery-expand/0.22s、no-preference 命中、
  reduce 不命中；spec 35/35、扫雷 0/0 零回归。
- [ ] **顶栏搜索结果浮层入场**：现状检查——`.lite-search-pop` 是否有淡入/下滑过渡，还是硬弹。
- [ ] **差距三态 chip 切换**：点 chip 换筛选时列表是硬换还是有过渡。
- [ ] **通用**：她全站的卡片 hover 上浮 / 阴影过渡，逐屏对照时留意我方是否跟上
  （lite2-rise 入场已在，但 hover 态过渡要逐屏核）。

## 微交互 / 状态

- [ ] 搜索框聚焦态（focus ring / 边框）对照她的质感。
- [ ] 悬浮钮在有滚动时是否需要「滚动时半隐/返回时浮现」这类行为（她若有再补，没有就不做）。

## 记法

- 每条注明「现状」+「她怎么做」+「修法方向」，做完打勾并留 commit 号。
- 🔴 所有动效必须包 `prefers-reduced-motion: no-preference`（媒体级隔离，不提特异性——棒4 坑）。
- 🔴 新 `@keyframes`/transform 若涉及 fixed 悬浮件，注意 transform 会建包含块（棒F 坑）。
