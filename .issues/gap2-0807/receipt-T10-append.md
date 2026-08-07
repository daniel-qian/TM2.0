# T10 · 补资料回执（issue #59）

> 一句话：拆掉「每次上传 = 新开一家公司」那堵墙——已有工作区能补传文件，卡片安静更新到新读数，
> 新旧对不上才上今天页。**没有砍半**：资料库、实体归并、卡片、出处、今天页五处一起接通。

跑完的账（都是实测数，不是估数）：

| 门 | 结果 |
|---|---|
| `./init.sh`（lint + typecheck + build） | 绿（5 条既有 warning，0 error） |
| 后端离线全套 | **3893 passed / 111 deselected / 4 xfailed / 0 failed**（合 main 前 3843，含本票新增 **45** 条） |
| `@needs_db` 全套（真 PG） | **102 passed**（基线 98 + 本票 **4**，7m13s） |
| 前端电池 A 区 | **27/27 绿**（含本票新门 `append-story` 18 判据） |
| 前端电池 B 区 | `data-boundary` 37/37 绿 |
| 前端电池 C 区 | 3/3 绿 |
| i18n | en 叶子键 **907**（原 898 + 本票 9），**孤儿 0**；zh/en 键集逐键对齐 |
| 变异测试 | 后端 **18/18 killed**，前端 **3/3 killed**（其中 1 条翻出门洞，见下） |
| 像素基线 | ✅ 已在**主检出**重冻并人眼过：漂移恰好 4 张 `*-files-*`，重冻后重跑 40 张零红（见文末） |

---

## 一、做了什么

### 1. 新端点 `POST /team/{context_id}/files`（`service/ingest_api.py`）

与 `/ingest` 的分界只有一句：**那个开公司，这个补资料**。同一个 `authorize_context`
（无 token / 错 token / 未知 id 一律同体 404，无存在性 oracle），字节侧的闸与 `/ingest`
**逐条同一套**：`enforce_count` → `read_capped`（413）→ 整批总量（413）→
`enforce_type_and_archive`（415/413）。回执 = 与 `/team/{id}` 同一张 payload（前端拿它整屏刷新），
外加一个 `appended` 块（这一趟加了哪几份、跳过了哪几份、新开了几条冲突）。
**不回传 owner_token**——那是创建时才交出去一次的凭据，这里没有新铸。

🔴 **边缘闸差点整个漏掉**：`upload_guard._GUARDED` 是一张**精确匹配**的字典，带路径参数的
路由永远命不中它。不补 `/team/*/files` 那条分支的话，新端点在 ASGI 边缘就是**零防护**
（无限流、无 Content-Length 预检、无流式总量兜底），而处理器内部的逐文件闸照旧生效——
「看起来有闸」正是这种漏法最难被发现的原因。已补，并有一条门盯着（`test_the_edge_guard_actually_covers_the_new_route`）。

🔴 **source_key 必须对着这家公司已占用的 key 去重**，不只是这一批内部去重
（`_unique_parse_names(..., taken=existing_source_keys(ctx))`）。`<source_key>:<行号>` 是出处契约的一半：
撞了 key 之后新文档的每一条读数都会被算到旧文档头上——文件清单的每文件块数、时间轴的那一天、
冲突卡上引用的那份资料，三处一起指错，**而且没有任何一道门会红**。

### 2. 新模块 `avery/ingest/file_append.py`

照 `form_append.py:192-257` 的 `get → 原地 mutate → put` 范式。三条命门写在文件头：
① 绝不新造 `CompanyContext`、绝不调 `ingest_paths`/`ingest_docs`（那是覆盖语义；pg 的 `put()`
是 DELETE+INSERT 快照替换，回填只补「行还在、格子是 NULL」，补不回「整行不存在」）；
② **只对新文件跑抽取**（LLM 花费与新文件成正比，不与资料总量成正比——第十次补传不该为前九批
再付一次钱，更不该把这十天的手编 CRUD 推平）；③ 先造后挂（能 raise 的事全做完才碰 `ctx` 一个字段，
因为内存 registry 的 `get()` 返回的是**活引用**）。

### 3. 实体增量归并（本票最重的一段，`avery/ingest/extract.py`）

`merge_person_reading` 的 docstring 里写着四个坑。这次把它们**逐条**变成了机制 + 判据：

