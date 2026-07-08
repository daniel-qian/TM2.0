# Session Handoff — 2026-07-08 S2 收盘(feat-024 立墙 done,三门全绿)

> **接续只靠本文件 + git,不回放聊天。** 上一版(07-07 S1 收盘版)存档于 git:
> `git show 4956824:session-handoff.md`;更早各版见其头注。
> 本 session 按 ADR-0022 执行 S2:**同仓立墙 + lite 3 屏,把 feat-022 前端断言修绿**。全程机器证据,无自报。

## 0 · 一句话现状
**S2 完成**:feat-024 done——`src/{story,lite,shared}` 三区墙立起、ESLint 机器闸红灯实证(违规=exit 1)、lite 3 屏(上传空态/Your team/The room 薄建)+ 薄详情浮层落地。**三门全绿**:前端门 verdict 六相位 `pass:true`(含 S2 新立的 askLive 动态断言 F2)、story 回归 29 步/26 拍零失败、后端 `pytest eval-harness -q` 195 passed 零牵连。动态断言首跑抓到 **transport SSE CRLF 分帧致命 bug**(潜伏自 feat-017,零帧渲染)并修掉。main(2f76ceb)未动,S3 合流。

## 1 · 本 session 干了什么(时间序)
1. 基线:init.sh 绿 + pytest **196 passed**(190 离线+6 seedgate,~8 分钟)。
2. **立墙**(commit `b133210`):global.css 按行界拆 10 chunk(shared 5/story 4/lite 1,main.tsx 按原序 import,**串联逐字节等原**——cascade 零漂移,52ecfb5 教训的解法);components/data/lib/store 四棵子树整树平移进 `src/story/`(story 内部 import 零改动);i18n+mode→`src/shared/`;live seam→`src/lite/`(类型全 lite 本地,零 story import);story HomeScene/NexusScene 剥 live 分支(story 壳只在 story mode 挂载,DOM 逐拍验证不变);新 `shared/modeStore`(?mode= 语义=两个壳,App.tsx 唯一合成根)。
3. **lite 壳**(同 commit):TeamScreen(空态 live 自己的引导文案/上传后 briefing 真数顶栏+人卡+项目卡+弱 handoffs)、RoomScreen(SSE 控制台+8 字段 LiteAdviceCard,薄建)、DetailOverlay(只读纯 payload,杀 "Unknown teammate")、LiteComposer(预填空/@ 引用 live 语料/提交 askLive→room)。EN copy act-first 定稿,zh.ts M3 再生 5/5。
4. **机器闸**(同 commit):eslint no-restricted-imports 三向墙 + noInlineConfig(行内 disable 失效),挂 init.sh;红灯实证 exit 1/exit 0。
5. **门升级**:snippet 补 `composerAskLive` 相位 F2(SSE 事件到帧),verdict composerIsLive=静态且动态。
6. **门实跑(5 轮到全绿)**:F2 首跑抓到 snippet 选择器 bug(`input[type="text"]` 匹配不到无 type 属性 input)+ **transport.ts SSE 分帧 bug**(只找 `\n\n`,sse-starlette 发 CRLF,`od -c` 实证——零帧)。两修后:**verdict 六相位全绿**(30 人卡/18 帧 SSE 到 DOM/manifest/8 字段卡)。
7. **story 回归**:29 步键盘驱动 DOM 断言 `pass:true, 26/26, failures:[]`(第一轮唯一红=断言自身大小写口径撞 text-transform:uppercase,拨回 idx16 实证 DOM 正确后修断言重跑全绿)。
8. **后端复证**:pytest 全量 **195 passed, 1 skipped**(skip=契约防漂移测试因 fixtures.ts 移居路径失效,非行为回归,见 §3)。收盘 docs(本 commit)。

## 2 · 交付物与证据(全 verified,原文在 feature_list feat-024 evidence + progress.md)
- **前端门 verdict**:`{"pass":true,"phases":{"emptyStateClean":true,"ingested":true,"teamRendered":true,"postUploadClean":true,"detailIsLive":true,"composerIsLive":true}}`——A 渗漏 7→0、C 30 卡含 Lin Qing/Chen Mingyuan 零血条、E 零 Unknown、F2 18 帧+manifest+卡。
- **story 回归**:`{"pass":true,"totalSteps":29,"beatTotalOk":true,"failures":[]}`;sprite 资产哈希不变。
- **后端**:195 passed(=189 离线+6 seedgate)474.94s。**init.sh 绿**(lint+tsc+build 459 模块)+ 双 target smoke 3/3。
- **墙**:`npm run lint`——违规 import exit 1(报错带 ADR-0022 口径),干净 exit 0。
- **修掉的真 bug**:① `src/lite/transport.ts` SSE 记录切分 `/\r?\n\r?\n/`(原 `indexOf('\n\n')` 对 CRLF 分帧零命中——**live 提问永远零帧**,S1 只立静态检查从未暴露);② composer input 显式 type + snippet 选择器 `.composer-main-row input`;③ snippet ingest settle 等待预算 180→360s(真 LLM ingest ~200s+隐藏 tab 节流 tick 粒度;断言本体未动)。

