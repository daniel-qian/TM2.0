# 救 15–20 补救计划 — 2026-07-07(Danny 已拍板,ADR-0022)

> 本文件 = 确诊 + grill 决策记录 + S1/S2/S3 施工图。决策正文见
> [ADR-0022](../../docs/adr/0022-story-lite-wall-llm-extraction-machine-acceptance-gate.md);
> 确诊全文与复现证据见 `session-handoff.md`(2026-07-07 收盘版)§2。
> 施工红线:🔴 人卡永不评分/排名/画像/moodPct/capacityPct(类型层+redline 门+前端剥离,不动);
> 不动 rail 回放机器/store 契约(ADR-0013)/camera(ADR-0012)/terminal-stream(ADR-0014);
> 不 re-litigate ADR-0020/0021 战略。

## 0 · grill 决策记录(六岔口,2026-07-07,全部 Danny 亲拍)

| # | 岔口 | 拍板 | 一句话理由 |
|---|---|---|---|
| 1 | 拆 vs 修 vs 折中 | **C 同仓立墙** | mode-gating 已以最佳形态(真 seam)败过一次;硬拆两 app 的真实代价=皇冠组件双维护;同仓+lint 机器边界把"忘了就漏"翻成"漏需违法" |
| 2 | v1 lite 范围 | **3 屏 + 薄详情** | 上传空态 · Your team · The room;点卡开~百行纯 payload 只读浮层,杀死 Unknown project 症状类;地图/Playbooks/多人 Chat/满血 gap = story-only |
| 3 | 抽取引擎 | **LLM 主抽** | 正则在两个官方 seed 上双双拓欻,游戏赢不了;LLM 走 pluggable brain(**现实可用=M3+DeepSeek,claude 仅代码路径无 key**),同一红线门罩住,无 key 退 heuristic |
| 4 | 验收 gate | **双层机器门** | agent 当第一个用户:离线 golden 层 + 集成层(真后端+真 seed+具名断言+浏览器自驱+story 名词黑名单);Danny 只抽查不设闸(守 AFK 记忆) |
| 5 | 未提交改动/分支 | **都提、分支继续** | 真向量 8 文件 → 53e0ef6;前端两修 → 4e90966;补救继续在 feat/live-core-015-018,gate 绿+Danny 验收后才 merge main |
| 6 | 施工顺序 | **Gate 先红 → 双线并行** | 不先立眼睛,墙和抽取的完工又是自说自话;S1 gate(红)+抽取修绿后端 → S2 立墙修绿前端 → S3 合流验收 |

修正记录:brain 口径以 Danny 2026-07-07 亲口纠正为准——**当前只有 M3 + DeepSeek,海外 Claude 不存在**(brain_factory 里 `claude` 是无 key 未验证的代码路径,任何文档/计划不得假设它可用)。

## S1 — Gate 先红 + 后端修绿(= feat-022 + feat-023,一个 AFK session)

**feat-022 seed 端到端 gate(先立,立完必红——这是眼睛):**
- seed 文件拷为 tracked fixtures(源:`D:\teammaster-master\teammaster-master\seed-rag\` 的
  `LogiPulse-Roadmap.pdf` + `PrismDesign_TeamProfile_EN.xlsx`;扩展语料同目录,见 memory `seed-rag-files`)。
- 集成层断言(真起 service、真 POST /ingest):
  - xlsx → 人数 ≥15,具名含 **Lin Qing**(Design Director)与 **Chen Mingyuan**(Founder/CEO);
  - 假人黑名单 = 0:名字 ∉ {No., Case ID, Name, Role, …表头词};
  - pdf → 项目数 ≥2 且标题 ≠ 文件名字串;
  - 人卡零数字字段(红线,复用现有断言);
  - `/advise` 带 context_id 问 "who leads design" → cite 命中 Lin Qing 所在 facts 行(检索质量门,今日实测漏此行);
  - mojibake 门:facts.md 不含 "�"。
- 前端集成断言(真浏览器 agent 自驱,live 模式):上传两 seed → 卡渲染 → 点人卡/项目卡开薄详情 → composer 提问走 askLive(SSE 事件到帧);**全程 DOM 扫 story 专有名词黑名单 = 0**(Venus / Kate / Jason / Smart Shopping Guide / Lin Qing 的 story 卡文案句式)。注意 headless rAF 停摆老坑:断言走 DOM/`transition:none` 旁路(见 feat-014 evidence)。
- 离线层:/ingest 的 golden-payload 回放断言(heuristic 兜底模式),保证无 key 环境 AFK 门仍绿。

**feat-023 LLM 抽取(修绿上面后端断言):**
- `LLMExtractor` 实现 `Extractor` 协议:输入带行号的 ParsedDoc 文本 → 一次结构化输出多 Person/Project/Signal,**每实体带来源行号**(cite 链焊死不动);产物过 `redline_extract.validate_extraction` 同一红线门;PersonEntity 类型层无数字字段不变。
- brain:默认 M3(`AVERY_BRAIN=minimax`),DeepSeek 可切;无 key/超时/解析失败 → 自动退 HeuristicExtractor(离线门保绿)。
- pypdf 输出清洗(mojibake/连字);正则抽取器不再修,降级为测试/兜底专用。
- 检索质量:top-k 或加权调整,使 "who leads design" 类查询命中最佳行(gate 断言驱动,不预设实现)。

## S2 — 立墙修绿前端(= feat-024,一个 AFK session)

- 目录重组:`src/story/**`(fixtures/cases/rail/满血场景,冻结)/ `src/lite/**` / `src/shared/**`(卡片/字体/CSS 原子;global.css 需相应拆分)。
- ESLint `no-restricted-imports`:lite → story 红灯(机器闸)。
- lite 3 屏:上传空态(左脊柱不再渲染 scripted 占位——live 空态自己的引导文案)· Your team(briefing 真数顶栏+人卡/项目卡+弱 handoffs)· The room 薄建(live SSE 控制台+8 字段卡,不搬剧场 NexusScene)。
- 薄详情浮层:纯 live payload(名字/角色/owns/来源文件),零 fixtures。
- composer 接 `askLive`(live 下预填/引用也换 live 语料);`HOME_CLOSING`/`HOME_COPY` 等 story 文案出 lite。
- **story 回归门仍绿**(rail 26 拍 DOM 断言,已有基建);story 资产 URL/构建不变。
- i18n:lite 壳新 EN copy agent 直接定稿(act-first);ZH 走 M3(memory `chinese-copy-via-m3`)。

## S3 — 合流验收

- 全 gate 绿(离线+集成+story 回归)→ AFK 报告(截图/录屏/断言输出)→ Danny 抽查 → merge `feat/live-core-015-018` → main。此前 main(2f76ceb)一动不动。
- merge 后旧账重看:feat-018 部署配置在墙后复验(双入口构建);feat-019 酒店包插 lite Playbooks 屏(v2)。

## 已知坑(施工前必读)

- headless 预览 rAF 停摆:framer 动画/场景飞转不可机测,断言全走 DOM + `transition:none` 旁路;动画手感归真机(feat-014 evidence)。
- 顶栏 `.prototype-topbar` pointer-events:none 模式:新增可点子元素必须各自 `pointer-events:auto`(4e90966 教训)。
- vitest/pytest 双栈:前端集成断言起真后端时注意端口冲突(8137)与进程清理(07-05 曾留残留 uvicorn)。
- `eval-harness/.env` 真 key gitignored,不进 commit;gate 的带 key 层在本机跑,离线层保 CI。
