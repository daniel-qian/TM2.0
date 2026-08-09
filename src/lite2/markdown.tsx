import type { ReactNode } from 'react'

// #75 · 回答的 markdown 渲染——最小子集，自己解析成 React 元素树。
//
// 为什么不引 marked/react-markdown：
//   ① 那一族的常规用法是产出 HTML 字符串再 `dangerouslySetInnerHTML`，XSS 面就此打开，
//      要再配一个 DOMPurify 才补得回来——两个依赖换一段「后端吐的分点别糊成一坨」；
//   ② 本仓 src/ 至今**零** `dangerouslySetInnerHTML`（开工时全域 grep 过），这条纪律值钱，
//      不该为一个短答渲染破掉。
//
// 🔴 安全模型（判据落在这两条上，不落在「我们用了某个库」上）：
//   · 产物是 React 元素，正文一律走**文本节点**——React 自己转义，`<img onerror=…>`
//     这类 payload 在屏幕上就是那几个字，不是节点。
//   · 因此唯一的注入面是**链接的 href**（React 不会替你挡 `javascript:`）。scheme 走
//     白名单且 **fail closed**：认不出来的一律退成纯文字，不生成 <a>。
//
// 支持的子集（够 LLM 答复用，刻意不做全量 CommonMark）：
//   段落 / 标题 #~### / 无序表 -,*,+ / 有序表 1. / 引用 > / 围栏代码 ``` / 管道表格 /
//   行内 `code` **粗** *斜* [链接](url)

// 只认这三种 scheme。相对路径、锚点、协议相对 `//host` 一律不认——后端回答里不该出现，
// 出现了也宁可退成纯文字（fail closed 比「猜一个对的」安全）。
const SAFE_SCHEME = /^(?:https?:|mailto:)/i
// scheme 的合法形状（RFC3986）。故意用严格字符类：`java\nscript:` / `java\tscript:` 这类
// 掺了控制字符的绕过形状在这里就匹配失败 → 落到 return false。
const HAS_SCHEME = /^[a-zA-Z][a-zA-Z0-9+.-]*:/

export function isSafeHref(raw: string): boolean {
  const url = raw.trim()
  if (url === '') return false
  if (!HAS_SCHEME.test(url)) return false
  return SAFE_SCHEME.test(url)
}

// ── 行内 ────────────────────────────────────────────────────────────────────────
// 扫描规则表取**最早命中**的那条（同起点时按表序，所以 ** 必须排在 * 前面）。

// `lead` = 这条规则为了「不撞上别的标记」而多吃的前导字符数。命中区间因此是
// [m.index + lead, m.index + m[0].length)，前导那几个字符要还回正文。
// 🔴 刻意不用 lookbehind（`(?<!\*)`）：那是 ES2018 语法，旧 iOS Safari 在**解析正则时**
//    就抛 SyntaxError，模块一加载整屏就白——真机（iOS/微信）本来就是零覆盖面，不在这儿赌。
type InlineRule = {
  re: RegExp
  lead: number
  render: (m: RegExpExecArray, key: string) => ReactNode
}

