import type { Config } from 'tailwindcss'

const config: Config = {
  content: ['./src/**/*.{js,ts,jsx,tsx,mdx}'],
  theme: {
    extend: {
      colors: {
        void: {
          950: '#07090c',
          900: '#0d1117',
          800: '#151b23',
          700: '#1f2732',
          600: '#2c3644',
        },
        rust: {
          500: '#e08a3c',
          600: '#c96f22',
          700: '#a4581b',
        },
      },
    },
  },
  plugins: [],
}

export default config
