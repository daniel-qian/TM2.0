# 后端上线回执 · 2026-07-20（open loop）

**一句话**：后端子集三条已上生产，热替换成功，公网健康，生产库零新写入。旧容器完整保留可一键回滚。

## 上了什么
子集三条（基于线上源 `512b11d`，只取后端路径）：
- `6f838f3` — GB18030 静默销毁修复（中文名册读坏 → 读对）
- `a45bb4a` — 编码裁决器不许编造 + `decode_confidence` 字段（梯子扩到 4 级 `gb18030/big5/shift_jis/euc_kr`）
- `d184b6c` — `/advise` 大脑配置出错时错误处理路径自己崩的修复

**理由用的是「解码器从不说我不确定」，不是日韩名册**（按 kickoff §0① 的更正）。

## 为什么这样上是安全的
- **无 0008**：子集迁移目录停在 `0007`，构建产物 `/app/db/migrations/` 实测也只到 0007。build 前后 + 换容器后三次 guard 全过。
- **对生产库零新写入**：冷启动只幂等重放已应用的 0001–0007（和之前每次重启一样）。换容器后实测 `pg_class` 里 `%account%` 关系 = 0，`avery` schema 仍是原来 8 张表。
- **解码决策级验证**（部署镜像内纯函数直调，不碰 DB、不花 LLM）：
  - 简体 GB18030 → `enc=gb18030 conf=high penalty=0.0`，名字全对
  - 繁体 Big5 → `enc=big5 conf=high`，名字对
  - 日文 Shift_JIS → `enc=shift_jis conf=high`，正确解码不再冒充中文
- pytest（mock brain，离线）：`test_file_truth_encoding` + `test_decode_never_invents` 62 通过；`test_advise_brain_config_error` 3 通过。

## 第二次上线（parse-crash 兜底，同日晚些）
对抗性电池逮到真 bug：过了魔术字节的坏文件（截断 PDF、假 xlsx/docx、坏 XML、超 stdlib 上限的 CSV 单元格）会抛未捕获库异常 → HTTP 500，还拖垮同批次好文件。修复 `fb81811`：四个提取器把库异常兜成 `ParseError`（坏文件标 failed，其余照常入库），CSV 的 `field_size_limit` 抬到单文件上限。对抗电池 17 通过（原 2 通过 + 7 xfail）、回归 164 通过。
上线后生产内实测：截断 PDF / 假 xlsx → `ParseError` ✓，200KB 合法 CSV 大单元格 → 正常解析 ✓。deploy 分支推进到 `e5a8743`（只多 parse.py）。

## 第三次上线（feat-053 账号层，Danny 当面拍板要上）
子集加 `21f5aad`+`26c33a0` 的后端路径（`account.py`/`auth_api.py`/`0008`/`app.py` 挂载/`pg_registry` 账号写入/`ingest_api` 账号闸）→ deploy 分支 `e7f8a53`。本地验证 106 passed。
**迁移 0008 建了 `avery.account_contexts`**：纯增量 `CREATE IF NOT EXISTS`、只在 avery schema、不 DROP、表里只有 `user_id`+`context_id` 两个不透明 id、**无任何人员数据**（红线不动）。owner_token 仍在下层，账号只是第二种归属证明，游客路径照常。
⚠️ 机制细节：建表**不在容器启动时**发生，而在**第一次真正访问 registry** 时（`_ensure_schema` 重放）。本次已用一个无害的 `GET /team/ctx_doesnotexist`（404）主动触发并验证，避免让第一个真实客户请求承担建表。
上线后：`/account/status` → 200（公网实测）；avery schema 从 8 张表变 9 张，其余 8 张未动；**Supabase 安全告警 0 条**。
容器 env 新增 `SUPABASE_URL` + `SUPABASE_ANON_KEY`（用 publishable key）。

## 第四次上线（feat-056 决策定级，Danny 批的四条之一）
子集加 `2672bad`（规则表 + `decision_grading.py` + `CompanyContext.decision_cards()` + `_team_payload` 的 `"decisions"` 键）+ `ae81597`（**中文状态归一化**）→ deploy 分支 `780d441`。
⚠️ `ae81597` 是**必需的不是可选的**：修复前的 `_norm_status` 是纯 ASCII 正则，中文「阻塞」「有风险」一律返回空 —— 实测同一个「已阻塞」的项目，不带这条会被静默降级成 `needs_confirmation` 而不是 `high_risk`。
本地验证：决策定级测试 69 passed；全过滤套件 1065 passed（确认状态归一化没伤到别处）。迁移仍停在 0008，**无新建表**。
上线后生产内实测：`decision_cards` 已挂到 `CompanyContext`，规则判级正确（blocked→高风险 / at-risk→需确认 / on-track→可推进），`ingest_api.py:165` 的 `"decisions"` 键已在 payload 里 —— 首屏那块空白从此有内容。
**「只许升级不许降级」性质已在代码核实**：`apply_review` 用 `max(规则等级, 提议等级)`，降级一律驳回且连带丢弃措辞，升级必须带理由；有 4 个专门测试守着（含「第二次复核不能把升级走回去」）。

