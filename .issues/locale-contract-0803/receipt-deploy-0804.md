# 部署回执 · #38 locale 契约上生产（2026-08-04）

**一句话**：契约切换的两半**同批上线**——前端 Vercel 自动部署 `89b36e4`，后端换容器到
`avery-agent:main-20260804-153841`（从 `main` 构建，不挑子集）。两端都**核到产物层**，
不是只看 200。

## 为什么必须同批

ADR-0033 是一刀切、不做新旧并存。「新前端 + 旧后端」不崩，但 4 条带阈值的规则标题里
占位符会渲染成空（旧后端不发 `matched_rules[].params`），且 `/advise` 的 locale 被忽略
（＝回到"正文语言靠涌现"）。所以后端不能拖到下一棒。

---

## 前端

- `git push origin main`：`c94a7e7..89b36e4`（3 提交）→ Vercel 自动构建。
- 线上 `assets/index-CqAuE9zj.js` 里 `commit:"89b36e4f61675ca9e0ab3f54d76d189c3dc82e8e"`
  —— 与本地 HEAD **逐字相等**。
- 判读文案逐条核到线上 bundle（各 1 处命中）：
  `By the rules this is` · `Clear to proceed` · `Needs confirming` · `Straight from your files` ·
  `R-BLOCKER-STACK` · `R-DUE-SOON` · `按规则判为` · `看的字段`。
  两种语言的表都在主 chunk 里，`decisionGrades` 的读取点在 `Lite2App-4Dkfpcv_.js`。

## 后端

- **镜像**：`avery-agent:main-20260804-153841`，从 `/home/admin/build-zh` @ `89b36e4` 构建
  （`git reset --hard origin/main`，🔴 **默认从 main 构建**，无子集）。
- **本次一起上线的、不属于本票的后端提交**（生产镜像此前停在 `0884d49`，这四条是那之后
  积压在 main 上的，按"从 main 构建"的纪律一并带上）：

  | commit | 内容 |
  |---|---|
  | `1ce41aa` | refactor(seam)：删掉过不了删除测试的 `build_live_case_for_context` |
  | `3d4c523` | fix(brain)：超时挂不上时不再静默——补 warning + MockBrain 白名单 |
  | `048f9b7` · `0038542` · `214d6df` · `1439092` | 文档/注释（.env.example、guards 接口说明、迁移 README、ADR 索引），零行为变更 |

  `db/migrations/0001_avery_persistence.sql` 的 diff **只有一行注释**（ADR 撞号消歧
  `ADR-0023` → `ADR-0023-postgres`），不是 schema 变更。
- **env**：从在跑容器提取到 `/tmp/avery_env_20260804-153841`（600，**29 行**），
  只取 `MINIMAX_/DASHSCOPE_/DEEPSEEK_/AVERY_/SUPABASE_` 前缀；PATH/PYTHON_*/LANG 等镜像自带项
  不回灌。`AVERY_DB_URL`、`AVERY_ALLOW_PERSON_SCORING` 均在位。
- **隔离 8138 预检**（🔴 预检容器连的是生产库，只走不写库的路径）：
  - `/health` 2 秒即 ok —— `brain=minimax` · `live=true` ·
    `embeddings=dashscope:text-embedding-v4/1024` · `extractor=llm:minimax` ·
    `extraction_mode=llm` · `degraded=false` · rss 53.8MB · `llm_calls_remaining=2000`。
  - `/demo/status` = `{available:true, ready:true}`。
  - 🔴 **「镜像里是不是新代码」用纯本地断言验，没打 `/advise`** —— 真 brain 在场，
    那是一次**真花钱**的调用。`docker exec` 跑纯 Python：
    `locale` 在 `AdviseRequest.model_fields` ✅ · `normalize_locale('zh-CN')` →
    `('en', "unsupported locale …")` ✅ · zh/en 语言指令不同 ✅ ·
    载荷键里**没有 `grade_label`** ✅ · 命中键 = `{evidence, grade, params, rule_id, severity}` ✅ ·
    规则版 `reason` 为空串 ✅。
- **预检容器已 `docker rm -f`**（8138 释放，不重演 0723 那次占口 4 天）。
- **换容器**：`sudo bash /tmp/swap3.sh 20260804-153841 avery-agent:main-20260804-153841`
  → **SWAP SUCCESS**，健康闸 1×2s 过。（swap3 而不是 swap2——swap2 会丢 demo-seed 挂载。）
- **迁移懒加载**：`GET /team/ctx_doesnotexist` → 404，主动触发 `_ensure_schema`（本轮无新迁移，空放）。
- **换后复核**：容器内纯 Python 断言重跑一遍（`locale` 字段在 ✅ / `grade_label` 已消失 ✅ /
  命中带 `params` ✅）；公网 `https://avery.dannyqian.com/health` ok、`/demo/status`
  `{available:true, ready:true}`。

### 回滚梯

```bash
sudo docker rm -f avery && sudo docker rename avery-prev-20260804-153841 avery && sudo docker start avery
```
（`avery-prev-20260804-153841` = 上一版 `avery-agent:main-20260802-113944`，未删。）

---

## 没做、留给下一次的

- **真 brain 的 `/advise` 端到端没在生产上跑**——那是一次真花钱的调用，且属于"对外/花钱"闸。
  想验的时候一句就够（会消耗一次 MiniMax 调用）：

  ```bash
  curl -s -X POST https://avery.dannyqian.com/advise -H 'Content-Type: application/json' \
    -d '{"situation":"delivery is slipping, how do I talk to the lead?","stream":false,"locale":"zh"}' \
    | python -c "import sys,json;print(json.load(sys.stdin)['advice']['summary'][:60])"
  ```
  该回**中文**。回英文 = 语言指令没进 prompt。
  链路本身已在本机 mock 上端到端验过（`verify-locale-parity` 48/0），
  prompt 那一段由 `test_locale_contract.py` 逐条断言——生产这一跑只为回答
  「真模型听不听那句话」，不是回答「代码通没通」。
- **生产库零写入**：本次部署全程没有任何上传/`/advise`/写库操作。
