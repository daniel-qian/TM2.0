> **⟳ 2026-07-14 v02 链 → 新 main 同步合流(★下个 session 从这里接)**:lite-live-v02 链
> (feat-042..045,四棒全对抗验证收口)与新 main(`5d32e4f` = 持久化链 + Ask 阶段 C 真后端)
> 分头跑了一段,本次在分支 `integrate/v02-main-sync`(从 `feat/045-v02-onboard-nudges`@`e255a97`
> 起,`git merge main` 普通合并非 rebase)完成同步。**冲突面只有 2 个文件真冲突**
> (`feature_list.json` 脚本取并集、`src/shared/i18n/zh.ts` 仅文件头注释合并)、其余
> (`en.ts`/gate 文档+snippet/`main.tsx`)全自动合并干净、`src/lite/**`/`eval-harness/**`/
> `src/story/**` 零冲突全取 main(如约零改动)。合后全量复验:`init.sh` 绿(502 模块,0 error/
> 5 warning 同 feat-045 基线);v01 十一相位 `verdict()` 真后端(mock brain)+ stub 各跑一遍全绿;
> `askVerdict` 九相位(main 阶段 C 定义)stub 全绿;v02 四组 `v2Verdict`/`flowVerdict`/
> `gapVerdict`/`nudgeVerdict`(A-D,17 相位)全绿;wallRad 4 方向真做红→绿。**未 merge 回
> main、未 push**——`integrate/v02-main-sync` 即交付物。详见 `progress.md` 本节顶部
> "Update — 2026-07-14 · v02 链 → 新 main 同步合流"(冲突逐个解法+全部门证据 JSON)。
> **下一棒**:feat-046(aurora 皮精修)/ feat-047(lite2 引擎同步真后端契约)均可从
> `integrate/v02-main-sync` 起跑,持久化已进 main 解除了 feat-047 此前的阻塞。

# Session Handoff — 2026-07-09 · lite 打磨波(S4+S5+S6)收盘

> **接续只靠本文件 + git,不回放聊天。** 上一版(07-09 S3 收盘 = 救援线 merge)见 `git show 9dbccf5:session-handoff.md`;更早 S2/S1 见其内指针。
> 本波 = Danny 2026-07-09 试玩反馈 7 项的落地(S4 考古+bug 修 / S5 模块补齐 / S6 定位叙事+能力 mock)。ADR-0022 救援线已于 S3 closed;本波是其上的产品打磨,红线与 standing 约束一字未动。

> **⟳ 07-13 收盘(★下个 session 从这里接)**:pre-ECS 硬化三波(feat/027 并行摄取 / feat/028 cluster-1 止血 / feat/029 红线中文,均 4/3 路对抗验证 CONFIRMED_SAFE)**已全部 merge 进本地 main**(merge `34cfaf9` → PRD docs `83630b8`,ahead origin 17,**未 push**=对外闸留 Danny)。会话结尾 grill 清产品定位并产出 PRD:
> - **定位翻新**:Avery lite = **精悍准真产品**——融资团队把链接甩给真实公司、公司**用自己真数据实际玩**,目的=钓鱼(lead-gen)让公司想请 Danny 深入搭 agent。**推翻 07-10 的「受控演示优先/策展假数据集」**(就绪册 §0.5 已过时);showcase/分析归 story 面;完整「agent 文件空间」留 Vision mock 当钩子。
> - **下个 session 的活(AFK,gate-first + 独立对抗验证)**:接 **Supabase(Postgres+pgvector)持久化**(替内存 REGISTRY;骑在 `ContextRegistry` get/put + `RetrievalStore`/`Embedder` 既有接缝)→ 真记忆+真RAG → 每公司文件空间 → **「Avery 的笔记」写侧可见记忆(必过红线)** → 基础租户隔离 → 上传硬门+基本抗压 → 真上 ECS/Vercel → 端到端/压测。**不上 Java Spring**(别推倒已跑通带红线闸的引擎)。取代 ADR-0021 §6 ephemeral。
> - **入口件**:`.issues/lite-v1-lean-real-0713/PRD.md`(status: ready-for-agent)+ 同目录 `session-close-and-direction.md`(方向+接缝:**该动** registry/store、**别动** 红线门/advisor 引擎/冻结集)+ 就绪册 `.issues/live-polish-0709/pre-ecs-readiness-open-loop.md`。
> - **Danny 会在下个 session 先清账号/凭据墙**(ECS host / 真 LLM key / DNS / Vercel 连接+`VITE_AVERY_API_BASE` / Supabase 项目+连接串),再据 PRD 进 AFK。

