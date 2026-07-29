# ADR-0032 · 资料库升 tab，「完整版预告」降设置菜单

- 日期：2026-07-29
- 状态：已定（Danny 盘问 ×3 轮逐项拍板，PRD `.issues/files-hub-0729/prd.md` 记录 8 项决议；
  开票 #21–#29）
- 前情：[ADR-0026](0026-onboarding-gate-page-and-clone-based-demo-claim.md)（引导闸自带上传步）
  → [ADR-0030](0030-paperwork-page-samples-not-a-signing-surface.md)（`/paperwork` 作为
  「不占 tab 的独立页」的先例）→ [ADR-0031](0031-plain-speak-naming-pass.md)（大白话命名词表，
  本 ADR 沿用其判据并往词表里补一条）。

## 背景：文件这件事没有落点

07-29 的酒店经理 persona check 与随后的侦察暴露了同一个形状的问题——**「文件」在产品里
没有家**：

- 上传入口散在**三屏四点**（团队屏满态右栏、团队屏空态、首页骨架卡、引导闸），且是**两套
  实现**（`UploadPanel` 与 `OnboardGate.StepUpload`，注释里互相写着「必须一字不差」）。
- 文件管理只有一份**只读清单**，顺带挂在上传面板底下。
- 逐份下载端点 `GET /team/{id}/files/{idx}` 从 feat-032 起就在后端，**前端从未接过**。
- 多库切换（`knownContexts` / `switchContext` / `forgetContext`）store 侧**全套现成**，
  连 12 条中英文案都写好审过字，**UI 一次都没长出来**——那 12 个键在 en.ts/zh.ts 里当了
  很久的孤儿键（AGENTS.md「i18n 里的孤儿文案键是红旗」说的正是它：一次合并吃掉了整块 UI）。

于是用户问得出口的三个问题——「我传过什么」「现在用的是哪一批」「能不能拿回来」——
**一个都没有落点**。

## 决策

### 1. 新增「资料库 / Files」为第 10 个屏，tab 排队尾

它是这三个问题的落点：文件清单 + 逐份下载、上传入口、多库切换，三段一屏。

排队尾而不是靠前：它是**管理面**，不是经理每天开工要看的地方（feat-057 给 `home` 排头位
用的是同一条判据的另一面——「入口排队尾就不叫入口」，那么「管理面排队首」同样错位）。

### 2. 同时把「完整版预告」（vision）撤出 tab 条，降进设置菜单

净效果：tab 数 9 → 9。加一个、减一个，窄屏溢出的压力不变差
（`uiux-narrow-0728` 正在修的那条 bug 射程不变）。

**与 feat-057 裁定的关系（必须写清，否则后人会读成违约）**：feat-057 的原文是
「聚合与分屏两极都要，7 个分屏一个都没退休」，那七个是
team / room / followups / notes / closerlook / playbooks / projects。
**vision 从来不在那七个里面**——它是 feat-026 的叙事页。撤它的 tab 不触碰那条裁定；
撤那七个之中的任何一个仍然是回归。

vision 的**路由、屏组件、`data-scene`、页面内容一个字节没改**，变的只是入口在哪——
照 `/paperwork` 已有的待遇（ADR-0030）。设置菜单里那一行插在 paperwork 之后、
「重新开始」之前：`verify-switchers` / `verify-auth-form` 按 `.nth(0/1)` 索引语言与观感
两行，往它们之后插不动那两个索引。

### 3. 词表补一条：Files ↔「资料库」

沿用 ADR-0031 的大白话判据。**文件这一族统一说「资料」**：页名「资料库」、首页板块
「资料概览」、屏内小节「当前资料」——同一产品里不混用「文档 / 档案 / 文件库 / 知识库」。
生成器锁定词族已同步（`scripts/i18n-zh-lite2-delta.mjs` 铁律 4）。

### 4. v1 刻意不做：删除 / 重传 / 替换

后端写端点整批缺席（issue #28 / T3）。按**不建假按钮**红线，这三个动作在 UI 上
**一个都不出现**——一个点了必然失败的删除键，比没有删除键伤得多。

### 5. 愿景界线

v1 只管**用户上传的文件**。「agent 自己的文件空间」那个愿景继续留在 Vision 页当诚实预告，
**不许**把愿景容器混进 v1 的资料库屏。

## 顺带修掉的一个真 bug（不在原 PRD 里，但不修就没法交付第 1 条）

`GET /team/{id}/files/{idx}` 接上之后，逐份下载按钮在**生产上会是个假按钮**：

`PostgresContextRegistry.get()` 刻意不拉 bytea（`content=None`，避免为读一次名册把几 MB
上传整个进内存），而所有手编 CRUD 都是 `get() → 改 → put()`。`put()` 先 DELETE
`avery.source_documents` 再按 `sd.content` 重新 INSERT——于是**一次「加一个项目」就把整批
原始字节写成了 NULL**。此后清单照样列着文件、`size_bytes` 还是对的，下载端点却永远 404。

两层后果，第二层更重：① 下载键变成看得见、点得动、必然失败的假按钮；
② **用户上传的原件被永久销毁**——这一层与 UI 无关，改造前就已经在生产上成立。

修法：`put()` 在 DELETE 之前先把 `(source_key/filename → content)` 捞在手里，INSERT 时
**只对 `sd.content is None` 的回填**（绝不覆盖调用方明确给出的字节，否则一次真 ingest 会
复活旧字节）。

⚠ 行为证据只到 memory registry 一侧 + 一条离线结构守卫；**postgres 那一侧的行为断言
（`test_manual_crud_does_not_destroy_the_uploaded_bytes` 的 pg 参数化）本机跑不了**——
这台机器没有可用的 postgres。它必须在部署预检的真库上跑一次（同
`offline-suite-blind-to-pg-persistence` 那条教训：`not needs_db` 让整个 pg 层对默认套件隐形）。

## 代价与已知未做

- 团队屏在切片 03 才彻底零文件元素；在那之前 `/team` 与 `/files` 同时有上传口（过渡态）。
- 两套上传实现合一仍未做（issue #27 / T2）——引导闸的上传步这一战役一个字没动。
- 「资料库」这个名字与 `/paperwork`「文件与表单」在中文里都带"文件"感。区分是靠语义而不是
  靠名字：`/files` 是**你传给 Avery 的东西**，`/paperwork` 是**你要填给 Avery 的表单 + 给
  合作方看的协议样本**。CONTEXT.md 两条术语各自写了 `_Avoid_` 划界。
