# Session Progress Log

> 📢 本文件是**当前状态快照，整体重写不追加**。历史都在 git（`git log` + 各 `.issues/*/receipt*.md`），别在这儿堆编年史。
> 启动路径见 `AGENTS.md` Startup Workflow：读本文件 + `feature_list.json`，跑 `./init.sh` 确认绿，再开工。

**Last Updated:** 2026-08-07 深夜（gap2 战役 **T11（#60）+ T9（#58）都已合 main**；T10/#59 仍在自己 worktree 上）

## Current State

- **git**：`main` = 差距战役 #50–#57 八票 + **gap2 T11（#60）+ T9（#58）**。
  T9 是两个 commit（`1cae773` 产品代码与门 + `0e6686a` 与 T11 的合并）。
- **gap2 三票进度**：T11、T9 **都已合 main**；T10（#59 补资料门）还没回来。
  三票互相独立，但都动 FilesScreen——**合 main 串行，每合一张在主检出跑一次像素门**。
- **验证账实（T9 合完这一刻在主检出的实测，非估数）**：
  后端离线全套 **3882 passed / 111 deselected / 4 xfailed / 0 failed**（T11 那版 3848 + T9 的 34 条）；
  `@needs_db` 全套 **102 passed**（真 PG，7m56s；HITL 基线 98 + T9 的 4 条）；
  前端电池 **A 27/27 · B 3/3 · C 3/3 全绿**（A 区多的两道 = T11 的 form-builder + T9 的 forms-proactive）；
  像素 40 张在**主检出**真比对**零漂移**（基线 mtime 全部早于本次合并，是真比对不是现造；
  但见下面那条「像素门看不见表单区」——零漂移在这里是结构必然，不是「验过了」）；
  i18n **967** 叶子键 / 孤儿 0。
- **✅ 生产仍停在 08-07 白天那一版**（`main-20260807-190332` = main `99d83f7`）。
  T11 与 T9 **都没有上产**——票面写明「落 main 即止，统一上产由主 session 另行安排」。
  上产与 HITL 复验的两份回执仍是 `.issues/gap-design-0805/receipt-deploy-0807.md` 与
  `receipt-hitl-0807.md`；迁移 0012/0013/0014 已在生产库落地。
  ⚠ **T11 不需要新迁移**：新加的三个属性都在 `FormField` 上，而 `FormField` 是整块 jsonb
  存在 `form_templates.fields` 一列里（写 asdict 全量、读按 dataclass 已知键过滤，老行缺键吃默认值）。
  判据一句话：动 `FormField` → 免迁移；动 `FormTemplate`/`FormSubmission` 的顶层字段 → 必须迁移。
- 🔴 **T9 需要一条新迁移**（照上面那句判据：它动的是 `FormSubmission` 的顶层字段）：
  `0015_form_submissions_auto_key.sql` —— 加一列 `auto_key` + 一条**部分**唯一索引
  `(context_id, auto_key) WHERE auto_key IS NOT NULL`。increment-only、可重放。
  **上产时必须先让它落地**（`_ensure_schema()` 每次 bootstrap 自动重放，所以换容器即生效）。
- 🔴 **T11 与 T9 合的都是本地 main，没有 push**（`main...origin/main [ahead 5]`）。票面写的
  「落 main 即止」在这个仓库里必须理解成**不 push**：前端没有人工上产步骤，**push main 即自动
  构建上产**，推一下就等于把前端单独上了产、而后端容器还停在旧镜像。所以这一步留给统一上产
  那个 session：它要在**同一个窗口里** push + 换后端容器（见 What's Next 第 2 条）。

## 本轮做完的（2026-08-07 深夜 · T9 站内主动，issue #58）

回执：`.issues/gap2-0807/receipt-T9-forms-proactive.md`（三个设计判断 + 门账 + 15 条变异 + 两条环境红的根因）。

表单收集从「经理全手动」变「站内主动」：进新周期后经理一打开表单区，本期链接已按上期名单
备好；铃铛长出表单通知；今天页长出「本期还差 N 人没交」。**手动铸链一个字节没动。**

