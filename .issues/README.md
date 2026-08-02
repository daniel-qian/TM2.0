# .issues 索引

> 本文件索引 `.issues/` 下全部顶层战役目录。现测（2026-08-02）：**44 个顶层目录 · 201 个 tracked 文件 · 15 个 `session-handoff.md`**——别沿用旧口径 42/197/14，那是没算上本次新增的 `sweep`、`sweep-promote-0802` 两个目录（它们本身就是这次要索引的对象）。数字自查：`git ls-files ".issues" | wc -l` 与 `find .issues -maxdepth 1 -mindepth 1 -type d | wc -l`。
>
> 每行格式：目录名 — 这场战役一句话 — 对应 feat-XXX（若有）— 状态（活 / 已归档）。「对应 feat-XXX」这一列就是 feat-093 这类「战役目录 ↔ feature 行」映射的落地——此前这份映射只散落在 `feature_list.json:784`（feat-093 entry）与 `progress.md:11,17` 的散文里，这里补齐即可，不另建映射文件。

## 顶层目录（44）

- **ask-card-0713** — Ask（快问）卡战役：员工自述式快问 + 分享链接回执闭环（双面）。对应 feat-034。状态：已归档。
- **cr-align-0721** — 合伙人反馈 + Command Room 对齐拍板（棒 1，九项决策）。对应 feat-081。状态：已归档。
- **cr-align-visual-0721** — cr-align 视觉战役棒 0~7：扫雷/规格 harness 全套 → 胶囊玻璃壳 → token 加深 → 共享组件族 → 屏组一 → 项目卡渐变条 → 轻屏动效收官。对应 feat-083～089。状态：已归档。
- **feat-006** — demo 视频拍摄就绪。对应 feat-006。状态：已归档。
- **feat-012** — 冻结 eval 场景集（含对抗性 case）。对应 feat-012。状态：已归档。
- **feat-014** — 首页「Your team」卡（Morning Desk A+），team map 降级。对应 feat-014。状态：已归档。
- **feat-015** — agent service：顾问引擎升 FastAPI+SSE API（真输入）。对应 feat-015。状态：已归档。
- **feat-016** — ingestion 引擎：上传 → 解析 → 向量 RAG → 填充 Your team。对应 feat-016。状态：已归档。
- **feat-017** — 前端毕业到 Avery Live（seams / live 模式 / i18n）。对应 feat-017。状态：已归档。
- **feat-018** — 双端部署：境内中文 + 海外英文。对应 feat-018。状态：已归档。
- **feat-019** — 酒店 vertical pack + 换皮首例。对应 feat-019。状态：活（名义 in_progress，实为外置研究线，长期挂账——见 progress.md:17）。
- **feat-020** — 建筑公司（Skeppsviken，瑞典）调研 + 办公软件集成可行性。对应 feat-020。状态：已归档。
- **feat-022** — seed 端到端验收门（双层机器门，先立必红）。对应 feat-022。状态：已归档。
- **feat-023** — LLM 抽取引擎（pluggable brain）。对应 feat-023。状态：已归档。
- **feat-024** — story/lite 同仓立墙 + lite 三屏壳（ADR-0022）。对应 feat-024。状态：已归档。
- **feat-025** — lite 模块补齐（Playbooks 空态 + team map / room 画板，S5）。对应 feat-025。状态：已归档。
- **feat-026** — lite 定位叙事页/卡 + 能力边界 mock（S6）。对应 feat-026。状态：已归档。
- **feat-030-persistence** — Postgres（Supabase）持久化：ContextRegistry + 记忆落库 + 重物化。对应 feat-030。状态：已归档。
- **feat-031-real-rag** — 真向量 RAG：pgvector 落实（替 keyword 占位）。对应 feat-031。状态：已归档。
- **feat-032-file-space** — 每公司文件空间：上传源文档持久留存 + 清单回看。对应 feat-032。状态：已归档。
- **feat-033-avery-notes** — Avery's notes：写侧、跨会话、红线闸 agent 记忆。对应 feat-033。状态：已归档。
- **feat-038-tenant-isolation** — 基础租户隔离：不可猜 owner_token + 读路径校验。对应 feat-038。状态：已归档。
- **feat-039-upload-hardgate** — 上传硬门 + 限流 + LLM 花费闸 + 内存哨兵。对应 feat-039。状态：已归档。
- **feat-040-deploy-prep** — 部署预备：Dockerfile 瘦身/单 worker/healthcheck + 本地真镜像冒烟。对应 feat-040。状态：已归档。
- **feat-041-e2e-broadcast** — 端到端（agent 当第一个用户）+ 基本压测 + 广播回 Ask 卡线。对应 feat-041。状态：已归档。
- **feat-048** — 中文数据端到端修复五轮之一（停用词表统一，r2 遗留跟进）。对应 feat-048。状态：已归档。
- **feat-068-frontend-deploy** — 前端首次真部署（Vercel）+ 接线上后端。对应 feat-068。状态：已归档（**do-not-archive**，见下）。
- **feedback-0729** — 酒店经理 persona 首轮评审，抓到输出形态三宗罪（喂给 output-form-0729）。对应 feat：无——评审证据文件，不是独立 feat，被 output-form-0729 消费。状态：已归档。
- **files-hub-0729** — 资料库战役：Files hub 升 tab + 逐份下载 + 多库切换 + 团队屏零文件元素。对应 feat-093。状态：已归档。
- **input-side-0721** — 输入侧棒 r2：onboarding 全屏闸门页 + 一键示例团队 + 8A 公司现状采集。对应 feat-082。状态：已归档。
- **layout-real-0722** — 「布局与真部件」战役：七路并行侦察合成的作战地图 + 验收语料。对应 feat：无单一 feat（侦察/语料产出，被门脚本长期引用）。状态：已归档（**do-not-move**，见下）。
- **lite-live-v02-0713** — v02 线（feat-047/048/049）：引擎同步 + 笔记/文件面移植 + 中文数据端到端修复。对应 feat-047/048/049。状态：已归档。
- **lite-v1-lean-real-0713** — Avery lite v1「精悍准真」产品：持久化 + agent 基本功做真。对应 feat-030～041（持久化链全段）。状态：已归档。
- **live-polish-0709** — lite 打磨波：Danny 试玩反馈 7 项，S4（考古判定+即修）/S5/S6 三段。对应 feat-025/026。状态：已归档。
- **live-rescue-0707** — 救 15–20 补救计划（ADR-0022）：story/lite 立墙 + LLM 抽取引擎 + 真向量语义检索。对应 feat-021～024。状态：已归档。
- **output-form-0729** — 输出形态战役：简单问题分流短答 + 砍契约样板 REQUIRED 9→3 + 议事室画板退役。对应 feat：无——`feature_list.json` 缺这一战役行（账目债，见 progress.md:31，交由 #2 补行）。状态：已归档。
- **partner-docs-0728** — /paperwork「文件与表单」页 + 标准表单 xlsx 空白件 + 项目状态词表补「暂停」。对应 feat-090/091/092。状态：已归档。
- **rich-align-0722** — 满态对齐战役：PRD + 满态数据链打通 + 一键满态/一键复位/账号归属实证。对应 feat：无——同 output-form-0729 一类的账目缺口，`feature_list.json` 未开行。状态：已归档。
- **roadshow-landing-0703** — investor roadshow landing 改版（18 段砍到 7 屏投资人叙事）。对应 feat：无——早期独立 worktree 线，先于当前 feat 编号体系全覆盖。状态：已归档。
- **sweep** — 2026-08-02 auto-loop 全扫描：UI 46 条 + 架构 7 已核验 + 19 附录。对应 feat：无——原始扫描产出，被 sweep-promote-0802 消费。状态：活。
- **sweep-promote-0802** — 把 sweep 的发现推上生产：`claude/codebase-architecture-improve-20b9eb` 的 12 提交已于 2026-08-02 快进合回 main 并全量上线（回执 `receipt-deploy-0802.md`，含生产库原件盘点）。对应 feat：无——本线仍在走（下一棒菜单见该目录 session-handoff.md）。状态：活。
- **uiux-narrow-0728** — UIUX 棒（片段）：合伙人验收逮到的两个真机 UI bug（让位余量其实是高度的函数）。对应 feat-080。状态：已归档。
- **v02-joint-0719** — v02 两线合审：lite-live-v02-0713 与 v02-partner-align-0718 联调收口。对应 feat-050～057 区间。状态：已归档（**do-not-archive**，见下）。
- **v02-partner-align-0718** — v02 对齐波：上一波（lite-live-v02-0713）刻意推迟的项目全部转正。对应 feat-050～057 区间。状态：已归档（**do-not-archive**，见下）。

