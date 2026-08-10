# -*- coding: utf-8 -*-
"""#85 变异跑器：每条变异**独立**跑（apply -> 跑它那道门 -> revert）。

两种变异，跑法不同：
  · `py`  后端（extract.py / registry.py）→ 直接跑 pytest（进程内，不必重起 uvicorn）。
  · `js`  前端（changeLog.ts / FilesScreen.tsx）→ `vite build` 之后跑真浏览器那道门。

纪律逐条抄自 #83/#84 那两份跑器（都是本仓真栽过的坑）：
🔴 stdout 只打 ASCII —— 本机控制台按 GBK 啃中文，print 中文会 UnicodeEncodeError 把跑器
   炸掉，而那时变异其实已经跑完了。中文结果全部写进 mutations.md。
🔴 判「崩」不判「红」—— 一份 crash 掉的门连汇总行都不打印，与「全绿」在 stdout 上长得
   很像。这里同时看汇总行、逐条 [PASS]/[FAIL] 标记、退出码三样，缺汇总行就明说是 CRASH。
🔴 锚点 0 处命中会长得像「变异存活」—— 所以 n != 1 一律记 ANCHOR-MISS，不跑门。
🔴 还原写的是**读进来的那份原文**（`newline=''` 读写，不做任何规范化）：本仓有过
   「还原时把全仓 CRLF 压平」的事故。⚠ 本票四个源文件整份都是 **CRLF**（实测 bareLF=0），
   所以锚点里的换行一律用 '\\r\\n'。
🔴 **每条主判据配一个专属变异**——一条变异红了不证明它旁边那条判据也有牙（#83 立的碑）。
"""
import subprocess, sys, os, io, re

ROOT = r'D:\avery-wt-elated-maxwell-b1fe52'
OUT = os.path.join(ROOT, '.issues', 'design-0810', '_px85', 'mutations.md')
ENV = dict(os.environ, VERIFY_BASE='http://127.0.0.1:5285', VERIFY_API='http://127.0.0.1:8285',
           VITE_AVERY_API_BASE='http://127.0.0.1:8285',
           AVERY_BRAIN='mock', AVERY_EXTRACTOR='heuristic', AVERY_EMBEDDINGS='keyword', TZ='UTC')

EXT = os.path.join('eval-harness', 'avery', 'ingest', 'extract.py')
REG = os.path.join('eval-harness', 'avery', 'ingest', 'registry.py')
CL = os.path.join('src', 'lite2', 'changeLog.ts')
SCR = os.path.join('src', 'lite2', 'screens', 'FilesScreen.tsx')
CSS = os.path.join('src', 'lite2', 'styles', 'lite2.css')

# 后端两条判据面：本票自己那份 + #87 被本票改判的那份（M-F 专门盯它）。
PY_GATE = ('cd eval-harness && python -m pytest -q -p no:cacheprovider '
           'tests/test_change_log_t85.py tests/test_entity_lineage_t87.py -m "not needs_db"')
JS_GATE = 'node eval-harness/tools/verify-change-log.mjs'

N = '\r\n'

