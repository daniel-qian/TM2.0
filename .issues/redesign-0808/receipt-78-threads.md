# 回执 · #78 advise-threads 真线程（0808 UIUX 重构战役 · wave 2 / S3）

> 日期 2026-08-09 · 分支 `claude/gracious-pasteur-633678` · 未 push、未上产。
> 开工前的设计裁定与新查出来的事实在同目录 `design-78-threads.md`；侦察正源是 `recon-history.md`；
> 议事室现状正源是 `receipt-75-room-claude.md`。

## 一句话

「一场对话」从此是数据库里的第一类概念：`advise_runs` 多了一列 `thread_id`（迁移 0016），
续问原样带回同一场，历史面板从「一条条问答」变成「一场场对话」，点一场把整场恢复进议事室
接着问。thread_id **由服务端铸并经 SSE 回传**——不是前端自己发一个 uuid，因为那样「老后端
忽略了这个键」这一幕**没有任何信号**，界面会一边显示在续场一边每问开一场新的。

## 做了什么

| 票面项 | 落地 |
|---|---|
| 迁移 0016 | `ADD COLUMN IF NOT EXISTS thread_id text` + `(context_id, thread_id, seq)` 索引 + COMMENT。**无回填 UPDATE**（每次 bootstrap 全量重放，回填＝每次开机全表扫；且给存量行编一个场就是编事实） |
| /advise 契约 | 请求可选 `thread_id`（additive，缺键=开新场）；服务端归一（形状闸 `service/threads.py`，坏值当没带**不 422**）→ 没带就 `new_thread_id()` → 经 `_with_thread_id` 贴到 **started + manifest** 两帧回传 |
| 持久化 | `_persist_advise_run` 透传；空串 ⟺ 列侧 NULL ⟺ 无场归属（存量行与「没带」同解，读侧一视同仁按单轮成一场） |
| 分组读面 | **新端点** `GET /team/{id}/advise-threads` → `{context_id, threads:[{thread_id, runs:[…]}]}`。平铺那条一个字节不动（它的四条契约测试留作回归网，`thread_id` 靠 `asdict` 自动 additive 进去） |
| registry 锁步 | `AdviseRun.thread_id` / `new_thread_id()` / `AdviseThread` dataclass / `append_advise_run` 加 kw / `list_advise_threads` **双实现** / Protocol 三处同拍 |
| 前端 | `LiteRoomHistory` 重写成按场列表；`hydrateThread` action（替换 + busy 闸 + 幂等闸 + 尾轮镜像同步）；`askLive` 条件展开带 thread_id；回传上提到 `store.threadId`；公司域清理**三抄本**各加两个字段 |
| 回灌轮诚实降级 | 不渲染四相面板（否则 4×「待命」是假话）· 不挂实时状态条 · 无引用 chips（refs 结构性没落库）· 一行「从历史载入」可辨 · `data-turn-hydrated` 抓手 |

**刻意没做**：会话侧栏（0808 拍板没选）· 短答路 followups 补存（票内裁，见下）· 文案批改（#79）。

## 三个政策拍板（票面要求票内定）

| # | 拍板 | 为什么 |
|---|---|---|
| (a) hydrate 是**替换**不是追加 | 替换 | 追加会让 `buildAdviseHistory` 把两场不相干的对话缝进同一个 `history` 数组，而续问只能带**一个** thread_id ——屏上两场、落库一场，是结构性撒谎 |
| (b) 尾轮 running 时**禁点** | 禁点（不排队） | 排队要引入一个隐藏状态机，而 #75 刚把「假 complete」这类隐藏状态清干净。**两把锁配两条判据**：UI `disabled` + store busy 闸 |
| (c) 同场重复点**幂等** | 幂等 | 不只是防抖：用户可能已经在这场里续问过新轮，而手上的分组快照还没有它们，重灌＝把刚问的抹掉 |

### 短答路 followups：**不补存**（票内裁）

1. `answer` 列是纯 text（`registry.py` + `0012:38`）。要存 followups 就得再加一列、或把 answer
   改成 jsonb —— 后者打破「advice 与 answer 互斥」这条既有契约（`LiteAdviceCard` 的分流靠它）。
   本票的迁移预算是**一列 thread_id**，为一组装饰性 chips 再动一次表不划算。
