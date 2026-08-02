# sweep-promote-0802 · 本线交接（2026-08-02 · 菜单已走完）

> 上一棒交接（合并前的那份）已被本文件整体替换——它的「下一棒菜单」三条**全部做完了**。
> 本线的完整证据链：`receipt-deploy-0802.md`（上线+盘点）· `../sweep/2026-08-02-r2.md`（第二轮走查）
> · `git log 12282e8..c255b87`（21 个提交，每票一提交）。

## 三件都做完了

| 菜单 | 结果 |
|---|---|
| ① 合并上线 + 生产盘点 | 12 提交快进合 main、前后端全量上生产；**盘点 0 条**（9 条命中全是 demo 克隆残骸，已被 GC 扫掉）|
| ② 文档保洁 19 条 | **19/19 落地，0 弃票**；分三波、每票一提交；两轮 opus 复核 11 条 fix-needed 全修 |
| ③ 第二轮 UI 扫 | **20 条，REGRESSED 0**；3 条 hard-contract 已开票 #34/#36/#37 |

## 本线最该被下一棒记住的三件事

**1. 上一轮 46 条走查发现里，12 条是同一个 harness 破口造成的假象。**
`?transport=stub` 在 `vite build` 产物里被 DEV 闸整段 DCE，页面根本进不了数据态；
那 12 条 hard-contract 全在描述这一件事，不是产品缺陷。换成
`__lite2Store.uploadFiles()` + 真 mock 后端之后整族消失。
👉 驱动已落库：`eval-harness/tools/sweep-r2-driver.mjs`，两道自检写死在里面
（apiBase 必须本地 8137、后端必须离线三件套，**验不过 exit，不假跑**）。

**2. 「没有机械 runner 的判定组」= 从来没被跑过。**
给 snippet 的 B/C 判定组补上 runner（票 #14）的第一次跑就 6 PASS/2 FAIL——查下去发现共享助手
`_clickTab('Follow-ups')` 自 0721 起就永久失效（tab 拆成 main/sub 两层，整颗 textContent
变成 'To-do listFollow-ups'）。**这意味着 gate.md 那套人工注入协议也一直是坏的**，
任何人照文档手跑 B 组都会卡在同一处。已在 snippet 侧修好（一次修好全部调用方），
新门里的绕过补丁**整段删掉**——留着就是把上游的坏掩盖成局部的绿。

**3. 本轮抓到的东西里，一半是"验证本身在撒谎"。** 逐条：
- 生产写路径探针第③步 400 未写入，第④步的"字节相同"是**空真**（换 Python 拿到真 200 才算数）；
- 我自己的走查驱动把 paperwork 十份产物全采成了 home（`screen` 字段与 `url` 字段当场打架）；
- 同一驱动的 `bareButtons` 按 class 白名单数，报 11/15 全是误报——量的是命名习惯不是缺陷；
- 新立的 eslint 墙**承诺得比拦得多**：`<Link to={PAPERWORK_PATH}>` 能溜过去，而那恰恰是它要防的原始 bug 形状；
- 像素门报 4 张漂移，重冻后实际漂了 **26** 张——它首处不匹配就中止整条 test；
- ROSTER 里 status-truth 的 `backend:false` 是错的（它真上传），skin-phases 的"走 stub 所以不碰后端"理由是假的。
👉 所以本轮所有新加的机器门都做了 born-red。**证明不了它会红的门，是一个无声的零。**

## 环境状态（收工时）

- 工作树干净，`main` 与 `origin/main` 推平在 `c255b87`。HEAD 在 main（C 区门跑完查过）。
- mock 后端 8137（离线三件套）与 preview 5173 **仍在跑**——下一棒可以直接用；
  dist 是 `vite build --mode development` 的健康产物（apiBase 本地 8137）。
- 本地 `avery-pg`（5433）容器留跑。
- 走查产物 `.issues/sweep/2026-08-02-r2-shots/` 220 份（untracked，已进 .gitignore）。

## 下一棒该看哪

不再由本文件排菜单——**统一看 `progress.md` 的 What's Next**（本轮已整体换血）。
其中与本线直接相关的两条：r2 剩下 17 条未开票的发现；snippet 头注释那套"零后端/离线 stub"
的假前提值得单开一票刷掉。
