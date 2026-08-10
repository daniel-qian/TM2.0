# 0810 统一上产回执（六票 + 一条上产后修复）

> 执行 session：0810 设计轮收尾。**前后端同一个窗口内完成**（progress.md 的硬纪律）。
> 前端 `35ade3d` · 后端镜像 `avery-agent:main-20260810-212220`。

---

## 1 · 上产前的独立复验（不看各线回执自述，自己跑）

| 检查 | 结果 |
|---|---|
| `npm run typecheck` | 绿 |
| 离线 pytest（`TZ=UTC` + 三件套 + demo-seed） | **4135 passed · 0 failed**（基线 4049 → 新增 86 条） |
| `needs_db`（**全新** throwaway 库） | **130 passed · 0 failed** |
| 像素（主检出、对合并后的 main） | **8 passed · 0 首写 · 54 张** |
| 门电池 A 区（合并后的 main） | **37/37 绿**（含四道新门 files-explorer / change-log / room-rail / archive-empty） |

⚠ **我自己差点误报一次**：第一次跑像素是 8 红，看着像六条并行线把基线跑坏了。
翻日志才发现是**没起后端**——`?transport=stub` 切不掉「探测后端能力」那一路，
首页因此少一块、31579 像素差。起后端重跑即 8 绿。**这条碑在 memory 里，我照样差点栽。**

## 2 · 🔴 升级路径真跑（这轮最险的一步）

#87 给 `PersonEntity` 加了**顶层** `lineage` 字段，按 `0009` 的纪律**就地改**了迁移
（没叠新文件），`want` / `ADD` **两处清单都补了** —— 只改 ADD 的话会「离线全绿、真库逐条拒收」。

全新库跑绿**证不了升级路径**（那是从零建表）。所以另做了一次真升级：

1. `CREATE DATABASE upgrade0810`；
2. 用**生产那个 commit（`99d83f7`）的 15 个迁移文件**把库建成生产现状 →
   实测 CHECK **不含** `lineage`（＝生产库当时的真实状态）；
3. 用**新代码**的 `PostgresContextRegistry` 打一次无害 `get()` 触发 `_ensure_schema`；
4. 复查：CHECK **已含 `lineage`** · `form_submissions.auto_key` 在（0015）· `advise_runs.thread_id` 在（0016）；
5. 对着**这个升级过的库**跑 `needs_db -k "lineage or contract or protocol or empty or append or delete"`
   → **112 passed · 0 failed**。

## 3 · 上产顺序（先后端、后前端）

**刻意不是 push-first**：这轮后端改动全是**加法**（新端点 / 新列 / additive payload key），
旧前端配新后端安全；反过来新前端配旧后端会调到不存在的端点。
（实际执行时因为构建目录从 `origin/main` 拉，push 必须先发生，所以窗口是
「push → 立刻建镜像 → 预检 → 换容器」，两者间隔以分钟计。）

- **前端**：`git push origin main`（`a23fadb..0d85d3b`，92 个 commit）→ Vercel 自动构建。
  验证按碑走（**不只 grep index**）：index 里查到构建来源 SHA `0d85d3ba661d…`；
  业务串在 index 包内实测 `清空这份档案` / `上传文件` / `新对话` / `已查阅` 各 1，
  `另建一份画像` 0。
- **后端**：`build-zh` 同步到 `origin/main`(`0d85d3b`) → `docker build` →
  **预检容器 8138**（env 从**在跑容器** `docker inspect` 提取，31 个变量，不信 `~/avery.env`）→
  `/health` ok · `/demo/status available:true`（seed 挂载在）· 无害 404 触发迁移懒加载 · 日志零异常、零写库 →
  **`docker rm -f` 预检容器**（0723 那次留了 4 天撞端口）→ 换容器（旧的改名
  `avery-prev-20260810-212220` 保留为回滚梯，每条失败路径都 `rollback()`）。
  - ⚠ **踩了一个小坑**：预检第一次 `-p 8138:8000` 起不来——容器内监听的是 **8137** 不是 8000。
    照抄在跑容器的 `docker port avery` 才对。
