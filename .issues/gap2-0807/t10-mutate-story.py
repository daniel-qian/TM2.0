# -*- coding: utf-8 -*-
"""verify-append-story.mjs 的变异测试：这道门是**born green** 的，所以必须证明它会红。

三条变异各打断故事里的一环，其中 F2 就是票面明令不许出现的那半个活
（「只进资料库不动卡片」）——它活下来的话，这道门就白写了。
每条变异都要重新 `vite build`（判据跑在 build+preview 上，dev 那条路在这里是死的）。
"""
import io
import json
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(r"D:\avery-wt-affectionate-hertz-ecb01d")
VIEW = ROOT / "src" / "lite2" / "projectView.ts"
STORE = ROOT / "src" / "lite2" / "store.ts"
PANEL = ROOT / "src" / "lite2" / "UploadPanel.tsx"

MUTATIONS = [
    ("F1 出处角标退回三态（'doc' 落进 null 分支）", VIEW,
     "  return origin === 'doc' && provenance?.[field]?.source ? 'doc' : null",
     "  return null",
     ["出处角标指向"]),

    ("F2 只进资料库不动卡片（票面明令不许砍的那半个）", STORE,
     "        appendReceipt: payload.appended ?? null,\n        // 卡片当场是新读数",
     "        appendReceipt: payload.appended ?? null,\n        ...(false ? {} : {}),\n        // 卡片当场是新读数",
     ["卡片安静更新"]),

    ("F3 补资料口子其实调的是 uploadFiles（墙没拆）", PANEL,
     "  const send = appending ? appendFiles : uploadFiles",
     "  const send = uploadFiles",
     ["context_id 一个字符都没变"]),
]

# F2 需要真的把 team/rawTeam 那两行拿掉，用正则更稳。
F2_PATTERN = re.compile(
    r"        team: liteTeamFromPayload\(payload\),\n        rawTeam: payload,\n(      \}\)\n      // 资料库那份清单)")


def build() -> bool:
    p = subprocess.run(["npx", "vite", "build", "--mode", "development"], cwd=ROOT,
                       capture_output=True, text=True, shell=True, encoding="utf-8", errors="replace",
                       env={**__import__("os").environ,
                            "VITE_AVERY_API_BASE": "http://127.0.0.1:8147"})
    return p.returncode == 0


def run_gate() -> list[str]:
    p = subprocess.run([r"node", "eval-harness/tools/verify-append-story.mjs"], cwd=ROOT,
                       capture_output=True, text=True, encoding="utf-8", errors="replace",
                       env={**__import__("os").environ, "VERIFY_BASE": "http://localhost:5183"})
    return [ln for ln in p.stdout.splitlines() if "[FAIL]" in ln]


def main() -> None:
    report = []
    for name, path, old, new, expect in MUTATIONS:
        original = path.read_text(encoding="utf-8")
        if name.startswith("F2"):
            patched, n = F2_PATTERN.subn(r"\1", original)
            ok = n == 1
        else:
            ok = old in original
            patched = original.replace(old, new, 1)
        if not ok:
            report.append({"mutation": name, "status": "PATCH-MISS"})
            print(f"PATCH-MISS {name}")
            continue
        try:
            path.write_text(patched, encoding="utf-8")
            built = build()
            failed = run_gate() if built else ["<build failed>"]
        finally:
            path.write_text(original, encoding="utf-8")
        hit = [k for k in expect if any(k in f for f in failed)]
        report.append({"mutation": name, "built": built, "status": "KILLED" if hit else "SURVIVED",
                       "expected_hit": hit, "failed": failed})
        print(f"{report[-1]['status']:9} {name}  ({len(failed)} red)")
    build()   # 还原 dist
    io.open(Path(__file__).with_suffix(".json"), "w", encoding="utf-8").write(
        json.dumps(report, ensure_ascii=False, indent=1))


if __name__ == "__main__":
    main()
