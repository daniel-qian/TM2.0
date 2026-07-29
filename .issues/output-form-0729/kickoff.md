# 输出形态战役（output-form-0729）· kickoff

**拍板**（Danny 07-29，AskUserQuestion「分流+砍样板」档）：简单问题走短答（纯文本+出处），
复杂问题保留结构卡但砍样板、空节不渲染；同战役淘汰议事室画板。
**用户侧证据**：`.issues/feedback-0729/persona-review-0729.md` P1（问例会几点→2145 字符英文报告卡
+ 画板里默认截断）、P3（决策卡理由机械重复）、P4（建议问题咨询腔）。
**根因侦察**（07-29 五路侦察之一，要点）：engine.py:107 禁自由文本 → contract.py:35 九字段必填、
空字段判失败 → contract.py:107-147 四个字段是硬编码常量（confidence 理由/升级提示/3 条跟踪指标/
alternative 假设）每答必贴 500+ 字符 → 提示词 103 行零长度指令。mock（live_input.py:79-94）同形。

## 切片（串行）

### 01 · 淘汰画板（纯前端，先做——Danny 点名 + 最机械）
- 删 `src/lite2/LitePanZoom.tsx`（58 行）+ v01 双胞胎 `src/lite/LitePanZoom.tsx`（57 行）+
  `react-zoom-pan-pinch` 依赖；RoomScreen 画板 JSX（v02 :296-336 / v01 :128-168）改标准
  `frame → scroll → card` 纵向语法（与其余八屏同语法）：思考流面板 → 状态行 → 判读卡 → 快问卡
  纵排，composer 保持屏底常驻。
- CSS：lite2.css 画板五段（797-873 / 1098-1136 / 1561-1566 / 6013-6017 / 430-462）+
  lite.css 双段（590-706 / 371-396）删除/改写；⚠️ `.lite-room-board` 1180px 世界宽退役后，
  卡宽回容器流——ui-detectors 的 h-overflow 豁免（:139/:209）同 commit 摘除，越界会被重新抓到。
- 门（5 钉子同 commit）：gate 相位 H `assertRoomCanvas` 改「无画板 + 卡在文档流 + composer 在场」；
  `verify-room-usability` F2 滚轮劫持族重写（画布没了，滚轮=页面滚动即正确），F1 遮挡断言保留；
  `verify-aria-zh`/`roomBoardAria` 键随容器改（画板没了 aria 改「问 Avery —— 输出区」）；
  像素基线 room 屏重冻。
- 判读卡 1700px+ 高：纵向滚动归页面（同 notes/projects 屏语法），不做卡内滚。

### 02 · 砍样板 + 空节不渲染（后端契约 + 前端卡）
- `contract.py::project_advice`：四个硬编码字段改「有真内容才发键」（absent≠none 铁律沿用）；
  `check_schema` 必填集收缩到 {summary, evidence, recommended_actions}（read/move 的投影）；
  `_actions_from_move` 句拆上限保留。
- `LiteAdviceCard.tsx`：每个 section 按键缺席收起（现只有空数组兜底）；ZONE 2/3 整区空则不渲染。
- ⚠️ 对外口径：9 字段 schema 在 partner 文档是卖点——`.issues/partner-docs-0728/` 相关描述
  加「按需出现（absent≠none）」措辞，不撒谎不删卖点。
- pytest：contract 相关测试重写期望；全离线套必须回绿（带四个 deselect）。

### 03 · 分流短答（后端 + 前端 + 门）
- 机制：engine 给模型加第二条出口工具 `answer_direct(text)`（仍要求先 cite；简单事实问题
  直接一段话+出处），draft_advice 留给「需要判断」的问题——分流由模型选工具，不做前置分类器
  （提示词写清判据：问事实/日程/数字=短答；问人/风险/怎么办=完整判读）。
- transport/streamSource：新事件形态 `kind:'answer'`（text+cites）；store/RoomScreen 渲染
  短答气泡（纯文本+出处 chips），不进判读卡。
- mock：live_input 按问题长度/疑问词给两种罐头，保证门能测两条路。
- 门：verify-room-usability 或新 e2e 覆盖「短答不出 9 节卡」「复杂问题仍出卡」两世界。
- 提示词补长度指令（skills md：短答一两句；判读卡各节也给字数上限）。

### 04 · 收官
全电池两轮零红 + 像素重冻晨审 + persona check 复跑（P1 应消失）+ receipt + handoff。

## 红线
absent≠none 全链沿用；人情味红线不动；zh 文案走审字流程（本战役新增文案少：短答无新键、
aria 一两个）；v01 room 屏随画板淘汰同棒改（verify-room-usability 有 v01 分支）；push 等 Danny。
