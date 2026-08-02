# sweep-promote-0802 · 合并上线 + 生产盘点回执（2026-08-02）

**一句话**：`claude/codebase-architecture-improve-20b9eb` 12 提交快进合回 main 并全量上生产；
盘点结论 —— **零客户原件受损**，唯一命中是 07-30 born-red 演示里被故意牺牲的一份 ephemeral
demo 克隆，且已被应用自带的克隆 GC 扫掉。

## 合并

- `git merge --ff-only`：`12282e8 → 0884d49`（**快进**，main 无分叉，零冲突）。
- 12 个提交＝走查落盘 1 + 促修 11（arch-1..6 / ui-A..C / pg 全列守卫）。

## 合前后跑门（[[merge-to-main-from-own-worktree]] 纪律）

环境：mock 后端 8137（`AVERY_BRAIN=mock` + `AVERY_EXTRACTOR=heuristic` + `AVERY_EMBEDDINGS=keyword`
＋ `AVERY_DEMO_SEED_DIR`）· `vite build --mode development` + `vite preview 5173 --host`
（127.0.0.1 / localhost / [::1] 三路皆 200）· dist 内零生产域名。

| | 前端电池 | 后端 |
|---|---|---|
| **合前（main 基线）** | **27/27 绿** | 3469 passed（四 marker 反选） |
| **合后** | 25/27 → 复核后 **27/27 绿** | 裸 `pytest` 3473 passed；`-m needs_db` 对本地 avery-pg **65 passed** |

另跑：`scripts/css-scope-check.mjs`（arch-1 新门）exit 0。

### 两条合后红的复核 —— 都不是回归

**① `null-owner` = 假红（flake）。** 失败点是 `route.fetch` 对 mock 后端 `POST /ingest`
的 `socket hang up`；后端当时健康（`/health` 200，日志无异常）。**单跑复验 15 PASS / exit 0。**

**② `visual-baseline` = 基线陈旧，非代码回归。** 四张漂移（paper-home ×2、aurora-team ×2）。
定因过程（不是猜的）：
- 先证伪 CSS 嫌疑——把 `lite2.css` 换回 `c27c34e^` 重打再跑，**像素差字节数完全相同**
  （24213 / 15523 / 315 / 312），排除 arch-1 的作用域改造。
- 再实测根因——页内探针：`document.documentElement.lang` 现为 `zh-CN`（623aac9 的本意修复），
  把它改回 `en` 后 `.upload-dropzone` 的 `top` 从 **478.36 → 483.36**，正是截图上的 ~5px 位移。
  即 Chromium 在 `lang=zh-CN` 下的 CJK 断行/字体回退度量与 `lang=en` 不同。
- **基线是 lang 修复之前冻的**，所以漂的是基线不是代码。人眼过了 paper-home（实拍正确、
  无破版）与 aurora-team（只有 composer placeholder 一处度量差）。

重冻 `--update-snapshots` 后 **40 张里实际有 26 张变了**——远多于报红时看到的 4 张，
因为 spec 每条 test 串跑 10 次 `toHaveScreenshot`、**首处不匹配即中止**（spec 文件头自己写着这条）。
拿 md5 前后对比才拿到完整清单：paper 20 张 + aurora 6 张，另两条真改动同期入账
（`d7d8db7` 的 followups 断行与 projects 空态 CTA 改指资料库）。复跑 **4 passed / exit 0**。
⚠ 像素基线是 gitignore 的单机产物，这次重冻只在本机生效。

## 上线

- **前端**：`git push origin main`（`12282e8..0884d49`）→ Vercel 自动构建。
  线上核对不是只看 200，是**核产物**：
  `assets/index-*.js` 含 `去「资料库」上传`（d7d8db7）与 `onboardDoorsBodySolo`（42ef1e7）；
  `assets/index-*.css` 含 `.lite2-shell .upload-dropzone`，裸 `.upload-dropzone{` 只剩 1 处
  （= v01 的 lite.css，正确）。
- **后端**：镜像 **`avery-agent:main-20260802-113944`**，从 `/home/admin/build-zh` @ `0884d49`
  构建（`git reset --hard origin/main`，**默认从 main 构建**，无子集）。
  - env 从在跑容器提取到 `/tmp/avery_env_20260802-113944`（600，**29 行**，只取
    `MINIMAX_/DASHSCOPE_/DEEPSEEK_/AVERY_/SUPABASE_` 前缀的应用配置；PATH/PYTHON_*/LANG 等
    镜像自带项不再回灌，避免新镜像被旧 PATH 覆盖）。`AVERY_DB_URL`、`AVERY_ALLOW_PERSON_SCORING=1` 均在位。
  - **隔离 8138 预检**：health ok（brain=minimax、live=true、embeddings=dashscope:text-embedding-v4/1024、
    degraded=false、rss 54.1MB）·`/demo/status` = `{available:true, ready:true}`。**只走不写库的路径。**
  - `swap3.sh` 换容器：**SWAP SUCCESS**，健康闸 1×2s 过。
  - **预检容器已 `docker rm -f`**（8138 释放，不重演 0723 那次占口 4 天）。
  - **回滚梯**：`avery-prev-20260802-113944`（= 旧 `avery-agent:main-20260730-125353`）。
    ```bash
    sudo docker rm -f avery && sudo docker rename avery-prev-20260802-113944 avery && sudo docker start avery
    ```
  - 迁移懒加载：用 `GET /team/ctx_doesnotexist` → 404 主动触发 `_ensure_schema`（本轮无新迁移，空放）。

