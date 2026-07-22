# 11 · 收官

## What to build

战役收口，不写新功能（只修门发现的回归）：全电池两轮零红 + 扫雷 0/0 + spec 全量 + 对照板重拍 + 像素目检重冻（人审闸）+ acceptance-1.md（新战役验收表单，HITL 逐屏看点）+ handoff。push 不在本片（人工闸，攒满分支等 Danny）。

引用 PRD User Stories：18（并排观感当量的最终实证在对照板）、24/26（诚实边界终检：薄文档收起+「实时数据缺位」标注仍在）。

## 字段/接口决策

无新 schema/端点。产出物两份：
- **acceptance-1.md**（本目录）：逐屏 HITL 看点（team 目录两形态与开关两世界 / projects 富卡+详情浮层操作 / playbooks 网格与空态 / 冲突提示 / 重新开始闭环 / 登录隔离线）+ **pixel-evidence 索引**（各片 diff png+目检结论，Danny 晨审签认口径见 runbook §1），并含 PRD Further Notes 的**拍板复核项**：①「重新开始」全清含语言/观感（照共识「清 lite2:\*」原文执行，要保留偏好属改共识不属改实现）；②人身数字「抽取恒存自述槽、投影随开关」设计（母本不随开关重铸的代价=库里恒有自述数据，红线依赖投影层执法）；③开关默认态=关；④文档通道不对称（CRUD 手填硬 422 vs 自述行作者身份不可验证，口径措辞已改系统可自证式——PRD A3）；另加「承诺脚注原样在」复核项（footerText/visionSummary3 两处）。
- **handoff 更新**：战役进度、生产部署提醒（seed 换三亚 pack 后首次 claim 为 LLM 铸造分钟级→部署后手动 claim 暖场一次）、像素基线 untracked 同机有效说明、push 待 Danny。

## Acceptance criteria

机器可验：
- [ ] 全电池以 **run-battery.mjs 为唯一权威名单（A 19 / B 3 / C 3 = 25 门）**：`SPEC_STICK=99 node eval-harness/tools/run-battery.mjs` **连续两轮零红（含像素门）**；C 区殿后+跑完重建 dev dist（runner 自动）；电池独占（绝不与 subagent 并发）。
- [ ] verify-cr-alignment **全量**（不带 SPEC_STICK，含本战役新增 stick 6–12 全部行）绿。
- [ ] 扫雷正式跑 NEW=0 / 回归 0（台账 ui-sweep-triage.json 清账）+ `--selftest` 8 PASS 硬门。
- [ ] 对照板重拍（拍法钉死）：`VERIFY_BASE=… CR_BASE=http://localhost:3100 node eval-harness/tools/capture-align-board.mjs` → 满态并排以开关**开**（带口径出处角标）拍一版 + 关世界再拍一版，**两版都入 reports**（真 uploadFiles 喂种子，别改回 stub）；像素基线维持关世界。
- [ ] T9 两世界终检探针：三亚一键 claim → 满态全字段断言（16 人/6 项目/里程碑/风险/SOP 卡真渲染、聚卡数对）；薄文档（1-2 份真客户样例）→ 诚实降级断言（收起+extraction_mode 标签）。
- [ ] 像素门全量（runbook §1 统一口径）：各片已片内目检 diff→存证 `eval-harness/reports/pixel-evidence/<片号>/`→备份旧基线（.bak/）→重冻→片内复绿；本片只验收官全量两轮含像素门零红；home-mobile 07-21 冻结的先天漂移不误判为回归。
- [ ] 终检承诺脚注断言：footerText 含「不能只拿它当依据」、visionSummary3 含「不会成为人事决策的唯一依据」。

需人眼（人工闸）：
- [ ] Danny 晨审签认像素证据：acceptance-1.md 附 pixel-evidence 索引（各片 diff png+目检结论），签认即人工闸（重冻已在各片片内完成，人工闸移到此处；push 人工闸不动）。
- [ ] acceptance-1.md 表单 Danny HITL 逐屏走一遍（含拍板复核项①②③④签认 + 「承诺脚注原样在」复核项）。
- [ ] push 上产（Vercel 自动部署）由 Danny 执行；push 后生产手动 claim 暖场。

## 波及面与红线

波及=全部门（run-battery.mjs 全 25 门：A 19+B 3+C 3，另扫雷+AFK 门）。红线（runbook §1/§2）：电池纪律一字不改（独占/三段序/C 殿后+重建 dist/统一前缀，名单以 run-battery.mjs 为准）；push=人工闸；像素统一口径=片内目检存证后重冻、Danny 晨审签认 pixel-evidence（runbook §1）；spec 全量禁反向抄构建值；锁词终扫（user-facing 无 Nexus/现实差距）。

陷阱（runbook §3）：8137 常驻旧码——终验前确认后端进程是最新码；两轮之间不要动码，动了重新计轮。

## Blocked by

01、02、03、04、05、06、07、08、09、10（全部）
