# progress · feat-058 · 应用内草稿框（PRD G6 · Danny 点名）

工作树 `D:\avery-wt\058` · 分支 `feat/058-draft-composer`
合流基点 main `8be4ab4` → 已并入 Look 定名后的 main `5dce4f3`（合并提交 `1c95588`）

> 🔴 **这份文档是接管者重写的。** 上一轮 workflow 在实现阶段被杀，留下 `wip(058)` 提交
> `6886b96`（commit message 自己写明「未跑 typecheck/build/lint，未经复核」），其中也包含一份
> **没跑过任何门就写好的 progress-feat-058.md**。那份文档已被本文件整体替换：它的验收表里
> 有我无法复现的读数、还写着 `?skin=paper`（Look 定名前的旧词）。**下面每一条都是我自己重跑
> 出来的**，命令与输出照贴。

---

## 一、接手的那份 WIP：哪些对、哪些错

先说结论：**骨架是对的，可以用；但它有 4 处实打实的缺陷，全部已修**。

### 对的部分（核实后保留）

| WIP 的做法 | 核实结论 |
|---|---|
| `DraftComposer.tsx` 用 feat-052 的 `LiteModal` 基座，不自己写背景/Esc/滚动锁 | ✅ 正确。实测 `.lite-modal-panel.lite-draft-card` 命中 1 个，背景/Esc/滚动锁全由基座提供 |
| 常驻挂在 `Lite2App`，不在父层条件挂载 | ✅ 正确，出场动画能跑；且只在既有弹层挂载区**末尾追加一行**，`Routes` / `SCREEN_PATH` 一个字没动 |
| 单独开 `draftStore.ts` 而不是塞进 `flowStore` | ✅ 判断正确。`flowStore` 每个字段都在写盘清单里，草稿混进去 = 半截未发的消息跨会话复活 |
| `DraftCompletion` 三态（`add` / `complete` / `none`） | ✅ 正确，且是防重复条目的关键。实测队列条目开的草稿点「完成」后队列**没有**长出重复条目 |
| 「最后一帧」快照（`lastRef`）避免关闭瞬间闪空 | ✅ 与 `DetailOverlay` 同款写法，正确 |
| 补 `lite2.css` 里那个未闭合的 `}` | ✅ 修复本身正确且必要（见第三节），但**注释里的数字和结论是错的**，已改写 |
| 20 条 `draft*` i18n（en 源 + zh 手写定稿） | ✅ 键齐、typecheck 过；锁定词表未出现 |

### 错的部分（4 处，我改了）

**① `handleDone` 在主题为空时静默丢正文** —— `src/lite2/DraftComposer.tsx`

WIP 原文：

```js
const title = subject.trim() || body.trim().split('\n')[0]
addFollowup({
  title,
  note: subject.trim() ? body.trim() || undefined : undefined,   // ← 主题一空，note 恒为 undefined
})
```

主题被 manager 清空时，`title` 只取正文**首行**，`note` 直接是 `undefined` —— 他刚编辑完的整段
正文除第一行外**全部丢掉**，屏上却照样报「已写进你的跟进队列。」。这是静默丢数据。
改成：`note` 恒等于整份正文，只在它与 `title` 逐字相同时省掉（避免同一句话在条目上印两遍）。

**② CSS 引用了一个全仓不存在的令牌** —— `src/lite2/styles/lite2.css`

WIP 状态行写的是 `color: var(--lite2-sage-deep, var(--ink-soft))`。全仓 grep：
`--lite2-sage-deep` **只有这一处引用，两张皮里都没有定义** —— 兜底恒生效，写了等于没写。
真令牌是 `--lite2-accent-deep-rgb`（本文件既有「已办」字样同款，paper/aurora 都有定义）。
改用它之后浏览器实测拿到 paper `rgb(74, 96, 78)` / aurora `rgb(47, 75, 176)`，两张皮都真的变色。

