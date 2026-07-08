// feat-024（ADR-0022 决策 1）· story/lite 墙的机器闸。
//
// 边界不是纪律是红灯：lite import story 直接 error（反向同理）。渗漏从"忘了就漏"
// 翻转为"漏需要违法"。shared/** 是唯一公共地基，两侧都可 import。
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
    ['**/story', '**/story/**'],
    'lite 永不 import story（ADR-0022 墙）：fixtures/cases/rail/剧场场景是冻结路演资产。需要共用的原子放 src/shared/**。',
  ),
  wall(
    'story',
    ['**/lite', '**/lite/**'],
    'story 永不 import lite（ADR-0022 墙）：story 是冻结资产，不得依赖产品壳。共用原子放 src/shared/**。',
  ),
  wall(
    'shared',
    ['**/story', '**/story/**', '**/lite', '**/lite/**'],
    'shared 是地基：不得反向依赖 story 或 lite（ADR-0022 墙）。',
  ),
]
