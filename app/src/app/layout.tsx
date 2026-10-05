import type { Metadata, Viewport } from 'next'
import 'ol/ol.css'
import './globals.css'
import PwaServiceWorker from '@/components/PwaServiceWorker'

export const metadata: Metadata = {
  title: 'Urban Explorer',
  description: 'Find, markér og gem forladte steder',
  applicationName: 'Urban Explorer',
  manifest: '/site.webmanifest?v=brand-20261005',
  appleWebApp: {
    capable: true,
    title: 'Urban Explorer',
    statusBarStyle: 'black-translucent',
  },
  icons: {
    icon: [
      { url: '/favicon.ico?v=brand-20261005', sizes: 'any' },
      { url: '/favicon-32x32.png?v=brand-20261005', sizes: '32x32', type: 'image/png' },
      { url: '/favicon-16x16.png?v=brand-20261005', sizes: '16x16', type: 'image/png' },
    ],
    apple: [{ url: '/apple-touch-icon.png?v=brand-20261005', sizes: '180x180', type: 'image/png' }],
  },
  other: {
    'apple-mobile-web-app-capable': 'yes',
    'msapplication-TileColor': '#07090c',
  },
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  themeColor: '#07090c',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="da">
      <body className="antialiased">
        <PwaServiceWorker />
        {children}
      </body>
    </html>
  )
}
