# 全天改动对抗性复审 · 2026-07-20

5 个独立视角并行复审 → 每条发现由 2 名独立怀疑者尝试证伪 → 共提出 26 条，幸存 13 条（13 条被证伪剔除）。

# 7/25 复审汇总 —— 按「三家公司拿真文件来试」的实际影响排序

先说结论口径：**问题最重的一批不在今天写的代码里，而在今天上线的那四个「最小子集」后端镜像里。** main 上很多修复已经写好了，但生产镜像是从 7/18 一条旧分支叠出来的，那批修复一次都没进过线上。前端今天的改动整体是好的，剩的都是观感级。

---

## 一、会让客户看到假事实的（生产镜像，7/25 大概率撞上）

**1. 中文「未按时完成」被读成「已完成」**
`extract.py` 的中文完成词只挡住紧挨着的一个否定字。实测：未完成 / 没完成 会被挡，但 **未能完成、无法完成、未按时完成、还没有完成、没有完成** 全部读成 done。
客户怎么撞上：周报写「状态：未按时完成」→ 卡片显示已完成，还顺手把逾期、进度过低这些告警一起静音（那几条规则都有「已完成就不报」的守卫）。
建议：**必修，上线前**。main 已经改好（`_zh_states` + 否定扫描），把这块补进生产镜像即可。

**2. 中文的「阻碍项 / 风险」压根读不到，项目直接被判「可推进」**
今天刚让中文状态词生效（进行中 → on-track），但抓阻塞和风险信号的正则还是纯英文的，中文标签行一条都进不去。于是「状态：进行中 + 阻碍项：等待法务确认 + 风险：人手不足」这份文件，风险为空 → 判「可推进」。更难受的是：正向词一命中，那条唯一会扫全文找风险词的兜底就永远不跑了。
限缩一句：线上默认走大模型抽取，这条主要在**降级到规则抽取时**发作（超时、限流、预算耗尽、某篇没抽出实体都会逐篇回落，是常态机制不是异常）。
建议：**必修**。main 有这行中文阻塞正则，一并带上。

**3. 首页说「需确认」，团队页说「没有风险信号」——同一份数据两套规则**
生产镜像里 briefing 还在用一套老的弱判断（只认 status 是 at-risk/blocked），而 decisions 已经走完整规则表。结果客户点两下就能看见系统自己打自己：决策列表列着「需确认 + 阻塞原文」，团队页正下方写「文件里没有读出风险信号」。注意这不是同一屏上下两行，是隔一次点击。
另外：只要有一张卡不是「可推进」就可能触发，触发面不窄。
建议：**必修**。main 的 briefing 已经统一到一套规则，且它的注释就是在骂这个 bug。

**4. 坏文件和读全了的文件在「你的文件」里长得一模一样**
后端每个文件都发了状态（读入 / 空 / 失败），前端一个都不渲染，每行只显示「大小 · N 处引用」。头上还写着「团队已就绪」。中文文案（「它没有任何内容进入你的团队」）早就写好了，但没有任何组件用它——这套渲染在 6 月做过，被一次合并悄悄合掉了。
客户怎么撞上：传 3 份，1 份坏。他看到自己的周报赫然在列，于是把「项目一片空白」理解成「团队真没进展」，而不是「这份没读进去」。扫描版 PDF 更隐蔽（状态是「空」，连文件名都会出现在「取材自」里）。
加重一点：英文版 headline 本来有「读入 3 份中的 2 份」兜底，中文版刻意不复述文件数——**唯一那句诚实话在中文皮下被删掉了**，而线上就是中文。
建议：**必修，这是最像「产品替客户说话」的一条**。把 status 接上、坏文件那行标出来即可，改动很小。

**5. 「无重大风险」被判成「有风险」**
同一个中文正则的反面：整篇兜底扫描时，「无重大风险 / 无明显风险 / 没有风险 / 风险与缓解（小节标题）」全部命中 → 项目标「有风险」，卡片上写「项目自报状态为『有风险』」。文档明说没风险，产品当着客户面说他自报了风险。
同样主要在规则抽取路径。
建议：**跟第 1 条一起修**（是同一处正则）。注：「风险与缓解」这个标题在 main 上也会中，那属于设计上的「宁可多看一眼」，可以接受。

