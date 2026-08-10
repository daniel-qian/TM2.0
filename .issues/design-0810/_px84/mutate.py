# -*- coding: utf-8 -*-
"""#84 变异跑器：每条变异**独立**跑（apply -> vite build -> 跑那道门 -> revert）。

纪律逐条抄自 #83 那份跑器（都是本仓真栽过的坑）：
🔴 stdout 只打 ASCII —— 本机控制台按 GBK 啃中文，print 中文会 UnicodeEncodeError 把跑器
   炸掉，而那时变异其实已经跑完了。中文结果全部写进 mutations.md。
🔴 判「崩」不判「红」—— 一份 crash 掉的门连汇总行都不打印，与「全绿」在 stdout 上长得
   很像。这里同时看汇总行、逐条 [PASS]/[FAIL] 标记、退出码三样，缺汇总行就明说是 CRASH。
🔴 锚点 0 处命中会长得像「变异存活」—— 所以 n != 1 一律记 ANCHOR-MISS，不跑门。
🔴 还原写的是**读进来的那份原文**（newline='' 读、newline='' 写），不做任何规范化：
   本仓有过「还原时把全仓 CRLF 压平」的事故。
⚠ 与 #83 不同：本票四个源文件整份都是 **LF**（实测 `CRLF=0`），所以锚点一律用 '\\n'。
  改锚点先跑一遍 anchor-check：每条必须恰好 1 处命中。
🔴 **每条主判据配一个专属变异**，而不是「一条变异红一条判据就算数」——一条变异红了
   不证明它旁边那条判据也有牙（#83 立的碑）。
"""
import subprocess, sys, os, io, re

ROOT = r'D:\avery-wt-happy-kirch-a20595'
OUT = os.path.join(ROOT, '.issues', 'design-0810', '_px84', 'mutations.md')
ENV = dict(os.environ, VERIFY_BASE='http://127.0.0.1:5284', VERIFY_API='http://127.0.0.1:8284',
           VITE_AVERY_API_BASE='http://127.0.0.1:8284')

CSS = os.path.join('src', 'lite2', 'styles', 'lite2.css')
SCR = os.path.join('src', 'lite2', 'screens', 'FilesScreen.tsx')
MAN = os.path.join('src', 'lite2', 'FileManifest.tsx')
BELL = os.path.join('src', 'lite2', 'notifyStore.ts')

G_EXP = 'eval-harness/tools/verify-files-explorer.mjs'
G_EMPTY = 'eval-harness/tools/verify-archive-empty.mjs'
G_IA = 'eval-harness/tools/verify-files-ia.mjs'
G_FORMS = 'eval-harness/tools/verify-forms-proactive.mjs'
G_APPEND = 'eval-harness/tools/verify-append-story.mjs'

LF = '\n'

