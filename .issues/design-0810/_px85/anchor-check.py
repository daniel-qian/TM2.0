# -*- coding: utf-8 -*-
"""跑变异之前先自查每条锚点：**必须恰好 1 处命中**。

为什么这是一道独立的门（#84/#87 各栽过一次）：
  · 0 处命中 → 变异根本没落地，而结果长得**和「变异存活」一模一样**。
  · 2 处命中 → 改的不一定是你以为的那一处（#84 的 M-C：两根栏共用同一套规格节奏）。
stdout 只打 ASCII（本机控制台按 GBK 啃中文）。
"""
import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from mutate import MUTS, ROOT, read

bad = 0
for tag, desc, kind, rel, old, new in MUTS:
    n = read(rel).count(old)
    flag = 'ok ' if n == 1 else 'BAD'
    if n != 1:
        bad += 1
    print('%s %-5s %-4s n=%d  %s' % (flag, tag, kind, n, rel))
print('\n%d anchors, %d bad' % (len(MUTS), bad))
sys.exit(1 if bad else 0)
