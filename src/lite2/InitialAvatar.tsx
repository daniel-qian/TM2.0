// live 人卡的文字首字母 avatar（live 人无 sprite——不凭空派 avatar 资产）。
export function InitialAvatar({
  name,
  size = 44,
  className,
}: {
  name: string
  size?: number
  className?: string
}) {
  const initials = name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('')
  return (
    <span
      className={['initial-avatar', className].filter(Boolean).join(' ')}
      style={{ width: `${size}px`, height: `${size}px`, fontSize: `${Math.round(size * 0.36)}px` }}
      aria-hidden="true"
    >
      {initials}
    </span>
  )
}