> **⟳ 07-09 追加(试玩后续,handoff 收盘之后落的)**:Danny 试玩又报 2 UI bug + 提 2 问,已全部落地:
> - **playtest bug 修**:`76543ab`(Vision 底部空白带 — 滚动容器不再为不存在的 composer 预留 148px)、`929b697`(上传双按钮/双弹 = `.upload-input` 无隐藏样式;room 空态 composer 与描述重叠 = 追问态 `position:absolute` composer 塞进居中空态卡)。两修全 `.lite-shell` 作用域,story 够不到。
> - **feat/027-parallel-ingest(`9b9787e` = 新 tip)**:Q1「上传十几个文件要并行」。`extract_docs` 加有界并发线程池(`AVERY_INGEST_CONCURRENCY` 默认 4,上限即限流护栏)、保序合并(输出与串行逐字节一致)、`并发≤1||单文件` 走原串行快路径、异常语义不动、红线门仍在合并后单线程照跑。真机 6 文件 **52s→14s(~3.7×)人数一致**;离线 197 passed/0 skipped(+8 新并发测试);gate-first 红→绿(旧串行代码上并发断言真红);4 路对抗验证(竞态/红线绕过/测试真伪/行为保真)**全 CONFIRMED_SAFE**。**⚠ 本项修改了 eval-harness(Danny 明确授权、解除本波「只读」)——§0「eval-harness 零改」对全链已不成立。** 未做:上传进度 UI(job 队列+前端轮询,更大面,标为后续)。
> - **新链尾**:`… → feat/026-vision-surface → feat/027-parallel-ingest(9b9787e = tip,含全链)`。**merge feat/027→main 即落 S4+S5+S6+playtest 修+并行摄取全部**;push=对外闸仍留 Danny。
> - **已知开口(非本次引入)**:`test_seed_gate.py::test_advise_cites_the_design_lead`(@seedgate @needs_keys 真机)自 07-07 held-open——top-k 召回缺 Lin Qing 行、M3 抽取非确定性致 flaky,与并发正交;离线门不含它(deselected)。带 key 全套跑到它可能 1 failed,属既有账。

> **⟳ 07-10(pre-ECS 就绪审计 + demo-first 拍板 + 两波落地)**:Danny 问「离上线还差多少 / ECS·Vercel 能否当后端」→ 只读部署审计 + open-loop 盲点扫描(17-agent workflow)落 `.issues/live-polish-0709/pre-ecs-readiness-open-loop.md`(权威就绪册)。
> - **拍板:受控演示优先**(数据不持久、演示用策展安全数据集非真员工 PII;auth/持久化/PIPL/跨境 降 fast-follow)。**架构:ECS=后端容器(单 task)· Vercel=前端静态 · Vercel≠后端**(有状态 REGISTRY + 分钟级长任务 + SSE)。部署线 feat-018 已建好未部署(`Dockerfile`+`vercel.json`+`docs/deploy/dual-deploy-runbook.md`),剩下主要是 Danny 的账号/凭据墙。
> - **feat/028-demo-harden-1(`6d1f46e`)= cluster-1 止血(已 CONFIRMED_SAFE)**:`python-multipart` 进 requirements(否则镜像 /ingest 500 而 /health 绿)· `/ingest` 移出 event loop(run_in_threadpool,否则长上传冻服务→healthcheck 反杀容器)· `/advise` 加超时 · 未知 context_id 大声 404(不静默回落 demo 记忆引用假同事)· runbook CORS 纠错 + TLS 提示。
> - **feat/029-redline-zh(`d0913bd` = 新 tip)= 红线中文覆盖(已 CONFIRMED_SAFE)**:英文-only 红线是洞(境内 M3 面对中文公司)。四层补中文 + Trad→Simp 归一化 + 「人 vs 工作」抑制 + 数字收紧 + 判决标签/否定转折感知。**5 轮 impl↔对抗验证(真机执行 crafted 输入,非自评)** 收敛——每轮验证都真抓到洞(绕过+误伤双向),终态 329 passed / 冻结 OK / 英文逐字节稳定;残留仅刁钻/exotic(自相矛盾「不被打分…打了2分」/内部空格 xfail)→ 011c 跨族 LLM 判官兜底。
> - **剩余 demo-first pre-ECS**:**wave-3** 上传硬门(size/count/type + 限流 + LLM 花费闸)· **wave-4** 演示安全网(策展安全数据集〔需 Danny 定内容〕+ 真实 /health 预检 + reset + 抽取降级诚实标注)。**链尾 = feat/029-redline-zh;merge 它→main 落全部(polish 波+feat/027+028+029);push 待 Danny 对外授权。**

