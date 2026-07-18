# 集成期发现 · v02 对齐波（2026-07-18 夜）

集成方（合流人）在合完 P0 各线之后、在**集成层**跑出来的东西。
共同点：**没有任何一条能被单线的自验或复核抓到** —— 要么是两条线合起来才出现，
要么是四道机器门（typecheck / build / lint / pytest）结构上就看不见。

---

## 一、已修（本波内解决）

### F1 · 🔴 CSS 括号漏闭合 → feat-053 整块账号样式失效

**是我（集成方）自己在合 feat/053 时留下的洞，不是子线的问题。**

- **病因**：feat-068（部署线）的 ingest 等待态 CSS 以 `@media (prefers-reduced-motion: reduce) {` 收尾，
  冲突标记正好落在这个媒体查询**内部**——它的闭合 `}` 在冲突区之外。
  我按「两块都留」拼接时，把 feat-053 的 200 多行账号面板 CSS 直接接进了未闭合的媒体查询里。
- **后果**：`.lite-auth*` 全部样式**只在用户开启了「减少动效」时才生效**。默认设置下登录/注册面板裸奔。
- **为什么四道门拦不住**：esbuild 只吐一句 `css-syntax-error` **WARNING**，build 照样成功退出 0；
  typecheck / lint / pytest 与 CSS 无关。那条警告被 `✓ built in 4.56s` 淹在输出里。
- **发现方式**：Look 定名合入后重跑全量门，逐行读了 build 的完整输出。
- **修复**：`bba9f1c`。3613 行文件的括号净差从 +1 回到 0；媒体查询闭合于第 3432 行。
- **教训**：CSS 冲突不能按「两块都留」机械拼接——必须先确认冲突边界不在某个块内部。

### F2 · 054×056 在 `_norm_status` 上趋同演化，合并后产生静默错读

- 两条线**各自独立**给中文状态加了解析（谁也不知道对方在做）。git 把两条梯子**叠成两层**，
  后一层（054 的）没有否定前瞻 → `无风险` 被读成 `at-risk`、`未完成` 被读成 `done`。
- **单独跑任一分支都不复现。** 只有合并后存在。
- 修复：删除冗余层，把它独有的 `受阻` / `已阻断` 补进保留层的 `_ZH_BLOCKED`。见 `3ef4224`。

### F3 · 053 的「换账号清场」在 051 落地后变成静默空转

- 053 写的是 `setState({ detail: null, screen: 'team' })`，但 051 路由化之后这两个都**不再是 store 状态**。
- 后果：换账号后 URL 还停在 `/team/<上一家公司的人 id>`，浮层照旧挂着上一家的人——
  **正是 053 这个函数要杀的串台 bug 原样复活**。
- 修复：改调 `goScreen('team')`（051 保持了签名，内部推路由）。见 `e533ce0`。

### F4 · 053 的裸 fetch 会把 068 刚上线修好的等待态打回去

- ingest 跨境真要 100–120 秒，部署线为此加了 `send()` 重试包装 + 人话错误文案。
- 053 为了带 `accountHeader()` 把它换成了裸 `fetch`。取并集：保留包装，header 作为 `init.headers` 传入。见 `1e95852`。

---

## 二、已记录、未修（超出本波范围，但会影响 7/25）

### F5 · Markdown 表格花名册抽出 0 人 —— **不是 CJK 问题**

实测（后端 `AVERY_BRAIN=stub` 起在 8137，启发式路径）：

| 输入 | people |
|---|---|
| CSV 花名册（BOM + 表头「姓名,职位,部门」） | **5** ✅ |
| 同样 5 人写成 **中文** Markdown 管道表格 | **0** ❌ |
| 换成 **英文** Markdown 管道表格 | **0** ❌ |

第三行是关键隔离：**英文同样挂**，所以 feat-049 的 `_ZH_HEADER_MAP` / `_canon_header`
（`extract.py:368-414`）没问题，问题是 **md 管道表格压根没进 roster 解析路径**，只有 csv/xlsx 走了那条。

**7/25 影响**：把花名册贴进周报或说明文档里（很常见）→ 团队屏是空的。
而 CSV/XLSX 正常，所以这个洞**很容易在内测里被漏掉**。

修的时候注意：表头映射逻辑已写好且可复用，缺的是把 md 表格喂进去。
🔴 新增测试必须含**真汉字**，不许用拼音伪装（上一波「全套门语料是 ASCII 伪装」栽过）；中英各一份。

### F6 · 广播里的 issue #10 在启发式路径上**不复现**（需要更正范围）

广播说「同一次上传花名册 + 周报，两份都提到同样 5 个人 → 抽出 10 个人，每人两遍」。

实测同一场景（CSV 花名册 + md 周报，一次 `/ingest`）：

```
people: 5   names: ["李明","王芳","陈思雨","张伟","刘洋"]
重复: []    唯一 id: 5
```

**去重是好的**（feat-048 的 `_dedupe_entities` 正常工作）。
若 #10 确实存在，应是 **LLM 抽取路径特有**（生产走 MiniMax），排查请对准 `llm_extract.py`，
不要去改 `_dedupe_entities`。

### F7 · 离线 heuristic 路径每篇文档只吐 1 个项目

喂一份含三个 `## 项目：` 标题的中文周报 → `projects: 1`，且标题是**文档名**而非任何项目名。
feat-054 的粒度门只覆盖 LLM 路径（治的是反方向的病：LLM 把里程碑当项目、抽太多）。
与 H4「中文项目轴幽灵」同源（已知非 CJK bug，纯英文双项目文档也只抽 1 个）。

