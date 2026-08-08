# 资料库屏（FilesScreen）全量 UX 侦察 · redesign-0808

> 只读侦察，零代码改动。目标：给「对齐 Claude.ai / Notion 型资料管理」的重构 session 提供"别重新侦察"级别的底图。
> 所有断言带 file:line。行号基于 main @ a49d4e7（2026-08-08）。
> 本体：`src/lite2/screens/FilesScreen.tsx`（631 行）。路由 `/files`（Lite2App.tsx:155，SCREEN_COMPONENT 注册 Lite2App.tsx:227）；tab 在顶栏队尾（LiteTopbar.tsx:150，数组 121-151）。

---

## 1. 页面分区全量清单（从上到下，以实际代码为准）

整屏 = `section.scene.lite-files` > `div.lite-files-scroll`（滚动壳，lite2.css:7551-7556，position:absolute+inset:0+overflow-y:auto，overflow-x:hidden）。内容单列，`width: min(100%, 820px)` 居中（lite2.css:7558-7563）。屏设计意图注释在 FilesScreen.tsx:10-27（files-hub-0729/01，ADR-0032："四段"）。

### 1.0 页头（FilesScreen.tsx:563-567）
- eyebrow「资料库」+ h2「资料库」+ 副标（zh.ts:504-506）。顶距吃 `var(--lite2-clear-top)`（96px/72px/24px 三档，lite2.css:7544-7546、7565-7567）——胶囊顶栏浮在内容上，动这个变量九屏连坐。

### 1.1 ① 当前资料（FilesScreen.tsx:573-582）
- 有文件 → `<FileManifest withDownload />`；无文件 → 两句空态二选一：无 contextId=「还没传过材料…」（zh.ts:508），有 contextId=「这一批里 Avery 没列出任何文件…」（zh.ts:509）。
- **FileManifest（FileManifest.tsx:102-204）**：从 UploadPanel 抽出的共享件（抽取理由=孤儿键事故，14-18 行明写 DOM 类名一个字节不许动：`.upload-files/.upload-files-title/.upload-file-row/.upload-file-name/.upload-file-meta/.upload-file-status/.upload-file-status-hint`——门按类名取样）。
- 每行渲染：文件名 + `formatBytes(size_bytes)` + `n_chunks 处引用` + 状态徽章（ingested/empty/failed/unknown 四态，fileStatusView FileManifest.tsx:47-58；「缺席≠成功」：老后端不发 status 显「状态未知」）+ 逐行「下载」钮。
- 下载：fetch→Blob→objectURL（端点吃 owner_token header，裸 `<a href>` 必 404——FileManifest.tsx:112-140、transport.ts:768-778）。一次一份，其他行置灰（181）；失败逐行红一句（193-197）。`withDownload && contextId` 才渲染按钮（144）。
- ⚠ 后端 payload 里有 `mime/doc_kind/uploaded_at`（LiveFileEntry，transport.ts:500-509）**前端全部不渲染**——清单没有上传时间列、没有类型图标。
- ⚠ 顶部双标题：小节标题「当前资料」下面紧跟 FileManifest 自己的 `.upload-files-title`「你的文件」（zh.ts:221）——两层标题说同一件事。

### 1.2 ②a 给这家公司补资料（AppendSection，FilesScreen.tsx:45-69，渲染点 596）
- T10 append 模式。三条否决任一成立整段（含标题）消失：① 无 contextId；② `rawTeam.ephemeral`（demo 克隆）→ 只显一句「示例团队副本留不住」说明（54-61，zh.ts:516）；③ transport 无 `appendFiles`（stub/老后端，能力探测 50）。
- 有效时 = 一句 lede（zh.ts:515）+ `<UploadPanel showFiles={false} mode="append" />`（66）。

### 1.3 ②b 另建一份画像（FilesScreen.tsx:608-615）
- honey 左边条「诚实说明」块（`.lite-files-again`，lite2.css:7612-7631）：「这个口子会另起一家公司」+「…要给现在这家补资料，用上面那个口子」（zh.ts:234-235）。注释 598-607：这两条 copy 曾整族孤儿键，改口原因（T10 之后"合并"存在了）。
- `<UploadPanel showFiles={false} />`（mode='new'，每次 POST /ingest 新铸 context+token）。

