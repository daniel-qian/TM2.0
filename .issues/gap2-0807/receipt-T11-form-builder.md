# T11 · 模板拼装器 —— 回执（issue #60，gap2 战役）

> 正源：`gh issue view 60`。共享事实图与五条拍板：`.issues/gap2-0807/tickets.md`。
> 分支 `claude/reverent-meitner-b36dba`（worktree `D:\avery-wt-reverent-meitner-b36dba`）。

## 一句话

经理现在能自己建表了：从零拼、照内置周报改、或者让 Avery 读一份旧表格起草；题型多了「是/否」
和「1~5 分」；答案去哪儿由三个语义开关说了算，没勾的题只进资料库。顺带修掉一条从 T5 起就
埋着、本票会让它当场发作的静默 bug。

## 做完的五件

### ① 控件：yesno 与 1~5 分

- `FIELD_KINDS` 加 `yesno`（`form.py`）。仿快问的姊妹实现，逐条对齐：**线上恒是 ASCII 的
  `yes`/`no`，落库折成 bool**，员工眼前的「是 / 否」只是 `_COPY` 那一层的文案。
  为什么不存成 `choices=['是','否']` 的 choice：那样同一张表在中文壳和英文壳上答的「是」会是
  两个不同的字符串，跨期对比当成两个词。
- 渲染走既有的 `_FIELD_RENDERERS` 查表 + 启动期一致性断言，`.h5-yn` / `.h5-btn` 那几条 CSS
  一行都没新加（`_render_choice` 早就在用同一套 markup）。
- 「1~5 分」**不是新 kind**——就是 number 收窄 min/max。窄档（≤5 档）渲染成一排按钮，宽档
  仍是滑杆。为什么窄档不用滑杆：**滑杆恒有值**（HTML range 没有「没选」这个态），一格
  `required=False` 的滑杆照样会交上来一个没人选过的数，而 `parse_submitted_answers` 的
  「absent ≠ 空」纪律说的正是这两件事不许折成一个。
- 资料文档里 yesno 渲染成中文的是/否——`str(True)` 是 `'True'`，直接进文档就是在客户的资料里
  印一个英文关键字（下载下来的原件、议事室引用里都是它）。

### ② 自述识别结构化（本票要修的隐患）

改这条腿之前，负载/情绪回流靠正则去认渲染出来那行里带「自述」二字的 label
（`extract._selfreport_from_lines`）——**认文案不认结构**。两个方向都会错：

- 经理把题面从「负载自述」改成「这一周有多忙」→ 回流静默失灵，资料照进、卡上什么都不长、不报错；
- 一个从没打算上卡的数字题只要被起名叫「产能自述」→ 那个数就爬上人卡。

拼装器让经理能随手改题面，这条腿再不变成结构化的，第一天就断。改法：

- `FormField.self_report ∈ {'', 'load', 'mood'}`（仿 `situational` 那个开关）。
- `form_reflow.stub_person_from_submission` 改读标记 + `answers`，不再解析文档文本。
- **值的判据提成两条共用原语**（`extract.read_selfreport_load` / `read_selfreport_mood`）：
  识别方式可以有两种（一种认文案给上传的 06 表、一种认结构给表单），**读数的判据只能有一把尺**。
- 正则老路 `_selfreport_from_lines` **一字未改**，只留给「上传的 06 表」——客户手写的周报里
  没有字段描述可读，只能认文案。
- 命门② 顺带变强：姓名/工号取自 `submission` 的结构化字段、读数取自带标记的那格答案，
  员工在自由文本里写什么都造不出一格带标记的字段（从「事后筛掉冒名的」变成「压根没有冒名这条路」）。
- 另补一道**取证闸**（0807 HITL 那道的同族）：读数指着的那一行必须同时写着名字、题面和值，
  找不到就丢。今天渲染器自己交行号、结构上不会错——但判据不能建立在「今天的渲染器不会错」上。

**存量回填**：`ensure_builtin_templates` 见到 `tpl_weekly` 已存在就原样复用（题面必须被快照住），
所以给内置模板加的标记**只对从没打开过表单页的新公司生效**。生产上任何点开过一次的 context，
库里那张是老快照 → 新开关在那些公司上静默失灵、没有一道门会红。所以补了
`backfill_builtin_markers`：只补「经理一个字都没碰过」的格（id/kind 对得上、还没自己标过、
**label 与内置版逐字相同**）。第三条是这件事能叫「保持现状」而不是「替经理断言」的全部理由——
label 没改过说明那格正被老正则读着，补标记只是把同一件事从认文案改成认结构，行为一字不变。

