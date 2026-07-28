import { useState } from 'react'
import { useDict } from '../../shared/i18n/useDict'
import { FORM_DOCS, LEGAL_DOCS } from './catalog'
import type { DocBlock, PaperDoc } from './types'

// partner-docs-0728 · `/paperwork`「文件与表单」页。
//
// 它**不是第九屏**：不进 routes.ts 的 LiteScreen 联合类型、不进顶栏 tab（顶栏已经 9 个 tab
// 且正在因窄屏溢出被另一条线修，见 LiteTopbar.tsx 的 uiux-narrow-0728 段），data-scene 仍是
// 底下那一屏。它是挂在壳里的一张独立页，入口只有三处：上传面板、顶栏设置菜单、
// onboarding 上传步。
//
// 🔴 内部批注默认**隐藏**。合伙人的草案里夹着起草者写给自己人的话（DPA 第三条后那句
// 「谈判中甲方可能要求乙方承担脱敏义务，需谨慎权衡」是我方谈判底牌），默认显示的话，
// 哪天 Danny 把这一页转给客户看就当场念出去了。默认关、要看自己开——安全的那一侧当默认。
//
// 🔴 三份法律文件都是 v0.1 草案，隐私政策首行明写「未经执业律师审核不得对外发布」。
// 所以整页顶部有一条常驻横幅 + 每份文件的草案徽章：样本文本，实际条款以双方签署版本为准。
// 这条横幅是这一页能存在的前提，不是装饰——删它之前先读 docs/adr/0030-*.md。

