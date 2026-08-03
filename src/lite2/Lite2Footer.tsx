import { useEffect, useRef } from 'react'
import { useDict } from '../shared/i18n/useDict'

// feat-035（PRD F6）· 合规免责页脚——lite2 壳全局常驻（不随 tab 切换消失）。
// 口吻走我们的备忘录腔（非监管腔）：Avery 只辅助判断、不替代负责人决策；产出需复核；
// 不得作为重大人事决策唯一依据。EN 本波定稿；ZH 走 scripts/i18n-zh.mjs 定向模式。
//
// #34（2026-08-03）· 把自己的实测高度发布成 `--lite2-footer-h`。
// 🔴 为什么要测、不能写死：这个页脚**高度是变量**——文案在窄屏会换行成 3–4 行
// （375 实测 59px+），en/zh 断行位置也不同。悬浮「问 Avery」胶囊原来写死 `bottom: 24px`，
// 那个常数隐含的假设正是"页脚是薄薄一条、够不到我"——假设一破，胶囊就压穿页脚，
// 把常驻的合规免责声明拦腰截断（PRD F6 要求它常驻可读）。
// 再猜一个常数就是把同一个 bug 换个数字重犯，所以这里量真值。
export function Lite2Footer() {
  const { t } = useDict()
  const ref = useRef<HTMLElement | null>(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const publish = () => {
      // 发布到 :root 而不是 shell 根：胶囊是 position:fixed，视觉上属于视口层，
      // 让它和页脚共享同一个变量宿主，避免"变量挂在哪个祖先上"这种隐式耦合。
      document.documentElement.style.setProperty(
        '--lite2-footer-h',
        `${Math.round(el.getBoundingClientRect().height)}px`,
      )
    }
    publish()
    const ro = new ResizeObserver(publish)
    ro.observe(el)
    return () => {
      ro.disconnect()
      document.documentElement.style.removeProperty('--lite2-footer-h')
    }
  }, [t])

  return (
    <footer ref={ref} className="lite2-compliance-footer" aria-label={t.lite2.complianceFooterAria}>
      <p>{t.lite2.footerText}</p>
    </footer>
  )
}
