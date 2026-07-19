// feat-035（lite-live-v02 kickoff §架构拍板 2）· `?v=1|2` shell 版本开关。
//
// 🔴 2026-07-19 Danny 拍板 ①：**裸域名默认已从 v01 翻成 v02**（缺省 '2'）。
// 理由：feat-050..060 十一条（路由 / 刷新不丢 / 跟进 / 多看一眼 / 项目看板 / 聚合首屏）
// 早就在 main 里了，而裸链还开在冻结的 v01 上——客户一条都看不见。
//
// v02（默认，缺省 '2'）= src/lite2/**，现在是客户真正打开的那一版。
// v01（`?v=1`）= 冻结产品壳（src/lite/**），**出事时唯一的逃生门，不许删也不许拆**。
// 翻默认只动下面 resolveVersion() 的那个字面量；normalize() 一个字不动，`?v=1` 永远解析
// 得回 v01。
//
// ⚠️ **刻意不加构建期 env**（与 mode.ts 的三级解析不同，这里只有两级：URL > 默认）。
// mode.ts 已经有一套「本地默认 story / 生产 env 翻成 live」的分裂，再加第二套的后果是：
// 裸 URL 的行为在门里和生产上不一样——门跑本地（无 env）看到一种壳，客户在生产（有 env）
// 看到另一种，而两边的门全绿。一个「只在生产上错」的默认值是查不出来的。所以这里的默认
// 值是一个写死的字面量：门看到什么，客户就看到什么。

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
  // 🔴 裸链默认 = v02（Danny 2026-07-19 拍板 ①）。翻这个字面量前先读文件头。
  return '2'
}
