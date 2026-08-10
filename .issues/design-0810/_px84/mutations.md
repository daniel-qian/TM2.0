
### M-A — rail goes back to an opaque white card (raised, not sunken)

- 门：`eval-harness/tools/verify-files-explorer.mjs`
- 结果：**35 PASS / 0 FAIL**

```
  [PASS] B⑥ 有遮罩可点（没有遮罩的抽屉，用户不知道点哪儿能关） — 1
  [PASS] B⑦ 抽屉里每一处小字 ≥ AA（尺子与 contrast-smalltext 同源；那道门的视口够不着这里） — 0 处
  [PASS] B 无 pageerror — 0 条

═══ #84 资料库两栏 file explorer：35 PASS · 0 FAIL ═══
```

### M-B — rail floats between clear-top and the bottom band again

- 门：`eval-harness/tools/verify-files-explorer.mjs`
- 结果：**34 PASS / 1 FAIL**

```
[FAIL] A② 🔴 贴边通到底（top===0 且 bottom===视口底），消灭两道悬空截断边 — {"w":208,"top":96,"bottom":780,"vh":900,"railLum":27.1364,"pageLum":254.99999999999997,"borderRight":"1px"}
```

### M-C — rail rows lose the 34px single-line rhythm

- 门：`eval-harness/tools/verify-files-explorer.mjs`
- 结果：**34 PASS / 1 FAIL**

```
[FAIL] A③ 行高 34px（与对话侧栏同一节奏） — 44px
```

### M-D — selected rail row loses its 2px accent seal (::before never generated)

- 门：`eval-harness/tools/verify-files-explorer.mjs`
- 结果：**34 PASS / 1 FAIL**

```
[FAIL] A③ 🔴 选中行有 2px accent 左封条，且 `content` 不是 none（伪元素的计算值不证明它上了屏） — content=none w=2px bg=rgb(74, 96, 78)
```

### M-E — rail group label falls back to --ink-faint (the #80 gravestone)

- 门：`eval-harness/tools/verify-files-explorer.mjs`
- 结果：**35 PASS / 0 FAIL**

```
  [PASS] B⑥ 有遮罩可点（没有遮罩的抽屉，用户不知道点哪儿能关） — 1
  [PASS] B⑦ 抽屉里每一处小字 ≥ AA（尺子与 contrast-smalltext 同源；那道门的视口够不着这里） — 0 处
  [PASS] B 无 pageerror — 0 条

═══ #84 资料库两栏 file explorer：35 PASS · 0 FAIL ═══
```

### M-F — file rows go back to the flex-wrap soup (grid dropped)

- 门：`eval-harness/tools/verify-files-explorer.mjs`
- 结果：**33 PASS / 2 FAIL**

```
[FAIL] A⑥ 🔴 真列不是 flex 汤：行是 grid，且列数恰好 6（名/大小/片段/时间/状态/动作） — flex · minmax(0px, 1fr) 76px 96px 132px 92px 72px
[FAIL] B③ 🔴 九行**恰好一种落位指纹**（改造前 3 种内部顺序）——判据落在格子的相对落位本身，不落"看起来一样高"（尺子太宽 = 对着真违规也全绿） — 3 种
```

### M-G — number columns lose tabular-nums and right alignment

- 门：`eval-harness/tools/verify-files-explorer.mjs`
- 结果：**34 PASS / 1 FAIL**

```
[FAIL] A⑦ 数字列 tabular-nums + 右对齐（列与列之间的数字才对得齐） — {"cols":"572px 76px 96px 132px 92px 72px","headCols":"572px 76px 96px 132px 92px 72px","display":"grid","numeric":"normal","numericChunks":"normal","alignSize":"start","alignChunks":"start","actsW":72,"actsOpacity":"0","actsPointer":"auto","tableW":1120,"paneW":1232}
```

### M-H — row actions collapse the cell when idle (display:none instead of opacity)

- 门：`eval-harness/tools/verify-files-explorer.mjs`
- 结果：**33 PASS / 2 FAIL**

```
[FAIL] A⑧ 🔴 行动作**格子恒占位**（静息态 opacity 0 但宽度不为 0——现出来时不推挤别的列） — w=0 opacity=1
[FAIL] B④ 骨架就是规格里那两行：第一行只有文件名，第二行是 状态/大小/片段/时间 — 0:upload-file-acts|1:upload-file-name|2:upload-file-status|2:upload-file-size|2:upload-file-chunks|2:upload-file-time
```

### M-I — hidden row actions also stop receiving pointer events (the crash-the-gate shape)

