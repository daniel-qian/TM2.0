# 回执 · #66 @ 弹层遮挡/错位 + #67 预填入口全量引用化（捆绑 session，2026-08-08）

两票同区（都动 AskRefComposer/议事室一带），按 kickoff 拍板捆一个 worktree 做完。
分支 `claude/priceless-murdock-6d6ce4`，改动 10 文件 +483/−30。

## #66 · 交付面

1. **可用空间感知**（AskRefComposer.tsx）：开层瞬间（layout effect，首帧 paint 前）量
   「锚点 → 裁剪窗口」的上下余量——裁剪窗口 = 视口 ∩ **一切 overflow 非 visible 的祖先**
   （不止 `.scene`，见下面「病根修正」）。默认上弹；上边装不下整层且下边更宽裕 → 打
   `is-down` 翻转向下（CSS `top: calc(100%+8px)` 对偶规则）；哪边都不够 → 列表 max-height
   钳进余量（inline style，地板 72px）。resize 重量；不听 scroll（三宿主锚点都不在滚动区）。
   常数四枚在文件头（PICKER_GAP/PICKER_CHROME/LIST_MAX_HEIGHT/LIST_MIN_HEIGHT），
   LIST_MAX_HEIGHT 与 lite2.css `.lite-ref-picker-list{max-height:240px}` 同值互为镜像。
2. **空态包含块**（lite2.css 478 段）：`.nexus-empty-composer-wrap` 补 `position: relative`
   （无偏移零几何变化）；**482-487 那条 static 一个字没动**（它保空态文案不被盖，票面红线）。
3. 静息态 DOM 逐字节不变：placement 状态只在层开着时产生 class/inline style；`<form>` 只多
   了一个 React ref（无 DOM 属性）。像素基线锚静息态的承诺原样成立。

### 🔴 病根修正（比票面读码结论多看出来的两层，值得记）

- **票面病根 3（空态包含块误落 `.nexus-empty`）在 Chrome 里实际不发生**：
  `.nexus-followup-composer` 基类（55-ask-composer.css:16）带 `backdrop-filter: blur(12px)`——
  规范上 backdrop-filter ≠ none 就给 absolute/fixed 后代**建包含块**，static 也建。弹层从来
  锚在 form 上。wrap 的 relative 因此是**第二把锁**（跨引擎 + 防将来改皮删掉 backdrop-filter），
  不是主修复。主修复是碰撞检测。
- **空态还有一层票面没写的裁剪**：`.nexus-empty` 卡自身计算值是 `overflow: auto`——弹层
  超出卡顶不是「盖在文案上」而是被卡自己裁掉。碰撞检测把它一并当裁剪窗口算（「一切
  overflow 非 visible 祖先」的写法就是为它），空态弹层因此在卡内翻转向下 + 钳高，
  完整可见。这也是空态弹层比其他宿主矮的原因（卡内可用空间就那么大），列表内滚可达全部候选。

## #67 · 交付面

1. **唯一一把尺**（askRefs.ts）：`refOfPerson(team,id)` / `refOfProject(team,id)` /
   `refOfSubject(team,type,id)`——按 id 查 store.team（弹层检索的同一份数据面）；
   **searchAskRefs 造候选也改走同一构造器**（命中判定归 searchTeam，五元组构造归 refOf*），
   「同一把尺」不是口头约定而是同一个函数。dupeTeam 全量花名册口径随构造器走。
   查不到（归档/停用/悬空 id）返回 null → 调用点退纯文字预填，绝不硬造 chip。
2. **7 调用点全接**（零签名改动，#64 通路）：
   - DetailOverlay 项目体/人员体 「去问 Avery」→ `setComposerDraft(text, [ref])`；
   - HomeScreen 分诊卡 → **多引用**（projectIds+personIds 全带，查不到丢弃；超 8 由后端
     REF_MAX_COUNT 封顶，前端不另限）；差距卡 → project ref；
   - HomeScreen 决策卡 → `goScreen('room',{q,refs})` 中继（encodeRefsParam，胶囊同款；
     kind 映射在 refOfSubject 里，调用点零 'project' 字面量——将来新主体类型走 null 退纯文字）；
   - ProjectsScreen 卡面 / TeamScreen 人卡 → 各自 ref。
