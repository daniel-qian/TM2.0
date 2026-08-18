import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { useDict } from '../../shared/i18n/useDict'
import { searchTeam, type SearchResult } from '../searchDerive'
import type { LiteTeam } from '../teamData'
import { ALERT_NEEDS_YOU, type MapFocusTarget } from './mapFocus'

// team-map-revival-0804 · B3 · HUD-lite：搜索 / 部门 chips / 警报药丸。
//
// ## 三个东西，一个身份：**focus 触发器**
// 它们各自问的问题不一样（「小徐在哪」/「后厨这组在忙什么」/「有几件要我管」），但答案的
// 形态是同一个——把板上某一撮东西从背景里拎出来。所以三个都不自带高亮状态，全部落到
// `?focus=` 这一个真相源上（`mapFocus.ts` 的四种口）。副产品是三个都**跟着可分享**：
// 部门 chip 点出来的那一屏，地址栏里就是 `?focus=zone:后厨`。
//
// ## 🔴 单一尺子
// · 搜索走 `searchTeam`（顶栏搜索与引用菜单同一份）——地图不另写一遍 `includes`，
//   否则同一个词在两处会给出不同结果。
//   ⚠ 但**提示语是自己的**（`mapSearchPlaceholder`）：桌面 /map 上顶栏那个框也在画面里，
//   照抄它的文案就是两个逐字相同的输入框干着两件事（那个开档案、这个点亮板上一撮）。
//   「单一尺子」管的是一个词怎么算命中，不是这个框自称要干什么。
// · 部门 chip 的 key 直接吃**板上真有的那批分区**（`layout.zones`，它本身就是
//   `deriveGroupFacets` 排出来的）。不在这里再调一次 derive：再调一次就有了第二条链路，
//   哪天两条不一致，chip 会指向一个板上不存在的分区，点下去一片空白。
// · 警报药丸的判据走 `isNeedsYouStatus`（项目屏「需要你管的」那一组同一把尺），
//   药丸上的数与点开之后亮起来的条数由**同一个函数**决定。
//
// ## 🔴 人身零数字
// chips 上**没有人数**。`deriveGroupFacets` 明明现成给了 `count`，这里刻意丢掉——
// 一排「后厨 4 / 前厅 2 / 客房 1」读起来就是一张部门排行榜，正是 ADR-0023 禁掉的那个形状。
// 药丸上的数是**项目**计数（项目可硬，人不可）。
//
// ## 视口单位只有这一层能用
// 本组件整个活在 `TransformComponent` 外面（`MapPanZoom` 的 `hud` 槽），不随镜头缩放。
// world 对象一律 board px——ADR-0012 修订 1 的分层铁律。

/** 结果列表最多铺几行。再多就不是「找一个人」而是在读一份名册，而名册在目录页。 */
const MAX_RESULTS = 8

function fill(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_, k: string) => String(vars[k] ?? ''))
}

export interface MapHudZone {
  key: string
  label: string
}