- **幂等护栏 = 两把锁挡两件不同的事**（不是一把加两层）：
  ① 经理**已经手动**铸过本期 → `form_autofill` 的读侧判据，本期 `open/submitted/expired`
     **任意态**都算「他已经有了」（过期行没人清也不该清，当成没铸过就是每周重复发链接）；
  ② 两个请求**同时**判定「本期没有行」→ Postgres 部分唯一索引 + `ON CONFLICT DO NOTHING`，
     事务级。先查后插挡不住那一幕。
  手动行 `auto_key IS NULL`、**连索引都不进**——「重复调用等于再发一轮」因此是机制保证。
  ⚠ 票面说「有既有门钉着手动铸链」这句**是错的**：T9 之前全仓 grep 无一命中，本票补了回归钉。
- **触发挂流量**（不引 cron，0807 拍板第 3 条）：`GET /team/{ctx}/forms/submissions` 顺手补铸，
  照 `ensure_builtin_templates` 的「首次 GET 按需铸」先例。刻意**不**挂 `/team`——那是今天页
  每次刷新都打的路，经理还没打开表单区链接就已经悄悄发出去了。
- **「去调整」有落点**：新端点 `POST .../forms/submissions/{id}/void`。作废 = 把到期时刻拨到此刻，
  **不删行**——三个理由：已提交的一律不许动（销毁证据）、删了会与自动补铸打成死循环
  （撤一条系统立刻发回来一条）、「已过期」那张诚实页面是现成的。
- **通知**：`NotifKind` 加 `'form'`。顺手补了两个**静默失效**的口子：`LiteBell` 的
  `default:` 兜底会让新 kind 顶着别人的文案上屏（改成 `never` 穷尽检查，tsc 拦）；
  `isKind` 是一份手写的第二份枚举，漏改它的后果是刷新后这类通知**静默消失**。
- **今天页规则**：这是规则表里**第一条不是关于项目的规则** → 公司级卡（`subject_type:'forms'`）。
  顺带堵上 `briefing()` 的 `look_kind`：混进非项目主体还说 'projects'，中文壳会印
  「N 个项目值得多看一眼」而只有更少的项目卡在场——那个方法长注释里因为同一个原因栽过两次。

### 「还差 {n} 人」与 ADR-0033 的正面冲突（本票最花心思的一处）

`RULE_PARAMS` 的红线明写**只放静态阈值**，`decision_grading.py` 那段碑还点名「共 3 份」这类
后端算出来的数不许进 evidence。而票要的 `{n}` 恰恰是每次命中都不同的计数。

**没绕过那条碑，是把它读懂了再开一格**：当初被删的「已过 62 天」毛病不是"动态"，是**算得不准**
（本地 date 减 UTC 时间戳，跨日差一天）且**已有更好的载体**（evidence 里那行原始日期）。
「还差 N 人」两条都不成立：它是我们自己库里那一期 open 行的**条数**，精确整数、无单位换算；
而句子里不写这个数，经理无法判断要不要现在去催（差 1 个和差 9 个是两件事）。
落地加了 `RULE_DYNAMIC_PARAMS`（只登记**参数名**）+ `RuleHit.dynamic_params`，i18n 契约门
两向对账**照旧严格**。🔴 而且这个 n **就是** `len(evidence)`——句子说差 3 人，底下正好摆着
3 行「谁」，结构上不存在第二个会漂的事实源。

### 变异测试 15/15 全被逮住 + 一条真库破坏性实验

跑器把「注入→跑→还原」绑在 `finally` 里（MEMORY：两个 agent 同改一个文件、只有一个还原过）。
最重要的是 **M12「表单聚合没喂进 grade」**：它证明那段跨三层的新管线真的通了——没有它，
所有只测 `grade_form_period` 函数的判据在管线断开时照旧全绿。

另有一条**无法脚本化还原**的实验：把 `ON CONFLICT DO NOTHING` 摘掉后跑并发门 → 第二条线程
当场 `UniqueViolation`。这是「那道并发门**真的在制造竞争**」的决定性证据——
一条从不真并发的并发测试是最典型的假绿（第一次做的变异只是加了道预检，`ON CONFLICT` 还在
兜底，于是**变异活了下来**，差点就把它当成"门有牙"）。

### ⚠ 像素门同样**结构性地看不见**表单区（与 T11 那条同因）

