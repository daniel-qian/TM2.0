import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { useLocation } from 'react-router-dom'
import { useDict } from '../../shared/i18n/useDict'
import { useLite } from '../store'
import { FileManifest, FileSortControl, formatBytes, localStamp, type FileSortKey } from '../FileManifest'
import { KnownContextList } from '../KnownContextList'
import { ACCEPT, UploadPanel, UploadStatusBlock, useUploadTarget } from '../UploadPanel'
import { FormBuilder } from '../FormBuilder'
import {
  CompanyZoneIcon, FilesZoneIcon, FormsZoneIcon, SearchIcon, TrashIcon, UploadIcon,
} from '../icons'
import type { LiveFormSubmission } from '../transport'

// files-hub-0729/01（ADR-0032）· 资料库屏。
// #84（design-0810 · 设计轮票 2）· **两栏 file explorer**。
//
// ## Danny 0810 的原话
// 「组件分布和 layout 好乱，作为用户我看不懂」「应该是 file explorer 形态的文件管理系统，
//  **上传窗口和它放在一起**」。规格正源 `.issues/design-0810/design-plan.md` §2.4，
//  静态原型 `.issues/design-0810/proto/files.html`。
//
// ## 改造前的四条病根（都是 0810 真机截图上量到的，不是读码推断的）
//  ① **两条互不相干的左边界**：内容列 `min(100%,820px)` 吊在视口正中 → 1440px 下两侧各
//     ~310px 死白，而顶栏胶囊是**左对齐**的。
//  ② **四件事垂直摞成一根长条**（文件 / 常驻表单 / 补资料 / 新建一家公司），桌面满数据态
//     ~2700px，全部默认摊开。
//  ③ **视觉权重与使用频率倒挂**：最罕用的「新建一家公司」占着全页最重的一张白卡片
//     （内含整套上传家具）。
//  ④ **文件行是 flex-wrap 的汤**：390px 上 9 行出现 4 种高度、3 种内部顺序（病根④的修法
//     在 FileManifest 的 `table` 形态里，不在本文件）。
//
// ## 改法：把「垂直摞」换成「左右分」
// 左栏 208px＝**分区**，右栏是这一区的**工作台**。纵向长条换成横向切换，~2700px 的滚动
// 就此消失。栏的视觉语言与票 1（#83 对话侧栏）**同一套**——同宽度节奏、同 34px 行高、
// 同 hover/选中语法，于是「侧栏」不再是对话页一个孤零零的部件，而是这个应用的壳。
//
// ## 🔴 本票**没有**撤掉「新建一家公司」
// 设计正源 §5.1 里 Danny 拍板「整个概念取消」，但那是 **#88** 的活（§8 排期：15+3 条判据
// 改判 + 13 个 i18n 孤儿，且要先有 #86 的纠错出口——已就位）。本票只做布局：把它从
// 「全页最重的一张白卡片」降成栏底次级组里的**一行**，病根③当场销账，而键、判据、入口
// 一个都没删。#88 落地时删的就是 `.lite-files-rail-foot` 里 `id="new"` 那一行 + 它带出来的
// `filesUploadTitle` / `againTitle` / `againBody` 三条键 + `activeZone === 'new'` 那一支。
//
// ## 🔴 分区是**真卸载**，不是 display:none
// #76 在这个文件里立过碑：playwright 在隐藏元素上会给出四种并存的结局（hasText 照样命中
// → 随后的 click 等 30s 把门**崩**掉；innerText 返空串 → 判据以「文案不对」**假红**；
// count() 完全免疫 → 继续**假绿**；段级 screenshot 直接抛错）。一道门里四种结局并存，
// 读日志的人会把它归因成四个不同的 bug。所以非当前分区**整段不进 DOM**——门要看它，就
// 得先真点那一行（同拍已给 files-ia / append-story / forms-proactive 各补了这一步）。

// files-hub-0729/02 · 「这台电脑上传过的公司」。抽成小组件只为一件事：小节标题与内容
// **同生共死**。名册不足两批时 KnownContextList 返回 null，标题必须跟着消失——一个
// 「这台电脑上传过的公司」底下空无一物的小节，读起来像加载失败。
function SwitchSection() {
  const { t } = useDict()
  const known = useLite((s) => s.knownContexts)
  if (known.length < 2) return null
  return (
    <section id="files-switch" className="lite-files-section lite-files-switch-section" aria-label={t.upload.switchTitle}>
      <h3 className="lite-files-section-title">{t.upload.switchTitle}</h3>
      <KnownContextList />
    </section>
  )
}

// 词典占位符替换（与 lite2/AskCard.tsx、OnboardWizard.tsx 的 fill 同形——本仓有十多份各自
// 独立的拷贝，没有共享导出；这里照惯例再放一份，不为一个三行函数新开一个 shared 模块）。
function fill(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_, k: string) => String(vars[k] ?? ''))
}

function classNames(parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(' ')
}

// 服务端时刻 → 本地时刻的换算搬去了 `FileManifest.localStamp`（#76 把清单的上传时间列
// 接上时，两处要用同一格数字，各算一遍迟早漂）。这里 import 那一份，**不再留副本**——
// 那段「为什么不能 slice(0,16)」的长注释也跟着搬过去了，改口径只改一处。

// 剪贴板写入的**唯一一条**降级链：clipboard API 可能被拒（headless / 无 https / 无权限），
// 退 execCommand，两条都失败回 false 让调用方自己决定怎么说。逐行复制与「复制全部」共用
// 这一份——两处各写一份 try/catch 迟早漂（#76 抽出来之前就是各写一份）。
async function writeClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    try {
      const ta = document.createElement('textarea')
      ta.value = text
      document.body.appendChild(ta)
      ta.select()
      const ok = document.execCommand('copy')
      document.body.removeChild(ta)
      return ok
    } catch {
      return false
    }
  }
}