**③ 复制失败和复制成功同色** —— 同一行字、同一个位置，颜色是唯一能一眼分开成败的信号。
加了 `data-tone="fail"` + danger 色，实测失败态 `rgb(160, 74, 58)`，与成功态 `rgb(74, 96, 78)` 不同。

**④ 正文里混进一句写死的英文** —— `src/lite2/draftLinks.ts`

WIP 的正文是 `[handoff.evidence, '', '(' + handoff.evidenceTag + ')']`。
而 `evidenceTag` 是 `teamData.ts:127` 里写死的字面量 `'From your uploads'`，**从未进过 i18n 表**。
后果：`lang=zh` 下 manager 复制到微信发出去的，是一句中文消息尾巴上挂着英文括号。
（这个 tag 在改造前从没在界面上露过面 —— WIP 是第一个把它渲染出来的地方。）

修法不是去翻译它，而是**从正文里拿掉**：出处是给 manager 看的来源标注，不是要发给同事的消息
内容，收件人收到「（来自你的上传）」只会莫名其妙。弹层已有常驻的 `draftBodyHint` 说明来源。

**另外还改了一处小的**：mailto 次出口在空草稿时仍然亮着可点（另两个出口已禁用），
且 `draft` 为空时 `href` 兜底写的是 `'#'`（会往 router 历史里塞一条空导航）。
改成 `aria-disabled` + 拦截点击 + 兜底 `'mailto:'`，并补了对应的灰态样式。

---

## 二、这条 feature 本身做了什么

「起草消息」原本是一条**裸 `mailto:` 链接**（两处入口：`TeamScreen` 分诊卡 + `FollowupsScreen`
队列条目）—— 点一下人就被甩进系统邮件客户端，manager 连 Avery 写了什么都没看见，而国内团队
根本不在邮件里干活。现在两处都改成开一个**应用内草稿框**（收件人 + 主题 + 正文）。

| # | 她的（`action-modal.tsx` / 人卡「发消息」） | 我们的 |
|---|---|---|
| 1 | 只读预览弹层 | 应用内草稿框（同形状） |
| 2 | 正文**只读** | 🟢 **正文 + 主题都可编辑** —— 正文是从真数据派生的草稿，不可编辑等于不可用 |
| 3 | 邮件 / 聊天应用 / 完成 三个平级出口 | 🟢 **「复制到聊天应用」升为主出口**（实心主键），mailto 降为次出口（描边次键） |
| 4 | 「加入待办」只弹 toast、**不落库** | 🟢 **「完成」真写进 `flowStore`**（localStorage，刷新仍在） |
| 5 | — | 🟢 **复制失败如实报失败**并给手动办法，绝不静默假装成功 |

### 诚实约束（逐条落地）

- 🔴 **收件人是人名，不是邮箱**。花名册里从来只有姓名，捏造地址比不填更危险 → mailto 的 `To`
  恒为空，弹层里明说（`draftRecipientHint`）。队列条目没有人的指向 → 显诚实空态，**不猜**。
- 🔴 **零假数据**：正文 = 该条目的真证据（`teamData.liveHandoffs()` 的真派生）。刻意不套
  「你好 X，最近……」问候模板 —— 那种静态样板会看起来像 Avery 替你写的私人信。
- 🔴 无假延迟、无 canned 成功态。锁定词表（Nexus / 现实差距 / 指挥室）未出现，全 DOM 实测。
- 中文直接定稿，未标「待审」（AGENTS.md act-first）。

---

## 三、⚠️ 越界改的那一个右花括号（范围外，但不补本条没法验收）

`src/lite2/styles/lite2.css` 里 `@media (prefers-reduced-motion: reduce)` **在 main 上从未闭合**。
我自己复核的数字（去掉注释后计花括号）：

```
$ python  # 剥掉 /* */ 注释后计数
8be4ab4（合流基点）    open 470  close 469
5dce4f3（当前 main）   open 470  close 469     ← main 现在仍然是坏的
本分支修复后            open 489  close 489
```

