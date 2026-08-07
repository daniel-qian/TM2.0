# -*- coding: utf-8 -*-
"""T10 变异测试跑器：逐条打断一个机制，确认**预期的那几条判据**真的变红，然后还原。

这个仓库没有 mutmut/cosmic-ray；变异一直是手工的（receipt-T8-e2e.md 记的就是这个做法）。
这里只是把「改一行 → 跑门 → 记红绿 → 还原」自动化，判据本身仍然是人写的。

🔴 活下来的变异八成是**门洞**不是代码 bug —— 每一条活着的都要当场解释。
"""
import io
import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(r"D:\avery-wt-affectionate-hertz-ecb01d\eval-harness")
EXTRACT = ROOT / "avery" / "ingest" / "extract.py"
APPEND = ROOT / "avery" / "ingest" / "file_append.py"
API = ROOT / "service" / "ingest_api.py"
GUARD = ROOT / "service" / "upload_guard.py"

# (名字, 文件, 原文, 变异文, 期望变红的判据关键词)
MUTATIONS = [
    ("M01 账本不认领旧冲突（坑②）", EXTRACT,
     "        for c in self.extraction.conflicts:\n            hits = keys_by_ref.get((c.subject_kind, c.subject_ref)) or []",
     "        for c in []:\n            hits = keys_by_ref.get((c.subject_kind, c.subject_ref)) or []",
     ["twice_does_not_double", "extends_the_same_conflict", "twice_doubles_nothing"]),

    ("M02 逐字段出处退化成实体级 source（坑③）", EXTRACT,
     "        if origin and src:\n            return src, origin\n        return str(getattr(entity, \"source\", \"\") or \"\"), DOC_PROVENANCE_ORIGIN",
     "        return str(getattr(entity, \"source\", \"\") or \"\"), DOC_PROVENANCE_ORIGIN",
     ["ACTUALLY_stated", "eats_a_hand_edited_cell", "contradicts_a_hand_edit",
      "truncates_a_hand_curated"]),

    ("M03 手编不再赢（坑①）", EXTRACT,
     "        return self.held_source(entity, fname)[1] == MANUAL_PROVENANCE_ORIGIN",
     "        return False",
     ["eats_a_hand_edited_cell", "truncates_a_hand_curated", "contradicts_a_hand_edit"]),

    ("M04 新旧不比了，新的恒赢", EXTRACT,
     "        held_at = (self._docs.get(doc_key_of(held_src)) or (None, \"\"))[0]",
     "        return True\n        held_at = (self._docs.get(doc_key_of(held_src)) or (None, \"\"))[0]",
     ["older_document_never_overrides", "unresolvable_timestamp", "absorb_a_project_the_same_way"]),

    ("M05 缺席判据退化成真值性（progress=0）", EXTRACT,
     "    if value is None:\n        return True\n    if isinstance(value, str):",
     "    return not value\n    if isinstance(value, str):",
     ["zero_progress_is_a_real_reading"]),

    ("M06 项目 id 不解碰撞", EXTRACT,
     "        pr.id = fresh\n        seen.add(fresh)",
     "        seen.add(fresh)",
     ["sharing_a_slug_id"]),

    ("M07 起名不看已占用的 key", API,
     "    used: set[str] = set(taken or ())",
     "    used: set[str] = set()",
     ["gets_its_own_source_key", "disambiguates_against_the_existing_library"]),

    ("M08 归档卡被跳过（分叉成两张同名卡）", EXTRACT,
     "    cur = next((pr for pr in projects if _project_key(pr.title) == key), None)",
     "    cur = next((pr for pr in projects if _project_key(pr.title) == key\n                and not getattr(pr, 'archived', False)), None)",
     ["archived_card_rather_than_forking"]),

    ("M09 边缘闸不覆盖新路由", GUARD,
     "    if path.startswith(\"/team/\") and path.endswith(\"/files\"):\n        return \"ingest\"",
     "    if False:\n        return \"ingest\"",
     ["edge_guard_actually_covers"]),

    ("M10 补传后不重写 facts.md", APPEND,
     "    materialize_memory(ctx.extraction, ctx.memory_dir)\n    reg.put(ctx)",
     "    reg.put(ctx)",
     ["facts_md_and_the_room_recall"]),

    ("M11 出处 origin 用了第四种取值", EXTRACT,
     "        rec = {\"origin\": DOC_PROVENANCE_ORIGIN, \"source\": source,",
     "        rec = {\"origin\": \"append\", \"source\": source,",
     ["closed_wire_union"]),

    ("M12 补传把存量文档也重抽一遍（命门②）", APPEND,
     "    fresh = extract_docs(fresh_docs, extractor=extractor)",
     "    fresh = extract_docs(fresh_docs + fresh_docs, extractor=extractor)",
     ["extracts_only_the_new_files"]),

    ("M13 名字对不上的文档被静默滤掉", APPEND,
     "    if stray:\n        raise ValueError(",
     "    if False:\n        raise ValueError(",
     ["not_a_supplied_key_is_refused"]),

    ("M14 信号不去重（坑④）", EXTRACT,
     "    extraction.signals = kept\n    return before - len(kept)",
     "    return before - len(kept)",
     ["signals_are_deduped_only_after"]),

    ("M15 账本在场时仍然拒收 team（规则 3.5 够不着）", EXTRACT,
     "    if ledger is None:\n        dirty = [f for f in _CONFLICT_FIELD_ALLOWLIST[\"person\"]",
     "    if True:\n        dirty = [f for f in _CONFLICT_FIELD_ALLOWLIST[\"person\"]",
     ["ledger_unlocks_team"]),

    ("M16 冲突不按胜出者排序", EXTRACT,
     "                               values=[fresh, old] if fresh_wins else [old, fresh])",
     "                               values=[old, fresh])",
     ["winning_reading_first", "extends_the_same_conflict"]),

    ("M17 一次性克隆的标记不投出去", API,
     "    if reg is not None and _registry_says_ephemeral(reg, ctx.context_id):",
     "    if False and _registry_says_ephemeral(reg, ctx.context_id):",
     ["flags_a_disposable_clone"]),

    ("M18 补传路上的红线硬门被摘掉", APPEND,
     "    rl = validate_extraction(fresh)\n    if not rl.ok and not person_scoring_allowed():",
     "    rl = validate_extraction(fresh)\n    if False:",
     ["red_line_still_refuses"]),
]


