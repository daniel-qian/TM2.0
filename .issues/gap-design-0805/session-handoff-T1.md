# T1 · form-backend-a1a —— 交接（差距战役 · 常驻表单主线第 1/3 棒）

> 本文件是**这条线自己**的交接（AGENTS.md 的 worktree 纪律：跨线合并叙事归主检出的 integrator，
> 各线写自己的 per-line 文件）。worktree：`D:\avery-wt-admiring-hawking-87f4a6`，
> 分支 `claude/admiring-hawking-87f4a6`。
> 票面：`.issues/gap-design-0805/tickets.md` §T1；PRD 底稿 `design-options.md` §A0/§A1。
> ⚠ 那两份文件在主检出里**还没进 git**（untracked），本目录里只有 T1 自己的产出。

## 一句话

常驻表单的库表与员工侧 H5 全链已经通了：经理建模板 → 给某一个人铸一条 `/f/<token>` 链接 →
员工手机免登录打开、按字段描述渲染出的六格填完提交 → 落进 `avery.form_submissions`。
curl 全链 + 真库查询在 `curl-transcript-T1.txt`，脚本 `curl-chain-T1.sh` 可复跑。

## 🔴 头号纪律怎么落的（0805 拍板 #5）

「表单只是与上传文件平权的又一路数据源，禁止特殊旁路。」本票的落法是**画清边界并自证**：

- 新表存的是**表单这个采集器**（模板长什么样、链接发给了谁、谁交了），不是资料的第二条存储通道；
- 提交**没有**碰 `source_documents` / `materials` / `extraction` 任何一层 —— curl 回执第 7 步
  直接查库自证：走完全链后 `source_documents` 仍是 1 行（第 0 步上传的那份），表单提交没有
  偷偷 append 任何东西；
- 「提交渲染成一份与上传文件同构的资料文档、append 进 context」是 **T2** 的活，通道是
  `get(ctx) → 原地 mutate → put(ctx)`（design-options §A1「持久层写入通道」），本票刻意不开口子。

## 做了什么（按层）

| 层 | 文件 | 要点 |
|---|---|---|
| 迁移 | `eval-harness/db/migrations/0013_form_templates.sql` | `avery.form_templates` + `avery.form_submissions`；increment-only、`CREATE ... IF NOT EXISTS`、FK `ON DELETE CASCADE`。**不复用 `avery.asks`**（四处被红线门钉死的形状，理由逐条写在文件头） |
| 领域 | `eval-harness/avery/ingest/form.py` | 数据类 + 字段描述（`kind ∈ text/choice/number`）+ 两道门 + 内置「周报」模板 + `ensure_builtin_templates` |
| 持久层 | `registry.py` / `pg_registry.py` | 8 个方法 × 两个双胞胎；先在 `ContextRegistryProtocol` 立起来（`test_registry_protocol.py` 离线钉住签名一致） |
| H5 壳 | `eval-harness/service/h5.py`（新） | 把 `esc`/`H5_CSS`/`page` 从 `ask_api.py` **机械**提取出来共用；ask 侧渲染**逐字节不变**（直接取 `git show HEAD:…/ask_api.py` 里的旧 `_H5_CSS` 与 `_page` 与新实现同参对拍：CSS 相同、整页 1994 bytes 相同；日常执法者是 `test_ask_h5.py`） |
| HTTP | `eval-harness/service/form_api.py` | 4 个经理端点 + `/f/{token}` 两个员工端点 |
| 边角 | `app.py` / `upload_guard.py` | 挂 router；`/f/` 与 `/r/` 共用 `share` 限流表盘（同一张公开无鉴权的脸） |

### 端点清单

```
GET  /team/{cid}/forms                        模板列表（内置「周报」按需铸出）
POST /team/{cid}/forms                        建/改模板（结构门 + 🔴红线门 → 422）
POST /team/{cid}/forms/{tpl}/links            铸单人单链（一人一链，7 天过期）
GET  /team/{cid}/forms/submissions            谁交了/谁没交（+ 答案原样）
GET  /f/{token}                               员工页（免登录，ZH 默认，?lang=en）
POST /f/{token}/submit                        提交（答一次锁）
```

### 几个当时拍的决定（后面的票别再重推一遍）

1. **内置模板按需铸成真行**，不是每次从代码现算：一次提交的答案按 `field.id` 落，模板必须被
   **快照住**，否则改了代码去年的提交会跟着变意思。已存在就原样不动（经理改过的题面不被覆盖）。
2. **`period` 列现在就加**（述职周期，默认当前 ISO 周）：T2 的文档名「周报-周雅-2026W32.md」和
   T3 的「本周谁交了」都要它，从 `submitted_at` 倒推是错的（周五铸链、周一才填）。
