# progress · feat-058 · 应用内草稿框（PRD G6 · Danny 点名）

工作树 `D:\avery-wt\058` · 分支 `feat/058-draft-composer` · 基线 main `8be4ab4`

---

## 做了什么

「起草消息」以前是一条**裸 `mailto:` 链接**（两处：分诊卡 + 跟进队列条目）——点一下人就被甩进
系统邮件客户端，manager 连 Avery 写了什么都没看见，而国内团队根本不在邮件里干活。现在两处
都改成开一个**应用内草稿框**（收件人 + 主题 + 正文），弹层基座用 feat-052 的 `LiteModal`。

### 对齐她的形状 + 四处超过她

| # | 她的（`action-modal.tsx` / 人卡「发消息」） | 我们的 |
|---|---|---|
| 1 | 只读预览弹层 | 应用内草稿框（同形状） |
| 2 | 正文**只读** | 🟢 **正文 + 主题都可编辑**——正文是从真数据派生的草稿，不可编辑等于不可用 |
| 3 | 邮件 / 聊天应用 / 完成 三个平级出口 | 🟢 **「复制到聊天应用」升为主出口**（实心主键），mailto 降为次出口（描边次键） |
| 4 | 「加入待办」只弹 toast、**不落库** | 🟢 **「完成」真写进 `flowStore`**（localStorage，刷新仍在） |
| 5 | — | 🟢 **复制失败如实报失败**并给手动办法，绝不静默假装成功 |

### 「完成」的三态（防重复条目）

写成显式三态 `DraftCompletion`，不靠「有没有 followupId」去猜：

- `add` —— 分诊卡开的草稿：队列里还没有这件事 → **新建一条**
- `complete` —— 队列条目开的草稿：**把那一条标已办**（再 addFollowup 会长出一条一模一样的重复条目）
- `none` —— 来源那条**早就办完了**：不渲染完成按钮（复制/邮件仍在，消息该发还是要发）

### 诚实约束（继承的红线，逐条落地）

- 🔴 **收件人是人名，不是邮箱**。花名册里从来只有姓名，捏造地址比不填更危险 →
  mailto 的 `To` 恒为空，弹层里**明说这件事**（`draftRecipientHint`），不让空收件人当场吓人一跳。
  队列条目没有人的指向 → 显诚实空态「文件里没写这条该发给谁」，**不猜**。
- 🔴 **零假数据**：正文 = 该条目的真证据 + 真出处标签（`teamData.liveHandoffs()` 的真派生）。
  **刻意不套「你好 X，最近……」的问候模板**——那种静态样板会看起来像 Avery 替你写的私人信。
- 🔴 无假延迟、无 canned 成功态：复制成功/失败都是真结果。
- 锁定词表未出现（无 Nexus / 现实差距 / 指挥室）。中文直接定稿，未标「待审」（AGENTS.md act-first）。

---

## 改了哪些文件

**新增**
- `src/lite2/DraftComposer.tsx` —— 弹层本体（常驻挂在壳层）。
- `src/lite2/draftStore.ts` —— 草稿开合 + 编辑态。**故意不放进 `flowStore`**：
  ① 草稿是纯瞬态的，flowStore 每个字段都在 persist 写盘清单里，混进去等于让一份半截未发的
  消息跨会话复活；② 本波多条线都在动 flowStore，另起一个文件把合并冲突面降到零。

**改动**
- `src/lite2/draftLinks.ts` —— 职责从「造一条链接」变成「造一份草稿」：`LiteDraft` /
  `DraftCompletion` / `draftFromHandoff` / `draftFromFollowup` / `mailtoForDraft`（用**当前**
  主题正文实时重算，不是开框那一刻的快照）/ `clipboardTextForDraft`。
  旧的 `draftMailForHandoff` / `draftMailForFollowup` 两个导出已被取代（调用点只有这两处）。
- `src/lite2/screens/TeamScreen.tsx` —— 分诊卡 `<a href=mailto>` → `<button onClick=openDraft>`。
- `src/lite2/screens/FollowupsScreen.tsx` —— 队列条目同上。
- `src/lite2/Lite2App.tsx` —— 挂 `<DraftComposer />`（**只在既有弹层挂载区末尾追加一行**，
  没动 `Routes` / `SCREEN_COMPONENT` / `SCREEN_PATH` 任何一处，055/057 的追加位零冲突）。
- `src/shared/i18n/en.ts` / `zh.ts` —— lite2 段**末尾追加** 20 条 `draft*`（en 是源，zh 手写定稿并
  在文件头按仓库惯例留了 provenance 注释）。
