# -*- coding: utf-8 -*-
"""fixD/M5 — a malformed owner_token must land on 404, never on a 500.

WHY THIS IS A RED LINE, not a cosmetic error-handling nit
--------------------------------------------------------
feat-038 spent its whole design budget on ONE property: a caller who cannot prove ownership learns
NOTHING about whether a context_id exists. Unknown id and wrong token return the SAME opaque 404 —
deliberately no 403, because a 403 would confirm "this id is real, you just lack the key".

`secrets.compare_digest` refuses to compare `str`s that contain non-ASCII characters — it raises
`TypeError: comparing strings with non-ASCII characters is not supported`. That exception escaped
`authorize_context` uncaught, so FastAPI turned it into a 500. And a 500 only happens AFTER
`reg.get(context_id)` returned a context and `required` was found non-empty — i.e. **only for a
context_id that really exists**. An unknown id short-circuits to 404 before the compare is ever
reached. So the status code itself became the enumeration oracle feat-038 exists to deny:

    GET /team/<real-id>     X-Avery-Token: <one non-ASCII char>   -> 500   ("this id exists")
    GET /team/<random-id>   X-Avery-Token: <one non-ASCII char>   -> 404   ("this id does not")

Every protected read is affected, because they all funnel through `authorize_context`:
/team, /team/*/notes, /team/*/files, /team/*/files/{idx}, /advise, the whole of ask_api, and
/account/claim (whose token arrives in a JSON body, so it carries arbitrary Unicode directly —
not even latin-1-constrained like a header).

WHAT THIS SUITE PINS
  * four malformed token shapes (non-ASCII, over-long, empty, control chars) -> 404 on EVERY read;
  * the discriminator test: for the SAME malformed token, a real id and an unknown id must produce
    an IDENTICAL status AND an identical body — the oracle closed at the observable level;
  * a valid token still works (the fix must not fail closed on the happy path);
  * `authorize_context` called directly raises HTTPException(404), never TypeError.

Offline: mock brain, keyword recall, heuristic extractor, no DB — same fixture shape as
test_tenant_isolation_http.py.
"""
from __future__ import annotations

import json
from pathlib import Path

import pytest

pytest.importorskip("fastapi.testclient")
from fastapi import HTTPException  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

HERE = Path(__file__).resolve().parent.parent
FIX = HERE / "tests" / "fixtures" / "ingest"
HANDBOOK = FIX / "Studio_Handbook.md"
ROSTER = FIX / "Team_Roster.xlsx"

# The malformed shapes the brief names. Each is a token a hostile (or merely confused) caller can
# send today; none of them may ever produce anything other than a 404.
#
# 🔴 The CJK cases use REAL Han characters, not pinyin — the "all-ASCII corpus" blind spot bit this
# repo once already (memory: gate-corpus-all-ascii-blindspot). Pinyin would have passed on the OLD
# code and proved nothing, because pinyin IS ASCII and compare_digest accepts it happily.
MALFORMED_TOKENS: list[tuple[str, str]] = [
    ("cjk", "令牌中文"),                       # non-ASCII, CJK — the headline case
    ("latin1-accent", "café-token"),           # non-ASCII, single accented char (latin-1 range)
    ("emoji", "tok🔑en"),                       # non-ASCII, astral plane
    ("nfkc-lookalike", "ｔｏｋｅｎ"),            # full-width ASCII lookalikes — non-ASCII code points
    ("over-long", "A" * 100_000),              # 100 KB of ASCII
    ("control-chars", "tok\x00\x07\x1ben"),    # NUL + BEL + ESC
    ("newline-injection", "tok\r\nen"),        # CR/LF (header-injection shaped)
    ("whitespace-only", "   "),                # strips to empty -> extract_owner_token returns None
    ("lone-surrogate", "tok\ud800en"),         # unencodable in plain UTF-8; a JSON body can carry it
]

# Which of those can physically ride an HTTP HEADER.
#
# This split is load-bearing, not bookkeeping. A conforming client (httpx, and therefore TestClient)
# refuses to put a NUL / CR / LF / lone surrogate in a header value, so those shapes can only reach
# the gate through a JSON body (/account/claim) or a direct call. The NON-ASCII shapes are the
# opposite case and the reason this bug is live in production: httpx will not encode them as ASCII
# either, but the WIRE carries raw bytes, Starlette decodes a header as latin-1, and every byte
# >0x7F lands in the str as a non-ASCII code point. So we hand httpx the UTF-8 BYTES — exactly what
# `curl -H $'X-Avery-Token: \xe4\xbb\xa4'` puts on the wire. Passing the str would only prove that
# httpx has a client-side guard, which protects nobody from an attacker who is not using httpx.
HEADER_TRANSMISSIBLE = {"cjk", "latin1-accent", "emoji", "nfkc-lookalike",
                        "over-long", "whitespace-only"}
