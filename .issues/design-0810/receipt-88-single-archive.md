# 回执 · #88「撤掉『新建一家公司』——单档案模型收口」

> 设计正源 `.issues/design-0810/design-plan.md` §5.1 + §6.3（Danny 2026-08-10 已审过）。
> 前置 #86（清空这份档案）+ #84（资料库两栏 explorer）落地时都在 main 上。
> commit `d345230` + merge `dbee74a`。🔴 **未 push、未上产。**

---

## 0 · 本轮 Danny 现拍的两条（票面上没有，都是问出来的）

### ① 名册（`knownContexts`）——「整条砍到底」

票面把这条列为「待 Danny 拍的余数」，倾向是「保留为只读的历史档案入口」。第一次问过去，
Danny 的回答是「**没太听懂。现在没有存量用户……重新衡量以后提问**」。

重新衡量之后这条**不是产品取舍，是一道算术题**，所以第二次问只剩一个选项集：

> 「切换」那个列表要 **≥2 份档案**才出现。而撤掉「新建一家公司」之后，一台电脑最多只能长出
> **1 份**（首次上传铸一份，或领示例团队铸一份，之后再传都是补进同一份）。所以那一区以后
> 谁都点不到——它是**死代码**，不是一个「留着以防万一」的入口。

Danny 拍：**整条砍到底**（屏上的区 + `KnownContextList` + store 三格 + localStorage + 12 条文案）。

🔴 **给下一个人的方法论，不是给这一票的**：第一次问之所以没问明白，是因为我把一个已经被
别的改动**证伪掉前提**的选项摆成了产品取舍。「存量用户回不去」听起来是个真代价，可它的
前提（会有 ≥2 份档案）恰恰被同一票消灭了。**摆选项之前先算一遍每个选项的前提还成不成立**。

### ② 清空 ＝ 这份档案从此归你

这条**票面完全没有**，是核实 §6.3 时发现本票**自己会造出来**的一条死胡同：

> 小王点「看看示例团队」→ 后端克隆一份一次性档案（`ephemeral`，到期被 `sweep_ephemeral` 回收）
> → 他想换成自己店里的真资料：
> ① 资料库的上传口对示例档案是**封着的**（补进去的会随回收一起没，界面明说了）；
> ② 今天他的出路就是「新建一家公司」——**正是这一票要砍的**；
> ③ 「清空这份档案」清完，`ephemeral` 标记原地不动（`pg_registry.py` 明写不碰），上传口还封着。
>
> 他做完唯一被指引去做的动作，**什么也没解开**。

Danny 拍：**清空即认领**——`empty_context` 两条腿把 `ephemeral` 清成 false。
语义上也说得通：一次性克隆之所以一次性，是因为里面装的是**我们的示例数据**；用户亲手清空
并打了确认词之后，那份档案里再没有一个字节属于示例。
先例是 `link_account_context`（绑到账号即 `ephemeral = false`，gc-demo-clones-0724）——
同一条判断「这份 context 已经归某个真人所有 → 不该被 GC 收走」的**第二个触发点**。

---

## 1 · 交付

### 前端 · 闸放在 store，不放在四个调用点上

`uploadFiles` 降级为**引导路径**：`contextId === null` 才真开火，其余委托 `appendFiles`。

```ts
uploadFiles: async (files) => {
  if (files.length === 0) return
  if (get().contextId !== null) { await get().appendFiles(files); return }
  ...
}
```

为什么闸在 store：`OnboardGate.StepUpload` 与 `HomeScreen` 首页骨架卡是**全新用户铸出档案的
那条路**（票面明令不能碰），所以它们照旧调 `uploadFiles`。真正决定方向的是「此刻有没有档案」，
那个事实只有 store 手上有。放在 UI 上就是四把尺，任何一把漂一次的代价都是**又新铸一个
context**——旧那份的 `owner_token` 服务端只返一次、已被覆盖 = 永久无人能认领。

