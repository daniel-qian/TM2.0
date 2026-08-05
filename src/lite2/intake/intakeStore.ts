import { create } from 'zustand'
import { INTAKE_FORMS } from '../../shared/intakeSchema'
import { useOnboard } from '../onboardStore'
import type { IntakeRows } from './validate'

// 7 张标准表在 app 内的行状态 —— onboarding-accounts-0805 ②（ADR-0034 拍板 1/3/4）。
//
// 独立成 store 的理由与 onboardStore 一样（"减冲突面"）：这里装的是**用户正在填的表格数据**，
// 与向导的步骤/偏好完全正交，混进 onboardStore 会让那个本来只有十来个字段的持久化对象变成
// 一个几百行的表。持久化键也因此分开。
//
// 🔴 预览模式（拍板 8）在这里同样有一处兑现：`persist()` 跳过。横幅上写着「未填写的数据不会
// 保存」，而表格是这整条向导里唯一一处用户会真的输入大量内容的地方——它要是照存不误，那句话
// 就是整条向导里最显眼的谎。

const STORAGE_KEY = 'lite2:intake:v1'

/** 一张空行（所有列都是空串）。列序照表定义，不是 Object.keys 的偶然顺序。 */
export function emptyRow(formId: string): Record<string, string> {
  const form = INTAKE_FORMS.find((f) => f.id === formId)
  const row: Record<string, string> = {}
  for (const col of form?.columns ?? []) row[col.key] = ''
  return row
}

function initialRows(): IntakeRows {
  // 每张表默认给一行空行——一张零行的网格看起来像"这里没东西可填"，
  // 而它其实是这一步的主体。给一行，用户看见的是一张等着被填的表。
  const out: IntakeRows = {}
  for (const form of INTAKE_FORMS) out[form.id] = [emptyRow(form.id)]
  return out
}

function loadPersisted(): IntakeRows {
  const base = initialRows()
  try {
    if (typeof window === 'undefined' || !window.localStorage) return base
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return base
    const parsed = JSON.parse(raw) as Record<string, unknown>
    for (const form of INTAKE_FORMS) {
      const stored = parsed[form.id]
      if (!Array.isArray(stored)) continue
      const clean = stored
        .filter((r): r is Record<string, unknown> => !!r && typeof r === 'object')
        // 🔴 按**表定义**重建每一行，不是照单全收：存盘之后表定义可能加/删过列，直接用存下来
        // 的键会让网格与表头对不上——而对不上的症状是"某一列永远是空的"，没有任何报错。
        .map((r) => {
          const row = emptyRow(form.id)
          for (const col of form.columns) {
            const v = r[col.key]
            if (typeof v === 'string') row[col.key] = v
          }
          return row
        })
      base[form.id] = clean.length > 0 ? clean : [emptyRow(form.id)]
    }
    return base
  } catch {
    return base
  }
}

function savePersisted(rows: IntakeRows): void {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(rows))
  } catch {
    // 写满/无痕 —— 本次仍在内存态生效。表格可能很大，配额是真会满的；
    // 存不下不影响这一次提交（提交读的是内存态）。
  }
}

interface IntakeState {
  rows: IntakeRows
  /** 左侧导航当前选中的表。 */
  activeForm: string
  setActiveForm: (formId: string) => void
  setCell: (formId: string, rowIndex: number, columnKey: string, value: string) => void
  addRow: (formId: string) => void
  removeRow: (formId: string, rowIndex: number) => void
  /** 粘贴：整批替换或追加到该表。 */
  applyRows: (formId: string, incoming: Record<string, string>[], mode: 'replace' | 'append') => void
  clearAll: () => void
}

export const useIntake = create<IntakeState>((set, get) => {
  const persist = () => {
    if (useOnboard.getState().preview) return   // 拍板 8：预览态一个字都不落盘
    savePersisted(get().rows)
  }

  return {
    rows: loadPersisted(),
    activeForm: INTAKE_FORMS[0]?.id ?? '01',

    setActiveForm: (formId) => set({ activeForm: formId }),

    setCell: (formId, rowIndex, columnKey, value) => {
      set((s) => {
        const rows = { ...s.rows }
        const list = [...(rows[formId] ?? [])]
        if (!list[rowIndex]) return s
        list[rowIndex] = { ...list[rowIndex], [columnKey]: value }
        rows[formId] = list
        return { rows }
      })
      persist()
    },

    addRow: (formId) => {
      set((s) => ({ rows: { ...s.rows, [formId]: [...(s.rows[formId] ?? []), emptyRow(formId)] } }))
      persist()
    },

    removeRow: (formId, rowIndex) => {
      set((s) => {
        const list = (s.rows[formId] ?? []).filter((_, i) => i !== rowIndex)
        // 删到零行就补一张空行——空网格看起来像功能坏了。
        return { rows: { ...s.rows, [formId]: list.length > 0 ? list : [emptyRow(formId)] } }
      })
      persist()
    },

    applyRows: (formId, incoming, mode) => {
      set((s) => {
        const current = s.rows[formId] ?? []
        // replace 之前把整行空白的占位行丢掉，否则粘贴完表头上会顶着一行空的。
        const kept = mode === 'append'
          ? current.filter((r) => Object.values(r).some((v) => v.trim() !== ''))
          : []
        return { rows: { ...s.rows, [formId]: [...kept, ...incoming] } }
      })
      persist()
    },

    clearAll: () => {
      set({ rows: initialRows() })
      persist()
    },
  }
})

// ── arch-0802 · 公司域清扫收口 ───────────────────────────────────────────────────────────
// 表格里装的全是公司数据（花名册、项目台账、风险事项……），换账号一个都不许活。
// localStorage 侧由 AuthPanel 的 `lite2:` 前缀全扫覆盖；内存态由这里复位。
export function resetIntakeCompanyScope(): void {
  useIntake.setState({ rows: initialRows(), activeForm: INTAKE_FORMS[0]?.id ?? '01' })
}
