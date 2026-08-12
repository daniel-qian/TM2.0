# 0812 上产回执（#89 · 抽取降级可见 + 供应商热备 + /health 不撒谎）

> 前端 `6b70173`（Vercel）· 后端 `avery-agent:main-20260812-070519`（同一 commit）。
> 起因是 0811 合伙人真实翻车：MiniMax Token Plan 用尽 → 每次抽取 429 → 降级正则 →
> 13 人花名册抽出 0 人，而屏上每一句都在说一切正常。

---

## 1 · 上产前的独立复验

| 检查 | 结果 |
|---|---|
| `npx tsc -p tsconfig.app.json` | 绿 |
| 离线 pytest（TZ=UTC + 三件套 + demo-seed） | **4146 passed · 0 failed**（基线 4135 → 新增 11） |
| 门电池 A 区 | **38/38**（含新门 extraction-degraded） |
| 门电池 B 区（含像素） | **3/3**，像素 28+8 全绿 · **零漂移** · 54 张基线真比对 |
| 门电池 C 区 | **3/3** |

### 变异实证（四发，逐条对上判据）

| 变异 | 红了哪条 |
|---|---|
| `=== 'degraded'` → `!== 'llm'` | ① ④ |
| 首帧不从 localStorage 取回 | ③（**② 仍绿**——两刀砍两处） |
| `emptyArchive` 不清标签 | ⑥（恰好一条） |

🔴 **第二发顺带逮到门自己的洞**：初版每步都跟一发 `gotoFiles()`（整页导航），于是 ②
走的其实是 localStorage 那条路、和 ③ 测的是同一件事——「传完待在原地不动」这条**最常见的
动线**一条判据都没盖到。已拆成 ② 只吃内存态 / ③ 只吃持久化。
**门全绿的时候它是有洞的，是变异把洞照出来的。**

## 2 · 上产顺序

**push → 建镜像 → 预检 → 换容器**（构建目录从 `origin/main` 拉，push 必须先发生）。

- **前端**：`git push origin main`（`bcfdfe9..6b70173`）→ Vercel 自动构建。
  验证按碑走（不只 grep index）：⚠ 这次 SHA **不在 index.html 里、在 JS 包里**
  （`commit:"6b70173c…"`），四条新文案串在包内实测各 1 次。
- **后端**：`docker build --build-arg AVERY_COMMIT=$(git rev-parse HEAD)` → 预检 8138 →
  换容器，旧的改名 `avery-prev-20260812-070519` 保留为回滚梯，每条失败路径都 `rollback()`。

### ⚠ 预检踩到两个坑（都记下来）

1. **容器内部监听 8137，不是映射出去的 8138。** 在容器**里面**打 8138 → `Connection refused`。
   这和 0810 那次是同一个坑换了个方向：那次是 `-p 8138:8000` 猜错内部端口，这次是脚本跑在
   容器内还用外部端口。**一律照抄 `docker port avery`。**
2. 🔴 **只抄 env 不抄挂载 = 示例团队会消失。** 第一次预检 `/demo/status` 回
   `available:false` —— seed 是**只读 bind mount**（`/home/admin/avery-demo-seed → /app/demo-seed:ro`），
   不在 `docker inspect` 的 Env 里。差一点就把示例团队换没了。
   **换容器前必查 `docker inspect --format "{{range .Mounts}}…"`。**

## 3 · 生产复验（真跑，不是读码）

### 后端 `/health`（公网）
```
commit:           6b70173c46b8eed66c579e28c4204d40cbec17e7   ← 7-21 挂到今天的债还清
extraction_chain: ["minimax", "deepseek"]                    ← 热备已装填
providers:        minimax {ok:null}  deepseek {ok:null}      ← 诚实的「没被调用过」
degraded:         false
```

### 用**她的原始字节**在生产上真跑一遍
`ctx_c1dfe797b6c2`（已标 ephemeral）：**13 人 · 5 项目 · 20 片段 · 1 轮对话**。
人名逐个对上：王岚/林雅/周启明/刘嘉怡/叶舒然/赵宁/胡俊/郑婉婷/何嘉宁/唐可欣/孙悦/许安琪/陈浩。
**0811 那天同样这两个文件抽出的是 0 人 0 项目。**

### 遥测真翻牌
预检容器上真调一次后：`minimax {ok:true, at:…}` · `deepseek {ok:null}`。
**没被调用过的那家仍然是 null，不是假绿** —— 这正是设计意图。

### DeepSeek 热备不是装饰品（配额充值后单独验）
强制 `AVERY_EXTRACTOR_BRAIN=deepseek`，用她的原文件真跑：**13 人 + 5 项目**，
`degraded:false` · `mode:llm`。
⚠ 生产 env 里 `DEEPSEEK_MODEL=deepseek-v4-pro`（推理模型，`<think>` 吃 token），
代码给它 `max_tokens=8192` 而 M3 拿 32768 —— **实测 8192 够用**，但这是个容易漏的坑。

