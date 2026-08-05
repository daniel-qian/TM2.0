// 单元格级校验 + 红线前移 —— onboarding-accounts-0805 ②（ADR-0034 拍板 2）。
//
// 拍板 2 的原话：「前端把拦截前移到单元格级（07 表填分数当场标红），正常用户永远碰不到 422；
// 绕过前端直打端点的，同一条铁律。」所以这一层的定位是**把后端已经会拒的东西提前说出来**，
// 不是第二道独立的门：后端 `avery/ingest/structured.py` 才是权威，这里只负责让用户在按下
// 提交之前就知道哪一格有问题、以及后果是什么。
//
// 🔴 因此本文件的尺子刻意比后端**窄**，而且必须窄得"同向"：
//   · `redline: 'hard'` 的格（表 07 三列，来自表定义，不是这里手抄的）标红并写死后果
//     「写了会导致整发上传被拒绝」——这句话是承诺，所以这里的形态必须是后端**确定会拒**的。
//     每一条都在 eval-harness/tests/test_structured_intake.py 里有对应的 422 断言钉着。
//   · `redline: 'warn'` 的格（05 事实描述 / 06 述职四列）给黄色提醒，措辞是「这看起来像对人
//     的打分」，**不承诺会被拒绝**——后端在那两张表上不硬扫，因为它们的主语常是项目和工作
//     产物，而工作可以被量化（ADR-0016 的不对称）。话说得住，两边就不会打架。
//
// 返回的是**代码 + 参数**，不是句子：文案归 i18n（en/zh 两份），校验器保持无语言。

import type { IntakeColumn, IntakeForm } from '../../shared/intakeSchema'
import { INTAKE_FORMS } from '../../shared/intakeSchema'

export type IntakeRows = Record<string, Record<string, string>[]>

export type IssueLevel = 'error' | 'warn'

export type IssueCode =
  | 'required'      // 必填却空着
  | 'date'          // 不是 YYYY-MM-DD
  | 'number'        // 不是数字
  | 'percent'       // 不是 0–100 的整数
  | 'option'        // 不在下拉词表里
  | 'redlineHard'   // 人身评分形态，落在会被整发拒的列上
  | 'redlineWarn'   // 人身评分形态，落在只提醒的列上
  | 'ref'           // 跨表引用对不上

