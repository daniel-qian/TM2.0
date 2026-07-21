# input-side-0721 · 输入侧棒 r2 —— 计划与拍板增补

日期：2026-07-21（紧接 cr-align-0721 棒 1，feat-081 已上线 c05fc98）。
拍板基线：`.issues/cr-align-0721/decisions.md` 九项中的 ⏭ 三件套（3A 示例团队 / 5B 体检卡 / 8A onboarding 采集）。

## Danny 0721 追加拍板（本棒开工指令，逐字要点）

> onboarding 不要像现在做浮层，而是单独放在一个页面作为闸门；
> 一键示例团队也可以放在前置的 onboarding 中；
> command-room 版本中有单独 onboarding 页可以参照对齐（藏起来了，没写进路由）。

勘察证实：cr 的 onboarding 页在 `D:\cr-live\src\app\companyinput\`（路由 `/companyinput`，
无任何导航入口），其 layout 就是 `position:fixed; inset:0; z-index:9999` 的**全屏闸门**——
5 步卡片（上传资料→连接工具→团队信息→管理偏好→创建账号），步进度条 + 底部图标步条，
每步带「跳过也没关系」小字，终点「🚀 进入指挥室」。连接工具步是纯假 toggle（我们红线不抄）。

## 本棒范围（我的切法）

1. **后端 issue #10 先决修复**：`_slug` 中文名压缩 u_x + 跨文档去重失效（LLM 路径特有）。
   真中文名语料先红过再修（全 ASCII 语料是伪装，memory 有案）。
2. **onboarding 浮层 → 全屏闸门页**：参照 cr companyinput 的形态（全屏、步进、进度条），
   保留我们的诚实红线（不做假连接工具/假账号步）与既有生命周期语义
   （有数据不弹 / skipped 永不弹 / pause 续进度 / reopen 重看）。
   第一屏「三扇门」：①一键示例团队 ②上传自己材料（走完整步进）③先进空指挥室逛逛（低调）。
3. **3A 一键示例团队**：三亚脱敏 seed 六份（1 汇报 docx + 5 匿名简历 pdf，人物名即
   「虚构人员1~5」——自证脱敏，不改名）预铸后端 demo context；多访客写脏问题按后端
   实际 write path 决定（克隆 or 只读）。「实时数据缺位」故事在示例里呈现（Danny 3A 附注）。
4. **8A 公司状况采集送后端**：闸门页团队信息步扩展 + company_notes 落库；
   「不会发到任何地方」文案同棒必改（DoD 显式项）。
5. 5B 体检卡：**本棒不动**（棒级工作量，动抽取层元数据），交接单头号预告。

## 风险与既知陷阱

- 全部既有门电池是 fresh-boot——闸门页会挡住所有旧门，需统一 bypass 约定并逐门排查。
- dist 指向陷阱（verify-auth-capability 重打 dist 到 8281）：dist 重建门放最后 + 终局重建。
- 共享 demo context 的访客互踩：等后端勘察定克隆/只读方案，宁可多做克隆不做假只读。
- seed 简历名「虚构人员N」只差一个数字——修 #10 后要专门断言 5 人不塌卡。