- `src/lite2/styles/lite2.css` —— **文件末尾追加**草稿框样式 + 见下方那条 ⚠️ 一行修复。

---

## ⚠️ 顺手补的一个右花括号（范围外，但不补本条没法验收）

`src/lite2/styles/lite2.css` 里 `@media (prefers-reduced-motion: reduce)`（feat-053 那波之后）
**从未闭合**——**HEAD 就是坏的**，不是我改出来的：

```
$ git show HEAD:src/lite2/styles/lite2.css | 数花括号
HEAD version: open=470 close=469
$ npm run build   # 修复前
▲ [WARNING] Expected "}" to go with "{" [css-syntax-error]
  The unbalanced "{" is here:  <stdin>:12970:40  @media (prefers-reduced-motion: reduce) {
```

后果：从那行往下的**每一条规则**——feat-053 整套账号入口样式 + 我追加在文件末尾的草稿框
样式——全被闷在那条媒体查询里，**只有开了「减少动态效果」的用户才生效**，其余人看到的是一个
没有任何样式的弹层。所以这一个 `}` 是本条 feature 能不能验收的前提，补了，并在原地写了注释。

修复后 build 的 css-syntax-error 消失；浏览器实测 `prefers-reduced-motion: false` 下我的样式
全部生效（见下方证据）。**合并提示**：若别的线也补了这个洞，冲突就在这一行，取任意一侧即可。

---

## 验收怎么过的（真跑，非读代码）

起了 dev server（端口 5058），`?transport=stub` 上确定性语料（16 人 2 项目 → 2 条分诊），
真事件驱动 + 真 DOM/localStorage 断言。**收工已停服，端口确认释放**（见最后一节）。

### 三门（在 `D:\avery-wt\058` 下跑）

```
$ npm run typecheck        # tsc -b —— 零输出零错
$ npm run lint             # ✖ 5 problems (0 errors, 5 warnings)
                           #   5 条 warning 全是既有文件的失效 eslint-disable 注释
                           #   （OnboardWizard / RoomScreen / story），非本条引入
$ npm run build            # ✓ built in 3.02s；修复后 css-syntax-error 已消失
```

后端一行未改 → **没跑 pytest，也不声称跑过**。项目无前端单测框架（package.json 无 test 脚本）。

### 逐条验收（每条贴真实读数）

