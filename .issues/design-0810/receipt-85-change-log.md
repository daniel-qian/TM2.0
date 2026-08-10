# 回执 · #85「这次补料改了什么」只读清单 + 已查阅（0810 设计轮票 3）

> 正源：`.issues/design-0810/design-plan.md` §5.2 + §7.1 + §7.3（Danny 2026-08-10 已审过）· issue #85
> 日期：2026-08-10 · 分支 `claude/elated-maxwell-b1fe52`
> 前置 #84 已在本地 main（`7dba6ad`）· 🔴 **未 push、未上产。**

---

## 1 · 一句话

补上新资料之后，Avery 照旧**安静地**把卡片改成新说法（拍板③ 一字未动），但从此在资料库左栏
多出一个「资料更新」分区：**哪张卡的哪一格、从什么变成什么、依据是哪一份文件的哪一行**，
一行一条，每条可标「已查阅」。不弹通知、不占今天页。

---

## 2 · 🔴 与票面唯一的实质分歧：取数走 **#87 血缘**，不走 `payload["conflicts"]`

票面写的是「加一个 additive 的 `payload["conflicts"]`」，并注明：

> ⚠ 旧值只覆盖 **3/10** 字段（人 `team`，项目 `status`/`dueDate`）。**先按「这 3 个给前后值、
> 其余给『已按〈某文件:行〉更新』」落**；要全部 10 个都给前后值就得等 #87。

**#87 在同一天已经落地并进了本地 main（`c72dc34`）**，它的 `lineage.fields[f].prev` 覆盖
**全部 14 个**文档可写格子（人 5 + 项目 9）。所以票面自己写的那个条件已经成立，本票走血缘：

| | 票面原方案（conflicts） | 落地方案（lineage） |
|---|---|---|
| 「从 X 改成 Y」覆盖面 | 3 个字段 | **14 个字段**（refreshable + unioned 全覆盖） |
| 引文可点 | ❌ `_conflict_evidence` 把记录拍平成 `string[]` 且**刻意不带行号**（§7.3 订正的第二条） | ✅ `fields[f].source` 就是 `<文件名>:<行>` |
| 「补上了」（空→有值） | 记不进 conflicts（那不是分歧） | ✅ 有 provenance 无 prev = enrichment |
| 后端成本 | 一个 additive 投影 | 一个 additive 投影 + `lineage["added_in"]`（下面 §3） |
| 票 7（逐条撤回）复用 | ❌ 得重修一条路 | ✅ `prev` 链就是它要写回去的东西 |

两条方案的后端成本几乎一样，输出差一个量级。**票 7 仍然独立、本票一个字节都没碰撤回。**

---

## 3 · 改了什么

### 后端（2 个文件 + 1 份新测试）

| 文件 | 改动 |
|---|---|
| `avery/ingest/extract.py` | 新增 `note_added_in()` + `merge_person_reading`/`merge_project_reading` 的 append 分支各调一次；`lineage` 那一节的长注释从「两个键」改口成「三个键」 |
| `avery/ingest/registry.py` | `_one_person_card` / `_one_project_card` 各加一条 additive `card["lineage"] = dict(...)`（缺就不发键，同 `provenance`） |
| `tests/test_change_log_t85.py` | **新**：18 条离线 + 1 条 `@needs_db` |

**`lineage["added_in"]` 为什么非有不可**（票面「缺的三样」之二）：新建的卡走的是
`merge_*_reading` 的 append 分支，**一格都没被顶掉** → `fields` 全是 `seeded`、`provenance`
一个键都没有 → 「这批资料新增了两位同事」在卡上**结构性地留不下任何痕迹**。
它刻意**不**用 `provenance` 记：`origin:'doc'` 在屏幕上的意思是「被后来的上传顶掉过」，
给新卡盖这个戳就是撒谎，而那句谎正好会拆掉本票便宜的地基（#87 §4① 的第 3 条）。

**零迁移**：`added_in` 是 `lineage`（jsonb）**里面**的嵌套键，`0009` 的 CHECK 只查顶层键，
而 `lineage` 这个顶层键 #87 已经加进 allowlist 了。这句话不是读码推断——`@needs_db` 那条
在一次性真库上跑完整往返把它变成了实测（§6）。

