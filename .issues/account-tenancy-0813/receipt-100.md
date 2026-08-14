# 回执 · #100 一家公司多个账号：同一份档案多成员共用

> 2026-08-14 · 分支 `claude/reverent-carson-06fdb1`（**未 push**）· 正源 `gh issue view 100`
> 依赖 #99：`git merge-base --is-ancestor 06f9e4c main` 与 `... 06f9e4c <本分支>` 双双 exit=0
> —— 逐条验的是祖先关系，不是「票关没关」。

---

## 0 · 一句话

形状本来就对（主键就是 `(user_id, context_id)`、零字段挂在 user 下），拦着的只有票面点名那三处。
**都改完了，两条腿同改，多成员真能用。** 但本票真正的重量不在「能用」，在两件事：

1. **它放松了一条安全边界**，所以验收是**正面**证明边界还在（§4），不是证明多人能用。
2. **迁移写法上撞到一个会打死生产的真 bug**：全量重放下，退休了一个对象**不能阻止建它的那份
   迁移下次开机再建一次**。第一版 0020 就是这么写的，一旦库里有多成员数据，0008 那句
   `CREATE UNIQUE INDEX` 直接 `UniqueViolation`、**整个 bootstrap 炸掉**。本机真库当场撞出来，
   已修 + 已立常驻门 + 已写进 README 纪律（§3）。

---

## 1 · 三个待拍项：Danny 0814 拍板

| 待拍 | 拍板 | 落地成什么 |
|---|---|---|
| 认领在已有主人时？ | **仍然拒绝，只能 admin 脚本绑** | `link_account_context(..., allow_shared=False)` 的**默认值** |
| 要不要角色（只读/可编辑）？ | **本票不做，全员平等** | 写进 0020 头注释与本回执 §7，不做暗账 |
| owner_token 认领时轮不轮换？ | **不轮换，保持现状** | 零代码（全仓本来就没有任何轮换机制，这条是「不新造」） |

第一条的理由（写进 `auth_api.account_claim` 与 0020 的头注释，免得下一个人从代码反推）：
**owner_token 是设备级凭据**，存在第一台电脑的浏览器 localStorage 里。让它当公司门票，等于谁翻到
过那台机器谁就能把自己塞进公司，而且没有一个人会收到通知。

🔴 这三条合起来定了一件关键的事：`link_account_context` 有**两个调用点需要不同的答案**
（claim 要拒、admin 要绑）。所以它拿到的是一个**关键字**参数而不是整个放开：

- `allow_shared=False`（默认）→ `/account/claim`、登录态上传路径，**行为逐字未变**，两个调用点一个字没改
- `allow_shared=True` → 全仓**唯一**一处：`scripts/ops/link-account-context.py`

---

## 2 · 改了什么（8 个文件）

| 文件 | 改动 |
|---|---|
| `db/migrations/0020_account_contexts_multi_member.sql` | **新增**。守卫式退休 0008 的 `UNIQUE(context_id)`，换成**同名**非唯一索引（为什么必须同名：§3） |
| `db/migrations/README.md` | **新增规矩 5「退休既有对象」**：一个前置陷阱 + 三道门；原规矩 5 顺延为 6 |
| `avery/ingest/pg_registry.py` | `account_owns` 改 EXISTS 直查；`account_for_context` → `accounts_for_context` 返回列表；`link_account_context` 加 `allow_shared` 并在 `contexts` 行 `FOR UPDATE` 之下判断；订正 `Ownership is 1:1` 那段注释；`_ensure_schema` 报错不再写死 `entities` |
| `avery/ingest/registry.py` | 内存腿同上三处；`_context_owner: dict[str,str]` → `_context_accounts: dict[str,list[str]]`；GC 判空从「有没有这个键」改成「键下面有没有人」；Protocol 三个签名同步 |
| `service/auth_api.py` | `account_claim` 的 docstring：为什么「已有主人 → 拒绝」现在是**产品决定**而不是库替我们做的判断 |
| `scripts/ops/link-account-context.py` | **新增**。admin 绑人，demo 阶段加第二个人的唯一路径 |
| `tests/test_registry_contract.py` | 4 条两腿契约 + 七步升级路径门 + 开机锁守卫扩到两张表 |
| `tests/test_login_isolation_10.py` | 3 条 HTTP 边界判据 + 订正一条已不成立的理由 |

