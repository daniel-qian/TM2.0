# 回执 · #76 资料库 IA 重排 + #77 删除文件 + #74 file-ref-id（0808 战役 wave 1 · S2）

> 三票捆一个 session。落 main 的四个 commit：`702287a`(#74) → `b3b56ce`(#77+#76) →
> `3aa77e5`(upload_guard 改判) → `021bc58`(#76 导航样式)。**未 push、未上产。**

---

## 一、#74 file-ref-id —— @ 文件引用按服务端消歧键寻址

### 病根（#70 核实时实证，比悬空糟）

三把键里只有前端那把没被消歧。服务端 `_unique_parse_names` 补传重名时改的是
`source_key`（`周报.md` → `周报(1).md`），`filename` 刻意保留原样；而 `file_cards()`
**从不发 `source_key`**，前端只能拿 `filename` 当 `AskRef.id`。于是
`references._file_entry` 的 `d.source_key == want or d.filename == want` 对两份文档都成立、
`next()` 恒取第一份 —— **@ 刚补传的周报，模型读到的是上一版**。失败形态干干净净：卡片行真、
`status ingested` 真、`facts.md:<n>` 指针全 resolve 得到、cite 得毫无破绽。

### 改了什么（三层，后端逻辑一行没动）

| 层 | 改动 |
|---|---|
| `avery/ingest/registry.py:790-812` | `file_cards()` 补发 `source_key`，值取**已解析**的 `sd.source_key or sd.filename` |
| `src/lite2/transport.ts` `LiveFileEntry` | 加 `source_key?: string`（additive，老后端缺席退 filename）；`stubTransport` 补同名字段保形状 |
| `src/lite2/askRefs.ts` file 候选 | `id: f.source_key \|\| f.filename`、**label 仍是 filename**；重名消歧复用 person 的 `dupeTeam` 槽位挂服务端真名 |

**为什么后端发的是「已解析」值而不是裸字段**：那正是 `n_chunks` join 的同一个表达式、也是
`_file_entry` 匹配的同一个字符串（ONE RULER）。发裸字段会让 pre-032 老行拿到一个空串 id，
匹配不上任何文档。

**为什么 AskRefComposer 一行没动**：`dupeTeam` 在 `:354`/`:377` 是 kind-无感渲染的，
`data-ref-id` 直接取 `opt.id`。复用现成槽位 → 与并行线 S1（正在大改那个文件）**冲突面为零**。

### 门与变异

- `test_at_references.py` 25 → **28**（清单发消歧键 / 两个 id 各读到自己那份的独有原文行，
  含「引 A 时块里**没有** B 的行」的对偶判据 / 裸 display 名仍取第一份的退化路存档）。
- `test_registry_contract.py` +2 断言（重名两行 `source_key` 互不相同；pre-032 老行退回
  filename 而不是空串）。
- `verify-at-references.mjs` 63 → **70 判据**：新段⑩真走 `appendFiles` 补传同名文件，
  判据落在 `data-ref-id` 与 **POST /advise 请求体**上。
- **M-1**（`file_cards` 发 filename）→ 只红 `test_file_cards_publish_the_disambiguated_key`
  一条，其余 27 条绿。
- **M-2**（askRefs id 改回 filename）→ 门 66 PASS / 4 FAIL，红的正是四条判别判据。

🔴 **两条自证前提在病根代码上是绿的，所以它们不能当判据**：「候选有两条」实测 PASS
（候选列表**不去重**，去重只挡已选 chip 的重复添加）、「候选里有『项目周报.md』」也 PASS。
写门时先按错的假设写了注释，被实跑打回并改正。

---

## 二、#77 删除文件

### 架构裁决：独立模块，不进 mixin、不进 Protocol

新建 `avery/ingest/file_delete.py`。三条理由：① `ProjectWriteMixin` 的 docstring 明写
「不含任何物理删除路径」，往里塞真删除会让代码与自述打架；② 删除要编排
`materialize_memory` + store 重铸 + `source_files` 收缩，那是 CompanyContext 级编排，
mixin 里全是三行 `get→mutate→put`；③ 走独立函数则 **`test_registry_protocol` 零变动**
（它有一条 `assert "delete" not in protocol_members()` 的钉子，命名带 delete 前缀的成员会
直接引爆）。

### 删什么 / 不删什么（票内裁定）

**删**：原件字节与清单行、`source_files` 那一项、这份文档切出的材料块、它孵出的信号、
粒度闸对它那些候选的裁决、**以及任何一条把它当一方的冲突**。

冲突为什么整条删：`FieldConflict` 是一句「这两份资料对同一格给出了不同读数」的陈述，
一方没了这句话就不成立；留着它，今天页会拿一份经理刚删掉的文档跟他对质。而「摘掉一方
再重推胜者」＝**替抽取器编一个它从没做过的判断**。

**不删人卡/项目卡** —— 血缘不够，不是偷懒：实体只有单值 `source` 且归并是 keep-first，
多文档喂出来的卡 `source` 恒指第一份；字段级 `provenance` 只在补传/手编/表单回流时 stamp，
**只 ingest 过一次的公司整个是空 dict**。按 `source` 判会误删，按 `provenance` 判则一条都
判不出来。删完卡上读数仍在、出处没了 —— 诚实降级，删除确认文案预告了这一点。

### 三个命门（照 `file_append.py` 的碑）

1. 绝不新造 `CompanyContext`（pg 的 put 是 DELETE+INSERT 快照替换）。
2. 先查后改（内存 `get()` 返活引用，删一半再抛 = 坏状态已落库而调用方以为什么都没发生）。
3. `materialize_memory` 必须在 `put()` **之前**（pg 侧 facts.md 正源是 `avery.memory_files`
   表，只改磁盘会被下次 `get()` 刷回来）。

🔴 **store 分流按 `isinstance(PgVectorStore)`，不用鸭子探测**：pg 下数据库自己才是 store，
无脑重铸 `KeywordStore` 会把这家公司从向量检索**静默降级**到关键词 —— `query()` 照样返
结果、所有现存门全绿。判据必须落在 store 的**类型本身**上。

### 端点与边缘闸

`DELETE /team/{id}/files/{key:path}`，寻址用 **source_key 不用 idx**（`put()` 用 `enumerate`
重排 idx，删完之后前端手里的旧 idx 会**静默指向另一份文件** —— 不是 404，是下错文件）。
404 同体，不给存在性 oracle。

顺带补上 `upload_guard` 的缺口：`_GUARDED` 是精确匹配字典，带路径参数的路由永远命不中，
**DELETE 在 ASGI 边缘本来是零限流**。

### 门与变异

`test_file_delete_t77.py` **15 离线 + 3 needs_db**。判据落「引用不到已删文档的原文行」，
三条读法各钉一遍（facts.md 正文 / `memory.recall` / `build_reference_block`）。

| 变异 | 结果 |
|---|---|
| M77-A 摘掉 `materialize_memory` | 只红两条记忆面判据，**「文件行没了」那几条全绿** —— 正是票面要求判据落在原文行上的理由 |
| M77-B 摘掉 store 重铸 | 只红两条检索面判据 |
| M77-C 拆掉 `PgVectorStore` 分流 | 只红那条**类型**判据；另两条真库判据与整个离线套全绿（静默降级零门可红的形态，现已钉住） |
| M77-D 端点摘掉 `authorize_context` | 只红「无 token 必须 404 **且文件仍在**」 |

**全量 needs_db 109 passed**（本地 throwaway 库 `redesign0808`，绝不碰生产预检容器）——
价值在于别人那 106 条证明我没把既有持久化打坏。

---

## 三、#76 资料库 IA 重排（纯前端，后端契约零变动）

| 票面项 | 落地 |
|---|---|
| 分区按频率重排 | ①当前资料 → ④常驻表单 → ②a补资料 → ②b另建公司 → ③切换；④ 段内「谁交了」提到最前 |
| 锚点导航 | `.lite-files-nav`，导航项跟着段落**真实存在性**走（不许悬空锚点） |
| 折叠 | **刻意不做**（理由见下） |
| 上传框合一 | 走「状态机分家 + 视觉主次」，DOM 不合一（理由见下） |
| ②b 语义错位 | 新增 `newCompanyStatus`，只由 `uploadFiles` 写 |
| 谁交了 + 手动刷新钮 | 重呼既有 GET，零后端改；自动轮询明确不做 |
| 文件表补时间列 + 排序 | `uploaded_at` 从 feat-032 起就在 payload 里、一直没渲染 |
| 链接一键全复制 | 独立 state，绝不复用单值 `copiedId` |
| 静默蒸发可见降级 | 清单加载/失败态分离；④ 段用 `!!transport.fetchForms` 把「没这功能」与「拉失败」分开 |
| 删除键 + 确认步 | 挂 #77 的端点，能力探测不到就一个都不渲染 |

### 三条设计裁决

**① 不做折叠（不用 `display:none`）**。playwright 在隐藏元素上四种结局并存：`hasText`
照样命中于是随后的 `.click()` 等 30s 把门**崩**掉；`.innerText()` 返空串于是判据以「文案
不对」**假红**；`.count()` / `querySelectorAll().length` 完全免疫于是继续**假绿**；段级
`.screenshot()` 直接抛错。一道门四种结局，读日志的人会归因成四个不同的 bug。要折叠得同
commit 给每道门补「先展开」，那是 #79 重冻那一趟一起做的事。

**② 上传框不做 DOM 合一**。`ingestStatus` 是约二十道门 `waitForFunction` 的等待锚
（file-manifest-truth / append-story / context-switch / at-references / topbar-clearance…），
少写一次不是一道门红，是整条电池挂在超时上；`verify-append-story` 还有一条「全屏必须同时
有 append 与 new 两个 `data-upload-mode`」的产品判据。合一的收益（少一个框）远小于改判成本。
所以走**状态机分家**：新增 `newCompanyStatus` 只由 `uploadFiles` 写，老那格一行不动。
②b 面板从此不再在恢复会话后恒显示「团队已就绪」+当前公司文件 chips。

顺带闭两个洞：append 跑着的两分钟里另一个 dropzone 此前**不置灰**（能误开第二家公司），
错误态重试钮此前裸 `click()` **绕开了 busy 闸**。

**③ 类型列不做**。扩展名本来就在文件名里，`doc_kind` 是机器词（`'company'`），单开一列是
噪音。为此**删掉了已经加进 en/zh 的 `fileTime`/`fileKind` 两个键** —— `i18n-orphans` 当场
把它们报成孤儿（红旗），为「以后可能要用」先建键就是制造孤儿。

### 门

新门 **`verify-files-ia.mjs`（17 判据）已进 ROSTER A 区**。补的是一块**真空白**：钉 lite2
清单的 `assertFilesSurfaceV2` 住在 `live-frontend-gate.snippet.js`，那是往浏览器控制台贴的
**手工**门 —— `git ls-files "*verify-*.mjs"` 捞不到、run-battery 也不跑，于是「清单行长什么
样」一条自动判据都没有。它顺带堵了 filesSurfaceV2 的一个**假绿口**：那道门只查「行数>0 且
每行合规」，两个 UploadPanel 都渲染清单时**双倍行数照样全绿**。

| 变异 | 结果 |
|---|---|
| M76-A 拆掉确认步 | 红 5 条删除流判据，①②③④ 全绿（收敛）。⚠ 第一次跑把门**崩**成 TimeoutError 而不是干净的红 —— 已把交互步全部改成崩不掉（count 判空 + try/catch timeout） |
| M76-B 时间列抄成 `iso.slice(0,16)` | **只红换算那一条**；「每一行都印出了时间」保持绿 —— 后者单独当判据就是假绿（差八小时照样过） |

---

## 四、验证账

| 电池 | 结果 |
|---|---|
| `npm run typecheck` | 绿 |
| 离线 pytest（四 deselect） | **4028 passed**（`TZ=UTC`）。本地时区下多 1 红 = 已证的时区假红，见 §五 |
| needs_db 全量（本地 throwaway 库） | **109 passed** |
| 电池 A 区 | **32/32 绿**（含新门 files-ia） |
| 电池 B 区 | data-boundary 绿；null-owner **没跑**；visual 见下 |
| 电池 C 区 | **3/3 绿** |
| `i18n-orphans` | **0 个孤儿** |
| 像素（主检出真比对） | 恰好 aurora/paper × desktop/mobile **四张 files 空态**漂移，其余 46 张逐字节未变；重冻后复跑 8/8 且零改写 |

**两条 B 区红都核实过、都不是代码问题**：

- `visual-baseline` 在 **worktree 里是首写基线**（50 张 mtime 全是当次），复跑对着自己刚写
  的基线全绿 —— 「worktree 里冻＝白冻」。真比对搬到主检出做，比对前后 md5 全表对过。
- `null-owner` 的 `:28` 把 `127.0.0.1:5173` **写死**、不吃 `VERIFY_BASE`，隔离端口上只能记
  「没跑」（与 wave 1 同一形态，事实仍在）。

**像素比对途中还踩了一次已知的假红**：第一轮 diff 指向 `home-mobile` 而不是 files ——
主检出后端的 `AVERY_CORS_ORIGINS` 写成了 5383 而 preview 在 5384，「后端够不着 → home 先红」。
改对 CORS 后就恰好是那 4 张。

**截图人眼过逮到两条门一条都没红的缺陷**（`021bc58`）：分区导航加了类名没加样式 → ①渲染成
一串裸的蓝色下划线链接、零间距；②`.lite-files-scroll` 的 820px 居中是一组**逐个子元素点名**
的选择器，新加的 `<nav>` 不在名单里 → 掉出内容列贴到屏幕最左边。三条 DOM 判据（锚点在场、
零悬空、段落顺序）全绿。修完复跑 files-ia / topbar-clearance / contrast-smalltext /
button-family / aria-zh **五道全绿**。

---

## 五、顺手发现，没顺手修（都进 progress.md Notes）

1. 🔴 **`test_decision_grading.py::test_a_freshly_claimed_sample_team_is_not_told_its_material_is_stale`
   是时区跨零点的潜伏假红**：`uploaded_at` 记 UTC 日、断言用 `date.today()` 取**本地**日，
   UTC+8 上每天本地 00:00–08:00 必红（`TZ=UTC` 跑就过，两向都实测过）。产品侧同源：那八小时
   里「刚传的」会被判成前一天。修法涉及 `as_of` 该取 UTC 还是本地的语义取舍，不在本票射程。
2. 🔴 **`KeywordStore` 的分词器是 `[a-z0-9]+` —— 纯 ASCII，对无空格中文 `query()` 恒空**
   （`store.py:37/46`）。任何拿中文串断言「检索得到/检索不到」的判据都是空跑。本票的门语料
   因此埋了一个 ASCII 编号当抓手，另配一条 `len(store) === len(materials)` 的结构判据兜中文块。
   这条值得单独扫一遍全仓有没有别的门骑在这个假设上。
3. `assertFilesSurfaceV2` 只有手工门、无机械 runner，且有「双倍行数照样绿」的假绿口
   （本票用新门堵了后者，前者仍是暗区）。
4. `copyLink` 两级降级都失败时**逐行**仍然没有可见反馈（既有设计，URL 恒可见可选）；
   本票只给「复制全部」补了失败态。
5. pre-032 老行的边界：两份 `source_key` 为空、filename 相同的老文档会共用同一个 id、
   被 `(kind,id)` 去重塌成一个 chip。历史数据边界，不在这三票里修。
6. `src/lite`（v01 冻结壳）的平行 `LiveFileEntry` **刻意不补** `source_key` —— 那个壳没有
   @ 引用功能，加了是无人消费的字段；#33 退役时整个类型一起走。

---

## 六、刻意没做的（别记成已做）

- **文案批改归 #79**。本票只为新部件加新键，`upload.againTitle/againBody` 等旧键一个字没动
  —— 但注意：#79 §5 表里 `againBody` 那句「要给现在这家补资料，用**上面**的口子」在本票重排
  之后方位词已经不准（补资料段现在排在它**上面**仍然成立，重排把 ④ 插到了两者之间）。
  #79 改这句时按新序复核一遍。
- **FileManifest 的清单行仍只渲染 filename** —— 两份同名文件在资料库里逐像素相同。#74 修的
  是**引用键**，别记成「文件重名可辨性已修」。
- **表单历史（往期）、提交内容就地阅读、文件搜索、批量多选、整页拖拽** —— recon §5 差距表
  里的其余项，本票未做。
- **删除后人卡/项目卡不收缩**（§二裁定），连带三处已知悬空：`FieldConflict.values[].doc_key`
  可能指向不存在的文档（本票已整条删有关联的冲突，但**只删「引用了被删文档」的那些**）、
  `references` 找不到时静默兜底、`extraction.granularity` 在 pg 侧本就不往返。
- **未 push、未上产。**