**6. 卡上写着 80%，下面一行说「没读到进度」**
决策定级里「一条规则都没命中」的兜底，借用了「什么都没读到」那条规则的标题。实跑输出原文自相矛盾：前半句说没读到进度，后半句正确地只列了「未读到：状态、到期日」。
客户怎么撞上：文档写了进度没写状态词——中文周报里非常常见。而且现有测试数据每张卡都有状态，这个分支一次都没被测到。
定级本身是对的（给「需确认」，没把不知道当成没事），坏的只是那句话。
建议：**修，很便宜**——给兜底单独写一句文案就行。

---

## 二、有洞但要凑巧（可以开票，不必卡 7/25）

**7. 红线不扫人名**
生产镜像的红线检查不看 person.name。客户上传 `绩效8分.docx` 这类文件、且简历前几行没有姓名行时，会回退用文件名当名字，造出一个叫「绩效8分」的人卡并通过校验（实跑确认：生产 0 违规，main 3 违规）。这个修复是 7/18 写的，比部署分支的基线晚 4 小时，所以从没上过线。
建议：**跟其它子集修复一起带上**（改一行）。单独看命中率不高。

**8. 议事室「快问一句」在换设备登录后 404**
五个 ask 端点没接账号那条路，只认本机 token。换台机器（或同机登出再登回）登录后：团队、笔记、文件、建议全 200，一发问就报「找不到这家公司」——而同屏团队卡片好好显示着。
前提是 Supabase 登录入口真开着。
建议：**开票**。改法明确（照抄 /team 的写法加一个 header 参数）。

**9. 探测抖一下，账号面板整场消失，但仍在用上一个人的身份发请求**
能力探测只发一次、超 5 秒或一次 502 就永久判定「不支持」，面板整块不渲染——连「退出登录」按钮一起消失。而会话恢复是并行的、成功了，后台每个请求还带着上一个人的身份，甚至会静默接管上一个人的公司数据。用户唯一出路是刷新碰运气。
演示机/共享机上值得警惕。
建议：**开票**，加一次重试或让登出口不受探测结果影响。

---

## 三、观感级，7/25 不影响判断（可接受 / 攒着改）

**10. 语言开关切了，右边的账号按钮还是中文。** AuthPanel 用自己那份小字典，只看 URL 参数和构建期变量，既不订阅开关也不读 localStorage，刷新也修不回来。同一行里「English」按钮旁边写着「登录」。

**11. 退出登录会把语言和皮肤偏好一起抹掉。** 清理函数按 `lite2:` 前缀整段删，今天新加的两个偏好键正好落在这个前缀下。当场看不出来，下次刷新静默变回默认。语言有构建期兜底（仍是中文），实际丢的主要是皮肤。

**12–13. 切语言后，兜底文案卡在旧语言。** 项目的「文档未提及」是取数时就焊死的字符串，切语言不重新生成：首页那张无负责人的卡还是旧语言，点开详情浮层却是新语言；首屏那叠分诊卡同理。刷新即好。注意 v01 没这个毛病（它把兜底文案留在渲染层），是 v02 这边没跟上同一条纪律。

这三条都属于「客户主动点了今天新加的开关之后才出现」的中英混排，不撒谎、不拦功能。**建议：可接受，7/25 之后再收拾。**

---

## 总体判断

**前端可以带去 7/25，后端镜像不能原样带。**

今天前端那 12 个提交我没找到会误导客户的东西，剩的都是切换语言后的混排和偏好丢失。真正的风险全部集中在一件事上：**四次「最小子集」热替换是从 7/18 的旧基线叠出来的，把 main 上一整批中文相关的修复漏在了外面**——中文完成词、中文阻塞抓取、briefing 统一规则、红线扫人名，全都没上线。这四样加起来正好命中「三家公司交中文文件」这个场景的正面。

上线前至少要做完第 1–4 条（第 5、6 条顺手）。这几条改完之后，我认为可以安心带到 7/25。

另外提一句流程：这次的问题不是有人写错了代码，是**部署分支的基线一直没跟上 main**，而每次子集又只验证自己那部分。7/25 之后建议把生产镜像重新从 main 拉一次基线，别再往旧分支上叠。

---

# 幸存发现明细

## 1. [high] 新语言开关驱动不了 AuthPanel —— 同一条顶栏里，语言按钮显示「English」，紧挨着的账号按钮仍写「登录」，且刷新也改不回来

**位置**：`src/lite2/auth/AuthPanel.tsx:77`　**视角**：i18n-collision　**类别**：i18n-desync

