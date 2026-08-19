// team-map-revival-0804 · B1 · 地图布局公式（纯函数，零手摆）。
//
// 移植自 story 的规格书 `src/story/data/layout.ts`（ADR-0012 修订 5 的双列 bipartite：
// 左名册按部门分区、右项目统一横条、坐标全是公式常量）。**移植不是拷贝**——两处的形态
// 差一个数量级：
//
//   · story 的语料是 6 个部门 × 2-4 人的虚构 fixture，单列纵向堆叠恰好好看。
//   · 真语料（demo-seed，验收锚定的那一份）是 **10 个部门 / 16 人**，绝大多数部门只有
//     1-2 人。照 story 那样单列堆下去 = 一根 480px 宽、2200px 高的细柱子，fit-width 之后
//     整块内容只剩顶上两组看得见——「多组少人」是 PRD §8 点名的头号美感风险。
//
// 所以本文件在 story 的公式上多做一层：**部门分区自己也排成网格**（zoneCols 列），
// 列数由「哪种排法让整块 board 的长宽比最接近可读窗」反算（见 pickZoneCols）。
// 于是同一个公式在两种极端语料上都成立：
//   · demo-seed（10 组 / 16 人 / 6 项目）→ 2 列分区，board ≈ 1852×1252（≈1.48:1）
//   · 80 人合成租户（8 组 / 每组 10 人 / 20 项目）→ 4 列分区，board ≈ 3476×2424（≈1.43:1）
// 两份语料一行代码都不用改，也没有一个写死的坐标——这是 PRD §5.1「大团队条款」的验收口径。
//
// 🔴 单位一律 board px（ADR-0012 修订 1 的 world/HUD 分层）：world 对象禁 vw / 视口% ——
// 那些只在 HUD 合法。装不下交给 pan/zoom，不靠缩版面。
//
// 🔴 分区口径与团队目录页**同一把尺**：部门序、`__ungrouped__` 沉底都直接吃
// `deriveGroupFacets` + `filterDirectory`，本文件不自己数一遍人（另写一份 derive 正是
// ADR-0034 双实现漂移的老坑）。

import type { LitePerson, LiteProject } from '../teamData'
import {
  deriveGroupFacets,
  filterDirectory,
  GROUP_ALL,
  GROUP_UNGROUPED,
  MOOD_ALL,
} from '../teamDirectory'

export interface MapPos {
  x: number
  y: number
}

export interface MapRect {
  x: number
  y: number
  width: number
  height: number
}

/** 一个人在板上的位置。pos = 头像圆点的**中心**（B2 连线的锚点就是它）。 */
export interface MapPersonNode {
  person: LitePerson
  pos: MapPos
}

/**
 * 一个部门分区。
 *
 * PRD §5.2：zone 按「可收拢」设计——有 id、有成员清单、（B2 起）有聚合读数，是个实体
 * 而不是一句标签。B4 的部门收拢态直接拿 `rect` 当卡片框、拿 `members` 当展开内容，
 * 不需要回头改这个契约。
 */
export interface MapZone {
  /** 部门原文（不翻译）或 `__ungrouped__`——与目录页 chip 的 key 逐字同源。 */
  key: string
  isUngrouped: boolean
  /**
   * B4：这一次排布下它是不是收拢成一张部门卡（人位不铺开）。
   * 🔴 收拢**不改成员清单**——`members` 照样是全员，只是 pos 全落在卡心。
   */
  isCollapsed: boolean
  rect: MapRect
  members: MapPersonNode[]
}

/** 一根项目条。pos = 条的**中心**。 */
export interface MapProjectNode {
  project: LiteProject
  pos: MapPos
  /** 该条按 owner 的部门归到了哪个分区（-1 = 无 owner / owner 不在花名册上，沉底）。 */
  zoneIndex: number
}

