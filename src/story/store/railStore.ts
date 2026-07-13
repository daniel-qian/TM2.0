import { create } from 'zustand'
import {
  BILL_ACME_CASE,
  BILL_ACME_CASE_ID,
  EMAIL_CASE,
  EMAIL_CASE_ID,
  WEB_SEARCH_CASE,
} from '../data/cases'
import { HERO_QUESTION } from '../data/fixtures'
import { focusEntity } from '../lib/focus'
import { useCanvas } from './canvasStore'
import { useHome } from './homeStore'

type RailStep = {
  beat: string
  label: string
  // P6-07 (ADR-0013 决策 9)：title card 浮层文案 = rail chrome。只是 step 元数据——
  // 渲染住在 DemoControls 层、不进 canvasStore；toggleHidden / 删 rail 即无 title card
  //（ADR-0003 litmus：core 行为零损失）。文案单源引用 case.title（⚠ 标记在 cases.ts）。
  titleCard?: string
  run: () => void
}

const INITIAL = useCanvas.getState()

// ── feat-034 polish：A1/A2 的"钉状态"点位（全部从 case 数据派生，不写魔法数）。──
// bill/acme 有效编排表 = 主段 6 步 + alternatives 段 1 步 + Ask 段 2 步；
// A1 钉在 'quick-ask'（已分享/等待回执），A2 钉在 'quick-ask-reply'（已答）。
const BILL_ASK_SEGMENT_COUNT = 2 // jason-alternatives + fred-quick-ask 两段都在表内
const BILL_STEPS_BEFORE_ASK =
  BILL_ACME_CASE.orchestration.length + BILL_ACME_CASE.followUps[0].steps.length
const BILL_STEPS_THROUGH_QUICK_ASK =
  BILL_STEPS_BEFORE_ASK + BILL_ACME_CASE.followUps[1].steps.indexOf('quick-ask') + 1
const BILL_STEPS_THROUGH_QUICK_ASK_REPLY =
  BILL_STEPS_BEFORE_ASK + BILL_ACME_CASE.followUps[1].steps.indexOf('quick-ask-reply') + 1

