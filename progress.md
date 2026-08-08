# Session Progress Log

> 📢 本文件是**当前状态快照，整体重写不追加**。历史都在 git（`git log` + 各 `.issues/*/receipt*.md`），别在这儿堆编年史。
> 启动路径见 `AGENTS.md` Startup Workflow：读本文件 + `feature_list.json`，跑 `./init.sh` 确认绿，再开工。

**Last Updated:** 2026-08-08（**#68 落 main（`676842f` + 时钟钉 `0f8918a`）**——像素基线空态
盲区补上：数据态 14 张已在主检出首冻并人眼过；演习第 2 轮批 #65/#66/#67 此前已全落；
仍未 push、未上产）

## Current State

- **git**：`main`（`0f8918a`）= 差距战役八票 + gap2 三票 + 演习批三票 + 演习第 2 轮批三票
  （#65/#66+#67）+ **#68**（`.issues/rehearsal-0808/receipt-68-visual-datastate.md`）。
  `main...origin/main` ahead 40 上下（以 `git status -sb` 为准），**没有 push**（见 Blockers）。
- **像素基线现状（#68 后的新口径）**：**两套**——36 张空态（visual.spec，9屏×2皮×2视口）
  + **14 张数据态**（visual-data.spec，#68：真上传 demo-seed 九份 md + flow-gap 种子后采
  home/team/projects，含 2 张手机差距块专拍）。数据态 spec **钉死页面时钟**
  （setFixedTime 2026-08-08T12:00——决策定级「14 天内到期」类文案拿墙上时钟 vs 文档到期日算，
  不钉会在语料日期被追过后无声腐烂）。50 张全部主检出首冻、人眼过（对照板副本
  `t68-shots/`）。仍全部是 gitignore 单机产物。
- **#68 验证账实**：born-red 两轮——第一轮对照卡变异**桌面红/手机绿**逼出「手机视口拍不到
  折叠线下」的真盲点，补手机专拍后同一变异 4/4 全红、**同一变异下旧 36 张全绿**（空态盲区
  与新覆盖一组实验双证）；稳定性 worktree/主检出各双跑逐张绿（跨 context 像素级确定）；
  产品代码零改动（变异净还原），全电池沿用 `ff02879` 的 #66/#67 后合复验绿 + B 区 visual
  8/8 复跑 + init.sh 绿。
- **✅ 生产仍停在 08-07 白天那一版**（`main-20260807-190332` = main `99d83f7`）。
  gap2 三票 + 两轮演习批 + #68 **都没有上产**——统一上产另行安排（What's Next 第 2 条）。
  迁移 0012/0013/0014 已在生产库落地。
- 🔴 **迁移账（上产时按这个来）**：
  - **T9 需要 `0015_form_submissions_auto_key.sql`**（increment-only、`_ensure_schema()` 自动重放）。
  - **其余各票（含 #68——纯门侧）都不需要。**
  - 判据一句话：**动 dataclass 里被整块 jsonb 装着的字段 → 免迁移；动表的顶层列 → 必须迁移。**
- 🔴 **合的都是本地 main，没有 push**。「落 main 即止」＝**不 push**：前端 push main 即自动
  构建上产，push + 换后端容器必须在统一上产 session 的**同一个窗口里**做。

## 本轮做完的（2026-08-08 · #68 数据态像素基线补盲区）

回执：`.issues/rehearsal-0808/receipt-68-visual-datastate.md`（语料账/born-red 两轮/时钟炸弹/
验证账/已知边界）。

- **新 visual-data.spec.mjs（独立 test）**：Files 屏真 input 上传（不是 stub）→ 自证
  `.lite-gap-card` 在场 → 采三屏。方案 B 最小版落地，升 A（九屏数据态）/降 C 归 Danny。
- **两条新碑**：① **视口截图 + 折叠线下 = 手机零覆盖**——born-red 必须按视口逐个验，桌面红
  ≠手机红；关键部件在手机要滚动专拍。② **数据态基线必须钉页面时钟**——语料里的到期日会被
  真实日期追过，「14 天内到期」类定级文案翻牌、基线无声腐烂；setFixedTime 只冻 Date、
  计时器照跑，不碰上传轮询。