// gap-design-0805 T3 · form-frontend-a1c · 常驻表单分区。
//
// ## 这一段解决什么
// 「Avery 内置常驻表单收集信息」这句对客承诺，后端两票（T1 建表+员工 H5、T2 提交进资料）
// 已经通了，但经理侧一直没有面——链接只能用 curl 铸。这一段就是那个面：挑一张表、点名要发
// 给谁、拿到一人一条的链接自己转发，然后回来看谁交了。
//
// ## 🔴 三条纪律，都是结构性的不是文案性的
//  1. **转发是人的闸**。服务端不发消息、不碰 IM（拍板 #4）。所以这里的终点是一串**可复制的
//     链接**，不是一个「发送」按钮——那个按钮会让经理以为系统替他发了。
//  2. **没交的人是行，不是缺席**。铸链即建行（form_api.py:210-211），所以「谁没交」直接读
//     `status:'open'` 的行。绝不做「名册减去交了的」——那会把从没收到过链接的人也算成没交，
//     等于替客户断言一件我们并不知道的事。
//  3. **不建假按钮**。模板编辑（后端有 POST /forms）和重新入库（POST .../ingest）这一票
//     刻意不做：前者要一整个表单编辑器，后者的回执里**没有「这条归没归档」这个字段**
//     （_submission_payload，form_api.py:225-238），做出来的按钮没有诚实的标题也没有诚实的
//     禁用态。宁可没有。
//
// ## #84 · 段内按频率重排（规格 §2.4.8「纯顺序调整，零新部件」）
// 新序 = 「谁交了」（**天天看**）→ 铸链（一周一次）→ 拼装器（很少动）。
// 改造前拼装器夹在模板列表与铸链之间：一个一年动两次的编辑器，天天挡在「这周发给谁」前面。
// 🔴 拼装器**不做折叠**。规格原文就是「纯顺序调整」，而且 `verify-form-builder` 有 43 条
//    判据真点它——把它塞进一个默认收起的 disclosure，等于给那 43 条判据每条都加一步
//    「先展开」，换来的只是少两行墨。收进的是**位置**，不是可见性。
function StandingFormsSection() {
  const { t } = useDict()
  const l = t.lite2
  const contextId = useLite((s) => s.contextId)
  const team = useLite((s) => s.team)
  const templates = useLite((s) => s.formTemplates)
  const submissions = useLite((s) => s.formSubmissions)
  const minted = useLite((s) => s.formsMinted)
  const formsBusy = useLite((s) => s.formsBusy)
  const formsError = useLite((s) => s.formsError)
  const refreshForms = useLite((s) => s.refreshForms)
  const createFormLinks = useLite((s) => s.createFormLinks)
  const resetFormsWrite = useLite((s) => s.resetFormsWrite)
  // T9 · 服务端这一次真的按上期名单备好了什么 + 正在撤回哪一条。
  const formsAutoFilled = useLite((s) => s.formsAutoFilled)
  const formsVoiding = useLite((s) => s.formsVoiding)
  const voidFormLink = useLite((s) => s.voidFormLink)
  const canFetchForms = useLite((s) => !!s.transport.fetchForms)

  const [templateId, setTemplateId] = useState<string | null>(null)
  const [picked, setPicked] = useState<string[]>([])
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [copiedAll, setCopiedAll] = useState<number | null>(null)
  const [copyAllFailed, setCopyAllFailed] = useState(false)
  // #76 · 手动刷新钮自己的忙态。🔴 **不许借 formsBusy**：那一格同时管着「生成本期链接」
  // 那颗主按钮的 disabled，借它会让刷新的两秒里生成键一起置灰（点了没反应=看起来坏了）。
  const [refreshing, setRefreshing] = useState(false)
  // 「这个人的这份周报是关于哪个项目的」——键是人卡内部 id，值是项目标题（''=不绑）。
  // 逐人一格而不是整批一个：一批人本来就可能各扛各的项目，整批绑一个等于替经理断言。
  const [bindings, setBindings] = useState<Record<string, string>>({})

  // 🔴 hooks 必须全部跑在早退之前（下面几条 return null 在它们后面）。
  // 拉取挂在「经理打开了常驻表单分区」这个动作上，**不**并进 uploadFiles/restoreSession 那几处
  // 扇出（同 refreshAdviseRuns 挂 RoomScreen 的先例）：`GET /forms` 在服务端首次调用会写
  // （ensure_builtin_templates 铸内置周报），并进扇出等于把一次写变成常态后台流量。
  // 换公司时把本地挑选态一并清掉——上一家公司选中的那几个人不该留在这一家的按钮上。
  // ⚠ #84 之后这一段只在分区被点开时才挂载，于是这条 effect 从「进屏就拉」变成
  //   「进这一区才拉」——写副作用因此更少发生，方向是对的（不是漏拉：区一打开就拉）。
  useEffect(() => {
    setPicked([])
    setCopiedId(null)
    setBindings({})
    void refreshForms()
  }, [refreshForms, contextId])

  const roster = team?.people ?? []
  // 可绑的项目 = 这家公司当前的项目卡（归档的不出现在 team.projects 里）。
  const bindable = team?.projects ?? []
  // 同名的人要能分得出来。0807 起工号真的进了人卡，两位同名同事第一次不再被并成一张——
  // 于是选人那排出现两个一模一样的「林小满」，经理没法知道该点哪个（截图人眼过时逮到的）。
  // 只给**真的重名**的人补一行部门：不重名的补了只是噪音。
  const dupeNames = new Set(
    roster.map((p) => p.name).filter((n, i, all) => all.indexOf(n) !== i),
  )
  const disambiguator = (p: (typeof roster)[number]) =>
    dupeNames.has(p.name) ? (p.team ?? '') : ''
  const active = (templates ?? []).filter((tpl) => tpl.active)
  const selected = active.find((tpl) => tpl.id === templateId) ?? active[0] ?? null

  // 这张表的提交行。周期取**数据里最大的那一个**（ISO 周字符串 `YYYY-Www` 字典序即时间序），
  // 🔴 刻意不按本机时钟算「本周」：服务端的 period 是铸链那一刻定的（周五铸链、周一才填），
  // 前端再算一遍 ISO 周只会得出第二个真相，且跨年/跨时区各错一次。
  const rows = (submissions ?? []).filter((s) => s.template_id === (selected?.id ?? ''))
  const periods = rows.map((s) => s.period).filter(Boolean).sort()
  const latestPeriod = periods.length > 0 ? periods[periods.length - 1] : ''
  const statusRows = latestPeriod ? rows.filter((s) => s.period === latestPeriod) : rows

  // T9 · 这一次服务端为**当前选中的这张表**备好了什么。逐表取而不是取第一条：将来经理有两张
  // 常驻表时，把 A 表的「备好了 5 人」印在 B 表的标题下面就是一句假话。
  // ⚠ T11 之后 `selected` 可以是 null（一张模板都还没有也照样渲染「新建表单」入口），
  // 所以这里用可选链 + `?? ''` —— 没有选中表时永远匹配不到，横幅自然不出。
  const autoFilled =
    (formsAutoFilled ?? []).find((f) => f.template_id === (selected?.id ?? '')) ?? null
  const autoFilledCount = autoFilled?.minted ?? 0

  // 🔴 两条否决，每一条都是「这一段现在连一件真东西都做不了」——标题跟着内容一起消失，
  // 因为一个底下空无一物的小节读起来像加载失败（SwitchSection 那条注释说的就是这件事）。
  //  ① 没有 contextId：还没有公司，表无处可建、链接无处可铸。
  //  ② templates === null：没拉过 / 这条通道没有这个方法（stub）/ 拉失败。**不是**「这家公司
  //     没有表单」——404 是后端对缺凭据的无枚举答复，不承载存在信息（absent≠none）。
  //
  // ⚠ #84：这两条同时也是**左栏那一行出不出**的判据（`formsZoneAvailable`），两处必须同源
  //   ——否则会长出一行点进去空无一物的分区，那比没有这一行更像坏了。
  if (!contextId) return null
  // #76 · 静默蒸发的可见降级。此前这里是一条裸 `if (templates === null) return null`：
  // 🔴 **拉失败**（token 过期 / 服务端抖了一下）与**这条通道压根没有表单功能**（stub / 老
  // 后端）在屏上长得一模一样——整段连标题一起无声消失，经理看到的是「表单功能不存在」。
  // 这两件事现在分开：没有 fetchForms 这个方法才是真的"没有这个功能"，那时候照旧整段不出
  //（同 AppendSection 的 canAppend 先例——不装作有）；有方法却没拉到，就诚实说一句。
  if (templates === null) {
    if (!canFetchForms) return null
    return (
      <section id="files-forms" className="lite-files-section lite-files-forms" aria-label={l.formsTitle}>
        <h3 className="lite-files-section-title">{l.formsTitle}</h3>
        <p className="lite-files-empty lite-files-forms-unavailable">{l.formsUnavailable}</p>
      </section>
    )
  }

  const togglePicked = (personId: string) => {
    setPicked((prev) =>
      prev.includes(personId) ? prev.filter((id) => id !== personId) : [...prev, personId],
    )
  }

  const pickTemplate = (id: string) => {
    setTemplateId(id)
    // 换表 = 上一批链接和上一次的报错都不再属于这一屏（同 resetProjectWrite 的取舍）。
    resetFormsWrite()
    setPicked([])
    setCopiedId(null)
    setBindings({})
  }

  const mint = () => {
    if (!selected) return
    const recipients = picked
      .map((id) => {
        const person = roster.find((p) => p.id === id)
        return {
          // 🔴 `id` 这个键在后端是**工号**（01 表人员ID，`FormSubmission.person_id`），T5 的
          // `PersonIndex` 拿它当身份尺；人卡的内部键（`p.id`，形如 `u_周雅`）**不是**工号，
          // 拿它冒充会让 PersonIndex 规则 2 判成「两个恰好同名的人」而彻底不并卡。
          //
          // 0807 HITL 之前后端根本没把工号投到前端，所以这里只能送空串（退回按姓名认人）。
          // 代价当场在生产上被逮到：花名册里两位同名同事，谁交的都认不出，自述被诚实跳过，
          // 而经理看到的是「我交了、卡上没反应」。现在 `team_cards()` 投了 `person_id`，
          // 这条腿才算真接上：**有工号就送工号，没有就仍送空串**（一字不差地退回旧行为，
          // 没工号的公司什么都没变）。
          id: person?.personId ?? '',
          name: person?.name ?? '',
          // 绑项目：空串就是「不绑」——后端 `project_ref` 默认也是空串，送空与不送同义。
          project_ref: bindings[id] ?? '',
        }
      })
      // 后端 name 是 min_length=1 的必填——名字空的人送过去只会换回一个 422，
      // 而经理看到的会是一句「这次没生成成」，查不出是哪一行的锅。
      .filter((r) => r.name.trim().length > 0)
    void createFormLinks(selected.id, recipients)
  }

  // clipboard 可能被拒（headless / 无 https / 权限）——降级 execCommand，两条都失败也不崩。
  // 链接文本本身恒可见可选，复制不了还能手动选（同 AskCard.copyLink 的姿态）。
  // #76 · 「复制全部」。🔴 **独立 state**，不许复用 `copiedId`：那是单值，下面每一行按
  // `copiedId === row.id` 三元切文案，复用会把某一行误点亮成「已复制」。
  // 🔴 也必须有可见的失败态：逐行那条按设计静默（URL 恒可见可选，用户看得见自己没复制成），
  // 批量这颗静默失败时屏上什么都不变，经理会直接把上一次的剪贴板内容粘给员工。
  const copyAll = async () => {
    const links = (minted?.links ?? []).map((r) => r.link ?? '').filter(Boolean)
    if (links.length === 0) return
    // 一人一行：粘进微信/邮件就是一份可读的名单，不是一坨。
    const text = (minted?.links ?? [])
      .filter((r) => r.link)
      .map((r) => `${r.person_name} ${r.link}`)
      .join('\n')
    if (await writeClipboard(text)) {
      setCopiedAll(links.length)
      setCopyAllFailed(false)
    } else {
      setCopiedAll(null)
      setCopyAllFailed(true)
    }
  }

  const copyLink = async (link: string, rowId: string) => {
    if (await writeClipboard(link)) setCopiedId(rowId)
  }

  // 🔴 缺席不等于成功：不认识的状态词说「状态未知」，绝不悄悄按 open/submitted 渲染
  //（同 FileManifest.fileStatusView 的纪律）。
  const statusView = (row: LiveFormSubmission): { label: string; tone: string } => {
    switch (row.status) {
      case 'submitted':
        return { label: l.formsStatusSubmitted, tone: 'ok' }
      case 'open':
        return { label: l.formsStatusOpen, tone: 'open' }
      case 'expired':
        return { label: l.formsStatusExpired, tone: 'warn' }
      default:
        return { label: l.formsStatusUnknown, tone: 'unknown' }
    }
  }

  const errorText =
    formsError === 'rejected'
      ? l.formsErrorRejected
      : formsError === 'retired'
        ? l.formsErrorRetired
        : formsError === 'failed'
          ? l.formsErrorFailed
          : null

  return (
    <section id="files-forms" className="lite-files-section lite-files-forms" aria-label={l.formsTitle}>
      <h3 className="lite-files-section-title">{l.formsTitle}</h3>
      <p className="lite-files-empty">{l.formsLede}</p>

      {/* T9（gap2 #58）· 「本期已按上期名单备好（N 人）· 去调整」。
          🔴 这条只在服务端**这一次**真的铸了行时出现（`auto_filled` 键缺席 = 什么都没发生），
          不是「本期有行」那种每次刷新都为真的静态事实。措辞把两件事都说清楚：照抄的是**上期
          那份经理自己选的名单**（不是我们替他挑的人），以及改在哪儿改——底下那排选人与每行的
          「撤回」就是入口，所以不另做一个跳转按钮，只说一句「下面可以改」。 */}
      {autoFilled ? (
        <p className="lite-files-forms-autofilled" data-autofilled={autoFilledCount}>
          {fill(l.formsAutoFilled, { count: autoFilledCount, period: autoFilled.period })}
        </p>
      ) : null}

      {/* ── ① 谁交了（#76 提到最前，#84 保持第一）───────────────────────────────────
          频率倒挂是这一区最大的病：铸链是**一周一次**的动作，而经理周中天天要看的
          「谁交了」曾经压在整块最底。没有一条铸过的链接时整块不出——那时候「谁交了」的
          答案是「你还没发给谁」，而下面那个生成按钮已经把这句话说完了。 */}
      {statusRows.length > 0 ? (
        <div className="lite-files-forms-status-block">
          <p className="lite-files-forms-label">
            {l.formsStatusTitle}
            {latestPeriod ? <span className="lite-files-forms-period">{latestPeriod}</span> : null}
            {/* #76 · 手动刷新。此前 refreshForms **只挂屏 mount**：员工交了表，经理这一屏
                不动就永远是旧的，要靠切走再切回来触发 remount；铃铛的 'form' 通知也只在
                refreshForms 跑过之后才 push（不开这屏就不响）。
                🔴 自动轮询明确不做：GET submissions 是 T9 的**读时写**（顺手按上期名单铸
                本期），裸轮询等于把那个写副作用变成常态后台流量——要做得先拆后端读写语义。
                重呼的是既有的那个 GET，零后端改动。 */}
            <button
              type="button"
              className="lite-btn lite-btn--ghost lite-files-forms-refresh"
              disabled={refreshing}
              aria-busy={refreshing}
              onClick={() => {
                if (refreshing) return
                setRefreshing(true)
                void Promise.resolve(refreshForms()).finally(() => setRefreshing(false))
              }}
            >
              {refreshing ? t.upload.filesRefreshing : t.upload.filesRefresh}
            </button>
          </p>
          <ul className="lite-files-forms-status">
            {statusRows.map((row) => {
              const view = statusView(row)
              return (
                <li key={row.id} className="lite-files-forms-status-row" data-tone={view.tone}>
                  <span className="lite-files-forms-status-name">{row.person_name}</span>
                  {/* 绑了项目就说出来——「绑了之后经理怎么看得出来」的答案就在这一行。
                      没绑的什么都不写（absent≠none：不编一句「未绑定」）。 */}
                  {row.project_ref ? (
                    <span className="lite-files-forms-status-project">
                      {fill(l.formsStatusAbout, { project: row.project_ref })}
                    </span>
                  ) : null}
                  {/* 已交的给出时刻（服务端盖的章，切到分钟）。没交的这里什么都不写——
                      编一句「等待中」只是把空白换成噪音。
                      🔴 时间戳排在徽章**前面**：徽章恒为行尾，两种行的状态词才对得上一列。
                      反过来（徽章在前）会让「已交」被时间戳往左推，人眼过时逮到过。 */}
                  {row.submitted_at ? (
                    <span className="lite-files-forms-status-when">
                      {localStamp(row.submitted_at)}
                    </span>
                  ) : null}
                  <span className="lite-badge lite-files-forms-status-badge" data-tone={view.tone}>
                    {view.label}
                  </span>
                  {/* T9 · 「去调整」的落点：撤回一条还没交的链接。
                      🔴 只在 `status === 'open'` 时渲染。已交的**不许动**（答案是员工本人的话，
                      撤回按钮不该有机会碰它）；已过期的撤了也没意义（它本来就打不开了）。
                      🔴 判据用的是服务端背书的 `row.status`，不是从 submitted_at 现推——
                      「显示值和判据值必须分开」那条老规矩（AGENTS.md 易复发陷阱第一条）。
                      撤回 = 服务端把到期时刻拨到此刻：行还在（所以自动补铸不会立刻发回来一条），
                      员工那头看到的是现成的「这条链接已过期」页，不是一种新造的状态。 */}
                  {row.status === 'open' && voidFormLink ? (
                    <button
                      type="button"
                      className="lite-btn lite-btn--ghost lite-files-forms-void"
                      disabled={formsVoiding !== null}
                      aria-label={fill(l.formsVoidAria, { name: row.person_name })}
                      onClick={() => void voidFormLink(row.id)}
                    >
                      {formsVoiding === row.id ? l.formsVoiding : l.formsVoid}
                    </button>
                  ) : null}
                </li>
              )
            })}
          </ul>
        </div>
      ) : null}

      {/* ── ② 铸链：挑一张表 → 点名发给谁 → 拿链接（一周一次）───────────────────────
          模板列表：只有一张时不给切换按钮——一个唯一选项的单选组是纯噪音；题面预览照给，
          经理发出去之前有权看清员工会被问到什么。
          ⚠ gap2 T11：一张在用的模板都没有时，这个 <ul> 渲染成空——底下的拼装器仍在，
          经理可以从那里建第一张（这正是拆掉那条早退的原因）。 */}
      <ul className="lite-files-forms-templates">
        {active.map((tpl) => {
          const isSelected = tpl.id === selected?.id
          const preview = tpl.fields.map((f) => f.label).join(' · ')
          return (
            <li key={tpl.id} className="lite-files-forms-template" data-selected={isSelected ? '1' : '0'}>
              {active.length > 1 ? (
                <button
                  type="button"
                  className={classNames([
                    'lite-btn',
                    isSelected ? 'lite-btn--soft' : 'lite-btn--ghost',
                    'lite-files-forms-template-pick',
                  ])}
                  aria-pressed={isSelected}
                  onClick={() => pickTemplate(tpl.id)}
                >
                  {tpl.title}
                </button>
              ) : (
                <p className="lite-files-forms-template-name">{tpl.title}</p>
              )}
              {/* 题面预览是**服务端存着的那张表的原文**（内置周报是中文），不是界面文案——
                  与文件名同级：它是客户自己的内容，不跟着界面语言走。 */}
              {preview ? (
                <p className="lite-files-forms-template-fields">
                  {l.formsFieldsLead}
                  {preview}
                </p>
              ) : null}
            </li>
          )
        })}
      </ul>

      {/* 选人 + 生成。没有花名册、或者一张在用的表都还没有，就整块不出——那时候一个
          「生成链接」按钮点了必然什么都不会发生，那就是假按钮。 */}
      {selected && roster.length > 0 ? (
        <div className="lite-files-forms-mint-block">
          <p className="lite-files-forms-label">{l.formsPickLabel}</p>
          <p className="lite-files-forms-note">{l.formsPickHint}</p>
          <div className="lite-files-forms-chips">
            {roster.map((p) => {
              const isPicked = picked.includes(p.id)
              return (
                <button
                  key={p.id}
                  type="button"
                  className={classNames([
                    'lite-btn',
                    isPicked ? 'lite-btn--soft' : 'lite-btn--ghost',
                    'lite-files-forms-chip',
                  ])}
                  aria-pressed={isPicked}
                  onClick={() => togglePicked(p.id)}
                >
                  {p.name}
                  {/* 重名时补部门。🔴 分隔符走 CSS 间距、不写任何标点字面量——
                      这一段的碑就在上面（`{l.formsFieldsLead}：{preview}` 那个硬编码全角冒号，
                      英文壳上多出一个中文标点、而 i18n 门看不见）。部门是**客户数据**，
                      与界面语言无关，所以它不进词典。 */}
                  {disambiguator(p) ? (
                    <span className="lite-files-forms-chip-team">{disambiguator(p)}</span>
                  ) : null}
                </button>
              )
            })}
          </div>
          {/* 绑项目。只在**已经选了人**且这家公司真有项目卡时才出——没项目可绑时摆一排
              永远只有「不绑」一个选项的下拉框，是纯噪音（同上面「一张模板不给切换按钮」）。
              逐人一格：一批人各扛各的项目是常态，整批绑一个等于替经理断言。
              🔴 默认「不绑」而不是猜一个：绑了才会把员工的原话写进项目卡，
              猜错的代价是把 A 的话挂到 B 的项目上。 */}
          {picked.length > 0 && bindable.length > 0 ? (
            <div className="lite-files-forms-bind">
              <p className="lite-files-forms-label">{l.formsBindLabel}</p>
              <p className="lite-files-forms-note">{l.formsBindHint}</p>
              <ul className="lite-files-forms-bind-list">
                {picked.map((id) => {
                  const person = roster.find((p) => p.id === id)
                  if (!person) return null
                  const selectId = `lite-forms-bind-${id}`
                  return (
                    <li key={id} className="lite-files-forms-bind-row">
                      <label className="lite-files-forms-bind-name" htmlFor={selectId}>
                        {person.name}
                        {disambiguator(person) ? (
                          <span className="lite-files-forms-chip-team">
                            {disambiguator(person)}
                          </span>
                        ) : null}
                      </label>
                      <select
                        id={selectId}
                        className="lite-files-forms-bind-select"
                        value={bindings[id] ?? ''}
                        onChange={(e) =>
                          setBindings((prev) => ({ ...prev, [id]: e.target.value }))
                        }
                      >
                        <option value="">{l.formsBindNone}</option>
                        {/* value 用**标题**不是内部 id：后端 `find_bound_project` 按标题找
                            （project_ref 是一段人写的引用，不是外键）。 */}
                        {bindable.map((pr) => (
                          <option key={pr.id} value={pr.title}>
                            {pr.title}
                          </option>
                        ))}
                      </select>
                    </li>
                  )
                })}
              </ul>
            </div>
          ) : null}
          <button
            type="button"
            className="lite-btn lite-btn--primary lite-files-forms-mint"
            // 置灰只是礼貌——真正挡住「同一拍连点两下 = 每人收到两条链接」的闸在 store 里
            //（那个端点不幂等，见 createFormLinks 的注释）。
            disabled={formsBusy !== 'idle' || picked.length === 0}
            onClick={mint}
          >
            {formsBusy === 'minting' ? l.formsMintBusy : l.formsMintAction}
          </button>
          {errorText ? (
            <p className="lite-files-forms-error" role="status">
              {errorText}
            </p>
          ) : null}
        </div>
      ) : null}

      {/* 刚铸出来的这一批链接。刻意与上面的「谁交了」分开：这几条是经理此刻要粘出去的，
          混进全量清单里最容易粘错周。 */}
      {minted && minted.links.length > 0 ? (
        <div className="lite-files-forms-links-block">
          <p className="lite-files-forms-label">
            {fill(l.formsLinksTitle, { period: minted.period })}
          </p>
          {/* #76 · 一键全复制。逐行那颗保留（发给某一个人时仍然是最短的路），这颗解的是
              「30 个人 30 轮复制→切微信→粘贴→回来」。一人一行的纯文本，粘出去就是名单。 */}
          {minted.links.some((r) => r.link) ? (
            <div className="lite-files-forms-copyall-row">
              <button
                type="button"
                className="lite-btn lite-btn--soft lite-files-forms-copyall"
                onClick={() => void copyAll()}
              >
                {copiedAll !== null
                  ? fill(l.formsCopiedAll, { count: copiedAll })
                  : l.formsCopyAll}
              </button>
              {copyAllFailed ? (
                <span className="lite-files-forms-copyall-error" role="status">
                  {l.formsCopyAllFailed}
                </span>
              ) : null}
            </div>
          ) : null}
          <div className="lite-files-forms-links">
            {minted.links.map((row) => (
              <div key={row.id} className="lite-files-forms-link-row">
                <span className="lite-files-forms-link-name">{row.person_name}</span>
                {/* 链接是**服务端拼好的整条**，前端不自造：公共域与 API base 在生产上是两个
                    地址（public_base() 只认 AVERY_PUBLIC_BASE，从不看请求头），自己拼出来的
                    那条在本机看着对、上线就错。
                    ⚠ 这条 URL 是**数据**不是界面文案，所以它是可见可选的正文——照 AskCard 的
                    `<code className="ask-link-url">` 同一个先例（那条分享链接在议事室屏上已经
                    过了很久的中文纯度门）。verify-zh-purity 扫的是 innerText，真把它采到样时
                    会把 URL 报成「英文残留」：那时候的正解是给扫描面加一条"用户数据"豁免，
                    **不是**放宽 ALLOW 词表（那道门自己的注释明令），更不是把链接藏起来——
                    藏了这个功能就没了，而且剪贴板被拒时它就是唯一的降级出口。
                    今天不会红：那道门的种子语料抽不出 team.people，本段整段不渲染（实测）。 */}
                <code className="lite-files-forms-link-url">{row.link ?? ''}</code>
                {row.link ? (
                  <button
                    type="button"
                    className="lite-btn lite-btn--ghost lite-files-forms-copy"
                    onClick={() => void copyLink(row.link ?? '', row.id)}
                  >
                    {copiedId === row.id ? l.formsCopied : l.formsCopy}
                  </button>
                ) : null}
              </div>
            ))}
          </div>
          <p className="lite-files-forms-note">{l.formsLinksNote}</p>
        </div>
      ) : null}

      {/* ── ③ 改表（很少动，所以排在最后）───────────────────────────────────────────
          gap2 T11 · 模板拼装器（建一张 / 复制一张改 / 让 Avery 读旧表格起草）。
          🔴 它**不受**上面那两块的判空约束——花名册还没解析出来的第一天，恰恰是最该能建表的
             时候（原来那条 `roster.length === 0 && rows.length === 0` 早退会把它一起藏掉）。 */}
      <div className="lite-files-forms-edit-block">
        <p className="lite-files-forms-label">{l.formsEditTitle}</p>
        <FormBuilder templates={templates ?? []} />
      </div>
    </section>
  )
}

