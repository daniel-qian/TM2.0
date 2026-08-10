# #83 回执 · 对话侧栏上皮肤 + 开场块居中（2026-08-10）

> 票：[#83](https://github.com/daniel-qian/avery/issues/83)｜设计正源：`design-plan.md` §2.2 + §2.3（Danny 0810 已审过·全部通过）
> 原型：`proto/room.html` + `proto/_shell.css`｜改动全部是**纯前端**（零后端字节、零迁移）
> 分支 `claude/fervent-kalam-95e0f0`｜🔴 **未 push**（前端 push 即自动上产）

---

## 1 · 改了什么（对着 §1.1 的四条病根逐条销账）

| 病根（0810 真机量到的） | 改法 | 落点 |
|---|---|---|
| ① 栏读成一张**浮在页面上的白卡片**：底色 `rgb(255,253,248)` 比暖纸画布更亮；上沿从 96px 起、下沿停在 780px，上下各一道悬空截断边 | 底色翻成 `rgba(--lite2-ink-rgb, .035)`（**下陷**不是凸起）+ `top:0; bottom:0` 贴边通到底 | `lite2.css` #83 段 `.lite-room-aside` |
| ② 一场占两行 ≈ 85px，1440×900 只装得下 9 场 | 行收成**单行 34px** / `padding:0 10px` / `radius 8px` | `.lite-room-aside .lite-room-history-head` |
| ③ meta 行几乎全是噪声（9 场里 8 场逐字相同的「单独问过一次」） | 轮数**只在 >1 时**才渲染；`roomHistoryEmptyThread` 从 zh/en 两份字典删掉 | `RoomScreen.tsx` + `zh.ts` / `en.ts` |
| ④ 每行三个对齐点，列表没有稳定竖轴 | 时刻从静息态撤掉，hover/focus 时**替补**出现（与轮数 pill 占同一个位置） | `.lite-room-history-date` / `-turns` |
| ⑤ 开场块钉在滚动口顶端，底下拖着 ~700px 虚无 | 在「顶栏以下、composer 以上」那块矩形里垂直居中 | `.lite-room-board[data-room-turns='0']` |

附带（规格 §2.2 逐条）：「新对话」并入行的节奏（accent 文字色、**不做实底**）· 选中 = `rgba(accent,.13)` +
**2px accent 左封条** + 600 字重 · 组标 11px/700/`--ink-soft` · 栏宽 **264 不动**。

**≤860**：栏退化为**贴左抽屉** + 遮罩，开关钮挪到左上角当把手（`data-history-toggle` 一个字节没动）。

## 2 · 两条硬约束怎么守住的

### ⒜ composer 几何一个字节没动

开场块居中是给 **board** 加 `justify-content`，**不碰** `.nexus-followup-composer` 与 `--lite2-room-aside-w`。
新门 A⑫ 判据落在「`.lite-room-board` **不含** composer」上——那是「把 composer 一起收进来居中」
（方案期原型第一版的原病）唯一的结构性可观测形态。room-claude-rework 的「发问零跳变」原样绿。

### ⒝ 三个 data 抓手全留

`data-history-thread` / `data-history-turns` / `data-history-toggle` 属性一个没动，撤掉的只是**可见文本**。
新门 A⑬ 正面钉这一条（属性没了，room-threads 那三处 driver 会**超时抛错让整份门 crash 而不是变红**）。

## 3 · 门账 —— **A 36/36 · B 非像素 2/2 · C 3/3 · 像素 8 passed**

电池跑了**两轮**：第一轮在 `main = 8d621b1` 的基线上（A **35/35**，A 区 34 → 35 道）；
合进 #86 之后**整轮复跑**（A **36/36**，34 → 36 道）。下表是**合并后**那一轮的数。

| 项 | 结果 |
|---|---|
| `npm run typecheck` | 绿 |
| `css-brace-check` / `css-scope-check` | 15 个 CSS 文件配平 · lite2.css 选择器全 scoped |
| `i18n-orphans`（只读） | 1035 叶子键 · 孤儿 **0**（删 1 个 + 加 1 个，净持平） |
| 电池 **A 区** | **36/36 绿**（含本票的 `room-rail` 与 #86 的 `archive-empty` 两道新门） |
| 电池 **B 区**（非像素） | `data-boundary` **37/37** · `null-owner` **15 PASS · 0 FAIL** |
| 电池 **C 区** | **3/3 绿**；跑完按纪律重打带 `VITE_AVERY_API_BASE` 的 dist，浏览器里验过 `apiBase === http://127.0.0.1:8283` |
| 像素 | 见 §5 |
| 后端 | 本票**零改动**（`git diff 8d621b1..#83 的两个提交` 里没有任何 `.py` / `service/`；合并带进来的后端字节全是 #86 的） |

⚠ 合并之后按纪律**按端口杀掉重起了 uvicorn**（#86 加了 `/team/{id}/empty` 新路由，它不热重载
——不重起的话 `archive-empty` 会以「一发请求都没有」的形态假红）。

**没有一条既有判据被改判。** 三道最相关的门原样绿：

- `verify-room-claude-rework` **59 PASS · 0 FAIL** —— ②「发问零跳变」（composer 的 x/y/宽在第一问
  前后逐像素相同）与「开场块随第一问退场」都过。
- `verify-room-threads` **55 PASS · 0 FAIL** —— 5 条属性判据 + 3 处 driver 点击锚零改判
  （撤掉的只是可见文本）。
- `verify-contrast-smalltext` **39 PASS · 0 FAIL** —— 新的 accent 文字色（「新对话」）与组标
  在两张皮上都过 AA。

新门 `verify-room-rail.mjs`：**41 PASS · 0 FAIL**（世界 A 桌面 1280×900 / 世界 B 手机 390×844）。

## 4 · 变异台账 —— **12 条全红**，逐条明细见 `_px83/mutations.md`

新门 `verify-room-rail.mjs` 的每一条主判据各配一条**专属**变异（M-A…M-L），逐条独立跑
（apply → `vite build` → 跑门 → revert）。锚点先过 `anchor-check.py`：**每条必须恰好命中 1 处**
——0 处命中在跑器输出里长得跟「变异存活」一模一样，第一版 12 条里 11 条就是这么 ANCHOR-MISS 的
（锚点写 `\n` 而两个源文件整份是 CRLF）。

🔴 **第一轮有 2 条活了下来，两条都是门洞不是代码 bug**：

| | 变异 | 为什么活下来 | 门怎么补的 |
|---|---|---|---|
| **M-C** | 会话行改回两行式（`flex-direction: column`） | A⑤ 当时只量行高 `[30,40]`，而两行式在「时刻已撤、单轮场无 pill」之后**恰好收成 40px**，正落在尺子里 | 补一条**正面判据**：轮数 pill 的竖向中线必须落在标题的竖向跨度里（并排＝真单行），上界收到 36。重跑 **39/2 红** |
| **M-F** | 选中行的 `::before` 封条关掉（`content: none`） | `getComputedStyle(el, '::before')` 对一个**根本没生成**的伪元素照样把规则里写的 `width`/`background` 原样吐回来——判据读到的仍是 `2px` + accent-deep，屏上封条却整条消失 | `content` 一起判（`none` 与整条规则被删时的 `normal` 两种都判死）。重跑 **40/1 红** |

两条新碑：**尺子太宽 = 对着真违规也全绿**；**伪元素的计算值不证明它上了屏**。

⚠ M-J（抽屉沉到遮罩之下）的红形态是**门跑到一半 crash**（汇总行没打印，靠逐条标记计数才看得出）
——那条变异真的把抽屉做成了点不动的，driver 点会话行必然超时。红得准，但形态是崩不是红。

## 5 · 像素 —— **净漂移恰好 4 张，与代价账逐字对上**

在**主检出 `D:\avery`** 跑（worktree 里冻＝白冻：基线目录是 gitignore 的每树一份产物），
`VERIFY_BASE` 指向本 worktree 的 preview 5283。

1. **先干跑一次不带 `--update`**：`4 failed · 4 passed`。四条失败逐个报的快照名是
   `{aurora,paper}-room-data-{desktop,mobile}` ——**没有第五张**。
   ⚠ 这个清单之所以可信，是因为 `room` 在 `SCREENS` 里排**最后**：一个 test 串着跑 N 次
   `toHaveScreenshot`、首处不匹配即中止，所以「停在 room」本身就证明 home/team/projects
   （含手机那张 `home-gaps-data-mobile` 专拍）全都匹配上了。
2. **重冻**：`--update-snapshots` → `8 passed`，日志里 4 行 `is re-generated, writing actual`。
3. **前后 md5 整行 diff**（哈希在前，**不做任何 `sed` 裁剪**——`sed 's|.*/||'` 是贪婪的，
   会把哈希一起吃掉，让全表 diff 退化成只比文件名的空判）：

```
18,19c18,19
< ad3248d272cedcec7c844a2fa04d07db *aurora-room-data-desktop.png
< 66501c902d58a8ac3714e0111be895af *aurora-room-data-mobile.png
---
> a4071e1eb2f349fbe03f155519ec426e *aurora-room-data-desktop.png
> 70e19465c0e716ac289f71816331af57 *aurora-room-data-mobile.png
45,46c45,46
< 7e2f38fe17eb0bdca66cc93a2a3c9398 *paper-room-data-desktop.png
< fed5739585161ae0f3c77fd5d72648a5 *paper-room-data-mobile.png
---
> 4761a0c398c62f4d08194338cdbd008c *paper-room-data-desktop.png
> 32ba24708b196c0d11303f236d35e37d *paper-room-data-mobile.png
```

**54 张里变了 4 张**，其余 50 张哈希逐字不变。
🔴 `visual.spec` 的 room 4 张（无材料态）**一张没漂**——侧栏与开场块都挂在
`contextId !== null` 那一支里，无材料态压根不渲染它们。

⚠ **重冻前先验过基线没被别的线动过**：重冻开工前把 54 张的 md5 存了一份，与我 40 分钟前
存的那一份 `diff` 为空（另一条线此刻没在跑 visual）。

🔴 **重冻与 main 的对账（这一段是本票最容易被下一个人误读的地方）**：重冻发生时本地 main 还停在
`8d621b1`；重冻**之后**另一条线把 **#86「清空这份档案」** 落进了 main（`89f45c2`），于是
「基线 = #83 的界面 / main = 没有 #83」一度成立。**本票没有把这个错位留给下一个人**：
- 先在本 worktree `git merge main`（唯一冲突是 `run-battery.mjs` 的 ROSTER——两条线各加了一行，
  **两条都留**，A 区 34 → 36 道）；
- 合完按纪律**按端口杀掉重起 uvicorn**（#86 加了 `/team/{id}/empty` 新路由，它不热重载）+
  重打 dist 并在浏览器里验 apiBase；
- **A 区全量复跑**（含两道新门）+ **像素复验**（合完之后那 4 张仍然匹配，见下）；
- 最后把 `claude/fervent-kalam-95e0f0` **fast-forward 进本地 main**（仍未 push）。

合并之后的像素复验：**8 passed**，54 张 md5 与重冻后那份**逐行完全相同**（#86 是零渲染改动，
按构造不漂——这一跑是把「按构造」换成「量到过」）。

所以收尾状态是：**基线、main、这棵 worktree 三者一致**。

## 6 · 人眼过（改完布局必截图人眼过，桌面 + 390×844 各一轮）

Browser pane 截图在本机是已知超时病，全部走本地 Playwright 直拍
（`_px83/shot.mjs`，钟钉死 + `route` 拦 `GET /advise-threads` 吐一份手写的 12 场载荷 ——
拍的仍是真组件真 CSS 真 React 树，被替换的只有网络那一层；上传是真的，因为侧栏挂在
`contextId !== null` 那一支里）。

| 图 | 看到什么 |
|---|---|
| `_px83/before/paper-desktop-aside-threads.png` | 病根现场：白卡片 + 上下两道截断边 · 一场两行 · 9 场里 8 场「单独问过一次」· 开场块钉在顶端、底下 ~700px 虚无 |
| `_px83/after/paper-desktop-aside-threads.png` | 同一份数据：**同屏 12 场**（原来 9 场）· 栏下陷贴边通到底 · 开场块居中 |
| `_px83/after/paper-desktop-aside-current.png` | 选中态：accent 软底 + 2px 左封条 + 600 字重；指针停在该行上，所以时刻替补出现了（正是设计的 hover 行为） |
| `_px83/after/aurora-desktop-aside-threads.png` | 另一张皮：栏读成一列更冷更暗的面，accent 跟着 aurora 的蓝走 |
| `_px83/after/paper-mobile-aside-threads.png` | 390×844 收起态：抽屉把手在左上角，开场块在把手与 composer 之间居中 |
| `_px83/after/paper-mobile-drawer-open.png` | 390×844 展开态：**不透明**抽屉贴左通到底 + 遮罩压暗正文（半透明版在原型阶段真长出过「正文从字缝里透出来」） |

另外两张探针的产出（不入库，命令见 §7）：
- `probe.mjs` 实测**包含块归属**：`.scene.is-active` 的 `transform: matrix(1,0,0,1,0,0)` 虽是单位阵
  却不是 `none`，390×844 上一个 `position:fixed;top:0` 的探针落在 **y=64**（scene 顶）而不是视口 0
  ——所以抽屉一律用 `absolute`。同时确认议事室手机态**文档不滚**
  （`scrollHeight === clientHeight === 844`），absolute 的抽屉不会被滚走。
- `vpmatrix.mjs` 跑了 11 个视口 × zh/en 共 22 个点，量「开场块有没有被居中顶到 board 内容盒**上方**」
  （flex 居中在自由空间为负时会朝两头同时溢出，那会把开场块顶进顶栏底下）。
  **22 个点 `overflowUp` 全部 ≤ 0**，没有一处溢出——因为 `min-height:100%` 是地板不是天花板，
  内容更高时 board 自己长高、自由空间不会变负。

## 7 · 环境与跑法（复现用）

```
后端: cd eval-harness && AVERY_BRAIN=mock AVERY_EXTRACTOR=heuristic AVERY_EMBEDDINGS=keyword \
      AVERY_DEMO_SEED_DIR=tests/fixtures/demo-seed AVERY_PUBLIC_BASE=http://127.0.0.1:8283 \
      AVERY_CORS_ORIGINS=http://localhost:5283,http://127.0.0.1:5283 \
      python -m uvicorn service.app:app --host 127.0.0.1 --port 8283 --app-dir .
前端: VITE_AVERY_API_BASE=http://127.0.0.1:8283 npx vite build --mode development
      npx vite preview --port 5283 --host
门:   VERIFY_BASE=http://127.0.0.1:5283 VERIFY_API=http://127.0.0.1:8283 \
      node eval-harness/tools/run-battery.mjs --only=A   （再 --only=B / --only=C）
新门: VERIFY_BASE=http://127.0.0.1:5283 node eval-harness/tools/verify-room-rail.mjs
变异: python .issues/design-0810/_px83/anchor-check.py    # 先自查锚点，每条必须恰好 1
      python .issues/design-0810/_px83/mutate.py          # 不带参数=全跑；也可 mutate.py M-A M-I
像素: cd /d/avery && VERIFY_BASE=http://127.0.0.1:5283 npx playwright test -c eval-harness/visual
      🔴 这一行的 `cd /d/avery` 不是装饰——在 worktree 里冻＝白冻（基线是每 worktree 一份的 gitignore 产物）
手拍: VERIFY_BASE=http://127.0.0.1:5283 node .issues/design-0810/_px83/shot.mjs <outDir>
探针: VERIFY_BASE=http://127.0.0.1:5283 node .issues/design-0810/_px83/probe.mjs        # 包含块归属
      VERIFY_BASE=http://127.0.0.1:5283 node .issues/design-0810/_px83/styleprobe.mjs   # 规格计算值
```

## 8 · 刻意留下的账 / 顺手发现没顺手修

- 🔴 **`i18n-zh*.mjs` 那一族全是写文件的**，本票的两处字典改动（删 `roomHistoryEmptyThread`、
  加 `roomHistoryScrimAria`）一律**手工 Edit**，只跑了只读的 `i18n-orphans.mjs`。
- ⚠ **极短视口（高 ≤ ~667）下开场块会被顶栏压住一点**：`vpmatrix.mjs` 实测
  `en 880×640` 与 `zh/en 390×667` 三个点的 `clearsBand` 是负的。
  **这不是本票造出来的**——board 的总高度（padding + 内容）在改动前后**逐像素相同**
  （手机那 44px 让位只是从 `.lite-room-welcome` 的 padding 挪到了空态 board 的 padding），
  自由空间为负时 `min-height:100%` 与 `justify-content:center` 都不生效，渲染与改造前一致。
  真病根是滚动口在这些高度上本来就装不下开场块。要修属独立小票。
- ⚠ **hover 才现身的时刻从此逃出 `verify-contrast-smalltext` 的采样面**（它跳过 `display:none`）。
  颜色仍是那道门点名的小字安全色 `--ink-soft`，但「它被采过样」这句话不再成立。
  新门 B⑦ 在抽屉里补了同源尺子，桌面静息态那条没补——静息态它本来就不占墨。
- ⚠ **`.lite-room-aside` 的 `bottom:0` 让栏的底色盖到常驻合规页脚的左段上**（页脚 z30 < 栏 z44）。
  页脚里**没有任何可点控件**（`Lite2Footer` 只有一个 `<p>`），且 3.5% 的墨色压根遮不住字，
  所以既不劫持点击也不影响可读性。但这条依赖「页脚永远没有链接」——哪天给页脚加了链接，
  记得回来看一眼这里。
- ⚠ **`--lite2-bottom-band` 仍是幽灵 token**（全文件无赋值，消费点全走 `var(…, 120px)` 兜底）；
  **`--lite2-clear-top` 的 ≤860 覆盖仍写了两遍**（早段 72px 被后段 24px 静默架空）。本票没动。
- ⚠ **抽屉开关钮仍是文字钮**（「历史对话 · N 场」），不是原型里那枚汉堡 icon。
  规格只要求「开关钮继承 `data-history-toggle`」，icon 化会牵出 aria-label 新键 + icon 族一致性，
  留给「全应用 icon 统一」那张 carry-over 票。
- **会话改名 / 删除**按 #80 拍板仍未做；**侧栏 20 场硬上限**（端点不透传 limit）未动。
- ⚠ 本票给行加了 `outline-offset:-2px` 的**内描边**焦点环（画在行自己身上，结构上不会被
  `overflow-y:auto` 裁掉），顺手退掉了 #80 那份「负外边距 + 同量内边距」的绕法。
  焦点环颜色走既有的 `--lite2-sky-rgb`，不新开色阶。
