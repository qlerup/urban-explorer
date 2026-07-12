'use client'

interface Props {
  value: number
  onChange: (value: number) => void
  readOnly?: boolean
}

export default function StarRating({ value, onChange, readOnly }: Props) {
  const canClear = !readOnly && value > 0

  return (
    <div className="flex items-center gap-2">
      {[1, 2, 3].map(n => (
        <button
          key={n}
          type="button"
          disabled={readOnly}
          onClick={() => onChange(value === n ? 0 : n)}
          className={`text-2xl leading-none transition-colors ${
            n <= value ? 'text-rust-500' : 'text-void-600'
          } ${readOnly ? 'cursor-default' : 'hover:text-rust-400 cursor-pointer'}`}
          aria-label={value === n ? 'Fjern rating' : `${n} stjerner`}
        >
          ★
        </button>
      ))}
      {canClear && (
        <button
          type="button"
          onClick={() => onChange(0)}
          className="text-xs text-gray-500 hover:text-gray-300 px-2 py-1 rounded-lg hover:bg-void-800 transition-colors"
        >
          Fjern
        </button>
      )}
    </div>
  )
}
