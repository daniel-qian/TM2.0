# recon-composer — composer（输入框）视觉现代化 + icon 体系（只读侦察，0808 新一轮）

> 任务背景：Danny 原话「输入框设计不够现代化，输入/附件按钮 icon 不好看」。本文件是「别重新侦察」级现状盘点。
> 行号采于本地 main@2c95946（2026-08-09，#79 已合入）。行号会漂：定位一律 `grep -n '<锚文本>' <file>`。
> 前情正源：`recon-room.md`（#75 前的旧行号**大面积作废**，几何结论已被 #75 改写）· `receipt-75-room-claude.md`（docked 三态统一/`[data-composer-*]` 抓手/textarea 化）· `receipt-78-threads.md` · `receipt-79-copy-sweep.md`（54 张像素口径）。
> **本文零改动建议之外的裁定；所有「应当」句只是侦察员意见，供排票。**

---

## 0 · 一句话现状

composer 部件只有一个（`AskRefComposer.tsx`，644 行），两个宿主（议事室 docked / 悬浮胶囊）；**发送钮是文字钮**（房内「提问」、胶囊 unicode `'→'`），**附件钮是手绘回形针 SVG**，**全仓没有任何 icon 库**——lite2 的全部图形 = 3 个手绘 SVG + 6 种 unicode 字形。容器静息态是 **999px 全圆 pill**（55-ask-composer 冻结基座继承来的），多行长高后变成「体育场」形；Claude 式的圆角矩形容器、accent 实底箭头发送钮、左置加号附件钮——三样都没有。

---

## 1 · composer 现状全解剖

### 1.1 部件与宿主

| 层 | 文件:行 | 说明 |
|---|---|---|
| 共用部件 | `src/lite2/AskRefComposer.tsx`（全 644 行） | @ 弹层/chips/附件/停止/发送/IME 全在这一个 form 里 |
| 议事室宿主 | `src/lite2/screens/RoomScreen.tsx:248-304`（`LiteAskComposer` 包装）+ 挂载 :876-892 | formClassName=`nexus-followup-composer`，`.lite-room` 直接子元素（结构纪律 :810-818） |
| 胶囊宿主 | `src/lite2/AskAveryLauncher.tsx:101-114`（展开态）/ :116-124（收起 pill） | formClassName=`lite-ask-avery-form`；#75 起提交=**即发**（:87-96） |

### 1.2 form 内 DOM 序（AskRefComposer.tsx:399-622，一字不差）

```
<form data-ask-refs class="{formClassName}[ has-refs][ is-picking]">   ← :397 静息态类名逐字节纪律
  [@ 弹层 .lite-ref-picker]                 :407-470（menuOpen 才渲染）
  [引用 chips 行 .lite-ref-chips]           :472-494（refs>0 才渲染）
  [附件预览行 .lite-attachment-row]         :498-521（#73）
  [附件报错 <p data-attachment-error>]      :524-528
  <textarea data-composer-input>            :530-561（rows=1，combobox aria 四件套）
  [附件钮 <button data-composer-attach>]    :566-577（onAttach 才有；type="button"）
  [停止钮 <button data-composer-stop>]      :580-590（onStop && busy 才有；type="button"）
  <button type="submit" data-composer-send> :592-605（恒在）
  [隐藏 <input type=file data-composer-file>] :611-621（🔴 必须垫底，:52-56 snippet F2 裸 input 子句）
</form>
```

视觉排布：桌面单行 `[textarea][📎附件][停止][提问]`（无 CSS order 重排，DOM 序即视觉序；附件行/报错行用 `order:-2/-1` 提到顶，lite2.css:8969/9009）。**附件钮在 textarea 右侧、发送钮左边**——不是 Claude 的「附件在最左」。

### 1.3 每个按钮的 icon 是怎么画的（逐个）