- 旧 spec 头注释「stub 固定 16 人团队」谎言订正（36 张实为空态采样）；battery note 改两套口径。
- demo-seed 语料实测远比预期肥：16 人/8 项目/决策 8 条/差距 5 处待看（demo 自产 4 条中文
  对照卡）——数据态画面的信息密度有了。

## 上几轮做完的（详情全在各自回执，这里只留会影响下一个人的）

- **#66+#67（捆绑）**——回执 `receipt-66-67-refpicker-prefill.md`。@ 弹层可用空间感知
  （翻转/钳高）+ askRefs 唯一构造器接 7 入口。🔴 **CSS 包含块/裁剪必须浏览器实测**：
  `backdrop-filter` 给 static 后代建包含块、`overflow` 计算值有暗规则。
- **#65 今天页差距块默认展开**——回执 `receipt-65-home-gaps-default-open.md`。gapsDefaultOpen
  判据（**别让驱动助手顺手修复被测行为**）；像素「必漂」预判被空态采样推翻——#68 的缘起。
- **#64 议事室 @ 引用回归**——`preamble` 钉开场轮；Esc 静音位用 ref。
- **#63 并屏退 tab**——**改 tab 数三处一起**：LiteTopbar + v2boots + auth-form `tabCount===8`。
- **#61 markdown 表格花名册** / **T9 #58 / T10 #59 / T11 #60**——回执在各 wave 目录。
  🔴 `_GUARDED` 精确匹配，带路径参数的路由命不中。

## What's Next（按优先级）

1. **复演（续）**（本地）：`preview_start rehearsal-api / rehearsal-web`（launch.json 两条在，
   本地未提交；后端脚本 `.issues/gap2-0807/rehearsal-api.ps1`）。库 `rehearsal0808` 保留；
   脑真 MiniMax，抽取/检索离线。顺手验：① markdown 表格花名册（#61）；② 差距对照卡动线 +
   默认展开（#63/#65）；③ @ 引用打真脑（#64）；④ 各入口「去问 Avery」带 chip（#67）；
   ⑤ @ 弹层完整可见（#66，笔记本高度窗口再试）。
2. **统一上产**（gap2 三票 + 两轮演习批 + #68 门侧）。🔴 push 与换后端容器同窗口；
   **0015 必须落地**；上产后先设 `AVERY_PUBLIC_BASE` 再验表单。
3. **T8 两条记录**：① 议事室引用编号形状；② 今天页证据行机器形状（ADR-0033）。
4. **给 `/health` 加版本字段**。
5. carry-over：r2 未开票发现 · gate-run 迁移 · files-hub #26–#29 · 换血抢救 #31/#32 ·
   v01 退役 #33 · 真机零覆盖（iOS/微信，最高优）· 成本票 #30 · 真 brain 分流取证 · 全量 feat-063。

## Notes（顺手发现，没顺手修）

- **数据态像素只覆盖 home/team/projects**（#68 方案 B）：其余六屏数据态仍靠 DOM 判据 +
  交互态截图。升方案 A 归 Danny。
- **手机 home 首屏与差距块专拍两张若因信息架构调整重叠**（差距块上移首屏），裁掉一张即可。
- **弹层 `--lite2-surface` 背景带透明度**（#66 顺手发现）：长文上底字微透，要改是皮肤票。
- **空态弹层可用高度受 `.nexus-empty` 卡几何钳制**：要更大弹层得 portal 出卡，单独开票裁。
- 🔴 **`AVERY_PUBLIC_BASE` 必须指后端自己的口**（#63 实收）。
- **粒度闸够不着跨批次**（T10 记档，碑在 `file_append.py`）。
- **`role`/`tenure` 两份资料说法不同时两条路都不记冲突**（既有边界）。
- **`_people_from_roster` 位置兜底会顶掉空格子**（#61 看清的既有怪癖），要不要改单独裁。
- bellIsReal / nudgeVerdict 等手册协议相位仍无机械 runner；bellIsReal 落点已随 #63 改判 home。
- **@ 引用候选检索纯前端内存**；playbook 卡无 id、标题即稳定键——长出 id 时两处一起换。
  refOfSubject 的 person 分支已接但今天后端恒发 project。
