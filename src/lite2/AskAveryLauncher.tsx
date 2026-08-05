import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useLite } from './store'
import { useDict } from '../shared/i18n/useDict'
import { useCurrentScreen } from './routes'

// 棒F · 悬浮「问 Avery」入口（布局与真部件战役 2026-07-22 · Danny 拍板命名）。
//
// 裁决（battle-map §2.3）：不移/不复制 LiteComposer。用 goScreen 中继链——输入问题 →
// goScreen('room', { q }) → 现成中继把它预填进议事室 composer（routes.ts:115 EPHEMERAL_PARAMS
// → Lite2App useRoomQueryRelay → flowStore.composerDraft → RoomScreen initialValue）。
// 🔴 只预填不自动发（Lite2App.tsx:195「不自动发问、不伪造回答」）。transport 零改动。
//
// 🔴 硬约束（逐条来自 battle-map §棒F / plan §5）：
//   · 挂载：Lite2App 里 .scene-stage 的兄弟、.lite2-shell 的直接子元素——绝不进屏组件内部
//     （.scene.is-active 的非 none transform 会给 fixed 后代建包含块 + .scene overflow:hidden
//     会裁掉它）。定位一律 position:fixed（窄屏 .app-shell overflow:visible 下 absolute 会
//     顺文档流掉到很下面；fixed 此处无 transform 祖先，安全）。z-index 45：页脚 30 / aurora
//     背幕 40 之上，顶栏 50 / 设置 60 / 铃铛登录 90 / modal 120 之下（被弹层压得住）。
//   · 命名：收起态显「问 Avery」（EN "Ask Avery"）。绝不叫「快问」（feat-034 Ask 专名）、
//     绝不叫 Nexus（锁词硬闸）。品牌 Avery 不译。
//   · 输入框 aria-label 必给（走 t.*）——placeholder 两道中文门都够不着。
//   · 无材料 gate：contextId===null 时整块不出（复用 Room 的判据；用 contextId 不用 team——
//     contextId 在模块求值期就从 localStorage 恢复，回访者第一帧非空）。0721 事故：零数据提问
//     要么烧默认英文 demo 语料的真 LLM、要么断流被当「系统故障」。
//   · 议事室屏本身已常驻 composer，此入口在 room 屏收起（既避免与画布可点区/composer 抢位，
//     也免得「已经在议事室里」还悬一个「去议事室」的钮）——verify-room-usability 因此在 room
//     屏见不到本组件。

// 装饰性火花图标（aria-hidden；显式尺寸避开 sweep D6c 零尺寸 svg 判据）。
function SparkIcon() {
  return (
    <svg
      className="lite-ask-avery-icon"
      width="16"
      height="16"
      viewBox="0 0 16 16"
      aria-hidden="true"
      focusable="false"
    >
      <path
        d="M8 1.2l1.5 3.9 3.9 1.5-3.9 1.5L8 12l-1.5-3.9L2.6 6.6l3.9-1.5L8 1.2zM12.8 10.2l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7.7-1.8z"
        fill="currentColor"
      />
    </svg>
  )
}

export function AskAveryLauncher() {
  const { t } = useDict()
  const l = t.lite2
  const contextId = useLite((s) => s.contextId)
  const goScreen = useLite((s) => s.goScreen)
  const screen = useCurrentScreen()

  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState('')
  const rootRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  // 展开后聚焦输入框；外点/Esc 收起（Esc 在 input 的 onKeyDown 里，外点在 document 上）。
  useEffect(() => {
    if (!open) return
    inputRef.current?.focus()
    function onDown(event: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  // 无材料：整块不出（复用 Room gate 的 contextId 判据）。
  if (contextId === null) return null
  // 🔴 已有常驻提问框的屏，悬浮入口收起——否则两个底部居中输入框叠在一起。
  //   · room：AskCard/常驻 composer（文件头原判）。
  //   · team 曾同列（LiteComposer 撞位）——#47（2026-08-05，Danny 拍板统一形态）把
  //     LiteComposer 退役后，team 屏的提问入口就是本胶囊，不再收起。
  if (screen === 'room') return null

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const q = draft.trim()
    if (!q) return
    // 中继：goScreen('room',{q}) → useRoomQueryRelay 把 q 灌进 composerDraft（只预填不自动发）。
    goScreen('room', { q })
    setDraft('')
    setOpen(false)
  }

  return (
    <div className="lite-ask-avery" ref={rootRef}>
      {open ? (
        <form className="lite-ask-avery-form" onSubmit={submit}>
          <input
            ref={inputRef}
            type="text"
            className="lite-ask-avery-input"
            value={draft}
            placeholder={l.askAveryPlaceholder}
            aria-label={l.askAveryAria}
            autoComplete="off"
            onChange={(event) => setDraft(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                event.preventDefault()
                setOpen(false)
              }
            }}
          />
          <button
            type="submit"
            className="lite-btn lite-btn--primary lite-ask-avery-send"
            aria-label={l.askAveryAria}
            disabled={draft.trim() === ''}
          >
            →
          </button>
        </form>
      ) : (
        <button
          type="button"
          className="lite-btn lite-ask-avery-pill"
          onClick={() => setOpen(true)}
        >
          <SparkIcon />
          <span>{l.askAveryLabel}</span>
        </button>
      )}
    </div>
  )
}
