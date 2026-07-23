# 05 · 拆分决定（05a / 05b）

> 依据：Danny 2026-07-23 夜跑 kickoff 口头拍板（本文件是把口头拆分落档，此前只在 prompt 里）。
> 原 issue：`05-crud-projects.md`（真 CRUD·项目，L 号，stick 10）。拆成两块串行做。

## 为什么拆

原 05 一片同时含两个耦合度不同的东西：(a) 手动 CRUD 写端点（add/patch/archive/restore + 逐字段出处），
(b) 重传时的「真合并」（手编赢 + 冲突提示引真句）。(a) 是纯写端点先例、单份 context 就能闭环、
不碰上传管道；(b) 要造一条把「文档再 ingest」和「manual 现值」合并的新管道，独立且更重。
合一片=一次 commit 里两套心智，且 (b) 若卡住会拖住 (a) 这个 06 要踩的先例。故拆。

## 05a —— 项目手动 CRUD + 逐字段出处（先做）

**范围**：add / edit / archive / restore，全在一份 context 内闭环；**不碰上传管道**。
是 06（人员 CRUD）要踩的写端点先例。

- **添加**：projects 页头右端 primary 按钮 → 内联表单（标题/负责人/状态/截止等）→ `POST /team/{ctx}/projects`
  → 卡即时入网格，逐字段出处标注「手动编辑」。
- **编辑**：详情浮层页脚操作区进编辑态（字段原地变输入框，保存 primary + 取消 ghost）→ `PATCH …/{id}`。
- **归档/恢复**：浮层页脚归档 → 软删入网格下方折叠区（灰化 + 恢复键）→ `…/{id}/restore` 回主网格。
  🔴 **归档 = 软删可逆，绝不物理删除**（销毁类人工闸哲学延伸到产品语义）。
- **出处（ADR-0028）**：字段级 `{value, origin: doc|manual, source: 文件名或「手动编辑」, updated_at}`；
  手编置 origin=manual。overlay 的编辑态挂 **CompanyContext**（跟 pg 一起持久，刷新/重连不丢）。
- **鉴权/校验**：照 notes 写端点先例——owner_token 或账号二选一；失败一律同体 404 无枚举；
  Pydantic 校验；写侧红线门；ValueError→422。registry 双实现（内存/pg）duck-typed 同扩 + 合约测试同扩。

**明确不在 05a**：ingest 再抽取时的 manual-vs-doc 合并、冲突记录、冲突提示冒泡——全在 05b。
05a 的写端点只处理「人直接写」，不处理「文档回灌撞现值」。

## 05b —— 重传手编赢 + 冲突提示（紧跟，单独一块）

**范围**：造「真合并」管道。**不挡 07 demo**（07 语料能力探测/claim 与本块解耦）。

- **手编赢**：文档再 ingest **不覆盖** origin=manual 的字段。
- **冲突提示**：doc 抽出值 ≠ manual 现值 → conflict 记录（claim=手编值、evidence=文档原句**逐字引用**）
  → 前端复用「多看一眼」claim-vs-evidence 语法冒提示（显示值与判据值分开，只引真句）；无冲突不冒。

## 与 04 的顺序修正（🔴 本次夜跑发现的账实不符，见 acceptance-2.md 抬头）

kickoff prompt 声称「issue 01–04 已交付全绿并 commit」，但 **git 实况：只有 01/02/03 commit（03=a5f429e），
issue 04（team 目录化）未做**，且本目录无 `05-split-decision.md`（本文件现补）。06 的 Blocked-by 明列
「03、04、05」——04 是 06 的硬前置（人员 CRUD 落在目录形态里）。故本次执行序 = **04 → 05a → 05b → 06 → …**，
把 Danny 以为已闭的 04 先补上。此改动 loud 记在 acceptance-2.md 抬头，Danny HITL 可否决。

## stick 归属

05a 与 05b 共享 issue 05 的 **stick 10**（cr-align-spec 如需行）。05a 交付后 CURRENT_STICK→10；
05b 不新增 stick（其验证以 e2e 冲突探针为主，不走 cr-align 构建值断言）。