2. 缺失是**可辨的**：hydrate 出的短答轮就是没有 chips，与「有 chips 但点了没反应」不是一回事。
3. 价值面窄：followups 是「接着可以问」的快捷入口，而 #78 给的正是「直接接着打字问」的能力。

**对称记账**：advice 路的 followups 存在 jsonb 里、**可以恢复**（hydrate 时另调 `coerceFollowups`
从 `advice.followup_questions` 取——`coerceAdvice` 是白名单构造，不产这个键）。所以历史场的尾轮
**advice 路会出 chips、短答路不会**。这条不对称是真实的存储差异，不是 bug。

### interrupted 轮的语义（票面要求写清）

被按停的那一轮**通常不进历史**：中止时根本没有 manifest，`_post_advise_hooks` 一次都不会被调。
唯一的例外是「服务端已经答完、帧还没送到浏览器」那个窄窗口——那一轮会落库，于是它出现在历史
场里，而前端当时显示的是已中断。所以准确的说法是：**历史场里只有完整轮；但「我按停的那轮一定
不在里面」不是绝对保证**。

### thread_id 与 history 的分工（新立的一条碑）

**thread_id 回答「这一行属于哪一场」（归档面），history 回答「这一问带多少上下文」（推理面）。**
服务端**不**根据 thread_id 去库里补历史轮：
- 前端 `buildAdviseHistory` 本来就从 `turns` 组装，而 hydrate 出来的轮**就在 `turns` 里**——
  「点一场 → 续问带上下文」在组装层**零改动**成立（recon-history §2.3 已证，本轮门 ⑧ 实测 history 长度 2）。
- 服务端自动 hydrate 会让 `test_advise_history.py` 三条轮数断言全红，且与 `history.py` 头注
  「Nothing here is persisted」打架。两条路都塞 = 双份上下文。

## 开工侦察查出来的、与票面/既有认知不同的事实

1. **转述行号全废**（#75 之后整体下移）：`LiteRoomHistory` 403-475 → **473-545**；挂载点 678 → **860**；
   内存 `append_advise_run` 849-864 → **859-874**；Protocol advise 段 1269-1273 → **1279-1283**；
   公司域三抄本 854/890/1522 → **887 / 930 / 1630**；`roomHistoryTitle` zh:1247 → **zh.ts:1311**。
   `app.py:344-371` 与 `pg_registry.py:716-748` 两处转述是对的。
2. **后端根本没有 `phase` 事件**——SSE 只有 7 种（`started/think/tool/observe/nudge/manifest/error`），
   四相是 `streamSource.ts` 的 `countStep` 前端派生的。所以 thread_id 只能挂既有帧。
3. **新开一种 SSE 帧型 = 前端静默吃掉**：`applyEvent` 是 `switch` + `default: break`；而且
   `LiteAgentEvent` 有索引签名，后端多发的键**TS 不报、运行时不崩、控制台不吭**。
   → 「后端发了、前端没接」在这条链上**没有任何一层会红**，判据必须落在 store 槽位的**值**上。
4. **`ContextRegistry.clear()` 从 #49 起就漏了 `_advise_runs`**。没被咬到纯属运气（既有测试每次
   用新铸的 cid）。按场分组的测试一旦复用固定 cid 就会吃到上一条的残留轮——**在本票血缘内修掉**并配门。
5. **`test_registry_protocol.py` 的钉子与票面转述不同**：那条 `assert "delete" not in protocol_members()`
   只钉 `delete` 一个名字，不挡加方法/加参数；#77「走独立模块绕开」的理由也是另一件事
   （绝不新造 `CompanyContext`）。**#78 不能照抄那个先例**——thread_id 是 seam 上的真列。
   真正的钉子是「两 adapter 签名逐字相同」，而**它够不着 Protocol 自己**（只改 Protocol、两 adapter
   都不改 → 三条测试全绿）。本票把这个暗区补上了（见下）。
6. **pg 的 SELECT 列序与元组解包裸耦合**，加列插中间是 text↔text 对调、两边都不吭声。
   照同文件 `_FORM_SUB_COLS` 的先例提成了 `_ADVISE_COLS` 常量 + `_advise_run_from_row` 单点解包。
