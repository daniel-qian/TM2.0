# Session Progress Log

> 📢 本文件是**当前状态快照，整体重写不追加**。历史都在 git（`git log` + 各 `.issues/*/receipt*.md`），别在这儿堆编年史。
> 启动路径见 `AGENTS.md` Startup Workflow：读本文件 + `feature_list.json`，跑 `./init.sh` 确认绿，再开工。

**Last Updated:** 2026-08-13 凌晨（0812 战役五票 **#92、#94、#90、#93、#91 全部落地进本地 main（未 push）**：
**#91 = 上传前端接线**（战役收口票）——transport 超时熔断（deposit 60s AbortController，
只熔断不重试、超时文案说「可能已经传上了」）+ `uploadFiles/appendFiles` 关门轮询 `GET /files`
任务摘要、全部文件终态才翻牌（**ingestStatus/appendStatus 对外契约一个字没改**，约 30 道门 +
18 张数据态像素合并树实测零改判零漂移）+ 文件行 'reading' 态上屏 + #89 横幅改从
`last_job.extraction_mode` 消费 + 「请保持页面打开」退役/多选引导上屏 + v01 逃生门最小维护补丁
（回执 `receipt-91.md`）。**统一上产从此可以 #90+#91 同批走，前端数据态门/像素不再有「预期红」。**
**#93 = 全档案重跑粒度闸**（S2 第二刀）——补传后拿整个档案的字节重建 docs 重判，
**只折叠不删除**（新字段 `folded_into`，Danny 拍板不复用 `archived`）+ 血缘完整性前置 fail closed
+ **裁决落库**（`granularity` 此前真库往返静默丢失）；实测逐份补传 **7 张 → 4 张**、与一次全选
逐字相等（回执 `receipt-93.md`）。
#92 = 粒度闸 R5-duty-column + 「全选==逐传」不变式门（回执 `receipt-92.md`）；
#94 = 账号方案 A 真彩排九判据 33 条全绿 + authGuestNote/homeGuestNote 修真话
（回执 `receipt-94.md`，常驻测试户已建、凭据只在 scratchpad）；
**#90 = 上传管线后端重做**——sha256 内容幂等 + 异步 deposit（ingest_jobs 任务表 + 进程内
worker + 孤儿回收 + 'reading' 态）+ pg put() 增量化（positional diff，xmin 实证）+ 四段计时
（回执 `receipt-90.md`）。
#89 的生产态不变：前端 `6b70173`、后端 `avery-agent:main-20260812-070519`。
⚠ 本地 main 自 #92 起**领先** origin/main——别单独 push）

## Current State

- **git**：`main` = 差距战役八票 + gap2 三票 + 三轮演习批 + #68 + #70 + #69+#71 + #72 +
  **0808 重构战役四波全部**（#73/#74/#75/#76/#77/#78/#79）+ wave 4（#80+#81）+ #82
  + **#86 + #83 + #87 + #84 + #85 + #88（0810 设计轮票 4 / 1 / 5 / 2 / 3 / 6 —— 六票全清）**
  + **#89 + #92 + #94 + #90 + #93 + #91（0812 战役：抽取失败可见+热备 · 粒度闸 R5 职责列+不变式门 ·
  账号A真彩排+文案修真 · 上传管线后端重做 · 全档案重跑粒度闸 · 上传前端接线——五票全清）**。
  回执：`redesign-0808/` 六份 + `design-0810/` 六份 + `ingest-root-cause-0812/receipt-{90,91,92,93,94}.md`。
  ⚠ 别在这儿写死 ahead 数字——它每提交一次就自己作废。要数就跑：
  `git rev-list --count origin/main..HEAD`。
- **后端离线套基线：`TZ=UTC` → 4207 passed · 0 failed · 151 deselected · 4 xfailed**（约 2min，
  #95 合并后实测）。= 4204 + **#95 的 3 条**（`test_ingest_async_90.py` 尾部：等落地助手两条
  + **起真 uvicorn 必须打开 worker 的静态门**一条）。
  上一档 4204 = 4175 + **#93 的 29 条**（`test_granularity_rejudge_93.py`：全档案重跑三道锁 /
  带对照基准的「7 张 → 4 张」不变式 / 链形状哨兵 / 手编护盾 / 裁决落库 / 删除撤销折叠 /
  0010 的 want-ADD 孪生门；其中 4 条 `@needs_db` 走 deselected）。
  上一档 4175 = 4146 + **#92 的 14 条**（`test_granularity_duty_column_92.py`：R5 十条单元
  判据 + sniff 前提钉 + 「全选==逐传」端到端不变式门 ×3）+ **#90 的 15 条**
  （`test_ingest_async_90.py`：sha256 幂等含 LLM 零调用对照基准 / 异步 deposit 骨架回执 /
  worker 落地 / 红线 job failed 收行 / 孤儿回收 / 四段计时）。
  deselected +8 = `test_ingest_jobs_db_90.py`（needs_db）。
  ⚠ #90 起 `tests/conftest.py` autouse 关掉 worker 线程（确定性），HTTP 上传类测试一律
  「POST → `ingest_worker.run_pending_jobs()` → GET 断言」；真线程路径由
  `test_ingest_nonblocking.py` 单独盖。✅ **任何红都是你的。**
