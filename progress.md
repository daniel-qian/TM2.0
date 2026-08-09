# Session Progress Log

> 📢 本文件是**当前状态快照，整体重写不追加**。历史都在 git（`git log` + 各 `.issues/*/receipt*.md`），别在这儿堆编年史。
> 启动路径见 `AGENTS.md` Startup Workflow：读本文件 + `feature_list.json`，跑 `./init.sh` 确认绿，再开工。

**Last Updated:** 2026-08-09（**0808 UIUX 重构战役 wave 1 整波落 main**：S2 = #74+#77+#76
先合，S1 = #75+#73 后合。仍未 push、未上产）

## Current State

- **git**：`main` = 差距战役八票 + gap2 三票 + 三轮演习批 + #68 + #70 + #69+#71 + #72
  + **wave 1 整波**（S2 `702287a`/`b3b56ce`/`3aa77e5`/`021bc58`，S1 `fdfb98e`）。
  回执两份：`.issues/redesign-0808/receipt-76-77-74-files.md`（S2）与
  `.issues/redesign-0808/receipt-75-room-claude.md`（S1）。
  `main...origin/main` **ahead 50+**，**没有 push**（见 Blockers）。
- **像素基线现状**：两套共 52 张。S2 在主检出对真基线比对，**恰好 files 空态四张漂移
  （aurora/paper × desktop/mobile）、其余 46 张逐字节未变**，那 4 张已重冻、复跑 8/8 绿。
  🔴 **S1 的 room 改动尚未在主检出比对**——见 What's Next 第 1 条。
- **✅ 生产仍停在 08-07 白天那一版**（`main-20260807-190332` = main `99d83f7`）。
  gap2 三票 + 三轮演习批 + #68 + #70 + #69/#71 + #72 + **wave 1 整波**都没有上产。
- 🔴 **迁移账（上产时按这个来）**：
  - **T9 需要 `0015_form_submissions_auto_key.sql`**（increment-only、`_ensure_schema()` 自动重放）。
  - **#77 / #76 / #74 / #75 / #73 都不需要迁移**（#77 删除只动既有表的行）。
  - **#78 落地后会带 `0016`**（真线程 thread_id）。
  - 判据一句话：**动 dataclass 里被整块 jsonb 装着的字段 → 免迁移；动表的顶层列 → 必须迁移。**
- 🔴 **合的都是本地 main，没有 push**。前端 push main 即自动构建上产，push + 换后端容器
  必须在统一上产 session 的**同一个窗口**里做。

## 本轮做完的（2026-08-09 · wave 1 两条并行线）

### S1 = #75 议事室 Claude 化 + #73 现场附件（回执 `receipt-75-room-claude.md`）

- **docked composer 三态统一**：空态不再复用 story 的 `.nexus-empty` 居中卡（absolute top:42%）。
  开场块变成 `.lite-room-board` 里的第一块内容，composer 恒在屏底、恒是 `.lite-room` 直接子元素。
  `.nexus-empty-composer-wrap` 整个退役。**「发问零跳变」量的是同一节点的 x/y/宽**，
  实测 `(226, 810, 828)` 第一问前后逐像素不变。
- **停止生成**：`LiveRunState.status` 加第五个值 `'interrupted'`（**不是**布尔旁挂字段——
  那是 fail-open）。假 complete 的病根是 `streamSource` onDone 的**黑名单**兜底，已改白名单；
  abort 在 source 层记账（顺带补上 `stubTransport` abort 从不 onDone 的另一半缺口）。
  诚实终态：面板「你按了停止」、HUD「已停止，这轮没答完」、相位不封 done、不出追问 chips、铃铛不响。
- **多行输入**：textarea 化，Enter 发送 / Shift+Enter 换行 / 自动长高封顶 168px；
  **IME 合成中的 Enter 让给输入法**（中文语境必修）。
- **markdown**：短答自渲染最小 md 子集，**零新依赖、零 `dangerouslySetInnerHTML`**——
  正文全走文本节点，注入面只剩链接 href，scheme 白名单 fail closed。
- **胶囊即发**：`AskAveryLauncher` 从「预填中继」改成 `goScreen('room')` + 同拍 `askLive`。
- **#73 附件**：附件钮 → append 入库 → 等待态 → 完成挂 file ref chip（用回执的服务端权威名，
  与 #74 的 `source_key` 口径同一把尺）；上限**选文件时就预检**（10 个/10 MiB/批 32 MiB），超限零请求。
- **门**：新门 `verify-room-claude-rework` **46 判据**入册 A 区；at-references、room-conversation、
  snippet 相位 F1/F2/H 全部改判。8 条变异逐条独立跑。26 张双视口双皮截图人眼过。