**7/25 影响**：LLM key 失效 / 预算耗尽时回落到这条路径，项目屏和「今天要决策的」会一起塌。

### F8 · 中文界面下首屏摘要仍是英文

`eval-harness/avery/ingest/registry.py:206-209` 硬编码英文：

```
Ingested 1 file(s): 0 people, 1 projects.
Everything below is drawn from your uploads — nothing invented. No risk signals surfaced from the documents.
```

`lang=zh` 会话里周围全是中文，就这两句是英文，而且是**打开应用看到的第一句话**。
既有问题（已核对 `53f72d0`，本波之前就在），非本波引入。

---

## 三、基础设施坑（会造成假阴性，务必知道）

### F9 · 🔴 工作树共享 `node_modules` junction ⇒ `.vite` 预构建缓存也共享

多个 dev server 并发时会互相把对方的缓存判为 outdated → 浏览器收 **504 Outdated Optimize Dep** → **页面白屏**。

危险之处：白屏看起来就像「这条线把应用改崩了」。集成期真踩过一次，差点误判。

绕法：给每个 dev server 独立 `cacheDir`（见 `verify-server.mjs`）。

### F10 · 后端 CORS 是精确匹配列表，没有通配

只放行 `localhost:5173` / `127.0.0.1:5173` + 两个生产域名。
**换个端口就被浏览器静默拦掉**，症状是「团队 / 笔记 / 文件全空」——和「没数据」长得一模一样。
本地验证一律用 **5173**，或起本地后端时显式设 `AVERY_CORS_ORIGINS`。

---

## 四、方法论结论

四道机器门（typecheck / build / lint / pytest）是**必要不充分**的。本波它们全绿的同时，
F1 让整块账号 UI 失效、F2 让中文状态被读反、F3 让串台修复失效——**一条都没被拦住**。

所以补了 `verify-p0.mjs`：21 条行为断言 × 2 张皮 + 1 条跨皮比对 = 41 条，真跑浏览器 + 真后端。
它能拦住的正是机器门看不见的那一类：刷新丢数据、后退掉出应用、缺失字段渲染成 0%、
锁定词漏进可见文字、token 进 URL、`?look=` 变成摆设。

---

## 五、第二轮对抗审查（2026-07-19 凌晨）

第一轮 checker≠maker 复核跑完、8 条已合进 main **之后**，又开了一轮四视角对抗审查
（跨线假设失效 / 诚实性与假数据 / 真实脏文件 / 租户隔离），每条发现再经**独立交叉验证**
（验证者的默认立场是「这条不成立」，拿不准一律判否）。

**报告 19 条 → 存活 15 条**（5 blocker · 7 major · 3 minor），其中 11 条是**真跑复现**的。

> 🔴 **存活项有一个共同主题，比任何单条 bug 都重要：产品在对客户说他自己文件里没有的话。**
> 「我没读到」和「客户说没有」是两件事。读不到就说读不到，不要替客户编一个默认值。

| # | 级别 | 位置 | 问题 |
|---|---|---|---|
| S1 | 🔴 blocker | `teamData.ts:160` | 文档没写状态的项目，前端硬编码兜底成 'on-track'，把「我没读到」渲染成「客户说一切正常」——后端同一刻正把这个字段列为 unknown_fields |
| S2 | 🔴 blocker | `registry.py:208` | 首屏摘要在同一份 payload 明明带着阻塞、分诊卡和「需确认」决策时，断言「No risk signals surfaced from the documents」并把 tone 设成 calm |
| S3 | 🔴 blocker | `parse.py:216` | GBK/GB18030 中文文件（中文 Windows 上 Excel 存 CSV / 记事本存「ANSI」的默认编码）被静默销毁：全文解码成乱码后又把乱码证据删掉，抽 0 人 0 项目，HTTP 200，清单标 'ingested'，全链路没有任何一处告诉用户文件没读进去。 |
| S4 | 🔴 blocker | `extract.py:715` | _ZH_DONE 的否定前瞻只挡 (?<![未没待])完成，挡不住「无法完成 / 未能完成」——项目自述「本月无法完成」被读成 status=done，再被决策定级判成「可推进」，理由写「项目自报已完成，且无风险信号」。 |
| S5 | 🔴 blocker | `store.ts:226` | 上传完团队后 UI 继续摆着上传入口邀请「再加文件」，但 POST /ingest 每次都新建一个 context——第二次上传把第一家公司整份数据从界面上抹掉，且没有任何回得去的入口。 |
| S6 | major | `AuthPanel.tsx:108` | clearCompanyScope 只清 useLite + owner_token，三个 localStorage store（flowStore/onboardStore/notifyStore）原封不动地跨账号存活——里面装着上一家公司上传文档的逐字原文。 |
| S7 | major | `AuthPanel.tsx:217` | feat-053 为躲合并冲突绕开了 feat-050 专门为它留的 adoptContext() 收口，改用裸 setState——导致 adoptContext 全仓零调用点（死代码），登录用户的 contextId 锚点永远不落 localStorage。 |
| S8 | major | `teamData.ts:122` | 首屏晨间分诊卡的标签行和标题是写死的英文，中文会话里整张卡除项目名外全是英文 |
| S9 | major | `transport.ts:371` | 413 的人话文案写死了两个错的上限：「the server caps 10 files, 10MB each」，服务端实际是 15 个文件 / 每个 8 MiB —— 单文件那个数字还比真上限大，用户照着它重试永远失败。 |
| S10 | major | `UploadPanel.tsx:26` | 文件选择器的 accept 列表里有 .doc 和 .xls，后端 SUPPORTED_EXTS 里没有——挑得出来、传得上去、必然 422。 |
| S11 | major | `transport.ts:234` | 后端每份文件都带 status（ingested/empty/failed），前端 LiveFileEntry 类型里没有这个字段、UploadPanel 也不渲染——扫描版 PDF 一个字没读出来，界面和读全了的文件长得一模一样，headline 还说「Ingested 1 file(s)」。 |
| S12 | major | `ingest_api.py:121` | owner_token header 含非 ASCII 字符时 secrets.compare_digest 抛 TypeError，鉴权失败从 404 变成 500——feat-038 明写的「不给存在性 oracle」红线在所有受保护读端点上被打穿。 |
| S13 | minor | `transport.ts:655` | feat-053 的两个账号端点是全 transport 仅有的两处裸 fetch，绕开了 feat-068 的 send() 错误包装——集成方修 F4 时只修了 ingest 那一处，账号这两处漏了。 |
| S14 | minor | `upload_guard.py:268` | 加密（带密码）的 xlsx 被判成「伪装成 xlsx 的假文件」——回的是 magic-byte mismatch，等于当面说用户改了扩展名骗人。 |
| S15 | minor | `AuthPanel.tsx:112` | clearCompanyScope 与账号恢复都用裸 setState 绕开 adoptContext，从不调 rememberContextId，于是登出后 localStorage 的 lite2:contextId:v1 仍指着上一个账号的公司。 |

