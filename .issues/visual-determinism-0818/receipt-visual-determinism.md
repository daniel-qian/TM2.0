# 回执 · `reducedMotion: 'reduce'` 实测没生效（2026-08-18）

承 #106 B3 的「顺手发现，没顺手改」那一条。要求三件：查清根因、修好之后整批重冻 + 人眼过
对照板、把配置头注释里那句现在时的断言改成能自查的形式。

三件都做完了。过程中**这一票自己变成了那句注释的证明**：修好开关之后重跑，逮到一个
判据全绿、人眼也没看出来的真 bug（地图 mini 卡偏 98px），以及两条从来没写进任何跑法说明
的前提。下面按「问了什么—答了什么」记。

---

## ① 根因：不是 config 合并，也不是版本回归，是这个键**从来就不在白名单上**

playwright 1.61.1 的 `use` 顶层**没有** `reducedMotion` 这个键。runner 建 context 的
`_combinedContextOptions` fixture（`node_modules/playwright/lib/index.js`）是一张**写死的
白名单**——acceptDownloads / bypassCSP / colorScheme / deviceScaleFactor / extraHTTPHeaders /
geolocation / hasTouch / httpCredentials / ignoreHTTPSErrors / isMobile / javaScriptEnabled /
locale / offline / permissions / proxy / storageState / clientCertificates / timezoneId /
userAgent / viewport / baseURL / serviceWorkers —— 逐个 `if (x !== undefined) options.x = x`
拷过去。`reducedMotion` 不在其中：

```
grep -rc reducedMotion node_modules/playwright/lib/     # → 0（全库零命中）
```

**实测四组**（探针跑在真 config 下，跑完即删）：

| 取值处 | reducedMotion |
| --- | --- |
| `testInfo.project.use.reducedMotion` | `'reduce'` ← 配置对象原样留着，读得出来 |
| fixture `page` 里 `matchMedia(...).matches` | **false** |
| `browser.newContext()`（裸的，继承 config） | **false**（而 locale/tz 跟过去了） |
| `browser.newContext({ reducedMotion: 'reduce' })` | true |

最后两行是关键：裸 `newContext` 拿到了 `zh-CN` / `Asia/Shanghai` 却没拿到 reducedMotion
——证明**配置确实加载了，只有这一项没进 contextOptions**。

顶层写它不报错、不 warning、`project.use` 里照样读得出 `'reduce'`。**它长得跟生效一模一样**
——这就是它能烂两个月的全部原因。

**这不是本仓的版本回归**：`git log -L` 查过，`playwright: "^1.61.1"` 是 `1833d97` 一次写进
package.json 的，从没升过版。也就是说这份配置**从落地那天起就没生效过**。

出口是 playwright 自己文档里给的那一条——`types/test.d.ts` 中 `contextOptions` 这个 option
的示例**逐字**就是 `contextOptions: { reducedMotion: 'reduce' }`。优先级也实测过：白名单里的
显式键压 contextOptions（同时写 `contextOptions.locale='de-DE'` 时，顶层的 `zh-CN` 赢），
所以塞进去不会动到 locale/tz/dpr/viewport。

---

## ② 那句「三板斧」现在是三条跑得起来的判据

`visual-determinism.spec.mjs`（新，3 条 × 2 视口），跟基线**同一条命令**跑，不采样、不比图、
约 1 秒。头注释里那句话改成了索引：每一项写清由哪条判据看着。

1. **四个开关真落到浏览器上** —— reducedMotion / devicePixelRatio / locale / timeZone，
   外加 `prefers-color-scheme` 默认与 project 视口宽。
   🔴 期望值**手写在 spec 里**，不从 config 读：`expect(页面读到的).toBe(config.use.locale)`
   那种写法在 config 被改坏时两边一起变，永远绿。要改确定性开关就必须同时改这里——那正是
   我们想要的摩擦。
2. **配置里没有 playwright 会静默丢掉的 use 键** —— 白名单从**装着的那份 runner** 现推
   （正则扫 `_combinedContextOptions` 那批 fixture 的定义形状），不在这儿抄一份会过期的清单。
   配空真闸：正则被升级打散 ⇒ 推出空集 ⇒ 判据对任何配置都绿，所以先断 `size > 10` 且
   `has('locale')`。这一条抓的是**整类 bug**，不是 reducedMotion 一个实例。
3. **没有别的 spec 自己建 context 绕开这份配置** —— 手建 context 时 config 的 use 只会部分
   跟过去（实测：locale/tz 跟、reducedMotion 不跟），那张基线就脱离了前两条的射程且照样绿。

另外顺手订正同一段注释里另外两句烂话：「stub 数据」那一项 #68 早就查实是死的（`?transport=stub`
在 build+preview 产物上恒假），「基线 PNG 提交在 `__snapshots__/`」实为 `.gitignore:34` 忽略整个目录。

### born-red：9 发，发发红在自己那条判据上

`node .issues/visual-determinism-0818/mutants-determinism.mjs`

