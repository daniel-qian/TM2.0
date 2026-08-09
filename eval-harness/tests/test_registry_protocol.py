"""arch-0802 — the registry seam conformance gate (OFFLINE).

The persistence seam has two adapters (in-memory ``ContextRegistry``, ``PostgresContextRegistry``)
whose ~26-member surface was duck-typed with no written interface: a method added on one side only
was invisible to the offline battery (the @needs_db parity suite catches it, but that suite is
deselected by design — a pg-side gap shipped green on 2026-07-23 exactly this way, see the
offline-guard block in test_registry_contract.py). This gate makes METHOD drift go red with no
database attached:

  * every ``ContextRegistryProtocol`` member exists on BOTH adapters and is callable;
  * each member's parameter list (names, kinds, defaults) is IDENTICAL across the two adapters —
    pg_registry imports psycopg lazily (inside ``__init__``), so importing the CLASS needs no DB
    and no driver.

Behavior parity (same inputs -> same rows/answers) stays where it lives today: the @needs_db
parity suite in test_registry_contract.py. This file only pins the SHAPE of the seam.

The known pg-only extra is pinned as deliberate, not drift: ``delete()`` is shared-dev-DB
hygiene the service never calls; it stays out of the Protocol on purpose.
"""
import inspect

from avery.ingest.pg_registry import PostgresContextRegistry
from avery.ingest.registry import ContextRegistry, ContextRegistryProtocol

ADAPTERS = {
    "ContextRegistry": ContextRegistry,
    "PostgresContextRegistry": PostgresContextRegistry,
}


def protocol_members() -> list[str]:
    members = [n for n in dir(ContextRegistryProtocol) if not n.startswith("_")]
    members.append("__contains__")  # dunder 成员被上面的过滤挡掉，单独点名
    return sorted(members)


def test_protocol_surface_is_nontrivial():
    # 防呆：Protocol 被清空/改名时，下面两条会"空转全绿"——先钉住表面规模。
    assert len(protocol_members()) >= 26, protocol_members()


def test_both_adapters_implement_every_protocol_member():
    missing: dict[str, list[str]] = {name: [] for name in ADAPTERS}
    for member in protocol_members():
        for cls_name, cls in ADAPTERS.items():
            fn = getattr(cls, member, None)
            if fn is None or not callable(fn):
                missing[cls_name].append(member)
    assert not any(missing.values()), f"adapter drift (missing members): {missing}"


def test_member_parameter_lists_identical_across_adapters():
    diffs = []
    for member in protocol_members():
        sig_a = inspect.signature(getattr(ContextRegistry, member))
        sig_b = inspect.signature(getattr(PostgresContextRegistry, member))
        shape_a = [(p.name, p.kind, p.default) for p in sig_a.parameters.values()]
        shape_b = [(p.name, p.kind, p.default) for p in sig_b.parameters.values()]
        if shape_a != shape_b:
            diffs.append((member, shape_a, shape_b))
    assert not diffs, f"parameter-list drift between adapters: {diffs}"


def test_protocol_signatures_match_the_adapters():
    """issue #78 补的暗区：上面那条只把两个 **adapter** 互相比，从不拿 Protocol 自己那份签名
    当基准。于是「只在 ContextRegistryProtocol 里加了参数、两个 adapter 都忘了改」这一幕，
    整份文件三条测试全绿——而 Protocol 恰恰是本仓声称的「seam 的唯一成文面」（registry.py
    的 `Growing the seam: add the method HERE first, then to both adapters`）。
    成文面与实现漂了却没人红，那句话就是空的。

    只比参数表，不比返回标注：Protocol 写 `-> AdviseRun: ...`、实现可能写具体子类或省略，
    那属于正常自由度；参数名/kind/默认值才是调用方真正依赖的东西。"""
    diffs = []
    for member in protocol_members():
        proto_fn = getattr(ContextRegistryProtocol, member, None)
        if proto_fn is None or not callable(proto_fn):
            continue   # 纯属性型成员（今天没有），不在本条射程内
        want = [(p.name, p.kind, p.default)
                for p in inspect.signature(proto_fn).parameters.values()]
        for cls_name, cls in ADAPTERS.items():
            got = [(p.name, p.kind, p.default)
                   for p in inspect.signature(getattr(cls, member)).parameters.values()]
            if got != want:
                diffs.append((member, cls_name, want, got))
    assert not diffs, f"Protocol 与实现的参数表漂了（成文面失效）: {diffs}"


def test_delete_stays_a_pg_only_deliberate_asymmetry():
    assert callable(getattr(PostgresContextRegistry, "delete", None)), (
        "pg delete() vanished — if that is intended, update pg_registry docstring + this pin"
    )
    assert not hasattr(ContextRegistry, "delete"), (
        "in-memory grew delete(): either add it to the Protocol (seam change, both adapters) "
        "or drop it — do not leave it as silent drift"
    )
    assert "delete" not in protocol_members()
