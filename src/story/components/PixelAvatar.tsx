import type { CSSProperties } from 'react'
import type { Person } from '../data/fixtures'

// P5 · 共享像素 avatar。把 DashboardScene 里原本内联的 avatarStyle 抽成场景无关组件，
// 供详情页 / Nexus chat / report 复用。sprite 机制（首帧裁切 + pixelated）走 global.css
// 的非 scoped .pixel-avatar / .pixel-avatar-sprite 基础样式；size = 可见方框边长(px)。
export function PixelAvatar({
  person,
  size = 40,
  className,
}: {
  person: Person
  size?: number
  className?: string
}) {
  const sprite = person.avatarSprite
  const style = {
    width: `${size}px`,
    height: `${size}px`,
    '--avatar-image': `url(${sprite.src})`,
    '--avatar-size': `${sprite.frameSize}px`,
    '--avatar-sheet-width': `${sprite.sheetWidth}px`,
    '--avatar-x': `-${sprite.frameX}px`,
    '--avatar-y': `-${sprite.frameY}px`,
    '--avatar-idle-end-x': `-${sprite.frameX + sprite.frameSize * 4}px`,
  } as CSSProperties

  return (
    <span
      className={['pixel-avatar', className].filter(Boolean).join(' ')}
      style={style}
      aria-hidden="true"
    >
      <span className="pixel-avatar-sprite" />
    </span>
  )
}
