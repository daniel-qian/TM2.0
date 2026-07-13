import { PEOPLE } from '../../data/fixtures'
import { PixelAvatar } from '../PixelAvatar'

// ── feat-034 阶段 A（ADR-0023 / PRD Q13）：scripted Ask（Quick ask）Manifest 卡 ──────
// Ask 的 story 面叙事：agent 起草 1~5 + 是/否 两问（问"事"不问"人"）→ 你分享一人一链
// 给 Fred（模拟"已分享链接"态）→ 回执归来同卡状态推进（answered 翻转）。
//
// 🔴 红线（ADR-0023，mock 人同样适用）：
//   1. 问句问"事"——问的是这次 hand-off 与他需要什么，不是他的能力/几分；
//   2. 回执数字 = 员工自述的情境证据——只出现在本卡、紧贴 "Self-reported" 标注，
//      永不写进人卡 / PersonEntity / 任何跨人比分表；
//   3. 透明三要素（谁在问 / 问什么事 / 答案给谁看）在员工侧成立，本卡如实转述。
//
// 卡内全部为 demo fixture 文案（scripted story 资产，同 AlternativesCard 口径）。

const QUICK_ASK_RECIPIENT_ID = 'u_fred'

// 两个生成问句（问"事"）：主语是 hand-off / 所需材料，不是 Fred 这个人。
const QUICK_ASK_QUESTIONS = {
  scale: 'How doable does the Thursday hand-off look from where you sit?',
  yesNo: 'Would you have everything you need to start tomorrow?',
} as const

// 回执（Fred 的自述，scripted）。scaleAnswer 是他对"这次 hand-off"的把握（1~5 自述），
// 🔴 只以"本人自述"形态显示在下方 receipt 块——不是任何人给 Fred 打的分。
const QUICK_ASK_RECEIPT = {
  scaleAnswer: 4,
  scaleOutOf: 5,
  yesNoAnswer: 'Not yet',
  // 这句原话短评是闭环价值所在：quick-ask-reply 的 stream 结论直接引用它
  // （"a quick walkthrough of the guide flow with Lin Qing"），写进 hand-off 计划。
  comment:
    "Happy to take the screens — I'd just want a quick walkthrough of the guide flow with Lin Qing before I start.",
} as const

export function QuickAskCard({ question, answered }: { question: string; answered: boolean }) {
  const recipient = PEOPLE.find((person) => person.id === QUICK_ASK_RECIPIENT_ID)

  return (
    <section className="quick-ask-card" aria-label="Follow-up: a quick ask for Fred">
      <header className="quick-ask-header">
        <div>
          <p className="eyebrow">Follow-up · Quick ask</p>
          <h2>Hear it from Fred first</h2>
        </div>
        <span className={answered ? 'quick-ask-status is-answered' : 'quick-ask-status'}>
          {answered ? 'Answered — in his own words' : 'Link shared — waiting on Fred'}
        </span>
      </header>

      {question ? <p className="quick-ask-question">&ldquo;{question}&rdquo;</p> : null}

      <div className="quick-ask-recipient" aria-label="Who this goes to">
        {recipient ? <PixelAvatar person={recipient} size={26} className="inline-avatar" /> : null}
        <div>
          <strong>{recipient?.name ?? 'Fred'}</strong>
          <span>{recipient ? `${recipient.role} · ${recipient.team}` : 'Prototyper · Design'}</span>
        </div>
        <span className="quick-ask-link-chip">One link, just for him — no login, ten seconds</span>
      </div>

      <div className="quick-ask-questions">
        <article className="quick-ask-q">
          <span className="quick-ask-q-type">1 – 5</span>
          <p>{QUICK_ASK_QUESTIONS.scale}</p>
          {answered ? (
            <div className="quick-ask-answer" aria-label="Fred's answer, self-reported">
              <span className="quick-ask-scale" aria-hidden="true">
                {Array.from({ length: QUICK_ASK_RECEIPT.scaleOutOf }, (_, i) => (
                  <i key={i} className={i < QUICK_ASK_RECEIPT.scaleAnswer ? 'is-filled' : undefined} />
                ))}
              </span>
              <strong>
                {QUICK_ASK_RECEIPT.scaleAnswer} of {QUICK_ASK_RECEIPT.scaleOutOf}
              </strong>
              {/* 🔴 ADR-0023：数字必须紧贴"本人自述"标注出现——它是 Fred 说的这件事，不是分数。 */}
              <span className="quick-ask-selfreport">Self-reported — his read on the hand-off, not a score</span>
            </div>
          ) : (
            <span className="quick-ask-pending">Two taps on his phone — 1 is &ldquo;a stretch&rdquo;, 5 is &ldquo;very doable&rdquo;</span>
          )}
        </article>

        <article className="quick-ask-q">
          <span className="quick-ask-q-type">Yes / No</span>
          <p>{QUICK_ASK_QUESTIONS.yesNo}</p>
          {answered ? (
            <div className="quick-ask-answer" aria-label="Fred's answer, self-reported">
              <strong>&ldquo;{QUICK_ASK_RECEIPT.yesNoAnswer}&rdquo;</strong>
              <span className="quick-ask-selfreport">Self-reported</span>
            </div>
          ) : (
            <span className="quick-ask-pending">One more tap, and an optional line if he wants to add one</span>
          )}
        </article>
      </div>

      {answered ? (
        <blockquote className="quick-ask-comment">
          <p>&ldquo;{QUICK_ASK_RECEIPT.comment}&rdquo;</p>
          <footer>
            {recipient ? <PixelAvatar person={recipient} size={20} className="inline-avatar" /> : null}
            {recipient?.name ?? 'Fred'} · in his own words
          </footer>
        </blockquote>
      ) : null}

      {answered ? (
        <p className="quick-ask-verdict">
          His one ask — a quick walkthrough with Lin Qing — goes into the hand-off plan before anything
          moves. His words stay here, on this question.
        </p>
      ) : (
        <p className="quick-ask-transparency">
          Fred sees exactly who&rsquo;s asking, what it&rsquo;s about, and that his answer comes straight
          back to this thread — nothing else, nowhere else.
        </p>
      )}
    </section>
  )
}
