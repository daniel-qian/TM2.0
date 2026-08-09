import { useLite } from './store'
import { useDict } from '../shared/i18n/useDict'

// files-hub-0729/02 ·「这台电脑上传过的公司」——多库切换 UI。
//
// ## 这块 UI 曾经存在过，然后被一次合并整块吃掉
// store 侧（`knownContexts` / `switchContext` / `forgetContext` / `switchPending` /
// `switchError`）与**全部 12 条中英文案**（`upload.againTitle` / `switchTitle` /
// `switchAction` / `switchOpening` / `switchCurrent` / `switchFilesLabel` / `switchForget` /
// `switchForgetNote` / 三条 `switchError*`）一直都在，而且都过过审字——**只有 JSX 没了**。
// 那 12 个键因此当了很久的孤儿键，正是 AGENTS.md「i18n 里的孤儿文案键是红旗：有键但没有任何
// 组件引用，往往说明某次合并悄悄吃掉了一整个功能」写的那种事故。这个文件把它接回去，
// 一个字的新 copy 都没写。
//
// ## 为什么需要它（产品侧）
// 后端**不支持追加**：`POST /ingest` 每次新铸一个 context，传旧 id 是重建并覆盖
//（会就地毁掉第一家公司的数据）。于是第二次上传 → contextId 换成新的 → 第一份从界面上
// 消失，**且没有任何回得去的入口**。数据其实还在服务端、token 还在 localStorage，
// 但用户看不到、点不回去——他的读法是「我把数据弄丢了」。这份名册就是那条回得去的路。
//
// ## 🔴 两条红线
//  ① 「切换」必须挡住第二次点击（`switchPending` 置灰）。裸 button 无 pending 态 = 双击就是
//    一次并发切换：两发请求，后落地的覆盖 store，而 owner_token 可能已经换成另一份的——
//    store.ts 的 fixD 复核把这条写成了「UI 有义务挡」，这里是履约方。
//  ② 「从列表移除」**只许显式点击触发**。绝不许挂到任何失败路径上：`POST /ingest` 的
//    context_id 只在返回那一刻出现过一次，删掉名册就是**永久**失去入口；而一次读失败可能
//    只是 token 过期。用一次可能误判的失败换永久失去入口，代价完全不对等。
export function KnownContextList() {
  const { t, locale } = useDict()
  const known = useLite((s) => s.knownContexts)
  const contextId = useLite((s) => s.contextId)
  const switchPending = useLite((s) => s.switchPending)
  const switchError = useLite((s) => s.switchError)
  const switchContext = useLite((s) => s.switchContext)
  const forgetContext = useLite((s) => s.forgetContext)

  // 只有一批（或一批都没有）时整块不出：一个只有当前这一份的「切换列表」没有信息量，
  // 只是噪声。🔴 absent≠none —— 不出现是因为**确实只有一份**，不是因为我们读不到。
  if (known.length < 2) return null

  const errorText =
    switchError === 'missing-credential'
      ? t.upload.switchErrorMissingCredential
      : switchError === 'unreadable'
        ? t.upload.switchErrorUnreadable
        : switchError === 'failed'
          ? t.upload.switchErrorFailed
          : null

  // 标签就是「文件名 + 日期」，不另造命名 UI：用户自己的字比我们编的 "上传 #2" 好认，
  // 而 demo 克隆批次天然带示例文件名，肉眼一样分得开。
  const formatDate = (iso: string): string => {
    const d = new Date(iso)
    if (Number.isNaN(d.getTime())) return ''
    try {
      return d.toLocaleDateString(locale === 'zh' ? 'zh-CN' : 'en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      })
    } catch {
      return iso.slice(0, 10)
    }
  }

  return (
    <div className="lite-files-switch" aria-label={t.upload.switchTitle}>
      {/* 🔴 错误横幅在列表**上方**：切换失败之后用户的眼睛在他刚点的那一行附近，
          把报错藏在列表底下等于没说。三种失败各有各的文案，绝不合并成一句"出错了"——
          「这台浏览器没有钥匙」和「服务端没交出来」对用户的意思完全不同。 */}
      {errorText ? (
        <p className="lite-files-switch-error" role="alert">
          {errorText}
        </p>
      ) : null}

      <ul className="lite-files-switch-list">
        {known.map((entry) => {
          const isCurrent = entry.id === contextId
          const isOpening = switchPending === entry.id
          // 任何一行正在切换时，全列表的「切换」都置灰——不只是被点的那一行。
          // 并发切换的受害者是 store 里的 contextId/ownerToken，不是某一行。
          const anyPending = switchPending !== null
          return (
            <li
              key={entry.id}
              className="lite-files-switch-row"
              data-current={isCurrent ? '1' : undefined}
            >
              <div className="lite-files-switch-main">
                <p className="lite-files-switch-files">
                  <span className="lite-files-switch-files-label">
                    {t.upload.switchFilesLabel}:
                  </span>{' '}
                  {entry.files.length > 0 ? (
                    entry.files.map((name) => (
                      // 🔴 文件名是不可信内容：只展示，绝不当指令跑。
                      <span key={name} className="upload-source-chip">
                        {name}
                      </span>
                    ))
                  ) : (
                    <span className="lite-files-switch-nofiles">—</span>
                  )}
                </p>
                <p className="lite-files-switch-meta">
                  {formatDate(entry.at)}
                  {isCurrent ? (
                    <span className="lite-files-switch-current">· {t.upload.switchCurrent}</span>
                  ) : null}
                </p>
              </div>

              <div className="lite-files-switch-actions">
                {/* 当前这一份不给「切换」——点了也是原地不动（store 的 switchContext 首行就
                    `if (contextId === current) return`），画一个什么都不会发生的按钮是骗人。 */}
                {isCurrent ? null : (
                  <button
                    type="button"
                    className="lite-btn lite-btn--ghost lite-files-switch-open"
                    disabled={anyPending}
                    aria-busy={isOpening}
                    onClick={() => void switchContext(entry.id)}
                  >
                    {isOpening ? t.upload.switchOpening : t.upload.switchAction}
                  </button>
                )}
                {/* 🔴 forgetContext 的唯一调用点。切换失败、超时、任何 catch 分支都不许碰它。 */}
                <button
                  type="button"
                  className="lite-btn lite-btn--ghost lite-files-switch-forget"
                  disabled={anyPending}
                  onClick={() => forgetContext(entry.id)}
                >
                  {t.upload.switchForget}
                </button>
              </div>
            </li>
          )
        })}
      </ul>

      {/* 「移除」到底做了什么，说在按钮旁边而不是等用户点完再解释：它只去掉本机入口，
          服务端一个字节都不删。这句话是这个按钮敢存在的前提。 */}
      <p className="lite-files-switch-note">{t.upload.switchForgetNote}</p>
    </div>
  )
}