**够得着的现场**（不是假想）：向导里传成功一次（`contextId` 落地，而向导**刻意不关**，见
`OnboardGate.tsx` 那段「不响应式读 contextId」的碑）→ 用户翻回①上传步再传一次 → 旧代码当场
开出第二家公司。

顺带修的一条：`StepUpload` 照旧只读 `ingestStatus` 的话，这一发（现在是补料）会让屏上
**从头到尾写着「已就绪」**——秒表不走、失败也不报。改成按「谁在动」选状态机，和资料库屏
`shown` 那一处**同一条规则**。🔴 判据不能写成「有没有 contextId」：引导那一发跑完的同一帧
contextId 就到手了，按它选会让「已就绪」在成功的瞬间消失、一帧都不出现。

### 前端 · 两块 UI 整条撤除

- `files-new` 区（「新建一家公司」，内含整块 `UploadPanel`）+ 左栏那一行；
- `files-switch` 区 + `SwitchSection` + `KnownContextList.tsx`（整文件删）；
- store：`knownContexts` / `switchContext` / `forgetContext` / `switchError` / `switchPending`
  / `KnownContext` / `ContextSwitchError` / `loadKnownContexts` 等五个 localStorage 助手 /
  `switchSeq`；localStorage 键 `lite2:knownContexts:v1`；
- `UploadPanel` 的 `mode` prop 撤掉，由 `contextId` 推导；`CompanyZoneIcon` 随之成死件，删。

🔴 栏底那一组改成**条件渲染**（`contextId && canEmpty`）：撤掉两行之后组里只剩「清空这份
档案」，而它要有档案才在。不条件渲染就会出现一个底下空无一物的「其他」——「标题与内容
同生共死」那条老纪律。这一改动**咬到了一道既有门**，见 §2。

### 后端 · `empty_context` 两条腿清 `ephemeral`

内存腿 `self._ephemeral_at.pop(context_id, None)`；pg 腿单独一句
`UPDATE avery.contexts SET ephemeral = false`（**刻意不塞进上面那句改 `source_files` 的
UPDATE**：它改的是**档案的身份**，不是清单内容）。**不需要迁移**——`ephemeral` 是既有顶层列。

### i18n · 手工 Edit，13 个键

`upload.againTitle` / `againBody` + `upload.switch*` 十条 + `lite2.filesUploadTitle`。
en 1061 → 1048 叶子键，zh 同步，两边 878 键零差集。孤儿数 **0 → 0**。
🔴 `scripts/i18n-zh*.mjs` 一个都没跑（只跑了只读的 `i18n-orphans.mjs`）。

`againTitle` 不能留着改用途：它的原文就是「从这里上传会新建一家公司」，而 Avery 已经不做
这件事了——留着就是一句假话（票面原话）。

---

## 2 · 门账（改判 7 道 + 退役 1 道；票面只列了 3 道）

| 门 | 票面预判 | 实收 | 处置 |
|---|---|---|---|
| `verify-context-switch` | 15 条整条报废 | ✅ 一致 | **整条退役 + 删文件 + 出 ROSTER** |
| `verify-append-story` ② | 必红 | ✅ 一致 | 「两个方向分得开」→「**只剩一个方向**」 |
| `verify-files-ia` ③ | 必红 | ✅ 一致 | 拆成 ③a（files 在 forms 前）+ ③b（new/switch 不在），17→20 |
| `verify-archive-empty` ③⑥ | 票面没列 | 🔴 **会静默变绿** | 名册两条改成「那套东西真的不在了」，36 条不变 |
| `verify-404-discriminator` | 票面没列 | 🔴 **硬红** | 「名册不动」→「**凭据不动**」 |
| `verify-data-boundary` | 票面没列 | 🔴 **约 20 条报废** | B1 全改判 / m4-3 通用化 / N1 换路径 / N2 退役 / N3 换输入，28 条 |
| `verify-files-explorer` A③ | 票面没列 | 🔴 **被我自己的改动咬红** | 取样时机搬到有档案之后 + 补两条，37→39 |
| `verify-restart-09`（未裁定） | — | 死键 | localStorage 清单里摘掉 `lite2:knownContexts:v1` |

