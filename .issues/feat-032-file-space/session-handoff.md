# feat-032 — 每公司文件空间:源文档持久留存 + 可回看 · session handoff

> 2026-07-13 · AFK gate-first · branch `feat/032-file-space`(base=feat/031-real-rag tip `21e6bae`,**未 push**)
> commits:`e939d32`(backend)· `7819de3`(frontend)· feature_list/handoff 收盘 commit

## 使命完成度

PRD「每公司文件空间」+ User Story 4 全部落地。停「解析后即弃」——上传的原始字节 + 元数据持久留存,用户可回看清单、agent 可溯源。三条使命全绿:

1. **持久留存源文档** — 原始字节(filename/mime/size/doc_kind/uploaded_at)落 `avery.source_documents`(Postgres bytea),重启后仍在。temp 文件仍删(磁盘卫生),字节先入库。
2. **文件清单 API** — `GET /team/{id}/files` → 每文件 `{idx, filename, size_bytes, mime, doc_kind, uploaded_at, n_chunks}`(n_chunks 经 `materials.source` 前缀 `<filename>:<line>` 聚合链接)。`GET /team/{id}/files/{idx}` 下载原字节。
3. **lite「your files」视图** — UploadPanel 接成持久清单(filename · size · n_chunks),喂上面 API。

## 改了什么(落在既有 registry get/put 接缝之后,零引擎改动)

### Backend
- `eval-harness/db/migrations/0004_source_documents.sql` — 新表,CREATE IF NOT EXISTS,avery-scoped,只增不改不 DROP。`content bytea` + `storage_ref text`(feat-035 对象存储 seam,v1 走 bytea)。沿用多迁移按序跑 `_ensure_schema`。
- `avery/ingest/registry.py` — `SourceDocument` dataclass;`CompanyContext.source_documents` 维度 + `file_cards()`(纯元数据清单,`_chunks_per_file()` 聚合 n_chunks);`ContextRegistry.source_document_bytes(cid, idx)`(内存持有字节)。
- `avery/ingest/pg_registry.py` — put() 写 bytea(re-put=replace,含 DELETE);get() 只读元数据(bytes 按需,`content=None`);`source_document_bytes()` 按需拉 bytea;`_assert_no_control_chars` 扩到 filename/mime(bytea content 豁免 NUL)。
- `avery/ingest/pipeline.py` — `source_documents` 参数把 handler 已读字节透传;`_finalize_source_documents` 按 parser 补 doc_kind + size + uploaded_at。
- `avery/ingest/__init__.py` — 导出 `SourceDocument`。
- `service/ingest_api.py` — /ingest 从 `await f.read()` 就地建 SourceDocument(不二次读),temp 仍删;`GET /team/{id}/files`(清单)+ `GET /team/{id}/files/{idx}`(下载:attachment + RFC5987 文件名 + 通用 type,不可信内容永不 inline 渲染)。

### Frontend
- `src/lite/transport.ts` — `LiveFileEntry`/`LiveFilesPayload` 类型 + `fetchFiles()`(接口 + HTTP 实现)。
- `src/lite/store.ts` — `files` state + `refreshFiles()`;上传后 + team 刷新时拉(次要视图,拉失败不打断成功上传)。
- `src/lite/UploadPanel.tsx` — 渲染「Your files」清单(filename · size · n_chunks),pre-032「No files yet」空态不变。
- `src/lite/styles/lite.css` — 薄文件行样式。
- `src/shared/i18n/{en,zh}.ts` — `upload.filesTitle` / `upload.filesChunks`。
- `src/main.tsx` — **DEV-only** `window.__AVERY_LITE__` store 钩子(DOM 断言用;`import.meta.env.DEV` 生产构建静态 false → dead-code eliminated,不 ship)。

## 三层测试

| 层 | 命令 | 结果 |
|---|---|---|
| 离线(零外网) | `DASHSCOPE_API_KEY='' MINIMAX_API_KEY='' pytest -m "not seedgate and not smoke and not needs_keys" -q` | **343 passed** / 22 skipped / 8 deselected / 1 xfailed(base 341,+2=source_documents 契约内存腿) |
| @needs_db | `AVERY_DB_URL=postgresql://postgres:avery_local_dev@127.0.0.1:5433/postgres pytest -m needs_db -q` | **22 passed**(base 18,+4=契约 pg 腿×2 + pg 新实例存活 + file-space restart 集成) |
| 前端 | `./init.sh`(eslint 墙 + tsc + vite build) | **绿** |

离线零外网:psycopg 惰性导入,pg 腿无 URL 干净跳过。

## 集成层证据(agent 当第一个用户,HTTP 面)

- `tests/test_persistence_restart.py::test_file_space_survives_a_service_restart`(@needs_db):真 uvicorn POST 两个官方 seed → `GET /team/{id}/files` 列 2 文件含 n_chunks>0、`GET /files/0` 下载原字节 byte-identical → **HARD KILL** → 新进程/新 `AVERY_DATA_DIR`(fresh-machine)→ 清单仍在、字节仍可下载 byte-identical、未知 id 仍 404。
- offline TestClient 冒烟(在会话中跑过):ingest → files(size/mime/doc_kind sniffed=roster/company、n_chunks 6+7)→ download 5032B attachment(`Content-Disposition: attachment; filename*=UTF-8''Team_Roster.xlsx`)→ ghost 404 / oob 404。