### 1.4 UploadPanel 本体（两处实例共用，UploadPanel.tsx:75-298）
- dropzone（拖拽+点击+键盘 Enter/Space，139-194）+ 「选择文件」主按钮 + accept 白名单 `.pdf,.docx,.xlsx,.csv,.tsv,.md,.markdown,.txt`（28 行，🔴 与后端 guards.SUPPORTED_EXTS 成对同步）+ 三行「支持哪些格式」说明（185-193）。
- 状态区（196-272）：见 §3。
- **每个实例底部还各带**：隐私一句（281，zh.ts:219）+ 两条去 `/paperwork` 的链接「不知道该发什么？拿一份标准表单」「你上传的内容，我们怎么处理」（288-295，zh.ts:253-254）。→ **本屏这套家具出现两遍**（②a 一遍、②b 一遍）：两个 dropzone、两条隐私句、四条 paperwork 链接、两块格式说明。
- **模板下载不在本屏**：标准表单/法律文件的下载区在 `/paperwork` 独立页（PaperworkScreen.tsx:117-135，`<a download>` 静态文件），本屏只有这四条入口链接。

### 1.5 ③ 你上传过的几批（SwitchSection，FilesScreen.tsx:31-41，渲染点 621）
- 多库切换。`knownContexts.length < 2` 整段连标题消失（34；KnownContextList.tsx:39 同判据双保险）。
- KnownContextList（KnownContextList.tsx:28-148）：名册存 localStorage `lite2:knownContexts:v1`（store.ts:115），每行=文件名 chips + 本地化日期 + 「当前」标记；行动作=「切换」（当前行不给，117-127；任一行 pending 全列表置灰防并发）+「从这个列表里移除」（129-136，🔴 forgetContext 唯一调用点，只许显式点击）。错误横幅在列表上方、三种失败三句话（71-75，41-48）。底部一句「移除只去掉本机入口，服务端不删」（145）。

### 1.6 ④ 常驻表单（StandingFormsSection，FilesScreen.tsx:122-547，渲染点 627）
两条否决整段消失（200-201）：无 contextId / `formTemplates === null`（stub 通道没有 fetchForms、或拉失败——404 不承载存在信息）。内部从上到下：
1. 标题「常驻表单」+ lede（292-294，zh.ts:525-526）。
2. **T9 自动补铸横幅**（301-305）：「{period} 的链接已经按你上期发过的名单备好了（{count} 人）…下面就可以改」（zh.ts:559）——仅当服务端**这一次**真的铸了行（`auto_filled` additive key）才出现。
3. **模板列表**（311-344）：每张表=选择按钮（只有 ≥2 张才给切换按钮，单张显纯文本 317-331）+ 题面预览一行（label 用 `·` 串起，314；⚠ lite2.css:7780-7791 注释：这行会被 `.lite-files-scroll` 的 overflow-x:hidden **静默裁掉**，无省略号）。
4. **模板拼装器 FormBuilder**（350，FormBuilder.tsx 全文件）：折叠态三入口（「建一张表」/「照『X』改一张」逐模板/「让 Avery 读一份你们的旧表格」——起草入口仅 files.length>0 时出现 195-205）+ 逐模板「改『X』」编辑入口（226-239）。展开态=内联编辑器（不是模态，理由 FormBuilder.tsx:41-43）：表名、逐题编辑（题型 select/必填/选项/数字上下界/说明行/三个语义开关「哪儿卡住了/有多忙/状态」+ 答案去向说明 514-559）、**已被答过的题禁改题型禁删、只给「停用」**（561-585，服务端 gate_used_fields 第二把锁）、加一题（上限 12 镜像）、撤下整张表、保存/取消。起草回执诚实标注 origin（llm/heading）+ dropped 列清单（370-395）。
5. **选人 + 生成链接区**（354-448）：`selected && roster.length>0` 才渲染。人名 chips（aria-pressed 多选，358-384；重名者补部门小字 165-169）→ 选中后若有项目卡出现**逐人**「关于哪个项目」下拉（390-431，value 用项目标题不是 id，418-419）→「生成本期链接」主按钮（432-441，busy/空选置灰；真闸在 store，端点不幂等 store.ts:1135-1149）→ 错误一句三选一（282-289，zh.ts:552-554）。
6. **刚铸的链接区**（452-486）：`formsMinted` 有货才出。逐人一行：姓名 + 完整 URL（`<code>` 可见可选正文，服务端拼好的整链 461-471）+ 逐行「复制」（clipboard 降级 execCommand，247-265）。底部一句「链接由你自己转发…一人一链，七天过期」（484，zh.ts:542）。**没有"复制全部"**。
7. **谁交了区**（490-544）：`statusRows.length>0` 才出。只显**最新一期**（period 取数据里字典序最大的，176-179，刻意不按本机时钟算）。逐人一行：姓名 + 「关于 {project}」（绑了才显）+ 提交时刻（本地时区换算 localStamp 93-98，UTC 陷阱碑）+ 状态徽章（已交/还没交/链接过期了/状态未知）+ 「撤回」钮（仅 status==='open'，528-538，无确认弹窗，撤回=服务端把到期拨到此刻）。⚠ `answers` 在 payload 里（with_answers=True，form_api.py:352）**本屏不渲染**——经理在这屏看不到员工写了什么，要去人卡/项目卡看回流。