export interface MapLayout {
  board: { width: number; height: number }
  zones: MapZone[]
  projects: MapProjectNode[]
  /** 分区内每行几个人（f(最大组人数)）。门与调试用。 */
  personCols: number
  /** 分区自己排成几列（f(部门数, 各组人数, 项目数)）。门与调试用。 */
  zoneCols: number
  /** B4：这块板是不是收拢态（人数 ≥ COLLAPSE_MIN_PEOPLE）。 */
  collapsed: boolean
  /** B4：收拢态下铺开的那个部门；小团队恒 null。 */
  expandedZoneKey: string | null
}

// ── 公式常量（board px）。这里是**唯一**允许出现数字的地方；没有任何一个坐标是手摆的。──

/** board 四周留白。 */
const PAD = 72

/**
 * 人位步距（含间隙）。一个人位实测最高约 84px（头像 44 + 间隙 6 + 名字折到两行 34），
 * 104 留 20px 呼吸——**别再往大调**：第一版给到 126，每张单人部门卡里就多出一片
 * 一眼看得出来的死空白，整块 board 被撑高 170px，fit-width 之后底下整整一行部门掉出画面。
 * 「多组少人」的形态下，卡内的空白比卡与卡之间的空白更显眼。
 */
const PERSON_COL_STEP = 148
const PERSON_ROW_STEP = 104

/** 分区卡：标签行高 + 左右内边距 + 底部内边距。 */
const ZONE_LABEL_H = 46
const ZONE_PAD_X = 20
const ZONE_PAD_B = 14

/** 分区之间。 */
const ZONE_GAP_X = 32
const ZONE_GAP_Y = 32

/**
 * 分区内每行最多几个人。
 * 4 不是审美偏好：再宽下去一个部门就比项目条还长，双列 bipartite 的「左名册 / 右项目」
 * 读法会塌成一片。人多的组往下长行数（配合 zoneCols 变窄）。
 */
const PERSON_COLS_MAX = 4

/** 分区网格最多几列。同理：再多就把项目列挤出可读窗。 */
const ZONE_COLS_MAX = 4

// ── B4 · 部门收拢态（#107）────────────────────────────────────────────────────
//
/**
 * 多少人以上改成「部门是节点」。40 是票面 #107 写死的数。
 *
 * 为什么是**人数**而不是部门数：塌掉的是「一屏读不完」，而一屏读不读得完由人位总数决定
 * ——9 个部门 80 个人要收，9 个部门 16 个人（demo-seed 那份）不收。
 * 🔴 阈值只影响**默认排布**，不影响任何契约：收拢态下 `zone.members` 一个人都不少，
 * 只是他们的 pos 全落在卡心（于是连线仍然连得上、focusBounds 仍然框得住）。
 */
export const COLLAPSE_MIN_PEOPLE = 40

/**
 * 收拢卡的高度：标签行 + 一行组级读数 + 一行警报角标的位置。
 * 不随人数变——**这正是重点**：收拢态回答的是「哪个部门有火情」，不是「哪个部门人多」。
 * 人数差异由展开之后的行数表达（ADR-0023：跨人计数在本仓读作排行榜）。
 */
const ZONE_COLLAPSED_H = 132

/** 名册区 ↔ 项目列。 */
const COLUMN_GAP = 88

/** 项目条尺寸（统一横条——ADR-0012 修订 5 的原话，长短不代表任何量）。两行：标题+状态 / owner+进度。 */
const PROJECT_W = 620
const PROJECT_H = 78
const PROJECT_GAP = 22
const PROJECT_STEP = PROJECT_H + PROJECT_GAP

/**
 * 反算 zoneCols 用的目标长宽比。
 * 1.6 ≈ 16:10 —— 笔记本可读窗的形状。calm 是 fit-width 顶锚（ADR-0012 修订 6），所以
 * board 越接近这个比例，第一帧能读到的内容越多、底下要 pan 才够得着的越少。
 */
const TARGET_ASPECT = 1.6

export const MAP_CELL = {
  person: { width: PERSON_COL_STEP, height: PERSON_ROW_STEP },
  project: { width: PROJECT_W, height: PROJECT_H },
} as const

interface RawGroup {
  key: string
  isUngrouped: boolean
  people: LitePerson[]
}

