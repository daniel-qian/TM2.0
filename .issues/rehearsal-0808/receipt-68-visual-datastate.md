# 回执 · #68 数据态像素基线（visual-empty-state-blindspot）

- **票**：#68（缘起 #65 实收：36 张像素基线全是空态采样，数据态部件零像素覆盖）
- **分支**：`claude/t68-visual-datastate`（brave-matsumoto worktree 复用，off `ff02879`）→
  合 main `676842f`（主体）+ `0f8918a`（时钟钉补丁）。两次合并均串行核对过 main 没被别人动。
- **拍板**：按票面倾向走**方案 B 最小版**（home/team/projects），升 A（全九屏数据态）或
  降 C（维持现状）都没动——要改口径归 Danny。
- **日期**：2026-08-08

## 交付面

- **`eval-harness/visual/visual-data.spec.mjs`（新，独立 test 文件）**：真上传
  demo-seed 九份中文 md（按文件名排序，readdir 顺序不进画面）+ flow-gap-phases 同款手写种子
  → `.upload-ready` → 采 home/team/projects。**3 屏 × 2 皮 × 2 视口 + 2 张手机差距块专拍 =
  14 张**。home 截图前 waitFor `.lite-gap-card` 自证（语料矛盾没抽出来就红，绝不落
  「数据态但没对照卡」的假基线）；上传失败显式红（`.upload-error` toHaveCount(0)）。
- **旧 `visual.spec.mjs` 头注释订正**：「?transport=stub 固定 16 人团队」从来没存在过——
  36 张实为空态采样，订正为事实并指向新 spec。stub 参数**保留**：摘掉会变 URL 指纹、
  空态基线全作废，纯损无益。
- **run-battery.mjs** visual-baseline note 改「两套基线」口径（36 空态 + 14 数据态）。
- 产品代码**零改动**（born-red 的 CSS 变异已净还原，`git diff` 空）。

## 语料账

demo-seed 落进来是 16 人 / 8 项目 / 10 文件 / 决策 8 条（2 高风险 + 6 需确认）/
**差距 5 处待看**——demo 语料自己就产 4 条中文对照卡（草坪婚宴旺季档等），我的英文种子
（pr_portal）保底第 5 条。数据密度远超预期，home 右轨/决策列/team 分组 chips/projects
三卡带进度条全被采进画面。

## born-red 账（两轮，第一轮逼出真盲点）

- **第一轮**（12 张时）：对照卡样式变异（padding + 红虚线边框）→ **桌面 2 红、手机 2 绿**。
  手机绿不是门好——是**手机视口截图只拍首屏，差距块在折叠线下**（滚动在 `.scene` 内部容器，
  fullPage 无效——#65 拍交互态时就撞过这堵墙）。旗舰卡在手机上零覆盖 = 复刻原罪。
- **修法**：手机加一张 `scrollIntoView('.lite-home-gaps')` 专拍（`*-home-gaps-data-mobile`），
  拍完滚回顶不污染后续屏。桌面不加（右轨首屏在画面内，已实证能红）。
- **第二轮**（14 张）：同一变异 → **4/4 全红**（桌面 home ×2 皮 + 手机专拍 ×2 皮）；
  **同一变异下旧 36 张全绿**——空态盲区的存在与新覆盖的有效，一组实验双证。
  撤变异复绿，CSS 净还原。

## 时钟炸弹（首冻当天人眼过 projects 屏时发现，已拆）

决策定级/项目卡文案（「14 天内到期、但自报进度不足 60%」）是拿**墙上时钟 vs 文档到期日**
（2026-08-15 / 2026-11-30…）算的——真实日期追过语料日期后定级翻牌、布局变，基线**无声腐烂**
（Docker PG 时钟跳那条碑的同族：别赌墙上时钟）。修法：spec 里
`page.clock.setFixedTime('2026-08-08T12:00'+08:00)`——只冻 `Date`、计时器照跑（上传轮询/
settle 不受影响；playwright 1.61 的 setFixedTime 语义）。钉完对已冻基线复跑绿=兼容实证。
空态 spec **不钉**：36 张不含数据日期，钉了反而要作废重冻。

## 验证账

- **稳定性**：worktree 与主检出各连跑两遍逐张比对全绿——每一跑都是**全新上传的 context**，
  跨 context 像素级确定（heuristic 抽取 + 固定语料 + 时钟钉）。
- **主检出首冻**：旧 36 张对既有基线**全绿零漂移**（我的 diff 是注释/门侧，够不着像素）→
  新 14 张首写＝首冻 → 复跑 ×2 绿 → **人眼逐张过 14/14**（两皮两视口零溢出零裁剪零折行破碎），
  对照板副本存 `t68-shots/`（基线本体是 gitignore 单机产物，副本让证据随 git 走）。
- **电池口径**：本票产品代码零改动、diff 全在 visual 门侧；全电池 A30/B/C3 在同基线
  （`ff02879`，#66/#67 后合复验）刚全绿过，A/C 区结构上够不着本 diff——只复跑了 B 区
  visual（新旧两 spec 8/8）+ `./init.sh` 绿（0 errors，6 警告为存量）。
- **cwd 陷阱实录**：一次 add/commit 因 `cd /d/avery` 残留打到主检出（commit 空转失败，
  无事故）——「绝对路径绕过 worktree」那条碑的活样本，此后 git 操作一律 `-C` 显式指树。

## 已知边界（记录不扩权）

- 数据态只覆盖 home/team/projects 三屏（方案 B）；room/followups/notes/playbooks/vision/files
  的数据态仍靠 DOM 判据 + 各票交互态截图。升方案 A 归 Danny。
- 手机 home 首屏拍不到差距块是**视口截图的结构事实**（专拍补位）；若未来首屏信息架构变了
  （差距块上移），专拍与首屏两张会重叠——届时裁掉一张即可。
- 基线仍是单机产物：换机/换 OS 全量重采（config 头注释既有口径）。
- `?transport=stub` 在旧 spec URL 里保留（死参数，指纹考量）——新 spec **没有**这个参数，
  新老两 spec 的 URL 语义都如实。
