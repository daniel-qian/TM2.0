// i18n 孤儿键扫描器（ticket i18n-orphan-scan-not-committed）。
//
// 目的：src/shared/i18n/en.ts 里有没有再也没人引用的 key？0729 画板退役已经确认留了至少一对
// （lite2.roomCanvasHint / roomCanvasReset——本票已经手删，见 en.ts 里 groupCountMany 下面那段
// "0729 画板退役" 注释），这个脚本是为了把"还有没有别的"这个问题从人工翻文件变成可重跑的检查。
// 跑过一遍之后，en.ts 现在还剩 12 个孤儿没删（跑 `node scripts/i18n-orphans.mjs` 自己看，别抄
// 这行注释里的数字——列表会随 en.ts 变化，注释不会跟着自动更新）。
//
// 🔴 为什么第一步必须用 TS AST，不能用朴素单行正则：
//   en.ts 里 key: value 有两种写法——
//     单行：    caption: 'Give it what you'd hand...',
//     跨行：    caption:
//                 'Give it what you'd hand...',
//   （长字符串换行是常态——787 条单行 + 98 条跨行，一共 885 个叶子键，9 个命名空间）。
//   `/^\s*(\w+):\s*['"]/` 这种单行正则只逮得到单行的 787 条，跨行那 98 条（约占 11%）的 key
//   会被漏扫——脚本会一本正经地把它们判成"孤儿"，其实只是正则瞎了。所以这里老老实实用
//   `ts.createSourceFile` 解析出真正的 PropertyAssignment 节点，值写在同一行还是下一行，
//   AST 都不 care。
//
// 用法：node scripts/i18n-orphans.mjs

import fs from 'node:fs'
import path from 'node:path'
import ts from 'typescript'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const EN_PATH = path.resolve(ROOT, 'src/shared/i18n/en.ts')
const SRC_DIR = path.resolve(ROOT, 'src')

// ── 第一步：把 `export const en = {...}` 拍平成 {ns, key, line} 全集（真 AST，不是正则） ──

const enText = fs.readFileSync(EN_PATH, 'utf8')
const enSourceFile = ts.createSourceFile(EN_PATH, enText, ts.ScriptTarget.Latest, true)

let enObjectLiteral = null
function findEnLiteral(node) {
  if (
    enObjectLiteral === null &&
    ts.isVariableDeclaration(node) &&
    ts.isIdentifier(node.name) &&
    node.name.text === 'en' &&
    node.initializer &&
    ts.isObjectLiteralExpression(node.initializer)
  ) {
    enObjectLiteral = node.initializer
    return
  }
  ts.forEachChild(node, findEnLiteral)
}
findEnLiteral(enSourceFile)

if (!enObjectLiteral) {
  console.error(`[i18n-orphans] 没在 ${path.relative(ROOT, EN_PATH)} 里找到 "export const en = {...}" —— 结构大概被改了，宁可报错退出也不要吐一份空的孤儿清单骗人。`)
  process.exit(1)
}

function lineOf(node) {
  return enSourceFile.getLineAndCharacterOfPosition(node.getStart(enSourceFile)).line + 1
}

// leaves: 每个叶子键一条 {ns, key, line}。en.ts 目前是纯二层结构（namespace -> key -> string），
// 没有第三层嵌套对象——如果某天真长出嵌套，这里只会把嵌套对象本身当成"没有可孤儿判定的叶子"
// 跳过（不递归展开），届时需要有人回来扩这段 AST walk。
const leaves = []
for (const nsProp of enObjectLiteral.properties) {
  if (!ts.isPropertyAssignment(nsProp)) continue
  const ns = nsProp.name.getText(enSourceFile)
  if (!ts.isObjectLiteralExpression(nsProp.initializer)) continue
  for (const leafProp of nsProp.initializer.properties) {
    if (!ts.isPropertyAssignment(leafProp)) continue
    const key = leafProp.name.getText(enSourceFile)
    leaves.push({ ns, key, line: lineOf(leafProp) })
  }
}

// 自检：叶子键总数掉得太狠 = AST walk 漏掉了一整批（比如又出现一种这里没认出来的写法）。
// 这时候必须报错退出，不能悄悄吐一份缺胳膊少腿的孤儿清单——那样"孤儿"列表里会混进一堆
// 其实活着、只是没扫到的假孤儿，而照着那份清单删就是真删功能。
//
// 🔴 这个下限**每次合法删键都会失效一次**，所以它必须跟着一起改，且要留下账：
//   2026-07-xx 手数真值 885（787 单行 + 98 多行，9 个命名空间），下限设 880
//   2026-07-xx 删 lite2.roomCanvasHint / roomCanvasReset          → 883
//   2026-08-03 票 #37 删 detailSource（lite + lite2 两处）         → 881
//   2026-08-03 票 i18n-orphans 删 12 个（考古 + 对抗复核后全判"退役文案"）→ 869
// 改这个数之前先问一句：**这次少的键，是我有意删的，还是 walker 突然瞎了？**
// 前者才允许调低；后者去修 walker。判断方法：`git diff src/shared/i18n/en.ts` 数一下删了几行。
const MIN_EXPECTED_KEYS = 865
if (leaves.length < MIN_EXPECTED_KEYS) {
  console.error(
    `[i18n-orphans] 只扫到 ${leaves.length} 个叶子键，预期 >= ${MIN_EXPECTED_KEYS}。` +
      `如果你**刚刚有意删过键**，把上面的账续一行、把下限改对；` +
      `否则 AST walk 大概率漏看了某个命名空间或某种值写法——去修 walker，别调低这个数。`,
  )
  process.exit(1)
}

