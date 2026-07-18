// feat-068 · 分诊区（「今天值得你留意」）的文案层——把 teamData.ts 派生出的**结构化信号**
// 拼成当前语言的句子。
//
// ⚠️ 这一层为什么必须存在（下一个读到的人请不要把拼句"顺手"挪回派生层）：
//
//   ZH-02 的根因是：teamData.ts 的 liveHandoffs() / liveRead() 直接把英文句子拼进了数据——
//
//       toneLabel: 'Worth a closer look'
//       action:    `Take a look at ${pr.title}`
//       read:      `Owns ${card.owns.slice(0, 2).join(', ')}`
//
//   这些串是**前端自己算出来的**（信号来自项目 blocker / 人卡 owns 字段），后端一个字都管不着，
//   所以任何后端改动都救不了它们。而线上 https://averylite.dannyqian.com 是 VITE_AVERY_LOCALE=zh
//   的境内构建，**中文才是生产默认**。结果就是首页最重要的那块面板——回答"今天该把注意力放哪"
//   的那块——用英文标签裹着中文证据：「WORTH A CLOSER LOOK / Take a look at 客房系统改造」。
//
//   ⇒ 修法：派生层只产出**语料原文 + 结构化字段**（projectTitle / projectStatus / ownsRead），
//     一个英文单词都不拼；拼句全部下沉到这里，按字典出文案。派生层因此重新变成 locale-free 的
//     纯函数（同一份 payload 进，同一份结构化数据出，与语言无关），这也是它本来就该有的样子。
//
// 与 briefing.ts 的区别：那边的英文串是**后端**写死的，所以 EN 必须原样透传；这边的串是**我们
// 自己**拼的，所以 EN 和 ZH 一视同仁，都从字典取——组件里不留任何硬编码字面量。
//
// 🔴 红线：分诊条目描述的永远是**工作**（哪个项目、卡在哪），绝不是**某个人的好坏**。本文件
//    结构上就够不到人身级别的信号——输入里根本没有人的字段，只有 projectTitle / projectStatus /
//    语料原文行。人只以 personIds 的形式被"关联"，不被"评价"。
//
// 与 lite/lite2 的墙：本文件在 shared/ 下，两个壳都可 import（墙禁止 lite ↔ lite2 互相 import）。
// 这里刻意**不** import 任何一侧的 teamData 类型，改用结构化的最小接口——TS 是结构类型系统，
// lite 和 lite2 各自的 LiteHandoff / LitePerson 都天然满足。

// 壳字典里本地化分诊区所需的那些键（t.lite 和 t.lite2 两个 section 都满足）。
export interface HandoffCopy {
  handoffToneLabel: string
  handoffAction: string
  handoffEvidenceFallback: string
  handoffEvidenceTag: string
  handoffStatusAtRisk: string
  handoffStatusBlocked: string
  personReadOwns: string
  personReadListSeparator: string
  personReadNone: string
}

// 派生层交给文案层的最小形状（lite/lite2 的 LiteHandoff 都结构兼容）。
export interface HandoffLike {
  id: string
  tone: string
  projectTitle: string
  projectStatus: string
  // 语料原文（blocker 行，本来就是客户自己文件里的语言）——**空串**表示语料里没有可引的行，
  // 此时由 handoffEvidenceFallback 兜底拼一句。非空时逐字保留，一个字都不许改写。
  evidence: string
  personIds: readonly string[]
  projectIds: readonly string[]
}

// 渲染就绪的分诊条目：在 HandoffLike 之上补齐三个"拼出来的"展示串。
export interface HandoffDisplay extends HandoffLike {
  toneLabel: string
  action: string
  evidenceTag: string
}

// 与 lite/lite2 各组件里同名 helper 同形（本仓一贯写法）。
function fill(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_, k: string) => String(vars[k] ?? ''))
}

/**
 * 项目状态字面量 → 当前语言的状态词。
 *
 * 只认后端 registry.py 会吐的那两个值。**未知状态原样透传**——同 localizeBriefing 处理未知
 * metric label 的口径：宁可让一个英文串露出来，也不静默吞掉、更不擅自编一个中文词。
 */
function statusWord(status: string, copy: HandoffCopy): string {
  if (status === 'at-risk') return copy.handoffStatusAtRisk
  if (status === 'blocked') return copy.handoffStatusBlocked
  return status
}

/**
 * 一条分诊条目 → 渲染就绪的条目。
 *
 * evidence 的两条路：
 *   ① 语料里有 blocker 原文 → 逐字保留（可溯源，零捏造——这是整个面板的可信度来源）。
 *   ② 没有原文 → 用 projectTitle + 本地化状态词兜底成一句话。注意这条路只在项目
 *      status 已是 at-risk/blocked 时才可能走到（见 teamData.ts liveHandoffs 的准入门）。
 */
export function localizeHandoff(handoff: HandoffLike, copy: HandoffCopy): HandoffDisplay {
  const evidence =
    handoff.evidence.trim().length > 0
      ? handoff.evidence
      : fill(copy.handoffEvidenceFallback, {
          project: handoff.projectTitle,
          status: statusWord(handoff.projectStatus, copy),
        })

  return {
    ...handoff,
    toneLabel: copy.handoffToneLabel,
    // ⚠️ 整句模板 + 占位符，**不是**「动词 + 名字」的拼接。中文语序与英文不同（英文
    // "Take a look at X" 是动词在前，中文更自然的是把项目名摆在句首再说要你做什么），
    // 拼接式写法在中文里必然读起来像机翻。占位符让每种语言各自决定语序。
    action: fill(copy.handoffAction, { project: handoff.projectTitle }),
    evidence,
    evidenceTag: copy.handoffEvidenceTag,
  }
}

// 人卡"定性读数"的最小形状（lite/lite2 的 LitePerson 都结构兼容）。
export interface PersonReadLike {
  // 语料原文（collaboration 首条 / tenure 原句）——空串表示语料里没有可引的原文。
  read: string
  // owns 情境的原文条目（派生层已截断到 2 条），由本层拼成「负责 X、Y」。
  ownsRead: readonly string[]
}

/**
 * 人卡读数 → 当前语言的一行字。
 *
 * 🔴 红线：这行字只说**她在扛什么**（协作情境 / 负责的事 / 在岗时长），永远不评价她扛得
 *    好不好。三条分支产出的都是中性陈述句，没有任何形容词、评级、排名或数字。
 *
 * 优先级与派生层一致：语料原文 > owns 情境 > 中性兜底。
 */
export function localizePersonRead(person: PersonReadLike, copy: HandoffCopy): string {
  const verbatim = person.read.trim()
  if (verbatim.length > 0) return verbatim

  const owns = person.ownsRead.filter((o) => o.trim().length > 0)
  if (owns.length > 0) {
    // 列表分隔符走字典：英文是 ", "，中文是顿号「、」——硬编码 join(', ') 会让中文列表
    // 里混进半角逗号+空格，一眼就是翻译腔。
    return fill(copy.personReadOwns, { items: owns.join(copy.personReadListSeparator) })
  }

  return copy.personReadNone
}
