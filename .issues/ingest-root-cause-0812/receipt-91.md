# 回执 · #91 上传前端接线：超时熔断 + 内部轮询翻牌 + 「读取中」行态 + 文案退役

> 正源：GitHub issue #91 + `.issues/ingest-root-cause-0812/exploration.md` §S0/§S1 前端部分 +
> `receipt-90.md` §给#91 的契约清单。完成于 2026-08-13 凌晨。🔴 未 push（push=前端自动上产）；
> 已在本 worktree 合入本地 main。**统一上产从此可以 #90+#91 同批走。**

## 一句话

`transport.send()` 从裸 fetch 换成带 AbortController 超时熔断；`uploadFiles/appendFiles` 在
deposit 秒回之后**关起门来**轮询 `GET /files` 的任务摘要、全部文件到终态才翻牌——
`ingestStatus/appendStatus` 的对外二值契约一个字没改，~30 道活跃门与 18 张数据态像素在合并树上
实测零改判、零漂移；文件行 `'reading'` 中间态上屏；#89 横幅的值改从 `last_job.extraction_mode`
消费；「请保持页面打开」退役，换成正面说「传完就可以走」。

## 逐件

### ① 超时熔断（transport.ts）
- `send()` 加 opts `{timeoutMs, timeoutCopy}`：AbortController + setTimeout + finally clearTimeout，
  照 `authStore.probeOnce` 范式。**只对没带外来 signal 的请求生效**——streamAdvise 的 SSE 是长命流，
  自带 controller 的请求一律不碰。
- 阈值：deposit POST（/ingest、补传）**60s**——#90 后服务端处理秒级，60s 兜的是「国内→法兰克福
  推 10MiB」的上行最坏情况，再短会把慢线上一次会成功的大文件上传拦腰掐死；`fetchFiles` **15s**
  （轮询面，挂住的一轮放掉由循环自己数连败；refreshFiles 顺带从「永远卡 filesLoading」变成诚实报错）。
- 🔴 **只熔断不自动重试**（/ingest 每发新铸 context+token，自动重试=复刻「回车两下」数据丢失事故）。
- 超时文案（`transport.depositTimeout`，zh/en 手写）动词是「刷新看看」不是「重试」：deposit 的
  超时多半是「字节已送达、回执死在半路」——0812 的病灶正是服务端做完了 socket 已死。

### ② store 内部轮询、外部契约不变（store.ts）
- `pollIngestSettled(get,set,cid,jobId)`：3s 一轮拉 `GET /files`，**每轮先过 stillOn 身份复核**
  （A 的轮询结果写进 B 的 state 是红线）；每轮把 `files` 写回 state（'reading' 行就是这么活着上屏的）；
  连败 4 轮或超 10min 墙钟 → `lost`（诚实说「可能已经传上了，刷新看看」——worker 死在半路时
  孤儿回收只在重启跑，这是兜底）。
- 落定判据两条腿：`last_job.id === 本次 job.id` 且 status 到 done/failed；摘要不可见/被顶掉时
  退回「本批没有任何 reading 行」。🔴 只消费**自己那个 job** 的 extraction_mode，别人的标签归
  别人的轮询循环。
- **翻牌纪律**：team 与 'ready' 同一次 `set()` 落地（先翻牌后填数=「提前翻牌」以最难复现的形态漏出去；
  `sweep-r2-driver` 这类真打后端的门当场暴露）。失败路（job failed / lost）→ status 'error' +
  `jobFailedLead — <服务端 reason 诊断>`；**回执一并不留**（deposit 回执说「新增了 X」而那批行已被
  服务端收走，留着=对着失败展示成功清单）。
- `adoptContext` 挪到 **deposit 秒回当下**：owner_token 与锚点当场持久化——0812 暗伤①′
  （首传断连=token 死在 socket、档案永久孤儿化）在前端半边就此闭合。
