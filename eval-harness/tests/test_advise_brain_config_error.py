"""大脑配置失败时，/advise 必须吐出一个干净的 error 事件——而不是自己崩掉。

为什么值得一条常设门：

`_run_events` 里那段 `except RuntimeError` 的**全部职责**就是「把大脑配置错误变成一个 error
事件，而不是 500，以保住 SSE 契约」——它的 docstring 就是这么写的。但它当时干的事正好相反：

    except RuntimeError as e:
        def _err():
            yield {"type": "error", "error": str(e), ...}   # ← e 在这里已经没了
        return _err(), case

Python 3 在 except 块退出时会**隐式 del** 掉 `except ... as e` 绑定的名字。而 `_err()` 是生成器、
延迟执行——真正跑到 `str(e)` 时是 SSE 层去迭代它的那一刻，那时 except 块早就退出了。于是抛
`NameError: cannot access free variable 'e'`，经理拿到的是一条断掉的流，不是那句"去设 key"。

触发条件是生产上**最可能发生的那一种**故障：LLM key 缺失 / 过期 / 超预算。也就是说，越是需要
一句清楚话的时候，它越是给不出来。

修法：在 except 块**内部**先把消息取到本地变量，生成器闭包引用那个变量。

这条测试直接对着 `_run_events` 打，不起 HTTP 服务，也不碰真大脑。
"""
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from service import app as service_app  # noqa: E402
from service import live_input  # noqa: E402


def _situation():
    return live_input.LiveSituation(situation="佣金测算卡住了，我该先找谁？")


def test_brain_config_error_yields_a_readable_event_not_a_crash(monkeypatch, tmp_path):
    """大脑造不出来时，迭代事件流必须拿到 error 事件，且带着原始原因。"""
    monkeypatch.setattr(service_app.brain_factory, "resolve_brain_kind", lambda: "minimax")
    monkeypatch.setattr(service_app, "MEMORY_DIR", tmp_path)

    def _boom(case, kind):
        raise RuntimeError("AVERY_BRAIN=minimax 但没有 MINIMAX_API_KEY")

    monkeypatch.setattr(service_app.brain_factory, "make_brain", _boom)

    events, _case = service_app._run_events(_situation())

    # 🔴 关键：这里以前抛 NameError。生成器是延迟的，问题只在**迭代时**才现形——
    # 所以断言必须真的把它迭代出来，光拿到 events 对象什么都证明不了。
    produced = list(events)

    assert len(produced) == 1, f"应当只有一个 error 事件，实际 {produced}"
    ev = produced[0]
    assert ev["type"] == "error"
    # 原始原因必须透传：否则用户只知道"出错了"，不知道是 key 的问题。
    assert "MINIMAX_API_KEY" in ev["error"], f"原因被吞了：{ev['error']}"
    # 提示必须可执行（告诉他下一步干什么）。
    assert "AVERY_BRAIN" in ev.get("hint", "")


def test_error_event_survives_being_iterated_late(monkeypatch, tmp_path):
    """把「延迟」这件事本身钉死：先拿到生成器、做别的事、最后才迭代，仍须完好。

    这正是真实调用路径的形状——`_run_events` 返回后，事件流要经过 `_sse` 包装、经过
    starlette 的 EventSourceResponse，隔了很远才被真正迭代。上一个测试如果紧接着迭代，
    某些写法可能侥幸通过；这条不给它侥幸的机会。
    """
    monkeypatch.setattr(service_app.brain_factory, "resolve_brain_kind", lambda: "minimax")
    monkeypatch.setattr(service_app, "MEMORY_DIR", tmp_path)
    monkeypatch.setattr(
        service_app.brain_factory, "make_brain",
        lambda case, kind: (_ for _ in ()).throw(RuntimeError("key 过期了")),
    )

    events, _case = service_app._run_events(_situation())

    # 中间隔一堆无关操作 + 一次 GC，模拟真实链路里的距离
    import gc
    for _ in range(50):
        _ = {"noise": list(range(20))}
    gc.collect()

    produced = list(events)
    assert produced and produced[0]["type"] == "error"
    assert "key 过期了" in produced[0]["error"]


def test_no_lazy_closure_reads_a_deleted_exception_name():
    """全仓静态门：禁止「except ... as e 内定义函数，函数体又引用 e」这个形状回归。

    Python 3 的隐式 del 让这个形状只在**延迟执行**时炸，测试很难覆盖到，所以用 AST 直接禁掉。
    真需要原因就在 except 块内先存进本地变量（见 app.py 里的 `msg = str(e)`）。
    """
    import ast

    root = Path(__file__).resolve().parents[1]
    offenders = []
    for path in root.rglob("*.py"):
        if "__pycache__" in str(path):
            continue
        try:
            tree = ast.parse(path.read_text(encoding="utf-8"))
        except SyntaxError:
            continue
        for node in ast.walk(tree):
            if not (isinstance(node, ast.ExceptHandler) and node.name):
                continue
            for inner in ast.walk(node):
                if not isinstance(inner, (ast.FunctionDef, ast.AsyncFunctionDef, ast.Lambda)):
                    continue
                for ref in ast.walk(inner):
                    if isinstance(ref, ast.Name) and ref.id == node.name and isinstance(ref.ctx, ast.Load):
                        offenders.append(
                            f"{path.relative_to(root)}:{ref.lineno} "
                            f"（except ... as {node.name} 内的函数引用了 {node.name}）"
                        )
                        break

    assert not offenders, (
        "except 块内定义的函数引用了异常变量——延迟执行时会 NameError。\n"
        "改法：在 except 块内先 `msg = str(e)`，闭包引用 msg。\n" + "\n".join(offenders)
    )