各视角命中率：crossline 3/4 · honesty 3/3 · realfiles 7/8 · tenancy 2/4

### 逐条详情

#### S1 · 🔴 blocker · `src/lite2/teamData.ts:160`（真跑复现）

**文档没写状态的项目，前端硬编码兜底成 'on-track'，把「我没读到」渲染成「客户说一切正常」——后端同一刻正把这个字段列为 unknown_fields**

输入：任何一份没写「状态：」这一行的项目文档（后端自己的统计是 status 只在 17 份里抽到 13 份，即约 1/4 的项目会命中）。后端 project_cards() 此时**根本不发 status 键**，decision_cards() 把它记进 unknown_fields 并生成理由「未读到：状态」。前端 liteTeamFromPayload 却用 `?? 'on-track'` 补上。错误结果三处：① 团队屏渲染 `{project.status}` = 字面量 on-track 配中性状态点；② 详情浮层标题行显示「on-track · 李娜」；③ 最严重——该项目若同时带 blocker，gapDerive 的 STEADY_STATUSES 命中，产出一张「A closer look」对照卡，其 claim 兜底文案是 `Reported status: "on-track"`，而这段字被放在标签「文件里的说法」/「What the files say」底下。等于当着客户的面，把一句他文件里从来没有的话加引号说成是他文件里的原话。gapDerive 第 40-43 行的注释声称机械读出「保证兜底文本也 100% 可溯源到字段本身」，但该字段本身就是前端编的。后端在 R-CLEAR 里坚持 status 必须真实存在才敢判「可推进」，前端却直接默认它正常，两层口径相反。

<details><summary>证据</summary>

```
真跑（后端 avery.decision_grading.grade_project，卡片形状取自仓库自带测试语料 p_brand）：
  unknown_fields = ['status', 'progress', 'dueDate']
  reason = 按规则判为需确认：…（未读到：状态、进度、到期日——未知不等于没风险。）

真跑（esbuild 打包 src/lite2/teamData.ts + gapDerive.ts 后 node 执行，喂上面同一张卡）：
  后端发的 project card 有没有 status 键 : false
  前端映射后的 project.status        : "on-track"
  deriveGaps 产出 : [{ "claim": "Reported status: \"on-track\"",
                       "evidence": "视觉供应商合同未签",
                       "evidenceTag": "From your uploads" }]

代码：teamData.ts:160 `status: card.status ?? 'on-track',`
标签：zh.ts:224 "gapCardClaimLabel": "文件里的说法"
对照：decision_grading.py:361 `_m_clear` 要求 `s.status in STATUS_STEADY` 才判可推进
```

</details>

#### S2 · 🔴 blocker · `eval-harness/avery/ingest/registry.py:208`（真跑复现）

**首屏摘要在同一份 payload 明明带着阻塞、分诊卡和「需确认」决策时，断言「No risk signals surfaced from the documents」并把 tone 设成 calm**

输入：一个自报 on-track（或压根没写状态）但挂着 blocker 的项目——这正是「A closer look」整个功能存在的前提场景。briefing() 的 at_risk 只看 `p.status in ("at-risk","blocked")`，完全不看 blockers、不看 signals。于是 at_risk 为空 → subhead 落到「No risk signals surfaced from the documents.」、tone='calm'、metrics 里连「need a look」那一格都不出现。而同一份 payload 里：decision_cards 判「需确认」并列出三条命中规则（含「自报『正常』但挂着未解阻塞」），前端 liveHandoffs 产出 1 张晨间分诊卡，deriveGaps 产出 1 张对照卡，全都指着同一条阻塞。结果是应用在首屏说「文档里没有风险信号」，往下滑就是三处风险提示。更糟的是这句话前面紧贴着信任声明「Everything below is drawn from your uploads — nothing invented」——把一句失实陈述挂在诚实承诺后面。三家公司拿真周报来试，「自报正常但有阻塞」几乎必然出现。注：已知清单 F8 提到过这两句话，但只指出它们是英文（i18n 问题），没有指出内容本身是假的。

<details><summary>证据</summary>

