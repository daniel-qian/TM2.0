# #75 + #73 · 开工前设计裁定（S1，wave 1）

> 侦察正源是 `recon-room.md`。本文件只记**本次开工新查出来的事实**与**据此做的裁定**，
> 供实现期与回执引用。行号采于 main@6aa45ce + 本 worktree。

## 0 · 设计读数（/design-taste-frontend §11 改版协议）

**Redesign - Preserve**：品牌 Avery、双皮令牌体系（`data-look` paper/aurora）、IA、路由全部保留。
技能 §11.C 的「不许静默改名下游追踪依赖的 ID」在本仓的对应物就是**门锚点**——改名可以，
但必须与门同一批改判。技能 §13 自认多步产品 UI 不在射程，与战役档拍板一致，只取
改版协议 / 文案自审 / 一致性锁 / 状态全覆盖 / AI 味黑名单（含 §9.G em-dash 零容忍）。

## 1 · 新查出来的硬事实（都会改变做法）

### 1.1 composer 其实只有两套几何要合并，不是三套
胶囊 `.lite-ask-avery-form`（lite2.css:6804-6815）是**全局入口**、与 room 内部两套从不共存。
「三态统一」= 空态卡内 static（lite2.css:478-492）+ 对话态锚底 828px（lite2.css:8197-8202）
**合一**；胶囊保留 pill 形态，只改行为（即发）。

### 1.2 数据态 14 张像素基线里的胶囊是**收起的 pill 按钮**，不是 form
`AskAveryLauncher` 只在 `open` 时渲染 `AskRefComposer`。基线截的是新加载页面 → `open=false`
→ 那是个 `<button>`。**textarea 化碰不到那 14 张**。（此前预判「改胶囊 → 14+36 大面积红」
在 input→textarea 这一项上不成立。）

### 1.3 门里三个「会崩不会红」的抓手
- `verify-at-references.mjs:139` / `verify-room-conversation.mjs:65`：
  `.lite-room .nexus-followup-composer input[type="text"]`。textarea 化后命中 0 个，
  Playwright 超时抛错 → **整份门 crash，连汇总行都不打印**（不是「51 条里红几条」）。
- `verify-at-references.mjs:351`：胶囊 `.lite-ask-avery-form input[type="text"]` 同理。
- `verify-room-conversation.mjs:66`：`button[type="submit"]` 靠 `count()===1` 自证。
  新增按钮**忘写 `type="button"`** 时 HTML 默认就是 submit → 命中 2 个 → strict-mode 抛错。

→ 裁定：一律挂**不绑标签名**的稳定钩子（见 §3 钩子表），门改判到钩子上。

### 1.4 `verify-at-references.mjs:584` 的裸 Enter 被 ⑨ 段 7 个入口全复用
票面选「Enter 发送 / Shift+Enter 换行」正好保住它。**反过来选 Ctrl+Enter 发送的话**，
这一行不报错、只会在框里敲进一个换行符 → 7 个入口 waitForPosts 全超时 → 28 条判据以
「入口没接上引用」的**误诊断形态**假红。这是本次改造最容易被误诊的一类失败。

### 1.5 `verify-room-nomaterial.mjs:41` 与「常驻 composer」天然冲突
判据是 `document.querySelectorAll('.nexus-followup-composer').length === 0`（世界 A，
contextId===null）。「docked composer 一直挂载、只是不可用」这种 IM 式写法会让它翻红。
→ 裁定：**结构性卸载**（`contextId === null` 整棵子树条件渲染），绝不用 CSS 隐藏。

### 1.6 `verify-room-usability.mjs:172` 会变成假绿
它取 `board.children[board.children.length - 1]` 当「最后一轮卡」。若把 docked composer
做成 `.lite-room-board` 内部 `position:sticky` 的最后一个孩子（贴底输入框的常见简易写法），
它就抓到 composer 自己跟自己比 → **对着任何真回归都全绿**。
→ 裁定：composer 结构性留在 `.lite-room-board` **之外**（`.lite-room-scroll` 的兄弟）。

### 1.7 假 complete 的确切出生地与两层撒谎
`streamSource.ts:180-181` 的兜底是**黑名单**（`!== 'error' && !== 'complete'`）而不是白名单，
于是「被按停」和「流跑完没产出」被收成同一件事；紧接着 `sealPhases`（:185 → refreshPhases
:342）把在跑的那一相封成 `done`——**比 error 待遇还宽**（error 分支 :282 明确不 seal）。
屏上结果：四步全绿 + HUD 说「分析好了」+ 卡是空的。

其它两条：
- `transport.ts:1201-1207` abort 走 `onDone()` **无参**（判据是 `controller.signal.aborted`）；
  `LiveTransport.streamAdvise` 的 onDone 契约只有「完了/炸了」两态。
- `stubTransport.ts:278-283` 的 abort **一次 onDone 都不调** → stub 通道 abort = 永久 running。
  两条通道的中止语义今天根本对不上。