HEADER_TOKENS = [(lbl, tok) for lbl, tok in MALFORMED_TOKENS if lbl in HEADER_TRANSMISSIBLE]


def _hdr(token: str) -> bytes:
    """A header value as it actually travels: raw UTF-8 bytes, no client-side ASCII guard."""
    return token.encode("utf-8", "surrogatepass")


@pytest.fixture()
def client(monkeypatch):
    """Fully-offline app on the in-memory registry, regardless of a developer's .env."""
    monkeypatch.setenv("AVERY_BRAIN", "mock")
    monkeypatch.setenv("AVERY_EMBEDDINGS", "keyword")
    monkeypatch.setenv("AVERY_EXTRACTOR", "heuristic")
    monkeypatch.delenv("AVERY_DB_URL", raising=False)
    monkeypatch.delenv("PGVECTOR_URL", raising=False)
    monkeypatch.delenv("AVERY_ALLOW_PERSON_SCORING", raising=False)
    from avery.ingest.registry import REGISTRY
    REGISTRY.clear()
    from service.app import app
    with TestClient(app) as c:
        yield c
    REGISTRY.clear()


def _ingest(client) -> tuple[str, str]:
    files = [("files", (p.name, p.read_bytes(), "application/octet-stream"))
             for p in (HANDBOOK, ROSTER)]
    r = client.post("/ingest", files=files)
    assert r.status_code == 200, f"/ingest failed: {r.text[:300]}"
    body = r.json()
    return body["context_id"], body["owner_token"]


def _read_paths(cid: str) -> list[tuple[str, str, dict | None]]:
    """Every gated READ on context `cid` — the full blast radius of authorize_context."""
    return [
        ("GET", f"/team/{cid}", None),
        ("GET", f"/team/{cid}/notes", None),
        ("GET", f"/team/{cid}/files", None),
        ("GET", f"/team/{cid}/files/0", None),
        ("POST", "/advise", {"situation": "List everyone and what they own.",
                             "company_context_id": cid, "stream": False}),
    ]


def _do(client, method: str, url: str, body, headers=None):
    if method == "GET":
        return client.get(url, headers=headers or {})
    return client.post(url, json=body, headers=headers or {})


# ── 1 · every malformed token shape -> 404 on every protected read ───────────────────────────────

@pytest.mark.parametrize("label,token", HEADER_TOKENS, ids=[t[0] for t in HEADER_TOKENS])
def test_malformed_token_is_404_on_every_read(client, label, token):
    """The core assertion. On the pre-fix code the non-ASCII rows raise TypeError inside
    authorize_context -> 500, which is BOTH a crash and an existence oracle."""
    cid, _good = _ingest(client)
    for method, url, body in _read_paths(cid):
        r = _do(client, method, url, body, headers={"X-Avery-Token": _hdr(token)})
        assert r.status_code == 404, (
            f"[{label}] {method} {url} -> {r.status_code} (expected 404). "
            f"body={r.text[:200]}"
        )


@pytest.mark.parametrize("label,token", HEADER_TOKENS, ids=[t[0] for t in HEADER_TOKENS])
def test_malformed_bearer_token_is_404(client, label, token):
    """Same shapes down the OTHER accepted header (Authorization: Bearer ...)."""
    cid, _good = _ingest(client)
    r = client.get(f"/team/{cid}", headers={"Authorization": b"Bearer " + _hdr(token)})
    assert r.status_code == 404, f"[{label}] bearer -> {r.status_code}: {r.text[:200]}"


# ── 2 · the oracle itself: real id and unknown id must be INDISTINGUISHABLE ───────────────────────

@pytest.mark.parametrize("label,token", HEADER_TOKENS, ids=[t[0] for t in HEADER_TOKENS])
def test_no_existence_oracle_under_malformed_token(client, label, token):
    """THE feat-038 property, restated for malformed tokens.

    A 500 on a real id next to a 404 on a bogus id tells an attacker exactly which context_ids are
    real — with no valid credential at all. Status AND body must match."""
    cid, _good = _ingest(client)
    bogus = "ctx_does_not_exist_zzzz"

    real = client.get(f"/team/{cid}", headers={"X-Avery-Token": _hdr(token)})
    fake = client.get(f"/team/{bogus}", headers={"X-Avery-Token": _hdr(token)})

    assert real.status_code == fake.status_code == 404, (
        f"[{label}] existence oracle: real id -> {real.status_code}, "
        f"unknown id -> {fake.status_code}"
    )
    # The bodies embed their own context_id (that is pre-existing feat-038 behavior and is fine —
    # the caller supplied that id), so compare the SHAPE, not the bytes.
    assert set(real.json()) == set(fake.json()), (
        f"[{label}] response shapes differ: {real.json()} vs {fake.json()}"
    )