### 值得单独说的四条

**① 票面点名的「假绿陷阱」确实存在，而且不止一处。**
票面警告 `verify-context-switch` ⑥ 的源码级判据在 `forgetContext` 被删后会**静默变绿**。
实收：`verify-archive-empty` ③⑥ 是**同一个陷阱的第二个现场**——它们写的是
`(s.knownContexts ?? []).length`，名册撤除之后前后都是 `0 === 0`，**一道全绿的门冒充
「恒 1 份档案还被守着」**。改判时读的是**原值**（`s.knownContexts === undefined ? 'absent'`）
+ localStorage 原文，`?? []` 那种兜底一律不许出现在判据里——它把「这一格没了」和
「这一格是空的」抹成同一个数。

**② 两道会红的门不在票面门账上，而且是两种不同的找法。**
`verify-404-discriminator` 靠**逐门 grep 被删符号**扫到；`verify-data-boundary` 也是 grep
扫到的，但它的规模（41 处引用、约 20 条判据）只有真读进去才看得出来。
手挑清单永远漏在「想不到的那一道」上——这一票的做法是：动手前先对
`git ls-files "*verify-*.mjs"` 全量 grep 一遍被删的**每一个符号**，把门账算完再动第一行代码。

**③ 一道门被**我自己的改动**咬红，而且票面不可能预判。**
`verify-files-explorer` A③ 量「左栏组标吃 `--ink-soft`」，它此前能在**空态**取到样，是因为
组里常驻着「新建一家公司」。那一行撤掉之后空态整组不进 DOM，判据拿到 `color: null`。
这不是「判据太严」，是**取样时机不对**：组标本来就只在有档案时存在。搬到上传之后取样，
并顺手补了两条（自证「组真的在屏上」+「空态整组不在 DOM」），37 → 39。

**④ 退役不是删掉，是把纪律搬家并写清搬去了哪。**
`verify-context-switch`（15 条）与 `verify-data-boundary` N2（6 条）测的都是已经不存在的动作。
两处都留了墓碑注释，逐条写明那条纪律今天由谁守：
「并发写不许串公司」→ `stillOn` + data-boundary N1（改成仍存在的并发路径）；
「不许拿一次 404 销毁不可再生的东西」→ 404-discriminator 的**凭据**那条 + `restoreSession`
那段碑。墓碑里还写了一句「**不要照着旧代码复活一个类似的 switchContext 场景**」——那会让门
测一个产品里不存在的动作，是假绿的另一种长法。

---

## 3 · 变异台账（10 条 · 9 红 1 活）

跑器 `_px88/mutate.py`，三条自保：锚点必须**恰好命中一次**（0 处命中长得像「变异存活」）·
打完**回读比对**证明文件真变了 · 还原走 `shutil.copy2` 字节副本（**绝不重写内容**，
重写会压平 CRLF 把全仓 diff 炸掉）。第一发就是被这三条拦下的——`self._ephemeral_at.pop(...)`
在 `registry.py` 里出现**两次**（`link_account_context` 里也有一处），锚点命中 2 次直接退出；
若照第一版那样只 `try/except` 忽略，那一轮会报「70 passed」，读起来就是**变异存活**。