export interface CellIssue {
  form: string
  /** 数据行号，1 起 —— 与界面网格上显示的行号、与后端 `表单录入:01:行3` 里的行号同一个数。 */
  row: number
  column: string
  level: IssueLevel
  code: IssueCode
  /** 给文案填空用（命中的片段 / 引用目标）。 */
  detail?: string
  refForm?: string
  refColumn?: string
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const NUMBER_RE = /^-?\d+(\.\d+)?$/
const PERCENT_RE = /^\d{1,3}$/

// ── 红线尺子（窄、同向、每一条都有后端 422 断言钉着）────────────────────────────────────
// 分数形状：N/M · N% · N stars。与 redline_extract._RATING_NUMBER 同形。
const RATING_SHAPE =
  /\d{1,3}(?:\.\d+)?\s*(?:\/|out\s+of)\s*\d{1,3}|\d{1,3}(?:\.\d+)?\s*[%％]|\b\d(?:\.\d+)?\s*stars?\b/i

// 中文：评分话题词 + 分数形状的数字。否定项（年/个月/人/次/条…）与后端同一张表——
// 「入职 3 年」「处理了 5 条」不该被当成打分。
const ZH_SCORE_NEAR_NUM =
  /(?:评分|打分|得分|评级|定级|排名|绩效|潜力|考核|KPI)[^\dA-Za-z]{0,8}(?!19\d{2}|20\d{2})\d{1,3}(?!\s*(?:年|个月|月|周|天|日|人|名|位|万|个|千|百|亿|次|条|封|件|台|轮|页|字|号|元|块|米|公里|小时|分钟|岁|成|组|版本|版|项|份|期|章|节))/

// 中文：不带数字的定性评级/排名标签。收得很紧——只留后端实测会拒的那几种写法。
const ZH_SCORE_LABEL =
  /绩效评级|绩效等级|评级\s*[：:]|排名(?:倒数|第[一二三四五六七八九十\d])|末位淘汰|末流|垫底|优等生|差生/

// 英文：评分词表（后端 redline 的人身词表子集）。
const EN_SCORE =
  /\b(?:scored?|scoring|rating|rated|rank(?:ed|ing)?|percentile|low\s+performer|weakest\s+link|underperform\w*)\b/i

/** 这一格的文字看起来像"给人打分"吗？返回命中的片段（供文案引用），没命中返回空串。 */
export function scoreLikeSnippet(text: string): string {
  if (!text) return ''
  for (const re of [RATING_SHAPE, ZH_SCORE_NEAR_NUM, ZH_SCORE_LABEL, EN_SCORE]) {
    const m = re.exec(text)
    if (m) return m[0]
  }
  return ''
}

function formById(id: string): IntakeForm | undefined {
  return INTAKE_FORMS.find((f) => f.id === id)
}

function isBlank(v: string | undefined): boolean {
  return !v || v.trim() === ''
}

/** 这一行是不是整行空白（用户在网格里留的空行）—— 空行不校验，也不提交。 */
export function isBlankRow(row: Record<string, string>): boolean {
  return Object.values(row).every(isBlank)
}

function checkCell(form: IntakeForm, col: IntakeColumn, raw: string, rowNo: number): CellIssue[] {
  const out: CellIssue[] = []
  const value = (raw ?? '').trim()
  const at = { form: form.id, row: rowNo, column: col.key }

  if (col.required && !value) {
    out.push({ ...at, level: 'error', code: 'required' })
    return out   // 空格子没有别的可判的了
  }
  if (!value) return out

  if (col.kind === 'date' && !DATE_RE.test(value)) {
    out.push({ ...at, level: 'error', code: 'date', detail: value })
  }
  if (col.kind === 'number' && !NUMBER_RE.test(value)) {
    out.push({ ...at, level: 'error', code: 'number', detail: value })
  }
  if (col.kind === 'percent' && (!PERCENT_RE.test(value) || Number(value) > 100)) {
    out.push({ ...at, level: 'error', code: 'percent', detail: value })
  }
  if (col.options.length > 0 && !col.options.includes(value)) {
    out.push({ ...at, level: 'error', code: 'option', detail: value })
  }
  if (col.redline) {
    const snippet = scoreLikeSnippet(value)
    if (snippet) {
      out.push({
        ...at,
        level: col.redline === 'hard' ? 'error' : 'warn',
        code: col.redline === 'hard' ? 'redlineHard' : 'redlineWarn',
        detail: snippet,
      })
    }
  }
  return out
}

/**
 * 全量校验。返回的 issue 里 `level: 'error'` 会挡住提交，`'warn'` 只提醒。
 *
 * 跨表引用（负责人ID 指向 01 的人员ID 等）一律是 **warn**：用户完全可能先填 02 再回头补 01，
 * 或者这一批只交项目表。后端同样只记 warning 不硬拒（`structured.py` 的 dangling-ref），
 * 两侧口径一致。
 */
export function validateTables(tables: IntakeRows): CellIssue[] {
  const issues: CellIssue[] = []

  // 先建各表的"已存在的 ID 集合"，跨表引用照它判。
  const known: Record<string, Set<string>> = {}
  for (const form of INTAKE_FORMS) {
    for (const col of form.columns) {
      const key = `${form.id}/${col.key}`
      known[key] = new Set(
        (tables[form.id] ?? [])
          .filter((r) => !isBlankRow(r))
          .map((r) => (r[col.key] ?? '').trim())
          .filter(Boolean),
      )
    }
  }

  for (const [formId, rows] of Object.entries(tables)) {
    const form = formById(formId)
    if (!form) continue
    rows.forEach((row, i) => {
      if (isBlankRow(row)) return
      const rowNo = i + 1
      for (const col of form.columns) {
        issues.push(...checkCell(form, col, row[col.key] ?? '', rowNo))
        const ref = col.ref
        const value = (row[col.key] ?? '').trim()
        if (ref && value && !known[`${ref.form}/${ref.column}`]?.has(value)) {
          issues.push({
            form: form.id, row: rowNo, column: col.key, level: 'warn', code: 'ref',
            detail: value, refForm: ref.form, refColumn: ref.column,
          })
        }
      }
    })
  }
  return issues
}

/** 提交前的闸：只有 error 挡，warn 不挡（黄色提醒的定义就是"你知道了就行"）。 */
export function blockingIssues(issues: CellIssue[]): CellIssue[] {
  return issues.filter((i) => i.level === 'error')
}

/** 非空行数（提交时发出去的就是这些行）。 */
export function countRows(tables: IntakeRows): number {
  return Object.values(tables).reduce((n, rows) => n + rows.filter((r) => !isBlankRow(r)).length, 0)
}

/** 把网格里的空行剔掉再发——空行到了后端只会变成一条读不懂的空材料。 */
export function pruneTables(tables: IntakeRows): IntakeRows {
  const out: IntakeRows = {}
  for (const [formId, rows] of Object.entries(tables)) {
    const kept = rows.filter((r) => !isBlankRow(r))
    if (kept.length > 0) out[formId] = kept
  }
  return out
}
