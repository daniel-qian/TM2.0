import { useMemo, useRef } from 'react'
import { useLite } from './store'
import { useRouteDetail } from './routes'
import { useDict } from '../shared/i18n/useDict'
import { InitialAvatar } from './InitialAvatar'
import { LiteModal } from './LiteModal'
import { buildProjectViews, projectStatusLabel } from './projectView'
import type { LiteDetail } from './store'
import type { LiteTeam } from './teamData'
import type { LiveTeamPayload } from './transport'

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
  // feat-051：详情由路由派生（`/team/:personId` · `/projects/:projectId`）——可深链、
  // 可后退关闭、刷新还在。closeDetail 仍走 store（签名不变），内部推路由。
  // feat-052：名字保留 live* 前缀——下面那套 lastRef 出场快照要区分「此刻真值」与
  // 「出场动画期间留住的最后一帧」，两者不能同名。
  const liveDetail = useRouteDetail()
  const liveTeam = useLite((s) => s.team)
  const rawTeam = useLite((s) => s.rawTeam)
  const closeDetail = useLite((s) => s.closeDetail)

  const open = Boolean(liveDetail && liveTeam)

  // 出场动画期间 store.detail 已经是 null，但面板还在屏上——留住最后一帧快照，否则关闭瞬间
  // 内容整块闪没、只剩一个空壳在缩。（LiteModal 的 open 由 store 驱动，这是配套写法。）
  // feat-055：快照里一并留住 rawTeam。项目详情改吃原始 payload 之后，只快照 team 会让人卡
  // 与项目卡在出场动画期间行为不一致——`reset()` 把 team/rawTeam 一起清空时，人卡还能从
  // 快照里渲染完这 300ms，项目卡却会当场翻成「这张卡片已不在你上传的文件里」再消失。
  // 两者同源同寿命，就该锁在同一张快照里。
  const lastRef = useRef<{
    detail: NonNullable<LiteDetail>
    team: LiteTeam
    raw: LiveTeamPayload | null
  } | null>(null)
  if (liveDetail && liveTeam) lastRef.current = { detail: liveDetail, team: liveTeam, raw: rawTeam }
  const held =
    liveDetail && liveTeam ? { detail: liveDetail, team: liveTeam, raw: rawTeam } : lastRef.current

  const detail = held?.detail ?? null
  const team = held?.team ?? null
  const heldRaw = held?.raw ?? null

  const signals = (rawTeam?.signals ?? []).filter(
    (sig) =>
      sig.subjectId === detail?.id && (sig.subjectType === 'person' || sig.subjectType === 'project'),
  )
  const sourceFiles = team?.sourceFiles ?? []

  const person =
    detail?.kind === 'person' && team ? team.people.find((p) => p.id === detail.id) ?? null : null

  // feat-055：项目详情改吃**原始 payload**（rawTeam），不再吃 team.projects。
  // 理由与项目屏同一条：teamData 的 `status ?? 'on-track'` / `ownerName ?? 'Unassigned'`
  // 兜底会把「文档没写」抹成一个看起来正常的值，浮层于是把没写状态的项目显示成
  // "on-track"。派生口径收在 projectView.ts，屏与浮层共用一份（同一个项目两处说法必须一致）。
  // 注：store 里 team 与 rawTeam 永远成对写入（uploadFiles / restoreSession / refreshTeam
  // 三处都在同一次 set 里落），所以「有 team 没 raw」不会发生。
  // 吃的是 held 快照里那份 raw（见上），不是 live rawTeam——理由同人卡。
  const projectViews = useMemo(() => buildProjectViews(heldRaw?.projects, heldRaw?.people), [heldRaw])
  const project =
    detail?.kind === 'project' ? projectViews.find((p) => p.id === detail.id) ?? null : null

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
              {/* feat-055：副标题以前是 `{status} · {ownerName}`，直接吃 teamData 的兜底
                  默认值——一个文档从没写过状态的项目会在这里显示成 "on-track"，把「没写」
                  说成了「在按计划推进」。现在三项各自成行、各自会说「文档未提及」。 */}
              <p className="lite-detail-subtitle">
                {t.lite2.detailStatus}
                {': '}
                <span className={project.statusKey === 'unknown' ? 'is-unknown' : undefined}>
                  {projectStatusLabel(project, t.lite2)}
                </span>
              </p>
              <p className="lite-detail-subtitle">
                {t.lite2.detailOwner}
                {': '}
                <span className={project.ownerName ? undefined : 'is-unknown'}>
                  {project.ownerName ?? t.lite2.projectsUnknownValue}
                </span>
              </p>
              <p className="lite-detail-subtitle">
                {t.lite2.detailDue}
                {': '}
                <span className={project.dueDate ? undefined : 'is-unknown'}>
                  {project.dueDate ?? t.lite2.projectsUnknownValue}
                </span>
              </p>
            </div>
          </header>

          {project.summary ? (
            <section className="lite-detail-section">
              <p className="eyebrow">{t.lite2.detailSummary}</p>
              <p>{project.summary}</p>
            </section>
          ) : null}

          {/* 🔴 进度未知时也要出这一节，写明「文档未提及」——以前是整节不渲染，于是
              「文档没写进度」和「这个项目没有进度这回事」在屏幕上完全一样。 */}
          <section className="lite-detail-section">
            <p className="eyebrow">{t.lite2.detailProgress}</p>
            <p className={project.progress === null ? 'is-unknown' : undefined}>
              {project.progress === null
                ? t.lite2.projectsUnknownValue
                : `${project.progress}%`}
            </p>
          </section>

          {project.blockers.length > 0 ? (
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
