'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

const BASE_ITEMS = [
  { href: '/dashboard/kort', label: 'Kort' },
  { href: '/dashboard/pins', label: 'Mine pins' },
  { href: '/dashboard/kategorier', label: 'Kategorier' },
  { href: '/dashboard/delte-links', label: 'Delte links' },
  { href: '/dashboard/profil', label: 'Profil' },
]

const ADMIN_ITEM = { href: '/dashboard/indstillinger', label: 'Indstillinger' }

export default function TopNav({ isAdmin }: { isAdmin: boolean }) {
  const pathname = usePathname()
  const items = isAdmin ? [...BASE_ITEMS, ADMIN_ITEM] : BASE_ITEMS

  return (
    <header className="hidden md:flex items-center gap-4 px-6 h-16 bg-void-900 border-b border-void-700">
      <Link href="/dashboard/kort" className="flex items-center gap-2 font-bold text-gray-100 shrink-0">
        <span className="text-xl">🔦</span> Urban Explorer
      </Link>

      <nav className="ml-auto flex gap-1 shrink-0">
        {items.map(item => {
          const active = pathname === item.href || pathname.startsWith(item.href + '/')
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                active ? 'bg-rust-600/15 text-rust-500' : 'text-gray-400 hover:text-gray-200 hover:bg-void-800'
              }`}
            >
              {item.label}
            </Link>
          )
        })}
      </nav>
    </header>
  )
}