3. i18n 零新键（孤儿 0 / 叶子键实数 984）；JSX 零新标点字面量。

## 门（verify-at-references 扩展，40 判据）

- **⑧ #66 弹层几何**：三宿主 × 视口矩阵（1280×900 / 900×600 / 胶囊加测 900×340 高 zoom
  小窗）。判据三合一：bbox 完整在视口内 + **elementFromPoint 实测顶沿真的画出来**
  （rect 不管裁剪的碑——变异实测里 rect 判据确实漏掉空态@1280 的场景裁剪，hit-test 逮住）+
  与输入框相邻（≤64px；空态病根的「飞离」形态是 130px+）。探针用空查询 `@`（8 候选、
  弹层最高）——矮弹层装得下任何视口，测不出碰撞。
- **⑨ #67 入口**：7 入口逐个**真点**卡面按钮 → chip 自证在场 → 真键盘提交 →
  **POST /advise 请求体带对应 references[]**（判据落网络层，T10 门洞纪律）。分诊卡判
  「与 handoff 信号逐一对应、不多不少」；人卡/人员浮层判 chip **带部门**（消歧讨伐位）。
- 语料加第四件 `亲子乐园.md`（自报「正常」→ steady + 真有阻塞行）造差距卡；既有 ①-⑦
  判据一条没动，新语料对它们的影响逐条核过（'@林' 多出的项目候选不进「两位林小满」计数）。

### 门剧本里的一个坑（记档）

⑨ 入口 3/4 首跑红：我直接站在 `/room` 上开详情浮层再点「去问 Avery」——RoomScreen 只在
**挂载**时消费预填，已在 room 上不重挂 → 没 chip 没 POST。产品里不存在这条动线（room 上
没有开详情的入口），是门剧本错不是部件 bug；改成「先回项目/团队屏再开浮层」（真实动线）后绿。
**落点类判据要先离开目的地再触发**的又一实例。

## 变异账（7 条：6 杀 + 1 记档存活）

| # | 变异 | 结果 |
|---|---|---|
| M1 | 拆碰撞检测（placement 恒 up+240） | ☠ 3 红：胶囊@340 出视口、空态@1280 场景裁（**只有 hit-test 红，rect 判据看不见**）、空态@600 双裁 |
| M2 | 拆空态 wrap relative（单锁） | ⚠ **存活**——`backdrop-filter` 内锁在 Chrome 独立成立（见病根修正）。belt-and-braces：外锁在门的引擎里天然免疫变异，立此存照 |
| M2′ | 双锁齐拆（relative + backdrop-filter:none） | ☠ 3 红：错位形态（top=666 飞离输入框 160px+）被相邻判据逮住——判据有牙 |
| M3 | TeamScreen 抹 refs 实参 | ☠ 2 红（人卡 chip + 网络判据），其余入口全绿 |
| M4 | 决策卡抹 refs 中继 | ☠ 1 红（决策卡），其余全绿 |
| M5 | refOfPerson dupeTeam 恒空 | ☠ 4 红：**弹层①消歧 + 入口⑨人卡/人员浮层一起红**——「同一把尺」的实证：改 helper 一处两个消费端同死 |
| M6 | 分诊卡抹 personIds | ☠ 1 红（多引用「逐一对应不多不少」） |

## 电池终值（隔离端口：后端 8157 mock 全离线 / preview 5173+5193 同一 dist）

- A 区：首跑 29/30——唯一红 onboard-gate 是**门环境错配不是代码**：我把 `AVERY_DEMO_SEED_DIR`
  指到了 RAG 验收那对英文文件（`tests/fixtures/seed`），demo 门要的是
  `tests/fixtures/demo-seed`（中文三亚团队 16 人语料）。症状形态：xlsx 文件名被兜底成
  「1 人 Founder」卡。修正 env 后单门复跑 **46/46 绿**；其余 29 道（含 at-references 新版
  40/40）首跑全绿。