```
真跑（eval-harness 真实 ingest 管道，输入一份写着 Status: on-track / Progress: 35% / Blocker: vendor contract still unsigned 的 weekly.md）：
  projects : [{"status": "on-track", "progress": 35, "blockers": ["Blocker: vendor contract still unsigned, legal has not returned it."]}]
  tone     : calm
  subhead  : Everything below is drawn from your uploads — nothing invented. No risk signals surfaced from the documents.
  decision : CRM Rollout -> needs_confirmation | 按规则判为需确认：挂着 1 条未解阻塞；自报进度不足 40% 且未完成；自报「正常」但挂着未解阻塞（自述与信号不一致）。

真跑（同一份 payload 喂进前端）：
  首屏 subhead : …No risk signals surfaced from the documents.
  首屏 tone    : calm
  同一份数据的 handoffs : 1 条
  同一份数据的 closer-look 卡 : 1 条

代码：registry.py:208 `at_risk = [p for p in self.extraction.projects if p.status in ("at-risk", "blocked")]`（不看 blockers / signals）
```

</details>

#### S3 · 🔴 blocker · `eval-harness/avery/ingest/parse.py:216`（真跑复现）

**GBK/GB18030 中文文件（中文 Windows 上 Excel 存 CSV / 记事本存「ANSI」的默认编码）被静默销毁：全文解码成乱码后又把乱码证据删掉，抽 0 人 0 项目，HTTP 200，清单标 'ingested'，全链路没有任何一处告诉用户文件没读进去。**

三亚鹿山雅居/国内融资团队从公司 Excel 导出「员工花名册.csv」（GB18030，中文 Windows 默认，不是 UTF-8）→ _parse_csv 用 data.decode('utf-8', errors='replace') 硬解 → 每个汉字变成 U+FFFD → 紧接着 _normalize 的 _MOJIBAKE_MAP 把 '�' 映射成空串（parse.py:141），把唯一能证明解码失败的痕迹也抹了 → 剩下一串拉丁垃圾 → 抽 0 人。屏幕上显示「Ingested 1 file(s): 0 people, 0 projects.」、「你的文件」里那份文件标 ingested / 1 处引用。用户会认为是 Avery 读不懂中文，而不是编码问题，没有任何可自救的线索。

<details><summary>证据</summary>

```
真跑（TestClient 打真 /ingest）。同一份内容两种编码：
UTF-8 「员工花名册.csv」→ HTTP 200, people: ['张伟','李娜','王芳']
GBK  「员工花名册.csv」→ HTTP 200, people: []
parse_bytes 出来的正文（GBK 路径）：'| ְλ | Ŷ\nΰ | Ʒ | Ʒ\n | ˹ʦ |\n | ʦ |'  (doc_kind=roster, len=33)
附带实测：把同样的 GBK 内容换成中文绩效评分表，avery.redline.validate 在 UTF-8 下 passed=False（3 条 PERSON-SCORE/PERSON-RISK），在 GBK 下 passed=True —— 红线检测器对乱码是全瞎的（这条只是佐证乱码有多彻底，红线在 ingest 主路径上并不扫原文，所以不单列）。
```

</details>

#### S4 · 🔴 blocker · `eval-harness/avery/ingest/extract.py:715`（真跑复现）

**_ZH_DONE 的否定前瞻只挡 (?<![未没待])完成，挡不住「无法完成 / 未能完成」——项目自述「本月无法完成」被读成 status=done，再被决策定级判成「可推进」，理由写「项目自报已完成，且无风险信号」。**

中文周报写「状态：因供应商未回款，本月无法完成」→ _norm_status 走到 _ZH_DONE，'法' 不在 [未没待] 里 → 匹配「完成」→ 返回 'done' → decision_rules 命中 R-DONE → 决策卡显示「可推进」，理由「项目自报已完成，且无风险信号」。经理文档里白纸黑字写的是完不成，Avery 当着他的面说他自己报了已完成。同一函数反方向也错：_ZH_AT_RISK = (?<![无没])风险（extract.py:714）挡不住带修饰词的否定，「无重大风险，按计划推进」「无明显风险」「目前没有风险」全部读成 at-risk。这是校准样本 #2（054×056 双层梯子）同一类幸存者——梯子已合并成一条，但否定前瞻只覆盖紧邻单字。附带后果：被误判成 done 的项目 status 不在 gapDerive 的 STEADY_STATUSES 里，所以它连「多看一眼」都不会出现，blocker 行彻底沉没。

<details><summary>证据</summary>

```
真跑。单项目文档（无分段干扰）过真 /ingest：
输入 '# 二期客房软装改造\n状态：因供应商未回款，本月无法完成\n负责人：张伟\n完成度：30%'
→ project: 二期客房软装改造 status= done progress= 30
→ decision: -> can_proceed 可推进 sev 1  reason: 按规则判为可推进：项目自报已完成，且无风险信号。  rules: [('R-DONE','项目自报已完成，且无风险信号')]
另一份 '状态：无重大风险，按计划推进' → status='at-risk'
_norm_status 单元实测：无法完成→'done' / 未能完成→'done' / 预计完成→'done' / 计划完成时间：8月底→'done' / 无重大风险→'at-risk' / 无明显风险→'at-risk' / 目前没有风险→'at-risk' / 风险已解除→'at-risk'（对照组正常：无风险→'' 、未完成→'' 、尚未完成→''）
```

</details>

#### S5 · 🔴 blocker · `src/lite2/store.ts:226`（真跑复现）

**上传完团队后 UI 继续摆着上传入口邀请「再加文件」，但 POST /ingest 每次都新建一个 context——第二次上传把第一家公司整份数据从界面上抹掉，且没有任何回得去的入口。**