- **换完复验**：公网 `/health` ok（brain=minimax、live=true、degraded=false）·
  `/demo/status available:true` · `POST /team/{id}/empty` 回 **404 而非 405** ＝ 新路由在。

## 4 · 🔴 上产后复验逮到一条真 bug，已修并二次上产

`filesAppendDemoNote` 是**活文案**（`FilesScreen.tsx` 的 `uploadBlocked` 分支真渲染），
原文让用户「在左栏的**「新建一家公司」**里建一家属于你自己公司的」——
**而那块正是 #88 整条撤掉的**。

讽刺的是这正是 #88 自己发现并向 Danny 要来拍板的那条死胡同：领了示例团队的人想换成自己的资料，
出路本来是「新建一家公司」，砍掉之后 Danny 拍「清空即认领」（`empty_context` 清 `ephemeral`）。
**#88 修了机制那半，漏了文案这半** —— 于是那条死胡同换了个形态活了下来：
用户被指挥去点一个不存在的按钮。

- 修法：zh / en 双改，指向真实出路「左栏最底的『清空这份档案』——清空之后这份档案就归你了」。
- i18n **只手工 Edit**，未跑任何 `i18n-zh*.mjs`；`i18n-orphans` 孤儿 0 → 0。
- 二次上产 `35ade3d`，轮询确认 Vercel 已服务该 SHA。
- **教训**：「机制改了、指向那个机制的文案没跟着改」是撤除类改动的固定盲区。
  `i18n-orphans` 对它**是瞎的**——键没变成孤儿，它只是开始撒谎。

## 5 · HITL 端到端演习（对着**生产**）

安全边界：只碰本次自己 `POST /demo/claim` 出来的一次性克隆（`ephemeral`，会被 GC 回收）；
**零上传到生产**、不碰任何真实用户 context。

`ctx_e707bcd56a8f`（9 份文件 / 16 人），桌面 1440×900 + 手机 390×844 各走一遍：

```
① 对话侧栏常显（.lite-room-aside ×1）         PASS
② 新对话入口在                                 PASS
③ data-history-toggle 仍在 DOM                 PASS
④ 上传口在工具条上                             PASS
⑤ 清空入口在                                   PASS
⑥「新建一家公司」已绝迹                        PASS
⑦「另建一份画像」已绝迹                        PASS
⑧ 示例说明在场                                 PASS
⑨ 示例说明指向「清空这份档案」而非被砍入口      PASS  ← §4 那条修复的在线证明
⑩ 文件清单有行（×9）                           PASS
⑪ 手机文件行等高：9 行 / **1 种高度** [51px]    PASS  ← 原来 4 种高度 3 种内部顺序
⑫ 零 pageerror（桌面 + 手机）                   PASS
13/13
```

截图人眼过：资料库两栏 explorer 与对话页下陷贴边侧栏均与原型一致；
示例克隆下「上传文件」钮置灰（诚实，不是假按钮）。

## 6 · 现状与回滚

- 前端 <https://averylite.dannyqian.com> = `35ade3d`
- 后端 <https://avery.dannyqian.com> = `avery-agent:main-20260810-212220`（healthy）
- **回滚梯**：退一级 = `avery-prev-20260810-212220`（= `main-20260807-190332`，上一版生产镜像）。
  `sudo docker rm -f avery && sudo docker rename avery-prev-20260810-212220 avery && sudo docker start avery`
- 迁移已在生产库落地（0009 就地升级 + 0015 + 0016），由预检容器的无害 404 触发。

## 7 · 留给下一个人

- 🔴 **`/health` 仍没有 version/commit 字段**——「生产跑的就是这个镜像」目前只由 swap 日志自证、
  外部不可核。这条债从 07-21 挂到现在，加一行就能验。
- ⚠ 机器上 `avery-prev-*` 已堆到 5 个以上、`__snapshots__/.bak/` 有 7 月残渣、
  本地 42 个 worktree / 46 条 `claude/*` 分支 / 2 条 stash —— **删除类归 Danny**。
- ⚠ 本次演习那份 demo 克隆 `ctx_e707bcd56a8f` 是 ephemeral，等 GC 回收即可，不必手动清。
