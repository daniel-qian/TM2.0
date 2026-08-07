import type { LiveFormField, LiveFormSelfReport, LiveFormFieldKind } from './transport'

/**
 * gap2 T11 · 模板形状的**前端镜像** —— 服务端 `avery/ingest/form.py` 那套上限与判据在这边照抄一份。
 *
 * 🔴 为什么要抄一份，而不是「让服务端拒就好了」：服务端拒回来的是一个 422 + 一句英文
 * `reason`，经理在屏幕上读到的只能是「这次没保存成」。他刚在一张十二格的表上改了半小时，
 * 一句「没保存成」不告诉他是**哪一格**、**超了哪一条**——那是把排错工作推给他，而信息我们
 * 明明在本地就有。所以这一层的职责不是校验，是**说清楚**。
 *
 * 🔴 服务端仍然是最后一道门（`validate_template_shape` + `gate_form_red_line` + `gate_used_fields`
 * 三道，一道都没搬到前端来）。这里放宽或收紧都不改变什么能落库——写错了只会让经理看到一句
 * 不准的提示，不会让坏形状进库。
 *
 * ⚠ 判据返回的是**代码 + 参数**，不是拼好的句子：句子在词典里（zh/en 同批）。
 * 这一族有过一次事故——把分隔符写进 JSX，英文壳上就多出一个中文标点，而 i18n 门看不见它。
 */

// ── 服务端拥有的词表与上限（form.py:35-56 逐字照抄；服务端才是定义方）─────────────────────────
export const FORM_FIELD_KINDS: LiveFormFieldKind[] = ['text', 'choice', 'number', 'yesno']
export const FORM_SELF_REPORT_SLOTS: LiveFormSelfReport[] = ['', 'load', 'mood']
export const MAX_FIELDS = 12 // 在问的格数（停用的不算）
export const MAX_STORED_FIELDS = MAX_FIELDS * 2 // 连停用的一起算
export const MAX_CHOICES = 8
export const MIN_CHOICES = 2
export const MAX_TITLE_CHARS = 120
export const MAX_LABEL_CHARS = 120
export const MAX_HELP_CHARS = 400
export const MAX_CHOICE_CHARS = 40
export const NUMBER_MIN_FLOOR = 0
export const NUMBER_MAX_CEIL = 100
// 负载读数在人卡上按百分比渲染，所以标了 load 的那一格必须真是 0..100（form.py 的
// LOAD_SELF_REPORT_RANGE）。一格 1..5 的「分」挂上 load，卡上会印出「自述负载 3%」。
export const LOAD_RANGE: [number, number] = [NUMBER_MIN_FLOOR, NUMBER_MAX_CEIL]
// 档数 ≤ 这个数时员工页渲染成一排按钮而不是滑杆（form.py 的 SCALE_MAX_STEPS）。
export const SCALE_MAX_STEPS = 5

/**
 * 一条形状问题。定位靠 `at`（**第几题**，1-based，与编辑器里每一格的标号是同一个数），
 * 不靠 `field.id`——`q3` 是内部稳定键，经理从没见过它，拿它指路等于没指。
 */
export type FormShapeIssue =
  | { code: 'titleMissing' }
  | { code: 'titleTooLong'; max: number }
  | { code: 'noQuestions' }
  | { code: 'tooManyQuestions'; max: number; got: number }
  | { code: 'tooManyStored'; max: number }
  | { code: 'duplicateId'; at: number }
  | { code: 'labelMissing'; at: number }
  | { code: 'labelTooLong'; at: number; max: number }
  | { code: 'helpTooLong'; at: number; max: number }
  | { code: 'choiceCount'; at: number; min: number; max: number; got: number }
  | { code: 'choiceEmpty'; at: number }
  | { code: 'choiceTooLong'; at: number; max: number }
  | { code: 'choiceDuplicate'; at: number }
  | { code: 'numberRange'; at: number; floor: number; ceil: number }
  | { code: 'situationalKind'; at: number }
  | { code: 'loadKind'; at: number }
  | { code: 'loadRange'; at: number }
  | { code: 'moodKind'; at: number }
  | { code: 'slotTaken'; at: number; other: number }

export function liveFields(fields: LiveFormField[]): LiveFormField[] {
  return fields.filter((f) => !f.retired)
}

/**
 * 这张表现在有哪些毛病。**全部**列出来，不是逮到第一条就收手——经理改一条、再点保存、再看见
 * 第二条，是把一次十秒的修改拆成五轮往返（首处即中止是本仓门里栽过的同一个跟头）。
 */
