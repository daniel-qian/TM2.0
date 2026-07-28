# 部署回执 · 2026-07-28 · 8 提交前后端同上

**一句话**：origin/main 落后的 8 个提交已全部上线——前端 Vercel、后端容器 swap，
全电池 25 道跑完（24 绿，唯一红是像素基线且**每一张漂移都已归因**），生产实测通。

## 上了什么

| 面 | 提交 | 内容 |
|---|---|---|
| 后端 | 8c8166b | 红线不再把 KPI-001 这类**编号**误判成人身评分（原来一个编号硬拒整批上传） |
| 后端 | d0173d4 | 项目状态词表补「暂停」（此前用户填「已暂停」→ 卡片显示「状态未知」） |
| 前端 | 70a04e9 | `/paperwork`「文件与表单」页 + 顶栏设置菜单第四行 + 上传面板两条链接 |
| 前端 | d0173d4 | `public/paperwork/{forms,legal}/` 6 个 docx/pdf/xlsx |
| 前端 | 61e7003 | 窄屏顶栏单行化 + 空态卡让位（合伙人验收报的两个 bug） |
| 仓库 | 2dd7b26 / 440b246 | 门自身 IPv6 回环修复 |
| 仓库 | 19fcfed / a7c116d | 文档 / ADR-0030 / 验收证据 / 可复现探针 |

## 部署前证据（广播说"全电池没跑过"，这次跑了）

- **全电池 24/25 绿**（A 19/19 · B 2/3 · C 3/3）。
  - 🟢 `data-boundary` **本次通过了**——440b246 那条 IPv6 修复生效；此前它在本机恒红是绑定问题不是回归。
  - 🔴 唯一红 `visual-baseline`：11/36 张漂移，**逐张归因完毕，无一无法解释**：
    - 6 张＝上传面板新增两条链接（home + team × 两皮两视口）→ docs 线本意
    - 3 张＝差异像素 **0**（仅 PNG 编码差）
    - 2 张＝aurora 眉题 `font-weight:750` 变体字抗锯齿 flake（包围盒与位置一像素未动，老熟人）
    - → 已重冻。⚠️ 基线是 gitignore 的单机产物，见 [[avery-frontend-gate-setup]]。
- **离线后端套 3464 passed / 0 failed**（独立复核广播数字，四个 deselect 齐）。
- **两条可复现探针**（a7c116d 附带，需 `PYTHONIOENCODING=utf-8`，否则 GBK 控制台崩在收尾 print）：
  - `probe-redline-07.py` exit 0 —— **`PASS KPI-001 当成人名`** 即 8c8166b 的直接证据
  - `probe-e2e-filled.py` exit 0 —— 填好的 xlsx → 3 个人卡字段全对、零幽灵人
- tsc -b 0 错。

## 前端（Vercel）

推 `39e5e6b..a7c116d` → 自动部署 Production Ready（23s）。生产 env `VITE_AVERY_API_BASE`
早已配置（10 天前，即当前在跑那版用的），本地回环 dist 不参与 Vercel 构建。

### 🔴 SPA rewrite 陷阱——按字节验，不看状态码

6 个资产逐个 curl，**字节数与魔数与本地逐一对齐**：

| 文件 | 字节 | 魔数 | content-type |
|---|---|---|---|
| forms/avery-intake-forms.xlsx | 61478 | PK | …spreadsheetml.sheet |
| forms/avery-intake-forms.docx | 15820 | PK | …wordprocessingml.document |
| forms/avery-intake-forms.pdf | 335334 | %PDF | application/pdf |
| legal/avery-dpa-draft.docx | 13677 | PK | …wordprocessingml.document |
| legal/avery-nda-draft.docx | 11566 | PK | …wordprocessingml.document |
| legal/avery-privacy-draft.docx | 13307 | PK | …wordprocessingml.document |

**反向对照**（证明上表不是空真）：请求同目录下不存在的
`does-not-exist.xlsx` → **HTTP 200 · 736 字节 · 魔数 `<!do`**。陷阱确实存在，检查确实有效。

## 后端（容器 swap）

- 新镜像 **`avery-agent:main-20260728-184431`**（从 `/home/admin/build-zh` @ a7c116d 构建，217MB）
- env 从在跑容器提取到 `/tmp/avery_env_20260728-184431`（600，39 行，`AVERY_ALLOW_PERSON_SCORING=1` 在位）
- **隔离 8138 预检**：health ok（brain=minimax，degraded=false）· `/demo/status` ready
  · demo 领取 **16 人 / 12 项目 / 5 方法卡 / 1s**
- `swap3.sh` 换容器：**SWAP SUCCESS**，健康闸 1×2s 通过
- **回滚梯**：`avery-prev-20260728-184431`（= 旧 `avery-agent:main-20260723-224756`）保留。
  一键回滚：`sudo docker rm -f avery && sudo docker rename avery-prev-20260728-184431 avery && sudo docker start avery`
- 预检容器**已清**（8138 释放）——上一轮留了残骸，这次没留。

### 为什么不在生产上验那两个后端修复

