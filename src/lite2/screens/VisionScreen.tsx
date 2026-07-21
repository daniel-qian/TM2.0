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
      label: t.lite2.visionNowLabel,
      title: t.lite2.visionNowTitle,
      body: t.lite2.visionNowBody,
    },
    {
      key: 'real',
      label: t.lite2.visionRealLabel,
      title: t.lite2.visionRealTitle,
      body: t.lite2.visionRealBody,
    },
    {
      key: 'proof',
      label: t.lite2.visionProofLabel,
      title: t.lite2.visionProofTitle,
      body: null,
      points: [t.lite2.visionProofUiux, t.lite2.visionProofJudgment, t.lite2.visionProofRedline],
    },
  ] as const

  // 四张能力 mock。每张都带一个诚实标注 tag（gate 相位 J 断言：零未标注 mock）。
  // gate 断言：mock 里若含示例人（.lite-vision-person）则零数字——只有 gate 卡有人 chip。
  const mocks = [
    {
      key: 'files',
      tag: t.lite2.visionTagPreview,
      title: t.lite2.visionMockFilesTitle,
      body: t.lite2.visionMockFilesBody,
    },
    {
      key: 'skills',
      tag: t.lite2.visionTagPreview,
      title: t.lite2.visionMockSkillsTitle,
      body: t.lite2.visionMockSkillsBody,
    },
    {
      key: 'loop',
      tag: t.lite2.visionTagComing,
      title: t.lite2.visionMockLoopTitle,
      body: t.lite2.visionMockLoopBody,
    },
    {
      key: 'gate',
      tag: t.lite2.visionTagMock,
      title: t.lite2.visionMockGateTitle,
      body: t.lite2.visionMockGateBody,
      // 唯一示例人：只名字 + 角色，零数字（红线在 mock 同样成立）。
      person: { name: t.lite2.visionMockPersonName, role: t.lite2.visionMockPersonRole },
    },
  ] as const

  return (
    <section className="scene scene-nexus is-active lite-vision" aria-label={t.lite2.tabVision}>
      <div className="lite-vision-scroll">
        {/* ── ① 定位叙事（三拍）───────────────────────────────────────────── */}
        <section className="lite-vision-narrative" aria-label={t.lite2.visionTitle}>
          <header className="lite-vision-head">
            <p className="eyebrow lite-vision-eyebrow">{t.lite2.visionEyebrow}</p>
            <h2>{t.lite2.visionTitle}</h2>
            <p className="lite-vision-lede">{t.lite2.visionLede}</p>
          </header>

          {/* 0721 对齐棒 · 合伙人反馈 A7：页偏长，顶部给 3 点速读（投资人/客户 30 秒抓住
              全页）。只做 lite2（v01 结构冻结）；.lite-vision-beats 的序号与断言选择器不动。 */}
          <aside className="lite-vision-summary" data-vision-summary="">
            <p className="eyebrow lite-vision-summary-label">{t.lite2.visionSummaryLabel}</p>
            <ol className="lite-vision-summary-list">
              <li>{t.lite2.visionSummary1}</li>
              <li>{t.lite2.visionSummary2}</li>
              <li>{t.lite2.visionSummary3}</li>
            </ol>
          </aside>

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
        <section className="lite-vision-mocks" aria-label={t.lite2.visionMockTitle}>
          <header className="lite-vision-mocks-head">
            <p className="eyebrow lite-vision-mocks-eyebrow">{t.lite2.visionMockEyebrow}</p>
            <h2>{t.lite2.visionMockTitle}</h2>
            <p className="lite-vision-lede">{t.lite2.visionMockLede}</p>
          </header>

          <div className="lite-vision-mock-grid">
            {mocks.map((mock) => (
              <article key={mock.key} className={`lite-vision-mock lite-vision-mock-${mock.key}`}>
                <header className="lite-vision-mock-top">
                  <h3>{mock.title}</h3>
                  {/* 诚实标注：绝不冒充已实现（gate 相位 J 断言每张 mock 必带此 tag）。 */}
                  <span className="lite-badge lite-vision-tag">{mock.tag}</span>
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

          <p className="lite-vision-comingsoon">{t.lite2.visionComingSoon}</p>
        </section>
      </div>
    </section>
  )
}
