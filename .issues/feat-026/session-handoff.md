# feat-026 per-line handoff — lite 定位叙事页 + 能力边界 mock（S6）

> Worktree/line 纪律（AGENTS.md）：本文件是 feat-026 这条线的 per-line 交接；跨线合成（根
> `session-handoff.md` / `progress.md`）留给 main-checkout integrator。分支
> `feat/026-vision-surface`（base 0a15628 = S5）。

## 0 · 一句话现状
feat-026 施工完成，**全机器门证据非自报**：前端门十相位 verdict `pass:true`（含新增
`visionSurface` + 原九相位回归全绿）· story 未受影响（`?mode=story` 下 `.lite-shell`=0、
新 vision 类=0、story 正常渲染）· init.sh 绿 · 离线 pytest 190 passed 0 skipped（基线不变）。
临时 seed 文件已 rm；dev/8137 已停。状态 not-started→done。

## 1 · 使命与形态取法
Danny 反馈 6/7 + S4 triage Q4（三模块补齐与本叙事绑做、锚未来 custom-agent 能力、诚实标 mock）。

**形态**：lite 内新增**第 5 个 tab「Where this goes」= 一屏两段的独立 Vision 屏**
（`src/lite/screens/VisionScreen.tsx`）——克制、独立成 tab，不打断试玩流。
- **① 定位叙事（三拍）**：`.lite-vision-narrative`，三个 `.lite-vision-beat`：
  你刚用的 = 拿自己文件试玩的 demo（诚实说明这是公开可试玩版、非已部署产品）→
  真正的 Avery = 为一家公司量身定制的 custom agent（接你的数据、私有安全部署、窄域
  domain-specific、访问有边界可审计）→ 这个 demo 想让你判断的三件事（UIUX + 判断质量 + 红线）。
- **② 能力边界 mock（诚实标注）**：`.lite-vision-mocks`，四张 `.lite-vision-mock`，
  **每张必带 `.lite-vision-tag`（Preview/Coming/Mock）**——绝不冒充已实现：
  agent 自己的文件空间 / 定制 skills·tools·SOP / 后台批量 loop / 红线是确定性闸。
  底部 `.lite-vision-comingsoon` 再明示「四项都尚未上线，本 tab 是诚实的边界预览」。

**从四篇提炼进文案的关键点**（.issues/live-polish-0709/plan.md §2）：
- **Steinberger（注意力约束）** → mock「后台批量 loop」文案：「最稀缺的是你的注意力，
  所以产品把它留到最后用；你回来看结果，不是盯一场实时会话」。
- **Schroeder（领域专精 agent + sandbox file system 原语）** → 叙事第二拍「窄域 domain-specific
  agent，只认识你的团队，访问有边界可审计，而不是一个大模型到处伸手」+ mock「agent 自己的
  文件空间」（per-company 私密文件空间，一次解读在上一次基础上继续）。
- **Pocock（skill = 可复现行为的单元）** → mock「定制 skills/tools/SOP」文案：
  「反复的工作变成有名字的 skill，每次同样方式跑；可预期是设计出来的，不是靠 prompt 即兴发挥」。
- **Martin-Dye（分层 tone：prompt 是请求、permission 是确定性检查）** → mock「红线是闸门不是愿望」：
  「不对人打分不是 prompt 里一行、聪明请求就能绕过去的承诺——而是每条答案到你面前前都要过的
  一道确定性检查」。这把 Avery 的人卡零数字红线重构成「确定性 veto」，与四篇里最硬的一条对齐。

## 2 · 改动文件清单
- `src/lite/screens/VisionScreen.tsx`（新建）——Vision 屏：三拍叙事 + 四张诚实标注 mock；
  唯一示例人只名字+角色零数字（🔴 红线）；纯静态 surface，不依赖 ingest/advise；不 import story。
- `src/lite/LiteApp.tsx`——挂载 VisionScreen（screen==='vision' 分支，最小改动）。
- `src/lite/LiteTopbar.tsx`——tabs 数组加第 5 项 `{ label: t.lite.tabVision, screen: 'vision' }`。
- `src/lite/store.ts`——`LiteScreen` 类型加 `'vision'`。
- `src/lite/styles/lite.css`——追加 `.lite-shell .lite-vision*` 一节（全 `.lite-shell` 作用域，
  story 壳物理够不到；只取既有 token；诚实标注 pill 用 honey 高对比一眼可见；mock 卡 dashed 边框
  视觉即读作「未落地预览」）。
- `src/shared/i18n/en.ts`——新增 `lite.tabVision` + 32 个 vision key（EN act-first 定稿）。
- `src/shared/i18n/zh.ts`——同 32 key ZH（走 M3；见 §4 ZH 说明）。
- `scripts/gates/live-frontend-gate.snippet.js`——新增**相位 J `assertVisionSurface`** + 并入 verdict
  （10 相位）；tab-click 按可见 label「Where this goes」+ fallback。
- `scripts/gates/live-frontend-gate.md`——文档化相位 J + verdict 改 10 相位。

