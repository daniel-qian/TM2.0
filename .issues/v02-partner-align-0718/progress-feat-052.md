# feat-052 · 统一 modal 基座 —— 收工记录

分支 `feat/052-modal-base` · 工作树 `D:\avery-wt\052` · 2026-07-18

**状态：done（复核 needs-fix → 已修，见第七节）。**typecheck / build / lint 三门全绿；**nudgeVerdict D 组 5/5 全绿**（复核后补跑，真跑六个页面载入）；另起 dev server 真跑了一轮行为验证（细节与**没能验到的部分**见下方「验收」）。

---

## 一、做了什么

新建 `src/lite2/LiteModal.tsx` —— lite2 唯一的弹层基座，统一提供六件事：

| 能力 | 口径 |
|---|---|
| 背景点击关闭 | 背景是真 `<button>`（带 aria-label），指针与读屏可用；**但它不在焦点环内，键盘够不到**——键盘的关闭路径是 `Esc`（见第二节硬约定 4）；`closeOnBackdrop` 可关 |
| `Esc` 关闭 | **只有栈顶弹层响应**——两层同开时一次 Esc 只关最上面那层 |
| body 滚动锁 | **引用计数**：多层同开只锁一次，最后一层关掉才还原原值 |
| 进出场动画 | framer-motion，参数与 story 既有转场同值：`0.24s / ease [0.16,1,0.3,1]`；`prefers-reduced-motion` 下零时长 |
| 焦点管理 | 开 → 焦点进面板；关 → 还给开之前那个元素；`Tab` / `Shift+Tab` 在面板内成环 |
| 层级 | 单一 z-index 口径 `.lite-modal-layer { z-index: var(--lite2-z-modal, 120) }` |

`DetailOverlay` 和 `OnboardWizard` 已收敛到这个基座上，**业务内容一行没动**——只换底座。

### 两个必须知道的实现决定

**① 绝不 portal 到 `document.body`。**
皮肤令牌挂在 `.lite2-shell[data-skin]`（`skin.ts`），靠 DOM 继承下发。portal 出壳 = 两张皮的令牌全丢，aurora 直接塌回 paper 缺省值。弹层必须留在壳内渲染——这就是双皮兼容的全部实现代价。**055/058 也不许 portal。**

**② 弹层的「可见」和「消失」都不押在动画帧上。**
后台标签页里 `requestAnimationFrame` 不跑，framer-motion 的帧循环随之停摆，**进场出场两头都出事**，且都是实测复现的（`document.visibilityState === 'hidden'`）：

- **进场**：层和面板一直卡在 `initial` 值上，`opacity` 恒为 0，**弹层等于没出现**。首访向导是自动弹的——浏览器恢复会话时在后台标签页开着 Avery，正是这个场景。
- **出场**：`AnimatePresence` 的 exit 永远跑不完，被关掉的层**永久留在 DOM**，`opacity` 恒为 1、`pointer-events: auto`——`.lite-modal-layer` 是 `position:fixed; inset:0; z-index:120`，其背景是 `inset:0` 的实心 button，用户看到的是「按了 Esc 弹层纹丝不动，整个页面点不动」。

两道防线（**对称**，这是复核 findings#1 的修复，详见第七节）：

1. **帧循环不可信时整条走静态分支**——`frameLoopStalled`（`document.visibilityState === 'hidden'`）为真时不进 `AnimatePresence`、不挂 motion 值，`open=false` 由 React 直接卸载。静态模式**只在 `open` 翻转时重算一次**，避免 open 期间父层重渲染把 `motion.div` 换成 `div` 导致子树重挂载（焦点和面板内输入态会全丢）。
2. **出场看门狗**（`EXIT_WATCHDOG_MS = 700`）——兜住「`visibilityState` 是 visible、但帧循环照样不转」的环境（无头驱动、被降频的标签页）。`setTimeout` 不依赖 rAF，帧循环死了它照样到点；到点仍未卸载就转静态分支直接卸。`AnimatePresence` 的 `onExitComplete` 会撤掉它，所以**正常路径连那次多余渲染都不会发生**。

正常路径（前台标签页）零影响，照走 0.24s 动画。

---

## 二、给 055 / 058 的接口（照这个接）

