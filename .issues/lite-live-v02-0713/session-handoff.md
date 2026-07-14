# session-handoff · feat-046（v02 aurora 皮精修，阶段 C）

> 写于 2026-07-14。分支 `feat/046-v02-aurora-skin`（从 `integrate/v02-main-sync`@feff6be 起，
> = v02 四棒 + 新 main〔持久化+Ask 阶段C〕合流后的全绿基线）。主 checkout 承接。
> **未 merge main、未 push**。下一棒交给 main 编排做对抗验证，clean 后推进 feat-047
> （引擎同步 + 笔记/文件面，已因 main 合流解除阻塞）。
>
> 本文件覆盖 feat-045 的同名文件——历史棒细节在各自 commit 与 progress.md 对应 Update 节。

## 分支与提交

```
feat/046-v02-aurora-skin（从 integrate/v02-main-sync@feff6be 起）
  05a6fbb docs(v02): 门先行 — E 组 skinVerdict 3 相位 + PAPER_BASELINE 真机基线快照 + 出生即红实证
  754478a feat(v02): aurora 皮精修 — 令牌层对齐参考库 + lite2.css 全量令牌化 + 9 条 [data-skin] 分支
  a4c67d4 fix(v02): 向导 backdrop 消费皮肤令牌（遗留修复②）
  651451e fix(v02): DetailOverlay 补 Escape 关闭（遗留修复①）
  <本文件所在> docs(v02): feat-046 done — evidence + progress + handoff
```

## 实现清单（对照 kickoff-dev.md §feat-046 / 任务书）

| 项 | 落地 |
|---|---|
| aurora 令牌精修 | `skin-aurora.css` 对齐参考库 `src/app/globals.css` 精确值：bg #edf6ff、ink #10223d/soft #263850/faint(muted) #667085、极光四层渐变（violet/cyan radial + 135deg #eee9ff→#e4faff→#f5fbff）+ `background-attachment:fixed`、玻璃 rgba(255,255,255,.82)+`blur(20px) saturate(1.1)`、violet 阴影双档（soft=0 1px 2px rgba(16,34,61,.08)+0 12px 30px rgba(36,32,95,.10)；强=0 20px 64px rgba(36,32,95,.16)）、密度 15px 基准+`tabular-nums`、壳内覆盖 `--radius:10px`。**粗版 bug 一并修**：honey/terracotta 误留 paper 旧值 → orange #d88a2d / red #d95757。 |
| 徽章 tone 令牌 | 12 个 `--lite2-tone-*`（blue/purple/green/orange/red/gold/gray 的 soft-bg+fg 对），值逐一抄参考库 `badge.tsx` toneMap（只抄 CSS 值，零 TSX 进仓）。 |
| lite2.css 令牌化 | 71 处硬编码色字面量→令牌消费（rgba 10 族：surface/paper/ink/accent/accent-deep/danger/danger-deep/warn/violet/sky + Georgia×11→`--lite2-heading-font` + hex×2 + var() fallback 拆除）。paper 侧镜像令牌逐位同原值（`skin-paper.css`，含显式 `font-size:16px` 锚），计算值零漂移由 E 组门盯。 |
| shared 冻结 chunk 覆盖 | lite2.css 尾部新增覆盖节：shared/styles 里 lite2 可达的硬编码面（person/project 卡、home-check、drawer-toggle、composer 家族、brief bar/card、report/mismatch 卡、serif 标题 10 选择器等）在 `.lite2-shell` 作用域按原 alpha 重申并消费令牌（原值行尾注释留档；lite2.css 在 import 串最后，cascade 胜出）。 |
| `[data-skin=aurora]` 分支 | **9 条，逐条注释在 skin-aurora.css**（清单见下节）。 |
| 遗留修复①② | DetailOverlay Escape（OnboardWizard 监听器模式照抄，`closeDetail()` 无进度语义）；向导 backdrop rgba(30,27,22,.35)→`rgba(var(--lite2-ink-rgb),.35)`。各自独立小 commit。 |
| 遗留修复③ | **部分收敛**：gap 历史 toggle 纯 CSS 对齐 `.home-drawer-toggle` 药丸语法（同为"收纳已处理条目的抽屉"语义；零类名/DOM 改动，B/C 门选择器合同不破）。Follow-ups History 是 subtab（导航语义非抽屉）不强行归并；完整"统一为一套 class"需改三屏 DOM+重写 B/C 门断言合同 → 判定失控，记遗留。 |

## [data-skin="aurora"] 分支清单（9 条）

