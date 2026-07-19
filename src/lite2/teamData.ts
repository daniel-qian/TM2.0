// feat-024（ADR-0022 决策 1）· lite 的 Your team 数据映射——纯 live payload，零 fixtures。
// 原 feat-017 teamDataSource.ts 的 live 半边搬进墙内；类型全部 lite 本地。
//
// 🔴 红线（施工图 §5 / ADR-0021 §4）：
//   ① live 人卡只走定性读数——moodPct / capacityPct / 任何人评分永不渲染、永不填。
//      LitePerson **不含**这些字段（结构性护栏）；stripPersonNumbers 再做运行时剥离兜底。
//   ② 指向人的信号停在"情境"（她在扛什么），不变成对人的负面标签。
//   ③ 聚合数字 R2：真算或不显示，绝不编——briefing.metrics 直接来自 ingestion（人数/项目数真数）。

import { getDict, resolveLocale, type Locale } from '../shared/i18n'
import type { LivePersonCard, LiveProjectCard, LiveTeamPayload } from './transport'

// 卡片左缘墨条的语气温度（与 shared CSS 的 home-tone-* 类同名）：
// sage 安稳 · honey 值得一看 · terracotta 今天需要你。
export type LiteTone = 'sage' | 'honey' | 'terracotta'

// 人卡形状——定性 ONLY，**没有**任何数字键（红线结构护栏）。
export interface LitePerson {
  id: string
  name: string
  role: string
  team?: string
  // feat-068 · read 只装**语料原文**（collaboration 首条 / tenure 原句）；空串 = 语料里没有可引
  // 的原文。任何"拼出来的句子"都不在派生层生成——拼句是文案层的事（shared/handoffCopy.ts 的
  // localizePersonRead）。以前这里直接拼 `Owns ${...}`，把英文烧死进数据，中文构建再也救不回来。
  read: string
  ownsRead: string[] // feat-068 · owns 情境的原文条目（已截断到 2 条），交给文案层拼成「负责 X、Y」
  tone: LiteTone
  tenure?: string
  owns?: string[]
  collaboration?: string[]
  sourceLine?: string
}

export interface LiteProject {
  id: string
  title: string
  /**
   * 🔴 **渲染用文案，不是判据**（同 `status`）。文档写了负责人 → 那个人名；文档里没读到 →
   * 本地化的「文档未提及」。
   *
   * 判断一律用 `ownerNameRaw`。曾经这里写的是 `card.ownerName ?? 'Unassigned'`：后端在
   * owner 缺失时**根本不发这个键**（registry.py 与 status 同一条 "R2 don't invent" 口径），
   * 于是这一行替客户补了两样它没说的东西——① 一个**英文词**，印在中文客户的团队屏上；
   * ② 一句**管理判断**（「这个项目没人负责」），而文档只是没提到是谁。
   * 07-19 裸域名切成 v02 之后在**生产**上抓到：一个 `owner: null` 的项目，卡片上写着
   * `Unassigned`，而后端 payload 里根本没有这个词——是前端自己编的。
   *
   * 复用 `projectsUnknownValue`（项目详情浮层 DetailOverlay 对同一处缺失早就是这么显示的）
   * 而不是新造键：同一个项目在两处显示时不许说法不一致。
   * ⚠️ **不要写成「未分配」**——那是在替客户断言「文档说了没有负责人」，正是本行原来犯的错。
   */
  ownerName: string
  /** 文档自述的负责人。**缺失就是缺失**（`undefined`），绝不兜底、绝不猜。 */
  ownerNameRaw?: string
  /**
   * 🔴 **渲染用文案，不是判据。** 文档写了状态 → 原样是那个状态词（`on-track` / `blocked` …，
   * 抽取层归一后的词，状态点与卡片边色都按它取色）；文档里没读到 → 本地化的「未读到状态」。
   *
   * 判断一律用 `statusRaw`。曾经这里写的是 `card.status ?? 'on-track'`：后端在 status 为空时
   * **根本不发这个键**（registry.py 注释写着 "left absent (R2 don't invent)"）、决策层把它记进
   * `unknown_fields` 并写「未读到：状态」，唯独这一行替客户补了一句「一切正常」。实测约四分之一
   * 的项目命中，后果一路传到「多看一眼」——一句客户从没说过的话被加上引号，摆进「文件里的说法」。
   */
  status: string
  /** 文档自述的状态原值。**缺失就是缺失**（`undefined`），绝不兜底、绝不猜。 */
  statusRaw?: string
  progress?: number // 可量化（文档写了就显）——项目可硬
  dueDate?: string
  summary?: string
  blockers?: string[]
}

