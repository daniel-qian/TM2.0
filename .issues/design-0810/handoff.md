# 0810 设计轮任务书（handoff · 本文件是新 session 的正源起点）

> 交接背景：0808-0809 两轮 UIUX 工程（#73-#81，档案 `.issues/redesign-0808/`）被 Danny 判
> 「效果一般、原地兜圈、在错误方向上走」。旧 session 复盘承认两条病根：①grill 给的全是
> 「存量结构上怎么改」的选择题，方向被旧代码锚死；②落地时「门稳定/少重冻」的权重压过
> 「用户看得懂」，且始终没有真正的视觉设计输入（design-taste-frontend 是 landing page 向，
> 产品 UI 兵种缺位）。本轮换打法，旧 session 退出主导。

## 工作方式（Danny 拍板，0810）

1. **Plan 先行，不用选择题 grill**：自由探索 → 出**整体设计方案**（信息架构 + 视觉规格，
   最好有静态原型或截图级效果图）→ Danny 审方案 → 再动工。只有真正的**产品级取舍**
   （下面标了两条）才上 AskUserQuestion，且要大白话+具体场景例。
2. **授权**：允许推倒**对话页**与**资料库**的样式层重做。行为契约（网络体/store 语义）保留，
   门判据可改判（改判纪律照旧：同 commit、配变异）；像素基线可全量重冻（只在主检出）。
3. 沟通规则：Danny 的语言可能不够规范，**有不清楚的先用大白话提问/解释达成共识再动手**。

## Step 0 · 环境与技能（开工先做）

- `npx skills update -g` 刷新全局技能（`~\.agents\skills` 那套归 skills CLI 管）；
  `npx skills find` 搜**产品 UI / 组件设计**向的技能（关键词：ui components / design system /
  product design），找到对口的就装上并在方案期真用。`~\.claude\skills\design-taste-frontend`
  是 agent-os 手拷的、CLI 管不到——它的**纪律章节**（一致性锁/状态全覆盖/AI 味黑名单/图标纪律）
  仍适用，landing page 主体章节不适用。
- 读仓顺序：`AGENTS.md` → `progress.md` → `.issues/redesign-0808/`（四路 recon + 各回执，
  「别重新侦察」密度，但 ⚠ 行号一律读到真实边界）。参照产品：Claude.ai（对话）、
  Notion / 文件管理器（资料库）。

## 问题清单（Danny 0810 原话整理，六条）

1. **对话侧栏「丢失风格」**：组件像没上皮肤（白板列表）。需要真正的视觉规格——参照 Claude
   侧栏的密度/层次/hover/分组标签排版，不是只把结构做对。
2. **资料库 layout 重做**：Danny 原话「组件分布和 layout 好乱，作为用户我看不懂」。具体点名:
   中列垂直滚动过高、两侧大片空白；文件列表默认摊开、容器过高杂乱；**应该是 file explorer
   形态的文件管理系统，上传窗口和它放在一起**。行数/密度/分区都要重定。
3. **🔴 产品拍板项 A ·「新建一家公司」的定位**：它的出身是「demo 示例团队与正式库并存」+
   「传错了推倒重建」的**机制残留**，不是多租户功能。Danny 的心智模型是**单公司、同一批团队、
   持续补料（+ 将来 Avery 从对话里攒）**——即 append 那条路。方案要给出砍/藏进设置/改名
   「重新建档」的建议，Danny 拍板。
4. **🔴 产品拍板项 B ·「自动更新流水 + 已查阅/撤回」**：Danny 早期设想（新文件提到项目进展 →
   自动更新项目信息 → 主动展示「已自动更新」→ 用户「已查阅」或「撤回」），**从未建过**。
   现状：更新无声直接生效，只有新旧资料矛盾才走今天页差距对照卡。方案要么给这个动态模型
   出设计，要么明确建议排期位置。这条是资料库诸多歧义的半个根源，别绕开。
5. **自动铸链（T9）保留不砍**，Danny 已重新对齐流程。**但有一条截图异常待核实**：
   「谁交了 2026-W33」四人全部显示「链接过期了」——刚自动铸的链接应 7 天后才过期。
   查两个方向：示例团队种子数据带旧日期（无害）vs 自动铸链照抄名单时把旧 `expires_at`
   一起抄了（真 bug，修）。入口：`service/form_autofill.py` + `avery/ingest/form.py`
   `default_expiry`；演习库 `rehearsal0808` 里有现场。
6. **#82（表单测试墙钟炸弹）**的收尾复核归本 session：它在独立 session 跑，落地后按仓里惯例
   独立验——`TZ=UTC` 离线全套回 0 failed，验收标准在 #82 票面（W33 任一天与 W34 周一都要绿）。
   在它落地前，离线套 3 红是已知底噪（progress.md Blockers 有口径）。

## 工程铁律（不因换 session 而变，全文见 AGENTS.md 与 progress.md）

- 🔴 **绝对不 push**（本地 main ahead origin 70+；push=前端自动上产）。统一上产另行安排：
  push+换后端容器同窗口，迁移 **0015+0016** 必须落地。
- 门电池 A→B→C 铁律（A 区 34 道）；离线三件套 `AVERY_BRAIN=mock + AVERY_EXTRACTOR=heuristic +
  AVERY_EMBEDDINGS=keyword` + `AVERY_DEMO_SEED_DIR=tests/fixtures/demo-seed` + PUBLIC_BASE/CORS；
  跑门给 `VERIFY_BASE` 和 `VERIFY_API`。
- 像素基线（54 张）是 gitignore 单机产物，**只在主检出比对/重冻**（worktree 里=首写假象）；
  重冻前后 md5 全表 diff（哈希要真在表里）。
- 中文一律走文件（`gh --input` JSON / `git commit -F`）；i18n 只手工 Edit，
  **`scripts/i18n-zh*.mjs` 一个都不许跑**；测试别赌墙上时钟。
- 破坏性操作（删分支/删文件/改历史/对外/花钱）归 Danny；开票走 gh issues；
  各票收尾重写 progress.md（DoD）；回执落 `.issues/design-0810/`。
- 演习环境：launch.json `rehearsal-api`(8250)/`rehearsal-web`(5250)，库 `rehearsal0808`，
  脑真 MiniMax；起 preview 前 dist 必须 `VITE_AVERY_API_BASE=http://127.0.0.1:8250
  npm run build -- --mode development` 重打。