const INLINE_RULES: InlineRule[] = [
  // 行内代码最优先，且**内容不再往下解析**——代码里的 * 和 [ 就是字面量。
  {
    re: /`([^`\n]+)`/,
    lead: 0,
    render: (m, key) => (
      <code key={key} className="lite-md-code">
        {m[1]}
      </code>
    ),
  },
  {
    re: /\[([^\]\n]+)\]\(([^)\s]*)\)/,
    lead: 0,
    render: (m, key) => {
      const label = m[1]
      const href = m[2]
      // 🔴 认不出的 scheme：**不生成 <a>**，把原文照抄出来（含中括号圆括号），
      //    manager 看到的是 Avery 原样吐的字符串，而不是一个能点的陷阱。
      if (!isSafeHref(href)) return <span key={key}>{m[0]}</span>
      return (
        <a
          key={key}
          className="lite-md-link"
          href={href.trim()}
          target="_blank"
          rel="noopener noreferrer nofollow"
        >
          {renderInline(label, `${key}-l`)}
        </a>
      )
    },
  },
  // 标记内容两端必须是非空白（`\S…\S`）：否则「2 * 3 * 4」这种乘法会被当成一段斜体。
  // CommonMark 的 left/right-flanking 规则本质也是这一条，这里只取够用的那一半。
  {
    re: /\*\*(\S(?:[^*\n]*\S)?)\*\*/,
    lead: 0,
    render: (m, key) => <strong key={key}>{renderInline(m[1], `${key}-b`)}</strong>,
  },
  // 斜体要躲开 `**`：单独一条 `\*(…)\*` 会把 `**粗**` 的前两个星当成一对空斜体。
  // 用「前面不是 *」的显式前导字符表达（lead=1），行首那一路交给 `^` 分支（lead=0）。
  {
    re: /^\*(\S(?:[^*\n]*\S)?)\*/,
    lead: 0,
    render: (m, key) => <em key={key}>{renderInline(m[1], `${key}-e`)}</em>,
  },
  {
    re: /[^*]\*(\S(?:[^*\n]*\S)?)\*/,
    lead: 1,
    render: (m, key) => <em key={key}>{renderInline(m[1], `${key}-e`)}</em>,
  },
]

function renderInline(src: string, keyBase: string): ReactNode[] {
  const out: ReactNode[] = []
  let rest = src
  let n = 0
  // 防御性上限：任何一条规则若消费不了字符就会死循环，这里兜一道（正常输入远够不着）。
  let guard = 0
  while (rest.length > 0 && guard++ < 4000) {
    let best: { start: number; end: number; rule: InlineRule; m: RegExpExecArray } | null = null
    for (const rule of INLINE_RULES) {
      const m = rule.re.exec(rest)
      if (m === null) continue
      const start = m.index + rule.lead
      if (best === null || start < best.start) {
        best = { start, end: m.index + m[0].length, rule, m }
      }
    }
    if (best === null) {
      out.push(rest)
      break
    }
    if (best.start > 0) out.push(rest.slice(0, best.start))
    out.push(best.rule.render(best.m, `${keyBase}-${n++}`))
    rest = rest.slice(best.end)
  }
  if (guard >= 4000) out.push(rest)
  return out
}

// ── 块级 ────────────────────────────────────────────────────────────────────────

const FENCE = /^\s*```/
const HEADING = /^(#{1,3})\s+(.*)$/
const UL_ITEM = /^\s*[-*+]\s+(.*)$/
const OL_ITEM = /^\s*\d+[.)]\s+(.*)$/
const QUOTE = /^\s*>\s?(.*)$/
const TABLE_ROW = /^\s*\|(.*)\|\s*$/
const TABLE_DIVIDER = /^\s*\|[\s:|-]+\|\s*$/

function splitCells(line: string): string[] {
  const m = TABLE_ROW.exec(line)
  if (m === null) return []
  return m[1].split('|').map((c) => c.trim())
}

/**
 * 把一段 markdown 文本渲染成 React 元素。
 * 传空/空白返回 null——调用方据此决定「整块不渲染」而不是渲染一个空壳。
 */
