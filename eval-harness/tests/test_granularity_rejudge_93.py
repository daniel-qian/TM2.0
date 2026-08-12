# -*- coding: utf-8 -*-
"""issue #93 — 补传后全档案重跑粒度闸：三道锁 + 裁决落库 + 删除路的解释语义。

WHAT #92 LEFT OPEN, in one sentence. R5-duty-column made the DUTY-COLUMN failure batch-order
independent because it judges a document against itself. R1/R3/R4 do not: they read the
cross-document evidence pool, so a candidate in file A that is a milestone row of file B is folded
when both files share a batch and KEPT when they arrive one at a time. That is the residual half
of the production 18-vs-11, and it is what this file holds down.

WHAT IS BEING GUARDED, and why each guard exists rather than "the gate now re-runs":

  * THE INVARIANT, with a CONTROL BASELINE. 「同一份语料，一次全选 vs 逐份补传，经理看到的项目卡
    相等」. Written as 「7 张 → 4 张」 — the same one-by-one run measured with the re-judgment
    disabled and enabled — because a shrink assertion with no before-number is vacuous by
    construction (progress.md 0808: 销毁/收缩类判据必须配一条动作之前的对照基准).
  * LOCK ① IN TWO PIECES, TESTED THROUGH TWO DIFFERENT DOORS. `parent_kind` (which namespace the
    parent name lives in) and pool membership (is that parent actually a visible card) are two
    separate refusals in `rejudge.py`, and they are tested separately ON PURPOSE — two checks
    guarding one door make each immune to mutation, so each one here gets a corpus that ONLY it
    can refuse.
  * LOCK ② FAIL-CLOSED, PROVEN NON-VACUOUS. Every abandonment case is built on a corpus that WOULD
    have folded — otherwise "nothing was folded" is true for the wrong reason.
  * LOCK ③ REVERSIBILITY, as a real round trip: fold → invisible → clear the field → back, with
    every reading intact.
  * 裁决落库. `ExtractionResult.granularity` used to vanish on a real-DB round trip
    (`pg_registry` said so in a comment). A fold whose explanation dies at the next restart is a
    card that disappeared for no reason — worse than the phantom cards this module exists to fold.
  * DELETE-PATH SEMANTICS. `file_delete` sweeps rulings by `doc_key_of(evidence)`; #93 gives that
    sweep a consequence — the fold it explained is undone, so no card is ever left folded and
    unexplainable.
"""
from __future__ import annotations

import json
from pathlib import Path

import pytest

from avery.brain import BrainResponse
from avery.ingest import LLMExtractor, ingest_paths
from avery.ingest.extract import PersonEntity, ProjectEntity
from avery.ingest.file_append import append_paths_to_context
from avery.ingest.file_delete import delete_document_from_context
from avery.ingest.granularity import Ruling
from avery.ingest.parse import parse_file
from avery.ingest.registry import ContextRegistry, SourceDocument
from avery.ingest import rejudge as rejudge_mod


@pytest.fixture(autouse=True)
def _offline(monkeypatch):
    """三件套缺一真烧钱（AGENTS.md「后端全离线配置」）。LLM 形状的用例走 scripted brain，
    不出网；这里的 env 守的是任何一步意外落回 env 路由时仍然离线。"""
    monkeypatch.setenv("AVERY_EMBEDDINGS", "keyword")
    monkeypatch.setenv("AVERY_BRAIN", "mock")
    monkeypatch.setenv("AVERY_EXTRACTOR", "heuristic")
    monkeypatch.delenv("AVERY_ALLOW_PERSON_SCORING", raising=False)
    monkeypatch.delenv("AVERY_EMBED_DIM", raising=False)


# ═════════════════════════════════════════════════════════════════════════════════════════════════
# THE CORPUS — the partner's three-file shape, arranged so the CROSS-FILE overlap is the thing
# under test (#92's corpus deliberately arranged its one overlap so both modes agreed anyway).
#
#   人员架构.csv  13 people / 12 duty cells — R5 folds these document-locally in EVERY mode, so
#                 they are the control that #92's fix still holds while #93 changes the rest.
#   项目台账.csv  6 genuinely tracked projects (owner + progress + deadline).
#   本周周报.md   ONE project whose 「里程碑：」 list names THREE of the ledger's six projects.
#                 All-at-once the gate folds those three (R1); one-at-a-time it cannot see them.
# ═════════════════════════════════════════════════════════════════════════════════════════════════

ROSTER_FILE = "人员架构.csv"
LEDGER_FILE = "项目台账.csv"
WEEKLY_FILE = "本周周报.md"

ROSTER_CSV = "\n".join([
    "姓名,职位,部门,当前负责事项",
    "王慧,总经理,管理层,统筹全店运营与旺季排班",
    "李国栋,前厅经理,前厅部,大堂接待流程优化",
    "张小芸,客房主管,客房部,客房翻新验收对接",
    "赵敏,市场经理,市场部,秋季营销物料筹备",
    "陈立,销售顾问,销售部,别墅看房动线设计",
    "周婷,人事专员,人事部,新员工入职培训安排",
    "吴晓东,采购主管,采购部,旺季食材供应商比价",
    "郑阳,工程主管,工程部,亲子园设备巡检项目跟进",
    "冯洁,餐饮主管,餐饮部,婚宴菜单季度更新",
    "许安,前台领班,前厅部,场地布置",
    "何静,客服专员,客服部,客户回访话术整理",
    "杨帆,保安队长,安保部,停车场改造对接",
    "苏茜,财务专员,财务部,",
])

LEDGER_CSV = "\n".join([
    "项目名称,负责人,进度,截止日期",
    "宴会厅翻新,李国栋,60,2026-09-30",
    "亲子乐园二期,张小芸,35,2026-10-15",
    "别墅套餐推广,陈立,50,2026-09-15",
    "会员体系升级,何静,20,2026-11-01",
    "停车场改造,杨帆,10,2026-12-01",
    "物料采购,赵敏,45,2026-09-20",
])

# 三条里程碑行**逐字**是台账里三个项目的名字。这就是跨文件的那一刀：台账单独上传时，
# 这三张卡是六个「文档单独跟进、给了负责人/进度/截止日期」的正经项目（R0-tracked）；
# 周报到场之后，同一份语料自己说了它们是「秋季营销冲刺」的检查点。
WEEKLY_MD = "\n".join([
    "# 本周周报",
    "项目：秋季营销冲刺",
    "负责人：赵敏",
    "进度：40%",
    "里程碑：",
    "别墅套餐推广 — 进行中",
    "会员体系升级 — 未开始",
    "物料采购 — 已完成",
    "阻碍项：物料供应商未确认",
])

ROSTER_NAMES = ["王慧", "李国栋", "张小芸", "赵敏", "陈立", "周婷", "吴晓东",
                "郑阳", "冯洁", "许安", "何静", "杨帆", "苏茜"]
ROSTER_DUTIES = ["统筹全店运营与旺季排班", "大堂接待流程优化", "客房翻新验收对接",
                 "秋季营销物料筹备", "别墅看房动线设计", "新员工入职培训安排",
                 "旺季食材供应商比价", "亲子园设备巡检项目跟进", "婚宴菜单季度更新",
                 "场地布置", "客户回访话术整理", "停车场改造对接"]
LEDGER_ROWS = [("宴会厅翻新", "李国栋", 60, "2026-09-30"),
               ("亲子乐园二期", "张小芸", 35, "2026-10-15"),
               ("别墅套餐推广", "陈立", 50, "2026-09-15"),
               ("会员体系升级", "何静", 20, "2026-11-01"),
               ("停车场改造", "杨帆", 10, "2026-12-01"),
               ("物料采购", "赵敏", 45, "2026-09-20")]
# 周报的里程碑清单点名的那三个台账项目 —— 全选时被 R1 折走的正是它们。
NESTED = ["别墅套餐推广", "会员体系升级", "物料采购"]
# 经理最后该看到的：台账里没被点名的三个 + 周报那一个。
SURVIVORS = sorted([t for t, *_ in LEDGER_ROWS if t not in NESTED] + ["秋季营销冲刺"])

