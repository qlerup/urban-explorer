import { getCustomPinIcon } from '@/types/pin'

interface Props {
  icon: string | null | undefined
  className?: string
}

export default function PinIcon({ icon, className = '' }: Props) {
  const value = icon || '📍'
  const customIcon = getCustomPinIcon(value)

  if (customIcon) {
    return (
      <img
        src={customIcon.value}
        alt=""
        className={`block object-contain ${className}`}
        draggable={false}
      />
    )
  }

  return <span className={className}>{value}</span>
}
