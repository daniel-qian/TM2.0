import { create } from 'zustand'
import type {
  AskDraft,
  AskQuestionKind,
  FormDraftResult,
  FormLinkRecipient,
  FormAutoFilled,
  FormLinksResult,
  FormTemplateInput,
  LiveAppendReceipt,
  LiveFileEntry,
  LiveAdviseRunEntry,
  LiveFormSubmission,
  LiveFormTemplate,
  LiveNoteEntry,
  LiveTeamPayload,
  LiveTransport,
  PersonAddInput,
  PersonPatchInput,
  ProjectAddInput,
  ProjectPatchInput,
} from './transport'
import { isStubTransportSelected, resolveTransport } from './stubTransport'
import { createHttpTransport, storedOwnerToken, TransportError } from './transport'
import {
  coerceAskDraft,
  createLiveAgentSource,
  emptyRunState,
  type LiveAgentSource,
  type LiveRunState,
} from './streamSource'
import type { AdviseReference, AdviseRequest } from './transport'
import { buildAdviseHistory } from './askHistory'
import { liteTeamFromPayload, type LiteTeam } from './teamData'
import {
  navigateCloseDetail,
  navigateToDetail,
  navigateToScreen,
  type LiteDetail,
  type LiteScreen,
} from './routes'

// feat-017 的 liveStore 血统，feat-035（lite-live-v02 kickoff §架构拍板 1）copy-then-wall
// 复制进 src/lite2/**，与 src/lite/store.ts 各自独立生长——lite ↔ lite2 零交叉 import。
//
// 为什么不进 canvasStore：canvasStore 的 action 契约已冻结（ADR-0013 contract pass），
// 且 rail 回放机器（pristine 快照 + replay-to-target）不能被 live 状态污染——story mode 必须
// 零回归。本 store 是纯增量：删掉 src/lite2/** 即回到没有 v02 的今天，v01/story 一行没拆。
//
// 持有：可注入 transport（AFK 门打桩）、上传 → ingestion 的 Your team 数据、
// 一次 live /advise 运行的逐帧快照、lite2 壳自己的六屏导航 + 薄详情浮层状态。
// mode 本身升到 shared/modeStore（story/lite/lite2 三者共用的唯一地基）。

export type IngestStatus = 'idle' | 'ingesting' | 'ready' | 'error'

// lite2 壳的 scene（feat-035 · PRD 6-tab 顺序 + feat-047 第 7 tab）：Your team（含上传空态）·
// The room · Follow-ups（空态占位，feat-036 真派生）· notes（feat-047 移植自 src/lite，
// 放在 Follow-ups 之后——本棒的 tab 顺序决定，见 progress.md）· A closer look（空态占位，
// feat-037 真派生）· Playbooks（空态屏）· Vision/Where this goes（定位叙事 + 能力边界 mock）。
// 详情是浮层不是 scene。
// feat-051：屏的枚举与详情形状挪到 routes.ts（那里是导航的唯一真相源，屏 ↔ 路径成对定义）。
// 这里原样再导出一次——既有 import 点（notifyStore / LiteTopbar）不用改。
export type { LiteScreen, LiteDetail }

// ── feat-050 · 会话不丢（contextId 恢复）────────────────────────────────────────────────
// 病因：后端早已持久化（Supabase），owner_token 也早已存在 `lite2:ownerTokens:v1`——唯独
// context_id 只活在内存里，刷新一次这家公司的全部数据就"指针丢了"（数据还在，找不回来）。
// 这里存的就是那根指针：一个 id，不是数据本身。手写同步 load/save，与 flowStore/
// notifyStore/onboardStore 同族（`lite2:` 前缀、同样的无痕模式静默降级）。
//
// 🔴 只存 context_id，不存 owner_token（token 归 transport 的 `lite2:ownerTokens:v1` 管，
// 各存各的，避免两处写同一份凭据）。
const CONTEXT_STORE_KEY = 'lite2:contextId:v1'

export function loadStoredContextId(): string | null {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return null
    const raw = window.localStorage.getItem(CONTEXT_STORE_KEY)
    return raw && raw.trim() ? raw : null
  } catch {
    // 无痕模式/禁用存储——退回"没有上次会话"，不崩。
    return null
  }
}

// 传 null 即遗忘（context 已失效时清干净，别留死指针）。
export function rememberContextId(contextId: string | null): void {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return
    if (contextId) window.localStorage.setItem(CONTEXT_STORE_KEY, contextId)
    else window.localStorage.removeItem(CONTEXT_STORE_KEY)
  } catch {
    /* quota/无痕——本次会话内存里仍持有 contextId，只是下次打不开而已 */
  }
}

// ── fixD/B1 · 这台浏览器传过哪几份（"回得去"的名册）──────────────────────────────────────
//
// 病：上传完团队后 UI 继续摆着上传入口邀请"再加文件"，但 `POST /ingest` **每次都新建一个
// context**（后端确认：`ingest_paths(context_id=...)` 也不是追加——它拿新文档重建一个
// CompanyContext 再 `registry.put` 盖掉旧的，传旧 id 反而会把第一家公司的数据就地毁掉）。
// 于是第二次上传 → contextId 换成新的 → 第一份从界面上消失，**且没有任何回得去的入口**。
// 数据其实还在后端、token 还在 localStorage，但用户看不到、点不回去 —— 他以为自己弄丢了。
//
// 这里存的是"回得去"所缺的最后一块：**每次成功上传留一条名册**（id + 当时传了哪些文件 +
// 时间）。owner_token 归 transport 的 `lite2:ownerTokens:v1` 管，不在这儿复制一份
// （与 CONTEXT_STORE_KEY 同一条纪律：凭据只有一个家）。
//
// 🔴 为什么不去读 transport 那个 token map 的 key 来当名册：那是**凭据存储**，拿它当索引
// 会让"有没有这份"和"有没有这份的钥匙"两件事永远绑死——恰恰是必须分开的两件事（钥匙没了
// 但公司还在，UI 要能诚实说"这份回不去了"，而不是干脆当它不存在）。
//
// 🔴 `lite2:` 前缀不是装饰：换账号清场（AuthPanel.clearCompanyScope）按这个前缀整段清扫，
// 所以本名册天然跟着走 —— A 公司传过什么，B 公司的经理不会在下拉里看见。
const KNOWN_CONTEXTS_KEY = 'lite2:knownContexts:v1'
const MAX_KNOWN_CONTEXTS = 12

export interface KnownContext {
  id: string
  // 当时上传的文件名，原样保留 —— 用户自己的字。UI 负责排版成人话，store 不编标签，
  // 也不在这里塞中文/英文（本文件不该持有 copy）。
  files: string[]
  at: string // ISO
}

function isKnownContext(v: unknown): v is KnownContext {
  if (!v || typeof v !== 'object') return false
  const c = v as KnownContext
  return typeof c.id === 'string' && !!c.id && Array.isArray(c.files) && typeof c.at === 'string'
}

export function loadKnownContexts(): KnownContext[] {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return []
    const raw = window.localStorage.getItem(KNOWN_CONTEXTS_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as unknown
    return Array.isArray(parsed) ? parsed.filter(isKnownContext) : []
  } catch {
    return [] // 无痕/坏 JSON —— 名册为空，不崩（同 loadStoredContextId 的降级口径）
  }
}

function saveKnownContexts(list: KnownContext[]): void {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return
    window.localStorage.setItem(KNOWN_CONTEXTS_KEY, JSON.stringify(list))
  } catch {
    /* quota/无痕 —— 本次会话内存里仍有名册，只是下次打不开 */
  }
}

/** 记一条（新→旧；同 id 覆盖并提到最前，避免重复上传把名册刷屏）。 */
export function rememberKnownContext(entry: KnownContext): KnownContext[] {
  const next = [entry, ...loadKnownContexts().filter((c) => c.id !== entry.id)].slice(
    0,
    MAX_KNOWN_CONTEXTS,
  )
  saveKnownContexts(next)
  return next
}

/**
 * 删一条名册记录。
 *
 * 🔴 **只许由用户显式操作触发**（store 的 `forgetContext` action ← UI 的「从这个列表里移除」）。
 * 绝不许由一次失败的读触发 —— 见下面 ContextSwitchError 上那段。名册是某个 context_id 在这台
 * 浏览器上的**唯一第二处记录**（第一处是 `lite2:contextId:v1` 锚点，它每次上传都会被覆盖）：
 * `POST /ingest` 每次新建 context，id 只在返回的那一刻出现过一次，删掉名册就是**永久**失去入口。
 * 用一次可能误判的失败去换永久失去入口，代价完全不对等。
 */
export function forgetKnownContext(contextId: string): KnownContext[] {
  const next = loadKnownContexts().filter((c) => c.id !== contextId)
  saveKnownContexts(next)
  return next
}

// 切回上一份可能失败，而且必须**分得清是哪一种失败**——它们对用户的意思完全不同：
//   'missing-credential' = 这台浏览器根本没有那份的 owner_token（登出清过 / 换了浏览器）。
//                          本地就能判定，不用打网络。公司数据多半还在服务端。
//   'unreadable'         = 打过去了，服务端不给（HTTP 404）。
//   'failed'             = 没连上（后端没起 / 网断 / 5xx）。
//
// 🔴 为什么 404 只能叫 'unreadable'，不能叫 'gone'（fixD 复核 · 新 finding 2）：
// feat-038 的租户隔离**刻意**让「这份不存在」和「你证明不了这是你的」返回同一个 404 ——
// 那正是它拒绝提供的存在性 oracle。于是 404 至少有三种成因，前端一种都分不出来：
//   ① context 真的没了；
//   ② token 对不上（ingest_api.authorize_context 的 token 分支）；
//   ③ 持久化 registry 里 owner_token 为空的旧 context，对真正的主人也 fail-closed 成 404。
// 把 404 读成「这份没了」，等于**产品替客户断言了一个它无法知道的事实**——正是本轮红线
// 「我没读到 ≠ 客户说没有」在这里的形态。所以：文案落在「打不开」一侧，名册**不删**。
// 🔴 也绝不允许第四种"静默失败"：切不过去就必须说，不能停在原地让人以为点没生效。
export type ContextSwitchError = 'missing-credential' | 'unreadable' | 'failed'

