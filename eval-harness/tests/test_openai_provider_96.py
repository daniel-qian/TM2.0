# -*- coding: utf-8 -*-
"""#96 — OpenAI provider 转正（欧盟/海外部署路径）：chat + 抽取 + embedding 三条腿。

背景：瑞典客户线要求欧盟部署不用中国模型。用户内容的出境点恰好只有三个——MiniMax（对话+抽取）、
DeepSeek（热备）、DashScope（embedding）——本票把三个都换成 OpenAI 可选。

⚠⚠ **这个文件验的是什么、没验什么，说清楚：**

  验了：我们**发出去的请求形状**（参数名、该发的发、不该发的不发）、我们对**回应**的处理
        （截断、429、失败换家）、链的组装规则、embedding 的维度/批次/花钱闸、配置文档同步。
        全部打 127.0.0.1 的假服务器（http.server / 假 urlopen），零真网络、零真钱。

  没验：OpenAI 真的接受这个形状。假服务器对任何请求都点头——它证不了 `max_completion_tokens`
        是对的参数名、`gpt-5.6-terra` 是存在的模型、`dimensions=1024` 真的被受理。
        「真模型那条路」是本票验收的**另一条**：真 key 冒烟，等合伙人开 OpenAI project。
        别把这里的全绿说成那条验过了。
"""
from __future__ import annotations

import json
import re
import sys
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from avery import brain as brain_mod  # noqa: E402
from avery import embeddings as emb_mod  # noqa: E402
from service import brain_factory, extractor_factory, failover, llm_budget  # noqa: E402

HERE = Path(__file__).resolve().parents[1]          # eval-harness/
REPO = HERE.parent


@pytest.fixture(autouse=True)
def _clean_slate():
    failover.reset()
    llm_budget.reset()
    yield
    failover.reset()
    llm_budget.reset()


def _pin(monkeypatch, **env):
    """所有 provider 相关 env 归零，再按 kwargs 设。本机 eval-harness/.env 里有真 key——
    不归零就是「测试以为自己离线，其实拿着真 key 打真网」。"""
    for var in ("MINIMAX_API_KEY", "MINIMAX_BASE_URL", "MINIMAX_MODEL",
                "DEEPSEEK_API_KEY", "DEEPSEEK_BASE_URL", "DEEPSEEK_MODEL",
                "OPENAI_API_KEY", "AVERY_OPENAI_KEY_ENV", "AVERY_OPENAI_BASE_URL",
                "AVERY_OPENAI_MODEL", "AVERY_OPENAI_EXTRACT_MODEL", "AVERY_OPENAI_TOKEN_PARAM",
                "AVERY_OPENAI_TEMPERATURE", "AVERY_OPENAI_REASONING_EFFORT",
                "AVERY_BRAIN", "AVERY_BRAIN_FAILOVER", "AVERY_EXTRACTOR", "AVERY_EXTRACTOR_BRAIN",
                "AVERY_EMBEDDINGS", "AVERY_EMBED_MODEL", "AVERY_EMBED_DIM", "DASHSCOPE_API_KEY",
                "AVERY_DB_URL", "PGVECTOR_URL"):
        monkeypatch.delenv(var, raising=False)
    for k, v in env.items():
        monkeypatch.setenv(k, v)


# ══════════════════════════════════════════════════════════════════════════════════════════════
# 假供应商：记下我们发出去的每一份请求体
# ══════════════════════════════════════════════════════════════════════════════════════════════