```tsx
import { LiteModal } from './LiteModal'

<LiteModal
  open={Boolean(draft)}            // 开关。false 时基座仍挂载，只是不渲染层
  onClose={closeDraft}             // 背景点击 / Esc 都走它；语义由你定（关闭/暂停/取消）
  ariaLabel={t.lite2.draftAria}    // role=dialog 的无障碍名
  backdropLabel={t.lite2.draftClose} // 背景关闭按钮的无障碍名
  panelClassName="lite-draft-card" // 你自己的面板外观类（宽度/内边距/背景）
  panelData={{ 'data-draft-id': draft?.id }}  // 门要断言的 data-* 钩子
>
  …面板内容…
</LiteModal>
```

全部 props：`open` `onClose` `ariaLabel` `backdropLabel` `children` 必填/常用；
`panelClassName` `layerClassName` `panelData` `closeOnBackdrop`(默认 true) `closeOnEsc`(默认 true) 可选。

**四条硬约定，不照做会踩坑：**

1. **调用方常驻挂载，用 `open` 开关。** 别在父层写 `{cond ? <MyModal/> : null}`——那样组件被直接摘掉，出场动画没机会跑。`Lite2App.tsx` 已按这个改：两个弹层现在都是无条件 `<DetailOverlay />` / `<OnboardWizard />`，开合判定收进各自组件里。
2. **面板由基座渲染**（`role=dialog` + `aria-modal` + `tabIndex=-1` 焦点容器 + `.lite-modal-panel`）。你只给内容和一个外观类，**别再自己套一层背景/卡片外壳**，也别自己挂 Escape 监听。
3. **`open` 从 true→false 后 children 还会渲染约一帧出场时长。** 若内容来自会被清空的 store 字段（如 `store.detail`），要留一份「最后一帧」快照，否则关闭瞬间面板闪空。`DetailOverlay.tsx` 有现成写法（`lastRef`）可抄。
4. 🔴 **背景 button 不在焦点环里**，`Tab` / `Shift+Tab` 都到不了它（焦点环只取面板内的可聚焦元素，而背景是面板的兄弟节点）。所以**若你设 `closeOnEsc={false}`，面板内必须自带关闭控件**，否则键盘用户会被关在弹层里出不来。别按「背景是 button 所以键盘能关」来设计——那句话是错的（复核 findings#3 已改正源码注释）。

面板外观类自己写，但**只消费令牌**（`--lite2-surface` / `--rule` / `--shadow` / `--lite2-ink-rgb`），别写死颜色——aurora 就是靠这个自动跟随的。

---

## 三、改了哪些文件

| 文件 | 改动 |
|---|---|
| `src/lite2/LiteModal.tsx` | **新增**，基座本体 |
| `src/lite2/DetailOverlay.tsx` | 换底座；去掉自挂的 Escape 监听与背景/卡片外壳；加 `lastRef` 出场快照 |
| `src/lite2/OnboardWizard.tsx` | 换底座；去掉自挂的 Escape 监听；开合判定 `selectWizardOpen` 从 Lite2App 移进来 |
| `src/lite2/Lite2App.tsx` | 两个弹层改常驻挂载；移除已下沉的 `detail` / `wizardOpen` 读取 |
| `src/lite2/styles/lite2.css` | 新增 `.lite-modal-layer/-backdrop/-panel` 三条基座规则；删除 `.lite-detail-overlay`、`.lite-detail-backdrop`、`.lite-onboard-backdrop`（职责已进基座） |

**没碰**：`package.json` / `package-lock.json` / `feature_list.json` / 根 `progress.md` / 根 `session-handoff.md` / `src/story/**` / `src/lite/**` / 后端。没装任何包（framer-motion 本来就在 deps）。

### 一处有意的行为变更（验收要求的）

**点背景关闭向导**：此前 `OnboardWizard` 点背景无反应，现在等同 ×（`pause` 语义：进度保留、下次续跑）。这是 kickoff 验收「任意两个弹层关闭方式一致」直接要求的。`DetailOverlay` 的关闭语义不变。

### 保住的既有断言钩子

门相位（nudgeVerdict D 组）按 `.lite-onboard[data-onboard-step]` / `.lite-onboard-playbook[data-playbook-id]` / `.lite-onboard-summary-item[data-playbook-id]` 断言——**三个选择器全部原样保留**。`.lite-onboard` 现在是基座的面板类，`data-onboard-step` 经 `panelData` 下发。