// T3 · 铸链失败的三种，因为对经理的意思完全不同（同 ContextSwitchError 的取舍）：
//   'rejected' —— 422：人数越界（一次 1..30）或服务端结构/红线门拒了这次铸链。改了能成。
//   'retired'  —— 409/410：这张表已经撤下，不再发新链接。不是"出错了"，是"这条路关了"。
//   'failed'   —— 其余一切（网断、404 凭据过期、5xx）。
//
// 🔴 为什么不能直接把 TransportError.message 上屏：httpErrorMessage 把 **422 映射成
// `transport.unsupportedType`**（"那个文件类型不接受"，与 415 共用一句，见 transport.ts 里
// 那行 `if (status === 415 || status === 422)`）。一次人数越界会给经理看一句讲文件格式的话。
// 状态码走 TransportError.status 这条结构化通道，文案这一族自己写（同 isNotFound 的教训）。
export type FormsMintError = 'rejected' | 'retired' | 'failed'

// gap2 T11 · 拼装器写侧失败的四种。理由与上面那三种同源（同一个 422 在不同动作上意思完全不同），
// 但取值刻意分开——一句「一次发给 1 到 30 个人」放在保存模板失败之后就是对经理撒谎。
//   'rejected'    —— 422：服务端的三道门之一拒了（结构 / 红线 / 已被引用的 field.id）。
//                    这一种**带 detail**：那句英文 reason 是唯一能定位到哪一格的线索。
//   'unavailable' —— 这条通道没有这个方法（stub / 老后端）。不是"出错了"，是"这里做不了这件事"。
//   'unreadable'  —— 起草专用，409/422：那份文件读不出来（没有字节 / 解析不了）。
//   'failed'      —— 其余一切（网断、404 凭据过期、5xx）。
export type FormBuilderError = 'rejected' | 'unavailable' | 'unreadable' | 'failed'

// 首帧同步取回（不等 effect）：store 建好时 contextId 就位，`restoreSession()` 才有的可拉。
// feat-068 补漏：feat-050 用 isStubTransportSelected() 判断「这是 stub 的假 context，别持久化」，
// 但那个函数直接读 URL 的 ?transport=stub，**不受 DEV 闸约束**——而 :181 的 defaultTransport 受。
// 于是生产环境里带着 ?transport=stub 打开会进入一个自相矛盾的状态：拿的是真 HTTP 数据（闸生效），
// 却被当成 stub 而拒绝恢复/保存 contextId（三处判断生效）——真数据刷新即丢，且无任何提示。
// 把 DEV 闸并进来，两侧口径就一致了：生产恒为 false（静态假值，rollup 直接 DCE 掉这条分支），
// dev 行为一字不变、AFK 门照旧。
const stubSelected = import.meta.env.DEV && isStubTransportSelected()

const restoredContextId = stubSelected ? null : loadStoredContextId()

// 恢复的重入闸（模块级，同 notifyStore 的 `wired` 先例）。**不能拿 state.restoring 当闸**——
// 它首帧就是 true（为了不闪空态），拿它当闸会让挂载时的第一次调用直接被自己挡掉、永远不拉。
// 重试路径不受影响：那时这个标志早已落回 false。
//
// 🔴 存的是"正在恢复**哪一个** contextId"，不是一个裸 boolean（fixD 复核 · 新 finding 1）。
// 裸 boolean 挡的是"同一次恢复被跑两遍"（StrictMode 双跑 effect），但它同时会把**换了目标**
// 的第二次调用也一起挡掉——那次调用不是重复，是取代。按 id 记则两件事各归各位：
// 同 id 再来 = 重复，挡掉；不同 id 来 = 新目标，放行并由 fetchGuard 让旧的那次作废。
let restoreInFlightFor: string | null = null

// 切换的世代号（fixD 复核 · 新 finding 1）。每次 switchContext 进门 +1 并把号码捞在手里；
// await 回来发现号码变了 = 用户已经点了别的一份，**这次结果连同它的错误一起作废**。
// 没有它的话，先发的那次（可能是慢的那次）会在后面覆盖用户真正想要的那一份。
let switchSeq = 0

// 🔴 "别把为 A 取回来的数据写进已经切到 B 的 state"（fixD 复核 · 新 finding 1 的正主）。
//
// 本文件里每一个 `await transport.fetchX(contextId)` 都持有一个**闭包里捕获的旧 contextId**。
// await 期间 contextId 完全可能被改掉（switchContext / adoptContext / clearCompanyScope /
// AuthPanel 的登录恢复），而 await 之后那句 `set({ team, ownerToken })` 原来一次都不回头核对。
// 后果不是"渲染慢一拍"，是**跨公司串数据**：屏幕上挂着 B 公司的 contextId 和锚点，人却是 A
// 公司的人，ownerToken 还是 A 的钥匙 —— B 公司的经理看到的整份花名册来自 A 公司的文件。
// 这正是本轮红线最硬的一种形态。
//
// 用法：await 之前先把目标 id 捞在手里，await 之后 `if (!stillOn(get, cid)) return`。
// 返回 false = 这次结果已过期，**一个字段都别写**（取代它的那次调用会自己落地结果与错误）。
function stillOn(get: () => LiteState, contextId: string | null): boolean {
  return get().contextId === contextId
}

// 404 = context 真没了/token 对不上（feat-038 租户隔离：绝不给 403 这种可枚举的 oracle），
// 其余（500/网络断）都是"这次没连上"。
//
// 🔴 判据从"抠 message"改成"读 status"，因为前者已经被 ZH-03 拆掉了（0719 收尾复验逮到）：
//   原注释说"后端/stub 都把 404 编码进 Error.message（`team HTTP 404`）"——那句话在 ZH-03
//   之后不再成立。httpErrorMessage() 现在把 404 翻成给客户看的中文句子
//   （transport.ts:399 `if (status === 404) return t.staleToken`），里面一个数字都没有。
//   于是 /HTTP 404/ 对**真 HTTP 传输的每一次 404** 都返 false，只有 DEV 的 stub
//   （仍抛 `team HTTP 404 (stub)`）还匹配得上——门跑 stub 全绿，生产两条路径全错：
//     · 恢复路径：不再松开锚点，改走 else 把中文错误挂在屏幕上。localStorage 里那个死锚点
//       原地不动，于是**每次刷新都再错一遍**，永远回不到干净的上传态。
//     · switchContext：真 404 被判成 'failed'，文案说「刚才没连上服务器…再试一次」——
//       服务器好得很，是凭据对不上，重试一万次也不会成。诚实的 'unreadable' 反倒成了死代码。
//   状态码走 TransportError.status 这条结构化通道（transport.ts:421），message 只作为
//   stub 的兜底——下一个人再改文案时，这里不会跟着塌。
function isNotFound(err: unknown, message: string): boolean {
  if (err instanceof TransportError && typeof err.status === 'number') return err.status === 404
  return /HTTP 404/.test(message)
}

// ── #71 · 会话流的一轮 ────────────────────────────────────────────────────────────────
// 「一次提问 + 它自己的那条流 + 它自己的终局产物」。此前 store 里只有一个 `run` 单槽，
// 第二问整体覆盖第一问（store 那一句 `run: {...emptyRunState()}` 就是覆盖本身）——问题
// 文本前端更是从没存过（LiveRunState 没有这个字段，后端 started.prompt 被 streamSource
// 显式丢弃）。所以「回显提问」不是加个 DOM 节点的事，得先有地方装它。
export interface LiveTurn {
  /** 本轮稳定 id：流回调按它认领自己那一轮，跨轮不串写（旧单槽下这是靠"覆盖"实现的）。 */
  id: string
  /** manager 自己打的那句原话——**不含**提交层织进 situation 的「涉及：」后缀。 */
  question: string
  /** 本轮带的 @ 引用（wire 形状，与请求体里那份同一个对象）。没带就是 null。 */
  refs: AdviseReference[] | null
  /** 本轮的流式状态 + 终局产物（advice / answer / 引用 / 相位）。 */
  run: LiveRunState
}

let turnSeq = 0
function nextTurnId(): string {
  turnSeq += 1
  return `turn-${turnSeq}`
}

interface LiteState {
  transport: LiveTransport

  // ── lite 导航 ──
  // feat-051：`screen` / `detail` 不再是 store 状态——当前屏与当前详情由 URL 派生
  //（routes.ts 的 useCurrentScreen / useRouteDetail）。留在 store 里会变成第二份真相，
  // 和后退键、刷新、深链三样各自打架。下面的 action 名字与签名保持不变，只是改成推路由。

  // ── Your team（feat-016 ingestion 产出）──
  ingestStatus: IngestStatus
  ingestError: string | null
  // T10 · 补资料这条路自己的状态机（理由见 appendFiles 上方那段 🔴：借 ingestStatus 会发假通知）。
  // `appendReceipt` 只留最近一次的，换公司时清掉。
  appendStatus: IngestStatus
  appendError: string | null
  appendReceipt: LiveAppendReceipt | null
  team: LiteTeam | null
  contextId: string | null
  // feat-047 移植（持久化链 feat-038 租户隔离）：本公司 owner_token（经理凭据）。transport 已
  // 按 context_id 存下并在读端点以 header 带上；store 也挂一份供 UI/调试可见。🔴 只读展示不入 URL。
  ownerToken: string | null
  // 原始 payload 留一份（详情浮层显 source_files；AFK 门可断言契约形状）
  rawTeam: LiveTeamPayload | null
  // feat-047 移植（feat-032）「你的文件」清单：持久留存的源文档元数据（重启后仍在）。
  files: LiveFileEntry[]
  // feat-047 移植（feat-033）「Avery's notes」：写侧、跨会话累积的 agent 自写观察（只读，
  // 新→旧，重启后仍在）。
  notes: LiveNoteEntry[]
  // advise 完成且后端确认新笔记落库 → Room 内出一次 nudge（丢弃则不出）。切屏即消。
  noteJustAdded: boolean
  // issue #49 · 议事室历史（只读、新→旧、重启后仍在）。null=尚未拉取/通道不可用（stub），
  // []=拉过确实为空——UI 据此区分「不渲染」与「诚实空态」。
  adviseRuns: LiveAdviseRunEntry[] | null

  // feat-050：正在按存下的 contextId 取回上次会话（首帧即 true，避免"空态闪一下再冒出团队"
  // 让人以为数据丢了）。取回结束（成功或降级）必须落回 false——绝不留无限 loading。
  restoring: boolean
  // 取不回来且**不是** 404 时的原因（后端没起/网断）。404 不进这里：那是"context 真没了"，
  // 直接干净回上传态，不该冲用户报错。
  restoreError: string | null

  // input-side-0721 · 3A：一键示例团队的领取态。claiming = 门上按钮要置灰（双击 = 两份克隆，
  // 后端不介意但用户会拿到两个工作区糊一脸）；error = 领取失败的人话（诚实报错，不伪装成功）。
  demoClaiming: boolean
  demoClaimError: string | null

