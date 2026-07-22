# 06 · 真 CRUD·人员

## What to build

把 05 的模式端到端扩展到人员：**添加**——team 目录页头 primary 按钮展开内联表单（姓名/职位/组别等定性字段）；**编辑**——人员详情浮层页脚操作区；**停用/恢复**——成员卡右下低调文字键停用 → 页尾「已停用」折叠区（灰化+恢复文字键）。手编赢+逐字段出处+冲突提示同 05 全套。**红线核心：CRUD 不开放人身数字编辑**——负载/情绪只能由带「自述」口径的文档产生，经理手填他人负载/情绪=替人打分，后端直接 422，前端表单根本不给这些输入位。**残余风险明文承认（PRD A3）**：文档通道的自述行作者身份不可验证（经理可自己写文档伪装自述）——CRUD 硬 422 与文档通道可伪造构成不对称，口径措辞因此必须系统可自证式（「《本周周报》记录的本人自述」），该不对称进 11 的验收表单让 Danny 签认。

引用 PRD User Stories：13（添加/编辑/停用/恢复成员）、25（出处自证）、28（开关关时手编人员卡照样零数字）；9/10 的手编赢+冲突模式同适用于人员。

## 字段/接口决策

（PRD B1/B2/B3/B4）
- **端点**：`POST /team/{ctx}/people`、`PATCH /team/{ctx}/people/{id}`、`POST /team/{ctx}/people/{id}/archive` 与 `/restore`；鉴权/404/422/软删语义同 05。
- **写侧红线（B3）**：person 写入过人身禁键表校验；self_report 槽仅文档抽取通道可产生，写端点出现负载/情绪/任何人身数字键→422；合法编辑面=定性字段（姓名/职位/组别/司龄/负责等）。
- provenance 字段级出处同 B2；registry 双实现+合约测试同扩。
- **交互**：停用键=卡右下低调文字键（hover 变警示色）；折叠区在目录网格之后；表单/按钮家族类+中文 aria；卡面除停用文字键外不放操作控件，编辑走详情浮层页脚。

## Acceptance criteria

机器可验：
- [ ] registry 合约测试扩展（people 四端点+provenance+conflict）全绿。
- [ ] 写侧红线单测：POST/PATCH 带人身数字键（负载/情绪/产能/饱和度等禁键表全样例）→422；定性字段正常写入；self_report 无法经 CRUD 产生。
- [ ] e2e 探针：添加成员→目录卡在+出处「手动编辑」；编辑→值变；停用→主网格消失+折叠区灰化+恢复回来；手编后再传花名册→手编值保持+冲突提示引真句。
- [ ] AFK 门两世界仍绿（开关关：新增手编人员卡 innerText 零数字；开关开：手编人员无自述数据即不显示数字——absent 收起，不编造）。
- [ ] verify-status-truth / cr-align stick 9 绿（折叠区加进目录布局不破坏锚点与网格护栏）。
- [ ] verify-aria-zh、verify-button-family、扫雷 selftest+NEW 清零、verify-p0（console）绿。
- [ ] PATCH 置空字段两世界：置空→payload 该键缺席/null→渲染 `data-empty-kind="absent"`「文档未提及」，绝不 0%/空串默认。
- [ ] cr-align-spec 如需行用 **stick 11**。
- [ ] 本片交付后把 run-battery.mjs 的 CURRENT_STICK 递增到本片 stick 号（11）。

需人眼：
- [ ] 停用文字键/折叠区观感与她方并排（结构对齐文本零抄）。

## 波及面与红线

既有门波及：04 的 team 目录布局与锚点、AFK 门零数字两世界、verify-status-truth、verify-aria-zh、verify-button-family、扫雷 D 系、verify-p0、registry 合约测试、后端重启陷阱。

红线（runbook §2）：人面数字=开关口径且**手填即打分=422**（结构性执法）；手编赢+逐字段出处（ADR-0028）；无物理删除（停用=软删可逆）；en.ts+zh 增量；aria 中文；AA 4.5。

## Blocked by

03（self_report 槽结构与禁键口径）、04（目录形态落点）、05（CRUD 模式先例）