- 门：`eval-harness/tools/verify-files-explorer.mjs`
- 结果：**34 PASS / 1 FAIL**

```
[FAIL] A⑧ 🔴 藏法只用 opacity，没有 pointer-events:none（加了会让删除那三次点击超时**崩门**） — none
```

### M-J — the table loses its 1120px reading cap and stretches to the pane

- 门：`eval-harness/tools/verify-files-explorer.mjs`
- 结果：**34 PASS / 1 FAIL**

```
[FAIL] A⑨ 表格有阅读上限 1120（工作台自己占满；撑满 1440 会拉出近 900px 空档） — 表 1176 / 台 1232
```

### M-K — mobile rows lose the written-down cell placement (auto-flow again)

- 门：`eval-harness/tools/verify-files-explorer.mjs`
- 结果：**34 PASS / 1 FAIL**

```
[FAIL] B② 🔴 九行**恰好一种高度**（改造前 4 种；flex-wrap 的汤按文件名长短折行） — 2 种: 76/63
```

### M-L — file rows become flex-shrinkable again (the squashed-rows bug found by hand)

- 门：`eval-harness/tools/verify-files-explorer.mjs`
- 结果：**35 PASS / 0 FAIL**

```
  [PASS] B⑥ 有遮罩可点（没有遮罩的抽屉，用户不知道点哪儿能关） — 1
  [PASS] B⑦ 抽屉里每一处小字 ≥ AA（尺子与 contrast-smalltext 同源；那道门的视口够不着这里） — 0 处
  [PASS] B 无 pageerror — 0 条

═══ #84 资料库两栏 file explorer：35 PASS · 0 FAIL ═══
```

### M-M — mobile drawer reuses the desktop translucent tint (glass over the content)

- 门：`eval-harness/tools/verify-files-explorer.mjs`
- 结果：**34 PASS / 1 FAIL**

```
[FAIL] B⑥ 🔴 抽屉底色**不透明**（半透明 = 正文从字缝里透出来，且让 contrast 门量出屏上不存在的比值） — {"open":true,"alpha":0.035,"hitInside":true,"scrim":1}
```

### M-N — the workbench stops accepting drops (only the old small box would)

- 门：`eval-harness/tools/verify-files-explorer.mjs`
- 结果：**34 PASS / 1 FAIL**

```
[FAIL] A⑩ 🔴 整块工作台接拖放（在工作台任意处 dragover 就进投放态） — false
```

### M-O — the toolbar uploader is wired to uploadFiles even when an archive exists

- 门：`eval-harness/tools/verify-append-story.mjs`
- 结果：**18 PASS / 1 FAIL**

```
[FAIL] ② 🔴 有档案时这个口子是 append 模式（接成 new = 每次补料都另开一家公司） — ["new"]
```

### M-P — the empty button is wired to the wrong action (uploadFiles, not emptyArchive)

- 门：`eval-harness/tools/verify-archive-empty.mjs`
- 结果：**34 PASS / 2 FAIL**

```
[FAIL] ⑦ 🔴 那枚键**真的接在 emptyArchive 上**：又发了一发 `POST /team/{cid}/empty` — 1 → 1
[FAIL] ⑦ 屏上 1 行 → 0 行，且 context_id 逐字符不变（走 UI 这条路同样不换档案） — 1 → 1 · ctx_388d78d3a7f5
```

### M-Q — the hard confirm degrades to "any non-empty string unlocks it"

- 门：`eval-harness/tools/verify-archive-empty.mjs`
- 结果：**28 PASS / 2 FAIL [CRASH mid-run: summary line never printed]**

```
[FAIL] ⑦ 🔴 打错字也不放行（写成「非空即可」在上一条判据下照样全绿）
[FAIL] ⑦ 🔴 绕开 disabled 硬派一次 click 也发不出请求（UI 置灰挡不住键盘/脚本，真闸必须在 handler 里） — 2 发
```

### M-R — the rail puts "start a separate company" ahead of standing forms again

- 门：`eval-harness/tools/verify-files-ia.mjs`
- 结果：**17 PASS / 2 FAIL**

```
[FAIL] ③ 🔴 频率重排：常驻表单排在「新建一家公司」**前面**（旧序正好相反） — ["files","new","empty"]
[FAIL] ④ 🔴 #84 段内重排：拼装器（改表）排在铸链区**之后**（一年动两次的编辑器不该天天挡在「这周发给谁」前面） — {}
```

### M-S — the form builder goes back in front of the minting block

