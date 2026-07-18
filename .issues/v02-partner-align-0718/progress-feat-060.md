# feat-060 · 红线补漏（`name` 字段 + `_NEG` 否定词）

分支 `feat/060-redline-holes` · 工作树 `D:\avery-wt\060` · 后端/红线 · 无依赖

状态：**done**。两个洞都补了，都带回归测试，既有测试零回归。

---

## 做了什么

### 洞 1 · `name` 字段未扫红线

`extract.py:801` 的简历路径找不到人名表头时**用文件名兜底**：

```python
name = re.sub(r"\.[a-z0-9]+$", "", doc.name).replace("_", " ").strip()
```

所以 `绩效8分.docx` 会造出一个真的叫「绩效8分」的人。红线完全没拦。

**实测（改之前，全部 ok=True、violations 为空）**：

```
name='绩效8分'            -> 0 violations
name='张三-KPI95'         -> 0 violations
name='王五(离职风险高)'    -> 0 violations
name='赵六 末位淘汰名单'   -> 0 violations
name='Bob low performer'  -> 0 violations
```

**是两个独立的 bug，不是一个**（这点很重要，只修一个补不上）：

1. `_scan_person_value` 遍历的是 `_person_text_fields()`，那张表是
   `[role, tenure, team, owns, collaboration]` —— **结构化打分数字扫描从来没看过 name**。
   所以 `张三-KPI95` 即使别的字段都填满了也照样漏（`KPI95` 是 `_ZH_SCORE_NEAR_NUM` 的形状，
   属于结构扫描的活，内容词表里没有这条规则）。
2. `validate_extraction` 的内容扫描外面套着 `if blob.strip():`，而 blob 就是拿同一张表拼的。
   一份**抽不出 role/tenure/owns 的简历** blob 是空的 → 整个内容扫描直接跳过 →
   对「名字来自文件名」的那个人，红线**一次都没跑**。

**修法**：`name` 加进 `_person_text_fields()`（放在第一位），两个扫描一起覆盖。

顺带确认了一件事：`llm_extract` 对 role/tenure/owns/collaboration 都跑 `_strip_person_ratings`，
**唯独不对 name 跑** —— 这是对的（不能偷偷改别人叫什么），也正因如此 name 只能**拦**不能洗：
遇到叫「绩效8分」的人，唯一诚实的反应是拒绝这次上传，不是把人改名叫「绩效」。

**端到端实测（改之后）**：

```
绩效8分.docx     -> people=[绩效8分]     -> ingest ok=False   (原 True)
张三-KPI95.pdf   -> people=[张三-KPI95]  -> ingest ok=False   (原 True)
陈思雨.docx      -> people=[陈思雨]      -> ingest ok=True    (对照组，干净名字照常发布)
```

### 洞 2 · `_NEG` 其余否定词

B3 当时把「别」改成了合取式（不是 X别 名词的尾巴 **且** 后面得管着一个动词），**然后就停在那儿了**。
表里其余的 cue 全是裸的，一个裸 cue 藏在正常词里就跟「别墅」一样，把后面 32 个字的人身打分闸关掉。

**改之前实测（66 词中文语料，16 个词把闸关掉了）**：

| 正常词 | 藏的 cue |
|---|---|
| 不要紧 / 这事不要紧 | 不要 |
| 不用了 / 不用功 / 不用心 | 不用 |
| 好得不得了 | 不得（不得不/不得已当年做了中和，不得了没有） |
| 不应期 | 不应 |
| 不做不错 | 不做 |
| 不可避免 / 无法避免 / 难以避免 / 避免不了 | 避免 |
| 无法拒绝 / 拒绝不了 | 拒绝 |
| 无需求分析 | 无需 |
| 宁缺勿滥 | 勿 |

同时 50 句真否定里有 6 句被误伤（未 / 莫 / 不可 / 以免 / 免得 整个不在表里）。

**修法 —— 把 B3 那个合取式推广到整张表，没有一个 cue 还是裸的。分两类，这个分类是这次修法的关键**：

