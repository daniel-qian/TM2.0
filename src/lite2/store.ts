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
  LiveExtractionMode,
  LiveFileEntry,
  LiveFilesPayload,
  LiveAdviseRunEntry,
  LiveAdviseThread,
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
// #91 · 非 hook 的 i18n 取词路径（与 transport.ts 同一条纪律：只 import index.ts，零 React）。
// store 需要自己造两句话：任务在服务端读挂时的诚实报错、轮询联系不上时的超时文案。
import { activeLocale, getDict } from '../shared/i18n'
import {
  coerceAdvice,
  coerceAskDraft,
  coerceFollowups,
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

// ── #89 · 「这一趟抽取是谁干的」要活过刷新 ───────────────────────────────────────────────
//
// 为什么非存不可：这个值只在**任务落定那一刻**被消费一次——#90 之前它骑在两个 POST 写口的
// 响应上，#91 起改从 GET /files 的 `last_job.extraction_mode` 里由内部轮询取（POST 秒回时
// 抽取还没跑）。`GET /team/{id}` 是读口、不重跑抽取；`last_job` 虽然常驻，但**刻意不让**
// refreshFiles 直接消费它——job 行是无 FK 的审计痕迹，`emptyArchive` 清空档案不删 job，
// 直接消费=清空后横幅从服务端诈尸（verify-extraction-degraded ⑥ 钉着这条）。所以刷新后的
// 记忆仍走本地：0811 那位合伙人恰恰是「传完 → 看了会儿 → 刷新/换页」——只活在内存里的警告，
// 正好在她最需要的时候消失。
//
// 🔴 连着 contextId 一起存，读的时候必须核对：`emptyArchive` 清空档案**不换 context_id**，
//    上一轮的 'degraded' 会原样挂在一份崭新的空档案上，屏上就是一句关于不存在之事的警告。
//    存成 {contextId, mode} 让不匹配自我失效，比在三个清理点各补一刀可靠。
const EXTRACTION_MODE_KEY = 'lite2:extractionMode:v1'

export function loadStoredExtractionMode(contextId: string | null): LiveExtractionMode | null {
  try {
    if (!contextId || typeof window === 'undefined' || !window.localStorage) return null
    const raw = window.localStorage.getItem(EXTRACTION_MODE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as { contextId?: string; mode?: string }
    if (parsed?.contextId !== contextId) return null
    return parsed.mode === 'degraded' || parsed.mode === 'llm' || parsed.mode === 'heuristic'
      ? parsed.mode
      : null
  } catch {
    return null
  }
}

export function rememberExtractionMode(
  contextId: string | null,
  mode: LiveExtractionMode | null | undefined,
): void {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return
    if (!contextId || !mode) window.localStorage.removeItem(EXTRACTION_MODE_KEY)
    else window.localStorage.setItem(EXTRACTION_MODE_KEY, JSON.stringify({ contextId, mode }))
  } catch {
    /* 同上：无痕模式下这次会话内存里还在，只是刷新后不再提醒 */
  }
}

// ── #88 · 名册（`lite2:knownContexts:v1`）已整条撤除 ──────────────────────────────────────
//
// 这里曾经住着「这台浏览器传过哪几份」的名册：`KnownContext` / `loadKnownContexts` /
// `rememberKnownContext` / `forgetKnownContext`，以及它带出来的 `switchContext` /
// `forgetContext` / `ContextSwitchError`。它存在的全部理由是**一台电脑上会有好几份档案**——
// `POST /ingest` 每次新铸一个 context，第二次上传就把第一份从界面上抹掉且回不去，名册是
// 那条回得去的路。
//
// #88（Danny 0810 拍板「不要有『新建』的想法」）把那个前提本身撤了：`uploadFiles` 降级成
// **只在 `contextId === null` 时开火的引导路径**，其余一律 `appendFiles` 补进当前这一份。
// 于是一台电脑最多只会长出 **1 份**档案，而名册那套 UI 要 **≥2 份**才会出现——它不是
// 「留着以防万一」的入口，是**谁都点不到的死代码**。纠错出口换成了 #86 的「清空这份档案」
// （`emptyArchive`，`context_id`/`owner_token` 原地不变）。
//
// 🔴 别照着 git 历史把它接回来：接回来就等于把「一个人一份档案」这条主张又拆了。
//
// 留一句给下一个人：那段代码里有两条纪律**仍然成立**，只是搬去了别处——
//   ① 404 只能读成「打不开」不能读成「没了」（feat-038 刻意不给存在性 oracle）——
//      现在活在 `isNotFound` + `restoreSession` / `emptyArchive` / `fileDeleteError` 三处；
//   ② 凭据只有一个家（owner_token 归 transport 的 `lite2:ownerTokens:v1`）——没变。

// T3 · 铸链失败的三种，因为对经理的意思完全不同（同 `isNotFound` 那条「404 分不出成因」的取舍）：
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

// 🔴 "别把为 A 取回来的数据写进已经切到 B 的 state"（fixD 复核 · 新 finding 1 的正主）。
//
// 本文件里每一个 `await transport.fetchX(contextId)` 都持有一个**闭包里捕获的旧 contextId**。
// await 期间 contextId 完全可能被改掉（adoptContext / clearCompanyScope /
// AuthPanel 的登录恢复），而 await 之后那句 `set({ team, ownerToken })` 原来一次都不回头核对。
// #88 撤掉 `switchContext` 之后改 id 的路少了一条，但**这道闸一条都不能松**：换账号清场
// 与登录恢复照旧会在 await 期间把 contextId 换掉。
// 后果不是"渲染慢一拍"，是**跨公司串数据**：屏幕上挂着 B 公司的 contextId 和锚点，人却是 A
// 公司的人，ownerToken 还是 A 的钥匙 —— B 公司的经理看到的整份花名册来自 A 公司的文件。
// 这正是本轮红线最硬的一种形态。
//
// 用法：await 之前先把目标 id 捞在手里，await 之后 `if (!stillOn(get, cid)) return`。
// 返回 false = 这次结果已过期，**一个字段都别写**（取代它的那次调用会自己落地结果与错误）。
function stillOn(get: () => LiteState, contextId: string | null): boolean {
  return get().contextId === contextId
}

// ── #91 · 异步 deposit 的内部轮询（对外契约一个字不改）────────────────────────────────────
//
// #90 把上传拆成「秒级 deposit + 服务端 worker 读取」之后，POST 响应不再是终态：/ingest 回的
// 是空骨架，补传回的是旧世界 + 'reading' 行。**直接拿它当终态渲染就是把空骨架当成空团队**
// ——所以 uploadFiles/appendFiles 在 deposit 之后关起门来轮询 GET /team/{id}/files 的任务摘要
// （`last_job`），全部文件到达终态才翻 'ready'。
//
// 🔴 对外契约不变是这次迁移成本的胜负手（侦查线 A2）：`ingestStatus/appendStatus` 的
//    'ingesting'→'ready' 二值翻牌对外一个字不改——约 30 道活跃门 + 18 张数据态像素基线全锚在
//    这个契约上。轮询是这两个 action 的**内部实现**，别把它泄漏成新的状态或新的事件：
//    · notifyStore 只认 ingesting→ready 那一跳 → 只在轮询落定那一刻翻，deposit 回执绝不翻
//      （提前翻=「你的团队已就绪」的假通知）；
//    · OnboardGate/UploadPanel 的防双击闸吃的是「忙态覆盖整个耗时窗口」→ 'ingesting' 从
//      deposit 前一直挂到轮询落定；
//    · ingestClock 的秒表锚点跟着忙态活 → 自动从「HTTP 生命周期」变成「轮询生命周期」，
//      模块级锚点本来就是为中途离开设计的，零改动。
//
// 🔴 每一轮 poll 都要过 stillOn 身份复核（不是只在最后一次）——A 的轮询结果写进 B 的 state
//    是红线事故（下面 stillOn 那段碑的同族）。
//
// 落定判据（两条腿，谁先答谁算）：
//   · `last_job.id === 本次 deposit 的 job.id` 且 status 到 done/failed —— 任务自己的答案；
//   · 摘要不可见/被更新的任务顶掉时退回看行：本批没有任何 'reading' 行了（失败时服务端会把
//     行收走，成功时翻终态，两种终局都让这条腿闭合）。
// 🔴 只消费**自己那个 job** 的 extraction_mode——别的任务的标签归别的轮询循环。
const INGEST_POLL_MS = 3000
const INGEST_POLL_MAX_MS = 10 * 60 * 1000 // 服务端 worker 死在半路（孤儿回收只在重启时跑）的兜底
const INGEST_POLL_MAX_MISSES = 4 // 连续 4 轮拉不到清单（每轮自带 15s 超时）→ 诚实放手

function sleepMs(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// fetchTeam 没有（也不该有）传输层超时——这里给「落定后取权威世界」这一次调用设墙钟，
// 否则整条状态机会吊死在一个永不返回的 GET 上。竞速输掉的那个 fetch 悬空无害：下一次
// refreshTeam 会取代它，且它自身不写任何 state。
function withDeadline<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`deadline ${ms}ms`)), ms)
    p.then(
      (v) => { clearTimeout(timer); resolve(v) },
      (e) => { clearTimeout(timer); reject(e) },
    )
  })
}