### 1.8 加 `'interrupted'` 是 fail-closed，加布尔字段是 fail-open
46 处 status 消费者已穷举。最毒的三处**静默走错分支**：
| 位置 | 今天 | 加新值后 |
|---|---|---|
| `RoomScreen.tsx:327` HUD 三元 | interrupted 掉进 else → 显示「分析好了，可以看了」 | 必须显式补一支 |
| `notifyStore.ts:226` | 中止会**真的响一声**「议事室的解读好了」 | 自动静音（正确） |
| `store.ts:1351` settled 闸 | `=== 'complete' \|\| === 'error'` 都不满足 → fetchNotes 永不触发、latch 常开 | 必须补 interrupted |
反向判断的雷：`.issues/gap-design-0805/t8-e2e.mjs:514` 是 `room.status !== 'error'`——
interrupted 会被当成通过（一次性门，记账不改）。

### 1.9 停止的诚实语义：不是「省下 token」
后端 `/advise` 对客户端断开**零显式处理**（全 service 目录无 `is_disconnected`），
引擎是同步生成器跑在 threadpool 里，取消只能在 await 点生效 → **当前那一步 LLM 调用会跑完**。
→ 文案只许说「不再等它、不再给你看」，不许说「已停止，不再消耗」。

`advise_runs` 不会落半截：`_persist_advise_run`（app.py:344-371）在 advice 与 answer 都空时
不落行（:363-364）。唯一不对称面：中止恰好落在「manifest 已生成、帧还没送到浏览器」那个窗口时，
服务端落了一条完整记录而前端显示已中断。
→ 裁定：`RoomScreen` 的 `refreshAdviseRuns` 触发条件**把 interrupted 也纳入**（唯一一处
interrupted 该跟着 complete 走的分支），让它立刻出现在抽屉里而不是下次进屋才冒出来。

### 1.10 #73：没有任何端点暴露上传上限
逐个确认过全部已注册路由（`/health` 只回 brain/embeddings/extractor/memory 那几项）。
413 响应体里那些人话数字是**踩线之后**才吐的。→ 前端预检只能自己维护一份数字，
且必须对齐**生产 env**（10 个 / 10 MiB / 总 32 MiB），不是 `guards.py` 的默认值（15 / 8 MiB）。
这份数字没有运行时单一真源，只能靠注释互指。

### 1.11 #73：ref 必须用回执的 `source_key`，不能用 `store.files[].filename`
- 回执 `appended.documents`（ingest_api.py:833）= `sd.source_key or sd.filename` → **消歧后**的权威名。
- `GET /team/{id}/files`（registry.py:797）回填的是 `sd.filename` → **原始 display 名**，
  撞名时两行字面完全相同，只靠 `idx` 区分。
- `askRefs.ts:107-113` 今天直接拿 `f.filename` 当 `id`；后端 `references.py:155` 是
  `source_key == want or filename == want` 的 `next(...)` **取第一个命中**。
→ 用 filename 构 chip 会指向不确定的那一份。**用回执 documents[] 里的字符串构 chip**。
（id 契约的根治归 **#74 / S2**，本票只走「今天能对的那条路」并记账。）

### 1.12 #73：抽取是同一次 HTTP 里同步跑完的
`ingest_api.py:799-809` `run_in_threadpool(_extract_and_append)` → **promise resolve 本身
就是完成信号**，不需要轮询。等待态就是 `appendStatus === 'ingesting'` 期间。

## 2 · 目标 DOM（三态统一后）

```
<section class="scene scene-nexus is-active lite-room">
  {contextId === null
    ? <section class="nexus-empty lite-room-nomaterial" data-room-nomaterial>…</section>   ← 世界 A：composer 整棵不挂载
    : <>
        <div class="lite-room-scroll">
          <div class="lite-room-board" data-room-turns={N}>
            {N === 0 ? <欢迎块 + .lite-room-chips(4 个 .lite-room-chip)/> : turns.map(LiteTurnView)}
          </div>
        </div>
        <form class="nexus-followup-composer" data-room-composer …/>   ← 恒是 .lite-room 的直接子元素
      </>}
  <LiteRoomHistory/>   ← 不动（#78 地盘）
</section>
```

保住的既有锚：`.lite-room > .nexus-followup-composer`（CSS+门双承重）· `.lite-room-scroll` ·
`.lite-room-board` · `data-room-turns` · `.lite-room-chip`×4 · `[data-room-nomaterial]` ·
`[data-ask-refs]` · `[data-ref-picker]` · combobox aria 四件套 · picker 仍在 form 内
（`picker.closest('form')` 是 at-references:413 的地基）。

退役的锚：`.nexus-empty-composer-wrap`（空态壳）——`at-references:511` 与
`room-conversation:348` 的空态自证改判到 `data-room-turns="0"` + `[data-room-composer]`。

## 3 · 新钩子表（一律不绑标签名）

