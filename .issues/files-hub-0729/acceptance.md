# 资料库战役（files-hub-0729）· 验收手册

- 日期：2026-07-29
- 范围：GitHub #21 父票 / #22 #23 #24 四切片（#25 = 本文件所属的收官片）
- 提交：`3003401`（01）· `0bd1c30`（02）· `5383adb`（03）· 本片收官
- ADR：[0032](../../docs/adr/0032-files-hub-tab-and-vision-demotion.md)
- ⚠ **未推**：main 领先 origin/main 若干 commit，push 是人工闸（AGENTS.md § Autonomy & gates）。

## 一、自己验一遍（10 分钟）

### 0. 起环境

```bash
cd /d/avery/eval-harness && AVERY_BRAIN=mock AVERY_EXTRACTOR=heuristic AVERY_EMBEDDINGS=keyword AVERY_DEMO_SEED_DIR=tests/fixtures/demo-seed /c/Python313/python.exe -m uvicorn service.app:app --host 127.0.0.1 --port 8137 --app-dir .
```

```bash
cd /d/avery && node node_modules/typescript/bin/tsc -b && node node_modules/vite/bin/vite.js build --mode development && node node_modules/vite/bin/vite.js preview --port 5173 --strictPort --host 127.0.0.1
```

入口：`http://localhost:5173/?v=2&mode=live&lang=zh`（裸链会落回旧 story 壳）。
首访会弹引导闸，按 `Esc` 关掉。

### 1. tab 换防（30 秒）

- 顶栏应当是 **9 个** tab，队尾是**「资料库」**。
- **「完整版预告」不在 tab 里了**。点右上角 ⚙ → 菜单里应有一行「完整版」→「完整版预告」，
  点它能进原来那一页，且地址栏的 `?v=2&mode=live&lang=zh` 一个参数都没丢。
- ⚙ 菜单里语言/观感两行的位置没动（新入口插在 /paperwork 之后、「重新开始」之前）。

### 2. 资料库屏三段（3 分钟）

进「资料库」。没传过东西时应该看到：页头 →「当前资料」+ 一句「还没传过材料」→「上传新一批」。

传一批（随便一个 `.csv`/`.md`）：

- 「当前资料」长出文件行：**文件名 · 大小 · N 处引用 · 状态**。
  🔴 状态那一格必须逐行都有话说。没有 status 字段的老后端要显示「状态未知」，
  **不许**默认显示成「已读取」——缺席不等于成功。
- 每行右侧有**「下载」**。点它应该真的下下来一个文件，且**内容就是你传上去的那份原件**。
  （这个端点吃 owner_token，所以它走的是 fetch+blob，不是一条 `<a href>`。）
- 上传口上方有一段黄边说明：**「再传文件会另起一家公司」**——这不是提示语，是事实：
  后端每次 `POST /ingest` 都新铸一个 context，**不会合并**。

再传第二批（人名跟第一批不一样的花名册），然后：

- 屏底出现**「这台电脑上传过的」**，两条。当前那条左边有绿线 + 「当前打开的」，且**没有**
  「打开这一份」按钮（点了也不会发生任何事的按钮＝假按钮，故意不给）。
- 点另一条的「打开这一份」→ 团队屏的人应该**换回第一批**。
- 「从这个列表里移除」旁边写着「只是把这台电脑上的入口去掉，服务端的数据不会被删」——
  这就是它做的全部。

### 3. 团队屏零文件元素（1 分钟）

- 有数据时：右栏只有成员，**没有上传口、没有文件清单**。
- 没数据时（可 ⚙ →「重新开始」两击确认）：右栏是一张引导卡「还没有可读的材料」+
  按钮「去资料库」。
- 左栏那句引导语不再说「把几个文件拖到右边」（右边已经没有上传口了）。

### 4. 首页入口（30 秒）

- 首访骨架的**上传卡还在**（第一个动作不该先跳一屏），卡底多一条「去资料库管理 →」。
- 有数据后「资料概览」标题行右侧有「资料库 →」。