const namespaceCount = enObjectLiteral.properties.filter(
  (p) => ts.isPropertyAssignment(p) && ts.isObjectLiteralExpression(p.initializer),
).length
console.log(`[i18n-orphans] en.ts 拍平出 ${leaves.length} 个叶子键，${namespaceCount} 个命名空间。`)

// ── 第二步：对每个叶子键，在 src/ 全量搜索引用 ──
//
// 这个代码库里实际存在的三种引用形态（写脚本前先 grep 过，不是拍脑袋）：
//   (a) 直接访问   —— `t.lite2.roomCanvasHint`
//   (b) 解构别名   —— `const { roomCanvasHint } = t.lite2`（目前仓库里还没人这么写，但别名解构
//                     是常见 i18n 消费方式，脚本得认得，不能等有人这么写了才发现漏扫）
//   (c) 命名空间中转 —— `const l = t.lite2` 之后通篇用 `l.roomCanvasHint`（LiteBell.tsx /
//                     OnboardGate.tsx 等一大批文件都是这个写法）
//
// 还有第四种：adviceLevels.ts / handoffCopy.ts / streamCopy.ts / briefing.ts / projectStatus.ts
// 这类共享辅助函数接一个类型对齐 Dict 形状的 `copy` 参数，读 `copy.someKey`，从来不写
// `t.lite`/`t.lite2` 字面量——调用方传哪个命名空间的切片，函数自己并不知道。这种访问没法静态
// 归属到具体命名空间，所以处理方式是：只要某个 key 出现过这种"不挂在已知 t/别名下"的裸
// `.key` 访问，就判定这个 key 在**所有定义了同名 key 的命名空间**里都算被引用——宁可保守
// （放过真的共享 key），也不要因为看不清调用方是谁就把 lite/lite2 的"孪生"共享 key 错判成孤儿。
// 代价：如果某天 lite 和 lite2 的同名 key 只有一侧真的被这种裸访问用到、另一侧其实已经死了，
// 这个脚本会漏报——这是已知的保守偏差，不是 bug。

function listSourceFiles(dir) {
  const out = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      out.push(...listSourceFiles(full))
    } else if (/\.(ts|tsx)$/.test(entry.name)) {
      out.push(full)
    }
  }
  return out
}

const allFiles = listSourceFiles(SRC_DIR).filter(
  (f) => f !== EN_PATH && f !== path.resolve(ROOT, 'src/shared/i18n/zh.ts'),
)

// 已知的命名空间名字全集，用来判断某个 alias/destructure 绑定的是不是我们的字典。
const knownNamespaces = new Set(leaves.map((l) => l.ns))
// 按长度降序排列再拼进正则 alternation——避免 `lite` 抢先匹配掉 `lite2` 的前缀（虽然 \b
// 加上 regex 回溯本来就能救回来，长的排前面更省心，也更好读）。
const nsAlt = [...knownNamespaces].sort((a, b) => b.length - a.length).join('|')

// hits: `${ns}.${key}` -> true（namespace-precise 命中，来自 (a)(b)(c) 三种形态）
const preciseHits = new Set()
// genericHits: key -> true（namespace-blind 命中，来自"裸 .key 挂在非 t/非别名 identifier 上"）
const genericHits = new Set()

// 🔴 别名绑定不能死认「RHS 必须是字面量 t.NS」——transport.ts/onboardNote.ts 这类不走 useDict()
// hook 的模块级函数，实际写法是 `const t = getDict(resolveLocale()).transport`（连 `t` 这个
// 名字本身都被"借用"来指代 transport 这一个命名空间切片，不是顶层字典）。所以这里认「RHS 是
// 任意表达式，只要它以 `.NS` 收尾（后面不再跟 `.something`）」，而不是死抠 RHS 必须从 `t.` 开始。
const aliasBindRe = new RegExp(
  `\\b(?:const|let|var)\\s+(\\w+)\\s*=\\s*[^;\\n]*?\\.(${nsAlt})\\b(?!\\.\\w)`,
  'g',
)
const destructureBindRe = new RegExp(
  `\\bconst\\s*\\{([^}]*)\\}\\s*=\\s*[^;\\n]*?\\.(${nsAlt})\\b(?!\\.\\w)`,
  'g',
)
// (a) 顶层字典变量的经典两段式：`t.NS.KEY`（`t` 来自 useDict() 返回值，是整本字典）。
const directAccessRe = /\bt\.(\w+)\.(\w+)\b/g
// 排除 `t.NS.KEY` 里第二段之后再跟的 `.KEY2` 属性访问链（比如未来出现 t.ns.key.length 之类）——
// 这里只关心第一层属性名，不需要处理更深的链式访问，因为 en.ts 目前就是二层结构。

