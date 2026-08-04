# ⟳ 2026-08-03 · AFK 一口气吃完交接 A 档（★最新，从这里接）

> 接续只靠本文件 + `progress.md` + `feature_list.json` + git，不回放聊天。
> 更早的逐棒 handoff 已从本文件清出——考古用 `git log --follow session-handoff.md`。

**一句话**：上一棒把 9 条按「能不能 AFK」分了三档，本棒把 **A 档整档吃完**（5→4→7→1，条目 2 的
布局/文案类被 #34/#36/#37 覆盖），外加两个顺手挖出的真缺陷。`5e18e69 → a1f2652` 共 7 提交，
全电池 **30/30**，i18n 孤儿 **0**。

## 收尾状态：已 push，三张票已关

`main` 与 `origin/main` 已推平（`5e18e69 → 21cff90`，8 提交），工作树干净、HEAD 在 main。
`closes` 生效，**#34 / #36 / #37 三张 issue 均已 CLOSED**（已复核）。

**后端没动**——本棒一行后端代码都没改（改的是 src/ 前端、eval-harness/tools/ 门、scripts/、文档），
所以**不需要重建容器**，回滚梯与生产镜像维持上一版不变。
**前端** Vercel 自动跟 origin/main 部署。

### 生产核验（核到产物层，不是只看 200）

- `averylite.dannyqian.com` 的 `index-*.js` 里 `commit:"21cff904a855e158de8cd045f97d3307ea0cb061"`
  —— 与本地 HEAD **逐字相等**。
- 三条修复在线上 CSS 里逐条验到：
  · 让位带 `--lite2-bottom-band` 规则在场；
  · `upload-error-label{color:var(--terracotta-text, var(--terracotta))}`（AA 修复，覆盖基线那条装饰色）；
  · 胶囊 `calc(var(--lite2-footer-h, 56px) + 12px)`（让位实测页脚高度）。

---

## 本棒改了什么（7 提交，逐条可回滚）

| commit | 做了什么 |
|---|---|
| `18c8e7a` | gate-run 迁移第二波 5 道，迁前迁后输出**逐字节相同** |
| `b359f2e` | ROSTER 三道门 `backend:false` 是错的——它们真上传 |
| `159ed4c` | 上传错误态标签破 AA（4.33/3.85）+ 给门补错误态采样面 |
| `cdeca46` | snippet/gate.md 的「零后端·离线 stub」假前提 + 拆掉会漂的行号列 |
| `0300ce4` | #37 详情浮层假溯源 → 删，并立门 |
| `5debbe1` | #34/#36 屏底家具让位 → 抬滚动口边界 + 胶囊让位实测页脚高度，并立门 |
| `a1f2652` | i18n 孤儿键 12 → 0（考古 + 对抗复核后才删） |

## 🔴 这一棒学到的四条（会反复咬人，写门/改门前先看）

1. **「加一段注释」就能把一批 file:line 引用全顶漂，而且不会有任何东西变红。**
   我给 snippet 头加了一段 READ FIRST，一次顶漂了 gate.md 相位表整整一列行号 + 另外七处
   `头注释 NN,实现自带注释 NNNN-NNNN`。已全部改成函数名指路。
   **今后别在跨文件引用里写行号**——写函数名/`grep -n` 命令。（gate-run.mjs、run-battery.mjs
   头注释里各栽过一次，这是第三次。）

2. **注释里的「本区共 N 道」每加一道门就烂一次。** run-battery.mjs 那行长期写 17 而实际 20，
   之后 21、22、23……本棒直接把数字删了，改成写自查命令 `--only=A --dry-run`。
   同族的还有 `i18n-orphans.mjs` 的「叶子键不得少于 880」守卫——那个守卫**每次合法删键都会
   失效一次**，本棒被它拦下过；已改成带账本 + 报错文案直接问「是你有意删的还是 walker 瞎了」。

3. **一道门可以从两个方向撒谎，我两个方向都撞了一次（同一道门，一小时内）。**
   写 #34/#36 那道门时：第一版判据太宽（把 sticky 顶栏遮挡滚动内容也判红）→ **假红**，
   而假红门的下场是被人关掉；改成"可达性"（滚到视口中部再看）后太松 → **对着已知有 bug 的
   构建全绿**，比没有门更坏。
   定稿判据：当前静止滚动位 + 只把「劫持者是屏底锚定 fixed/sticky 家具」判红（靠计算样式判断，
   不写 class 黑名单）。**改判据之后必须两头都验：born-red 要红、born-green 要绿，缺一头都不算数。**

4. **`getBoundingClientRect` 不管裁剪。** 修完 #34/#36 之后门还在红，红的却是**已经被
   overflow 裁掉、根本没画出来**的按钮——它的 rect 照样报 y=714 这种"看起来在屏底"的坐标。
   凡是用 rect + elementFromPoint 的门，审之前必须先剔除被祖先 overflow 裁掉的控件。

## 判据够不着 ≠ 判据写错了（本棒两次都栽在这上面，值得单列）

- **AA 对比度**：07-20 那波清扫漏了 `.upload-error-label`，不是眼花——门走的是后端在场的顺路，
  **错误态根本不渲染**，那一整族文本从来没进过采样面。我是把 8137 停掉核别的事时偶然逼出来的。
- **#34/#36**：上一轮 46 条走查扫不到，因为数据态当时结构性不可达（`?transport=stub` 被 DEV 闸 DCE），
  而这两个组件在 `contextId=null` 时压根不挂载。