- **真库套（@needs_db）：`-m needs_db` 全仓 → 142 选中 · 142 passed · 0 failed**
  （一次性库 `avery_t95_final`；#93 起改成全仓口径、#95 把最后五条红清干净）。
  🔴 **口径只许写全仓的数字，永不写「某几个文件 N/N」**——那不是口径，是挡板：#90 回执写的
  「既有**五文件** 78/78」把**四条它自己改坏的**测试藏了一整票（已就地订正 receipt-90，
  完整分析在 `receipt-95.md`）。
  （历轮那些数字跑的是**挑出来的子集**：#88 是 205、#87 是 73、#85 是 62 ——
  **跟 142 不是同一个集合，别对减**。）
  ⚠ **起真 uvicorn 子进程的测试必须合进 `conftest.SUBPROCESS_WORKER_ON`**（autouse 的
  `AVERY_INGEST_WORKER=off` 会被 `{**os.environ,...}` 继承进子进程）——有静态门钉着了。
  🔴 **本轮实收一条间歇红**：`test_sweep_collects_only_old_unlinked_ephemeral_clones[postgres]`
  整轮红过一次、单跑绿、随后两轮同命令全绿。当场探容器时钟：连采 6 次，前 5 次 `+0.4s`，
  **第 6 次 `-114.2s`** —— 就是那条「Docker PG 时钟来回跳 ~115 秒」，招牌症状正是「单跑绿、整轮红」，
  触发面是 `created_at < now()`。**不是本票造成的，也别当它不存在。**
  ⚠ 本机 docker PG 的口令是 **`dev`** 不是 `postgres`（`docker inspect teammaster-postgres-1` 可查）。
  跑完记得 `DROP DATABASE`（本 session 的一次性库已删）。
- **像素基线现状**：**54 张。#91（0813 凌晨）重冻 4 张**——`{aurora,paper}-home-{desktop,mobile}`
  （首页上传骨架卡的 caption 多了多选引导一句，下方内容顺移；diff 图人审=漂移全部圈定在那张卡），
  **其余 50 张（含全部 18 张数据态）md5 逐字未变**；合并树复跑 54/54 零漂移。
  0810 那轮重冻过 10 张——4 张按 #83 + 4 张按 #84 + **2 张按 #88**
  （`{aurora,paper}-files-desktop`：空态左栏少了「更多 / 新建一家公司」那一组）。
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

## 本轮做完的 · 之六（2026-08-13 凌晨 · #91 上传前端接线——0812 战役收口）

回执 `.issues/ingest-root-cause-0812/receipt-91.md`（逐件、门夹具三处改造的病历、变异台账、
已知边界五条）。**纯前端 + 门**：后端零字节、迁移零条。人眼图 `_shots-91/`。

- **①熔断**：`send()` AbortController 超时（deposit 60s——服务端秒级但字节要过网、10MiB 慢线
  上行是真实分母；fetchFiles 15s）；🔴 只熔断不重试；超时文案动词是「刷新看看」不是「重试」
  （deposit 超时多半=字节已到、回执死在半路）。SSE 自带 signal 的请求一律不碰。
- **②内部轮询**：deposit 秒回带 `job` → 关门轮询 `GET /files`，`last_job.id===本次 job` 到
  done/failed（或本批无 'reading' 行）才把 team+status 在**同一次 set** 里翻牌——对外契约零改动。
  每轮 stillOn；只消费自己 job 的 extraction_mode；无 `job` 键=同步世界走原路（stub/老后端/
  全 identical 不入队路，字节不变）。adopt 挪到 deposit 当下=断连不再孤儿化档案（暗伤①′ 前端半边闭合）。
  uploadFiles 补 store 级重入闸。notifyStore/OnboardGate/ingestClock 零改动（忙态覆盖整个窗口，
  秒表锚点自动跟着轮询生命周期走）。
- **③'reading' 行**：「正在读取…」+ honey 转点（复用 feat068 脉冲，reduced-motion 豁免）；
  轮询每轮写 files，行是活的。🔴 `.upload-ready`/`.upload-error-label` 类名一字节未动。