| 按钮 | 视觉 | 画法 | 位置 |
|---|---|---|---|
| 发送（议事室） | 文字「提问」 | **纯文字钮**：`submitLabel={t.nexus.ask}`（RoomScreen:881；zh.ts:333「提问」/ en.ts:218 'Ask'）；类 `lite-btn lite-btn--primary`（RoomScreen:283）＝墨底 pill；**没传 submitAriaLabel**，可及名=可见文字 | AskRefComposer:592-605 |
| 发送（胶囊） | unicode `'→'` | 文字字形当 icon：`submitLabel={'→'}`（AskAveryLauncher:107），36×36 圆钮（lite2.css:6825-6834，font-size:16 就是在调这个箭头字）；aria=`askAveryAria` | 同上 |
| 附件 | 回形针 | **手绘 SVG**：`PaperclipIcon`（AskRefComposer:627-643，16×16 viewBox，单 path fill=currentColor，aria-hidden + focusable=false + 显式宽高避 sweep D6c 零尺寸判据）；壳 `lite-btn lite-btn--ghost lite-composer-attach`＝34px 圆（lite2.css:8932-8936） | :566-577 |
| 停止 | 文字「停止」 | 纯文字钮：`stopLabel={l.roomStopLabel}`（zh:1198/en:1584）；`lite-btn--ghost lite-composer-stop`＝danger 描边 pill（lite2.css:8948-8958，「打断不是危险操作，只借色不借实底」碑） | :580-590 |
| chip/附件移除 | 字符 `×` | 裸文本字形（:489、:515；AskCard.tsx:159 同款），类 `.lite-composer-remove`（lite2.css:8800-8809），aria 走 `composerRemoveRefAria` | — |
| 胶囊收起 pill | 火花 ✦ | 手绘 SVG `SparkIcon`（AskAveryLauncher:34-50，16×16 双四角星 path）+ 文字「问 Avery」 | :116-124 |

### 1.4 容器样式：谁在供圆角/边框/阴影/focus

- **冻结基座** `src/shared/styles/55-ask-composer.css:3-17`（story 资产，一像素不许改）：`.nexus-followup-composer{ position:absolute; border-radius:999px; padding:6px; border:1px solid var(--rule); background:rgba(255,253,248,.92); box-shadow:var(--shadow); backdrop-filter:blur(12px) }`。focus 态 `:focus-within{ border-color:var(--ink) }`（:39-41）——**唯一的 focus 视觉**，无 ring/无 glow。
- **lite2 覆盖**：背景令牌化 `rgba(var(--lite2-surface-rgb),.92)`（lite2.css:3293-3295）；#75 dock 几何（lite2.css:8843-8852）：`width:var(--lite2-room-col); bottom:calc(var(--lite2-footer-h,56px)+var(--lite2-room-composer-gap)); display:flex; flex-wrap:wrap; align-items:end; gap:8px`。三个语义 token 在 :8830-8840：`--lite2-room-col: min(828px, 100vw-48)` / `--lite2-room-composer-gap:12px` / `--lite2-room-dock-clear:168px`（估值不是实测，room-usability 是真裁判，:8836-8839 注释）。
- 🔴 **圆角三态**：静息=999px（基座继承，lite2 从未覆盖）；`has-refs`/`is-picking` → **18px**（lite2.css:8649-8655）；**多行长高但无 chip 时仍是 999px**——168px 高的 textarea 撑起后容器是全圆端「体育场」形，这正是「不现代」观感的一个具体病灶（Claude 是恒定 ~16-24px 圆角矩形）。
- textarea 本体（lite2.css:8901-8917）：`flex:1 1 240px; max-height:168px`（🔴 与 AskRefComposer.tsx:106 `TEXTAREA_MAX_HEIGHT` **双份同步义务**）`; resize:none; background:transparent; border:0; outline:none; padding:6px 0; line-height:1.5`；自动长高在 :261-266（先归零再量 scrollHeight，layout effect）。
- **≤860 手机**（lite2.css:9115-9139）：col=100vw-32、dock-clear 148；textarea `flex:1 1 100%` 独占一行 + `.lite-composer-attach{margin-left:auto}` 控件行靠右——#75 人眼过修的「发送钮被挤到第二行左下角」。

### 1.5 两宿主差异（同一部件两张脸）

