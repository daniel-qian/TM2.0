# partner-docs-0728 · 验收证据

2026-07-28。跑法与端口都写在这里，重跑不用猜。

## 环境（隔离端口，不碰生产、不碰另一条线的 5173）

```bash
# 后端：全离线三件套 + CORS 放行 preview 源（跨源必配，端口对不上门看起来像"页面空的"）
cd eval-harness
AVERY_BRAIN=mock AVERY_EXTRACTOR=heuristic AVERY_EMBEDDINGS=keyword \
AVERY_CORS_ORIGINS=http://localhost:4199,http://127.0.0.1:4199 \
python -m uvicorn service.app:app --host 127.0.0.1 --port 8198

# 前端：dist bake 到本地后端，preview 起 4199
VITE_AVERY_API_BASE=http://127.0.0.1:8198 VITE_AVERY_LOCALE=zh \
  node node_modules/vite/bin/vite.js build
node node_modules/vite/bin/vite.js preview --port 4199 --strictPort
```

两个本机环境坑，重跑前先看：

- ~~**`npm run typecheck` / `npm run dev` 都跑不了**~~ —— **2026-07-28 当天已修好**（Danny 放行
  跑了 `npm install`）。本批的验证是在修好之前做的，所以上面的命令行用的是
  `node node_modules/vite/bin/vite.js build` 这种绕法；现在 `npm run typecheck` /
  `npm run dev` 都正常，重跑不必再绕。
  留档：当时 `node_modules/.bin/` 是空的、整个 `@babel/*` 树不在，dev server 的
  react-refresh 转换必崩（`GET /src/main.tsx → 500`）。**根因是 07-19 拆 worktree 时
  `rm -rf` 顺着 junction 把共享 node_modules 削掉了 69 个包**（记忆
  `worktree-teardown-junction-trap` 里那条坑的真实后果），而 `vite build` 走 esbuild
  不需要 babel，所以生产构建一路正常、这个洞在主检出上静默存在了 9 天。
  查法一行：`lock 声明的包数 vs 磁盘上实际存在的包数`（当时 216 vs 147）。
  修法是 `npm install`（增量补齐）**不是 `npm ci`**——ci 会先整个删掉再重装，
  而并行 worktree 的 junction 指着这里，删了会当场把那些会话搞崩。
- **`vite preview` 只绑 `[::1]`**：`curl http://localhost:4199` → 200，
  `curl http://127.0.0.1:4199` → 连接被拒。门一律传 `VERIFY_BASE=http://localhost:4199`。
  两道自己 spawn preview 又写死 `127.0.0.1` 的门（`verify-auth-form` /
  `verify-auth-capability`）因此在本机起不来 —— 与本批改动无关，已另开任务。

## 门

| 门 | 结果 |
|---|---|
| 离线后端电池 `pytest -m "not smoke and not seedgate and not needs_keys and not needs_db"` | **3464 passed / 0 failed**（85s） |
| `tests/test_partner_intake_form_contract.py`（本批新增） | **14 passed** |
| `verify-zh-purity`（本批扩了 `/paperwork` 采样） | **exit 0**；`/paperwork` 残留 3 处，全是下载件文件名 |
| `verify-switchers` | **27 PASS / 0 FAIL** |
| `verify-aria-zh` | **17 采样点，可疑 0 处；4 PASS / 0 FAIL** |
| `tsc -b` | 零错 |
| `vite build` | 通过 |
| `scripts/css-brace-check.mjs` | 15 个 CSS 全部配平 |

`verify-switchers` 是本批最该跑的一道：设置菜单加了第四行。它按 `.nth(0/1)` 索引语言/观感
两行，所以新行插在**它们之后、「重新开始」之前**——真机确认 lang 仍 nth(0)、look 仍 nth(1)、
`.lite-settings-restart` 仍在。

## 端到端：填好的表真能长出人卡

不是"能上传"，是"上传之后真长出东西"。填 3 人 / 2 项目 / 1 指标 / 1 评议，走完整
`parse + ingest`：

```
doc_kind = roster        （ASCII 文件名，路由来自 sheet 名里的「名册」）
ingest ok=True  redline=ExtractionRedlineResult(ok=True, violations=[])
people=3  projects=0  signals=0  materials=48
  · 陈思雨 | 渠道运营 | 市场部 | 2 年   | owns=['华南区渠道投放的方案与执行', '对投放 ROI 负责']
  · 林浩然 | 内容策划 | 市场部 | 8 个月 | owns=['秋季新品发布会的内容脚本', '媒体沟通']
  · 赵敏   | 活动运营 | 运营部 | 2 个月 | owns=['线下门店活动的落地执行', '物料对接']
```

**零幽灵人**：另外 6 张表的第 0 列都是编号（`PRJ-` / `KPI-` / `ISS-` / `REV-`），
`_looks_like_name` 全判假，没有一行被误当成人。

到这个结果之前推翻了四版设计，每一版都是实测出来的（详见
`scripts/make-intake-xlsx.py` 文件头）：

