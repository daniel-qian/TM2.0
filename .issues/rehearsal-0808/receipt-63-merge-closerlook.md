# 回执 · #63 merge-closerlook：「值得注意」并进「今天」，退 tab（9→8）

> 票面正源：`gh issue view 63`。浅合拍板（0808 演习，Danny）：只搬界面、退 tab；
> gapDerive 前端推导与「今天要决策的」跨资料交叉对比**一字未动**（深合另议）。
> 本票推翻 feat-057「7 分屏全保留」旧拍板之 **closerlook 一屏**（其余六屏保护不变），
> 拍板记录以 issue #63 为正源。

## 交付面（改了什么）

1. **搬界面**：`CloserLookScreen.tsx` 删除；对照卡整套（claim/evidence 双栏、负责人、
   厘清/先放一放/直接问本人/加到待办四动作、实时预告、历史折叠+放回来）迁入
   `HomeScreen.tsx` ② 差距摘要块的**展开态**。默认仍是棒D 的摘要形态（三态 chips +
   前三条预览，逐字节不变）；头部链接从「值得注意 →」换成「全部展开/收起」原地开合
   （`.lite-home-gap-expand`，aria-expanded）。`.lite-gap-*` 类名逐字保留——它们是
   B/C 组门的选择器合同。
   - 顺手还债：原屏 addFollowup 写死英文模板 `Take a closer look at …`（记档过的债），
     入字典 `gapFollowupTitle`（zh「多看一眼{title}」）。
   - 新 CSS 一条：`.lite-home-gaps .lite-gap-compare { grid-template-columns: 1fr }`——
     右轨窄柱里双栏会挤成两根细条，改纵向堆叠（与摘要行纵排语法一致）；
     `.lite-closerlook-*` 屏骨架样式（scroll/frame/header/lede + 让位/滚动清单成员 +
     aurora 标题加粗选择器）随屏删除。
2. **退 tab**：`LiteTopbar.tsx` tabs 数组删 closerlook 行；**同一 commit** 同步
   `scripts/gates/live-frontend-gate.snippet.js` `assertV2Boots` 期望数组（9→8，
   expectedSubs 同步）。碑文注释更新：feat-057 裁定改述为「分屏默认不退休；closerlook
   由 #63 逐屏推翻」。
3. **通知落点**：`notifyStore.ts` `NOTIF_TARGET['gap']`: closerlook → home。
4. **路由**：`routes.ts` LiteScreen 联合类型删 'closerlook'（写回去是编译错误）、
   SCREEN_PATH 删行；新增 `CLOSER_LOOK_LEGACY_PATH='/closer-look'`，`Lite2App.tsx`
   挂**显式**重定向路由到默认屏（home）——`*` 兜底也能接住，但这条是合同不是巧合。
   冷深链实测：`/closer-look?v=2&mode=live&lang=zh&look=paper` → `/home`，粘性 query
   一个不丢。
5. **i18n**（en/zh 同批，974 叶子键 / 孤儿 0）：
   - 退休：`tabCloserLook`、`gapPageEyebrow/Title/Body`（页头随屏死）、`homeGapsLink`。
   - 新增：`homeGapsExpand`（全部展开/Show all）、`homeGapsCollapse`（收起/Collapse）、
     `gapFollowupTitle`。
   - 改词（指路文案不许指向不存在的 tab）：`handoffsEmptyButLook`（「都收在『值得注意』里」
     →「就在本页『资料对不上的地方』里」）、`homeTodayEmpty`、`followupsSourceCloserLook`
     （「来自值得注意」→「来自一处资料对不上」；source id 'closer-look' 不动，旧落盘条目
     终身带着它）、`gapEmptyAria`。

## 门的改判（A 区逐条排查）

引用 closerlook scene 的判据全量 grep（`closerlook|closer-look|Worth noting`）逐条处置：

| 门/文件 | 处置 |
| --- | --- |
| snippet `assertV2Boots` | 期望数组 9→8（与 tabs 数组同 commit，票面碑） |
| snippet `assertGapsDerive/Resolve/ToAsk` | 导航从 `_clickTab('Worth noting')` 改走新助手 `_openHomeGaps()`（进「今天」+ 点开展开，幂等）；扫描域从 `.lite-closerlook` 改 `.lite-home-gaps`；判据本体一字不改 |
| snippet `assertBellIsReal` 步 4 | `data-scene==='closerlook'` → `'home'` 且 `.lite-home-gaps` 在场 |
| snippet 新增 `assertGapNotifRoute` | #63 新判据：点铃铛里**真实的** gap 通知条目 → 落 `data-scene='home'` 且差距块在场；先离开 home（去 team）再点，杜绝「本来就在 home」的空跑绿 |
| `verify-flow-gap-phases.mjs` | 追加第 9 判据 `gapNotifRoute`（rec 上报，判据在 snippet 侧） |
| **新门 `verify-v2boots.mjs` 入 ROSTER A 区** | v2Boots 相位此前**零机械 runner**——「tabs 数组与门期望不同步」在电池里没人会红，碑文无牙。适配器模式（照 skin-phases），离线 |
| `verify-aria-zh` / `contrast-smalltext` / `button-family` / `topbar-clearance` / `zh-purity` | V2_SCREENS 采样名单删 'closerlook'（那一屏不存在了；goScreen 会静默兜底回 home =同屏采两遍还叫错名字） |
| `visual.spec.mjs` | SCREENS 删 'closerlook'：40 张 → 36 张（9 屏×2 皮×2 视口）；旧 `*-closerlook-*.png` 基线随主检出重冻删除 |
| `sweep-ui-defects` / `sweep-r2-driver` / `capture-align-board` | 非 ROSTER 工具同步出列（防下次扫描把 home 采两遍） |
| `verify-switchers` | 排查结论：**不用改**——它只读第一个 `.scene-tab`（'今天'），closerlook 不在其判据射程内 |
| `.issues/v02-partner-align-0718/verify-fixA-live.mjs` | 死件（run-battery 头注明列），照死件纪律**不碰不跑** |

