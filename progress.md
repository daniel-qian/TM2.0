# Session Progress Log

> 📢 本文件是**当前状态快照，整体重写不追加**。历史都在 git（`git log` + 各 `.issues/*/receipt*.md`），别在这儿堆编年史。
> 启动路径见 `AGENTS.md` Startup Workflow：读本文件 + `feature_list.json`，跑 `./init.sh` 确认绿，再开工。

**Last Updated:** 2026-08-10（**0810 设计轮六票全清 + 统一上产**。前端 `35ade3d`、
后端 `avery-agent:main-20260810-212220`，**前后端同窗口换完并复验**。
🟢 **本地 main 与 origin/main 已同步，不再有积压**）

## Current State

- **git**：`main` = 差距战役八票 + gap2 三票 + 三轮演习批 + #68 + #70 + #69+#71 + #72 +
  **0808 重构战役四波全部**（#73/#74/#75/#76/#77/#78/#79）+ wave 4（#80+#81）+ #82
  + **#86 + #83 + #87 + #84 + #85 + #88（0810 设计轮票 4 / 1 / 5 / 2 / 3 / 6 —— 六票全清）**。
  回执十二份：`redesign-0808/` 六份 + `design-0810/` 六份（86 / 83 / 87 / 84 / 85 / **88**，全是本日）。
  ⚠ 别在这儿写死 ahead 数字——它每提交一次就自己作废。要数就跑：
  `git rev-list --count origin/main..HEAD`。
- **后端离线套基线：`TZ=UTC` → 4135 passed · 0 failed · 139 deselected · 4 xfailed**（约 118s）。
  = 上一基线 4132 + #88 的 3 条（`test_registry_contract` 两条 ephemeral 契约 + `test_context_empty_t86`
  一条端点；另 2 条 pg 参数化进 deselected）。
  ✅ **任何红都是你的。**
- **真库套（@needs_db）**：throwaway `avery_t88_test`（docker `teammaster-postgres-1` / pgvector pg17）
  跑 `test_registry_contract + test_context_empty_t86 + test_registry_protocol + test_file_append_t10
  + test_file_delete_t77` → **205 passed · 0 failed**。（历轮跑的集合各不相同：#85 是 62、#87 是 73
  ——**这几个数不是同一个集合，别对减**。）
  🔴 **本轮实收一条间歇红**：`test_sweep_collects_only_old_unlinked_ephemeral_clones[postgres]`
  整轮红过一次、单跑绿、随后两轮同命令全绿。当场探容器时钟：连采 6 次，前 5 次 `+0.4s`，
  **第 6 次 `-114.2s`** —— 就是那条「Docker PG 时钟来回跳 ~115 秒」，招牌症状正是「单跑绿、整轮红」，
  触发面是 `created_at < now()`。**不是本票造成的，也别当它不存在。**
  ⚠ 本机 docker PG 的口令是 **`dev`** 不是 `postgres`（`docker inspect teammaster-postgres-1` 可查）。
  跑完记得 `DROP DATABASE`（本 session 的一次性库已删）。
- **像素基线现状**：**54 张，本日重冻过 10 张**——4 张按 #83 + 4 张按 #84 + **2 张按 #88**
  （`{aurora,paper}-files-desktop`：空态左栏少了「更多 / 新建一家公司」那一组），另 44 张哈希逐字未变。
  **#85 净漂移 0 张**（那一区只在补传之后才存在，两套 spec 都走首次上传）。
  ⚠ **零漂移是预期，不是证据**——证据是在主检出跑完之后对 54 张取 md5 **逐行 diff**
  （#88 那一轮：恰好 2 行不同，总数 54 → 54，无附带漂移）。
  🔴 **像素盖不到「有档案」的资料库屏**：`visual-data.spec` 的 `SCREENS` 是
  `home/team/projects/room`，**不含 files**；`visual.spec` 的 files 四张拍的是空态。
  所以 #88「有档案时栏底少了一行」这一改**没有像素覆盖**，行为覆盖在 `verify-files-explorer` A③'。
  🔴 **别在 worktree 里跑像素**：那是 gitignore 的**每树一份**产物。#85 实收一次新形态：
  worktree 里**第一次红、第二次绿**，且 54 张 mtime 全变成那一刻——等于对着一份自己刚写出来的
  东西比对。像素一律 `cd /d/avery` 跑，`VERIFY_BASE` 指 worktree 的 preview，**跑前跑后各取一次
  md5 做全表 diff**（⚠ 别用 `md5sum … | sed 's|.*/||'`，它贪婪吃掉哈希、把对照退化成空判）。
- **✅ 生产 = 本地 main**（2026-08-10 统一上产）：前端 `35ade3d`、后端镜像
  `avery-agent:main-20260810-212220`。回滚退一级 = `avery-prev-20260810-212220`
  （= `main-20260807-190332`）。迁移 **0009 就地升级 + 0015 + 0016** 已在生产库落地
  （预检容器一次无害 404 触发懒加载）。上产回执 `.issues/design-0810/receipt-deploy-0810.md`。
- ✅ **迁移账已结清**（0015 / 0016 / 0009 就地升级都已上产）。
  🔴 **给下一个动 `PersonEntity` 顶层字段的人**：`0009` 的守卫里有 `want` 与 `ADD` **两处清单**，
  只改一处＝离线全绿、真库逐条拒收。而且**全新库跑绿证不了升级路径**——要另建一个库、
  先用生产那个 commit 的迁移文件建成生产现状，再让新代码去接（本轮真跑过，见上产回执 §2）。
- 🔴 **新依赖**：`@phosphor-icons/react@2.1.10`（wave 4 引入，票面拍板项，别被下一个人当漂移回滚）。
  ⚠ worktree 的 node_modules 是主检出的 junction：装依赖要在 `D:\avery` 装。
- 🔴 **合的都是本地 main，没有 push**。前端 push main 即自动构建上产，push + 换后端容器
  必须在统一上产 session 的**同一个窗口**里做。

## 本轮做完的 · 之六（2026-08-10 · #88 撤掉「新建一家公司」——单档案模型收口）

回执 `.issues/design-0810/receipt-88-single-archive.md`（含 **Danny 现拍的两条**、完整门账
对表、10 条变异台账含**一条存活及其原因**、三次「差点被读成结论」的红）。**0810 设计轮到此全清。**

