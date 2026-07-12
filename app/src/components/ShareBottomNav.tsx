import Link from 'next/link'

export default function ShareBottomNav({ token }: { token: string }) {
  const items = [
    { href: `/share/${token}/kort`, label: 'Kort', icon: '🗺️' },
    { href: `/share/${token}/pins`, label: 'Mine pins', icon: '📍' },
  ]

  return (
    <nav className="md:hidden fixed bottom-0 left-0 right-0 z-30 bg-void-900 border-t border-void-700 px-3 pt-2 pb-[calc(env(safe-area-inset-bottom)+0.75rem)]">
      <div className="flex gap-1">
        {items.map(item => (
          <Link key={item.href} href={item.href} className="flex-1 flex flex-col items-center gap-0.5 rounded-xl py-2 text-xs font-medium text-gray-500">
            <span className="text-xl leading-none">{item.icon}</span>
            {item.label}
          </Link>
        ))}
      </div>
    </nav>
  )
}