像素 spec 全程不上传 → 没有 contextId → 常驻表单区一个像素都不渲染。所以主检出那 40 张
零漂移**是结构必然，不是「验过了」**。T9 这一段的自动化眼睛是
`eval-harness/tools/verify-forms-proactive.mjs`（19 判据，已入 ROSTER A 区，上传型门）；
人眼过走 `.t9-shots/` 两张**元素直拍**（`fullPage` 拍不到——这屏有内部滚动容器，
第一版拍出来是一张「什么都没有」的壳，而门当时是绿的）。

## 上一轮做完的（2026-08-07 深夜 · T11 模板拼装器，issue #60）

回执：`.issues/gap2-0807/receipt-T11-form-builder.md`（逐条判据 + 变异账 + 截图人眼过）。

经理现在能自己建表：从零拼、照内置周报改、或让 Avery 读一份旧表格起草；题型多了「是/否」
与「1~5 分」；答案去哪儿由三个语义开关说了算，没勾的题只进资料库那份提交文档。

- **控件**：`yesno` 仿快问的姊妹实现（线上 ASCII 的 yes/no、库里 bool、眼前的「是/否」只是文案）；
  「1~5 分」= number 收窄 min/max，窄档渲染成一排按钮——**滑杆恒有值**，一格选填的滑杆照样会
  交上来一个没人选过的数。
- **自述识别结构化（本票要修的隐患）**：负载/情绪回流从「认 label 文案的正则」换成
  `FormField.self_report` 这个结构化标记。改之前两个方向都会错：改了题面 → 静默失灵；
  一个数字题被起名叫「产能自述」→ 那个数爬上人卡。值的判据提成两条共用原语（一把尺），
  正则老路一字未改、只留给上传的 06 表。另补一道取证闸（0807 HITL 那道的同族）。
  **存量回填**：库里那张老 `tpl_weekly` 会在下次读取时补上标记，但只补「经理一个字都没碰过」
  的格（label 逐字相同且未自标）——改过题面的不动，那是把要不要上卡交回给经理。
- **拼装器 UI**：三入口 + 字段编辑器 + **上限镜像**（12 题/8 选项/0..100，本地就拦住并说清是
  第几题超了哪一条）+ **已被答过的 field.id 禁改禁删**（题型锁死、删除键换成「以后不问这一题了」）。
  服务端 `gate_used_fields` 是**独立的第二道锁**，不是同一把锁抄两遍。
- **起草端点** `POST /team/{id}/forms/draft-from-file`：读已传文档起草一份**提案**（不落库），
  红线在起草层就落地并逐条说明，最后拿真的两道写侧门空跑一遍——经理点确认不许再吃 422。
  降级诚实：`origin` 三态 llm/heading/none，绝不把降级过的结果讲成「Avery 读懂了」。
- **i18n** 64 键 zh/en 同批（手工补 zh.ts，没跑生成脚本），孤儿 0。

### 🔴 顺带修掉一条从 T5 起就埋着的静默 bug

`save_form` 把 `FormFieldIn` 往回建成 `FormField` 时**漏传了 `situational`**——而 `FormFieldIn`
上那条注释警告的正是「漏了它，经理存一次模板就把内置周报的两个开关静默抹平、回流从此不响」。
那条注释描述的事故**从 T5 那天起就已经是既成事实**，只是当时前端一个调用者都没有。
本票让经理真能存模板，它第一次保存就会发作。
**教训：模型上列了键 ≠ 那个键会被传下去，一路到 dataclass 的赋值点都要有门。**

### 变异测试翻出来的两件真东西（17/17 全被抓，但产出不是「门有牙」）

跑器 `.issues/gap2-0807/t11-mutate.py`（下刀 → 跑门 → `git checkout` 还原 → 记账 → 核工作区干净）。

1. **M3 第一轮活下来一半，是 belt-and-braces 的教科书形态**：把「认标记」换回「认 label 文案」
   之后，整链那条门仍然绿——因为真链上没标记的数字题渲染成自己一节（**那行没有名字**），
   **取证闸**先把它挡了。门是绿的，但绿的原因是另一把锁。补了一条把取证闸**喂饱**的隔离判据
   （故意造一行「周雅｜产能自述：93」），此时只剩标记能说话，A/B 只差一个字段。
   MEMORY 那条「两把锁必须两道门」在这里第二次被验证。