PAYLOADS = {
    ROSTER_FILE: {
        "people": [{"name": n, "role": "员工", "line": i + 2} for i, n in enumerate(ROSTER_NAMES)],
        "projects": [{"title": d, "ownerName": ROSTER_NAMES[i], "line": i + 2}
                     for i, d in enumerate(ROSTER_DUTIES)],
        "signals": [],
    },
    LEDGER_FILE: {
        "people": [{"name": owner, "role": "负责人", "line": i + 2}
                   for i, (_, owner, _, _) in enumerate(LEDGER_ROWS)],
        "projects": [{"title": t, "ownerName": owner, "progress": prog, "dueDate": due,
                      "line": i + 2}
                     for i, (t, owner, prog, due) in enumerate(LEDGER_ROWS)],
        "signals": [],
    },
    WEEKLY_FILE: {
        "people": [{"name": "赵敏", "role": "市场经理", "line": 3}],
        "projects": [{"title": "秋季营销冲刺", "ownerName": "赵敏", "progress": 40, "line": 2}],
        "signals": [],
    },
}

CORPUS = {ROSTER_FILE: ROSTER_CSV, LEDGER_FILE: LEDGER_CSV, WEEKLY_FILE: WEEKLY_MD}
UPLOAD_ORDER = [ROSTER_FILE, LEDGER_FILE, WEEKLY_FILE]
BATCH_AT = ["2026-08-12T09:00:00+00:00", "2026-08-12T09:05:00+00:00", "2026-08-12T09:10:00+00:00"]


class CorpusBrain:
    """Scripted brain keyed by DOCUMENT (extract_docs fans documents out concurrently, so an
    order-cycled fake would be racy) — the #92 pattern, same reason."""
    name = "scripted-corpus"

    def respond(self, system, conversation, tools):
        user = conversation[0]["content"][0]["text"]
        doc_name = user.split("Document: ", 1)[1].split(" (kind hint", 1)[0].strip()
        return BrainResponse(text=json.dumps(PAYLOADS[doc_name]))


def _llm_extractor() -> LLMExtractor:
    return LLMExtractor(CorpusBrain(), retry_backoff_s=0)


def _write_corpus(tmp: Path) -> dict[str, Path]:
    tmp.mkdir(parents=True, exist_ok=True)
    out = {}
    for name, text in CORPUS.items():
        p = tmp / name
        p.write_text(text, encoding="utf-8")
        out[name] = p
    return out


def _sd(path: Path, uploaded_at: str) -> SourceDocument:
    return SourceDocument(filename=path.name, source_key=path.name, mime="text/plain",
                          size_bytes=path.stat().st_size, content=path.read_bytes(),
                          uploaded_at=uploaded_at)


def _ingest_all_at_once(tmp: Path, order: list[str] | None = None):
    reg = ContextRegistry()
    files = _write_corpus(tmp)
    paths = [files[n] for n in (order or UPLOAD_ORDER)]
    rep = ingest_paths([str(p) for p in paths], registry=reg, work_dir=tmp / "mem",
                       context_id="ctx_all", name="度假酒店", owner_token="tok93_all",
                       extractor=_llm_extractor(),
                       source_documents=[_sd(p, BATCH_AT[0]) for p in paths])
    assert rep.ok, f"all-at-once seed failed: {rep.parse_errors}"
    return reg, reg.get("ctx_all")


def _ingest_one_by_one(tmp: Path, order: list[str] | None = None):
    """First file through /ingest, the rest through the REAL append path — production's shape."""
    reg = ContextRegistry()
    files = _write_corpus(tmp)
    first, *rest = (order or UPLOAD_ORDER)
    rep = ingest_paths([str(files[first])], registry=reg, work_dir=tmp / "mem",
                       context_id="ctx_one", name="度假酒店", owner_token="tok93_one",
                       extractor=_llm_extractor(),
                       source_documents=[_sd(files[first], BATCH_AT[0])])
    assert rep.ok, f"first single-file batch failed: {rep.parse_errors}"
    reports = []
    for i, name in enumerate(rest, start=1):
        rep = append_paths_to_context(reg, "ctx_one", [str(files[name])],
                                      [_sd(files[name], BATCH_AT[i])],
                                      extractor=_llm_extractor())
        assert rep.ok, f"append batch {name} failed: {rep.parse_errors}"
        reports.append(rep)
    return reg, reg.get("ctx_one"), reports


def _visible(ctx) -> list[str]:
    """经理屏幕上那张表 —— 投影层，不是 `extraction.projects` 那张原始列表。

    🔴 判据落在投影上是**故意**的，不是图省事：抽取路对降级候选是丢弃、补传路是折叠，
    所以两条路跑完原始列表本来就不等长（折叠留壳）。不变式说的是「经理看到的一样」。
    """
    return sorted(c["title"] for c in ctx.project_cards())


# ═════════════════════════════════════════════════════════════════════════════════════════════════
# THE INVARIANT + ITS CONTROL BASELINE
# ═════════════════════════════════════════════════════════════════════════════════════════════════

def test_the_corpus_really_nests_three_ledger_projects(tmp_path):
    """前提钉子：这份语料的跨文件重合是真的存在的。

    整份判据链都建立在「周报的里程碑清单逐字点名了台账里三个项目」上。哪天有人改宽了
    `_milestones_in` 的收尾条件、或者把 `—` 换成别的分隔符，这条前提会先红——否则下面每一条
    「折叠了三张」都会退化成「本来就没有可折的」的空真。
    """
    from avery.ingest.granularity import build_milestone_index, _key
    files = _write_corpus(tmp_path)
    index = build_milestone_index([parse_file(files[WEEKLY_FILE])])
    for title in NESTED:
        assert _key(title) in index, f"周报没把「{title}」列进里程碑清单：{sorted(index)}"
        assert index[_key(title)][0] == "秋季营销冲刺"
    for title, *_ in LEDGER_ROWS:
        if title not in NESTED:
            assert _key(title) not in index, f"「{title}」不该在里程碑清单里"


def test_all_at_once_equals_one_by_one_with_the_control_baseline(tmp_path, monkeypatch):
    """THE INVARIANT，带对照基准：**7 张 → 4 张**。

    同一份语料、同一个上传顺序，逐份补传跑两遍：
      · 关掉全档案重跑（monkeypatch 成一个什么都不做的桩）—— 经理看到 7 张卡；
      · 打开 —— 4 张，与一次全选**逐字**相等。
    没有前面那个 7，「折叠后是 4」对着一份本来就只有 4 张卡的档案照样绿。
    """
    _, ctx_all = _ingest_all_at_once(tmp_path / "all")

    # 对照基准：把重跑桩掉（返回一份「没跑」的空回执），逐份补传就是 #93 之前的行为。
    monkeypatch.setattr(rejudge_mod, "rejudge_archive",
                        lambda reg, ctx, ready=None: rejudge_mod.RejudgeReport(reason="disabled"))
    _, ctx_before, _ = _ingest_one_by_one(tmp_path / "before")
    before = _visible(ctx_before)
    monkeypatch.undo()

    _, ctx_after, reports = _ingest_one_by_one(tmp_path / "after")
    after = _visible(ctx_after)

    assert len(before) == 7, f"对照基准的形状变了（预期 7 张）：{before}"
    assert len(after) == 4, f"重跑之后应当剩 4 张：{after}"
    assert after == _visible(ctx_all) == SURVIVORS
    # 而且差的正是被点名的那三张，不是随便三张
    assert sorted(set(before) - set(after)) == sorted(NESTED)
    # 人一个都不能少（折叠只动项目轴）
    assert len(ctx_after.extraction.people) == len(ctx_all.extraction.people) == 13
    # 折叠发生在最后那一趟（周报到场才判得出来），并且回执里写着 7 → 4
    last = reports[-1].rejudge
    assert last is not None and last.ran is True
    assert last.active_before == 7 and last.active_after == 4
    assert sorted(f.title for f in last.folded) == sorted(NESTED)
    assert {f.parent_title for f in last.folded} == {"秋季营销冲刺"}


def test_the_invariant_holds_in_reverse_upload_order_too(tmp_path):
    """顺序不能影响结论：周报**先**到（那一趟档案里还没有台账），台账最后到。

    这个方向考的是另一半：折叠不是「新文件里的卡被老文件折走」，是**存量卡**被新文件带来的
    证据折走 —— 反过来则是新卡一进门就撞上存量的里程碑清单。两个方向都必须落到同一张表。
    """
    order = [WEEKLY_FILE, ROSTER_FILE, LEDGER_FILE]
    _, ctx_all = _ingest_all_at_once(tmp_path / "all", order)
    _, ctx_one, _ = _ingest_one_by_one(tmp_path / "one", order)
    assert _visible(ctx_one) == _visible(ctx_all) == SURVIVORS


