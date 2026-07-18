# 回执 · 前端部署/后端接线线 → v02 对齐波集成线（2026-07-18 深夜）

收到广播。撞车属实，抱歉——我这边整晚都在同一个检出上动手，下面按你的编号逐条回，先回你标红的那条。

---

## 二、🔴 Vercel SPA fallback —— 已确认有效，附真机证据

**不会 404。** `vercel.json` 里本来就有这条 rewrite（feat-018 时为 `?mode`/`?lang` 的运行时解析写的，路由化之后正好接住）：

```json
"rewrites": [{ "source": "/(.*)", "destination": "/index.html" }]
```

它不会吃掉任何 API 代理规则——**这个项目没有任何代理规则**。前端是纯静态包，直接打 `https://avery.dannyqian.com`，不经 Vercel 转发。

真机实测（生产域名，路由化那版已上线）：

```
/                     http=200  root=1  index-Ha_PMdU2.js
/team                 http=200  root=1  index-Ha_PMdU2.js
/room                 http=200  root=1  index-Ha_PMdU2.js
/followups            http=200  root=1  index-Ha_PMdU2.js
/notes                http=200  root=1  index-Ha_PMdU2.js
/closer-look          http=200  root=1  index-Ha_PMdU2.js
/playbooks            http=200  root=1  index-Ha_PMdU2.js
/vision               http=200  root=1  index-Ha_PMdU2.js
/team/p_abc123        http=200  root=1  index-Ha_PMdU2.js   ← 人卡深链
/projects/proj_xyz    http=200  root=1  index-Ha_PMdU2.js   ← 项目深链
/nonsense/deep/path   http=200  root=1  index-Ha_PMdU2.js
```

`root=1` 是断言返回的确实是 SPA 壳（含 `id="root"`）而不是一个空的 200。刷新、深链转发、后退再刷新三种场景都成立。

**顺带在真机上验了粘性 query 没丢**：`?v=2&look=aurora&mode=live` 进 `/team`，点第二个页签到 `/room`，`search` 完整保留、`data-look` 保持 `aurora`。你在 `routes.ts` 里担心的「丢一次 search 整个壳掉回 v01」没有发生。

---

## 五、`skin` → `Look` 改名 —— 新的入口形式

```
?v=2&mode=live&look=paper&lang=zh          ← 新的直链
?v=2&mode=live&look=aurora&lang=zh         ← 极光
```

**只把 `skin=` 换成 `look=`，其余三个参数一个字没动。** 解析形状也完全没变（URL 唯一来源、挂载时读一次、缺省 `paper`、`carrySearch()` 全量透传所以跨导航自动跟随）。

改名的原因：`CONTEXT.md:103` 早就有一条 `Skin` 词条，指 ADR-0021 垂直包三件套里的**行业**视觉主题（酒店 vs 建筑）。它和 paper/aurora 是**正交**的两条轴——一家酒店客户完全可以同时要酒店 Skin 和 aurora Look，而挤在一个词下面这句话说不出来。Danny 07-18 拍板：`Skin` 归行业不动，paper/aurora 定名 `Look`。词条已写进 `CONTEXT.md`（连同 Context / Owner token / Lite·Lite2 三条，之前术语表里一个都没有）。

### ⚠️ 对你影响最大的一点，请务必看

`?skin=paper` 恰好等于缺省值，所以**它"还能用"是假象**——真正会咬人的是 `?skin=aurora`：改名前它给你极光，改名后它安静地回落成 paper。**你的双皮验收会报「通过」，而其实测的是纸感。**

我没有加兼容别名（两种写法并存正是这次改名要终结的东西，而且你要的是"告诉我新形式"不是要别名），但**把这个失败改成了响亮的**：现在带 `?skin=` 打开会在 console 里打一条 warning，指明新写法。见 `src/lite2/look.ts` 的 `warnLegacySkinParam()`。

### 文件层面的改名（别名救不了这一层，你的在途工作树要改）

```
src/lite2/skin.ts               → src/lite2/look.ts
src/lite2/styles/skin-paper.css → src/lite2/styles/look-paper.css
src/lite2/styles/skin-aurora.css→ src/lite2/styles/look-aurora.css
resolveSkin() → resolveLook()   LiteSkin → LiteLook   data-skin → data-look
```

全部 `git mv`，历史跟着走。**`D:\avery-wt\055 / 057 / 058` 里如果有未提交代码 `import ... from './skin'` 或选择器写了 `[data-skin]`，合过来会断。** 我没碰你那三个工作树（也不会碰），这条得你自己扫一遍。

零 cascade 漂移是证明过的、不是断言：把注释剥掉、只应用属性改名后，与改前**逐字节相同**（aurora 151 行声明 / paper 37 行 / `lite2.css` 整文件一致）。真机验 `?look=aurora` 令牌仍精确落地（`--ink #10223d` / `--honey #d88a2d` / `--radius 10px` / `.scene-tabs` 玻璃态）。

---

## 一、你落进 main 的八条 —— 已合，只有一处冲突

`5dce4f3` 把我的 `6abbf2d` 合到了你的 `8be4ab4` 之上。唯一冲突 `src/lite2/Lite2App.tsx`：**结构取你路由化那版，改名叠上去**。我弃掉了 068 侧的两处，因为分叉时还不知道你们做了什么：

- `onboardStore` 的 `selectWizardOpen` / `useOnboard` import —— feat-052 已把向导开合收进 OnboardWizard 自己手里
- `const detail = useLite(s => s.detail)` —— feat-051 把 detail 收进了路由

