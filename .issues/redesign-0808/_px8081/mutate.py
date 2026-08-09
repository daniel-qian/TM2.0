# -*- coding: utf-8 -*-
"""#80/#81 变异跑器：每条变异**独立**跑（apply -> vite build -> 跑那道门 -> revert）。
🔴 stdout 只打 ASCII——本机控制台按 GBK 啃中文，print 中文会 UnicodeEncodeError 把跑器炸掉，
   而那时变异其实已经跑完了（#79 实收）。中文结果全部写进 mutations.md。
🔴 判「崩」不判「红」：一份 crash 掉的门连汇总行都不打印，与「全绿」在 stdout 上长得很像——
   所以这里同时看汇总行、逐条 [PASS]/[FAIL] 标记、退出码三样，缺汇总行就明说是 CRASH。"""
import subprocess, sys, os, io, re

ROOT = r'D:\avery-wt-sharp-dirac-eedec3'
OUT = os.path.join(ROOT, '.issues', 'redesign-0808', '_px8081', 'mutations.md')
ENV = dict(os.environ, VERIFY_BASE='http://127.0.0.1:5181', VERIFY_API='http://127.0.0.1:8181',
           VITE_AVERY_API_BASE='http://127.0.0.1:8181')

CSS = os.path.join('src', 'lite2', 'styles', 'lite2.css')
ROOM = os.path.join('src', 'lite2', 'screens', 'RoomScreen.tsx')
STORE = os.path.join('src', 'lite2', 'store.ts')
ICONS = os.path.join('src', 'lite2', 'icons.tsx')
BF = os.path.join('eval-harness', 'tools', 'verify-button-family.mjs')
THREADS = os.path.join('eval-harness', 'tools', 'verify-room-threads.mjs')

G_THREADS = 'eval-harness/tools/verify-room-threads.mjs'
G_REWORK = 'eval-harness/tools/verify-room-claude-rework.mjs'
G_BF = 'eval-harness/tools/verify-button-family.mjs'

CRLF = '\r\n'

MUTS = [
    ('M-H', 'sidebar reverts to "render only when threads exist"', ROOM, G_THREADS,
     '  const [open, setOpen] = useState(false)' + CRLF + '  const stampOf',
     '  const [open, setOpen] = useState(false)' + CRLF
     + '  if (!adviseThreads || adviseThreads.length === 0) return null' + CRLF + '  const stampOf'),
    ('M-I', 'newConversation keeps threadId', STORE, G_THREADS,
     '      run: emptyRunState(),' + CRLF + '      threadId: null,' + CRLF + '      _abort: null,' + CRLF + '      // \u8fd9\u6761 nudge',
     '      run: emptyRunState(),' + CRLF + '      _abort: null,' + CRLF + '      // \u8fd9\u6761 nudge'),
    ('M-J', 'new-chat button loses its disabled attribute', ROOM, G_THREADS,
     '            disabled={busy || undefined}' + CRLF + '            title={busy ? l.roomNewBusy : undefined}',
     '            title={busy ? l.roomNewBusy : undefined}'),
    ('M-K', 'store newConversation loses its busy gate', STORE, G_THREADS,
     "    const tail = turns[turns.length - 1]" + CRLF + "    if (tail && tail.run.status === 'running') return" + CRLF + '    // \u5e42\u7b49',
     '    const tail = turns[turns.length - 1]' + CRLF + '    void tail' + CRLF + '    // \u5e42\u7b49'),
    ('M-L', 'send button loses submitAriaLabel (the aria dark area)', ROOM, G_REWORK,
     '      submitAriaLabel={l.roomSendAria}' + CRLF + '      idPrefix="room"',
     '      idPrefix="room"'),
    ('M-M', 'send icon loses its explicit size', ICONS, G_REWORK,
     '  return <ArrowUp size={CONTROL_SIZE} weight={WEIGHT}',
     '  return <ArrowUp weight={WEIGHT}'),
    # ⚠ M-N 第一版把 background 写在 `.lite2-shell .lite-composer-send`（0,2,0）上，它被
    # `.lite2-shell .lite-btn.lite-btn--primary`（6304，0,3,0）压死——变异**根本没碰到被判的性质**，
    # 它“活下来”说明不了任何事。改成同样（0,3,0）的选择器，才真的换掉了实底。
    ('M-N', 'send button filled with accent instead of ink (selector strong enough to win)', CSS, G_REWORK,
     '.lite2-shell .lite-btn.lite-composer-stop {',
     '.lite2-shell .lite-btn.lite-composer-send { background: rgb(var(--lite2-accent-rgb)); }' + CRLF
     + '.lite2-shell .lite-btn.lite-composer-stop {'),
    ('M-O', 'button-family whitelist drops .lite-room-history-head', BF, G_BF,
     "  '.lite-room-history-head'," + CRLF, ''),
    ('M-P', 'room-threads driver reverts to a form-blind bare toggle click', THREADS, G_THREADS,
     '  if (await historyToggle().isVisible()) {' + CRLF + '    await historyToggle().click()' + CRLF
     + '    await page.waitForTimeout(300)' + CRLF + '  }',
     '  await historyToggle().click()' + CRLF + '  await page.waitForTimeout(300)'),
]


def read(rel):
    with open(os.path.join(ROOT, rel), 'r', encoding='utf-8', newline='') as f:
        return f.read()


def write(rel, s):
    with open(os.path.join(ROOT, rel), 'w', encoding='utf-8', newline='') as f:
        f.write(s)


def run(cmd, timeout=900):
    p = subprocess.run(cmd, cwd=ROOT, env=ENV, shell=True, capture_output=True, timeout=timeout)
    return p.returncode, (p.stdout + p.stderr).decode('utf-8', 'replace')


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
        rc, buildout = run('npx vite build --mode development', timeout=600)
        if rc != 0:
            verdict = 'BUILD-FAIL (tsc/vite refused the mutation)'
            tail = '\n'.join(buildout.strip().splitlines()[-5:])
        else:
            rc2, out = run('node %s' % gate, timeout=900)
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
        print('%s  %-38s -> %s' % (tag, gate.split('/')[-1], verdict))
        sys.stdout.flush()
    finally:
        write(rel, src)

run('npx vite build --mode development', timeout=600)

with io.open(OUT, 'a', encoding='utf-8') as f:
    for tag, desc, gate, verdict, tail in results:
        f.write('\n### %s — %s\n\n- 门：`%s`\n- 结果：**%s**\n' % (tag, desc, gate, verdict))
        if tail:
            f.write('\n```\n%s\n```\n' % tail)
print('DONE -> mutations.md')