经理先传「员工花名册.csv」→ 看到 12 个人；界面上传面板仍在（TeamScreen.tsx:326 把 UploadPanel 渲染在已填充的团队栏里，文案仍是「把你的团队带进来 / 把文件拖到这里」，没有一个字说第二次会替换）→ 他再传「项目周报.md」以为是追加 → ingest_api.py 的 /ingest 从不传 context_id，pipeline.ingest_docs 走 cid = new_context_id() 新建 context → store.uploadFiles 用 set({team: liteTeamFromPayload(payload), contextId: payload.context_id}) 整体替换，并 rememberContextId 覆盖 localStorage 指针 → 12 个人当场消失，briefing 变成「0 people, 1 projects」，「你的文件」只剩 1 份。旧 context 在服务端还活着、owner_token 也还在 localStorage 里，但 UI 没有任何列表/切换入口能回去。三家公司的真实用法就是分几次把材料传全。

<details><summary>证据</summary>

```
真跑（两次连续 POST /ingest）：
upload #1 (roster) ctx: ctx_9aa6d8ebf0bd  people: ['Lena Park','Mia Chen','Tom Fox']  briefing: Ingested 1 file(s): 3 people, 0 projects.
upload #2 (weekly) ctx: ctx_cd7b3596ab1b  people: []  projects: ['Core Flow']  briefing: Ingested 1 file(s): 0 people, 1 projects.  source_files: ['Core_Flow_Weekly.md']
same context? False
old context still on server: 200（数据还在，只是 UI 够不到）
ctx#2 files manifest 只有 Core_Flow_Weekly.md
前端替换逻辑为读代码确认：store.ts:226-239 整体 set + rememberContextId(payload.context_id)；TeamScreen.tsx:326 在 team 非空分支里仍渲染 <UploadPanel />。
```

</details>

#### S6 · major · `src/lite2/auth/AuthPanel.tsx:108`（读码推断）

**clearCompanyScope 只清 useLite + owner_token，三个 localStorage store（flowStore/onboardStore/notifyStore）原封不动地跨账号存活——里面装着上一家公司上传文档的逐字原文。**

经理 A（三亚鹿山雅居）在「你的团队」分诊卡上点「加入跟进」→ flowStore 落一条 followup，title=`Take a look at <A 公司项目名>`、note=A 上传文档里被原样摘出的那句阻塞原因（teamData.ts:115-124 → TeamScreen.tsx:145），写进 localStorage `lite2:flow:v1`。A 点退出登录 → clearCompanyScope() 跑：forgetAllOwnerTokens() 清掉 `lite2:ownerTokens:v1`，setState 清掉 useLite，goScreen('team') 回团队屏——**但 `lite2:flow:v1` / `lite2:onboard:v1` / `lite2:notify:v1` 一个字节没动**。经理 B（瑞典建筑公司）在同一浏览器登录 → 点「Follow-ups」tab → FollowupsScreen 只订阅 useFlow、完全不看 contextId/team（FollowupsScreen.tsx:25-31），**A 公司的项目名和文档原文当场逐条渲染在 B 眼前**，且刷新后还在。同理 PlaybooksScreen.tsx:36-38 会对 B 显示「Playbooks for <A 公司名>」（onboardStore 的 company 是 A 在向导里手打的）。这不是陈旧渲染，是 A 的客户文档内容出现在 B 的账号下。🔴 注意这条**绕开了服务端那道门**：我实测 authorize_context 是 fail-closed 的（见 howVerified），但这份数据从来不经过服务端，那道门救不了它。另有一个不需要账号的同款触发：同一浏览器先传 A 公司文件、再传 B 公司文件（uploadFiles 换了 contextId 但不碰 flowStore），跟进列表直接混装两家。feat-053 自己的注释（AuthPanel.tsx:96-103）和 store.ts:313 的「换账号数据串是 feat-053 的红线」点名要杀的就是这个，只杀掉了 useLite 那一半。

<details><summary>证据</summary>

