# -*- coding: utf-8 -*-
"""账号链路 E2E —— 注册 → 登录 → 建 context → 认领 → 双账号隔离，**第一次真跑**。

onboarding-accounts-0805 ⑤（ADR-0034 拍板 6）。

## 这条链此前从没被走通过（票 #44 的背景，逐条查过）

  · 后端 pytest 把 `verify_access_token` 整个 monkeypatch 掉 —— 证明的是"如果 Supabase 说这个
    人是 X"之后的逻辑，从没证明过真 token 会不会被认出来；
  · 两道前端门（verify-auth-capability / verify-auth-form）用假 key + page.route 拦网络 ——
    证明的是屏幕，一个字节都没到过 Supabase；
  · 新加的 verify-onboard-account 同款（假 key + 拦网络），证明的是向导第⑤步的五个分支；
  · `.issues/rich-align-0722/acceptance-2.md` 的人手签认框空到今天。

所以「真 token 能不能过后端的门」「两个真账号之间到底隔不隔离」这两件事，在本文件之前
**没有任何东西**证明过。2026-08-05 实测：生产 Supabase 项目 `auth.users` 有 **0 个用户**，
`avery.account_contexts` 有 **0 行**——从来没有人注册过，也从来没有人认领过。

## 凭据口径（拍板 6，条文在 roles.md）

约定前缀的一次性测试邮箱 `avery-e2e+<时间戳>@<域>` —— agent 可自动注册/登录/清理。
**除此之外的任何账号（Danny 的、客户的、来路不明的）仍然人手，agent 绝不代填。**
本文件的每一次删除都被 `_PREFIX` 硬过滤，删不到任何别的账号；写死在 `_assert_test_email`。

## 环境三件套（缺一即拒跑，不是缺一即降级）

  SUPABASE_URL / SUPABASE_ANON_KEY   真 Supabase（auth 用真的，这是本门存在的理由）
  AVERY_E2E_ADMIN_DB_URL             Supabase 的 Postgres —— 只干两件事：邮箱确认开着时
                                     确认测试户、跑完删测试户。没有它就**拒绝开跑**：
                                     造得出、删不掉的账号就是留尸，而留尸的是生产 auth 表。
                                     （service_role key 能干同样的事；这台机器上没有，
                                       所以走 DB 这条。要用 key 的话见文末「另一种跑法」。）
  AVERY_E2E_LOCAL_DB_URL             **本地** Postgres —— 后端把 context 与 account_contexts
                                     写在这里。🔴 绝不指生产库：票面明写「不往生产库写」。
  VERIFY_API                         本地后端（AVERY_BRAIN=mock）。**必须是回环地址**，
                                     硬校验；指向别处直接拒跑（防手滑打生产后端）。

## 怎么跑

1) 本地 pg（feat-030 起就在用的那台）：
   docker start avery-pg   # postgres://postgres:avery_local_dev@127.0.0.1:5433/postgres

2) 本地后端 —— auth 用真 Supabase、数据落本地 pg、脑子用 mock：
   cd eval-harness && AVERY_BRAIN=mock AVERY_EXTRACTOR=heuristic AVERY_EMBEDDINGS=keyword \
     AVERY_DB_URL=<本地pg> SUPABASE_URL=<真> SUPABASE_ANON_KEY=<真> \
     python -m uvicorn service.app:app --host 127.0.0.1 --port 8137

3) 本门：
   python .issues/onboarding-accounts-0805/verify-account-e2e.py
   自证（born-red）：加 --born-red —— 把隔离判据反过来写成"期望 200"，门必须变红。

🔴 **不进默认离线电池**（needs_keys 性质：真网络、真凭据、真账号）。run-battery 的 ROSTER
里没有它，也不该有——那份电池的前提是零花费零外网。
"""
from __future__ import annotations

import json
import os
import re
import sys
import time
import urllib.error
import urllib.request
import uuid
from urllib.parse import urlparse

# ── 凭据墙的执法点：所有测试账号必须长这样，删除也只删长这样的 ──────────────────────────
_PREFIX = "avery-e2e+"
_EMAIL_RE = re.compile(r"^avery-e2e\+[0-9a-z\-]+@[a-z0-9.\-]+$")

R: list[tuple[str, bool, str]] = []