export function MapHud({
  team,
  zones,
  alertCount,
  focusKey,
  subject,
  onFocus,
}: {
  team: LiteTeam | null
  zones: MapHudZone[]
  /** 「需要你管的」项目数。0 = 药丸整个不出现（不印「0 件」——那是一句没人要读的话）。 */
  alertCount: number
  /** 这次 focus 的 URL token；用来在它变化时收起结果列表。 */
  focusKey: string | null
  /** 当前 focus 的意图，用来给 chip / 药丸打 aria-pressed。 */
  subject: MapFocusTarget | null
  onFocus: (target: MapFocusTarget | null) => void
}) {
  const { t } = useDict()
  const l = t.lite2
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const inputRef = useRef<HTMLInputElement | null>(null)

  // 空 query = 不检索。`searchTeam` 的空串语义是**返回全量**（引用菜单要那个行为），
  // 在这儿等于一打开就糊一列名册——所以按它文件头说的，在调用点自己 gate。
  const results = useMemo(
    () => (query.trim() ? searchTeam(team, query) : []),
    [team, query],
  )
  const shown = results.slice(0, MAX_RESULTS)

  // 点了板上的节点（或点空白回 calm）之后把列表收起来：它盖在板上，而用户此刻正在看板。
  useEffect(() => {
    setOpen(false)
  }, [focusKey])

  function pick(result: SearchResult) {
    setOpen(false)
    onFocus({ kind: result.kind, id: result.id })
  }

  function onKeyDown(event: ReactKeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Enter' && shown.length > 0) {
      event.preventDefault()
      pick(shown[0])
      return
    }
    if (event.key !== 'Escape') return
    // 🔴 吃掉这一下 Esc：地图在 window 上也挂了 Esc（回 calm）。不标记 defaultPrevented 的话，
    // 「关掉搜索框」和「清掉高亮」会在同一次按键里一起发生——用户按一下丢两样东西。
    event.preventDefault()
    if (query) {
      setQuery('')
      setOpen(false)
    } else {
      inputRef.current?.blur()
    }
  }

  const zoneActive = subject?.kind === 'zone' ? subject.id : null
  const alertActive = subject?.kind === 'alert'

  return (
    <>
      {/* 一行：搜索框 + 警报药丸。chips 单独一行在它下面——十来个部门排一行会把整块 HUD
          撑成一堵墙，而这一屏的主角是板不是 HUD。 */}
      <div className="lite-map-hud-row">
        <div className="lite-map-search">
          <input
            ref={inputRef}
            type="search"
            className="lite-map-search-input"
            value={query}
            placeholder={l.mapSearchPlaceholder}
            aria-label={l.mapSearchAria}
            onChange={(e) => {
              setQuery(e.target.value)
              setOpen(true)
            }}
            onFocus={() => setOpen(true)}
            onKeyDown={onKeyDown}
          />
          {open && query.trim() ? (
            <div className="lite-map-search-results">
              {shown.length === 0 ? (
                // 🔴 零命中要说出来。静默的空列表在一块本来就有很多东西的板上，读起来像卡住了。
                <p className="lite-map-search-empty">{l.searchEmpty}</p>
              ) : (
                <ul>
                  {shown.map((result) => (
                    <li key={`${result.kind}:${result.id}`}>
                      <button
                        type="button"
                        className="lite-map-search-hit"
                        onClick={() => pick(result)}
                      >
                        <span className="lite-map-search-hit-label">{result.label}</span>
                        {/* meta 是**原值**（角色 / 文档写的负责人），缺了就整段不出现——
                            `searchDerive` 明写兜底串归渲染层，而这里的正确兜底是「不说」：
                            结果行上多一句「文档未提及」既占地方又没告诉人任何事。 */}
                        {result.meta.trim() ? (
                          <span className="lite-map-search-hit-meta">{result.meta}</span>
                        ) : null}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              {/* 截断要说出来。不说的话，第 9 个人就是「搜不到」——而他明明在板上。 */}
              {results.length > shown.length ? (
                <p className="lite-map-search-more">{l.mapSearchMore}</p>
              ) : null}
            </div>
          ) : null}
        </div>

        {alertCount > 0 ? (
          <button
            type="button"
            className={`lite-map-alert${alertActive ? ' is-active' : ''}`}
            aria-pressed={alertActive}
            aria-label={fill(l.mapAlertAria, { group: l.projectsGroupNeedsYou, count: alertCount })}
            onClick={() => onFocus(alertActive ? null : { kind: 'alert', id: ALERT_NEEDS_YOU })}
          >
            {/* 组名与项目屏那一栏**逐字同源**：同一批项目在两块屏上不许一个叫「需要你管的」、
                一个叫「有风险」。数字单独成元素，好让门量得到它。 */}
            <span className="lite-map-alert-label">{l.projectsGroupNeedsYou}</span>
            <span className="lite-map-alert-count">{alertCount}</span>
          </button>
        ) : null}
      </div>

      {zones.length > 0 ? (
        <div className="lite-map-chips" role="group" aria-label={l.mapZonesAria}>
          {zones.map((zone) => {
            const active = zoneActive === zone.key
            return (
              <button
                key={zone.key}
                type="button"
                className={`lite-map-chip${active ? ' is-active' : ''}`}
                // 门靠它找 chip。用文案找的话，「chip 上多了个数字」这种变异会让门连点都点不到，
                // 于是一条讲数字的判据顺手把三条讲行为的判据一起拖红——分不出是哪儿坏了。
                data-zone-key={zone.key}
                aria-pressed={active}
                aria-label={fill(l.mapZoneChipAria, { zone: zone.label })}
                // 再点一次收回全景：chip 是个开关，而开关按下去两次该回到原处。
                onClick={() => onFocus(active ? null : { kind: 'zone', id: zone.key })}
              >
                {zone.label}
              </button>
            )
          })}
        </div>
      ) : null}
    </>
  )
}