// P6-07 (ADR-0013 决策 8)：三幕 SCRIPT。Act 1 = bill/acme hero（原样 + 开头 title card +
// B9 后 follow-up 拍）；Act 2 = "daily driver"（两个 errand case 全程 Nexus 内，
// title card 间隔 + 收束拍 closeThread/openThread 把 hero report 放回屏幕）；
// Act 3 = B11 Capabilities 收尾不动（ADR-0007 营收收束）。
// 每步守 ADR-0006：幂等 / append 序确定——seek 任意 index 从 pristine 重放自洽。
// Send（sendEmail）与 dispatchTask 同口径：不进 SCRIPT，Danny 现场亲手点（ADR-0006 决策 5）。
export const SCRIPT: RailStep[] = [
  {
    beat: 'B0',
    label: 'Onboarding prologue',
    run: () => useCanvas.getState().goScene('onboarding'),
  },
  {
    // feat-014（ADR-0017 决策 4）：B1 落卡片式今日主页——checklist 逐张发牌就是新的
    // calm 开场；Team map 只在 B2 作为高光拍出现。
    beat: 'B1',
    label: 'The morning desk', // （caption）
    run: () => useCanvas.getState().goScene('home'),
  },
  {
    // ── Act 1 · bill/acme hero ──。开头 title card（ADR-0013 决策 9：从第一个 case 就
    // 建立间隔语法）。run 只重申既有场景——状态零变化，浮层全在 rail chrome 层。
    beat: 'T1',
    label: 'Use case — Lin Qing & the Shopping Guide demo', // （caption）
    titleCard: BILL_ACME_CASE.title,
    run: () => useCanvas.getState().goScene('home'),
  },
  {
    // 地图高光拍（ADR-0017 决策 4）：从主页风险卡"在全景上看"的同款动作序——
    // 推进 Team map + 点亮关联簇（一步一个 state 落点，重放幂等）。
    beat: 'B2',
    label: 'See it on the map — the risk cluster', // （caption）
    run: () => {
      const canvas = useCanvas.getState()
      canvas.goScene('dashboard')
      canvas.setFocus(focusEntity('project', 'p_acme'))
    },
  },
  // P5-04 Act1（ADR-0009）：Nexus 前 drill「看现状」。thread.steps 空 → 详情页派生 believed 态（零剧透）。
  // 顺序参 demo-brief：focus → drill demo → drill Lin Qing → ask；不用 back()，下一步 askQuestion 自带 goScene('nexus') 飞进 Nexus。
  // 两条 drill 的 caption label。
  {
    beat: 'B2',
    label: 'Drill the demo — current state',
    run: () => useCanvas.getState().openDetail('project', 'p_acme'),
  },
  {
    beat: 'B2',
    label: 'Drill Lin Qing — current state',
    run: () => useCanvas.getState().openDetail('employee', 'u_bill'),
  },
  {
    beat: 'B3',
    label: 'Ask about the team',
    run: () => useCanvas.getState().askQuestion(HERO_QUESTION),
  },
  {
    beat: 'B4',
    label: 'PM agent checks evidence',
    run: () => useCanvas.getState().runAgent(),
  },
  {
    beat: 'B5',
    label: 'Reality gap cross-check',
    run: () => useCanvas.getState().runAgent(),
  },
  {
    // P5-04 (ADR-0007)：思考流 B4–B9 零整页 drill-in。B6 塌成单步；Lin Qing 的 drill 已搬到 Act1（B2 前戏段）。
    beat: 'B6',
    label: 'HR root-cause check',
    run: () => useCanvas.getState().runAgent(),
  },
  {
    beat: 'B7',
    label: 'Human loop',
    run: () => useCanvas.getState().runAgent(),
  },
  {
    beat: 'B8',
    label: 'Timeline tool output',
    run: () => useCanvas.getState().runAgent(),
  },
  {
    beat: 'B9',
    label: 'Structured output',
    run: () => useCanvas.getState().runAgent(),
  },
  {
    // P6-07：B9 后的 follow-up 拍（issue P6-07 / P6-03 机器）——askFollowUp → runAgent
    // 两步连发，与 free-click 的 handleFollowUp 同序同构（chip 可见性是组件本地态，
    // rail 直接调 action，不依赖 chip）。重放幂等：段耗尽 askFollowUp no-op、
    // 编排表走完 runAgent 只置 complete。
    beat: 'B9f',
    label: 'Follow-up — alternatives for Jason', // （caption）
    run: () => {
      const canvas = useCanvas.getState()
      canvas.askFollowUp(BILL_ACME_CASE.followUps[0].suggestedQuestion)
      canvas.runAgent()
    },
  },
  {
    beat: 'B9b',
    label: 'Drill the demo — scope frozen',
    run: () => useCanvas.getState().openDetail('project', 'p_acme'),
  },
  {
    beat: 'B9b',
    label: 'Drill Lin Qing — scope protected',
    run: () => useCanvas.getState().openDetail('employee', 'u_bill'),
  },
  {
    beat: 'B10',
    label: 'Briefing regenerated',
    run: () => {
      const canvas = useCanvas.getState()
      canvas.regenBriefing()
      canvas.goScene('home') // feat-014：主页开场行 + checklist 切到 grown 版
    },
  },
  {
    // ── Act 2 · daily driver（ADR-0013 决策 8）：errand cases 全程 Nexus 内、不碰
    // Dashboard briefing。title card 间隔 → 开 thread + 短链推进 → follow-up，×2。──
    beat: 'T2',
    label: 'Use case — Apple review policy', // （caption）
    titleCard: WEB_SEARCH_CASE.title,
    run: () => useCanvas.getState().goScene('home'),
  },
  {
    // askQuestion 是 case-aware（精确命中 case 默认问题）：开 web-search thread +
    // goScene('nexus') 一步到位；重复重放 = 同样的 pristine thread（确定性）。
    beat: 'W1',
    label: 'Ask — Apple review policy', // （caption）
    run: () => useCanvas.getState().askQuestion(WEB_SEARCH_CASE.question),
  },
  {
    beat: 'W2',
    label: 'Agent searches Apple developer docs', // （caption）
    run: () => useCanvas.getState().runAgent(),
  },
  {
    beat: 'W3',
    label: 'Policy gist — sources cited', // （caption）
    run: () => useCanvas.getState().runAgent(),
  },
  {
    beat: 'W4',
    label: 'Follow-up — does the companion-app build comply?', // （caption）
    run: () => {
      const canvas = useCanvas.getState()
      canvas.askFollowUp(WEB_SEARCH_CASE.followUps[0].suggestedQuestion)
      canvas.runAgent()
    },
  },
  {
    // email errand 的 title card。run 重申 nexus 场景（web-search 末态仍在身后）。
    beat: 'T3',
    label: 'Use case — Memo → Eng email', // （caption）
    titleCard: EMAIL_CASE.title,
    run: () => useCanvas.getState().goScene('nexus'),
  },
  {
    beat: 'E1',
    label: 'Ask — turn the memo into an email', // （caption）
    run: () => useCanvas.getState().askQuestion(EMAIL_CASE.question),
  },
  {
    beat: 'E2',
    label: 'Agent reads the memo, drafts the email', // （caption）
    run: () => useCanvas.getState().runAgent(),
  },
  {
    // ★ Send 不进 SCRIPT（ADR-0006 决策 5 / ADR-0013 决策 4）：本拍把 email-tool 卡备好，
    // Danny 现场亲手点 Send——free-click 拍（与 B9 dispatch 同口径）。seek 回到待发态，接受。
    beat: 'E3',
    label: 'Email staged — Send is yours', // （caption）
    run: () => useCanvas.getState().runAgent(),
  },
  {
    beat: 'E4',
    label: 'Follow-up — short version to #team', // （caption）
    run: () => {
      const canvas = useCanvas.getState()
      canvas.askFollowUp(EMAIL_CASE.followUps[0].suggestedQuestion)
      canvas.runAgent()
    },
  },
  {
    // 收束拍（ADR-0013 决策 8）：关 email thread、从历史重开 bill/acme——hero report
    //（含 alternatives follow-up 卡）回屏，给 Act 3 递话。两个 action 都幂等；
    // history popover 是组件本地态，脚本不开它——重开走的就是 popover 同款 openThread。
    beat: 'CL',
    label: 'Close the errand — back to the hero thread', // （caption）
    run: () => {
      const canvas = useCanvas.getState()
      canvas.closeThread(EMAIL_CASE_ID)
      canvas.openThread(BILL_ACME_CASE_ID)
    },
  },
  {
    // ── feat-034 阶段 A（PRD Q13 加性解冻 / ADR-0023）：scripted Ask beat ×2 ──
    // 位置钉在 CL 之后、B11 之前：CL 及之前所有既有拍的 replay 前缀 byte 级不变
    //（加性验证锚点——插在 B9f 后会改变 B9b..CL 的重放状态，否决）。叙事顺位也对：
    // hero thread 刚回屏（alternatives 卡在镜头里），Ask 作为收官 follow-up 递给 Act 3。
    //
    // feat-034 polish（Danny 试玩反馈）：A1/A2 从"增量 consume"（askFollowUp+runAgent，
    // 落点 = f(当前状态)，快按/乱序下会跳过等待态或变空拍）改为"钉状态"——
    // pinThreadProgress 幂等地把卡钉在确定点位（落点 = f(参数)）。free-click chip 路径
    // 不变，仍走 askFollowUp+runAgent，到达的 thread 状态与钉出来的逐字段相同（同构保持）。
    beat: 'A1',
    label: 'Quick ask — check with Fred himself', // （caption）
    run: () =>
      useCanvas
        .getState()
        .pinThreadProgress(BILL_ACME_CASE_ID, BILL_ASK_SEGMENT_COUNT, BILL_STEPS_THROUGH_QUICK_ASK),
  },
  {
    // 回执归来拍：同一张 Ask 卡状态推进（answered 翻转，镜头不动——lastCardStep 不变）。
    // 🔴 ADR-0023：回执 = Fred 自述 + 原话短评，数字只留在 Ask 卡（"本人自述"标注）。
    // polish：同样钉状态——无论此前处于草稿/等待/已答，落拍即"已答"，倒放回 A1 再来也恒定。
    beat: 'A2',
    label: "The reply — Fred, in his own words", // （caption）
    run: () =>
      useCanvas
        .getState()
        .pinThreadProgress(
          BILL_ACME_CASE_ID,
          BILL_ASK_SEGMENT_COUNT,
          BILL_STEPS_THROUGH_QUICK_ASK_REPLY,
        ),
  },
  {
    // ── Act 3 ──。P5-01 (ADR-0007)：Capabilities 收尾 beat 原样 = 护城河 + 营收收束。
    beat: 'B11',
    label: 'The playbooks behind the call',
    run: () => useCanvas.getState().goScene('capabilities'),
  },
]