- **④横幅改接**：值从 last_job 消费，持久化/清理机制原样——🔴 **刻意不让 refreshFiles 直接消费
  last_job**：job 行是无 FK 审计痕迹、清空不删，直接消费=清空后横幅从服务端诈尸（门⑥现在钉着）。
- **⑤文案**（手写中文）：「请保持页面打开」退役、正面说「关掉页面都没关系」；多选引导×3 入口
  （「一起读更快、结果也更准」——说清为什么）；`skipped_identical` 回执行（「已经有了，没有重复保存」
  ——超时重传场景的正面答复，措辞是成功不是拒绝）；conflicts_added 转 optional 自然退场
  （冲突照旧走今天页+铃铛）。
- **v01 最小维护补丁**（票面外、电池逼出来的）：逃生门 uploadFiles 认 job 就轮询到落定，否则
  空骨架被当空团队渲染——三门 v01 半边 18 条判据全红。修壳不改判门。
- **门夹具两处 #90 引信**（都有 A/B 实证）：⑴ 门语料每发必须唯一字节——sha256 幂等把同字节
  补传整个跳过（无 job、无 extraction_mode），五发同串 WEEKLY 时判据全在空转；⑵ change-log 的
  firstId 避开「负责人」行——pre-#90 逐文件打 uploaded_at、组序碰巧把它排后面，#90 整批共享
  received_at 后平手回退派生序，门赌的巧合塌了（起 pre-#90 后端直连对比钉死：载荷键序逐字相同，
  唯一变量就是批内时间戳并列）。
- **verify-extraction-degraded 重设计**（17→18 判据）：改包点挪到 GET /files·last_job；⓪′ 钉
  「POST 写口确实不再发 extraction_mode」这个前提。⚠ 实收：`route.fetch()` 的 APIResponse
  **没有 clone()**——观察响应体用 text() 自己 parse。
- **验证**（合并树二跑——#93 在收尾窗口并入，纯后端零文件重叠）：init.sh 绿 · 电池 A 38/38 ·
  B 3/3 · C 3/3 · 像素 54 张恰好 4 张 home 换血（多选文案卡，diff 人审后重冻）+ 合并树复跑
  54/54 md5 零漂移 · 变异 M1/M2/M3 全击毙（M3 恰好一条红精确落位）· reading/ready/skipped
  新态截图人眼过。
- 🔴 **已知边界**：刷新后回来的 'reading' 行**不自动续轮询**（轮询关在两个 action 内部是票面
  口径；工具条「刷新」现成，回来时多半已读完）——要不要「见 reading 自动轮询」是下张票的
  产品判断，别顺手。

## 本轮做完的 · 之五（2026-08-12 · #93 全档案重跑粒度闸 —— S2 第二刀，结构性根治）

回执：`.issues/ingest-root-cause-0812/receipt-93.md`（三道锁的判据设计、裁决落库、删除路语义
复核、21 条变异台账、真库五条红的逐条销账）。**纯后端**：前端零字节。迁移 **就地改 0010**
（`entities_kind_check` 收 `'ruling'`，want + ADD 两处同改）。

- **补传结束前拿整个档案的字节重建全量 docs、重跑粒度闸**，判出来的降级**只折叠不删除**。
  作者那句「整表静默删除，宁可漏」（`file_append.py:133-136`）**保留成实现约束**，不再是方向
  否决——它的两个前提被 #87 推翻了（字节全在库 + `lineage["docs"]` 记着每张卡的来源文档）。
  这是同一块碑的第二次订正（第一次是 `file_delete.py:36-52`）。
- **实测不变式：逐份补传 7 张 → 4 张，与一次全选逐字相等。** 对照基准是把 `rejudge_archive`
  monkeypatch 成空桩（= #93 之前的行为）在同一份语料上量出来的那个 7。
- **三道锁**：① 降级必须 `parent_kind == "project"`（新字段，规则自己声明 parent 在哪个命名
  空间）**且** parent 在当下可见的卡里查得到——**两把锁刻意分成两扇门**（0808 碑：belt-and-braces
  会互相免疫变异），测试侧为此造了**无标题哨兵卡**让 R4 的空 parent 真能命中池子；
  ② 血缘完整性前置断言，字节拉不回/parse 失败 → **整趟放弃**、回执记账；
  ③ 软折叠 `folded_into`（Danny 拍板不复用 `archived`），`registry._active_projects()` 同门过滤、可逆。
- **裁决落库**：`granularity` 从此进 pg（`kind='ruling'` 行）。此前它在真库往返里**静默丢失**
  （pg_registry 自己拿它当反面教材）。折叠一旦开始，「为什么这张卡不见了」重启后必须答得出——
  `Ruling.subject_id` 指到卡，**只在重判路记**（抽取路跑在 `_disambiguate_project_ids` 之前，
  那里的 id 还不是最终 id）。
