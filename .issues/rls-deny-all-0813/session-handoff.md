# session-handoff — rls-deny-all-0813（issue #98）

本行 worktree：`D:\avery-wt-inspiring-chaum-48a5ee`，分支 `claude/inspiring-chaum-48a5ee`。
未写 root `progress.md` / root `session-handoff.md`（worktree 规矩，交给主检出 integrator 收编）。
未动 `feature_list.json`：#98 是 issue 线，`feature_list.json` 里的 `feat-098` 是**另一件事**
（time-rules-b1），两套编号不通用，别对齐。

## 状态

代码写完、验完，**卡在人工闸**：动生产库要 Danny 点头。证据全文见 `receipt-98.md`，
已作为评论贴到 issue #98。

🔴 下一个 session 最容易踩的坑：**别顺手把这个分支合进 main**。迁移文件进 main → 下次构建部署后
`_ensure_schema` 首次访问 registry 时自动重放到生产 → 绕过人工闸改了生产。合并即上产。

## ⚠ 0814 更新：本分支已落后 main，且回执里有一句话过期了

那条「顺手逮到的存量问题」（0002 每次 bootstrap 取 ACCESS EXCLUSIVE）开成了 **#104，已经修完并
合进本地 main**（`673c986`）。由此产生两件事：

1. **`receipt-98.md` 里「0002 是唯一 BLOCKED 的一个」现在是历史陈述，不再是当前事实**——
   0002 已改成守卫式，那条红没有了。回执**不改**（它记的是 0813 当时的实测），但读的人要知道
   时间戳。
2. **本分支基于旧 main，落后 `#99` / `#101` / `#104` 三票**。合之前要先把 main 并进来，
   **合并树要重跑 `-m needs_db` 全仓**——0019 与 0002 改的是同一个 `_ensure_schema` 重放路径，
   虽然彼此独立，但「独立」这个判断也该由跑出来的绿来兑现，不是由推理兑现。

  合完之后 0019 的守卫逻辑不受影响（它查 `pg_class.relrowsecurity`，与 0002 查 `pg_constraint`
  互不相干），预期是零改判——**但这是预判，不是结论**。

## 改动（2 个文件，都在 eval-harness）

- `db/migrations/0019_enable_rls.sql`（新增）——catalog 驱动、守卫式、无 policy、无 FORCE
- `tests/test_registry_contract.py`（追加一个 `@needs_db` 测试）

## 结论速览

- 票面说 12 张表，实为 **13**（漏了 `ingest_jobs`）→ 0019 不写死清单，按 catalog 遍历
- 票面说的裸 `ALTER ... ENABLE` 写法**不能用**：即使 RLS 已开也取 ACCESS EXCLUSIVE，每次
  bootstrap 都会抢 `entities` 的锁 → 必须守卫式
- 后端零影响已用非 superuser owner 角色实测兑现，配 FORCE 的 born-red 对照证明尺子有牙
- 全仓 `-m needs_db`：143 passed

## 交接给别人的两件事

1. ~~**存量 bug，已开卡，不在本票**~~ → **已成 #104 并合进 main（0814）**：
   `0002_person_keys_allowlist.sql` 的 `DROP CONSTRAINT IF EXISTS` 每次 bootstrap 取
   ACCESS EXCLUSIVE，逐文件实测下曾是 0001–0019 里**唯一** BLOCKED 的一个。已改守卫式，
   `pg_registry.py` docstring 与 README 规矩 2/5 一并订正，并加了
   `test_steady_state_bootstrap_takes_no_entities_lock` 真持锁兑现。回执 `receipt-104.md`（在 main 上）。
2. 本 session **没有 Supabase MCP 工具**，生产侧只读复核（`list_tables` /
   `has_schema_privilege`）没能重跑；票面 0813 的实查数字未经本轮重新测量。

## 复现环境（一次性库）

```bash
docker run -d --name avery-rls-0019 -e POSTGRES_PASSWORD=dev -p 55439:5432 pgvector/pgvector:pg16
```

跑 needs_db 全仓（cwd 必须是 `eval-harness`，仓库根跑裸 pytest 会真花钱）：

```bash
AVERY_DB_URL=postgresql://postgres:dev@localhost:55439/avery_suite AVERY_BRAIN=mock AVERY_EXTRACTOR=heuristic AVERY_EMBEDDINGS=keyword python -m pytest -m needs_db -q
```

⚠ `AVERY_EXTRACTOR` 默认是 `auto`，本机 `.env` 里有真 key —— 不显式设 `heuristic` 会真烧钱。
⚠ 该容器时钟来回跳 ~115s，别写 `created_at < now()` 形态的判据。
