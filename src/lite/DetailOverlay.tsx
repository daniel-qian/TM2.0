import { useLite } from './store'
import { useDict } from '../shared/i18n/useDict'
import { projectStatusText } from '../shared/projectStatus'
import { InitialAvatar } from './InitialAvatar'

// feat-024 · 薄只读详情浮层——ADR-0022 决策 2（v1 范围拍板）。
// 点人卡/项目卡开 ~百行纯 live payload 浮层：名字/角色/owns/来源文件——零 fixtures，
// 杀死 "Unknown teammate"（story 详情页只查 fixtures 的确诊渗漏）。
// 🔴 红线：人的浮层只显定性事实（角色/负责/协作/任期）；指向人的信号原样当"情境"呈现，
// 永不出现评分/排名/%。项目可硬（progress 数字允许）。

export function DetailOverlay() {
  const { t } = useDict()
  const detail = useLite((s) => s.detail)
  const team = useLite((s) => s.team)
  const rawTeam = useLite((s) => s.rawTeam)
  const closeDetail = useLite((s) => s.closeDetail)

  if (!detail || !team) return null

  const signals = (rawTeam?.signals ?? []).filter(
    (sig) => sig.subjectId === detail.id && (sig.subjectType === 'person' || sig.subjectType === 'project'),
  )
  const sourceFiles = team.sourceFiles

  const person = detail.kind === 'person' ? team.people.find((p) => p.id === detail.id) : null
  const project = detail.kind === 'project' ? team.projects.find((p) => p.id === detail.id) : null

  return (
    <div className="lite-detail-overlay" role="dialog" aria-modal="true" aria-label={t.lite.detailAria}>
      <button
        type="button"
        className="lite-detail-backdrop"
        aria-label={t.lite.detailClose}
        onClick={closeDetail}
      />
      <div className="lite-detail-card">
        <button type="button" className="lite-detail-close" onClick={closeDetail}>
          {t.lite.detailClose}
        </button>

        {person ? (
          <>
            <header className="lite-detail-head">
              <InitialAvatar name={person.name} size={52} className="lite-detail-avatar" />
              <div>
                <p className="eyebrow">{t.lite.detailPersonEyebrow}</p>
                <h2>{person.name}</h2>
                <p className="lite-detail-subtitle">
                  {[person.role, person.team].filter(Boolean).join(' · ')}
                </p>
              </div>
            </header>

            {person.tenure ? (
              <section className="lite-detail-section">
                <p className="eyebrow">{t.lite.detailTenure}</p>
                <p>{person.tenure}</p>
              </section>
            ) : null}

            {person.owns && person.owns.length > 0 ? (
              <section className="lite-detail-section">
                <p className="eyebrow">{t.lite.detailOwns}</p>
                <ul>
                  {person.owns.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </section>
            ) : null}

            {person.collaboration && person.collaboration.length > 0 ? (
              <section className="lite-detail-section">
                <p className="eyebrow">{t.lite.detailCollab}</p>
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
                <p className="eyebrow">{t.lite.detailProjectEyebrow}</p>
                <h2>{project.title}</h2>
                <p className="lite-detail-subtitle">
                  {projectStatusText(project.status, t.lite)} · {project.ownerName}
                  {project.dueDate ? ` · ${project.dueDate}` : ''}
                </p>
              </div>
            </header>

            {project.summary ? (
              <section className="lite-detail-section">
                <p className="eyebrow">{t.lite.detailSummary}</p>
                <p>{project.summary}</p>
              </section>
            ) : null}

            {typeof project.progress === 'number' ? (
              <section className="lite-detail-section">
                <p className="eyebrow">{t.lite.detailProgress}</p>
                <p>{project.progress}%</p>
              </section>
            ) : null}

            {project.blockers && project.blockers.length > 0 ? (
              <section className="lite-detail-section">
                <p className="eyebrow">{t.lite.detailBlockers}</p>
                <ul>
                  {project.blockers.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </section>
            ) : null}
          </>
        ) : null}

        {!person && !project ? (
          // 只有数据刷新竞态才可能到这——不渲染 "Unknown"（story 渗漏的口径），显平静空态。
          <section className="lite-detail-section">
            <p>{t.lite.detailGone}</p>
          </section>
        ) : null}

        {signals.length > 0 ? (
          <section className="lite-detail-section">
            <p className="eyebrow">{t.lite.detailSignals}</p>
            <ul>
              {signals.map((sig) => (
                <li key={sig.id}>{sig.summary}</li>
              ))}
            </ul>
          </section>
        ) : null}

        {sourceFiles.length > 0 ? (
          <section className="lite-detail-section lite-detail-source">
            <p className="eyebrow">{t.lite.detailSource}</p>
            <p>
              {sourceFiles.map((name) => (
                <span key={name} className="upload-source-chip">
                  {name}
                </span>
              ))}
            </p>
          </section>
        ) : null}
      </div>
    </div>
  )
}
