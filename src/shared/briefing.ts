// feat-068 · briefing 本地化——把后端写死的英文简报在前端翻成中文。
//
// ⚠️ 为什么这层必须活在前端（下一个读到的人请不要"顺手"删掉它）：
//
//   后端 eval-harness/avery/ingest/registry.py 的 CompanyContext.briefing() 是 **locale-blind**
//   的——它把 headline / subhead / metrics[].label 三处全部用英文字面量拼死，请求里没有任何
//   locale 参数可传，返回体里也没有任何结构化的语言标记：
//
//       headline = f"Ingested {files_phrase} file(s): {n_people} people, {n_proj} projects."
//       metrics  = [{"label": "people", ...}, {"label": "active projects", ...}]
//
//   而线上 https://averylite.dannyqian.com 是 `VITE_AVERY_LOCALE=zh` 的境内构建，**中文才是
//   生产默认**（首批真用户是三亚某酒店集团和一支境内投资团队）。于是中文页顶栏一直在原样吐
//   英文。正确的修法当然是后端按 locale 出文案，但线上容器跑的是 2026-07-17 构建的镜像，重建
//   未获授权（重建还会顺带带上一条尚未 apply 的 migration）。所以修在前端，且只能修在前端。
//
//   ⇒ 哪天后端真的支持了 locale（payload 里出现语言标记 / 接受 lang 参数），这个文件才可以退休。
//     在那之前删掉它 = 中文用户重新看到英文简报。
//
// 三条硬约束：
//   1) locale === 'en' → **原样透传**后端字符串，一个字节都不改（metric label 也不改）。
//      英文文案本身是对的，而且携带了我们复现不了的细节（见 3）。海外构建视觉零变化。
//   2) locale === 'zh' → 用 payload 已有的结构化数据本地重组：team.people.length /
//      team.projects.length / at-risk 计数。at-risk 计数**取自后端自己的 metrics 条目**，不在前端
//      重新按 project.status 推导——后端的判据是 status in ("at-risk", "blocked")，前端复制一份
//      迟早漂移。
//   3) 中文 headline **不复述文件数**。后端的 files_phrase 可能是 "3 of 5"（解析成功 / 实际上传），
//      这个区分是一道诚实闸，而前端拿不到——payload 的 source_files 只装解析成功的那些，前端复述
//      任何数字都可能比后端更乐观。UI 在右栏 UploadPanel 里已经把「取材自: <真实文件名>」逐个列
//      出来了，那比一个计数严格更诚实。所以中文 headline 只说人和项目，出处交给文件名。
//
// 🔴 红线：简报可以描述**工作量**，永远不描述**某个人的好坏**。不出现任何针对人的评分/等级/
//    排名/健康度数字。「有多少人」是可以说的。
//
// 与 lite/lite2 的墙：本文件在 shared/ 下，两个壳都可以 import（墙禁止 lite ↔ lite2 互相 import，
// 但都允许 import shared）。这里刻意**不** import 任何一侧的 teamData 类型，改用结构化的最小接口
// ——TS 是结构类型系统，lite 和 lite2 各自的 LiteBriefing / LiteTeam 都天然满足。

import type { Locale } from './i18n'

export interface BriefingMetric {
  label: string
  value: string
}

// 后端 briefing 的最小形状（lite/lite2 的 LiteBriefing 都结构兼容）。
export interface BriefingLike {
  headline: string
  subhead: string
  metrics: readonly BriefingMetric[]
}

// 只取计数用的两个数组——刻意不约束元素类型，避免把 lite 的 LitePerson 拖进 shared。
export interface TeamCountsLike {
  people: readonly unknown[]
  projects: readonly unknown[]
}

// 壳字典里本地化简报所需的那几个键（t.lite 和 t.lite2 两个 section 都满足）。
export interface BriefingCopy {
  briefingHeadline: string
  briefingSubheadRisk: string
  briefingSubheadCalm: string
  briefingMetricPeople: string
  briefingMetricProjects: string
  briefingMetricNeedLook: string
}

// 与 lite/lite2 各组件里同名 helper 同形（本仓一贯写法）。
function fill(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_, k: string) => String(vars[k] ?? ''))
}

// 后端 metrics[].label 的三个已知字面量（registry.py briefing() 里写死的那三个）。
// 与后端保持逐字一致——改这里之前先去看 registry.py。
const METRIC_PEOPLE = 'people'
const METRIC_PROJECTS = 'active projects'
const METRIC_NEED_LOOK = 'need a look'

/**
 * 把后端简报变成当前语言的简报。
 *
 * en：原样返回（同一个对象引用，零改动）。
 * zh：headline/subhead 本地重组，metrics 逐条按 label 映射；**遇到未知 label 保留后端原串**
 *     ——哪天后端加了第四个指标，宁可它以英文露出，也不能被静默吞掉。
 */
export function localizeBriefing(
  briefing: BriefingLike,
  team: TeamCountsLike,
  copy: BriefingCopy,
  locale: Locale,
): { headline: string; subhead: string; metrics: BriefingMetric[] } {
  // 约束 1：英文原样透传。这里提前 return，保证 EN 构建下这个文件等于不存在。
  if (locale !== 'zh') {
    return { headline: briefing.headline, subhead: briefing.subhead, metrics: [...briefing.metrics] }
  }

  const peopleCount = team.people.length
  const projectCount = team.projects.length

  // 约束 2：at-risk 计数只认后端的 metrics 条目，不在前端按 project.status 重推。
  // 后端只在 at_risk 非空时才 append 这一条，所以「条目不存在」== 「零风险信号」，
  // 正好对上 subhead 的 calm 分支——两边用同一个判据，不会出现「说没风险却列着风险数」。
  const needLookMetric = briefing.metrics.find((m) => m.label === METRIC_NEED_LOOK)
  const atRiskCount = needLookMetric ? Number(needLookMetric.value) : 0
  const hasRisk = needLookMetric !== undefined && Number.isFinite(atRiskCount) && atRiskCount > 0

  // 约束 3：headline 只说人和项目，绝不复述文件数（"3 of 5" 的诚实区分前端复现不了）。
  const headline = fill(copy.briefingHeadline, { people: peopleCount, projects: projectCount })
  const subhead = hasRisk
    ? fill(copy.briefingSubheadRisk, { atRisk: atRiskCount })
    : copy.briefingSubheadCalm

  const metrics = briefing.metrics.map((m) => {
    switch (m.label) {
      case METRIC_PEOPLE:
        return { label: copy.briefingMetricPeople, value: m.value }
      case METRIC_PROJECTS:
        return { label: copy.briefingMetricProjects, value: m.value }
      case METRIC_NEED_LOOK:
        return { label: copy.briefingMetricNeedLook, value: m.value }
      default:
        // 未知 label：保留后端原串（宁可露英文，也不丢指标）。
        return { label: m.label, value: m.value }
    }
  })

  return { headline, subhead, metrics }
}