# ── 3 · /account/claim — the token arrives in a JSON BODY (arbitrary Unicode, no latin-1 clamp) ───

# `lone-surrogate` is excluded here and ONLY here. It never reaches authorize_context at all:
# pydantic rejects it while parsing ClaimRequest, and FastAPI's stock validation-error handler then
# echoes the offending input back into the response, which starlette cannot UTF-8 encode -> 500.
# That is a DIFFERENT bug (an unrelated response-encoding hole), and measurably NOT an oracle —
# verified both a real and a bogus context_id return 500, so it reveals nothing about existence:
#     ctx_real_but_fake     -> 500
#     ctx_totally_bogus_zzz -> 500
# Fixing it means installing a RequestValidationError handler in service/app.py, which is outside
# this line's file boundary. Recorded in progress-fixD.md Notes + needsOtherFiles instead of being
# silently folded into an M5 assertion it does not belong to.
CLAIM_TOKENS = [(lbl, tok) for lbl, tok in MALFORMED_TOKENS if lbl != "lone-surrogate"]


@pytest.mark.parametrize("label,token", CLAIM_TOKENS, ids=[t[0] for t in CLAIM_TOKENS])
def test_claim_with_malformed_token_never_500s(client, label, token):
    """auth_api.claim passes the body's owner_token straight into authorize_context. A JSON body is
    not latin-1 constrained, so this is the most direct route to the crash. Whatever the account
    layer decides (401 when unconfigured, 404 when the token is wrong), it must never be a 500.

    Serialised by hand with `ensure_ascii=True` and posted as raw bytes rather than via `json=`:
    that is the only way a lone surrogate can be expressed on the wire (`\\ud800` as a JSON escape),
    and it is what any attacker's client would emit. httpx's `json=` helper encodes with
    ensure_ascii=False and would choke locally instead of exercising the server."""
    cid, _good = _ingest(client)
    body = json.dumps({"context_id": cid, "owner_token": token}, ensure_ascii=True).encode("ascii")
    r = client.post("/account/claim", content=body,
                    headers={"Content-Type": "application/json"})
    assert r.status_code != 500, f"[{label}] /account/claim -> 500: {r.text[:200]}"


# ── 4 · the happy path must still work (the fix must not fail closed) ─────────────────────────────

def test_valid_token_still_reads_everything(client):
    cid, good = _ingest(client)
    for method, url, body in _read_paths(cid):
        r = _do(client, method, url, body, headers={"X-Avery-Token": good})
        assert r.status_code == 200, f"{method} {url} with the REAL token -> {r.status_code}"


def test_wrong_but_wellformed_ascii_token_is_still_404(client):
    """Guard against over-correcting: the fix must not make the compare permissive. A perfectly
    well-formed ASCII token that simply is not the right one stays a 404."""
    cid, good = _ingest(client)
    for wrong in (good[:-1], good + "x", good.upper(), "not-the-token"):
        if wrong == good:
            continue
        r = client.get(f"/team/{cid}", headers={"X-Avery-Token": wrong})
        assert r.status_code == 404, f"wrong token {wrong[:12]}... -> {r.status_code}"


def test_tokens_match_unit(client):
    """`tokens_match` in isolation: exact match true, everything else false, nothing raises."""
    from service.ingest_api import tokens_match

    assert tokens_match("abc123", "abc123") is True
    assert tokens_match("abc123", "abc124") is False
    assert tokens_match("", "abc123") is False
    for _label, token in MALFORMED_TOKENS:
        assert tokens_match(token, "abc123") is False, f"{_label} matched a real token!"
    # Non-ASCII on the STORED side too (a legacy/direct-inserted row) must not raise either.
    assert tokens_match("令牌中文", "令牌中文") is True
    assert tokens_match("abc123", "令牌中文") is False


# ── 5 · unit level: authorize_context raises HTTPException(404), never TypeError ──────────────────

@pytest.mark.parametrize("label,token", MALFORMED_TOKENS, ids=[t[0] for t in MALFORMED_TOKENS])
def test_authorize_context_raises_404_not_typeerror(client, label, token):
    """Called directly, below HTTP: the failure must be a well-formed 404, not a leaked TypeError.
    Pinned separately because a future caller might not sit behind FastAPI's exception handler."""
    from avery.ingest.registry import active_registry
    from service.ingest_api import authorize_context

    cid, _good = _ingest(client)
    reg = active_registry()
    with pytest.raises(HTTPException) as exc:
        authorize_context(reg, cid, token)
    assert exc.value.status_code == 404, f"[{label}] status {exc.value.status_code}"


def test_authorize_context_accepts_the_real_token(client):
    from avery.ingest.registry import active_registry
    from service.ingest_api import authorize_context

    cid, good = _ingest(client)
    assert authorize_context(active_registry(), cid, good).context_id == cid
