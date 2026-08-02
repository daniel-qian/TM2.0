# sweep-promote-0802 · 本线交接（AFK 自跑，2026-08-02）

> 上游：`.issues/sweep/2026-08-02.md`（UI 46 条）+ `2026-08-02-architecture.md`（架构 7 已核验 + 19 附录）。
> Danny 批准全菜单（"按照你的建议，AFK"）后按 begin-loop 节奏一票一验一提交。全部在
> `claude/codebase-architecture-improve-20b9eb` 分支，**未 push、未合 main**。

## 落地清单（9 波，提交序）

| 提交 | 票 | 一句话 | 验证 |
|---|---|---|---|
| 100d28b | arch-6 | 裸 pytest 默认离线（addopts 四反选）+ dual-smoke:57 `-m smoke` | collect 3473/3546；smoke 文件 0/1 收集两向 |
| 623aac9 | ui-B | `<html lang>` 随 locale + notes 日期跟应用 locale（两壳） | Playwright 4/4（OS zh-CN 下 en 显 "Jul 31"） |
| d7d8db7 | ui-C | followups 断行 + 弹层 Escape + projects CTA 改 /files | 自家 6/6 + 四门全绿；互斥经 stash 基线判别后刻意缩窄 |
| 42ef1e7 | ui-A | doors 文案单门条件化 + 背板去假 Close 按钮 | 自家 3/3（route-abort 造两世界）+ onboard 46/0 |
| dd564b9 | arch-2 | 公司域清扫收口进各 owning store，AuthPanel 只组合 | auth-form 57/0 + switchers 27/0 + onboard 46/0 |
| f40440d | arch-5 | ContextRegistryProtocol 落字（~26 成员）+ 4 条离线一致性门 | 新门 4/4；契约离线段 60 passed |
| c27c34e | arch-1 | lite2.css 177 选择器补 .lite2-shell + css-scope-check 新门 | v02 三截图逐字节相同；v01 人眼过；opus 子代理执行 |
| （issue）| arch-3 | v01 退役成本账 → [#33](https://github.com/daniel-qian/avery/issues/33)（ready-for-human，交叉 #32） | — |
| 2f484df | arch-4 | put/get 全列 roundtrip 守卫 + 纯 SQL 回填（content+embedding） | 真 PG：contract pg 腿 42、全量 needs_db 65 全绿 |
| 73bfaa9 | arch-4b | 离线源码守卫对齐新机制（按其自身"更新勿删弱"规矩） | 全离线 3473/0 |

## 本线抓到的活 bug（超出走查预期的收获）

**prior_bytes 修复在本分支上其实是坏的**：SQL `COALESCE(source_key, filename)` 只认 NULL，
而 INSERT 从不落 NULL（`source_key` 默认 `''`）；Python 回填侧 `or` 认空串——键法分裂，无
source_key 的文档 bytes 照样被 CRUD 抹掉。全列守卫第一跑抓获，既有钉子的 pg 腿同刻复红
（此前一直被离线反选静默跳过）。修法：`COALESCE(NULLIF(source_key,''), filename)` 统一键法
+ 字节全程不出库。**生产库是否存在已被抹掉的 content 值得跑一次盘点**（`SELECT context_id,
filename FROM avery.source_documents WHERE content IS NULL AND status='ingested'`）。

## 留给 Danny 的三个未拍板

1. **弹层叠加**：Escape 已修；互斥/点外即收会拆 button-family 防作弊计数与 onboard 世界 F，
   要改须连门断言一起动（断言域，AFK 不越权）。
2. **demo/status 不走 stub**：stubTransport 未实现 demoStatus，任何构建下探测都真出网——
   "离线 demo 一个 built dist" 要不要支持是方向题。
3. **CRUD 重嵌成本**（核验按语第二实例）：有 embedder 时每次手编 CRUD 全量重嵌走计费
   DashScope；本波只治"抹掉"（无 embedder 时向量保留），省钱要另立票定 staleness 语义。

## 环境状态

- 本地 `avery-pg`（5433）容器：本线启动（此前 Exited 255 两周，疑似宿主机重启殃及），**留跑**。
- 预览服务器（4173/::1、5173/127.0.0.1）与 mock 后端（8137）：本线收尾已停。
- dist：`vite build --mode development` 产物（含全部本线改动）。
- zh 文案两处非 M3：projects CTA（名词替换）与 onboardDoorsBodySolo（已审句复用）——待抽查。

## 未动区

progress.md / 根 session-handoff.md / feature_list.json（归 main-checkout integrator）；
src/story 零改；架构报告"未核验附录"19 条一条没动（按语要求先自行复核再派波）。