// ── #84 · 左栏的一行 ──────────────────────────────────────────────────────────────────
// 规格 §2.2（与 #83 对话侧栏**同一套**）：34px 单行 · `padding:0 10px` · radius 8 ·
// hover `rgba(ink,.05)` · 选中 `rgba(accent,.13)` + 2px accent 左封条 + 600 字重。
// 🔴 是 <button> 不是可点的 <div>：verify-button-family 审的是 `.lite2-shell` 下每一枚可见
//    <button>「要么挂 .lite-btn、要么进白名单」——挂族是不动白名单的那条路（白名单膨胀＝门失效）。
function RailRow(
  { id, label, icon, tail, current, danger, onClick }: {
    id: string
    label: string
    icon: ReactNode
    tail?: ReactNode
    current?: boolean
    danger?: boolean
    onClick: () => void
  },
) {
  return (
    <button
      type="button"
      className={classNames([
        'lite-btn', 'lite-btn--ghost', 'lite-files-rail-row',
        danger && 'lite-files-rail-row--danger',
      ])}
      data-files-zone={id}
      // aria-current 而不是 aria-pressed：这一排是**导航**（当前在哪一区），不是一组开关。
      aria-current={current ? 'true' : undefined}
      data-current={current ? '1' : '0'}
      onClick={onClick}
    >
      {icon}
      <span className="lite-files-rail-label">{label}</span>
      {tail !== undefined && tail !== null ? (
        <span className="lite-files-rail-tail">{tail}</span>
      ) : null}
    </button>
  )
}