class _RecordingProvider:
    """本地假 OpenAI-compatible 端点。`mode`:

        ok         200 + 一份合法抽取 JSON（或 `content` 指定的正文）
        quota      恒 429（0811 事故的形状）
        truncated  200 + finish_reason='length' 且 content 为空（推理把预算吃光了）
        clipped    200 + finish_reason='length' 但 content 有字（**对照组**：这不该被当成错误）
    """

    _PEOPLE = [{"name": "王岚", "person_id": "", "role": "市场部经理", "team": "市场部",
                "tenure": "", "owns": ["渠道"], "collaboration": [], "line": 2}]

    def __init__(self, mode: str = "ok", content: str | None = None):
        self.mode = mode
        self.requests: list[dict] = []
        body = content if content is not None else json.dumps(
            {"people": self._PEOPLE, "projects": [], "signals": []}, ensure_ascii=False)
        self._body = body
        outer = self

        class H(BaseHTTPRequestHandler):
            def do_POST(self):
                raw = self.rfile.read(int(self.headers.get("Content-Length", 0) or 0))
                try:
                    outer.requests.append(json.loads(raw.decode("utf-8")))
                except ValueError:
                    outer.requests.append({"_unparseable": raw[:200].decode("utf-8", "replace")})
                if outer.mode == "quota":
                    payload = json.dumps({"error": {"type": "rate_limit_error",
                                                    "message": "fake quota"}}).encode()
                    self.send_response(429)
                else:
                    finish = "stop" if outer.mode == "ok" else "length"
                    text = "" if outer.mode == "truncated" else outer._body
                    payload = json.dumps({
                        "id": "cmpl-fake", "object": "chat.completion",
                        "choices": [{"index": 0, "finish_reason": finish,
                                     "message": {"role": "assistant", "content": text}}],
                    }).encode("utf-8")
                    self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(payload)))
                self.end_headers()
                self.wfile.write(payload)

            def log_message(self, *a):
                pass

        self._srv = HTTPServer(("127.0.0.1", 0), H)
        self.port = self._srv.server_address[1]
        threading.Thread(target=self._srv.serve_forever, daemon=True).start()

    @property
    def url(self) -> str:
        return f"http://127.0.0.1:{self.port}/v1"

    def close(self):
        self._srv.shutdown()
        self._srv.server_close()


@pytest.fixture()
def provider():
    made: list[_RecordingProvider] = []

    def _make(mode="ok", content=None):
        p = _RecordingProvider(mode, content)
        made.append(p)
        return p

    yield _make
    for p in made:
        p.close()


# ══════════════════════════════════════════════════════════════════════════════════════════════
# 1 · 构造：OpenAI 那条路绝不许静默连到 MiniMax
# ══════════════════════════════════════════════════════════════════════════════════════════════

def test_openai_brain_never_silently_falls_back_to_minimax(monkeypatch):
    """BORN RED（改动前必红）。`OpenAICompatBrain` 的构造默认值全是 MiniMax 的，旧代码把
    AVERY_OPENAI_BASE_URL/MODEL 原样（可能是 None）传进去——运维只配了 OPENAI_API_KEY 时，
    实际发生的是「拿 OpenAI 的 key 去连 MiniMax 的端点」。对欧盟实例这不是配置错误，是出境。"""
    _pin(monkeypatch, OPENAI_API_KEY="dummy-oa")
    b = brain_factory.make_brain(None, "openai-compat")

    assert str(b._client.base_url).startswith("https://api.openai.com"), (
        f"AVERY_OPENAI_BASE_URL 未设时必须落到 OpenAI 官方端点，实得 {b._client.base_url}")
    assert b._model == brain_mod.OPENAI_MODEL
    assert "minimax" not in str(b._client.base_url).lower()
    assert "minimax" not in b._model.lower()


def test_minimax_env_cannot_leak_into_the_openai_brain(monkeypatch):
    """同一台箱子上真有 MINIMAX_* 时（境内箱子加一把 OpenAI key 做对比测试就是这个形状），
    OpenAI 脑子也不许读到它们——上一条断言的是「没设时」，这条断言的是「设了别人的时」。"""
    _pin(monkeypatch, OPENAI_API_KEY="dummy-oa", MINIMAX_API_KEY="dummy-mm",
         MINIMAX_BASE_URL="http://minimax.invalid/v1", MINIMAX_MODEL="MiniMax-M3")
    b = brain_factory.make_brain(None, "openai")

    assert "minimax" not in str(b._client.base_url).lower()
    assert b._model == brain_mod.OPENAI_MODEL


def test_openai_env_overrides_are_honored(monkeypatch):
    """反向：显式配了就得用（不然「配了不生效」是另一种撒谎）。"""
    _pin(monkeypatch, OPENAI_API_KEY="dummy-oa",
         AVERY_OPENAI_BASE_URL="https://eu.api.openai.example/v1",
         AVERY_OPENAI_MODEL="gpt-5.6-sol")
    b = brain_factory.make_brain(None, "openai")
    assert str(b._client.base_url).startswith("https://eu.api.openai.example")
    assert b._model == "gpt-5.6-sol"


