# Session Progress Log

> 📢 本文件是**当前状态快照，整体重写不追加**。历史都在 git（`git log` + 各 `.issues/*/receipt*.md`），别在这儿堆编年史。
> 启动路径见 `AGENTS.md` Startup Workflow：读本文件 + `feature_list.json`，跑 `./init.sh` 确认绿，再开工。

**Last Updated:** 2026-08-10（**#86「清空这份档案」已落地**：后端两腿 + 路由 + transport/store + 新门，
**UI 挂点按票面留给 #84**。仍未 push、未上产）

## Current State

- **git**：`main` = 差距战役八票 + gap2 三票 + 三轮演习批 + #68 + #70 + #69+#71 + #72 +
  **0808 重构战役四波全部**（#73/#74/#75/#76/#77/#78/#79）+ wave 4（#80+#81）+ #82
  + **#86（0810 设计轮票 4 ·「清空这份档案」）**。
  回执七份：`redesign-0808/` 六份 + **`design-0810/receipt-86-archive-empty.md`（本批）**。
  ⚠ 别在这儿写死 ahead 数字——它每提交一次就自己作废。要数就跑：
  `git rev-list --count origin/main..HEAD`。
- **后端离线套基线：`TZ=UTC` → 4076 passed · 0 failed · 133 deselected · 4 xfailed**（约 37s）。
  = 上一基线 4049 + #86 的 27 条（21 条 `test_context_empty_t86.py` + 6 条 `test_registry_contract.py`
  的 memory 参数）。✅ **任何红都是你的。**
- **真库套（@needs_db）**：throwaway `avery_t86_test`（docker `teammaster-postgres-1` / pgvector pg17）
  跑 `test_context_empty_t86 + test_registry_contract + test_registry_protocol` → **125 passed · 0 failed**。
- **像素基线现状**：**54 张不变**。#86 零渲染改动（只动 `store.ts` / `transport.ts`，且新键今天无人读），
  按构造不可能漂——**本轮未跑 B 区**，理由记在回执 §5。
- **✅ 生产仍停在 08-07 白天那一版**（`main-20260807-190332` = main `99d83f7`）。
  gap2 三票 + 三轮演习批 + #68 + #70 + #69/#71 + #72 + 重构战役四波 + wave 4 + #82 + #86 都没有上产。
- 🔴 **迁移账（上产时按这个来）**：
  - **T9 需要 `0015_form_submissions_auto_key.sql`**（increment-only、`_ensure_schema()` 自动重放）。
  - **#78 需要 `0016_advise_runs_thread.sql`**（`ADD COLUMN IF NOT EXISTS thread_id` +
    `(context_id, thread_id, seq)` 索引；**无回填 UPDATE**）。已在本地 throwaway 库真跑过。
  - **#86 不需要迁移**（只对既有表 DELETE/INSERT/UPDATE，一列都没加）。#82/#80/#81/#79/#77/#76/#74/#75/#73 同。
  - 判据一句话：**动 dataclass 里被整块 jsonb 装着的字段 → 免迁移；动表的顶层列 → 必须迁移。**
  - ⚠ 但**「不需要迁移」不等于「不用跑 @needs_db」**：#86 动了 pg 腿，照跑（见上）。
- 🔴 **新依赖**：`@phosphor-icons/react@2.1.10`（wave 4 引入，票面拍板项，别被下一个人当漂移回滚）。
  ⚠ worktree 的 node_modules 是主检出的 junction：装依赖要在 `D:\avery` 装。
- 🔴 **合的都是本地 main，没有 push**。前端 push main 即自动构建上产，push + 换后端容器
  必须在统一上产 session 的**同一个窗口**里做。

## 本轮做完的（2026-08-10 · #86 archive-empty）

回执 `.issues/design-0810/receipt-86-archive-empty.md`（含语义裁定表、8 条变异台账、
两个自己逮到并封上的门洞、以及给 #84 的确认文案草稿）。

