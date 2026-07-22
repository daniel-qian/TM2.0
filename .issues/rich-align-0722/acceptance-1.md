# 验收手册 · 批次① · 富项目字段（issue 01 进度/风险 + issue 02 里程碑）

> 满态对齐战役（rich-align-0722）· 2026-07-22 AFK 夜跑产出。
> 本批次 = issue 01 + 02（富项目字段一族，端到端全通）。issue 03–11 未动（见 session-handoff.md）。
> **push=人工闸**：Danny 在 dev server 人测点头后才 `git push` 上产。本批次 commit 已攒在
> 分支 `claude/layout-real-components-27b594`（d58f3d5 · 99bb20d），未推。

## 0. 环境（收工保持运行）

- 后端 mock：`http://127.0.0.1:8137`（brain=mock / heuristic / keyword；demo-seed）——**在跑**。
- 前端 preview：`http://localhost:5173`——**在跑**（挂本批次终局 dev 构建）。
- 🔴 **验收入口（必带参）**：`http://localhost:5173/?v=2&mode=live&lang=zh`
  （裸链落旧 story 壳；aurora 皮加 `&look=aurora`）。
- 若机器重启过：起法见 runbook §0（mock 三件套 env + `tsc -b && vite build --mode development && vite preview`）。

## 1. 机器自验（本批次全绿，红先行有据）

| 门 | 结果 | 红先行证据 |
|---|---|---|
| pytest `test_project_risk_progress_01`（11）+ `test_project_milestones_02`（7） | 18/18 | stash 后端改动 → 01 得 9/11 红、02 得 6/7 红 |
| pytest 波及面（ingest/registry/granularity/llm/header 等） | 140/0 | granularity「里程碑非独立项目」仍成立 |
| cr-alignment `SPEC_STICK=7`（stick6 五行 + stick7 三行，projects 屏真部件闸） | 43/43 | 旧 dist 下 stick6 4/5 红（riskBadge/weight/color/track6）→ rebuild 绿 |
| `verify-rich-fields-01.mjs`（e2e，WITH/WITHOUT 两世界，进度+风险+里程碑） | 14/0 | WITHOUT 世界即红-if-broken（缺席必须收起）|
| `verify-status-truth`（+absent 分支删 progress/risk/milestones + 对照真值卡） | 31/0 | 无回归（基线 27）|
| **全量 A 区电池（19 门，SPEC_STICK=CURRENT_STICK=7）** | **19/19 绿 exit 0** | 本批次零跨门回归 |
| verify-contrast-smalltext / verify-p0 / verify-zh-purity | 26/0 · 41/0 · 基线14持平 | AA 未回归 · 缺 progress 不吐 0% · 无新泄漏 |

- 电池独占跑（无并发 agent）；C 区调包者本批次未触及（无写端点/无 dist 调包改动）。
- 探针落点 tracked：`.issues/rich-align-0722/verify-rich-fields-01.mjs`（不入 roster，F19）。

## 2. HITL 逐屏看点（Danny 人测路径 · step-by-step）

**准备**：无痕窗开 `http://localhost:5173/?v=2&mode=live&lang=zh`（清 `lite2:` 键或无痕，避开自动恢复）。

**路径 A — 从闸门页进 + 上传富字段文档（看真部件）**
1. 首屏 = 全屏闸门（三扇门）。选「上传文件」（或走「示例团队」门先进空态再上传）。
2. 上传一份含以下行的 `.md`（可现敲一份；抽取器 heuristic 秒回）：
   ```
   # 三亚湾婚宴项目
   负责人：小王
   状态：进行中
   进度：58%
   风险：高/雨季场地档期紧张
   里程碑：
   - 场地确认（已完成）
   - 布置施工（进行中）
   - 验收交付（未开始）
   ```
3. 进「项目」屏（顶栏「多看一眼」右侧或 tab）。**看点**：
   - 项目卡有 **进度条**（6px 圆角轨道，几何对齐她方；`进度` 行的 58%）。
   - 卡上有 **风险徽章**（红底深字「高风险」pill + 原因「雨季场地档期紧张」；对齐她方软底深字令牌）。
   - 卡上有 **里程碑圆点串**：场地确认=绿点(已完成) / 布置施工=蓝点(进行中) / 验收交付=线灰点(未开始)。