- **祈使类**（不要/不用/不应/不该/不得/不做/不搞/不给 + 新增 不准/不许/不能/不可/不必/不宜/不予/不再、
  勿/莫/甭、严禁/禁止/切忌、避免/杜绝/拒绝/谢绝、以免/免得、无需/无须/毋须）：
  跟「别」同科，后面跟**任何**动词都读作「别 V」，所以用宽的 `_NEG_别_VERB` 字符类，
  外加一个**评分名词**（避免/杜绝/拒绝/禁止 本身是动词不是副词，「杜绝末位淘汰」管的是名词）。
- **非祈使类**（未 / 无 / 非）：**不能照抄**。「日期未定」「任务未分配」「报告未看」「无用功」「非常」
  都是正常话，一个泛动词不足以当证据 —— 这三个必须管着**评分动作**才算 cue。
  这就是为什么任务书里「同类洞、照着补」的说法不能直接执行：裸「未」一上来就漏「未定」「未看」。
  另外「非」还要一个 X非 前瞻黑名单（除非/是非/无非/莫非/岂非/若非/倘非 —— 这些不是否定），
  **并非/绝非 故意不在黑名单里**，所以「并非给她打分」照样抑制。

两个配套改动：

- `_NEG_AFFIRMATIVE` 扩了：`不可避免/无法避免/难以避免/无法拒绝/无法禁止` 是**否定之否定 = 肯定**。
  「无法避免绩效评分」说的是分**打了**，里面的「避免」不能当 cue。跟当年 `不得不/不得已` 同一招，
  同样是**等长替换**（`\x00`），因为「别」和「非」的前瞻要读 cue 前面那个字，一删就读错邻居。
- `_NEG_AHEAD = 10`：`_NEG_MARGIN` 的**右侧镜像**。现在每个中文 cue 尾巴上都挂着 lookahead，
  而它要管的那个词**经常就是命中点本身**（「不搞│末位淘汰名单」「杜绝│末位淘汰」「不做人的│考核评级」
  「不给她│打分」）。原来切片切到命中点就断，lookahead 读到的是被截断的文本，cue 静默失效，
  结果是**把「不要给人打分」这种建议误拒**。
  **窗口没有变宽**：lookahead 是零宽的，所以 cue **本体**仍然必须结束在命中点之前（`m.end() <= start`），
  英文 cue 一个 lookahead 都没有，行为逐字节不变。

**改之后：0 漏报 0 误报**（66 词 × 4 payload + 50 句否定）。

---

## 改了哪些文件

| 文件 | 改动 |
|---|---|
| `D:\avery-wt\060\eval-harness\avery\redline.py` | `_NEG` 整表合取化（新增 `_NEG_SCORE_NOUN` / `_NEG_PERSON_OBJ` / `_NEG_COVERB` / `_NEG_GOVERNS` / `_NEG_GOVERNS_TIGHT` / `_NEG_ZH_IMPERATIVE` / `_NEG_非_COMPOUND`）；`_NEG_AFFIRMATIVE` 扩表；新增 `_NEG_AHEAD` 并改 `_negated()` 加右侧读取余量 |
| `D:\avery-wt\060\eval-harness\avery\ingest\redline_extract.py` | `_person_text_fields()` 加 `p.name`（含为什么安全的实测记录） |
| `D:\avery-wt\060\eval-harness\tests\test_redline_holes_060.py` | 新增，376 条 |

`guards.py` 任务书里提到了，但**仓库里不存在**（`eval-harness/avery/guards.py` no such file），未改。

---

## 验收怎么过的

### 全量（硬门）

```
$ python -m pytest tests/ -q          # 在 D:\avery-wt\060\eval-harness 下
1282 passed, 61 skipped, 8 xfailed in 20.69s
```

基线（动手前，同一命令）：`906 passed, 61 skipped, 8 xfailed`。
→ **906 + 376 = 1282，既有测试零回归，8 条 strict xfail 原样保持**（没有把 xfail 转正，那是 feat-067 的事）。