**做了什么**：`empty_context()` 落进 `ContextRegistryProtocol` + 两条腿 · 新路由
`POST /team/{context_id}/empty`（复用 `authorize_context`，回 `_team_payload`）·
`upload_guard._route_for` 认得它 · transport `emptyContext` · store `emptyArchive()` +
`archiveEmptying`/`archiveEmptyError`（**两抄本锁步**）· 新门 `verify-archive-empty`（zone A，25 判据）。

**语义**：清掉 `source_documents` / `source_files` / `materials` / `entities` 全五类 /
`granularity` / facts+notes 重物化成空。**留下** `context_id` · `owner_token` · `name` ·
对话历史 · Avery 的观察笔记 · 表单模板 · **员工已交答卷（含活的 H5 链接）** · 账号归属。

- 🔴 **订正一条票面前提**：「不能复用 `put()`」这个结论成立，但票面给的理由（`_prior_src_bytes` /
  `_prior_mat_vecs` 会回填旧字节旧向量）**今天咬不到**——空 ctx 插 0 行，那两条 `UPDATE...FROM`
  匹配不到任何行，三张表照样是空的（M6 变异下它们全绿）。真正把 M6 判红的是另一条路：
  `get()` 是**比对后写盘**，它把库里那份**旧 facts.md 写回磁盘**，`put()` 随后读到的就是这份旧文本、
  再原样存回 `memory_files`——**行删干净了，议事室 recall 还引得到已清掉的原文**。
  下一个人别照票面那句去找回填，它不在那儿。
- 🔴 **明知的雷已钉成正面判据**：留着答卷 ⇒ `POST /team/{id}/forms/{sub}/ingest` 会把实体重新灌回来，
  **「清空」不会自己保持为空**（`test_refiling_a_submission_after_empty_repopulates_the_archive`）。
  确认文案不许说「清空之后永远是空的」。
- **写门时自己逮到并封上两个洞**：① 「路由投清空前那份 ctx 快照」这条变异**离线 20/20 全绿、
  挂 DB 才红**——修法不是再写一条 `@needs_db`（默认电池照样反选），而是 monkeypatch 让内存腿的
  `get()` 返回深拷贝，把 pg 的快照语义搬到离线来；② 「按 dataclass 字段遍历清空」的判据**光靠真语料
  不够**——那份语料只喂得饱 7 条列表里的 4 条（signals/playbooks/conflicts 天生为空），
  「漏清 signals」的变异活得下来。现在清空前往每一条列表塞哨兵。

### 验证账

`TZ=UTC` 离线 **4076/0** · 真库 **125/0** · 新门 **25 PASS · 0 FAIL** ·
`npm run typecheck` 绿 · `vite build --mode development` 绿 · `eslint` 零输出 ·
`i18n-orphans` **0 孤儿**（本票没加任何 i18n 键）· **A 区门电池整轮见回执 §7**。
**变异 8 条逐条独立跑、跑完还原**，每条主判据配一个专属变异（M4 只在离线层验过，门未在 M4 下跑——记账不假装）。

## 上几轮做完的（详情全在各自回执，这里只留会影响下一个人的）

- **#82 表单测试拆墙钟炸弹**——`redesign-0808/receipt-82-clock-bomb.md`。产品零字节；
  病根是 `GET /team/{ctx}/forms/submissions` **读时会写**（T9 自动铸链）+ newest-first，
  W32→W33 翻周后 `submissions[0]` 读错东西。选行一律**按 id**。
- **wave 4 · #80 会话侧栏 + #81 composer**——`receipt-80-81-sidebar-composer.md`。右上弹窗 → 左侧常显
  侧栏（≤860 收抽屉）· composer 双行版式 + phosphor 图标（`src/lite2/icons.tsx`）。
- **wave 3 · #79 copy-sweep**——`receipt-79-copy-sweep.md`。zh 137 键改值 + 2 新 / en 28 改 + 2 新；
  像素 50 张全漂全量重冻。
- **wave 2 · #78 真线程**——`receipt-78-threads.md`。迁移 0016 · `GET /team/{id}/advise-threads`。
- **wave 1 · #75 议事室 Claude 化 + #73 现场附件** · **#74 + #77 + #76**（`receipt-76-77-74-files.md`）。
- **#72 / #69+#71 / #70 / #68 / #66+#67 / #65 / #64 / #63 / #61 / T9–T11**。