| 项 | 议事室 docked | 胶囊 |
|---|---|---|
| 定位 | absolute 锚 `.lite-room`，居中 828px，bottom=footer+12（lite2.css:8228-8233/8843-8845） | fixed 屏底中央 z45（:6751-6761），form `min(420px,100vw-32)`（:6794-6805） |
| 边框 | `var(--rule)`（基座） | `var(--rule-strong)`（:6801） |
| 输入 | textarea 多行长高 | 同一 textarea 但 `.lite-ask-avery-input{height:36px}`（:6807-6818）——**胶囊里 inline height 自动长高照跑，CSS height:36 与之打架（读码推断，实测按 css-containing-block-must-probe 纪律）** |
| 发送 | 「提问」文字 pill | `'→'` 36×36 圆钮（:6825-6834） |
| 附件/停止 | 有（room 传了 onAttach/onStop） | **无**（AskAveryLauncher 没传，:101-114） |
| 展开动效 | 无 | 入场 keyframe 0.22s（:6842-6858，reduce-motion 包裹） |

### 1.6 各态视觉

- **busy（上一轮在跑）**：发送钮 `disabled`（AskRefComposer:602，`busy||空文本`，无值给 undefined——静息 DOM 纪律）→ `.lite-btn:disabled{opacity:.55}`（lite2.css:6140-6143）；停止钮**出现**（onStop&&busy）；textarea **仍可打字**（room-claude-rework :177 `editable` 判据钉着「生成中可预打字」）。
- **附件上传中**：attachBusy → 附件钮 disabled `opacity:.45`（:8938-8941）；pill 虚线边框（:8996-9000，「不转圈——转圈在这儿是撒谎」碑）；failed=danger 边+字（:9002-9005）；批级报错行内 `<p data-attachment-error>`（:9007-9013）。
- **发送钮 hover**：`--lite2-ink-hover`（:6157-6159）；焦点环全族统一 `outline:2px solid rgba(var(--lite2-sky-rgb),.9)`（:6146-6149）。
- ⚠ 读码推断（未实测）：同一行里附件/停止钮高 34px（:8922-8930）而发送钮只有 `.lite-btn` 的 min-height 26px + padding 4/12（:6120-6135；基座 55-ask-composer.css:44 的 min-height:38 被 (0,2,0) 压掉、min-width:64 幸存）——**发送钮矮于旁边两枚钮**，`align-items:end` 下底对齐、顶不齐。改版做「等高控件行」时顺手核实。

### 1.7 键位与提交（改 icon 不许动的行为面）

Enter 发送 / Shift+Enter 换行（:362-366；🔴 键位本身是判据保护对象——at-references 的裸 Enter 探针被 ⑨ 段 7 入口复用，:356-360 注释）；IME 合成让行（:327-329，composingRef+isComposing 并集）；提交双闸=disabled 主闸 + handler 兜底（:370-380）；@ 层开着 Enter 归选中（:339-343）。

---

## 2 · 全应用 icon 现状盘点

### 2.1 手绘 SVG（lite2 全量 4 处，两种画风已不一致）

| # | 图形 | 文件:行 | 画风 |
|---|---|---|---|
| 1 | 火花（胶囊） | AskAveryLauncher.tsx:34-50 | 16×16 viewBox，**fill** 单 path，currentColor |
| 2 | 回形针（附件） | AskRefComposer.tsx:627-643 | 16×16 viewBox，**fill** 单 path，currentColor |
| 3 | 铃铛 | LiteBell.tsx:84-98 | **24 viewBox + stroke 1.8 round**（feather/lucide 风），渲染 16×16 |
| 4 | 项目进度环 | DetailOverlay.tsx:856-886 | 数据图形（56px 双 circle），不算 icon |

fill 派（1/2）与 stroke 派（3）**并存**——新 icon 体系要先拍板一种。三个都守了 sweep D6c 纪律：aria-hidden + focusable=false + 显式 width/height（:33、:626 注释明写）。story 壳另有 SVG（SvgEdgeLayer/HomeScene ink-check/NexusScene）——冻结资产，不碰。

### 2.2 unicode 字形当 icon（6 种字形，散布 15+ 处）

