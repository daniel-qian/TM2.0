# P0 十一条 —— 收尾交接（0719）

这条线到此为止。Danny 会开新 session，对着本线和前端部署线（feat-068）两份 artifact
先审一遍、消掉两条线在推进方向上的重复/冲突，再统一往下走。下面是新 session 接手需要知道的**全部**。

## 一、代码在哪

全部已合进本地 `main`，工作区干净，**只提交、没 push**（`push main = 自动上生产`，那是 Danny 的闸）。

- HEAD：`b1307d9`，`main` 领先 `origin/main` 18 个提交
  > 🔴 **07-19 更正**：已作废。`origin/main` = **`de47ffe`**，本地 `main` **ahead 0**，
  > 全部已 push，**线上前端就是 `de47ffe` 构建的**。本节标题「只提交、没 push」整段不再成立
  > ——Danny 在 AFK kickoff 里授权了那道闸，已经用掉。
- 我开的 feature/fix 分支已全部合入并删除；`git branch --no-merged main` 里剩下的
  （`claude/*`、`p5-04-nexus-safe-zone`）不是本线的东西，别动
- `D:/avery-wt/verify` 是个游离 worktree，内容已全在 main 里，但**不确定是不是部署线的**，我没删

## 二、结论文档的阅读顺序

1. `integration-findings.md` —— 本线最有价值的产出。合流后那轮对抗审查的 15 条全文（含 5 条 blocker）、
   已修/已记录未修的分界、以及回答部署线「旧后端下会不会崩」的实测结论
2. 验收 artifact（Danny 手上有链接）—— 十一条逐条状态 + 要 Danny 判断的四件事
3. `progress-feat-0*.md` / `progress-fix*.md` —— 单条线的过程记录，只在追某一条的来龙去脉时才需要看

## 三、复跑（不需要读代码就能验）

```
node .issues/v02-partner-align-0718/verify-p0.mjs        # 41 条行为断言 × paper/aurora
node .issues/v02-partner-align-0718/verify-blockers.mjs  # 5 条 blocker 在合并后的树上复验
node scripts/css-brace-check.mjs                         # CSS 括号配平
```

`b1307d9` 上最后一次实跑：verify-p0 **41 PASS / 0 FAIL**、verify-blockers **15 PASS / 0 FAIL**、
pytest **3300 passed / 0 failed / 52 skipped / 4 xfailed**（排除 `test_seed_gate.py`，它依赖真 LLM、非确定）、
typecheck 0 错、lint 0 error、i18n 中英各 577 键零缺失、锁定词 0 命中。

⚠️ 跑全量 pytest 会**真调 MiniMax、真花钱**（约 11 分钟/次）——`service/app.py` 导入时加载
`eval-harness/.env`，里面有真 key。各条线 evidence 里写的「无 key、无法验证真 LLM」是错的。

## 四、交给新 session 的三个未决点

1. **不重建后端，五条 blocker 里的四条（编码、否定短语、首屏摘要、鉴权 oracle）都不在线上** ——
   线上后端仍是 07-17 的镜像。重建会连带把迁移 `0008` 推上生产库，是 Danny 的闸
   > 🔴 **07-19 更正：结论仍然成立，但理由写错了两处。**
   > ① **线上后端不是 07-17 的镜像**——07-18 23:25 就换成了 `avery-agent:zh512`（源 `512b11d`），
   >    那一版已经带上中文 id/去重/部门的修复。四条 blocker 不在线上这半句不受影响。
   > ② **卡点也不是 `0008`。** Danny 已授权只挑不碰数据库的子集（`6f838f3` + `d184b6c`），
   >    但复核在 `6f838f3` 自己身上停住了：编码梯子只有 `("gb18030","big5")`，取第一个不抛异常
   >    的那级，而 **gb18030 解 Shift_JIS / EUC-KR 不抛异常** —— 日/韩花名册会被静默读成编造的
   >    汉字并回「已读入」。修它的 `a45bb4a` 在授权范围外。**后端至今一行未动。**
   > ③ 另外：`requirements-service.txt` 一个版本都没钉，基础镜像也没钉 digest ——
   >    **任何一次重建都同时是一次范围不受控的依赖升级**。重建前先钉版本。
2. **两条线的推进方向有重复/冲突**（本线的 P0 收尾 vs 部署线的 #10/#12/#13/#15/#16/#17），
   这正是新 session 要先裁的
3. artifact 第六节「我自己留下的账」里三条方法论教训，别当花絮读——
   其中「四道机器门全绿但整块样式失效」直接决定了要不要给 verify-*.mjs 挂自动门（现在没挂）