function jobFailedMessage(reason: string | null | undefined): string {
  const lead = getDict(activeLocale()).upload.jobFailedLead
  return reason ? `${lead} — ${reason}` : lead
}

type IngestSettle =
  | { outcome: 'ready'; mode: LiveExtractionMode | null }
  | { outcome: 'failed'; reason: string | null }
  | { outcome: 'stale' } // contextId 在轮询期间被换掉——结果作废，一个字段都不写
  | { outcome: 'lost' } // 联系不上/超过墙钟——文件多半已收下，诚实说「刷新看看」

// 落定后取权威世界（20s 墙钟 ×2 次）。null = 两次都没拿到——调用方走诚实报错，
// 🔴 绝不把 `deadline 20000ms` 这种开发者串漏进用户报错（那正是 ZH-03 拆掉的东西）。
async function fetchWorldSettled(
  get: () => LiteState,
  contextId: string,
): Promise<LiveTeamPayload | null> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      return await withDeadline(get().transport.fetchTeam(contextId), 20_000)
    } catch {
      /* 一次没拿到不定罪——重试一发，第二发也空手才交给调用方定夺 */
    }
  }
  return null
}

function coerceMode(v: unknown): LiveExtractionMode | null {
  return v === 'llm' || v === 'degraded' || v === 'heuristic' ? v : null
}

