#!/usr/bin/env node
// CSS 花括号配平检查 —— 找出**所有**未闭合的块，一次列全。
//
// 为什么需要它：合并 CSS 时冲突边界经常落在某条规则**内部**，它的 `}` 在冲突区的另一侧。
// 按「两块都留」拼接就会留下一条未闭合的规则，于是**从它往下的每一条规则都被吞进去**。
//
// 🔴 这个 bug 不会让 build 变红：esbuild 只报一句 warning，然后在 EOF 处替你自动闭合，
//    产物照出、退出码 0。typecheck / lint / pytest 与 CSS 无关。四道门一道都拦不住。
//    本波真实后果：feat-053 的整套账号面板样式只在用户开了「减少动效」时才生效。
//
// 而且 esbuild **一次只报最外层那一个**，修完再跑才看见下一个——所以要这个脚本一次列全。
//
// 注意：计数必须**先剥掉注释**。注释文字里出现的 `{` `}`（比如本文件这段说明）会让裸计数失真。
//
// 用法：node scripts/css-brace-check.mjs        非 0 退出 = 有未闭合

import fs from 'node:fs'
import path from 'node:path'

const ROOTS = ['src']
const files = []
;(function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) walk(p)
    else if (e.name.endsWith('.css')) files.push(p)
  }
})(ROOTS[0])

let bad = 0
for (const f of files) {
  const raw = fs.readFileSync(f, 'utf8')
  // 剥注释，但保留换行以维持行号
  const src = raw.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
  const lines = src.split('\n')

  const stack = []
  for (let i = 0; i < lines.length; i++) {
    for (const ch of lines[i]) {
      if (ch === '{') stack.push(i + 1)
      else if (ch === '}') stack.pop()
    }
  }

  const net = (src.match(/\{/g) || []).length - (src.match(/\}/g) || []).length
  if (net !== 0 || stack.length) {
    bad++
    console.log(`✗ ${f}  净差 ${net > 0 ? '+' : ''}${net}`)
    for (const ln of stack) {
      console.log(`    未闭合的 { 在第 ${ln} 行： ${(lines[ln - 1] || '').trim().slice(0, 90)}`)
    }
  }
}

if (bad) {
  console.log(`\n${bad} 个文件未配平。`)
  process.exit(1)
}
console.log(`✓ ${files.length} 个 CSS 文件全部配平`)