🔴 **它不会让 build 变红，这正是它能活到今天的原因**。实测 esbuild 只报 **warning**，然后在
EOF 处替你自动闭合，产物照出、exit 0：

```
$ node -e "esbuild.build({entryPoints:['<8be4ab4 版 lite2.css>']})"
▲ [WARNING] Expected "}" to go with "{" [css-syntax-error]
  The unbalanced "{" is here:  base.css:3418:40  @media (prefers-reduced-motion: reduce) {
1 warning
Done in 819ms          ← 构建成功
```

**所以「三门全绿」并不能证明这段 CSS 是对的。** 真实后果在渲染面：从那行往下的**每一条规则**
—— feat-053 的整套账号入口样式，加上 feat-058 追加在文件末尾的草稿框样式 —— 全被闷在那条媒体
查询里，**只有开了「减少动态效果」的用户才拿得到样式**，其余人看到的是一个完全裸奔的弹层。

补一个 `}` 让它们回到顶层。修复后 build 的 css-syntax-error 消失（下方有命令），浏览器实测
`prefers-reduced-motion: false` 下草稿框样式全部生效（`padding-top: 22px` / `border: 1px` /
paper `radius 8px` vs aurora `radius 10px`）。

**这是本条唯一越界的改动，且是被迫的。合并风险见第六节。**

---

## 四、改了哪些文件

**新增**（来自 WIP，已逐行核实）
- `src/lite2/DraftComposer.tsx` —— 弹层本体（常驻挂在壳层）。
- `src/lite2/draftStore.ts` —— 草稿开合 + 编辑态。

**改动**
- `src/lite2/draftLinks.ts` —— 职责从「造一条链接」变成「造一份草稿」：`LiteDraft` /
  `DraftCompletion` / `draftFromHandoff` / `draftFromFollowup` / `mailtoForDraft`（用**当前**
  主题正文实时重算，不是开框那一刻的快照）/ `clipboardTextForDraft`。
  旧的 `draftMailForHandoff` / `draftMailForFollowup` 已被取代（全仓 grep 确认零残留引用）。
- `src/lite2/screens/TeamScreen.tsx` —— 分诊卡 `<a href=mailto>` → `<button onClick=openDraft>`。
- `src/lite2/screens/FollowupsScreen.tsx` —— 队列条目同上。
- `src/lite2/Lite2App.tsx` —— 弹层挂载区**末尾追加一行** `<DraftComposer />`。
- `src/shared/i18n/en.ts` / `zh.ts` —— lite2 段**末尾追加** 20 条 `draft*`。
- `src/lite2/styles/lite2.css` —— **文件末尾追加**草稿框样式 + 第三节那个 `}`。

**本轮（接管后）实际动的三个文件**：`DraftComposer.tsx` · `draftLinks.ts` · `styles/lite2.css`。

---

## 五、验收怎么过的（真起浏览器，非读代码）

起 dev server（端口 5058，`npx vite --port 5058 --strictPort`），用 **`?transport=stub`**
（DEV-only 确定性传输，生产构建被 DCE，不打任何后端）驱动 headless Chromium（Playwright，
仓库已装，**未新装任何包**）。**收工已停服，端口确认释放**（见文末）。

### 三门（在 `D:\avery-wt\058` 下跑，最终状态）

```
$ npm run typecheck
> tsc -b
（零输出零错）

$ npm run build
✓ built in 5.21s
（只剩 chunk >500kB 的既有体积提示；css-syntax-error 已消失）

$ npm run build 2>&1 | grep -i 'css-syntax|Expected "}"'
no css syntax warning

$ npm run lint
✖ 5 problems (0 errors, 5 warnings)
（5 条 warning 全是既有文件的失效 eslint-disable 注释：OnboardWizard / RoomScreen /
 story/useRailCamera，非本条引入，基线即如此）
```

**后端一行未改 → 没跑 pytest，也不声称跑过。** 前端无单测框架（package.json 无 test 脚本），没装。

### 浏览器实测：40 项断言 × 两张 Look，全绿

