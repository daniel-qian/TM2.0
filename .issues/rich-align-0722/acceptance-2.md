# 验收手册（最终）· 满态对齐战役 rich-align-0722 · 收官（01→11 全量）

> 2026-07-23 AFK 夜跑收官产出。**本表 = 战役最终验收表单**（收编 批次② 草稿 + C 线 08/09/10 +
> 收官 11）。**push=人工闸**：Danny 逐屏人测点头后才 `git push`（=Vercel 自动上产 + 生产暖场 claim）。
> 全部 commit 攒 **main** 未推（ahead origin/main）。

---

## 0. 环境（收工保持运行）

- 后端 mock：`http://127.0.0.1:8137`（brain=mock / heuristic / keyword + 三亚 demo-seed）——在跑，**已是收官最新码**。
- 前端 preview：`http://localhost:5173`——在跑（挂收官 dev 构建，HEAD 见 git log）。
- 🔴 **验收入口（必带参）**：`http://localhost:5173/?v=2&mode=live&lang=zh`（aurora 皮加 `&look=aurora`）。
- 她方参照（对照板/并排）：`cd D:\cr-live && npm run dev`（:3100）。
- 登录隔离演示台（issue 10，隔离端口，Danny 人手登录）：见 `launch-authdemo-10.md`（5381/8381，真 Supabase）。

---

## 1. 机器自验总表（战役全绿）

> C 线细节收据见 `receipt-C.md`（08/09/10 逐门）；A 线 `receipt-A.md`、B 线 `receipt-B.md`。

| 面 | 判据 | 结果 |
|---|---|---|
| 后端全量离线套（四 deselect 必带） | additive 零回归 | **3428 passed / 0 failed** / 65 deselected / 4 xfailed |
| **收官全电池**（run-battery.mjs 25 门 A19/B3/C3，`SPEC_STICK=99`，C 区殿后+重建 dist，独占） | **连续两轮零红** | **连续两轮 25/25 绿（A19/B3/C3，含像素门）** |
| verify-cr-alignment 全量（stick 0–12，无 SPEC_STICK 全硬断言） | 战役对齐 DoD | **电池 SPEC_STICK=99 全绿**（stick 0–12 全硬断言；片跑 stick12=55/55） |
| 扫雷 sweep（9屏×2皮×3视口）+ `--selftest` | NEW=0 / 回归 0 | **selftest 8/0 · 正式跑 0 件 · NEW 0 · 回归 0** |
| 像素全量（9屏×2皮×2视口=36 张）两轮 | 含像素门零红 | **两轮 36 张零 diff**（home-mobile 07-21 先天漂移已重冻，见 §3） |
| T9 两世界终检（三亚一键 claim 满态 + 薄文档诚实降级） | 满态全字段 | **满态=离线套 test_demo_claim（16人/6项目富字段/self_report 开16关0）+ 08/09 live 探针 claim；薄文档降级=battery file-manifest-truth 30 判据** |
| 承诺脚注 | footerText + visionSummary3 | **✅** |

C 线新片机器证据（已 commit）：
- **08** playbooks：test_playbooks_08 8/8 · verify-playbooks-08 13/13 · cr-align SPEC_STICK=12 55/55 · AFK 2/2 · A 区 19/19 · 像素净 0。
- **09** 重新开始：verify-restart-09 15/15 · onboard-gate 世界 F 46/0 · switchers ⑥ 27/0 · auth-form 57/0 · A 区 19/19。
- **10** 登录隔离：test_login_isolation_10 5/5 · auth-capability 25/0 · auth-form 57/0 · verify-auth-demo-10 6/6（演示台）。

---

## 2. HITL 逐屏看点（Danny 人测路径）

**准备**：无痕窗开 `http://localhost:5173/?v=2&mode=live&lang=zh`。第一眼=onboarding 闸门三扇门。

**A. 门厅 + 一键三亚（07 满态语料）**
1. 闸门三扇门在（上传自己材料 / 示例团队 / 先随便看看）。点**示例团队** → 秒级 claim 三亚屿澜湾 16 人/6 项目。
2. 落指挥室（/home）：KPI 条真数（人/项目/文件/笔记/待办）；右栏差距摘要 + 需关注的人（真派生）。

**B. 你的团队（04 目录化 + 03 开关两世界）**
1. 目录形态：组别筛选 chip 行（全部/部门，count 徽章）+ 3 列成员卡网格 + 上传部件降位不卸载。点部门 chip → 只剩该组。
2. 关世界（默认）：**无情绪 chip 行**，全屏无「如常/偏紧/吃紧」，人卡零数字。
3. 开世界（`AVERY_ALLOW_PERSON_SCORING=1` 的后端 / 或看 §3 截图）：口径角标「按本人自述筛选」+ 情绪 chip 无 count + 人卡自述在 `[data-metric-source]` 锚点内。
4. 人员 CRUD（06）：页头「添加成员」primary → 内联表单；详情浮层编辑/停用/恢复；🔴 手填负载/情绪→硬 422（人身禁键）。