### 2.1 `account_for_context` 是**换名**，不是保留

票面给了两个选项（改名返回列表 / 保留成「最早绑上的那个」）。选换名，因为全仓 `grep` 下来它
**没有任何外部调用点** —— 只被 `account_owns` 和 `link` 自己用。留着它等于留一个「问 THE owner
是谁」的函数在一个没有 THE owner 的世界里：它会继续编译、继续返回**一个**主人，这正是票面警告的
「名字对不上语义」。新的 `accounts_for_context()` 返回列表、最早绑上的在前，有真调用点
（admin 脚本的花名册 + 判据），不是死枝。

### 2.2 `account_owns` 为什么是直查 EXISTS 而不是 `user_id in accounts_for_context(cid)`

同一个答案，但问出去的问题变成了正在被判定的那个问题本身：没有列表会长大、没有顺序会影响结果，
`(user_id, context_id)` 上的主键一次定案，不用为**每一次已登录授权读**把整家公司的花名册捞出来。

### 2.3 排他性退到应用层这一半，没有含糊过去

0008 自陈那条唯一索引是「两个账号数据不串」的存储层保证。这句话**半对**，而说清哪半对是本票的
义务（已写进 0020 头注释）：

- **隔离没动，仍由存储层扛**：一个账号够得着一份档案 ⟺ 表里真有 `(user_id, context_id)` 这一行。
  这条由 `PRIMARY KEY` + `account_owns` 的存在性查询承担，**与唯一索引无关**。匿名档案（零行）
  照旧任何账号都够不着。
- **排他性真的退了**：「一份档案至多一个账号」不再是库约束。过去那条拒绝是**原子**的（并发两次
  认领不可能都赢）；Python 里 read-then-insert 在 READ COMMITTED 下**不是**原子的，两个事务各自
  的存在性检查都看不见对方未提交的行，会双双通过。所以那句判断跑在
  `SELECT ... FROM avery.contexts WHERE context_id = %s FOR UPDATE` 之下 —— 同一份档案上的认领被
  那把行锁串起来，**恢复**了原来的保证，而不是近似它。那一行本来就要被写（清 `ephemeral`），
  额外争用为零。

顺带：这把行锁让原来那个 `except ForeignKeyViolation` 变成真正到不了的死枝（不存在的档案现在是
显式的 `row is None`；存在的档案在检查与 INSERT 之间不可能被 GC 删掉，它的 DELETE 会阻塞在同一把
行锁上），所以**删掉**而不是留着当一条永远绿的空判据。

---

## 3 · 🔴 撞到的真 bug：退休一个对象，拦不住建它的那份迁移

**这一节是本票最该被下一个人读到的部分。**

第一版 0020 完全按票面写：守卫式 DROP 掉 `account_contexts_context_key`，换成一条叫
`account_contexts_context_idx` 的非唯一索引。离线全绿。一接真库，**八条 needs_db 判据连带炸掉**：

```
psycopg.errors.UniqueViolation: could not create unique index "account_contexts_context_key"
DETAIL:  Key (context_id)=(ctx_test_eb07cd64538f) is duplicated.
```

抛出点不在我的代码里，在 `_ensure_schema()` **自己**。根因是全量重放（README 规矩 1）：

```
每次开机，从 0001 跑到最后一份 ——
  0008: CREATE UNIQUE INDEX IF NOT EXISTS account_contexts_context_key   ← 名字没被占，真的重建
        一旦库里已经有两个成员的档案，这句就是 UniqueViolation，**整个 bootstrap 当场炸**
  0020: 把它再删一遍                                                     ← 已经轮不到它了
```