// 轮询本体。每轮顺手把 `files` 写进 state——'reading' 行就是这么活着上屏的（FilesScreen
// 的表格实时长出「正在读取…」的行，这正是 #91 票面第 3 件事）。
async function pollIngestSettled(
  get: () => LiteState,
  set: (partial: Partial<LiteState>) => void,
  contextId: string,
  jobId: string,
): Promise<IngestSettle> {
  const deadline = Date.now() + INGEST_POLL_MAX_MS
  let misses = 0
  for (;;) {
    if (!stillOn(get, contextId)) return { outcome: 'stale' }
    let payload: LiveFilesPayload
    try {
      payload = await get().transport.fetchFiles(contextId)
      misses = 0
    } catch {
      misses += 1
      if (misses >= INGEST_POLL_MAX_MISSES) return { outcome: 'lost' }
      await sleepMs(INGEST_POLL_MS)
      continue
    }
    if (!stillOn(get, contextId)) return { outcome: 'stale' }
    set({ files: payload.files })
    const job = payload.last_job
    if (job && job.id === jobId) {
      if (job.status === 'failed') return { outcome: 'failed', reason: job.reason ?? null }
      if (job.status === 'done') return { outcome: 'ready', mode: coerceMode(job.extraction_mode) }
    } else if (!payload.files.some((f) => f.status === 'reading')) {
      // 摘要缺席（读摘要那一路在服务端挂了）或被更晚的任务顶掉——行都到终态就是落定。
      // 🔴 mode 给 null 不给 last_job 的值：那是**别人那趟**的标签，冒领=对着错误的一批报警。
      return { outcome: 'ready', mode: null }
    }
    if (Date.now() > deadline) return { outcome: 'lost' }
    await sleepMs(INGEST_POLL_MS)
  }
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
//     · 「打不开」那一族（#88 前是 switchContext，现在是 emptyArchive / deleteFile /
//       downloadFile）：真 404 被判成"没连上"，文案说「刚才没连上服务器…再试一次」——
//       服务器好得很，是凭据对不上，重试一万次也不会成。
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
  /**
   * #78 · 这一轮是从历史「场」里回灌出来的，不是本次现问的。
   *
   * 为什么要这一位而不是靠「run.lines 为空」之类推断：回灌轮**结构性缺过程态**
   * （原始流 / 四相 / 结构化引用 / 计数一个都没落库，0012 头注拍板不存），而四相全 pending
   * 在屏上会被 phaseMeta 渲染成 4×「待命」——对一条早就答完的记录那是纯假话。判别位让
   * 渲染层显式地少说话，而不是让读者从空数组里猜。缺席 = 本次现问的那种轮。
   */
  hydrated?: true
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
  // #76 · **引导路径自己**的状态机。只由 uploadFiles 写（而 #88 之后 uploadFiles 只在
  // 「还一份档案都没有」时才真开火，所以这一格描述的就是"铸出第一份档案"那一发）。
  //
  // 🔴 病根：`ingestStatus` 有四个写点，其中 restoreSession / refreshTeam / claimDemoTeam
  // 三个都会把它拨到 'ready'。上传面板读的若是那一格，回访者一进屏就**恒**显示
  // 「团队已就绪」+「取材自: 当前公司的文件 chips」——一个还没开火的上传口，常驻展示着
  // 上一次的就绪状态，与下面那份清单冗余且语义正好相反。
  // 🔴 为什么不去改那几个写点：`ingestStatus` 是约二十道门 `waitForFunction` 的等待锚
  //（file-manifest-truth / append-story / at-references / topbar-clearance…），
  // 少写一次不是一道门红，是整条电池挂在超时上。所以新开一格，老的一行不动。
  newCompanyStatus: IngestStatus
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
  // #76 · 清单自己的加载/失败态。此前 refreshFiles 静默吞错、本屏也不读 restoring，于是
  // 回访者第一帧、切库瞬间都会**闪一句**「Avery 没列出任何文件」，拉失败则永远停在旧值且
  // 屏上一个字都不说。🔴 别叫 filesBusy——那是 formsBusy（'idle'|'minting'）的语义，不同族。
  filesLoading: boolean
  filesError: string | null
  // #77 · 正在删的那一份的 source_key。**逐条**不整段（同 formsVoiding 的理由：整段置灰会
  // 让连删两份的第二下看起来像没反应）。
  fileDeleting: string | null
  fileDeleteError: string | null
  // #86 ·「清空这份档案」的忙/错两件。**整段**不逐条（与 fileDeleting 相反，理由也相反：
  // 清空只有一个目标，逐条置灰无意义；而它是销毁类，忙态期间整块必须锁死）。
  archiveEmptying: boolean
  archiveEmptyError: string | null
  // feat-047 移植（feat-033）「Avery's notes」：写侧、跨会话累积的 agent 自写观察（只读，
  // 新→旧，重启后仍在）。
  notes: LiveNoteEntry[]
  // advise 完成且后端确认新笔记落库 → Room 内出一次 nudge（丢弃则不出）。切屏即消。
  noteJustAdded: boolean
  // issue #49 · 议事室历史（只读、新→旧、重启后仍在）。null=尚未拉取/通道不可用（stub），
  // []=拉过确实为空——UI 据此区分「不渲染」与「诚实空态」。
  adviseRuns: LiveAdviseRunEntry[] | null
  // issue #78 · 同一份历史**按场分组**（场新→旧、场内按对话顺序）。三态语义与上面那条逐字
  // 相同：null=尚未拉取/通道不可用（stub 没有 fetchAdviseThreads），[]=拉过确实为空。
  // 🔴 这个区别不能被分组改坏：塌成一个空数组就会让 stub 通道冒出一个假的「空历史」面板。
  adviseThreads: LiveAdviseThread[] | null

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

  // #89 · 这份档案**最近一次抽取**是谁干的（后端两个写口发的 `extraction_mode`）。
  // null = 还不知道（这台机器上没传过东西，或者数据是 demo 克隆/恢复会话来的——那两条路
  // 根本没跑抽取，绝不许拿上一份的标签冒充）。
  // 🔴 'heuristic' 不是故障：那是「这台后端没配模型」的诚实态，屏上一个字都不该报警。
  //    只有 'degraded' 才上屏（配了模型但掉回了正则 → 卡片多半是空的，而用户不知道为什么）。
  extractionMode: LiveExtractionMode | null

  // #88 · `knownContexts` / `switchError` / `switchPending` 三格已随名册整条撤除（理由见
  // 文件头那段碑）。一台电脑恒 1 份档案，没有"切回上一份"这件事了。

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
  // #78 · 屏上这一场的 id（服务端铸、经 SSE 回传；也可能来自点开一条历史场）。
  // null = 还没有场（下一问会开新的一场）或后端没回传（老后端——那时界面老实地每问一场）。
  // 🔴 它跟着 `turns` 一起活一起死：clearTurns / resetRun / 换公司都要清。留着一个孤儿
  //    threadId 的后果是「屏上空白，续问却落进上一场」——用户看不见的错归档。
  threadId: string | null
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
  // #72 · manager 动过这张草稿没有（改过题面/增删题/点过受访者）。决定新一轮开跑时
  // 撤不撤卡：没动过的 draft 是上一问的过期提案，照旧撤；动过的草稿和已发出的卡
  // （shared/collecting/closed）是 manager 手上的活，追问不该杀掉它（progress.md Notes
  // 重裁拍板，#72 顺手落地）。
  askDirty: boolean

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
  // #88 · `switchContext` / `forgetContext` 已随名册整条撤除（理由见文件头那段碑）。
  // files-hub-0729/01 · 取回某一份原始文件的字节。**抛错不吞**——调用方（FileManifest 的
  // 每一行各自持一份 pending/error）负责把失败说给用户看。这里只做 contextId 收口：
  // 没有 contextId 就没有可下载的东西，压根不该有按钮（不建假按钮）。
  downloadFile: (idx: number) => Promise<Blob>
  // #77 · 删掉一份资料。按 **source_key** 寻址（idx 会被服务端 put() 重排，删完之后旧 idx
  // 静默指向另一份文件）。成功回 true；能力探测不到 / 忙 / 失败一律 false，**不抛**——
  // 逐行的错误由 fileDeleteError 说出来。
  deleteFile: (sourceKey: string) => Promise<boolean>
  /**
   * #86 ·「清空这份档案」—— 把上传来的一切收走，`contextId` / `ownerToken` **不变**。
   *
   * 这是 Danny 0810 拍板「不要有『新建』的概念」的落点：一个人从头到尾就一份档案，
   * 加文件、删文件；真要从头来是清空这一份。所以本动作**刻意不碰** `contextId`、
   * 也不碰 `ownerToken`——那两件一动就变回「另开一份」了。
   * （#88 把「另开一份」的入口整条撤掉之后，本动作成了**唯一**的从头来一遍。）
   *
   * 🔴 **不许走 `resetLiteCompanyData()` 凑数**：那是「换账号，全部忘掉」的清点，
   * 它不会去后端真清任何东西。屏上看起来一样，
   * 刷新一次数据全回来——那是"假装清空"，正是销毁类动作最不能有的形态。
   *
   * 成功回 true；能力探测不到 / 忙 / 失败一律 false，**不抛**——错误由
   * `archiveEmptyError` 说出来。调用方负责在此之前做硬确认（输入店名才放行）。
   */
  emptyArchive: () => Promise<boolean>
  refreshTeam: () => Promise<void>
  refreshFiles: () => Promise<void>
  refreshNotes: () => Promise<void>
  // issue #49 · 拉取议事室历史。transport.fetchAdviseRuns 可选（stub 无）——判空即无操作，
  // adviseRuns 停在 null，历史区整块不渲染（不出假空态）。
  refreshAdviseRuns: () => Promise<void>
  // issue #78 · 拉取按场分组的历史。transport.fetchAdviseThreads 可选（stub 无）——同上判空降级。
  refreshAdviseThreads: () => Promise<void>
  /**
   * issue #78 · 把一整场历史回灌进议事室（「打开这一场」），随后的续问落回同一个 thread_id。
   *
   * 三条政策拍板（票内定，见 .issues/redesign-0808/design-78-threads.md §2）：
   *   (a) **替换**当前 turns，不追加——追加会让 buildAdviseHistory 把两场不相干的对话缝进同
   *       一个 history 数组，而续问只能带一个 thread_id：屏上两场、落库一场，是结构性撒谎。
   *   (b) 尾轮还在跑时**拒绝**（自带 busy 闸——askLive 那道闸不覆盖这个新入口）。UI 另有一把
   *       disabled 锁；两把锁配两条判据，别指望一把。
   *   (c) 同一场**幂等**：threadId 已经是它就只滚动不重灌。这不只是防抖——用户可能已经在这
   *       场里续问过新轮，而手上的 adviseThreads 快照里还没有它们，重灌等于把刚问的抹掉。
   */
  hydrateThread: (thread: LiveAdviseThread) => void
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
  /** #75 · 停止在飞的这一轮，落成诚实的 `interrupted` 终态（不是销毁，屏上内容全留）。 */
  stopLive: () => void
  resetRun: () => void
  /** #71 · 清空会话流（离开议事室 / 换公司）。顺手中止在飞的那条流。 */
  clearTurns: () => void
  /**
   * issue #80 · 「新对话」——侧栏置顶那枚钮的 action。
   *
   * 🔴 为什么不裸复用 `clearTurns`：clearTurns 是**销毁类**（unmount cleanup 用它），
   *    刻意无闸；而这一枚是**用户可见入口**，#78 立的纪律是「新 action 自带 store 闸 +
   *    同步 run 尾轮镜像」。裸复用等于把闸全押在 UI 的 disabled 上——一把锁，
   *    而同一拍里的第二次 click 发生在 disabled 落到 DOM 之前（askLive/hydrateThread 同款教训）。
   *
   * 两条闸（各配一条独立判据，别指望一把）：
   *   · busy：尾轮还在跑就拒绝。被打断的那一轮**通常不落库**（无 manifest → 不调
   *     `_post_advise_hooks`），点下去等于「刚问的问题人间蒸发、历史里也找不回」——
   *     与「停止」（stopLive：停但留屏上）是两种销毁力度，票面拍板选禁点。
   *   · 幂等：本来就是空场（turns 空且没有 threadId）就什么都不做——别开出第二个空场堆叠。
   *
   * 后端零改动：threadId 清掉之后，下一问的 askLive 条件展开就**不带** `thread_id` 键，
   * 服务端据此自铸新场（absent≠none 纪律，见 askLive 里那段碑）。
   */
  newConversation: () => void

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
  newCompanyStatus: 'idle',
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
  filesLoading: false,
  filesError: null,
  fileDeleting: null,
  fileDeleteError: null,
  archiveEmptying: false,
  archiveEmptyError: null,
  notes: [],
  noteJustAdded: false,
  adviseRuns: null,
  adviseThreads: null,
  threadId: null,
  // 有锚点才算"正在恢复"——没有锚点是干净首访，直接进上传引导，不该转圈。
  restoring: restoredContextId !== null,
  restoreError: null,
  demoClaiming: false,
  demoClaimError: null,
  // #89 · 首帧就从 localStorage 取回（与 `restoredContextId` 同一拍、同一个理由）：警告必须
  // 熬过刷新。锚点不匹配时 loadStoredExtractionMode 自己返 null，不用在这儿再判一次。
  extractionMode: loadStoredExtractionMode(restoredContextId),

  turns: [],
  run: emptyRunState(),
  agentSource: createLiveAgentSource(defaultTransport),
  _abort: null,

  projectWriteBusy: false,
  projectWriteError: null,

  ask: null,
  askBusy: 'idle',
  askError: null,
  askDirty: false,

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

  // #88 · **引导路径**——这条路只在「这台电脑还一份档案都没有」时开火。
  //
  // 它曾经是「再传一次 = 另开一家公司」的正主：`POST /ingest` 每次新铸 context_id +
  // owner_token，第二次上传就把第一份从界面上抹掉。Danny 0810 拍板「不要有『新建』的想法」
  // 之后，那个语义整条撤了——已经有档案时一律**补进这一份**（`appendFiles`）。
  //
  // 🔴 闸为什么在 store 里而不在四个调用点上（`OnboardGate.StepUpload` / 首页骨架的上传卡 /
  //    资料库工具条 / `UploadPanel`）：前两个是**全新用户铸出档案的那条路**，不能连根拔，
  //    于是它们照旧调 `uploadFiles`。真正决定方向的是「此刻有没有档案」，那个事实只有
  //    store 手上有。放在 UI 上就是四把尺，其中任何一把漂一次的代价都是**又新铸一个
  //    context** —— 旧那份的 owner_token 服务端只返一次、已被覆盖 = 永久无人能认领。
  //    实测够得着的一条：向导里传成功一次（contextId 落地，向导刻意不关，见 OnboardGate
  //    那段「不响应式读 contextId」的碑）→ 用户翻回①上传步再传一次 → 旧代码当场开出第二家。
  //
  // 🔴 委托给 `appendFiles` 而不是在这里就地补料：那条路自己有重入闸、自己的状态机、
  //    自己的身份复核（`stillOn`），抄一份出来就是第二把尺。也正因为委托，
  //    `ingestStatus` 这一格**不会**被拨到 `ingesting→ready`——`notifyStore` 靠那一跳
  //    合成「你的团队已就绪」，补料每次都报一条「团队已就绪」就是假通知。
  uploadFiles: async (files) => {
    if (files.length === 0) return
    if (get().contextId !== null) {
      await get().appendFiles(files)
      return
    }
    // #91 · 重入闸落进 store 临界区（appendFiles 早有同款；此前只有 UI 层的 disabled/openPicker
    // 封口——OnboardGate 那段碑明写「本波只在 UI 层封口（store.ts 归他人所有）」，现在 store
    // 归本票所有，把欠的这一道补上）。deposit 窗口内的第二发 /ingest 仍然是双 context 事故：
    // 每发新铸 context+token，后落地的覆盖 store，先前那个 token 服务端只返一次=永久丢失。
    if (get().newCompanyStatus === 'ingesting') return
    // #76 · 两格一起拨：老的那格是二十道门的等待锚（不许动），新的那格只服务引导路径自己
    // （它不该被 restoreSession/refreshTeam 的 'ready' 顺手点亮）。
    set({ ingestStatus: 'ingesting', newCompanyStatus: 'ingesting', ingestError: null })
    try {
      const payload = await get().transport.ingest(files)
      // 🔴 先过 adoptContext 这个收口，再写本次的数据（fixD 复核 · 新 finding 3）。
      //
      // 原来这里是裸 `set({ contextId: payload.context_id, team, rawTeam, ownerToken })`，
      // 绕开了同一个 commit 刚刚确立的收口。代价是**漏清 notes**：`refreshNotes` 不调、也不
      // 清空，于是上一份的「Avery's notes」原文原封不动挂在新的 contextId 底下，
      // NotesScreen 直接渲染给新公司的经理看。#88 之后这条路一辈子只跑一次（`contextId`
      // 为 null 才进得来），但收口一条都不许绕——`adoptContext` 同时还落 localStorage 锚点，
      // 绕开它就是「刷新一次数据全丢」。
      //
      // #90/#91 · adopt 挪到了**deposit 秒回的当下**（不再等抽取）：owner_token 与锚点当场
      // 持久化——0812 的暗伤①′（首传断连=token 死在 socket 里、档案永久孤儿化）就是这一步
      // 治好的。此刻起哪怕轮询全断、页面关掉，档案都找得回来。
      //
      // adoptContext 在 id 变了时清 team/rawTeam/files/notes/ingestStatus，所以顺序必须是
      // 先 adopt 后写数据 —— 反过来会被它当场清掉本次刚拿到的东西。
      get().adoptContext(payload.context_id, payload.owner_token ?? null)
      if (payload.job) {
        // ── 异步世界（#90 后端）：deposit 回执是空骨架，**不许当终态渲染**。────────────
        // 状态机停在 'ingesting'（忙态覆盖到轮询落定，防双击闸/秒表/门的等待锚全靠它），
        // 轮询期间 'reading' 行经 pollIngestSettled 写进 files 实时上屏。
        const settled = await pollIngestSettled(get, set, payload.context_id, payload.job.id)
        if (settled.outcome === 'stale') {
          // contextId 已被换掉：adoptContext 的公司域清理早已把两条状态机拨回 idle，
          // 这里一个字段都不写（写了就是把 A 的结局挂到 B 头上）。
          return
        }
        if (settled.outcome === 'failed' || settled.outcome === 'lost') {
          set({
            ingestStatus: 'error',
            newCompanyStatus: 'error',
            ingestError:
              settled.outcome === 'failed'
                ? jobFailedMessage(settled.reason)
                : getDict(activeLocale()).transport.depositTimeout,
          })
          return
        }
        // 落定 → 取权威世界。🔴 team 与 'ready' 必须同一次 set 落地：门电池等 'ready' 再读
        // team，先翻牌后填数会让「提前翻牌」以最难复现的形态漏出去。
        // #89 · 抽取标签写在 adoptContext 之后（收口在 id 变了时会清它），值来自**本次任务**
        // 的 last_job.extraction_mode——POST 回执从 #90 起不再携带它。
        const world = await fetchWorldSettled(get, payload.context_id)
        if (!stillOn(get, payload.context_id)) return
        if (world === null) {
          // 读完了、结果却拉不回来。诚实说「刷新看看」——refreshTeam/restoreSession 都能接上。
          set({
            ingestStatus: 'error',
            newCompanyStatus: 'error',
            ingestError: getDict(activeLocale()).transport.depositTimeout,
          })
          return
        }
        rememberExtractionMode(payload.context_id, settled.mode)
        set({
          ingestStatus: 'ready',
          newCompanyStatus: 'ready',
          team: liteTeamFromPayload(world),
          rawTeam: world,
          extractionMode: settled.mode,
          // 上传成功即"有会话了"——把上一轮失败的恢复提示清掉。
          restoring: false,
          restoreError: null,
        })
        // files 已由最后一轮 poll 写成终态；notes 是这一份自己的，拉回来（多半为空）。
        void get().refreshNotes()
        return
      }
      // ── 同步世界（stub / 老后端）：回执就是终态，路径与 #90 之前逐字节相同。──────────
      // #89 · 抽取标签必须写在 adoptContext **之后**：那个收口在 id 变了时会把它清成 null
      //（新档案不许继承上一份的标签），写在前面会被它当场抹掉。
      rememberExtractionMode(payload.context_id, payload.extraction_mode ?? null)
      set({
        ingestStatus: 'ready',
        newCompanyStatus: 'ready',
        team: liteTeamFromPayload(payload),
        rawTeam: payload,
        extractionMode: payload.extraction_mode ?? null,
        // 上传成功即"有会话了"——把上一轮失败的恢复提示清掉。
        restoring: false,
        restoreError: null,
      })
      // feat-047（feat-032）：拉一次持久文件清单（含 n_chunks）。次要视图，失败不影响上传成功。
      // notes 同理——adoptContext 已经把上一份的清空了，这里把**这一份自己的**拉回来
      //（新 context 多半是空的；真为空时拉一次的结果也是空，不会凭空造出内容）。
      void get().refreshFiles()
      void get().refreshNotes()
    } catch (err) {
      set({
        ingestStatus: 'error',
        newCompanyStatus: 'error',
        ingestError: err instanceof Error ? err.message : String(err),
      })
    }
  },

  // T10 · 补资料 —— 与 uploadFiles 是**两条路**，差别都在下面这几行里，不是文案差别：
  //   ① 不调 adoptContext。那个收口在 contextId 变了时会清掉 team/files/notes/forms——正是
  //      「每次上传=新开一家公司」那堵墙的前端半边。补资料的 context_id 没变，一个字都不该清。
  //   ② 不铸新 id。没有新公司诞生——#88 之后这已经是这个应用**唯一**的上传语义，
  //      引导路径（`uploadFiles`）跑完那一次之后每一发都落到这里。
  //   ③ 不碰 ownerToken。服务端没有新铸，也没回传。
  //   ④ 走自己的状态机（见 LiteState 里那段 🔴：借 ingestStatus 会发一条假的「团队已就绪」通知）。
  appendFiles: async (files) => {
    if (files.length === 0) return
    const { transport, contextId, appendStatus } = get()
    const append = transport.appendFiles
    // #73 · 重入闸放在 store 的临界区上，不只在 UI 上（同 askLive / createFormLinks 的教训：
    // React 的 disabled 要等一次重渲染才落到 DOM，同一拍里的第二次触发发生在那之前）。
    // 议事室 composer 的附件键是这条路的**第二个入口**，此前只有资料库那一个入口、
    // 靠 UI 封口就够；两个入口之后不封在 store 里，就是两趟并发写同一个 context。
    if (appendStatus === 'ingesting') return
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
      if (payload.job) {
        // ── 异步世界（#90 后端）：deposit 秒回的是旧世界 + 'reading' 行，**不许当终态渲染**
        // （旧世界当场落 team 会把「补传中」演成「什么都没变」，任务失败后再回滚更是谎上加谎）。
        // 状态机停在 'ingesting' 直到轮询落定——notifyStore 不订阅 appendStatus，这条路本来
        // 就没有通知；防双击闸（appendStatus==='ingesting' 的重入闸 + UI anyBusy）靠忙态
        // 覆盖整个窗口。每轮 poll 自带 stillOn（pollIngestSettled 内部）。
        const settled = await pollIngestSettled(get, set, contextId, payload.job.id)
        if (settled.outcome === 'stale') {
          set({ appendStatus: 'idle' })
          return
        }
        if (settled.outcome === 'failed' || settled.outcome === 'lost') {
          // 🔴 失败时回执一并不留：deposit 回执说「这次新增了 X」，而那批行已被服务端收走
          //    ——留着它就是对着一次失败展示一份成功清单。
          set({
            appendStatus: 'error',
            appendError:
              settled.outcome === 'failed'
                ? jobFailedMessage(settled.reason)
                : getDict(activeLocale()).transport.depositTimeout,
          })
          return
        }
        const world = await fetchWorldSettled(get, contextId)
        if (!stillOn(get, contextId)) {
          set({ appendStatus: 'idle' })
          return
        }
        if (world === null) {
          set({
            appendStatus: 'error',
            appendError: getDict(activeLocale()).transport.depositTimeout,
          })
          return
        }
        // #89 · 这一趟的标签**覆盖**上一趟的（值来自本次任务的 last_job.extraction_mode——
        // POST 回执从 #90 起不再携带）。刚补的读懂了就不该继续挂警告，反过来也必须立刻说。
        rememberExtractionMode(contextId, settled.mode)
        set({
          appendStatus: 'ready',
          appendError: null,
          // 回执用 deposit 那份：documents（这次收下的 key）+ skipped_identical（库里已有的）。
          // 到这里任务已 done，「已收下待读取」升格成「已读完」，给用户看语义不变。
          appendReceipt: payload.appended ?? null,
          extractionMode: settled.mode,
          // 卡片与 'ready' 同一次 set 落地（同 uploadFiles 那条「不许提前翻牌」的碑）。
          team: liteTeamFromPayload(world),
          rawTeam: world,
        })
        return
      }
      // ── 同步世界（stub / 老后端 / #90 的「整批全是库里已有字节」不入队路）：回执即终态。──
      // #89 · 抽取标签**只在键在场时**动（absent≠none）：全 identical 那一路没跑抽取，
      // 回执里没有这个键——把它读成「清掉警告」就是让一次无害的重传抹掉一条还成立的警告。
      if (payload.extraction_mode !== undefined) {
        rememberExtractionMode(contextId, payload.extraction_mode ?? null)
      }
      set({
        appendStatus: 'ready',
        appendError: null,
        appendReceipt: payload.appended ?? null,
        ...(payload.extraction_mode !== undefined
          ? { extractionMode: payload.extraction_mode ?? null }
          : {}),
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
      })
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
        // 🔴 松的**只有锚点**，`lite2:ownerTokens:v1` 里那把钥匙一个字节都不动。404 什么都
        // 证明不了：feat-038 刻意让"不存在"和"你证明不了这是你的"同样返 404（不给存在性
        // oracle），token 错配、以及 DB 里 owner_token 为空的旧 context，都会让**真正的
        // 主人**吃到 404。拿一次我方无法解释的失败去销毁凭据，代价完全不对等——
        // 锚点是可再生的（下次登录恢复会把它送回来），钥匙不是（服务端只返一次）。
        // （#88 之前这段碑说的是"名册不动"，名册已随单档案模型撤除，纪律本身没变。）
        rememberContextId(null)
        set({
          contextId: null,
          ownerToken: null,
          team: null,
          rawTeam: null,
          files: [],
          // #76/#77 · 文件族的忙/错四件同属公司域（理由与下面表单那两条逐字相同：
          // filesError 是「A 那次清单为什么没拉到」，挂到 B 头上是替 B 断言一件没发生的事；
          // filesLoading / fileDeleting 漏了则「刷新/删除途中切公司」会把那颗键永久置灰）。
          filesLoading: false,
          filesError: null,
          fileDeleting: null,
          fileDeleteError: null,
          // #86 · 清空那两件同属公司域（理由与上面 fileDeleting/filesError 逐字相同：
          // archiveEmptyError 是「A 那次清空为什么没成」，挂到 B 头上是替 B 断言一件没发生
          // 的事；archiveEmptying 漏了则「清空途中切公司」会把那颗键永久置灰）。
          archiveEmptying: false,
          archiveEmptyError: null,
          newCompanyStatus: 'idle',
          notes: [],
          adviseRuns: null,
          // #78 · 历史的分组视图与「屏上这一场」同属公司域。threadId 留着就是把 A 公司的
          // 场 id 带进 B 公司——续问会落进一个不属于这家公司的场（分组读按 context 收口，
          // 所以不会串数据，但那一行会在 B 公司下凭空长出一个同名的场）。
          adviseThreads: null,
          threadId: null,
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
            // #78 · 历史分组 + 屏上这一场的 id（同上面 404 分支那份的理由，逐字适用）。
            adviseThreads: null, threadId: null,
            // #76/#77 · 文件族忙/错四件（同下面表单那份的理由，逐字适用）。
            filesLoading: false, filesError: null,
            fileDeleting: null, fileDeleteError: null,
            // #86 · 清空那两件（同上，逐字适用）。
            archiveEmptying: false, archiveEmptyError: null,
            newCompanyStatus: 'idle' as IngestStatus,
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
            // #72 · 快问卡四件同属公司域（本清单的注释一直点名 ask，实际一直漏——此前被
            // 「askLive 开跑即撤卡」掩着；撤卡改成保护式后，A 公司的问卷草稿/回执卡会活到
            // 切进 B 公司之后，必须在这儿清）。
            ask: null, askBusy: 'idle' as const, askError: null, askDirty: false,
            ingestStatus: 'idle' as IngestStatus,
            // T10：补资料那一组同属公司域（「A 公司那次补传为什么没成」挂到 B 头上，
            // 就是替 B 断言一件没发生的事——与上面 formsError 逐字同一条理由）。
            appendStatus: 'idle' as IngestStatus, appendError: null, appendReceipt: null,
            // #89 · 抽取标签同属公司域：换了档案就不知道新这份是谁抽的（demo 克隆 / 恢复会话
            // 这两条路根本没跑抽取），留着上一份的标签就是替新档案断言一件没发生的事。
            extractionMode: null }
        : {}),
    })
  },

  // files-hub-0729/01 · 逐份下载。
  //
  // 🔴 刻意**不写任何 state**：下载是一次性动作，不是屏上的一份状态。每行自己的
  // pending/error 活在 FileManifest 的组件局部（一行失败不该让另一行也变红），
  // 而"这次取回了什么字节"根本不该进 store —— 文件内容是不可信的用户内容，
  // 让它在全局 state 里躺着只会多一处可被误渲染的地方。
  //
  // 🔴 抛错不吞：下不下来要说出来，绝不静默失败（同 deleteFile / emptyArchive 那条纪律）。
  downloadFile: async (idx) => {
    const { contextId, transport } = get()
    if (!contextId) throw new Error('no context')
    return await transport.downloadFile(contextId, idx)
  },

  // 下面三个 refresh 全部带同一道 `stillOn` 闸（fixD 复核 · 新 finding 1 的同族）：
  // 它们各自 await 期间 contextId 都可能被切走（AuthPanel 的登录恢复就是 adoptContext(first)
  // 紧跟 refreshTeam + refreshNotes，与用户手点切换天然并发）。少一道闸，"A 的人/文件/笔记
  // 落在 B 的 id 底下"就照样成立——#88 撤掉 switchContext 之后入口就是这三个。
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
    // #76 · 同一拍双击闸在 store 临界区上（UI 的 disabled 要等一次重渲染才落到 DOM，
    // 挡不住同一拍的第二下——同 createFormLinks 那条碑）。手动刷新钮就骑在这上面。
    if (get().filesLoading) return
    set({ filesLoading: true, filesError: null })
    try {
      const payload = await transport.fetchFiles(contextId)
      // 过期结果一个字段都不写，但**忙态必须放开**（formsBusy 那次高危同款坑）。
      if (!stillOn(get, contextId)) {
        set({ filesLoading: false })
        return
      }
      set({ files: payload.files, filesLoading: false, filesError: null })
    } catch {
      // 文件清单是次要回看视图——拉取失败不该打断主流程（team 已就绪），所以这里**仍然只 set
      // 不 throw**（live-frontend-gate 的 tokenDiscipline 相位故意拿坏 token 调它，抛一条就红）。
      // 🔴 但也**绝不清空 files**：清单停在旧值 + 屏上一句诚实说明，比当场变空好——那道门
      // 断言的就是 `files.length` 不变。变的只是「屏上从此有一句话」。
      if (!stillOn(get, contextId)) {
        set({ filesLoading: false })
        return
      }
      set({ filesLoading: false, filesError: 'failed' })
    }
  },

  // #77 · 删掉一份资料。骨架照 voidFormLink（逐条忙态 + 回权威清单 + 切公司必回收忙态）。
  deleteFile: async (sourceKey) => {
    const { contextId, transport } = get()
    if (!contextId || !transport.deleteFile || !sourceKey) return false
    // 同一拍双击闸：这个端点不幂等（第二发是对一个已经不存在的 key 删，回 404 报错），
    // 而且删除是销毁类——宁可少走一次，不可多走一次。
    if (get().fileDeleting) return false
    set({ fileDeleting: sourceKey, fileDeleteError: null })
    try {
      await transport.deleteFile(contextId, sourceKey)
      if (!stillOn(get, contextId)) {
        set({ fileDeleting: null })
        return false
      }
      set({ fileDeleting: null, fileDeleteError: null })
      // 🔴 必须 await 不是 void：FileManifest 的下载与 FormBuilder 的起草都持 **idx**，
      // 而服务端删完会重排 idx——刷新落地之前，屏上每一个旧 idx 都指着另一份文件。
      await get().refreshFiles()
      // facts 重物化之后卡片上的出处会变，团队面也要回权威值（回执里其实带了整张 payload，
      // 但走 refreshTeam 这一条是既有的唯一入口，少一处口径）。
      void get().refreshTeam()
      return true
    } catch {
      if (!stillOn(get, contextId)) {
        set({ fileDeleting: null })
        return false
      }
      // 🔴 措辞不许说「文件没了」：那个端点把「没有这份」和「你证明不了这是你的」编成同一个
      // 404，前端一种都分不出来（同 downloadError / restoreError 那条「404 什么都证明不了」）。
      set({ fileDeleting: null, fileDeleteError: sourceKey })
      return false
    }
  },

  // #86 ·「清空这份档案」。骨架照 deleteFile（忙态 + 回权威清单 + 切公司必回收忙态），
  // 四处刻意不同：
  //   ① **绝不动 contextId / ownerToken** —— 动了就是「另开一份」，
  //      而这一票的全部内容就是把「新建」这个概念取消掉；
  //   ② 忙态整段不逐条（只有一个目标）；
  //   ③ 回执里那张空 payload **就地用掉**（team/rawTeam 直接落它），不等 refreshTeam ——
  //      清空是销毁类，屏上不该有「清单已空、卡片还挂着上一秒的人」这个中间帧；
  //   ④ 顺手把 notes / forms **重拉一遍**：后端刻意保留了它们，本地必须回权威值，
  //      否则用户会以为「清空把笔记也清了」（那正是确认文案里承诺没清的东西）。
  emptyArchive: async () => {
    const { contextId, transport } = get()
    if (!contextId || !transport.emptyContext) return false
    // 同一拍双击闸。这个端点**是幂等的**（第二发同样回一张空 payload），所以这道闸不为
    // 正确性，只为不让销毁类动作被手抖连点发两次。
    if (get().archiveEmptying) return false
    set({ archiveEmptying: true, archiveEmptyError: null })
    try {
      const payload = await transport.emptyContext(contextId)
      if (!stillOn(get, contextId)) {
        set({ archiveEmptying: false })
        return false
      }
      set({
        archiveEmptying: false,
        archiveEmptyError: null,
        // 权威空世界就地落地（见 ③）。context_id 恒等于入参——真不等就说明后端换了档案，
        // 那是本票明令不该发生的事，让它以「屏和 store 对不上」的形态露出来，别在这儿掩盖。
        team: liteTeamFromPayload(payload),
        rawTeam: payload,
        files: [],
        // 清空之后再没有「这次补料失败了」这种话可说——那句话的对象已经不存在了。
        appendStatus: 'idle',
        appendError: null,
        appendReceipt: null,
        fileDeleteError: null,
        // #89 · 同一条理由：文件全没了，「那次抽取降级了」也就没有了对象。
        // 🔴 `emptyArchive` **不换 context_id**，所以 adoptContext 那条清理路径这里不会跑——
        //    必须在这儿自己清，否则崭新的空档案上会挂着一句关于不存在之事的警告。
        extractionMode: null,
      })
      rememberExtractionMode(contextId, null)
      // 权威清单（服务端说了算，别信本地推断出来的空）。
      await get().refreshFiles()
      // 后端留着的那两族，本地回权威值（见 ④）。失败不影响清空本身，故 void。
      void get().refreshNotes()
      void get().refreshForms()
      return true
    } catch (err) {
      if (!stillOn(get, contextId)) {
        set({ archiveEmptying: false })
        return false
      }
      // 🔴 措辞不许说「档案没了」：那个端点把「没有这份」和「你证明不了这是你的」编成同一个
      // 404，前端一种都分不出来（同 fileDeleteError / restoreError 那条「404 什么都证明不了」）。
      set({
        archiveEmptying: false,
        archiveEmptyError: err instanceof Error ? err.message : String(err),
      })
      return false
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

  // issue #78 · 按场分组的历史——同骨架。⚠ 空历史一定来自 200 + `threads: []`；这里 catch
  // 到的 404 只意味着 token 缺/错，绝不许被读成「没有历史」（那会把登录失效显示成没问过）。
  refreshAdviseThreads: async () => {
    const { contextId, transport } = get()
    if (!contextId || !transport.fetchAdviseThreads) return
    try {
      const payload = await transport.fetchAdviseThreads(contextId)
      if (!stillOn(get, contextId)) return
      set({ adviseThreads: payload.threads })
    } catch {
      // 同上：停在上一次的值，不伪造空态。
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
  // 才落到 DOM 上，同一拍里的第二次 click 发生在那之前（这条教训是 #88 撤掉的那道
  // verify-context-switch 门用「同一拍连点两下」逮到的）。而这个端点**不幂等**——第二发不是
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
    const { agentSource, contextId, notes, turns } = get()
    // #72 · busy 闸在 store 的临界区上，不只在 UI 的 disabled 上：React 的 disabled 要等一次
    // 重渲染才落到 DOM，同一拍里的第二次 click（发送键/追问 chip 双击）发生在那之前——
    // createFormLinks / appendFiles 同款教训。上一轮还在流就静默丢弃这一发（UI 层本来
    // 就置灰了，走到这儿的只能是同一拍的重复触发）。
    const tail = turns[turns.length - 1]
    if (tail && tail.run.status === 'running') return
    // 中止在飞的那条流（`_abort` 在 run 落定后不会自己归 null，对已收尾的流是无操作）。
    // 🔴 上面的 busy 闸挡掉了"打断上一轮"这条路；这一发留着是给 error 终局后的收尾兜底，
    //    别当成"支持中途换问题"的实现。
    get()._abort?.()
    const notesBefore = notes.length
    // #72 · 撤卡重裁（progress.md Notes）：**没动过的 draft** 才随新一轮退场（它是上一问的
    // 过期提案）；manager 动过的草稿（askDirty）和已发出的卡（shared/collecting——链接可能
    // 还没粘完；closed——回执还在看）都不撤。追问 chips 让"回答完马上再问"成了常态，
    // 不该每问一次就杀掉 manager 手上正要发的问卷。
    const currentAsk = get().ask
    const askProtected =
      currentAsk !== null && (currentAsk.status !== 'draft' || get().askDirty)
    // 🔴 history 从**已落定且真答出东西**的前几轮组装（askHistory.buildAdviseHistory）。
    //    组装点在这里而不是调用方：屏底 composer、空态建议 chips、将来的建议追问 chips
    //    是三个入口，逐个记得带上下文＝给"新入口忘了带"留位置（同 withLocale 的一处补全）。
    const history = buildAdviseHistory(turns)
    // #78 · 这一问接在哪一场后面。收在这里的理由与 history 逐字相同：三个入口（屏底 composer、
    // 空态建议 chips、追问 chips）逐个记得带＝给「新入口忘了带」留位置。缺席就是开新的一场。
    const threadId = get().threadId
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
      noteJustAdded: false,
      ...(askProtected ? {} : { ask: null, askBusy: 'idle', askError: null, askDirty: false }),
    })
    let settled = false
    const handle = agentSource.run(
      {
        ...req,
        company_context_id: req.company_context_id ?? contextId ?? undefined,
        // additive optional：第一问（history 为 undefined）请求体里**没有这个键**。
        ...(history ? { history } : {}),
        // #78 · 同款条件展开，**不是** `thread_id: threadId ?? undefined`：JSON.stringify 会丢
        // undefined 但会**原样发出 null**，写成 `?? null` 就在请求体里多送一个 null 键，
        // 违反 absent≠none 的纪律（also：第一问不带这个键是门 ④ 那一族判据的形状）。
        ...(threadId ? { thread_id: threadId } : {}),
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
          // #72 · 收养同样让位于保护中的卡：manager 动过的草稿/已发出的卡不被新提案顶掉
          //（顶掉和撤掉是同一种销毁）。新提案这时静默丢弃——一次只有一张活体卡。
          const current = get().ask
          const currentProtected =
            current !== null && (current.status !== 'draft' || get().askDirty)
          const adopt = state.askDraft && !currentProtected &&
            (!current || current.id !== state.askDraft.id)
          // #78 · 服务端回传的场 id 上提到 store（下一问靠它落回同一场）。
          // 只认尾轮、且只在还没有值时认：旧轮的末帧不该把当前这场改名，而一旦有了 id
          // 就固定下来（服务端对同一场恒回同一个值，这里不该跟着每帧抖动）。
          const echoed = state.threadId
          const threadPatch =
            idx === next.length - 1 && echoed && get().threadId !== echoed
              ? { threadId: echoed }
              : {}
          set(
            // `run` 是尾轮镜像：只有当这一轮就是尾轮时才同步（旧轮收尾不该把界面拉回去）。
            idx === next.length - 1
              ? adopt
                ? { turns: next, run: state, ask: state.askDraft, askDirty: false, ...threadPatch }
                : { turns: next, run: state, ...threadPatch }
              : adopt
                ? { turns: next, ask: state.askDraft, askDirty: false }
                : { turns: next },
          )
        }
        // 一次 advise 落定后：拉一次笔记，**后端确认新笔记落库**（计数增长）才亮 nudge——
        // 观察被红线门丢弃时后端不落库、计数不变、nudge 不出（诚实降级，不显占位）。
        // #75 · interrupted 也算落定：不加它的话 settled 永不置位、latch 常开、
        // 这一轮的 fetchNotes 永远不触发（被砍那一轮也可能已经在服务端落了笔记）。
        if (
          !settled &&
          (state.status === 'complete' || state.status === 'error' || state.status === 'interrupted')
        ) {
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

  // #75 · 停止生成。与 clearTurns/resetRun 的区别：那两个是**销毁**这场对话，
  // 这个只是把在飞的这一轮落成诚实的 interrupted 终态——问题行、已经流出来的分析过程、
  // 部分引用全都留在屏上，因为它们是真发生过的。
  // 🔴 `_abort` 现在指向 createLiveAgentSource 的包装版：它会先把 run 落成 interrupted
  //    再往下砍传输层，所以这里一发就够，不需要在 store 里再写一次状态（写第二遍反而会
  //    与流回调按 turn.id 认领的那条路抢写）。
  stopLive: () => {
    const { turns } = get()
    const tail = turns[turns.length - 1]
    if (!tail || tail.run.status !== 'running') return
    get()._abort?.()
  },

  // #78 · 打开一整场历史。政策拍板见 LiteState 上那段 doc（替换 / 禁点 / 幂等）。
  hydrateThread: (thread) => {
    const { turns, threadId } = get()
    // 锁②（store 级 busy 闸）——UI 那把 disabled 是锁①。两把锁不是一把锁加一层：
    // disabled 要等一次重渲染才落到 DOM，同一拍里的第二次 click 发生在那之前（同 askLive
    // 的 #72 教训）。⚠ 两把锁必须配两条独立判据，否则外层那把会让内层免疫变异。
    const tail = turns[turns.length - 1]
    if (tail && tail.run.status === 'running') return
    const key = thread.thread_id || thread.runs[0]?.id || ''
    if (!key || thread.runs.length === 0) return
    // 幂等（政策 c）：已经在这一场里就什么都不做。**尤其不能重灌**——用户可能已经在这场里
    // 续问过新轮，而手上这份 adviseThreads 快照是上一次拉的，重灌会把刚问的那几轮抹掉。
    if (threadId && threadId === thread.thread_id && turns.length > 0) return
    get()._abort?.()
    const hydrated: LiveTurn[] = thread.runs.map((entry) => ({
      id: nextTurnId(),
      question: entry.question,
      // 🔴 refs 结构性没落库（0012 拍板不存），回灌轮天然没有引用 chips 行——这是缺失，
      //    不是"这一轮没引用"。别在这里编一个空数组之外的东西。
      refs: null,
      hydrated: true,
      run: {
        ...emptyRunState(),
        // 只有成品才进得了库（服务端写门：redline_passed + 有产出才落行），所以 complete
        // 是有据的，不是乐观假设。⚠ 它同时是四相封 done 的前提（refreshPhases 只对
        // complete 封），而回灌轮压根不渲染四相——两者不矛盾：状态诚实，渲染层少说话。
        status: 'complete' as const,
        advice: coerceAdvice(entry.advice),
        answer: entry.answer || null,
        // #72 chips：advice 路的追问**存在 jsonb 里**、可以恢复；短答路的后端根本没存
        //（app.py 只取 answer.text）。所以历史场的尾轮 advice 路会出 chips、短答路不会——
        // 这条不对称是真实的存储差异，不是 bug（票内裁：不为它再加一列，见 design §3.6）。
        followups: coerceFollowups(
          (entry.advice as Record<string, unknown> | null | undefined)?.followup_questions),
        redlinePassed: true,
        threadId: thread.thread_id || null,
      },
    }))
    set({
      turns: hydrated,
      // 尾轮镜像必须跟着走：十道门与 notifyStore 读的是这个顶层 run。不同步的话它会停在
      // idle，而屏上明明有一场答完的对话——镜像与真相不符是这套设计最贵的那种 bug。
      run: hydrated[hydrated.length - 1].run,
      // 空串（无场归属的存量单轮）**不当作场**：它续问时该开一场新的，不该把空串发上去。
      threadId: thread.thread_id || null,
      _abort: null,
      noteJustAdded: false,
      ask: null,
      askBusy: 'idle',
      askError: null,
      askDirty: false,
    })
  },

  resetRun: () => {
    get()._abort?.()
    set({
      turns: [],
      run: emptyRunState(),
      threadId: null,
      _abort: null,
      ask: null,
      askBusy: 'idle',
      askError: null,
      askDirty: false,
    })
  },

  // #71 · 离开议事室 / 换公司即散场。turns 是本场对话的**全部**载体，清它就等于结束对话
  // （没有第二份拷贝在 localStorage 或库里等着复活——这是拍板的刻意设计）。
  // #72 · ask 卡随对话一起散场：此前不清是被「askLive 开跑即撤卡」掩着的——撤卡改成
  // 保护式之后，不在这儿清的话，上一场对话的卡会挂到下一场对话的第一轮底下（假的"此刻"）。
  // #78 · threadId 跟着一起清：留一个孤儿 threadId 的后果是「屏上空白、下一问却落进上一场」
  // ——一次用户看不见的错归档。这也保住了 verify-room-conversation ⑥「离开议事室=这场对话
  // 结束」那条既有判据：回来是干净的空态，不自动恢复任何一场。
  clearTurns: () => {
    get()._abort?.()
    set({ turns: [], run: emptyRunState(), threadId: null, _abort: null,
      ask: null, askBusy: 'idle', askError: null, askDirty: false })
  },

  // issue #80 · 「新对话」。政策拍板见 LiteState 上那段 doc（禁点 / 幂等 / 后端零改动）。
  newConversation: () => {
    const { turns, threadId } = get()
    // 锁②（store 级 busy 闸）——UI 那把 disabled 是锁①。两把锁不是一把锁加一层：disabled
    // 要等一次重渲染才落到 DOM，同一拍里的第二次 click 发生在那之前。
    // ⚠ 两把锁必须配两条独立判据，否则外层那把会让内层免疫变异（#78 M-C 的教训）。
    const tail = turns[turns.length - 1]
    if (tail && tail.run.status === 'running') return
    // 幂等：已经是一场空的新对话，什么都不做。判据取 turns 与 threadId 的**并**——
    // 只看 turns 会漏掉「hydrate 过一场又被清空」留下的孤儿 threadId。
    if (turns.length === 0 && threadId === null) return
    get()._abort?.()
    set({
      turns: [],
      // 尾轮镜像跟着走：十道门与 notifyStore 读的是这个顶层 run（turns 空时它就是 emptyRunState）。
      run: emptyRunState(),
      threadId: null,
      _abort: null,
      // 这条 nudge 属于刚被散掉的那场对话（「刚刚那一轮落了新笔记」）。留着它，
      // 新对话第一屏就会挂一句关于上一场的瞬态提示——那是假的「此刻」。
      // clearTurns 不清它是因为离开议事室那条路上另有 clearNoteNudge 兜着；这枚钮不换屏，没人兜。
      noteJustAdded: false,
      ask: null,
      askBusy: 'idle',
      askError: null,
      askDirty: false,
    })
  },

  // ── Ask 草稿态编辑（只在 draft 生效——shared 之后题目/受访者即定格）──────────────
  // #72 · 四个编辑动作都标 askDirty：manager 一动手，这张草稿就从"上一问的过期提案"
  // 变成"他手上的活"，新一轮开跑不再撤它（见 askLive 里那段）。
  editAskQuestion: (questionId, text) => {
    const { ask } = get()
    if (!ask || ask.status !== 'draft') return
    set({
      ask: {
        ...ask,
        questions: ask.questions.map((q) => (q.id === questionId ? { ...q, text } : q)),
      },
      askDirty: true,
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
      askDirty: true,
    })
  },

  removeAskQuestion: (questionId) => {
    const { ask } = get()
    if (!ask || ask.status !== 'draft' || ask.questions.length <= 1) return
    set({
      ask: { ...ask, questions: ask.questions.filter((q) => q.id !== questionId) },
      askDirty: true,
    })
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
      askDirty: true,
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
    // #76/#77 · 文件族忙/错四件（与 adoptContext 那份是同一份契约的两个抄本）。
    filesLoading: false,
    filesError: null,
    fileDeleting: null,
    fileDeleteError: null,
    // #86 · 清空那两件（与 adoptContext 那份是同一份契约的两个抄本，改一处必须改两处）。
    archiveEmptying: false,
    archiveEmptyError: null,
    newCompanyStatus: 'idle',
    notes: [],
    noteJustAdded: false,
    // #71 · 会话流是公司域数据（问的是**这家**公司的事），换账号/重开必清。`run` 是
    // turns 尾轮的镜像，两者必须同进同退——只清一个会留下"turns 空了但屏上还挂着上一家
    // 公司的判读卡"的错态。
    turns: [],
    run: emptyRunState(),
    adviseRuns: null,   // issue #49：历史是公司域数据，换账号/重开必清
    // #78 · 同上。threadId 与 turns 同进同退（它就是「屏上这一场」的身份）。
    adviseThreads: null,
    threadId: null,
    // #72 · 快问卡四件（与 adoptContext 清单同一份契约的两个抄本——那边补了这边必须补）。
    ask: null,
    askBusy: 'idle',
    askError: null,
    askDirty: false,
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
  })
}


