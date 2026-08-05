// 「从 Excel 粘贴」的解析层 —— onboarding-accounts-0805 ②（ADR-0034 拍板 4）。
//
// 为什么这是第一刀而不是打磨：一家 16 人的公司，名册表 9 列 × 16 行 = 144 个格。逐格手敲
// 不是"慢一点"，是**不可用**——用户手里本来就有那张表，让他重新录一遍等于告诉他这个产品
// 不值得。粘贴把它变成一次 Ctrl+V。
//
// 纯前端、不碰后端。Excel / WPS / Numbers / Google Sheets 复制到剪贴板的 `text/plain`
// 都是 TSV：列用 \t 分隔、行用换行分隔，**含换行或引号的单元格用双引号包起来**、
// 引号内的引号写成两个。最后一条是这个文件存在的全部理由——`split('\t')` 会把一个
// 含换行的「当前阻塞」单元格劈成好几行垃圾，而那一列恰好是模板里最长的自由文本列
// （make-intake-xlsx.py 说它是「全表最有价值的一栏」）。

/** 一次粘贴解析出来的原始网格（行 × 列，未对齐到任何表）。 */
export interface PastedGrid {
  rows: string[][]
  /** 各行的列数（用来判"列数不符/错位"——预览里要让用户自己看见）。 */
  widths: number[]
}

/**
 * 剪贴板文本 → 二维网格。
 *
 * 规则按 RFC4180 的 TSV 变体：
 *   · 分隔符 \t，行分隔 \r\n / \n / \r（三种都认——跨平台复制什么都可能来）；
 *   · 单元格以 `"` 开头即为引号态，其中 `""` 是一个字面引号，直到落单的 `"` 结束；
 *   · 引号态里的 \t 和换行是**数据**，不是分隔符。
 *
 * 🔴 不做 trim：单元格里的前后空格可能是真的（「孙　浩」那种列对齐填充另说，那是后端
 *    `_HAN_PAD_RE` 的活）。这里只负责忠实还原用户粘了什么，判断留给校验层。
 */
export function parseTsv(text: string): PastedGrid {
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false
  let i = 0
  const n = text.length

  const endCell = () => {
    row.push(cell)
    cell = ''
  }
  const endRow = () => {
    endCell()
    rows.push(row)
    row = []
  }

  while (i < n) {
    const ch = text[i]
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"'
          i += 2
          continue
        }
        quoted = false
        i += 1
        continue
      }
      cell += ch
      i += 1
      continue
    }
    if (ch === '"' && cell === '') {
      quoted = true
      i += 1
      continue
    }
    if (ch === '\t') {
      endCell()
      i += 1
      continue
    }
    if (ch === '\r' || ch === '\n') {
      endRow()
      // \r\n 算一个换行
      i += ch === '\r' && text[i + 1] === '\n' ? 2 : 1
      continue
    }
    cell += ch
    i += 1
  }
  // 最后一行没有行尾换行符时也要收进来；但整段以换行结束时不要凭空多一个空行。
  if (cell !== '' || row.length > 0) endRow()

  // 全空行丢掉（Excel 常在选区末尾多带一行空的）。判据是"每一格都是空串"，
  // 而不是"行长度为 0"——一行 9 个空格子同样是空行。
  const kept = rows.filter((r) => r.some((c) => c.trim() !== ''))
  return { rows: kept, widths: kept.map((r) => r.length) }
}

/** 这次粘贴看起来带表头吗？—— 首行与列名逐格相等（去掉必填星号后比）就是表头，丢掉不当数据。 */
export function looksLikeHeader(first: string[], columnKeys: string[]): boolean {
  if (first.length === 0) return false
  let hits = 0
  for (let i = 0; i < Math.min(first.length, columnKeys.length); i++) {
    const cell = first[i].replace('*', '').trim().toLowerCase()
    if (cell && cell === columnKeys[i].toLowerCase()) hits += 1
  }
  // 过半列对上就当表头。不要求全对：用户可能只复制了前几列，或者手改过一两个表头。
  return hits >= Math.max(2, Math.ceil(Math.min(first.length, columnKeys.length) / 2))
}

/**
 * 网格对齐到某张表的列序 → 行对象数组。
 *
 * 列数不符**不报错、不猜**：多出来的列丢掉、缺的列留空，然后由调用方把"这次粘贴按 N 列
 * 对齐、你的数据有 M 列"如实摆在预览里让用户自己看。静默补齐或静默截断都会让一次错位
 * 粘贴看起来完全正常，而错位的代价是整张表的每一格都填错了位置。
 */
export function gridToRows(grid: PastedGrid, columnKeys: string[]): Record<string, string>[] {
  return grid.rows.map((cells) => {
    const row: Record<string, string> = {}
    columnKeys.forEach((key, i) => {
      row[key] = cells[i] ?? ''
    })
    return row
  })
}