### 1.7 悬浮「问 Avery」胶囊（AskAveryLauncher）
- 挂在壳层 `.scene-stage` 兄弟位（Lite2App.tsx:196-199），position:fixed z-45。本屏**渲染**（只在 room 屏收起 AskAveryLauncher.tsx:77；contextId===null 整块不出 :72）。点开=底部输入条，submit 走 `goScreen('room',{q,refs})` 中继预填、不自动发（79-84）。

### 1.8 进入本屏的入口（改 IA 时要一起理）
- 顶栏 tab 队尾（LiteTopbar.tsx:150）；今天页差距摘要块按钮（HomeScreen.tsx:424）；项目屏按钮（ProjectsScreen.tsx:423）；铃铛 'form' 通知点击跳本屏（notifyStore.ts:44 NOTIF_TARGET，LiteBell.tsx:125）；onboarding 上传步链接到 /paperwork（不是本屏）。

---

## 2. 信息层级问题

1. **整页就是一长条单列堆叠**。六块内容（头/①/②a/②b/③/④）全部 `min(100%,820px)` 单列（lite2.css:7558-7563），块间距只有 34px（7583-7585），末段 padding-bottom 90px（7588-7590）。**没有任何**分区导航/锚点/目录/折叠/sticky 小标题——FilesScreen.tsx 全文无 nav 元素，CSS 无对应语法。顶栏搜索（LiteSearch）只搜人和项目，**不搜文件**（LiteSearch.tsx:4、40，searchTeam 只吃 team）。
2. **视觉权重与使用频率倒挂（区内）**。④ 常驻表单是全屏最大的一块（模板列表+拼装器+chips+逐人下拉+链接区+状态区，FilesScreen.tsx:291-545 共 250+ 行 JSX），而经理周中最高频的动作「看谁交了」被压在这一块**最底部**（490-544）——要滚过建表入口、选人 chips、绑项目下拉才到。铸链本身是**一周一次**的低频动作，却占据 ④ 的黄金位。
3. **上传家具双份**。②a 和 ②b 是同一个 UploadPanel 的两个实例，视觉上几乎一样（同 dropzone、同按钮、同格式说明、同隐私句、同 paperwork 链接对）——语义却是「并进当前公司」vs「另开一家公司」两个方向相反的动作，只靠标题一行 + honey 说明块区分（FilesScreen.tsx:598-607 自己承认这堵墙的历史）。中间只隔 34px。
4. **页面形状不稳定**。②a（三否决）、③（<2 批）、④（stub/无 contextId）都会整段静默消失（FilesScreen.tsx:52-54、34、200-201）——同一个屏在 demo 克隆、stub、token 失效、新公司四种状态下长四种样子，且**没有任何一处**解释「为什么这段没了」（除 ephemeral 有一句 demoNote）。
5. **滚动长度**：满数据态（5 文件+6 人+2 模板+一批链接+一期状态）目测 4000px+ 桌面滚动；手机上 chips 换行 + 逐人下拉逐行堆叠更长。`.lite-files-forms-chips` 刻意不设 max-height（lite2.css:7737-7743 注释：不在滚动壳里再开一根滚动条）——60 人酒店花名册会渲染 60 个 chips 的巨墙，无搜索/无按部门分组/无全选。
6. **双标题**（§1.1 已述）+ ② 段两个小节标题「给这家公司补资料」「另建一份画像」在词面上不构成对立（「补」vs「另建画像」），经理需要读完 body 才知道方向相反。

---

## 3. 状态反馈