`uploadFiles` 降级为**引导路径**：`contextId === null` 才真开火，其余委托 `appendFiles`。
🔴 **闸在 store 不在四个调用点上**——`OnboardGate.StepUpload` 与首页骨架卡是全新用户铸出
档案的那条路（票面明令不能碰），而「此刻有没有档案」这个事实只有 store 手上有；放 UI 上
就是四把尺，任何一把漂一次的代价都是又新铸一个 context（旧那份的 owner_token 服务端只返
一次、已被覆盖 = 永久无人能认领）。够得着的现场：向导里传成功一次之后翻回①再传一次。

两块 UI 整条撤除：`files-new`（「新建一家公司」）+ `files-switch`（「切换」）+
`KnownContextList.tsx` + store 的 `knownContexts/switchContext/forgetContext/switchError/
switchPending` + localStorage `lite2:knownContexts:v1` + 13 条 i18n 键（手工 Edit，孤儿 0 → 0）。

### Danny 本轮现拍的两条

1. **名册整条砍到底**。票面把它列为「待拍的余数」（倾向保留为只读历史入口）。第一次问
   Danny 说「没太听懂，现在没有存量用户，重新衡量以后提问」。重新衡量后它**不是产品取舍
   是算术题**：切换列表要 ≥2 份才出现，而撤掉「新建」后一台电脑最多长出 1 份 → 死代码。
   🔴 **方法论留给下一个人**：摆选项之前先算一遍**每个选项的前提还成不成立**——
   「存量用户回不去」听着像真代价，可它的前提恰恰被同一票消灭了。
2. **清空 ＝ 这份档案从此归你**（票面完全没有，是本票**自己造出来**的死胡同）：领过示例
   团队的人上传口是封着的，出路本来是「新建一家公司」，砍掉之后清空若不摘 `ephemeral`，
   他做完唯一被指引的动作**什么也没解开**。`empty_context` 两条腿清 `ephemeral`，
   与 `link_account_context` 是同一条判断的两个触发点。

### 三条值得下一个人知道的

1. 🔴 **票面门账只列了 3 道，实际动了 8 道**。两道漏网的找法不同：`verify-404-discriminator`
   靠逐门 grep 被删符号扫到（**硬红**）；`verify-data-boundary` 也是 grep 扫到，但 41 处引用、
   约 20 条判据的规模只有真读进去才看得出来。**动第一行代码之前，先对
   `git ls-files "*verify-*.mjs"` 全量 grep 被删的每一个符号，把门账算完。**
2. 🔴 **票面点名的「假绿陷阱」有第二个现场**。除了 `verify-context-switch` ⑥，
   `verify-archive-empty` ③⑥ 写的是 `(s.knownContexts ?? []).length`——名册撤除后前后都是
   `0 === 0`，**一道全绿的门冒充「恒 1 份档案还被守着」**。改判一律读**原值**
   （`=== undefined ? 'absent'`）+ localStorage 原文；`?? []` 不许出现在判据里，
   它把「这一格没了」和「这一格是空的」抹成同一个数。
3. 🔴 **`i18n-orphans` 有一块暗区：注释里点过名的键永远不是孤儿**（`bareAccessRe` 扫的是
   文件原文，注释一并算数）。实收：票面预判 13 个孤儿，第一次跑只报 12——少的那个是
   `upload.againTitle`，因为 `FileManifest.tsx` 的注释把它当反面教材点了名。
   **「0 孤儿」比它看起来的要弱。** 已把那处注释改成不写具体键名。

## 本轮做完的 · 之五（2026-08-10 · #85「这次补料改了什么」只读流水 + 已查阅）

回执 `.issues/design-0810/receipt-85-change-log.md`（含取数方案的实质分歧、六个设计决定、
**15 条变异台账 + 两条碑**、以及一个 41 条判据全都看不见的 bug）。Danny 拍板 B 的**前半**，
撤回仍是独立的票 7（前置 #87 已就位）。

**做了什么**：资料库左栏「文件」正下方多一个「资料更新」分区。一行一条改动：
`婚宴对接 · 负责人　老周 → 小马　依据《旺季排班协调纪要.md》第 1 行　[已查阅]`。
按**文件**分组（组头 = 文件名 + 上传时刻），引文可点（跳到「文件」区并筛到那一份）。

- 🔴 **与票面唯一的实质分歧：取数走 #87 血缘，不走 `payload["conflicts"]`。** 票面自己写着
  「要全部 10 个字段都给前后值就得等 #87」——而 #87 当天已经进了本地 main。两条方案的后端
  成本几乎一样（都是一个 additive 投影），输出差一个量级：**前后值从 3 个字段变成 14 个**，
  且引文带得了行号（conflicts 到前端时已被 `_conflict_evidence` 拍平成不带行号的 `string[]`）。
  顺带把 enrichment（空→有值）也变成一类可显示的改动，而它根本进不了 conflicts。
- **后端只做两件事**：① `lineage["added_in"]`——新建的卡记下**出生批次**（它一格都没被顶掉，
  `provenance` 恒空，不记的话「这批新增了两位同事」在卡上结构性地留不下痕迹）；
  ② `_one_person_card`/`_one_project_card` 各加一条 additive `lineage` 投影（**整本原样透传**，
  不在投影层挑「变过的那几格」——那条口径同时长在两处，而屏幕用的是前端那一份）。
- **入场判据是两本账**：`origin==='doc'`（首次上传结构上没有 provenance → 天然不进流水；
  手编过的格子 → 掉出流水，屏上那个值不是文档写的）+ `lineage.fields[f]`（有 prev = 改写，
  无 prev = 补上）。**只看 lineage 不看 origin，首次上传的每一格会当场涌进来**（变异 M-G，6 条红）。
- **「已查阅」零新状态机**：直接用 `flowStore` 那本三态标记库（今天页冲突卡在用 `conflict_`
  前缀），这里 `change_` 前缀分桶，`restoreGap` 就是取消标记。flowStore 一个字节没改。
- 🔴 **行 id 里带着出处文件**：同一格被**另一份**资料再改一次 = 一条新的改动，回到未查阅。
  不带的话，那条真改动**生下来就是已读**——被一次早就发生过的「我看过了」永久吞掉。
  门 ⑪ 用**第三批资料**真跑了这条。
- **与拍板③ 的共存写成了判据**：⑨ 今天页零行零 section + ⑨ 铃铛里没有一条通知在讲「资料更新」。
  判据刻意不是「未读为 0」——补传本身会发 `ingest` 通知，那是既有行为、不归本票。
  `file_append.py:23-32` 那段照拍板③ 刻的注释一个字没动。