export function checkFormShape(title: string, fields: LiveFormField[]): FormShapeIssue[] {
  const out: FormShapeIssue[] = []
  const trimmedTitle = title.trim()
  if (!trimmedTitle) out.push({ code: 'titleMissing' })
  else if (title.length > MAX_TITLE_CHARS) out.push({ code: 'titleTooLong', max: MAX_TITLE_CHARS })

  const asked = liveFields(fields)
  if (asked.length === 0) out.push({ code: 'noQuestions' })
  else if (asked.length > MAX_FIELDS)
    out.push({ code: 'tooManyQuestions', max: MAX_FIELDS, got: asked.length })
  if (fields.length > MAX_STORED_FIELDS) out.push({ code: 'tooManyStored', max: MAX_STORED_FIELDS })

  const seen = new Set<string>()
  const claimed = new Map<string, number>()
  fields.forEach((f, i) => {
    const at = i + 1
    if (seen.has(f.id)) out.push({ code: 'duplicateId', at })
    seen.add(f.id)
    if (!f.label.trim()) out.push({ code: 'labelMissing', at })
    else if (f.label.length > MAX_LABEL_CHARS)
      out.push({ code: 'labelTooLong', at, max: MAX_LABEL_CHARS })
    if ((f.help ?? '').length > MAX_HELP_CHARS)
      out.push({ code: 'helpTooLong', at, max: MAX_HELP_CHARS })

    if (f.kind === 'choice') {
      const n = f.choices.length
      if (n < MIN_CHOICES || n > MAX_CHOICES)
        out.push({ code: 'choiceCount', at, min: MIN_CHOICES, max: MAX_CHOICES, got: n })
      if (f.choices.some((c) => !c.trim())) out.push({ code: 'choiceEmpty', at })
      if (f.choices.some((c) => c.length > MAX_CHOICE_CHARS))
        out.push({ code: 'choiceTooLong', at, max: MAX_CHOICE_CHARS })
      if (new Set(f.choices).size !== f.choices.length) out.push({ code: 'choiceDuplicate', at })
    }
    if (f.kind === 'number' && !(NUMBER_MIN_FLOOR <= f.min && f.min < f.max && f.max <= NUMBER_MAX_CEIL))
      out.push({ code: 'numberRange', at, floor: NUMBER_MIN_FLOOR, ceil: NUMBER_MAX_CEIL })

    // ── 三个语义开关的落点判据。标在读不到它的 kind 上 = 死开关：界面上像标成功了、
    //    卡上永远不长东西、而且不报错。服务端会 422，这里只是把话说在前面。
    if (f.situational && f.kind !== 'text') out.push({ code: 'situationalKind', at })
    if (f.self_report) {
      const other = claimed.get(f.self_report)
      if (other) out.push({ code: 'slotTaken', at, other })
      else claimed.set(f.self_report, at)
    }
    if (f.self_report === 'load') {
      if (f.kind !== 'number') out.push({ code: 'loadKind', at })
      else if (f.min !== LOAD_RANGE[0] || f.max !== LOAD_RANGE[1]) out.push({ code: 'loadRange', at })
    }
    if (f.self_report === 'mood' && f.kind !== 'choice') out.push({ code: 'moodKind', at })
  })
  return out
}

/**
 * 这张表上哪些 `field.id` 已经有人交过答案了。
 *
 * 🔴 它们**禁改禁删**——答案是按 id 落的，而 `form_templates` 没有版本列（回流读的永远是当时
 * 最新那张模板）。删掉一个被引用过的 id，去年那份提交里的那格答案就再也说不出自己在回答什么
 * 问题；换它的 kind，同一个格里躺着的「85」会被当成一个选项文本。所以拼装器只给这些格
 * 「停用」，不给「删除」，kind 也锁死。服务端 `gate_used_fields` 是同一条规则的最后一道门。
 *
 * ⚠ 判据是「有答案落在这个 id 上」，不是「这张表铸过链」：没交的那条链是 status='open' 的**行**
 * （铸链即建行），它的 answers 键根本不出现——把它算成「用过」会让一张刚发出去、还没人填的表
 * 立刻冻住。
 */
export function answeredFieldIds(
  submissions: Array<{ template_id: string; answers?: Array<{ field_id: string }> }> | null,
  templateId: string,
): Set<string> {
  const used = new Set<string>()
  for (const s of submissions ?? []) {
    if (s.template_id !== templateId) continue
    for (const a of s.answers ?? []) if (a.field_id) used.add(a.field_id)
  }
  return used
}

/** 起一个这张表里没被用过的新 field.id。ASCII、稳定、可读。 */
export function nextFieldId(fields: LiveFormField[]): string {
  const taken = new Set(fields.map((f) => f.id))
  for (let i = 1; i <= MAX_STORED_FIELDS + 1; i += 1) {
    const id = `q${i}`
    if (!taken.has(id)) return id
  }
  return `q${Date.now()}`
}

/** 一张空白表的第一格：自由文本、必填、无标记。经理从这里开始加。 */
export function blankField(id: string): LiveFormField {
  return {
    id,
    kind: 'text',
    label: '',
    help: '',
    required: true,
    choices: [],
    min: NUMBER_MIN_FLOOR,
    max: NUMBER_MAX_CEIL,
    situational: false,
    self_report: '',
    retired: false,
  }
}

/**
 * 换 kind 时把跟着 kind 走的那几个属性归位。
 *
 * 不这么做的后果是很具体的：一格 choice 改成 text 之后 choices 还留在身上，服务端那条
 * 「非 choice 不许带选项」会 422，而经理看到的是「保存失败」——他明明已经把题型改对了。
 * 同理，situational/self_report 一旦落到读不到它的 kind 上就是死开关，这里一并清掉。
 */
export function retypeField(field: LiveFormField, kind: LiveFormFieldKind): LiveFormField {
  const next: LiveFormField = { ...field, kind }
  next.choices = kind === 'choice' ? (field.choices.length ? field.choices : ['', '']) : []
  if (kind !== 'text') next.situational = false
  if (next.self_report === 'load' && kind !== 'number') next.self_report = ''
  if (next.self_report === 'mood' && kind !== 'choice') next.self_report = ''
  if (kind !== 'number') {
    next.min = NUMBER_MIN_FLOOR
    next.max = NUMBER_MAX_CEIL
  }
  return next
}
