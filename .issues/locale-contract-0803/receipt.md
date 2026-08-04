# 回执 · #38 locale 契约（判读链路双语对等）

- 日期：2026-08-04
- PRD：[prd.md](prd.md)（11 条决议）· ADR：[ADR-0033](../../docs/adr/0033-locale-is-a-request-field-backend-stops-emitting-prose.md)
- 结果：**11 条决议全部落地**，全电池 **31/31 绿**（A 25 / B 3 / C 3），后端 pytest **3513 passed**。

---

## 1 · 做了什么（按 PRD §3 的层）

### 3.1 契约：locale 是请求字段

- 新模块 `eval-harness/avery/locale.py` —— 唯一的 locale 收口。
  `normalize_locale()` 与前端 `normalizeLocale()` 逐条同形（trim + 小写，只认 `en`/`zh`）；
  缺省 `en`、**非法值回落 `en` 并告警**（函数自己 log 一条，端点再 log 一条带路由身份的）。
  **不 422**：locale 是加法字段，没资格打回一次判读，所以 `AdviseRequest.locale` 故意
  typed `str | None` 而不是 `Literal`。
- 前端 `src/lite2/transport.ts` + `src/lite/transport.ts`：`AdviseRequest.locale?: Locale`，
  由 `streamAdvise` 在**传输层出口一处补全**（`withLocale()`），不让每个调用点各记一遍——
  那是给"哪天新加一个入口忘了带"留位置，而那个 bug 的症状是"英文界面偶尔回一段中文正文"。

**顺手修掉的一个真缺陷（不在票面上）**：`resolveLocale()` 是纯解析函数，**URL 排第一位**。
所以地址栏带着 `?lang=zh` 时点了 EN 开关，界面变英文而 `resolveLocale()` 仍返回 `zh`——
传输层和界面就此各说各话。在 feat-068 那会儿这只影响错误文案（读得懂就行）；
ADR-0033 之后 `/advise` 的 locale 也走这条路，那就是**英文界面拿回一段中文判读正文**。
修法不是再解析一遍，而是让开关成为下游唯一发布者：新增
`shared/i18n/index.ts::setActiveLocale/activeLocale`，`localeStore` 每次落定就发布，
传输层读 `activeLocale()`。链仍然只有一条（初值就是 `resolveLocale()` 的结果）。

### 3.2 后端不再产出人话（一刀切，无并存）

`decision_grading.py` 的 `to_dict()` **删掉**：`grade_label` · `rule_grade_label` ·
命中里的 `title`/`basis` · `unparsed_fields[].field_label` · 规则版 `reason` 的句子（改回空串）。
新增 `matched_rules[].params`（如 `{n:2}` / `{days:7,pct:60}`）——**阈值仍归后端配置**
（`decision_rules.py::RULE_PARAMS`），句子归前端 i18n，别把数字抄进前端硬编码。

拆掉的两块（文件里留了碑，防止照旧样加回来）：
`_FIELD_LABEL`（字段名人话）· `_compose_reason()`（那句「按规则判为…（未读到：…）」）。

**范围比 PRD 写的三处形态大一点，多做了 evidence 面**：evidence 里此前还有第三种东西——
后端拼的中文注解（`（已过 12 天）`、`（无阻塞、无风险信号）`、
`（status / blockers / progress / dueDate 全部缺失…）`）。它们**既不是文档原文也不是字段读数**，
却印在写着「下面这几行是文档原文，不是 Avery 的话」的那一节里——既是语言缺陷也是溯源缺陷。
全部拆掉：`R-NO-EVIDENCE` / `R-UNCLASSIFIED` 的证据面按定义为空（没读到任何字段就没有原文可引），
时间类注解删掉（到期日原样摆着，经理自己会看日历）。现在 evidence 里只剩两种东西，
两种都与界面语言无关：① 文档原句 ② 字段读数（`status="blocked"`）。

同批改完的消费方（PRD 点名的那张清单，一处不落）：
`homeDerive.ts` · `HomeScreen.tsx`（3 处 + 注释）· `transport.ts` ·
4 道门（cr-alignment / home-skeleton / topbar-clearance / capture-align-board）·
`tests/test_decision_grading.py`。

### 3.3 LLM 正文

- `avery/locale.py::language_instruction()` 进 `skills.build_system_prompt(..., locale=)`，
  **每一档 scaffold 都带**（baseline 也带——baseline 的意义是"除了红线那一层别的都一样"，
  少一段语言指令等于给对比组偷偷换了变量）。
- 指令里写死**引文例外**："never translate a quotation / reproduce exactly as it appears in the
  source"。少这一句，模型会很自然地顺手把引文也翻了，那一刻它就不再是引用，是编。
