import type { NextConfig } from 'next'

const config: NextConfig = {
  output: 'standalone',
  serverExternalPackages: ['argon2', 'pg', '@resvg/resvg-js'],
}

export default config
