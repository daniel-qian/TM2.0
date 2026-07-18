// feat-024（ADR-0022 决策 1）· story/lite 墙的机器闸。feat-035（lite-live-v02 kickoff §架构
// 拍板 5）在此基础上加第三区 lite2（v02 并排壳，copy-then-wall）：lite2 与 story 互不 import
// （同 lite/story 那条），lite2 与 lite（v01）也互不 import——两个产品壳各自独立生长，
// 不共享除 src/shared/** 外的任何代码。
//
// 边界不是纪律是红灯：违规 import 直接 error（三区两两互斥，方向不看）。渗漏从"忘了就漏"
// 翻转为"漏需要违法"。shared/** 是唯一公共地基，三侧都可 import。
// 跑法：npm run lint（init.sh 已挂——AFK 门的一部分，红了不许标 done）。
import tsParser from '@typescript-eslint/parser'

const wall = (zone, banned, message) => ({
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
  },
})

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
]