def test_openai_key_env_can_be_renamed(monkeypatch):
    _pin(monkeypatch, AVERY_OPENAI_KEY_ENV="AVERY_EU_KEY")
    monkeypatch.setenv("AVERY_EU_KEY", "dummy-eu")
    assert brain_factory.openai_key_env() == "AVERY_EU_KEY"
    brain_factory.make_brain(None, "openai")          # 不抛 = 从改名后的变量里读到了 key


def test_missing_openai_key_is_a_clean_error_not_a_silent_call(monkeypatch):
    _pin(monkeypatch)
    with pytest.raises(RuntimeError, match="OPENAI_API_KEY"):
        brain_factory.make_brain(None, "openai")


# ══════════════════════════════════════════════════════════════════════════════════════════════
# 2 · 请求形状：「OpenAI 兼容」在参数层并不兼容
# ══════════════════════════════════════════════════════════════════════════════════════════════

def _respond_once(brain, tools=None):
    return brain.respond("sys", [{"role": "user", "content": [{"type": "text", "text": "hi"}]}],
                         tools or [])


def test_openai_call_uses_max_completion_tokens_and_omits_temperature(monkeypatch, provider):
    """gpt-5 系推理模型拒收 `max_tokens`（只认 max_completion_tokens），也拒收显式 temperature。
    这两条在假服务器上验的是「我们发的形状」，不是「OpenAI 接受它」——见文件头。"""
    p = provider("ok", content="ok")
    _pin(monkeypatch, OPENAI_API_KEY="dummy-oa", AVERY_OPENAI_BASE_URL=p.url)

    _respond_once(brain_factory.make_brain(None, "openai"))

    assert len(p.requests) == 1
    body = p.requests[0]
    assert "max_completion_tokens" in body, "OpenAI 推理模型只认这个名字"
    assert "max_tokens" not in body, "旧名字发过去就是 400"
    assert "temperature" not in body, "显式 temperature 在推理模型上是 400（默认值以外不接受）"


def test_domestic_providers_keep_the_old_request_shape(monkeypatch, provider):
    """GUARD THE GUARD：上一条的新形状**不许**漏到境内两家身上。MiniMax/DeepSeek 只认
    `max_tokens`，也一直靠 temperature=0 拿确定性——它们今天的请求一个字节都不该变。"""
    p = provider("ok", content="ok")
    _pin(monkeypatch, MINIMAX_API_KEY="dummy-mm", MINIMAX_BASE_URL=p.url)

    _respond_once(brain_factory.make_brain(None, "minimax"))

    body = p.requests[0]
    assert "max_tokens" in body and "max_completion_tokens" not in body
    assert body["temperature"] == 0


def test_empty_tool_list_is_omitted_entirely(monkeypatch, provider):
    """抽取走的就是 tools=[]（llm_extract._call_once）。境内两家收下空数组不吭声，OpenAI 官方把它
    当 400（Invalid 'tools': empty array）。空数组和不给本来就是一回事。"""
    p = provider("ok", content="ok")
    _pin(monkeypatch, OPENAI_API_KEY="dummy-oa", AVERY_OPENAI_BASE_URL=p.url)

    _respond_once(brain_factory.make_brain(None, "openai"), tools=[])

    assert "tools" not in p.requests[0], "空工具列表必须整个不发"


def test_non_empty_tools_are_still_sent(monkeypatch, provider):
    """对照组：省略只针对空列表——真有工具时 /advise 的整个 agentic loop 靠它。"""
    p = provider("ok", content="ok")
    _pin(monkeypatch, OPENAI_API_KEY="dummy-oa", AVERY_OPENAI_BASE_URL=p.url)

    _respond_once(brain_factory.make_brain(None, "openai"),
                  tools=[{"name": "recall", "description": "d", "input_schema": {"type": "object"}}])

    sent = p.requests[0]["tools"]
    assert [t["function"]["name"] for t in sent] == ["recall"]


def test_reasoning_effort_is_sent_only_when_configured(monkeypatch, provider):
    p = provider("ok", content="ok")
    _pin(monkeypatch, OPENAI_API_KEY="dummy-oa", AVERY_OPENAI_BASE_URL=p.url)
    _respond_once(brain_factory.make_brain(None, "openai"))
    assert "reasoning_effort" not in p.requests[0], "未配置就不发（兼容端点见到未知参数会报错）"

    monkeypatch.setenv("AVERY_OPENAI_REASONING_EFFORT", "low")
    _respond_once(brain_factory.make_brain(None, "openai"))
    assert p.requests[1]["reasoning_effort"] == "low"