**失败场景**：境内 ZH 构建（VITE_AVERY_LOCALE=zh，线上已配 Supabase 且 /account/status 探测为 supported，登录按钮真的渲染）。经理点顶栏语言开关的「英文」→ useLocaleStore 变 en，useDict 订阅它，七个 tab、议事室、判读卡全部立刻变英文；但 AuthPanel 用的是自己那份私有 COPY，由 useCopy() 以 useMemo(…, []) 在挂载时算一次，且解析链只有「URL ?lang= → import.meta.env.VITE_AVERY_LOCALE → en」，既不读 localStorage 也不订阅 localeStore。于是顶栏同一行里，`.lang-switch` 的 English 按钮是 is-active，右边 AuthPanel 的按钮（AuthPanel.tsx:389 渲染 `c.signIn`）仍然写「登录」，点开的弹窗是「邮箱/密码/注册/退出登录」全套中文。刷新也修不好：开关只把 en 写进 localStorage['lite2:lang:v1']，useCopy 那条链根本不看这个 key，env 仍是 zh → 永久中文。反向同理（境外 EN 构建点「中文」，账号面板永久英文）。verify-switchers.mjs 只断言 `.scene-tab` 文案变成 'Today'，且本地跑时 accountCapability 不是 'supported'、AuthPanel 整块 return null，所以这道门结构上看不见这块，必绿。

**证据**：AuthPanel.tsx:77-92 `function useCopy(): Copy { return useMemo(() => { let lang = new URLSearchParams(window.location.search).get('lang'); if (lang!=='zh'&&lang!=='en') { const env = import.meta.env?.VITE_AVERY_LOCALE; lang = String(env??'').trim().toLowerCase()==='zh'?'zh':'en' } return lang==='zh'?COPY.zh:COPY.en }, []) }` —— 依赖数组是空的，链里没有 localStorage 这一级；对比 shared/i18n/index.ts:74 resolveLocale() 今天新增的第 2 级 `const fromStorage = readStoredLocale()`（key 'lite2:lang:v1'）。AuthPanel.tsx:18-19 的原注释写明「文案就地定稿（zh/en 两份小字典），不进 src/shared/i18n……等合流后由集成方决定要不要收编」——合流已发生，没收编。LiteTopbar.tsx 里 `<AuthPanel />`（第 92 行附近）和 `<div className="lang-switch">` 是同一个 <header> 的相邻兄弟节点。

## 2. [medium] 换账号/退出登录会把语言与皮肤偏好一并抹掉 —— wipeLite2LocalStorage 按 `lite2:` 前缀整段清，今天新增的两个 store 正好落在这个前缀下

**位置**：`src/lite2/auth/AuthPanel.tsx:130`　**视角**：i18n-collision　**类别**：regression

**失败场景**：境外默认 EN 构建：用户点「中文」→ localStorage['lite2:lang:v1']='zh'、['lite2:look:v1']='aurora'，界面立刻中文+极光。随后他点退出登录（或换一个账号登录）→ clearCompanyScope() 调 wipeLite2LocalStorage()，该函数遍历 localStorage 把所有 `lite2:` 前缀的 key 全删，两个偏好 key 被一起删掉。内存态没复位（resetLite2MemoryStores 不碰 localeStore/lookStore），所以当场看不出异常；下次刷新/裸链重进时 resolveLocale() 读不到 storage → 回落 env/默认 EN，界面静默变回英文+暖纸。用户会认为「开关记不住」，而这正是 285aa9f「刷新不再打回原形」承诺要解决的问题。verify-switchers.mjs 全程不登录、不触发 clearCompanyScope，所以这条路径没有任何门覆盖。

**证据**：AuthPanel.tsx:130-143 `for (let i=0;i<window.localStorage.length;i++){ const key=window.localStorage.key(i); if (key && key.startsWith('lite2:')) doomed.push(key) }`，其上第 123-126 行注释把这条写成不变式：「按前缀扫……将来新增的 lite2 store 自动被覆盖」。今天新增的两个 key 恰好在这个前缀下：shared/i18n/index.ts:47 `const LOCALE_STORAGE_KEY = 'lite2:lang:v1'`（且 index.ts:45-46 的注释明确说选这个前缀是「与 store.ts/onboardStore.ts 等既有 v02 key 同一命名族」），lite2/look.ts:69 `const LOOK_STORAGE_KEY = 'lite2:look:v1'`。语言/皮肤是用户偏好，不是公司数据，不在该函数要杀的租户隔离范围内。

## 3. [medium] lite2/teamData.ts 在取数时把 locale 焊进 LiteProject.ownerName，注释里「壳内没有运行时切换语言的入口」这条前提今天被语言开关推翻