## 🔴 生产库原件盘点（本棒的正题）

查询：`SELECT context_id, filename FROM avery.source_documents WHERE content IS NULL AND status='ingested'`
（Supabase `zlxpldzapyoacmgvlqpn` / avery-fra）。上线前后各跑一次，结果一致。

**上线时命中 9 条，全部落在同一个 context：`ctx_042971e0f6f6`。**

| context_id | ephemeral | 建于 | 改于 | 命中 | 文件 |
|---|---|---|---|---|---|
| `ctx_042971e0f6f6` | **true** | 07-30 04:56:01 | 07-30 04:56:42 | 9/9 | demo 母本那 9 份（公司概况与部门手册.md、员工花名册.md、…、项目总览.md） |

**判定：不是客户数据，是 07-30 那次 born-red 演示的被试。** 三条互相独立的证据：
1. `ephemeral = true` —— 它是 `/demo/claim` 铸的一次性克隆，不是任何人的真 context；
2. 时间戳对得上 —— 建→改相隔 **41 秒**，正是 0730 回执里「跑 2 · 旧镜像 · 写入 40.8s」那一跑；
3. 邻居对照 —— 同批另外三个克隆（`ctx_9ce92dc68d63` 04:53:49、`ctx_5811335e800f` 04:54:45、
   `ctx_22585bb73157` 04:57:25，都是 44/44.5/42s 的写）**`content` 一条没丢**，正是跑 1 与跑 3
   （新镜像）。换句话说这份"损伤"恰恰是当时那条实锤的**残骸**，不是新伤。

**全库其余 260 份 source_document 的 content 一条没缺，`materials.embedding` 零 NULL**
（即 arch-4 顺手治的那个"向量被抹→检索静默降级 keyword"的同源二号病，在生产上从未发作过）。

**按令不擅自补救**（数据修复属销毁类邻域）。而且事后也不必了：收尾复查时它**已经不在了**——
`/demo/claim` 里的机会式克隆 GC（`_sweep_expired_clones`）在本轮探针请求时把过期克隆连带扫掉，
库从 108 context / 269 doc 降到 **97 / 224**，盘点查询现在返回 **0 行**。

### 顺带核到的一件事：本次修的 key 分裂在生产上没有敞口

arch-4 把回填键统一成 `COALESCE(NULLIF(source_key,''), filename)`（老 SQL 的 `COALESCE` 只认 NULL、
认不出 `''`）。查了一遍：生产 269 份文档里 `source_key` **为空串 0 份、为 NULL 0 份**。
所以这个修复补的是**将来**的洞，不是正在流血的伤口——但仍然该修（内存耦合也一并消掉了）。

## 写路径真跑验证（不是只看 health）

被试仍用 `/demo/claim` 的一次性克隆（0730 立的先例：走同一个生产 Postgres、同一条 `get→改→put`，
但不是任何客户的真 context）。

| 步 | 结果 |
|---|---|
| ① 领克隆 | 200 · `ctx_71d3f38d9b9d` |
| ② 写入前 `GET /files/0` | 200 · sha `a7504e9b…` · 2267 B |
| ③ `POST /projects` 加一个项目 | **200 · 50.1s** |
| ④ 写入后 `GET /files/0` | 200 · sha `a7504e9b…` · 2267 B **逐字节相同** |
| ⑤ 库内复查 | `docs 9 / content NULL 0`、`materials 212 / embedding NULL 0` |

⚠ **第一次跑这条探针出过一个假绿，值得记档**：curl 版本里第 ③ 步返回 **400、耗时 1s**——
写压根没发生，于是第 ④ 步的"字节相同"是**空真**。改用 Python 探针（400 的真因是 Windows 
Git Bash heredoc 里中文标题的编码，不是服务端问题）拿到真 200 之后，这条才算数。
**写没成功时的"前后一致"不是证据**——正是 `green-gate-not-equal-verified` 那条。

顺带量到：一次手编写入仍要 **50 秒**（0730 量到 40–45s）。CRUD 全量重嵌的成本票 Danny 已拍板
「先不管，等真实客户量再立」，此处只记数。

## 现在的线上状态

- 前端 `https://averylite.dannyqian.com` = main(0884d49) 产物，三处改动已核到产物层。
- 后端 `https://avery.dannyqian.com` = `avery-agent:main-20260802-113944`，health ok / degraded=false /
  demo ready。写路径经真库探针验过。
- 生产库：97 context / 224 doc，**原件缺失 0 条、向量缺失 0 条**。