### 横幅在**生产包**里真接了线（7/7）
对着生产站 + 一次性 demo 克隆，网络层把 `extraction_mode` 改成 `degraded`：
① 基线无横幅 → ② 改包后横幅上屏且三句话齐 → ③ **刷新后仍在** → ④ 零 pageerror。
**零文件上传到生产**（只碰自己 `POST /demo/claim` 的 ephemeral 克隆）。

### advise_runs
生产上落到 **2 行**（0812 之前是**全表 0 行**）。写入路径健康 —— 那张表长期为空的根因是
「表存在以来没有过一次成功产出 manifest 的带 context 提问」，0811 每一次都在出 manifest
之前就撞 429 挂掉了。

## 4 · 现状与回滚

- 前端 <https://averylite.dannyqian.com> = `6b70173`
- 后端 <https://avery.dannyqian.com> = `avery-agent:main-20260812-070519`（healthy）
- **回滚梯**：退一级 = `avery-prev-20260812-070519`（= `main-20260810-212220`）
  ```
  sudo docker rm -f avery && sudo docker rename avery-prev-20260812-070519 avery && sudo docker start avery
  ```
- 本次验证造的三个 context 全部 `ephemeral=true`，等 GC 回收，不必手动清。

## 5 · 🔴 人眼过图逮到的、**没修**的一条

生产截图上：横幅说「**有文件没能读懂**」，底下每一行状态却是绿色的「**已读取**」。
贴在一起看着自相矛盾。

机制上它是自洽的 —— 两根不同的轴：

| | 判的是什么 | 来源 |
|---|---|---|
| 状态列「已读取」 | 这份文件切出了文字片段（**解析**） | 每文件 `chunk_counts > 0` |
| 降级横幅 | 文字有没有被理解成人和项目（**抽取**） | 整批 `extraction_mode` |

**但「已读取」这个词读起来就是"读懂了"。** 方案里写过「顺带把这个词的语义看一遍」，
这次**没做** —— 它不是顺手改得动的：

- `verify-file-manifest-truth.mjs:164` 逐字断言 `statusText === '已读取'`
- `verify-contrast-smalltext.mjs` 拿它当 `--sage` 色的采样面（3.9–4.11:1，本来就贴着地板）
- 三态（ingested/empty/failed）各有自己的诚实 hint，改一个要一起看

**留给下一轮**，别在上产窗口里顺手动。

## 6 · 未做（归后续）

- **账号 / onboarding 模型重设计**。事实：`auth.users` **0 行** · `account_contexts` **0 行**
  —— 账号层配好了但从未被任何人真跑过一次，包括 Danny。现在的真实模型是
  「一个浏览器 = 一份档案，清缓存就没了」。
- **红线第二层从未上过生产**（考古结论，见 §7）。
- ⚠ `avery-prev-*` 已堆到 4 个以上 —— **删除类归 Danny**。

## 7 · 考古：DeepSeek 当 checker 那个设计去哪了

Danny 记得没错，**做过、真跑过、还真抓到过东西 —— 但它从来不在产品运行时，它在评测台**。

- `b8d1cda fix(011)` 加了 **LLM redline arbiter**：红线是**两层设计** ——
  第一层 `avery/redline.py` 确定性正则门（高召回、可发布、可审计），
  第二层跨家族 LLM judge（票 011c）兜住微妙/新颖的改写。
  `redline.py` 文件头至今写着这句话。
- `e9ae1dc feat(011/012)`（2026-06-21）把 **DeepSeek 接成独立第二判官家族**，
  `JUDGE_FAMILIES` 默认 `deepseek + minimax`。选它的理由：DeepSeek 与被测的 MiniMax 无关，
  而 MiniMax 当自己的判官会被打上 self-preference 标记。
- **真抓到过**：`EVAL-RESULTS.md` §3c —— 确定性门把 raw-M3 的 Priya 建议判红（它引用
  「2/5 / bottom-quartile」其实是为了**拒绝**打分），DeepSeek 和 MiniMax 两个判官各自独立
  判定 `real_person_score=false` → 记为 `deterministic_redline_false_positive = 2`。
- **但它只活在评测台**：`service/` 与 `avery/` **零 import judge**；`judge.py` 只被
  `runner.py` 用；最后一次真跑 **2026-07-01**（`runs/real-0701c`）。
  时间线对得上 —— ADR-0020「从纯 demo 毕业成 live 产品」在 7 月中，此后力气全在产品工程上。

**结论：没被推翻，也没丢，是从来没跨过那道界。**

🔴 **今天的 failover 与它是两件事**：failover 是**替换**（这家不行换那家，目的是可用性）；
那个是**复核**（两家都答，分歧本身是信号，目的是正确性）。
生产上红线**只有确定性那一层在跑**（`contract.py` / `ask_api.py` 里 `redline.validate`
确实每条建议都跑，护城河没缺），当年为它准备的语义仲裁至今在评测台上放着。
要不要捡回运行时是个真决策：代价是每条建议多一次模型调用。**建议单开一票。**
