/**
 * feat-014 — Card home "Your team"（Morning Desk A+）fixtures（GH issue #9 / ADR-0017）。
 *
 * 主页两区的真相源：今日 Handoff checklist（左脊柱）+ 人与项目双轨卡带（右证据层）。
 * - additive：只 import 共享 fixtures，绝不修改它。
 * - 人的读数一律定性人话，绝无数字（ADR-0015 红线：人不该有血条）。
 * - phase 语义与详情页同源：believed = 晨会初见 · grown = hero thread 跑完（B10 后）。
 */

import { HERO_QUESTION } from './fixtures'
import type { DetailPhase } from './fixtures.p3'

// ── 今日 Handoff（左脊柱）────────────────────────────────────────────────────
// tone = 语气温度（卡片左缘墨条），不是评级徽章：sage 安稳 · honey 值得一看 ·
// terracotta 今天需要你。文案文法钉死（claire 改进 2）：
// [人/项目] + [她在扛什么] + [今天该做的一个动作]；数字一律不上卡面。

export type HomeTone = 'sage' | 'honey' | 'terracotta'

export interface HomeHandoff {
  id: string
  tone: HomeTone
  toneLabel: string // 卡角落的小字语气标签（如 "Worth a closer look"）
  action: string // 卡标题：今天该做的那一件事
  evidence: string // 一行人话因果：她在扛什么
  personIds: string[] // 关联人（右栏联动点亮）
  projectIds: string[] // 关联项目（右栏联动点亮）
  evidenceTag: string // hover 时浮在关联卡上的依据签（短）
  mapFocus?: { kind: 'person' | 'project'; id: string } // "在全景上看" 入口
  flyToNexus?: string // 重条目：一键飞进 the room（askQuestion 文本）
}

const HOME_HANDOFFS_BELIEVED: HomeHandoff[] = [
  {
    id: 'hh_linqing',
    tone: 'terracotta',
    toneLabel: 'Worth a closer look', // （surface label per ADR-0015）
    action: 'Check in with Lin Qing before reading the demo as slow',    evidence:
      'She has been absorbing a week of shifting client feedback on the Shopping Guide demo — the quiet kind of heavy.',    personIds: ['u_bill'],
    projectIds: ['p_acme', 'p_connector'],
    evidenceTag: 'A week of changing feedback landed here',    mapFocus: { kind: 'project', id: 'p_acme' },
    flyToNexus: HERO_QUESTION,
  },
  {
    id: 'hh_pitch',
    tone: 'honey',
    toneLabel: 'Before it goes out',    action: 'Give the Venus pitch one last read — it goes out today',    evidence: 'Wang has it steady; it just deserves your eyes before the room sees it.',    personIds: ['u_wang'],
    projectIds: ['p_pitch'],
    evidenceTag: 'Goes out today',  },
  {
    id: 'hh_kate',
    tone: 'honey',
    // dana 复核：与 "Worth a closer look" 同屏撞车（只差一个 closer 扛轻重差），换呼应 action 的说法。
    toneLabel: 'When you pass by',    action: 'Say hello to Kate when you pass her desk',    evidence: 'She is carrying the client onboarding load on her own this week.',    personIds: ['u_kate'],
    projectIds: ['p_csonboard'],
    evidenceTag: 'Solo on the client load this week',  },
  {
    id: 'hh_jason',
    tone: 'sage',
    toneLabel: 'An open door',    action: 'Ask Jason if he could lend the demo a hand',    evidence: 'He wrapped his sprint early — there is room on his plate this week.',    personIds: ['u_jason'],
    projectIds: ['p_acme'],
    evidenceTag: 'Finished early — has room',  },
]

// grown（B10 后）：hero 条目换成"风险已被接住"的安稳版（同 id，勾选态跨 phase 延续）；
// Jason 条目文案跟上 scope-split 的事实（他已经在搭手了）。
const HOME_HANDOFFS_GROWN: HomeHandoff[] = [
  {
    ...HOME_HANDOFFS_BELIEVED[0],
    tone: 'sage',
    // dana 复核："owned" 在 HR 语境有"问责"联想，settled 更暖。
    toneLabel: 'Caught and settled',    action: 'A word of thanks to Lin Qing would land well this week',    evidence:
      'The demo has a plan — scope frozen, responsibilities split, and she owns a clear checklist for the core flow.',  },
  HOME_HANDOFFS_BELIEVED[1],
  HOME_HANDOFFS_BELIEVED[2],
  {
    ...HOME_HANDOFFS_BELIEVED[3],
    toneLabel: 'Already helping',    action: 'Jason is taking a piece of the demo — see it settled',    evidence: 'He picked up part of what was on Lin Qing’s plate; a quick nod keeps it warm.',  },
]