| # | 变异 | 预期红 | 实际 |
| --- | --- | --- | --- |
| M01 | reducedMotion 挪回 use 顶层（＝本票修的 bug 本身） | ①+② | ✅ 两条都红 |
| M02 | deviceScaleFactor 1→2 | ① | ✅ |
| M03 | locale zh-CN→en-US | ① | ✅ |
| M04 | timezoneId →UTC | ① | ✅ |
| M05 | 桌面视口 1440→1400 | ① | ✅ |
| M06 | use 顶层塞 `forcedColors: 'active'`（同类另一个实例） | ② | ✅ |
| M07 | 把推白名单的正则改瞎 ⇒ 空集 | ②的空真闸 | ✅ |
| M08 | 往 visual.spec 里塞一次 `browser.newContext()` | ③ | ✅ |
| M09 | 扫描目录指到 `__snapshots__` ⇒ 扫不到任何 spec | ③的空真闸 | ✅ |

还原逐字节干净（字节快照比对，不跟 git HEAD 比——工作区本来就是脏的，那种比法是恒真警报）。

⚠ **跑器首版自己撒了谎**：拿正则捞 list reporter 印的 `✘` 与行首序号来判「谁红了」，
而 1.61.1 的失败清单两样都不印——9 发变异发发都红了，跑器一律报「一条都没红」。
改成按判据分跑、以**进程退出码**判读。（这一条进了 `verifiers-that-lie` 的账。）

---

## ③ 整批重冻：66 张里动了 10 张，而**没有一张是 reducedMotion 单独造成的**

先说结论，因为它跟票面的预判不一样：票面写的是「54 张既有基线全部作废」。实测不是。

方法：不靠「跑一轮看谁红」（一个 test 串多张，**首处不匹配即中止**，红跑给出的清单是残缺的），
而是 `--update-snapshots` 之后逐文件 md5 对照，拿全量清单。为了把原因拆开，跑了三组：

| 组 | 条件 |
| --- | --- |
| before | 原有的 66 张 |
| ctrlA | reducedMotion **关**（＝把 config 改回坏写法） |
| after | reducedMotion **开** |

**第一轮的分解结果直接推翻了归因**：

- 52 张三者全等；
- 10 张 `ctrlA ≠ before` 且 `ctrlA = after` ⇒ **与 reducedMotion 无关**；
- 4 张两个原因都有；
- **0 张是「reducedMotion 单独改的」**。

也就是说：如果我按票面预期直接重冻，会把 10 张漂移记在 reducedMotion 头上——一个干净、
自洽、而且完全错误的结论。**「恰好如预期的红最该翻日志」这条又收了一次。**

那 10 张的真实原因，查下去是两件事：

### 3a 🔴 后端少了第四件环境变量（我自己的跑法错，不是基线陈旧）

`AVERY_ALLOW_PERSON_SCORING=1`。关着它时后端不把 `self_report` 投影到人卡上，于是地图的
组级读数（「有人自述吃紧」整行）和团队屏的自述行整片消失。补上之后，4 张 map-calm **逐字节
回到 before**——证明基线是对的，错的是我的跑法。

这条前提**此前一个字都没写**：不在 AGENTS.md、不在 ROSTER note、不在两份 spec 的头注释里。
后果不止一处：

- 同一批基线里，`visual-map` 那 12 张是在**开着**的世界冻的（B3，08-17），`visual-data` 那
  18 张是在**关着**的世界冻的（#79/#91 更早）——**两套自相矛盾却谁都不红**。
- `verify-team-map.mjs` 的 ⓪ 自证硬依赖它。实测（不是推测）：不带这个变量跑，
  `62 PASS · 1 FAIL`，红在 `⓪ 自证：语料够格 — 16 人 / 6 项目 / 6 条带 owner / 0 人报了负载`。
  这道门在 ROSTER 里，任何人照文档跑全电池都会撞上它。

已补：ROSTER 两行 note（visual-baseline / team-map）+ 两份 spec 头注释写上四件套跑法，
并各加一条**自证判据**（`.lite-map-zone-read` / `.lite-selfreport`）——前提缺席当场红，
不再靠人记得在 shell 里带变量。

### 3b 🔴 修好 reducedMotion 之后，逮到一个真 bug：地图 mini 卡永久偏 98px

对照板上 4 张 map-focus 看着像「镜头差了一点」，放大 5 倍才看清：**mini 卡整体左移了半个身位**。

根因在 `lite2.css`：
```css
.lite2-shell .lite-map-node-card      { animation: lite-map-card-in 200ms ease-out both; }
.lite2-shell .lite-map-person .lite-map-node-card { transform: translateX(-50%); }  /* 靠这个对准节点 */
@keyframes lite-map-card-in { to { opacity: 1; transform: none; } }                  /* ← 把居中抹了 */
```
`animation-fill-mode: both` 的意思正是「to 帧的值在动画跑完之后**永久生效**」。于是 200ms 之后
`transform: none` 覆盖掉 `translateX(-50%)`，卡片永久停在偏右半个身位（268/2 = 134px）。

