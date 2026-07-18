"""feat-053 — the account seam: verify a Supabase access token, get back a user id.

WHY NOT VERIFY THE JWT LOCALLY (Danny: 不造轮子): Supabase signs access tokens with HS256 (legacy
projects, shared JWT secret) OR with an asymmetric key served from JWKS (current projects, rotatable)
— and which one a project uses can CHANGE under us. Verifying locally means shipping a JWT library,
pinning an algorithm, and owning key rotation, all to re-derive an answer Supabase will give us
directly. So we ASK Supabase: `GET {SUPABASE_URL}/auth/v1/user` with the caller's token. It returns
200 + the user only for a token that is validly signed, unexpired, and not revoked (a locally-verified
JWT would still say "valid" for a signed-out or deleted user until expiry). One dependency: httpx,
already a declared runtime dep.

THE COST is a network hop per authenticated request, so verified tokens are cached in-process for
`_CACHE_TTL_S` seconds. The cache is keyed by a SHA-256 of the token (the raw credential is never
held as a dict key, never logged) and holds only `user_id` — never the token, never the email.
A cached entry does NOT outlive the token: the TTL is capped by the token's own `exp`, read out of
the JWT payload WITHOUT verifying it (see `_unverified_exp` for why that is safe). Note `exp` comes
from the token, not from the /auth/v1/user response — that endpoint returns the user object, which
carries no expiry.

FAIL CLOSED, ALWAYS. Unconfigured service, unreachable Supabase, timeout, malformed body, non-200 —
every one of them returns None, which the callers turn into "no account" and fall through to the
UNCHANGED feat-038 owner_token path. A verification outage can therefore never silently GRANT access
(the worst it does is make an account-only caller look anonymous), and it can never take the guest
path down.

🔴 The access token is a CREDENTIAL: header-only (X-Avery-Account), never a URL param, never logged,
never persisted server-side, and never echoed back in a response body.
"""
from __future__ import annotations

import base64
import hashlib
import json
import os
import threading
import time

# How long a verified token is trusted without re-asking Supabase. Short enough that a sign-out or a
# deleted user stops working promptly; long enough that a burst of reads costs one round trip.
_CACHE_TTL_S = 60.0
_HTTP_TIMEOUT_S = 5.0
ACCOUNT_HEADER = "X-Avery-Account"

_cache: dict[str, tuple[str, float]] = {}   # sha256(token) -> (user_id, expires_at_monotonic)
_cache_lock = threading.Lock()


def supabase_url() -> str | None:
    """The Supabase project URL (e.g. https://<ref>.supabase.co). Unset -> accounts are OFF."""
    return (os.environ.get("SUPABASE_URL") or "").strip().rstrip("/") or None


def supabase_anon_key() -> str | None:
    """The project's anon/publishable key. Supabase's auth endpoint requires an `apikey` header even
    when the caller already presents a user token. This key is PUBLISHABLE by design (it ships in the
    browser bundle) — it is not a secret, and it grants nothing on its own."""
    return (os.environ.get("SUPABASE_ANON_KEY") or "").strip() or None


def auth_configured() -> bool:
    """True when this service can verify account tokens at all. False -> the whole account layer is
    dormant and every caller is anonymous (the guest path, which must ALWAYS keep working)."""
    return bool(supabase_url() and supabase_anon_key())


def extract_account_token(x_avery_account: str | None) -> str | None:
    """Pull the Supabase access token out of the `X-Avery-Account` header, tolerating an optional
    `Bearer ` prefix. Header-only by design — this function never looks at the URL.

    Deliberately NOT `Authorization: Bearer`: that header is already claimed by feat-038's
    owner_token, and overloading one header with two different credentials means a caller presenting
    one gets silently checked as the other. Separate credentials, separate headers.
    """
    if not x_avery_account:
        return None
    raw = x_avery_account.strip()
    if not raw:
        return None
    parts = raw.split(None, 1)
    if parts[0].lower() == "bearer":
        # `Bearer <token>` -> the token; a bare `Bearer` (no token) is malformed, NOT a token called
        # "Bearer" — returning the scheme word would ship a garbage credential to Supabase.
        return parts[1].strip() or None if len(parts) == 2 else None
    return raw


