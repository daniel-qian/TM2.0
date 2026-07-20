// feat-024（ADR-0022 决策 1）· lite 的 Your team 数据映射——纯 live payload，零 fixtures。
// 原 feat-017 teamDataSource.ts 的 live 半边搬进墙内；类型全部 lite 本地。
//
// 🔴 红线（施工图 §5 / ADR-0021 §4）：
//   ① live 人卡只走定性读数——moodPct / capacityPct / 任何人评分永不渲染、永不填。
//      LitePerson **不含**这些字段（结构性护栏）；stripPersonNumbers 再做运行时剥离兜底。
//   ② 指向人的信号停在"情境"（她在扛什么），不变成对人的负面标签。
//   ③ 聚合数字 R2：真算或不显示，绝不编——briefing.metrics 直接来自 ingestion（人数/项目数真数）。

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
   * 文档自述的负责人。**空串 = 文档里没读到是谁**（同本文件 `LitePerson.read` 的既有约定）。
   * 🔴 这里曾经是 `card.ownerName ?? 'Unassigned'`——一个英文词，而且是一句文档从没说过的
   * 管理判断（「这个项目没人负责」）。v01 的派生层是 locale-free 的（`liteTeamFromPayload`
   * 不收 locale），所以兜底文案归渲染层：屏与浮层各自 `|| t.lite.projectsUnknownValue`。
   */
  ownerName: string
  /**
   * 文档自述的状态。**空串 = 文档里没读到状态**（同 `ownerName` 的既有约定）。
   * 🔴 这里曾经是 `card.status ?? 'on-track'`——后端在 status 缺失时**根本不发这个键**
   * （"缺就不发"，与 ownerName 同一条口径），而这行替客户的文档补了一句它从没说过的
   * 结论（「按计划推进」），不是补了一个名字。实测约四分之一的项目命中：一份周报里
   * 7 个项目只有 3 个写了进展，另外 4 个在屏幕上被画成绿点、正常态，经理扫一眼就放心，
   * 而这 4 个其实是「不知道」。v01 的派生层是 locale-free 的（同 `ownerName`），兜底文案
   * 归渲染层：屏与浮层各自 `projectStatusText(project.status, …)`，空串会被它译成
   * 「状态未提及」——绝不是「按计划推进」。
   */
  status: string
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

// 「值得多看一眼」这个计数的形状（后端 registry.py::briefing 的 look_kind）。中文壳靠它决定
// 敢不敢说「N 个项目」——这个数里可以混着挂不到任何项目上的信号，说明见 src/shared/briefing.ts。
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

function liveHandoffs(payload: LiveTeamPayload): LiteHandoff[] {
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
export function liteTeamFromPayload(payload: LiveTeamPayload): LiteTeam {
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

  const projects: LiteProject[] = payload.projects.map((card: LiveProjectCard) => ({
    id: card.id,
    title: card.title,
    // 空串 = 没读到（空白/纯空格的 ownerName 同样不算一个人名）。绝不兜一个英文词。
    ownerName:
      card.ownerName?.trim() ||
      cleanPeople.find((p) => p.id === card.ownerId)?.name?.trim() ||
      '',
    // 空串 = 没读到（空白/纯空格同样不算一个状态词）。绝不兜一个「一切正常」的假结论。
    status: card.status?.trim() || '',
    progress: card.progress,
    dueDate: card.dueDate,
    summary: card.summary,
    blockers: card.blockers,
  }))

  const b = payload.briefing
  return {
    contextId: payload.context_id,
    sourceFiles: payload.source_files ?? [],
    people,
    projects,
    handoffs: liveHandoffs(payload),
    briefing: {
      tone: b.tone === 'alert' ? 'alert' : 'calm',
      headline: b.headline,
      subhead: b.subhead,
      metrics: b.metrics ?? [],
      lookKind: readLookKind(b),
    },
  }
}

// look_kind 是 fixA 之后才有的键，`LiveBriefingPayload`（src/lite/transport.ts）还没声明它，
// 所以在这里就地窄化读一次。认不出来的值一律当 undefined——消费方对 undefined 的兜底是**不点名**
// 那一侧（说「N 处」永远为真，说「N 个项目」可能凭空点名）。与 src/lite2/teamData.ts 同形。
function readLookKind(briefing: unknown): LiteLookKind | undefined {
  const raw = (briefing as { look_kind?: unknown } | null)?.look_kind
  return raw === 'projects' || raw === 'items' || raw === 'none' ? raw : undefined
}
