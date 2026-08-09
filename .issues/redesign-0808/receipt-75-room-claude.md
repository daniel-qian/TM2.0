# 回执 · #75 议事室 Claude 化 + #73 现场附件（0808 UIUX 重构战役 · wave 1 / S1）

> 日期 2026-08-09 · 分支 `claude/infallible-wilbur-10deaa` · 未 push、未上产。
> 开工前的设计裁定与新查出来的事实在同目录 `design-75-73.md`；侦察正源是 `recon-room.md`。

## 一句话

议事室的空态与对话态从此是**同一棵树**：滚动区 + 屏底常驻 composer。
「发问零跳变」不是形容词——门里量的是同一个节点的 x/y/宽，实测 `(226, 810, 828)` 在第一问
前后逐像素不变。顺带把「按了停止却被收成 complete」这条会撒谎的路补成了诚实的 `interrupted`。

## 做了什么

| 票面项 | 落地 |
|---|---|
| docked composer 三态统一 | 空态不再复用 story 的 `.nexus-empty` 居中卡（absolute top:42%）。开场块变成 board 里的第一块内容，composer 恒在屏底、恒是 `.lite-room` 直接子元素。`.nexus-empty-composer-wrap` 整个退役 |
| 消息流 + markdown | 短答走自渲染的最小 md 子集（段落/标题/列表/引用/围栏码/管道表格/粗斜码链接）。**零新依赖、零 `dangerouslySetInnerHTML`** |
| 停止生成 | `LiveRunState.status` 加第五个值 `'interrupted'`；停止键与发送键并存（`type="button"`）；诚实终态：面板出「你按了停止」、HUD 说「已停止，这轮没答完」、相位不封 done、不出追问 chips、铃铛不响 |
| 多行输入 | `<input>` → `<textarea>`，Enter 发送 / Shift+Enter 换行 / 自动长高封顶 168px；**IME 合成中的 Enter 让给输入法** |
| 胶囊即发 | `AskAveryLauncher.submit` 从 `goScreen('room',{q})` 中继改成 `goScreen('room')` + 同拍 `askLive` |
| #73 附件 | composer 附件钮 → append 入库 → 等待态 → 完成挂 file ref chip；**选文件时预检**上限（10 个 / 10 MiB / 批 32 MiB），超限零请求 |
| 样式债 | room 段聚拢到文件尾一块；`--lite2-room-col` / `--lite2-room-composer-gap` / `--lite2-room-dock-clear` 三个语义 token 替掉裸数字 828/12/150 |

**刻意没做**：会话侧栏（拍板没选）· `LiteRoomHistory`（#78 地盘，一行没动）· 文案批改（#79）。

## 开工侦察查出来的、与票面/既有认知不同的事实

1. **composer 其实只有两套几何要合并，不是三套**。胶囊 `.lite-ask-avery-form` 是全局入口，
   与 room 内部两套从不共存。
2. **数据态 14 张像素基线里的胶囊是收起的 pill 按钮**（`<button>`，不是 form）——
   textarea 化**碰不到那 14 张**。此前「改胶囊 → 14+36 大面积红」的预判在这一项上不成立。
3. **三个「会崩不会红」的抓手**：`input[type="text"]`（命中 0 个）、`button[type="submit"]`
   （新按钮忘写 type 会命中 2 个）——Playwright 都是**抛错**，整份门 crash、连汇总行都不打印。
4. **`verify-at-references.mjs` 的裸 Enter 被 ⑨ 段 7 个入口全复用**。票面选「Enter 发送」
   正好保住它；反过来选 Ctrl+Enter 的话，那一行不报错、只会往框里敲个换行符，
   28 条判据以「入口没接上引用」的**误诊断形态**假红。
5. **假 complete 的确切出生地**是 `streamSource.ts` onDone 的**黑名单**兜底
   （`!== 'error' && !== 'complete'`），加上 `transport` 的 abort 走「无 error 的 onDone」。
   两层撒谎：status 本身 + `sealPhases` 把在跑的那一相封成 done（比 error 待遇还宽）。
6. **`stubTransport` 的 abort 一次 onDone 都不调** → stub 通道 abort = 永久 running。
   真通道假 complete、stub 通道永久 running，两条路的中止语义此前根本对不上。
   本票在 source 层包装 abort，两条路一起对上。
7. **后端 `/advise` 对客户端断开零处理**（全 service 目录无 `is_disconnected`），
   引擎是同步生成器跑在 threadpool 里 → **当前那一步 LLM 调用会跑完**。
   所以文案只说「不再等它」，一个字都不提「省下」。
8. **没有任何端点暴露上传上限**（逐个确认过全部已注册路由）。413 里那些人话数字是踩线之后
   才吐的。预检只能自己维护一份数字，且必须对齐**生产 env**（10/10 MiB）而不是
   `guards.py` 的代码默认值（15/8 MiB）。