**新门 `eval-harness/tools/verify-change-log.mjs`（41 判据，已进 A 区 ROSTER）**：一次真
`uploadFiles` + 两次真 `appendFiles`。**门改判 1 条**：#87 的
`test_the_wire_contract_for_provenance_is_untouched` 里 `assert "lineage" not in card` 翻面
（#87 是地基、投影归消费者，#85 就是那个消费者）；**前半句 provenance 闭契约一个字没动**，
M17 照旧一动就红。验证账：离线 **4132/0** · 真库 **62/0** · 电池 **A 38/38 · B 3/3 · C 3/3** ·
像素 8 passed 且 54 张 md5 未变 · **变异 15/15 全红**。

### 值得下一个人知道的三条

1. 🔴 **人眼过图逮到一个 41 条判据全都看不见的 bug**：引文长成
   `d据《旺季排班协调纪要.md》第 1 彳`——两端各被切掉一个字、一个省略号都没有。
   病根是 `.lite-btn` 基类的 `inline-flex + justify-content:center`：**居中的 flex 文本溢出时
   朝两头同时溢**，而 `text-overflow:ellipsis` 对 flex 里的匿名文本压根不生效。
   **为什么 41 条全绿**：它们读的都是 `textContent`，而它完整得很、**对裁剪一无所知**
   （AGENTS.md「门扫 innerText 看不见属性」的同族，这次是看不见**裁剪**）。
   同拍补了两条**拿 `Range` 量文字矩形**的判据 + 变异 M-O 当回归锁。
2. 🔴 **一条存活的变异，查下去是死枝不是门洞**：M-B 打的是 `note_added_in` 里那句
   「已经有出生批次就不改写」→ ALL GREEN。两处调用点传的都是 `incoming`（刚抽出来的读数，
   从不带 `added_in`），那句守卫在现行链路上**永远为假**。处置：守卫留着，但在它的 docstring 里
   **明写「这一句今天够不着」**，并把 M-B 改打一条有牙的。
   **一条测不到的分支必须自己说自己测不到**，否则下一个人会把台账上那格绿读成「验过了」。
3. 🔴 **把页面打崩的变异比「跑着却说错话」的弱**：M-I 第一版让 `prev!.value` 对 undefined
   解引用，整屏崩掉——门确实红了，但**随便哪条判据都能红一次崩掉的页面**，它证明不了
   「⑤ 那条判据有牙」。改成只动分类（什么都算「改写」），UI 照常跑、只是说错话，1 FAIL 精确落位。

## 本轮做完的 · 之四（2026-08-10 · #84 资料库两栏 file explorer）

回执 `.issues/design-0810/receipt-84-files-explorer.md`（含三条主动裁定、真机拍图逮到的
4 个 bug、门改判逐条对表、**21 条变异台账**）。**纯前端**：后端零字节、零迁移。

规格照抄 `design-plan.md` §2.4 + §2.5，左栏视觉语言与 #83 **同一套**（§2.2 一处定义两处消费）。
对着 §1.2 四条病根逐条销账：内容列不再吊在视口正中（左栏贴左 + 工作台占满，**表格另有
1120px 阅读上限**）· ~2700px 长条换成左栏分区（非当前分区**整段不进 DOM**）· 「新建一家公司」
从全页最重的白卡片降成栏底一行 · 文件行从 flex-wrap 的汤换成 `grid` 钉死的真列
（手机**逐格写死** `grid-column/grid-row`，390px 上 9 行从 4 种高度 3 种内部顺序收成**各一种**）。
另：上传口进工具条（主钮 + 整块工作台接拖放，两个反向 dropzone 收成一个）· 进度长在表格顶端
那一行 · 数字列 `tabular-nums` 右对齐 · `排序` 换自绘控件 · 双标题收成一层 · 表单区内部重排。

**#86 的两笔欠账一并结清**：左栏底部「清空这份档案…」+ 硬确认已接上；「有档案、零文件」的
空态文案改口（原来把一次成功的销毁诊断成解析失败）。
⚠ 硬确认输的**不是「店名」**——这个应用里根本没有店名字段（`KnownContext` 只有 id/files/at），
改成手打词典里的确认词（zh `清空` / en `EMPTY`）。

**新门 `eval-harness/tools/verify-files-explorer.mjs`（37 判据，已进 A 区 ROSTER）**：补手机态
零覆盖 + 满数据态列几何。另改判 7 道：`files-ia` 17→19 · `forms-proactive` 19→20 ·
`archive-empty` 25→36（补「真点那枚键」段）· `append-story` / `form-builder` /
`context-switch` / snippet 的 `assertFilesSurfaceV2` + `injectSeeds`。
**变异 21 条全红**（第一轮 3 条活下来，三条病因各不相同——见 Blockers）。

### 值得下一个人知道的三条

1. 🔴 **票面预判「必红」的那道门实测零改判**：`verify-file-manifest-truth` 从头到尾没取样过
   `.upload-file-meta`（它只读 `-row/-name/-status/-status-hint`）。**票面预判是假设，不是事实**
   ——真按「反正要改判」动手，就会把一道本来有牙的门改松。
2. 🔴 **两道会红的门不在票面门账上**：`context-switch`（切换列表搬进了 switch 区）与
   `form-builder`（拼装器搬进了 forms 区）。前者靠逐门 grep 扫到，**后者是整轮电池才逮到的**
   ——手挑清单永远漏在「想不到的那一道」上。
3. 🔴 **`.upload-source-chip` 被 snippet 当上传成功的判据**。我把工作台上那排与表格逐行重复的
   chips 收掉，`verify-flow-gap-phases` 当场红成 `injectSeeds·首次注入 — error=null`
   ——**读起来像上传失败，其实上传好得很**。snippet 现在抽了 `_landedFiles()`：chips 在就用
   chips，不在就读清单行本身（后者其实是更强的证据）。

## 本轮做完的 · 之三（2026-08-10 · #87 实体血缘地基）

回执 `.issues/design-0810/receipt-87-entity-lineage.md`（含形状表、三个设计决定、迁移升级
七步实测、18 条变异台账、以及给票 7 / 未开票那张 / #85 的成本账）。**纯后端，前端零字节。**

**做了什么**：`PersonEntity` / `ProjectEntity` 各加一个顶层 `lineage` side-car ——

```
lineage = { "docs": [提到过这张卡的文档…],
            "fields": {格子: {source, batch_id?, seeded?, prev?{value, source, prev?, truncated?}}} }
```

`docs` 答「删光之后这张卡还有没有文档依据」（**输给 keep-first 的、被手编赢挡下的、逐字复述的
读数都算数**）；`fields` 答「删掉之后该变成什么 / 撤回之后写回什么」。播种在 `__post_init__`
（新卡精确，**存量卡回读时按 `source` 兜底并打 `seeded` 标**）；写路在 `_absorb_*` /
`AppendLedger.absorb` / `form_reflow`；`prev` 在每一次 `setattr` **之前**拍照。