- **`file_delete` 语义复核（票面第 3 项）**：按 `doc_key_of(evidence)` 清裁决的既有写法不变，
  但补上后果——**解释被删掉，折叠就撤销**（4 张 → 7 张，真库上也验过）。新不变量：
  一张 `folded_into` 非空的卡，`granularity` 里必须有一条 `subject_id` 指向它的裁决。
- **票面之外的一条收紧**：**经理手编过的卡（provenance origin='manual'）系统不收走**。
  折叠比顶掉一格重得多，而「手编格恒不被文档顶掉」是这个仓库既有的纪律。逐卡生效，反向门钉着。
- 🔴 **顺手补了 #87 那口坑的孪生门**：`test_entities_kind_check_covers_written_kinds` 只扫
  `ADD`、**看不见 `want`**——0009 在 #87 时被补过孪生门，**0010 一直没有**。已补
  （`test_migration_0010_want_and_add_agree_with_the_kinds_put_writes`，变异 M17 实证）。
- **变异 21/21 全歼**。⚠ 第一轮两条存活，**查下去都不是门洞、但都换来一条真判据**：
  一条**打歪了**（打的是回执字段，而裁决的 `subject_id` 是另一行代码——重新瞄准当场红）；
  一条打的性质在原语料里**一个实例都没有**（三条降级的 parent 全指同一张活卡）——
  补了「链」形状哨兵语料（乙是甲的里程碑、甲又是丙的里程碑）之后当场红。
- **已知缺口（明写）**：被折叠的卡今天**对经理不可见**（折叠抽屉 UI 不在本票内，票面明写）；
  折叠卡仍进 `facts.md`（与 `archived` 今天的处境完全相同，动它会同时改归档语义）；
  重跑成本随档案线性涨（计时已埋，⚠ `stage=rejudge` 那行的 `files=` 数的是**整个档案**，
  其余四段数的是本批——正是要并排看的两个数）。

## 本轮做完的 · 之四（2026-08-12 · #90 上传管线后端重做）

回执：`.issues/ingest-root-cause-0812/receipt-90.md`（四件事逐条、14 条变异台账、
xmin 判据设计、给 #91 的契约清单、运维约束）。**纯后端**：前端零字节。迁移 **0017**（content_sha256
+ pgcrypto WITH SCHEMA public + 库内 backfill）+ **0018**（ingest_jobs，刻意无 FK=审计痕迹）。

- **A · 内容幂等**：哈希在 read_capped 当场算；补传命中库内同字节 → **连临时文件都不写**整个跳过，
  回执新开 `skipped_identical`（含 matches_source_key）；整批全命中=200+不入队（成功不是失败）。
  pg 四处：INSERT 列 / get() 元数据 SELECT / `_prior_src_bytes` 平行回填 / **clone 列清单**（漏=副本丢 hash）。
- **B · 异步 deposit**：POST /ingest 与补传秒回（字节+queued job 一个事务；owner_token 当场持久
  ——断连不再孤儿化档案）。响应**不带 extraction_mode**、带 `job` 句柄；文件行 `'reading'` 中间态；
  `GET /files` additive `last_job` 摘要（#89 横幅异步下靠它翻牌）。worker=daemon 线程 +
  `run_pending_jobs()` 同步驱动双入口（原子 claim 互抢安全）；`AVERY_INGEST_WORKER=off` 刀闸。
  **失败语义**：failed=这批文件没进资料库（红线/全 parse 失败/崩溃 → job failed + reason +
  reading 行收走，与旧 422 同构）。**启动孤儿回收**：processing→failed: server restarted + 收行，
  queued 一根指头不碰（重启后自然跑掉）。🔴 运维约束：**换容器先 stop 旧再 start 新**
  （并存窗口里新容器的回收会误杀旧容器正跑的 job）。
- **C · pg put() 增量化**：「re-put=replace」语义不变，实现改 positional diff（逐表指纹、
  第一分歧点后重写）。补传只写新行；**xmin 判据**（老行事务 id 逐行不变 + 同一次 append 必须
  挪动 facts.md 的 xmin=尺子自证）+ 零变化 re-put 四表全不动。回填临时表保留（守被重写的行）。
- **D · 计时**：`ingest-timing stage=parse|extract|merge|persist` 四段 logfmt，插桩在引擎层
  （同步直调与 worker 共享探针）。
