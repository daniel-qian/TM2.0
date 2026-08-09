# receipt-80-81 · 对话页会话侧栏 + composer 现代化（2026-08-09 · 0809 反馈批 · wave 4）

> 票：[#80 room-sidebar](https://github.com/daniel-qian/avery/issues/80) + [#81 composer-modern](https://github.com/daniel-qian/avery/issues/81)（同区捆一个 session 串行做）
> 侦察正源：`recon-sidebar.md` / `recon-composer.md`（同目录）。本文只记**实收**，与侦察不符处逐条订正。
> 分支 `claude/sharp-dirac-eedec3`，🔴 **未 push、未上产**。

## 一句话

议事室右上角那个「点开才有」的历史弹窗，变成了左侧**常显**的会话侧栏（按日分组 + 新对话 + 点击载入，手机 ≤860 收抽屉）；
composer 换成 Claude 式双行版式（恒定 16px 圆角 + Phosphor 图标 + ink 实底圆形发送钮）。
顺手**实测**推翻了两条一直被当成事实的读码推断，各自都是一个从没在屏上出现过的样式。

## 目录

1. 改了什么 · 2. 实测推翻的三条「事实」 · 3. 门连改与变异台账 · 4. 像素
5. 人眼过 · 6. 验证账 · 7. 环境与跑法 · 8. 刻意留下的账

---

## 1. 改了什么

### 1.1 #80 会话侧栏

| 件 | 落点 | 要点 |
|---|---|---|
| 侧栏 | `RoomScreen.tsx` `LiteRoomAside`（原 `LiteRoomHistory` 重写） | `.lite-room` 的**第四个 absolute 兄弟**；`data-history-thread/turns/toggle` 三属性族一个没丢 |
| 常显 | 无渲染门槛 | 零会话也在场——见 §2 为什么这不是审美问题 |
| 三态语义 | `adviseThreads === null` → 列表区**留白**；`[]` → 诚实空态一行 | null 是「还没拉/stub 通道」，不是「没问过」；合并成一句就是替后端撒谎 |
| 按日分组 | 新函数 `groupThreads` + `localDayIndex` | 纯前端、零后端；分组键取**场内最后一轮**（与服务端排序键同源）；「今天」那支判 `delta <= 0` 而不是 `=== 0`（服务器钟常比浏览器快一点，本机 Docker PG 有跳 115 秒的先例） |
| 新对话 | store 新 action `newConversation` | #78 纪律：自带 **busy 闸 + 幂等闸**，同步 run 尾轮镜像；顺手清 `noteJustAdded`（那条 nudge 属于刚被散掉的那场，这枚钮不换屏、没人替它兜） |
| 手机 ≤860 | 同一个节点换一副几何（抽屉浮层 + `data-history-toggle` 开关） | **不是第二棵 DOM**——两棵树的话，桌面视口上那棵隐藏副本的叶子仍会被 contrast 门采样（`innerText` 在未渲染子树里回落成 `textContent`，而它的渲染态自查只看元素自身的 display） |
| 让位 | `--lite2-room-aside-w: 264px`（**写死常量**） | 滚动口 `left`、内容列宽扣掉侧栏、composer 中线挪到 `calc(50% + w/2)`；**没有**新建主列容器（见 §1.3） |

**新 i18n 键 7 个**（zh+en 各 7，全程手工 Edit，一个 `scripts/i18n-zh*.mjs` 都没跑）：
`roomHistoryEmpty` / `roomHistoryToday` / `roomHistoryYesterday` / `roomHistoryEarlier` / `roomNewLabel` / `roomNewBusy` / `roomSendAria`。
只读的 `i18n-orphans` 跑了：**孤儿 0**。

### 1.2 #81 composer 现代化

| 病灶（recon 实测） | 落地 |
|---|---|
| 圆角三态跳（静息 999 全圆 → 多行长高成「体育场」形；has-refs/is-picking 18px） | 统一 `var(--lite2-radius-lg, 16px)`，**取既有体系不发明新数** |
| 发送=文字钮「提问」、胶囊里是 unicode `→` | 两个宿主都换成**同一枚** Phosphor `ArrowUp`；room 侧 34px ink 实底圆钮 |
| 附件=手绘回形针 SVG，与铃铛画风分叉 | Phosphor `Paperclip` |
| 停止=文字 pill | Phosphor `Stop`，icon-only，danger 描边（这次是**真的** danger，见 §2.1） |
| 桌面单行 `[textarea][📎][停止][提问]` 挤一条线 | Claude 式**双行**：正文占满上行，控件另起一行（附件靠左 / 停止+发送靠右） |
| focus 只有 `border-color: var(--ink)` | 补 sky 焦点环（走既有 6146 口径，不新开颜色） |

**icon 体系收在一处**：新文件 `src/lite2/icons.tsx` 是唯一入口，`WEIGHT='bold'` 与尺寸在那里定一次。
理由写在文件头：直接从包里 import 到组件，下一个人就会顺手换一个 weight，同一排按钮出现两种笔触——那正是要消灭的现象。
**统一范围只限对话页**：顶栏铃铛/齿轮/`↗`/`▾`/`×` 一律没碰（顶栏在 54 张基线的每一张里，动它＝全量重冻）。
**胶囊收起态 pill 一个像素没动**（手绘 SparkIcon + 文字原样）——像素数据态 14 张里胶囊全是收起 pill。

**新依赖**：`@phosphor-icons/react@2.1.10`（`package.json` + `package-lock.json` 各 1 处改动，lock +14 行）。
装法：在主检出 `D:\avery` 装（node_modules 是 worktree 共享的 junction），再把两个文件搬进 worktree、主检出 `git checkout` 还原。
**bundle 实测**：`Lite2App` chunk 243.50 kB → 253.48 kB（gzip 65.29 → 68.17）＝ **+9.98 kB raw / +2.88 kB gzip**。
⚠ 这是**整批前端改动**的合计（含侧栏与分组那一整块新代码），是 phosphor 自身开销的**上界**不是它的份额。

### 1.3 一条没破的结构纪律

侧栏化最自然的写法是把「滚动口 + composer」包进一个主列 div 再和 `<aside>` 并排。
**没这么做**：`.lite-room > .nexus-followup-composer` 那个 `>` 是 lite2.css 8228/8843 两处几何规则、外加
`room-claude-rework ①` / `at-references ⑧(e)` / `room-usability` 的共同承重位。包了那一刻 composer 会掉回
`55-ask-composer.css:3` 的 v01「左下角 440px 小浮标」。
落法是 `<aside>` / `.lite-room-scroll` / composer **三者都保持 `.lite-room` 的直接子元素**，只用 `left` 与 token 让位。

---

## 2. 实测推翻的三条「事实」

### 2.1 🔴 停止钮的 danger 描边**从来没在屏上出现过**（#75 起的存量 bug）

`lite2.css:8947` 写着「ghost 壳 + danger 描边」，选择器是 `.lite2-shell .lite-composer-stop`（0,2,0）。
它一直被 `.lite2-shell .lite-btn.lite-btn--ghost { color: var(--ink-soft); border-color: var(--rule) }`（0,3,0）压死。
浏览器实测：停止钮与附件钮的 `color` / `borderColor` / `backgroundColor` **逐字节相同**。

- 怎么发现的：⑩ 的对比度判据把 attach 与 stop 量出**逐字相同的 6.76 / 1**。两个本该不同族的钮量出同一个数，
  是「恰好如预期」的另一种形态——翻到 CSSOM 逐条列命中规则才见底。
- 一道门都没红过：纯呈现差异，而 icon-only 钮整枚逃出 contrast 门的采样面；连本票新加的 ⑩ 也放行
  （ink-soft 在 surface 上 6.76:1，本来就过 3:1 地板）。
- 修法：`.lite2-shell .lite-btn.lite-composer-stop`（0,3,0）。修完停止钮量出 **4.33**（danger），与附件的 6.76 分开了。

### 2.2 🔴 三枚控件的「34px 圆钮」也是假的

冻结基座 `55-ask-composer.css:43-44` 有一条 `.nexus-followup-composer button { min-width: 64px }`，**min-width 恒压过 width**。
于是 `lite2.css:8933` 那句 `.lite-composer-attach { width: 34px }` 自 #73 起就没生效过，屏上一直是 64px 宽的胶囊。
recon-composer §1.3 写的「34px 圆」是读码推断，**实测推翻**。
修法：给三枚 composer 钮 `min-width: 0`（不动基座——它是 story 冻结资产，v01 仍在用那套文字钮）。修完实测 34×34。

### 2.3 手机上「历史对话 · N 场」压在 h2 上

390×844 实拍逮到：抽屉开关是 absolute 右上角，而开场块 h2 起笔就在同一排高度，
「历史对话 · 1 场」比光秃秃的「历史对话」宽，正好压到标题末尾的 Avery 上。
这个重叠 #78 就存在，只是那时开关「有场才出」、碰上的概率低；#80 改成常显之后它变成常态，属本票刀口，就地结掉
（≤860 给开场块 `padding-top: 44px` 让位；不动 board 的 padding——对话起来之后内容是滚的，恒定顶距只是白吃竖向空间）。

---

## 3. 门连改与变异台账

### 3.1 连改三道门

| 门 | 改了什么 | 判据数 |
|---|---|---|
| `verify-room-threads` | driver **分形态**（`openHistory()`：可见才点）+ ⑫ 常显自证 4 条 + ⑬ 新对话 9 条 + ⑭ 两把锁 2 条 | 40 → **55** |
| `verify-room-claude-rework` | ⑨ icon-only 钮可及名 + 尺寸一致性 6 条 + ⑩ 图形对比度与 primary 一致性锁 7 条 | 46 → **59** |
| `verify-button-family` | 白名单 +`.lite-room-history-head`（列表项类目，同 `.lite-notes-group-head` 先例） | 12（数不变） |

🔴 **driver 分形态是必需品不是保险**：侧栏常显之后桌面没有 toggle 可点（CSS `display:none`），
裸 `.click()` 会一路等可见、等到超时**抛错**——整份门 crash、连汇总行都不打印。M-P 变异实证：
把 driver 改回裸点击，门在跑到第 21 条时崩掉、**没有任何一条 FAIL**。

### 3.2 变异台账（逐条**独立**跑：apply → vite build → 跑那道门 → revert）

跑器 `_px8081/mutate.py`，逐条日志 `_px8081/mutations.md`。

| # | 变异 | 门 | 结果 |
|---|---|---|---|
| M-H | 侧栏退回「有场才显」 | room-threads | **51/4** ⑫ 四条全红 |
| M-I | `newConversation` 不清 `threadId` | room-threads | **52/3**（含网络层那条） |
| M-J | 「新对话」钮去掉 `disabled` | room-threads | **54/1** ⑭a |
| M-K | store `newConversation` 去掉 busy 闸 | room-threads | **54/1** ⑭b |
| M-L | 发送钮忘传 `submitAriaLabel` | room-claude-rework | **56/1** ⑨（这正是票面点名的暗区） |
| M-M | 发送 icon 不传 `size` | room-claude-rework | 第一版 **57/0 活下来** → 改判据后 **57/2** |
| M-N | 发送钮换 accent 实底 | room-claude-rework | 第一版 **59/0 活下来** → 改变异+改判据后 **58/1** |
| M-O | button-family 白名单去掉侧栏行 | button-family | **11/1**（[room] 屏红） |
| M-P | room-threads driver 改回裸 toggle 点击 | room-threads | **CRASH**（21 条后中止，零 FAIL） |

**M-M 与 M-N 两条第一版都活下来了，两次的原因完全不同，都记在这儿**：

- **M-M（判据太宽）**：我原来写的是「svg 渲染尺寸 > 0」，理由是 sweep D6c 的「零尺寸 svg」。
  实测：Phosphor 的 `IconContext` 默认 `size` 是 **`1em` 而不是 undefined**——忘传 size 得到的不是 0×0，
  而是**跟着按钮字号走**的 13px，照样 >0。也就是「一族一个尺寸」那把锁被拆了而尺子看不见。
  改成两条：① 落在 14–22px 的 icon 区间里；② 同一排**逐像素相等**。M-M 立刻 2 红（`[17, 13]`）。
- **M-N（变异没碰到被判的性质）**：第一版把 `background` 写在 `.lite2-shell .lite-composer-send`（0,2,0）上，
  被 `.lite2-shell .lite-btn.lite-btn--primary`（6304，0,3,0）压死——探针实测发送钮底色**仍是 ink**。
  它「活下来」说明不了任何事。改成同样 (0,3,0) 的选择器才真换掉了实底。
  顺带**订正了我自己写错的一句碑**：原判据注释说「实底 vs 面 ≥3:1 就是『别用 accent』的机械化身」——不对。
  paper accent 实底量出 **4.18:1**（底 vs 面）与 **4.28:1**（白字形 vs 底），两条都过 3:1。
  票面那句「~3.9:1 过不了」说的是**正文 4.5:1** 的口径，而 icon-only 钮算图形、地板就是 3:1。
  真正看着「primary=ink 实底」这条拍板的，是新加的**一致性锁**：发送钮实底必须与本壳 primary 按钮族同色。

---

## 4. 像素

**54 张不变**（无新增基线），净漂移**恰好 4 张** = `{aurora,paper}-room-data-{desktop,mobile}`。

```
开工前 54 张 md5 → 真比对（4 红：room 是 SCREENS 最后一屏，home/team/projects/home-gaps 全过 = 漂移清单完整）
→ --update-snapshots → md5 全表 diff：恰好 4 张变 → 复跑 8 passed · 0 首写
→ 手机让位修完后再走一轮：2 张手机 room-data 再漂 → 重冻 → 复跑 8 passed
→ born-red 前后 md5 再比：54 张逐字节一致（变异没污染基线）
```

- `visual.spec` 的 room 4 张（contextId===null 无材料态）**一张没漂**——侧栏挂在 `contextId !== null` 那一支里。
- 其余 46 张没漂（不动共享家具：顶栏/页脚/胶囊收起 pill 全没碰）。
- ⚠ md5 全表 diff 用的是**完整行**（哈希在前），没走 `sed 's|.*/||'` 那条会把哈希一起吃掉的贪婪路子（#79 实收的坑）。

### born-red（按视口逐个验）

| # | 变异 | 桌面 | 手机 | 说明 |
|---|---|---|---|---|
| BR-1 | 侧栏宽 264 → 244 | **2 红** | 2 绿 | 🔴 **手机 room-data 对侧栏是瞎的**——≤860 侧栏是抽屉、`display:none`。这是本批像素覆盖的真实边界，不是缺陷 |
| BR-2 | composer 圆角 16 → 4 | 0 红 | 0 红 | **变异碰到了被判的性质，但尺子分辨不了**：`maxDiffPixels: 50` + 默认 `threshold`，12px 的圆角差全落在低对比边缘上。**「圆角恒定」这条主张在像素层没有覆盖**，靠 §5 人眼过 + 计算值探针兜 |
| BR-2b | 发送钮宽 34 → 68 | **2 红** | **2 红** | composer 控件行**两个视口都有覆盖** |

⚠ **日期分组标签没冻进基线**：room-data 拍的是「有材料 + 零轮次 + 空历史」那一态，侧栏里一行都没有，
自然也就没有墙钟时间戳与「今天」标签。分组语义靠 room-threads 的 DOM 判据看守（§3）。

🔴 **本轮自己栽的坑，写下来给下一个人**：pixel 比对**三次**跑进了 worktree（命令开头 `cd` 到 worktree、cwd 又会残留）。
worktree 的 `__snapshots__` 是 gitignored 的空目录，于是 54 张全是**首写**——第一次表现为「8 failed」（看着像变异生效），
第二次表现为「8 passed」（看着像变异没生效），**两次都不是真话**。
判别法：跑之前 `pwd`，跑之后比 `mtime`。已清掉三次误建产物。

---

## 5. 人眼过（`_px8081/`，24 张 = 2 皮 × 2 视口 × 6 态）

侧栏「有场」态与 composer 各交互态在 54 张基线里**零覆盖**，只能手拍。

| 态 | 看到了什么 |
|---|---|
| `*-empty` | 侧栏常显 + 「新对话」钮 + 诚实空态一行；composer 双行、16px 圆角、ink 实底圆形发送钮 |
| `*-aside-threads` | 「今天」分组 + 场标题（首问单行 ellipsis）+ 「2 轮问答 / 8月9日 23:22」；手机是抽屉浮层 |
| `*-aside-current` | 当前场 accent 软底高亮（不是描边——列表在栏里，边框会变成一堆盒子） |
| `*-composer-multiline` | Shift+Enter 多行长高，容器圆角**恒定**（旧版这时会变「体育场」形） |
| `*-composer-picker` | @ 弹层在 composer 上方，focus 环是 sky |
| `*-composer-chip` | `has-refs` 态圆角与静息态**同值**（原来是 999 → 18 的跳） |

⚠ 拍图脚本第一版把 `'第一行\n第二行'` 交给 `pressSequentially`，等于连按三次 Enter——拍到的是「发了三问」而不是
「多行输入态」。已改成 Shift+Enter 重拍。**截图证据自己也会撒谎，拍完要看一眼拍到的是不是那个态。**

计算值探针（几何门看不见的两条）：
- 侧栏 `[0, 264]` vs composer `[358, 1186]` vs 滚动口 `[264, 1280]` —— **零横向重叠**，两皮都验。
  （room-claude-rework 的「发问零跳变」只保证前后一致，**不保证让对位**：composer 是 `translateX(-50%)`，
  普通流里的 `<aside>` 推不动它——「侧栏做出来了、composer 仍压在它底下」是一条门都不会红的坏实现。）
- 三枚 icon 钮 34×34；form 圆角 16px 两皮一致；按钮圆角 paper 999 / aurora 9（各皮沿用自己的既有形状语言）。

---

## 6. 验证账

| 项 | 结果 |
|---|---|
| `npm run typecheck` | 绿 |
| `css-brace-check` / `css-scope-check` | 15 个 CSS 文件配平 · lite2.css 选择器全 scoped |
| `i18n-orphans`（只读） | 1035 叶子键 · 孤儿 **0** |
| 电池 A 区 | **34/34 绿**（最终 dist 上复跑一次，共跑三轮都是 34/34） |
| 电池 B 区（非像素） | `data-boundary` **37/37** · `null-owner` **15/0**（VERIFY_BASE 指本 worktree，不是碰巧占着 5173 的那份） |
| 电池 C 区 | **3/3 绿**；跑完按纪律重打带 `VITE_AVERY_API_BASE` 的 dist，浏览器里验过 `apiBase === http://127.0.0.1:8181` |
| 像素 | **8 passed · 0 首写 · 54 张**（详见 §4） |
| 后端 | **零改动**——`git status` 里没有任何 `.py` / `service/`，离线 pytest 套件在本批结构性不可能回归 |
| detach HEAD 自查 | worktree `claude/sharp-dirac-eedec3` · 主检出 `main`，两棵树都在正常分支上 |

## 7. 环境与跑法（复现用）

```
后端: cd eval-harness && AVERY_BRAIN=mock AVERY_EXTRACTOR=heuristic AVERY_EMBEDDINGS=keyword \
      AVERY_DEMO_SEED_DIR=tests/fixtures/demo-seed AVERY_PUBLIC_BASE=http://127.0.0.1:8181 \
      AVERY_CORS_ORIGINS=http://localhost:5181,http://127.0.0.1:5181 \
      python -m uvicorn service.app:app --host 127.0.0.1 --port 8181 --app-dir .
前端: VITE_AVERY_API_BASE=http://127.0.0.1:8181 npx vite build --mode development
      npx vite preview --port 5181 --host
门:   VERIFY_BASE=http://127.0.0.1:5181 VERIFY_API=http://127.0.0.1:8181 \
      node eval-harness/tools/run-battery.mjs --only=A   （再 --only=C）
像素: cd /d/avery && VERIFY_BASE=http://127.0.0.1:5181 npx playwright test -c eval-harness/visual
      🔴 这一行的 `cd /d/avery` 不是装饰——在 worktree 跑就是 54 张首写，见 §4 末尾
变异: python .issues/redesign-0808/_px8081/mutate.py            （不带参数=全跑；也可 `mutate.py M-M M-N`）
手拍: VERIFY_BASE=http://127.0.0.1:5181 node .issues/redesign-0808/_px8081/shot.mjs <outDir> [--turns]
```

## 8. 刻意留下的账 / 顺手发现没顺手修

- 🔴 **`.lite-room-history-panel` 那一族 CSS（lite2.css 8288-8312）随本票整段变死**：弹出面板已被侧栏取代，
  组件不再渲染 `.lite-room-history-panel` / `data-history-panel`，全仓 grep 只剩 CSS 自己一处命中。
  照 `.nexus-empty-composer-wrap` 的先例**留碑不删**（删它要连带确认 v01 冻结壳没在用）。
  ⚠ 它的两条几何公式仍在被抄用（手机抽屉的 max-height、侧栏底沿让位）。
- **「圆角恒定」在像素层无覆盖**（BR-2 实证）。要给它长一条机械判据，得量 `border-radius` 计算值而不是靠截图。
- **手机 room-data 对侧栏零覆盖**（BR-1 实证）——≤860 它是 `display:none` 的抽屉。手机抽屉态的所有判据
  （开关 aria、抽屉内配色、11px meta 的对比度）在**全部**既有门里也是零覆盖：contrast/aria-zh/at-references/
  room-claude-rework 四道门的视口都硬钉 1280×900 或最小 900 > 860。要补得另开视口世界。
- **停止钮的对比度只在「生成中」那一瞬量得到**，本票靠路由延迟造窗口。如果哪天它改成常显 disabled，
  那条判据会以「停止钮不在屏上」的形态红——那是对的，`onStop && busy` 的条件渲染是 room-claude-rework A22 的硬约束。
- **`--lite2-bottom-band` 仍是幽灵 token**（全文件无赋值，三处消费全走 `var(..., 120px)` 兜底），
  侧栏底沿让位也抄了它。**`--lite2-clear-top` 的 ≤860 覆盖仍写了两遍**（早段 72px 被后段 24px 静默架空）。两笔都没动。
- **`.lite-btn.lite-btn--ghost` / `.lite-btn.lite-btn--primary` 那两组 (0,3,0) 规则是一类隐形地雷**：
  任何按 `.lite2-shell .某个具体按钮类`（0,2,0）写的配色覆盖都会被它们静默压死，而**一道门都不会红**。
  §2.1 是它咬到的第一例，未必是最后一例——写按钮配色前先想一眼特异性。
- **改名 / 删除**按票面拍板**没做**（v1 只做列表+新对话+点击载入）。成本表见 `recon-sidebar.md` §5.4。
- **20 场硬上限**现状未动（`GET /team/{id}/advise-threads` 不透传 limit）。侧栏要显示更多场得动端点签名。
- **胶囊展开态仍零像素覆盖**（收起 pill 才进基线）；本票只手拍取证。