> ⚠️ 初版这里只验到「选择器还在」就断言兼容，**没真跑过这条门**——而 D 组断的是「弹层离开 DOM」，恰好被 findings#1 打掉（选择器在 ≠ 门会绿）。复核后已**真跑 D 组全五相位，5/5 绿**，输出见第七节。

`feat-046` 那条「遮罩色改消费墨色令牌、别在 aurora 下发暖」的修复口径也原样搬进了基座，没回归。

---

## 四、验收怎么过的

### 机器门（真跑，输出如实）

```
$ npm run typecheck        # tsc -b
（零输出，零错）

$ npm run build            # tsc -b && vite build
✓ 504 modules transformed.
dist/assets/index-*.css   181.05 kB │ gzip: 27.44 kB
dist/assets/index-*.js    676.48 kB │ gzip: 218.25 kB
✓ built in 2.93s
（>500kB chunk 警告是既有的，与本条无关）

$ npm run lint
✖ 5 problems (0 errors, 5 warnings)
（5 条全是既有的 "eslint-disable 注释在 noInlineConfig 下无效" 警告：
  OnboardWizard / RoomScreen / useRailCamera×3。改动前后同为 5 条 0 错。）
```

### 行为验证（真起 dev server，端口 5052，用完已停、端口已确认释放）

`npx vite --port 5052`，`?v=2&mode=live&transport=stub`，浏览器里注入 File 驱动 stub ingest 拿到真团队数据，逐条实测：

| 验收项 | 实测结果 |
|---|---|
| 两个弹层结构一致 | 都渲染成 `.lite-modal-layer` > `.lite-modal-backdrop` + `.lite-modal-panel`；面板类分别为 `lite-onboard` / `lite-detail-card`；旧的 `.lite-detail-overlay` / `.lite-onboard-backdrop` 已确认从 DOM 消失 |
| 层级一致 | 两者 `z-index` 实测均为 `120` |
| 遮罩一致 | paper 下均为 `rgba(29,27,23,0.35)`；aurora 下均为 `rgba(16,34,61,0.35)`，`backdrop-filter: blur(3px)` |
| 双皮正常 | `skin=aurora`：面板 border `rgba(16,34,61,0.24)`（aurora rule 令牌）、向导面板背景 `rgba(255,255,255,0.86)`（aurora 半透明 surface）；两个面板都在 `.lite2-shell` 内（令牌继承成立）；详情面板 560×355 完整落在视口内 |
| 打开时背景不能滚 | 开 → `body` 内联 `overflow:hidden`；关 → 还原为 `""`。`html` 实测 `overflow:visible` 且 `document.scrollingElement === html`，故 body 的 overflow 按 CSS 传播规则接管视口滚动——锁生效。移动断点（宽 <860px）实测关闭态 body `overflow:auto`、打开态 `hidden` |
| 关闭后滚动恢复 | 无弹层时 `body.style.overflow === ""`，无残留 |
| Esc 关闭 | 派发 `keydown{key:'Escape'}` → 详情关闭、滚动锁释放 |
| 背景点击关闭 | `.lite-modal-backdrop.click()` → 向导 pause、滚动锁释放 |
| 焦点管理 | 开 → `document.activeElement` 是面板本身；从人卡按钮点开详情、Esc 关闭后 → 焦点**准确回到那张人卡按钮**（`home-person-card`，文本一致） |
| 两层同开（基座的关键保证） | 向导 + 详情同开：第一次 Esc **只关掉栈顶的详情，滚动锁仍保持 `hidden`**（向导还开着）；第二次 Esc 关掉向导，锁释放为 `""`。栈 + 引用计数按设计工作 |

### 🔴 没能验到的（不吹）

