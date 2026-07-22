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
- [x] **顶栏搜索结果浮层入场** ✅ 2026-07-22 批次③收官
  现状（已修）：`.lite-search-pop` 原先无过渡硬弹。她：平滑弹出。
  **已落地**：`@keyframes lite-search-pop-in`（opacity + translateY(-6px)→0，transform-origin top center），
  包 `@media (prefers-reduced-motion: no-preference)`；showPanel 条件挂载每次展开重放。
  顺手把搜索框聚焦/悬停边框由硬切改 `transition: border-color var(--fast)`（色相非位移，同 gap-chip 无需 reduce 兜）。
  实测：no-preference 命中 animationName=lite-search-pop-in、reduce 归零 none。
- [x] **差距三态 chip 切换** ✅ 2026-07-22 批次③收官
  现状（已修）：chip 本身早有 120ms 色相过渡；**列表**换筛选是硬换。她：换态平滑。
  **已落地**：`<ul key={gapFilter}>` 换态即重挂 → 重放 `@keyframes lite-home-gap-list-in`（opacity-only，
  避与 block 的 lite2-rise 叠加），包 `@media (prefers-reduced-motion: no-preference)`。
  实测：no-preference 命中 lite-home-gap-list-in、reduce 归零 none。
- [ ] **通用**：她全站的卡片 hover 上浮 / 阴影过渡，逐屏对照时留意我方是否跟上
  （lite2-rise 入场已在，但 hover 态过渡要逐屏核）。

## 微交互 / 状态

- [ ] 搜索框聚焦态（focus ring / 边框）对照她的质感。
- [ ] 悬浮钮在有滚动时是否需要「滚动时半隐/返回时浮现」这类行为（她若有再补，没有就不做）。

## 记法

- 每条注明「现状」+「她怎么做」+「修法方向」，做完打勾并留 commit 号。
- 🔴 所有动效必须包 `prefers-reduced-motion: no-preference`（媒体级隔离，不提特异性——棒4 坑）。
- 🔴 新 `@keyframes`/transform 若涉及 fixed 悬浮件，注意 transform 会建包含块（棒F 坑）。
