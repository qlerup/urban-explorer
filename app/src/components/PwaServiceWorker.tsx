'use client'

import { useEffect } from 'react'

function shellAssetUrls(): string[] {
  const urls = new Set<string>([
    '/dashboard/kort',
    '/site.webmanifest',
    '/favicon.ico',
    '/favicon-32x32.png',
    '/favicon-16x16.png',
    '/apple-touch-icon.png',
    '/android-chrome-192x192.png',
    '/android-chrome-512x512.png',
    '/maskable-icon-192x192.png',
    '/maskable-icon-512x512.png',
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

    return () => { cancelled = true }
  }, [])

  return null
}
