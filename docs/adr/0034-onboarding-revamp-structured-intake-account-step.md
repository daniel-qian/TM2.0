# ADR-0034 · Onboarding 重组：表单录入成为结构化通道、账号步进向导、预览模式

日期：2026-08-05 · 状态：Accepted · 拍板：Danny（onboarding-accounts-0805 盘问 · 三轮 10 项）

## 背景

合伙人交来 onboarding 完善化方案的静态稿（5 步向导：录入标准数据包 / 连接日常工作工具 /
确认管理范围 / 选择管理偏好 / 创建管理者账号，每步带「页面预览模式」横幅）。盘问前先把
现状探底（四路并行侦察，79 万 token）：

- 现有向导（`src/lite2/OnboardGate.tsx`）是 doors → upload → team → playbooks → done
  五步，合伙人稿的「范围」「偏好」两步与现有 team/playbooks 两步几乎同构。
- 「7 张表做成 app 内结构化表单」曾被 [ADR-0030](0030-paperwork-page-samples-not-a-signing-surface.md)
  明确否决（当时理由：库里只有 person/project/signal/playbook 四类实体，03/05/06/07 表
  要新建实体 + 迁移 + 5 套表单 UI，是独立战役）。本 ADR 就是那场战役的开战决定，
  **supersede ADR-0030 的这一条否决**；ADR-0030 其余决定（法律样本不做签署面等）不动。
- 账号系统是真的：Supabase GoTrue 前后端全链路在生产活着（本日实探
  `/account/status` → `{"configured":true}` 200），但它是「认领系统」不是「注册墙」——
  租户边界仍是 owner_token（feat-038），账号只是事后把 context 绑到 user
  （`avery.account_contexts`）。**注册→登录→认领→双账号隔离这条链至今没有任何人或
  自动化门真正走通过**（后端测试 monkeypatch 验证器、前端门用假 key + 拦网络、
  `.issues/rich-align-0722/acceptance-2.md` 的人手签认框一直是空的）。
- 结构化数据没有入口：唯一漏斗 `POST /ingest` 收文件、过 LLM/启发式抽取
  （约 100–120 秒、有损）。表格模板资产已在
  （`scripts/make-intake-xlsx.py` → `public/paperwork/forms/avery-intake-forms.xlsx`，
  列序、下拉词表、红线后果全被真管线量过）。

## 决策（10 项拍板，2026-08-05）

1. **表单数据走新结构化端点，不再绕道文件抽取。** 新后端端点收表格行
   （multipart：行 JSON + 可选附带文件），确定性映射：01 表→人卡、02 表→项目卡
   （04/05 表的阻塞、风险按现模板口径充实项目卡），03–07 表进材料库供检索——
   与 xlsx 模板今天的实际行为一致，**不新建实体类型**（`avery.entities` 的
   kind CHECK 与 person 键 allowlist 都不动）。抽取被整个跳过：秒级、零损。
2. **红线语义与 /ingest 完全一致：整发 422 硬拒 + violations 明细。** 前端把拦截
   前移到单元格级（07 表填分数当场标红），正常用户永远碰不到 422；绕过前端直打
   端点的，同一条铁律。
3. **第 1 步表格与文件上传并存、合一发提交。** 一次提交 = 一个 context：行走映射、
   文件走现有抽取，同发合入同一 context。不做两个割裂工作区，不碰 append 难题。
4. **「从 Excel 粘贴」进第一刀。** 纯前端剪贴板 TSV 解析；没有它，16 人名册逐格
   手敲不可用。
5. **第 5 步「创建管理者账号」可跳过。** 游客路径仍是硬性产品要求（authStore 注释
   口径不变）。注册成功后自动认领当前 context（复用 `POST /account/claim`）。
6. **凭据墙开一个明确口子：专用测试账号。** 约定前缀的一次性测试邮箱
   （`avery-e2e+<时间戳>@…`），agent 可在真 Supabase 上自动跑
   注册→登录→认领→双账号隔离并清理；**真实账号（Danny 的、客户的）仍然人手**。
   口径落在 `roles.md`。
7. **demo 门（一键示例团队）保留为进门第一选择。** 合伙人稿没画它，但它是唯一的
   零成本尝鲜路径，砍掉等于让所有访客直面 5 步向导。
8. **预览模式做。** 跳过校验的自由步进 + 常驻「未填写的数据不会保存」横幅 +
   不落库 + 退出预览；同时成为已有数据老用户的安全回访入口。
9. **偏好步采用合伙人的 5 个管理框架**（目标拆解与对齐、1:1 与辅导、公平理论与
   激励、RACI 与协作边界、现实差距检测）。与现有 8 playbook 目录不互斥（后者
   继续活在 Playbooks 屏）。选择只存本地、不影响分析——界面如实标注。
   连接工具步同理：纯登记意向、明说「暂未开通连接」，不造假连接态。
10. **开发按依赖自然序**：后端端点（①）与向导重组（③）先并行，表格 UI（②）接①，
    账号步（④）接③，E2E 门（⑤）收尾。不做「演示优先、临时兜底」的中间态。

## 备选与否决理由

- **表单数据前端拼成 CSV/XLSX 走现有 /ingest** —— 否决。零后端改动，但用户填完
  结构化表还要等两分钟抽取、错误只能整发拒绝、LLM 模式下仍可能有损——等于把
  这个方案要绕开的那条路又走了一遍。
- **红线行级拒绝（剔除违规行收其余）** —— 否决。同一条红线在两个入口严度不同，
  日后必被问「为什么表格能溢过去」。
- **强制注册才能完成 onboarding** —— 否决。推翻游客硬性要求需另立 ADR，且路演/
  试玩场景每次都要造账号。
- **表格、文件各自提交各建 context** —— 否决。违背「一家公司 = 一个 Context」
  的租户语义（CONTEXT.md Tenancy 段）。
- **凭据墙保持纯人手** —— 否决。历史证明走不到：acceptance-2.md 的签认框空了两周。
  这次要做账号步骤，不验等于继续裸奔。

## 后果

- 新端点是第二个写入口，红线、guards、CORS、租户铸 token 的语义都要与 /ingest
  逐条对齐；门电池要为它添门。
- 前端表格定义必须与 `scripts/make-intake-xlsx.py` 的 FORMS 同源（列序、必填、
  下拉词表），加契约测试钉住，否则两处各漂。
- 现有向导五步中 team/playbooks 两步被改造（不是重写）；`lite2:onboard:v1`
  持久化键升 v2，旧本地状态作废（无害——它只存问候语字段和步骤位置）。
- 像素基线与 onboarding 相关行为门会大面积变红，属预期改动；基线在 main 检出
  重打（worktree 纪律照旧）。
- 09 月后如真出现「03–07 表要长成独立卡片」的需求，那才是 ADR-0030 说的
  「新建实体类型」战役——本 ADR 刻意不开那一仗。

## 相关

- 拍板过程与逐票切片：GitHub 战役父票 #39（子票 #40–#44）。
- [ADR-0020](0020-avery-graduates-from-demo-only-to-live-lite-product.md)（live 毕业）、
  [ADR-0026](0026-onboarding-gate-page-and-clone-based-demo-claim.md)（现向导与 demo 门）、
  [ADR-0030](0030-paperwork-page-samples-not-a-signing-surface.md)（被部分 supersede）、
  feat-038（owner_token 租户隔离）、feat-053（账号=认领系统）。
