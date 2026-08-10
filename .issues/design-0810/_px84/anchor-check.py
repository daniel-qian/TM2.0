# -*- coding: utf-8 -*-
"""锚点自查：每条变异的 old 串在源文件里必须**恰好命中 1 处**。
0 处 = 变异根本没应用，跑出来会长得像「变异存活」（本仓真栽过）。
2 处以上 = 改的不一定是你以为的那一处。"""
import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from mutate import MUTS, ROOT, read

bad = 0
for tag, desc, rel, gate, old, new in MUTS:
    n = read(rel).count(old)
    flag = 'OK ' if n == 1 else 'BAD'
    if n != 1:
        bad += 1
    print('%s %s  n=%d  %s' % (flag, tag, n, rel))
print('---')
print('anchors bad = %d / %d' % (bad, len(MUTS)))
sys.exit(1 if bad else 0)
