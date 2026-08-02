# 架构走查 · 2026-08-02

## TL;DR

- 整体骨架是健康的：前端双壳走同一个 transport 缝、后端 brain/extractor/embedder/registry 四条缝都有 2 个以上真适配器，屏幕层零网络零随机、推导全在纯模块里——深模块纪律基本立住了。
- 经对抗核验后没有 P0 存活，但有 6 个 P1：CSS 越墙污染冻结的 v01、租户清扫清单散落在 AuthPanel、registry 的 put/get 不对称快照类缺陷、~20 方法的持久层接口没有落字、裸 `pytest` 默认出网烧钱、v01 的 2x 维护税需要给 Danny 一份数据化退役提案。
- 一个 P1（"v01 逃生门只被 stub 喂过"）被对抗核验直接否决：电池里至少四道门确实走真 HTTP 打 mock 后端，误把驱动缝当成了注入缝。
- 知识层的主干（AGENTS.md + progress + handoff + CONTEXT.md）是真快照，但外围账本在漂：门数目、feature 账、ADR 编号撞车、.issues 阁楼无地图——这些是便宜的文档波次。
- 附录还有 19 条未经对抗核验的发现，多为 S 号工作量，派波次前请自行复核引用行号。

## 分区模块地图

### v02 前端壳 — src/lite2/** + src/shared/{version,mode,i18n}

routes.ts 是真正的深模块：sticky-query 不变量完全内化（carrySearch 只在 go() 和 3 个 href helper 内部出现），所有程序化导航走一个漏斗；残余泄漏只剩 `<Link>` 站点靠注释约束。store.ts（useLite，964 行）宽而深——adoptContext 收口、restoreSession、带 stillOn/switchSeq 竞态护栏的 switchContext，都是小动作背后的真硬行为；屏幕层从不直接碰 transport。LiveTransport 是真缝（http + stub 两个适配器，stub 是含 404 纪律的行为孪生），可选 `?:` 方法泄漏能力差异但探测已集中，可接受。七个卫星 store 单一职责、诚实的浅；弱点是它们的公司域重置形状被 AuthPanel 代持（见 P1）。10 个屏幕只持本地 UI 状态，推导全在纯模块（homeDerive/gapDerive/searchDerive 等：payload 进、view struct 出）。version/mode/look/i18n 四条解析链刻意不统一，各有落字理由；i18n 787 个叶子仅 7 个孤儿，健康，但扫描器没有落库。

### 三壳与墙 — src/story, src/lite, src/lite2, 组合根, lint 墙

src/App.tsx + version.ts 是唯一组合根：mode 分 story|live，再按 ?v= 分 1|2（默认 '2'，刻意只认 URL 不认构建环境，理由在 version.ts:12-16）——2 值接口藏住全部壳接线，够深。src/story 冻结、双向无越墙。src/lite（v01，约 6.0k 行）按 7/19 拍板"不许删也不许拆"，但 7/19 之后仍吃了 15 个提交（zh/a11y/contract 战役双份施工）；src/lite2（约 11k 行）52 个提交，同形缝（加 downloadFile、去 revokeAsk）。src/shared 是真地基，i18n 按 lite.*/lite2.* 命名空间管理复制分歧。eslint.config.js:29-50 的四区 no-restricted-imports 墙是真机器缝——但只覆盖 TS 静态 import 层：CSS 级联（main.tsx:19-26 全局加载两份 css）和动态 import() 都在墙外，CSS 这个洞正在漏（见 P1）。

### 后端 — eval-harness/service, avery/ingest, brain 缝, db/migrations, guards