  // fixD/B1：这台浏览器传过的每一份（新→旧，含当前这份）。上传入口据此告诉用户
  // "再传一次会新建一份，当前这份不会合并进去"，并列出回得去的入口。
  knownContexts: KnownContext[]
  // 切回上一份失败的原因（成功即 null）。🔴 只用于诚实报错，绝不用来伪装成功。
  switchError: ContextSwitchError | null
  // 正在切往哪一份（没在切 = null）。存在的理由不是"转个圈好看"：UI 必须据此把名册里的
  // 按钮**置灰**。裸 <button onClick={switchContext}> 无 pending 态 = 双击就是一次并发切换，
  // 而并发切换正是新 finding 1 那条跨公司串数据的触发方式。store 挡住了竞态，UI 还得挡住误触。
  switchPending: string | null

  // ── The room 的会话流（#71）──────────────────────────────────────────────────────────
  // 一场对话的全部轮次，**按提问顺序**，尾部是当前（可能还在流的）那一轮。
  // 🔴 刻意不持久化：不落 localStorage、不落库。离开议事室（RoomScreen 卸载）或刷新即清空
  //    ——票面拍板「离开/刷新即这场对话结束」。持久线程是 carry-over，不在本票。
  turns: LiveTurn[]
  // ── The room 一次 live 运行（feat-015 /advise）──
  // 🔴 #71 起这是**尾轮 run 的镜像**，不是独立槽位：`turns` 是唯一真相，写 run 的地方
  //    只有「同步尾轮」这一处。保留它是因为十来个既有消费者（notifyStore 的完成通知 +
  //    十道门的 `__lite2Store.getState().run.status`）都读它，改签名等于顺手改十几处判据。
  //    turns 为空时它是 emptyRunState()（＝空态，与 #71 之前的语义一致）。
  run: LiveRunState
  agentSource: LiveAgentSource
  _abort: (() => void) | null

  // ── 项目手编 CRUD（rich-align-0722 · issue 05a）──────────────────────────────────────
  // 🔴 单个 CRUD 写在飞（add/patch/archive/restore 互斥，UI 同时只开一处）——共用一对忙/错态。
  // busy 用于把提交/保存/归档键置灰（防双击=两次写）；error 是**诚实报错**（写失败必说，不伪装成功）。
  projectWriteBusy: boolean
  projectWriteError: string | null

  // ── Ask / Quick ask（feat-034 阶段 B）——当前 Thread 的一张活体 Quick ask。
  // 🔴 回执数据只活在这里（AskDraft.recipients[].receipt）——LitePerson / 人卡零新增字段。
  ask: AskDraft | null
  askBusy: 'idle' | 'saving' | 'refreshing'
  askError: string | null

  // ── 常驻表单（gap-design-0805 T3 · 资料库第④段）─────────────────────────────────────
  // 🔴 三态，不是两态（同 adviseRuns 的取舍，不是 files 的 `[]` 初值）：
  //   null —— 没拉过 / 通道没有这个方法（stub、门里注入的假 transport、老后端）/ 拉失败。
  //   []   —— 200 回来了，这家公司确实一张表都没有。
  // 两者在屏上都表现为"整段不渲染"，但把它们**在数据里**分开是有代价的选择：将来要给
  // 「拉失败」写一句诚实提示时，不必回头重造这个区分。
  // 🔴 绝不从 404 推出「没有表单」——那是后端对缺/错 owner_token 的无枚举答复。
  formTemplates: LiveFormTemplate[] | null
  formSubmissions: LiveFormSubmission[] | null
  // 刚铸出来的这一批链接（供逐条复制）。刻意**不复用** formSubmissions：那份是全部周期的
  // 全量，而这一批是经理此刻要粘出去的那几条——混在一起最容易粘错周。
  formsMinted: FormLinksResult | null
  // 铸链在飞。UI 据此置灰——但真正的临界区在 store 里（见 createFormLinks 的注释：
  // React 的 disabled 要等一次重渲染，同一拍的第二次点击挡不住，而这个端点不幂等）。
  formsBusy: 'idle' | 'minting'
  formsError: FormsMintError | null
  // T9（gap2 #58）· 最近一次拉取里，服务端**真的**按上期名单备好了什么。
  // 🔴 null = 这次读取一行都没铸（不是「本期没有行」）。界面那句「本期已按上期名单备好（N 人）」
  // 与铃铛那条 'form' 通知都吃它——判据必须是一次真实的状态迁移，不是每次刷新都为真的静态事实。
  formsAutoFilled: FormAutoFilled[] | null
  // 正在作废的那一条（按 submission id）。逐条置灰而不是整段——经理可能连着撤两个人，
  // 整段置灰会让第二次点击看起来像没反应。
  formsVoiding: string | null

  // ── gap2 T11 · 模板拼装器（建/改模板、让 Avery 读旧表格起草）───────────────────────────
  // 🔴 刻意**不复用** formsBusy / formsError：
  //   · formsBusy 只有 'idle'|'minting' 一个标志，借它表示「正在保存模板」会把铸链按钮一起
  //     锁死；而唯一能解锁它的 resetFormsWrite 只挂在「切换模板」上，那排按钮又只在有 2 张以上
  //     模板时才渲染——今天恒是内置周报一张，于是那条解锁路径在生产上从来不可达。
  //   · formsError 的三个取值各自对应一句铸链文案（'rejected' 说的是「一次发给 1 到 30 个人」），
  //     模板保存的 422 原因是「未知 kind / 字段 id 重复 / 题面撞红线」，套进那句话就是对经理撒谎。
  formBuilderBusy: 'idle' | 'saving' | 'drafting'
  // 一次写/起草失败。`code` 决定屏幕上那句话，`detail` 是服务端 422 body 里那句英文 reason
  // ——只在 code='rejected' 时有，附在句子后面当诊断（不是那句话本身）。
  formBuilderError: { code: FormBuilderError; detail?: string } | null

  // ── actions ──
  // feat-051：`params` 可给目标屏叠加 query——feat-057 的决策卡走
  // `goScreen('room', { q: '<问题>' })` 带着问题进议事室。省略即只切屏（既有 7 个调用点不变）。
  goScreen: (screen: LiteScreen, params?: Record<string, string | null>) => void
  openDetail: (kind: 'person' | 'project', id: string) => void
  closeDetail: () => void
  // nudge-clear-only-on-goscreen-path：Room 内一次性 nudge 的「路由变更即清」动作。不挂在
  // goScreen 里——由 RoomScreen.tsx 的 useEffect 订阅 location 调用（见 goScreen 上方注释）。
  clearNoteNudge: () => void
  setTransport: (transport: LiveTransport) => void // AFK 门注入确定性 stub
  uploadFiles: (files: File[]) => Promise<void>
  // T10 · 给**当前这家公司**补资料。与 uploadFiles 的分界只有一句：那个开新公司，这个补当前的。
  // 🔴 刻意**不复用** ingestStatus：`notifyStore` 只认 `ingesting → ready` 这一跳并据此弹
  //「你的团队已就绪」——补一份周报不是"团队就绪"，借它的状态机就是发一条假通知。
  appendFiles: (files: File[]) => Promise<void>
  // input-side-0721 · 3A：领一份示例团队（后端克隆预铸母本 → 本访客私有副本）。
  // 落地路径与 uploadFiles 完全同构（adoptContext 收口 → 团队入 state → 名册 → files/notes）。
  claimDemoTeam: () => Promise<void>
  // feat-050：按 localStorage 里的 contextId 把上次会话拉回来。挂载时调一次；失败可重试。
  // 🔴 不是"唯一入口"——feat-053（账号体系）落地后 contextId 由服务端按账号返回，那条线
  // 直接调 `adoptContext()` 覆盖即可，本条退化为无账号时的兜底（已有 team 时本函数自己让路）。
  restoreSession: () => Promise<void>
  // feat-050 的被覆盖口：谁拿到权威 contextId（现在是 localStorage，将来是 feat-053 的
  // 服务端按账号返回）就调它——落 state + 落锚点，一处收口。
  adoptContext: (contextId: string | null, ownerToken?: string | null) => void
  // fixD/B1：切回名册里的某一份（第二次上传之后"回得去"的那条路）。
  // 🔴 后端不支持追加（确认过 pipeline.ingest_docs：传旧 context_id 是**重建并覆盖**，
  // 会就地毁掉第一家公司的数据），所以这里做的是"切换"，不是"合并"——UI 必须照实说。
  switchContext: (contextId: string) => Promise<void>
  // fixD 复核 · 新 finding 2：把某一份从名册上拿掉。**只有用户显式点了才允许调**——
  // 一次读失败（404）绝不许触发它，见 forgetKnownContext 上那段。
  forgetContext: (contextId: string) => void
  // files-hub-0729/01 · 取回某一份原始文件的字节。**抛错不吞**——调用方（FileManifest 的
  // 每一行各自持一份 pending/error）负责把失败说给用户看。这里只做 contextId 收口：
  // 没有 contextId 就没有可下载的东西，压根不该有按钮（不建假按钮）。
  downloadFile: (idx: number) => Promise<Blob>
  refreshTeam: () => Promise<void>
  refreshFiles: () => Promise<void>
  refreshNotes: () => Promise<void>
  // issue #49 · 拉取议事室历史。transport.fetchAdviseRuns 可选（stub 无）——判空即无操作，
  // adviseRuns 停在 null，历史区整块不渲染（不出假空态）。
  refreshAdviseRuns: () => Promise<void>
  // ── 常驻表单（T3）。模板与提交状态一起拉；两个 transport 方法都可选（stub 无）——判空即
  // 无操作，状态停在 null，整段不渲染（不出假空态）。次要只读视图：失败静默。
  refreshForms: () => Promise<void>
  // 给选中的人铸这一期的链接。返回 boolean：true=成功（UI 展开链接列表），false=失败
  // （UI 留在原地读 formsError）。🔴 写失败诚实报错，绝不伪装成功。
  createFormLinks: (templateId: string, recipients: FormLinkRecipient[]) => Promise<boolean>
  // T9 · 作废一条还没交的链接（「沿用上期（N 人）· 去调整」的去处）。成功后回权威清单。
  voidFormLink: (submissionId: string) => Promise<boolean>
  // 清铸链态（换模板 / 重新选人时调，别把上一次的报错和上一批链接挂到下一次操作上）。
  resetFormsWrite: () => void
  // ── gap2 T11 · 拼装器。两个写 action 都返回「成功了没」，UI 据此决定关不关编辑器。
  // 🔴 写失败诚实报错，绝不伪装成功——保存本身的失败**绝不能**走 refreshForms 那条静默吞错的路，
  // 那会把一次真失败变成一次「什么都没发生」。
  saveFormTemplate: (input: FormTemplateInput) => Promise<boolean>
  // 让 Avery 读一份已传的旧表格起草。返回提案本身（**不落库**）或 null（失败/不可用）。
  draftFormFromFile: (fileIndex: number, title?: string) => Promise<FormDraftResult | null>
  resetFormBuilder: () => void
  // ── 项目手编 CRUD（rich-align-0722 · issue 05a）。写端点已就绪（f1ca46d）；action 写后
  // refreshTeam() 从权威 /team 重新派生网格（含 archived_projects + 逐字段 provenance），
  // 不做易漂移的乐观拼装（archive/restore 要跨 active↔archived 两个数组，单条回执拼不全）。
  // 🔴 transport.addProject 等为可选（stub 无）——判空即无操作（同 claimDemoTeam 判 demoClaim 先例）。
  // 返回 boolean：true=成功（UI 关表单/退编辑态），false=失败或不可用（UI 留在原地 + 读 projectWriteError）。
  addProject: (input: ProjectAddInput) => Promise<boolean>
  patchProject: (projectId: string, patch: ProjectPatchInput) => Promise<boolean>
  archiveProject: (projectId: string) => Promise<boolean>
  restoreProject: (projectId: string) => Promise<boolean>
  // rich-align-0722/06 · 人员手编 CRUD（复用同一 runProjectWrite 骨架 + projectWrite 忙/错态——
  // 团队屏与项目屏 CRUD 从不同时活，共用一对写态无碍）。🔴 写侧红线（人身数字→422）在后端；
  // 前端 addPerson 只发定性字段（PersonAddInput 无人身数字位），红线报错走 projectWriteError 诚实上屏。
  addPerson: (input: PersonAddInput) => Promise<boolean>
  patchPerson: (personId: string, patch: PersonPatchInput) => Promise<boolean>
  archivePerson: (personId: string) => Promise<boolean>
  restorePerson: (personId: string) => Promise<boolean>
  // 清写态（打开表单 / 进编辑态 / 关浮层时调，别把上一次的报错挂到下一次操作上）。
  resetProjectWrite: () => void
  // #71 · `question` = 回显用的原话（省略即退回 `req.situation`——空态建议 chips 那条路
  // 没有"织文前的原话"这回事，两者本来就相等）。history 由 store 自己从 turns 组装，
  // 调用方不传（少一个"新入口忘了带上下文"的位置，同 withLocale 的一处补全纪律）。
  askLive: (req: AdviseRequest, question?: string) => void
  resetRun: () => void
  /** #71 · 清空会话流（离开议事室 / 换公司）。顺手中止在飞的那条流。 */
  clearTurns: () => void