// 弱版 handoff（R1）：只从项目 blocker（doc-derived 信号）生成"看一眼"类行动项；
// 缺信号 → 不造。指向项目/情境，绝不点名评判人。
//
// feat-068 · 本结构体是 **locale-free** 的：只装结构化字段 + 语料原文，一个成句的文案都不装。
// toneLabel / action / evidenceTag 三个展示串已下沉到 shared/handoffCopy.ts 的 localizeHandoff()，
// 由渲染层按当前字典拼出来（ZH-02：它们以前是写死的英文，中文页因此顶着英文标签）。
export interface LiteHandoff {
  id: string
  tone: LiteTone
  projectTitle: string // 拼句用（文案层决定语序，派生层不拼）
  projectStatus: string // 无 blocker 原文时，文案层用它拼兜底证据句
  evidence: string // blocker 原文，逐字保留；空串 = 无原文可引，由文案层兜底
  personIds: string[]
  projectIds: string[]
}

// fixA · 「多看一眼」那个数字的**形状**，不只是它的大小。
//
// 中文壳（线上 VITE_AVERY_LOCALE=zh，是生产默认）把这个数字填进一句写死量词的话：
// 「其中 {N} 个项目值得多看一眼」。但后端的这个计数里可以混着**挂不到任何项目上的信号**
// ——抽取层给每条 doc 信号写死 subjectRef="the project"（extract.py::_signals_from_doc），
// 它们因此谁也挂不上。于是实测出现过 0 个项目 + 2 条信号 →「0 个进行中的项目 … 其中 2 个
// 项目值得多看一眼」，凭空点名两个不存在的项目，就印在「没有一处是编的」正下方。
//
// 所以后端现在多发一个 look_kind（registry.py::briefing）：
//   'projects' — 数出来的每一样都确实是项目，且总数不会超过项目总数 →「N 个项目」才是安全的
//   'items'    — 里面混着挂不到项目上的读数 → 必须换成不点名的量词（「N 处」）
//   'none'     — 什么都没数出来 → calm 分支
// 老后端（pre-fixA）不发这个键，读出来是 undefined —— 消费方遇到 undefined 时按 'items'
// 这一侧兜底（说「N 处」永远不会比事实更肯定；说「N 个项目」可能凭空点名）。
export type LiteLookKind = 'projects' | 'items' | 'none'

export interface LiteBriefing {
  tone: 'calm' | 'alert'
  headline: string
  subhead: string
  metrics: { label: string; value: string }[]
  lookKind?: LiteLookKind
}

export interface LiteTeam {
  contextId: string
  sourceFiles: string[]
  people: LitePerson[]
  projects: LiteProject[]
  handoffs: LiteHandoff[]
  briefing: LiteBriefing
}

// 🔴 红线运行时兜底：即便后端某天错吐了 moodPct/capacityPct/score/rank/rating/tier，
// 也在这里剥掉——live 人卡结构上永不携带任何血条/评分字段。
const BLOOD_BAR_KEYS = new Set([
  'moodPct',
  'capacityPct',
  'mood',
  'capacity',
  'score',
  'rank',
  'rating',
  'tier',
  'percentile',
])

export function stripPersonNumbers(card: LivePersonCard): LivePersonCard {
  const clean: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(card)) {
    if (BLOOD_BAR_KEYS.has(k)) continue // 红线：丢弃
    if (typeof v === 'number') continue // 人卡上不留任何裸数字（防新血条字段偷渡）
    clean[k] = v
  }
  return clean as unknown as LivePersonCard
}

// ingestion 人卡 → 定性读数：优先 collaboration（她在跟谁协作/扛什么），否则 owns 情境，否则中性句。
//
// feat-068 · 这里只**挑**语料原文、只**分类**信号，不再拼任何成句文案（原来的
// `Owns ${...}` / `On the team` 是写死的英文，中文人卡因此顶着英文读数）。成句在
// shared/handoffCopy.ts 的 localizePersonRead() 里按字典拼。
function liveRead(card: LivePersonCard): { read: string; ownsRead: string[]; tone: LiteTone } {
  const collab = (card.collaboration ?? []).map((c) => c.trim()).filter(Boolean)
  if (collab.length > 0) {
    return { read: collab[0], ownsRead: [], tone: 'sage' }
  }
  const owns = (card.owns ?? []).map((o) => o.trim()).filter(Boolean)
  if (owns.length > 0) {
    // 只截断、不拼串——「负责 X、Y」的顿号与语序由文案层按语言决定。
    return { read: '', ownsRead: owns.slice(0, 2), tone: 'sage' }
  }
  if (card.tenure && card.tenure.trim()) {
    return { read: card.tenure.trim(), ownsRead: [], tone: 'sage' }
  }
  // 无任何信号：read/ownsRead 都留空，文案层出中性兜底句（personReadNone）。
  return { read: '', ownsRead: [], tone: 'sage' }
}