- **无 job 键 = 同步世界**（stub / 老后端 / #90 的「整批全是库里已有字节」不入队路）：走原路，
  行为与 #90 前逐字节相同。唯一收紧：sync 路的 extraction_mode **只在键在场时**动（absent≠none——
  全 identical 那路没跑抽取，把缺席读成「清警告」会让无害重传抹掉一条还成立的警告）。
- `uploadFiles` 补 store 级重入闸（`newCompanyStatus==='ingesting'` 拒入）：appendFiles 早有同款，
  此前只有 UI 封口（OnboardGate 那段碑明写「store.ts 归他人所有」——本票 store 归我，欠账补上）。
- notifyStore/OnboardGate/ingestClock **零改动**：通知订阅的 ingesting→ready 跳变只在落定发生一次；
  防双击闸吃的忙态覆盖 deposit+轮询整个窗口；秒表锚点跟着忙态活，自动从「HTTP 生命周期」变成
  「轮询生命周期」（模块级锚点本来就是为中途离开设计的）。

### ③ 'reading' 行态（FileManifest.tsx + lite2.css）
- `fileStatusView` 加 `'reading'` → 「正在读取…」+ tone `busy`（--honey-text，与等待块同族）；
  表格态的状态圆点复用 `feat068-v02-ingest-pulse` 呼吸动画（`[data-status='reading']` 选择器，
  tone 管色、data-status 管动），reduced-motion 豁免与 ingesting-dot 同列。
- 🔴 `.upload-ready` / `.upload-error-label` 类名一个字节没动（像素播种锚 + contrast 采样面）。

### ④ #89 横幅改接任务摘要
- 值的来源：POST 写口从 #90 起不再携带 `extraction_mode` → 轮询在任务落定那一刻从
  `last_job.extraction_mode` 消费一次。**持久化机制原样**（localStorage 键、emptyArchive 显式清、
  adoptContext 换 id 清）——`last_job` 虽常驻但**刻意不让** refreshFiles 直接消费它：job 行是无 FK
  审计痕迹、清空档案不删 job，直接消费=清空后横幅从服务端诈尸（门 ⑥ 现在专门钉这条）。
- FilesScreen 渲染判据 `=== 'degraded'` 一字未动。

### ⑤ 文案（全部手写中文，en 同步；死针探测：门电池零文案判据引用旧句）
- `ingestingHint` 退役「请保持页面打开」：「文件已经收好了。正在逐页通读，通常需要两三分钟——
  这期间关掉页面、去忙别的都没关系，回来在资料库里就能看到结果。」（新能力要正面说出来，
  不能只把旧警告悄悄删掉）。
- 多选引导 ×3 入口（upload.caption / appendCaption / onboardUploadBody）：「一次全选：几份文件
  一起读，比一份一份传更快，读出来的结果也更准」——说清"为什么"（粒度闸吃跨文档证据），不只是"可以"。
- 新键：`transport.depositTimeout` / `upload.jobFailedLead` / `upload.skippedIdenticalLead` /
  `upload.fileStatusReading`。
- `skipped_identical` 回执行（UploadPanel 新类 `.upload-skipped-identical`）：「这几份资料库里
  已经有了，没有重复保存: chips」——「超时后重传」这个战役起点场景的正面答复，措辞是成功不是拒绝。
- `conflicts_added` 转 optional：异步回执结构上装不下它（deposit 在抽取前发出）。那一行在异步
  后端上自然退场；冲突照旧从今天页 + 铃铛 gap 通知到达用户（notifyStore ④ 在 team 更新时派生）。

### ⑥ 顺手
- `visual-data.spec.mjs` 头注释基线数 14 → 18（#79 加 room 屏后没人更新；只动注释，
  **不动 test 题名**——题名进快照路径，动了=54 张全部「missing baseline」）。