def test_token_param_escape_hatch_for_third_party_compat_endpoints(monkeypatch, provider):
    """`openai-compat` 仍是「任意兼容端点」的逃生口：只认老参数名的那些家，一个 env 拧回去。"""
    p = provider("ok", content="ok")
    _pin(monkeypatch, OPENAI_API_KEY="dummy-oa", AVERY_OPENAI_BASE_URL=p.url,
         AVERY_OPENAI_TOKEN_PARAM="max_tokens", AVERY_OPENAI_TEMPERATURE="0")

    _respond_once(brain_factory.make_brain(None, "compat"))

    body = p.requests[0]
    assert "max_tokens" in body and "max_completion_tokens" not in body
    assert body["temperature"] == 0


# ══════════════════════════════════════════════════════════════════════════════════════════════
# 3 · 输出预算耗尽 = 错误，不是一句空答复
# ══════════════════════════════════════════════════════════════════════════════════════════════

def test_reasoning_eats_the_whole_budget_raises_instead_of_answering_empty(monkeypatch, provider):
    """MiniMax 的 <think> 占 max_tokens 那个老坑，在 OpenAI 上以不可见的 reasoning tokens 重演。
    此时返回空字符串是无声的谎：/advise 会把空串当最终答案发出去，抽取会当成「这份文档没有实体」。"""
    p = provider("truncated")
    _pin(monkeypatch, OPENAI_API_KEY="dummy-oa", AVERY_OPENAI_BASE_URL=p.url)

    with pytest.raises(RuntimeError, match="output ceiling"):
        _respond_once(brain_factory.make_brain(None, "openai"))


def test_truncated_but_non_empty_answer_is_not_treated_as_an_error(monkeypatch, provider):
    """对照组（防尺子太宽）：finish_reason='length' 但**有正文**是正常的长回答被切尾，
    既有的 JSON 解析/降级路径接手，不该在这一层炸掉。"""
    p = provider("clipped", content="半句话")
    _pin(monkeypatch, OPENAI_API_KEY="dummy-oa", AVERY_OPENAI_BASE_URL=p.url)

    assert _respond_once(brain_factory.make_brain(None, "openai")).text == "半句话"


def test_the_truncation_error_is_recorded_as_a_provider_failure(monkeypatch, provider):
    """抛出来之后要能在 /health 上看见（#89 的 providers 遥测就长在 FallbackBrain 这一层）。"""
    p = provider("truncated")
    _pin(monkeypatch, OPENAI_API_KEY="dummy-oa", AVERY_OPENAI_BASE_URL=p.url)

    with pytest.raises(RuntimeError):
        _respond_once(brain_factory.make_brain(None, "openai"))

    assert failover.snapshot()["openai"]["ok"] is False


# ══════════════════════════════════════════════════════════════════════════════════════════════
# 4 · 链的组装 + 🔴 合规反向闸（热备只在同 region 内发生）
# ══════════════════════════════════════════════════════════════════════════════════════════════

def test_openai_key_alone_arms_llm_extraction(monkeypatch):
    """改动前这里是 []（`_EXTRACTION_BRAINS` 硬编码只认境内两家，OpenAI 进不了 /ingest）。"""
    _pin(monkeypatch, OPENAI_API_KEY="dummy-oa")
    assert extractor_factory.extraction_chain() == ["openai"]
    assert extractor_factory.active_extractor() == "llm:openai"


def test_extraction_never_fails_over_from_openai_to_a_chinese_provider(monkeypatch):
    """🔴 合规反向闸。欧盟实例的一线纪律是 env 里根本没有中国 key + FAILOVER=off；这条钉的是
    第二把锁：万一有人把一把 MINIMAX_API_KEY 落在欧盟箱子上、又忘了关 failover，欧盟客户的
    花名册也不许被 failover 送去境内供应商。"""
    _pin(monkeypatch, OPENAI_API_KEY="dummy-oa", MINIMAX_API_KEY="dummy-mm",
         DEEPSEEK_API_KEY="dummy-ds", AVERY_EXTRACTOR_BRAIN="openai")
    assert brain_factory.failover_enabled(), "前提：这条测的是 failover **开着**时的行为"

    assert extractor_factory.extraction_chain() == ["openai"]