### 3.1 上传等待态（100–120s 真实耗时）
- 三层诚实等待（UploadPanel.tsx:196-216）：① 预期一句「正在逐页通读你的文件，通常需要两三分钟。请保持页面打开。」（zh.ts:213）；② **活秒表**「已用时 {seconds} 秒」——锚点在模块级单例 `shared/ingestClock.ts`（29-52），跟着这一发 ingest 活、不跟组件活（换屏/换步 remount 第一帧就是真值，66-91）；③ 不定量动效条（CSS，尊重 reduced-motion）。秒表+动效整块 aria-hidden（199-201，防读屏每秒刷屏）。
- **刻意没有百分比进度条**：`/ingest` 不吐进度信号，假进度条会卡 90%（UploadPanel.tsx:41-45 注释明写）。改版若要进度条，是**后端契约变更**（SSE/轮询进度端点），不是 UI 活。
- busy 期间开选择器的唯一入口 openPicker 被闸死（含键盘路径，120-129——双发 ingest 会新铸 context 且旧 token 永久丢失）。
- 站内切屏**不打断** ingest（状态在模块级 store，UploadPanel.tsx:287 注释），完成后铃铛响 'ingest' 通知——但屏上文案「请保持页面打开」没告诉经理"可以先去别的 tab 逛"。

### 3.2 append 与 new 两条独立状态机
- `appendStatus/appendError/appendReceipt` vs `ingestStatus/ingestError`（store.ts:309-313、UploadPanel.tsx:89-96）——借用会发假通知（notifyStore 只认 ingest 的 ingesting→ready）。
- append 完成态：「新资料已经并进来了」+ **只列这一趟**加进来的文档 chips（服务端最终 source_key，同名补传会是 `周报(1).md`——UploadPanel.tsx:222-236）+ 冲突计数一句「有 {count} 处和旧资料对不上，去『今天』页看两边分别怎么写的」（250-254，zh.ts:241）。0 冲突什么都不写（absent≠none）。
- ⚠ **②b 的常驻怪相**：restoreSession/refreshTeam 成功后 `ingestStatus='ready'`（store.ts:820、1014），于是「另建一份画像」面板**永远**显示「团队已就绪」+「取材自: [当前公司文件 chips]」（UploadPanel.tsx:217-246）——一个用来"另开新公司"的口子，常驻展示着**当前公司**的就绪状态和文件清单，与 ① 段清单冗余且语义错位。
- ⚠ append 进行中时 ②b 的 dropzone **不置灰**（busy 各读各的状态机）——两分钟等待里经理可以在下面那个框再发一发 /ingest，当场开出第二家公司。

### 3.3 文件清单的加载/空态
- `files` 初值 []，本屏不读 `restoring`/`switchPending`——回访者第一帧、切库瞬间都会**闪现**「这一批里 Avery 没列出任何文件…」空态文案（FilesScreen.tsx:553-581），fetch 落地才换清单。没有 loading 骨架/spinner。
- refreshFiles 静默吞错（store.ts:1023-1033）：拉失败=清单停在旧值或空，屏上无任何错误提示。

### 3.4 表单区的刷新机制（「谁交了」怎么变新）
- 唯一的拉取挂在「打开资料库屏」上：useEffect([refreshForms, contextId])（FilesScreen.tsx:152-157，刻意不进 uploadFiles/restoreSession 扇出——GET /forms 首调会写内置模板，transport.ts:790-793）。
- 之后仅两处回拉：铸链成功后（store.ts:1167）、撤回后（1117/1128）。**没有轮询、没有手动刷新按钮**——员工交了表，经理这屏不动就永远是旧的；要靠切走再切回来触发 remount。铃铛 'form' 通知（有人交了/自动备好）也**只在 refreshForms 跑过之后**才会 push（notifyStore.ts:262、273）——不开这屏就不响。
- T9 自动补铸是**读时写**：GET /forms/submissions 服务端顺手按上期名单铸本期（form_api.py:316-348，拍板明令不引 cron）。⚠ 改版若加轮询/自动刷新，等于把这个写副作用变成常态后台流量——要先动后端语义。
- 拉失败静默（store.ts:1064-1099 吞错是 tokenDiscipline 门要求）：formTemplates 停 null → **整个 ④ 段消失**，经理看到的是"表单功能不存在"，与 stub 通道不可区分，无任何报错。

### 3.5 写路径反馈
- 铸链：按钮「正在生成…」+ store 闸防同拍双击（端点不幂等=每人收两条链接，store.ts:1135-1149）；422/409/410/其他 → 三句人话（zh.ts:552-554）；切公司途中忙态必回收（1152-1163 碑）。
- 撤回：逐行「正在撤回…」（formsVoiding 单飞行），409（已交）不报错、静默回权威清单让那行自己变「已交」（store.ts:1124-1128）。
- 复制：逐行「已复制」（copiedId，无超时复位，换行复制才移走）；clipboard 被拒降级 execCommand，两级都败链接仍可手动选（FilesScreen.tsx:245-265）。
- 保存模板：忙态/四种错误码各一句 + 服务端 detail.reason 原文当诊断挂括号（FormBuilder.tsx:342-366）；本地形状问题**按过一次保存后**才显（93 行注释），逐条用题号指路（issueText 641-688，zh.ts:622-639）。
- 切库：行内 pending +错误横幅在列表上方三句分型（KnownContextList.tsx:41-48、71-75）。
- 下载：逐行 pending、失败逐行红句（FileManifest.tsx:135-139、193-197）。