**位置**：`src/lite2/teamData.ts:203`　**视角**：i18n-collision　**类别**：i18n-desync

**失败场景**：ZH 构建下上传文件 → store.ts:404/467/569/605 调 liteTeamFromPayload(payload)，locale 默认参数在那一刻取值 zh，第 241 行把没读到负责人的项目写成 `ownerName: '文档未提及'`（copy.projectsUnknownValue），这枚字符串就此存进 store。用户随后点语言开关切「英文」（开关的卖点正是「点开关立即生效，不必刷新」）：首页项目道 TeamScreen.tsx:452 直接渲染 `{project.ownerName}`，仍是中文「文档未提及」；而点开同一个项目的详情浮层，DetailOverlay.tsx:151 走的是 rawTeam 派生的 projectView + 反应式 `t.lite2.projectsUnknownValue`，显示的是英文 'Not stated in the documents'。同一个项目的同一个事实，团队屏和详情浮层两处说法不同——正是本项目明令禁止的那条。要等刷新（restoreSession 重新取数重新派生）才自洽。

**证据**：src/lite2/teamData.ts:203-204 注释原文：「`locale` 默认现取（`resolveLocale()` 读 `?lang=` / 构建期 `VITE_AVERY_LOCALE`，与 useDict 同源；壳内没有运行时切换语言的入口，所以在映射期定文案与在渲染期定文案等价）」——后半句在 285aa9f（LiteTopbar 加语言开关）之后不再成立。teamData.ts:241 `ownerName: ownerNameRaw ?? copy.projectsUnknownValue`；209 `const copy = getDict(locale).lite2`。liteTeamFromPayload 的全部调用点都在 store.ts 的取数路径（404/467/569/605），没有任何一处随 locale 变化重算。对照今天刚修好的同屏兄弟行 TeamScreen.tsx:438 `projectStatusText(project.statusRaw, t.lite2)`（反应式），452 行的 ownerName 没跟着改。

## 4. [high] 后端逐文件发的 status（ingested/empty/failed）前端一个都不渲染，坏文件和读全了的文件在「你的文件」里长得一模一样，头上还写着「团队已就绪」

**位置**：`src/lite2/UploadPanel.tsx:195`　**视角**：product-lies　**类别**：product-speaks-for-customer

**失败场景**：客户一次传 3 份文件，其中 weekly.xlsx 内部 XML 损坏。今天的 fb81811 之后它不再 500 整批，而是被 pipeline.py:81 标成 status='failed'，其余两份正常入库。前端：UploadPanel 顶部显示 t.upload.readyLabel「团队已就绪」（第 166-168 行），「取材自」只列成功的两个文件名，而下方「你的文件」清单（第 195-207 行）把三份并排列出，每行只显示 `大小 · N 处引用`，坏的那份显示「0 处引用」——没有任何一个字说它没读进去。经理看到自己的周报赫然在列，合理推断 Avery 读过它，于是把「项目状态一片空白」读成「团队真的没进展」，而不是「这份文件根本没进去」。v01 的 src/lite/UploadPanel.tsx 同病。

**证据**：eval-harness/avery/ingest/registry.py:374-384 的 file_cards() 明确发 "status": sd.status；eval-harness/avery/ingest/pipeline.py:81-85 三分支写死 failed/empty/ingested。但 src/lite2/transport.ts:238-246 的 LiveFileEntry 接口里**根本没有 status 字段**（idx/filename/size_bytes/mime/doc_kind/uploaded_at/n_chunks），src/lite/transport.ts:175-183 同样没有。`grep -rn fileStatus src/` 只命中 en.ts/zh.ts——zh.ts:150-155 的 fileStatusIngested/Empty/Failed/Unknown + 两条 Hint（「它没有任何内容进入你的团队。」）是**孤儿文案，零组件消费**。溯源：这套渲染在 6f838f3（fixB M4「后端发的 status 前端从不渲染：扫描版 PDF 和读全了的花名册长得一模一样」）里真的做过——`git show 6f838f3:src/lite2/UploadPanel.tsx | grep -c fileStatus` = 8；合并提交 3106536 的两个父 039f1f1(=0) / 377b42f(=8)，合并结果 = 0：这次 merge 悄悄取了没有该修复的那一侧，i18n 键因在另一文件里而幸存。该丢失发生在复审基线 6175e46 之前（属既有缺陷），但今天的 fb81811 正是把「整批 500」改成「坏文件静默标 failed 入清单」，直接放大了它的命中面。

