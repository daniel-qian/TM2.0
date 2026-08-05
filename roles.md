# Roles — the standing cast

The recurring people we convene for strategy, product, marketing, and buyer gut-checks on **Avery**.
Each is also a Claude Code subagent under `.claude/agents/` — invoke with the Agent tool using the `subagent_type` in the table.

| Role | Side | One-liner | `subagent_type` |
|------|------|-----------|-----------------|
| **Phil** | Us (advisor) | SV growth & startup veteran, ex-YC. GTM, growth loops, fundraising narrative, lean AI-native strategy. | `phil` |
| **Claire** | Us (advisor) | Senior PM with deep UX / user-behavior sense. Flows, activation, IA, interface quality. | `claire` |
| **Will** | Us (advisor) | Head of growth marketing. Founder-led distribution, cold outbound, launch playbooks, demo-video storytelling, conversion copy. | `will` |
| **Dana** | Target user (viewer) | Non-technical Head of People at a ~150-person company. Red-line gatekeeper (people never quantified/judged/labeled; no one made to feel "processed"). Tone/human-feel notes are advisory, not vetoes (ADR-0018). | `dana` |
| **Ray** | Target buyer (viewer) | CEO of that same ~150-person company (Dana's boss). Busy operator; judges whether a pitch/demo/claim earns a meeting. Allergic to hype and "another dashboard." | `ceo` |

## 凭据墙（2026-08-05 修订 · ADR-0034 拍板 6）

**约定前缀的一次性测试邮箱 —— `avery-e2e+<时间戳>@<域>` —— agent 可以自动注册、登录、清理。
除此之外的任何账号（Danny 的、客户的、来路不明的）仍然人手，agent 绝不代填。**

修订的理由是这条口径原来那句绝对话**走不到**：账号体系 2026-07 就上线了，而「注册→登录→
认领→双账号隔离」这条链一年里从没被任何人或任何门走通过——后端 pytest 把 token 验证整个
monkeypatch 掉、两道前端门用假 key 拦网络、`.issues/rich-align-0722/acceptance-2.md` 的人手
签认框空了两周。2026-08-05 实测坐实：生产 Supabase 项目 `auth.users` **0 个用户**、
`avery.account_contexts` **0 行**。"永远等人手"在实践中等于"永远没验过"，而这条线上跑的是
租户隔离——裸奔的成本比开这个口子高得多。

口子的边界写死在执行处，不靠自觉：

- 门：`.issues/onboarding-accounts-0805/verify-account-e2e.py`。每一次创建/删除账号前都过
  `_assert_test_email()`，正则只认 `avery-e2e+…`；SQL 侧再叠一层 `email like 'avery-e2e+%'`。
- **没有清理凭据就拒绝开跑**（不是降级跑）：造得出、删不掉的账号就是往生产 auth 表里留尸。
- 后端地址硬校验必须是回环，防手滑打生产；数据落**本地** Postgres，不往生产库写。
- 跑前扫残留、跑完再清一遍（`finally` 里，中途炸了也会跑到）。2026-08-05 连跑两遍后实测
  `auth.users` 回到 0 行、`auth.identities` 回到 0 行，零留尸。

🔴 **别把旧的绝对句抄回来。** 这条线上「红线绝对句复活」是有前科的（记忆条目
`redline-reversed-scoring-unblocked`）：一句被推翻的话在别处被原样引用，几周后又成了口径。
凭据墙现在的口径就是上面加粗那一段，其余表述以它为准。

## How to use them

- **Maker side (Phil / Claire / Will)** produce: strategy, product decisions, and shippable marketing assets.
- **Viewer side (Dana / Ray)** are *real target people* — they never read our diff or reasoning; they react to what a stranger would actually see (the screen, the email, the demo) and tell us if it lands or repels.
- **Dana + Ray are colleagues at the same company** — pitching them together simulates a real HR + CEO buying committee.
- Keep maker ≠ checker (no grading its own homework). Viewers convict on feel; machines convict on hard contracts.

## Product north star (shared context for everyone)

**Avery** — the management-decision layer: it helps managers make safer, traceable, accountable people-and-project calls (the awkward 1:1, the wrong-fire risk, quiet burnout). The warm-advisor posture (*a wise senior at your ear*) is a style asset on product surfaces, **demoted from product truth to red line** (ADR-0018). **Red line (all surfaces, always):** never quantify, diagnose, or judge a person on screen; never make the person being discussed feel processed. Dashboard/efficiency/ROI/commercial language is allowed — especially on marketing/investor surfaces.

- **Positioning:** management-decision layer; advisor voice on product surfaces.
- **Business model:** four-layer paid model (Pilot / Setup / Manager seats / Benchmark + Consulting), **no free tier** — minimum entry is a paid Pilot (ADR-0019, supersedes the retired free-tools/paid-playbooks model).
- **Market:** domestic vertical-first — hotel is the first vertical pack (feat-019, still `in_progress`; nominally so, actually a long-parked external research line — see `progress.md:17`), construction is the paired Skin example (CONTEXT.md · Skin). Chinese-copy purity is a hard gate in the battery (`.issues/feat-068-frontend-deploy/verify-zh-purity.mjs`), which is why "all English" is not the operating reality.
