# #83 变异台账 · `verify-room-rail.mjs`

> 跑器 `mutate.py`（每条**独立**跑：apply → vite build → 跑门 → revert）；锚点先过 `anchor-check.py`
> （每条必须恰好命中 1 处——0 处命中长得跟「变异存活」一模一样）。
> 环境：后端 8283 mock 三件套 · 前端 `vite build --mode development` + `preview --port 5283 --host`。

## 结论：12 条全红

**第一轮 12 条里有 2 条活了下来（M-C / M-F），两条都是门洞不是代码 bug**，门补判据后重跑双双变红。
逐条经过写在下面对应小节的开头，两条新碑：

- **M-C**：A⑤ 当时只量行高 `[30,40]`。两行式在「时刻已撤、单轮场无 pill」之后恰好收成 **40px**，
  正落在尺子里活了下来。修法不是把上界改小了事，而是补一条**正面判据**：轮数 pill 的竖向中线
  必须落在标题的竖向跨度里（并排＝真单行），另把上界收到 36。
  → 碑：**尺子太宽 = 对着真违规也全绿**。
- **M-F**：`getComputedStyle(el, '::before')` 对一个**根本没生成**的伪元素照样把规则里写的
  width/background 原样吐回来——`content: none` 之后屏上封条整条消失，而判据读到的仍是
  `2px` + accent-deep，40/0 全绿。修法：`content` 必须一起判（`none`／整条规则被删时的 `normal`
  两种都判死）。→ 碑：**伪元素的计算值不证明它上了屏**。

| 变异 | 打的判据 | 结果 |
|---|---|---|
| M-A 栏底色回到 #80 那张白卡片 | A② 下陷 | 39/1 红 |
| M-B 栏回到 clear-top ↔ 底带之间悬空 | A③ 贴边通到底 | 39/1 红 |
| M-C 行改回两行式 | A⑤ 单行 | 首轮 40/0 **活**；补判据后 39/2 红 |
| M-D 时刻静息态又占墨 | A⑥ 时刻零墨 | 39/1 红 |
| M-E 单轮场恢复渲染 meta 文本 | A⑦ 单轮零文本 | 39/1 红 |
| M-F 选中行 ::before 关掉 | A⑨ 2px 左封条 | 首轮 40/0 **活**；补判据后 40/1 红 |
| M-G 组标改回 `--ink-faint` | A⑩ 组标吃 ink-soft | 39/1 红 |
| M-H 开场块不再居中 | A⑪ 居中 | 39/1 红 |
| M-I 抽屉沿用桌面半透明底 | B③ 抽屉不透明 | 39/1 红 |
| M-J 抽屉沉到遮罩之下 | B④ 真的盖住正文 | 35/2 **红**（红在半路 crash——抽屉被遮罩接管点击，driver 点行超时。红得对，但形态是崩不是红，见下） |
| M-K 遮罩整块不渲染 | B⑥ 遮罩在场且点它收起 | 38/2 红 |
| M-L 抽屉里标题换成洗白的灰 | B⑦ 抽屉内小字 AA | 39/1 红 |

⚠ M-J 的红形态是**门跑到一半 crash**（汇总行没打印，靠逐条 `[PASS]/[FAIL]` 计数才看得出来）。
原因是这条变异真的把抽屉做成了点不动的：遮罩盖在它上面，driver 点会话行必然超时。
这不是门的缺陷（红得准），但记一笔——`0 PASS/0 FAIL + 无汇总行` 与「全绿」在 stdout 上长得很像，
跑器判「崩」不判「红」的那段逻辑就是为这种情况写的。

---

### M-A — rail background reverts to the opaque #80 white card

- 门：`eval-harness/tools/verify-room-rail.mjs`
- 结果：**39 PASS / 1 FAIL**

```
[FAIL] A② 🔴 栏是**下陷**不是凸起：底色合成到身后那张面上之后，亮度**更低**（#80 那份 rgb(surface) 比暖纸画布更亮，正是「浮在页面上的白卡片」观感的主要来源。判据不写字面量——写死 rgba 的尺子换一张皮就瞎） — {"railBg":[255,253,248,1],"behind":[247,244,238,1],"railLum":0.9829,"behindLum":0.9065}
```