export function renderMarkdown(src: string, keyBase = 'md'): ReactNode {
  if (!src || src.trim() === '') return null
  const lines = src.replace(/\r\n?/g, '\n').split('\n')
  const blocks: ReactNode[] = []
  let i = 0
  let n = 0
  const key = () => `${keyBase}-${n++}`

  while (i < lines.length) {
    const line = lines[i]

    // 空行：块分隔，跳过。
    if (line.trim() === '') {
      i += 1
      continue
    }

    // 围栏代码块：整块逐字保留，不做任何行内解析。没有收尾围栏就吃到结尾。
    if (FENCE.test(line)) {
      const lang = line.replace(/^\s*```/, '').trim()
      const body: string[] = []
      i += 1
      while (i < lines.length && !FENCE.test(lines[i])) {
        body.push(lines[i])
        i += 1
      }
      i += 1 // 吃掉收尾围栏（到结尾时越界无害）
      blocks.push(
        <pre key={key()} className="lite-md-pre" data-md-lang={lang || undefined}>
          <code>{body.join('\n')}</code>
        </pre>,
      )
      continue
    }

    // 标题（只到 h3——回答里不该有更深的层级，再深也压平成 h3）。
    const heading = HEADING.exec(line)
    if (heading) {
      const depth = heading[1].length
      const Tag = (depth === 1 ? 'h3' : depth === 2 ? 'h4' : 'h5') as 'h3' | 'h4' | 'h5'
      const k = key()
      blocks.push(
        <Tag key={k} className="lite-md-heading">
          {renderInline(heading[2], k)}
        </Tag>,
      )
      i += 1
      continue
    }

    // 管道表格：要求第二行是分隔行，否则当普通段落（避免把「| 号开头的一句话」误判成表）。
    if (TABLE_ROW.test(line) && i + 1 < lines.length && TABLE_DIVIDER.test(lines[i + 1])) {
      const head = splitCells(line)
      i += 2
      const rows: string[][] = []
      while (i < lines.length && TABLE_ROW.test(lines[i])) {
        rows.push(splitCells(lines[i]))
        i += 1
      }
      const k = key()
      blocks.push(
        <div key={k} className="lite-md-table-wrap">
          <table className="lite-md-table">
            <thead>
              <tr>
                {head.map((c, ci) => (
                  <th key={`${k}-h${ci}`}>{renderInline(c, `${k}-h${ci}`)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, ri) => (
                <tr key={`${k}-r${ri}`}>
                  {r.map((c, ci) => (
                    <td key={`${k}-r${ri}c${ci}`}>{renderInline(c, `${k}-r${ri}c${ci}`)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>,
      )
      continue
    }

    // 列表（有序/无序各自成块，连续同类行归一块）。
    const isUl = UL_ITEM.test(line)
    const isOl = !isUl && OL_ITEM.test(line)
    if (isUl || isOl) {
      const items: string[] = []
      const rule = isUl ? UL_ITEM : OL_ITEM
      while (i < lines.length && rule.test(lines[i])) {
        items.push(rule.exec(lines[i])![1])
        i += 1
      }
      const k = key()
      const Tag = isUl ? 'ul' : 'ol'
      blocks.push(
        <Tag key={k} className="lite-md-list">
          {items.map((it, ii) => (
            <li key={`${k}-${ii}`}>{renderInline(it, `${k}-${ii}`)}</li>
          ))}
        </Tag>,
      )
      continue
    }

    // 引用块。
    if (QUOTE.test(line)) {
      const body: string[] = []
      while (i < lines.length && QUOTE.test(lines[i])) {
        body.push(QUOTE.exec(lines[i])![1])
        i += 1
      }
      const k = key()
      blocks.push(
        <blockquote key={k} className="lite-md-quote">
          {renderInline(body.join('\n'), k)}
        </blockquote>,
      )
      continue
    }

    // 段落：吃到空行或下一个块级起手式为止。段内换行靠 CSS `white-space: pre-wrap` 保住
    //（聊天里单个换行是有意义的，标准 markdown 那套「单换行折叠成空格」在这儿反人类）。
    const para: string[] = []
    while (
      i < lines.length &&
      lines[i].trim() !== '' &&
      !FENCE.test(lines[i]) &&
      !HEADING.test(lines[i]) &&
      !UL_ITEM.test(lines[i]) &&
      !OL_ITEM.test(lines[i]) &&
      !QUOTE.test(lines[i])
    ) {
      para.push(lines[i])
      i += 1
    }
    const k = key()
    blocks.push(
      <p key={k} className="lite-md-p">
        {renderInline(para.join('\n'), k)}
      </p>,
    )
  }

  return <div className="lite-md">{blocks}</div>
}