### S2 = #74 + #77 + #76（回执 `receipt-76-77-74-files.md`）

- **#74**：`file_cards()` 补发 `source_key`（值取**已解析**的 `sd.source_key or sd.filename`）→
  `LiveFileEntry` additive 字段 → `askRefs` 文件候选 `id` 改用它、label 仍 filename、
  重名消歧**复用 person 的 dupeTeam 槽位**。补传重名不再静默引到另一份文档。
- **#77**：删除走**独立模块** `avery/ingest/file_delete.py`（不进 mixin、不进 Protocol）。
  端点 `DELETE /team/{id}/files/{key:path}`，**按 source_key 寻址不按 idx**。
  删材料面/信号/裁决/相关冲突 + 重物化 facts.md + store 重铸；**不删人卡/项目卡**（血缘不够）。
  顺带补上 `upload_guard` 的缺口：DELETE 此前在 ASGI 边缘零限流。
- **#76**：段落按频率重排 + 锚点导航；②b 语义错位靠**新增 `newCompanyStatus`** 修
  （`ingestStatus` 五个写点一行不动——它是约二十道门的等待锚）；文件表补上传时间列 + 排序；
  删除键 + 二段确认。新门 `verify-files-ia.mjs`（17 判据）入册 A 区。

### 合流账（S1 是后合者）

代码层**零冲突**（两线段落真的不同：S2 动 `askRefs`/`FilesScreen`/`FileManifest`/`transport`/
`registry.py`，S1 动 `AskRefComposer`/`RoomScreen`/`streamSource`；`store.ts`/`lite2.css`/i18n
各自追加段落自动合上）。唯一冲突是 `progress.md`，本文件即合并结果。
口径复核：#74 把 file `AskRef.id` 改成服务端 `source_key`；#73 的附件 chip 用 append 回执的
`documents[]`，值同样是 `sd.source_key or sd.filename`——**同一把尺，一致**。

**合流后复跑（后合者义务，已做）：A 33/33 · B 3/3 · C 3/3 · pytest 4028/0**。
⚠ 先红过 at-references(5) 与 files-ia(整道)，**根因是陈旧后端进程**（uvicorn 是合流前起的，
`file_cards()` 还没发 `source_key`、DELETE 路由不存在），按端口杀掉重起即 71/0 与 17/0。

## 上几轮做完的（详情全在各自回执，这里只留会影响下一个人的）

- **#72 建议追问 chips + 快问收敛**——`receipt-72-followup-suggestions.md`。chips 点击即发；
  触发判据走**文种感知词边界**；`answer_kind` 语义闸；撤卡重裁；`askLive` 加 store 级 busy 闸。
- **#69+#71 会话流+灰提示**——`turns: LiveTurn[]`；离开议事室/刷新=对话结束（刻意不持久化）；
  文案长度闸开显示宽度不开字符数（碑）。
- **#70 @ 文件引用两修**——候选轮转发牌 + `_file_doc_lines` 注入真原文；核实中撞出 #74。
- **#68 数据态像素基线**——born-red 按视口逐个验；数据态基线必须钉页面时钟。
- **#66+#67** @ 弹层空间感知 + askRefs 唯一构造器。🔴 CSS 包含块/裁剪必须浏览器实测。
- **#65 差距块默认展开** · **#64 议事室 @ 引用回归** · **#63 并屏退 tab** · **#61 / T9–T11**。

## What's Next（按优先级）

1. **wave 1 收口已全部完成**（保留在这里是因为下一个人需要知道口径）：
   合流复跑 **A 33/33 · B 3/3 · C 3/3 · pytest 4028/0**；
   主检出真比对像素 **8/8 绿、50 张 md5 逐字节一致**（比对前后 md5 全表 diff ＝真比对不是首写）。
   🔴 **但那个「零漂移」是判据够不着，不是「改了没影响」**：`visual.spec.mjs` 采的 room 那 4 张
   是 **contextId===null 的无材料态**，而 #75 改的全在 contextId 非空那一侧——
   **像素门对议事室改版接近零覆盖**。视觉证据是 S1 的 26 张手拍截图（双视口×双皮×各态），
   不是那 8/8。#79 全量重冻时要考虑给议事室补数据态基线。
2. **0808 UIUX 重构战役续跑**（档案 `.issues/redesign-0808/`，四路侦察正源都在）：
   - **wave 2（卡片已发）**：#78 真线程（依赖 #75 ✅；带**迁移 0016**）。wave 1 主检出独立
     复核另绿一轮：pytest 4028/0（TZ=UTC）、init.sh 绿、基线恰好 4 张 files 重冻其余未动、
     #73-#77 五票全关。
   - **wave 3**：#79 文案全量批改（**等 #75-#78 全落**，像素全量重冻只来一次）；
     见仁见智 8 条在 `tickets.md` 末尾待 Danny 勾。
     ⚠ #79 §5 表里 `upload.againBody` 那句「用**上面**那个口子」在 #76 重排之后方位词要按新序复核。