def test_r5_duty_cells_stay_folded_in_every_mode(tmp_path):
    """#92 的成果不能被 #93 弄丢：12 个职责格在两种模式下都不上项目轴。

    ⚠ 这一条也是本文件的**非空真**保险：如果哪天重跑闸把职责格又放回来了，上面那些
    「4 张」会同时变，但先红的应该是这一条，它说得出到底丢的是哪一族。
    """
    _, ctx_all = _ingest_all_at_once(tmp_path / "all")
    _, ctx_one, _ = _ingest_one_by_one(tmp_path / "one")
    for ctx in (ctx_all, ctx_one):
        on_screen = set(_visible(ctx))
        assert not (set(ROSTER_DUTIES) & on_screen), sorted(set(ROSTER_DUTIES) & on_screen)


# ═════════════════════════════════════════════════════════════════════════════════════════════════
# 分批夹具 —— 前两批（花名册 + 台账）落地后停下来，让用例在第三批（周报）之前动手脚。
# 折叠**只可能**发生在第三批（周报是唯一带里程碑清单的文件），所以「第三批之前」正是每一把锁
# 的观察窗口，而「第三批之后折了几张」是它们共同的判据。
# ═════════════════════════════════════════════════════════════════════════════════════════════════

def _two_batches(tmp: Path):
    """花名册 → 台账。回 (reg, ctx, files)；此刻可见 7 张卡（6 台账 + 0，周报还没到）。"""
    reg = ContextRegistry()
    files = _write_corpus(tmp)
    rep = ingest_paths([str(files[ROSTER_FILE])], registry=reg, work_dir=tmp / "mem",
                       context_id="ctx_two", name="度假酒店", owner_token="tok93_two",
                       extractor=_llm_extractor(),
                       source_documents=[_sd(files[ROSTER_FILE], BATCH_AT[0])])
    assert rep.ok
    rep = append_paths_to_context(reg, "ctx_two", [str(files[LEDGER_FILE])],
                                  [_sd(files[LEDGER_FILE], BATCH_AT[1])],
                                  extractor=_llm_extractor())
    assert rep.ok
    ctx = reg.get("ctx_two")
    assert len(_visible(ctx)) == 6, _visible(ctx)
    return reg, ctx, files


def _append_weekly(reg, files):
    rep = append_paths_to_context(reg, "ctx_two", [str(files[WEEKLY_FILE])],
                                  [_sd(files[WEEKLY_FILE], BATCH_AT[2])],
                                  extractor=_llm_extractor())
    assert rep.ok, rep.parse_errors
    return rep


def _card(ctx, title: str):
    return next(pr for pr in ctx.extraction.projects if pr.title == title)


def _srcdoc(ctx, key: str):
    return next(sd for sd in ctx.source_documents if (sd.source_key or sd.filename) == key)


def test_the_two_batch_fixture_folds_three_when_nothing_is_tampered_with(tmp_path):
    """夹具自身的非空真钉子：什么都不动的时候，第三批折三张、6 → 3 可见。

    下面每一条锁的用例都断言「一张都没折」。少了这一条，那些断言对着一个**本来就折不动**的
    夹具会全部绿——正是「空真」那一族的假绿。
    """
    reg, _, files = _two_batches(tmp_path)
    rep = _append_weekly(reg, files)
    assert rep.rejudge.ran is True
    assert sorted(f.title for f in rep.rejudge.folded) == sorted(NESTED)
    assert rep.rejudge.active_before == 7 and rep.rejudge.active_after == 4
    assert len(_visible(reg.get("ctx_two"))) == 4


# ── 锁①-a：parent 的命名空间（`parent_kind`）─────────────────────────────────────────────────────

def test_a_rule_with_no_parent_never_fires_even_with_a_reachable_pool_slot(tmp_path):
    """R4-document-not-project 没有 parent —— 一开火就是纯删除，所以禁开火。

    🔴 这条用例特意塞了一张**无标题哨兵卡**。理由是变异可观测性：`_title_key("") == ""`，
    所以哨兵卡在母卡池里占着 `""` 这一格。把 `parent_kind != "project"` 那道锁拆掉之后，
    R4 的空 parent 会**恰好**在池里查到这张哨兵，于是文件卡被折进一张无标题卡里——
    没有哨兵的话，两把锁会一起拒绝它，拆掉任何一把都不会红（progress.md 0808：
    两把锁挂同一扇门，各自都变异不掉）。哨兵把这扇门劈成了两扇。
    """
    reg, ctx, files = _two_batches(tmp_path)
    # 一份「文档就是它自己」的文件：标题即文件名，一个跟踪字段都没有 → R4。
    minutes = tmp_path / "晨会纪要.md"
    minutes.write_text("# 晨会纪要\n今天大家聊了聊旺季排班。\n", encoding="utf-8")
    ctx.source_documents.append(SourceDocument(
        filename=minutes.name, source_key=minutes.name, mime="text/markdown",
        size_bytes=minutes.stat().st_size, content=minutes.read_bytes(),
        uploaded_at=BATCH_AT[1]))
    ghost = ProjectEntity(id="pr-ghost", title="晨会纪要", source="晨会纪要.md:1")
    ghost.lineage = {"docs": ["晨会纪要.md"], "fields": {}}
    sentinel = ProjectEntity(id="pr-sentinel", title="", source="")
    ctx.extraction.projects.extend([ghost, sentinel])

    rep = _append_weekly(reg, files)
    r = rep.rejudge
    assert r.ran is True
    refused = {x["title"]: x for x in r.refused}
    assert "晨会纪要" in refused, r.refused
    assert refused["晨会纪要"]["rule"] == "R4-document-not-project"
    assert refused["晨会纪要"]["parent_kind"] == ""
    assert ghost.folded_into == "" and sentinel.folded_into == ""
    assert "晨会纪要" in _visible(reg.get("ctx_two"))
    # 而这一趟**该折的还是折了** —— 拒绝的是那一张，不是整个重判罢工
    assert sorted(f.title for f in r.folded) == sorted(NESTED)


def test_a_duty_cell_is_never_folded_into_a_project_that_shares_the_persons_name(tmp_path):
    """R5 的 parent 是一个**人**。把人名拿到项目列表里查，遇上同名项目就会把职责格折进
    一个毫不相干的项目，而折叠理由（「写在 XXX 名下那一行的职责栏里」）读起来完全站得住。

    语料就是这家公司真有一个叫「许安」的项目（度假酒店给项目起人名不是奇事——「许安套餐」
    这种命名一路简写就是它）。锁①-a 之外的每一道门都会放它过去：`parent` 非空，
    `_title_key("许安")` 在母卡池里**查得到**。
    """
    reg, ctx, files = _two_batches(tmp_path)
    # 把两个职责格重新喂成候选卡（前两批里它们已经被 R5 在抽取路硬删了）。**两个**是必须的：
    # R5 的触发算术要求同一份文档里至少两张行对齐的候选（`_R5_MIN_HITS`）——一次巧合不算规律。
    duties = [
        ProjectEntity(id="pr-duty-a", title="场地布置", ownerName="许安",
                      source=f"{ROSTER_FILE}:11"),
        ProjectEntity(id="pr-duty-b", title="客户回访话术整理", ownerName="何静",
                      source=f"{ROSTER_FILE}:12"),
    ]
    for d in duties:
        d.lineage = {"docs": [ROSTER_FILE], "fields": {}}
    # 这家公司真有一个叫「许安」的项目（度假酒店拿人名给项目起名不是奇事，「许安套餐」一路
    # 简写就是它）。锁①-a 之外的每一道门都会放它过去：`parent` 非空，`_title_key("许安")`
    # 在母卡池里**查得到**。
    namesake = ProjectEntity(id="pr-namesake", title="许安", ownerName="王慧",
                             source=f"{LEDGER_FILE}:2")
    namesake.lineage = {"docs": [LEDGER_FILE], "fields": {}}
    ctx.extraction.projects.extend(duties + [namesake])

    rep = _append_weekly(reg, files)
    r = rep.rejudge
    refused = {x["title"]: x for x in r.refused}
    assert "场地布置" in refused, r.refused
    assert refused["场地布置"]["rule"] == "R5-duty-column"
    assert refused["场地布置"]["parent"] == "许安"
    assert refused["场地布置"]["parent_kind"] == "person"
    assert all(d.folded_into == "" for d in duties) and namesake.folded_into == ""
    assert sorted(f.title for f in r.folded) == sorted(NESTED)