---

## 4. 与后端契约（改 IA 时哪些不用动 / 哪些要动）

### 4.1 本屏消费的全部端点（transport 方法 → HTTP → 后端落点）
| store/transport | HTTP | 后端 | 备注 |
|---|---|---|---|
| uploadFiles→ingest | POST /ingest | ingest_api.py:289 | 新铸 context+owner_token（transport.ts:1212-1229） |
| appendFiles | POST /team/{id}/files | ingest_api.py:741-845 | T10 补资料；回执 `appended{documents,skipped,parse_errors,conflicts_added}`；不回 token（transport.ts:1237-1247） |
| refreshFiles→fetchFiles | GET /team/{id}/files | ingest_api.py:848-863 | file_cards()：idx/filename/size_bytes/mime/doc_kind/uploaded_at/n_chunks/status |
| downloadFile | GET /team/{id}/files/{idx} | ingest_api.py:866-893 | attachment+nosniff，字节永不内联渲染；**预览功能=后端新活** |
| refreshForms→fetchForms | GET /team/{id}/forms | form_api.py:129-142 | ⚠ 首调会写（ensure_builtin_templates 铸内置周报，幂等） |
| saveFormTemplate | POST /team/{id}/forms | form_api.py:145-199 | 三道门：形状 422 / 红线（打分题面拒收）/ gate_used_fields（已答 field.id 禁改删） |
| createFormLinks | POST /team/{id}/forms/{tpl}/links | form_api.py:202-245 | **不幂等**；1..30 人；服务端拼整链（AVERY_PUBLIC_BASE，前端绝不自拼） |
| fetchFormSubmissions | GET /team/{id}/forms/submissions | form_api.py:306-358 | ⚠ T9 读时写（自动补铸本期）；`auto_filled` additive key；有 template_id/limit 查询参前端**未用**（全量拉回客户端过滤 FilesScreen.tsx:176-179） |
| voidFormLink | POST .../submissions/{sid}/void | form_api.py:361+ | 撤回=到期拨到此刻；409=已交 |
| draftFormFromFile | POST .../forms/draft-from-file | form_api.py:264-303 | 提案不落库（template.id 恒空串）；⚠ file_index 是**位置**不是稳定键，append 会改（transport.ts:684-686） |
| switchContext→fetchTeam | GET /team/{id} | ingest_api.py:434 | 切库=整套 refresh 扇出（store.ts:962-972） |

鉴权全族：owner_token header（X-Avery-Token/Authorization）或账号 header；缺/错一律 404 无枚举 oracle（transport.ts:1465-1468 碑：404≠「没有表单」，空清单只能来自 200+[]）。

### 4.2 纯 UI 重排（信息架构/分区/折叠/锚点/排序/搜索）——契约零变动
- 分区导航、折叠、把「谁交了」提到 ④ 顶部、合并两个上传口为一个带模式切换的口子、复制全部链接、文件表格视图/客户端排序/客户端搜索、显示 uploaded_at/doc_kind（**数据已经在 payload 里**，只是没渲染）、按 period 分组显示历史提交（fetchFormSubmissions 已回最多 200 行全期数据，前端现在只显最新一期）。
- ⚠ 但类名即契约：`.upload-files` 族、`.upload-panel`、`.upload-input`、`.upload-ready` 等被门当选择器钉着（见 §7），重排保留类名或同 commit 改门。

### 4.3 要动组件逻辑（前端状态机）不动后端
- loading/空态分离（读 restoring/加 filesLoading）、forms 拉失败的可见错误态（现在静默消失）、②b 的 ready 态错位、手动「刷新」按钮（复用 refreshForms/refreshFiles）。