3. **铸链即建行**：没交的人是 `answers IS NULL` 的行，不是缺席 —— T3 不用做「名单减去交了的」。
4. **答案不过红线**（ADR-0023，与快问回执同姿态）：那是员工本人的话；保证在**落点** ——
   它挂 (template, submission)，永不挂 `avery.entities`，0009 的人员键 allowlist CHECK 依旧成立。
   **题面过红线**（title/label/help/choices，两档，复用 `AVERY_ALLOW_PERSON_SCORING`）。
5. **公司名占位符**：`/ingest` 给每个 context 起的名恒是 `"company"`（`ingest_api.py:309`，真公司名
   目前没有采集面）。快问页因此在员工眼前印「company 的负责人」。表单页不跟着犯：名字是占位符时
   说「你们的负责人」，有真名字时照常带上。**快问页那处没动**（不在本票范围）。

## 门与账

| 门 | 结果 |
|---|---|
| 后端离线全量电池 | **3609 passed** / 99 deselected / 4 xfailed（本票前是 3544 → 新增 65 条） |
| `@needs_db` 真库（本地 Docker PG 17 + pgvector） | 本票新增 **18 条全过**（16 条 pg 腿 + 2 条持久性/CASCADE） |
| curl 全链（真库 + 真 HTTP） | 200 → 409 → 422 → 422 → 404 全对，见 `curl-transcript-T1.txt` |
| 变异测试 · 06 表契约门 | 三处变异（改题面 / 改必填 / 改情绪选项）**各自打红在正确的断言上**，还原后全绿 |
| 变异测试 · 上限与红线门 | 七处变异（删 MAX_FIELDS/MAX_CHOICES/MAX_RECIPIENTS 三处上界、删文本截断、红线门分别漏掉 title/help/choices）**各自精确打红一条**，还原后全绿 |

三个新测试文件：`test_form_intake_06_contract.py`（9）· `test_form_store_contract.py`（19 memory
+ 21 pg）· `test_form_h5.py`（37）。

### 合 main 前跑过一轮对抗性自审（5 维度找 → 每条派独立怀疑者推翻）

报了 8 条，**6 条被推翻、2 条坐实**。被推翻的那 6 条值得记下来，免得后面的人再推一遍：
死索引（PK 已经以 context_id 打头，部分索引即便命中也几无增益，且它建议的改法会弄坏能跑的读路径）·
两个双胞胎 `created_at` 在覆盖时的语义差（真差异，但没有消费者，且给 pg 加 `created_at = EXCLUDED`
会破坏「首次创建时间」这个更合理的语义）· number 下界用例「其实走了另一条分支」（产品代码是对的）·
`person_name=None` 的 NOT NULL（dataclass 缺省是 `""` 不是 `None`，场景不成立）·
`record_form_answers` 未深拷贝（唯一生产调用方的 answers 是同函数体内现造的，结构上不可能别名污染）。

**坐实的 2 条都是门的覆盖缺口（不是活 bug），已当场补上并逐条验过会红**：
1. 四个上限（`MAX_FIELDS` / `MAX_CHOICES` / `MAX_RECIPIENTS_PER_MINT` / 文本截断）此前**没有任何门
   看着** —— 复核者实测把四处上界一起删掉，当时 59 条全绿。这四条恰恰是没有第二道门的：
   `fields`/`recipients` 两个 list 在 pydantic 侧没有 `max_length`，0013 两张表零 CHECK，
   `/f/` 走 share 表盘只吃限流不吃 413 体积门。已补 `test_the_upper_bounds_are_actually_enforced...`
   与 `test_an_over_long_answer_is_truncated...`，**判据引常量**（改常量测试跟着走、删判据立刻红）。
2. 红线门有**四个出口**（模板 title / 字段 label / help / 每个 choice），此前只量了 label；
   复核者实测把 outbound 削到只剩 label，整套门依旧全绿。已把那条测试参数化成四例，
   另加一条反向自证（直接问检测器：语料本身确实违规），防止四条在量空气。

### ⚠ 一条既有的红，**不是本票引入的**（已做归属判定）

`tests/test_registry_contract.py::test_sweep_respects_the_batch_limit[postgres]` 在整轮
`-m needs_db` 里红。判定方法：用 `git archive HEAD` 导出一份**未含本票任何改动**的干净副本，
在同样条件（全新空库）下跑同一轮 —— **同一条测试、同一处断言、同样红**（pristine 67 passed +
1 failed；本票树 85 passed + 1 failed，差值 18 正好是本票新增的真库测试）。

根因：`pg_registry.sweep_ephemeral` 的子查询 `SELECT ... LIMIT %s` **没有 `ORDER BY`**
（`pg_registry.py:576-584`）。库里同时存在多条 ephemeral 候选时，PG 可以自由挑删哪几条，而这条
测试假定被删的正是它自己刚造的那三个克隆。单独跑（空库）恒绿，整轮跑（前面的测试留下别的
ephemeral 行）就会串味。**修法**：给子查询补一个确定性排序（如 `ORDER BY created_at, context_id`），
或让该测试在自己的 context 前缀里断言。不在本票范围，已开独立任务。

