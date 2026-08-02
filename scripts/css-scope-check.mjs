#!/usr/bin/env node
// lite2.css 作用域检查 —— 找出**所有**没有 scoped 在 `.lite2-shell` 之下的选择器，一次列全。
//
// 为什么需要它：v01 壳（src/lite/styles/lite.css）与 v02 壳（本文件盯的 lite2.css）有近百个
// **逐字同名**的类——.upload-panel / .lite-ask-card / .lite-detail-card / .paperwork-* ……
// 一条裸选择器（比如 `.upload-panel { … }`）不认壳，两边一起改。
//
// 🔴 这个 bug 不会让任何一道门变红：CSS 照编译、产物照出、typecheck / lint / pytest 与它无关。
//    而 main.tsx 里 lite2.css import **排在最后**，同特异性时它压过 lite.css 与 look-*.css，
//    于是后果是 v01 壳被**静默改版**——没有报错、没有警告，只有截图上对不上的观感。
//    本波真实存量：177 条裸选择器（163 条规则），其中 .paperwork-* 整页 60 余条。
//
// 判定口径：只看**选择器**，不看规则体。逗号分隔的选择器列表**每一段单独判**——
// `.lite2-shell .a, .b { }` 里的 `.b` 照样算违规。
//
// 例外（不算违规，因为它们压根不是页面选择器）：
//   · @keyframes 内部的关键帧选择器（0% / from / to）——那是时间轴刻度不是选择器；
//   · @font-face（无选择器）；
//   · :root 级自定义属性声明。
// 注意 **@media / @supports 不算作用域**：它们内部的规则照样要带 `.lite2-shell `。
//
// 注意：解析必须**先剥掉注释**（保留换行以维持行号）。注释里的 `{` `}` 和类名（比如本文件
// 这段说明）会让裸扫描失真。
//
// 用法：node scripts/css-scope-check.mjs        非 0 退出 = 有裸选择器

import fs from 'node:fs'

const TARGET = 'src/lite2/styles/lite2.css'
const SCOPE = '.lite2-shell'

const raw = fs.readFileSync(TARGET, 'utf8')
// 剥注释，但保留换行以维持行号（长度不变，所以偏移量仍可直接用）
const src = raw.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))

const lineOf = (idx) => src.slice(0, idx).split('\n').length

// ── 逗号切分：括号 / 方括号 / 引号内部的逗号不算分隔符
//    （`:is(.a, .b)`、`[data-x="a,b"]` 这类写法目前没有，但别让脚本先坏在这上面）
function splitSelectorList(text) {
  const parts = []
  let depthParen = 0
  let depthBracket = 0
  let quote = null
  let from = 0
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (quote) {
      if (c === quote && text[i - 1] !== '\\') quote = null
      continue
    }
    if (c === '"' || c === "'") quote = c
    else if (c === '(') depthParen++
    else if (c === ')') depthParen--
    else if (c === '[') depthBracket++
    else if (c === ']') depthBracket--
    else if (c === ',' && depthParen === 0 && depthBracket === 0) {
      parts.push([from, i])
      from = i + 1
    }
  }
  parts.push([from, text.length])
  // 连位置一起带出去：报错要指到**选择器那一行**，而不是上一条规则的 `}` 那一行
  return parts
    .map(([a, b]) => {
      const chunk = text.slice(a, b)
      return { sel: chunk.trim(), offset: a + chunk.length - chunk.trimStart().length }
    })
    .filter((p) => p.sel)
}

// ── 走一遍花括号，收集所有「规则块」的前导（prelude）
const stack = []
let preludeStart = 0
const offenders = []

for (let i = 0; i < src.length; i++) {
  const ch = src[i]
  if (ch === '{') {
    const preludeRaw = src.slice(preludeStart, i)
    const prelude = preludeRaw.trim()
    const isAtRule = prelude.startsWith('@')
    const atName = isAtRule ? (prelude.match(/^@([\w-]+)/) || [, ''])[1].toLowerCase() : null
    // @keyframes 的孩子是关键帧刻度，不是选择器——整棵子树豁免
    const inKeyframes = stack.some((s) => s.isAtRule && /keyframes$/.test(s.atName))

    if (!isAtRule && !inKeyframes && prelude) {
      for (const { sel, offset } of splitSelectorList(preludeRaw)) {
        // :root 级变量声明豁免（它给的是 token，不是壳内部件）
        if (sel === ':root' || sel.startsWith(':root:')) continue
        if (sel.includes(SCOPE)) continue
        offenders.push({ line: lineOf(preludeStart + offset), sel })
      }
    }

    stack.push({ prelude, isAtRule, atName })
    preludeStart = i + 1
  } else if (ch === '}') {
    stack.pop()
    preludeStart = i + 1
  }
}

if (offenders.length) {
  console.log(`✗ ${TARGET}  ${offenders.length} 条选择器没有 scoped 在 ${SCOPE} 之下：\n`)
  for (const o of offenders) {
    console.log(`    第 ${o.line} 行： ${o.sel.replace(/\s+/g, ' ')}`)
  }
  console.log(`\n每一段都要写成 \`${SCOPE} <选择器>\`（@media 内部的也要），否则会污染 v01 壳。`)
  process.exit(1)
}

console.log(`✓ ${TARGET} 全部选择器已 scoped 在 ${SCOPE} 之下`)