brain 缝（brain.py:55 的单方法 Protocol respond() + Mock/Real/OpenAICompat 三适配器 + Budgeted/timeout 包装器 + 按关切拆分的工厂）是全库最深的缝，唯一泄漏是 _client 私有戳入。extractor/embedder 镜像同构，失败一律离线降级并诚实打 'degraded' 标。持久层缝：ContextRegistry（内存）vs PostgresContextRegistry 双适配器，但约 20 方法的表面没有任何成文接口；put()=快照整替 vs get()=有损投影，正是"put() 抹掉 get() 不读的列"这一著名 bug 类的结构根源，且离线套只看得见无损的内存腿。CompanyContext 是实体存储 + 投影面，诚实不变量重文档化，07-18 统一后规则表健康。HTTP 层恰当地薄；engine.py 是带 parity 契约测试的刻意镜像而非透传。guards.py 纯字节到理由，深而干净。迁移：11 个幂等文件无台账、每次启动排序重放，纪律成立但契约只写在 pg_registry.py 里。

### 验证基建 — run-battery, verify-*.mjs, live-gate snippet, pytest, init.sh

run-battery.mjs（283 行）是这一区的深模块：27 道门花名册 + A→B→C 铁序 + dist 换毒 + 自动重建，一条命令替代一页部落知识——但它的普查/台账在漂（见 P2）。42 个 tracked verify-*.mjs 的断言是各门专属的深断言（正确），但 boot/上报管线是复制粘贴（39 处 chromium.launch、36 处 onboard-Escape 前奏、31 处收尾三件套）。live-frontend-gate.snippet.js（3178 行）是 live 门断言的单一事实源，已有两个适配器消费——真缝、已验证的模式；但 A–D/F 组仍只能靠人工注入协议跑。gate.md 与 snippet 头注释协议双写，同一裁定要打两处补丁。pytest 电池的离线安全只存在于文档咒语里：裸 `pytest` 在本机带真钥匙直接出网（见 P1）。ui-detectors.mjs 是库内共享断言库的自有先例。

### 知识与状态 — AGENTS.md, CONTEXT.md, docs/adr, feature_list, .issues, .to-issues

核心状态三件套（AGENTS.md 96 行 + progress.md 50 行 + session-handoff.md 55 行）经 2026-08-01 重写（d169702）后是真快照：新 agent 读 3 个文件即知在线拓扑、下一步和陷阱。CONTEXT.md（173 行词表）深且新——抽查的 4 个界面标签全在 src 里核到。feature_list.json（791 行/182KB）浅：98% 字节是 77 条 done 行的证据散文，活信号只有 4 行。docs/adr 33 个文件内容深、导航浅：无索引、被取代链隐式、还有一处编号撞车（两个 0023）。门知识的可执行真相在 run-battery 花名册里，但入口文档 AGENTS.md 还描述 07-20 电池前的世界。.issues（42 目录 197 文件）是混合活性的阁楼：6 道电池在用的门和 3 个被引用的回执埋在死战役笔记与 14 份陈旧交接里，无地图。roles.md 浅且失效——已被推翻的商业模式还写成北极星。

## 建议行动

### 已核验 P0

（无——唯一的 P0 候选经核验降级为 P1，见下。）

### 已核验 P1

**1. lite2.css 无作用域规则改写冻结的 v01（lite2-css-unscoped-rules-mutate-frozen-v01）**
- 主张：lite2.css 有 176 条顶层规则缺 `.lite2-shell` 前缀，40 个类名与 lite.css 冲撞，且后加载（main.tsx:19 vs 26）静默重排冻结的 v01——至少三处冲撞今天就把 v01 渲染错了。
- 证据：src/lite2/styles/lite2.css:8（--lite2-accent-rgb 只在 look-paper.css:57 定义，v01 头像变透明）、:1539-1544（覆盖 lite.css:1032 的 Georgia）、:32；main.tsx:21-23 的合同注释说"scoped"；lite2.css:1 文件头还是抄来的旧标题。
- 波次：一个 session 给 176 条规则统一加 `.lite2-shell` 前缀（对齐已 scoped 的 1007 条），修文件头，按"改完布局必截图"规则双壳双 look 截图；可选加一个 10 行检查脚本进电池，把 CSS 墙变成和 import 墙一样的机器门。
- Effort：M。
- 核验按语：无法否证——每处引用逐字成立，176 计数精确，实况比主张更糟（94 个逐字选择器重叠、约 20 条规则消费未定义 token，头像/上传/问答卡今天就实证坏）。P0→P1 仅因破坏是外观性的、局限在非默认的 ?v=1 逃生门，不在 v02 客户主路径上。