### v01（src/lite）最小维护补丁——票面外，被电池逼出来的
`?v=1` 逃生门的 `uploadFiles` 也在拿 POST 当终态：对着 #90 后端把空骨架渲染成空团队，
status-truth / file-manifest-truth / detail-provenance 三道门的 **v01 半边全红**（合计 18 条判据）。
选择修 v01 而不是改判门：门断的是「上传→渲染」这条链的真实为，改判=把一个真回归写成合法。
补丁 ~40 行：认 `job` 句柄就轮询到落定再 fetchTeam 翻牌（无 stillOn 体系，用 contextId 复核兜底）；
无 job 走原路字节不变。**不带** #89 横幅/reading 行/localStorage 锚（那些是 v02 部件）。

## 门与门夹具的三处改造（每处都有「为什么门错了」的证据）

1. **verify-extraction-degraded 重设计（17→18 判据）**：改包点从 POST 响应挪到
   `GET /files·last_job.extraction_mode`（POST 只观察不改）；新增 ⓪′ 钉「写口确实不再发这个键」
   ——前提塌了（有人把键加回 POST）当场红，不许空拦装绿。⑥ 顺带多咬一口：清空后 last_job
   仍在发（且仍被改包），横幅必须消失——谁让 refreshFiles 直接消费 last_job 这条当场红。
   ⚠ 门内实收：**APIResponse 没有 clone()**（第一版 POST 观察分支恒抛恒吞、⓪′ 恒红）——
   改 `res.text()` 自己 parse、回填原文。
2. **门语料每发唯一字节**：五发补传全用同一串 WEEKLY 时，#90 的 sha256 幂等把第 2~5 发全判
   `skipped_identical` **不入队**（无 job → extraction_mode 键缺席 → 标签纹丝不动），②⑤⑥⑦
   全在空转。这不是坑是幂等在正常工作；`weekly(tag)` 给每发加一行备注。
3. **verify-change-log 的 firstId 显式避开「负责人」行**：⑦ 把首行标成已查阅并留过刷新，⑪ 要在
   可见行里再找「负责人」行——这个前提此前**碰巧**成立：pre-#90 每个文件在 parse 时各自打
   `uploaded_at`（`pipeline.py:91`），同批三份时间戳递增，组序（按上传时间倒序）把「前厅部花名册」
   排最上；#90 起整批共享一个 `received_at`，组序平手回退派生序，「负责人」行成了首行 → ⑪ 扑空
   crash。**A/B 实证**：起 pre-#90 后端（2c74104）与 #90 后端直连对比，projects 序/lineage 键序
   逐字相同，唯一变量就是 uploaded_at 的批内并列。行序两种都对（一次上传=一个时刻更诚实），
   门的前提不该赌排序巧合。

## 验证账（全部在 **合并树**上重跑过——#93 在本票收尾窗口并入 main，纯后端零文件重叠）

- `./init.sh` 绿（lint + typecheck + build）。
- **门电池整批 A→B→C**（合并树二跑）：**A 38/38 · B 3/3 · C 3/3**。
  第一轮（f348cd4 树）A 区曾 4 红：3 条 = v01 半边（上面那块补丁的病历），1 条 = change-log ⑪
  （上面第 3 条门夹具）。修后 f348cd4 树与合并树各整批复跑一次，两轮全绿。
- **像素**（一律 `cd /d/avery` 主检出跑、VERIFY_BASE 指 worktree preview、跑前后 md5 全表 diff）：
  54 张里**恰好 4 张**换血——`{aurora,paper}-home-{desktop,mobile}`，diff 图人审=漂移全部圈定在
  首页上传骨架卡（多选引导句让 caption 长了一行，下方内容顺移），人审后重冻；
  **其余 50 张（含全部 18 张数据态）md5 逐字未变**。合并树复跑：**54/54 md5 零漂移**。
  ⚠ worktree 里 B 区 visual 第一红是「54 张全部 missing→自动落盘」（mtime 全在同一分钟），
  **不是漂移**——#85 那条「worktree 首红次绿=自考自答」的碑原样复现，像素裁决只认主检出。
