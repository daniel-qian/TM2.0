# 05 · 真 CRUD·项目

## What to build

端到端：**添加**——projects 页头右端 primary 按钮展开内联表单（标题/负责人/状态/截止等）→ POST 新写端点 → 卡即时入网格，逐字段出处标注「手动编辑」。**编辑**——详情浮层页脚操作区进入编辑态（字段原地变输入框，保存 primary+取消 ghost）→ PATCH。**归档/恢复**——浮层页脚归档 → 软删入网格下方折叠区（灰化+恢复键）→ restore 回主网格。**手编赢**——文档再 ingest 不覆盖 manual 字段；doc 抽出值≠manual 现值 → conflict 记录 → 前端复用「多看一眼」claim-vs-evidence 语法冒提示（引文档真句）；无冲突不冒。

引用 PRD User Stories：6（手动添加）、7（编辑+逐字段出处）、8（归档可恢复）、9（重传不覆盖手编）、10（冲突提示引真句）、25（出处可点自证）。

## 字段/接口决策

（PRD B1/B2/B4）
- **端点**：`POST /team/{ctx}/projects`、`PATCH /team/{ctx}/projects/{id}`、`POST /team/{ctx}/projects/{id}/archive` 与 `/restore`。照 notes 写端点先例：owner_token 或账号二选一鉴权、失败一律同体 404 无枚举、Pydantic 校验、写侧红线门、ValueError→422。
- **归档=软删标记，可逆；不做物理删除**（销毁类人工闸哲学延伸到产品语义）。
- registry 双实现（内存/Postgres）duck-typed 同 API 扩展，合约测试同扩；pg 侧实体整体 JSON 存储无需 DDL。
- **provenance（ADR-0028）**：字段级 `{value, origin: doc|manual, source: 文件名或「手动编辑」, updated_at}`；手编置 origin=manual；ingest 时 manual 字段不覆盖；冲突记录 claim=手编值、evidence=文档原句逐字引用；提示只引真句、显示值与判据值分开。
- **交互（对齐她方形态，文本零抄）**：卡面不放操作控件（避免整卡即按钮的嵌套交互）；编辑/归档只在详情浮层页脚；详情浮层「只读」决策（ADR-0022 决策 2）由本 PRD 显式修订为「只读+页脚操作」；出场动画快照机制对编辑态单独处理。所有新按钮挂既有按钮家族类，label 全中文 aria。项目字段全量可编辑（人身数字与项目无关，禁键在 06 侧执法）。

## Acceptance criteria

机器可验：
- [ ] registry 双实现合约测试扩展（新写 API 全覆盖：add/patch/archive/restore/provenance/conflict）全绿。
- [ ] 写侧单测：无鉴权/坏 token 同体 404；坏体 422；归档后可 restore；无物理删除路径。
- [ ] e2e 探针（T8 两世界）：添加→卡在+出处「手动编辑」；编辑→值变+origin=manual；归档→主网格消失+折叠区在+恢复回来；手编后再 uploadFiles 同名项目→手编值保持+conflict 提示冒出且引文档真句；无冲突→不冒。
- [ ] verify-aria-zh 绿（表单/按钮全中文 aria；弹层表单是静态走查盲区，红线仍照给）。
- [ ] verify-button-family 绿（新按钮全挂 .lite-btn 族）。
- [ ] 扫雷 `--selftest` 8 PASS + 正式跑 NEW 台账清零（D2 默认控件/D6a 图标钮≥24×24/D6b 焦点反馈）。
- [ ] verify-p0 绿（请求失败路径有 UI 态，不漏 console error）。
- [ ] PATCH 置空字段两世界：置空→payload 该键缺席/null→渲染 `data-empty-kind="absent"`「文档未提及」，绝不 0%/空串默认。
- [ ] cr-align-spec 如需行用 **stick 10**（添加按钮 primary 样式 rect/prop）。
- [ ] 本片交付后把 run-battery.mjs 的 CURRENT_STICK 递增到本片 stick 号（10）。

需人眼：
- [ ] 表单展开/编辑态观感与她方并排（结构对齐、文本零抄）；浮层页脚操作布局。

## 波及面与红线

既有门波及（门影响面摸底 E 节）：verify-aria-zh、verify-button-family、扫雷 D 系、verify-p0（console）、registry 合约测试、DetailOverlay（出场动画快照机制）、后端服务（改 service/*.py 杀 8137 重起）。

红线（runbook §2）：手编赢+逐字段出处（ADR-0028）；「多看一眼」语法同源（claim 引真句、显示值/判据值分开）；无物理删除；en.ts 唯一文案源+zh 增量；新输入框必给 aria-label；AA 4.5；富字段真管道（手编是显式出处通道，不是注入）。

## Blocked by

01、02（项目富字段先在，编辑面与冲突对照才全）
