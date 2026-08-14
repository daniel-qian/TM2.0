"""#89 — 供应商热备 + /health 不撒谎（2026-08-11 合伙人翻车的工程半边）。

事故形状：MiniMax Token Plan 用尽，生产连续 39 小时每次抽取 429；DEEPSEEK_API_KEY 就躺在
生产 env 里但代码是「取第一家有 key 的」，第二家从没被问过；/health 恒 degraded:false（只看
进程内预算计数器）。这里钉四件事：

  1. FallbackBrain 的换家判据：供应商性失败换下一家；BudgetExceeded（我们自己的花钱闸）
     原样上抛、绝不换家、绝不记为供应商失败。
  2. 链的组装规则（extraction_chain / advise_chain / make_brain）——env 的每种组合各归各位，
     AVERY_BRAIN_FAILOVER=off 一刀切回单供应商。
  3. 端到端（本地假供应商，零真网络）：主脑全 429 → /ingest 200 + extraction_mode='degraded'；
     主脑 429 + 备脑答得出 → extraction_mode='llm'，人卡来自备脑。
  4. /health：commit 字段；providers 被动遥测（没被调用过 = ok:null，不翻译成好或坏）；
     已知全链坏 → degraded:true；单家坏对家好 ≠ degraded。

⚠ 本文件的集成测只打 127.0.0.1 的假供应商（http.server），密钥全被 monkeypatch 覆盖成
dummy——跑在离线电池里烧不到一分钱。真供应商语义（429 的形状）以 openai SDK 对状态码的
分类为准，假服务器只需要回对状态码。
"""
import json
import sys
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from service import brain_factory, extractor_factory, failover, llm_budget  # noqa: E402
from service.app import app  # noqa: E402
from service.llm_budget import BudgetExceeded  # noqa: E402


@pytest.fixture(autouse=True)
def _clean_slate():
    failover.reset()
    llm_budget.reset()
    yield
    failover.reset()
    llm_budget.reset()


# ── 1 · FallbackBrain 单元 ───────────────────────────────────────────────────────────────


class _OKBrain:
    name = "ok-brain"

    def __init__(self):
        self.calls = 0

    def respond(self, *a, **k):
        self.calls += 1
        return "answer"


class _BoomBrain:
    name = "boom-brain"

    def __init__(self, exc):
        self.exc = exc
        self.calls = 0

    def respond(self, *a, **k):
        self.calls += 1
        raise self.exc


def test_fallback_moves_to_second_provider_and_records_both():
    primary, secondary = _BoomBrain(RuntimeError("429-ish")), _OKBrain()
    fb = failover.FallbackBrain([("minimax", primary), ("deepseek", secondary)])
    assert fb.respond("sys", [], []) == "answer"
    assert primary.calls == 1 and secondary.calls == 1
    snap = failover.snapshot()
    assert snap["minimax"]["ok"] is False and "429-ish" in snap["minimax"]["detail"]
    assert snap["deepseek"]["ok"] is True


def test_fallback_all_dead_raises_last_error():
    fb = failover.FallbackBrain([
        ("minimax", _BoomBrain(RuntimeError("first"))),
        ("deepseek", _BoomBrain(RuntimeError("second"))),
    ])
    with pytest.raises(RuntimeError, match="second"):
        fb.respond("sys", [], [])
    snap = failover.snapshot()
    assert snap["minimax"]["ok"] is False and snap["deepseek"]["ok"] is False


def test_budget_exceeded_never_fails_over_and_never_blames_the_provider():
    """花钱闸是全局的：换一家只会再计一次费然后撞同一堵墙。原样上抛 + 遥测零记录。"""
    secondary = _OKBrain()
    fb = failover.FallbackBrain([
        ("minimax", _BoomBrain(BudgetExceeded("spent"))),
        ("deepseek", secondary),
    ])
    with pytest.raises(BudgetExceeded):
        fb.respond("sys", [], [])
    assert secondary.calls == 0, "BudgetExceeded 换家 = 双倍烧钱"
    assert failover.snapshot() == {}, "自家的闸不许记成供应商失败"