## What's Next（按优先级）

0. **🔴 0810 设计轮六票：#86 已完成，剩五票**。正源 `.issues/design-0810/design-plan.md`
   （Danny 2026-08-10「其他的设计方案全部通过」），原型 `proto/{room,files}.html`，证据 `_shots-0810/`。
   - **#83** 对话侧栏上皮肤 + 开场块居中（纯前端）
   - **#84** 资料库改两栏 file explorer（建议再拆 2a/2b/2c）　🔴 **它现在背着 #86 的两笔欠账，见下**
   - **#85** 「这次补料改了什么」只读清单（+已查阅）
   - ~~**#86**~~ ✅ 已落地（UI 挂点除外）
   - **#87** 实体血缘地基（**一张票同时喂「删文件收回结论」与「逐条撤回」**，值得单开一轮）
   - **#88** 撤掉「新建一家公司」——**前置 #86 已就位**：清空后 `contextId` 不变 / `knownContexts`
     长度不变 / 补料落回同一个 id，这三条都是 `verify-archive-empty` ③⑥ 的现成判据，可直接当回归网。
1. 🔴 **#84 必须一起收 #86 的两笔欠账**（详见 `receipt-86-archive-empty.md` §6）：
   - **① 挂 UI**：左栏最底一条，销毁类；**静息态不用红**（常驻的红会把整根栏染成警告区），红只在 hover 出现；
     点下去走硬确认（「输入店名才放行」）。后端/transport/store 全通了，
     `__lite2Store.getState().emptyArchive()` 就是那枚键按下去要发生的全部事情。**确认文案草稿在回执 §6①**。
     并且**回来给 `verify-archive-empty` 补一段「真点那枚键 + 硬确认走通」**——今天这道门驱动的是 store
     动作，`verify-append-story` ② 那条教训（不碰按钮的门放走过「按钮接错线」变异）在这里原样适用。
   - **② 🔴 空态文案现在是假话**：#86 新造出「有档案、零文件」这个**此前不可能存在**的状态，
     而资料库那一屏在这个状态下印的是「多半是这些文件没读出内容，重新传一次最快」——
     用户刚亲手清空，屏上把一次成功的销毁诊断成一次解析失败。今天没入口所以看不见，入口一上它就是第一句话。
     需要一条「你清空了这份档案，随时可以重新开始传」的分支（zh + en 两条键）。
2. **统一上产**（gap2 三票 + 三轮演习批 + #68 + 重构战役四波 + wave 4 + #82 + #86）。
   🔴 push 与换后端容器同窗口；**0015 + 0016 必须落地**；上产后先设 `AVERY_PUBLIC_BASE` 再验表单。
3. ⚠ **给下一个人的口径**：recon-sidebar / recon-composer 是好正源，但它们**各有一处已证的错**——
   任何侦察里的「这个值是 X」都要自己在浏览器里量到为止。
4. **W33「链接过期了」核实完毕：不是产品 bug**（两条假设都证伪）。真要修的是夹具卫生
   （`verify-forms-proactive.mjs:60` 硬写 `'2026-W01'`），属独立小票；另有一个真空洞：
   **没有任何测试断言自动铸链的 `expires_at` 数值**，在 `test_form_autofill_t9.py:569` 旁补一句
   `expires_at - created_at == 7 days` 很便宜。
5. **T8 两条记录**：① 议事室引用编号形状；② 今天页证据行机器形状（ADR-0033）。
6. **给 `/health` 加版本字段**。
7. carry-over：会话**改名 / 删除**（#80 v1 明确不做）· 侧栏 20 场硬上限 · **全应用 icon 统一**
   （#81 只做了对话页；动它＝54 张全重冻）· 判读卡 4 段死渲染 + 后端已发前端未消费 7 类字段 ·
   gate-run 迁移 · files-hub #26–#29 · 换血抢救 #31/#32 · v01 退役 #33 ·
   真机零覆盖（iOS/微信，最高优）· 成本票 #30 · 真 brain 分流取证 · 全量 feat-063。