- **动画本身没肉眼看过。** 自动化浏览器面板 `visibilityState` 恒为 `hidden`，`requestAnimationFrame` 不触发，截图工具超时——所以 0.24s 的进出场观感、缓动曲线**未做视觉确认**，只确认了 framer-motion 接线正确、终态尺寸/透明度正确。**这条建议合并后由人在真浏览器里扫一眼**（两张皮各开一次弹层即可）。
- ~~**出场后的 DOM 卸载未观测到。**~~ **🔴 这条初版写错了，已修（findings#1）。** 初版措辞是「退出中节点滞留 DOM」+「真浏览器里 exit 跑完即卸载」——前半句把量级说轻了（实际是**永久**停在 `opacity:1`、全屏挡住页面，不是瞬态滞留），后半句是**未经任何浏览器验证的推断**。复核实测：Esc 后逐点采样 100/400/1000/2000/4000ms，五次全部 `{layerInDom:true, layerOpacity:'1', pointerEvents:'auto'}`。修复与验证见第七节。
- **滚动锁是「机制验证」不是「滚轮验证」。** 真实滚轮输入在本面板不可用（截图超时导致 computer 工具的坐标输入不可用）。验的是计算样式与 CSS 传播规则（`html:visible` + body 接管视口），不是模拟滚轮。注：`window.scrollTo` 不是有效探针——`overflow:hidden` 只挡用户滚动，程序化滚动照走。
- **没有前端单测。** 项目无前端测试框架（package.json 无 test 脚本），按规范没去装。
- 后端 pytest 未跑：本条零后端改动。

---

## 五、没做什么

- 没重构两个弹层的业务内容（kickoff 明令「只换底座」）——`DetailOverlay` 的字段渲染、`OnboardWizard` 的四步全部原样。
- 没做草稿框（058）、项目详情（055）、人卡详情——那是下游三条线的活，本条只交地基。
- 没引入 toast / 全局搜索 / FAB 等 G15 其余项（不在本条范围）。
- 没动 `--lite2-z-modal` 的令牌定义：基座用 `var(--lite2-z-modal, 120)` 带缺省值，**没往 skin-*.css 里塞新令牌**，为的是少一个 11 路合并的冲突面。谁要调层级，在 skin 文件里定义这个变量即可覆盖。

---

## 六、Notes（顺手发现，**没修**，留给集成方/后续线）

1. **`.lite-bell-pop` 的 z-index 是 90，本来就高于旧弹层的 80。** 也就是说改之前，铃铛下拉会盖在向导/详情之上。基座定在 120 顺手把这个盖过去了，但**铃铛下拉自己不是 modal、开着弹层时不会自动收起**——如果之后要求「弹层开着时铃铛不可点」，得单独处理，不在本条范围。
2. **`src/lite/styles/lite.css`（v01）里也有一份同名的 `.lite-detail-overlay` / `.lite-detail-card`，两个文件都是全局加载的**（`main.tsx` 里 lite.css 在 lite2.css 之前 import）。目前靠「后 import 者胜」侥幸不出事——lite2 的 `.lite-detail-card` 是**未加 `.lite2-shell` 前缀**的裸类名。本条新增的三条基座规则都已加 `.lite2-shell` 前缀，不参与这个隐患；但 `.lite-detail-card` 那份历史裸类名建议将来收口时一并加前缀。**本条没动，避免扩大合并面。**
3. 向导的 `pause()` 是 session-only（不持久化），刷新后又会弹——既有设计，非本条引入。

---

## 七、复核 needs-fix → 修复记录（2026-07-18，同分支追加）

复核判定 `needs-fix`：11/12 验收项过，1 项 no（进出场动画），另有 2 条 minor。逐条处理如下。

### findings#1（major，已修）— 出场没有兜底，帧循环停摆时弹层永久留在 DOM

**复核者的判定成立，我先独立复现了一遍。** 自起 vite 5052、`?v=2&mode=live&transport=stub`：

```
环境确认: {visibilityState:'hidden', rafFiredWithin1500ms:false, layerOpacity:'1'}
          ↑ rAF 1500ms 内不触发 = framer-motion 帧循环停摆
          ↑ opacity 已经是 1 = skipEnter 生效了（进场有兜底），坐实"只有出场没兜底"

修前（向导开着 → 派发 keydown Escape → 逐点采样）:
  at  100ms {wizardInDom:true, layerInDom:true, layerOpacity:'1', pointerEvents:'auto', bodyOverflow:''}
  at  400ms {同上}
  at 1000ms {同上}
  at 2000ms {同上}
  at 4000ms {同上}
  closedOnEscape_gateCriterion: false      ← 门的判定条件，红
```

`bodyOverflow` 已释放为 `''`、store 已 null——副作用是对的，但 `.lite-modal-layer`
(`position:fixed; inset:0; z-index:120`) 带着 `inset:0` 的实心 backdrop button 永久留着，
等于一块全屏点击遮罩糊在 UI 上。

**修法**（`src/lite2/LiteModal.tsx`），与已有的 `skipEnter` 对称，两道防线：