def test_chain_of_one_still_records_telemetry():
    fb = failover.FallbackBrain([("minimax", _OKBrain())])
    fb.respond("sys", [], [])
    assert failover.snapshot()["minimax"]["ok"] is True


def test_all_known_bad_requires_every_provider_called_and_failed():
    assert not failover.all_known_bad([])                      # 空链永不报坏
    assert not failover.all_known_bad(["minimax"])             # 没被调用过 = 不知道 ≠ 坏
    failover.record("minimax", False, "x")
    assert failover.all_known_bad(["minimax"])
    assert not failover.all_known_bad(["minimax", "deepseek"])  # 对家还没被问过
    failover.record("deepseek", True)
    assert not failover.all_known_bad(["minimax", "deepseek"])  # 对家好着
    failover.record("deepseek", False, "y")
    assert failover.all_known_bad(["minimax", "deepseek"])


# ── 2 · 链的组装规则 ─────────────────────────────────────────────────────────────────────


def _pin_env(monkeypatch, *, mm_key=None, ds_key=None, oa_key=None, explicit=None, switch=None,
             extractor=None):
    """#96: OPENAI_API_KEY / AVERY_OPENAI_KEY_ENV joined this list when openai became a real
    extraction provider — leaving them out means a box that happens to export an OpenAI key gets a
    third entry in every chain assertion below (and, worse, a real provider in a test that thinks
    it pinned everything)."""
    for var in ("MINIMAX_API_KEY", "DEEPSEEK_API_KEY", "OPENAI_API_KEY", "AVERY_OPENAI_KEY_ENV",
                "AVERY_EXTRACTOR_BRAIN", "AVERY_BRAIN_FAILOVER", "AVERY_EXTRACTOR"):
        monkeypatch.delenv(var, raising=False)
    if mm_key:
        monkeypatch.setenv("MINIMAX_API_KEY", mm_key)
    if ds_key:
        monkeypatch.setenv("DEEPSEEK_API_KEY", ds_key)
    if oa_key:
        monkeypatch.setenv("OPENAI_API_KEY", oa_key)
    if explicit:
        monkeypatch.setenv("AVERY_EXTRACTOR_BRAIN", explicit)
    if switch:
        monkeypatch.setenv("AVERY_BRAIN_FAILOVER", switch)
    if extractor:
        monkeypatch.setenv("AVERY_EXTRACTOR", extractor)


def test_extraction_chain_permutations(monkeypatch):
    _pin_env(monkeypatch, extractor="heuristic", mm_key="k1", ds_key="k2")
    assert extractor_factory.extraction_chain() == []          # 强制离线 = 没有链
    _pin_env(monkeypatch, mm_key="k1")
    assert extractor_factory.extraction_chain() == ["minimax"]
    _pin_env(monkeypatch, mm_key="k1", ds_key="k2")
    assert extractor_factory.extraction_chain() == ["minimax", "deepseek"]
    _pin_env(monkeypatch, mm_key="k1", ds_key="k2", explicit="deepseek")
    assert extractor_factory.extraction_chain() == ["deepseek", "minimax"]
    _pin_env(monkeypatch, mm_key="k1", ds_key="k2", switch="off")
    assert extractor_factory.extraction_chain() == ["minimax"], "kill-switch 必须一刀切回单供应商"
    _pin_env(monkeypatch)
    assert extractor_factory.extraction_chain() == []          # 无 key = 无链
    # #96 · 第三家进来后，境内两家之间的既有行为一个字节都不许变（上面每条都还成立），而
    # openai 与它们**互不为热备**——跨 region 的链在 test_openai_provider_96.py 里单钉。
    _pin_env(monkeypatch, oa_key="k3")
    assert extractor_factory.extraction_chain() == ["openai"]


