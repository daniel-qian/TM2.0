import { useMemo, useRef, useState, type ClipboardEvent } from 'react'
import { INTAKE_FORMS, type IntakeColumn, type IntakeForm } from '../../shared/intakeSchema'
import { useDict } from '../../shared/i18n/useDict'
import { useIntake } from './intakeStore'
import { gridToRows, looksLikeHeader, parseTsv, type PastedGrid } from './tsv'
import { validateTables, type CellIssue } from './validate'
import type { StructuredCellViolation } from '../transport'

// 7 张标准表的 app 内录入网格 —— onboarding-accounts-0805 ②（ADR-0034 拍板 1/2/4）。
//
// 左边 7 表导航（01–03「核心必填」/ 04–07「建议补充」，分组文案来自表定义的 tier），
// 右边当前表的行编辑网格 + 新增一行 + 从 Excel 粘贴 + 下载 Excel 空模板。
//
// 🔴 表定义（列名/列序/必填/下拉/提示/校验形状/红线面/跨表引用）**全部**来自
// `src/shared/intakeSchema.ts`，那是 `scripts/gen-intake-schema.py` 从
// `scripts/make-intake-xlsx.py` 的 FORMS 编译出来的生成产物。这个文件里不许出现任何一个
// 列名字面量——出现一个，就是票 #41 明令禁止的「前端手写第二份表定义然后各漂」。
//
// 门相位（新门写判据照这个抄）：
//   .lite-intake-nav-item[data-form-id][aria-selected]
//   .lite-intake-grid[data-form-id] · th[data-column-key] · td[data-column-key][data-row-index]
//   .lite-intake-cell[data-issue="error|warn"]（显示值与判据值分开：红/黄是它的视觉表现）
//   .lite-intake-paste / .lite-intake-paste-preview / .lite-intake-addrow
//   .lite-intake-issue[data-code]

const TEMPLATE_HREF = '/paperwork/forms/avery-intake-forms.xlsx'

function fill(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_, k: string) => String(vars[k] ?? ''))
}

/** 一条 issue 的人话。文案归 i18n，校验器只给代码 —— 两边都不必知道对方的语言。 */
function issueText(issue: CellIssue, l: ReturnType<typeof useDict>['t']['lite2']): string {
  switch (issue.code) {
    case 'required':
      return l.intakeIssueRequired
    case 'date':
      return l.intakeIssueDate
    case 'number':
      return l.intakeIssueNumber
    case 'percent':
      return l.intakeIssuePercent
    case 'option':
      return l.intakeIssueOption
    case 'redlineHard':
      return fill(l.intakeIssueRedlineHard, { snippet: issue.detail ?? '' })
    case 'redlineWarn':
      return fill(l.intakeIssueRedlineWarn, { snippet: issue.detail ?? '' })
    case 'ref':
      return fill(l.intakeIssueRef, { form: issue.refForm ?? '', column: issue.refColumn ?? '' })
    default:
      return ''
  }
}

export interface IntakeTablesProps {
  /** 后端 422 打回来的格坐标（红线整发拒）。与本地校验的 issue 合并显示。 */
  serverCells?: StructuredCellViolation[]
  /** 预览模式：只读，不落盘、不提交。 */
  readOnly?: boolean
}