## Notes（顺手发现，没顺手修）

- 🔴 **删文件不收回结论**：`delete_document_from_context` 只清 `materials`/`signals`/`granularity`/`conflicts`，
  **从不碰** `extraction.people` / `extraction.projects`。是 #77 的明文裁定（血缘不够），有测试钉着。开票 **#87**。
  ⚠ #86 **绕开了**这道坎（全清一定是对的），所以它能先落——但它不能替代 #87：
  逐份删仍然纠不干净，而清空是「整份重来」不是「改一处」。
- 🔴 **`empty_context` 与 pg 独有的 `delete()` 是反面**：后者删 `avery.contexts` 那一行本身，
  `context_id`/`owner_token` 一起没。`delete()` **永不挂 HTTP**（路由选 `POST /empty` 而不是
  `DELETE /team/{id}` 就是这个理由，写在路由 docstring 里）。`test_registry_protocol.py` 那条
  「内存腿不许长出 `delete()`」的 pin 原封未动。
- 🔴 **补传的旧值 10 个字段里 7 个无处可寻**：`AppendLedger.absorb` 直接 `setattr`，`put()` 是整快照替换，
  `stamp()` 连旧 provenance 也覆盖。撤回没法建在现状之上。
- ✅ **两个便宜的现成件**（做「自动更新清单」时别重造）：`provenance[f].origin === 'doc'`
  **恰好**标出「被后来的上传顶掉过」的格子；「已查阅」交互层 `flowStore.ts` 三态标记库已建好。
- ⚠ **两条要订正的旧结论**：`gapDerive.ts` **不消费 conflicts**；冲突到前端时**已是字符串**。
  另：**不带项目的人身上的 `team` 冲突今天哪块屏都到不了**。
- ⚠ **`verify-context-switch` ⑥ 的两条源码级判据是假绿雷**：`forgetContext` 被删掉之后它们**静默变绿**不是红。#88 改判时要主动退役。
- ⚠ **`uploadFiles` 有四个调用点**，`OnboardGate`（新用户第一次上传）与 `HomeScreen` 首页骨架卡**不能碰**。
  两条状态机也不能天真合并——`notifyStore` 靠 `ingesting→ready` 跃迁合成「团队已就绪」，合并了每次补料都误报。
- ⚠ **手机 390px 上文件行是 flex-wrap 的汤**：9 行 4 种高度 3 种内部顺序。#84 用固定 grid 骨架根治。
- ⚠ **`.lite-files-scroll` 是 `absolute inset:0`，Playwright `fullPage` 拍不到它的全长**——
  要拍资料库全屏得把视口调高（用 1440×3200）。
- 🟠 **`test_decision_grading.py:1050` 是另一族墙钟赌注**（#82 扫出，未修）：`date.today()` 是本地时区、
  `clone_context` 打的是 UTC 戳。不带 `TZ=UTC` 跑（UTC+8 的凌晨）真红。
- 🟠 **`GET /team/{ctx}/forms/submissions` 读时会写这件事，测试面没有集中说明**。
- 🔴 **`.lite-btn.lite-btn--ghost` / `--primary` 那两组 (0,3,0) 规则是一类隐形地雷**：
  任何 (0,2,0) 的按钮**配色覆盖**都会被静默压死，而**一道门都不会红**。
- 🔴 **`.lite-room-history-panel` 那一族 CSS（lite2.css 8288-8312）已整段变死**，照先例留碑不删。
  ⚠ 它的两条几何公式仍被手机抽屉与侧栏底沿**抄用**。
