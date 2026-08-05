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
- 后端 pytest **3527 passed**（新增 53 条：locale 契约 28 + 决策文案 i18n 对账 11 + 红线补漏 14）。
- 像素基线 **未动**：像素门跑的是 `lang=zh`，而本轮的 CJK 标点清扫只改英文侧渲染，
  中文侧逐字不变，所以 B 区 4/4 直接绿——不是"没人看"，是真的没漂。
- HEAD 在 `main`，C 区跑完查过没 detach。

---

## 收尾状态：**前后端已同批上生产，两端各自核到产物层**

[部署回执](.issues/locale-contract-0803/receipt-deploy-0804.md)。ADR-0033 是一刀切、不做新旧并存，
所以两半必须同批上——「新前端 + 旧后端」不崩，但 4 条带阈值的规则标题里占位符会渲染成空，
且 `/advise` 的 locale 被忽略（＝回到"正文语言靠涌现"）。

- **前端**：`c94a7e7..89b36e4` push → Vercel 自动构建。线上 `assets/index-CqAuE9zj.js` 里
  `commit:"89b36e4f…"` 与本地 HEAD **逐字相等**；8 条判读文案（`By the rules this is` /
  `Clear to proceed` / `Straight from your files` / `R-BLOCKER-STACK` / `按规则判为` / `看的字段` …）
  逐条核到线上产物。
- **后端**：`avery-agent:main-20260804-153841`，从 `/home/admin/build-zh` @ `89b36e4` 构建
  （🔴 从 main，不挑子集）。8138 隔离预检（只走不写库的路径）→ `swap3.sh` 换容器 →
  **SWAP SUCCESS**，健康闸 1×2s 过。预检容器已 `docker rm -f`。
  回滚梯：`sudo docker rm -f avery && sudo docker rename avery-prev-20260804-153841 avery && sudo docker start avery`
- 🔴 **「镜像里是不是新代码」是用容器内的纯 Python 断言验的，没打 `/advise`** ——
  生产是真 brain（minimax），那是一次**真花钱**的调用。断言：`locale` 在 `AdviseRequest` 上 ·
  `normalize_locale('zh-CN')` 回落并告警 · 载荷里 `grade_label` 已消失 · 命中键带 `params` ·
  规则版 `reason` 为空串。
- **本次部署全程零写库**（没有任何上传 / `/advise`）。
- 一并带上生产的还有 4 条不属于本票、此前积压在 main 上的后端提交
  （`1ce41aa` seam 清理 · `3d4c523` brain 超时告警 · 三条纯文档 + ADR 索引），
  逐条列在部署回执里。

**唯一没验的一段**：真 brain 的 `/advise` 端到端——即「真模型听不听 prompt 里那句语言指令」。
链路本身已在本机 mock 上跑通（门 48/0），prompt 那一段有 pytest 逐条断言。
这一跑要花钱，命令写在部署回执末尾，归 Danny 拍板。

## 这一棒改了什么（三提交，逐条可回滚）

| commit | 做了什么 |
|---|---|
| 契约切换 | 后端停发人话 + locale 进契约 + LLM 语言指令 + 前端 i18n 表 + 4 道门改形 + 新门 |
| 红线补漏 | 英文侧「打分/排名」四个漏 + 6+8 双向回归测试 |
| 部署 | 前后端同批上生产 + 部署回执 |
| 标点清扫 | 全仓 `{'：'}` ×6 + `owns` 拼接符 ×1，连接符键改名 `listJoin` |
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

1. **真 brain 的 `/advise` 生产端到端**（唯一没验的一段，见上面收尾状态那节）：
   它回答的是「真模型听不听 prompt 里那句语言指令」，不是「代码通没通」（后者门和 pytest 已答）。
   要花一次真调用，命令在部署回执末尾，**归 Danny 拍板**。
2. **`R-NO-EVIDENCE` / `R-UNCLASSIFIED` 现在没有 evidence 行**——有意为之（证据面按定义为空），
   但界面上这两条规则只剩标题和依据，看起来比别的规则"薄"。要不要补一句
   「这条规则本来就没有可引的原文」是文案题不是契约题，留给下一轮 UI 走查判。
4. **r2 剩下的未开票发现**（`.issues/sweep/2026-08-02-r2.md`，按屏分好了）。
5. **gate-run 迁移继续**：`verify-aria-zh` / `verify-cr-alignment` 仍未迁（形状不兼容，
   要先扩 makeRec：4 参数 future 语义 / 多累积数组模型）。**已迁/未迁一律用自查命令数。**
6. **C 档仍归 Danny，别自己开工**：真机覆盖（只能他做）、真 brain 分流取证（真花钱，要先定
   "上限几次/打谁/超了就停"）。
   ⚠ 本票的语言指令**只在 mock 上验过链路、在 prompt 上验过字符串**；
   「真模型是否真的听那句话」要等真 brain 取证那一步才能回答——门的判据③盯的是链路不是模型。
