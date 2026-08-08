# 回执 · #70 file-ref-quality —— @ 文件引用两修

**票**：[#70](https://github.com/daniel-qian/avery/issues/70)（0808 演习第 3 轮，Danny：「提问的时候没办法引用文件对吧？」）
**线**：`claude/friendly-elion-7e8956`（worktree `D:/avery-wt-friendly-elion-7e8956`，隔离端口 5273/8237）
**落 main**：`fd77da6`（feat）+ `c9913cf`（merge，--no-ff）。**先合者**——#69/#71 尚未动笔，零冲突。
🔴 **没有 push**（main ahead origin 44）。**没有碰生产。**

---

## 一、病根（都是实测，不是读码推断）

侦察票面把两件事写成了「可发现性」与「注入质量」。动手前逐个跑 probe 复现，两条都成立，
而且**第二条比票面描述的更严重**。

### 1. 可发现性：文件候选被人员整类挤出「全部」视图

`searchAskRefs` 的追加顺序是 person/project → file → playbook，调用点 `AskRefComposer.tsx`
再裸 `slice(0, MAX_REF_OPTIONS=8)`。16 人 8 项目的真实团队里，8 个名额在第一类就吃光——
「全部」视图**永远**看不到文件与方法卡，只有点「文件」筛选 chip 才露头。功能一直在，
可发现性是零。

### 2. 注入质量：kind=file 引用拿不到文档正文（bullet 行恒不命中）

票面说「不读原文」。真正的机制更具体：`_file_doc_lines` 用「候选行文本 == 材料块原文」做
**等值 join**，而

- `materialize_memory`（registry.py）把材料块**原样**写进 facts.md——bullet 带着 `- `；
- `memory._candidates` 读出来时做了 `line.lstrip("- ").strip()`——`- ` 已被剥掉。

于是**所有 bullet 行恒不命中**。而文档正文几乎全是 bullet。demo-seed 实测（九份真语料，
heuristic extractor，配额 24）：

| 文档 | 材料块 | 旧口径注入行数 | 丢了什么 | 新口径 |
|---|---|---|---|---|
| `婚宴BEO与协调会纪要.md` | 19 | **4** | 日期/场地/桌数/菜单/对接人**一条没进**，只剩样板话 | 19（全进） |
| `本周周报.md` | 24 | **4** | 16 个人的负载自述全丢，只剩前言 | 24（配额顶格） |
| `管理规范与升级红线.md` | 40 | 18 | 每张方法卡的**标准动作**全丢，只剩标题与标签 | 24（配额顶格） |
| `员工花名册.md` | 21 | 24（全是实体名命中的人卡行） | 花名册表格本体一行没进 | 24 = 21 行表格 + 3 行人卡补位 |

「引了也没用」在数字上就是这个：引一份婚宴通知单，Avery 看到的是
「三亚屿澜湾度假酒店 · 内部资料 · 请勿外传」。

🔴 **旧的 `test_file_reference_injects_that_documents_lines` 一直是绿的**——它断言
`"别墅套餐推广" in joined or "周雅婷" in joined`，走的是实体名补位那条路，
**从来没有验到「读原文」这件事**。拿掉原文路它照绿（下面 born-red 实证）。
兜底伪装碑再记一次：判据落在「块非空」「有记录行」上，等于允许零正文召回全绿。

---

## 二、改了什么

### 前端（2 文件）

**`src/lite2/askRefs.ts`** —— 新增 `pickRefOptions(refs, limit)`：按 `REF_KIND_ORDER`
**轮转发牌**，一圈每类各一条，某类发完就跳过、名额回流给还有货的类目。
只有一类候选时（= 每个筛选 chip 视图）退化成裸 slice，**逐条与旧行为相同**；
总数没超上限时原样返回。顺带把中继解码白名单 `REF_KINDS` 改成由 `REF_KIND_ORDER` 派生
（同一份四元组两处各写一份，正是这次后端病根的同款）。

🔴 **为什么是交错，不是「算完名额再按类目成块吐」**：弹层列表被 #66 钳在 240px，
一屏只看得见 4–5 行。成块吐出时文件是第三块——名额给到了，人还是**要滚动才看得见**，
可发现性只修了一半。交错让前四行就把四类摆出来。

🔴 **为什么不把 8 调大**（票面明令）：门里有实证，见 born-red B。

**`src/lite2/AskRefComposer.tsx`** —— **只动两处**：import 加一个名字（第 16 行）、
候选 memo 那一行（188→192 区）。#69/#71 的保留区（props 78–110 / draft 118–119 /
handleSubmit 265–273 / input 376–400 / submit 401–408）**一行没碰**。

### 后端（2 文件）

**`eval-harness/avery/memory.py`** —— 规范化那把尺提成 `candidate_text(raw)`，
`_candidates` 改成调它。ONE RULER（`doc_key_of` 的同一条教训）：这把尺决定「两行算不算
同一行」，两处各写一份就是本次病根。

**`eval-harness/avery/ingest/references.py`** —— `_file_doc_lines` 重写成两段，
新增 `_doc_chunks(ctx, source_key)`（该文档自己的材料块，按原文行号排序）：

- **① 文档正文**：块原文逐字进块（含 `- `，与 `resolve_ref` 读回来的那行逐字符一致）；
  指针仍取候选面那一行的 `facts.md:<n>`——**可引用性一条没丢**。
  查不到对应候选行的块**跳过**，不编指针：`resolve_ref` 只认 facts.md/notes.md/case，
  `婚宴纪要.md:7` 一定 resolve 失败，模型会被卡在「重 cite」上（比少一行糟得多）。
- **② 实体补位**：该文档长出来的人/项目名命中的候选行，**只在①没吃满配额时**补位——
  花名册、项目计划这类文档的正文被结构化进了人卡/项目卡，只钉①会钉不到那些读数。

去重按**指针**不按文本（materialize 的文本去重会让两份文档共用一行，同指针塞两次是噪音）。

### 配额：`REF_TOTAL_DOC_LINES` **刻意不上调**（票面允许「适度上调」，此处放弃）

24 × `REF_MAX_LINE_CHARS`(200) = 4800，是**可证明**装进 `REF_MAX_BLOCK_CHARS`(6000)
的最大预算（实测：200 行大部头单文件引用 = 5443 字符、零截断）。调到 30 就是 6000+，
硬顶会把块从正文中间切断——「多给几行」换来的是最后一条引用被腰斩。要涨预算得先涨硬顶，
那是另一张票。这条推理写进了测试文件的注释里，免得下一个人再算一遍。

---

## 三、门

### 前端 `verify-at-references.mjs`：40 → **47 判据**

🔴 **门语料从 3 人扩到 9 人**，这不是凑数：旧语料（3 人 2 项目 4 文件 1 方法）里
`slice(0,8)` 本来就漏得出 3 个文件——「打 @ 看得见文件」**在没修的代码上也是绿的**，
判据会是空跑。新增六行避开三个既有判据的地雷：不带「林」（①的 `@林` 要恰好两条命中）、
不进「客房」部（③的 `@客房` 要唯一命中）、不带「别墅」（⑥的 `@别墅` 唯一命中项目）。

**⑤b（5 条，排在 ⑤ 之前——⑤ 点了「文件」chip，filter 是组件 state 会一直留着）**
1. 自证：人员+项目 ≥ 8（语料真能复现病根，否则整段空跑）
2. 自证：这一屏确实是「全部」视图（不是被上一段带过来的筛选态）
3. 打 `@` 零筛选：四类候选**都在场**
4. 候选总数仍 ≤ 8（「把 8 调大了事」这条路的讨伐位）
5. 文件候选**不滚就看得见**：整行落在列表可视带内（开层时 scrollTop=0）**且**中心点
   `elementFromPoint` 真命中（rect 不管裁剪/遮挡——verifiers-that-lie 碑）

**⑤c（2 条）**：文件候选 → chip → **POST 请求体带 `kind=file` + 中文 id**。
补的是既有覆盖洞：在这之前**没有一条 kind=file 的引用穿过 `toWireRefs` 进过网络层**，
非 ASCII 的 id（文件名就是 id）最容易出事的那段一直没被采样过。
⚠ 这两条**不是** born-red 判据（走的是文件 tab），恢复旧顺序它照绿——写在这里免得被当成。

### 后端 pytest：18 → **25**

原文行逐字在场 / 记录段里全在（不认卡片行）/ 每个指针仍 resolve **且指到块里印的那一行** /
实体补位没被挤没 / 三条配额边界（预算 ≤24、硬顶不撞**且不被截断**、八引用按份+保底非空）。

---

## 四、born-red 账（每条都真跑过，手工 Edit，不用 stash）

| # | 变异 | 结果 |
|---|---|---|
| 前 A | 恢复裸 `slice(0, MAX_REF_OPTIONS)` | **45 PASS · 2 FAIL**：候选 8 条**全是 person**、零文件 → ⑤b-3、⑤b-5 红 |
| 前 B | `MAX_REF_OPTIONS = 20`（票面明令禁止的懒办法） | **45 PASS · 2 FAIL**：总数 16 > 8 红；文件行 top=999 落在 listBottom=799 之外、scrollTop=0 → 「不滚可见」红 |
| 后 ① | 拿掉原文路（① 段） | 3 红（原文逐字 / 记录段全在 / 指针 resolve） |
| 后 ② | 恢复裸文本 join（不走 `candidate_text`） | **同 3 红**——证明病根就是这把尺 |
| 后 ③ | 拿掉配额检查 | 配额 3 条全红（24→200 行、块被硬顶截断） |

🔴 **旧 `test_file_reference_injects_that_documents_lines` 在 ①② 下照绿**——一组实验双证：
新判据逮得到、旧判据逮不到。变异 B 尤其值：它证明「不滚可见」那条不是花架子，
把上限调大真的会把文件推到帘子下面（#66 刚修完的溢出）。

---

## 五、验证账

- 后端全离线电池：worktree **3974 passed**；合流后主检出 **3981 passed**（+7 新用例），
  115 deselected / 4 xfailed。环境三件套 `AVERY_BRAIN=mock` + `AVERY_EXTRACTOR=heuristic`
  + `AVERY_EMBEDDINGS=keyword`。
- `npm run typecheck` 绿（worktree 与主检出各一次）。
- **全电池 A→B→C**（worktree，隔离 5273/8237，后端带 `AVERY_DEMO_SEED_DIR=tests/fixtures/demo-seed`
  + `AVERY_PUBLIC_BASE` 指 8237 + CORS 放行）：**A 30/30 · B 3/3 · C 3/3**。
  C 区跑完查了 HEAD——**没 detach**，仍在本线分支。
- **像素零漂移（真凭据在这一条）**：worktree 里 visual 首跑红是**无基线首写**（50 张 PNG
  全是那一刻新建的，一张都没比对——「恰好如预期的红最该翻日志」那条碑），复跑才是比对。
  真正的零漂移证据在**主检出**：合流后对着 08-08 冻的那 50 张真基线跑，**8/8 全绿，
  且基线 mtime 一秒没动**（是比对，不是被 `--update` 悄悄重写）。
  预期本就零漂移——弹层只在开层时渲染，静息态 DOM 一字节没变。
- 合流树身份：`git diff claude/friendly-elion-7e8956 main` **空**——合出来的树与跑过全电池
  的树逐字节相同；主检出另跑了 at-references（**47/47**）与后端全量作复验。

---

## 六、🔴 票内核实出来的真缺陷：@ 文件引用会**静默引到另一份文档**

票面第三条要求「核实 AskRef.id 口径、匹配落点不悬空，发现问题记档，扩权另裁」。
核实结果**不是悬空，是更糟的一类**——已按票面纪律记档、**未扩权修**，另开票
（见文末）。

三把键里**只有前端那把没被消歧**：

| 键 | 文档① | 文档②（服务端重命名后） |
|---|---|---|
| 前端 `AskRef.id` = `LiveFileEntry.filename` | `周报.md` | **`周报.md`** ← 撞了 |
| `SourceDocument.source_key` | `周报.md` | `周报(1).md` |
| `ParsedDoc.name`（材料块 source 前缀） | `周报.md` | `周报(1).md` |

`service/ingest_api.py::_unique_parse_names` 补传重名时把 **parse name / source_key** 改名，
`filename` 保留原样；但 `registry.py::file_cards()` **只发 `filename`，从不发 `source_key`**，
于是前端拿不到那把被消歧的键。后果（真跑 `/ingest` + append 端点实证）：

- `references.py::_file_entry` 的 `d.source_key == want or d.filename == want` 对两份文档
  都成立，`next()` 恒取第一份 → **重命名的那份文档永远引不到**；
- 失败形态**比悬空糟**：没有「not found」行。卡片行真、`status ingested` 真、三个
  `facts.md:<n>` 指针都 resolve 得到、cite 得干干净净——**只是每一行都属于另一份文件**。
  经理 @ 刚补传的周报，模型读到的是上一版的内容；
- UI 里也看不出来：两行清单显示同一个名字，`AskRefComposer` 又按 `(kind,id)` 去重，
  两份塌成一个 chip，用户连「选第二份」都点不出来。
- 讽刺的是产品自己知道真名——append 回执里 `documents: ['周报(1).md']`，`UploadPanel`
  还专门显示这个服务端名；然后把用户领到一个查无此名的文件清单和 @ 菜单前面。

**没修的原因**：修法要动 `file_cards()` 契约 + `LiveFileEntry` 类型 + `askRefs.ts` 的 id
取值（`id: f.source_key ?? f.filename`，label 仍用 filename），三层一起改——票面写明
「扩权另裁」。`_file_entry` 的 `source_key == want` 分支**今天就已经能正确处理那个 id**
（对照跑实证：按 `周报(1).md` 引用，本票的新原文路把该文档自己的行完整带了出来），
所以那张票是纯前端契约票，后端一行不用动。

---

## 七、已知边界 / 顺手发现（没顺手修）

- **`>` 开头的材料块结构性不可引用**：`_candidates` 跳过 `>` 行，这类块永远拿不到可 cite
  指针，本票的①段会跳过它们。真语料里罕见，但别写「100% 块召回」这种判据。
- **facts.md 指针不是单射**：`materialize_memory` 按文本去重，两份文档的同一句话共用一行。
  指针 resolve 得到、文本逐字相同，可引用性成立——但**别拿指针反推「这行属于哪份文档」**，
  那样的判据会对着正确代码假红。
- **自述数字的口径**：`self_report` 开关只管**人卡投影**；`- 小王｜负载自述：70%` 这类
  **原文行**本来就在 facts.md 材料区，`recall()` 与既有的 person 引用捞行路径今天就能带出来。
  本票让 file 引用与它们一致，**没有新增暴露类别**。要收紧是 ADR-0018 那条线的票。
- **`tests/test_at_references.py:90` 有个潜伏 typo**：`rep.errors`，而 `IngestReport` 上
  只有 `parse_errors`。只在断言真的失败时才炸，把一次干净的红变成一条 AttributeError
  traceback。本票新加的三个 fixture 都避开了它；**没顺手改**（stay in scope）。
- **门语料扩到 9 人后**，⑨ 的 handoff 判据仍是动态取 `handoffs[0]`，自适应，没受影响。

---

## 八、复演（第 4 轮）该验的两句话

1. 打 `@` **什么都不筛**，一眼就看得见文件候选（不是滚出来的）；
2. 引一份文件问「这里面写了什么」，回答里**引得到那份文件的原话**（不是「这是一份已上传的
   文件」这种元数据话）。