MUTS = [
    # ── 左栏规格（A②A③）──────────────────────────────────────────────────────────
    ('M-A', 'rail goes back to an opaque white card (raised, not sunken)', CSS, G_EXP,
     '  background: rgba(var(--lite2-ink-rgb), 0.035);' + LF + '  border-right: 1px solid var(--rule);',
     '  background: rgb(var(--lite2-surface-rgb));' + LF + '  border-right: 1px solid var(--rule);'),
    ('M-B', 'rail floats between clear-top and the bottom band again', CSS, G_EXP,
     '  left: 0;' + LF + '  top: 0;' + LF + '  bottom: 0;' + LF + '  width: var(--lite2-files-rail-w);',
     '  left: 0;' + LF + '  top: 96px;' + LF + '  bottom: 120px;' + LF + '  width: var(--lite2-files-rail-w);'),
    # ⚠ 锚点必须带上选择器那一行：`width:100%; min-height:34px; padding:0 10px` 这三行在
    #   本文件里有**两处**——#83 的 `.lite-room-new` 逐字相同（规格 §2.2 本来就要求两根栏
    #   同一套节奏）。自查实测 n=2，正是「锚点撞多处 = 改的不一定是你以为的那一处」。
    ('M-C', 'rail rows lose the 34px single-line rhythm', CSS, G_EXP,
     '.lite2-shell .lite-btn.lite-files-rail-row {' + LF
     + '  position: relative;' + LF + '  display: flex;' + LF + '  align-items: center;' + LF
     + '  justify-content: flex-start;' + LF + '  gap: 8px;' + LF + '  width: 100%;' + LF
     + '  min-height: 34px;',
     '.lite2-shell .lite-btn.lite-files-rail-row {' + LF
     + '  position: relative;' + LF + '  display: flex;' + LF + '  align-items: center;' + LF
     + '  justify-content: flex-start;' + LF + '  gap: 8px;' + LF + '  width: 100%;' + LF
     + '  min-height: 44px;'),
    ('M-D', 'selected rail row loses its 2px accent seal (::before never generated)', CSS, G_EXP,
     ".lite-files-rail-row[data-current='1']::before {" + LF + "  content: '';",
     ".lite-files-rail-row[data-current='1']::before {" + LF + '  content: none;' + LF + "  --unused: '';"),
    # ⚠ 第一版把 `color: var(--ink-faint);` 插在**规则开头**，而同一条规则后面本来就写着
    #   `color: var(--ink-soft);`——同权重后写者胜，这条变异是**空的**（它活下来不是判据没牙）。
    #   要改就改那一句本身。
    ('M-E', 'rail group label falls back to --ink-faint (the #80 gravestone)', CSS, G_EXP,
     '.lite2-shell .lite-files-rail-group-label {' + LF + '  margin: 0 10px 4px;' + LF
     + '  font-size: 11px;' + LF + '  font-weight: 700;' + LF + '  color: var(--ink-soft);',
     '.lite2-shell .lite-files-rail-group-label {' + LF + '  margin: 0 10px 4px;' + LF
     + '  font-size: 11px;' + LF + '  font-weight: 700;' + LF + '  color: var(--ink-faint);'),

    # ── 表格（A⑥A⑦A⑧A⑨ + 病根④）────────────────────────────────────────────────
    ('M-F', 'file rows go back to the flex-wrap soup (grid dropped)', CSS, G_EXP,
     '.lite2-shell .upload-files--table .upload-file-row {' + LF
     + '  display: grid;' + LF
     + '  grid-template-columns: minmax(0, 1fr) 76px 96px 132px 92px 72px;',
     '.lite2-shell .upload-files--table .upload-file-row {' + LF
     + '  display: flex;' + LF
     + '  flex-wrap: wrap;' + LF
     + '  grid-template-columns: minmax(0, 1fr) 76px 96px 132px 92px 72px;'),
    ('M-G', 'number columns lose tabular-nums and right alignment', CSS, G_EXP,
     '  font-variant-numeric: tabular-nums;' + LF
     + '  font-size: 12px;' + LF
     + '  color: var(--ink-soft);' + LF
     + '  text-align: right;' + LF + '}',
     '  font-size: 12px;' + LF
     + '  color: var(--ink-soft);' + LF + '}'),
    ('M-H', 'row actions collapse the cell when idle (display:none instead of opacity)', CSS, G_EXP,
     '  justify-content: flex-end;' + LF + '  opacity: 0;' + LF + '  transition: opacity 120ms;',
     '  justify-content: flex-end;' + LF + '  display: none;' + LF + '  transition: opacity 120ms;'),
    ('M-I', 'hidden row actions also stop receiving pointer events (the crash-the-gate shape)',
     CSS, G_EXP,
     '  opacity: 0;' + LF + '  transition: opacity 120ms;',
     '  opacity: 0;' + LF + '  pointer-events: none;' + LF + '  transition: opacity 120ms;'),
    ('M-J', 'the table loses its 1120px reading cap and stretches to the pane', CSS, G_EXP,
     '  --lite2-files-read-max: 1120px;',
     '  --lite2-files-read-max: 100%;'),
    ('M-K', 'mobile rows lose the written-down cell placement (auto-flow again)', CSS, G_EXP,
     '  .lite2-shell .upload-files--table .upload-file-name   { grid-column: 1 / 5; grid-row: 1; }' + LF
     + '  .lite2-shell .upload-files--table .upload-file-status { grid-column: 1;     grid-row: 2; }' + LF
     + '  .lite2-shell .upload-files--table .upload-file-size   { grid-column: 2;     grid-row: 2; }' + LF
     + '  .lite2-shell .upload-files--table .upload-file-chunks { grid-column: 3;     grid-row: 2; }' + LF
     + '  .lite2-shell .upload-files--table .upload-file-time   { grid-column: 4;     grid-row: 2; }' + LF
     + '  .lite2-shell .upload-files--table .upload-file-acts   { grid-column: 5;     grid-row: 1 / 3; }' + LF,
     ''),
    ('M-L', 'file rows become flex-shrinkable again (the squashed-rows bug found by hand)',
     CSS, G_EXP,
     '  flex: none;' + LF + '  min-height: 38px;' + LF + '  border-radius: 6px;',
     '  min-height: 38px;' + LF + '  border-radius: 6px;'),
    # ⚠ 同 M-C：这三行与 #83 的对话抽屉逐字相同（自查实测 n=2）。锚点带上后面那条
    #   `.lite-files-rail.is-open` 才唯一。
    ('M-M', 'mobile drawer reuses the desktop translucent tint (glass over the content)',
     CSS, G_EXP,
     '    background: rgb(var(--lite2-surface-rgb));' + LF + '    box-shadow: var(--shadow);' + LF
     + '    z-index: 47;' + LF + '  }' + LF + LF + '  .lite2-shell .lite-files-rail.is-open {',
     '    background: rgba(var(--lite2-ink-rgb), 0.035);' + LF + '    box-shadow: var(--shadow);' + LF
     + '    z-index: 47;' + LF + '  }' + LF + LF + '  .lite2-shell .lite-files-rail.is-open {'),

    # ── 上传口 / 拖放（A①A⑩ + append-story ②）───────────────────────────────────
    ('M-N', 'the workbench stops accepting drops (only the old small box would)', SCR, G_EXP,
     '          if (activeZone !== \'files\' || uploadBlocked) return' + LF
     + '          e.preventDefault()' + LF
     + '          up.setDragOver(true)',
     '          if (activeZone !== \'files\' || uploadBlocked) return' + LF
     + '          e.preventDefault()'),
    ('M-O', 'the toolbar uploader is wired to uploadFiles even when an archive exists',
     SCR, G_APPEND,
     "  const uploadMode: 'new' | 'append' = canAppendNow ? 'append' : 'new'",
     "  const uploadMode: 'new' | 'append' = 'new'"),

    # ── 清空这份档案（archive-empty ⑦ —— ROSTER 明写要封的那条缺口）──────────────
    ('M-P', 'the empty button is wired to the wrong action (uploadFiles, not emptyArchive)',
     SCR, G_EMPTY,
     '            void emptyArchive().then((ok) => {' + LF + '              if (ok) onClose(true)' + LF
     + '            })',
     '            void Promise.resolve(true).then((ok) => {' + LF + '              if (ok) onClose(true)' + LF
     + '            })'),
    ('M-Q', 'the hard confirm degrades to "any non-empty string unlocks it"', SCR, G_EMPTY,
     '  const armed = typed.trim() === l.filesEmptyConfirmWord',
     '  const armed = typed.trim().length > 0'),

    # ── IA（files-ia ③④）─────────────────────────────────────────────────────────
    ('M-R', 'the rail puts "start a separate company" ahead of standing forms again',
     SCR, G_IA,
     '          {formsZoneOn ? (' + LF
     + '            <RailRow' + LF
     + "              id=\"forms\" label={l.formsTitle} icon={<FormsZoneIcon />}",
     '          {false && formsZoneOn ? (' + LF
     + '            <RailRow' + LF
     + "              id=\"forms\" label={l.formsTitle} icon={<FormsZoneIcon />}"),
    # ⚠ 第一版 M-S 写的是把类名改成 `...-edit-block-moved`，**活了下来**——判据用的是
    #   `className.includes('lite-files-forms-edit-block')`，而改名后的串**包含**原名，
    #   而且元素压根没挪窝。变异本身是空的，不是判据没牙。
    #   现在拆成两条，各盯判据的一半：M-S 盯「这一块还在不在」，M-S2 盯「它是不是最后一块」。
    ('M-S', 'the form builder block is renamed out from under the criterion', SCR, G_IA,
     '      <div className="lite-files-forms-edit-block">',
     '      <div className="lite-files-forms-editblk">'),
    ('M-S2', 'something else gets appended after the builder (it is no longer last)', SCR, G_IA,
     '        <FormBuilder templates={templates ?? []} />' + LF
     + '      </div>' + LF
     + '    </section>',
     '        <FormBuilder templates={templates ?? []} />' + LF
     + '      </div>' + LF
     + '      <p className="lite-files-forms-note">{l.formsLinksNote}</p>' + LF
     + '    </section>'),

    # ── 通知深链（forms-proactive ③e）────────────────────────────────────────────
    ('M-T', 'the form notification stops deep-linking into the standing-forms zone',
     BELL, G_FORMS,
     "  form: { zone: 'forms' },",
     "  // form: { zone: 'forms' },"),
]