预检容器与生产容器**连的是同一个生产库**。拿它做测试上传＝把测试数据写进真 context
（2026-07-20 真发生过，三个「员工花名册.csv」落进生产）。所以：
- 两个后端修复在**离线逻辑层**验（探针 + 3464 套），
- 生产容器只走**不写库**的路径（health / demo/status）+ 一次 demo 领取（合伙人真实路径，且本版已带克隆 GC）。

这是有意的取舍，不是漏验。

## 留后

- **红线改「丢字段而非整批拒绝」那条线不在本次 8 个提交里**（`pipeline.py` 最新提交仍是 03f8f8b）。
  它合入后后端要重跑电池 + 重新 swap。
  ⚠️ 届时 `probe-redline-07.py` 顶部那段描述会过时（文件里自己写了这个提醒）。
- 像素基线 tracked 与否仍未拍板（`.gitignore:34` vs `playwright.config.mjs` 注释互相打架）。
- 断点动物园未并（lite2.css 八个断点）。

---

## 上线后验收（13 agent 多面核验 + 对抗复核 + 完备性批评）

六面结论：backend / assets / narrow-ui / short-viewport / docs-ui 五面 **PASS**，demo-e2e **PARTIAL**。
生产实测要点：顶栏带底 70（fixed）· 窄屏带高 **64**（修前 208）· 横向溢出 **0**（修前 15）·
操作手册空态卡顶 1366×768=164 / 1280×720=140，**压到 1024×600 仍不塌**（比门的 700 下限更宽）·
tab 渐隐 data-overflow 线上生效、高亮 tab 54/54 完整可见 · 六个资产字节+魔数+zip EOCD/`%%EOF` 尾部
全对 · 真点门领 demo 1264ms/16人12项目5方法卡 · 九屏 pageerror 0 / console error 0 ·
CORS 正确（带 Origin 实测 + evil.example 反向对照）。

### 🔴 必须先处理：公开托管的法律草案泄我方谈判底牌

`https://averylite.dannyqian.com/paperwork/legal/avery-dpa-draft.docx`（无鉴权、上传面板直接链出）
正文逐字带着起草者内部批注（本回执作者已从生产下载解包 `word/document.xml` 亲自核实）：

> 「第 3.2 与 3.3 条是**保护乙方**的关键条款：把脱敏义务和身份对照表留在甲方手里，可显著降低
> 乙方的合规负担与责任风险。**谈判中甲方可能要求乙方承担脱敏义务，需谨慎权衡**。」

乙方＝我方，甲方＝客户。**屏幕上这两条被折进默认关闭的开关里，文件里没有这层保护**——
而发给客户的是文件不是屏幕。ADR-0030 只解决了屏幕面。

同批还有两条：
- 三份法律件正文首行都写「**供内部讨论与律师审阅使用**」，隐私件更写
  「**未经执业律师审核不得对外发布**」——却正被无鉴权公开托管并从上传面板链出。
- 隐私草案第五节：「您的个人信息存储于**中华人民共和国境内**的服务器。我们不向境外提供
  您的个人信息。」而后端在**法兰克福**、库是 Supabase **avery-fra**。合规文书里的事实性冲突。

→ 给合伙人本人看无妨（草案本就是内部产物）；**在给任何客户之前必须二选一**：
删掉文件内的内部批注并修正数据存放地表述，或把 legal 三件先下线。**这是 Danny 的拍板面，未擅动。**

### 其余发现（不阻断）

| # | 发现 | 性质 |
|---|---|---|
| 1 | 6 个下载件的中文文件名全部失效——Vercel 发 `Content-Disposition: inline; filename="avery-nda-draft.docx"`，在 Chromium 里压过 `download` 属性。用户存到英文机器名。修法：vercel.json 给 `/paperwork/*` 配 headers 覆盖 | 轻，真问题 |
| 2 | 「暂停」词表修复**在生产未被验到**：demo 母本 12 个项目无一触发该词；且生产是 llm 抽取模式，`_norm_status` 只在模型输出落词表外才兜底 → 该修在 llm 路径的实际收益从未端到端量过。已入库旧数据也不回填 | 取证缺口 |
| 3 | `/health` 无 version/commit 字段 → 「生产跑的就是本镜像」只由 swap 日志自证，外部不可核。建议加一行 | 可验性 |
| 4 | 我们自己发的 02 表下拉含「未开始」，而 `_norm_status('未开始')=''` 是有意为之 → 用户从我们的下拉里选它，卡上仍显示「状态未提及」。最容易被当 bug 报回来 | 需提前讲清 |
| 5 | 上传面板两条链接 href **完全相同**（无锚点），点「你上传的内容怎么处理」落地时那份文件在折叠线外且默认收起 | 轻 |
| 6 | `.lite-onboard-card` 是生产上的**死选择器**（闸门在场它也恒 0）。谁照抄它写门会得到永远绿的假门 | 埋雷 |
| 7 | en.ts/zh.ts 注释写「设置菜单第四行，追加在最后一行之后」，实测 DOM 索引 i=2（第 3 行），restart 被推到 i=3。注释与实现相反 | 文档 |
| 8 | 满态布局在生产零覆盖（进满态需上传/领 demo，只读铁律禁）；iOS Safari / 微信内置浏览器零覆盖——而合伙人上次那两个 bug 正是真机逮到的 | 覆盖缺口 |

**完备性批评裁定：GO-WITH-CAVEATS。**
