'use client'

import { useEffect } from 'react'

function shellAssetUrls(): string[] {
  const urls = new Set<string>([
    '/dashboard/kort',
    '/dashboard/ruteplanlaegger',
    '/site.webmanifest?v=brand-20261005',
    '/favicon.ico?v=brand-20261005',
    '/favicon-32x32.png?v=brand-20261005',
    '/favicon-16x16.png?v=brand-20261005',
    '/apple-touch-icon.png?v=brand-20261005',
    '/android-chrome-192x192.png?v=brand-20261005',
    '/android-chrome-512x512.png?v=brand-20261005',
    '/maskable-icon-192x192.png?v=brand-20261005',
    '/maskable-icon-512x512.png?v=brand-20261005',
  ])

  document.querySelectorAll<HTMLScriptElement>('script[src]').forEach(element => {
    if (element.src.startsWith(window.location.origin)) urls.add(new URL(element.src).pathname)
  })
  document.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"][href]').forEach(element => {
    if (element.href.startsWith(window.location.origin)) urls.add(new URL(element.href).pathname)
  })

  return [...urls]
}

export default function PwaServiceWorker() {
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return

    let cancelled = false
    void navigator.serviceWorker.register('/sw.js', { scope: '/' })
      .then(async registration => {
        if (cancelled) return
        await navigator.serviceWorker.ready
        const worker = registration.active ?? registration.waiting ?? registration.installing
        worker?.postMessage({ type: 'CACHE_APP_SHELL', urls: shellAssetUrls() })
      })
      .catch(error => {
        console.warn('[offline] Service worker kunne ikke registreres:', error)
      })

    const handleOfflineLink = (event: MouseEvent) => {
      if (navigator.onLine) return
      const target = event.target
      if (!(target instanceof Element)) return
      const anchor = target.closest<HTMLAnchorElement>('a[href]')
      if (!anchor) return
      const url = new URL(anchor.href, window.location.origin)
      if (url.origin !== window.location.origin) return
      if (url.pathname !== '/dashboard/kort' && url.pathname !== '/dashboard/ruteplanlaegger') return

      event.preventDefault()
      window.location.assign(`${url.pathname}${url.search}${url.hash}`)
    }

    document.addEventListener('click', handleOfflineLink, true)

    return () => {
      cancelled = true
      document.removeEventListener('click', handleOfflineLink, true)
    }
  }, [])

  return null
}