1. 玻璃 chrome 扩面：scene-tabs/mode-switch/composer-card/nexus-empty/合规页脚/铃铛 toggle/room chips → `--lite2-glass` + `blur(20px) saturate(1.1)`
2. 晨间分诊卡：语气左边条（::before）隐去 → `.home-handoff-tone` 软底徽章（blue/orange/red 族）
3. gap 对照卡：claim/evidence 左边条隐去 → pane 标签徽章（claim=蓝 / evidence=红）
4. gap 历史徽章：resolved=绿软底 / dismissed=灰软底
5. Playbooks 槽位标签：灰 chip → 蓝软底徽章（E 组门探针元素）
6. Vision Coming/Preview 标：honey 描边 → 橙软底徽章
7. Ask 状态 chip：sage 半透明 → 蓝软底徽章
8. Follow-ups 来源标签：素色大写小字 → 紫软底徽章
9. serif 显示标题（15 选择器）→ sans 700（字体族本身走两皮共用令牌，字重差异走此分支）

## 门证据（E 组 skinVerdict，先红后绿，真机）

**先红（粗版令牌，commit 05a6fbb 之前真跑）**：
```json
{"auroraApplied":{"pass":false,"checks":{"skinAttrIsAurora":true,"bgHasAuroraVioletStop":false,"bgHasAuroraCyanStop":false,"tabsGlassIsWhiteTinted":true,"tabsBlurIsStrong":false,"tabsShadowIsViolet":false,"activeTabIsNavy":true,"footerGlassIsWhiteTinted":true,"densityIsCompact":false,"radiusIsBumped":false,"playbookTagIsBlueBadgeBg":false,"playbookTagIsBlueBadgeFg":false}}}
```
（paperUnchanged/skinNoLeak 在未动基线上即绿——它们是"零漂移合同"，红的只应是精修目标。）

**修绿后（终态复跑）**：
```json
{"pass":true,"phases":{"auroraApplied":true,"paperUnchanged":true,"skinNoLeak":true}}
```
- auroraApplied 12/12（探针值：bg 含 168,139,255 与 51,199,232 双 stop、tabs=rgba(255,255,255,.82)+blur(20px) saturate(1.1)、阴影含 36,32,95、主 tab rgb(16,34,61)、壳 15px、upload-panel 10px、槽位标签 rgb(238,242,255)/rgb(47,75,176)）
- paperUnchanged：11 字段 `diffs:{}`（基线快照 = 实现前 integrate@feff6be 真机采集，PAPER_BASELINE 常量固化在 snippet）
- skinNoLeak：默认 URL 与 story 双探针 `.lite2-shell`=0 且 `.scene-tabs` bg = rgba(255,253,248,0.78)（00-base 原值）

**paper 深度抽查（基线 11 字段之外）**：person/project 卡底 .82、home-check .9、handoff=paper-strong、greeting Georgia 500、honey tone rgba(146,100,33,.9)、左边条 display:block rgba(178,123,43,.7)、triage-room #4a4197、metric chip .9、gap 历史徽章 sage 原值等 14 项逐一与原字面量一致。

## 零回归证据（同分支终态全量复跑）

```json
{
  "v01_verdict_11phase": {"pass":true,"phases":{"emptyStateClean":true,"ingested":true,"teamRendered":true,"postUploadClean":true,"detailIsLive":true,"composerIsLive":true,"teamGrouped":true,"roomCanvas":true,"playbooksEmpty":true,"visionSurface":true,"notesSurface":true}},
  "askVerdict_9phase": {"pass":true,"phases":{"askDraft":true,"askShare":true,"askOfflineNote":true,"askCollect":true,"askReceiptsMulti":true,"askSingle":true,"askRedline":true,"askStatusGuards":true,"askCoerceStrict":true}},
  "v2Verdict_A": {"v2Boots":true,"skinTokens":true,"v1Untouched":true,"storyUntouched":true,"wallRed":true},
  "flowVerdict_B": {"triageRenders":true,"triageActions":true,"followupsFlow":true,"followupsPersist":true},
  "gapVerdict_C": {"gapsDerive":true,"gapsResolve":true,"gapsToAsk":true},
  "nudgeVerdict_D": {"pass":true,"phases":{"onboardPersist":true,"onboardEscape":true,"onboardSkip":true,"chipsAsk":true,"bellIsReal":true}},
  "skinVerdict_E": {"pass":true,"phases":{"auroraApplied":true,"paperUnchanged":true,"skinNoLeak":true}}
}
```

- v01 11 相位按 **main 合流后的新门定义**跑（含 notesSurface）；askVerdict 9 相位同理（K1-K6 + 阶段 C 的 askOfflineNote/askStatusGuards/askCoerceStrict），`?transport=stub` 驱动（任务书口径）。
- wallRed：抽查 lite2→story 方向（skin.ts 临时注入 `import '../story/data/cases'` → lint exit 1 报墙规则原文 → 撤回 → exit 0）；未逐一复跑 4 方向，因 `eslint.config.js` 本棒零改动（`git diff integrate/v02-main-sync -- eslint.config.js` 空输出，同 044/045 口径）。
- D 组走完整六页协议（walkthrough 真上传→persist 精确集合→escape pause→skip→chipsAsk 真 SSE→bellIsReal 事件精确多重集 [gap,ingest]→[gap,ingest,run] + gap 通知路由 + mark-all）。
- 冻结未破：`git diff integrate/v02-main-sync -- src/lite/ src/story/ eval-harness/` 空输出。
- **红线不随皮肤松动**：aurora 下人卡 16 张 `personDigitLeak:null` + `bloodBar:false`（BLOOD_BAR_RE + digit 全文扫描）。