/**
 * 花名册 → 部门分区清单。**同一把尺**：部门序与「未分组」沉底全部由 `deriveGroupFacets`
 * 决定，成员由 `filterDirectory` 挑——本文件一次都没有自己读 `person.team`。
 * （目录页 chip 上写着 3 个人的部门，地图上就必须站着同样这 3 个人。）
 */
function groupsOf(people: LitePerson[]): RawGroup[] {
  return deriveGroupFacets(people)
    .filter((facet) => facet.key !== GROUP_ALL)
    .map((facet) => ({
      key: facet.key,
      isUngrouped: facet.key === GROUP_UNGROUPED,
      people: filterDirectory(people, facet.key, MOOD_ALL),
    }))
}

/** 分区内每行几个人 = f(最大组人数)。全体分区同宽（同一把尺，读起来是一张表不是一堆碎片）。 */
function personColsOf(groups: RawGroup[]): number {
  const maxGroupSize = groups.reduce((max, g) => Math.max(max, g.people.length), 0)
  return Math.min(PERSON_COLS_MAX, Math.max(1, maxGroupSize))
}

function zoneWidthOf(personCols: number): number {
  return personCols * PERSON_COL_STEP + ZONE_PAD_X * 2
}

function zoneHeightOf(memberCount: number, personCols: number): number {
  const rows = Math.max(1, Math.ceil(memberCount / personCols))
  return ZONE_LABEL_H + rows * PERSON_ROW_STEP + ZONE_PAD_B
}

/** 一个分区这一次排布下占多高：收拢的取固定卡高，铺开的按人数长行数。 */
function heightOfGroup(group: RawGroup, personCols: number, collapsedNow: boolean): number {
  return collapsedNow ? ZONE_COLLAPSED_H : zoneHeightOf(group.people.length, personCols)
}

interface ShelfPack {
  /** 与 groups 同序的分区框。 */
  rects: MapRect[]
  width: number
  height: number
}

/**
 * 分区网格：按部门序左→右铺，铺满 zoneCols 换行（书页式，读序 = 部门序）。
 * 同一行的分区卡**统一取该行最高**——高低参差的卡片排一行会读成「坏掉的表格」，
 * 而人数差异本来就该由卡里的行数表达，不该由卡的高度表达。
 */
function packZones(
  groups: RawGroup[],
  personCols: number,
  zoneCols: number,
  /** 哪几个分区这一次是收拢的（与 groups 同序）。全 false = B1..B3 的老形态。 */
  collapsedFlags: readonly boolean[] = [],
): ShelfPack {
  if (groups.length === 0) return { rects: [], width: 0, height: 0 }
  const zoneW = zoneWidthOf(personCols)
  const rects: MapRect[] = []
  let y = PAD
  let maxRight = 0

  for (let start = 0; start < groups.length; start += zoneCols) {
    const row = groups.slice(start, start + zoneCols)
    const rowH = row.reduce(
      (max, g, i) => Math.max(max, heightOfGroup(g, personCols, collapsedFlags[start + i] === true)),
      0,
    )
    row.forEach((_, i) => {
      const x = PAD + i * (zoneW + ZONE_GAP_X)
      rects.push({ x, y, width: zoneW, height: rowH })
      maxRight = Math.max(maxRight, x + zoneW)
    })
    y += rowH + ZONE_GAP_Y
  }

  return {
    rects,
    width: maxRight - PAD,
    // 末行不带 gap。
    height: y - ZONE_GAP_Y - PAD,
  }
}

function boardSizeOf(rosterW: number, rosterH: number, projectCount: number) {
  const projectsH = projectCount > 0 ? projectCount * PROJECT_STEP - PROJECT_GAP : 0
  const contentW = rosterW + (projectCount > 0 ? (rosterW > 0 ? COLUMN_GAP : 0) + PROJECT_W : 0)
  const contentH = Math.max(rosterH, projectsH)
  return {
    width: contentW + PAD * 2,
    height: contentH + PAD * 2,
    projectsH,
  }
}