| 坑 | 机制 | 判据 |
|---|---|---|
| ① 整表重写吞手编 / 软删 / 出处 | 只碰点名的那一个主体；`id`/`name`/`title`/`archived`/`provenance` 一个都不改写；手编（`origin='manual'`）恒不被文档顶掉 | `test_append_never_eats_a_hand_edited_cell` / `_an_archived_card` / `_a_manually_added_person` / `_truncates_a_hand_curated_list` |
| ② 旧冲突重复记账 | `AppendLedger` 的 conflict_index 从**持久化的** `extraction.conflicts` 重建，不是每次新建；同一条读数（值+出处）已在其中就不追加 | `test_the_same_corpus_appended_twice_does_not_double_the_conflict_rows` + `test_appending_the_same_corpus_twice_doubles_nothing` + needs_db 那条 |
| ③ `held_src` 记错 | 逐字段出处走 `provenance` 侧车（跨 `get()` 活着的那本账），侧车没有这一格才退回实体级 `source` | `test_the_conflict_cites_the_document_that_ACTUALLY_stated_the_held_value` |
| ④ signals 换尺重筛 | 先跑 `_link_owners`（全仓唯一那把姓名→id 的尺）把两边都换成 id，**然后**才按 `_signal_key` 去重 | `test_signals_are_deduped_only_after_both_sides_speak_ids` |

**人**：走 `PersonIndex` / `merge_person_reading` 扩展——加一个可选的 `ledger` 参数。不带账本时
行为**一个字节没变**（表单回流那条路照旧），带账本时 `team` 成为合法载荷。
这不只是放宽一条断言：`PersonIndex` 的**规则 3.5**（0807 HITL 补的同名+部门消歧）读的正是 `p.team`，
旧口径下带部门的读数在 `resolve()` 跑起来之前就被拒了——**补传是它第一次真的够得着**。

**项目**：本票**新写**了增量合并原语（此前只有整表重建和手编 CRUD）。
按 `_project_key(title)` 归并，并把 `_dedupe_entities` 循环体里那段合并规则提成了 `_absorb_project`，
两条路共用**一份**定义（理由与当年提 `_absorb_person` 时逐字相同）。顺带补了
`_disambiguate_project_ids`——项目侧此前**没有** id 解碰撞（`_slug` 折叠标点并在 32 字符处截断，
「别墅套餐推广（八月）」与「别墅套餐推广(八月)」是两张卡却共用一个 id），上传路侥幸没炸是因为
归并之后没人再加卡，而补传会往一份**在用**的清单末尾追加。

### 4. 安静更新（拍板③）

落成一句可执行的话：**只有确凿地知道新资料更新时，才让新值顶掉旧值。**
不知道（哪一边的 `uploaded_at` 认不出来、那份资料已不在 `source_documents` 里、两边同一时刻）
一律退回 keep-first——与 `clear_stale_self_report` 逐字同一条口径：绝不靠猜去改写一个有出处的读数。
时间只走 `decision_grading._uploaded_moment`（全仓唯一那个 ISO 解析器）。

顶掉之后，**逐字段出处写进 `provenance` 侧车**（`origin='doc'`，指向新文档的 `<key>:<行号>`）。
前端 `provenanceBadgeKind` 加第四态 `'doc'`，详情浮层显示「读自〈本周周报.md〉」——
`'doc'` 出处只有在补传改写过之后才存在（首批上传的格子不写侧车），所以这个角标出现的地方
**恰好就是**「这个读数被一份更新的资料顶掉过」。只印文档名不印行号（实体出处是块级兜底，
可能指着一个标题行）。

### 5. 前端入口

资料库屏第②段拆成两个动作：**「给这家公司补资料」**（append）与**「另建一份画像」**（new）。
`againTitle`/`againBody` 跟着改口——以前「合并」根本不存在，说「不会并进」是全部真相；
现在存在了，再说同一句就是把经理往错的按钮上引。

`UploadPanel` 加 `mode` 而不是抄第二份：`ACCEPT` 那行有一条明令「改这里要同步后端 `SUPPORTED_EXTS`」，
抄出去就是第二把尺，而它多列一种格式就是把用户领进一条必然 422 的死路。

store 的 `appendFiles` 走**自己的**状态机。借 `ingestStatus` 会发一条**假通知**：`notifyStore`
只认 `ingesting → ready` 这一跳并据此弹「你的团队已就绪」，而补一份周报不是团队就绪。

