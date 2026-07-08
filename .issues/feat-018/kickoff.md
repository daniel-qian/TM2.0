# feat-018 Kickoff — 双端部署（境内中文 + 海外英文）

> 依赖 feat-017。ADR-0021 §5。收尾线，偏 ops。

## 目标
Line A 双端上线：境内中文给融资团队现场演示（不卡/不翻墙），海外英文沿用 overseas-first。

## Scope
- **前端**（静态 SPA）：Vercel（海外 EN）+ 境内静态托管/CDN（ZH）。
- **Python agent 服务**：境内主机（brain=MiniMax/DeepSeek + 境内 embeddings + pgvector）+ 海外（brain=Claude）。
- env/secret 管理（key 不进 git；参考 `eval-harness/.env` 轮换提醒）。
- deployment protection 设置到"融资团队可访问"（landing 项目团队有 SAML，注意别锁死）。
- 双端 smoke：各打一条真请求，断言契约成立 + 中/英各自渲染。

## AFK 验证门 / DoD
- 双端可访问、契约 smoke 绿、i18n 中英各自正确。
- `progress.md` + evidence 更新。

## HITL（Danny 拥有）
- 域名；境内主机开通；生产 promote；Vercel deployment protection 面板设置。