**一份迁移退休了一个对象，并不能阻止建它的那份迁移下次开机再建一次。** 而且它排在你前面。
后果不是「索引状态不对」，是**生产下次重启起不来**，而这在离线套里 100% 看不见。

### 3.1 修法：让 0008 那句话永久变成 no-op

实测（pg17，一次性库，先建非唯一索引 + 插两行重复值，再跑 `CREATE UNIQUE INDEX IF NOT EXISTS`）：

```
NOTICE:  relation "t_a_key" already exists, skipping
CREATE INDEX
 relname | indisunique
---------+-------------
 t_a_key | f
```

`CREATE [UNIQUE] INDEX IF NOT EXISTS` **只按名字判重** —— 名字被占就整句跳过，不比对唯一性、
不比对列、表里真有重复行也照样跳过且不报错。所以 0020 的替换索引**沿用原名**
`account_contexts_context_key`，0008 从此永远跳过。

代价写在 0020 头注释里，不藏：`_key` 后缀按 Postgres 约定意味着唯一，而这条索引**不唯一**，
名字会撒谎。这是增量纪律的赎金 —— 想改名就必须回改 0008，而回改旧迁移会让所有既有库上那条
UNIQUE 索引永远没人删。

### 3.2 立成纪律，不只是修掉

- **README 新增规矩 5**，把这条前置陷阱放在三道门**之前**（因为它比三道门先咬人），并给出可用手法。
- **常驻门第 8 步**：升级路径跑完后再重放两轮，钉死索引不会变回唯一、bootstrap 不炸。
- 这一步**单独验过可达**，不是被第 5 步挡住的死枝：把第 5 步临时放行后重跑，第 8 步如实抛出
  `UniqueViolation: could not create unique index`。第 5 步与第 8 步逮的是**不同量级**的故障
  （索引状态不对 vs 整个 bootstrap 炸掉），两条都留。

### 3.3 为什么没改 0008（连注释也没改）

票面红字要求不改 0008，同名解法正好让这条要求**零代价**成立。但 0008 头注释里那句
`a context has AT MOST ONE owner account, enforced by the UNIQUE index on context_id below`
**自 0020 起为假**。约定已写进 README 规矩 5：退休理由与现状一律写在退休它的那一份里，读到旧
迁移里描述约束的句子，先查后面有没有哪一份提到它。

⚠ **这条我留了个口子给 Danny 拍**：一条自陈安全保证、而那条保证已经不成立的注释，留在原地是有
成本的。最小修法是在 0008 里加**一行**指针（`-- SUPERSEDED BY 0020`），零 DDL 改动、不影响任何
既有库。我按票面红字没做。要做的话说一声，一行的事。

---

## 4 · 边界：证明多人能用是不够的

那条唯一索引今天是「两个账号数据不串」的存储层保证之一。**一个放松了边界的改动只交出「新功能
能跑」，等于用它换掉了「旧保证还成立」。** 所以四条全是边界判据，多人能用只是副产品。

| 票面要求 | 判据 | 落在哪 |
|---|---|---|
| 绑了的两人各自读都 200 且数据逐字相同 | `test_two_members_read_the_same_context_byte_for_byte` | 比 `resp.content` **逐字节**，不是「都 200」 |
| 没绑的第三个账号 404 且与「id 不存在」逐字相同 | `test_a_third_account_gets_the_same_404_as_an_id_that_does_not_exist` | 状态码 + content-type + **抹掉回显 id 后的整个正文** |
| 匿名 context 任何账号都够不着 | `test_an_anonymous_context_is_reachable_by_no_account` | 三个账号全 404，配 owner_token 能读到的对照基准 |
| 对照基准：迁移前插第二个 owner 真被库拒 | `test_upgrade_path_...` 第 3 步 | **裸 `psycopg.connect`**，落在存储层 |

### 4.1 「逐字节」不是仪式