MUTS = [
    # ══ 后端 ══════════════════════════════════════════════════════════════════════
    ('M-A', 'a card created by an append no longer records its birth batch', 'py', EXT,
     '    bid = (batch_id or "").strip()' + N + '    if not bid:' + N + '        return',
     '    bid = (batch_id or "").strip()' + N + '    if bid or not bid:' + N + '        return'),
    # ⚠ 第一版 M-B 打的是 `note_added_in` 里那句「已经有出生批次就不改写」——**存活**。
    #   查下去不是门洞：两处调用点传的都是 `incoming`（刚抽出来的读数，从不带 added_in），
    #   那句守卫在现行链路上够不着，是死枝。碑立在函数 docstring 里，M-B 改打一条有牙的：
    #   表单回流建的新人卡也被记成一次「补料新增」（那条边界是本票明写的产品分寸）。
    ('M-B', 'a person created by a form submission is logged as an upload change', 'py', EXT,
     '        if ledger is not None:' + N + '            note_added_in(incoming, ledger.batch_id)',
     '        note_added_in(incoming, ledger.batch_id if ledger is not None else "b-form")'),
    ('M-C', 'being mentioned by a batch counts as being born in it', 'py', EXT,
     '        absorb_sources(cur, incoming)',
     '        absorb_sources(cur, incoming)' + N + '        note_added_in(cur, self.batch_id)'),
    ('M-D', 'the person card stops projecting its lineage', 'py', REG,
     '        if getattr(p, "lineage", None):' + N + '            card["lineage"] = dict(p.lineage)',
     '        if False and getattr(p, "lineage", None):' + N
     + '            card["lineage"] = dict(p.lineage)'),
    # 🔴 这一条是「投影层挑漏一条谁也不会红」的守门人：卡上仍有 lineage、docs/added_in 全在，
    #    只有 prev 链被悄悄摘掉。判「有几个键」的判据对它全绿，判「整本相等」的才红。
    ('M-E', 'the project projection silently drops the prev chain (looks complete, is not)',
     'py', REG,
     '        if getattr(pr, "lineage", None):' + N
     + '            card["lineage"] = dict(pr.lineage)',
     '        if getattr(pr, "lineage", None):' + N
     + '            _lin = dict(pr.lineage)' + N
     + '            _lin["fields"] = {k: {a: b for a, b in v.items() if a != "prev"}' + N
     + '                              for k, v in (_lin.get("fields") or {}).items()}' + N
     + '            card["lineage"] = _lin'),
    ('M-F', 'the birth batch is stamped into provenance instead (the two side-cars blurred)',
     'py', EXT,
     '    lin = _lineage_of(entity)' + N + '    if lin.get("added_in"):' + N + '        return' + N
     + '    lin["added_in"] = bid',
     '    lin = _lineage_of(entity)' + N + '    if lin.get("added_in"):' + N + '        return' + N
     + '    lin["added_in"] = bid' + N
     + '    try:' + N
     + '        entity.provenance["__added_in"] = {"origin": "doc", "source": bid,' + N
     + '                                           "updated_at": "", "batch": bid}' + N
     + '    except Exception:' + N
     + '        pass'),

    # ══ 前端 ══════════════════════════════════════════════════════════════════════
    # 判据只看 lineage、不看 `provenance.origin` —— 首次上传的每一格当场涌进流水。
    # 这正是本票「便宜」的全部理由所在的那一行。
    ('M-G', 'the doc-origin gate is dropped (first-upload cells flood the trail)', 'js', CL,
     "    if (originOf(card, field) !== 'doc') continue",
     "    if (originOf(card, field) === '__never__') continue"),
    ('M-H', 'status prints the normalized token instead of the word on the card', 'js', CL,
     "  if (field === 'status') return statusTextLabel(String(value), l)",
     "  if (field === 'status') return String(value)"),
    # ⚠ 第一版把 `hasPrev` 直接改成 `true`，于是 `prev!.value` 对 undefined 解引用 —— 整屏
    #   崩掉。门确实逮到了（2 FAIL + CRASH），但**一条把页面打崩的变异比一条让 UI 跑着却
    #   说错话的变异弱**：前者随便哪条判据都能红，证明不了「⑤ 那条判据有牙」。改成只动
    #   分类：什么都算「改写」，enrichment 那一类从此不存在。
    ('M-I', 'every change is reported as an overwrite (the enrichment class disappears)',
     'js', CL,
     "      kind: hasPrev ? 'updated' : 'filled',",
     "      kind: 'updated',"),
    ('M-J', 'the row id forgets which document changed the cell', 'js', CL,
     '      id: `${subjectKind}:${card.id}:${field}:${docKey}`,',
     '      id: `${subjectKind}:${card.id}:${field}`,'),
    # \u26a0 \u951a\u70b9\u523b\u610f**\u907f\u5f00\u90a3\u6761\u6b63\u5219\u91cc\u7684 CJK \u5b57\u9762\u91cf**\uff1a\u7b2c\u4e00\u7248\u628a\u6574\u6bb5\u6b63\u5219\u6284\u8fdb\u951a\u70b9\uff0cn=0
    #   \uff08\u5b57\u9762\u91cf\u9010\u5b57\u5bf9\u4e0d\u4e0a\uff0c\u800c 0 \u5904\u547d\u4e2d\u957f\u5f97\u548c\u300c\u53d8\u5f02\u5b58\u6d3b\u300d\u4e00\u6a21\u4e00\u6837\u2014\u2014anchor-check \u5c31\u662f
    #   \u4e3a\u902e\u8fd9\u4e00\u4e0b\u5b58\u5728\u7684\uff09\u3002\u6539\u6210\u53ea\u52a8\u6743\u91cd\u90a3\u4e00\u4f4d\uff1a\u5168\u89d2\u6309 1 \u7b97 == \u6309 `.length` \u622a\u3002
    ('M-K', 'the clamp counts .length instead of display width (full-width weighs 1)', 'js', CL,
     '      .test(ch) ? 2 : 1' + N + '    if (used + w > budget)',
     '      .test(ch) ? 1 : 1' + N + '    if (used + w > budget)'),
    ('M-L', 'the rail count shows the total instead of what is still unread', 'js', SCR,
     '    (n, g) => n + g.rows.filter((r) => changeMarks[`${CHANGE_MARK}${r.id}`] !== \'resolved\').length,',
     '    (n, g) => n + g.rows.length,'),
    ('M-M', 'read rows stay in the trail (marking one changes nothing on screen)', 'js', SCR,
     '  const visible = (group: ChangeGroup) => group.rows.filter((r) => showRead || !isRead(r))',
     '  const visible = (group: ChangeGroup) => group.rows'),
    ('M-N', 'the citation jumps to the Documents zone without filtering to that file', 'js', SCR,
     '              setFilter(docKey)' + N + "              setZone('files')",
     "              setZone('files')"),
    # 🔴 这一条是**人眼看图**逮到的那个 bug 的回归锁：`.lite-btn` 基类是居中 inline-flex，
    #    溢出时文字朝两头同时溢，引文两端各被切掉一个字，而所有读 textContent 的判据全绿。
    ('M-O', 'the citation goes back to the centred inline-flex (clipped at both ends)', 'js', CSS,
     '.lite2-shell .lite-btn.lite-changes-cite {' + N + '  display: inline-block;' + N
     + '  max-width: 32ch;',
     '.lite2-shell .lite-btn.lite-changes-cite {' + N + '  max-width: 26ch;'),
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


def verdict_of(kind, out, rc):
    if kind == 'py':
        m = re.search(r'(\d+) failed, (\d+) passed', out) or re.search(r'(\d+) failed', out)
        if m:
            return '%s FAIL (pytest)' % m.group(1), [l for l in out.splitlines()
                                                     if l.startswith('FAILED')][:8]
        if re.search(r'(\d+) passed', out) and 'failed' not in out and 'error' not in out.lower():
            return 'ALL GREEN (pytest) <-- SURVIVED', []
        return 'CRASH (pytest rc=%d)' % rc, out.strip().splitlines()[-5:]
    marks = re.findall(r'\[(PASS|FAIL)\]', out)
    summary = re.search(r'(\d+) PASS \u00b7 (\d+) FAIL', out)
    if summary:
        v = '%s PASS / %s FAIL' % (summary.group(1), summary.group(2))
        if summary.group(2) == '0':
            v += ' <-- SURVIVED'
        return v, [l.strip() for l in out.splitlines() if l.strip().startswith('  \u2717')][:8]
    if marks:
        return ('%d PASS / %d FAIL [CRASH mid-run: summary line never printed]'
                % (marks.count('PASS'), marks.count('FAIL'))), out.strip().splitlines()[-5:]
    return 'CRASH (rc=%d, not one assertion printed)' % rc, out.strip().splitlines()[-5:]


# ⚠ 整段包在 __main__ 里：anchor-check 要 import 本文件读 MUTS，不包的话 import 一次就
#   顺手跑一次 vite build。
def main():
    results = []
    only = sys.argv[1:] or [m[0] for m in MUTS]
    for tag, desc, kind, rel, old, new in MUTS:
        if tag not in only:
            continue
        src = read(rel)
        n = src.count(old)
        if n != 1:
            results.append((tag, desc, kind, 'ANCHOR-MISS n=%d (mutation never applied)' % n, []))
            print('%s ANCHOR-MISS n=%d' % (tag, n))
            sys.stdout.flush()
            continue
        write(rel, src.replace(old, new, 1))
        try:
            if kind == 'js':
                rc, buildout = run('npx vite build --mode development', timeout=900)
                if rc != 0:
                    results.append((tag, desc, kind, 'BUILD-FAIL (tsc/vite refused the mutation)',
                                    buildout.strip().splitlines()[-6:]))
                    print('%s  BUILD-FAIL' % tag)
                    sys.stdout.flush()
                    continue
            rc2, out = run(JS_GATE if kind == 'js' else PY_GATE, timeout=1800)
            v, tail = verdict_of(kind, out, rc2)
            results.append((tag, desc, kind, v, tail))
            print('%s  %-4s -> %s' % (tag, kind, v))
            sys.stdout.flush()
        finally:
            write(rel, src)

    run('npx vite build --mode development', timeout=900)

    with io.open(OUT, 'a', encoding='utf-8') as f:
        for tag, desc, kind, v, tail in results:
            f.write('\n### %s — %s\n\n- 面：`%s`\n- 结果：**%s**\n' % (tag, desc, kind, v))
            if tail:
                f.write('\n```\n%s\n```\n' % '\n'.join(tail))
    print('DONE -> mutations.md')


if __name__ == '__main__':
    main()