def rec(name: str, ok: bool, detail: str = "") -> None:
    R.append((name, ok, detail))
    print(f"  [{'PASS' if ok else 'FAIL'}] {name}" + (f" — {detail}" if detail else ""))


def die(msg: str) -> "None":
    print(f"\n拒绝开跑：{msg}\n")
    sys.exit(2)


def _assert_test_email(email: str) -> str:
    """🔴 凭据墙。任何**创建或删除**账号的动作都要先过这一关。

    它不是防御性编程的客套：这个脚本手里握着一把能删 `auth.users` 任意行的钥匙，而拍板 6 给的
    口子只有「约定前缀的一次性测试邮箱」这一个。把闸门放在最靠近动作的地方，将来谁改这里的
    循环、谁加一条清理语句，都绕不过它。
    """
    if not _EMAIL_RE.match(email or ""):
        raise SystemExit(f"凭据墙：{email!r} 不是 {_PREFIX}… 形状的测试邮箱，拒绝操作")
    return email


# ── HTTP（只用 stdlib：这门要能在一台只有 python 的机器上跑）──────────────────────────────
def _req(method: str, url: str, *, headers: dict | None = None, data: bytes | None = None,
         timeout: float = 30.0) -> tuple[int, dict | str]:
    req = urllib.request.Request(url, data=data, method=method, headers=headers or {})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            raw = resp.read().decode("utf-8", "replace")
            status = resp.status
    except urllib.error.HTTPError as e:
        raw = e.read().decode("utf-8", "replace")
        status = e.code
    except Exception as e:  # 连不上也要有回执，不能把门打成崩溃
        return 0, f"{type(e).__name__}: {e}"
    try:
        return status, json.loads(raw)
    except json.JSONDecodeError:
        return status, raw


def _multipart(fields: dict[str, str]) -> tuple[bytes, str]:
    """最小 multipart 编码器（`tables` 是一个 JSON 字符串 part）。不引第三方库。"""
    boundary = "----averyE2E" + uuid.uuid4().hex
    out = bytearray()
    for name, value in fields.items():
        out += f"--{boundary}\r\n".encode()
        out += f'Content-Disposition: form-data; name="{name}"\r\n\r\n'.encode()
        out += value.encode("utf-8") + b"\r\n"
    out += f"--{boundary}--\r\n".encode()
    return bytes(out), f"multipart/form-data; boundary={boundary}"


# ── Supabase GoTrue（真的）────────────────────────────────────────────────────────────────
class Supa:
    def __init__(self, base: str, anon: str):
        self.base = base.rstrip("/")
        self.anon = anon

    def _h(self, extra: dict | None = None) -> dict:
        h = {"apikey": self.anon, "Content-Type": "application/json"}
        h.update(extra or {})
        return h

    def sign_up(self, email: str, password: str) -> tuple[int, dict | str]:
        _assert_test_email(email)
        return _req("POST", f"{self.base}/auth/v1/signup", headers=self._h(),
                    data=json.dumps({"email": email, "password": password}).encode())

    def sign_in(self, email: str, password: str) -> tuple[int, dict | str]:
        _assert_test_email(email)
        return _req("POST", f"{self.base}/auth/v1/token?grant_type=password", headers=self._h(),
                    data=json.dumps({"email": email, "password": password}).encode())

    def me(self, token: str) -> tuple[int, dict | str]:
        return _req("GET", f"{self.base}/auth/v1/user",
                    headers=self._h({"Authorization": f"Bearer {token}"}))


# ── 管理面（确认 / 清理）——走 Supabase 的 Postgres ────────────────────────────────────────
def admin_sql(db_url: str, query: str, params: tuple = ()) -> list[tuple]:
    import psycopg
    with psycopg.connect(db_url, connect_timeout=25) as conn:
        cur = conn.execute(query, params)
        try:
            return cur.fetchall()
        except psycopg.ProgrammingError:
            return []


def confirm_user(db_url: str, email: str) -> None:
    """邮箱确认开着时把测试户标成已确认。**只对测试前缀生效**（SQL 里再加一层 LIKE 过滤，
    与 Python 侧的凭据墙互为双保险——两道都写，是因为这条语句删/改的是生产 auth 表）。"""
    _assert_test_email(email)
    # 🔴 只写 `email_confirmed_at`。`auth.users.confirmed_at` 在 Supabase 上是**生成列**
    # （GENERATED ALWAYS，由 email/phone 两个确认时间推出来），写它会直接抛
    # `column "confirmed_at" can only be updated to DEFAULT`——本轮第一次跑就是这么红的。
    admin_sql(db_url,
              "update auth.users set email_confirmed_at = now() "
              "where email = %s and email like %s",
              (email, _PREFIX + "%"))


