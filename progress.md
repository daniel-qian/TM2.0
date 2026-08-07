# Session Progress Log

> 📢 本文件是**当前状态快照，整体重写不追加**。历史都在 git（`git log` + 各 `.issues/*/receipt*.md`），别在这儿堆编年史。
> 启动路径见 `AGENTS.md` Startup Workflow：读本文件 + `feature_list.json`，跑 `./init.sh` 确认绿，再开工。

**Last Updated:** 2026-08-07 深夜（gap2 战役 **T11（#60）模板拼装器合 main**；T9/#58、T10/#59 仍在各自 worktree 上）

## Current State

- **git**：`main` = 差距战役 #50–#57 八票 + **gap2 T11（#60）**。T11 是两个 commit
  （`0baefc7` 产品代码 + `9f64ed1` 变异测试与两处补洞）。
- **gap2 三票进度**：T11 **已合 main**；T9（#58 站内主动）与 T10（#59 补资料门）还没回来。
  三票互相独立，但都动 FilesScreen——**合 main 串行，每合一张在主检出跑一次像素门**。
- **验证账实（T11 合完这一刻的实测，非估数）**：
  后端离线全套 **3848 passed / 107 deselected / 4 xfailed / 0 failed**（HITL 基线 3798 + T11 的 50 条）；
  form 两族 `@needs_db` **24 passed**（真 PG）；
  前端电池 **A 26/26 · B 3/3 · C 3/3**（SPEC_STICK=99，A 区多的那一道就是 T11 新加的 form-builder）；
  像素 40 张在**主检出**真比对**零漂移**（原因见下）；i18n **962** 叶子键 / 孤儿 0。
- **✅ 生产仍停在 08-07 白天那一版**（`main-20260807-190332` = main `99d83f7`）。
  T11 **没有上产**——票面写明「落 main 即止，统一上产由主 session 另行安排」。
  上产与 HITL 复验的两份回执仍是 `.issues/gap-design-0805/receipt-deploy-0807.md` 与
  `receipt-hitl-0807.md`；迁移 0012/0013/0014 已在生产库落地。
  ⚠ **T11 不需要新迁移**：新加的三个属性都在 `FormField` 上，而 `FormField` 是整块 jsonb
  存在 `form_templates.fields` 一列里（写 asdict 全量、读按 dataclass 已知键过滤，老行缺键吃默认值）。
  判据一句话：动 `FormField` → 免迁移；动 `FormTemplate`/`FormSubmission` 的顶层字段 → 必须迁移。
- ⚠ **前端没有人工上产步骤**（push main 即自动构建上产），只有**核实**步骤——核实方式见部署回执，
  别记具体 SHA。**这意味着 T11 的前端已经随本次 push 自动上线，而后端容器还没换**。
  下一个动后端的 session 必须知道这件事（见 Blockers 第一条）。

## 本轮做完的（2026-08-07 深夜 · T11 模板拼装器，issue #60）

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

1. **等 T9(#58) 与 T10(#59) 回来合 main**（各自 worktree 在跑）。合的时候：
   - 三票都动 `FilesScreen.tsx`，**串行合、每合一张在主检出跑一次像素门**；
   - T11 已经把 `StandingFormsSection` 的四条早退**砍到两条**（原来「一张在用的模板都没有」
     和「既没花名册又没提交记录」会在最需要建表的第一天把入口一起藏掉）——另两票如果也碰
     那几条 guard，先读一遍 T11 的注释再改；
   - T11 在 `LiveFormField` 上加了三个**必填**键（`situational`/`self_report`/`retired`），
     另两票若要构造这个类型的字面量，三个键一个都不能少。
2. **三票齐了统一上产**（票面：落 main 即止，上产由主 session 安排）。
   ⚠ T11 前端已随 push 自动上线、后端容器还没换——上产那一步要把这件事一起核实。
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
- 🟠 **T11 前端已自动上线、后端还是旧镜像**：拼装器的三个入口在生产上会打到还没有
  `draft-from-file` / 新 `FIELD_KINDS` 的后端。建表（`POST /forms`）老后端就有，
  但 `yesno` 会被老后端的结构门 422、起草端点是 404。**这不是残缺功能，是没上完的产**——
  三票统一上产那一步把后端换掉即解。别在那之前拿生产界面判功能对错。
- 🔴 **在 worktree 里重冻像素＝没重冻**：`__snapshots__/` 是 gitignore 的单机产物、每 worktree
  一份。新 worktree 第一次跑像素门是 40 张「没有基线」全写入（playwright 报 exit 1）——
  那**既不是漂移红也不是绿**。真比对只在主检出上有意义；红了先比 mtime 再谈漂移。
- 🔴 **脚本落盘的「会话/状态」文件默认当凭据看**：规则已收紧为 `.issues/**/.hitl-session*.json`。
  **先写 .gitignore 再写脚本**。
- ⚠ **提示词里的约束不是判据**：模型会不听。凡是「只有满足 X 才准输出 Y」的规矩，落地层必须有
  一道能对着**文档原文**验的闸（T11 的起草层红线过滤 + 取证闸都是这么写的）。
- ⚠ **belt-and-braces 会让内层规则免疫变异**：两把锁必须是两道**独立**的门，否则其中一条规则
  被换掉时另一把锁会替它挡住变异，你只会看到一片绿（T11 的 M3 就是这么活下来一半的）。
- 🔴 **stale uvicorn 按端口杀**（`Get-NetTCPConnection -LocalPort <口> -State Listen` → `Stop-Process`），
  别信 ps 信行为；各 session 结束清自己起的端口。
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