### 4.4 要动后端
- 删除/重命名/替换文件：**写端点整批缺席**（FilesScreen.tsx:24-27 v1 红线：不建假按钮）。
- 文件预览/内联查看：现在 attachment+nosniff 是安全设计（ingest_api.py:888-893），预览需要新的安全渲染通道。
- 上传进度条：/ingest 无进度信号（UploadPanel.tsx:41-45）。
- 「谁交了」轮询/推送：GET submissions 有 T9 写副作用，高频轮询要先拆读写（form_api.py:316-330 拍板不引 cron）。
- 提交答案在本屏展开阅读：answers 已在 payload（form_api.py:352），纯 UI 可显——但「重新入库」按钮（POST .../{sid}/ingest 后端有，form_api.py:750）**刻意未接**：回执无归档字段，做不出诚实按钮（FilesScreen.tsx:114-117）。
- v01 壳（src/lite）没有这 17 个 v02 端点方法（transport.ts:704-726 分歧台账）——本次重构只动 lite2 即不涉。

---

## 5. 对照 Notion/Drive 型资料管理的差距清单

| 能力 | 现状 | 证据 / 补法档位 |
|---|---|---|
| 文件表格视图（多列） | **无**——flex 行内堆叠，名+大小+引用数+状态 | FileManifest.tsx:150-199；纯 UI |
| 排序（时间/大小/名称） | **无**——恒按 idx（上传序） | 同上；纯 UI（uploaded_at 已在 payload） |
| 文件搜索/过滤 | **无**——顶栏 LiteSearch 只搜人/项目 | LiteSearch.tsx:40（searchTeam 只吃 team）；纯 UI |
| 上传时间/类型列 | **半**——数据有（transport.ts:500-509），UI 不渲染 | 纯 UI |
| 文件详情/预览 | **无**——只有下载；字节 attachment+nosniff 禁内联 | ingest_api.py:888-893；预览=后端新活 |
| 删除/重命名/替换 | **无**——后端写端点缺席，v1 红线不建假按钮 | FilesScreen.tsx:24-27；后端 |
| 文件夹/标签/分组 | **无**——平铺一列 | 纯 UI（分组）或后端（真标签） |
| 分区折叠/collapse | **无**——六段全展开 | lite2.css:7583-7590；纯 UI |
| 锚点/页内导航 | **无** | FilesScreen.tsx 全文；纯 UI |
| 批量操作/多选 | **无**（下载还刻意一次一份） | FileManifest.tsx:116；纯 UI+组件逻辑 |
| 整页拖拽上传 | **半**——只有 dropzone 区域接拖拽 | UploadPanel.tsx:139-158；纯 UI |
| 逐文件读取状态徽章 | **有**（四态+缺席≠成功，比 Drive 还诚实） | FileManifest.tsx:47-58 |
| 操作就近 | **半**——下载贴行 OK；表单区「谁交了」离铸链/撤回入口一整屏 | FilesScreen.tsx:354-544；纯 UI |
| 空态引导 | **有**（两种空态分型 + 每段自己的 lede） | zh.ts:508-509 |
| 一键复制全部链接 | **无**——逐行复制 | FilesScreen.tsx:452-486；纯 UI |
| 表单历史（往期） | **无**——只显最新一期，往期数据已在 payload | FilesScreen.tsx:176-179；纯 UI |
| 提交内容就地阅读 | **无**——answers 在 payload 不渲染 | form_api.py:352；纯 UI |
| 花名册选人搜索/全选/按部门 | **无**——全量 chips 墙 | FilesScreen.tsx:358-384 + lite2.css:7737-7743；纯 UI |
| 最近使用/常用置顶 | **无** | 纯 UI |

---

## 6. 「反人类」点指认（站在酒店总经理视角）

**【纯 UI】**
1. 一周一次的「铸链发周报」占了半屏，天天要看的「谁交了」压在整页最底（FilesScreen.tsx:490-544）——每次都要滚过建表器和 chips 墙。
2. 30 个人 30 次「复制→切微信→粘贴→回来」，没有复制全部/导出文本（452-486）。
3. 文件清单没有时间列：传过三批之后分不出哪份是上周的（数据在 transport.ts:506，UI 丢弃）。
4. 60 人 chips 墙没有搜索/部门分组/全选（358-384；lite2.css:7737 刻意不限高）。
5. 「问这几格：」题面预览超宽被静默裁掉，无省略号（lite2.css:7780-7791 已知问题）。
6. 铸完链接不滚动定位到链接区，链接区和按钮之间还隔着可能出现的错误行（432-486）。
7. 「当前资料」+「你的文件」双标题（FilesScreen.tsx:574 + FileManifest.tsx:148）。

