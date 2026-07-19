import { create } from 'zustand'
import type {
  AskDraft,
  AskQuestionKind,
  LiveFileEntry,
  LiveNoteEntry,
  LiveTeamPayload,
  LiveTransport,
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
import type { AdviseRequest } from './transport'
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

interface LiteState {
  transport: LiveTransport

  // ── lite 导航 ──
  // feat-051：`screen` / `detail` 不再是 store 状态——当前屏与当前详情由 URL 派生
  //（routes.ts 的 useCurrentScreen / useRouteDetail）。留在 store 里会变成第二份真相，
  // 和后退键、刷新、深链三样各自打架。下面的 action 名字与签名保持不变，只是改成推路由。

  // ── Your team（feat-016 ingestion 产出）──
  ingestStatus: IngestStatus
  ingestError: string | null
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

  // feat-050：正在按存下的 contextId 取回上次会话（首帧即 true，避免"空态闪一下再冒出团队"
  // 让人以为数据丢了）。取回结束（成功或降级）必须落回 false——绝不留无限 loading。
  restoring: boolean
  // 取不回来且**不是** 404 时的原因（后端没起/网断）。404 不进这里：那是"context 真没了"，
  // 直接干净回上传态，不该冲用户报错。
  restoreError: string | null

  // fixD/B1：这台浏览器传过的每一份（新→旧，含当前这份）。上传入口据此告诉用户
  // "再传一次会新建一份，当前这份不会合并进去"，并列出回得去的入口。
  knownContexts: KnownContext[]
  // 切回上一份失败的原因（成功即 null）。🔴 只用于诚实报错，绝不用来伪装成功。
  switchError: ContextSwitchError | null
  // 正在切往哪一份（没在切 = null）。存在的理由不是"转个圈好看"：UI 必须据此把名册里的
  // 按钮**置灰**。裸 <button onClick={switchContext}> 无 pending 态 = 双击就是一次并发切换，
  // 而并发切换正是新 finding 1 那条跨公司串数据的触发方式。store 挡住了竞态，UI 还得挡住误触。
  switchPending: string | null

  // ── The room 一次 live 运行（feat-015 /advise）──
  run: LiveRunState
  agentSource: LiveAgentSource
  _abort: (() => void) | null

  // ── Ask / Quick ask（feat-034 阶段 B）——当前 Thread 的一张活体 Quick ask。
  // 🔴 回执数据只活在这里（AskDraft.recipients[].receipt）——LitePerson / 人卡零新增字段。
  ask: AskDraft | null
  askBusy: 'idle' | 'saving' | 'refreshing'
  askError: string | null

  // ── actions ──
  // feat-051：`params` 可给目标屏叠加 query——feat-057 的决策卡走
  // `goScreen('room', { q: '<问题>' })` 带着问题进议事室。省略即只切屏（既有 7 个调用点不变）。
  goScreen: (screen: LiteScreen, params?: Record<string, string | null>) => void
  openDetail: (kind: 'person' | 'project', id: string) => void
  closeDetail: () => void
  setTransport: (transport: LiveTransport) => void // AFK 门注入确定性 stub
  uploadFiles: (files: File[]) => Promise<void>
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
  refreshTeam: () => Promise<void>
  refreshFiles: () => Promise<void>
  refreshNotes: () => Promise<void>
  askLive: (req: AdviseRequest) => void
  resetRun: () => void

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

export const useLite = create<LiteState>((set, get) => ({
  transport: defaultTransport,

  ingestStatus: 'idle',
  ingestError: null,
  team: null,
  // feat-050：从 localStorage 同步取回（stub 传输下恒为 null，见 restoredContextId）。
  contextId: restoredContextId,
  // token 归 transport 存；这里挂同一份供 UI/门可见（feat-047 语义不变）。
  ownerToken: storedOwnerToken(restoredContextId),
  rawTeam: null,
  files: [],
  notes: [],
  noteJustAdded: false,
  // 有锚点才算"正在恢复"——没有锚点是干净首访，直接进上传引导，不该转圈。
  restoring: restoredContextId !== null,
  restoreError: null,
  knownContexts: loadKnownContexts(),
  switchError: null,
  switchPending: null,

  run: emptyRunState(),
  agentSource: createLiveAgentSource(defaultTransport),
  _abort: null,

  ask: null,
  askBusy: 'idle',
  askError: null,

  // 切屏消掉 Room 内的一次性 nudge（用户已离开事发现场；nudge 是瞬态感知，不是持久红点）。
  // feat-051：切屏本身交给路由（导航自带「离开详情」的语义，不必再手动清 detail）。
  goScreen: (screen, params) => {
    set({ noteJustAdded: false })
    navigateToScreen(screen, params)
  },
  openDetail: (kind, id) => navigateToDetail(kind, id),
  closeDetail: () => navigateCloseDetail(),

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
        ? { team: null, rawTeam: null, files: [], notes: [], ingestStatus: 'idle' as IngestStatus }
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
    const { contextId: current, transport } = get()
    if (!contextId || contextId === current) return
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

  askLive: (req) => {
    // 中止上一轮（切问题不叠流）。新一轮开跑即撤旧 Ask 卡（与 advice 卡同生命周期：
    // 一个 Thread 问题一张卡；旧草稿随旧 run 退场）。
    get()._abort?.()
    const { agentSource, contextId, notes } = get()
    const notesBefore = notes.length
    set({
      run: { ...emptyRunState(), status: 'running' },
      ask: null,
      askBusy: 'idle',
      askError: null,
      noteJustAdded: false,
    })
    let settled = false
    const handle = agentSource.run(
      { ...req, company_context_id: req.company_context_id ?? contextId ?? undefined },
      (state) => {
        // 流里出生 ask-draft（一次性收养）：之后的编辑/分享/回执活体在 store，不再被流覆盖。
        const current = get().ask
        if (state.askDraft && (!current || current.id !== state.askDraft.id)) {
          set({ run: state, ask: state.askDraft })
        } else {
          set({ run: state })
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
    set({ run: emptyRunState(), _abort: null, ask: null, askBusy: 'idle', askError: null })
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