- 🔴 **订正票面「嵌进 `provenance` 里免迁移」那条建议**（三条实测理由，全文在回执 §4①）：
  ① `_one_person_card` 把 `dict(provenance)` **原样**投给浏览器，`LiveFieldProvenance` 是
  `{origin,source,updated_at}` 的**闭**契约；② **首次上传的格子根本没有 provenance**，而本票要修的
  正是那种卡——它结构上装不下；③ `origin:'doc'` 在屏上的意思是「**被后来的上传顶掉过**」
  （`provenanceBadgeKind` + `DetailOverlay.tsx:314`），也是 **#85 便宜的全部理由**，
  首次上传就写会把那枚角标变成集体谎话。→ 另开顶层键，代价是 0009 就地加一个字。
- 🔴 **两个 side-car 必须连读**：`provenance[f].origin` 答「这一格现在归谁」（手编赢），
  `lineage.fields[f]` 答「这一格的**文档**血缘」。**手编改一格不动 lineage**——票 7 正好两个都要：
  origin 判该不该给撤回钮，lineage 判撤回之后写回什么。
- **`delete_document_from_context` 行为一个字节没改**（票面明写「本票只做地基」）。
  `file_delete.py` 头补了一段：#77 那条裁定的**前提已经变了**，还差的是三条**产品**问题不是血缘问题。

### 验证账

离线 **4114/0** · 真库 **73/0** · `./init.sh` 绿 · 行尾自查 6 个文件全部 `bare LF == 0` ·
**前端门电池未跑**（改动全在 `eval-harness/`，零渲染改动，理由记在回执 §6）。
**变异 18 条逐条独立跑、跑完还原原始字节 → 18/18 全红。**

🔴 **第一轮有 2 条活了下来，两条都是门洞**（碑值最高的一段，全文在回执 §7）：
- **M14 —— 尺子长在被量的东西上**：「逐格播种」判据写成 `== set(_lineage_fields(kind))`，
  而变异改的就是 `_lineage_fields`——**它一缩水期望值跟着缩水**，「血缘只跟一半字段」全绿活下来。
  → 期望值改成取自**两张源表**（`_APPEND_REFRESHABLE | _APPEND_UNIONED`）。
  **判据的期望值不许由被测函数算出来。**
- **M16b —— 变异打错了地方，反而炸出一个既有门洞**：锚点只命中 0009 的 `want` 字面量、没碰真执行的
  `ADD`，而既有门只扫 ADD。顺着查下去发现 **0009 的 `want`/ADD 此前无人比对**
  （0010 早有孪生门且 docstring 逐字点名「不看 want」，0009 一直没有，而 #87 是它被就地改动的第一次）。
  两种漂法各有各的坏：**`want` 落后 → ALTER 整段被跳过、库里 CHECK 停在旧集合、带新键的行被真库拒收而离线全绿**；
  **ADD 落后 → 每次引导都全表重验**（0724 那次部署拖过 `statement_timeout` 的成本）。
  → 新增 `test_migration_0009_guard_literal_matches_its_own_ADD`，拆 M16/M16b 各钉一处。

## 本轮做完的 · 之二（2026-08-10 · #83 会话侧栏上皮肤 + 开场块居中）

回执 `.issues/design-0810/receipt-83-room-rail.md`。**纯前端**：后端零字节、零迁移。
规格照抄 `design-plan.md` §2.2 + §2.3，对着 §1.1 的四条病根逐条销账：栏改**下陷贴边**
（`rgba(--lite2-ink-rgb,.035)` + `top:0;bottom:0`）· 一场从两行 ≈85px 收成**单行 34px**
（1440×900 同屏 12 场）· meta 行去噪（轮数只在 >1 时占墨，时刻退到 hover 与轮数 pill 换位）·
开场块在「顶栏以下、composer 以上」垂直居中。**≤860** 栏退化为贴左**不透明**抽屉 + 遮罩。

**新门 `eval-harness/tools/verify-room-rail.mjs`（41 判据，已进 A 区 ROSTER）** 补两块空白：
① 手机抽屉态在所有既有门里零覆盖；② 桌面栏视觉规格此前只有像素基线看着，而 room-data
那 4 张拍的是**零历史**态。像素净漂移**恰好 4 张**。**变异 12 条全红**，第一轮 2 条门洞已封
（尺子太宽 / 伪元素计算值不证明它上了屏——见 Blockers）。

## 本轮做完的 · 之一（2026-08-10 · #86 archive-empty）

回执 `.issues/design-0810/receipt-86-archive-empty.md`。`empty_context()` 落进
`ContextRegistryProtocol` + 两条腿 · 新路由 `POST /team/{context_id}/empty` · transport
`emptyContext` · store `emptyArchive()`（**两抄本锁步**）· 新门 `verify-archive-empty`（zone A，25 判据）。
清掉 `source_documents` / `source_files` / `materials` / `entities` 全五类 / `granularity` /
facts+notes 重物化成空；**留下** `context_id` · `owner_token` · `name` · 对话历史 · 观察笔记 ·
表单模板 · **员工已交答卷（含活的 H5 链接）** · 账号归属。
🔴 **明知的雷已钉成正面判据**：留着答卷 ⇒ `POST /team/{id}/forms/{sub}/ingest` 会把实体重新灌回来，
**「清空」不会自己保持为空**。确认文案不许说「清空之后永远是空的」。

## 上几轮做完的（详情全在各自回执，这里只留会影响下一个人的）

- **#82 表单测试拆墙钟炸弹**——`redesign-0808/receipt-82-clock-bomb.md`。病根是
  `GET /team/{ctx}/forms/submissions` **读时会写**（T9 自动铸链）+ newest-first。选行一律**按 id**。
- **wave 4 · #80 会话侧栏 + #81 composer**——`receipt-80-81-sidebar-composer.md`。
- **wave 3 · #79 copy-sweep**——`receipt-79-copy-sweep.md`。像素 50 张全漂全量重冻。
- **wave 2 · #78 真线程**——`receipt-78-threads.md`。迁移 0016 · `GET /team/{id}/advise-threads`。
- **wave 1 · #75 议事室 Claude 化 + #73 现场附件** · **#74 + #77 + #76**（`receipt-76-77-74-files.md`）。
- **#72 / #69+#71 / #70 / #68 / #66+#67 / #65 / #64 / #63 / #61 / T9–T11**。

## What's Next（按优先级）