## 5. [medium] v02 的 teamData 在派生期把「文档未提及 / 未读到状态」焊成当时语言的字符串，而今天新上的语言开关是运行时切换、不重新派生 —— 切完语言这些兜底文案卡在旧语言

**位置**：`src/lite2/teamData.ts:241`　**视角**：product-lies　**类别**：i18n-stale-copy

**失败场景**：生产是 zh 构建（averylite.dannyqian.com，VITE_AVERY_LOCALE=zh）。用户上传数据 → liteTeamFromPayload 用 resolveLocale()='zh' 把无负责人的项目卡 ownerName 焊成「文档未提及」、status 焊成「未读到状态」并存进 store。用户接着点顶栏新加的语言开关切到 English：useDict 订阅 localeStore 立刻重渲染，静态文案全变英文，但 store 里的 team 对象没有任何重新派生的路径（liteTeamFromPayload 只在 store.ts:404/467/569/605 四个 fetch/ingest 点被调用），于是 TeamScreen.tsx:452 的 `{project.ownerName}` 在整屏英文里印出中文「文档未提及」，CloserLookScreen.tsx:102 的 `{t.lite2.gapOwnerPrefix} {gap.ownerName}` 同样（gapDerive.ts:65 转手的就是这枚焊死的文案）。反向亦然：en 构建切到中文后印英文 'Not stated'。要恢复只能刷新页面。

**证据**：src/lite2/teamData.ts:202-204 的函数注释白纸黑字写着做这个取舍的前提：「壳内没有运行时切换语言的入口，所以在映射期定文案与在渲染期定文案等价」——这个前提正是今天 285aa9f（语言+皮肤开关）作废的，而 teamData.ts 在本次 19 个提交里一个字没改。src/shared/i18n/useDict.ts 与 localeStore.ts 的新注释确认切换是纯响应式、不刷新。对照组：v01 的 src/lite/teamData.ts 是 locale-free 的（第 41-52 行注释「兜底文案归渲染层：屏与浮层各自 `|| t.lite.projectsUnknownValue`」），所以 v01 无此问题——同一条纪律 v02 这一侧没跟上。门为什么是绿的：eval-harness/tools/verify-switchers.mjs 全程只断言 `.scene-tab` 文案、localStorage 键、`.lite2-shell[data-look]`，从头到尾没有加载过任何团队 payload，屏幕上压根不存在一张项目卡，这条缝在它的视野之外。

## 6. [medium] 决策定级的「没有任何规则命中」兜底分支复用了 R-NO-EVIDENCE 的标题，对着读到了进度的项目断言「没读到状态、阻塞、进度、到期日中的任何一项」

**位置**：`eval-harness/avery/decision_grading.py:514`　**视角**：product-lies　**类别**：product-speaks-for-customer

**失败场景**：一个项目：文档写了 progress=80，没写 status（extract.py 的 `if pr.status` → 缺就不发键），没有 blockers、没有能挂上的 signals、dueDate 缺失。逐条走匹配器：R-NO-EVIDENCE 的 _m_no_evidence 因为 `s.progress is None` 为假而不命中；R-PROGRESS-LOW 要 <40 也不命中；R-CLEAR/R-DONE 要 status 在词表内同样不命中 —— 一条都不命中，掉进 514 行的兜底。等级给的是「需确认」（这一步是对的，没有把不知道判成可推进），但它顺手 append 了一条 rule_id='R-NO-EVIDENCE' 的 RuleHit，title 取自规则表原文「没读到状态、阻塞、进度、到期日中的任何一项——信息不足，不能当作没风险」。这句话被 _compose_reason 拼进 reason，再由 HomeScreen.tsx:348 的 `{card.reason}` 和 402-406 行的 `{hit.title}` 原样打到经理屏幕上——而同一屏的项目卡上明明写着 80%。经理会得出「Avery 连我写的进度都没读到」这个错误结论，正是这条规则的注释（decision_rules.py:143-145「说的是『我没读到』，不是『文档没写』」）想避免的那类失实陈述，只是方向反了：这次是替客户否认了产品自己**读到过**的字段。