def admin_create_user(db_url: str, email: str, password: str) -> None:
    """直接在 auth 库里造一个**已确认**的测试户 —— 不发邮件，因此不吃邮件限流。

    🔴 为什么需要这条路（本轮实测撞出来的，不是预防性设计）：这个 Supabase 项目的邮箱确认是
    **开着**的，于是每次 `/auth/v1/signup` 都要发一封确认信，而内建 SMTP 的默认限额是每小时
    两封。票面要求本门「连跑两遍」× 每遍两个账号 = 四次注册，第二个账号当场吃 HTTP 429。

    票面给的解法是「用 service_role admin API 造已确认测试户（email_confirm: true）」——
    那个 key 不在这台机器上（生产容器里也只有 anon）。这里做的是**同一件事换一把钥匙**：
    admin API 的 `email_confirm:true` 在库里落的就是这几列。密码哈希交给 Postgres 的
    pgcrypto（`crypt(pw, gen_salt('bf'))`），与 GoTrue 自己写的 bcrypt 同格式——所以造出来的
    户能用**真的** `/auth/v1/token` 登录，登录链路仍然是真跑的，没有被绕过。

    代价如实记在这儿：这条路依赖 GoTrue 的表结构（auth.users + auth.identities）。哪天
    GoTrue 改了 schema，本函数会**炸**而不是静默错——插入失败会抛，不会造出一个登不进去的户。
    """
    _assert_test_email(email)
    # 🔴 那一串空串不是凑数（本轮实测：不写它们，登录直接 500
    # `Database error querying schema`）。GoTrue 是 Go 写的，把这些 varchar 列扫进**非指针**
    # 的 string 字段，列里是 NULL 就扫不动 —— 而 SQL 插入时不写的列默认就是 NULL。
    # admin API 走的是 GoTrue 自己的插入逻辑，它会把这些写成 ''，所以那条路没有这个坑；
    # 换成直接写库就必须把它补齐。
    admin_sql(db_url, """
        with new_user as (
          insert into auth.users
            (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
             raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
             confirmation_token, recovery_token, email_change_token_new, email_change,
             email_change_token_current, phone_change, phone_change_token, reauthentication_token)
          values
            ('00000000-0000-0000-0000-000000000000', gen_random_uuid(), 'authenticated',
             'authenticated', %s, extensions.crypt(%s, extensions.gen_salt('bf')), now(),
             '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now(),
             '', '', '', '', '', '', '', '')
          returning id, email
        )
        insert into auth.identities
          (provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
        select email, id,
               jsonb_build_object('sub', id::text, 'email', email, 'email_verified', true),
               'email', now(), now(), now()
        from new_user
    """, (email, password))


def purge_test_users(db_url: str) -> int:
    """删掉所有测试前缀的账号。**跑前跑后各一次**——跑前扫残留（上一次中途退出留下的尸），
    跑后清干净。幂等的定义就是这个：跑第二遍与跑第一遍看到的是同一个起点。"""
    rows = admin_sql(db_url,
                     "delete from auth.users where email like %s returning id",
                     (_PREFIX + "%",))
    return len(rows)


def count_test_users(db_url: str) -> int:
    return admin_sql(db_url, "select count(*) from auth.users where email like %s",
                     (_PREFIX + "%",))[0][0]


def local_sql(db_url: str, query: str, params: tuple = ()) -> list[tuple]:
    return admin_sql(db_url, query, params)