- MockBrain 的罐头正文也按同一个 `locale` 取（`live_input.py::_MOCK_ADVICE`）。
  必须如此：离线电池跑的是 mock，罐头永远英文的话，门里"正文语言 == 请求 locale"
  在 zh 下**根本采不到样**，恒绿。

**英文侧红线抽查（PRD §3.3 点名要做）**：18 句常见「打分/排名」写法实测 —— 拦住 14、漏 4、零误伤。
四句都不是边角写法：

| 漏网句 | 为什么漏 |
|---|---|
| `Rank her against the rest of the team.` | 排名动词此前只认"垫底类"宾语；这句要的就是排名本身 |
| `He is our weakest link on the team.` | 词表写的是 `weak link`，最高级就绕过去了 |
| `Grade each report A through F.` | 字母**量表**没人认（这里 report = 直接下属，不是文档） |
| `Her ownership score dropped to 3.` | `<维度> score` 是白名单式三个词，换个维度即穿透 |

四条已补进 `avery/redline.py`，并配了**两头都钉**的回归测试
（`test_redline.py` 尾部：6 句必须硬拦 + 8 句必须仍然通过）。
🔴 ADR-0016 的不对称守住了：`our audit score was 9/10` / `their compliance score dropped to 3` /
`team throughput ranks bottom 20%` 全部仍然通过——公司与工作产物的量化是合法的。

### 3.4 前端

`src/shared/i18n/{en,zh}.ts` 新增（两边同构）：`decisionGrades`（三个档位词）·
`decisionRules`（18 条规则的 title + basis，带 `{n}/{days}/{pct}` 占位符）·
`homeDecisionReasonByRule` / `homeDecisionReasonNoRule` / `homeDecisionRuleJoin` ·
`homeFieldBlockers` / `homeFieldJoin` / `labelSep`。
中英**都是本 session 自己写的大白话**（2026-08-03 改口径，不再走 M3）。

`homeDerive.ts` / `HomeScreen.tsx` 里那两条「前端不硬编码三个档位词、一律取后端 `grade_label`」
的旧注释**连同实现一起换掉**，指向 ADR-0033 并写清"保用意换载体"。

**顺手修掉的第二个真缺陷**：`labelSep`。判读卡里 `{标签}：{值}` 的那个冒号是**写死在 JSX 里的
全角冒号**，于是英文壳渲染出 `Not mentioned in the files：Status`——一个 CJK 字符坐在英文句子中间。
标点也是文案，进字典。（同族的 `{'：'}` 在 DetailOverlay / ProjectsScreen / TeamScreen 还有 4 处，
**不在本票范围**，见 §4 遗留。）

---

## 2 · 验收：新门 `verify-locale-parity.mjs`

A 区、🔴 上传型、排在 A 区末（**C 区之前**）。同一份 demo-seed 中文语料跑 zh/en 两遍，
**48 PASS · 0 FAIL**。

四条判据 + 每条前面的自证判据：

| # | 判据 | 自证 |
|---|---|---|
| ① | 界面壳无异语残留（en 无 CJK / zh 无 3+ 拉丁字母连写） | 壳采样面 ≥5 段、17 段实到 |
| ② | 后端派生文案语言正确（**白名单**：档位词必须是这三个之一；规则句必须用本语言模板；标签必须是本语言）+ 反向白名单（壳里不许出现另一种语言的锚点词） | 判读卡真渲染、规则区每张都展开 |
| ③ | LLM 正文语言 == 请求 locale（**两遍问同一个中文问题**——EN 那遍输入是中文的，正文必须是英文） | 一次真 advise 跑完、正文 >60 字、分节标签采到样 |
| ④ | 引文仍是原文（每行逐字出自上传语料 + 两遍逐字相同 + 仍有真汉字） | 引文行非空、"文档原文型"的行非空 |

### born-red 两头都验（三个方向各造一次真违规）

| 探针 | 复现的缺陷 | 结果 |
|---|---|---|
| 1 · `withLocale` 不再补 locale | D2/D3 的链断在传输层 | **43 PASS · 1 FAIL** —— ③ 红（zh 拿到英文正文） |
| 2 · `gradeLabelOf` 退回写死中文 | ＝ADR-0033 之前的症状 | **39 PASS · 5 FAIL** —— ① 与四条 ② 全红 |
| 3 · 渲染时把引文里的汉字替换掉 | D4 / ADR-0018 可溯源红线 | 见下 |
| 撤回全部探针 | — | **48 PASS · 0 FAIL** |

🔴 **探针 3 第一次跑是全绿的，判据太松——这是本轮最值得记的一条。**
原因：那时 ④ 用的是**宽口径 CJK 正则**（含全角标点 `，`）。把汉字全翻成英文之后，
句子里剩下的那个全角逗号照样让"含中文"判据通过。也就是说，屏幕上摆着的「文档原文」
已经一个字都不是原文了，门却说验过了。

