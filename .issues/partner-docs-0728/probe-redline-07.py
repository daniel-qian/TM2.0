# -*- coding: utf-8 -*-
"""表 07（评议与反馈）红线探针 —— 合伙人表单进 app 前的必测项。

问题：表 07 的「需改进事项」是全套表单里最接近人身评价的一栏。ingest 管线在
pipeline.py:130 上是 **整批拒绝**（`if not rl.ok and not person_scoring_allowed(): ok=False`），
不是"丢掉那一格"。所以一张 07 触雷 = 同一发上传里的 01-06 一起废掉。

本探针不调 LLM（AGENTS.md：needs_keys 一律 deselect），直接构造 LLM 最可能吐出的
PersonEntity 形状喂 validate_extraction，量的就是那道硬闸。

⚠️ 「整批拒绝」这个行为**正在被另一条线改掉**（2026-07-28 立项：红线改成丢字段 + 回执，
不再整批失败）。改完之后本探针的 B 组仍会命中红线，但后果不再是整发上传失败——
到那时请照新行为更新本文件顶部这段描述，别让它继续描述一个已经不存在的机制。

跑法（从仓库根，任意目录都行）：
    python .issues/partner-docs-0728/probe-redline-07.py
"""
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "eval-harness"))

from avery.ingest.extract import PersonEntity, SignalEntity, ExtractionResult
from avery.ingest.redline_extract import validate_extraction, validate_person_dict
from avery.scoring_policy import person_scoring_allowed


def check(label, *, owns=None, collab=None, role="", name="陈思雨"):
    p = PersonEntity(id="p1", name=name, role=role,
                     owns=list(owns or []), collaboration=list(collab or []))
    rl = validate_extraction(ExtractionResult(people=[p]))
    mark = "PASS " if rl.ok else "FAIL "
    print(f"{mark} {label}")
    if not rl.ok:
        for v in rl.violations:
            print(f"        └─ {v.kind} :: {v.detail[:110]}")
    return rl.ok


def check_signal(label, summary):
    s = SignalEntity(id="s1", source_kind="doc", subjectType="person",
                     subjectRef="陈思雨", summary=summary)
    rl = validate_extraction(ExtractionResult(signals=[s]))
    mark = "PASS " if rl.ok else "FAIL "
    print(f"{mark} {label}")
    if not rl.ok:
        for v in rl.violations:
            print(f"        └─ {v.kind} :: {v.detail[:110]}")
    return rl.ok


print(f"AVERY_ALLOW_PERSON_SCORING = {os.environ.get('AVERY_ALLOW_PERSON_SCORING', '(unset)')}"
      f"  ->  person_scoring_allowed() = {person_scoring_allowed()}")
print("=" * 78)
print("A. 按合伙人「填写要点」规范填的 07（应当全 PASS，否则我们发的表自带雷）")
print("-" * 78)
check("确认的优势：写做成的具体事 + 数字",
      owns=["6 月 10 日独立完成秋季发布会媒体协调，覆盖 3 家行业媒体、留资 500 条"])
check("需改进事项：写行为和场景（要点里的正面例子）",
      owns=["三次跨部门协调都等到周会才提出"])
check("沟通后约定动作：带时间点",
      owns=["8 月 15 日前把渠道对接清单交给运营，双方 7 月 30 日已确认"])
check("评议周期 + 日期",
      role="渠道运营", owns=["评议周期 2026Q3，评议日期 2026-07-24"])
check("06 表：已完成事实带数字",
      owns=["完成 3 场直播，累计观看 1.2 万；7 月 20 日交付投放复盘"])

print()
print("B. 用户没按要点填的 07（这些该被拦——问题是它拦的是整批）")
print("-" * 78)
check("写了分数：绩效 2 分", owns=["沟通主动性不足，本季度绩效 2 分"])
check("写了百分比：完成度 82%", owns=["季度目标完成度 82%"])
check("写了定性等级：绩效评级 不合格", owns=["绩效评级：不合格"])
check("写了排名：排名倒数第一", owns=["团队内排名倒数第一"])
check("写了性格评价：沟通主动性不足", owns=["沟通主动性不足"])
check_signal("06 表落成人身 signal：她这周超载了", "本周承担 3 个项目的交付，7 月 22 日起每天延时")

print()
print("C. 表头/提示文本被误当成人（xlsx 表头设计要避开的形状）")
print("-" * 78)
check("被评议人员ID 当成人名", name="被评议人员ID *")
check("KPI-001 当成人名", name="KPI-001")

print()
print("D. 禁键结构闸（LLM 若把栏目名当 person 键发回来）")
print("-" * 78)
for key in ("绩效评分", "需改进事项", "确认的优势", "评议周期", "潜力评估", "离职风险"):
    vs = validate_person_dict("陈思雨", {key: "x"})
    print(f"{'REJECT' if vs else 'ALLOW '} person 键 '{key}'")
