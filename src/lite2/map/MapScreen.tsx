import { useCallback, useEffect, useMemo } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { useLite } from '../store'
import { useDict } from '../../shared/i18n/useDict'
import { filesHref, mapHref, teamHref, MAP_FOCUS_PARAM } from '../routes'
import { GROUP_UNGROUPED } from '../teamDirectory'
import { MapPanZoom } from './MapPanZoom'
import { MapEdges } from './MapEdges'
import { MapPersonNodeView, MapProjectNodeView, MapZoneCard, type MapNodeState } from './MapNodes'
import { buildMapLayout, type MapZone } from './mapLayout'
import { focusToken, parseFocusToken, resolveMapFocus, type MapFocusTarget } from './mapFocus'
import { deriveZoneRead } from './zoneRead'

// team-map-revival-0804 · B1/B2 ·「团队地图」关系全景页（`/map`，正源票 #106，PRD 见
// `.issues/team-map-revival-0804/PRD.md`）。
//
// ## 它回答的那个问题
// 目录页答得了「谁在这家公司」、项目屏答得了「有哪些活」，两个都答不了
// **「这家公司的活儿都压在谁身上」**——那需要人和项目在同一个平面上、按部门站好，
// 再点一下，把某一个人背着的那几件事从背景里拎出来。这一屏就是那个平面。
//
// ## 本屏做到哪儿了
// B1 = calm 骨架（人按部门站好 + 项目条 + pan/zoom）。
// B2 = focus 机器：点人亮「他 + 他 owned 的项目」、点项目亮「它 + owner」、点空白回 calm；
//      连线只在 focus 出现；被点的节点原位长大成 mini 卡；`?focus=` 可分享；
//      部门分区多了一句从本人自述真派生的组级读数。
// 搜索 / 部门 chips / 警报药丸仍是 B3（HUD-lite）的活，本屏没有。
//
// ## 🔴 三条贯穿全屏的纪律
// ① **人身零数字**：`LitePerson` 类型层就没有数字键（teamData.ts 的结构性护栏），本屏也不新增
//    任何人身数字面——包括「这个部门几个人」这种看着无害的计数，也包括自述负载那个百分数
//    （它被特许的前提是待在人卡的出处锚点里，搬到图上就是一根血条）。项目 progress% 与
//    卡点条数允许（项目可硬，人不可）。
// ② **单一尺子**：owner 显示名走 `projectsUnknownValue` 兜底、状态文案走 `projectStatusText`、
//    语气色走 `projectStatusTone`、分区走 `deriveGroupFacets`、情绪词走 `moodWordOf`、
//    卡点条目走 `blockersOf`。本屏**一份 derive 都不自己写**——同一个项目在项目屏和地图上
//    说法不一致，比地图不存在更糟（ADR-0034 的老坑）。
// ③ **缺了不编**：无 owner → 显兜底词、**不画边**；无 status → 中性灰；无 progress → 不画条；
//    组内没人自述 → 分区上不出现那句读数。
//
// ## 墙
// 画布用 lite2 自己的薄 wrapper（`MapPanZoom.tsx`），**不 import `src/story/**`**。
// CSS 从 story 的 `10-dashboard-nexus.css` 摘选重写、重作用域到 `.lite2-shell`——不留任何
// 对 story-only 文件的语义依赖，那些文件随 story 退役就会断。

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
  const navigate = useNavigate()
  const { search } = useLocation()

  const people = team?.people ?? []
  const projects = team?.projects ?? []
  // 布局是纯函数，但它要跑一趟排序 + 打包；名册没变就没有重算的理由。
  const layout = useMemo(() => buildMapLayout(people, projects), [people, projects])

  // 🔴 focus 的**唯一真相源是 URL**（不是一个 useState）。理由与 feat-051 把「当前是哪一屏」
  // 从 Zustand 变量换成真路由一模一样：同一件事有两个真相源就一定会漂，而且票面要它可分享
  // （`/map?focus=person:<id>` 发给合伙人）。所以这里只解析、只派生，一个状态都不存。
  const target = useMemo(
    () => parseFocusToken(new URLSearchParams(search).get(MAP_FOCUS_PARAM)),
    [search],
  )
  // 板上找不到这个 id ⇒ null ⇒ calm。深链发出去之后那家公司的花名册可能已经变了，
  // 这时诚实的表现是回到全景，不是画一个指向空气的高亮。
  const focus = useMemo(() => resolveMapFocus(layout, target), [layout, target])

  const setFocus = useCallback(
    (next: MapFocusTarget | null) => {
      const token = next ? focusToken(next) : null
      const current = new URLSearchParams(window.location.search).get(MAP_FOCUS_PARAM)
      // 同一个节点再点一次不是"取消"——取消是点空白 / Esc。这里只是不做一次无谓的 replace。
      if ((current || null) === token) return
      // replace 而不是 push：focus 是**同一页上的一副眼镜**，不是一次导航。用 push 的话，
      // 点空白回 calm 之后按后退键会把刚关掉的高亮翻出来——「点了关闭再后退却重新打开」
      // 正是 `navigateCloseDetail` 当年用 replace 修掉的那条坏体验（routes.ts 有原文）。
      // 代价也说清楚：后退键从地图直接离开本页，而不是逐层退出 focus。
      navigate(mapHref(token), { replace: true })
    },
    [navigate],
  )

  // Esc 回 calm。挂 window 而不是画布：点完节点后焦点可能在页面任何地方（甚至没有焦点元素）。
  // `defaultPrevented` 让路给弹层家族——它们的底座（LiteModal）也吃 Esc，谁先处理谁标记。
  useEffect(() => {
    if (!target) return
    function onKey(event: KeyboardEvent) {
      if (event.key !== 'Escape' || event.defaultPrevented) return
      setFocus(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [target, setFocus])

  // 组级读数：每个分区一条（或没有）。纯派生，跟着 layout 走。
  const zoneReads = useMemo(
    () => layout.zones.map((zone) => deriveZoneRead(zone.members.map((m) => m.person))),
    [layout],
  )

  function personState(id: string): MapNodeState {
    if (!focus) return 'calm'
    if (focus.subject.kind === 'person' && focus.subject.id === id) return 'subject'
    return focus.personIds.has(id) ? 'linked' : 'dimmed'
  }

  function projectState(id: string): MapNodeState {
    if (!focus) return 'calm'
    if (focus.subject.kind === 'project' && focus.subject.id === id) return 'subject'
    return focus.projectIds.has(id) ? 'linked' : 'dimmed'
  }

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
        <MapPanZoom
          board={layout.board}
          ariaLabel={l.mapCanvasAria}
          onBackgroundClick={() => setFocus(null)}
          extraControls={
            focus ? (
              <button
                type="button"
                className="lite-btn lite-btn--ghost lite-map-clear-focus"
                onClick={() => setFocus(null)}
              >
                {l.mapClearFocusCta}
              </button>
            ) : null
          }
        >
          <div className={classNames(['lite-map-world', focus && 'is-focused'])}>
            {/* ── 分区层：部门卡 + 组级读数。B4 的收拢态就长在这一层上（PRD §5.3）。 ── */}
            <div className="lite-map-zone-layer">
              {layout.zones.map((zone, i) => (
                <MapZoneCard
                  key={zone.key}
                  zone={zone}
                  label={zoneLabel(zone, l.directoryUngroupedLabel)}
                  read={zoneReads[i]}
                />
              ))}
            </div>

            {/* ── 连线层（z-index 2，夹在分区底板与节点之间）：**只在 focus 时存在**。 ── */}
            <MapEdges board={layout.board} edges={focus?.edges ?? []} />

            {/* ── 人员层：圆点 + 名字；被点的那个原位长成 mini 卡。 ── */}
            <div className="lite-map-people-layer" aria-label={l.peopleLane}>
              {layout.zones.map((zone) =>
                zone.members.map((node) => (
                  <MapPersonNodeView
                    key={node.person.id}
                    node={node}
                    state={personState(node.person.id)}
                    onSelect={() => setFocus({ kind: 'person', id: node.person.id })}
                  />
                )),
              )}
            </div>

            {/* ── 项目层：统一横条。长短不代表任何量（ADR-0012 修订 5 原话）。 ── */}
            <div className="lite-map-project-layer" aria-label={l.mapProjectsAria}>
              {layout.projects.map((node) => (
                <MapProjectNodeView
                  key={node.project.id}
                  node={node}
                  state={projectState(node.project.id)}
                  onSelect={() => setFocus({ kind: 'project', id: node.project.id })}
                />
              ))}
            </div>
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
