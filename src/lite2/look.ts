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

// feat-068：旧的 `?skin=` 不再被识别，但**必须响亮地失败**。静默回落是这里最坏的失败方式：
// `?skin=paper` 恰好等于缺省，看不出区别；而 `?skin=aurora` 会安静地渲染成 paper —— 拿旧链接
// 做双皮验收的人会得到一个「通过」的极光结论，实际测的是纸感。v02 对齐波那条线的所有验收基线
// 和给子 agent 的指令里用的都是旧形式（`?v=2&mode=live&skin=paper&lang=zh`），所以这条提示是
// 写给他们的。别把它升级成兼容别名 —— 两种写法并存正是这次更名要终结的东西。
let warnedLegacy = false
function warnLegacySkinParam(params: URLSearchParams): void {
  if (warnedLegacy || typeof console === 'undefined') return
  const legacy = params.get('skin')
  if (!legacy) return
  warnedLegacy = true
  console.warn(
    `[avery] \`?skin=${legacy}\` is no longer recognised — the parameter was renamed to \`?look=\` ` +
      `(feat-068; \`Skin\` now means only ADR-0021's industry theme). ` +
      `This page is rendering the default \`paper\` look. Use \`?look=${legacy}\` instead.`,
  )
}

export function resolveLook(search?: string): LiteLook {
  const qs =
    search ??
    (typeof window !== 'undefined' && window.location ? window.location.search : '')
  try {
    const params = new URLSearchParams(qs)
    const fromUrl = normalize(params.get('look'))
    if (fromUrl) return fromUrl
    warnLegacySkinParam(params)
  } catch {
    // malformed search string — fall through to default
  }
  return 'paper'
}