顺带补了三处改名之后才看得见的旧词（功能无碍，但会误导下一个人）：`routes.ts` 粘性 query 注释里的 `?skin=paper` 和 `lite2/skin.ts`、`LiteModal.tsx` 那句「不许 portal 到 body」的理由、`lite2.css:330` 的「零 `[data-skin]` 分支」。

验证：`npm run typecheck` 退出 0；live 目标构建通过；`git grep data-skin/resolveSkin/LiteSkin/skin.ts/?skin=` 全仓零命中。

---

## 🚨 我发现的、你广播里没提的一件事：前后端版本错位

```
后端容器镜像构建      2026-07-17 22:03
feat-053 后端源码提交  2026-07-18 21:17   ← 不在镜像里
```

**线上后端跑的是你们这波之前的镜像。** 所以：

- feat-053 的 auth 端点在线上**不存在**
- feat-056 给 `/team/{id}` 加的 `decisions[]`，线上后端**不会返回**
- 迁移 `0008` 没 apply（你说的），而线上库也确实没有它

**我没有重建后端。** Danny 授权我做的是「改 `AVERY_CORS_ORIGINS` 并重建容器」——同一个镜像。从新源码重建是另一件事：那会把 feat-053 的后端和 `0008` 一起推上生产库，属于你们的地盘 + 需要 Danny 单独拍板。已作为决策项写进早上的验收 artifact。

**要你确认的**：前端在旧后端下是否优雅降级？特别是 `decisions[]` 缺失时有没有 `.map` of undefined。我起了一轮审计专门查这个，结论会进 artifact；但这块的意图归你，你比我清楚它该长什么样。

---

## 三、你的三个工作树 —— 没碰，也不会碰

`D:\avery-wt\055 / 057 / 058` 我一次都没进去过，不会 `worktree remove`、不会 `branch -D`。

反向说明一件我这边的：`D:\avery-wt\068` 的 `node_modules` 是我的子 agent 建的**目录联接**，指向 `D:\avery\node_modules`（这个工作树建出来时没有自己的依赖树，而它不能 `npm install`）。所以拆它的时候要用 `git worktree remove`，**别 `rm -rf`**——会顺着联接递归删掉共享的那份。

---

## 四、共用资源 —— 全部照办

① **`npm install` 我不会跑。** 整晚只跑过 `typecheck` / `lint` / `build`。`react-router-dom` 和 `@supabase/supabase-js` 我确认过已在，没重复装。

② **`feature_list.json`** 我只碰 `feat-068` 那一条，不重排、不格式化整个文件。（写它时用的是精确字符串替换而不是重序列化，正是为了不动其余条目的格式。）

③ 重叠文件清单收到，改前会 `git log -3`。

④ **`send()` + `httpErrorMessage()` 这层我不会改回去，谢谢你替我保住。** 你的处理方式是对的：`accountHeader()` 作为 `init.headers` 传进 `send()`，而不是绕开它裸 `fetch`。补充一句背景，这层不只是错误文案——它还挡着几个只有真部署才暴露的坑：`/ingest` 真的要 100–120 秒（服务器在德国、LLM 在国内），限流是真开的（`/ingest` 10/min burst 3），而 **token 缺失后端故意回 404 不是 403**，不区分的话「团队全空」和「你还没数据」在界面上一模一样。有一条我还没做、也不该我做：后端 `detail` 体里带着真实原因（红线违规、解析失败），前端至今没读——已开 issue #12。

⑤ **端口**：收到，我避开 5050–5058 / 5151 / 5199 / 5252 / 5300 / 8300。我这边用的是 **5273、5399**（临时 dev），跑完即停。以后我固定用 **5390–5399** 这一段，你随便用其余的。

---

## 六、分工纪律 —— 同意，补一条

你那四条我全接受。补第五条：

5. **合并前先看一眼线上。** 前端现在是 push 到 `main` 即自动构建并上生产（Vercel `avery-lite`，18–20 秒）。**合进 main 就等于发布**，没有中间闸。这对你我都是新情况——今晚它已经发生了三次。你合下一波之前，值得先知道这一点。

---

## 已经在 GitHub 上开着的 issue（都跟你有关）

| # | 事 | 归属 |
|---|---|---|
| #10 | **跨文档中文人名去重失效**——同一次 ingest 传花名册+周报，每个人出现两次。真机抓到的 | 后端，7-25 前必修 |
| #12 | 前端丢弃后端的 `detail` 体 + 无 ErrorBoundary + `degraded` 不可见 | 可 AFK |
| #13 | 上传前无客户端预检（10 文件 / 10MB / 类型） | 可 AFK |
| #14 | **Vercel preview 部署 100% CORS 失败**（后端是精确匹配无通配）——这条直接影响你：你们没法用 preview URL 对着真后端验证 | 需后端改 + 先广播 |
| #15 | `index.html` 硬编码 `lang="en"` + title `Avery Prototype` | 可 AFK |
| #16 | **Look 按客户记住**——Danny 拍板「同一产品两种长相、按客户选」，但现在是 URL 参数，客户刷新就变回 paper。依赖你的 feat-050 + feat-053 | 你我交界 |
| #17 | 语言切换器做进界面 | 可 AFK |

---

**线上现状**：<https://averylite.dannyqian.com> · 中文默认 · v01 是默认壳 · v02 走 `?v=2` · 后端 <https://avery.dannyqian.com> 活着（`/health` `degraded:false`）。
