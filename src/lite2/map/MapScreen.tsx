import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { useLite } from '../store'
import { useDict } from '../../shared/i18n/useDict'
import { filesHref, mapHref, teamHref, MAP_FOCUS_PARAM } from '../routes'
import { GROUP_UNGROUPED } from '../teamDirectory'
import { isNeedsYouStatus, statusKeyOf } from '../projectView'
import { MapPanZoom } from './MapPanZoom'
import { MapEdges } from './MapEdges'
import { MapHud } from './MapHud'
import { MapPersonNodeView, MapProjectNodeView, MapZoneCard, type MapNodeState } from './MapNodes'
import { buildMapLayout, COLLAPSE_MIN_PEOPLE, type MapZone } from './mapLayout'
import {
  focusBounds,
  focusToken,
  parseFocusToken,
  resolveMapFocus,
  type MapFocusTarget,
} from './mapFocus'
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

  // 🔴 focus 的**唯一真相源是 URL**（不是一个 useState）。理由与 feat-051 把「当前是哪一屏」
  // 从 Zustand 变量换成真路由一模一样：同一件事有两个真相源就一定会漂，而且票面要它可分享
  // （`/map?focus=person:<id>` 发给合伙人）。所以这里只解析、只派生，一个状态都不存。
  const target = useMemo(
    () => parseFocusToken(new URLSearchParams(search).get(MAP_FOCUS_PARAM)),
    [search],
  )
  // ── B4 · 项目列同步（票面第 4 条）─────────────────────────────────────
  // 🔴 只在收拢态生效。理由不是保守：小团队的板本来就一屏读得完，把它的项目列也砍一刀
  // 等于给 demo-seed 那 12 张像素基线换前提，纯损无益。大团队才有那个问题——而且是
  // **决定性的**那个：B4 第一刀实测，收拢名册一个像素都省不出来，板高由项目列决定。
  const collapsedMode = people.length >= COLLAPSE_MIN_PEOPLE
  const [showAllProjects, setShowAllProjects] = useState(false)
  const doneCount = useMemo(
    () => (collapsedMode ? projects.filter((p) => statusKeyOf(p.statusRaw) === 'done').length : 0),
    [collapsedMode, projects],
  )
  const shownProjects = useMemo(() => {
    if (!collapsedMode || showAllProjects) return projects
    // 🔴 被深链点名的那一条**永远留着**，哪怕它已完结：`/map?focus=project:<id>` 发给
    // 合伙人之后，对面打开只看到 calm，会以为链接坏了。折叠是默认视图，不是删除。
    const pinned = target?.kind === 'project' ? target.id : null
    return projects.filter((p) => statusKeyOf(p.statusRaw) !== 'done' || p.id === pinned)
  }, [collapsedMode, showAllProjects, projects, target])

  // B4：收拢态下**铺开哪一个部门**由同一个 token 决定（`?focus=zone:<key>`）。
  // 小团队里这个 token 的意思是「点亮这一组」，大团队里顺带把它铺开——于是「展开了哪个部门」
  // 跟着一起可分享，一个新状态都不用加。layout 因此依赖 target，不能再只依赖名册。
  const expandedZoneKey = target?.kind === 'zone' ? target.id : null
  // 布局是纯函数，但它要跑一趟排序 + 打包；输入没变就没有重算的理由。
  const layout = useMemo(
    () => buildMapLayout(people, shownProjects, { allowCollapse: true, expandedZoneKey }),
    [people, shownProjects, expandedZoneKey],
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

  // ── B3 · HUD-lite 的三份输入。全部是**板上现成事实的投影**，没有一处二次 derive。 ──
  //
  // chips 直接吃 `layout.zones`（它自己就是 `deriveGroupFacets` 排出来的），不再调一次 derive：
  // 再调一次就有了第二条链路，哪天两条不一致，chip 会指向一块板上不存在的分区。
  // 🔴 只取 key 与标签，**不取 count**——那是一排部门人数排行榜（ADR-0023 禁的形状）。
  const hudZones = useMemo(
    () => layout.zones.map((zone) => ({
      key: zone.key,
      label: zoneLabel(zone, l.directoryUngroupedLabel),
    })),
    [layout, l.directoryUngroupedLabel],
  )
  // 药丸上的数与它点开之后亮起来的条数由**同一个函数**决定（`resolveMapFocus` 的 alert 口
  // 也调它）。两处各写一遍的下场是药丸说 3 件、点开亮 2 根。
  // 🔴 走**全量** projects，不走 shownProjects：药丸问的是「这家公司有几件要你出手」，
  // 那个答案不该随一个视图开关变。（已完结的项目本来也不可能是 needsYou，所以两者此刻
  // 数值相同——但写对口径是为了将来折叠规则一变时它不会跟着悄悄变。）
  const alertCount = useMemo(
    () => projects.filter((p) => isNeedsYouStatus(p.statusRaw)).length,
    [projects],
  )
  // B4 · 每个部门名下有几件「需要你出手」的项目。**与药丸同一把尺**（`isNeedsYouStatus`），
  // 只是按 owner 的部门分了组——上面那个 alertCount 是它的全体求和，两处不许各判一次状态。
  const zoneAlerts = useMemo(() => {
    const zoneOfPerson = new Map<string, string>()
    for (const zone of layout.zones) {
      for (const member of zone.members) zoneOfPerson.set(member.person.id, zone.key)
    }
    const tally = new Map<string, number>()
    for (const project of projects) {
      if (!isNeedsYouStatus(project.statusRaw)) continue
      const zoneKey = zoneOfPerson.get(project.ownerId?.trim() ?? '')
      // 🔴 无 owner / owner 不在花名册上 ⇒ **不摊到任何部门头上**（缺了不编，与连线同一条纪律）。
      if (!zoneKey) continue
      tally.set(zoneKey, (tally.get(zoneKey) ?? 0) + 1)
    }
    return tally
  }, [layout, projects])

  // ── B4 · 开局镜头对火情（票面第 3 条）────────────────────────────────
  // 火情 = 有「需要你出手」项目的那几个部门。**同一把尺**（`zoneAlerts` 就是它算的）。
  // 🔴 只在收拢态给：小团队 fit-width 本来就看得见全部，再框一次只会把镜头无谓推近，
  // 还会给 demo-seed 那 12 张像素基线换前提。
  // 🔴 有 focus 时传 null：深链那一路归 focusRect 管，两条都动会先框火情再跳一次。
  const openingRect = useMemo(() => {
    if (!collapsedMode || focus) return null
    const hot = layout.zones.filter((zone) => (zoneAlerts.get(zone.key) ?? 0) > 0)
    // 一个部门都没着火 ⇒ null ⇒ 照旧 fit-width 顶锚。**不退化成"框第一个部门"**：
    // 那会让「今天没什么要紧事」长得跟「这个部门出事了」一模一样。
    if (hot.length === 0) return null
    let rect = { ...hot[0].rect }
    for (const zone of hot.slice(1)) {
      const x = Math.min(rect.x, zone.rect.x)
      const y = Math.min(rect.y, zone.rect.y)
      rect = {
        x, y,
        width: Math.max(rect.x + rect.width, zone.rect.x + zone.rect.width) - x,
        height: Math.max(rect.y + rect.height, zone.rect.y + zone.rect.height) - y,
      }
    }
    return rect
  }, [collapsedMode, focus, layout, zoneAlerts])
  // 开局帧的身份：火情的那几个部门是谁。它变了才重新框（对象引用不能当依赖）。
  const openingKey = useMemo(() => {
    if (!openingRect) return null
    return layout.zones
      .filter((zone) => (zoneAlerts.get(zone.key) ?? 0) > 0)
      .map((zone) => zone.key)
      .join('|')
  }, [openingRect, layout, zoneAlerts])

  // 镜头跟随的输入：这次亮起来的东西整个装在哪个方框里。口径见 `focusBounds`。
  const focusRect = useMemo(() => focusBounds(layout, focus), [layout, focus])
  const focusKey = target ? focusToken(target) : null

  // 分区底板：任何 focus 下都退后一步，只有被 chip 点中的那一块留在前面。
  // 组级答案的主语是那张卡——人再少也得看得见「这是哪个部门」。
  function zoneState(key: string): MapNodeState {
    if (!focus) return 'calm'
    return focus.subject.kind === 'zone' && focus.subject.id === key ? 'subject' : 'dimmed'
  }

  // B4 · 收拢的部门不铺人位。**判据落在 `zone.isCollapsed` 上而不是 `layout.collapsed`**：
  // 铺开的那一个也活在收拢态的板上，按板级开关判会把它一起藏掉。
  const visibleZones = layout.zones.filter((zone) => !zone.isCollapsed)

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

      {/* ── B3 · HUD-lite ────────────────────────────────────────────────────
          🔴 它**在画布外面**（页头带里、进文档流），不是浮在板上的一块玻璃。
          第一版是浮的（画布左上角绝对定位），真机截图当场毙掉：初始镜头是 fit-width 顶锚，
          于是板的左上角恰好就在 HUD 底下——桌面上第一张部门卡的标签、手机上整个第一组，
          被搜索框和 chips 盖着。「一进来第一眼看到的东西被工具条挡住」是最贵的那种遮挡。
          浮层版本要修就得让 fitBoard 知道 HUD 有多高（镜头去耦合一个 DOM 尺寸），
          而且 pan 之后照样会有东西钻到它底下。进流的代价是画布矮一截，买到的是
          **任何时候都没有东西被自家工具条盖住**，桌面上 10 个部门 chip 还恰好一行铺得下。
          它仍然是 HUD：不进 transform、不随镜头缩放，视口单位只有它这一层能用。 */}
      {hasBoard ? (
        <div className="lite-map-hud">
          <MapHud
            team={team}
            zones={hudZones}
            alertCount={alertCount}
            hiddenDoneCount={showAllProjects ? 0 : doneCount}
            showAllProjects={showAllProjects}
            onToggleProjects={
              collapsedMode && (doneCount > 0 || showAllProjects)
                ? () => setShowAllProjects((v) => !v)
                : undefined
            }
            focusKey={focusKey}
            subject={target}
            onFocus={setFocus}
          />
        </div>
      ) : null}

      {hasBoard ? (
        <MapPanZoom
          board={layout.board}
          ariaLabel={l.mapCanvasAria}
          onBackgroundClick={() => setFocus(null)}
          focusKey={focusKey}
          focusRect={focusRect}
          openingRect={openingRect}
          openingKey={openingKey}
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
                  state={zoneState(zone.key)}
                  alertCount={zoneAlerts.get(zone.key) ?? 0}
                  onSelect={() => setFocus({ kind: 'zone', id: zone.key })}
                />
              ))}
            </div>

            {/* ── 连线层（z-index 2，夹在分区底板与节点之间）：**只在 focus 时存在**。 ── */}
            <MapEdges board={layout.board} edges={focus?.edges ?? []} />

            {/* ── 人员层：圆点 + 名字；被点的那个原位长成 mini 卡。 ── */}
            <div className="lite-map-people-layer" aria-label={l.peopleLane}>
              {visibleZones.map((zone) =>
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