3. **复演（第 5 轮）**：战役各波落地后全内容演习；顺带补验第 4 轮遗留两点——真 brain 往
   followup_questions 里填什么（离线只证管道）、快问收敛的真实手感。
4. **统一上产**（gap2 三票 + 三轮演习批 + #68 + 重构战役全部）。🔴 push 与换后端容器同窗口；
   **0015 + 0016（#78 落地后）必须落地**；上产后先设 `AVERY_PUBLIC_BASE` 再验表单。
5. **T8 两条记录**：① 议事室引用编号形状；② 今天页证据行机器形状（ADR-0033）。
6. **给 `/health` 加版本字段**。
7. carry-over：**Claude 式会话侧栏（0808 拍板本轮不做，真线程落地后是自然延伸）** ·
   判读卡 4 段死渲染 + 后端已发前端未消费 7 类字段 · r2 未开票发现 · gate-run 迁移 ·
   files-hub #26–#29 · 换血抢救 #31/#32 · v01 退役 #33 · 真机零覆盖（iOS/微信，最高优）·
   成本票 #30 · 真 brain 分流取证 · 全量 feat-063。

## Notes（顺手发现，没顺手修）

- **`LiteRoomHistory` 里回放的短答仍是纯文本**，与会话流里的 markdown 渲染不一致
  （#75 刻意不动，#78 地盘）。→ **#78**
- **上传上限三处散落**（`src/lite2/uploadLimits.ts` / `UploadPanel.tsx` 的 ACCEPT / `guards.py`），
  已互指注释。**没有任何端点暴露上限**——前端只能自己维护一份，且必须对齐**生产 env**
  （10 个/10 MiB）而不是 `guards.py` 的默认值（15 个/8 MiB）。
- **`FileManifest` 的清单行仍只渲染 filename**（两份同名文件在资料库里逐像素相同）——
  #74 修的是 @ 引用寻址，不是清单可辨性。
- **pre-032 老行的 `source_key` 是空的**，两份同名老文档会共用同一个 id 被去重塌成一个 chip。
  历史数据边界。
- **`--lite2-bottom-band` 是幽灵 token**（全文件无赋值行，三处消费全走 `var(…,120px)` 兜底
  ＝恒等于硬编码 120px）；**`--lite2-clear-top` 的 ≤860 覆盖写了两遍**，早段 72px 已被后段
  24px 静默架空。#75 只记账未改值（改值＝改视觉，归 #79）。
- **`.issues/gap-design-0805/t8-e2e.mjs:514` 是 `room.status !== 'error'` 反向判断**，
  新增的 `interrupted` 会被它当成通过。一次性门，未改。
- **at-references ⑧ 的宿主矩阵缩水**：三态统一后空态与运行态的 composer 几何一样，
  (a)/(b) 与 (e)/(f) 不再是两种几何。矩阵在视口档位与胶囊宿主上仍有价值。
- **停止的相位判据够不着病根**（门用路由延迟造窗口，中止时零 SSE 事件、四相 steps 全 0）。
  钉住它的是变异 M-C，不是那条判据本身。
- **`nexus-brief-hud` 与四相面板仍在说同一件事**（recon §4-11）；#75 只修了眉标撒谎那半。
- **switchContext 换公司时 `turns`/`run` 不清**——若能在议事室现场切公司，A 公司的问答会
  挂在 B 公司名下。#72 已补 ask 四件，turns 那半没动。
- **中文名互为前缀仍双中**（「王力」vs「王力宏」）：词边界对 CJK 刻意不阻断，宁多勿漏。
- **真 brain 的 followup 质量离线采不到样**；**历史轮没有折叠**；**决策卡 `reason` 在 mock 语料下是空的**。
- **`tests/test_at_references.py:90` 潜伏 typo**：`rep.errors` 应为 `parse_errors`。
- **`>` 开头的材料块结构性不可引用**；**facts.md 指针不是单射**。
- **数据态像素只覆盖 home/team/projects**；**议事室两套基线都只有空态**。
- 🔴 **`AVERY_PUBLIC_BASE` 必须指后端自己的口**（#63 实收）。
- **粒度闸够不着跨批次**（T10）；**`_people_from_roster` 位置兜底会顶掉空格子**（#61）。
- bellIsReal / nudgeVerdict 等手册协议相位仍无机械 runner。

## Blockers / Risks

