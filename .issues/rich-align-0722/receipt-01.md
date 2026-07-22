# 回执 · issue 01 · 富字段·进度/风险（字段语法全表定稿）

**2026-07-22 AFK 夜跑** · 分支 `claude/layout-real-components-27b594` · push=人工闸（未推）

## 交付

端到端垂直切片「文档→heuristic 抽取→project 实体→payload 投影（缺就不发键）→ projects 屏
风险徽章 + 6px 进度条 + 详情浮层环形进度/风险行」全链真通，富字段走真管道零注入（ADR-0029）。

**字段语法定稿（PRD A2）**：`风险：等级/原因`（高\|中\|低+high\|medium\|low，`/`或`——`分隔，原因可省），
`进度：58%`（0–100，**超界拒收不 clamp**）。实际接受面已回填 `issues/01-field-progress-risk.md`。

## 改动面

- **后端**：`extract.py`（ProjectRisk 类型 + norm_risk_level/parse_risk_value + `风险：` 行首锚定
  arm[长标签优先、`continue` 防英文 blocker 嗅探双吃] + 进度超界拒收 + dedup 合并 risk）·
  `registry.py`（project_cards 投影 risk，缺就不发键、reason 空不发）· `llm_extract.py`（schema
  加 risk + `_llm_risk` 归一 + 进度拒收，两路形状由 ProjectEntity 收口）。
  🔴 红线：`risk/离职风险/流失风险` 仍在 person 禁键表、只对人执法；project.risk 合法不过 person 门。
- **前端**：`transport.ts`（LiveProjectRisk + risk?）· `projectView.ts`（riskLevel/riskReason 派生，
  缺席=null 收起，无 `?? 默认`；projectRiskLabel）· `ProjectsScreen.tsx`（卡面风险徽章）·
  `DetailOverlay.tsx`（ProjectProgressRing SVG56/stroke5 + 风险行，absent 收起）· `lite2.css`
  （6px 圆角轨道 + 她方软底深字徽章令牌 high红/medium橙/low绿 + 环形 + 环形过渡 reduced-motion 隔离）·
  `en.ts`/`zh.ts`（projectsRisk{Label,High,Medium,Low}；zh 手写 draft 待 Danny 审字）。
- **门**：`cr-align-spec.json` stick 6 五行（projects 屏真部件闸）· `verify-cr-alignment.mjs`
  seed 补进度/风险行 · `verify-status-truth.mjs` absent 分支加 progress/risk 删键 + 对照真值卡 ·
  新 `verify-rich-fields-01.mjs`（e2e，tracked，F19）· `run-battery.mjs` CURRENT_STICK 4→6 ·
  新 `test_project_risk_progress_01.py`（11 例）。

## 验收（本片全绿，红先行有据）

| 门 | 结果 | 红先行 |
|---|---|---|
| pytest test_project_risk_progress_01 | 11/11 | ✅ stash 后端改动 → 9/11 红（trivially-true 2 项除外） |
| pytest 波及面（ingest/registry/granularity/llm/header） | 126/0 | 无回归 |
| cr-alignment `SPEC_STICK=6` | 40/40（新 5 行） | ✅ 旧 dist 下 4/5 红（riskBadge/weight/color/track6），rebuild→绿 |
| verify-rich-fields-01（e2e WITH/WITHOUT） | 11/0 | 新门 |
| verify-status-truth（+3 absent 分支） | 30/0 | 无回归（基线 27） |
| verify-contrast-smalltext | 26/0 | 徽章色 AA 未回归 |
| verify-p0 | 41/0 | 缺 progress 不吐 0% |
| verify-zh-purity | 基线 14 持平 | i18n 无新泄漏 |
| 像素 | 净影响 0（stub 空态盖不到富部件） | 见 `reports/pixel-evidence/01/`；home-mobile 先天漂移非本片 |

## 留后 / 交接

- 富部件的像素/几何断言由 cr-align stick6 + e2e 承担（stub 基线是空态盖不到），已存 pixel-evidence/01/。
- zh 4 键手写 draft（风险/高/中/低风险），Danny 晨审顺带审字或下次 M3 directed pass 收编。
- 环形 fill 色暂用 accent（非她方 status-tone 填充）——「tone 填充」结构对齐留待需要时细化。
- CURRENT_STICK=6：默认电池现把 stick≤6 全部硬断言。