## 没做 / 故意留给后面的

- **提交进资料库**（`SourceDocument` + chunk + facts.md）—— T2 的活，本票刻意不碰。
- **回流人卡/项目卡** —— T5。内置模板的负载/情绪两格已经按 T5 要的形状备好了：`负载自述` 是
  0-100 的数，`情绪自述` 三个选项 `如常/偏紧/吃紧` **正是** `_MOOD_SELFREPORT_MAP`
  （`extract.py:79-90`）三个桶各自的头一个词，1:1 映射，T5 不用再造一层翻译（有门钉着）。
- **资料库前端第④段** —— T3，读 `GET /team/{cid}/forms` 与 `.../forms/submissions` 即可。
- **撤回一条已发出的链接**（revoke）：v1 没有。诚实三态目前是 未知→404 / 过期→404 / 模板被撤下→410。
  经理误发一条链接目前只能等它 7 天过期。要不要加是产品决定，不是遗漏。
- **防转发 / 实名绑定**：拍板 #4 明确进 roadmap，本票维持免登录 + 单人单链 + 7 天过期。

## 已知局限（诚实记账）

1. **滑杆恒有值**：HTML `range` 没有「没选」这个态，初值停在中点（50）。所以一份已提交的周报里
   `负载自述` 永远有数，「他没动过滑杆」和「他真觉得是 50」在数据上分不开。缓解：读数常显 + 提示语
   明写「默认停在 50」，员工提交前一定看得到即将交上去的那个数，没有藏起来的默认值。
   T5 把它渲染成人卡自述时，这条要跟着口径走。
2. **`/f/{token}` 每次 GET 都会 `reg.get(context_id)`**（为了拿公司名），在 pg 上等于重建整个
   `CompanyContext`（含向量库）。这是照抄快问 `/r/{token}` 的既有行为、不是本票新增的开销，
   但表单是员工侧主路径，量上来了值得给一个便宜的 `context_name()`。
3. **模板覆盖会动老答案的含义**：答案按 `field.id` 落，改 `label` 安全，**改/删 `field.id`** 会让
   老提交对不上号。已写进 `POST /team/{cid}/forms` 的 docstring，v1 没有版本化。

## 上产要素

- 后端换容器（从 `main` 构建）。新迁移 **0013 由 `_ensure_schema()` 幂等重放**，Supabase 首次
  boot 自动建表 —— 与 #49 的 0012 同一条路，无需人工执行 SQL。
- 前端**不需要**动（T1 没有前端面；资料库第④段是 T3）。
- env 无新增变量。`/f/` 复用既有的 `AVERY_RATE_SHARE_PER_MIN` / `AVERY_RATE_SHARE_BURST` 表盘。

## 本机遗留（下一个 session 注意）

- Docker Desktop 是本 session 为 needs_db 拉起来的；容器 `teammaster-postgres-1` 留在运行态。
- 本 session 建的三个 throwaway 库（`avery_t1form_test` / `avery_sweep_probe` /
  `avery_pristine_probe`）已 drop。
- 8147 上的 uvicorn 已按 progress.md 的可靠杀法清掉
  （`Get-NetTCPConnection -LocalPort 8147 -State Listen` → `Stop-Process`）。
- ⚠ **5173 上有一个 node 进程（pid 1740）不是本 session 的**：它 2026-08-05 09:48 就起了，
  比本 session（08-06 20:19）早一天多，本票是纯后端、从没起过 dev server。**没有动它**——
  那是别的线的。谁认领谁清。
- ⚠ 复核阶段的子 agent 为了验门真伪，在源文件上做过变异实验并自行还原。合 main 前已逐点核对
  全部变异位（红线门 `outbound` 两行、四处上限判据、number 上下界）均回到正确状态，且全量离线
  电池 3609 全绿、工作区只剩本票改动。**下次再让子 agent 做变异实验，收工必须像这样逐点复核**——
  它们是并发的，一个 agent 的「我已还原」不代表另一个 agent 没在同一个文件上留下东西。
- ⚠ **本机 curl 会把 argv 里的中文按 GBK 编**（实测「如常」→ `%C8%E7%B3%A3`，UTF-8 应是
  `%E5%A6%82%E5%B8%B8`）。第一版取证脚本因此拿到一片 422 —— **那是脚本在撒谎，服务端拒得对**。
  `curl-chain-T1.sh` 里的写法是：中文只走 heredoc（stdin 不过代码页转换），预先 percent-encode 成
  纯 ASCII 之后才允许进 argv。后面几票要在本机用 curl 打中文，照抄那个 `encode_body`。