## 前端 DOM 断言(dev server :5233,计算值——canvas rAF 故用 javascript_exec 取 computed 值 + DOM 文本)

- `?mode=live&lang=en`:`.upload-files` 渲染 2 行,`Team_Roster.xlsx`=「4.9 KB · 6 references」、`LogiPulse-Roadmap.pdf`=「180.0 KB · 11 references」,title=「Your files」;computed display=flex、border 1px。
- `?mode=live&lang=zh`:title=「你的文件」、meta=「4.9 KB · 6 处引用」、CJK 文件名正常。
- **story-untouched**:`?mode=story` 下 lite 类(.lite-shell/.upload-panel/.upload-files/…)计数=**0**、story shell 渲染(topbar + scene-stage 41 nodes + 520 chars body)、**0 console error**。`src/story/**` 逐字节未碰。

## Supabase 迁移状态

- 项目 `nunsbijtntreynoyeilp`(共享 imaread)。`0004_source_documents` 经 MCP `apply_migration` 应用成功。
- 只读 `execute_sql` 验证 `avery.source_documents` 9 列 = 本地 schema 逐列一致(context_id/idx/filename/mime/size_bytes/doc_kind/content bytea/storage_ref/uploaded_at)。DDL 仅 avery、只增不 DROP、public(imaread)零触碰。

### Schema 摘要(avery.source_documents)
```
context_id  text NOT NULL REFERENCES avery.contexts(context_id) ON DELETE CASCADE
idx         integer NOT NULL
filename    text NOT NULL
mime        text NOT NULL DEFAULT 'application/octet-stream'
size_bytes  integer NOT NULL DEFAULT 0
doc_kind    text NOT NULL DEFAULT 'company'
content     bytea                       -- 原始字节(v1 inline;NULL 允许)
storage_ref text NOT NULL DEFAULT ''    -- feat-035 对象存储 seam,未用
uploaded_at timestamptz NOT NULL DEFAULT now()
PRIMARY KEY (context_id, idx)
```

## 纪律核对

- 🔴 **文件内容是不可信数据**:只存储/列/展示/下载,绝不作指令跟随(readiness §2-I;下载强制 attachment + 通用 type,浏览器永不 inline 渲染上传的 HTML)。
- 未碰:redline.py / redline_extract.py / PersonEntity / FROZEN.lock.json / loop.py / engine.py / tools.py / memory.py / extractor-advisor 分离。`src/story/**` 零改。门断言不削弱(只增)。
- gate-first 先红后绿(backend 首红=ImportError:SourceDocument)。离线套件保持全绿零外网。
- 未 push;未动协调者未追踪 draft 文件。

## 自评薄弱点(对抗验证会打这里)

1. **uploaded_at 表示差异**:内存腿=ingest ISO 串;pg 腿=DB timestamptz → `.isoformat()`。契约只断言稳定字段(filename/size/mime/doc_kind/n_chunks)精确 + uploaded_at 非空,**未强求两腿 byte-equal**(表示合法不同)。若对抗验证要求跨腿 uploaded_at 完全一致,需改成 text 列或统一格式化。
2. **解析失败文件仍入 source_documents**(n_chunks=0,doc_kind='company')。这是有意的「回看」诚实(用户传过就该看到),但会与已解析文件混列;当前无 UI 区分「未解析」。若全部文件解析失败则 report.ok=False、无 context、字节丢弃(422)——符合预期。
3. **重名文件未去重**:同名多传时 temp 覆盖 + n_chunks 按 filename 求和会合并计数。v1 edge,未处理。
4. **下载端点无鉴权**:任何持 `context_id` 者可下载原字节——与现有 `/team/{id}` 同一隔离档(feat-034 owner_token 尚未落)。feat-034 上租户隔离时,这些新读路径需一并纳入 owner_token 校验(与 /team、/advise 同规格)。
5. **zh 新 key 手写**(你的文件 / 处引用):**未走 scripts/i18n-zh.mjs**(该 script 全量翻 5 区块,既有 story-shared 译文有漂移风险 + 全量超 token 坑,kickoff 明确告诫)。手写 2 个短 UI 标签精确、已随文件既有 ⚠Draft/待 Danny 审字 标记;可后续定向 M3 翻新。
6. **前端 DOM 断言靠 DEV-only 注入桩**(`window.__AVERY_LITE__` + setTransport),非真后端上传(浏览器自动化设 file input 受限)。集成层的真后端 upload→重启→清单 已由 @needs_db restart 测试覆盖;前端桩只验渲染,不验 HTTP。

## 待 Danny / 后续(非阻塞)

- push 授权(对外闸)。
- feat-034:把 /files、/files/{idx} 纳入 owner_token 校验(见薄弱点 4)。
- zh 文案定向 M3 审字(见薄弱点 5)。
- 可选增强:大文件 size 上限(feat-035)、「未解析」UI 标注、下载按钮接进 lite 清单(当前 API 具备,UI 未加下载入口——薄视图只做回看清单)。

## 独立对抗验证前置

收盘必经独立对抗验证。建议 crafted 输入打点:重名上传、解析失败混列、跨腿 uploaded_at、下载不可信 HTML 是否 inline、未知/越界 idx、re-put 替换语义、bytea NUL 往返、CJK/含引号文件名的 Content-Disposition 注入面。
