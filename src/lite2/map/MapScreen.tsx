import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { useLite } from '../store'
import { useDict } from '../../shared/i18n/useDict'
import { projectStatusText } from '../../shared/projectStatus'
import { InitialAvatar } from '../InitialAvatar'
import { filesHref, teamHref } from '../routes'
import { progressOf, projectStatusTone, statusKeyOf } from '../projectView'
import { GROUP_UNGROUPED } from '../teamDirectory'
import { MapPanZoom } from './MapPanZoom'
import { buildMapLayout, MAP_CELL, type MapZone } from './mapLayout'

// team-map-revival-0804 · B1 ·「团队地图」关系全景页（`/map`，正源票 #106，PRD 见
// `.issues/team-map-revival-0804/PRD.md`）。
//
// ## 它回答的那个问题
// 目录页答得了「谁在这家公司」、项目屏答得了「有哪些活」，两个都答不了
// **「这家公司的活儿都压在谁身上」**——那需要人和项目在同一个平面上、按部门站好。
// 这一屏就是那个平面。
//
// ## 本棒（B1）只做 calm 骨架
// 人 = 圆点 + 名字；项目 = 一根条；连线**全隐藏**。连线、点选、原位长大卡是 B2（focus 机器），
// 搜索 / 部门 chips / 警报药丸是 B3（HUD-lite）。所以本屏的节点**一律不可点**——
// 摆一个点了没反应的按钮比不摆更糟。
//
// ## 🔴 三条贯穿全屏的纪律
// ① **人身零数字**：`LitePerson` 类型层就没有数字键（teamData.ts 的结构性护栏），本屏
//    也不新增任何人身数字面——包括「这个部门几个人」这种看着无害的计数。项目 progress%
//    允许（项目可硬，人不可）。
// ② **单一尺子**：owner 显示名走项目屏同款 `projectsUnknownValue` 兜底、状态文案走
//    `projectStatusText(statusRaw)`、语气色走 `projectStatusTone`、分区走
//    `deriveGroupFacets`（在 mapLayout.ts 里）。本屏**一份 derive 都不自己写**——
//    同一个项目在项目屏和地图上说法不一致，比地图不存在更糟（ADR-0034 的老坑）。
// ③ **缺了不编**：无 owner → 显兜底词、不猜；无 status → 中性灰（不是绿）；
//    无 progress → **根本不画条**（不是画一条 0 宽的）。
//
// ## 墙
// 画布用 lite2 自己的薄 wrapper（`MapPanZoom.tsx`），**不 import `src/story/**`**。
// CSS 从 story 的 `10-dashboard-nexus.css` 摘选重写、重作用域到 `.lite2-shell`
// （见 lite2.css 的 team-map 段）——不留任何对 story-only 文件的语义依赖，那些文件随
// story 退役就会断。

function classNames(parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(' ')
}

/** 分区标题：部门原文不翻译（与目录页 chip 逐字同源），只有「未分组」这个桶走字典。 */
function zoneLabel(zone: MapZone, ungroupedLabel: string): string {
  return zone.key === GROUP_UNGROUPED ? ungroupedLabel : zone.key
}

