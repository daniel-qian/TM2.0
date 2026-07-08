# lite 打磨波 — 2026-07-09(Danny 试玩反馈,S4/S5/S6 施工图)

> 背景:ADR-0022 救援线(feat-021..024)已于 2026-07-09 merge main(`1f5a56a`),三门全绿。
> Danny 亲手试玩通过基本功能,反馈 7 项(原话见 §1)。本文件 = 该反馈的 session 划分与 kickoff 索引。
> 红线与 standing 约束不变(人卡零数字;rail/store/camera/terminal-stream 不动;中文走 M3;AFK 先斩后奏)。

## 1 · Danny 反馈原话(2026-07-09,试玩后)

1. **playbooks section 没有了**——可能是本身就没有数据;playbooks 在 lite 中也是必须的,可以先以空态形式显示。
2. **team map 没有看到**。
3. **the room 中的画板没了**——拖拽、放大等功能都没有看到。
4. UI bug:`D:\Screenshot\首页UI bug.png`。
5. UI bug:`D:\Screenshot\按钮风格丢失.png`。
6. **商业产品定位**:lite 当下最主要的目的不是盈利,是给国内融资团队一个**可展示、可试玩**的产品;日后方向一定是**为公司量身定制的 custom agent 服务**(接入公司数据、安全地部署运行环境)——是否补一个页面/卡片解释说明。
7. 据 6:不论 story 还是 lite,主要展示表达的是 **UIUX**(team 分析 + the room 结果 artifacts)和**"接入公司数据后的更强能力边界"**(用自己的数据、agent 自己的 file system、定制化 skills/tools/SOP、自动批量后台 loop 执行……Avery 还没做到,但**可以先 mock**)。

对 1–3,Danny 明确说:**不确定是之前拍板定好的还是开发遗漏的,要先考古(结合 S1/S2 两个 session 的记录)出原因结论,再探讨补齐。**

## 2 · 参考资料(6/7 高度相关;kickoff 里按需读,本波之外不外传)

- `D:\Boyle\raw\被约束的是注意力 — Peter Steinberger 的三个 Agent 工作流 @ Greg Kamradt 访谈.md`
- `D:\Boyle\raw\未来是领域专精 Agent — Justin Schroeder @ AI Engineer Summit.md`
- `D:\Boyle\raw\写好 Agent Skill 的 Missing Manual — Matt Pocock @ AI Engineer World's Fair 2026.md`
- `D:\Boyle\raw\Stop Writing Tone Instructions. Layer Them. — Isadora Martin-Dye @ AI Engineer.md`

## 3 · Session 划分(推荐:S4 串行先跑 → S5 ∥ S6 并行 worktree)

| # | 使命 | 依赖 | 形态 |
|---|---|---|---|
| **S4** | 考古判定(1/2/3 是拍板还是遗漏,出结论报告+补齐方案选项)+ UI bug 4/5 诊断即修 | 无 | 主 checkout,短 session;产出 triage 报告 → **Danny 拍板 5 个决定** |
| **S5** | lite 模块补齐:Playbooks 空态屏(必做)+ team map / room 画板(范围按 S4 拍板) | S4 拍板 | worktree(feat-025) |
| **S6** | 定位叙事页/卡(item 6)+ 能力边界 mock(item 7,参考 §2 四篇) | 可与 S5 并行 | worktree(feat-026) |

- **为什么 S4 先行**:1/2/3 的"该不该有/该多厚"是产品拍板,不是工程判断——考古出"当初为什么没有"的实证,Danny 才能低成本拍板范围;4/5 是明确 bug,S4 顺手修掉(act-first)。
- **为什么 S5/S6 可并行**:S6 主体是新增 screen/copy 文件,与 S5 的模块补齐交集只在 LiteTopbar/LiteApp 挂载点——各自 worktree + per-line handoff(AGENTS.md worktree 规则),integrator 合流时解这两个文件的小冲突。若想省心也可串行 S4→S5→S6。
- **完工门(每个 session 一样)**:前端门六相位仍绿(新增模块的断言**先加进 snippet 再实现**,守 ADR-0022 "gate 先于修复")+ story 回归 29 步仍绿 + init.sh 绿(墙 lint)+ 收盘复跑离线 pytest。
- feature 登记:feat-025(S5)/ feat-026(S6)已入 feature_list.json,not-started;S4 是 triage 不立 feature,收盘把拍板结果回填 025/026 的 description。

## 4 · 考古入口(S4 用;"不回放聊天"纪律的例外已获 Danny 授权——他明说结合 transcript)

- **repo 内证据(优先)**:ADR-0022 决策 1(v1 范围原文)· 本目录旁 `.issues/live-rescue-0707/plan.md` §0 岔口 2(拍板记录:"3 屏+薄详情…地图/Playbooks/多人 Chat/满血 gap = story-only")· feature_list feat-019 evidence("酒店包插 lite Playbooks 屏(v2)")· progress.md 2026-07-07/07-08 两节 · 历史 handoff:`git show 4956824:session-handoff.md`(S1 收盘)/ `git show 0723063:session-handoff.md`(S2 收盘)。
- **原始 transcript(需要更细时)**:`C:\Users\86139\.claude\projects\D--avery\*.jsonl`(按 mtime 找 07-07/07-08 两个 session)。
- **截图**:`D:\Screenshot\首页UI bug.png` · `D:\Screenshot\按钮风格丢失.png`。