def _cache_key(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def _cache_get(token: str) -> str | None:
    key = _cache_key(token)
    now = time.monotonic()
    with _cache_lock:
        hit = _cache.get(key)
        if hit is None:
            return None
        user_id, expires_at = hit
        if now >= expires_at:
            _cache.pop(key, None)
            return None
        return user_id


def _cache_put(token: str, user_id: str, ttl_s: float) -> None:
    if ttl_s <= 0:
        return
    with _cache_lock:
        # Bounded: this is a per-process cache on a single-worker box, but an attacker spraying
        # random tokens must never grow it without limit. Only VERIFIED tokens land here (a failed
        # verification is never cached), so the bound is a belt-and-suspenders memory guard.
        if len(_cache) > 512:
            _cache.clear()
        _cache[_cache_key(token)] = (user_id, time.monotonic() + ttl_s)


def reset_cache() -> None:
    """Drop every cached verification. Test seam; also the thing to call if keys are rotated."""
    with _cache_lock:
        _cache.clear()


def _unverified_exp(token: str) -> float | None:
    """Read `exp` (unix seconds) out of a JWT payload WITHOUT verifying the signature. None if the
    token is not a JWT, is malformed, or carries no numeric `exp`.

    WHY IT IS SAFE NOT TO VERIFY: this number is only ever used to make a cache entry SHORTER, never
    to grant anything. Supabase has already said yes to this exact token by the time we call this. A
    forged or garbage `exp` can only make us re-ask Supabase sooner (costs a round trip); it can
    never extend trust. Verifying the signature here would drag in exactly the JWT library and key
    rotation that the module docstring explains we refuse to own.

    WHY IT IS NEEDED: without it a token with two seconds of life left would be cached for the full
    `_CACHE_TTL_S`, so an expired credential keeps authorizing reads for the rest of that window.
    """
    try:
        parts = token.split(".")
        if len(parts) != 3:
            return None
        payload = parts[1]
        payload += "=" * (-len(payload) % 4)   # base64url in JWTs is unpadded
        claims = json.loads(base64.urlsafe_b64decode(payload.encode("ascii")))
        exp = claims.get("exp") if isinstance(claims, dict) else None
        # bool is an int subclass — `exp: true` is not an expiry.
        if isinstance(exp, bool) or not isinstance(exp, (int, float)):
            return None
        return float(exp)
    except Exception:
        return None


def _cache_ttl_for(token: str) -> float:
    """How long this verified token may be trusted without re-asking: the flat TTL, capped by the
    token's own remaining lifetime. Returns <= 0 for an already-expired token, which `_cache_put`
    declines to store (so the next request re-asks Supabase and gets the honest answer)."""
    exp = _unverified_exp(token)
    if exp is None:
        return _CACHE_TTL_S   # not a JWT / no exp — fall back to the flat window
    return min(_CACHE_TTL_S, exp - time.time())


def verify_access_token(token: str | None) -> str | None:
    """The Supabase access token -> that user's id (the JWT `sub`), or None.

    None means "treat this caller as anonymous" for EVERY failure mode — unconfigured, unreachable,
    timed out, 4xx, malformed. Callers must never distinguish these; they all fall through to the
    owner_token path. Never raises.
    """
    if not token:
        return None
    base = supabase_url()
    anon = supabase_anon_key()
    if not base or not anon:
        return None

    cached = _cache_get(token)
    if cached is not None:
        return cached

    try:
        import httpx   # declared runtime dep; imported here so an offline path never needs it
        resp = httpx.get(
            f"{base}/auth/v1/user",
            headers={"Authorization": f"Bearer {token}", "apikey": anon},
            timeout=_HTTP_TIMEOUT_S,
        )
        if resp.status_code != 200:
            return None
        body = resp.json()
    except Exception:
        # Network error, timeout, TLS problem, non-JSON body — fail closed, stay quiet. This must not
        # raise into a request handler: a Supabase outage degrades accounts to guest, it does not 500.
        return None

    user_id = body.get("id") if isinstance(body, dict) else None
    if not isinstance(user_id, str) or not user_id.strip():
        return None
    user_id = user_id.strip()
    # Capped by the token's own `exp`: a token with 2s of life left is not trusted for 60s.
    # A non-positive TTL (already expired) is declined by _cache_put — we still answer THIS request
    # (Supabase just said the token is good), we simply refuse to remember that answer.
    _cache_put(token, user_id, _cache_ttl_for(token))
    return user_id


def resolve_account(x_avery_account: str | None) -> str | None:
    """Header in, user id (or None) out — the one call a request handler needs."""
    return verify_access_token(extract_account_token(x_avery_account))
