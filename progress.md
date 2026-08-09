# Session Progress Log

> 📢 本文件是**当前状态快照，整体重写不追加**。历史都在 git（`git log` + 各 `.issues/*/receipt*.md`），别在这儿堆编年史。
> 启动路径见 `AGENTS.md` Startup Workflow：读本文件 + `feature_list.json`，跑 `./init.sh` 确认绿，再开工。

**Last Updated:** 2026-08-09（**0809 反馈批 wave 4 落地**：#80 会话侧栏 + #81 composer 现代化。
仍未 push、未上产）

## Current State

- **git**：`main` = 差距战役八票 + gap2 三票 + 三轮演习批 + #68 + #70 + #69+#71 + #72 +
  **0808 重构战役四波全部**（#73/#74/#75/#76/#77/#78/#79）。
  **本批 #80+#81 落在 worktree 分支 `claude/sharp-dirac-eedec3`，尚未合 main。**
  回执五份：`receipt-75-room-claude.md` · `receipt-76-77-74-files.md` · `receipt-78-threads.md` ·
  `receipt-79-copy-sweep.md` · **`receipt-80-81-sidebar-composer.md`（本批）**。
  ⚠ 别在这儿写死 ahead 数字——它每提交一次就自己作废。要数就跑：
  `git rev-list --count origin/main..HEAD`。
- **像素基线现状**：**54 张不变**（本批零新增）。#80+#81 净漂移**恰好 4 张** =
  `{aurora,paper}-room-data-{desktop,mobile}`（侧栏入画 + composer 换版式）。
  真比对 → 全量重冻 → md5 全表 diff 确认只动 4 张 → 复跑 **8 passed · 0 首写**；
  born-red 后再比一次 md5，54 张逐字节一致（变异没污染基线）。
  🔴 **`visual.spec` 的 room 4 张（无材料态）一张没漂**——侧栏挂在 `contextId !== null` 那一支里。
- **✅ 生产仍停在 08-07 白天那一版**（`main-20260807-190332` = main `99d83f7`）。
  gap2 三票 + 三轮演习批 + #68 + #70 + #69/#71 + #72 + 重构战役四波 + 本批都没有上产。
- 🔴 **迁移账（上产时按这个来）**：
  - **T9 需要 `0015_form_submissions_auto_key.sql`**（increment-only、`_ensure_schema()` 自动重放）。
  - **#78 需要 `0016_advise_runs_thread.sql`**（`ADD COLUMN IF NOT EXISTS thread_id` +
    `(context_id, thread_id, seq)` 索引；**无回填 UPDATE**）。已在本地 throwaway 库真跑过。
  - **#80 / #81 / #79 / #77 / #76 / #74 / #75 / #73 都不需要迁移**（本批是纯前端 + 门改动，**零后端文件**）。
  - 判据一句话：**动 dataclass 里被整块 jsonb 装着的字段 → 免迁移；动表的顶层列 → 必须迁移。**
- 🔴 **新依赖**：`@phosphor-icons/react@2.1.10`（本批引入，票面拍板项，别被下一个人当漂移回滚）。
  bundle 实测 `Lite2App` chunk +9.98 kB raw / +2.88 kB gzip（整批前端改动合计，是 phosphor 份额的上界）。
  ⚠ worktree 的 node_modules 是主检出的 junction：装依赖要在 `D:\avery` 装，再把
  `package.json` + `package-lock.json` 搬进 worktree、主检出 `git checkout` 还原。
- 🔴 **合的都是本地 main，没有 push**。前端 push main 即自动构建上产，push + 换后端容器
  必须在统一上产 session 的**同一个窗口**里做。

## 本轮做完的（2026-08-09 · wave 4 · #80 会话侧栏 + #81 composer 现代化）

回执 `.issues/redesign-0808/receipt-80-81-sidebar-composer.md`（含变异台账、像素三段账、
人眼过证据 `_px8081/` 24 张、逐条订正）。

- **#80**：右上角「点开才有」的历史弹窗 → 左侧**常显**会话侧栏（按日分组 今天/昨天/更早 +
  「新对话」+ 点击载入），手机 ≤860 收成抽屉、`data-history-toggle` 开关保留。
  `data-history-thread / turns / toggle` 三属性族一个没丢 → room-threads 40 条近零改判。
- **#81**：composer 换 Claude 式**双行**版式（正文一行、控件行附件靠左 / 停止+发送靠右）、
  圆角恒定取 `--lite2-radius-lg`(16px)、附件/发送/停止换 **@phosphor-icons/react**、
  发送钮 icon 化 + **ink 实底**圆钮、focus 补 sky 环。icon 体系收在新文件 `src/lite2/icons.tsx`
  （一族一个 weight，唯一入口）。**统一范围只限对话页**，顶栏铃铛/齿轮没碰；
  **胶囊收起 pill 一个像素没动**（动了＝数据态 14 张全漂）。
