import { useState } from 'react'
import { useDict } from '../shared/i18n/useDict'
import { useLite } from './store'
import {
  answeredFieldIds,
  blankField,
  checkFormShape,
  liveFields,
  nextFieldId,
  retypeField,
  FORM_FIELD_KINDS,
  MAX_CHOICES,
  MAX_FIELDS,
  NUMBER_MAX_CEIL,
  NUMBER_MIN_FLOOR,
  type FormShapeIssue,
} from './formShape'
import type { LiveFormField, LiveFormFieldKind, LiveFormTemplate } from './transport'

// gap2 T11 · form-builder —— 资料库第④段里的**模板拼装器**。
//
// ## 这一段解决什么
// T3 把「发表单、看谁交了」做完了，但那张表**只能是我们内置的那一张**：建模板的端点
// （`POST /team/{id}/forms`）从 T1 起就在后端，前端一个调用者都没有（当年刻意不做，
// session-handoff-T3.md:58）。于是「Avery 能按你们自己的表收信息」这句话，客户拿到的版本是
// 「Avery 能按 Avery 的表收信息」。这一段是那个差距。
//
// ## 🔴 四条纪律，都是结构性的
//  1. **已经有人交过答案的那一格，禁改禁删**。答案按 `field.id` 落、模板又没有版本列，所以删掉
//     一个被引用过的 id = 去年那份提交里的答案再也说不出自己在回答什么。这里给的是**停用**：
//     不再问，id 还在，历史照旧对得上号。服务端 `gate_used_fields` 是同一条规则的最后一道门
//     ——两道门是**独立**的两把锁，不是一把锁抄两遍（拆掉任何一道，另一道都还在）。
//  2. **上限镜像**。服务端的 12 题 / 8 选项 / 0..100 在 `formShape.ts` 里照抄了一份，作用不是
//     校验（服务端才是最后一道门），而是**说清楚**：一句「保存失败」不告诉经理是哪一格超了哪条。
//  3. **上卡 / 只进资料库，界面必须分得清**。三个语义开关旁边各有一句话说明这一格的答案会去
//     哪儿；没勾的题只进资料库那份提交文档（可检索、议事室引得到，但不长成卡）。绝不暗示
//     「加一个字段 = 自动长出一张卡」。
//  4. **题面是客户自己的话，不进词典**。经理输入的 title / label / help / choices 与文件名同级：
//     它们不跟着界面语言走。界面 chrome（「加一题」「必填」「停用」）才进词典。
//
// ## 为什么是内联而不是模态
// 照 ProjectsScreen 的 AddProjectForm 先例（页头按钮 aria-expanded 切展开，表单就在下方内联）。
// 一张十二格的表配一个手机上撑满屏的模态，滚动与「我改到哪儿了」两件事都会变糟。

// 本屏那本词典的 lite2 段。issueText 是个纯函数（好单测），所以它吃的是字典而不是 hook。
type Lite2Dict = ReturnType<typeof useDict>['t']['lite2']

function fill(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_, k: string) => String(vars[k] ?? ''))
}

interface Draft {
  id: string // '' = 新表（服务端铸 id）
  title: string
  fields: LiveFormField[]
  active: boolean
}

// 起草回执里那几条「我没带过来的东西」+ 它是怎么起草的。诚实呈现：origin='heading' 说明
// 真模型没参与，界面就不能讲成「Avery 读懂了你的表」。
interface DraftNotice {
  origin: string
  dropped: Array<{ label: string; reason: string }>
  filename: string
}

function copyOf(tpl: LiveFormTemplate): LiveFormField[] {
  return tpl.fields.map((f) => ({ ...f, choices: [...f.choices] }))
}

