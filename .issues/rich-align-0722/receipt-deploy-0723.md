# 部署回执 · 2026-07-23 · rich-align 上生产 + 4 个真库 bug 修复

**一句话**：Danny 验收通过→推产。部署时连撞 4 个只在真 Postgres 才现形的 bug（离线套 not needs_db 全照不到），
逐个修完 + 重建后端 swap，生产 demo（三亚 16 人/12 项目/5 方法卡）API 实测跑通。详见 [[offline-suite-blind-to-pg-persistence]] 记忆。

## 修了什么（都已推 origin/main）
| # | commit | bug | 修法 |
|---|---|---|---|
| 1 | ce116f9 | `entities_person_keys_allowlist`(0002) 没追平 03/06 加的 self_report/archived/provenance → 拒收人员写入 | 迁移 0009 追平 11 键 |
| 2 | f13cf4d | `entities_kind_check`(0001) 没追平 08 的 playbook kind → 拒收方法卡 | 迁移 0010 追平 4 kind |
| 3 | 48429b6 | ProjectEntity 无 __post_init__ → pg 回读 risk/milestones 是 dict → `pr.risk.level` 500 | ProjectEntity.__post_init__ 强转（镜像 PersonEntity） |
| 4 | 48a19b1 | 迁移重放：0002 的旧 8 键 ALTER-ADD 每次引导重验、有 self_report 行就「violated by some row」→ 新容器起不来 | 0002 只删旧黑名单，allowlist 单点归 0009，加字段改 in place |

每条都配 offline 静态守卫（test_registry_contract.py，提交即跑）：allowlist/kind 每条 ALTER-ADD==代码集 + asdict 往返强转。离线套 3431 passed。

## 生产拓扑（当前）
- 后端容器 `avery` = **avery-agent:main-20260723-224756**（= main 48a19b1）on 8137，healthy，scoring=1。
- **回滚梯**：`avery-prev-20260723-224756` = 旧 07-21 后端（main-20260721-131557，Exited 保留）。一键回滚：`docker rm -f avery && docker rename avery-prev-20260723-224756 avery && docker start avery`。更早的 prev 梯还在。
- **seed**：`/home/admin/avery-demo-seed` = 三亚 pack（9 文件，从 build-zh/eval-harness/tests/fixtures/demo-seed 拷）。旧 5 人 seed 备份在 `/home/admin/avery-demo-seed.bak-5person`。
- **母本**：`ctx_demo_bc339929dd3f`（三亚，16 人/12 项目/5 方法卡/212 材料全 embedded）已铸在 Supabase avery-fra，生产 /demo/status ready:true。
- 前端 averylite.dannyqian.com 无源码改动（仍 aa349f9 那版 UI）。

## 部署纪律实录（下次照抄）
- **部署预检隔离 8138**：新镜像挂三亚 pack（另建 `/home/admin/avery-demo-seed-pack`，不动生产 8137 的 5 人 seed）→ /health → POST /demo/claim 铸母本 + 渲染，逐个 bug 都在这里逮到、没污染生产端口。生产全程挂旧后端服老 demo，全绿才 swap（swap3.sh）。
- **build 前 `sudo chown -R admin:admin /home/admin/build-zh`**（demo-seed 文件曾被 root 占，git reset 撞 Permission denied）。
- **env 提取**：`docker inspect avery --format '{{range .Config.Env}}{{println .}}{{end}}' | sudo tee /tmp/avery_env_<TS>`（600，不打印密钥）。
- 🔴 **killed 的 claim curl 留 idle-in-transaction 连接卡 entities 锁** → 下次 _ensure_schema 的 ADD CONSTRAINT 等到 statement_timeout(2min) 才 QueryCanceled → 整个后端 /demo/* 500。解：Supabase `pg_terminate_backend(pid)` 那条 orphan。别 kill 跑一半的 claim（Bash 工具默认 120s 超时会 kill——长命令传 timeout 参数或 run_in_background）。

## 留后（需 Danny / 下个 session）
- ⚠️ **上手门文案 e6cd70c committed 未推**：`onboardDoorDemoBody` 原文案还写「5 人营销团队」（07 换 seed 时漏改），已改成与 seed 解耦的通用措辞（花名册/项目/文档）。用户可见 zh → 待 Danny 审字 + push（push 即 Vercel 自动上前端）。**建议发合伙人验收指南前先推这条。**
- **guest 克隆无 GC**：每次 demo claim 造一份完整副本（16 人+212 材料），永不回收 → 库无界增长 → 早晚拖慢 _ensure_schema 的 ADD CONSTRAINT。本 session 预检造了 ~十几份三亚克隆（我的测试残渣，功能无害）。没删（删生产数据是销毁类动作 + 难分我的残渣 vs 真访客克隆）。设计层该给 guest ctx 加 TTL/GC。
- **_ensure_schema 每次引导重放全部迁移 + ADD CONSTRAINT 拿 ACCESS EXCLUSIVE 锁**：无并发时快（<1s），但和在飞的 claim 撞锁就等 timeout。可考虑「约束已存在且定义正确就跳过」而非每次 DROP+ADD。
- **05b（重传合并）仍未做**。
