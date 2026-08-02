// feat-024（ADR-0022 决策 1）· story/lite 墙的机器闸。feat-035（lite-live-v02 kickoff §架构
// 拍板 5）在此基础上加第三区 lite2（v02 并排壳，copy-then-wall）：lite2 与 story 互不 import
// （同 lite/story 那条），lite2 与 lite（v01）也互不 import——两个产品壳各自独立生长，
// 不共享除 src/shared/** 外的任何代码。
//
// 边界不是纪律是红灯：违规 import 直接 error（三区两两互斥，方向不看）。渗漏从"忘了就漏"
// 翻转为"漏需要违法"。shared/** 是唯一公共地基，三侧都可 import。
// 跑法：npm run lint（init.sh 已挂——AFK 门的一部分，红了不许标 done）。
import tsParser from '@typescript-eslint/parser'

// 把 banned（no-restricted-imports 用的 glob pattern 数组，如 ['**/story','**/story/**']）
// 拍平成裸段名集合（如 ['story']）——下面动态 import() 的字面量检测复用同一份名单，不手抄
// 第二遍（第 8 号票：ADR-0022 分区墙原先只挡得住静态 import，import() 是另一条 ESLint 规则
// 管，此前能合法越墙）。
const bannedSegments = (banned) => {
  const names = new Set()
  for (const pattern of banned) {
    const match = /^\*\*\/([^/]+)/.exec(pattern)
    if (match) names.add(match[1])
  }
  return [...names]
}

const wall = (zone, banned, message, extraSyntaxRules = []) => {
  const segments = bannedSegments(banned)
  return {
    files: [`src/${zone}/**/*.{ts,tsx}`],
    languageOptions: {
      parser: tsParser,
      ecmaVersion: 'latest',
      sourceType: 'module',
    },
    // 无视一切行内 eslint 注释：老代码里有指向未安装插件的 disable 注释（会误报），
    // 顺带保证墙规则不可能被行内 eslint-disable 绕开。
    linterOptions: { noInlineConfig: true, reportUnusedDisableDirectives: 'off' },
    rules: {
      'no-restricted-imports': [
        'error',
        { patterns: [{ group: banned, message }] },
      ],
      // 🔴 no-restricted-syntax 与上面这条必须挤在同一个 rules 对象里、同一个数组里：flat
      // config 对同名 rule 是「后者整条覆盖前者」，不是合并（拿两个各自 files 覆盖同一批
      // 文件的独立 config 块各写一次 no-restricted-syntax 真试过——排后面的那条会把排前面的
      // 整条判定吃掉，born-red 只剩一半会红）。extraSyntaxRules 是 lite2 专属的 <Link to>
      // 字面量检查（第 4 号票），同一个数组里追加，不新开 config 块。
      'no-restricted-syntax': [
        'error',
        {
          // 结尾是 `(\/|$)` 不是 `\/`：裸目录形态 `import('../../lite')` 也要拦。写死斜杠会漏掉它，
          // 而静态那条 no-restricted-imports 的 `**/lite` 是覆盖裸目录的——两条墙口径必须一致，
          // 否则"静态拦得住、动态拦不住"就是墙上的一个洞（今天 src/lite 与 src/story 都没有 index
          // barrel 所以不可利用，但这属于运气，不属于设计）。
          selector: `ImportExpression > Literal[value=/^(\\.\\.\\/)*(src\\/)?(${segments.join('|')})(\\/|$)/]`,
          message: `${message}动态 import() 同样受 ADR-0022 分区墙约束。`,
        },
        ...extraSyntaxRules,
      ],
    },
  }
}

// 第 4 号票（link-href-invariant-comment-enforced）：lite2 站内 <Link to> 必须走
// src/lite2/routes.ts 的 href 助手（paperworkHref/visionHref/filesHref），不能手拼字面量
// 字符串或模板字符串——论证见 routes.ts 顶部「粘性 query」节。只查 lite2：v01（story/lite）
// 没有这套粘性 query 契约，不需要这条。
const LITE2_LINK_TO_MESSAGE =
  '<Link to> 必须走 routes.ts 的 href 助手（paperworkHref/visionHref/filesHref），手拼路径会丢粘性 query ?v=2、整壳掉回 v01'
