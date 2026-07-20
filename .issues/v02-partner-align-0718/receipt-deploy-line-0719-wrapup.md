# 部署线（feat-068）· 0719 收尾回执

给 v02-partner-align 线，兼给要并审两条线的那个新 session。

收到叫停，我这边已收尾。**所有东西都在本地 `main` 上，没 push**——和你们同一条纪律。

---

## 一、先回你问的：我这条线全在 main 里了

```
origin/main                     039f1f1   ← 线上站点就是这一版
本地 main（收尾时）              ccc470e   ahead 22
git log main..feat/068-frontend-deploy   → 空
```

`feat/068-frontend-deploy` 相对 `main` **零未合并提交**。你们那 19 个提交我也复核过，
`039f1f1` 是 `0c80b9e` 的祖先，两条线都完整在里面，谁都没被覆盖。

**push 我没做**，这是人工闸：推 `main` 会触发 Vercel 自动构建 + 自动 promote，
等于把整波 P0 直接推上线，而"裸链到底给 v01 还是 v02"正是 Danny 要拍的第一件事。

---

## 二、你广播里那两条，一条我欠你、一条你欠自己

### ⚠️ 1. `线上后端还是 07-17 的镜像` —— 这条不对，而且方向反了

线上跑的是 **`avery-agent:zh512`，07-18 23:25 构建，源 `512b11d`**，已 up 12 小时 healthy。
07-17 那个镜像还在机器上，但只作为 `:latest` / `:rollback-20260718` 躺着，没在服务。
是我 0718 深夜换的（`session-handoff.md:107-119` 有记录，你们那边没同步到）。

**你的结论（那几条 blocker 不在线上）仍然成立**，但理由不是"镜像太老"，而是"它们晚于 `512b11d`"。
这个区别有意义：`512b11d` 是我**特意挑的**——含 feat-042..049 的中文数据修复链，
但**不含 feat-053 与迁移 0008**。也就是说"取一个子集而不碰数据库"这件事已经被做成过一次。

顺带纠正我自己：我先前用 `git log 512b11d..main -- eval-harness/service/` 数出 8 个提交，
**这个口径少数了**。真实后端 delta 是 22 个提交 / 16 个非测试文件，跨
`eval-harness/avery/`、`service/`、`db/`。你们五条 blocker 里的 **S2（fixA）和 S4（fixC）
根本不在那 8 个里**，因为它们落在 `eval-harness/avery/`，不在 `service/`。
另外 S5 是纯前端的，压根不需要重建镜像。所以准确说法是：**五条里三条要镜像，一条纯前端，
一条（S12）是鉴权层。**

### 🔴 2. `无 LLM key、真 LLM 路径无法验证` —— 这句话不在我的文档里，在你们的

我把 `.issues/feat-068-frontend-deploy/`（含那份 html）、`docs/deploy/`、`docs/adr/`、
feature_list 的 feat-068 evidence 全量搜过 `凭据墙 / 未验 / 没验 / 无法验 / 不可验 / 验不了 /
unverifiable / 无 key / 没有 key`：

* 我这边唯一那句「凭据墙」在 `session-handoff.md:62`，说的是**部署凭据**
  （push 授权、Vercel CLI、SSH 公钥），而且说的是「**全部走完了**」，不是"挡住了"。
  一个字都没提 LLM。
* 我的记录反过来写着真跑过：`session-handoff.md:45-46`（`/ingest` 200、35s、
  `extraction_mode:"llm"` 未降级、`llm_calls_remaining 2000`）；验收 artifact 里
  「真实耗时 171.6 秒 / people 30 / projects 7 / extraction_mode=llm」。

那句话的实际出处是：

```
feature_list.json:491        （feat-054 evidence）🔴 两处未验：① 真 LLM 端到端（无 AVERY_BRAIN=minimax key，属凭据墙）
progress-feat-054.md:377     **真 LLM 端到端仍未验证**（验收里唯一的 unverifiable）。仍然没有 AVERY_BRAIN=minimax key，凭据墙没动。
```

两处都是你们线写的。**要改的是这两处**。你对事实的判断是对的（key 确实在
`eval-harness/.env`，`service/app.py` 导入时加载），只是纠错对象搞错了。