// ── #84 · 「清空这份档案」（#86 的 UI 挂点）────────────────────────────────────────────
// #86 把后端 + transport + store 全通了，票面把 UI 挂点留给本票；run-battery 的 ROSTER 注释
// 也明写「#84 落地时必须回来补『真点那枚键』那一段」——同拍已补（verify-archive-empty ⑦）。
//
// 🔴 销毁类**必须硬确认**，二段点击不够：这一下删掉的是用户传过的全部文件（原件也删）。
//    这里要求**手打一个词**才放行。
//    ⚠ #86 回执的草稿写的是「输入店名才放行」——但这个应用里**根本没有店名这个字段**
//      （KnownContext 只存 id/files/at，team 载荷里也没有公司名）。要求用户输入一个屏上
//      不存在的字符串 = 一道谁也过不去的门。所以改成打一个词典里的确认词，硬度不变
//      （手打过不去误触），前提是真的存在。这条偏差记在回执里。
// 🔴 静息态**不用红**：常驻的红会把整根栏染成警告区。红只在 hover 出现（CSS 那边），
//    确认面板里才用红实底。
function EmptyArchivePanel({ onClose }: { onClose: (emptied: boolean) => void }) {
  const { t } = useDict()
  const l = t.lite2
  const emptyArchive = useLite((s) => s.emptyArchive)
  const emptying = useLite((s) => s.archiveEmptying)
  const emptyError = useLite((s) => s.archiveEmptyError)
  const [typed, setTyped] = useState('')
  const armed = typed.trim() === l.filesEmptyConfirmWord

  return (
    <div className="lite-files-empty-archive" role="alertdialog" aria-label={l.filesEmptyTitle}>
      <p className="lite-files-empty-archive-title">{l.filesEmptyTitle}</p>
      {/* 三句话分三段：**会删掉什么** / **会留下什么** / **这份档案本身不会消失**。
          合成一段的话，「员工已经交上来的答卷留着」这句最容易被跳读——而它恰恰是用户
          清空之后最可能来投诉的一件事（答卷会随重新归档再次出现在资料库里）。 */}
      <p className="lite-files-empty-archive-body">{l.filesEmptyBodyGone}</p>
      <p className="lite-files-empty-archive-body">{l.filesEmptyBodyKept}</p>
      <p className="lite-files-empty-archive-body">{l.filesEmptyBodyStays}</p>
      <label className="lite-files-empty-archive-field">
        <span>{fill(l.filesEmptyConfirmLabel, { word: l.filesEmptyConfirmWord })}</span>
        <input
          type="text"
          className="lite-files-empty-archive-input"
          value={typed}
          autoComplete="off"
          onChange={(e) => setTyped(e.target.value)}
        />
      </label>
      <div className="lite-files-empty-archive-actions">
        <button
          type="button"
          className="lite-btn lite-btn--ghost lite-files-empty-archive-cancel"
          onClick={() => onClose(false)}
        >
          {l.filesEmptyCancel}
        </button>
        <button
          type="button"
          className="lite-btn lite-files-empty-archive-go"
          // 置灰只是礼貌；真闸是下面那句 `if (!armed) return`——UI 的 disabled 挡不住
          //（键盘/脚本都绕得过），而这一下是不可逆的。
          disabled={!armed || emptying}
          aria-busy={emptying}
          onClick={() => {
            if (!armed || emptying) return
            void emptyArchive().then((ok) => {
              if (ok) onClose(true)
            })
          }}
        >
          {emptying ? l.filesEmptyBusy : l.filesEmptyAction}
        </button>
      </div>
      {emptyError ? (
        <p className="lite-files-empty-archive-error" role="status">{l.filesEmptyError}</p>
      ) : null}
    </div>
  )
}

