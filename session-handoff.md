# Session Handoff — 2026-07-09 S3 收盘(救援线 merge main;下一波 = lite 打磨 S4/S5/S6)

> **接续只靠本文件 + git,不回放聊天。** 上一版(07-08 S2 收盘版)见 `git show 0723063:session-handoff.md`;S1 版 `git show 4956824:session-handoff.md`。
> ADR-0022 救援线(S1 门红 → S2 立墙前端绿 → S3 合流)**已完结**。本文件主体是下一波(Danny 试玩反馈)的作战交接。

## 0 · 一句话现状
**救援线 closed**:Danny 2026-07-09 亲手试玩通过 → 契约守卫重指墙后双真身(9a4e699)→ **merge main = `1f5a56a`**(--no-ff 里程碑,已 push),merge 后 main 上 init.sh 复绿。三门终态:前端 verdict 六相位 pass:true / story 回归 29 步 failures:[] / pytest 195 passed(守卫复活后 contract 电池 11 passed 0 skipped)。**下一波 = Danny 试玩反馈 7 项**,作战文件在 `.issues/live-polish-0709/`(plan + 3 份 kickoff),S4 串行先跑 → S5 ∥ S6。

## 1 · 仓库当前态(精确)
- `main` = `origin/main` = **`1f5a56a`**(merge commit,含 feat-015..024 全部);当前 checkout 在 main,工作树在本 commit 后仅剩本次收盘 docs(随本 commit 入库)。分支 `feat/live-core-015-018`(HEAD 9a4e699)保留不删,已全部并入。
- :8137/:5173 已停;`eval-harness/.env` 真 key(MINIMAX/DEEPSEEK/DASHSCOPE)gitignored 完好,不进 commit。
- feature_list:feat-021/022/023/024 done(evidence 含全部断言原文);**feat-025(lite 模块补齐)/feat-026(定位叙事+能力边界 mock)已登记 not-started**;feat-019 仍 in_progress(酒店包,等墙后 v2)。
- 门基建(下一波每个 session 都要用):`scripts/gates/live-frontend-gate.{md,snippet.js}`(六相位+F2 动态断言,含隐藏 tab 节流坑说明)· story 回归 29 步驱动器逻辑记录在 progress.md 2026-07-08 节(键盘通道+DOM 轮询,可照抄重建)· init.sh 第一步 = 墙 lint(违规 import = exit 1)。

## 2 · 下一波:Danny 试玩反馈(2026-07-09)与 session 划分
**反馈原话、考古入口、参考资料路径、划分理由——全部在 `.issues/live-polish-0709/plan.md`,那是单一事实源。** 摘要:

| 反馈 | 处置 |
|---|---|
| 1 Playbooks 没了(至少空态) · 2 team map 没了 · 3 room 画板(拖拽/缩放)没了 | **S4 先考古**:是 ADR-0022 v1 拍板排除(repo 证据初步指向 plan.md 岔口 2 "地图/Playbooks/多人 Chat = story-only")还是遗漏?出实证结论+方案选项 → Danny 拍板 → **S5(feat-025)按拍板补齐** |
| 4/5 两张 UI bug 截图(`D:\Screenshot\首页UI bug.png`、`按钮风格丢失.png`) | **S4 顺手即修**(act-first;优先怀疑 CSS 拆 chunk 后的 cascade 断差) |
| 6 定位说明(lite=融资展示品,未来=custom agent 服务:接公司数据+安全私有部署) · 7 能力边界 mock(agent file system/定制 skills/tools/SOP/后台批量 loop——可先 mock,须诚实标注) | **S6(feat-026)**,参考资料 4 篇路径在 plan.md §2,与 S5 并行(worktree) |

- kickoff 三份:`.issues/live-polish-0709/kickoff-s{4,5,6}.md`——每份自含(读什么/干什么/门是什么/边界在哪),直接贴给新 session 即可。
- **顺序**:S4 必须先跑(它产出 Danny 的拍板问题清单);S5 依赖拍板;S6 不依赖,可与 S5 并行(worktree,交集只在 LiteTopbar/LiteApp,per-line handoff 按 AGENTS.md)。
- **每个 session 的完工门一致**:新表面断言先进 snippet(必红)→ 修绿;前端门六相位 + story 回归 + init.sh + 离线 pytest 全绿才算 done。

## 3 · 坑清单(累积有效,新 session 必读)
- S2 版 §3 全部仍有效(`git show 0723063:session-handoff.md`):隐藏 tab 定时器节流(等待预算=真实包络+60s tick)/ DOM 断言按渲染态写(text-transform → 一律 /i)/ `input[type="text"]` 匹配不到无 type 属性 input / SSE 契约拿真字节核(od -c 终审)/ dev server 会无预警死,协议要可整轮重跑 / 红线拦截造成的卡数波动不是 flake(看 server 日志)。
- S1 版 §3 仍有效(`git show 4956824:session-handoff.md`):M3 reasoning 截断 / provider 显式 timeout / GBK 控制台假 mojibake / autocrlf 毁二进制 / 黑名单口径(四个复用名、New Retail、裸 Wang 不入黑)。
- 本次新增:**文件搬家会让路径型测试静默 skip**——收盘看 pytest 输出里的 `s` 不是仪式,是真门(S2 抓到 1 个,S3 修了);**跨 story/lite 的守卫要看住两个真身**(contract 测试现在同时查 fixtures.ts 和 streamSource.ts,新增渲染契约时记得扩它)。

## 4 · 怎么把现状跑起来(试玩/验收同款)
- 后端:`AVERY_BRAIN=minimax python -m uvicorn service.app:app --host 127.0.0.1 --port 8137 --app-dir eval-harness`;`GET /health` → brain:minimax + embeddings:dashscope + extractor:llm:minimax。
- 前端:`npm run dev` → `:5173/?mode=live`(lite:上传 `eval-harness/tests/fixtures/seed/` 两文件→2-4 分钟→人卡→详情→提问 1-2 分钟出卡);`?mode=story`(剧场,rail 26 拍)。
- 门:离线 `python -m pytest eval-harness -q -m "not seedgate"`(~1 分钟);带 key 全量(~8 分钟);前端门按 gate .md 协议。

## 5 · 留给 Danny 的 HITL
- **阻塞 S5 的唯一一件**:S4 收盘后拍板 1/2/3 的补齐范围(每项:空态/轻建/移植)。
- 非阻塞:S2/S3 报告抽查;lite EN/ZH copy 抽查;旧账不变(tm2 promote、真人 eval 评分、合伙人 IP 授权、feat-020 合伙人一句话、feat-018 真部署凭据)。

## 6 · 锁定上下文指针
- 下一波:`.issues/live-polish-0709/plan.md`(单一事实源)+ 对应 kickoff。
- 🔴 红线(不可谈):人卡永不评分/排名/画像/moodPct/capacityPct——**mock 数据同样成立**(feat-026 特别注意);三层机制+门断言不动。
- standing:墙不打洞(lite↔story 互不 import,共用走 shared);story 行为/资产/rail 机器(ADR-0003/0006/0012/0013/0014)不动;中文一律 M3;AFK 先斩后奏,人工闸只留销毁/对外/花钱/凭据;任何 lite 表面 done 判定必须含集成层证据(ADR-0022 后果)。