- **28 条既有测试改判**（红线 422→job failed、POST 响应断言→GET 断言等），逐条记在回执;
  `test_ingest_nonblocking.py` 重写成三合一门（deposit 不等抽取 + worker 忙时 /health 活 +
  lifespan 线程真落地）。
- 🔴 **实收两条「单跑绿整批红」**：① Docker PG 时钟跳（claim 的 oldest-first 赌了两个 now()
  的顺序——改显式拨 created_at）;② **claim/recover 是全局扫描**而共享测试库里其他测试走
  HTTP /ingest 留下 job 行（无 FK 审计设计=删 context 不删 job）——测试开头清场 live 行。
- 🔴 变异第一轮 12/14「锚点 0 命中」= 仓库 CRLF vs 脚本 LF——跑器的命中数==1 防线把
  「没打上」和「存活」分开了;按文件真实行尾转换后 14/14 全红。

## 本轮做完的 · 之三（2026-08-12 · #94 账号方案 A 真彩排）

回执 `.issues/ingest-root-cause-0812/receipt-94.md`（九判据逐条证据、产品事实四条、清理回执、下轮复用姿势）。
**前端只动 4 条文案，零逻辑改动；后端零字节。**

`auth.users` 从 **0 行**起步，方案 A 完整动线在生产上第一次被走通：登录态上传自动归属
（`account_linked:true`）· 换设备恢复（人/项目逐字对上，**核心判据**）· 游客上传→手动认领 ·
登出后 owner_token 腿仍 200 · demo 全程免登录 · 双账号不串场 · 真 JWT 60s 缓存
（**t+1.9s 后端 200 而 GoTrue 直探已 403** = 窗内 200 确凿来自缓存 → t+66.2s 重核验 401）·
refresh_token 真续期后新 token 请求 200。常驻测试户 `avery-e2e+20260812@dannyqian.com`
（凭据只在 scratchpad，回执只写指针）；临时户 B 已删；三个彩排 context 已解绑 + 标 ephemeral
（48h 后任一次 /demo/claim 顺手回收）。文案 authGuestNote + homeGuestNote 中英四处改真话
（死针探测零命中先行）。验证：`./init.sh` 绿 · i18n-orphans 0 · verify-auth-capability 25/25 ·
verify-auth-form 57/57。

**带回编排的四条产品事实**（详回执 §5）：① 注册入口对预置户是死胡同且**比票面更糟**——Supabase
枚举保护对已注册邮箱回 200+假 user id，authStore 那句「这个邮箱已经注册过了」**结构性够不到**，
分发话术必须明说「直接登录、别点注册」；② 无改密/重置入口（src 零调用点）；③ claim 不收权
（实证：认领+登出后旧 owner_token 仍是万能钥匙）；④ **登出会让 OnboardGate 闸门复活**盖住还开着
的登录弹层（A 登出→B 登录的共享机动线被打断一次；也是彩排主跑第一次挂死的病根）。
另订正 exploration.md §2：「刷新丢认领入口」对现行代码**不成立**（锚点+token 都持久化，入口刷新
前后都在）；真正的丢失条件 = localStorage 没了（那时游客数据对这台设备就是孤儿）。

## 本轮做完的 · 之二（2026-08-12 · #92 粒度闸 R5 职责列 + 「全选==逐传」不变式门）

回执 `.issues/ingest-root-cause-0812/receipt-92.md`（判据逐条论证、变异 11 条台账、已知边界
五条）。**纯 eval-harness**：前端零字节、迁移零条。#93 的 #92 依赖已清。

- 病灶（生产钉死）：花名册「当前负责事项」列被抽成 12 张假项目卡，**逐传时全部存活**——
  R1/R3/R4 全靠跨文档证据池，单文件补传批同时瞎掉；提示词判据 "it gives that project its
  own owner" 在花名册形状上本身失效（每格确实有 owner=本行的人）。18-vs-11 的主要来源。
- **R5 主判据=结构信号**：同一文档内 ≥60% 且 ≥2 张**带行号**的项目候选，source 行号与某个
  人的行号重合 → 逐张降级、parent=那一行的人（verdict=milestone，三值闭集不动）。
  文档局部判定 → 全选与逐传**天然一致**。`doc_kind=='roster'` 只降门槛（1 张/50%）不当
  主判据——她的文件嗅成 project，主判据在 project 下自己站住；line:1=clamp 默认不算行
  （**单锁**，两侧共用 `_line_anchored`，刻意不做双保险防变异免疫）；逃生口照 R3 guard(a)
  形状但字段集=progress/dueDate/milestones（**owner/status 刻意不算**：前者是病灶的伪装、
  后者是模型嗅的）。
