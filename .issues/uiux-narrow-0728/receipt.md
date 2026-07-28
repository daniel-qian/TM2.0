# 回执 · 2026-07-28 · 合伙人验收逮到的两个真机 UI bug（uiux-narrow-0728）

**一句话**：合伙人验收报了「重叠」和「窄屏没自适应」两处，逐个刨到根因——**病根是同一个：
让位余量一直被当成宽度的函数，但空态卡是垂直居中的，余量其实是高度的函数**；而门只跑过
1280×900 一个高度、只跑满态、只认 h1/h2/h3、窄屏还被自己 skip。门先扩到能看见（28 红），
再修，收工 58 绿。

## 门先红 → 修 → 绿

| 阶段 | verify-topbar-clearance.mjs |
|---|---|
| 扩容前（旧门） | 18 PASS · 0 FAIL —— **绿着放过两个生产 bug** |
| 扩容后 · 改码前 | 30 PASS · **28 FAIL**（红先行，两个 bug 逐个复现） |
| 修完 | **58 PASS · 0 FAIL** |

## 四个盲维（门为什么曾经绿）

1. **只跑一个高度**。`.nexus-empty` 是 `top:42% + translate(-50%,-50%)` 垂直居中
   （shared/40-nexus-empty.css:3），卡顶 = `0.42×视口高 − 卡高/2`。操作手册空态卡高 512px：
   视口高 <776 卡顶钻进顶栏，<707 眉题被吃，<664 连 h2 都被吃。1366×768 笔记本（视口高 ~630）
   正在红区，而门唯一跑过的 900 恰好在安全区。→ 补 6 档高度矩阵。
2. **只跑满态**（先 uploadFiles 再量），合伙人在**空态**——两种世界布局不是一套
   （满态=滚动壳+padding；空态=绝对定位居中卡）。→ 补空态 phase B。
3. **判据只认 h1/h2/h3**。空态卡最先被吃的是卡顶边和 `<p class="eyebrow">`，h2 在它们下面 47px。
   → 判据扩到 `.eyebrow` + `.nexus-empty` 顶边。
4. **窄屏被门自己 skip**（旧 l.51：顶栏不是 fixed 就 return）。→ phase C 改判三条硬判据。

🔴 **phase C 必须 headed**：headless Chromium 是零宽 overlay 滚动条，`scrollWidth-clientWidth`
恒为 0——横向溢出这一类 bug 在 headless 下 structurally 不可见（同页同视口实测 headless 0 / headed 15）。

## 改了什么

| # | 文件 | 改动 |
|---|---|---|
| ① | lite2.css 尾 | 空态卡 `top:42%` → `top:clear-top; bottom:24px; margin-block:auto` + max-height 内滚：**能居中就居中，不够就贴让位线，永不上钻** |
| ② | lite2.css 尾 | `.app-shell.lite2-shell{width:100%}` 覆盖 00-base 的 `100vw`——消 15px 横向溢出 |
| ③ | lite2.css 尾 | 操作手册满态硬写的 84px 并进 `--lite2-clear-top`（唯一漏网的第 10 个消费者，08 屏比棒2 变量体系晚） |
| ④ | lite2.css 尾 + LiteTopbar.tsx | tab 条溢出渐隐提示（`data-overflow` 由组件量、CSS 挂 mask）+ 当前屏 tab 自动拉回可视区 |
| ⑤ | lite2.css 尾 | ≤860 窄屏重做：顶栏 `column`→`row`（208px 五层墙 → 64px 单行）、`justify-content` 扳回 flex-start、`--lite2-clear-top` 72→24、`min-height:1500px`→跟视口走、空态卡回归文档流（消手机双层滚动） |

🔴 `shared/00-base.css` 与 `shared/40-nexus-empty.css` **一个字未动**（v01/story 冻结面）——
全部 `.lite2-shell` 作用域 (0,2,0) 压 (0,1,0)，APPEND-ONLY 后写者胜。

**⑤ 里的 `justify-content` 是截图逼出来的**：顶栏改单行后门全绿，但截图上当前高亮的「指挥室」
自己被切在左缘外——00-base l.1133 给窄屏 `.scene-tabs` 的是 `center`，而它同时是 overflow-x
滚动容器，**居中一个溢出的 flex 行会把行首推到滚动原点之前，scrollLeft 最小只能到 0，那几个
tab 既不可见也滚不回来**。这条是 tab 条改成横滚容器时就埋下的，竖排模式下行没溢出所以没显形。
→ 门绿 ≠ 真看过，这次是看图才逮到的。

## 实测（生产=修前 vs 本地=修后）

操作手册空态卡顶（paper/zh，带底 70）：

| 视口 | 修前 | 修后 |
|---|---|---|
| 1920×1080 | 198 ✅ | 320 ✅ |
| 1440×900 | 122 ✅ | 230 ✅ |
| 1366×768 | **67 ❌** | 165 ✅ |
| 1280×720 | **46 ❌** | 141 ✅ |
| 960×700 | **40 ❌** | 134 ✅ |
| 1366×768 · **en** | **23 ❌** | ✅ |

窄屏（815×740 / 390×844）：顶栏带高 **208 → 64**；横向溢出 **15px → 0**；
首内容距带底 **390–528px → <240px**（合伙人截图里那一大片空白）。

满态（真点示例团队，16 人/5 方法卡）1366×768 与 390×844 九屏全部让位达标、零横向溢出。

## 全电池

- **A 区 19/19 绿**（含 cr-alignment / button-family / contrast / aria-zh / p0 / zh-purity 等）
- **B 区**：visual-baseline 4/4 绿（重冻见下）；null-owner 15/15 绿；
  **data-boundary 红＝环境**（它 spawn 自己的 vite **dev** :5304，本仓 dev 起不来——
  git stash 到改前跑同样红，与本次改动无关）
- typecheck 0 错

### 像素基线口径（发现一处文档与实际相反）

36 张里 26 张变了，但 **git stash 到改前重跑发现 5 张改前就在漂**
（aurora-closerlook/vision 的 desktop+mobile、paper-vision-mobile——全是 aurora 眉题
`font-weight:750` 变体字的抗锯齿差，位置一像素没动，放大对照确认）。
→ **21 张是本次改动**（6 desktop 空态卡屏 + 15 mobile），已 `--update-snapshots` 重冻。

🔴 **但基线其实是 gitignore 的**（`.gitignore:34`），而 `playwright.config.mjs` 的注释白纸黑字写着
「基线 PNG 提交在 `__snapshots__/`」——**注释与实际相反**。后果：像素门是**单机本地产物**，
换台机器/换个 agent 就没有基线可比，"36 张基线"进不了 CI 也进不了别人的验收。
本次没动这个决定（要么 tracked 要么把注释改对，属 Danny 拍板面）。

## 留后

- ⚠️ **像素基线 tracked 与否**：见上，注释与 .gitignore 打架，需拍板。
- ⚠️ **断点动物园**：lite2.css 一个文件 560/620/720/860/861/880/1100/1366 八个断点，
  00-base 只有 860。本次没并（并断点是纯重构，风险与收益不对称，单开一场更稳）。
- ⚠️ **两皮顶栏带底不等高**（paper 70 / aurora 61）而让位是同一个常数 96——本次靠余量兜住，
  没做成按皮取值。
- **data-boundary 门在本机跑不了**（依赖 vite dev），非本次引入。
