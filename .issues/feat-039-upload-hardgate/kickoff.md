# feat/039 — 上传硬门 + 限流 + LLM 花费闸 + 内存哨兵(kickoff)

> 权威 spec:`.issues/lite-v1-lean-real-0713/PRD.md`(Implementation Decisions「基本抗压=上传硬门+花费闸」+ 抽取诚实降级 + User Stories 10/11/12/21/22)· 就绪册 §2-D(OOM/DoS/denial-of-wallet)· §2-G2/§2-W(抽取诚实降级)。
> 依赖:feat/038 隔离 clean。从其 tip 开 `feat/039-upload-hardgate`。
> **ECS 硬约束(来自 Ask 卡线广播 + `D:\Boyle\agent-os\infra-brief.md`)**:生产就一台 ECS **2C/3.5G,还跑着 ImaRead 全线,只剩 ~540M 可用、无 swap**。后端容器必须**低内存、低并发、上传硬门**;Danny 拍板(Q12)**不预先升配**,改装**内存哨兵**(高水位/OOM→主动冒泡"该升配了")。

## 使命

现在 `/ingest`(`service/ingest_api.py`)**无界**:无 size/count/type 上限、整文件读进 RAM、无限流、无 LLM 花费闸。就绪册 §2-D:一个 400MB 上传或脚本循环就 OOM 单 task(在 540M 机器上尤其致命,还会连带 ImaRead)、或一个下午烧光 M3 额度。feat/039 = 给上传装硬门 + 花费闸 + 内存哨兵,让真实公司零星并发 + 大文件不崩、不烧钱。

## 实现决定(已拍板)

- **上传硬门(读 body 前拒)**:
  - 每文件 size 上限 `AVERY_MAX_UPLOAD_BYTES`(默认保守,如 8MB——540M 机器);每请求文件数上限 `AVERY_MAX_FILES`(如 15);每请求总字节上限。**先查 Content-Length / 边读边计数,超限即拒**(413),别把 400MB 读进 RAM。
  - **类型白名单 + magic-byte 嗅探**(不只信扩展名):`parse.py::_DISPATCH` 现按扩展派发;加 magic-byte 校验,不匹配/不支持在 parse 前拒(诚实 415/422)。
  - **zip/XML bomb 防护**:xlsx/docx 用 `defusedxml`(现无);pypdf 加页数/超时上限。
- **限流**:`/ingest`(和可选 `/advise`)每 IP 基础限流(内存令牌桶即可,单 worker 无需外部存储)。超限 429。
- **LLM 花费闸**:per-process(可选 per-tenant)LLM 调用计数/预算天花板 `AVERY_LLM_CALL_BUDGET`;超限时抽取**诚实降级 heuristic**(而非静默烧钱)或 429。denial-of-wallet 防护。
- **抽取诚实降级**(就绪册 §2-G2/W):`/ingest` 响应带 `extraction_mode`(llm/heuristic/degraded);LLM 抽取静默回落 heuristic(429/无 key/超预算)时**显式告知**;`/health` 不谎报 llm(`active_extractor` 已有,别退化)。别再吐假「No.」人卡(§2-G2 的 heuristic "No." 守卫)。
- **内存哨兵**(Danny Q12):轻量后台检查进程/容器 RSS(psutil 或读 /proc/cgroup;不可用则优雅跳过),越过高水位 `AVERY_MEM_WARN_MB` → 打**结构化 WARN 日志**("MEMORY HIGH <rss>MB — consider upgrading ECS")+ 翻 `/health` 一个 degraded 标志(冒泡给 Danny)。**代码在 feat/039;容器 `--memory` 帽 + healthcheck 接线在 feat/040。**
- **沿用 feat/028**:`/ingest` 已 `run_in_threadpool`(别退)、`/advise` brain 超时。
- **不动**:红线/引擎/PersonEntity/冻结集/feat-033 开关/feat-038 隔离。人卡不建功能。

## 测试接缝(PRD Testing Decisions:基本档,不穷尽运维)

- **主 = HTTP 面**(边界行为断言):超大文件→413;超量文件→413;不支持类型/伪装扩展名→415/422 诚实提示;超频→429;LLM 预算耗尽→extraction_mode=degraded/heuristic(无假人卡);zip bomb→拒不 OOM;正常上传仍 200。
- **抗压基本档**:真实公司零星并发(几个并行 /ingest 不崩、healthcheck 不被拖挂——feat/028 的 threadpool 已卸载);内存哨兵越水位→WARN+/health degraded 的单测(注入低 `AVERY_MEM_WARN_MB` 触发)。
- **诚实降级**:强制抽取回落 → 响应 extraction_mode=degraded、无假「No.」人卡。
- **离线默认全绿零外网**(限流/size/type/哨兵 都确定性、无需 key/DB);@needs_db 走本地 PG。

## 纪律(standing)

- 🔴 不动冻结(redline/redline_extract/engine/loop/tools/memory/PersonEntity/FROZEN.lock.json)+ feat-033 开关 + feat-038 隔离;src/story/** 零改;门断言不削弱。gate-first 先红(现无界=红)后绿,禁自考自答。离线套件全绿零外网。分支 feat/039-upload-hardgate,commit 常态化(不 push)。别动未追踪协调者文件。若加依赖(defusedxml/psutil)进 requirements + `test_requirements_complete` 同步,且**离线惰性导入**别破全绿。
- 收盘:离线全绿 + @needs_db 绿 + ./init.sh 绿(前端基本不动)+ 集成层证据(各边界 repro:413/415/429/degraded/bomb)+ 内存哨兵触发证据 + feature_list feat-039 条目 + `.issues/feat-039-upload-hardgate/session-handoff.md`。**收盘必经独立对抗验证**(真机:构造超大/超量/伪装/超频/bomb/额度耗尽,断言硬门真拦且诚实)。