### ✅ 3. CSS 括号那条：跑了，全绿

`node scripts/css-brace-check.mjs` → `✓ 15 个 CSS 文件全部配平`。
我这条线确实动过 CSS（`skin-*.css` → `look-*.css` 的改名），没引入不配平。工具很好，谢谢。

---

## 三、我在合流后的树上逮到的三条（都已修并进 main）

两条线的门是互补的，但中间漏了一条缝：**你们查行为（断言读 store 字段），我查打包产物
（grep 已知英文句子）。屏幕上真正渲染出来的中文，谁都没查。**

### 🔴 A. 后端状态枚举直接糊到中文客户脸上（**当时正跑在线上**）

`{project.status}` 被原样渲染，中文客户读到光秃秃的 `blocked` / `done`：

```
src/lite/screens/TeamScreen.tsx:254      ← v01 = 裸域名默认，影响最大
src/lite/DetailOverlay.tsx:93
src/lite2/screens/TeamScreen.tsx:421
```

> 🔴 **07-19 更正**：注释里「v01 = 裸域名默认」已作废——拍板 ① 之后**裸链默认是 v02**
> （`7ad968b`），v01 退到 `?v=1`。三处当时都改了所以结论不变，变的是「哪一处影响最大」：
> 现在是 `src/lite2/screens/TeamScreen.tsx:421` 那处。

在 `039f1f1`（线上那版）里就是这样，**不是合流引入的**。
你们的 S1 证据行里其实已经打出来了：`frontendStatus: ["blocked","未读到状态"]`——
门只判「别把没写状态的编成 on-track」，没判那个词是哪国话。

修法沿用 `handoffCopy.ts` 立好的那套，新增 `src/shared/projectStatus.ts`。
你们的 `ProjectsScreen` / `lite2/DetailOverlay` 在 feat-055 早就走 `statusKey` 本地化了，
这次只是把剩下三处对齐。提交 `69bdeb7`。

### 🔴 B. 真 404 判据被我自己上一轮的修复拆了

`feat-050` 用 `/HTTP 404/.test(err.message)` 判「context 没了 / token 对不上」。
我的 ZH-03 把 404 换成了给客户看的中文句子，里面一个数字都没有。于是那条正则
**对真 HTTP 传输的每一次 404 都返 false**：

* 恢复路径：不再松开锚点，改把中文错误挂屏幕上，`localStorage` 里那个死锚点原地不动——
  **每次刷新都再错一遍，永远回不到干净的上传态**。
* `switchContext`：真 404 判成 `'failed'`，文案说「刚才没连上服务器…再试一次」。
  服务器好得很，是凭据对不上，重试一万次也不会成。诚实的 `'unreadable'` 成了死代码。

**为什么四道门加你们两个脚本全绿**：DEV 的 stub 仍抛 `team HTTP 404 (stub)`，正则匹配得上。
凡是跑 stub 的门都绿，只有真后端会错。

判据改走 `TransportError.status`（`transport.ts:421` 早就带着状态码，一直没人用）。
新门 `verify-404-discriminator.mjs` 刻意用真后端 + 真的对不上的 token 触发真 404；
teeth 验过——把状态码那行删掉它立刻 2 FAIL 并打印出死锚点。提交 `ccc470e`。

### 新增的门

```
.issues/feat-068-frontend-deploy/verify-zh-purity.mjs        真中文数据，v01 两面 + v02 九屏逐屏抓 innerText 捞拉丁残留
.issues/feat-068-frontend-deploy/verify-404-discriminator.mjs 真后端 + 真错 token 触发真 404
```

`verify-zh-purity` 现在的结论：**v01 两面 0 处；v02 只剩「往哪走」屏 9 处**
（demo / agent / Skills / tools / onboarding / review / skill / prompt）。
那看着是刻意的产品腔调不是漏译，我没擅自改，开 issue 交 Danny 判。

---

## 四、⚠️ 给你们的：fixB 的**前端半边没进 main**

这条我建议你们优先看，因为它意味着"15 条已修"的清单和实际不符：

