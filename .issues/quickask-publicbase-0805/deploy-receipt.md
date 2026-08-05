# 生产 P0 回执：快问员工链接拼在死域上（2026-08-05）

## 事故

0805 生产走查（证据：`D:\Boyle\research\avery\walkthrough-0805\REPORT.md` + `runlog.json` step 8）：
发起快问后 store 返回的员工链接是 `https://avery.ima-read.com/r/{token}`，该域 **DNS 不解析**
（Non-existent domain），员工打开白屏。反证：同一 token 换到
`https://avery.dannyqian.com/r/{token}` 返回 200 + 完整中文 H5——功能本体一直是好的，
坏的只有铸链接用的域。

## 根因（两半）

1. **生产容器 env 没设 `AVERY_PUBLIC_BASE`**（法兰克福，`avery-agent:main-20260804-153841`）。
   已在机器上坐实：`~/avery.env` 里确实没有这个变量。
2. **代码里的死默认值**：`eval-harness/service/ask_api.py` 的 `public_base()` 缺省
   `https://avery.ima-read.com`——PRD Q11 的 v1 域名方案，早被 ADR-0024（单目标法兰克福后端）
   取代，但这个子域**从未真正解析过**。env 一缺省，死域直接上桌。

## 修了什么

| 半 | 动作 | 落点 |
|---|---|---|
| 代码 | `public_base()` 默认值 → `https://avery.dannyqian.com`（真在线域），docstring 记 ADR-0024 取代 Q11 | `eval-harness/service/ask_api.py`（commit `77486fc`，merge `4bc6085`） |
| 测试 | 新增 `test_share_default_base_is_a_live_domain`：**env 未设**时锁死默认 host 且断言 `ima-read.com` 永不回归（既有 share 测试全 `setenv`，盖不住这条路——正是"验证器采错屏"一族）；既有 mints 测试的显式 env 值同步换真域 | `eval-harness/tests/test_ask_http.py` |
| 门 | live-frontend-gate K2 host 断言 `ima-read` → `dannyqian`（不改会对着修好的后端假红） | `scripts/gates/live-frontend-gate.snippet.js` + `.md` |
| 生产 env | `AVERY_PUBLIC_BASE=https://avery.dannyqian.com` 进 `~/avery.env` 与换容器 env 快照 | 服务器（备份 `~/avery.env.bak-20260805`） |
| 换容器 | 从 main(`4bc6085`) 构建 `avery-agent:main-20260805-134620`，8138 预检 → `/tmp/swap3.sh` 换 | 生产现跑该镜像；回滚梯 `avery-prev-20260805-134620` 在位 |

## 预检顺手抓到的第三个坑（差点周末 demo 没了）

第一轮预检用 `~/avery.env` 做 env 快照，`/demo/status` 直接 `available:false`——
**`~/avery.env` 不是完整口径**，比在跑容器少 5 个变量：`AVERY_DEMO_SEED_DIR`、
`AVERY_RATE_DEMO_BURST/PER_MIN`、`SUPABASE_URL`、`SUPABASE_ANON_KEY`。
拿它换容器 = demo 门静默消失 + 登录能力探测失效（swap2 事故的同族变体）。

处置：换容器 env 快照改为**从在跑容器 `docker inspect .Config.Env` 原样提取**（剔除
PORT/PATH 等镜像自带项）+ 追加本次新变量；`~/avery.env` 已同步补齐到 30 个变量与容器对齐。
**下次换容器仍以在跑容器为准**，别信文件。

## 验证

- 离线电池：worktree 与 main 各跑一遍，均 **3528 passed, 74 deselected, 4 xfailed**（新增 1 条即本票测试）。
- 预检（8138，只读路径，跑完已 `docker rm -f`）：`/health` ok（brain minimax live）、
  `/demo/status` `{"available":true,"ready":true}`、容器内 `public_base()` = `https://avery.dannyqian.com`。
- swap 日志：NEW HEALTHY after 1x2s，SWAP SUCCESS。
- 外部：`https://avery.dannyqian.com/health` → 200；`/demo/status` → available:true；
  生产容器内 `public_base()` = `https://avery.dannyqian.com`。
- 端到端：走查那条真员工 token `GET /r/13_SDS9…PMS8` 在新容器上 **200**。
- 新铸链接的完整端到端（真发起一次快问）**没做**——那要往生产库写测试数据（0720 红线）。
  链路上唯一的域名源就是 `public_base()`，容器内实测 + 单测锁死，判定够。

## 同族清尾（0805 当天第二票，Danny 点名"连 F2 一并清"）

- **五处 `ima-read.com` 全清**：lite/lite2 两个 stubTransport 的假链接、story
  `QuickAskCard` 的演示链接、lite/lite2 transport.ts 注释示例域 → 全换
  `avery.dannyqian.com`。`grep -rn ima-read src/` = **0**。
- **F2 真正的缺口顺带补上**：lite2 壳的 AskCard **漏渲染 `.ask-offline-note`**——
  feat-068 只搬了 `offlinePreview` 声明和红线提示分流，离线标记那行没搬（lite 壳 :234 有、
  lite2 没有）。已从 lite 壳补齐（TSX 渲染行 + lite2.css 同款样式）。生产行为零变化：
  该标记只在 `transport.offlinePreview`（stub 通道）下渲染，真 HTTP transport 恒缺省。
- **验证**（stub 是 DEV-only，build+preview 采不到——按 dev+stub 真集成层验）：
  `npm run build` 绿；dev(5175) + `?mode=live&transport=stub` 下经 `__lite2Store`
  seam 走 uploadFiles → askLive → confirmAsk 真链路，`.ask-offline-note` 在、可见
  （34px 高、3px terracotta 左边框）、文案「离线预览——这些链接只是示意，点不开。」，
  两条 stub 链接均为 `https://avery.dannyqian.com/r/tok_ask_stub_1_r*`；
  Playwright 整页截图人眼过（卡片布局零破相）。
  ⚠ 过程中踩了两个 memory 已挂号的坑：Browser pane 截图超时（退本地 Playwright）、
  element 截图采到空区 + onboarding 闸门页盖脸（整页截图 + 先点「跳过设置」）。