**证据**：eval-harness/avery/decision_grading.py:511-519 兜底分支直接借用 rule('R-NO-EVIDENCE').title_zh；eval-harness/avery/decision_grading.py:330-334 的 _m_no_evidence 要求 progress is None 才算命中，两者口径不一致。evidence 字段本身是诚实的（「（没有任何规则命中，按信息不足处理）」），但 src/lite2/screens/HomeScreen.tsx:406 渲染的是 hit.title 而不是 evidence。可达性已核对：eval-harness/avery/ingest/registry.py:170-173 的 project_cards() 对 status/progress 都是「有值才发键」，所以「有进度、无状态」是一个正常 payload 形状（decision_rules.py 文件头自己给的实测覆盖率就是 status 13/17 · progress 6/17）。

## 7. [high] 生产 briefing() 还在用被 main 废掉的私有弱规则，和同一个响应里的 decisions 自相矛盾

**位置**：`eval-harness/avery/ingest/registry.py:204`　**视角**：backend-deploy　**类别**：product-lies

**失败场景**：一份项目文档写 `Status: on-track` + `Blocker: waiting on legal sign-off`。生产 `_team_payload` 同时返回 `decisions`（走完整规则表 → R-SELF-REPORT-MISMATCH → 需确认，并列出该阻塞）和 `briefing`（走 `[p for p in projects if p.status in ("at-risk","blocked")]` → 空 → 不 append "need a look" 指标）。前端 localizeBriefing 的 hasRisk 只认 "need a look" 指标是否存在，于是中文首屏在「没有一处是编的」正下方印出 briefingSubheadCalm「没有风险信号」，而同屏的决策列表正列着「需确认 + 该阻塞原文」。同一份 payload 两套规则，界面自己打自己。

**证据**：`git show 780d441:eval-harness/avery/ingest/registry.py:204` 的 briefing() 仍是 `at_risk = [p for p in self.extraction.projects if p.status in ("at-risk", "blocked")]`，subhead 走 `"No risk signals surfaced from the documents."`。main 的同名方法已改为调用 `grade_projects` + `_signals_no_decision_covers`，其 docstring 逐字描述的就是这个 bug（「两套规则 = 界面隔一个键就自相矛盾，现在只剩一套」）。生产 ingest_api.py:161 同时发 `"briefing": ctx.briefing()` 和 `"decisions": ctx.decision_cards()`，decision_cards 在子集里是完整规则表版本。附带：子集 briefing() 不发 look_kind（签名也没有 as_of），main 前端 briefing.ts 的 `namesProjects = briefing.lookKind === 'projects'` 因此恒为 false —— 这一条降级方向是安全的（说「N 处」不说「N 个项目」），不算缺陷。

## 8. [high] _ZH_DONE 的负向后顾只挡住紧邻一个字，「未能完成 / 无法完成 / 未按时完成 / 还没有完成」全部读成 done

**位置**：`eval-harness/avery/ingest/extract.py:708`　**视角**：backend-deploy　**类别**：correctness

**失败场景**：客户周报写 `状态：未按时完成`（或 未能完成 / 无法完成 / 不能完成 / 还没有完成 / 没有完成）。第 890 行的中文状态行正则命中，`_norm_status('未按时完成')` 里 `(?<![未没待])完成` 的后顾只看「完成」前一个字（这里是「时」/「法」/「能」/「有」），全部放行 → 返回 "done"。下游 decision_grading：`_m_done` 命中 → 定级 CAN_PROCEED「可推进」；同时 `_m_overdue`/`_m_due_soon`/`_m_due_vs_progress`/`_m_progress_low` 都带 `status != STATUS_DONE` 守卫，一并被静音。结果：一个自报「没按时完成」的项目在客户面前显示「已完成 / 可推进」，且逾期告警被吞。

**证据**：子集 780d441 extract.py:708 `_ZH_DONE = r"(?<![未没待])完成|已交付|已上线|已结项|已验收|验收通过"`；890 行 `m = re.match(r"^(status|状态|进展)\s*[:：\-]\s*(.+)$", s, re.I)` → `status = _norm_status(m.group(2))`。用该正则实测：'还没有完成'→done、'未能完成'→done、'无法完成'→done、'不能完成'→done、'未按时完成'→done、'没有完成'→done、'完成度 60%'→done（'未完成'/'没完成'/'待完成'/'尚未完成' 才被挡住）。decision_grading.py:357 `_m_done` → CAN_PROCEED，rules 第 163 行 `Rule("R-DONE", CAN_PROCEED, ...)`。main 已经把这套换掉了（`_zh_states` + `_ZH_CANNOT_DELIVER` + 否定扫描，注释里自陈「六个词头不够，客户的说法就在名单外」），生产跑的是更早、更弱的那一版。

## 9. [high] 中文状态解禁了「可推进」这一侧，中文阻塞/信号却仍是纯英文正则——正向解锁、反向失明