| 第一版的做法 | 实测结果 | 改法 |
|---|---|---|
| 表头写「姓名（仅贵司内部留存）」 | 抽出 **0 人** —— `_canon_header` 剥掉非汉字后是「姓名仅贵司内部留存」，查不到表 | 提示全进批注，表头只留字段名 |
| 表头用 `\n` 换行排版 | 表头行被切成好几段，碎片和第一条数据混行 | 换行交给 `wrap_text`，单元格里不写 `\n` |
| 「人员ID」放第一列（照 docx 原序） | 抽出 **0 人** —— 姓名恒取 `cells[0]`，`_looks_like_name("SY-001")` 为假 | 姓名提到第一列，后三列按 岗位/部门/司龄 排（让表头映射与位置兜底指向同一格） |
| 说明页当 sheet 00 排最前 | 它的四列小表抢占了"全文档第一条 `|` 行"，花名册表头永远读不到 → `owns` 整列静默丢失 | 说明页挪到最后一个 sheet，用 `wb.active` 让工作簿仍停在它上面 |

## 表 07 红线：实测过才敢写那句警告

`scratchpad/probe07.py`。结论两条：

- **按合伙人「填写要点」填的 07 全部通过**（5/5）——我们发的表不自带雷。
- **没按要点填会整批被拒**：分数（「绩效 2 分」）、百分比（「完成度 82%」）、
  等级（「绩效评级：不合格」）、排名（「排名倒数第一」）四类触发；
  `pipeline.py:130` 是 `ok=False` 整发拒绝，不是丢掉那一格。

顺带逮到一条**红线误报**：`KPI-001` 这种编号形状被判成人身评分（`KPI` + `-` + `001`
命中 `_ZH_SCORE_NEAR_NUM`），而合伙人表 03 的指标ID 示例原文就是「如 KPI-001」。
按 stay-in-scope 没顺手修，另开了一条线 —— **已于同日修复并合入 main**（`8c8166b`）。
本目录的 `probe-redline-07.py` C 组是它的回归见证：修之前那一条是 FAIL，现在是 PASS，
`probe-e2e-filled.py` 的指标行也刻意留着 `KPI-001` 当样本。

两条探针都能从仓库根直接跑，不依赖任何临时目录：

```bash
python .issues/partner-docs-0728/probe-redline-07.py    # 红线四组
python .issues/partner-docs-0728/probe-e2e-filled.py    # 填好的表 → 3 张人卡
```

## 真机（截图在本目录）

- `shot-1-index-zh.png` — 1280×900 全页，中文
- `shot-2-dpa-expanded-zh.png` — DPA 展开 + 内部批注打开（虚线框 +「内部备注 · 不属于协议正文」）
- `shot-3-mobile-zh.png` — 375×812

重拍：`VERIFY_BASE=http://localhost:4199 node .issues/partner-docs-0728/shoot.mjs`
（**不要用 Browser pane 的 screenshot**，本机 5s 超时，本次是第三回复发）。

真机逮到并已修的两个 bug（都是截图/DOM 采样看出来的，不是读代码想出来的）：

1. **新访客的 onboarding 闸门盖在文档页上**。闸门对没有 contextId 的访客一律弹出，
   而 onboarding 里那条链接是 `target="_blank"` ——新标签是全新会话，闸门又盖一次：
   用户点了链接，看到的还是闸门。→ `/paperwork` 上整个弹层家族不挂载。
2. **h1「文件与表单」被顶栏吃掉**。`.paperwork-inner` 硬写 `padding-top: 32px`，
   而胶囊顶栏是浮在内容之上的，全屋顶距走 `--lite2-clear-top`（96px / 窄屏 72px）。
   → 改吃变量，本页是第十个消费者。

## 逐项核对（对照 Danny 的 8 项拍板）

| 拍板 | 落地 | 验到没有 |
|---|---|---|
| 内部草案通道 + DRAFT | 常驻免责横幅 + 每份法律件带「草案」徽章；不挂 tab、`noindex` 未加（未加锁是第 8 项拍板） | ✅ 真机 |
| 预览 + 下载，不签 | 页内正文 + 6 个下载件；零签署 UI、零同意勾选 | ✅ 真机 + 6×200 |
| 表单下载后走现有上传口 | 三格式（xlsx/docx/pdf），后端零改动 | ✅ 端到端 |
| 三处口径差不改 | 文件逐字转录、产品未动；横幅承担免责 | ✅ 转录逐字比对 |
| a/b 可见性拆开 | 表单三处真入口；法律样本同页不同分区 | ✅ 真机三处 href |
| docx + xlsx 双格式 | 两者并存，xlsx 标「推荐」并说明各自适用场景 | ✅ |
| 页内正文渲染 | 四份全转；内部批注分离渲染 | ✅ 真机 DPA 11 标题/2 表/3 批注 |
| 手工转 + 标日期 | 每份卡片底部「源件 vX（日期）· 转录于 2026-07-28」 | ✅ |
| 不加锁 | 未加 `?key=`；`noindex` **未做**（见下方留后） | ⚠️ 见留后 |

## 留后（明确没做的）

- **`noindex` 没加**。第 8 项拍板选的是「不加锁」，选项里 `noindex` 是并列的第三项、
  没被选中。若要防「搜 Avery DPA 搜到草案」，需要在 `index.html` 或该路由加
  `<meta name="robots" content="noindex">`——SPA 单页壳共用一个 `index.html`，
  给单条路由加 noindex 要动 head 注入，不是一行，所以留给点名。
- **03/05/06/07 四张表仍只进材料库**。做成结构化实体是独立战役（要新建 entity 类型 +
  `entities_kind_check` 迁移 + 表单 UI），本批只做到「逐张标注实话」。
- **中文文案已由 M3 生成并直接定稿**（AGENTS.md 授权 act-first），未标待审字。
  M3 原句里两处被我手工改了词：`App 里` → `产品里`、`HR` → `人事`——理由是不给
  `verify-zh-purity` 的拉丁白名单加本来就有中文写法的词，语义未动。