**【需组件逻辑】**
8. **两个几乎一样的上传框方向相反**：传错口子=数据分家成两家公司，全靠一行 honey 说明防（598-615）。合并为单口子+显式模式选择是组件逻辑活（两条状态机已分好，store.ts:309-313）。
9. 「另建一份画像」面板常驻显示当前公司的「团队已就绪+取材自」（store.ts:820 + UploadPanel.tsx:217-246）——语义错位（§3.2）。
10. 「谁交了」不开这屏永不更新、铃铛也不响（refreshForms 只挂屏 mount，FilesScreen.tsx:152-157；notifyStore.ts:262）；没有刷新按钮。
11. forms 拉失败=④ 段无声消失，token 失效的经理以为功能没了（store.ts:1064-1075 + FilesScreen.tsx:201）。
12. 文件清单首帧闪空态文案「Avery 没列出任何文件」（无 loading 态，FilesScreen.tsx:553-581）。
13. append 进行中另一个 dropzone 不置灰，两分钟里能误开新公司（§3.2）。
14. 撤回无确认（528-538）——低危（可再铸）但员工侧链接当场死。

**【需后端】**
15. 传错文件删不掉：没有删除端点（FilesScreen.tsx:24-27）——经理传了含工资的表只能整库重开。
16. 上传 100–120 秒只有秒表没有进度/分文件状态流（/ingest 无进度信号）。
17. 员工交的原话在本屏看不到（answers 渲染是纯 UI，但「重新入库」闭环缺后端回执字段，form_api.py:225-238）。
18. 「谁交了」实时性：读时写（T9）语义下不能裸轮询（form_api.py:316-330）。

---

## 7. 改版保护清单（动布局前必读；哪些门钉着这一屏、动什么必红）

### 7.1 像素基线（zone B，run-battery `visual-baseline`）
- `eval-harness/visual/visual.spec.mjs`：36 张**全空态**（9 屏×2 皮×2 视口，'files' 在 SCREENS 名单 :24）→ 本屏空态 4 张（aurora/paper × desktop/mobile）。**动本屏任何可见布局（含页头/空态文案/段落间距）这 4 张必红**，重冻在 main 上做（memory：worktree 里重冻=没重冻）。⚠ 首处不匹配即中止整条（:13-15），一次红跑清单不完整。
- `visual-data.spec.mjs` 数据态 12 张只采 home/team/projects（:48）**但用本屏做播种驱动**：`goScreen('files')` + `input.upload-input` + 等 `.upload-ready`（:77-81）——**改掉这三个类名/流程 = 12 张数据态全部起不来**，红的样子是"上传失败"不是"你的屏改了"。

### 7.2 live-frontend-gate（scripts/gates/live-frontend-gate.snippet.js）
- `assertFilesSurfaceV2`（:2968-3006）：点 'Files' tab → `.upload-files` 存在、`.upload-file-row`>0、每行 `.upload-file-name` 非空 + `.upload-file-meta` 含数字且 /chunk|reference/i。**改清单 DOM 类名或 meta 文案格式必红**。
- `.upload-panel` 圆角探针在 Files 屏读（:2780）；「上传口在 Files 不在 Team」的断言（:2611、:556）。
- `assertV2Boots` 期望 8-tab 数组（:47、:1523-1548）——**动 tab（增/删/重排/改名）必须同 commit 改门**（LiteTopbar.tsx:127-129 碑），机械 runner 是 `verify-v2boots`。
- ⚠ memory：这个 snippet 不在 `*verify-*.mjs` glob 里，是改判扫描暗区。

