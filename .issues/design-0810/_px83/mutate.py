# -*- coding: utf-8 -*-
"""#83 变异跑器：每条变异**独立**跑（apply -> vite build -> 跑那道门 -> revert）。

纪律（都是本仓真栽过的坑，逐条抄自 #80/#81 那份跑器）：
🔴 stdout 只打 ASCII —— 本机控制台按 GBK 啃中文，print 中文会 UnicodeEncodeError 把跑器
   炸掉，而那时变异其实已经跑完了。中文结果全部写进 mutations.md。
🔴 判「崩」不判「红」—— 一份 crash 掉的门连汇总行都不打印，与「全绿」在 stdout 上长得
   很像。这里同时看汇总行、逐条 [PASS]/[FAIL] 标记、退出码三样，缺汇总行就明说是 CRASH。
🔴 锚点 0 处命中会长得像「变异存活」—— 所以 n != 1 一律记 ANCHOR-MISS，不跑门。
🔴 还原写的是**读进来的那份原文**（newline='' 读、newline='' 写），不做任何规范化：
   本仓有过「还原时把全仓 CRLF 压平」的事故。
⚠ 两个源文件**整份都是 CRLF**（本票新增的那些行也是——Edit 落盘时跟着文件走了）。
   第一版锚点写的 '\\n'，12 条里 11 条 ANCHOR-MISS、剩下一条撞上 2 处——正是
   「锚点 0 处命中长得像变异存活」那个陷阱的现场。所以这里一律用 CRLF，且每次改锚点
   先跑一遍下面那句自查：
     python -c "...; for m in MUTS: print(tag, src.count(old))"   # 每条必须恰好 1
"""
import subprocess, sys, os, io, re

ROOT = r'D:\avery-wt-fervent-kalam-95e0f0'
OUT = os.path.join(ROOT, '.issues', 'design-0810', '_px83', 'mutations.md')
ENV = dict(os.environ, VERIFY_BASE='http://127.0.0.1:5283', VERIFY_API='http://127.0.0.1:8283',
           VITE_AVERY_API_BASE='http://127.0.0.1:8283')

CSS = os.path.join('src', 'lite2', 'styles', 'lite2.css')
ROOM = os.path.join('src', 'lite2', 'screens', 'RoomScreen.tsx')
G_RAIL = 'eval-harness/tools/verify-room-rail.mjs'

# 两个源文件整份 CRLF（含本票新增的行）。锚点一律用它，别用裸 '\n'。
LF = '\r\n'

MUTS = [
    # ── 世界 A · 桌面栏规格 ────────────────────────────────────────────────────
    ('M-A', 'rail background reverts to the opaque #80 white card', CSS, G_RAIL,
     '  background: rgba(var(--lite2-ink-rgb), 0.035);' + LF + '  /* ',
     '  background: rgb(var(--lite2-surface-rgb));' + LF + '  /* '),
    ('M-B', 'rail goes back to floating between clear-top and the bottom band', CSS, G_RAIL,
     '  top: 0;' + LF + '  bottom: 0;' + LF + '  /* ',
     '  /* '),
    # ⚠ 第一轮 M-C **活了下来**（39/1，只红了一条无关的？不——40/0 全绿）：A⑤ 当时只量行高
    #   `[30,40]`，而两行式在「时刻已撤、单轮无 pill」之后恰好收成 **40px**，正落在尺子里。
    #   门补了一条「轮数与标题并排」的正面判据 + 把上界收到 36 之后，本条 39/2 红。
    #   碑：**变异活下来八成是门洞不是代码 bug**——尺子太宽对着真违规也全绿。
    ('M-C', 'history rows go back to the two-line (column) layout', CSS, G_RAIL,
     '  flex-direction: row;' + LF + '  align-items: center;' + LF + '  gap: 8px;' + LF + '  min-height: 34px;',
     '  flex-direction: column;' + LF + '  align-items: stretch;' + LF + '  gap: 4px;' + LF + '  min-height: 34px;'),
    ('M-D', 'timestamp is shown at rest again (display:none dropped)', CSS, G_RAIL,
     '.lite-room-history-date {' + LF + '  display: none;' + LF + '  flex: none;',
     '.lite-room-history-date {' + LF + '  flex: none;'),
    ('M-E', 'single-exchange threads render meta text again', ROOM, G_RAIL,
     '            {thread.runs.length > 1 ? (' + LF
     + '              <span className="lite-room-history-turns">' + LF
     + '                {fill(l.roomHistoryTurns, { n: thread.runs.length })}' + LF
     + '              </span>' + LF
     + '            ) : null}',
     '            <span className="lite-room-history-turns">' + LF
     + '              {thread.runs.length > 1' + LF
     + '                ? fill(l.roomHistoryTurns, { n: thread.runs.length })' + LF
     + "                : '\u5355\u72ec\u95ee\u8fc7\u4e00\u6b21'}" + LF
     + '            </span>'),
    # ⚠ 第一轮 M-F 也**活了下来**（40/0）：`getComputedStyle(el, '::before')` 对一个根本没生成
    #   的伪元素照样把规则里写的 width/background 原样吐回来，判据读到的 2px/accent 全对，
    #   而屏上封条整条消失。门补了 `content !== 'none' && !== 'normal'` 之后本条 40/1 红。
    ('M-F', 'selected row loses its 2px accent seal (::before dropped)', CSS, G_RAIL,
     '.lite2-shell .lite-room-aside .lite-room-history-list li.is-current .lite-room-history-head::before {' + LF
     + "  content: '';",
     '.lite2-shell .lite-room-aside .lite-room-history-list li.is-current .lite-room-history-head::before {' + LF
     + '  content: none;' + LF + "  --unused: '';"),
    ('M-G', 'group label falls back to --ink-faint (the #80 gravestone)', CSS, G_RAIL,
     '.lite2-shell .lite-room-aside-group-label {' + LF + '  font-weight: 700;' + LF + '}',
     '.lite2-shell .lite-room-aside-group-label {' + LF + '  font-weight: 700;' + LF
     + '  color: var(--ink-faint);' + LF + '}'),
    ('M-H', 'welcome block is no longer centred in the rectangle', CSS, G_RAIL,
     "  min-height: 100%;" + LF + '  justify-content: center;' + LF + '}',
     '  min-height: 100%;' + LF + '}'),
    # ── 世界 B · 手机抽屉 ──────────────────────────────────────────────────────
    ('M-I', 'drawer reuses the desktop translucent tint (glass over the content)', CSS, G_RAIL,
     '    background: rgb(var(--lite2-surface-rgb));' + LF + '    box-shadow: var(--shadow);',
     '    background: rgba(var(--lite2-ink-rgb), 0.035);' + LF + '    box-shadow: var(--shadow);'),
    ('M-J', 'drawer sinks below the scrim (opaque, but no longer on top)', CSS, G_RAIL,
     '    box-shadow: var(--shadow);' + LF + '    z-index: 47;',
     '    box-shadow: var(--shadow);' + LF + '    z-index: 45;'),
    ('M-K', 'scrim is never rendered', ROOM, G_RAIL,
     '      {open ? (' + LF
     + '        <button' + LF
     + '          type="button"' + LF
     + '          className="lite-btn lite-room-aside-scrim"' + LF
     + '          data-history-scrim=""' + LF
     + '          aria-label={l.roomHistoryScrimAria}' + LF
     + '          onClick={() => setOpen(false)}' + LF
     + '        />' + LF
     + '      ) : null}' + LF,
     ''),
    # ⚠ 锚点必须带上 animation 那一行：光 `.lite-room-aside.is-open {` 在本文件里有**两处**
    #   （#80 那份 `display:flex` 的开关也长这样），自查时实测 count=2。
    ('M-L', 'drawer row titles get a washed-out grey (AA floor broken inside the drawer)', CSS, G_RAIL,
     '  .lite2-shell .lite-room-aside.is-open {' + LF + '    animation: lite2-room-drawer-in 180ms ease;',
     '  .lite2-shell .lite-room-aside .lite-room-history-q { color: #b9b3a6; }' + LF + LF
     + '  .lite2-shell .lite-room-aside.is-open {' + LF + '    animation: lite2-room-drawer-in 180ms ease;'),
]