**2. 公司域重置清单寄居在 AuthPanel（company-scope-reset-lives-in-authpanel）**
- 主张："哪些状态是公司域、切号必须清扫"这条不变量以三份手工维护的 setState 字段清单活在 AuthPanel.tsx 里而非各 owning store，且在 clearCompanyScope 与 restartAll 之间逐字重复——新增字段漏清扫的后果是跨租户串数据，正是 fixD 战役反复修的 bug 类。
- 证据：AuthPanel.tsx:105-123（代持三个 store 的空形状，注释自认是已过期的并行边界约束）、:134-151 与 :191-202（同一 10 字段清扫字面量两份）；对照 store.ts:646-657 adoptContext 已部分收口但 AuthPanel 仍"不敢信、再清一次"（:135-137）。
- 波次：一波——每个 owning store（store/flowStore/notifyStore/onboardStore）导出与状态声明同文件的 resetCompanyScope()，AuthPanel 两条路径改为组合调用，保留 credentials-first 顺序（:126）与两路径的 lang/look 白名单差异（:163-165）；用 verify-auth-form 门复验。
- Effort：M。
- 核验按语：主张完全成立且还说轻了——存在第三个"靠人记住"的追加（onboardStore 字段，AuthPanel.tsx:114-119）；store 侧重置还须覆盖 EMPTY_PERSISTED 漏掉的内存态字段（composerDraft/open/pausedThisSession）——同文件共置是唯一可复核的位置。今日尚未漂移，故 P1 非 P0。执行注意：勿把 ADR-0006 的"冻结 store 不加 reset"错配到 lite2 store 上，那管的是冻结的 story 机器。

**3. v01 退役需要给 Danny 一份成本账（v01-retirement-needs-cost-ledger-for-danny）**
- 主张：src/lite 今天过不了删除测试仅仅因为一条拍板而非代码依赖，而"冻结"叙事藏着真实的 2x 维护税——7/19 之后冻结壳吃了 15 个提交（v02 52 个），每个 zh/a11y/contrast/contract 战役都要双份施工，外加 8+ 道浏览器门的双份 phase。
- 证据：硬依赖只有 App.tsx:18、main.tsx:28 及各门的 v01 phase；钉子在 version.ts:8（"不许删也不许拆"，Danny 2026-07-19）；税单：0fb0e4a（v01/v02 同修）、4912169（两壳双语）、e4edca3、d32c42d/93cbf74。
- 波次：不要单方面退役——一个 session 写一页退役提案 GitHub issue，进 Danny 的下一批 grilling：量化的 2x 税、v01 绕过 OnboardGate（Lite2App.tsx:187 只在 v02）、具体退路（?v=1 → 提示 + v02，git tag 保真回滚，各门撤 v01 phase）。让拍板带着数据被重议。
- Effort：S。
- 核验按语：否证失败——钉子原文、15 vs 52 提交数、五个税单提交、9 个门工具 + snippet 的双份 phase、OnboardGate 仅 v02，全部核实。上会前两处修正：删掉/软化"只被 stub 喂过"这一条（v01 有真 HTTP transport 且吃了 c37b777 契约更新，缺的只是部分门覆盖）；并入开放 issue #32（lite/lite2 引擎收敛，第一优先技术债）——其现有 tag original-lite-live-v01 @3a9cf5c 已部分覆盖提案中的回滚 tag，须交叉引用而非重复立案。