/**
 * 分区排几列 —— 唯一一处「选择」，而它也是算出来的：把 1..ZONE_COLS_MAX 每种排法真排一遍，
 * 挑出让整块 board 的长宽比最接近 `TARGET_ASPECT` 的那一个。并列时取列数少的（更紧凑）。
 *
 * 为什么不写死、也不按 `ceil(sqrt(n))` 之类的手感公式：项目数会**反过来撑高** board
 * （右列比左边名册长的时候，高度由项目数决定），此时正确的应对是把名册排得更宽而不是更高。
 * 只看部门数的公式看不见这件事——80 人 fixture 恰好就是那个形态。
 */
function pickZoneCols(
  groups: RawGroup[],
  personCols: number,
  projectCount: number,
  collapsedFlags: readonly boolean[] = [],
): number {
  if (groups.length === 0) return 1
  let bestCols = 1
  let bestScore = Infinity
  const maxCols = Math.min(ZONE_COLS_MAX, groups.length)
  for (let cols = 1; cols <= maxCols; cols += 1) {
    const pack = packZones(groups, personCols, cols, collapsedFlags)
    const board = boardSizeOf(pack.width, pack.height, projectCount)
    const score = Math.abs(board.width / board.height - TARGET_ASPECT)
    if (score < bestScore - 1e-9) {
      bestScore = score
      bestCols = cols
    }
  }
  return bestCols
}

/**
 * 人在分区卡里的位置。**最后一行居中**——「多组少人」的形态里，1 个人的部门如果把头像
 * 顶在卡片左上角，整片名册会读成一堆没写完的表格；居中之后每张卡都是一个完整的小单元。
 */
function membersOf(group: RawGroup, rect: MapRect, personCols: number): MapPersonNode[] {
  return group.people.map((person, i) => {
    const row = Math.floor(i / personCols)
    const col = i % personCols
    const inThisRow = Math.min(personCols, group.people.length - row * personCols)
    const rowOffset = ((personCols - inThisRow) * PERSON_COL_STEP) / 2
    return {
      person,
      pos: {
        x: rect.x + ZONE_PAD_X + rowOffset + col * PERSON_COL_STEP + PERSON_COL_STEP / 2,
        y: rect.y + ZONE_LABEL_H + row * PERSON_ROW_STEP + PERSON_ROW_STEP / 2,
      },
    }
  })
}

/**
 * 项目条的排序：按 owner 所属部门的**分区序**（于是 B2 的 focus 连线短而水平），
 * 同组内保 payload 原序。
 *
 * 🔴 owner 只认 `ownerId`（后端 `_link_owners` 解出来的 join key）。**没有 ownerId 就是
 * 没有**——不拿 `ownerNameRaw` 去和花名册的名字做模糊匹配。同名的两个人会被匹配成同一个，
 * 而地图恰恰是「这活儿压在谁身上」的答案，认错人比不认人贵得多。沉底（zoneIndex = -1）。
 */
function zoneIndexOfProject(
  project: LiteProject,
  zoneKeyByPersonId: Map<string, string>,
  zoneOrder: Map<string, number>,
): number {
  const ownerId = project.ownerId?.trim()
  if (!ownerId) return -1
  const zoneKey = zoneKeyByPersonId.get(ownerId)
  if (zoneKey === undefined) return -1
  return zoneOrder.get(zoneKey) ?? -1
}

/**
 * 花名册 + 项目 → 一整块 board。纯函数：同样的输入永远同样的输出，不读时钟、不读视口、
 * 不读 store。
 */
export interface MapLayoutOptions {
  /**
   * 允不允许收拢（B4）。**默认 false**：渲染层还没认 `isCollapsed` 之前，
   * 布局层单方面收拢会把一个部门的人全叠在卡心。见 buildMapLayout 里那段碑。
   */
  allowCollapse?: boolean
  /**
   * 收拢态下**哪一个部门是铺开的**（B4）。null / 查无此部门 = 全收拢。
   * 值来自 URL 的 `?focus=zone:<key>`——同一个 token 在小团队里是「点亮这一组」、
   * 在大团队里顺带把它铺开，于是「展开了哪个部门」跟着一起可分享，零新增状态。
   */
  expandedZoneKey?: string | null
}

