# feat-020 Kickoff — 建筑公司（Skeppsviken，瑞典）调研 + 办公软件集成可行性

> research deliverable（非代码 feature）。**立即可起**，不阻塞任何线。

## 客户事实（Danny + 合伙人调研）
- 客户 = **Skeppsviken**（瑞典建筑公司，官网 https://www.skeppsviken.se ）。**注（07-05 更正）：byggsamverkan.se 不是客户官网，而是其建筑团队所用 PM 软件 Next Project 的厂商页。**
- **境外公司（瑞典）→ 联网用普通 WebSearch/WebFetch，不走 mmx-cli**（mmx-cli 只管国内）。
- 已知技术栈（合伙人直接问来的，"其他就没有了"）：

  | 用途 | 软件 |
  |---|---|
  | 施工侧一般工作沟通 | **Teams** |
  | 通用工作沟通 / 邮件 | **Outlook** |
  | 专业画图 | **CAD** |
  | 项目管理 | **一款纯建筑项目软件**——合伙人指向 byggsamverkan.se，说"方便查看费用/材料，其实类似 Excel"。**需查清实际产品名**（多半不是官网本身，而是某款瑞典建筑成本/项目工具）。 |

- 岗位与日常：Danny 已大概了解（职位 + 大致日常），本线**深化**。

## 调研规则（硬）
- **调研结果落 `D:\Boyle\research\skeppsviken-construction\`（项目外），不要进本仓库。**

## 目标
摸清 Skeppsviken 的岗位/日常/技术栈，评估各办公软件的**集成可行性**，喂 "live sync roadmap" 叙事：lite 版靠上传，企业版将来靠 live 连接器（哪些值得做、成本多大）。

## Scope
- **公司/岗位/日常**（官网 + web）：Skeppsviken 是什么公司、规模、岗位构成、典型日常工作流。
- **技术栈逐个查集成可行性**：
  - **Teams / Outlook** → Microsoft Graph API（开放、OAuth；能拉消息/邮件/日历/文件）——可行性高，写清 scope/认证。
  - **CAD** → 先识别是 AutoCAD / Revit / 别的；Autodesk Platform Services (APS) 有无开放 API、能拉什么（图纸元数据/BOM/费用）。
  - **建筑项目管理软件** → **先查清实际产品**（从官网线索 + 瑞典建筑软件生态定位），再查有无开放 API/导出、能拉费用/材料/项目数据。
  - 每个查：开放 API 有无、能拉什么（人/项目/日程/文档/费用材料）、认证方式、集成成本与门槛、开放平台文档链接。

## AFK 验证门 / DoD
- web 调研（WebSearch / WebFetch），**引用来源、不臆测 API**。
- 产出落 `D:\Boyle\research\skeppsviken-construction\`：公司/岗位/日常一节 + 每个软件一节 + 可行性结论表（可行/受限/封闭）+ roadmap 建议（哪些 lite 靠"导出文件上传"即可、哪些企业版做 live 连接器）。

## HITL
- 无硬 HITL；Danny 读结论定企业版连接器优先级。

## 备注
- 酒店（三亚绿杉壹居）的国内办公软件可行性归 **feat-019** 的国内调研（走 mmx-cli），不在本线。
- 建筑客户的 vertical pack authoring 是**后续 feature**（研究落地后再开）；本线只出调研 + 可行性。
