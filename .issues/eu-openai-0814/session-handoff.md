# Session handoff · #96 OpenAI provider 转正（欧盟线）

> Worktree line: `claude/dazzling-noether-c151cb` @ `D:\avery-wt-dazzling-noether-c151cb`。
> 按 AGENTS.md 的 worktree 规则，这是**本线**的交接；`progress.md` / 根 `session-handoff.md`
> 归主检出的整合者，别在这条线上写。

## What's done

#96 的离线半边**全做完了**，停在真 key 之前。完整回执（含改动表、验收数字、born-red 自检、
「哪些验过哪些没验过」）在 **[receipt-96.md](receipt-96.md)** —— 接手先读它，这里只放指针。

一句话：三个用户内容出境点（MiniMax 对话+抽取 / DeepSeek 热备 / DashScope embedding）各有了
OpenAI 对家，一组 env 一起换；schema、迁移零改动。

## In progress

无。本线可以合。

## Next steps

1. **真 key 冒烟**（凭据墙，Danny/合伙人）：OpenAI org 下开独立 project → Monthly spend hard
   limit → 自签 DPA → 发起 EU data residency 申请（sales 审批、只对新建 project 生效、周期不可控，
   **宜早排队**）。key 到位后按 `docs/deploy/dual-deploy-runbook.md` §2 跑
   `AVERY_BRAIN=openai scripts/deploy/dual-smoke.sh`，再 `/advise`、`/ingest`、embedding 各一发，
   对着 §1.1 的 `/health` 自查表看四个字段。
2. 真 key 冒烟绿了之后，单独一票把 `openai<3` 的上界提掉（v3 换了默认 HTTP 客户端 HTTPX2；
   现在钉着是为了第一次接真 key 时不同时验两件事）。
3. 存量 context 换 embedder 后的重嵌入脚本——本轮没做（欧盟实例按新库起才是干净路径）。要给
   存量库补是另一票。

## Blockers

- **真 key**：属凭据墙（AGENTS.md「需要他凭据/账号才能做的」那一类），agent 做不了。
  离线能做的都做完了，只剩这一步交出去。

## Files Modified

见 [receipt-96.md](receipt-96.md) §1 的表（16 改 + 1 新）。新测试：
`eval-harness/tests/test_openai_provider_96.py`。

## 给下一个 session 的三个坑

1. `OpenAICompatBrain` 的构造默认值**全是 MiniMax 的**（这个类是为 M3 写的）。任何走 OpenAI 的
   构造点都必须显式传 `base_url`/`model`，传 `None` 会静默连到 MiniMax。工厂里那两个 `or` 是闸，
   别当成「多余的默认值」删掉。
2. 加第四家 provider 时，`service/brain_factory.PROVIDER_REGION` 必须同步加一条——漏了会在
   `extraction_chain()` 里 KeyError（有测试扫），而**跨 region 的热备是合规事故**，不是性能取舍。
3. `AVERY_EMBED_MODEL` / `AVERY_EMBED_DIM` 是**两家 embedder 共用**的一对变量。换 provider 时把
   上一家的模型名留在那儿，症状是每批请求 404 + 检索**静默**落回 keyword（不报错、不告警）。