1. **静态分支**——`frameLoopStalled = document.visibilityState === 'hidden'` 时整条不进
   `AnimatePresence`、不挂 motion 值，`open=false` 直接返回 `null` 由 React 同步卸载。
   原来的 `skipEnter`（只管进场的 `initial={false}`）被它取代，进出场从此同一口径。
   静态模式**只在 `open` 翻转时重算一次**（`staticModeRef` + `prevOpenRef`）：否则 open 期间
   父层一重渲染就可能把 `motion.div` 换成 `div`，元素类型变了 = 整棵子树重挂载，焦点和面板内
   输入态全丢。
2. **出场看门狗** `EXIT_WATCHDOG_MS = 700`——兜住「`visibilityState` 报 visible、但帧循环照样
   不转」的环境（无头驱动、被降频标签页）。`setTimeout` 不依赖 rAF，帧循环死了照样到点；到点
   仍未卸载就转静态分支直接卸。`AnimatePresence onExitComplete` 会撤掉它，**正常路径连那次多余
   渲染都不会发生**。700ms vs 出场 240ms，余量 ~3x，真浏览器永远轮不到它。

**修后实测（同一环境、同一事件、同一 4000ms 窗口）：**

```
  at   50ms {wizardInDom:false, layerInDom:false, bodyOverflow:''}
  at  100/400/1000/2000/4000ms {同上，全部 false}
  closedOnEscape_gateCriterion: true       ← 绿
  persistedStatus:'in-progress' persistedStep:'upload'   ← pause 语义没被改坏
```

**看门狗单独验过**（人为 `Object.defineProperty(document,'visibilityState',{get:()=>'visible'})`
骗过静态分支，让它走 motion 路径，而 rAF 是真死的 —— `rafReallyFired:false`）：

```
  openedOpacity: '0'    ← 佐证：motion 路径 + 死帧循环，进场确实卡在 initial（这就是当初 skipEnter 要解决的）
  Esc 后: at 300ms layerInDom:true → at 900ms true → at 1500ms false → 卸载成功
  （700ms 的定时器因后台标签页节流实际约 1s 才到点，符合预期）
```

### findings#2（minor，已修）— progress 断言门钩子保留，但门从没跑过

属实。初版 gatesRun 只有 typecheck / build / lint / 临时探针 / git status，**没有任何 verdict 套件**。
已按 `live-frontend-gate.snippet.js` 的 D 组驱动协议**真跑六个页面载入**（每次都是真 reload +
重新注入 tracked 断言包，跨页证据用 sessionStorage 携带，不是我自己重写的判定步骤）：

```
$ [A] 清 lite2:* → reload → defuseAnimations() → onboardWalkthrough()
  {sawWizard:true, startStep:'upload', uploadReady:true, filledTeam:true,
   defaultIds:['onboarding-handover','stuck-project','weekly-review'],
   chosenIds:['handoff-cover','stuck-project','tough-conversation','weekly-review'],
   differsFromDefault:true, summaryMatches:true, greetingHasName:true, finished:true}
                                                                      ↑ 修前这条也会是 false
$ [B] reload → assertOnboardPersist(walk)
  {pass:true, wizardStaysAway:true, exactMatch:true, allTagged:true,
   slotIds:['handoff-cover','stuck-project','tough-conversation','weekly-review']}

$ [C] 清 lite2:* → reload → assertOnboardEscape()          ← 复核点名被打掉的那条
  {pass:true, sawWizard:true, advanced:true, stepBefore:'team', closedOnEscape:true,
   persistedStatus:'in-progress', persistedStep:'team', statusOk:true, stepPreserved:true}

$ [D] reload → onboardSkipNow()        {sawWizard:true, skipClosed:true}
$ [E] reload → assertOnboardSkip(skip) {pass:true, wizardStaysAway:true}
      → assertChipsAsk()               {pass:true, chipIds:['attention','project-risk','handoff','next-week']}
$ [F] 静置 3s → 清 lite2:* → reload → assertBellIsReal()   {pass:true}

$ nudgeVerdict({...})
  {pass:true, phases:{onboardPersist:true, onboardEscape:true, onboardSkip:true,
                      chipsAsk:true, bellIsReal:true}}      ← D 组 5/5 全绿
```

