# 单端部署：一个 Vercel 前端（ZH 默认）+ 一台法兰克福后端 —— 取代 ADR-0021 §5 的对称双端

> **修订 [ADR-0021](0021-two-engine-core-vertical-packs-skins-dual-deploy.md) §5。** 其余各条（两个引擎、垂直包、红线内建到抽取、商业护栏）不受影响。
> **状态：** Accepted（2026-07-18，前端首次真部署当天；Danny 拍板 locale/托管/域名三项）
> **编号提示：** `0023-` 号已被两份 ADR 同时占用（`ask-employee-selfreport-redline-boundaries` 与 `postgres-persistence-for-lite-v1-context-registry`）。本条取 `0024` 以避开，未回改历史。

## 背景

ADR-0021 §5 拍的是**对称双端**：

> 前端静态 SPA 双 target（Vercel 海外 EN / 境内静态托管 ZH）；Python 服务双 host（境内 MiniMax / 海外 Claude）。

那是 2026-07-05 的判断，前提是"海外优先 + 境内演示各走各的"。到 2026-07-18 前后端都真上线时，实际落成的形态与之**逐条不符**：

| ADR-0021 §5 | 2026-07-18 实况 |
|---|---|
| 前端双 target | **单个** Vercel 项目 `avery-lite` |
| 前端海外 EN 默认 | **ZH 默认**（`VITE_AVERY_LOCALE=zh`），`?lang=en` 覆盖 |
| 前端境内静态托管 ZH | **从未发生** |
| 服务双 host | **单台** 阿里云轻量 `8.211.28.11` |
| 境内 host | **德国法兰克福** |
| 海外 host = Claude brain | **从未发生**，brain = `minimax` |

也就是说，产品现在**三地分布**：前端在 Vercel 全球 anycast，后端在德国，LLM 在中国。

## 决策

**单端。** 一个前端目标、一个后端 host，中文为默认。

1. **前端** —— Vercel 项目 `avery-lite`，Root Directory = 仓库根，域名 `averylite.dannyqian.com`。构建期 env 全部写进 `vercel.json` 的 `build.env`（无密钥，Vite 会内联进公开包）。`?lang=` / `?v=` / `?look=` 仍可现场覆盖。
2. **后端** —— 法兰克福那台阿里云轻量上的单个容器，Caddy 终止 TLS，域名 `avery.dannyqian.com`。数据库 Supabase `avery-fra`，与该机器**同城**（~15ms）。
3. **中文是默认，不是覆盖项。** 第一批真实收件人是三亚鹿山雅居、瑞典建筑公司、国内融资团队（`.issues/v02-partner-align-0718/decisions.md:41`）；英文经 `?lang=en` 提供。
4. **不建第二个境内前端目标。** 前端是几百 KB 的静态包、一次性加载；真正的等待来自后端（`/ingest` 100–120s、`/advise` ~120s）。再立一个境内托管目标要另配 CI、另维护一套 env 和一个域名，而**对用户感知几乎无改善**。

## 取舍 / 理由

**为什么后端在德国 —— 而且这一条是清醒选的，不是将就。**

那台机器是**合伙人的**，已经在跑、已经备好、上面有他自己的站（`:5108`）。用它意味着零采购、零等待。代价是它离国内 LLM 很远：MiniMax / DashScope 每次调用 ~160–185ms，而 ingest 要调很多次 —— **100–120 秒里的绝大部分就是这段来回**。

被否的替代：

- **换就近机器（国内或亚太）。** 会让 ingest 快数倍。但今天**没有真实用户**，只有演示；而 Supabase 库已经在法兰克福，搬机器就得连库一起搬。**记下来的触发条件：一旦开始正经服务国内公司，就该换。** 那时 `dannyqian.com` 已备案，子域现成。
- **把 LLM 换成就近的（海外模型）。** 会破坏中文质量 —— feat-048/049 刚把中文抽取端到端修通，靠的正是 MiniMax。慢是可以用界面诚实交代的（feat-068 已加等待预期 + 计时），中文变差不能。

**为什么放弃"海外 EN 优先"。** 那是尚无真实客户时的默认假设。现在有名有姓的收件人里两家是中文使用者，第三家（瑞典）用 `?lang=en` 就够。为一个次要受众维持第二套部署，不划算。

## 后果

- `docs/deploy/dual-deploy-runbook.md` 的 §A.4 / §B 描述的境内 ECS + 宝塔 nginx + `avery.ima-read.com` 路径**已作废**；文件顶部已加纠偏横幅，正文保留作历史。
- **CORS 成了一条跨线硬依赖。** 后端 `AVERY_CORS_ORIGINS` 是**精确匹配列表**，无通配。任何新的前端 origin（包括每一个 Vercel preview 部署的随机域名）不进这个列表就会被浏览器拦在请求发出之前，且症状与"没有数据"不可区分。见 issue #14。
- **ingest 慢是产品事实，不是 bug。** 界面必须诚实交代等待，且**不能**用短超时。
- 换就近机器这件事，从"要不要做"变成了"什么时候做" —— 触发条件如上。

## 不变

ADR-0021 的 §1–§4、§6 全部有效：两个引擎的内核、垂直包 = Capabilities 包 + Skin + 客户数据、红线内建到抽取、以及"sampler 不是免费层"的商业护栏。**pluggable brain / embeddings / retrieval 的设计也不变** —— 恰恰是它让"换就近机器/换模型"将来仍然只是改 env。
