// feat-017 (ADR-0020 决策 3)：`?mode=story|live` 开关 —— Avery Live 的两种数据来源模式。
//
// story = 脚本（cases.ts / fixtures.home.ts）驱动的可控叙事（路演/视频，feat-013），
//         原 rail 回放机器原样保留（守 ADR-0003/0006/0012/0013/0014）。
// live  = 真 agent 服务（feat-015）+ 真 ingestion（feat-016）驱动，接受用户真实输入/上传。
//
// 两模共用全部视觉组件，只差数据源（seam：StreamSource / TeamDataSource）。
//
// 默认值取舍：本毕业 slice 默认 **story**——零回归优先（rail 回放/视频/路演即刻可用），
// live 是增量并行源，经 `?mode=live` 或构建期 `VITE_AVERY_MODE=live` 显式开启。部署端
// （feat-018）会把构建默认翻成 live；这里保留 story 为安全默认，删掉 live 源即回到今日 demo。

export type AveryMode = 'story' | 'live'

const VALID: readonly AveryMode[] = ['story', 'live']

function normalize(raw: string | null | undefined): AveryMode | null {
  if (!raw) return null
  const v = raw.trim().toLowerCase()
  return (VALID as readonly string[]).includes(v) ? (v as AveryMode) : null
}

// 解析优先级：URL `?mode=` > 构建期 env `VITE_AVERY_MODE` > 默认 story。
// URL 覆盖让 Danny 现场一键在 story（演）/ live（试玩）之间切，无需重构建。
export function resolveMode(search?: string): AveryMode {
  // 1) URL query（现场覆盖）
  const qs =
    search ??
    (typeof window !== 'undefined' && window.location ? window.location.search : '')
  try {
    const fromUrl = normalize(new URLSearchParams(qs).get('mode'))
    if (fromUrl) return fromUrl
  } catch {
    // malformed search string — fall through to env/default
  }

  // 2) build-time env（部署端翻默认）
  const fromEnv = normalize(
    typeof import.meta !== 'undefined' ? import.meta.env?.VITE_AVERY_MODE : undefined,
  )
  if (fromEnv) return fromEnv

  // 3) safe default
  return 'story'
}

export function isLive(mode: AveryMode): boolean {
  return mode === 'live'
}