| 字形 | 语义 | 站点 |
|---|---|---|
| `×` | 移除 | AskRefComposer:489,515 · AskCard.tsx:159 |
| `→` | 发送/去向 | AskAveryLauncher:107（**发送钮本体**）· RoomScreen:917（nomaterial CTA 后缀）· OnboardGate:168 · HomeScreen:813；另有字典值内嵌（如 notesNudge 族） |
| `↗` | 跳议事室 | DetailOverlay:540,824 · HomeScreen:633,828,1133 · ProjectsScreen:258 · TeamScreen:153（7 处） |
| `▴`/`▾` | 抽屉开合 | HomeScreen:686,781,865,1125 |
| `⚙` | 设置 | LiteTopbar.tsx:221（aria-hidden span；:210 注释「⚙ 是标点级字形，zh-purity 扫的是字母」） |
| `✦`(SVG) | 品牌火花 | 见 2.1 |

⚙/▾/× 这类字形跨字体渲染不一致（Windows/安卓字号基线各异），是「icon 不好看」的另一半病根。

### 2.3 依赖快照：零 icon 库

`package.json:13-21` dependencies 全量：supabase-js / framer-motion / react / react-dom / react-router-dom / react-zoom-pan-pinch / zustand。**没有任何 icon 包**；全 src `grep phosphor|lucide|heroicons|react-icons|feather` 零命中。

### 2.4 若引 @phosphor-icons/react（设计技能首选）的 bundle 账

- v2 是 per-icon ESM 模块、tree-shakeable，只打包 import 到的 icon；每个 icon 组件含 6 个 weight 的 path（regular/bold/duotone…），单枚 raw ~3-6KB、gzip <1.5KB。
- composer+全应用换血按 ~10-12 枚估（paperclip/arrow-up/stop/x/plus/gear/bell/caret-down/arrow-up-right/sparkle…）：**增量约 raw 30-60KB / gzip 8-15KB**——对本仓已有 framer-motion(~100KB+) 的 bundle 是零头量级。
- **零依赖替代**有先例背书：#75 markdown 渲染拍的就是「零新依赖」（receipt-75 §做了什么）；照 SparkIcon/PaperclipIcon 模式手绘一套 16×16 内联组件（可直接从 Phosphor/Lucide 的 SVG path 抄形），成本=画风统一纪律（统一 stroke 1.8 round 24 viewBox 或统一 fill 16 viewBox），换来的是不进 node_modules、不担 supply-chain。两条路都通，属拍板项。

---

## 3 · 对照 Claude 式 composer（实现规格底稿）

| Claude 形态 | 我们的对应物 | 差距 |
|---|---|---|
| 圆角矩形容器（恒定 ~16-24px 圆角，1px 边框，柔影，focus 时边框/环变亮） | 999px pill（静息）/18px（交互态）三态跳（§1.4）；focus 只有 border 变墨（55-ask-composer:39-41） | **容器形状要收敛成恒定圆角**；focus 态可做 accent ring |
| 双行布局：上=textarea 全宽，下=控件行（左附件/工具，右发送） | 单行 flex-wrap（桌面 textarea 与钮同行；≤860 才两行且是被动换行） | **桌面也无控件行**；做双行=改 form 内 DOM（门射程见 §4.5） |
| 附件钮：加号/回形针 icon、最左 | 回形针 SVG 但在 textarea **右侧** | 位置反；icon 本体已有 |
| 发送钮：**icon 钮**（上箭头 ↑），accent 实底圆角方/圆，disabled=灰化 | 文字钮「提问」墨实底 pill；disabled=opacity .55 | **icon 化 + accent 底是主刀口**；aria 义务见 §4.2 |
| 停止钮：发送钮原位变身（方块 stop icon，同一格） | 独立文字 pill「停止」danger 描边，与发送钮**并存**（发送灰着、停止亮着） | 形态不同；「并存 + type=button」是门锚（AskRefComposer:160-162），原位变身要连门改 |
| 多行长高 + 封顶内滚 | **有**（168px 封顶，:261-266） | 已对齐 |
| Enter 发送 / Shift+Enter 换行 / IME 让行 | **有**（#75） | 已对齐 |
| 生成中可预打字 | **有**（textarea 不灰，room-claude-rework :177 钉着） | 已对齐 |
| placeholder「Reply to Claude…」式短句 | 「向 Avery 提问…」（zh.ts:1438）/胶囊「向 Avery 问一句关于团队的事…」（zh.ts:975） | 文案已对齐（#79） |
| 字号/行高 | textarea 继承皮肤基准（paper 16/aurora 15，look-*.css）+ line-height 1.5 | 大体对齐；Claude 正文 ~15-16px 同量级 |

