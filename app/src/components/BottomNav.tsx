'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

const BASE_ITEMS = [
  { href: '/dashboard/kort', label: 'Kort', icon: '🗺️' },
  { href: '/dashboard/pins', label: 'Mine pins', icon: '📍' },
  { href: '/dashboard/kategorier', label: 'Kategorier', icon: '🏷️' },
  { href: '/dashboard/delte-links', label: 'Delt', icon: '🔗' },
  { href: '/dashboard/profil', label: 'Profil', icon: '👤' },
]

const ADMIN_ITEM = { href: '/dashboard/indstillinger', label: 'Indstillinger', icon: '⚙️' }

export default function BottomNav({ isAdmin }: { isAdmin: boolean }) {
  const pathname = usePathname()
  const items = isAdmin ? [...BASE_ITEMS, ADMIN_ITEM] : BASE_ITEMS

  return (
    <nav className="md:hidden fixed bottom-0 left-0 right-0 z-30 bg-void-900 border-t border-void-700 px-3 pt-2 pb-[calc(env(safe-area-inset-bottom)+0.75rem)]">
      <div className="flex gap-1">
        {items.map(item => {
          const active = pathname === item.href || pathname.startsWith(item.href + '/')
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex-1 flex flex-col items-center gap-0.5 rounded-xl py-2 text-xs font-medium transition-colors ${
                active ? 'text-rust-500' : 'text-gray-500'
              }`}
            >
              <span className="text-xl leading-none">{item.icon}</span>
              {item.label}
            </Link>
          )
        })}
      </div>
    </nav>
  )
}