| # | 变异 | 期望红 | 实收 |
|---|---|---|---|
| M1 | 内存腿 `empty_context` 不摘 `ephemeral` | 契约 + 端点 | ✅ 2 红 |
| M2 | 内存腿改成**标记**而不是摘（反向） | 「普通档案不受影响」那条 | ✅ 3 红（M1 那两条 + 专属那条） |
| M3 | store 的 `contextId` 闸整段拿掉 | data-boundary B1 | ✅ 5 红 |
| M4 | `useUploadTarget` 默认不再由 contextId 推导 | append-story ② | ❌ **存活**（见下） |
| M4b | 资料库工具条 `uploadMode` 接错线 | append-story ② | ✅ 2 红 |
| M5 | 栏底那一组无条件渲染 | files-explorer A③' 空态 | ✅ 1 红 |
| M6 | 把「新建一家公司」那一行接回左栏 | files-ia ③b + append-story ② | ✅ 3 红 |
| M7 | 404 分支顺手删掉 owner_token | 404-discriminator 凭据那条 | ✅ 1 红 |
| M8 | `knownContexts` 那一格接回 store | archive-empty ③⑥ | ✅ 2 红 |
| M9 | **pg 腿**不摘 `ephemeral` | 真库那一层 | ✅ 先证明**离线套 70 passed 全绿**，真库 2 红 |

### 🔴 M4 存活，原因写在这里而不是补一道假门

`useUploadTarget` 的**默认推导**（`explicitMode ?? (contextId === null ? 'new' : 'append')`）
把它改成恒 `'new'`，一条判据都不红。查清楚了，不是门漏：

- 资料库屏**显式传** mode（`useUploadTarget('append')` / `('new')`）——它要同时持两条状态机
  来算 `shown`，这是 `explicitMode` 唯一的合法用途。所以那一屏走不到默认分支；
- 本票之后**唯一**消费默认分支的是 `HomeScreen` 首页骨架卡，而它只在 `!team` 时渲染——
  那个状态下 `contextId` 几乎恒为 null，两种推导给出同一个答案。

也就是说：**这条推导没有独立可达的行为**，它是 M3 那道 store 闸的 belt-and-braces。
真正的锁是 store 闸（M3 五条红），推导只决定标签与状态机选谁。
「两把锁必须两道门」这条纪律在这里的诚实结论是：外层那把锁没有独立可测的后果，
**所以不给它编一道门**——编出来的门只会测一个我造出来的场景，那是假绿的另一种长法。

---

## 4 · 验证

```
后端离线套  TZ=UTC → 4135 passed · 0 failed · 139 deselected · 4 xfailed（~118s）
            = 合 main 后的基线（含 #85 的 18 条）+ 本票 3 条
真库套      throwaway avery_t88_test（docker teammaster-postgres-1，口令 dev）
            test_registry_contract + test_context_empty_t86 + test_registry_protocol
            + test_file_append_t10 + test_file_delete_t77 → 205 passed（跑完已 DROP）
电池        A 37/37 · B data-boundary 28/28 + null-owner 绿 · C 3/3
i18n        孤儿 0 → 0；en/zh 各 878 键零差集
像素        54 张，**2 张漂**（aurora/paper-files-desktop），前后 md5 整行 diff，总数 54 → 54
真机截图    _px88/after/ 12 张（空态/有档案/硬确认 × 两皮 × 桌面手机），人眼过
```

### 🔴 三次「差点被读成结论」的红

**① worktree 里的像素红是假的。** B 区 `visual-baseline` 在 worktree 里报 8 failed，
翻开日志**每一条都是** `A snapshot doesn't exist … writing actual`——**一次比对都没发生**
（基线是每 worktree 一份的 gitignore 产物）。汇总行上它和「真漂移」一模一样。
像素一律 `cd /d/avery` 在主检出跑。

**② 合完 main 之后那道红是后端没重起。** `verify-change-log`（#85 的门）报 5 红，症状是
`lineage` 投影全 null。原因是 uvicorn 不热重载，8288 上跑的还是合并**前**的后端。
按端口 `taskkill` 重起之后 41 PASS · 0 FAIL。**「改了后端却跑到旧行为」的老坑，别信 ps 信行为。**