驱动脚本跑完整流程（进入 → 跳过首访向导 → 真 `<input>` 上传 → 分诊卡开框 → 改正文 → 复制 →
完成 → Esc → 整页 reload → 队列屏开框 → 完成 → 点背景关）。两次运行：

```
$ node verify058.mjs paper     → look paper  failed []  total 40
$ node verify058.mjs aurora    → look aurora failed []  total 40
```

逐条对到验收标准（贴真实读数）：

| 验收项 | 实测结果 |
|---|---|
| 点「起草消息」**弹应用内框**、不再跳系统邮件 | 两处入口 DOM 均为 `BUTTON` 且 `getAttribute('href') === null`；点击后 `.lite-draft-card` 可见，`.lite-modal-panel.lite-draft-card` 命中 1 个（确实走基座）；`noExternalNavigation: []`（全程零外跳） |
| **能改正文** | `bodyPrefilled: "Vendor quote for store fixtures is still…"`（真 handoff 派生）→ 真键入 → `bodyEdited: true`；主题 `readOnly=false disabled=false` |
| **复制成功且有明确反馈** | `navigator.clipboard.readText()` 真读回：`"Take a look at Pilot Launch — Hangzhou Store\r\n\r\nVendor quote…改一句我自己的话"` —— 主题 + 空行 + **改过的正文**都在。状态行「已复制——去你们平时说话的地方粘贴就行。」（`role=status aria-live=polite`），按钮改字「已复制」 |
| 改字后旧的「已复制」不留在屏上 | 复制后再改一次正文 → 状态行清空（剪贴板里躺的是旧版本，那句话已不成立） |
| **复制失败如实报失败**（单独脚本，把两条复制路径都打断） | `text: "没能写进剪贴板——请手动选中上面的正文复制。"` / `tone: "fail"` / `color: rgb(160,74,58)`（≠ 成功态 `rgb(74,96,78)`）/ 按钮**仍是**「复制到聊天应用」**没有谎报**「已复制」 |
| **点「完成」跟进队列真多一条，刷新仍在** | localStorage `lite2:flow:v1` `0 → 1`；条目 `note` 含**改过的正文**（`"…改一句我自己的话再改"`）。**整页 reload 后** `/followups` 上 `queueSurvivesReload: 1`，标题 `"Take a look at Pilot Launch — Hangzhou Store"` 在 DOM 里渲染出来 |
| 队列条目开的草稿不产生重复条目 | 按钮是「完成 · 这条已办」；点击后 `completeDidNotDuplicate: 1 -> 1`，该条 `done: true` |
| **mailto 次出口仍可用** | `href` = `mailto:?subject=Take%20a%20loo…`，`mailtoToIsEmpty: true`（🔴 To 恒空），`mailtoCarriesEdit: true`（带的是**编辑后**内容）。未点击（会拉起真邮件客户端），只断言 href |
| **Esc 能关、滚动锁正确加解** | 开框后 `body.style.overflow === "hidden"`；Esc → 弹层从 DOM 消失、`overflow` 回到开框前的 `""` |
| **点背景能关** | 点 `.lite-modal-backdrop` 的**角落**（`{x:4,y:4}`）→ 弹层消失。<br>⚠️ 记录一个测试陷阱：背景中心被居中面板盖住，默认的中心点击会打在面板上、什么也证明不了 —— 第一版脚本就是这么假红的 |
| **入口直链五参数不丢** | `?v=2&mode=live&look=<paper\|aurora>&lang=zh&transport=stub`：开框后、全程结束时均 `v=2&mode=live&look=…&lang=zh&transport=stub` 一字不差。另跑一条**站内导航**验证：点弹层里的「去跟进队列」→ `/team?…` → `/followups?v=2&mode=live&look=aurora&lang=zh&transport=stub`，五参数全在、`data-look` 仍是 aurora、滚动锁已解 |
| **两张 Look 都正常** | `data-look` 各自正确；样式确实生效：`padding-top 22px` / `border 1px`；**radius 随皮变** paper `8px` / aurora `10px`（aurora 覆盖了 `--radius`）；状态行 paper `rgb(74,96,78)` / aurora `rgb(47,75,176)` —— **零 `[data-look]` 分支，全靠令牌** |
| 页面异常 | 全程 `pageerror` 监听零命中 |
| 锁定词表 | 整壳 innerText 实测无 `Nexus` / `现实差距` / `指挥室` |
| 未翻译英文不进正文 | `noUntranslatedProvenanceTag: true`（修 ④ 后的回归断言） |