def test_the_failover_machinery_is_actually_armed_in_that_same_env(monkeypatch):
    """GUARD THE GUARD：上一条若因为「热备根本没开」而绿，就是一条空真判据。同一份 env、
    只把主脑换成境内那家，链必须真的长出第二家。"""
    _pin(monkeypatch, OPENAI_API_KEY="dummy-oa", MINIMAX_API_KEY="dummy-mm",
         DEEPSEEK_API_KEY="dummy-ds", AVERY_EXTRACTOR_BRAIN="minimax")
    assert extractor_factory.extraction_chain() == ["minimax", "deepseek"]


def test_domestic_extraction_never_fails_over_out_to_openai_either(monkeypatch):
    """合规是单向的，反过来也别糊：境内箱子上挂了 OpenAI key，境内抽取也不许溢出去。"""
    _pin(monkeypatch, MINIMAX_API_KEY="dummy-mm", OPENAI_API_KEY="dummy-oa")
    assert extractor_factory.extraction_chain() == ["minimax"]


def test_openai_is_last_in_the_auto_pick_order(monkeypatch):
    """给境内箱子加一把 OpenAI key（对比测试）不许掉换主脑——存量生产是 M3 主。"""
    _pin(monkeypatch, MINIMAX_API_KEY="dummy-mm", OPENAI_API_KEY="dummy-oa")
    assert extractor_factory.active_extractor() == "llm:minimax"


def test_forced_heuristic_still_beats_an_openai_key(monkeypatch):
    _pin(monkeypatch, OPENAI_API_KEY="dummy-oa", AVERY_EXTRACTOR="heuristic")
    assert extractor_factory.extraction_chain() == []
    assert extractor_factory.active_extractor() == "heuristic"


def test_advise_chain_for_openai_is_a_chain_of_one(monkeypatch):
    _pin(monkeypatch, OPENAI_API_KEY="dummy-oa", MINIMAX_API_KEY="dummy-mm",
         DEEPSEEK_API_KEY="dummy-ds", AVERY_BRAIN="openai-compat")
    assert brain_factory.advise_chain() == ["openai"]


def test_hot_standby_pairs_never_cross_a_region(monkeypatch):
    """/advise 那半边的同一条合规性质，钉在数据上：`_PAIR` 里不许出现跨 region 的一对。
    （加一条 `"openai": "minimax"` 就会红——那正是欧盟实例的 /advise 出境事故。）"""
    for primary, standby in brain_factory._PAIR.items():
        assert brain_factory.PROVIDER_REGION[primary] == brain_factory.PROVIDER_REGION[standby], (
            f"{primary} 的热备 {standby} 跨了 region——欧盟/境内互为热备就是合规事故")


def test_every_extraction_provider_has_a_declared_region():
    """region 表漏一家 = extraction_chain 里 KeyError（或更糟，被当成同 region）。"""
    for kind in extractor_factory._EXTRACTION_BRAINS:
        assert kind in brain_factory.PROVIDER_REGION


@pytest.mark.parametrize("alias", ["openai", "openai-compat", "compat"])
def test_all_three_aliases_canonicalize_to_one_provider_label(monkeypatch, alias):
    """三个写法必须在 /health 的 providers 表里合成同一个 key——两个 key 指同一家供应商会让
    「到底谁坏了」当场失真。"""
    _pin(monkeypatch, AVERY_BRAIN=alias, OPENAI_API_KEY="dummy-oa")
    assert brain_factory.resolve_brain_kind() == "openai"
    assert brain_factory.advise_chain() == ["openai"]


# ══════════════════════════════════════════════════════════════════════════════════════════════
# 5 · 端到端：/ingest 真的走 OpenAI 那条链（本地假供应商），/health 不撒谎
# ══════════════════════════════════════════════════════════════════════════════════════════════

def _upload(client):
    files = [("files", ("市场部花名册.txt",
                        "姓名,角色\n王岚,市场部经理\n".encode("utf-8"), "text/plain"))]
    return client.post("/ingest", files=files)