## do-not-archive（内含在册门脚本，不要真归档/挪走）

- **`.issues/v02-partner-align-0718`** —— `verify-p0.mjs` / `verify-data-boundary.mjs` 仍在 `run-battery.mjs` ROSTER 在册。同目录另外 7 个 `verify-*.mjs`（verify-server / fixA / fixA-live / fixB-transport / fixB-upload-ui / fixB-upload-layout / blockers）是死件，不在此列，见「agents-md-verification-section-stale」票。
- **`.issues/feat-068-frontend-deploy`** —— `verify-zh-purity.mjs` / `verify-bare-url-shell.mjs` / `verify-404-discriminator.mjs` 三个在册门。
- **`.issues/v02-joint-0719`** —— `verify-null-owner.mjs` 一个在册门。

## do-not-move

- **`.issues/layout-real-0722`** —— 被 `eval-harness/tools/run-battery.mjs:5`、`eval-harness/tools/verify-cr-alignment.mjs:47`、`eval-harness/tools/verify-button-family.mjs:54` 三处注释按路径点名引用（分别指向 `battle-map.md`、`panel-firing-truth.md`、`acceptance-corpus/`）。挪走这个目录会让这三处注释里的路径全断。

## session-handoff.md 墓碑

全仓 15 份 `session-handoff.md`，其中 **14 份**已在文件顶部加一行「已结案存档」墓碑，指向当前状态以 `progress.md` / `feature_list.json` 为准。唯一例外（第 15 份）：`.issues/sweep-promote-0802/session-handoff.md`——本线仍在走（分支已合 main、已上线，但菜单未走完），不加墓碑。

⚠ 加墓碑等于给这 14 份各插了 2 行，**指向它们的 `file:line` 引用全部下移 2**。本轮已修的一处：`.issues/layout-real-0722/recon-data.md` 里指向 `.issues/feat-026/session-handoff.md` 的行号已从 :68 改到 :70。以后再引这些文件的行号，记得它们已经偏移过一次。