**③ 一条间歇红，不是本票的。** 真库套整轮跑时
`test_sweep_collects_only_old_unlinked_ephemeral_clones[postgres]` 红过一次，单跑绿、
随后两轮同样的命令全绿。当场探了一下容器时钟：连采 6 次，前 5 次 delta `+0.4s`，
**第 6 次 `-114.2s`**——就是记忆里那条「Docker PG 容器时钟来回跳 ~115 秒」，
招牌症状正是「单跑绿、整轮红」，触发面是 `created_at < now()`。
判定为已知 flake（那条测试早于本票，且它自己的注释就写着这个坑），**没有掩盖，如实记在这里**。

---

## 5 · 下一个人该知道的

1. 🔴 **`i18n-orphans` 有一块暗区：注释里点过名的键永远不是孤儿。**
   它的 `bareAccessRe = /\b(\w+)\.(\w+)\b/g` 扫的是**文件原文**，注释一并算数。
   本票实收：票面预判 13 个孤儿，第一次跑只报 12——少的那个是 `upload.againTitle`，
   因为 `FileManifest.tsx` 的注释里把它当反面教材点了名。**「0 孤儿」比它看起来的要弱。**
   已在那处注释里改成不写具体键名 + 留了一行说明。

2. **像素盖不到「有档案」的资料库屏。** `visual-data.spec` 的 `SCREENS` 是
   `home / team / projects / room`，**不含 files**；`visual.spec` 的 files 四张拍的是空态。
   所以本票「有档案时栏底少了一行」这一改**没有像素覆盖**，行为覆盖在
   `verify-files-explorer` A③'。要补像素的话是往 `visual-data.spec` 的 SCREENS 里加 files，
   那会新增 4 张基线，是独立的一票。

3. **`empty_context` 现在会改 `ephemeral`。** 谁再动那个方法，记住它有**两条腿**且
   `test_registry_contract` 的 `impl` 参数化里 pg 那一遍是 `@needs_db`——离线默认电池
   deselect 它。M9 已经实测过：离线 70 passed 全绿，pg 腿的洞照样能上线。

4. **`_px88/shot.mjs` 里那条自证不是装饰。** 手机态四张 `data-*` 第一轮**全没拍到左栏**
   （收抽屉点遮罩，那一下被关闭动画吃掉，随后 `openRail()` 又把它合回去），
   而截图看起来很正常——差一点就当「人眼过了」。现在脚本自己会在拍不到栏时抛错。

---

## 6 · 环境与跑法（复现用）

```
后端: cd eval-harness && AVERY_BRAIN=mock AVERY_EXTRACTOR=heuristic AVERY_EMBEDDINGS=keyword \
      AVERY_DEMO_SEED_DIR=tests/fixtures/demo-seed AVERY_PUBLIC_BASE=http://127.0.0.1:8288 \
      AVERY_CORS_ORIGINS=http://localhost:5288,http://127.0.0.1:5288 \
      python -m uvicorn service.app:app --host 127.0.0.1 --port 8288 --app-dir .
前端: VITE_AVERY_API_BASE=http://127.0.0.1:8288 npx vite build --mode development
      npx vite preview --port 5288 --host
门:   VERIFY_BASE=http://127.0.0.1:5288 VERIFY_API=http://127.0.0.1:8288 \
      node eval-harness/tools/run-battery.mjs --only=A   （再 --only=B / --only=C）
变异: python .issues/design-0810/_px88/mutate.py apply <file> <anchor> <repl>
      python .issues/design-0810/_px88/mutate.py restore <file>
真库: docker exec teammaster-postgres-1 psql -U postgres -c "CREATE DATABASE avery_t88_test;"
      TZ=UTC AVERY_DB_URL="postgresql://postgres:dev@127.0.0.1:5432/avery_t88_test" python -m pytest ...
      🔴 口令是 dev 不是 postgres；跑完 DROP（本 session 那个已删）
像素: VERIFY_BASE=http://127.0.0.1:5288 npx playwright test -c eval-harness/visual
      🔴 `cd /d/avery` 不是装饰——worktree 里冻＝白冻，且红成「8 failed」骗人
手拍: VERIFY_BASE=http://127.0.0.1:5288 node .issues/design-0810/_px88/shot.mjs
```