  // Ask 草稿态编辑（status==='draft' 才生效；manager 逐字改题、1~3 内增删、点选受访者）
  editAskQuestion: (questionId: string, text: string) => void
  addAskQuestion: (kind: AskQuestionKind) => void
  removeAskQuestion: (questionId: string) => void
  toggleAskRecipient: (personId: string, name: string) => void
  // 确认 = 保存（服务端红线门，阶段 C）+ 生成一人一链 → shared
  confirmAsk: () => Promise<void>
  // manager 拉取回收状态/回执（PRD Q7：拉取式，无推送）
  refreshAsk: () => Promise<void>
}

// `?transport=stub` → 确定性 stub（AFK 门/离线演示）；默认真 HTTP（行为零变化）。
// feat-068 — DEV-ONLY：stub 通道只在 dev 存在。stub 编的是一整套以假乱真的团队/建议数据，
// 而线上这个 URL 是要发给真公司的——任何人往地址后面挂个 ?transport=stub，看到的就是编造的
// 内容，且与真输出肉眼不可分（demo 诚实性事故）。`import.meta.env.DEV` 在生产构建里被静态
// 求值成 false，Vite 据此把整条 stub 分支连同 stubTransport 模块一起 DCE 掉——线上根本不存在
// 这个开关。dev 下行为一字不变（AFK/DOM 门就靠 ?v=2&mode=live&transport=stub 驱动）。
// 与 src/main.tsx 的 __AVERY_LITE__ 测试缝同一个写法。
const defaultTransport = import.meta.env.DEV ? resolveTransport() : createHttpTransport()

// rich-align-0722/05a：四个项目写 action 的共用骨架。判可用 → 判忙（防双击=两次写）→ 置忙 →
// 调 transport 写端点 → 成功后 refreshTeam() 从权威 /team 重派生（含 archived_projects + 逐字段
// provenance；archive/restore 跨 active↔archived 两数组，单条回执拼不全，故一律回权威）→ 落忙态。
// 🔴 写失败 = projectWriteError 诚实报错（不伪装成功）；transport 没实现该端点（run 返 undefined，
// stub/老后端）= 同样诚实置错，绝不静默。
async function runProjectWrite(
  get: () => LiteState,
  set: (partial: Partial<LiteState>) => void,
  run: (contextId: string, transport: LiveTransport) => Promise<unknown> | undefined,
): Promise<boolean> {
  const { contextId, transport } = get()
  if (!contextId) return false
  if (get().projectWriteBusy) return false
  set({ projectWriteBusy: true, projectWriteError: null })
  try {
    const pending = run(contextId, transport)
    if (pending === undefined) {
      set({
        projectWriteBusy: false,
        projectWriteError: 'project write is not available on this transport',
      })
      return false
    }
    await pending
    // 写成功 → 从权威 /team 重新派生（refreshTeam 自带 stillOn 闸：await 期间切了公司就不落旧结果）。
    await get().refreshTeam()
    set({ projectWriteBusy: false })
    return true
  } catch (err) {
    set({
      projectWriteBusy: false,
      projectWriteError: err instanceof Error ? err.message : String(err),
    })
    return false
  }
}

// gap2 T11 —— 一次拼装器写失败落成哪一种。状态码走 TransportError 这条结构化通道，
// 文案自己写：`httpErrorMessage` 把 422 映射成「那个文件类型不接受」（与 415 共用一句），
// 直接上屏会让一次「题面撞红线」变成一句讲文件格式的话（同 FormsMintError 那段的教训）。
function builderError(err: unknown): { code: FormBuilderError; detail?: string } {
  if (!(err instanceof TransportError)) return { code: 'failed' }
  if (err.status === 422) return { code: 'rejected', detail: err.serverReason }
  if (err.status === 409 || err.status === 410) return { code: 'unreadable' }
  return { code: 'failed' }
}

