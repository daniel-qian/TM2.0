# Session Progress Log

> 📢 本文件是**当前状态快照，整体重写不追加**。历史都在 git（`git log` + 各 `.issues/*/receipt*.md`），别在这儿堆编年史。
> 启动路径见 `AGENTS.md` Startup Workflow：读本文件 + `feature_list.json`，跑 `./init.sh` 确认绿，再开工。

**Last Updated:** 2026-08-04（#38 locale 契约：判读链路双语对等，一票吃完四层 + 一道新双语门）

## Current State

- **git**：`main` 工作树干净、与 `origin/main` 推平。
- **验证账实**：全电池 **31/31**（**A 25** / B 3 / C 3）——本轮新增 1 道门（locale-parity，48 判据）。
  后端 pytest **3527 passed**（新增 53 条：locale 契约 28 + 决策文案 i18n 对账 11 + 红线补漏 14）。
  像素基线 40 张**未动**（本轮没改布局；像素门跑的是 `lang=zh`，而 CJK 标点清扫只改英文侧渲染，
  中文侧逐字不变——B 区 4/4 直接绿）。
- **#38 已完成并 closes**，**契约切换的两半已同批上生产**（[部署回执](.issues/locale-contract-0803/receipt-deploy-0804.md)）：
  前端 Vercel 构建 `89b36e4`（线上 bundle 的 commit 戳与本地 HEAD 逐字相等，
  8 条判读文案逐条核到线上产物）；后端换容器到 `avery-agent:main-20260804-153841`
  （从 main 构建，容器内纯 Python 断言核到 `grade_label` 已消失、命中带 `params`、
  `locale` 在契约上）。回滚梯 `avery-prev-20260804-153841` 在位。

## 本轮做完的（#38 · ADR-0033 · [回执](.issues/locale-contract-0803/receipt.md)）

一句话：**判读链路的语言从"涌现"变成了"契约里的一个字段"**，后端从此一句人话都不发。

四层同批落地（一刀切、不做新旧并存——并存等于留着"后端仍在产出中文"的破口）：

1. **契约**：新模块 `avery/locale.py` 收口 locale——缺省 `en`、非法值回落 `en` **并告警**、
   **不 422**（locale 是加法字段，没资格打回一次判读）。前端两个 transport 在**出口一处补全**，
   不让每个调用点各记一遍。
2. **后端不再产出人话**：`decision_grading.to_dict()` 删掉 `grade_label` / `rule_grade_label` /
   命中里的 `title`+`basis` / `unparsed_fields[].field_label`，规则版 `reason` 改空串；
   新增 `matched_rules[].params` 承载阈值（数字仍归后端配置，句子归前端）。
3. **LLM 正文**：语言指令进每一档 scaffold（**baseline 也带**——少一段等于给对比组偷偷换了变量），
   指令里写死**引文不翻译**例外；MockBrain 罐头按同一个 locale 取（否则门在 zh 下采不到样、恒绿）。
4. **前端**：i18n 新增三个档位词 + 18 条规则文案（带 `{n}/{days}/{pct}` 占位符）+ 规则句模板。
   中英**都由本 session 自己写大白话**（08-03 改口径，不再走 M3）。

### 顺手挖出并修掉的三个真缺陷（都不在票面上）

1. **`resolveLocale()` 在带 `?lang=` 的会话里赢过语言开关**。它是纯解析函数、URL 排第一位，
   所以点了 EN 开关之后界面是英文而传输层仍按 zh 发——ADR-0033 之后这意味着**英文界面拿回一段
   中文判读正文**，正是本票要修的症状换了个触发方式。修法不是再解析一遍，而是让开关成为下游
   唯一发布者（`setActiveLocale`/`activeLocale`）。链仍然只有一条。
2. **写死在 JSX 里的全角标点**：英文壳渲染出 `Not mentioned in the files：Status`。
   标点也是文案，进字典（`labelSep`）。判读卡改完后**全仓扫了一遍同族**，又清掉 7 处：
   6 处 `{'：'}`（DetailOverlay ×4 / ProjectsScreen / TeamScreen，全是「写失败」提示的
   `{标签}：{错误}`）+ 1 处 `owns` 编辑框把数组拼回文本时写死的 `、`
   （英文壳里是 `A、B、C` 这种半中半英的输入值）。
   连接符键顺手从 `homeFieldJoin` 改名 `listJoin`——它连的不只是字段名。
   `owns` 的往返安全：拆分侧本来就吃 `[,，、]` 三种，只换拼接侧不会破。
   自查：`grep -rn "{'：'}" src/` → 0；`grep -rn "join('、')" src/` → 0。
3. **evidence 里混着后端拼的中文注解**（`（已过 12 天）`/`（无阻塞、无风险信号）`）——它们
   既不是文档原文也不是字段读数，却印在写着「下面这几行是文档原文」的那一节里，
   **既是语言缺陷也是溯源缺陷**。全部拆掉；现在 evidence 里只剩两种东西，都与界面语言无关。

### 英文侧红线补漏（PRD §3.3 点名要做的那次抽查）

18 句常见「打分/排名」写法实测：拦 14、漏 4、零误伤。四句都不是边角写法——
`Rank her against the rest of the team.` / `He is our weakest link.` /
`Grade each report A through F.` / `Her ownership score dropped to 3.`
已补进 `redline.py` 并配**两头都钉**的回归测试（6 句必须硬拦 + 8 句必须仍然通过）。
🔴 ADR-0016 的不对称守住了：公司/工作产物的量化（`our audit score was 9/10`）仍然全部通过。