0. **✅ 0810 设计轮六票全部完成，并已统一上产**（#83 + #86 + #87 + #84 + #85 + #88）。正源
   `.issues/design-0810/design-plan.md`（Danny 2026-08-10「其他的设计方案全部通过」），
   原型 `proto/{room,files}.html`，证据 `_shots-0810/`。
   🟢 **生产 = 本地 main = origin/main**：前端 `35ade3d`、后端 `avery-agent:main-20260810-212220`，
   前后端同窗口换完并复验；HITL 端到端演习对着生产 13/13 绿。
   **上产回执 `.issues/design-0810/receipt-deploy-0810.md`**（含升级路径怎么真跑的、
   回滚梯、以及下面那条 bug 的全貌）。**下一步是合伙人试用反馈。**
   🔴 **上产后复验逮到一条真 bug（已修并二次上产 `35ade3d`），它的形状值得记住**：
   #88 撤掉「新建一家公司」之后，`filesAppendDemoNote` 这句**活文案**还在指挥用户去点它——
   #88 修了机制那半（清空即认领）、漏了文案这半，那条它自己发现的死胡同换个形态活了下来。
   **`i18n-orphans` 对这类问题是瞎的**：键没变成孤儿，它只是开始撒谎。
   **撤除类改动收尾必须专门扫一遍「指向被撤掉那个东西的文案」**，孤儿检查代替不了。
   - ~~**#83**~~ ✅ 已落地。**它把导航栏的视觉语言定死了**：底色 `rgba(ink,.035)` · 贴边通到底 ·
     行 34px/`padding 0 10px`/radius 8 · hover `rgba(ink,.05)` · 选中 `rgba(accent,.13)` +
     2px accent 左封条 + 600 · 组标 11px/700/`--ink-soft`。**#84 的左栏（208px）照抄这一套。**
   - ~~**#84**~~ ✅ 已落地（含 #86 那两笔欠账）。它把「新建一家公司」降成左栏底部一行，#88 已把它删掉。
   - ~~**#85**~~ ✅ 已落地（走 #87 血缘，不走 conflicts；**只读**，撤回仍是票 7）。
     它在左栏加的「资料更新」那一行与 #88 在合并时撞过一次，已解（保留 `changes`，去掉 `new`/`switch`）。
   - ~~**#86**~~ ✅ 已落地（UI 挂点已由 #84 补上）
   - ~~**#87**~~ ✅ 已落地（**只做地基**；两条下游见第 3 条）
   - ~~**#88**~~ ✅ 已落地。**Danny 同拍又拍了两条**（名册整条砍到底 / 清空即认领），见「之六」。
1. 🔴 **单档案模型现在是产品的硬前提，别再往回长**。可执行的形态是：
   `uploadFiles` 只在 `contextId === null` 时开火 · 一台电脑的钥匙串（`lite2:ownerTokens:v1`）
   恒 1 把 · 左栏没有「新建」「切换」两行 · 纠错出口只有「清空这份档案」（`context_id` 不变）。
   守它的是 `verify-data-boundary` B1（判据落**凭据表**不落屏上文案）+ `verify-files-ia` ③b +
   `verify-append-story` ② + `verify-archive-empty` ③⑥。**四道门里任何一道红，先怀疑多档案复辟。**
2. ✅ **#85 已经把 #87 的现成件吃掉了**：`lineage` 现在**投给前端**了（两张卡各一个 additive
   `lineage` 键，整本原样透传），那条「卡上没有 lineage 键」的判据已按纪律同 commit 改判。
   **票 7（逐条撤回）不用再修投影这条路**——它要写回去的 `prev` 链已经在浏览器里了，
   剩下的是 §9.1 那四笔成本 + 下面第 3 条那个产品拍板。
3. 🔴 **#87 的两条下游，一条有票一条没票**：
   - **票 7「逐条撤回」**（design-plan §8 已列，待开票）：四笔成本已逐条量过，写在回执 §9.1。
   - 🔴 **「删文件收回结论」今天一张票都没有**——排期表说 #87「同时解锁」两条，却只给撤回列了票。
     地基已就位（`docs` 空 → 整张走；`docs` 还剩别的 → 逐格看 `fields`，两种情况现在分得开）。
     **建议开票**，成本写在回执 §9.2。
   - 🔴 **两张票卡在同一个产品拍板上**：删掉冲突的一方之后**由谁胜出**（`file_delete.py` 明说这等于
     「替抽取器编一个它从没做过的判断」）。**一次拍板同时解锁两张票**，值得单独问 Danny。
4. **统一上产**（gap2 三票 + 三轮演习批 + #68 + 重构战役四波 + wave 4 + #82 + **0810 设计轮六票**）。
   🔴 push 与换后端容器同窗口；**0015 + 0016 必须落地，0009 必须是就地改过的那一版**；
   上产后先设 `AVERY_PUBLIC_BASE` 再验表单。
5. ⚠ **给下一个人的口径**：recon-sidebar / recon-composer 是好正源，但它们**各有一处已证的错**——
   任何侦察里的「这个值是 X」都要自己在浏览器里量到为止。
6. **W33「链接过期了」核实完毕：不是产品 bug**。真要修的是夹具卫生
   （`verify-forms-proactive.mjs:60` 硬写 `'2026-W01'`），属独立小票；另有一个真空洞：
   **没有任何测试断言自动铸链的 `expires_at` 数值**，在 `test_form_autofill_t9.py:569` 旁补一句
   `expires_at - created_at == 7 days` 很便宜。
7. **T8 两条记录**：① 议事室引用编号形状；② 今天页证据行机器形状（ADR-0033）。
8. **给 `/health` 加版本字段**。
9. carry-over：会话**改名 / 删除**（#80 v1 明确不做）· 侧栏 20 场硬上限 ·
   **抽屉开关钮仍是文字钮** · **极短视口（高 ≤ ~667）下开场块会被顶栏压住一点**（非 #83 造成）·
   **全应用 icon 统一**（#81 只做了对话页；动它＝54 张全重冻）· 判读卡 4 段死渲染 +
   后端已发前端未消费 7 类字段 · gate-run 迁移 · files-hub #26–#29 · 换血抢救 #31/#32 ·
   v01 退役 #33 · 真机零覆盖（iOS/微信，最高优）· 成本票 #30 · 真 brain 分流取证 · 全量 feat-063。

## Notes（顺手发现，没顺手修）

- 🔴 **#88 顺手发现：`i18n-orphans` 有一块暗区**。它那条 `bareAccessRe` 正则
  扫的是**文件原文，注释一并算数**——在注释里点名一个键就等于**永久**把它从孤儿名单上摘掉。
  实收：#88 票面预判 13 个孤儿，第一次跑只报 12，少的那个被 `FileManifest.tsx` 的注释养活着。
  **「0 孤儿」比它看起来的要弱。** 想修的话是给扫描器加一步剥注释，是独立小票。
