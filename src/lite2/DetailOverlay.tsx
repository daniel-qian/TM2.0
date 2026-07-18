import { useEffect } from 'react'
import { useLite } from './store'
import { useDict } from '../shared/i18n/useDict'
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

  // feat-046 遗留修复①（feat-045 对抗验证点名的既有惯例）：aria-modal 弹层必须可键盘退出。
  // 照 OnboardWizard 的监听器模式：挂载 add / 卸载 remove（Escape → closeDetail → 组件
  // unmount → cleanup 即时注销，零全局监听残留）。closeDetail 无进度语义，直接关即可。
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeDetail()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [closeDetail])

  if (!detail || !team) return null

  const signals = (rawTeam?.signals ?? []).filter(
    (sig) => sig.subjectId === detail.id && (sig.subjectType === 'person' || sig.subjectType === 'project'),
  )
  const sourceFiles = team.sourceFiles

  const person = detail.kind === 'person' ? team.people.find((p) => p.id === detail.id) : null
  const project = detail.kind === 'project' ? team.projects.find((p) => p.id === detail.id) : null

  return (
    <div className="lite-detail-overlay" role="dialog" aria-modal="true" aria-label={t.lite2.detailAria}>
      <button
        type="button"
        className="lite-detail-backdrop"
        aria-label={t.lite2.detailClose}
        onClick={closeDetail}
      />
      <div className="lite-detail-card">
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

        {!person && !project ? (
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
      </div>
    </div>
  )
}