**C. 项目（01/02/05a 富卡 + 手编 CRUD）**
1. 项目卡：风险徽章 + 6px 进度条 + 里程碑圆点串（真管道抽取，absent≠none：文档没写就不冒）。
2. 页头「添加项目」primary → 内联表单；详情浮层编辑态（字段变输入框，保存/取消）+ 归档折叠区 + 逐字段「手动编辑」出处角标。

**D. 操作手册（08 playbooks 方法库）**
1. **满态**（三亚已 claim）：2 列方法卡网格 5 张（重大宴会跨部门协作闭环 / 旺季产能协调 / 红黄蓝过程管控 / 升级与红线判定 / 新人爬坡期公平判断）；每卡方形渐变图标 + 标题 + 描述（适用行）+ 标签徽章。方法卡非交互（不是按钮）。
2. 并排她方 `:3100/playbooks`（6 卡双列方法库）：结构同构（2 列方法卡）；🔴 文本/图标我方原创零抄。
3. **非 demo 空态**（无痕新开、不 claim、不上传 SOP）：coming-soon 诚实标 + onboarding 勾选槽位 + 「重看上手引导」入口。

**E. 重新开始闭环（09）**
1. 满态后 → 右上齿轮 → 第三行「重新开始」→ 首击变「确认重新开始？」→ 再击执行。
2. **看点**：秒回 onboarding 闸门（10 秒复位下一场）；语言/观感回出厂；上一场数据/登录全清（无残留）。

**F. 登录隔离线（10，凭据墙=Danny 人手）**
1. 起演示台（`launch-authdemo-10.md`，5381）→ 右上**登录**入口在（能力探测 supported）→ 你的 avery 账号登录（🔴 agent 不代填）。
2. 一键三亚 → AuthPanel「归到我账号」claim → 退出 → 换第二账号登录 → 只见自己的，看不到前号三亚副本（同体 404）。
3. 硬切换：面板不便本地起，走线上（生产域名本就配 Supabase），同 1-3 步。

---

## 3. pixel-evidence 索引（Danny 晨审签认）

> 像素基线 untracked 同机有效（36 张）。C 线净影响 0；收官唯一像素动作 = home-mobile 重冻。

- `eval-harness/reports/pixel-evidence/04/`：目录两世界截图（关/开）+ 净零 README。
- `eval-harness/reports/pixel-evidence/08/`：满态方法库网格截图（aurora/paper）+ 净零 README（供并排她方 /playbooks）。
- `eval-harness/reports/pixel-evidence/11/`：**home-mobile 重冻证据**（expected/actual/diff aurora+paper）+ 目检 README
  （benign 07-21 换行漂移，非破图非回归；旧基线备份 `__snapshots__/.bak/*.07-21.png`）。🔴 **晨审签认此重冻**。
- 对照板（收官重拍）：`eval-harness/reports/align-board/<日期>/`（开世界带口径出处 + 关世界，真 uploadFiles）——见 §1 收官全电池行。

---

## 4. 拍板复核项 ①-④ + 承诺脚注 · 签认位

| # | 复核项 | 归属 | 收官状态 | Danny 签认 |
|---|---|---|---|---|
| ① | 「重新开始」全清含语言/观感（清 `lite2:*` 原文执行，whitelist-free） | 09 | ✅ 已交付（verify-restart-09 实证 lite2:* 全空含偏好；要保留偏好属改共识不属改实现） | ☐ |
| ② | 人身数字「抽取恒存自述槽、投影随开关」（母本不随开关重铸→库里恒有自述数据，红线依赖投影层执法） | 03 | ✅ 已交付（B 线 T9：开关关 self_report 整槽不投影） | ☐ |
| ③ | 人身数字开关默认态 = 关 | 03 | ✅ 默认关（关世界零情绪词实证） | ☐ |
| ④ | 文档通道不对称（CRUD 手填硬 422 vs 自述行作者不可验，口径改「系统可自证式」PRD A3） | 06 | ✅ 已交付（06 person 写侧禁键 422 恒禁不随开关） | ☐ |
| 承诺脚注 | footerText 含「不能只拿它当依据」+ visionSummary3 含「不会成为人事决策的唯一依据」 | 全局 | **✅** | ☐ |

**总签认**：dev server 逐屏人测 §2（A–F）无误 + §3 像素证据核对 + §4 ①-④ 签认 → ☐ **通过 → 授权 `git push` 上产**（Vercel 自动部署 + 生产手动 claim 暖场一次）。

---

## 5. 🔴 已知留后（收官如实记）

- **05b（重传手编赢+冲突）未做**：A 线交接已侦察落档（receipt-A §末），独立不挡 07/收官；下个 session 直接接。
- **zh 手写 draft 待审字**：01-10 各片新增 zh 键为手写 draft（zh.ts 头逐条标 rich-align/0N），待 Danny 审字或 M3 directed pass。
- **home-mobile 像素**：收官已重冻到本机当前（benign 07-21 换行漂移），晨审签认见 §3。
- **生产暖场**：seed 换三亚 pack 后首次 claim 为 LLM 铸造分钟级——push 部署后需手动 `POST /demo/claim` 暖场一次（见 handoff）。