- **两成员那条**：一个按 user 分叉的读路径（谁绑的谁看得见、后加的看见一半）照样**每次都 200**。
  只有逐字节比对能把它逼出来。#100 的产品承诺是「文件、数据属于同一家公司」，不是「都能打开」。
- **第三方 404 那条**：只比 `detail` 字符串太松，它只看得见一个字段，看不见「其中一条多带了个
  hint 字段」这类泄露。直接比 `.content` 又永远不等（两条 404 各自回显自己被问到的 id）。所以
  把 id 抹成占位符，**剩下的整个正文**必须一模一样 —— 这才是「无存在性 oracle」的完整说法。
- **匿名那条**：先证明这份档案拿 owner_token **真的读得到**（200），否则「三个账号都 404」在一个
  压根不存在的 id 上恒真，整条判据是空真的摆设。

### 4.2 对照基准为什么必须走裸连

registry 上**每一个**公开方法都先调 `_ensure_schema()`。拿它去验对照组 = 让自愈式迁移当场把自己
的对照组治好，「旧世界 vs 新世界」变成「新世界 vs 新世界」，那条门会永远绿着而什么也没验。
第 3 步因此全程 `psycopg.connect` 裸连，一个 registry 方法都不碰。这条也写进了 README 规矩 5。

---

## 5 · 门与变异

### 5.1 升级路径七步（+ 第 8 步），跑在**一次性库**上

`test_upgrade_path_from_the_single_owner_schema`（`@needs_db`，常驻）。为什么不能跑在共享的本机库
上：这条测试要**造回旧世界的唯一索引**，而同一轮里还有几十条 needs_db 判据在用同一张
`account_contexts`。中途任何一处 assert 挂掉，那条唯一索引就留在原地，后面每一条绑第二个成员的
判据全部连坐变红 —— **一条测试有能力污染整轮，它报的红就不再是自己的证据**。一次性库
（`CREATE DATABASE` → 跑 → `DROP DATABASE ... WITH (FORCE)`）把这个可能性从结构上去掉。

### 5.2 开机锁守卫：从 `entities` 参数化扩到 `account_contexts`

`test_steady_state_bootstrap_takes_no_entities_lock` → `test_steady_state_bootstrap_takes_no_table_lock[entities|account_contexts]`。
**扩既有那条而不是另立一条兄弟测试**是有意的：不变式是「稳态开机不锁任何热表」，一表一份拷贝
正是下一张热表被漏掉的方式。`account_contexts` 现在够格：它是**每一次已登录授权读**都要查的表，
而 0020 的 `DROP INDEX` 是全仓最重的那种语句。

### 5.3 变异：五条，逐条验过

| 变异 | 打中 | 旁证 |
|---|---|---|
| MUT1 `account_owns` 退回单主人语义 | `test_two_members_read_the_same_context_byte_for_byte` | 其余 7 条绿 —— 无交叉 |
| MUT2 `allow_shared` 失效（人人可加入） | `test_B_cannot_steal_...` + `test_a_second_account_cannot_steal_...`（两个文件） | 其余 37 条绿 |
| MUT3 匿名档案对任何登录账号可读 | `test_an_anonymous_context_is_reachable_by_no_account` | 其余 7 条绿 |
| MUT4 替换索引改回 `_idx`（§3 那个真 bug） | 升级路径第 5 步 | 见下 |
| MUT5 守卫换成裸 `DROP INDEX IF EXISTS` | 锁门 `[account_contexts]` 红、`[entities]` **绿** | 新增那条真有牙 |

🔴 **MUT4 单独追了一步**：它红在第 5 步，不是我为它加的第 8 步 —— 「一条变异红一条判据 ≠ 它也
能红旁边那条」。所以把第 5 步临时放行重跑，确认第 8 步**可达**且逮到的是更严重那一幕：
`_ensure_schema()` 自己抛 `UniqueViolation: could not create unique index`，**整个 bootstrap 炸掉**，
而不只是「索引状态不对」。第 8 步不是死枝。