## 第五次上线（对抗性复审逼出来的五条中文修复）
复审发现**最重的问题不在当天写的代码里，在部署方法里**：生产镜像基线一直停在 `512b11d`(7/18)，
每次子集只带那个功能需要的东西，于是 main 上一整批中文修复从没上线；而当天刚让中文状态词生效，
恰好把缺口捅大了。deploy 分支 `780d441 → ae46ab9`（5 个提交）。

| # | 改前（生产真实行为） | 改后 |
|---|---|---|
| ① | `未按时完成/未能完成/还没有完成/没有完成/无法完成` **全部读成 done**（还顺带静音逾期/低进度告警） | 没有一条是 done；`未能完成/无法完成` 判 at-risk（更准） |
| ④ | `无重大风险/无明显风险/没有风险` **全部判 at-risk**，卡片写「项目自报状态为『有风险』」 | 全部干净 |
| ② | 中文 `阻碍项：/风险点：` 标签行**一条都进不去** → 项目判 `can_proceed` | `blockers=['等待法务确认','人手不足']`，等级变 `needs_confirmation` |
| ③ | `briefing()` 用比 `decisions` 弱的私有规则 → 首页说「需确认」、团队页说「没有风险信号」 | 两边同一套规则表，tone 一致 |
| ⑤ | 红线不扫 `person.name` → `绩效8分.docx` 能造出一个叫「绩效8分」的人卡并通过校验 | 三条违规拦下；正常人名对照组不受影响 |

⚠️ **缺陷②不是 cherry-pick**：main 的实现寄生在 feat-054 粒度闸新增的 `_project_from_span` 里，
带它等于带整个 ~500 行粒度闸功能。改为在现有 `_projects_from_doc` 里做独立最小实现，
**词表与 main 逐字一致**（`阻碍项|阻碍|阻塞|卡点|风险点`，刻意不加宽）—— 这样将来从 main 重拉基线时行为不变，
不会把一个「只有生产有」的补丁静默回收掉。

**已知未修（main 自己也没盖，需 Danny 定夺）**：裸 `风险：`（无「点」字）仍识别不到；
「正向状态词命中后，全文风险兜底扫描永不运行」这条控制流 main 同样没改、非独立可修项。
两条都写在 `c9fcd29` 提交信息和 `tests/test_zh_blocker_risk_label.py` 末尾。

本地验证：全量过滤套件 **1697 passed / 0 failed**。另含决策卡兜底文案修复（`ae46ab9`，新增 R-UNCLASSIFIED 规则）。

## 镜像与容器状态（最新）
```
当前镜像 avery-agent:zh512zh-20260720-164609    ← 含五条中文修复，生产在跑，healthy
上一版   avery-agent:zh512grade-20260720-140955 ← 含决策定级
更早     avery-agent:zh512acct-20260720-123003  ← 含 feat-053 账号层
更早     avery-agent:zh512sub2-* (parse兜底) / zh512sub-* (编码修复) / zh512 (最初)  均未删
五级回滚容器（全部 Exited 完整保留，逐级可退）：
  avery-prev-20260720-164609  → zh512grade（有决策定级，无五条中文修复）
  avery-prev-20260720-140955  → zh512acct （有账号层，无决策定级）
  avery-prev-20260720-123003  → zh512sub2 （无账号层）
  avery-prev-20260720-102149  → zh512sub  （无 parse 兜底）
  avery-prev-20260720-095401  → zh512     （最初，什么都没有）
```
构建源：`origin/deploy/zh512-subset-0720`（HEAD `ae46ab9`）。服务器 `/home/admin/build-zh` detached 在 `ae46ab9`。

## 一键回滚（退一级）
```bash
ssh admin@8.211.28.11
sudo docker rm -f avery
sudo docker rename avery-prev-20260720-164609 avery   # 退一级（回到无中文修复）
sudo docker start avery
curl -s http://127.0.0.1:8137/health
# 想退更多级，换成上面列表里更早的那个名字即可
```

## 🔴 下一棒最该做的一件事：把生产基线重新从 main 拉一次
今天五次上线全部是「在 7/18 旧基线上叠子集」。这个打法救了急，但复审已经证明它会**系统性漏掉
没人显式指名的修复**——五条中文缺陷就是这么漏了两天。7/25 之后建议重新从 main 拉一次基线，
别再往旧分支上叠。查生产还缺什么：
`git diff ae46ab9 main -- eval-harness/avery eval-harness/service eval-harness/db`
⚠️ 回滚容器**不会删掉 `account_contexts` 表**（表留着无害：没有账号层的镜像根本不读它）。真要退表得手动 DROP，本回执不建议。
换容器脚本 `/tmp/swap.sh` 用的是时间戳命名 + 每条失败路径调 `rollback()`，避开了 kickoff 警告的 `avery-prev` 撞名地雷（那个停着的 `avery-prev` 仍在，没动它）。

## 还没做 / 留给后续
- 依赖没钉版本（36 个 `>=`）、基础镜像没钉 digest —— 这次重建实测漂移 0，但两周后重建是抽奖。建议下次钉。
- 旧的 `avery-prev`（无时间戳，07-18 那个）仍在，是历史地雷，可择机清掉。