// 与 lite/lite2 各组件里同名 helper 同形（本仓一贯写法）。
function fill(template: string, vars: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (_, k: string) => vars[k] ?? '')
}

type HandoffCopy = Pick<
  ReturnType<typeof getDict>['lite2'],
  'handoffToneLabel' | 'handoffAction' | 'handoffEvidenceFallback' | 'handoffEvidenceTag'
>

function liveHandoffs(payload: LiveTeamPayload, copy: HandoffCopy): LiteHandoff[] {
  const out: LiteHandoff[] = []
  for (const pr of payload.projects) {
    // feat-068 · 空白 blocker 行不算信号：以前 `['']` 这种脏数据会当成"有原文"，渲染出一条
    // 证据为空的分诊卡；现在先 trim/filter，空行走文案层的兜底句。
    const blockers = (pr.blockers ?? []).map((b) => b.trim()).filter(Boolean)
    const status = pr.status ?? ''
    const atRisk = status === 'at-risk' || status === 'blocked'
    if (!atRisk && blockers.length === 0) continue
    out.push({
      id: `lh_${pr.id}`,
      tone: status === 'blocked' ? 'terracotta' : 'honey',
      projectTitle: pr.title,
      projectStatus: status,
      evidence: blockers.length > 0 ? blockers[0] : '',
      personIds: pr.ownerId ? [pr.ownerId] : [],
      projectIds: [pr.id],
    })
  }
  return out
}

// 上传产出 → lite 屏幕数据。入口即剥净每张人卡的数字字段（红线）。
//
// `locale` 默认现取（`resolveLocale()` 读 `?lang=` / 构建期 `VITE_AVERY_LOCALE`，与 useDict 同源；
// 壳内没有运行时切换语言的入口，所以在映射期定文案与在渲染期定文案等价）。显式传入是给测试用的。
export function liteTeamFromPayload(
  payload: LiveTeamPayload,
  locale: Locale = resolveLocale(),
): LiteTeam {
  const copy = getDict(locale).lite2
  const cleanPeople = payload.people.map(stripPersonNumbers)

  const people: LitePerson[] = cleanPeople.map((card) => {
    const { read, ownsRead, tone } = liveRead(card)
    return {
      id: card.id,
      name: card.name,
      role: card.role ?? '',
      team: card.team,
      read,
      ownsRead,
      tone,
      tenure: card.tenure,
      owns: card.owns,
      collaboration: card.collaboration,
    }
  })

  const projects: LiteProject[] = payload.projects.map((card: LiveProjectCard) => {
    // 🔴 「我没读到」和「客户说没有」是两件事。空串也算没读到（后端只在有值时才发这个键，
    // 但契约上 status?: string，收到 '' 同样不许被当成一个状态词）。
    const statusRaw = card.status?.trim() ? card.status.trim() : undefined
    // 🔴 owner 同理：空串也算没读到（契约上 ownerName?: string，收到 '' 不许被当成一个人名）。
    // 认领顺序与 projectView.ts 同口径：文档写的名字 → ownerId 反查到的人 → 都没有就是没读到。
    const ownerNameRaw =
      card.ownerName?.trim() ||
      cleanPeople.find((p) => p.id === card.ownerId)?.name?.trim() ||
      undefined
    return {
      id: card.id,
      title: card.title,
      ownerName: ownerNameRaw ?? copy.projectsUnknownValue,
      ownerNameRaw,
      status: statusRaw ?? copy.projectStatusUnread,
      statusRaw,
      progress: card.progress,
      dueDate: card.dueDate,
      summary: card.summary,
      blockers: card.blockers,
    }
  })

  const b = payload.briefing
  return {
    contextId: payload.context_id,
    sourceFiles: payload.source_files ?? [],
    people,
    projects,
    handoffs: liveHandoffs(payload, copy),
    briefing: {
      tone: b.tone === 'alert' ? 'alert' : 'calm',
      headline: b.headline,
      subhead: b.subhead,
      metrics: b.metrics ?? [],
      lookKind: readLookKind(b),
    },
  }
}

// look_kind 是 fixA 之后才有的键，`LiveBriefingPayload`（src/lite2/transport.ts）还没声明它，
// 所以在这里就地窄化读一次，而不是让契约类型漂在别人的文件里。认不出来的值一律当 undefined
// ——消费方对 undefined 的兜底是**不点名**那一侧，宁可少说一个词，不可多点一个不存在的项目。
function readLookKind(briefing: unknown): LiteLookKind | undefined {
  const raw = (briefing as { look_kind?: unknown } | null)?.look_kind
  return raw === 'projects' || raw === 'items' || raw === 'none' ? raw : undefined
}
