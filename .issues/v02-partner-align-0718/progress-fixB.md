# fixB · 文件真相（编码、上限、状态、类型）

分支 `fix/file-truth-encoding` · 工作树 `D:\avery-wt\fixB` · 从 `40ce59c` 切出

六条 finding（B1 / M2 / M3 / M4 / m5 / m6）全部修完，每条都有能证明自己有效的回归测试
（旧代码 FAIL / 修复后 PASS，输出见下）。

守的是同一条纪律，不是六个独立的 bug：

> **「我没读到」和「客户说没有」是两件事，永远不许混。**

---

## B1 · GB18030 中文文件被静默销毁（blocker）

### 病灶链条

```
utf-8 硬解 → 每个汉字变 U+FFFD → _MOJIBAKE_MAP 把 U+FFFD 抹成空串
（连"解码失败过"这个唯一证据也一并销毁）→ 剩一串拉丁垃圾 → 抽 0 人
→ HTTP 200 →「Ingested 1 file(s): 0 people」→ 文件标 ingested
```

全链路没有一处告诉用户文件没读进去。用户唯一能得出的结论是「Avery 读不懂中文」。

### 怎么修

`eval-harness/avery/ingest/parse.py`：

1. **新增 `decode_text()`，全程 strict 解码**，取代 `data.decode('utf-8', errors='replace')`。
   候选梯子按**原始字节的形态**排序，而不是写死一个顺序：
   - `_looks_multibyte()` 数高位字节的**连续游程**。汉字每字 ≥2 个连续高位字节；
     cp1252 的重音字母嵌在 ASCII 单词内部（`Björn`），游程恒为 1。
   - 多字节 → `utf-8 → (gb18030, big5) → cp1252`；单字节 → `utf-8 → cp1252 → (gb18030, big5)`。
   - **这个信号是双向必需的**：`Björn` 的 cp1252 字节在 gb18030 里**干净地**解出一个汉字、
     不报任何错。没有它，修好三亚就会弄坏瑞典。
2. **gb18030 与 big5 同一档，按可信度裁决而不是先到先得**（`_implausibility()`）：
   私用区（PUA）字符是最锐利的判据——它按定义就没有含义，解码器吐出它就是在猜。
   实测同一份繁体花名册：读作 big5 → 0 个可疑字符；读作 gb18030 → 8 个（含多个 PUA）。
   港台文件因此能被正确读出，而不是变成一串错字。
3. **`latin-1` 刻意不进梯子**（与任务书给的方案有意分歧，理由写进代码注释）：
   latin-1 映射全部 256 个字节值，**永远不会失败**。把它放在最后 = 任何文件都不会被报成
   读不出来 = 把同一个静默销毁的 bug 往下挪一层。cp1252 是这个想法里有用的那部分
   （它就是西欧 Windows 的「ANSI」），而且它**会**失败——5 个字节值未定义，
   正是这一点让它是一次检验而不是一枚橡皮图章。
4. **`_MOJIBAKE_MAP` 抹 U+FFFD 的行为重新审过**：不再是一条无差别的 translate。
   `_audit_replacement_chars()` 在 normalize **之前**跑，把两种情况分开：
   - 零星（feat-023 的 PDF 字形问题）→ 照旧清出语料，但**数量记进 `ParsedDoc.meta`**，证据留痕；
   - 成篇（≥8 个且占比 ≥8%）→ 抛 `DecodeError`。没解码出来的文件必须被报成没读进去。
5. `DecodeError` 是 `ParseError` 的**子类**——既有的「标 failed」链路一行都不用改。
6. `ParsedDoc.meta` 记 `encoding`（排一张支持工单时第一个要知道的事实）。

### 🔴 附带的红线绕过也修好了

同一条乱码链让**红线失效**：GBK 的绩效评分表乱码后不再匹配任何评分词，
于是安然通过了那道专门为它存在的闸。修好解码即修好这条，并有专门的测试守着
（`test_gbk_scoring_sheet_still_hits_the_red_line` + HTTP 端到端版）。

### 旧代码 FAIL

```
E   AssertionError: /ingest 抽出的人是 []
E   assert set() == {'张伟', '李娜', '王芳'}
E   AssertionError: gbk 编码的绩效评分表绕过了红线闸
E   assert not True
E    +  where True = ExtractionRedlineResult(ok=True, violations=[]).ok
E   KeyError: 'encoding'
```

浏览器里（真起后端 8302 + vite 5302，传 GB18030 花名册 + 一份读不出来的文件）：

```
rows: [{"name":"员工花名册.csv","status":null,"statusText":"","hint":"","tone":""},
       {"name":"坏文件.csv","status":null,"statusText":"","hint":"","tone":""}]
[FAIL] B1 · GB18030 花名册在真浏览器里长出了人 — 屏幕上找到 []
1/10 passed
```

### 修复后 PASS

