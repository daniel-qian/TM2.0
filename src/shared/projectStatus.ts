// feat-068 追加 · 项目状态词的文案层——把后端的状态**枚举值**翻成当前语言的词。
//
// ⚠️ 这条是两条线的门中间漏下去的，而且**当时正跑在线上**：
//
//   · 部署线的门查的是**打包产物里有没有已知英文句子**（'WORTH A CLOSER LOOK' 之类）。
//     `blocked` / `done` 是枚举 token，不是句子，grep 名单里没有它们。
//   · 对齐线的门查的是**行为**，S1 的断言读 `st.team.projects[].status`（store 字段）并只判
//     "别把没写状态的项目编成 on-track"。屏幕上那个词是英文还是中文，它不看。
//
//   ⇒ 结果：src/lite/screens/TeamScreen.tsx 和 src/lite/DetailOverlay.tsx 直接 `{project.status}`
//     把枚举原样渲染。而裸域名 https://averylite.dannyqian.com 服务的正是 v01 + VITE_AVERY_LOCALE=zh，
//     所以中文客户在"你的团队"首屏和项目详情里读到的是光秃秃的 `blocked` / `done`。
//     逐屏中文纯度探针（真中文数据，9 屏抓 innerText）才逮到。
//
// 与 handoffCopy.ts 同构：组件里不留硬编码字面量，按字典出词；copy 用结构化最小接口，
// t.lite 和 t.lite2 两个 section 都满足（墙禁止 lite ↔ lite2 互相 import，所以落在 shared/）。
//
// 🔴 诚实红线（继承 fixA/fixB 那批的口径，别放松）：
//   · 后端**没写**状态 → 出「状态未提及」，绝不兜底成 on-track——"没说"和"没问题"不是一回事。
//   · 后端写了一个我们**不认识**的状态 → 原样透传那个词，既不丢也不编。同 briefing.ts 对未知
//     指标标签的处理口径。

/** 壳字典里状态词所需的那几个键（t.lite 与 t.lite2 两个 section 都满足）。 */
export interface ProjectStatusCopy {
  projectsStatusBlocked: string
  projectsStatusAtRisk: string
  projectsStatusOnTrack: string
  projectsStatusDone: string
  projectsStatusUnknown: string
}

/**
 * 后端状态枚举 → 当前语言的状态词。
 *
 * 认识的五个值翻译；缺失/空 → 「状态未提及」；不认识的非空值 → 原样返回（见文件头红线）。
 */
export function projectStatusText(
  status: string | null | undefined,
  copy: ProjectStatusCopy,
): string {
  const raw = typeof status === 'string' ? status.trim() : ''
  switch (raw) {
    case 'blocked':
      return copy.projectsStatusBlocked
    case 'at-risk':
      return copy.projectsStatusAtRisk
    case 'on-track':
      return copy.projectsStatusOnTrack
    case 'done':
      return copy.projectsStatusDone
    case '':
    case 'unknown':
      return copy.projectsStatusUnknown
    default:
      // 不认识 ≠ 没有。原样交给用户，让"后端吐了个新枚举"这件事看得见，而不是被我们抹平。
      return raw
  }
}