> **关于剪贴板的诚实说明**：以上是 Chromium 授予 `clipboard-read/write` 权限后的**真 API 往返**
> （写进去、再 `readText()` 读回来），不是打桩。但它是 headless 浏览器的剪贴板，**不等于**
> 在真机上按 Ctrl+V 粘进微信 —— 那一步我没法在本环境观察，不声称验过。

---

## 六、遗留 / Notes（**没有顺手修**，留给集成方与后续线）

1. 🔴 **`lite2.css` 那个 `}` 是合并冲突面**。main（`5dce4f3`）目前**仍然是坏的**。
   若 055/057 也各自补了这一个 `}`，合流时**只能留一个** —— 两个会反过来多闭合一层，
   把后面的规则整段扔到顶层之外。冲突就在 `@media (prefers-reduced-motion: reduce)` 那一块。
2. **建议把 esbuild 的 css-syntax-error 提成硬门**。现在它只是 warning、build 照样 exit 0，
   等于这类错误可以一路合进 main 并静默吃掉整段样式 —— 本条就是这么发现的，而且它已经在
   main 上活了至少一波（feat-053 的账号入口样式一直被闷着）。
3. **`teamData.ts:127` 的 `evidenceTag: 'From your uploads'` 是写死的英文，不在 i18n 表里。**
   我只是不让它进草稿正文，**没有去修它**。`gapDerive.ts:55` 有同样的一处。
   若将来别的界面要显示出处，得先把它 i18n 化。
4. **入口按钮类名仍叫 `lite-triage-draftmail` / `lite-followup-mail`**（"mail" 已名不副实 ——
   主出口现在是聊天应用）。i18n 的 `triageDraftMailLabel` / `followupsDraftMail` 两个 key 同理
   （值「起草消息」仍然准确，只有 key 名带 mail）。**都没改**：纯改名要碰 CSS 里别的线也在动的
   选择器块，不值这个冲突面。后续做样式统一时一起改。
5. **重复条目的边界**：同一张分诊卡「关掉草稿框 → 再开 → 再点完成」可以加出第二条。
   `wroteToQueue` 只在一次开框内防重。**这与 `TeamScreen` 既有的「加入跟进」按钮行为一致**
   （它的 `addedFollowupIds` 也是组件本地 state，刷新即失忆），所以我没单独为草稿框造一套
   跨会话去重 —— 那应该是 `flowStore` 层统一解决的事。
6. **不改人卡「发消息」入口**：我们的人卡浮层（`DetailOverlay`）本来就没有这个按钮，她那边有。
   凭空加一个入口属于新增交互，不在本条切分里。
7. **草稿不持久化**：关掉就没了（理由见 `draftStore.ts` 顶注）。若产品要「草稿箱」，是另一条 feature。
8. **首访 onboarding 向导可能和草稿框同时开着**。行为正确（Esc 只关栈顶，滚动锁引用计数），仅记录。

---

## 七、停服与端口

```
$ netstat -ano | grep ":5058"
  TCP    127.0.0.1:5058    0.0.0.0:0    LISTENING    1868
$ taskkill //F //PID 1868
成功: 已终止 PID 为 1868 的进程。
$ netstat -ano | grep ":5058.*LISTENING"
（无输出 —— 端口已释放）
```

验证脚本写在 session scratchpad（`verify058.mjs` / `verify058-copyfail.mjs` /
`verify058-nav.mjs`），**未入库**；`dist/` 已被 `.gitignore` 覆盖，未提交任何构建产物。