# ── 锁①-b：parent 的在场性（母卡池查得到）────────────────────────────────────────────────────────

def test_a_fold_is_refused_when_the_parent_card_is_not_on_screen(tmp_path):
    """母项目被经理**归档**了 —— 折过去等于把读数搬进一个他看不见的抽屉。

    这一条与上面两条走的是**另一扇门**：`parent_kind` 是 "project"、parent 名字也非空，
    唯一不成立的是「这个 parent 现在还在经理眼前」。
    """
    reg, ctx, files = _two_batches(tmp_path)
    rep = _append_weekly(reg, files)
    assert len(rep.rejudge.folded) == 3          # 先确认这份夹具本来折得动

    # 撤销这一轮的折叠，把母卡归档，再补一次同一份周报的证据 —— 这一次该拒绝
    ctx = reg.get("ctx_two")
    for pr in ctx.extraction.projects:
        pr.folded_into = ""
    ctx.extraction.granularity[:] = []
    _card(ctx, "秋季营销冲刺").archived = True
    r = rejudge_mod.rejudge_archive(reg, ctx, {})
    assert r.ran is True
    refused = {x["title"]: x for x in r.refused}
    assert sorted(refused) == sorted(NESTED), r.refused
    for title in NESTED:
        assert refused[title]["rule"] == "R1-milestone-section"
        assert refused[title]["parent_kind"] == "project"
        assert refused[title]["why"] == "存量卡里找不到这个 parent"
    assert r.folded == []
    assert sorted(set(_visible(ctx)) & set(NESTED)) == sorted(NESTED)


def test_a_fold_is_refused_when_the_parent_exists_only_inside_the_document(tmp_path):
    """闸是对着**文档**判的：它认得出「秋季营销冲刺」是三条里程碑的母项目，哪怕这个母项目
    从来没被抽成过一张卡（抽取器漏了它、或者那一批红线不过）。没有卡就没有地方并读数。"""
    reg, ctx, files = _two_batches(tmp_path)
    rep = _append_weekly(reg, files)
    assert len(rep.rejudge.folded) == 3

    ctx = reg.get("ctx_two")
    for pr in ctx.extraction.projects:
        pr.folded_into = ""
    ctx.extraction.granularity[:] = []
    ctx.extraction.projects[:] = [pr for pr in ctx.extraction.projects
                                  if pr.title != "秋季营销冲刺"]
    r = rejudge_mod.rejudge_archive(reg, ctx, {})
    assert r.ran is True and r.folded == []
    assert {x["why"] for x in r.refused} == {"存量卡里找不到这个 parent"}
    assert sorted(set(_visible(ctx)) & set(NESTED)) == sorted(NESTED)


# ── 锁②：血缘完整性前置断言（fail closed）────────────────────────────────────────────────────────
#
# 每一条都建在**折得动**的夹具上（`test_the_two_batch_fixture_folds_three_when_nothing_is_tampered_with`
# 是它的钉子），所以「一张都没折」是真的被拦住了，不是没得折。

def test_bytes_that_cannot_be_pulled_back_abandon_the_whole_rejudgement(tmp_path):
    """存量行的 content 是 NULL（0017 backfill 之前铸的那一族）—— 我们不知道自己少看了什么，
    所以**整个重判放弃**，退回今天的行为，回执把原因写出来。

    这是三道锁里唯一一条「宁可什么都不做」的：折叠的每一条理由都是对着**全档案**说的，
    档案缺一块，理由就不再是它自称的那句话。
    """
    reg, ctx, files = _two_batches(tmp_path)
    _srcdoc(ctx, LEDGER_FILE).content = None      # 字节拉不回来

    rep = _append_weekly(reg, files)
    r = rep.rejudge
    assert r.ran is False
    assert LEDGER_FILE in r.reason and "字节" in r.reason, r.reason
    assert r.folded == []
    assert r.active_before == r.active_after == 7
    assert len(_visible(reg.get("ctx_two"))) == 7
    assert not any(pr.folded_into for pr in ctx.extraction.projects)


