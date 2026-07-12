import Link from 'next/link'

export default function ShareTopNav({ token }: { token: string }) {
  const items = [
    { href: `/share/${token}/kort`, label: 'Kort' },
    { href: `/share/${token}/pins`, label: 'Mine pins' },
  ]

  return (
    <header className="hidden md:flex items-center justify-between px-6 h-16 bg-void-900 border-b border-void-700">
      <span className="flex items-center gap-2 font-bold text-gray-100">
        <span className="text-xl">🔦</span> Urban Explorer
        <span className="text-xs font-normal text-gray-500 bg-void-800 border border-void-600 rounded-full px-2 py-0.5">
          Delt visning
        </span>
      </span>
      <nav className="flex gap-1">
        {items.map(item => (
          <Link key={item.href} href={item.href} className="px-4 py-2 rounded-lg text-sm font-medium text-gray-400 hover:text-gray-200 hover:bg-void-800 transition-colors">
            {item.label}
          </Link>
        ))}
      </nav>
    </header>
  )
}
