# -*- coding: utf-8 -*-
"""gap2 T11 · 后端变异跑器 —— 一条一条下刀、跑门、还原、记账。

为什么是脚本不是手工：本票新判据太多，手工逐条改文件再改回来，最容易出的错正是
「子 agent 说已还原、其实没有」（session-handoff-T1.md:151-154 那条纪律）。
脚本每条变异跑完立刻 `git checkout --` 还原，最后再核一次工作区是干净的。

⚠ 本脚本**只跑离线 pytest**。前端那两条变异（界面这一侧的锁）要跑真浏览器门，
另行手工做（见回执）。

跑法：cd eval-harness && python ../.issues/gap2-0807/t11-mutate.py
"""
from __future__ import annotations

import pathlib
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parents[2]
EVAL = ROOT / "eval-harness"

# 本机控制台是 GBK（MEMORY：中文/符号在 argv 与 stdout 上都会被啃）。输出里有 ✓/✗ 与中文，
# 不显式重绑就是一个 UnicodeEncodeError——这不是脚本的错，是终端的编码。
sys.stdout.reconfigure(encoding="utf-8", errors="replace")

# (编号, 一句话变异, 目标文件, 原文, 替换成, 预期红的测试名子串列表)
MUTANTS = [
    ("M1", "拆掉「已被答过的 field.id 禁改禁删」整道门",
     "avery/ingest/form.py",
     "    if stored is None or not used_ids:\n        return None",
     "    if stored is None or not used_ids:\n        return None\n    return None  # MUTANT",
     ["test_deleting_an_answered_field_is_refused",
      "test_changing_the_kind_of_an_answered_field_is_refused",
      "test_the_used_field_gate_is_a_pure_function_over_what_was_answered"]),

    ("M2", "save_form 往回建 FormField 时漏传 situational（退回 T11 之前那个真 bug）",
     "service/form_api.py",
     "                          situational=bool(f.situational),",
     "",
     ["test_every_field_attribute_survives_the_http_round_trip",
      "test_the_stored_dataclass_holds_exactly_what_the_payload_said"]),

    ("M3", "回流退回「认 label 文案」的老正则（不读结构化标记）",
     "avery/ingest/form_reflow.py",
     '    marked = {f.self_report: f for f in template.fields if f.self_report}',
     '    marked = {("load" if "负载" in f.label else "mood"): f for f in template.fields\n'
     '              if "自述" in f.label}  # MUTANT',
     # ⚠ 第一轮这条只命中 1/2：`test_an_unmarked_number_question_never_climbs_onto_a_card`
     # 走整条真链，而真链上没标记的数字题渲染成自己一节（一行光秃秃的 `93`，没有名字），
     # **取证闸**自己就把它挡了——门是绿的，但绿的原因是另一把锁。补
     # `test_only_the_marker_decides_which_answer_becomes_a_card_reading` 把取证闸喂饱、
     # 只留标记这一条能说话，这条变异才真的被 marker 规则自己杀死。
     ["test_a_renamed_self_report_question_still_lands_on_the_card",
      "test_only_the_marker_decides_which_answer_becomes_a_card_reading"]),

    ("M4", "拆掉取证闸（读数不再要求文档里有一行撑着）",
     "avery/ingest/form_reflow.py",
     "    if line_no is None or line_no < 1 or line_no > len(doc.lines):\n        return False",
     "    return True  # MUTANT\n    if line_no is None or line_no < 1 or line_no > len(doc.lines):\n"
     "        return False",
     ["test_a_reading_with_no_line_of_the_document_behind_it_is_dropped"]),

    ("M5", "存量内置模板不回填标记（新开关只对新公司生效）",
     "avery/ingest/form.py",
     "            if backfill_builtin_markers(stored, tpl):",
     "            if False and backfill_builtin_markers(stored, tpl):  # MUTANT",
     ["test_a_template_already_in_the_library_gains_the_markers_on_the_next_read"]),

    ("M6", "回填不看 label 是否被改过（连经理改过题面的格也补）",
     "avery/ingest/form.py",
     "        if f.self_report or f.kind != model.kind or f.label != model.label:",
     "        if f.self_report or f.kind != model.kind:  # MUTANT",
     ["test_the_backfill_keeps_its_hands_off_a_question_the_manager_touched"]),

    ("M7", "yesno 的答案直接 str() 进资料文档（客户资料里印出 True）",
     "avery/ingest/form_append.py",
     '    if getattr(field, "kind", "") == "yesno":\n        return "是" if value else "否"',
     '    pass  # MUTANT',
     ["test_a_yesno_answer_reads_as_chinese_in_the_filed_document"]),

    ("M8", "自述行退回「所有非 text 格」（没标记的数字题也挤进本人自述那一节）",
     "avery/ingest/form_append.py",
     "        if not f.self_report or f.id not in by_field:\n            continue\n        cells.append(",
     "        if f.kind == \"text\" or f.id not in by_field:  # MUTANT\n            continue\n        cells.append(",
     ["test_an_unmarked_number_does_not_move_into_the_self_report_section"]),

    ("M9", "员工页渲染不过滤 retired（停用的格照样问）",
     "service/form_api.py",
     "    for f in live_fields(template):\n        rows.append(_field_head(L, f))",
     "    for f in template.fields:  # MUTANT\n        rows.append(_field_head(L, f))",
     ["test_a_retired_field_is_not_asked_and_not_parsed"]),

    ("M10", "拆掉三个语义开关的落点判据（死开关静默放行）",
     "avery/ingest/form.py",
     '        if f.situational and f.kind != "text":',
     '        if False and f.situational and f.kind != "text":  # MUTANT',
     ["test_a_switch_that_the_reflow_layer_could_never_read_is_refused"]),

    ("M11", "起草层不过红线（旧表头带评分字眼原样带出来）",
     "avery/ingest/form_draft.py",
     "        if part and not text_passes_the_red_line(part):",
     "        if False and part and not text_passes_the_red_line(part):  # MUTANT",
     ["test_drafting_reads_the_old_sheet_and_says_what_it_dropped",
      "test_a_model_that_ignores_the_red_line_still_cannot_get_a_scoring_question_through"]),

    ("M12", "起草层不收拾模型吐出来的坏形状（把 422 推到经理点确认那一刻）",
     "avery/ingest/form_draft.py",
     '        if kind == "choice" and len(choices) < 2:\n            kind, choices = "text", []',
     "        pass  # MUTANT",
     ["test_a_model_that_returns_a_broken_shape_never_reaches_the_manager"]),

    ("M13", "MAX_FIELDS 改成数「存着几格」而不是「在问几格」（停用的格占名额）",
     "avery/ingest/form.py",
     "    asked = live_fields(t)",
     "    asked = list(t.fields)  # MUTANT",
     ["test_the_twelve_question_cap_counts_what_is_asked_not_what_is_stored"]),

    ("M14", "yesno 收下任何非空值（不再只认 yes/no 两个词）",
     "avery/ingest/form.py",
     "            if picked not in YESNO_VALUES:\n                return None, f\"field {f.id} needs a yes or a no\"",
     "            pass  # MUTANT",
     ["test_a_yesno_answer_is_stored_as_a_bool_not_as_the_word_on_screen"]),

    ("M15", "窄档 number 退回滑杆（选填格照样交上没人选过的数）",
     "service/form_api.py",
     "    if 2 <= steps <= SCALE_MAX_STEPS:",
     "    if False and 2 <= steps <= SCALE_MAX_STEPS:  # MUTANT",
     ["test_a_one_to_five_number_renders_as_buttons_and_a_wide_one_stays_a_slider"]),
]