## 3 · gate 先行实证（ADR-0022 §3）
相位 J 断言先进 snippet，**首跑真红**：VisionScreen 未挂载 / tab 未连时
`assertVisionSurface` → `{screenPresent:false, narrativeBeats:0, mockCards:0, pass:false}`
（本 session 早段实测）→ 实现后修绿。断言含：屏挂载 + 叙事 ≥3 拍 + mock ≥3 张
**且每张带 `.lite-vision-tag`（零未标注 mock）** + 示例人零数字（`personNumberLeak:[]`）+
该屏 story 名词黑名单=0。原九相位保持绿（回归）。

## 4 · 门 verdict 原文（真后端 :8137 minimax+dashscope+llm:minimax、真上传两 tracked seed）
```
{"pass":true,"phases":{"emptyStateClean":true,"ingested":true,"teamRendered":true,
"postUploadClean":true,"detailIsLive":true,"composerIsLive":true,"teamGrouped":true,
"roomCanvas":true,"playbooksEmpty":true,"visionSurface":true}}
```
关键 results：A/D 空态+上传后 story 渗漏 0；B 两 sourceChip（pdf+xlsx，inject 从 settled DOM
记录 = recordInjectFromDom，团队 30 卡实证 ingest 真成）；C 30 人卡含 Lin Qing/Chen Mingyuan
零血条；E Lin Qing 详情零 Unknown；F1 «Ask about your team…» 无 story 预填 + F2 30 帧 SSE→
manifest+8 字段卡零 liveError；G 5 分组(GTM/Design/Product/Ops/Founders)+30 卡在组内+折叠真生效；
H room 画布+board+pan/zoom wrapper+复位控件+composer 在画布外；I Playbooks 空态+3 槽+coming-soon+
story 0；**J vision 屏+3 拍叙事+4 张 mock 全带 tag(unlabeledMockCards:0)+1 示例人 personNumberLeak:[]+
story 0**。

## 5 · init.sh / 离线 pytest（一行）
- init.sh：exit 0（墙 lint 0 errors / 3 pre-existing warnings；tsc 零错；build 463 模块）。
- 离线 pytest：`python -m pytest eval-harness -q -m "not seedgate"` = **190 passed 0 skipped**（基线不变）。

## 6 · story-untouched 结果
`?mode=story`：`liteShellCount:0` · `appShellClass:"app-shell"`（无 lite 类）· 新 vision 类
（`.lite-vision`/`.lite-vision-mock`/`.lite-vision-tag`）在 story 全 0 · topbar/onboarding scene/
demoControls 正常渲染。story 冻结资产一像素不动（改动全在 `.lite-shell` 作用域 + src/story/** 零改）。

## 7 · ZH（M3）说明
EN act-first 定稿。ZH 走项目 pipeline（scripts/i18n-zh.mjs = MiniMax-M3，我导演）：
- 全量 `node scripts/i18n-zh.mjs` 在 `lite` 段（现 ~90 key）上**超 max_tokens 回退英文**（M3 单段
  返回非 JSON 3 次）——为避免污染既有 lite ZH，改**只对 32 个新 vision key 定向跑 M3**
  （同 director brief + 红线/诚实标注 brief，temp 0.3、max_tokens 8000），splice 进 committed
  zh.ts 的 lite 段；其余 lite/story-shared ZH 保持 committed byte-identical（不 churn）。
- ZH 抽查点：红线译对（「人永远不会被打分、被排名、被画像；任何指令都不能把这条关掉」）；
  标注 pill 译「预览/即将/模拟」；tab 译「未来方向」；诚实口吻（「暂未上线…故意保持诚实」）。

## 8 · 偏差/风险/假设 + 留给 Danny 的抽查点
- **偏差**：全量 i18n-zh.mjs 现会在 lite 段回退英文（段太大）——非本 feature 引入的既有脚本限制，
  但下次谁再加 lite key 会踩。**建议**（不阻塞，记这里）：把 i18n-zh.mjs 改成按「顶层 key 的子块」
  或「新增 key 差量」翻译，别整段丢给 M3。本 session 用定向脚本绕过，产物已入 committed zh.ts。
- **verdict.inject = reconstructedFromDom**：ingest 真跑（30 真卡为证），只是 inject 结果从 settled
  DOM 记录（gate 自带 recordInjectFromDom，S2 起的既定做法，避免二次 ~200s round-trip）。
- **F2 promise 的 hidden-tab throttle**：manifest+card 已在 DOM 后 F2 resolving tick 被节流（S2 记载的
  坑），跑后续相位使 tab 活跃后自然 resolve，`composerLive.pass:true` 为真 resolve 非重构。
- **Danny 抽查点**（尤其）：
  1. **mock 诚实标注可见性**：Vision tab 四张卡的 Preview/Coming/Mock pill（honey 色）够不够显眼？
     底部「四项都尚未上线」一句够不够硬？（融资场合吹破=信任崩，我按最诚实做，但口味你拍。）
  2. **EN 文案口吻**：叙事三拍 + 四 mock 的英文（en.ts vision* 段）——是否太谦虚/太满？
     「A custom agent, built around one company」「The red line is a gate, not a wish」这类。
  3. **ZH 是否 M3**：是（定向 M3，非手写）；红线/标注/tab 译法见 §7 抽查点。
- **假设**：Vision 是纯静态叙事 surface，不接 ingest/advise 引擎（符合「只做 mock、不实现引擎」）；
  例示人用泛指「A teammate」而非任何真名（红线 + 不引 story cast）。