7. **`data-room-composer` 从未落地**：`lite2.css` 与 `design-75-73.md` 都写着门已改判到它，
   全仓 grep 只有三处**注释**命中，DOM 上没有这个属性。写新门别照注释抄选择器。
8. **历史面板在门与像素里都是零覆盖**：`.lite-room-history*` / `adviseRuns` 在 43+ 道门里 grep 零命中，
   snippet 也没有；`visual.spec.mjs` 的 room 四张拍的是 `contextId===null` 的无材料态，
   `visual-data.spec.mjs` 压根不含 room。**「改历史面板必漂基线」是错的预判**（与 #75 那次「必漂」
   反着骗同族）——反过来说，也**拿不到任何视觉回归保护**，新门必须自己长出全部判据。
9. **PostgreSQL 的 text 不允许 NUL 字节**：分组键本来想用 `E'\x00run:' || id` 当「肯定不冲突」的
   哨兵，那是**直接报错不是安全**。改用 `'run:' || id`（冒号不在形状闸放行的字符集里）。

## 门与判据

### 新门 `verify-room-threads.mjs`（40 判据，已入册 A 区 · room-conversation 之后）

⓪自证语料 · ①第一问不带 thread_id（additive absent≠none）· ②回传落进 store 的槽位 ·
③续问请求体带同一个 id（网络层，不落 store）· ④两问归成一场两轮 · ⑤离开再回来 turns 与 threadId
一起清 · ⑥点一场整场按对话顺序回屏且带着回答 · ⑦回灌轮四条降级判据 · ⑧hydrate 后续问仍落同场
（且落库真的从两轮变三轮）· ⑨a/⑨b 禁点两把锁各一条 · ⑩幂等 · ⑪无 pageerror。

**A 区从 33 道变 34 道。**

### 既有门改判：**零**

`.lite-room-history*` 与 `adviseRuns` 在既有门里零命中（见上 §8），所以这次没有一道既有门需要改判。
`verify-room-conversation` ⑥「离开议事室 = 这场对话结束」是本票的正面撞车点——设计上让
**hydrate 只由「点某一场」显式触发**（进屋不自动恢复、不落任何 storage），那条判据一个字不用改。

### 变异台账（8 条，**逐条独立跑**）

| 变异 | 结果 |
|---|---|
| M-A 去掉 `askLive` 请求体里的 thread_id 条件展开 | **25/14**，③⑧ 与下游全红 |
| M-B 去掉历史条目的 `disabled` | **38/1**，精确红 ⑨a |
| M-C（第一版）去掉 store 的 busy 闸 | **39/0 活下来了** —— 见下「两个门洞」 |
| M-C（订正版）同上，判据改用**另一场**试 | 精确红 ⑨b |
| M-D 回灌轮照常渲染四相 | **37/2**，红 ⑦ 组 |
| M-E 后端 `_with_thread_id` 不注入 | 红 ②③④⑥ 一片；**第一版整份门 crash**（见下） |
| M-F（第一版）去掉幂等闸 | **39/0 活下来了** —— 见下 |
| M-F（订正版）判据改判「刚问那轮还是不是活轮」 | 精确红 ⑩ |
| M-G 后端分组按 seq DESC 回 | **38/1**，精确红 ⑥ 的顺序判据 |

#### 两个门洞（都是判据的问题，不是代码的问题）

- **M-C 活下来 = belt-and-braces 的经典形态**。⑨b 原本拿 `adviseThreads[0]` 去试，而那一刻它
  恰好**就是当前这一场**——先撞上的是**幂等闸**，于是把 busy 闸整个拆掉判据照样绿。
  外层规则让内层规则免疫了变异。订正：拿**另一场**（tidB）试，只剩 busy 闸能挡。
- **M-F 活下来 = 尺子太宽**。⑩ 原本判「3 轮且最后一句是 Q4」，而那时后端已经把 Q4 收进了同一场，
  **重灌一遍出来还是 3 轮、最后一句还是 Q4**——判据分辨不出「没重灌」和「用刷新过的快照重灌了」。
  订正：判**刚问那一轮还是不是活轮**（`hydrated === false`）——重灌会把它换成 hydrated 拷贝，
  那正是「把刚问的抹掉」的可观测形态。

