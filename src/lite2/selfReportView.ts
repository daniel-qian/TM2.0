import type { Dict } from '../shared/i18n'

// team-map-revival-0804 · B2 · 本人自述（self_report）的**文案层**——一处定义，多个消费方。
//
// 原来这份判断分散在 `TeamScreen.tsx` 里的两个私有函数（`moodLabel` 给人卡、`moodChipLabel`
// 给筛选 chip）。B2 的地图要在部门分区上出组级读数（PRD §3.3），成了第三个消费方——再抄
// 一份就是同一个归一词在三块屏上各叫各的名字，正是 ADR-0034 双实现漂移的老坑。
// 逻辑一字未改，只是提到了一个 TeamScreen 与 map 都够得着的地方（B1 把 `projectStatusTone`
// 从 ProjectsScreen 提进 `projectView.ts` 是同一个动作、同一个理由）。
//
// 🔴 本模块只做「归一键 → 当前字典里的词」。它不判开关、不读 store、不产任何数字——
// 自述负载那个百分数**没有**也不会有对应的 helper：它是全仓唯一被特许的人身数字，
// 只活在 TeamScreen 的 `SelfReportRow`（带 `data-metric-source` 出处锚点）里，地图一律不显。

/**
 * 情绪归一枚举 → 当前字典的词。
 *
 * `value` 走后端归一词表（steady / stretched / strained / other）；词表外（other）时
 * **原样回显文档原词** `valueRaw`——不替客户改写他自己写下的那个词。
 * 拿不到原词才落回「其他」（筛选 chip 就是这种：它手上只有键，没有某一个人的原句）。
 */
export function moodWordOf(
  value: string | undefined | null,
  valueRaw: string | undefined | null,
  l: Dict['lite2'],
): string {
  switch (value) {
    case 'steady':
      return l.selfReportMoodSteady
    case 'stretched':
      return l.selfReportMoodStretched
    case 'strained':
      return l.selfReportMoodStrained
    default:
      return valueRaw?.trim() || l.selfReportMoodOther
  }
}