- ⚠ **#88 顺手发现：`useUploadTarget` 的默认推导没有独立可达行为**。资料库屏显式传 mode，
  而唯一消费默认分支的 `HomeScreen` 骨架卡只在 `!team` 时渲染（那时 contextId 几乎恒 null）。
  M4 变异因此存活——**不是门漏，是那条推导本身是 store 闸的 belt-and-braces**。
  没给它编门（编出来只会测一个造出来的场景）。哪天首页骨架卡的渲染条件放宽，回来补一条。
- ⚠ **#88 顺手发现：手拍脚本会静悄悄拍不到东西**。`_px88/shot.mjs` 第一轮四张手机 `data-*`
  **全没拍到左栏**（收抽屉点遮罩，那一下被关闭动画吃掉，随后 `openRail()` 又把它合回去），
  而截图看起来一切正常——差一点就当「人眼过了」。现在脚本自己会在拍不到栏时抛错。
  **手拍脚本也要有自证，跟门一样。**
- ⚠ **#85 流水里「简介」那一行读起来像噪音**（截图上是「负责人：老周 → 负责人：小马」）：
  病在**抽取器**给 `summary` 取值的方式（取第一条键行），不在流水——它如实反映了那一格真的变了。
  同一件事还有个门层面的后果：**`clampWidth` 的死针探测**。语料第一版把长句写成文末散文，
  指望它成为 `summary`，结果那条截断判据**一次都没跑到**，却以「截断没发生」的形态红。
  **改文案/语料之前先想一遍：哪条判据从此再也判不到任何东西。**
- ⚠ **#85 的「已查阅」标记跨公司不隔离**：`flowStore.gapMarks` 是整个 localStorage 一本账。
  换账号时 `data-boundary` 门证明它会被清掉，但**同一账号切两家公司**时不会。这是既有行为
  （今天页冲突卡同款），#85 没把它改坏也没顺手改好。
- ⚠ **`dependsOn` 永远不出现在补料流水里**：血缘跟着它，但 `_one_project_card` 从不投它——
  渲一行「依赖改成了 X」，用户在任何一块屏上都找不到那个 X。哪天它上了卡，那一行会自己冒出来。
- ✅ **~~删文件不收回结论：血缘不够~~ 地基已补上**（#87）。`delete_document_from_context` 的**行为**
  仍然一格未动（`test_file_delete_t77::test_delete_keeps_the_person_cards` 原样全绿），但**它需要的
  信息现在就在卡上**：哪一格是哪份文档给的、顶掉之前是什么值、这张卡还有没有别的文档撑着。
  剩下的是**产品**问题不是血缘问题（见 What's Next 第 3 条）。
- 🔴 **两个 side-car 必须连读**（#87）：`provenance[f].origin` = 「这一格现在归谁」；
  `lineage.fields[f]` = 「这一格的**文档**血缘」。**手编改一格不动 lineage**——单读 lineage 会把一个
  经理手填的值说成某份文档给的。
- 🔴 **别把血缘写进 `provenance`**（#87 订正票面建议，三条实测理由）：它被**原样**投给浏览器且契约是闭的 ·
  **首次上传的格子根本没有 provenance** · `origin:'doc'` 在屏上的意思是「被后来的上传顶掉过」
  （#85 便宜的全部理由），首次上传就写会把那枚角标变成集体谎话。
- ⚠ **`_absorb_person` 的并集 `[:6]` 会静默扔掉新条目**（T5 就在的，非 #87 造成）。血缘让它
  **第一次可见**：截断发生时 `prev.value` 恰好等于当前值。要不要报给用户是产品问题。
- ⚠ **`test_the_LOSING_reading_and_its_source_vanish_without_trace_B2A` 的措辞在 #87 之后变微妙**：
  输掉的**读数**与它的**出处行**（`本周周报.md:9`）确实仍不在卡上（那条门原样全绿），但输家那份
  **文档名**从此在 `lineage["docs"]` 里。这是有意的（`docs` 答的是「谁提到过这张卡」），不是漏判。
- 🔴 **`empty_context` 与 pg 独有的 `delete()` 是反面**：后者删 `avery.contexts` 那一行本身。
  `delete()` **永不挂 HTTP**。`test_registry_protocol.py` 那条「内存腿不许长出 `delete()`」原封未动
  （#87 **没加任何 Protocol 方法**，所以那条成员数断言这两票都没碰）。
- ✅ **两个便宜的现成件**（做「自动更新清单」时别重造）：`provenance[f].origin === 'doc'`
  **恰好**标出「被后来的上传顶掉过」的格子；「已查阅」交互层 `flowStore.ts` 三态标记库已建好。
- ⚠ **两条要订正的旧结论**：`gapDerive.ts` **不消费 conflicts**；冲突到前端时**已是字符串**。
  另：**不带项目的人身上的 `team` 冲突今天哪块屏都到不了**。
- ⚠ **`verify-context-switch` ⑥ 的两条源码级判据是假绿雷**：`forgetContext` 被删掉之后它们**静默变绿**
  不是红。#88 改判时要主动退役。
- ⚠ **`uploadFiles` 有四个调用点**，`OnboardGate`（新用户第一次上传）与 `HomeScreen` 首页骨架卡**不能碰**。
  两条状态机也不能天真合并——`notifyStore` 靠 `ingesting→ready` 跃迁合成「团队已就绪」。
- ⚠ **手机 390px 上文件行是 flex-wrap 的汤**：9 行 4 种高度 3 种内部顺序。#84 用固定 grid 骨架根治。
- ⚠ **`.lite-files-scroll` 是 `absolute inset:0`，Playwright `fullPage` 拍不到它的全长**——用 1440×3200。
- 🟠 **`test_decision_grading.py:1050` 是另一族墙钟赌注**（#82 扫出，未修）：`date.today()` 是本地时区、
  `clone_context` 打的是 UTC 戳。不带 `TZ=UTC` 跑（UTC+8 的凌晨）真红。
- 🟠 **`GET /team/{ctx}/forms/submissions` 读时会写这件事，测试面没有集中说明**。
- 🔴 **`.lite-btn.lite-btn--ghost` / `--primary` 那两组 (0,3,0) 规则是一类隐形地雷**：
  任何 (0,2,0) 的按钮**配色覆盖**都会被静默压死，而**一道门都不会红**。
