import { useEffect, useState } from 'react'
import { useDict } from '../../shared/i18n/useDict'
import { useLite } from '../store'
import { FileManifest } from '../FileManifest'
import { KnownContextList } from '../KnownContextList'
import { UploadPanel } from '../UploadPanel'
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
//   ② 上传新一批 —— UploadPanel 整件 + 「另建一份画像」的诚实说明。
//   ③ 你上传过的几批 —— 多库切换（files-hub-0729/02）。
//   ④ 常驻表单 —— 模板 + 生成本期链接（选人、复制）+ 谁交了（gap-design-0805 T3）。
//
// ## 🔴 v1 刻意不做的
// 删除 / 重传 / 替换：后端写端点整批缺席（见 issue T3）。按"不建假按钮"红线，**UI 上一个
// 都不出现**——一个点了必然失败的删除键比没有删除键伤得多。愿景里那个「agent 自己的文件
// 空间」也不在这儿：那是 Vision 页的诚实预告，v1 只管用户上传的文件，两者不许混。
// files-hub-0729/02 · 第三段的外壳。抽成小组件只为一件事：小节标题与内容**同生共死**。
// 名册不足两批时 KnownContextList 返回 null，标题必须跟着消失——一个「你上传过的几批」
// 底下空无一物的小节，读起来像加载失败。
function SwitchSection() {
  const { t } = useDict()
  const known = useLite((s) => s.knownContexts)
  if (known.length < 2) return null
  return (
    <section className="lite-files-section lite-files-switch-section" aria-label={t.upload.switchTitle}>
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

// 服务端时刻 → 经理这台机器的本地时刻，`YYYY-MM-DD HH:mm`。
//
// 🔴 不能照抄别处那句 `iso.slice(0, 16).replace('T', ' ')`（AskCard 那行就是这么写的）：
// 后端发的是**带时区的 UTC 瞬间**（`datetime.now(timezone.utc).isoformat()`，pg 侧是
// timestamptz 的 isoformat），切片会把 `+00:00` 一起切掉，于是屏幕上那串数字被当成本地
// 墙上时钟读——对 UTC+8 的经理**恒早八小时，还经常连日期都差一天**。「周五截止前交的」
// 会显示成周四晚上，那是对着证据说假话。员工那张 H5 是靠在同一串数字后面印一个 " UTC"
// 躲开这件事的（form_api.py 的 `_submitted_extra`）；经理这一格不印，就必须真换算。
//
// 用 `new Date(iso)` 让浏览器解析偏移量（带 `+00:00` 或 `Z` 都认），再用**本地**取值器
// 逐位拼——全程没有一次手写的时区加减，那正是这类 bug 的来源。解析不出来就原样回退，
// 宁可显示一串原始 ISO，也不显示一个算错的时刻。
function localStamp(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso.slice(0, 16).replace('T', ' ')
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
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

  const [templateId, setTemplateId] = useState<string | null>(null)
  const [picked, setPicked] = useState<string[]>([])
  const [copiedId, setCopiedId] = useState<string | null>(null)

  // 🔴 hooks 必须全部跑在早退之前（下面四条 return null 在它们后面）。
  // 拉取挂在「经理打开了资料库屏」这个动作上，**不**并进 uploadFiles/restoreSession 那几处
  // 扇出（同 refreshAdviseRuns 挂 RoomScreen 的先例）：`GET /forms` 在服务端首次调用会写
  // （ensure_builtin_templates 铸内置周报），并进扇出等于把一次写变成常态后台流量。
  // 换公司时把本地挑选态一并清掉——上一家公司选中的那几个人不该留在这一家的按钮上。
  useEffect(() => {
    setPicked([])
    setCopiedId(null)
    void refreshForms()
  }, [refreshForms, contextId])

  const roster = team?.people ?? []
  const active = (templates ?? []).filter((tpl) => tpl.active)
  const selected = active.find((tpl) => tpl.id === templateId) ?? active[0] ?? null

  // 这张表的提交行。周期取**数据里最大的那一个**（ISO 周字符串 `YYYY-Www` 字典序即时间序），
  // 🔴 刻意不按本机时钟算「本周」：服务端的 period 是铸链那一刻定的（周五铸链、周一才填），
  // 前端再算一遍 ISO 周只会得出第二个真相，且跨年/跨时区各错一次。
  const rows = (submissions ?? []).filter((s) => s.template_id === (selected?.id ?? ''))
  const periods = rows.map((s) => s.period).filter(Boolean).sort()
  const latestPeriod = periods.length > 0 ? periods[periods.length - 1] : ''
  const statusRows = latestPeriod ? rows.filter((s) => s.period === latestPeriod) : rows

  // 🔴 四条否决，每一条都是「这一段现在没有任何真东西可说」——标题跟着内容一起消失，
  // 因为一个底下空无一物的小节读起来像加载失败（SwitchSection 那条注释说的就是这件事）。
  //  ① 没有 contextId：还没有公司，链接无处可铸。
  //  ② templates === null：没拉过 / 这条通道没有这个方法 / 拉失败。**不是**「这家公司没有
  //     表单」——404 是后端对缺凭据的无枚举答复，不承载存在信息（absent≠none）。
  //  ③ 一张在用的模板都没有：200 回来确实是空的，那也没有可发的表。
  //  ④ 既没有花名册可选人、又一条提交记录都没有：两个子块都空，只剩标题最误导。
  if (!contextId) return null
  if (templates === null) return null
  if (!selected) return null
  if (roster.length === 0 && rows.length === 0) return null

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
  }

  const mint = () => {
    if (!selected) return
    const recipients = picked
      .map((id) => ({ id, name: roster.find((p) => p.id === id)?.name ?? '' }))
      // 后端 name 是 min_length=1 的必填——名字空的人送过去只会换回一个 422，
      // 而经理看到的会是一句「这次没生成成」，查不出是哪一行的锅。
      .filter((r) => r.name.trim().length > 0)
    void createFormLinks(selected.id, recipients)
  }

  // clipboard 可能被拒（headless / 无 https / 权限）——降级 execCommand，两条都失败也不崩。
  // 链接文本本身恒可见可选，复制不了还能手动选（同 AskCard.copyLink 的姿态）。
  const copyLink = async (link: string, rowId: string) => {
    let ok = false
    try {
      await navigator.clipboard.writeText(link)
      ok = true
    } catch {
      try {
        const ta = document.createElement('textarea')
        ta.value = link
        document.body.appendChild(ta)
        ta.select()
        ok = document.execCommand('copy')
        document.body.removeChild(ta)
      } catch {
        ok = false
      }
    }
    if (ok) setCopiedId(rowId)
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
    <section className="lite-files-section lite-files-forms" aria-label={l.formsTitle}>
      <h3 className="lite-files-section-title">{l.formsTitle}</h3>
      <p className="lite-files-empty">{l.formsLede}</p>

      {/* 模板列表。只有一张时不给切换按钮——一个唯一选项的单选组是纯噪音；题面预览照给，
          经理发出去之前有权看清员工会被问到什么。 */}
      <ul className="lite-files-forms-templates">
        {active.map((tpl) => {
          const isSelected = tpl.id === selected.id
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

      {/* 选人 + 生成。没有花名册就整块不出——没有人可选时一个「生成链接」按钮点了必然
          什么都不会发生，那就是假按钮。 */}
      {roster.length > 0 ? (
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
                </button>
              )
            })}
          </div>
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

      {/* 谁交了。没有一条铸过的链接时整块不出——那时候「谁交了」的答案是「你还没发给谁」，
          而上面那个生成按钮已经把这句话说完了。 */}
      {statusRows.length > 0 ? (
        <div className="lite-files-forms-status-block">
          <p className="lite-files-forms-label">
            {l.formsStatusTitle}
            {latestPeriod ? <span className="lite-files-forms-period">{latestPeriod}</span> : null}
          </p>
          <ul className="lite-files-forms-status">
            {statusRows.map((row) => {
              const view = statusView(row)
              return (
                <li key={row.id} className="lite-files-forms-status-row" data-tone={view.tone}>
                  <span className="lite-files-forms-status-name">{row.person_name}</span>
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
                </li>
              )
            })}
          </ul>
        </div>
      ) : null}
    </section>
  )
}

export function FilesScreen() {
  const { t } = useDict()
  const l = t.lite2
  const files = useLite((s) => s.files)
  const contextId = useLite((s) => s.contextId)

  // 🔴「还没传过」和「传了但读不出来」是两件事，文案必须分得开。这里只判前者：
  // 有 contextId 但清单为空 = 后端确实没给出文件，那是 ② 段上传口要回答的问题，
  // 不是这一段该替它编一句"可能还在处理"。
  const hasFiles = files.length > 0

  return (
    <section className="scene scene-nexus is-active lite-files" aria-label={l.tabFiles}>
      <div className="lite-files-scroll">
        <header className="lite-files-head">
          <p className="eyebrow lite-files-eyebrow">{l.filesEyebrow}</p>
          <h2>{l.filesHeading}</h2>
          <p className="lite-files-sub">{l.filesSub}</p>
        </header>

        {/* ── ① 当前资料 ─────────────────────────────────────────────────────────
            清单本体是共享件（与上传口底下那份同一个组件），这里多开下载列。
            🔴 下载走 fetch+blob+objectURL：端点吃 owner_token header，裸 <a href> 带不上
            （见 FileManifest.downloadOne 与 transport.downloadFile 的注释）。 */}
        <section className="lite-files-section lite-files-current" aria-label={l.filesCurrentTitle}>
          <h3 className="lite-files-section-title">{l.filesCurrentTitle}</h3>
          {hasFiles ? (
            <FileManifest withDownload />
          ) : (
            <p className="lite-files-empty">
              {contextId ? l.filesCurrentEmptyRead : l.filesCurrentEmptyNone}
            </p>
          )}
        </section>

        {/* ── ② 上传新一批 ───────────────────────────────────────────────────────
            🔴 诚实说明必须在上传口**之前**：后端每次 POST /ingest 都新铸一个 context，
            传旧 id 是重建并覆盖而不是追加（见 store.ts 顶部那段）。改造前界面一路邀请
            "再加点文件"，然后把屏幕悄悄换成新的那一份，且没有任何回得去的入口——经理的
            读法是"我把数据弄丢了"。againTitle/againBody 这两条 copy 早就写好并审过字，
            却因为一次合并把 UI 整块吃掉而当了很久的孤儿键（AGENTS.md「孤儿文案键是红旗」
            那条说的就是它）。这里把它们接回去。
            `showFiles={false}`：上面 ① 段已经有一份清单了，两处都渲染 = 两个
            `.upload-files`，门按类名全局取样会数出双倍行数。 */}
        <section className="lite-files-section lite-files-upload" aria-label={l.filesUploadTitle}>
          <h3 className="lite-files-section-title">{l.filesUploadTitle}</h3>
          <div className="lite-files-again" role="note">
            <p className="lite-files-again-title">{t.upload.againTitle}</p>
            <p className="lite-files-again-body">{t.upload.againBody}</p>
          </div>
          <UploadPanel showFiles={false} />
        </section>

        {/* ── ③ 你上传过的几批 ───────────────────────────────────────────────────
            files-hub-0729/02 · 多库切换。KnownContextList 在只有 0/1 批时自己返回 null
            ——所以这里连标题一起藏，否则会留下一个「你上传过的几批」下面什么都没有的空
            小节（比不显示更让人以为出了问题）。 */}
        <SwitchSection />

        {/* ── ④ 常驻表单 ─────────────────────────────────────────────────────────
            gap-design-0805 T3 · 常驻表单主线 3/3。同 ③ 的「没有内容整段不渲染」纪律，
            四条否决写在 StandingFormsSection 里。摆在最后一段是因为它是**发起**动作
            （生成链接发出去），而前三段是回看动作——先看到已有的，再决定要不要再收一轮。 */}
        <StandingFormsSection />
      </div>
    </section>
  )
}
