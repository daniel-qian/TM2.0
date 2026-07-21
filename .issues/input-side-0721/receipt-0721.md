# 输入侧棒 r2 上线回执 · 2026-07-21

**一句话**：前后端同日上线（前端 Vercel 自动部署 `2bdcab2`；后端新镜像
`avery-agent:main-20260721-131557` = main(2bdcab2) 本身）。onboarding 全屏闸门页 +
一键示例团队 + 8A 采集全部生产实测通过。**#10 修复首次在生产 LLM 路径上拿到实证**。

## 后端上线（第八次，照 main 构建纪律）

```
新镜像 avery-agent:main-20260721-131557   ← = main(2bdcab2)
旧镜像 avery-agent:main-20260720-211529   ← 保留为 avery-prev-20260721-131557（回滚梯第八级）
```

后端改动面：registry/pg_registry（clone_context）、service/demo.py（新）、ingest_api
（POST /team/{id}/notes）、app.py（挂载）、upload_guard（demo 限流 route）。
迁移仍停在 0008，**不新建任何表**（demo 母本/克隆都是普通 contexts 行）。

### 环境与挂载（本次新增）
- seed 已上服务器：`/home/admin/avery-demo-seed/`（三亚脱敏六份：1 汇报 docx + 5 匿名简历 pdf）
- 容器新增卷挂载：`-v /home/admin/avery-demo-seed:/app/demo-seed:ro`（换容器脚本升级为
  `/tmp/swap3.sh` = swap2.sh 逐字 + 这一处挂载；今后换容器**用 swap3**，用 swap2 会把 demo 面
  静默变成 available:false）
- 容器 env 新增：`AVERY_DEMO_SEED_DIR=/app/demo-seed`、`AVERY_RATE_DEMO_PER_MIN=6`、
  `AVERY_RATE_DEMO_BURST=3`（env 取用全程未打印明文，600 权限文件）

### 上线前验证（逐条真跑）
1. 本机全测 3367 passed / 0 failed（含 test_demo_claim 11 条先红后绿 + 克隆合约 4 条）。
2. 8138 预检：同生产 env + 挂载拉起新镜像 → /health 2s 内 ok（minimax 脑 live、dashscope 向量、
   llm 抽取）；/demo/status → available:true。
3. **暖场在预检容器上做**（连的就是生产库，换容器后即刻 ready，零窗口）：首 claim 92 秒
   真 LLM 铸母本 → **5 人 5 个独立 id（u_虚构人员1~5，#10 不再塌卡）**、4 项目、4 决策卡、
   6 文件全清单；第二 claim **0.3 秒**（克隆路径）、新 id 新 token 互相独立；status ready:true。
4. fail-closed：无凭据读 clone context → 404（不透明门原样）。
5. 换容器 swap3.sh → 2 秒 healthy。公网 /health、/demo/status 均 200。

### 上线后生产真机（averylite.dannyqian.com，脏缓存已清）
`__AVERY_BUILD__.commit=2bdcab2`；新访客第一眼=全屏闸门（lite-gate-layer 盖满视口、doors 步、
aurora 渐变底）；示例团队门**亮了**（能力探测打通生产后端）；真点一下 → <1s 领到私有副本
`ctx_85261f1a6461`：虚构人员1~5 各自成卡、4 项目、4 决策、预铸「实时数据缺位」笔记在
Avery's notes——落进一个**有数据的指挥室**。

## 回滚（退一级）
```bash
ssh admin@8.211.28.11
sudo docker rm -f avery
sudo docker rename avery-prev-20260721-131557 avery
sudo docker start avery && curl -s http://127.0.0.1:8137/health
```
（退回后 demo 面消失——前端能力探测拿 404，示例门自动隐藏，不会出假按钮。）

## 观察项 / 留给后续
- demo 克隆副本会在生产库累积（每份 ~几百 KB 含 bytea），已有限流表盘 6/min burst 3；
  将来加过期清扫属**删除类动作，先问 Danny**。
- 母本 id 内容寻址：换 seed 文件（增删/改名/改大小）会自动重铸新母本，旧母本成孤儿行
  （无害，同上归清扫议题）。
