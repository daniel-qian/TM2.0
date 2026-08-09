import { useEffect, useState } from 'react'
import { useDict } from '../../shared/i18n/useDict'
import { useLite } from '../store'
import { FileManifest, localStamp } from '../FileManifest'
import { KnownContextList } from '../KnownContextList'
import { UploadPanel } from '../UploadPanel'
import { FormBuilder } from '../FormBuilder'
import type { LiveFormSubmission } from '../transport'

// files-hub-0729/01（ADR-0032）· 资料库屏。
//
// ## 这一屏解决什么
// 改造前「文件」这件事散在三屏四点：团队屏满态右栏一个上传面板、团队屏空态又一个、首页
// 骨架卡一个、引导闸里还有一套自己的实现。而"我传过什么、现在用的是哪一批、能不能拿回来"
// 这三个问题**一个都没有落点**——清单只在上传面板底下顺带渲染，下载端点后端有、前端从未接，
// 多库切换 store 里全套现成、UI 从来没长出来。资料库屏是这些问题的那个落点。
//
// ## 四段
//   ① 当前资料 —— 这一批文件的清单 + 逐份下载（FileManifest withDownload）。
//   ② 上传新一批 —— UploadPanel 整件 + 「新建一家公司」的诚实说明。
//   ③ 这台电脑上传过的公司 —— 多库切换（files-hub-0729/02）。
//   ④ 常驻表单 —— 模板 + 生成本期链接（选人、复制）+ 谁交了（gap-design-0805 T3）。
//
// ## 🔴 v1 刻意不做的
// 删除 / 重传 / 替换：后端写端点整批缺席（见 issue T3）。按"不建假按钮"红线，**UI 上一个
// 都不出现**——一个点了必然失败的删除键比没有删除键伤得多。愿景里那个「agent 自己的文件
// 空间」也不在这儿：那是 Vision 页的诚实预告，v1 只管用户上传的文件，两者不许混。
// files-hub-0729/02 · 第三段的外壳。抽成小组件只为一件事：小节标题与内容**同生共死**。
// 名册不足两批时 KnownContextList 返回 null，标题必须跟着消失——一个「这台电脑上传过的公司」
// 底下空无一物的小节，读起来像加载失败。
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