任务书点名的几个文件单跑：

```
$ python -m pytest tests/test_redline.py tests/test_redline_villa_negation_b3.py \
    tests/test_redline_zh.py tests/test_notes_redline.py tests/test_hardgate_units.py \
    tests/test_cjk_identity_r3.py -q
428 passed, 3 xfailed in 2.00s
```

### 前端（本条没动前端，为诚实起见照跑）

```
$ npm run typecheck      # tsc -b — 零输出零错
$ npm run build          # ✓ built in 2.95s
```

### 新回归测试（376 条）

```
$ python -m pytest tests/test_redline_holes_060.py -q
376 passed in 1.06s
```

语料规模与成分（任务书要求「57 句量级、必须含真汉字」）：

- `_ORDINARY` 66 个正常中文词 × 4 个 payload = 264 格
- `_REAL_NEGATIONS` 50 句真否定
- `_SCORING_NAMES` 10 个、`_REAL_NAMES` 35 个（含三亚真花名册 20 人全员）
- `test_the_corpus_is_actually_chinese` 直接断言每条语料**含真汉字**，并给语料规模设了下限。
  这条不是装饰：上一波所有门都是绿的、而所有门语料是 ASCII/拼音伪装，第一份真中文文档就把它们打穿了。
  本文件里每一个失败都是**只存在于汉字里的语素边界**，拼音根本表现不出来。

### 每一处规则都做了变异证明（执行，不是写在注释里）

| 变异 | 结果 |
|---|---|
| 出厂规则 | 0 漏 0 误 |
| 祈使 cue 退回裸的 | **26** 个词漏（不要紧/不用了/好得不得了/莫名其妙/禁止吸烟…） |
| 未/无/非 退回裸的 | **35** 个词漏（未来规划/日期未定/无锡分公司/非常好…） |
| 去掉 X非 前瞻 | **5** 个词漏（除非给出方案/无非给点建议/是非对错/莫非对她有意见/岂非把人当机器） |
| 删掉祈使 cue 整类 | **11** 句真否定被误拒 |
| 删掉 未/无/非 整类 | **3** 句真否定被误拒 |
| `_NEG_AHEAD = 0` | **4** 句真否定被误拒 |
| `_NEG_AFFIRMATIVE` 退回 `不得不\|不得已` | 「无法避免绩效评分」漏 |
| `_person_text_fields` 退回旧表 | 10 个打分名字**全部**漏回去 |

**X非 前瞻差点被我删掉**：第一版语料上它测出来是 0 漏（死重量），按 B3 那句
「a conjunction nobody can justify is just complexity」本该删。补了 5 个
「X非 + 介词」形状的词（除非给出方案 / 无非给点建议 / …）之后漏了 5 个 —— 它是真有用的，
只是第一版语料没覆盖到那个形状。**这是语料不够，不是规则冗余**，留痕在测试 docstring 里。

**反过来也删了真死重量**：`_NEG_AFFIRMATIVE` 我原本写了 8 条，逐条变异测出
`避免不了` / `拒绝不了` / `不可否认` **改不动任何判定**（「不」「否」本来就不满足 `_NEG_GOVERNS`，
cue 压根不会触发），已删除，只留下测出来有用的 5 条。这三个词仍然在语料里，由 lookahead 兜着。

### 独立对抗抽查（20 句，不在语料里，事后另写）

10 句该拦的拦住 9 句、10 句该放的全放行。唯一那句漏的与本条**无关**，见下面 Notes 第 1 条。

---

## 没做什么

- **没有碰评分闸**。任务书明确交代：本条是补漏（该拦的没拦住），不是解禁。
  `AVERY_ALLOW_PERSON_SCORING` 一行没动，H6 那 2 条 strict xfail 没转正 —— 那是 feat-067 的事。
- **没有改 `redline_rules.md`**。`RULE_IDS` 没变，`test_rules_doc_in_sync` 只校验 rule id 存在；
  而且那份公开文档从头到尾**没有描述过否定抑制机制**（全文只有第 62 行提了一次 suppress），
  补进去是另一个决定，不该我顺手做。