```
git diff origin/main main -- src/lite2/UploadPanel.tsx   → 0 行
git diff origin/main main -- src/lite2/transport.ts      → 0 行
```

两个文件与 `origin/main` **逐字节相同**，而 `6f838f3` / `a45bb4a` 明明都改过它们
（`UploadPanel.tsx` +79 / +71，`transport.ts` +93）。合并时被丢掉了。

落进来的只有 i18n 那半边，于是变成**没有任何消费方的死键**：

```
acceptedExts / acceptedLegacyNote / fileStatusIngested / fileStatusEmpty / fileStatusFailed / fileStatusUnknown
→ 在 src/ 里（除字典本身）0 次引用
```

后果是 **S9 / S10 / S11 三条在 main 上其实没修**。最刺眼的是 S10：

```
src/lite/UploadPanel.tsx:27      const ACCEPT = '.pdf,.docx,.doc,.xlsx,.xls,.csv,.md,.markdown,.txt'
src/lite2/UploadPanel.tsx:27     同上
src/lite2/OnboardWizard.tsx:35   同上
```

文件选择器还在给客户 `.doc` / `.xls`，后端拿到直接 415。
后端半边（`parse.py` +517、`upload_guard.py` +70）倒是活着。

**这是你们的改动被合丢了，怎么补由你们定**，我没动它——不想在停工期替另一条线重写代码。

### 但 S9 那条数字，**请先别改**

你们判 S9 说「10 个文件 / 10MB 两个数字都错，真值是 15 个 / 8 MiB」。
那是**代码默认值**。线上机器显式覆盖了：

```
$ sudo docker exec avery env | grep AVERY_MAX
AVERY_MAX_UPLOAD_BYTES=10485760      # = 10 MiB
AVERY_MAX_FILES=10
```

env 名与 `guards.py:41,46` 读的完全一致（`AVERY_MAX_UPLOAD_BYTES` / `AVERY_MAX_FILES`）。
**所以生产上真值就是 10 个 / 10 MiB，我那句中文文案是对的。**
按 S9 去改反而会把对的改成错的——我差点就照着改了，是去线上核了一遍 env 才拦住。

结论：S9 要么降级成「前端硬编码了一份会和 env 漂移的副本」（这个批评成立），
要么改成「转达服务端 413 body 的人话上限」（但那个后端半边也还没上线）。

---

## 五、🔴 最要紧的一条：不追平后端的代价，比我原来写的大得多

我的验收 artifact 里写着「后端只比 main 落后两项（`/auth/*`、`decisions[]`），
建议暂时不追平」。**那句话现在过时了，我已在 artifact 里改掉。**

线上（`512b11d`）实际缺的，是四条**数据真相**级别的：

| 缺陷 | 线上表现 | 我的独立复核 |
|---|---|---|
| GB18030 静默销毁 | 中文 Windows 用 Excel 存的 CSV → 乱码 → 抽出 0 人 → 仍回 **HTTP 200 +「已读入 1 个文件」** | ✅ `512b11d:avery/ingest/parse.py` 的 `_parse_csv`/`_parse_text` 仍是 `data.decode("utf-8", errors="replace")`；main 已换成带编码梯子的 `decode_text`（`_ENC_CJK = ("gb18030","big5","shift_jis","euc_kr")`） |
| 「无法完成」读成 done | 再被判「可推进」，理由「项目自报已完成，且无风险信号」 | `_NEG` 在 main 里 12 处、`512b11d` 里 0 处 |
| 首屏谎报无风险 | 同一份 payload 明明带着 blockers | fixA 的 `registry.py` 不在线上 |
| 非 ASCII token → 500 | 真 id + 中文 token 回 500，假 id 回 404 = 零凭据枚举 oracle，破 feat-038 红线 | `512b11d:service/ingest_api.py:95` 仍是裸 `compare_digest` |

GB18030 那条尤其要命：**那就是国内 Windows + Excel 存 CSV 的默认编码**，
正好是 7-25 那批客户。

### 好消息：有一条不碰数据库的路，我验过了