export const useLite = create<LiteState>((set, get) => ({
  transport: defaultTransport,

  ingestStatus: 'idle',
  ingestError: null,
  appendStatus: 'idle',
  appendError: null,
  appendReceipt: null,
  team: null,
  // feat-050：从 localStorage 同步取回（stub 传输下恒为 null，见 restoredContextId）。
  contextId: restoredContextId,
  // token 归 transport 存；这里挂同一份供 UI/门可见（feat-047 语义不变）。
  ownerToken: storedOwnerToken(restoredContextId),
  rawTeam: null,
  files: [],
  notes: [],
  noteJustAdded: false,
  adviseRuns: null,
  // 有锚点才算"正在恢复"——没有锚点是干净首访，直接进上传引导，不该转圈。
  restoring: restoredContextId !== null,
  restoreError: null,
  demoClaiming: false,
  demoClaimError: null,
  knownContexts: loadKnownContexts(),
  switchError: null,
  switchPending: null,

  turns: [],
  run: emptyRunState(),
  agentSource: createLiveAgentSource(defaultTransport),
  _abort: null,

  projectWriteBusy: false,
  projectWriteError: null,

  ask: null,
  askBusy: 'idle',
  askError: null,

  // T3 · 常驻表单。两份清单起手是 null 而不是 []——「没拉过」与「拉到了确实是空的」在
  // 数据里必须分得开（见 LiteState 里那段）。
  formTemplates: null,
  formSubmissions: null,
  formsMinted: null,
  formsBusy: 'idle',
  formsError: null,
  formsAutoFilled: null,
  formsVoiding: null,
  formBuilderBusy: 'idle',
  formBuilderError: null,

  // Room 内的一次性 nudge（用户已离开事发现场；nudge 是瞬态感知，不是持久红点）按「路由变更
  // 即清」的统一动作走，三条离开 Room 的路径都要清：① goScreen tab 切换；② Topbar 的 <Link>
  // （LiteTopbar.tsx:275/292，到「文件与表单」/「资料库」——不经 goScreen，goScreen 自己清不
  // 到它）；③ 浏览器前进后退。三条路径唯一的公共信号是「location 变了」，所以清点不挂在
  // goScreen 里，而是暴露成下面的 clearNoteNudge()，由 RoomScreen.tsx 的 useEffect 订阅
  // location.pathname + location.search 调用。
  // feat-051：切屏本身交给路由（导航自带「离开详情」的语义，不必再手动清 detail）。
  // 🔴 本文件另有三处 `noteJustAdded: false`（初始 state / `askLive` 新一轮起跑重置 /
  // `resetLiteCompanyData` 换账号重新开始）——那三处是 init-reset 点，不是导航清点，
  // 别把这条逻辑往那几处叠。（刻意不写行号：这条注释自己就会把下面的行号顶漂，
  // 上一版写的 434/822/976 在加完本段之后已经分别指向 rawTeam / 一句无关注释 / AuthPanel。）
  goScreen: (screen, params) => {
    navigateToScreen(screen, params)
  },
  openDetail: (kind, id) => navigateToDetail(kind, id),
  closeDetail: () => navigateCloseDetail(),
  clearNoteNudge: () => set({ noteJustAdded: false }),

  setTransport: (transport) =>
    set({ transport, agentSource: createLiveAgentSource(transport) }),

  uploadFiles: async (files) => {
    if (files.length === 0) return
    set({ ingestStatus: 'ingesting', ingestError: null })
    try {
      const payload = await get().transport.ingest(files)
      // 🔴 先过 adoptContext 这个收口，再写本次的数据（fixD 复核 · 新 finding 3）。
      //
      // 原来这里是裸 `set({ contextId: payload.context_id, team, rawTeam, ownerToken })`，
      // 绕开了同一个 commit 刚刚确立的收口。代价是**漏清 notes**：`refreshNotes` 不调、也不
      // 清空，于是第二次上传之后，A 公司的「Avery's notes」原文原封不动挂在 B 公司的
      // contextId 底下，NotesScreen 直接渲染给 B 公司的经理看。而 switchContext 走 adoptContext
      // 那条路清得干干净净 —— **同一件事，两条路给出相反答案**，这正是 M3 修的那个坑
      //（"绕开收口就会出方向反了的 bug"）在 uploadFiles 上剩下的另一半。
      //
      // adoptContext 在 id 变了时清 team/rawTeam/files/notes/ingestStatus，所以顺序必须是
      // 先 adopt 后 set —— 反过来会被它当场清掉本次刚拿到的团队。
      get().adoptContext(payload.context_id, payload.owner_token ?? null)
      set({
        ingestStatus: 'ready',
        team: liteTeamFromPayload(payload),
        rawTeam: payload,
        // 上传成功即"有会话了"——把上一轮失败的恢复提示清掉。
        restoring: false,
        restoreError: null,
        // 换了公司，上一份切换失败的提示别继续挂着。
        switchError: null,
      })
      // feat-050 的落锚点动作已由 adoptContext 承担（含 stubSelected 判断），这里只补名册。
      // stub 传输不记（它的 context 是进程内造的，记了下次真启动会拿去打真后端）。
      if (!stubSelected) {
        // fixD/B1：记进名册。**这一步是"回得去"的全部前提**——`POST /ingest` 每次都
        // 新建 context，上一份的 id 在这一刻之后就再也没有第二个地方能问到了
        // （owner_token 还在，但 token map 的 key 是凭据存储，不该当索引使——见
        // KNOWN_CONTEXTS_KEY 上面那段）。漏了这行，第二次上传就还是"数据凭空消失"。
        set({
          knownContexts: rememberKnownContext({
            id: payload.context_id,
            files: files.map((f) => f.name),
            at: new Date().toISOString(),
          }),
        })
      }
      // feat-047（feat-032）：拉一次持久文件清单（含 n_chunks）。次要视图，失败不影响上传成功。
      // notes 同理——adoptContext 已经把上一份的清空了，这里把**这一份自己的**拉回来
      //（新 context 多半是空的；真为空时拉一次的结果也是空，不会凭空造出内容）。
      void get().refreshFiles()
      void get().refreshNotes()
    } catch (err) {
      set({
        ingestStatus: 'error',
        ingestError: err instanceof Error ? err.message : String(err),
      })
    }
  },

  // T10 · 补资料 —— 与 uploadFiles 是**两条路**，差别都在下面这几行里，不是文案差别：
  //   ① 不调 adoptContext。那个收口在 contextId 变了时会清掉 team/files/notes/forms——正是
  //      「每次上传=新开一家公司」那堵墙的前端半边。补资料的 context_id 没变，一个字都不该清。
  //   ② 不记名册（knownContexts）。没有新公司诞生，记一行只会让切换列表多一条指向同一份数据的行。
  //   ③ 不碰 ownerToken。服务端没有新铸，也没回传。
  //   ④ 走自己的状态机（见 LiteState 里那段 🔴：借 ingestStatus 会发一条假的「团队已就绪」通知）。
  appendFiles: async (files) => {
    if (files.length === 0) return
    const { transport, contextId } = get()
    const append = transport.appendFiles
    // 没有这个方法的通道（stub / 老后端）本就不该显示入口——这里再兜一层诚实报错，不做假按钮。
    if (!contextId || !append) {
      set({ appendStatus: 'error', appendError: 'append is not available on this transport' })
      return
    }
    set({ appendStatus: 'ingesting', appendError: null, appendReceipt: null })
    try {
      const payload = await append.call(transport, contextId, files)
      // 🔴 await 回来先核一次身份：这期间经理可能已经切到别家公司了，那这份结果就是"上一家的"，
      //    一个字段都不许写（同 restoreSession 的那条纪律）。
      if (!stillOn(get, contextId)) {
        set({ appendStatus: 'idle' })
        return
      }
      set({
        appendStatus: 'ready',
        appendError: null,
        appendReceipt: payload.appended ?? null,
        // 卡片当场是新读数——这正是本票「不许砍半」的那一半：资料库多一行的同时，卡也得动。
        team: liteTeamFromPayload(payload),
        rawTeam: payload,
      })
      // 资料库那份清单（含每文件块数）跟着刷新；次要视图，失败不影响补传已经成功这件事。
      void get().refreshFiles()
    } catch (err) {
      set({
        appendStatus: 'error',
        appendError: err instanceof Error ? err.message : String(err),
      })
    }
  },

  // input-side-0721 · 3A：领一份示例团队。与 uploadFiles 同构——同一个 adoptContext 收口、
  // 同一份 team/rawTeam 落法、同一条名册/files/notes 收尾；差别只有：① 数据来自
  // POST /demo/claim（后端克隆预铸母本，秒级）而非分钟级 ingest，所以走独立的 demoClaiming
  // 态、不碰 ingest 的秒表/通知链（notifyStore 只认 ingesting→ready 那一跳，这里 idle→ready
  // 不会触发"你的团队已就绪"假通知）；② transport 没实现 demoClaim（stub/老后端）时按钮
  // 本就不该显示（demoStore 探测），这里再兜一层诚实报错。
  claimDemoTeam: async () => {
    const { transport, demoClaiming } = get()
    if (demoClaiming) return
    const claim = transport.demoClaim
    if (!claim) {
      set({ demoClaimError: 'demo claim is not available on this transport' })
      return
    }
    set({ demoClaiming: true, demoClaimError: null })
    try {
      const payload = await claim.call(transport)
      get().adoptContext(payload.context_id, payload.owner_token ?? null)
      set({
        demoClaiming: false,
        ingestStatus: 'ready',
        team: liteTeamFromPayload(payload),
        rawTeam: payload,
        restoring: false,
        restoreError: null,
        switchError: null,
      })
      if (!stubSelected) {
        set({
          knownContexts: rememberKnownContext({
            id: payload.context_id,
            files: payload.source_files ?? [],
            at: new Date().toISOString(),
          }),
        })
      }
      void get().refreshFiles()
      void get().refreshNotes()
    } catch (err) {
      set({
        demoClaiming: false,
        demoClaimError: err instanceof Error ? err.message : String(err),
      })
    }
  },

  // feat-050 · 会话不丢：按存下的 contextId 把上次会话拉回来（数据一直在后端，这里只是
  // 拿着指针再要一次）。三条降级路径，一条都不许留白屏/无限 loading/一屏红字：
  //   ① 没锚点        → 干净首访，直接进上传引导。
  //   ② 404（context 没了 / token 失效）→ 忘掉锚点，干净回上传态，**不报错**。
  //   ③ 其它错（后端没起/网断）→ 保住锚点（context 多半还活着，别把用户的指针扔了），
  //      安静显示一行"没连上 + 重试"。
  restoreSession: async () => {
    const { contextId, transport, team } = get()
    // 已经有 team（刚上传完，或 feat-053 落地后由账号态先填好）→ 让路，不覆盖。
    if (!contextId || team) {
      set({ restoring: false, restoreError: null })
      return
    }
    // StrictMode 双跑 effect / 重复挂载 —— 但只挡**同一个目标**（见 restoreInFlightFor 上那段）。
    if (restoreInFlightFor === contextId) return
    restoreInFlightFor = contextId
    set({ restoring: true, restoreError: null })
    try {
      const payload = await transport.fetchTeam(contextId)
      // 🔴 await 回来先核一次身份：contextId 变了就说明这次结果是"上一家公司的"，
      // 一个字段都不许写（写了就是把 A 的人挂到 B 的 id 底下）。
      // 只有在没有更新的一次恢复在飞时才顺手关掉转圈——否则 spinner 归那次管。
      if (!stillOn(get, contextId)) {
        if (restoreInFlightFor === contextId) set({ restoring: false })
        return
      }
      set({
        team: liteTeamFromPayload(payload),
        rawTeam: payload,
        // idle → ready（不经 'ingesting'）：notifyStore 的 ingest 通知只认
        // `ingesting → ready` 这一跳，所以刷新页面不会假冒"你的团队已就绪"再通知一遍。
        ingestStatus: 'ready',
        ownerToken: storedOwnerToken(contextId),
        restoring: false,
        restoreError: null,
      })
      // 「你的文件」与「Avery's notes」同样按 contextId 持久在后端——一并取回，
      // 否则刷新后团队回来了、文件清单和笔记还是空的（那也是"会话丢了"）。
      // 两者都自带静默失败（次要视图），不会打断已就绪的主流程。
      void get().refreshFiles()
      void get().refreshNotes()
    } catch (err) {
      // 同上：结果过期就闭嘴（否则 A 的一次 404 会把 B 的会话就地清空）。
      if (!stillOn(get, contextId)) {
        if (restoreInFlightFor === contextId) set({ restoring: false })
        return
      }
      const message = err instanceof Error ? err.message : String(err)
      if (isNotFound(err, message)) {
        // 锚点指不动了 —— 松开它，干净回上传态（feat-050 口径不变）。
        //
        // 🔴 但**名册不动**（fixD 复核 · 新 finding 2）。原来这里顺手 forgetKnownContext()，
        // 理由写的是"服务端真没了"。可 404 根本不能证明这件事：feat-038 刻意让"不存在"和
        // "你证明不了这是你的"同样返 404（不给存在性 oracle），token 错配、以及 DB 里
        // owner_token 为空的旧 context，都会让**真正的主人**吃到 404。
        // 于是那行代码等于：一次我方无法解释的失败 → 永久删掉用户回得去的唯一入口。
        // 锚点是可再生的（切回去就有），名册不是（id 只在 ingest 返回那一刻出现过）。
        rememberContextId(null)
        set({
          contextId: null,
          ownerToken: null,
          team: null,
          rawTeam: null,
          files: [],
          notes: [],
          adviseRuns: null,
          // T3：这条 404 分支**绕开了 adoptContext**，所以公司域清单要在这里再列一遍——
          // 漏掉的话，死锚点恢复失败后上一家公司的表单链接会原地留在屏上。
          // 九件齐（同 adoptContext 那份的理由）。T9 加的两件同样是公司数据：
          // formsAutoFilled 是「A 公司这次备好了几条」，留给 B 就是替 B 宣布一件没发生的事；
          // formsVoiding 漏了则「作废途中切公司」会把那颗按钮在所有公司上永久置灰。
          formTemplates: null,
          formSubmissions: null,
          formsMinted: null,
          formsBusy: 'idle',
          formsError: null,
          formsAutoFilled: null,
          formsVoiding: null,
          formBuilderBusy: 'idle',
          formBuilderError: null,
          ingestStatus: 'idle',
          restoring: false,
          restoreError: null,
        })
      } else {
        set({ restoring: false, restoreError: message, ingestStatus: 'idle' })
      }
    } finally {
      if (restoreInFlightFor === contextId) restoreInFlightFor = null
    }
  },

  // feat-050 的被覆盖口（见接口注释）：一处收口"权威 contextId 变了"这件事。
  adoptContext: (contextId, ownerToken) => {
    if (!stubSelected) rememberContextId(contextId)
    set({
      contextId,
      ownerToken: ownerToken ?? storedOwnerToken(contextId),
      restoreError: null,
      // 换了 context 就不能留着上一个 context 的数据（换账号数据串是 feat-053 的红线）。
      ...(contextId !== get().contextId
        ? { team: null, rawTeam: null, files: [], notes: [], adviseRuns: null,
            // T3：表单**七件**同属公司域——留着就是把 A 公司的链接摆在 B 公司的资料库里，
            // 经理一复制就把 A 的人的表单发出去了。
            // 🔴 formsBusy / formsError 也在这份清单里，别只清前三件（对抗自审逮到）：
            // formsError 是「A 那次铸链为什么没成」，挂到 B 头上就是替 B 断言一件没发生的事；
            // formsBusy 漏了则「铸链途中切公司」会把生成键永久卡在「正在生成…」。
            // gap2 T11 把 formBuilderBusy / formBuilderError 加进同一份清单，理由逐字相同。
            // 这份清单与 resetLiteCompanyData 那份是同一份契约的两个抄本，改一处必须改两处。
            formTemplates: null, formSubmissions: null, formsMinted: null,
            formsBusy: 'idle' as const, formsError: null,
            formsAutoFilled: null, formsVoiding: null,
            formBuilderBusy: 'idle' as const, formBuilderError: null,
            ingestStatus: 'idle' as IngestStatus,
            // T10：补资料那一组同属公司域（「A 公司那次补传为什么没成」挂到 B 头上，
            // 就是替 B 断言一件没发生的事——与上面 formsError 逐字同一条理由）。
            appendStatus: 'idle' as IngestStatus, appendError: null, appendReceipt: null }
        : {}),
    })
  },

  // fixD/B1 · 切回名册里的某一份。
  //
  // 这是"第二次上传把第一家公司的数据从界面上抹掉，且回不去"里 **"回得去"** 的那一半；
  // 另一半（上传入口在已有团队时把"会新建一份、不会合并"讲清楚）是 UI 的活。
  //
  // 🔴 三条失败路径都必须**说出来**，一条都不许静默（三者的语义差别见 ContextSwitchError）：
  //   ① 本地没有 owner_token → 'missing-credential'（本地即可判定，不打网络）。
  //      绝不硬着头皮打过去：那必然 404，而 404 什么都证明不了。
  //   ② 404 → 'unreadable'（"打不开"，不是"没了"）。名册不动。
  //   ③ 其它（后端没起/网断）→ 'failed'。锚点与名册都不动。
  //
  // 🔴 **先取数据，成功了才换 contextId**（fixD 复核 · 新 finding 1）。原来是
  // `adoptContext(新 id)` → `await restoreSession()`，两个后果：
  //   · restoreSession 在 await 之后拿闭包里的旧 contextId 无条件写 team/ownerToken，
  //     两次快速切换（双击，或点了 A 又改主意点 B）就把 A 的整份花名册渲染到 B 的 id 底下，
  //     手里攥的还是 A 的 owner_token —— 下一次对 B 的受保护读带着 A 的 token 打过去，
  //     feat-038 回 404，于是又被读成"B 没了"。跨公司串数据 + 连锁误判，一次双击的距离。
  //   · 且 restoreSession 开头的重入闸会让第二次切换直接空转（现已改为按 id 记）。
  // 现在换成"取到了再换"：失败时用户仍停在原来那份公司上（不留半切状态），
  // 竞态由 switchSeq 收口——只有最后一次点击允许落地，先到的结果一律作废。
  switchContext: async (contextId) => {
    const { contextId: current, transport, switchPending } = get()
    if (!contextId || contextId === current) return
    // files-hub-0729/02 · 同一目标已在路上 → 直接返回。
    //
    // 🔴 为什么这一道非在 store 里不可，UI 的 `disabled` 顶不住：React 的 `disabled` 要等
    // 一次重渲染才落到 DOM 上，而**同一拍**里的第二次 click（用户手抖连点，两下之间没有任何
    // 网络往返）发生在重渲染之前——那一刻按钮在 DOM 上仍然是可用的，handler 照样跑。
    // 新门 verify-context-switch 的「同一拍连点两下只打一次 /team」相位就是这么逮到它的：
    // 置灰是真的、结果也是对的（switchSeq 让后到的那次作废），但**两发请求真的出去了**。
    // 一发多余的请求本身不致命，致命的是它证明了那道闸不在真正的临界区上。
    //
    // 只挡「同一个目标」：切到**别的**一份是合法的取代（switchSeq 负责让先发的那次作废），
    // 挡掉它会让用户点错一份之后无法立刻改点另一份。
    if (switchPending === contextId) return
    const seq = ++switchSeq
    set({ switchError: null, switchPending: contextId })
    if (!storedOwnerToken(contextId)) {
      if (seq !== switchSeq) return
      set({ switchError: 'missing-credential', switchPending: null })
      return
    }
    try {
      const payload = await transport.fetchTeam(contextId)
      if (seq !== switchSeq) return // 已被更新的一次切换取代 —— 结果作废，一个字段都不写
      // adoptContext 一处收口：落 state + 落 localStorage 锚点 + 清掉上一份的派生数据
      //（notes/files/team，id 变了才清 —— 见其实现）。它与紧跟的 set 在同一拍里跑完，
      // 中间不 await，所以不存在"contextId 已是 B、team 还是 A"的可观测窗口。
      get().adoptContext(contextId)
      set({
        team: liteTeamFromPayload(payload),
        rawTeam: payload,
        ingestStatus: 'ready',
        restoring: false,
        restoreError: null,
        switchError: null,
        switchPending: null,
      })
      void get().refreshFiles()
      void get().refreshNotes()
    } catch (err) {
      if (seq !== switchSeq) return
      const message = err instanceof Error ? err.message : String(err)
      set({
        switchPending: null,
        switchError: isNotFound(err, message) ? 'unreadable' : 'failed',
      })
    }
  },

  // 用户显式说"这一份我不要看见了"。**只此一个调用方**——绝不许挂到任何失败处理路径上。
  forgetContext: (contextId) => {
    if (!contextId) return
    set({ knownContexts: forgetKnownContext(contextId), switchError: null })
  },

  // files-hub-0729/01 · 逐份下载。
  //
  // 🔴 刻意**不写任何 state**：下载是一次性动作，不是屏上的一份状态。每行自己的
  // pending/error 活在 FileManifest 的组件局部（一行失败不该让另一行也变红），
  // 而"这次取回了什么字节"根本不该进 store —— 文件内容是不可信的用户内容，
  // 让它在全局 state 里躺着只会多一处可被误渲染的地方。
  //
  // 🔴 抛错不吞：切不过去要说、下不下来同样要说（同 switchContext 那条"绝不静默失败"）。
  downloadFile: async (idx) => {
    const { contextId, transport } = get()
    if (!contextId) throw new Error('no context')
    return await transport.downloadFile(contextId, idx)
  },

  // 下面三个 refresh 全部带同一道 `stillOn` 闸（fixD 复核 · 新 finding 1 的同族）：
  // 它们各自 await 期间 contextId 都可能被切走（AuthPanel 的登录恢复就是 adoptContext(first)
  // 紧跟 refreshTeam + refreshNotes，与用户手点切换天然并发）。少一道闸，"A 的人/文件/笔记
  // 落在 B 的 id 底下"就照样成立——只是入口从 switchContext 换成了这三个。
  refreshTeam: async () => {
    const { contextId, transport } = get()
    if (!contextId) return
    try {
      const payload = await transport.fetchTeam(contextId)
      if (!stillOn(get, contextId)) return
      set({ team: liteTeamFromPayload(payload), rawTeam: payload, ingestStatus: 'ready' })
    } catch (err) {
      if (!stillOn(get, contextId)) return
      set({ ingestError: err instanceof Error ? err.message : String(err) })
    }
    if (!stillOn(get, contextId)) return
    void get().refreshFiles()
  },

  refreshFiles: async () => {
    const { contextId, transport } = get()
    if (!contextId) return
    try {
      const payload = await transport.fetchFiles(contextId)
      if (!stillOn(get, contextId)) return
      set({ files: payload.files })
    } catch {
      // 文件清单是次要回看视图——拉取失败不该打断主流程（team 已就绪）。
    }
  },

  refreshNotes: async () => {
    const { contextId, transport } = get()
    if (!contextId) return
    try {
      const payload = await transport.fetchNotes(contextId)
      if (!stillOn(get, contextId)) return
      set({ notes: payload.notes })
    } catch {
      // 笔记是次要只读视图——拉取失败不该打断主流程。
    }
  },

  // issue #49 · 议事室历史——与 refreshNotes 同骨架（contextId 收口 + stillOn 闸 + 静默降级）。
  refreshAdviseRuns: async () => {
    const { contextId, transport } = get()
    if (!contextId || !transport.fetchAdviseRuns) return
    try {
      const payload = await transport.fetchAdviseRuns(contextId)
      if (!stillOn(get, contextId)) return
      set({ adviseRuns: payload.runs })
    } catch {
      // 历史是次要只读视图——拉取失败不该打断主流程（adviseRuns 停在上一次的值）。
    }
  },

  // T3 · 常驻表单——与 refreshNotes / refreshAdviseRuns 同骨架（contextId 收口 + stillOn 闸
  // + 静默降级）。两次拉取各自判空、各自 stillOn：模板拉到了而提交没拉到时，模板照样该显示。
  // 🔴 必须吞错。live-frontend-gate 的 tokenDiscipline 相位会在**故意缺 token** 的情况下调
  // 整个 refresh 系列，任何一条抛出去就是门红——而这三条端点缺 token 恒 404。
  refreshForms: async () => {
    const { contextId, transport } = get()
    if (!contextId) return
    if (transport.fetchForms) {
      try {
        const payload = await transport.fetchForms(contextId)
        if (!stillOn(get, contextId)) return
        set({ formTemplates: payload.templates })
      } catch {
        // 次要只读视图——失败不打断主流程；formTemplates 停在 null，整段不渲染。
      }
    }
    // 上面那次 await 期间 contextId 可能已经被换掉——再拉一次提交清单前先核一次身份，
    // 否则会拿着 B 公司的 id 去发一条本该属于 A 的请求。
    if (!stillOn(get, contextId)) return
    if (transport.fetchFormSubmissions) {
      try {
        const payload = await transport.fetchFormSubmissions(contextId)
        if (!stillOn(get, contextId)) return
        // T9 · 这支端点在服务端顺手把本期备好了（流量触发，不引 cron）。`auto_filled` 是
        // additive key，**缺席**表示这次调用一行都没铸——所以这里用 `?? null` 而不是 `?? []`：
        // 「没铸」和「铸了 0 条」在下游是同一件事，但 null 让"这次什么都没发生"读起来是它本来
        // 的样子，而不是一个空数组（订阅方要判 length 才知道，最容易写成 truthy 判断而恒真）。
        //
        // 🔴 每次拉取都重写这个字段（包括写回 null）。留着上一次的值，铃铛会在此后每一次刷新
        // 上重复响一声同一件事——notifyStore 文件头那条红线要的是**真实状态转移**，
        // 不是一个曾经为真、之后一直挂着的标志。
        set({
          formSubmissions: payload.submissions,
          formsAutoFilled: payload.auto_filled?.length ? payload.auto_filled : null,
        })
      } catch {
        // 同上。
      }
    }
  },

  // T9 · 作废一条还没交的链接。作废 = 服务端把到期时刻拨到此刻（行还在，员工那头看到的是
  // 现成的「这条链接已过期」页），所以自动补铸不会立刻把它发回来。
  // 🔴 不做乐观改写：状态由服务端背书，改完回权威清单（同 createFormLinks 的姿态）。
  voidFormLink: async (submissionId) => {
    const { contextId, transport } = get()
    if (!contextId || !transport.voidFormSubmission || !submissionId) return false
    if (get().formsVoiding) return false // 同一时刻只作废一条，防双击（disabled 顶不住同一拍）
    set({ formsVoiding: submissionId, formsError: null })
    try {
      await transport.voidFormSubmission(contextId, submissionId)
      // 结果过期时也要放开忙态（createFormLinks 那条对抗自审逮到的高危，同一个坑）。
      if (!stillOn(get, contextId)) {
        set({ formsVoiding: null })
        return false
      }
      set({ formsVoiding: null })
      void get().refreshForms()
      return true
    } catch (err) {
      if (!stillOn(get, contextId)) {
        set({ formsVoiding: null })
        return false
      }
      const status = err instanceof TransportError ? err.status : undefined
      // 409 = 这条已经被交上来了。那不是失败，是**过时**：经理看到的那一屏比库里旧。
      // 回一次权威清单，让那一行自己变成「已交」——比弹一句报错有用得多。
      set({ formsVoiding: null, formsError: status === 409 ? null : 'failed' })
      void get().refreshForms()
      return false
    }
  },

  // T3 · 铸这一期的链接。
  //
  // 🔴 防双击的闸必须在 store 里，UI 的 `disabled` 顶不住：React 的 disabled 要等一次重渲染
  // 才落到 DOM 上，同一拍里的第二次 click 发生在那之前（同 switchContext 那段的教训，那次是
  // verify-context-switch 用「同一拍连点两下」逮到的）。而这个端点**不幂等**——第二发不是
  // 一次多余的请求，是真的给每个人再发一轮新链接，员工手机上会收到两条。
  createFormLinks: async (templateId, recipients) => {
    const { contextId, transport } = get()
    if (!contextId || !transport.createFormLinks) return false
    if (get().formsBusy !== 'idle') return false
    // 本地先挡一次人数越界：判据与服务端同一条（MAX_RECIPIENTS_PER_MINT=30），但**服务端
    // 仍是最后一道门**——这里挡只是为了不让经理白等一次往返，不是把校验搬到前端。
    if (recipients.length < 1 || recipients.length > 30) {
      set({ formsError: 'rejected' })
      return false
    }
    set({ formsBusy: 'minting', formsError: null })
    try {
      const result = await transport.createFormLinks(contextId, templateId, { recipients })
      // 🔴 结果过期时**也要把 formsBusy 放回 idle**（对抗自审逮到的高危）。
      // 第一版这里直接 `return false`，忙态就永远卡在 'minting' 了：adoptContext 的公司域
      // 清单当时只清三件（模板/提交/刚铸的链接），不含 formsBusy；而唯一能清它的
      // resetFormsWrite 只挂在「切换模板」上，那排按钮又只在有 2 张以上模板时才渲染——
      // 今天恒是内置周报这一张。于是「铸链途中切换公司」= 生成键在**所有**公司上永久置灰、
      // 标着「正在生成…」，只有刷新页面或登出能救。
      // 放回 idle 是安全的：进门那道 `formsBusy !== 'idle'` 闸保证同一时刻只有一次铸链在飞，
      // 所以这次结果落地时不可能有另一次铸链正持有这个标志。
      if (!stillOn(get, contextId)) {
        set({ formsBusy: 'idle' })
        return false
      }
      set({ formsMinted: result, formsBusy: 'idle' })
      // 铸完立刻回权威清单：新铸的这几条在 submissions 里是 status 'open' 的行，
      // 「谁交了」那一段要跟着长出来（不做乐观拼装——状态由服务端背书）。
      void get().refreshForms()
      return true
    } catch (err) {
      // 同上：过期的失败也要放开忙态，但**不写 formsError**——那句报错属于上一家公司，
      // 挂到已经切过去的这一家头上，就是替它断言了一件没发生的事。
      if (!stillOn(get, contextId)) {
        set({ formsBusy: 'idle' })
        return false
      }
      const status = err instanceof TransportError ? err.status : undefined
      set({
        formsBusy: 'idle',
        formsError:
          status === 422 ? 'rejected' : status === 409 || status === 410 ? 'retired' : 'failed',
      })
      return false
    }
  },

  resetFormsWrite: () => set({ formsBusy: 'idle', formsError: null, formsMinted: null }),

  // ── gap2 T11 · 拼装器写侧 ────────────────────────────────────────────────────────────────
  // 骨架照 runProjectWrite 的先例（判可用 → 判忙 → 写 → 回权威重拉 → 落忙态 / 诚实报错），
  // 但不共用它：那一族的忙/错态被 8 个 CRUD action 共享，把模板保存挤进去会让「改项目」和
  // 「改模板」互相锁死，而它们在屏幕上离得很远。
  saveFormTemplate: async (input) => {
    const { contextId, transport } = get()
    if (!contextId) return false
    if (!transport.saveFormTemplate) {
      set({ formBuilderError: { code: 'unavailable' } })
      return false
    }
    if (get().formBuilderBusy !== 'idle') return false
    set({ formBuilderBusy: 'saving', formBuilderError: null })
    try {
      await transport.saveFormTemplate(contextId, input)
      // 🔴 结果过期时也要把忙态放回 idle（同 createFormLinks 那条对抗自审逮到的高危）。
      if (!stillOn(get, contextId)) {
        set({ formBuilderBusy: 'idle' })
        return false
      }
      // 写完回权威清单重拉，不做本地乐观拼装：服务端会给 id、会铸 created_at、还可能在
      // ensure_builtin_templates 里回填标记——本地拼出来的那一份从第一秒就和库里不是同一张。
      await get().refreshForms()
      set({ formBuilderBusy: 'idle' })
      return true
    } catch (err) {
      if (!stillOn(get, contextId)) {
        // 报错属于上一家公司，挂到已经切过去的这一家头上就是替它断言一件没发生的事。
        set({ formBuilderBusy: 'idle' })
        return false
      }
      set({ formBuilderBusy: 'idle', formBuilderError: builderError(err) })
      return false
    }
  },

  draftFormFromFile: async (fileIndex, title) => {
    const { contextId, transport } = get()
    if (!contextId) return null
    if (!transport.draftFormFromFile) {
      set({ formBuilderError: { code: 'unavailable' } })
      return null
    }
    if (get().formBuilderBusy !== 'idle') return null
    set({ formBuilderBusy: 'drafting', formBuilderError: null })
    try {
      const result = await transport.draftFormFromFile(contextId, {
        file_index: fileIndex,
        ...(title ? { title } : {}),
      })
      if (!stillOn(get, contextId)) {
        set({ formBuilderBusy: 'idle' })
        return null
      }
      set({ formBuilderBusy: 'idle' })
      return result
    } catch (err) {
      if (!stillOn(get, contextId)) {
        set({ formBuilderBusy: 'idle' })
        return null
      }
      set({ formBuilderBusy: 'idle', formBuilderError: builderError(err) })
      return null
    }
  },

  resetFormBuilder: () => set({ formBuilderBusy: 'idle', formBuilderError: null }),

  // ── 项目手编 CRUD（rich-align-0722 · issue 05a）。四个都走 runProjectWrite 共用骨架
  // （判可用/判忙 → 写 → refreshTeam 从权威 /team 重派生 → 落忙态/诚实报错）。────────────────
  addProject: (input) => runProjectWrite(get, set, (cid, t) => t.addProject?.(cid, input)),
  patchProject: (projectId, patch) =>
    runProjectWrite(get, set, (cid, t) => t.patchProject?.(cid, projectId, patch)),
  archiveProject: (projectId) =>
    runProjectWrite(get, set, (cid, t) => t.archiveProject?.(cid, projectId)),
  restoreProject: (projectId) =>
    runProjectWrite(get, set, (cid, t) => t.restoreProject?.(cid, projectId)),
  // rich-align-0722/06 · 人员 CRUD——同骨架，只换 transport 端点。
  addPerson: (input) => runProjectWrite(get, set, (cid, t) => t.addPerson?.(cid, input)),
  patchPerson: (personId, patch) =>
    runProjectWrite(get, set, (cid, t) => t.patchPerson?.(cid, personId, patch)),
  archivePerson: (personId) =>
    runProjectWrite(get, set, (cid, t) => t.archivePerson?.(cid, personId)),
  restorePerson: (personId) =>
    runProjectWrite(get, set, (cid, t) => t.restorePerson?.(cid, personId)),
  resetProjectWrite: () => set({ projectWriteBusy: false, projectWriteError: null }),

  askLive: (req, question) => {
    // 中止在飞的那条流（`_abort` 在 run 落定后不会自己归 null，对已收尾的流是无操作）。
    // 🔴 #71 起 UI 层在 running 时把发送键置灰，所以「打断上一轮」这条路在产品里已经走不到；
    //    这一发留着是给 resetRun / 换公司那几条路兜底，别当成"支持中途换问题"的实现。
    // 新一轮开跑即撤旧 Ask 卡——与 #71 之前同规格（一个提问一张快问卡，旧草稿随旧轮退场）。
    get()._abort?.()
    const { agentSource, contextId, notes, turns } = get()
    const notesBefore = notes.length
    // 🔴 history 从**已落定且真答出东西**的前几轮组装（askHistory.buildAdviseHistory）。
    //    组装点在这里而不是调用方：屏底 composer、空态建议 chips、将来的建议追问 chips
    //    是三个入口，逐个记得带上下文＝给"新入口忘了带"留位置（同 withLocale 的一处补全）。
    const history = buildAdviseHistory(turns)
    const turn: LiveTurn = {
      id: nextTurnId(),
      // 回显用原话；空态 chips 之类没有"织文前原话"的入口退回 situation 本身。
      question: (question ?? req.situation ?? '').trim(),
      refs: req.references ?? null,
      run: { ...emptyRunState(), status: 'running' },
    }
    set({
      turns: [...turns, turn],
      run: turn.run,
      ask: null,
      askBusy: 'idle',
      askError: null,
      noteJustAdded: false,
    })
    let settled = false
    const handle = agentSource.run(
      {
        ...req,
        company_context_id: req.company_context_id ?? contextId ?? undefined,
        // additive optional：第一问（history 为 undefined）请求体里**没有这个键**。
        ...(history ? { history } : {}),
      },
      (state) => {
        // 🔴 按 turn.id 认领自己那一轮——不写"最后一轮"。被中止的旧流会在微任务里再吐一帧
        //    （transport 的 abort 走 onDone() 无 error，createLiveAgentSource 会把它收成
        //    'complete'），单槽时代那一帧会**把新一轮整个盖回旧状态**；按 id 写就落在它
        //    自己那一轮里，盖不到别人。轮次已被清掉（离开议事室）时 map 找不到 id，整帧丢弃。
        const list = get().turns
        const idx = list.findIndex((t) => t.id === turn.id)
        if (idx !== -1) {
          const next = list.slice()
          next[idx] = { ...next[idx], run: state }
          // 流里出生 ask-draft（一次性收养）：之后的编辑/分享/回执活体在 store，不再被流覆盖。
          const current = get().ask
          const adopt = state.askDraft && (!current || current.id !== state.askDraft.id)
          set(
            // `run` 是尾轮镜像：只有当这一轮就是尾轮时才同步（旧轮收尾不该把界面拉回去）。
            idx === next.length - 1
              ? adopt
                ? { turns: next, run: state, ask: state.askDraft }
                : { turns: next, run: state }
              : adopt
                ? { turns: next, ask: state.askDraft }
                : { turns: next },
          )
        }
        // 一次 advise 落定后：拉一次笔记，**后端确认新笔记落库**（计数增长）才亮 nudge——
        // 观察被红线门丢弃时后端不落库、计数不变、nudge 不出（诚实降级，不显占位）。
        if (!settled && (state.status === 'complete' || state.status === 'error')) {
          settled = true
          const { contextId: cid, transport } = get()
          if (cid) {
            void transport
              .fetchNotes(cid)
              .then((payload) => {
                // 同 refreshNotes 的闸：这一趟飞行期间用户可能已经切到别家公司了。
                if (!stillOn(get, cid)) return
                set({ notes: payload.notes, noteJustAdded: payload.notes.length > notesBefore })
              })
              .catch(() => {
                /* 次要——失败不打断，只是这次不亮 nudge */
              })
          }
        }
      },
    )
    set({ _abort: handle.abort })
  },

  resetRun: () => {
    get()._abort?.()
    set({
      turns: [],
      run: emptyRunState(),
      _abort: null,
      ask: null,
      askBusy: 'idle',
      askError: null,
    })
  },

  // #71 · 离开议事室 / 换公司即散场。turns 是本场对话的**全部**载体，清它就等于结束对话
  // （没有第二份拷贝在 localStorage 或库里等着复活——这是拍板的刻意设计）。
  clearTurns: () => {
    get()._abort?.()
    set({ turns: [], run: emptyRunState(), _abort: null })
  },

  // ── Ask 草稿态编辑（只在 draft 生效——shared 之后题目/受访者即定格）──────────────
  editAskQuestion: (questionId, text) => {
    const { ask } = get()
    if (!ask || ask.status !== 'draft') return
    set({
      ask: {
        ...ask,
        questions: ask.questions.map((q) => (q.id === questionId ? { ...q, text } : q)),
      },
    })
  },

  addAskQuestion: (kind) => {
    const { ask } = get()
    if (!ask || ask.status !== 'draft' || ask.questions.length >= 3) return
    // id 在本草稿内单调递增（q1..qN 之上继续编号，避免与被删 id 撞车）。
    const maxN = ask.questions.reduce((n, q) => {
      const m = /^q(\d+)$/.exec(q.id)
      return m ? Math.max(n, Number(m[1])) : n
    }, 0)
    set({
      ask: {
        ...ask,
        questions: [...ask.questions, { id: `q${maxN + 1}`, kind, text: '' }],
      },
    })
  },

  removeAskQuestion: (questionId) => {
    const { ask } = get()
    if (!ask || ask.status !== 'draft' || ask.questions.length <= 1) return
    set({ ask: { ...ask, questions: ask.questions.filter((q) => q.id !== questionId) } })
  },

  toggleAskRecipient: (personId, name) => {
    const { ask } = get()
    if (!ask || ask.status !== 'draft') return
    const has = ask.recipients.some((r) => r.id === personId)
    set({
      ask: {
        ...ask,
        recipients: has
          ? ask.recipients.filter((r) => r.id !== personId)
          : [...ask.recipients, { id: personId, name }],
      },
    })
  },

  confirmAsk: async () => {
    const { ask, transport, contextId } = get()
    // feat-047 打回复验：白名单守卫——**只有 draft 可确认**。此前写作 `status !== 'draft'` 的
    // 黑名单式否定，与 coerce 折 draft 的 bug 叠加后，一张已撤回的 ask 能被重新 saveAsk+shareAsk。
    if (!ask || ask.status !== 'draft') return
    if (get().askBusy !== 'idle') return
    set({ askBusy: 'saving', askError: null })
    try {
      // 保存（题目经服务端红线门，阶段 C）→ 一人一链。两步各自大声失败，不吞错。
      const saved = await transport.saveAsk({
        ...ask,
        company_context_id: ask.company_context_id ?? contextId ?? undefined,
      })
      const shared = await transport.shareAsk(saved.id)
      set({ ask: adoptAsk(shared), askBusy: 'idle' })
    } catch (err) {
      set({ askBusy: 'idle', askError: err instanceof Error ? err.message : String(err) })
    }
  },

  refreshAsk: async () => {
    const { ask, transport } = get()
    if (!ask || (ask.status !== 'shared' && ask.status !== 'collecting')) return
    if (get().askBusy !== 'idle') return
    set({ askBusy: 'refreshing', askError: null })
    try {
      const next = await transport.fetchAsk(ask.id)
      set({ ask: adoptAsk(next), askBusy: 'idle' })
    } catch (err) {
      set({ askBusy: 'idle', askError: err instanceof Error ? err.message : String(err) })
    }
  },
}))