- **新 action `newConversation`**（#78 纪律：自带 busy 闸 + 幂等闸 + 同步 run 尾轮镜像）；
  **后端零改动**——清掉 `threadId` 之后下一问不带 `thread_id` 键，服务端据此自铸新场。
- 🔴 **实测推翻两条一直被当事实的读码推断，各自都是一个从没在屏上出现过的样式**：
  ① `.lite2-shell .lite-composer-stop`（0,2,0）一直被 `.lite2-shell .lite-btn.lite-btn--ghost`（0,3,0）
     压死——#75 写的「停止钮 danger 描边」**从来没渲染出来过**，它和附件钮长得逐字节一样；
  ② 冻结基座 `.nexus-followup-composer button { min-width: 64px }` 一直把 `width:34px` 撑成 64——
     recon 写的「34px 圆钮」是读码推断，实测推翻。两条都在本票刀口上，已就地结清。
- 🔴 **手机 390×844 人眼过逮到**：「历史对话 · N 场」开关压在开场块 h2 上（#78 就存在，
  常显后变常态），≤860 给开场块补 44px 让位。
- **门连改三道 + 变异 9 条逐条独立跑**：room-threads 40→**55** 判据（driver 分形态 + ⑫⑬⑭）、
  room-claude-rework 46→**59**（icon-only 钮的 aria 暗区 + 对比度暗区）、button-family 白名单 +1。

### 验证账

`npm run typecheck` 绿 · css 双检绿 · `i18n-orphans` 孤儿 0 · A 区 **34/34**（三轮复跑都是 34/34）·
B 区 `data-boundary` 37/37 + `null-owner` 15/0 · C 区 **3/3**（跑完重打 dist 并在浏览器里验过
`apiBase === 127.0.0.1:8181`）· 像素 **8 passed · 0 首写 · 54 张** · 后端零文件改动（离线 pytest
本批结构性不可能回归）。

## 上几轮做完的（详情全在各自回执，这里只留会影响下一个人的）

- **wave 3 · #79 copy-sweep**——`receipt-79-copy-sweep.md`。zh 137 键改值 + 2 新键 / en 28 改 + 2 新；
  4 个真 bug；像素 50 张全漂全量重冻；立碑「名字引用跟着改、动词短语不改」。
- **wave 2 · #78 真线程**——`receipt-78-threads.md`。迁移 0016 · thread_id 服务端铸经 SSE 两帧回传 ·
  新端点 `GET /team/{id}/advise-threads`（limit 的单位是「场」不是「行」）· hydrateThread 三闸。
- **wave 1 · #75 议事室 Claude 化 + #73 现场附件**——`receipt-75-room-claude.md`。docked composer 三态统一 ·
  停止生成落成第五状态 `interrupted` · 多行输入 + IME 让位 · markdown 自渲染 · 胶囊即发。
- **wave 1 · #74 + #77 + #76**——`receipt-76-77-74-files.md`。
- **#72 建议追问 chips** · **#69+#71 会话流+灰提示** · **#70 @ 文件引用两修** · **#68 数据态像素基线** ·
  **#66+#67** · **#65 / #64 / #63 / #61 / T9–T11**。

## What's Next（按优先级）

1. **把 `claude/sharp-dirac-eedec3` 合进本地 main**（#80+#81）。合并在自己的 worktree 里做
   （主检出常脏且不一定在 main）；合完 `.issues/redesign-0808/` 就是五份回执 + 四路侦察 + 两份开工裁定。
2. **复演第 6 轮**（重点：侧栏动线 + 新输入框手感）——0809 反馈批的两票已落地，可以开演。
   ⚠ 给下一个人的口径：recon-sidebar / recon-composer 是好正源，但它们**各有一处已证的错**
   （见本轮「实测推翻」两条）——任何侦察里的「这个值是 X」都要自己在浏览器里量到为止。
3. **统一上产**（gap2 三票 + 三轮演习批 + #68 + 重构战役四波 + 本批）。🔴 push 与换后端容器同窗口；
   **0015 + 0016 必须落地**；上产后先设 `AVERY_PUBLIC_BASE` 再验表单。