### M-B — rail goes back to floating between clear-top and the bottom band

- 门：`eval-harness/tools/verify-room-rail.mjs`
- 结果：**39 PASS / 1 FAIL**

```
[FAIL] A③ 🔴 栏**贴边通到底**：上沿 0、下沿 = 视口底（改造前上沿从 96px 起、下沿停在 780px，上下各一道悬空截断边） — {"rail":{"x":0,"top":96,"bottom":780,"w":264},"viewportH":900}
```

### M-C — history rows go back to the two-line (column) layout

- 门：`eval-harness/tools/verify-room-rail.mjs`
- 结果：**40 PASS / 0 FAIL**

```
  [PASS] B⑧ 点一场：抽屉自动收起、遮罩跟着撤走，且整场真的进了议事室（抽屉不收＝用户点完还要再点一下才能看见自己点开的东西） — {"asideVisible":false,"scrim":0,"turns":2}
  [PASS] B⑥ 点遮罩即收起（自证：点之前遮罩确实在场，否则这条是拿一个不存在的元素判成功） — {"scrimBefore":1,"asideDisplay":"none","scrim":0}
  [PASS] B⑨ 无 pageerror（手机世界整程零未捕获异常） — []

═══ #83 会话侧栏（桌面栏规格 · 开场块居中 · ≤860 抽屉）：40 PASS · 0 FAIL ═══
```

### M-D — timestamp is shown at rest again (display:none dropped)

- 门：`eval-harness/tools/verify-room-rail.mjs`
- 结果：**39 PASS / 1 FAIL**

```
[FAIL] A⑥ 🔴 时刻在**静息态零墨**（指针已挪出侧栏才采的样）——它是「每行三个对齐点」里最右边那一个，撤掉它列表才有一条稳定竖轴 — [{"d":"block","ink":1063},{"d":"block","ink":1023}]
```

### M-E — single-exchange threads render meta text again

- 门：`eval-harness/tools/verify-room-rail.mjs`
- 结果：**39 PASS / 1 FAIL**

```
[FAIL] A⑦ 🔴 单轮的场**一个字都不渲染**（改造前这里是「单独问过一次」——0810 真数据 9 场里8 场逐字相同：满行的墨、零信息） — [{"n":"2","node":true},{"n":"1","node":true}]
```

### M-F — selected row loses its 2px accent seal (::before dropped)

- 门：`eval-harness/tools/verify-room-rail.mjs`
- 结果：**40 PASS / 0 FAIL**

```
  [PASS] B⑧ 点一场：抽屉自动收起、遮罩跟着撤走，且整场真的进了议事室（抽屉不收＝用户点完还要再点一下才能看见自己点开的东西） — {"asideVisible":false,"scrim":0,"turns":2}
  [PASS] B⑥ 点遮罩即收起（自证：点之前遮罩确实在场，否则这条是拿一个不存在的元素判成功） — {"scrimBefore":1,"asideDisplay":"none","scrim":0}
  [PASS] B⑨ 无 pageerror（手机世界整程零未捕获异常） — []

═══ #83 会话侧栏（桌面栏规格 · 开场块居中 · ≤860 抽屉）：40 PASS · 0 FAIL ═══
```

### M-G — group label falls back to --ink-faint (the #80 gravestone)

- 门：`eval-harness/tools/verify-room-rail.mjs`
- 结果：**39 PASS / 1 FAIL**

```
[FAIL] A⑩ 🔴 组标吃 `--ink-soft` **不吃** `--ink-faint`（11px 的 faint 在 paper 上只有 ~4.7:1，contrast 门的 AA 地板余量仅 0.2、aurora 侧更薄——#80 已立此碑） — {"color":"rgb(115, 108, 95)","weight":"700","size":"11px","wantSoft":"rgb(94, 90, 81)","wantFaint":"rgb(115, 108, 95)","text":"今天"}
```

### M-H — welcome block is no longer centred in the rectangle

- 门：`eval-harness/tools/verify-room-rail.mjs`
- 结果：**39 PASS / 1 FAIL**

