import { useDict } from '../shared/i18n/useDict'

// feat-035（PRD F6）· 合规免责页脚——lite2 壳全局常驻（不随 tab 切换消失）。
// 口吻走我们的备忘录腔（非监管腔）：Avery 只辅助判断、不替代负责人决策；产出需复核；
// 不得作为重大人事决策唯一依据。EN 本波定稿；ZH 走 scripts/i18n-zh.mjs 定向模式。
export function Lite2Footer() {
  const { t } = useDict()
  return (
    <footer className="lite2-compliance-footer" aria-label="How to use what Avery tells you">
      <p>{t.lite2.footerText}</p>
    </footer>
  )
}
