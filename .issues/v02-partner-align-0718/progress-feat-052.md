# feat-052 · 统一 modal 基座 —— 收工记录

分支 `feat/052-modal-base` · 工作树 `D:\avery-wt\052` · 2026-07-18

**状态：done。**typecheck / build / lint 三门全绿，另起 dev server 真跑了一轮行为验证（细节与**没能验到的部分**见下方「验收」）。

---

## 一、做了什么

新建 `src/lite2/LiteModal.tsx` —— lite2 唯一的弹层基座，统一提供六件事：

| 能力 | 口径 |
|---|---|
| 背景点击关闭 | 背景是真 `<button>`（带 aria-label），键盘用户也能关；`closeOnBackdrop` 可关 |
| `Esc` 关闭 | **只有栈顶弹层响应**——两层同开时一次 Esc 只关最上面那层 |
| body 滚动锁 | **引用计数**：多层同开只锁一次，最后一层关掉才还原原值 |
| 进出场动画 | framer-motion，参数与 story 既有转场同值：`0.24s / ease [0.16,1,0.3,1]`；`prefers-reduced-motion` 下零时长 |
| 焦点管理 | 开 → 焦点进面板；关 → 还给开之前那个元素；`Tab` / `Shift+Tab` 在面板内成环 |
| 层级 | 单一 z-index 口径 `.lite-modal-layer { z-index: var(--lite2-z-modal, 120) }` |

`DetailOverlay` 和 `OnboardWizard` 已收敛到这个基座上，**业务内容一行没动**——只换底座。

### 两个必须知道的实现决定

**① 绝不 portal 到 `document.body`。**
皮肤令牌挂在 `.lite2-shell[data-skin]`（`skin.ts`），靠 DOM 继承下发。portal 出壳 = 两张皮的令牌全丢，aurora 直接塌回 paper 缺省值。弹层必须留在壳内渲染——这就是双皮兼容的全部实现代价。**055/058 也不许 portal。**

**② 弹层的「可见」不押在动画帧上。**
后台标签页里 `requestAnimationFrame` 不跑，framer-motion 的帧循环随之停摆。本波实测（`document.visibilityState === 'hidden'`）：层和面板一直卡在 `initial` 值上，`opacity` 恒为 0，**弹层等于没出现**。首访向导是自动弹的——浏览器恢复会话时在后台标签页开着 Avery，正是这个场景，三家外部方一人踩一次就是「打开就白屏」。
所以基座加了一道：文档不可见时 `initial={false}`（不放进场动画、一上来就是终态），可见时才走动画。正常路径零影响。

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

**三条硬约定，不照做会踩坑：**

1. **调用方常驻挂载，用 `open` 开关。** 别在父层写 `{cond ? <MyModal/> : null}`——那样组件被直接摘掉，出场动画没机会跑。`Lite2App.tsx` 已按这个改：两个弹层现在都是无条件 `<DetailOverlay />` / `<OnboardWizard />`，开合判定收进各自组件里。
2. **面板由基座渲染**（`role=dialog` + `aria-modal` + `tabIndex=-1` 焦点容器 + `.lite-modal-panel`）。你只给内容和一个外观类，**别再自己套一层背景/卡片外壳**，也别自己挂 Escape 监听。
3. **`open` 从 true→false 后 children 还会渲染约一帧出场时长。** 若内容来自会被清空的 store 字段（如 `store.detail`），要留一份「最后一帧」快照，否则关闭瞬间面板闪空。`DetailOverlay.tsx` 有现成写法（`lastRef`）可抄。

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

门相位（nudgeVerdict D 组）按 `.lite-onboard[data-onboard-step]` / `.lite-onboard-playbook[data-playbook-id]` / `.lite-onboard-summary-item[data-playbook-id]` 断言——**三个选择器全部原样保留**。`.lite-onboard` 现在是基座的面板类，`data-onboard-step` 经 `panelData` 下发（浏览器实测确认 `data-onboard-step="upload"` 在位）。
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
- **出场后的 DOM 卸载未观测到。** 同一原因：帧循环停摆时 `AnimatePresence` 的 exit 跑不完，退出中的节点会滞留 DOM。**副作用（滚动锁释放、焦点归还）不受影响**——它们挂在 `open` 翻转时的 effect cleanup 上，立即执行，实测确认。真浏览器（帧循环正常）里 exit 跑完即卸载。
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