### ③ 拼装器 UI（FilesScreen 常驻表单区）

- 三入口：新建空白 / 照某张表改一张（复制成新表）/ 让 Avery 读一份旧表格起草；
  另有逐张表的「改这张表」入口。
- 字段编辑器：题面、题型、必填、说明、选项增删、min/max、**三个语义开关**、停用、删除。
- **上限镜像**（`src/lite2/formShape.ts`）：12 题 / 8 选项 / number 0..100 / 各段字数，
  服务端 422 之前前端就拦住**并说清是第几题超了哪一条**。判据按**题号**指路，不是内部
  `field.id`——`q3` 经理从没见过，拿它指路等于没指。
- **已被答过的 field.id 禁改禁删**：题型 select 锁死、删除键换成「以后不问这一题了」，
  旁边一句话说明为什么这里没有删除键。服务端 `gate_used_fields` 是**独立的第二道锁**
  （不是同一把锁抄两遍——拆掉任何一道，另一道都还在，两边各自都杀得死变异）。
- 三个开关旁边各有一句话说清这一格的答案**去哪儿**；没勾任何开关的题界面明说
  「只进资料库——搜得到、议事室引得到，但不上任何卡」。绝不暗示「加字段 = 自动长卡」。
- store 开了**自己的一对忙/错态**（`formBuilderBusy` / `formBuilderError`），刻意不复用
  `formsBusy` / `formsError`：后者只有 `'idle'|'minting'` 一个标志（借它会把铸链按钮一起锁死，
  而唯一的解锁路径在生产上从来不可达），且三个取值各自对应一句铸链文案——「一次发给 1 到 30
  个人」接在保存模板失败之后就是对经理撒谎。
- 写后 `await refreshForms()` 回权威清单重拉，不做本地乐观拼装。
- `transportErrorDetailed` 读 422 body 里那句 `detail.reason` 挂到 `TransportError.serverReason`
  上，当**诊断**附在中文那句后面（⚠ `withServerDetail` 早在某次合并里丢了，今天全仓零引用——
  这是重新写的一小段，不是把它复活）。

**拆掉了两条早退**：原来 `StandingFormsSection` 有四条 `return null`，其中
「一张在用的模板都没有」和「既没花名册又没提交记录」会在**最需要建表的第一天**把入口一起藏掉
（一家刚上传完、花名册还没解析出来的公司正好命中）。改成各自包住自己那一块。

### ④ 起草端点 `POST /team/{id}/forms/draft-from-file`

- **提案不落库**：回执里 `template.id` 恒为空串，落不落库是经理点确认那一步的事（走既有 `POST /forms`）。
- **红线在起草层就落地**：逐格过 `redline.validate`（与写侧同一台检测器），不过的**整格丢掉并
  说清是哪一列、为什么**，回执里的 `dropped` 必须投到界面上。为什么是丢不是改写：改写等于我们
  替客户把「员工绩效排名」重写成一句合规的话，那是替他断言。
- 最后拿**真的** `validate_template_shape` + `gate_form_red_line` 对着提案空跑一遍——
  **经理点确认那一刻不许再有惊喜**。ONE RULER：调的是那两个函数本身，不是抄一份它们的判据。
- **诚实降级**：`origin` 三态 `llm` / `heading`（退回表头启发式）/ `none`（一格都没读出来，交白表），
  绝不把降级过的结果标成 `llm`。界面文案跟着走：mock brain 下说的是「照…的表头抄下来的——
  Avery 没有理解它们」。
- 只读**已传的**文档，不在这条路上收新上传：`POST /ingest` 传旧 context_id 是重建并覆盖而不是
  追加，为「读一读」单开一条会写资料的上传路，等于给它装一个能毁掉整个工作区的副作用。
  （追加上传是 T10/#59 的活。）
- 走 `reg.source_document_bytes(context_id, idx)` 取字节，**不**读 `sd.content`——pg 孪生的
  `get()` 从不带 content，照 `sd.content` 写会在本地内存跑绿、上生产拿到 None。

### ⑤ i18n