---

## 4 · 门与判据射程（改 icon/改布局各会撞什么）

### 4.1 verify-button-family（白名单）

白名单 `WHITELIST`（verify-button-family.mjs:48-75）钉的 composer 类：`.lite-composer-filter / .lite-composer-option / .lite-composer-remove`（:53）。审计逻辑（:77-90）：`.lite2-shell` 下每枚可见 button 要么 classList 含 `lite-btn`、要么 matches 白名单。**附件/停止/发送三钮都挂着 `.lite-btn` 族**（AskRefComposer:569,583 + submitClassName）→ icon 化**不需要动白名单**，只要新钮继续挂 `.lite-btn`。若新增无壳 icon 钮（如 toolbar 里的裸图标钮）不挂 .lite-btn，必进 naked 名单红门。

### 4.2 verify-aria-zh（硬门）+ 一个门够不着的暗区

- 采样面=页面全部 `[aria-label]/[title]/[alt]` 的**值**（verify-aria-zh.mjs:83-85）；尺子 `suspiciousLatin`（:98）=「≥2 连续拉丁词或单个 ≥4 字母词」。
- 现状：附件钮 aria=「上传文件一起问」（zh:1200）✓；停止 aria=「停止本次生成」（zh:1199）✓；胶囊发送 aria=`askAveryAria`「向 Avery 提问」✓；**议事室发送钮没有 aria-label**（LiteAskComposer 没传 submitAriaLabel，可及名=可见文字「提问」）。
- 🔴 **暗区**：发送钮 icon 化后若忘给 aria-label，它成了无名钮——**aria-zh 只扫「已存在的属性值」，扫不到「该有而没有」**，一道门都不会红。icon 化发送钮必须同批传 `submitAriaLabel`（纯中文），这条要靠自觉+新门判据，不能指望现有门。

### 4.3 contrast 门（verify-contrast-smalltext）

全叶子文本扫描（AUDIT_FN 只看 `innerText` 的元素，小字 <18.66px 判 4.5:1）。两个事实：① 现「提问」文字钮（13px/600）墨底暖白字被它盯着；② **icon-only 钮没有 innerText，整枚逃出采样面**——发送钮换成 accent 实底 + 白 icon 后，对比度（icon 与底、底与页面）**没有任何门看着**。参考：aurora accent #496ee8 上白色 ~4.6:1（贴线过）、paper accent sage #69806d 上白色 ~3.9:1（**低于 4.5**，好在 icon 属图形对 AA 只需 3:1）——非文本对比 3:1 口径两皮都过，但要写进新门判据才算数。

### 4.4 verify-room-claude-rework（46 判据）里锚按钮的部分

全部锚在 `[data-composer-*]` 与结构上，**零条锚在按钮可见文字**：① 结构组（:86-144：全树 `.nexus-followup-composer` 恰 1、`.lite-room` 直接子、board 外、`button[type="submit"]` count==1、input 是 TEXTAREA）；③ 停止组（:175-227：生成中停止钮在场/中断后收起/`.lite-flow-stopped` 说明块/HUD 负向针「分析完成」:213）；⑧ 附件组（:328-343）。→ **换按钮 label/icon 不红这道门；动 form 内 DOM 结构（如包 toolbar div）也不红**（判据是 count 与祖先关系，不是子序）——但「停止钮并存且 type=button」“submit 恒 1”两条是硬约束，「发送钮原位变身停止钮」那种 Claude 式做法要连 :143-144/:179/:227 一起改判。

### 4.5 [data-composer-*] 抓手现状（改 DOM 的合同面）