---

## 二、拍板与取舍（都是决定，不是意外）

1. **`values[0]` 恒为胜出读数**（`FieldConflict` 的既有契约）。补传路上新资料确凿更新时新值胜出，
   所以它**插在队首**；被顶掉的那些照旧按到达顺序排在后面（旧的胜出者本来就比后来的输家先到，
   所以插队首之后整条仍是「胜出 + 到达序」）。`_dedupe_entities` 那条路一个字节没动。
2. **手编赢，但绝不静默吞掉那条读数**。经理手填的格子不被文档顶掉；够得着冲突口径的字段
   照样记账（今天页读作「你手填的 X ／ 新资料读到 Y」，那条读数的 `doc` 就是「手动编辑」——
   它本来就是 registry 里那句系统自证式短语，不是编出来的文件名）。
   「静默吞掉一条冲突读数比拒绝写更糟」是 `merge_person_reading` 自己写下的口径。
3. **归档的项目卡照样是归并候选**（与 `find_bound_project` 刻意相反，两处的活不一样）。
   跳过它会给同一个 `_project_key` 再开一张卡，`_dedupe_entities` 保证的唯一性当场破掉，
   下一次整表重建把两张融回一张，经理那次归档就无声蒸发了。宁可让新读数落在一张他看不见的卡上
   （他自己归档的，恢复即见）。人卡侧本来就是这个口径（`PersonIndex` 不过滤 archived）。
4. **`ownerName` 被更新时同步清空 `ownerId`**。`ownerId` 是派生的 join key 不是独立读数，
   留着旧 id 会让卡上显示新名字、信号却仍挂在旧人身上。
5. **demo 克隆先禁入口，不做语义**（票面边界）。判据取**服务端**每帧都发的 `ephemeral`，
   不是只在领取首帧出现的 `demo`——后者刷新一次页面就没了，入口会自己冒出来，那读起来像 bug。
   为此给 `ContextRegistry` / `PostgresContextRegistry` / `ContextRegistryProtocol` 各加了
   `is_ephemeral()`，读的就是 GC 用的**同一个标记**，不是第二份口径。
   探测是 duck-typed + **fail-open**，与 `account_owns_context` 的 fail-closed **方向相反**且是故意的：
   那边答的是「要不要放行一次读」，出错必须拒绝；这边答的只是「入口要不要藏起来」，
   出错时少显示一个入口的代价是**真公司的经理补不了资料**。

---

## 三、变异测试

没有 mutmut/stryker 这类工具（本仓一直是手工变异）；这次把「改一行 → 跑门 → 记红绿 → 还原」
自动化了，判据本身仍然是人写的。脚本：`.issues/gap2-0807/t10-mutate.py`（后端）与
`t10-mutate-story.py`（前端）。

**后端 18 条，全部 killed**：账本不认领旧冲突 / 逐字段出处退化成实体级 source / 手编不再赢 /
新旧不比了 / 缺席判据退化成真值性（`progress=0`）/ 项目 id 不解碰撞 / 起名不看已占用的 key /
归档卡被跳过 / 边缘闸不覆盖新路由 / 不重写 facts.md / 出处 origin 用第四种取值 /
存量文档也重抽一遍 / 名字对不上的文档被静默滤掉 / 信号不去重 / 账本在场仍拒收 team /
冲突不按胜出者排序 / 一次性标记不投出去 / 红线硬门被摘掉。

**前端 3 条，全部 killed —— 但第一轮有一条活了下来，那是门洞不是代码 bug**：
「把补资料那个口子接错线、其实调的还是 `uploadFiles`」活了 0 红，因为 story 门当时**直接调 store**、
根本没碰过那个按钮。本票交付的东西就是这个入口，判据必须落在它身上——门已改成
`page.setInputFiles('.lite-files-append input.upload-input', …)` 走真界面，补杀（9 红）。
顺带把 `settle()` 改成超时不抛而是记一条会说话的 FAIL：接错线时状态机永远停在 `idle`，
裸 `waitForFunction` 会等满超时把整道门炸掉——炸掉也算红，但读日志的人看到的是一条
playwright 堆栈，而不是「这个口子接错线了」。

---

## 四、两条环境陷阱（都是假红，记档给下一个人）

隔离端口（后端 8147 / preview 5183）下，两道**别人的**门会假红，改的是环境不是代码：

