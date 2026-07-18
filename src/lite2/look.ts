// feat-035（lite-live-v02 kickoff §架构拍板 4）· `?look=paper|aurora` 观感（Look）令牌开关。
//
// feat-068 更名（Danny 2026-07-18 拍板）：本层原名 skin，与 ADR-0021 的 `Skin` 撞词——`Skin`
// 此后**专指**垂直包里的行业视觉主题（配色/措辞/示例贴合该行业，酒店 vs 建筑；见 CONTEXT.md
// 术语表），是垂直包三件套之一、商业承重。本层是同一个产品的两张审美面孔（暖纸编辑风 vs 极光
// 玻璃风），由我们替客户选定、客户不自选，只存在于 Lite2（v02）——故改叫 `Look`。别再把这个
// 概念叫 skin，也别把 ADR-0021 的 Skin 挪到这一层来。清爽断代：旧的 skin 查询参数与旧的 skin
// DOM 属性一律不再被识别（回落 paper 缺省），不留兼容别名——URL 还没给出去过，留别名只会延续
// 这次更名要终结的混淆。
//
// 缺省 paper（现有暖纸编辑风，令牌照搬现值——零视觉回归）；`?look=aurora` 挂合伙人库的极光
// 玻璃风令牌（styles/look-aurora.css）。壳根挂 `data-look` 属性，两张令牌表各自用
// `.lite2-shell[data-look="..."]` 选择器覆盖同一批 CSS 自定义属性——组件样式只消费令牌，
// 令牌覆盖不了的语法差异（如徽章 vs 左边条）允许极少数 `[data-look="aurora"]` 组件级分支
// （feat-039 精修阶段处理，本波不引入）。
//
// 解析形状与 mode.ts / shared/version.ts 同口径：URL `?look=` 唯一来源，无构建期 env（观感
// 是试玩期现场切换的展示维度，不是部署目标）。

export type LiteLook = 'paper' | 'aurora'

const VALID: readonly LiteLook[] = ['paper', 'aurora']

function normalize(raw: string | null | undefined): LiteLook | null {
  if (!raw) return null
  const v = raw.trim().toLowerCase()
  return (VALID as readonly string[]).includes(v) ? (v as LiteLook) : null
}

export function resolveLook(search?: string): LiteLook {
  const qs =
    search ??
    (typeof window !== 'undefined' && window.location ? window.location.search : '')
  try {
    const fromUrl = normalize(new URLSearchParams(qs).get('look'))
    if (fromUrl) return fromUrl
  } catch {
    // malformed search string — fall through to default
  }
  return 'paper'
}