契约声明在 AskRefComposer.tsx:43-56 头注。消费方全录：
- `verify-at-references.mjs`:139-140,161,170,202,364,398,440,574-575（`.lite-room .nexus-followup-composer [data-composer-input]` + 胶囊 `.lite-ask-avery-form [data-composer-input]` + `[data-composer-send]`）；⑧ pickerGeom 三宿主×视口矩阵 :433-510（1280×900 / 900×600 / 胶囊 900×340 钳制位）——锚的是 **form 整体 rect**，form 内部再包一层 div 不影响。
- `verify-room-conversation.mjs`:65-66；`verify-room-threads.mjs`:100；`verify-room-claude-rework.mjs`:79-81。
- `scripts/gates/live-frontend-gate.snippet.js`（**`*verify-*.mjs` glob 暗区**）:666,703（F1/F2 选择器，`[data-composer-input]` 打头 + 裸 `textarea, input[type="text"]` 兜底子句仍在——file input 垫底纪律因此不能破）:1809-1812,2221-2224,2656-2657。
- 胶囊收起 pill 锚 `.lite-ask-avery-pill`（at-references:360-362 count==1 + click）。

### 4.6 其它在射程内的门

- `verify-room-usability.mjs`:166-181：滚到底 board 末子下沿 ≤ composer 上沿（`--lite2-room-dock-clear` 的真裁判）——composer 改高（双行布局会更高）这条会红，改 token 值即可。
- `verify-bottom-furniture-clearance` / `verify-topbar-clearance`：hit-test 结果判据，改完重跑即可。
- sweep D6c：新 SVG 必须显式 width/height（零尺寸判据）。
- `verify-switchers`/`verify-restart-09`：只碰皮肤名文本，不在本刀口。

---

## 5 · 像素射程（54 张里 composer 在哪几张）

54 张 = `visual.spec.mjs` 36 张 fresh-context 空态（9 屏×2 皮×2 视口；room 4 张=**无材料态，无 composer**，但有「去添加材料 →」CTA）+ `visual-data.spec.mjs` 18 张数据态（SCREENS=['home','team','projects','room']，visual-data.spec.mjs:56 + home-gaps-data mobile 2 张）。

| 改动 | 必漂 | 说明 |
|---|---|---|
| 议事室 composer（发送/附件/停止/容器） | **room-data 4 张**（`{aurora,paper}-room-data-{desktop,mobile}`） | #79 新增的这一态=有材料+零轮次，docked composer 静息态入画（含「提问」字样与回形针）；BR-1/BR-2 已实证 4 张的作用面（receipt-79 §4.4） |
| 胶囊（SparkIcon/pill/`→`） | **数据态 14 张**（home-data 4 + team-data 4 + projects-data 4 + home-gaps-data 2） | 像素里胶囊是**收起 pill**（#75 实证，receipt-75 §2）——换 pill 上的火花/文字漂 14 张；**展开态（`→` 圆钮）零像素覆盖** |
| `⚙` 设置/铃铛 SVG（顶栏族） | **54 张全漂** | 顶栏在每张里（#79 先例：tab 改名 50 张全漂） |
| `→`/`↗`/`▾` 字形换 icon | 按屏散漂 | nomaterial CTA `→` 在 room 空态 4 张；`↗` 在 team/projects/home 空态+数据态多张 |
| @ 弹层 / chips / 附件行 / 停止态 / 多行长高 | **零像素覆盖** | 全是交互态，54 张都采不到——视觉证据只能手拍（#75 是 26 张、#78 是 20 张的先例） |

重冻纪律照 #79：主检出真比对（先红后冻）→ md5 全表 diff（⚠ `sed 's|.*/||'` 贪婪吃哈希的坑已记档）→ born-red 按视口逐个验 → 逐张人眼过。

---

## 6 · 一致性锁材料（icon/按钮改版要锁进的既有体系）

### 6.1 圆角体系（lite2.css 实测分布）

| radius | 处数 | 用途 |
|---|---|---|
| **999px** | 71 | 按钮族基类（:6128）、chips、composer 静息、filter/kind 徽章 |
| `var(--radius)` | 27 | 卡/输入类；paper=8px（00-base :root）/ **aurora=10px**（look-aurora.css:51） |
| 14px | 9 | 浮层（@ 弹层 :8673、历史面板 :8306） |
| 8/10/12px | 各 6-16 | 杂项；@ 候选行 10px（:8723） |
| 18px | 1 | composer 交互态（:8654） |
| **aurora 分支** | — | `.lite-btn`→**9px**（look-aurora.css:398-402，「她的 rounded-[9px]」）、`.scene-tab`→9px（:306） |