4. **T8 两条记录**：① 议事室引用编号形状；② 今天页证据行机器形状（ADR-0033）。
5. **给 `/health` 加版本字段**。
6. carry-over：会话**改名 / 删除**（#80 v1 明确不做，成本表见 recon-sidebar §5.4）· 侧栏 20 场硬上限
   （端点不透传 limit）· **全应用 icon 统一**（#81 只做了对话页；顶栏铃铛/齿轮/`↗▾×` 仍是手绘 SVG +
   unicode 字形，动它＝54 张全重冻）· 判读卡 4 段死渲染 + 后端已发前端未消费 7 类字段 · r2 未开票发现 ·
   gate-run 迁移 · files-hub #26–#29 · 换血抢救 #31/#32 · v01 退役 #33 · 真机零覆盖（iOS/微信，最高优）·
   成本票 #30 · 真 brain 分流取证 · 全量 feat-063。

## Notes（顺手发现，没顺手修）

- 🔴 **`.lite-btn.lite-btn--ghost` / `.lite-btn.lite-btn--primary` 那两组 (0,3,0) 规则是一类隐形地雷**：
  任何按 `.lite2-shell .某个具体按钮类`（0,2,0）写的**配色覆盖**都会被它们静默压死，而**一道门都不会红**
  （本批 §2.1 是它咬到的第一例，未必是最后一例）。写按钮配色前先想一眼特异性。
- 🔴 **`.lite-room-history-panel` 那一族 CSS（lite2.css 8288-8312）已整段变死**（弹出面板被侧栏取代），
  照 `.nexus-empty-composer-wrap` 先例留碑不删。⚠ 它的两条几何公式仍被手机抽屉与侧栏底沿**抄用**。
- 🔴 **手机 ≤860 的抽屉态在所有既有门里零覆盖**：contrast / aria-zh / at-references / room-claude-rework
  四道门的视口都硬钉 1280×900 或最小 900 > 860。抽屉里的配色、11px meta 对比度、开关 aria 全是盲区。
- 🔴 **「composer 圆角恒定」在像素层没有覆盖**（born-red 实证：16→4px 的变异 0 红——`maxDiffPixels:50`
  加默认 threshold 分辨不了低对比边缘上的圆角差）。要给它长机械判据得量 `border-radius` 计算值。
- **Phosphor 不传 `size` 不是 0×0**：`IconContext` 默认 `1em`，图标会**跟着按钮字号走**。
  任何「零尺寸 svg」形状的判据对这条病根都是瞎的（本批把判据改成「区间 + 同排逐像素相等」）。
- 🔴 **aria 硬门对短拉丁黑话是瞎的**：`suspiciousLatin` 要求「≥2 连续拉丁词 **或** 单词长度 ≥4」，
  `HR`、`1:1`、`New` 永远不报。
- **`gapCardClaimLabel`「文件里的说法」与「资料里的实际情况」在同一张差距卡上不对仗**；
  **`projectsTitle`「你文件里的项目」**与同屏 lede 词族不齐。
- **mock 语料下判读卡的信号行是英文**（`Grounded in the record: …`）——mock brain 产物不是字典漏网。
- **mock 语料不产判读卡的 confidence / script / metrics / escalation 四段**。
- **短答路 followups 落库仍被丢**（`app.py` 的 `_persist_advise_run` 只取 `answer.text`）。
- **`fetchAdviseRuns` / `refreshAdviseRuns` 前端已无消费者**；没删（后端平铺读面仍是公开契约）。
- **`--lite2-bottom-band` 是幽灵 token**（全文件无赋值，恒等于兜底 120px；侧栏底沿也抄了它）；
  **`--lite2-clear-top` 的 ≤860 覆盖写了两遍**，早段 72px 已被后段 24px 静默架空。
- **`.issues/gap-design-0805/t8-e2e.mjs:514` 是 `room.status !== 'error'` 反向判断**。
- **`data-room-composer` 从未落地**（三处**注释**声称门已改判到它，DOM 上没有）。
- **`nexus-brief-hud` 与四相面板仍在说同一件事**；#75 只修了眉标撒谎那半。
- **switchContext 换公司时 `turns`/`run` 不清**——只有 `resetLiteCompanyData` 清（三抄本只有第三份全）。
- **中文名互为前缀仍双中**（「王力」vs「王力宏」）：词边界对 CJK 刻意不阻断，宁多勿漏。
- **`tests/test_at_references.py:90` 潜伏 typo**（`rep.errors` 应为 `parse_errors`）。
- **`>` 开头的材料块结构性不可引用**；**facts.md 指针不是单射**。
- 🔴 **`AVERY_PUBLIC_BASE` 必须指后端自己的口**（#63 实收）。
- **粒度闸够不着跨批次**（T10）；**`_people_from_roster` 位置兜底会顶掉空格子**（#61）。
- **`KeywordStore` 分词器是 `[a-z0-9]+`（纯 ASCII），对无空格中文 `query()` 恒空**。
- bellIsReal / nudgeVerdict 等手册协议相位仍无机械 runner。

