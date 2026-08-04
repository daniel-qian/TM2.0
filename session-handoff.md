# ⟳ 2026-08-04 · #38 locale 契约（判读链路双语对等）（★最新，从这里接）

> 接续只靠本文件 + `progress.md` + `feature_list.json` + git，不回放聊天。
> 更早的逐棒 handoff 已从本文件清出——考古用 `git log --follow session-handoff.md`。

**一句话**：把判读链路的语言从"涌现"变成**契约里的一个字段**——后端从此一句人话都不发，
句子全部由前端按 locale 渲染，并立了一道 48 判据的双语门看着这条链。
PRD 的 11 条决议全部落地，另外顺手挖出并修掉三个真缺陷 + 补了英文侧红线的四个漏。

- **票**：[#38](https://github.com/daniel-qian/avery/issues/38) · **PRD**：`.issues/locale-contract-0803/prd.md`
- **ADR**：[ADR-0033](docs/adr/0033-locale-is-a-request-field-backend-stops-emitting-prose.md)
- **回执（逐条对着 PRD §3 写的，细节看这份）**：`.issues/locale-contract-0803/receipt.md`

## 账实

- 全电池 **31/31**（A 25 / B 3 / C 3）——新增 A 区 `verify-locale-parity`（**48 PASS · 0 FAIL**）。
- 后端 pytest **3513 passed**（新增 39 条 + 红线补漏 14 条）。
- 像素基线 **未动**（本轮没改布局，B 区 4/4 直接绿）。
- HEAD 在 `main`，C 区跑完查过没 detach。

---

## 🔴 收尾状态：**后端还没重建**（这是本棒唯一的硬账，下一棒第一件事）

前端 push 到 main 会被 Vercel 自动部署；**后端是手动换容器的，本棒改了后端**，
所以线上会短暂处于「新前端 + 旧后端」。

**这个组合坏成什么样（已逐条推过，不是猜的）**：不崩、不白屏，唯一可见的退化是
`R-BLOCKER-STACK` / `R-DUE-SOON` / `R-PROGRESS-LOW` / `R-DUE-VS-PROGRESS` 这 4 条规则的标题里
阈值占位符**渲染成空**（"「」天内到期"），因为旧后端不发 `matched_rules[].params`。
其余全部兼容：`grade` / `rule_id` / `hit.grade` 旧后端都发；旧后端多发的 `grade_label`、
中文 `reason` 前端一律不读（`reason_source==='rule'` 时走前端拼句）。
`/advise` 的 locale 会被旧后端忽略——即回到本票之前的"正文语言靠涌现"。

**重建怎么做**（沿用 0802 那套，一步不删）：

```bash
ssh -i ~/.ssh/id_ed25519 admin@8.211.28.11
# 构建目录 /home/admin/build-zh，git reset --hard origin/main（🔴 一律从 main 构建，不挑子集）
# 镜像 avery-agent:main-<ts>；env 从在跑容器提取（只取 MINIMAX_/DASHSCOPE_/DEEPSEEK_/AVERY_/SUPABASE_ 前缀）
# 🔴 隔离 8138 预检：只走不写库的路径（/health + /demo/status），预检容器连的是生产库
# 换容器用 /tmp/swap3.sh（不是 swap2——swap2 会丢 demo-seed 挂载）
# 预检容器跑完必须 docker rm -f；回滚梯记进回执
```
现跑镜像 = `avery-agent:main-20260802-113944`（= `0884d49`），回滚梯在它旁边。

**换完之后加验一条本票专属的**（不需要写库）：

```bash
curl -s -X POST https://avery.dannyqian.com/advise -H 'Content-Type: application/json' \
  -d '{"situation":"delivery is slipping, how do I talk to the lead?","stream":false,"locale":"zh"}' \
  | python -c "import sys,json;print(json.load(sys.stdin)['advice']['summary'][:60])"
```
真 brain（minimax）在线时这句该回**中文**。回英文 = 语言指令没进 prompt 或镜像没换成功。
另：发一个非法 locale（`"locale":"zh-CN"`）到日志里找 `unsupported locale` 那条 warning——
**这是判断"跑的是不是新代码"最快的一招**（见下面的环境坑）。

---

## 这一棒改了什么（三提交，逐条可回滚）

| commit | 做了什么 |
|---|---|
| 契约切换 | 后端停发人话 + locale 进契约 + LLM 语言指令 + 前端 i18n 表 + 4 道门改形 + 新门 |
| 红线补漏 | 英文侧「打分/排名」四个漏 + 6+8 双向回归测试 |
| 收尾 | progress / feature_list(feat-096) / archive / handoff / 回执 |

细节全在回执里，这里只留**下一棒会踩的东西**。

## 🔴 这一棒学到的三条（写门/改后端前先看）

1. **一把太宽的尺子可以让一条正确的判据对着真违规全绿。**
   新门判据 ④「引文仍是中文」第一版用的是**宽口径 CJK 正则**（含全角标点）。born-red 探针
   把 evidence 里的汉字全翻成英文之后，剩下的那个**全角逗号**照样让判据通过——屏幕上摆着的
   「文档原文」已经一个字都不是原文，门却说验过了。
   定稿：**拆成两把尺子**（壳残留用宽 CJK，必须逮得住全角冒号；引文用只认汉字的 `HAN`）
   ＋主判据换成**「每行引文逐字出自上传语料」**——"两遍逐字相同"只逮得住"只在英文界面翻"
   这一种写法，一个对两种语言都生效的翻译会让两边仍然相等。

2. **自证判据这一轮兑现了三次，三次都是"判据够不着"，主判据一次都没吭声。**
   ① advise 留在 home 屏问、而判读卡只在 room 屏渲染 → 采样为空、`[].every()` 恒真；
   ② 只展开第一张决策卡 → 采样面从 19 行缩到 4 行，覆盖面缩水而不会有任何提示；
   ③ 后端 pytest 里取错了响应键（`payload` 而实际是 `advice`）→ 取到空串。
   三次都是"先断非空/先断真渲染"那一句先红。**新写的每一条语言判据前面都配了一条自证。**

3. **文案搬家会顺手把守它的测试变成恒真，而且不报错。**
   `_compose_reason` 搬到前端之后，后端那两条红线/禁词测试跑的是**空串**——`'' not in ...` 恒真。
   处理方式是**跟着搬**（`tests/test_decision_i18n_contract.py` 用 Python 读 TS 文案表，
   把同一张禁词表和同一个 `redline.validate` 对准前端那几十条真文案），原地各留一条哨兵。
   🔴 那个解析器**故意脆**：解析不出预期条数就直接失败，绝不返回空字典让下面几十条断言"全绿"。

## 环境坑（本棒真被咬了一次，排查了半天）

🔴 **`pkill -f "uvicorn service.app"` 在本机 Git Bash 下不生效，而且不报错。**
改完后端"重启"了一次，`ps` 只看到一个 python、日志也在正常收请求，跑门却仍拿到旧行为——
旧进程根本没被杀掉，服务的是改动前的代码。**别信 ps，信行为**：发一个非法 locale，
看日志里有没有 `unsupported locale` 那条 warning，没有就是旧代码。可靠杀法：

```powershell
Get-CimInstance Win32_Process -Filter "Name='python.exe'" | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
```

其余环境照旧（🔴 后端三件套缺一就真出网烧钱，seed 必须**绝对路径**）：

```bash
cd /d/avery/eval-harness && AVERY_BRAIN=mock AVERY_EXTRACTOR=heuristic AVERY_EMBEDDINGS=keyword AVERY_DEMO_SEED_DIR="D:/avery/eval-harness/tests/fixtures/demo-seed" python -m uvicorn service.app:app --host 127.0.0.1 --port 8137
```
前端：`tsc -b` → `vite build --mode development` → `vite preview --host 127.0.0.1 --port 5173`
（`--mode development` 与 `--host 127.0.0.1` 都不能省）。门一律从**仓库根**跑
（playwright 从 `node_modules` 解析，`cd eval-harness` 之后 `node eval-harness/tools/...` 会双拼路径）。

---

# 🎯 下一棒的活（按优先级）

1. **后端重建上线**（见上面那节，含本票专属的验收 curl）。这是唯一的硬账。
2. **`{'：'}` 写死在 JSX 里的还剩 6 处**：`grep -rn "{'：'}" src/` →
   DetailOverlay ×4 / ProjectsScreen / TeamScreen。与本票同病（英文壳里的 CJK 标点），
   但都在**卡片详情面**不在判读链路，而且有像素基线覆盖（改宽度要重冻）。单开一票扫。
3. **`R-NO-EVIDENCE` / `R-UNCLASSIFIED` 现在没有 evidence 行**——有意为之（证据面按定义为空），
   但界面上这两条规则只剩标题和依据，看起来比别的规则"薄"。要不要补一句
   「这条规则本来就没有可引的原文」是文案题不是契约题，留给下一轮 UI 走查判。
4. **r2 剩下的未开票发现**（`.issues/sweep/2026-08-02-r2.md`，按屏分好了）。
5. **gate-run 迁移继续**：`verify-aria-zh` / `verify-cr-alignment` 仍未迁（形状不兼容，
   要先扩 makeRec：4 参数 future 语义 / 多累积数组模型）。**已迁/未迁一律用自查命令数。**
6. **C 档仍归 Danny，别自己开工**：真机覆盖（只能他做）、真 brain 分流取证（真花钱，要先定
   "上限几次/打谁/超了就停"）。
   ⚠ 本票的语言指令**只在 mock 上验过链路、在 prompt 上验过字符串**；
   「真模型是否真的听那句话」要等真 brain 取证那一步才能回答——门的判据③盯的是链路不是模型。