## 账实（门与验证）

- `./init.sh`（typecheck + build）：绿。
- i18n：`i18n-orphans.mjs` → 974 叶子键 / **孤儿 0**（976 −5 退休 +3 新增 = 974，账合）。
- 前端电池（worktree 隔离环境：mock 后端 8137 + preview 5173 + dist 带 api base 重打）：
  - **A 区 29/29 绿**（29 = 原 28 + 新门 v2boots）。⚠ form-builder 首轮红是**门环境错不是回归**：
    我把 `AVERY_PUBLIC_BASE` 指到了前端 5173，而员工 H5 `/f/{token}` 由**后端 form_api 直接
    服务**、必须指后端自己的口（8137；rehearsal-api.ps1 里的 8250 也是它自己的 API 口）——
    链接被 preview 的 SPA fallback 接走落进 story 壳，门在 story onboarding 上等 textarea
    超时。改对后单跑 **43/43**。这条坑已入 progress.md 门环境清单。
  - **B 区**：data-boundary **37/37** + null-owner **15/15**；visual-baseline 留主检出重冻
    （worktree 里重冻＝没重冻，`__snapshots__` 是每 worktree 一份的 gitignore 产物）。
  - **C 区 3/3**（auth-capability 34.2s / auth-form 43.0s / bundle-privacy 4.4s）。
- 变异测试 **4/4 killed**（每条：改源 → 重打 dist（带 api base）→ 跑门见红 → 还原；
  终态两门复绿 3/3 + 9/9）：
  | # | 变异 | 门 | 结果 |
  | --- | --- | --- | --- |
  | M1 | LiteTopbar 删 notes tab 行、不动门期望（票面点名的「tab 数组与门期望不同步」） | verify-v2boots | 2 红（主名序列 + 副小字序列） |
  | M2 | `NOTIF_TARGET['gap']` 接错线指 'files'（票面点名的「通知落点接错线」） | flow-gap-phases·gapNotifRoute | 1 红，诊断值直接给出落错点 `dataScene:"files"` |
  | M3 | LiteBell 点击删掉 goScreen（接线整个失灵） | flow-gap-phases·gapNotifRoute | 1 红 `dataScene:"team"`——「先离开 home 再点」的设计就是为逮这种空跑 |
  | M4 | 展开按钮 onClick 接空（新入口本体死掉） | flow-gap-phases·gaps 三相位 | 3 红（gapCards=0）——门驱动的是真按钮不是 store，T10 那课的正面验证 |
- 人眼/行为（worktree 内 mock 后端 + demo 示例团队实测）：摘要态 4 处待看 + chips +
  前三条预览；展开态 4 张对照卡四动作齐全 + 实时预告；厘清 → 历史「已厘清」徽章 +
  localStorage `gapMarks` 落盘 + 放回来复原；/closer-look 深链重定向；8 tab 无「值得注意」。

## 拍板与取舍（本票内的自由裁量）

- **展开态形态**：默认摘要（零漂移）+ 头部原地开合，展开时隐藏 chips/预览、显示完整
  对照卡视图。chips 的三态筛选留在摘要态；解决/忽略的**归宿与恢复**在展开态历史折叠里
  ——两套入口不并存于同一视图，避免同一状态两处两个控制器。
- **门的银弹位**：gap 通知接线判据落在 flow-gap-phases（它本来就造 gap 语料、通知已在
  铃铛里），不落 bellIsReal（无机械 runner 的手册协议——顺手把它的判据也改对了，但
  合同牙口在 flow-gap-phases）。
- **v2boots 独立成门**而不是塞进别的门：它离线、3 秒跑完，且「tab 数组动了」正是本票
  这类手术最容易漏的一步——值得一个永远在电池里的独立红灯。

## 已知边界

- 展开态是**组件本地态**：切屏回来回到收起（与原 tab 时代「换屏重挂」等价，不是丢功能）。
- `FollowupSource` 联合类型仍含 `'closer-look'`——旧落盘条目终身带着它，标签走字典改词，
  id 永不迁移。
- bellIsReal / nudgeVerdict 等手册协议相位仍无机械 runner（历史遗留，本票只机械化了
  v2Boots + gapNotifRoute 两个缺口，没有全量补）。
