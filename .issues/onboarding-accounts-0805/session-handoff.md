# onboarding-accounts-0805 · 开票 session 交接（2026-08-05）

本线状态：**盘问完毕、票已开齐、未写一行产品代码。** 开发在同 worktree 的另一 session
进行，完成后回开票 session 查收。

## 已产出

- **ADR-0034**（`docs/adr/0034-onboarding-revamp-structured-intake-account-step.md`）——
  10 项拍板全文 + 否决理由。supersede 了 ADR-0030 的「7 张表不做 app 内表单」否决点。
- **GitHub 票**：父票 #39；子票 #40（后端结构化端点）/ #41（前端 7 表 UI）/
  #42（向导重组）/ #43（账号步）/ #44（E2E 门 + 凭据墙修订）。
  依赖序：#40 与 #42 并行 → #41 → #43 → #44。每张票自足（文件路径、映射规则、
  验收判据、已知陷阱都在票面）。

## 开发 session 开工前

1. 读 ADR-0034（拍板即约束，别重新发明）+ 认领的那张票全文。
2. AGENTS.md Startup Workflow 照常（feature_list.json / progress.md / init.sh）。
3. 本 worktree 分支 `claude/onboarding-flow-accounts-1e3be2`；commit 前后查 branch
   （绝对路径会脚下换分支，旧账）。

## 查收 session（回到开票线）要核的

- 全电池绿 + 后端 pytest 四排除项绿——但**门全绿≠真部件被验到**：
  向导五步 + 预览模式 + 表格粘贴提交，逐屏截图人眼过。
- #40 的红线整发 422：07 表塞分数实测被拒且 violations 指到行。
- #44 连跑两遍（第二遍证清理幂等）+ 反向断言 born-red 自证。
- 像素基线在 main 检出重打，不在 worktree 里重量。

## 盘问中探明、但没进票面的杂项

- 生产 `/account/status` 2026-08-05 实探 200 `{"configured":true}`（0805 容器）——
  账号路由与 Supabase env 在当前镜像里活着，#43/#44 不需要先修部署。
- 合伙人静态稿共 6 张图（5 步 + 表 04/06 两张表格特写），表格列与
  `make-intake-xlsx.py` FORMS 逐列对得上——静态稿就是照模板画的，表定义同源可行。
- `owns` 编辑框往返有损（progress.md 里挂着的老账）与本战役无关，但 #41 拆分
  规则（`[,，、;；]`）与它同族——#41 实现时别顺手「修」它，单开的票在 progress.md。