### 前端（1 个新模块 + 5 个文件）

| 文件 | 改动 |
|---|---|
| `src/lite2/changeLog.ts` | **新**：派生层（payload → 按文件分组的流水）+ 文案层（字段名/值成句/显示宽度截断） |
| `src/lite2/screens/FilesScreen.tsx` | 左栏第三行「资料更新」+ 工作台那一区 + 引文点击跳转 |
| `src/lite2/transport.ts` | `LiveEntityLineage` 三个类型 + 两张卡各挂 `lineage?` |
| `src/lite2/projectView.ts` | 抽出 `statusTokenLabel` / `statusTextLabel`（**只留一把尺**，见 §4） |
| `src/lite2/icons.tsx` | `ChangesZoneIcon` |
| `src/shared/i18n/{zh,en}.ts` | 22 条新键，**两份手工写**（`i18n-zh*.mjs` 一个都没跑） |

**「已查阅」零新状态机**：直接用 `flowStore` 那本三态标记库（今天页冲突卡已经在用，
`conflict_` 前缀），这里用 `change_` 前缀分桶，`restoreGap` 就是取消标记。flowStore 一个字节没改。

---

## 4 · 六个设计决定与它们的理由

### ① 入场判据是**两本账**，缺一不可

```
origin === 'doc'  且  lineage.fields[f] 在   →  这一格被一份更新的资料改过
  · 有 prev  → 「老周 → 小马」
  · 无 prev  → 「补上了 …」（enrichment：空格子被填上，没毁掉任何读数）
origin 缺席      →  首次上传铸的，不进流水（stamp 只在补传/手编/表单回流三处开火）
origin === 'manual' → 经理接管了这一格，不进流水（屏上那个值不是文档写的）
lineage.added_in →  整张卡是这批新建的
```

只看 `lineage` 不看 `origin`，首次上传的每一格会当场涌进流水（变异 M-G 实测 6 条判据红）。

### ② 分组单位是**文件**，不是批次

引文本来就是逐文件的，而经理心里的单位是「我传的那份纪要」，不是一个哈希出来的批次号。
组的先后按文件清单的上传时刻倒序；清单还没回来时退回派生顺序——**一条流水的存在与否不该
等第二个请求**（`GET /team/{id}/files`）回来。

### ③ 值的词表**必须与卡片同源**

旧值在血缘里存的是**归一化 token**（实测 `prev.value === 'on-track'`）。直接印出来，经理会在
流水里读到一个项目卡上从不出现的词。所以从 `projectView.ts` 抽出 `statusTokenLabel`，
项目卡与流水共用同一把尺（变异 M-H 钉着它）。

### ④ 三条「宁可不显示，也不显示一句假话」的边界

- **卡上读不出现值的格子不出现**：`dependsOn` 在血缘里跟着，但 `_one_project_card` 从不投它
  —— 渲一行「依赖改成了 X」，用户在任何一块屏上都找不到那个 X。
- **归档的卡不进**（`archived_people`/`archived_projects` 两个键这里不读）：经理自己收起来的
  东西不该在别的屏上再冒出来。
- **一格只留最近一次**：同一格被两份资料先后改过时，`fields[f]` 指向最新那份，更早那几次躺在
  `prev.prev` 链里。这条流水答的是「这一格现在为什么是这个值」，**不是完整日志**——完整日志
  是票 7 的形状。⚠ 这条是刻意的取舍，不是漏做。

### ⑤ 行 id 里带着**出处文件**

`change_<kind>:<卡 id>:<字段>:<文件名>`。同一格被**另一份**资料再改一次 = 一条新的改动，
该重新回到未查阅。不带文件名的话，经理看过一次「负责人 老周→小马」，一个月后另一份纪要
把负责人又改成别人，这条改动会**生下来就是已读**——一次真改动被一次早就发生过的「我看过了」
永久吞掉。门 ⑪ 用**第三批资料**真跑了这条（变异 M-J 钉着它）。

### ⑥ 左栏那颗数字数的是**未查阅**

看过的不该继续在栏上敲你——这正是本票与拍板③ 共存的分寸（变异 M-L）。

---

