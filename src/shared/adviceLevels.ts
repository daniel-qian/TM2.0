// avery-sync zh-purity · Room advice card（8 字段结构化卡）里两处后端封闭枚举的文案层——
// 把 LiteAdvice.confidence.level / .escalation.level 这两个**枚举值**翻成当前语言的词。
//
// 与 src/shared/projectStatus.ts 同一类缺陷、同一种修法：
//   · confidence-badge / escalation-badge 之前是 `{advice.confidence.level}` /
//     `{advice.escalation.level}` 直接渲染——枚举 token 不是句子，任何"找英文句子"的部署门
//     grep 名单都逮不到它们；而中文纯度门（逐屏抓 innerText）才会把 'low' / 'medium' /
//     'HRBP' 这些裸词捞出来。
//   · 两张卡（lite/LiteAdviceCard.tsx、lite2/LiteAdviceCard.tsx）都读同一份服务端契约
//     （service/contract.py 投影），枚举值集合固定、可穷举——同 projectStatusText 的判断。
//
// 与 lite/lite2 的墙：本文件在 shared/ 下，两个壳都可 import（墙禁止 lite ↔ lite2 互相
// import）。这里刻意**不** import LiteAdvice 类型，改用结构化的最小接口——TS 是结构类型
// 系统，两侧 streamSource.ts 各自的 LiteAdvice['confidence']/['escalation'] 都天然满足。
//
// 🔴 诚实红线：这两个词描述的是"这次判读有多确定"和"该找谁把关"——不是对任何人的评价。
//    不认识的取值原样透传（同 projectStatusText 处理未知状态的口径）：宁可让一个英文词
//    露出来，也不静默吞掉或擅自编一个中文词。

/** 壳字典里 confidence 徽章词所需的那几个键（t.lite 与 t.lite2 两个 section 都满足）。 */
export interface AdviceConfidenceCopy {
  adviceConfidenceLow: string
  adviceConfidenceMedium: string
  adviceConfidenceHigh: string
}

/** 壳字典里 escalation 徽章词所需的那几个键（t.lite 与 t.lite2 两个 section 都满足）。 */
export interface AdviceEscalationCopy {
  adviceEscalationNotYet: string
  adviceEscalationHRBP: string
  adviceEscalationLegal: string
  adviceEscalationWellbeing: string
  adviceEscalationCompensation: string
  adviceEscalationExecutive: string
}

/**
 * confidence.level（'low' | 'medium' | 'high'）→ 当前语言的徽章词。
 *
 * 类型上是穷举的三值枚举；`default` 分支只是给"契约以后加了新档位、这份前端代码还没跟上"
 * 兜底，原样透传，不是正常路径。
 */
export function confidenceLevelText(level: string, copy: AdviceConfidenceCopy): string {
  switch (level) {
    case 'low':
      return copy.adviceConfidenceLow
    case 'medium':
      return copy.adviceConfidenceMedium
    case 'high':
      return copy.adviceConfidenceHigh
    default:
      return level
  }
}

/**
 * escalation.level（'none' | 'HRBP' | 'legal' | 'wellbeing' | 'compensation' | 'executive'）
 * → 当前语言的徽章词。'none' 译成"暂时不用"这类肯定句，而不是留空——组件之前用
 * `level === 'none' ? 'not yet' : level` 硬编码同样的特判，这里把两条分支收进同一个函数。
 */
export function escalationLevelText(level: string, copy: AdviceEscalationCopy): string {
  switch (level) {
    case 'none':
      return copy.adviceEscalationNotYet
    case 'HRBP':
      return copy.adviceEscalationHRBP
    case 'legal':
      return copy.adviceEscalationLegal
    case 'wellbeing':
      return copy.adviceEscalationWellbeing
    case 'compensation':
      return copy.adviceEscalationCompensation
    case 'executive':
      return copy.adviceEscalationExecutive
    default:
      return level
  }
}