export function IntakeTables({ serverCells = [], readOnly = false }: IntakeTablesProps) {
  const { t } = useDict()
  const l = t.lite2

  const rows = useIntake((s) => s.rows)
  const activeForm = useIntake((s) => s.activeForm)
  const setActiveForm = useIntake((s) => s.setActiveForm)
  const setCell = useIntake((s) => s.setCell)
  const addRow = useIntake((s) => s.addRow)
  const removeRow = useIntake((s) => s.removeRow)
  const applyRows = useIntake((s) => s.applyRows)

  const [paste, setPaste] = useState<PastedGrid | null>(null)
  const [pasteHadHeader, setPasteHadHeader] = useState(false)
  const pasteRef = useRef<HTMLTextAreaElement | null>(null)

  const form = INTAKE_FORMS.find((f) => f.id === activeForm) ?? INTAKE_FORMS[0]
  const issues = useMemo(() => validateTables(rows), [rows])

  // 表定义里的**描述性**三项（分层 / 用途 / Avery 吃到哪一层）是中文的——它们跟着
  // make-intake-xlsx.py 的 FORMS 走，而那份是发给中国客户的表。列名/下拉/提示必须保持中文
  // （它们是后端认列的键，也是印在客户手里那张纸上的字），但这三项是**说明**，英文壳里读不懂
  // 就等于那句诚实标注（「03 表只进材料库、不成独立卡片」）对英文用户没说过——checker 逮到。
  // 🔴 只在英文侧覆盖，中文侧恒读表定义：不复制一份中文进字典，就没有第二处会漂的地方。
  const meta = (f: IntakeForm) => l.intakeMetaOverride[f.id] ?? { tier: f.tier, purpose: f.purpose, intake: f.intake }
  const rowCountText = (n: number) => (n === 1 ? l.intakeRowCountOne : fill(l.intakeRowCount, { n }))

  // 本表的 issue 索引：`行-列` → issue[]。服务端打回的格也并进来（同一个红标，同一处显示）。
  const issueAt = useMemo(() => {
    const map = new Map<string, CellIssue[]>()
    for (const i of issues) {
      if (i.form !== form.id) continue
      const key = `${i.row}-${i.column}`
      map.set(key, [...(map.get(key) ?? []), i])
    }
    for (const c of serverCells) {
      if (c.table !== form.id) continue
      const key = `${c.row}-${c.column}`
      map.set(key, [
        ...(map.get(key) ?? []),
        { form: c.table, row: c.row, column: c.column, level: 'error', code: 'redlineHard',
          detail: c.detail },
      ])
    }
    return map
  }, [issues, serverCells, form.id])

  // 本表的问题清单，红线排最前——它是这一屏最重要的一条，不该混在五条「这一格必填」中间。
  const panelIssues = useMemo(() => {
    const weight = (i: CellIssue) => (i.code === 'redlineHard' ? 0 : i.level === 'error' ? 1 : 2)
    return [...issueAt.values()].flat()
      .sort((a, b) => weight(a) - weight(b) || a.row - b.row)
  }, [issueAt])

  const formIssueCount = useMemo(() => {
    const counts: Record<string, { error: number; warn: number }> = {}
    for (const f of INTAKE_FORMS) counts[f.id] = { error: 0, warn: 0 }
    for (const i of issues) counts[i.form][i.level === 'error' ? 'error' : 'warn'] += 1
    for (const c of serverCells) if (counts[c.table]) counts[c.table].error += 1
    return counts
  }, [issues, serverCells])

  const columnKeys = form.columns.map((c) => c.key)

  const onPaste = (e: ClipboardEvent<HTMLTextAreaElement>) => {
    const text = e.clipboardData?.getData('text/plain') ?? ''
    if (!text.trim()) return
    e.preventDefault()
    const grid = parseTsv(text)
    const header = looksLikeHeader(grid.rows[0] ?? [], columnKeys)
    setPasteHadHeader(header)
    setPaste(header ? { rows: grid.rows.slice(1), widths: grid.widths.slice(1) } : grid)
  }

  const confirmPaste = (mode: 'replace' | 'append') => {
    if (!paste) return
    applyRows(form.id, gridToRows(paste, columnKeys), mode)
    setPaste(null)
    if (pasteRef.current) pasteRef.current.value = ''
  }

  const tiers = [...new Set(INTAKE_FORMS.map((f) => f.tier))]
  const list = rows[form.id] ?? []
  // 粘贴预览里的"列数不符"提示：把实际列数与本表列数摆出来，让错位在确认之前就能看见。
  const pasteWidths = [...new Set(paste?.widths ?? [])]
  const widthMismatch = paste ? pasteWidths.some((w) => w !== columnKeys.length) : false

  return (
    <div className="lite-intake" data-intake-readonly={readOnly ? 'on' : 'off'}>
      <nav className="lite-intake-nav" aria-label={l.intakeNavAria}>
        {/* 分组用表定义里的 tier 作**键**（稳定），显示用可覆盖的译名——两者分开，
            英文壳换了显示名不会把分组打散。 */}
        {tiers.map((tier) => (
          <div key={tier} className="lite-intake-nav-group">
            <p className="eyebrow lite-intake-nav-tier" data-tier={tier}>
              {meta(INTAKE_FORMS.find((f) => f.tier === tier) ?? INTAKE_FORMS[0]).tier}
            </p>
            {INTAKE_FORMS.filter((f) => f.tier === tier).map((f) => {
              const counts = formIssueCount[f.id]
              const filled = (rows[f.id] ?? []).filter((r) =>
                Object.values(r).some((v) => v.trim() !== '')).length
              return (
                <button
                  key={f.id}
                  type="button"
                  role="tab"
                  aria-selected={f.id === form.id}
                  className={`lite-intake-nav-item${f.id === form.id ? ' is-active' : ''}`}
                  data-form-id={f.id}
                  data-filled-rows={filled}
                  onClick={() => setActiveForm(f.id)}
                >
                  <span className="lite-intake-nav-name">{f.sheet}</span>
                  <span className="lite-intake-nav-meta">
                    {filled > 0 ? rowCountText(filled) : l.intakeRowsEmpty}
                    {counts.error > 0 ? (
                      <span className="lite-intake-nav-badge is-error" data-issue-count={counts.error}>
                        {counts.error}
                      </span>
                    ) : null}
                  </span>
                </button>
              )
            })}
          </div>
        ))}
      </nav>

      <section className="lite-intake-panel" aria-label={form.sheet}>
        <header className="lite-intake-panel-head">
          <h3 className="lite-intake-title">{form.sheet}</h3>
          <p className="lite-intake-purpose">{meta(form).purpose}</p>
          {/* 「Avery 现在吃到哪一层」——逐张说实话，与我们发出去的 xlsx 说明页同一份文字。
              03/06/07 只进材料库这件事必须写在填表人眼前，否则他填完一下午会以为传失败了。 */}
          <p className="lite-intake-intake" data-intake-note={form.id}>
            <span className="lite-intake-intake-label">{l.intakeReachLabel}</span>
            {meta(form).intake}
          </p>
        </header>

        <div className="lite-intake-tools">
          <button
            type="button"
            className="lite-btn lite-btn--ghost lite-intake-addrow"
            onClick={() => addRow(form.id)}
            disabled={readOnly}
          >
            {l.intakeAddRow}
          </button>
          <a
            className="lite-intake-template"
            href={TEMPLATE_HREF}
            target="_blank"
            rel="noopener noreferrer"
            download
          >
            {l.intakeDownloadTemplate}
          </a>
        </div>

        {/* ── 从 Excel 粘贴（拍板 4）──────────────────────────────────────────────────
            实现成一个 textarea 而不是"监听整页 paste"：整页监听会在用户往某一格里粘贴一段
            文字时也触发，把一次正常输入变成一次整表覆盖。焦点在这个框里 = 明确的意图。 */}
        <details className="lite-intake-paste">
          <summary>{l.intakePasteTitle}</summary>
          <p className="lite-intake-paste-hint">{l.intakePasteHint}</p>
          <textarea
            ref={pasteRef}
            className="lite-intake-paste-input"
            rows={2}
            placeholder={l.intakePastePlaceholder}
            onPaste={onPaste}
            disabled={readOnly}
          />
          {paste ? (
            <div className="lite-intake-paste-preview" data-paste-rows={paste.rows.length}>
              <p className="lite-intake-paste-summary">
                {fill(l.intakePasteSummary, {
                  rows: paste.rows.length,
                  cols: pasteWidths.join(' / '),
                  expected: columnKeys.length,
                })}
                {pasteHadHeader ? ` ${l.intakePasteHeaderDropped}` : ''}
              </p>
              {/* 🔴 列数不符**不静默补齐**：静默对齐会让一次错位粘贴看起来完全正常，
                  而错位的代价是整张表每一格都填错了位置。摆出来，让用户自己看。 */}
              {widthMismatch ? (
                <p className="lite-intake-paste-warn" role="alert">
                  {fill(l.intakePasteWidthMismatch, { expected: columnKeys.length })}
                </p>
              ) : null}
              <table className="lite-intake-paste-table">
                <tbody>
                  {paste.rows.slice(0, 3).map((r, i) => (
                    <tr key={i}>
                      {columnKeys.map((k, j) => (
                        <td key={k}>{r[j] ?? ''}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="lite-intake-paste-actions">
                <button
                  type="button"
                  className="lite-btn lite-btn--primary lite-intake-paste-replace"
                  onClick={() => confirmPaste('replace')}
                >
                  {l.intakePasteReplace}
                </button>
                <button
                  type="button"
                  className="lite-btn lite-btn--ghost lite-intake-paste-append"
                  onClick={() => confirmPaste('append')}
                >
                  {l.intakePasteAppend}
                </button>
                <button
                  type="button"
                  className="lite-btn lite-btn--ghost lite-intake-paste-cancel"
                  onClick={() => setPaste(null)}
                >
                  {l.intakePasteCancel}
                </button>
              </div>
            </div>
          ) : null}
        </details>

        {/* 网格横向溢出**在容器内滚动**，页面不得横滚（票 #41 硬要求）。 */}
        <div className="lite-intake-grid-scroll">
          <table className="lite-intake-grid" data-form-id={form.id}>
            <thead>
              <tr>
                <th className="lite-intake-rownum" scope="col">
                  <span className="lite-sr-only">{l.intakeRowNumberAria}</span>
                </th>
                <th className="lite-intake-rowdel" scope="col">
                  <span className="lite-sr-only">{l.intakeRemoveRowAria}</span>
                </th>
                {form.columns.map((col) => (
                  <th
                    key={col.key}
                    scope="col"
                    data-column-key={col.key}
                    data-required={col.required ? 'yes' : 'no'}
                    title={col.hint || undefined}
                    style={{ minWidth: `${Math.min(Math.max(col.width * 7, 96), 320)}px` }}
                  >
                    {/* 表头**原文**（含必填星号），与用户手里那份 xlsx 一眼对得上。 */}
                    {col.header}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {list.map((row, rowIndex) => (
                <tr key={rowIndex} data-row-index={rowIndex + 1}>
                  {/* 行号与删除都钉在左侧（sticky）：网格一横滚，跟着滚走的行号就答不出
                      「红的是第几行」，而右端的删除键干脆滚出视野——checker 两条都逮到了。 */}
                  <td className="lite-intake-rownum">{rowIndex + 1}</td>
                  <td className="lite-intake-rowdel">
                    <button
                      type="button"
                      className="lite-intake-removerow"
                      aria-label={`${l.intakeRemoveRowAria} ${rowIndex + 1}`}
                      onClick={() => removeRow(form.id, rowIndex)}
                      disabled={readOnly}
                    >
                      ×
                    </button>
                  </td>
                  {form.columns.map((col) => (
                    <Cell
                      key={col.key}
                      col={col}
                      form={form}
                      value={row[col.key] ?? ''}
                      rowIndex={rowIndex}
                      issues={issueAt.get(`${rowIndex + 1}-${col.key}`) ?? []}
                      readOnly={readOnly}
                      onChange={(v) => setCell(form.id, rowIndex, col.key, v)}
                      title={(issueAt.get(`${rowIndex + 1}-${col.key}`) ?? [])
                        .map((i) => issueText(i, l)).join(' ')}
                    />
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* ── 问题清单（checker 第一轮的三条「高」全出自同一个根因）─────────────────────
            首版把每条说明塞在**格子底下**。在一张横向滚动的网格里那等于把它藏起来了：
            右边列上的错误整条滚出视野（屏幕上只剩一条被撑高、没有任何解释的空白带），
            留在视野里的也被格宽切成半句（「一格必填。」「equired.」），而最重要的那条
            ——红线的后果——恰好落在最窄的列上，一行都读不完整。
            现在说明搬到网格下方的整宽清单里：每条自带**第几行 · 哪一列**，红线的排在最前
            并单独一档视觉重量。格子里只留红/黄边框做定位标记（外加 title 悬停）。 */}
        {panelIssues.length > 0 ? (
          <ul className="lite-intake-issues" aria-label={l.intakeIssuesAria}>
            {panelIssues.map((i, n) => (
              <li
                key={`${i.row}-${i.column}-${i.code}-${n}`}
                className={`lite-intake-issue is-${i.level}${i.code === 'redlineHard' ? ' is-redline' : ''}`}
                data-code={i.code}
                data-form={i.form}
                data-row={i.row}
                data-column={i.column}
              >
                <span className="lite-intake-issue-at">
                  {fill(l.intakeIssueAt, { row: i.row, column: i.column })}
                </span>
                {issueText(i, l)}
              </li>
            ))}
          </ul>
        ) : null}
      </section>
    </div>
  )
}

function Cell({
  col, form, value, rowIndex, issues, readOnly, onChange, title,
}: {
  col: IntakeColumn
  form: IntakeForm
  value: string
  rowIndex: number
  issues: CellIssue[]
  readOnly: boolean
  onChange: (v: string) => void
  /** 悬停全文（说明本体在网格下方的清单里，见那处注释）。 */
  title: string
}) {
  const { t } = useDict()
  const l = t.lite2
  const worst = issues.some((i) => i.level === 'error')
    ? 'error'
    : issues.length > 0
      ? 'warn'
      : ''

  return (
    <td
      className="lite-intake-cell"
      data-column-key={col.key}
      data-row-index={rowIndex + 1}
      data-issue={worst || undefined}
      title={title || undefined}
    >
      {col.options.length > 0 ? (
        <select
          className="lite-intake-input"
          value={value}
          disabled={readOnly}
          aria-label={`${form.sheet} ${col.key}`}
          aria-invalid={worst === 'error' || undefined}
          onChange={(e) => onChange(e.target.value)}
        >
          <option value="">{l.intakePickOne}</option>
          {col.options.map((opt) => (
            <option key={opt} value={opt}>
              {opt}
            </option>
          ))}
          {/* 粘贴进来的词表外取值也要显示出来（否则用户看到的是空格子、以为没粘上），
              同时由校验器标红说明它不在词表里。 */}
          {value && !col.options.includes(value) ? (
            <option value={value}>{value}</option>
          ) : null}
        </select>
      ) : (
        <input
          type="text"
          className="lite-intake-input"
          value={value}
          disabled={readOnly}
          aria-label={`${form.sheet} ${col.key}`}
          aria-invalid={worst === 'error' || undefined}
          placeholder={col.kind === 'date' ? 'YYYY-MM-DD' : undefined}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
    </td>
  )
}