4. 点开该项目卡 → **详情浮层看点**：**环形进度**（SVG 56，中心数字 58）+ **风险行** + **里程碑清单**
   （圆点+名称+右对齐状态字）+ **分段总览条**（3 段等分按状态着色）。

**路径 B — absent≠none（看诚实收起）**
5. 上传一份**不写**进度/风险/里程碑的项目文档（只有标题/负责人/状态）。
6. 项目屏该卡：**无进度条**（改说「文档未提及」，绝不 0%）、**无风险徽章**、**无里程碑串**。
   详情浮层进度节说「文档未提及」、**无风险行、无里程碑段**。这是本战役承诺的核心——稀疏=诚实不是编造。

**路径 C — 词表外里程碑状态（看 other 不撒谎）**
7. 上传含 `- 初步方案（待定）` 的里程碑行 →「待定」不在四态词表 → 渲染 **独立空心点**（非 upcoming 同款灰实心）
   + 详情里状态字**原样回显「待定」**（不替客户改写成「未开始」）。

**并排对照（可选）**：她方参照 `http://localhost:3100`（cr-live，`cd D:\cr-live && npm run dev`）——
进度条/风险徽章/里程碑圆点/环形的结构与数值令牌应当量；**文本/源码零抄**（只对齐结构+数值令牌）。

## 3. pixel-evidence 索引

- `eval-harness/reports/pixel-evidence/01/`（进度/风险）· `.../02/`（里程碑）。
- **结论**：本批次对 9屏×2皮×2视口像素基线**净影响 = 0**——像素基线走 `transport=stub`，本机 projects
  屏是空态（stub 不灌数据），富部件不出现。富部件的像素/几何由 cr-align stick6/7 + e2e 承担（走真 seed）。
- **home-mobile 先天漂移**（aurora/paper，~0.08 比例）：07-21 冻结的非回归漂移，已核实 home 屏不消费本批次
  任何类名 → 与本批次无关，未动其基线，**处置归 Danny 晨审**。

## 4. 拍板复核项①-④ 签认位

> ⚠️ 四项均属 issue 03/06/09/11 的设计决策，**本批次（01+02）不涉**——列此仅为战役级台账，
> 待各自 issue 交付后在对应批次验收手册签认。

| # | 复核项 | 归属 issue | 本批次状态 | Danny 签认 |
|---|---|---|---|---|
| ① | 「重新开始」全清含语言/观感偏好（清 `lite2:*`） | 09 | 未开始 | ☐ |
| ② | 人身数字「抽取恒存自述槽、投影随开关」（母本不随开关重铸；库里恒有自述数据是代价） | 03 | 未开始 | ☐ |
| ③ | 人身数字开关默认态 = 关 | 03 | 未开始 | ☐ |
| ④ | 不对称承认：CRUD 手填他人负载/情绪硬 422 vs 文档通道自述行作者身份系统不可验（口径系统可自证式） | 03/06 | 未开始 | ☐ |

**本批次（01+02）Danny 签认**：dev server 人测 §2 路径 A/B/C 无误 → ☐ 通过 → 授权 `git push` 上产（+生产取证补收据）。

## 5. 本批次已知留后

- zh 4+6 键手写 draft（风险/里程碑标签），待 Danny 审字或下次 M3 directed pass 收编（zh.ts 头已标 rich-align-0722/01-02）。
- 环形 fill 色暂用 accent（非她方 status-tone 填充）；里程碑 chip 名 --ink-soft 11px（AA 阈同 12px，真 seed 渲染后收官 contrast 再核）。
- 富部件的像素基线覆盖靠计算值门（stub 空态盖不到）——收官（11）全量像素两轮时留意。
- **issue 03–11 未动**：见 session-handoff.md「下一步」+ issue-03 机理索引。