- **没有装任何包**，没动 `package.json` / `package-lock.json` / `feature_list.json` / 根 progress / 根 handoff。
- **没有起 dev server**。

---

## Notes（顺手发现的，按规矩只记不修）

1. **中文人名不是 person anchor（漏报，与本条无关，但真会被三家公司撞上）**
   「黄志强排名倒数第一。」**漏**；同一句把名字换成「他」→ 拦住；把「非常好的季度,」去掉 → 照样漏。
   已确认与否定词无关：`_NEG.search('非常好的季度')` 为 `False`，`_negated()` 在「排名」处也是 `False`。
   根因：`_ZH_ANCHOR`（打分/评分/排名/定级…）要求 `_has_person(seg)`，而 `_PERSON_REF` 只认代词和
   职称类名词，**不认具体人名**。`_zh_name_before()` 那套「人名 + 分数」的识别**只服务分数数字那条路径**
   （`_zh_person_score_number`），没接到 `_ZH_ANCHOR` 上。
   → 花名册式文本「张三 排名倒数」「李四 评为不合格」这类**无数字、纯人名 + 排名/评级标签**会整片漏。
   建议单开一条（把 `_zh_name_before` 接进 `_ZH_ANCHOR` 的 person 判定）。我没顺手改：
   这动的是 `_ZH_ANCHOR` 的触发条件，误报风险面比本条大得多，需要自己的语料和自己的门。

2. **繁体输入下「別」不是 cue（误报方向，pre-existing）**
   实测：`别把她标成离职风险。` → pass；`別把她標成離職風險。` → **FAIL**（被误拒）。
   根因：`_ZH_TRAD` 折叠表里**没有 別→别**（也没有 無→无、絕→绝）。
   `zh_normalize('別')` 原样返回 `'別'`，所以 B3 那条 别 规则在繁体文本上整个不生效。
   这是 feat-029/B3 遗留的，不是本条引入的，方向是**误报**（noisy/visible/safe，不是漏报）。
   修法很便宜（往 `_ZH_TRAD`/`_ZH_SIMP` 各加几个字，等长 1:1），但那是共享表，
   按「不要顺手修、会造成合并冲突」的要求留给集成方或单开一条。
   ⚠️ 瑞典建筑公司如果用繁体中文，会撞上这个（表现为**误拒**，不是泄漏）。

3. **`_NEG_AFFIRMATIVE` 里的 `不得已` 是 pre-existing 死重量**
   逐条变异测下来 `不得已` 改不动任何判定（我的探针句上）。是 feat-029 留下的，我没删 ——
   本条不该动别人的既有条目，而且我的探针只有一句，不足以判死刑。记在这儿供后来人核。

---

## 给集成方的风险提示

- **合并冲突面**：`eval-harness/avery/redline.py` 的 `_NEG` 区块（约 135–250 行）改动较大。
  如果还有别的线也在动红线，这块要人工合。`redline_extract.py` 只改了一行代码（`_person_text_fields`
  的返回值）+ 一段 docstring，冲突面小。
- **跨线契约**：无。本条纯后端内部，不改任何 API、payload 字段或前端契约。
- **需要的包/凭据**：无。全部用标准库 `re`，测试全 hermetic（`ingest_docs(extractor=None)` 走默认
  `HeuristicExtractor`，不需要 key、不联网、不 flake）。
- **行为变化的对外影响**：红线变**严**了 —— 之前能发布的两类上传现在会被拒：
  (a) 人名里带评分词/评分数字的（含文件名兜底造出来的）；
  (b) 正常词误关闸之后跟着的人身打分。
  这两类本来就该拒。反方向（否定式建议被误拒）比之前**少了 6 句**。
  三家公司真上传时如果出现「整份文件被拒」，先看 `report.redline.summary()` 里的 person 名字 ——
  很可能就是文件名兜底命中的那个洞（现在是**故意**拒的）。
