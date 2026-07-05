# 商业模式：四层付费取代「advisor AI + tools 免费、playbooks 付费」——无免费层，订阅为主体、服务开路

> 取代旧商业模式口径（2026-07-01 handoff 锁定事实"advisor AI + tools 免费，playbooks 付费"，无独立 ADR）。
> 商业术语正典在 `CONTEXT.md · Commercial language`；与 [ADR-0018](0018-renqingwei-demoted-to-redline-product-truth-decision-layer.md)
>（产品真理 = 管理决策层、商业数字可上展示面）同向配套。带给合伙人的对齐清单见
> `docs/commercial-alignment-for-cythia-20260703.md`。
>
> （文件史注：本 ADR 2026-07-03 首次落盘后被并行 line 的清理误扫、未及 commit；2026-07-05 经 Danny 确认原样恢复。
> 期间决策本体一直安全在 committed `CONTEXT.md · Commercial language`。）

## 背景

2026-07-02 合伙人（Cythia）交付 revenue model deck：四层收入结构（Pilot / Setup / Manager seats / Benchmark +
Consulting），终局 mix 60/20/15/5，commercial thesis = "Start service-heavy to earn trust, shift toward SaaS
seats and benchmark data as repeatable workflows mature."。2026-07-03 Danny 与 Claude 逐条 grilling 对齐后确认：
以该 deck 为唯一口径。

旧口径（"tools 免费"）是 to-C 直觉残留（"工具不值钱、内容值钱"）：与 to-B 信任定位冲突（免费送核心工具 = 供应商
没有承诺），且与 deck 直接矛盾（deck 把 manager seats $79–149/mo 标为 Core SaaS = 收入主体 60%）。同日路演
landing（ADR-0018 重构版）已按 deck 数字上 production，定价对外可见，回头成本已经实际存在。

## 决策

1. **四层付费、无免费层。** 最低入场门槛 = 付费 Pilot / Proof Pack（付费本身是买家筛选器）。
   Setup（一次性信任层，"脏活累活"）是敲门砖不是生意本身；**Manager seats 是经常性收入主体**
   （playbooks 折在席位价内、不单卖）；Benchmark layer 是晚熟的数据护城河。
2. **按 manager 计费，不按全员。** 用的人付钱、与"manager 的决策层"定位自洽；按全员计费会制造
   "全员被监控"观感，撞红线（绝不量化/评判任何一个人）。
3. **终局 mix ≠ 增长期 mix。** 60/20/15/5 是稳态终局图（数学上要求：新客户/存量比 ≈ 6%/年、consulting
   长期 attach ≈ 10–15%、benchmark 接近全员入门档）。增长期真实 mix 服务占大头——这正是
   "charge for trust first" 的本意。两个 attach 假设必须作为明文假设对外/对内使用，不得把终局图当中期图讲。
4. **token 机制：不赚 token 差价。** 标准版席位价含"正常经理用量"（额度用 thread 数表述，不用 token；
   超量降速 + 通知，永不出惊吓账单；条款限人类 manager 使用、禁自动化管道刷量）。企业版自带 API key =
   **信任功能而非折扣**（模型边界在客户手里；席位费照收，让步上限 = 实际 token 成本，约 $10–15/席/月）。
   每公司设**最低席位数**盖住 per-company ambient 成本；企业版按接入数据源数量/量级分档。
5. **always-on 边界。** always-on *listening*（信号接入、reality-gap 检测、briefing 生成）在产品定义内——
   前辈值钱恰因天天在场；其成本大头走 deterministic 管道，只有增量走模型。always-on *acting*（无人确认
   自动对人动作）在定义外，被既有红线挡住（"nothing happens to anyone on autopilot"）。
6. **Benchmark 三条不可破边界**（与"绝不评判个人"红线同源）：①只聚合组织级运转模式，可定位到个人的
   信号永不进池；②客户明确知情、可退出（opt-in/opt-out）；③同段样本不足不出对比数（防反匿名化）。

## 被否的替代

- **维持"tools 免费"**：毁 to-B 信任定位，且把 60% 收入主体白送。否。
- **BYO-API 给折扣 / 免订阅**："自带 key = 后续不收费"会把席位收入归零；折扣框架还会引来
  "剩下的钱是什么"的砍价。否——BYO 是企业版信任卖点，不是省钱通道。
- **按全员/按公司规模计费**：单价更低更好卖，但制造监控观感、且价值锚（manager 的判断力）会漂移。否。
- **早期路演隐藏 benchmark 层**（怕"卖客户数据"质疑）：否——三条边界本身就是信任故事的一部分，
  主动讲比被问出来强。

## 后果

- `CONTEXT.md · Commercial language` 为商业术语正典（Commercial thesis / Pilot / Setup / Manager seat /
  Benchmark layer / Consulting retainer 六词条 + Capabilities 词条改"随席位订阅、不单卖"）。
- landing 盈利模式屏（ADR-0018 重构版）与 deck 数字一致，"工具免费"句已随重构消失；
  旧 45/20/25/10（6-30 旧版材料）不再使用。
- session-handoff §2 旧锁定事实已更新指向本 ADR。
- 路演 Q&A 口袋答案与待 Cythia 确认项：`docs/commercial-alignment-for-cythia-20260703.md`
  （中文版 `*.zh.md`，MiniMax-M3 生成）。