### 5.4 GC：多行版 + 对照基准

`test_sweep_keeps_a_clone_that_has_several_members`。pg 侧那条 `NOT EXISTS` 多行照样成立 ——
但那是**读代码论证**，而本票恰恰改了这张表能有几行。真正会坏的是内存腿：它原来写的是
`cid not in self._context_owner`（一个 1:1 字典），换成 `dict[str, list[str]]` 之后判空必须从
「有没有这个键」改成「**键下面有没有人**」，否则一次被拒绝的 link 留下的空列表会让一份**无人
认领**的克隆永久免疫 GC。对照基准：同一次 sweep 里那个没绑人的克隆**真的被收走**（`== 1`），
否则「两成员的克隆还在」在一个什么都没删的 sweep 上恒真。

### 5.5 admin 脚本：真跑过，不是写完就算

`scripts/ops/link-account-context.py` 对着本机真库跑了五个场景：`--list` 空档案 → 绑创始成员 →
**绑第二个成员**（本票要的那一步）→ 幂等重绑 → 不存在的档案（拒绝，exit=1）。
脚本自己也带对照基准：绑完真去读一遍新库状态，确认「只多了这一个人、且没动别人」，不是报个
「成功」就完事。

选 Python 而不是跟 `create-account.mjs` 同族的 `.mjs`：「谁能进这家公司」这条规则只该有**一份**
实现。脚本调的就是服务端自己那个 `link_account_context(..., allow_shared=True)` —— 同一个函数、
同一把行锁、同一套 `_ensure_schema`，被 §5.1/§5.3 的门直接盖住。用 Node 重写一遍 SQL 会造出第二
份规则，而两份规则迟早分叉。（`create-account.mjs` 是 `.mjs`，因为它调的是 Supabase auth admin
API，本来就在服务端代码之外。）

---

## 6 · 验收

| 项 | 结果 |
|---|---|
| 离线全套 | **4272 passed / 0 failed**，4 xfailed（main 4265 → **+7**，完全加法） |
| 离线增量对账 | main 收集 4269 → 本分支 4276，**+7 全是本票新增**，逐条 set-diff 验过、**零删除** |
| 全仓 `-m needs_db`（**不按文件挑**，#95 那块碑） | **152 passed / 0 failed**（main 146 → **+6**） |
| needs_db 那 +6 逐条对上 | pg 腿 4 条契约（`impl[postgres]`）+ 升级路径 1 条 + 锁门参数化多出的 `[account_contexts]` 那一臂 |
| `./init.sh` | **exit=0**，0 errors（6 条 lint warning 是存量：本票 `.ts/.tsx/.js/.css` 改动数 = **0**） |
| push | **未 push**（分支 `claude/reverent-carson-06fdb1`） |

### 6.1 中途 main 往前走了，已合进来

开工时 main 在 `1c12e3d`；干活期间另一条线把 feat-105/#103 与 #96 离线半边合进了 main
（`b54e196`）。**先按 1c12e3d 收集出来的基线对不上账**（差 47 条：`test_openai_provider_96.py`
40 条 + `test_decision_grading.py` 7 条），查清楚是新 main 带进来的、与本票无关之后：

- 确认**迁移号没撞车**（新 main 仍停在 0018，0020 是空的）
- 确认新 main 对 `pg_registry.py` / `registry.py` 的改动**全是注释**（docstring + 注释块），与账号缝
  相隔很远、语义零重叠
- 把 main 合进本分支（merge `9afcc88`，无冲突），上表所有数字都是**合并后**跑的

⚠ 顺带记一条给下一个人：`D:\avery` 会被并发线换分支/往前推。拿它当基线之前先
`git branch --show-current` + `git log -1`，别信开工时那份快照。

### 6.3 🔴 迁移号撞车：本票原本是 0019，改成了 0020

**两条未合并的分支会同时抢下一个迁移号，而 `ls db/migrations/` 看不见这件事。**

