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
import { createHttpTransport, storedOwnerToken } from './transport'
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

/** 删一条（服务端已 404 —— 这份真没了，别再挂在名册上骗人点）。 */
export function forgetKnownContext(contextId: string): KnownContext[] {
  const next = loadKnownContexts().filter((c) => c.id !== contextId)
  saveKnownContexts(next)
  return next
}

// 切回上一份可能失败，而且必须**分得清是哪一种失败**——两种失败对用户的意思完全不同：
//   'missing-credential' = 钥匙没了（登出清过 token / 换了浏览器）。公司数据多半还在，
//                          但这台机器证明不了它是你的 —— 说实话，别装作这份不存在。
//   'gone'               = 服务端 404。这份真没了，名册里也随手删掉。
// 🔴 绝不允许第三种"静默失败"：切不过去就必须说，不能停在原地让人以为点没生效。
export type ContextSwitchError = 'missing-credential' | 'gone' | 'failed'

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
let restoreInFlight = false

// 后端/stub 都把 404 编码进 Error.message（`team HTTP 404` / `team HTTP 404 (stub)`）——
// 这是 feat-028 立的"未知 id 大声失败"纪律留下的唯一可判据。404 = context 真没了/token 对不上
// （feat-038 租户隔离：绝不给 403 这种可枚举的 oracle），其余（500/网络断）都是"这次没连上"。
function isNotFound(message: string): boolean {
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
      set({
        ingestStatus: 'ready',
        team: liteTeamFromPayload(payload),
        rawTeam: payload,
        contextId: payload.context_id,
        // feat-047: 挂上本公司 owner_token（transport 已存并按 context_id 带 header）。
        ownerToken: payload.owner_token ?? null,
        // 上传成功即"有会话了"——把上一轮失败的恢复提示清掉。
        restoring: false,
        restoreError: null,
      })
      // feat-050：落锚点——这是"刷新还在"的全部秘密（数据本来就在后端，只差这根指针）。
      // stub 传输不落（它的 context 是进程内造的，落了下次真启动会拿去打真后端）。
      if (!stubSelected) {
        rememberContextId(payload.context_id)
        // fixD/B1：同时记进名册。**这一步是"回得去"的全部前提**——`POST /ingest` 每次都
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
      void get().refreshFiles()
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
    if (restoreInFlight) return // StrictMode 双跑 effect / 重复挂载
    const { contextId, transport, team } = get()
    // 已经有 team（刚上传完，或 feat-053 落地后由账号态先填好）→ 让路，不覆盖。
    if (!contextId || team) {
      set({ restoring: false, restoreError: null })
      return
    }
    restoreInFlight = true
    set({ restoring: true, restoreError: null })
    try {
      const payload = await transport.fetchTeam(contextId)
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
      const message = err instanceof Error ? err.message : String(err)
      if (isNotFound(message)) {
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
          // fixD/B1：这份服务端已经没了 —— 从名册里也删掉，别继续挂着一个点了会失败的入口。
          knownContexts: contextId ? forgetKnownContext(contextId) : get().knownContexts,
        })
      } else {
        set({ restoring: false, restoreError: message, ingestStatus: 'idle' })
      }
    } finally {
      restoreInFlight = false
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
  // 🔴 三条失败路径都必须**说出来**，一条都不许静默：
  //   ① 没有 owner_token —— 这台浏览器证明不了这份是你的（登出清过 token / 换了浏览器）。
  //      公司数据多半还在服务端，所以措辞是"这份在这台机器上打不开了"，不是"这份没了"。
  //      绝不硬着头皮打过去：没 token 的读必然 404，那会被下面当成"gone"，反手把一份
  //      其实还活着的公司从名册里删掉 —— 用一次误判换来永久失去入口。
  //   ② 404 —— 这份服务端真没了。restoreSession 的 404 分支已经干净回上传态并清名册。
  //   ③ 其它（后端没起/网断）—— 保住锚点与名册，只报"这次没连上"。
  switchContext: async (contextId) => {
    const { contextId: current } = get()
    if (!contextId || contextId === current) return
    set({ switchError: null })
    if (!storedOwnerToken(contextId)) {
      set({ switchError: 'missing-credential' })
      return
    }
    // adoptContext 一处收口：落 state + 落 localStorage 锚点 + 清掉上一份的派生数据
    // （id 变了才清，见其实现）。清掉是必须的：restoreSession 见到 team 还在会直接让路。
    get().adoptContext(contextId)
    await get().restoreSession()
    const after = get()
    if (after.team) return // 切成功
    // restoreSession 已按 404 / 网络错各自落地；这里只把结果翻译成 UI 能分辨的两种。
    set({ switchError: after.contextId === null ? 'gone' : 'failed' })
  },

  refreshTeam: async () => {
    const { contextId, transport } = get()
    if (!contextId) return
    try {
      const payload = await transport.fetchTeam(contextId)
      set({ team: liteTeamFromPayload(payload), rawTeam: payload, ingestStatus: 'ready' })
    } catch (err) {
      set({ ingestError: err instanceof Error ? err.message : String(err) })
    }
    void get().refreshFiles()
  },

  refreshFiles: async () => {
    const { contextId, transport } = get()
    if (!contextId) return
    try {
      const payload = await transport.fetchFiles(contextId)
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
              .then((payload) => set({ notes: payload.notes, noteJustAdded: payload.notes.length > notesBefore }))
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


