// team-map-revival-0804 · B1 · 80 人合成租户 fixture 的生成器（PRD §5.1「大团队条款」验收语料）。
//
// 跑法：`node .issues/team-map-revival-0804/fixtures/make-team-80.mjs`（就地重写 team-80.json）。
//
// ## 为什么要合成而不是等真语料
// demo-seed（10 部门 / 16 人 / 6 项目）字段齐得过分——每个项目都有 owner、都有 status、
// 都有 progress。**齐全的语料会把布局惯坏**：所有「缺了不编」的分支一次都跑不到，等真租户
// 撞上来才发现条上印着一句孤零零的「文档未提及」。所以哨兵是**造出来的**，不是等来的
// （PRD §8 风险 3 原话）。
//
// ## 形态：故意不均匀
// 部门 [22, 15, 12, 9, 7, 6, 5, 3] + 1 个没写部门的人 = 80。
// 既压「大组」（22 人 → 分区内多行）也压「小组」（3 人）也压「未分组」桶。
// demo-seed 压的是另一头（多组少人），两份合起来才覆盖布局公式的两个极端。
//
// ## 🔴 输出是 `LiveTeamPayload`（后端 /team 的原样形状），不是已 derive 的 LiteTeam
// 消费方必须自己过一遍 `liteTeamFromPayload`——判据要经过真 derive，不能拿一份手捏的
// 「正确答案」去喂渲染层（那是尺子长在被量的东西上）。
//
// 确定性：无随机数、无时钟。同样的代码永远产出同一份字节。

import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const HERE = path.dirname(fileURLToPath(import.meta.url))

const DEPARTMENTS = [
  ['Platform Engineering', 22],
  ['Customer Success', 15],
  ['Field Operations', 12],
  ['Finance & Legal', 9],
  ['People Ops', 7],
  ['Design', 6],
  ['Data', 5],
  ['Executive', 3],
]

// 姓名池：英文全名（PRD §7「门语料天然全中文(demo-seed)，en 侧用 80 人 fixture 补」——
// 反向盲点同样致命：只有中文语料时，按 .length 判宽度的门会全绿而实际排版早就炸了）。
const FIRST = ['Ada', 'Bo', 'Cass', 'Dev', 'Elin', 'Fay', 'Gus', 'Hana', 'Ivo', 'Jo']
const LAST = ['Aldridge', 'Bhatt', 'Costa', 'Duarte', 'Eriksen', 'Fontaine', 'Grigoryan', 'Hollis']

const people = []
let n = 0
for (const [team, size] of DEPARTMENTS) {
  for (let i = 0; i < size; i += 1) {
    const name = `${FIRST[n % FIRST.length]} ${LAST[(n + i) % LAST.length]}`
    people.push({
      id: `u_${n}`,
      person_id: `EMP-${String(1000 + n)}`,
      name,
      role: i === 0 ? `Head of ${team}` : `${team} specialist`,
      team,
      tenure: `${1 + (n % 9)} years`,
      owns: i % 3 === 0 ? [`${team} workstream ${i}`] : undefined,
    })
    n += 1
  }
}
// 哨兵：资料里没写部门的人 → 必须落进「未分组」桶，且那个桶恒沉底。
people.push({
  id: 'u_no_team',
  name: 'Wren Vasquez-Oyelaran',            // 长姓名：名牌折行不裁的哨兵
  role: 'Contractor',
  // team 键**整个缺席**（不是空串——absent≠none 的上游形状）
})

const P = (over) => ({ blockers: undefined, ...over })

// 24 个项目。前 16 个是「正常」的（有 owner / status / progress），后 8 个是哨兵。
const projects = []
for (let i = 0; i < 16; i += 1) {
  projects.push(
    P({
      id: `p_${i}`,
      title: `Workstream ${i + 1} — ${DEPARTMENTS[i % DEPARTMENTS.length][0]}`,
      // owner 打散在各部门：项目列按 owner 部门组序排，全挤在一个组里就验不出排序。
      ownerId: `u_${(i * 7) % people.length}`,
      status: ['on-track', 'at-risk', 'blocked', 'done'][i % 4],
      // 🔴 刻意避开 0：`p_progress_zero` 才是「进度真的是 0」那条哨兵，普通项目里再混进
      // 一个 0 会让「0 宽的条只该出现一次」这条判据数出 2 来，判据当场变得看不出对错。
      progress: 10 + ((i * 5) % 86),
      dueDate: `2026-1${i % 2}-0${1 + (i % 9)}`,
      summary: `Synthetic workstream ${i + 1}.`,
    }),
  )
}

projects.push(
  // ① owner 三件套的三种缺法，各一条 —— 全部必须沉底（zoneIndex = -1）。
  P({ id: 'p_no_owner_at_all', title: 'No owner anywhere', status: 'on-track', progress: 30 }),
  P({
    id: 'p_owner_name_only',
    // 🔴 有名字、没 id：地图**不许**拿名字去花名册里模糊匹配把它挂到某个部门上。
    // 名字照显（ownerNameRaw 有值），但排序必须当「不知道是谁」处理。
    title: 'Owner named but never linked',
    ownerName: 'Ada Aldridge',
    status: 'at-risk',
    progress: 55,
  }),
  P({
    id: 'p_owner_id_dangling',
    // 🔴 id 指向一个不在花名册上的人（离职后被清出名册、或抽取串了）→ 查不到就是查不到。
    title: 'Owner id points at nobody',
    ownerId: 'u_ghost_9999',
    status: 'on-track',
    progress: 10,
  }),
  // ② status 的两种非常态。
  P({ id: 'p_no_status', title: 'No status in the documents', ownerId: 'u_3', progress: 44 }),
  P({
    id: 'p_status_out_of_vocab',
    // 词表外的状态：原样回显那个词，既不丢也不改写（projectStatusText 的红线）。
    title: 'Status word we do not know',
    ownerId: 'u_5',
    status: 'parked-until-q3',
    progress: 5,
  }),
  // ③ progress 的三种：缺席 / 合法的 0 / 越界坏值。
  P({ id: 'p_no_progress', title: 'No progress in the documents', ownerId: 'u_7', status: 'on-track' }),
  P({
    id: 'p_progress_zero',
    // 🔴 0 是**合法的已知值**（文档真写了 0%）——必须画一条 0 宽的条，不能当成缺席收起来。
    title: 'Progress really is zero',
    ownerId: 'u_9',
    status: 'blocked',
    progress: 0,
  }),
  P({
    id: 'p_progress_out_of_range',
    // 越界坏值宁可当未知也不画一条骗人的条（progressOf 的口径）→ 整条进度组不出现。
    title:
      'A deliberately very long project title that must ellipsis instead of blowing the bar open',
    ownerId: 'u_11',
    status: 'at-risk',
    progress: 140,
  }),
)

const payload = {
  context_id: 'ctx_synth_80',
  source_files: ['synthetic-roster.csv', 'synthetic-projects.md'],
  people,
  projects,
  briefing: {
    tone: 'calm',
    headline: 'Your team: 80 people, 24 projects in flight.',
    subhead: 'Synthetic tenant — layout stress fixture only.',
    metrics: [],
  },
  scoring_enabled: false,
  archived_people: [],
}

writeFileSync(path.join(HERE, 'team-80.json'), `${JSON.stringify(payload, null, 2)}\n`, 'utf8')
console.log(
  `wrote team-80.json — ${people.length} people / ${DEPARTMENTS.length + 1} groups / ${projects.length} projects`,
)