def test_a_corrupt_source_document_abandons_the_whole_rejudgement(tmp_path):
    """来源文档在档案里、字节也拉得回来，但**解析不了**（一份坏掉的 xlsx）。同一把锁。

    语料是真的坏字节走真的 `parse_bytes`，不是把解析器桩掉：这条分支要证明的是
    「解析器说不行的时候本模块怎么做」，而解析器说不行必须由它自己说。
    """
    reg, ctx, files = _two_batches(tmp_path)
    ctx.source_documents.append(SourceDocument(
        filename="台账附件.xlsx", source_key="台账附件.xlsx",
        mime="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        size_bytes=64, content=b"this is not a workbook" * 8, uploaded_at=BATCH_AT[1]))
    # 让它成为**待判卡的来源文档**——否则它只是档案里一份没人引用的坏文件，按设计不该 fail closed
    _card(ctx, "物料采购").lineage["docs"].append("台账附件.xlsx")

    rep = _append_weekly(reg, files)
    r = rep.rejudge
    assert r.ran is False
    assert "台账附件.xlsx" in r.reason and "解析" in r.reason, r.reason
    assert r.folded == [] and len(_visible(reg.get("ctx_two"))) == 7


def test_an_unreferenced_corrupt_document_only_shrinks_the_evidence_pool(tmp_path):
    """同一份坏文件，**没有任何待判卡引用它** —— 这一次不 fail closed。

    证据池变小对本模块是安全方向（R1 少几条里程碑、R3 少几个候选母项目、R4 少几个文档身份，
    三条规则全部因此更少开火）。把它也升级成「整个放弃」，等于让档案里任何一份坏文件永久
    静默地关掉这条防线。记账、继续跑。
    """
    reg, ctx, files = _two_batches(tmp_path)
    ctx.source_documents.append(SourceDocument(
        filename="旧扫描件.pdf", source_key="旧扫描件.pdf", mime="application/pdf",
        size_bytes=32, content=b"definitely not a pdf", uploaded_at=BATCH_AT[1]))

    rep = _append_weekly(reg, files)
    r = rep.rejudge
    assert r.ran is True
    assert r.docs_unrebuilt == ["旧扫描件.pdf"]
    assert sorted(f.title for f in r.folded) == sorted(NESTED)


def test_a_card_whose_source_document_was_deleted_is_skipped_not_fatal(tmp_path):
    """来源文档被 #77 删掉了 —— 这**不是**锁② 的三种成因（那三种是存储完整性坏了），
    是经理自己删的，#77 已经按「诚实的降级」结过案。

    处置落在**那张卡**身上（判不了，不折），不升级成整趟放弃：否则一次删除就永久地、
    静默地关掉了这条防线，而「静默」正是本票存在的理由。
    """
    reg, ctx, files = _two_batches(tmp_path)
    ctx.source_documents[:] = [sd for sd in ctx.source_documents
                               if (sd.source_key or sd.filename) != LEDGER_FILE]

    rep = _append_weekly(reg, files)
    r = rep.rejudge
    assert r.ran is True and r.reason == ""
    assert r.skipped_missing_docs == 6, r
    assert r.judged == 1                     # 只剩周报那一张判得了
    assert r.folded == [] and len(_visible(reg.get("ctx_two"))) == 7


def test_a_card_with_no_lineage_is_skipped_while_its_neighbours_still_fold(tmp_path):
    """血缘为空的卡（手编卡 / #87 之前的存量卡）判不了 —— 它自己不折，**不连累旁边的**。

    对照写法：三张本该折的卡，抹掉其中一张的血缘 → 折 2 张、跳 1 张，被跳的那张还在屏幕上。
    只断言「跳了一张」而不断言「另外两张照折」，就分不清是这条规则生效了还是整趟罢工了。
    """
    reg, ctx, files = _two_batches(tmp_path)
    _card(ctx, "物料采购").lineage = {}

    rep = _append_weekly(reg, files)
    r = rep.rejudge
    assert r.ran is True
    assert r.skipped_no_lineage == 1
    assert sorted(f.title for f in r.folded) == sorted(["别墅套餐推广", "会员体系升级"])
    assert "物料采购" in _visible(reg.get("ctx_two"))


def test_a_card_the_manager_edited_is_never_folded_away(tmp_path):
    """经理亲手改过的卡，系统不收走 —— 票面之外的一条收紧，理由写在 `_manually_touched` 上。

    对照写法与「血缘为空」那条同一个形状：三张本该折的卡，给其中一张盖上手编戳 →
    折 2 张、跳 1 张，被跳的那张还在屏幕上，且**它的手编值一个字没变**。
    """
    reg, ctx, files = _two_batches(tmp_path)
    edited = _card(ctx, "会员体系升级")
    edited.summary = "经理自己写的一句话"
    edited.provenance = {"summary": {"origin": "manual", "source": "手动编辑",
                                     "updated_at": BATCH_AT[1]}}

    rep = _append_weekly(reg, files)
    r = rep.rejudge
    assert r.ran is True
    assert r.skipped_manual == 1
    assert sorted(f.title for f in r.folded) == sorted(["别墅套餐推广", "物料采购"])
    ctx = reg.get("ctx_two")
    assert "会员体系升级" in _visible(ctx)
    assert _card(ctx, "会员体系升级").summary == "经理自己写的一句话"


def test_a_manual_edit_on_some_other_card_does_not_shield_its_neighbours(tmp_path):
    """反面：手编戳是**逐卡**的，不是「这家公司从此不折」。

    没有这一条，把 `_manually_touched` 写成「只要有任何一张卡被手编过就整趟不折」也会绿 ——
    那是一个安静得多、也坏得多的实现。
    """
    reg, ctx, files = _two_batches(tmp_path)
    other = _card(ctx, "宴会厅翻新")            # 不在里程碑清单里的那三张之一
    other.provenance = {"summary": {"origin": "manual", "source": "手动编辑"}}

    rep = _append_weekly(reg, files)
    assert rep.rejudge.skipped_manual == 1
    assert sorted(f.title for f in rep.rejudge.folded) == sorted(NESTED)


# ── 折叠不连锁：母卡池只收「判完还是项目」的卡 ───────────────────────────────────────────────────
#
# 变异实证的产物（M15 第一轮存活，查下去是**语料喂不到**这条性质，不是门有洞）：上面那份
# 三件套语料里三条降级的 parent 全指向同一张活卡，所以「母卡池要不要排除本轮的降级对象」
# 这件事根本没有实例。哨兵语料在这里 —— 一条真正的链：乙 是 甲 的里程碑，甲 又是 丙 的里程碑。

CHAIN_LEDGER = "\n".join([
    "项目名称,负责人,进度,截止日期",
    "甲工程,李国栋,60,2026-09-30",
    "乙工程,张小芸,35,2026-10-15",
])
CHAIN_W1 = "\n".join(["# 一号周报", "项目：甲工程", "负责人：李国栋", "里程碑：", "乙工程 — 进行中"])
CHAIN_W2 = "\n".join(["# 二号周报", "项目：丙工程", "负责人：赵敏", "里程碑：", "甲工程 — 未开始"])
CHAIN = {"链台账.csv": CHAIN_LEDGER, "一号周报.md": CHAIN_W1, "二号周报.md": CHAIN_W2}


def _chain_ctx(tmp_path):
    """手搭一份「链」形状的档案：三份真文件（真字节，走真 parse）+ 三张卡。

    刻意手搭而不是走两批补传：要造出的是「同一轮里 A 的 parent 恰好也在被降级」这个瞬间，
    而任何一种真实上传顺序都会让其中一条先落地、下一轮就不再是同一轮了。
    """
    reg = ContextRegistry()
    seed = tmp_path / "链台账.csv"
    seed.parent.mkdir(parents=True, exist_ok=True)
    for name, text in CHAIN.items():
        (tmp_path / name).write_text(text, encoding="utf-8")
    assert ingest_paths([str(seed)], registry=reg, work_dir=tmp_path / "mem",
                        context_id="ctx_chain", name="度假酒店", owner_token="tok93chain",
                        source_documents=[_sd(seed, BATCH_AT[0])]).ok
    ctx = reg.get("ctx_chain")
    for name in ["一号周报.md", "二号周报.md"]:
        p = tmp_path / name
        ctx.source_documents.append(SourceDocument(
            filename=name, source_key=name, mime="text/markdown",
            size_bytes=p.stat().st_size, content=p.read_bytes(), uploaded_at=BATCH_AT[1]))
    cards = []
    for i, (title, doc, line) in enumerate([("甲工程", "链台账.csv", 2),
                                            ("乙工程", "链台账.csv", 3),
                                            ("丙工程", "二号周报.md", 2)]):
        pr = ProjectEntity(id=f"pr-chain-{i}", title=title, ownerName="李国栋",
                           source=f"{doc}:{line}")
        pr.lineage = {"docs": [doc], "fields": {}}
        cards.append(pr)
    ctx.extraction.projects[:] = cards
    return reg, ctx


def test_a_card_is_never_folded_into_a_card_that_is_itself_being_folded(tmp_path):
    """乙→甲、甲→丙 在同一轮里判出来。甲 自己都要被收走，就不能当乙的落脚点。

    对照基准 **3 张 → 2 张**：折的是甲（它的 parent 丙 判完还是项目），乙被**拒绝**并留在
    屏幕上。少了这道闸，读数会落进一张同一刻正在变得不可见的卡里，而链上每一环的理由
    都是对着折叠**之前**那份快照说的 —— 「并进了甲」这句话在它写下的那一刻就已经不成立了。
    """
    reg, ctx = _chain_ctx(tmp_path)
    assert len(_visible(ctx)) == 3

    r = rejudge_mod.rejudge_archive(reg, ctx, {})
    assert r.ran is True
    assert r.active_before == 3 and r.active_after == 2
    assert [f.title for f in r.folded] == ["甲工程"]
    assert [f.parent_title for f in r.folded] == ["丙工程"]
    refused = {x["title"]: x for x in r.refused}
    assert "乙工程" in refused, r.refused
    assert refused["乙工程"]["parent"] == "甲工程"
    assert refused["乙工程"]["why"] == "存量卡里找不到这个 parent"
    assert sorted(_visible(ctx)) == sorted(["乙工程", "丙工程"])
    # 而且没有任何一张卡指向一张被折叠的卡（链不成立）
    folded_ids = {pr.id for pr in ctx.extraction.projects if pr.folded_into}
    assert not any(pr.folded_into in folded_ids for pr in ctx.extraction.projects)


def test_the_fold_record_carries_the_card_id_not_just_its_title(tmp_path):
    """回执里那条 `FoldRecord` 也要带卡 id。

    变异实证的第二个产物（M10 第一轮存活，因为一条判据都没读过这一格）：同名卡是这个仓库
    真发生过的事（`_disambiguate_project_ids` 就是为它写的），只按标题记账的回执在两张同名卡
    之间无法自证说的是哪一张。
    """
    reg, _, files = _two_batches(tmp_path)
    rep = _append_weekly(reg, files)
    ctx = reg.get("ctx_two")
    by_title = {pr.title: pr for pr in ctx.extraction.projects}
    for f in rep.rejudge.folded:
        assert f.subject_id == by_title[f.title].id
        assert f.parent_id == by_title[f.parent_title].id


# ── 锁③：软折叠可逆 ──────────────────────────────────────────────────────────────────────────────

def test_a_folded_card_is_invisible_reversible_and_keeps_every_reading(tmp_path):
    """折叠是**投影层**的事：卡还在、读数一格没少、清掉那一格就回来。

    这一条同时钉住 `folded_into` 与 `archived` **不是**一回事：被折叠的卡不会出现在归档抽屉里
    （那是经理的领域），所以两个标记在 UI 上永远分得开。
    """
    reg, _, files = _two_batches(tmp_path)
    _append_weekly(reg, files)
    ctx = reg.get("ctx_two")

    parent = _card(ctx, "秋季营销冲刺")
    child = _card(ctx, "物料采购")
    assert child.folded_into == parent.id
    assert child in ctx.extraction.projects                    # 一行都没删
    assert "物料采购" not in _visible(ctx)                      # 但经理看不见了
    assert "物料采购" not in [c["title"] for c in ctx.archived_project_cards()]
    assert child.progress == 45 and child.dueDate == "2026-09-20" and child.ownerName == "赵敏"
    assert parent.folded_into == "" and parent.progress == 40   # 母卡 keep-first，没被顶掉

    child.folded_into = ""                                      # 可逆
    assert "物料采购" in _visible(ctx)
    assert [c for c in ctx.project_cards() if c["title"] == "物料采购"][0]["progress"] == 45


def test_the_parent_absorbs_the_folded_cards_readings(tmp_path):
    """折叠不是丢弃：被折那张卡的读数走 `_absorb_project` 并进母卡（母卡空着的格子才填）。

    钉住的是「并过去了」这件事本身 —— 周报那张卡自己没有截止日期，折叠之后拿到了被折的
    那三张里第一条的截止日期，而它自己的进度（40）没有被顶掉。
    """
    reg, _, files = _two_batches(tmp_path)
    _append_weekly(reg, files)
    ctx = reg.get("ctx_two")
    parent = _card(ctx, "秋季营销冲刺")
    assert parent.dueDate in {"2026-09-15", "2026-11-01", "2026-09-20"}, parent.dueDate
    assert parent.progress == 40
    assert LEDGER_FILE in (parent.lineage.get("docs") or []), parent.lineage


# ── 裁决落库（内存腿；pg 腿在 needs_db 一节）─────────────────────────────────────────────────────

def test_every_fold_leaves_a_ruling_that_names_the_card_and_the_document_line(tmp_path):
    """「为什么这张卡不见了」必须答得出，而且答案要**指到这张卡**（不是同名的另一张）。"""
    reg, _, files = _two_batches(tmp_path)
    _append_weekly(reg, files)
    ctx = reg.get("ctx_two")

    folded = [pr for pr in ctx.extraction.projects if pr.folded_into]
    assert len(folded) == 3
    by_subject = {r.subject_id: r for r in ctx.extraction.granularity if r.subject_id}
    for pr in folded:
        r = by_subject.get(pr.id)
        assert r is not None, f"「{pr.title}」被折叠了却没有裁决记录"
        assert r.verdict == "milestone" and r.rule == "R1-milestone-section"
        assert r.parent == "秋季营销冲刺" and r.parent_kind == "project"
        assert r.evidence.startswith(f"{WEEKLY_FILE}:"), r.evidence
        assert pr.title in r.reason and "里程碑" in r.reason


def test_the_extraction_path_leaves_subject_id_empty_on_purpose(tmp_path):
    """抽取路的裁决**不**记 subject_id：`apply_gate` 跑在 `_disambiguate_project_ids` 之前，
    那里的 id 还不是这张卡最终活下来的 id，记了就是一把静默指错的 join key。

    这条判据存在的意义是：下一个人看到「有的裁决有 subject_id、有的没有」时，
    知道那是设计不是漏写。
    """
    reg, _, files = _two_batches(tmp_path)
    _append_weekly(reg, files)
    ctx = reg.get("ctx_two")
    from_extraction = [r for r in ctx.extraction.granularity
                       if r.rule in {"R5-duty-column", "R0-tracked", "R0-kept"}]
    assert from_extraction, "夹具里应当有抽取路留下的裁决"
    assert all(r.subject_id == "" for r in from_extraction)


# ── file_delete：解释没了，折叠就撤销 ────────────────────────────────────────────────────────────

def test_deleting_the_document_that_justified_a_fold_puts_the_cards_back(tmp_path):
    """删掉周报 = 删掉那三条折叠唯一的理由。一张看不见又说不出理由的卡，正是本模块最不该
    造出来的东西 —— 所以折叠跟着撤销，卡回到经理眼前。"""
    reg, _, files = _two_batches(tmp_path)
    _append_weekly(reg, files)
    assert len(_visible(reg.get("ctx_two"))) == 4              # 对照基准：撤销之前是 4 张

    rep = delete_document_from_context(reg, "ctx_two", WEEKLY_FILE)
    assert rep.ok
    assert rep.unfolded == 3
    assert rep.rulings_removed >= 3
    ctx = reg.get("ctx_two")
    assert len(_visible(ctx)) == 7                             # 4 张 → 7 张
    assert set(NESTED) <= set(_visible(ctx))
    assert not any(pr.folded_into for pr in ctx.extraction.projects)


def test_deleting_an_unrelated_document_leaves_the_folds_alone(tmp_path):
    """反面：删掉花名册，三条折叠的理由一条都没动，卡该看不见还是看不见。

    没有这一条，上面那条「删了就撤销」可以由一个「删任何东西都全部撤销」的实现满足 ——
    那不是本票要的语义，那是把折叠做成了一次性的。
    """
    reg, _, files = _two_batches(tmp_path)
    _append_weekly(reg, files)
    rep = delete_document_from_context(reg, "ctx_two", ROSTER_FILE)
    assert rep.ok and rep.unfolded == 0
    ctx = reg.get("ctx_two")
    assert len(_visible(ctx)) == 4
    assert len([pr for pr in ctx.extraction.projects if pr.folded_into]) == 3


def test_no_card_is_ever_folded_without_a_surviving_explanation(tmp_path):
    """本模块的**不变量**，逐张删完整个档案地验一遍：任何时刻，
    `folded_into` 非空的卡在 `granularity` 里都必须有一条 `subject_id` 指向它的裁决。"""
    reg, _, files = _two_batches(tmp_path)
    _append_weekly(reg, files)
    for key in [WEEKLY_FILE, LEDGER_FILE, ROSTER_FILE]:
        delete_document_from_context(reg, "ctx_two", key)
        ctx = reg.get("ctx_two")
        explained = {r.subject_id for r in ctx.extraction.granularity
                     if r.subject_id and r.verdict != "project"}
        orphans = [pr.title for pr in ctx.extraction.projects
                   if pr.folded_into and pr.id not in explained]
        assert orphans == [], f"删掉「{key}」之后这些卡折着但说不出理由：{orphans}"


# ═════════════════════════════════════════════════════════════════════════════════════════════════
# 迁移纪律（离线，不用库）—— #87 那口坑的孪生位置
#
# `test_entities_kind_check_covers_written_kinds`（test_registry_contract.py）只扫
# `ADD CONSTRAINT`，**看不见 `want`**。而 0010 和 0009 一样是「先比对再 ALTER」的守卫式迁移：
# `want` 是拿来和库里现状比对的期望值，`ADD` 才是真执行的语句。#87 给 0009 补了这道孪生门，
# 0010 一直没有 —— #93 动了它，所以顺手补齐（票面：「want/ADD 两处清单同改」）。
# ═════════════════════════════════════════════════════════════════════════════════════════════════

def test_migration_0010_want_and_add_agree_with_the_kinds_put_writes():
    """0010 内部的两处清单必须与 `_ENTITY_KINDS` 三者一致。

    两个方向的伤各不相同，而且**都只在真库上显形**：
      · 只改 ADD、`want` 落后 → 库里已经是新定义时 `have != want` **恒成立** → 每次引导都
        DROP+ADD+全表重验（ACCESS EXCLUSIVE 锁），正是 2026-07-23 那次部署拖过
        `statement_timeout` 的成本；
      · 只改 `want`、ADD 落后 → 判「不相等」之后执行的是**旧**的 ADD，库里的 CHECK 停在旧集合，
        带新 kind 的行被真库拒收，而离线套一条都不红。
    """
    import re as _re
    from avery.ingest.pg_registry import _ENTITY_KINDS
    path = Path(__file__).resolve().parent.parent / "db" / "migrations" / \
        "0010_entities_kind_playbook.sql"
    body = _re.sub(r"--[^\n]*", "", path.read_text(encoding="utf-8"))

    want = _re.search(r"want\s+text\s*:=\s*(.*?);", body, _re.S)
    assert want, "0010 的 want 字面量不见了 —— 迁移结构变了，请更新本门"
    want_kinds = set(_re.findall(r"''([a-z_]+)''", want.group(1)))
    add = _re.search(r"ADD\s+CONSTRAINT\s+entities_kind_check\b.*?ARRAY\s*\[(.*?)\]",
                     body, _re.S | _re.I)
    assert add, "0010 的 ADD CONSTRAINT 不见了 —— 迁移结构变了，请更新本门"
    add_kinds = set(_re.findall(r"'([a-z_]+)'", add.group(1)))

    assert want_kinds == add_kinds == set(_ENTITY_KINDS), (
        f"0010 内部漂移了 —— want={sorted(want_kinds)} ADD={sorted(add_kinds)} "
        f"_ENTITY_KINDS={sorted(_ENTITY_KINDS)}；三者必须完全一致（want 只用来比对，"
        f"ADD 才真执行）。改 kind 一律**就地改这一条**，永不叠新的超越迁移。")


def test_asdict_always_emits_folded_into_so_a_stale_allowlist_would_bite(tmp_path):
    """#87 的坑，逐字同一条：`pg_registry.put()` 写的是 `asdict(entity)`，而 `asdict` **恒发**
    每一个字段——`folded_into` 哪怕是默认空串也在 payload 里。

    项目行今天没有 payload 键 allowlist（0009 那条 CHECK 只管 `kind='person'`），所以这一次
    不需要迁移；这条判据钉的是**那个前提**：哪天有人给项目行加了 allowlist，或者有人把
    `folded_into` 搬到人卡上，它会先红，而不是等到生产上每一条写入被库拒。
    """
    from dataclasses import asdict as _asdict
    from avery.ingest.pg_registry import _PERSON_FIELDS, _PROJECT_FIELDS
    payload = _asdict(ProjectEntity(id="p1", title="宴会厅翻新"))
    assert "folded_into" in payload and payload["folded_into"] == ""
    assert "folded_into" in _PROJECT_FIELDS
    assert "folded_into" not in _PERSON_FIELDS, (
        "`folded_into` 跑到人卡上了 —— 0009 的 allowlist（want + ADD 两处）必须同时加上它，"
        "否则每一条人卡写入都会被真库 CheckViolation 拒掉，而离线套一条都不红（#87 实测）")
    # 回读：pg 那条路是 `_entity(ProjectEntity, _PROJECT_FIELDS, payload)`
    back = ProjectEntity(**payload)
    assert back.folded_into == ""
    folded = ProjectEntity(id="p2", title="物料采购", folded_into="p1")
    assert ProjectEntity(**_asdict(folded)).folded_into == "p1"


def test_a_pre_93_project_payload_still_reads_back(tmp_path):
    """存量行（#93 之前落库的项目 payload 里根本没有 `folded_into` 这个键）回读成默认空串，
    不是 TypeError。`_entity` 的「未知键忽略 + 缺席键取默认」正是为这件事写的。"""
    from dataclasses import asdict as _asdict
    from avery.ingest.pg_registry import _PROJECT_FIELDS, _entity
    old = _asdict(ProjectEntity(id="p1", title="宴会厅翻新", progress=60))
    old.pop("folded_into")
    old["some_future_key"] = "老读者要活过新写者"      # 前向兼容那一半
    back = _entity(ProjectEntity, _PROJECT_FIELDS, old)
    assert back.folded_into == "" and back.progress == 60


def test_the_ruling_dataclass_survives_an_asdict_round_trip():
    """裁决落库走的也是 `asdict` → JSONB → `Ruling(**payload)`。两个 #93 新字段
    （`parent_kind` / `subject_id`）必须逐字活过去——它们是折叠那条路上的**判据**与**join key**，
    丢一个，重启之后「这张卡为什么不见了」就答错人或者答不出。"""
    from dataclasses import asdict as _asdict
    from avery.ingest.pg_registry import _RULING_FIELDS, _entity
    r = Ruling(title="物料采购", verdict="milestone", rule="R1-milestone-section",
               reason="文档把它列在里程碑清单里", parent="秋季营销冲刺",
               evidence="本周周报.md:8", parent_kind="project", subject_id="pr-x")
    payload = _asdict(r)
    assert set(payload) == _RULING_FIELDS
    assert _entity(Ruling, _RULING_FIELDS, payload) == r


# ═════════════════════════════════════════════════════════════════════════════════════════════════
# @needs_db —— 真库那一层
#
# ⚠ 离线套对 pg 持久层是瞎的，而且它会以**全绿**的形态骗你。本节要证三件离线永远证不了的事：
#   ① `entities_kind_check` 认得 'ruling' 这个新 kind（不认 = 每一次折叠在生产上被库拒，
#      而离线套照样全绿——08 的 'playbook' 就是这么上产的）；
#   ② `folded_into` 与裁决记录真的活过一次 DELETE+INSERT 快照替换（内存腿 `get()` 返回的是
#      同一个活对象，「还在」是必然，证明不了任何事）；
#   ③ **升级路径**：一个停在 #93 之前的 CHECK 定义上的库，被新代码接管之后自己长好。
# ═════════════════════════════════════════════════════════════════════════════════════════════════

needs_db = pytest.mark.needs_db

_OLD_KINDS = ("person", "project", "signal", "playbook", "conflict")   # #93 之前的那一版
_KIND_CHECK_SQL = ("SELECT pg_get_constraintdef(oid) FROM pg_constraint "
                   "WHERE conrelid = 'avery.entities'::regclass "
                   "AND conname = 'entities_kind_check' AND contype = 'c'")


def _db_url() -> str | None:
    import os
    return (os.environ.get("AVERY_DB_URL") or os.environ.get("PGVECTOR_URL") or "").strip() or None


def _skip_without_db() -> str:
    url = _db_url()
    if not url:
        pytest.skip("needs AVERY_DB_URL (or PGVECTOR_URL) pointing at a Postgres")
    pytest.importorskip("psycopg")
    return url


def _pg_seed_two_batches(url, tmp_path, cid):
    """真库版的 `_two_batches` + 周报补传 —— 跑完库里必然有折叠卡与裁决行。"""
    from avery.ingest.pg_registry import PostgresContextRegistry
    reg = PostgresContextRegistry(url, data_dir=tmp_path / "data")
    files = _write_corpus(tmp_path / "corpus")
    assert ingest_paths([str(files[ROSTER_FILE])], registry=reg, work_dir=tmp_path / "mem",
                        context_id=cid, name="度假酒店", owner_token="tok93pg",
                        extractor=_llm_extractor(),
                        source_documents=[_sd(files[ROSTER_FILE], BATCH_AT[0])]).ok
    for i, name in enumerate([LEDGER_FILE, WEEKLY_FILE], start=1):
        rep = append_paths_to_context(reg, cid, [str(files[name])],
                                      [_sd(files[name], BATCH_AT[i])],
                                      extractor=_llm_extractor())
        assert rep.ok, rep.parse_errors
    return reg, rep


@needs_db
def test_a_fold_and_its_ruling_survive_a_real_snapshot_replace(tmp_path):
    """三道锁全部落地之后，**重启之后还答得出**：`folded_into` 与那条裁决一起活过真库往返。

    对照基准写成 7 张 → 4 张：先证明这份档案真的折过（不然「4 张」对着一份本来就 4 张的
    档案照样绿），再证明重开一个 registry 实例（== 容器重启）看到的还是 4 张。
    """
    url = _skip_without_db()
    from avery.ingest.pg_registry import PostgresContextRegistry
    cid = "ctx_93_rt"
    reg, rep = _pg_seed_two_batches(url, tmp_path, cid)
    try:
        assert rep.rejudge.active_before == 7 and rep.rejudge.active_after == 4

        fresh = PostgresContextRegistry(url, data_dir=tmp_path / "data2").get(cid)
        assert len(_visible(fresh)) == 4, _visible(fresh)
        folded = [pr for pr in fresh.extraction.projects if pr.folded_into]
        assert sorted(pr.title for pr in folded) == sorted(NESTED)
        parent = next(pr for pr in fresh.extraction.projects if pr.title == "秋季营销冲刺")
        assert {pr.folded_into for pr in folded} == {parent.id}

        # 裁决记录（#93 之前这里恒空——pg_registry 那段注释白纸黑字写着它静默丢失）
        assert fresh.extraction.granularity, "裁决在真库往返里丢了 —— 这正是 #93 要结的那笔账"
        by_subject = {r.subject_id: r for r in fresh.extraction.granularity if r.subject_id}
        for pr in folded:
            r = by_subject.get(pr.id)
            assert r is not None, f"重启之后「{pr.title}」为什么不见了 —— 答不出来"
            assert r.rule == "R1-milestone-section" and r.parent == "秋季营销冲刺"
            assert r.parent_kind == "project" and r.evidence.startswith(f"{WEEKLY_FILE}:")
        # 抽取路那些裁决也一起回来了（R5 那一族），且照旧不带 subject_id
        assert any(r.rule == "R5-duty-column" and r.subject_id == ""
                   for r in fresh.extraction.granularity)
    finally:
        reg.delete(cid)


@needs_db
def test_the_kind_check_admits_ruling_rows_and_still_refuses_the_rest(tmp_path):
    """`entities_kind_check` 认 'ruling'，**并且没有被这次放宽捅漏**（对照基准：随便一个
    别的 kind 照旧被库拒）。少了后半句，把 CHECK 整个删掉这条门也会绿。"""
    url = _skip_without_db()
    import psycopg
    from psycopg.types.json import Jsonb
    from dataclasses import asdict as _asdict
    from avery.ingest.pg_registry import PostgresContextRegistry
    cid = "ctx_93_kind"
    reg = PostgresContextRegistry(url, data_dir=tmp_path / "data")
    files = _write_corpus(tmp_path / "corpus")
    try:
        assert ingest_paths([str(files[LEDGER_FILE])], registry=reg, work_dir=tmp_path / "mem",
                            context_id=cid, name="度假酒店", owner_token="tok93kind",
                            source_documents=[_sd(files[LEDGER_FILE], BATCH_AT[0])]).ok
        row = _asdict(Ruling(title="物料采购", verdict="milestone", rule="R1-milestone-section",
                             reason="里程碑清单", parent="秋季营销冲刺", parent_kind="project",
                             evidence="本周周报.md:8", subject_id="pr-x"))
        with psycopg.connect(url) as conn, conn.transaction():
            conn.execute("INSERT INTO avery.entities (context_id, kind, idx, payload) "
                         "VALUES (%s, 'ruling', 9971, %s)", (cid, Jsonb(row)))
        with psycopg.connect(url) as conn:
            with pytest.raises(psycopg.errors.CheckViolation):
                with conn.transaction():
                    conn.execute("INSERT INTO avery.entities (context_id, kind, idx, payload) "
                                 "VALUES (%s, 'verdict', 9970, %s)", (cid, Jsonb(row)))
    finally:
        reg.delete(cid)


@needs_db
def test_the_upgrade_path_from_a_pre_93_database(tmp_path):
    """升级路径在一次性库上**真跑**（0810 纪律，#87/#90 同款）—— 七步：

      ① 一个已经在跑的库（当前 schema + 一份真语料）；
      ② 把 `entities_kind_check` 打回 #93 之前的五 kind 定义，并把存量项目行的 payload 去掉
         `folded_into` 键 —— 这就是一台还没重放新 0010 的生产容器；
      ③ **对照基准**：在这个状态下 INSERT 一条 kind='ruling' 必须被库拒（证明②真的生效了，
         否则第⑤步的「现在过了」什么都不能说明）；
      ④ 新代码接管（`_ensure_schema`，真实路径由 put()/get() 自己调）；
      ⑤ 复查库里的 CHECK 定义已经含 'ruling'；
      ⑥ 用新代码补一批会触发折叠的资料 —— 折叠标记与裁决行真的写得进去；
      ⑦ 全新 registry 实例回读：折叠还在、裁决还在，而②里那条缺键的存量行读成默认空串不炸。
    """
    url = _skip_without_db()
    import psycopg
    from avery.ingest.pg_registry import PostgresContextRegistry
    cid = "ctx_93_upgrade"
    reg = PostgresContextRegistry(url, data_dir=tmp_path / "data")
    files = _write_corpus(tmp_path / "corpus")
    old_check = ("CHECK (kind = ANY (ARRAY["
                 + ", ".join(f"'{k}'" for k in _OLD_KINDS) + "]::text[]))")
    try:
        # ① 一个在跑的库：花名册 + 台账已经落地（此刻可见 6 张卡）
        assert ingest_paths([str(files[ROSTER_FILE])], registry=reg, work_dir=tmp_path / "mem",
                            context_id=cid, name="度假酒店", owner_token="tok93up",
                            extractor=_llm_extractor(),
                            source_documents=[_sd(files[ROSTER_FILE], BATCH_AT[0])]).ok
        assert append_paths_to_context(reg, cid, [str(files[LEDGER_FILE])],
                                       [_sd(files[LEDGER_FILE], BATCH_AT[1])],
                                       extractor=_llm_extractor()).ok

        # ② 打回 #93 之前：旧 CHECK + 存量项目行没有 folded_into 键
        # ⚠ 先清掉 ruling 行，而且是**全表**清：#93 之前的库里根本没有这一类行（裁决不落库），
        #    而 CHECK 是表级的——留着一行，旧 CHECK 根本 ADD 不上去（真实收：第一版这里就是
        #    「violated by some row」）。所以本用例**必须**跑在一次性库上，不能跑共享测试库。
        with psycopg.connect(url) as conn, conn.transaction():
            conn.execute("DELETE FROM avery.entities WHERE kind = 'ruling'")
            conn.execute("ALTER TABLE avery.entities DROP CONSTRAINT IF EXISTS entities_kind_check")
            conn.execute(f"ALTER TABLE avery.entities ADD CONSTRAINT entities_kind_check {old_check}")
            conn.execute("UPDATE avery.entities SET payload = payload - 'folded_into' "
                         "WHERE context_id = %s AND kind = 'project'", (cid,))
            stripped = conn.execute(
                "SELECT count(*) FROM avery.entities WHERE context_id = %s AND kind = 'project' "
                "AND NOT (payload ? 'folded_into')", (cid,)).fetchone()[0]
        assert stripped == 6, f"存量行没造出来（{stripped} 行缺键）—— 后面第⑦步会是空真"

        # ③ 对照基准：这个状态下真库确实拒收 ruling 行
        with psycopg.connect(url) as conn:
            with pytest.raises(psycopg.errors.CheckViolation):
                with conn.transaction():
                    conn.execute("INSERT INTO avery.entities (context_id, kind, idx, payload) "
                                 "VALUES (%s, 'ruling', 9960, '{}'::jsonb)", (cid,))

        # ④ 新代码接管（全新实例 → _schema_ready 是 False → 真的重放迁移）
        upgraded = PostgresContextRegistry(url, data_dir=tmp_path / "data2")
        upgraded._ensure_schema()

        # ⑤ 库里的 CHECK 已经长好
        with psycopg.connect(url) as conn:
            have = conn.execute(_KIND_CHECK_SQL).fetchone()[0]
        assert "ruling" in have, f"0010 重放之后 CHECK 还是旧的：{have}"

        # ⑥ 升级后的库上真跑一次会折叠的补传
        rep = append_paths_to_context(upgraded, cid, [str(files[WEEKLY_FILE])],
                                      [_sd(files[WEEKLY_FILE], BATCH_AT[2])],
                                      extractor=_llm_extractor())
        assert rep.ok, rep.parse_errors
        assert rep.rejudge.active_before == 7 and rep.rejudge.active_after == 4

        # ⑦ 全新实例回读
        fresh = PostgresContextRegistry(url, data_dir=tmp_path / "data3").get(cid)
        assert len(_visible(fresh)) == 4
        assert sorted(pr.title for pr in fresh.extraction.projects if pr.folded_into) \
            == sorted(NESTED)
        assert any(r.subject_id for r in fresh.extraction.granularity)
        assert all(isinstance(pr.folded_into, str) for pr in fresh.extraction.projects)
    finally:
        # 共享测试库上跑的话，别把旧 CHECK 留在那儿祸害别的用例
        PostgresContextRegistry(url, data_dir=tmp_path / "restore")._ensure_schema()
        reg.delete(cid)


@needs_db
def test_deleting_the_justifying_document_unfolds_on_a_real_database(tmp_path):
    """删除路那条「解释没了就把卡放回来」也必须在真库上成立：#77 的删除会 `put()` 整份 ctx，
    所以撤销折叠这件事要活过一次快照替换才算数（4 张 → 7 张）。"""
    url = _skip_without_db()
    from avery.ingest.pg_registry import PostgresContextRegistry
    cid = "ctx_93_del"
    reg, _ = _pg_seed_two_batches(url, tmp_path, cid)
    try:
        assert len(_visible(reg.get(cid))) == 4
        rep = delete_document_from_context(reg, cid, WEEKLY_FILE)
        assert rep.ok and rep.unfolded == 3
        fresh = PostgresContextRegistry(url, data_dir=tmp_path / "data2").get(cid)
        assert len(_visible(fresh)) == 7
        assert not any(pr.folded_into for pr in fresh.extraction.projects)
    finally:
        reg.delete(cid)