**位置**：`eval-harness/avery/ingest/extract.py:907`　**视角**：backend-deploy　**类别**：correctness

**失败场景**：一份纯中文周报：`状态：进行中` + `阻碍项：等待法务确认` + `风险：人手不足`。生产的 blockers 抽取只有英文正则（blocker|blocked|waiting on|stuck|unresolved|no sign-off|acceptance not|not defined），`_signals_from_doc` 四条正则也全英文，所以 blockers=[]、signals=[]。而 feat-056 刚让 `_norm_status('进行中')` 返回 "on-track"。于是 `_risk_free()`（只看 blockers + signals 关键词族）恒为 True → `_m_clear` 命中 → R-CLEAR → 「可推进」。feat-056 之前 status 是 ''，同一份文件会落到 R-NO-EVIDENCE →「需确认」。也就是说这次上线把中文项目从「需确认」直接推到了「可推进」，而判定风险所需的中文证据一条也读不到。

**证据**：子集 780d441 extract.py:907 `if re.search(r"\b(blocker|blocked|waiting on|stuck|unresolved|no sign-?off|acceptance (?:not|un)|not defined)\b", s, re.I)` —— 中文标签行一个都没有；923 行起 `_signals_from_doc` 的四条正则同样全英文（`\d+ unresolved`、`acceptance ... not`、`reworked|reopened`、`absorbed|took on`）。main 的 extract.py:1145 补了 `^(?:阻碍项|阻碍|阻塞|卡点|风险点)\s*[：:]\s*(.+)$` → blockers.append —— 这一行**不在**生产子集里。decision_grading.py:350 `_risk_free` 只查 `s.blockers` 和 `KEYWORD_FAMILIES` 对 signals/blockers 的匹配，不扫正文。

## 10. [medium] 整篇兜底 risk_only 扫描：正文里出现「风险」两个字（哪怕是「风险与缓解」小节标题或「无重大风险」）就把项目判成 at-risk

**位置**：`eval-harness/avery/ingest/extract.py:913`　**视角**：backend-deploy　**类别**：product-lies

**失败场景**：一份没有 `状态：` 行的中文路线图，含标准小节标题「风险与缓解」，或正文写「本项目无重大风险」。第 913 行 `status = _norm_status(doc.text, risk_only=True)` 对**整篇正文**做子串匹配，`_ZH_AT_RISK` 的 `(?<![无没])风险` 后顾只挡紧邻的 无/没，「无重大风险」「无明显风险」「没有风险」全部命中 → status="at-risk" → R-STATUS-AT-RISK →「需确认」，且项目卡上直接显示「有风险」。文档明说无风险，产品当着客户的面说他自报了风险——和今天 4cd3a12 修的假绿是同一类替客户说话，只是方向相反。

**证据**：子集 780d441 extract.py:707 `_ZH_AT_RISK = r"(?<![无没])风险|延期|逾期|滞后|落后|推迟|拖期|告急|吃紧|超期"`，913 行 `if not status: status = _norm_status(doc.text, risk_only=True)`（doc.text 是整篇）。实测：'无重大风险'→at-risk、'无明显风险'→at-risk、'没有风险'→at-risk、'风险与缓解'→at-risk（只有紧贴的 '暂无风险' 被挡住）。main 已把这些词改走带否定扫描的 `_zh_states()`，生产是裸后顾版。

## 11. [medium] 生产子集的红线不扫 person.name，简历路径的文件名回退可以造出叫「绩效8分」的人并通过校验

**位置**：`eval-harness/avery/ingest/redline_extract.py:180`　**视角**：backend-deploy　**类别**：redline

**失败场景**：客户上传 `绩效8分.docx` 或 `张三-KPI95.pdf`。extract.py 的简历路径在找不到姓名行时回退用文件名做 name，于是产出一个 name='绩效8分' 的 PersonEntity。生产的 `_person_text_fields` 返回 `[p.role, p.tenure, p.team, *p.owns, *p.collaboration]`——不含 name，所以结构化打分扫描看不见它；而 `validate_extraction` 的内容扫描被 `if blob.strip()` 守着，一份没有可识别 role/tenure/owns 的简历 blob 为空，整段扫描被跳过。结果 ok=True、0 violations，一张写着评分的人卡直接进库上屏。