def run_tests() -> list[str]:
    p = subprocess.run(
        [sys.executable, "-m", "pytest", "tests/test_file_append_t10.py", "-q", "--tb=no",
         "-p", "no:randomly"],
        cwd=ROOT, capture_output=True, text=True, encoding="utf-8", errors="replace")
    return [ln.split("::")[-1].split(" ")[0]
            for ln in p.stdout.splitlines() if ln.startswith("FAILED")]


def main() -> None:
    report = []
    for name, path, old, new, expect in MUTATIONS:
        original = path.read_text(encoding="utf-8")
        if old not in original:
            report.append({"mutation": name, "status": "PATCH-MISS",
                           "note": "锚点没找到——变异没打上，这条结论作废"})
            continue
        try:
            path.write_text(original.replace(old, new, 1), encoding="utf-8")
            failed = run_tests()
        finally:
            path.write_text(original, encoding="utf-8")
        hit = [k for k in expect if any(k in f for f in failed)]
        report.append({
            "mutation": name,
            "status": "KILLED" if hit else "SURVIVED",
            "expected_hit": hit,
            "expected_missed": [k for k in expect if k not in hit],
            "n_failed": len(failed),
            "failed": sorted(failed),
        })
        print(f"{report[-1]['status']:9} {name}  ({len(failed)} red)")
    io.open(Path(__file__).with_suffix(".json"), "w", encoding="utf-8").write(
        json.dumps(report, ensure_ascii=False, indent=1))


if __name__ == "__main__":
    main()