## 🔴 这一棒学到的两条（下次写门前先看）

1. **一把太宽的尺子可以让一条正确的判据对着真违规全绿。**
   新门的 ④「引文仍是中文」第一版用的是宽口径 CJK 正则（含全角标点）。born-red 探针把
   evidence 里的汉字全翻成英文之后，句子里剩下的那个**全角逗号**照样让判据通过——
   屏幕上摆着的「文档原文」已经一个字都不是原文了，门却说验过了。
   收紧成两把尺子（壳残留用宽 CJK，必须逮得住全角冒号；引文用只认汉字的 HAN），
   并把主判据换成**「每行引文逐字出自上传语料」**——"两遍逐字相同"只逮得住"只在英文界面翻"
   这一种写法，一个对两种语言都生效的翻译会让两边仍然相等。
2. **自证判据这一轮兑现了两次，两次都是"判据够不着"。**
   ① advise 留在 home 屏问，而判读卡只在 room 屏渲染 → `.report-section-label` 采样为空，
   `[].every()` 恒真、永远绿；② 只展开第一张决策卡 → 采样面从 19 行缩到 4 行，
   覆盖面缩水而不会有任何提示。两次都是自证判据先红，主判据一次都没吭声。
   同一件事在后端也发生了一次：`test_locale_contract` 里两处取错了响应键，取到空串，
   靠"先断非空"那一句拦住——否则那条会是 `'' == ''`。

## What's Next（按优先级）

1. ~~真 brain 的 `/advise` 生产端到端~~ ✅ **2026-08-05 已验**（Danny 拍板批 10 次上限，实耗 1 次）：
   `locale:"zh"` 打生产 `/advise`，200 / 77.7s；summary、recommended_actions、detected_signals、
   conversation_script 全中文，evidence/cites 保持英文原文（契约「引文永不翻译」同时得证）；
   `contract_ok` · `redline_passed` · `cite_gate_passed` 全真。**真模型听那句话。**
   （备战三亚会议 session 顺手取证，产物在该 session scratchpad `advise_zh.json`。）
2. **r2 剩下的未开票发现**（`.issues/sweep/2026-08-02-r2.md`，按屏分好了）。
3. **gate-run 迁移继续**：`verify-aria-zh` / `verify-cr-alignment` 仍未迁（形状不兼容，
   要先扩 makeRec）。**已迁/未迁一律用自查命令数，别抄数字。**
4. **files-hub 独立票 #26–#29** · 换血抢救票 #31/#32 · v01 退役成本账 #33（ready-for-human）。
5. **UI 线**：🔴 真机零覆盖（iOS Safari / 微信内置）优先级最高；断点动物园；像素基线 tracked 与否未拍板。
6. **成本票 #30**（CRUD 50 秒）：Danny 已拍板等真实客户量再立，只记数。
7. **真 brain 分流取证**：要真花钱，需要先给口径（上限几次调用/打 demo 克隆还是真 context/超了就停）。
   语言指令一段已于 2026-08-05 生产取证（见上第 1 条）；分流取证本身仍未跑。

## Blockers / Risks

- 无硬 blocker。前后端已同批上生产并各自核到产物层。
- 🔴 **`pkill -f "uvicorn service.app"` 在本机 Git Bash 下不生效，而且不报错。**
  本轮改完后端重启了一次，`ps` 只看到一个 python、日志也在正常收请求，跑门却仍拿到旧行为——
  排查了半天才发现旧进程根本没被杀掉。判断方法（比看 ps 靠谱）：发一个非法 locale，
  看日志里有没有 `unsupported locale` 那条 warning。可靠杀法：
  `Get-CimInstance Win32_Process -Filter "Name='python.exe'" | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }`
- 🔴 **`e535ec9` 的 commit message 是错的**（装 nudge 的代码、挂 lint 的正文，已 push）。
  改写已 push 历史属人工闸，没自己动；真相记在 `03a9824` 这条 erratum commit。要不要 rebase 归 Danny。
- 六个 worktree 仍挂着，分支停在更早 commit——删分支/worktree 属删除闸，归 Danny。
- A 区上传型门现在是 **9 道**（本轮新增 locale-parity，它一遍跑造 2 个 context）。
  每跑一次 A 区会在 mock 后端造几十个 context；本机 mock 是内存态、进程一停就没。
- ⚠️ `verify-null-owner` 偶发假红（连跑多轮后 `/ingest` 超时）。红了先单独重跑一次再当真。
- ⚠️ **`owns` 编辑框的往返是有损的，而且是老账**（清扫全角标点时顺手量到的，不是本轮引入）：
  拆分侧是 `owns.split(/[,，、]/)`，所以任何**本身含逗号或顿号的 owns 条目**存回去就被劈成几条。
  真语料里就有（`习惯用专题协调会把销售、餐饮、房务与工程…`）。中英两侧一样，与语言无关。
  修它要动数据形状（换分隔符 / 改成多行输入 / 加转义），不是文案题——单开一票。

## 站着别动的事（Danny 人工闸，agent 别代决）

- 凭据轮换；裸「风险：」词表加宽；`origin/p5-04-nexus-safe-zone` 废弃分支处置。
- 法律件三份对外风险（DPA / 隐私件称境内而后端在法兰克福）——归合伙人，工程线不捡。
- 合伙人对外仍讲「不打分不排名」旧口径——Danny 亲自同步（ADR-0025 后果节）。
- 生产库历史数据的任何修复/清理。