9. **`store.files[].filename` 不是权威名**：回执 `appended.documents` 给的是
   `sd.source_key`（消歧后），而 `GET /team/{id}/files` 回填的是 `sd.filename`（原始名），
   撞名时两行字面完全相同、只靠 idx 区分；后端解引用是 `next(...)` 取第一个命中。
   → chip 用**回执**构造。id 契约的根治归 **#74 / S2**。

## 门与判据

### 新门 `verify-room-claude-rework.mjs`（46 判据，已入册 A 区）
三态统一结构纪律 · 发问零跳变（量 x/y/宽）· 停止全套 · 多行两个键位 · markdown 敌意语料 XSS ·
附件预检零请求。跑法与环境写在文件头。

### 既有门改判（全仓扫过，含 glob 暗区）
- `verify-at-references.mjs`：8 处 `input[type=text]` + 胶囊 1 处 + submit 1 处 → `[data-composer-*]`；
  `pickerGeom` 的地基选择器；`clearInputEl` 合并两份内联拷贝并按 tag 取 setter；
  ⑥ 段胶囊中继判据**整段重写**（即发之后 POST 提前，旧的下标记账全部错位）；
  ⑧ 运行态自证从 `.lite-room-scroll`（现在两态都在＝恒真空转）换成「有轮次在屏上」。
- `verify-room-conversation.mjs`：input/submit 抓手；⑥ 空态自证从 `.nexus-empty-composer-wrap form`
  换成 `[data-room-turns="0"]` + composer 在场，并给变量正名。
- `scripts/gates/live-frontend-gate.snippet.js`（**`*verify-*.mjs` glob 之外的暗区**）：
  F1/F2 两条选择器去掉没有类型限定的裸 `input` 子句 + 三处 `$('.nexus-followup-composer input')`。
  ⚠ **侦察只报了两处（1793/1795、2205/2207），自查扫出第三处 2640/2641**——
  票面/转述的行号一律要自己复核。

### 变异台账（8 条，**逐条独立跑**）

| 变异 | 内容 | 结果 |
|---|---|---|
| M-A（第一版）| `width: var(--lite2-room-col)` → `440px` | **活下来了**。查根因：那个宽度**两态共用**，改完两态仍一样宽，而 ② 判的是「前后不变」这个不变量——它正确地保持为真。**是我把变异设计错了，不是门有洞。** |
| M-A（订正版）| 只把**空态那一半**的 composer 挪走（`:has()` 限定） | 45/1，精确红 ② |
| M-B | 去掉 `!event.shiftKey` | 43/3，红 ④ 全组 |
| M-C | onDone 白名单改回黑名单 | 42/4，红 ③；`storeStatus="complete"`、HUD「分析好了，可以看了」——**原病根逐字复现** |
| M-D | HUD 三元去掉 interrupted 支 | 45/1，精确红 HUD 那条 |
| M-E | `isSafeHref` 恒真 | 44/2，红 ⑦；`anchors: ["javascript:window.__XSS_FIRED=1"]` |
| M-F | 去掉附件预检 | 38/6，红 ⑧；`before=0 now=1`（请求真的出去了） |
| M-G/M-H | composer 塞进 `.lite-room-board`（M-H 是单节点忠实版）| 红 ① 结构组 |

**推翻了一条侦察预判**：侦察说「composer 塞进 board 会让 `room-usability` 变**假绿**」。
M-H 真跑推翻——那道门取 `board.children[last]` 当最后一张卡，composer 自己跟自己比时
`bottom > top` 恒成立、`clear` 恒 false，结果是**恒红不是恒绿**。危害仍在
（红得像「让位不够」、其实是「结构错了」，属最易误诊的一类），但方向与预判相反。
门里那句措辞已按实测改掉。

### 电池（隔离端口 5175/8175，离线三件套 + demo seed + CORS）
- **A 区 32/32 绿**（含新入册的 room-claude-rework）。改完观感又复跑一遍，仍 32/32。
- **B 区 3/3 绿**：data-boundary · **null-owner 真跑 15/0**（借标准端口 5173 起了一份 preview，
  不是记「没跑」）· visual-baseline。
- **C 区 3/3 绿**。跑完按纪律重打了带 `VITE_AVERY_API_BASE` 的 dist 并**验过 apiBase**
  （dist 里只出现 `http://127.0.0.1:8175`）。
- **pytest 4010 passed / 0 failed**（本票零后端改动，与 #72 基线一致）。