## 5 · 与拍板③ 的共存，写成了两条可执行的判据

`.issues/gap2-0807/tickets.md` 拍板③（2026-08-07）：「补传后**安静更新**、不打扰」。
本票按 2026-08-10 定的「两者共存」落：**不弹通知、不占今天页**，只在资料库里有一处可查。
`file_append.py:23-32` 那段照拍板③ 刻的注释**一个字都没动**。

门里两条盯着它：
- ⑨ 今天页上零行、零 section；
- ⑨ 铃铛里**没有一条通知在讲「资料更新」**。判据刻意不是「未读为 0」——补传本身会发一条
  `ingest` 通知，那是既有行为、不归本票；判的是**没有一条通知在讲这件事**。

---

## 6 · 验证账

| 项 | 结果 |
|---|---|
| **离线全套** `TZ=UTC python -m pytest -q` | **4132 passed · 0 failed · 137 deselected · 4 xfailed**（137s）。基线 4114 + 本票 18 = 4132 ✅ 对得上 |
| **真库套** throwaway `avery_t85_test`（docker `teammaster-postgres-1`） | **62 passed · 0 failed**（`-m needs_db`，含本票 1 条 + t87/registry_contract/registry_protocol 全部） |
| **新门** `verify-change-log.mjs` | **41 PASS · 0 FAIL** |
| **前端电池** A / B / C | **38/38 · 3/3 · 3/3 全绿**（A 区含新门；顺序 A→B→C 未乱） |
| **像素基线** | **8 passed**，且 54 张基线 md5 **前后逐字节相同**（见下面那条 🔴） |
| **变异** | **15 条逐条独立跑、跑完还原原始字节 → 15/15 全红**（台账 `_px85/mutations.md`） |
| `./init.sh`（lint + typecheck + build） | 绿（6 条 lint warning 全是存量，none 在本票文件里） |
| `i18n-orphans.mjs`（只读） | **0 孤儿**（22 条新键全部有引用） |
| 行尾自查 | 14 个文件全部 `bareLF == 0`（⚠ 两个新文件生下来是纯 LF，收尾转成 CRLF，见 §8） |
| 人眼过图 | `_px85/after/` 4 张（paper/aurora × 桌面/手机），**逮到一个门看不见的 bug**，见 §7 |

### 🔴 像素那一栏的口径（别照着「8 passed」就放心）

在**这棵 worktree 里**跑 visual 的第一次是红的，第二次绿——而全部 54 张基线的 mtime 都变成了
那一刻。worktree 的 `__snapshots__` 是 **gitignored 的每树一份产物**，在里面跑等于对着一份
自己刚写出来的东西比对。所以真正的比对是照纪律在**主检出 `D:\avery`** 跑的
（那里的基线才是权威的），`VERIFY_BASE` 指向本 worktree 的 preview：

- 8 passed；
- 跑前跑后对 54 张基线取 md5 **逐行 diff 为空** → **一张都没有被重写**，也就是说
  「全绿」不是靠悄悄重冻换来的。

零漂移是预期的，理由**结构性**：这一区只在**补传之后**才存在，而两套 spec（空态 9 屏 ×
2 皮 × 2 视口 + 数据态 3 屏）走的都是首次上传，左栏那一行根本不渲染。⚠ 但预期不等于验过，
所以上面那条 md5 对照是这句话的证据，不是它的替代品。

---

## 7 · 🔴 人眼过图逮到一个 41 条判据全都看不见的 bug

第一版截图上，引文长成这样：

```
d据《旺季排班协调纪要.md》第 1 彳        ← 两端各被切掉一个字，且一个省略号都没有
```

病根：`.lite-btn` 基类是 `inline-flex` + `justify-content:center`，而**居中的 flex 文本溢出时
朝两头同时溢**；`text-overflow:ellipsis` 对 flex 容器里的匿名文本压根不生效。

**为什么当时 41 条判据一条都没红**：它们读的全是 `textContent` —— 而 `textContent` 完整得很，
对裁剪一无所知（AGENTS.md「门扫 innerText 看不见属性」的同族：这次是看不见**裁剪**）。

