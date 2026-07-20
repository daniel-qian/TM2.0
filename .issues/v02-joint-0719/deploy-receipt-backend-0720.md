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

## 镜像与容器状态（最新）
```
当前镜像 avery-agent:zh512acct-20260720-123003  ← 含 feat-053 账号层，生产在跑，healthy
上一版   avery-agent:zh512sub2-20260720-102149  (parse-crash 兜底) 未删
更早     avery-agent:zh512sub-20260720-095401 / avery-agent:zh512  未删
最新回滚 avery-prev-20260720-123003  → zh512sub2 容器，Exited 完整保留
更早回滚 avery-prev-20260720-102149 / avery-prev-20260720-095401  均完整保留
```
构建源：`origin/deploy/zh512-subset-0720`（HEAD `e7f8a53`）。服务器 `/home/admin/build-zh` detached 在 `e7f8a53`。

## 一键回滚（回到上一版，即无账号层）
```bash
ssh admin@8.211.28.11
sudo docker rm -f avery
sudo docker rename avery-prev-20260720-123003 avery   # 回到 zh512sub2（无 feat-053）
sudo docker start avery
curl -s http://127.0.0.1:8137/health
# 更早的版本用 avery-prev-20260720-102149 / -095401
```
⚠️ 回滚容器**不会删掉 `account_contexts` 表**（表留着无害：没有账号层的镜像根本不读它）。真要退表得手动 DROP，本回执不建议。
换容器脚本 `/tmp/swap.sh` 用的是时间戳命名 + 每条失败路径调 `rollback()`，避开了 kickoff 警告的 `avery-prev` 撞名地雷（那个停着的 `avery-prev` 仍在，没动它）。

## 还没做 / 留给后续
- 依赖没钉版本（36 个 `>=`）、基础镜像没钉 digest —— 这次重建实测漂移 0，但两周后重建是抽奖。建议下次钉。
- 旧的 `avery-prev`（无时间戳，07-18 那个）仍在，是历史地雷，可择机清掉。