- 🔴 **手机 ≤860 的抽屉态在所有既有门里零覆盖**：四道门视口硬钉 1280×900 或最小 900 > 860。
- 🔴 **「composer 圆角恒定」在像素层没有覆盖**（born-red 实证：16→4px 的变异 0 红）。
- **Phosphor 不传 `size` 不是 0×0**：`IconContext` 默认 `1em`，跟着按钮字号走。
- 🔴 **aria 硬门对短拉丁黑话是瞎的**：`HR`、`1:1`、`New` 永远不报。
- **`gapCardClaimLabel` 与「资料里的实际情况」在同一张差距卡上不对仗**；**`projectsTitle`** 与同屏 lede 词族不齐。
- **mock 语料下判读卡的信号行是英文**；**mock 语料不产 confidence / script / metrics / escalation 四段**。
- **短答路 followups 落库仍被丢**（`app.py` 的 `_persist_advise_run` 只取 `answer.text`）。
- **`fetchAdviseRuns` / `refreshAdviseRuns` 前端已无消费者**——⚠ #86 起**不再成立**：
  `emptyArchive` 之后门要靠它证明历史还在，且 `refreshNotes` / `refreshForms` 被 `emptyArchive` 调用。
- **`--lite2-bottom-band` 是幽灵 token**；**`--lite2-clear-top` 的 ≤860 覆盖写了两遍**，早段已被后段静默架空。
- **`.issues/gap-design-0805/t8-e2e.mjs:514` 是 `room.status !== 'error'` 反向判断**。
- **`data-room-composer` 从未落地**（三处**注释**声称门已改判到它，DOM 上没有）。
- **`nexus-brief-hud` 与四相面板仍在说同一件事**。
- **switchContext 换公司时 `turns`/`run` 不清**——只有 `resetLiteCompanyData` 清。
  ⚠ 公司域清单现在是**三抄本**（`adoptContext` / 404 分支 / `resetLiteCompanyData`），
  #86 往前两份加了 `archiveEmptying`/`archiveEmptyError`；**404 分支那份历来就不全**，别照它抄。
- **中文名互为前缀仍双中**（「王力」vs「王力宏」）：词边界对 CJK 刻意不阻断，宁多勿漏。
- **`tests/test_at_references.py:90` 潜伏 typo**（`rep.errors` 应为 `parse_errors`）。
- **`>` 开头的材料块结构性不可引用**；**facts.md 指针不是单射**。
- 🔴 **`AVERY_PUBLIC_BASE` 必须指后端自己的口**（#63 实收）。
- **粒度闸够不着跨批次**（T10）；**`_people_from_roster` 位置兜底会顶掉空格子**（#61）。
- **`KeywordStore` 分词器是 `[a-z0-9]+`（纯 ASCII），对无空格中文 `query()` 恒空**——
  ⚠ 写「删/清之后检索不到」这类判据必须押 ASCII token，押中文串会全绿而它证明的是「之前也检索不到」。
- bellIsReal / nudgeVerdict 等手册协议相位仍无机械 runner。

## Blockers / Risks

- ✅ **~~离线 pytest 3 红＝已知墙钟炸弹~~ 已销账**（#82）。新基线 **4076 passed · 0 failed**，**任何红都是你的**。
- 🔴 **写测试别赌墙上时钟——ISO 周翻转是它的新形态**（#82 首爆）。三条经验：
  ① **列表端点可能读时会写**，`[0]` 从来不是「我刚建的那个」——按 id 选行；
  ② **错误的取样在结果恰好相同时完全隐形**；
  ③ **「哪一天跑都绿」读代码证不出来，得把钟真拨过去跑**（台架做法见 receipt-82 §4）。
- 🔴 **离线套对 pg 持久层是瞎的，而且它会以「全绿」的形态骗你**（#86 又实收一次）：
  「路由投的是清空**前**那份 ctx 快照」这条变异**离线 20/20 全绿、挂上 `AVERY_DB_URL` 才红一条**——
  病根是内存腿 `get()` 返回**活对象**、pg 腿返回**快照**，两者在「改完再投」这件事上语义相反。
  **修法不是再写一条 `@needs_db`**（默认电池照样反选它），而是 monkeypatch 让内存腿 `get()`
  返回深拷贝，把 pg 的语义搬到离线来。动 pg 腿仍必跑 `@needs_db`（throwaway 库起法见回执 §5）。