// feat-047 打回复验：transport 回来的 ask 一律过同一把防御 coerce 再进 store——未知 status 折
// closed、坏形状（超题数/未知题型/值域外回执）宁可不出卡（抛错走 askError 大声显示）。
// 服务端是最终门；这里只是"坏形状绝不渲染"的客户端半边。
// 此前 lite2 把 transport 原始响应直接 set 进 store（零 coerce）——而 fetchAsk/refreshAsk
// 正是真后端交付 revoked/expired 的主路径，只修 coerceAskDraft 堵不住它（照 src/lite 的
// adoptAsk 先例补齐；拷贝不引用）。
function adoptAsk(raw: AskDraft): AskDraft {
  const coerced = coerceAskDraft(raw)
  if (!coerced) throw new Error('ask payload failed shape validation — refusing to render it')
  return coerced
}

// feat-047 门缝：live-frontend-gate 的 tokenDiscipline 相位读 contextId/ownerToken 断言 token
// 纪律（门是唯一消费者；产品代码不经 window 读 store）——同 src/lite/store.ts 的 __liteStore
// 先例，独立命名 __lite2Store 避免与 v01 撞名。
if (typeof window !== 'undefined') {
  ;(window as unknown as Record<string, unknown>).__lite2Store = useLite
}

// ── arch-0802 · 公司域清扫收口（useLite 半边）───────────────────────────────────────────
// 换账号（clearCompanyScope）与「重新开始」（restartAll）共用的公司数据清单——原先在
// AuthPanel 两处逐字重复。adoptContext(null) 只在 contextId **确实变了**时才清派生数据；
// 「id 本来就是 null、team 却还挂着」的中间态不该赌，租户隔离不留「多半」——调用方先
// adoptContext(null)，再用这里显式全清。🔴 往 LiteState 加公司域字段（团队/文件/笔记/
// 名册/切换态/ask…）时必须同步进这份清单；纯用户偏好才有资格不进。
export function resetLiteCompanyData(): void {
  useLite.setState({
    team: null,
    rawTeam: null,
    files: [],
    notes: [],
    noteJustAdded: false,
    // #71 · 会话流是公司域数据（问的是**这家**公司的事），换账号/重开必清。`run` 是
    // turns 尾轮的镜像，两者必须同进同退——只清一个会留下"turns 空了但屏上还挂着上一家
    // 公司的判读卡"的错态。
    turns: [],
    run: emptyRunState(),
    adviseRuns: null,   // issue #49：历史是公司域数据，换账号/重开必清
    // T3 · 常驻表单**九件**全清（gap2 T11 加了拼装器那两件，T9 又加了自动补铸那两件）。
    // 两个 busy 都要归位——换账号时卡在 'minting'/'saving' 等于把那个键永久置灰成一个死按钮
    // （那次请求属于上一个账号，永远不会回来解锁它）；formsVoiding 同理。
    formTemplates: null,
    formSubmissions: null,
    formsMinted: null,
    formsBusy: 'idle',
    formsError: null,
    formsAutoFilled: null,
    formsVoiding: null,
    formBuilderBusy: 'idle',
    formBuilderError: null,
    ingestStatus: 'idle',
    ingestError: null,
    // T10 · 补资料那一组（与 adoptContext 里那份是同一份契约的两个抄本，改一处必须改两处）。
    appendStatus: 'idle',
    appendError: null,
    appendReceipt: null,
    knownContexts: [],
    switchError: null,
    switchPending: null,
  })
}