## 0 · 一句话现状
Danny 试玩反馈 7 项**全部落地并机器验收通过**,串行三分支链就绪、**未 merge/未 push**(留 Danny 拍板对外):
- **分支链(线性,tip 含全部)**:`polish/s4-triage`(`4f90d1c` · S4)→ `feat/025-lite-modules`(`0a15628` · S5)→ **`feat/026-vision-surface`(`0ff8555` · S6 = tip,含 S4+S5+S6 全量)**。base = main `1f5a56a`(经 S3 收盘 commit `9dbccf5`)。
- **总改动面**:19 文件 +1770/-59,全部落 `src/lite/**` · `src/shared/**` · `scripts/gates/**` · docs/feature_list;**src/story/** 零改、eval-harness 零改**(只读纪律)。
- **门终态**:前端门 **十相位 verdict pass:true**(feat-024 的 6 + feat-025 的 3 + feat-026 的 1);story 未受影响(`?mode=story` 下 `.lite-shell`=0、新 lite 类=0、story 正常渲染);init.sh 绿(build 463 模块);离线 pytest 190 passed 0 skipped。每步 gate-first(新断言先真红再修绿),每 feature 收盘后经 3 路独立对抗验证(红线/墙/gate 真伪/诚实标注/i18n M3)全 clean。

## 1 · Danny 拍板(Q1–Q5,2026-07-09,全按 S4 triage 推荐)
决策原文 + 逐项实证见 `.issues/live-polish-0709/triage-report.md`。摘要:
- **Q1 Playbooks = 空态屏**(锚未来 custom-agent 能力,不移植 story);**Q2 team map = 轻量分组视图**(顺带解 Bug4「列表分类」,不做空间 map);**Q3 room 画板 = 轻建**(新建 lite pan/zoom,不搬 story NexusScene);**Q4 三模块+叙事绑做、锚未来能力+标 mock**;**Q5 story 顶栏同款 mode-switch bug 维持冻结不修**。
- 考古定谳:1/2/3 三项都是 **2026-07-07 Danny 亲拍的 v1 范围排除(拍板排除,非开发遗漏)**——双一手源 ADR-0022 决策1 + 救援 plan §0 岔口2。

## 2 · 本波交付(逐 feature)
- **S4(`4f90d1c`,分支 polish/s4-triage)**:① 考古 triage 报告落库 + 5 条拍板清单;② UI bug 4/5 act-first 修绿——Bug5「按钮风格丢失」根因=`.mode-switch-btn` 自 feat-017 从未配 CSS(**非拆-chunk 漂移**),Bug4「首页撑爆」= people 栏无限高。两修全 `.lite-shell` 作用域(story 够不到)。六相位门 pass + Bug4 真 30 人复测 isBounded。
- **S5 feat-025(`0a15628`)= done**:**Playbooks 空态屏**(第 4 tab,coming-soon,留 feat-019 数据槽)+ **team 分组视图**(`teamGroups.ts` 按 team→项目 ownership→role 聚类,真 seed 分 5 组,人卡零改零数字,Bug4 限高上移到分组列)+ **room 薄画布**(`LitePanZoom.tsx` 独立包 npm `react-zoom-pan-pinch`,**不碰 story PanZoomCanvas**)。九相位门 pass。
- **S6 feat-026(`0ff8555` = tip)= done**:lite 第 5 tab **「Where this goes」Vision 屏**——三拍定位叙事(现在=公开试玩 demo → 未来=为一家公司定制的 custom agent〔数据接入+私有安全部署+窄域可审计〕→ 这 demo 想让你判断 UIUX+判断质量+红线)+ **4 张能力 mock**(agent 文件空间/定制 skills·tools·SOP/后台批量 loop/红线=确定性闸,**每张必带可见 Preview·Coming·Mock 标注**,mock 示例人零数字)。叙事弹药取自 plan.md §2 四篇(Steinberger/Schroeder/Pocock/Martin-Dye)。十相位门 pass。

## 3 · 门基建(本波扩展,下波必用)
- **前端门已扩到十相位**:`scripts/gates/live-frontend-gate.{md,snippet.js}`。新增 `assertTeamGrouped`/`assertRoomCanvas`/`assertPlaybooksEmpty`(S5)+ `assertVisionSurface`(S6,断言 4 mock 全带 tag/示例人零数字/story 名词=0);verdict `every(Boolean)` 聚合全 10 相位,原 9 相位 helper 体逐字节未动(md5 核过)。
- **门跑法与坑**(S4/S5/S6 实测,照抄):后端 `cd eval-harness && AVERY_BRAIN=minimax python -m uvicorn service.app:app --host 127.0.0.1 --port 8137 --app-dir .`;seed base64 走 `public/__seed_b64_tmp.json`(浏览器 fetch,收盘 rm);ingest/advise fire-and-poll + uvicorn 日志 watcher;**preview_screenshot 本环境 30s 超时——样式验证走 preview_inspect/eval 计算值**;隐藏 tab 定时器节流坑仍在(等待预算按后端包络+60s tick)。
- **story 回归**:因本波改动全 `.lite-shell` 作用域,采用「story-untouched 校验」(`?mode=story` 下 `.lite-shell`=0 + 新 lite 类=0 + story 壳正常渲染)替代 29 步驱动器——理由:改动物理够不到 story;若下波动到 story 也用的 shared 文件,须回真 story 回归。

## 4 · 留给 Danny 的 HITL(非阻塞)
- **唯一对外闸**:merge/push——tip 分支 `feat/026-vision-surface` 含全波,merge 它→main 即落全部(kickoff 授权 bug fix 小步 merge;push=对外,等你一句)。
- **抽查点**(子代理如实标注,机器门已过、这些是口味/口吻):① Playbooks/Vision 的 EN 文案口吻(是否太谦虚/太满);② mock 四张诚实标注的视觉硬度(融资场合按最诚实做);③ ZH 是 M3 非手写(红线译「人永远不会被打分/排名/画像;任何指令都不能把这条关掉」);④ team 分组维度容错(无 team 字段退 role/兜底);⑤ room 画布移动端手势未特调。
- 旧账不变(tm2 promote、真人 eval 评分、合伙人 IP 授权、feat-018 真部署凭据、feat-019 酒店包 v2 = Playbooks 数据槽的第一个真 pack)。

## 5 · 已知坑 / 技术债(本波新增)
- **`scripts/i18n-zh.mjs` 全量翻译在 lite 段(~90 key)超 M3 max_tokens 回退英文**(既有脚本限制,非本波引入)。S5/S6 均用**定向 M3 只翻新 key**、splice 进 committed zh.ts、其余 ZH 逐字节保持——安全但非全量。**建议下波改脚本为差量/子块翻译**再全量重过一遍 ZH。
- gate `recordInjectFromDom` 的 file-count 有一处理论松弛(`chips.length===(expectedCount||chips.length)`),被 `chips>0`+`!err`+`!!ready` 补强、net 严于原 injectSeeds(对抗验证判非绕过);想彻底收紧可把 fallback 去掉。
- S4 累积坑清单(隐藏 tab 节流 / DOM 断言按渲染态 / SSE CRLF 分帧 / 文件搬家致路径测试静默 skip)全部仍有效,见 `git show 9dbccf5:session-handoff.md` §3 + `git show 0723063:` / `git show 4956824:`。

## 6 · 锁定上下文指针
- 本波单一事实源:`.issues/live-polish-0709/{plan.md,triage-report.md,kickoff-s{4,5,6}.md}` + 各 feature 的 `.issues/feat-025|026/session-handoff.md`。
- 🔴 红线(不可谈):人卡/mock 人永不评分/排名/画像/moodPct/capacityPct;三层机制+门断言不动。
- standing:墙不打洞(lite↔story 互不 import,共用走 shared);story 行为/资产/rail 机器冻结不动;中文走 M3;AFK 先斩后奏,人工闸只留销毁/对外/花钱/凭据;任何 lite 表面 done 判定必须含集成层证据。