- 🔴 **`.lite-room-history-panel` 那一族 CSS（lite2.css 8288-8312）已整段变死**，照先例留碑不删。
- ✅ **~~手机 ≤860 抽屉态零覆盖~~ 已销账**（#83，新门 `verify-room-rail.mjs` 跑 390×844）。
  ⚠ 那四道老门的视口**仍然**硬钉 ≥900——凡是只在窄屏出现的新部件，别指望它们。
- ⚠ **hover 才现身的元素逃出 `verify-contrast-smalltext` 的采样面**（它跳过 `display:none`）。
- 🔴 **「composer 圆角恒定」在像素层没有覆盖**（born-red 实证：16→4px 的变异 0 红）。
- **Phosphor 不传 `size` 不是 0×0**：`IconContext` 默认 `1em`。
- 🔴 **aria 硬门对短拉丁黑话是瞎的**：`HR`、`1:1`、`New` 永远不报。
- **`gapCardClaimLabel` 与「资料里的实际情况」在同一张差距卡上不对仗**；**`projectsTitle`** 与同屏 lede 词族不齐。
- **mock 语料下判读卡的信号行是英文**；**mock 语料不产 confidence / script / metrics / escalation 四段**。
- **短答路 followups 落库仍被丢**（`app.py` 的 `_persist_advise_run` 只取 `answer.text`）。
- **`fetchAdviseRuns` / `refreshAdviseRuns` 前端已无消费者**——⚠ #86 起**不再成立**。
- **`--lite2-bottom-band` 是幽灵 token**；**`--lite2-clear-top` 的 ≤860 覆盖写了两遍**。
- **`.issues/gap-design-0805/t8-e2e.mjs:514` 是 `room.status !== 'error'` 反向判断**。
- **`data-room-composer` 从未落地**（三处**注释**声称门已改判到它，DOM 上没有）。
- **`nexus-brief-hud` 与四相面板仍在说同一件事**。
- **switchContext 换公司时 `turns`/`run` 不清**——只有 `resetLiteCompanyData` 清。
  ⚠ 公司域清单现在是**三抄本**；**404 分支那份历来就不全**，别照它抄。
- **中文名互为前缀仍双中**（「王力」vs「王力宏」）：词边界对 CJK 刻意不阻断，宁多勿漏。
- **`tests/test_at_references.py:90` 潜伏 typo**（`rep.errors` 应为 `parse_errors`）。
- **`>` 开头的材料块结构性不可引用**；**facts.md 指针不是单射**。
- 🔴 **`AVERY_PUBLIC_BASE` 必须指后端自己的口**（#63 实收）。
- **粒度闸够不着跨批次**（T10）；**`_people_from_roster` 位置兜底会顶掉空格子**（#61）。
- **`KeywordStore` 分词器是 `[a-z0-9]+`（纯 ASCII），对无空格中文 `query()` 恒空**——
  ⚠ 写「删/清之后检索不到」这类判据必须押 ASCII token。
- bellIsReal / nudgeVerdict 等手册协议相位仍无机械 runner。

## Blockers / Risks

- ✅ **~~离线 pytest 3 红＝已知墙钟炸弹~~ 已销账**（#82）。新基线 **4114 passed · 0 failed**，
  **任何红都是你的**。
- 🔴 **量错了东西的三种形态**（#84 实收，三条第一轮全绿活下来的变异，病因各不相同）：
  - **ⓐ 尺子够不着 → 假绿**：「栏是下陷还是凸起」写成「往祖先链上合成到第一张不透明的面」，
    而**实测**（`_px84/lumprobe.mjs`）那条链从 `aside` 一路到 `BODY` **全是 `rgba(0,0,0,0)`**
    ——暖纸画布不是任何一个祖先的 `background-color`。合成兜底成纯白 255，于是「翻回白卡片」
    （253）在 255 面前照样算"更暗"。→ 对照物改取**画布令牌** `--lite2-paper-rgb`。
    ⚠ 同一条判据的**第一版**是拿 `document.body` 当对照物，那时它以**假红**的形态错（body 也透明，
    亮度恒 0，对着真下陷的栏永远红）。**先假红后假绿，都是量错了东西。**
  - **ⓑ 变异是空的 → 看起来像门洞，其实不是**：把 `color: var(--ink-faint)` 插在规则**开头**，
    而同一条规则后面本来就写着 `color: var(--ink-soft)`——同权重后写者胜，这条变异什么都没改。
    **变异活下来，先验变异本身有没有生效。**
  - **ⓒ 判据落在下游后果上 → 假绿**：「九行恰好一种高度 + 一种落位指纹」。行一旦可收缩，会被
    **整齐地**压到 `min-height`——九行仍然只有一种高度、指纹也不变，而第二行的字整条压到下一行的
    背景上。→ 补一条「每个格子真的装在行框里」（量格子相对行框的溢出量）。
- 🔴 **判据的期望值不许由被测函数算出来**（#87 实收，与「fixture 自考自答」同族）：
  「逐格播种」判据写成 `== set(_lineage_fields(kind))`，而变异改的就是 `_lineage_fields`——
  **尺子长在被量的东西上，它一缩水期望值跟着缩水**，变异全绿活下来。期望值要取自**上游源表**
  （这里是 `_APPEND_REFRESHABLE | _APPEND_UNIONED`），或在测试侧独立手写一遍。
- 🔴 **守卫式迁移有两处清单，既有门只看得见一处**（#87 实收）：`0009`/`0010` 都是
  「`want` 先比对、`ADD` 才真执行」。**`want` 落后 → 整个 IF 被跳过、那条 ADD 永不执行、
  库里 CHECK 停在旧集合 → 带新键的行被真库拒收而离线全绿**；**ADD 落后 → 每次引导都全表重验**
  （0724 部署拖过 `statement_timeout` 的成本）。两条迁移现在**各有一道**孪生门
  （0010 在 `test_conflicts_record_b2a.py`、0009 在 `test_entity_lineage_t87.py`）。
  ⚠ 写这类门时注意 `want` 里 `kind <> ''person''` 的那个 `'person'` 会混进键集 → 恒红。
- 🔴 **给 `PersonEntity` 加顶层字段 = 必须改 0009，而漏改只在真库上炸**（#87 实测，不是推断）：
  新代码 + 旧 0009 → **每一条人卡写入 `CheckViolation`**，离线套一条都不红。
  唯一的离线网是 `test_person_keys_allowlist_covers_exactly_person_fields`（对称差），它扫的是
  **ADD**、不是 `want`。
- 🔴 **离线套对 pg 持久层是瞎的，而且它会以「全绿」的形态骗你**（#86 实收）：内存腿 `get()` 返回
  **活对象**、pg 腿返回**快照**。**修法不是再写一条 `@needs_db`**（默认电池照样反选它），
  而是 monkeypatch 让内存腿 `get()` 返回深拷贝。动 pg 腿仍必跑 `@needs_db`。
