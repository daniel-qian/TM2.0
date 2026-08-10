"""#88 变异台架。

三条自保（都被咬过，见 memory「变异跑器自己会撒谎」）：
  ① 锚点必须**恰好命中一次**，0 次命中会长得像「变异存活」；
  ② 打完之后**回读比对**，证明文件真的变了（不是 replace 出去一个相同的串）；
  ③ 还原走 shutil.copy2 的字节副本，**绝不**重写内容（重写会压平 CRLF，把全仓 diff 炸掉）。

用法：
  python mutate.py apply  <file> <anchor-file> <replacement-file>
  python mutate.py restore <file>
备份落在 <file>.mutbak，restore 之后自行删除。
"""
import io
import os
import shutil
import sys


def apply(path, anchor_path, repl_path):
    anchor = io.open(anchor_path, encoding="utf-8", newline="").read().replace("\r\n", "\n")
    repl = io.open(repl_path, encoding="utf-8", newline="").read().replace("\r\n", "\n")
    raw = io.open(path, "rb").read()
    crlf = b"\r\n" in raw
    if crlf:
        anchor, repl = anchor.replace("\n", "\r\n"), repl.replace("\n", "\r\n")
    s = io.open(path, encoding="utf-8", newline="").read()
    n = s.count(anchor)
    if n != 1:
        sys.exit(f"MUTATION NOT APPLIED: 锚点命中 {n} 次（必须恰好 1 次）—— 别把这一轮读成「变异存活」")
    if anchor == repl:
        sys.exit("MUTATION NOT APPLIED: 锚点与替换串一模一样，这是一次空变异")
    shutil.copy2(path, path + ".mutbak")
    out = s.replace(anchor, repl)
    io.open(path, "w", encoding="utf-8", newline="").write(out)
    back = io.open(path, encoding="utf-8", newline="").read()
    if back == s:
        sys.exit("MUTATION NOT APPLIED: 回读与原文相同")
    print(f"MUTANT APPLIED to {path} ({len(s)} -> {len(back)} chars)")


def restore(path):
    bak = path + ".mutbak"
    if not os.path.exists(bak):
        sys.exit(f"NO BACKUP for {path}")
    shutil.copy2(bak, path)
    os.remove(bak)
    print(f"RESTORED {path}")


if __name__ == "__main__":
    if sys.argv[1] == "apply":
        apply(sys.argv[2], sys.argv[3], sys.argv[4])
    else:
        restore(sys.argv[2])