- 无硬 blocker。
- 🟠 **别单独 push main**（ahead 50+）：前端 push 即自动上产、后端容器要人手换，同窗口做。
- 🔴 **像素基线在 worktree 里证明不了零漂移**（#75 又实证一轮，而且差点被骗）：
  电池第一次跑 B 区时 visual 因写死 `localhost:5173` 而 CONNECTION_REFUSED、**一张都没比对**，
  却在目录里留下 50 张 mtime 是当时的 PNG。**「基线文件在」不等于「比对过了」——先翻日志。**
  清掉重来后是首写 → 复跑绿，**这只证稳定**。真比对必须在**主检出**对着真基线做。
- ⚠ **`verify-null-owner`（`:28`）与 visual 两套都写死 `5173`**，隔离端口跑不到。
  #75 这轮另起了一份 5173 preview 让它们**真跑**（null-owner 15/0），不是记「没跑」。
- 🔴 **选择器绑标签名会让门「崩」而不是「红」**（#75 实收）：`input[type="text"]` 换控件后
  命中 0 个、`button[type="submit"]` 漏写 type 后命中 2 个，Playwright 两种都**抛错**——
  整份门 crash、连汇总行都不打印。新部件一律挂 `data-*` 稳定钩子。
- 🔴 **改判扫描的暗区**：`scripts/gates/live-frontend-gate.snippet.js` 不在 `*verify-*.mjs`
  glob 里。#75 实收加一条：**侦察只报了两处，自查扫出第三处**——转述的行号一律自己复核。
- 🔴 **变异活下来 ≠ 门有洞**（#75 实收）：M-A 第一版改的是**两态共用**的宽度，
  而判据判的是「前后不变」这个不变量，它正确地保持为真。**先看变异有没有真的碰到被判的性质。**
- 🔴 **侦察的预判要当假设验**（#75 实收）：侦察断言「composer 塞进 board 会让 room-usability
  变**假绿**」，M-H 真跑推翻——自己跟自己比时 `bottom > top` 恒成立，是**恒红**不是恒绿。
- 🔴 **同一条判据要配同一个变异** + **变异要逐个单独跑**（#75 照做：8 条独立运行）。
- 🔴 **belt-and-braces 让内层规则免疫变异**；判据落在被测属性本身。
- 🔴 **门语料不能复现病根 = 判据空跑**；**尺子太宽 = 对着真违规也全绿**（#75 实收：
  相位判据最初全页扫 `[data-phase-status]`，捞进了上一轮的 done，已收窄到被中止那一轮）。
- 🔴 **门全绿 ≠ 真部件被验到**（#75 实收：全电池 32/32 之后人眼过仍逮到三处观感缺陷）。
  改完布局必须双视口 × 双皮截图人眼过。
- 🔴 **born-red 按视口逐个验**；🔴 **数据态基线时钟已钉死 setFixedTime**。
- 🔴 **CSS 包含块/裁剪读码推断必须浏览器实测**（#66）。
- 🔴 **像素门不密闭：后端够不着 → `home` 先红**。离线三件套照旧。
- 🔴 **`./init.sh` 和 run-battery 的收尾重建都 `vite build` 不带 api base** → dist 落回
  生产域名。跑任何上传型门/截图之前先重打带 `VITE_AVERY_API_BASE` 的 dist**并验 apiBase**。
- 🔴 **cwd 残留会把命令打到别的树**（#75 又踩一次：`cd eval-harness` 之后起 `vite preview`
  解析到了**主检出 D:/avery**）。worktree 会话里 git 与构建命令一律显式指定路径。
- 🔴 **杀 npx 包装进程杀不死 vite 子进程**；stale 进程按端口杀、CommandLine 认领后只杀自己的。
- 🔴 **本机 Docker PG 容器时钟来回跳 ~115s**：`created_at < now()` 判据间歇假红。
  写测试别赌墙上时钟（#75 的等待态/生成态窗口一律用**路由延迟**造，不赌后端快慢）。
- 🔴 **本机 curl / argv / stdout 都按 GBK 啃中文**：中文只走文件（`git commit -F` / `gh api --input`）。
  ⚠ 同族新增：**bash heredoc 里的中文 + 反引号也会被啃**（#75 实收，改用文件工具写）。
- 🔴 **源文件是 CRLF、新写的文件是 LF ＝ 混合行尾**（#75 实收）：任何按字符串锚点做的
  批量改写都要先按 LF 归一化——「锚点找不到」被静默当成「跑完了」会直接得出错误结论。
- 🔴 `e535ec9` commit message 是错的（真相在 `03a9824` erratum）；rebase 与否归 Danny。
- 🔴 repo 级 stash 两条别人的存货；处置归 Danny。
- 多个战役 worktree 仍挂着（29 个上下）——删分支/worktree 属删除闸，归 Danny。
- ⚠ **各票收尾必须重写本文件**（AGENTS.md DoD）。