- 🔴 **内存里是 dataclass、库里回来是 dict** 是这个仓库的常驻坑（`risk`/`milestones` 当年在
  **持久化那条路上**炸过）。往任何**没有强转**的 side-car 里存值，必须在**写入那一刻**就拍平成
  JSON 原生形状（#87 的 `_jsonable`），否则两条腿形状不同而离线全绿。
- 🔴 **伪元素的计算值不证明它上了屏**（#83 实收）：`getComputedStyle(el,'::before')` 对一个
  **根本没生成**的伪元素照样把规则里的 `width`/`background` 吐回来。判 `::before` 必须**先判 `content`**。
- 🔴 **尺子太宽 = 对着真违规也全绿**（#83）：「单行」写成「行高 ∈ [30,40]」，而两行式恰好收成 40px。
  **量结构性质，不量结果区间。**
- 🔴 **hover 态会污染取样**（#83）：量静息态之前先 `page.mouse.move()` 把指针挪出被测区域。
- 🔴 **变异活下来 ≠ 门有洞，也 ≠ 代码没 bug —— 先看变异有没有真的碰到被判的性质**（#87 又实收一次：
  一条锚点只命中 `want`、没碰真执行的 ADD，而既有门只扫 ADD——「存活」是变异没落地，
  但顺着查下去炸出了一个真门洞）。
  ⚠ **一条变异红一条判据 ≠ 它也能红旁边那条**：判据要对着被测性质的**每一个实例**都有牙，
  语料喂不饱的自己塞哨兵（#86 的 signals、#87 的 `risk`/`milestones`/`dependsOn`）。
  ⚠ **变异脚本自己也会撒谎**：锚点命中数必须 == 1（0 处命中长得像「变异存活」）；
  还原路径必须 `write_bytes(原始 bytes)`（#82：LF 归一化副本压平了全仓 CRLF）。
- 🟠 **别单独 push main**（实数跑 `git rev-list --count origin/main..HEAD`）：
  前端 push 即自动上产、后端容器要人手换，同窗口做。
- 🔴 **像素基线目录是 gitignored**（`.gitignore:34`），**每棵树各一份**：worktree 里那份是空的，
  在 worktree 跑 visual = **首写**。真比对：**在主检出 `D:\avery` 跑 playwright**，
  `VERIFY_BASE` 指向 worktree 的 preview。⚠ **改了 spec 必须先把改动合进本地 main**（#79 实收）。
- 🔴 **`md5sum … | sed 's|.*/||'` 是贪婪的**，会把哈希一起吃掉 → 「重冻前后 md5 全表 diff」退化成空判。
- 🔴 **一个 test 串着跑 N 次 `toHaveScreenshot`，第一处不匹配就中止整条**——漂移清单是**残缺的**。
- 🔴 **截图证据自己也会撒谎**：拍完要看一眼拍到的是不是那个态。
- 🔴 **门崩掉比门变红难诊断得多**；**改判扫描的暗区**：`scripts/gates/live-frontend-gate.snippet.js`
  不在 `*verify-*.mjs` glob 里。
- 🔴 **读 `textContent` 的判据看不见「被裁掉」**（#85 实收，人眼看图才逮到）：`.lite-btn` 基类是
  `inline-flex + justify-content:center`，**居中的 flex 文本溢出时朝两头同时溢**，
  `text-overflow:ellipsis` 对 flex 里的匿名文本还不生效——引文两端各被切一个字，
  而 41 条判据一条都没红。**量裁剪要用 `Range` 取文字矩形，比对它和盒子的左右缘。**
- 🔴 **一条「存活」的变异先查它有没有碰到被判的性质**（#85 又实收一次）：M-B 打的守卫在现行
  链路上**永远为假**（调用点传的都是刚抽出来的读数），是**死枝**不是门洞。
  处置是让那条分支**自己在 docstring 里说自己测不到**——否则下一个人把台账那格绿读成「验过了」。
- 🔴 **把页面打崩的变异比「跑着却说错话」的弱**（#85）：崩掉的页面随便哪条判据都能红，
  证明不了你想证明的那一条有牙。变异要造出**能跑但说错话**的实现。
- 🔴 **门全绿 ≠ 真部件被验到**：**恰好一致 / 恰好如预期的数字最该翻日志。**
  ⚠ **销毁/收缩类判据必须配一条动作之前的对照基准**（#86 的「清空后为 0」是现成的空真；
  #87 的「删掉之后原话搜不到了」在语料切不出材料块时同样退化成 0 → 0，靠给语料补一行散文救回来）。
- 🔴 **多行插入时忘了把新文本也转成 CRLF，会造出混行尾文件**。收尾逐文件自查 `bare_lf == 0`
  （⚠ `cat >> file <<EOF` 写出来的是纯 LF，#87 实收，写完要转）。
- 🔴 **改完后端必须按端口杀掉重起 uvicorn**（不热重载，`pkill` 杀不掉且不报错）。
- 🔴 **`./init.sh` 和 run-battery 的收尾重建都 `vite build` 不带 api base** → dist 落回生产域名。
  ⚠ **本 session 跑过 `./init.sh`，所以 `dist/` 现在指向生产域名**——跑任何上传型门/截图之前
  先重打带 `VITE_AVERY_API_BASE` 的 dist**并在浏览器里验 apiBase**。
- 🔴 **杀 npx 包装进程杀不死 vite 子进程**；stale 进程按端口杀。
- 🔴 **本机 Docker PG 容器时钟来回跳 ~115s**：`created_at < now()` 判据间歇假红。
  ⚠ 本机 docker PG 的口令是 **`dev`**（`docker inspect teammaster-postgres-1`）。
- 🔴 **本机 curl / argv / stdout 都按 GBK 啃中文**：中文只走文件（`git commit -F` / `gh api --input`）。
  ⚠ 同族：Python 脚本里 `print()` 中文会直接 `UnicodeEncodeError` 炸掉，调试探针要写文件再 `cat`。
- 🔴 **CSS 包含块/裁剪读码推断必须浏览器实测**（#66）；**特异性同理**。
- 🔴 `e535ec9` commit message 是错的（真相在 `03a9824` erratum）；rebase 与否归 Danny。
- 🔴 repo 级 stash 两条别人的存货；处置归 Danny。
- 多个战役 worktree 仍挂着（30 个上下）——删分支/worktree 属删除闸，归 Danny。
- ⚠ **各票收尾必须重写本文件**（AGENTS.md DoD）。