🔴 关键事实：**aurora 皮下按钮已经不是 pill 而是 9px 圆角矩形**——「现代化=圆角矩形按钮」在 aurora 已成立一半，paper 仍守 999px。composer 容器若收敛圆角，天然候选是浮层的 14px / aurora 的 `--lite2-radius-lg:16px`（look-aurora.css:278，paper 无此 token、消费处走 `var(--lite2-radius-lg,16px)` 兜底）——**别再发明新数**。

### 6.2 accent 与按钮色

- `--lite2-accent-rgb`：paper=105,128,109（sage 绿，look-paper.css:57）/ aurora=73,110,232（蓝 #496ee8，look-aurora.css:79）；deep 变体各有。
- **primary 按钮不是 accent 是 `--ink` 实底**（:6152-6155「她的 navy 主按钮语法」）+ hover `--lite2-ink-hover`。发送钮做 accent 实底=**新增一种按钮色阶**，两皮都要过 3:1 图形对比（§4.3）；沿用 ink 实底+白 icon 则零新色。
- 引用 chip 已在用 accent 软底 `rgba(accent,.12)`（:8790）；focus 环统一 sky（:6146-6149）；danger 只给停止/删除（:8948 碑）。

### 6.3 icon 语言候选锚

既有三枚 SVG 的公约数：currentColor + aria-hidden + focusable=false + 显式宽高。画风分叉：铃铛=24 viewBox stroke 1.8 round（≈ Phosphor regular/Lucide 默认笔画语言），火花/回形针=16 viewBox fill。若引 Phosphor，铃铛风格就是现成锚点；若手绘统一，也应统一到一种 viewBox+笔画制式并把 `⚙▾×→↗` 全量字形一起收编（否则「SVG 新钮 + unicode 旧字形」半新不旧更难看）。

### 6.4 动效与密度

过渡统一 `var(--fast)`=180ms（00-base.css:18；.lite-btn :6136-6137）；胶囊展开 keyframe 0.22s 且包 reduce-motion（:6853-6858 先例，新动效照包）；按钮字 13px/600、胶囊 14px、皮肤基准 paper 16/aurora 15。

### 6.5 双份常数台账（改 composer 必查）

`TEXTAREA_MAX_HEIGHT` 168（AskRefComposer:106 ↔ lite2.css:8907）；`LIST_MAX_HEIGHT` 240（:99 ↔ :8713）；`PICKER_GAP` 8（:97 ↔ :8667/:8684）；`PICKER_CHROME` 64（:98，含筛选行 26——若弹层排版改密度要重算）。

### 6.6 顺手记的死规则/暗账（不改，只备案）

- `.lite2-shell .nexus-empty-composer input`（lite2.css:3297-3299）：宿主 `.nexus-empty-composer-wrap` 已随 #75 退役，**死规则**。
- 55-ask-composer.css 基座的 `.nexus-followup-composer input` 全族（:19-37）在 textarea 化后也是死的（v01 冻结壳仍在用，不能删）。
- 基座 `button{min-width:64px}`（55-ask-composer.css:44）无人覆盖，仍在给 docked 发送钮垫宽。
- 胶囊 `.lite-ask-avery-input{height:36px}` 与 textarea 自动长高的 inline height 关系未实测（§1.5）。

---

## 7 · 刀口切分建议（侦察员意见，仅供排票）

1. **icon 体系拍板**（先决）：Phosphor vs 手绘统一制式；fill vs stroke；`⚙▾×→↗` 收编范围（全收=54 张全重冻，只收 composer=room-data 4 张+胶囊 14 张）。
2. **composer 容器现代化**：圆角收敛（999→16px 级恒定值，含 has-refs 18px 一并统一）、focus 态、双行布局（textarea 行+控件行，附件左移）——撞 room-usability 让位判据与 room-data 4 张，`[data-composer-*]` 合同保住则行为门全绿。
3. **发送钮 icon 化**：↑ 箭头 icon + aria 义务（§4.2 暗区）+ 对比度判据入新门；停止钮是否原位变身要连 room-claude-rework :143/:179/:227 改判，**不动更省**（并存形态已有门背书）。
4. 胶囊 `'→'`/SparkIcon 与 docked 同批换，展开态零像素覆盖→手拍取证。
