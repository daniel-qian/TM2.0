# -*- coding: utf-8 -*-
"""T3 × T5 · 「选人控件该不该送工号」这条判断的取证（合 main 时补做）。
跑法：cd eval-harness && python ../.issues/gap-design-0805/t3-probe-staffnumber.py

## 背景
T5 交接里点名留给 T3 两条，第一条是：`recipients[].id`（工号）只有 API 面没有 UI。
本票初版顺手把 `team.people[].id` 送了过去——但那是 `team_cards()` 投的**人卡内部键**
（registry.py `_one_person_card` 里的 `p.id`），**不是**工号。工号是 T5 新加的
`PersonEntity.person_id`，今天根本没投到前端来。

## 为什么送错比不送更糟（不是保守，是必须）
T5 的 `PersonIndex.resolve` 规则 2 的原话：「工号对不上（或这条读数没工号）→ 退回姓名。
**除非**双方工号都非空且不同 —— 那是两个恰好同名的人」。
于是一家**真填了工号**的公司：花名册那条是 `MKT-001`、表单这条是内部键 `pe_...`，
两个都非空且不同 → 判成两个同名的人 → **连同一个人都并不上**，自述整条回流不了。

下面四格就是这句话的机器判定。判据直接问身份尺本身，不赌 HTTP、不赌解析器。
"""
import os
import sys

# Python 把**脚本自己的目录**放进 sys.path[0]，不是当前工作目录——所以哪怕在 eval-harness/
# 底下跑，`import avery` 也解析不到。显式把仓库的 eval-harness 挂上去，脚本从哪儿跑都一样。
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "eval-harness"))

from avery.ingest.extract import PersonIndex, PersonEntity  # noqa: E402


def merges(form_person_id: str, roster_person_id: str) -> bool:
    """花名册那条 vs 表单那条，同名，各带（或不带）工号——并得上吗。"""
    roster = PersonEntity(id="p1", name="周雅")
    roster.person_id = roster_person_id
    idx = PersonIndex([roster])
    stub = PersonEntity(id="p2", name="周雅")
    stub.person_id = form_person_id
    return idx.resolve(stub) == idx.resolve(roster)


def main() -> int:
    INTERNAL = "pe_zhouya_internal"   # team_cards() 发的那种人卡内部键
    rows = [
        ("花名册有工号 · 表单送 ''（本票现在）", merges("", "MKT-001"), True),
        ("花名册有工号 · 表单送内部键（初版）", merges(INTERNAL, "MKT-001"), False),
        ("花名册无工号 · 表单送 ''", merges("", ""), True),
        ("花名册无工号 · 表单送内部键", merges(INTERNAL, ""), True),
    ]
    bad = 0
    for label, got, want in rows:
        ok = got == want
        bad += 0 if ok else 1
        print(f"  {'✓' if ok else '✗'} {label} → {'并得上' if got else '并不上'}")
    print()
    print("结论：只有「不谎报工号」这一种做法，在两类公司上都并得上。" if bad == 0
          else f"判定与预期不符 {bad} 条 —— 身份尺的规则可能变了，回去读 PersonIndex.resolve。")
    return 1 if bad else 0


if __name__ == "__main__":
    raise SystemExit(main())