```
27 passed in 1.42s          （eval-harness/tests/test_file_truth_encoding.py）
[PASS] B1 · GB18030 花名册在真浏览器里长出了人 — 屏幕上找到 ["张伟","李娜","王芳"]
10/10 passed                （浏览器端到端）
```

---

## M2 · 413 的人话文案写死了两个错的上限（major）

原文案 `the server caps 10 files, 10MB each` —— **两个数字都是错的**（真值 15 个 / 8 MiB），
而且单文件那个**比真上限还大**，用户照着它压到 10MB 重试永远撞同一堵墙。

修法是**删掉第三份副本**，不是订正它：

- `service/upload_guard.py` 新增 `human_bytes()`，把服务端 413 body 里的
  `8388608-byte per-file limit` 改成 `8 MB per-file limit`（真值本来就只有服务端知道）。
- `src/lite2/transport.ts` 的 413 文案**不再复述任何上限数字**，只说"哪一步、什么性质"。
- 新增 `withServerDetail()`：失败路径上把服务端自己的说法附在后面。FastAPI 的
  `{detail:{...}}` 和 ASGI 中间件的平铺 `{error, detail}` 两种形状都认。

同一个出口顺带解决了 B1 的"用户怎么知道是编码问题"——422 的 `parse_errors` 里那句
「另存为 UTF-8」现在会走到界面上。

**旧代码 FAIL**
```
[FAIL] M2 · 413 文案不再写死「10 files / 10MB」 — "ingest: too much at once — the server caps 10 files, 10MB each."
E   AssertionError: 413 没说人能看懂的上限: "'big.txt' exceeds the 2097152-byte per-file limit"
```
**修复后 PASS**
```
[PASS] M2 · 413 转达服务端的真实上限（8 MB，来自 guards.max_file_bytes）
       — "…'预算.xlsx' is bigger than the 8 MB per-file limit."
```

---

## M3 · accept 列表含后端不支持的类型（major）

`.doc` / `.xls` 在 accept 里但不在 `guards.SUPPORTED_EXTS` 里：**挑得出来、传得上去、必然 422**。
我们主动把人领进死路，还在终点告诉他文件有问题。

- `ACCEPT` 去掉 `.doc,.xls`，补上后端确实支持的 `.tsv`。
- 界面新增两行：逐个列出扩展名（`acceptedExts`）+ 旧格式怎么办（`acceptedLegacyNote`）。
  少列一种格式只是少一种；多列一种是撒谎。

**旧代码 FAIL** `accept=".pdf,.docx,.doc,.xlsx,.xls,.csv,.md,.markdown,.txt"` ·
`.upload-accepted-exts` = `null`
**修复后 PASS** `accept=".pdf,.docx,.xlsx,.csv,.tsv,.md,.markdown,.txt"` ·
`".pdf · .docx · .xlsx · .csv · .tsv · .md · .txt"`

---

## M4 · 后端每份文件都带 status，前端类型里没有、也不渲染（major）

和 B1 同一个病根：**读没读进去，必须让用户看得见。**

- `LiveFileEntry` 补 `status?: LiveFileStatus | string`。
- `UploadPanel` 每一行都表态，**包括成功的那些**——只标失败的，用户就得靠"没有标记"
  反推"读进去了"，那仍然是让人猜。
- 🔴 **缺席不等于成功**：老后端 / stub transport 不发这个键 → 显示「状态未知」，
  绝不默认渲染成「已读取」。
- 失败/空态附一句可执行的解释（编码不匹配 → 另存 UTF-8）。

**旧代码 FAIL**（两份文件在屏幕上一模一样，这就是整条 finding）
```
[FAIL] M4 · 两者在屏幕上**看得出不同**（这才是整条 finding） — ingested="" vs failed=""
```
**修复后 PASS**
```
[PASS] M4 · 两者在屏幕上**看得出不同** — ingested="已读取" vs failed="没能读取"
[PASS] M4 · 失败的那份给了可执行的解释（提到编码）
```

---

## m5 · 账号那两个端点是全 transport 仅有的两处裸 fetch（minor）

`fetchAccountContexts` / `claimContext` 绕开了 `send()` 的错误包装。行为判据：
fetch 自己 reject（跨境/离线/混合内容拦截）时，裸 fetch 把浏览器原文 `Failed to fetch`
抛给用户，而"api base 配错"这个最常见的部署事故在这里完全说不出话。

**旧代码 FAIL** `mod.withServerDetail is not a function` / 裸 fetch 抛 `Failed to fetch`
**修复后 PASS** `"account contexts failed — couldn't reach the server. Check your connection and try again."`

---

## m6 · 加密的 xlsx 被判成「伪装成 xlsx 的假文件」（minor）

Excel 的「用密码加密」产出的不是加密 zip，而是把整个 OOXML 包裹进 OLE2/CFB 容器
（ECMA-376）。它是**完全合法的文件**，而财务/HR 表格——正是本产品要人上传的那些——
经常这么发。回 `magic-byte mismatch` 等于当面说客户改了扩展名骗人。