```
clearCompanyScope 全文只触碰两处存储：`forgetAllOwnerTokens()`（transport.ts:467-471，removeItem `lite2:ownerTokens:v1`）和 `useLite.setState({contextId:null, team:null, ...})`。grep 全仓 `removeItem|clearFlow|resetFlow` 只有两个命中：store.ts:77（`lite2:contextId:v1`）和 transport.ts:471（token）——**没有任何代码清 `lite2:flow:v1`(flowStore.ts:22) / `lite2:onboard:v1`(onboardStore.ts:16) / `lite2:notify:v1`(notifyStore.ts:21)**。数据链路：teamData.ts:123-124 `action: \`Take a look at ${pr.title}\`` + `evidence`(=`blockers[0]`，上传文档原文) → TeamScreen.tsx:145 `addFollowup({title: handoff.action, note: handoff.evidence})` → flowStore.ts:71 savePersisted → FollowupsScreen.tsx:25 `useFlow((s)=>s.followups)`，零 contextId 过滤。
```

</details>

#### S7 · major · `src/lite2/auth/AuthPanel.tsx:217`（读码推断）

**feat-053 为躲合并冲突绕开了 feat-050 专门为它留的 adoptContext() 收口，改用裸 setState——导致 adoptContext 全仓零调用点（死代码），登录用户的 contextId 锚点永远不落 localStorage。**

feat-050 在 store.ts:154-156 明写 adoptContext 是「被覆盖口：谁拿到权威 contextId（将来是 feat-053 的服务端按账号返回）就调它——落 state + 落锚点，一处收口」。feat-053 没调它，而是写 `useLite.setState({ contextId: first })`，注释自陈理由是「contextId 那块 feat-050 正在改，这里少碰一行就少一处合并冲突」（AuthPanel.tsx:197-198）。合并时没人把这根线接回去，于是 `rememberContextId()` 在账号路径上一次都不会被调到。具体错误结果：经理在**新设备/新浏览器**登录（这正是 AuthPanel.tsx:34 guestNote 对客户承诺的「换设备还能打开」），账号下已有公司 C，AuthPanel 恢复出 C 并 setState —— 锚点没写。用户按 F5：模块加载期 `restoredContextId = loadStoredContextId()` 返回 null（store.ts:84）→ `restoring: false`（store.ts:198）→ restoreSession 因无 contextId 直接 bail → **TeamScreen 既不显示「正在恢复」也不显示错误，直接落到冷启动的「拖文件进来」上传空态**（TeamScreen.tsx:296-303 两个分支都是 false），一直到 /account/contexts 往返回来才闪回公司数据。更糟的是这个往返若失败（后端抖动/CORS——F10 记过 CORS 是精确匹配列表），`setRestoreError(true)` 的那行提示是画在**默认关闭的账号浮窗里**的（AuthPanel.tsx:324-339），用户屏幕上就是一个干净的空应用，没有任何错误、没有重试入口——feat-050 专门设计的「保住锚点 + 安静显示『没连上 + 重试』」兜底（store.ts:250-255）对有账号的用户整个失效。第二个后果：clearCompanyScope 同样用裸 setState 写 `contextId: null` 而不走 rememberContextId(null)，退出登录后锚点仍指着上一家公司，下次启动会拿 A 的 id 去打一发 /team——服务端 fail-closed 会 404 掉（我实测过），所以不泄数据，但白费一个往返，且它的 404 清理分支（store.ts:285-297，会把 contextId/team 一起清空）可能晚于账号恢复落地，把刚接管好的 C 又冲掉。

<details><summary>证据</summary>

```
grep 全仓 `adoptContext` 只有三处命中：store.ts:152（注释）、store.ts:156（接口声明）、store.ts:307（实现）——**零调用方**。对照 `rememberContextId` 的调用方只有 store.ts:239（uploadFiles）、:286（404 清理）、:308（adoptContext 内，而 adoptContext 没人调）。所以账号路径上锚点永不写入。AuthPanel.tsx:217 `useLite.setState({ contextId: first })`；AuthPanel.tsx:112-122 clearCompanyScope 的 setState 里 `contextId: null` 同样不经 rememberContextId。
```

</details>

#### S8 · major · `src/lite2/teamData.ts:122`（真跑复现）

**首屏晨间分诊卡的标签行和标题是写死的英文，中文会话里整张卡除项目名外全是英文**

输入：`lang=zh` 会话 + 任何一个 at-risk/blocked 或带 blocker 的项目（三家公司里两家是中文用户，这是打开应用后团队屏上最主要的行动卡）。liveHandoffs 把 toneLabel 写死成 'Worth a closer look'、action 拼成 `Take a look at ${title}`，这两个值不经 i18n，直接被 TeamScreen.tsx:203/204 渲染成分诊卡的标签行和 h3 标题。错误结果：中文经理看到的卡片是「Worth a closer look / Take a look at 别墅二期交付 / 等待集团法务对合同模板签字」——只有引自他自己文档的那一行是中文。同类的 `evidence` 兜底句 `${title} is flagged ${status} in your uploads.` 同样是英文模板。已知清单 F8 记的是 registry.py:206-209 的首屏摘要，是另一处代码；这条在 teamData.ts，没被记过。

<details><summary>证据</summary>

```
真跑（esbuild 打包后 node 执行 liveHandoffs，喂一张中文项目卡 title='别墅二期交付' ownerName='陈曦' status='at-risk' blockers=['等待集团法务对合同模板签字']）：
  toneLabel（首屏分诊卡的标签行）: Worth a closer look
  action   （分诊卡标题 h3）    : Take a look at 别墅二期交付
  evidence （分诊卡正文 p）    : 等待集团法务对合同模板签字

