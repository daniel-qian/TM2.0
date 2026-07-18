// feat-035（lite-live-v02 kickoff §架构拍板 4）· `?skin=paper|aurora` 皮肤令牌开关。
//
// 缺省 paper（现有暖纸编辑风，令牌照搬现值——零视觉回归）；`?skin=aurora` 挂合伙人库的极光
// 玻璃风令牌（styles/skin-aurora.css）。壳根挂 `data-skin` 属性，两张令牌表各自用
// `.lite2-shell[data-skin="..."]` 选择器覆盖同一批 CSS 自定义属性——组件样式只消费令牌，
// 令牌覆盖不了的语法差异（如徽章 vs 左边条）允许极少数 `[data-skin="aurora"]` 组件级分支
// （feat-039 精修阶段处理，本波不引入）。
//
// 解析形状与 mode.ts / shared/version.ts 同口径：URL `?skin=` 唯一来源，无构建期 env（皮肤
// 是试玩期现场切换的展示维度，不是部署目标）。

export type LiteSkin = 'paper' | 'aurora'

const VALID: readonly LiteSkin[] = ['paper', 'aurora']

function normalize(raw: string | null | undefined): LiteSkin | null {
  if (!raw) return null
  const v = raw.trim().toLowerCase()
  return (VALID as readonly string[]).includes(v) ? (v as LiteSkin) : null
}

export function resolveSkin(search?: string): LiteSkin {
  const qs =
    search ??
    (typeof window !== 'undefined' && window.location ? window.location.search : '')
  try {
    const fromUrl = normalize(new URLSearchParams(qs).get('skin'))
    if (fromUrl) return fromUrl
  } catch {
    // malformed search string — fall through to default
  }
  return 'paper'
}
