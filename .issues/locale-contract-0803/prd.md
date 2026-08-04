# PRD · locale 契约（判读链路双语对等）

- 日期：2026-08-03
- 来源：Danny grill ×3 轮，逐项拍板。架构决议记 [ADR-0033](../../docs/adr/0033-locale-is-a-request-field-backend-stops-emitting-prose.md)。
- 触发：原本不打算在境内找用户（EN-first 是代码默认），现在要和**三亚一家公司**对接，
  中文第一次成为真实客户需求。
- 状态：**ready-for-agent**，可直接交给一个 AFK session 开发。

---

## 0 · 先读这段，否则会做错方向

这一票**不是**"把三处 `LABEL_ZH` 改掉"。票面那个描述严重低估了范围。实测：

- 后端 `avery/` + `service/` 有 **396 处中文字符串字面量**（已排除注释/docstring 行）。
- 但它们分成**性质相反**的两类，混为一谈就会砸掉产品：

| 类别 | 例子 | 本票怎么处理 |
|---|---|---|
| **输出侧文案**（打到经理屏幕上） | `decision_rules.py` 32 · `decision_grading.py` 27 | ✅ 本票要改 |
| **输入侧检测词表/正则**（用来读中文文档、守红线） | `extract.py` 93 · `redline.py` 75 · `granularity.py` 40 · `parse.py` 20 | 🔴 **一个字都不许动** |

**🔴 最容易犯的错**：看到 `extract.py` 里一排中文就"顺手双语化"。那些是匹配模式，
客户文档是中文，词表就必须是中文——**即使界面切成英文**。动了＝解析和红线当场瞎掉。
「文档语言」≠「界面语言」。英文文档解析是另一个量级的活，**单开一票，不在本票**。

还有第三个面：**LLM 判读正文的语言今天完全不受控**——scaffold/prompt 里没有任何语言指令，
输出语言是涌现的（大概率跟着文档语言走）。模板改得再对，正文照样可能不听话。

---

## 1 · 目标

**zh / en 真双语对等**，两种语言都是一等公民。不做"锁 zh、en 只求不跑偏"的降级方案。

范围**只覆盖判读链路**：`/advise` 契约 → `decision_*` 输出文案 → LLM 正文 → 前端渲染。

---

## 2 · 逐条决议（Danny 已拍板，别再重开）

| # | 决议 | 理由 |
|---|---|---|
| D1 | **真双语对等**，zh/en 同等完整 | 三亚客户要中文；EN 是既有承诺，不能半残 |
| D2 | locale **沿用前端解析链**（`?lang= > VITE_AVERY_LOCALE > en`），随请求下传后端 | 不新增概念；强制「界面语言」与「判读语言」一致 |
| D3 | **locale 写进 prompt**，显式要求用该语言作答 | 让语言成为受控输入而非运气 |
| D4 | **引文 evidence 原文照引，永不翻译** | 逐字引用，翻译＝编，违反可溯源红线（ADR-0018） |
| D5 | **后端不再产出人话**，只回机器键 + 结构化字段，句子归前端渲染 | 永久铲除"后端写死文案"整类缺陷；以后加语言只改前端 |
| D6 | 输入侧词表/正则**明确不动**，边界写进本 PRD | 见 §0 |
| D7 | 本票**只做判读链路**；`ask_api.py` 那 40 条问卷文案单开一票 | 问卷 H5 收件人是员工不是经理，是另一条用户旅程 |
| D8 | 验收立**一道双语门、四条判据** | 文案类缺陷没有机械门就必然回归 |
| D9 | 反转「前端不硬编码三个档位词」旧规矩，**保用意换载体**，记 ADR | 用意是单一事实源，不是"必须后端发"；详见 ADR-0033 |
| D10 | 契约**一刀切换**，不做新旧字段并存 | demo 原型、零外部消费者；并存会留下"后端仍产出中文"的破口 |
| D11 | locale **optional，缺省 `en`**，非法值回落 `en` 并告警 | 与前端解析链末端同一个默认值；旧客户端不传也不崩 |

---

## 3 · 要动的东西（按层）

### 3.1 契约
- `service/contract.py` / `AdviseRequest`（`src/lite/transport.ts` 同形）加 `locale?: 'zh' | 'en'`。
- `transport.ts` 发请求时带上前端已解析出的 locale（**复用现有那条链，别另写一份解析**——
  `transport.ts` 现有注释已写明它与 `useDict` 同源，保持这个性质）。
- 非法/缺省 → `en` + 一条服务端 warning（**不要静默**，静默回落是下一个"查不出来的怪事"）。

### 3.2 后端输出侧：停止产出人话
把规则推导出的句子换成结构化载荷。现行三处形态（`decision_grading.py`）：