→ 今后写门先问一句：**这条判据能不能采到样？** 采不到样的判据是恒绿的，而那种绿最骗人。
本棒新加的两道门都带了**自证判据**（"工作区文件清单非空"/"浮层真开着且渲染了本卡内容"/
"这一屏有可审控件"），专门防这个。

---

# 🎯 下一棒（AFK）：#38 locale 契约 —— PRD 已 grill 完，可直接开工

B 档本棒**已经 grill 完并落成文档**，不用再问 Danny，直接进开发。

- **票**：[#38](https://github.com/daniel-qian/avery/issues/38)（`ready-for-agent`）
- **PRD**：`.issues/locale-contract-0803/prd.md` —— 11 条决议逐条拍板，含范围边界与验收
- **ADR**：[ADR-0033](docs/adr/0033-locale-is-a-request-field-backend-stops-emitting-prose.md)
  —— 架构决议 + **它反转了一条既有决策**（见下）
- **领域词**：CONTEXT.md 新增「Language surface（语言面）」条目

## 开工前必须先读懂这三件事，否则会做错

1. **票面严重低估范围。** 这不是"改三处 `LABEL_ZH`"。后端有 **396 处中文字符串字面量**，
   分成**性质相反**的两类：输出侧文案（要改）vs **输入侧检测词表/正则**（`extract.py` 93、
   `redline.py` 75、`granularity.py` 40……**一个字都不许动**）。
   🔴 **最容易犯的错**：看到 `extract.py` 一排中文就顺手双语化。那是用来**读中文文档**的
   匹配模式——客户文档是中文，词表就必须是中文，**即使界面切英文**。动了＝解析和红线当场瞎掉。
   「文档语言」≠「界面语言」。

2. **语言有四个互相独立的面**（界面壳 / 后端派生文案 / LLM 正文 / 引文），今天可以各说各话。
   说"把产品翻译成英文"这句话之前先说清是哪个面。详见 CONTEXT.md 那条新词。

3. **LLM 正文语言今天完全不受控**——prompt 里没有任何语言指令，输出语言是涌现的。
   模板改得再对，正文照样可能不听话。所以 D3（locale 进 prompt）和验收判据③是配套的。

## 已拍板、别再重开的决议（全文见 PRD §2）

真双语对等 · locale 沿用前端解析链随请求下传（optional，缺省 `en`，非法值回落 en + 告警）·
locale 写进 prompt · **引文永不翻译** · **后端不再产出人话**（只回机器键 + 结构化字段）·
契约**一刀切换**不并存 · 输入侧词表不动 · 问卷 H5 文案单开一票。

🔴 **ADR-0033 反转了一条既有决策**：`homeDerive.ts` / `HomeScreen.tsx` 里写着
「前端不硬编码三个档位词，一律取后端 `grade_label`」。新方向要求前端出词。
**保用意换载体**——那条规矩要的是"单一事实源"，不是"必须后端发"；改成后端发机器键、
前端查唯一 i18n 表，事实源仍只有一份。看到那两条旧注释别以为是自己搞错了，
连注释一起换掉，指向 ADR-0033。

## 第一步就跑这个（一刀切的真实工作量清单）

```bash
grep -rn "grade_label" src/ eval-harness/ --include=*.ts --include=*.tsx --include=*.mjs --include=*.py
```

它会列出所有必须**同批改完**的消费方：前端 3 处、**4 道门**（cr-alignment / home-skeleton /
topbar-clearance / capture-align-board）、`tests/test_decision_grading.py`。
少改一处，门会在最后一刻红给你看。

## 验收（PRD §4，别打折）

新门 `verify-locale-parity.mjs`（A 区、🔴 上传型、**绝不能排在 C 区之后**）：
同一份中文语料跑 zh/en 两遍，四条判据 —— ①界面壳无异语残留 ②后端派生文案语言正确
③**LLM 正文语言 == 请求 locale** ④**evidence 仍是中文原样**。
🔴 born-red **两头都要验**（本棒实测：一道门能从"太宽＝假红"和"太松＝对着坏构建全绿"
两个方向各撒一次谎）；🔴 带**自证判据**防空跑；🔴 语料必须含真中文字节。

---

## 其余待办

- **C 档仍归 Danny，别自己开工**：真机覆盖（只能他做）、真 brain 分流取证（真花钱，
  要先定"上限几次/打谁/超了就停"）、#30 已拍板不做。
- 想穿插低风险活：gate-run 迁移续做（先扩 makeRec 才能吃 aria-zh/cr-alignment）、
  r2 剩余未开票发现里的非布局类。

## 环境（收尾态）

- 工作树干净，HEAD 在 `main`（C 区跑完查过没 detach）。
- **mock 后端 8137 与 preview 5173 仍在跑**。后端起法（🔴 三件套缺一就真出网烧钱，
  且 seed 目录**必须绝对路径**——相对路径会被解成 `eval-harness/eval-harness/...` 而静默失效，
  症状是 `/demo/status` 报 `available:false`、onboard-gate 一条 FAIL）：

  ```bash
  cd /d/avery/eval-harness && AVERY_BRAIN=mock AVERY_EXTRACTOR=heuristic AVERY_EMBEDDINGS=keyword AVERY_DEMO_SEED_DIR="D:/avery/eval-harness/tests/fixtures/demo-seed" python -m uvicorn service.app:app --host 127.0.0.1 --port 8137
  ```

- `dist/` 是 `vite build --mode development` 的健康产物（apiBase 本地 8137，已验到 bundle 里）。
  碰上传路径前仍要先验一次 apiBase。
- 像素基线本轮重冻过（漂 4 张，都是 home，已人眼开图复核）。