迁移 0008 的牵连是**文件级**的，不是代码级：
`pg_registry.py:123` 的 `_ensure_schema()` 对 `_MIGRATIONS_DIR.glob("*.sql")` 全量执行，
而 `Dockerfile` 会 `COPY db/`——**任何 tree 里带着 0008 的镜像，都会在第一个请求时
无条件把它推进生产库**。`512b11d` 不带 0008，所以线上库至今没见过它。

但**只取 `eval-harness/` 的 diff 是可以的**，冲突全在前端：

```bash
git checkout -b backend-subset 512b11d
git diff 6f838f3^ 6f838f3 -- eval-harness/ | git apply    # GB18030 + 413 人话上限
git diff d184b6c^ d184b6c -- eval-harness/ | git apply    # /advise 错误处理路径自己崩（NameError）
# → tree 里没有 0008，数据库一个字节都不动
cd eval-harness && AVERY_BRAIN=stub python -m pytest tests/test_file_truth_encoding.py tests/test_advise_brain_config_error.py -q
# → 30 passed in 2.47s（已实跑，无 LLM 开销）
```

fixA / fixC / fixD 的 diff 依赖中间提交，单独 apply 会 skip，要补得再挑一轮。
**建不建、什么时候建，是 Danny 的闸，我没碰线上任何东西。**

---

## 六、杂项

* **`D:/avery-wt/verify` 是我的**（detached 在 `5dce4f3`，我那个合流提交），内容全在 main 里，
  已 `git worktree remove`。`D:/avery-wt/068` 同样是我的、同样已合并，也拆了。
* **`D:/avery-wt/gate` 和 `D:/avery-wt/int` 不是 git 仓库**，是残留目录。
  `gate` 里只剩 `.vite-gate-cache/` + 两个日志——但你们的 `verify-server.mjs` 的
  `root` 正指着它，所以那台还活着的 5173 进程对 `/` 返 404（不是应用坏了，是根目录被掏空了）。
  我把那个僵尸进程停了，改用同款隔离 cacheDir、`root: 'D:/avery'` 的副本跑验证。
  **`gate` / `int` 我没删**——不确定归属。
* 你们两个脚本我在合流后的树上跑过多轮，**全程 `verify-p0` 41 PASS、`verify-blockers` 15 PASS**，
  我那三条修复都没造成回归。
* `npm install` 一次都没跑（`node_modules` 是 junction，这条纪律我遵守了）。

---

## 七、给并审 session 的一句话总结

线上 = `039f1f1`（v01 裸链 + `avery-agent:zh512` 后端）。
本地 `main` = 两条线全部成果 + 我收尾的三条修复，**22 个提交没 push，一条都不在线上**。
待拍板的第一件事仍是**裸链给 v01 还是 v02**；第二件是**后端要不要追平**，
而第二件的代价已经从"两个功能缺失"变成"四条数据真相缺陷"，其中 GB18030 那条直指 7-25 的客户群。

> ### 🔴 07-19 更正 · 加粗那句是错的，而且错得很要紧（原文保留）
>
> **「22 个提交没 push，一条都不在线上」——后半句不成立。**
> feat-050..060 十一条**早就在 `039f1f1` 里**，也就是说它们**当时已经在线上跑着**，
> 只是躲在 `?v=2` 后面，客户走裸链看不到。未 push 的那 22 个提交是**对抗审查的 15 条修复
> 加收尾修复**，不是十一条功能本身。
>
> **为什么这条要紧**：它直接决定了拍板 ① 是哪种动作。按原文读，翻默认 = 「把一批从没上过线
> 的新代码放给客户」，风险等级高、该先灰度；按事实读，翻默认 = 「把一批已经部署了的代码
> 露出来」——同一份构建产物，只改一个字面量的默认值。**是后者。**
> 差一个字就会把一次低风险的暴露判成一次高风险的发布，进而拖着不敢做。
>
> **现在的事实**：`origin/main` = **`de47ffe`**（23 个提交全部已 push），线上前端就是它构建的；
> 裸链默认已翻成 v02（`7ad968b`）。**后端仍是 `avery-agent:zh512`，一行未动**——
> 拍板 ② 的子集经复核不安全（`6f838f3` 的编码梯子会把日/韩花名册静默读成编造的汉字），
> 停在边界上等 Danny。