export function buildMapLayout(
  people: LitePerson[],
  projects: LiteProject[],
  options: MapLayoutOptions = {},
): MapLayout {
  const groups = groupsOf(people)
  const personCols = personColsOf(groups)

  // B4：人多就收拢。展开的那一个照常铺人位——「原位展开」的意思正是它在原来的格子里长大，
  // 不是弹出一个覆盖层（票面明写不做 zoom 阈值 LOD：点击/状态驱动才可回放）。
  //
  // 🔴 **默认关着，由调用方显式开**（`allowCollapse`）。B4 的渲染层已经落地并在
  // `MapScreen` 里显式传 true，所以这个默认值不再是"临时安全阀"，而是长期口径：
  // 收拢态下成员的 pos 全落在卡心，**任何不认 `zone.isCollapsed` 的渲染路径**都会把
  // 一个部门的头像叠在同一个点上（B4 第一刀提交后当场踩过）。留着默认关，意味着
  // 将来任何新的消费方（导出、缩略图、另一块屏）必须先证明自己认这个标志才拿得到收拢。
  const collapsed = options.allowCollapse === true && people.length >= COLLAPSE_MIN_PEOPLE
  const expandedZoneKey =
    collapsed && options.expandedZoneKey && groups.some((g) => g.key === options.expandedZoneKey)
      ? options.expandedZoneKey
      : null
  const collapsedFlags = groups.map((g) => collapsed && g.key !== expandedZoneKey)

  const zoneCols = pickZoneCols(groups, personCols, projects.length, collapsedFlags)
  const pack = packZones(groups, personCols, zoneCols, collapsedFlags)

  const zones: MapZone[] = groups.map((group, i) => {
    const rect = pack.rects[i]
    const isCollapsed = collapsedFlags[i]
    return {
      key: group.key,
      isUngrouped: group.isUngrouped,
      isCollapsed,
      rect,
      // 🔴 收拢时成员**一个都不少**，只是 pos 全落在卡心：连线于是从项目条连到那张部门卡
      //（读作「这活儿压在那个部门」），focusBounds 也照样框得住。少给成员会让
      // mapFocus / MapEdges 各自需要一条「收拢了就特殊处理」的分支——那是四处各写一遍的开头。
      members: isCollapsed
        ? group.people.map((person) => ({
            person,
            pos: { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 },
          }))
        : membersOf(group, rect, personCols),
    }
  })

  const { width, height, projectsH } = boardSizeOf(pack.width, pack.height, projects.length)

  // 项目列：名册右侧一列。名册比项目列矮时，整列对名册垂直居中（story 同款）；
  // 项目比名册长时从顶边起（顶锚镜头下先看到的就是第一条）。
  const projectCenterX = PAD + pack.width + (pack.width > 0 ? COLUMN_GAP : 0) + PROJECT_W / 2
  const projectTop =
    projectsH < pack.height ? PAD + (pack.height - projectsH) / 2 : PAD

  const zoneOrder = new Map(zones.map((z, i) => [z.key, i]))
  const zoneKeyByPersonId = new Map<string, string>()
  for (const zone of zones) {
    for (const member of zone.members) zoneKeyByPersonId.set(member.person.id, zone.key)
  }

  const ordered = projects
    .map((project, i) => ({
      project,
      i,
      zoneIndex: zoneIndexOfProject(project, zoneKeyByPersonId, zoneOrder),
    }))
    .sort((a, b) => {
      // 无 owner（-1）沉底；其余按分区序，同组保原序。
      const az = a.zoneIndex === -1 ? zones.length : a.zoneIndex
      const bz = b.zoneIndex === -1 ? zones.length : b.zoneIndex
      return az - bz || a.i - b.i
    })

  const projectNodes: MapProjectNode[] = ordered.map((entry, i) => ({
    project: entry.project,
    zoneIndex: entry.zoneIndex,
    pos: { x: projectCenterX, y: projectTop + i * PROJECT_STEP + PROJECT_H / 2 },
  }))

  return {
    board: { width, height },
    zones,
    projects: projectNodes,
    personCols,
    zoneCols,
    collapsed,
    expandedZoneKey,
  }
}
