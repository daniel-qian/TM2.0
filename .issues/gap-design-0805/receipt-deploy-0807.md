# 统一上产回执 · 2026-08-07（#45–#49 + 差距战役 T1–T8）

一句话：**前端早已随 push 自动上产，本次真正的动作是后端换容器**；
后端从 `main-20260805-160609` → **`main-20260807-142044`**（= main `4650e1e`），回滚梯保留。

## 上产前的真实状态（先核实，不照抄记录）

- **前端**：`https://averylite.dannyqian.com` 线上 `__AVERY_BUILD__.commit = 4650e1e26…`，
  `apiBase = https://avery.dannyqian.com`。Vercel 连着 `daniel-qian/avery`，**push main 即自动上产**——
  所以 T1–T8 的界面在各票合并当天就已经上线了，progress.md 里「89b36e4 / fa8d085」两个数字只是
  两次相邻的自动构建，不是漏部署。**口径纠正：前端不需要人工上产动作，需要的是每次核实线上 commit。**
- **后端**：容器仍是 0805 的镜像 → 也就是说，**线上前端已经在调后端还没有的接口**
  （表单三件套 `/team/{id}/forms*`、`/f/{token}`）。T3 的否决④让那一段整段不渲染，
  所以没造成可见故障，但这个错位从 T1 合并当天就存在了。本次换容器把它抹平。

## 做了什么（每一步都有留痕）

1. `build-zh` 同步到 `origin/main` → `4650e1e`（`git reset --hard`，工作区干净）。
2. `sudo docker build -t avery-agent:main-20260807-142044 -f eval-harness/Dockerfile eval-harness`。
3. **env 快照从在跑容器提取**（`docker inspect avery`，剔掉 PATH/PORT/PYTHON*/PIP_* 镜像自带项）
   → `/tmp/avery_env_20260807-142044`，**30 个变量**。关键项当场核对：
   `AVERY_PUBLIC_BASE=https://avery.dannyqian.com`（T1 员工链接靠它拼绝对地址）、
   `AVERY_ALLOW_PERSON_SCORING=1`（T5 自述行的投影闸）、
   `AVERY_CORS_ORIGINS` 含 `https://averylite.dannyqian.com`、`AVERY_DEMO_SEED_DIR=/app/demo-seed`。
4. **8138 预检**（新镜像 + 同一份 env + demo seed 挂载）：`/health` ok（brain=minimax、
   embeddings=dashscope）、`/demo/status` `available:true, ready:true`；
   `GET /team/ctx_doesnotexist` → 404 **顺手触发 `_ensure_schema` 迁移重放**；
   `GET /f/<假 token>` → **HTML** 404 员工页（这是 form_api 是否挂载的判别式：
   没挂载会是 JSON `{"detail":"Not Found"}`）。跑完 `docker rm -f`，8138 复空。
5. `bash /tmp/swap3.sh 20260807-142044 avery-agent:main-20260807-142044`
   → `NEW HEALTHY after 1x2s` → `SWAP SUCCESS`，旧容器留作 **`avery-prev-20260807-142044`**。

## 上产后的验证

| 验什么 | 怎么验 | 结果 |
|---|---|---|
| 服务活着 | 公网 `/health` | ok · minimax · dashscope · 预算 2000/2000 |
| 示例团队还在 | 公网 `/demo/status` | `available:true, ready:true` |
| 表单路由挂上了 | 公网 `GET /f/<假 token>` | **HTML** 404 员工页（`lang="zh"`、noindex） |
| 注册表可达 | 公网 `GET /team/ctx_doesnotexist` | 404 |
| 跑的真是这版代码 | `docker exec avery grep -c _CJK /app/avery/memory.py` | **2**（T8 的中文分词在镜像里） |
| 同上 | 容器里 `form_api.py` / `form_reflow.py` / `form_append.py` | 三个都在 |
| 迁移真落库了 | Supabase `information_schema.tables` | 多出 **`form_templates`**、**`form_submissions`** |
| 0014 也落了 | `form_submissions` 列 | 末列是 **`project_ref`**（T5 绑项目） |
| T6 的 kind 扩容 | `pg_constraint` on `avery.entities` | CHECK 里含 **`'conflict'`** |
| T5 的人卡字段 | 同上（person payload 白名单） | 含 **`person_id` / `self_report` / `provenance`** |

## 没做什么（有意留给 HITL）

- **没有在生产上做任何写库动作**：没上传语料、没铸链、没提交表单、没跑 /advise。
  预检容器连的就是生产库，往里写测试数据 = 污染真 context（0720 有前科）。
  全链的真实走查是 Danny 的 HITL 轮。
- 因此「表单链路在生产上真的能跑通」目前只有**结构性证据**（路由挂载 + 表在 + 列在 + 代码指纹），
  没有**行为证据**。行为证据在 HITL 轮拿。

## 留给下一次上产的两条

1. 🔴 **`/health` 仍然没有版本字段**——「生产跑的是哪个 commit」外部不可核，只能靠
   swap 日志 + `docker exec` 抠文件指纹自证。这次是这么补的，但每次都做一遍很蠢：
   建议下次顺手给 `/health` 加一行 `build`（镜像 tag 或 commit），**这次没做**（T8 刚绿，不想在
   上产同一趟里夹带代码改动）。
2. ⚠ 前端「上产」这件事在本项目里**不存在人工步骤**，存在的是核实步骤：
   `curl 站点 → 抠 index bundle 里的 commit → 再抠 lazy chunk 验业务串`
   （三个壳都是 `lazy()` 分包，只 grep index 会空转——0805 空转过 20 轮）。
   本次实测：新文案（`可能只是叫法不同` / `来自周报填写` / `自述负载` / `手上最新的一份资料`）
   全在 **index 主包**里（i18n 词典没被拆出去），class 名与规则 id 在 `Lite2App-*.js`。

## 回滚

一条命令：`sudo docker rm -f avery && sudo docker rename avery-prev-20260807-142044 avery && sudo docker start avery`
（退一级 = `main-20260805-160609`；再往前的镜像 tag 都还在机器上，`docker images avery-agent`）。