64 个新键 zh/en 同批（`en.ts` 是正源，`zh.ts` 手工按引号键风格补，**没跑生成脚本**——
`i18n-zh-lite2-delta.mjs` 会整个重写 zh.ts）。孤儿 0（962 叶子键）。题面/表名/说明/选项/文件名
一个字都不进词典（客户内容，与文件名同级）。JSX 里零标点字面量：分隔符走 CSS 间距或写进字符串本体。

## 🔴 顺带修掉的一条静默 bug（不在票面上，但本票会让它当场发作）

`save_form` 把 `FormFieldIn` 往回建成 `FormField` 时**漏传了 `situational`**——那串 kwargs 里
根本没有它。而 `FormFieldIn` 上那条注释写的正是「漏了这个键，经理在前端存一次模板就把内置周报
的两个 `situational=True` 静默抹平了，回流从此不响」。

也就是说：**这条注释警告的事故，从 T5 那天起就已经是既成事实**，只是当时前端一个调用者都没有，
没人踩到。本票让经理真能存模板，它第一次保存就会发作。教训：**模型上列了键 ≠ 那个键会被传下去**，
一路到 dataclass 的赋值点都要有门。

## 明确没做（票面点名不做 + 我自己划的界）

- 模板版本快照（票面不做）：用「禁改已用 id + 停用不删」守住口径。
- 快问（ask）那套的任何改动（票面不做）。
- 起草端点**不收随请求新传的文件**（票面括号里的可选项）：理由见 ④，追加上传归 T10。
- 字段拖拽排序：编辑器只有增/删/停用，不排序。加一题恒在末尾。

## 门与账

| 门 | 结果 |
|---|---|
| `./init.sh`（tsc -b + vite build） | 绿 |
| 后端离线全套 `pytest`（四个 deselect 是默认值，见 pytest.ini） | **3848 passed · 107 deselected · 4 xfailed · 0 failed**（T8/HITL 基线 3798 + 本票 50 条） |
| 新门 `tests/test_form_builder_t11.py` | 50 条全绿 |
| 新门 `tools/verify-form-builder.mjs`（真浏览器 + 真 mock 后端） | **43 PASS · 0 FAIL** |
| 前端电池 A 区（含新门，已入 ROSTER） | 见下 |
| 前端电池 B / C 区 | 见下 |
| i18n 孤儿 | 0（962 叶子键） |
| 变异测试（后端 15 条 + 前端 2 条） | 17/17 被抓（详见下节） |

跑门环境（隔离端口，写下来是为了可复现）：

```
后端 cd eval-harness && AVERY_BRAIN=mock AVERY_EXTRACTOR=heuristic AVERY_EMBEDDINGS=keyword \
     AVERY_DEMO_SEED_DIR=tests/fixtures/demo-seed AVERY_PUBLIC_BASE=http://127.0.0.1:8231 \
     AVERY_CORS_ORIGINS=http://localhost:5231,http://127.0.0.1:5231 \
     python -m uvicorn service.app:app --host 127.0.0.1 --port 8231 --app-dir .
前端 VITE_AVERY_API_BASE=http://127.0.0.1:8231 vite build --mode development
     vite preview --port 5231 --strictPort --host        # ⚠ --host 不能省（默认只绑 ::1）
跑门 VERIFY_BASE=http://localhost:5231 node eval-harness/tools/verify-form-builder.mjs
```

## 变异测试

跑器：`.issues/gap2-0807/t11-mutate.py`（逐条下刀 → 跑门 → `git checkout --` 还原 → 记账 →
收工核一次工作区干净）。写成脚本而不是手工，防的正是「说已还原、其实没有」那类事故。