🔴 **像素基线在本 worktree 里证明不了零漂移**。实测记录：电池第一次跑 B 区时 visual 因为
写死 `localhost:5173` 而 CONNECTION_REFUSED，**一张都没比对**，却在目录里留下了 50 张
mtime 是当时的 PNG——差一点就被当成「基线在、比对过了」。已清掉重来：首写 → 复跑 8/8 绿，
**这只证稳定，不证零漂移**。真比对必须在主检出对着真基线做。

## 人眼过（26 张，双视口 × 双皮 + 无材料态）

各态：无材料 / 空态 / markdown 回答 / 生成中 / 已中断 / 附件读取中 / 多行长高。
**逮到三处门全绿但眼睛能看见的问题，都已修并复跑**：

1. **建议 chips 居中**：基座 `.lite-room-chip-row` 是 `justify-content:center; max-width:640px;
   margin:0 auto`——那是给 story 那张居中卡写的。开场块左对齐之后，标题贴左、chips 居中，
   390px 手机上左边空出一大条。（#72 的追问 chips 早为同一理由覆盖过一次，这是第二个用户。）
2. **手机态 composer 换行崩了**：textarea 的 `flex: 1 1 240px` 加两枚按钮塞不进 358px，
   发送键被挤到第二行**左下角**。窄屏改成两行：正文占满一行，控件另起一行靠右。
3. **HUD 自相矛盾**：状态条眉标写死「正在仔细梳理中 · 实时」，于是中断态并排显示
   「正在仔细梳理中」＋「已停止，这轮没答完」。（ready 态其实早有这毛病，本票新增的中断态
   把它顶到了脸上。）改成**只在真的在跑时才渲染那条眉标**——动的是渲染条件不是字典值，
   不越界进 #79。

## 刻意留下的账（交给谁写清楚了）

- **`LiteRoomHistory` 里回放的短答仍是纯文本**，与会话流里的 markdown 渲染不一致。
  刻意不动（#78 地盘）。→ **#78**
- **file ref 的 id 契约**：本票用回执的 `source_key` 走「今天能对的那条路」，
  没有根治「`store.files[].filename` 撞名不可分辨」。→ **#74 / S2**
- **上传上限三处散落**（本票新增的 `uploadLimits.ts` / `UploadPanel.tsx:28` /
  `guards.py`），已互指注释，收敛归 **#76 / S2**（他们正在那个文件里）。
- **`--lite2-bottom-band` 是幽灵 token**（全文件无赋值，三处消费全走 120px 兜底）；
  **`--lite2-clear-top` 的 ≤860 覆盖写了两遍**，早段 72px 已被后段 24px 静默架空。
  本票只记账不改值（改值＝改视觉，归 #79 那一波）。
- **`.issues/gap-design-0805/t8-e2e.mjs:514` 是 `room.status !== 'error'` 的反向判断**，
  `interrupted` 会被它当成通过。一次性门，本票不改，记在这儿。
- **`nexus-brief-hud` 与四相面板仍在说同一件事**（recon §4-11）。本票只修了眉标撒谎那半，
  去重属纯 UI 取舍，没动。
- **at-references ⑧ 的宿主矩阵缩水了**：三态统一之后空态与运行态的 composer 几何**一样**，
  (a)/(b) 与 (e)/(f) 不再是两种几何、只是两种内容量下的同一种。矩阵在视口档位与胶囊宿主上
  仍有价值，但别再读成「四种宿主」。已在门里注明。
- **停止的相位判据够不着病根**：门用路由延迟造生成窗口，中止时一个 SSE 事件都没收到、
  四相 steps 全 0，所以「有没有被盖成 done」那半分辨不出。真正钉住它的是 M-C 变异。
  要让它有牙得先让流吐几帧再中止，而那样就得赌墙上时钟（本仓有 Docker 时钟跳 115 秒的先例），不赌。

## 环境与跑法（复现用）

```
后端: cd eval-harness && AVERY_BRAIN=mock AVERY_EXTRACTOR=heuristic AVERY_EMBEDDINGS=keyword \
      AVERY_DEMO_SEED_DIR=tests/fixtures/demo-seed AVERY_PUBLIC_BASE=http://127.0.0.1:8175 \
      AVERY_CORS_ORIGINS=http://localhost:5175,http://127.0.0.1:5175 \
      python -m uvicorn service.app:app --host 127.0.0.1 --port 8175 --app-dir .
前端: VITE_AVERY_API_BASE=http://127.0.0.1:8175 npx vite build --mode development
      npx vite preview --port 5175 --host
门:   VERIFY_BASE=http://127.0.0.1:5175 VERIFY_API=http://127.0.0.1:8175 \
      node eval-harness/tools/run-battery.mjs --only=A   （再 --only=B / --only=C）
```
⚠ `verify-null-owner` 与 visual 两套都写死 `5173`，隔离端口跑不到——本轮另起了一份 5173
preview 才让它们真跑。