| 钩子 | 挂在 | 为什么 |
|---|---|---|
| `data-composer-input` | textarea | 替掉 `input[type=text]`，控件类型再变不用重开门 |
| `data-composer-send` | 发送键 | 替掉 `button[type=submit]`，不被新按钮撑破 count===1 |
| `data-composer-stop` | 停止键 | 生成中**顶替**发送键的同一个槽位 |
| `data-composer-attach` | 附件键 | `type="button"`，绝不 submit |
| `data-room-composer` | room composer form | 空态/对话态统一后的 composer 自证 |
| `data-attachment-pill` + `.lite-attachment-pill` | 附件预览 | **零射程重叠**于 `.lite-room-chip`（nomaterial 计 4）与 `data-followup-chip*`（conversation 计 2） |
| `data-run-status` | 每轮 `<article>` | 中断态可被门直接采样，不必读 store |

## 4 · 裁定清单

1. **停止键与发送键并存**，停止键 `type="button"`（**改过一次的裁定**，见下）。
   - 先想的是「顶替」（同槽位切换），理由是不留灰死按钮。
   - 推翻的原因：`button[type="submit"]` 的 `count()===1` 自证（room-conversation:66/95）与
     ⑤ 的 disabled 三连、以及 snippet L1796/L2208 全都锚在「form 内唯一 submit」上。
     停止键只要写 `type="button"`，这三处**一条都不用改判**；顶替方案则要重写它们。
   - 灰死按钮的顾虑用另一半解决：**生成中 textarea 仍可编辑**（下一条），所以那颗灰键是
     「我在答，先别发」的诚实说明，不是把人锁死。
   - 顺带补上侦察指出的**覆盖空洞**：「生成中即使有文本，发送键仍 disabled」这条今天三道门
     一条都没测到。
2. **生成中 textarea 保持可编辑**（可以先把下一问打好）。修 #4-7「被锁死」的主要那一半。
   Enter 在生成中不提交（handleSubmit 兜底），但旁边那颗 disabled 的发送键**看得见**地
   解释了为什么，不是「点了没反应」的静默。
3. **markdown 只作用于回答**（`run.answer`），**不作用于提问回显**——`room-conversation:121`
   的精确相等断言否则会在语料含 `*_#[]()` 时漂移（今天 fixture 不含，是隐性地雷）。
4. **`LiteRoomHistory` 一行不改**（#78 地盘）。代价：抽屉里回放的短答仍是纯文本，与会话流里
   的 markdown 渲染不一致。刻意留账，交 #78。
5. **空态 eyebrow 直接删掉**（不是改字）。原来那句 `t.nexus.liveThinking`「正在仔细梳理中」
   在空态是假的（recon §4-10）；删元素不动字典 = 不侵入 #79 的文案批改地盘，
   同时满足 §9.F 的 eyebrow 克制。
6. **不加「Enter 发送 / Shift+Enter 换行」提示行**。理由：① aria-zh 门禁拉丁词，挂 aria/title
   会直接判红；② 做成可见文案要动 zh-purity 的 ALLOW 且是永久性视觉杂音；③ 这两个键位是
   通用直觉。票面要的是行为 + 门改判，没要提示标签。
7. **上传预检数字对齐生产 env**（10 / 10 MiB / 32 MiB 总量），单点常量 + 注释互指 `guards.py:42-47`。
8. **file chip 用回执 `documents[]` 构造**；根治归 #74/S2。
9. **`appendFiles` 补 store 级重入闸**（#73 缺口 8），与 `askLive` 同款临界区写法。

## 5 · 新文案键（zh.ts + en.ts 同一 commit，扁平 camelCase，零 em-dash）

| 键 | 组 | 中文 | 英文 |
|---|---|---|---|
| `liveInterrupted` | nexus | 已停止，这轮没答完 | Stopped before it finished |
| `roomStopLabel` | lite2 | 停止 | Stop |
| `roomStopAria` | lite2 | 停止本次生成 | Stop generating |
| `roomFlowInterrupted` | lite2 | 你按了停止，分析停在这里了。 | You stopped this. The analysis ends here. |
| `roomAttachAria` | lite2 | 上传文件一起问 | Attach a file to this question |
| `roomAttachBusy` | lite2 | 正在读这份文件，大概要一两分钟 | Reading this file. Usually a minute or two. |
| `roomAttachFailed` | lite2 | 这份文件没读进来 | This file could not be read |
| `roomAttachTooMany` | lite2 | 一次最多传 {max} 个文件 | Up to {max} files at a time |
| `roomAttachTooLarge` | lite2 | {name} 超过 {max}，传不了 | {name} is over {max} and cannot be sent |
| `roomAttachRemoveAria` | lite2 | 移除 {label} | Remove {label} |

⚠ aria 值必须**纯中文**（`verify-aria-zh.mjs:60`：≥2 个连续拉丁词、或单个长度≥4 的拉丁词
即红，白名单只有 `Avery|demo`）。
