# 09 · 重新开始+演示控制

## What to build

设置齿轮菜单加第三行「重新开始」：清 **lite2:\* localStorage 全量**（照共识原文：context 锚点、known contexts、onboard 态、flow 待办、语言/观感偏好一并回出厂）+ 遗忘全部 owner_token + 回 onboarding 闸门。store 层新增全量重开 action（现只有 run 级 reset）。并确认示例团队门换富语料后的演示闭环全流程：开页→一键三亚→满态→重新开始→空态（10 秒复位下一场）。

引用 PRD User Stories：20（10 秒复位）、19（一键满态，闭环里实证）。

## 字段/接口决策

（PRD E1/E2）
- 纯前端+localStorage，无新后端。清除清单：context 锚点键、known contexts、onboard 态键、flow 待办键、语言/观感偏好键（lite2: 前缀全量）+ transport 的 forgetAllOwnerTokens。
- **拍板①**：全清含语言/观感——如需保留偏好属改共识不属改实现（进收官验收表单复核项）。
- 按钮=齿轮菜单第三行（现有语言/观感 switch 行之后），挂按钮家族类+中文 aria；改齿轮菜单结构须同步经过该菜单的既有门。
- E2（seed 换三亚）已由 07 落地，本片只跑通闭环并固化探针。

## Acceptance criteria

机器可验：
- [ ] verify-onboard-gate 加**世界 F**：重启→骨架+闸门重弹+context 锚清空；与既有世界 C 的 pause 语义（in-progress/step 保留）不冲突。门绿（含既有世界 A-E）。
- [ ] verify-switchers 加重启世界：考「全清含语言/观感回出厂」这一拍板；非重启世界的④记忆断言契约不变。门绿。
- [ ] e2e 闭环探针：无痕开页→onboard 闸门→一键三亚（真 claim）→满态断言（16 人/6 项目在）→点重新开始→lite2:\* 键全空+owner_token 忘光+闸门重弹→空态。
- [ ] verify-button-family、verify-aria-zh 绿（新按钮/确认交互）。
- [ ] verify-auth-form（C 区，经过齿轮菜单）绿——🔴 殿后独占跑。
- [ ] verify-home-skeleton 绿（世界 B 闭环不考重启，但 flow 待办被全清的语义与拍板一致）。

需人眼：
- [ ] 完整演示排练一遍，计时复位是否 10 秒量级；「重新开始」措辞与误触保护（是否需确认一步）观感判断。

## 波及面与红线

既有门波及（门影响面摸底 F 节）：verify-switchers（④记忆契约）、verify-onboard-gate（世界语义）、verify-auth-form（C 区齿轮菜单结构）、verify-home-skeleton（flow 语义）、verify-button-family、verify-aria-zh。

红线（runbook §2/§3）：清 lite2:\* 照共识原文执行；en.ts+zh 增量；aria 中文；测「从头开始」用无痕窗/清键（localStorage 自动恢复陷阱）；C 区门殿后+跑完重建 dev dist。

## Blocked by

07（闭环全流程含一键三亚满态）