- **分诊卡 personIds 依赖后端 ownerId 链接**；对不上时退化为只带 project ref。

## Blockers / Risks

- 无硬 blocker。
- 🟠 **别单独 push main**（ahead 40 上下）：前端 push 即自动上产、后端容器要人手换，同窗口做。
- 🔴 **像素基线两套 50 张全是 gitignore 单机产物**：worktree 里冻＝白冻（首跑红=无基线首写，
  不作数）；主检出红了先比 mtime 再谈漂移。**数据态那套依赖后端带
  `AVERY_DEMO_SEED_DIR=tests/fixtures/demo-seed`（不是 `seed`）**——后端不在时红形态是
  「上传等不到」超时，不是假绿。
- 🔴 **born-red 要按视口逐个验**（#68 实收）：桌面红≠手机红——视口截图拍不到折叠线下
  （内部滚动容器，fullPage 无效），手机的关键部件要滚动专拍。
- 🔴 **数据态基线的时钟已钉死在 spec 里**（setFixedTime）：改语料/加数据态屏时**别忘同款钉**，
  「拿墙上时钟算的文案」都是基线时间炸弹（Docker PG 时钟跳同族）。
- 🔴 **CSS 包含块/裁剪的读码推断必须浏览器实测**（#66 实收）。
- 🔴 **像素门不密闭：后端够不着 → `home` 先红**。三件套照旧（dist 重打 + 后端带 demo seed +
  CORS 放行）。
- 🔴 **杀 npx 包装进程杀不死 vite 子进程**；stale 进程按端口杀、CommandLine/父链/创建时间
  **认领**后只杀自己的（#68 收尾清干净：5173/8137/5253/8253 全释放）。
- 🔴 **cwd 残留会把 git 操作打到别的树**（#68 实录一次空转无事故）：worktree 会话里 git
  一律 `-C <树>` 显式指定。
- 🔴 **改判清单要把 C 区也扫进去**；「全仓改判」用 `git ls-files "*verify-*.mjs"` 全量扫。
- 🔴 **门驱动 store 还是真部件**决定能否看见「接线」bug；落点/初值类判据**先离开目的地再触发**；
  **别让驱动助手顺手修复被测行为**（#65 实收）。
- 🟠 **门的环境缺一样就假红**。最小清单：`AVERY_BRAIN=mock` + `AVERY_EXTRACTOR=heuristic` +
  `AVERY_EMBEDDINGS=keyword` + `AVERY_DEMO_SEED_DIR` + `AVERY_PUBLIC_BASE=<后端口>` +
  `AVERY_CORS_ORIGINS`；跑门给 `VERIFY_BASE` **和** `VERIFY_API`。
- 🔴 **脚本落盘的「会话/状态」文件默认当凭据**；先写 .gitignore 再写脚本。
- ⚠ **提示词约束不是判据**；**belt-and-braces 让内层规则免疫变异**——两把锁两道独立门。
- 🔴 **本机 Docker PG 容器时钟来回跳 ~115s**：`created_at < now()` 判据间歇假红。
- 🔴 **本机 curl / argv / stdout 都按 GBK 啃中文**：中文只走文件（`git commit -F` /
  `gh --input`）；python 要 `sys.stdout.reconfigure(encoding='utf-8')`。
- 🔴 `e535ec9` commit message 是错的（真相在 `03a9824` erratum）；rebase 与否归 Danny。
- 🔴 repo 级 stash 两条别人的存货；处置归 Danny。
- 多个战役 worktree 仍挂着（25 个上下）——删分支/worktree 属删除闸，归 Danny。
- ⚠ **各票收尾必须重写本文件**（AGENTS.md DoD）。
