// feat-035（lite-live-v02 kickoff §架构拍板 2）· `?v=1|2` shell 版本开关。
//
// v01（默认，缺省 '1'）= 冻结产品壳（src/lite/**），供融资团队试玩，URL 不变时一个字节
// 不变。v02（`?v=2`）= 并排新壳（src/lite2/**），同一套功能与 layout 两张皮。解析形状与
// mode.ts / i18n/index.ts 同口径：URL `?v=` 唯一来源，无构建期 env（v02 尚不是部署目标，
// 部署在阶段 D）。

export type ShellVersion = '1' | '2'

const VALID: readonly ShellVersion[] = ['1', '2']

function normalize(raw: string | null | undefined): ShellVersion | null {
  if (!raw) return null
  const v = raw.trim()
  return (VALID as readonly string[]).includes(v) ? (v as ShellVersion) : null
}

export function resolveVersion(search?: string): ShellVersion {
  const qs =
    search ??
    (typeof window !== 'undefined' && window.location ? window.location.search : '')
  try {
    const fromUrl = normalize(new URLSearchParams(qs).get('v'))
    if (fromUrl) return fromUrl
  } catch {
    // malformed search string — fall through to default
  }
  return '1'
}
