# 回执 · #65 今天页差距块默认展开（保留收起钮）

- **票**：#65 `home-gaps-default-open`（0808 演习第 2 轮，Danny 拍板：进今天页直接见完整对照卡）
- **分支**：`claude/brave-matsumoto-3c1e48`（worktree）→ 合 main `3910bcb`（merge --no-ff，主检出串行合入；
  合前 main 停在 `2c8f371` = 分支基点，#66/#67 尚未合——**复跑电池的义务在后合的那个 session**）
- **日期**：2026-08-08

## 交付面

- [HomeScreen.tsx](../../src/lite2/screens/HomeScreen.tsx) `gapsOpen` 初值 `false→true`，一行。
  组件本地态**刻意不落盘**：切屏回来=回到默认=回到展开，这是票面点名要的语义，不是漏了持久化
  （注释里已立碑，防后人「补」持久化）。
- 摘要形态（三态 chips + 前三条预览）没删，成为「收起」后的形态；#63「两套入口不并存于同一视图」
  拍板维持——新判据把「摘要 chips 不在场」焊进了 pass 条件。
- i18n 键零动：`homeGapsExpand`/`homeGapsCollapse` 文案照旧，初始渲染走 collapse 分支的文案。

## 门账

### 新判据 gapsDefaultOpen（flow-gap-phases 第 10 判据，排 C 组头）

设计四要点（snippet `assertGapsDefaultOpen` 注释里都有碑）：

1. **先离开目的地再进**（gapNotifRoute 同款纪律）：被测的是 useState **初值**，只有 fresh mount
   才测得到；屏是互斥挂载，从 Team 进 Today 就是一次真重挂。
2. **零点击**：断言落在「到达即所见」——`.lite-gap-card >= 1` + 收起钮 `aria-expanded='true'`
   + `.lite-home-gap-filter`（摘要 chips）不在场，三叉齐判别。
3. **刻意不走 `_openHomeGaps()`**：那个助手发现收起会顺手点开——正好把「初值改回 collapsed」的
   变异修复掉。这是「验证器自己撒谎」清单里「助手好心修复掉被测行为」的活样本。
4. **排在其余 gap 相位之前**：此刻今天页还没被别的相位摸过，测的是初值不是残留。

### _openHomeGaps 幂等排查（票面点名）

默认展开后守卫点击（`aria-expanded !== 'true'` 才点）变 no-op，`gapsDerive`/`gapsResolve`/
`gapsToAsk` 全绿无假红。守卫保留：它还兜「同一 mount 里前面相位把块收起」的合法修复路径。

### 变异账（初值改回 collapsed 必须红——票面要求）

- 变异：`useState(true)→useState(false)` 重打 dist → **仅 gapsDefaultOpen 红**，红报文三叉齐全：
  `{"ariaExpanded":"false","gapCards":0,"summaryChipsAbsent":false}`——每一叉都在独立判别。
- 其余 9 判据靠 `_openHomeGaps` 修复点击照常绿：击杀落在**专门判据**上，不是附带伤害。
- 回滚复绿 10/10。绿→红→绿全周期实跑（worktree 隔离口 5253/8253）。

### 电池

- **worktree（= 合并后 main 同树，合并干净且 main 没动过）**：A 区 **30/30** · B 区
  data-boundary/null-owner 绿 · C 区 **3/3**（auth-form 的 `tabCount===8` 改判无恙）。
  标准口 5173/8137 独占跑。
- **主检出 main 树复测**：flow-gap-phases **10/10**（含新判据）。
- `./init.sh` 绿（0 errors；6 条 lint warning 是 RoomScreen/useRailCamera 的存量噪音，本票没碰）。

## 像素账（⚠ 票面预判被推翻，立碑）

**票面写「今天页必漂——合 main 后重冻」，实测零漂移，且这个零漂移是结构性的：**

- visual.spec 走 `?transport=stub`，而 **stub 在 build+preview 产物里是死的**（DEV 静态 false，
  仓里已有碑）——像素门的 home 屏实际是真 transport + fresh context = **空态引导页**
  （「资料对不上的地方」只是一张静态介绍卡）。`gapsTotal===0` 时组件走空态分支，
  **展开/收起分支根本不进渲染**，初值改动零像素差。
- 主检出对旧基线 **4/4（36 张）零漂移**；基线 mtime 未动（desktop 两张 08-08 10:40、mobile 两张
  08-05，均早于本票合入）。**重冻无必要、也没重冻**——空转 `--update-snapshots` 只会把 mtime
  换新制造「动过」的假象。
- worktree 电池里 visual 的那次红是**无基线首写**（fresh worktree、gitignored 单机产物，
  playwright 首跑 missing→写入并报败），复跑即绿——不作数，也不构成漂移证据。
- 🔴 **盲区开账（只记录不顺手修）**：差距块的**数据态**（更别说展开态对照卡）不在 36 张像素基线
  的射程内——「今天页」的像素覆盖只有空态。对照卡的视觉回归目前唯一的机械覆盖是 flow-gap-phases
  的 DOM 判据 + 人眼截图。要不要给像素门喂数据态（会牵动全部基线口径），单独开票裁。

## 人眼过（桌面/手机双视口看折行——票面要求）

像素门采不到数据态，人眼评审走交互态直拍（#64 t64-shots 同款）：真上传 flow-gap 种子语料
（与门同一段，pr_portal 矛盾 → 1 张对照卡）→ 进今天页零点击 → `t65-shots/` 四张：

| 张 | 结论 |
|---|---|
| zh-desktop | 右轨默认展开，「收起▴」在位，对照卡双栏/负责人/四动作齐，零溢出 |
| zh-mobile (375) | 双栏纵排，四动作两行流式，长英文行折行正常，零溢出零裁剪 |
| en-desktop | 同 zh-desktop，`Collapse ▴` 在位，四动作一行排下 |
| en-mobile (375) | 块题+`1 open` 徽章一行、`Collapse` 折到第二行——**既有 header 流式布局在窄视口的正常换行**（#65 没动 header，Expand 态同样会折），非溢出非裁剪 |

## 已知边界

- 收起后切屏再回来=回到展开（本地态重挂即重置）。这是拍板语义；真要「记住我收起了」是新需求，
  届时连判据一起换（gapsDefaultOpen 断的就是「到达即展开」）。
- 空态（`gapsTotal===0`）不受影响：空文案一行，无钮无卡，初值不参与。

## 顺手修的碑（都在门文件内，零行为改动）

- snippet 头注释 `gapVerdict` 处 stale 的「aggregate (3 phases)」——#63 加到 4 时就没跟上，
  现改为「数 gapVerdict 的 keys，别数这行注释」。
- run-battery.mjs 里 flow-gap-phases 的 note 写死判据数 → 改「以 runner 的 rec 调用为准」
  （该文件自家「别写死数字」纪律）。
