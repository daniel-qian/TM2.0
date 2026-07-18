import { useRef } from 'react'
import { useLite } from './store'
import { useDict } from '../shared/i18n/useDict'
import { InitialAvatar } from './InitialAvatar'
import { LiteModal } from './LiteModal'
import type { LiteDetail } from './store'
import type { LiteTeam } from './teamData'

// feat-024 · 薄只读详情浮层——ADR-0022 决策 2（v1 范围拍板）。
// 点人卡/项目卡开 ~百行纯 live payload 浮层：名字/角色/owns/来源文件——零 fixtures，
// 杀死 "Unknown teammate"（story 详情页只查 fixtures 的确诊渗漏）。
// 🔴 红线：人的浮层只显定性事实（角色/负责/协作/任期）；指向人的信号原样当"情境"呈现，
// 永不出现评分/排名/%。项目可硬（progress 数字允许）。
//
// feat-052：底座换成 LiteModal（背景点击 / Esc / 滚动锁 / 进出场动画 / 焦点管理 / 层级
// 统一走基座）。本体内容一行未改——只是不再自己挂 Escape 监听、不再自己画背景与卡片外壳。

export function DetailOverlay() {
  const { t } = useDict()
  const liveDetail = useLite((s) => s.detail)
  const liveTeam = useLite((s) => s.team)
  const rawTeam = useLite((s) => s.rawTeam)
  const closeDetail = useLite((s) => s.closeDetail)

  const open = Boolean(liveDetail && liveTeam)

  // 出场动画期间 store.detail 已经是 null，但面板还在屏上——留住最后一帧快照，否则关闭瞬间
  // 内容整块闪没、只剩一个空壳在缩。（LiteModal 的 open 由 store 驱动，这是配套写法。）
  const lastRef = useRef<{ detail: NonNullable<LiteDetail>; team: LiteTeam } | null>(null)
  if (liveDetail && liveTeam) lastRef.current = { detail: liveDetail, team: liveTeam }
  const held = liveDetail && liveTeam ? { detail: liveDetail, team: liveTeam } : lastRef.current

  const detail = held?.detail ?? null
  const team = held?.team ?? null

  const signals = (rawTeam?.signals ?? []).filter(
    (sig) =>
      sig.subjectId === detail?.id && (sig.subjectType === 'person' || sig.subjectType === 'project'),
  )
  const sourceFiles = team?.sourceFiles ?? []

  const person =
    detail?.kind === 'person' && team ? team.people.find((p) => p.id === detail.id) ?? null : null
  const project =
    detail?.kind === 'project' && team ? team.projects.find((p) => p.id === detail.id) ?? null : null

  return (
    <LiteModal
      open={open}
      onClose={closeDetail}
      ariaLabel={t.lite2.detailAria}
      backdropLabel={t.lite2.detailClose}
      panelClassName="lite-detail-card"
    >
      <button type="button" className="lite-detail-close" onClick={closeDetail}>
        {t.lite2.detailClose}
      </button>

      {person ? (
        <>
          <header className="lite-detail-head">
            <InitialAvatar name={person.name} size={52} className="lite-detail-avatar" />
            <div>
              <p className="eyebrow">{t.lite2.detailPersonEyebrow}</p>
              <h2>{person.name}</h2>
              <p className="lite-detail-subtitle">
                {[person.role, person.team].filter(Boolean).join(' · ')}
              </p>
            </div>
          </header>

          {person.tenure ? (
            <section className="lite-detail-section">
              <p className="eyebrow">{t.lite2.detailTenure}</p>
              <p>{person.tenure}</p>
            </section>
          ) : null}

          {person.owns && person.owns.length > 0 ? (
            <section className="lite-detail-section">
              <p className="eyebrow">{t.lite2.detailOwns}</p>
              <ul>
                {person.owns.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </section>
          ) : null}

          {person.collaboration && person.collaboration.length > 0 ? (
            <section className="lite-detail-section">
              <p className="eyebrow">{t.lite2.detailCollab}</p>
              <ul>
                {person.collaboration.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </section>
          ) : null}
        </>
      ) : null}

      {project ? (
        <>
          <header className="lite-detail-head">
            <div>
              <p className="eyebrow">{t.lite2.detailProjectEyebrow}</p>
              <h2>{project.title}</h2>
              <p className="lite-detail-subtitle">
                {project.status} · {project.ownerName}
                {project.dueDate ? ` · ${project.dueDate}` : ''}
              </p>
            </div>
          </header>

          {project.summary ? (
            <section className="lite-detail-section">
              <p className="eyebrow">{t.lite2.detailSummary}</p>
              <p>{project.summary}</p>
            </section>
          ) : null}

          {typeof project.progress === 'number' ? (
            <section className="lite-detail-section">
              <p className="eyebrow">{t.lite2.detailProgress}</p>
              <p>{project.progress}%</p>
            </section>
          ) : null}

          {project.blockers && project.blockers.length > 0 ? (
            <section className="lite-detail-section">
              <p className="eyebrow">{t.lite2.detailBlockers}</p>
              <ul>
                {project.blockers.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </section>
          ) : null}
        </>
      ) : null}

      {detail && !person && !project ? (
        // 只有数据刷新竞态才可能到这——不渲染 "Unknown"（story 渗漏的口径），显平静空态。
        <section className="lite-detail-section">
          <p>{t.lite2.detailGone}</p>
        </section>
      ) : null}

      {signals.length > 0 ? (
        <section className="lite-detail-section">
          <p className="eyebrow">{t.lite2.detailSignals}</p>
          <ul>
            {signals.map((sig) => (
              <li key={sig.id}>{sig.summary}</li>
            ))}
          </ul>
        </section>
      ) : null}

      {sourceFiles.length > 0 ? (
        <section className="lite-detail-section lite-detail-source">
          <p className="eyebrow">{t.lite2.detailSource}</p>
          <p>
            {sourceFiles.map((name) => (
              <span key={name} className="upload-source-chip">
                {name}
              </span>
            ))}
          </p>
        </section>
      ) : null}
    </LiteModal>
  )
}
