import { useDict } from '../../shared/i18n/useDict'
import { useLite } from '../store'
import { FileManifest } from '../FileManifest'
import { KnownContextList } from '../KnownContextList'
import { UploadPanel } from '../UploadPanel'

// files-hub-0729/01（ADR-0032）· 资料库屏。
//
// ## 这一屏解决什么
// 改造前「文件」这件事散在三屏四点：团队屏满态右栏一个上传面板、团队屏空态又一个、首页
// 骨架卡一个、引导闸里还有一套自己的实现。而"我传过什么、现在用的是哪一批、能不能拿回来"
// 这三个问题**一个都没有落点**——清单只在上传面板底下顺带渲染，下载端点后端有、前端从未接，
// 多库切换 store 里全套现成、UI 从来没长出来。资料库屏是这些问题的那个落点。
//
// ## 三段
//   ① 当前资料 —— 这一批文件的清单 + 逐份下载（FileManifest withDownload）。
//   ② 上传新一批 —— UploadPanel 整件 + 「另建一份画像」的诚实说明。
//   ③ 你上传过的几批 —— 多库切换（files-hub-0729/02）。
//
// ## 🔴 v1 刻意不做的
// 删除 / 重传 / 替换：后端写端点整批缺席（见 issue T3）。按"不建假按钮"红线，**UI 上一个
// 都不出现**——一个点了必然失败的删除键比没有删除键伤得多。愿景里那个「agent 自己的文件
// 空间」也不在这儿：那是 Vision 页的诚实预告，v1 只管用户上传的文件，两者不许混。
// files-hub-0729/02 · 第三段的外壳。抽成小组件只为一件事：小节标题与内容**同生共死**。
// 名册不足两批时 KnownContextList 返回 null，标题必须跟着消失——一个「你上传过的几批」
// 底下空无一物的小节，读起来像加载失败。
function SwitchSection() {
  const { t } = useDict()
  const known = useLite((s) => s.knownContexts)
  if (known.length < 2) return null
  return (
    <section className="lite-files-section lite-files-switch-section" aria-label={t.upload.switchTitle}>
      <h3 className="lite-files-section-title">{t.upload.switchTitle}</h3>
      <KnownContextList />
    </section>
  )
}

export function FilesScreen() {
  const { t } = useDict()
  const l = t.lite2
  const files = useLite((s) => s.files)
  const contextId = useLite((s) => s.contextId)

  // 🔴「还没传过」和「传了但读不出来」是两件事，文案必须分得开。这里只判前者：
  // 有 contextId 但清单为空 = 后端确实没给出文件，那是 ② 段上传口要回答的问题，
  // 不是这一段该替它编一句"可能还在处理"。
  const hasFiles = files.length > 0

  return (
    <section className="scene scene-nexus is-active lite-files" aria-label={l.tabFiles}>
      <div className="lite-files-scroll">
        <header className="lite-files-head">
          <p className="eyebrow lite-files-eyebrow">{l.filesEyebrow}</p>
          <h2>{l.filesHeading}</h2>
          <p className="lite-files-sub">{l.filesSub}</p>
        </header>

        {/* ── ① 当前资料 ─────────────────────────────────────────────────────────
            清单本体是共享件（与上传口底下那份同一个组件），这里多开下载列。
            🔴 下载走 fetch+blob+objectURL：端点吃 owner_token header，裸 <a href> 带不上
            （见 FileManifest.downloadOne 与 transport.downloadFile 的注释）。 */}
        <section className="lite-files-section lite-files-current" aria-label={l.filesCurrentTitle}>
          <h3 className="lite-files-section-title">{l.filesCurrentTitle}</h3>
          {hasFiles ? (
            <FileManifest withDownload />
          ) : (
            <p className="lite-files-empty">
              {contextId ? l.filesCurrentEmptyRead : l.filesCurrentEmptyNone}
            </p>
          )}
        </section>

        {/* ── ② 上传新一批 ───────────────────────────────────────────────────────
            🔴 诚实说明必须在上传口**之前**：后端每次 POST /ingest 都新铸一个 context，
            传旧 id 是重建并覆盖而不是追加（见 store.ts 顶部那段）。改造前界面一路邀请
            "再加点文件"，然后把屏幕悄悄换成新的那一份，且没有任何回得去的入口——经理的
            读法是"我把数据弄丢了"。againTitle/againBody 这两条 copy 早就写好并审过字，
            却因为一次合并把 UI 整块吃掉而当了很久的孤儿键（AGENTS.md「孤儿文案键是红旗」
            那条说的就是它）。这里把它们接回去。
            `showFiles={false}`：上面 ① 段已经有一份清单了，两处都渲染 = 两个
            `.upload-files`，门按类名全局取样会数出双倍行数。 */}
        <section className="lite-files-section lite-files-upload" aria-label={l.filesUploadTitle}>
          <h3 className="lite-files-section-title">{l.filesUploadTitle}</h3>
          <div className="lite-files-again" role="note">
            <p className="lite-files-again-title">{t.upload.againTitle}</p>
            <p className="lite-files-again-body">{t.upload.againBody}</p>
          </div>
          <UploadPanel showFiles={false} />
        </section>

        {/* ── ③ 你上传过的几批 ───────────────────────────────────────────────────
            files-hub-0729/02 · 多库切换。KnownContextList 在只有 0/1 批时自己返回 null
            ——所以这里连标题一起藏，否则会留下一个「你上传过的几批」下面什么都没有的空
            小节（比不显示更让人以为出了问题）。 */}
        <SwitchSection />
      </div>
    </section>
  )
}