- **不变式门**（新 `test_granularity_duty_column_92.py`，14 条）：她三件套形状的语料走真
  `LLMExtractor`(scripted brain) + 真 `ingest_paths`/`append_paths_to_context`，
  全选==逐传==6 个真项目、人 13 两侧一致、12 格职责全进裁决审计；含逆序与 heuristic 变体
  （钉 R5 在启发式路结构性惰性：项目 source 是 span 起点，撞不上人行）。
  **拆掉 R5 实测全选 17 vs 逐传 18**（M2 探针）——生产 18-vs-11 同一机制。
  `apply_gate`/`build_milestone_index` 全套测试**史上第一次**被喂多于一份文档。
- 🔴 **`apply_gate` 现在读 `res.people`（全仓第一个读者）**——#93 全档案重跑闸重建判定
  现场时必须**连人一起喂**，只喂 projects+docs 会让 R5 在重跑路上**静默**失明。
- 变异 **11/11 全歼**（恒真/恒假各一发 + 每条主判据专属一发：line1 锁/逃生口双向/比例线/
  条数线/roster 加分/parent/跨文档域/规则序；锚点命中数逐条==1、跑完还原原始字节）。
  M6/M7/M8/M10/M13 各**恰好 1 红**且落在自己的专属测试上。40 条 granularity 护栏零改动全绿。
- 已知边界（回执 §6 全文）：owner-only 项目台账会被折叠（与职责列结构不可判，票面拍的刀口）；
  模型全不给行号时 R5 静默（诚实的失手：无行证据不降级）；跨文档失明（R1/R3/R4）未动=#93。

## 本轮做完的 · 之一（2026-08-12 · #89 抽取失败可见 + 供应商热备）

回执：`.issues/design-0810/receipt-deploy-0812.md`（含考古结论：DeepSeek-as-checker 去哪了）。

**起因是一次真实翻车，不是巡检发现的。** 0811 合伙人试用：MiniMax Token Plan 用尽 →
每次抽取撞 429 → 降级正则 → 13 人花名册抽出 **0 人 0 项目**。而她屏上看到的是
200 +「已读取」+「今天没有要你定夺的事」+「现在没有自相矛盾的地方」——
**每一句都在说一切正常**，于是她的结论是「我是不是传错格式了」。

配额是钱的事（Danny 已充值）。但里面有两条确实是工程债：

### 一、诚实的一半送到门口，另一半把它扔了
后端**从 feat-039 起就一直发着** `extraction_mode: "degraded"`。
那个字符串在 `src/` 里的出现次数：**0**。

🔴 **立碑**：「后端诚实了」≠「用户知道了」。契约里 additive 的诚实标签，
**如果前端没有消费点，它和不存在是一回事**——而且没有任何一道门会红，
因为两侧各自都是自洽的。往契约里加诚实字段时，**同一个 commit 里必须有它的读点**。

修法与三个设计点：
- 判据 `=== 'degraded'` 而**不是** `!== 'llm'`：`'heuristic'` 是「这台后端没配模型」的
  诚实态，对着它报警就是天天喊狼来了（变异实证：写成 `!== 'llm'` 红 ①④）。
- **熬得过刷新**：这个键**只有两个写口发**（`POST /ingest` / `POST /team/{id}/files`），
  `GET /team/{id}` 是读口不重跑抽取 —— 不自己存进 localStorage，警告就在刷新那一瞬间消失，
  而她的真实动线正是「传完 → 看了会儿 → 翻页」。
- `emptyArchive` **不换 `context_id`**，所以「换 id 就清干净」那条收口在这儿根本不跑，
  必须单独清一刀（否则崭新的空档案上挂着一句关于不存在之事的警告）。
- 文案两条硬纪律：**先摘掉用户的责任**；重试**必须说「先删再传」**——补传走
  `_unique_parse_names(taken=…)`，同名文件会被改名成 `(1)`，**直接重传是多一份不是覆盖**，
  不说这句用户重试三次就是三份同样的文件、片段数翻三倍。

### 二、单供应商单点，且 /health 对此撒谎
`DEEPSEEK_API_KEY` 那 39 小时**就躺在生产 env 里**，但代码是「取第一家有 key 的」，
第二家从没被问过一次。同窗口 `/health` 恒 `degraded:false`——
它**只看我们自己进程内的预算计数器，从不知道供应商在拒绝我们**。

- `service/failover.py`：`FallbackBrain` 供应商链 + 被动遥测。抽取 / advise / ask 起草 /
  表单起草四个调用方共用同一个 seam。
- `BudgetExceeded` **不 failover 也不记为供应商失败**——那是我们自己的花钱闸，
  换一家只会再充一次电费然后撞同一堵墙。
