# S6 kickoff — feat-026 定位叙事页 + 能力边界 mock

工作区:git worktree(从 main 最新),分支 `feat/026-vision-surface`。可与 S5 并行(交集只在 LiteTopbar/LiteApp 挂载点,改动最小化)。开场读:根 session-handoff.md + `.issues/live-polish-0709/plan.md` §1 item 6/7 + §2 四篇参考资料(这次要真读,叙事的弹药在里面)。启动 ./init.sh 绿再动工。

## 使命(feat-026)——把"这是什么、将是什么"讲清楚
Danny 定位原话:lite 当下不为盈利,是给**国内融资团队一个可展示、可试玩的产品**;日后方向是**为公司量身定制的 custom agent 服务**(接入公司数据、安全地部署运行环境)。story 与 lite 真正展示的是 **UIUX**(team 分析 + the room 结果 artifacts)+ **接入公司数据后的能力边界**。

① **定位叙事页/卡**:lite 内加一个说明 surface(页面或卡片,形态自定但要克制、不打断试玩流):现在你看到的是什么(用你自己的文件试玩的 lite)→ 真正的产品形态是什么(定制 agent 服务:公司数据接入、私有安全部署)→ 这个 demo 想让你看什么(UIUX + 判断质量 + 红线)。EN act-first 定稿,ZH 走 M3(scripts/i18n-zh.mjs)。

② **能力边界 mock**:把"接入公司数据之后"的能力做成可看的 mock 预览(不实现引擎,只做诚实标注的 mock——界面上要明示 preview/coming 属性,不冒充已实现):agent 自己的 file system、定制化 skills/tools/SOP、自动批量后台 loop 执行等。弹药与语感从 §2 四篇里取(Steinberger 的注意力约束/三工作流、Schroeder 的领域专精 agent、Pocock 的 skill 手册、Martin-Dye 的分层 tone)。形态自定(叙事页的一部分/独立屏/room 内 mock 卡皆可),给 Danny 留抽查点即可,不阻塞。

## 完工判定(全机器门)
- 新 surface 的 DOM 断言先加进 gate snippet(含:mock 必须带 preview 标注的断言、story 名词黑名单在新 surface 上仍=0)→ 红 → 实现 → 绿;
- 前端门 verdict 全绿 + story 回归仍绿 + init.sh 绿 + 离线 pytest 绿;verdict 原文入 feat-026 evidence。

## 硬约束
🔴 人卡零数字红线在 mock 里同样成立(mock 的示例数据也不许给人上数字/评分);墙不打洞;story 行为零改;eval-harness 只读;mock 不冒充真功能(诚实标注,这是融资场合,吹破的代价是信任);对外发布类动作(部署到公网等)仍是人工闸。

## Worktree 纪律(AGENTS.md)
per-line handoff 写 `.issues/feat-026/session-handoff.md`;只改 feat-026 相关文件 + feature_list 自己那条;LiteTopbar/LiteApp 改动最小化,冲突留 integrator。