真浏览器量的，不是读码推的：

| prefers-reduced-motion | 计算值 transform | 卡中心 vs 节点中心 |
| --- | --- | --- |
| no-preference（**绝大多数用户**） | `matrix(1,0,0,1,0,0)` | **偏 98px**（134 × 镜头 0.73 倍） |
| reduce | `matrix(1,0,0,1,-134,0)` | 0px |

**它为什么活到今天**：B3 冻 /map 基线时 reducedMotion 恰好没生效，于是**歪的那一帧被当成
正确答案冻了进去**，四张 focus 基线亲手护着这个 bug。B3 那 62 条判据全绿、人眼也过了——
偏半个身位在整屏缩略图上看着就像「卡挂在他右下方」，不放大根本不像错的。

改法：人卡那一版用自己的关键帧 `lite-map-card-in-centered`，to 帧把 `translateX(-50%)` 写回去；
项目条那一版不动（靠 left/right 定位，to 帧写 `none` 是对的）。

**同类扫描**（写了个扫描器，带自测：扫不到已知那一例就判自己不可信）：全仓 15 个 css 里
「fill 填充的 to 帧 transform 覆盖掉定位用 transform」真的只有这一处；另一处
`story/50-followup-chip.css` 是 hover 位移被盖、`-50%` 仍在，且属 v01 冻结面，不动。

新判据 **D1b**「mini 卡横向对准它挂着的那个人」进 `verify-team-map.mjs`（63 PASS · 0 FAIL）。
born-red：把 `animation-name` 一行去掉重打 dist ⇒ `[FAIL] D1b — 偏 98px（卡宽 196，半个身位=98）`。
⚠ 两条纪律写在判据边上：**必须等 200ms 动画跑完再量**（动画进行中卡恰好还在正确位置，
早量一帧就是假绿）；**判据落在「对没对准」上，不落 `getComputedStyle().transform`**
（那量的是实现手段，将来换 margin/`translate:` 属性实现，对的也会红）。

### 3c 最终 10 张的账（人眼逐张过，三组各看了双皮双视口）

| 张数 | 屏 | 变了什么 | 判断 |
| --- | --- | --- | --- |
| 4 | `*-map-focus-*` | mini 卡从偏右半个身位 → 对准节点 | ✅ 修 bug，新版是对的 |
| 4 | `*-team-data-*` | 多出「地图视角 ↗」入口（#106 B1 加的，从没重冻过）+「按本人自述筛选」行 + 每张人卡的自述负载/情绪行 | ✅ 都是真部件，旧基线欠账 |
| 2 | `*-home-data-desktop` | 风险行多出一句「到期日已过；」 | ⚠ 见下 |

重冻后复跑：**18 passed，零漂移**（含 determinism 3 条 × 2 视口）。

---

## ④ 顺手查实、**没在本票拆**的一颗雷

`visual-data.spec.mjs` 头注释写着「setFixedTime 钉死时钟」，并把它当成时间炸弹已拆的依据。
**它只钉得住浏览器那一半。** 决策定级是在**后端**算的——`avery/decision_grading.py` 的
`as_of` 走 `_utc_now().date()`，是服务器的真实墙钟，`page.clock` 一个字都够不着。
home 那两张就是这么漂的：真实日期越过了语料里的到期日，风险行凭空多出一句。

⇒ home/projects 两屏**仍然会随日历腐烂**，只是慢一点。真拆雷要让后端 `as_of` 可注入，
是另一票的活。本票只把那句现在时的断言改成了实话——不改的话，它就是下一个「reducedMotion」。

---

## 跑法（四件套，别抄成三件）

```bash
cd eval-harness && AVERY_BRAIN=mock AVERY_EXTRACTOR=heuristic AVERY_EMBEDDINGS=keyword \
  AVERY_DEMO_SEED_DIR=tests/fixtures/demo-seed AVERY_ALLOW_PERSON_SCORING=1 \
  python -m uvicorn service.app:app --port 8137
```
前端 build + preview（不用 dev），然后
`node node_modules/playwright/cli.js test -c eval-harness/visual`。

🔴 重冻只在人审对照板通过后跑 `--update-snapshots`，且冻在**主检出**：`__snapshots__/` 是
`.gitignore:34` 忽略的单机产物、每个 worktree 一份，worktree 里冻＝白冻。
自查张数用 `ls eval-harness/visual/__snapshots__/*.png | wc -l`（别数整个目录，里面还躺着
一个 07-23 留下的 `.bak/`）。

## 文件

**改**：`eval-harness/visual/playwright.config.mjs` · `eval-harness/visual/{visual-data,visual-map}.spec.mjs` ·
`eval-harness/tools/{run-battery.mjs,verify-team-map.mjs}` · `src/lite2/styles/lite2.css`
**新**：`eval-harness/visual/visual-determinism.spec.mjs` ·
`.issues/visual-determinism-0818/{mutants-determinism.mjs,receipt-visual-determinism.md}`