**证据**：`git diff 780d441 main -- eval-harness/avery/ingest/redline_extract.py` 显示 main 把该行改成 `return [p.name, p.role, ...]`（feat-060 HOLE 1），并在注释里列出实测：name='绩效8分'/'张三-KPI95'/'王五(离职风险高)'/'赵六 末位淘汰名单'/'Bob low performer' 修前均为 0 violations。这个改动**不在** 780d441 生产镜像里。同一个 diff 还显示 main 补了整块 feat-060 的中文否定线索修复（不要/不用/避免/拒绝/无需/勿 等 16 个普通词会把红线关掉 32 个字），生产同样没有。

## 12. [medium] 五个 ask 端点完全不认账号支路——换设备登录的经理拉得到团队，一发问就 404

**位置**：`eval-harness/service/ask_api.py:296`　**视角**：security-privacy　**类别**：access-control-inconsistency

**失败场景**：经理在 A 机器上游客态上传 → 点「绑定到我的账号」→ 换到 B 机器（全新浏览器，localStorage 里 `lite2:ownerTokens:v1` 是空的）登录。AuthPanel 的恢复副作用调 /account/contexts 拿到 context_id → adoptContext → refreshTeam / refreshNotes / refreshFiles / advise 全部 200（这四条都走 account 支路）。但他在议事室点「快问一句」时，transport.saveAsk 打 POST /ask，headers 里只有 X-Avery-Account（没有 owner_token，因为这台机器上从来没有过）。ask_api.create_ask 的签名里压根没有 x_avery_account 参数，authorize_context(reg, ctx_id, None) 拿到的 token 是 None、required 非空 → 抛 404 `unknown company_context_id`。前端 transportError('ask', res) 抛出，屏幕上是「找不到这家公司」——而同一屏的团队卡片正好好地显示着这家公司。saveAsk / shareAsk / fetchAsk / revokeAsk 四条同样中招。

**证据**：eval-harness/service/ask_api.py:296-299 create_ask 只声明 x_avery_token + authorization 两个 Header，306 行 `authorize_context(reg, body.company_context_id, extract_owner_token(x_avery_token, authorization))` 只传三个参数（第四个 account_user_id 缺省 None）。319/341/364/375 四个端点同构。对比 ingest_api.py:354-361 的 /team/{id}：`account.resolve_account(x_avery_account)` 作为第四参传入。前端侧 src/lite2/transport.ts:552-554 的 authHeader() 明确是 `{...ownerToken?, ...accountHeader()}`，663/676/684 行三处 ask 调用都在发 X-Avery-Account——header 发出去了，服务端读都不读。grep 全仓 `x_avery_account` 在 ask_api.py 零命中。

## 13. [medium] 能力探测只发一次且无重试：探测抖一下，登录态还活着、token 照发，但账号面板整场消失、没有登出口

**位置**：`src/lite2/auth/authStore.ts:155`　**视角**：security-privacy　**类别**：session-hygiene

**失败场景**：共享/演示机上，上一位经理登录过，supabase-js 的会话 key 还在 localStorage 里。下一个人打开页面：init() 里 getSession() 恢复成功 → status='authed'，accessToken 被 applySession 写进模块变量，此后每一个 /team、/notes、/files、/advise、/ingest 请求都带上**上一个人的** X-Avery-Account。与此并行的 probeAccountCapability() 撞上法兰克福后端冷启动（或任何 >5s 的一次抖动 / 一次 502），落到 'unsupported'。AuthPanel 在 341 行 `if (accountCapability !== 'supported') return null` 整块不渲染——于是屏幕上既没有账号头像、也没有「退出登录」按钮，而后台正以上一个人的身份在跑。探测被 authStore 的模块级 `initialized` 闸锁死，整个页面生命周期内不会再发第二次，没有任何重试路径，用户唯一的出路是 F5 碰运气。fail-safe 的方向是对的（隐藏而不是假开），但它把「隐藏入口」和「切断凭据」当成同一件事处理了，实际只做到了前者。

**证据**：src/lite2/auth/authStore.ts:150-158 —— `initialized = true` 之后 `void probeAccountCapability().then((cap) => set({ accountCapability: cap }))` 与 `sb.auth.getSession()` 并行发起，两者互不影响；grep 全仓 `accountCapability` 只有 141（初值）和 155（唯一 setter）两个写点，无重试、无 interval、无 retry 按钮。src/lite2/transport.ts:470-472 accountHeader() 只看 `currentAccessToken()`，与 accountCapability 无关。src/lite2/auth/AuthPanel.tsx:341 是唯一的消费点，返回 null 时连 signOut 按钮一并消失。

