# session-handoff · v02 线（feat-047/048/049）

> 2026-07-18 收工。本线专属交接。**没碰** `progress.md` 与根 `session-handoff.md`
> ——按 AGENTS.md 那两份归主检出集成者，而持久化线此刻正在 main 上活跃提交（c4d4564 收工广播）。

## 分支状态（最要紧的一条）

`feat/047-v02-engine-sync @ ed85481`，已并入 main 全部提交。

**main 可零冲突 fast-forward 到本分支** —— 已用 `git merge-base --is-ancestor main feat/047-v02-engine-sync` 验证。

⚠️ **合并没做，是故意的**：`main` 当前被持久化线的工作树
（`.claude/worktrees/avery-lite-v1-persistence-7943bf`）检出占用，且该线正在其上提交。
按 AGENTS.md 主检出合流归集成者。**持有 main 的人一步 FF 即可，无需解冲突。**

未 push（凭据墙，归 Danny）。

## 这次干了什么

真中文语料（三亚鹿山雅居别墅酒店）第一次进系统，**一测即塌**。五轮门先行 + checker≠maker 对抗验证收口。

| 轮 | 修的 |
|---|---|
| R1 | `_slug` 中文名全塌成同一 id（点谁都开同一人）；跨文档不去重（20 人变 39） |
| R2 | `_looks_like_name` 的 `^[A-Z]` 在 `_slug` 前就丢光汉字名（启发式路径拿到空团队）；`_norm_team('')` 恒返回 Founders |
| R3 | **红线 BLOCKER**：R2 让 team 变开放文本，但红线扫描面不含 team → 绩效文本塞 team 可建 context |
| R4 | LLM 提示词强制英文分类菜单 → 20 人全塞进 GTM |
| R5 | R4 提示词在英文上回归（造词 "Founding"）；`redline._NEG` 裸「别」把**「别墅」**当否定词，关掉 7/20 人的评分红线 |

**根因盲点（值得全项目记住）**：整套门语料是 ASCII 伪装——语料里的人*是中国人*但名字写拼音（`Lin Qing`/`Chen Mingyuan`），官方 seed 直接叫 `PrismDesign_TeamProfile_EN.xlsx`。**一个汉字都没进过人名字段**，所以 42 个 feature、6 个门聚合、几十条对抗验证泳道全跑在 ASCII 上。

## 验证证据

- **真机**（minimax + 三亚 seed，两个独立验证者各 n=5，字节相同）：
  20 人 / 20 唯一 id / 6 个真实中文部门（别墅销售 5·渠道合作 3·客户运营 4·市场投放 5·策略分析 2·活动策划 1）
- **修复前对照**：39 人 / 唯一 id **1 个** / 303 条 React 重复 key / 点三张不同人卡三次全开陈思雨
- **测试**：合并后全量 `907 passed / 0 failed / 8 strict xfail`（故意留红）；CJK 门 370 passed
- **HITL 走查**：Danny 亲走 9 步，T2–T7、T9 全过
- `src/**` 零改动（每轮验证者各自逐条核过）

## 仍开（未修，已 pin 或记录，留给实施波）

| 问题 | 归属 | 状态 |
|---|---|---|
| **刷新丢团队数据** | 前端 | `store.ts` 的 `contextId` 初始化为 null、加载时不从 localStorage 恢复；后端现已持久化（Supabase），前端应存住 contextId + ownerToken 在加载时走 `/team/{id}` 重新拉。纯前端几行 |
| H4 中文项目轴幽灵 | 抽取 | 5 条 strict xfail 钉着。**不是 CJK bug**——纯英文双项目文档也只抽出 1 个（结构性） |
| H6 定性评分词过红线 | 红线 | 2 条 strict xfail。Danny 已拍「评分可接受」，本条降级 |
| `_NEG` 其他否定词同类洞 | 红线 | 只修了「别」，其余否定词同病 |
| `name` 字段未扫红线 | 红线 | 文件名兜底能把人命名成「绩效8分」 |
| 项目粒度偏多（22–25 vs 6） | 抽取 | LLM 把里程碑当项目，无门 |

## 下一波的输入

**第一波差异清单已入库**：`.issues/lite-live-v02-0713/_diff-audit/`
（`first-wave-diff.md` 逐屏差异 + 两侧全量交互清单）。并行 diff-audit 线基于 `1833d97` 做的，
真上传三亚 seed 走真 minimax、7 屏实测。**判定列待 Danny 审**，审完进第二波（grill + PRD/ISSUES）。

Danny 已点名的缺口：点「起草消息」不弹草稿框、the room 思考无「简化输出」、二级菜单、
以及**两套设计要并存**（the room 画布 ours vs 合伙人对话框 —— 都保留，不是二选一）。

## 后端实况（来自持久化线广播，UIUX 接线必读）

- **已有固定域名**：`https://avery.dannyqian.com`（不再是临时 Cloudflare 隧道）
- 前端接线走 `VITE_AVERY_API_BASE=https://avery.dannyqian.com`，**绝不写死**
- `owner_token` 只走 header（`X-Avery-Token` / `Bearer`），绝不进 URL；缺/错 → **404**（不是 403）
- 红线开关生产已解禁（`AVERY_ALLOW_PERSON_SCORING=1`），**但 payload 无 moodPct/capacityPct/分数字段**
  → 人卡**先别设计分数血条 UI**，后端没喂那些字段