## 3 · 本 session 学到的坑(下 session 别再踩)
- **隐藏 preview tab 定时器节流**:`document.hidden=true` 时 Chrome 把链式 setTimeout 压到 ~1 次/分钟——snippet 内部轮询每 tick 可达 60s,rail 回归 29 步要 ~12 分钟。等待预算按"真实包络+60s tick 粒度"配;外部判进度用 uvicorn 日志 watcher,别干等页面。已记 live-frontend-gate.md 已知坑。
- **DOM 断言要按渲染态写**:`.home-handoff-tone` 有 `text-transform:uppercase`,innerText 返回 "CAUGHT AND SETTLED"——大小写敏感的 includes 必假红。回归断言一律 `/…/i`。
- **`input[type="text"]` 选择器匹配不到无显式 type 属性的 input**(默认 type 不等于属性存在)——门自身的检查也要防静默空转(F1 曾恒绿但拿的是空 prefill)。
- **SSE 契约要拿真字节核**(S1 §3 教训的续集):transport 注释自称对齐后端,but 分帧格式从未见过真 CRLF。`od -c` 是终审。
- **preview/vite dev server 会无预警死掉**(跑到第 4 轮时整个掉线):页面态全 ephemeral,协议按"可整轮重跑"设计——所有相位脚本化+幂等,重跑只费钟表时间。
- 本轮 ingest 中红线又拦到 M3 抄评分文本进人字段(`person-score-text:Noah Williams`→整篇退 heuristic,20 卡照样过门)——红线在工作,遇到卡数波动先看 server 日志,别当 flake 盲修。
- **契约防漂移测试会因文件搬家静默 skip**:`test_service_contract.py::test_schema_field_list_matches_frontend_agentoutput` 找 `src/data/fixtures.ts` 不存在→skip(195+1s 的 s)。按"eval-harness 不动"纪律未顺手修——**S3 必办**:重指 `src/story/data/fixtures.ts` + lite 真身 `src/lite/streamSource.ts`(LiteAdvice)。

## 4 · 仓库当前态(精确)
- 分支 `feat/live-core-015-018`,链:…`4956824`(S1 收盘 docs)← `b133210`(feat-024 墙+壳+闸)← 收盘 fixes+docs commit(HEAD,已 push)。`main` = `origin/main` = `2f76ceb` 一动不动,S3 前不 merge。
- 工作树干净;:8137/:5173 已停(8137 的手动 uvicorn 被 seedgate fixture 按设计清掉);`eval-harness/.env` 真 key gitignored 完好;scratchpad(会话外)有 verdict-run5.json/story-regression.js 副本,repo 内不留临时文件。
- feature_list:feat-021/022/023/**024** done(evidence 含断言输出原文与 commit);下一个=S3 合流。
- 新增 devDeps:eslint@10 + @typescript-eslint/parser(package.json/lock 已提交);`npm run lint` 新脚本;init.sh 第一步是墙。

## 5 · 怎么把现状跑起来
- 后端:`AVERY_BRAIN=minimax python -m uvicorn service.app:app --host 127.0.0.1 --port 8137 --app-dir eval-harness`;`GET /health` → `brain:minimax`+`embeddings:dashscope:…`+`extractor:llm:minimax`。
- 前端:`npm run dev` → `:5173/?mode=live` = lite 壳(上传两 seed→30 人卡→点卡浮层→composer 提问→The room 真流);`?mode=story` = 剧场壳(rail 26 拍原样)。
- 门:离线 `python -m pytest eval-harness -q`(带 key 全量 ~8 分钟含集成;无 key 环境集成自动 skip);前端门按 `scripts/gates/live-frontend-gate.md` 协议自驱(注意 §已知坑的节流条目);story 回归驱动器逻辑见 progress.md(29 步键盘断言,可照抄重建)。

## 6 · 下一步(优先级)
1. **S3 = 合流验收**(plan.md §S3):全 gate 绿(已达)→ AFK 报告 → Danny 抽查 → merge `feat/live-core-015-018` → main。merge 前顺手:重指 §3 的 skip 测试(动 eval-harness 的授权在 S3)。
2. merge 后旧账:feat-018 部署配置墙后复验(双入口构建已 smoke 3/3,真部署待 Danny 凭据)、feat-019 酒店包插 lite Playbooks 屏(v2)。

## 7 · 留给 Danny 的 HITL(全部非阻塞)
- S2 报告抽查:本文件 §2 + feature_list feat-024 evidence(verdict/回归/后端数字原文在内)+ progress.md 2026-07-08 节。
- lite 壳新 EN copy 已 act-first 上线、zh 已 M3 再生——事后抽查即可(AGENTS.md 口径)。
- 旧账不变:tm2 promote、真人 eval 评分、合伙人 IP 具名授权、feat-020 合伙人一句话。

## 8 · 锁定上下文指针(S3 开工前读)
- 本次:ADR-0022 · plan.md §S3 · progress.md `## Update — 2026-07-08 · S2` · 本文件 §3 坑清单。
- 🔴 红线(不可谈):人卡永不评分/排名/画像/moodPct/capacityPct——lite 类型层(LitePerson 无数字键)+ stripPersonNumbers 运行时 + redline 三层 + 门 bloodBarLeak 断言。
- standing:不动 rail 回放机器/store 契约(ADR-0013)/camera(ADR-0012)/terminal-stream(ADR-0014);story 资产 URL/构建不变(已验:sprite 哈希全同);中文一律 M3;AFK 先斩后奏,人工闸只留销毁/对外/花钱/凭据(AGENTS.md)。
- 已知坑:本文件 §3 全部 + S1 版 §3(git show 4956824:session-handoff.md)仍全部有效。