- 门：`eval-harness/tools/verify-files-ia.mjs`
- 结果：**19 PASS / 0 FAIL**

```
  [PASS] ⑤ 🔴 第二下真删：清单少那一行，且少的是**被点的那一份** — 删的是 婚宴纪要.md
  [PASS] ⑥ 已删文档的键不再出现在候选来源（清单即 @ 文件候选的数据面） — ["花名册.md"]
  [PASS] 无 pageerror（整程零未捕获异常） — []

═══ #76/#77 资料库 IA 重排 + 删除文件（前端）：19 PASS · 0 FAIL ═══
```

### M-T — the form notification stops deep-linking into the standing-forms zone

- 门：`eval-harness/tools/verify-forms-proactive.mjs`
- 结果：**12 PASS / 1 FAIL [CRASH mid-run: summary line never printed]**

```
FAIL  ③e 🔴 而且落在**常驻表单**那一区（不是默认的文件区） — forms段=0 左栏选中=0
```

### M-A — rail goes back to an opaque white card (raised, not sunken)

- 门：`eval-harness/tools/verify-files-explorer.mjs`
- 结果：**36 PASS / 0 FAIL**

```
  [PASS] B⑥ 有遮罩可点（没有遮罩的抽屉，用户不知道点哪儿能关） — 1
  [PASS] B⑦ 抽屉里每一处小字 ≥ AA（尺子与 contrast-smalltext 同源；那道门的视口够不着这里） — 0 处
  [PASS] B 无 pageerror — 0 条

═══ #84 资料库两栏 file explorer：36 PASS · 0 FAIL ═══
```

### M-E — rail group label falls back to --ink-faint (the #80 gravestone)

- 门：`eval-harness/tools/verify-files-explorer.mjs`
- 结果：**36 PASS / 0 FAIL**

```
  [PASS] B⑥ 有遮罩可点（没有遮罩的抽屉，用户不知道点哪儿能关） — 1
  [PASS] B⑦ 抽屉里每一处小字 ≥ AA（尺子与 contrast-smalltext 同源；那道门的视口够不着这里） — 0 处
  [PASS] B 无 pageerror — 0 条

═══ #84 资料库两栏 file explorer：36 PASS · 0 FAIL ═══
```

### M-L — file rows become flex-shrinkable again (the squashed-rows bug found by hand)

- 门：`eval-harness/tools/verify-files-explorer.mjs`
- 结果：**35 PASS / 1 FAIL**

```
[FAIL] B④b 🔴 每个格子都真的装在行框里（行被 flex 压扁时，九行照样"一种高度一种指纹"） — 公司概况与部门手/upload-file-size+14px · 公司概况与部门手/upload-file-chunks+14px · 公司概况与部门手/upload-file-time+14px · 公司概况与部门手/upload-file-status+14px · 公司概况与部门手/upload-file-acts+11px
```

### M-S — the form builder block is renamed out from under the criterion

- 门：`eval-harness/tools/verify-files-ia.mjs`
- 结果：**18 PASS / 1 FAIL**

```
[FAIL] ④ 🔴 #84 段内重排：拼装器（改表）是这一区的**最后一块**（一年动两次的编辑器不该天天挡在「这周发给谁」前面） — {"mint":3,"edit":-1,"n":5}
```

### M-S2 — something else gets appended after the builder (it is no longer last)

- 门：`eval-harness/tools/verify-files-ia.mjs`
- 结果：**18 PASS / 1 FAIL**

```
[FAIL] ④ 🔴 #84 段内重排：拼装器（改表）是这一区的**最后一块**（一年动两次的编辑器不该天天挡在「这周发给谁」前面） — {"mint":3,"edit":4,"n":6}
```

### M-A — rail goes back to an opaque white card (raised, not sunken)

- 门：`eval-harness/tools/verify-files-explorer.mjs`
- 结果：**36 PASS / 1 FAIL**

```
[FAIL] A② 🔴 下陷不是凸起：栏合成后的亮度低于身后那张画布（换皮不瞎的量法） — rail=253.1 page=244.2
```

### M-E — rail group label falls back to --ink-faint (the #80 gravestone)

- 门：`eval-harness/tools/verify-files-explorer.mjs`
- 结果：**36 PASS / 1 FAIL**

```
[FAIL] A③ 🔴 组标吃 --ink-soft **不吃** --ink-faint（11px 的 faint 在 paper 上只有 ~4.7:1，#80 的碑） — {"color":"rgb(115, 108, 95)","faint":"rgb(115, 108, 95)","soft":"rgb(94, 90, 81)"}
```