def _drive_and_summary(client, body: dict) -> tuple[dict, dict]:
    from service import ingest_worker
    ingest_worker.run_pending_jobs()
    hdr = {"X-Avery-Token": body["owner_token"]}
    last = client.get(f"/team/{body['context_id']}/files", headers=hdr).json()["last_job"]
    team = client.get(f"/team/{body['context_id']}", headers=hdr).json()
    return last, team


def test_ingest_end_to_end_on_openai(monkeypatch, provider):
    """改动前 OpenAI 根本进不了 /ingest（`_EXTRACTION_BRAINS` 硬编码两家 → 落 heuristic）。"""
    from fastapi.testclient import TestClient
    from service.app import app
    p = provider("ok")
    _pin(monkeypatch, OPENAI_API_KEY="dummy-oa", AVERY_OPENAI_BASE_URL=p.url, AVERY_BRAIN="mock")
    monkeypatch.setenv("AVERY_EXTRACT_BACKOFF_S", "0")

    with TestClient(app) as c:
        r = _upload(c)
        assert r.status_code == 200
        last, team = _drive_and_summary(c, r.json())
        assert last["extraction_mode"] == "llm", "OpenAI 抽取成功了却报 degraded 就是在撒谎"
        assert [pp["name"] for pp in team["people"]] == ["王岚"], "人卡必须来自 OpenAI 那一路"
        h = c.get("/health").json()
        assert h["extraction_chain"] == ["openai"]
        assert h["providers"]["openai"]["ok"] is True
        assert h["extraction_mode"] == "llm"
        assert h["degraded"] is False
    assert p.requests, "假供应商一次都没被打到 = 这条 e2e 打了别处（真网络？）"


def test_ingest_extraction_call_carries_the_openai_shape(monkeypatch, provider):
    """抽取位与 advise 位是两个构造点（extractor_factory / brain_factory），形状要各自验：
    抽取的模型是抽取模型、预算是大预算、参数名是新名字、空 tools 不发。"""
    from fastapi.testclient import TestClient
    from service.app import app
    p = provider("ok")
    _pin(monkeypatch, OPENAI_API_KEY="dummy-oa", AVERY_OPENAI_BASE_URL=p.url, AVERY_BRAIN="mock")
    monkeypatch.setenv("AVERY_EXTRACT_BACKOFF_S", "0")

    with TestClient(app) as c:
        _drive_and_summary(c, _upload(c).json())

    body = p.requests[0]
    assert body["model"] == brain_mod.OPENAI_EXTRACT_MODEL
    assert body["max_completion_tokens"] == extractor_factory._OPENAI_EXTRACT_MAX_TOKENS
    assert "max_tokens" not in body and "temperature" not in body
    assert "tools" not in body


def test_ingest_degrades_honestly_when_openai_is_the_only_provider_and_it_429s(
        monkeypatch, provider):
    from fastapi.testclient import TestClient
    from service.app import app
    p = provider("quota")
    _pin(monkeypatch, OPENAI_API_KEY="dummy-oa", AVERY_OPENAI_BASE_URL=p.url, AVERY_BRAIN="mock")
    monkeypatch.setenv("AVERY_EXTRACT_BACKOFF_S", "0")

    with TestClient(app) as c:
        r = _upload(c)
        assert r.status_code == 200, "供应商 429 绝不许把上传本身弄失败"
        last, _team = _drive_and_summary(c, r.json())
        assert last["extraction_mode"] == "degraded"
        h = c.get("/health").json()
        assert h["providers"]["openai"]["ok"] is False
        assert h["degraded"] is True
    assert p.requests


# ══════════════════════════════════════════════════════════════════════════════════════════════
# 6 · Embedding：text-embedding-3-small @1024 维，落在既有的 vector(1024) 列上
# ══════════════════════════════════════════════════════════════════════════════════════════════

class _FakeEmbedHTTP:
    """替掉 urllib.request.urlopen：按请求里的 dimensions 回 **非归一化** 的向量并记录请求体。
    非归一化是故意的——归一化这一步要真被验到（余弦当点积算的前提就是它）。"""

    def __init__(self):
        self.requests: list[dict] = []

    def __call__(self, req, timeout=None):
        body = json.loads(req.data.decode("utf-8"))
        self.requests.append({**body, "_url": req.full_url})
        dim = body["dimensions"]
        payload = {"data": [{"index": i, "embedding": [3.0, 4.0] + [0.0] * (dim - 2)}
                            for i in range(len(body["input"]))]}

        class _Resp:
            def __enter__(self):
                return self

            def __exit__(self, *a):
                return False

            def read(self):
                return json.dumps(payload).encode("utf-8")
        return _Resp()