- B 区：data-boundary **37/37** · null-owner **15/15**（含「注入路径生效过」防空真自证）；
  visual-baseline 本 worktree **不跑**
  （`__snapshots__` 是 gitignore 单机产物、worktree 里没有基线——跑了就是「没有基线」剧场；
  真像素比对按纪律在合 main 后的主检出做，见收尾）。
- C 区：**3/3**（auth-capability / auth-form / bundle-privacy）；跑完 runner 已重建 dev dist，
  截图与一切上传型动作都在 C 之前做完（序的纪律）。
- 后端离线全套：**3974 passed / 115 deselected / 4 xfailed / 0 failed**（76.9s；本批零后端
  改动，跑它是合并前的回归确认——账面与 #64 逐字相同）
- `./init.sh` 绿（typecheck + build）。
- **后合复验**（#65 先落 main `3910bcb`，本 session 是后合者）：`main` 合进本分支零冲突
  （HomeScreen 两票改的是不同段落——`gapsOpen` 初值 + 我的三处 handler 同居无恙；差距卡门
  剧本的「若收起先点展开」容错分支在 #65 默认展开下自然跳过）；合流树上**全电池复跑**：
  A **30/30**（含 flow-gap-phases 10 判据 + at-references 40 判据）· B 37/37+15/15 · C 3/3；
  主检出 main 同树像素 + 电池见下节。

## 交互态截图（人眼过）

`.issues/rehearsal-0808/t66-shots/`：desktop/mobile × 空态/运行态/胶囊 打 `@` 弹层 6 张
（#66 票面口径）+ #67 预填态 2 张（分诊卡多引用 chips / 人卡重名消歧 chip 带部门）。
**8/8 人眼过通过**：空态向下弹贴输入框（desktop/mobile）、运行态/胶囊向上弹八行候选全可见、
分诊预填双 chip（项目+人）、人卡 chip 带消歧部门；零折行溢出零破碎。
顺手发现（不修，记档）：弹层 `--lite2-surface` 背景带透明度，运行态盖在长文 advice 卡上时
底字微透——#64 落地时的既有皮肤，非本票引入；要改是皮肤票。

## 拍板取舍

- **空态弹层向下弹**（1280×900 下也向下）：`.nexus-empty` 卡 overflow:auto + 卡顶以上
  不可滚——向上弹注定被裁，向下盖住建议 chips 是浮层的正当行为（z 序在卡内成立）。
- **胶囊矮视口不翻转只钳高**：胶囊贴屏底，下方永远没空间，翻转无意义；钳高保「完整可见」。
- **PICKER_CHROME=64 是估算常数**（padding 20+筛选行 26+gap 8+边框 2 ≈ 56，留 8 余量）——
  刻意不做二次实测回填（首帧就要定位，两趟布局才能拿真值）；代价是极端场景多让出几像素。
- **M2 单锁存活不补门**：给「wrap relative 被删」单独造红需要门去断言 CSS 规则本身
  （黑名单式判据，碑上有名）；行为层已由 M2′ 证明判据有牙，两把锁是两个独立机制层
  （CSS 定位 vs 视觉效果副作用），同引擎下互为冗余是特性不是洞。

## 已知边界

- 弹层高度常数与 CSS 的 240 是**镜像不是单源**（TS 读不了 CSS 变量在首帧）；改一处必须
  同步另一处，两个文件的注释互相指认。
- 空态弹层可用高度受 `.nexus-empty` 卡几何钳制（列表可能只剩 ~2.5 行，内滚可达）；要更大
  弹层得把弹层挪出卡（portal），超出本票范围。
- refOfSubject 对未来 'person' 型决策主体已接（映射在 helper 里），但今天后端恒发 project，
  person 分支未被真数据走过。
- 分诊卡 personIds 依赖后端 ownerId 链接（负责人名 ↔ 花名册对上才有）；对不上时退化为
  只带 project ref——门的自证判据（首张 handoff 双引用源）会先红，不会静默。
