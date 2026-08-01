# ⟳ 2026-07-30 · 三波战役全上产收官态（★最新，从这里接；本文件=当前快照，历史看 git）

> 接续只靠本文件 + `progress.md` + `feature_list.json` + git，不回放聊天。
> 更早的逐棒 handoff 已从本文件清出（2026-08-01 换血）——要考古用 `git log --follow session-handoff.md` 按日期捞旧版。

**一句话**：naming-0729 + output-form-0729 + files-hub-0729 三战役 14 提交已于 07-30 前后端同上生产
（含 pg_registry 原件销毁 bug 的真库 born-red 实证修复），`main` 与 `origin/main` 推平，无攒着的提交
（产品基线 = `8769f6b`，其后 main 只有 docs/快照类提交）。
当前无 active 编码线，下一棒从「真 brain 取证」或独立票 #26–#29 起。

## 现在线上是什么

- **前端** averylite.dannyqian.com = `origin/main`（Vercel 自动部署 ● Ready；产品基线 `8769f6b`，其后仅 docs 提交）。
- **后端** avery.dannyqian.com = 镜像 `avery-agent:main-20260730-125353`（SWAP SUCCESS，回滚梯
  `avery-prev-20260730-125353` 保留）。
- 用户可见新面：/files 资料库第 10 屏（逐份下载 + 多库切换）、vision 降设置菜单、大白话命名
  （今天/团队/问 Avery/值得注意）、议事室纵向滚动 + 短答气泡、/paperwork 文件与表单页。

## 下一步（按优先级）

1. **真 brain 分流取证**：生产 LLM 链路自启动零调用（`llm_calls_remaining` 恒 2000）；
   answer_direct/CHAIN_HINT 判据只有 mock 层有门。手动走一次真 brain 提问，留证。
2. **独立票 #26–#29 一张没开工**：#26 笔记回流真记忆 · #27 上传实现合一 ·
   #28 文件写端点（⚠ 前置=给 `SourceDocument` 稳定 id，现按下标寻址）· #29 tab 合并观察。
   另有换血抢救票 **#31**（05b 重传合并）/ **#32**（lite/lite2 引擎收敛，#27 只盖上传一角）。
3. UI 线头条仍是**真机零覆盖**（iOS Safari/微信一次没跑过，合伙人上轮 bug 正是真机逮的）；
   agent 线开放项与成本票（put() 每写重嵌 40–45s）见 `progress.md` What's Next。
4. 合伙人端到端反馈一到，放下一切先处理。

## Verification state（部署时点账实）

- 全电池 `run-battery.mjs` 连续两轮 **27/27**（A21/B3/C3）；离线 pytest 四 deselect
  **3469/0/4 xfailed**；像素基线 40 张单机重冻后零漂移。
- pg 修复三跑：旧镜像 404（born-red）→ 预检新镜像 200 sha 同 → swap 后生产 200 sha 同。
  全文 `.issues/files-hub-0729/receipt-deploy-0730.md`。

## 别再踩的坑（常青集在 AGENTS.md「易复发陷阱」段，这里只留最新增量）

- 上传型门（verify-context-switch / file-manifest-truth / onboarding-returning）绝不排
  C 区 bundle-privacy 之后；碰上传路径前先验 `window.__AVERY_BUILD__.apiBase`。
- 跑门电池独占跑（与 agent 工作流并发=假红）；build+preview 用 `node vite.js`，不用 vite dev。
- pytest 必带四 deselect（本机 .env 有真 key）；GBK 控制台跑中文 py 要 `PYTHONIOENCODING=utf-8`。
- 判闸门别用 `.lite-onboard-card`（生产死选择器，恒 0）；用 `.lite-onboard` 或 `[data-gate-doors]`。

## 站着别动的事（Danny 闸）

- 凭据轮换 · 裸「风险：」词表 · `origin/p5-04-nexus-safe-zone` 处置 · 六个旧 worktree/分支清理（删除闸）。
- 法律件对外风险归合伙人（Danny 已定，工程线不捡）；合伙人旧口径「不打分不排名」由 Danny 亲自同步。
- demo 克隆副本累积的过期清扫=删除类，先问。

## 环境（收尾态）

- 本地 8137/5173 未挂进程；`dist/` 状态不确定，用前先验 apiBase。像素基线为本机产物，跨机重采。
- 账目债：`feature_list.json` 缺 naming-0729 / output-form-0729 两战役行；feat-019（酒店包）
  名义 in_progress 实为外置研究挂账。
