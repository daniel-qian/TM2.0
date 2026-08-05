# onboarding-accounts-0805 · 交接（开票 → 开发 → 待查收）

本线状态：**五张子票（#40–#44）全部做完并 push，等查收 session 验收。本 session 不合 main。**
分支 `claude/onboarding-flow-accounts-1e3be2`，worktree `D:\avery-wt-onboarding-flow-accounts-1e3be2`。

---

## 一、开票 session 已产出（2026-08-05 上半场）

- **ADR-0034**（`docs/adr/0034-onboarding-revamp-structured-intake-account-step.md`）——
  10 项拍板全文 + 否决理由。supersede 了 ADR-0030 的「7 张表不做 app 内表单」否决点。
- **GitHub 票**：父票 #39；子票 #40（后端结构化端点）/ #41（前端 7 表 UI）/
  #42（向导重组）/ #43（账号步）/ #44（E2E 门 + 凭据墙修订）。

## 二、开发 session 做完的（下半场，五个 commit）

| commit | 票 | 一句话 |
|---|---|---|
| `6c1ec72` | #40 | `POST /ingest/structured`：7 表行确定性映射进 context，跳过抽取 |
| `831168e` | #42 | 向导重组 5 步 + 预览模式 + 连接工具/管理框架两步 |
| `6b1d221` | #41 | 第①步接上 7 表录入网格：粘贴 / 单元格级校验 / 与文件合一发提交 |
| `e87908c` | #43 | 第⑤步实装：真 Supabase 注册 + 自动认领 + 可跳过 |
| `caf4f52` | #44 | 账号链路第一次真跑（E2E 门）+ 凭据墙修订 |

每个 commit message 都写着「为什么这么做 / 撞到过什么」，查收时那是最快的入口。

### 这一轮真正的骨架：**表定义只有一处真源**

同一份「列名 / 列序 / 必填 / 下拉词表 / 填写提示 / 值的形状 / 红线面 / 跨表引用」现在被
**四方**消费（发给客户的 xlsx、后端映射、前端网格、单元格校验）。真源仍然只有
`scripts/make-intake-xlsx.py` 的 FORMS 一处，新增 `scripts/gen-intake-schema.py` 把它编译成
两份生成产物（`eval-harness/avery/ingest/intake_schema.json` + `src/shared/intakeSchema.ts`），
漂移门逐字节比对。**前端与后端里都没有一个列名字面量。**

后端的红线扫描面也从这份声明里取（`redline: "hard"`）——前端标红哪几格 = 后端扫哪几格，
不是两份手抄的列名。分家的症状是这条线上最糟的一种：前端标红说"会被拒绝"而后端放行。

---

## 三、验证账实

| 项 | 结果 |
|---|---|
| 全电池 | **A 26/26 · B 2/3 · C 4/4** —— 唯一非绿是 visual-baseline，**它没比对任何东西**，见「四」 |
| 后端 pytest（四排除项） | **3564 passed · 4 xfailed**（基线 3528 + 新增 36 条） |
| `./init.sh`（lint + typecheck + build） | 绿 |
| needs_db（本地 pg17 :5433） | **69 passed**（基线 65 + 新增 4 条真库往返） |
| 账号链路 E2E（真 Supabase） | **19/19 连跑两遍** + born-red 自证 18/19（反写的那条确实红） |

在册门数从 31 涨到 33：A 25→26（+intake-tables）、C 3→4（+onboard-account）。
数字以自查为准：`node eval-harness/tools/run-battery.mjs --dry`。

### 新增的门（三道）

| 门 | 区 | 判据数 | 量什么 |
|---|---|---|---|
| `verify-intake-tables.mjs` | A（上传型） | 42 | 7 表导航/表头逐字/容器内滚 · 真剪贴板 paste · 单元格校验五型 · **红线两侧同量** · 表格+文件合一发 |
| `verify-onboard-account.mjs` | C（dist 调包者） | 27 | 向导第⑤步五分支：自动认领 / 邮箱确认不假装已登录 / 人话报错 / 跳过后游客路径完好 / 未配置整步隐去 |
| `verify-account-e2e.py` | **不进电池** | 19 | 真 Supabase：注册→登录→认领→双账号隔离。见 `account-e2e-runbook.md` |

前两道已进 `run-battery.mjs` 的 ROSTER。第三道是 needs_keys 性质（真网络真凭据真账号），
**故意不进**默认离线电池——那份电池的前提是零花费零外网。

### 改动过的既有门（判据跟着行为一起改，都记了理由）

- `verify-onboard-gate.mjs`：+世界 G（预览模式）。判据不是"横幅在场"（那只验证了排版），
  而是在三个持久化面各留一笔再退出、断言 localStorage **逐字节未变**。另加 chips 的
  `data-chip-state` 断言（显示值与判据值分开）。
- `verify-onboarding-returning.mjs`：「重看从三扇门起」→「重看进预览模式」，换口径的理由
  写在门里（点这个按钮的人按定义是有数据的老客户，让他重走真向导等于给生产工作区开覆盖口）。