改法 + 同拍补的门：
- CSS 改 `display:inline-block` + `text-align:left` + `line-height:24px`，`max-width` 32ch；
- 门 ⑧ 新增两条，**拿 `Range` 量文字矩形**：文字左缘不许跑到盒子左缘以外、右缘不许越出。
  判据落在「有没有被切」这个被测属性本身，不落在 `display` 值那种实现细节上；
- 变异 **M-O**（把它改回居中 flex）→ 2 条判据红，回归锁到位。

---

## 8 · 变异台账（15/15）与两条碑

| # | 变异 | 面 | 结果 |
|---|---|---|---|
| M-A | 新建的卡不再记出生批次 | py | 5 FAIL |
| M-B | 表单回流建的新人卡也算一次「补料新增」 | py | 1 FAIL |
| M-C | 「被这批提到过」= 「这批生的」 | py | 3 FAIL |
| M-D | 人卡不再投 lineage | py | 4 FAIL |
| M-E | 项目投影**悄悄摘掉 prev 链**（看着完整，其实不是） | py | 3 FAIL |
| M-F | 出生批次改盖进 provenance（两本账混一起） | py | 1 FAIL |
| M-G | 去掉 `origin==='doc'` 闸（首次上传的格子涌进流水） | js | 6 FAIL |
| M-H | 状态印归一化 token，不印卡片上那个词 | js | 1 FAIL |
| M-I | 什么都算「改写」，enrichment 那一类消失 | js | 1 FAIL |
| M-J | 行 id 忘掉是哪份文件改的 | js | 2 FAIL |
| M-K | 截断按 `.length` 不按显示宽度 | js | 1 FAIL |
| M-L | 左栏数字显示总数而不是未查阅数 | js | 1 FAIL |
| M-M | 已查阅的行不收起（标了等于没标） | js | 3 FAIL |
| M-N | 点引文只切区、不筛到那份文件 | js | 2 FAIL |
| M-O | 引文退回居中 inline-flex（两端被切） | js | 2 FAIL |

### 碑① —— 一条**存活**的变异，查下去是死枝不是门洞

第一版 M-B 打的是 `note_added_in` 里那句「已经有出生批次就不改写」→ **ALL GREEN，存活**。
顺着查：两处调用点传的都是 `incoming`（一条刚从新文件抽出来的读数，`_init_lineage` 只播
`docs`/`fields`、从不播 `added_in`），所以那句守卫在现行链路上**永远为假**——它是死枝，
不是判据没牙。

处置：守卫**留着**（真有人把它挪进 `absorb`，出生批次至少不会跟着最后一次被提到的批次跑），
但在它的 docstring 里明写「这一句今天够不着」，并把 M-B 改打一条有牙的（表单回流那条边界）。
理由：**一条测不到的分支必须自己说自己测不到**，否则下一个人会把台账上那格绿读成
「这条守卫验过了」。同时把那条测试的 docstring 改成它真正证明的事（调用点的位置）。

### 碑② —— 一条**把页面打崩**的变异比一条「跑着却说错话」的弱

第一版 M-I 把 `hasPrev` 直接改成 `true`，于是 `prev!.value` 对 undefined 解引用，整屏崩掉，
门以「2 FAIL + CRASH」告终。它确实红了，但**随便哪条判据都能红一次崩掉的页面**——它证明不了
「⑤ 那条判据有牙」。改成只动分类（什么都算「改写」），UI 照常跑、只是说错话，1 FAIL 精确落在
⑤ 那条上。

### 顺带：`anchor-check` 又立了一次功

M-K 第一版把 `clampWidth` 那条正则里的 **CJK 字面量**整段抄进锚点 → `n=0`。
**0 处命中长得和「变异存活」一模一样**，anchor-check 就是为逮这一下存在的。改成只动权重那一位。

---

## 9 · 门改判（同 commit，配变异）

`test_entity_lineage_t87.py::test_the_wire_contract_for_provenance_is_untouched` 原本断言
`assert "lineage" not in card`（#87 是纯地基，投影归它的消费者）。**#85 就是那个消费者**，
所以那半句翻面成「血缘走**自己**那个键，且键集不许长出没人认识的第四个」。