def read(rel):
    with open(os.path.join(ROOT, rel), 'r', encoding='utf-8', newline='') as f:
        return f.read()


def write(rel, s):
    with open(os.path.join(ROOT, rel), 'w', encoding='utf-8', newline='') as f:
        f.write(s)


def run(cmd, timeout=1200):
    p = subprocess.run(cmd, cwd=ROOT, env=ENV, shell=True, capture_output=True, timeout=timeout)
    return p.returncode, (p.stdout + p.stderr).decode('utf-8', 'replace')


# ⚠ 整段跑器包在 __main__ 里：anchor-check.py 要 import 本文件读 MUTS，不包的话
#   import 一次就顺手跑一次 `vite build`（第一版真这么干了，白等半分钟还看不出为什么）。
def main():
  results = []
  only = sys.argv[1:] or [m[0] for m in MUTS]
  for tag, desc, rel, gate, old, new in MUTS:
    if tag not in only:
        continue
    src = read(rel)
    n = src.count(old)
    if n != 1:
        results.append((tag, desc, gate, 'ANCHOR-MISS n=%d (mutation never applied)' % n, ''))
        print('%s ANCHOR-MISS n=%d' % (tag, n))
        sys.stdout.flush()
        continue
    write(rel, src.replace(old, new, 1))
    try:
        rc, buildout = run('npx vite build --mode development', timeout=900)
        if rc != 0:
            verdict = 'BUILD-FAIL (tsc/vite refused the mutation)'
            tail = '\n'.join(buildout.strip().splitlines()[-5:])
        else:
            rc2, out = run('node %s' % gate, timeout=1200)
            marks = re.findall(r'\[(PASS|FAIL)\]', out)
            summary = re.search(r'(\d+) PASS \u00b7 (\d+) FAIL', out)
            if summary:
                verdict = '%s PASS / %s FAIL' % (summary.group(1), summary.group(2))
            elif marks:
                verdict = ('%d PASS / %d FAIL [CRASH mid-run: summary line never printed]'
                           % (marks.count('PASS'), marks.count('FAIL')))
            else:
                verdict = 'CRASH (rc=%d, not one assertion printed)' % rc2
            fails = [l.strip() for l in out.splitlines() if l.strip().startswith('[FAIL]')]
            tail = '\n'.join(fails[:6]) if fails else '\n'.join(out.strip().splitlines()[-5:])
        results.append((tag, desc, gate, verdict, tail))
        print('%s  %-34s -> %s' % (tag, gate.split('/')[-1], verdict))
        sys.stdout.flush()
    finally:
        write(rel, src)

  run('npx vite build --mode development', timeout=900)

  with io.open(OUT, 'a', encoding='utf-8') as f:
    for tag, desc, gate, verdict, tail in results:
        f.write('\n### %s — %s\n\n- 门：`%s`\n- 结果：**%s**\n' % (tag, desc, gate, verdict))
        if tail:
            f.write('\n```\n%s\n```\n' % tail)
  print('DONE -> mutations.md')


if __name__ == '__main__':
    main()