export const LAST_RAIL_INDEX = SCRIPT.length - 1

interface RailState {
  index: number
  hidden: boolean
  // feat-006：clean capture mode（录屏就绪）。与 `hidden`（按 h 快速窥视、每次 seek 复位）不同，
  // `capture` 是「黏住」的——驱动 rail 不会把它关掉，否则一按方向键调试 chrome 又冒回来。
  // 纯呈现层开关：藏 DemoControls 调试栏 + 守红线（详情页人身上不显数字）。不动 rails 逻辑。
  capture: boolean
  seek: (target: number) => void
  next: () => void
  prev: () => void
  restart: () => void
  toggleHidden: () => void
  toggleCapture: () => void
}

function clampIndex(target: number) {
  return Math.max(0, Math.min(target, LAST_RAIL_INDEX))
}

// 录屏开关初值可从 URL 进入（?capture=1），方便 Danny 一开页就是干净帧、不靠记得按键。
function initialCapture(): boolean {
  if (typeof window === 'undefined') return false
  return new URLSearchParams(window.location.search).get('capture') === '1'
}

export const useRail = create<RailState>((set, get) => ({
  index: 0,
  hidden: false,
  capture: initialCapture(),

  seek: (target) => {
    const index = clampIndex(target)
    useCanvas.setState(INITIAL, true)
    for (let i = 0; i <= index; i += 1) {
      SCRIPT[i].run()
    }
    // 只复位 `hidden`（快速窥视语义）；`capture` 黏住，跨 seek 不变。
    set({ index, hidden: false })
  },

  next: () => get().seek(get().index + 1),
  prev: () => get().seek(get().index - 1),
  // feat-014：restart（r 键 = 回 pristine 开场）连带清掉主页 checklist 的勾选态；
  // 普通 seek 不清——Danny 现场勾掉的卡不该被一次方向键抹掉（homeStore 注释详述）。
  restart: () => {
    useHome.getState().reset()
    get().seek(0)
  },
  toggleHidden: () => set((state) => ({ hidden: !state.hidden })),
  toggleCapture: () => set((state) => ({ capture: !state.capture })),
}))