两处收紧（都写进了门的文件头）：
1. **拆成两把尺子**：壳残留用宽 `CJK`（必须逮得住全角冒号），引文用只认汉字的 `HAN`。
2. **主判据换成"逐字出自语料"**——"两遍逐字相同"只逮得住"只在英文界面翻"这一种写法；
   一个对两种语言都生效的翻译会让两边仍然相等。拿语料当基准就没有这个缝：
   翻了、改了、转述了，任何一种都不再是语料的子串。
   收紧后重跑探针 3：**46 PASS · 2 FAIL**（两条 ④ 都红），撤回后 48 PASS · 0 FAIL。

顺带：第一版只展开第一张卡，采样面 4 行；改成全部展开后 19 行。
第一版还把 advise 留在 home 屏问（判读卡只在 room 屏渲染），
于是 ③b 对着**空数组**跑，`[].every()` 恒真、永远绿——**是自证判据把它逮住的**。

---

## 3 · 后端 pytest

- `tests/test_locale_contract.py`（28 条，新）—— locale 收口 / 语言指令真的进了 prompt /
  mock 正文跟着同一个 locale。三段缺一就变成自考自答：只有 mock 那条，验的是"我让 mock 说中文
  它就说了"；只有 prompt 那条，验的是"字符串拼进去了"而没人证明它能走到屏幕上。
- `tests/test_decision_i18n_contract.py`（11 条，新）—— 文案搬到前端之后谁来看着它：
  完整性（18 条规则 × 2 语言）· 占位符两个方向对账 · zh 档位词与客户口径说明书一致 ·
  **红线与禁词表跟着文案一起搬过来**（原来那两条留在后端就变成对空串断言＝恒真）。
  🔴 解析器故意脆：解析不出预期条数就直接失败，绝不返回空字典让下面几十条断言"全绿"。
- `test_decision_grading.py::test_no_backend_prose_anywhere_in_the_payload`（新）——
  结构性护栏：载荷里除文档原文外不许再有一个中文句子。
- 两条 born-red 已验：往 `to_dict()` 加回 `grade_label` → 红；删掉一条前端规则文案 → 5 红。

**两条本来会静默变成"恒真"的测试已就地改掉**（不是删）：
`test_no_rule_asserts_...` 的兜底理由那一半、`test_composed_reasons_pass_the_red_line`——
它们跑的是后端那句话，那句话变成空串之后断言恒真。前者搬去前端文案表，
后者改对规则标题跑，原地各留一条哨兵。
`test_zh_status_negation{,_round2}.py` 里三条断言 reason 文本的，改成从载荷读**真正命中的
规则**再回规则表取标题（rule_id 只作为读出来的值出现，绝不写成字面量——
`test_no_rule_text_in_any_prompt` 全仓禁止规则号出现在那三个文件之外）。

---

## 4 · 明确没做（各自单开一票）

PRD §5 的四项原样不动：英文文档解析（输入侧词表）· `ask_api.py` 那 40 条问卷 H5 文案 ·
用户账号级语言偏好 · 引文翻译/中英并列。

本轮新增两条遗留：

1. **`{'：'}` 写死在 JSX 里的还有 6 处**（自查：`grep -rn "{'：'}" src/`）：
   `DetailOverlay.tsx` ×4 · `ProjectsScreen.tsx` ×1 · `TeamScreen.tsx` ×1。
   与本票同病（英文壳里的 CJK 标点），但都在**卡片详情面**不在判读链路，且它们有像素基线覆盖，
   改宽度就要重冻。单开一票扫一遍。
2. **`R-NO-EVIDENCE` / `R-UNCLASSIFIED` 现在没有 evidence 行**——这是有意的（证据面按定义为空），
   但界面上这两条规则只剩标题和依据，看起来比别的规则"薄"。视觉上要不要给它一句
   「这条规则本来就没有可引的原文」，是文案题不是契约题，留给下一轮 UI 走查判。

---

## 5 · 环境坑（下一棒会踩，写在这里）

🔴 **`pkill -f "uvicorn service.app"` 在本机 Git Bash 下不生效，而且不报错。**
本轮改完后端重启了一次，`ps` 只看到一个 python、日志也在正常收请求，但跑门时 zh 拿到的还是
英文正文——排查了半天才发现**旧进程根本没被杀掉**，服务的还是改动前的代码。
判断方法（比看 ps 靠谱）：发一个非法 locale，看日志里有没有 `unsupported locale` 那条 warning，
没有就是旧代码。可靠杀法：

```powershell
Get-CimInstance Win32_Process -Filter "Name='python.exe'" | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
```