// 🔴 口径是**白名单**不是黑名单：只放行 `to={xxxHref()}`（直接函数调用），其余一律拦。
// 起初写成两条 deny selector（Literal + TemplateLiteral），复核用探针实测漏两种最容易写出来的形态：
//   · `<Link to={'/paperwork'}>`  —— 字面量套进花括号，value.type 变成 JSXExpressionContainer，漏过
//   · `<Link to={PAPERWORK_PATH}>` —— 直接用路径常量、忘了 carrySearch()，**这正是本纪律要防的原始 bug 形状**
// 黑名单永远漏在"想不到的那一种"上；这里改成 :not(允许的那一种)，新形态默认被拦而不是默认放行。
const LITE2_LINK_TO_EXTRA_RULES = [
  {
    selector:
      "JSXOpeningElement[name.name='Link'] > JSXAttribute[name.name='to']" +
      ":not([value.type='JSXExpressionContainer'][value.expression.type='CallExpression'])",
    message: LITE2_LINK_TO_MESSAGE,
  },
]

export default [
  wall(
    'lite',
    ['**/story', '**/story/**', '**/lite2', '**/lite2/**'],
    'lite（v01）永不 import story 或 lite2（ADR-0022 墙 + feat-035 扩展）：story 是冻结路演资产，lite2 是并排的独立 v02 壳——两侧壳各自生长，不共享除 src/shared/** 外的代码。需要共用的原子放 src/shared/**。',
  ),
  wall(
    'lite2',
    ['**/story', '**/story/**', '**/lite', '**/lite/**'],
    'lite2（v02）永不 import story 或 lite（v01）（ADR-0022 墙 + feat-035 kickoff §架构拍板 5）：story 是冻结路演资产，lite 是冻结的 v01 壳——lite2 是从 lite 整树 copy-then-wall 出来的独立并排壳，不回头依赖 v01。需要共用的原子放 src/shared/**。',
    LITE2_LINK_TO_EXTRA_RULES,
  ),
  wall(
    'story',
    ['**/lite', '**/lite/**', '**/lite2', '**/lite2/**'],
    'story 永不 import lite 或 lite2（ADR-0022 墙 + feat-035 扩展）：story 是冻结资产，不得依赖任何产品壳（v01 或 v02）。共用原子放 src/shared/**。',
  ),
  wall(
    'shared',
    ['**/story', '**/story/**', '**/lite', '**/lite/**', '**/lite2', '**/lite2/**'],
    'shared 是地基：不得反向依赖 story、lite 或 lite2（ADR-0022 墙 + feat-035 扩展）。',
  ),
  // 第 8 号票（同一票内两坑一起补）：组合根是全仓唯一合法的跨区动态 import 点
  // （App.tsx:16/18/19 懒加载 story/lite/lite2）；在别处加动态 import 会被上面的
  // no-restricted-syntax 拦下，这是有意的。App.tsx 本身不在任何 src/<zone>/** 之下，
  // 上面四个 wall() 的 files 本来就够不着它——这条 override 纯粹是留给读代码的人看，
  // 说明「这里没规则不是漏了，是它本来就不该有」。
  {
    files: ['src/App.tsx'],
    // App.tsx 之前一个 config 块都够不着（没人给它挂 files），eslint 直接跳过整个文件，
    // 不算「全绿」是「没被验过」。这里补上 languageOptions 才能真解析 TSX——否则
    // no-restricted-syntax 之外还会先炸一个 parsing error（born-red 试出来的，见 self_check）。
    languageOptions: {
      parser: tsParser,
      ecmaVersion: 'latest',
      sourceType: 'module',
    },
    rules: { 'no-restricted-syntax': 'off' },
  },
]