`service/upload_guard.py` 新增 `office_container_reason()`，在 `check_type` **之前**跑：

- OLE2 + `EncryptedPackage`/`EncryptionInfo`（CFB 目录里的 UTF-16LE 流名）
  → 「这份文件有密码保护，打不开。另存一份不带密码的再传。」
- OLE2 但没有那两个标记 → 真的是旧格式 .xls/.doc 被改了名
  → 「另存为 .xlsx 再传。」仍然不收，但说的是**怎么办**，不是"你在骗人"。

**旧代码 FAIL** `AttributeError: module 'service.upload_guard' has no attribute 'office_container_reason'`
（旧行为：`declared '.xlsx' but the content is not an Office (zip) file (magic-byte mismatch)`）
**修复后 PASS** 3 条（含 HTTP 端到端）+ 1 条护栏（正常的 zip xlsx 不受影响）

---

## 跑过的门（全部真跑，输出如实）

| 门 | 结果 |
|---|---|
| `python -m pytest eval-harness/tests/ -q` | **2983 passed, 61 skipped, 4 xfailed**（基线 2956 + 新增 27，0 failed） |
| `npm run typecheck` | 0 错 |
| `npm run lint` | **0 error**, 5 warning（全部在我没碰的文件里，修改前就存在） |
| `npm run build` | ✓ built in 3.30s |
| `node .issues/v02-partner-align-0718/verify-fixB-transport.mjs` | **11/11 passed** |
| `node .issues/v02-partner-align-0718/verify-fixB-upload-ui.mjs` | **10/10 passed**（真浏览器 + 真后端） |

红/绿对照的做法：用 `git show HEAD:<path> > <path>` 把源文件临时退回 HEAD 跑一遍，
再从 scratchpad 的备份拷回来。全程只用了允许的 git 动词（`show`/`status`/`diff`/`log`/`add`/`commit`），
没有 checkout/switch/merge/rebase/reset/branch/worktree/push。

### 一次差点蒙混过去的假绿，记下来

浏览器红跑第一次时 `B1` 显示 PASS —— 因为后台那个**装着修复版 parse.py 的 uvicorn 进程
根本没被杀掉**，新起的进程绑不上端口，测试打的还是旧进程。
`pkill` 在这台 Windows 上对后台起的 python 无效。改用 `netstat -ano` 拿 PID + `taskkill //PID //F`
确认端口释放后重起，并**单独探一次 `/ingest` 确认它真的是旧代码**（GBK → 0 人）才重跑。
之后 `B1` 如实 FAIL。教训：起停服务的红绿对照，必须独立探针确认"跑的到底是哪份代码"。

---

## 端口

用完即停，`netstat` 确认 8302 / 5302 均已释放。全程未占用 5173 / 8137。

---

## Notes（顺手发现，**没有顺手修**）

1. **`briefing()` 的 headline 会替客户说没有的话** ——
   `eval-harness/avery/ingest/registry.py:221` 拼的是
   `Ingested {n} file(s): {n_people} people, {n_proj} projects.`
   一份 failed 的文件同样被算进 "Ingested N file(s)"。M4 让文件清单说了实话，
   但**首屏那句话仍然把没读进去的文件算作已摄入**。registry.py 不在本轮文件边界内。
   → 见下方 `needsOtherFiles`。

2. **doc_kind 路由器的另一个洞（不是编码问题）** ——
   `sniff_kind` 对「员工绩效评分表.csv」判 `unknown`：`_KIND_HINTS` 的 roster 行只认
   `名册 / 员工名单 / 人员名单 / 团队名单`，不认「绩效评分表」这类文件名。
   `unknown` 不匹配任何抽取分支 → 抽 0 人 → **红线也就无从触发**。
   也就是说：一份**文件名叫「绩效评分表」**的中文评分表，即使编码完全正确，
   今天依然抽不出人、也不会被红线拦。我的测试因此刻意用「员工花名册.csv + 绩效评分列」
   这个真实形态（extract.py 自己的注释也点名过这种表）。
   这是路由器的洞，与 B1 的编码洞正交，**本轮未动**。

3. **`ingest_api.py` 还剩一处字节数上限文案** —— 批次总量那处 413
   （`batch exceeds the {total_cap}-byte per-request limit`）不在本轮文件边界内，
   仍是机器数字。中间件和 per-file 两处已改人话。

4. **状态徽章目前用内联样式** —— 本轮文件边界不含样式表，而一个**看不见的**状态徽章
   等于没修 M4。已带 `className` + `data-status` / `data-tone` 钩子，
   集成方可平移进 lite2 样式层，行为不依赖 CSS。

5. **`stubTransport.ts` 的 `fetchFiles` 不发 `status`** —— 因此 stub 面（AFK 门/离线演示）
   会显示「状态未知」。这是刻意的正确降级（缺席≠成功），但如果希望 stub 面也演示三态，
   需要动 `stubTransport.ts`（不在本轮边界内）。