1. `verify-onboard-gate.mjs` 的 `API` 常量默认 `http://127.0.0.1:8137`，只认 `VERIFY_API` 覆盖。
   不设就去打**另一个 session 的后端**，那边没有这个 context → 「后端笔记本最新一条」两条红。
   → `VERIFY_API=http://127.0.0.1:8147`，46 PASS · 0 FAIL。
2. `verify-form-builder.mjs`（T11 的门）用 `phone.goto(link)` 打开**服务端拼好的**员工链接，
   而 `public_base()` 只认 `AVERY_PUBLIC_BASE`，缺省是**生产域名**。不设就会把浏览器导到生产站
   （只是一次 GET 一个不存在的 token，没写任何数据），页面答「链接不存在」→ 一条红。
   → 后端起的时候加 `AVERY_PUBLIC_BASE=http://127.0.0.1:8147`，全绿。

---

## 五、明写的已知边界（不是遗漏，是决定）

- **粒度闸只看得见这一批文档**。`granularity.apply_gate` 会 `res.projects = keep`，把整份
  `ctx.extraction` 连同单份新文档喂给它，等于拿一个缺了源文档的 docs 集合去重判每一张老卡——
  那是整表静默删除，比漏判坏得多。所以补传路只对新批次跑闸：「新文档里的一条里程碑其实属于一个
  **存量**项目」这种跨批次误判它挡不住。**宁可漏，写在代码里**（`file_append.py` 有碑）。
- **`ExtractionResult.granularity` 不跨 pg 往返**（`put()` 不写、`get()` 不建），所以补传产出的
  Ruling 在真库上会消失。本票不依赖它——冲突走 `conflicts`，那个是往返的。
- **`role` / `tenure` 之类不在冲突口径里的字段，两条路今天都不记冲突**（`_CONFLICT_FIELD_ALLOWLIST`
  人侧只有 `team`）。补传路让它们**安静更新**，这是拍板③要的；但「两份资料对职位说法不同」
  今天仍然不会有任何记录。这是既有边界，本票没有扩大也没有收窄。
- **markdown 表格外侧带竖线（`| 姓名 | … |`）时 roster 解析器抽不出人**（内侧竖线可以）。
  写语料时实测到的，与本票无关，记在这里免得下一个人重新踩。

---

## 六、像素基线：合 main 之后在主检出重冻，已人眼过

漂移**恰好 4 张**（`aurora/paper` × `files` × `desktop/mobile`），逐张对照板看过，
内容只有 T10 改口的那三句文案：小节标题「上传新一批」→「另建一份画像」，那条 note 的标题
「再传文件会另起一家公司」→「这个口子会另起一家公司」，以及正文改成指向上面那个新入口。
**版式一字未动**——桌面两行、手机三行，都没有折行溢出或裁切。重冻后重跑 40 张零红。

如预期：`visual.spec.mjs` 跑在 `?transport=stub` 且从不上传 → `contextId` 恒 null →
**补资料那一段在基线里整段不渲染**（它三条否决的第一条就是没有 contextId），
与常驻表单区不进基线是同一个原因。

### 🔴 差点把这条漂移误判成「上一票改坏了首页」

第一次跑，红的是 `home` 不是 `files`——而且**一个 test 里串跑 10 屏，第一处不匹配即中止**，
所以 `files` 那两张压根没被采样。看上去像 T9 把首页改坏了。

真因是**像素门不密闭**：spec 走 `?transport=stub`，但 stub **切不掉「探测后端能力」那一路**。
`demoStore` 仍会打 `GET /demo/status`，打不通时首页那张「用一份示例团队先看看」整卡消失——
于是首页就地漂移。我第一次是用**不带 `VITE_AVERY_API_BASE`** 的 dist 跑的，它指向默认口，
那个口上跑着**另一个 session 的**后端，CORS 又不放行我的 preview origin。

定性方法（值得抄）：**把 `src/` 回退到上一票的 SHA 再跑一遍**——还红就是环境不是你的改动。
实测回退后红得更厉害（30277 px vs 20883 px），当场排除「是我改的」。
正确跑法：`VITE_AVERY_API_BASE=<你的口>` 重打 dist + 那个口上真起一个带 `AVERY_DEMO_SEED_DIR`
的后端 + `AVERY_CORS_ORIGINS` 放行 preview 的 origin。三件套齐了，红的就只剩真正该红的 4 张。