渲染点：TeamScreen.tsx:203 `<span className="home-handoff-tone">{handoff.toneLabel}</span>` / :204 `<h3>{handoff.action}</h3>`
```

</details>

#### S9 · major · `src/lite2/transport.ts:371`（真跑复现）

**413 的人话文案写死了两个错的上限：「the server caps 10 files, 10MB each」，服务端实际是 15 个文件 / 每个 8 MiB —— 单文件那个数字还比真上限大，用户照着它重试永远失败。**

经理传一份 9 MB 的扫描合同 → 服务端 upload_guard.read_capped 按 max_file_bytes()=8 MiB（guards.py:41，部署 runbook 也设 8388608）拒掉，返回 413 → httpErrorMessage 告诉他「the server caps 10 files, 10MB each」→ 他看 9 < 10 认为应该能过，删几个别的文件再传，再 413，无限循环，没有任何提示真正的门槛是 8 MiB。文件数方向反了但无害（说 10 实际允许 15），单文件方向是害人的。src/lite/transport.ts:299 有同一份拷贝。

<details><summary>证据</summary>

```
真跑：9 MB 单文件 → HTTP 413 {"detail":"'big.csv' exceeds the 8388608-byte per-file limit"}；16 个文件 → HTTP 413 "16 files exceeds the per-request limit of 15"；15 个文件 → HTTP 200。前端文案为读代码确认：transport.ts:371 `if (status === 413) return \`${name}: too much at once — the server caps 10 files, 10MB each.\``。
```

</details>

#### S10 · major · `src/lite2/UploadPanel.tsx:26`（真跑复现）

**文件选择器的 accept 列表里有 .doc 和 .xls，后端 SUPPORTED_EXTS 里没有——挑得出来、传得上去、必然 422。**

国内小公司和三亚酒店手上大量还是 2003 格式的「花名册.xls」「合同.doc」。ACCEPT = '.pdf,.docx,.doc,.xlsx,.xls,.csv,.md,.markdown,.txt' 让系统文件对话框把它们列为可选；guards.SUPPORTED_EXTS（guards.py:75）只有 pdf/docx/xlsx/csv/tsv/md/markdown/txt/text/''，parse._DISPATCH 同样没有 → 整批只有 .doc/.xls 时 ingest_paths 走「paths and not docs」→ HTTP 422 「no parseable content in the upload」。前端把 422 翻成「那类文件不被接受」——直接和它自己刚才给出的可选列表矛盾。（混合批次是诚实的：'Ingested 1 of 2 file(s)' + manifest 标 failed，那部分没问题。）

<details><summary>证据</summary>

```
真跑：'花名册.xls' → HTTP 422 {"reason":"no parseable content in the upload","parse_errors":["unsupported file type '.xls' for '花名册.xls'"]}；'合同.doc' 同样 422。ACCEPT 常量为读代码确认（UploadPanel.tsx:26，OnboardWizard 用同一个）。
```

</details>

#### S11 · major · `src/lite2/transport.ts:234`（真跑复现）

**后端每份文件都带 status（ingested/empty/failed），前端 LiveFileEntry 类型里没有这个字段、UploadPanel 也不渲染——扫描版 PDF 一个字没读出来，界面和读全了的文件长得一模一样，headline 还说「Ingested 1 file(s)」。**

三亚鹿山雅居的合同基本都是扫描件。传一份纯图像 PDF：pypdf 能打开、extract_text() 返回空 → parse 成功 → source_files 里算 1 份（所以 headline 是「Ingested 1 file(s): 0 people, 0 projects.」，不是「1 of 1」，等于宣称完全成功）→ _finalize_source_documents 把它标成 status='empty' → file_cards 如实发出来 → 前端类型里根本没有这个键，UploadPanel.tsx:206-212 只渲染 filename + 大小 + n_chunks。经理在「你的文件」里看到「扫描合同.pdf · 145 B · 0 处引用」，和一份成功文件的唯一区别是那个 0，没有一句话说明「这份是扫描件，没有文字层，读不出来」。传 5 份扫描合同就是 5 行看起来正常、0 人 0 项目、无解释。

<details><summary>证据</summary>

```
真跑：pypdf 造的无文字层 PDF → HTTP 200，briefing「Ingested 1 file(s): 0 people, 0 projects.」，/team/{id}/files 回包 [('扫描合同.pdf', 'empty', 0)]。前端缺字段为读代码确认：transport.ts:234-242 的 LiveFileEntry 只有 idx/filename/size_bytes/mime/doc_kind/uploaded_at/n_chunks，无 status；UploadPanel.tsx:205-213 的渲染只用 filename/size_bytes/n_chunks。
```

</details>

#### S12 · major · `eval-harness/service/ingest_api.py:121`（真跑复现）

**owner_token header 含非 ASCII 字符时 secrets.compare_digest 抛 TypeError，鉴权失败从 404 变成 500——feat-038 明写的「不给存在性 oracle」红线在所有受保护读端点上被打穿。**

输入：任意调用方对一个**存在的** context 发 `X-Avery-Token: 你好世界`（或 `Authorization: Bearer 你好世界`）。secrets.compare_digest 对非 ASCII str 直接抛 TypeError，该异常不是 HTTPException，一路冒到 FastAPI → 500。对一个**不存在的** context 发同样请求则在第 116 行就 raise 404。结果：500 = 这个 context 真实存在，404 = 不存在。攻击者无需任何凭据即可确认某个 context_id 是否存在，而这正是 feat-038 选 404 不选 403 要杜绝的那个可枚举 oracle。ask_api.py:94 的 `except HTTPException` 是专门为归一化错误写的，但它接不住 TypeError，所以 ask_id 的存在性同样被泄漏（这条尤其值得注意：那行代码看起来已经处理了失败）。用错误的**ASCII** token 做对照组则两边都规规矩矩返 404，证明设计意图本身是对的，塌的只是非 ASCII 这条路径。附带影响：一个无凭据的请求就能在生产上稳定制造 500，污染错误率监控。

<details><summary>证据</summary>

```
真跑（后端 8342，AVERY_BRAIN=stub，curl）。ctx=ctx_6294b2980fbb 真实存在：

对照组，错误的 ASCII token —— 设计意图正常：
  wrong ascii token, EXISTING ctx : 404
  wrong ascii token, UNKNOWN  ctx : 404

非 ASCII token —— oracle 出现：
  GET /team/{ctx}            存在:500  不存在:404
  GET /team/{ctx}/files      存在:500  不存在:404
  GET /team/{ctx}/notes      存在:500  不存在:404
  GET /team/{ctx}/files/0    存在:500
  GET /ask/{ask_id}          存在:500  不存在:404   ← 绕过了 ask_api.py:94 的 except HTTPException
  Authorization: Bearer 载体 存在:500            ← 两个 header 载体都中

服务端 traceback：
  File "D:\avery-wt\gate\eval-harness\service\ingest_api.py", line 121, in authorize_context
    if not token or not secrets.compare_digest(token, required):
  TypeError: comparing strings with non-ASCII characters is not supported