初版「Esc：派发 keydown Escape → 详情关闭」的措辞也偏软（当时只在 store 层为真，DOM 层面板仍
全幅可见），第四节那条「没能验到的」已按实情改写。

### findings#3（minor，已修）— 注释声称背景 button 键盘能关，实际够不到

属实。焦点环只从 `panel.querySelectorAll(FOCUSABLE)` 取候选，而 `.lite-modal-backdrop` 是 panel 的
**兄弟节点**，首尾元素上又 `preventDefault` 回卷，所以 Tab / Shift+Tab 都送不到背景 button 上。
**改注释**（没把背景纳入焦点环——全屏隐形 button 混进 Tab 序列的观感更差，且 Esc 与面板内关闭
控件已覆盖键盘路径）：`LiteModalProps.backdropLabel` 的 doc 现在写明它不在焦点环里、键盘路径是
`Esc`，并给出下游推论——**设 `closeOnEsc={false}` 就必须在面板内自带关闭控件**，否则键盘用户被
关在弹层里。同一条也写进了第二节的硬约定 4（055/058 照着接的那份）。

### 修完重跑的门

```
$ npm run typecheck        # tsc -b
（零输出，零错）

$ npm run build
✓ 504 modules transformed.
dist/assets/index-Cfec8x_L.css   181.05 kB │ gzip:  27.44 kB
dist/assets/index-CrG1pfA2.js    677.15 kB │ gzip: 218.47 kB
✓ built in 2.23s
（js 从 677.15 kB —— 比修前 +0.6 kB，是静态分支那段 JSX；>500kB 警告是既有的）

$ npm run lint
✖ 5 problems (0 errors, 5 warnings)
（与基线同为 5 条既有 noInlineConfig 警告。中途我加的一条 eslint-disable 会让它变 6 条——
  该注释在 noInlineConfig 下本就无效，已删掉，回到基线 5。）

$ nudgeVerdict D 组     5/5 绿（输出见上）
```

**回归复验**（修完后重跑，确认没把原来绿的改红）：

| 验收项 | 修后实测 |
|---|---|
| 详情：Esc 关闭 | `detailClosedOnEsc:true`，`bodyOverflow` `hidden`→`''` |
| 详情：背景点击关闭 | `closedOnBackdropClick:true`，锁释放 |
| 焦点归还 | `focusOnPanel:true`（开）→ `focusRestoredToCard:true`（关，回到那张人卡） |
| 结构 / 层级 | `role:'dialog'`、`aria-modal:'true'`、`zIndex:'120'`、`insideShell:true` |
| 两层同开 + 引用计数 | 同开 `{layers:2, zIndexes:['120','120'], lock:'hidden'}`；Esc#1 → `{layers:1, detail:false, wizard:true, lock:'hidden'}`；Esc#2 → `{layers:0, lock:''}` ← **修前这里 layers 恒为 2** |
| paper 皮 | backdrop `rgba(29,27,23,0.35)` |
| aurora 皮 | backdrop `rgba(16,34,61,0.35)`、panel border `rgba(16,34,61,0.24)`、`insideShell:true`、两个弹层取值相同、`wizardGone:true` / `detailGone:true` |

### 仍然没验到的（不吹）

- **动画观感依旧没肉眼看过。** 本环境 rAF 实测不触发（`rafFiredWithin1500ms:false`）、
  `visibilityState` 恒为 `hidden`，所以 0.24s 缓动曲线**无法做视觉确认**——而且正因为帧循环停摆，
  这个环境跑的**恰恰是新加的静态分支，不是动画路径**。已验的是：动画路径的参数接线正确、静态
  路径与看门狗都能把层干净卸掉、终态样式正确。**建议合并后由人在真前台浏览器里扫一眼**（两张皮
  各开关一次弹层即可，看是否有 0.24s 淡入淡出）。
- **真实滚轮输入未模拟**（本面板 `innerWidth/innerHeight` 恒为 0，无可用布局视口）；滚动锁验的是
  内联样式翻转与 CSS 传播规则，同初版。
- **前端无单测框架**（package.json 无 test 脚本，按规范没装）。
- **后端 pytest 未跑**：本条零后端改动（`git diff main --stat -- eval-harness/` 为空）。
- nudgeVerdict **A/B/C/E/F 组未跑**：本条只碰弹层基座，D 组是唯一按「弹层离开 DOM」断言的组；
  其余组由集成方在合流后统一跑。