@pytest.fixture()
def fake_embed_http(monkeypatch):
    http = _FakeEmbedHTTP()
    monkeypatch.setattr(emb_mod.urllib.request, "urlopen", http)
    emb_mod.install_spend_gate(llm_budget.embed_spend_gate)
    yield http


def test_openai_embeddings_kind_builds_the_openai_embedder(monkeypatch):
    _pin(monkeypatch, AVERY_EMBEDDINGS="openai", OPENAI_API_KEY="dummy-oa")
    e = emb_mod.make_embedder_from_env()
    assert isinstance(e, emb_mod.OpenAIEmbedder)
    assert e.name == "openai:text-embedding-3-small/1024"
    assert e.base_url.startswith("https://api.openai.com")


def test_openai_embeddings_without_a_key_degrade_to_keyword_not_a_crash(monkeypatch):
    """落回必须是**静默的 keyword**，不是异常：一把轮换掉的 key 不许弄坏一次 advise。"""
    _pin(monkeypatch, AVERY_EMBEDDINGS="openai")
    assert emb_mod.make_embedder_from_env() is None


def test_dashscope_routing_is_untouched(monkeypatch):
    """GUARD THE GUARD：加第二家不许动第一家的路由（境内生产今天就跑在这条上）。"""
    _pin(monkeypatch, AVERY_EMBEDDINGS="dashscope", DASHSCOPE_API_KEY="dummy-ds")
    e = emb_mod.make_embedder_from_env()
    assert isinstance(e, emb_mod.DashScopeEmbedder)
    assert e.name == "dashscope:text-embedding-v4/1024"


def test_unknown_embeddings_kind_still_falls_back_to_keyword(monkeypatch):
    _pin(monkeypatch, AVERY_EMBEDDINGS="opanai", OPENAI_API_KEY="dummy-oa")   # 手滑一个字母
    assert emb_mod.make_embedder_from_env() is None


def test_openai_embed_request_asks_for_1024_dims_and_normalizes(monkeypatch, fake_embed_http):
    _pin(monkeypatch, AVERY_EMBEDDINGS="openai", OPENAI_API_KEY="dummy-oa")
    vecs = emb_mod.make_embedder_from_env().embed(["一行事实", "another line"])

    sent = fake_embed_http.requests[0]
    assert sent["model"] == "text-embedding-3-small"
    assert sent["dimensions"] == 1024, "维度不是 1024 就落不进 avery.materials.embedding 那根列"
    assert sent["_url"].startswith("https://api.openai.com")
    assert [len(v) for v in vecs] == [1024, 1024]
    # [3,4,0...] 的模是 5 → 归一化后必须是 [0.6, 0.8, 0...]
    assert vecs[0][0] == pytest.approx(0.6) and vecs[0][1] == pytest.approx(0.8)


def test_openai_embed_dim_matches_the_live_vector_column():
    """期望值取**独立地面真值**（迁移 DDL 本身），不是代码里那个常量——尺子不许长在被量的
    东西上。1024 这个数是本票「不改 schema、不写迁移」的全部依据。"""
    ddl = (HERE / "db" / "migrations" / "0001_avery_persistence.sql").read_text(encoding="utf-8")
    m = re.search(r"embedding\s+vector\((\d+)\)", ddl)
    assert m, "迁移里找不到 embedding vector(N) 列——这条判据够不着东西了，先修判据"
    assert emb_mod.OPENAI_EMBED_DIM == int(m.group(1))


def test_openai_embed_batches_and_charges_the_embed_budget_per_batch(monkeypatch,
                                                                    fake_embed_http):
    _pin(monkeypatch, AVERY_EMBEDDINGS="openai", OPENAI_API_KEY="dummy-oa")
    monkeypatch.setenv("AVERY_EMBED_CALL_BUDGET", "10")
    llm_budget.reset()

    vecs = emb_mod.make_embedder_from_env().embed([f"line {i}" for i in range(130)])

    assert len(vecs) == 130
    assert len(fake_embed_http.requests) == 3, "130 条 / 每批 64 = 3 批"
    assert llm_budget.embed_used() == 3, "每一批可计费请求都要走花钱闸（0805 走查那道）"
    assert llm_budget.used() == 0, "embedding 不许吃掉 chat 的那个计数器"


