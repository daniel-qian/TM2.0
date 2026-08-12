# -*- coding: utf-8 -*-
"""#91 · verify-extraction-degraded 门的三发变异（票面点名：!== llm / 不持久化 / emptyArchive 不清）。

用法：
    python .issues/ingest-root-cause-0812/_mut91/mutate.py apply M1
    python .issues/ingest-root-cause-0812/_mut91/mutate.py restore
每发之间必须：apply → vite build（带 VITE_AVERY_API_BASE）→ 跑门 → restore → 重 build。

纪律（#90/#92 变异台账的碑照办）：
  · 锚点命中数必须 ==1，0 命中=没打上（CRLF/文案漂了），>1=打偏，一律拒绝执行；
  · 以**字节**读写，restore 写回 apply 之前留存的原始字节（不做任何归一化——
    「还原写回归一化副本会压平全仓 CRLF」的坑）；
  · 每发预期红哪几条写死在 EXPECT 里，跑完人工对照（恰好这些红、别的全绿才算数）。
"""
import io
import shutil
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
BAK = Path(__file__).resolve().parent / "_bak"

MUTS = {
    # M1 · 横幅判据写成反向词表：'heuristic' 也报警 → ① 基线 与 ④ 当场红。
    "M1": {
        "file": "src/lite2/screens/FilesScreen.tsx",
        "old": "{extractionMode === 'degraded' ? (",
        "new": "{extractionMode !== 'llm' ? (",
        "expect": "红 ①基线 + ④（heuristic 出横幅）；② 仍绿",
    },
    # M2 · 任务落定不持久化（appendFiles 异步 settle 去掉 remember）：
    # 内存态还在 → ② 仍绿；刷新即失忆 → ③ 红。两刀砍两处的自证。
    "M2": {
        "file": "src/lite2/store.ts",
        "old": "        rememberExtractionMode(contextId, settled.mode)\n",
        "new": "",
        "expect": "红 ③（刷新后横幅消失/ls 空）；② 仍绿",
    },
    # M3 · emptyArchive 不清 #89 标签（内存 + localStorage 两处一起拔——
    # 真实回归的形态就是整块被删）：清空后横幅诈尸 → ⑥ 红。
    "M3": {
        "file": "src/lite2/store.ts",
        "old": "        extractionMode: null,\n      })\n      rememberExtractionMode(contextId, null)\n",
        "new": "      })\n",
        "expect": "红 ⑥（清空后横幅还在/ls 还在）；其余绿",
    },
}


def read_bytes(p: Path) -> bytes:
    return p.read_bytes()


def apply(mid: str) -> None:
    m = MUTS[mid]
    target = ROOT / m["file"]
    raw = read_bytes(target)
    text = raw.decode("utf-8")
    # 锚点按文件真实行尾换算（仓库多为 LF；若是 CRLF 这里自动跟随）
    old = m["old"]
    if "\r\n" in text and "\n" in old:
        old = old.replace("\n", "\r\n")
    new = m["new"].replace("\n", "\r\n") if "\r\n" in text and "\n" in m["new"] else m["new"]
    hits = text.count(old)
    if hits != 1:
        sys.exit(f"[{mid}] 锚点命中 {hits} 处（要求恰好 1）——没打上不是存活，先查锚点/行尾")
    if BAK.exists() and any(BAK.glob("*.orig")):
        sys.exit("上一发变异还没 restore——连续 apply 会把变异过的字节存成备份，先 restore")
    BAK.mkdir(exist_ok=True)
    shutil.copyfile(target, BAK / (target.name + ".orig"))
    target.write_bytes(text.replace(old, new, 1).encode("utf-8"))
    print(f"[{mid}] applied → {m['file']}\n  预期：{m['expect']}")


def restore() -> None:
    if not BAK.exists():
        sys.exit("无备份可还原")
    restored = 0
    for orig in BAK.glob("*.orig"):
        name = orig.name[: -len(".orig")]
        for m in MUTS.values():
            target = ROOT / m["file"]
            if target.name == name:
                shutil.copyfile(orig, target)
                restored += 1
                print(f"restored {m['file']}")
                break
    for orig in BAK.glob("*.orig"):
        orig.unlink()
    if restored == 0:
        sys.exit("备份目录里没有认识的文件")


if __name__ == "__main__":
    if len(sys.argv) >= 3 and sys.argv[1] == "apply":
        apply(sys.argv[2])
    elif len(sys.argv) >= 2 and sys.argv[1] == "restore":
        restore()
    else:
        sys.exit(__doc__)