#### 一处门自身的健壮性修复

M-E 第一版把整份门**跑崩了**（不是 FAIL）：thread_id 为 null 时
`page.locator('[data-history-thread="null"]').getAttribute(...)` 命中 0 个、Playwright 抛错，
连汇总行都不打印——正是 #75 记过的「会崩不会红」家族，也是最难诊断的一类。
已改成先判 `count()` 再取属性，缺行时记一条 FAIL。

### 后端测试

- 新增 `tests/test_advise_threads.py`（**10 条**，全离线）：服务端铸并**两帧都回传** · 同 id 落同场 ·
  不带 id 每问自成一场（兼容闸）· 场按最近活动排且场内按对话顺序 · 坏值当没带**不 422** ·
  跨公司同 id 不并场 · 存量行各自单场 · 门与 notes 同一张 · 空历史 200+`[]` 不是 404 ·
  thread_id 绝不进 `manifest["advice"]`。
- `tests/test_registry_contract.py` 扩：6 条孪生（内存 + pg 双腿）——字段往返（盯 pg 列序错位）·
  分组与排序 · **limit 数场不数行且场必须整场回** · 存量行自成一场 · 跨 context 不串 ·
  `clear()` 清 advise_runs；另加一条 `@needs_db` 重启孪生。
- `tests/test_registry_protocol.py` **补上暗区**：新增「Protocol 签名 == 两 adapter 签名」的三方比对。
  **born-red 验过**：把 Protocol 的 `limit` 默认值从 20 改成 21 → 两个 adapter 各红一条；改回即绿。
- `tests/test_advise_runs_http.py:74` 的契约键元组加 `thread_id`（否则新键没有任何门看着）。

## 验证账

| 电池 | 结果 |
|---|---|
| `npm run typecheck` | 绿 |
| 离线 pytest（四 deselect，`TZ=UTC`） | **4045 passed**（基线 4028 + 17 条新增） |
| needs_db（本地 throwaway 库 `redesign0808`） | **115 passed**（#77 基线 109 + 本票 6 条）。**0016 真在库上**：`\d avery.advise_runs` 见到 `thread_id text` 与 `advise_runs_ctx_thread_seq_idx`，且列追加在**末尾**（没有把既有列挤位） |
| 新门 `verify-room-threads` | **40 PASS · 0 FAIL** |
| 电池 A 区 | **34/34 绿**（含新入册的 room-threads）。人眼过改完那两处 CSS 之后**又复跑一遍，仍 34/34**；像素也复跑，仍 8/8、50 张 md5 未变 |
| 电池 B 区 | data-boundary **37/37** · null-owner **15/0（真跑到了，不是记「没跑」）** · visual **8/8** |
| 电池 C 区 | **3/3 绿**。跑完按纪律重打了带 `VITE_AVERY_API_BASE` 的 dist 并**验过 apiBase**（`window.__AVERY_BUILD__.apiBase === http://127.0.0.1:8177`） |
| 像素（主检出真比对） | **8/8 绿，50 张 md5 逐字节一致**（比对前后各存一次全表 md5 做 diff ＝ 真比对不是首写；首写会先 FAIL 再落盘） |

### 🔴 那个「零漂移」要这么读

与 #75 那次同一条口径，方向相反地也要说清：**像素门对本票的改动面是零覆盖**。
`visual.spec.mjs` 的 room 四张采的是 `contextId === null` 的无材料态（`LiteRoomHistory` 在那里
直接 `return null`，连 composer 和 board 都不在画面里），`visual-data.spec.mjs` 的 `SCREENS`
压根不含 room。所以「改历史面板 → 基线必漂」是**错的预判**（本票开工前就按侦察实证否掉了），
而这 8/8 也**不构成**本票的视觉证据。视觉证据是下面那 20 张手拍截图。

### null-owner 顺手修了一行（记账）

