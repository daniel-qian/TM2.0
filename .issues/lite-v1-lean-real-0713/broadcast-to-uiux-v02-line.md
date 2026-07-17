# 📡 广播 → v02 UIUX 线(feat/036-v02-triage-followups)｜来自:lite-v1 持久化线

> 你们在重做 lite 前端 UIUX。**持久化链 feat-030→041 已全部完成**(未 push),它**已经在 `src/lite/**` 里接好了真后端**——视觉你们随便重构,但下面这套**后端对接契约 + 前端集成点**得在新 UIUX 里保住,否则真公司上传→持久化→隔离→笔记这条链会断。合流时 src/lite 是三方交汇(你们 v02 + 我持久化 + Ask 卡线),要仔细理。

## 1 · 后端 HTTP 契约(新 UIUX 必须对接的,不可绕)

后端 = FastAPI(eval-harness/service),前端走 `VITE_AVERY_API_BASE`。端点:

| 端点 | 方法 | 认证 | 说明 |
|---|---|---|---|
| `/ingest` | POST multipart `files=@` | 无(建 context) | 返 `{context_id, owner_token, source_files, people, projects, briefing, signals, extraction_mode}`。**owner_token 只在这里返一次,前端必须存住。** |
| `/team/{id}` | GET | **token** | LiveTeamPayload(人卡/项目卡/briefing/signals) |
| `/team/{id}/notes` | GET | **token** | 「Avery 的笔记」累积列表(新→旧) |
| `/team/{id}/files` | GET | **token** | 每公司文件空间清单(filename/size/mime/n_chunks/status) |
| `/team/{id}/files/{idx}` | GET | **token** | 下载源文件字节(attachment) |
| `/advise` | POST | **token** | `{situation, company_context_id, stream}` → SSE 流 或 JSON manifest |
| `/health` | GET | 无 | status/degraded/extraction_mode/memory/llm_calls_remaining |

## 2 · 🔑 owner_token 隔离契约(feat-038,最容易在重构里搞丢)

- **token 只走 HTTP header**:`X-Avery-Token: <token>` 或 `Authorization: Bearer <token>`。**绝不放 URL**(会漏进 log/referer)。
- 前端流程:`/ingest` 拿到 `owner_token` → 按 context_id 存(localStorage,`store.ts` 已有 `ownerToken`)→ 之后**每个** `/team`·`/advise`·`/notes`·`/files` 调用带上 header。
- 缺/错 token → 后端 **404**(不是 403,故意不泄存在性)。**新 UIUX 若漏带 header,所有读路径会 404,团队/笔记/文件全空。**
- ⚠ 这是**经理凭据**;Ask 卡线的 `/r/{token}` 员工分享 token 是**另一套**,别混。

## 3 · 本链已在 src/lite/** 的前端集成点(重构时保住"接线",视觉可换)

本链动了 658 行(`git diff 2bda603..feat/041 -- src/lite`):
- **`transport.ts`**(+115):`/ingest` 存 owner_token、reads 带 `X-Avery-Token`、`fetchFiles`/`fetchNotes`。**这层是后端对接的心脏,新 UIUX 复用它、别重写丢了 token 逻辑。**
- **`store.ts`**(+83):`ownerToken`·`files`·`notes` 状态 + refresh。
- **新屏**:`NotesScreen.tsx`(Avery 笔记,只读累积,红线信任条)、`UploadPanel.tsx` 的"your files"清单、`RoomScreen.tsx` 的 advise 后 note nudge。**这些是新增用户面,v02 若重排 tab/布局,把这三块的数据流接进新壳。**
- `LiteTopbar.tsx`/`LiteApp.tsx`:notes tab 接线。`i18n/en.ts`+`zh.ts`:新 copy key(ZH 部分手写待 M3,合并后可走那条线的定向翻译补)。

## 4 · 🔴 红线开关对 UI 的影响(v02 设计要知道)

Danny 07-13 推翻"人不打分"红线,走开关 `AVERY_ALLOW_PERSON_SCORING`(后端 env,**部署时开**):
- **开关关**=打分被拦(护城河默认态);**开**=上传抽取+笔记可带业绩/情绪评分。
- **但人卡(team_cards)当前仍定性、无 moodPct/capacityPct/分数字段——"先只解禁不建功能"**。所以 v02 **暂时别给人卡设计分数血条 UI**(后端还没喂);笔记屏在开关开时可能出现打分文本。若后续要建"人卡打分"功能,是另一波、要后端配合。

## 5 · 合流注意(三方交汇 src/lite)

- 本链链尾 `feat/041-e2e-broadcast`(tip 9e5a725,未 push);Ask 卡线在 main(3a9cf5c);你们 v02 在 `feat/036-v02-triage-followups`。**三方都动 src/lite/**。**
- mode 开关默认隐藏(`?modeSwitch=1`,shared/mode.ts,来自 Ask 线)。
- 建议合流顺序 Danny 定;核心不可丢的是 **§2 token 契约 + §3 transport 接线**。

## 6 · 环境/部署(影响你们联调)

- 前端 env:`VITE_AVERY_API_BASE`(后端源)·`VITE_AVERY_MODE=live`·`VITE_AVERY_LOCALE`。
- 后端部署细节见 `docs/deploy/dual-deploy-runbook.md`(feat-040)。生产 ECS 内存紧(见 infra-brief),但那是后端的事,不影响前端联调(可指本地/mock)。
- 数据处理说明(`data-handling-copy-draft.md`)是**尚未落进 UI 的草稿**——v02 若做"隐私/数据处理"露出,可采用它。

有问题回一条广播,或让 Danny 牵线。别动 `.issues/lite-v1-lean-real-0713/**`(本线所有权)。