- 🔴 **变异活下来 ≠ 门有洞，也 ≠ 代码没 bug —— 先看变异有没有真的碰到被判的性质**。
  ⚠ **一条变异红一条判据 ≠ 它也能红旁边那条**：#86 实收，「按 dataclass 字段遍历清空」那条判据
  在真语料上只对 7 条列表里的 4 条有牙（另外三条天生为空），漏清 signals 的变异活得下来。
  **判据要对着被测性质的每一个实例都有牙，缺的就自己造出来**（往每条列表塞哨兵）。
  ⚠ **变异脚本自己也会撒谎**（#82 交了两次学费）：CRLF 锚点 / stdout 子串探针。
- 🟠 **别单独 push main**（实数跑 `git rev-list --count origin/main..HEAD`）：
  前端 push 即自动上产、后端容器要人手换，同窗口做。
- 🔴 **像素基线目录是 gitignored**（`.gitignore:34`），**每棵树各一份**：worktree 里那份是空的，
  在 worktree 跑 visual = **首写**，证明不了任何事。真比对：**在主检出 `D:\avery` 跑 playwright**，
  `VERIFY_BASE` 指向 worktree 的 preview。⚠ **改了 spec 必须先把改动合进本地 main**（#79 实收）。
- 🔴 **`md5sum … | sed 's|.*/||'` 是贪婪的**，会把哈希一起吃掉 → 「重冻前后 md5 全表 diff」退化成空判。
- 🔴 **一个 test 串着跑 N 次 `toHaveScreenshot`，第一处不匹配就中止整条**——漂移清单是**残缺的**。
- 🔴 **改文件的脚本，还原路径必须还原原始 bytes**（#82：LF 归一化副本压平了全仓 CRLF）。
- 🔴 **截图证据自己也会撒谎**：拍完要看一眼拍到的是不是那个态。
- 🔴 **门崩掉比门变红难诊断得多**；**改判扫描的暗区**：`scripts/gates/live-frontend-gate.snippet.js`
  不在 `*verify-*.mjs` glob 里。
- 🔴 **门全绿 ≠ 真部件被验到**：**恰好一致 / 恰好如预期的数字最该翻日志。**
  ⚠ #86 实收一条新形态：「清空后 `.upload-file-row` 为 0」是现成的**空真**——导航没跳过去、
  选择器写错、屏整块没挂，三种情况下它都为 0 且全绿。**销毁类判据必须配一条清空前的对照基准。**
- 🔴 **多行插入时忘了把新文本也转成 CRLF，会造出混行尾文件**。收尾逐文件自查 `bare_lf == 0`。
- 🔴 **改完后端必须按端口杀掉重起 uvicorn**（不热重载，`pkill` 杀不掉且不报错）。
  #86 触发过三次（新路由 + 每一轮后端变异）。
- 🔴 **`./init.sh` 和 run-battery 的收尾重建都 `vite build` 不带 api base** → dist 落回生产域名。
  跑任何上传型门/截图之前先重打带 `VITE_AVERY_API_BASE` 的 dist**并在浏览器里验 apiBase**。
- 🔴 **杀 npx 包装进程杀不死 vite 子进程**；stale 进程按端口杀。
- 🔴 **本机 Docker PG 容器时钟来回跳 ~115s**：`created_at < now()` 判据间歇假红。
- 🔴 **本机 curl / argv / stdout 都按 GBK 啃中文**：中文只走文件（`git commit -F` / `gh api --input`）。
  ⚠ 同族：Python 脚本里 `print()` 中文会直接 `UnicodeEncodeError` 炸掉。
- 🔴 **CSS 包含块/裁剪读码推断必须浏览器实测**（#66）；**特异性同理**。
- 🔴 `e535ec9` commit message 是错的（真相在 `03a9824` erratum）；rebase 与否归 Danny。
- 🔴 repo 级 stash 两条别人的存货；处置归 Danny。
- 多个战役 worktree 仍挂着（30 个上下）——删分支/worktree 属删除闸，归 Danny。
- ⚠ **各票收尾必须重写本文件**（AGENTS.md DoD）。
