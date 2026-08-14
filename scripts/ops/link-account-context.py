#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""#100 · admin 绑人：把一个**已存在**的账号加进一份**已存在**的档案（一家公司多个成员）。

## 它是什么，以及为什么只有它

demo 阶段「给这家公司加第二个人」的**唯一**路径。产品里没有邀请流程、没有自助加入入口，
这是票面写死的边界（#100 §6「明确不做」）。

`/account/claim` 那条路**不能**用来加人，而且这是个产品决定不是遗留行为（Danny 0814）：
认领要出示 owner_token，而 owner_token 是**设备级**凭据，存在第一台电脑的浏览器 localStorage 里。
让它当公司门票，等于谁翻到过那台机器谁就能把自己塞进公司，而且没有一个人会收到通知。
所以 claim 永远拒绝已有主人的档案，加人只走这里。

## 为什么是 Python 而不是 .mjs（跟 create-account.mjs 不同族）

因为「谁能进这家公司」这条规则只该有**一份**实现。本脚本调的就是服务端自己那个
`link_account_context(..., allow_shared=True)` —— 同一个函数、同一把行锁、同一套 `_ensure_schema`，
被 test_registry_contract.py 的两腿契约与七步升级路径门直接盖住。用 Node 重写一遍 SQL 会造出
第二份规则，而两份规则迟早会分叉（create-account.mjs 是 .mjs，因为它调的是 Supabase 的 auth
admin API，那本来就在服务端代码之外）。

## 跑法

    # 看这份档案上现在都有谁（只读，先看再动）
    AVERY_DB_URL=<...>  python scripts/ops/link-account-context.py --context ctx_xxx --list

    # 把一个账号加进来
    AVERY_DB_URL=<...>  python scripts/ops/link-account-context.py \
        --context ctx_xxx --user <supabase user uuid>

    # 顺手把记录追加进 test-accounts/<公司代号>.md（该目录整体 gitignore）
    AVERY_DB_URL=<...>  python scripts/ops/link-account-context.py \
        --context ctx_xxx --user <uuid> --record hotelA

`--user` 要的是 Supabase 的 auth user id（uuid），不是邮箱。它在建号时就落盘了：
`test-accounts/<公司代号>.md` 里那行 `user_id：...`（scripts/ops/create-account.mjs 写的）。
不接受邮箱是故意的 —— 按邮箱查 uuid 要 service_role key，而那把钥匙绕过一切 RLS，
不该为了省一次复制粘贴就多一条它的使用路径。

## 🔴 凭据纪律

`AVERY_DB_URL` 只从环境变量进来，绝不做命令行参数（会进 shell history）、绝不落仓库。
生产那一份从**在跑的容器**里提，别信 `~/avery.env`。
"""
from __future__ import annotations

import argparse
import os
import sys
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "eval-harness"))


def _die(msg: str) -> None:
    print(f"[FAIL] {msg}", file=sys.stderr)
    raise SystemExit(1)


def _registry(url: str):
    try:
        from avery.ingest.pg_registry import PostgresContextRegistry
    except ImportError as e:                                   # pragma: no cover - 环境问题
        _die(f"导入 registry 失败（在仓库根跑，且装了 psycopg 吗）：{e}")
    return PostgresContextRegistry(url)


def _roster(reg, context_id: str) -> list[str]:
    return list(reg.accounts_for_context(context_id))


def _show(label: str, members: list[str]) -> None:
    if not members:
        print(f"  {label}：（空 —— 匿名档案，还没有任何账号绑上来）")
        return
    print(f"  {label}：{len(members)} 人")
    for i, uid in enumerate(members):
        print(f"    {i}. {uid}" + ("   ← 创始成员（最早绑上的）" if i == 0 else ""))


def _append_record(code: str, context_id: str, user_id: str) -> None:
    """把一行成员记录**追加**进 test-accounts/<code>.md。

    只追加、绝不创建也绝不覆盖 —— 那个文件里存着一家公司唯一那份密码（库里读不出来），
    create-account.mjs 的同一条纪律。文件不在就只打印，让人自己贴。"""
    out = ROOT / "test-accounts" / f"{code}.md"
    line = f"- {date.today().isoformat()} · 加入档案 `{context_id}` · user_id：{user_id}\n"
    if not out.exists():
        print(f"[WARN] {out} 不存在，没有落盘。要留档就把下面这行自己贴进去：\n{line}", end="")
        return
    with out.open("a", encoding="utf-8") as f:
        f.write(line)
    print(f"[OK] 记录已追加：{out}")


def main() -> int:
    ap = argparse.ArgumentParser(
        description="#100 admin 绑人：把一个已存在账号加进一份已存在档案")
    ap.add_argument("--context", required=True, help="档案 id（ctx_...）")
    ap.add_argument("--user", help="Supabase auth user id（uuid）。--list 时可省")
    ap.add_argument("--list", action="store_true", help="只看这份档案上现在都有谁，不做任何写入")
    ap.add_argument("--record", metavar="CODE",
                    help="把记录追加进 test-accounts/<CODE>.md（只追加，不创建不覆盖）")
    args = ap.parse_args()

    url = (os.environ.get("AVERY_DB_URL") or os.environ.get("PGVECTOR_URL") or "").strip()
    if not url:
        _die("没有 AVERY_DB_URL（或 PGVECTOR_URL）。这脚本要直连库，不走 HTTP。")

    reg = _registry(url)
    context_id = args.context.strip()

    if reg.get(context_id) is None:
        _die(f"档案 {context_id} 不在库里。绑人不会顺手创建档案 —— 先确认 id 抄对了。")

    before = _roster(reg, context_id)
    print(f"档案 {context_id}")
    _show("绑之前", before)

    if args.list:
        return 0
    if not args.user:
        _die("要绑人就得给 --user <uuid>（只想看就加 --list）。")
    user_id = args.user.strip()

    if user_id in before:
        print(f"[OK] {user_id} 本来就在这份档案上，什么都没改（幂等）。")
        return 0

    # 🔴 allow_shared=True 是全仓唯一显式传它的地方：这就是「admin 绑人」与「自助认领」的分界。
    #    默认参数（claim 那条路走的）在已有主人时返回 False，那条拒绝由 #100 保留，见模块头。
    ok = reg.link_account_context(user_id, context_id, allow_shared=True)
    if not ok:
        _die(f"绑定被拒绝：{user_id} -> {context_id}。档案存在（上面已确认），"
             f"所以这多半是 user_id 空的或抄错了。")

    after = _roster(reg, context_id)
    _show("绑之后", after)

    # 对照基准，别只报「成功」：真去读一遍新库状态，确认这一步确实多了这一个人、且没动别人。
    added = [u for u in after if u not in before]
    lost = [u for u in before if u not in after]
    if added != [user_id] or lost:
        _die(f"落库结果与预期不符 —— 新增 {added}（应为 [{user_id}]）、丢失 {lost}（应为空）。")
    print(f"[OK] {user_id} 已加入 {context_id}；这份档案现在有 {len(after)} 个成员。")
    print("     他直接登录自己的账号就能看到这家公司（同事的改动靠刷新，不是实时协同）。")

    if args.record:
        _append_record(args.record, context_id, user_id)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