**4. put/get 不对称的快照仓库（put-get-asymmetric-snapshot-repository）**
- 主张：registry 写接口形状错了——put() 是整快照 DELETE+INSERT 而 get() 返回有损投影（source_documents.content=None），于是每条 get→改→put 路径只有在 put() 能重造 get() 丢掉的数据时才正确；已上线的 prior_bytes 回填只补了那一个已知列，bug 类仍对未来任何入快照的列/表敞开，且离线套（内存孪生无损往返）看不见。
- 证据：pg_registry.py:310-341（workaround 及其自述缺陷的注释）、:344-348（快照 DELETE）、:385-386、:415-421 与 :458（content=None）；registry.py:177-239（ProjectWriteMixin 8 个端点全是 get→改→put）；test_registry_contract.py:262-302 只钉 bytes 一列。
- 波次：关掉类而非实例——(a) 加 @needs_db 守卫测试：put→get→add_project→put 后对 avery.* 全表 dump 做前后 diff（排除 updated_at），未来任何被往返抹掉的列直接红；(b) 按代码自己的注释（pg_registry.py:330-333）落 SQL 侧 preserve（temp table + UPDATE...FROM），字节不再进 Python，32MiB 内存与上传闸的耦合消失。
- Effort：M。
- 核验按语：否证失败且发现自己还说少了——除已补的 bytes 列外，第二个实例现在就活着：get() 把 store 重建为 PgVectorStore（无 persisted_vectors、非 VectorStore 子类），于是 8 条手工 CRUD 写在已嵌入上下文上每次都全量重嵌——走计费 DashScope 调用，正是 clone_context 当初要省的钱。维持 P1，effort M 诚实。

**5. 持久层接口没有落字、双适配器已在漂（registry-interface-unwritten-two-adapters-drifting）**
- 主张：持久缝是真的（内存 + Postgres 双适配器），但接口在代码里无处存在——约 20 个方法鸭子类型横跨两类，pg 模块 docstring 还宣传 5 方法 API，漂移已可观测：Postgres 侧有 delete()（pg_registry.py:787）而内存侧没有；每个新 registry 特性手写两遍，pg 侧缺口只有 DB 门测试抓得到——离线套按设计跳过。
- 证据：pg_registry.py:3-5（陈旧 5 方法宣称）vs :272-798（真实约 20 方法面）；registry.py:705-927（孪生缺 delete()）、:955-971（active_registry 返回 "type: ignore duck-typed"）；test_registry_contract.py:92-102（parity 只经 @needs_db）。
- 波次：把接口写下来一次——在 registry.py 落 ContextRegistryProtocol 枚举全表面，加一个离线测试断言两个类实现每个成员（psycopg 在 __init__ :112 懒加载，类检查不需要 DB）；方法漂移从此在无 DB 套里就红，而不是等生产部署。顺手修 pg docstring。
- Effort：M。
- 核验按语：否证失败——所有引用行核实，且库自身两次佐证该风险：test_registry_contract.py:457-491 的离线守卫块正是因 2026-07-23 一个 pg 侧缺陷绿着上线的记录在案事故而生；pg_registry.py:89-93 记录了只在生产 demo 阵容上才暴露的 _ENTITY_KINDS 漂移——建议只是把库里已在临时使用的习语泛化。两处诚实扣分：delete() 是最弱证据（文档写明是测试/运维卫生的不对称、服务代码不调用）；ProjectWriteMixin 意味着部分表面是共享而非双写——但都不伤结构论点。P1 成立。

**6. 裸 pytest 默认不安全（pytest-unsafe-default）**
- 主张：离线 pytest 电池的安全完全依赖 agent 记得一条四 marker 反选咒语（散在文档里）；本机（eval-harness/.env 带真钥匙）裸跑 `pytest` 直接打真 API 烧钱——pytest.ini 注册了 marker 却没编码安全默认。
- 证据：pytest.ini:4-9（有 marker 无 addopts）；AGENTS.md:48（"这四个 deselect 不是可选的……漏掉就真出网烧钱"）；咒语在 6+ 处文档间复制粘贴。
- 波次：在 pytest.ini 加 `addopts = -m "not smoke and not seedgate and not needs_keys and not needs_db"`（显式 CLI -m 仍可覆盖，last -m wins），文档收缩为"默认离线，-m 显式入网"。**必须同一变更内**修 scripts/deploy/dual-smoke.sh:57 与 test_service_smoke.py docstring 7-8 行——该门按文件路径选测、无 -m，否则 addopts 让双 smoke 门腿红（exit 5）。
- Effort：S。
- 核验按语：主张端到端确认（无 addopts、无 conftest 反选、.env 在 import 时自动加载，裸 pytest 真烧钱），但原发现的风险声明"grep 显示无依赖脚本"为假——dual-smoke.sh:57 会坏；P1 仅在附带上述修补的修订版建议下成立。