🔴 **前半句一个字没动**，而它才是这条判据真正守的东西：`provenance` 仍是
`{origin, source, updated_at}` 的闭契约，M17（把血缘挤进 provenance）照旧一动就红。
本票新增的 M-F 从另一头再钉一次同一条分工。

---

## 10 · 刻意留下的账 / 顺手发现没顺手修

- ⚠ **「简介」那一行读起来像噪音**：截图里是「负责人：老周 → 负责人：小马」。这是**抽取器**
  给 `summary` 取值的方式（取第一条键行），不是本票的 bug；流水如实反映了那一格真的变了。
  要治得治抽取器，不在本票范围。
- ⚠ **`dependsOn` 永远不出现在流水里**（边界①）：血缘跟着它，但 `_one_project_card` 不投它。
  哪天它上了卡，这一行会自己冒出来，不用改这里。
- ⚠ **`clampWidth` 的死针探测**：第一版把长语料写成文末散文，指望它成为 `summary`——但
  summary 取的是第一条键行（6 个字），于是那条判据**一次都没跑到**，却以「截断没发生」的形态
  红。现在长值挂在 `阻塞` 上。**改文案/语料之前先想一遍：哪条判据从此再也判不到任何东西。**
- ⚠ **worktree 里那次 visual 假红**：见 §6 那条 🔴。本 worktree 的 `__snapshots__` 已经和主检出
  逐字节一致（md5 全表 diff 为空），但它仍然是个 gitignored 的每树产物，**下一个 session 别
  在 worktree 里判像素**。
- ⚠ **「已查阅」标记跨公司不隔离**：`flowStore` 的 `gapMarks` 是整个 localStorage 一本账，
  换账号时 `data-boundary` 门证明它会被清掉，但**同一账号切两家公司**时不会。这是既有行为
  （今天页的冲突卡同款），本票没有把它改坏，也没有顺手改好。
- 🔴 **本票没有做撤回**（票面明写撤回拆走独立成票 7，前置 #87 已就位）。流水是**只读**的。

---

## 11 · 复现命令

```bash
# 后端（隔离端口 8285）
cd eval-harness && AVERY_BRAIN=mock AVERY_EXTRACTOR=heuristic AVERY_EMBEDDINGS=keyword \
  AVERY_DEMO_SEED_DIR=tests/fixtures/demo-seed AVERY_PUBLIC_BASE=http://127.0.0.1:8285 \
  AVERY_CORS_ORIGINS=http://localhost:5285,http://127.0.0.1:5285 \
  python -m uvicorn service.app:app --host 127.0.0.1 --port 8285 --app-dir .
# 前端
VITE_AVERY_API_BASE=http://127.0.0.1:8285 npx vite build --mode development
npx vite preview --port 5285 --host
# 新门 / 全电池
VERIFY_BASE=http://127.0.0.1:5285 node eval-harness/tools/verify-change-log.mjs
VERIFY_BASE=http://127.0.0.1:5285 VERIFY_API=http://127.0.0.1:8285 \
  node eval-harness/tools/run-battery.mjs --only=A   # 再 --only=B / --only=C
# 离线 / 真库
cd eval-harness && TZ=UTC python -m pytest -q
docker exec teammaster-postgres-1 psql -U postgres -c "CREATE DATABASE avery_t85_test;"
docker exec teammaster-postgres-1 psql -U postgres -d avery_t85_test -c "CREATE EXTENSION IF NOT EXISTS vector;"
AVERY_DB_URL="postgresql://postgres:dev@127.0.0.1:5432/avery_t85_test?channel_binding=disable" \
  AVERY_BRAIN=mock AVERY_EXTRACTOR=heuristic AVERY_EMBEDDINGS=keyword \
  python -m pytest -q -m needs_db tests/test_change_log_t85.py
# 变异（先自查锚点，每条必须恰好 1）
python .issues/design-0810/_px85/anchor-check.py
python .issues/design-0810/_px85/mutate.py            # 不带参数=全跑
# 手拍 / 像素（🔴 像素必须在主检出 D:\avery 跑，worktree 里冻＝白冻）
VERIFY_BASE=http://127.0.0.1:5285 node .issues/design-0810/_px85/shot.mjs
cd /d/avery && VERIFY_BASE=http://127.0.0.1:5285 npx playwright test -c eval-harness/visual
```