| # | 变异 | 结果 |
|---|---|---|
| M1 | 拆掉「已被答过的 field.id 禁改禁删」整道门 | ✓ 精确打红 3/3 |
| M2 | `save_form` 漏传 `situational`（退回本票修掉的那个真 bug） | ✓ 打红 2/2（另溢出 1） |
| M3 | 回流退回「认 label 文案」的老正则 | ✓ 精确打红 2/2 **（见下，第一轮只中 1/2）** |
| M4 | 拆掉取证闸 | ✓ 精确打红 |
| M5 | 存量内置模板不回填标记 | ✓ 精确打红 |
| M6 | 回填不看 label 是否被改过 | ✓ 精确打红 |
| M7 | yesno 直接 `str()` 进资料文档（印出 True） | ✓ 精确打红 |
| M8 | 自述行退回「所有非 text 格」 | ✓ 精确打红 |
| M9 | 员工页渲染不过滤 retired | ✓ 精确打红 |
| M10 | 拆掉三个语义开关的落点判据 | ✓ 精确打红 |
| M11 | 起草层不过红线 | ✓ 打红 2/2（另溢出 3） |
| M12 | 起草层不收拾模型吐的坏形状 | ✓ 精确打红 |
| M13 | MAX_FIELDS 数「存着几格」而不是「在问几格」 | ✓ 打红（另溢出 1） |
| M14 | yesno 收下任何非空值 | ✓ 精确打红 |
| M15 | 窄档 number 退回滑杆 | ✓ 精确打红 |
| F1 | 前端 `answeredFieldIds` 恒返回空集（拆掉界面那把锁） | ✓ 精确打红 3 条（浏览器门 ⑥） |
| F2 | 前端 `checkFormShape` 恒返回 `[]`（拆掉上限镜像） | ✓ 打红 3 条（浏览器门 ③） |

**变异翻出来的两件真东西**（这才是变异测试的主要产出，不是「证明门有牙」）：

1. **M3 第一轮活下来一半，而且是 belt-and-braces 的教科书形态。**
   `test_an_unmarked_number_question_never_climbs_onto_a_card` 走整条真链，而真链上没标记的
   数字题渲染成自己一节（`## 产能自述` + 一行光秃秃的 `93`，**那一行没有名字**）——
   **取证闸**自己就把它挡了。门是绿的，但绿的原因是另一把锁，marker 规则本身没被验到。
   补 `test_only_the_marker_decides_which_answer_becomes_a_card_reading`：故意造一行
   `周雅｜产能自述：93` 把取证闸**喂饱**，此时唯一还能说话的只剩标记；A/B 只差一个字段。
   （MEMORY 那条「两把锁必须两道门」在这里第二次被验证。）
2. **F2 翻出浏览器门里一条恒绿的空判据。**
   「被本地拦下时没有发出保存请求」初版量的是 `formBuilderBusy === 'idle'`——那个忙态早在断言
   之前就回落了，发没发请求它都说 idle。改成**数网络上真的 POST `/forms` 的次数**，
   同一条变异当场打红。

## 需要下一个人知道的几条

- **`?transport=stub` 在这一段上是死路**：`saveFormTemplate` / `draftFormFromFile` 在
  `LiveTransport` 上是可选方法，stub 通道没有 → `formTemplates===null` → 整段零像素。
  也就是说**像素基线看不见拼装器**，`verify-form-builder.mjs` 是它唯一的自动化眼睛。
- 新门是**上传型门**（真发 `POST /ingest` + 真建模板 + 真铸链 + 真在员工页交一份），
  ROSTER 里标了「绝不能排在 C 区之后」。
- 写浏览器门时栽过一次：**题面住在 `<input value>` 里，Playwright 的 `hasText` 对它是瞎的**
  （30s 超时才发现）。要按题面定位就 `evaluateAll` 把 `input.value` 读出来配对。
- `FormField` 加属性**不需要动 pg 迁移**：它整块作为 jsonb 存在 `form_templates.fields` 一列里
  （写 `asdict` 全量、读按 `__dataclass_fields__` 过滤，老行缺键吃 dataclass 默认值）。
  判据一句话：动 `FormField` → 免迁移；动 `FormTemplate`/`FormSubmission` 的顶层字段 →
  必须迁移 + 改 `_FORM_TPL_COLS`/`_FORM_SUB_COLS` + 改 `from_row` 解包顺序。
- `test_form_store_contract` 那条号称 `every_field_attribute` 的门，判据原本是**手写的八元组**，
  `situational` 一直不在里面——pg 的 jsonb 往返把它弄丢，那道门照样全绿。本票换成
  `asdict` 全量比对（手写清单一定会在下一次加字段时再漏一个）。

## 人眼过（截图）

`.issues/gap2-0807/t11-shots/`，桌面 1280×900 与手机 375×812 各三态：
入口折叠态 / 编辑器展开态（含三种题型与三个开关）/ 起草预览态（含被丢掉那一列的说明）。
看过：手机 375 宽下三个开关竖排、无横向溢出；停用的格整块压弱但仍在表上；被丢掉的列名带删除线。