def ensure_test_user(supa: "Supa", admin_db: str, email: str, password: str) -> tuple[str, bool]:
    """备一个**可登录的已确认**测试账号。返回（走了哪条路, 邮箱确认是否开着）。

    先真走 `/auth/v1/signup`——那是产品里真实用户走的那条路，能走通就走通，顺便证明它活着。
    撞上发信限额（429）再退到 admin 造户。无论哪条路，**登录都用真的 GoTrue**，
    所以后面「真 token 过不过得了后端的门」这件事一步都没被绕开。
    """
    status, body = supa.sign_up(email, password)
    if status in (200, 201):
        confirmation_on = not (isinstance(body, dict) and body.get("access_token"))
        if confirmation_on:
            confirm_user(admin_db, email)
        return (f"signup HTTP {status}" + ("（+管理面确认）" if confirmation_on else "（注册即登录）"),
                confirmation_on)
    if status == 429:
        # 内建 SMTP 每小时两封，连跑两遍必撞。不是缺陷，是这个项目开着邮箱确认的必然结果。
        admin_create_user(admin_db, email, password)
        return "signup 429（发信限额）→ admin 造已确认户", True
    raise SystemExit(f"注册 {email} 失败：HTTP {status} {str(body)[:200]}")


# ── 主流程 ───────────────────────────────────────────────────────────────────────────────
def main(argv: list[str]) -> int:
    born_red = "--born-red" in argv

    supa_url = (os.environ.get("SUPABASE_URL") or "").strip()
    supa_anon = (os.environ.get("SUPABASE_ANON_KEY") or "").strip()
    admin_db = (os.environ.get("AVERY_E2E_ADMIN_DB_URL") or "").strip()
    local_db = (os.environ.get("AVERY_E2E_LOCAL_DB_URL") or "").strip()
    api = (os.environ.get("VERIFY_API") or "http://127.0.0.1:8137").rstrip("/")
    domain = (os.environ.get("AVERY_E2E_EMAIL_DOMAIN") or "dannyqian.com").strip()

    if not supa_url or not supa_anon:
        die("缺 SUPABASE_URL / SUPABASE_ANON_KEY —— 本门的全部意义就是打真 Supabase")
    if not admin_db:
        die("缺 AVERY_E2E_ADMIN_DB_URL —— 造得出、删不掉的测试账号就是往生产 auth 表里留尸。"
            "没有清理凭据就不许开跑（拍板 6 的口子含『并清理』三个字）")
    if not local_db:
        die("缺 AVERY_E2E_LOCAL_DB_URL —— 认领的绑定行要落在**本地**库里（票面：不往生产库写）")
    # 🔴 硬校验：后端必须是回环。手滑把 VERIFY_API 指成生产，就是拿真客户的库当靶场。
    host = (urlparse(api).hostname or "").lower()
    if host not in ("127.0.0.1", "localhost", "::1"):
        die(f"VERIFY_API 指向 {host!r} —— 本门只许打本地 mock 后端（票面：不打生产后端）")

    # 🔴 后端得是**这一份**后端。回环地址只挡住了"打到生产"，挡不住"打到隔壁 worktree 起的
    # 另一个 8137"——本轮实测踩到过：那台没配 Supabase env，`/account/status` 回 configured:false，
    # 于是所有账号判据要么恒红要么无意义，而门本身看起来跑得好好的。先问它一句再开跑。
    st, cfg = _req("GET", f"{api}/account/status")
    if st != 200 or not (isinstance(cfg, dict) and cfg.get("configured")):
        die(f"{api}/account/status 回的是 {st} {cfg} —— 这台后端没挂 Supabase env"
            "（或者它压根不是你以为的那一台）。带上 SUPABASE_URL/SUPABASE_ANON_KEY 重起它，"
            "或者换一个没被占用的端口")

    supa = Supa(supa_url, supa_anon)
    stamp = f"{int(time.time())}-{uuid.uuid4().hex[:6]}"
    email_a = _assert_test_email(f"{_PREFIX}{stamp}-a@{domain}")
    email_b = _assert_test_email(f"{_PREFIX}{stamp}-b@{domain}")
    password = "e2e-" + uuid.uuid4().hex   # 一次性、随机、不复用、不落盘

    print(f"═══ 账号链路 E2E · {stamp}{'（born-red 自证）' if born_red else ''} ═══")
    print(f"    supabase : {supa_url}")
    print(f"    backend  : {api}")
    print(f"    测试账号 : {email_a} / {email_b}")

    # ── 0 跑前扫残留（幂等的前半：上一次中途退出留下的尸，这一次开跑前先清）────────────
    leftovers = purge_test_users(admin_db)
    local_sql(local_db, "delete from avery.account_contexts where context_id like %s", ("ctx_e2e_%",))
    rec("0·跑前扫残留前缀（幂等的前半）", True, f"清掉 {leftovers} 个残留测试户")

    created: list[str] = []
    contexts: list[str] = []
    try:
        # ── 1 备好一个可登录的确认账号 A ──────────────────────────────────────────────
        # 🔴 **探测**而不是假设（票面原话：别假设配置）。三种世界都要能跑下去：
        #   · 邮箱确认关着 → signup 直接回 session；
        #   · 邮箱确认开着 → signup 回 user 无 session，管理面确认一下再登录；
        #   · 邮箱确认开着**且撞上发信限额**（内建 SMTP 每小时两封，本门连跑两遍必撞）
        #     → 走 admin 造户（不发信）。走了哪条路如实打印出来，不含糊过去。
        made_a, confirmation_on = ensure_test_user(supa, admin_db, email_a, password)
        created.append(email_a)
        rec("1·A 有了一个可登录的已确认账号", True, made_a)
        print(f"    邮箱确认：{'开着' if confirmation_on else '关着'}")

        # ── 2 登录 A ──────────────────────────────────────────────────────────────────
        status, body = supa.sign_in(email_a, password)
        token_a = body.get("access_token") if isinstance(body, dict) else None
        rec("2·登录 A 拿到真 access_token", status == 200 and bool(token_a), f"HTTP {status}")
        if not token_a:
            print(f"    body: {str(body)[:300]}")
            return 1
        status, me = supa.me(token_a)
        uid_a = me.get("id") if isinstance(me, dict) else None
        rec("2·token 能换回 user id（这是后端待会儿要做的同一件事）", status == 200 and bool(uid_a))

        # ── 3 游客身份建一个 context（走新的结构化端点，秒级）────────────────────────
        tables = {"01": [{"姓名": "陈思雨", "岗位": "市场经理", "部门": "市场部",
                          "主要负责": "华东区渠道投放", "人员ID": "MKT-001", "任职状态": "在职"}]}
        data, ctype = _multipart({"tables": json.dumps(tables, ensure_ascii=False)})
        status, payload = _req("POST", f"{api}/ingest/structured",
                               headers={"Content-Type": ctype}, data=data, timeout=120)
        cid = payload.get("context_id") if isinstance(payload, dict) else None
        token_owner = payload.get("owner_token") if isinstance(payload, dict) else None
        rec("3·游客建出 context（还没归属任何账号）", status == 200 and bool(cid) and bool(token_owner),
            f"HTTP {status} · {cid}")
        if not cid:
            print(f"    body: {str(payload)[:300]}")
            return 1
        contexts.append(cid)
        bound = local_sql(local_db, "select count(*) from avery.account_contexts where context_id = %s", (cid,))[0][0]
        rec("3·自证：认领之前库里确实没有绑定行（否则下一条是恒真）", bound == 0, f"bound={bound}")

        # ── 4 认领 ────────────────────────────────────────────────────────────────────
        status, body = _req("POST", f"{api}/account/claim",
                            headers={"Content-Type": "application/json",
                                     "X-Avery-Account": f"Bearer {token_a}"},
                            data=json.dumps({"context_id": cid, "owner_token": token_owner}).encode())
        rec("4·A 认领成功", status == 200, f"HTTP {status} {str(body)[:120]}")
        # 🔴 两头都要看：库里真有绑定行 **且** API 真能列出来。只看 API 会漏"后端记在内存里"，
        # 只看库会漏"存了但读路径接不上"。
        rows = local_sql(local_db,
                         "select user_id from avery.account_contexts where context_id = %s", (cid,))
        rec("4·avery.account_contexts 出现绑定行", len(rows) == 1 and rows[0][0] == uid_a,
            f"rows={len(rows)} user={rows[0][0] if rows else None}")
        status, body = _req("GET", f"{api}/account/contexts",
                            headers={"X-Avery-Account": f"Bearer {token_a}"})
        listed = body.get("context_ids", []) if isinstance(body, dict) else []
        rec("4·/account/contexts 列得出这份 context", status == 200 and cid in listed,
            f"HTTP {status} {listed}")

        # ── 5 备好并登录 B ────────────────────────────────────────────────────────────
        made_b, _ = ensure_test_user(supa, admin_db, email_b, password)
        created.append(email_b)
        rec("5·B 有了一个可登录的已确认账号", True, made_b)
        status, body = supa.sign_in(email_b, password)
        token_b = body.get("access_token") if isinstance(body, dict) else None
        rec("5·登录 B 拿到真 access_token", status == 200 and bool(token_b), f"HTTP {status}")
        if not token_b:
            return 1

        # ── 6 双账号隔离（本门的正主）──────────────────────────────────────────────────
        # 🔴 判据不是"B 读不到"，是"B 读到的 404 与一个**根本不存在的 id** 得到的 404
        # **同形**"——否则状态码本身就是一台存在性 oracle（feat-038 的 tokens_match 那段旧账
        # 记着同一个道理：500 与 404 的差别就把"这个 id 存在"说出去了）。
        bogus = "ctx_this_id_does_not_exist_at_all"
        s_real, b_real = _req("GET", f"{api}/team/{cid}",
                              headers={"X-Avery-Account": f"Bearer {token_b}"})
        s_bogus, b_bogus = _req("GET", f"{api}/team/{bogus}",
                                headers={"X-Avery-Account": f"Bearer {token_b}"})
        expect = 200 if born_red else 404   # --born-red：把判据反过来写，门必须变红
        rec("6·B 读 A 的 context → 404", s_real == expect, f"HTTP {s_real}（期望 {expect}）")
        rec("6·同一形状的 404（无存在性 oracle）",
            s_real == s_bogus and _shape(b_real) == _shape(b_bogus),
            f"real={s_real}/{_shape(b_real)} bogus={s_bogus}/{_shape(b_bogus)}")
        # B 拿着**错的** owner_token 去认领 A 的 context —— 同样 404，不是 403。
        s_claim, _ = _req("POST", f"{api}/account/claim",
                          headers={"Content-Type": "application/json",
                                   "X-Avery-Account": f"Bearer {token_b}"},
                          data=json.dumps({"context_id": cid, "owner_token": "not-the-right-token"}).encode())
        rec("6·B 用错 token 认领 A 的 context → 404", s_claim == 404, f"HTTP {s_claim}")
        rows = local_sql(local_db,
                         "select user_id from avery.account_contexts where context_id = %s", (cid,))
        rec("6·绑定没有被 B 抢走", len(rows) == 1 and rows[0][0] == uid_a,
            f"rows={len(rows)}")

        # ── 7 A 登出重登仍能列出 ──────────────────────────────────────────────────────
        # 登出在客户端是丢弃 token；这里重新登录一次拿一个**全新的** token，证明绑定挂在
        # 账号上而不是挂在某一个 token 上。
        status, body = supa.sign_in(email_a, password)
        token_a2 = body.get("access_token") if isinstance(body, dict) else None
        rec("7·A 重新登录拿到新 token", status == 200 and bool(token_a2) and token_a2 != token_a)
        status, body = _req("GET", f"{api}/account/contexts",
                            headers={"X-Avery-Account": f"Bearer {token_a2}"})
        listed = body.get("context_ids", []) if isinstance(body, dict) else []
        rec("7·换了 token 仍列得出（绑定挂在账号上，不挂在 token 上）",
            status == 200 and cid in listed, f"{listed}")

    finally:
        # ── 8 清理（幂等的后半）——**中途炸了也要跑到**，所以在 finally 里 ────────────
        purged = purge_test_users(admin_db)
        for c in contexts:
            local_sql(local_db, "delete from avery.account_contexts where context_id = %s", (c,))
        left = count_test_users(admin_db)
        rec("8·测试账号清理干净（生产 auth 表零留尸）", left == 0,
            f"删 {purged} 个 · 剩 {left} 个")
        bound_left = local_sql(local_db,
                               "select count(*) from avery.account_contexts where context_id = any(%s)",
                               (contexts or [""],))[0][0]
        rec("8·测试绑定行也清了", bound_left == 0, f"剩 {bound_left} 行")

    passed = sum(1 for _, ok, _ in R if ok)
    failed = len(R) - passed
    print(f"\n═══ 账号链路 E2E：{passed} PASS · {failed} FAIL ═══")
    if born_red:
        print("    （born-red 模式：上面**必须**有 FAIL，全绿反而说明判据是恒真的）")
    return 1 if failed else 0


def _shape(body) -> str:
    """回执的**形状**（键集合），用来判两个 404 是不是同一个 404。比对正文没用——
    detail 里带着各自的 id，本来就不相等。"""
    if isinstance(body, dict):
        return "{" + ",".join(sorted(body.keys())) + "}"
    return type(body).__name__


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