export function homeHandoffs(phase: DetailPhase): HomeHandoff[] {
  return phase === 'grown' ? HOME_HANDOFFS_GROWN : HOME_HANDOFFS_BELIEVED
}

// ── 计数与收尾（安静的完成感，无彩带；dana 守线：不替她判断"急不急"）──────────

const COUNT_WORDS = ['None', 'One', 'Two', 'Three', 'Four', 'Five'] as const

export function spineCountLine(remaining: number, total: number): string {
  if (remaining <= 0) return ''
  const word = COUNT_WORDS[Math.min(remaining, COUNT_WORDS.length - 1)]
  if (remaining === total) {
    return `${word} things worth your attention this morning.`  }
  return remaining === 1 ? 'One left this morning.' : `${word} left this morning.`}

// 收尾屏（claire 改进 3：这一屏决定"顾问 vs 工具"观感——不是 "0 tasks 🎉"）。
export const HOME_CLOSING: Record<DetailPhase, { title: string; line: string }> = {
  believed: {
    title: 'That’s the morning looked after.',    // dana 复核：别叫右栏 "board"（工具味）、别让它当主语（"后台自转"感）。
    line: 'Lin Qing is on your list, and Friday’s demo has your eyes on it. The rest keeps itself current.',  },
  grown: {
    title: 'That’s the morning looked after.',    line: 'Lin Qing is covered, and Friday’s demo has a clean path. See how the afternoon settles.',  },
}

// claire 2b：believed 收尾断言 "Lin Qing is on your list"——若她那张卡被搁置（Not today）
// 会自相矛盾。中性版不点名，按用户实际选择收口。
export const HOME_CLOSING_NEUTRAL: { title: string; line: string } = {
  title: 'That’s the morning looked after.',  line: 'Everything from this morning is settled the way you chose. The rest keeps itself current.',}

export const HANDLED_DRAWER_LABEL = 'Handled today'
export const SET_ASIDE_LABEL = 'set aside' // （搁置 ≠ 已处理，抽屉分开计数）

// ── 右栏双轨（证据层）────────────────────────────────────────────────────────
// 人卡读数：定性人话 + 语气；绝不渲染 capacityPct / moodPct / 任何 %。
// story 三人组 phase-aware（与详情页口径一致）；其余单读数两 phase 通用。

export interface HomePersonRead {
  read: string
  tone: HomeTone
}

const PERSON_READS_BELIEVED: Record<string, HomePersonRead> = {
  u_bill: { read: 'Chasing a moving brief', tone: 'terracotta' },  u_jason: { read: 'Some room to spare', tone: 'sage' },  u_vanessa: { read: 'Carrying the Friday demo', tone: 'honey' },}

const PERSON_READS_GROWN: Record<string, HomePersonRead> = {
  u_bill: { read: 'Core flow, scope frozen', tone: 'sage' },  u_jason: { read: 'Lending a hand this week', tone: 'sage' },  u_vanessa: { read: 'Friday scope protected', tone: 'sage' },}

const PERSON_READS_COMMON: Record<string, HomePersonRead> = {
  u_wang: { read: 'Steady hands on the pitch', tone: 'sage' },  u_kate: { read: 'Carrying the client load solo', tone: 'honey' },  u_kristen: { read: 'Deep in the data fields', tone: 'sage' },  u_andy: { read: 'A quiet, steady week', tone: 'sage' },  u_nasim: { read: 'In a good rhythm', tone: 'sage' },}

export function homePersonRead(personId: string, phase: DetailPhase): HomePersonRead | null {
  const phased = phase === 'grown' ? PERSON_READS_GROWN : PERSON_READS_BELIEVED
  return phased[personId] ?? PERSON_READS_COMMON[personId] ?? null
}

// 双轨的出场名单与次序（story 相关者靠前；'u_you' 不上卡——不给自己发读数）。
export const HOME_PEOPLE_IDS = [
  'u_bill',
  'u_vanessa',
  'u_jason',
  'u_wang',
  'u_kate',
  'u_kristen',
  'u_andy',
  'u_nasim',
]

export const HOME_PROJECT_IDS = [
  'p_acme',
  'p_connector',
  'p_pitch',
  'p_csonboard',
  'p_designsys',
  'p_capabilities',
]

// ── 表面文案（section 标题等）────────────────────────────────────────────────

export const HOME_COPY = {
  greetingEyebrow: 'This morning',  spineTitle: 'Worth your attention today',  peopleLane: 'People this week',  projectLane: 'Projects in motion',  mapLink: 'See the whole picture', // （Team map 入口，克制常驻，不自荐）
  mapCardLink: 'See it on the map', // （风险卡上的次级入口，rail B2 同款动作）
  flyLabel: 'Work it through', // （ADR-0015 surface label）
  discardLabel: 'Not today',  undoLabel: 'Bring it back',}