def read(rel):
    with open(os.path.join(ROOT, rel), 'r', encoding='utf-8', newline='') as f:
        return f.read()


def write(rel, s):
    with open(os.path.join(ROOT, rel), 'w', encoding='utf-8', newline='') as f:
        f.write(s)


def run(cmd, timeout=1800):
    p = subprocess.run(cmd, cwd=ROOT, env=ENV, shell=True, capture_output=True, timeout=timeout)
    return p.returncode, (p.stdout + p.stderr).decode('utf-8', 'replace')


# ⚠ 整段跑器包在 __main__ 里：anchor-check 要 import 本文件读 MUTS，不包的话 import 一次
#   就顺手跑一次 `vite build`。
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
                rc2, out = run('node %s' % gate, timeout=1800)
                marks = re.findall(r'\[(PASS|FAIL)\]', out) or re.findall(r'^\s*(PASS|FAIL)\s', out, re.M)
                summary = re.search(r'(\d+) PASS \u00b7 (\d+) FAIL', out) \
                    or re.search(r'(\d+)/(\d+) PASS', out)
                if summary:
                    verdict = '%s PASS / %s FAIL' % (summary.group(1), summary.group(2))
                elif marks:
                    verdict = ('%d PASS / %d FAIL [CRASH mid-run: summary line never printed]'
                               % (marks.count('PASS'), marks.count('FAIL')))
                else:
                    verdict = 'CRASH (rc=%d, not one assertion printed)' % rc2
                fails = [l.strip() for l in out.splitlines()
                         if l.strip().startswith('[FAIL]') or l.strip().startswith('FAILED')
                         or l.strip().startswith('FAIL ')]
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