- `/health` 补 `commit`（7-21 挂到今天的债，镜像构建时用 `--build-arg` 烙）+
  `providers`（**没被调用过 = `ok:null`**，诚实的「不知道」，绝不翻译成好或坏）+
  `extraction_chain`。**已知全链坏才 `degraded:true`**；单家坏对家好 ≠ degraded。
- `AVERY_BRAIN_FAILOVER=off` 是运维刀闸。

### 验证
离线 **4146/0**（+11）· 门电池 **44/44**（A 38 · B 3 · C 3）· 像素 28+8 **零漂移** ·
新门 `verify-extraction-degraded.mjs` **17 判据**。

🔴 **变异第二发逮到门自己的洞**：初版每步都跟一发 `gotoFiles()`（整页导航），
于是 ② 走的其实是 localStorage 那条路、和 ③ 测的是同一件事——
**「传完待在原地不动」这条最常见的动线一条判据都没盖到**。已拆成 ② 只吃内存态 / ③ 只吃持久化。
**门 17/17 全绿的时候它是有洞的，是变异把洞照出来的。**

### 生产真验（不是读码）
用**她的原始字节**在生产上真跑：`ctx_c1dfe797b6c2` → **13 人 · 5 项目 · 20 片段 · 1 轮对话**
（0811 同样这两个文件是 0 人 0 项目）。DeepSeek 单独强制走一遍：同样 13 人 5 项目。
横幅在生产包里 7/7 接通（含刷新后仍在）。`advise_runs` 从**全表 0 行**变成 2 行。

### ⚠ 换容器踩的两个坑（下次照抄这两条）
1. **容器内部监听 8137**，脚本跑在容器**里面**还用外部映射端口 8138 → `Connection refused`。
   一律照抄 `docker port avery`。
2. 🔴 **只抄 env 不抄挂载 = 示例团队会消失**。demo seed 是**只读 bind mount**
   （`/home/admin/avery-demo-seed → /app/demo-seed:ro`），**不在 `docker inspect` 的 Env 里**。
   第一次预检 `/demo/status` 回 `false` 才发现。**换容器前必查 `{{range .Mounts}}`。**

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

0. **🔴「已读取」这个词承诺得比它知道的多**（#89 上产后人眼过图逮到，**没修**）。
   生产截图上横幅说「有文件没能读懂」，底下每行状态却是绿色「已读取」，贴在一起像自相矛盾。
   机制自洽——两根不同的轴：状态列判**解析**（这份文件切出了文字片段，每文件 `chunk_counts>0`），
   横幅判**抽取**（文字有没有被理解成人和项目，整批 `extraction_mode`）。但用户读「已读取」
   就是「读懂了」。**不是顺手改得动的**：`verify-file-manifest-truth.mjs:164` 逐字断言
   `statusText === '已读取'`，`verify-contrast-smalltext` 拿它当 `--sage` 采样面
   （3.9–4.11:1，本来就贴地板），三态各有自己的诚实 hint 要一起看。

0a. **✅ 上传根治战役五票全清**（正源 `.issues/ingest-root-cause-0812/exploration.md`，
   0812 晚拍板开出，0813 凌晨收口）。
   ~~#90~~ ✅（后端:sha256幂等+异步任务+增量落库+计时，回执 `receipt-90.md`）·
   ~~#92~~ ✅（回执 `receipt-92.md`）· ~~#94~~ ✅（回执 `receipt-94.md`；常驻测试户
   avery-e2e+20260812@ 已建、凭据在 scratchpad）· ~~#93~~ ✅（全档案重跑闸+folded_into+裁决落库，
   回执 `receipt-93.md`）· ~~#91~~ ✅（前端:熔断+内部轮询+'reading' 态+横幅改接任务摘要+文案退役，
   回执 `receipt-91.md`）。
   🟢 **「#91 落地前数据态门/像素预期红」那条警告已作废**——门电池 A 38/38 · B 3/3 · C 3/3 +
   像素 54 张在合并树上全绿，**下一步是 #90+#91+#92+#93 统一上产**（迁移 0017/0018 要落地；
   🔴 换容器先 stop 旧再 start 新——#90 的启动孤儿回收会误杀并存旧容器正跑的 job）。
   ⚠ #90 遗留 4 条 needs_db 红（`0/0 materials` 一族：e2e 仍按同步路断言，异步 deposit 欠账）
   ——#93 回执已记，**建议单开小票**改判那四条（「POST → run_pending_jobs → GET」的既定姿势）。
   Caddy access log 已装好并验证（/var/log/caddy/avery-access.log，JSON，50MB×5 滚动）。
   ⚠ 大前提拍板（已入 memory）：**Avery 没有实际生产使用，只是部署通了**——开票按自然边界捆，不做分段上线仪式。

