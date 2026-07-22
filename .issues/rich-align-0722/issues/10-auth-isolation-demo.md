# 10 · 登录隔离演示线

## What to build

端到端演示线：现场真登录 → 把示例团队数据 claim 到账号名下 → 切换账号验证隔离（前号 context 不可见）。本地 mock 现状缺 Supabase env 时登录入口按能力探测隐藏（现状即诚实行为）；本片按 PRD E3 落地：**首选**本地 mock 补配账号能力（补 Supabase env，且**填 env 前先确认** AuthPanel 已是「探后端 /account/status」口径而非只看自身 env——历史坑），全流程本地可演可验；补配不成则**写明线上演法**（步骤进 11 的 acceptance 表单 HITL 看点，push 后生产复演）。流程语义全既有：未登录 401、claim 失败一律同体 404 无枚举。

引用 PRD User Stories：21（真登+claim 归属实证）、22（切号隔离当场演）。

## 字段/接口决策

（PRD E3；后端摸底 §4）
- **无新端点**。走既有：`GET /account/status`（无鉴权能力探测 `{configured, signed_in}`）、`GET /account/contexts`（401 未登录；只回自己拥有的 id）、`POST /account/claim`（body 带 context_id+owner_token；先验登录、再 feat-038 门验 token、再 link；一切失败同体 404）。account.py 远程验 token（60s 缓存，fail-closed 归匿名）。
- 本地演前置：`SUPABASE_URL`+`SUPABASE_ANON_KEY` 两个都设 `auth_configured` 才 true。若 AuthPanel 仍是「只看自身 env」旧口径 → 本片先改为探测口径（仿 demoStore.probe 模式），再谈补 env。
- **值来源**：Supabase MCP `get_project_url` + `get_publishable_keys`（项目 avery）。Supabase 探测出网允许（不属 LLM 烧钱纪律）。
- **落点**：后端启动命令追加 `SUPABASE_URL`/`SUPABASE_ANON_KEY` 两个 env（前端零配置——AuthPanel 探后端）。
- **硬切换判据**：探测/登录面板 30 分钟内跑不通即固化「线上演法」步骤进 acceptance-1.md，不再恋战。
- claim 素材用三亚示例团队最顺：demo claim 克隆副本自带新 owner_token，正好现场归账号（克隆隔离机制零改动）。
- **凭据墙**：登录输入账号密码是 Danny 人手环节，agent 不代填任何凭据；本片交付的是「可演可验的线」——机器探针只打到 401/404/探测边界与（可 mock 账号解析层的）隔离断言，真登录全流程归 HITL。

## Acceptance criteria

机器可验：
- [ ] AuthPanel 口径实证：无 Supabase env → `/account/status` 报 configured:false → 登录入口不渲染（无假按钮）；配了 env → 入口渲染。若本片改了 AuthPanel，改动以能力探测为准。
- [ ] C 区 verify-auth-capability（5281/8281）与 verify-auth-form（5291/8291）绿——🔴 dist 调包者，殿后独占跑，跑完立刻重建 dev dist。
- [ ] 既有 auth/claim 测试全绿（401、同体 404、feat-038 token 门语义零回归）。
- [ ] e2e 边界探针：未登录 `GET /account/contexts`→401；坏 token/坏 context `POST /account/claim`→404（同体，无枚举 oracle）。
- [ ] 隔离断言（后端测试层 mock resolve_account）：账号 A claim ctx → A 的 contexts 含 ctx；账号 B 的 contexts 不含且以 B 身份动 ctx 同体 404。
- [ ] verify-p0 绿（登录/claim 失败路径不漏 console error）。

需人眼：
- [ ] Danny 用真账号排练一遍：登录→claim 三亚副本→退出→换号→看不到前号 context；本地或线上口径二选一写明，步骤纳入 11 的 acceptance-1.md。

## 波及面与红线

既有门波及：C 区三门（verify-auth-capability / verify-auth-form / verify-bundle-privacy 的殿后与 dist 重建纪律——bundle-privacy 最毒：跑完 dist 指生产域名，再碰上传路径=写生产库）、verify-p0（console）、AuthPanel/齿轮菜单结构（09 刚动过齿轮菜单，别互踩）、后端 service 改动杀 8137 重起。

红线（runbook §2/§3 + 全局）：凭据不经 agent（登录动作人手）；同体 404 无枚举；C 区殿后+跑完重建 dev dist；en.ts 唯一文案源+zh 增量；新输入框中文 aria；填前端 env 前先确认探测口径（记忆条目历史坑）。

## Blocked by

None（不依赖语料与 CRUD；串行序排在 09 后——claim 素材用三亚示例团队最顺，但非硬依赖）