```
f"按规则判为{LABEL_ZH[grade]}：{body}。"        # body = 命中规则标题，用「；」拼
f"未读到：{missing}"                            # missing = 字段名，用「、」拼
f"{字段}写的是「{raw}」，无法确定具体日期"        # 逐字段
```

→ 改成回 `{grade, rule_ids:[...], unknown_fields:[...], unparsed_fields:[{field, raw}]}`，
由前端 i18n 渲染。`grade_label` / `text` 字段**删掉**（D10 一刀切）。

🔴 连带要改的消费方（**同一批提交改完，否则门会红**）：
- 前端：`src/lite2/homeDerive.ts`、`src/lite2/screens/HomeScreen.tsx`（:332 / :607 / :685）、
  `src/lite2/transport.ts:289`
- 门：`verify-cr-alignment` · `verify-home-skeleton` · `verify-topbar-clearance` ·
  `tools/capture-align-board.mjs`
- 测试：`eval-harness/tests/test_decision_grading.py`（:439 / :498 / :558 断言 `LABEL_ZH`）

### 3.3 LLM 正文
- scaffold 里加语言指令，吃请求的 locale。
- 🔴 **红线不用补英文**：`redline.py` 已经是双语的——英文规则常驻，中文规则由
  `_has_cjk()` 分支（`_zh_violations` 的 docstring 明写 "English advice is wholly untouched
  by any ZH rule"）。但**两侧强度未必对等**：中文侧做过 round-2 的 work/job-grade 消抑调和，
  英文侧没那么多层。开工时抽查一下英文侧对"打分/排名"的覆盖，不足就补——
  但这属于**输出侧**红线，与 D6 说的输入侧词表是两回事，别搞混。

### 3.4 前端
- i18n 表补齐三个档位词与上述句子模板的 zh/en。**中英文都由当前 session 自己定稿、直接写大白话**
  （2026-08-03 改口径：以前绕道 M3 写"聪明"文案，实测效果更差；SaaS 感可以接受，
  把话说清楚 > 把话说巧）。红线不变：不给人打分、不替客户断言、可溯源。
- 删掉"label 取自 payload"的旧注释，换成指向 ADR-0033 的说明。

---

## 4 · 验收：一道双语门，四条判据

新门（建议名 `verify-locale-parity.mjs`，A 区、🔴 上传型、绝不能排在 C 区之后）。
**同一份中文语料**跑 `lang=zh` 与 `lang=en` 两遍，分别断言：

1. **界面壳无异语残留** —— en 下核心判读面板不出现中文字符；zh 下不出现英文残留。
2. **后端派生文案语言正确** —— 三个档位词与规则句渲染成对应语言。
3. **LLM 正文语言 == 请求 locale** —— 这条是 D3 的护栏，没有它 prompt 那句会无声失效。
4. **evidence 仍是中文原样** —— D4 的护栏，防止有人"顺手把引文也翻了"。

**门的纪律（本仓反复栽过，照做）**：
- 🔴 **born-red 必须两头都验**：造真违规看它红、撤掉看它回绿，两次输出都贴进证据。
  只验一头等于没验（0803 实测：一道门可以从"太宽＝假红"和"太松＝对着坏构建全绿"
  两个方向各撒一次谎）。
- 🔴 **带自证判据防空跑**：先断言"这一屏真的渲染出了判读卡/正文/引文"，再断言语言。
  采不到样的判据恒绿，那种绿最骗人。
- 🔴 **语料必须含真中文字节**（记忆 `gate-corpus-all-ascii-blindspot`）；
  可直接用 `eval-harness/tests/fixtures/demo-seed/` 那 9 份。
- 判据写**白名单**（"必须是这一种"），别写黑名单。

后端侧另加 pytest：结构化载荷形状 + 非法 locale 回落 en 且有 warning。

---

## 5 · 明确不在本票范围

- ❌ 英文文档解析（输入侧词表/正则英文版）——另一个量级，单开一票。
- ❌ `ask_api.py` 问卷 H5 文案双语（D7）——另一条用户旅程，单开一票。
- ❌ 用户账号级语言偏好（要动 schema + 登录态）——本票用 URL/构建期那条链就够。
- ❌ 引文翻译 / 中英并列（D4 已否）。

---

## 6 · 开工前先跑一遍的自查

```bash
node eval-harness/tools/run-battery.mjs --only=A --dry-run   # 看清 A 区实数与上传型标记
grep -rn "grade_label" src/ eval-harness/ --include=*.ts --include=*.tsx --include=*.mjs --include=*.py
```

第二条就是 D10「一刀切」的真实工作量清单——**改之前先把它数清楚**，
少改一处，门就会在最后一刻红给你看。