### 已核验 P2

**7. 电池台账漂移（battery-ledger-drift）**
- 主张：run-battery.mjs 自居"花名册即台账"，但台账已覆盖不全 tracked 的门：E3 普查记 31 个 verify-*.mjs 现在有 42，9 个 rich-align-0722 探针既不在册也不在死件单，7 个死件文件内无死亡标记，AGENTS.md 计数也旧了。
- 证据：run-battery.mjs:28-48（死件单 7 个）、:123-158（E3 普查"31 个 tracked"）；`git ls-files "*verify-*.mjs"` → 42；AGENTS.md:47 计数陈旧。
- 波次：run-battery.mjs 内纯文档一波——刷新普查数字、加第三节"campaign 探针刻意不入册（F19）"列出 9 个文件及不能入册的原因（部分需要门中途换 env 重启后端，花名册的 backend 字段表达不了）、给 16 个文件加一行指回名单的头注释、修 AGENTS.md:47。不动断言不动顺序。
- Effort：S。
- 核验按语：核心漂移属实（台账覆盖 42 中的 33；AGENTS.md:47 陈旧），但 P1 的支点被否证：F19 裁定记录在含战役 README 在内的 5 个 tracked 文件里，不是"只在一个探针头注释里"，且 tools 目录是 20 个不是 23——新 agent 的考古成本是分钟级不是一个 session。值得做的便宜文档卫生，降 P2。

## 已否决

**v01 逃生门只被 stub 喂过（v01-escape-hatch-only-ever-stub-fed）——原 P1，否决**
- 原主张：v01 存在的唯一理由是"v02 生产坏了时的逃生门"，但所有驱动 v01 的门都注入 stub transport，601 行真 HTTP transport 自 7/19 翻转后没有任何对活后端的集成层检查。
- 否决理由：发现把 __liteStore 驱动缝误认成了 stub 注入——resolveTransport() 在 URL 无 ?transport=stub 时返回真 HTTP transport，且 tracked 电池里至少四道门（verify-answer-split-03 / room-usability / file-manifest-truth / aria-zh，run-battery A 区 backend:true）以 ?v=1&mode=live 驱动 v01 走真 601 行 transport 打 AVERY_BRAIN=mock 活后端，带 upload→ingest→advise→render 硬断言；verify-answer-split-03 甚至就是被建议要新写的那道门，早随 answer_direct 契约迁移一起上线了。仅存的窄残留：v01 的 ask save/share/revoke 端点缺活后端覆盖——但那不是这个 P1。

## 未核验附录

以下 19 条**未经对抗核验**，引用行号与结论派波次前请先自行复核。

### P1（未核验）

- **agents-md-verification-section-stale** — AGENTS.md 验证命令节还描述电池前世界、从不点名真正的门权威 run-battery.mjs，新 agent 被引向 `git ls-files` 会捞出 7 个明确宣死的危险门（verify-blockers 真会往共享后端传语料）。证据：AGENTS.md:47/49 vs run-battery.mjs:84-120、:40-56。波次：重写约 15 行，点名单一入口、删陈旧枚举、补 lint 到手工 init、一行裁定 rich-align 9 门的地位。Effort S。
- **feature-list-98pct-archive-payload** — feature_list.json 182KB 中 98% 是 77 条 done 行的证据散文，每个 session 都被迫读；同时账上缺两个已上线战役的行、状态枚举拼写漂移（in_progress vs in-progress）。证据：AGENTS.md:31/40、feat-019、progress.md:31。波次：done 行逐字搬去 feature_archive.json，原文件留一行指针；规范枚举；补两行缺账（证据用指针不编散文）。Effort M。
- **roles-md-repudiated-north-star** — roles.md 作为全体 subagent 的共享上下文，仍写着 CONTEXT.md 明文标注已被取代的商业模式（"advisor AI + tools 免费"，与 ADR-0019 无免费层冲突）和被现状（国内 sampler + 中文纯度门）打脸的"overseas first, all English"。证据：roles.md:26-27 vs CONTEXT.md:133、ADR-0019、run-battery.mjs:103。波次：改 3 行北极星块或直接指向 CONTEXT.md 商业口径。Effort S。风险：不改则 act-first 规则下 subagent 可能真发出承诺免费层的文案。