// T10 · 「给这家公司补资料」——第 ②a 段的外壳。抽成小组件的理由同 SwitchSection：
// 小节标题与内容**同生共死**，三条否决里任何一条成立时整段（含标题）一起消失。
function AppendSection() {
  const { t } = useDict()
  const l = t.lite2
  const contextId = useLite((s) => s.contextId)
  const rawTeam = useLite((s) => s.rawTeam)
  const canAppend = useLite((s) => !!s.transport.appendFiles)

  if (!contextId || !canAppend) return null
  // 一次性副本：不做假按钮，但也不装作这个功能不存在——说清楚为什么这儿没有口子。
  if (rawTeam?.ephemeral) {
    return (
      <section id="files-append" className="lite-files-section lite-files-append" aria-label={l.filesAppendTitle}>
        <h3 className="lite-files-section-title">{l.filesAppendTitle}</h3>
        <p className="lite-files-empty">{l.filesAppendDemoNote}</p>
      </section>
    )
  }
  return (
    <section id="files-append" className="lite-files-section lite-files-append" aria-label={l.filesAppendTitle}>
      <h3 className="lite-files-section-title">{l.filesAppendTitle}</h3>
      <p className="lite-files-empty">{l.filesAppendLede}</p>
      <UploadPanel showFiles={false} mode="append" />
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

// gap-design-0805 T3 · form-frontend-a1c · 第④段的外壳（抽成小组件的理由同 SwitchSection：
// 小节标题与内容同生共死）。
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
// ## 为什么整段可能一个像素都不渲染
// 见下面四条否决。stub 通道（?transport=stub）没有这三个端点，判空即整段消失——这也是
// 像素基线里 files 屏不变的原因：那条 spec 全程 stub 且从不上传，压根没有 contextId。
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

  // 🔴 hooks 必须全部跑在早退之前（下面四条 return null 在它们后面）。
  // 拉取挂在「经理打开了资料库屏」这个动作上，**不**并进 uploadFiles/restoreSession 那几处
  // 扇出（同 refreshAdviseRuns 挂 RoomScreen 的先例）：`GET /forms` 在服务端首次调用会写
  // （ensure_builtin_templates 铸内置周报），并进扇出等于把一次写变成常态后台流量。
  // 换公司时把本地挑选态一并清掉——上一家公司选中的那几个人不该留在这一家的按钮上。
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
  // ⚠ gap2 T11 拆掉了原来的第 ③④ 条（「一张在用的模板都没有」「既没花名册又没提交记录」）。
  // 那两条当年是对的：那时候这一段只能做「发内置周报」，没模板/没人选就真的一件事都做不了。
  // 现在这一段还能**建表**——而第 ④ 条恰好在最需要它的时候把入口拿掉：一家刚上传完、花名册
  // 还没解析出来的公司会命中它，于是「新建表单」在第一天不存在。两条改成各自包住自己那一块
  // （下面 `roster.length > 0` / `statusRows.length > 0` / `selected` 三处判空）。
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

      {/* ── #76 · 「谁交了」提到 ④ 段最前 ────────────────────────────────────────────
          频率倒挂是这一屏最大的病：铸链是**一周一次**的动作，却占着 ④ 的黄金位；而经理
          周中天天要看的「谁交了」压在整块最底，要滚过建表入口、chips 墙、逐人绑项目下拉
          才到。这里把它提到前面——下面的铸链/拼装器一个字没动，只是排在它后面。
          🔴 计算量（statusRows / latestPeriod）本来就在早退之上、与位置无关，直接搬。 */}
      {/* 谁交了。没有一条铸过的链接时整块不出——那时候「谁交了」的答案是「你还没发给谁」，
          而上面那个生成按钮已经把这句话说完了。 */}
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

      {/* 模板列表。只有一张时不给切换按钮——一个唯一选项的单选组是纯噪音；题面预览照给，
          经理发出去之前有权看清员工会被问到什么。
          ⚠ gap2 T11：一张在用的模板都没有时，这个 <ul> 渲染成空——底下的拼装器仍在，
          经理可以从这里建第一张（这正是拆掉那条早退的原因）。 */}
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

      {/* gap2 T11 · 模板拼装器（建一张 / 复制一张改 / 让 Avery 读旧表格起草）。
          摆在模板列表和「选人生成链接」之间：先有表，才谈发给谁。
          🔴 它**不受**下面那两块的判空约束——花名册还没解析出来的第一天，恰恰是最该能建表的
          时候（原来那条 `roster.length === 0 && rows.length === 0` 早退会把它一起藏掉）。 */}
      <FormBuilder templates={templates ?? []} />

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

      {/* 刚铸出来的这一批链接。刻意与下面的「谁交了」分开：这几条是经理此刻要粘出去的，
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

    </section>
  )
}

// #76 · 页内导航。整屏此前是一长条 4000px+ 的单列堆叠，零锚点零目录——经理要找「谁交了」
// 只能滚。锚点是**纯加法**：段落 DOM 一个字节不动，只是各自补了 id。
//
// 🔴 刻意不做折叠（display:none）：playwright 在隐藏元素上会给出**四种并存的结局**——
// `hasText` 照样命中（elementText 只递归 TEXT_NODE、从不查计算样式）于是随后的 .click()
// 等到 30s 超时把门**崩**掉；`.innerText()` 返空串于是判据以「文案不对」**假红**；
// `.count()` / `querySelectorAll().length` 完全免疫于是继续**假绿**；段级 `.screenshot()`
// 直接抛错。一道门里四种结局并存，读日志的人会把它归因成四个不同的 bug。要折叠得同 commit
// 给每道门补一步「先展开」，那是 #79 重冻那一趟一起做的事。
type FilesNavItem = { id: string; label: string }

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
  const rawTeam = useLite((s) => s.rawTeam)

  // 🔴「还没传过」和「传了但读不出来」是两件事，文案必须分得开。这里只判前者：
  // 有 contextId 但清单为空 = 后端确实没给出文件，那是 ② 段上传口要回答的问题，
  // 不是这一段该替它编一句"可能还在处理"。
  const hasFiles = files.length > 0
  // 🔴 「还在读」与「读完了是空的」必须分得开：本屏此前不读 restoring/filesLoading，于是
  // 回访者第一帧、切库那一瞬都会**闪**一句「Avery 没列出任何文件」——那是对着一个还没
  // 发生的结论下判断。
  const filesPending = (restoring || filesLoading) && !hasFiles

  // 导航项跟着段落的真实存在性走：一条指向不存在的锚点比没有导航更糟。
  const nav: FilesNavItem[] = [
    { id: 'files-current', label: l.filesCurrentTitle },
    ...(contextId ? [{ id: 'files-forms', label: l.formsTitle }] : []),
    ...(contextId && canAppend && !rawTeam?.ephemeral
      ? [{ id: 'files-append', label: l.filesAppendTitle }] : []),
    { id: 'files-new', label: l.filesUploadTitle },
    ...(knownCount >= 2 ? [{ id: 'files-switch', label: t.upload.switchTitle }] : []),
  ]

  return (
    <section className="scene scene-nexus is-active lite-files" aria-label={l.tabFiles}>
      <div className="lite-files-scroll">
        <header className="lite-files-head">
          <p className="eyebrow lite-files-eyebrow">{l.filesEyebrow}</p>
          <h2>{l.filesHeading}</h2>
          <p className="lite-files-sub">{l.filesSub}</p>
        </header>

        {/* #76 · 页内导航（锚点，非折叠——理由见 FilesNavItem 上面那段）。 */}
        {nav.length > 1 ? (
          <nav className="lite-files-nav" aria-label={l.tabFiles}>
            {nav.map((item) => (
              <a key={item.id} className="lite-files-nav-link" href={`#${item.id}`}>
                {item.label}
              </a>
            ))}
          </nav>
        ) : null}

        {/* ── ① 当前资料 ─────────────────────────────────────────────────────────
            清单本体是共享件（与上传口底下那份同一个组件），这里多开下载列。
            🔴 下载走 fetch+blob+objectURL：端点吃 owner_token header，裸 <a href> 带不上
            （见 FileManifest.downloadOne 与 transport.downloadFile 的注释）。 */}
        <section id="files-current" className="lite-files-section lite-files-current" aria-label={l.filesCurrentTitle}>
          <h3 className="lite-files-section-title">
            {l.filesCurrentTitle}
            {/* #76 · 手动刷新。真闸在 store 的临界区（同一拍双击 UI 的 disabled 顶不住）。 */}
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
          </h3>
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
          {hasFiles ? (
            <FileManifest withDownload />
          ) : filesPending ? (
            <p className="lite-files-empty lite-files-loading" role="status">
              {t.upload.filesLoading}
            </p>
          ) : (
            <p className="lite-files-empty">
              {contextId ? l.filesCurrentEmptyRead : l.filesCurrentEmptyNone}
            </p>
          )}
        </section>

        {/* ── ②a 给这家公司补资料（T10）─────────────────────────────────────────
            这一段是「每次上传=新开一家公司」那堵墙被拆掉之后新长出来的口子：文件并进**当前**
            这家公司，卡片安静更新到新读数，新旧对不上的地方走今天页那条双栏通道。

            三条否决，每条都是「这里现在没有一个诚实的按钮可放」：
             ① 没有 contextId —— 还没有公司，"补"无从谈起（下面 ②b 才是开公司的口子）。
             ② 这份工作区是一次性的示例克隆（后端 `ephemeral`）—— 补进去的资料会随 TTL 回收
                一起消失，经理却会以为存下来了。**先禁入口**是本票的明确边界（克隆连表单表
                都没复制），所以这里不做假按钮，只留一句说明。
                🔴 判据取自后端每帧都发的 `ephemeral`，不是只在领取首帧出现的 `demo`——
                后者刷新一次页面就没了，入口会自己冒出来（那读起来像 bug，不像功能）。
             ③ 这条通道没有 appendFiles（stub / 老后端）—— 同 demoClaim 的先例，能力探测判空。 */}
        {/* ── #76 · 段落按**使用频率**重排 ─────────────────────────────────────────
            旧序是 ①当前资料 → ②a补资料 → ②b另建公司 → ③切换 → ④常驻表单，按的是"先回看
            再发起"的叙事。真实使用频率正好相反：④ 里的「谁交了」是**周中天天**要看的一格，
            却被压在整屏最底（要滚过建表入口和 chips 墙）；而「另建一家公司」是一辈子点几次
            的动作，占着第三段的黄金位。
            新序 = ①当前资料 → ④常驻表单（「谁交了」已提到它的最前）→ ②a补资料 → ②b另建
            公司 → ③切换。段内 DOM 一个字节没动，只是排列顺序变了——这也是重构代价最低的
            那一刀（像素之外只碰几何类的门）。 */}
        {/* ── ④ 常驻表单 ─────────────────────────────────────────────────────────
            gap-design-0805 T3 · 常驻表单主线 3/3。同 ③ 的「没有内容整段不渲染」纪律，
            四条否决写在 StandingFormsSection 里。摆在最后一段是因为它是**发起**动作
            （生成链接发出去），而前三段是回看动作——先看到已有的，再决定要不要再收一轮。 */}
        <StandingFormsSection />

        <AppendSection />

        {/* ── ②b 新建一家公司 ───────────────────────────────────────────────────
            🔴 诚实说明必须在上传口**之前**：这个口子每次 POST /ingest 都新铸一个 context。
            改造前界面一路邀请"再加点文件"，然后把屏幕悄悄换成新的那一份，且没有任何回得去的
            入口——经理的读法是"我把数据弄丢了"。againTitle/againBody 这两条 copy 早就写好并
            审过字，却因为一次合并把 UI 整块吃掉而当了很久的孤儿键（AGENTS.md「孤儿文案键是
            红旗」那条说的就是它）。这里把它们接回去。
            T10 之后这两句必须改口：以前"合并"根本不存在，说"不会并进"是全部真相；现在**存在**
            另一条会合并的路（就在上面 ②a），再说同一句话就是把经理往错的按钮上引。
            `showFiles={false}`：上面 ① 段已经有一份清单了，两处都渲染 = 两个
            `.upload-files`，门按类名全局取样会数出双倍行数。 */}
        <section id="files-new" className="lite-files-section lite-files-upload" aria-label={l.filesUploadTitle}>
          <h3 className="lite-files-section-title">{l.filesUploadTitle}</h3>
          <div className="lite-files-again" role="note">
            <p className="lite-files-again-title">{t.upload.againTitle}</p>
            <p className="lite-files-again-body">{t.upload.againBody}</p>
          </div>
          <UploadPanel showFiles={false} />
        </section>

        {/* ── ③ 这台电脑上传过的公司 ─────────────────────────────────────────────
            files-hub-0729/02 · 多库切换。KnownContextList 在只有 0/1 批时自己返回 null
            ——所以这里连标题一起藏，否则会留下一个「这台电脑上传过的公司」下面什么都没有的空
            小节（比不显示更让人以为出了问题）。 */}
        <SwitchSection />

      </div>
    </section>
  )
}