- **变异三发全击毙**（`_mut91/mutate.py`，锚点命中==1、原始字节还原、每发独立 build）：
  | id | 打哪 | 预期红 | 实得 |
  |---|---|---|---|
  | M1 | 横幅判据 `==='degraded'`→`!=='llm'` | ①④ | ①④ 红 + ⑥ 伴生红（`null!=='llm'` 恒真，清空后也报警）|
  | M2 | appendFiles 落定去掉 rememberExtractionMode | ③（②仍绿） | ③ 红、② 绿（两刀砍两处自证）+ ⑥ 对照基准伴生红（gotoFiles 是整页导航，同吃持久化）|
  | M3 | emptyArchive 不清标签（内存+localStorage 双拔） | ⑥ | **⑥ 恰好一条红**，精确落位 |
- **新 UI 态人眼过图**（`_shots-91/`，全真实态零 route 造假）：reading 行（paper 桌面整表在框 +
  aurora 进度块）、ready + 8 chips、skipped_identical 行、闸门首步。手机 reading 窗口没抢到
  （mock worker 太快）——桌面双皮已盖行渲染，手机行几何由 files-explorer B②③④ 的「一种高度
  一种指纹」判据盖着，reading 行走同一套 grid 格。
- 后端 pytest：本票**零 .py 改动**；合并树后端与 #93 树逐字节相同，其 4204/0 离线 + 142 needs_db
  口径的账原样有效（#93 回执）。

## 已知边界（诚实记账，不是待办）

1. **刷新后回来的 'reading' 行不自动续轮询**：轮询关在 uploadFiles/appendFiles 内部（票面口径），
   中途关页再回来 → restoreSession 拉到 reading 行如实显示，但要看结果得点「刷新」（工具条现成）。
   反正文案已承诺「回来在资料库看结果」——回来时多半已读完。要不要给 FilesScreen 加「见 reading
   行自动轮询」是下一张票的产品判断，别顺手。
2. **补传回执的「N 处对不上”行在异步后端上退场**（conflicts_added 结构性缺席）。冲突可见性不减：
   今天页双栏 + 铃铛 gap 通知照旧（在落定后的 team 更新上派生）。若哪天要在回执里恢复这个数，
   得让 last_job 带上它（后端加字段），别在前端猜。
3. **v01 的 job 失败报错是开发者英文**（reason 原样上屏）：冻结壳的最小维护，比永远转圈诚实；
   v02 有 jobFailedLead 的本地化组合。
4. **深链/多标签页并发补传**：同 context 另一标签页的任务会把 last_job 顶掉——轮询退回
   「本批无 reading 行」腿落定，extraction_mode 那一轮不消费（宁缺不冒领）。
5. #90 遗留的 4 条 needs_db 红（`0/0 materials` 一族，异步 deposit 欠账）**不归本票**，
   #93 回执已开后续票建议；本票零 .py 改动碰不到它们。

## 给下一个人的坑

- **给门写补传语料时字节必须每发唯一**（sha256 幂等连队都不入）；「补传没跑任务」的形态是
  `job` 键缺席 + `skipped_identical` 非空，不是报错。
- **worktree 里永远别信 visual 门的红绿**：首红=missing 自动落盘，次绿=对着自画像比。
  mtime 全表同一分钟就是这个形态。
- `page.route` 的 `route.fetch()` 返回 **APIResponse，没有 clone()**——观察响应体用
  `res.text()` + 自己 parse，回填用原文。
- 组序类判据（「第一行是谁」）在 #90 后要想到：**同批文件共享同一个 uploaded_at**，
  平手时回退派生序。
- store 现在 import `getDict/activeLocale`（纯函数路径，零 React）——store 造用户可见句子时
  照这个先例，别把 dev 串直接塞进 error 槽。