for (const file of allFiles) {
  const text = fs.readFileSync(file, 'utf8')

  // (c) 命名空间中转：先把这个文件里所有「alias = <随便什么表达式>.NS」绑定收集好——
  // 包括 `const l = t.lite2`，也包括 `const t = getDict(resolveLocale()).transport`
  // （transport.ts 两份、onboardNote.ts 都是后一种，alias 名字本身还借用了 `t`）。
  const aliasToNs = new Map()
  for (const m of text.matchAll(aliasBindRe)) {
    const [, alias, ns] = m
    if (knownNamespaces.has(ns)) aliasToNs.set(alias, ns)
  }

  // (a) 顶层字典的两段式直接访问：t.NS.KEY
  for (const m of text.matchAll(directAccessRe)) {
    const [, ns, key] = m
    if (knownNamespaces.has(ns)) preciseHits.add(`${ns}.${key}`)
  }

  // (b) 解构别名：const { KEY, OTHER: renamed } = <expr>.NS
  for (const m of text.matchAll(destructureBindRe)) {
    const [, inner, ns] = m
    if (!knownNamespaces.has(ns)) continue
    for (const part of inner.split(',')) {
      const name = part.trim().split(':')[0].trim().replace(/^\.\.\./, '')
      if (name) preciseHits.add(`${ns}.${name}`)
    }
  }

  // (c) 别名转发：alias.KEY，其中 alias 是上面收集到的绑定（一段式访问，因为 alias 本身
  // 已经是某个命名空间的切片，不是整本字典）。
  for (const [alias, ns] of aliasToNs) {
    const re = new RegExp(`\\b${alias}\\.(\\w+)\\b`, 'g')
    for (const m of text.matchAll(re)) {
      preciseHits.add(`${ns}.${m[1]}`)
    }
  }

  // (d) 裸访问兜底：`identifier.KEY`，identifier 不是上面收集到的已知别名（含被借用的 `t`，
  // 比如 transport.ts 那种 `const t = getDict(...).transport`）。
  //
  // 注意这里**不**特殊跳过字面量 `t`：RoomScreen.tsx 的 speakerMeta 这类函数按"形状"收参数
  // （`function speakerMeta(t: { roomToolLabel: string })`）——参数恰好也叫 `t`，但它是个函数
  // 参数，不是 `const t = ...` 声明，(c) 的别名收集抓不到它，访问永远是一段式 `t.roomToolLabel`。
  // 放行这类裸 `t.KEY` 落进 genericHits 是安全的：唯一会被"波及"的是 `t.NS.KEY`（两段式、顶层
  // 字典的标准用法）里 `t.NS` 这个前缀本身也会被本正则单独扫到、把 NS（命名空间名字）当成一个
  // "键名"塞进 genericHits——但全仓只有一个叶子键的名字撞了命名空间名字（`nexus.ask`
  // 撞 `ask` 命名空间），而它早就被 (a) 两段式直接命中了，这条兜底加不加都无所谓。
  const bareAccessRe = /\b(\w+)\.(\w+)\b/g
  for (const m of text.matchAll(bareAccessRe)) {
    const [, base, key] = m
    if (aliasToNs.has(base)) continue // 已经被 (c) 处理过，不重复计入
    genericHits.add(key)
  }

  // (e) 动态查表兜底：streamCopy.ts 的 CODE_KEY 这类「code → 字典键名」映射，字典键名是以**字符
  // 串字面量**的身份出现的（`'nudge-redline': 'streamNudgeRedline'`），从来不写成
  // `xxx.streamNudgeRedline` 这种属性访问，前面 (a)-(d) 都逮不到。凡是引号字符串、且紧跟在
  // `: ` 之后、看起来像一个 object 属性值的位置，只要内容等于某个真叶子键名，就算一次命中。
  const stringLiteralValueRe = /:\s*['"]([A-Za-z_][A-Za-z0-9_]*)['"]\s*[,}]/g
  for (const m of text.matchAll(stringLiteralValueRe)) {
    genericHits.add(m[1])
  }
}

// ── 汇总：每个叶子键是否"被引用" ──
const orphans = []
for (const leaf of leaves) {
  const used = preciseHits.has(`${leaf.ns}.${leaf.key}`) || genericHits.has(leaf.key)
  if (!used) orphans.push(leaf)
}

console.log(`[i18n-orphans] 搜了 ${allFiles.length} 个 src/ 下的 .ts/.tsx 文件。`)
console.log(`[i18n-orphans] 孤儿键：${orphans.length} 个（真实数字，不要沿用票面估数）。`)
if (orphans.length > 0) {
  console.log('')
  for (const o of orphans) {
    console.log(`  en.ts:${o.line}  ${o.ns}.${o.key}`)
  }
}

process.exit(0)
