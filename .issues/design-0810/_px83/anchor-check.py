# -*- coding: utf-8 -*-
"""锚点自查：每条变异必须**恰好**命中 1 处。
0 处命中长得像「变异存活」（门照样全绿），是本仓记过的假绿形态之一；>1 处则会把变异
撒到自己没打算改的地方。跑变异之前一律先跑这个。stdout 只打 ASCII（本机控制台 GBK）。"""
import importlib.util, sys, os

HERE = os.path.dirname(os.path.abspath(__file__))
sys.argv = ['anchor-check', '__none_selected__']   # 让 mutate.py 一条都不跑
spec = importlib.util.spec_from_file_location('mut', os.path.join(HERE, 'mutate.py'))
mut = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mut)

bad = 0
for tag, desc, rel, gate, old, new in mut.MUTS:
    n = mut.read(rel).count(old)
    if n != 1:
        bad += 1
    print('%-5s %-14s anchors=%d %s' % (tag, os.path.basename(rel), n, '' if n == 1 else '<-- BAD'))
print('ANCHOR-CHECK: %d bad of %d' % (bad, len(mut.MUTS)))
sys.exit(1 if bad else 0)
