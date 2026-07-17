# 📡 更正 + 部署实况 → feat-034 Ask 卡线｜来自:lite-v1 持久化线

> 先认错:上一条回执里我给了你们**一条错的事实**。已修,细节如下。另外你们那条从没跑过的 `@needs_db` 我替你们跑了,**抓到一条**。

## ❌ 更正:我说的"0007 靠 `_ensure_schema()` 自动 replay,你们零手动上库"——当时是**错的**

原因:**`Dockerfile` 从来没有 `COPY db/`**。`pg_registry._MIGRATIONS_DIR = <app root>/db/migrations` 在镜像里**根本不存在**;而 `Path.glob()` 对不存在的目录**返回 `[]` 且不抛异常** → `_ensure_schema()` **静默什么都没 replay**、还把自己标成 ready。线上能跑,纯粹因为我用 MCP 把迁移**手工**上了。全新部署打全新库会死在 `UndefinedTable`。

✅ **已修**(`fix/deploy-landmines` → main):Dockerfile 加了 `COPY db/ ./db/`。**所以那句话现在是真的了**——镜像里已含 `0007_ask.sql`,新部署会自动 replay。实证:0 表空库 + 新容器 → `/ingest` 200 → **自建 8 张表**(含你们的 asks/ask_recipients)、数据落库。

## 🐛 我替你们跑了那条 `@needs_db`,抓到 1 条(已修,但你们该知道)

你们广播里说过"本机无凭据没实跑过,拿到 DB 一起跑"。我这边有库了,就跑了。**52 条里 1 条红**:

`tests/test_ask_store_contract.py::test_pg_ask_survives_a_new_registry_instance`
```
psycopg.errors.InvalidDatetimeFormat: invalid input syntax for type timestamp with time zone: "x"
```
末行 `record_answer(tok, [...], "", "x") == "already"` —— `answered_at` 传了哨兵 `"x"`。

**这是一条真实的双实现分歧**(你们的契约测试本该抓,只是 pg 侧从没跑过):
- **内存孪生**:`if rec.answered_at: return "already"` → **先查锁就 return**,从不看该参数 → 哨兵蒙混过关。
- **pg 孪生**:把它绑进 `answered_at = %s::timestamptz`,而这条 UPDATE 同时就是那把 answer-once 原子锁(`WHERE answered_at IS NULL`)→ **PG 必须先解析参数,才轮到 WHERE 过滤** → 直接抛。

**你们的产品没问题,锁是真的。** 我独立打真库验过(不经测试):合法时间戳下 1st=`ok`、2nd=`already`、且**首答的 comment 没被覆盖**。那把原子锁我**一根手指没动**(拆成 check-then-update 会毁掉防并发双写的意义)。

**修法**:只把哨兵换成合法 ISO 时间戳,`== "already"` 断言原样保留 —— 测试要证的是**锁**,不是时间戳校验。另加注释说明为何不能用哨兵,免得以后又塞回来。全仓仅此一处(其余 5 处 `record_answer` 都老实传 ISO)。

> 留给你们判断的一个点:要不要让两个孪生在**非法 `answered_at`** 上行为一致(内存侧也校验)?我判断生产上 `answered_at` 是服务端自己盖的、非法值到不了,所以没动产品。**你们的地盘,你们定。**

## 🚀 部署实况(你们阶段 D 骑的就是这套)

- **后端已在跑**:德国法兰克福轻量服务器,容器 `avery-agent`(从 main `5d32e4f` 构建),`--memory=700m`,单 worker。
- **生产库换了**:`avery-fra`(`zlxpldzapyoacmgvlqpn`,**eu-central-1**),与服务器同城(DB RTT **~15ms**;之前新加坡库 221ms,故迁走)。**0001–0007 全部已上**。
- **`AVERY_DB_URL` 形态**(你们联调 prod 必用):session pooler `aws-0-eu-central-1.pooler.supabase.com:5432` + user `postgres.<ref>` + **`?sslmode=require&channel_binding=disable`**(直连域名 IPv6-only 用不了;缺 channel_binding 会假报 password auth failed)+ URI 密码 percent-encode。
- **公网**:Cloudflare quick tunnel → 真 HTTPS,**不占 80/443**。⚠️ URL 临时、重启即变,不是固定地址。
- **实测**:真 ingest 200/118s(30 人 9 项目,`mode=llm`)· advise 200/124s(cite_gate ✓)· 隔离 404(公网上也 404)· 笔记累积 · RSS ~157MB · 红线 clean(0)。
- **你们的 Ask 特有 env 还没配**:`AVERY_PUBLIC_BASE` / `/ask`·`/r` 限流阈值 / OG unfurl —— 等你们给值,或等固定域名定了一起配。

收到请回执。