0b. **红线第二层从未上过生产**（0812 考古结论，回执 §7）。当年是**两层设计**：
   确定性正则门（在跑，`contract.py`/`ask_api.py` 每条建议都过）+ 跨家族 LLM 语义仲裁
   （票 011c，DeepSeek 当第二判官，`redline.py` 文件头至今写着这句话）。第二层真跑过、
   真抓到过一次确定性门的假阳（`EVAL-RESULTS.md` §3c），但**只活在评测台**——
   `service/`/`avery/` 零 import judge，最后一次真跑 2026-07-01。
   ⚠ 与 #89 的 failover **是两件事**：failover 是替换（可用性），那个是复核（正确性）。
   要不要捡回运行时：代价是每条建议多一次模型调用。**建议单开一票。**


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

- ✅ **~~四条 `@needs_db` 自 #90 起就红~~ 已销账**（#95，回执 `receipt-95.md`）。四条**全是测试
  还按同步语义断言**，零产品回归；真正的病是 **#90 的验证口径写成了「既有五文件 78/78」**
  而全仓是 142 条——那句话本身就是挡板。已就地订正 #90 回执，并补了一道**静态门**
  （`test_every_uvicorn_subprocess_test_turns_the_ingest_worker_back_on`）：
  凡起真 uvicorn 子进程且拿 `**os.environ` 当底座的测试文件，必须合进 `conftest.SUBPROCESS_WORKER_ON`。
  🔴 **这块暗区的机制值得记住**：`conftest.py` 那条 autouse 的 `AVERY_INGEST_WORKER=off`
  **会被 `subprocess.Popen(env={**os.environ,...})` 继承进子进程**，把「生产进程形状」里的
  worker 线程按死——表现是「库里 0 行」，与「忘了 drain」长着同一张脸，病因完全不同。
  ⚠ 静态门写完**当场又扫出两个票面没点名的实例**：`test_seed_gate.py`（潜伏，要真 key 才跑）
  与 `test_e2e_stress.py`（**它把自己的主张变成了空话**：worker 不跑 = 根本没有「长 ingest」，
  它压的是毫秒级 deposit）。
- 🟠 **#95 实测：并发压测下 `/health` 本来就要 6~8 秒，与 worker 开关无关**
  （off/on 各 3 轮分布重合：`[1.58,6.62]/[1.46,7.16]/[1.59,6.41]` vs `[1.56,7.69]/[1.62,7.90]/[1.75,6.10]`）。
  所以旧判据 `max < 8.0` 正压在真实分布上 = 在测那天机器忙不忙；而**样本恒为 2 是延迟的函数**
  （窗口 9 秒，一次 /health 吃掉 6~8 秒），「最少 N 个样本」不可满足、n=2 的中位数就是最大值。
  已改成这条测试真正能说的话（有应答 + `max < 15.0` 的「挂没挂」线，且在测试里明写**这不是延迟 SLA**）。
  **「/health 要 7 秒」本身是运维/产品题**（Docker healthcheck timeout 必须大于它，否则容器会在
  抽取期间被自己杀掉——那正是 feat-041 存在的理由），**已单开一票**，本轮没动。
- 🟠 **#93 的两条已知缺口**（都写在 `receipt-93.md` §7）：被折叠的卡今天**对经理不可见**
  （折叠抽屉 UI 票面明写不进本票，产品拍板已带回编排会话）；折叠卡**仍然进 `facts.md`**
  ——与 `archived` 今天的处境**完全相同**，改它会同时改归档语义，是另一张票。
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
- ✅ **~~粒度闸跨批次失明~~ 已销账**（#93 的全档案重跑闸）。⚠ 但**抽取那一趟**照旧只看得见本批
  （R1/R3/R4 在 `extract_docs` 里仍然瞎）—— 补的是**归并之后**那一道重判，两者别混：
  `apply_gate` 里判出来的降级是**丢弃**，`rejudge` 里判出来的是**折叠**（`folded_into`），
  所以两条路跑完 `extraction.projects` 那张原始列表**本来就不等长**，不变式落在 `project_cards()`；
  **`_people_from_roster` 位置兜底会顶掉空格子**（#61）。
- **`KeywordStore` 分词器是 `[a-z0-9]+`（纯 ASCII），对无空格中文 `query()` 恒空**——
  ⚠ 写「删/清之后检索不到」这类判据必须押 ASCII token。
- bellIsReal / nudgeVerdict 等手册协议相位仍无机械 runner。

## Blockers / Risks

- ✅ **~~离线 pytest 3 红＝已知墙钟炸弹~~ 已销账**（#82）。当前基线 **4207 passed · 0 failed**（#95 后），
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