- `verify-button-family.mjs`：新增两个多选卡族进白名单。
- `lite2:onboard:v1` → `v2` 全仓同步（另有两道门引用它）。

---

## 四、全电池（A→B→C，隔离端口）

```
A 区 26/26 绿   （topbar-clearance … locale-parity，含新增的 intake-tables）
B 区 2/3        data-boundary ✅ · null-owner ✅ · visual-baseline ❌
C 区 4/4 绿     auth-capability · auth-form · onboard-account(新) · bundle-privacy
```

### 🔴 visual-baseline 那个"红"不是回归，也不是「改了布局所以基线红了」——**它一张都没比对**

ADR-0034 预告过「像素基线会大面积变红」，所以这一条特别容易被顺着预期读错。实际日志是
**40 次 `A snapshot doesn't exist ... writing actual`，0 次 `Screenshot comparison failed`**。
原因是像素基线 **untracked**（`.gitignore:34`）且是**单机产物**——一个新开的 worktree 里
`eval-harness/visual/__snapshots__/` 是空的，Playwright 首跑把 40 张全**写了出来**并按
"没有基线"报失败。也就是说：**关于本分支布局的像素证据，这一轮一条都没有。**

我把首跑写出来的那 40 张**删掉了**，理由不是洁癖：留着的话，下一次在这个 worktree 里跑
就会拿"我自己这一版"当基线去比对自己——一道恒绿的、自己考自己的门，比没有门更糟。
按 ADR-0034 与票 #42 的纪律，基线在 **main 检出**重打，worktree 里不重量。

⇒ **给查收 session 的动作项**：合 main 之后在主检出 `--update-snapshots` 重冻，人眼对照板过一遍。

---

## 五、查收 session 要核的（票面 + 我自己想让人复看的）

1. **门全绿 ≠ 真部件被验到**。五步 + 预览模式 + 表格粘贴提交我都逐屏截图交给了 checker 子
   agent（maker≠checker，三轮共 88 张图），但 checker 也是机器。值得人眼再过一次的两处：
   - 第①步在**真实数据量**下的观感（我只喂过 3 行；16 行的名册纵向会长很多）；
   - 矮视口下正文区内滚的**可见暗示**够不够——checker 明确指出 headless 用 overlay 滚动条、
     静止不绘制，这一条它证不了，要人眼在真浏览器上看（内容可达已实测：scrollHeight 557 >
     clientHeight 461）。
2. **#40 的红线整发 422**：07 表塞分数实测被拒且 violations 指到行——已在 pytest（4 种写法
   参数化）+ 前端门（同一批写法直打端点）两处钉住。
3. **#44 连跑两遍 + born-red** —— 已跑，回执在 `account-e2e-runbook.md`。跑完生产
   `auth.users` / `auth.identities` 双双回到 **0 行**，零留尸（用 SQL 直接核过）。
4. **像素基线**：未在 worktree 里重量（纪律照旧）。改了大量布局，合 main 之后在主检出重打。

## 六、留给下一棒的账（不阻塞，但别丢）

- **矮视口内滚暗示**：见上 5.1，checker 判 [低] 且明说需要真浏览器人眼。
- **`.lite-onboard-close` 是死 CSS**：input-side-0721 起闸门就没有 × 了，规则还留着。
  本轮没顺手删（不在票面范围）。
- **PlaybooksScreen 的「你在设置里选的」分支现在够不着**：向导里那一步被 5 个管理框架取代，
  `playbooks` 默认改成了空数组（否则等于替用户宣称他选过），于是那条 `chosen` 分支实际
  不可达。留着没害，但下次动那一屏时值得一并裁定。
- **checker 提过、我没采纳并记了理由的两条**：① 把 zh 的「整发上传被拒绝」改成「整份提交」
  ——不改，「整发」是我们印在发给客户的 xlsx 说明页上的原话，界面与那张纸对不上更贵；
  ② 合并「先随便看看」(pause) 与「跳过设置」(skip-forever) 两个出口——语义不同，且是全向导的
  既有 chrome，不在本票范围内动。

## 七、环境备忘（这台机器上的坑）

- 本机 5173 / 8137 被**另一个 worktree** 占着（09:48 起的进程，不是我的）。本线全程用隔离端口：
  preview **5273** / mock 后端 **8237** / E2E 后端 **8337**。跑门时 `VERIFY_BASE` +
  `VERIFY_API` 都要带上，后端还要 `AVERY_CORS_ORIGINS` 放行 5273（CORS 精确匹配，端口对不上
  会被浏览器静默拦掉，门看起来像"页面空的"）。
- 本地 pg：`docker start avery-pg`（:5433）。needs_db 与 E2E 的本地库都用它。
- E2E 用的三个凭据从**在跑的生产容器**提取（`sudo docker inspect avery`），不进版本库、
  只落 session scratchpad。别信 `~/avery.env`（曾比在跑容器少 5 个变量）。