### 5. v1 刻意没有的东西（确认它们确实不存在）

**删除 / 重传 / 替换**在界面上一个都不该出现。后端这批写端点还没有（issue #28），
按「不建假按钮」红线，宁可没有也不摆一个点了必然失败的键。

## 二、机器验（已跑，可复跑）

| 项 | 命令 | 本轮结果 |
| --- | --- | --- |
| 全电池 | `SPEC_STICK=99 node eval-harness/tools/run-battery.mjs` | **27/27 绿，连跑两轮** |
| 后端 | `cd eval-harness && python -m pytest -m "not smoke and not seedgate and not needs_keys and not needs_db"` | **3469 passed · 0 failed · 4 xfailed** |
| 类型/构建 | `npm run typecheck && npm run build` | 绿 |
| 像素基线 | `node node_modules/playwright/cli.js test -c eval-harness/visual` | 重冻 36→40 张后零漂移 |

新增门：`eval-harness/tools/verify-context-switch.mjs`（A 区第 21 道，15 判据）。
它是**上传型门**，与 file-manifest-truth / onboarding-returning 同罪：
**绝不能排到 C 区之后**——C 区的 bundle-privacy 会把 dist 打成指向生产域名，
之后再跑上传型门就是往生产库里写测试数据（2026-07-20 真发生过）。

## 三、本轮修掉的、原 PRD 里没有的一个真 bug

**`pg_registry.put()` 会把用户上传的原件写成 NULL。**

`get()` 刻意不拉 bytea（`content=None`，免得为读一次名册把几 MB 上传整个进内存），
而所有手编 CRUD 都是 `get() → 改 → put()`。`put()` 先 `DELETE FROM avery.source_documents`
再按 `sd.content` 重新 INSERT——于是**一次「加一个项目」就把整批原始字节写成了 NULL**。

两层后果，第二层更重：

1. 下载键变成看得见、点得动、必然 404 的**假按钮**（本战役自己的红线，从后门进来）；
2. **用户上传的原件被永久销毁**——这一层与 UI 无关，改造前就已经在生产上成立。

修法：`put()` 在 DELETE 之前先把 `(source_key/filename → content)` 捞在手里，
INSERT 时**只对 `sd.content is None` 的回填**。

⚠ **这一条的真库验证还没做**：本机没有可用的 postgres，
`test_manual_crud_does_not_destroy_the_uploaded_bytes` 的 postgres 参数化跑不了。
现在兜住它的是 ① memory 参数化（会过，但证不到 pg 那一侧）+ ② 一条离线结构守卫
`test_pg_put_restores_bytes_that_get_deliberately_dropped`（删了修复就红）。
**部署预检必须在真库上跑一次那条行为断言**——这正是
`offline-suite-blind-to-pg-persistence` 那条教训说的：`not needs_db` 让整个 pg 层
对默认套件隐形，pg-only 缺陷会一路绿到部署当天。

## 四、留给后面的

| 票 | 事 | 状态 |
| --- | --- | --- |
| [#26](https://github.com/daniel-qian/avery/issues/26) | T1 笔记升级真记忆（append_note 回流检索层） | 未开工 |
| [#27](https://github.com/daniel-qian/avery/issues/27) | T2 两套上传实现合一（UploadPanel / OnboardGate.StepUpload） | 未开工 |
| [#28](https://github.com/daniel-qian/avery/issues/28) | T3 后端文件写端点批（先给 SourceDocument 稳定 id） | 未开工 |
| [#29](https://github.com/daniel-qian/avery/issues/29) | T4 tab 合并观察票 | 挂起，等真用户反馈 |

另外两笔**不是本战役造成、但本轮体检发现**的账，记在这里免得再没人提：

- `feature_list.json` 里 `naming-0729` 与 `output-form-0729` 两个战役**一行都没有**
  （4 个代码 commit 零 feature 行）。本轮只补了自己这一条 `feat-093`——替别人补 evidence
  等于编造，不做。
- `progress.md` 在本轮之前**没有任何 07-29 条目**。
