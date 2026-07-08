# Session Handoff — 2026-07-09 · lite 打磨波(S4+S5+S6)收盘

> **接续只靠本文件 + git,不回放聊天。** 上一版(07-09 S3 收盘 = 救援线 merge)见 `git show 9dbccf5:session-handoff.md`;更早 S2/S1 见其内指针。
> 本波 = Danny 2026-07-09 试玩反馈 7 项的落地(S4 考古+bug 修 / S5 模块补齐 / S6 定位叙事+能力 mock)。ADR-0022 救援线已于 S3 closed;本波是其上的产品打磨,红线与 standing 约束一字未动。

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
