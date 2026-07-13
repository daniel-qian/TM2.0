import { useDict } from '../../shared/i18n/useDict'

// feat-026 · lite 屏 5：Where this goes（定位叙事 + 能力边界 mock）——Danny 2026-07-09 反馈 6/7。
// 形态：独立 tab（不打断试玩流），一屏两段：
//   ① 定位叙事（三拍）：你刚用的 = 拿自己文件试玩的 demo → 真正的 Avery = 为一家公司量身定制的
//      custom agent（接你的数据、私有安全部署、窄域 domain-specific）→ 这个 demo 想让你判断的三件事
//      （UIUX + 判断质量 + 红线）。
//   ② 能力边界 mock（接入数据之后）：agent 自己的 file system / 定制 skills·tools·SOP /
//      后台批量 loop / 红线是确定性闸——四张卡，每张诚实带 preview/coming 标注（绝不冒充已实现）。
// 弹药源（.issues/live-polish-0709/plan.md §2 四篇）：Steinberger 注意力约束+后台 loop；
// Schroeder 领域专精 agent + sandbox file system 原语；Pocock skill = 可复现行为的单元；
// Martin-Dye 分层——prompt 是请求、permission 是确定性检查（红线 = 出厂前 veto）。
//
// 🔴 红线在 mock 里同样成立：本屏唯一的示例人只有名字 + 角色，零数字/评分/排名。
// 墙不打洞（不 import src/story/**）；纯静态 surface，不依赖 ingest/advise。
export function VisionScreen() {
  const { t } = useDict()

  const beats = [
    {
      key: 'now',
      label: t.lite.visionNowLabel,
      title: t.lite.visionNowTitle,
      body: t.lite.visionNowBody,
    },
    {
      key: 'real',
      label: t.lite.visionRealLabel,
      title: t.lite.visionRealTitle,
      body: t.lite.visionRealBody,
    },
    {
      key: 'proof',
      label: t.lite.visionProofLabel,
      title: t.lite.visionProofTitle,
      body: null,
      points: [t.lite.visionProofUiux, t.lite.visionProofJudgment, t.lite.visionProofRedline],
    },
  ] as const

  // 四张能力 mock。每张都带一个诚实标注 tag（gate 相位 J 断言：零未标注 mock）。
  // gate 断言：mock 里若含示例人（.lite-vision-person）则零数字——只有 gate 卡有人 chip。
  const mocks = [
    {
      key: 'files',
      tag: t.lite.visionTagPreview,
      title: t.lite.visionMockFilesTitle,
      body: t.lite.visionMockFilesBody,
    },
    {
      key: 'skills',
      tag: t.lite.visionTagPreview,
      title: t.lite.visionMockSkillsTitle,
      body: t.lite.visionMockSkillsBody,
    },
    {
      key: 'loop',
      tag: t.lite.visionTagComing,
      title: t.lite.visionMockLoopTitle,
      body: t.lite.visionMockLoopBody,
    },
    {
      key: 'gate',
      tag: t.lite.visionTagMock,
      title: t.lite.visionMockGateTitle,
      body: t.lite.visionMockGateBody,
      // 唯一示例人：只名字 + 角色，零数字（红线在 mock 同样成立）。
      person: { name: t.lite.visionMockPersonName, role: t.lite.visionMockPersonRole },
    },
  ] as const

  return (
    <section className="scene scene-nexus is-active lite-vision" aria-label={t.lite.tabVision}>
      <div className="lite-vision-scroll">
        {/* ── ① 定位叙事（三拍）───────────────────────────────────────────── */}
        <section className="lite-vision-narrative" aria-label={t.lite.visionTitle}>
          <header className="lite-vision-head">
            <p className="eyebrow lite-vision-eyebrow">{t.lite.visionEyebrow}</p>
            <h2>{t.lite.visionTitle}</h2>
            <p className="lite-vision-lede">{t.lite.visionLede}</p>
          </header>

          <ol className="lite-vision-beats">
            {beats.map((beat, i) => (
              <li key={beat.key} className={`lite-vision-beat lite-vision-beat-${beat.key}`}>
                <span className="lite-vision-beat-step" aria-hidden="true">
                  {i + 1}
                </span>
                <div className="lite-vision-beat-body">
                  <p className="eyebrow lite-vision-beat-label">{beat.label}</p>
                  <h3>{beat.title}</h3>
                  {beat.body ? <p>{beat.body}</p> : null}
                  {'points' in beat && beat.points ? (
                    <ul className="lite-vision-proof-list">
                      {beat.points.map((point) => (
                        <li key={point}>{point}</li>
                      ))}
                    </ul>
                  ) : null}
                </div>
              </li>
            ))}
          </ol>
        </section>

        {/* ── ② 能力边界 mock（诚实标注，接入数据之后）────────────────────── */}
        <section className="lite-vision-mocks" aria-label={t.lite.visionMockTitle}>
          <header className="lite-vision-mocks-head">
            <p className="eyebrow lite-vision-mocks-eyebrow">{t.lite.visionMockEyebrow}</p>
            <h2>{t.lite.visionMockTitle}</h2>
            <p className="lite-vision-lede">{t.lite.visionMockLede}</p>
          </header>

          <div className="lite-vision-mock-grid">
            {mocks.map((mock) => (
              <article key={mock.key} className={`lite-vision-mock lite-vision-mock-${mock.key}`}>
                <header className="lite-vision-mock-top">
                  <h3>{mock.title}</h3>
                  {/* 诚实标注：绝不冒充已实现（gate 相位 J 断言每张 mock 必带此 tag）。 */}
                  <span className="lite-vision-tag">{mock.tag}</span>
                </header>
                <p className="lite-vision-mock-body">{mock.body}</p>
                {'person' in mock && mock.person ? (
                  // 🔴 红线：示例人只名字 + 角色，零数字/评分/排名。
                  <div className="lite-vision-person" aria-label={mock.person.name}>
                    <span className="lite-vision-person-name">{mock.person.name}</span>
                    <span className="lite-vision-person-role">{mock.person.role}</span>
                  </div>
                ) : null}
              </article>
            ))}
          </div>

          <p className="lite-vision-comingsoon">{t.lite.visionComingSoon}</p>
        </section>
      </div>
    </section>
  )
}
