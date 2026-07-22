# 回执 · issue 02 · 富字段·里程碑

**2026-07-22 AFK 夜跑** · 分支 `claude/layout-real-components-27b594` · push=人工闸（未推）

## 交付

里程碑走真管道：`里程碑：` 标签行 + 连续 `- 名称（状态）` 列表行 →（多行解析，空行/下一字段
标签处止）→ 四态归一 done/active/blocked/upcoming + 词表外 **other（statusRaw 原样回显）** →
payload 缺就不发键 → 卡面圆点串 chips + 详情浮层清单 + 分段总览条；缺席整体收起（absent≠none）。

## 改动面

- **后端** `extract.py`：ProjectMilestone 类型 + `_MILESTONE_STATUS_MAP`/norm_milestone_status +
  `milestones_from_lines`（多行收集，`_FIELD_LABEL_STOP` 防吞下一字段）+ ProjectEntity.milestones +
  span 解析 + dedup keep-first。`registry.py`：projection（缺就不发键，statusRaw 仅 other 发）。
  `llm_extract.py`：schema 加 milestones + 改写「里程碑不是独立项目」指令为「归 milestones 字段」
  + `_llm_milestones` 同口径归一。
- **前端** `transport.ts` LiveProjectMilestone · `projectView.ts` MilestoneView 派生 + milestoneStatusLabel
  （other 回显原词）· `ProjectsScreen.tsx` 卡面圆点串 · `DetailOverlay.tsx` 清单 + 分段总览条 ·
  `lite2.css`（点色 ms-* 令牌 done绿/active蓝/blocked红/upcoming线灰 + **other 独立空心点** +
  chips/清单/分段条 + 清单 stagger reduced-motion 隔离）· en.ts 加键 + zh 手写 draft。

## 验收（全绿，红先行有据）

| 门 | 结果 | 红先行 |
|---|---|---|
| pytest test_project_milestones_02 | 7/7 | ✅ stash → 6/7 红 |
| pytest 波及面（含 granularity「里程碑非项目」仍成立） | 122/0 无回归 | — |
| cr-alignment `SPEC_STICK=7`（新 3 行） | 43/43 | 机制同 01（选择器无匹配即红）|
| verify-rich-fields-01（e2e，+3 里程碑断言） | 14/0 | WITHOUT 世界=红-if-broken |
| verify-status-truth（+milestones absent + 对照渲染） | 31/0 | 无回归 |
| verify-contrast-smalltext | 26/0 | chip 名 11px --ink-soft，AA 阈同 12px 未回归 |
| verify-p0 | 41/0 | — |
| 像素 | 净影响 0（stub 空态），见 pixel-evidence/02 | — |

## 留后

- 里程碑 chip 名用 --ink-soft 11px；真 seed（07）渲染后收官 contrast 全量复审再确认。
- CURRENT_STICK=7。
- other 空心点样式待 Danny 晨审并排看观感。