export function MapScreen() {
  const { t } = useDict()
  const l = t.lite2
  const team = useLite((s) => s.team)

  const people = team?.people ?? []
  const projects = team?.projects ?? []
  // 布局是纯函数，但它要跑一趟排序 + 打包；名册没变就没有重算的理由。
  const layout = useMemo(() => buildMapLayout(people, projects), [people, projects])

  // PRD §3.6 · 空态：**不渲染空板**——一块画着网格却没有一个节点的板，看着像坏了。
  // 判据是「有没有可画的东西」而不是「有没有人」：0 人 + 3 个项目仍然是一块有内容的板，
  // 对它说「还没有可读的资料」是一句假话。引导语复用团队页那一套（同一处缺失不许两种说法）。
  const hasBoard = people.length > 0 || projects.length > 0

  return (
    <section className="scene is-active lite-map-page" data-scene-name="map">
      {/* HUD 层（viewport-fixed）：返回芯片 + 页头。world 对象只许 board px，
          视口单位只有这一层能用——ADR-0012 修订 1 的分层铁律。 */}
      <header className="lite-map-head">
        <Link className="lite-map-back" to={teamHref()}>
          <span aria-hidden="true">←</span> {l.mapBackToTeam}
        </Link>
        <div className="lite-map-headings">
          <h1 className="lite-map-title">{l.mapTitle}</h1>
          <p className="lite-map-lede">{l.mapLede}</p>
        </div>
      </header>

      {hasBoard ? (
        <MapPanZoom board={layout.board} ariaLabel={l.mapCanvasAria}>
          {/* ── 分区层：部门卡。B4 的收拢态就长在这一层上（PRD §5.3）。 ── */}
          <div className="lite-map-zone-layer">
            {layout.zones.map((zone) => (
              <div
                key={zone.key}
                className={classNames(['lite-map-zone', zone.isUngrouped && 'is-ungrouped'])}
                data-zone-key={zone.key}
                style={{
                  left: `${zone.rect.x}px`,
                  top: `${zone.rect.y}px`,
                  width: `${zone.rect.width}px`,
                  height: `${zone.rect.height}px`,
                }}
              >
                {/* 🔴 标签上只有部门名，**没有人数徽章**——见文件头纪律①。
                    部门的定性读数（从 selfReport 真派生）是 B2 的活，位置留在这行下面。 */}
                <span className="lite-map-zone-name">{zoneLabel(zone, l.directoryUngroupedLabel)}</span>
              </div>
            ))}
          </div>

          {/* ── 人员层：圆点 + 名字。B1 不可点（点选是 B2）。 ── */}
          <div className="lite-map-people-layer" aria-label={l.peopleLane}>
            {layout.zones.map((zone) =>
              zone.members.map(({ person, pos }) => (
                <div
                  key={person.id}
                  className="lite-map-person"
                  data-person-id={person.id}
                  style={{
                    left: `${pos.x}px`,
                    top: `${pos.y}px`,
                    width: `${MAP_CELL.person.width}px`,
                  }}
                >
                  {/* story 用的是 PixelAvatar（sprite 表，虚构角色的资产）——这里用 lite2
                      自己的 InitialAvatar：真人没有 sprite，不凭空派一张脸给客户的员工。 */}
                  <InitialAvatar name={person.name} size={44} className="lite-map-person-avatar" />
                  <span className="lite-map-person-name">{person.name}</span>
                </div>
              )),
            )}
          </div>

          {/* ── 项目层：统一横条。长短不代表任何量（ADR-0012 修订 5 原话）。 ── */}
          <div className="lite-map-project-layer" aria-label={l.mapProjectsAria}>
            {layout.projects.map(({ project, pos }) => {
              const statusKey = statusKeyOf(project.statusRaw)
              const progress = progressOf(project.progress)
              return (
                <div
                  key={project.id}
                  className={classNames([
                    'lite-map-project',
                    statusKey === 'unknown' && 'is-status-unknown',
                  ])}
                  data-project-id={project.id}
                  style={{
                    left: `${pos.x}px`,
                    top: `${pos.y}px`,
                    width: `${MAP_CELL.project.width}px`,
                    minHeight: `${MAP_CELL.project.height}px`,
                  }}
                >
                  <span className="lite-map-project-row">
                    <span className="lite-map-project-title">{project.title}</span>
                    <span className="lite-map-project-status">
                      <span
                        className={classNames(['status-dot', projectStatusTone(statusKey)])}
                        aria-hidden="true"
                      />
                      <span>{projectStatusText(project.statusRaw, l)}</span>
                    </span>
                  </span>
                  {/* 第二行：左 owner / 右进度。第一版把进度条铺满整条宽度、`%` 甩到最右，
                      结果那个百分数正落在上一行 status 的正下方，读起来像是 status 的注脚。
                      各占一半、进度组自己定宽，两个读数才各是各的。 */}
                  <span className="lite-map-project-row lite-map-project-row--facts">
                    {/* 🔴 owner **必须带标签**，与项目屏的 FactRow 同形。只印值的话，
                        没读到负责人的项目在条上只剩孤零零一句「文档未提及」——
                        文档未提及**什么**？兜底文案只有配着它兜的那个字段才是一句话。 */}
                    <span className="lite-map-project-owner">
                      <span className="lite-map-project-owner-label">{l.projectsOwnerLabel}</span>
                      {/* 兜底词与项目屏、详情浮层逐字同源——绝不写「未分配」（那是替客户
                          断言「文档说了没有负责人」，而文档只是没提到是谁）。 */}
                      <span>{project.ownerName || l.projectsUnknownValue}</span>
                    </span>
                    {/* 🔴 progress 缺失 → 整组不出现。画一条 0 宽的条 = 替客户的文档说
                        「这事没进展」，当着他自己的文件的面（projectView.ts 头部那段）。 */}
                    {progress !== null ? (
                      <span className="lite-map-project-progress">
                        <span className="lite-map-progress-track" aria-hidden="true">
                          <span
                            className="lite-map-progress-fill"
                            style={{ width: `${progress}%` }}
                          />
                        </span>
                        <span className="lite-map-progress-value">{progress}%</span>
                      </span>
                    ) : null}
                  </span>
                </div>
              )
            })}
          </div>
        </MapPanZoom>
      ) : (
        <div className="lite-map-empty">
          <div className="lite-team-empty-card">
            <p className="lite-team-empty-title">{l.teamEmptyTitle}</p>
            <p className="lite-team-empty-body">{l.teamEmptyBody}</p>
            <Link className="lite-btn lite-btn--primary lite-team-empty-cta" to={filesHref()}>
              {l.teamEmptyCta}
            </Link>
          </div>
        </div>
      )}
    </section>
  )
}