| 验收项 | 结果 |
|---|---|
| 点「起草消息」**弹应用内框**、不再跳系统邮件 | 两处入口 DOM 实测均为 `{"tag":"BUTTON","href":null}`（不再有 `href=mailto:`）；点击后 `.lite-draft-card` 出现，`role=dialog` `aria-modal=true`，`data-draft-id="draft_lh_pr_pilot"`，收件人 chip `["Lin Qing"]`（由 `personIds` 真解析），主题/正文取自真 handoff |
| **能改正文** | 真 `input` 事件改成「老林，供应商那份报价还没签，麻烦今天推一下。」→ `bodyValue` 已更新；且 `mailtoReflectsEdit: true`（次出口跟着编辑走，不是旧快照） |
| **复制成功且有明确反馈** | 成功路径：`copiedText` = 主题 + 空行 + **改过的正文**；`status="copied"`，按钮改字「已复制」，状态行「已复制——去你们平时说话的地方粘贴就行。」（`aria-live=polite`）<br>🔴 **诚实说明**：无头 pane 里 `navigator.clipboard.writeText` 被拒（document 未聚焦）、`execCommand` 也失败，我先实测到**真失败路径**（`status="copyFailed"` + 「没能写进剪贴板——请手动选中上面的正文复制。」，按钮**不谎报成功**）；成功路径是**把 clipboard API 打桩成 resolve** 后验的（验的是我写的那段状态机与复制内容，**真实 OS 剪贴板写入本环境没能观察到**） |
| 改字后旧的「已复制」不留在屏上 | 复制后再改一次正文 → `status` 退回 `idle`、状态行清空、按钮字复原（剪贴板里躺的是旧版本，那句话已不成立） |
| **点「完成」跟进队列真多一条，刷新仍在** | 点前 `followupsBefore: 0` → 点后 localStorage `lite2:flow:v1` 真多一条：`{title:"Take a look at Pilot Launch — Hangzhou Store", source:"triage", dueGroup:"today", note:"老林，供应商那份报价还没签，麻烦今天推一下。谢了。", done:false}`（note = **改过的正文**）。按钮随即禁用（防重复），状态行「已写进你的跟进队列。」+ 冒出「去跟进队列」。**整页 reload 后** `/followups` 上 `itemCount: 1`、标题与 note 一字不差 |
| 队列条目开的草稿不产生重复条目 | 从队列条目开 → 按钮是「完成 · 这条已办」；点击后 `noDuplicateAdded: 1`（仍是 1 条），该条 `done:true` + 有 `doneAt` |
| 已办条目不给完成出口 | 已完成的条目再开草稿 → `hasDoneButton: false`，只剩「关闭 / 复制到聊天应用」+ mailto |
| **mailto 次出口仍可用** | `href` 为合法 mailto，`mailtoHasEmptyTo: true`（🔴 To 恒空），subject/body 为**编辑后**内容。未点击（会拉起真邮件客户端），只断言 href |
| **Esc 能关 + 只关栈顶** | 草稿与首访向导两层同开：Esc → `layers 2→1`，草稿关、**向导仍在**，滚动锁**仍锁**（引用计数正确）；再 Esc → `layers 0`、`body.style.overflow` 回 `""` |
| **点背景能关** | 点 `.lite-modal-backdrop` → `layers 0`、`draftPresent false`、`overflow` 回 `""` |
| 滚动锁加解正确 | 见上两行：多层同开只锁一次，最后一层关才还原 |
| **入口直链五参数不丢** | `/?v=2&mode=live&skin=paper&lang=zh&transport=stub` → 重定向到 `/team` 参数原样；reload、切屏、点「去跟进队列」（`goScreen`）后 `entryParamsKept: true` |
| 两张皮 | paper 下主键 `rgb(105,128,109)`、aurora 下 `rgb(73,110,232)`——只消费令牌，**零 `[data-skin]` 分支** |
| 控制台 | 全程 **0 error 0 warning**（只有 vite/React DevTools 的 info） |
| 样式确实生效（brace 修复的意义） | `prefersReducedMotion: false` 下实测：card `display:grid` / `width:620px` / 有 border+shadow，textarea `min-height:150px` `resize:vertical`，主键 sage 实心。**修复前这些在非 reduced-motion 下全部不生效** |

### 停服与端口

```
$ netstat -ano | grep :5058     # 停服后仍有 LISTENING 9932 → Stop-Process -Id 9932 -Force
$ netstat -ano | ... :5058      # port 5058 released
```

---

## 没做什么

- **Outlook / Google 日历深链**——PRD 明令不做（国内团队用不上）。
- **不改人卡「发消息」入口**：我们的人卡浮层（`DetailOverlay`）本来就没有这个按钮，
  她那边有。凭空加一个入口属于**新增交互**，不在本条切分里（记进 Notes 供 feat-016x 决策）。
- **草稿不持久化**：关掉就没了。理由见 `draftStore.ts` 顶注（半截未发的消息跨会话复活是坏事）。
  若产品要「草稿箱」，那是另一条 feature。
- 真实 OS 剪贴板写入未在本环境观察到（无头 pane 限制），见上表说明。

---

## 遗留 / Notes（**没有顺手修**，留给集成方与后续线）

1. **⚠️ 已修的那一个 `}`**：见上文。这是本条唯一越界的改动，且是被迫的（不补则本条不可验收）。
   合并冲突面 = 那一行。
2. **`src/lite2/styles/lite2.css` 的追加惯例正在制造这个坑**：feat-053 那波把整段样式直接
   `>>` 到文件尾，正好落进一个未闭合的 `@media` 里，谁都没发现（build 有 warning 但没人当错误看）。
   建议集成方**把 esbuild 的 css-syntax-error 提成硬门**（现在 build 打了 warning 仍 exit 0，
   等于这类错误可以一路合进 main）。
3. **入口按钮的类名还叫 `lite-triage-draftmail` / `lite-followup-mail`**（"mail" 已名不副实——
   现在主出口是聊天应用）。**没改**：改类名会碰 CSS 里别的线也在动的选择器块，纯改名不值这个
   冲突面。后续谁做样式统一时一起改。
4. **i18n 的 `triageDraftMailLabel` / `followupsDraftMail` 两个 key 同理**（值「起草消息」仍然准确，
   只有 key 名带 mail）。未改，同上。
5. 首访 onboarding 向导会和草稿框同时开着（stub 实测两层）。行为正确（Esc 只关栈顶），
   观感上没问题，仅记录。