def test_openai_embed_refuses_the_batch_once_the_budget_is_spent(monkeypatch, fake_embed_http):
    _pin(monkeypatch, AVERY_EMBEDDINGS="openai", OPENAI_API_KEY="dummy-oa")
    monkeypatch.setenv("AVERY_EMBED_CALL_BUDGET", "1")
    llm_budget.reset()
    llm_budget.charge_embed(1)

    with pytest.raises(llm_budget.EmbedBudgetExceeded):
        emb_mod.make_embedder_from_env().embed(["one more"])
    assert fake_embed_http.requests == [], "花钱闸必须挡在可计费请求**之前**"


def test_openai_embed_orders_rows_by_index(monkeypatch, fake_embed_http):
    """API 不保证按输入顺序回——按 .index 排序这件事在第二家身上同样得成立。"""
    _pin(monkeypatch, AVERY_EMBEDDINGS="openai", OPENAI_API_KEY="dummy-oa")

    def _shuffled(req, timeout=None):
        body = json.loads(req.data.decode("utf-8"))
        rows = [{"index": i, "embedding": [float(i + 1)] + [0.0] * (body["dimensions"] - 1)}
                for i in range(len(body["input"]))]

        class _Resp:
            def __enter__(self):
                return self

            def __exit__(self, *a):
                return False

            def read(self):
                return json.dumps({"data": list(reversed(rows))}).encode("utf-8")
        return _Resp()

    monkeypatch.setattr(emb_mod.urllib.request, "urlopen", _shuffled)
    vecs = emb_mod.make_embedder_from_env().embed(["a", "b", "c"])
    assert [v[0] for v in vecs] == [1.0, 1.0, 1.0]   # 归一化后各自是 [1,0,...]，顺序没错位


# ══════════════════════════════════════════════════════════════════════════════════════════════
# 7 · 配置文档同步闸（防「填了却静默不生效」的既有坑型）
# ══════════════════════════════════════════════════════════════════════════════════════════════

SERVICE_ENV_EXAMPLE = HERE / "service" / ".env.example"
RUNBOOK = REPO / "docs" / "deploy" / "dual-deploy-runbook.md"


def _openai_env_names_read_by_code() -> set[str]:
    names: set[str] = set()
    for root in (HERE / "service", HERE / "avery"):
        for py in root.rglob("*.py"):
            names |= set(re.findall(r"AVERY_OPENAI_[A-Z_]+", py.read_text(encoding="utf-8")))
    return names


def test_every_openai_env_var_the_code_reads_is_documented():
    """本仓的既有坑型：一个能生效的 env 变量没进模板 = 运维照着模板配，配不出来那条路。
    这条闸是自扫描的（不是手抄清单），以后加新旋钮它会自己跟上。"""
    names = _openai_env_names_read_by_code()
    assert len(names) >= 5, f"扫不到 AVERY_OPENAI_* 变量了（实得 {names}）——判据够不着东西，先修判据"
    text = SERVICE_ENV_EXAMPLE.read_text(encoding="utf-8")
    missing = sorted(n for n in names if n not in text)
    assert not missing, f"这些 env 代码里读、模板里没有：{missing}（填了也不知道该填哪个）"


def test_the_runbook_carries_the_eu_isolation_discipline():
    """欧盟实例的三条纪律是**部署配置**，代码里没有它们的落点——只能钉在 runbook 上。
    真丢了的话，第一次尽调问「你们怎么保证欧盟数据不出境」就没有答法。"""
    text = RUNBOOK.read_text(encoding="utf-8")
    for needle in ("AVERY_BRAIN_FAILOVER=off",        # OpenAI 无热备对家，且绝不回落境内
                   "AVERY_ALLOW_PERSON_SCORING=0",    # AI Act Annex III 4(b) 的定性边界
                   "text-embedding-3-small",          # embedding 也得换家，不然出境点只堵了两个
                   "OPENAI_API_KEY"):
        assert needle in text, f"runbook 缺 {needle!r}——欧盟部署那一列不完整"