`.issues/v02-joint-0719/verify-null-owner.mjs` 的 `const UI` 此前**写死** `127.0.0.1:5173`。
问题不是"跑不到别的端口"，而是**跑到别的树**：隔离端口的 session 一跑它，验的是碰巧占着 5173
的那份构建——本轮 5173 上就是主检出 `D:\avery` 的 preview。那种绿是假绿，而它在 progress.md 里
长期被记成「没跑」。改成 `process.env.VERIFY_BASE || 'http://127.0.0.1:5173'`（与全仓其余门、
含 `visual*.spec.mjs` 同一口径），缺省行为一个字节不变。改完真跑：**15 PASS · 0 FAIL**。
⚠ 顺带订正一条长期记档：**`visual.spec.mjs` / `visual-data.spec.mjs` 并没有写死 5173**，
两份都读 `VERIFY_BASE`（`:29`）——「visual 也写死 5173」是过期转述。

## 人眼过（20 张，双视口 × 双皮）

各态：历史面板展开（按场分组）· 点开一场的 hydrate 态 · 回灌轮 + 活轮并存 · 生成中禁点态 ·
回灌轮顶部（那行「从历史载入」）。**逮到两处门全绿但眼睛能看见的问题，都已修并复跑**：

1. **面板是个很高的空盒子**：`.lite-room-history-panel` 写的是 `bottom: …`（顶天立地），那是
   为「就地展开判读卡」定的高度；现在里面只剩几行「场」，两三场时屏上就是一个七百多像素高的
   空框。改成 `max-height`（让位余量原样保留成上限），高度跟着内容走、超出照旧内滚。
2. **半透明背景真的透字**：`rgba(--lite2-surface-rgb, 0.96)` 在议事室这种满屏内容上，
   手机态能从面板里读出下面那张判读卡的标题。浮层不是玻璃——改成不透明。

两处都是**一条门都不会红**的那类问题（历史面板在门与像素里都零覆盖，见上）。

### 环境与跑法（复现用）

```
后端: cd eval-harness && AVERY_BRAIN=mock AVERY_EXTRACTOR=heuristic AVERY_EMBEDDINGS=keyword \
      AVERY_DEMO_SEED_DIR=tests/fixtures/demo-seed AVERY_PUBLIC_BASE=http://127.0.0.1:8177 \
      AVERY_CORS_ORIGINS=http://localhost:5177,http://127.0.0.1:5177 \
      python -m uvicorn service.app:app --host 127.0.0.1 --port 8177 --app-dir .
前端: VITE_AVERY_API_BASE=http://127.0.0.1:8177 npx vite build --mode development
      npx vite preview --port 5177 --host
门:   VERIFY_BASE=http://127.0.0.1:5177 VERIFY_API=http://127.0.0.1:8177 \
      node eval-harness/tools/run-battery.mjs --only=A   （再 --only=B / --only=C）
```

⚠ 本轮 **5173 被主检出 `D:\avery` 的一份 preview 占着**（不是本 session 起的，没动它）——
所有门一律走隔离端口 5177/8177。
⚠ 改完后端必须**按端口杀掉重起 uvicorn**：它不热重载，`/advise-threads` 是新路由，
跑在旧进程上会以「历史面板空的」这种误诊断形态假红。
⚠ 数门数用 `--only=A --dry`（**不是 `--dry-run`**，那个拼法 CLI 不认，会真跑整个 A 区）。

## 刻意留下的账

- **短答路 followups 仍然丢**（`app.py` 只取 `answer.text`）——票内裁不补存，理由见上。
- **`roomHistoryTitle` 的值没动**（仍是「之前问过的」）：文案批改归 #79，本票只让它旁边的计数
  从「条」变成「场」并由新键 `roomHistoryCount` 显式说出单位。
- **`fetchAdviseRuns` / `refreshAdviseRuns` 前端已无消费者**（界面改读分组那条）。没有删——
  后端那个平铺读面仍是公开契约、四条测试盯着它；前端这两个留作能力探测的对称面。
- **历史面板仍无像素覆盖**：`visual.spec.mjs` 的 room 四张是无材料态、`visual-data.spec.mjs` 无 room。
  #79 全量重冻时值得考虑给议事室补一张「有历史 + 面板展开」的数据态基线。
- **`.issues/gap-design-0805/t8-e2e.mjs:514` 的反向判断**（`room.status !== 'error'`）仍在，
  #75 记过；本票新增的 hydrated 轮同样会被它当成通过。一次性门，未改。