## Blockers / Risks

- 无硬 blocker。
- 🟠 **别单独 push main**（实数跑 `git rev-list --count origin/main..HEAD`）：
  前端 push 即自动上产、后端容器要人手换，同窗口做。
- 🔴 **像素基线目录是 gitignored**（`.gitignore:34`），**每棵树各一份**：worktree 里那份是空的，
  在 worktree 跑 visual = **首写**，证明不了任何事。真比对做法：**在主检出 `D:\avery` 跑 playwright
  （用它的真基线），`VERIFY_BASE` 指向 worktree 的 preview**。
  ⚠ **本轮又栽了三次**，而且两次的表象**方向相反**：第一次是「8 failed」（看着像变异生效）、
  第二次是「8 passed」（看着像变异没生效），**都不是真话**。病根是命令开头 `cd` 到 worktree、
  cwd 又会在下一条命令里残留。判别法：跑之前 `pwd`，跑之后比 `mtime`。
  ⚠ **改了 spec 必须先把改动合进本地 main**，主检出才看得见（#79 实收）。
- 🔴 **`md5sum … | sed 's|.*/||'` 是贪婪的，会把哈希一起吃掉**——「重冻前后 md5 全表 diff」
  会退化成只比文件名的**空判**。本轮改用**完整行 diff**（哈希在前）。
- 🔴 **一个 test 串着跑 N 次 `toHaveScreenshot`，第一处不匹配就中止整条**——一次红跑给出的漂移清单
  是**残缺的**。本轮之所以敢说清单完整，是因为 room 恰好是 `SCREENS` 的**最后一屏**。
- 🔴 **变异活下来 ≠ 门有洞，也 ≠ 代码没 bug —— 先看变异有没有真的碰到被判的性质**。
  本轮两条第一版变异都活了，原因完全不同：一条是**判据太宽**（Phosphor 的 `1em` 默认值），
  一条是**变异根本没生效**（选择器特异性不够，探针实测底色没变）。
- 🔴 **截图证据自己也会撒谎**：拍「多行输入态」的脚本把 `'\n'` 交给 `pressSequentially`，
  等于连按三次 Enter，拍到的是「发了三问」。拍完要看一眼拍到的是不是那个态。
- 🔴 **门崩掉比门变红难诊断得多**；**改判扫描的暗区**：`scripts/gates/live-frontend-gate.snippet.js`
  不在 `*verify-*.mjs` glob 里。
- 🔴 **门全绿 ≠ 真部件被验到**：本轮 A 区 34/34 之后，靠一次「两个不同族的按钮量出逐字相同的
  对比度」才翻出停止钮 danger 色从未生效。**恰好一致 / 恰好如预期的数字最该翻日志。**
- 🔴 **多行插入时忘了把新文本也转成 CRLF，会造出混行尾文件**。本轮全程用 python 按 CRLF 写入，
  收尾逐文件自查 `bare_lf == 0`。
- 🔴 **改完后端必须按端口杀掉重起 uvicorn**（不热重载）。本批零后端改动，未触发。
- 🔴 **`./init.sh` 和 run-battery 的收尾重建都 `vite build` 不带 api base** → dist 落回生产域名。
  跑任何上传型门/截图之前先重打带 `VITE_AVERY_API_BASE` 的 dist**并在浏览器里验 apiBase**。
- 🔴 **杀 npx 包装进程杀不死 vite 子进程**；stale 进程按端口杀。
- 🔴 **本机 Docker PG 容器时钟来回跳 ~115s**：`created_at < now()` 判据间歇假红。
  （本批的日期分组因此判 `delta <= 0` 而不是 `=== 0`。）
- 🔴 **本机 curl / argv / stdout 都按 GBK 啃中文**：中文只走文件（`git commit -F` / `gh api --input`）。
  ⚠ 同族：Python 脚本里 `print()` 中文会直接 `UnicodeEncodeError` 炸掉——结果写文件、stdout 只打 ASCII。
- 🔴 **离线套对 pg 持久层是瞎的**：动 schema 必跑 `@needs_db`（本地 throwaway 库）。
- 🔴 **CSS 包含块/裁剪读码推断必须浏览器实测**（#66）；**特异性同理**（本批 §2.1/§2.2 两例）。
- 🔴 `e535ec9` commit message 是错的（真相在 `03a9824` erratum）；rebase 与否归 Danny。
- 🔴 repo 级 stash 两条别人的存货；处置归 Danny。
- 多个战役 worktree 仍挂着（30 个上下）——删分支/worktree 属删除闸，归 Danny。
- ⚠ **各票收尾必须重写本文件**（AGENTS.md DoD）。