## 截图包（降级说明，如实）

Browser pane 截图工具连续超时（30s×2，S4 已知环境问题）→ 按任务书降级路径存
`.issues/lite-live-v02-0713/review-shots/`（**已 .gitignore，不 commit**）：
- `paper-all-screens.json` / `aurora-all-screens.json`：每皮 10 个表面（向导两步 + 6 tab +
  DetailOverlay + 铃铛弹层）的关键计算值清单（getComputedStyle 真读）
- `README.txt`：对照读法（壳底/卡面/玻璃/阴影/标题/密度/徽章/主按钮/红线 九组差异）

## i18n 自查（收口纪律）

本棒**零新 key**：`git diff integrate/v02-main-sync -- src/shared/i18n/` 空输出。零 M3 调用。

## init.sh

```
npm run lint       — 0 errors, 5 warnings（与 integrate 基线逐条相同）
npm run typecheck  — clean
npm run build      — 502 模块（与 integrate 基线持平：纯 CSS + 1 个 useEffect，零新模块）
```

## 偏离任务书之处（已记录，非阻塞）

1. **auroraApplied 断言形状**：任务书写"≥8 个关键计算值断言……且与 paper 值逐项不同"，实作为
   12 项**正断言**（断 aurora 目标值本身而非"与 paper 不同"）——正断言更强：回归到任何错误值
   都红，而"不同"允许错得五花八门。paper 侧的"逐项一致"由 paperUnchanged 独立承担。
2. **遗留修复③走部分收敛**：任务书允许"失控则记遗留不硬做"——完整"统一为一套 class"需改
   三屏 DOM + 重写 B/C 组门选择器合同（.home-drawer*/.lite-followups-subtab/.lite-gap-history*
   都是门断言的稳定选择器），判定失控；CSS 层把 gap 历史 toggle 对齐 drawer 药丸已消掉最刺眼
   的不一致（同语义抽屉两副面孔），Follow-ups History 是 subtab 导航语义、不算同族。
3. **DetailOverlay Escape 未立独立门相位**：任务书只列 E 组 3 相位；行为证据以驱动侧真按
   Escape 两皮各一次（evidence pack `closedOnEscape:true`）+ 独立 commit 落档。若对抗验证
   认为应正式化为相位（照 onboardEscape 先例），加一个 `detailEscape` 断言成本很低。

## 驱动侧新坑（下一棒必读）

1. **切 tab 后必须 poll `.upload-input` 再注文件**：followupsPersist 相位停在 Follow-ups 屏，
   紧接着 `_clickTab('Your team')` 后立即注文件会赶在 React 提交前拿到 null → ingest 静默
   未发生 → 后续依赖团队数据的相位全红（本棒 B/C 复跑首轮踩中，补 poll 后全绿）。
2. **askVerdict 链式驱动会在 assertAskShare 后偶发挂起**（stub share 轮询与页面态竞态，
   原因未深究）：改逐相位手动推进（confirm 后 poll status=shared 再跑 askOfflineNote →
   askStatusGuards → askCoerceStrict）稳定通过。tracked snippet 零改动。
3. **dev server 会静默死掉**（本会话真发生一次，curl 连接拒绝）：门跑一半页面进
   chrome-error:// 时先 `preview_start` 重启再继续，evidence 不受影响。

## 遗留 / 给 feat-047 的提示

- **三套折叠完整统一**（类名级）仍是遗留：若未来某棒真要做，需同步改写 B/C 组门断言选择器
  ——建议与"晨间问候位"（feat-045 遗留的更广问候消费点，动 TeamScreen 结构）凑成一个
  允许动 DOM 的棒一起做，别塞进纯视觉棒。
- `playbooksSlotIncident`「会议室」词族问题（feat-045 上报）仍属域外未动，编排定夺。
- feat-047（引擎同步 + 笔记/文件面）已因 main 合流解除阻塞，从本分支 tip 起跑即可；
  笔记面（NotesScreen）移植进 lite2 时注意本棒的令牌纪律——新 CSS 一律消费
  `--lite2-*`/皮肤令牌，别再写死暖纸字面量（否则 aurora 下发暖，还得返工）。
- aurora 皮的 tone 徽章令牌（`--lite2-tone-*` 12 个）只在 aurora 块声明——若 feat-047 想在
  paper 下也用彩徽章语法，需给 paper 块补一套对应值（当前 paper 无此需求，故未声明）。