GATE = ["-m", "pytest", "tests/test_form_builder_t11.py", "tests/test_form_reflow_a2.py",
        "tests/test_form_append.py", "tests/test_form_h5.py", "tests/test_form_store_contract.py",
        "-q", "--no-header", "-p", "no:cacheprovider"]


def run_gate() -> set[str]:
    """跑一遍门，返回**失败的测试名**集合。"""
    out = subprocess.run([sys.executable, *GATE], cwd=EVAL, capture_output=True, text=True,
                         encoding="utf-8", errors="replace")
    failed = set()
    for line in (out.stdout or "").splitlines():
        if line.startswith("FAILED "):
            failed.add(line.split(" ", 1)[1].split(" ")[0])
    return failed


def revert(rel: str) -> None:
    subprocess.run(["git", "checkout", "--", f"eval-harness/{rel}"], cwd=ROOT, check=True)


def main() -> int:
    baseline = run_gate()
    if baseline:
        print(f"⛔ 基线就不是绿的，先修再变异：{sorted(baseline)}")
        return 1
    print("基线全绿。开始逐条下刀。\n")

    rows, survivors = [], []
    for num, what, rel, old, new, expect in MUTANTS:
        path = EVAL / rel
        src = path.read_text(encoding="utf-8")
        if src.count(old) != 1:
            print(f"⛔ {num}：靶点在 {rel} 里出现 {src.count(old)} 次，不是恰好一次——变异没下成，"
                  "这条不算数（代码漂了，先对靶点）")
            rows.append((num, what, "靶点没对上", ""))
            continue
        path.write_text(src.replace(old, new), encoding="utf-8")
        try:
            failed = run_gate()
        finally:
            revert(rel)
        hit = [e for e in expect if any(e in f for f in failed)]
        extra = [f for f in failed if not any(e in f for e in expect)]
        ok = len(hit) == len(expect)
        if not ok:
            survivors.append(num)
        rows.append((num, what,
                     "✓ 精确打红" if ok and not extra else
                     ("✓ 打红（另有溢出）" if ok else "✗ 活下来了"),
                     f"命中 {len(hit)}/{len(expect)}" + (f"；溢出 {len(extra)} 条" if extra else "")))
        print(f"  [{rows[-1][2]}] {num} {what} — {rows[-1][3]}")

    print("\n| # | 变异 | 结果 | 备注 |")
    print("|---|---|---|---|")
    for r in rows:
        print(f"| {r[0]} | {r[1]} | {r[2]} | {r[3]} |")

    dirty = subprocess.run(["git", "status", "--porcelain", "eval-harness"], cwd=ROOT,
                           capture_output=True, text=True).stdout.strip()
    print(f"\n收工核一次工作区：{'干净' if not dirty else '⛔ 有残留：' + dirty}")
    if survivors:
        print(f"⚠ 活下来的变异：{survivors} —— 八成是门洞不是代码 bug，先问语料是不是让判据够不着。")
    return 1 if (survivors or dirty) else 0


if __name__ == "__main__":
    raise SystemExit(main())