type FilesZoneId = 'files' | 'forms' | 'new' | 'switch'

export function FilesScreen() {
  const { t } = useDict()
  const l = t.lite2
  const files = useLite((s) => s.files)
  const contextId = useLite((s) => s.contextId)
  const restoring = useLite((s) => s.restoring)
  const filesLoading = useLite((s) => s.filesLoading)
  const filesError = useLite((s) => s.filesError)
  const refreshFiles = useLite((s) => s.refreshFiles)
  const knownCount = useLite((s) => s.knownContexts.length)
  const canAppend = useLite((s) => !!s.transport.appendFiles)
  const canFetchForms = useLite((s) => !!s.transport.fetchForms)
  const canEmpty = useLite((s) => !!s.transport.emptyContext)
  const templates = useLite((s) => s.formTemplates)
  const rawTeam = useLite((s) => s.rawTeam)

  // 🔴「还没传过」和「传了但读不出来」是两件事，文案必须分得开。这里只判前者：
  // 有 contextId 但清单为空 = 后端确实没给出文件。
  const hasFiles = files.length > 0
  // 🔴 「还在读」与「读完了是空的」必须分得开：本屏此前不读 restoring/filesLoading，于是
  // 回访者第一帧、切库那一瞬都会**闪**一句「Avery 没列出任何文件」——那是对着一个还没
  // 发生的结论下判断。
  const filesPending = (restoring || filesLoading) && !hasFiles

  // ── 分区 ──────────────────────────────────────────────────────────────────────────
  // 🔴 一行的存在性必须与它那一段的存在性**同源**：长出一行点进去空无一物的分区，
  //    比没有这一行更像坏了（同 SwitchSection「标题与内容同生共死」那条老纪律）。
  const ephemeral = !!rawTeam?.ephemeral
  const formsZoneOn = !!contextId && canFetchForms
  const switchZoneOn = knownCount >= 2
  const activeTemplates = (templates ?? []).filter((tpl) => tpl.active).length

  // 深链：铃铛的 'form' 通知带着 `?zone=forms` 进来（一次性参数，见 routes.ts 的
  // EPHEMERAL_PARAMS）。读一次就够——之后是用户自己在切区，不该被 URL 拽回去。
  const { search } = useLocation()
  const [zone, setZone] = useState<FilesZoneId>(() => {
    const want = new URLSearchParams(search).get('zone')
    return want === 'forms' ? 'forms' : 'files'
  })
  const zoneOn: Record<FilesZoneId, boolean> = {
    files: true, forms: formsZoneOn, new: true, switch: switchZoneOn,
  }
  // 分区消失时回落（例：切公司后 knownContexts 掉回 1 条）。**不**用 effect 改 state：
  // 那会多渲染一帧空工作台，而这里一次派生就够了。
  const activeZone: FilesZoneId = zoneOn[zone] ? zone : 'files'

  const [railOpen, setRailOpen] = useState(false)
  const [confirmEmpty, setConfirmEmpty] = useState(false)
  // 「刚刚亲手清空」与「传了但读不出来」是两件事——#86 回执欠账②：入口一上，
  // 那句「多半是这些文件没读出内容，重新传一次最快」就成了对一次成功销毁的误诊。
  const [justEmptied, setJustEmptied] = useState(false)

  const pick = (next: FilesZoneId) => {
    setZone(next)
    setRailOpen(false)
    setConfirmEmpty(false)
  }

  // 上传口：**一个**，长在文件工作台的工具条上（规格 §2.4.2）。改造前这一屏有两个长得几乎
  // 一样、方向却相反的 dropzone（补进这一家 / 另开一家）。
  // 🔴 方向由「有没有档案」决定，不由用户猜：有档案就是补进这一家；一份都还没有时它才是
  //    开档那一发。示例克隆（ephemeral）两条都不行——补进去的东西会随 TTL 回收一起消失，
  //    而经理会以为存下来了，所以那里**禁入口 + 说明白**，不做假按钮。
  const canAppendNow = !!contextId && canAppend
  const upAppend = useUploadTarget('append')
  const upNew = useUploadTarget('new')
  // 接线用这一个：有档案就补进这一家，一份都没有时它才是开档那一发。
  const up = canAppendNow ? upAppend : upNew
  const uploadMode: 'new' | 'append' = canAppendNow ? 'append' : 'new'
  const uploadBlocked = ephemeral && canAppendNow
  // 🔴 **显示**用另一个：开档那一发跑完的同一帧 `contextId` 就到手了，`up` 当场翻成
  //    append（那条状态机还是 idle）——照 `up` 显示的话，「团队已就绪」在成功的瞬间
  //    消失，`.upload-ready` 一帧都不出现。visual-data.spec 十二张数据态基线正是
  //    「塞 input.upload-input → 等 .upload-ready」这条链驱动的，那样它会以
  //    **「上传等不到」**（60s 超时）的形态红，而真正的原因是这一行选错了状态机。
  //    这条是真机拍图时逮到的，不是读码推断的。
  const shown =
    upAppend.status === 'ingesting' ? upAppend
      : upNew.status === 'ingesting' ? upNew
        : upAppend.status !== 'idle' ? upAppend
          : upNew

  const [sort, setSort] = useState<FileSortKey>('idx')
  const [filter, setFilter] = useState('')

  const totals = useMemo(() => ({
    bytes: files.reduce((n, f) => n + (f.size_bytes || 0), 0),
    chunks: files.reduce((n, f) => n + (f.n_chunks || 0), 0),
  }), [files])

  const zoneTitle =
    activeZone === 'files' ? l.filesCurrentTitle
      : activeZone === 'forms' ? l.formsTitle
        : activeZone === 'new' ? l.filesUploadTitle
          : t.upload.switchTitle

  return (
    <section className="scene scene-nexus is-active lite-files" aria-label={l.tabFiles}>
      {/* 抽屉开关。桌面（≥861）被 CSS `display:none` 收起——栏本来就在那儿，没有可开的东西。
          抓手 `data-files-toggle` 是手机态门唯一的入口，改名前先 grep。 */}
      <button
        type="button"
        className="lite-btn lite-btn--ghost lite-files-rail-toggle"
        aria-expanded={railOpen}
        data-files-toggle
        onClick={() => setRailOpen((o) => !o)}
      >
        {l.filesEyebrow}
      </button>
      {/* 遮罩只在抽屉真开着时才进 DOM（桌面 railOpen 恒 false → 桌面这个节点根本不存在），
          CSS 那边另有一道桌面兜底的 display:none，两头都做。 */}
      {railOpen ? (
        <button
          type="button"
          className="lite-btn lite-files-rail-scrim"
          data-files-scrim=""
          aria-label={l.filesRailScrimAria}
          onClick={() => setRailOpen(false)}
        />
      ) : null}

      <aside
        className={classNames(['lite-files-rail', railOpen ? 'is-open' : ''])}
        aria-label={l.filesEyebrow}
        data-files-rail=""
      >
        <p className="lite-files-rail-eyebrow">{l.filesEyebrow}</p>
        <div className="lite-files-rail-list">
          <RailRow
            id="files" label={l.filesCurrentTitle} icon={<FilesZoneIcon />}
            tail={files.length > 0 ? files.length : undefined}
            current={activeZone === 'files'} onClick={() => pick('files')}
          />
          {formsZoneOn ? (
            <RailRow
              id="forms" label={l.formsTitle} icon={<FormsZoneIcon />}
              tail={templates !== null ? activeTemplates : undefined}
              current={activeZone === 'forms'} onClick={() => pick('forms')}
            />
          ) : null}
        </div>

        {/* ── 次级组：罕用的两条 + 销毁类 ────────────────────────────────────────────
            「新建一家公司」在这里是**一行**，改造前它是全页最重的一张白卡片（病根③）。
            🔴 撤掉它是 #88 的活，不是本票的——本票只把权重调对。 */}
        <div className="lite-files-rail-foot">
          <p className="lite-files-rail-group-label">{l.filesRailMore}</p>
          <RailRow
            id="new" label={l.filesUploadTitle} icon={<CompanyZoneIcon />}
            current={activeZone === 'new'} onClick={() => pick('new')}
          />
          {switchZoneOn ? (
            <RailRow
              id="switch" label={t.upload.switchTitle} icon={<CompanyZoneIcon />}
              tail={knownCount} current={activeZone === 'switch'} onClick={() => pick('switch')}
            />
          ) : null}
          {/* #86 的挂点。没有 contextId 就没有可清的东西；这条通道没有 emptyContext
              （stub / 老后端）就一个键都不渲染（同 canAppend 的能力探测先例）。 */}
          {contextId && canEmpty ? (
            <RailRow
              id="empty" label={l.filesEmptyEntry} icon={<TrashIcon />} danger
              onClick={() => {
                setConfirmEmpty(true)
                setRailOpen(false)
                // 清空的是**文件**，所以顺手把工作台切到那一区：在「常驻表单」区弹一张
                // 「清空这份档案？」，读起来像要清掉表单（而表单恰恰是留下的那一半）。
                setZone('files')
              }}
            />
          ) : null}
        </div>
      </aside>

      {/* ── 工作台 ──────────────────────────────────────────────────────────────────
          整块接拖放（规格 §2.4.2「上传窗口和它放在一起」）。改造前只有那个小方框接拖拽，
          而它离表格有一屏远。 */}
      <div
        className={classNames(['lite-files-pane', up.dragOver && 'is-dragover'])}
        data-files-pane={activeZone}
        onDragOver={(e) => {
          if (activeZone !== 'files' || uploadBlocked) return
          e.preventDefault()
          up.setDragOver(true)
        }}
        onDragLeave={() => up.setDragOver(false)}
        onDrop={(e) => {
          if (activeZone !== 'files' || uploadBlocked) {
            up.setDragOver(false)
            return
          }
          up.onDrop(e)
        }}
      >
        {/* 页头：**一行**说清「这是什么 + 有多少」。改造前是 eyebrow + h2 + 副标 + 小节
            标题 +「你的文件」，四层标题说同一件事（规格 §2.4.7「双标题收成一层」）。 */}
        <header className="lite-files-head">
          <h2 className="lite-files-title">{zoneTitle}</h2>
          {activeZone === 'files' && hasFiles ? (
            <p className="lite-files-count">
              {fill(l.filesCountLine, {
                n: files.length,
                size: formatBytes(totals.bytes),
                chunks: totals.chunks,
              })}
            </p>
          ) : null}
        </header>

        {/* 硬确认摆在**页头正下方**，不摆在内容末尾。两个理由，后一条是真机拍图逃到的：
            ① 它是一张 alertdialog，得在眼皮底下，不能要求用户先滚到底才看得见；
            ② 屏底那颗 `✦ 问 Avery` 胶囊是 fixed 的——摆在末尾时，「确认清空」刚好被它盖住
               （elementFromPoint 落在胶囊上）。销毁类按钮被家具抢走点击是
               verify-bottom-furniture-clearance 盯的正是这一类。 */}
        {confirmEmpty && contextId && canEmpty ? (
          <EmptyArchivePanel
            onClose={(emptied) => {
              setConfirmEmpty(false)
              // 🔴 判据取的是「这一次真的清空成功了」（store 回的那个 bool），**不是**
              //    「关面板时清单恰好是空的」——后者在一个本来就空的档案上点开又取消时也
              //    为真，于是屏上会印一句「你清空了这份档案」而用户什么都没做。
              if (emptied) setJustEmptied(true)
            }}
          />
        ) : null}

        {activeZone === 'files' ? (
          <section
            id="files-current"
            className="lite-files-section lite-files-current"
            aria-label={l.filesCurrentTitle}
          >
            {/* ── 工具条：上传 / 筛 / 排序 / 刷新，全在表格正上方 ───────────────────── */}
            <div className="lite-files-toolbar lite-files-uploader" data-upload-mode={uploadMode}>
              <input
                ref={up.inputRef}
                type="file"
                multiple
                accept={ACCEPT}
                className="upload-input"
                onChange={up.onPick}
                aria-hidden="true"
                tabIndex={-1}
              />
              <button
                type="button"
                className="lite-btn lite-btn--primary lite-files-upload-action"
                disabled={up.anyBusy || uploadBlocked}
                aria-busy={up.busy}
                onClick={up.openPicker}
              >
                <UploadIcon />
                <span>{l.filesUploadAction}</span>
              </button>
              {/* 「找」只按**文件名**筛。措辞刻意不写成「在这些文件里找」——那句话许诺的是
                  全文检索，而后端没有这个端点，我们只对得起文件名这一层。 */}
              <label className="lite-files-filter">
                <SearchIcon />
                <input
                  type="text"
                  className="lite-files-filter-input"
                  value={filter}
                  placeholder={l.filesFilterPlaceholder}
                  aria-label={l.filesFilterPlaceholder}
                  onChange={(e) => setFilter(e.target.value)}
                />
              </label>
              <span className="lite-files-toolbar-spacer" />
              {files.length > 1 ? <FileSortControl sort={sort} onChange={setSort} /> : null}
              {contextId ? (
                <button
                  type="button"
                  className="lite-btn lite-btn--ghost lite-files-refresh"
                  disabled={filesLoading}
                  aria-busy={filesLoading}
                  onClick={() => void refreshFiles()}
                >
                  {filesLoading ? t.upload.filesRefreshing : t.upload.filesRefresh}
                </button>
              ) : null}
            </div>

            {/* 示例克隆：不做假按钮，但也不装作这个功能不存在——说清楚为什么这儿传不进去。 */}
            {uploadBlocked ? (
              <p className="lite-files-empty lite-files-append-demo">{l.filesAppendDemoNote}</p>
            ) : null}

            {/* 🔴 拉失败要说出来，但清单**停在上一次的好结果上**：清空会把「我这次没读到」
                演成「你的文件没了」（absent≠none），而 live-frontend-gate 的 tokenDiscipline
                相位断言的正是 files.length 不变。变的只是屏上多了这一句。 */}
            {filesError ? (
              <p className="lite-files-empty lite-files-error" role="status">
                {t.upload.filesLoadError}{' '}
                <button
                  type="button"
                  className="lite-btn lite-btn--ghost lite-files-retry"
                  onClick={() => void refreshFiles()}
                >
                  {t.upload.filesRetry}
                </button>
              </p>
            ) : null}

            {hasFiles || shown.status !== 'idle' ? (
              <FileManifest
                withDownload
                table
                sort={sort}
                onSortChange={setSort}
                filter={filter}
                topRow={
                  shown.status === 'idle' ? null : (
                    <li className="upload-files-topline">
                      <UploadStatusBlock target={shown} showSourceChips={false} />
                    </li>
                  )
                }
              />
            ) : filesPending ? (
              <p className="lite-files-empty lite-files-loading" role="status">
                {t.upload.filesLoading}
              </p>
            ) : (
              <>
                <p className="lite-files-empty">
                  {!contextId ? l.filesCurrentEmptyNone
                    : justEmptied ? l.filesCurrentEmptyCleared
                      : l.filesCurrentEmptyRead}
                </p>
                {/* 空态下上传的三态也得有落点（首发 ingest 的两分钟、以及失败态——
                    verify-contrast-smalltext 的错误态世界就采这一族）。 */}
                <UploadStatusBlock target={shown} showSourceChips={false} />
              </>
            )}

            {/* 整块工作台都是投放区，所以这一句是**说明**不是控件：它不接点击、不长成
                第二个 dropzone（"两个方向相反的 dropzone 收成一个"那条规格）。 */}
            {!uploadBlocked ? (
              <p className="lite-files-dropnote">
                {l.filesDropHint}
                <span className="lite-files-dropnote-exts">{t.upload.acceptedExts}</span>
              </p>
            ) : null}
          </section>
        ) : null}

        {activeZone === 'forms' ? <StandingFormsSection /> : null}

        {activeZone === 'new' ? (
          // ── 新建一家公司（#88 会整条撤掉）──────────────────────────────────────
          // 🔴 诚实说明必须在上传口**之前**：这个口子每次 POST /ingest 都新铸一个 context。
          //    againTitle/againBody 这两条 copy 早就写好并审过字，却因为一次合并把 UI 整块
          //    吃掉而当了很久的孤儿键（AGENTS.md「孤儿文案键是红旗」那条说的就是它）。
          //    `showFiles={false}`：清单在「文件」那一区，两处都渲染 = 两个 `.upload-files`，
          //    门按类名全局取样会数出双倍行数。
          <section id="files-new" className="lite-files-section lite-files-upload" aria-label={l.filesUploadTitle}>
            <div className="lite-files-again" role="note">
              <p className="lite-files-again-title">{t.upload.againTitle}</p>
              <p className="lite-files-again-body">{t.upload.againBody}</p>
            </div>
            <UploadPanel showFiles={false} />
          </section>
        ) : null}

        {activeZone === 'switch' ? <SwitchSection /> : null}

      </div>
    </section>
  )
}