本票先写成 `0019_account_contexts_multi_member.sql`；写 progress.md 收账时才发现 **#98（avery 全表
开 RLS，deny-all，已验完、在等 Danny 点头、未合）在它自己的分支上早就占了 0019**
（`claude/inspiring-chaum-48a5ee` / `d5c1812` / `0019_enable_rls.sql`）。旁证：`0002` 头注释那句
"found while writing 0019" 指的正是它，不是本票。

本票让号，改成 **0020**。理由：#98 已经验完，号写进了它自己的回执与判据，动它等于让我去改一份
我复验不了的东西；本票新鲜，改号几分钟就能重验（已重跑，见上表）。#98 若最终不合，0019 留个
空号 —— 排序重放下空号无害。

**教训**：`ls db/migrations/` 只告诉你**已合并**的号。开新迁移前应当
`git log --all --diff-filter=A --name-only -- 'eval-harness/db/migrations/*'` 扫一遍**所有分支**，
包括那些「验完了在等人点头」的。这条已随本回执记下，没改成硬门（值不值得立门归 Danny）。

### 6.2 半夜假红那条不适用

`decision_grading` 那条 00:00–08:00 的假红已由 feat-105 修好并**已在 main 上**（本次合并带进来了）。
本轮跑在 11:17–11:40 本地时间，不在那个窗口内；无论如何 4272/0 里没有它。

---

## 7 · 边界与没做的事（写明，不留暗账）

### 7.1 本票明确不做（票面 §6 + Danny 0814）

- **角色（只读 / 可编辑）**：绑进来的成员权限**完全相同** —— 都能改卡、删文件、清空整份档案。
  三个人的公司里这是对的。这条写进了 0020 头注释与本节，不是疏漏。
- **邀请同事的产品流程**：没有自助加入入口。加人只走 admin 脚本。`/account/claim` 那条路被
  `test_B_cannot_steal_...` 钉死在 404。
- **实时协同**：看到同事的改动靠刷新。
- **owner_token 轮换**：不新造（全仓本来就没有任何轮换机制）。

### 7.2 留给 Danny 拍的一条（§3.3）

0008 头注释里那句自陈的安全保证自 0020 起为假。按票面红字**没改 0008**，理由与约定写进了
README 规矩 5。最小修法是一行 `-- SUPERSEDED BY 0020` 指针，零 DDL 改动、不影响任何既有库。
要做说一声。

### 7.3 顺手记下、**本票没动**的两条

1. **内存腿 `link_account_context` 不检查档案是否存在**，pg 腿检查（原来靠 FK，现在靠显式
   `row is None`）。这是**先于本票**就存在的分歧：内存腿可以绑一个 `get()` 返回 None 的 id，
   于是 `/account/contexts` 会回一个幽灵 id，pg 腿不可能。没跟着本票改是因为它与成员语义正交，
   而改它会动到一批与本票无关的既有判据。**记在这里，不是没看见。**
2. **GC 与 link 的老竞态**（`sweep` 的 `DELETE` 可能撞上正在 link 的档案）先于本票存在，代码里
   本来就以 belt-and-suspenders 注明（`NOT EXISTS` 守卫 + `ephemeral` 标各一道）。本票新加的
   `FOR UPDATE` 让这个窗口**变窄**，没有变宽。票面说 GC 不用动，确实不用动。

---

## 8 · 下一个人最该知道的三句

1. **退休一个数据库对象，先想「建它的那句话下次开机会发生什么」**，别只想「我这句话干了什么」。
   全量重放下它排在你前面，而它会赢。（§3，README 规矩 5）
2. **放松边界的票，验收要正面证明边界还在。** 「多人能用」和「外人进不来」是两件事，只交前者
   等于用新功能换掉了旧保证。（§4）
3. **对照基准别用会自愈的那条路去验。** registry 的每个公开方法都先 `_ensure_schema()`，拿它验
   迁移前的世界，等于让迁移把自己的对照组治好。（§4.2）