def test_advise_chain_permutations(monkeypatch):
    _pin_env(monkeypatch, mm_key="k1", ds_key="k2")
    monkeypatch.setenv("AVERY_BRAIN", "minimax")
    assert brain_factory.advise_chain() == ["minimax", "deepseek"]
    monkeypatch.setenv("AVERY_BRAIN", "deepseek")
    assert brain_factory.advise_chain() == ["deepseek", "minimax"]
    monkeypatch.setenv("AVERY_BRAIN_FAILOVER", "off")
    assert brain_factory.advise_chain() == ["deepseek"]
    monkeypatch.setenv("AVERY_BRAIN", "mock")
    assert brain_factory.advise_chain() == ["mock"]


def test_make_brain_wraps_real_brains_with_the_pair(monkeypatch):
    """构造即可验（零网络）：真脑回来必须是 FallbackBrain，minimax 主 + deepseek 备。"""
    _pin_env(monkeypatch, mm_key="dummy-mm", ds_key="dummy-ds")
    b = brain_factory.make_brain(None, "minimax")
    assert isinstance(b, failover.FallbackBrain)
    assert b.labels == ["minimax", "deepseek"]
    # mock 绝不包（离线电池的决定论仰仗它）
    m = brain_factory.make_brain(_MockCase(), "mock")
    assert not isinstance(m, failover.FallbackBrain)


class _MockCase:
    """make_mock_brain 只要能取到 case_id + MOCK 块；空壳即可。"""
    case_id = "fake-case"
    raw = {}
    mock = {}


# ── 3+4 · 端到端（本地假供应商）+ /health ───────────────────────────────────────────────


class _FakeProvider:
    """一个 OpenAI-compatible 假供应商。mode='quota' 恒 429；mode='ok' 回一份合法抽取 JSON。"""

    def __init__(self, mode: str, people=None):
        self.mode = mode
        self.hits = 0
        people = people or [{"name": "王岚", "person_id": "", "role": "市场部经理",
                             "team": "市场部", "tenure": "", "owns": ["渠道"],
                             "collaboration": [], "line": 2}]
        body = json.dumps({"people": people, "projects": [], "signals": []}, ensure_ascii=False)
        self._completion = json.dumps({
            "id": "cmpl-fake", "object": "chat.completion",
            "choices": [{"index": 0, "finish_reason": "stop",
                         "message": {"role": "assistant", "content": body}}],
        }).encode("utf-8")
        outer = self

        class H(BaseHTTPRequestHandler):
            def do_POST(self):
                outer.hits += 1
                self.rfile.read(int(self.headers.get("Content-Length", 0) or 0))
                if outer.mode == "quota":
                    payload = json.dumps({"error": {
                        "type": "rate_limit_error",
                        "message": "已达到 Token Plan 用量上限 (fake)"}}).encode()
                    self.send_response(429)
                else:
                    payload = outer._completion
                    self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(payload)))
                self.end_headers()
                self.wfile.write(payload)

            def log_message(self, *a):  # 静音
                pass

        self._srv = HTTPServer(("127.0.0.1", 0), H)
        self.port = self._srv.server_address[1]
        threading.Thread(target=self._srv.serve_forever, daemon=True).start()

    def close(self):
        self._srv.shutdown()
        self._srv.server_close()


@pytest.fixture()
def _fast_retries(monkeypatch):
    monkeypatch.setenv("AVERY_EXTRACT_BACKOFF_S", "0")   # 抽取窗口重试不睡觉
    monkeypatch.setenv("AVERY_BRAIN", "mock")            # advise 与本测无关，别碰真脑


def _upload(client):
    files = [("files", ("市场部花名册.txt",
                        "姓名,角色\n王岚,市场部经理\n".encode("utf-8"), "text/plain"))]
    return client.post("/ingest", files=files)