### P2（未核验）

- **link-href-invariant-comment-enforced** — sticky-query 不变量在 `<Link>` 站点只靠红色注释守着，每新增可链接目的地长一个 bespoke helper（已 3 个）。波次：收敛为单一 hrefFor() + 一条 scoped ESLint no-restricted-syntax 规则禁字面量 to=，复用 import 墙已有的机器门先例。Effort S。（routes.ts:79-96；eslint.config.js:22。）
- **nudge-clear-only-on-goscreen-path** — noteJustAdded 的"切屏即消"只清在 goScreen 动作里，`<Link>` 导航和浏览器前进后退两条路径绕过它，回 Room 时冒陈旧 nudge。波次：清扫移入 Lite2Shell 的 useEffect（keyed on useCurrentScreen()），一处覆盖三条路径；顺带可让 goScreen 系变纯透传。Effort S。（store.ts:457-460；RoomScreen.tsx:322,339。）
- **i18n-orphan-scan-not-committed** — 孤儿键现状健康（787 中 7 个，5 个是退役文案非被吃特性），但 AGENTS.md 把孤儿键定为合并吃特性的红旗，扫描器却没落库，命名空间别名还打败朴素 grep。波次：提交 scripts/i18n-orphans.mjs + 手删 5 个陈旧键（en 与 zh 都手删——M3 delta 脚本只加不删）。Effort S。
- **wire-contract-duplicated-endpoint-asymmetry-unledgered** — 两壳各持一份线协议（601 vs 1122 行），端点已不对称（revokeAsk 仅 v01、downloadFile 仅 v02、stub 语料也分叉），无任何东西区分"刻意去掉"和"被合并静默吃掉"——本库有记录在案的同款事故（AGENTS.md:57）。波次：先在四个文件头加分歧台账（每条 delta 附决策引用）；上提纯类型到 src/shared/liveContract.ts 只能走 grilling。Effort M。
- **import-wall-misses-dynamic-import** — lint 墙只拦静态 import 声明，`await import('../lite/...')` 可合法越墙（当前 grep 干净，import() 只在组合根）。波次：确认所装 eslint 是否覆盖 ImportExpression，不覆盖则补 no-restricted-syntax 同款规则，加一个故意红测试证门会响再删。Effort S。（eslint.config.js:22-26。）
- **migrations-contract-not-at-the-seam** — 迁移四条纪律（无台账全量重放、永久幂等、稳态禁 ACCESS EXCLUSIVE、新 entity kind 双处同改）只写在 pg_registry.py 里，写 0012_*.sql 的 agent 看的却是 db/migrations/，其中两条违反过已致生产事故。波次：db/migrations/README.md 约 30 行。Effort S。
- **env-example-retrieval-section-is-dead-config** — .env.example §2 记的检索缝已不存在：AVERY_RETRIEVAL 零代码读取、模板值 hashing 不是合法 kind 会静默落到 keyword、"not yet read from env" 自 feat-031 起为假——按模板开向量 RAG 的运维实际拿到 keyword 检索。波次：按活契约重写 §2（keyword|dashscope + 相关键 + 1024 维列告警），删 AVERY_RETRIEVAL 前先 grep 部署脚本。Effort S。
- **guards-interface-silent-about-deploy-override-and-ram-coupling** — guards.py 本身是深纯模块，但浅在接口没说两件烧过人的事：文档默认值不是生产实跑值（7/20 已有误读事故），以及调大 AVERY_MAX_TOTAL_UPLOAD_BYTES 会线性推高 put() 瞬时内存（该耦合只写在 pg_registry 那头）。波次：两处 docstring 补注，零行为变更。Effort S。
- **brain-timeout-applied-through-private-client** — 每调用超时靠两个工厂戳适配器私有 _client 挂上，hasattr 护栏让未来无 _client 的适配器静默退回约 600s SDK 默认——正是 feat-028 要修的 worker 挂死，且回归是无声的。波次：把 timeout_s 提为 OpenAICompatBrain/RealBrain 构造参数，工厂传参，删 _client 戳入；test_advise_timeout.py 已有覆盖。Effort S。（brain_factory.py:40-47；extractor_factory.py:69。）
- **seam-py-passthrough-fails-deletion-test** — seam.py::build_live_case_for_context 过不了删除测试：唯一调用者是它自己的测试，app.py 从未采用、反而内联重实现了同一序列——假想缝被测试养着。波次：二选一——app.py 采用它删内联版（保留 import 失败回退行为），或删函数删测试让 seam.py 缩到唯一真导出。Effort S。（seam.py:44-54；app.py:130-142,152-153。）
- **snippet-phase-groups-unrostered** — snippet 的 B/C 判定组（triage/followups/gap 推导-解决-转问）零机械化 runner，只有人工走注入协议才执行——电池全绿它们也能回归，正是"门全绿≠真部件被验到"陷阱。波次：照 verify-skin-phases.mjs 的成熟适配器模式克隆一个 verify-flow-gap-phases.mjs（约 100 行，stub transport，断言在 snippet 里原样调用），入 A 区花名册；须遵守 snippet 头注释的三个陷阱（injectSeeds 先行、关引导向导、reload 即重注入）。Effort M。
- **drive-protocol-duplicated** — live 门驱动协议双写在 snippet 373 行头注释与 gate.md 里，裁定要打两处补丁（?v=1 裁定已出现在三处）；漏一处就重造当年的自考自答陷阱。波次：把 gate.md:105 已有的"以 snippet 为准"先例扩到全协议，gate.md 逐 phase 步骤改成薄指针，只保留头注释没有的浏览器外步骤。Effort S。
- **gate-boot-boilerplate** — 各门断言各自 bespoke 是对的，但 boot/上报管线全舰队复制粘贴（39×launch、36×Escape 前奏、31×收尾），boot 陷阱在一个文件里修好、在下一个新门里再咬一次。波次：eval-harness/tools/lib/gate-run.mjs（bootPage/makeRec/finish，今日行为为默认、每处分歧为显式选项），新门强制、旧门每 session 迁几个、迁移前后各跑绿一次；断言体永不编辑。风险在大爆炸式迁移会抹平各门 boot 怪癖铸假绿假红——所以是选项化不是归一化。Effort M。
- **adr-0023-number-collision-no-index** — 两个 ADR 共用 0023（ask 红线 vs postgres 持久化），两种含义都在流通引用；33 文件的 ADR 集无索引，被取代图（0001→0020、0005→0009、0004/0012→0014 等）要靠新 agent 从文件名和正文重建。波次：postgres 篇改号 0033 留一行重定向桩、修入站引用；写 docs/adr/README.md 35 行状态表；clean-state-checklist 加一行维护义务。ADR 正文不动（不可变性）。Effort S。
- **issues-dir-no-map-live-infra-buried** — .issues 阁楼 42 目录 197 文件混三种活性（6 道电池在用的门、被引用回执、死战役笔记含 14 份陈旧交接）且无索引，战役↔feature 映射只活在 feat-093 的名字字符串里。波次：写 .issues/README.md 逐目录一行（明确标注 5 个含电池门的目录 do-not-archive），给 14 份陈旧交接加两行墓碑头；**不搬门**——多个门硬编码相对路径/端口，搬迁是另一张更险的票；删目录本身属销毁类，留给 Danny。Effort M。
- **to-issues-consumed-p7-not-archived** — 六张 P7 票早被 feat-005..010（全 done）消费完毕却仍躺在顶层，与 40 张已归档前辈并列，AGENTS.md:3 还把其中一张当活的指。波次：git mv 进 archived/（移动非删除，不需要 Danny 闸），同一提交修 AGENTS.md 指针。Effort S。