响应体只有 "Internal Server Error"，未泄漏 traceback。
注：httpx/TestClient 会把非 ASCII header 卡在客户端（UnicodeEncodeError），必须用 curl 打真 server 才复现——pytest 大概率就是这么漏掉的。
```

</details>

#### S13 · minor · `src/lite2/transport.ts:655`（读码推断）

**feat-053 的两个账号端点是全 transport 仅有的两处裸 fetch，绕开了 feat-068 的 send() 错误包装——集成方修 F4 时只修了 ingest 那一处，账号这两处漏了。**

feat-068 加 send()（transport.ts:512-520）的理由写在注释里：fetch 自己 reject 时没有 Response/status 可读（连接被拒、https 页混合内容拦截、CORS、离线），而「api base 配错」最常见的落地形态正是这一类，所以所有请求统一从这里出错文案。集成方 F4 已经把 feat-053 的 ingest 裸 fetch 换回包装，但 `fetchAccountContexts`(:655) 和 `claimContext`(:663) 这两处还是裸 fetch，且错误也不过 `httpErrorMessage()`（直接 `throw new Error(\`account contexts HTTP ${res.status}\`)`）。触发路径：生产构建 VITE_AVERY_API_BASE 配错 / 换域名后 CORS 没放行 → 这两个调用抛 `TypeError: Failed to fetch` 而不是 068 那句「构建配错了」。**我把影响如实压到 minor**：这两个调用的唯一消费方是 AuthPanel，两处 catch 都把 message 吞掉换成固定文案（`.catch(() => setRestoreError(true))` :221 和 `catch { setClaim('failed') }` :260），所以今天用户看不出差别。它是个潜伏的口径分歧（F4 修了一半），不是当下的用户可见故障。

<details><summary>证据</summary>

```
`grep -rn 'fetch(' src/lite2/` 全部命中只有三条：transport.ts:514（send() 内部本体）、:655（fetchAccountContexts）、:663（claimContext）。其余 streamAdvise/ingest/team/files/notes/ask 全部走 `send(name, url, init)`，例如 :645 `const res = await send('notes', ...)`。
```

</details>

#### S14 · minor · `eval-harness/service/upload_guard.py:268`（真跑复现）

**加密（带密码）的 xlsx 被判成「伪装成 xlsx 的假文件」——回的是 magic-byte mismatch，等于当面说用户改了扩展名骗人。**

Excel 给工作簿加密后写出的是 OLE2 容器（\xd0\xcf\x11\xe0），不是 zip。check_type 对 .xlsx 只认 PK 开头 → enforce_type_and_archive 抛 415，detail 是「declared '.xlsx' but the content is not an Office (zip) file (magic-byte mismatch)」。传薪酬表/花名册时加密是国内 HR 的常规操作。真正的原因是「这份表加了密码，Avery 打不开」，给出的文案却在指控伪装，用户没有可行动的下一步（正确动作是去掉密码另存）。

<details><summary>证据</summary>

```
真跑：('Salaries.xlsx', OLE2 magic + 512 个 0 字节) → HTTP 415 {"error":"unsupported upload","detail":"declared '.xlsx' but the content is not an Office (zip) file (magic-byte mismatch)","filename":"Salaries.xlsx"}。前端把 415 统一翻成「that file type isn't accepted, or its contents couldn't be read.」，同样说不出「有密码」。
```

</details>

#### S15 · minor · `src/lite2/auth/AuthPanel.tsx:112`（读码推断）

**clearCompanyScope 与账号恢复都用裸 setState 绕开 adoptContext，从不调 rememberContextId，于是登出后 localStorage 的 lite2:contextId:v1 仍指着上一个账号的公司。**

store.ts:313-315 把 adoptContext 定义为「一处收口『权威 contextId 变了』这件事」，它负责调 rememberContextId 落/清锚点。但 AuthPanel 两处都绕开了它：:112 的 clearCompanyScope 用 `useLite.setState({contextId: null, ...})` 清状态，:217 的账号恢复用 `useLite.setState({contextId: first})` 接管——两处都没碰 localStorage。输入：经理 A 登录 → 上传公司 A → 登出。结果：内存 contextId 归零、owner_token 也被 forgetAllOwnerTokens 清干净了（这半边是对的），但 `lite2:contextId:v1` 仍然是 ctxA，留在这台浏览器上；随后经理 B 登录并被恢复接管到自己的 context 时，:217 同样不写锚点，localStorage 里那条仍是 ctxA。实际危害有限：下次刷新会用 ctxA 起一发 /team 请求，因为 token 已清、账号也不匹配而 404，store.ts:284-286 的自愈分支随即把锚点清掉并回到正常路径——所以这不是串数据，是「上一家公司的 context_id 在共享/演示机上多留了一会儿」加上一发注定失败的请求。之所以仍然值得记：这与已修的 F3 是**同一个函数、同一种裸 setState 绕开语义缝**的模式，F3 修了 detail/screen 那一半，这一半没人看。

<details><summary>证据</summary>

```
src/lite2/store.ts:73-79  rememberContextId(null) 才会 removeItem(CONTEXT_STORE_KEY)
src/lite2/store.ts:313-315  adoptContext 是唯一会调 rememberContextId 的收口（另两处调用点在 :244 ingest 成功、:286 404 自愈）
src/lite2/auth/AuthPanel.tsx:112  clearCompanyScope 内 useLite.setState({...}) —— 无 rememberContextId
src/lite2/auth/AuthPanel.tsx:217  useLite.setState({ contextId: first }) —— 无 rememberContextId；:197 注释说明这是为避开 feat-050 的合并冲突而刻意用裸 setState
自愈分支 src/lite2/store.ts:284-286
已确认 main 最新提交（40ce59c）对 store.ts 的改动只动了 stubSelected 判定，未触及本条。代码读，未真跑浏览器复现。
```

</details>

### 处置

四条按文件严格切分、互不重叠的修复线（ · 
·  · ），每条要求**回归测试必须先在旧代码上跑出 FAIL**
才算数——写完就算的测试不算。