2. **F2 翻出浏览器门里一条恒绿的空判据**：「被本地拦下时没有发出保存请求」初版量的是
   `formBuilderBusy === 'idle'`，而那个忙态早在断言之前就回落了。改成**数网络上真的
   POST `/forms` 的次数**，同一条变异当场打红。

### ⚠ 像素门**结构性地看不见**拼装器（这条别忘）

像素 spec 全程不上传 → 没有 contextId → `StandingFormsSection` 第一条早退命中 →
整个常驻表单区（含拼装器）一个像素都不渲染。逐张翻过基线 PNG 确认：`aurora-files-desktop.png`
上是资料库**空态**。所以主检出那 40 张零漂移是**结构上必然**的，不是「验过了」。
这一段唯一的自动化眼睛是 `eval-harness/tools/verify-form-builder.mjs`（43 判据，已入 ROSTER A 区）。
人眼过走 `.issues/gap2-0807/t11-shots/` 六张（桌面/手机 × 入口/编辑器/起草预览）。

## What's Next（按优先级）

1. **只剩 T10(#59) 回来合 main**（它自己的 worktree 在跑）。合的时候：
   - 三票都动 `FilesScreen.tsx`，**串行合、每合一张在主检出跑一次像素门**；
   - T11 已经把 `StandingFormsSection` 的四条早退**砍到两条**（原来「一张在用的模板都没有」
     和「既没花名册又没提交记录」会在最需要建表的第一天把入口一起藏掉）——T10 如果也碰
     那几条 guard，先读一遍 T11 的注释再改；
   - T11 在 `LiveFormField` 上加了三个**必填**键（`situational`/`self_report`/`retired`）；
     T9 在 `LiveFormSubmission` 上加了可选的 `auto`、在 store 上加了 `formsAutoFilled` /
     `formsVoiding`（公司域清扫清单因此从七件变**九件**，三处抄本都要跟着改）。
2. **三票齐了统一上产**（票面：落 main 即止，上产由主 session 安排）。
   🔴 **push 与换后端容器必须在同一个窗口里做**：前端是 push main 即自动构建上产，
   先 push 再慢慢换后端，中间那段时间线上就是「新前端 + 旧后端」——拼装器的三个入口都在，
   但 `yesno` 会被老后端的结构门 422、`draft-from-file` 是 404；T9 这边则是自动补铸
   与撤回都打到 404，而横幅/铃铛/今天页那条规则**永远不出现**（看起来像功能没做）。
   ⚠ T11 不需要新迁移；**T9 需要 0015**（换容器时 `_ensure_schema()` 自动重放，见 Current State）。
   ⚠ 上产后**先设 `AVERY_PUBLIC_BASE`** 再验表单——本地漏设时铸出来的链接指向生产域名
     （T11 那道门就是这么以「链接不存在」假红的，见 Blockers）。
3. **Danny 用户视角端到端演习**（三票落地上产之后）：从零自己开一个新工作区走全程，
   记录「卡在哪、哪一步不知道该点哪」当清单，演习后再定修哪些。
4. **T8 留的两条记录还在桌上**（只记录未改，等拍板）：
   ① 议事室引用编号是 `facts.md:<行号>` 而非客户自己的文档名；
   ② 今天页证据行是 `字段="值"` 的机器形状（ADR-0033 明定）。
5. **给 `/health` 加一行版本字段**（镜像 tag 或 commit）：现在「生产跑的是哪个 commit」外部不可核。
6. carry-over：r2 未开票发现（`.issues/sweep/2026-08-02-r2.md`）· gate-run 迁移（aria-zh/cr-alignment）·
   files-hub #26–#29 · 换血抢救 #31/#32 · v01 退役 #33 · 真机零覆盖（iOS/微信，最高优）·
   成本票 #30 等真实客户量 · 真 brain 分流取证（要先给口径）· 全量 feat-063。

## Blockers / Risks

- 无硬 blocker。
- 🟠 **别单独 push main**：前端 push 即自动上产，而后端容器要人手换。先 push 再换后端，
  中间线上就是「新前端 + 旧后端」——拼装器的三个入口都在，但 `yesno` 会被老后端的结构门 422、
  `draft-from-file` 是 404。**这不是残缺功能，是上到一半的产。** 两件事同窗口做。
- 🔴 **在 worktree 里重冻像素＝没重冻**：`__snapshots__/` 是 gitignore 的单机产物、每 worktree
  一份。新 worktree 第一次跑像素门是 40 张「没有基线」全写入（playwright 报 exit 1）——
  那**既不是漂移红也不是绿**。真比对只在主检出上有意义；红了先比 mtime 再谈漂移。
- 🔴 **脚本落盘的「会话/状态」文件默认当凭据看**：规则已收紧为 `.issues/**/.hitl-session*.json`。
  **先写 .gitignore 再写脚本**。
- ⚠ **提示词里的约束不是判据**：模型会不听。凡是「只有满足 X 才准输出 Y」的规矩，落地层必须有
  一道能对着**文档原文**验的闸（T11 的起草层红线过滤 + 取证闸都是这么写的）。
- ⚠ **belt-and-braces 会让内层规则免疫变异**：两把锁必须是两道**独立**的门，否则其中一条规则
  被换掉时另一把锁会替它挡住变异，你只会看到一片绿（T11 的 M3 就是这么活下来一半的）。
- 🟠 **门的环境缺一样就以「像回归」的形态假红**，本轮实收三条，都翻到失败断言本身才定性：
  ① `onboard-gate` 缺 `AVERY_DEMO_SEED_DIR`（且要指 `tests/fixtures/demo-seed`，不是
     `fixtures/seed`）→「示例团队门不在场」；② `form-builder` 缺 `AVERY_PUBLIC_BASE`
     → 铸出来的链接指向**生产域名**，门跑去生产查一个不存在的 token，红成「链接不存在」；
  ③ `null-owner` 源码写死 `127.0.0.1:5173` 不吃 `VERIFY_BASE` → 隔离端口上恒 CONNECTION_REFUSED。
  起门环境的最小四件套：`AVERY_BRAIN=mock` + `AVERY_EXTRACTOR=heuristic` +
  `AVERY_EMBEDDINGS=keyword` + `AVERY_DEMO_SEED_DIR` + `AVERY_PUBLIC_BASE` + `AVERY_CORS_ORIGINS`。
- 🔴 **stale uvicorn 按端口杀**（`Get-NetTCPConnection -LocalPort <口> -State Listen` → `Stop-Process`），
  别信 ps 信行为；各 session 结束清自己起的端口。
  ⚠ 但**要按自己记下的 PID 清，不能按端口号一把梭**：T9 收尾时我的循环把 5173 上一个
  **不是自己起的** preview 一起杀了（另一个 session 的，随后 8137 也没了）。无数据损失、
  重启即可，但那不是该动的东西。
  同族：`PgRegistry._schema_ready` 是实例级缓存——换库不重启后端＝迁移不重放。
- 🔴 **`vite preview` 默认只绑 `::1`**：起 preview 一律加 `--host`（裸 `--host`，不写 127.0.0.1）。
- 🔴 **本机 Docker PG 容器时钟来回跳 ~115s**：`created_at < now()` 判据间歇假红。
- 🔴 **本机 curl / argv / stdout 都按 GBK 啃中文**：中文只走 heredoc / `--input` 文件；
  带中文或 ✓✗ 的 python 脚本要 `sys.stdout.reconfigure(encoding='utf-8')`，否则 UnicodeEncodeError。
- 🔴 `e535ec9` commit message 是错的（真相在 `03a9824` erratum）；rebase 与否归 Danny。
- 🔴 repo 级 stash 两条别人的存货（`stash@{0}`/`stash@{1}`）；处置归 Danny。
- 多个战役 worktree 仍挂着（22 个，含 gap2 三条）——删分支/worktree 属删除闸，归 Danny。
- ⚠ 本机残留：Docker 库 `t8e2e`（T8 自检专用）；`teammaster-postgres-1` 容器在运行态。
- ⚠ **各票收尾必须重写本文件**，这是 AGENTS.md 的 DoD，不是可选项。
