# 输出形态战役（output-form-0729）· 回执

三片全交付，全部攒本地 main 未推（push=上产人工闸）。kickoff 里的 01/02/03 全做完；
04 收官项见文末。用户侧证据链：`.issues/feedback-0729/persona-review-0729.md` P1。

## 01 · 画板退役（`08c82c3`）
- LitePanZoom（v02）+ 画布 CSS 五段删除；议事室改 `.lite-room-scroll` → `.lite-room-board`
  纵向语法（与 closerlook 同口径）；`.lite-room-board` 类名保留承担解除 story 定位职责。
- 门翻转：gate 相位 H「画布必须绝迹」；verify-room-usability v02 分支重写（23/0）。
- v01 画布 + react-zoom-pan-pinch 依赖保留（冻结壳；依赖随 v01 退役再摘）。
- ⚠ 记档：像素基线对本片**零漂移**——像素谱只拍议事室空闲态，画板只在提问后挂载。
  跑态覆盖=可用性门+截图。又一例「门绿≠部件被验到」。

## 02 · 砍契约样板（`c37b777`）
- REQUIRED_FIELDS 9→3（summary/evidence/recommended_actions）；四块硬编码常量文
  （diagnosis_hypotheses 固定 alternative / confidence 恒 medium / escalation 恒 none
  「何时拉 HR」/ metrics_to_track 固定 3 条）投影层不再补齐——absent≠none。
- 实测同问题卡文本 2145 → 1214 字符（-43%）。
- 前端 v02+v01 同款守卫：coerce 缺席不再默认补 medium/none（旧行为=替系统编造判断）；
  卡对应节整节不渲染。
- 对外口径：contract.py 文档串改「9 字段=上限形状，按需出现」；历史 ADR 不改史；
  landing/partner 页无该 schema 字面宣传（已 grep 核实）。

## 03 · 分流短答（`618c991`）
- `answer_direct` 第二终局出口（同吃 cite 闸）→ `enforce_answer`（非空/红线/cite 三地板）
  → manifest `answer_kind:'answer'`（additive）→ 前端「Avery 的回答」气泡（v02+v01）。
- mock 分流正则宁漏勿错杀（钉子测试 + 门世界 B）；真 brain 由提示词判据选工具
  （CHAIN_HINT 双出口 + 长度指令）。
- 新门 verify-answer-split-03 入电池 → **电池 25→26 道**（A 20/B 3/C 3）。

## 验证汇总
- 离线套 **3467 passed / 0 failed**（+3 新测试，四 deselect）
- 全电池 **26/26 绿**（战役内共跑 4 轮全量：命名后两轮 + 02 后一轮 + 03 后一轮）
- 截图人眼过：画板退役顶/底、砍样板后卡、短答气泡（scratchpad 单机产物，关键数字入档）

## persona P1 复核（拍板目标 vs 实测）
问「明天中层例会是几点？」：
- 改造前：2145 字符 9 节英文报告卡，装在需拖拽缩放的画板里默认截断。
- 改造后：一段话「Avery 的回答」气泡，无卡、无滚动、出处在分析过程面板。✅ P1 三重劝退清零
  （mock 语义罐头仍是英文占位——真 brain 语义质量归下一条）。

## 🔴 诚实边界（别当成已验收）
1. **真 brain 的分流判据从未真跑过**：分流两层机制里，离线测的是 mock 正则层；
   真 LLM 按 CHAIN_HINT 判据选工具这条路（含 answer_direct 的语义质量）要等生产 LLM
   链路首次走通才见真章——而 handoff agent 线 #4「生产 LLM 零调用」仍未解。
2. 快问发送后闭环（persona P2）本战役未动。
3. 决策卡理由机械重复（P3）、议事室建议问题从数据长出（P4）→ 留给后续片。

## 04 收官项
- [x] receipt（本文件）
- [x] handoff 换头
- [ ] persona loop 固化为定期跑法（建议下个 session 用 auto-loop 姿势接）