### 7.3 zone A 行为门（eval-harness/tools/run-battery.mjs；全是「绝不能排在 C 区之后」的上传型门）
| 门 | 钉着本屏什么 |
|---|---|
| `verify-file-manifest-truth`（:126，30 判据） | 真传好文件+坏 PDF → 清单状态徽章三态 + briefing 诚实句。**动 FileManifest 行内结构/状态渲染必碰** |
| `verify-context-switch`（:128，15 判据） | ③ 段：名册两行、当前标记、点「切换」换库+防双击（只打一次 /team）、点「移除」少一行、**源码级断言 forgetContext 无自动调用点**。动 KnownContextList 按钮/类名必碰 |
| `verify-append-story`（:134，五段剧本） | ②a 段：appendFiles 接线（contextId 不变）、资料库多一行（服务端 source_key）、卡片新值+出处角标、冲突上今天页。动 AppendSection/UploadPanel append 路必碰 |
| `verify-forms-proactive`（:132，19 判据，显式 ?lang=zh） | ④ 段：T9 横幅**中文原句**、「谁交了」行、铃铛 'form' 通知跳本屏、员工填→已交、撤回→过期且不复铸、已交行无撤回钮。**改 formsAutoFilled/状态词文案或状态行 DOM 必红** |
| `verify-form-builder`（:136，43 判据） | 拼装器全生命周期：三入口/四控件/上限镜像句/已答 field.id 禁改删只给停用/三开关往返/起草是提案。⚠ 题面在 `<input value>`，hasText 采不到 |
| `verify-topbar-clearance` | 9 屏×2 皮顶栏让位几何**含本屏**——动 `--lite2-clear-top` 消费或页头必碰 |
| `verify-contrast-smalltext` | AA 4.5 硬地板，真上传后采样——本屏新增小字号文本会被采 |
| `verify-bottom-furniture-clearance` | 悬浮「问 Avery」胶囊 elementFromPoint 真命中——动屏底/launcher 区必碰 |
| `verify-aria-zh` / `zh-purity` | aria-label 中文扫描；innerText 英文残留扫描。⚠ 铸出的链接 URL 是英文残留的定时雷：今天不红只因种子语料抽不出 team.people、④ 段整段不渲染（FilesScreen.tsx:461-470 碑：正解是加"用户数据"豁免，不是藏链接/放宽词表）。**改版若让像素/纯度门采到数据态 forms 区，这条会炸** |
| `verify-button-family` | 本屏新按钮必须挂 `.lite-btn` 或进白名单 |
| `verify-onboard-gate` | OnboardGate 全屏闸盖在所有屏上（含本屏）——动壳层弹层家族才碰，动本屏内部不碰 |

### 7.4 i18n / 其他
- 本屏是 `t.upload.*` 38 键唯一落屏点（visual.spec.mjs:19-21 注释）——**砍 UI 段落必产孤儿键**，AGENTS.md「孤儿文案键是红旗」；砍前跑 `scripts/i18n-orphans.mjs`（只读那支；`i18n-zh-lite2-delta.mjs` 会整个重写 zh.ts，别碰——memory）。
- ACCEPT 白名单与后端 `guards.SUPPORTED_EXTS` 成对（UploadPanel.tsx:27-28）；MAX_FIELDS/MAX_CHOICES/0..100 与服务端镜像（formShape.ts ↔ form_api.py）。
- 中文长度闸按显示宽度不按 .length（memory #69 实收）。
- 门环境三件套：build+preview（stub 参数在产物上是死的，store DEV 闸静态 false）、`--mode development` 不能省、preview 要 `--host`；A→B→C 铁律，上传型门绝不排 C 区之后（dist 会被 bundle-privacy 换成生产域名）。

### 7.5 「动什么必红」速查
- 动清单行 DOM/类名 → filesSurfaceV2 + file-manifest-truth + visual-data 播种链 + 像素 files×4。
- 动 ④ 段文案/DOM → forms-proactive + form-builder（+ zh-purity 若数据态被采）。
- 动 ③ 段 → context-switch。
- 动 ②a → append-story。
- 动 tab/页头/滚动壳 → v2boots + topbar-clearance + 像素全量。
- 只动分区顺序/加锚点导航（不动段内 DOM）→ 理论上只红像素 files×4 + 可能 topbar-clearance/bottom-furniture 几何——**这是重构代价最低的第一刀**。

---

## 附：本屏文件索引
- `src/lite2/screens/FilesScreen.tsx`（屏本体 631 行）｜`src/lite2/UploadPanel.tsx`（299）｜`src/lite2/FileManifest.tsx`（205）｜`src/lite2/KnownContextList.tsx`（149）｜`src/lite2/FormBuilder.tsx`（689）｜`src/lite2/formShape.ts`（上限镜像）｜`src/lite2/AskAveryLauncher.tsx`（116）｜`src/shared/ingestClock.ts`（92）
- store：`src/lite2/store.ts`（files/append/switch/forms 全部 action，行号见 §4）｜transport：`src/lite2/transport.ts`（契约+端点台账）
- 文案：`src/shared/i18n/zh.ts` upload 族 :207-261、files/forms 族 :503-563、builder 族 :571-639（en.ts 同键）
- 样式：`src/lite2/styles/lite2.css` :7540-8060（屏+切换+表单）、:8342-8580（拼装器）
- 后端：`eval-harness/service/ingest_api.py`（/ingest :289、append :741、清单 :848、下载 :866）｜`eval-harness/service/form_api.py`（forms 全族 :129-770、员工 H5 :690/:707）
- 门：§7 全列。
