# feat-019 Kickoff — 酒店 vertical pack + skin + demo（换皮首例）

> 换皮首例（ADR-0021 §3，D6）。**pack-authoring + 调研本 session 就能 AFK 起（D5 并行）**；全链演示依赖 feat-016/017。

## 客户事实（Danny 校正 — 关键）
- 客户是**度假酒店**：**三亚绿杉壹居度假酒店**（三亚，海南）。**不是"婚庆公司"。**
- **婚庆/婚宴是它的一条业务线**（很可能是切入钩子——度假地目的地婚礼），但包要按**度假酒店**建模，婚宴作 **showcase 亮点线**。
- demo 要让对方看到 Avery **懂他们是家度假酒店**（多部门、多业务线），而不是把他们当单一婚庆商——这才"眼前一亮"。

## 调研规则（硬）
- **国内公司 → 联网一律用 `/mmx-cli`**（国内数据源更准；见记忆 domestic-research-use-mmx-cli）。
- **调研结果落 `D:\Boyle\research\sanya-lushan-yiju-hotel\`（项目外），不要进本仓库。**
- 包/skin（代码+数据）是项目交付物 → 留仓库内；**只有调研笔记出仓**。

## 先读
- `docs/adr/0021-*` §3（换皮）· 战略 doc §换皮 · `assets/0630-partner-docs/`（合伙人 HR 包 = 目标形状）· `eval-harness/cases/scn-*.md`（现有 case 形状）

## Scope
1. **调研（/mmx-cli → 落 D:\Boyle\research）**：
   - **查实三亚绿杉壹居本身**：定位/规模/星级/业务线/婚宴产品（官网/OTA/点评/公众号），查不到再退化为"三亚度假酒店"通识。
   - **度假酒店运营通识**：组织架构/部门/岗位（前厅·客房·餐饮·宴会销售·工程·市场·人力）、日常协作流、典型跨部门项目（大型婚宴、会议接待、翻新工程、旺季调度）。
   - **婚宴/婚庆业务线（showcase）**：筹备流程、客户情绪管理、供应商（场地/摄影/司仪/餐饮/花艺）协调、典型纠纷与风险点。
   - **常用办公软件**：酒店 PMS（西软/中软/别样红等）、OTA 渠道、CRM、钉钉/企微——为 feat-020 的 "live sync roadmap" 供国内侧输入。
2. **Capabilities 包（混合 authoring，D7）**：基于调研起草 v1，落成跟 HR 包**同形**的 cases/playbook/信号阈值——**酒店运营为主体，婚宴为亮点**。Danny 补内行 know-how（HITL，几条即可）。
3. **skin**：度假酒店视觉主题（配色/措辞/示例贴合），**布局与交互机器不变**。
4. **demo 流**：酒店当场上传真文件（样本）→ ingestion → 酒店 Your team 长出来 → advisor 落在他们数据 + 酒店/婚宴 Playbooks。办公软件 live 连接器 **mock**（garnish，不真接）。

## AFK 验证门
- `eval-harness` 跑酒店包：红线/cite/schema 绿（跨家判官可选）。
- ingestion 跑酒店样本文件 → Your team 长出 + 红线（**酒店语境也绝不给人打分**）。

## DoD / HITL
- 酒店包 + skin + demo 流可跑；AFK 门绿；调研笔记落 `D:\Boyle\research\sanya-lushan-yiju-hotel\`。
- Danny：补酒店/婚宴内行 know-how（几条）；审字中文/英文 copy；真机看"眼前一亮"手感。
- 注：**调研 + 包 authoring 这一半，现在就能并行起跑**，不必等内核。
