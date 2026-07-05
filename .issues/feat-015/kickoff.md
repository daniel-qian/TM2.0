# feat-015 Kickoff — Agent service（advisor engine → FastAPI+SSE）

> 立即可 AFK 起跑（D5 并行三线之一）。依赖 feat-011（done）。

## 目标
把已存在的 advisor engine（`eval-harness` 的 `think→tool→observe` loop）包成真部署的 HTTP 服务——Line A 的后端，也是 graduate demo 的 `LiveAgentSource` 数据源。

## 先读
- `AGENTS.md`（启动纪律）· `docs/strategy/2026-07-05-dual-line-strategy-roundtable.md`（全局）· `docs/adr/0020-*` §决策4 · `docs/adr/0021-*` §1
- `eval-harness/avery/{loop,brain,tools,redline,memory,cases}.py` · `eval-harness/runner.py` · `feature_list.json` feat-011 evidence（8 字段契约 + 红线 + cite 细节）

## Scope（只做这一个）
1. FastAPI 服务包 loop：`POST /advise`，SSE 流式吐 `think→tool→observe` 步 + 最终 8 字段。
2. **live-input 路径**：接受用户当场打字的情境（free-text 管理问题 + 可选 `company_context_id`），构造成 loop 能吃的输入，替代只读 case 文件。
3. **保契约**：红线校验器（`redline.py`）、cite-before-number 门、8 字段 schema——全不动、全生效。
4. pluggable brain：境内 MiniMax/DeepSeek、海外 Claude（`brain.py` 已支持，服务从 env 选）。
5. **不做**：ingestion（feat-016）、前端（feat-017）、部署（feat-018）。`company_context` 先留接口 stub（feat-016 填实）。

## AFK 验证门
- pytest 契约电池（MockBrain 确定性）：红线 hard-fail、cite 不可跳过、8 字段 schema、SSE 分帧顺序。
- 一条真 API 冒烟（真 brain）：只断言"契约成立"（有 cite、守红线、schema 齐），**不**断言逐字文案。
- `eval-harness` 现有 pytest（124）不回退。

## DoD
- 服务本地起、`/advise` 流式返回、契约电池绿、真冒烟绿。
- 新英文 user-facing 串（若有）标 `⚠ 待 Danny 审字`。
- `progress.md` + feat-015 evidence 更新。

## Stack 默认（按推荐，Danny 可异步拍）
- FastAPI + `sse-starlette`（或裸 SSE）；Python 3.11+。
- 服务与 `eval-harness` 同仓（`eval-harness/` 下加 `service/` 或 `app.py`），**产品 `src/` 不碰**。

## HITL
- brain key（MiniMax/Claude）配置；生产 host 归 feat-018/Danny。
