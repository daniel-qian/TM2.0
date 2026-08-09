# #80/#81 变异台账（逐条独立跑：apply -> vite build -> 跑那道门 -> revert）

跑器：`mutate.py`（不带参数=全跑，也可 `mutate.py M-M M-N`）。总账与解读见 `../receipt-80-81-sidebar-composer.md` §3.2。

### M-H — sidebar reverts to "render only when threads exist"

- 门：`eval-harness/tools/verify-room-threads.mjs`
- 结果：**51 PASS / 4 FAIL**

```
[FAIL] ⑫ 侧栏**常显**：零会话时不点任何东西，它就已经在屏上且有宽度（「有场才显」的实现在既有判据上全绿，却会在首场答完时把 composer 挤走——那是没网） — {"asideVisible":false,"asideW":null,"newBtn":0,"rows":0,"emptyLine":0,"toggleVisible":false,"toggleInDom":0}
[FAIL] ⑫ 空态形状 = 空列表 + 「新对话」钮（票面拍板的空态） — {"asideVisible":false,"asideW":null,"newBtn":0,"rows":0,"emptyLine":0,"toggleVisible":false,"toggleInDom":0}
[FAIL] ⑫ 空历史说的是**诚实空态**（拉到了确实为空 → 有一行说明；null/stub 那一态该留白，两者不许合并成一句） — {"asideVisible":false,"asideW":null,"newBtn":0,"rows":0,"emptyLine":0,"toggleVisible":false,"toggleInDom":0}
[FAIL] ⑫ 桌面态没有抽屉开关可点，但那枚钮仍在 DOM 上（这就是 openHistory() 必须分形态的依据：裸 click 会超时抛错让整门 crash 而不是变红） — {"asideVisible":false,"asideW":null,"newBtn":0,"rows":0,"emptyLine":0,"toggleVisible":false,"toggleInDom":0}
```

### M-I — newConversation keeps threadId

- 门：`eval-harness/tools/verify-room-threads.mjs`
- 结果：**52 PASS / 3 FAIL**

```
[FAIL] ⑬ 点「新对话」：threadId 也一起清（留孤儿 = 屏上空白、下一问却落进上一场）
[FAIL] ⑬ 🔴 新对话之后的下一问请求体**没有** thread_id 键（服务端据此自铸新场＝后端零改动的全部含义；只清 store 而请求体照旧带旧 id 的实现在这条红） — ["situation","company_context_id","thread_id","locale","stream"]
[FAIL] ⑬ 新对话拿到的是一个**全新的**场 id（既不是被打开过的那场，也不是它之前那场） — {"tidBeforeNew":"thr_34f63b070e364b01","tidC":"thr_34f63b070e364b01"}
```

### M-J — new-chat button loses its disabled attribute

- 门：`eval-harness/tools/verify-room-threads.mjs`
- 结果：**54 PASS / 1 FAIL**

```
[FAIL] ⑭a 锁① 生成中「新对话」钮**属性上** disabled（拆掉置灰这条必红；只判「点了没反应」会被 store 那把锁掩护成假绿） — {"newBtnDisabled":false}
```

### M-K — store newConversation loses its busy gate

- 门：`eval-harness/tools/verify-room-threads.mjs`
- 结果：**54 PASS / 1 FAIL**

```
[FAIL] ⑭b 锁② 生成中绕开 UI 直调 newConversation 也不动 turns（拆掉 store 的 busy 闸这条必红；此刻 turns 非空，幂等闸够不着，掩护不了它） — {"before":[{"q":"新的一问，这周先盯哪一头","hydrated":false,"status":"complete"},{"q":"再看一眼下周的安排","hydrated":false,"status":"running"}],"after":[]}
```

### M-L — send button loses submitAriaLabel (the aria dark area)

- 门：`eval-harness/tools/verify-room-claude-rework.mjs`
- 结果：**56 PASS / 1 FAIL**

```
[FAIL] ⑨ 🔴 每一枚 icon-only 钮都有非空 aria-label（aria-zh 只扫已存在的属性值，「该有而没有」是它结构上够不着的暗区——发送钮 icon 化时忘传就是零门会红） — [{"hook":"data-composer-attach","aria":"上传文件一起问"},{"hook":"data-composer-send","aria":null}]
```

### M-M — send icon loses its explicit size

- 门：`eval-harness/tools/verify-room-claude-rework.mjs`
- 结果：**57 PASS / 2 FAIL**

```
[FAIL] ⑨ 每一枚 icon 渲染在 icon 尺寸区间（14-22px）：不传 size 时 Phosphor 退回 `1em`，它跟着按钮字号走（实测 13px）而不是 0——写成「尺寸 >0」的尺子对这条病根是瞎的 — [{"hook":"data-composer-attach","w":17,"h":17},{"hook":"data-composer-send","w":13,"h":13}]
[FAIL] ⑨ 同一排 icon 尺寸**逐像素一致**（一族一个尺寸；一枚忘传 size 就在这条上现形） — [17,13]
```

### M-N — send button filled with accent instead of ink (selector strong enough to win)

- 门：`eval-harness/tools/verify-room-claude-rework.mjs`
- 结果：**58 PASS / 1 FAIL**

```
[FAIL] ⑩ 🔴 发送钮的实底与本壳 primary 按钮族**同色**（票面拍板 primary=ink 实底；改成 accent 等于新开一种按钮色阶，而对比度地板拦不住它——上面那段注释是实测账） — {"send":"rgb(105, 128, 109)","primary":"rgb(29, 27, 23)"}
```

### M-O — button-family whitelist drops .lite-room-history-head

- 门：`eval-harness/tools/verify-button-family.mjs`
- 结果：**11 PASS / 1 FAIL**

```
[FAIL] [room] 零裸按钮（18 可见：族 3 + 白名单 14） — lite-room-history-head「这周谁的项目最需要我搭把」
```

### M-P — room-threads driver reverts to a form-blind bare toggle click

- 门：`eval-harness/tools/verify-room-threads.mjs`
- 结果：**21 PASS / 0 FAIL [CRASH mid-run: summary line never printed]**

```
  ],
  name: 'TimeoutError'
}

Node.js v24.13.0
```