export function FormBuilder({
  templates,
  onOpenChange,
}: {
  templates: LiveFormTemplate[]
  onOpenChange?: (open: boolean) => void
}) {
  const { t } = useDict()
  const l = t.lite2
  const files = useLite((s) => s.files)
  const submissions = useLite((s) => s.formSubmissions)
  const busy = useLite((s) => s.formBuilderBusy)
  const error = useLite((s) => s.formBuilderError)
  const saveFormTemplate = useLite((s) => s.saveFormTemplate)
  const draftFormFromFile = useLite((s) => s.draftFormFromFile)
  const resetFormBuilder = useLite((s) => s.resetFormBuilder)

  const [draft, setDraft] = useState<Draft | null>(null)
  const [notice, setNotice] = useState<DraftNotice | null>(null)
  const [picking, setPicking] = useState(false)
  // 本地形状问题只在**按过一次保存之后**才显示：一张刚点「新建」的空白表当然还没有标题，
  // 开局就红着一行「表单需要一个名字」，读起来像出错了。
  const [issues, setIssues] = useState<FormShapeIssue[]>([])

  const open = (next: Draft | null) => {
    resetFormBuilder()
    setIssues([])
    setDraft(next)
    onOpenChange?.(next !== null)
  }

  const startBlank = () => {
    setNotice(null)
    open({ id: '', title: '', fields: [blankField('q1')], active: true })
  }

  const startCopy = (tpl: LiveFormTemplate) => {
    setNotice(null)
    // 复制出来的是一张**新表**（id 留空），所以老表照旧在用、老提交照旧对得上它。
    // 题面逐字照抄，一个字都不改——那是客户的内容，不是我们的文案。
    open({ id: '', title: tpl.title, fields: copyOf(tpl), active: true })
  }

  const startEdit = (tpl: LiveFormTemplate) => {
    setNotice(null)
    open({ id: tpl.id, title: tpl.title, fields: copyOf(tpl), active: tpl.active })
  }

  const startFromFile = async (idx: number, filename: string) => {
    setPicking(false)
    const result = await draftFormFromFile(idx)
    if (!result) return // 失败已经落在 formBuilderError 上，UI 下面那行会读它
    setNotice({ origin: result.origin, dropped: result.dropped, filename })
    open({
      id: '',
      title: result.template.title,
      fields: result.template.fields.length
        ? copyOf(result.template)
        : [blankField('q1')],
      active: true,
    })
  }

  const cancel = () => {
    setNotice(null)
    open(null)
  }

  const save = async () => {
    if (!draft) return
    const found = checkFormShape(draft.title, draft.fields)
    setIssues(found)
    if (found.length > 0) return
    const ok = await saveFormTemplate({
      ...(draft.id ? { id: draft.id } : {}),
      title: draft.title.trim(),
      fields: draft.fields,
      active: draft.active,
    })
    if (ok) {
      setNotice(null)
      open(null)
    }
  }

  const patchField = (index: number, patch: Partial<LiveFormField>) =>
    setDraft((d) =>
      d ? { ...d, fields: d.fields.map((f, i) => (i === index ? { ...f, ...patch } : f)) } : d,
    )

  const replaceField = (index: number, next: LiveFormField) =>
    setDraft((d) => (d ? { ...d, fields: d.fields.map((f, i) => (i === index ? next : f)) } : d))

  const addField = () =>
    setDraft((d) => (d ? { ...d, fields: [...d.fields, blankField(nextFieldId(d.fields))] } : d))

  const dropField = (index: number) =>
    setDraft((d) => (d ? { ...d, fields: d.fields.filter((_, i) => i !== index) } : d))

  // ── 折叠态：三个入口 ─────────────────────────────────────────────────────────────────────
  if (!draft) {
    // 起草入口只在**真有文件可读**时才出现——没有文件的时候摆一个「读一份旧表格」的按钮，
    // 点下去只会打开一个空列表（不建假按钮）。
    const drafting = busy === 'drafting'
    return (
      <div className="lite-files-forms-builder">
        <div className="lite-files-forms-builder-entries">
          <button
            type="button"
            className="lite-btn lite-btn--soft lite-files-forms-builder-entry"
            onClick={startBlank}
          >
            {l.formsBuilderNew}
          </button>
          {templates.map((tpl) => (
            <button
              key={tpl.id}
              type="button"
              className="lite-btn lite-btn--ghost lite-files-forms-builder-entry"
              onClick={() => startCopy(tpl)}
            >
              {fill(l.formsBuilderCopy, { title: tpl.title })}
            </button>
          ))}
          {files.length > 0 ? (
            <button
              type="button"
              className="lite-btn lite-btn--ghost lite-files-forms-builder-entry"
              aria-expanded={picking}
              disabled={drafting}
              onClick={() => setPicking((v) => !v)}
            >
              {drafting ? l.formsBuilderDraftBusy : l.formsBuilderDraft}
            </button>
          ) : null}
        </div>
        {picking ? (
          <div className="lite-files-forms-builder-picker">
            <p className="lite-files-forms-note">{l.formsBuilderDraftHint}</p>
            <ul className="lite-files-forms-builder-files">
              {files.map((f) => (
                <li key={f.idx}>
                  <button
                    type="button"
                    className="lite-btn lite-btn--ghost lite-files-forms-builder-file"
                    onClick={() => void startFromFile(f.idx, f.filename)}
                  >
                    {/* 文件名是客户的数据，与题面同级——不进词典。 */}
                    {f.filename}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        {templates.length > 0 ? (
          <div className="lite-files-forms-builder-edits">
            {templates.map((tpl) => (
              <button
                key={tpl.id}
                type="button"
                className="lite-btn lite-btn--ghost lite-files-forms-builder-edit"
                onClick={() => startEdit(tpl)}
              >
                {fill(l.formsBuilderEdit, { title: tpl.title })}
              </button>
            ))}
          </div>
        ) : null}
        <BuilderError error={error} />
      </div>
    )
  }

  // ── 展开态：编辑器 ───────────────────────────────────────────────────────────────────────
  const used = answeredFieldIds(submissions, draft.id)
  const asked = liveFields(draft.fields).length
  const saving = busy === 'saving'

  return (
    <div className="lite-files-forms-builder is-open">
      <p className="lite-files-forms-label">
        {draft.id ? fill(l.formsBuilderEditing, { title: draft.title }) : l.formsBuilderNewTitle}
      </p>

      {notice ? <DraftNoticeBlock notice={notice} /> : null}

      <label className="lite-files-forms-builder-titlerow" htmlFor="lite-forms-builder-title">
        <span className="lite-files-forms-builder-fieldlabel">{l.formsBuilderTitleLabel}</span>
        <input
          id="lite-forms-builder-title"
          className="lite-files-forms-builder-input"
          type="text"
          value={draft.title}
          // placeholder 刻意留空：这一格填的是客户自己给表起的名字，给一个例子就是在替他起名。
          onChange={(e) => setDraft((d) => (d ? { ...d, title: e.target.value } : d))}
        />
      </label>

      <ol className="lite-files-forms-builder-fields">
        {draft.fields.map((f, i) => (
          <FieldEditor
            key={f.id}
            field={f}
            index={i}
            locked={used.has(f.id)}
            canDrop={draft.fields.length > 1}
            onPatch={(patch) => patchField(i, patch)}
            onReplace={(next) => replaceField(i, next)}
            onDrop={() => dropField(i)}
          />
        ))}
      </ol>

      <div className="lite-files-forms-builder-addrow">
        <button
          type="button"
          className="lite-btn lite-btn--ghost lite-files-forms-builder-add"
          // 上限镜像：到顶就不给按，旁边一句话说清是哪条上限（不是拦下来什么都不说）。
          disabled={asked >= MAX_FIELDS}
          onClick={addField}
        >
          {l.formsBuilderAddField}
        </button>
        <span className="lite-files-forms-note">
          {fill(l.formsBuilderCount, { asked, max: MAX_FIELDS })}
        </span>
      </div>

      <label className="lite-files-forms-builder-switch">
        <input
          type="checkbox"
          checked={!draft.active}
          onChange={(e) => setDraft((d) => (d ? { ...d, active: !e.target.checked } : d))}
        />
        <span>{l.formsBuilderRetireForm}</span>
      </label>
      <p className="lite-files-forms-note">{l.formsBuilderRetireFormHint}</p>

      {issues.length > 0 ? (
        <ul className="lite-files-forms-builder-issues" role="status">
          {issues.map((issue, i) => (
            <li key={`${issue.code}-${i}`}>{issueText(l, issue)}</li>
          ))}
        </ul>
      ) : null}
      <BuilderError error={error} />

      <div className="lite-files-forms-builder-actions">
        <button
          type="button"
          className="lite-btn lite-btn--primary lite-files-forms-builder-save"
          disabled={saving}
          onClick={() => void save()}
        >
          {saving ? l.formsBuilderSaveBusy : l.formsBuilderSave}
        </button>
        <button
          type="button"
          className="lite-btn lite-btn--ghost lite-files-forms-builder-cancel"
          onClick={cancel}
        >
          {l.formsBuilderCancel}
        </button>
      </div>
    </div>
  )
}

// 一次写失败。🔴 'rejected' 那一句后面挂服务端原文（英文、开发者向）当**诊断**，不是那句话
// 本身——经理读的是中文那句，排错的人读得到括号里那句。绝不把英文原文当成给用户的句子。
function BuilderError({
  error,
}: {
  error: { code: string; detail?: string } | null
}) {
  const { t } = useDict()
  const l = t.lite2
  if (!error) return null
  const text =
    error.code === 'rejected'
      ? l.formsBuilderErrorRejected
      : error.code === 'unavailable'
        ? l.formsBuilderErrorUnavailable
        : error.code === 'unreadable'
          ? l.formsBuilderErrorUnreadable
          : l.formsBuilderErrorFailed
  return (
    <p className="lite-files-forms-error" role="status">
      {text}
      {error.detail ? (
        <code className="lite-files-forms-builder-detail">{error.detail}</code>
      ) : null}
    </p>
  )
}

// 起草回执。两件事必须说：**它是怎么起草的**（真模型 / 只读了表头），以及**我没带过来什么**。
// 悄悄少两列的提案，比明说「这两列我没带过来，因为…」的提案危险得多。
function DraftNoticeBlock({ notice }: { notice: DraftNotice }) {
  const { t } = useDict()
  const l = t.lite2
  return (
    <div className="lite-files-forms-builder-notice" role="note">
      <p className="lite-files-forms-note">
        {fill(
          notice.origin === 'llm' ? l.formsBuilderDraftFromLlm : l.formsBuilderDraftFromHeadings,
          { filename: notice.filename },
        )}
      </p>
      {notice.dropped.length > 0 ? (
        <ul className="lite-files-forms-builder-dropped">
          {notice.dropped.map((d, i) => (
            <li key={`${d.label}-${i}`}>
              {/* 列名是客户表格里的原文（不进词典）；原因是服务端给的中文一句话。 */}
              <span className="lite-files-forms-builder-dropped-label">{d.label}</span>
              <span className="lite-files-forms-builder-dropped-why">{d.reason}</span>
            </li>
          ))}
        </ul>
      ) : null}
      <p className="lite-files-forms-note">{l.formsBuilderDraftReview}</p>
    </div>
  )
}

function FieldEditor({
  field,
  index,
  locked,
  canDrop,
  onPatch,
  onReplace,
  onDrop,
}: {
  field: LiveFormField
  index: number
  locked: boolean
  canDrop: boolean
  onPatch: (patch: Partial<LiveFormField>) => void
  onReplace: (next: LiveFormField) => void
  onDrop: () => void
}) {
  const { t } = useDict()
  const l = t.lite2
  const uid = `lite-forms-f-${field.id}`
  const kindLabel: Record<string, string> = {
    text: l.formsBuilderKindText,
    choice: l.formsBuilderKindChoice,
    number: l.formsBuilderKindNumber,
    yesno: l.formsBuilderKindYesno,
  }

  return (
    <li
      className="lite-files-forms-builder-field"
      data-retired={field.retired ? '1' : '0'}
      data-locked={locked ? '1' : '0'}
    >
      <label className="lite-files-forms-builder-fieldlabel" htmlFor={`${uid}-label`}>
        {fill(l.formsBuilderQuestionN, { n: index + 1 })}
      </label>
      <input
        id={`${uid}-label`}
        className="lite-files-forms-builder-input"
        type="text"
        value={field.label}
        onChange={(e) => onPatch({ label: e.target.value })}
      />

      <div className="lite-files-forms-builder-row">
        <label htmlFor={`${uid}-kind`}>
          <span className="lite-files-forms-builder-fieldlabel">{l.formsBuilderKind}</span>
          <select
            id={`${uid}-kind`}
            className="lite-files-forms-builder-select"
            value={field.kind}
            // 🔴 已经有人交过答案的格：题型锁死。同一个格里躺着的「85」，把 kind 换成 choice
            // 之后会被当成一个选项文本——那是静默篡改历史，不是编辑。
            disabled={locked}
            onChange={(e) => onReplace(retypeField(field, e.target.value as LiveFormFieldKind))}
          >
            {FORM_FIELD_KINDS.map((k) => (
              <option key={k} value={k}>
                {kindLabel[k]}
              </option>
            ))}
          </select>
        </label>
        <label className="lite-files-forms-builder-switch">
          <input
            type="checkbox"
            checked={field.required}
            onChange={(e) => onPatch({ required: e.target.checked })}
          />
          <span>{l.formsBuilderRequired}</span>
        </label>
      </div>

      {field.kind === 'choice' ? (
        <ChoiceEditor field={field} uid={uid} onPatch={onPatch} />
      ) : null}

      {field.kind === 'number' ? (
        <div className="lite-files-forms-builder-row">
          <label htmlFor={`${uid}-min`}>
            <span className="lite-files-forms-builder-fieldlabel">{l.formsBuilderMin}</span>
            <input
              id={`${uid}-min`}
              className="lite-files-forms-builder-num"
              type="number"
              min={NUMBER_MIN_FLOOR}
              max={NUMBER_MAX_CEIL}
              value={field.min}
              onChange={(e) => onPatch({ min: Number(e.target.value) })}
            />
          </label>
          <label htmlFor={`${uid}-max`}>
            <span className="lite-files-forms-builder-fieldlabel">{l.formsBuilderMax}</span>
            <input
              id={`${uid}-max`}
              className="lite-files-forms-builder-num"
              type="number"
              min={NUMBER_MIN_FLOOR}
              max={NUMBER_MAX_CEIL}
              value={field.max}
              onChange={(e) => onPatch({ max: Number(e.target.value) })}
            />
          </label>
        </div>
      ) : null}

      <label className="lite-files-forms-builder-helprow" htmlFor={`${uid}-help`}>
        <span className="lite-files-forms-builder-fieldlabel">{l.formsBuilderHelp}</span>
        <input
          id={`${uid}-help`}
          className="lite-files-forms-builder-input"
          type="text"
          value={field.help}
          onChange={(e) => onPatch({ help: e.target.value })}
        />
      </label>

      {/* ── 三个语义开关 ────────────────────────────────────────────────────────────────
          🔴 每个开关旁边都写清这一格的答案会去哪儿，而且**只有能读到它的题型**才给勾
          （标在读不到它的题型上就是死开关：界面像标成功了、卡上永远不长东西、还不报错）。
          没勾任何一个的题，答案只进资料库那份提交文档——可检索、议事室引得到，但不上卡。 */}
      <div className="lite-files-forms-builder-switches">
        <label className="lite-files-forms-builder-switch">
          <input
            type="checkbox"
            checked={field.situational}
            disabled={field.kind !== 'text'}
            onChange={(e) => onPatch({ situational: e.target.checked })}
          />
          <span>{l.formsBuilderSwitchSituational}</span>
        </label>
        <label className="lite-files-forms-builder-switch">
          <input
            type="checkbox"
            checked={field.self_report === 'load'}
            disabled={field.kind !== 'number'}
            onChange={(e) =>
              onPatch(
                e.target.checked
                  ? // 负载读数在人卡上按百分比渲染，所以勾上它就把这一格拉回 0..100
                    // （一格 1..5 的「分」挂上 load，卡上会印出「自述负载 3%」）。
                    { self_report: 'load', min: NUMBER_MIN_FLOOR, max: NUMBER_MAX_CEIL }
                  : { self_report: '' },
              )
            }
          />
          <span>{l.formsBuilderSwitchLoad}</span>
        </label>
        <label className="lite-files-forms-builder-switch">
          <input
            type="checkbox"
            checked={field.self_report === 'mood'}
            disabled={field.kind !== 'choice'}
            onChange={(e) => onPatch({ self_report: e.target.checked ? 'mood' : '' })}
          />
          <span>{l.formsBuilderSwitchMood}</span>
        </label>
      </div>
      <p className="lite-files-forms-note">
        {field.situational || field.self_report
          ? l.formsBuilderGoesToCard
          : l.formsBuilderGoesToLibrary}
      </p>

      <div className="lite-files-forms-builder-fieldactions">
        {locked ? (
          <>
            {/* 已经有人交过：只给停用，不给删。id 留在表里，历史答案才对得上号。 */}
            <label className="lite-files-forms-builder-switch">
              <input
                type="checkbox"
                checked={field.retired}
                onChange={(e) => onPatch({ retired: e.target.checked })}
              />
              <span>{l.formsBuilderRetire}</span>
            </label>
            <span className="lite-files-forms-note">{l.formsBuilderLockedHint}</span>
          </>
        ) : (
          <button
            type="button"
            className="lite-btn lite-btn--ghost lite-files-forms-builder-drop"
            // 一张一格都不问的表不是表，是一个点开只有标题的空白页。
            disabled={!canDrop}
            onClick={onDrop}
          >
            {l.formsBuilderDropField}
          </button>
        )}
      </div>
    </li>
  )
}

function ChoiceEditor({
  field,
  uid,
  onPatch,
}: {
  field: LiveFormField
  uid: string
  onPatch: (patch: Partial<LiveFormField>) => void
}) {
  const { t } = useDict()
  const l = t.lite2
  const setChoice = (i: number, value: string) =>
    onPatch({ choices: field.choices.map((c, j) => (j === i ? value : c)) })
  return (
    <div className="lite-files-forms-builder-choices">
      <span className="lite-files-forms-builder-fieldlabel">{l.formsBuilderChoices}</span>
      {field.choices.map((choice, i) => (
        <div key={`${uid}-c${i}`} className="lite-files-forms-builder-choicerow">
          <input
            className="lite-files-forms-builder-input"
            type="text"
            aria-label={fill(l.formsBuilderChoiceN, { n: i + 1 })}
            value={choice}
            onChange={(e) => setChoice(i, e.target.value)}
          />
          <button
            type="button"
            className="lite-btn lite-btn--ghost lite-files-forms-builder-choicedrop"
            disabled={field.choices.length <= 2}
            onClick={() => onPatch({ choices: field.choices.filter((_, j) => j !== i) })}
          >
            {l.formsBuilderDropChoice}
          </button>
        </div>
      ))}
      <button
        type="button"
        className="lite-btn lite-btn--ghost lite-files-forms-builder-addchoice"
        disabled={field.choices.length >= MAX_CHOICES}
        onClick={() => onPatch({ choices: [...field.choices, ''] })}
      >
        {l.formsBuilderAddChoice}
      </button>
    </div>
  )
}

// 形状问题 → 屏幕上那句话。🔴 句子全在词典里（zh/en 同批），这里只做代码到键的映射 +
// 占位符替换——一个标点字面量都不许写在 JSX 里（这一族有过一次事故：硬编码的全角冒号在英文壳
// 上漏了出去，而 i18n 门看不见它）。
export function issueText(l: Lite2Dict, issue: FormShapeIssue): string {
  switch (issue.code) {
    case 'titleMissing':
      return l.formsIssueTitleMissing
    case 'titleTooLong':
      return fill(l.formsIssueTitleTooLong, { max: issue.max })
    case 'noQuestions':
      return l.formsIssueNoQuestions
    case 'tooManyQuestions':
      return fill(l.formsIssueTooManyQuestions, { max: issue.max, got: issue.got })
    case 'tooManyStored':
      return fill(l.formsIssueTooManyStored, { max: issue.max })
    case 'duplicateId':
      return fill(l.formsIssueDuplicateId, { at: issue.at })
    case 'labelMissing':
      return fill(l.formsIssueLabelMissing, { at: issue.at })
    case 'labelTooLong':
      return fill(l.formsIssueLabelTooLong, { at: issue.at, max: issue.max })
    case 'helpTooLong':
      return fill(l.formsIssueHelpTooLong, { at: issue.at, max: issue.max })
    case 'choiceCount':
      return fill(l.formsIssueChoiceCount, {
        at: issue.at, min: issue.min, max: issue.max, got: issue.got,
      })
    case 'choiceEmpty':
      return fill(l.formsIssueChoiceEmpty, { at: issue.at })
    case 'choiceTooLong':
      return fill(l.formsIssueChoiceTooLong, { at: issue.at, max: issue.max })
    case 'choiceDuplicate':
      return fill(l.formsIssueChoiceDuplicate, { at: issue.at })
    case 'numberRange':
      return fill(l.formsIssueNumberRange, { at: issue.at, floor: issue.floor, ceil: issue.ceil })
    case 'situationalKind':
      return fill(l.formsIssueSituationalKind, { at: issue.at })
    case 'loadKind':
      return fill(l.formsIssueLoadKind, { at: issue.at })
    case 'loadRange':
      return fill(l.formsIssueLoadRange, { at: issue.at })
    case 'moodKind':
      return fill(l.formsIssueMoodKind, { at: issue.at })
    case 'slotTaken':
      return fill(l.formsIssueSlotTaken, { at: issue.at, other: issue.other })
    default:
      // 判据代码是本仓自己的闭合联合——真走到这里说明加了一种却没给文案，
      // 那时候屏幕上宁可什么都不说，也不许编一句。
      return ''
  }
}