function Block({ block, showNotes }: { block: DocBlock; showNotes: boolean }) {
  const { t } = useDict()
  switch (block.kind) {
    case 'h':
      return <h4 className="paperwork-doc-h">{block.text}</h4>
    case 'p':
      return <p className="paperwork-doc-p">{block.text}</p>
    case 'ul':
      return (
        <ul className="paperwork-doc-ul">
          {block.items.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      )
    case 'table':
      return (
        // 表格自己横向滚，页面本身永远不横滚（窄屏上 4 列的附件一必然超宽）。
        <div className="paperwork-doc-tablewrap">
          <table className="paperwork-doc-table">
            {block.head.length > 0 ? (
              <thead>
                <tr>
                  {block.head.map((h) => (
                    <th key={h}>{h}</th>
                  ))}
                </tr>
              </thead>
            ) : null}
            <tbody>
              {block.rows.map((row) => (
                <tr key={row.join('|')}>
                  {row.map((cell, i) => (
                    <td key={i}>{cell}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )
    case 'note':
      if (!showNotes) return null
      return (
        <aside className="paperwork-doc-note">
          <span className="paperwork-doc-note-tag">{t.paperwork.internalNoteTag}</span>
          <span>{block.text}</span>
        </aside>
      )
    case 'choice':
      return (
        <p className="paperwork-doc-p">
          {block.label}
          {block.options.map((opt) => (
            <span key={opt} className="paperwork-doc-choice">
              <span aria-hidden="true">□</span> {opt}
            </span>
          ))}
        </p>
      )
    case 'sign':
      // 🔴 落款区**不走 i18n**，两种语言下都是中文——它是协议正文的一部分，而正文是逐字
      // 转录的中文合同（页面外壳可以是英文，条款不能）。把「甲方（盖章）」翻成
      // "Party A (seal)" 会让人以为存在一份英文版协议，那是不存在的东西。
      return (
        <div className="paperwork-doc-sign">
          {['甲方（盖章）：', '乙方（盖章）：'].map((party) => (
            <div key={party} className="paperwork-doc-sign-col">
              <p>{party}</p>
              <p>法定代表人 / 授权代表：</p>
              <p>日期：　　年　　月　　日</p>
            </div>
          ))}
        </div>
      )
  }
}

function DocCard({ doc, showNotes }: { doc: PaperDoc; showNotes: boolean }) {
  const { t } = useDict()
  const [open, setOpen] = useState(false)
  const bodyId = `paperwork-body-${doc.id}`

  return (
    <article className="paperwork-card" data-doc-id={doc.id} data-section={doc.section}>
      <header className="paperwork-card-head">
        <div className="paperwork-card-title">
          <h3>{doc.title}</h3>
          {doc.section === 'legal' ? (
            <span className="paperwork-draft-badge">{t.paperwork.draftBadge}</span>
          ) : null}
        </div>
        <p className="paperwork-card-sub">{doc.subtitle}</p>
        <p className="paperwork-card-audience">{doc.audience}</p>
      </header>

      {/* 下载区永远可见、永远在正文之前：真正要拿去用的是原件，页内正文只是「不下载也能读」。 */}
      <ul className="paperwork-files">
        {doc.files.map((file) => (
          <li key={file.href} className="paperwork-file">
            <a
              className="lite-btn lite-btn--ghost paperwork-file-link"
              href={file.href}
              download={file.download}
            >
              <span className="paperwork-file-format" aria-hidden="true">
                {file.format}
              </span>
              <span className="paperwork-file-name">{file.download}</span>
              <span className="paperwork-file-size">{file.size}</span>
            </a>
            {file.hint ? <p className="paperwork-file-hint">{file.hint}</p> : null}
          </li>
        ))}
      </ul>

      <button
        type="button"
        className="lite-btn lite-btn--ghost paperwork-toggle"
        aria-expanded={open}
        aria-controls={bodyId}
        onClick={() => setOpen((v) => !v)}
      >
        {open ? t.paperwork.collapse : t.paperwork.expand}
      </button>

      {open ? (
        <div className="paperwork-doc-body" id={bodyId}>
          {doc.blocks.map((block, i) => (
            <Block key={i} block={block} showNotes={showNotes} />
          ))}
          <p className="paperwork-provenance">{doc.provenance}</p>
        </div>
      ) : null}
    </article>
  )
}

export function PaperworkScreen() {
  const { t } = useDict()
  // 见文件头：默认关。开了之后只影响本次会话的这一页，不落 localStorage——
  // 「上次开过」不该成为下次带客户看时的地雷。
  const [showNotes, setShowNotes] = useState(false)

  return (
    <section className="scene is-active paperwork-page" data-scene-name="paperwork">
      <div className="paperwork-inner">
        <header className="paperwork-head">
          <h1>{t.paperwork.title}</h1>
          <p className="paperwork-lede">{t.paperwork.lede}</p>
          {/* 文件正文两种语言下都是中文（见 docNda/docDpa/... 的文件头）。英文界面下如实说一句，
              中文界面下这句是空串、整条不渲染——不为了对齐而编一句废话。 */}
          {t.paperwork.langNote ? (
            <p className="paperwork-langnote">{t.paperwork.langNote}</p>
          ) : null}
        </header>

        {/* 🔴 常驻免责横幅。删它之前先读 docs/adr/0030-*.md。 */}
        <p className="paperwork-banner" role="note">
          {t.paperwork.draftBanner}
        </p>

        <section className="paperwork-section" aria-labelledby="paperwork-forms-h">
          <h2 id="paperwork-forms-h">{t.paperwork.formsHeading}</h2>
          <p className="paperwork-section-lede">{t.paperwork.formsLede}</p>
          {FORM_DOCS.map((doc) => (
            <DocCard key={doc.id} doc={doc} showNotes={showNotes} />
          ))}
        </section>

        <section className="paperwork-section" aria-labelledby="paperwork-legal-h">
          <h2 id="paperwork-legal-h">{t.paperwork.legalHeading}</h2>
          <p className="paperwork-section-lede">{t.paperwork.legalLede}</p>
          <label className="paperwork-notes-toggle">
            <input
              type="checkbox"
              checked={showNotes}
              onChange={(e) => setShowNotes(e.target.checked)}
            />
            <span>{t.paperwork.showNotes}</span>
          </label>
          {LEGAL_DOCS.map((doc) => (
            <DocCard key={doc.id} doc={doc} showNotes={showNotes} />
          ))}
        </section>
      </div>
    </section>
  )
}
