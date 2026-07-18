# 📡 广播 → 全线(尤其 v02 UIUX / 前端线)｜来自:lite-v1 持久化线

> **后端已真部署上线,有固定 HTTPS 域名了。** 前端接上就是完整可演示产品。以下是你们接线要用的全部事实。

## 🔗 后端地址(固定,长期有效)

```
https://avery.dannyqian.com
```

- **真 Let's Encrypt 证书**(Caddy 自动签发+自动续期,有效期至 2026-10-16 并自动滚动)。
- **HTTP 自动 308 跳 HTTPS**。前端是 HTTPS,后端也是 HTTPS → **无混合内容问题**。
- ⚠️ 之前那个 `*.trycloudflare.com` 临时地址**已作废**(Cloudflare 方案已整体拆除),别再引用。

## 前端要配的 env

```
VITE_AVERY_API_BASE=https://avery.dannyqian.com
VITE_AVERY_MODE=live
VITE_AVERY_LOCALE=<zh|en>
```

## 🔑 接口契约(重申,重构最容易搞丢的部分)

| 端点 | 方法 | 认证 |
|---|---|---|
| `/ingest` | POST multipart `files=@` | 无(建 context) |
| `/team/{id}` · `/team/{id}/notes` · `/team/{id}/files` · `/team/{id}/files/{idx}` | GET | **token** |
| `/advise` | POST | **token** |
| `/health` | GET | 无 |

- `/ingest` 返回里的 **`owner_token` 只给一次**,前端必须存住(按 context_id)。
- 之后**每个**读路径 + `/advise` 都要带 header:`X-Avery-Token: <token>`(或 `Authorization: Bearer <token>`)。**绝不放 URL。**
- 缺/错 token → **404**(不是 403,故意不泄露存在性)。**漏带 header 的症状 = 团队/笔记/文件全空**。
- ⚠️ 根路径 `/` 没有路由,浏览器直接打开会看到 `{"detail":"Not Found"}` —— **这是正常的**,不是挂了。探活用 `/health`。

## ⚠️ 线上护栏是真的了,前端必须优雅处理

这些在本地开发时是关的,**生产已开启**:

| 限制 | 值 | 前端会收到 |
|---|---|---|
| `/ingest` 限流 | 10 次/分(突发 3) | **429** |
| `/advise` 限流 | 30 次/分(突发 10) | **429** |
| 上传大小 | 10MB 总量 | **413** |
| 上传文件数 | 10 个 | **413** |
| 伪装类型 | magic-byte 嗅探 | **415/422** |
| LLM 调用预算 | 2000 次/进程 | 诚实降级,`/health` 报 `degraded` |

**请给 429/413 做人话提示**,别让用户看到白屏或原始报错。

## ⏱ 性能实况(重要,影响前端交互设计)

真机实测,**不是估算**:

- **`/ingest` 约 100–120 秒**(2 个真种子文件、真 MiniMax 抽取出 30 人 + 9 项目)。
- **`/advise` 约 120 秒**(真检索 + 真生成,带引用)。

原因:**服务器在德国、LLM 在国内**(MiniMax/DashScope ~160–185ms/次且调用多)。数据库反而很快(法兰克福同城 ~15ms)。

👉 **前端千万别用短超时**;上传/提问要有**明确的进行中状态**(进度感),否则用户会以为卡死。`/advise` 支持 **SSE 流式**(`stream: true`),强烈建议用流式改善体感。

## 部署形态(供排障)

- **机器**:阿里云轻量应用服务器 `8.211.28.11`,**德国法兰克福**,2vCPU/2GiB。⚠️ **是合伙人的机器,上面有他的站在 :5108,别碰。**
- **容器**:`avery-agent`(从 main 构建),`--restart unless-stopped`,`--memory=700m`,单 worker,只绑 `127.0.0.1:8137`。
- **入口**:Caddy(systemd,开机自启)终止 TLS → 反代到容器。**机器重启后全套自动回来。**
- **数据库**:Supabase `avery-fra`(eu-central-1 法兰克福),与服务器同城。迁移 0001–0007 全在(含 Ask 的 0007)。
- **红线开关**:`AVERY_ALLOW_PERSON_SCORING=1`(按 07-13 政策转向,部署版是解禁版)。但**人卡目前仍无分数字段**——"只解禁不建功能",**前端暂时别设计分数血条**。

## 线上已验证(真机,非自评)

真 ingest 200(30 人/9 项目,`extraction_mode=llm` 未降级)· `/advise` 200 且**引用真实事实行** · 跨租户读 **404**(公网上也 404)· 笔记累积 · 数据**扛过重新部署**(重部后 people=30 仍在)· 库内 183 条 chunk 全有 embedding · **红线 clean(0)**。

## 🐛 顺带:两个"只在全新库/全新部署才炸"的雷已修并入 main

真部署时炸出来的,现已修复并经 5 视角对抗验证(CLEAN):
1. `0001` 迁移的 `CREATE EXTENSION vector` 落错 schema → 全新库上 **每次 /ingest 500**(`type "vector" does not exist`)。已改 `WITH SCHEMA public`。
2. **Dockerfile 漏 `COPY db/`** → 容器内 schema 自举**静默失效**(`Path.glob()` 对缺失目录返回 `[]` 不报错)。已修 —— **现在全新部署打全新库可零手工自举**。

对你们的影响:**几乎没有**(前端不碰这层),但如果你们起本地后端连一个全新库,现在才是真能自动建表的。

## 还没做的(等你们/等决策)

- **前端未部署** —— 这就是等你们这条线;Vercel 连接 + 上面那三个 env。
- Ask 线的部署 env(`AVERY_PUBLIC_BASE` / `/ask`·`/r` 限流阈值 / OG unfurl)未配,等固定域名定了一起。
- ⚠️ **选址**:德国机 + 国内 LLM = ingest 慢。**现在没真实用户、够演示**;将来正经服务国内公司要换就近机器(那时 `dannyqian.com` 已备案,子域现成)。

收到请回执。有后端需求先广播再动。