def _drive_and_summary(client, body: dict) -> tuple[dict, dict]:
    """#90: the POST no longer carries a final extraction_mode (it returns before extraction) —
    drive the worker, then read the honest label off the /files task summary + the landed team."""
    from service import ingest_worker
    ingest_worker.run_pending_jobs()
    hdr = {"X-Avery-Token": body["owner_token"]}
    last = client.get(f"/team/{body['context_id']}/files", headers=hdr).json()["last_job"]
    team = client.get(f"/team/{body['context_id']}", headers=hdr).json()
    return last, team


def test_ingest_degrades_honestly_when_the_only_provider_is_dead(monkeypatch, _fast_retries):
    from fastapi.testclient import TestClient
    fake = _FakeProvider("quota")
    try:
        _pin_env(monkeypatch, mm_key="dummy-mm")
        monkeypatch.setenv("MINIMAX_BASE_URL", f"http://127.0.0.1:{fake.port}/v1")
        with TestClient(app) as c:
            r = _upload(c)
            assert r.status_code == 200
            last, _team = _drive_and_summary(c, r.json())
            assert last["extraction_mode"] == "degraded", \
                "唯一供应商全 429 时必须自报 degraded——0811 这个值后端发了、没人看"
            h = c.get("/health").json()
            assert h["extraction_chain"] == ["minimax"]
            assert h["providers"]["minimax"]["ok"] is False
            assert h["extraction_mode"] == "degraded"
            assert h["degraded"] is True, "已知全链坏还报 degraded:false 就是 0811 的原样复刻"
        assert fake.hits > 0, "假供应商一次都没被打到 = 测试打了别处（真网络？）"
    finally:
        fake.close()


def test_ingest_fails_over_to_the_second_provider(monkeypatch, _fast_retries):
    from fastapi.testclient import TestClient
    dead, alive = _FakeProvider("quota"), _FakeProvider("ok")
    try:
        _pin_env(monkeypatch, mm_key="dummy-mm", ds_key="dummy-ds")
        monkeypatch.setenv("MINIMAX_BASE_URL", f"http://127.0.0.1:{dead.port}/v1")
        monkeypatch.setenv("DEEPSEEK_BASE_URL", f"http://127.0.0.1:{alive.port}/v1")
        with TestClient(app) as c:
            r = _upload(c)
            assert r.status_code == 200
            last, team = _drive_and_summary(c, r.json())
            assert last["extraction_mode"] == "llm", "备脑答得出 → 这不是 degraded，是热备在干活"
            assert [p["name"] for p in team["people"]] == ["王岚"], "人卡必须来自备脑的抽取"
            h = c.get("/health").json()
            assert h["extraction_chain"] == ["minimax", "deepseek"]
            assert h["providers"]["minimax"]["ok"] is False
            assert h["providers"]["deepseek"]["ok"] is True
            assert h["degraded"] is False, "单家坏而对家好 ≠ degraded（热备的意义所在）"
            assert h["extraction_mode"] == "llm"
        assert dead.hits > 0 and alive.hits > 0
    finally:
        dead.close()
        alive.close()


def test_health_commit_and_unknown_providers(monkeypatch):
    from fastapi.testclient import TestClient
    _pin_env(monkeypatch, mm_key="dummy-mm", ds_key="dummy-ds")
    monkeypatch.setenv("AVERY_BRAIN", "mock")
    monkeypatch.setenv("AVERY_COMMIT", "abc1234")
    with TestClient(app) as c:
        h = c.get("/health").json()
        assert h["commit"] == "abc1234"
        # 刚重启、一次真调用都没发生：ok 必须是 null（诚实的不知道），degraded 不许哭狼
        assert h["providers"]["minimax"]["ok"] is None
        assert h["providers"]["deepseek"]["ok"] is None
        assert h["degraded"] is False
    monkeypatch.delenv("AVERY_COMMIT", raising=False)
    with TestClient(app) as c:
        assert c.get("/health").json()["commit"] == "unknown"
