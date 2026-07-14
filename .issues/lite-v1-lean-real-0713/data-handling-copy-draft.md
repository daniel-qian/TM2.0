# 「你的数据如何被处理」基础说明口径(lite v1 · PRD User Story 13 · 待 Danny 拍口径)

status: draft-for-danny · date: 2026-07-13 · source: PRD Story 13 + session-close §6
定位:**轻量诚实说明,不是 DPA/ToS/隐私政策**(重合规明确 Out of Scope)。原则:克制、
不过度承诺(禁"绝对安全/银行级加密"话术)、不法律腔;每句可被当前实现兜住,兜不住的标注。

---

## 1 · 放置位置建议

- **主入口:上传面板内**。`UploadPanel` 已有 `.upload-privacy-note`("Nothing is scored…"),
  在其后追加一个文字链 "How your data is handled →",点击开**只读浮层**(复用
  `.lite-detail-overlay` / `.lite-detail-card` 模式,role="dialog",无新导航概念)。
  理由:用户掏真实员工数据的**决策瞬间**在上传面板,说明必须在手边,不能只藏在别的 tab。
- **副入口**:Avery's notes 屏的红线信任条(姊妹稿 §4)链到同一浮层;不做独立 tab
  (5 tab 已到上限,说明页不值一级导航)。
- 全文走 i18n(`t.lite.dataHandling*`),中文后续 M3。

## 2 · EN 全文初稿

> 浮层标题层级:eyebrow + h2 + 分节小标题(`.eyebrow`)+ 正文段。⚠ = 涉及事实、依赖后端
> 实现的句子,随实现更新(汇总见 §3)。

**eyebrow:** Plain answers
**title:** How your data is handled
**lede:** You are about to upload real files about real people. Here is honestly where they go and what touches them — in plain words, not legal ones.

**Where your files live**
When you upload, your files and the team Avery builds from them are stored in a hosted
database (⚠ Postgres on Supabase), so your workspace is still here the next time you open
your link — including across our own restarts and upgrades. ⚠ This is a managed cloud
service; we run a small setup, not a hardened enterprise deployment.

**Who can see your workspace**
Your workspace is tied to an unguessable link (⚠ token). Anyone who has your link can open
your workspace — there are no accounts or passwords in this version, so treat the link like
a key and share it only with people you'd show this data to. Other companies cannot see
your data, and you cannot see theirs (⚠ every read is checked against your workspace token).
The people operating this service can technically access the database that stores your
data; we look only when needed to run or fix the service.

**What the AI sees**
To read your documents and answer your questions, we send their content to large-language-
model providers (⚠ currently MiniMax and DeepSeek for reasoning, and an embedding provider
for search). That means your document text leaves our database and is processed on their
servers under their terms. If that is not acceptable for some material, don't upload it —
the deployed product exists precisely to run inside your own environment instead.

**Avery's own notes**
Avery writes down observations about your company as you use it. These notes are stored
with your workspace, are visible to you in "Avery's notes", and pass the same red line as
everything else.

**The red line**
Nothing in this product scores, ranks, or profiles a person — not the team view, not the
answers, not Avery's own notes. This is enforced by a deterministic gate in the code, not
by a policy we promise to follow, and no instruction — yours or ours — can turn it off.

**Deleting your data**
⚠ There is no self-serve delete yet in this version. If you want your workspace and files
removed, contact us (⚠ 渠道待 Danny:邮箱/微信,发链接的融资团队同事也可代转) and we will
delete them from the database. Honest caveat: ⚠ we cannot delete whatever the model
providers retain under their own policies, which is another reason not to upload anything
you wouldn't send to a cloud AI service.

**What this is**
A working trial you drive with your own files — real storage, real retrieval, real memory —
but not yet a product with contracts, compliance paperwork, or uptime guarantees. Judge it
as exactly that.

## 3 · 事实依赖清单(随实现更新,feat/033+ 持有)

| 句子/断言 | 依赖 | 现状 |
|---|---|---|
| "stored in a hosted database (Postgres on Supabase)" | Supabase-backed `ContextRegistry` 落地 | PRD 拍板,**未实现**——持久化 feature 落地前此页不能上线 |
| "still here … across restarts" | 同上(持久化) | 未实现 |
| "unguessable link (token)" / "every read is checked" | 每 context token + 读路径校验(PRD 隔离档) | 未实现(feat-028 只有未知 id 404) |
| "currently MiniMax and DeepSeek … embedding provider" | `brain_factory` / `embedding_factory`(DashScope)实际接线 | 供应商名单随部署配置变;**是否点名**待 Danny(§4-2) |
| "no self-serve delete yet … contact us" | 删除端点缺席 + 人工删除路径真实存在 | 若 v1 加自助删除,整段改写 |
| "cannot delete whatever the model providers retain" | 供应商数据保留政策 | 措辞已保守;点名供应商则需核对其条款 |
| 联系渠道占位 | Danny 给邮箱/微信口径 | ⚠ 未定 |

## 4 · 留给 Danny 的口味决策点

1. **坦承运营者可访问数据库**("The people operating this service can technically access…"):
   本稿主张写(诚实是卖点,且事实如此);Danny 可拍是否软化措辞——但不建议删。
2. **是否点名 LLM 供应商**(MiniMax/DeepSeek/DashScope):点名更诚实、对境内公司反而加分;
   但随配置漂移要维护。替代:"AI model providers we configure"泛称。
3. **删除联系渠道**:邮箱/微信/经融资团队转达,选一个真的会有人看的;此渠道一并写进
   浮层与后续任何对外页脚。
4. (关联)**"deployed product runs in your own environment"这句钩子**:数据说明里带一句
   lead-gen 钩子(本稿写了)是否合适,还是说明页应保持零销售味。