```
[FAIL] A⑪ 🔴 开场块在「顶栏以下、composer 以上」那块矩形里**垂直居中**（改造前它钉在滚动口顶端，底下拖着 ~700px 虚无） — {"justify":"normal","welcomeMid":203,"boxMid":354}
```

### M-I — drawer reuses the desktop translucent tint (glass over the content)

- 门：`eval-harness/tools/verify-room-rail.mjs`
- 结果：**39 PASS / 1 FAIL**

```
[FAIL] B③ 🔴 抽屉底色**不透明**（alpha ≥ 0.99）。桌面那份 rgba(ink,.035) 盖到正文上是透明玻璃、正文从字缝里透出来；另一半理由是 verify-contrast-smalltext 的 bgOf 把 alpha>0.5 当实底、≤0.5 当完全透明跳过——半透明的抽屉会让它量出一个屏上根本不存在的比值 — [29,27,23,0.035]
```

### M-J — drawer sinks below the scrim (opaque, but no longer on top)

- 门：`eval-harness/tools/verify-room-rail.mjs`
- 结果：**35 PASS / 2 FAIL [CRASH mid-run: summary line never printed]**

```
[FAIL] B④ 🔴 抽屉真的**盖住**了正文：覆盖区里三点 elementFromPoint 全命中抽屉自己（底色不透明但 z 序在正文之下的实现在这条红——alpha 那条管不着它） — {"hits":[false,false,false],"z":"45"}
[FAIL] B⑥ 遮罩在场、铺满、且比抽屉低一层（没有遮罩的抽屉，用户不知道点哪儿能关） — {"rect":291720,"bg":[29,27,23,0.28],"z":"46"}
```

### M-K — scrim is never rendered

- 门：`eval-harness/tools/verify-room-rail.mjs`
- 结果：**38 PASS / 2 FAIL**

```
[FAIL] B⑥ 遮罩在场、铺满、且比抽屉低一层（没有遮罩的抽屉，用户不知道点哪儿能关） — null
[FAIL] B⑥ 点遮罩即收起（自证：点之前遮罩确实在场，否则这条是拿一个不存在的元素判成功） — {"scrimBefore":0,"asideDisplay":"flex","scrim":0}
```

### M-L — drawer row titles get a washed-out grey (AA floor broken inside the drawer)

- 门：`eval-harness/tools/verify-room-rail.mjs`
- 结果：**39 PASS / 1 FAIL**

```
[FAIL] B⑦ 🔴 抽屉里所有文字 ≥ AA（小字 4.5 / 大字 3.0，尺子与 verify-contrast-smalltext 同源）——这块在四道既有门里零覆盖，它们的视口都硬钉 ≥900 — lite-room-history-q 2.05/4.5 (别墅套餐推广现在最需要我做什)
```

### M-C — history rows go back to the two-line (column) layout

- 门：`eval-harness/tools/verify-room-rail.mjs`
- 结果：**39 PASS / 2 FAIL**

```
[FAIL] A⑤ 🔴 会话行是**单行 34px**（改造前是标题行 + 左右分栏的 meta 行 ≈ 85px，1440×900 只装得下 9 场） — [40,34]
[FAIL] A⑤ 🔴 轮数与标题**并排**（pill 的竖向中线落在标题的竖向跨度里）——只量行高的尺子对「改回两行式」是瞎的：撤掉时刻之后两行式恰好收成 40px，M-C 变异实测被它放过 — [{"n":"2","sameLine":false},{"n":"1","sameLine":null}]
```

### M-F — selected row loses its 2px accent seal (::before dropped)

- 门：`eval-harness/tools/verify-room-rail.mjs`
- 结果：**40 PASS / 1 FAIL**

```
[FAIL] A⑨ 🔴 选中行带一道 **2px 的 accent 左封条**（左封条是「这一条是当前」最省墨的说法；判据读 ::before 的计算值，且**先判 content 真的生成了**——没生成的伪元素照样有 width/color） — {"content":"none","barW":"2px","barBg":[74,96,78,1],"accentDeep":[74,96,78]}
```
